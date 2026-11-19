// 真沙盘的冒烟测试：不带 ?stage=fake，等沙盘栏报告摆好了，再换一节，再离开这一站又回来。
// 只看“起得来、换得动、数得出三角形、回来还是那一块画布”，不看画得好不好（那要看 real-shots.spec.ts 拍的照）。
// 浏览器没有 WebGL2 时，在自己的机器上跳过（用软件画的也算有）；在发布流程里不跳过，算没通过：
// 跳过的测试算“通过”，那样一座一次也没起来过的沙盘就发出去了。
//
// 一共三项：
//   完整的一档、减配的一档  地址里指定画质（?tier=full、?tier=reduced）。指定了，沙盘程序不量快慢、不自己换档，
//                          所以没有显卡的机器上每一次跑出来都是同一个结果。两档都查：摆好的真是这一档；一个画面的
//                          三角形数、画几批在预算里（上限在 tests/stage/support/budgets.ts）；摆好以后站着不动，一帧都不再画。
//   不指定画质              让沙盘程序自己挑。机器快慢不一样，结果可以不一样，所以只查哪种结果都该成立的事：
//                          时限之内，要么摆好了（哪一档都行），要么说了一句“太慢”、换成图片；页面不出错。
//                          挑到了哪一档、试画用了多久，印出来。
//
// 时限是照最慢的情形留的：摆好 120 秒，换一节 60 秒，回来再摆好 60 秒，加起来比一项的 300 秒短。开发机上量到的（没有显卡，Windows 走 D3D11）：摆好 3 到 4 秒，
// 不带动画换一节 0.2 秒上下，回到这一站再摆好不到 3 秒。发布流程的机器用软件渲染，会慢得多，没量过。
// 每一步用了多久都印出来，跑完可以在记录里看到。

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { StageTier } from '../../src/stage/types';
import { DRAW_CALLS_MAX, STANDING_STILL_MS, TRIANGLES_MAX } from '../stage/support/budgets';
import { expectRealTable, headingsOf, openFigureWithTable, realUrl, scrollToSection, stagePane, stageReadout, stripsOf } from './helpers';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** 每一步最多等多久（毫秒）。加起来比这一项测试的时限短，慢的时候报得出是哪一步慢。 */
const READY_MS = 120_000;
const SECTION_MS = 60_000;
const RETURN_MS = 60_000;
/** 不指定画质时等多久：最坏是完整的一档摆了嫌慢、减配的一档摆了又嫌慢，前后要造两座。 */
const AUTO_MS = 2 * READY_MS;

const TIER_NAME: Record<StageTier, string> = { full: '完整', reduced: '减配' };

/** 页面上的报错，记下来最后一起看。 */
function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`页面出错：${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`控制台报错：${message.text()}`);
  });
  return problems;
}

/** 这个浏览器有没有 WebGL2。没有时：发布流程里算没通过，自己的机器上跳过。 */
async function needWebGL2(page: Page): Promise<void> {
  const hasWebGL2 = await page.evaluate(() => {
    try {
      return document.createElement('canvas').getContext('webgl2') !== null;
    } catch {
      return false;
    }
  });
  if (env.CI) expect(hasWebGL2, '发布流程的浏览器没有 WebGL2：真沙盘一次也没有起来过，不能算通过').toBe(true);
  else test.skip(!hasWebGL2, '这个浏览器没有 WebGL2');
}

/**
 * 指定画质的那两项：有沙盘的那一站摆得出来，是指定的那一档，读到后面的小节换得过去，预算之内，站着不动不再画。
 * leaveAndReturn：再查一遍“离开这一站又回来，还摆得出来，还是只有一块画布”。
 */
async function forcedTier(page: Page, tier: StageTier, leaveAndReturn: boolean): Promise<void> {
  const tag = `真沙盘（${TIER_NAME[tier]}）`;
  // 用软件画，画面越大越慢：用小一点的窗口（仍是宽屏版面），并且不要滑动的动画。
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const problems = watchProblems(page);

  // 第一位人物、第一个有沙盘的站
  const { found } = await openFigureWithTable(page, realUrl('#/', tier, '&debug=1'));
  await needWebGL2(page);
  if (env.CI) expect(found, '发布流程里没有找到带沙盘的站：真沙盘一次也没有起来过，不能算通过').not.toBeNull();
  else test.skip(!found, '还没有哪一站有沙盘');
  if (!found) return;
  const headings = headingsOf(found.scene);
  const stopItem = page.locator(`.stop-item[data-stop-id="${found.stopId}"]`);
  const pane = stagePane(page);
  const canvas = page.locator('.stage-host canvas');

  let from = Date.now();
  await stopItem.click();
  // “沙盘正在摆出来”那句话这里不查：它要过一秒半还没有任何画面才出来，机器快、或者这一站有定格图的时候根本不出现
  //（什么时候出、什么时候不出，由 tests/unit/page/pane-stills.test.tsx 和 pane-behaviour.test.tsx 照真的时间查）。
  // 先等它有个结果（摆好或没摆出来），没摆出来时不用白等。刚点下去的那一刻，沙盘栏还是人物页的那一个（状态是 still）：
  // 只等“不是 loading”的话当场就过了，下一行就会在沙盘还在摆的时候去查。所以等的是“既不是 still、也不是 loading”
  await expect(pane).toHaveAttribute('data-stage-state', /^(?!still$|loading$)/, { timeout: READY_MS });
  await expect(pane).toHaveAttribute('data-stage-state', 'ready', { timeout: 1_000 });
  console.log(`${tag}：摆好用了 ${Date.now() - from} 毫秒`);
  // 摆着的是立体的沙盘（不是顶替它的图片），而且就是指定的这一档
  await expectRealTable(page, tier);
  await expect(pane).toHaveAttribute('data-stage-section', headings[0]);
  await expect(canvas).toHaveCount(1);
  await expect(canvas).toBeVisible();
  await expect(page.locator('.stage-host .strip').first()).toBeVisible();
  // 画布铺满沙盘栏，不是缩在一角
  const paneBox = (await pane.boundingBox())!;
  const canvasBox = (await canvas.boundingBox())!;
  expect(canvasBox.width).toBeGreaterThan(paneBox.width - 2);
  expect(canvasBox.height).toBeGreaterThan(paneBox.height - 2);
  // 真沙盘报了比例尺：题记第一行里写着“多少米”或“多少公里”
  await expect(page.locator('.stage-scale-label')).toHaveText(/^\d+(\.\d+)? (米|公里)$/);
  // 题记那一块有多高：换了小节以后拿来比
  const caption = page.locator('.stage-caption');
  const captionHeight = (await caption.boundingBox())!.height;
  await expect(page.locator('.stage-note-short')).toBeVisible();

  // 读到后面的一节（徐州是“水退以后”）：沙盘换过去，这一节的第一条题签挂上了
  const later = headings[Math.min(3, headings.length - 1)];
  from = Date.now();
  await scrollToSection(page, later);
  await expect(pane).toHaveAttribute('data-stage-section', later, { timeout: SECTION_MS });
  console.log(`${tag}：换到“${later}”用了 ${Date.now() - from} 毫秒（不带动画）`);
  await expect(page.locator(`.stage-host .strip[data-strip-id="${stripsOf(found.scene, later)[0].id}"]`)).toHaveCount(1);
  // 题记换成了这一节的，还是那么高（沙盘四边留的空不变，画面不会在换了小节以后再跳一下）
  await expect(caption).toHaveAttribute('data-section', later);
  expect((await caption.boundingBox())!.height).toBe(captionHeight);
  // 换了小节，摆着的还是这一档的立体沙盘
  await expectRealTable(page, tier);

  // 一个画面的三角形数和画了几批：在预算里（正好等于上限算合格）
  const readout = await stageReadout(page);
  expect(readout, '带了 ?debug=1，页面上却没有读数').not.toBeNull();
  if (readout) {
    console.log(`${tag}：“${later}”一个画面 ${readout.triangles} 个三角形，画了 ${readout.drawCalls} 批`);
    expect(readout.triangles).toBeGreaterThan(50_000);
    expect(readout.triangles).toBeLessThanOrEqual(TRIANGLES_MAX);
    expect(readout.drawCalls).toBeGreaterThan(10);
    expect(readout.drawCalls).toBeLessThanOrEqual(DRAW_CALLS_MAX);
    // 画质和快慢的读数：就是指定的这一档
    expect(readout.perf, '摆好的立体沙盘没有给画质的读数').toBeDefined();
    expect(readout.perf?.tier).toBe(tier);
    if (readout.perf) {
      const { pixelRatio, buffer, trialMs } = readout.perf;
      console.log(`${tag}：像素比 ${pixelRatio}，画布 ${buffer.width} × ${buffer.height} 像素，试画 ${trialMs === null ? '还没有' : `${trialMs} 毫秒`}`);
    }
  }

  // 读正文的时候一帧都不画：等沙盘把收尾的活做完（换完小节以后补画的那一次影子），站着不动一秒半，画的帧数不变。
  // （第一次取读数，它自己可能补画一帧不带影子的；所以取两次，拿第二次的数当起点。）
  await page.waitForTimeout(600);
  await stageReadout(page);
  const before = (await stageReadout(page))?.perf?.frames;
  expect(typeof before, '读数里没有“一共画了几帧”').toBe('number');
  await page.waitForTimeout(STANDING_STILL_MS);
  const after = (await stageReadout(page))?.perf?.frames;
  expect(after, `站着不动 ${STANDING_STILL_MS} 毫秒，沙盘又画了 ${(after ?? 0) - (before ?? 0)} 帧`).toBe(before);

  if (leaveAndReturn) {
    // 回各站目录：画布拿走了。再进这一站：还摆得出来，页面上还是只有一块画布。
    await page.locator('.stop-nav-list').click();
    await expect(pane).toHaveAttribute('data-stage-state', 'still');
    await expect(page.locator('canvas')).toHaveCount(0);
    from = Date.now();
    await stopItem.click();
    await expect(pane).toHaveAttribute('data-stage-state', 'ready', { timeout: RETURN_MS });
    console.log(`${tag}：回到这一站再摆好用了 ${Date.now() - from} 毫秒`);
    await expectRealTable(page, tier);
    await expect(pane).toHaveAttribute('data-stage-section', headings[0]);
    await expect(page.locator('canvas')).toHaveCount(1);
    await expect(canvas).toBeVisible();
    await expect(page.locator('.stage-host .strip').first()).toBeVisible();
  }

  expect(problems).toEqual([]);
}

test('真沙盘（完整的一档）：有沙盘的那一站摆得出来，读到后面的小节换得过去，三角形数和画几批在预算里，站着不动不再画，离开再回来还摆得出来', async ({ page }) => {
  test.setTimeout(300_000);
  await forcedTier(page, 'full', true);
});

test('真沙盘（减配的一档）：摆出来的真是减配的一档，换得动小节，三角形数和画几批在预算里，站着不动不再画', async ({ page }) => {
  test.setTimeout(300_000);
  await forcedTier(page, 'reduced', false);
});

test('真沙盘，不指定画质：时限之内要么摆好（哪一档都行），要么说一句“太慢”、换成图片；页面不出错', async ({ page }) => {
  test.setTimeout(AUTO_MS + 60_000);
  await page.setViewportSize({ width: 1024, height: 640 });
  // 不要滑动的动画：这样只在一开始试画一次，摆好以后不会再因为滑得慢而换档，“摆好了”就是最后的结果
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const problems = watchProblems(page);

  const { found } = await openFigureWithTable(page, realUrl('#/', null, '&debug=1'));
  await needWebGL2(page);
  if (env.CI) expect(found, '发布流程里没有找到带沙盘的站：真沙盘一次也没有起来过，不能算通过').not.toBeNull();
  else test.skip(!found, '还没有哪一站有沙盘');
  if (!found) return;
  const pane = stagePane(page);

  const from = Date.now();
  await page.locator(`.stop-item[data-stop-id="${found.stopId}"]`).click();
  await expect(pane).toHaveAttribute('data-stage-state', /^(ready|slow)$/, { timeout: AUTO_MS });
  const took = Date.now() - from;
  const state = await pane.getAttribute('data-stage-state');
  // 带了 ?debug=1，沙盘栏里有一行读数（画质、试画用了多久……）；没有立体的沙盘时没有这一行
  const debugLine = (await pane.locator('.stage-debug').count()) > 0 ? ((await pane.locator('.stage-debug').first().textContent()) ?? '') : '';

  if (state === 'ready') {
    await expect(pane).toHaveAttribute('data-stage-picture', 'table');
    await expect(pane).toHaveAttribute('data-stage-tier', /^(full|reduced)$/);
    await expect(page.locator('.stage-host canvas')).toHaveCount(1);
    const readout = await stageReadout(page);
    const perf = readout?.perf;
    expect(perf, '摆好的立体沙盘没有给画质的读数').toBeDefined();
    expect(perf?.tier).toBe(await pane.getAttribute('data-stage-tier'));
    console.log(`真沙盘（自己挑）：${took} 毫秒以后摆好了，挑的是${perf ? TIER_NAME[perf.tier] : '？'}的一档，试画 ${perf?.trialMs ?? '？'} 毫秒。${debugLine}`);
  } else {
    // 太慢：说了那一句话；放着的是图片，或者（这一站还没有定格图时）只有话；没有立体的沙盘留在页面上。
    // 看的是那一句话自己（它在一直都在的那一块 role="status" 里）：那一块自己不占地方（放着图片时里面的一行话是另外定位的），
    // 拿它问“看不看得见”，浏览器答看不见。这一支只有用软件画的机器（发布流程的机器）才走得到。
    await expect(pane.locator('[role="status"] p').filter({ hasText: '立体的沙盘在这台设备上太慢' }).first()).toBeVisible();
    await expect(pane).toHaveAttribute('data-stage-picture', /^(still|none)$/);
    await expect(page.locator('.stage-host canvas')).toHaveCount(0);
    console.log(`真沙盘（自己挑）：${took} 毫秒以后说“太慢”，没有摆立体的沙盘（这台机器连减配的一档也嫌慢）。${debugLine}`);
  }

  expect(problems).toEqual([]);
});

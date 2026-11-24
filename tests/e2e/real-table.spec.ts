// 真沙盘的冒烟测试：不带 ?stage=fake，等沙盘栏报告摆好了，再换一节，再离开这一站又回来。
// 只看“起得来、换得动、数得出三角形、回来还是那一块画布”，不看画得好不好（那要看 real-shots.spec.ts 拍的照）。
// 浏览器没有 WebGL2 时，在自己的机器上跳过（用软件画的也算有）；在发布流程里不跳过，算没通过：
// 跳过的测试算“通过”，那样一座一次也没起来过的沙盘就发出去了。
//
// 一共六项：前三项是有自己的沙盘的那一站，后三项是人物页上真的全程沙盘，各有完整的一档、减配的一档、不指定画质三种。
// 有自己的沙盘的站不止一个以后（黄州是第二座），后面的每一座再各添两项——完整的一档、减配的一档——换过去的是它第一个夜里的小节（有的话）。
// 全程沙盘的三项：摆得出来，三角形数和画几批在预算里（印出来），按一方印就到那一站、沙盘换到它的来路，走到下一站跟着再换；
// 完整的一档另量带印的题签（量出来和题签的测试算的一样大）；减配的一档要比完整的一档少画三角形。前三项的说法：
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
import type { RouteScene } from '../../src/domain/scene';
import { stripTexts } from '../../src/domain/sceneText';
import type { StageTier } from '../../src/stage/types';
import { DRAW_CALLS_MAX, STANDING_STILL_MS, TRIANGLES_MAX, checkReduced } from '../stage/support/budgets';
import { stripSize, stripSizeKind } from '../stage/support/stripSizes';
import { expectRealTable, headingsOf, openFigureWithTable, realUrl, roadOf, routeOnDisk, sceneOnDisk, scrollToSection, stagePane, stageReadout, stopsWithScenes, stripsOf } from './helpers';

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
 * stopId 不写是第一个有沙盘的站；写了是那一站（每一座沙盘各起一遍：着色器、模型出了错，只有打开那一座才看得出来）。
 * 写了 stopId 的，换过去的是这一站第一个夜里的小节（有的话）：夜里的光也在浏览器里走一遍。
 */
async function forcedTier(page: Page, tier: StageTier, leaveAndReturn: boolean, stopId?: string): Promise<void> {
  const tag = `真沙盘（${TIER_NAME[tier]}${stopId ? `，${stopId}` : ''}）`;
  // 用软件画，画面越大越慢：用小一点的窗口（仍是宽屏版面），并且不要滑动的动画。
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const problems = watchProblems(page);

  // 第一位人物、第一个有沙盘的站（写了 stopId 就是那一站）
  const opened = await openFigureWithTable(page, realUrl('#/', tier, '&debug=1'));
  await needWebGL2(page);
  let found = opened.found;
  if (stopId) {
    const scene = sceneOnDisk(opened.figureId, stopId);
    expect(scene, `${stopId} 没有场景文件`).not.toBeNull();
    found = scene ? { stopId, scene } : null;
  }
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
  // 先等它有个结果（摆好或没摆出来），没摆出来时不用白等。刚点下去的那一刻，沙盘栏还是人物页的那一个（摆着全程沙盘，
  // 可能已经摆好了）：只等“摆好了”的话当场就过了。所以先等栏里不再是全程沙盘，再等“既不是 still、也不是 loading”
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-scene', 'yes', { timeout: READY_MS });
  await expect(pane).not.toHaveAttribute('data-stage-level', 'route');
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
  const night = stopId ? found.scene.sections.findIndex((section) => section.sky === 'night') : -1;
  const later = headings[night >= 0 ? night : Math.min(3, headings.length - 1)];
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
    // 回各站目录：这一站的沙盘拿走，人物页上摆出全程沙盘（同一块画布，页面上还是只有一块）。再进这一站：还摆得出来。
    await page.locator('.stop-nav-list').click();
    await expect(pane).toHaveAttribute('data-stage-level', 'route', { timeout: RETURN_MS });
    await expectRealTable(page, tier, RETURN_MS);
    await expect(page.locator('canvas')).toHaveCount(1);
    console.log(`${tag}：回到人物页，全程沙盘摆好用了 ${Date.now() - from} 毫秒`);
    from = Date.now();
    await stopItem.click();
    await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-scene', 'yes', { timeout: RETURN_MS });
    await expect(pane).not.toHaveAttribute('data-stage-level', 'route');
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

// 别的有沙盘的站（第一个上面两项已经起过了）：每一座各起两遍，完整的一档和减配的一档。
// 第二座沙盘用到的着色器、模型、夜里的光，只有打开它才编译、才造得出来；不这样查，它出了错两道关都看不见。
// “第一个”和上面两项一样，是目录里第一个写好了正文、有沙盘的站：这几项要读到后面的小节，得有正文带着镜头走。
const FIRST_FIGURE = stopsWithScenes()[0]?.figureId;
for (const { stopId } of stopsWithScenes().filter((one) => one.figureId === FIRST_FIGURE && one.written).slice(1)) {
  test(`真沙盘（完整的一档），${stopId}：这一站自己的沙盘摆得出来，换得到夜里的小节（有的话），三角形数和画几批在预算里，站着不动不再画`, async ({ page }) => {
    test.setTimeout(300_000);
    await forcedTier(page, 'full', false, stopId);
  });

  test(`真沙盘（减配的一档），${stopId}：摆出来的真是减配的一档，换得动小节，三角形数和画几批在预算里，站着不动不再画`, async ({ page }) => {
    test.setTimeout(300_000);
    await forcedTier(page, 'reduced', false, stopId);
  });
}

// 有自己的沙盘、正文还没写的站（眉州，2026-11-23 起）：页面上没有正文带着镜头走，沙盘先停在头一个画面；
// 文字栏里有一张单子“沙盘上看的几处”，按哪一行沙盘就换到哪一处（2026-11-24 起）。
// 它的模型、着色器也只有打开它才造得出来，所以两档各起一遍：摆得出来，头一个画面在预算里；单子上一行一行按过去，
// 每一处都换得到、都在预算里；页面不出错；再照页面上走得到的路走一遍——回各站目录，全程沙盘摆好；再进来，还摆得出来。
for (const { stopId, scene } of stopsWithScenes().filter((one) => one.figureId === FIRST_FIGURE && !one.written)) {
  for (const tier of ['full', 'reduced'] as const) {
    test(`真沙盘（${TIER_NAME[tier]}的一档），${stopId}（正文还没写）：这一站自己的沙盘摆得出来，先停在头一个画面；按单子上的每一行，沙盘都换得过去，每一处的三角形数和画几批都在预算里；回目录再进来还摆得出来；页面不出错`, async ({ page }) => {
      test.setTimeout(300_000);
      const tag = `真沙盘（${TIER_NAME[tier]}，${stopId}，正文还没写）`;
      await page.setViewportSize({ width: 1024, height: 640 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const problems = watchProblems(page);
      await openFigureWithTable(page, realUrl('#/', tier, '&debug=1'));
      await needWebGL2(page);
      const first = scene.sections[0];
      const stopItem = page.locator(`.stop-item[data-stop-id="${stopId}"]`);
      const pane = stagePane(page);
      const canvas = page.locator('.stage-host canvas');

      let from = Date.now();
      await stopItem.click();
      await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', stopId, { timeout: READY_MS });
      await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-scene', 'yes', { timeout: READY_MS });
      await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-text', 'none');
      await expect(pane).not.toHaveAttribute('data-stage-level', 'route');
      await expect(pane).toHaveAttribute('data-stage-state', /^(?!still$|loading$)/, { timeout: READY_MS });
      await expect(pane).toHaveAttribute('data-stage-state', 'ready', { timeout: 1_000 });
      console.log(`${tag}：摆好用了 ${Date.now() - from} 毫秒`);
      await expectRealTable(page, tier);
      await expect(pane).toHaveAttribute('data-stage-section', first.heading);
      await expect(page.locator('.stage-caption')).toHaveAttribute('data-section', first.heading);
      await expect(canvas).toHaveCount(1);
      await expect(canvas).toBeVisible();
      await expect(page.locator(`.stage-host .strip[data-strip-id="${stripsOf(scene, first.heading)[0].id}"]`)).toHaveCount(1);
      await expect(page.locator('.stage-scale-label')).toHaveText(/^\d+(\.\d+)? (米|公里)$/);
      await expect(page.locator('.stage-note-short')).toBeVisible();
      // 正文那一栏：一句话，一张单子（场景里有几处就有几行，头一行是摆着的）；按钮下面没有那一行话
      await expect(page.locator('.not-written')).toHaveText('这一站的正文还没写。按下面的一行，沙盘就换到那一处；各处的时间写在每一行里，不一定都在上面这几年里。');
      await expect(page.locator('.text-section')).toHaveCount(0);
      await expect(pane.locator('.stage-notice')).toHaveCount(0);
      const items = page.locator('.views .view-item');
      await expect(items).toHaveCount(scene.sections.length);
      await expect(page.locator('.views .view-item[aria-current="true"]')).toHaveAttribute('data-view', first.heading);

      /** 摆着的这一处：一个画面的三角形数和画了几批，在预算里，是指定的这一档。 */
      const expectBudget = async (heading: string): Promise<void> => {
        const readout = await stageReadout(page);
        expect(readout, '带了 ?debug=1，页面上却没有读数').not.toBeNull();
        if (!readout) return;
        console.log(`${tag}：“${heading}”一个画面 ${readout.triangles} 个三角形，画了 ${readout.drawCalls} 批`);
        expect(readout.triangles).toBeGreaterThan(50_000);
        expect(readout.triangles).toBeLessThanOrEqual(TRIANGLES_MAX);
        expect(readout.drawCalls).toBeGreaterThan(10);
        expect(readout.drawCalls).toBeLessThanOrEqual(DRAW_CALLS_MAX);
        expect(readout.perf?.tier).toBe(tier);
      };
      await expectBudget(first.heading);

      // 单子上一行一行按过去（这个窗口是宽屏的排法，沙盘栏在一边，文字栏自己滚）：真沙盘换到那一处，题记、头一条题签是那一处的，
      // 还是这一档的立体沙盘，每一处的画面都在预算里。这是页面上到得了后面几处的唯一一条路。
      for (const section of scene.sections.slice(1)) {
        from = Date.now();
        await page.locator(`.views .view-item[data-view="${section.heading}"]`).click();
        await expect(page.locator('.views .view-item[aria-current="true"]')).toHaveAttribute('data-view', section.heading);
        await expect(pane).toHaveAttribute('data-stage-section', section.heading, { timeout: SECTION_MS });
        console.log(`${tag}：按了“${section.heading}”，换过去用了 ${Date.now() - from} 毫秒（不带动画）`);
        await expect(page.locator('.stage-caption')).toHaveAttribute('data-section', section.heading);
        await expect(page.locator(`.stage-host .strip[data-strip-id="${stripsOf(scene, section.heading)[0].id}"]`)).toHaveCount(1);
        await expectRealTable(page, tier);
        await expectBudget(section.heading);
      }
      await expect(canvas).toHaveCount(1);

      // 回各站目录：全程沙盘摆好（还是只有一块画布）。再进这一站：还摆得出来，是头一个画面（不带着刚才按到的那一处）
      await page.locator('.stop-nav-list').click();
      await expect(pane).toHaveAttribute('data-stage-level', 'route', { timeout: RETURN_MS });
      await expectRealTable(page, tier, RETURN_MS);
      await expect(page.locator('canvas')).toHaveCount(1);
      from = Date.now();
      await stopItem.click();
      await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-scene', 'yes', { timeout: RETURN_MS });
      await expect(pane).not.toHaveAttribute('data-stage-level', 'route');
      await expect(pane).toHaveAttribute('data-stage-state', 'ready', { timeout: RETURN_MS });
      console.log(`${tag}：回到这一站再摆好用了 ${Date.now() - from} 毫秒`);
      await expectRealTable(page, tier);
      await expect(pane).toHaveAttribute('data-stage-section', first.heading);
      await expect(page.locator('.views .view-item[aria-current="true"]')).toHaveAttribute('data-view', first.heading);
      await expect(page.locator('canvas')).toHaveCount(1);

      expect(problems).toEqual([]);
    });
  }
}

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
  // 刚点下去的那一刻沙盘栏还是人物页的那一个（全程沙盘，可能已经摆好）：先等栏里换成这一站的
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-scene', 'yes', { timeout: AUTO_MS });
  await expect(pane).not.toHaveAttribute('data-stage-level', 'route');
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

/** 全程沙盘上“全程”那一节一个画面的三角形数：完整的一档量到的记在这里，减配的一档拿来比（两项按先后跑，完整的在前）。 */
let routeWholeFull: number | null = null;

/**
 * 人物页上真的全程沙盘，指定画质：摆得出来，是指定的那一档，三角形数和画几批在预算里；按一方印就到那一站（没有自己的沙盘的一站），
 * 还是这一座沙盘、这一块画布，换到它的来路；再走到下一站，沙盘跟着换到下一段来路；站着不动不再画。
 * 完整的一档另量带印的题签的大小、换今名。
 */
async function routeForced(page: Page, tier: StageTier): Promise<void> {
  const tag = `真的全程沙盘（${TIER_NAME[tier]}）`;
  // 电脑的窗口：沙盘栏 940 × 900，题签是大的一种。不要滑动的动画。
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const problems = watchProblems(page);
  const { figureId } = await openFigureWithTable(page, realUrl('#/', tier, '&debug=1'));
  await needWebGL2(page);
  const route = routeOnDisk(figureId);
  if (env.CI) expect(route, '发布流程里没有找到全程沙盘：它一次也没有起来过，不能算通过').not.toBeNull();
  else test.skip(!route, '这位人物还没有全程沙盘');
  if (!route) return;
  const whole = route.sections[0].heading;
  const pane = stagePane(page);

  const from = Date.now();
  await expect(pane).toHaveAttribute('data-stage-level', 'route', { timeout: READY_MS });
  await expectRealTable(page, tier, READY_MS);
  await expect(pane).toHaveAttribute('data-stage-section', whole);
  await expect(page.locator('.stage-host canvas')).toHaveCount(1);
  const readout = await stageReadout(page);
  expect(readout, '带了 ?debug=1，却读不到沙盘的读数').not.toBeNull();
  console.log(`${tag}：人物页打开以后 ${Date.now() - from} 毫秒摆好；“${whole}”一个画面 ${readout?.triangles} 个三角形，画 ${readout?.drawCalls} 批`);
  expect(readout!.triangles).toBeGreaterThan(50_000);
  expect(readout!.triangles).toBeLessThanOrEqual(TRIANGLES_MAX);
  expect(readout!.drawCalls).toBeGreaterThan(5);
  expect(readout!.drawCalls).toBeLessThanOrEqual(DRAW_CALLS_MAX);
  expect(readout!.perf?.tier, '读数里的画质就是指定的这一档').toBe(tier);
  if (readout?.perf) console.log(`${tag}：像素比 ${readout.perf.pixelRatio}，画布 ${readout.perf.buffer.width} × ${readout.perf.buffer.height} 像素`);
  // 减配的一档比完整的一档少画三角形（少多少印出来；少得不到一成只提醒，见 tests/stage/support/budgets.ts 的 checkReduced）
  if (tier === 'full') routeWholeFull = readout!.triangles;
  else if (routeWholeFull !== null) {
    const found = checkReduced(`${tag}“${whole}”`, routeWholeFull, readout!.triangles);
    console.log(`${tag}：“${whole}”比完整的一档（${routeWholeFull}）少 ${routeWholeFull - readout!.triangles} 个三角形（${(((routeWholeFull - readout!.triangles) / routeWholeFull) * 100).toFixed(1)}%）${found.warn ? `；提醒：${found.warn}` : ''}`);
    expect(found.fail, found.fail).toBeUndefined();
  } else console.log(`${tag}：完整的一档这一次没有先跑（单跑这一项，或者它没通过），“比完整的少”这里没有比；Node 里的 scene-budgets 照样查`);

  if (tier === 'full') await sealedStripsMeasured(page, route, whole);

  // 按一方印：到那一站。挑一站没有自己的沙盘的：还是这一座全程沙盘、这一块画布，摆到它的来路。
  const target = (await page.locator('.strip-seal').evaluateAll((seals) => seals.map((seal) => seal.getAttribute('data-stop-id') ?? ''))).find((id) => sceneOnDisk(figureId, id) === null);
  expect(target, '要有一站还没有自己的沙盘').toBeDefined();
  if (!target) return;
  await page.locator('.stage-host canvas').evaluate((el) => el.setAttribute('data-same-canvas', 'yes'));
  const seal = page.locator(`.strip-seal[data-stop-id="${target}"]`).first();
  const box = (await seal.boundingBox())!;
  // 像手指那样点在印的正中
  let since = Date.now();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page).toHaveURL(new RegExp(`#/${figureId}/${target}`));
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', target);
  await expect(pane).toHaveAttribute('data-stage-section', roadOf(route, target)!, { timeout: SECTION_MS });
  await expectRealTable(page, tier);
  await expect(page.locator('.stage-host canvas')).toHaveAttribute('data-same-canvas', 'yes');
  await expect(pane.locator('.stage-reset')).toHaveText('回到这一段');
  await expect(page.locator('.stage-caption')).toHaveAttribute('data-section', roadOf(route, target)!);
  const road = await stageReadout(page);
  console.log(`${tag}：按“${target}”的印，${Date.now() - since} 毫秒换到“${roadOf(route, target)}”；${road?.triangles} 个三角形，画 ${road?.drawCalls} 批`);
  expect(road!.triangles).toBeLessThanOrEqual(TRIANGLES_MAX);
  expect(road!.drawCalls).toBeLessThanOrEqual(DRAW_CALLS_MAX);

  // 走到下一站（底下那一条的“下一站”）：下一站也没有自己的沙盘的话，沙盘跟着换到下一段来路，还是这一块画布
  const next = page.locator('.guide-dock a[rel="next"]');
  const nextId = (await next.count()) > 0 ? ((await next.getAttribute('href')) ?? '').split('/').pop() ?? '' : '';
  if (nextId && sceneOnDisk(figureId, nextId) === null && roadOf(route, nextId)) {
    since = Date.now();
    await next.evaluate((link: HTMLElement) => link.click());
    await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', nextId);
    await expect(pane).toHaveAttribute('data-stage-section', roadOf(route, nextId)!, { timeout: SECTION_MS });
    await expectRealTable(page, tier);
    await expect(page.locator('.stage-host canvas')).toHaveAttribute('data-same-canvas', 'yes');
    const after = await stageReadout(page);
    console.log(`${tag}：走到下一站“${nextId}”，${Date.now() - since} 毫秒换到“${roadOf(route, nextId)}”；${after?.triangles} 个三角形，画 ${after?.drawCalls} 批`);
    expect(after!.triangles).toBeLessThanOrEqual(TRIANGLES_MAX);
    expect(after!.drawCalls).toBeLessThanOrEqual(DRAW_CALLS_MAX);
  } else console.log(`${tag}：“${target}”的下一站有自己的沙盘（或者没有下一站），“跟着换一段来路”这一步没有走`);

  // 站着不动一秒半，一帧都不再画（取两次读数，拿第二次的当起点：第一次自己可能补画一帧）
  await page.waitForTimeout(600);
  await stageReadout(page);
  const before = (await stageReadout(page))?.perf?.frames;
  expect(typeof before, '读数里没有“一共画了几帧”').toBe('number');
  await page.waitForTimeout(STANDING_STILL_MS);
  const still = (await stageReadout(page))?.perf?.frames;
  expect(still, `站着不动 ${STANDING_STILL_MS} 毫秒，全程沙盘又画了 ${(still ?? 0) - (before ?? 0)} 帧`).toBe(before);

  expect(problems).toEqual([]);
}

/** 全程那一节的题签都摆出来了；带印的每一条，量出来的框就是 stripSizes.ts 照字数和印的方数算的；点“今名”，字换了，大小还对。 */
async function sealedStripsMeasured(page: Page, route: RouteScene, whole: string): Promise<void> {
  const pane = stagePane(page);
  const paneWidth = await pane.evaluate((el: HTMLElement) => el.offsetWidth);
  const kind = stripSizeKind(paneWidth);
  const measured = async (): Promise<Record<string, { w: number; h: number; text: string; shown: boolean }>> =>
    Object.fromEntries(
      await page.locator('.stage-host .strip').evaluateAll((strips) =>
        (strips as HTMLElement[]).map((strip) => [strip.getAttribute('data-strip-id') ?? '', { w: strip.offsetWidth, h: strip.offsetHeight, text: strip.textContent ?? '', shown: getComputedStyle(strip).visibility === 'visible' }]),
      ),
    );
  await expect.poll(async () => Object.values(await measured()).filter((strip) => strip.shown).length, { message: '全程那一节的题签都摆出来' }).toBe(route.sections[0].strips.length);
  for (const names of ['ancient', 'modern'] as const) {
    if (names === 'modern') await pane.locator('.names-switch button').nth(1).click();
    const texts = stripTexts(route, whole, names);
    const sealed = texts.filter((text) => (text.stops?.length ?? 0) > 0);
    expect(sealed.length, '全程那一节要有带印的题签').toBeGreaterThan(0);
    await expect
      .poll(async () => {
        const got = await measured();
        return sealed.map((text) => `${text.text} ${got[text.id]?.w} × ${got[text.id]?.h}`);
      }, { message: `带印的题签的大小（${names === 'ancient' ? '古名' : '今名'}，${kind === 'wide' ? '大' : '小'}的一种）` })
      .toEqual(sealed.map((text) => `${text.text} ${stripSize(text.text, kind, text.stops!.length).w} × ${stripSize(text.text, kind, text.stops!.length).h}`));
    // 字换了：每一条都以这一种叫法的名字开头
    const got = await measured();
    for (const text of texts) expect(got[text.id].text.startsWith(text.text), `“${text.id}”写的是${names === 'ancient' ? '当时' : '今天'}的名字 ${text.text}`).toBe(true);
    if (names === 'ancient') console.log(`带印的题签（沙盘栏 ${paneWidth} 宽）：${sealed.map((text) => `${text.text} ${got[text.id].w} × ${got[text.id].h}`).join('，')}`);
  }
  // 换回古名：后面按印、换站，看的还是一打开的样子
  await pane.locator('.names-switch button').nth(0).click();
}

test('真的全程沙盘（完整的一档）在人物页上：摆得出来，三角形数和画几批在预算里；带印的题签量出来的大小就是题签的测试照着算的；今名换题签上的字；按一方印就到那一站，沙盘换到它的来路，走到下一站跟着再换；站着不动不再画', async ({ page }) => {
  test.setTimeout(300_000);
  await routeForced(page, 'full');
});

test('真的全程沙盘（减配的一档）在人物页上：摆出来的真是减配的一档，三角形数和画几批在预算里、比完整的一档少；按一方印就到那一站，沙盘换到它的来路；站着不动不再画', async ({ page }) => {
  test.setTimeout(300_000);
  await routeForced(page, 'reduced');
});

test('真的全程沙盘，不指定画质：时限之内要么摆好（哪一档都行），要么说一句“太慢”、换成图片；哪一种，按一方印都到那一站；页面不出错', async ({ page }) => {
  test.setTimeout(AUTO_MS + 120_000);
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const problems = watchProblems(page);
  const { figureId } = await openFigureWithTable(page, realUrl('#/', null, '&debug=1'));
  await needWebGL2(page);
  const route = routeOnDisk(figureId);
  if (env.CI) expect(route, '发布流程里没有找到全程沙盘：它一次也没有起来过，不能算通过').not.toBeNull();
  else test.skip(!route, '这位人物还没有全程沙盘');
  if (!route) return;
  const pane = stagePane(page);

  const from = Date.now();
  await expect(pane).toHaveAttribute('data-stage-level', 'route', { timeout: AUTO_MS });
  await expect(pane).toHaveAttribute('data-stage-state', /^(ready|slow)$/, { timeout: AUTO_MS });
  const took = Date.now() - from;
  const state = await pane.getAttribute('data-stage-state');
  const debugLine = (await pane.locator('.stage-debug').count()) > 0 ? ((await pane.locator('.stage-debug').first().textContent()) ?? '') : '';
  await expect(pane).toHaveAttribute('data-stage-section', route.sections[0].heading);

  if (state === 'ready') {
    await expect(pane).toHaveAttribute('data-stage-picture', 'table');
    await expect(pane).toHaveAttribute('data-stage-tier', /^(full|reduced)$/);
    await expect(page.locator('.stage-host canvas')).toHaveCount(1);
    const readout = await stageReadout(page);
    const perf = readout?.perf;
    expect(perf, '摆好的全程沙盘没有给画质的读数').toBeDefined();
    expect(perf?.tier).toBe(await pane.getAttribute('data-stage-tier'));
    expect(readout!.triangles).toBeLessThanOrEqual(TRIANGLES_MAX);
    expect(readout!.drawCalls).toBeLessThanOrEqual(DRAW_CALLS_MAX);
    console.log(`真的全程沙盘（自己挑）：${took} 毫秒以后摆好了，挑的是${perf ? TIER_NAME[perf.tier] : '？'}的一档，试画 ${perf?.trialMs ?? '？'} 毫秒；${readout?.triangles} 个三角形，画 ${readout?.drawCalls} 批。${debugLine}`);
  } else {
    // 太慢：说了那一句话，放着的是全程沙盘的图片（题签照样挂着，印照样按得动）；没有立体的沙盘留在页面上。只有用软件画的机器才走得到这一支。
    await expect(pane.locator('[role="status"] p').filter({ hasText: '立体的沙盘在这台设备上太慢' }).first()).toBeVisible();
    await expect(pane).toHaveAttribute('data-stage-picture', /^(still|none)$/);
    await expect(page.locator('.stage-host canvas')).toHaveCount(0);
    console.log(`真的全程沙盘（自己挑）：${took} 毫秒以后说“太慢”，放的是图片（这台机器连减配的一档也嫌慢）。${debugLine}`);
  }

  // 哪一种结果，印都通到那一站：按一方没有自己的沙盘的站的印，地址换了，栏里是它的来路
  await expect.poll(() => page.locator('.stage-pane .strip-seal').count(), { message: '题签脚上的印该挂出来' }).toBeGreaterThan(0);
  const target = (await page.locator('.stage-pane .strip-seal').evaluateAll((seals) => seals.map((seal) => seal.getAttribute('data-stop-id') ?? ''))).find((id) => sceneOnDisk(figureId, id) === null);
  expect(target, '要有一站还没有自己的沙盘').toBeDefined();
  if (!target) return;
  const box = (await page.locator(`.stage-pane .strip-seal[data-stop-id="${target}"]`).first().boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page).toHaveURL(new RegExp(`#/${figureId}/${target}`));
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', target);
  await expect(pane).toHaveAttribute('data-stage-section', roadOf(route, target)!, { timeout: SECTION_MS });
  await expect(pane).toHaveAttribute('data-stage-level', 'route');

  expect(problems).toEqual([]);
});

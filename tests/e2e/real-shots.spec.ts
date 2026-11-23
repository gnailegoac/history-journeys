// 用真沙盘给有沙盘的那一站每一小节拍一张照，再给人物页拍一张，存到 tests/shots/real/，供人看（不进仓库）。
// 平时不跑：设环境变量 REAL_SHOTS=1 才跑。没有显卡的机器上沙盘是用软件画的，所以每一步都等得久。
// 拍四种窗口，就是四种标准的画面：电脑（1440 × 900）、横着拿的平板（1024 × 768）、竖着拿的平板（768 × 1024）
// 和竖放的大平板（1024 × 1366，12.9 英寸的 iPad）。
// 只想拍一种，命令后面加 -g（照测试的名字挑）：-g "1440" 是电脑，-g "横着" 是横着拿的平板，-g "竖着" 是竖着拿的平板，
// -g "1366" 是竖放的大平板；-g "768" 两种小平板都拍，-g "1024" 三种平板都拍（名字里都有这个数）。
// 一种窗口大小只打开一次站点页：把各小节的标题一个个滚到“正在读”的位置，等沙盘换过去再拍，不重新加载。
// 文件名：<站>-<第几节>-<宽>x<高>.png，人物页是 figure-<宽>x<高>.png；
// 最后一节再拍一张点开“说明”的：<站>-<第几节>-<宽>x<高>-note.png。
//
// 另外三个环境变量：
//   STOP       拍哪一站（它的 id，如 huangzhou）。不设是第一个有沙盘的站。那一站没有场景文件就停下来，不悄悄拍别的。
//   SHOTS_DIR  存到哪个文件夹。不设是 tests/shots/real；想另存一套（留着对比）就设它。
//   TIER       用哪一档画质拍：不设是完整的一档（full）；设 reduced 拍减配的一档；
//              设 still 拍“只放图片”的样子（设备太慢、不摆立体沙盘时读者看到的：每一小节一张先拍好的图片，上面是页面上的题签）。
// 画质是在地址里指定的（?tier=），沙盘程序不会自己换档；每拍一张之前还要看一眼沙盘栏：放着的是立体的沙盘、
// 画质就是要的这一档。不然减配的一档、或者顶替沙盘的一张图片拍出来的照片，会被当成完整的沙盘拿去给人看。
// TIER=still 时反过来查：放着的是图片、这一节的那一张已经显出来、页面上没有画布；只拍每一小节（不拍人物页，不拍“说明”）。
// 例：REAL_SHOTS=1 TIER=reduced SHOTS_DIR=tests/shots/b-reduced npx playwright test tests/e2e/real-shots.spec.ts
//     REAL_SHOTS=1 STOP=huangzhou SHOTS_DIR=tests/shots/d-u1 npx playwright test tests/e2e/real-shots.spec.ts -g "1440"
//     REAL_SHOTS=1 TIER=still SHOTS_DIR=tests/shots/b-still npx playwright test tests/e2e/real-shots.spec.ts -g "1440"

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { StageTier } from '../../src/stage/types';
import type { StopScene } from '../../src/domain/scene';
import { expectRealTable, headingsOf, openFigureWithTable, realUrl, sceneOnDisk, scrollToSection, shoot, stagePane } from './helpers';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
// 存到哪：平时是 tests/shots/real；想另存一套（比如留着对比）就设 SHOTS_DIR。
const DIR = env.SHOTS_DIR ?? 'tests/shots/real';

/** 拍什么：立体的沙盘的哪一档，或者只放图片的样子。写了别的字就停下来，不悄悄当成完整的一档。 */
function tierToShoot(): StageTier | 'still' {
  const asked = env.TIER;
  if (asked === undefined || asked === '' || asked === 'full') return 'full';
  if (asked === 'reduced') return 'reduced';
  if (asked === 'still') return 'still';
  throw new Error(`环境变量 TIER 只能是 full、reduced 或 still，现在是“${asked}”`);
}

/** 拍哪一站：设了 STOP 就是那一站（没有场景文件就抛出错误），不设是打开人物页时找到的第一个有沙盘的站。 */
function stopToShoot(opened: { figureId: string; found: { stopId: string; scene: StopScene } | null }): { stopId: string; scene: StopScene } | null {
  const asked = env.STOP;
  if (asked === undefined || asked === '') return opened.found;
  const scene = sceneOnDisk(opened.figureId, asked);
  if (!scene) throw new Error(`环境变量 STOP 写的是“${asked}”，这一站没有场景文件`);
  return { stopId: asked, scene };
}

/**
 * 只放图片的那一种：沙盘栏放着的是这一小节的图片，图片已经显出来，页面上没有画布。
 * 拍之前要过这一关：不然图片还没显出来、或者其实摆着立体的沙盘，拍出来的照片会被当成“只放图片的样子”。
 */
async function expectStillPicture(page: Page, heading: string): Promise<void> {
  const pane = stagePane(page);
  await expect(pane).toHaveAttribute('data-stage-picture', 'still', { timeout: 120_000 });
  await expect(pane).toHaveAttribute('data-stage-section', heading, { timeout: 120_000 });
  await expect(page.locator('.stage-still-host .still-table')).toHaveAttribute('data-still-section', heading);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const img = document.querySelector<HTMLImageElement>('.stage-still-host .still-table img.is-top');
        return img !== null && img.complete && img.naturalWidth > 0;
      }),
    )
    .toBe(true);
  await expect(page.locator('canvas')).toHaveCount(0);
}

/** TIER=still：打开第一个有沙盘的站，一节一节等图片换过去再拍。 */
async function shootStills(page: Page, tag: string): Promise<void> {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`页面出错：${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(`控制台（${message.type()}）：${message.text()}`);
  });
  const found = stopToShoot(await openFigureWithTable(page, realUrl('#/', null, '&tier=still')));
  test.skip(!found, '还没有哪一站有沙盘');
  if (!found) return;
  const started = Date.now();
  await page.locator(`.stop-item[data-stop-id="${found.stopId}"]`).click();
  const headings = headingsOf(found.scene);
  await expectStillPicture(page, headings[0]);
  console.log(`[${tag}] 图片显出来用了 ${Date.now() - started} 毫秒（只放图片，不摆立体的沙盘），照片存到 ${DIR}/`);
  for (let i = 0; i < headings.length; i++) {
    if (i > 0) await scrollToSection(page, headings[i]);
    await expectStillPicture(page, headings[i]);
    // 再留一点时间：让题签摆稳
    await page.waitForTimeout(1_500);
    await expectStillPicture(page, headings[i]);
    await shoot(page, { path: `${DIR}/${found.stopId}-${i + 1}-${tag}.png` });
  }
  if (problems.length > 0) console.log(`[${tag}] 页面上的报错和警告：\n${problems.join('\n')}`);
}

test.skip(!env.REAL_SHOTS, '只在 REAL_SHOTS=1 时拍照');

/** 拍人物页，再打开第一个有沙盘的站，等沙盘摆好，一节一节拍。 */
async function shootEverything(page: Page, size: { width: number; height: number }): Promise<void> {
  const tier = tierToShoot();
  const tag = `${size.width}x${size.height}`;
  await page.setViewportSize(size);
  // 不要滑动的动画：拍的是每一节摆好以后的样子
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (tier === 'still') {
    await shootStills(page, tag);
    return;
  }

  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`页面出错：${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(`控制台（${message.type()}）：${message.text()}`);
  });

  const found = stopToShoot(await openFigureWithTable(page, realUrl('#/', tier)));

  // 人物页：等全程沙盘真的摆好再拍
  await expectRealTable(page, tier, 120_000);
  await page.waitForTimeout(600);
  await shoot(page, { path: `${DIR}/figure-${tag}.png` });

  test.skip(!found, '还没有哪一站有沙盘');
  if (!found) return;

  const started = Date.now();
  await page.locator(`.stop-item[data-stop-id="${found.stopId}"]`).click();
  const pane = stagePane(page);
  await expectRealTable(page, tier, 240_000);
  console.log(`[${tag}] 沙盘摆好用了 ${Date.now() - started} 毫秒（${tier === 'full' ? '完整' : '减配'}的一档），照片存到 ${DIR}/`);

  const headings = headingsOf(found.scene);
  for (let i = 0; i < headings.length; i++) {
    const from = Date.now();
    if (i > 0) await scrollToSection(page, headings[i]);
    await expect(pane).toHaveAttribute('data-stage-section', headings[i], { timeout: 120_000 });
    if (i > 0) console.log(`[${tag}] 换到“${headings[i]}”用了 ${Date.now() - from} 毫秒`);
    // 再留一点时间：让题签摆稳、画面画完
    await page.waitForTimeout(1_500);
    // 拍之前看一眼：放着的还是立体的沙盘，还是要的这一档
    await expectRealTable(page, tier);
    await shoot(page, { path: `${DIR}/${found.stopId}-${i + 1}-${tag}.png` });
  }

  // 最后一节：点开“说明”，拍一张完整的说明盖在沙盘上的样子。
  // （照着按钮的位置点，像手指那样；测试工具自己的“点这个元素”在点之前会把钉在顶上的沙盘栏滚回页面开头，读到的小节就变了。）
  const note = (await pane.locator('.stage-note-button').boundingBox())!;
  await page.mouse.click(note.x + note.width / 2, note.y + note.height / 2);
  await expect(pane.locator('.stage-note-panel')).toBeVisible();
  await expect(pane).toHaveAttribute('data-stage-section', headings[headings.length - 1]);
  await page.waitForTimeout(300);
  await expectRealTable(page, tier);
  await shoot(page, { path: `${DIR}/${found.stopId}-${headings.length}-${tag}-note.png` });
  await page.keyboard.press('Escape');
  await expect(pane.locator('.stage-note-panel')).toHaveCount(0);

  if (problems.length > 0) console.log(`[${tag}] 页面上的报错和警告：\n${problems.join('\n')}`);
}

test('宽屏 1440×900：人物页一张，每一小节一张', async ({ page }) => {
  test.setTimeout(1_200_000);
  await shootEverything(page, { width: 1440, height: 900 });
});

test('横着拿的平板 1024×768：人物页一张，每一小节一张', async ({ page }) => {
  test.setTimeout(1_200_000);
  await shootEverything(page, { width: 1024, height: 768 });
});

test('竖着拿的平板 768×1024：人物页一张，每一小节一张', async ({ page }) => {
  test.setTimeout(1_200_000);
  await shootEverything(page, { width: 768, height: 1024 });
});

// 名字里不写“竖着”两个字：-g "竖着" 只挑上面那一种。
test('大平板竖放 1024×1366：人物页一张，每一小节一张', async ({ page }) => {
  test.setTimeout(1_200_000);
  await shootEverything(page, { width: 1024, height: 1366 });
});

// 定格图是照页面的版面拍的：沙盘栏多大、四边留多少、底色是什么，都记在清单的 shapes 和 made.background 里。
// 版面改了（比如重做顺序第 2 步换了按钮和题记的高），存着的图就不是照现在的版面拍的，要重拍。
// 这里到页面上再量一遍，和清单比。量法和拍定格图的工具是同一个函数（tests/support/stillsTool.ts 的 readPaneLayout）：
// 带着沙盘的替身（?stage=fake）打开那一站，在 1440 × 900 和 768 × 1024（竖着拿的平板）两种窗口上，
// 量交给沙盘的容器（.stage-host）多大、页面让沙盘四边各留多少（替身记在 data-fake-insets 上）、沙盘栏的底色。
//
// 这座沙盘还没有定格图（没有清单）时，只查“量得出来、照这样量会拍出多大的图”，并把量到的数印出来。
// 清单和场景、程序对不对得上是 Node 里的事（tests/stage/stills-fresh.test.ts）。

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { StillManifest, StillShape } from '../../src/domain/stills';
import { fileSize, readBytes } from '../support/readBytes';
import { SHAPE_PLANS, readPaneLayout, sameLayout, shapeSpec, shotViewport, type PaneLayout } from '../support/stillsTool';
import { fakeUrl, sceneOnDisk, stagePane } from './helpers';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

const SHAPES: readonly StillShape[] = ['wide', 'narrow'];

/** 第一位人物和他第一个有沙盘的站（从首页和目录里找，和别的浏览器测试一样）。一个也没有时是 null。 */
async function firstTable(page: Page): Promise<{ figureId: string; stopId: string } | null> {
  await page.goto(fakeUrl('#/'));
  const card = page.locator('a.card[data-available="true"]').first();
  await expect(card).toBeVisible();
  const figureId = await card.getAttribute('data-figure-id');
  if (!figureId) throw new Error('人物卡片上没有 id');
  await card.click();
  await expect(page.locator('.stop-item').first()).toBeVisible();
  const stops = await page.locator('.stop-item[data-stop-status="complete"]').evaluateAll((items) => items.map((item) => item.getAttribute('data-stop-id')));
  for (const stopId of stops) {
    if (stopId && sceneOnDisk(figureId, stopId)) return { figureId, stopId };
  }
  return null;
}

/** content/ 里这一站定格图的清单；还没有时是 null。 */
function manifestOnDisk(figureId: string, stopId: string): StillManifest | null {
  const path = `content/figures/${figureId}/stills/${stopId}.json`;
  try {
    fileSize(path);
  } catch {
    return null;
  }
  return JSON.parse(new TextDecoder().decode(readBytes(path))) as StillManifest;
}

/** 在这种形状照着拍的窗口上打开这一站，等沙盘的替身摆好，量版面（连着两次量到一样才算数）。 */
async function measure(page: Page, shape: StillShape, figureId: string, stopId: string): Promise<PaneLayout> {
  const [width, height] = SHAPE_PLANS[shape].window;
  // 和工具一样：先把窗口定成这么大，再从头打开这一站（不是在已经打开的页面上改窗口的大小）
  await page.goto('about:blank');
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(fakeUrl(`#/${figureId}/${stopId}`));
  await expect(stagePane(page)).toHaveAttribute('data-stage-state', 'ready');
  let last: PaneLayout | null = null;
  for (let tries = 0; tries < 40; tries++) {
    await page.waitForTimeout(250);
    let now: PaneLayout;
    try {
      now = await readPaneLayout(page);
    } catch {
      last = null;
      continue;
    }
    if (last && sameLayout(last, now)) return now;
    last = now;
  }
  throw new Error(`${figureId}/${stopId} 在 ${width} × ${height} 的窗口上，版面一直在变，量不准`);
}

test('定格图是照现在的版面拍的：沙盘栏的大小、四边留的空、底色，和清单里记的一样', async ({ page }) => {
  const table = await firstTable(page);
  test.skip(!table, '还没有哪一站有沙盘');
  if (!table) return;
  const { figureId, stopId } = table;
  const manifest = manifestOnDisk(figureId, stopId);

  const layouts = { wide: await measure(page, 'wide', figureId, stopId), narrow: await measure(page, 'narrow', figureId, stopId) };
  for (const shape of SHAPES) {
    const layout = layouts[shape];
    const spec = shapeSpec(shape, layout);
    const { width, height } = shotViewport(spec);
    console.log(
      `${figureId}/${stopId} ${shape}（窗口 ${spec.window.join(' × ')}）：沙盘栏 ${layout.pane.join(' × ')}，四边留 ${layout.insets.join('、')}（上、右、下、左），底色 ${layout.background}；` +
        `照这样拍，左右各多拍 ${spec.extra}，图片 ${width * spec.pixelRatio} × ${height * spec.pixelRatio}`,
    );
    // 量得出来，而且照这样拍出来的图不超过 2048 像素、是整数个像素
    expect(layout.pane[0]).toBeGreaterThan(0);
    expect(layout.pane[1]).toBeGreaterThan(0);
    expect(Number.isInteger(width * spec.pixelRatio)).toBe(true);
    expect(width * spec.pixelRatio).toBeLessThanOrEqual(2048);
    expect(height * spec.pixelRatio).toBeLessThanOrEqual(2048);
    // 沙盘栏里留出来的那一块得有地方
    expect(layout.pane[0] - layout.insets[1] - layout.insets[3]).toBeGreaterThan(100);
    expect(layout.pane[1] - layout.insets[0] - layout.insets[2]).toBeGreaterThan(100);
  }
  expect(layouts.narrow.background, '两种窗口上沙盘栏的底色要一样').toBe(layouts.wide.background);

  // 定格图已经放进仓库了：发布流程里找不到清单算没通过（不能只查“量得出来”就过去）；自己的机器上新加的一座沙盘还没拍时，只查量得出来
  if (env.CI) expect(manifest, `发布流程里 ${figureId}/${stopId} 没有定格图的清单（content/figures/${figureId}/stills/${stopId}.json）`).not.toBeNull();
  if (!manifest) {
    console.log(`${figureId}/${stopId} 还没有定格图的清单：只查了量得出来。拍了以后这一项才拿清单来比。`);
    return;
  }
  const hint = '版面和拍定格图的时候不一样了。运行 STILLS_OUT=content/figures npm run stills 重拍（见 README），再提交。';
  for (const shape of SHAPES) {
    expect(shapeSpec(shape, layouts[shape]), `${shape}：${hint}`).toEqual(manifest.shapes[shape]);
  }
  expect(manifest.made.background.toLowerCase(), `沙盘栏的底色：${hint}`).toBe(layouts.wide.background);
});

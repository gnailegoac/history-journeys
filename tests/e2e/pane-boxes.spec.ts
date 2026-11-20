// 沙盘栏的大小和四边留的空，在四种标准的窗口上到真的页面上量一遍。
//
// 为什么要有这一项。题签摆不摆得下是在 Node 里照几个写好的数算的（tests/stage/scene-strips.test.ts）：
// 沙盘栏 940 × 900、584 × 768、768 × 573、1024 × 765，上、下各留 62 / 130、62 / 130、54 / 131、54 / 131。
// （最后一种是竖着拿的大平板，1024 × 1366：有 960 像素以上宽，可它是竖着的，沙盘在上、文字在下。）
// 拍定格图的工具却是到页面上现量的（tests/support/stillsTool.ts）。页面的样式要是把这几个数挪了
// （按钮那一排高了两像素、题记矮了一截、正文那一栏宽了），别的测试都不会红：定格图照新的数拍，
// 题签的测试照旧的数算，两边说的就不是同一个画面了。这里把这几个数钉在真的页面上。
//
// 数只写在一处：tests/stage/support/standardPanes.ts（题签的测试用的也是它）。
// 量法：带着沙盘的替身（?stage=fake）打开第一个有沙盘的站；沙盘栏量的是 .stage-pane 自己的框（连它一像素的边线），
// 取整数（offsetWidth、offsetHeight：竖着拿的平板上栏高是屏幕高度的 56%，573.44 像素，页面上摆东西用的是 573；
// 竖着拿的大平板上是 764.96 像素，用的是 765）；
// 四边留的空读替身记下来的 data-fake-insets（页面让沙盘留多少，它就记多少）。连着两次量到一样才算数。
//
// 重做顺序第 2 步换字体、换样子的每一个单元做完，这一项都要照旧通过；
// 只有存心改版面的时候（比如竖着拿的平板上把题记改矮），才去改 standardPanes.ts，那以后题签的测试和定格图都要重来。

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { STANDARD_PANES } from '../stage/support/standardPanes';
import type { StandardPane } from '../stage/support/standardPanes';
import { fakeUrl, openFigureWithTable, stagePane } from './helpers';

/** 页面上量到的：沙盘栏的宽、高（整数），不取整的原数，和替身记下来的“上 右 下 左”。 */
interface Measured {
  pane: string;
  exact: string;
  insets: string;
}

async function read(page: Page): Promise<Measured | null> {
  return page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('.stage-pane');
    const fake = document.querySelector('.fake-stage');
    if (!pane || !fake) return null;
    const box = pane.getBoundingClientRect();
    return { pane: `${pane.offsetWidth} × ${pane.offsetHeight}`, exact: `${box.width} × ${box.height}`, insets: fake.getAttribute('data-fake-insets') ?? '' };
  });
}

/** 在这种窗口上从头打开这一站，等替身摆好，量到连着两次一样为止。 */
async function measure(page: Page, pane: StandardPane, figureId: string, stopId: string): Promise<Measured> {
  // 先把窗口定成这么大，再从头打开（不是在打开着的页面上改窗口的大小）：和拍定格图的工具一样
  await page.goto('about:blank');
  await page.setViewportSize(pane.window);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(fakeUrl(`#/${figureId}/${stopId}`));
  await expect(stagePane(page)).toHaveAttribute('data-stage-state', 'ready');
  let last: Measured | null = null;
  for (let tries = 0; tries < 40; tries++) {
    await page.waitForTimeout(250);
    const now = await read(page);
    if (now && last && now.pane === last.pane && now.insets === last.insets) return now;
    last = now;
  }
  throw new Error(`${figureId}/${stopId} 在 ${pane.window.width} × ${pane.window.height} 的窗口上，沙盘栏一直在变，量不准`);
}

test('四种标准的窗口上，沙盘栏的大小和上下留的空，就是题签的测试照着算的那几个数', async ({ page }) => {
  const { figureId, found } = await openFigureWithTable(page, fakeUrl('#/'));
  test.skip(!found, '还没有哪一站有沙盘');
  if (!found) return;

  for (const pane of STANDARD_PANES) {
    const got = await measure(page, pane, figureId, found.stopId);
    const { top, right, bottom, left } = pane.insets;
    const where = `窗口 ${pane.window.width} × ${pane.window.height}`;
    console.log(`${figureId}/${found.stopId} ${where}：沙盘栏 ${got.pane}（不取整是 ${got.exact}），四边留 ${got.insets}（上 右 下 左）`);
    const hint = '页面的样式把沙盘栏的版面挪动了。不是存心改版面，就把样式改回来；存心改的，改 tests/stage/support/standardPanes.ts，再重跑题签的测试、重拍定格图。';
    expect(got.pane, `${where}，沙盘栏的大小。${hint}`).toBe(`${pane.size.width} × ${pane.size.height}`);
    expect(got.insets, `${where}，四边留的空（上 右 下 左）。${hint}`).toBe(`${top} ${right} ${bottom} ${left}`);
  }
});

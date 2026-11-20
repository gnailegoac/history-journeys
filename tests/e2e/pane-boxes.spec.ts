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
import { HOME_PANES, NOTICE_ROW_TOP, STANDARD_PANES, UPRIGHT_PANES } from '../stage/support/standardPanes';
import type { StandardPane } from '../stage/support/standardPanes';
import { fakeUrl, firstWrittenStopWithoutScene, openFigureWithTable, stagePane } from './helpers';

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

/** 在这种窗口上从头打开这一站（stopId 写 null 是人物页，写 'home' 是首页），等替身摆好，量到连着两次一样为止。 */
async function measure(page: Page, pane: StandardPane, figureId: string, stopId: string | null): Promise<Measured> {
  // 先把窗口定成这么大，再从头打开（不是在打开着的页面上改窗口的大小）：和拍定格图的工具一样
  await page.goto('about:blank');
  await page.setViewportSize(pane.window);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(fakeUrl(stopId === 'home' ? '#/' : stopId === null ? `#/${figureId}` : `#/${figureId}/${stopId}`));
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

test('全程沙盘在沙盘栏里和一站的沙盘一样：人物页、还没写的一站，四种标准的窗口上栏一样大、上下留一样的空；写好了却没有自己的沙盘的一站，上面多留一行话；首页的栏就是 HOME_PANES 里写的那几个数', async ({ page }) => {
  test.setTimeout(240_000);
  const { figureId } = await openFigureWithTable(page, fakeUrl('#/'));
  const noTable = await firstWrittenStopWithoutScene(page, figureId);
  const outline = await page.locator('.stop-item[data-stop-status="outline"]').first().getAttribute('data-stop-id');
  expect(outline, '要有一站还没写').not.toBeNull();
  const hint = '全程沙盘的定格图和题签的测试都是照这几个数做的（tests/stage/support/standardPanes.ts）。';

  for (const pane of STANDARD_PANES) {
    const { top, right, bottom, left } = pane.insets;
    const where = `窗口 ${pane.window.width} × ${pane.window.height}`;
    for (const [what, stopId] of [['人物页', null], ['还没写的一站', outline]] as const) {
      const got = await measure(page, pane, figureId, stopId);
      await expect(stagePane(page), `${where}，${what}：摆着的是全程沙盘`).toHaveAttribute('data-stage-level', 'route');
      console.log(`${what} ${where}：沙盘栏 ${got.pane}（不取整是 ${got.exact}），四边留 ${got.insets}（上 右 下 左）`);
      expect(got.pane, `${where}，${what}：沙盘栏的大小。${hint}`).toBe(`${pane.size.width} × ${pane.size.height}`);
      expect(got.insets, `${where}，${what}：四边留的空（上 右 下 左）。${hint}`).toBe(`${top} ${right} ${bottom} ${left}`);
      await expect(page.locator('.stage-notice'), `${where}，${what}：按钮下面没有那一行话`).toHaveCount(0);
    }
    // 首页：摆的是同一栏、同一座全程沙盘。宽屏上那页纸比人物页的宽，沙盘栏就窄一些（standardPanes.ts 的 HOME_PANES，
    // 题签的测试照它在 Node 里摆“全程”那一节）；沙盘在上的两种窗口上和人物页一模一样。
    const wanted = HOME_PANES.find((item) => item.window.width === pane.window.width && item.window.height === pane.window.height)!;
    const home = await measure(page, pane, figureId, 'home');
    await expect(stagePane(page), `${where}，首页：摆着的是全程沙盘`).toHaveAttribute('data-stage-level', 'route');
    console.log(`首页 ${where}：沙盘栏 ${home.pane}（不取整是 ${home.exact}），四边留 ${home.insets}（上 右 下 左）${home.pane === `${pane.size.width} × ${pane.size.height}` ? '，和人物页一样' : '——比人物页的窄'}`);
    const homeHint = '首页的沙盘栏挪动了。存心改的，改 tests/stage/support/standardPanes.ts 的 HOME_PANES，再重跑题签的测试（tests/stage/route-views.test.ts）。';
    expect(home.pane, `${where}，首页：沙盘栏的大小。${homeHint}`).toBe(`${wanted.size.width} × ${wanted.size.height}`);
    expect(home.insets, `${where}，首页：四边留的空（上 右 下 左）。${homeHint}`).toBe(`${wanted.insets.top} ${wanted.insets.right} ${wanted.insets.bottom} ${wanted.insets.left}`);
    await expect(page.locator('.stage-notice'), `${where}，首页：按钮下面没有那一行话`).toHaveCount(0);
    if (noTable) {
      const got = await measure(page, pane, figureId, noTable);
      await expect(page.locator('.stage-notice p')).toHaveText('这一站的沙盘还没做好，沙盘上是到这一站的来路。');
      // 那一行话只有一行：整句在栏里，没有折行（一行的高不到两行字）
      const line = await page.locator('.stage-notice p').evaluate((p) => ({ height: p.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(p).lineHeight), right: p.getBoundingClientRect().right, paneRight: document.querySelector('.stage-pane')!.getBoundingClientRect().right }));
      expect(line.height, `${where}，没有自己的沙盘的一站：那一行话折成了两行`).toBeLessThan(line.lineHeight * 1.5);
      expect(line.right, `${where}，没有自己的沙盘的一站：那一行话出了沙盘栏`).toBeLessThanOrEqual(line.paneRight);
      console.log(`没有自己的沙盘的一站（${noTable}）${where}：沙盘栏 ${got.pane}，四边留 ${got.insets}（上 右 下 左）`);
      expect(got.pane, `${where}，没有自己的沙盘的一站：沙盘栏的大小`).toBe(`${pane.size.width} × ${pane.size.height}`);
      const wantedTop = NOTICE_ROW_TOP[pane.name];
      const [gotTop, , gotBottom] = got.insets.split(' ').map(Number);
      expect(gotBottom, `${where}，没有自己的沙盘的一站：下面留的空`).toBe(bottom);
      // 四种标准的沙盘栏都写着这个数（题签的测试照它在 Node 里摆上面多一行说明的画面）
      expect(wantedTop, `${where}：standardPanes.ts 的 NOTICE_ROW_TOP 里要有 ${pane.name}`).not.toBeUndefined();
      expect(gotTop, `${where}，没有自己的沙盘的一站：上面连那一行话留的空。${hint}`).toBe(wantedTop);
    }
  }
});

test('别的竖着拿的平板（7.9 到 11 英寸）：人物页上沙盘栏的大小和上下留的空，就是 UPRIGHT_PANES 里写的；写好了却没有自己的沙盘的一站，上面多留的也是写的那个数', async ({ page }) => {
  // “全程”那一节的题签在这几种栏上最挤（屏幕越扁，沙盘越小）。tests/stage/route-views.test.ts 照这几个数在 Node 里摆，
  // 这里到真的页面上量：页面的样式挪了它们，那一组测试查的就不是读者看到的画面了。
  test.setTimeout(240_000);
  const { figureId } = await openFigureWithTable(page, fakeUrl('#/'));
  const noTable = await firstWrittenStopWithoutScene(page, figureId);
  const hint = '改 tests/stage/support/standardPanes.ts 的 UPRIGHT_PANES（和 NOTICE_ROW_TOP），再重跑 tests/stage/route-views.test.ts。';
  expect(UPRIGHT_PANES.length).toBeGreaterThanOrEqual(5);
  for (const pane of UPRIGHT_PANES) {
    const { top, right, bottom, left } = pane.insets;
    const where = `窗口 ${pane.window.width} × ${pane.window.height}`;
    const got = await measure(page, pane, figureId, null);
    await expect(stagePane(page), `${where}，人物页：摆着的是全程沙盘`).toHaveAttribute('data-stage-level', 'route');
    console.log(`人物页 ${where}：沙盘栏 ${got.pane}（不取整是 ${got.exact}），四边留 ${got.insets}（上 右 下 左）`);
    expect(got.pane, `${where}，人物页：沙盘栏的大小。${hint}`).toBe(`${pane.size.width} × ${pane.size.height}`);
    expect(got.insets, `${where}，人物页：四边留的空（上 右 下 左）。${hint}`).toBe(`${top} ${right} ${bottom} ${left}`);
    if (noTable) {
      const road = await measure(page, pane, figureId, noTable);
      await expect(page.locator('.stage-notice p')).toHaveCount(1);
      console.log(`没有自己的沙盘的一站（${noTable}）${where}：沙盘栏 ${road.pane}，四边留 ${road.insets}（上 右 下 左）`);
      expect(road.pane, `${where}，没有自己的沙盘的一站：沙盘栏的大小。${hint}`).toBe(`${pane.size.width} × ${pane.size.height}`);
      expect(road.insets, `${where}，没有自己的沙盘的一站：四边留的空（上面连那一行话）。${hint}`).toBe(`${NOTICE_ROW_TOP[pane.name]} ${right} ${bottom} ${left}`);
    }
  }
});

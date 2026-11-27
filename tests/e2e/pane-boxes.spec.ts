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
// 人物页和首页的栏带着时间轴（题记上面的一条，96 像素）：下面多留这一条，沙盘在上的窗口上栏也高出这一条——那几组数是 ROUTE_PANES、
// ROUTE_HOME_PANES、ROUTE_UPRIGHT_PANES。一站的页面上没有时间轴，一个数不动。
// 没有行迹的人物没有时间轴：他的人物页上的栏和一站的页面上的一样（文件末尾的一项量它）。
// 量法：带着沙盘的替身（?stage=fake）打开第一个有沙盘的站；沙盘栏量的是 .stage-pane 自己的框（连它一像素的边线），
// 取整数（offsetWidth、offsetHeight：竖着拿的平板上栏高是屏幕高度的 56%，573.44 像素，页面上摆东西用的是 573；
// 竖着拿的大平板上是 764.96 像素，用的是 765）；
// 四边留的空读替身记下来的 data-fake-insets（页面让沙盘留多少，它就记多少）。连着两次量到一样才算数。
//
// 重做顺序第 2 步换字体、换样子的每一个单元做完，这一项都要照旧通过；
// 只有存心改版面的时候（比如竖着拿的平板上把题记改矮），才去改 standardPanes.ts，那以后题签的测试和定格图都要重来。

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { BAR_BAND_PX, NOTICE_HEAD_PX, NOTICE_ROW_TOP, ROUTE_HOME_PANES, ROUTE_NOTICE_ROW_TOP, ROUTE_PANES, ROUTE_UPRIGHT_PANES, STANDARD_PANES, UPRIGHT_PANES, engineSize } from '../stage/support/standardPanes';
import type { StandardPane } from '../stage/support/standardPanes';
import { fakeUrl, firstUnwrittenStopWithoutScene, firstWrittenStopWithoutScene, openFigureWithTable, routeFiguresWithoutItinerary, stagePane, stopsWithScenes } from './helpers';

/** 页面上量到的：沙盘栏的宽、高（整数），不取整的原数，替身记下来的“上 右 下 左”，时间轴那一条多高（没有这一条是 0）。 */
interface Measured {
  pane: string;
  exact: string;
  insets: string;
  band: number;
}

async function read(page: Page): Promise<Measured | null> {
  return page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>('.stage-pane');
    const fake = document.querySelector('.fake-stage');
    if (!pane || !fake) return null;
    const box = pane.getBoundingClientRect();
    const band = pane.querySelector<HTMLElement>('.stage-bar');
    return { pane: `${pane.offsetWidth} × ${pane.offsetHeight}`, exact: `${box.width} × ${box.height}`, insets: fake.getAttribute('data-fake-insets') ?? '', band: band ? band.getBoundingClientRect().height : 0 };
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
    if (now && last && now.pane === last.pane && now.insets === last.insets && now.band === last.band) return now;
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

  // 有自己的沙盘、正文还没写的站（眉州）：栏和留的空同写好了的站一样，摆的是它自己的沙盘，按钮下面没有那一行话
  const unwritten = stopsWithScenes().find((one) => one.figureId === figureId && !one.written);
  if (!unwritten) return;
  for (const pane of STANDARD_PANES) {
    const got = await measure(page, pane, figureId, unwritten.stopId);
    const { top, right, bottom, left } = pane.insets;
    const where = `窗口 ${pane.window.width} × ${pane.window.height}，${unwritten.stopId}（正文还没写）`;
    console.log(`${figureId}/${unwritten.stopId} ${where}：沙盘栏 ${got.pane}（不取整是 ${got.exact}），四边留 ${got.insets}（上 右 下 左）`);
    await expect(stagePane(page), `${where}：摆着的是它自己的沙盘`).not.toHaveAttribute('data-stage-level', 'route');
    await expect(stagePane(page), `${where}：停在头一个画面`).toHaveAttribute('data-stage-section', unwritten.scene.sections[0].heading);
    expect(got.pane, `${where}，沙盘栏的大小`).toBe(`${pane.size.width} × ${pane.size.height}`);
    expect(got.insets, `${where}，四边留的空（上 右 下 左）`).toBe(`${top} ${right} ${bottom} ${left}`);
    await expect(page.locator('.stage-notice'), `${where}：按钮下面没有那一行话`).toHaveCount(0);
    // 正文那一栏：一句话说怎么用下面的单子，单子上是场景里的各处，头一处是摆着的
    await expect(page.locator('.not-written'), `${where}：正文那一栏`).toHaveText('这一站的正文还没写。按下面的一行，沙盘就换到那一处；各处的时间写在每一行里，不一定都在上面这几年里。');
    await expect(page.locator('.views .view-item'), `${where}：沙盘上看的几处`).toHaveCount(unwritten.scene.sections.length);
    await expect(page.locator('.views .view-item[aria-current="true"]'), `${where}：摆着的那一处`).toHaveAttribute('data-view', unwritten.scene.sections[0].heading);
  }
});

test('全程沙盘的栏：人物页的栏带着时间轴——四种标准的窗口上和一站的沙盘一样宽，下面多留一条时间轴的高，沙盘在上的两种窗口上栏也高出这一条；还没写又没有自己的沙盘的一站的页面上没有时间轴，栏和一站的沙盘一模一样；写好了却没有自己的沙盘的一站，上面多留一行话；首页的栏就是 ROUTE_HOME_PANES 里写的那几个数', async ({ page }) => {
  test.setTimeout(240_000);
  const { figureId } = await openFigureWithTable(page, fakeUrl('#/'));
  const noTable = await firstWrittenStopWithoutScene(page, figureId);
  // 还没写、也没有自己的沙盘的一站（还没写的站也可以有自己的沙盘——眉州——那样的站摆的不是全程沙盘，上一项量它）
  const outline = await firstUnwrittenStopWithoutScene(page, figureId);
  expect(outline, '要有一站还没写、也没有自己的沙盘').not.toBeNull();
  const hint = '全程沙盘的定格图和题签的测试都是照这几个数做的（tests/stage/support/standardPanes.ts）。';

  for (const [n, pane] of STANDARD_PANES.entries()) {
    const { top, right, bottom, left } = pane.insets;
    const where = `窗口 ${pane.window.width} × ${pane.window.height}`;
    // 还没写、也没有自己的沙盘的一站：摆的是全程沙盘，没有时间轴，栏和留的空同一站自己的沙盘一模一样
    {
      const got = await measure(page, pane, figureId, outline);
      await expect(stagePane(page), `${where}，还没写的一站：摆着的是全程沙盘`).toHaveAttribute('data-stage-level', 'route');
      console.log(`还没写的一站 ${where}：沙盘栏 ${got.pane}（不取整是 ${got.exact}），四边留 ${got.insets}（上 右 下 左），时间轴那一条 ${got.band}`);
      expect(got.pane, `${where}，还没写的一站：沙盘栏的大小。${hint}`).toBe(`${pane.size.width} × ${pane.size.height}`);
      expect(got.insets, `${where}，还没写的一站：四边留的空（上 右 下 左）。${hint}`).toBe(`${top} ${right} ${bottom} ${left}`);
      expect(got.band, `${where}，还没写的一站：没有时间轴的那一条`).toBe(0);
      await expect(page.locator('.stage-notice'), `${where}，还没写的一站：按钮下面没有那一行话`).toHaveCount(0);
    }
    // 人物页：带着时间轴。同一站的沙盘一样宽；下面多留的正是量到的那一条的高；沙盘在上的窗口上栏也高出这一条
    const withBar = ROUTE_PANES[n];
    {
      const got = await measure(page, pane, figureId, null);
      await expect(stagePane(page), `${where}，人物页：摆着的是全程沙盘`).toHaveAttribute('data-stage-level', 'route');
      console.log(`人物页 ${where}：沙盘栏 ${got.pane}（不取整是 ${got.exact}），四边留 ${got.insets}（上 右 下 左），时间轴那一条 ${got.band}`);
      expect(got.band, `${where}，人物页：时间轴那一条的高`).toBe(BAR_BAND_PX);
      const [gotWidth, gotHeight] = got.pane.split(' × ').map(Number);
      const [gotTop, , gotBottom] = got.insets.split(' ').map(Number);
      expect(gotWidth, `${where}，人物页：栏同一站的沙盘一样宽`).toBe(pane.size.width);
      expect(gotTop, `${where}，人物页：上面留的空同一站的沙盘一样`).toBe(top);
      expect(gotBottom, `${where}，人物页：下面比一站的沙盘多留一条时间轴的高`).toBe(bottom + got.band);
      expect([0, got.band], `${where}，人物页：栏同一站的沙盘一样高（左右排），或者高出一条时间轴（沙盘在上）`).toContain(gotHeight - pane.size.height);
      expect(got.pane, `${where}，人物页：沙盘栏的大小。${hint}`).toBe(`${withBar.size.width} × ${withBar.size.height}`);
      expect(got.insets, `${where}，人物页：四边留的空（上 右 下 左）。${hint}`).toBe(`${withBar.insets.top} ${withBar.insets.right} ${withBar.insets.bottom} ${withBar.insets.left}`);
      await expect(page.locator('.stage-notice'), `${where}，人物页：按钮下面没有那一行话`).toHaveCount(0);
    }
    // 首页：摆的是同一栏、同一座全程沙盘。宽屏上首页的文字栏比人物页的宽，沙盘栏就窄一些（standardPanes.ts 的 ROUTE_HOME_PANES，
    // 题签的测试照它在 Node 里摆每一节）；沙盘在上的两种窗口上和人物页一模一样。
    const wanted = ROUTE_HOME_PANES.find((item) => item.window.width === pane.window.width && item.window.height === pane.window.height)!;
    const home = await measure(page, pane, figureId, 'home');
    await expect(stagePane(page), `${where}，首页：摆着的是全程沙盘`).toHaveAttribute('data-stage-level', 'route');
    console.log(`首页 ${where}：沙盘栏 ${home.pane}（不取整是 ${home.exact}），四边留 ${home.insets}（上 右 下 左），时间轴那一条 ${home.band}${home.pane === `${withBar.size.width} × ${withBar.size.height}` ? '，和人物页一样' : '——比人物页的窄'}`);
    expect(home.band, `${where}，首页：时间轴那一条的高`).toBe(BAR_BAND_PX);
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

test('别的竖着拿的平板（7.9 到 11 英寸）：人物页上沙盘栏的大小和上下留的空，就是 ROUTE_UPRIGHT_PANES 里写的（带着时间轴：栏高出一条，下面多留一条）；写好了却没有自己的沙盘的一站没有时间轴，照 UPRIGHT_PANES，上面多留的也是写的那个数', async ({ page }) => {
  // “全程”那一节的题签在这几种栏上最挤（屏幕越扁，沙盘越小）。tests/stage/route-views.test.ts 照这几个数在 Node 里摆，
  // 这里到真的页面上量：页面的样式挪了它们，那一组测试查的就不是读者看到的画面了。
  test.setTimeout(240_000);
  const { figureId } = await openFigureWithTable(page, fakeUrl('#/'));
  const noTable = await firstWrittenStopWithoutScene(page, figureId);
  const hint = '改 tests/stage/support/standardPanes.ts 的 UPRIGHT_PANES（和 NOTICE_ROW_TOP），再重跑 tests/stage/route-views.test.ts。';
  expect(UPRIGHT_PANES.length).toBeGreaterThanOrEqual(5);
  for (const [n, pane] of UPRIGHT_PANES.entries()) {
    const { top, right, bottom, left } = pane.insets;
    const where = `窗口 ${pane.window.width} × ${pane.window.height}`;
    const withBar = ROUTE_UPRIGHT_PANES[n];
    const got = await measure(page, pane, figureId, null);
    await expect(stagePane(page), `${where}，人物页：摆着的是全程沙盘`).toHaveAttribute('data-stage-level', 'route');
    console.log(`人物页 ${where}：沙盘栏 ${got.pane}（不取整是 ${got.exact}），四边留 ${got.insets}（上 右 下 左），时间轴那一条 ${got.band}`);
    expect(got.band, `${where}，人物页：时间轴那一条的高`).toBe(BAR_BAND_PX);
    expect(got.pane, `${where}，人物页：沙盘栏的大小。${hint}`).toBe(`${withBar.size.width} × ${withBar.size.height}`);
    expect(got.insets, `${where}，人物页：四边留的空（上 右 下 左）。${hint}`).toBe(`${withBar.insets.top} ${withBar.insets.right} ${withBar.insets.bottom} ${withBar.insets.left}`);
    // 沙盘的那一块（栏的高减去上下留的空）同没有时间轴的时候一样大
    expect(withBar.size.height - withBar.insets.top - withBar.insets.bottom, `${where}：沙盘的那一块`).toBe(pane.size.height - top - bottom);
    if (noTable) {
      const road = await measure(page, pane, figureId, noTable);
      await expect(page.locator('.stage-notice p')).toHaveCount(1);
      console.log(`没有自己的沙盘的一站（${noTable}）${where}：沙盘栏 ${road.pane}，四边留 ${road.insets}（上 右 下 左）`);
      expect(road.pane, `${where}，没有自己的沙盘的一站：沙盘栏的大小。${hint}`).toBe(`${pane.size.width} × ${pane.size.height}`);
      expect(road.insets, `${where}，没有自己的沙盘的一站：四边留的空（上面连那一行话）。${hint}`).toBe(`${NOTICE_ROW_TOP[pane.name]} ${right} ${bottom} ${left}`);
    }
  }
});

test('读者在只放图片的时候点了“试试立体的沙盘”，按钮下面那一行话留着：人物页上（带着时间轴）沙盘上面再多留 36 像素，小像整个在那一行话下面；一站自己的沙盘上不多留；只放图片的时候也不多留', async ({ page }) => {
  test.setTimeout(240_000);
  const { figureId, found } = await openFigureWithTable(page, fakeUrl('#/'));
  test.skip(!found, '还没有哪一站有沙盘');
  if (!found) return;
  /** 替身记下来的“上面留多少”；连着两次量到一样才算数。 */
  const topInset = async (): Promise<number> => {
    let last: string | null = null;
    for (let tries = 0; tries < 40; tries++) {
      await page.waitForTimeout(250);
      const now = await page.evaluate(() => document.querySelector('.fake-stage')?.getAttribute('data-fake-insets') ?? null);
      if (now !== null && now === last) return Number(now.split(' ')[0]);
      last = now;
    }
    throw new Error('替身记下来的留边一直在变，量不准');
  };
  /** 那一行话看得见的那一截的下边（从沙盘栏的上边量）：多算的那 36 像素是透明的、裁掉了的，不算。 */
  const rowBottom = (): Promise<number> =>
    page.evaluate(() => {
      const pane = document.querySelector('.stage-pane')!.getBoundingClientRect();
      const row = document.querySelector('.stage-notice p')!.parentElement!;
      const box = row.getBoundingClientRect();
      return Math.round(box.bottom - parseFloat(getComputedStyle(row).borderBottomWidth) - pane.top);
    });
  for (const [n, pane] of STANDARD_PANES.entries()) {
    const where = `窗口 ${pane.window.width} × ${pane.window.height}`;
    for (const [what, hash, row, head] of [
      ['人物页', `#/${figureId}`, ROUTE_NOTICE_ROW_TOP[ROUTE_PANES[n].name], NOTICE_HEAD_PX],
      [`一站自己的沙盘（${found.stopId}）`, `#/${figureId}/${found.stopId}`, NOTICE_ROW_TOP[pane.name], 0],
    ] as const) {
      await page.goto('about:blank');
      await page.setViewportSize(pane.window);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      // 只放图片：按钮下面一行话，中间的按钮是“试试立体的沙盘”
      await page.goto(`/?stage=fake&tier=still&sectionstills=fake${hash}`);
      await expect(stagePane(page)).toHaveAttribute('data-stage-state', 'slow');
      await expect(stagePane(page)).toHaveAttribute('data-stage-picture', 'still');
      // 图片上没有小像：那一行话的方块就到它看得见的下边为止，下面不多算
      const extra = (): Promise<number> => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.stage-notice')!).borderBottomWidth));
      await expect.poll(extra, `${where}，${what}，只放图片：那一行话下面不多留`).toBe(0);
      await expect.poll(rowBottom, `${where}，${what}，只放图片：上面连那一行话留的空`).toBe(row);
      // 点了“试试立体的沙盘”：立体的沙盘摆上来，那一行话换成“设备慢的话，可以换回图片。”
      await page.locator('.stage-retry').click();
      await expect(stagePane(page)).toHaveAttribute('data-stage-state', 'ready');
      await expect(stagePane(page)).toHaveAttribute('data-stage-picture', 'table');
      await expect(page.locator('.stage-notice p')).toHaveText('设备慢的话，可以换回图片。');
      const got = await topInset();
      const seen = await rowBottom();
      console.log(`${what} ${where}，读者要来的立体沙盘：上面留 ${got}（那一行话看得见的下边在 ${seen}，下面给小像多留 ${got - seen}）`);
      expect(seen, `${where}，${what}：那一行话看得见的下边`).toBe(row);
      expect(got, `${where}，${what}：上面留的空`).toBe(row + head);
    }
  }
});

test('人物页上时间轴那一条里有没有东西（地址里写不写 ?bar=0：沙盘的替身上写了才摆时间轴）：四种标准的窗口上沙盘栏一样大，四边留的空一样，那一条一样高', async ({ page }) => {
  test.setTimeout(240_000);
  const { figureId } = await openFigureWithTable(page, fakeUrl('#/'));
  for (const [n, pane] of STANDARD_PANES.entries()) {
    const where = `窗口 ${pane.window.width} × ${pane.window.height}`;
    // 不写：那一条在，里面是空的（measure 是从头打开量的）
    const without = await measure(page, pane, figureId, null);
    await expect(page.locator('.stage-bar .bar'), `${where}：没写 ?bar= 的时候那一条里不该有东西`).toHaveCount(0);
    // 写了：那一段程序取来了，里面有了圆钮和两行字；再量一遍（量到连着两次一样）
    await page.goto('about:blank');
    await page.setViewportSize(pane.window);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(fakeUrl(`#/${figureId}`, '&bar=0'));
    await expect(stagePane(page)).toHaveAttribute('data-stage-state', 'ready');
    await expect(page.locator('.stage-bar .bar-thumb')).toHaveCount(1);
    let filled: Measured | null = null;
    let last: Measured | null = null;
    for (let tries = 0; tries < 40 && !filled; tries++) {
      await page.waitForTimeout(250);
      const now = await read(page);
      if (now && last && now.pane === last.pane && now.insets === last.insets && now.band === last.band) filled = now;
      last = now;
    }
    expect(filled, `${where}：写了 ?bar=0 以后量不准`).not.toBeNull();
    console.log(`人物页 ${where}：那一条空着的时候沙盘栏 ${without.pane}、四边留 ${without.insets}、那一条 ${without.band}；有东西的时候 ${filled?.pane}、${filled?.insets}、${filled?.band}`);
    expect(filled, `${where}：那一条里有了东西，沙盘栏、留的空、那一条的高都不该变`).toEqual(without);
    // 就是量过的那一种带着时间轴的栏
    const withBar = ROUTE_PANES[n];
    expect(without.pane, where).toBe(`${withBar.size.width} × ${withBar.size.height}`);
    expect(without.insets, where).toBe(`${withBar.insets.top} ${withBar.insets.right} ${withBar.insets.bottom} ${withBar.insets.left}`);
    expect(without.band, where).toBe(BAR_BAND_PX);
  }
});

// 沙盘程序拿到的画面比沙盘栏少栏自己的一条边线（它量的是放画面的那一块里面：clientWidth × clientHeight）。
// 题签的测试在 Node 里摆镜头、摆题签，用的就是少了这一条的数（tests/stage/support/standardPanes.ts 的 engineSize）：这里到真的页面上量。
test('放画面的那一块比沙盘栏少栏自己的一条边线（左右排的版面少在宽上，沙盘在上的版面少在高上）：四种标准的窗口上一站的页面、人物页、首页，别的竖着拿的平板上的人物页，没有行迹的人物的人物页，量到的都是 engineSize 算的那个数', async ({ page }) => {
  test.setTimeout(240_000);
  const { figureId, found } = await openFigureWithTable(page, fakeUrl('#/'));
  test.skip(!found, '还没有哪一站有沙盘');
  if (!found) return;
  /** 放画面的那一块里面多大：立体的沙盘那一层和图片那一层都盖满它，量到的要一样。 */
  const inner = (): Promise<string[]> =>
    page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.stage-canvas > .stage-host, .stage-canvas > .stage-still-host')].map((host) => `${host.clientWidth} × ${host.clientHeight}`));
  const check = async (what: string, wanted: StandardPane, measured: StandardPane, who: string, stopId: string | null): Promise<void> => {
    const got = await measure(page, measured, who, stopId);
    const where = `${what}，窗口 ${measured.window.width} × ${measured.window.height}`;
    expect(got.pane, `${where}：沙盘栏的大小`).toBe(`${wanted.size.width} × ${wanted.size.height}`);
    const { width, height } = engineSize(wanted);
    const layers = await inner();
    console.log(`${where}：沙盘栏 ${got.pane}，放画面的那一块里面 ${layers.join('、')}`);
    expect(layers.length, `${where}：放画面的那一块里的两层`).toBe(2);
    for (const layer of layers) expect(layer, `${where}：放画面的那一块里面（沙盘程序拿到的画面）`).toBe(`${width} × ${height}`);
    // 少的正是一条边线：一头少 1，另一头不少
    expect([wanted.size.width - width, wanted.size.height - height].sort(), where).toEqual([0, 1]);
  };
  for (const [n, pane] of STANDARD_PANES.entries()) {
    await check(`一站自己的沙盘（${found.stopId}）`, pane, pane, figureId, found.stopId);
    await check('人物页', ROUTE_PANES[n], pane, figureId, null);
    await check('首页', ROUTE_HOME_PANES[n], pane, figureId, 'home');
    for (const bare of routeFiguresWithoutItinerary()) await check(`没有行迹的人物（${bare}）的人物页`, pane, pane, bare, null);
  }
  for (const [n, pane] of UPRIGHT_PANES.entries()) await check('人物页', ROUTE_UPRIGHT_PANES[n], pane, figureId, null);
});

// 没有行迹的人物没有时间轴（docs/data-spec.md“谁要有行迹”）：他的人物页上的栏和一站的页面上的栏是一个样子。
// 题签的测试照这个查他的全程沙盘（tests/stage/route-views.test.ts 的 panesOf：不带时间轴的那几种）；这里到真的页面上量。
// 他的页面照地址打开：首页上有没有他的卡片、打不打得开，量到的都一样。
for (const figureId of routeFiguresWithoutItinerary()) {
  test(`没有行迹的人物（${figureId}）的人物页：四种标准的窗口上栏上不写 data-stage-bar、没有时间轴的那一条，沙盘栏的大小和上下留的空就是一站的页面上的那几个数（STANDARD_PANES）；读者点了“试试立体的沙盘”以后上面留的就是那一行话的高，不给小像多留`, async ({ page }) => {
    test.setTimeout(240_000);
    /** 替身记下来的“上面留多少”；连着两次量到一样才算数。 */
    const topInset = async (): Promise<number> => {
      let last: string | null = null;
      for (let tries = 0; tries < 40; tries++) {
        await page.waitForTimeout(250);
        const now = await page.evaluate(() => document.querySelector('.fake-stage')?.getAttribute('data-fake-insets') ?? null);
        if (now !== null && now === last) return Number(now.split(' ')[0]);
        last = now;
      }
      throw new Error('替身记下来的留边一直在变，量不准');
    };
    for (const pane of STANDARD_PANES) {
      const { top, right, bottom, left } = pane.insets;
      const where = `${figureId} 的人物页，窗口 ${pane.window.width} × ${pane.window.height}`;
      const got = await measure(page, pane, figureId, null);
      console.log(`${where}：沙盘栏 ${got.pane}（不取整是 ${got.exact}），四边留 ${got.insets}（上 右 下 左），时间轴那一条 ${got.band}`);
      await expect(stagePane(page), `${where}：摆着的是全程沙盘`).toHaveAttribute('data-stage-level', 'route');
      expect(await stagePane(page).getAttribute('data-stage-bar'), `${where}：栏上不写 data-stage-bar`).toBeNull();
      await expect(page.locator('.stage-bar'), `${where}：没有时间轴的那一条`).toHaveCount(0);
      expect(got.band, `${where}：时间轴那一条的高`).toBe(0);
      expect(got.pane, `${where}：沙盘栏的大小`).toBe(`${pane.size.width} × ${pane.size.height}`);
      expect(got.insets, `${where}：四边留的空（上 右 下 左）`).toBe(`${top} ${right} ${bottom} ${left}`);
      await expect(page.locator('.stage-notice'), `${where}：按钮下面没有那一行话`).toHaveCount(0);

      // 只放图片，再点“试试立体的沙盘”：那一行话留着，上面留的就到那一行话为止（NOTICE_ROW_TOP），没有另给小像的 36 像素
      await page.goto('about:blank');
      await page.setViewportSize(pane.window);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`/?stage=fake&tier=still&sectionstills=fake#/${figureId}`);
      await expect(stagePane(page)).toHaveAttribute('data-stage-state', 'slow');
      await expect(stagePane(page)).toHaveAttribute('data-stage-picture', 'still');
      expect(await stagePane(page).getAttribute('data-stage-bar'), `${where}，只放图片：栏上不写 data-stage-bar`).toBeNull();
      await page.locator('.stage-retry').click();
      await expect(stagePane(page)).toHaveAttribute('data-stage-state', 'ready');
      await expect(stagePane(page)).toHaveAttribute('data-stage-picture', 'table');
      await expect(page.locator('.stage-notice p')).toHaveText('设备慢的话，可以换回图片。');
      const row = NOTICE_ROW_TOP[pane.name];
      expect(row, `${where}：standardPanes.ts 的 NOTICE_ROW_TOP 里要有 ${pane.name}`).not.toBeUndefined();
      expect(await topInset(), `${where}，读者要来的立体沙盘：上面留的空`).toBe(row);
      await expect(page.locator('.stage-bar'), `${where}，读者要来的立体沙盘：没有时间轴的那一条`).toHaveCount(0);
      expect(await stagePane(page).evaluate((el) => `${(el as HTMLElement).offsetWidth} × ${(el as HTMLElement).offsetHeight}`), `${where}，读者要来的立体沙盘：沙盘栏的大小`).toBe(`${pane.size.width} × ${pane.size.height}`);
    }
  });
}

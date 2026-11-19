// 沙盘栏带着每一小节的图片（定格图）时的样子：图片先出来、沙盘盖上去；立体的沙盘摆不了时放图片、按钮下面一行话；
// 竖着拿的平板上那一行话只占一行、按钮排在一行里；题签的大小；浏览器太旧、页面的程序没取到时各一句话；?debug=1 的那一行读数。
// 沙盘和图片用的都是替身（?stage=fake…、?sectionstills=fake…）；各种状态里“谁先谁后、焦点落在哪”这些细处
// 在 Node 里测过了（tests/unit/page/pane-stills.test.tsx），这里看的是要有真的浏览器才看得出来的：版面、样式、网络请求。
// 末尾有两项不用替身：浏览器画不了时不去取沙盘程序；真沙盘上那一行读数是全的。

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { StopScene } from '../../src/domain/scene';
import { stripSize, stripSizeKind } from '../stage/support/stripSizes';
import { expectStageAt, fakeStage, firstStopWithScene, headingsOf, openFirstFigure, scrollToSection, stagePane, stripText, stripsOf, stripsOnStage } from './helpers';
import { PANE_QUERIES, PANE_SAYS, controlRows, expectPane, fakeStill, handOvers, inOneRow, notice, paneMeasures, stopUrl, stripsOnStill, watchHandOver } from './paneHelpers';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** 沙盘程序那一块代码的网址：构建出来叫 assets/engine-一串字符.js；对着开发服务跑时是源文件。 */
const ENGINE_REQUEST = /\/engine(-[\w-]+)?\.(js|ts)(\?.*)?$/;
/** 页面主程序的网址：构建出来叫 assets/index-一串字符.js；对着开发服务跑时是 src/main.tsx。 */
const MAIN_SCRIPT = /\/(assets\/index-[\w-]+\.js|src\/main\.tsx)(\?.*)?$/;

/** 第一个有沙盘的站。一个都没有时，这一项测试跳过。 */
async function findStop(page: Page): Promise<{ figureId: string; stopId: string; scene: StopScene; headings: string[] }> {
  const figureId = await openFirstFigure(page);
  const found = await firstStopWithScene(page, figureId);
  test.skip(found === null, '还没有带沙盘的站');
  const { stopId, scene } = found!;
  return { figureId, stopId, scene, headings: headingsOf(scene) };
}

/** 直接打开有沙盘的那一站，地址里带着 query 这一串开关；等正文出来。 */
async function openStop(page: Page, query: string) {
  const found = await findStop(page);
  await page.goto('about:blank');
  await page.goto(stopUrl(query, found.figureId, found.stopId));
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-text', 'written');
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-scene', 'yes');
  return found;
}

/** 这一小节该摆的题签（id 和字）。 */
function wantedStrips(scene: StopScene, heading: string, names: 'ancient' | 'modern') {
  return stripsOf(scene, heading).map((strip) => ({ id: strip.id, text: stripText(strip, names) }));
}

test('图片先出来（状态 1），沙盘摆好了盖着它显出来、图片拿走（状态 2）', async ({ page }) => {
  const { scene, headings } = await openStop(page, PANE_QUERIES.stillFirst);
  const pane = stagePane(page);
  const [first] = headings;

  // ---- 状态 1：沙盘还在摆（替身拖到 4 秒才报告摆好），放着的是图片；什么话都不说。
  await expectPane(page, 'loading', 'still');
  // 先把“沙盘盖上去的那一小会儿”盯上，后面才不会漏掉。
  await watchHandOver(page);
  await expect(pane).toHaveAttribute('data-stage-section', first);
  await expect(fakeStill(page)).toBeVisible();
  await expect(fakeStill(page)).toHaveAttribute('data-fake-still-section', first);
  await expect(pane.locator('.stage-says')).toBeEmpty();
  await expect(pane.locator('.stage-loading')).toHaveCount(0);
  await expect(pane.locator('.stage-caption')).toHaveAttribute('data-section', first);
  // 图片铺满放画面的那一块；上面那一层的沙盘还没显出来，手指和鼠标也穿过它。
  const paneBox = (await pane.boundingBox())!;
  const stillBox = (await fakeStill(page).boundingBox())!;
  // （宽屏上沙盘栏左边有一条一像素的边线，放画面的那一块比沙盘栏窄这一个像素）
  expect(paneBox.width - stillBox.width).toBeGreaterThanOrEqual(0);
  expect(paneBox.width - stillBox.width).toBeLessThanOrEqual(1);
  expect(stillBox.height).toBeCloseTo(paneBox.height, 0);
  await expect(fakeStage(page)).toHaveCount(1);
  const hostStyle = await pane.locator('.stage-host').evaluate((el) => ({ opacity: getComputedStyle(el).opacity, pointer: getComputedStyle(el).pointerEvents }));
  expect(hostStyle).toEqual({ opacity: '0', pointer: 'none' });
  // 图片上摆着这一节的题签；指北和比例尺是图片那一层报的（替身报的是 12 度、“5 公里”）。
  await expect.poll(() => stripsOnStill(page)).toEqual(wantedStrips(scene, first, 'ancient'));
  await expect(pane.locator('.stage-still-host .strip').first()).toBeVisible();
  await expect(pane.locator('.stage-north g')).toHaveAttribute('transform', 'rotate(12.0)');
  await expect(pane.locator('.stage-scale')).toContainText('5 公里');
  // 按钮都在：古名今名管用，“回到这一节”点不了。
  await expect(pane.locator('.stage-reset')).toBeDisabled();
  await page.getByRole('button', { name: '今名' }).click();
  await expect.poll(() => stripsOnStill(page)).toEqual(wantedStrips(scene, first, 'modern'));
  await page.getByRole('button', { name: '古名' }).click();
  // 图片四边留的空和沙盘的一样。
  expect(await fakeStill(page).getAttribute('data-fake-still-insets')).toBe(await fakeStage(page).getAttribute('data-fake-insets'));

  // ---- 状态 2：摆好了。盖上去的那一小会儿，图片上的题签藏着，沙盘那一层在慢慢显；显完了才算“放着的是沙盘”。
  await expectPane(page, 'ready', 'table');
  const seen = await handOvers(page);
  expect(seen).toHaveLength(1);
  expect(seen[0].stillStrips).toBe('hidden');
  expect(parseFloat(seen[0].fade)).toBeCloseTo(0.24, 2);
  expect(seen[0].picture).toBe('still');
  await expect(fakeStill(page)).toHaveCount(0);
  await expect(pane.locator('.stage-still-host')).toBeEmpty();
  await expect(pane.locator('.stage-canvas')).not.toHaveClass(/is-handing-over/);
  await expect(fakeStage(page)).toBeVisible();
  expect(await pane.locator('.stage-host').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await expect(page.locator('.strips')).toHaveCount(1);
  await expect.poll(() => stripsOnStage(page)).toEqual(wantedStrips(scene, first, 'ancient'));
  await expect(pane.locator('.stage-north g')).toHaveAttribute('transform', 'rotate(30.0)');
  await expect(pane.locator('.stage-says')).toBeEmpty();
  // 替身上的按钮现在点得到了（沙盘那一层显出来以后才接手指和鼠标）。
  await page.locator('.fake-stage-nudge').click();
  await expect(pane.locator('.stage-reset')).toBeEnabled();
});

test('浏览器画不了（状态 3）：一行话，没有按钮；图片跟着读到的小节换', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  const { scene, headings } = await openStop(page, PANE_QUERIES.unsupported);
  const pane = stagePane(page);
  await expectPane(page, 'unsupported', 'still');

  // 那一行话在一直都在的那一块里（读屏软件念得出来），只占一行；没有按钮，没有“回到这一节”。
  await expect(notice(page).locator('p')).toHaveText(PANE_SAYS.unsupported);
  await expect(pane.locator('.stage-says')).toHaveAttribute('role', 'status');
  await expect(pane.locator('.stage-message')).toHaveCount(0);
  await expect(pane.locator('.stage-retry')).toHaveCount(0);
  await expect(pane.locator('.stage-reset')).toHaveCount(0);
  await expect(pane.locator('.names-switch')).toBeVisible();
  await expect(fakeStage(page)).toHaveCount(0);
  expect(await page.locator('body').innerText()).not.toMatch(/webgl/i);
  await expect.poll(() => warnings.some((text) => text.includes('[沙盘]') && text.includes('no-webgl2'))).toBe(true);
  // 那一行话紧贴在按钮下面；它的下边就是页面告诉图片“上面留出多少”的那条线。
  const sizes = await paneMeasures(page);
  expect(sizes.noticeHeight).toBeLessThanOrEqual(36);
  expect(sizes.noticeCut).toBe(false);
  expect(sizes.insetTop).toBe(sizes.noticeBottom);
  const controlsBox = (await pane.locator('.stage-controls').boundingBox())!;
  const noticeBox = (await notice(page).boundingBox())!;
  expect(Math.abs(noticeBox.y - (controlsBox.y + controlsBox.height))).toBeLessThanOrEqual(1);
  // 这一行话连同上面那一排按钮，底下垫着一整条不透明的纸色，从栏顶起：图片是照这一行话下边以下的那一块摆的，
  // 不垫的话栏顶露一条空、按钮后面露一截图片。按钮压在这一条上面，照样点得到。
  const band = await notice(page).evaluate((el) => {
    const before = getComputedStyle(el, '::before');
    const paneTop = el.closest('.stage-pane')!.getBoundingClientRect().top;
    return { reach: parseFloat(before.height), top: el.getBoundingClientRect().top - paneTop, colour: getComputedStyle(el).backgroundColor, above: before.backgroundColor };
  });
  expect(Math.abs(band.reach - band.top)).toBeLessThanOrEqual(1);
  expect(band.colour).toMatch(/^rgb\(/);
  expect(band.above).toBe(band.colour);
  for (const button of await pane.locator('.stage-controls button:visible').all()) {
    expect(
      await button.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === el;
      }),
    ).toBe(true);
  }

  // 图片、题记、题签跟着读到的小节换；宽屏上这一栏照样占满一边不动。
  await expect(fakeStill(page)).toHaveAttribute('data-fake-still-section', headings[0]);
  if (headings.length > 2) {
    await scrollToSection(page, headings[2]);
    await expect(pane).toHaveAttribute('data-stage-section', headings[2]);
    await expect(fakeStill(page)).toHaveAttribute('data-fake-still-section', headings[2]);
    await expect(pane.locator('.stage-caption')).toHaveAttribute('data-section', headings[2]);
    await expect.poll(() => stripsOnStill(page)).toEqual(wantedStrips(scene, headings[2], 'ancient'));
  }
  expect((await pane.boundingBox())!.y).toBeCloseTo(0, 0);
  // 指北有角度，比例尺有字。
  await expect(pane.locator('.stage-north g')).toHaveAttribute('transform', 'rotate(12.0)');
  await expect(pane.locator('.stage-scale-label')).not.toBeEmpty();
});

test('画面断了（状态 5）、没摆出来（状态 6）：图片顶上来，一行话，按钮在那排按钮中间', async ({ page }) => {
  // ---- 状态 5
  const { figureId, stopId, headings } = await openStop(page, PANE_QUERIES.ready);
  const pane = stagePane(page);
  await expectStageAt(page, headings[0]);
  await expectPane(page, 'ready', 'table');
  await page.locator('.fake-stage-nudge').click();
  await pane.locator('.stage-reset').focus();
  await page.evaluate(() => document.querySelector<HTMLElement>('.fake-stage-lose')?.click());
  await expectPane(page, 'lost', 'still');
  await expect(notice(page).locator('p')).toHaveText(PANE_SAYS.lost);
  await expect(pane.locator('.stage-message')).toHaveCount(0);
  const rebuild = pane.locator('.stage-controls .stage-retry');
  await expect(rebuild).toHaveText(PANE_SAYS.rebuild);
  expect((await rebuild.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  // “回到这一节”换成了它，焦点跟过去。
  await expect(rebuild).toBeFocused();
  await expect(fakeStill(page)).toHaveAttribute('data-fake-still-section', headings[0]);
  await expect(pane.locator('.names-switch')).toBeVisible();
  // 按回车：图片垫着重摆，那一行话收掉；摆好了换回沙盘。焦点落在这一栏上。
  await page.keyboard.press('Enter');
  await expectPane(page, 'ready', 'table');
  await expect(notice(page)).toHaveCount(0);
  await expect(fakeStage(page)).toHaveCount(1);
  await expect(fakeStill(page)).toHaveCount(0);
  await expect(pane).toBeFocused();

  // ---- 状态 6
  await page.goto('about:blank');
  await page.goto(stopUrl(PANE_QUERIES.failed, figureId, stopId));
  await expectPane(page, 'failed', 'still');
  await expect(notice(page).locator('p')).toHaveText(PANE_SAYS.failed);
  const retry = pane.locator('.stage-controls .stage-retry');
  await expect(retry).toHaveText(PANE_SAYS.retry);
  await expect(pane.locator('.stage-message')).toHaveCount(0);
  await expect(fakeStill(page)).toBeVisible();
  await retry.click();
  await expectPane(page, 'failed', 'still');
  await expect(notice(page).locator('p')).toHaveText(PANE_SAYS.failed);
});

test.describe('竖着拿的平板（768×1024）', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('太慢（状态 4、4a）：那一行话只占一行，按钮排在一行里，放画面的地方够高；今名在图片上也管用', async ({ page }) => {
    const { scene, headings } = await openStop(page, PANE_QUERIES.slow);
    const pane = stagePane(page);
    await expectPane(page, 'slow', 'still');
    await expect(notice(page).locator('p')).toHaveText(PANE_SAYS.slow);
    await expect(fakeStage(page)).toHaveCount(0);

    // 这一栏钉在顶上，和摆着沙盘时一样高。
    const paneBox = (await pane.boundingBox())!;
    expect(paneBox.y).toBeCloseTo(0, 0);
    expect(paneBox.height).toBeGreaterThan(1024 * 0.54);
    expect(paneBox.height).toBeLessThan(1024 * 0.58);
    expect(await pane.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');

    // 那排按钮：古名、今名、试试立体的沙盘、收起沙盘，排在一行里，都够大。
    const rows = await controlRows(page);
    expect(rows.map((button) => button.text)).toEqual(['古名', '今名', PANE_SAYS.tryTable, '收起沙盘']);
    expect(inOneRow(rows)).toBe(true);
    for (const button of await pane.locator('.stage-controls button:visible').all()) {
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    // 那一行话：一行（最多 32 像素高），整句看得见；它的下边就是告诉图片“上面留出多少”的那条线；
    // 留出来放画面的地方至少 150 像素高。
    const sizes = await paneMeasures(page);
    expect(sizes.noticeHeight).toBeLessThanOrEqual(32);
    expect(sizes.noticeCut).toBe(false);
    expect(sizes.insetTop).toBe(sizes.noticeBottom);
    expect(sizes.free).toBeGreaterThanOrEqual(150);
    console.log(`竖着拿的平板上放着图片时：沙盘栏 ${sizes.paneHeight} 高，那一行话 ${sizes.noticeHeight} 高，上面留 ${sizes.insetTop}，下面留 ${sizes.insetBottom}，中间 ${sizes.free}`);
    // 这一行话连同上面那一排按钮，底下垫着一整条不透明的纸色，从栏顶起：图片是照这一行话下边以下的那一块摆的，
    // 不垫的话栏顶露一条空、按钮后面露一截图片。按钮压在这一条上面，照样点得到。
    const band = await notice(page).evaluate((el) => {
      const before = getComputedStyle(el, '::before');
      const paneTop = el.closest('.stage-pane')!.getBoundingClientRect().top;
      return { reach: parseFloat(before.height), top: el.getBoundingClientRect().top - paneTop, colour: getComputedStyle(el).backgroundColor, above: before.backgroundColor };
    });
    expect(Math.abs(band.reach - band.top)).toBeLessThanOrEqual(1);
    expect(band.colour).toMatch(/^rgb\(/);
    expect(band.above).toBe(band.colour);
    for (const button of await pane.locator('.stage-controls button:visible').all()) {
      expect(
        await button.evaluate((el) => {
          const box = el.getBoundingClientRect();
          return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === el;
        }),
      ).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // “说明”展开的那一块盖在图片上，不盖住那一行话，也不出沙盘栏。
    const noteButton = pane.locator('.stage-note-button');
    await noteButton.click();
    const panel = pane.locator('.stage-note-panel');
    await expect(panel).toBeVisible();
    const panelBox = (await panel.boundingBox())!;
    const lineBox = (await notice(page).boundingBox())!;
    expect(panelBox.y).toBeGreaterThanOrEqual(lineBox.y + lineBox.height - 1);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual((await pane.locator('.stage-caption').boundingBox())!.y);
    await noteButton.click();
    await expect(panel).toHaveCount(0);

    // 今名：图片上的题签换成今天的名字。
    await expect.poll(() => stripsOnStill(page)).toEqual(wantedStrips(scene, headings[0], 'ancient'));
    await page.getByRole('button', { name: '今名' }).click();
    await expect.poll(() => stripsOnStill(page)).toEqual(wantedStrips(scene, headings[0], 'modern'));
    await expect(fakeStill(page)).toHaveAttribute('data-fake-still-names', 'modern');
    // 图片上的题签和沙盘上的一样大：这一栏有 560 像素以上宽，用的是大的那一种。
    const strip = pane.locator('.stage-still-host .strip').first();
    await expect(strip).toBeVisible();
    expect(await strip.evaluate((el) => getComputedStyle(el).fontSize)).toBe('17px');

    // 收起：只留一排按钮，图片、那一行话、中间的按钮都不显出来；展开就都回来。
    const fold = pane.locator('.stage-fold');
    await fold.click();
    await expect(fold).toHaveText('展开沙盘');
    expect((await pane.boundingBox())!.height).toBeLessThan(80);
    await expect(fakeStill(page)).toBeHidden();
    await expect(notice(page)).toBeHidden();
    await expect(pane.locator('.stage-controls .stage-retry')).toBeHidden();
    await fold.click();
    await expect(fakeStill(page)).toBeVisible();
    await expect(notice(page)).toBeVisible();

    // ---- 4a：试试立体的沙盘。那一行话换成“可以换回图片”，句尾是按钮；还是一行，上面留的空没变。
    await pane.locator('.stage-controls .stage-retry').click();
    await expectPane(page, 'ready', 'table');
    await expect(fakeStage(page)).toHaveAttribute('data-fake-tier', 'reduced');
    await expect(fakeStage(page)).toHaveAttribute('data-fake-asked', 'true');
    await expect(notice(page).locator('p')).toHaveText(PANE_SAYS.asked);
    const back = notice(page).locator('.stage-notice-button');
    await expect(back).toHaveText(PANE_SAYS.back);
    await expect(back).toBeInViewport();
    const noticeBox = (await notice(page).boundingBox())!;
    expect(noticeBox.height).toBeLessThanOrEqual(32);
    const backBox = (await back.boundingBox())!;
    expect(backBox.x + backBox.width).toBeLessThanOrEqual(768);
    expect(backBox.y).toBeGreaterThanOrEqual(noticeBox.y);
    expect(backBox.y + backBox.height).toBeLessThanOrEqual(noticeBox.y + noticeBox.height);
    expect(Number(((await fakeStage(page).getAttribute('data-fake-insets')) ?? '').split(' ')[0])).toBe(sizes.insetTop);
    expect(inOneRow(await controlRows(page))).toBe(true);
    // 用键盘一个一个走：“换回图片”排在那一排按钮后面、题记里的“说明”前面，和屏幕上从上到下的先后一样。
    const tabOrder = await pane.locator('button:visible').evaluateAll((buttons) => buttons.map((button) => button.textContent ?? ''));
    expect(tabOrder.indexOf(PANE_SAYS.back)).toBeGreaterThan(tabOrder.indexOf('收起沙盘'));
    expect(tabOrder.indexOf(PANE_SAYS.back)).toBeLessThan(tabOrder.indexOf('说明'));
    // 换回图片：回到状态 4。
    await back.click();
    await expectPane(page, 'slow', 'still');
    await expect(notice(page).locator('p')).toHaveText(PANE_SAYS.slow);
    await expect(fakeStage(page)).toHaveCount(0);
  });

  test('地址里写了 ?tier=still（状态 4c）：只放图片，那句话在哪台设备上都是真话', async ({ page }) => {
    await openStop(page, PANE_QUERIES.only);
    await expectPane(page, 'slow', 'still');
    await expect(notice(page).locator('p')).toHaveText(PANE_SAYS.only);
    await expect(fakeStage(page)).toHaveCount(0);
    const sizes = await paneMeasures(page);
    expect(sizes.noticeHeight).toBeLessThanOrEqual(32);
    expect(sizes.noticeCut).toBe(false);
    expect(inOneRow(await controlRows(page))).toBe(true);
  });
});

// 题签有多大，Node 里的测试是照样式表算的（tests/stage/support/stripSizes.ts）。这里量真的题签来对：
// 样式改了（第 2 步要换字体）而那边的数没跟着改，这一项就红。
// 题签有两种大小：沙盘栏 560 像素以上宽用大的，不到的用小的。1440×900 和 768×1024 量的是大的；
// 小的那一种只有很窄的栏才用，拿 390×844 的窗口量（这一项不是为手机调什么，只是要一个够窄的栏）。
for (const size of [
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]) {
  test(`${size.width}×${size.height}：页面上真的题签，和 Node 里的测试当它有的大小一样`, async ({ page }) => {
    await page.setViewportSize(size);
    const { headings } = await openStop(page, 'stage=fake');
    await expectStageAt(page, headings[0]);
    const pane = stagePane(page);
    const kind = stripSizeKind((await pane.boundingBox())!.width);
    const measured = await pane.locator('.stage-host .strip').evaluateAll((strips) => strips.map((strip) => ({ text: strip.textContent ?? '', w: (strip as HTMLElement).offsetWidth, h: (strip as HTMLElement).offsetHeight })));
    expect(measured.length).toBeGreaterThan(0);
    for (const strip of measured) {
      const assumed = stripSize(strip.text, kind);
      // 页面上量出来的是凑成整数的，差一个像素不算。
      expect(Math.abs(strip.w - assumed.w), `“${strip.text}”宽 ${strip.w}，测试当它是 ${assumed.w}`).toBeLessThanOrEqual(1);
      expect(Math.abs(strip.h - assumed.h), `“${strip.text}”高 ${strip.h}，测试当它是 ${assumed.h}`).toBeLessThanOrEqual(1);
    }
  });
}

test('?debug=1：沙盘栏里印一行读数；不带就没有', async ({ page }) => {
  const { figureId, stopId, headings } = await openStop(page, 'stage=fake&debug=1');
  await expectStageAt(page, headings[0]);
  const line = stagePane(page).locator('.stage-debug');
  // 替身不给画质的读数，所以只有最后一段。
  await expect(line).toHaveText(/^摆好用了 \d+\.\d 秒$/);
  await expect(line).toBeVisible();
  // 它贴在题记的上边，不压着题记，也不出沙盘栏。
  const lineBox = (await line.boundingBox())!;
  const captionBox = (await stagePane(page).locator('.stage-caption').boundingBox())!;
  expect(lineBox.y + lineBox.height).toBeLessThanOrEqual(captionBox.y + 1);

  await page.goto('about:blank');
  await page.goto(stopUrl('stage=fake', figureId, stopId));
  await expectStageAt(page, headings[0]);
  await expect(stagePane(page).locator('.stage-debug')).toHaveCount(0);
});

test('页面的程序起不来时：显示一句话，不留一张白页——浏览器读不懂程序说“太旧”，程序没取到说“刷新一下”；平常不显示', async ({ page }) => {
  // 平常：程序起来了，没有那句话。
  await page.goto('/?stage=fake#/');
  await expect(page.locator('.card').first()).toBeVisible();
  await expect(page.locator('#too-old')).toHaveCount(0);

  // 很老的浏览器读不懂页面的主程序：程序一开头就出错（这里把主程序换成一句出错的话，效果一样），页面上什么都还没有。
  await page.goto('about:blank');
  await page.route(MAIN_SCRIPT, (route) => route.fulfill({ contentType: 'text/javascript', body: "throw new Error('这个浏览器读不懂这段程序');" }));
  await page.goto('/?stage=fake#/');
  const line = page.locator('#too-old');
  await expect(line).toHaveText(PANE_SAYS.tooOld);
  await expect(line).toBeVisible();
  await expect(page.locator('#root')).toBeEmpty();

  // 主程序没取到（网断了一下，或者网站刚更新、手里这一页指着的文件没有了）：不是浏览器旧，不叫读者换浏览器。
  await page.goto('about:blank');
  await page.unroute(MAIN_SCRIPT);
  await page.route(MAIN_SCRIPT, (route) => route.abort());
  await page.goto('/?stage=fake#/');
  await expect(line).toHaveText(PANE_SAYS.cut);
  await expect(line).toBeVisible();
  await expect(page.locator('#root')).toBeEmpty();

  // 网好了，刷新：程序起来，那句话没有了。
  await page.unroute(MAIN_SCRIPT);
  await page.reload();
  await expect(page.locator('.card').first()).toBeVisible();
  await expect(page.locator('#too-old')).toHaveCount(0);
});

test('浏览器画不了立体的沙盘时（走真的那条路）：放图片，沙盘程序不去取', async ({ page }) => {
  const { figureId, stopId } = await findStop(page);
  const engineRequests: string[] = [];
  page.on('request', (request) => {
    if (ENGINE_REQUEST.test(request.url())) engineRequests.push(request.url());
  });

  // 先对一对：浏览器画得了的时候，打开这一站是要去取沙盘程序的（不然下面“没有去取”说明不了什么）。
  await page.goto('about:blank');
  const hasWebGL2 = await page.evaluate(() => {
    try {
      return document.createElement('canvas').getContext('webgl2') !== null;
    } catch {
      return false;
    }
  });
  if (hasWebGL2) {
    await page.goto(stopUrl('sectionstills=fake&tier=full', figureId, stopId));
    await expect.poll(() => engineRequests.length, { timeout: 30_000 }).toBeGreaterThan(0);
  } else {
    test.info().annotations.push({ type: '说明', description: '这个浏览器本来就没有 WebGL2，没法先对一对“画得了时会去取沙盘程序”' });
  }

  // 把 WebGL2 关掉，再打开：图片照放，一行话，没有按钮；沙盘程序一次也没去取。
  await page.goto('about:blank');
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    const patched = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]): unknown {
      if (kind === 'webgl2') return null;
      return (original as unknown as (...args: unknown[]) => unknown).call(this, kind, ...rest);
    };
    HTMLCanvasElement.prototype.getContext = patched as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });
  engineRequests.length = 0;
  await page.goto(stopUrl('sectionstills=fake', figureId, stopId));
  await expectPane(page, 'unsupported', 'still');
  await expect(notice(page).locator('p')).toHaveText(PANE_SAYS.unsupported);
  await expect(stagePane(page).locator('.stage-retry')).toHaveCount(0);
  await expect(page.locator('canvas')).toHaveCount(0);
  await page.waitForTimeout(500);
  expect(engineRequests).toEqual([]);
});

// 第一次复查时有人担心：浏览器会记住“这一块取不到”，“再试一次”就成了一个按了没用的按钮。在 Chromium 上试过，它会再去取；
// 这一项把这件事钉住（走真的那条路：真的沙盘程序，真的图片）。
test('沙盘程序头一次没取到（网断了一下）：说一句、可以再试；点“再试一次”真的再去取一遍，沙盘摆出来', async ({ page }) => {
  test.setTimeout(200_000);
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { figureId, stopId } = await findStop(page);
  const hasWebGL2 = await page.evaluate(() => {
    try {
      return document.createElement('canvas').getContext('webgl2') !== null;
    } catch {
      return false;
    }
  });
  if (env.CI) expect(hasWebGL2, '发布流程的浏览器没有 WebGL2').toBe(true);
  else test.skip(!hasWebGL2, '这个浏览器没有 WebGL2');

  const engineRequests: string[] = [];
  page.on('request', (request) => {
    if (ENGINE_REQUEST.test(request.url())) engineRequests.push(request.url());
  });
  // 头一次去取沙盘程序，断掉；以后放行。
  let cut = 0;
  await page.goto('about:blank');
  await page.route(ENGINE_REQUEST, (route) => {
    if (cut === 0) {
      cut += 1;
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(stopUrl('tier=full', figureId, stopId));
  const pane = stagePane(page);
  await expect(pane).toHaveAttribute('data-stage-state', 'failed', { timeout: 30_000 });
  expect(engineRequests).toHaveLength(1);
  // 正文照常；沙盘栏里有一句话和“再试一次”（这座沙盘有图片的话，图片先顶着）。
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-text', 'written');
  const retry = pane.locator('.stage-retry');
  await expect(retry).toHaveText(PANE_SAYS.retry);
  await retry.click();
  await expect(pane).toHaveAttribute('data-stage-state', 'ready', { timeout: 120_000 });
  await expectPane(page, 'ready', 'table');
  await expect(pane).toHaveAttribute('data-stage-tier', 'full');
  expect(engineRequests).toHaveLength(2);
  await expect(page.locator('.stage-host canvas')).toHaveCount(1);
});

test('真沙盘上 ?debug=1 的那一行读数是全的：画质、像素比、试画、移动时每帧、摆好用了几秒', async ({ page }) => {
  test.setTimeout(200_000);
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const { figureId, stopId, headings } = await findStop(page);
  const hasWebGL2 = await page.evaluate(() => {
    try {
      return document.createElement('canvas').getContext('webgl2') !== null;
    } catch {
      return false;
    }
  });
  if (env.CI) expect(hasWebGL2, '发布流程的浏览器没有 WebGL2').toBe(true);
  else test.skip(!hasWebGL2, '这个浏览器没有 WebGL2');

  await page.goto('about:blank');
  // 指定完整的一档：不嫌慢，不往下降（这台机器和发布流程的机器都是用软件画的）。不放图片：只看沙盘。
  await page.goto(stopUrl('debug=1&tier=full&sectionstills=none', figureId, stopId));
  const pane = stagePane(page);
  await expect(pane).not.toHaveAttribute('data-stage-state', 'loading', { timeout: 120_000 });
  await expectPane(page, 'ready', 'table');
  await expect(pane).toHaveAttribute('data-stage-section', headings[0]);
  await expect(pane).toHaveAttribute('data-stage-tier', 'full');
  const line = pane.locator('.stage-debug');
  await expect(line).toHaveText(/^画质：完整；像素比 \d+(\.\d+)?；(试画 \d+ 毫秒|还没试画)；(移动时每帧 \d+ 毫秒|镜头还没移动过)；摆好用了 \d+\.\d 秒$/);
  console.log(`真沙盘的读数：${await line.textContent()}`);
});

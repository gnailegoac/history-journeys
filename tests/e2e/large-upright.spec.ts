// 竖着拿的大平板（1024 × 1366，12.9 英寸的 iPad）。窗口有 960 像素以上宽，可它是竖着的：版面照竖着拿的平板排——
// 沙盘在上（屏幕高度的 56%）、文字在下，沙盘能收起。横过来（1366 × 1024）才是文字在左、沙盘在右。
// 规矩写在样式的媒体查询里：窗口 960 像素以上宽、而且横着（宽比高大）才是左右两栏；页面的程序里用到同一句的只有一处
// （src/ui/StagePane.tsx 的 WIDE_SCREEN：只有上下排的时候能收起沙盘）。
//
// 一、排法：沙盘在上、文字在下；正文一行多宽、标题多大，和竖着拿的小平板（768 × 1024）一样；收起、横过来、再竖回去；
//     分界正好在哪（960 × 960 是上下排，961 × 960 是左右排）。用沙盘的替身（?stage=fake）。
//     沙盘栏多大、四边留多少，由 pane-boxes.spec.ts 守着（第四种标准的画面，tests/stage/support/standardPanes.ts）。
// 二、只放图片的时候（?tier=still，真的定格图）：这种窗口上放的是窄的那一张，左右铺满沙盘栏，每一节的题签一条不少。
//     每一节的题签在这块栏上摆不摆得下，Node 里已经算过（tests/stage/scene-strips.test.ts）；这里是到真的页面上再看一遍。

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { bigEnoughToTry } from '../../src/stage/three/tier';
import { STANDARD_PANES } from '../stage/support/standardPanes';
import { fileSize } from '../support/readBytes';
import { expectStageAt, fakeRequests, fakeStage, fakeUrl, firstStopWithScene, headingsOf, openFirstFigure, scrollToSection, stagePane, stripText, stripsOf } from './helpers';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

const UPRIGHT = { width: 1024, height: 1366 };
const SIDEWAYS = { width: 1366, height: 1024 };
const SMALL_UPRIGHT = { width: 768, height: 1024 };

/** 标准的画面里竖着拿的大平板那一种：沙盘栏多大、四边留多少，从写好的那一份里取。 */
function standardPane() {
  const pane = STANDARD_PANES.find((p) => p.window.width === UPRIGHT.width && p.window.height === UPRIGHT.height);
  if (!pane) throw new Error('tests/stage/support/standardPanes.ts 里没有 1024 × 1366 这一种窗口');
  return pane;
}

/** 页面现在是怎么排的。 */
interface Layout {
  /** 页面自己说的排法（layout.css 写在沙盘栏上的 --stage-shape）。 */
  shape: string;
  pane: { x: number; y: number; width: number; height: number; offsetHeight: number };
  reading: { x: number; y: number; width: number };
  /** 正文那一栏多宽，是字号的几倍。 */
  text: { width: number; ems: number; left: number; right: number };
  title: number;
  heading: number;
  fold: boolean;
  dock: { x: number; width: number; bottom: number };
  sideways: boolean;
}

async function layoutOf(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const need = <T extends Element>(selector: string): T => {
      const el = document.querySelector<T>(selector);
      if (!el) throw new Error(`页面上没有 ${selector}`);
      return el;
    };
    const pane = need<HTMLElement>('.stage-pane');
    const paneBox = pane.getBoundingClientRect();
    const reading = need('.reading').getBoundingClientRect();
    const inner = need('.reading-inner');
    const innerBox = inner.getBoundingClientRect();
    const size = (el: Element): number => parseFloat(getComputedStyle(el).fontSize);
    const dock = need('.guide-dock').getBoundingClientRect();
    return {
      shape: getComputedStyle(pane).getPropertyValue('--stage-shape').trim(),
      pane: { x: paneBox.x, y: paneBox.y, width: paneBox.width, height: paneBox.height, offsetHeight: pane.offsetHeight },
      reading: { x: reading.x, y: reading.y, width: reading.width },
      text: { width: innerBox.width, ems: innerBox.width / size(inner), left: innerBox.left - reading.left, right: reading.right - innerBox.right },
      title: size(need('.page-title')),
      heading: size(need('.section-heading')),
      fold: getComputedStyle(need('.stage-fold')).display !== 'none',
      dock: { x: dock.x, width: dock.width, bottom: dock.bottom },
      sideways: window.matchMedia('(orientation: landscape)').matches,
    };
  });
}

/** 等版面换成这一种排法（改了窗口的大小以后）。 */
async function expectShape(page: Page, shape: 'narrow' | 'wide'): Promise<Layout> {
  await expect.poll(async () => (await layoutOf(page)).shape).toBe(shape);
  return layoutOf(page);
}

test.describe('竖着拿的大平板（1024×1366）', () => {
  test.use({ viewport: UPRIGHT });

  test('沙盘在上、文字在下，和竖着拿的小平板一个排法；能收起；横过来才是左右两栏', async ({ page }) => {
    const figureId = await openFirstFigure(page);
    const found = await firstStopWithScene(page, figureId);
    test.skip(found === null, '还没有带沙盘的站');
    if (!found) return;
    const headings = headingsOf(found.scene);
    await page.goto('about:blank');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(fakeUrl(`#/${figureId}/${found.stopId}`));
    await expectStageAt(page, headings[0]);
    const pane = stagePane(page);
    const fake = fakeStage(page);
    const fold = pane.locator('.stage-fold');
    const standard = standardPane();
    const insetsText = (insets: { top: number; right: number; bottom: number; left: number }): string => `${insets.top} ${insets.right} ${insets.bottom} ${insets.left}`;

    // ---- 竖着：沙盘在最上面，和窗口一样宽，钉着不动；文字在它下面，铺满整个宽度
    const upright = await expectShape(page, 'narrow');
    expect(upright.sideways).toBe(false);
    expect(upright.pane.x, '沙盘栏的左边').toBe(0);
    expect(upright.pane.y, '沙盘栏的上边').toBe(0);
    expect(upright.pane.width, '沙盘栏和窗口一样宽').toBe(UPRIGHT.width);
    expect(upright.pane.offsetHeight, '沙盘栏的高').toBe(standard.size.height);
    // 屏幕高度的 56%（tokens.css 的 --stage-height-narrow；decisions.md 第 23 条）
    expect(Math.abs(upright.pane.height - UPRIGHT.height * 0.56)).toBeLessThan(1);
    await expect(pane).toHaveClass(/is-pinned/);
    expect(await pane.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
    expect(upright.reading.x, '正文那一页纸的左边').toBe(0);
    expect(upright.reading.width, '正文那一页纸和窗口一样宽').toBe(UPRIGHT.width);
    expect(upright.reading.y, '正文在沙盘栏下面').toBeGreaterThanOrEqual(upright.pane.height - 1);
    // 正文一行 30 个字，摆在纸的中间
    expect(Math.abs(upright.text.ems - 30), `正文一行 ${upright.text.ems.toFixed(1)} 个字，该是 30 个`).toBeLessThan(0.1);
    expect(Math.abs(upright.text.left - upright.text.right), '正文摆在纸的中间').toBeLessThan(1.5);
    // “收起沙盘”在；“问讲解员”那一条和窗口一样宽，贴着底边
    expect(upright.fold, '“收起沙盘”要在').toBe(true);
    await expect(fold).toHaveText('收起沙盘');
    expect(upright.dock.x, '“问讲解员”那一条的左边').toBe(0);
    expect(upright.dock.width, '“问讲解员”那一条和窗口一样宽').toBe(UPRIGHT.width);
    expect(Math.abs(upright.dock.bottom - UPRIGHT.height)).toBeLessThan(1);
    await expect(fake).toHaveAttribute('data-fake-insets', insetsText(standard.insets));
    // 这一栏够宽：题记是宽的排法，题签是大的那一种
    await expect(pane).toHaveClass(/is-wide/);
    await expect(pane).not.toHaveClass(/is-kai/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    // ---- 标题、小节标题多大，正文一行多宽：和竖着拿的小平板（768 × 1024）一样
    await page.setViewportSize(SMALL_UPRIGHT);
    const small = await expectShape(page, 'narrow');
    expect(small.pane.width).toBe(SMALL_UPRIGHT.width);
    expect({ title: upright.title, heading: upright.heading, text: Math.round(upright.text.width) }, '标题、小节标题的字号和正文一行的宽：大平板竖着拿，和小平板竖着拿一样').toEqual({
      title: small.title,
      heading: small.heading,
      text: Math.round(small.text.width),
    });
    await page.setViewportSize(UPRIGHT);
    await expectShape(page, 'narrow');
    await expect(fake).toHaveAttribute('data-fake-insets', insetsText(standard.insets));

    // ---- 文字滚动，沙盘留在原处；读到后面的一节，沙盘跟过去
    if (headings.length > 2) {
      await scrollToSection(page, headings[2]);
      await expectStageAt(page, headings[2]);
      expect((await layoutOf(page)).pane.y).toBe(0);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expectStageAt(page, headings[0]);
    }

    // ---- 收起：只留一排按钮。沙盘程序量到的容器是 1024 × 59，不够“试画”的那条线：不拿这么一窄条量设备的快慢
    await fold.click();
    await expect(fold).toHaveText('展开沙盘');
    await expect(fake, '收起以后沙盘不显出来').toBeHidden();
    await expect(pane.locator('.stage-foot'), '收起以后题记不显出来').toBeHidden();
    await expect(pane.locator('.names-switch')).toBeHidden();
    const folded = await layoutOf(page);
    expect(folded.pane.height).toBeGreaterThan(44);
    expect(folded.pane.height).toBeLessThan(80);
    const foldedHost = await pane.locator('.stage-host').evaluate((el) => ({ w: el.clientWidth, h: el.clientHeight }));
    expect(foldedHost).toEqual({ w: UPRIGHT.width, h: 59 });
    expect(bigEnoughToTry(foldedHost.w, foldedHost.h)).toBe(false);
    // 收着的时候读到后面的一节：沙盘看不见，不叫它白跑（页面的程序认得这是上下排的版面，才不叫它）；展开以后直接摆到读到的那一节
    if (headings.length > 2) {
      const requestsFolded = await fakeRequests(page);
      await scrollToSection(page, headings[2]);
      await page.waitForTimeout(600);
      expect(await fakeRequests(page), '收着的时候，沙盘又被叫去换小节了').toEqual(requestsFolded);
      await fold.click();
      await expect(fold).toHaveText('收起沙盘');
      await expect.poll(() => fakeRequests(page)).toEqual([...requestsFolded, headings[2]]);
      await expectStageAt(page, headings[2]);
      await page.evaluate(() => window.scrollTo(0, 0));
      await expectStageAt(page, headings[0]);
      await fold.click();
      await expect(fold).toHaveText('展开沙盘');
      await expect(fake).toBeHidden();
    }

    // ---- 收着的时候横过来：左右两栏，沙盘栏是整栏的，沙盘和题记照常显出来，没有“收起沙盘”
    await page.setViewportSize(SIDEWAYS);
    const sideways = await expectShape(page, 'wide');
    expect(sideways.sideways).toBe(true);
    await expect(fake).toBeVisible();
    await expect(pane.locator('.stage-foot')).toBeVisible();
    await expect(pane.locator('.names-switch')).toBeVisible();
    expect(sideways.fold).toBe(false);
    expect(sideways.reading.x).toBe(0);
    expect(sideways.pane.x).toBeGreaterThan(400);
    expect(Math.abs(sideways.pane.x - sideways.reading.width)).toBeLessThan(1);
    expect(Math.abs(sideways.pane.x + sideways.pane.width - SIDEWAYS.width)).toBeLessThan(1);
    expect(sideways.pane.y).toBe(0);
    expect(sideways.pane.height).toBe(SIDEWAYS.height);
    // “问讲解员”那一条只有文字栏那么宽
    expect(Math.abs(sideways.dock.width - sideways.reading.width)).toBeLessThan(1);
    // 四边留的空是左右排的那一种（和电脑、横着拿的小平板一样）
    const widePane = STANDARD_PANES.find((p) => p.window.width === 1440)!;
    await expect(fake).toHaveAttribute('data-fake-insets', insetsText(widePane.insets));
    // 标题按左右排的版面另定大小，和竖着的时候不一样
    expect(sideways.title).not.toBe(upright.title);

    // ---- 再竖回去：还收着；展开，回到原来那么高，四边留的空也回来
    await page.setViewportSize(UPRIGHT);
    await expectShape(page, 'narrow');
    await expect(fake).toBeHidden();
    await expect(fold).toHaveText('展开沙盘');
    await fold.click();
    await expect(fake).toBeVisible();
    await expect.poll(async () => (await layoutOf(page)).pane.offsetHeight).toBe(standard.size.height);
    await expect(fake).toHaveAttribute('data-fake-insets', insetsText(standard.insets));
    await expect(pane.locator('.stage-foot')).toBeVisible();

    // ---- 分界正好在哪：够宽（960 起）而且横着（宽比高大）才是左右两栏
    const cases: { size: { width: number; height: number }; shape: 'narrow' | 'wide' }[] = [
      { size: { width: 960, height: 960 }, shape: 'narrow' }, // 正方的不算横着
      { size: { width: 961, height: 960 }, shape: 'wide' },
      { size: { width: 960, height: 959 }, shape: 'wide' },
      { size: { width: 959, height: 700 }, shape: 'narrow' }, // 横着，但不够宽
      { size: { width: 1100, height: 1100 }, shape: 'narrow' },
      { size: { width: 1101, height: 1100 }, shape: 'wide' },
    ];
    for (const { size, shape } of cases) {
      await page.setViewportSize(size);
      const got = await expectShape(page, shape);
      const where = `窗口 ${size.width} × ${size.height}`;
      if (shape === 'narrow') {
        expect(got.pane.x, where).toBe(0);
        expect(got.pane.width, where).toBe(size.width);
        expect(got.reading.y, where).toBeGreaterThanOrEqual(got.pane.height - 1);
        expect(got.fold, where).toBe(true);
      } else {
        expect(got.pane.x, where).toBeGreaterThan(400);
        expect(got.pane.height, where).toBe(size.height);
        expect(got.reading.y, where).toBe(0);
        expect(got.fold, where).toBe(false);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), where).toBe(true);
    }
  });

  test('只放图片的时候：放的是窄的那一张，左右铺满沙盘栏，每一节的题签一条不少', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(`页面出错：${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') problems.push(`控制台报错：${message.text()}`);
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?tier=still#/');
    const card = page.locator('a.card[data-available="true"]').first();
    await expect(card).toBeVisible();
    const figureId = await card.getAttribute('data-figure-id');
    if (!figureId) throw new Error('人物卡片上没有 id');
    await card.click();
    await expect(page.locator('.stop-item').first()).toBeVisible();
    const found = await firstStopWithScene(page, figureId);
    test.skip(found === null, '还没有哪一站有沙盘');
    if (!found) return;
    const { stopId, scene } = found;
    // 定格图已经放进仓库了：发布流程里找不到算没通过；自己的机器上新加的一座沙盘还没拍时跳过
    let hasStills = true;
    try {
      fileSize(`content/figures/${figureId}/stills/${stopId}.json`);
    } catch {
      hasStills = false;
    }
    if (env.CI) expect(hasStills, `发布流程里 ${figureId}/${stopId} 没有定格图的清单`).toBe(true);
    else test.skip(!hasStills, `${figureId}/${stopId} 还没有定格图`);
    if (!hasStills) return;

    const headings = headingsOf(scene);
    const pane = stagePane(page);
    const wrapper = page.locator('.stage-still-host .still-table');
    await page.locator(`.stop-item[data-stop-id="${stopId}"]`).click();
    await expect(pane).toHaveAttribute('data-stage-picture', 'still');

    const lines: string[] = [];
    for (const [i, heading] of headings.entries()) {
      if (i > 0) await scrollToSection(page, heading);
      await expect(pane).toHaveAttribute('data-stage-section', heading);
      await expect(wrapper).toHaveAttribute('data-still-section', heading);
      // 竖着的版面：窄的那一张
      await expect(wrapper).toHaveAttribute('data-still-shape', 'narrow');
      const wanted = stripsOf(scene, heading).map((strip) => ({ id: strip.id, text: stripText(strip, 'ancient'), shown: true }));
      let seen: { src: string; loaded: boolean; left: number; right: number; width: number; natural: number; host: number; strips: { id: string; text: string; shown: boolean }[] } | null = null;
      await expect(async () => {
        seen = await page.evaluate(() => {
          const host = document.querySelector('.stage-still-host');
          const img = host?.querySelector<HTMLImageElement>('.still-table img.is-top');
          if (!host || !img) return null;
          const frame = host.getBoundingClientRect();
          const box = img.getBoundingClientRect();
          return {
            src: img.currentSrc || img.src,
            loaded: img.complete && img.naturalWidth > 0,
            left: box.left - frame.left,
            right: box.right - frame.left,
            width: box.width,
            natural: img.naturalWidth,
            host: host.clientWidth,
            strips: Array.from(host.querySelectorAll<HTMLElement>('.strip')).map((strip) => ({
              id: strip.getAttribute('data-strip-id') ?? '',
              text: strip.textContent ?? '',
              shown: getComputedStyle(strip).visibility === 'visible',
            })),
          };
        });
        expect(seen, `“${heading}”：页面上没有找到定格图`).not.toBeNull();
        expect(seen!.loaded, `“${heading}”：图片还没显出来`).toBe(true);
        expect(seen!.src, `“${heading}”`).toContain(`${stopId}-${i + 1}-narrow`);
        // 每一条题签都在，而且都摆出来了
        expect(seen!.strips, `“${heading}”的题签`).toEqual(wanted);
      }).toPass({ timeout: 20_000 });
      const got = seen!;
      // 左右铺满：图片的左边不在栏里面，右边不在栏里面（差不到半个像素不算）
      expect(got.host, `“${heading}”`).toBe(UPRIGHT.width);
      expect(got.left, `“${heading}”：图片的左边露出了底色`).toBeLessThanOrEqual(0.5);
      expect(got.right, `“${heading}”：图片的右边露出了底色`).toBeGreaterThanOrEqual(got.host - 0.5);
      lines.push(`  ${heading}：图片摆 ${Math.round(got.width)} 宽（原图 ${got.natural} 像素，一个页面像素合 ${(got.natural / got.width).toFixed(2)} 个图片像素），题签 ${got.strips.length} 条都摆出来了`);
    }
    console.log(`${figureId}/${stopId} 在 ${UPRIGHT.width} × ${UPRIGHT.height} 的窗口上只放图片：\n${lines.join('\n')}`);
    await expect(page.locator('canvas')).toHaveCount(0);
    expect(problems).toEqual([]);
  });
});

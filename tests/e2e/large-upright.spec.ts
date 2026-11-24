// 竖着拿的大平板（1024 × 1366，12.9 英寸的 iPad）。窗口有 960 像素以上宽，可它是竖着的：版面照竖着拿的平板排——
// 沙盘在上（屏幕高度的 56%）、文字在下，沙盘能收起。横过来（1366 × 1024）才是文字在左、沙盘在右。
// 规矩写在样式的媒体查询里：窗口 960 像素以上宽、而且横着（宽比高大）才是左右两栏；页面的程序里这一句只写在一处
// （src/ui/StagePane.tsx 的 WIDE_SCREEN），用它的有两处：只有上下排的时候能收起沙盘；这一句变了真假，就是版面换了排法（第三组）。
//
// 一、排法：沙盘在上、文字在下；正文一行多宽、标题多大，和竖着拿的小平板（768 × 1024）一样；收起、横过来、再竖回去；
//     分界正好在哪（960 × 960 是上下排，961 × 960 是左右排）。用沙盘的替身（?stage=fake）。
//     沙盘栏多大、四边留多少，由 pane-boxes.spec.ts 守着（第四种标准的画面，tests/stage/support/standardPanes.ts）。
// 二、只放图片的时候（?tier=still，真的定格图）：这种窗口上放的是窄的那一张，左右铺满沙盘栏，每一节的题签一条不少。
//     每一节的题签在这块栏上摆不摆得下，Node 里已经算过（tests/stage/scene-strips.test.ts）；这里是到真的页面上再看一遍。
// 三、把平板转个方向（768 × 1024 ⇄ 1024 × 768）：正文按另一种栏宽重排，页面把刚才读的那一小节的开头带回眼前，沙盘还摆着它；
//     同一种排法里窗口变大变小不带；没有小节的页面不带（src/ui/useReadingSection.ts）。用沙盘的替身。

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { bigEnoughToTry } from '../../src/stage/three/tier';
import { STANDARD_PANES } from '../stage/support/standardPanes';
import { fileSize } from '../support/readBytes';
import { expectStageAt, fakeRequests, fakeStage, fakeUrl, firstStopWithScene, headingsOf, openFirstFigure, sceneOnDisk, scrollToSection, stagePane, stopsWithScenes, stripText, stripsOf } from './helpers';

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
    expect(upright.reading.x, '文字栏的左边').toBe(0);
    expect(upright.reading.width, '文字栏和窗口一样宽').toBe(UPRIGHT.width);
    expect(upright.reading.y, '正文在沙盘栏下面').toBeGreaterThanOrEqual(upright.pane.height - 1);
    // 正文一行 30 个字，摆在文字栏的中间
    expect(Math.abs(upright.text.ems - 30), `正文一行 ${upright.text.ems.toFixed(1)} 个字，该是 30 个`).toBeLessThan(0.1);
    expect(Math.abs(upright.text.left - upright.text.right), '正文摆在文字栏的中间').toBeLessThan(1.5);
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

test.describe('把平板转个方向（768×1024 ⇄ 1024×768）：正文按另一种栏宽重排', () => {
  test.use({ viewport: SMALL_UPRIGHT });
  const TURNED = { width: SMALL_UPRIGHT.height, height: SMALL_UPRIGHT.width };

  /**
   * 页面自己把正文挪了几回（它把一小节带回眼前的时候，量好了要滚多少，叫 window.scrollBy；页面上别处不用它），
   * 每一回滚了多少像素，按先后记在页面上。测试自己滚页面用的是 scrollTo，不记在里面。
   */
  async function watchBroughtBack(page: Page): Promise<void> {
    await page.addInitScript(() => {
      const w = window as unknown as { __brought: number[] };
      w.__brought = [];
      const real = window.scrollBy.bind(window);
      window.scrollBy = ((...args: [number, number]): void => {
        w.__brought.push(Math.round(args[1]));
        real(...args);
      }) as typeof window.scrollBy;
    });
  }
  const brought = (page: Page): Promise<number[]> => page.evaluate(() => [...(window as unknown as { __brought: number[] }).__brought]);
  const forget = (page: Page): Promise<void> => page.evaluate(() => void ((window as unknown as { __brought: number[] }).__brought.length = 0));
  /** 带回来以后，那一小节的头在阅读线上面多远、或者它的尾在阅读线下面多远（像素；src/ui/useReadingSection.ts 的 BRING_BACK_GAP_PX）。 */
  const BRING_BACK_GAP_PX = 16;
  /** 页面自己说的排法（layout.css 写在沙盘栏上的 --stage-shape）。哪一种页面都问得了。 */
  const shapeOf = (page: Page): Promise<string> => stagePane(page).evaluate((pane) => getComputedStyle(pane).getPropertyValue('--stage-shape').trim());

  /**
   * 一小节现在在窗口里的哪里：它的开头（标题的上边）多高、它的尾多高；看得见正文的那一块从哪开始（沙盘栏在正文上面时是它的下边，在旁边时是 0）；
   * 阅读线多高（那一块里从上往下 42% 的地方；页面快滚到底的时候阅读线还要往下挪，和页面自己算的是同一个数——挪了没有记在 sliding 里）；
   * 后面那一小节的开头多高（没有就是 null）；阅读线离它上面最近的一个小节标题、离它下面最近的一个小节标题各多远
   *（above、below，像素；哪一边没有标题就是 null。标题在阅读线上面还是下面，和页面自己分的一样：比阅读线高的算上面）。
   */
  async function whereIs(page: Page, heading: string): Promise<{ top: number; bottom: number; textTop: number; line: number; sliding: boolean; next: number | null; above: number | null; below: number | null }> {
    return page.evaluate(
      ({ heading, part }) => {
        const all = Array.from(document.querySelectorAll<HTMLElement>('.text-section[data-section]'));
        const target = all.find((el) => el.dataset.section === heading);
        const pane = document.querySelector('.stage-pane');
        const text = document.querySelector('.stop-page');
        if (!target || !pane || !text) throw new Error(`页面上找不到这一小节：${heading}`);
        const after = all[all.indexOf(target) + 1];
        const paneBox = pane.getBoundingClientRect();
        const textBox = text.getBoundingClientRect();
        const above = paneBox.left < textBox.right && paneBox.right > textBox.left;
        const textTop = above ? Math.max(0, Math.min(paneBox.bottom, window.innerHeight)) : 0;
        // 页面往下还能滚多少：只剩最后一截的时候，阅读线从 42% 的地方挪向窗口的底边（src/ui/useReadingSection.ts 的 readingLine）
        const page = document.documentElement.scrollHeight;
        const left = page <= window.innerHeight ? Infinity : page - window.innerHeight - window.scrollY;
        const box = target.getBoundingClientRect();
        const base = textTop + (window.innerHeight - textTop) * part;
        const line = Math.max(base, window.innerHeight - Math.max(0, left));
        const tops = all.map((el) => el.getBoundingClientRect().top);
        const over = tops.filter((top) => top < line);
        const under = tops.filter((top) => top >= line);
        return {
          top: box.top,
          bottom: box.bottom,
          textTop,
          line,
          sliding: line > base + 0.5,
          next: after ? after.getBoundingClientRect().top : null,
          above: over.length > 0 ? line - Math.max(...over) : null,
          below: under.length > 0 ? Math.min(...under) - line : null,
        };
      },
      // 0.42：阅读线在那一块里从上往下的几成（src/ui/useReadingSection.ts 的 READING_LINE；helpers.ts 的 scrollThrough 也是这个数）
      { heading, part: 0.42 },
    );
  }

  /** 滚到一小节的正当中：它的中点落在阅读线上（标题早就滚上去了）。 */
  async function toMiddleOf(page: Page, heading: string): Promise<void> {
    const at = await whereIs(page, heading);
    await page.evaluate(
      ({ heading, line }) => {
        const target = Array.from(document.querySelectorAll<HTMLElement>('.text-section[data-section]')).find((el) => el.dataset.section === heading)!;
        const box = target.getBoundingClientRect();
        window.scrollTo(0, box.top + window.scrollY + box.height / 2 - line);
      },
      { heading, line: at.line },
    );
  }

  /**
   * 转一次方向：等版面换成这一种排法，再等页面画过两帧（“版面换了排法”这一下，浏览器是在画下一帧之前告诉页面的：
   * 样式表已经是新的排法了，页面可能还没有听到），再等过了“连着当上 150 毫秒才算读到”的那一阵。
   * 回来的是这一回页面自己把正文挪了几回、各多少。
   */
  async function turn(page: Page, size: { width: number; height: number }, shape: 'narrow' | 'wide'): Promise<number[]> {
    const before = (await brought(page)).length;
    await page.setViewportSize(size);
    await expectShape(page, shape);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await page.waitForTimeout(500);
    return (await brought(page)).slice(before);
  }

  test('把平板从竖着转成横着、再转回来：阅读线回到刚才读的那一小节里（快读完的时候带回的是它的尾，刚读到的时候带回的是它的头），沙盘还摆着那一小节；同一种排法里窗口变大变小，不动读者读到的地方；没有小节的页面（没有正文的一站、人物页）转了也不带', async ({ page }) => {
    const scene = sceneOnDisk('su-shi', 'xuzhou');
    if (!scene) throw new Error('content/ 里没有徐州的沙盘');
    const headings = headingsOf(scene);
    // 第三节后面还有小节：读到第三节正当中的时候，页面离滚到底还远
    expect(headings.length).toBeGreaterThan(3);
    const third = headings[2];
    await watchBroughtBack(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(fakeUrl('#/su-shi/xuzhou'));
    await expectStageAt(page, headings[0]);
    const pane = stagePane(page);
    const fake = fakeStage(page);
    await expectShape(page, 'narrow');
    const lines: string[] = [];

    /**
     * 转了一回以后：沙盘还摆着第三节，一路上也没有被叫去过别的小节；页面要么没有动（重排以后读者还在第三节里），
     * 要么只挪了一回——挪了的话，阅读线就回到了第三节里，而且挪得最少：重排以后落到了后面的小节上（读者刚才快读完第三节），
     * 第三节的尾在阅读线下面 16 像素，后面那一节的标题还在窗口里（读者眼前的东西没有全换掉）；落到了前面的小节上（读者刚才刚读到第三节），
     * 第三节的头在阅读线上面 16 像素（在看得见正文的那一块里面，钉着的沙盘栏没有挡住它）。回来的是带的是头还是尾。
     */
    const expectKept = async (what: string, did: number[], requestsBefore: string[]): Promise<'头' | '尾' | null> => {
      await expect(pane, what).toHaveAttribute('data-stage-section', third);
      await expect(fake, what).toHaveAttribute('data-fake-section', third);
      expect(await fakeRequests(page), `${what}：沙盘被叫去换过小节`).toEqual(requestsBefore);
      expect(did.length, `${what}：页面把正文挪了 ${did.length} 回（${did.join('、')}）`).toBeLessThanOrEqual(1);
      const at = await whereIs(page, third);
      lines.push(
        `  ${what}：${did.length > 0 ? `带回了第三节（挪了 ${did[0]} 像素）` : '没有动'}；第三节的开头在 ${Math.round(at.top)}、尾在 ${Math.round(at.bottom)}，后面那一节的开头在 ${Math.round(at.next ?? Number.NaN)}，看得见正文的那一块从 ${Math.round(at.textTop)} 开始，阅读线在 ${Math.round(at.line)}`,
      );
      expect(at.top, `${what}：第三节的开头过了阅读线才算还在读它`).toBeLessThan(at.line);
      expect(at.next, `${what}：后面那一节的开头还没过阅读线才算还在读第三节`).toBeGreaterThanOrEqual(at.line);
      if (did.length === 0) return null;
      if (did[0] < 0) {
        // 页面往回滚了：重排以后落到了后面的小节上，带回的是第三节的尾
        expect(Math.abs(at.bottom - (at.line + BRING_BACK_GAP_PX)), `${what}：带回来的该是第三节的尾，在阅读线下面 ${BRING_BACK_GAP_PX} 像素（尾在 ${at.bottom}，阅读线在 ${at.line}）`).toBeLessThanOrEqual(1);
        expect(at.next, `${what}：后面那一节的标题刚才在读者眼前，带回来以后该还在窗口里`).toBeLessThan(await page.evaluate(() => window.innerHeight));
        return '尾';
      }
      expect(Math.abs(at.top - (at.line - BRING_BACK_GAP_PX)), `${what}：带回来的该是第三节的头，在阅读线上面 ${BRING_BACK_GAP_PX} 像素（头在 ${at.top}，阅读线在 ${at.line}）`).toBeLessThanOrEqual(1);
      expect(at.top, `${what}：带回来的头该在看得见正文的那一块里面，没有被钉着的沙盘栏挡住`).toBeGreaterThan(at.textTop);
      return '头';
    };

    // ---- 竖着，读到第三节的正当中：标题早滚到沙盘栏后面去了，沙盘摆着第三节
    await toMiddleOf(page, third);
    await expectStageAt(page, third);
    const reading = await whereIs(page, third);
    expect(reading.top, '第三节的开头该已经滚到看得见正文的那一块上面去了（这一节太短的话，这一项查不到东西）').toBeLessThan(reading.textTop);
    expect(await brought(page)).toEqual([]);

    // ---- 三种读到的地方，各转过去、转回来：第三节的正当中；刚读到第三节（标题刚过阅读线 40 像素，重排以后最容易落回前一节）；
    //      快读完第三节（下一节的标题离阅读线还差 20 像素，重排以后最容易落到下一节）
    const times = { wide: 0, narrow: 0 };
    const ends = new Set<string>();
    for (const [where, go] of [
      ['读到第三节的正当中', () => toMiddleOf(page, third)],
      ['刚读到第三节', () => scrollToSection(page, third)],
      ['快读完第三节', () => scrollToSection(page, headings[3], -20)],
    ] as const) {
      for (const [how, size, shape] of [
        ['竖着转成横着', TURNED, 'wide'],
        ['横着转回竖着', SMALL_UPRIGHT, 'narrow'],
      ] as const) {
        // 先在现在这种排法里读到那个地方，沙盘摆着第三节；再转
        await go();
        await page.waitForTimeout(300);
        await expectStageAt(page, third);
        const requests = await fakeRequests(page);
        const did = await turn(page, size, shape);
        const end = await expectKept(`${where}，${how}`, did, requests);
        if (end) ends.add(end);
        times[shape] += did.length;
      }
    }

    // ---- 焦点在沙盘栏里的时候（刚用鼠标按过栏里的按钮）转回竖着：整页给钉着的栏留的那一截这时不算数（layout.css），
    //      带回来的地方照样对着栏下面的那条阅读线——要滚多少是页面自己量的，不靠那一截
    await page.setViewportSize(TURNED);
    await expectShape(page, 'wide');
    await scrollToSection(page, headings[3], -20);
    await page.waitForTimeout(300);
    await expectStageAt(page, third);
    const chosen = pane.locator('.names-switch button[aria-pressed="true"]');
    const chosenBox = (await chosen.boundingBox())!;
    await page.mouse.click(chosenBox.x + chosenBox.width / 2, chosenBox.y + chosenBox.height / 2);
    await expect(chosen).toBeFocused();
    const requestsFocused = await fakeRequests(page);
    const focused = await turn(page, SMALL_UPRIGHT, 'narrow');
    expect(focused.length, '焦点在栏里的这一回，重排以后读者还在第三节里，页面不用带：这一步查不到东西，换一个读到的位置').toBe(1);
    expect(await expectKept('快读完第三节、焦点在沙盘栏里，横着转回竖着', focused, requestsFocused)).toBe('尾');

    const back = await whereIs(page, third);
    expect(back.textTop, '竖着的时候看得见正文的那一块从沙盘栏的下边开始').toBeGreaterThan(0);

    // 两个方向各至少有一回，重排以后阅读线上换成了别的小节、是页面把第三节带回来的：不然那个方向上什么也没有查到
    //（转成竖着的那一回，带回来的开头要摆在钉着的沙盘栏下面，上面 expectKept 里查了）
    console.log(`把平板转个方向，读着“${third}”：\n${lines.join('\n')}`);
    expect(times.wide, '转成横着的几回，重排以后读者都还在第三节里，页面一回也不用带：这个方向查不到“带回来”，换一个读到的位置').toBeGreaterThan(0);
    expect(times.narrow, '转回竖着的几回，重排以后读者都还在第三节里，页面一回也不用带：这个方向查不到“带回来”，换一个读到的位置').toBeGreaterThan(0);
    // 带回头的和带回尾的各至少有一回：不然“快读完的时候带回的是尾”“刚读到的时候带回的是头”有一样没有查到
    expect([...ends].sort(), '带回头的、带回尾的各该至少有一回').toEqual(['头', '尾'].sort());

    // ---- 同一种排法里窗口变大变小（还是上下排）：页面不去带，第三节的开头还在上面，没有被拉回来
    await toMiddleOf(page, third);
    await expect.poll(async () => (await whereIs(page, third)).top).toBeLessThan(back.textTop);
    const sofar = await brought(page);
    await page.setViewportSize({ width: SMALL_UPRIGHT.width + 40, height: SMALL_UPRIGHT.height - 40 });
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(SMALL_UPRIGHT.width + 40);
    await expectShape(page, 'narrow');
    await page.waitForTimeout(500);
    const resized = await whereIs(page, third);
    expect(resized.top, '同一种排法里拉了拉窗口，页面把第三节的开头拉回了眼前').toBeLessThan(resized.textTop);
    expect(await brought(page), '同一种排法里拉了拉窗口，页面不该去带').toEqual(sofar);
    await expect(pane).toHaveAttribute('data-stage-section', third);

    // ---- 同一种排法里把窗口压矮了一大截，阅读线落到了前面的小节上：页面也不带（带回来只在换排法的时候做），沙盘照旧跟着阅读线走
    await page.setViewportSize(SMALL_UPRIGHT);
    await expectShape(page, 'narrow');
    await scrollToSection(page, third);
    await page.waitForTimeout(300);
    await expectStageAt(page, third);
    await page.setViewportSize({ width: SMALL_UPRIGHT.width, height: 600 });
    await expect.poll(() => page.evaluate(() => window.innerHeight)).toBe(600);
    await expectShape(page, 'narrow');
    await page.waitForTimeout(500);
    const squashed = await whereIs(page, third);
    expect(squashed.top, '窗口压矮以后第三节的开头还在阅读线上面：这一步查不到东西，换一个窗口的高').toBeGreaterThanOrEqual(squashed.line);
    expect(await brought(page), '同一种排法里把窗口压矮了，页面不该去带').toEqual(sofar);
    await expect(pane, '阅读线到了前面的小节上，沙盘跟过去').not.toHaveAttribute('data-stage-section', third);

    // ---- 页面在最上面（还没读到哪一小节的标题）：转了方向不把这一站的标题和抬头滚走
    await page.setViewportSize(SMALL_UPRIGHT);
    await expectShape(page, 'narrow');
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectStageAt(page, headings[0]);
    const top = (await brought(page)).length;
    expect(await turn(page, TURNED, 'wide'), '页面在最上面，转成横着').toEqual([]);
    expect(await page.evaluate(() => window.scrollY), '页面在最上面，转成横着以后被滚走了').toBe(0);
    expect(await turn(page, SMALL_UPRIGHT, 'narrow'), '页面在最上面，转回竖着').toEqual([]);
    expect(await page.evaluate(() => window.scrollY), '页面在最上面，转回竖着以后被滚走了').toBe(0);
    expect((await brought(page)).length).toBe(top);
    await expect(pane).toHaveAttribute('data-stage-section', headings[0]);

    // ---- 没有小节的页面：有沙盘、没有正文的一站，和人物页。转过去、转回来，页面什么也不带
    const leaf = stopsWithScenes().find((stop) => !stop.written);
    for (const [what, hash] of [
      ['有沙盘、没有正文的一站', leaf ? `#/${leaf.figureId}/${leaf.stopId}` : null],
      ['人物页', '#/su-shi'],
    ] as const) {
      if (hash === null) continue;
      await page.setViewportSize(SMALL_UPRIGHT);
      await page.goto(fakeUrl(hash));
      await expect(pane, what).toHaveAttribute('data-stage-state', 'ready');
      await expect.poll(() => shapeOf(page), what).toBe('narrow');
      await page.evaluate(() => window.scrollTo(0, 200));
      await forget(page);
      await page.setViewportSize(TURNED);
      await expect.poll(() => shapeOf(page), what).toBe('wide');
      await page.waitForTimeout(300);
      await page.setViewportSize(SMALL_UPRIGHT);
      await expect.poll(() => shapeOf(page), what).toBe('narrow');
      await page.waitForTimeout(300);
      expect(await brought(page), `${what}：没有小节，转了方向页面不该带什么到眼前`).toEqual([]);
    }
  });

  test('短的小节转了方向也留得住：每一小节刚读到、快读完的时候把平板转过去再转回来，沙盘都还摆着它，正文也没有往后挪一节（黄州在小平板上，徐州和黄州在大平板上；页面快滚到底、阅读线已经在往下挪的那一截里也一样）', async ({ page }) => {
    test.setTimeout(240_000);
    await watchBroughtBack(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const pane = stagePane(page);
    const lines: string[] = [];
    const problems: string[] = [];
    // 带回来的时候会碰上“小节比阅读线上面的地方还短”的有几回：一回也没有，这一项就什么也没查到
    let short = 0;
    let came = 0;
    // 页面快滚到底的那一截（转之前或者转之后阅读线已经在往下挪）：正文滚多少，阅读线自己也跟着挪多少，页面量要滚多少的时候是把这一挪算进去的。
    // 这一截里的每一回和别处的一样查。另外记下来：转了几回、页面带了几回（一回也没有带，这一截就什么也没查到）、沙盘换到了别的小节的有几回（该是 0）。
    // 每一回转完以后，阅读线离上面、下面最近的小节标题各多远，都写在那一行里：不同的机器排出来的字差几个像素，离得太近的一回在别的机器上可能落到另一边。
    const atTheEnd = { turns: 0, came: 0, off: 0 };
    // 只记下来、不拿它判对错的一回（就这一回，在页面快滚到底的那一截里）：徐州，1024 × 1366，刚读到“石炭”，从横着转回竖着。
    // 这一回页面没有动（重排以后阅读线还在“石炭”里），可是后面“要走了”的标题就在阅读线下面 0.2 像素的地方
    //（开发的机器上量的：默认的跑法、发布流程的跑法各三回，回回是这个数；这一截里别的回，最近的也有 11 像素）。
    // GitHub 的 Linux 排出来的字和这里差几个像素，那个标题落在阅读线的哪一边、页面带不带，在那里说不准。
    //（在开发的机器上把页面往两边各挪过几个像素再转：两边沙盘都还摆着“石炭”。）
    // 这一回的数照样写在记录里。
    const TOO_CLOSE = 'xuzhou 1024×1366，刚读到“石炭”，转回竖着';
    let tooClose = 0;
    for (const [stopId, upright, sideways] of [
      ['huangzhou', SMALL_UPRIGHT, TURNED],
      ['xuzhou', UPRIGHT, { width: UPRIGHT.height, height: UPRIGHT.width }],
      ['huangzhou', UPRIGHT, { width: UPRIGHT.height, height: UPRIGHT.width }],
    ] as const) {
      const scene = sceneOnDisk('su-shi', stopId);
      if (!scene) throw new Error(`content/ 里没有 ${stopId} 的沙盘`);
      const headings = headingsOf(scene);
      await page.setViewportSize(upright);
      await page.goto(fakeUrl(`#/su-shi/${stopId}`));
      await expectStageAt(page, headings[0]);
      await expectShape(page, 'narrow');
      for (const [i, heading] of headings.entries()) {
        for (const [where, go] of [
          ['刚读到', () => scrollToSection(page, heading)],
          ['快读完', i + 1 < headings.length ? () => scrollToSection(page, headings[i + 1], -20) : null],
        ] as const) {
          if (go === null) continue;
          await page.setViewportSize(upright);
          await expectShape(page, 'narrow');
          await go();
          await page.waitForTimeout(300);
          const what = `${stopId} ${upright.width}×${upright.height}，${where}“${heading}”`;
          const reading = await expect(pane)
            .toHaveAttribute('data-stage-section', heading, { timeout: 3000 })
            .then(
              () => true,
              () => false,
            );
          if (!reading) {
            // 页面快滚到底的最后几节：照阅读线的规矩，这个位置上读的不是这一节（阅读线挪到了底边），这一处没有东西可查
            lines.push(`  ${what}：滚到这里读的是“${await pane.getAttribute('data-stage-section')}”，不查`);
            continue;
          }
          const requests = await fakeRequests(page);
          for (const [how, size, shape] of [
            ['转成横着', sideways, 'wide'],
            ['转回竖着', upright, 'narrow'],
          ] as const) {
            const before = await whereIs(page, heading);
            const did = await turn(page, size, shape);
            const at = await whereIs(page, heading);
            const end = before.sliding || at.sliding;
            const room = at.line - at.textTop - BRING_BACK_GAP_PX;
            const isShort = at.next !== null && at.next - at.top < room;
            if (did.length > 0 && !end) came += 1;
            if (did.length > 0 && isShort && !end) short += 1;
            const now = await pane.getAttribute('data-stage-section');
            const asked = await fakeRequests(page);
            const px = (gap: number | null): string => (gap === null ? '没有标题' : `${gap.toFixed(1)} 像素`);
            const close = `${what}，${how}` === TOO_CLOSE;
            lines.push(
              `  ${what}，${how}：${did.length > 0 ? `带回（挪了 ${did.join('、')}）` : '没有动'}；头在 ${Math.round(at.top)}，后面那一节的头在 ${Math.round(at.next ?? Number.NaN)}，阅读线在 ${Math.round(at.line)}（离上面最近的标题 ${px(at.above)}，离下面最近的标题 ${px(at.below)}）${isShort ? '，这一节比阅读线上面的地方短' : ''}${end ? '，页面快滚到底了' : ''}${close ? '，只记下来' : ''}；沙盘摆着“${now}”`,
            );
            if (close) {
              tooClose += 1;
              continue;
            }
            if (end) {
              atTheEnd.turns += 1;
              if (did.length > 0) atTheEnd.came += 1;
              if (now !== heading) atTheEnd.off += 1;
            }
            if (now !== heading) problems.push(`${what}，${how}：沙盘换到了“${now}”`);
            if (asked.join('|') !== requests.join('|')) problems.push(`${what}，${how}：沙盘被叫去换过小节（${asked.slice(requests.length).join('、')}）`);
            if (did.length > 1) problems.push(`${what}，${how}：页面把正文挪了 ${did.length} 回`);
          }
        }
      }
    }
    console.log(`短的小节转方向：\n${lines.join('\n')}\n  页面快滚到底的那一截里查了 ${atTheEnd.turns} 回，页面带了 ${atTheEnd.came} 回，沙盘换到了别的小节的有 ${atTheEnd.off} 回；只记下来的有 ${tooClose} 回`);
    expect(problems).toEqual([]);
    expect(came, '一回也没有带：这一项什么也没查到').toBeGreaterThan(0);
    expect(short, '带回来的那些回里，没有一回的小节比阅读线上面的地方短：这一项查不到短的小节，换一站或者换一种窗口').toBeGreaterThan(0);
    // “把阅读线自己的那一挪算进去”和不算的两种算法，这一项只靠一回分得出来：黄州，1024 × 1366，刚读到“承天寺”，转回竖着
    //（不算的话，沙盘换到“十月，再到赤壁”）。黄州的正文改过以后，把不算的那两行放回去跑一次，看这一项还红不红。
    // Node 那边的一步（page-behaviour.test.tsx 的“版面换了排法…”）不靠哪一站的正文。
    expect(atTheEnd.off, '页面快滚到底的那一截里，转了以后沙盘换到了别的小节').toBe(0);
    expect(atTheEnd.came, '页面快滚到底的那一截里一回也没有带：这一截什么也没查到，换一站或者换一种窗口').toBeGreaterThan(0);
  });
});

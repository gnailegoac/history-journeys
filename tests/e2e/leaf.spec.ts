// 正文那一栏（文字栏）的样子，在真的页面上量。只量说得出数的几样；好不好看要看照片。
//
// 一、一行多少个字。四种标准的窗口上，正文的宽度除以字号：横排的版面（窗口 960 像素宽以上、而且横着）18 到 24 个字，
//     竖着拿的平板（小的和大的）28 到 32 个字。另外真的数一遍：把正文里每个字在哪一行找出来，全是汉字和全角标点的行里最满的一行，
//     就是算出来的那个数。段首空两个字，两端对齐。人物页的介绍也一样。
// 二、可以点开小注的词：下面一道强调色的虚线，是分开写的那几条属性算出来的（text-decoration-line 这些；合成一句的写法
//     iPad 上的 Safari 到 26.2 版才认。这里只证明 Chromium 里有这道线；Safari 靠 tests/fonts/font-files.test.ts 和
//     tests/build/dist-size.test.ts 查写法）。词没有底色；点开以后字变成强调色；能点的地方有一行那么高。
//     点开的小注里类别的小标签（历史、地理……）是强调色的字：和小注的底比，不低于 4.5 比 1。
// 三、正文那一栏里能点的东西，都不小于 44 像素见方：位置那一行的链接、目录里的每一站、“读原文”“凭据”那一行、
//     小注的“关闭”、“图片出处”、回到目录、“到沙盘”、贴着底边那一条里的上一站、下一站和“问讲解员”、“没找到”页面上的链接。
//     量法：它的框不小于 44 像素见方；再像手指那样点，把它滚到看得见正文的那一块的正中，在它正中的上、下、左、右
//     各 21 像素的地方看点到的是不是它（没有被别的东西盖住）。“图片出处”看着只有一行高，能点的地方是撑大了的，只看点不点得到。
//     正文里可以点开的词在一行字中间，不要求 44 像素，要求有一行那么高。
// 四、“读原文”“凭据”那一行：折着显加号，点开显减号，都是页面上真的字；记号和名字都是黑体。
//     抬头里的一排小圆圈、目录里的数字圆点、宽屏上文字栏到底、是平的一种颜色：各量一下。
// 五、贴着底边的那一条和讲解员面板，四种标准的窗口上各量一遍。那一条：页面的颜色，平的，上边一道细线，64 像素高（横排的版面 68），
//     横排的版面上和文字栏一样宽，别的窗口上和窗口一样宽；文字栏和那一条两边都没有竖着的细线；三格——上一站、“问讲解员”、下一站——
//     和正文那一栏的左右边对齐，“问讲解员”在正中；“上一站”“下一站”是黑体的小字，站名是黑体、大一些，各占一行；
//     “问讲解员”平常是一块白底的板（一圈强调色的线、强调色的字，前面没有记号），鼠标移上去才铺强调色的底；正文的最后一行滚得到这一条上面。
//     头一站、最后一站各看一遍（那一头的格子空着）；横着拿的平板上，两头换上各站里最长的两个短名字，三格还放得下。
//     面板：横排的版面上和文字栏一样宽、一直到窗口的底边（下面不露出正文），不挡沙盘；别的窗口上从底部升起，
//     最高到窗口的四分之三，里面的字和正文那一栏一样宽、对齐；白底，上边一道细线、一道影子；开着的时候那一条收起来。
//
// 沙盘用的是替身（?stage=fake）。数从真的页面和 content/ 里真的文件读，不另写一遍。

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Figure } from '../../src/domain/types';
import { STANDARD_PANES } from '../stage/support/standardPanes';
import { readBytes } from '../support/readBytes';
import { expectStageAt, expectRoute, fakeUrl, firstWrittenStopWithoutScene, foldBodiesReady, fontsReady, headingsOf, openFigureWithTable, sceneOnDisk, scrollToBottom } from './helpers';

/** 这种窗口上是不是横排的版面（文字在左、沙盘在右）：窗口 960 像素宽以上、而且横着（宽比高大），和 layout.css 的媒体查询是同一句。 */
const sideBySide = (size: { width: number; height: number }): boolean => size.width >= 960 && size.width > size.height;
/** 一行该有多少个字：横排的版面，竖着拿的平板。 */
const PER_LINE = { wide: { min: 18, max: 24 }, narrow: { min: 28, max: 32 } } as const;
/** 能点的东西至少这么大（tokens.css 的 --tap）。 */
const TAP = 44;

const WINDOWS = STANDARD_PANES.map((pane) => pane.window);
const nameOf = (size: { width: number; height: number }): string => `${size.width} × ${size.height}`;

/** 换一种窗口，从头打开一个地址。 */
async function openAt(page: Page, size: { width: number; height: number }, hash: string): Promise<void> {
  await page.goto('about:blank');
  await page.setViewportSize(size);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(fakeUrl(hash));
}

/** 一处正文量到的：段落多宽、字号、段首空多少、怎么对齐；全是全角字的行里，最满的一行有几个字。 */
interface Measure {
  width: number;
  fontSize: number;
  indent: number;
  align: string;
  paragraphs: number;
  fullest: number;
  lines: number;
}

/** 量 selector 找到的那些段落。 */
async function measureProse(page: Page, selector: string): Promise<Measure> {
  await fontsReady(page);
  return page.evaluate((selector) => {
    const paragraphs = Array.from(document.querySelectorAll<HTMLElement>(selector));
    if (paragraphs.length === 0) throw new Error(`页面上没有 ${selector}`);
    const first = getComputedStyle(paragraphs[0]);
    // 一个字是不是一定占满一个字宽：汉字，和顿号、句号、书名号、逗号、冒号、括号这些全角的标点。
    // 数字、英文字母、间隔号比一个字窄；引号、破折号、省略号这里不去认定。有这些字的行不拿来数
    const fullWidth = (ch: string): boolean => {
      const code = ch.codePointAt(0) ?? 0;
      return (code >= 0x3000 && code <= 0x303f) || (code >= 0x3400 && code <= 0x9fff) || (code >= 0xff00 && code <= 0xff60);
    };
    let fullest = 0;
    let lines = 0;
    const range = document.createRange();
    for (const paragraph of paragraphs) {
      // 每个字在哪一行：照它的框的上边分行（同一行里黑体、宋体不混排，上边是齐的；差不到半行的算同一行）
      const rows: { top: number; chars: string[] }[] = [];
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? '';
        for (let i = 0; i < text.length; i++) {
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const box = range.getClientRects()[0];
          if (!box || box.width === 0) continue;
          const row = rows.find((item) => Math.abs(item.top - box.top) < box.height / 2);
          if (row) row.chars.push(text[i]);
          else rows.push({ top: box.top, chars: [text[i]] });
        }
      }
      // 头一行（空了两个字）和最后一行（不满）不算
      for (const row of rows.slice(1, -1)) {
        if (!row.chars.every(fullWidth)) continue;
        lines++;
        fullest = Math.max(fullest, row.chars.length);
      }
    }
    return {
      width: paragraphs[0].getBoundingClientRect().width,
      fontSize: parseFloat(first.fontSize),
      indent: parseFloat(first.textIndent),
      align: first.textAlign,
      paragraphs: paragraphs.length,
      fullest,
      lines,
    };
  }, selector);
}

test('四种标准的窗口上：正文一行的字数在设计的范围里（算出来的和数出来的一样），段首空两个字，两端对齐', async ({ page }) => {
  test.setTimeout(240_000);
  const { figureId, found } = await openFigureWithTable(page, fakeUrl('#/'));
  test.skip(!found, '还没有哪一站有沙盘');
  if (!found) return;

  for (const size of WINDOWS) {
    const want = sideBySide(size) ? PER_LINE.wide : PER_LINE.narrow;
    for (const [where, hash, selector] of [
      ['站点页的正文', `#/${figureId}/${found.stopId}`, '.stop-text .text-section > p'],
      ['人物页的介绍', `#/${figureId}`, '.figure-intro > p'],
    ] as const) {
      await openAt(page, size, hash);
      await expect(page.locator(selector).first()).toBeVisible();
      const got = await measureProse(page, selector);
      const perLine = Math.floor(got.width / got.fontSize + 1e-6);
      const label = `${nameOf(size)}，${where}`;
      console.log(`${label}：一行宽 ${got.width} 像素，字号 ${got.fontSize} 像素，算出来一行 ${perLine} 个字；${got.paragraphs} 段里全是全角字的整行有 ${got.lines} 行，最满的 ${got.fullest} 个字`);
      expect(perLine, `${label}：一行 ${perLine} 个字，设计的是 ${want.min} 到 ${want.max} 个`).toBeGreaterThanOrEqual(want.min);
      expect(perLine, `${label}：一行 ${perLine} 个字，设计的是 ${want.min} 到 ${want.max} 个`).toBeLessThanOrEqual(want.max);
      // 真的数出来的：有得数（全是全角字的整行），最满的一行就是算出来的数
      expect(got.lines, `${label}：没有找到全是全角字的整行，数不了`).toBeGreaterThan(0);
      expect(got.fullest, `${label}：数出来最满的一行`).toBe(perLine);
      // 段首空两个字；两端对齐
      expect(got.indent, `${label}：段首空的宽度`).toBeCloseTo(2 * got.fontSize, 1);
      expect(got.align, `${label}：对齐`).toBe('justify');
    }
  }
});

test('可以点开小注的词：下面一道强调色的虚线，没有底色；点开以后字变成强调色；能点的地方有一行那么高', async ({ page }) => {
  const { figureId, found } = await openFigureWithTable(page, fakeUrl('#/'));
  test.skip(!found, '还没有哪一站有沙盘');
  if (!found) return;
  await page.goto(fakeUrl(`#/${figureId}/${found.stopId}`));
  await expectStageAt(page, headingsOf(found.scene)[0]);
  await fontsReady(page);

  const read = () =>
    page.evaluate(() => {
      // 强调色在这个浏览器里算出来是什么写法：拿一个元素现算
      const probe = document.createElement('span');
      probe.style.color = 'var(--color-accent)';
      document.body.appendChild(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      const ink = getComputedStyle(document.body).color;
      const terms = Array.from(document.querySelectorAll<HTMLElement>('.note-term')).map((term) => {
        const style = getComputedStyle(term);
        const line = parseFloat(getComputedStyle(term.closest('p') as HTMLElement).lineHeight);
        return {
          text: term.textContent ?? '',
          open: term.getAttribute('aria-expanded') === 'true',
          line: style.textDecorationLine,
          dots: style.textDecorationStyle,
          lineColour: style.textDecorationColor,
          thick: style.textDecorationThickness,
          ground: style.backgroundColor,
          colour: style.color,
          // 词要是折到了两行，各行的框都得有一行那么高
          shortBy: Math.max(...Array.from(term.getClientRects()).map((box) => line - box.height)),
        };
      });
      return { accent, ink, terms };
    });

  const before = await read();
  expect(before.terms.length).toBeGreaterThan(3);
  expect(before.accent).not.toBe(before.ink);
  for (const term of before.terms) {
    const label = `“${term.text}”`;
    expect(term.line, `${label}的线`).toBe('underline');
    expect(term.dots, `${label}的线的样子`).toBe('dotted');
    expect(term.lineColour, `${label}的线的颜色`).toBe(before.accent);
    expect(term.thick, `${label}的线的粗细`).toBe('1.5px');
    expect(term.ground, `${label}的底色`).toBe('rgba(0, 0, 0, 0)');
    expect(term.colour, `${label}没点开的时候字的颜色`).toBe(before.ink);
    expect(term.shortBy, `${label}能点的地方比一行矮了多少像素`).toBeLessThanOrEqual(0.5);
  }
  console.log(`${before.terms.length} 个可以点开的词：线都是 ${before.terms[0].line} ${before.terms[0].dots} ${before.terms[0].lineColour} ${before.terms[0].thick}`);

  // 点开头一个：字变成强调色，线还在，还是没有底色（鼠标挪开再量，不把“鼠标移上去”的样子算进来）
  await page.locator('.note-term').first().evaluate((term: HTMLElement) => term.click());
  await expect(page.locator('.note').first()).toBeVisible();
  await page.mouse.move(0, 0);
  const after = await read();
  const opened = after.terms.filter((term) => term.open);
  expect(opened).toHaveLength(1);
  expect(opened[0].colour).toBe(after.accent);
  expect(opened[0].line).toBe('underline');
  expect(opened[0].dots).toBe('dotted');
  expect(opened[0].ground).toBe('rgba(0, 0, 0, 0)');

  // 点开的小注里类别的小标签（历史、地理……）：强调色的字，和垫在它下面的那一层底（小注的底）比，不低于 4.5 比 1
  //（原来的红字在那块底上比标准略淡一点；换了颜色以后够了，这一句守着它）
  const kind = await page.locator('.note .note-kind').first().evaluate((el) => {
    const clear = (colour: string): boolean => colour === 'transparent' || /^rgba\(\d+, \d+, \d+, 0\)$/.test(colour);
    let holder: Element = el;
    let ground = getComputedStyle(holder).backgroundColor;
    while (clear(ground) && holder.parentElement) {
      holder = holder.parentElement;
      ground = getComputedStyle(holder).backgroundColor;
    }
    return { text: el.textContent ?? '', colour: getComputedStyle(el).color, ground, holder: `${holder.tagName.toLowerCase()}.${holder.className}` };
  });
  const channels = (colour: string): number[] => (colour.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const luminance = (colour: string): number => {
    const [r, g, b] = channels(colour).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [luminance(kind.colour), luminance(kind.ground)].sort((x, y) => y - x);
  const ratio = (hi + 0.05) / (lo + 0.05);
  expect(kind.holder, '垫在类别的小标签下面的是小注自己').toMatch(/^aside\.note/);
  expect(ratio, `小注里“${kind.text}”这个小标签：${kind.colour} 在 ${kind.ground} 上，对比只有 ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
  expect(kind.colour, '类别的小标签是强调色的字').toBe(after.accent);
  console.log(`点开的小注里类别的小标签“${kind.text}”：${kind.colour} 在 ${kind.holder}（${kind.ground}）上，${ratio.toFixed(2)} 比 1`);
});

/**
 * 正文那一栏里能点的东西，一个一个像手指那样点一遍。checked 是各种东西查了几个（照元素的名字和类名记），
 * problems 是不够大、点不到的，一处一句话。
 */
async function tapProblems(page: Page): Promise<{ checked: Record<string, number>; problems: string[] }> {
  await fontsReady(page);
  return page.evaluate(async (TAP) => {
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const nameOf = (el: Element): string => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() !== '' ? `.${el.className.trim().split(/\s+/)[0]}` : ''}`;
    const leaf = document.querySelector<HTMLElement>('.reading, .plain-page');
    if (!leaf) throw new Error('页面上没有正文那一栏');
    const pressable = Array.from(leaf.querySelectorAll<HTMLElement>('a[href], button, summary, [role="button"]'));
    const checked: Record<string, number> = {};
    const problems: string[] = [];

    /** 看得见正文的那一块：从哪到哪（沙盘钉在顶上时从它的下边起；底下有“问讲解员”那一条时到它的上边止）。 */
    const free = (): { top: number; bottom: number } => {
      let top = 0;
      const pane = document.querySelector('.stage-pane');
      if (pane && getComputedStyle(pane).position === 'sticky') {
        const paneBox = pane.getBoundingClientRect();
        const leafBox = leaf.getBoundingClientRect();
        if (paneBox.left < leafBox.right && paneBox.right > leafBox.left) top = Math.max(0, paneBox.bottom);
      }
      const dock = document.querySelector('.guide-dock');
      const bottom = dock && dock.getClientRects().length > 0 ? dock.getBoundingClientRect().top : window.innerHeight;
      return { top, bottom };
    };

    for (const el of pressable) {
      // “到沙盘”平时看不见，走到它上面才显出来：先把焦点放上去再量
      if (el.classList.contains('skip-to-stage')) el.focus({ preventScroll: true });
      // 折着的原文和凭据里面的：没显出来，不查（测试会先把它们都点开）
      if (el.getClientRects().length === 0) continue;
      const word = el.classList.contains('note-term');
      // 正文里的词可能折到两行：照它的头一截量
      const boxOf = (): DOMRect => (word ? el.getClientRects()[0] : el.getBoundingClientRect());
      // 钉在屏幕底下那一条里的东西不跟着页面滚；别的滚到看得见正文的那一块的正中
      if (!el.closest('.guide-dock')) {
        const { top, bottom } = free();
        const box = boxOf();
        window.scrollBy(0, box.top + box.height / 2 - (top + bottom) / 2);
        await frame();
      }
      const box = boxOf();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const hits = (px: number, py: number): boolean => {
        const at = document.elementFromPoint(px, py);
        return at !== null && (at === el || el.contains(at));
      };
      const label = `${nameOf(el)}“${(el.textContent ?? '').trim().slice(0, 14)}”（框 ${Math.round(box.width * 10) / 10} × ${Math.round(box.height * 10) / 10}）`;
      const kind = nameOf(el);
      checked[kind] = (checked[kind] ?? 0) + 1;
      if (!hits(x, y)) {
        problems.push(`${label}：点它的正中，点到的不是它`);
      } else if (word) {
        const line = parseFloat(getComputedStyle(el.closest('p') as HTMLElement).lineHeight);
        if (box.height < line - 0.5) problems.push(`${label}：比一行（${line} 像素）矮`);
      } else {
        // 一、它自己的框不小于 44 像素见方。看着小、靠 ::after 把能点的地方撑大的（“图片出处”），框不算数，只看下面点不点得到
        const padded = getComputedStyle(el, '::after').position === 'absolute';
        if (!padded && (box.width < TAP || box.height < TAP)) problems.push(`${label}：框不够 ${TAP} 像素见方`);
        // 二、像手指那样点：离正中 21 像素的上、下、左、右，点到的都是它（没有被别的东西盖住）。
        //     探的点离 44 像素见方的边还有 1 像素：框的位置带小数的时候，浏览器是照整像素认点的，贴着边的那一像素会算到隔壁去
        const reach = TAP / 2 - 1;
        const missed = [
          ['上', x, y - reach],
          ['下', x, y + reach],
          ['左', x - reach, y],
          ['右', x + reach, y],
        ].filter(([, px, py]) => !hits(px as number, py as number));
        if (missed.length > 0) problems.push(`${label}：离它正中 ${reach} 像素的${missed.map(([side]) => side).join('、')}边点不到它，能点的地方不够 ${TAP} 像素见方`);
      }
      if (el.classList.contains('skip-to-stage')) el.blur();
    }
    return { checked, problems };
  }, TAP);
}

test('四种标准的窗口上：正文那一栏里能点的东西都不小于 44 像素见方（正文里的词有一行那么高）', async ({ page }) => {
  test.setTimeout(300_000);
  const { figureId, found } = await openFigureWithTable(page, fakeUrl('#/'));
  test.skip(!found, '还没有哪一站有沙盘');
  if (!found) return;
  const stops = await page.locator('.stop-item').evaluateAll((items) => items.map((item) => ({ id: item.getAttribute('data-stop-id') ?? '', written: item.getAttribute('data-stop-status') === 'complete' })));
  const noTable = await firstWrittenStopWithoutScene(page, figureId);

  /** 把这一页上能点开的都点开：每一条小注、每一篇原文、凭据。 */
  const openAll = (): Promise<{ notes: number; folds: number }> =>
    page.evaluate(() => {
      const terms = Array.from(document.querySelectorAll<HTMLElement>('.note-term[aria-expanded="false"]'));
      for (const term of terms) term.click();
      const folds = Array.from(document.querySelectorAll<HTMLDetailsElement>('details.original, details.provenance'));
      for (const fold of folds) fold.open = true;
      return { notes: terms.length, folds: folds.length };
    });

  for (const size of WINDOWS) {
    // 还没写的站两种各查一站：有自己的沙盘的，没有的
    const seenUnwritten = { views: false, bare: false };
    const check = async (where: string, atLeast: Record<string, number>): Promise<void> => {
      const { checked, problems } = await tapProblems(page);
      const label = `${nameOf(size)}，${where}`;
      console.log(`${label}：查了 ${Object.entries(checked).map(([kind, count]) => `${kind} ${count} 个`).join('，')}`);
      for (const [kind, count] of Object.entries(atLeast)) expect(checked[kind] ?? 0, `${label}：${kind} 该查到至少 ${count} 个`).toBeGreaterThanOrEqual(count);
      expect(problems, `${label}：这几样东西不够大，或者点不到`).toEqual([]);
    };

    // 首页：可以点进去的卡片，卡片后面的“来源”。还没写的卡片不是能点的东西，这里数不到它们
    await openAt(page, size, '#/');
    await expect(page.locator('.card').first()).toBeVisible();
    await expectRoute(page);
    const openCards = await page.locator('a.card').count();
    expect(openCards).toBeGreaterThan(0);
    expect(await page.locator('.reading').locator('a[href], button, summary, [role="button"], [tabindex]').count(), `${nameOf(size)}，首页：文字栏里能点的东西只有可以点进去的卡片和“来源”`).toBe(openCards + 1);
    await check('首页', { 'a.card': openCards, 'a.stop-nav-sources': 1 });

    // “来源”页：位置那一行，五份许可全文，三套字体的网站，每张图片的出处
    await openAt(page, size, '#/sources');
    await expect(page.locator('.sources-list li').first()).toBeVisible();
    await expect(page.locator('.sources .quiet')).toHaveCount(0);
    const pictureLinks = await page.locator('.sources [data-sources="pictures"] .sources-links a').count();
    await check('“来源”页', { a: 1 + 5 + 3 + pictureLinks });

    // 人物页：位置那一行、目录里的每一站、目录后面的“来源”
    await openAt(page, size, `#/${figureId}`);
    await expect(page.locator('.stop-item').first()).toBeVisible();
    await expectRoute(page);
    await check('人物页', { a: 1, 'a.stop-item': stops.length, 'a.stop-nav-sources': 1 });

    // 有沙盘的一站：小注、原文、凭据都点开
    await openAt(page, size, `#/${figureId}/${found.stopId}`);
    await expectStageAt(page, headingsOf(found.scene)[0]);
    const opened = await openAll();
    expect(opened.notes).toBeGreaterThan(0);
    await expect(page.locator('.provenance-body')).toBeVisible();
    // 凭据里面的东西是点开才取的：等它到了，页面不再变长，再一个一个点
    await foldBodiesReady(page);
    await check('有沙盘的一站，都点开', {
      a: 2,
      'span.note-term': opened.notes,
      'button.note-close': opened.notes,
      summary: opened.folds,
      'a.walk-link': 1,
      // 正文末尾并排的两个：回到各站目录，来源
      'a.stop-nav-list': 1,
      'a.stop-nav-sources': 1,
      'button.skip-to-stage': 1,
      'button.guide-open': 1,
    });

    // 写好了、还没有沙盘的一站（这一站的正文里有图片的话，“图片出处”也在里面）
    if (noTable) {
      await openAt(page, size, `#/${figureId}/${noTable}`);
      await expect(page.locator('.text-section').first()).toBeVisible();
      await expectRoute(page);
      const openedHere = await openAll();
      await foldBodiesReady(page);
      const credits = await page.locator('.stop-image-credit a').count();
      await check('没有沙盘的一站，都点开', { 'span.note-term': openedHere.notes, summary: openedHere.folds, ...(credits > 0 ? { a: 2 + credits } : {}) });
    }

    // 还没写的一站。两种都查：没有自己的沙盘的（文字栏里只有一句话），和有自己的沙盘的（多一张单子“沙盘上看的几处”，
    // 一行是一个按钮，下面一行凭据——点开了再查）
    for (const stop of stops.filter((one) => !one.written)) {
      const own = sceneOnDisk(figureId, stop.id);
      if (own ? seenUnwritten.views : seenUnwritten.bare) continue;
      await openAt(page, size, `#/${figureId}/${stop.id}`);
      await expect(page.locator('.not-written')).toBeVisible();
      if (own) {
        seenUnwritten.views = true;
        await expect(page.locator('.views .view-item')).toHaveCount(own.sections.length);
        const openedHere = await openAll();
        await foldBodiesReady(page);
        await check(`还没写、有自己的沙盘的一站（${stop.id}）`, { 'button.view-item': own.sections.length, summary: openedHere.folds, a: 2, 'a.stop-nav-list': 1, 'a.stop-nav-sources': 1, 'a.walk-link': 1 });
      } else {
        seenUnwritten.bare = true;
        await check(`还没写的一站（${stop.id}）`, { a: 2, 'a.stop-nav-list': 1, 'a.stop-nav-sources': 1, 'a.walk-link': 1 });
      }
    }

    // 两种“没找到”
    await openAt(page, size, `#/${figureId}/no-such-stop`);
    await expect(page.locator('.page-title')).toBeVisible();
    await check('没有这一站', { 'a.text-link': 1 });
    await openAt(page, size, '#/no-such-figure');
    await expect(page.locator('.page-title')).toBeVisible();
    await check('没有这位人物', { 'a.text-link': 1 });
  }
});

test('“读原文”“凭据”折着显加号、点开显减号；抬头里的一排小圆圈、目录里的数字圆点；宽屏上文字栏到底，是平的一种颜色', async ({ page }) => {
  const { figureId, found } = await openFigureWithTable(page, fakeUrl('#/'));
  test.skip(!found, '还没有哪一站有沙盘');
  if (!found) return;
  const stops = await page.locator('.stop-item').evaluateAll((items) => items.map((item) => ({ id: item.getAttribute('data-stop-id') ?? '', written: item.getAttribute('data-stop-status') === 'complete' })));
  await fontsReady(page);

  // ---- 目录：每一站至少 64 像素高；数字的圆点 26 像素见方，黑体；写好的一站圆点是实心的，还没写的只有一圈线
  const rows = await page.locator('.stop-item').evaluateAll((items) =>
    items.map((item) => {
      const seal = item.querySelector('.stop-number') as HTMLElement;
      const box = seal.getBoundingClientRect();
      const style = getComputedStyle(seal);
      const title = getComputedStyle(item.querySelector('.stop-title') as HTMLElement);
      const summary = getComputedStyle(item.querySelector('.stop-summary') as HTMLElement);
      return { height: item.getBoundingClientRect().height, seal: `${box.width} × ${box.height}`, sealFamily: style.fontFamily, sealGround: style.backgroundColor, titleFamily: title.fontFamily, titleSize: parseFloat(title.fontSize), summarySize: parseFloat(summary.fontSize) };
    }),
  );
  expect(rows).toHaveLength(stops.length);
  for (const [i, row] of rows.entries()) {
    expect(row.height, `目录第 ${i + 1} 站的高`).toBeGreaterThanOrEqual(64);
    expect(row.seal).toBe('26 × 26');
    expect(row.sealFamily).toMatch(/^"?Yanlu Sans/);
    expect(row.titleFamily).toMatch(/^"?Yanlu Sans/);
    // 站名比下面的摘要大：不再显得比摘要轻
    expect(row.titleSize).toBeGreaterThan(row.summarySize);
    if (stops[i].written) expect(row.sealGround, `写好的第 ${i + 1} 站，圆点是实心的`).not.toBe('rgba(0, 0, 0, 0)');
    else expect(row.sealGround, `还没写的第 ${i + 1} 站，圆点只有一圈线`).toBe('rgba(0, 0, 0, 0)');
  }

  // ---- 有沙盘的一站
  await page.goto(fakeUrl(`#/${figureId}/${found.stopId}`));
  await expectStageAt(page, headingsOf(found.scene)[0]);
  await fontsReady(page);

  // 抬头里的一排小圆圈：一站一个，9 像素见方，只有这一站的是实心的
  const at = stops.findIndex((stop) => stop.id === found.stopId);
  const ticks = await page.locator('.page-head .ticks span').evaluateAll((squares) =>
    squares.map((square) => {
      const box = square.getBoundingClientRect();
      return { size: `${box.width} × ${box.height}`, filled: getComputedStyle(square).backgroundColor !== 'rgba(0, 0, 0, 0)' };
    }),
  );
  expect(ticks.map((tick) => tick.size)).toEqual(stops.map(() => '9 × 9'));
  expect(ticks.map((tick) => tick.filled)).toEqual(stops.map((_, i) => i === at));
  await expect(page.locator('.page-head .ticks')).toHaveAttribute('aria-hidden', 'true');

  // 位置那一行的两个链接：下面各有一道细细的灰线（平板上没有“鼠标移上去”，靠它看得出点得动）。
  // 线是分开写的那几条属性算出来的（合成一句的写法 iPad 上的 Safari 不认，见上面第二条）
  const crumbs = await page.locator('.crumbs a').evaluateAll((links) =>
    links.map((link) => {
      const style = getComputedStyle(link);
      return { line: style.textDecorationLine, style: style.textDecorationStyle, thick: style.textDecorationThickness, colour: style.textDecorationColor, text: style.color };
    }),
  );
  expect(crumbs).toHaveLength(2);
  for (const crumb of crumbs) expect(crumb, '位置那一行的链接').toEqual({ line: 'underline', style: 'solid', thick: '1px', colour: 'rgb(134, 131, 124)', text: 'rgb(92, 90, 85)' });

  // “读原文”“凭据”那一行：折着的时候看得见的是加号，点开是减号；记号和名字都是黑体；一行至少 48 像素高
  const folds = page.locator('details.original, details.provenance');
  const count = await folds.count();
  expect(count).toBeGreaterThan(1);
  for (let i = 0; i < count; i++) {
    const fold = folds.nth(i);
    const mark = fold.locator('summary .fold-mark');
    const label = fold.locator('summary .fold-label');
    await expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(await mark.evaluate((el: HTMLElement) => el.innerText)).toBe('+');
    expect(await mark.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Yanlu Sans/);
    expect(await label.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Yanlu Sans/);
    expect((await fold.locator('summary').evaluate((el) => el.getBoundingClientRect().height))).toBeGreaterThanOrEqual(48);
    await fold.evaluate((el: HTMLDetailsElement) => {
      el.open = true;
    });
    expect(await mark.evaluate((el: HTMLElement) => el.innerText)).toBe('−');
    await fold.evaluate((el: HTMLDetailsElement) => {
      el.open = false;
    });
    expect(await mark.evaluate((el: HTMLElement) => el.innerText)).toBe('+');
  }
  await expect(page.locator('details.original summary .fold-label').first()).toHaveText('读原文');
  await expect(page.locator('details.provenance summary .fold-label')).toHaveText('凭据');

  // ---- 宽屏上，正文再短，文字栏也到屏幕的底边（拿还没写的一站量）；它是平的一种颜色，没有纹理，两边也没有竖着的细线
  // 最短的是没有自己的沙盘的那一种（文字栏里只有一句话）；都有沙盘了，就拿头一个还没写的
  const notWritten = (stops.find((stop) => !stop.written && sceneOnDisk(figureId, stop.id) === null) ?? stops.find((stop) => !stop.written))?.id;
  if (notWritten) {
    await page.goto(fakeUrl(`#/${figureId}/${notWritten}`));
    await expect(page.locator('.not-written')).toBeVisible();
    const leaf = await page.locator('.reading').evaluate((el) => ({ bottom: el.getBoundingClientRect().bottom, picture: getComputedStyle(el).backgroundImage, rules: [getComputedStyle(el, '::before').content, getComputedStyle(el, '::after').content], window: window.innerHeight }));
    expect(leaf.bottom, '文字栏的下边').toBeGreaterThanOrEqual(leaf.window);
    expect(leaf.picture, '文字栏是平的一种颜色，底上不铺图').toBe('none');
    expect(leaf.rules, '文字栏两边没有竖着的细线').toEqual(['none', 'none']);
  }
});

// ---------------------------------------------------------------- 贴着底边的那一条，和讲解员面板

/** tokens.css 里框架的几种颜色，算出来的样子：页面的底、板的底、字、说明性的字、强调色、强调色上面的字、重一点的线、记号的灰。 */
const PAGE = 'rgb(251, 250, 247)';
const PLATE = 'rgb(255, 255, 255)';
const FRAME_INK = 'rgb(35, 34, 31)';
const FRAME_SOFT = 'rgb(92, 90, 85)';
const FRAME_ACCENT = 'rgb(31, 75, 110)';
const ON_ACCENT = 'rgb(255, 255, 255)';
const LINE_STRONG = 'rgb(200, 196, 186)';
const INK_FAINT = 'rgb(134, 131, 124)';
const NO_FILL = 'rgba(0, 0, 0, 0)';
/** 那一条多高（tokens.css 的 --bar-h）：横排的版面 68，别的 64。 */
const BAR_H = { wide: 68, narrow: 64 } as const;

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/** 一格里的一行字（“上一站”，或者站名）。 */
interface BarWord {
  text: string;
  box: Box;
  /** 字自己从哪到哪（那一行的框可能比字宽，字也可能伸到框外面去）。 */
  ink: { left: number; right: number };
  size: number;
  family: string;
  colour: string;
  lineHeight: number;
  /** 字下面的线：种类、样子、粗细、颜色（没有线时开头是 none）。 */
  underline: string;
}

/** 那一条里的一格。 */
interface BarCell {
  tag: string;
  rel: string | null;
  href: string | null;
  text: string;
  box: Box;
  ground: string;
  colour: string;
  edge: string;
  family: string;
  size: number;
  label: BarWord | null;
  name: BarWord | null;
  /** “问讲解员”前面有没有画出来的记号（::before 的 content；没有是 none）。 */
  mark: string | null;
}

/** 画出来的一道竖线（::before、::after）。 */
interface Rule {
  content: string;
  left: string;
  right: string;
  width: string;
  colour: string;
}

interface BarReading {
  window: { width: number; height: number };
  bar: Box;
  position: string;
  ground: string;
  /** 底上铺没铺图（background-image；平的是 none）。 */
  picture: string;
  topEdge: string;
  leaf: Box;
  column: Box;
  barRules: Rule[];
  leafRules: Rule[];
  cells: BarCell[];
}

/** 量贴着底边的那一条：它自己、里面的三格、正文那一栏、文字栏。 */
function readBar(page: Page): Promise<BarReading> {
  return page.evaluate(() => {
    const need = (selector: string): HTMLElement => {
      const el = document.querySelector<HTMLElement>(selector);
      if (!el) throw new Error(`页面上没有 ${selector}`);
      return el;
    };
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const rule = (el: Element, which: string) => {
      const s = getComputedStyle(el, which);
      return { content: s.content, left: s.left, right: s.right, width: s.width, colour: s.backgroundColor };
    };
    const word = (el: HTMLElement | null) => {
      if (el === null) return null;
      const s = getComputedStyle(el);
      const range = document.createRange();
      range.selectNodeContents(el);
      const ink = range.getBoundingClientRect();
      return {
        text: el.textContent ?? '',
        box: box(el),
        ink: { left: ink.left, right: ink.right },
        size: parseFloat(s.fontSize),
        family: s.fontFamily,
        colour: s.color,
        lineHeight: parseFloat(s.lineHeight),
        underline: `${s.textDecorationLine} ${s.textDecorationStyle} ${s.textDecorationThickness} ${s.textDecorationColor}`,
      };
    };
    const bar = need('.guide-dock');
    const style = getComputedStyle(bar);
    const leaf = need('.reading');
    const cells = Array.from(bar.children).map((cell) => {
      const s = getComputedStyle(cell);
      const dot = getComputedStyle(cell, '::before');
      return {
        tag: cell.tagName.toLowerCase(),
        rel: cell.getAttribute('rel'),
        href: cell.getAttribute('href'),
        text: cell.textContent ?? '',
        box: box(cell),
        ground: s.backgroundColor,
        colour: s.color,
        edge: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
        family: s.fontFamily,
        size: parseFloat(s.fontSize),
        label: word(cell.querySelector<HTMLElement>('.walk-label')),
        name: word(cell.querySelector<HTMLElement>('.walk-name')),
        mark: cell.tagName === 'BUTTON' ? dot.content : null,
      };
    });
    return {
      window: { width: window.innerWidth, height: window.innerHeight },
      bar: box(bar),
      position: style.position,
      ground: style.backgroundColor,
      picture: style.backgroundImage,
      topEdge: `${style.borderTopWidth} ${style.borderTopStyle}`,
      leaf: box(leaf),
      column: box(need('.reading-inner')),
      barRules: [rule(bar, '::before'), rule(bar, '::after')],
      leafRules: [rule(leaf, '::before'), rule(leaf, '::after')],
      cells,
    };
  });
}

test('四种标准的窗口上：贴着底边的那一条（上一站、问讲解员、下一站），和点开的讲解员面板', async ({ page }) => {
  test.setTimeout(300_000);
  const { figureId, found } = await openFigureWithTable(page, fakeUrl('#/'));
  test.skip(!found, '还没有哪一站有沙盘');
  if (!found) return;
  // 各站的先后和短名字，照 content/ 里真的文件
  const figure = JSON.parse(new TextDecoder().decode(readBytes(`content/figures/${figureId}/figure.json`))) as Figure;
  const stops = figure.stops;
  const at = stops.findIndex((stop) => stop.id === found.stopId);
  expect(at, '有沙盘的那一站前面、后面都得有站，三格才都有东西').toBeGreaterThan(0);
  expect(at).toBeLessThan(stops.length - 1);
  const chars = (text: string): number => Array.from(text).length;
  // 各站里最长的两个短名字（现在是五个字的“眉山到汴京”和“惠州、儋州”）
  const longest = stops
    .map((stop) => stop.shortTitle)
    .sort((a, b) => chars(b) - chars(a))
    .slice(0, 2);
  expect(chars(longest[0])).toBeGreaterThanOrEqual(chars(stops[at - 1].shortTitle));
  const rows: string[] = [];

  /** 一格是一个链接：指着哪一站，上下两行各是什么样；放在那一条里的哪一头。 */
  const expectLink = (cell: BarCell, rel: 'prev' | 'next', to: number, got: BarReading, label: string): void => {
    expect({ tag: cell.tag, rel: cell.rel, href: cell.href }, `${label}：${rel === 'prev' ? '左' : '右'}边那一格`).toEqual({ tag: 'a', rel, href: `#/${figureId}/${stops[to].id}` });
    const [small, name] = [cell.label, cell.name];
    if (small === null || name === null) throw new Error(`${label}：那一格里没有两行字`);
    expect({ text: small.text, size: small.size, colour: small.colour }, `${label}：小字那一行`).toEqual({ text: rel === 'prev' ? '上一站' : '下一站', size: 14, colour: FRAME_SOFT });
    expect(small.family, `${label}：小字是黑体`).toMatch(/^"?Yanlu Sans/);
    expect({ text: name.text, colour: name.colour }, `${label}：站名那一行`).toEqual({ text: stops[to].shortTitle, colour: FRAME_INK });
    expect(name.family, `${label}：站名是黑体`).toMatch(/^"?Yanlu Sans/);
    expect(name.size, `${label}：站名的字号`).toBeGreaterThanOrEqual(18);
    expect(name.size, `${label}：站名比上面的小字大`).toBeGreaterThan(small.size);
    // 站名下面一道细细的灰线（和“位置”那一行的链接一样）：往下一站去只有这一处，要看得出点得动；小字那一行没有线
    expect(name.underline, `${label}：站名下面的线`).toBe(`underline solid 1px ${INK_FAINT}`);
    expect(small.underline, `${label}：小字那一行没有线`).toMatch(/^none /);
    // 上下两行，各是各的一行（一大一小不挤在同一行里）；站名只占一行
    expect(name.box.top, `${label}：站名在小字的下面`).toBeGreaterThanOrEqual(small.box.bottom - 0.5);
    expect(name.box.height, `${label}：站名只占一行`).toBeCloseTo(name.lineHeight, 0);
    // 整格都点得动：一直到那一条的底，不小于 44 像素见方；两头和正文那一栏的左右边对齐
    expect(cell.box.height, `${label}：那一格的高`).toBeGreaterThanOrEqual(TAP);
    expect(cell.box.width, `${label}：那一格的宽`).toBeGreaterThanOrEqual(TAP);
    expect(cell.box.bottom, `${label}：那一格到那一条的底`).toBeCloseTo(got.bar.bottom, 0);
    if (rel === 'prev') {
      expect(cell.box.left, `${label}：左边那一格和正文的左边对齐`).toBeCloseTo(got.column.left, 0);
      expect(name.ink.left, `${label}：站名从那一格的左边排起`).toBeCloseTo(cell.box.left, 0);
      expect(name.ink.right, `${label}：站名没有伸出那一格`).toBeLessThanOrEqual(cell.box.right + 0.5);
    } else {
      expect(cell.box.right, `${label}：右边那一格和正文的右边对齐`).toBeCloseTo(got.column.right, 0);
      expect(name.ink.right, `${label}：站名排到那一格的右边`).toBeCloseTo(cell.box.right, 0);
      expect(name.ink.left, `${label}：站名没有伸出那一格`).toBeGreaterThanOrEqual(cell.box.left - 0.5);
    }
  };
  /** 空着的一格。 */
  const expectEmpty = (cell: BarCell, label: string): void => {
    expect({ tag: cell.tag, text: cell.text }, label).toEqual({ tag: 'span', text: '' });
  };
  /** 那一条自己：钉在底边，多高多宽，页面的颜色、平的，上边一道线；文字栏和它两边都没有竖着的细线。 */
  const expectBarBox = (got: BarReading, side: boolean, label: string): void => {
    expect(got.position, `${label}：那一条钉在屏幕上`).toBe('fixed');
    expect(got.bar.bottom, `${label}：那一条贴着窗口的底边`).toBe(got.window.height);
    expect(got.bar.height, `${label}：那一条的高`).toBe(side ? BAR_H.wide : BAR_H.narrow);
    expect(got.bar.left, `${label}：那一条的左边`).toBe(0);
    expect(got.bar.width, `${label}：那一条的宽`).toBe(side ? got.leaf.width : got.window.width);
    expect({ ground: got.ground, picture: got.picture, topEdge: got.topEdge }, `${label}：那一条是页面的颜色、平的，上边一道线`).toEqual({ ground: PAGE, picture: 'none', topEdge: '1px solid' });
    // 哪种版面上，文字栏和那一条两边都没有竖着的细线（side 只管上面那一条多宽）
    expect(got.leafRules.map((rule) => rule.content), `${label}：文字栏两边没有竖着的细线`).toEqual(['none', 'none']);
    expect(got.barRules.map((rule) => rule.content), `${label}：那一条里没有竖着的细线`).toEqual(['none', 'none']);
  };

  for (const size of WINDOWS) {
    const side = sideBySide(size);
    const where = nameOf(size);

    // ---- 有沙盘的一站（前后都有站）：三格
    await openAt(page, size, `#/${figureId}/${found.stopId}`);
    await expectStageAt(page, headingsOf(found.scene)[0]);
    await expect(page.locator('.guide-open')).toBeVisible();
    await fontsReady(page);
    await page.mouse.move(0, 0);
    const got = await readBar(page);
    expectBarBox(got, side, where);
    expect(got.cells, `${where}：那一条里是三格`).toHaveLength(3);
    const [left, ask, right] = got.cells;
    expectLink(left, 'prev', at - 1, got, where);
    expectLink(right, 'next', at + 1, got, where);
    // “问讲解员”：平常是一块白底的板——一圈强调色的线，强调色的黑体字，前面没有画出来的记号；在正中，和两头不挨着
    expect({ tag: ask.tag, text: ask.text, ground: ask.ground, colour: ask.colour, edge: ask.edge, mark: ask.mark }, `${where}：“问讲解员”平常的样子`).toEqual({
      tag: 'button',
      text: '问讲解员',
      ground: PLATE,
      colour: FRAME_ACCENT,
      edge: `1px solid ${FRAME_ACCENT}`,
      mark: 'none',
    });
    expect(ask.family, `${where}：“问讲解员”是黑体`).toMatch(/^"?Yanlu Sans/);
    expect(ask.size, `${where}：“问讲解员”的字号`).toBeGreaterThanOrEqual(16);
    expect(ask.box.height, `${where}：“问讲解员”的高`).toBeGreaterThanOrEqual(TAP);
    expect((ask.box.left + ask.box.right) / 2, `${where}：“问讲解员”在正文那一栏的正中`).toBeCloseTo((got.column.left + got.column.right) / 2, 0);
    expect(left.box.right, `${where}：左边那一格不压着“问讲解员”`).toBeLessThanOrEqual(ask.box.left);
    expect(right.box.left, `${where}：右边那一格不压着“问讲解员”`).toBeGreaterThanOrEqual(ask.box.right);
    expect(ask.box.top, `${where}：“问讲解员”在那一条里面`).toBeGreaterThanOrEqual(got.bar.top);
    expect(ask.box.bottom).toBeLessThanOrEqual(got.bar.bottom);
    // 鼠标移上去才铺强调色的底、字变成白的；挪开又回去
    await page.locator('.guide-open').hover();
    await expect.poll(async () => { const cell = (await readBar(page)).cells[1]; return { ground: cell.ground, colour: cell.colour }; }, { message: `${where}：鼠标移到“问讲解员”上` }).toEqual({ ground: FRAME_ACCENT, colour: ON_ACCENT });
    await page.mouse.move(0, 0);
    await expect.poll(async () => (await readBar(page)).cells[1].ground, { message: `${where}：鼠标挪开以后` }).toBe(PLATE);
    rows.push(
      `  ${where}：那一条 ${got.bar.width} × ${got.bar.height}；三格 ${Math.round(left.box.width)} / ${Math.round(ask.box.width)} / ${Math.round(right.box.width)} 像素宽；` +
        `“问讲解员”${ask.size}px，站名 ${left.name?.size}px，小字 ${left.label?.size}px`,
    );

    // ---- 各站里最长的两个短名字换到两头（现在挨着写好了的站的名字都只有两个字；那几站写好以后就是这个样子）：三格还放得下
    await page.evaluate((names) => {
      document.querySelectorAll('.guide-dock .walk-name').forEach((name, i) => {
        name.textContent = names[i];
      });
    }, longest);
    const long = await readBar(page);
    const [longLeft, longAsk, longRight] = long.cells;
    for (const [cell, text, which] of [
      [longLeft, longest[0], '左'],
      [longRight, longest[1], '右'],
    ] as const) {
      const name = cell.name;
      if (name === null) throw new Error('那一格里没有站名');
      expect(name.text).toBe(text);
      expect(name.box.height, `${where}：${which}边换成“${text}”，还是一行`).toBeCloseTo(name.lineHeight, 0);
      expect(name.ink.left, `${where}：“${text}”没有伸出${which}边那一格`).toBeGreaterThanOrEqual(cell.box.left - 0.5);
      expect(name.ink.right, `${where}：“${text}”没有伸出${which}边那一格`).toBeLessThanOrEqual(cell.box.right + 0.5);
    }
    expect(longLeft.box.right, `${where}：左边换成最长的名字，不压着“问讲解员”`).toBeLessThanOrEqual(longAsk.box.left);
    expect(longRight.box.left, `${where}：右边换成最长的名字，不压着“问讲解员”`).toBeGreaterThanOrEqual(longAsk.box.right);
    expect({ left: longAsk.box.left, right: longAsk.box.right }, `${where}：换了名字，“问讲解员”不挪地方`).toEqual({ left: ask.box.left, right: ask.box.right });
    rows.push(`      换成“${longest[0]}”“${longest[1]}”：站名 ${Math.round((longLeft.name?.ink.right ?? 0) - (longLeft.name?.ink.left ?? 0))} 和 ${Math.round((longRight.name?.ink.right ?? 0) - (longRight.name?.ink.left ?? 0))} 像素宽，格子 ${Math.round(longLeft.box.width)} 像素宽`);

    // ---- 正文的最后一行滚得到这一条上面
    await scrollToBottom(page);
    const lastLine = await page.locator('.stop-nav-list').evaluate((el) => el.getBoundingClientRect().bottom);
    expect(lastLine, `${where}：滚到底，“回到各站目录”的下边在那一条的上边以上`).toBeLessThanOrEqual(got.bar.top);

    // ---- 点开“问讲解员”
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('.guide-open').click();
    await expect(page.locator('.guide-panel')).toBeVisible();
    await foldBodiesReady(page);
    await expect(page.locator('.guide-panel .guide-form')).toBeVisible();
    await fontsReady(page);
    await page.mouse.move(0, 0);
    const panel = await page.evaluate(() => {
      const need = (selector: string): HTMLElement => {
        const el = document.querySelector<HTMLElement>(selector);
        if (!el) throw new Error(`页面上没有 ${selector}`);
        return el;
      };
      const box = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
      };
      const sheet = need('.guide-panel');
      const style = getComputedStyle(sheet);
      const title = need('.guide-head h2');
      const titleStyle = getComputedStyle(title);
      const dot = getComputedStyle(title, '::before');
      const close = need('.guide-close');
      const closeStyle = getComputedStyle(close);
      const send = need('.guide-form button') as HTMLButtonElement;
      const sendStyle = getComputedStyle(send);
      const leaf = box(need('.reading'));
      // 面板下面露没露出正文：窗口最下面那一行像素上，文字栏正中的那一点，点到的是不是面板
      const under = document.elementFromPoint((leaf.left + Math.min(leaf.right, window.innerWidth)) / 2, window.innerHeight - 2);
      return {
        window: { width: window.innerWidth, height: window.innerHeight },
        sheet: box(sheet),
        position: style.position,
        ground: style.backgroundColor,
        picture: style.backgroundImage,
        topEdge: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
        shadow: style.boxShadow,
        barShown: need('.guide-dock').getClientRects().length > 0,
        underIsSheet: under !== null && sheet.contains(under),
        leaf,
        column: box(need('.reading-inner')),
        pane: box(need('.stage-pane')),
        head: box(need('.guide-head')),
        firstLine: box(need('.guide-head + p')),
        title: { text: title.textContent ?? '', family: titleStyle.fontFamily, size: parseFloat(titleStyle.fontSize), colour: titleStyle.color, mark: dot.content },
        close: { text: close.textContent ?? '', family: closeStyle.fontFamily, size: parseFloat(closeStyle.fontSize), colour: closeStyle.color, box: box(close) },
        samples: { marks: getComputedStyle(need('.guide-samples')).listStyleType, size: parseFloat(getComputedStyle(need('.guide-samples li')).fontSize) },
        send: { ground: sendStyle.backgroundColor, family: sendStyle.fontFamily, disabled: send.disabled },
      };
    });
    expect({ position: panel.position, ground: panel.ground, picture: panel.picture, topEdge: panel.topEdge }, `${where}：面板是一块白底的板，平的，上边一道细线`).toEqual({
      position: 'fixed',
      ground: PLATE,
      picture: 'none',
      topEdge: `1px solid ${LINE_STRONG}`,
    });
    expect(panel.shadow, `${where}：面板上边压着一道影子`).not.toBe('none');
    expect(panel.barShown, `${where}：面板开着的时候，那一条收起来`).toBe(false);
    expect(panel.sheet.bottom, `${where}：面板一直到窗口的底边`).toBe(panel.window.height);
    expect(panel.underIsSheet, `${where}：面板下面不露出正文`).toBe(true);
    expect(panel.sheet.left, `${where}：面板的左边`).toBe(0);
    if (side) {
      // 横排的版面：和文字栏一样宽，不伸到沙盘栏上；上面留着一截页面
      expect(panel.sheet.width, `${where}：面板和文字栏一样宽`).toBe(panel.leaf.width);
      expect(panel.sheet.right, `${where}：面板不挡沙盘`).toBeLessThanOrEqual(panel.pane.left + 1);
      expect(panel.sheet.top, `${where}：面板上面留着一截页面`).toBeGreaterThanOrEqual(64);
    } else {
      // 别的窗口：和窗口一样宽，最高到窗口的四分之三
      expect(panel.sheet.width, `${where}：面板和窗口一样宽`).toBe(panel.window.width);
      expect(panel.sheet.height, `${where}：面板最高到窗口的四分之三`).toBeLessThanOrEqual(panel.window.height * 0.75 + 0.5);
    }
    // 里面的字和正文那一栏一样宽、左右对齐（竖着拿的大平板上，正文那一栏在窗口正中，只有 570 像素宽）
    expect(panel.head.left, `${where}：面板里的字和正文的左边对齐`).toBeCloseTo(panel.column.left, 0);
    expect(panel.head.right, `${where}：面板里的字和正文的右边对齐`).toBeCloseTo(panel.column.right, 0);
    expect(panel.firstLine.left).toBeCloseTo(panel.column.left, 0);
    expect(panel.firstLine.right).toBeLessThanOrEqual(panel.column.right + 0.5);
    // 标题：深灰的黑体，前面没有画出来的记号；“关闭”：黑体小字，能点的地方 44 像素见方
    expect({ text: panel.title.text, size: panel.title.size, colour: panel.title.colour, mark: panel.title.mark }, `${where}：面板的标题`).toEqual({
      text: '问讲解员',
      size: 20,
      colour: FRAME_INK,
      mark: 'none',
    });
    expect(panel.title.family).toMatch(/^"?Yanlu Sans/);
    expect({ text: panel.close.text, size: panel.close.size, colour: panel.close.colour }, `${where}：“关闭”`).toEqual({ text: '关闭', size: 14, colour: FRAME_SOFT });
    expect(panel.close.family).toMatch(/^"?Yanlu Sans/);
    expect(panel.close.box.width).toBeGreaterThanOrEqual(TAP);
    expect(panel.close.box.height).toBeGreaterThanOrEqual(TAP);
    // 示例问题前面没有圆点；“发送”用不了的时候不铺底
    expect(panel.samples, `${where}：示例问题`).toEqual({ marks: 'none', size: 17 });
    expect({ ground: panel.send.ground, disabled: panel.send.disabled }, `${where}：“发送”`).toEqual({ ground: NO_FILL, disabled: true });
    expect(panel.send.family).toMatch(/^"?Yanlu Sans/);
    rows.push(
      `      面板 ${panel.sheet.width} × ${Math.round(panel.sheet.height)}，上边在 ${Math.round(panel.sheet.top)}；` +
        `里面的字从 ${Math.round(panel.head.left)} 到 ${Math.round(panel.head.right)}（正文 ${Math.round(panel.column.left)} 到 ${Math.round(panel.column.right)}）`,
    );
    await page.keyboard.press('Escape');
    await expect(page.locator('.guide-panel')).toHaveCount(0);
    await expect(page.locator('.guide-dock')).toBeVisible();

    // ---- 头一站：左边空着。最后一站：右边空着。中间有没有“问讲解员”，看这一站写没写
    for (const [index, which] of [
      [0, '头一站'],
      [stops.length - 1, '最后一站'],
    ] as const) {
      const stop = stops[index];
      const label = `${where}，${which}（${stop.shortTitle}）`;
      await openAt(page, size, `#/${figureId}/${stop.id}`);
      await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', stop.id);
      await expect(page.locator('.stop-page')).not.toHaveAttribute('data-stop-text', 'loading');
      await fontsReady(page);
      const end = await readBar(page);
      expectBarBox(end, side, label);
      expect(end.cells, `${label}：那一条里是三格`).toHaveLength(3);
      if (index === 0) expectEmpty(end.cells[0], `${label}：左边那一格空着`);
      else expectLink(end.cells[0], 'prev', index - 1, end, label);
      if (stop.status === 'complete') expect(end.cells[1].tag, `${label}：中间是“问讲解员”`).toBe('button');
      else expectEmpty(end.cells[1], `${label}：这一站还没写，中间空着`);
      if (index === stops.length - 1) expectEmpty(end.cells[2], `${label}：右边那一格空着`);
      else expectLink(end.cells[2], 'next', index + 1, end, label);
    }
  }
  console.log(['贴着底边的那一条和讲解员面板：', ...rows].join('\n'));
});

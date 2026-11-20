// 正文那一栏（那一页纸）的样子，在真的页面上量。只量说得出数的几样；好不好看要看照片。
//
// 一、一行多少个字。四种标准的窗口上，正文的宽度除以字号：横排的版面（窗口 960 像素宽以上、而且横着）18 到 24 个字，
//     竖着拿的平板（小的和大的）28 到 32 个字。另外真的数一遍：把正文里每个字在哪一行找出来，全是汉字和全角标点的行里最满的一行，
//     就是算出来的那个数。段首空两个字，两端对齐。人物页的介绍也一样。
// 二、可以点开小注的词：下面一道红色的虚线，是分开写的那几条属性算出来的（text-decoration-line 这些；合成一句的写法
//     iPad 上的 Safari 到 26.2 版才认。这里只证明 Chromium 里有这道线；Safari 靠 tests/fonts/font-files.test.ts 和
//     tests/build/dist-size.test.ts 查写法）。词没有底色；点开以后字变红；能点的地方有一行那么高。
// 三、正文那一栏里能点的东西，都不小于 44 像素见方：位置那一行的链接、目录里的每一站、“读原文”“凭据”那一行、
//     小注的“关闭”、“图片出处”、上一站和下一站、回到目录、“到沙盘”、“问讲解员”、“没找到”页面上的链接。
//     量法：它的框不小于 44 像素见方；再像手指那样点，把它滚到看得见正文的那一块的正中，在它正中的上、下、左、右
//     各 21 像素的地方看点到的是不是它（没有被别的东西盖住）。“图片出处”看着只有一行高，能点的地方是撑大了的，只看点不点得到。
//     正文里可以点开的词在一行字中间，不要求 44 像素，要求有一行那么高。
// 四、“读原文”“凭据”那一行：折着显加号，点开显减号，都是页面上真的字；记号是宋体，名字是楷体。
//     抬头里的小方块、目录里的数字印、宽屏上那一页纸到底：各量一下。
//
// 沙盘用的是替身（?stage=fake）。数从真的页面和 content/ 里真的文件读，不另写一遍。

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { STANDARD_PANES } from '../stage/support/standardPanes';
import { expectStageAt, expectStill, fakeUrl, firstWrittenStopWithoutScene, fontsReady, headingsOf, openFigureWithTable } from './helpers';

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
      // 每个字在哪一行：照它的框的上边分行（同一行里楷体、宋体不混排，上边是齐的；差不到半行的算同一行）
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

test('可以点开小注的词：下面一道红色的虚线，没有底色；点开以后字变红；能点的地方有一行那么高', async ({ page }) => {
  const { figureId, found } = await openFigureWithTable(page, fakeUrl('#/'));
  test.skip(!found, '还没有哪一站有沙盘');
  if (!found) return;
  await page.goto(fakeUrl(`#/${figureId}/${found.stopId}`));
  await expectStageAt(page, headingsOf(found.scene)[0]);
  await fontsReady(page);

  const read = () =>
    page.evaluate(() => {
      // 印泥红在这个浏览器里算出来是什么写法：拿一个元素现算
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
    expect(term.thick, `${label}的线的粗细`).toBe('2px');
    expect(term.ground, `${label}的底色`).toBe('rgba(0, 0, 0, 0)');
    expect(term.colour, `${label}没点开的时候字的颜色`).toBe(before.ink);
    expect(term.shortBy, `${label}能点的地方比一行矮了多少像素`).toBeLessThanOrEqual(0.5);
  }
  console.log(`${before.terms.length} 个可以点开的词：线都是 ${before.terms[0].line} ${before.terms[0].dots} ${before.terms[0].lineColour} ${before.terms[0].thick}`);

  // 点开头一个：字变红，线还在，还是没有底色（鼠标挪开再量，不把“鼠标移上去”的样子算进来）
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
  const notWritten = stops.find((stop) => !stop.written)?.id ?? null;

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
    const check = async (where: string, atLeast: Record<string, number>): Promise<void> => {
      const { checked, problems } = await tapProblems(page);
      const label = `${nameOf(size)}，${where}`;
      console.log(`${label}：查了 ${Object.entries(checked).map(([kind, count]) => `${kind} ${count} 个`).join('，')}`);
      for (const [kind, count] of Object.entries(atLeast)) expect(checked[kind] ?? 0, `${label}：${kind} 该查到至少 ${count} 个`).toBeGreaterThanOrEqual(count);
      expect(problems, `${label}：这几样东西不够大，或者点不到`).toEqual([]);
    };

    // 人物页：位置那一行、目录里的每一站
    await openAt(page, size, `#/${figureId}`);
    await expect(page.locator('.stop-item').first()).toBeVisible();
    await expectStill(page);
    await check('人物页', { a: 1, 'a.stop-item': stops.length });

    // 有沙盘的一站：小注、原文、凭据都点开
    await openAt(page, size, `#/${figureId}/${found.stopId}`);
    await expectStageAt(page, headingsOf(found.scene)[0]);
    const opened = await openAll();
    expect(opened.notes).toBeGreaterThan(0);
    await expect(page.locator('.provenance-body')).toBeVisible();
    await check('有沙盘的一站，都点开', {
      a: 2,
      'span.note-term': opened.notes,
      'button.note-close': opened.notes,
      summary: opened.folds,
      'a.stop-nav-link': 1,
      'a.stop-nav-list': 1,
      'button.skip-to-stage': 1,
      'button.guide-open': 1,
    });

    // 写好了、还没有沙盘的一站（这一站的正文里有图片的话，“图片出处”也在里面）
    if (noTable) {
      await openAt(page, size, `#/${figureId}/${noTable}`);
      await expect(page.locator('.text-section').first()).toBeVisible();
      await expectStill(page);
      const openedHere = await openAll();
      const credits = await page.locator('.stop-image-credit a').count();
      await check('没有沙盘的一站，都点开', { 'span.note-term': openedHere.notes, summary: openedHere.folds, ...(credits > 0 ? { a: 2 + credits } : {}) });
    }

    // 还没写的一站
    if (notWritten) {
      await openAt(page, size, `#/${figureId}/${notWritten}`);
      await expect(page.locator('.not-written')).toBeVisible();
      await check('还没写的一站', { a: 2, 'a.stop-nav-list': 1 });
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

test('“读原文”“凭据”折着显加号、点开显减号；抬头里的小方块、目录里的数字印；宽屏上那一页纸到底', async ({ page }) => {
  const { figureId, found } = await openFigureWithTable(page, fakeUrl('#/'));
  test.skip(!found, '还没有哪一站有沙盘');
  if (!found) return;
  const stops = await page.locator('.stop-item').evaluateAll((items) => items.map((item) => ({ id: item.getAttribute('data-stop-id') ?? '', written: item.getAttribute('data-stop-status') === 'complete' })));
  await fontsReady(page);

  // ---- 目录：每一站至少 64 像素高；数字印 24 像素见方，楷体；还没写的一站，印只有一圈线
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
    expect(row.seal).toBe('24 × 24');
    expect(row.sealFamily).toMatch(/^"?Yanlu Kai/);
    expect(row.titleFamily).toMatch(/^"?Yanlu Kai/);
    // 站名比下面的摘要大：不再显得比摘要轻
    expect(row.titleSize).toBeGreaterThan(row.summarySize);
    if (stops[i].written) expect(row.sealGround, `写好的第 ${i + 1} 站，印是涂红的`).not.toBe('rgba(0, 0, 0, 0)');
    else expect(row.sealGround, `还没写的第 ${i + 1} 站，印只有一圈线`).toBe('rgba(0, 0, 0, 0)');
  }

  // ---- 有沙盘的一站
  await page.goto(fakeUrl(`#/${figureId}/${found.stopId}`));
  await expectStageAt(page, headingsOf(found.scene)[0]);
  await fontsReady(page);

  // 抬头里的小方块：一站一个，9 像素见方，只有这一站的涂了红
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

  // “读原文”“凭据”那一行：折着的时候看得见的是加号，点开是减号；记号是宋体，名字是楷体；一行至少 48 像素高
  const folds = page.locator('details.original, details.provenance');
  const count = await folds.count();
  expect(count).toBeGreaterThan(1);
  for (let i = 0; i < count; i++) {
    const fold = folds.nth(i);
    const mark = fold.locator('summary .fold-mark');
    const label = fold.locator('summary .fold-label');
    await expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(await mark.evaluate((el: HTMLElement) => el.innerText)).toBe('+');
    expect(await mark.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Yanlu Song/);
    expect(await label.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Yanlu Kai/);
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

  // ---- 宽屏上，正文再短，那一页纸也到屏幕的底边（拿还没写的一站量）；纸上有纹理
  const notWritten = stops.find((stop) => !stop.written)?.id;
  if (notWritten) {
    await page.goto(fakeUrl(`#/${figureId}/${notWritten}`));
    await expect(page.locator('.not-written')).toBeVisible();
    const leaf = await page.locator('.reading').evaluate((el) => ({ bottom: el.getBoundingClientRect().bottom, grain: getComputedStyle(el).backgroundImage.includes('data:image/svg+xml'), window: window.innerHeight }));
    expect(leaf.bottom, '那一页纸的下边').toBeGreaterThanOrEqual(leaf.window);
    expect(leaf.grain, '那一页纸上有没有纹理').toBe(true);
  }
});

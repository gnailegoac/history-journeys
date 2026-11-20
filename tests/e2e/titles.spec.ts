// 各站的大标题怎么折行，在真的页面上量。
//
// 标题在标点后面折行（“汴京：/御史台的一百三十天”）；标点之间的那一截自己就比一行长的时候，浏览器只好从中间断，
// 最后一行就可能只剩一个字（“汴京：/御史台的一百三十/天”）——窗口 1280 到 1388 像素宽的时候出过这个毛病：
// 那时文字栏还没长到头，47 像素的字一行放不下九个。现在标题到 1400 像素宽才放大（src/styles/tokens.css）。
//
// 这里把每一站都真的打开，把窗口从窄到宽一档一档拉过去（每档 20 像素）：
//   横排的版面（文字在左、沙盘在右）  窗口 960 到 1920 像素宽，高 800（横着）
//   沙盘在上的版面                    窗口 600 到 1100 像素宽，高 1400（竖着）
// 每一档看标题的每个字落在哪一行：折了行的标题，最后一行不能只有一个字。
// 另外：四种标准的窗口上，标题的字号是 47、38、40、40 像素，没有因为挪了放大的那一档而变。
//
// 站名照 content/ 里真的文件，页面上的标题要和它一样；沙盘用的是替身（?stage=fake）。
// 这只证明 Chromium 里是这样；别的浏览器一行能放下几个字可能差出一点（标题右边为此让出了一截，见 base.css 的 .page-title）。

import { expect, test } from '@playwright/test';
import type { Figure } from '../../src/domain/types';
import { STANDARD_PANES } from '../stage/support/standardPanes';
import { readBytes } from '../support/readBytes';
import { fakeUrl, fontsReady, openFirstFigure } from './helpers';

/** 两种版面各拉哪一段窗口宽度。shape 是这一段里沙盘栏该是哪种排法（layout.css 写在栏上的 --stage-shape）。 */
const RANGES = [
  { name: '横排的版面', shape: 'wide', from: 960, to: 1920, height: 800 },
  { name: '沙盘在上的版面', shape: 'narrow', from: 600, to: 1100, height: 1400 },
] as const;
const STEP = 20;
/** 四种标准的窗口上，一页的大标题多大（像素）。 */
const TITLE_PX: Record<string, number> = { '1440 × 900': 47, '1024 × 768': 38, '768 × 1024': 40, '1024 × 1366': 40 };

test('各站的大标题：窗口从窄到宽一档一档拉过去，折了行的标题最后一行都不只剩一个字；四种标准的窗口上字号不变', async ({ page }) => {
  test.setTimeout(240_000);
  const figureId = await openFirstFigure(page);
  const figure = JSON.parse(new TextDecoder().decode(readBytes(`content/figures/${figureId}/figure.json`))) as Figure;
  expect(figure.stops.length).toBeGreaterThan(1);

  /** 标题现在的样子：每一行是哪几个字，字号，字体，沙盘栏是哪种排法。 */
  const readTitle = (): Promise<{ lines: string[]; size: number; family: string; shape: string }> =>
    page.evaluate(() => {
      const title = document.querySelector<HTMLElement>('.page-title');
      const pane = document.querySelector('.stage-pane');
      if (!title || !pane) throw new Error('页面上没有标题，或者没有沙盘栏');
      const lines: string[] = [];
      let top: number | null = null;
      const range = document.createRange();
      const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent ?? '';
        for (let i = 0; i < text.length; i++) {
          range.setStart(node, i);
          range.setEnd(node, i + 1);
          const box = range.getClientRects()[0];
          if (!box) continue;
          // 上边差出小半行的，是另一行
          if (top === null || Math.abs(box.top - top) > box.height / 2) {
            lines.push('');
            top = box.top;
          }
          lines[lines.length - 1] += text[i];
        }
      }
      const style = getComputedStyle(title);
      return { lines, size: parseFloat(style.fontSize), family: style.fontFamily, shape: getComputedStyle(pane).getPropertyValue('--stage-shape').trim() };
    });

  const report: string[] = [];
  let measured = 0;
  let folded = 0;
  for (const stop of figure.stops) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('about:blank');
    await page.goto(fakeUrl(`#/${figureId}/${stop.id}`));
    await expect(page.locator('.page-title')).toHaveText(stop.title);
    await fontsReady(page);

    for (const range of RANGES) {
      const alone: string[] = [];
      /** 这一段里标题折成过哪几种样子，各从多宽到多宽。 */
      const shapes = new Map<string, number[]>();
      for (let width = range.from; width <= range.to; width += STEP) {
        await page.setViewportSize({ width, height: range.height });
        const got = await readTitle();
        measured++;
        expect(got.shape, `窗口 ${width} × ${range.height}：该是${range.name}`).toBe(range.shape);
        expect(got.family, `“${stop.title}”是楷体`).toMatch(/^"?Yanlu Kai/);
        expect(got.lines.join(''), '量到的每一行合起来就是标题').toBe(stop.title);
        const shape = `${got.size}px ${got.lines.join(' / ')}`;
        shapes.set(shape, [...(shapes.get(shape) ?? []), width]);
        if (got.lines.length > 1) {
          folded++;
          if (Array.from(got.lines[got.lines.length - 1]).length === 1) alone.push(`${width}（${got.lines.join(' / ')}）`);
        }
      }
      expect(alone, `“${stop.title}”在${range.name}上，窗口这么宽的时候最后一行只剩一个字`).toEqual([]);
      report.push(`  ${stop.title}，${range.name}：${[...shapes].map(([shape, widths]) => `${widths[0]}–${widths[widths.length - 1]} ${shape}`).join('；')}`);
    }

    // 四种标准的窗口上，字号还是原来的
    for (const pane of STANDARD_PANES) {
      await page.setViewportSize(pane.window);
      const name = `${pane.window.width} × ${pane.window.height}`;
      expect(TITLE_PX[name], `这里没有写 ${name} 上标题该多大`).toBeDefined();
      expect((await readTitle()).size, `窗口 ${name}：“${stop.title}”的字号`).toBe(TITLE_PX[name]);
    }
  }
  // 真的量到了折行的标题（不然这一项什么也没查到）
  expect(measured).toBe(figure.stops.length * RANGES.reduce((sum, range) => sum + Math.floor((range.to - range.from) / STEP) + 1, 0));
  expect(folded).toBeGreaterThan(20);
  console.log([`各站的标题怎么折行（${figure.stops.length} 站，量了 ${measured} 次，其中折了行的 ${folded} 次，最后一行只剩一个字的 0 次）：`, ...report].join('\n'));
});

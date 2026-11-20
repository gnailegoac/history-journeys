// 题签上的站号的印（src/stage/overlay/strips.ts）和每一站的印从哪来（src/domain/stopMarks.ts）。在 Node 里跑，用那个很小的假 DOM。
// 查这几件：
//   带印的题签：名字后面一站一方，每一方是一个链接，带着站的 id、实心还是空心、是不是这一小节讲的那一站、读屏软件念的话；
//     键盘不停在印上（tabindex 是 -1）；题签上多一个类名 has-seals（样式表靠它让题签按得动、去掉脚上的小印）；
//   没有印的题签和以前一样：只有字，类名只有 strip；
//   按在名字上（印的外面）等于按头一方印；按在哪一方印上就是那一方，不另外替人按头一方；没有印的题签按了没有事；
//   stopMarks：印上的字是站的先后（一到十，再多写数字），写好了的站是实心的，网址是交进来的写法，读屏软件念“第几站，标题”，没写的添一句。
// 印的大小、按得到的地方多大，是样式表的事，要在浏览器里量（数在 tests/stage/support/stripSizes.ts 的说明里）。

import { describe, expect, it } from 'vitest';
import { stopMarks } from '../../../src/domain/stopMarks';
import type { Figure } from '../../../src/domain/types';
import { mountStrips } from '../../../src/stage/overlay';
import type { StripSeal, StripSpec } from '../../../src/stage/overlay';
import figureFile from '../../../content/figures/su-shi/figure.json';
import { SEALED_STRIP_SIZE, STRIP_SIZE, stripSize } from '../../stage/support/stripSizes';
import { readBytes } from '../../support/readBytes';
import { installMiniDom, type MiniElement } from './miniDom';

const doc = installMiniDom('');
const figure = figureFile as unknown as Figure;
/** 样式表原样的字（从磁盘读：测试里引 .css 文件拿到的是空的）。 */
const stageCss = new TextDecoder().decode(readBytes('src/styles/stage.css'));

function mounted(specs: StripSpec[]): { root: MiniElement; strips: MiniElement[] } {
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const layer = mountStrips(container as unknown as HTMLElement);
  layer.set(specs);
  const root = container.querySelector('.strips');
  if (!root) throw new Error('题签这一层没有挂上');
  return { root, strips: root.querySelectorAll('.strip') };
}

const seal = (stop: string, label: string, more: Partial<StripSeal> = {}): StripSeal => ({ stop, label, href: `#/su-shi/${stop}`, filled: false, here: false, title: `第${label}站`, ...more });

describe('题签上的站号的印', () => {
  const specs: StripSpec[] = [
    { id: 's-hangzhou', text: '杭州', tone: 'place', seals: [seal('hangzhou-1', '二', { here: true }), seal('hangzhou-2', '七')] },
    { id: 's-xuzhou', text: '徐州', tone: 'place', seals: [seal('xuzhou', '四', { filled: true, title: '第四站，徐州：大水围城' })] },
    { id: 's-dajiang', text: '大江', tone: 'water' },
    { id: 's-none', text: '湖州', tone: 'place', seals: [] },
  ];

  it('带印的题签：名字后面一站一方链接，带着站的 id、实心空心、是不是这一站、读屏软件念的话；键盘不停在印上', () => {
    const { strips } = mounted(specs);
    const [hangzhou, xuzhou] = strips;
    expect(hangzhou.className).toBe('strip has-seals');
    // 名字在前，印在后（竖写，印就在名字下面）
    expect(hangzhou.childNodes[0].nodeType).toBe(3);
    expect(hangzhou.childNodes[0].textContent).toBe('杭州');
    const seals = hangzhou.querySelectorAll('a');
    expect(seals.map((a) => a.textContent)).toEqual(['二', '七']);
    expect(hangzhou.childNodes.slice(1)).toEqual(seals);
    expect(seals.map((a) => a.getAttribute('class'))).toEqual(['strip-seal', 'strip-seal']);
    expect(seals.map((a) => a.getAttribute('href'))).toEqual(['#/su-shi/hangzhou-1', '#/su-shi/hangzhou-2']);
    expect(seals.map((a) => a.getAttribute('data-stop-id'))).toEqual(['hangzhou-1', 'hangzhou-2']);
    expect(seals.map((a) => a.getAttribute('data-here'))).toEqual(['true', 'false']);
    expect(seals.map((a) => a.getAttribute('data-filled'))).toEqual(['false', 'false']);
    expect(seals.map((a) => a.getAttribute('tabindex'))).toEqual(['-1', '-1']);
    const four = xuzhou.querySelectorAll('a');
    expect(four).toHaveLength(1);
    expect(four[0].getAttribute('data-filled')).toBe('true');
    expect(four[0].getAttribute('aria-label')).toBe('第四站，徐州：大水围城');
    // 印上不写鼠标停上去才出来的小字（title）：砍掉的一项
    expect(four[0].hasAttribute('title')).toBe(false);
  });

  it('没有印的题签和以前一样：只有字，类名只有 strip（印的单子是空的也算没有）', () => {
    const { strips } = mounted(specs);
    for (const plain of [strips[2], strips[3]]) {
      expect(plain.className).toBe('strip');
      expect(plain.querySelectorAll('a')).toEqual([]);
      expect(plain.childNodes).toHaveLength(1);
    }
    expect(strips[2].textContent).toBe('大江');
  });

  it('按在名字上等于按头一方印；按在哪一方印上就是那一方；没有印的题签按了没有事', () => {
    const { strips } = mounted(specs);
    const [hangzhou, , dajiang] = strips;
    const [first, second] = hangzhou.querySelectorAll('a');
    const pressed: string[] = [];
    for (const a of [first, second]) a.addEventListener('click', () => pressed.push(a.getAttribute('data-stop-id') ?? ''));
    // 按在题签上、印的外面（名字那一块）
    hangzhou.click();
    expect(pressed).toEqual(['hangzhou-1']);
    // 按在第二方印上：只有它，不另外替人按头一方
    second.click();
    expect(pressed).toEqual(['hangzhou-1', 'hangzhou-2']);
    first.click();
    expect(pressed).toEqual(['hangzhou-1', 'hangzhou-2', 'hangzhou-1']);
    // 没有印的题签
    dajiang.click();
    expect(pressed).toHaveLength(3);
  });
});

// 带印的题签多高，Node 里摆题签的测试是照 tests/stage/support/stripSizes.ts 里的数算的，页面上是 src/styles/stage.css 排出来的。
// 两处的数要对得上：这里把样式表里那几条规则读出来，和 stripSizes.ts 的数比（排出来是不是真的这么大，在浏览器里量过，见那个文件的说明）。
describe('样式表里印的大小，和摆题签的测试用的数是同一套', () => {
  /** 样式表里选择器正好是 selector 的那一条规则里，prop 这一项写的值。 */
  const rule = (selector: string, prop: string): string => {
    const at = stageCss.indexOf(`\n${selector} {`);
    if (at < 0) throw new Error(`样式表里没有这一条：${selector}`);
    const body = stageCss.slice(at, stageCss.indexOf('}', at));
    const found = new RegExp(`\\n\\s*${prop}:\\s*([^;]+);`).exec(body);
    if (!found) throw new Error(`${selector} 里没有写 ${prop}`);
    return found[1].trim();
  };
  const px = (value: string): number[] => value.split(/\s+/).map((part) => Number.parseFloat(part));
  const KINDS = [
    { kind: 'wide', pane: '' },
    { kind: 'narrow', pane: '.stage-pane:not(.is-wide) ' },
  ] as const;

  it.each(KINDS)('$kind 的栏：上垫 + 改过的下垫 = base；印的高 + 上面的空 = perSeal；印连左右缩进不比一行宽', ({ kind, pane }) => {
    const top = px(rule(`${pane}.strip`, 'padding'))[0];
    const side = px(rule(`${pane}.strip`, 'padding'))[1];
    const bottom = px(rule(`${pane}.strip.has-seals`, 'padding-bottom'))[0];
    expect(top + bottom).toBe(SEALED_STRIP_SIZE[kind].base);
    const height = px(rule(`${pane}.strip-seal`, 'height'))[0];
    const width = px(rule(`${pane}.strip-seal`, 'width'))[0];
    const margin = px(rule(`${pane}.strip-seal`, 'margin'));
    expect(margin).toHaveLength(3);
    expect(height + margin[0]).toBe(SEALED_STRIP_SIZE[kind].perSeal);
    expect(margin[2]).toBe(0);
    // 题签的宽 = 左右的垫 + 一行的宽（行高是 1，就是字号）；印连它左右的缩进正好这么宽，不把题签撑宽
    const font = px(rule(`${pane}.strip`, 'font-size'))[0];
    expect(side * 2 + font).toBe(STRIP_SIZE[kind].w);
    expect(width + margin[1] * 2).toBe(font);
    // 按得到的地方：四边各放出去这么多，至少 44 像素见方
    const out = -px(rule(`${pane}.strip-seal::after`, 'inset'))[0];
    expect(width + out * 2).toBeGreaterThanOrEqual(44);
    expect(height + out * 2).toBeGreaterThanOrEqual(44);
    // 上下挨着的两方印：下面那一方从两方中间管起，往下放够 44 像素
    const up = -px(rule(`${pane}.strip-seal + .strip-seal::after`, 'top'))[0];
    const down = -px(rule(`${pane}.strip-seal + .strip-seal::after`, 'bottom'))[0];
    expect(up).toBe(margin[0] / 2);
    expect(height + up + down).toBeGreaterThanOrEqual(44);
  });

  it('带印的题签按得动，脚上不再画那方小印', () => {
    expect(rule('.strip.has-seals', 'pointer-events')).toBe('auto');
    expect(rule('.strip.has-seals::after', 'content')).toBe('none');
  });

  it('照这几个数：徐州 72 像素高，杭州（两方印）94，昌化军 91；窄的栏上 58、76、74', () => {
    expect([stripSize('徐州', 'wide', 1).h, stripSize('杭州', 'wide', 2).h, stripSize('昌化军', 'wide', 1).h]).toEqual([72, 94, 91]);
    expect([stripSize('徐州', 'narrow', 1).h, stripSize('杭州', 'narrow', 2).h, stripSize('昌化军', 'narrow', 1).h]).toEqual([58, 76, 74]);
  });
});

describe('每一站的印从 figure.json 里拼（stopMarks）', () => {
  const marks = stopMarks(figure, (id) => `#/${figure.id}/${id}`);

  it('一站一方，印上的字是站的先后；写好了的站是实心的；网址是交进来的写法', () => {
    expect(Object.keys(marks)).toEqual(figure.stops.map((stop) => stop.id));
    expect(figure.stops.map((stop) => marks[stop.id].label).join('')).toBe('一二三四五六七八九十'.slice(0, figure.stops.length));
    for (const stop of figure.stops) {
      expect(marks[stop.id].written, stop.id).toBe(stop.status === 'complete');
      expect(marks[stop.id].href).toBe(`#/${figure.id}/${stop.id}`);
    }
    // 现在写好了的是徐州和黄州
    expect(figure.stops.filter((stop) => marks[stop.id].written).map((stop) => stop.id)).toEqual(['xuzhou', 'huangzhou']);
  });

  it('读屏软件念的那一句：第几站，站的标题；还没写的添一句“还没写”', () => {
    expect(marks.xuzhou.title).toBe('第四站，徐州：大水围城');
    const unwritten = figure.stops.find((stop) => stop.status !== 'complete');
    if (!unwritten) throw new Error('这位人物的站都写好了，这一条查不了');
    expect(marks[unwritten.id].title).toBe(`第${marks[unwritten.id].label}站，${unwritten.title}，还没写`);
  });

  it('十站以后印上写数字', () => {
    const long: Figure = { ...figure, stops: Array.from({ length: 12 }, (_, i) => ({ ...figure.stops[0], id: `s${i}` })) };
    const made = stopMarks(long, (id) => id);
    expect(made.s9.label).toBe('十');
    expect(made.s10.label).toBe('11');
    expect(made.s11.label).toBe('12');
  });
});

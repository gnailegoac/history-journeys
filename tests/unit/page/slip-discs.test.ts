// 平着的纸条（另一种题签）：造出来的东西，和样式表里它的数。在 Node 里跑，用那个很小的假 DOM。竖着的纸条的那一份是 ./strip-seals.test.ts（一个字没有动）。
// 查这几件：
//   容器上记了另一种题签的那一层（页面那一边记的，这里照样记）：那一层上写着 data-kind='slip'；一条纸条不竖写；
//     站的号码是名字前头的圆，一站一个，每一个是链接，带着站的 id、实心还是空心、是不是这一小节讲的那一站、读屏软件念的话，键盘不停在上面；
//     名字自己包一层；是站的地名，它指的那一点上记着 data-stop；没有点的名字记着 data-area；
//   没有记的容器：造出来的还是竖着的纸条，和原来一样；
//   按在名字上等于按头一个圆；按在哪一个圆上就是那一个；
//   样式表里“平着的纸条”那一段的数，和摆题签的测试用的数（tests/stage/support/stripSizes.ts 的 SLIP_SIZE）是同一套；
//     圆按得到的地方 44 像素高，单独一个 44 见方，并排的两个：头一个从左边 12.5 像素起到两个圆正中间，后一个从正中间起、到名字那一块为止
//     （不盖着名字：按在名字上的哪里都是头一站）；
//     是站的地名那一点是印的颜色，别的规则里没有动圆点的大小；规则都照那一层上的 data-kind 挑，不认人物。
// 排出来是不是真的这么大，要在浏览器里量：content/ 里还没有一座沙盘用这一种，用它的人物进来的时候添。

import { describe, expect, it } from 'vitest';
import { labelsIn, mountStrips } from '../../../src/stage/overlay';
import type { StripSeal, StripSpec } from '../../../src/stage/overlay';
import { slipKit } from '../../../src/stage/overlay/slips';
import { SLIP_SIZE, slipSize } from '../../stage/support/stripSizes';
import { readBytes } from '../../support/readBytes';
import { installMiniDom, type MiniElement } from './miniDom';

const doc = installMiniDom('');
const stageCss = new TextDecoder().decode(readBytes('src/styles/stage.css'));
/** 样式表里“平着的纸条”那一段（从它的记号到文件末尾）。 */
const SLIP_CSS = stageCss.slice(stageCss.indexOf('平着的纸条（另一种题签） */'));

function mounted(specs: StripSpec[], slip = true): { root: MiniElement; svg: MiniElement } {
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  if (slip) labelsIn(container as unknown as HTMLElement, slipKit);
  const layer = mountStrips(container as unknown as HTMLElement);
  layer.set(specs);
  const root = container.querySelector('.strips');
  if (!root) throw new Error('题签这一层没有挂上');
  return { root, svg: root.childNodes[0] as MiniElement };
}

const seal = (stop: string, label: string, more: Partial<StripSeal> = {}): StripSeal => ({ stop, label, href: `#/traveller/${stop}`, filled: false, here: false, title: `第${label}站`, ...more });

const specs: StripSpec[] = [
  { id: 's-yi', text: '乙渡', tone: 'place', seals: [seal('bing', '二', { here: true }), seal('ding', '三', { filled: true, title: '第三站，丁镇：编出来的一站' })] },
  { id: 's-zi', text: '子河', tone: 'water' },
  { id: 's-ridge', text: '北岭', tone: 'place', area: true },
];

describe('平着的纸条：造出来的东西', () => {
  it('那一层上记着是哪一种；一条纸条不竖写，圆在名字前头（一站一个链接），名字自己包一层', () => {
    const { root } = mounted(specs);
    expect(root.getAttribute('data-kind')).toBe('slip');
    const slips = root.querySelectorAll('.strip-slip');
    expect(slips.map((el) => el.getAttribute('data-strip-id'))).toEqual(['s-yi', 's-zi', 's-ridge']);
    // 竖着的纸条的类名一个也没有
    expect(root.querySelectorAll('.strip')).toEqual([]);
    expect(root.querySelectorAll('.strip-seal')).toEqual([]);
    const [yi, zi] = slips;
    expect(yi.className).toBe('strip-slip has-seals');
    expect(yi.style.writingMode).toBe('');
    expect(yi.style.display).toBe('flex');
    expect(yi.style.whiteSpace).toBe('nowrap');
    expect(yi.style.position).toBe('absolute');
    // 先后：两个圆，然后名字
    expect(yi.childNodes.map((node) => (node as MiniElement).className)).toEqual(['strip-disc', 'strip-disc', 'strip-name']);
    const discs = yi.querySelectorAll('a');
    expect(discs.map((a) => a.textContent)).toEqual(['二', '三']);
    expect(discs.map((a) => a.getAttribute('href'))).toEqual(['#/traveller/bing', '#/traveller/ding']);
    expect(discs.map((a) => a.getAttribute('data-stop-id'))).toEqual(['bing', 'ding']);
    expect(discs.map((a) => a.getAttribute('data-here'))).toEqual(['true', 'false']);
    expect(discs.map((a) => a.getAttribute('data-filled'))).toEqual(['false', 'true']);
    expect(discs.map((a) => a.getAttribute('tabindex'))).toEqual(['-1', '-1']);
    expect(discs[1].getAttribute('aria-label')).toBe('第三站，丁镇：编出来的一站');
    const name = yi.querySelector('.strip-name');
    expect(name?.localName).toBe('span');
    expect(name?.textContent).toBe('乙渡');
    // 没有圆的一条：只有名字那一层，类名只有 strip-slip；水名记着 tone
    expect(zi.className).toBe('strip-slip');
    expect(zi.childNodes.map((node) => (node as MiniElement).className)).toEqual(['strip-name']);
    expect(zi.getAttribute('data-tone')).toBe('water');
  });

  it('是站的地名，它指的那一点上记着 data-stop，别的点没有；没有点的名字记着 data-area，别的没有', () => {
    const { root, svg } = mounted(specs);
    // 线那一层里一条题签六样，圆点是第五样（实心的点 r 是 2.6，和竖着的纸条的一样大）
    const dots = svg.childNodes.filter((node) => (node as MiniElement).localName === 'circle') as MiniElement[];
    expect(dots.map((dot) => dot.getAttribute('r'))).toEqual(['2.6', '2.6', '2.6']);
    expect(dots.map((dot) => dot.hasAttribute('data-stop'))).toEqual([true, false, false]);
    expect(root.querySelectorAll('.strip-slip').map((el) => el.hasAttribute('data-area'))).toEqual([false, false, true]);
  });

  it('容器上没有记另一种题签：造出来的还是竖着的纸条（名字在前、印在后，竖写），那一层上不写是哪一种', () => {
    const { root, svg } = mounted(specs, false);
    expect(root.hasAttribute('data-kind')).toBe(false);
    expect(root.querySelectorAll('.strip-slip')).toEqual([]);
    const [yi] = root.querySelectorAll('.strip');
    expect(yi.className).toBe('strip has-seals');
    expect(yi.style.writingMode).toBe('vertical-rl');
    expect(yi.childNodes[0].nodeType).toBe(3);
    expect(yi.querySelectorAll('a').map((a) => a.className)).toEqual(['strip-seal', 'strip-seal']);
    expect(root.querySelectorAll('.strip').map((el) => el.hasAttribute('data-area'))).toEqual([false, false, false]);
    expect((svg.childNodes.filter((node) => (node as MiniElement).localName === 'circle') as MiniElement[]).some((dot) => dot.hasAttribute('data-stop'))).toBe(false);
  });

  it('按在名字上等于按头一个圆；按在哪一个圆上就是那一个；没有圆的纸条按了没有事', () => {
    const { root } = mounted(specs);
    const [yi, zi] = root.querySelectorAll('.strip-slip');
    const [first, second] = yi.querySelectorAll('a');
    const pressed: string[] = [];
    for (const a of [first, second]) a.addEventListener('click', () => pressed.push(a.getAttribute('data-stop-id') ?? ''));
    (yi.querySelector('.strip-name') as MiniElement).click();
    expect(pressed).toEqual(['bing']);
    second.click();
    expect(pressed).toEqual(['bing', 'ding']);
    (zi.querySelector('.strip-name') as MiniElement).click();
    expect(pressed).toHaveLength(2);
  });
});

describe('样式表里平着的纸条的数，和摆题签的测试用的数是同一套', () => {
  /** “平着的纸条”那一段里选择器正好是 selector 的那一条规则里，prop 这一项写的值。 */
  const rule = (selector: string, prop: string): string => {
    const at = SLIP_CSS.indexOf(`\n${selector} {`);
    if (at < 0) throw new Error(`样式表里没有这一条：${selector}`);
    const body = SLIP_CSS.slice(at, SLIP_CSS.indexOf('}', at));
    const found = new RegExp(`\\n\\s*${prop}:\\s*([^;]+);`).exec(body);
    if (!found) throw new Error(`${selector} 里没有写 ${prop}`);
    return found[1].trim();
  };
  const num = (value: string): number[] => value.split(/\s+/).map((part) => Number.parseFloat(part));
  const KIND = "[data-kind='slip']";
  const KINDS = [
    { kind: 'wide', pane: '' },
    { kind: 'narrow', pane: '.stage-pane:not(.is-wide) ' },
  ] as const;

  it.each(KINDS)('$kind 的栏：名字那一块的高和宽、没有点的名字的宽、一个圆占多宽、两个圆之间多空多少，都是 SLIP_SIZE 里的数', ({ kind, pane }) => {
    const size = SLIP_SIZE[kind];
    const font = num(rule(`${pane}${KIND} .strip-slip`, 'font-size'))[0];
    expect(font).toBe(size.font);
    // 垫的是字号的几成（两种大小是同一条规则），一圈 1 像素的边，行高 1
    const [top, right, bottom, left] = num(rule(`${KIND} .strip-name`, 'padding'));
    expect(rule(`${KIND} .strip-name`, 'padding')).toBe('0.24em 0.42em 0.3em 0.46em');
    expect(num(rule(`${KIND} .strip-name`, 'border'))[0]).toBe(1);
    expect(rule(`${KIND} .strip-slip`, 'line-height')).toBe('1');
    const spacing = num(rule(`${KIND} .strip-name`, 'letter-spacing'))[0];
    expect(font * (1 + top + bottom) + 2).toBeCloseTo(size.h, 6);
    expect(font * (1 + spacing)).toBeCloseTo(size.perChar, 6);
    expect(font * (left + right) + 2).toBeCloseTo(size.base, 6);
    // 没有点的名字：字距拉开，右垫另写
    const areaSpacing = num(rule(`${KIND} .strip-slip[data-area] .strip-name`, 'letter-spacing'))[0];
    const areaRight = num(rule(`${KIND} .strip-slip[data-area] .strip-name`, 'padding-right'))[0];
    expect(font * (1 + areaSpacing)).toBeCloseTo(size.areaPerChar, 6);
    expect(font * (left + areaRight) + 2).toBeCloseTo(size.areaBase, 6);
    // 圆：宽、高一样，右边空 2；两个圆之间再空 1
    const width = num(rule(`${pane}${KIND} .strip-disc`, 'width'))[0];
    const height = num(rule(`${pane}${KIND} .strip-disc`, 'height'))[0];
    const gap = num(rule(`${KIND} .strip-disc`, 'margin-right'))[0];
    const between = num(rule(`${KIND} .strip-disc + .strip-disc`, 'margin-left'))[0];
    expect(width).toBe(height);
    expect(rule(`${KIND} .strip-disc`, 'border-radius')).toBe('50%');
    expect(width + gap).toBe(size.disc);
    expect(between).toBe(size.between);
    // 圆不比名字那一块高（纸条的高就是名字那一块的高）
    expect(height).toBeLessThan(size.h);

    // 按得到的地方：单独一个四边各放出去这么多，44 像素见方
    const out = -num(rule(`${pane}${KIND} .strip-disc::after`, 'inset'))[0];
    expect(width + out * 2).toBe(44);
    expect(height + out * 2).toBe(44);
    // 并排的两个：头一个左边放出去 12.5 像素以上；后一个从两个圆的正中间起（往左放出去的是两个圆之间那一段的一半），
    // 往右只放出去圆和名字之间空的那 2 像素——到名字那一块为止，一点也不盖着名字：按在名字上的哪里都是头一站（题签层的规矩）。
    // 后一个盖在头一个上面（它排在后面），所以头一个到正中间为止。上下两个都是 44（那一条规则只写左右，上下是前一条的）
    expect(out).toBeGreaterThanOrEqual(12.5);
    const second = `${pane}${KIND} .strip-disc + .strip-disc::after`;
    const leftOut = -num(rule(second, 'left'))[0];
    const rightOut = -num(rule(second, 'right'))[0];
    expect(leftOut).toBe((gap + between) / 2);
    expect(rightOut).toBe(gap);
    for (const prop of ['top', 'bottom', 'inset', 'height']) expect(() => rule(second, prop), prop).toThrow('里没有写');
    // 两块各多宽：头一个从左边放出去的地方到正中间，后一个从正中间到名字
    expect(out + width + (gap + between) / 2).toBe(kind === 'wide' ? 33 : 31.5);
    expect(leftOut + width + rightOut).toBe(kind === 'wide' ? 22.5 : 19.5);
  });

  it('照这几个数：五个字 107 宽、28 高，带一个圆 128，两个圆 150；窄的栏上 89、24，带一个圆 107；没有点的五个字 119', () => {
    expect(slipSize('一二三四五', 'wide')).toEqual({ w: 107, h: 28 });
    expect(slipSize('一二三四五', 'wide', 1)).toEqual({ w: 128, h: 28 });
    expect(slipSize('一二三四五', 'wide', 2)).toEqual({ w: 150, h: 28 });
    expect(slipSize('一二三四五', 'narrow')).toEqual({ w: 89, h: 24 });
    expect(slipSize('一二三四五', 'narrow', 1)).toEqual({ w: 107, h: 24 });
    expect(slipSize('一二三四五', 'wide', 0, true)).toEqual({ w: 119, h: 28 });
  });

  it('带圆的纸条按得动；圆是实心还是只有一圈边、这一节讲的那一站多一圈墨线；水名、是站的地名那一点的颜色，都从人物的那一套取', () => {
    expect(rule(`${KIND} .strip-slip.has-seals`, 'pointer-events')).toBe('auto');
    expect(rule(`${KIND} .strip-disc[data-filled='true']`, 'background-color')).toContain('--figure-mark');
    expect(rule(`${KIND} .strip-disc`, 'box-shadow')).toContain('--figure-mark');
    expect(rule(`${KIND} .strip-disc[data-here='true']`, 'box-shadow')).toContain('--figure-ink');
    expect(rule(`${KIND} .strip-slip[data-tone='water']`, 'color')).toContain('--figure-water');
    expect(rule(`${KIND} .strip-leaders circle[data-stop]`, 'fill')).toContain('--figure-mark');
    // 细线：一像素，颜色是人物那一套里的 --figure-line，没有写的时候是半透的墨色
    expect(rule(`${KIND} .strip-name`, 'border')).toBe('1px solid var(--figure-line, rgb(40 35 31 / 0.5))');
    // 字从人物的那一套取
    expect(rule(`${KIND} .strip-slip`, 'font-family').startsWith('var(--figure-font,')).toBe(true);
  });

  it('这一段的每一条规则都照那一层上的 data-kind 挑，不认人物；里面没有动圆点的大小，也没有竖着的纸条的类名', () => {
    const selectors = Array.from(SLIP_CSS.matchAll(/\n([^\n{}/]+) \{/g), (match) => match[1].trim());
    expect(selectors.length).toBeGreaterThanOrEqual(16);
    for (const selector of selectors) {
      expect(selector, selector).toContain(KIND);
      expect(selector, selector).not.toContain('data-figure');
      expect(/\.strip(-seal)?(?![\w-])/.test(selector.replace(/\.strip-(slip|name|disc|leaders)/g, '')), selector).toBe(false);
    }
    expect(SLIP_CSS).not.toMatch(/\n\s*r:/);
    expect(SLIP_CSS).not.toContain('stroke-width');
  });
});

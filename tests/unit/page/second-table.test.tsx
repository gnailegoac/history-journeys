// 第二座站点沙盘（黄州）在整个版面里：用假 DOM（miniDom.ts）在 Node 里连同 content/ 里真的内容和沙盘的替身跑一遍。
// 这里不拿走什么、不换什么（page-behaviour.test.tsx 为了查“写好了正文、还没有自己的沙盘的一站”，把黄州的沙盘拿走了）：
// 黄州就是一站有自己的沙盘的站，同徐州一样——沙盘栏摆的是它自己的沙盘，不是全程沙盘上的来路；按钮下面没有那一行话；
// 正文九节，沙盘跟着换；夜里的三节题记照样印；凭据里“沙盘上的东西”每样一条。
// 不看版面和样式，也不看画面（那是 tests/e2e 和定格图的事）。
import { describe, expect, it } from 'vitest';
import type { Figure, StopScene } from '../../../src/domain';
import { readBytes } from '../../support/readBytes';
import { installMiniDom, MiniElement } from './miniDom';

const doc = installMiniDom('?stage=fake');
const win = (globalThis as any).window;
const g = globalThis as any;

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { FigureLayout } = await import('../../../src/ui/FigureLayout');

const STOP = 'huangzhou';
const read = <T,>(path: string): T => JSON.parse(new TextDecoder().decode(readBytes(path))) as T;
const scene = read<StopScene>(`content/figures/su-shi/scenes/${STOP}.json`);
const figure = read<Figure>('content/figures/su-shi/figure.json');
const headings = scene.sections.map((s) => s.heading);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = (ms = 60) => act(async () => void (await sleep(ms)));
const attr = (el: MiniElement | null, name: string) => el?.getAttribute(name) ?? null;
async function waitFor(ok: () => boolean, ms = 15000) {
  const until = Date.now() + ms;
  while (!ok() && Date.now() < until) await settle(20);
  if (!ok()) throw new Error('等不到');
}

describe('黄州：有自己的沙盘的第二站（整个版面 + 真的内容 + 沙盘的替身）', () => {
  it('沙盘栏摆的是黄州自己的沙盘；正文九节，同场景的九节一一对上；读到哪一节，题记、题签换到哪一节；夜里的三节照样有题记；凭据里每样东西一条', { timeout: 40_000 }, async () => {
    win.location.search = '?stage=fake';
    g.__sectionTops = {};
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as any);
    await act(async () => root.render(<FigureLayout figureId="su-shi" stopId={STOP} />));
    const pane = () => container.querySelector('.stage-pane')!;
    await waitFor(() => {
      const state = container.querySelector('.stage-pane')?.getAttribute('data-stage-state');
      return state != null && state !== 'loading';
    });
    const q = (selector: string) => container.querySelector(selector);
    const all = (selector: string) => container.querySelectorAll(selector);
    const readTo = async (heading: string) => {
      const at = headings.indexOf(heading);
      g.__sectionTops = Object.fromEntries(headings.map((h, i) => [h, i <= at ? 100 : 9999]));
      win.fire('scroll');
      await settle(40);
    };

    // 这一站在 figure.json 里是写好了的
    expect(figure.stops.find((stop) => stop.id === STOP)?.status).toBe('complete');
    // 摆好了，摆的是这一站自己的沙盘：不是全程沙盘（栏上不写 level），页面知道这一站有沙盘，按钮下面没有那一行话
    expect(attr(pane(), 'data-stage-state')).toBe('ready');
    expect(attr(pane(), 'data-stage-level')).toBeNull();
    expect(attr(q('.stop-page'), 'data-stop-id')).toBe(STOP);
    expect(attr(q('.stop-page'), 'data-stop-scene')).toBe('yes');
    expect(q('.stage-notice')).toBeNull();
    expect(q('.stage-reset')?.textContent).toBe('回到这一节');
    expect(all('.strip-seal')).toHaveLength(0);

    // 九节，正文的标题和场景的小节一一对上
    expect(headings).toHaveLength(9);
    expect(all('.text-section').map((el) => attr(el, 'data-section'))).toEqual(headings);

    // 头一节：题记、题签是场景里写的
    const stripIds = () => all('.stage-host .strip').map((el) => attr(el, 'data-strip-id'));
    const caption = () => q('.stage-caption')!;
    expect(attr(pane(), 'data-stage-section')).toBe(headings[0]);
    expect(attr(caption(), 'data-section')).toBe(headings[0]);
    expect(stripIds()).toEqual(scene.sections[0].strips);
    expect(q('.stage-line')?.textContent).toBe(scene.sections[0].line);
    expect(q('.stage-date')?.textContent).toBe(scene.sections[0].date);
    // 头一节指着沙盘外面的汴京：题记下面有远处的那一行
    expect(all('.stage-far li').length).toBeGreaterThan(0);

    // 夜里的三节：读到那里，沙盘换过去；题记、题签、说明照样有（夜里变的只是光，字不变）
    const nights = scene.sections.filter((s) => s.sky === 'night');
    expect(nights.map((s) => s.heading)).toEqual(['赤壁', '十月，再到赤壁', '承天寺']);
    for (const night of nights) {
      expect(night.moon, `${night.heading}要写月亮`).toBeDefined();
      await readTo(night.heading);
      await waitFor(() => attr(pane(), 'data-stage-section') === night.heading);
      expect(attr(pane(), 'data-stage-state')).toBe('ready');
      expect(attr(caption(), 'data-section')).toBe(night.heading);
      expect(q('.stage-line')?.textContent).toBe(night.line);
      expect(q('.stage-date')?.textContent).toBe(night.date);
      expect((q('.stage-note-short')?.textContent ?? '').length).toBeGreaterThan(0);
      expect(stripIds()).toEqual(night.strips);
    }

    // 最后一节是白天，指着汝州
    await readTo(headings[8]);
    await waitFor(() => attr(pane(), 'data-stage-section') === headings[8]);
    expect(scene.sections[8].sky ?? 'day').toBe('day');
    expect(stripIds()).toEqual(scene.sections[8].strips);

    // 凭据里的“沙盘上的东西”：点开才取；五类各一组；每样摆件、每个地名点一条；没有画的东西、用了谁的数据照场景里写的
    const fold = q('details.provenance')!;
    (fold as any).open = true;
    await act(async () => void fold.dispatchEvent({ type: 'toggle' }));
    await waitFor(() => q('.scene-register') !== null);
    expect(all('.scene-register-group').filter((group) => attr(group, 'data-class') !== null)).toHaveLength(5);
    for (const thing of scene.things) expect(all(`.scene-register-item[data-scene-id="${thing.id}"]`), thing.name).toHaveLength(1);
    for (const place of scene.places) expect(all(`.scene-register-item[data-scene-id="${place.id}"]`), place.name).toHaveLength(1);
    for (const rule of scene.dressing) expect(all(`.scene-register-item[data-scene-id="${rule.id}"]`), rule.name).toHaveLength(1);
    expect(all('.scene-not-drawn .scene-register-item')).toHaveLength(scene.notDrawn.length);
    expect(all('.scene-credits p').map((p) => p.textContent)).toEqual(scene.credits);
    // 正文的凭据照旧在：九节各一组
    expect(all('.provenance-group').length).toBeGreaterThanOrEqual(9);

    await act(async () => root.unmount());
  });
});

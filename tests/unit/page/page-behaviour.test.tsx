// 整个版面（FigureLayout：人物页、站点页）的行为：用假 DOM（miniDom.ts）在 Node 里连同 content/ 里真的内容和沙盘的替身跑一遍。
// 不看版面和样式（那是 tests/e2e 的事）。
import { describe, expect, it, vi } from 'vitest';
import type { StopScene } from '../../../src/domain';
import { readBytes } from '../../support/readBytes';
import { installMiniDom, MiniElement } from './miniDom';

const doc = installMiniDom('?stage=fake');
const win = (globalThis as any).window;
const g = globalThis as any;

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { FigureLayout } = await import('../../../src/ui/FigureLayout');

const scene = JSON.parse(new TextDecoder().decode(readBytes('content/figures/su-shi/scenes/xuzhou.json'))) as StopScene;
const headings = scene.sections.map((s) => s.heading);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = (ms = 60) => act(async () => void (await sleep(ms)));
const attr = (el: MiniElement | null, name: string) => el?.getAttribute(name) ?? null;
async function waitFor(ok: () => boolean, ms = 15000) {
  const until = Date.now() + ms;
  while (!ok() && Date.now() < until) await settle(20);
  if (!ok()) throw new Error('等不到');
}

async function mount(search: string, stopId: string | null) {
  win.location.search = search;
  g.__sectionTops = {};
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container as any);
  const show = (id: string | null) => act(async () => root.render(<FigureLayout figureId="su-shi" stopId={id} />));
  await show(stopId);
  await waitFor(() => {
    const state = container.querySelector('.stage-pane')?.getAttribute('data-stage-state');
    if (state === 'still') return container.querySelector('.stage-still-box')?.getAttribute('data-still') !== 'loading';
    return state !== undefined && state !== 'loading';
  });
  return {
    container,
    show,
    pane: () => container.querySelector('.stage-pane')!,
    q: (selector: string) => container.querySelector(selector),
    all: (selector: string) => container.querySelectorAll(selector),
    /** 读到某一小节：它和它前面的标题都过了阅读线。 */
    read: async (heading: string) => {
      const at = headings.indexOf(heading);
      g.__sectionTops = Object.fromEntries(headings.map((h, i) => [h, i <= at ? 100 : 9999]));
      win.fire('scroll');
      await settle(40);
    },
    unmount: () => act(async () => root.unmount()),
  };
}

describe('整个版面 + 真的内容 + 沙盘的替身', () => {
  it('人物页：定格图', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake', null);
    expect(attr(page.pane(), 'data-stage-state')).toBe('still');
    expect(attr(page.q('.stage-still-box'), 'data-still')).toBe('shown');
    expect(attr(page.q('.stage-still img'), 'alt')).toBeTruthy();
    expect(page.q('.names-switch')).toBeNull();
    expect(page.all('.stop-item').length).toBeGreaterThan(1);
    await page.unmount();
  });

  it('人物页：?still=none', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake&still=none', null);
    expect(attr(page.q('.stage-still-box'), 'data-still')).toBe('none');
    expect(page.q('.stage-still-line')?.textContent).toBe('全程沙盘还没接进来。');
    expect(page.q('.stage-still')).toBeNull();
    await page.unmount();
  });

  it('徐州：摆着第一节；读到后面的小节，镜头、题记、题签跟着换', { timeout: 60_000 }, async () => {
    const page = await mount('?stage=fake', 'xuzhou');
    expect(attr(page.q('.stop-page'), 'data-stop-text')).toBe('written');
    expect(attr(page.q('.stop-page'), 'data-stop-scene')).toBe('yes');
    expect(attr(page.pane(), 'data-stage-state')).toBe('ready');
    expect(attr(page.pane(), 'data-stage-section')).toBe(headings[0]);
    const fake = () => page.q('.fake-stage')!;
    expect(attr(fake(), 'data-fake-animated')).toBe('false');
    expect(page.all('.text-section').map((el) => attr(el, 'data-section'))).toEqual(headings);

    const stripIds = () => page.all('.stage-host .strip').map((el) => attr(el, 'data-strip-id'));
    const stripWords = () => page.all('.stage-host .strip').map((el) => el.textContent);
    const wordsOf = (index: number, names: 'ancient' | 'modern') =>
      scene.sections[index].strips.map((id) => {
        const strip = scene.strips.find((item) => item.id === id)!;
        return names === 'modern' && strip.modern ? strip.modern : strip.text;
      });
    const caption = () => page.q('.stage-caption')!;
    expect(stripIds()).toEqual(scene.sections[0].strips);
    expect(attr(caption(), 'data-section')).toBe(headings[0]);

    // 读到第三节：停够了才报给沙盘，沙盘滑过去。
    await page.read(headings[2]);
    await waitFor(() => attr(page.pane(), 'data-stage-section') === headings[2]);
    expect(attr(fake(), 'data-fake-animated')).toBe('true');
    expect(stripIds()).toEqual(scene.sections[2].strips);

    // 一掠而过的小节不报：第 4 节只停了几十毫秒就到了第 6 节。
    await page.read(headings[3]);
    await page.read(headings[5]);
    await waitFor(() => attr(page.pane(), 'data-stage-section') === headings[5]);
    await settle(450);
    expect(attr(page.pane(), 'data-stage-section')).toBe(headings[5]);
    expect(stripIds()).toEqual(scene.sections[5].strips);
    expect(page.all('.stage-far li').length).toBeGreaterThan(0);

    await page.read(headings[6]);
    await waitFor(() => attr(page.pane(), 'data-stage-section') === headings[6]);
    expect(stripWords()).toEqual(wordsOf(6, 'ancient'));

    // 今名。
    await act(async () => page.all('.names-switch button')[1].click());
    expect(stripWords()).toEqual(wordsOf(6, 'modern'));

    // 凭据里的“沙盘上的东西”。
    const register = page.q('.scene-register')!;
    expect(register).not.toBeNull();
    // 五类各一组
    expect(page.all('.scene-register-group').filter((group) => attr(group, 'data-class') !== null)).toHaveLength(5);
    for (const thing of scene.things) expect(page.all(`.scene-register-item[data-scene-id="${thing.id}"]`)).toHaveLength(1);
    expect(page.all('.scene-not-drawn .scene-register-item')).toHaveLength(scene.notDrawn.length);
    expect(page.all('.scene-credits p').map((p) => p.textContent)).toEqual(scene.credits);

    // 换到黄州：沙盘拿走，换成定格图和一句话。
    await page.show('huangzhou');
    await waitFor(() => attr(page.pane(), 'data-stage-state') === 'still' && attr(page.q('.stop-page'), 'data-stop-scene') === 'none' && page.q('.stage-still img') !== null);
    expect(attr(page.pane(), 'data-stage-state')).toBe('still');
    expect(attr(page.q('.stop-page'), 'data-stop-scene')).toBe('none');
    expect(page.q('.stage-still-line')?.textContent).toBe('这一站的沙盘还没做好，先看全程。');
    expect(page.q('.stage-still img')).not.toBeNull();
    expect(page.q('.fake-stage')).toBeNull();
    expect(page.q('.scene-register')).toBeNull();
    expect(page.all('.strip')).toHaveLength(0);

    // 再回徐州：从第一节开始，不带着上一次读到的小节。
    g.__sectionTops = {};
    await page.show('xuzhou');
    await waitFor(() => attr(page.pane(), 'data-stage-state') === 'ready');
    expect(attr(page.pane(), 'data-stage-state')).toBe('ready');
    expect(attr(page.pane(), 'data-stage-section')).toBe(headings[0]);
    expect(attr(page.q('.fake-stage'), 'data-fake-animated')).toBe('false');
    // 今名留着。
    expect(attr(page.q('.fake-stage'), 'data-fake-names')).toBe('modern');

    // 还没写的站。
    await page.show('meishan');
    await waitFor(() => attr(page.pane(), 'data-stage-state') === 'still' && attr(page.q('.stop-page'), 'data-stop-text') === 'none');
    expect(attr(page.pane(), 'data-stage-state')).toBe('still');
    expect(attr(page.q('.stop-page'), 'data-stop-text')).toBe('none');
    expect(attr(page.q('.stop-page'), 'data-stop-scene')).toBe('none');

    // 回人物页。
    await page.show(null);
    await waitFor(() => attr(page.pane(), 'data-stage-state') === 'still' && page.q('.stage-still-line') === null);
    expect(attr(page.pane(), 'data-stage-state')).toBe('still');
    expect(page.q('.stage-still-line')).toBeNull();
    await page.unmount();
  });

  it('还没有沙盘的站：沙盘栏一上来就是定格图那一种，不先说一句“沙盘正在摆出来”', { timeout: 30_000 }, async () => {
    win.location.search = '?stage=fake';
    g.__sectionTops = {};
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as any);
    // 沙盘栏的状态每写一次就记一笔（中间一闪而过的也记得到）。
    const states: string[] = [];
    const setAttribute = MiniElement.prototype.setAttribute;
    MiniElement.prototype.setAttribute = function (name: string, value: string) {
      if (name === 'data-stage-state') states.push(String(value));
      setAttribute.call(this, name, value);
    };
    try {
      await act(async () => root.render(<FigureLayout figureId="su-shi" stopId="huangzhou" />));
      await waitFor(() => container.querySelector('.stage-still img') !== null);
    } finally {
      MiniElement.prototype.setAttribute = setAttribute;
    }
    expect(states.length).toBeGreaterThan(0);
    expect(new Set(states)).toEqual(new Set(['still']));
    expect(container.querySelector('.stage-loading')).toBeNull();
    expect(container.querySelector('.stop-page')?.getAttribute('data-stop-scene')).toBe('none');
    await act(async () => root.unmount());
  });

  it('徐州：起不来时题记还在', { timeout: 30_000 }, async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const page = await mount('?stage=fake-fail', 'xuzhou');
    expect(attr(page.pane(), 'data-stage-state')).toBe('failed');
    expect(attr(page.q('.stage-caption'), 'data-section')).toBe(headings[0]);
    await page.read(headings[2]);
    await waitFor(() => attr(page.q('.stage-caption'), 'data-section') === headings[2]);
    expect(attr(page.q('.stage-caption'), 'data-section')).toBe(headings[2]);
    expect(attr(page.q('.stop-page'), 'data-stop-scene')).toBe('yes');
    await page.unmount();
    warn.mockRestore();
  });
});

// 看一站的小节画的是“这一站那几年走的路”的全程沙盘（场景文件的 roads.stopShows 写 stop-years），页面上的两处：
//   沙盘旁边的两句话的另一种说法——没有自己的沙盘的一站，文字栏里说“这一站的正文还没写。沙盘上是这一站的路。”，
//   正文写好了的一站在沙盘栏的按钮下面说“这一站的沙盘还没做好，沙盘上是这一站的路。”（不写、写 way-there 的沙盘照旧说“到这一站的来路”：
//   苏轼的那两句在 page-behaviour.test.tsx 里一个字不差地守着，这里是它们的另一半）；
//   凭据里“沙盘上的东西”一栏开头的几条总的说明（场景文件最外面的 general）：一条一段，照文件里的先后，没有标题，id 不印。
// content/ 里没有这样的一座沙盘：人物用的是测试里编出来的那一位（tests/content/fixtures/made-up/figures/traveller，
// 它的全程沙盘写了 stop-years，带着两条总的说明）。读人物、读全程沙盘、读正文的那三个函数在这个文件里换成“问到他就给编出来的”，别的原样；
// 页面、沙盘的替身、凭据里面的那一段程序都是真的。用假 DOM（miniDom.ts）在 Node 里跑；这个文件自己一个进程。
import { describe, expect, it, vi } from 'vitest';
import type { Figure, RouteScene } from '../../../src/domain';
import { roadTail, STAGE_TEXT } from '../../../src/ui/text';
import { readBytes } from '../../support/readBytes';
import { installMiniDom, MiniElement } from './miniDom';

const doc = installMiniDom('?stage=fake');
const win = (globalThis as any).window;
const g = globalThis as any;

const FOLDER = 'tests/content/fixtures/made-up/figures/traveller';
const readJson = <T,>(path: string): T => JSON.parse(new TextDecoder().decode(readBytes(path))) as T;
const written = readJson<Figure>(`${FOLDER}/figure.json`);
const route = readJson<RouteScene>(`${FOLDER}/scenes/route.json`);
/** 第二站（丙港）在这个文件里当“正文写好了”的一站：figure.json 里三站都还没写，页面上“写好了、没有自己的沙盘”的那一句才有地方印。 */
const COMPLETE = 'bing';
const traveller: Figure = { ...written, stops: written.stops.map((stop) => (stop.id === COMPLETE ? { ...stop, status: 'complete' } : stop)) };

// 页面看的是哪一种全程沙盘：平常是文件里的那一份（stop-years）；g.__wayThere 是 'absent' 的时候换成“不写 stopShows”的一份，
// 是 'written' 的时候换成“stopShows 写着 way-there”的一份（别的一个字不动）
g.__wayThere = false;
vi.mock('../../../src/domain/content', async (original) => {
  const actual = await original<typeof import('../../../src/domain/content')>();
  return {
    ...actual,
    loadFigure: (figureId: string) => (figureId === 'traveller' ? Promise.resolve(traveller) : actual.loadFigure(figureId)),
    // 编出来的这位人物没有正文文件：写好了的那一站这一次“没读出来”（页面上是真有的一条路），沙盘栏的那一行话照样印
    loadStop: (figureId: string, stopId: string) => (figureId === 'traveller' ? Promise.reject(new Error('编出来的人物没有正文')) : actual.loadStop(figureId, stopId)),
  };
});
vi.mock('../../../src/domain/sceneContent', async (original) => {
  const actual = await original<typeof import('../../../src/domain/sceneContent')>();
  const plain = (): RouteScene => {
    const { stopShows: _dropped, ...roads } = route.roads;
    return { ...route, roads: (globalThis as any).__wayThere === 'written' ? { ...roads, stopShows: 'way-there' } : roads };
  };
  return {
    ...actual,
    loadRouteTable: (figureId: string) => (figureId === 'traveller' ? Promise.resolve({ scene: (globalThis as any).__wayThere ? plain() : route, terrainUrl: 'route.terrain.bin' }) : actual.loadRouteTable(figureId)),
  };
});

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { FigureLayout } = await import('../../../src/ui/FigureLayout');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = (ms = 60) => act(async () => void (await sleep(ms)));
const attr = (el: MiniElement | null, name: string) => el?.getAttribute(name) ?? null;
async function waitFor(ok: () => boolean, ms = 15000) {
  const until = Date.now() + ms;
  while (!ok() && Date.now() < until) await settle(20);
  if (!ok()) throw new Error('等不到');
}
async function setFold(fold: MiniElement, open: boolean) {
  (fold as any).open = open;
  await act(async () => void fold.dispatchEvent({ type: 'toggle' }));
}

async function mount(stopId: string | null) {
  win.location.search = '?stage=fake';
  g.__sectionTops = {};
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container as any);
  await act(async () => root.render(<FigureLayout figureId="traveller" stopId={stopId} />));
  const pane = () => container.querySelector('.stage-pane')!;
  await waitFor(() => attr(pane(), 'data-stage-state') === 'ready');
  return { pane, q: (selector: string) => container.querySelector(selector), all: (selector: string) => container.querySelectorAll(selector), unmount: () => act(async () => root.unmount()) };
}

describe('看一站的小节画的是“这一站那几年走的路”的全程沙盘（编出来的那一位人物）', () => {
  it('编出来的那一座写了 stop-years，带着两条总的说明；三站都没有自己的沙盘；content/ 里没有叫 traveller 的人物', () => {
    expect(route.roads.stopShows).toBe('stop-years');
    expect(route.general?.map((line) => line.id)).toEqual(['records', 'made-up-names']);
    expect(written.stops.map((stop) => [stop.id, stop.status, 'table' in stop])).toEqual([['jia', 'outline', false], ['bing', 'outline', false], ['ding', 'outline', false]]);
    expect(Object.keys(import.meta.glob('/content/figures/traveller/**/*'))).toEqual([]);
  });

  it('那半句照沙盘自己说的挑：不写、写 way-there 是“沙盘上是到这一站的来路。”，写 stop-years 是“沙盘上是这一站的路。”；前半句没有变', () => {
    expect(roadTail(false)).toBe('沙盘上是到这一站的来路。');
    expect(roadTail(true)).toBe('沙盘上是这一站的路。');
    expect(STAGE_TEXT.roadNotice + roadTail(false)).toBe('这一站的沙盘还没做好，沙盘上是到这一站的来路。');
    expect(STAGE_TEXT.roadNotice + roadTail(true)).toBe('这一站的沙盘还没做好，沙盘上是这一站的路。');
  });

  it('正文还没写、也没有自己的沙盘的一站：文字栏里是“这一站的正文还没写。沙盘上是这一站的路。”；沙盘栏摆着全程沙盘上这一站的那一节，按钮下面没有那一行话', { timeout: 60_000 }, async () => {
    const page = await mount('jia');
    await waitFor(() => attr(page.pane(), 'data-stage-level') === 'route');
    expect(attr(page.pane(), 'data-stage-section')).toBe(route.sections.find((section) => section.stop === 'jia')?.heading);
    expect(page.q('.not-written')?.textContent).toBe('这一站的正文还没写。沙盘上是这一站的路。');
    expect(page.q('.stage-notice')).toBeNull();
    expect(page.q('.stage-reset')?.textContent).toBe('回到这一段');
    await page.unmount();
  });

  it('正文写好了、没有自己的沙盘的一站：按钮下面的一行话是“这一站的沙盘还没做好，沙盘上是这一站的路。”，后面没有按钮', { timeout: 60_000 }, async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const page = await mount(COMPLETE);
    await waitFor(() => attr(page.pane(), 'data-stage-level') === 'route' && page.q('.stage-notice p') !== null);
    expect(attr(page.pane(), 'data-stage-section')).toBe(route.sections.find((section) => section.stop === COMPLETE)?.heading);
    expect(page.q('.stage-notice p')?.textContent).toBe('这一站的沙盘还没做好，沙盘上是这一站的路。');
    expect(page.q('.stage-notice button')).toBeNull();
    await page.unmount();
    warn.mockRestore();
  });

  it('同一位人物、同样的两站，沙盘不写 stopShows：两句话都是“到这一站的来路”那一种（挑哪一种只看这个字段）', { timeout: 60_000 }, async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    g.__wayThere = 'absent';
    try {
      const bare = await mount('jia');
      expect(bare.q('.not-written')?.textContent).toBe('这一站的正文还没写。沙盘上是到这一站的来路。');
      await bare.unmount();
      const page = await mount(COMPLETE);
      await waitFor(() => page.q('.stage-notice p') !== null);
      expect(page.q('.stage-notice p')?.textContent).toBe('这一站的沙盘还没做好，沙盘上是到这一站的来路。');
      await page.unmount();
    } finally {
      g.__wayThere = false;
      warn.mockRestore();
    }
  });

  it('同一位人物、同样的两站，沙盘的 stopShows 写着 way-there：两句话也是“到这一站的来路”那一种（写了这个字段不等于换说法：写的是 stop-years 才换）', { timeout: 60_000 }, async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    g.__wayThere = 'written';
    try {
      // 页面拿到的那一份真的写着 way-there（不是又一次“不写”）
      const { loadRouteTable } = await import('../../../src/domain/sceneContent');
      expect((await loadRouteTable('traveller'))?.scene.roads.stopShows).toBe('way-there');
      const bare = await mount('jia');
      await waitFor(() => attr(bare.pane(), 'data-stage-level') === 'route');
      expect(bare.q('.not-written')?.textContent).toBe('这一站的正文还没写。沙盘上是到这一站的来路。');
      await bare.unmount();
      const page = await mount(COMPLETE);
      await waitFor(() => page.q('.stage-notice p') !== null);
      expect(page.q('.stage-notice p')?.textContent).toBe('这一站的沙盘还没做好，沙盘上是到这一站的来路。');
      await page.unmount();
    } finally {
      g.__wayThere = false;
      warn.mockRestore();
    }
  });

  it('人物页上点开“凭据”：“沙盘上的东西”一栏开头是那两条总的说明，一条一段，照文件里的先后，排在五类的前面；没有标题，id 哪里也不印', { timeout: 60_000 }, async () => {
    const page = await mount(null);
    expect(page.q('.scene-register')).toBeNull();
    await setFold(page.q('details.provenance')!, true);
    await waitFor(() => page.q('.scene-register') !== null);
    const lines = page.all('.scene-register .scene-general');
    expect(lines.map((p) => p.textContent)).toEqual(route.general?.map((line) => line.text));
    expect(lines.map((p) => p.tagName.toLowerCase())).toEqual(['p', 'p']);
    // 排在那一栏的开头：标题、那一句“属于哪一类”，然后就是它们，五类的头一组在它们后面
    const register = page.q('.scene-register')!;
    const order = (register.childNodes as MiniElement[]).map((child) => (child.getAttribute?.('class') ?? '').split(' ').pop() || child.tagName?.toLowerCase());
    expect(order.slice(0, 5)).toEqual(['h3', 'provenance-line', 'scene-general', 'scene-general', 'scene-register-group']);
    // 没有标题：这两段话之间、前后没有多出一个 h4；五类的标题一个不少
    expect(page.all('.scene-register h4').map((h) => h.textContent)).not.toContain('');
    expect(page.all('.scene-general h4')).toHaveLength(0);
    // id 不印：整栏的字里找不到
    for (const line of route.general ?? []) expect(register.textContent ?? '').not.toContain(line.id);
    // 不算一样东西：没有 data-scene-id，不在“没有画的”里
    for (const p of lines) expect(attr(p, 'data-scene-id')).toBeNull();
    await page.unmount();
  });
});

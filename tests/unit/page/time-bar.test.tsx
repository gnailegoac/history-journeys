// 时间轴真的那一段程序（src/timebar/TimeBar）接在沙盘栏上：用假 DOM（miniDom.ts）在 Node 里连同 content/ 里真的内容、
// 真的那一份行迹和沙盘的替身跑一遍。看的是“小像有没有真的摆到沙盘上”：替身把最近一次叫它摆在哪记在 data-fake-piece 上，
// 这里另外把每一次叫它的都记一笔（栏整个拿走的时候替身先关掉了，它自己不再记）。
// bar-band.test.tsx 把那一段程序换成了小替身，看不到这些；这个文件不换，自己一个进程。
//
// 假的页面不排版：时间轴的那一条多宽由这里说（g.__bandWidth；null 是照假页面平常的 800）。
import { describe, expect, it, vi } from 'vitest';
import type { Figure, RouteScene } from '../../../src/domain';
import type { ItineraryBar } from '../../../src/domain/itinerary';
import type { PiecePlace, StopStageView } from '../../../src/stage/types';
import { KEYS_REST_MS, keyStep } from '../../../src/timebar/barState';
import { whereAt } from '../../../src/timebar/barWhere';
import { readBytes } from '../../support/readBytes';
import { installMiniDom, MiniElement } from './miniDom';

/** 时间轴停在第几天（地址里的 ?bar=）：苏轼在黄州的年月里，沙盘上有他。 */
const DAY = 16000;
const doc = installMiniDom(`?stage=fake&bar=${DAY}`);
const win = (globalThis as any).window;
const g = globalThis as any;

/** 时间轴的那一条、它里面的轴，假页面上多宽；null 是照平常。 */
g.__bandWidth = null as number | null;
const plainWidth = Object.getOwnPropertyDescriptor(MiniElement.prototype, 'clientWidth')!.get!;
Object.defineProperty(MiniElement.prototype, 'clientWidth', {
  configurable: true,
  get(this: MiniElement) {
    const names = this.className.split(' ');
    return g.__bandWidth !== null && (names.includes('stage-bar') || names.includes('bar-track') || names.includes('bar-axis')) ? g.__bandWidth : plainWidth.call(this);
  },
});

/** 沙盘的替身每一次被叫去摆小像记一笔（null 是叫它拿走）。 */
g.__pieceCalls = [] as (PiecePlace | null)[];
vi.mock('../../../src/ui/dev/fakeStage', async (original) => {
  const actual = await original<typeof import('../../../src/ui/dev/fakeStage')>();
  const flags = globalThis as any;
  return {
    ...actual,
    createFakeStageEngine: (config?: Parameters<typeof actual.createFakeStageEngine>[0]) => {
      const engine = actual.createFakeStageEngine(config);
      return {
        ...engine,
        create: (...args: Parameters<typeof engine.create>): StopStageView => {
          const view = engine.create(...args);
          return {
            ...view,
            placePiece: (where: PiecePlace | null, atRest?: boolean) => {
              (flags.__pieceCalls as (PiecePlace | null)[]).push(where);
              view.placePiece?.(where, atRest);
            },
          };
        },
      };
    },
  };
});

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { FigureLayout } = await import('../../../src/ui/FigureLayout');

const readJson = <T,>(path: string): T => JSON.parse(new TextDecoder().decode(readBytes(path))) as T;
/** 真的那一份行迹（工具做的），人物的资料，全程沙盘的场景。 */
const bar = readJson<ItineraryBar>('content/figures/su-shi/itinerary.bar.json');
const figure = readJson<Figure>('content/figures/su-shi/figure.json');
const route = readJson<RouteScene>('content/figures/su-shi/scenes/route.json');
const sceneFiles = Object.keys(import.meta.glob('/content/figures/su-shi/scenes/*.json'));
/** 头一个还没有自己的沙盘的站：它的页面上摆的还是全程沙盘（同人物页是同一座）。 */
const BARE = figure.stops.find((stop) => !sceneFiles.includes(`/content/figures/su-shi/scenes/${stop.id}.json`))!.id;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = (ms = 60) => act(async () => void (await sleep(ms)));
const attr = (el: MiniElement | null, name: string) => el?.getAttribute(name) ?? null;
async function waitFor(ok: () => boolean, ms = 15000) {
  const until = Date.now() + ms;
  while (!ok() && Date.now() < until) await settle(20);
  if (!ok()) throw new Error('等不到');
}

async function mount(stopId: string | null, day: number = DAY) {
  win.location.search = `?stage=fake&bar=${day}`;
  g.__sectionTops = {};
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container as any);
  const show = (next: string | null) => act(async () => root.render(<FigureLayout figureId="su-shi" stopId={next} />));
  await show(stopId);
  const pane = () => container.querySelector('.stage-pane')!;
  await waitFor(() => attr(pane(), 'data-stage-state') === 'ready');
  return {
    pane,
    q: (selector: string) => container.querySelector(selector),
    show,
    unmount: () => act(async () => root.unmount()),
  };
}

describe('时间轴真的那一段程序接在沙盘栏上', () => {
  it('地址里写了 ?bar=16000：时间轴的那一条有了宽，沙盘的替身才被叫去把小像摆到那一天他在的地方；那一条没有宽的时候不叫；那一条没了地方、栏拿走了，都叫它拿走', { timeout: 60_000 }, async () => {
    const where = whereAt(bar, DAY);
    // 这一天沙盘上有他（不然下面比的就是两个空的）
    expect(where).not.toBeNull();

    // 那一条没有宽（样式表把它拿掉了、栏收起来了）：那一段程序到了、沙盘也摆好了，小像不摆
    g.__bandWidth = 0;
    (g.__pieceCalls as unknown[]).length = 0;
    const page = await mount(null);
    try {
      await waitFor(() => page.q('.stage-bar .bar') !== null);
      await settle(300);
      expect(attr(page.pane(), 'data-stage-state')).toBe('ready');
      expect(attr(page.q('.fake-stage'), 'data-fake-piece')).toBeNull();
      expect(g.__pieceCalls).toEqual([]);

      // 有了宽（窗口变了大小以后量到的）：摆到这一天的地方，只叫一次
      g.__bandWidth = null;
      await act(async () => win.fire('resize'));
      await waitFor(() => attr(page.q('.fake-stage'), 'data-fake-piece') !== null);
      expect(attr(page.q('.fake-stage'), 'data-fake-piece')).toBe(JSON.stringify(where));
      await settle(200);
      expect(g.__pieceCalls).toEqual([where]);
      // 第一行、第二行是这一天的
      expect(page.q('.bar-when')!.textContent).toContain(bar.stretches.find((s) => s.until > DAY)!.label);

      // 那一条又没了宽：小像拿走
      g.__bandWidth = 0;
      await act(async () => win.fire('resize'));
      await waitFor(() => attr(page.q('.fake-stage'), 'data-fake-piece') === '');
      expect(g.__pieceCalls).toEqual([where, null]);

      // 再有了宽：再摆上
      g.__bandWidth = null;
      await act(async () => win.fire('resize'));
      await waitFor(() => attr(page.q('.fake-stage'), 'data-fake-piece') === JSON.stringify(where));
      expect(g.__pieceCalls).toEqual([where, null, where]);
    } finally {
      g.__bandWidth = null;
      await page.unmount();
    }
    // 栏整个拿走了：最后一次叫沙盘的是“拿走”
    expect((g.__pieceCalls as (PiecePlace | null)[]).at(-1)).toBeNull();
    expect(g.__pieceCalls).toEqual([where, null, where, null]);
  });

  it('栏收起来、展开，页面长出滚动条：窗口没有变大小，这一条是看着量的（ResizeObserver）——没了宽小像拿走，有了宽再摆上；这一条拿走以后不再看', { timeout: 60_000 }, async () => {
    // 假的页面平常没有 ResizeObserver；只在这一项里放一个替身：记下谁在看哪个元素，测试自己来叫它
    const watchers: { run: () => void; watched: MiniElement[]; stopped: boolean }[] = [];
    class FakeResizeObserver {
      private readonly entry: { run: () => void; watched: MiniElement[]; stopped: boolean };
      constructor(run: () => void) {
        this.entry = { run, watched: [], stopped: false };
        watchers.push(this.entry);
      }
      observe(el: MiniElement): void {
        this.entry.watched.push(el);
      }
      disconnect(): void {
        this.entry.stopped = true;
      }
    }
    g.ResizeObserver = FakeResizeObserver;
    const where = JSON.stringify(whereAt(bar, DAY));
    (g.__pieceCalls as unknown[]).length = 0;
    const page = await mount(null);
    try {
      await waitFor(() => attr(page.q('.fake-stage'), 'data-fake-piece') === where);
      // 看着的是时间轴的那一条
      const band = page.q('.stage-bar')!;
      const mine = watchers.filter((entry) => entry.watched.includes(band));
      expect(mine).toHaveLength(1);
      // 那一条没了宽（栏收起来了）：没有“窗口变了大小”，只有看着它的那一个被叫
      g.__bandWidth = 0;
      await act(async () => mine[0].run());
      await waitFor(() => attr(page.q('.fake-stage'), 'data-fake-piece') === '');
      // 又有了宽（展开了）
      g.__bandWidth = null;
      await act(async () => mine[0].run());
      await waitFor(() => attr(page.q('.fake-stage'), 'data-fake-piece') === where);
      expect(g.__pieceCalls).toEqual([whereAt(bar, DAY), null, whereAt(bar, DAY)]);
      await page.unmount();
      expect(mine[0].stopped).toBe(true);
    } finally {
      g.__bandWidth = null;
      delete g.ResizeObserver;
    }
  });

  it('从人物页换到一站的页面（还没有自己的沙盘的一站：同一座全程沙盘留着）：时间轴的那一条拿走了，沙盘上的小像也拿走；回到人物页再摆上，日子还在', { timeout: 60_000 }, async () => {
    const where = JSON.stringify(whereAt(bar, DAY));
    const page = await mount(null);
    try {
      await waitFor(() => attr(page.q('.fake-stage'), 'data-fake-piece') === where);
      const table = page.q('.fake-stage');
      // 这一站的页面：沙盘还是那一座（没有重摆），看的是到这一站去的那一节；没有时间轴的那一条，小像拿走了
      await page.show(BARE);
      await waitFor(() => attr(page.pane(), 'data-stage-section') === route.sections.find((section) => section.stop === BARE)!.heading);
      expect(page.q('.fake-stage')).toBe(table);
      expect(page.q('.stage-bar')).toBeNull();
      expect(attr(page.pane(), 'data-stage-bar')).toBeNull();
      await waitFor(() => attr(table, 'data-fake-piece') === '');
      // 回人物页：地址里没有再指定日子，那一条再摆上，还停在那一天
      win.location.search = '?stage=fake&bar=none';
      win.location.search = '?stage=fake';
      await page.show(null);
      await waitFor(() => page.q('.stage-bar') !== null);
      expect(page.q('.fake-stage')).toBe(table);
    } finally {
      await page.unmount();
    }
  });

  it('在轴上按键：圆钮、两行字、给读屏念的那一句、小像马上跟着走；小像在路上，走着的时候不说“停着”，停手 350 毫秒以后才说（题签那时才让开他）', { timeout: 60_000 }, async () => {
    // 头一段路的正中间
    const index = bar.stretches.findIndex((stretch) => stretch.look === 'road');
    const from = index === 0 ? 0 : bar.stretches[index - 1].until;
    const mid = (from + bar.stretches[index].until) / 2;
    // 取整以后在正中间那一格的后面一点：按一下右键走到下一格，差不多是这一段的八分之一
    const day = Math.ceil(mid) + 1;
    const page = await mount(null, day);
    try {
      const fake = () => page.q('.fake-stage');
      const here = whereAt(bar, day);
      expect(here?.on).toBe('road');
      await waitFor(() => attr(fake(), 'data-fake-piece') === JSON.stringify(here));
      // 页面是照地址里指定的那一天打开的：停着
      expect(attr(fake(), 'data-fake-piece-rest')).toBe('true');
      const track = page.q('.bar-track')!;
      expect(attr(track, 'role')).toBe('slider');
      const before = { now: attr(track, 'aria-valuenow'), text: attr(track, 'aria-valuetext') };
      // 按一下右键：走这一段的八分之一
      await act(async () => void track.dispatchEvent({ type: 'keydown', key: 'ArrowRight', bubbles: true, cancelable: true, preventDefault() {}, stopPropagation() {} }));
      const next = keyStep(bar, day, 1);
      await waitFor(() => attr(fake(), 'data-fake-piece') === JSON.stringify(whereAt(bar, next)));
      expect(whereAt(bar, next)?.on).toBe('road');
      // 走着：不说“停着”
      expect(attr(fake(), 'data-fake-piece-rest')).toBe('false');
      expect(Number(attr(track, 'aria-valuenow'))).toBeGreaterThan(Number(before.now));
      expect(attr(track, 'aria-valuetext')).toContain(bar.stretches[index].label);
      expect(page.q('.bar-when')!.textContent).toContain(bar.stretches[index].label);
      expect(page.q('.bar-known')!.textContent).toBe(bar.stretches[index].says);
      // 停手够久：同一个地方，再叫一次，这一次说“停着”
      const calls = Number(attr(fake(), 'data-fake-piece-calls'));
      await waitFor(() => attr(fake(), 'data-fake-piece-rest') === 'true', KEYS_REST_MS + 5000);
      expect(attr(fake(), 'data-fake-piece')).toBe(JSON.stringify(whereAt(bar, next)));
      expect(Number(attr(fake(), 'data-fake-piece-calls'))).toBe(calls + 1);
      // 沙盘栏被报了该看哪一节：这一段路是到哪一站去的，就是那一站的那一节
      const section = route.sections.find((s) => s.stop === bar.stretches[index].group)?.heading ?? route.sections[0].heading;
      await waitFor(() => attr(page.pane(), 'data-stage-section') === section);
      // 别的键不归它管
      const kept = attr(fake(), 'data-fake-piece-calls');
      await act(async () => void track.dispatchEvent({ type: 'keydown', key: 'a', bubbles: true, cancelable: true, preventDefault() {}, stopPropagation() {} }));
      await settle(100);
      expect(attr(fake(), 'data-fake-piece-calls')).toBe(kept);
    } finally {
      await page.unmount();
    }
  });
});

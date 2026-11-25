// 沙盘栏里时间轴的那一条（StagePane 的 BarBand）：用假 DOM（miniDom.ts）在 Node 里连同 content/ 里真的内容和沙盘的替身跑一遍。
// 时间轴里面的东西（src/timebar/TimeBar，摆上全程沙盘才去取的一段程序）在这里换成一个小替身：它把沙盘栏交给它的东西记下来，
// 只画一个空的 .bar。真的那一段程序在别的页面测试里照常取：沙盘的替身上（?stage=fake）地址里不写 ?bar= 它就什么也不画。
// 这个文件自己一个进程：替身是整个文件换掉的，不同别的页面测试共用。
//
// 那一段程序头一回去取的时候可以拦住（g.__barGate 是一个还没兑现的 Promise 时，等它兑现了才给）：模块只取一回，
// 所以“那一段程序到之前、到之后”的那一条排在这个文件的最前面。
import { describe, expect, it, vi } from 'vitest';
import type { Figure, RouteScene } from '../../../src/domain';
import type { BarProps, StageInsets, StopStageView } from '../../../src/stage/types';
import { readBytes } from '../../support/readBytes';
import { installMiniDom, MiniElement } from './miniDom';

const doc = installMiniDom('?stage=fake');
const win = (globalThis as any).window;
const g = globalThis as any;

/** 小替身每画一次记一笔：沙盘栏交给它的东西。 */
g.__barProps = [] as BarProps[];
g.__barGate = null;
vi.mock('../../../src/timebar/TimeBar', async () => {
  const flags = globalThis as any;
  if (flags.__barGate) await flags.__barGate;
  const { createElement } = await import('react');
  return {
    TimeBar: (props: BarProps) => {
      (flags.__barProps as BarProps[]).push(props);
      return createElement('div', { className: 'bar' });
    },
  };
});

/** 沙盘的替身每一次被告知“四边各留出多少”记一笔。 */
g.__insetCalls = [] as StageInsets[];
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
            setInsets: (next: StageInsets) => {
              (flags.__insetCalls as StageInsets[]).push(next);
              view.setInsets(next);
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
/** 人物的资料和全程沙盘的场景，照 content/ 里真的文件。 */
const figure = readJson<Figure>('content/figures/su-shi/figure.json');
const route = readJson<RouteScene>('content/figures/su-shi/scenes/route.json');
const sceneFiles = Object.keys(import.meta.glob('/content/figures/su-shi/scenes/*.json'));
const hasSceneFile = (stopId: string): boolean => sceneFiles.includes(`/content/figures/su-shi/scenes/${stopId}.json`);
/** 头一个还没有自己的沙盘的站：沙盘栏里摆的是全程沙盘上到它去的来路。 */
const BARE = figure.stops.find((stop) => !hasSceneFile(stop.id))!.id;
/** 有自己的沙盘的各站：写好了正文的（徐州、黄州），和正文还没写的（眉州）。 */
const WRITTEN_WITH_TABLE = figure.stops.filter((stop) => stop.status === 'complete' && hasSceneFile(stop.id)).map((stop) => stop.id);
const UNWRITTEN_WITH_TABLE = figure.stops.filter((stop) => stop.status !== 'complete' && hasSceneFile(stop.id)).map((stop) => stop.id);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = (ms = 60) => act(async () => void (await sleep(ms)));
const attr = (el: MiniElement | null, name: string) => el?.getAttribute(name) ?? null;
async function waitFor(ok: () => boolean, ms = 15000) {
  const until = Date.now() + ms;
  while (!ok() && Date.now() < until) await settle(20);
  if (!ok()) throw new Error('等不到');
}

async function mount(stopId: string | null) {
  win.location.search = '?stage=fake';
  g.__sectionTops = {};
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container as any);
  const show = (next: string | null) => act(async () => root.render(<FigureLayout figureId="su-shi" stopId={next} />));
  await show(stopId);
  const pane = () => container.querySelector('.stage-pane')!;
  // 等沙盘摆好
  await waitFor(() => attr(pane(), 'data-stage-state') === 'ready');
  return {
    container,
    pane,
    q: (selector: string) => container.querySelector(selector),
    /** 换一页（同一个版面里换一站，或者回到人物页）。 */
    show,
    unmount: () => act(async () => root.unmount()),
  };
}

describe('沙盘栏里时间轴的那一条', () => {
  it('时间轴的那一段程序到了，沙盘四边留的空不重报', { timeout: 60_000 }, async () => {
    let release: () => void = () => {};
    g.__barGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const page = await mount(null);
    try {
      // 那一段程序还没到：那一条已经在题记上面了，里面是空的；沙盘摆好了，四边留的空报过了
      await waitFor(() => attr(page.q('.fake-stage'), 'data-fake-insets') !== null);
      await settle(200);
      const band = page.q('.stage-foot .stage-bar');
      expect(band).not.toBeNull();
      expect(band!.childNodes).toHaveLength(0);
      expect(g.__barProps).toHaveLength(0);
      const before = { calls: (g.__insetCalls as StageInsets[]).length, insets: attr(page.q('.fake-stage'), 'data-fake-insets'), resizes: attr(page.q('.fake-stage'), 'data-fake-resizes') };

      // 到了：那一条里有了东西
      g.__barGate = null;
      release();
      await waitFor(() => page.q('.stage-bar .bar') !== null);
      await settle(300);
      expect(page.q('.stage-foot .stage-bar')).toBe(band);
      // 沙盘没有再被告知留多少空，也没有被告知大小变了
      expect((g.__insetCalls as StageInsets[]).length).toBe(before.calls);
      expect(attr(page.q('.fake-stage'), 'data-fake-insets')).toBe(before.insets);
      expect(attr(page.q('.fake-stage'), 'data-fake-resizes')).toBe(before.resizes);
    } finally {
      g.__barGate = null;
      release();
      await page.unmount();
    }
  });

  it('人物页的栏里，题记上面有时间轴的那一条；一站的页面上没有——有自己的沙盘的（徐州、黄州、眉州）没有，还没有自己的沙盘、摆着全程沙盘的也没有——那一段程序也不再画', { timeout: 60_000 }, async () => {
    // 人物页：摆着全程沙盘；栏上写着“带着时间轴”
    const figurePage = await mount(null);
    expect(attr(figurePage.pane(), 'data-stage-level')).toBe('route');
    expect(attr(figurePage.pane(), 'data-stage-bar')).toBe('');
    const foot = figurePage.q('.stage-foot')!;
    const band = figurePage.q('.stage-foot .stage-bar');
    expect(band).not.toBeNull();
    // 它是底下那一条里的头一样，题记在它后面
    expect(foot.childNodes[0]).toBe(band);
    expect(foot.childNodes.indexOf(figurePage.q('.stage-caption')!)).toBeGreaterThan(0);
    await waitFor(() => figurePage.q('.stage-bar .bar') !== null);
    // 沙盘栏交给那一段程序的：这座全程沙盘，每一站的印，挂着立体的沙盘的那个位置（小像是摆在它上面的）
    const props = (g.__barProps as BarProps[]).at(-1)!;
    expect(props.table.kind).toBe('route');
    expect(props.table.key).toBe('su-shi/route');
    expect(props.table.scene.sections.map((s) => s.heading)).toEqual(route.sections.map((s) => s.heading));
    expect(Object.keys(props.marks ?? {})).toEqual(figure.stops.map((stop) => stop.id));
    expect(typeof props.slot.current.view?.placePiece).toBe('function');
    expect(typeof props.onGoal).toBe('function');
    // 替身记得下叫它把小像摆在哪
    props.slot.current.view?.placePiece?.({ on: 'place', place: route.places[0].id });
    expect(attr(figurePage.q('.fake-stage'), 'data-fake-piece')).toBe(JSON.stringify({ on: 'place', place: route.places[0].id }));
    props.slot.current.view?.placePiece?.(null);
    expect(attr(figurePage.q('.fake-stage'), 'data-fake-piece')).toBe('');
    await figurePage.unmount();

    // 每一站的页面：没有这一条，栏上也不写“带着时间轴”，那一段程序没有再画过
    // 还没有自己的沙盘的一站：摆的还是全程沙盘，看的是到这一站去的那一节
    const drawnBefore = (g.__barProps as BarProps[]).length;
    const bare = await mount(BARE);
    await settle(200);
    expect(attr(bare.pane(), 'data-stage-level')).toBe('route');
    expect(attr(bare.pane(), 'data-stage-bar')).toBeNull();
    expect(bare.q('.stage-foot')).not.toBeNull();
    expect(bare.q('.stage-bar')).toBeNull();
    expect(bare.q('.bar')).toBeNull();
    expect((g.__barProps as BarProps[]).length).toBe(drawnBefore);
    await bare.unmount();

    // 一站自己的沙盘：没有这一条，那一段程序也没有再画过
    expect(WRITTEN_WITH_TABLE.length).toBeGreaterThan(0);
    expect(UNWRITTEN_WITH_TABLE.length).toBeGreaterThan(0);
    for (const stopId of [...WRITTEN_WITH_TABLE, ...UNWRITTEN_WITH_TABLE]) {
      const drawn = (g.__barProps as BarProps[]).length;
      const page = await mount(stopId);
      await settle(200);
      expect(attr(page.pane(), 'data-stage-level'), stopId).toBeNull();
      expect(attr(page.pane(), 'data-stage-bar'), stopId).toBeNull();
      expect(page.q('.stage-foot'), stopId).not.toBeNull();
      expect(page.q('.stage-bar'), stopId).toBeNull();
      expect(page.q('.bar'), stopId).toBeNull();
      expect((g.__barProps as BarProps[]).length, stopId).toBe(drawn);
      await page.unmount();
    }
  });

  it('没动过时间轴：和原来一模一样——沙盘摆着头一节，中间的按钮写“回到全程”，一次也没有被叫去换小节', { timeout: 60_000 }, async () => {
    const page = await mount(null);
    try {
      await waitFor(() => page.q('.stage-bar .bar') !== null);
      await settle(300);
      expect(attr(page.pane(), 'data-stage-section')).toBe(route.sections[0].heading);
      expect(attr(page.q('.fake-stage'), 'data-fake-section')).toBe(route.sections[0].heading);
      expect(attr(page.q('.fake-stage'), 'data-fake-requests') ?? '').toBe('');
      expect(page.q('.stage-reset')!.textContent).toBe('回到全程');
    } finally {
      await page.unmount();
    }
  });

  it('时间轴报了要看后面的一节：沙盘滑到那一节，中间的按钮写“回到这一段”；再报头一节，按钮又写“回到全程”', { timeout: 60_000 }, async () => {
    const [whole, , , , , , later] = route.sections.map((s) => s.heading);
    expect(later).toBeDefined();
    const page = await mount(null);
    try {
      await waitFor(() => page.q('.stage-bar .bar') !== null);
      const props = (g.__barProps as BarProps[]).at(-1)!;
      await act(async () => props.onGoal?.(later));
      await waitFor(() => attr(page.pane(), 'data-stage-section') === later);
      expect(attr(page.q('.fake-stage'), 'data-fake-section')).toBe(later);
      // 是滑过去的，只叫了一次
      expect(attr(page.q('.fake-stage'), 'data-fake-animated')).toBe('true');
      expect(attr(page.q('.fake-stage'), 'data-fake-requests')).toBe(later);
      expect(page.q('.stage-reset')!.textContent).toBe('回到这一段');
      // 报的还是这一节：沙盘不再被叫（叫了，它会从原地滑到原地，题签白白藏起来两秒）
      await act(async () => props.onGoal?.(later));
      await settle(200);
      expect(attr(page.q('.fake-stage'), 'data-fake-requests')).toBe(later);
      // 再报头一节
      await act(async () => (g.__barProps as BarProps[]).at(-1)!.onGoal?.(whole));
      await waitFor(() => attr(page.pane(), 'data-stage-section') === whole);
      expect(page.q('.stage-reset')!.textContent).toBe('回到全程');
      expect(attr(page.q('.fake-stage'), 'data-fake-requests')).toBe(`${later}|${whole}`);
    } finally {
      await page.unmount();
    }
  });

  it('进了徐州自己的沙盘再回人物页：头一个画面就是时间轴停着的那一节，不滑；还没有自己的沙盘的一站的页面上，时间轴报过的那一节不算数', { timeout: 60_000 }, async () => {
    const later = route.sections[6].heading;
    const page = await mount(null);
    try {
      await waitFor(() => page.q('.stage-bar .bar') !== null);
      await act(async () => (g.__barProps as BarProps[]).at(-1)!.onGoal?.(later));
      await waitFor(() => attr(page.pane(), 'data-stage-section') === later);

      // 还没有自己的沙盘的一站：同一座全程沙盘，看的是到这一站去的那一节（不是时间轴报的那一节），按钮写“回到这一段”
      const road = route.sections.find((s) => s.stop === BARE)!.heading;
      expect(road).not.toBe(later);
      await page.show(BARE);
      await waitFor(() => attr(page.pane(), 'data-stage-section') === road);
      expect(page.q('.stage-bar')).toBeNull();
      expect(page.q('.stage-reset')!.textContent).toBe('回到这一段');

      // 进徐州自己的沙盘（这一栏换了一座，全程沙盘关掉了）
      await page.show(WRITTEN_WITH_TABLE[0]);
      await waitFor(() => attr(page.pane(), 'data-stage-level') === null && attr(page.pane(), 'data-stage-state') === 'ready');
      expect(page.q('.stage-bar')).toBeNull();

      // 回人物页：全程沙盘是从头摆的，头一个画面就是时间轴停着的那一节——替身一次也没有被叫去换小节
      await page.show(null);
      await waitFor(() => attr(page.pane(), 'data-stage-level') === 'route' && attr(page.pane(), 'data-stage-state') === 'ready');
      expect(attr(page.pane(), 'data-stage-section')).toBe(later);
      expect(attr(page.q('.fake-stage'), 'data-fake-section')).toBe(later);
      expect(attr(page.q('.fake-stage'), 'data-fake-requests') ?? '').toBe('');
      expect(page.q('.stage-reset')!.textContent).toBe('回到这一段');
      // 报回头一节，留给后面的测试一个干净的开头
      await waitFor(() => page.q('.stage-bar .bar') !== null);
      await act(async () => (g.__barProps as BarProps[]).at(-1)!.onGoal?.(route.sections[0].heading));
      await waitFor(() => attr(page.pane(), 'data-stage-section') === route.sections[0].heading);
    } finally {
      await page.unmount();
    }
  });
});

// 有全程沙盘、还没有行迹的人物：他的人物页站得住，全程沙盘摆得出来；没有时间轴——栏上不写 data-stage-bar，题记上面没有那一条，
// 时间轴的那一段程序不去取（docs/data-spec.md“谁要有行迹”“时间轴”）。2026-11-27 以前这样的人物页上那一条空着留在那里。
// 有没有行迹，页面是照内容的清单答的（src/domain/content.ts 的 lacksItinerary）：清单到了才知道。清单还没到的那一会儿页面不知道，
// 照有行迹的办（苏轼的页面和以前每一刻都一样）；这一会儿没有行迹的人物的栏上也写着，全程沙盘读出来的那一下拿掉——头一条测试守着这一会儿。
// 没有哪一条校验规则要“有全程沙盘的人物必须有行迹”（规则 22 只查反过来的那一头，tests/content/routeRules.test.ts 里有一条守着）；
// 这里查的是页面：这样的人物进了内容，页面不出错。
// 人物用的是校验规则的合格样本（tests/content/fixtures/good 里的 demo：有 scenes/route.json，没有 itinerary.json、itinerary.bar.json），
// 不是 content/ 里的：读人物、读全程沙盘、读首页的卡片的那三个函数在这个文件里换成“问到 demo 就给样本”，别的原样；
// 内容的清单是真的那一块（里面没有 demo 的 itinerary.json，有苏轼的）。
// 时间轴的那一段程序、页面、沙盘的替身都是真的；地址里写了 ?bar=0（沙盘的替身上不写就不摆时间轴），所以不画只能是因为没有行迹。
// 时间轴的那一段程序取没取：它在这里包了一层，头一回有人取它就记一笔。
// 用假 DOM（miniDom.ts）在 Node 里跑；这个文件自己一个进程。几条测试是照先后写的：头一条要在谁也没取过内容的清单的时候跑。
import { describe, expect, it, vi } from 'vitest';
import type { Figure, FigureCard, RouteScene } from '../../../src/domain';
import { readBytes } from '../../support/readBytes';
import { installMiniDom, MiniElement } from './miniDom';

const doc = installMiniDom('?stage=fake&bar=0');
const win = (globalThis as any).window;
const g = globalThis as any;

const SAMPLE = 'tests/content/fixtures/good/figures/demo';
const readJson = <T,>(path: string): T => JSON.parse(new TextDecoder().decode(readBytes(path))) as T;
const demo = readJson<Figure>(`${SAMPLE}/figure.json`);
const demoRoute = readJson<RouteScene>(`${SAMPLE}/scenes/route.json`);
const demoTable = { scene: demoRoute, terrainUrl: 'route.terrain.bin' };
/** 首页的卡片：只有 demo 一位，可以点进去。 */
const demoCards: FigureCard[] = [{ id: 'demo', name: demo.name, era: '样本', years: '1–2', sortYear: 1, tagline: '样本', available: true }];

vi.mock('../../../src/domain/content', async (original) => {
  const actual = await original<typeof import('../../../src/domain/content')>();
  return {
    ...actual,
    loadFigure: (figureId: string) => (figureId === 'demo' ? Promise.resolve(demo) : actual.loadFigure(figureId)),
    // 首页的卡片：测试说了“只有 demo”的时候给那一张，别的时候是真的
    loadFigureCards: () => (g.__demoCards ? ((g.__cardsGate as Promise<void> | undefined) ?? Promise.resolve()).then(() => demoCards) : actual.loadFigureCards()),
  };
});
vi.mock('../../../src/domain/sceneContent', async (original) => {
  const actual = await original<typeof import('../../../src/domain/sceneContent')>();
  return {
    ...actual,
    // 样本里的全程沙盘没有工具做的那两样（先画好的地面、定格图）：只有场景和地形文件的网址，沙盘的替身不去取它。
    // 测试要它等着的时候（g.__routeGate），等放行了才交
    loadRouteTable: (figureId: string) => (figureId === 'demo' ? ((g.__routeGate as Promise<void> | undefined) ?? Promise.resolve()).then(() => demoTable) : actual.loadRouteTable(figureId)),
  };
});
// 时间轴的那一段程序：头一回有人取它，记一笔（取到的还是真的那一段）
vi.mock('../../../src/timebar/TimeBar', async (original) => {
  g.__barFetched = (g.__barFetched ?? 0) + 1;
  return original<typeof import('../../../src/timebar/TimeBar')>();
});

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { FigureLayout } = await import('../../../src/ui/FigureLayout');
const { HomePage } = await import('../../../src/ui/HomePage');
const { lacksItinerary, loadLists } = await import('../../../src/domain/content');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = (ms = 60) => act(async () => void (await sleep(ms)));
const attr = (el: MiniElement | null, name: string) => el?.getAttribute(name) ?? null;
async function waitFor(ok: () => boolean, ms = 15000) {
  const until = Date.now() + ms;
  while (!ok() && Date.now() < until) await settle(20);
  if (!ok()) throw new Error('等不到');
}

/** 把一页摆上；不等它摆好（要等的自己等）。 */
async function show(element: React.ReactElement) {
  win.location.search = '?stage=fake&bar=0';
  g.__sectionTops = {};
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container as any);
  await act(async () => root.render(element));
  const pane = () => container.querySelector('.stage-pane')!;
  return { pane, q: (selector: string) => container.querySelector(selector), all: (selector: string) => container.querySelectorAll(selector), unmount: () => act(async () => root.unmount()) };
}

describe('有全程沙盘、还没有行迹的人物（校验规则的合格样本 demo）', () => {
  it('样本是这样的一位人物：有 scenes/route.json，没有 itinerary.json、itinerary.bar.json；content/ 里也没有叫 demo 的人物', () => {
    const files = Object.keys(import.meta.glob('/tests/content/fixtures/good/figures/demo/**/*'));
    expect(files).toContain('/tests/content/fixtures/good/figures/demo/scenes/route.json');
    expect(files.filter((path) => path.includes('itinerary'))).toEqual([]);
    expect(demoRoute.level).toBe('route');
    expect(Object.keys(import.meta.glob('/content/figures/demo/**/*'))).toEqual([]);
  });

  it('内容的清单还没到的那一会儿，页面还不知道这位人物有没有行迹，照有行迹的办：栏上写着 data-stage-bar；清单到了、全程沙盘读出来的那一下拿掉，那时才有画面——时间轴的那一条从头到尾没有出现过，那一段程序没有去取', { timeout: 60_000 }, async () => {
    // 这一条要在谁也没取过内容的清单的时候跑：还不知道，问谁都答“不是没有行迹”
    expect(lacksItinerary('demo')).toBe(false);
    expect(lacksItinerary('su-shi')).toBe(false);
    // 全程沙盘先扣着不交：栏还在“正在摆”，里面没有画面
    let release = (): void => {};
    g.__routeGate = new Promise<void>((resolve) => (release = resolve));
    const page = await show(<FigureLayout figureId="demo" stopId={null} />);
    await settle(100);
    expect(attr(page.pane(), 'data-stage-state')).toBe('loading');
    expect(attr(page.pane(), 'data-stage-picture')).toBe('none');
    // 还不知道：和有行迹的人物一个样子，栏上写着（苏轼的栏一摆上就写着，靠的就是这一条路）
    expect(attr(page.pane(), 'data-stage-bar')).toBe('');
    expect(page.q('.stage-bar')).toBeNull();
    // 清单到了：知道了。demo 没有行迹，苏轼有；还不知道是哪位人物（空的名字）不算没有
    await act(async () => void (await loadLists()));
    expect(lacksItinerary('demo')).toBe(true);
    expect(lacksItinerary('su-shi')).toBe(false);
    expect(lacksItinerary('')).toBe(false);
    // 全程沙盘读出来的那一下：栏上不写了，沙盘摆出来，没有那一条
    release();
    await waitFor(() => attr(page.pane(), 'data-stage-state') === 'ready');
    g.__routeGate = undefined;
    expect(attr(page.pane(), 'data-stage-bar')).toBeNull();
    expect(page.q('.stage-bar')).toBeNull();
    await settle(300);
    expect(page.q('.stage-bar')).toBeNull();
    expect(g.__barFetched ?? 0).toBe(0);
    await page.unmount();
  });

  it('人物页站得住：名字、各站的目录都在；全程沙盘摆出来了，看的是头一节；栏上不写 data-stage-bar（头一回摆上就不写），题记上面没有时间轴的那一条，时间轴的那一段程序没有去取，也没有哪一句“没能读出来”；页面不往控制台里报错', { timeout: 60_000 }, async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    // 内容的清单到了（页面的程序一开始跑就去要它，平常比人物的资料先到）
    await loadLists();
    expect(g.__barFetched ?? 0).toBe(0);
    // 先扣着全程沙盘看头一回摆上的样子：栏在“正在摆”，已经不写 data-stage-bar
    let release = (): void => {};
    g.__routeGate = new Promise<void>((resolve) => (release = resolve));
    const page = await show(<FigureLayout figureId="demo" stopId={null} />);
    await settle(100);
    expect(attr(page.pane(), 'data-stage-state')).toBe('loading');
    expect(attr(page.pane(), 'data-stage-bar')).toBeNull();
    release();
    await waitFor(() => attr(page.pane(), 'data-stage-state') === 'ready');
    g.__routeGate = undefined;
    // 人物页：名字和三站的目录
    expect(page.q('.page-title')?.textContent).toBe(demo.name);
    expect(page.all('.stops a.stop-item').map((link) => attr(link, 'href'))).toEqual(demo.stops.map((stop) => `#/demo/${stop.id}`));
    // 全程沙盘摆出来了，看的是头一节
    expect(attr(page.pane(), 'data-stage-state')).toBe('ready');
    expect(attr(page.pane(), 'data-stage-level')).toBe('route');
    expect(attr(page.pane(), 'data-stage-section')).toBe(demoRoute.sections[0].heading);
    expect(page.q('.stage-line')?.textContent).toBe(demoRoute.sections[0].line);
    // 没有时间轴：栏上不写，那一条不在，题记照常在；等一会儿再看还是这样
    expect(attr(page.pane(), 'data-stage-bar')).toBeNull();
    expect(page.all('.stage-bar')).toHaveLength(0);
    expect(page.all('.stage-foot')).toHaveLength(1);
    await settle(300);
    expect(page.all('.stage-bar')).toHaveLength(0);
    expect(page.all('.quiet').map((line) => line.textContent).filter((line) => (line ?? '').includes('没能读出来'))).toEqual([]);
    // 时间轴的那一段程序一次也没有去取
    expect(g.__barFetched ?? 0).toBe(0);
    // 沙盘照常：还是摆好的
    expect(attr(page.pane(), 'data-stage-state')).toBe('ready');
    await page.unmount();

    // 再看一位有行迹的人物（content/ 里的苏轼）：同样的地址，栏一摆上就写着 data-stage-bar，时间轴画出来了——
    // 时间轴的那一段程序取得到、摆得上、取的那一下记得到，上面“没有去取”才算数
    const withBar = await show(<FigureLayout figureId="su-shi" stopId={null} />);
    // 人物的资料读出来、栏头一回摆上（还在“正在摆”或者刚摆好）：写着
    await waitFor(() => withBar.all('.stage-pane').length === 1 && withBar.q('.page-title') !== null);
    expect(attr(withBar.pane(), 'data-stage-bar')).toBe('');
    await waitFor(() => attr(withBar.pane(), 'data-stage-state') === 'ready');
    expect(attr(withBar.pane(), 'data-stage-bar')).toBe('');
    await waitFor(() => (withBar.q('.stage-bar')?.childNodes.length ?? 0) > 0);
    expect(withBar.q('.stage-bar .quiet')).toBeNull();
    expect(g.__barFetched).toBe(1);
    await withBar.unmount();
    expect(errors.mock.calls.map((call) => String(call[0]))).toEqual([]);
    errors.mockRestore();
  });

  it('首页摆的要是这样一位人物的全程沙盘（第一位可以点进去的是他）：卡片还没读出来、还不知道是谁的时候栏上写着 data-stage-bar；知道了是他，栏上不写，没有时间轴的那一条', { timeout: 60_000 }, async () => {
    await loadLists();
    g.__demoCards = true;
    // 卡片先扣着：还不知道首页摆谁的沙盘，栏上照旧写着
    let release = (): void => {};
    g.__cardsGate = new Promise<void>((resolve) => (release = resolve));
    const home = await show(<HomePage />);
    await settle(100);
    expect(home.all('a.card')).toHaveLength(0);
    expect(attr(home.pane(), 'data-stage-state')).toBe('loading');
    expect(attr(home.pane(), 'data-stage-bar')).toBe('');
    release();
    await waitFor(() => attr(home.pane(), 'data-stage-state') === 'ready');
    expect(home.q('a.card')?.getAttribute('data-figure-id')).toBe('demo');
    expect(attr(home.pane(), 'data-stage-level')).toBe('route');
    expect(attr(home.pane(), 'data-stage-bar')).toBeNull();
    expect(home.all('.stage-bar')).toHaveLength(0);
    await home.unmount();
    g.__demoCards = false;
    g.__cardsGate = undefined;
    // 真的卡片（第一位可以点进去的是苏轼，他有行迹）：栏上写着，那一条在
    const real = await show(<HomePage />);
    expect(attr(real.pane(), 'data-stage-bar')).toBe('');
    await waitFor(() => attr(real.pane(), 'data-stage-state') === 'ready');
    expect(attr(real.pane(), 'data-stage-bar')).toBe('');
    expect(real.all('.stage-bar')).toHaveLength(1);
    await real.unmount();
  });
});

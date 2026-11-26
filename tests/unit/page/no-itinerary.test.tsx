// 有全程沙盘、还没有行迹的人物：他的人物页站得住，全程沙盘摆得出来，时间轴的那一条空着（什么也不画，也不说“没能读出来”）。
// 没有哪一条校验规则要“有全程沙盘的人物必须有行迹”（规则 22 只查反过来的那一头，tests/content/routeRules.test.ts 里有一条守着）；
// 这里查的是页面：这样的人物进了内容，页面不出错。
// 人物用的是校验规则的合格样本（tests/content/fixtures/good 里的 demo：有 scenes/route.json，没有 itinerary.json、itinerary.bar.json），
// 不是 content/ 里的：读人物、读全程沙盘的那两个函数在这个文件里换成“问到 demo 就给样本”，别的原样。
// 时间轴的那一段程序、页面、沙盘的替身都是真的；地址里写了 ?bar=0（沙盘的替身上不写就不摆时间轴），所以不画只能是因为没有行迹。
// 用假 DOM（miniDom.ts）在 Node 里跑；这个文件自己一个进程。
import { describe, expect, it, vi } from 'vitest';
import type { Figure, RouteScene } from '../../../src/domain';
import { readBytes } from '../../support/readBytes';
import { installMiniDom, MiniElement } from './miniDom';

const doc = installMiniDom('?stage=fake&bar=0');
const win = (globalThis as any).window;
const g = globalThis as any;

const SAMPLE = 'tests/content/fixtures/good/figures/demo';
const readJson = <T,>(path: string): T => JSON.parse(new TextDecoder().decode(readBytes(path))) as T;
const demo = readJson<Figure>(`${SAMPLE}/figure.json`);
const demoRoute = readJson<RouteScene>(`${SAMPLE}/scenes/route.json`);

vi.mock('../../../src/domain/content', async (original) => {
  const actual = await original<typeof import('../../../src/domain/content')>();
  return { ...actual, loadFigure: (figureId: string) => (figureId === 'demo' ? Promise.resolve(demo) : actual.loadFigure(figureId)) };
});
vi.mock('../../../src/domain/sceneContent', async (original) => {
  const actual = await original<typeof import('../../../src/domain/sceneContent')>();
  return {
    ...actual,
    // 样本里的全程沙盘没有工具做的那两样（先画好的地面、定格图）：只有场景和地形文件的网址，沙盘的替身不去取它
    loadRouteTable: (figureId: string) => (figureId === 'demo' ? Promise.resolve({ scene: demoRoute, terrainUrl: 'route.terrain.bin' }) : actual.loadRouteTable(figureId)),
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

async function mount(figureId: string) {
  win.location.search = '?stage=fake&bar=0';
  g.__sectionTops = {};
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container as any);
  await act(async () => root.render(<FigureLayout figureId={figureId} stopId={null} />));
  const pane = () => container.querySelector('.stage-pane')!;
  await waitFor(() => attr(pane(), 'data-stage-state') === 'ready');
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

  it('人物页站得住：名字、各站的目录都在；全程沙盘摆出来了，看的是头一节；时间轴的那一条留着地方、里面什么也没有，也没有哪一句“没能读出来”；页面不往控制台里报错', { timeout: 60_000 }, async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    // 先看一位有行迹的人物（content/ 里的苏轼）：同样的地址，时间轴画出来了——时间轴的那一段程序取得到、摆得上，下面“什么也没有”才算数
    const withBar = await mount('su-shi');
    await waitFor(() => (withBar.q('.stage-bar')?.childNodes.length ?? 0) > 0);
    expect(withBar.q('.stage-bar .quiet')).toBeNull();
    await withBar.unmount();

    const page = await mount('demo');
    // 人物页：名字和三站的目录
    expect(page.q('.page-title')?.textContent).toBe(demo.name);
    expect(page.all('.stops a.stop-item').map((link) => attr(link, 'href'))).toEqual(demo.stops.map((stop) => `#/demo/${stop.id}`));
    // 全程沙盘摆出来了，看的是头一节
    expect(attr(page.pane(), 'data-stage-state')).toBe('ready');
    expect(attr(page.pane(), 'data-stage-level')).toBe('route');
    expect(attr(page.pane(), 'data-stage-section')).toBe(demoRoute.sections[0].heading);
    expect(page.q('.stage-line')?.textContent).toBe(demoRoute.sections[0].line);
    // 时间轴的那一条：地方留着（栏上写着 data-stage-bar，那一条在），里面什么也没有。那一段程序上一座沙盘已经取到了，这里等它摆上再看
    expect(attr(page.pane(), 'data-stage-bar')).toBe('');
    expect(page.all('.stage-bar')).toHaveLength(1);
    await settle(300);
    expect(page.q('.stage-bar')?.childNodes.length).toBe(0);
    expect(page.q('.stage-bar')?.textContent).toBe('');
    expect(page.all('.quiet').map((line) => line.textContent).filter((line) => (line ?? '').includes('没能读出来'))).toEqual([]);
    // 沙盘照常：还是摆好的
    expect(attr(page.pane(), 'data-stage-state')).toBe('ready');
    await page.unmount();
    expect(errors.mock.calls.map((call) => String(call[0]))).toEqual([]);
    errors.mockRestore();
  });
});

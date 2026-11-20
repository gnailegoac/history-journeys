// 全程沙盘在沙盘程序里摆不摆得出来（src/stage/three/view.ts 碰到全程沙盘的那几处）。在 Node 里跑，不要浏览器。
// 真的：场景文件、地形文件、先画好的地面的清单（content/ 里的）、地面的算法、地形板、座子、镜头、全程沙盘那一块程序。
// 假的：渲染器、画布、题签层、页面、钟，还有两张图片（只有大小）。
// 查这几件：
//   摆得出来：ready 完成；地形板是全程沙盘的那一种（完整 90,392 个三角形，减配 79,280 个）；不起雾；
//     先画好的地面和现在的场景、地形文件对得上（控制台里没有说“旧的”）；
//   比例尺说的是地上的长度（几百公里），不是沙盘里的米；拍定格图用的“一米多少像素”也是地上的米；
//   题签现在一条也不摆（下一步接）；
//   没有先画好的地面：ready 拒绝，说得出缘故（全程沙盘不现画）。

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BakedGroundManifest } from '../../src/domain/bakedGround';
import type { StripLayer } from '../../src/stage/overlay/types';
import { createHost } from '../../src/stage/three/host';
import { terrainGrid } from '../../src/stage/three/terrainMesh';
import { styleFor } from '../../src/stage/three/style';
import type { BrowserHost, ViewEnv } from '../../src/stage/three/view';
import type { RouteTable, StageOptions, StageViewInfo, StopStageView } from '../../src/stage/types';
import { readBytes } from '../support/readBytes';
import { fakeCanvas, fakeDocument, fakeFetch, fakeHostParts, fakeRenderer, fakeStrips, trianglesUnder } from './support/fakeRenderer';
import { realRouteScene, realSceneKeys } from './support/realScenes';

const KEY = realSceneKeys('route')[0];
const [FIGURE] = KEY.split('/');

let strips = fakeStrips();
/** 假的图片取不取得到。 */
let picturesFail = false;
/** 交不交“全程沙盘那一块程序怎么取”。 */
let withLoader = true;

vi.mock('../../src/stage/overlay', () => ({ mountStrips: (): StripLayer => strips.mount() }));
// 全程沙盘那一块程序是真的，只把“取图片”换成假的（Node 里没有 Image）：给一张只有大小的图
vi.mock('../../src/stage/three/routeLevel', async (original) => {
  const actual = await original<typeof import('../../src/stage/three/routeLevel')>();
  return {
    ...actual,
    routeGroundPaint: (table: RouteTable, signal: AbortSignal) =>
      actual.routeGroundPaint(table, signal, (url) =>
        picturesFail ? Promise.reject(new Error(`图片取不到（${url}）`)) : Promise.resolve({ width: table.ground?.width, height: table.ground?.height } as unknown as TexImageSource),
      ),
  };
});
vi.mock('three', async (original) => {
  const { fakeThree } = await import('./support/fakeRenderer');
  return fakeThree(await original<typeof import('three')>());
});

const FRAME_MS = 16;
/** 让钟一帧一帧往前走，走到 promise 有了结果（完成或者拒绝）。 */
async function until<T>(promise: Promise<T>): Promise<T> {
  let settled = false;
  const mark = (): void => {
    settled = true;
  };
  promise.then(mark, mark);
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 20_000 && !settled; i++) await vi.advanceTimersByTimeAsync(FRAME_MS);
  if (!settled) throw new Error('钟走了五分多钟，等的那件事还没有结果');
  return promise;
}

const R = realRouteScene(KEY);
const manifest = JSON.parse(new TextDecoder().decode(readBytes(`content/figures/${FIGURE}/baked/route.json`))) as BakedGroundManifest;
const baked: NonNullable<RouteTable['ground']> = { colourUrl: 'route.colour.jpg', fieldsUrl: 'route.fields.png', width: manifest.colour.width, height: manifest.colour.height, inputs: manifest.inputs };
const opened: StopStageView[] = [];

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.stubGlobal('document', fakeDocument());
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, FRAME_MS));
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  vi.stubGlobal('fetch', fakeFetch(`content/figures/${FIGURE}/scenes/${R.scene.terrain.file}`));
});
beforeEach(() => {
  strips = fakeStrips();
  picturesFail = false;
  withLoader = true;
  vi.stubGlobal('window', { devicePixelRatio: 1 });
});
afterEach(() => {
  for (const view of opened.splice(0)) view.destroy();
  vi.restoreAllMocks();
});
afterAll(async () => {
  await vi.advanceTimersByTimeAsync(300);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** 一台假的设备和一个 width × height 的容器。 */
function stage(width: number, height: number) {
  const fake = fakeRenderer();
  const { canvas } = fakeCanvas(width, height);
  const host: BrowserHost = createHost(fakeHostParts(canvas, fake.renderer).parts);
  const env: ViewEnv = { now: () => performance.now(), pageVisible: () => true };
  return { fake, host, env, pane: { clientWidth: width, clientHeight: height } as HTMLElement };
}

async function openView(s: ReturnType<typeof stage>, ground: RouteTable['ground'] | undefined, options: Partial<StageOptions> = {}): Promise<StopStageView> {
  const { createStopView } = await import('../../src/stage/three/view');
  const table: RouteTable = { kind: 'route', key: KEY, scene: R.scene, terrainUrl: 'route.terrain.bin', ...(ground ? { ground } : {}) };
  // 全程沙盘那一块程序怎么取，是页面那一边交给沙盘程序的（src/stage/index.ts）：这里照样交一个
  const loadRoute = withLoader ? () => import('../../src/stage/three/routeLevel') : undefined;
  const view = createStopView(s.pane, table, { namesMode: 'ancient', reducedMotion: true, tier: 'full', insets: { top: 62, right: 0, bottom: 130, left: 0 }, ...options }, s.host, s.env, loadRoute);
  opened.push(view);
  return view;
}

describe(`${KEY} 在沙盘程序里`, () => {
  const route = styleFor(R.scene.style).route;
  if (!route) throw new Error('样式里没有全程沙盘的那一份');

  it('摆得出来：地形板是全程沙盘的那一种，不起雾；先画好的地面和现在的场景、地形文件对得上', { timeout: 120_000 }, async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = stage(940, 900);
    const view = await openView(s, baked);
    await until(view.ready);
    expect(s.fake.frames.length).toBeGreaterThan(0);
    const world = s.fake.lastWorld();
    if (!world) throw new Error('一帧也没有画');
    expect(world.fog).toBeNull();
    // 场景里依次是：地形板、水（替身，空的）、云气（替身，空的）、路（现在是空的）、座子
    const { sx, sz } = terrainGrid(R.coords, route.segmentM);
    expect(trianglesUnder(world.children[0])).toBe(sx * sz * 2 + (sx + sz) * 4);
    expect(trianglesUnder(world.children[0])).toBe(90_392);
    expect(trianglesUnder(world.children[1])).toBe(0);
    expect(trianglesUnder(world.children[2])).toBe(0);
    expect(trianglesUnder(world.children[3])).toBe(0);
    // content/ 里先画好的地面不比场景和地形文件旧：没有说“旧的”，也没有别的抱怨
    expect(warn.mock.calls.map((call) => String(call[0]))).toEqual([]);
  });

  it('减配的一档：网格粗 1.07 倍，三角形少一成多', { timeout: 120_000 }, async () => {
    const s = stage(940, 900);
    const view = await openView(s, baked, { tier: 'reduced' });
    await until(view.ready);
    const world = s.fake.lastWorld();
    if (!world) throw new Error('一帧也没有画');
    const { sx, sz } = terrainGrid(R.coords, route.segmentM * route.reducedSegmentTimes);
    expect(trianglesUnder(world.children[0])).toBe(sx * sz * 2 + (sx + sz) * 4);
    expect(trianglesUnder(world.children[0])).toBe(79_280);
  });

  it('比例尺和“一米多少像素”说的是地上的米：全程一节的比例尺是几百公里；题签现在一条也不摆', { timeout: 120_000 }, async () => {
    const s = stage(940, 900);
    const view = await openView(s, baked);
    const infos: StageViewInfo[] = [];
    view.onViewChange((info) => infos.push(info));
    await until(view.ready);
    const info = infos.at(-1);
    if (!info) throw new Error('没有通知比例尺');
    expect(info.scale.label).toMatch(/^(100|200|500) 公里$/);
    expect(info.scale.px).toBeGreaterThanOrEqual(56);
    expect(info.scale.px).toBeLessThanOrEqual(140);
    const shot = view.readout().shot;
    if (!shot) throw new Error('读数里没有这个画面的底细');
    expect(shot.section).toBe(R.headings[0]);
    // 比例尺那一段的像素 = 那么多米 × 一米多少像素（差在取整上）
    const metres = Number(info.scale.label.split(' ')[0]) * 1000;
    expect(Math.abs(metres * shot.pxPerMetre - info.scale.px)).toBeLessThan(1);
    // 镜头离对准的那一点，除以比例以后在两千公里的沙盘上：一米不到千分之一个像素
    expect(shot.pxPerMetre).toBeLessThan(0.001);
    // 这一节的题签指着的点照样算得出来（拍定格图要用），只是沙盘上现在不摆字
    expect(shot.anchors.map((anchor) => anchor.id)).toEqual(R.scene.sections[0].strips);
    expect(strips.specs()).toEqual([]);
    expect(strips.log[0]).toBe("set ");
  });

  it('没有先画好的地面、图片取不到：ready 拒绝，说得出缘故', { timeout: 120_000 }, async () => {
    const s = stage(940, 900);
    const none = await openView(s, undefined);
    await expect(until(none.ready)).rejects.toThrow('全程沙盘还没有先画好的地面');
    none.destroy();
    picturesFail = true;
    const gone = await openView(stage(940, 900), baked);
    await expect(until(gone.ready)).rejects.toThrow('图片取不到');
    gone.destroy();
    // 那一块程序怎么取没有交进来（沙盘程序自己不写那一句动态 import）：也说得出缘故
    picturesFail = false;
    withLoader = false;
    const bare = await openView(stage(940, 900), baked);
    await expect(until(bare.ready)).rejects.toThrow('全程沙盘的程序没有取到');
  });
});

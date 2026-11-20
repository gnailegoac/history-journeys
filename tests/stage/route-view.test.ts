// 全程沙盘在沙盘程序里摆不摆得出来（src/stage/three/view.ts 碰到全程沙盘的那几处）。在 Node 里跑，不要浏览器。
// 真的：场景文件、地形文件、先画好的地面的清单（content/ 里的）、地面的算法、地形板、座子、镜头、全程沙盘那一块程序。
// 假的：渲染器、画布、题签层、页面、钟，还有两张图片（只有大小）。
// 查这几件：
//   摆得出来：ready 完成；地形板是全程沙盘的那一种（完整 90,392 个三角形，减配 79,280 个）；不起雾；
//     先画好的地面和现在的场景、地形文件对得上（控制台里没有说“旧的”）；
//   比例尺说的是地上的长度（几百公里），不是沙盘里的米；拍定格图用的“一米多少像素”也是地上的米；
//   路画出来了（头一节每一趟都画）；题签摆的是这一节的那几条，是站的地名带着站号的印（页面交了每一站的印才有）；
//   没有先画好的地面：ready 拒绝，说得出缘故（全程沙盘不现画）。

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BakedGroundManifest } from '../../src/domain/bakedGround';
import type { StripLayer } from '../../src/stage/overlay/types';
import { sectionStripSpecs } from '../../src/stage/overlay/strips';
import { roadRuns, segmentCount } from '../../src/stage/roadLines';
import { createHost } from '../../src/stage/three/host';
import { ROAD_SEGMENT_TRIANGLES } from '../../src/stage/three/routeKit';
import { terrainGrid } from '../../src/stage/three/terrainMesh';
import { styleFor } from '../../src/stage/three/style';
import type { BrowserHost, ViewEnv } from '../../src/stage/three/view';
import type { RouteTable, StageOptions, StageViewInfo, StopStageView } from '../../src/stage/types';
import { stripTexts } from '../../src/domain/sceneText';
import { stopMarks } from '../../src/domain/stopMarks';
import type { Figure } from '../../src/domain/types';
import { readBytes } from '../support/readBytes';
import { drawn } from './support/budgets';
import { fakeCanvas, fakeDocument, fakeFetch, fakeHostParts, fakeRenderer, fakeStrips, trianglesUnder } from './support/fakeRenderer';
import { realRouteScene, realSceneKeys } from './support/realScenes';

const KEY = realSceneKeys('route')[0];
const [FIGURE] = KEY.split('/');

let strips = fakeStrips();
/** 假的图片取不取得到。 */
let picturesFail = false;
/** 交不交“全程沙盘那一块程序怎么取”。 */
let withLoader = true;

vi.mock('../../src/stage/overlay', async (original) => ({ ...(await original<typeof import('../../src/stage/overlay')>()), mountStrips: (): StripLayer => strips.mount() }));
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
    // 场景里依次是：地形板、水（替身，空的）、云气（替身，空的）、路、座子
    const { sx, sz } = terrainGrid(R.coords, route.segmentM);
    expect(trianglesUnder(world.children[0])).toBe(sx * sz * 2 + (sx + sz) * 4);
    expect(trianglesUnder(world.children[0])).toBe(90_392);
    expect(trianglesUnder(world.children[1])).toBe(0);
    expect(trianglesUnder(world.children[2])).toBe(0);
    // 路：头一节每一趟都画，每一笔两遍（垫底的一遍、墨线一遍），一段线六个三角形
    const whole = segmentCount(roadRuns(R.scene, R.coords, 0));
    expect(whole).toBeGreaterThan(1000);
    expect(drawn(world.children[3]).triangles).toBe(whole * 2 * ROAD_SEGMENT_TRIANGLES);
    expect(drawn(world.children[3]).calls).toBeGreaterThan(1);
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

  it('比例尺和“一米多少像素”说的是地上的米：全程一节的比例尺是几百公里；没有交每一站的印，题签上就没有印', { timeout: 120_000 }, async () => {
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
    // 这一节的题签指着的点（拍定格图要用），和沙盘上摆的那几条是同一批
    expect(shot.anchors.map((anchor) => anchor.id)).toEqual(R.scene.sections[0].strips);
    expect(strips.specs().map((spec) => spec.id)).toEqual(R.scene.sections[0].strips);
    expect(strips.specs()).toEqual(sectionStripSpecs(R.scene, R.headings[0], stripTexts(R.scene, R.headings[0], 'ancient')));
    expect(strips.specs().some((spec) => spec.seals)).toBe(false);
  });

  it('交了每一站的印：是站的地名带着印，一站一方；这一节讲的那一站的印 here 是 true；换成今天的名字，印不变', { timeout: 120_000 }, async () => {
    const figure = JSON.parse(new TextDecoder().decode(readBytes(`content/figures/${FIGURE}/figure.json`))) as Figure;
    const marks = stopMarks(figure, (id) => `#/${FIGURE}/${id}`);
    const s = stage(940, 900);
    const view = await openView(s, baked, { marks });
    await until(view.ready);
    const sealsOf = (): Record<string, string[]> => Object.fromEntries(strips.specs().flatMap((spec) => (spec.seals ? [[spec.text, spec.seals.map((seal) => `${seal.label}${seal.filled ? '实' : '空'}${seal.here ? '这' : ''}`)]] : [])));
    // 头一节：每一站一方，杭州两方，惠州和昌化军是同一站；没有哪一方是“这一站”
    const first = sealsOf();
    const stopsOnTable = R.scene.places.flatMap((place) => place.stops ?? []);
    expect(Object.values(first).flat().length).toBe(stopsOnTable.length);
    expect(Object.values(first).flat().some((seal) => seal.endsWith('这'))).toBe(false);
    for (const spec of strips.specs()) {
      const place = R.scene.places.find((item) => item.id === R.scene.strips.find((strip) => strip.id === spec.id)?.of);
      expect(spec.seals?.map((seal) => seal.stop) ?? [], spec.text).toEqual(place?.stops ?? []);
      for (const seal of spec.seals ?? []) {
        expect(seal.label).toBe(marks[seal.stop].label);
        expect(seal.href).toBe(`#/${FIGURE}/${seal.stop}`);
        expect(seal.filled).toBe(figure.stops.find((stop) => stop.id === seal.stop)?.status === 'complete');
        expect(seal.title).toBe(marks[seal.stop].title);
      }
    }
    // 看路的一节：到的那一站的印是“这一站”，别的不是
    for (const section of R.scene.sections.slice(1)) {
      await until(view.showSection(section.heading, { animate: false }));
      const here = strips.specs().flatMap((spec) => (spec.seals ?? []).filter((seal) => seal.here).map((seal) => seal.stop));
      expect(here.length, section.heading).toBeGreaterThan(0);
      expect(new Set(here), section.heading).toEqual(new Set([section.stop]));
    }
    // 换成今天的名字：字换了，印还是那几方
    const before = strips.specs().map((spec) => spec.seals);
    view.setNamesMode('modern');
    expect(strips.specs().map((spec) => spec.seals)).toEqual(before);
    expect(strips.specs().map((spec) => spec.text)).toEqual(stripTexts(R.scene, R.headings.at(-1) as string, 'modern').map((t) => t.text));
    console.log(`${KEY} 头一节题签上的印：${Object.entries(first).map(([text, seals]) => `${text} ${seals.join(' ')}`).join('，')}`);
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

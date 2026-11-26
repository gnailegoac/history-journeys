// 全程沙盘在沙盘程序里摆不摆得出来（src/stage/three/view.ts 碰到全程沙盘的那几处）。在 Node 里跑，不要浏览器。
// 真的：场景文件、地形文件、先画好的地面的清单（content/ 里的）、地面的算法、地形板、座子、镜头、全程沙盘那一块程序。
// 假的：渲染器、画布、题签层、页面、钟，还有两张图片（只有大小）。
// 查这几件：
//   摆得出来：ready 完成；地形板是全程沙盘的那一种（完整 90,392 个三角形，减配 79,280 个）；不起雾；
//     先画好的地面和现在的场景、地形文件对得上（控制台里没有说“旧的”）；
//   比例尺说的是地上的长度（几百公里），不是沙盘里的米；拍定格图用的“一米多少像素”也是地上的米；
//   路画出来了（头一节每一趟都画）；题签摆的是这一节的那几条，是站的地名带着站号的印（页面交了每一站的印才有）；
//   没有先画好的地面：ready 拒绝，说得出缘故（全程沙盘不现画）；
//   潜到一站上空（dive）：镜头真的照钟点挪过去，读者的手打不断它，不算一趟滑动；还没摆好、要少动的时候不潜。
//   小像（placePiece）：还没摆好就说的记着、头一帧里就有他；认不得的地方当作没有；不叫就一帧不多画，叫一次多画一帧；
//     潜的时候收起来（他正站在那一站的除外），回来再摆出来；他停着的时候（站在一处，或者停在路上）题签层每一次摆都收到让开他的方块，在路上走的时候不给。
//     站点沙盘上叫它什么也不摆，在 view.test.ts。

import type { Mesh, Scene } from 'three';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BakedGroundManifest } from '../../src/domain/bakedGround';
import type { ItineraryBar } from '../../src/domain/itinerary';
import type { StripLayer } from '../../src/stage/overlay/types';
import { sectionStripSpecs } from '../../src/stage/overlay/strips';
import { roadRuns, segmentCount } from '../../src/stage/roadLines';
import { createHost } from '../../src/stage/three/host';
import { ROAD_SEGMENT_TRIANGLES } from '../../src/stage/three/routeKit';
import { DIVE_AIM_SHARE, DIVE_DISTANCE_M } from '../../src/stage/three/routeLevel';
import { terrainGrid } from '../../src/stage/three/terrainMesh';
import { styleFor } from '../../src/stage/three/style';
import type { BrowserHost, ViewEnv } from '../../src/stage/three/view';
import type { RouteTable, StageOptions, StageViewInfo, StopStageView } from '../../src/stage/types';
import { stripTexts } from '../../src/domain/sceneText';
import { hasStopTable } from '../../src/domain/sceneContent';
import { stopMarks } from '../../src/domain/stopMarks';
import type { Figure } from '../../src/domain/types';
import { readBytes } from '../support/readBytes';
import { drawn } from './support/budgets';
import { fakeCanvas, fakeDocument, fakeFetch, fakeHostParts, fakeRenderer, fakeStrips, trianglesUnder } from './support/fakeRenderer';
import { realFigure, realRouteScene } from './support/realScenes';

/** 查的是苏轼的全程沙盘：三角形数、先画好的地面的清单、行迹都是他的。写着名字取，不取“排在最前面的那一座”。 */
const KEY = 'su-shi/route';
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
  const { canvas, el, doc } = fakeCanvas(width, height);
  const host: BrowserHost = createHost(fakeHostParts(canvas, fake.renderer).parts);
  const env: ViewEnv = { now: () => performance.now(), pageVisible: () => true };
  return { fake, host, env, el, doc, pane: { clientWidth: width, clientHeight: height } as HTMLElement };
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

  it('潜到一站上空：镜头照钟点挪到那一站上空，先对准、再凑近；题签只留那一站自己的那一条；读者的手打不断它；不算一趟滑动（不量快慢）；换回小节题签都回来', { timeout: 120_000 }, async () => {
    const stop = R.scene.sections.find((section) => section.stop && hasStopTable(realFigure(FIGURE), section.stop))?.stop;
    if (!stop) throw new Error('这位人物没有哪一站有自己的沙盘');
    const place = R.scene.places.find((p) => p.stops?.includes(stop));
    if (!place) throw new Error('沙盘上没有这一站的地名点');
    const [px, pz] = R.coords.toLocal(place.at);
    const spot = [px, R.coords.y(R.samplers.height(px, pz)), pz];
    const own = R.scene.strips.find((strip) => strip.of === place.id)?.id;
    if (!own) throw new Error('这一站的地名点没有题签');
    const shown = (): string[] => strips.specs().map((spec) => spec.id);
    const far = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const pose = (view: StopStageView) => {
      const shot = view.readout().shot;
      if (!shot) throw new Error('读数里没有这个画面的底细');
      return shot.pose;
    };
    const MS = 900;

    const s = stage(940, 900);
    const view = await openView(s, baked, { reducedMotion: false });
    if (!view.dive) throw new Error('这座沙盘不会潜');
    // 还没摆好：不潜
    expect(await view.dive(stop, MS)).toBe(false);
    await until(view.ready);
    // 沙盘上没有的站：不潜，题签不动
    expect(await view.dive('no-such-stop', MS)).toBe(false);
    expect(strips.log).not.toContain('hide');
    expect(shown()).toEqual(R.scene.sections[0].strips);
    const start = pose(view);
    const frames = view.readout().perf?.frames ?? 0;

    const done = view.dive(stop, MS);
    // 这一节本来就摆着那一条：别的拿掉，它留在原处（不是重新换一批）
    expect(strips.log).toContain(`only ${own}`);
    expect(shown()).toEqual([own]);
    const placed = strips.places.length;
    // 钟点走到“对准的那一点先到”的时候：镜头正对着那一站，离它还远
    await vi.advanceTimersByTimeAsync(MS * DIVE_AIM_SHARE + FRAME_MS);
    const aimed = pose(view);
    expect(far(aimed.target, spot)).toBeLessThan(1);
    expect(far(aimed.position, aimed.target)).toBeGreaterThan(DIVE_DISTANCE_M * 3);
    expect(far(aimed.position, aimed.target)).toBeLessThan(far(start.position, start.target));
    // 读者的手碰到了沙盘（滚轮、按下）：潜的这一会儿不理它
    s.el.fire('wheel', { deltaY: -300, deltaMode: 0, clientX: 400, clientY: 400, ctrlKey: false });
    s.el.fire('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 400, clientY: 400, pageX: 400, pageY: 400 });
    expect(await until(done)).toBe(true);
    const end = pose(view);
    expect(far(end.target, spot)).toBeLessThan(1);
    expect(far(end.position, end.target)).toBeCloseTo(DIVE_DISTANCE_M, 0);
    expect(view.readout().perf?.frames ?? 0).toBeGreaterThan(frames + 10);
    // 一路上只有那一站自己的那一条，每一帧跟着镜头摆，留在原来的位置上不重新挑（和“读者的手还在动”一样的摆法）；这一趟不算滑动，不拿它量设备的快慢
    expect(shown()).toEqual([own]);
    expect(strips.log).not.toContain('hide');
    expect(strips.places.length).toBeGreaterThan(placed + 10);
    expect(strips.places.slice(placed).every((p) => p.anchors.length === 1 && p.moving)).toBe(true);
    expect(view.readout().perf?.glideMs).toBeNull();
    // 没有换页（读者按了返回）：页面叫它回到小节，题签回来
    await until(view.showSection(R.headings[0], { animate: false }));
    expect(shown()).toEqual(R.scene.sections[0].strips);
    expect(far(pose(view).target, start.target)).toBeLessThan(1);
    // 从一个没有摆那一站的题签的小节起步：照头一节的那一条摆
    const without = R.scene.sections.find((section) => !section.strips.includes(own));
    if (without) {
      await until(view.showSection(without.heading, { animate: false }));
      expect(shown()).not.toContain(own);
      const sets = strips.log.filter((line) => line.startsWith('set ')).length;
      expect(await until(view.dive(stop, MS))).toBe(true);
      expect(shown()).toEqual([own]);
      expect(strips.log.filter((line) => line.startsWith('set ')).length).toBe(sets + 1);
    }
    console.log(`${KEY} 潜到 ${stop}：留着的题签是 ${own}；${without ? `“${without.heading}”没有摆它，也试过了` : '每一小节都摆着它'}`);

    // 系统说要少动：不潜
    const calm = await openView(stage(940, 900), baked, { reducedMotion: true });
    await until(calm.ready);
    expect(await calm.dive?.(stop, MS)).toBe(false);
  });
});

describe(`${KEY} 上的小像（placePiece）`, () => {
  const route = styleFor(R.scene.style).route;
  if (!route) throw new Error('样式里没有全程沙盘的那一份');
  const bar = JSON.parse(new TextDecoder().decode(readBytes(`content/figures/${FIGURE}/itinerary.bar.json`))) as ItineraryBar;
  /** 沙盘上有站的地名点，照场景里写的先后。 */
  const towns = R.scene.places.filter((place) => place.stops?.length).map((place) => place.id);

  /** 这一帧的场景里的小像（排在路后面画的那个网格，renderOrder 14）；还没造是 undefined。 */
  function pieceMesh(world: Scene | null): Mesh | undefined {
    let found: Mesh | undefined;
    world?.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh && mesh.renderOrder === 14) found = mesh;
    });
    return found;
  }
  /** 小像站在一个地名点上的时候脚下那一点：地面（海上是海面）再抬起路的线抬的那么高。 */
  function footOf(placeId: string): [number, number, number] {
    const place = R.scene.places.find((item) => item.id === placeId);
    if (!place) throw new Error(`沙盘上没有这个地名点：${placeId}`);
    const [x, z] = R.coords.toLocal(place.at);
    const sea = R.scene.water.levels.values.normal ?? -Infinity;
    return [x, R.coords.y(Math.max(R.samplers.height(x, z), sea)) + route!.roads.liftM, z];
  }
  const near = (got: readonly number[] | undefined, want: readonly number[], what: string): void => {
    expect(got, what).toBeDefined();
    want.forEach((value, i) => expect(got![i], `${what}（第 ${i + 1} 个数）`).toBeCloseTo(value, 3));
  };
  /** 让钟走几帧。 */
  const frames = async (n: number): Promise<void> => {
    await vi.advanceTimersByTimeAsync(FRAME_MS * n);
  };
  const place = (view: StopStageView, where: Parameters<NonNullable<StopStageView['placePiece']>>[0]): void => {
    if (!view.placePiece) throw new Error('这座沙盘没有 placePiece');
    view.placePiece(where);
  };

  it('placePiece：还没摆好就说的，记着最后一次，头一帧里就有他', { timeout: 120_000 }, async () => {
    const s = stage(940, 900);
    // 每画完一帧记一笔：这一帧的场景里有没有显着的小像
    const had: boolean[] = [];
    s.fake.afterEveryRender(() => had.push(pieceMesh(s.fake.lastWorld())?.visible === true));
    const view = await openView(s, baked);
    place(view, { on: 'place', place: towns[0] });
    place(view, { on: 'place', place: towns[1] });
    expect(s.fake.frames.length).toBe(0);
    expect(view.readout().piece).toBeUndefined();
    await until(view.ready);
    expect(had.length).toBeGreaterThan(0);
    expect(had[0]).toBe(true);
    expect(had.every(Boolean)).toBe(true);
    // 站的是最后一次说的那个地方，不是头一次说的
    const piece = view.readout().piece;
    near(piece?.at, footOf(towns[1]), '读数里他脚下那一点');
    near(pieceMesh(s.fake.lastWorld())?.position.toArray(), footOf(towns[1]), '网格摆在哪');
    // 在画面里面，全程那一节上 32 像素上下高
    expect(piece!.px.x).toBeGreaterThan(0);
    expect(piece!.px.x).toBeLessThan(940);
    expect(piece!.px.y).toBeGreaterThan(62);
    expect(piece!.px.y).toBeLessThan(900 - 130);
    expect(piece!.px.h).toBeGreaterThan(29);
    expect(piece!.px.h).toBeLessThan(36);
    // 摆好以后不为他再画：站着不动，一帧不多
    const drawn = s.fake.frames.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(s.fake.frames.length).toBe(drawn);
  });

  it('认不得的地名点当作没有，控制台说一句，不抛出', { timeout: 120_000 }, async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = stage(940, 900);
    const view = await openView(s, baked);
    await until(view.ready);
    place(view, { on: 'place', place: towns[0] });
    await frames(2);
    expect(view.readout().piece).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();
    for (const where of [
      { on: 'place', place: 'no-such-place' },
      { on: 'road', ways: ['no-such-way'], from: 'start', to: 'end', k: 0.5 },
      { on: 'spot', way: 'no-such-way', at: [110, 30], name: '某地' },
    ] as const) {
      warn.mockClear();
      expect(() => place(view, { ...where } as Parameters<typeof place>[1])).not.toThrow();
      await frames(2);
      expect(view.readout().piece, where.on).toBeNull();
      expect(pieceMesh(s.fake.lastWorld())?.visible, where.on).toBe(false);
      expect(warn.mock.calls.map((call) => String(call[0])), where.on).toEqual(['[沙盘] 小像要站的地方，沙盘上没有：']);
      // 再说一个认得的地方：又摆出来
      place(view, { on: 'place', place: towns[0] });
      await frames(2);
      expect(view.readout().piece, where.on).not.toBeNull();
    }
  });

  it('不叫 placePiece，一帧也不多画；叫一次，多画一帧', { timeout: 120_000 }, async () => {
    // 没叫过的一座：摆好以后画了几帧，场景里没有小像这个网格
    const plain = stage(940, 900);
    const untouched = await openView(plain, baked);
    await until(untouched.ready);
    await vi.advanceTimersByTimeAsync(3000);
    const base = plain.fake.frames.length;
    expect(pieceMesh(plain.fake.lastWorld())).toBeUndefined();
    expect(untouched.readout().piece).toBeNull();

    // 摆好以前说过的一座：帧数和没叫过的一样
    const early = stage(940, 900);
    const told = await openView(early, baked);
    place(told, { on: 'place', place: towns[0] });
    await until(told.ready);
    await vi.advanceTimersByTimeAsync(3000);
    expect(early.fake.frames.length).toBe(base);

    // 摆好以后叫一次：正好多一帧；再站着不动，不再画
    place(untouched, { on: 'place', place: towns[0] });
    await vi.advanceTimersByTimeAsync(3000);
    expect(plain.fake.frames.length).toBe(base + 1);
    // 同一帧里叫好几次：还是一帧
    place(untouched, { on: 'place', place: towns[1] });
    place(untouched, { on: 'place', place: towns[2] });
    place(untouched, null);
    await vi.advanceTimersByTimeAsync(3000);
    expect(plain.fake.frames.length).toBe(base + 2);
    expect(untouched.readout().piece).toBeNull();
    // 三角形：小像一批画完，不超过 300 个
    place(untouched, { on: 'place', place: towns[0] });
    await frames(2);
    const mesh = pieceMesh(plain.fake.lastWorld());
    expect(mesh?.geometry.index?.count).toBeGreaterThan(0);
    expect((mesh?.geometry.index?.count ?? Infinity) / 3).toBeLessThanOrEqual(300);
  });

  it('潜到一站上空：他不在那一站就收起来，在那一站就留着；回来再摆出来', { timeout: 120_000 }, async () => {
    const stop = R.scene.sections.find((section) => section.stop && hasStopTable(realFigure(FIGURE), section.stop))?.stop;
    if (!stop) throw new Error('这位人物没有哪一站有自己的沙盘');
    const home = R.scene.places.find((p) => p.stops?.includes(stop));
    if (!home) throw new Error('沙盘上没有这一站的地名点');
    const elsewhere = towns.find((id) => id !== home.id) as string;
    const MS = 900;
    const s = stage(940, 900);
    const view = await openView(s, baked, { reducedMotion: false });
    if (!view.dive) throw new Error('这座沙盘不会潜');
    await until(view.ready);

    // 他在别处：一起步就收起来，一路上、到了以后都没有他；潜着的时候页面又说了一次，记着，还是不摆
    place(view, { on: 'place', place: elsewhere });
    await frames(2);
    expect(view.readout().piece).not.toBeNull();
    const down = view.dive(stop, MS);
    expect(view.readout().piece).toBeNull();
    await frames(3);
    expect(pieceMesh(s.fake.lastWorld())?.visible).toBe(false);
    place(view, { on: 'place', place: elsewhere });
    expect(view.readout().piece).toBeNull();
    expect(await until(down)).toBe(true);
    expect(view.readout().piece).toBeNull();
    // 回到小节：照最后一次说的摆出来
    await until(view.showSection(R.headings[0], { animate: false }));
    near(view.readout().piece?.at, footOf(elsewhere), '回来以后');
    expect(pieceMesh(s.fake.lastWorld())?.visible).toBe(true);

    // 他就站在那一站：留着，镜头落在他头顶上
    place(view, { on: 'place', place: home.id });
    await frames(2);
    const again = view.dive(stop, MS);
    expect(view.readout().piece).not.toBeNull();
    expect(await until(again)).toBe(true);
    near(view.readout().piece?.at, footOf(home.id), '潜到他站的那一站');
    expect(pieceMesh(s.fake.lastWorld())?.visible).toBe(true);
    // “回到这一节”那一种回来（滑回去）：他还在
    await until(view.showSection(R.headings[0], { animate: true }));
    near(view.readout().piece?.at, footOf(home.id), '滑回来以后');

    // 他在路上的时候潜：也收起来；滑回小节的一路上就摆出来了
    const road = bar.stretches.find((stretch) => stretch.ways);
    if (!road?.ways) throw new Error('行迹里没有路上的一段');
    place(view, { on: 'road', ways: road.ways, from: 'start', to: 'end', k: 0.5 });
    await frames(2);
    expect(view.readout().piece).not.toBeNull();
    const third = view.dive(stop, MS);
    expect(view.readout().piece).toBeNull();
    expect(await until(third)).toBe(true);
    const back = view.showSection(R.headings[0], { animate: true });
    await frames(3);
    expect(view.readout().piece).not.toBeNull();
    await until(back);
  });

  it('小像停着（站在一个地方；或者在路上、页面说时间轴停在这一天）：题签那一层每一次摆都收到让开他的方块；他在路上走、收起来了、没有他的时候不给', { timeout: 120_000 }, async () => {
    const s = stage(940, 900);
    const view = await openView(s, baked, { reducedMotion: false });
    await until(view.ready);
    /** 从第 from 次起题签层每一次摆收到的 avoid。 */
    const avoids = (from: number) => strips.places.slice(from).map((p) => p.avoid);
    /** 照读数里他在画面上的位置算的那一块：左右各 10 像素，从帽顶到脚下再多 8 像素。 */
    const boxNow = () => {
      const px = view.readout().piece?.px;
      if (!px) throw new Error('读数里没有小像');
      return [{ x0: px.x - 10, y0: px.y - px.h, x1: px.x + 10, y1: px.y + 8 }];
    };
    const sameBox = (got: (typeof strips.places)[number]['avoid'], what: string): void => {
      const want = boxNow()[0];
      expect(got, what).toHaveLength(1);
      for (const key of ['x0', 'y0', 'x1', 'y1'] as const) expect(got![0][key], `${what} ${key}`).toBeCloseTo(want[key], 6);
    };

    // 没有他：不给
    expect(strips.places.length).toBeGreaterThan(0);
    expect(avoids(0).every((a) => a === undefined)).toBe(true);

    // 站在一个地名点上：给一块
    let from = strips.places.length;
    place(view, { on: 'place', place: towns[0] });
    await frames(2);
    expect(strips.places.length).toBeGreaterThan(from);
    for (const a of avoids(from)) sameBox(a, '站在地名点上');

    // 站在线上没有立名字的一处：也给
    const spot = bar.stretches.find((stretch) => stretch.spot)?.spot;
    if (!spot) throw new Error('行迹里没有站在线上的一段');
    from = strips.places.length;
    place(view, { on: 'spot', way: spot[0], at: spot[1], name: spot[2] });
    await frames(2);
    expect(strips.places.length).toBeGreaterThan(from);
    for (const a of avoids(from)) sameBox(a, '站在线上的一处');

    // 换一节（直接摆到位）：新的一节照样每一次都给
    from = strips.places.length;
    place(view, { on: 'place', place: towns[0] });
    await until(view.showSection(R.headings[1], { animate: false }));
    await frames(2);
    expect(strips.places.length).toBeGreaterThan(from);
    for (const a of avoids(from).slice(-1)) sameBox(a, '换了一节以后');
    expect(avoids(from).every((a) => a?.length === 1)).toBe(true);

    // 读者的手按着转沙盘：每一帧都给，跟着他在画面上的位置走
    from = strips.places.length;
    const mouse = (x: number, y: number): Record<string, unknown> => ({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: x, clientY: y, pageX: x, pageY: y });
    s.el.fire('pointerdown', mouse(400, 400));
    s.doc.fire('pointermove', mouse(440, 405));
    await frames(2);
    s.doc.fire('pointermove', mouse(480, 410));
    await frames(2);
    expect(strips.places.slice(from).map((p) => p.moving)).toEqual([true, true]);
    expect(avoids(from).every((a) => a?.length === 1)).toBe(true);
    sameBox(avoids(from).at(-1), '读者的手按着');
    s.doc.fire('pointerup', mouse(480, 410));
    await frames(2);
    expect(strips.places.slice(from).map((p) => p.moving)).toEqual([true, true, false]);
    sameBox(avoids(from).at(-1), '手放开以后重摆的那一次');
    await until(view.showSection(R.headings[0], { animate: false }));

    // 在路上走：不给
    const road = bar.stretches.find((stretch) => stretch.ways);
    if (!road?.ways) throw new Error('行迹里没有路上的一段');
    from = strips.places.length;
    place(view, { on: 'road', ways: road.ways, from: 'start', to: 'end', k: 0.3 });
    await frames(2);
    expect(view.readout().piece).not.toBeNull();
    expect(strips.places.length).toBeGreaterThan(from);
    expect(avoids(from).every((a) => a === undefined)).toBe(true);
    // 明说“没有停着”：也不给
    from = strips.places.length;
    view.placePiece?.({ on: 'road', ways: road.ways, from: 'start', to: 'end', k: 0.35 }, false);
    await frames(2);
    expect(strips.places.length).toBeGreaterThan(from);
    expect(avoids(from).every((a) => a === undefined)).toBe(true);

    // 停在路上（页面说时间轴停在这一天）：给，同站在一处一样
    from = strips.places.length;
    view.placePiece?.({ on: 'road', ways: road.ways, from: 'start', to: 'end', k: 0.35 }, true);
    await frames(2);
    expect(strips.places.length).toBeGreaterThan(from);
    for (const a of avoids(from)) sameBox(a, '停在路上');
    // 接着走：又不给
    from = strips.places.length;
    view.placePiece?.({ on: 'road', ways: road.ways, from: 'start', to: 'end', k: 0.4 });
    await frames(2);
    expect(strips.places.length).toBeGreaterThan(from);
    expect(avoids(from).every((a) => a === undefined)).toBe(true);

    // 拿走了：不给
    place(view, { on: 'place', place: towns[0] });
    await frames(2);
    from = strips.places.length;
    place(view, null);
    await frames(2);
    expect(strips.places.length).toBeGreaterThan(from);
    expect(avoids(from).every((a) => a === undefined)).toBe(true);

    // 潜的时候收起来了：不给
    const stop = R.scene.sections.find((section) => section.stop && hasStopTable(realFigure(FIGURE), section.stop))?.stop;
    const home = R.scene.places.find((p) => stop && p.stops?.includes(stop));
    if (!stop || !home || !view.dive) throw new Error('这位人物没有哪一站有自己的沙盘');
    place(view, { on: 'place', place: towns.find((id) => id !== home.id) as string });
    await frames(2);
    from = strips.places.length;
    expect(await until(view.dive(stop, 600))).toBe(true);
    expect(strips.places.length).toBeGreaterThan(from);
    expect(avoids(from).every((a) => a === undefined)).toBe(true);
  });

  it('小像站在线上、沙盘平时没有立名字的一处：这一节的题签最后多一条那一处的名字（没有印），指着他脚下，当场就摆；选了今名、这一处有今名的写今名；他换到另一处换成另一处的；上了路、站到有名字的地方、拿走了、潜下去，这一条就没有了；别的题签一条不少、先后不变', { timeout: 120_000 }, async () => {
    const { PIECE_NAME } = await import('../../src/stage/three/routeLevel');
    const s = stage(940, 900);
    const view = await openView(s, baked, { reducedMotion: false });
    await until(view.ready);
    const ids = (): string[] => strips.specs().map((spec) => spec.id);
    const plain = ids();
    expect(plain.length).toBeGreaterThan(0);
    expect(plain).not.toContain(PIECE_NAME);
    const spots = bar.stretches.flatMap((stretch) => (stretch.spot ? [stretch.spot] : []));
    const old = spots.find((spot) => spot[3] === undefined);
    const renamed = spots.find((spot) => spot[3] !== undefined);
    if (!old || !renamed) throw new Error('行迹里要有一处没有今名的、一处有今名的');
    const at = (spot: (typeof spots)[number]) => ({ on: 'spot' as const, way: spot[0], at: spot[1], name: spot[2], ...(spot[3] ? { modern: spot[3] } : {}) });

    // 站到一处：不等下一帧，题签那一层当场换了一批（最后多一条）、当场摆了一次
    let sets = strips.log.filter((line) => line.startsWith('set ')).length;
    let placed = strips.places.length;
    view.placePiece?.(at(old));
    expect(strips.log.filter((line) => line.startsWith('set ')).length).toBe(sets + 1);
    expect(strips.places.length).toBe(placed + 1);
    expect(ids()).toEqual([...plain, PIECE_NAME]);
    // 那一条：写的是那一处的名字，同别的地名一样的题签；没有印，没有写想摆在哪一边
    expect(strips.specs().at(-1)).toEqual({ id: PIECE_NAME, text: old[2], tone: 'place' });
    // 它指着他脚下
    const foot = view.readout().piece?.px;
    if (!foot) throw new Error('读数里没有小像');
    const mine = strips.places.at(-1)?.anchors.find((anchor) => anchor.id === PIECE_NAME);
    expect(mine?.visible).toBe(true);
    expect(mine?.x).toBeCloseTo(foot.x, 6);
    expect(mine?.y).toBeCloseTo(foot.y, 6);
    // 别的题签指的点一个不少
    expect(strips.places.at(-1)?.anchors.filter((anchor) => anchor.id !== PIECE_NAME).map((anchor) => anchor.id)).toEqual(strips.places[placed - 1].anchors.map((anchor) => anchor.id));
    // 再说一遍同一处（时间轴在这一段里挪了一天）：不再换一批
    sets = strips.log.filter((line) => line.startsWith('set ')).length;
    view.placePiece?.(at(old));
    await frames(2);
    expect(strips.log.filter((line) => line.startsWith('set ')).length).toBe(sets);

    // 换到另一处：换成另一处的名字（读者选的是古名：有今名的也写当时的名字）
    view.placePiece?.(at(renamed));
    expect(strips.specs().at(-1)).toEqual({ id: PIECE_NAME, text: renamed[2], tone: 'place' });
    // 选了今名：这一处有今名，写今名；没有今名的那一处还写当时的名字
    view.setNamesMode('modern');
    await frames(2);
    expect(strips.specs().at(-1)).toEqual({ id: PIECE_NAME, text: renamed[3], tone: 'place' });
    view.placePiece?.(at(old));
    expect(strips.specs().at(-1)).toEqual({ id: PIECE_NAME, text: old[2], tone: 'place' });
    view.setNamesMode('ancient');
    await frames(2);
    expect(ids()).toEqual([...plain, PIECE_NAME]);

    // 上了路：没有了；别的题签还是原来的那几条
    const road = bar.stretches.find((stretch) => stretch.ways);
    if (!road?.ways) throw new Error('行迹里没有路上的一段');
    view.placePiece?.({ on: 'road', ways: road.ways, from: 'start', to: 'end', k: 0.3 });
    expect(ids()).toEqual(plain);
    await frames(2);
    expect(strips.places.at(-1)?.anchors.some((anchor) => anchor.id === PIECE_NAME)).toBe(false);
    // 站到有名字的地方：没有；拿走：没有
    view.placePiece?.(at(old));
    expect(ids()).toEqual([...plain, PIECE_NAME]);
    view.placePiece?.({ on: 'place', place: towns[0] });
    expect(ids()).toEqual(plain);
    view.placePiece?.(at(old));
    view.placePiece?.(null);
    expect(ids()).toEqual(plain);

    // 镜头滑到别的一节的路上题签藏着：这时候他走到一处，不换一批；滑到了，那一节的题签里有它
    view.placePiece?.({ on: 'place', place: towns[0] });
    const glide = view.showSection(R.headings[1], { animate: true });
    await frames(2);
    sets = strips.log.filter((line) => line.startsWith('set ')).length;
    view.placePiece?.(at(old));
    expect(strips.log.filter((line) => line.startsWith('set ')).length).toBe(sets);
    await until(glide);
    await frames(2);
    expect(ids().at(-1)).toBe(PIECE_NAME);
    expect(ids().slice(0, -1)).not.toContain(PIECE_NAME);

    // 潜到一站上空：小像收起来，只留那一站自己的名字，没有他旁边的那一条
    await until(view.showSection(R.headings[0], { animate: false }));
    await frames(2);
    expect(ids()).toEqual([...plain, PIECE_NAME]);
    const stop = R.scene.sections.find((section) => section.stop && hasStopTable(realFigure(FIGURE), section.stop))?.stop;
    if (!stop || !view.dive) throw new Error('这位人物没有哪一站有自己的沙盘');
    expect(await until(view.dive(stop, 600))).toBe(true);
    expect(ids()).not.toContain(PIECE_NAME);
    expect(ids()).toHaveLength(1);
    // 潜完了，页面叫沙盘把小像拿走（时间轴的那一条随人物页一起拿走了）：留着的那一条不动，这一节的题签不再整批摆出来
    sets = strips.log.filter((line) => line.startsWith('set ')).length;
    view.placePiece?.(null);
    await frames(2);
    expect(strips.log.filter((line) => line.startsWith('set ')).length).toBe(sets);
    expect(ids()).toHaveLength(1);
  });
});

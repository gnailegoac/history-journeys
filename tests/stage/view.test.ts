// 一座站点沙盘（src/stage/three/view.ts）在 Node 里空跑，不要浏览器。两种跑法：
//
// 一、从头到尾空跑一遍（最后一项）。真的：场景文件、地形文件、地面、上色、地形板、零件库、镜头、换小节的先后、
//   读者拖动镜头（three.js 自己的 OrbitControls）。假的：渲染器（只记下画了几帧）、画布、题签层、紫檀座子要的环境贴图、
//   页面（document、window、fetch）。查的是“该做的事按该有的先后做了”，画出来什么样仍然要到浏览器里看。
//   查这几件：摆出来（头一帧带影子，紧接着试画三帧，最后再画一帧），指北和比例尺报给页面；点一下不算动镜头，拖和滚轮算，一帧只画一次；
//   “回到这一节”滑回去；滑到半路被读者接过去，等着的指令马上了结，题签换成新一节的；
//   四边留的空变了，镜头重摆、画面的中心挪到留出来的那一块中间，没变就不画；容器大小变了重摆一次，没变就不画；
//   三维画面丢了只通知一次，之后的指令照常了结；关掉（或画面丢了）以后，画过的形状和材质都放掉了；
//   同一个画布主人上再摆一座，丢过以后换新画布，没丢就接着用；减少动效时换小节只画一帧；今名、古名换得过去；
//   第一个画面摆过、ready 还没完成时叫的 showSection 直接摆到位，不滑；
//   前一座没关就再摆一座，前一座通过 onLost 告诉页面；关掉以后不再画。
//
// 二、前面几项各查沙盘自己的一条规矩，零件库、上色、地形板也换成假的（零件库和上色各有各的测试，这里不跟着它们变）：
//   地面的颜色一开始就去要、地面算好以后拿结果交给地形板；
//   readout()：没造好只有两个 0，造好以后带上画质的读数和“这个画面的底细”（给拍定格图的工具）；
//   灯只有一盏，哪一节都从同一边来，影子的虚实按罩多大一块定；
//   镜头滑动的一路上，每一帧都把这一帧真的远近告诉零件库，新一节的东西一起步就换上；
//   影子：模型只是大小变了，镜头在动就不重画，停下来补一次；显出来的东西变了照旧当场重画；
//   读者的手按着的时候，题签层被告知“还在动”，放开以后整个重摆一次；
//   试画看的“页面在不在前台”，没有另外交的时候是浏览器自己的（document.visibilityState）。
//
// 两种跑法的钟都是假的（见下面的 wait 和 until）：画了几帧、哪一帧画没画影子都是定数，不看机器快慢。
// 每一座沙盘都指定了画质（完整的一档）：指定了画质的沙盘不评快慢，这里查的事不会因为“量出来慢”中途变样。
// 试画照样做（第一个画面之后同一个画面再画三帧，不带影子），所以摆出来一共是五帧；钟是假的，画的时候不走，量出来是 0 毫秒。
// 照哪一档摆、画质的数从哪里读、试画和滑动怎么量、太慢了怎么通知页面，在 view-tier.test.ts 里查。
// 假的渲染器、画布、零件库、题签层、document 和 fetch 在 ./support/fakeRenderer.ts，别的测试文件也能用。

import { Group, Mesh, type Scene } from 'three';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneStrip } from '../../src/domain/scene';
import { stripTexts } from '../../src/domain/sceneText';
import type { StripLayer } from '../../src/stage/overlay/types';
import type { GroundPaintJob, GroundPaintSource } from '../../src/stage/three/groundPaint';
import { FULL_QUALITY, createHost } from '../../src/stage/three/host';
import type { KitContext, ModelSet } from '../../src/stage/three/internal';
import { MIST_TRIANGLES_PER_LAYER } from '../../src/stage/three/mist';
import { centredView, equivalentDistance, northDeg, pixelsPerMetre, placeCamera, poseAt, poseOn, screenAnchors, shadowBox, shadowTuning, showPoints } from '../../src/stage/three/rig';
import { styleFor } from '../../src/stage/three/style';
import { STAND_TRIANGLES } from '../../src/stage/three/table';
import type { TerrainMesh, TerrainMeshInput } from '../../src/stage/three/terrainMesh';
import type { StageInsets, StageViewInfo, StopStageView, StopTable } from '../../src/stage/types';
import { fakeCanvas, fakeDocument, fakeFetch, fakeHostParts, fakeKit, fakeRenderer, fakeStrips, trianglesUnder, type FakeFrame } from './support/fakeRenderer';
import { realScene, realSceneFile } from './support/realScenes';

const KEY = 'su-shi/xuzhou';

// ---------------------------------------------------------------- 假的几样，和“这一项用不用真的”

/** 假的零件库和题签层。每一项开头换一份新的。 */
let kit = fakeKit(() => new Group());
let strips = fakeStrips();
/** 从头到尾空跑的那一项把它们换成真的：零件库（到时候才加载），上色和地形板。 */
let realKit: typeof import('../../src/stage/three/kit') | null = null;
let realGround = false;

/** 地面的颜色那一步、取地形文件那一步发生的先后。 */
const order: string[] = [];
/** 每一次“一开始就去要”拿到的沙盘和信号；每一次“拿结果”交进去的东西和给回来的结果；每一次造地形板拿到的东西。 */
const begun: { table: StopTable; signal: AbortSignal }[] = [];
const finished: { args: Parameters<GroundPaintJob['finish']>; source: GroundPaintSource }[] = [];
const terrainInputs: TerrainMeshInput[] = [];

vi.mock('../../src/stage/overlay', () => ({ mountStrips: (): StripLayer => strips.mount() }));

vi.mock('../../src/stage/three/kit', () => ({
  buildModels: (ctx: KitContext): ModelSet => (realKit ? realKit.buildModels(ctx) : kit.buildModels(ctx)),
}));

vi.mock('../../src/stage/three/groundPaint', async (original) => {
  const actual = await original<typeof import('../../src/stage/three/groundPaint')>();
  return {
    ...actual,
    beginGroundPaint: (table: StopTable, signal: AbortSignal): GroundPaintJob => {
      order.push('begin');
      begun.push({ table, signal });
      const job = realGround ? actual.beginGroundPaint(table, signal) : null;
      return {
        async finish(...args) {
          order.push('finish');
          const ground = args[1];
          // 假的：一张 1 × 1 的空图（法线图还是照地面网格的大小）
          const source: GroundPaintSource = job ? await job.finish(...args) : { kind: 'live', colour: new Uint8Array(4), w: 1, h: 1, normals: new Uint8Array(ground.nx * ground.nz * 4) };
          finished.push({ args, source });
          return source;
        },
      };
    },
  };
});

vi.mock('../../src/stage/three/terrainMesh', async (original) => {
  const actual = await original<typeof import('../../src/stage/three/terrainMesh')>();
  return {
    ...actual,
    buildTerrainMesh: (input: TerrainMeshInput): TerrainMesh => {
      terrainInputs.push(input);
      if (realGround) return actual.buildTerrainMesh(input);
      return { group: new Group(), top: new Mesh(), sides: new Mesh(), uniforms: {}, dispose() {} };
    },
  };
});

// 环境贴图要真的三维画面才烤得出来，这里换成一张空的。
// （fakeThree 在这里面现取，不用文件开头引入的：vi.mock 会被挪到所有引入的前面，这里一运行，开头的引入可能还没到。）
vi.mock('three', async (original) => {
  const { fakeThree } = await import('./support/fakeRenderer');
  return fakeThree(await original<typeof import('three')>());
});

/**
 * 钟是假的（vi.useFakeTimers）：定的时、约的帧、performance.now() 都只在测试叫它走的时候走，一帧隔 FRAME_MS 毫秒。
 * 所以每一项里画了几帧、哪一帧画没画影子都是定数，不看机器快慢，也不用真的等。
 */
const FRAME_MS = 16;
/** 让钟走 ms 毫秒（到点的帧和定时都做完）。 */
const wait = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};
/** 让钟一帧一帧往前走，走到 promise 有了结果（完成或者拒绝）。已经有结果的不走。 */
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
const mouse = (x: number, y: number, id = 1): Record<string, unknown> => ({ pointerId: id, pointerType: 'mouse', button: 0, clientX: x, clientY: y, pageX: x, pageY: y });
const wheel = (deltaY: number): Record<string, unknown> => ({ deltaY, deltaMode: 0, clientX: 400, clientY: 400, ctrlKey: false });

/** 这一项里摆出来的沙盘，完了都关掉（定的时、约的帧跟着取消）。 */
const opened: StopStageView[] = [];

beforeAll(() => {
  const { terrainPath } = realSceneFile(KEY);
  const fetcher = fakeFetch(terrainPath);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.stubGlobal('document', fakeDocument());
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, FRAME_MS));
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('fetch', () => {
    order.push('fetch');
    return fetcher();
  });
});

beforeEach(() => {
  kit = fakeKit(() => new Group());
  strips = fakeStrips();
  realKit = null;
  realGround = false;
  order.length = 0;
  begun.length = 0;
  finished.length = 0;
  terrainInputs.length = 0;
});

afterEach(() => {
  for (const view of opened.splice(0)) view.destroy();
});

afterAll(async () => {
  // 等后台备模型的那一小会儿过去，再把假的页面拿走
  await wait(300);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const WIDE_INSETS: StageInsets = { top: 62, right: 0, bottom: 130, left: 0 };

/** 一块假的画布、一个假的渲染器、一个画布主人，和一个 width × height 的容器（测试里可以改它的大小）。 */
function stage(width = 940, height = 900) {
  const fake = fakeRenderer();
  const { canvas, el, doc } = fakeCanvas(width, height);
  const hostParts = fakeHostParts(canvas, fake.renderer);
  const host = createHost(hostParts.parts);
  const paneSize = { clientWidth: width, clientHeight: height };
  const frames = fake.frames;
  return { fake, frames, canvas, el, doc, host, hostParts, paneSize, pane: paneSize as HTMLElement, lastFrame: (): FakeFrame => frames[frames.length - 1] };
}

/** 在假的画布上摆一座徐州的沙盘（零件库、上色、地形板都是假的，除非这一项先换成了真的）。 */
async function openView(s: ReturnType<typeof stage>, options: { section?: string; reducedMotion?: boolean; insets?: StageInsets } = {}): Promise<StopStageView> {
  const { createStopView } = await import('../../src/stage/three/view');
  const { scene } = realSceneFile(KEY);
  const table: StopTable = { kind: 'stop', key: KEY, scene, terrainUrl: 'terrain.bin' };
  const view = createStopView(s.pane, table, { namesMode: 'ancient', reducedMotion: options.reducedMotion ?? false, section: options.section, insets: options.insets, tier: 'full' }, s.host);
  opened.push(view);
  return view;
}

describe('沙盘自己的几条规矩（零件库、上色、地形板是假的）', () => {
  const { scene } = realSceneFile(KEY);
  const headings = scene.sections.map((s) => s.heading);
  const style = styleFor(scene.style);
  const stripsOf = (heading: string): SceneStrip[] => scene.sections.find((s) => s.heading === heading)!.strips.map((id) => scene.strips.find((s) => s.id === id)!);

  it('地面的颜色：一开始就去要（地形文件还没取），地面算好以后拿结果，结果原样交给地形板', { timeout: 60_000 }, async () => {
    const s = stage();
    const view = await openView(s, { reducedMotion: true });
    await until(view.ready);
    expect(order).toEqual(['begin', 'fetch', 'finish']);
    // 去要的时候交的是这座沙盘（先画好的图的网址在它里面）和这一份画布的信号：沙盘关掉，图就不接着取了
    expect(begun).toHaveLength(1);
    expect(begun[0].table.key).toBe(KEY);
    expect(begun[0].table.scene).toBe(scene);
    expect(begun[0].signal.aborted).toBe(false);
    // 拿结果的时候交的是：场景，算好的地面，刚取到的地形文件的字节，这种样式的地面怎么上色
    expect(finished).toHaveLength(1);
    const [sceneArg, ground, bytes, groundStyle] = finished[0].args;
    expect(sceneArg).toBe(scene);
    expect(ground.nx * ground.nz).toBe(ground.h.length);
    expect(bytes.byteLength).toBe(scene.terrain.cols * scene.terrain.rows * 2);
    expect(groundStyle).toBe(style.ground);
    // 地形板拿到的就是给回来的那一份（不管是现画的还是先画好的），法线图的大小是地面网格的大小
    expect(terrainInputs).toHaveLength(1);
    expect(Object.values(terrainInputs[0])).toContain(finished[0].source);
    expect([terrainInputs[0].nx, terrainInputs[0].nz]).toEqual([ground.nx, ground.nz]);
    view.destroy();
    expect(begun[0].signal.aborted).toBe(true);
  });

  it('readout()：没造好只有两个 0；造好以后带上画质的读数，和这个画面的底细（哪一节、镜头、题签指着的点）', { timeout: 60_000 }, async () => {
    const size = { width: 940, height: 900 };
    const s = stage(size.width, size.height);
    // 石炭：三条题签，一条指着远处（白土镇），一条指着城墙（抬高过），一条指着山
    const heading = headings[5];
    const view = await openView(s, { section: heading, reducedMotion: true, insets: WIDE_INSETS });
    // 还没造好：只有这两个数，别的一样没有
    expect(view.readout()).toStrictEqual({ triangles: 0, drawCalls: 0 });
    await until(view.ready);

    const readout = view.readout();
    // 试画过了（假的钟在画的时候不走，量出来是 0）；镜头还没有滑过
    expect(readout.perf).toEqual({ tier: 'full', pixelRatio: 1, buffer: { width: 940, height: 900 }, frames: s.frames.length, trialMs: 0, glideMs: null });
    // 读正文的时候一帧都不画：隔一会儿再读，帧数没有变
    await wait(60);
    expect(view.readout().perf?.frames).toBe(readout.perf?.frames);

    const shot = readout.shot;
    if (!shot) throw new Error('造好的沙盘没有给这个画面的底细');
    const R = realScene(KEY);
    const section = scene.sections[5];
    const placed = placeCamera(section, scene, R.samplers, R.coords, style, size, WIDE_INSETS);
    expect(shot.section).toBe(heading);
    expect(shot.size).toEqual(size);
    expect(shot.insets).toEqual(WIDE_INSETS);
    // 镜头真的在哪：画面窄了退过以后的（这一节在 940 × 900 上要退一点）
    expect(shot.pose.fov).toBe(placed.pose.fov);
    for (let i = 0; i < 3; i++) {
      expect(shot.pose.position[i]).toBeCloseTo(placed.pose.position[i], 3);
      expect(shot.pose.target[i]).toBeCloseTo(placed.pose.target[i], 3);
    }
    expect(shot.fit).toBe(placed.fit);
    expect(shot.reach).toEqual(placed.reach);
    expect(shot.fit).toBeGreaterThanOrEqual(1);
    expect(shot.reach[0]).toBeGreaterThan(100);
    // 指北和“一米多少像素”：拿最后一帧的镜头自己算一遍
    const camera = s.lastFrame().view;
    expect(shot.northDeg).toBeCloseTo(northDeg(camera), 9);
    expect(shot.pxPerMetre).toBeCloseTo(pixelsPerMetre(camera, placed.pose.target, size.height), 6);
    expect(shot.pxPerMetre).toBeGreaterThan(0.05);

    // 题签指着的点：这一节的题签，按这一节写的先后，一条不多一条不少；位置是按这一帧真的远近算的
    const D = equivalentDistance(placed.distanceM, placed.pose.fov, size.height);
    const expected = screenAnchors(stripsOf(heading), scene, R.samplers, R.coords, style, D, camera, size);
    expect(shot.anchors.map((a) => a.id)).toEqual(section.strips);
    shot.anchors.forEach((anchor, i) => {
      expect(anchor.x).toBeCloseTo(expected[i].x, 2);
      expect(anchor.y).toBeCloseTo(expected[i].y, 2);
      expect(anchor.visible).toBe(true);
      expect(anchor.x).toBeGreaterThanOrEqual(0);
      expect(anchor.y).toBeGreaterThanOrEqual(WIDE_INSETS.top);
      expect(anchor.y).toBeLessThanOrEqual(size.height - WIDE_INSETS.bottom);
    });
    // 远处的那一条带着朝外的方向，别的没有
    const [far, wall, hill] = shot.anchors;
    expect(far.out).toBeDefined();
    expect(Math.hypot(far.out![0], far.out![1])).toBeCloseTo(1, 9);
    expect(far.out![0]).toBeCloseTo(expected[0].out![0], 4);
    expect(far.out![1]).toBeCloseTo(expected[0].out![1], 4);
    expect(wall.out).toBeUndefined();
    expect(hill.out).toBeUndefined();
    // 抬高过的那一条（城墙）带着脚下的那一点，在它下方；贴着地面的没有
    expect(wall.foot).toBeDefined();
    expect(wall.foot!.x).toBeCloseTo(expected[1].foot!.x, 2);
    expect(wall.foot!.y).toBeCloseTo(expected[1].foot!.y, 2);
    expect(wall.foot!.y).toBeGreaterThan(wall.y);
    expect(far.foot).toBeUndefined();
    expect(hill.foot).toBeUndefined();
    // 这一帧交给题签层的也是这一组点
    const given = strips.places[strips.places.length - 1];
    expect(given.anchors).toEqual(shot.anchors);
    expect(given.size).toEqual(size);
    expect(given.insets).toEqual(WIDE_INSETS);

    // 换一节，底细跟着换
    await until(view.showSection(headings[3]));
    const next = view.readout().shot;
    expect(next?.section).toBe(headings[3]);
    expect(next?.anchors.map((a) => a.id)).toEqual(scene.sections[3].strips);
    expect(next?.pose.fov).toBe(scene.sections[3].camera.fov);

    // 关掉以后又只有两个 0
    view.destroy();
    expect(view.readout()).toStrictEqual({ triangles: 0, drawCalls: 0 });
  });

  it('没有另外交钟和“页面在不在前台”的（沙盘程序就是这样叫的）：看浏览器自己的——页面在后台时不试画，回到前台以后下一次摆好才试', { timeout: 60_000 }, async () => {
    const page = document as unknown as { visibilityState?: string };
    page.visibilityState = 'hidden';
    try {
      const s = stage();
      const view = await openView(s, { reducedMotion: true });
      await until(view.ready);
      // 摆好了，没有试过：只有第一个画面和最后补的一帧
      expect(s.frames).toHaveLength(2);
      expect(view.readout().perf?.trialMs).toBeNull();
      page.visibilityState = 'visible';
      await until(view.showSection(headings[1]));
      // 这一次摆好以后试了：摆的一帧，试画三帧
      expect(s.frames).toHaveLength(6);
      expect(view.readout().perf?.trialMs).toBe(0);
    } finally {
      delete page.visibilityState;
    }
  });

  it('灯只有一盏：哪一节、朝哪边看，光都从同一边来；影子罩的那一块跟着镜头走，虚实和偏移按罩多大一块定', { timeout: 60_000 }, async () => {
    const s = stage(880, 900);
    const view = await openView(s, { reducedMotion: true });
    await until(view.ready);
    const light = style.light('day');
    const length = Math.hypot(...light.dir);
    const R = realScene(KEY);
    const halves: number[] = [];
    for (const section of scene.sections) {
      await until(view.showSection(section.heading));
      const frame = s.lastFrame();
      // 光从哪边来：样式里那一盏的方向，七节都一样（这里面有朝北看的、朝西贴近了看的、朝西南远看的）
      if (!frame.sun) throw new Error('场景里没有太阳光');
      for (let i = 0; i < 3; i++) expect(frame.sun[i]).toBeCloseTo(light.dir[i] / length, 9);
      // 影子罩的那一块：以镜头对准的那一点为中心，大小跟着镜头的远近
      const placed = placeCamera(section, scene, R.samplers, R.coords, style, { width: 880, height: 900 });
      const box = shadowBox([placed.pose.target[0], placed.pose.target[2]], placed.distanceM, R.coords);
      expect(frame.shadowHalf).toBeCloseTo(box.half, 6);
      expect(frame.shadowCentre[0]).toBeCloseTo(box.centre[0], 6);
      expect(frame.shadowCentre[1]).toBeCloseTo(box.centre[1], 6);
      // 影子的虚实和偏移
      const tuning = shadowTuning(box.half);
      expect(frame.shadowMapSize).toBe(FULL_QUALITY.shadowMapSize);
      expect(frame.shadowRadius).toBeCloseTo(tuning.radius, 9);
      expect(frame.shadowBias).toBeCloseTo(tuning.bias, 9);
      expect(frame.shadowNormalBias).toBeCloseTo(((2 * box.half) / FULL_QUALITY.shadowMapSize) * tuning.normalBias, 9);
      halves.push(box.half);
    }
    // 水退以后贴近了看黄楼：罩得最小，影子边最虚；别的六节都是平常的数
    expect(halves[3]).toBe(1250);
    await until(view.showSection(headings[3]));
    expect(s.lastFrame().shadowRadius).toBe(3);
    expect(s.lastFrame().shadowBias).toBe(-0.0002);
    for (const i of [0, 1, 2, 4, 5, 6]) expect(shadowTuning(halves[i]).radius).toBeCloseTo(2.2, 9);
  });

  it('镜头滑动的一路上：每画一帧，把这一帧真的远近（折算过的）告诉零件库；新一节的东西一起步就换上，往远处退也一样', { timeout: 60_000 }, async () => {
    const size = { width: 940, height: 900 };
    const s = stage(size.width, size.height);
    // 从云龙山和百步洪（镜头 8800 米）滑到石炭（13000 米），再退到到徐州（看整块沙盘，52000 米）
    const view = await openView(s, { section: headings[4] });
    await until(view.ready);
    const R = realScene(KEY);
    const look = (i: number) => placeCamera(scene.sections[i], scene, R.samplers, R.coords, style, size);
    const distance = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const mix = (a: readonly number[], b: readonly number[], e: number): number[] => a.map((v, k) => v + (b[k] - v) * e);

    for (const [from, to] of [
      [4, 5],
      [5, 0],
    ]) {
      const a = look(from).pose;
      const b = look(to).pose;
      const appliesBefore = kit.applies.length;
      const framesBefore = s.frames.length;
      await until(view.showSection(headings[to]));
      const applies = kit.applies.slice(appliesBefore);
      const frames = s.frames.slice(framesBefore);
      expect(frames.length).toBeGreaterThan(10);
      expect(applies, '每画一帧告诉零件库一次').toHaveLength(frames.length);
      // 一起步就是新一节的东西
      expect(applies.every((call) => call.section === headings[to])).toBe(true);

      // 每一帧告诉零件库的远近，就是这一帧的镜头折算出来的：镜头走到了全程的几成，对准的那一点也走到几成
      const whole = distance(a.position, b.position);
      frames.forEach((frame, i) => {
        const position = frame.view.position.toArray();
        const e = distance(position, a.position) / whole;
        const live = equivalentDistance(distance(position, mix(a.target, b.target, e)), frame.view.fov, size.height);
        expect(Math.abs(applies[i].D / live - 1), `第 ${i + 1} 帧`).toBeLessThan(1e-6);
      });
      // 不是一路上都报同一个数：从起步时的远近一帧一帧变到终点的远近
      const first = equivalentDistance(distance(a.position, a.target), a.fov, size.height);
      const last = equivalentDistance(distance(b.position, b.target), b.fov, size.height);
      expect(Math.abs(applies[0].D / first - 1)).toBeLessThan(0.02);
      expect(Math.abs(applies[applies.length - 1].D / last - 1)).toBeLessThan(1e-6);
      expect(last / first).toBeGreaterThan(1.3);
      expect(new Set(applies.map((call) => Math.round(call.D))).size).toBeGreaterThan(frames.length * 0.8);
    }
  });

  it('读者动镜头的时候，题签指着的点也按这一帧真的远近算', { timeout: 60_000 }, async () => {
    const size = { width: 940, height: 900 };
    const s = stage(size.width, size.height);
    // 住在城墙上：有草屋的题签，草屋在这个远近上正放大着，镜头一拉近它就小回去
    const view = await openView(s, { section: headings[2], reducedMotion: true });
    await until(view.ready);
    const R = realScene(KEY);
    for (const deltaY of [-300, -300, 600, 600, 600]) {
      s.el.fire('wheel', wheel(deltaY));
      await wait(20);
      const call = kit.applies[kit.applies.length - 1];
      const frame = s.lastFrame();
      const given = strips.places[strips.places.length - 1].anchors;
      const expected = screenAnchors(stripsOf(headings[2]), scene, R.samplers, R.coords, style, call.D, frame.view, size);
      expect(given.map((a) => a.id)).toEqual(expected.map((a) => a.id));
      given.forEach((anchor, i) => {
        expect(anchor.x).toBeCloseTo(expected[i].x, 2);
        expect(anchor.y).toBeCloseTo(expected[i].y, 2);
      });
    }
    // 滚轮真的把远近改了：先拉近，再退得比原来远
    const seen = kit.applies.map((call) => call.D);
    expect(Math.min(...seen)).toBeLessThan(seen[0] * 0.8);
    expect(Math.max(...seen)).toBeGreaterThan(seen[0] * 1.2);
  });

  describe('影子：模型只是大小变了，镜头在动就不重画，停下来补一次', () => {
    const shadows = (frames: FakeFrame[]): string => frames.map((f) => (f.shadow ? '画' : '-')).join('');

    it('滑动：起步时画一次（影子罩的那一块换了），一路上不画，到了补一次', { timeout: 60_000 }, async () => {
      const s = stage();
      const view = await openView(s, { section: headings[4] });
      await until(view.ready);
      // 摆出来：头一帧带影子，试画的三帧和最后补的一帧都不带
      expect(shadows(s.frames)).toBe('画----');
      let before = s.frames.length;
      await until(view.showSection(headings[5]));
      const glide = s.frames.slice(before);
      expect(glide.length).toBeGreaterThan(10);
      expect(shadows(glide)).toBe(`画${'-'.repeat(glide.length - 2)}画`);
      // 到了以后不再有别的帧
      before = s.frames.length;
      await wait(400);
      expect(s.frames).toHaveLength(before);

      // 回到这一节：镜头本来就在摆好的位置上，不滑也不画影子
      await until(view.resetView());
      expect(shadows(s.frames.slice(before))).not.toContain('画');
    });

    it('显出来的东西变了照旧当场重画：有船的一节水位在涨，一路上每一帧都画；没有船的一节只在起步和到了的时候画', { timeout: 60_000 }, async () => {
      kit = fakeKit(() => new Group(), [headings[2]]);
      const s = stage();
      // 水来了（水位 39.4）滑到住在城墙上（44.6，城下系着船）
      const view = await openView(s, { section: headings[1] });
      await until(view.ready);
      let before = s.frames.length;
      const appliesBefore = kit.applies.length;
      await until(view.showSection(headings[2]));
      const rising = s.frames.slice(before);
      const said = kit.applies.slice(appliesBefore);
      expect(rising.length).toBeGreaterThan(20);
      expect(said).toHaveLength(rising.length);
      // 起步的那一帧影子罩的那一块换了，本来就画；别的每一帧：零件库说显出来的东西变了（船脚下的水位动了）就画，没说就不画。
      // 刚起步和快到的时候镜头走得慢，水位一帧动不到一厘米，零件库不算它变了；中间的每一帧水位都在变
      expect(rising[0].shadow).toBe(true);
      for (let i = 1; i < rising.length - 1; i++) expect(rising[i].shadow, `第 ${i + 1} 帧`).toBe(said[i].changed);
      const quarter = Math.floor(rising.length / 4);
      expect(shadows(rising.slice(quarter, -quarter))).toBe('画'.repeat(rising.length - 2 * quarter));
      expect(rising.filter((f) => f.shadow).length).toBeGreaterThan(rising.length * 0.8);
      // 再滑到水退以后：这一节在假零件库里没有船
      before = s.frames.length;
      await until(view.showSection(headings[3]));
      const falling = s.frames.slice(before);
      expect(shadows(falling)).toBe(`画${'-'.repeat(falling.length - 2)}画`);
    });

    it('滚轮：每滚一格画一帧，都不画影子；停下来 250 毫秒以后补画一次，只补一次', { timeout: 60_000 }, async () => {
      const s = stage();
      const view = await openView(s, { section: headings[2], reducedMotion: true });
      await until(view.ready);
      let before = s.frames.length;
      for (let i = 0; i < 4; i++) {
        s.el.fire('wheel', wheel(-200));
        await wait(40);
      }
      // 四格一共滚了 160 毫秒，每一格都把“停下来以后看一眼”往后推：最后一格是在第 120 毫秒滚的
      expect(shadows(s.frames.slice(before))).toBe('----');
      // 最后一格以后还不到 250 毫秒：不补
      await wait(200);
      expect(shadows(s.frames.slice(before))).toBe('----');
      // 过了 250 毫秒：下一帧补上
      await wait(30);
      expect(shadows(s.frames.slice(before))).toBe('----画');
      await wait(600);
      expect(s.frames.length - before).toBe(5);

      // 只滚了一点点（远近差不到百分之五）：模型的大小差不多没变，不补
      before = s.frames.length;
      s.el.fire('wheel', wheel(50));
      await wait(450);
      expect(shadows(s.frames.slice(before))).toBe('-');
    });

    it('拖着转：远近没变，不补画；按着不放的时候也不补，放开以后才看', { timeout: 60_000 }, async () => {
      const s = stage();
      const view = await openView(s, { section: headings[2], reducedMotion: true });
      await until(view.ready);
      let before = s.frames.length;
      s.el.fire('pointerdown', mouse(400, 400));
      s.doc.fire('pointermove', mouse(460, 410));
      await wait(30);
      s.doc.fire('pointerup', mouse(460, 410));
      await wait(400);
      // 一帧是拖的，一帧是放开以后题签重摆的；都不画影子
      expect(shadows(s.frames.slice(before))).toBe('--');

      // 滚轮拉近以后马上按住不放：手按着就不补
      before = s.frames.length;
      s.el.fire('wheel', wheel(-300));
      await wait(30);
      s.el.fire('pointerdown', mouse(400, 400, 2));
      await wait(400);
      expect(shadows(s.frames.slice(before))).toBe('-');
      // 放开，过一会儿补上
      s.doc.fire('pointerup', mouse(400, 400, 2));
      await wait(400);
      expect(shadows(s.frames.slice(before))).toBe('-画');
    });

    it('直接摆到位的（减少动效、容器大小变了）当场就补，不用等；读者动过镜头以后容器变了，过一会儿补', { timeout: 60_000 }, async () => {
      const s = stage(940, 900);
      const view = await openView(s, { section: headings[0], reducedMotion: true });
      await until(view.ready);
      // 看整块沙盘的一节：影子罩着整块沙盘。容器矮了一半，镜头重摆，罩的那一块没变，模型却大了：这一帧就画影子
      let before = s.frames.length;
      s.paneSize.clientHeight = 450;
      view.resize();
      await wait(30);
      expect(shadows(s.frames.slice(before))).toBe('画');
      expect(s.frames[before].shadowHalf).toBe(s.frames[before - 1].shadowHalf);

      // 读者动过镜头：容器再变，镜头不重摆，只重画一帧；模型的大小跟着画面的高矮变了，过一会儿补一次影子
      s.el.fire('pointerdown', mouse(400, 200));
      s.doc.fire('pointermove', mouse(430, 210));
      s.doc.fire('pointerup', mouse(430, 210));
      await wait(400);
      before = s.frames.length;
      s.paneSize.clientHeight = 900;
      view.resize();
      await wait(30);
      expect(shadows(s.frames.slice(before))).toBe('-');
      await wait(400);
      expect(shadows(s.frames.slice(before))).toBe('-画');
    });
  });

  it('读者的手按着的时候告诉题签层“还在动”；放开以后整个重摆一次；点一下、没有拖，什么也不画', { timeout: 60_000 }, async () => {
    const s = stage();
    const view = await openView(s, { section: headings[2] });
    await until(view.ready);
    const moving = (): boolean[] => strips.places.map((p) => p.moving);
    expect(moving().every((m) => !m)).toBe(true);

    // 点一下
    let before = s.frames.length;
    let placesBefore = strips.places.length;
    s.el.fire('pointerdown', mouse(400, 400));
    s.doc.fire('pointerup', mouse(400, 400));
    await wait(40);
    expect(s.frames).toHaveLength(before);
    expect(strips.places).toHaveLength(placesBefore);

    // 按住，拖两下（每一下各画一帧），再放开
    s.el.fire('pointerdown', mouse(400, 400));
    s.doc.fire('pointermove', mouse(440, 405));
    await wait(30);
    s.doc.fire('pointermove', mouse(480, 410));
    await wait(30);
    expect(moving().slice(placesBefore)).toEqual([true, true]);
    s.doc.fire('pointerup', mouse(480, 410));
    await wait(30);
    expect(moving().slice(placesBefore)).toEqual([true, true, false]);
    expect(s.frames.length - before).toBe(3);
    // 放开以后没有别的帧了（转的时候远近没变，影子也不用补）
    await wait(400);
    expect(s.frames.length - before).toBe(3);

    // 滚轮：每一格都是“动一下就停”，画的那一帧手已经不在上面了
    placesBefore = strips.places.length;
    s.el.fire('wheel', wheel(-100));
    await wait(30);
    expect(moving().slice(placesBefore)).toEqual([false]);

    // 滑到半路被读者按住：题签刚换成新一节的，还没摆过，第一次照常摆；接着拖才算“还在动”；放开再整个重摆
    await until(view.resetView());
    strips.log.length = 0;
    placesBefore = strips.places.length;
    const going = view.showSection(headings[3]);
    await wait(300);
    s.el.fire('pointerdown', mouse(300, 300, 3));
    await going;
    await wait(30);
    s.doc.fire('pointermove', mouse(330, 300, 3));
    await wait(30);
    s.doc.fire('pointerup', mouse(330, 300, 3));
    await wait(30);
    expect(strips.log[0]).toBe('hide');
    expect(strips.specs().map((spec) => spec.text)).toEqual(stripTexts(scene, headings[3], 'ancient').map((t) => t.text));
    expect(moving().slice(placesBefore)).toEqual([false, true, false]);
  });
});

it('徐州的沙盘：摆出来、读者动镜头、回到这一节、半路接过去、留空和大小变了、画面丢了、再摆一座', { timeout: 120_000 }, async () => {
  // 这一项用真的零件库、真的上色和真的地形板
  realKit = await vi.importActual<typeof import('../../src/stage/three/kit')>('../../src/stage/three/kit');
  realGround = true;
  const { createStopView } = await import('../../src/stage/three/view');
  const { scene } = realSceneFile(KEY);
  const headings = scene.sections.map((s) => s.heading);
  const stripLog = strips.log;
  const lastSpecs = (): string[] => strips.specs().map((s) => s.text);

  // 假的渲染器、画布和画布主人。frames 是画过的每一帧；seen 是画过的形状和材质，和其中已经放掉的；pixelRatios 是画布先后用过的像素比
  const fake = fakeRenderer();
  const { frames, seen, pixelRatios } = fake;
  const { canvas, el, doc } = fakeCanvas(880, 900);
  const { parts, canvasesMade, loseContext } = fakeHostParts(canvas, fake.renderer);
  const host = createHost(parts);
  /** 容器多大（测试里会改它）。 */
  const paneSize = { clientWidth: 880, clientHeight: 900 };
  const pane = paneSize as HTMLElement;
  const table: StopTable = { kind: 'stop', key: KEY, scene, terrainUrl: 'terrain.bin' };
  const lastFrame = (): (typeof frames)[number] => frames[frames.length - 1];

  // ---- 摆出来：从第三节开始（大水，有堤、有船）
  const view = createStopView(pane, table, { namesMode: 'ancient', reducedMotion: false, section: headings[2], tier: 'full' }, host);
  const moved: boolean[] = [];
  let lost = 0;
  const infos: StageViewInfo[] = [];
  view.onUserMoved((m) => moved.push(m));
  view.onLost(() => {
    lost += 1;
  });
  view.onViewChange((info) => infos.push(info));
  await until(view.ready);
  expect(canvasesMade()).toBe(1);
  // 这座沙盘还没有先画好的地面：颜色是现画的（四个字节一个点，每 10 米一个点）
  expect(finished).toHaveLength(1);
  expect(finished[0].source.kind).toBe('live');
  expect(finished[0].source.w).toBe((finished[0].args[1].nx - 1) * 2 + 1);
  // 指北和比例尺报给了页面：这一节朝北偏西一点看，比例尺是“数 米”或“数 公里”
  expect(infos.length).toBeGreaterThanOrEqual(1);
  expect(Math.abs(infos[0].northDeg)).toBeLessThan(15);
  expect(infos[0].scale.label).toMatch(/^\d+ (米|公里)$/);
  expect(infos[0].scale.px).toBeGreaterThan(40);
  // 装裱和座子、云气的三角形数，和算预算时用的数一样（场景里依次是：地形板、水、云气、小模型、座子）
  const world: Scene | null = fake.lastWorld();
  if (!world) throw new Error('一帧也没有画');
  expect(trianglesUnder(world.children[4])).toBe(STAND_TRIANGLES);
  expect(trianglesUnder(world.children[2])).toBe(FULL_QUALITY.mistLayers * MIST_TRIANGLES_PER_LAYER);
  expect(frames.map((f) => f.shadow), '摆出来：头一帧带影子，试画三帧，再补一帧，后面四帧都不画影子').toEqual([true, false, false, false, false]);
  expect(lastSpecs()).toEqual(stripTexts(scene, headings[2], 'ancient').map((s) => s.text));
  // 读者用手指、鼠标转沙盘靠的是这几样
  expect(el.has('pointerdown') && el.has('wheel')).toBe(true);
  expect(canvas.style.touchAction).toBe('none');
  const home = lastFrame().camera;

  // ---- 点一下、没有拖：不算动了镜头，也不重画
  el.fire('pointerdown', mouse(400, 400));
  doc.fire('pointerup', mouse(400, 400));
  await wait(30);
  expect(moved).toEqual([]);
  expect(frames).toHaveLength(5);

  // ---- 拖：算动了镜头；一帧里挪两次只画一次
  el.fire('pointerdown', mouse(400, 400));
  doc.fire('pointermove', mouse(460, 410));
  doc.fire('pointermove', mouse(520, 420));
  doc.fire('pointerup', mouse(520, 420));
  await wait(30);
  expect(moved).toEqual([true]);
  expect(frames).toHaveLength(6);

  // ---- 滚轮：靠近了
  const beforeWheel = lastFrame().camera;
  el.fire('wheel', wheel(-300));
  await wait(30);
  expect(frames).toHaveLength(7);
  expect(lastFrame().camera).toBeLessThan(beforeWheel);

  // ---- 回到这一节：滑回去，到了以后算没动过
  let before = frames.length;
  await until(view.resetView());
  expect(frames.length - before, '回到这一节是滑回去的，不是一下子跳回去').toBeGreaterThan(5);
  expect(moved).toEqual([true, false]);
  expect(Math.abs(lastFrame().camera - home) / home).toBeLessThan(0.001);

  // ---- 换小节滑到半路，读者接过去：等着的指令马上了结，题签换成新一节的，不再接着滑
  stripLog.length = 0;
  const going = view.showSection(headings[3]);
  await wait(500);
  expect(stripLog[0], '一起步题签先藏起来').toBe('hide');
  el.fire('pointerdown', mouse(300, 300, 2));
  const grabbed = performance.now();
  await going;
  expect(performance.now() - grabbed).toBeLessThan(200);
  expect(moved).toEqual([true, false, true]);
  expect(lastSpecs()).toEqual(stripTexts(scene, headings[3], 'ancient').map((s) => s.text));
  before = frames.length;
  doc.fire('pointermove', mouse(330, 300, 2));
  doc.fire('pointerup', mouse(330, 300, 2));
  await wait(400);
  // 接过去以后只有读者自己这一下的一帧，和停下来以后补画影子的一帧（镜头停在半路，模型的大小和起步时不一样了）
  expect(frames.length - before, '读者接过去以后不再接着滑').toBeLessThanOrEqual(2);
  await until(view.resetView());
  expect(moved).toEqual([true, false, true, false]);

  // ---- 四边留的空变了：镜头重摆一次，画面的中心挪到留出来的那一块中间（下面留 300、上面留 52，往上挪 124）
  await wait(30);
  before = frames.length;
  view.setInsets({ top: 52, right: 0, bottom: 300, left: 0 });
  await wait(30);
  expect(frames.length - before).toBe(1);
  expect(lastFrame().offsetY).toBeCloseTo(124, 6);
  // 下面留得多了，要看的东西还得都在留出来的那一块里：镜头退远了
  expect(lastFrame().camera).toBeGreaterThan(frames[before - 1].camera);
  // 同样的数再说一遍：什么也不做
  view.setInsets({ top: 52, right: 0, bottom: 300, left: 0 });
  await wait(30);
  expect(frames.length - before).toBe(1);

  // ---- 容器的大小没有变：resize() 不重摆，也不画（手机上地址栏一收一放就是这样）
  stripLog.length = 0;
  view.resize();
  view.resize();
  await wait(30);
  expect(frames.length - before).toBe(1);
  expect(stripLog).toEqual([]);
  // 变窄了：重摆一次，画面的宽高比跟着变，题签重新摆
  paneSize.clientWidth = 600;
  view.resize();
  view.resize();
  await wait(30);
  expect(frames.length - before).toBe(2);
  expect(lastFrame().aspect).toBeCloseTo(600 / 900, 6);
  expect(stripLog.some((entry) => entry.startsWith('set '))).toBe(true);
  // 收起来（高是 0）不画；再展开，重摆一次
  paneSize.clientHeight = 0;
  view.resize();
  await wait(30);
  expect(frames.length - before).toBe(2);
  paneSize.clientWidth = 880;
  paneSize.clientHeight = 900;
  view.resize();
  await wait(30);
  expect(frames.length - before).toBe(3);
  expect(lastFrame().aspect).toBeCloseTo(880 / 900, 6);
  view.setInsets({ top: 0, right: 0, bottom: 0, left: 0 });
  await wait(30);
  expect(lastFrame().offsetY).toBe(0);
  // 屏幕的像素比变了（窗口挪到另一块屏幕上）：大小没变也要重画一次，画布换成新的像素比
  before = frames.length;
  vi.stubGlobal('window', { devicePixelRatio: 2 });
  view.resize();
  await wait(30);
  expect(frames.length - before).toBe(1);
  expect(pixelRatios[pixelRatios.length - 1]).toBe(2);
  view.resize();
  await wait(30);
  expect(frames.length - before).toBe(1);
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  view.resize();
  await wait(30);
  expect(pixelRatios[pixelRatios.length - 1]).toBe(1);

  // ---- 三维画面丢了：只通知一次，不再画；之后的指令照常了结
  before = frames.length;
  loseContext();
  await wait(50);
  expect(lost).toBe(1);
  expect(frames).toHaveLength(before);
  await until(view.showSection(headings[0]));
  await until(view.resetView());
  view.resize();
  expect(view.readout()).toEqual({ triangles: 0, drawCalls: 0 });
  // 画面丢了的时候，这座沙盘画过的形状和材质都已经放掉了
  const leaked = (): number => [...seen.geometries, ...seen.materials].filter((item) => !seen.disposed.has(item)).length;
  expect(seen.geometries.size).toBeGreaterThan(50);
  expect(seen.materials.size).toBeGreaterThan(15);
  expect(leaked(), '画面丢了以后还有没放掉的形状或材质').toBe(0);
  view.destroy();

  // ---- 同一个画布主人上再摆一座：丢过了，换一块新画布。减少动效：换小节不滑，只画一帧
  const again = createStopView(pane, table, { namesMode: 'modern', reducedMotion: true, tier: 'full' }, host);
  await until(again.ready);
  expect(canvasesMade()).toBe(2);
  expect(lastSpecs()).toEqual(stripTexts(scene, headings[0], 'modern').map((s) => s.text));
  // 第一节看的是整块沙盘：镜头对准的那一点挪过，沙盘在画面里居中（和 rig.ts 的 centredView 算出来的是同一个位置）
  {
    const R = realScene(KEY);
    const whole = scene.sections[0];
    const authored = poseOn(whole.camera, R.samplers, R.coords);
    const points = showPoints(whole, scene, R.samplers, R.coords, styleFor(scene.style), 900);
    const centred = centredView(whole.camera, authored.target, points, { width: 880, height: 900 });
    const at = poseAt(whole.camera, centred.target, centred.distanceM).position;
    expect(lastFrame().camera).toBeCloseTo(Math.hypot(...at), 0);
    // 不挪的话镜头在另一个地方（差出几百米）
    expect(Math.abs(Math.hypot(...authored.position) - Math.hypot(...at))).toBeGreaterThan(100);
  }

  // 今名换成古名：这一节有今名的题签（戏马台今天叫户部山）换了字，画一帧
  const modernTexts = stripTexts(scene, headings[0], 'modern').map((s) => s.text);
  const ancientTexts = stripTexts(scene, headings[0], 'ancient').map((s) => s.text);
  expect(modernTexts).not.toEqual(ancientTexts);
  before = frames.length;
  again.setNamesMode('ancient');
  expect(lastSpecs()).toEqual(ancientTexts);
  await wait(30);
  expect(frames.length - before).toBe(1);
  again.setNamesMode('modern');
  expect(lastSpecs()).toEqual(modernTexts);
  await wait(30);
  before = frames.length;
  await until(again.showSection(headings[4]));
  expect(frames.length - before).toBe(1);
  expect(lastSpecs()).toEqual(stripTexts(scene, headings[4], 'modern').map((s) => s.text));
  // 关掉：这一座画过的形状和材质都放掉
  seen.geometries.clear();
  seen.materials.clear();
  await until(again.showSection(headings[2]));
  expect(seen.geometries.size).toBeGreaterThan(50);
  again.destroy();
  expect(leaked(), '关掉以后还有没放掉的形状或材质').toBe(0);

  // ---- 第三座：画布没丢，接着用。第一个画面摆过、ready 还没完成的那一小会儿叫 showSection：直接摆到位，不滑
  stripLog.length = 0;
  before = frames.length;
  const third = createStopView(pane, table, { namesMode: 'ancient', reducedMotion: false, tier: 'full' }, host);
  const early: { done: Promise<void> | null } = { done: null };
  let earlyDone = 0;
  // 页面是在别的时候叫的，不是在画一帧的中间：等这一帧画完再叫
  fake.afterNextRender(
    () =>
      void setTimeout(() => {
        early.done = third.showSection(headings[1]).then(() => {
          earlyDone = performance.now();
        });
      }, 0),
  );
  let thirdLost = 0;
  third.onLost(() => {
    thirdLost += 1;
  });
  await until(third.ready);
  const readyAt = performance.now();
  expect(canvasesMade()).toBe(2);
  if (!early.done) throw new Error('第一个画面画出来以后没有叫到 showSection');
  await until(early.done);
  // ready 的时候沙盘已经是这一节的样子：题签是这一节的，没有藏过（滑的时候才藏），前后只画了几帧
  // （头一帧、试画三帧、直接摆到位的一帧、最后补的一帧），不是滑了两秒
  expect(earlyDone - readyAt).toBeLessThan(300);
  expect(stripLog).not.toContain('hide');
  expect(lastSpecs()).toEqual(stripTexts(scene, headings[1], 'ancient').map((s) => s.text));
  expect(frames.length - before).toBeLessThanOrEqual(8);
  // ready 以后叫的才滑
  before = frames.length;
  await until(third.showSection(headings[2]));
  expect(frames.length - before).toBeGreaterThan(5);

  // ---- 第三座还没关就摆第四座：画布被借走，第三座从此不画，和画面丢了一样告诉页面，只说一次
  const fourth = createStopView(pane, table, { namesMode: 'ancient', reducedMotion: true, tier: 'full' }, host);
  await until(fourth.ready);
  expect(thirdLost).toBe(1);
  expect(canvasesMade()).toBe(2);
  await until(third.showSection(headings[0]));
  await until(third.resetView());
  expect(third.readout()).toEqual({ triangles: 0, drawCalls: 0 });
  third.destroy();
  expect(thirdLost).toBe(1);
  // 第四座不受影响：换小节照样画
  before = frames.length;
  await until(fourth.showSection(headings[3]));
  expect(frames.length - before).toBe(1);

  // ---- 关掉以后不再画
  fourth.destroy();
  before = frames.length;
  await wait(100);
  expect(frames).toHaveLength(before);
  await expect(fourth.showSection(headings[1])).rejects.toBeDefined();
});

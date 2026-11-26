// 眉州的沙盘在真的 view（src/stage/three/view.ts）里空跑，不要浏览器。
// 真的：场景文件、地形文件、地面、零件库和眉州用的那一家零件（浮桥的三套）、水面、镜头、换小节的先后、读者的滚轮（three.js 自己的 OrbitControls）。
// 假的：渲染器（只记下画了几帧、最近一帧画的那个场景）、画布、题签层、上色、地形板、页面，还有钟（一帧 16 毫秒，不看机器快慢）。
//
// 查两件：
//   一、摆好的画面上浮桥显哪一套，只看远近，不看镜头是怎么来的。沙盘栏 1700 像素高的时候，“正月上蟆颐山”摆好的远近落在
//       “远看的一套”的界线（6000）和它的 1.12 倍之间——正是“显哪一套要看镜头从哪边来”的那一段：直接摆出来、从别的三节滑过来、
//       不滑直接换过来，都得是同一套。读者自己滚轮推近拉远的时候，界线上下照旧留着上一套（换来换去的是细处，不是毛病）；
//       “回到这一处”以后又是摆好的那一套。零件库那一头：apply 的 hold 交 false 只照远近挑，不交照旧留着，都不重造网格。
//   二、“窄的河上不画水纹”那一段每一帧都走：最宽的一条河一座沙盘只算一次（滑一趟一百多帧，场景里的河没有再被读过一遍），
//       算出来的数和原来的写法（Math.max(0, ...rivers.map(...))、rippleFor）一个不差。

import { Group, Mesh, type Object3D } from 'three';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { StopScene } from '../../src/domain/scene';
import { existsAt, sectionHeadings } from '../../src/domain/sceneText';
import { FAMILIES } from '../../src/stage/families';
import type { StripLayer } from '../../src/stage/overlay/types';
import { PONTOON } from '../../src/stage/three/families/works';
import type { GroundPaintJob } from '../../src/stage/three/groundPaint';
import { createHost } from '../../src/stage/three/host';
import { STYLES } from '../../src/stage/styles';
import { provideStyles } from '../../src/stage/three/style';
import type { KitContext } from '../../src/stage/three/internal';
import { STEP_HOLD, buildModels } from '../../src/stage/three/kit/assemble';
import { provideFamilies } from '../../src/stage/three/kit/families';
import { smoothstep } from '../../src/stage/three/kit/util';
import { FULL_QUALITY } from '../../src/stage/three/quality';
import { equivalentDistance, placeCamera } from '../../src/stage/three/rig';
import { styleFor } from './support/styles';
import type { TerrainMesh } from '../../src/stage/three/terrainMesh';
import { CALM_RANGE, rippleDense, rippleFor, rippleShare, rippleTurn, widestRiverM } from '../../src/stage/three/water';
import type { StageInsets, StopStageView, StopTable } from '../../src/stage/types';
import { fakeCanvas, fakeDocument, fakeFetch, fakeHostParts, fakeRenderer, fakeStrips } from './support/fakeRenderer';
import { realScene, realSceneFile, realSceneKeys } from './support/realScenes';

const KEY = 'su-shi/meishan';
const VIEW_ALL = '眉州';
const VIEW_HOME = '纱縠行的家';
const VIEW_HILL = '正月上蟆颐山';
const VIEW_GRAVES = '老翁泉';

const strips = fakeStrips();

vi.mock('../../src/stage/overlay', async (original) => ({ ...(await original<typeof import('../../src/stage/overlay')>()), mountStrips: (): StripLayer => strips.mount() }));
vi.mock('../../src/stage/three/groundPaint', async (original) => ({
  ...(await original<typeof import('../../src/stage/three/groundPaint')>()),
  // 假的：一张 1 × 1 的空图（法线图还是照地面网格的大小）
  beginGroundPaint: (): GroundPaintJob => ({
    finish: (_scene, ground) => Promise.resolve({ kind: 'live', colour: new Uint8Array(4), w: 1, h: 1, normals: new Uint8Array(ground.nx * ground.nz * 4) }),
  }),
}));
vi.mock('../../src/stage/three/terrainMesh', async (original) => ({
  ...(await original<typeof import('../../src/stage/three/terrainMesh')>()),
  buildTerrainMesh: (): TerrainMesh => ({ group: new Group(), top: new Mesh(), sides: new Mesh(), uniforms: {}, dispose() {} }),
}));
// 环境贴图要真的三维画面才烤得出来，这里换成一张空的。
// （fakeThree 在这里面现取，不用文件开头引入的：vi.mock 会被挪到所有引入的前面，这里一运行，开头的引入可能还没到。）
vi.mock('three', async (original) => {
  const { fakeThree } = await import('./support/fakeRenderer');
  return fakeThree(await original<typeof import('three')>());
});

/** 约的帧在假钟上隔多久来一次（毫秒）。 */
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
const wheel = (deltaY: number): Record<string, unknown> => ({ deltaY, deltaMode: 0, clientX: 1000, clientY: 800, ctrlKey: false });

const WIDE_INSETS: StageInsets = { top: 62, right: 0, bottom: 130, left: 0 };
/** 一块很高的沙盘栏：大屏幕上一个 2560 × 1700 的窗口（栏 = 窗口宽 − 500，和窗口一样高）。 */
const SIZE = { width: 2060, height: 1700 };

const opened: StopStageView[] = [];

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.stubGlobal('document', fakeDocument());
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, FRAME_MS));
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  if (realSceneKeys().includes(KEY)) vi.stubGlobal('fetch', fakeFetch(realSceneFile(KEY).terrainPath));
  // 页面上是取到沙盘程序以后把登记表交进来的（src/stage/index.ts）；这里照样交
  provideFamilies(FAMILIES);
  provideStyles(STYLES);
});

afterEach(() => {
  for (const view of opened.splice(0)) view.destroy();
});

afterAll(async () => {
  // 等后台备模型的那一小会儿过去，再把假的页面拿走
  await wait(300);
  provideFamilies([]);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function stage() {
  const fake = fakeRenderer();
  const { canvas, el } = fakeCanvas(SIZE.width, SIZE.height);
  const host = createHost(fakeHostParts(canvas, fake.renderer).parts);
  const pane = { clientWidth: SIZE.width, clientHeight: SIZE.height } as HTMLElement;
  return { fake, el, host, pane };
}
type Stage = ReturnType<typeof stage>;

async function openView(s: Stage, scene: StopScene, section: string): Promise<StopStageView> {
  const { createStopView } = await import('../../src/stage/three/view');
  const table: StopTable = { kind: 'stop', key: KEY, scene, terrainUrl: 'terrain.bin' };
  const view = createStopView(s.pane, table, { namesMode: 'ancient', reducedMotion: false, section, insets: WIDE_INSETS, tier: 'full' }, s.host);
  opened.push(view);
  return view;
}

/** 浮桥的几套（贴近的、中间的、远看的，照造的先后）里现在显着第几套；这一节没有桥是空的。 */
function shownPlans(root: Object3D): number[] {
  const sets: Object3D[] = [];
  root.traverse((o) => void (o.name === 'step' && sets.push(o)));
  return sets.flatMap((o, k) => (o.visible && o.parent?.visible ? [k] : []));
}

describe.runIf(realSceneKeys().includes(KEY))('眉州的沙盘在 view 里：摆好的画面上的浮桥，和水纹那一段每一帧做的事', () => {
  const R = realScene(KEY);
  const { scene, coords, samplers, ground } = R;
  const style = styleFor(scene.style);
  const headings = sectionHeadings(scene);
  const bridge = scene.things.find((t) => t.kind === 'pontoon-bridge');
  if (!bridge) throw new Error('眉州的场景里没有浮桥');
  /** 这座桥在场的各节里镜头最近的一节写的距离（眉州：12000），和照它算出来的两条界线（3840、6000）。 */
  const near = Math.min(...scene.sections.filter((s) => existsAt(bridge.when, s.heading, headings)).map((s) => s.camera.distanceM));
  const midFrom = near * PONTOON.midFrom;
  const farFrom = near * PONTOON.farFrom;
  const hill = scene.sections.find((s) => s.heading === VIEW_HILL);
  if (!hill) throw new Error('眉州的场景里没有“正月上蟆颐山”');
  /** 这一节在这块沙盘栏上摆好以后折算过的远近。 */
  const placed = placeCamera(hill, scene, samplers, coords, style, SIZE, WIDE_INSETS);
  const restD = equivalentDistance(placed.distanceM, placed.pose.fov, SIZE.height);
  /** 只照远近挑，该显第几套。 */
  const byDistance = (D: number): number => (D >= farFrom ? 2 : D >= midFrom ? 1 : 0);

  it('1700 像素高的沙盘栏上，“正月上蟆颐山”直接摆出来、从别的三节滑过来、不滑直接换过来，浮桥都是同一套；读者自己滚轮推近拉远时界线上下留着上一套，“回到这一处”以后又是摆好的那一套；水纹那一段滑一趟不再读一遍场景里的河', { timeout: 240_000 }, async () => {
    // 摆好的远近正落在“远看的一套”的界线和它的 1.12 倍之间；只照远近挑是远看的一套
    expect([midFrom, farFrom]).toEqual([3840, 6000]);
    expect(restD).toBeGreaterThan(farFrom * 1.02);
    expect(restD).toBeLessThan(farFrom * STEP_HOLD * 0.98);
    expect(byDistance(restD)).toBe(2);

    // 场景抄一份，数一数“河”被读了几遍（水纹那一段要是每一帧都重算最宽的河，每一帧读一遍）
    const copy = structuredClone(scene);
    const rivers = copy.water.rivers;
    let riverReads = 0;
    Object.defineProperty(copy.water, 'rivers', {
      enumerable: true,
      configurable: true,
      get: () => {
        riverReads += 1;
        return rivers;
      },
    });
    expect(copy.water.calmUnderPx).toBe(48);

    const s = stage();
    const view = await openView(s, copy, VIEW_HILL);
    await until(view.ready);
    const world = (): Object3D => {
      const found = s.fake.lastWorld();
      if (!found) throw new Error('一帧也没有画');
      return found;
    };
    const plans = (): number[] => shownPlans(world());
    /** 镜头现在折算过的远近（从“这个画面的底细”里读镜头真的在哪）。 */
    const liveD = (): number => {
      const shot = view.readout().shot;
      if (!shot) throw new Error('没有这个画面的底细');
      const { position, target, fov } = shot.pose;
      return equivalentDistance(Math.hypot(position[0] - target[0], position[1] - target[1], position[2] - target[2]), fov, SIZE.height);
    };
    /** 换到 heading 这一节，一帧一帧地走：每一帧以后显着第几套、河被读了几遍，和一共画了几帧。 */
    const glide = async (heading: string): Promise<{ seen: string[]; frames: number; reads: number }> => {
      const seen: string[] = [];
      const framesBefore = s.fake.frames.length;
      const readsBefore = riverReads;
      let settled = false;
      const done = view.showSection(heading).then(() => {
        settled = true;
      });
      for (let i = 0; i < 2000 && !settled; i++) {
        await wait(FRAME_MS);
        seen.push(plans().join());
      }
      await done;
      return { seen, frames: s.fake.frames.length - framesBefore, reads: riverReads - readsBefore };
    };
    /** 一串里连着一样的并成一个。 */
    const runs = (seen: string[]): string[] => seen.filter((v, i) => i === 0 || v !== seen[i - 1]);

    // ---- 直接摆出来：远看的一套
    expect(plans()).toEqual([2]);
    expect(Math.abs(liveD() / restD - 1)).toBeLessThan(1e-6);

    // ---- 从“纱縠行的家”（贴近的一节）滑过来：一路上照远近换（贴近的、中间的、远看的），到了是远看的一套
    await until(view.showSection(VIEW_HOME));
    expect(plans()).toEqual([]);
    const fromHome = await glide(VIEW_HILL);
    expect(fromHome.frames).toBeGreaterThan(100);
    expect(runs(fromHome.seen)).toEqual(['0', '1', '2']);
    expect(plans()).toEqual([2]);
    expect(Math.abs(liveD() / restD - 1)).toBeLessThan(1e-6);

    // ---- 从“眉州”（看整块沙盘）滑过来：一路上都是远看的一套
    await until(view.showSection(VIEW_ALL));
    expect(plans()).toEqual([]);
    const fromAll = await glide(VIEW_HILL);
    expect(runs(fromAll.seen)).toEqual(['2']);
    expect(plans()).toEqual([2]);

    // ---- 从“老翁泉”（贴近的一节）滑过来
    await until(view.showSection(VIEW_GRAVES));
    const fromGraves = await glide(VIEW_HILL);
    expect(runs(fromGraves.seen)).toEqual(['0', '1', '2']);
    expect(plans()).toEqual([2]);

    // ---- 不滑，直接换过来
    await until(view.showSection(VIEW_HOME));
    await until(view.showSection(VIEW_HILL, { animate: false }));
    expect(plans()).toEqual([2]);
    expect(Math.abs(liveD() / restD - 1)).toBeLessThan(1e-6);

    // ---- 水纹那一段：滑一趟一百多帧，场景里的河没有每一帧再读一遍（滑一趟读的不比“不滑直接换”多出几遍）
    const readsBefore = riverReads;
    await until(view.showSection(VIEW_ALL, { animate: false }));
    await until(view.showSection(VIEW_HILL, { animate: false }));
    const placedReads = riverReads - readsBefore;
    for (const run of [fromHome, fromAll, fromGraves]) {
      expect(run.frames).toBeGreaterThan(100);
      expect(run.reads, `滑了 ${run.frames} 帧`).toBeLessThanOrEqual(placedReads + 4);
    }

    // ---- 读者自己用滚轮推近：进了界线下面那一成多，还是远看的一套（留着）；再近，换中间的一套
    let notches = 0;
    while (liveD() >= farFrom && notches < 40) {
      s.el.fire('wheel', wheel(-100));
      await wait(20);
      notches += 1;
    }
    expect(liveD()).toBeLessThan(farFrom);
    expect(liveD()).toBeGreaterThan(farFrom / STEP_HOLD);
    expect(byDistance(liveD())).toBe(1);
    expect(plans(), '读者推近到界线下面一点：留着远看的一套').toEqual([2]);
    while (liveD() >= farFrom / STEP_HOLD && notches < 40) {
      s.el.fire('wheel', wheel(-100));
      await wait(20);
      notches += 1;
    }
    expect(liveD()).toBeLessThan(farFrom / STEP_HOLD);
    expect(liveD()).toBeGreaterThan(midFrom * STEP_HOLD);
    expect(plans()).toEqual([1]);
    // 再拉远到摆好的远近上下：留着中间的一套（读者自己换出来的细处，不是摆好的画面）
    while (liveD() < restD && notches < 80) {
      s.el.fire('wheel', wheel(100));
      await wait(20);
      notches += 1;
    }
    expect(liveD()).toBeGreaterThanOrEqual(restD);
    expect(liveD()).toBeLessThan(farFrom * STEP_HOLD);
    expect(plans(), '读者拉远到界线上面一点：留着中间的一套').toEqual([1]);

    // ---- “回到这一处”：滑回摆好的位置，又是摆好的那一套
    await until(view.resetView());
    expect(Math.abs(liveD() / restD - 1)).toBeLessThan(1e-6);
    expect(plans()).toEqual([2]);

    // ---- 读者再换出中间的一套、拉回界线上面一点，这时候不滑、直接摆这一节：摆好的画面不留读者换出来的那一套
    notches = 0;
    while (liveD() >= farFrom / STEP_HOLD && notches < 40) {
      s.el.fire('wheel', wheel(-100));
      await wait(20);
      notches += 1;
    }
    while (liveD() < restD && notches < 80) {
      s.el.fire('wheel', wheel(100));
      await wait(20);
      notches += 1;
    }
    expect(liveD()).toBeLessThan(farFrom * STEP_HOLD);
    expect(plans()).toEqual([1]);
    await until(view.showSection(VIEW_HILL, { animate: false }));
    expect(Math.abs(liveD() / restD - 1)).toBeLessThan(1e-6);
    expect(plans()).toEqual([2]);
  });

  it('零件库：apply 的 hold 交 false，只照远近挑，不看上一帧显的是哪一套；不交（读者在动镜头）照旧在界线上下留着；换来换去不重造网格', { timeout: 120_000 }, () => {
    const ctx: KitContext = { scene, ground, samplers, coords, style, quality: FULL_QUALITY, kit: R.kit };
    const normal = scene.water.levels.values.normal;
    const models = buildModels(ctx);
    const shown = (D: number, hold?: boolean): number[] => {
      models.apply(VIEW_HILL, normal, D, hold);
      return shownPlans(models.group);
    };
    const meshes = (): string[] => {
      const out: string[] = [];
      models.group.traverse((o) => void ((o as Mesh).isMesh && out.push((o as Mesh).geometry.uuid)));
      return out.sort();
    };
    expect(shown(1500)).toEqual([0]);
    const before = meshes();
    // 从近处来，过了界线不到一成多：留着的还是贴近的一套；不留就是中间的一套
    expect(shown(midFrom * 1.05)).toEqual([0]);
    expect(shown(midFrom * 1.05, true)).toEqual([0]);
    expect(shown(midFrom * 1.05, false)).toEqual([1]);
    // 中间的一套显着，到了 1700 像素高的沙盘栏上这一节摆好的远近：留着的还是中间的一套；不留就是远看的一套
    expect(shown(restD)).toEqual([1]);
    expect(shown(restD, false)).toEqual([2]);
    // 远看的一套显着，回到界线下面一点：留着的还是远看的；不留就是中间的
    expect(shown(farFrom / 1.05)).toEqual([2]);
    expect(shown(farFrom / 1.05, false)).toEqual([1]);
    // 不留的时候，先前显的是哪一套都不要紧：哪个远近都只照远近挑（界线上正好算上面的一套）
    const distances = [900, midFrom - 1, midFrom, midFrom * 1.1, farFrom / 1.1, farFrom - 1, farFrom, farFrom * 1.1, restD, 12000, 60000];
    for (const start of [1500, 4500, 20000]) {
      for (const D of distances) {
        shown(start);
        expect(shown(D, false), `先在 ${start} 米，再到 ${D} 米`).toEqual([byDistance(D)]);
      }
    }
    expect(meshes()).toEqual(before);
    models.dispose();
  });

  it('最宽的一条河、水纹的两个数：和原来的写法（抄在这里）一个不差（每一座站点沙盘、空的河表；留几成、朝向、疏密）', () => {
    /** 原来的写法：每问一次都把河表走一遍、造一个数组。 */
    const oldShare = (water: StopScene['water'], distanceM: number, fovDeg: number): number => {
      const under = water.calmUnderPx;
      if (!under) return 1;
      const px = (Math.max(0, ...water.rivers.map((r) => r.drawWidthM)) * 2428) / equivalentDistance(distanceM, fovDeg, 900);
      return smoothstep(under, under * CALM_RANGE, px);
    };
    /** 原来的写法：两个数装在一样东西里一起给。 */
    const oldRipple = (bearingDeg: number, distanceM: number, share = 1): { dense: number; turnDeg: number } => {
      const b = ((bearingDeg % 180) + 180) % 180;
      const dense = distanceM < 3000 ? 0.3 : 0.5;
      return { dense: dense + (1 - share) * (1 - dense), turnDeg: b >= 45 && b <= 135 ? 90 : 0 };
    };
    const distances = [500, 2999, 3000, 6353, 12000, 20000, 25000, 30000, 36000, 90000];
    // 只要场景文件里的河表，不算地面（添了别的人物的沙盘，每一座都算一遍地面，这一项就要好几秒）
    for (const key of realSceneKeys()) {
      const water = realSceneFile(key).scene.water;
      const widest = widestRiverM(water);
      expect(widest, key).toBe(Math.max(0, ...water.rivers.map((r) => r.drawWidthM)));
      // 没写门槛的沙盘抄一份写上，也比一遍
      for (const each of [water, { ...water, calmUnderPx: 48 }, { ...water, calmUnderPx: 200 }]) {
        for (const distance of distances) {
          for (const fov of [18, 21, 26]) {
            expect(rippleShare(each, distance, fov, widest), `${key} ${distance} ${fov}`).toBe(oldShare(each, distance, fov));
            expect(rippleShare(each, distance, fov), `${key} ${distance} ${fov}`).toBe(oldShare(each, distance, fov));
          }
        }
      }
    }
    expect(widestRiverM({ ...scene.water, rivers: [] })).toBe(0);
    expect(rippleShare({ ...scene.water, rivers: [] }, 12000, 21)).toBe(0);
    expect(oldShare({ ...scene.water, rivers: [] }, 12000, 21)).toBe(0);
    // 眉州：门槛到一倍半之间的一个远近上，交进去的数不一样，留几成就不一样（交进去的数真的用上了）
    const widest = widestRiverM(scene.water);
    const between = (widest * 2428) / 60;
    expect(rippleShare(scene.water, between, 21, widest)).toBeCloseTo(0.5, 3);
    expect(rippleShare(scene.water, between, 21, widest * 2)).toBe(1);
    for (const bearing of [-200, -90, 0, 14, 38, 44.9, 45, 70, 135, 135.1, 180, 256, 353, 725]) {
      for (const distance of [900, 2999, 3000, 12000, 36000]) {
        for (const share of [0, 0.25, 0.37, 0.5, 1]) {
          const old = oldRipple(bearing, distance, share);
          expect(rippleFor(bearing, distance, share), `${bearing} ${distance} ${share}`).toStrictEqual(old);
          expect(rippleDense(distance, share), `${distance} ${share}`).toBe(old.dense);
          expect(rippleTurn(bearing), `${bearing}`).toBe(old.turnDeg);
        }
        expect(rippleFor(bearing, distance)).toStrictEqual(oldRipple(bearing, distance));
      }
    }
  });
});

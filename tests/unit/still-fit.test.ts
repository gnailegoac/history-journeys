// 定格图的沙盘（src/stage/still）。在 Node 里跑，不要浏览器。分四块：
//
//   一  摆图的算数（fit.ts）在编出来的数上对不对。
//   二  拿真的沙盘比：定格图照“立体沙盘摆镜头的办法”缩放以后，和立体的沙盘自己在那块栏里摆出来的差多少。
//       每一座真的沙盘、每一小节，十种别的沙盘栏加两种多了一行说明的栏（手机那么小的栏不在考虑之内，不比）：比例差不到 8%，题签指着的点差不到 12 像素。
//       立体的沙盘接手时画面跳多少，就是这两个数。（这两个上限是照量出来的数留了余地定的，镜头或模型的大小改了要重新看一眼，
//       每次跑都把量到的数印出来。）
//       content/ 里有了真的清单以后，还把浏览器里拍的时候记下的数和这里算出来的对一遍。
//   三  定格图上的题签就是立体沙盘上的题签：在照着拍的两种沙盘栏上，照清单里记的点摆，和照立体沙盘的点摆，
//       每条题签落在同一个候选位置上；远处的题签在哪一种栏上都摆在同一边。
//   四  定格图的沙盘怎么做事：用一个很小的假容器、假的取图办法、只记指令的假题签层，把接口里的每一样走一遍。
//
// 二、三里“立体的沙盘会怎么摆”用的是 src/stage/three/rig.ts 的 placeCamera 和 screenAnchors，和页面上的沙盘（view.ts）
// 是同一套算法；“清单里会记什么”用的是拍定格图的工具的同一个函数（tests/support/stillsTool.ts 的 stillFromShot）。

import { PerspectiveCamera } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SceneSection, SceneStrip } from '../../src/domain/scene';
import type { StillManifest, StillShape, StillShapeSpec } from '../../src/domain/stills';
import { placeStrips, sideOfSlot } from '../../src/stage/overlay/placeStrips';
import type { StripInput, StripLayer } from '../../src/stage/overlay/types';
import { chooseScale } from '../../src/stage/scale';
import { FADE_MS, RETRY_AFTER_MS, createStillEngine } from '../../src/stage/still/engine';
import { anchorsOnPane, edgeFades, fitStill, pickShape, pictureSize, referenceArea, type StillPane } from '../../src/stage/still/fit';
import { centreShift, equivalentDistance, northDeg, pixelsPerMetre, placeCamera, screenAnchors } from '../../src/stage/three/rig';
import { styleFor } from '../../src/stage/three/style';
import type { StageInsets, StageShot, StageViewInfo, StopStageView } from '../../src/stage/types';
import { realScene, realSceneKeys, type RealScene } from '../stage/support/realScenes';
import { sectionStrips } from '../stage/support/stripSizes';
import { FIXTURE_HEADINGS } from '../support/fixtureScene';
import { FIXTURE_SHAPES, fixtureStillTable, fixtureStillUrl } from '../support/stills-fixture';
import { fakeImages, fakePane, settle } from '../support/stills-fixture/fakeDom';
import { SHOT_CAMERA, shapeSpec, shotInsets, shotViewport, stillFile, stillFromShot, type StillShotView } from '../support/stillsTool';

// ---------------------------------------------------------------- 假的题签层：只记下收到的指令

type StripCall =
  | { op: 'set'; ids: string[]; texts: string[]; sides: (string | undefined)[] }
  | { op: 'place'; anchors: StripInput['anchors']; size: { width: number; height: number }; insets: StageInsets }
  | { op: 'hide' }
  | { op: 'destroy' };

/** 每挂一层题签记一份。（vi.mock 会被挪到所有引入的前面，所以这份记录要用 vi.hoisted 先备好。） */
const stripLayers = vi.hoisted(() => ({ logs: [] as unknown[][] }));

vi.mock('../../src/stage/overlay', async (original) => ({
  ...(await original<typeof import('../../src/stage/overlay')>()),
  mountStrips: (): StripLayer => {
    const log: StripCall[] = [];
    stripLayers.logs.push(log);
    return {
      set(strips) {
        log.push({ op: 'set', ids: strips.map((s) => s.id), texts: strips.map((s) => s.text), sides: strips.map((s) => s.side) });
      },
      place(anchors, size, insets) {
        log.push({ op: 'place', anchors: anchors.map((a) => ({ ...a })), size: { ...size }, insets: { ...insets } });
      },
      hide() {
        log.push({ op: 'hide' });
      },
      remeasure() {},
      destroy() {
        log.push({ op: 'destroy' });
      },
    };
  },
}));

/** 最近挂的那一层题签收到的指令。 */
function stripLog(): StripCall[] {
  return stripLayers.logs[stripLayers.logs.length - 1] as StripCall[];
}

const lastOf = <K extends StripCall['op']>(log: StripCall[], op: K): Extract<StripCall, { op: K }> | undefined =>
  [...log].reverse().find((call): call is Extract<StripCall, { op: K }> => call.op === op);

// ---------------------------------------------------------------- 一  摆图的算数

const insetsOf = (top: number, bottom: number): StageInsets => ({ top, right: 0, bottom, left: 0 });
const MADE = { fitMarginPx: 12, maxFit: 2.5 };
const WIDE = FIXTURE_SHAPES.wide;
const NARROW = FIXTURE_SHAPES.narrow;
/** 照着拍的两种沙盘栏。 */
const WIDE_PANE: StillPane = { width: 940, height: 900, insets: insetsOf(62, 130) };
const NARROW_PANE: StillPane = { width: 768, height: 573, insets: insetsOf(54, 131) };

describe('摆图的算数（fit.ts）', () => {
  it('整张图多大、拍的时候留出来的那一块在图里的哪里', () => {
    expect(pictureSize(WIDE)).toEqual({ width: 1200, height: 900 });
    expect(pictureSize(NARROW)).toEqual({ width: 960, height: 573 });
    expect(referenceArea(WIDE)).toEqual({ x0: 130, y0: 62, x1: 1070, y1: 770 });
    expect(referenceArea(NARROW)).toEqual({ x0: 96, y0: 54, x1: 864, y1: 442 });
    // 沙盘栏的左右也留了空时，一起算进去
    expect(referenceArea({ ...WIDE, insets: [62, 10, 130, 20] })).toEqual({ x0: 150, y0: 62, x1: 1060, y1: 770 });
  });

  it('在照着拍的那种沙盘栏上：原样大小，多拍的两截正好在栏外面', () => {
    const wide = fitStill({ fit: 1, reach: [330, 240] }, WIDE, MADE, WIDE_PANE);
    expect(wide).toEqual({ left: -130, top: 0, width: 1200, height: 900, scale: 1, fit: 1 });
    // 拍的时候镜头已经退过（fit 1.3，要看的点正好顶到边）：照样是原样大小
    // （留出来的那一块 768 × 388，半边各减 12：372、182）
    const narrow = fitStill({ fit: 1.3, reach: [372, 182] }, NARROW, MADE, NARROW_PANE);
    expect(narrow.scale).toBeCloseTo(1, 6);
    expect(narrow.left).toBeCloseTo(-96, 6);
    expect(narrow.top).toBeCloseTo(0, 6);
    expect(narrow.fit).toBeCloseTo(1.3, 6);
  });

  it('栏高了画面跟着大；要看的点摆不下就缩小（镜头退远），最多退到 maxFit 倍', () => {
    // 高了一倍、宽也够：正好大一倍
    const taller = fitStill({ fit: 1, reach: [330, 240] }, WIDE, MADE, { width: 1880, height: 1800, insets: insetsOf(124, 260) });
    expect(taller.scale).toBeCloseTo(2, 6);
    expect(taller.fit).toBe(1);
    // 例子：到徐州，宽的那张摆进 584 × 768 的栏。k = 0.853，要看的点横着伸 396 像素，留出来的半边 292 − 12 = 280
    const squeezed = fitStill({ fit: 1, reach: [396, 208] }, WIDE, MADE, { width: 584, height: 768, insets: insetsOf(62, 130) });
    expect(squeezed.fit).toBeCloseTo((768 / 900) * (396 / 280), 6);
    expect(squeezed.scale).toBeCloseTo(280 / 396, 6);
    // 留出来的那一块的中心对中心
    expect(squeezed.left + squeezed.scale * 600).toBeCloseTo(292, 6);
    expect(squeezed.top + squeezed.scale * 416).toBeCloseTo(62 + (768 - 62 - 130) / 2, 6);
    // 窄得离谱：只退到 2.5 倍为止
    const tiny = fitStill({ fit: 1, reach: [396, 208] }, WIDE, MADE, { width: 120, height: 900, insets: insetsOf(62, 130) });
    expect(tiny.fit).toBe(2.5);
    expect(tiny.scale).toBeCloseTo(1 / 2.5, 6);
    // 留出来的那一块再小，半边也按 16 像素算（和 rig.ts 一样）
    const sliver = fitStill({ fit: 1, reach: [20, 10] }, WIDE, MADE, { width: 30, height: 900, insets: insetsOf(62, 130) });
    expect(sliver.fit).toBeCloseTo(20 / 16, 6);
  });

  it('场景里写了 closest：摆得下时放大一点（镜头靠近），最多靠近到 closest 倍；没写就不靠近', () => {
    const shot = { fit: 1, reach: [100, 80] as [number, number] };
    expect(fitStill(shot, WIDE, MADE, WIDE_PANE).fit).toBe(1);
    const closer = fitStill(shot, WIDE, MADE, WIDE_PANE, 0.8);
    expect(closer.fit).toBe(0.8);
    expect(closer.scale).toBeCloseTo(1.25, 6);
    // 要看的点伸得远，靠近不了那么多：只靠近到摆得下为止
    const partly = fitStill({ fit: 1, reach: [412.2, 80] }, WIDE, MADE, WIDE_PANE, 0.8);
    expect(partly.fit).toBeCloseTo(0.9, 6);
    // closest 写得比 1 大不算数
    expect(fitStill(shot, WIDE, MADE, WIDE_PANE, 1.4).fit).toBe(1);
  });

  it('题签指着的点跟着图走：out 原样，foot 一起换，出了栏的算看不见', () => {
    const fit = fitStill({ fit: 1, reach: [330, 240] }, WIDE, MADE, WIDE_PANE);
    const anchors = anchorsOnPane(
      [
        { id: 'a', x: 0.5, y: 0.5, visible: true },
        { id: 'b', x: 0.25, y: 0.4, visible: true, out: [-0.6, 0.8], foot: [0.25, 0.45] },
        { id: 'hidden', x: 0.5, y: 0.5, visible: false },
        // 落在多拍的那一截里：这块栏里看不见
        { id: 'beside', x: 0.05, y: 0.5, visible: true },
      ],
      fit,
      WIDE_PANE,
    );
    expect(anchors).toEqual([
      { id: 'a', x: 470, y: 450, visible: true },
      { id: 'b', x: 170, y: 360, visible: true, out: [-0.6, 0.8], foot: { x: 170, y: 405 } },
      { id: 'hidden', x: 470, y: 450, visible: false },
      { id: 'beside', x: -70, y: 450, visible: false },
    ]);
  });

  it('图片铺不到的那一边才有过渡：贴着图片的边，28 像素', () => {
    const size = { width: 940, height: 900 };
    // 铺满了：没有
    expect(edgeFades({ left: -130, top: 0, width: 1200, height: 900, scale: 1, fit: 1 }, size)).toEqual([]);
    // 上面差 7 像素：只有上面一条，横着只盖图片在栏里的那一段
    expect(edgeFades({ left: -10, top: 7, width: 1000, height: 900, scale: 1, fit: 1 }, size)).toEqual([{ side: 'top', left: 0, top: 7, width: 940, height: 28 }]);
    // 四边都没铺到
    expect(edgeFades({ left: 100, top: 50, width: 600, height: 500, scale: 0.5, fit: 1 }, size)).toEqual([
      { side: 'left', left: 100, top: 50, width: 28, height: 500 },
      { side: 'right', left: 672, top: 50, width: 28, height: 500 },
      { side: 'top', left: 100, top: 50, width: 600, height: 28 },
      { side: 'bottom', left: 100, top: 522, width: 600, height: 28 },
    ]);
    // 差不到半个像素不算
    expect(edgeFades({ left: 0.3, top: -0.2, width: 939.5, height: 900.4, scale: 1, fit: 1 }, size)).toEqual([]);
    // 整张图都在栏外面：没有
    expect(edgeFades({ left: 2000, top: 0, width: 100, height: 100, scale: 1, fit: 1 }, size)).toEqual([]);
  });

  it('页面没说排法时自己挑：留出来的那一块长宽的比例和现在最接近的那一种', () => {
    expect(pickShape(FIXTURE_SHAPES, WIDE_PANE)).toBe('wide');
    expect(pickShape(FIXTURE_SHAPES, NARROW_PANE)).toBe('narrow');
    // 开发用的单独一页，1200 × 900 的窗口：留出来的那一块 1200 × 828，比例 1.45；宽的是 1.33，窄的是 1.98，宽的近一点
    expect(pickShape(FIXTURE_SHAPES, { width: 1200, height: 900, insets: insetsOf(44, 28) })).toBe('wide');
    // 窗口矮一点、扁一点就是窄的近了：两种形状的分界在比例 1.62 上下（竖着拿的平板上沙盘栏加高以后，窄的那张不再是扁扁的一条）
    expect(pickShape(FIXTURE_SHAPES, { width: 1200, height: 800, insets: insetsOf(44, 28) })).toBe('narrow');
    expect(pickShape(FIXTURE_SHAPES, { width: 1200, height: 500, insets: insetsOf(44, 28) })).toBe('narrow');
    // 只有一种有图的时候就是它
    expect(pickShape(FIXTURE_SHAPES, WIDE_PANE, ['narrow'])).toBe('narrow');
    expect(pickShape(FIXTURE_SHAPES, NARROW_PANE, ['wide'])).toBe('wide');
  });
});

// ---------------------------------------------------------------- 二、三  拿真的沙盘比

interface TestPane {
  name: string;
  /** 页面在这种窗口上说的排法（窗口 960 像素以上宽、而且横着才是宽的；竖着拿的大平板 1024 × 1366 是窄的）。 */
  shape: StillShape;
  pane: StillPane;
}

const pane = (name: string, shape: StillShape, width: number, height: number, top: number, bottom: number): TestPane => ({
  name,
  shape,
  pane: { width, height, insets: insetsOf(top, bottom) },
});

/** 照着拍的两种沙盘栏（宽的 1440 × 900 的窗口，窄的竖着拿的 768 × 1024 平板）。 */
const REFERENCE_PANES: TestPane[] = [pane('940 × 900（1440 × 900 的窗口）', 'wide', 940, 900, 62, 130), pane('768 × 573（竖着拿的 768 × 1024 平板）', 'narrow', 768, 573, 54, 131)];

/** 别的十种沙盘栏：电脑的窗口，横着、竖着拿的几种平板。上面留的是按钮那一排，下面是题记。手机那么小的栏不在考虑之内。 */
const OTHER_PANES: TestPane[] = [
  pane('1420 × 1080（1920 × 1080）', 'wide', 1420, 1080, 62, 130),
  pane('2060 × 1440（2560 × 1440）', 'wide', 2060, 1440, 62, 130),
  pane('874 × 768（1366 × 768）', 'wide', 874, 768, 62, 130),
  pane('819 × 720（1280 × 720）', 'wide', 819, 720, 62, 130),
  pane('740 × 820（1180 × 820）', 'wide', 740, 820, 62, 130),
  pane('584 × 768（1024 × 768）', 'wide', 584, 768, 62, 130),
  pane('600 × 538（600 × 960）', 'narrow', 600, 538, 54, 131),
  pane('810 × 605（810 × 1080）', 'narrow', 810, 605, 54, 131),
  pane('820 × 661（820 × 1180）', 'narrow', 820, 661, 54, 131),
  // 竖着拿的大平板：第四种标准的画面（tests/stage/support/standardPanes.ts）。窄的那张图在这里要放大到 1.34 倍（写了 closest 的小节到 1.53 倍）
  pane('1024 × 765（1024 × 1366）', 'narrow', 1024, 765, 54, 131),
];

/** 按钮下面多了一行说明的两种栏（只放图片的时候）：上面多留 30、34 像素。 */
const NOTICE_PANES: TestPane[] = [pane('768 × 573，多一行说明', 'narrow', 768, 573, 84, 131), pane('940 × 900，多一行说明', 'wide', 940, 900, 96, 130)];

/**
 * 上限：比例差多少、题签指着的点差多少像素。
 * 像素是照图片原样大小说的：图片在大的沙盘栏里放大了几倍，上限跟着放大几倍（缩小了不跟着缩）。
 * 要这样算，是因为模型放大多少跟画面的高有关：2560 × 1440 的窗口上，立体的沙盘把楼画得比拍定格图时（900 高）小，
 * 楼顶的题签指着的点就比图上的低一截——图是放大到 1.6 倍显示的，这一截也跟着大。
 */
const SCALE_LIMIT = 0.08;
const ANCHOR_LIMIT_PX = 12;
const anchorLimit = (shownAt: number): number => ANCHOR_LIMIT_PX * Math.max(1, shownAt);

/**
 * 立体的沙盘在这么大的画面上摆这一节，会给出什么读数：和 view.ts 的 lookFor、drawFrame、shot 是同一套算法
 * （镜头用 placeCamera 摆，画面的中心挪到留出来的那一块中间，题签指着的点用 screenAnchors 投）。
 */
function liveShot(R: RealScene, section: SceneSection, size: { width: number; height: number }, insets: StageInsets): StageShot {
  const { scene, coords, samplers } = R;
  const style = styleFor(scene.style);
  const placed = placeCamera(section, scene, samplers, coords, style, size, insets);
  const camera = new PerspectiveCamera(placed.pose.fov, size.width / size.height, Math.max(60, placed.distanceM * 0.1), placed.distanceM * 3 + 30000);
  camera.position.set(...placed.pose.position);
  camera.lookAt(...placed.pose.target);
  const [shiftX, shiftY] = centreShift(insets);
  if (shiftX || shiftY) camera.setViewOffset(size.width, size.height, -shiftX, -shiftY, size.width, size.height);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const strips = section.strips.map((id) => scene.strips.find((s) => s.id === id)).filter((s): s is SceneStrip => s !== undefined);
  const D = equivalentDistance(placed.distanceM, camera.fov, size.height);
  return {
    section: section.heading,
    size,
    insets,
    pose: { target: placed.pose.target, position: placed.pose.position, fov: placed.pose.fov },
    fit: placed.fit,
    reach: placed.reach,
    pxPerMetre: pixelsPerMetre(camera, placed.pose.target, size.height),
    northDeg: northDeg(camera),
    anchors: screenAnchors(strips, scene, samplers, coords, style, D, camera, size),
  };
}

/** content/ 里已经拍好的定格图的清单（还没有拍时是空的）。 */
const realManifests = import.meta.glob<StillManifest>('/content/figures/*/stills/*.json', { import: 'default', eager: true });

/** 拍定格图的工具照这种沙盘栏拍这一节，清单里会记下什么（不真的拍，只算镜头和题签指着的点）。 */
const specs = new Map<StillShape, StillShapeSpec>(
  REFERENCE_PANES.map(({ shape, pane: p }) => [shape, shapeSpec(shape, { pane: [p.width, p.height], insets: [p.insets.top, p.insets.right, p.insets.bottom, p.insets.left] })]),
);
const recorded = new Map<string, StillShotView>();
function recordedShot(R: RealScene, section: SceneSection, shape: StillShape): { spec: StillShapeSpec; still: StillShotView } {
  const spec = specs.get(shape)!;
  const key = `${R.key}|${section.heading}|${shape}`;
  let still = recorded.get(key);
  if (!still) {
    still = stillFromShot(liveShot(R, section, shotViewport(spec), shotInsets(spec)), shape);
    recorded.set(key, still);
  }
  return { spec, still };
}

/** 一节在一种沙盘栏上：定格图摆出来的，和立体的沙盘自己摆出来的，差多少。 */
function compare(
  R: RealScene,
  section: SceneSection,
  test: TestPane,
): { scale: number; shownAt: number; worstPx: number; worstId: string; still: StripInput['anchors']; live: StripInput['anchors'] } {
  const { spec, still } = recordedShot(R, section, test.shape);
  const fit = fitStill(still, spec, SHOT_CAMERA, test.pane, section.camera.closest);
  const onStill = anchorsOnPane(still.anchors, fit, test.pane);
  const live = liveShot(R, section, { width: test.pane.width, height: test.pane.height }, test.pane.insets);
  let worstPx = 0;
  let worstId = '';
  live.anchors.forEach((anchor, i) => {
    const d = Math.hypot(anchor.x - onStill[i].x, anchor.y - onStill[i].y);
    if (d > worstPx) {
      worstPx = d;
      worstId = anchor.id;
    }
  });
  return { scale: live.pxPerMetre / (still.pxPerMetre * fit.scale), shownAt: fit.scale, worstPx, worstId, still: onStill, live: live.anchors };
}

/**
 * 一份清单里记的镜头和题签指着的点，和这里照同一套算法（立体沙盘摆镜头的算法，加上工具做清单的那个函数）算出来的，
 * 哪里不一样。一处一句；空的就是都一样。清单是浏览器里拍的时候记的：这一项把浏览器里的数和 Node 里的数对起来。
 */
function manifestDiffers(R: RealScene, manifest: Pick<StillManifest, 'shapes' | 'stills'>): string[] {
  const differs: string[] = [];
  for (const still of manifest.stills) {
    const where = `${still.file}（${still.section}）`;
    const section = R.scene.sections.find((s) => s.heading === still.section);
    if (!section) {
      differs.push(`${where}：场景里没有这一小节`);
      continue;
    }
    const spec = manifest.shapes[still.shape];
    const size = pictureSize(spec);
    const expected = stillFromShot(liveShot(R, section, shotViewport(spec), shotInsets(spec)), still.shape);
    if (Math.abs(still.fit - expected.fit) > 0.002) differs.push(`${where}：fit 记的是 ${still.fit}，算出来是 ${expected.fit}`);
    if (Math.abs(still.reach[0] - expected.reach[0]) > 1 || Math.abs(still.reach[1] - expected.reach[1]) > 1) differs.push(`${where}：reach 记的是 ${still.reach.join('、')}，算出来是 ${expected.reach.join('、')}`);
    if (Math.abs(still.pxPerMetre / expected.pxPerMetre - 1) > 0.002) differs.push(`${where}：pxPerMetre 记的是 ${still.pxPerMetre}，算出来是 ${expected.pxPerMetre}`);
    if (Math.abs(still.northDeg - expected.northDeg) > 0.2) differs.push(`${where}：northDeg 记的是 ${still.northDeg}，算出来是 ${expected.northDeg}`);
    if (still.anchors.map((a) => a.id).join('|') !== expected.anchors.map((a) => a.id).join('|')) {
      differs.push(`${where}：题签记的是 [${still.anchors.map((a) => a.id).join('、')}]，这一节的是 [${expected.anchors.map((a) => a.id).join('、')}]`);
      continue;
    }
    still.anchors.forEach((anchor, i) => {
      const other = expected.anchors[i];
      const px = Math.hypot((anchor.x - other.x) * size.width, (anchor.y - other.y) * size.height);
      if (px > 0.5) differs.push(`${where}：${anchor.id} 指着的点差 ${px.toFixed(2)} 像素`);
      if (anchor.visible !== other.visible) differs.push(`${where}：${anchor.id} 看不看得见记得不一样`);
      if ((anchor.out === undefined) !== (other.out === undefined) || (anchor.out && other.out && Math.hypot(anchor.out[0] - other.out[0], anchor.out[1] - other.out[1]) > 0.01)) {
        differs.push(`${where}：${anchor.id} 朝外的方向记得不一样`);
      }
      if ((anchor.foot === undefined) !== (other.foot === undefined) || (anchor.foot && other.foot && Math.hypot((anchor.foot[0] - other.foot[0]) * size.width, (anchor.foot[1] - other.foot[1]) * size.height) > 0.5)) {
        differs.push(`${where}：${anchor.id} 脚下的地面记得不一样`);
      }
    });
  }
  return differs;
}

describe.each(realSceneKeys())('%s：定格图和立体的沙盘对不对得上', (key) => {
  it('清单里会记下的东西是齐的：每节两种形状，题签一条一个点、先后相同，第一条的点在留出来的那一块里', () => {
    const R = realScene(key);
    for (const section of R.scene.sections) {
      for (const shape of ['wide', 'narrow'] as const) {
        const { spec, still } = recordedShot(R, section, shape);
        expect(still.anchors.map((a) => a.id), `${section.heading} ${shape}`).toEqual(section.strips);
        expect(still.fit).toBeGreaterThan(0);
        expect(still.pxPerMetre).toBeGreaterThan(0);
        const area = referenceArea(spec);
        const size = pictureSize(spec);
        const first = still.anchors[0];
        expect(first.visible, `${section.heading} ${shape}`).toBe(true);
        expect(first.x * size.width).toBeGreaterThanOrEqual(area.x0);
        expect(first.x * size.width).toBeLessThanOrEqual(area.x1);
        expect(first.y * size.height).toBeGreaterThanOrEqual(area.y0);
        expect(first.y * size.height).toBeLessThanOrEqual(area.y1);
      }
    }
  });

  it('content/ 里真的清单：浏览器里拍的时候记下的镜头和题签指着的点，和这里照同一套算法算出来的一样（还没有定格图时不查）', () => {
    const [figureId, stopId] = key.split('/');
    const manifest = realManifests[`/content/figures/${figureId}/stills/${stopId}.json`];
    if (!manifest) return;
    // 对不上多半是场景或程序改了以后没有重拍（那样 tests/stage/stills-fresh.test.ts 也会说）；不然就是工具记错了
    expect(manifestDiffers(realScene(key), manifest).join('\n')).toBe('');
  });

  it('上面这一项查得出毛病：照算法编一份清单是对得上的，挪一个点、改一个数就对不上', () => {
    const R = realScene(key);
    const shapes = { wide: specs.get('wide')!, narrow: specs.get('narrow')! };
    const build = (): Pick<StillManifest, 'shapes' | 'stills'> => ({
      shapes,
      stills: R.scene.sections.flatMap((section, i) =>
        (['wide', 'narrow'] as const).map((shape) => {
          const view = recordedShot(R, section, shape).still;
          const size = pictureSize(shapes[shape]);
          return {
            ...view,
            anchors: view.anchors.map((anchor) => ({ ...anchor })),
            file: stillFile(R.scene.stopId, i + 1, shape),
            width: size.width * shapes[shape].pixelRatio,
            height: size.height * shapes[shape].pixelRatio,
            bytes: 1,
            quality: 80,
            key: '0000000000000000',
            raw: '0000000000000000',
          };
        }),
      ),
    });
    expect(manifestDiffers(R, build())).toEqual([]);

    const moved = build();
    moved.stills[0].anchors[0].x += 2 / pictureSize(shapes.wide).width;
    expect(manifestDiffers(R, moved)).toEqual([expect.stringContaining('指着的点差 2.00 像素')]);

    const pulledBack = build();
    pulledBack.stills[1].fit += 0.01;
    expect(manifestDiffers(R, pulledBack)).toEqual([expect.stringContaining('fit 记的是')]);

    const turned = build();
    turned.stills[2].northDeg += 1;
    expect(manifestDiffers(R, turned)).toEqual([expect.stringContaining('northDeg 记的是')]);

    const fewer = build();
    fewer.stills[3].anchors.pop();
    expect(manifestDiffers(R, fewer)).toEqual([expect.stringContaining('题签记的是')]);

    const renamed = build();
    renamed.stills[4].section = '没有这一节';
    expect(manifestDiffers(R, renamed)).toEqual([expect.stringContaining('场景里没有这一小节')]);
  });

  it('在照着拍的两种沙盘栏上：和立体的沙盘一模一样（比例差不到千分之一，题签指着的点差不到 0.1 像素）', () => {
    const R = realScene(key);
    for (const test of REFERENCE_PANES) {
      for (const section of R.scene.sections) {
        const { scale, worstPx, worstId } = compare(R, section, test);
        expect(Math.abs(scale - 1), `${test.name} ${section.heading} 的比例`).toBeLessThan(0.001);
        expect(worstPx, `${test.name} ${section.heading} 的 ${worstId}`).toBeLessThan(0.1);
      }
    }
  });

  it(`别的十种沙盘栏和两种多一行说明的栏：比例差不到 ${SCALE_LIMIT * 100}%，题签指着的点差不到 ${ANCHOR_LIMIT_PX} 像素（照图片原样大小说）`, () => {
    const R = realScene(key);
    const over: string[] = [];
    const lines: string[] = [];
    for (const test of [...OTHER_PANES, ...NOTICE_PANES]) {
      let worstScale = 0;
      let worstPx = 0;
      let where = '';
      let largest = 0;
      for (const section of R.scene.sections) {
        const { scale, shownAt, worstPx: px, worstId } = compare(R, section, test);
        if (Math.abs(scale - 1) > SCALE_LIMIT) over.push(`${test.name} ${section.heading}：比例差 ${((scale - 1) * 100).toFixed(1)}%`);
        if (px > anchorLimit(shownAt)) over.push(`${test.name} ${section.heading}：${worstId} 差 ${px.toFixed(1)} 像素（图片放大到 ${shownAt.toFixed(2)} 倍，上限 ${anchorLimit(shownAt).toFixed(1)}）`);
        if (Math.abs(scale - 1) > Math.abs(worstScale)) worstScale = scale - 1;
        largest = Math.max(largest, shownAt);
        if (px > worstPx) {
          worstPx = px;
          where = `${section.heading} 的 ${worstId}`;
        }
      }
      lines.push(`  ${test.name}：比例最多差 ${(worstScale * 100).toFixed(1)}%，题签指着的点最多差 ${worstPx.toFixed(1)} 像素（${where}）；图片最大放到 ${largest.toFixed(2)} 倍`);
    }
    console.log(`${key} 的定格图和立体的沙盘差多少：\n${lines.join('\n')}`);
    expect(over).toEqual([]);
  });

  it('页面没说排法时自己挑的形状，和页面在这种窗口上会说的一样', () => {
    const shapes = { wide: specs.get('wide')!, narrow: specs.get('narrow')! };
    const wrong = [...REFERENCE_PANES, ...OTHER_PANES, ...NOTICE_PANES].filter((test) => pickShape(shapes, test.pane) !== test.shape).map((test) => test.name);
    // 只有一种对不上：2560 × 1440 的窗口。它的沙盘栏留出来的那一块是 2060 × 1248，比例 1.65；宽的那张是 1.33，
    // 窄的那张自从竖着拿的平板上沙盘栏加高到屏幕的 56% 以后是 1.98（原来是 3.41），窄的反而近一点。
    // 页面自己总是说排法的（layout.css 的 --stage-shape），这一种挑法只在开发用的单独一页上用得到；
    // 要它在这种窗口上也挑宽的，得改页面的程序（src/stage/still/fit.ts），这一轮页面的程序不许再长。记在交接里，由负责人定。
    // 别的窗口对不上了，这里照样不通过。
    expect(wrong).toEqual(['2060 × 1440（2560 × 1440）']);
  });

  it('在照着拍的两种沙盘栏上，每条题签照清单里的点摆，和照立体沙盘的点摆，落在同一个候选位置上', () => {
    const R = realScene(key);
    const differs: string[] = [];
    for (const test of REFERENCE_PANES) {
      const size = { width: test.pane.width, height: test.pane.height };
      for (const section of R.scene.sections) {
        const { still, live } = compare(R, section, test);
        const strips = sectionStrips(R.scene, section.heading, size.width);
        const onStill = placeStrips({ strips, anchors: still, size, insets: test.pane.insets });
        const onLive = placeStrips({ strips, anchors: live, size, insets: test.pane.insets });
        onLive.forEach((placement, i) => {
          const other = onStill[i];
          if (placement.hidden !== other.hidden || placement.slot !== other.slot || Math.hypot(placement.x - other.x, placement.y - other.y) > 1) {
            differs.push(`${test.name} ${section.heading} 的 ${placement.id}：立体沙盘上 ${describePlacement(placement)}，定格图上 ${describePlacement(other)}`);
          }
        });
      }
    }
    expect(differs).toEqual([]);
  });

  it('远处的题签在哪一种沙盘栏上都和立体沙盘摆在同一边', () => {
    const R = realScene(key);
    const differs: string[] = [];
    let checked = 0;
    for (const test of [...REFERENCE_PANES, ...OTHER_PANES, ...NOTICE_PANES]) {
      const size = { width: test.pane.width, height: test.pane.height };
      for (const section of R.scene.sections) {
        const { still, live } = compare(R, section, test);
        const strips = sectionStrips(R.scene, section.heading, size.width);
        const onStill = placeStrips({ strips, anchors: still, size, insets: test.pane.insets });
        const onLive = placeStrips({ strips, anchors: live, size, insets: test.pane.insets });
        live.forEach((anchor, i) => {
          if (!anchor.out) return;
          // 清单里也记了朝外的方向，而且是同一个方向
          const kept = still[i].out;
          if (!kept || Math.hypot(kept[0] - anchor.out[0], kept[1] - anchor.out[1]) > 0.01) differs.push(`${test.name} ${section.heading} 的 ${anchor.id}：朝外的方向没有照样记下来`);
          const a = onLive[i];
          const b = onStill[i];
          checked += 1;
          if (a.hidden !== b.hidden) differs.push(`${test.name} ${section.heading} 的 ${anchor.id}：立体沙盘上${a.hidden ? '没摆' : '摆了'}，定格图上${b.hidden ? '没摆' : '摆了'}`);
          else if (!a.hidden && sideOf(a) !== sideOf(b)) differs.push(`${test.name} ${section.heading} 的 ${anchor.id}：立体沙盘上摆在 ${sideOf(a)}，定格图上摆在 ${sideOf(b)}`);
        });
      }
    }
    expect(differs).toEqual([]);
    // 徐州有远处的题签（白土镇、南京）：确实比过
    if (key === 'su-shi/xuzhou') expect(checked).toBeGreaterThan(0);
  });
});

/** 一条题签摆在它指的那一点的哪一边：先看候选位置的号，没有号（老的摆法）就看题签的中心在那一点的哪边。 */
function sideOf(placement: { slot?: number; x: number; y: number; leader: [number, number, number, number] | null }): string {
  const bySlot = placement.slot === undefined ? null : sideOfSlot(placement.slot);
  if (bySlot) return bySlot;
  if (!placement.leader) return 'on';
  const dx = placement.x - placement.leader[0];
  const dy = placement.y - placement.leader[1];
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'below' : 'above';
}

function describePlacement(p: { hidden: boolean; slot?: number; x: number; y: number }): string {
  return p.hidden ? '没摆' : `在 ${p.slot ?? '?'} 号（${p.x.toFixed(0)}, ${p.y.toFixed(0)}）`;
}

// ---------------------------------------------------------------- 四  定格图的沙盘怎么做事

const [FIRST, SECOND] = FIXTURE_HEADINGS;
const OPTIONS = { namesMode: 'ancient' as const, reducedMotion: false, insets: insetsOf(62, 130) };

/** 在一个假容器里摆一座带假清单的小沙盘。 */
function mount(config: { width?: number; height?: number; shape?: 'wide' | 'narrow' | ''; options?: Partial<typeof OPTIONS> & { section?: string }; prepare?: (images: ReturnType<typeof fakeImages>) => void } = {}) {
  const images = fakeImages();
  config.prepare?.(images);
  const p = fakePane(config.width ?? 940, config.height ?? 900, config.shape ?? 'wide');
  const view = createStillEngine(images.parts).create(p.container, fixtureStillTable(), { ...OPTIONS, ...config.options });
  return { view, images, pane: p, log: stripLog() };
}

/** 一个 Promise 现在是完成了、拒绝了，还是还没有结果。 */
async function stateOf(promise: Promise<unknown>): Promise<'done' | 'failed' | 'pending'> {
  let state: 'done' | 'failed' | 'pending' = 'pending';
  promise.then(
    () => (state = 'done'),
    () => (state = 'failed'),
  );
  await settle();
  return state;
}

describe('定格图的沙盘（engine.ts）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('是一个 StageEngine：叫 still，哪种浏览器都说能用；读数都是 0', async () => {
    const engine = createStillEngine(fakeImages().parts);
    expect(engine.name).toBe('still');
    expect(engine.support()).toEqual({ ok: true });
    const { view } = mount();
    await view.ready;
    expect(view.readout()).toEqual({ triangles: 0, drawCalls: 0 });
    await expect(view.resetView()).resolves.toBeUndefined();
  });

  it('ready：第一张图取到、摆上、题签摆好以后才完成', async () => {
    const first = fixtureStillUrl(1, 'wide');
    const { view, images, pane: p, log } = mount({ prepare: (i) => i.hold(first) });
    expect(await stateOf(view.ready)).toBe('pending');
    expect(images.requests).toEqual([first]);
    expect(p.topPicture()).toBeUndefined();
    expect(log.some((call) => call.op === 'set')).toBe(false);

    images.release(first);
    await view.ready;
    // 容器里添了两样：div.still-table，和题签那一层（这里是假的，只记指令）
    expect(p.node.children.map((child) => child.className)).toEqual(['still-table']);
    const top = p.topPicture()!;
    expect(top.src).toBe(first);
    expect(top.attributes.alt).toBe('');
    expect(top.style).toMatchObject({ left: '-130px', top: '0px', width: '1200px', height: '900px' });
    expect(p.wrapper()!.attributes).toEqual({ 'data-still-section': FIRST, 'data-still-shape': 'wide', 'data-still-insets': '62 0 130 0' });
    expect(p.fades()).toEqual([]);
    // 题签：这一节的两条，当时的名字；照清单里记的位置摆，四边留的空原样交给题签层
    expect(lastOf(log, 'set')).toMatchObject({ ids: ['s-town', 's-river'], texts: ['样城', '样水'] });
    const placed = lastOf(log, 'place')!;
    expect(placed.size).toEqual({ width: 940, height: 900 });
    expect(placed.insets).toEqual(insetsOf(62, 130));
    expect(placed.anchors).toEqual([
      { id: 's-town', x: -130 + 0.42 * 1200, y: 0.44 * 900, visible: true, foot: { x: -130 + 0.42 * 1200, y: 0.47 * 900 } },
      { id: 's-river', x: -130 + 0.55 * 1200, y: 0.3 * 900, visible: true },
    ]);
    // 先藏着换，再摆
    const ops = log.map((call) => call.op);
    expect(ops.indexOf('set')).toBeGreaterThan(ops.indexOf('hide'));
    expect(ops.lastIndexOf('place')).toBeGreaterThan(ops.indexOf('set'));
  });

  it('一开始就摆页面要的那一节；要的小节场景里没有，就摆第一节', async () => {
    const asked = mount({ options: { section: SECOND } });
    await asked.view.ready;
    expect(asked.pane.topPicture()!.src).toBe(fixtureStillUrl(2, 'wide'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unknown = mount({ options: { section: '没有这一节' } });
    await unknown.view.ready;
    expect(unknown.pane.topPicture()!.src).toBe(fixtureStillUrl(1, 'wide'));
    expect(warn).toHaveBeenCalled();
  });

  it('这座沙盘没有定格图：ready 拒绝，容器里什么也不添', async () => {
    const p = fakePane(940, 900, 'wide');
    const table = fixtureStillTable();
    delete table.stills;
    const before = stripLayers.logs.length;
    const view = createStillEngine(fakeImages().parts).create(p.container, table, OPTIONS);
    await expect(view.ready).rejects.toThrow('这座沙盘没有定格图');
    expect(p.node.children).toEqual([]);
    expect(stripLayers.logs.length).toBe(before);
    // 别的指令都不出错
    await expect(view.showSection(SECOND)).resolves.toBeUndefined();
    view.setNamesMode('modern');
    view.resize();
    view.destroy();
    await expect(view.showSection(SECOND)).rejects.toThrow();
  });

  it('这一节没有页面要的那种形状的图：ready 拒绝', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = fakePane(768, 573, 'narrow');
    const table = fixtureStillTable();
    table.stills!.manifest.stills = table.stills!.manifest.stills.filter((still) => still.shape === 'wide');
    const view = createStillEngine(fakeImages().parts).create(p.container, table, OPTIONS);
    await expect(view.ready).rejects.toThrow('没有窄的定格图');
  });

  it('换小节：取到新的一张再换，淡入的时候题签藏着，淡完才摆、才算完成', async () => {
    const { view, images, pane: p, log } = mount();
    await view.ready;
    const before = log.length;
    images.holdWaits();
    const going = view.showSection(SECOND);
    expect(await stateOf(going)).toBe('pending');
    // 新的一张已经在上面，正在淡入；旧的一张垫在底下
    const top = p.topPicture()!;
    expect(top.src).toBe(fixtureStillUrl(2, 'wide'));
    expect(top.className).toBe('still-picture is-top is-arriving');
    expect(p.wrapper()!.children.filter((child) => child.tagName === 'img').map((img) => img.className).sort()).toEqual(['still-picture', 'still-picture is-top is-arriving']);
    expect(images.waits).toEqual([FADE_MS]);
    // 题签藏起来了，新的一节的还没换上
    expect(log.slice(before).map((call) => call.op)).toEqual(['hide']);

    images.releaseWaits();
    await going;
    expect(top.className).toBe('still-picture is-top');
    expect(p.wrapper()!.children.filter((child) => child.tagName === 'img').map((img) => img.className).sort()).toEqual(['still-picture is-idle', 'still-picture is-top']);
    expect(p.wrapper()!.attributes['data-still-section']).toBe(SECOND);
    expect(lastOf(log, 'set')).toMatchObject({ ids: ['s-town', 's-far'], texts: ['样城', '远镇'] });
    // 远处的题签带着朝外的方向；这一节的镜头写了 closest 0.8，图是照 0.8 倍拍的，原样大小
    expect(lastOf(log, 'place')!.anchors).toEqual([
      { id: 's-town', x: -130 + 0.5 * 1200, y: 0.35 * 900, visible: true, foot: { x: -130 + 0.5 * 1200, y: 0.4 * 900 } },
      { id: 's-far', x: -130 + 0.3 * 1200, y: 0.7 * 900, visible: true, out: [-0.6, 0.8] },
    ]);
    expect(log[log.length - 1].op).toBe('place');
  });

  it('不要动画（animate: false）、读者设了“减少动态效果”、第一张图：直接换，不淡入', async () => {
    const plain = mount();
    await plain.view.ready;
    await plain.view.showSection(SECOND, { animate: false });
    expect(plain.images.waits).toEqual([]);
    expect(plain.pane.topPicture()!.className).toBe('still-picture is-top');
    expect(plain.pane.topPicture()!.src).toBe(fixtureStillUrl(2, 'wide'));

    const reduced = mount({ options: { reducedMotion: true } });
    await reduced.view.ready;
    await reduced.view.showSection(SECOND);
    expect(reduced.images.waits).toEqual([]);
    expect(reduced.pane.topPicture()!.src).toBe(fixtureStillUrl(2, 'wide'));

    // ready 完成之前叫的 showSection：直接摆到位，ready 等的是这一张
    const first = fixtureStillUrl(1, 'wide');
    const early = mount({ prepare: (i) => i.hold(first) });
    const going = early.view.showSection(SECOND);
    await going;
    await early.view.ready;
    expect(early.images.waits).toEqual([]);
    expect(early.pane.topPicture()!.src).toBe(fixtureStillUrl(2, 'wide'));
    early.images.release(first);
    await settle();
    expect(early.pane.topPicture()!.src).toBe(fixtureStillUrl(2, 'wide'));
  });

  it('途中又来新的指令：旧的那一次照常完成，但不摆它那一节', async () => {
    const second = fixtureStillUrl(2, 'wide');
    const { view, images, pane: p, log } = mount();
    await view.ready;
    images.hold(second);
    const abandoned = view.showSection(SECOND);
    expect(await stateOf(abandoned)).toBe('pending');
    const back = view.showSection(FIRST, { animate: false });
    expect(await stateOf(abandoned)).toBe('done');
    await back;
    images.release(second);
    await settle();
    expect(p.wrapper()!.attributes['data-still-section']).toBe(FIRST);
    expect(p.topPicture()!.src).toBe(fixtureStillUrl(1, 'wide'));
    expect(lastOf(log, 'set')!.ids).toEqual(['s-town', 's-river']);
  });

  it('淡入到一半又来新的指令：这一张直接淡完，新的一张照常换上', async () => {
    const { view, images, pane: p } = mount();
    await view.ready;
    images.holdWaits();
    const fading = view.showSection(SECOND);
    await settle();
    const next = view.showSection(FIRST);
    expect(await stateOf(fading)).toBe('done');
    await settle();
    images.releaseWaits();
    await next;
    expect(p.wrapper()!.attributes['data-still-section']).toBe(FIRST);
    expect(p.wrapper()!.children.filter((child) => child.tagName === 'img').map((img) => img.className).sort()).toEqual(['still-picture is-idle', 'still-picture is-top']);
  });

  it('只有场景里没有的小节标题才拒绝', async () => {
    const { view } = mount();
    await view.ready;
    await expect(view.showSection('没有这一节')).rejects.toThrow('场景里没有这个小节');
  });

  it('今名、古名：题签上的字换了，位置照旧', async () => {
    const { view, log } = mount();
    await view.ready;
    const before = lastOf(log, 'place')!.anchors;
    view.setNamesMode('modern');
    expect(lastOf(log, 'set')).toMatchObject({ ids: ['s-town', 's-river'], texts: ['样市', '样水'] });
    expect(log[log.length - 1]).toMatchObject({ op: 'place', anchors: before });
    view.setNamesMode('ancient');
    expect(lastOf(log, 'set')!.texts).toEqual(['样城', '样水']);
    // 换了小节以后还是今名
    view.setNamesMode('modern');
    await view.showSection(SECOND, { animate: false });
    expect(lastOf(log, 'set')!.texts).toEqual(['样市', '远镇']);
  });

  it('排法换了（窄屏转成宽屏）：换成另一种形状的那一张，题签重摆', async () => {
    const { view, images, pane: p, log } = mount({ width: 768, height: 573, shape: 'narrow', options: { insets: insetsOf(54, 131) } });
    await view.ready;
    expect(p.topPicture()!.src).toBe(fixtureStillUrl(1, 'narrow'));
    expect(p.wrapper()!.attributes['data-still-shape']).toBe('narrow');

    p.setShape('wide');
    p.setSize(940, 900);
    view.setInsets(insetsOf(62, 130));
    view.resize();
    await settle();
    expect(images.requests).toContain(fixtureStillUrl(1, 'wide'));
    expect(p.topPicture()!.src).toBe(fixtureStillUrl(1, 'wide'));
    expect(p.wrapper()!.attributes['data-still-shape']).toBe('wide');
    // 直接换，不淡入
    expect(images.waits).toEqual([]);
    expect(lastOf(log, 'place')).toMatchObject({ size: { width: 940, height: 900 }, insets: insetsOf(62, 130) });
    expect(lastOf(log, 'place')!.anchors[0]).toMatchObject({ id: 's-town', x: -130 + 0.42 * 1200, y: 0.44 * 900 });
  });

  it('容器大小变了：同一张图重新摆，题签跟着；没变就什么也不做', async () => {
    const { view, images, pane: p, log } = mount();
    await view.ready;
    const calls = log.length;
    const requests = images.requests.length;
    view.resize();
    expect(log.length).toBe(calls);

    // 1920 × 1080 的窗口：沙盘栏 1420 × 1080。图跟着栏的高放大到 1.2 倍，上面差 7 像素没铺到，盖一条过渡
    p.setSize(1420, 1080);
    view.resize();
    expect(images.requests.length).toBe(requests);
    const top = p.topPicture()!;
    expect(top.style).toMatchObject({ width: '1440px', height: '1080px', left: '-10px', top: '6.8px' });
    expect(p.fades()).toEqual(['top']);
    const fade = p.wrapper()!.children.find((child) => child.attributes['data-side'] === 'top')!;
    expect(fade.style).toMatchObject({ left: '0px', top: '6.8px', width: '1420px', height: '28px' });
    expect(fade.style.background).toBe('linear-gradient(to bottom, rgb(235, 227, 211), rgba(235, 227, 211, 0))');
    expect(lastOf(log, 'place')).toMatchObject({ size: { width: 1420, height: 1080 } });
    expect(lastOf(log, 'place')!.anchors[0].x).toBeCloseTo(-10 + 0.42 * 1440, 6);
    expect(lastOf(log, 'place')!.anchors[0].y).toBeCloseTo(6.8 + 0.44 * 1080, 6);
  });

  it('四边留的空变了：图跟着挪，题签重摆；没变就不动', async () => {
    const { view, pane: p, log } = mount();
    await view.ready;
    const calls = log.length;
    view.setInsets(insetsOf(62, 130));
    expect(log.length).toBe(calls);
    // 按钮下面多了一行说明：上面多留 34 像素，留出来的那一块的中心往下挪 17 像素
    view.setInsets(insetsOf(96, 130));
    expect(p.topPicture()!.style.top).toBe('17px');
    expect(p.wrapper()!.attributes['data-still-insets']).toBe('96 0 130 0');
    expect(lastOf(log, 'place')).toMatchObject({ insets: insetsOf(96, 130) });
    expect(lastOf(log, 'place')!.anchors[0].y).toBeCloseTo(17 + 0.44 * 900, 6);
  });

  it('收起来的沙盘栏（高是 0）：图照样取，先不摆；展开以后再摆', async () => {
    const { view, pane: p, log } = mount({ height: 0 });
    await view.ready;
    expect(p.topPicture()!.src).toBe(fixtureStillUrl(1, 'wide'));
    expect(log.some((call) => call.op === 'place')).toBe(false);
    p.setSize(940, 900);
    view.resize();
    expect(p.topPicture()!.style).toMatchObject({ left: '-130px', width: '1200px' });
    expect(lastOf(log, 'place')!.anchors).toHaveLength(2);
  });

  it('页面没说排法（开发用的单独一页）：自己挑一种形状', async () => {
    const wide = mount({ shape: '' });
    await wide.view.ready;
    expect(wide.pane.topPicture()!.src).toBe(fixtureStillUrl(1, 'wide'));
    const narrow = mount({ shape: '', width: 768, height: 573, options: { insets: insetsOf(54, 131) } });
    await narrow.view.ready;
    expect(narrow.pane.topPicture()!.src).toBe(fixtureStillUrl(1, 'narrow'));
  });

  it('换好一张以后，把后一节的那一张先取来；最后一节后面没有，取过的不再取', async () => {
    const { view, images } = mount();
    await view.ready;
    expect(images.requests).toEqual([fixtureStillUrl(1, 'wide'), fixtureStillUrl(2, 'wide')]);
    await view.showSection(SECOND, { animate: false });
    // 这一次是真的要用：再取一次（浏览器里已经有了，马上就到）；后面没有小节，不再先取
    expect(images.requests).toEqual([fixtureStillUrl(1, 'wide'), fixtureStillUrl(2, 'wide'), fixtureStillUrl(2, 'wide')]);
    await view.showSection(FIRST, { animate: false });
    expect(images.requests.slice(3)).toEqual([fixtureStillUrl(1, 'wide')]);
  });

  it('先取的那一张取不到不算事：不通知，也不影响现在这一张', async () => {
    const lost = vi.fn();
    const { view, images } = mount({ prepare: (i) => i.fail(fixtureStillUrl(2, 'wide')) });
    view.onLost(lost);
    await view.ready;
    await settle();
    expect(images.requests).toEqual([fixtureStillUrl(1, 'wide'), fixtureStillUrl(2, 'wide')]);
    expect(lost).not.toHaveBeenCalled();
  });

  it('指北和比例尺：订阅时已经有图就马上通知一次；换小节、图的大小变了再通知', async () => {
    const { view, pane: p } = mount();
    const early: StageViewInfo[] = [];
    view.onViewChange((info) => early.push(info));
    expect(early).toEqual([]);
    await view.ready;
    // 起初：正北朝上；一米 0.4 像素，原样大小
    expect(early).toEqual([{ northDeg: 0, scale: chooseScale(0.4) }]);
    expect(early[0].scale).toEqual({ px: 80, label: '200 米' });

    const late: StageViewInfo[] = [];
    const stop = view.onViewChange((info) => late.push(info));
    expect(late).toEqual([{ northDeg: 0, scale: { px: 80, label: '200 米' } }]);

    await view.showSection(SECOND, { animate: false });
    expect(late[late.length - 1]).toEqual({ northDeg: -20, scale: chooseScale(1.3) });
    // 栏高了一倍：图大了，比例尺跟着变
    p.setSize(1880, 1800);
    view.setInsets(insetsOf(124, 260));
    view.resize();
    expect(late[late.length - 1]).toEqual({ northDeg: -20, scale: chooseScale(2.6) });
    const seen = late.length;
    stop();
    await view.showSection(FIRST, { animate: false });
    expect(late.length).toBe(seen);
  });

  it('后来的一张图取不到（重试过一次）：通知 onLost，这一次照常完成，原来的图留着，之后不再做事', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const second = fixtureStillUrl(2, 'wide');
    const lost = vi.fn();
    const { view, images, pane: p, log } = mount();
    view.onLost(lost);
    await view.ready;
    await settle();
    images.fail(second);
    const requests = images.requests.length;
    await expect(view.showSection(SECOND)).resolves.toBeUndefined();
    expect(lost).toHaveBeenCalledTimes(1);
    // 取了两次，中间等了一会儿
    expect(images.requests.slice(requests)).toEqual([second, second]);
    expect(images.waits).toEqual([RETRY_AFTER_MS]);
    expect(warn).toHaveBeenCalled();
    expect(p.wrapper()!.attributes['data-still-section']).toBe(FIRST);
    expect(p.topPicture()!.src).toBe(fixtureStillUrl(1, 'wide'));
    expect(lastOf(log, 'set')!.ids).toEqual(['s-town', 's-river']);
    // 之后的指令照常完成，不再去取，也不再通知
    const after = images.requests.length;
    await expect(view.showSection(SECOND)).resolves.toBeUndefined();
    await expect(view.showSection(FIRST)).resolves.toBeUndefined();
    expect(images.requests.length).toBe(after);
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('第一次没取到、重试取到了：照常换上，不通知', async () => {
    const second = fixtureStillUrl(2, 'wide');
    const lost = vi.fn();
    const { view, images, pane: p } = mount();
    view.onLost(lost);
    await view.ready;
    await settle();
    images.fail(second, 1);
    await view.showSection(SECOND, { animate: false });
    expect(lost).not.toHaveBeenCalled();
    expect(images.waits).toEqual([RETRY_AFTER_MS]);
    expect(p.topPicture()!.src).toBe(second);
  });

  it('第一张图就取不到（重试过一次）：ready 拒绝，不通知 onLost', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = fixtureStillUrl(1, 'wide');
    const lost = vi.fn();
    const { view, images, pane: p, log } = mount({ prepare: (i) => i.fail(first) });
    view.onLost(lost);
    await expect(view.ready).rejects.toThrow('定格图取不到');
    expect(images.requests).toEqual([first, first]);
    expect(lost).not.toHaveBeenCalled();
    expect(p.topPicture()).toBeUndefined();
    expect(log.some((call) => call.op === 'set')).toBe(false);
    await expect(view.showSection(SECOND)).resolves.toBeUndefined();
    expect(images.requests).toEqual([first, first]);
  });

  it('关掉：自己添的都拿走，还在路上的指令照常完成；之后 showSection、resetView 拒绝，别的不做事，可以重复关', async () => {
    const second = fixtureStillUrl(2, 'wide');
    const { view, images, pane: p, log } = mount();
    await view.ready;
    images.hold(second);
    const going = view.showSection(SECOND);
    view.destroy();
    await expect(going).resolves.toBeUndefined();
    expect(p.node.children).toEqual([]);
    expect(log[log.length - 1].op).toBe('destroy');
    images.release(second);
    await settle();
    expect(p.node.children).toEqual([]);
    const calls = log.length;
    view.setNamesMode('modern');
    view.setInsets(insetsOf(1, 2));
    view.resize();
    view.destroy();
    expect(log.length).toBe(calls);
    await expect(view.showSection(FIRST)).rejects.toThrow('已经关掉');
    await expect(view.resetView()).rejects.toThrow('已经关掉');
  });

  it('还没等到第一张图就关掉：ready 照常完成，不算失败', async () => {
    const first = fixtureStillUrl(1, 'wide');
    const { view, images, pane: p } = mount({ prepare: (i) => i.hold(first) });
    view.destroy();
    await expect(view.ready).resolves.toBeUndefined();
    images.release(first);
    await settle();
    expect(p.node.children).toEqual([]);
  });

  it('读者动镜头、太慢：定格图从不通知', async () => {
    const { view } = mount();
    const moved = vi.fn();
    const slow = vi.fn();
    const stopMoved = view.onUserMoved(moved);
    const stopSlow = view.onSlow(slow);
    await view.ready;
    await view.showSection(SECOND, { animate: false });
    await view.resetView();
    expect(moved).not.toHaveBeenCalled();
    expect(slow).not.toHaveBeenCalled();
    stopMoved();
    stopSlow();
  });

  it('每一步都只通过 StopStageView 的接口：类型上就是它', () => {
    const { view } = mount();
    const typed: StopStageView = view;
    expect(typeof typed.showSection).toBe('function');
    view.destroy();
  });
});

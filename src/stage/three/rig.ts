// 镜头和题签的几何：一小节的镜头摆在哪、画面窄了退多远、影子罩多大一块、题签指着的那一点在哪、
// 那一点落在画面的哪里、指北针转多少、比例尺取多长。
// 全是算数：只用 three 的向量和矩阵，不碰画布和页面，在 Node 里也能跑（tests/stage/rig.test.ts）。
//
// 坐标：沙盘里的米，x 向东，z 向南，y 向上（y 已经乘过山高夸大的倍数）。经纬度只用 FrameCoords 换。
// 远近：模型放大多少、题签跟着抬多高，看的是“折算过的远近 D”（equivalentDistance），不是镜头离多少米——
// 同一个镜头，画面矮了东西就小，D 就大。

import { MathUtils, Vector3, type Camera, type PerspectiveCamera } from 'three';
import type { RouteScene, RouteSection, SceneCamera, SceneRapids, SceneSection, SceneStrip, SceneThing, StopScene, TableScene, ThingKind } from '../../domain/scene';
import { farEdgePoint, type FrameCoords } from '../../domain/sceneGeo';
import { stripPoint } from '../../domain/sceneStripPoint';
import type { LngLat } from '../../domain/types';
import { gateSeats } from '../ground';
import type { GroundSamplers, Vec2, Vec3 } from '../ground/types';
import type { StripInput } from '../overlay/types';
import type { StageInsets } from '../types';
import type { FigureClass, StageStyle } from './internal';
import { equivalentDistance, figureGroups, figureNow, figureTimes, liftClass, type FigureGroup } from './kit/figure';
import { distSeg } from './kit/util';
import { STAND_REACH, STAND_REACH_Y } from './table';

// 折算过的远近 D 怎么算在 kit/figure.ts（它不碰 three）；镜头这一边也从这里取，别处说“rig.ts 的 equivalentDistance”就是它。
export { equivalentDistance };

/** 场景里没写视角时用的度数。 */
export const DEFAULT_FOV = 21;
/** 画面窄了，镜头最多退到写的距离的几倍。 */
export const MAX_FIT = 2.5;
/** 要看的点离留出来的那一块的边至少这么多像素，才算看得见。定格图照同一个数摆（清单里记着）。 */
export const FIT_MARGIN_PX = 12;
/** 倾角太接近正俯视时镜头分不出上下，最小按这么多度算。 */
const MIN_PITCH = 1;
/** 要看的一道城墙，墙脚和角台比墙的中线往外多出这么多米（墙身有厚度，墙角的角台更宽）：它们也要在画面里。 */
const WALL_FOOT_OUT_M = 60;
/** 没说画面多高时当它是 900 像素（定稿样张的高）：视角 21 度时，折算过的远近就是镜头离多少米。 */
const REFERENCE_VIEW_HEIGHT_PX = 900;

const NO_INSETS: StageInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** 镜头的位置：对准哪一点，镜头在哪，视角多少度。 */
export interface Pose {
  target: Vec3;
  position: Vec3;
  fov: number;
}

// ---------------------------------------------------------------- 镜头摆在哪

/** 朝 bearing 看、倾角 pitch 时，镜头自己的三个方向：右、上、前（长度都是 1）。 */
function basis(camera: SceneCamera): { right: Vec3; up: Vec3; forward: Vec3 } {
  const b = MathUtils.degToRad(camera.bearing);
  const p = MathUtils.degToRad(Math.max(MIN_PITCH, camera.pitch));
  const sb = Math.sin(b);
  const cb = Math.cos(b);
  const sp = Math.sin(p);
  const cp = Math.cos(p);
  return {
    right: [cb, 0, sb],
    up: [sb * cp, sp, -cb * cp],
    forward: [sb * sp, -cp, -cb * sp],
  };
}

/**
 * 一小节的镜头摆在哪。groundY 是对准的那一点的地面在沙盘里的高度（coords.y(地面的海拔)）。
 * distanceM 不写就用场景里写的距离；画面窄了要退远时，把 fitDistance 算出来的数传进来。
 *
 * 和样张的写法是一回事：朝向 bearing = (360 − az) mod 360，倾角 pitch = 90 − el。
 */
export function pose(camera: SceneCamera, coords: FrameCoords, groundY: number, distanceM: number = camera.distanceM): Pose {
  const [x, z] = coords.toLocal(camera.target);
  // 对准的点比地面高 targetUpM 米（真实的米）：换成沙盘里的高度要乘夸大的倍数。
  const up = coords.y(camera.targetUpM ?? 0) - coords.y(0);
  const target: Vec3 = [x, groundY + up, z];
  const { forward } = basis(camera);
  return {
    target,
    position: [target[0] - forward[0] * distanceM, target[1] - forward[1] * distanceM, target[2] - forward[2] * distanceM],
    fov: camera.fov ?? DEFAULT_FOV,
  };
}

/** 同上，对准的那一点的地面高度自己从地面上取。 */
export function poseOn(camera: SceneCamera, ground: GroundSamplers, coords: FrameCoords, distanceM?: number): Pose {
  const [x, z] = coords.toLocal(camera.target);
  return pose(camera, coords, coords.y(ground.height(x, z)), distanceM);
}

/** 镜头照场景里写的朝向、倾角、视角，对准沙盘里的 target 这一点，离它 distanceM 米。 */
export function poseAt(camera: SceneCamera, target: Vec3, distanceM: number): Pose {
  const { forward } = basis(camera);
  return {
    target,
    position: [target[0] - forward[0] * distanceM, target[1] - forward[1] * distanceM, target[2] - forward[2] * distanceM],
    fov: camera.fov ?? DEFAULT_FOV,
  };
}

/**
 * 四边留出来以后，画面的中心要往右、往下挪多少像素（留出来的那一块的中心相对整个画面的中心）。
 * 镜头对准的那一点就落在挪过以后的中心上。
 */
export function centreShift(insets: StageInsets = NO_INSETS): Vec2 {
  return [(insets.left - insets.right) / 2, (insets.top - insets.bottom) / 2];
}

/**
 * 镜头要离对准的那一点多远，是场景里写的距离的几倍。
 * 一开始是 1。points 里有一点落在画面留出来的那一块外面，才退远，退到都看得见为止，最多 MAX_FIT 倍；
 * 场景里写了 closest（比如 0.8）而且各点都还看得见时，才靠近，最多靠近到 closest 倍。
 *
 * target 是 pose() 算出来的对准的那一点；points 是这一节一定要看得见的点（见 showPoints）。
 * 这里算的是把画面中心挪到留出来的那一块中间以后的结果（见 centreShift）。
 */
export function fitFactor(
  camera: SceneCamera,
  target: Vec3,
  points: Vec3[],
  size: { width: number; height: number },
  insets: StageInsets = NO_INSETS,
): number {
  if (points.length === 0) return 1;
  const { right, up, forward } = basis(camera);
  const fov = MathUtils.degToRad(camera.fov ?? DEFAULT_FOV);
  // 离镜头 1 米远、1 米宽的东西在画面上多少像素
  const focal = Math.max(1, size.height) / 2 / Math.tan(fov / 2);
  const halfW = Math.max(16, (size.width - insets.left - insets.right) / 2 - FIT_MARGIN_PX);
  const halfH = Math.max(16, (size.height - insets.top - insets.bottom) / 2 - FIT_MARGIN_PX);

  // 每一点各要镜头离多远才进得了画面，取最远的那个
  let needed = 0;
  for (const p of points) {
    const wx = p[0] - target[0];
    const wy = p[1] - target[1];
    const wz = p[2] - target[2];
    const across = Math.abs(wx * right[0] + wy * right[1] + wz * right[2]);
    const upward = Math.abs(wx * up[0] + wy * up[1] + wz * up[2]);
    const ahead = wx * forward[0] + wy * forward[1] + wz * forward[2];
    needed = Math.max(needed, Math.max((across * focal) / halfW, (upward * focal) / halfH) - ahead, 1 - ahead);
  }

  const ratio = needed / camera.distanceM;
  if (ratio > 1) return Math.min(ratio, MAX_FIT);
  const closest = Math.min(1, camera.closest ?? 1);
  return Math.max(ratio, closest);
}

/** 镜头要离对准的那一点多少米：场景里写的距离乘 fitFactor。 */
export function fitDistance(
  camera: SceneCamera,
  target: Vec3,
  points: Vec3[],
  size: { width: number; height: number },
  insets: StageInsets = NO_INSETS,
): number {
  return camera.distanceM * fitFactor(camera, target, points, size, insets);
}

/** 这一节是不是看整块沙盘（mustShow 里写了 'frame'）。 */
export function wholeTable(section: { camera: SceneCamera }): boolean {
  return section.camera.mustShow?.includes('frame') ?? false;
}

/**
 * 看整块沙盘的一节，镜头对准哪一点、离多远：把对准的那一点在地面上挪一挪，
 * 让 points（整块沙盘，连座子）在画面留出来的那一块里上下左右都居中，再按 fitFactor 定远近。
 * 只对准场景里写的那一点的话，沙盘斜着看是上窄下宽的，上面会空出一条，画面窄了尤其明显。
 * target 是照场景里写的算出来的对准点（见 pose）；返回挪过以后的对准点（高度不变）和镜头离它多少米。
 */
export function centredView(
  camera: SceneCamera,
  target: Vec3,
  points: Vec3[],
  size: { width: number; height: number },
  insets: StageInsets = NO_INSETS,
): { target: Vec3; distanceM: number } {
  const { right, up, forward } = basis(camera);
  const fov = MathUtils.degToRad(camera.fov ?? DEFAULT_FOV);
  const focal = Math.max(1, size.height) / 2 / Math.tan(fov / 2);
  // 镜头的“上”在地面上的方向（长度为 1），和它同“上”的夹角的余弦
  const flat = Math.hypot(up[0], up[2]) || 1;
  const along: Vec3 = [up[0] / flat, 0, up[2] / flat];
  let at: Vec3 = [target[0], target[1], target[2]];
  let distanceM = fitDistance(camera, at, points, size, insets);
  if (points.length === 0) return { target: at, distanceM };
  // 挪一次，沙盘在画面上的大小跟着变一点，所以多挪几次，挪到差不到半个像素为止
  for (let round = 0; round < 8; round++) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      const wx = p[0] - at[0];
      const wy = p[1] - at[1];
      const wz = p[2] - at[2];
      const depth = Math.max(1, distanceM + wx * forward[0] + wy * forward[1] + wz * forward[2]);
      const x = ((wx * right[0] + wy * right[1] + wz * right[2]) * focal) / depth;
      const y = ((wx * up[0] + wy * up[1] + wz * up[2]) * focal) / depth;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const offX = (minX + maxX) / 2;
    const offY = (minY + maxY) / 2;
    if (Math.abs(offX) < 0.5 && Math.abs(offY) < 0.5) break;
    const dx = (offX * distanceM) / focal;
    const dy = (offY * distanceM) / focal / flat;
    at = [at[0] + right[0] * dx + along[0] * dy, at[1], at[2] + right[2] * dx + along[2] * dy];
    distanceM = fitDistance(camera, at, points, size, insets);
  }
  return { target: at, distanceM };
}

/**
 * 镜头照 camera 的朝向、倾角、视角对准 target、离它 distanceM 米时，points 在画面上离对准的那一点
 * （就是留出来的那一块的中心）最远多少像素：[横, 竖]。定格图换一种大小的画面摆时，靠这两个数算镜头该退多远。
 */
export function reachOf(camera: SceneCamera, target: Vec3, distanceM: number, points: Vec3[], viewHeightPx: number): [number, number] {
  const { right, up, forward } = basis(camera);
  const fov = MathUtils.degToRad(camera.fov ?? DEFAULT_FOV);
  const focal = Math.max(1, viewHeightPx) / 2 / Math.tan(fov / 2);
  let across = 0;
  let upward = 0;
  for (const p of points) {
    const wx = p[0] - target[0];
    const wy = p[1] - target[1];
    const wz = p[2] - target[2];
    const depth = Math.max(1, distanceM + wx * forward[0] + wy * forward[1] + wz * forward[2]);
    across = Math.max(across, (Math.abs(wx * right[0] + wy * right[1] + wz * right[2]) * focal) / depth);
    upward = Math.max(upward, (Math.abs(wx * up[0] + wy * up[1] + wz * up[2]) * focal) / depth);
  }
  return [across, upward];
}

/** 一小节的镜头在某一种大小的画面上摆好以后的样子。 */
export interface PlacedCamera {
  /** 镜头的位置（画面窄了已经退过；看整块沙盘的一节，对准的那一点已经挪过）。 */
  pose: Pose;
  /** 镜头离对准的那一点多少米。 */
  distanceM: number;
  /** 这个距离是场景里写的距离的几倍。 */
  fit: number;
  /** 这一节一定要看得见的点（见 showPoints）。 */
  points: Vec3[];
  /** 这些点离留出来的那一块的中心最远多少像素：[横, 竖]（见 reachOf）。 */
  reach: [number, number];
}

/**
 * 一小节的镜头在 size 这么大、四边留了 insets 的画面上摆在哪：先按场景里写的距离摆，看要看的点在不在
 * 留出来的那一块里，画面窄了就退远；看整块沙盘的一节，对准的那一点再挪一挪，让沙盘居中。
 * 页面上的沙盘（view.ts）、镜头和题签的测试、定格图的测试都用这一个函数，几边才对得上。
 */
export function placeCamera(
  section: SceneSection | RouteSection,
  scene: TableScene,
  ground: GroundSamplers,
  coords: FrameCoords,
  style: StageStyle,
  size: { width: number; height: number },
  insets: StageInsets = NO_INSETS,
): PlacedCamera {
  const camera = section.camera;
  const authored = poseOn(camera, ground, coords);
  const points = showPoints(section, scene, ground, coords, style, size.height);
  const fitted = wholeTable(section)
    ? centredView(camera, authored.target, points, size, insets)
    : { target: authored.target, distanceM: fitDistance(camera, authored.target, points, size, insets) };
  return {
    pose: poseAt(camera, fitted.target, fitted.distanceM),
    distanceM: fitted.distanceM,
    fit: fitted.distanceM / camera.distanceM,
    points,
    reach: reachOf(camera, fitted.target, fitted.distanceM, points, size.height),
  };
}

// ---------------------------------------------------------------- 影子

/**
 * 影子罩多大一块：一个方块，half 是半边长（米）。
 * 镜头近，罩得小，影子才细；最小 1250，最大到沙盘对角线的一半再加上装裱那一圈（整块沙盘，连它落在装裱上的影子，都罩得住）。
 * 中心平常是镜头对准的那一点（出了沙盘就取边上最近的一点）。罩得快有整块沙盘那么大时，中心往沙盘的正中靠，到头时就是正中：
 * 不然离对准的那一点远的那一角落在方块外面，沙盘的边落在装裱上的那一道影子画到半截就断了。
 */
export function shadowBox(targetXZ: Vec2, distanceM: number, coords: FrameCoords): { centre: Vec2; half: number } {
  const whole = Math.hypot(coords.x1 - coords.x0, coords.z1 - coords.z0) / 2 + STAND_REACH;
  const half = MathUtils.clamp(0.56 * distanceM, 1250, whole);
  const toMiddle = MathUtils.smoothstep(half, 0.6 * whole, whole);
  const x = MathUtils.clamp(targetXZ[0], coords.x0, coords.x1);
  const z = MathUtils.clamp(targetXZ[1], coords.z0, coords.z1);
  return {
    centre: [MathUtils.lerp(x, (coords.x0 + coords.x1) / 2, toMiddle), MathUtils.lerp(z, (coords.z0 + coords.z1) / 2, toMiddle)],
    half,
  };
}

/**
 * 影子的虚实和偏移，按影子罩多大一块（shadowBox 的半边长，米）来定：罩得小（贴近了看）影子边要虚一点、偏移要小；
 * 罩得大就是平常的数。radius 是影子边缘虚化的半径；bias 是偏移，防止表面上出条纹；
 * normalBias 是沿法线的偏移，单位是影子贴图上的一个点在地面上有多大（用的时候乘上去）。
 * 两头是样张的数：半边长 1250 是贴近了看黄楼那个镜头的（3、−0.0002、0.6），3300 以上是平常的（2.2、−0.0006、1.6），中间匀着过渡。
 */
export function shadowTuning(halfM: number): { radius: number; bias: number; normalBias: number } {
  const t = MathUtils.smoothstep(halfM, 1250, 3300);
  return { radius: 3 - 0.8 * t, bias: -0.0002 - 0.0004 * t, normalBias: 0.6 + t };
}

// ---------------------------------------------------------------- 题签指着的那一点

/** 贴在底下那样东西旁边、不是摆在它上面的零件：堤写了 on 是贴在城墙里侧，土坡是贴在外侧。 */
const BESIDE_HOST: readonly ThingKind[] = ['dike', 'bank'];

/** id 这样东西挨着哪一座单座的小建筑、跟着它整组放大（见 kit/figure.ts 的 figureGroups）；它自己是主角或者不在哪一组里时是 undefined。 */
function groupWith(id: string, groups: FigureGroup[]): FigureGroup | undefined {
  return groups.find((g) => g.members.includes(id));
}

/** 这样摆件的大小跟着哪一类变：跟着一座小建筑整组放大的用那一组的类，别的照 liftClass。 */
function classOf(thing: SceneThing, scene: StopScene, groups: FigureGroup[]): FigureClass | null {
  return groupWith(thing.id, groups)?.cls ?? liftClass(thing, scene);
}

/** 抬高怎么算（见 liftOf）；groups 是这座沙盘上整组放大的小建筑，算一次传进来。 */
function liftIn(id: string, scene: StopScene, style: StageStyle, D: number, groups: FigureGroup[]): number {
  const byId = (thingId: string): SceneThing | undefined => scene.things.find((t) => t.id === thingId);
  const seen = new Set<string>();
  let lift = 0;
  let thing = byId(id);
  while (thing && !seen.has(thing.id)) {
    seen.add(thing.id);
    const cls = classOf(thing, scene, groups);
    // 这一类模型另写了数的（墙顶上的棚子）用它自己的；乘的倍数还是照 cls（整组放大的跟着那一组）
    const own = liftClass(thing, scene);
    const base = (own ? style.stripLiftByClass?.[own] : undefined) ?? style.stripLift[thing.kind];
    lift += base * (cls ? figureTimes(style, cls, D) : 1);
    if (!thing.on || BESIDE_HOST.includes(thing.kind)) break;
    thing = byId(thing.on);
  }
  return lift;
}

/**
 * 题签指着 id 这样东西时，比它脚下的地面抬高多少（沙盘里的米）。D 是折算过的远近。
 * 摆件按样式里各种零件的数，乘上这一类模型在 D 这么远时放大的倍数（模型大了，它的顶也高了）；
 * 摆在别的东西上面的，加上底下那样东西的数（楼在城门上，城门在城墙上），每一环各乘各的倍数。
 * 不是摆件（地名点、河、急滩、点缀、远处）就是 0：贴着地面。
 */
export function liftOf(id: string, scene: StopScene, style: StageStyle, D: number): number {
  return liftIn(id, scene, style, D, figureGroups(scene, style));
}

/** id 这样东西要是跟着一座小建筑整组放大，[x, z] 这一点跟着从那座小建筑的脚摊开以后在哪；不是就原样。 */
function spreadWith(id: string, [x, z]: Vec2, coords: FrameCoords, style: StageStyle, D: number, groups: FigureGroup[]): Vec2 {
  const group = groupWith(id, groups);
  if (!group) return [x, z];
  const [gx, gz] = coords.toLocal(group.at);
  const { spread } = figureNow(style.figure.rules[group.cls], D);
  return [gx + (x - gx) * spread, gz + (z - gz) * spread];
}

/** 沙盘里 [x, z] 这一点脚下多高。取地面和平时水面里高的那个（河上的点落在水面上，不落在河床上）。 */
function footY([x, z]: Vec2, scene: StopScene, ground: GroundSamplers, coords: FrameCoords): number {
  return coords.y(Math.max(ground.height(x, z), scene.water.levels.values.normal ?? -Infinity));
}

/** 沙盘里的一点 [x, z] 抬高 lift 以后的位置。 */
function lifted(at: Vec2, lift: number, scene: StopScene, ground: GroundSamplers, coords: FrameCoords): Vec3 {
  return [at[0], footY(at, scene, ground, coords) + lift, at[1]];
}

/**
 * id 这样摆件是一座城门，或者摆在城门上（城楼）：城门真正落在的那一点（沙盘里的 [x, z]）。别的东西是 null。
 * 城门写偏了、写得离墙角太近时，模型是照 gateSeats 挪过的，题签也要指着挪过以后的地方。
 */
function seatOf(id: string, scene: StopScene, coords: FrameCoords): Vec2 | null {
  const byId = (thingId: string): SceneThing | undefined => scene.things.find((t) => t.id === thingId);
  const seen = new Set<string>();
  let thing = byId(id);
  while (thing && !seen.has(thing.id)) {
    if (thing.kind === 'gate') return gateSeats(scene, coords).get(thing.id) ?? null;
    seen.add(thing.id);
    thing = thing.on ? byId(thing.on) : undefined;
  }
  return null;
}

/** 一条题签指着的那一点在沙盘里的位置，和投到画面上要用的另外两样。 */
export interface StripSpot {
  /** 题签的 id。 */
  id: string;
  /** 指着的那一点（已经抬高）。 */
  at: Vec3;
  /** 那一点脚下的地面多高；没有抬高过的是 null。 */
  footY: number | null;
  /** 指的是不是沙盘外面的远处（题签要朝沙盘外面摆）。 */
  far: boolean;
}

function spotOf(strip: SceneStrip, scene: StopScene, ground: GroundSamplers, coords: FrameCoords, style: StageStyle, D: number, groups: FigureGroup[]): StripSpot {
  const lift = liftIn(strip.of, scene, style, D, groups);
  const seat = strip.at ? null : seatOf(strip.of, scene, coords);
  const at = spreadWith(strip.of, seat ?? coords.toLocal(stripPoint(scene, strip)), coords, style, D, groups);
  const foot = footY(at, scene, ground, coords);
  return { id: strip.id, at: [at[0], foot + lift, at[1]], footY: lift > 0 ? foot : null, far: scene.far.some((f) => f.id === strip.of) };
}

/**
 * 这几条题签各指着沙盘里的哪一点。D 是折算过的远近：模型跟着 D 放大，题签指着的那一点也跟着抬高、跟着挪。
 * 只跟 D 有关，跟镜头朝哪边没有关系：镜头转的时候不用重算，再投一遍（projectSpots）就行。
 */
export function stripSpots(strips: SceneStrip[], scene: TableScene, ground: GroundSamplers, coords: FrameCoords, style: StageStyle, D: number): StripSpot[] {
  if (scene.level === 'route') return strips.map((strip) => routeSpot(strip, scene, ground, coords));
  const groups = figureGroups(scene, style);
  return strips.map((strip) => spotOf(strip, scene, ground, coords, style, D, groups));
}

/**
 * 一条题签指着的那一点在沙盘里的位置。D 是折算过的远近（equivalentDistance）。
 * 平面上的位置用 src/domain/sceneStripPoint.ts 的 stripPoint（远处的题签落在沙盘边上）；高度是那里的地面加上抬高（见 liftOf）。
 * 题签自己没有写 at、指的又是城门或城门上的楼时，用城门真正落在的那一点（见 seatOf）。
 * 指的东西要是跟着一座小建筑整组放大（亭下的小屋跟着亭），那一点跟着从小建筑的脚摊开。
 */
export function anchorOf(strip: SceneStrip, scene: StopScene, ground: GroundSamplers, coords: FrameCoords, style: StageStyle, D: number): Vec3 {
  return spotOf(strip, scene, ground, coords, style, D, figureGroups(scene, style)).at;
}

// ---------------------------------------------------------------- 全程沙盘

/** 沙盘里 [x, z] 这一点在全程沙盘上多高：地面和海面里高的那个。 */
function routeFootY([x, z]: Vec2, scene: RouteScene, ground: GroundSamplers, coords: FrameCoords): number {
  return coords.y(Math.max(ground.height(x, z), scene.water.levels.values.normal ?? -Infinity));
}

/** 全程沙盘上一条题签指着的那一点：没有摆件，贴着地面，不抬高。 */
function routeSpot(strip: SceneStrip, scene: RouteScene, ground: GroundSamplers, coords: FrameCoords): StripSpot {
  const at = coords.toLocal(stripPoint(scene, strip));
  return { id: strip.id, at: [at[0], routeFootY(at, scene, ground, coords), at[1]], footY: null, far: scene.far.some((f) => f.id === strip.of) };
}

/**
 * 全程沙盘上 mustShow 里的一个 id 指的是哪几个点（经纬度）。找不到就是空的（校验规则 14 管这个）。
 * 地名点是它自己；自己写了线的河是沙盘里面的那几点；只染水色的水是它的圈；一趟路是它走的每一截路上的每个点；
 * 远处是头一条指着它的题签的 at（路出沙盘的那一点）。照今天的数据画的河和湖这里没有线可取，给不出点：要看它，写它旁边的地名点。
 */
function routePointsOfItem(id: string, scene: RouteScene, coords: FrameCoords): LngLat[] {
  const place = scene.places.find((p) => p.id === id);
  if (place) return [place.at];
  const river = scene.water.rivers.find((r) => r.id === id);
  if (river) return (river.line ?? []).filter((p) => coords.inside(p));
  const wash = scene.water.washes.find((w) => w.id === id);
  if (wash) return wash.areas.flat();
  const journey = scene.roads.journeys.find((j) => j.id === id);
  if (journey) {
    return journey.parts.flatMap((part) => part.ways.flatMap((written) => scene.roads.ways.find((w) => w.id === (written.startsWith('-') ? written.slice(1) : written))?.line ?? []));
  }
  if (scene.far.some((f) => f.id === id)) {
    const at = scene.strips.find((s) => s.of === id && s.at)?.at;
    return at ? [at] : [];
  }
  return [];
}

/**
 * 全程沙盘上这一小节画面再窄也要看得见的点。和站点沙盘一样：写了 mustShow 就是那几样东西的点（'frame' 是整块沙盘），
 * 没写就是这一节各条题签指着的点。有一处不同：写了 mustShow、又不是看整块沙盘的一节，这一节各条题签指着的点也算进去——
 * 全程沙盘上河的题签指在河上的一点，mustShow 里写不了“这一点”，写河又会把整条河都算进来。
 */
function routeShowPoints(section: RouteSection, scene: RouteScene, ground: GroundSamplers, coords: FrameCoords): Vec3[] {
  const strips = section.strips.map((id) => scene.strips.find((s) => s.id === id)).filter((s): s is SceneStrip => s !== undefined);
  const spots = strips.map((strip) => routeSpot(strip, scene, ground, coords).at);
  const mustShow = section.camera.mustShow;
  if (!mustShow) return spots;
  const points: Vec3[] = [];
  for (const id of mustShow) {
    if (id === 'frame') {
      points.push(...framePoints(coords));
      continue;
    }
    for (const p of routePointsOfItem(id, scene, coords)) {
      const at = coords.toLocal(p);
      points.push([at[0], routeFootY(at, scene, ground, coords), at[1]]);
    }
  }
  return mustShow.includes('frame') ? points : [...points, ...spots];
}

// ---------------------------------------------------------------- 一定要看得见的点

/** mustShow 里的一个 id 指的是哪几个点（经纬度）。找不到就是空的（校验规则 14 管这个）。 */
function pointsOfItem(id: string, scene: StopScene, coords: FrameCoords): LngLat[] {
  const thing = scene.things.find((t) => t.id === id);
  if (thing) return thing.at ? [thing.at] : (thing.line ?? []);
  const place = scene.places.find((p) => p.id === id);
  if (place) return [place.at];
  const far = scene.far.find((f) => f.id === id);
  if (far) return [farEdgePoint(scene.frame, far.at).point];
  const rapids = scene.water.rapids.find((r) => r.id === id);
  if (rapids) return [rapids.at];
  const river = scene.water.rivers.find((r) => r.id === id);
  // 河可以伸到沙盘外面：只管沙盘里面的那几点
  if (river) return river.line.filter((p) => coords.inside(p));
  const dressing = scene.dressing.find((d) => d.id === id);
  if (dressing) {
    if (dressing.at) return [dressing.at];
    if (dressing.line) return dressing.line.filter((p) => coords.inside(p));
    if (dressing.area) return dressing.area;
    if (dressing.inside) return pointsOfItem(dressing.inside, scene, coords);
  }
  return [];
}

/**
 * 一段急滩的上下两头（沙盘里的 [x, z]）：从它写的那一点顺着河的中线，往两边各走半段的长（lengthM 的一半）。
 * 河往哪边流，取场景里这条河的中线上离急滩最近的那一段。找不到这条河就没有两头。
 */
function rapidsEnds(rapids: SceneRapids, scene: StopScene, coords: FrameCoords): Vec2[] {
  const line = (scene.water.rivers.find((r) => r.id === rapids.river)?.line ?? []).map((p) => coords.toLocal(p));
  const [x, z] = coords.toLocal(rapids.at);
  let dir: Vec2 | null = null;
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len === 0) continue;
    const d = distSeg(x, z, ax, az, bx, bz);
    if (d < best) {
      best = d;
      dir = [(bx - ax) / len, (bz - az) / len];
    }
  }
  if (!dir) return [];
  const half = rapids.lengthM / 2;
  return [
    [x - dir[0] * half, z - dir[1] * half],
    [x + dir[0] * half, z + dir[1] * half],
  ];
}

/**
 * “整块沙盘”是哪几个点：沙盘的四个角，加上座子最宽那一圈的四个角。
 * 连座子一起算，是因为定稿的样张看整块沙盘时座子是完整的；只算沙盘的四个角，镜头会贴到座子被画面的边切掉。
 */
export function framePoints(coords: FrameCoords): Vec3[] {
  const { x0, x1, z0, z1 } = coords;
  const r = STAND_REACH;
  const y = STAND_REACH_Y;
  return [
    [x0, 0, z0],
    [x1, 0, z0],
    [x1, 0, z1],
    [x0, 0, z1],
    [x0 - r, y, z0 - r],
    [x1 + r, y, z0 - r],
    [x1 + r, y, z1 + r],
    [x0 - r, y, z1 + r],
  ];
}

/**
 * 这一小节画面再窄也要看得见的点（fitFactor 的 points）。
 * 镜头写了 mustShow 就是那几样东西的点（'frame' 是整块沙盘，见 framePoints）；没写就是这一节各条题签指着的点。
 * mustShow 里的每样东西，顶上（题签指着的高度）和脚下（地面）各算一点：只算顶上的话，镜头斜着看，
 * 它的脚会落到画面留出来的那一块外面，压在题记底下。城墙的脚再往外挪一截（墙身有厚度）。一段急滩上下两头各算一点（见 rapidsEnds）。
 *
 * 抬多高跟模型放大多少有关，放大多少又跟镜头最后退到多远有关。这里不来回算：抬高一律按
 * “场景里写的距离、现在这么高的画面”折算出来的远近算一次（viewHeightPx 是画面的高，不写当 900）。
 * 镜头退远以后模型还会再大一点；各种画面上题签指着的点是不是还在留出来的那一块里，由 tests/stage/scene-cameras.test.ts 查。
 */
export function showPoints(
  section: SceneSection | RouteSection,
  scene: TableScene,
  ground: GroundSamplers,
  coords: FrameCoords,
  style: StageStyle,
  viewHeightPx: number = REFERENCE_VIEW_HEIGHT_PX,
): Vec3[] {
  if (scene.level === 'route') return routeShowPoints(section as RouteSection, scene, ground, coords);
  const D = equivalentDistance(section.camera.distanceM, section.camera.fov ?? DEFAULT_FOV, viewHeightPx);
  const mustShow = section.camera.mustShow;
  if (!mustShow) {
    const strips = section.strips.map((id) => scene.strips.find((s) => s.id === id)).filter((s): s is SceneStrip => s !== undefined);
    return stripSpots(strips, scene, ground, coords, style, D).map((spot) => spot.at);
  }
  const groups = figureGroups(scene, style);
  const points: Vec3[] = [];
  for (const id of mustShow) {
    if (id === 'frame') {
      points.push(...framePoints(coords));
      continue;
    }
    const lift = liftIn(id, scene, style, D, groups);
    const spots = pointsOfItem(id, scene, coords).map((p): Vec2 => spreadWith(id, coords.toLocal(p), coords, style, D, groups));
    for (const p of spots) points.push(lifted(p, lift, scene, ground, coords));
    // 急滩是一段河，不是一个点：上下两头也算。只算中间那一点，画面窄了镜头退到那一点刚进画面就停，乱石滩有一截还在画面外面
    const rapids = scene.water.rapids.find((r) => r.id === id);
    if (rapids) for (const end of rapidsEnds(rapids, scene, coords)) points.push(lifted(end, 0, scene, ground, coords));
    if (lift <= 0) continue;
    // 脚下的点。城墙是一圈：从这一圈的中心往外挪，挪到墙脚外面
    const wall = scene.things.find((t) => t.id === id)?.kind === 'wall';
    const cx = spots.reduce((s, p) => s + p[0], 0) / (spots.length || 1);
    const cz = spots.reduce((s, p) => s + p[1], 0) / (spots.length || 1);
    for (const p of spots) {
      const d = Math.hypot(p[0] - cx, p[1] - cz);
      const out = wall && d > 0 ? (WALL_FOOT_OUT_M * Math.SQRT2) / d : 0;
      points.push(lifted([p[0] + (p[0] - cx) * out, p[1] + (p[1] - cz) * out], 0, scene, ground, coords));
    }
  }
  return points;
}

// ---------------------------------------------------------------- 画面上的位置、指北、比例尺

/**
 * 沙盘里的一点落在画面的哪里（CSS 像素，从画面左上角量）。在镜头背后或画面外面时 visible 是 false。
 * 调用之前镜头的矩阵要是新的：刚画完一帧，或者自己先 camera.updateMatrixWorld()。
 */
export function project(point: Vec3, camera: Camera, size: { width: number; height: number }): { x: number; y: number; visible: boolean } {
  const v = new Vector3(point[0], point[1], point[2]).project(camera);
  const x = (v.x * 0.5 + 0.5) * size.width;
  const y = (-v.y * 0.5 + 0.5) * size.height;
  const visible = v.z >= -1 && v.z <= 1 && x >= 0 && x <= size.width && y >= 0 && y <= size.height;
  return { x, y, visible };
}

/**
 * 画面上从沙盘中间朝 at 这一点（沙盘边上的一点）去的方向，长度为 1：远处的题签朝这一边摆，不往沙盘里摆。
 * 做法是把沙盘的中间和这一点都投到画面上，看从前一个到后一个朝哪边。贴近了看沙盘边上时，沙盘的中间可能在镜头背后，
 * 投出来是反的：那就沿这条线往 at 靠，靠到镜头前面再投（同一条线，方向不变）。at 自己在镜头背后、或者两点投到一处时没有方向。
 */
function outward(at: Vec3, coords: FrameCoords, camera: Camera, size: { width: number; height: number }): [number, number] | undefined {
  const middle = new Vector3((coords.x0 + coords.x1) / 2, at[1], (coords.z0 + coords.z1) / 2).applyMatrix4(camera.matrixWorldInverse);
  const edge = new Vector3(at[0], at[1], at[2]).applyMatrix4(camera.matrixWorldInverse);
  // 镜头自己的坐标里，前面是 −z
  if (!(edge.z < 0)) return undefined;
  const nearest = edge.z * 0.1;
  if (middle.z > nearest) middle.lerpVectors(edge, middle, (nearest - edge.z) / (middle.z - edge.z));
  middle.applyMatrix4(camera.projectionMatrix);
  edge.applyMatrix4(camera.projectionMatrix);
  const dx = (edge.x - middle.x) * size.width;
  const dy = -(edge.y - middle.y) * size.height;
  const length = Math.hypot(dx, dy);
  return length > 1e-6 ? [dx / length, dy / length] : undefined;
}

/**
 * 把题签指着的点投到画面上：每条带上 out（远处的才有）和 foot（抬高过的才有）。
 * 调用之前镜头的矩阵要是新的（见 project）。
 */
export function projectSpots(spots: StripSpot[], coords: FrameCoords, camera: Camera, size: { width: number; height: number }): StripInput['anchors'] {
  return spots.map((spot) => {
    const anchor: StripInput['anchors'][number] = { id: spot.id, ...project(spot.at, camera, size) };
    if (spot.far) {
      const out = outward(spot.at, coords, camera, size);
      if (out) anchor.out = out;
    }
    if (spot.footY !== null) {
      const foot = project([spot.at[0], spot.footY, spot.at[2]], camera, size);
      if (Number.isFinite(foot.x) && Number.isFinite(foot.y)) anchor.foot = { x: foot.x, y: foot.y };
    }
    return anchor;
  });
}

/**
 * 现在摆着的题签各落在画面的哪里：每条带上 out（远处的才有）和 foot（抬高过的才有）。
 * 沙盘、题签的测试、定格图的测试都用这一个函数，三边才对得上。D 是折算过的远近（equivalentDistance）。
 * 调用之前镜头的矩阵要是新的（见 project）。
 */
export function screenAnchors(
  strips: SceneStrip[],
  scene: TableScene,
  ground: GroundSamplers,
  coords: FrameCoords,
  style: StageStyle,
  D: number,
  camera: Camera,
  size: { width: number; height: number },
): StripInput['anchors'] {
  return projectSpots(stripSpots(strips, scene, ground, coords, style, D), coords, camera, size);
}

/**
 * 指北针转多少度：画面正上方是北时为 0，顺时针为正。镜头朝东看时北在画面左边，是 −90。
 * 正俯视时镜头的“前”没有水平的分量，所以把“前”和“上”加起来再看朝向。
 */
export function northDeg(camera: Camera): number {
  const e = camera.matrixWorld.elements;
  // 第 1 列是镜头的上，第 2 列的反方向是镜头的前
  const x = e[4] - e[8];
  const z = e[6] - e[10];
  if (Math.abs(x) < 1e-9 && Math.abs(z) < 1e-9) return 0;
  const heading = MathUtils.radToDeg(Math.atan2(x, -z));
  const north = -heading;
  return north <= -180 ? north + 360 : north > 180 ? north - 360 : north;
}

/** 在 target 那么远的地方，地面上 1 米在画面上是多少像素（横着量；斜着看时远近不一样，只是大约）。 */
export function pixelsPerMetre(camera: PerspectiveCamera, target: Vec3, heightPx: number): number {
  const e = camera.matrixWorld.elements;
  const depth = -((target[0] - camera.position.x) * e[8] + (target[1] - camera.position.y) * e[9] + (target[2] - camera.position.z) * e[10]);
  const focal = Math.max(1, heightPx) / 2 / Math.tan(MathUtils.degToRad(camera.fov) / 2);
  return focal / Math.max(1, depth);
}

// 比例尺取多长（chooseScale）搬到了 src/stage/scale.ts：定格图的沙盘也要用，它不能碰 three。这里照旧给出来。
export { chooseScale } from '../scale';

// 给全程沙盘的每一节算镜头（npm run route:camera，见 tests/tools/route-tools.test.ts）。只算数：不碰磁盘，不写场景文件。
//
// 一节的镜头在场景文件里是手写的四个数：对准哪一点（target）、离多远（distanceM，沙盘里的米）、倾角（pitch，0 是正俯视）、视角（fov）。
// 这里做两件事：
//   一、照场景里现在写的镜头，在每一种沙盘栏上摆一遍，量出来：镜头退了没有、100 公里合多少像素、栏的四个角看出地面的边多远、
//       要看的点（mustShow 和这一节的题签指着的点）在不在留出来的那一块里、镜头犯了“每一座全程沙盘”的哪一条规矩。
//   二、这一节在方框那张表里（./cameraBoxes.ts）有方框的，照方框算一个镜头：方框一圈的点落在真的地面上，
//       在定稿样张的画面（880 × 900，四边不留）上上下左右居中、正好装下——对准的那一点和距离就是这样来的；倾角是交进来的。
// 摆镜头、居中、退远，用的都是沙盘程序自己的函数（src/stage/three/rig.ts 的 placeCamera、centredView、fitDistance），这里不另写一套；
// 自己算的只有两样：从栏的角上看出去落在地面的哪里（看出边多远），和把算出来的数取整。
//
// 沙盘程序的 centredView、fitDistance 会把结果夹在“写的距离的 closest 倍到 MAX_FIT 倍”之间。要的是没被夹住的数，
// 所以换着“写的距离”多问几次，问到结果落在中间为止（unclamped）。

import { PerspectiveCamera, Vector3 } from 'three';
import type { RouteScene, RouteSection, SceneCamera, SceneStrip } from '../../../src/domain/scene';
import type { FrameCoords } from '../../../src/domain/sceneGeo';
import type { LngLat } from '../../../src/domain/types';
import type { GroundSamplers, Vec3 } from '../../../src/stage/ground/types';
import type { TableStyle } from '../../../src/stage/three/internal';
import { MAX_FIT, centreShift, centredView, equivalentDistance, fitDistance, placeCamera, poseOn, project, screenAnchors, wholeTable } from '../../../src/stage/three/rig';
import type { StageInsets } from '../../../src/stage/types';
import { NOTICE_HEAD_PX, NOTICE_ROW_TOP, ROUTE_HOME_PANES, ROUTE_NOTICE_ROW_TOP, ROUTE_PANES, ROUTE_UPRIGHT_PANES, STANDARD_PANES } from '../../stage/support/standardPanes';

// ---------------------------------------------------------------- 画面

/** 一种画面：沙盘栏多大，四边留多少。定格图另有 extra：图片比栏左右各多拍出来多少像素。 */
export interface CameraPane {
  name: string;
  size: { width: number; height: number };
  insets: StageInsets;
  extra?: number;
}

const NO_INSETS: StageInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const plain = ({ name, size, insets }: CameraPane): CameraPane => ({ name, size, insets });
const leave = (top: number, bottom: number): StageInsets => ({ top, right: 0, bottom, left: 0 });

/** 定稿样张的画面：镜头照它定，在它上面程序不该再挪（和 tests/stage/route-views.test.ts 的 TRIAL_PANE 是同一块）。 */
export const TRIAL_PANE: CameraPane = { name: '880 × 900', size: { width: 880, height: 900 }, insets: NO_INSETS };

/** 标准的沙盘栏：不带时间轴的四种、带着时间轴的四种（和 tests/stage/route-views.test.ts 的 STANDARD 是同样八种）。 */
export const STANDARD_CAMERA_PANES: readonly CameraPane[] = [...STANDARD_PANES, ...ROUTE_PANES].map(plain);

/**
 * 定格图的两种形状：宽的照电脑上人物页的栏拍，窄的照竖着拿的平板上人物页的栏拍（都带着时间轴），图片左右各多拍一截。
 * 多拍多少是 tests/support/stillsTool.ts 的 SHAPE_PLANS 里的两个数（130、96）；那个文件带着拍图的一整套，这里不引它，只抄这两个数。
 */
export const STILL_CAMERA_PANES: readonly CameraPane[] = [
  { name: '定格图·宽', size: ROUTE_PANES[0].size, insets: ROUTE_PANES[0].insets, extra: 130 },
  { name: '定格图·窄', size: ROUTE_PANES[2].size, insets: ROUTE_PANES[2].insets, extra: 96 },
];

/**
 * 看整块沙盘的一节要量的每一种栏：标准的八种、首页的两种、别的竖着拿的平板五种，连它们上面多一行说明的时候
 *（和 tests/stage/route-views.test.ts 里“全程”那一节查的是同一批），再加定格图的两种。
 */
export const WHOLE_VIEW_PANES: readonly CameraPane[] = (() => {
  const noticeTop = (name: string): number | undefined => NOTICE_ROW_TOP[name] ?? ROUTE_NOTICE_ROW_TOP[name];
  const withNotice = (pane: CameraPane, more = 0): CameraPane[] => {
    const top = noticeTop(pane.name);
    return top === undefined ? [] : [{ name: `${pane.name}，上面多一行说明${more ? '、再给小像留出地方' : ''}`, size: pane.size, insets: leave(top + more, pane.insets.bottom) }];
  };
  const withBar = ROUTE_PANES.map(plain);
  const home = ROUTE_HOME_PANES.filter((pane) => !ROUTE_PANES.includes(pane)).map(plain);
  const upright = ROUTE_UPRIGHT_PANES.map(plain);
  return [
    ...STANDARD_CAMERA_PANES,
    ...STANDARD_CAMERA_PANES.flatMap((pane) => withNotice(pane)),
    ...withBar.flatMap((pane) => withNotice(pane, NOTICE_HEAD_PX)),
    ...home,
    ...upright,
    ...upright.flatMap((pane) => withNotice(pane)),
    ...STILL_CAMERA_PANES,
  ];
})();

// ---------------------------------------------------------------- 一座沙盘

/** 算镜头要的一座沙盘：场景、换算、取高度的函数、样式（只用到它的座子伸出去多远、多高），和这座沙盘看一站的小节镜头最近多少米。 */
export interface CameraTable {
  scene: RouteScene;
  coords: FrameCoords;
  ground: GroundSamplers;
  style: TableStyle;
  /**
   * 这座沙盘看一站的小节，镜头最近多少米（沙盘里的米）：一座沙盘一个数，在场景验收的测试旁边的那张表里
   *（tests/stage/support/routeFacts.ts 的 routeCameraNearestM；表里没有的沙盘是 15,000）。验收照哪个数查，这里就照哪个数说“近了”。
   */
  nearestM: number;
}

/** 一节的方框（度）。 */
export interface ViewBox {
  west: number;
  east: number;
  south: number;
  north: number;
}

/** “每一座全程沙盘”的视角。 */
export const EVERY_TABLE_FOV = 18;

/** 方框的每条边上，两个角之间再取几个点。 */
const POINTS_PER_EDGE = 12;

/** 方框一圈的点：四个角，每条边上再匀着取 12 个（纬线在沙盘上是弯的，只取四个角会漏掉鼓出来的那一段）。从西北角起，顺时针。 */
export function boxOutline(box: ViewBox, perEdge: number = POINTS_PER_EDGE): LngLat[] {
  const corners: LngLat[] = [
    [box.west, box.north],
    [box.east, box.north],
    [box.east, box.south],
    [box.west, box.south],
  ];
  const out: LngLat[] = [];
  corners.forEach((a, i) => {
    const b = corners[(i + 1) % 4];
    for (let k = 0; k <= perEdge; k++) {
      const t = k / (perEdge + 1);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  });
  return out;
}

/** 沙盘里 [x, z] 脚下多高：地面和海面里高的那个（和镜头自己取要看的点时一样，rig.ts 的 routeFootY）。 */
function footY(T: CameraTable, x: number, z: number): number {
  return T.coords.y(Math.max(T.ground.height(x, z), T.scene.water.levels.values.normal ?? -Infinity));
}

/** 方框一圈的点落在地面上（沙盘里的米）。 */
export function boxPoints(T: CameraTable, box: ViewBox): Vec3[] {
  return boxOutline(box).map((p): Vec3 => {
    const [x, z] = T.coords.toLocal(p);
    return [x, footY(T, x, z), z];
  });
}

// ---------------------------------------------------------------- 照方框算镜头

const round2 = (v: number): number => Math.round(v * 100) / 100;

/**
 * 问沙盘程序“要多远”，问到没被夹住的数：ask(写的距离) 答的是它夹过以后的距离。
 * 答的正好是写的距离（不用退）就把写的距离减半再问，答到了 MAX_FIT 倍就加倍再问；落在中间了，再照答数的三分之二问一次，取那一次的。
 */
function unclamped<T extends { distanceM: number }>(ask: (writtenM: number) => T): T {
  const free = (got: T, writtenM: number): boolean => got.distanceM / writtenM > 1.001 && got.distanceM / writtenM < MAX_FIT - 0.001;
  let writtenM = 10_000;
  for (let i = 0; i < 80; i++) {
    const got = ask(writtenM);
    if (free(got, writtenM)) {
      const again = ask(got.distanceM / 1.5);
      if (free(again, got.distanceM / 1.5)) return again;
    }
    writtenM = got.distanceM / writtenM >= MAX_FIT - 0.001 ? writtenM * 2 : writtenM / 2;
  }
  throw new Error('问了 80 次，沙盘程序答的距离还是夹住的：方框或者画面写得不成样子');
}

/** 照这几个数写的一个镜头：朝北、不转，视角 18 度。 */
function cameraOf(target: LngLat, distanceM: number, pitch: number): SceneCamera {
  return { target, distanceM, pitch, bearing: 0, fov: EVERY_TABLE_FOV };
}

/**
 * 镜头对准 target、倾角 pitch 时，要离多远方框一圈的点才都在 pane 留出来的那一块里（离边 12 像素，沙盘程序的 FIT_MARGIN_PX）：
 * 沙盘程序的 fitDistance 没被夹住的答数，不取整。
 */
export function distanceForBox(T: CameraTable, box: ViewBox, target: LngLat, pitch: number, pane: CameraPane = TRIAL_PANE): number {
  const points = boxPoints(T, box);
  return unclamped((writtenM) => {
    const camera = cameraOf(target, writtenM, pitch);
    return { distanceM: fitDistance(camera, poseOn(camera, T.ground, T.coords).target, points, pane.size, pane.insets) };
  }).distanceM;
}

/** 距离往上取到整百（写进场景文件的样子）。 */
export const upTo100 = (distanceM: number): number => Math.ceil(distanceM / 100 - 1e-9) * 100;

/**
 * 照方框算一个镜头：倾角 pitch；方框一圈的点在 pane 上上下左右居中、正好装下（沙盘程序的 centredView）。
 * 对准的那一点写回经纬度、取两位小数；距离照取过整的那一点再量一次，往上取到整百——所以写下来的镜头在 pane 上一定装得下方框。
 */
export function cameraForBox(T: CameraTable, box: ViewBox, pitch: number, pane: CameraPane = TRIAL_PANE): SceneCamera {
  const points = boxPoints(T, box);
  const middle: LngLat = [(box.west + box.east) / 2, (box.south + box.north) / 2];
  const centred = unclamped((writtenM) => {
    const camera = cameraOf(middle, writtenM, pitch);
    return centredView(camera, poseOn(camera, T.ground, T.coords).target, points, pane.size, pane.insets);
  });
  const [lng, lat] = T.coords.toLngLat(centred.target[0], centred.target[2]);
  const target: LngLat = [round2(lng), round2(lat)];
  return cameraOf(target, upTo100(distanceForBox(T, box, target, pitch, pane)), pitch);
}

/** 把一个镜头对准的那一点往南挪 km 公里（负数是往北），距离照方框重新量。 */
export function movedSouth(T: CameraTable, box: ViewBox, camera: SceneCamera, km: number, pane: CameraPane = TRIAL_PANE): SceneCamera {
  const [x, z] = T.coords.toLocal(camera.target);
  const [lng, lat] = T.coords.toLngLat(x, z + (km * 1000) / T.scene.frame.scale);
  const target: LngLat = [round2(lng), round2(lat)];
  return cameraOf(target, upTo100(distanceForBox(T, box, target, camera.pitch, pane)), camera.pitch);
}

// ---------------------------------------------------------------- 在一种画面上量

/** 四边各多少公里（在里面是 0）。 */
export interface Beyond {
  north: number;
  south: number;
  west: number;
  east: number;
}

/** 一个镜头在一种画面上量到的。 */
export interface PaneReading {
  pane: string;
  /** 镜头离多远是写的距离的几倍；离多少米。 */
  fit: number;
  distanceM: number;
  /** 镜头对准的那一点上，100 公里合多少像素（画路的程序交给样式的就是这个数，src/stage/three/routeKit.ts）。 */
  pxPer100Km: number;
  /** 画面的四个角（定格图是图片的四个角）看出地面的边多少公里。 */
  beyondKm: Beyond;
  /** 留出来的那一块的四个角看出地面的边多少公里。 */
  freeBeyondKm: Beyond;
  /** 要看的点（mustShow 的点和这一节各条题签指着的点）有多少个；落在留出来的那一块外面的是哪些。镜头退到头（2.49 倍以上）的只查题签。 */
  showPoints: number;
  outside: string[];
  /** 交了方框的：方框一圈的点里，落在留出来的那一块外面的有几个（一圈 52 个）。 */
  boxOutside?: number;
}

/** 把 section 的镜头换成 camera（mustShow 照场景里这一节写的）。 */
export function withCamera(section: RouteSection, camera: SceneCamera): RouteSection {
  const { mustShow } = section.camera;
  return { ...section, camera: mustShow ? { ...camera, mustShow } : { ...camera } };
}

/** 从画面上的一点（CSS 像素，从左上角量）看出去，落在 y 这么高的平面上的哪里（沙盘里的 [x, z]）；看不到那个平面（视线朝天）是 null。 */
function groundUnder(camera: PerspectiveCamera, size: { width: number; height: number }, px: number, py: number, y: number): [number, number] | null {
  const far = new Vector3((px / size.width) * 2 - 1, 1 - (py / size.height) * 2, 0.5).unproject(camera);
  const dx = far.x - camera.position.x;
  const dy = far.y - camera.position.y;
  const dz = far.z - camera.position.z;
  if (dy >= -1e-9) return null;
  const t = (y - camera.position.y) / dy;
  return [camera.position.x + dx * t, camera.position.z + dz * t];
}

/** 画面上这几点看出去，落在地面的边以外多少公里。地面取海面那么高的平面（沙盘的四边收到海面上）。 */
function beyondOf(T: CameraTable, camera: PerspectiveCamera, size: { width: number; height: number }, corners: [number, number][]): Beyond {
  const km = T.scene.frame.scale / 1000;
  const { x0, x1, z0, z1 } = T.coords;
  const out: Beyond = { north: 0, south: 0, west: 0, east: 0 };
  for (const [px, py] of corners) {
    const hit = groundUnder(camera, size, px, py, T.coords.y(0));
    if (!hit) return { north: Infinity, south: Infinity, west: Infinity, east: Infinity };
    out.north = Math.max(out.north, (z0 - hit[1]) * km);
    out.south = Math.max(out.south, (hit[1] - z1) * km);
    out.west = Math.max(out.west, (x0 - hit[0]) * km);
    out.east = Math.max(out.east, (hit[0] - x1) * km);
  }
  return out;
}

/**
 * 一节的镜头在一种画面上摆好（沙盘程序的 placeCamera），量一遍。section 的镜头就是要量的那一个（见 withCamera）；
 * box 交了就另数方框一圈的点。镜头是照 tests/stage/route-views.test.ts 的 placed 造的：两边的投影是同一个。
 */
export function readPane(T: CameraTable, section: RouteSection, pane: CameraPane, box?: ViewBox): PaneReading {
  const { scene, coords, ground, style } = T;
  const { size, insets } = pane;
  const view = placeCamera(section, scene, ground, coords, style, size, insets);
  const camera = new PerspectiveCamera(view.pose.fov, size.width / size.height, Math.max(60, view.distanceM * 0.1), view.distanceM * 3 + 30000);
  camera.position.set(...view.pose.position);
  camera.lookAt(...view.pose.target);
  const [shiftX, shiftY] = centreShift(insets);
  if (shiftX || shiftY) camera.setViewOffset(size.width, size.height, -shiftX, -shiftY, size.width, size.height);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const inFree = (p: { x: number; y: number; visible?: boolean }): boolean =>
    p.visible !== false && p.x >= insets.left && p.x <= size.width - insets.right && p.y >= insets.top && p.y <= size.height - insets.bottom;

  // 要看的点：题签指着的点报名字；mustShow 的点里是地名点的报地名，别的报第几个
  const outside: string[] = [];
  const written = section.strips.map((id) => scene.strips.find((s) => s.id === id)).filter((s): s is SceneStrip => s !== undefined);
  const D = equivalentDistance(view.distanceM, view.pose.fov, size.height);
  screenAnchors(written, scene, ground, coords, style, D, camera, size).forEach((anchor, i) => {
    if (!inFree(anchor)) outside.push(`题签“${written[i].text}”`);
  });
  if (view.fit < 2.49) {
    const places = (section.camera.mustShow ?? []).flatMap((id) => {
      const place = scene.places.find((p) => p.id === id);
      return place ? [{ name: place.name, at: coords.toLocal(place.at) }] : [];
    });
    view.points.forEach((point, i) => {
      if (inFree(project(point, camera, size))) return;
      const place = places.find((p) => p.at[0] === point[0] && p.at[1] === point[2]);
      const name = place ? `“${place.name}”` : `第 ${i + 1} 个要看的点`;
      if (!outside.includes(`题签${name}`)) outside.push(name);
    });
  }

  const extra = pane.extra ?? 0;
  const reading: PaneReading = {
    pane: pane.name,
    fit: view.fit,
    distanceM: view.distanceM,
    pxPer100Km: (size.height / 2 / Math.tan((view.pose.fov * Math.PI) / 360) / view.distanceM) * (1e5 / scene.frame.scale),
    beyondKm: beyondOf(T, camera, size, [
      [-extra, 0],
      [size.width + extra, 0],
      [size.width + extra, size.height],
      [-extra, size.height],
    ]),
    freeBeyondKm: beyondOf(T, camera, size, [
      [insets.left, insets.top],
      [size.width - insets.right, insets.top],
      [size.width - insets.right, size.height - insets.bottom],
      [insets.left, size.height - insets.bottom],
    ]),
    showPoints: view.points.length,
    outside,
  };
  if (box) reading.boxOutside = boxPoints(T, box).filter((p) => !inFree(project(p, camera, size))).length;
  return reading;
}

/** 这几种画面上，画面的四个角有没有哪一个看出了地面的北边、南边。 */
export const insideNorthSouth = (readings: readonly PaneReading[]): boolean => readings.every((r) => r.beyondKm.north <= 0 && r.beyondKm.south <= 0);

/** 几种画面上量到的出边，四边各取最大的。which 说量的是画面的角还是留出来的那一块的角。 */
export function worstBeyond(readings: readonly PaneReading[], which: 'beyondKm' | 'freeBeyondKm' = 'beyondKm'): Beyond {
  const worst: Beyond = { north: 0, south: 0, west: 0, east: 0 };
  for (const r of readings) {
    for (const side of ['north', 'south', 'west', 'east'] as const) worst[side] = Math.max(worst[side], r[which][side]);
  }
  return worst;
}

// ---------------------------------------------------------------- 规矩

/**
 * 这个镜头犯了哪几条。前四条是“每一座全程沙盘”的（tests/stage/route-views.test.ts 的头一项）：朝北不转、视角 18 度、
 * 看路的小节不比这座沙盘自己的那个数近（nearestM：一座沙盘一个，见 CameraTable.nearestM）、看路的小节不写 closest。
 * 后面是场景文件的格式（tests/content/routeRules.ts 的 ROUTE_CAMERA）。“每一座”里没有管倾角的一条：倾角只有格式的 0 到 85 度。
 */
export function rulesBroken(camera: SceneCamera, whole: boolean, nearestM: number): string[] {
  const broken: string[] = [];
  if (camera.bearing !== 0) broken.push(`转了 ${camera.bearing} 度（要朝北、不转）`);
  if (camera.fov !== EVERY_TABLE_FOV) broken.push(`视角${camera.fov === undefined ? '没写' : ` ${camera.fov} 度`}（要写 ${EVERY_TABLE_FOV} 度）`);
  if (!whole && camera.distanceM < nearestM) broken.push(`比 ${nearestM} 米近（${camera.distanceM} 米）`);
  if (!whole && camera.closest !== undefined) broken.push('看路的小节写了 closest');
  if (!(camera.distanceM > 0)) broken.push('格式：distanceM 要大于 0');
  if (!(camera.pitch >= 0 && camera.pitch <= 85)) broken.push(`格式：倾角 ${camera.pitch} 度不在 0 到 85 之间`);
  if (camera.fov !== undefined && !(camera.fov >= 10 && camera.fov <= 40)) broken.push(`格式：视角 ${camera.fov} 度不在 10 到 40 之间`);
  if (camera.closest !== undefined && !(camera.closest >= 0.5 && camera.closest <= 1)) broken.push(`格式：closest ${camera.closest} 不在 0.5 到 1 之间`);
  return broken;
}

// ---------------------------------------------------------------- 一节的几种摆法

/** 一种摆法：一个镜头，和它在定稿样张的画面、标准的八种栏、定格图的两种形状上量到的。 */
export interface CameraRow {
  /** 这是哪一种摆法（印出来的一句话）。 */
  label: string;
  camera: SceneCamera;
  rules: string[];
  trial: PaneReading;
  standard: PaneReading[];
  stills: PaneReading[];
  /** 标准的八种栏上，画面的四个角都没看出地面的北边、南边。 */
  insideNorthSouth: boolean;
}

/** 把一个镜头在各种画面上量一遍，凑成一行。 */
export function rowOf(T: CameraTable, section: RouteSection, label: string, camera: SceneCamera, box?: ViewBox): CameraRow {
  const placed = withCamera(section, camera);
  const standard = STANDARD_CAMERA_PANES.map((pane) => readPane(T, placed, pane, box));
  return {
    label,
    camera: placed.camera,
    rules: rulesBroken(placed.camera, wholeTable(placed), T.nearestM),
    trial: readPane(T, placed, TRIAL_PANE, box),
    standard,
    stills: STILL_CAMERA_PANES.map((pane) => readPane(T, placed, pane, box)),
    insideNorthSouth: insideNorthSouth(standard),
  };
}

/** 判过的倾角：照方框算镜头，倾角不比它大（样张是照 46 度判的；再斜要另有定夺）。 */
export const JUDGED_PITCH = 46;
/** 找“装得进南北两边”的倾角时，一次减几度，减到几度为止。 */
const PITCH_STEP = 2;
const PITCH_LEAST = 10;
/** 找“对准的那一点挪多少”时，一次挪几公里，最多挪多少。 */
const MOVE_STEP_KM = 5;
const MOVE_MOST_KM = 800;

/**
 * 方框居中的镜头里，标准的八种栏上都不看出地面的北边、南边的最大的倾角（从 JUDGED_PITCH 起一次减 2 度）。
 * 减到 10 度还不行是 null。
 */
export function steepestInside(T: CameraTable, section: RouteSection, box: ViewBox): number | null {
  for (let pitch = JUDGED_PITCH; pitch >= PITCH_LEAST; pitch -= PITCH_STEP) {
    const placed = withCamera(section, cameraForBox(T, box, pitch));
    if (insideNorthSouth(STANDARD_CAMERA_PANES.map((pane) => readPane(T, placed, pane)))) return pitch;
  }
  return null;
}

/**
 * 倾角不动，把对准的那一点沿南北挪（一次 5 公里），挪到标准的八种栏上都不看出北边、南边为止；距离跟着方框重新量（方框不居中了，要多远跟着变：多半要退，方框宽的那一头顶着画面的边时反而能近一点）。
 * 北边看出去就往南挪，南边看出去就往北挪；两边都看出去，或者挪到 800 公里还不行，是 null（why 说为什么）。
 */
export function movedInside(T: CameraTable, section: RouteSection, box: ViewBox, centred: SceneCamera): { camera: SceneCamera; km: number } | { camera: null; why: string } {
  const read = (camera: SceneCamera): Beyond => worstBeyond(STANDARD_CAMERA_PANES.map((pane) => readPane(T, withCamera(section, camera), pane)));
  const first = read(centred);
  if (first.north <= 0 && first.south <= 0) return { camera: centred, km: 0 };
  if (first.north > 0 && first.south > 0) return { camera: null, why: `居中的时候北边看出去 ${first.north.toFixed(0)} 公里、南边看出去 ${first.south.toFixed(0)} 公里：往哪边挪都不行` };
  const way = first.north > 0 ? 1 : -1;
  for (let km = MOVE_STEP_KM; km <= MOVE_MOST_KM; km += MOVE_STEP_KM) {
    const camera = movedSouth(T, box, centred, way * km);
    const now = read(camera);
    if (now.north <= 0 && now.south <= 0) return { camera, km: way * km };
    if ((way > 0 && now.south > 0) || (way < 0 && now.north > 0)) return { camera: null, why: `往${way > 0 ? '南' : '北'}挪到 ${km} 公里，另一边看出去了 ${(way > 0 ? now.south : now.north).toFixed(0)} 公里，这一边还差 ${(way > 0 ? now.north : now.south).toFixed(0)} 公里` };
  }
  return { camera: null, why: `挪到 ${MOVE_MOST_KM} 公里还不行` };
}

/** 一节在方框那张表里的一行：方框，和除了判过的 46 度以外还要算哪几个倾角。 */
export interface BoxPlan {
  box: ViewBox;
  /** 另外要算的倾角（方框居中）。不写就只算 46 度和工具自己找的那两种。 */
  alsoPitches?: readonly number[];
}

/**
 * 有方框的一节的几种摆法，照先后：
 *   方框居中、倾角 46 度；它比 15,000 米近的话，另一行是同一个镜头退到 15,000 米；
 *   46 度居中看出了北边或者南边的：倾角减到不看出去为止的一行，和倾角不动、对准的那一点挪过去的一行；
 *     46 度挪不成的，倾角一次减 2 度再挪，取挪得成的里面最斜的一行（做不到的写在 notes 里）；
 *   表里 alsoPitches 写的每个倾角各一行（方框居中）；它看出了北边或者南边的，另一行是同一个倾角、对准的那一点挪过去。
 */
export function rowsForBox(T: CameraTable, section: RouteSection, plan: BoxPlan): { rows: CameraRow[]; notes: string[] } {
  const { box } = plan;
  const rows: CameraRow[] = [];
  const notes: string[] = [];
  const add = (label: string, camera: SceneCamera): CameraRow => {
    const row = rowOf(T, section, label, camera, box);
    rows.push(row);
    return row;
  };
  const centred = cameraForBox(T, box, JUDGED_PITCH);
  const first = add(`方框居中，倾角 ${JUDGED_PITCH}`, centred);
  if (centred.distanceM < T.nearestM) add(`方框居中，倾角 ${JUDGED_PITCH}，退到 ${T.nearestM} 米`, { ...centred, distanceM: T.nearestM });
  const done = new Set<number>([JUDGED_PITCH]);
  if (!first.insideNorthSouth) {
    const pitch = steepestInside(T, section, box);
    if (pitch === null) notes.push(`方框居中：倾角减到 ${PITCH_LEAST} 度，标准的八种栏上还是看出了地面的北边或者南边`);
    else {
      add(`方框居中，倾角减到 ${pitch}（标准的八种栏上不看出南北两边的最大的倾角）`, cameraForBox(T, box, pitch));
      done.add(pitch);
    }
    const moved = movedInside(T, section, box, centred);
    if (moved.camera !== null) add(movedLabel(JUDGED_PITCH, moved.km), moved.camera);
    else {
      notes.push(`倾角 ${JUDGED_PITCH}，挪对准的那一点：${moved.why}`);
      // 46 度挪不成：倾角一次减 2 度再试，取头一个挪得成的（就是挪得成的里面最斜的）
      let found = false;
      for (let lower = JUDGED_PITCH - PITCH_STEP; lower >= PITCH_LEAST && !found; lower -= PITCH_STEP) {
        if (lower === pitch) break; // 到了居中就不看出去的倾角：再往下不用挪
        const tried = movedInside(T, section, box, cameraForBox(T, box, lower));
        if (tried.camera === null) continue;
        add(`${movedLabel(lower, tried.km)}——挪得成的里面最斜的`, tried.camera);
        found = true;
      }
      if (!found && pitch === null) notes.push(`倾角从 ${JUDGED_PITCH - PITCH_STEP} 减到 ${PITCH_LEAST} 度，挪对准的那一点都挪不成`);
    }
  }
  for (const pitch of plan.alsoPitches ?? []) {
    if (done.has(pitch)) continue;
    done.add(pitch);
    const also = cameraForBox(T, box, pitch);
    const row = add(`方框居中，倾角 ${pitch}（表里另要的）`, also);
    if (row.insideNorthSouth) continue;
    const moved = movedInside(T, section, box, also);
    if (moved.camera !== null) add(movedLabel(pitch, moved.km), moved.camera);
    else notes.push(`倾角 ${pitch}，挪对准的那一点：${moved.why}`);
  }
  return { rows, notes };
}

/** “对准的那一点挪过”的一行叫什么。 */
function movedLabel(pitch: number, km: number): string {
  return `倾角 ${pitch}，对准的那一点往${km > 0 ? '南' : '北'}挪 ${Math.abs(km)} 公里（标准的八种栏上不看出南北两边）`;
}

// ---------------------------------------------------------------- 看整块沙盘的一节

/** 看整块沙盘的一节在一种栏上正好装下（连座子，居中）要多远：沙盘程序的 centredView 没被夹住的答数。 */
export function wholeViewNeed(T: CameraTable, section: RouteSection, pane: CameraPane): number {
  const { scene, coords, ground, style } = T;
  return unclamped((writtenM) => {
    const camera: SceneCamera = { ...section.camera, distanceM: writtenM };
    delete camera.closest;
    const asked: RouteSection = { ...section, camera };
    // placeCamera 对看整块沙盘的一节用的就是 centredView；这里经它走，要看的点（整块沙盘、连座子）也是它自己取的
    return { distanceM: placeCamera(asked, scene, ground, coords, style, pane.size, pane.insets).distanceM };
  }).distanceM;
}

/** 看整块沙盘的一节在量过的每一种栏上各要多远。 */
export function wholeViewNeeds(T: CameraTable, section: RouteSection, panes: readonly CameraPane[] = WHOLE_VIEW_PANES): { pane: string; needM: number }[] {
  return panes.map((pane) => ({ pane: pane.name, needM: wholeViewNeed(T, section, pane) }));
}

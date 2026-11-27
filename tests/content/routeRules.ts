// 全程沙盘的校验规则：docs/data-spec.md“全程沙盘的场景数据”一节和校验规则里带“全程沙盘”字样的那几句。
// 场景文件里写着 "level": "route" 的，rules.ts 把它交到这里，不走站点沙盘的那一套（sceneRules.ts）。
// 规则的号码和站点沙盘一样：10 场景文件，11 范围，12 类别和依据，13 零件，14 小节，15 题签；格式是 0。
// 另有一条新的，规则 20：figure.json 里每一站的位置，要和全程沙盘上这一站的地名点对得上。
// 全是纯函数：输入是读进内存的场景和几样量好的东西，输出是不合规格的地方。不读磁盘，也不依赖测试框架。
//
// 经纬度和沙盘里的米之间只用 src/domain/sceneGeoRoute.ts 换；类别、题签上的字、unsure 这几样的查法
// 用的是站点沙盘那边的同一份（sceneRules.ts），这里不另写。

import { ROUTE_RESERVED_IDS, ROUTE_SCENE_ID, SCENE_CLASSES, SCENE_CLASS_LABEL } from '../../src/domain/scene';
import type { Grounds, RouteScene, SceneClass, TodayPick } from '../../src/domain/scene';
import type { FrameCoords } from '../../src/domain/sceneGeo';
import { routeCoords } from '../../src/domain/sceneGeoRoute';
import { farSayFrom, sectionInfo } from '../../src/domain/sceneText';
import type { Figure, LngLat } from '../../src/domain/types';
import { kilobytes, megabytes } from './budgetRules';
import { CLASS_LIST, GROUNDS, HAN, LINE_MAX, NEEDS_SOURCE, STYLE_IDS, TERRAIN_MAX_BYTES, WORDS_MAX, insideRing, samePoint, textWidth, toLine, unsureProblem } from './sceneRules';
import type { XZ } from './sceneRules';
import { bool, checkShape, has, list, lngLat, lngLatProblem, number, numberIn, oneOf, optional, record, strict, tagged, text, violation } from './shape';
import type { ContentFiles, FileSizes, Shape, Violation } from './shape';

/** 一节最多摆几条题签（规则 15）。站点沙盘是六条。 */
export const ROUTE_STRIPS_MAX = 12;
/** 小节的名字最多几个字（规则 14）。 */
export const ROUTE_HEADING_MAX = 7;
/** “今天的海岸、湖、河”那个文件最大多少字节（规则 10）：300 KB。 */
export const TODAY_MAX_BYTES = 300 * 1024;
/** 沙盘的比例（沙盘上的 1 米是地上的多少米）在这两个数之间（规则 10）。 */
export const SCALE_MIN = 50;
export const SCALE_MAX = 1000;
/** 查地形文件盖不盖得住沙盘时，四条边上每隔多少公里取一个点（规则 10）。 */
export const EDGE_STEP_KM = 50;
/** 指着河的题签，at 离河的线最远多少公里（规则 15）。 */
export const RIVER_STRIP_MAX_KM = 6;
/** 指着远处的题签，at 离沙盘的边最远多少公里（规则 15）。 */
export const FAR_STRIP_MAX_KM = 5;
/** 一趟路里，后一截路的头离前一截路的尾最远多少公里（规则 13）。 */
export const WAY_JOIN_MAX_KM = 1;
/** figure.json 里一站的位置，和全程沙盘上这一站的地名点，经度、纬度各最多差多少度（规则 20）。 */
export const STOP_PLACE_MAX_DEG = 0.02;

/** 校验全程沙盘要用到的人物资料：各站的 id，按先后。 */
export interface RouteFigure {
  stops: string[];
}

/** 这份 JSON 是不是全程沙盘的场景（写着 "level": "route"）。 */
export function isRouteLevel(data: unknown): boolean {
  return typeof data === 'object' && data !== null && !Array.isArray(data) && (data as { level?: unknown }).level === ROUTE_SCENE_ID;
}

// ---------------------------------------------------------------- 格式

const positive = numberIn({ above: 0 });
const notNegative = numberIn({ min: 0 });
const count = numberIn({ above: 0, whole: true });

const RING = list(lngLat);
const PICK = strict({ names: list(text), west: optional(number), east: optional(number), south: optional(number), north: optional(number) });

/** 镜头：和站点沙盘一样，只是不许写 targetUpM。 */
const ROUTE_CAMERA = strict({
  target: lngLat,
  distanceM: positive,
  pitch: numberIn({ min: 0, max: 85 }),
  bearing: numberIn({ min: 0, max: 360 }),
  fov: optional(numberIn({ min: 10, max: 40 })),
  closest: optional(numberIn({ min: 0.5, max: 1 })),
  mustShow: optional(list(text)),
});

/**
 * 全程沙盘场景文件的样子。不认识的字段通不过：照站点沙盘的习惯写上 things、banks、rapids、dry、when、targetUpM、
 * sky、drawWidthM，都会在这里被挡住。kind、heightUnit 是不是那一种，数在不在范围里，由规则 10 说。
 */
const ROUTE: Shape = strict({
  level: oneOf([ROUTE_SCENE_ID]),
  stopId: text,
  style: text,
  credits: list(text),
  sources: list(strict({ id: text, basis: text, cite: text })),
  // 沙盘上的小像在凭据里印的那几句话（它站在哪不写在场景里，照行迹走）；不在五类里，没有 class
  piece: optional(strict({ name: text, basis: text, note: text })),
  // 凭据里“沙盘上的东西”一栏开头的几条总的说明，可以不写：一条一个 id（只在这一组里认）和一段话；id 不重复、话不是空的，由规则 13 说
  general: optional(list(strict({ id: text, text }))),
  frame: strict({
    center: lngLat,
    projection: strict({ kind: text, lat1: number, lat2: number }),
    scale: positive,
    westM: positive,
    eastM: positive,
    northM: positive,
    southM: positive,
    datumM: number,
    relief: strict({ kind: text, lowBelowM: number, lowTimes: number, power: number, highTimes: number }),
  }),
  terrain: strict({
    ...GROUNDS,
    file: text,
    cols: count,
    rows: count,
    west: number,
    east: number,
    south: number,
    north: number,
    heightUnit: text,
    // 整理地形的两种办法：平原抹成缓坡（plain-smoothed），地面照量到的样子（as-measured，不抹，所以没有抹平原的那几个数）
    recipe: tagged('kind', {
      'plain-smoothed': strict({
        ...GROUNDS,
        kind: text,
        plainBelowM: number,
        hillAboveM: number,
        smoothM: positive,
        plainKeep: numberIn({ min: 0, max: 1 }),
        rippleM: list(notNegative),
        edgeTaperM: notNegative,
        blank: list(RING),
      }),
      'as-measured': strict({ ...GROUNDS, kind: text, edgeTaperM: notNegative, blank: list(RING) }),
    }),
    edits: list(strict({ ...GROUNDS, id: text, name: text, op: oneOf(['sea']), area: RING })),
  }),
  water: strict({
    levels: strict({ ...GROUNDS, values: record(number) }),
    todayFile: text,
    coast: strict({ ...GROUNDS, name: text }),
    rivers: list(
      strict({ ...GROUNDS, id: text, name: text, kind: oneOf(['river', 'canal']), weight: optional(oneOf(['trunk', 'major', 'river', 'minor'])), line: optional(RING), today: optional(list(PICK)) }),
    ),
    lakes: list(strict({ ...GROUNDS, id: text, name: text, today: list(PICK), except: optional(strict({ ...GROUNDS, id: text, name: text, area: RING })) })),
    washes: list(strict({ ...GROUNDS, id: text, name: text, areas: list(RING) })),
  }),
  places: list(strict({ ...GROUNDS, id: text, name: text, at: lngLat, stops: optional(list(text)), area: optional(bool) })),
  strips: list(strict({ id: text, text, modern: optional(text), of: text, at: optional(lngLat), side: optional(oneOf(['above', 'below', 'left', 'right'])) })),
  far: list(strict({ ...GROUNDS, id: text, name: text, at: lngLat, gloss: optional(text) })),
  roads: strict({
    ways: list(strict({ id: text, by: oneOf(['water', 'land', 'sea']), along: optional(text), line: RING })),
    journeys: list(strict({ id: text, name: text, stop: text, date: text, parts: list(strict({ ...GROUNDS, name: text, ways: list(text) })) })),
    // 这座沙盘自己说的两件事，都可以不写：看一站的小节画的是来路还是这一站那几年走的路；船走的线画在河边还是画在水上
    stopShows: optional(oneOf(['way-there', 'stop-years'])),
    boats: optional(oneOf(['beside', 'on'])),
  }),
  sections: list(strict({ heading: text, date: text, line: text, camera: ROUTE_CAMERA, strips: list(text), explain: list(text), stop: optional(text) })),
  notDrawn: list(strict({ id: text, name: text, why: text, sourceIds: list(text) })),
});

/**
 * 全程沙盘场景文件的格式：字段齐全、类型对、没有不认识的字段；坐标不对的算在规则 1 上。
 * 这里有问题时，这个文件的规则 10 到 15 先不查。
 */
export function checkRouteShape(data: unknown, file: string): Violation[] {
  return checkShape(data, ROUTE, file);
}

/**
 * 格式通过以后，一个全程沙盘场景文件的规则 10 到 15，外加两处要拿两个数比着看的格式。
 * styleIds 是程序里有的样式（不写就是登记表里的那几种）：测试里编出来的样式不进登记表，查编出来的沙盘时把它的名字交进来。
 */
export function checkRouteScene(scene: RouteScene, file: string, figure: RouteFigure, files: ContentFiles, sizes: FileSizes = {}, styleIds: readonly string[] = STYLE_IDS): Violation[] {
  const today = readToday(files, todayPath(scene, file));
  return [
    ...checkRouteNumbers(scene, file),
    ...checkRouteFile(scene, file, files, sizes, today, styleIds),
    ...checkRouteExtent(scene, file),
    ...checkBlankClear(scene, file),
    ...checkRouteGrounds(scene, file),
    ...checkRouteParts(scene, file, figure.stops),
    ...checkRouteSections(scene, file, figure.stops),
    ...checkRouteStrips(scene, file, figure.stops, today),
  ];
}

/** 格式里要拿两个数比着看的两处：算山地的海拔要比算平原的高；rippleM 是两个数，前一个比后一个小。地面照量到的样子的沙盘（as-measured）没有这几个数，不查。 */
export function checkRouteNumbers(scene: RouteScene, file: string): Violation[] {
  const out: Violation[] = [];
  const recipe = scene.terrain.recipe;
  if (recipe.kind === 'as-measured') return out;
  if (recipe.hillAboveM <= recipe.plainBelowM) {
    out.push(violation(0, file, 'terrain.recipe.hillAboveM', `算山地的海拔（${recipe.hillAboveM}）要比算平原的海拔（plainBelowM，${recipe.plainBelowM}）高，两个数之间才有地方过渡`));
  }
  const ripple: number[] = recipe.rippleM;
  if (ripple.length !== 2) out.push(violation(0, file, 'terrain.recipe.rippleM', `要写成两个数（多少米以下的起伏抹掉，多少米以上的算山），现在是 ${ripple.length} 个`));
  else if (ripple[0] >= ripple[1]) out.push(violation(0, file, 'terrain.recipe.rippleM', `前一个数（${ripple[0]}）要比后一个（${ripple[1]}）小，两个数之间才有地方过渡`));
  return out;
}

// ---------------------------------------------------------------- 换算和几样小东西

/** 投影的两条标准纬线说不说得通：说不通时换算出来的都不是数，凡是要量位置的检查都先不做（规则 10 会说）。 */
function projectionOk(scene: RouteScene): boolean {
  const { kind, lat1, lat2 } = scene.frame.projection;
  return kind === 'lambert-conic' && lat1 > -90 && lat1 < lat2 && lat2 < 90 && lat1 + lat2 !== 0;
}

function coordsFor(scene: RouteScene): FrameCoords | null {
  return projectionOk(scene) ? routeCoords(scene.frame) : null;
}

/** 沙盘里的米换成地上的公里。 */
const kmOf = (scene: RouteScene, tableMetres: number): number => (tableMetres * scene.frame.scale) / 1000;

/** 沙盘四条边盖住的经纬度范围：每条边上每隔 stepKm 公里取一个点（圆锥投影的边是弯的，光看四个角不够）。 */
export function routeFrameBox(scene: RouteScene, coords: FrameCoords, stepKm: number = EDGE_STEP_KM): { west: number; east: number; south: number; north: number } {
  const box = { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity };
  const take = (x: number, z: number): void => {
    const [lng, lat] = coords.toLngLat(x, z);
    box.west = Math.min(box.west, lng);
    box.east = Math.max(box.east, lng);
    box.south = Math.min(box.south, lat);
    box.north = Math.max(box.north, lat);
  };
  const step = (stepKm * 1000) / scene.frame.scale;
  const across = Math.max(1, Math.ceil((coords.x1 - coords.x0) / step));
  const down = Math.max(1, Math.ceil((coords.z1 - coords.z0) / step));
  for (let i = 0; i <= across; i++) {
    const x = coords.x0 + ((coords.x1 - coords.x0) * i) / across;
    take(x, coords.z0);
    take(x, coords.z1);
  }
  for (let j = 0; j <= down; j++) {
    const z = coords.z0 + ((coords.z1 - coords.z0) * j) / down;
    take(coords.x0, z);
    take(coords.x1, z);
  }
  return box;
}

const degreesText = (value: number): string => value.toFixed(4);

/** 两点之间沿地球表面多少公里，从前一点看后一点在哪个方向（0 是正北，顺时针）。球面的算法，半径 6371 公里。 */
export function greatCircle(from: LngLat, to: LngLat): { km: number; bearingDeg: number } {
  const rad = Math.PI / 180;
  const lat1 = from[1] * rad;
  const lat2 = to[1] * rad;
  const dLng = (to[0] - from[0]) * rad;
  const a = Math.sin((lat2 - lat1) / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const km = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const bearing = Math.atan2(Math.sin(dLng) * Math.cos(lat2), Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)) / rad;
  return { km, bearingDeg: (bearing + 360) % 360 };
}

/**
 * 全程沙盘上远处的那句话，如“定州：往北约 14 公里（今河北定州）”：方向和距离从题签指的那一点（路出沙盘的地方）量到那个地方，
 * 不从沙盘的原点量。名字后面的那一截就是页面印的（src/domain/sceneText.ts 的 farSayFrom），这里不另拼。
 * 上面的 greatCircle 是另算的一遍，留着给测试核页面的那一个用。
 */
export function routeFarWords(far: { name: string; at: LngLat; gloss?: string }, from: LngLat): string {
  return `${far.name}：${farSayFrom(from, far)}`;
}

// ---------------------------------------------------------------- 今天的海岸、湖、河（todayFile）

/** “今天的海岸、湖、河”文件里的一样东西：是哪一种，叫什么，它的线（河）和面（陆地、湖；每一个面是外圈加里面挖掉的圈）。 */
export interface TodayFeature {
  kind: string;
  name: string;
  lines: LngLat[][];
  polygons: LngLat[][][];
}

/** 读出来的文件，或者读不出来的原因。文件不在时是 null（规则 10 另报）。 */
export type Today = { features: TodayFeature[] } | { problem: string } | null;

/** todayFile 在内容目录里的路径：和场景文件同一个文件夹。 */
function todayPath(scene: RouteScene, file: string): string {
  return `${file.slice(0, file.lastIndexOf('/') + 1)}${scene.water.todayFile}`;
}

const isPoint = (value: unknown): value is LngLat => lngLatProblem(value) === null;
const isLine = (value: unknown): value is LngLat[] => Array.isArray(value) && value.every(isPoint);
const isLines = (value: unknown): value is LngLat[][] => Array.isArray(value) && value.every(isLine);

/** 把 GeoJSON 的文字读成一样一样的东西。只认 FeatureCollection；每样东西要有 properties.kind（land、lake、river）和 properties.name。 */
export function readToday(files: ContentFiles, path: string): Today {
  if (!has(files, path)) return null;
  let data: unknown;
  try {
    data = JSON.parse(files[path].replace(/^﻿/, ''));
  } catch (error) {
    return { problem: `不是合法的 JSON（${error instanceof Error ? error.message : String(error)}）` };
  }
  const root = data as { type?: unknown; features?: unknown } | null;
  if (typeof root !== 'object' || root === null || root.type !== 'FeatureCollection' || !Array.isArray(root.features)) {
    return { problem: '不是 GeoJSON 的 FeatureCollection（最外面要有 "type": "FeatureCollection" 和 features 列表）' };
  }
  const features: TodayFeature[] = [];
  for (const [i, raw] of (root.features as unknown[]).entries()) {
    const feature = raw as { properties?: { kind?: unknown; name?: unknown } | null; geometry?: { type?: unknown; coordinates?: unknown } | null } | null;
    const kind = feature?.properties?.kind;
    const name = feature?.properties?.name;
    if (typeof kind !== 'string' || !['land', 'lake', 'river'].includes(kind)) return { problem: `第 ${i + 1} 样东西的 properties.kind 要写 land、lake 或 river` };
    if (typeof name !== 'string' || name.trim() === '') return { problem: `第 ${i + 1} 样东西没有名字（properties.name）` };
    const type = feature?.geometry?.type;
    const at = feature?.geometry?.coordinates;
    const item: TodayFeature = { kind, name, lines: [], polygons: [] };
    if (type === 'LineString' && isLine(at)) item.lines.push(at);
    else if (type === 'MultiLineString' && isLines(at)) item.lines.push(...at);
    else if (type === 'Polygon' && isLines(at)) item.polygons.push(at);
    else if (type === 'MultiPolygon' && Array.isArray(at) && at.every(isLines)) item.polygons.push(...(at as LngLat[][][]));
    else return { problem: `第 ${i + 1} 样东西（${name}）的形状读不懂：要是 LineString、MultiLineString、Polygon 或 MultiPolygon，坐标是 [经度, 纬度]` };
    if (kind === 'river' ? item.lines.length === 0 : item.polygons.length === 0) return { problem: `第 ${i + 1} 样东西（${name}）是 ${kind}，形状却是 ${String(type)}：河要是线，陆地和湖要是面` };
    features.push(item);
  }
  return { features };
}

const inBox = (p: LngLat, pick: TodayPick): boolean =>
  (pick.west === undefined || p[0] >= pick.west) && (pick.east === undefined || p[0] <= pick.east) && (pick.south === undefined || p[1] >= pick.south) && (pick.north === undefined || p[1] <= pick.north);

/** 几条取法合起来取到的河的线：叫这些名字的线，写了范围的只留范围里的点（断开的地方分成几条）。 */
export function pickedLines(features: TodayFeature[], picks: TodayPick[]): LngLat[][] {
  const out: LngLat[][] = [];
  for (const pick of picks) {
    for (const feature of features) {
      if (feature.kind !== 'river' || !pick.names.includes(feature.name)) continue;
      for (const line of feature.lines) {
        let run: LngLat[] = [];
        for (const p of line) {
          if (inBox(p, pick)) run.push(p);
          else {
            if (run.length >= 2) out.push(run);
            run = [];
          }
        }
        if (run.length >= 2) out.push(run);
      }
    }
  }
  return out;
}

/** 几条取法合起来取到的湖的面。 */
export function pickedLakes(features: TodayFeature[], picks: TodayPick[]): LngLat[][][] {
  return features.filter((feature) => feature.kind === 'lake' && picks.some((pick) => pick.names.includes(feature.name))).flatMap((feature) => feature.polygons);
}

/** 一点在不在一个面里：在外圈里面，又不在里面挖掉的圈里。照经纬度直接算。 */
function inPolygon(p: LngLat, polygon: LngLat[][]): boolean {
  if (polygon.length === 0 || !insideRing(p, polygon[0])) return false;
  return !polygon.slice(1).some((hole) => insideRing(p, hole));
}

// ---------------------------------------------------------------- 规则 10 场景文件

/**
 * 规则 10 场景文件（全程沙盘）：文件叫 route.json，stopId 写 route；style 是程序里有的样式；credits 至少两条；
 * 投影是兰勃特等角圆锥，两条标准纬线 −90 < lat1 < lat2 < 90；比例在 50 到 1000 之间；
 * 山高是“矮山多夸”，lowBelowM 大于 0，lowTimes 不小于 1，power 大于 0、不大于 1，highTimes 是 1 到 lowTimes 之间的整数；
 * 地形文件叫 route.terrain.bin，存在，大小正好是 行 × 列 × 2 字节，不超过 1.5 MB，heightUnit 写 m，盖得住整块沙盘；
 * todayFile 是同一个文件夹里的一个 .geojson 文件，存在，读得出来，不超过 300 KB，每条取法里的每个名字在里面都找得到。
 */
export function checkRouteFile(
  scene: RouteScene,
  file: string,
  files: ContentFiles,
  sizes: FileSizes = {},
  today: Today = readToday(files, todayPath(scene, file)),
  styleIds: readonly string[] = STYLE_IDS,
): Violation[] {
  const out: Violation[] = [];
  const bad = (field: string, problem: string) => out.push(violation(10, file, field, problem));
  const folder = file.slice(0, file.lastIndexOf('/') + 1);

  if (!file.endsWith(`/scenes/${ROUTE_SCENE_ID}.json`)) bad('', `全程沙盘的场景文件要叫 ${ROUTE_SCENE_ID}.json（scenes/${ROUTE_SCENE_ID}.json），一位人物只有一个`);
  if (scene.stopId !== ROUTE_SCENE_ID) bad('stopId', `全程沙盘的 stopId 写 ${ROUTE_SCENE_ID}，现在是“${scene.stopId}”`);

  if (!styleIds.includes(scene.style)) bad('style', `样式“${scene.style}”程序里没有；有的是：${styleIds.join('、')}`);

  if (scene.credits.length < 2) bad('credits', `至少要写两条：地形用了谁的高程数据，今天的海岸、河、湖用了谁的数据；现在是 ${scene.credits.length} 条`);
  scene.credits.forEach((credit, i) => {
    if (credit.trim() === '') bad(`credits[${i}]`, '这一条是空的');
  });

  // 范围
  const { projection, scale, relief } = scene.frame;
  const projectionKind: string = projection.kind;
  if (projectionKind !== 'lambert-conic') bad('frame.projection.kind', `全程沙盘的投影只有兰勃特等角圆锥一种（kind 写 lambert-conic），现在是“${projectionKind}”`);
  else if (!(projection.lat1 > -90 && projection.lat1 < projection.lat2 && projection.lat2 < 90)) {
    bad('frame.projection.lat1', `两条标准纬线要 lat1 比 lat2 小，都在 −90 到 90 之间，现在是 ${projection.lat1} 和 ${projection.lat2}`);
  } else if (projection.lat1 + projection.lat2 === 0) {
    bad('frame.projection.lat1', `两条标准纬线一南一北正好对称（${projection.lat1} 和 ${projection.lat2}），这样的圆锥投影算不出来；挪开一点`);
  }
  if (scale < SCALE_MIN || scale > SCALE_MAX) bad('frame.scale', `沙盘的比例（沙盘上的 1 米是地上的多少米）应该在 ${SCALE_MIN} 到 ${SCALE_MAX} 之间，现在是 ${scale}`);

  const reliefKind: string = relief.kind;
  if (reliefKind !== 'low-hills-more') bad('frame.relief.kind', `全程沙盘的山高只有“矮山多夸”一种写法（kind 写 low-hills-more），现在是“${reliefKind}”`);
  if (!(relief.lowBelowM > 0)) bad('frame.relief.lowBelowM', `应该大于 0，现在是 ${relief.lowBelowM}`);
  if (!(relief.lowTimes >= 1)) bad('frame.relief.lowTimes', `矮山夸大的倍数不小于 1，现在是 ${relief.lowTimes}`);
  if (!(relief.power > 0 && relief.power <= 1)) bad('frame.relief.power', `应该大于 0、不大于 1（越小，高山夸得越少），现在是 ${relief.power}`);
  if (!(Number.isInteger(relief.highTimes) && relief.highTimes >= 1 && relief.highTimes <= relief.lowTimes)) {
    bad('frame.relief.highTimes', `最高的山夸大了大约几倍：要是 1 到 lowTimes（${relief.lowTimes}）之间的整数，现在是 ${relief.highTimes}`);
  }

  // 地形文件
  const terrain = scene.terrain;
  const expectedName = `${ROUTE_SCENE_ID}.terrain.bin`;
  const path = `${folder}${terrain.file}`;
  if (terrain.file !== expectedName) {
    bad('terrain.file', `地形文件应该叫 ${expectedName}，和场景文件放在一起，现在写的是“${terrain.file}”`);
  } else if (!has(files, path)) {
    bad('terrain.file', `地形文件 scenes/${terrain.file} 不存在`);
  } else if (sizes[path] !== undefined) {
    const size = sizes[path];
    const expected = terrain.rows * terrain.cols * 2;
    if (size !== expected) bad('terrain.file', `地形文件有 ${size} 字节；按 ${terrain.rows} 行 × ${terrain.cols} 列、每个数 2 字节算，应该正好是 ${expected} 字节`);
    if (size > TERRAIN_MAX_BYTES) bad('terrain.file', `地形文件有 ${megabytes(size)}，不能超过 1.5 MB`);
  }
  const unit: string = terrain.heightUnit;
  if (unit !== 'm') bad('terrain.heightUnit', `全程沙盘的地形文件里一个数是 1 米（heightUnit 写 m），现在是“${unit}”`);

  if (terrain.west >= terrain.east) bad('terrain.west', `west（${terrain.west}）应该比 east（${terrain.east}）小`);
  else if (terrain.south >= terrain.north) bad('terrain.south', `south（${terrain.south}）应该比 north（${terrain.north}）小`);
  else {
    const coords = coordsFor(scene);
    if (coords) {
      const edges = routeFrameBox(scene, coords);
      if (edges.west < terrain.west) bad('terrain.west', `地形文件盖不住沙盘的西边：沙盘到经度 ${degreesText(edges.west)}，地形文件从 ${terrain.west} 才开始`);
      if (edges.east > terrain.east) bad('terrain.east', `地形文件盖不住沙盘的东边：沙盘到经度 ${degreesText(edges.east)}，地形文件只到 ${terrain.east}`);
      if (edges.south < terrain.south) bad('terrain.south', `地形文件盖不住沙盘的南边：沙盘到纬度 ${degreesText(edges.south)}，地形文件从 ${terrain.south} 才开始`);
      if (edges.north > terrain.north) bad('terrain.north', `地形文件盖不住沙盘的北边：沙盘到纬度 ${degreesText(edges.north)}，地形文件只到 ${terrain.north}`);
    }
  }

  // 今天的海岸、湖、河
  const todayFile = scene.water.todayFile;
  if (/[\\/]/.test(todayFile) || !todayFile.endsWith('.geojson')) {
    bad('water.todayFile', `只写文件名，后缀是 .geojson（现在是“${todayFile}”）；文件和场景文件放在一起`);
  } else if (today === null) {
    bad('water.todayFile', `今天的海岸、湖、河的文件 scenes/${todayFile} 不存在`);
  } else if ('problem' in today) {
    bad('water.todayFile', `scenes/${todayFile} 读不出来：${today.problem}`);
  } else {
    const size = sizes[`${folder}${todayFile}`];
    if (size !== undefined && size > TODAY_MAX_BYTES) bad('water.todayFile', `scenes/${todayFile} 有 ${kilobytes(size)}，不能超过 300 KB`);
    const named = (kind: string, name: string): boolean => today.features.some((feature) => feature.kind === kind && feature.name === name);
    const picks = (list: TodayPick[] | undefined, field: string, what: string, kind: 'river' | 'lake'): void => {
      list?.forEach((pick, j) => {
        pick.names.forEach((name, k) => {
          if (!named(kind, name)) bad(`${field}[${j}].names[${k}]`, `${what}要取的“${name}”，在 scenes/${todayFile} 里找不到叫这个名字的${kind === 'river' ? '河' : '湖'}`);
        });
        // 一个名字也没写的归规则 13 报；名字有找不到的，上面说过了
        if (kind === 'river' && pick.names.length > 0 && pick.names.every((name) => named(kind, name)) && pickedLines(today.features, [pick]).length === 0) {
          bad(`${field}[${j}]`, `${what}的这一条取法一段线也取不到：写的范围里没有叫 ${pick.names.join('、')} 的河`);
        }
      });
    };
    scene.water.rivers.forEach((river, i) => picks(river.today, `water.rivers[${i}].today`, `“${river.id}”`, 'river'));
    scene.water.lakes.forEach((lake, i) => picks(lake.today, `water.lakes[${i}].today`, `湖“${lake.id}”`, 'lake'));
  }
  return out;
}

// ---------------------------------------------------------------- 规则 11 范围

/**
 * 规则 11 范围（全程沙盘）：地名点、题签指的点、只染水色的水的圈、从湖面里裁掉的圈、路的线、镜头对准的点，都在沙盘里面
 * （压在边上也算）。抹成海的圈、留白的圈、河的线可以伸出去。远处的地点在沙盘外面。
 */
export function checkRouteExtent(scene: RouteScene, file: string): Violation[] {
  const coords = coordsFor(scene);
  if (!coords) return [];
  const out: Violation[] = [];
  const box = routeFrameBox(scene, coords);
  const range = `四个角大约在经度 ${degreesText(box.west)} 到 ${degreesText(box.east)}、纬度 ${degreesText(box.south)} 到 ${degreesText(box.north)} 之间（边是弯的）`;
  const point = (p: LngLat | undefined, field: string, what: string) => {
    if (p && !coords.inside(p)) out.push(violation(11, file, field, `${what}在沙盘外面；沙盘${range}`));
  };
  const points = (line: LngLat[] | undefined, field: string, what: string) => line?.forEach((p, j) => point(p, `${field}[${j}]`, `${what}的第 ${j + 1} 个点`));

  scene.water.lakes.forEach((lake, i) => points(lake.except?.area, `water.lakes[${i}].except.area`, `从湖面里裁掉的“${lake.except?.id}”`));
  scene.water.washes.forEach((wash, i) => wash.areas.forEach((ring, j) => points(ring, `water.washes[${i}].areas[${j}]`, `“${wash.id}”的圈`)));
  scene.places.forEach((place, i) => point(place.at, `places[${i}].at`, `地名点“${place.id}”`));
  scene.strips.forEach((strip, i) => point(strip.at, `strips[${i}].at`, `题签“${strip.id}”指的点`));
  scene.roads.ways.forEach((way, i) => points(way.line, `roads.ways[${i}].line`, `路“${way.id}”`));
  scene.sections.forEach((section, i) => point(section.camera.target, `sections[${i}].camera.target`, `小节“${section.heading}”的镜头对准的点`));
  scene.far.forEach((far, i) => {
    if (coords.inside(far.at)) out.push(violation(11, file, `far[${i}].at`, `远处“${far.id}”在沙盘里面；远处写的是沙盘外面的地方，里面的地方登记成地名点`));
  });
  return out;
}

/** 留白的每一圈离画出来的每一截路、每一个地名点至少多少公里（规则 11）。 */
export const BLANK_CLEAR_KM = 60;
/** 量一截路离留白多远时，沿线每隔多少公里取一个点（写的拐点都取）。 */
const BLANK_STEP_KM = 5;

/** 留白的一圈旁边的一样东西：是哪一圈（从 0 数起）、是什么、离圈的边多少公里（落在圈里面是 0）。 */
export interface NearBlank {
  ring: number;
  what: string;
  km: number;
}

/**
 * 留白的每一圈离画出来的每一截路、每一个地名点各多远：每一圈、每一样东西一行（一截路取它离这一圈最近的那一点）。
 * 在沙盘的投影里量：圈是写的那几个点直着连成的（画出来的边是样式抹开、打散过的，这里量的是写的圈）；落在圈里面的是 0。
 * 投影说不通、量不了的时候是空的。校验（规则 11）和测试量的都是这一个函数。
 */
export function blankClearance(scene: RouteScene): NearBlank[] {
  const coords = coordsFor(scene);
  if (!coords) return [];
  const out: NearBlank[] = [];
  const step = (BLANK_STEP_KM * 1000) / scene.frame.scale;
  scene.terrain.recipe.blank.forEach((written, ring) => {
    if (written.length < 3) return;
    const edge = written.map((p): XZ => coords.toLocal(p));
    const away = (p: XZ): number => (insideRing(p, edge) ? 0 : kmOf(scene, toLine(p, edge, true)));
    for (const way of scene.roads.ways) {
      let km = Infinity;
      const line = way.line.map((p): XZ => coords.toLocal(p));
      line.forEach((a, i) => {
        km = Math.min(km, away(a));
        const b = line[i + 1];
        if (!b) return;
        const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step);
        for (let k = 1; k < n; k++) km = Math.min(km, away([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]));
      });
      if (Number.isFinite(km)) out.push({ ring, what: `路“${way.id}”`, km });
    }
    for (const place of scene.places) out.push({ ring, what: `地名点“${place.id}”`, km: away(coords.toLocal(place.at)) });
  });
  return out;
}

/**
 * 规则 11 范围（全程沙盘）添的一句：留白的每一圈，离画出来的每一截路、每一个地名点至少 60 公里。
 * 留白的边是抹开的（地势在边线外面几十公里起就收平，颜色淡得更早）：路和地名离圈近了，就落在收平、淡掉的那一条里。
 */
export function checkBlankClear(scene: RouteScene, file: string): Violation[] {
  return blankClearance(scene)
    .filter((near) => near.km < BLANK_CLEAR_KM)
    .map((near) =>
      violation(
        11,
        file,
        `terrain.recipe.blank[${near.ring}]`,
        `留白的第 ${near.ring + 1} 圈${near.km === 0 ? `把${near.what}圈在里面了` : `离${near.what}只有 ${Math.floor(near.km)} 公里`}；留白的每一圈离画出来的路、地名点至少要有 ${BLANK_CLEAR_KM} 公里（留白的边是抹开的，离得近的路和地名会落在收平、淡掉的那一条里），把圈挪开`,
      ),
    );
}

// ---------------------------------------------------------------- 规则 12 类别和依据

const SOURCE_BASES = ['own-words', 'record', 'later'];
const SCHEMATIC_ONLY = '只能是 schematic（示意的）';

/** 全程沙盘里带类别和依据的全部东西：在文件的哪里，是什么，类别有没有另外的限制。 */
function grounded(scene: RouteScene): { path: string; what: string; grounds: Grounds; only?: readonly SceneClass[] }[] {
  const { terrain, water } = scene;
  const each = <T extends Grounds & { id: string }>(items: T[], path: string, kind: string, only?: readonly SceneClass[]) =>
    items.map((item, i) => ({ path: `${path}[${i}]`, what: `${kind}“${item.id}”`, grounds: item as Grounds, only }));
  return [
    { path: 'terrain', what: '地形', grounds: terrain },
    { path: 'terrain.recipe', what: '地形的整理', grounds: terrain.recipe },
    ...each(terrain.edits, 'terrain.edits', '抹成海的地方', ['schematic']),
    { path: 'water.levels', what: '海面', grounds: water.levels },
    { path: 'water.coast', what: '海岸', grounds: water.coast },
    ...each(water.rivers, 'water.rivers', '河'),
    ...water.lakes.flatMap((lake, i) => [
      { path: `water.lakes[${i}]`, what: `湖“${lake.id}”`, grounds: lake as Grounds },
      ...(lake.except ? [{ path: `water.lakes[${i}].except`, what: `从湖面里裁掉的“${lake.except.id}”`, grounds: lake.except as Grounds, only: ['schematic'] as const }] : []),
    ]),
    ...each(water.washes, 'water.washes', '只染水色的水', ['schematic']),
    ...each(scene.places, 'places', '地名点'),
    ...each(scene.far, 'far', '远处'),
    ...scene.roads.journeys.flatMap((journey, i) =>
      journey.parts.map((part, j) => ({ path: `roads.journeys[${i}].parts[${j}]`, what: `路“${journey.id}/${j + 1}”`, grounds: part as Grounds, only: ['text', 'schematic'] as const })),
    ),
  ];
}

/**
 * 规则 12 类别和依据（全程沙盘）：地形、地形的整理、每一处抹成海的地方、海面、海岸、每条河、每个湖和从它里面裁掉的角、
 * 每片只染水色的水、每个地名点、每个远处、每一趟路的每一截，都写了 class 和 basis；class 是真的、今天的位置、按史料摆的、
 * 示意的四类之一（全程沙盘上没有点缀）；真的、今天的位置、按史料摆的，至少有一个出处；出处都在场景文件自己的 sources 里；
 * 路的每一截只能是按史料摆的（画实线）或示意的（画虚线）；只染水色的水、抹成海的地方、从湖面里裁掉的角只能是示意的；
 * recipe 和 levels 写了 note；unsure 的写法和站点沙盘一样；sources 里 id 不重复，依据是三种之一，出处写了。
 */
export function checkRouteGrounds(scene: RouteScene, file: string): Violation[] {
  const out: Violation[] = [];
  const bad = (field: string, problem: string) => out.push(violation(12, file, field, problem));
  const known = scene.sources.map((source) => source.id);

  scene.sources.forEach((source, i) => {
    if (source.id.trim() === '') bad(`sources[${i}].id`, '没有填 id');
    else if (known.indexOf(source.id) < i) bad(`sources[${i}].id`, `出处的 id“${source.id}”和第 ${known.indexOf(source.id) + 1} 条重复了`);
    if (!SOURCE_BASES.includes(source.basis)) bad(`sources[${i}].basis`, `出处“${source.id}”的依据是“${source.basis}”，只能是 own-words（他本人的诗文书信）、record（史书和同时代人的记载）、later（后人的记载和研究）之一`);
    if (source.cite.trim() === '') bad(`sources[${i}].cite`, `出处“${source.id}”没有写是哪一种书、哪一篇`);
  });
  const sources = (ids: string[], path: string, what: string) => {
    ids.forEach((id, j) => {
      if (!known.includes(id)) bad(`${path}.sourceIds[${j}]`, `${what}的出处“${id}”在这个文件的 sources 里找不到`);
    });
  };

  for (const { path, what, grounds, only } of grounded(scene)) {
    const cls: string = grounds.class;
    const isClass = (SCENE_CLASSES as readonly string[]).includes(cls);
    if (!isClass) bad(`${path}.class`, `${what}的类别是“${cls}”，只能是 ${CLASS_LIST}之一`);
    else if (cls === 'dressing') bad(`${path}.class`, `${what}的类别是 dressing（点缀）；全程沙盘上没有点缀，只用另外四类`);
    else if (only && !(only as readonly string[]).includes(cls)) {
      const allowed = only.length === 1 ? SCHEMATIC_ONLY : '只能是 text（按史料摆的，画实线）或 schematic（示意的，画虚线）';
      bad(`${path}.class`, `${what}的类别${allowed}，现在是“${cls}”`);
    }
    if (grounds.basis.trim() === '') bad(`${path}.basis`, `${what}没有写依据：为什么这样画，一两句话`);
    if (NEEDS_SOURCE.includes(cls) && grounds.sourceIds.length === 0) {
      bad(`${path}.sourceIds`, `${what}的类别是“${SCENE_CLASS_LABEL[cls as SceneClass]}”，至少要填一个出处`);
    }
    sources(grounds.sourceIds, path, what);
    const unsure = grounds.unsure === undefined ? null : unsureProblem(grounds.unsure);
    if (unsure) bad(`${path}.unsure`, `${what}的 unsure ${unsure}`);
  }
  if (!scene.terrain.recipe.note?.trim()) bad('terrain.recipe.note', '地形的整理必须写 note：每一节的说明里都有这一句');
  if (!scene.water.levels.note?.trim()) bad('water.levels.note', '海面必须写 note：沙盘旁边给读者看的一句话');
  scene.notDrawn.forEach((omission, i) => sources(omission.sourceIds, `notDrawn[${i}]`, `没有画的“${omission.id}”`));
  return out;
}

// ---------------------------------------------------------------- 带 id 的东西

type RouteIdKind = 'edit' | 'river' | 'lake' | 'cut' | 'wash' | 'place' | 'strip' | 'far' | 'way' | 'journey' | 'notDrawn';

interface RouteIdEntry {
  kind: RouteIdKind;
  path: string;
  id: string;
  /** 给读者看的名字；题签和一截路没有。 */
  name?: string;
  /** 旁边要说的那句话：没有画的东西是它的 why；一趟路是它各截写了的 note 接起来。 */
  note?: string;
}

/** 全程沙盘场景文件里所有带 id 的东西，按写的先后。 */
function routeIdEntries(scene: RouteScene): RouteIdEntry[] {
  const each = <T extends { id: string; name?: string }>(items: T[], kind: RouteIdKind, path: string, note: (item: T) => string | undefined) =>
    items.map((item, i): RouteIdEntry => ({ kind, path: `${path}[${i}]`, id: item.id, name: item.name, note: note(item) }));
  const ofGrounds = (item: Grounds) => item.note;
  return [
    ...each(scene.terrain.edits, 'edit', 'terrain.edits', ofGrounds),
    ...each(scene.water.rivers, 'river', 'water.rivers', ofGrounds),
    ...scene.water.lakes.flatMap((lake, i): RouteIdEntry[] => [
      { kind: 'lake', path: `water.lakes[${i}]`, id: lake.id, name: lake.name, note: lake.note },
      ...(lake.except ? [{ kind: 'cut' as const, path: `water.lakes[${i}].except`, id: lake.except.id, name: lake.except.name, note: lake.except.note }] : []),
    ]),
    ...each(scene.water.washes, 'wash', 'water.washes', ofGrounds),
    ...each(scene.places, 'place', 'places', ofGrounds),
    ...each(scene.strips, 'strip', 'strips', () => undefined),
    ...each(scene.far, 'far', 'far', ofGrounds),
    ...each(scene.roads.ways, 'way', 'roads.ways', () => undefined),
    ...each(scene.roads.journeys, 'journey', 'roads.journeys', (journey) =>
      journey.parts
        .map((part) => part.note?.trim() ?? '')
        .filter((note) => note !== '')
        .join(''),
    ),
    ...each(scene.notDrawn, 'notDrawn', 'notDrawn', (item) => item.why),
  ];
}

/** 题签的 of 可以指的东西。 */
const STRIP_TARGETS: readonly RouteIdKind[] = ['place', 'river', 'lake', 'wash', 'far'];
/** 镜头的 mustShow 可以指的东西。 */
const SHOWABLE: readonly RouteIdKind[] = ['place', 'river', 'lake', 'wash', 'far', 'journey'];
/** explain 可以点到的东西（另有四个留用的词）。 */
const EXPLAINABLE: readonly RouteIdKind[] = ['edit', 'river', 'lake', 'cut', 'wash', 'place', 'far', 'journey', 'notDrawn'];

/** 一趟路里写的一截路：去掉前面表示“倒着走”的减号。 */
function wayRef(written: string): { id: string; reversed: boolean } {
  return written.startsWith('-') ? { id: written.slice(1), reversed: true } : { id: written, reversed: false };
}

// ---------------------------------------------------------------- 规则 13 零件

/**
 * 规则 13 零件（全程沙盘）：id 在整个文件里不重复，没有用那五个留用的词，不带“/”（一截路在说明和凭据里的 id 是“<这一趟>/<第几截>”），
 * 路的 id 不以“-”开头（那是“倒着走”的记号）；带名字的东西名字都填了（一趟路的每一截也要有名字），没有画的东西填了 why；
 * 河的 line 和 today 正好写一个，line 至少两个点，today 至少一条取法、每条至少一个名字、范围的两头没有写反；
 * 河写了 weight，运河不写；湖的 today 至少一条取法；一圈线（抹成海的、裁掉的、只染水色的、留白的）至少三个点，
 * 最后一点不重复第一点；只染水色的水至少一圈；
 * 一截路至少两个点；along 指的是场景里的一条河或一个湖；每一截路都有哪一趟走到；
 * 一趟路至少一截、写了时间，每一截至少一截路，写的路都找得到；一趟路里后一截路的头接着前一截路的尾（差不到 1 公里）；
 * 每一趟路到的那一站是 figure.json 里有的，每一站至少有一趟路；地名点的 stops 写的都是 figure.json 里有的站；
 * 地名点的 area（这个名字没有点）只能写 true，写了它的不能又写 stops；
 * 凭据开头的几条总的说明（general）：每一条的 id 填了，在这一组里不重复，那一段话不是空的。
 */
export function checkRouteParts(scene: RouteScene, file: string, stops: string[]): Violation[] {
  const out: Violation[] = [];
  const bad = (field: string, problem: string) => out.push(violation(13, file, field, problem));
  const coords = coordsFor(scene);

  // id 和名字
  const entries = routeIdEntries(scene);
  entries.forEach((entry, i) => {
    const first = entries.findIndex((other) => other.id === entry.id);
    if (entry.id.trim() === '') bad(`${entry.path}.id`, '没有填 id');
    else if ((ROUTE_RESERVED_IDS as readonly string[]).includes(entry.id)) bad(`${entry.path}.id`, `“${entry.id}”这个词另有用处，不能当 id（留用的词：${ROUTE_RESERVED_IDS.join('、')}）`);
    else if (entry.id.includes('/')) bad(`${entry.path}.id`, `id“${entry.id}”里不能有“/”：一趟路的每一截在说明和凭据里叫“<这一趟的 id>/<第几截>”，带了“/”会和它们分不清`);
    else if (entry.kind === 'way' && entry.id.startsWith('-')) bad(`${entry.path}.id`, `路的 id“${entry.id}”不能以“-”开头：一趟路里前面加“-”是“倒着走”的意思`);
    else if (first < i) bad(`${entry.path}.id`, `id“${entry.id}”和 ${entries[first].path} 重复了；带 id 的东西，id 在整个场景文件里不能重复`);
    if (entry.name !== undefined && entry.name.trim() === '') bad(`${entry.path}.name`, `“${entry.id}”没有填名字：说明和凭据里要用它`);
    if (entry.kind === 'notDrawn' && !entry.note?.trim()) bad(`${entry.path}.why`, `没有画的“${entry.id}”没有写为什么不画：凭据里要印这一句`);
  });
  if (scene.water.coast.name.trim() === '') bad('water.coast.name', '海岸没有填名字：说明和凭据里要用它');

  // 凭据开头的几条总的说明：id 只在这一组里认（不进上面那张整个文件的单子：小节的 explain 点不到它），不重复；每一条都有话
  const general = scene.general ?? [];
  general.forEach((line, i) => {
    if (line.id.trim() === '') bad(`general[${i}].id`, '这一条总的说明没有填 id');
    else if (general.findIndex((other) => other.id === line.id) < i) bad(`general[${i}].id`, `id“${line.id}”在 general 里写了不止一次；这一组里 id 不能重复`);
    if (line.text.trim() === '') bad(`general[${i}].text`, `总的说明“${line.id}”是空的：凭据的开头要印这一段话，没有话就把这一条删掉`);
  });

  // 一圈线
  const ring = (points: LngLat[], field: string, what: string): void => {
    if (points.length < 3) bad(field, `${what}是一圈闭合的线，至少要有三个点，现在是 ${points.length} 个`);
    else if (samePoint(points[0], points[points.length - 1])) bad(field, `${what}的最后一点和第一点一样；闭合的线不用把第一点再写一遍，去掉最后这一点`);
  };
  scene.terrain.recipe.blank.forEach((points, i) => ring(points, `terrain.recipe.blank[${i}]`, `留白的第 ${i + 1} 圈`));
  scene.terrain.edits.forEach((edit, i) => ring(edit.area, `terrain.edits[${i}].area`, `抹成海的“${edit.id}”`));

  // 水
  const picks = (written: TodayPick[], field: string, what: string): void => {
    if (written.length === 0) bad(field, `${what}的 today 是空的：照今天的数据画，至少写一条取法`);
    written.forEach((pick, j) => {
      if (pick.names.length === 0) bad(`${field}[${j}].names`, `${what}的这一条取法没有写名字`);
      if (pick.west !== undefined && pick.east !== undefined && pick.west >= pick.east) bad(`${field}[${j}].west`, `west（${pick.west}）应该比 east（${pick.east}）小`);
      if (pick.south !== undefined && pick.north !== undefined && pick.south >= pick.north) bad(`${field}[${j}].south`, `south（${pick.south}）应该比 north（${pick.north}）小`);
    });
  };
  scene.water.rivers.forEach((river, i) => {
    const at = `water.rivers[${i}]`;
    const what = `“${river.id}”`;
    if (river.line !== undefined && river.today !== undefined) bad(at, `${what}的 line 和 today 都写了，只能写一个：自己写线，或者照今天的数据画`);
    else if (river.line === undefined && river.today === undefined) bad(at, `${what}没有写怎么画：line（自己写的线）和 today（照今天的数据画）要写一个`);
    if (river.line !== undefined && river.line.length < 2) bad(`${at}.line`, `${what}的线至少要有两个点`);
    if (river.today !== undefined) picks(river.today, `${at}.today`, what);
    if (river.kind === 'canal' && river.weight !== undefined) bad(`${at}.weight`, `${what}是运河，画成一道细线，不写 weight`);
    if (river.kind === 'river' && river.weight === undefined) bad(`${at}.weight`, `${what}是河，要写 weight（画多粗）：trunk、major、river 或 minor`);
  });
  scene.water.lakes.forEach((lake, i) => {
    picks(lake.today, `water.lakes[${i}].today`, `湖“${lake.id}”`);
    if (lake.except) ring(lake.except.area, `water.lakes[${i}].except.area`, `从湖面里裁掉的“${lake.except.id}”`);
  });
  scene.water.washes.forEach((wash, i) => {
    if (wash.areas.length === 0) bad(`water.washes[${i}].areas`, `“${wash.id}”没有写在哪：至少写一圈`);
    wash.areas.forEach((points, j) => ring(points, `water.washes[${i}].areas[${j}]`, `“${wash.id}”的第 ${j + 1} 圈`));
  });

  // 地名点是哪几站
  scene.places.forEach((place, i) => {
    place.stops?.forEach((stop, j) => {
      if (!stops.includes(stop)) bad(`places[${i}].stops[${j}]`, `地名点“${place.id}”写的站“${stop}”在 figure.json 里找不到`);
      else if (place.stops !== undefined && place.stops.indexOf(stop) < j) bad(`places[${i}].stops[${j}]`, `地名点“${place.id}”的 stops 里“${stop}”写了不止一次`);
    });
    // 这个名字没有点（area）：只能写 true；是站的地方不能写（它的题签要指着那一点）
    const area: unknown = place.area;
    if (area !== undefined && area !== true) bad(`places[${i}].area`, `地名点“${place.id}”的 area 只能写 true（这个名字指的是一片地方，没有点）；不要这个记号就不写这个字段`);
    else if (area === true && place.stops !== undefined) bad(`places[${i}].area`, `地名点“${place.id}”写了 area（这个名字没有点），又写了 stops：一站是一个地方，它的题签要指着那一点；两样只能写一样`);
  });

  // 路
  const { ways, journeys } = scene.roads;
  const waters = [...scene.water.rivers, ...scene.water.lakes].map((item) => item.id);
  ways.forEach((way, i) => {
    if (way.line.length < 2) bad(`roads.ways[${i}].line`, `路“${way.id}”的线至少要有两个点`);
    if (way.along !== undefined && !waters.includes(way.along)) bad(`roads.ways[${i}].along`, `路“${way.id}”写的 along 是“${way.along}”，场景里没有 id 是它的河或湖`);
  });
  const used = new Set<string>();
  journeys.forEach((journey, i) => {
    const at = `roads.journeys[${i}]`;
    const what = `路“${journey.id}”`;
    if (journey.date.trim() === '') bad(`${at}.date`, `${what}没有写时间`);
    if (!stops.includes(journey.stop)) bad(`${at}.stop`, `${what}到的站“${journey.stop}”在 figure.json 里找不到`);
    if (journey.parts.length === 0) bad(`${at}.parts`, `${what}一截也没有写`);
    /** 上一截路的尾：在哪，是哪一截。 */
    let tail: { at: LngLat; id: string } | null = null;
    journey.parts.forEach((part, j) => {
      const partAt = `${at}.parts[${j}]`;
      if (part.name.trim() === '') bad(`${partAt}.name`, `路“${journey.id}/${j + 1}”没有填名字：说明和凭据里要用它`);
      if (part.ways.length === 0) bad(`${partAt}.ways`, `路“${journey.id}/${j + 1}”没有写走哪几截路`);
      part.ways.forEach((written, k) => {
        const ref = wayRef(written);
        const way = ways.find((item) => item.id === ref.id);
        if (!way) {
          bad(`${partAt}.ways[${k}]`, `路“${journey.id}/${j + 1}”写的“${written}”找不到：roads.ways 里没有 id 是“${ref.id}”的路`);
          tail = null;
          return;
        }
        used.add(way.id);
        if (way.line.length < 2) {
          tail = null;
          return;
        }
        const head = ref.reversed ? way.line[way.line.length - 1] : way.line[0];
        if (tail && coords) {
          const gap = kmOf(scene, Math.hypot(coords.toLocal(head)[0] - coords.toLocal(tail.at)[0], coords.toLocal(head)[1] - coords.toLocal(tail.at)[1]));
          if (gap > WAY_JOIN_MAX_KM) {
            bad(`${partAt}.ways[${k}]`, `${what}在这里断了：“${written}”的头离上一截“${tail.id}”的尾有 ${Math.round(gap)} 公里，不能超过 ${WAY_JOIN_MAX_KM} 公里（要倒着走的在前面加“-”）`);
          }
        }
        tail = { at: ref.reversed ? way.line[0] : way.line[way.line.length - 1], id: written };
      });
    });
  });
  ways.forEach((way, i) => {
    if (!used.has(way.id)) bad(`roads.ways[${i}]`, `路“${way.id}”哪一趟也没有走到；用不着就删掉`);
  });
  // 看一站的小节画的是这一站那几年走的路的沙盘（roads.stopShows 写 stop-years）：一趟的 stop 是它算在哪一站名下
  const years = scene.roads.stopShows === 'stop-years';
  for (const stop of stops) {
    if (!journeys.some((journey) => journey.stop === stop)) bad('roads.journeys', `“${stop}”这一站一趟路也没有；每一站至少要有一趟${years ? '算在它名下的路（stop 写着它）' : '到它那里去的路'}`);
  }
  return out;
}

// ---------------------------------------------------------------- 规则 14 小节

/**
 * 规则 14 小节（全程沙盘）：头一节看全程，不写 stop；后面 figure.json 里的每一站正好一节，先后和站一样；
 * 小节的名字不重复，最多七个字；每节有时间、题记（不超过 40 个字）；题签指到远处的小节，题记连同远处的那句话不超过 50 个字宽；
 * explain 至少一样，写的 id 都找得到（可以写抹成海的地方、河、湖、从湖面里裁掉的角、只染水色的水、地名点、远处、一趟路、
 * 没有画的东西的 id，或者 terrain、recipe、levels、coast），点到的东西都有 note（一趟路是它的各截里至少一截有）；
 * mustShow 写的 id 都找得到（地名点、河、湖、只染水色的水、远处、一趟路，或者 frame）。
 */
export function checkRouteSections(scene: RouteScene, file: string, stops: string[]): Violation[] {
  const out: Violation[] = [];
  const bad = (field: string, problem: string) => out.push(violation(14, file, field, problem));
  const entries = routeIdEntries(scene);
  const headings = scene.sections.map((section) => section.heading);

  // 头一节是全程，后面每一站一节
  if (scene.sections.length === 0) bad('sections', '一节也没有：头一节看全程，后面每一站一节');
  else if (scene.sections[0].stop !== undefined) bad('sections[0].stop', `头一节看的是全程，不写 stop（现在写的是“${scene.sections[0].stop}”）`);
  const later = scene.sections.slice(1);
  later.forEach((section, n) => {
    const i = n + 1;
    if (section.stop === undefined) bad(`sections[${i}]`, `小节“${section.heading}”没有写 stop：头一节以后，每一节看的是${scene.roads.stopShows === 'stop-years' ? '哪一站那几年走的路' : '到哪一站的来路'}`);
    else if (!stops.includes(section.stop)) bad(`sections[${i}].stop`, `小节“${section.heading}”写的站“${section.stop}”在 figure.json 里找不到`);
    else if (later.findIndex((other) => other.stop === section.stop) < n) bad(`sections[${i}].stop`, `“${section.stop}”这一站写了不止一节`);
  });
  const sectionStops = later.map((section) => section.stop);
  let complete = sectionStops.every((stop, n) => stop !== undefined && stops.includes(stop) && sectionStops.indexOf(stop) === n);
  for (const stop of stops) {
    if (sectionStops.includes(stop)) continue;
    bad('sections', `“${stop}”这一站没有小节；头一节以后，figure.json 里的每一站正好一节`);
    complete = false;
  }
  if (complete && sectionStops.join('\n') !== stops.join('\n')) bad('sections', `小节的先后和 figure.json 里的站不一样；站的先后是：${stops.join('、')}`);

  scene.sections.forEach((section, i) => {
    const at = `sections[${i}]`;
    const heading = section.heading.trim();
    if (heading === '') bad(`${at}.heading`, '这一节没有名字');
    else if (headings.indexOf(section.heading) < i) bad(`${at}.heading`, `小节“${section.heading}”写了不止一次`);
    else if ([...heading].length > ROUTE_HEADING_MAX) bad(`${at}.heading`, `小节的名字“${heading}”有 ${[...heading].length} 个字，最多 ${ROUTE_HEADING_MAX} 个`);

    if (section.date.trim() === '') bad(`${at}.date`, `小节“${section.heading}”没有写时间`);
    const length = [...section.line.trim()].length;
    if (length === 0) bad(`${at}.line`, `小节“${section.heading}”没有写题记`);
    else if (length > LINE_MAX) bad(`${at}.line`, `小节“${section.heading}”的题记有 ${length} 个字，不能超过 ${LINE_MAX} 个`);
    else {
      const far = farWords(section.heading);
      const width = textWidth(section.line.trim()) + far.reduce((sum, words) => sum + 0.5 + textWidth(words), 0);
      if (far.length > 0 && width > WORDS_MAX) {
        bad(
          `${at}.line`,
          `小节“${section.heading}”的题记后面还要接远处的那句话（${far.join('；')}），合起来有 ${Math.ceil(width)} 个字宽，沙盘栏窄的时候两行放不下；不能超过 ${WORDS_MAX} 个字宽，把题记写短一些`,
        );
      }
    }

    if (section.explain.length === 0) bad(`${at}.explain`, `小节“${section.heading}”的 explain 是空的：旁边的说明先讲哪几样，至少写一样`);
    section.explain.forEach((id, j) => {
      const note = explained(id);
      if (note === null && scene.general?.some((line) => line.id === id)) {
        // 凭据开头的总的说明不是沙盘上的哪一样东西：只印在凭据里，小节的说明点不到它
        bad(`${at}.explain[${j}]`, `“${id}”是 general 里的一条总的说明：它只印在凭据的开头，小节的 explain 不能点它；要在这一节说的话，写进这一节点到的东西的 note`);
      } else if (note === null) {
        bad(`${at}.explain[${j}]`, `“${id}”找不到；这里可以写抹成海的地方、河、湖、从湖面里裁掉的角、只染水色的水、地名点、远处、一趟路、没有画的东西的 id，或者 terrain、recipe、levels、coast`);
      } else if (!note?.trim()) {
        const kind = entries.find((entry) => entry.id === id)?.kind;
        bad(`${at}.explain[${j}]`, `“${id}”没有写 ${kind === 'notDrawn' ? 'why' : 'note'}${kind === 'journey' ? '（一趟路是它的各截里至少一截要写）' : ''}；explain 里点到的东西都要有一句给读者看的说明`);
      }
    });

    section.camera.mustShow?.forEach((id, j) => {
      if (id !== 'frame' && !entries.some((entry) => entry.id === id && SHOWABLE.includes(entry.kind))) {
        bad(`${at}.camera.mustShow[${j}]`, `“${id}”找不到；这里可以写地名点、河、湖、只染水色的水、远处、一趟路的 id，或者 frame（整块沙盘）`);
      }
    });
  });
  return out;

  /**
   * 这一节的题签指到的远处，在沙盘旁边各印成什么字：用的就是页面印这几个字的那个函数（和站点沙盘的校验一样）。
   * 题签没写 at 的拼不出来，当没有（规则 15 会报）；整节拼不出来也当没有，别的规则会报。
   */
  function farWords(heading: string): string[] {
    try {
      return sectionInfo(scene, heading).far.map((far) => `${far.name}：${far.say}`);
    } catch {
      return [];
    }
  }

  /** explain 里的一个 id 指的那样东西的 note；找不到这样东西时是 null。 */
  function explained(id: string): string | undefined | null {
    if (id === 'terrain') return scene.terrain.note;
    if (id === 'recipe') return scene.terrain.recipe.note;
    if (id === 'levels') return scene.water.levels.note;
    if (id === 'coast') return scene.water.coast.note;
    const entry = entries.find((e) => e.id === id && EXPLAINABLE.includes(e.kind));
    return entry ? entry.note : null;
  }
}

// ---------------------------------------------------------------- 规则 15 题签

/**
 * 规则 15 题签（全程沙盘）：text 和 modern 只能是汉字，一到七个；of 指的是地名点、河、湖、只染水色的水、远处，或者 coast（海）；
 * 指着河的要写 at，离河的线不超过 6 公里；指着湖、只染水色的水的要写 at，落在它里面；指着 coast 的要写 at，落在海里
 * （今天的陆地外面，或者一处抹成海的圈里面）；指着远处的要写 at（路出沙盘的那一点），离沙盘的边不超过 5 公里；
 * 每节一到十二条，不重复，写的都是文件里有的题签；
 * figure.json 里的每一站，都有一个地名点的 stops 里写着它，而且这个地名点的题签在头一节和这一站自己的那一节里都摆着。
 * today 是读好的“今天的海岸、湖、河”；读不出来时，要用到它的几处先不查（规则 10 会报）。
 */
export function checkRouteStrips(scene: RouteScene, file: string, stops: string[], today: Today): Violation[] {
  const out: Violation[] = [];
  const bad = (field: string, problem: string) => out.push(violation(15, file, field, problem));
  const coords = coordsFor(scene);
  const entries = routeIdEntries(scene);
  const features = today && 'features' in today ? today.features : null;
  const local = (p: LngLat): XZ => (coords ? coords.toLocal(p) : [0, 0]);

  scene.strips.forEach((strip, i) => {
    const at = `strips[${i}]`;
    const what = `题签“${strip.id}”`;
    if (!HAN.test(strip.text)) bad(`${at}.text`, `${what}的字是“${strip.text}”；只能是汉字，一到七个，不带标点、数字和空格`);
    if (strip.modern !== undefined && !HAN.test(strip.modern)) bad(`${at}.modern`, `${what}今天的名字是“${strip.modern}”；只能是汉字，一到七个，不带标点、数字和空格`);

    if (strip.of === 'coast') {
      if (strip.at === undefined) bad(`${at}.at`, `${what}指的是海，要写 at：指在海上的哪一点`);
      else if (features) {
        const point = strip.at;
        const inSeaEdit = scene.terrain.edits.some((edit) => edit.area.length >= 3 && insideRing(point, edit.area));
        const onLand = features.some((feature) => feature.kind === 'land' && feature.polygons.some((polygon) => inPolygon(point, polygon)));
        if (onLand && !inSeaEdit) bad(`${at}.at`, `${what}指的是海，at 却落在陆地上；挪到海里（今天的陆地外面，或者一处抹成海的圈里面）`);
      }
      return;
    }
    const target = entries.find((entry) => entry.id === strip.of && STRIP_TARGETS.includes(entry.kind));
    if (!target) {
      bad(`${at}.of`, `${what}指的“${strip.of}”找不到；这里可以写地名点、河、湖、只染水色的水、远处的 id，或者 coast（海）`);
      return;
    }
    if (target.kind === 'place') return;
    if (strip.at === undefined) {
      bad(`${at}.at`, target.kind === 'far' ? `${what}指的“${strip.of}”是远处，要写 at：路出沙盘的那一点` : `${what}指的“${strip.of}”是一条线或一片水，要写 at：指在它的哪一点`);
      return;
    }
    if (!coords) return;
    const p = local(strip.at);

    if (target.kind === 'river') {
      const river = scene.water.rivers.find((item) => item.id === strip.of);
      const lines = river?.line ? [river.line] : river?.today && features ? pickedLines(features, river.today) : null;
      if (!lines || lines.length === 0 || lines.some((line) => line.length < 2)) return;
      const away = kmOf(scene, Math.min(...lines.map((line) => toLine(p, line.map(local), false))));
      if (away > RIVER_STRIP_MAX_KM) bad(`${at}.at`, `${what}的 at 离它指的“${strip.of}”有 ${Math.round(away)} 公里，不能超过 ${RIVER_STRIP_MAX_KM} 公里`);
    } else if (target.kind === 'lake') {
      const lake = scene.water.lakes.find((item) => item.id === strip.of);
      if (!lake || !features) return;
      const point = strip.at;
      if (!pickedLakes(features, lake.today).some((polygon) => inPolygon(point, polygon))) bad(`${at}.at`, `${what}的 at 不在它指的湖“${strip.of}”里面`);
    } else if (target.kind === 'wash') {
      const wash = scene.water.washes.find((item) => item.id === strip.of);
      const point = strip.at;
      if (wash && !wash.areas.some((ring) => ring.length >= 3 && insideRing(point, ring))) bad(`${at}.at`, `${what}的 at 不在它指的“${strip.of}”的圈里面`);
    } else {
      // 远处：题签指的是路出沙盘的那一点，要贴着边
      const toEdge = kmOf(scene, Math.min(p[0] - coords.x0, coords.x1 - p[0], p[1] - coords.z0, coords.z1 - p[1]));
      if (toEdge > FAR_STRIP_MAX_KM) bad(`${at}.at`, `${what}指的是远处“${strip.of}”，at 要贴着沙盘的边（路出沙盘的那一点）：现在离边 ${Math.round(toEdge)} 公里，不能超过 ${FAR_STRIP_MAX_KM} 公里`);
    }
  });

  scene.sections.forEach((section, i) => {
    const at = `sections[${i}].strips`;
    if (section.strips.length < 1 || section.strips.length > ROUTE_STRIPS_MAX) bad(at, `小节“${section.heading}”有 ${section.strips.length} 条题签，应该是一到 ${ROUTE_STRIPS_MAX} 条`);
    section.strips.forEach((id, j) => {
      if (section.strips.indexOf(id) < j) bad(`${at}[${j}]`, `题签“${id}”在小节“${section.heading}”里写了不止一次`);
      else if (!scene.strips.some((strip) => strip.id === id)) bad(`${at}[${j}]`, `场景里没有 id 是“${id}”的题签`);
    });
  });

  // 每一站：有一个地名点是它，这个地名点的题签在头一节和它自己的那一节里
  const shown = (placeId: string, sectionIndex: number): boolean =>
    sectionIndex >= 0 && scene.sections[sectionIndex].strips.some((id) => scene.strips.find((strip) => strip.id === id)?.of === placeId);
  for (const stop of stops) {
    const places = scene.places.filter((place) => place.stops?.includes(stop));
    if (places.length === 0) {
      bad('places', `“${stop}”这一站在沙盘上没有地名点：要有一个地名点的 stops 里写着它`);
      continue;
    }
    const own = scene.sections.findIndex((section, i) => i > 0 && section.stop === stop);
    // 这一站自己的小节不在的话，规则 14 会报
    if (scene.sections.length === 0 || own < 0) continue;
    if (!places.some((place) => shown(place.id, 0) && shown(place.id, own))) {
      const names = places.map((place) => `“${place.id}”`).join('、');
      bad('sections', `“${stop}”这一站的地名点（${names}）要有一个的题签在头一节“${scene.sections[0].heading}”和它自己的那一节“${scene.sections[own].heading}”里都摆着`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- 规则 20 站的位置

/**
 * 规则 20 站的位置：figure.json 里每一站的位置（place.lngLat），和全程沙盘上 stops 里写着这一站的一个地名点，
 * 经度、纬度各差不到 0.02 度。没有全程沙盘的人物没有可比的，不查；哪一站在沙盘上没有地名点，规则 15 另报。
 * figureFile 是 figure.json 的路径；问题记在它上面。
 */
export function checkStopPlaces(figure: Figure, figureFile: string, scene: RouteScene): Violation[] {
  const out: Violation[] = [];
  figure.stops.forEach((stop, i) => {
    const written: unknown = stop.place.lngLat;
    if (lngLatProblem(written) !== null) return;
    const at = written as LngLat;
    const places = scene.places.filter((place) => place.stops?.includes(stop.id));
    if (places.length === 0) return;
    const away = (place: { at: LngLat }): number => Math.max(Math.abs(place.at[0] - at[0]), Math.abs(place.at[1] - at[1]));
    const nearest = places.reduce((best, place) => (away(place) < away(best) ? place : best));
    // 留一点算术上的余量：正好差 0.02 度算合格
    if (away(nearest) > STOP_PLACE_MAX_DEG + 1e-9) {
      out.push(
        violation(
          20,
          figureFile,
          `stops[${i}].place.lngLat`,
          `“${stop.shortTitle}”这一站写在 [${at[0]}, ${at[1]}]，全程沙盘（scenes/${ROUTE_SCENE_ID}.json）上它的地名点“${nearest.id}”在 [${nearest.at[0]}, ${nearest.at[1]}]，差了 ${away(nearest).toFixed(3)} 度；两处要对得上（经度、纬度各差不到 ${STOP_PLACE_MAX_DEG} 度）`,
        ),
      );
    }
  });
  return out;
}

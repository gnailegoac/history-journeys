// 全程沙盘自己说的两件事（场景文件的 roads.stopShows、roads.boats），“每一座”的验收照它们怎么查。
// tests/stage/route-views.test.ts、route-roads.test.ts 对 content/ 里的每一座用这里的函数；编出来的那一座
// （./madeUpRoute.ts，tests/stage/made-up-route.test.ts）用的也是这几个：两种写法各有一座沙盘真的走到。
// 只算数，不碰磁盘。沿线取点、量离线多远的几个小函数也在这里（原来在 route-roads.test.ts 里，搬过来两边共用）。

import type { RouteScene } from '../../../src/domain/scene';
import type { FrameCoords } from '../../../src/domain/sceneGeo';
import type { LngLat } from '../../../src/domain/types';
import { pickedLakes } from '../../content/routeRules';
import type { TodayFeature } from '../../content/routeRules';
import type { RiverPath } from '../../tools/route/paint';

// ---------------------------------------------------------------- 沿线取点，量离线多远

/** 沿线每隔多少公里取一个点。 */
export const STEP_KM = 2;

export const insideRing = (p: LngLat, ring: LngLat[]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};
const insidePolygon = (p: LngLat, polygon: LngLat[][]): boolean => insideRing(p, polygon[0]) && !polygon.slice(1).some((hole) => insideRing(p, hole));

export interface Boxed {
  polygon: LngLat[][];
  box: [number, number, number, number];
}
export function boxed(polygon: LngLat[][]): Boxed {
  let w = Infinity;
  let e = -Infinity;
  let s = Infinity;
  let n = -Infinity;
  for (const [lng, lat] of polygon[0]) {
    w = Math.min(w, lng);
    e = Math.max(e, lng);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  return { polygon, box: [w, e, s, n] };
}
export const inAny = (p: LngLat, list: Boxed[]): boolean => list.some(({ polygon, box }) => p[0] >= box[0] && p[0] <= box[1] && p[1] >= box[2] && p[1] <= box[3] && insidePolygon(p, polygon));

/** 沿一条线每 STEP_KM 公里取一个点（两头也取）：经纬度，和它是从头量起的第几公里。 */
export function along(scene: RouteScene, coords: FrameCoords, line: LngLat[]): { at: LngLat; km: number }[] {
  const out: { at: LngLat; km: number }[] = [];
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = coords.toLocal(line[i - 1]);
    const [bx, bz] = coords.toLocal(line[i]);
    const km = (Math.hypot(bx - ax, bz - az) * scene.frame.scale) / 1000;
    const steps = Math.max(1, Math.ceil(km / STEP_KM));
    for (let s = i === 1 ? 0 : 1; s <= steps; s++) {
      const t = s / steps;
      out.push({ at: coords.toLngLat(ax + (bx - ax) * t, az + (bz - az) * t), km: walked + km * t });
    }
    walked += km;
  }
  return out;
}

/** 一点离画在地面上的几条线最近多少公里。lines 是沙盘里的米（riverPaths 给的）。 */
export function kmToPainted(scene: RouteScene, coords: FrameCoords, p: LngLat, lines: [number, number][][]): number {
  const [px, pz] = coords.toLocal(p);
  let best = Infinity;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const [ax, az] = line[i - 1];
      const dx = line[i][0] - ax;
      const dz = line[i][1] - az;
      const t = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
      best = Math.min(best, Math.hypot(px - ax - dx * t, pz - az - dz * t));
    }
  }
  return (best * scene.frame.scale) / 1000;
}

// ---------------------------------------------------------------- roads.stopShows：看一站的小节画的是什么

/** 这座沙盘看一站的小节画的是不是“这一站那几年走的路”（roads.stopShows 写 stop-years）；不写、写 way-there 是到这一站的来路。 */
export const showsStopYears = (scene: RouteScene): boolean => scene.roads.stopShows === 'stop-years';

/**
 * 这一站自己的路是不是都得落在画面里。看来路的沙盘：是（镜头照着来路摆）。看“那几年走的路”的沙盘：不是——
 * 这一站那几年里可以走出去很远，画面只管这一站一带。
 */
export const ownRoadsHeldInPane = (scene: RouteScene): boolean => !showsStopYears(scene);

/**
 * 每一节看一站的小节讲不讲这一站自己的路，不合的各写一句（都合是空的）。
 * 看来路的沙盘：explain 里有到这一站的每一趟路，mustShow 里也有（镜头照着路摆）。
 * 看“那几年走的路”的沙盘：explain 里至少有一趟这一站自己的路；mustShow 不管路。
 * 两种都要：这一站至少有一趟自己的路。
 */
export function ownJourneysTold(scene: RouteScene): string[] {
  const out: string[] = [];
  for (const section of scene.sections.slice(1)) {
    const own = scene.roads.journeys.filter((journey) => journey.stop === section.stop).map((journey) => journey.id);
    if (own.length === 0) out.push(`${section.heading}：这一站自己的路一趟也没有`);
    if (showsStopYears(scene)) {
      if (own.length > 0 && !own.some((id) => section.explain.includes(id))) out.push(`${section.heading} 的 explain 里一趟这一站自己的路也没有（有 ${own.join('、')}）`);
      continue;
    }
    for (const id of own) {
      if (!section.explain.includes(id)) out.push(`${section.heading} 的 explain 里没有 ${id}`);
      // mustShow 里也有这几趟路：镜头照着路摆
      if (!(section.camera.mustShow ?? []).includes(id)) out.push(`${section.heading} 的 mustShow 里没有 ${id}`);
    }
  }
  return out;
}

/**
 * 一节看一站的小节，展开的说明里一定印着哪几趟路的 note（每一截写了的每一句）。
 * 看来路的沙盘：到这一站的每一趟（它们都在 explain 里，见 ownJourneysTold）。
 * 看“那几年走的路”的沙盘：这一站自己的路里 explain 点到的那几趟——一站那几年的路可以有几十趟，不是每一趟的话都印在这一节；
 * 没有点到的，note 在凭据里，或者在点到它的别的小节里。
 */
export function journeysWithNotesPrinted(scene: RouteScene, section: { stop?: string; explain: string[] }): RouteScene['roads']['journeys'] {
  const own = scene.roads.journeys.filter((journey) => section.stop !== undefined && journey.stop === section.stop);
  return showsStopYears(scene) ? own.filter((journey) => section.explain.includes(journey.id)) : own;
}

/**
 * “几样是示意”里只在题签指到的那一节才算的东西，这一节算进去了几样：远处，和名字没有点的地名点（写了 area 的），归在示意一类的
 *（docs/data-spec.md“沙盘旁边的说明”）。每一座全程沙盘的测试另数一遍各节的数时，把它和画着的路的截一起减掉，剩下的每一节一样多。
 */
export function schematicWherePointed(scene: RouteScene, section: { strips: string[] }): number {
  const pointed = new Set(section.strips.map((id) => scene.strips.find((strip) => strip.id === id)?.of));
  return [...scene.far, ...scene.places.filter((place) => place.area)].filter((thing) => thing.class === 'schematic' && pointed.has(thing.id)).length;
}

// ---------------------------------------------------------------- 镜头最近多近：一座沙盘一个数

/**
 * 全程沙盘上看一站的小节（不看整块沙盘的），镜头的 distanceM 最小多少（沙盘里的米）。它管的是先画好的地面近看有多粗：
 * 地面是一张图（一格地面三个点），镜头越近，图上的一个点在画面上越大。一座沙盘一个数——照它的图有多细、它的小节要看多小的一块地定的
 *（docs/data-spec.md“全程沙盘的场景数据”的“小节”）；写在这张表里，键是“人物/route”。给一座沙盘定一个比 15,000 小的数，
 * 就是认了它近看的那几节地面粗一些：定之前在真的图片上看过。
 * 苏轼的这一座是 15,000：再近，图上的一个点（6.66 米）在 900 像素高的栏里就超过 1.26 个像素。
 */
export const ROUTE_CAMERA_NEAREST_M: Readonly<Record<string, number>> = { 'su-shi/route': 15_000 };
/** 表里没有的沙盘照这个数查（就是苏轼的那个数）。 */
export const ROUTE_CAMERA_NEAREST_DEFAULT_M = 15_000;

/** key 这座全程沙盘的那个数：表里有就是表里的，没有是 15,000。table 不写用上面那张表（测试交编出来的表）。 */
export const routeCameraNearestM = (key: string, table: Readonly<Record<string, number>> = ROUTE_CAMERA_NEAREST_M): number => table[key] ?? ROUTE_CAMERA_NEAREST_DEFAULT_M;

/**
 * 看一站的小节里，镜头比 nearestM 近的各写一句（都不近是空的）。看整块沙盘的一节（mustShow 里写了 frame）不查：它由 closest 管。
 * “每一座”的验收和算镜头的工具（npm run route:camera）用的都是这一个。
 */
export function camerasTooNear(scene: RouteScene, nearestM: number): string[] {
  return scene.sections
    .filter((section) => !(section.camera.mustShow ?? []).includes('frame') && section.camera.distanceM < nearestM)
    .map((section) => `${section.heading}：distanceM 写的是 ${section.camera.distanceM}，这座沙盘最近 ${nearestM}`);
}

// ---------------------------------------------------------------- roads.boats：船走的线画在哪

/** 这座沙盘的船是不是走在水上（roads.boats 写 on）；不写、写 beside 是画在河的一边。 */
export const boatsOn = (scene: RouteScene): boolean => scene.roads.boats === 'on';

/** 船走在水上的沙盘，各条水路离它的水最多差多少：一座沙盘自己定的两个数。 */
export interface BoatLimits {
  /** 沿着一条河走的水路，线上每一点离画出来的那条河最远多少公里。 */
  riverKm: number;
  /** 水路的两头各这么多公里以内不查：船要靠岸，城不在水的正中。 */
  landingKm: number;
}

/**
 * 船走在水上的沙盘：每一条水路（by 是 water）量一遍。写了 along 的：along 是河，线上每一点（两头 landingKm 以内除外）
 * 离画出来的那条河不超过 riverKm；along 是湖，每一点（两头除外）在湖的圈里面。
 * 没有写 along 的水路说不出走的是哪条水：另数（nameless），只印出来，不算不合。
 * 写了 along、可是短得两头各让出 landingKm 以后一个点也不剩的水路：一个点也没有量，也另数（unmeasured）、印出来——
 * 它没有不合，也没有查过；这样的路算不算数，是定那两个数的时候看着这张单子定的。
 * lines 是每条路量到的数（打印用），off 是不合的（哪条路、哪一点、差多少）。rivers 是这座沙盘的画法画在地面上的河。
 */
export function boatsOnWater(
  scene: RouteScene,
  coords: FrameCoords,
  features: TodayFeature[],
  rivers: RiverPath[],
  limits: BoatLimits,
): { lines: string[]; off: string[]; nameless: string[]; unmeasured: string[] } {
  const lines: string[] = [];
  const off: string[] = [];
  const nameless: string[] = [];
  const unmeasured: string[] = [];
  for (const way of scene.roads.ways) {
    if (way.by !== 'water') continue;
    if (!way.along) {
      nameless.push(way.id);
      continue;
    }
    const points = along(scene, coords, way.line);
    const total = points[points.length - 1].km;
    const inner = points.filter(({ km }) => km >= limits.landingKm && total - km >= limits.landingKm);
    const river = rivers.find((item) => item.id === way.along);
    const lake = scene.water.lakes.find((item) => item.id === way.along);
    if ((river || lake) && inner.length === 0) {
      unmeasured.push(way.id);
      lines.push(`  ${way.id} 走 ${river ? river.id : `${lake?.id}（湖）`}：${total.toFixed(0)} 公里，两头各让出 ${limits.landingKm} 公里以后一个点也不剩　← 没有量`);
      continue;
    }
    if (river) {
      let far = 0;
      let worst = inner[0];
      for (const point of inner) {
        const km = kmToPainted(scene, coords, point.at, river.lines);
        if (km > far) [far, worst] = [km, point];
      }
      const bad = far > limits.riverKm;
      if (bad) off.push(`${way.id}：第 ${worst.km.toFixed(0)} 公里（东经 ${worst.at[0].toFixed(2)}、北纬 ${worst.at[1].toFixed(2)}）离它走的河 ${river.id} 有 ${far.toFixed(1)} 公里，不能超过 ${limits.riverKm} 公里`);
      lines.push(`  ${way.id} 走 ${river.id}：${total.toFixed(0)} 公里，两头 ${limits.landingKm} 公里以外查了 ${inner.length} 个点，离画出来的河最远 ${far.toFixed(1)} 公里${bad ? '　← 不合' : ''}`);
    } else if (lake) {
      const areas = pickedLakes(features, lake.today).map(boxed);
      const out = inner.filter(({ at }) => !inAny(at, areas) || (lake.except !== undefined && insideRing(at, lake.except.area)));
      if (out.length > 0) off.push(`${way.id}：${out.length} 个点不在它走的湖 ${lake.id} 里，从第 ${out[0].km.toFixed(0)} 公里（东经 ${out[0].at[0].toFixed(2)}、北纬 ${out[0].at[1].toFixed(2)}）起`);
      lines.push(`  ${way.id} 走 ${lake.id}（湖）：${total.toFixed(0)} 公里，两头 ${limits.landingKm} 公里以外查了 ${inner.length} 个点，不在湖里的 ${out.length} 个${out.length > 0 ? '　← 不合' : ''}`);
    } else {
      off.push(`${way.id}：along 写的“${way.along}”在场景里不是一条画得出线的河，也不是一个湖`);
    }
  }
  return { lines, off, nameless, unmeasured };
}

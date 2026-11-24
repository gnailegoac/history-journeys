// 全程沙盘上的路画成什么线。只算数，不引 three：给出来的是沙盘里的米（x 向东，z 向南），画线的程序再把它们抬到地面上。
// 只有全程沙盘才用得着的那一块程序可以引它（src/stage/three/routeLevel.ts 和它后面画路的文件）；
// 页面的程序、站点沙盘的程序都不许引（tests/unit/road-lines.test.ts 查着）。
//
// 做三件事：
//   1 一截路（roads.ways 里的一条）的线：经纬度换成沙盘里的米，每个拐角抹圆一次（从两边各切掉最多 9 公里，换成一小段弧），
//     再加密到最长 6 公里一段（线要贴着起伏的地面）。两头是城，一点不动。
//   2 一小节里哪几趟路要画、画成哪一种：头一节（全程）每一趟都是墨线；后面的小节，到这一站去的几趟是“刚走的”，
//     到前面各站去的是“走过的”，后面的不画。
//   3 把要画的路排成一笔一笔：同一截路几趟都走的只画一笔（刚走的压过墨线，墨线压过走过的）；
//     一截路在这一种里只要有“按史料摆的”一截走到它就是实线，不然是虚线；一趟路里接着走的几截、虚实一样的连成一笔
//     （虚线的一划一空要一路排下去，不能在接头上重来）。
// 画线的程序拿到这些以后：一种状态的实线合成一份线段表，虚线一笔一条线，另有一份垫在下面的浅色线段表（全部的笔画）。

import type { RoadWay, RouteScene } from '../domain/scene';
import type { FrameCoords } from '../domain/sceneGeo';
import type { Vec2 } from './ground/types';

/** 拐角从两边各切掉最多多少公里。 */
export const ROAD_CORNER_KM = 9;
/** 一个拐角的弧最多分成几段（拐了直角以上）；拐得小的少分：每 ROAD_CORNER_STEP_DEG 度一段，最少两段。 */
export const ROAD_CORNER_STEPS = 6;
export const ROAD_CORNER_STEP_DEG = 15;
/** 两条边的夹角小到这个余弦以上（差不多是直的），拐角不动。 */
const STRAIGHT_COS = 0.99;
/** 线上最长多少公里一段。 */
export const ROAD_STEP_KM = 6;
/** 一趟路里前后两截的头尾相差不到这么多公里，算接得上（校验的规则 13 也是这个数）。 */
const JOIN_KM = 1;

/** 一笔路画成哪一种：ink 是墨线（全程那一节），now 是刚走的（印泥红），past 是走过的（淡墨）。 */
export type RoadState = 'ink' | 'now' | 'past';

/** 画的先后：前面的压过后面的。 */
export const ROAD_STATES: readonly RoadState[] = ['now', 'ink', 'past'];

/** 一笔。 */
export interface RoadRun {
  state: RoadState;
  /** 虚线（只有“示意的”一截走到它）还是实线。 */
  dotted: boolean;
  /** 这一笔是哪几截路连成的，按走的先后；倒着走的前面有一个减号（和场景文件里的写法一样）。 */
  ways: string[];
  /** 线上的点：沙盘里的米，[x, z]。拐角抹圆过，最长 ROAD_STEP_KM 公里一段。 */
  points: Vec2[];
  /** 这一笔多长：沙盘里的米。 */
  lengthM: number;
}

const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/**
 * 拐角抹圆：每个拐角从两边各切掉 d，换成一小段弧（二次曲线；拐了多少度就分几段，见 ROAD_CORNER_STEPS）。
 * d 是 radius，但不超过两条边各自的 0.45（两个拐角的弧不会碰头）；差不多是直的拐角、切不到 radius 的九分之一的拐角不动。
 * 头尾两点不动。弧上的点离原来的折线最远是 d 的四分之一。radius 和 points 是同一种单位。
 */
export function roundCorners(points: Vec2[], radius: number): Vec2[] {
  if (points.length < 3) return points.map((p): Vec2 => [p[0], p[1]]);
  const out: Vec2[] = [[points[0][0], points[0][1]]];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i - 1];
    const v = points[i];
    const n = points[i + 1];
    const l1 = dist(p, v);
    const l2 = dist(v, n);
    const cos = ((v[0] - p[0]) * (n[0] - v[0]) + (v[1] - p[1]) * (n[1] - v[1])) / (l1 * l2 || 1);
    const d = Math.min(radius, l1 * 0.45, l2 * 0.45);
    if (cos > STRAIGHT_COS || d < radius / 9) {
      out.push([v[0], v[1]]);
      continue;
    }
    const a: Vec2 = [v[0] + ((p[0] - v[0]) / l1) * d, v[1] + ((p[1] - v[1]) / l1) * d];
    const b: Vec2 = [v[0] + ((n[0] - v[0]) / l2) * d, v[1] + ((n[1] - v[1]) / l2) * d];
    const turnDeg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    const steps = Math.max(2, Math.min(ROAD_CORNER_STEPS, Math.ceil(turnDeg / ROAD_CORNER_STEP_DEG - 1e-9)));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const u = 1 - t;
      out.push([u * u * a[0] + 2 * u * t * v[0] + t * t * b[0], u * u * a[1] + 2 * u * t * v[1] + t * t * b[1]]);
    }
  }
  const last = points[points.length - 1];
  out.push([last[0], last[1]]);
  return out;
}

/** 折线加密：每一段匀着添点，添到没有哪一段比 step 长。原来的点都留着。 */
export function densify(points: Vec2[], step: number): Vec2[] {
  const out: Vec2[] = [[points[0][0], points[0][1]]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const n = Math.max(1, Math.ceil(dist(a, b) / step - 1e-9));
    for (let k = 1; k <= n; k++) out.push(k === n ? [b[0], b[1]] : [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** 一条折线多长。 */
export function lineLength(points: Vec2[]): number {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += dist(points[i - 1], points[i]);
  return sum;
}

/** 地上的公里换成沙盘里的米。 */
const tableM = (scene: RouteScene, km: number): number => (km * 1000) / scene.frame.scale;

/** 一截路抹圆以后的线（还没有加密）：沙盘里的米。coords 是这座沙盘的换算（coordsOf(scene)）。 */
export function roundedWay(scene: RouteScene, coords: FrameCoords, way: RoadWay): Vec2[] {
  return roundCorners(
    way.line.map((p): Vec2 => coords.toLocal(p)),
    tableM(scene, ROAD_CORNER_KM),
  );
}

/** 一截路画出来的线：抹圆，再加密到最长 ROAD_STEP_KM 公里一段。沙盘里的米。 */
export function wayLine(scene: RouteScene, coords: FrameCoords, way: RoadWay): Vec2[] {
  return densify(roundedWay(scene, coords, way), tableM(scene, ROAD_STEP_KM));
}

/**
 * 这一小节里每一趟路画成哪一种（不画的不在里面）。section 是第几节，从 0 数起。
 * 没有写 stop 的小节（头一节，全程）：每一趟都是墨线。写了 stop 的：到这一站去的是刚走的，
 * 到排在它前面的站去的是走过的。站的先后照小节的先后。
 */
export function journeyStates(scene: RouteScene, section: number): Map<string, RoadState> {
  const out = new Map<string, RoadState>();
  const stop = scene.sections[section]?.stop;
  if (stop === undefined) {
    for (const journey of scene.roads.journeys) out.set(journey.id, 'ink');
    return out;
  }
  const order = scene.sections.flatMap((item) => (item.stop === undefined ? [] : [item.stop]));
  const here = order.indexOf(stop);
  for (const journey of scene.roads.journeys) {
    const at = order.indexOf(journey.stop);
    if (journey.stop === stop) out.set(journey.id, 'now');
    else if (at >= 0 && at < here) out.set(journey.id, 'past');
  }
  return out;
}

/** 一趟路里写的一截路：id，和是不是倒着走。 */
const wayRef = (written: string): { id: string; reversed: boolean } => (written.startsWith('-') ? { id: written.slice(1), reversed: true } : { id: written, reversed: false });

/**
 * 这一小节要画的每一笔，按画的先后（刚走的、墨线、走过的；同一种里照场景文件里路的先后）。
 * 每一截路在一小节里最多画一笔。coords 是这座沙盘的换算（coordsOf(scene)）。
 */
export function roadRuns(scene: RouteScene, coords: FrameCoords, section: number): RoadRun[] {
  const states = journeyStates(scene, section);
  const lines = new Map<string, Vec2[]>();
  const lineOf = (id: string): Vec2[] | undefined => {
    const have = lines.get(id);
    if (have) return have;
    const way = scene.roads.ways.find((item) => item.id === id);
    if (!way) return undefined;
    const made = wayLine(scene, coords, way);
    lines.set(id, made);
    return made;
  };
  const join = tableM(scene, JOIN_KM);

  const out: RoadRun[] = [];
  const taken = new Set<string>();
  for (const state of ROAD_STATES) {
    const mine = scene.roads.journeys.filter((journey) => states.get(journey.id) === state);
    // 这一种里，哪几截路有“按史料摆的”一截走到
    const solid = new Set<string>();
    for (const journey of mine) for (const part of journey.parts) if (part.class === 'text') for (const written of part.ways) solid.add(wayRef(written).id);
    const seen = new Set<string>();
    for (const journey of mine) {
      let cur: RoadRun | null = null;
      for (const part of journey.parts) {
        for (const written of part.ways) {
          const { id, reversed } = wayRef(written);
          const line = lineOf(id);
          // 已经画过的（更要紧的一种画了，或者这一种里前面的一趟画了）：这一笔到这里断开
          if (!line || taken.has(id) || seen.has(id)) {
            cur = null;
            continue;
          }
          seen.add(id);
          const points = reversed ? line.slice().reverse() : line;
          const dotted = !solid.has(id);
          if (cur && cur.dotted === dotted && dist(cur.points[cur.points.length - 1], points[0]) <= join) {
            const same = dist(cur.points[cur.points.length - 1], points[0]) < 1e-9;
            cur.points = cur.points.concat(same ? points.slice(1) : points);
            cur.ways.push(written);
          } else {
            cur = { state, dotted, ways: [written], points: points.slice(), lengthM: 0 };
            out.push(cur);
          }
        }
      }
    }
    for (const id of seen) taken.add(id);
  }
  for (const run of out) run.lengthM = lineLength(run.points);
  return out;
}

/** 几笔一共多少段线（一段是相邻的两个点）。 */
export function segmentCount(runs: RoadRun[]): number {
  return runs.reduce((sum, run) => sum + run.points.length - 1, 0);
}

/**
 * 几笔合成一份线段表：每段四个数 [ax, az, bx, bz]，沙盘里的米。一种状态的实线合成一份、垫在下面的浅色线合成一份，都用它
 * （先用 filter 挑出要的那几笔）。
 */
export function segmentsOf(runs: RoadRun[]): Float32Array {
  const out = new Float32Array(segmentCount(runs) * 4);
  let k = 0;
  for (const run of runs) {
    for (let i = 1; i < run.points.length; i++) {
      out[k++] = run.points[i - 1][0];
      out[k++] = run.points[i - 1][1];
      out[k++] = run.points[i][0];
      out[k++] = run.points[i][1];
    }
  }
  return out;
}

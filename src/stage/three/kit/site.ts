// 场地：城墙那一圈线上的算术（哪一面、朝外是哪边、离墙多远、沿着墙走），和各个零件之间要互相知道的事
// （城门在墙的哪一点、哪块地已经被院落占了、城里哪里留着空地可以种树）。
// 样张里这些都靠“一座正东正西的方城，中心就是原点”；这里城墙是任意一圈线。只算数，不碰页面。

import * as THREE from 'three';
import type { SceneThing, StopScene } from '../../../domain/scene';
import { GATE_BIG_EXTRA_M, GATE_HALF_M, gateSeat } from '../../ground';
import type { CityPlan, Vec2 } from '../../ground/types';
import type { KitContext } from '../internal';
import { T } from './geo';
import type { MatName } from './materials';
import { thingParams } from './params';
import { clamp, distSeg } from './util';

// 城墙的尺寸（沙盘里的米；模型都放大了，不按比例）。照样张。
/** 城墙顶比城里的地面高多少。 */
const WALL_H = 62;
/** 城门的城台、角台比城墙顶再高多少。 */
const GATE_UP = 8;
/** 城墙在墙脚、在墙顶各有多厚（一半）。 */
export const WALL_BASE_HALF = 26;
export const WALL_TOP_HALF = 18;
/** 城门的城台多宽（一半）、城墙在门两边各让开多少；big 的城门各加这么多。城台的宽窄由地面那一边定（城门落在哪一点要用它）。 */
const GATE_HALF = GATE_HALF_M;
const GATE_CLEAR = 60;
const GATE_BIG_EXTRA = GATE_BIG_EXTRA_M;
/** 离墙角不到这么远的，算是在墙角上。 */
const CORNER_SNAP = 70;

/** 城墙的一面：从 a 到 b。 */
export interface WallSide {
  a: Vec2;
  b: Vec2;
  len: number;
  mid: Vec2;
  /** 朝城外的方向，长度为 1。 */
  out: Vec2;
  /** 这一面自己的坐标里 x 轴在沙盘上朝哪边（顺着墙），长度为 1。 */
  ax: Vec2;
  /** a、b 两头在这一面自己的 x 上各是多少（一正一负，各半个墙长）。 */
  ua: number;
  ub: number;
  /** 这一面自己的坐标：原点在墙的正中，x 顺着墙，+z 朝城外。ry 是它绕竖轴转了多少。 */
  ry: number;
  M: THREE.Matrix4;
  /** 从第一面的起点沿着墙走到这一面的起点有多远。 */
  start: number;
}

/** 一圈闭合的线。 */
export interface Ring {
  pts: Vec2[];
  sides: WallSide[];
  centre: Vec2;
  /** 一圈多长。 */
  length: number;
}

/** 圈上的一个位置：在第几面、这一面自己的 x 上是多少；正好在墙角上时 corner 是那个角（第几个点）。 */
export interface RingPos {
  side: number;
  u: number;
  corner: number | null;
}

export function makeRing(pts: Vec2[]): Ring {
  const n = pts.length;
  let area = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    area += a[0] * b[1] - b[0] * a[1];
    cx += a[0] / n;
    cz += a[1] / n;
  }
  const sign = area >= 0 ? 1 : -1;
  const sides: WallSide[] = [];
  let start = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1;
    const out: Vec2 = [(sign * dz) / len, (-sign * dx) / len];
    const ax: Vec2 = [out[1], -out[0]];
    const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const ua = (a[0] - mid[0]) * ax[0] + (a[1] - mid[1]) * ax[1];
    const ry = Math.atan2(out[0], out[1]);
    sides.push({ a, b, len, mid, out, ax, ua, ub: -ua, ry, M: T(mid[0], 0, mid[1], ry), start });
    start += len;
  }
  return { pts, sides, centre: [cx, cz], length: start };
}

/** 这一点在不在圈里面。 */
export function insideRing(ring: Ring, x: number, z: number): boolean {
  return insidePolygon(ring.pts, x, z);
}

export function insidePolygon(pts: Vec2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** 这一点离圈那条线多远：圈外是正的，圈里是负的。 */
export function ringDistance(ring: Ring, x: number, z: number): number {
  let d = Infinity;
  for (const s of ring.sides) d = Math.min(d, distSeg(x, z, s.a[0], s.a[1], s.b[0], s.b[1]));
  return insideRing(ring, x, z) ? -d : d;
}

/** 点到一条折线多远。 */
export function lineDistance(line: Vec2[], x: number, z: number): number {
  let d = Infinity;
  for (let i = 0; i < line.length - 1; i++) d = Math.min(d, distSeg(x, z, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]));
  return d;
}

/** 圈上离这一点最近的位置。 */
export function nearestOnRing(ring: Ring, x: number, z: number): RingPos {
  let best = 0;
  let bestD = Infinity;
  ring.sides.forEach((s, i) => {
    const d = distSeg(x, z, s.a[0], s.a[1], s.b[0], s.b[1]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  const s = ring.sides[best];
  const half = s.len / 2;
  const u = clamp((x - s.mid[0]) * s.ax[0] + (z - s.mid[1]) * s.ax[1], -half, half);
  let corner: number | null = null;
  if (Math.abs(u - s.ua) < Math.min(CORNER_SNAP, half)) corner = best;
  else if (Math.abs(u - s.ub) < Math.min(CORNER_SNAP, half)) corner = (best + 1) % ring.sides.length;
  return { side: best, u, corner };
}

/** 圈上的一个位置在沙盘上的哪一点（在墙的中线上）。 */
export function ringPoint(ring: Ring, pos: RingPos): Vec2 {
  if (pos.corner !== null) return ring.pts[pos.corner];
  const s = ring.sides[pos.side];
  return [s.mid[0] + s.ax[0] * pos.u, s.mid[1] + s.ax[1] * pos.u];
}

/** 墙角往外（d 是正的）或往里（负的）挪 d 米以后的那一点：两面墙各挪 d 以后的交点。 */
export function cornerOffset(ring: Ring, corner: number, d: number): Vec2 {
  const n = ring.sides.length;
  const n0 = ring.sides[(corner - 1 + n) % n].out;
  const n1 = ring.sides[corner].out;
  const k = Math.max(0.25, 1 + n0[0] * n1[0] + n0[1] * n1[1]);
  const v = ring.pts[corner];
  return [v[0] + (d * (n0[0] + n1[0])) / k, v[1] + (d * (n0[1] + n1[1])) / k];
}

/** 圈上的一个位置往外（正）或往里（负）挪 d 米。 */
export function offsetPoint(ring: Ring, pos: RingPos, d: number): Vec2 {
  if (pos.corner !== null) return cornerOffset(ring, pos.corner, d);
  const s = ring.sides[pos.side];
  const p = ringPoint(ring, pos);
  return [p[0] + s.out[0] * d, p[1] + s.out[1] * d];
}

/** 沿着墙从第一面的起点走到这个位置有多远。 */
function along(ring: Ring, pos: RingPos): number {
  if (pos.corner !== null) return ring.sides[pos.corner].start;
  const s = ring.sides[pos.side];
  return s.start + ((pos.u - s.ua) / (s.ub - s.ua)) * s.len;
}

/** 沿着墙从一个位置走到另一个位置，挑近的那一边走；返回路上经过的位置（两头和中间的墙角）。 */
export function ringPath(ring: Ring, from: RingPos, to: RingPos): RingPos[] {
  const n = ring.sides.length;
  const s0 = along(ring, from);
  const s1 = along(ring, to);
  const forward = (s1 - s0 + ring.length) % ring.length;
  const sideOf = (p: RingPos): number => (p.corner !== null ? p.corner : p.side);
  const out: RingPos[] = [from];
  const corner = (i: number): RingPos => ({ side: i, u: ring.sides[i].ua, corner: i });
  if (forward <= ring.length / 2) {
    // 顺着走：经过 from 那一面的终点，一直到 to 那一面的起点
    if (!(sideOf(from) === sideOf(to) && s1 >= s0)) {
      let i = sideOf(from);
      do {
        i = (i + 1) % n;
        out.push(corner(i));
      } while (i !== sideOf(to));
    }
  } else if (!(sideOf(from) === sideOf(to) && s1 <= s0)) {
    // 倒着走：经过 from 那一面的起点，一直到 to 那一面的终点
    let i = sideOf(from);
    for (;;) {
      out.push(corner(i));
      i = (i - 1 + n) % n;
      if (i === sideOf(to)) break;
    }
  }
  out.push(to);
  // 两头正好在墙角上时，墙角会重出一次
  return out.filter((p, i) => i === 0 || !(p.corner !== null && p.corner === out[i - 1].corner));
}

/** 把一条线贴到墙上：线上每一点找墙上最近的位置，相邻两点之间沿着墙走。 */
export function snapLineToRing(ring: Ring, line: Vec2[]): RingPos[] {
  const out: RingPos[] = [];
  let prev: RingPos | null = null;
  for (const [x, z] of line) {
    const pos = nearestOnRing(ring, x, z);
    if (prev) for (const p of ringPath(ring, prev, pos).slice(1)) out.push(p);
    else out.push(pos);
    prev = pos;
  }
  return out;
}

// ---------------------------------------------------------------- 各个零件之间要互相知道的事

/** 一道城墙。 */
export interface WallSite {
  id: string;
  ring: Ring;
  /** 城里的地面、城墙顶、城台和角台的顶，沙盘里的高度（本来的高度，没有乘远了拔高的倍数）。 */
  groundY: number;
  topY: number;
  gateTopY: number;
  mat: MatName;
  parapet: boolean;
  /** 城门开在哪：第几面、这一面自己的 x 上是多少、城墙在两边各让开多少。同一处前后两座城门只记一次。 */
  openings: { side: number; u: number; clear: number }[];
  city: CityPlan | null;
}

/** 一座城门。 */
export interface GateSite {
  id: string;
  wall: WallSite;
  side: number;
  u: number;
  /** 城门自己的坐标：原点在墙的中线上，x 顺着墙，+z 朝城外。 */
  M: THREE.Matrix4;
  /** 城台多宽（一半）、多深。 */
  halfW: number;
  depth: number;
}

/** 城墙和城门在哪。 */
export interface Survey {
  walls: Map<string, WallSite>;
  gates: Map<string, GateSite>;
}

/** 一块被院落占了的地：中心、转了多少、东西和南北各半多宽。 */
export interface Yard {
  cx: number;
  cz: number;
  ry: number;
  hx: number;
  hz: number;
  /** 这组院落远了最多放大到几倍，绕着哪一点放大。不写是不放大。 */
  grow?: number;
  about?: Vec2;
}

/** 这组院落放大到头时占的那一块。 */
export function grownYard(yard: Yard): Yard {
  const k = yard.grow ?? 1;
  const [ax, az] = yard.about ?? [yard.cx, yard.cz];
  return { cx: ax + (yard.cx - ax) * k, cz: az + (yard.cz - az) * k, ry: yard.ry, hx: yard.hx * k, hz: yard.hz * k };
}

export function inYard(yard: Yard, x: number, z: number, pad = 0): boolean {
  const dx = x - yard.cx;
  const dz = z - yard.cz;
  const c = Math.cos(yard.ry);
  const s = Math.sin(yard.ry);
  const lx = dx * c - dz * s;
  const lz = dx * s + dz * c;
  return Math.abs(lx) < yard.hx + pad && Math.abs(lz) < yard.hz + pad;
}

const linePoints = (ctx: KitContext, thing: SceneThing): Vec2[] => (thing.line ?? []).map((p) => ctx.coords.toLocal(p));

/** 先把城墙和城门量一遍：城墙要给城门留口子，城门、楼、棚子要知道墙在哪。 */
export function surveyWalls(ctx: KitContext): Survey {
  const scene: StopScene = ctx.scene;
  const walls = new Map<string, WallSite>();
  const gates = new Map<string, GateSite>();
  for (const thing of scene.things) {
    if (thing.kind !== 'wall') continue;
    const pts = linePoints(ctx, thing);
    if (pts.length < 3) continue;
    const ring = makeRing(pts);
    const city = ctx.ground.cities.find((c) => c.wallId === thing.id) ?? null;
    const groundM = city ? city.groundM : ctx.samplers.height(ring.centre[0], ring.centre[1]);
    const groundY = ctx.coords.y(groundM);
    const p = thingParams('wall', thing.params);
    walls.set(thing.id, {
      id: thing.id,
      ring,
      groundY,
      topY: groundY + WALL_H,
      gateTopY: groundY + WALL_H + GATE_UP,
      mat: p.face === 'brick' ? 'brick' : 'rammed',
      parapet: p.parapet ?? true,
      openings: [],
      city,
    });
  }
  for (const thing of scene.things) {
    if (thing.kind !== 'gate' || !thing.on || !thing.at) continue;
    const wall = walls.get(thing.on);
    if (!wall) continue;
    const big = thingParams('gate', thing.params).big ?? false;
    // 城门落在哪一点只有一个算法（地面画大街、题签指着城门用的也是它）：挪到墙线上，城台不伸出这一面墙
    const [x, z] = gateSeat(ctx.coords.toLocal(thing.at), wall.ring.pts, big).at;
    const pos = nearestOnRing(wall.ring, x, z);
    const side = wall.ring.sides[pos.side];
    const halfW = GATE_HALF + (big ? GATE_BIG_EXTRA : 0);
    const u = pos.u;
    const clear = GATE_CLEAR + (big ? GATE_BIG_EXTRA : 0);
    const same = wall.openings.find((o) => o.side === pos.side && Math.abs(o.u - u) < 1);
    if (same) same.clear = Math.max(same.clear, clear);
    else wall.openings.push({ side: pos.side, u, clear });
    gates.set(thing.id, {
      id: thing.id,
      wall,
      side: pos.side,
      u,
      M: side.M.clone().multiply(T(u, 0, 0)),
      halfW,
      depth: 2 * WALL_BASE_HALF + 34 + (big ? GATE_BIG_EXTRA : 0),
    });
  }
  return { walls, gates };
}

/** 摆在城墙顶上的东西落在哪：离墙角近的落在角台上，别的落在墙顶的中线上。 */
export function onWallTop(wall: WallSite, x: number, z: number): { x: number; z: number; y: number; ry: number; corner: boolean } {
  const pos = nearestOnRing(wall.ring, x, z);
  const side = wall.ring.sides[pos.corner !== null ? pos.corner : pos.side];
  if (pos.corner !== null) {
    const p = cornerOffset(wall.ring, pos.corner, 1);
    return { x: p[0], z: p[1], y: wall.gateTopY, ry: side.ry, corner: true };
  }
  const p = ringPoint(wall.ring, pos);
  return { x: p[0], z: p[1], y: wall.topY, ry: side.ry, corner: false };
}

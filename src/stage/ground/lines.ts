// 线和圈上的几何：到线多远、在不在圈里、把折线加密。坐标都是沙盘里的米，[x, z]。

import type { Vec2 } from './types';

/** 一个横平竖直的框。 */
export interface Box {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** 把几个点框起来，四边再各放出 pad 米。 */
export function boxOf(points: Vec2[], pad = 0): Box {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const [x, z] of points) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  return { x0: x0 - pad, x1: x1 + pad, z0: z0 - pad, z1: z1 + pad };
}

export const inBox = (x: number, z: number, b: Box): boolean => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;

/** 点到线段的距离。 */
export function distSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** 点到一条折线的距离。 */
export function distLine(px: number, pz: number, line: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const d = distSeg(px, pz, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]);
    if (d < best) best = d;
  }
  return best;
}

/** 一圈线：闭合的，最后一点不重复第一点。写的时候重复了的，这里去掉。 */
export function asRing(points: Vec2[]): Vec2[] {
  const n = points.length;
  if (n > 1 && points[0][0] === points[n - 1][0] && points[0][1] === points[n - 1][1]) return points.slice(0, n - 1);
  return points;
}

/** 到一圈线多远，带正负：圈里是负数，圈外是正数，压在线上是 0。 */
export function ringSigned(px: number, pz: number, ring: Vec2[]): number {
  let best = Infinity;
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [ax, az] = ring[j];
    const [bx, bz] = ring[i];
    const d = distSeg(px, pz, ax, az, bx, bz);
    if (d < best) best = d;
    // 从这一点往东画一条线，看它穿过圈的边几次：奇数次就在圈里。
    if (az > pz !== bz > pz && px < ax + ((pz - az) / (bz - az)) * (bx - ax)) inside = !inside;
  }
  if (best === 0) return 0;
  return inside ? -best : best;
}

/** 一圈线围住的那一块的重心。圈的面积是 0（几个点在一条线上）时取各点的平均。 */
export function ringCentre(ring: Vec2[]): Vec2 {
  let area = 0;
  let cx = 0;
  let cz = 0;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [ax, az] = ring[j];
    const [bx, bz] = ring[i];
    const cross = ax * bz - bx * az;
    area += cross;
    cx += (ax + bx) * cross;
    cz += (az + bz) * cross;
  }
  if (Math.abs(area) < 1e-9) {
    let sx = 0;
    let sz = 0;
    for (const [x, z] of ring) {
      sx += x;
      sz += z;
    }
    return [sx / n, sz / n];
  }
  return [cx / (3 * area), cz / (3 * area)];
}

/** 把折线加密到大约 step 米一个点：直线上匀着加，不改形状（壕、人修的线用这个）。 */
export function subdivide(line: Vec2[], step: number): Vec2[] {
  const out: Vec2[] = [];
  if (line.length === 0) return out;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  const last = line[line.length - 1];
  out.push([last[0], last[1]]);
  return out;
}

/**
 * 把折线加密成一条顺滑的线，大约 step 米一个点，线穿过原来的每一个点（河、路用这个）。
 *
 * 算法是样张 util.js 的 densify（Catmull-Rom），多了一条：每个点上往前带的那股劲，不许超过这一段本身长度的两倍。
 * 点距差不多的线（相邻两段的长短差不到三倍），算出来和样张一样；点距一长一短挨着的线（借来的今天的河道线正是这样），
 * 样张的算法会在短的那一段把线甩出去、往回走一截，加了这一条就不会。
 */
export function smoothLine(line: Vec2[], step: number): Vec2[] {
  const n = line.length;
  if (n < 3) return subdivide(line, step);

  // 每个点上的走向：前一个点到后一个点的一半（两头没有前一个、后一个，就拿自己顶上）。
  const pull: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(n - 1, i + 1)];
    pull.push([(b[0] - a[0]) / 2, (b[1] - a[1]) / 2]);
  }
  const capped = (m: Vec2, len: number): Vec2 => {
    const size = Math.hypot(m[0], m[1]);
    const most = 2 * len;
    return size > most ? [(m[0] / size) * most, (m[1] / size) * most] : m;
  };

  const out: Vec2[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p1 = line[i];
    const p2 = line[i + 1];
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const m1 = capped(pull[i], len);
    const m2 = capped(pull[i + 1], len);
    const count = Math.max(2, Math.round(len / step));
    for (let k = 0; k < count; k++) {
      const t = k / count;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, ma: number, b: number, mb: number): number =>
        (2 * t3 - 3 * t2 + 1) * a + (t3 - 2 * t2 + t) * ma + (-2 * t3 + 3 * t2) * b + (t3 - t2) * mb;
      out.push([f(p1[0], m1[0], p2[0], m2[0]), f(p1[1], m1[1], p2[1], m2[1])]);
    }
  }
  const last = line[n - 1];
  out.push([last[0], last[1]]);
  return out;
}

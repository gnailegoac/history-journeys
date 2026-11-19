// 零件库用的小工具。带种子的随机数、噪声、插值、颜色这八样和算地面的那一边是同一份（src/stage/ground/num.ts），
// 这里只是照样给出来：两边用的是同一个算法，地面和模型才对得上，也不会一边改了另一边忘了改。
// 只有两样是零件库自己的：点到线段的距离、把折线加密。这里不碰 three，也不碰页面。

import type { Vec2 } from '../../ground/types';
import { clamp } from '../../ground/num';

export { clamp, fbm, hash2, hex, lerp, mix3, mulberry32, smoothstep } from '../../ground/num';

/** 点到线段的距离 */
export function distSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = clamp(t, 0, 1);
  const qx = ax + dx * t;
  const qz = az + dz * t;
  return Math.hypot(px - qx, pz - qz);
}

/** Catmull-Rom 加密折线，step 是大约的点距（米） */
export function densify(pts: Vec2[], step = 40): Vec2[] {
  const out: Vec2[] = [];
  const P = (i: number): Vec2 => pts[clamp(i, 0, pts.length - 1)];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.round(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number): number =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  const last = pts[pts.length - 1];
  out.push([last[0], last[1]]);
  return out;
}

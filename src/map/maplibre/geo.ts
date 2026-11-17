// 路径和插值的纯计算，不依赖地图引擎。

import type { LngLat } from '../../domain/types';

const EARTH_RADIUS_KM = 6371.0088;
const rad = (deg: number) => (deg * Math.PI) / 180;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 缓入缓出：两端的速度和加速度都是 0。 */
export const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** 两个角度之差，取近的一边，结果在 −180 到 180 之间。 */
export const angleDelta = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180;

/** 方位角插值，走近的一边。 */
export const lerpAngle = (a: number, b: number, t: number) => a + angleDelta(a, b) * t;

export function haversineKm(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 一条折线，可以按“走了全长的几分之几”取点。 */
export class Path {
  readonly points: LngLat[];
  readonly totalKm: number;
  private readonly cumKm: number[];

  constructor(points: LngLat[]) {
    if (points.length === 0) throw new RangeError('路径至少要有一个点');
    // 经度接着上一个点往下算，跨过 180 度经线时不会绕地球一圈；重复的点去掉，免得出现零长度的线段。
    const kept: LngLat[] = [];
    for (const p of points) {
      const last = kept[kept.length - 1];
      if (!last) {
        kept.push([p[0], p[1]]);
        continue;
      }
      const next: LngLat = [last[0] + angleDelta(last[0], p[0]), p[1]];
      if (haversineKm(last, next) > 0.01) kept.push(next);
    }
    this.points = kept;
    this.cumKm = [0];
    for (let i = 1; i < kept.length; i++) this.cumKm.push(this.cumKm[i - 1] + haversineKm(kept[i - 1], kept[i]));
    this.totalKm = this.cumKm[this.cumKm.length - 1];
  }

  /** 全长的 u（0 到 1）处的点。 */
  at(u: number): LngLat {
    const { points, cumKm } = this;
    if (points.length === 1) return points[0];
    const km = clamp(u, 0, 1) * this.totalKm;
    let i = 1;
    while (i < points.length - 1 && cumKm[i] < km) i++;
    const t = (km - cumKm[i - 1]) / (cumKm[i] - cumKm[i - 1]);
    return [lerp(points[i - 1][0], points[i][0], t), lerp(points[i - 1][1], points[i][1], t)];
  }

  /** 和 at 一样，但取前后一小段的平均，镜头在拐弯处走圆角而不是原地转向。两端仍然精确。 */
  smoothAt(u: number, window = 0.03): LngLat {
    const w = Math.min(window, u, 1 - u);
    if (w <= 0 || this.points.length === 1) return this.at(u);
    const n = 6;
    let lng = 0;
    let lat = 0;
    for (let i = 0; i <= n; i++) {
      const p = this.at(u - w + (2 * w * i) / n);
      lng += p[0];
      lat += p[1];
    }
    return [lng / (n + 1), lat / (n + 1)];
  }
}

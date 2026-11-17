export type LngLat = [number, number];

const EARTH_RADIUS_KM = 6371.0088;
const rad = (deg: number) => (deg * Math.PI) / 180;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Ease in and out with zero speed and zero acceleration at both ends. */
export const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
/** Interpolates a bearing the short way round. */
export function lerpAngle(a: number, b: number, t: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * t;
}

export function haversineKm(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** A polyline that can be sampled by the fraction of its length. */
export class Path {
  readonly points: LngLat[];
  readonly totalKm: number;
  private readonly cumKm: number[];

  constructor(points: LngLat[]) {
    // drop repeated points so that no segment has zero length
    this.points = points.filter((p, i) => i === 0 || haversineKm(points[i - 1], p) > 0.01);
    this.cumKm = [0];
    for (let i = 1; i < this.points.length; i++) {
      this.cumKm.push(this.cumKm[i - 1] + haversineKm(this.points[i - 1], this.points[i]));
    }
    this.totalKm = this.cumKm[this.cumKm.length - 1];
  }

  /** Point at fraction `u` (0..1) of the length. */
  at(u: number): LngLat {
    const { points, cumKm } = this;
    if (points.length === 1 || this.totalKm === 0) return points[0];
    const km = clamp(u, 0, 1) * this.totalKm;
    let i = 1;
    while (i < points.length - 1 && cumKm[i] < km) i++;
    const t = (km - cumKm[i - 1]) / (cumKm[i] - cumKm[i - 1]);
    return [lerp(points[i - 1][0], points[i][0], t), lerp(points[i - 1][1], points[i][1], t)];
  }

  /**
   * Like `at`, but averaged over a short stretch of the path, so that the camera
   * rounds the corners at via points instead of turning on the spot. Exact at both ends.
   */
  smoothAt(u: number, window = 0.03): LngLat {
    const w = Math.min(window, u, 1 - u);
    if (w <= 0) return this.at(u);
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

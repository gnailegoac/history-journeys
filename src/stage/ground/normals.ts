// 从样张搬来，结构没有动（spikes/art-direction/b/scene/terrain-data.js 的 bakeNormals），只加了类型；
// 每格多大、山高夸大几倍改成从 Ground 里读。

import type { Ground } from './types';

/** 法线图（物体空间，y 向上），山的起伏按夸大以后的算。nx × nz 个点，每点四个字节。 */
export function bakeNormals(ground: Ground): Uint8Array {
  const { nx, nz, h, cell } = ground;
  const ex = ground.reliefTimes;
  const out = new Uint8Array(nx * nz * 4);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const l = h[j * nx + Math.max(0, i - 1)];
      const r = h[j * nx + Math.min(nx - 1, i + 1)];
      const u = h[Math.max(0, j - 1) * nx + i];
      const d = h[Math.min(nz - 1, j + 1) * nx + i];
      let vx = (-(r - l) / (2 * cell)) * ex;
      let vz = (-(d - u) / (2 * cell)) * ex;
      const len = Math.hypot(vx, 1, vz);
      vx /= len;
      vz /= len;
      const k = (j * nx + i) * 4;
      out[k] = Math.round((vx * 0.5 + 0.5) * 255);
      out[k + 1] = Math.round((1 / len) * 0.5 * 255 + 127.5);
      out[k + 2] = Math.round((vz * 0.5 + 0.5) * 255);
      out[k + 3] = 255;
    }
  }
  return out;
}

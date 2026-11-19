// 从样张搬来，结构没有动（spikes/art-direction/b/scene/terrain-data.js 里的 boxBlur、gauss），只加了类型。
// 把一张网格抹平。出了边取边上的值。

import { clamp } from './num';

function boxBlur(src: Float32Array, nx: number, nz: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const win = 2 * r + 1;
  for (let j = 0; j < nz; j++) {
    let acc = 0;
    const row = j * nx;
    for (let k = -r; k <= r; k++) acc += src[row + clamp(k, 0, nx - 1)];
    for (let i = 0; i < nx; i++) {
      tmp[row + i] = acc / win;
      acc += src[row + clamp(i + r + 1, 0, nx - 1)] - src[row + clamp(i - r, 0, nx - 1)];
    }
  }
  for (let i = 0; i < nx; i++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[clamp(k, 0, nz - 1) * nx + i];
    for (let j = 0; j < nz; j++) {
      out[j * nx + i] = acc / win;
      acc += tmp[clamp(j + r + 1, 0, nz - 1) * nx + i] - tmp[clamp(j - r, 0, nz - 1) * nx + i];
    }
  }
  return out;
}

/** 三次盒式模糊，近似高斯；sigma 以格为单位 */
export function gauss(src: Float32Array, nx: number, nz: number, sigma: number): Float32Array {
  const r = Math.max(1, Math.round(sigma - 0.5));
  return boxBlur(boxBlur(boxBlur(src, nx, nz, r), nx, nz, r), nx, nz, r);
}

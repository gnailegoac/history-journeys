// 地形板的上表面有多高。地形板的网格（59 米一格）比高程的格子粗，陡坎在它上面是一道斜坡：
// 要贴着地形板摆的东西（崖壁的崖顶、崖脚的石头）问的是这里，不是高程。
// 地形板自己的顶点也从这里取（terrainMesh.ts），两边才是同一个数。这里不碰 three，也不碰页面。

import type { FrameCoords } from '../../domain/sceneGeo';
import type { GroundSamplers } from '../ground/types';

/** 地形板的网格大约多少米一格（样张是 58.5 × 59.1）。比高程的格子粗。 */
export const SEGMENT_M = 59;

/** 地形板的网格横竖各分多少格。三角形数：上表面 sx × sz × 2，四边的切面 (sx + sz) × 4。segmentM 不写是站点沙盘的 59。 */
export function terrainGrid(coords: FrameCoords, segmentM: number = SEGMENT_M): { sx: number; sz: number } {
  return {
    sx: Math.max(2, Math.round((coords.x1 - coords.x0) / segmentM)),
    sz: Math.max(2, Math.round((coords.z1 - coords.z0) / segmentM)),
  };
}

const AROUND: [number, number][] = [[22, 0], [-22, 0], [0, 22], [0, -22], [22, 22], [-22, 22], [22, -22], [-22, -22]];

/** 地形板的一个顶点有多高（海拔，米）：这一点和四周 22 米处八个点的地面里最低的那个，保证水面不会被网格顶破。 */
export function vertexHeightM(samplers: GroundSamplers, x: number, z: number): number {
  let m = samplers.height(x, z);
  for (const [dx, dz] of AROUND) m = Math.min(m, samplers.height(x + dx, z + dz));
  return m;
}

/**
 * 站点沙盘的地形板上表面在任意一点有多高（海拔，米）：照它的顶点和它自己那两种三角形（a-c-b、b-c-d）算。
 * 顶点的高度用到时才算，算过记着。
 */
export function meshHeightAt(samplers: GroundSamplers, coords: FrameCoords): (x: number, z: number) => number {
  const { sx, sz } = terrainGrid(coords);
  const W = coords.x1 - coords.x0;
  const D = coords.z1 - coords.z0;
  const known = new Float64Array((sx + 1) * (sz + 1)).fill(NaN);
  const vertex = (i: number, j: number): number => {
    const k = j * (sx + 1) + i;
    if (Number.isNaN(known[k])) known[k] = vertexHeightM(samplers, coords.x0 + (i / sx) * W, coords.z0 + (j / sz) * D);
    return known[k];
  };
  return (x, z) => {
    const fx = Math.min(sx - 1e-9, Math.max(0, ((x - coords.x0) / W) * sx));
    const fz = Math.min(sz - 1e-9, Math.max(0, ((z - coords.z0) / D) * sz));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const b = vertex(i + 1, j);
    const c = vertex(i, j + 1);
    if (u + v <= 1) {
      const a = vertex(i, j);
      return a + (b - a) * u + (c - a) * v;
    }
    const d = vertex(i + 1, j + 1);
    return d + (c - d) * (1 - u) + (b - d) * (1 - v);
  };
}

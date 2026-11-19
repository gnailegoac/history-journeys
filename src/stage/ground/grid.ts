// 地面的网格：每格多大、哪一格在哪，和在格子之间取数。

import type { FrameCoords } from '../../domain/sceneGeo';
import type { Box } from './lines';
import { clamp } from './num';

/** 地面网格每格多少米。是程序里的定数，不在场景文件里。 */
export const CELL_M = 20;

/** 网格的样子。第 k = j × nx + i 格在 x = x0 + i × cell，z = z0 + j × cell。 */
export interface Grid {
  nx: number;
  nz: number;
  cell: number;
  x0: number;
  z0: number;
}

/** 按沙盘的范围定网格：四边都压在格点上（范围不是 20 米的整倍数时，东边、南边差不到半格）。 */
export function gridOf(coords: FrameCoords): Grid {
  return {
    nx: Math.round((coords.x1 - coords.x0) / CELL_M) + 1,
    nz: Math.round((coords.z1 - coords.z0) / CELL_M) + 1,
    cell: CELL_M,
    x0: coords.x0,
    z0: coords.z0,
  };
}

/** 一个框盖住哪些格：列 i0 到 i1，行 j0 到 j1（都含）。框在网格外面时是 null。 */
export function cellsIn(grid: Grid, box: Box): { i0: number; i1: number; j0: number; j1: number } | null {
  const i0 = Math.max(0, Math.ceil((box.x0 - grid.x0) / grid.cell));
  const i1 = Math.min(grid.nx - 1, Math.floor((box.x1 - grid.x0) / grid.cell));
  const j0 = Math.max(0, Math.ceil((box.z0 - grid.z0) / grid.cell));
  const j1 = Math.min(grid.nz - 1, Math.floor((box.z1 - grid.z0) / grid.cell));
  if (i1 < i0 || j1 < j0) return null;
  return { i0, i1, j0, j1 };
}

/** 在任意一点取网格上的数：格子之间按远近匀开；出了沙盘取边上的值。 */
export function bilinear(field: Float32Array, grid: Grid): (x: number, z: number) => number {
  const { nx, nz, cell, x0, z0 } = grid;
  return (x, z) => {
    const fx = clamp((x - x0) / cell, 0, nx - 1.001);
    const fz = clamp((z - z0) / cell, 0, nz - 1.001);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const ax = fx - ix;
    const az = fz - iz;
    const k = iz * nx + ix;
    return field[k] * (1 - ax) * (1 - az) + field[k + 1] * ax * (1 - az) + field[k + nx] * (1 - ax) * az + field[k + nx + 1] * ax * az;
  };
}

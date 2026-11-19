// 地形文件：今天的高程网格。读进来，再在沙盘里任意一点取今天的海拔。

import type { SceneTerrain } from '../../domain/scene';
import type { FrameCoords } from '../../domain/sceneGeo';
import type { Dem } from './types';

/**
 * 把地形文件的字节读成高程网格。文件里是 16 位整数（低位在前），单位分米，逐行存，第 0 行最北，第 0 列最西。
 * bytes 的大小不是 行 × 列 × 2 字节时抛出错误。
 */
export function readDemBytes(terrain: SceneTerrain, bytes: ArrayBuffer): Dem {
  const { cols, rows } = terrain;
  const want = cols * rows * 2;
  if (bytes.byteLength !== want) {
    throw new Error(`地形文件 ${terrain.file} 的大小不对：${rows} 行 × ${cols} 列应该是 ${want} 字节，实际是 ${bytes.byteLength} 字节`);
  }
  const view = new DataView(bytes);
  const heights = new Float32Array(cols * rows);
  for (let i = 0; i < heights.length; i++) heights[i] = view.getInt16(i * 2, true) / 10;
  return { cols, rows, west: terrain.west, east: terrain.east, south: terrain.south, north: terrain.north, heights };
}

/** 沙盘里某一点今天的海拔（米）：格子之间按远近匀开；出了高程网格取边上的值。 */
export function demSampler(dem: Dem, coords: FrameCoords): (x: number, z: number) => number {
  const { cols, rows, heights } = dem;
  const [minX, minZ] = coords.toLocal([dem.west, dem.north]);
  const [maxX, maxZ] = coords.toLocal([dem.east, dem.south]);
  return (x, z) => {
    const fx = ((x - minX) / (maxX - minX)) * (cols - 1);
    const fz = ((z - minZ) / (maxZ - minZ)) * (rows - 1);
    const cx = Math.max(0, Math.min(cols - 1.001, fx));
    const cz = Math.max(0, Math.min(rows - 1.001, fz));
    const ix = Math.floor(cx);
    const iz = Math.floor(cz);
    const ax = cx - ix;
    const az = cz - iz;
    const k = iz * cols + ix;
    return heights[k] * (1 - ax) * (1 - az) + heights[k + 1] * ax * (1 - az) + heights[k + cols] * (1 - ax) * az + heights[k + cols + 1] * ax * az;
  };
}

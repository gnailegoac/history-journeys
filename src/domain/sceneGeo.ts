// 经纬度和沙盘里的米之间的换算。整个项目只在这里换：读取、校验和沙盘程序都用这一个，三边才对得上。
//
// 沙盘里的坐标：原点是 frame.center，x 向东，z 向南（所以北是 −z），单位是米。
// 一块沙盘只有十几公里，按原点的纬度换算就够准：纬度 1 度算 110950 米，经度 1 度算 111320 × cos(原点纬度) 米。

import type { SceneFrame } from './scene';
import type { LngLat } from './types';

/** 纬度 1 度多少米。 */
const M_PER_DEG_LAT = 110950;
/** 赤道上经度 1 度多少米。 */
const M_PER_DEG_LNG_AT_EQUATOR = 111320;

/** 一块沙盘的换算。 */
export interface FrameCoords {
  /** 经纬度换成沙盘里的 [x, z]（米）。 */
  toLocal(p: LngLat): [number, number];
  /** 沙盘里的 x、z 换回经纬度。 */
  toLngLat(x: number, z: number): LngLat;
  /**
   * 这一点在不在沙盘里面（压在边上也算）。
   * marginM 是离四边至少多少米才算：不写是 0；写负数是把沙盘往外放这么多米再看。
   */
  inside(p: LngLat, marginM?: number): boolean;
  /** 海拔（米）换成沙盘里的高度：（海拔 − 桌面的海拔）× 山高夸大的倍数。 */
  y(heightM: number): number;
  /** 沙盘的四边：西边 x0（负数）、东边 x1、北边 z0（负数）、南边 z1。 */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** 按沙盘的范围做出换算。 */
export function frameCoords(frame: SceneFrame): FrameCoords {
  const [lng0, lat0] = frame.center;
  const mPerDegLng = M_PER_DEG_LNG_AT_EQUATOR * Math.cos((lat0 * Math.PI) / 180);
  const x0 = -frame.westM;
  const x1 = frame.eastM;
  const z0 = -frame.northM;
  const z1 = frame.southM;
  const times = frame.relief.times;

  const toLocal = (p: LngLat): [number, number] => [(p[0] - lng0) * mPerDegLng, -(p[1] - lat0) * M_PER_DEG_LAT];
  const toLngLat = (x: number, z: number): LngLat => [lng0 + x / mPerDegLng, lat0 - z / M_PER_DEG_LAT];
  const inside = (p: LngLat, marginM = 0): boolean => {
    const [x, z] = toLocal(p);
    return x >= x0 + marginM && x <= x1 - marginM && z >= z0 + marginM && z <= z1 - marginM;
  };
  const y = (heightM: number): number => (heightM - frame.datumM) * times;

  return { toLocal, toLngLat, inside, y, x0, x1, z0, z1 };
}

/**
 * 沙盘外面的一个地方（远处）：从沙盘的原点看过去，它在哪个方向、多远，朝着它走会从沙盘边上的哪一点出去。
 * 题签就摆在那一点。
 *
 * bearingDeg：方向，0 是正北，顺时针，0 到 360 之间（不含 360）。km：从原点到那里的直线距离，公里。
 * 这个地方要是在沙盘里面，point 就是它自己；正好在原点上时方向算 0。
 */
export function farEdgePoint(frame: SceneFrame, at: LngLat): { point: LngLat; bearingDeg: number; km: number } {
  const coords = frameCoords(frame);
  const [x, z] = coords.toLocal(at);
  const meters = Math.hypot(x, z);
  if (meters === 0) return { point: [frame.center[0], frame.center[1]], bearingDeg: 0, km: 0 };

  // 朝北是 −z，朝东是 +x。
  const bearingDeg = ((Math.atan2(x, -z) * 180) / Math.PI + 360) % 360;

  // 从原点朝它走，走到全程的几分之几碰到沙盘的边：东西方向和南北方向各算一个，取先碰到的。
  const alongX = x > 0 ? coords.x1 / x : x < 0 ? coords.x0 / x : Infinity;
  const alongZ = z > 0 ? coords.z1 / z : z < 0 ? coords.z0 / z : Infinity;
  const t = Math.min(1, alongX, alongZ);

  return { point: coords.toLngLat(x * t, z * t), bearingDeg, km: meters / 1000 };
}

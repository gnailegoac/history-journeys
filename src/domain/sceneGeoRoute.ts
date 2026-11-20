// 全程沙盘的换算：经纬度和沙盘里的米之间来回换，海拔换成沙盘里的高度。
// 站点沙盘只有十几公里，照原点的纬度按比例换就够准（./sceneGeo.ts）；全程沙盘有两千公里，要用投影：
// 兰勃特等角圆锥，球面的算法，地球半径 6371 公里。形状不走样，南北两头的长度比中间大百分之一上下。
// 算法和定稿的样张（spikes/art-direction/route/scene/proj.js）是同一个，这里的单位是米，再除以沙盘的比例。
//
// 给出来的是和站点沙盘一样的一组换算（FrameCoords）：x 向东，z 向南，原点是 frame.center，单位是沙盘里的米。
// 所以摆镜头、摆题签、算地面的程序不用知道这是哪一层的沙盘；要分的只有“用哪一组换算”，就在 coordsOf 一处。
//
// 沙盘程序、校验和工具用它；页面的程序不用（src/domain/sceneText.ts 不引这个文件），所以它不跟着页面的程序下载。
// 这个文件里不写给人看的字。

import type { RouteFrame, RouteRelief, TableScene } from './scene';
import { frameCoords } from './sceneGeo';
import type { FrameCoords } from './sceneGeo';
import type { LngLat } from './types';

/** 地球的半径（米）。投影按球面算。 */
const EARTH_RADIUS_M = 6_371_000;
const RAD = Math.PI / 180;

/**
 * 矮山多夸的那条曲线：比桌面高 aboveM 米（真实的米）的地方，夸大以后高多少米（还没有除以沙盘的比例）。
 * lowBelowM 以下是直线，夸大 lowTimes 倍；再往上按 power 次方慢下来，在 lowBelowM 那一点上两段接得上。
 * 比桌面低的地方照直线往下算。
 */
export function curve(relief: RouteRelief, aboveM: number): number {
  const { lowBelowM, lowTimes, power } = relief;
  return aboveM <= lowBelowM ? aboveM * lowTimes : lowTimes * lowBelowM * (aboveM / lowBelowM) ** power;
}

/** curve 倒过来：夸大以后高 raisedM 米的地方，真的比桌面高多少米。 */
export function curveInverse(relief: RouteRelief, raisedM: number): number {
  const { lowBelowM, lowTimes, power } = relief;
  const knee = lowTimes * lowBelowM;
  return raisedM <= knee ? raisedM / lowTimes : lowBelowM * (raisedM / knee) ** (1 / power);
}

/**
 * 全程沙盘的换算。和 frameCoords 给出来的是同一种东西，四样不一样：
 *   toLocal、toLngLat 走的是圆锥投影；
 *   x0、x1、z0、z1 是范围的米数除以比例；
 *   inside 的 marginM 是沙盘里的米；
 *   y 是曲线夸大以后的高度除以比例。
 */
export function routeCoords(frame: RouteFrame): FrameCoords {
  const [lng0, lat0] = frame.center;
  const { lat1, lat2 } = frame.projection;
  const { scale, datumM, relief } = frame;

  const tq = (lat: number): number => Math.tan(Math.PI / 4 + (lat * RAD) / 2);
  const n = Math.log(Math.cos(lat1 * RAD) / Math.cos(lat2 * RAD)) / Math.log(tq(lat2) / tq(lat1));
  const f = (Math.cos(lat1 * RAD) * tq(lat1) ** n) / n;
  /** 这个纬度的那一圈，离圆锥的顶点多远（米）。 */
  const rho = (lat: number): number => (EARTH_RADIUS_M * f) / tq(lat) ** n;
  const rho0 = rho(lat0);

  const x0 = -frame.westM / scale;
  const x1 = frame.eastM / scale;
  const z0 = -frame.northM / scale;
  const z1 = frame.southM / scale;

  const toLocal = (p: LngLat): [number, number] => {
    const r = rho(p[1]);
    const turn = n * (p[0] - lng0) * RAD;
    // 朝北是 −z
    return [(r * Math.sin(turn)) / scale, -(rho0 - r * Math.cos(turn)) / scale];
  };
  const toLngLat = (x: number, z: number): LngLat => {
    const east = x * scale;
    const down = rho0 + z * scale;
    const r = Math.sign(n) * Math.hypot(east, down);
    const turn = Math.atan2(east, down);
    const lat = (2 * Math.atan(((EARTH_RADIUS_M * f) / r) ** (1 / n)) - Math.PI / 2) / RAD;
    return [lng0 + turn / n / RAD, lat];
  };
  const inside = (p: LngLat, marginM = 0): boolean => {
    const [x, z] = toLocal(p);
    return x >= x0 + marginM && x <= x1 - marginM && z >= z0 + marginM && z <= z1 - marginM;
  };
  const y = (heightM: number): number => curve(relief, heightM - datumM) / scale;

  return { toLocal, toLngLat, inside, y, x0, x1, z0, z1 };
}

/** 一座沙盘用哪一组换算：全程沙盘用圆锥投影，站点沙盘照原点的纬度按比例换。整个项目只在这里分。 */
export function coordsOf(scene: TableScene): FrameCoords {
  return scene.level === 'route' ? routeCoords(scene.frame) : frameCoords(scene.frame);
}

// 一次镜头飞行的计划：给出每个时刻镜头该在哪。纯计算，不依赖地图引擎。

import type { LngLat } from '../../domain/types';
import { Path, clamp, lerp, lerpAngle, angleDelta, smootherstep } from './geo';

export interface Camera {
  center: LngLat;
  zoom: number;
  /** 倾角，0 为正俯视，度。 */
  pitch: number;
  /** 方位，0 为朝北，顺时针，度。 */
  bearing: number;
}

export interface FlightPlan {
  durationMs: number;
  /** 镜头中心在地面上走过的路，公里。 */
  km: number;
  /** 时间过了 s（0 到 1）时的镜头。s 为 1 时正好是终点的镜头。 */
  at(s: number): Camera;
}

export interface FlightOptions {
  /** 镜头离所看的点 km 公里时的缩放级别。它和画面高度有关，由地图给出。 */
  zoomForDistanceKm(km: number, lat: number): number;
  /** “回到这一站”这样的归位：时间短，不升高。 */
  quick?: boolean;
}

/** 飞行时间的范围，毫秒。 */
export const FLIGHT_MIN_MS = 4000;
export const FLIGHT_MAX_MS = 9000;
/** 途中升到高处时的倾角上限，度。 */
const CRUISE_PITCH = 40;
const SAMPLES = 128;

/** 两端为 0、中间为 1 的鼓包。 */
const hump = (s: number) => Math.sin(Math.PI * s) ** 2;

/**
 * 从 from 飞到 to，镜头中心沿 points 这条折线走（首尾应是 from 和 to 的中心）。
 * 路远时途中升高，升到一屏能看见一大段路的高度；路近或一头本来就在高处时不升，直接过去。
 */
export function planFlight(from: Camera, to: Camera, points: LngLat[], options: FlightOptions): FlightPlan {
  const path = new Path(points);
  const km = path.totalKm;
  const durationMs = options.quick ? quickDuration(from, to, km) : clamp(FLIGHT_MIN_MS + 2.5 * km, FLIGHT_MIN_MS, FLIGHT_MAX_MS);

  // 升多高：让地面在最快的时候大约每秒移过半个多画面，看得清。
  const cruiseKm = clamp((5.5 * km) / (durationMs / 1000), 60, 5000);
  const cruiseZoom = options.zoomForDistanceKm(cruiseKm, path.at(0.5)[1]);
  const rise = !options.quick && cruiseZoom < Math.min(from.zoom, to.zoom) - 0.5;

  const zoomAt = (s: number) => {
    const z = lerp(from.zoom, to.zoom, smootherstep(s));
    return rise ? lerp(z, cruiseZoom, hump(s)) : z;
  };
  const pitchAt = (s: number) => {
    const p = lerp(from.pitch, to.pitch, smootherstep(s));
    return rise ? lerp(p, Math.min(p, CRUISE_PITCH), hump(s)) : p;
  };

  // 镜头中心走了全程的几分之几：越高走得越快（画面上的速度大致均匀），起步和收尾都慢。
  const cum = [0];
  for (let i = 1; i <= SAMPLES; i++) {
    const u = (i - 0.5) / SAMPLES;
    cum.push(cum[i - 1] + hump(u) * 2 ** -zoomAt(u));
  }
  const progress = (s: number) => {
    const x = s * SAMPLES;
    const i = Math.min(SAMPLES - 1, Math.floor(x));
    return lerp(cum[i], cum[i + 1], x - i) / cum[SAMPLES];
  };

  return {
    durationMs,
    km,
    at(s: number): Camera {
      const t = clamp(s, 0, 1);
      if (t >= 1) return { center: [to.center[0], to.center[1]], zoom: to.zoom, pitch: to.pitch, bearing: to.bearing };
      return {
        center: path.smoothAt(progress(t)),
        zoom: zoomAt(t),
        pitch: pitchAt(t),
        bearing: lerpAngle(from.bearing, to.bearing, smootherstep(t)),
      };
    },
  };
}

/** 地图的短边不小于这个数（像素）时，各站按数据里给的距离看。 */
const FULL_PANE_PX = 720;
/** 地图再小，各站的镜头最多拉近到数据里给的距离的这个比例。 */
const MIN_STOP_DISTANCE_SCALE = 0.55;

/**
 * 各站预设的镜头距离要乘的系数。地图小的时候（手机、平板竖放）按比例拉近：
 * 距离不变的话，一站周围的地点会挤在几个像素里，地名互相挡住，显示不出来。
 * 短边 720 像素以上是 1，越小越近，最多到 0.55。总览不用它。
 */
export function stopDistanceScale(paneWidth: number, paneHeight: number): number {
  return clamp(Math.min(paneWidth, paneHeight) / FULL_PANE_PX, MIN_STOP_DISTANCE_SCALE, 1);
}

/** 归位用的时间：动得越多越长，0.7 到 2.5 秒。 */
function quickDuration(from: Camera, to: Camera, km: number): number {
  const turn = Math.abs(angleDelta(from.bearing, to.bearing));
  const tilt = Math.abs(to.pitch - from.pitch);
  const zoom = Math.abs(to.zoom - from.zoom);
  return clamp(700 + 300 * zoom + 5 * turn + 8 * tilt + 2 * Math.min(km, 300), 700, 2500);
}

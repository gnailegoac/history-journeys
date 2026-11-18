// “设色”样张的定数：沙盘裁哪一块、山夸大几倍、水位、颜色。
// 颜色先写在这里，画的时候只从这里取。

import { toLocal, CITY, PLACES, RIVERS, DIKE } from '../../shared/scene-data.js';
import { densify, smoothstep } from './util.js';

/** 山的高度夸大的倍数（页面上的小注也用这个数） */
export const EX = 6;
/** 平地的基准海拔（米）。场景里的 y = (海拔 - DATUM) * EX */
export const DATUM = 40;
export const yOf = (h) => (h - DATUM) * EX;

/** 沙盘裁的范围（米，城中心为原点，x 向东，z 向南）：东西 11.7 公里，南北 9.7 公里 */
export const CROP = { x0: -6300, x1: 5400, z0: -5400, z1: 4300 };
export const CELL = 20;

/** 水位（抹平后的地形上的海拔，米）：示意 */
export const LEVEL = { normal: 37.6, flood: 43.7 };
export const BANK_H = 40.4;
export const CITY_H = 41.2;

const nw = toLocal(CITY.west, CITY.north);
const se = toLocal(CITY.east, CITY.south);
export const WALLRECT = { x0: nw.x, x1: se.x, z0: nw.z, z1: se.z };

export const local = (lng, lat) => {
  const p = toLocal(lng, lat);
  return [p.x, p.z];
};
export const PLACE = Object.fromEntries(PLACES.map((p) => [p.id, local(p.lng, p.lat)]));

/**
 * 河道：示意。照 shared 里的折线走，有两处是这套样张自己加的：
 *  - 画宽了（沙盘上的河本来就比实际宽，远看才是一条河）；
 *  - 离城远的地方加了一点弯，免得像尺子画的。到城下、到合流的地方不动。
 */
function meander(pts, amp, lambda, phase) {
  const out = [];
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    if (i > 0) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const nx = -(b[1] - a[1]) / l;
    const nz = (b[0] - a[0]) / l;
    const taper = smoothstep(1150, 2900, Math.hypot(pts[i][0], pts[i][1]));
    const k = (2 * Math.PI * s) / lambda;
    const off = amp * taper * (Math.sin(k + phase) + 0.38 * Math.sin(k * 2.3 + phase * 1.7));
    out.push([pts[i][0] + nx * off, pts[i][1] + nz * off]);
  }
  return out;
}
const riverLine = (r, amp, lambda, phase) => meander(densify(r.path.map(([a, b]) => local(a, b)), 60), amp, lambda, phase);
export const RIVER_PATHS = {
  bian: { w: 280, dense: riverLine(RIVERS.bian, 170, 3900, 0.4) },
  si: { w: 320, dense: riverLine(RIVERS.si, 130, 3100, 2.2) },
  joined: { w: 420, dense: riverLine(RIVERS.joined, 120, 3300, 1.1) },
};
/** 河中线上的一点：axis 是 'x' 或 'z'，取这个坐标最接近 v 的那一点（摆题签用） */
export function riverPoint(name, axis, v) {
  const k = axis === 'x' ? 0 : 1;
  let best = RIVER_PATHS[name].dense[0];
  for (const p of RIVER_PATHS[name].dense) if (Math.abs(p[k] - v) < Math.abs(best[k] - v)) best = p;
  return best;
}
export const DIKE_PTS = DIKE.map(([a, b]) => local(a, b));

// ---------- 颜色 ----------
export const PAL = {
  // 沙盘
  tea: '#e6d9b8', // 平地：茶色绢底
  teaWarm: '#e4d3a8', // 平地：带一点藤黄
  meadow: '#c4c9a2', // 河边、洼地的草色
  fieldA: '#d8cc9f', // 远看的田：三种浅色轮着上
  fieldB: '#cfc994',
  fieldC: '#c4c9a2',
  ochre: '#c0975f', // 山脚：赭石
  ochreDeep: '#99683f', // 沟里：深赭
  shilu: '#629b80', // 山腰：石绿
  shiluDeep: '#4f8a73',
  shiqing: '#3a6c9c', // 山顶：石青
  shiqingDeep: '#2d5689',
  sand: '#e6dbb9', // 河岸留白
  bed: '#b7c9c8', // 水底
  blank: '#efe6cf', // 画心四边留出的空绢
  road: '#ecdfbd', // 城里的街巷
  path: '#c9b184', // 城外的路
  cityGround: '#d3c5a4',
  // 水
  water: '#aac6cd', // 淡花青（大水）
  waterDeep: '#7da3b4',
  waterCalm: '#8fb5c2', // 平时的河深一点，河才看得见
  waterCalmDeep: '#6f9db2',
  ripple: '#f7f3e6',
  mist: '#f3ecdb',
  // 小模型
  tile: '#70767a', // 灰瓦
  plaster: '#efe8d6', // 白墙
  vermilion: '#9a3a2c', // 朱柱
  earthYellow: '#c8a765', // 黄楼的黄土墙
  timber: '#4b3229',
  brick: '#a9a08c', // 城砖
  stone: '#c7bda4',
  earth: '#d6ba7c', // 新筑的堤
  thatch: '#a38a58',
  boat: '#74513a',
  mat: '#bfa26a',
  tree: '#4a6e56', // 树的中间色；下暗上亮在模型里做
  treeBlue: '#47705f',
  treeOlive: '#6b7d50',
  willow: '#7c9468',
  dot: '#5d8268', // 远看的苔点
  rock: '#6d767b',
  rockPale: '#d9d5c6',
  // 装裱和座子
  brocade: '#e4d8ba', // 绫边
  brocadeFig: '#c9b88e',
  blockSide: '#c2a97c',
  sandal: '#33201b', // 紫檀
};

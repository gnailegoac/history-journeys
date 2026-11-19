// 全程沙盘用的投影：兰勃特等角圆锥（标准纬线 22°N、35°N），形状不走样。
// 桌面坐标：x 向东、y 向北，单位公里，原点在桌面正中（112.25°E, 28.25°N）。
// 这个文件不依赖浏览器，做数据的脚本和页面共用。

export const PROJ = { lat1: 22, lat2: 35, lng0: 112.25, lat0: 28.25, R: 6371 };
/** 桌面的大小（公里）和高程格子（每格 3 公里） */
export const TABLE = { w: 2001, h: 2262, cell: 3, cols: 668, rows: 755 };

const rad = Math.PI / 180;
const tq = (lat) => Math.tan(Math.PI / 4 + (lat * rad) / 2);
const n = Math.log(Math.cos(PROJ.lat1 * rad) / Math.cos(PROJ.lat2 * rad)) / Math.log(tq(PROJ.lat2) / tq(PROJ.lat1));
const F = (Math.cos(PROJ.lat1 * rad) * Math.pow(tq(PROJ.lat1), n)) / n;
const rho = (lat) => (PROJ.R * F) / Math.pow(tq(lat), n);
const rho0 = rho(PROJ.lat0);

/** 经纬度 -> 桌面公里 [x 东, y 北] */
export function toKm(lng, lat) {
  const r = rho(lat);
  const th = n * (lng - PROJ.lng0) * rad;
  return [r * Math.sin(th), rho0 - r * Math.cos(th)];
}
/** 桌面公里 -> 经纬度 */
export function toLngLat(x, y) {
  const dy = rho0 - y;
  const r = Math.sign(n) * Math.hypot(x, dy);
  const th = Math.atan2(x, dy);
  const lat = (2 * Math.atan(Math.pow((PROJ.R * F) / r, 1 / n)) - Math.PI / 2) / rad;
  return [PROJ.lng0 + th / n / rad, lat];
}
/** 这个纬度上，图上的长度是实际的多少倍（1 就是不走样） */
export function scaleAt(lat) {
  return (rho(lat) * n) / (PROJ.R * Math.cos(lat * rad));
}

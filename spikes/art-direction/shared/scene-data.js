// 三套样张共用的底稿：徐州一带的真实地形，加上场景里要摆的东西在哪。
// 坐标系：以城中心为原点，单位是米；x 向东，z 向南（所以北是 -z），y 向上。
//
// 哪些是真的，哪些是示意：
//   真的：地形（今天的高程数据）、云龙山、戏马台、放鹤亭、百步洪的位置（开放地图上查过）。
//   示意：城墙的范围、汴水和泗水的河道、堤、水位。样张只为看画面风格，这些到正式制作时再逐项考证。

export const ORIGIN = { lng: 117.185, lat: 34.2655 };

const M_PER_DEG_LAT = 110950;
const M_PER_DEG_LNG = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

/** 经纬度 → 场景里的米。 */
export function toLocal(lng, lat) {
  return { x: (lng - ORIGIN.lng) * M_PER_DEG_LNG, z: -(lat - ORIGIN.lat) * M_PER_DEG_LAT };
}

/**
 * 读高程网格。base 是 shared 文件夹的地址（如 '../shared/'）。
 * 返回 { meta, heights }：heights 是 Float32Array，单位米，逐行存，第 0 行最北，第 0 列最西。
 * meta 里有 cols、rows、west、east、south、north、widthM、heightM、minM、maxM。
 */
export async function loadDem(base) {
  const meta = await (await fetch(new URL('xuzhou-dem.json', new URL(base, location.href)))).json();
  const buf = await (await fetch(new URL('xuzhou-dem.bin', new URL(base, location.href)))).arrayBuffer();
  const raw = new Int16Array(buf);
  const heights = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) heights[i] = raw[i] / 10;
  const nw = toLocal(meta.west, meta.north);
  const se = toLocal(meta.east, meta.south);
  return { meta, heights, minX: nw.x, maxX: se.x, minZ: nw.z, maxZ: se.z };
}

/** 场景里某一点的真实海拔（米），双线性插值；出了范围取边上的值。 */
export function heightAt(dem, x, z) {
  const { meta, heights } = dem;
  const fx = ((x - dem.minX) / (dem.maxX - dem.minX)) * (meta.cols - 1);
  const fz = ((z - dem.minZ) / (dem.maxZ - dem.minZ)) * (meta.rows - 1);
  const cx = Math.max(0, Math.min(meta.cols - 1.001, fx));
  const cz = Math.max(0, Math.min(meta.rows - 1.001, fz));
  const ix = Math.floor(cx);
  const iz = Math.floor(cz);
  const ax = cx - ix;
  const az = cz - iz;
  const at = (c, r) => heights[r * meta.cols + c];
  return at(ix, iz) * (1 - ax) * (1 - az) + at(ix + 1, iz) * ax * (1 - az) + at(ix, iz + 1) * (1 - ax) * az + at(ix + 1, iz + 1) * ax * az;
}

/** 城墙：示意。正文说“城墙下面就是河，只有城南走得了车马”。边长约 1.2 公里的方城。 */
export const CITY = {
  west: 117.1785,
  east: 117.1915,
  south: 34.2601,
  north: 34.2709,
  gates: [
    { name: '东门', lng: 117.1915, lat: 34.2655, note: '黄楼后来盖在东门上（元丰元年）' },
    { name: '南门', lng: 117.185, lat: 34.2601, note: '只有城南走得了车马' },
    { name: '西门', lng: 117.1785, lat: 34.2655 },
    { name: '北门', lng: 117.185, lat: 34.2709 },
  ],
};

/** 正文提到的地点。exact 为 false 的是大致位置。 */
export const PLACES = [
  { id: 'ximatai', name: '戏马台', lng: 117.1842, lat: 34.2564, exact: true, what: '城南的一座高台（小山上的台子）' },
  { id: 'huanglou', name: '黄楼', lng: 117.1915, lat: 34.2655, exact: false, what: '东门上的大楼，墙刷黄土。水退以后才盖，“水来了”的时候还没有' },
  { id: 'yunlongshan', name: '云龙山', lng: 117.1723, lat: 34.2394, exact: true, what: '城南的山，山上有黄茅冈，满冈乱石' },
  { id: 'fangheting', name: '放鹤亭', lng: 117.1787, lat: 34.2477, exact: true, what: '云龙山北头山顶的亭子，张山人水退以后盖的' },
  { id: 'baibuhong', name: '百步洪', lng: 117.1967, lat: 34.247, exact: false, what: '城东南泗水上的一段乱石急滩' },
];

/** 河道：示意，[lng, lat] 的折线。汴水从西来，泗水从北来，在城东北角合成一股，贴着城往东南流。 */
export const RIVERS = {
  bian: {
    name: '汴水',
    widthM: 90,
    path: [
      [117.05, 34.29],
      [117.1, 34.283],
      [117.15, 34.2765],
      [117.176, 34.2728],
      [117.1935, 34.2724],
    ],
  },
  si: {
    name: '泗水',
    widthM: 110,
    path: [
      [117.215, 34.35],
      [117.207, 34.32],
      [117.199, 34.292],
      [117.1935, 34.2724],
    ],
  },
  joined: {
    name: '泗水（合流以后）',
    widthM: 150,
    path: [
      [117.1935, 34.2724],
      [117.1938, 34.262],
      [117.1967, 34.247],
      [117.212, 34.228],
      [117.25, 34.2],
      [117.3, 34.172],
    ],
  },
};

/** 堤：示意。“东南那一道，从戏马台山脚接到城墙。” */
export const DIKE = [
  [117.1842, 34.2572],
  [117.188, 34.2588],
  [117.1915, 34.2601],
];

/**
 * 水位：示意。正文：城下的水深二丈八尺九寸（约 9 米），有的地方比城里的平地高出一丈九寸（约 3.4 米）；
 * 东、西、北三面，水一直漫到山脚。
 * 今天的地面比宋代高（黄河后来在这一带淤了几百年），照今天的高程直接算淹不到山脚，
 * 所以样张里的大水水位由各套样张自己取一个“三面漫到山脚、城被墙和堤护住”的值，并在画面上注明是示意。
 */
export const WATER = {
  // 高程数据是今天的地表，城区里还带着今天的楼房起伏（城中心读数约 47 米，西边平地约 42 米，北边约 35 米）。
  // 用之前先把地形抹平一些（比如按 150 米左右的半径模糊），城墙里面压成一块平地，河道往下挖几米；
  // 平时和大水的水位都从抹平后的地形上取，不要照搬下面的数。
  normalHintM: 33,
  floodHintM: 45,
};

/** 正文的小节，和每一节镜头该看哪里的提示。 */
export const SECTIONS = [
  { heading: '到徐州', look: '全景：三面是山，只有西边是平地；两条河在城东北角合流，贴着城往东南去；城南的戏马台' },
  { heading: '水来了', look: '水从北面和西面漫过来，到了城下' },
  { heading: '住在城墙上', look: '大水：三面漫到山脚；东南的堤从戏马台山脚接到城墙；几百条船系在城下挡浪' },
  { heading: '水退以后', look: '东门上的黄楼' },
  { heading: '云龙山和百步洪', look: '云龙山、放鹤亭；城东南的百步洪' },
  { heading: '石炭', look: '往西南看（白土镇在二十多公里外，不在这块沙盘里）' },
  { heading: '要走了', look: '出城往西，去南京（今商丘）的路' },
];

// 做全程沙盘的地形文件要用的几样。用它们的是 tests/tools/route-tools.test.ts（npm run route:terrain）；只在 Node 里跑。
//
// 地形文件 content/figures/<人物>/scenes/route.terrain.bin 是一张经纬度的格子：
//   多少列、多少行、四边在哪，照这位人物的场景文件里 terrain 那一块写的做（gridOf）；两头都正好落在格点上。
//   苏轼的那一座是 570 列 × 520 行，西 100.86、东 123.62、北 38.46、南 17.70，每格 0.04 度；
//   每格一个 16 位整数（低位在前），单位是米（站点沙盘的地形文件是分米，不一样）；逐行存，第 0 行最北，第 0 列最西。
//   它同时带着“今天哪里是陆地”：不在今天陆地上的格子存 0，陆地上的格子存它的高，但最小是 1。
//   页面不带今天的海岸线，整理地面的程序就是靠“是不是 0”分出陆地和海的。
//
// 高程是从源数据里重新取样来的：哪一位人物的源数据在哪，写在 ./figures.ts 的那张表里。苏轼的是样张的文件
//（spikes/art-direction/route/data/dem.bin：圆锥投影上每格 3 公里的格子，668 × 755，整米，海面按 0）。
// 取样要用源数据的投影，所以这里有一份（lambertConic），照样张的 scene/proj.js 抄的，
// 算式的先后一样，算出来的数也一样。不连任何外面的服务。

export type LngLat = [number, number];

// ---------------------------------------------------------------- 样张用的投影

/** 兰勃特等角圆锥投影（按球算）的几个数：两条标准纬线，正中的经纬度，球的半径（公里）。 */
export interface ConicParams {
  lat1: number;
  lat2: number;
  lng0: number;
  lat0: number;
  R: number;
}

export interface Conic {
  /** 经纬度 → 公里：x 向东，y 向北，原点在正中。 */
  toKm(lng: number, lat: number): [number, number];
  /** 公里 → 经纬度。 */
  toLngLat(x: number, y: number): LngLat;
}

export function lambertConic(p: ConicParams): Conic {
  const rad = Math.PI / 180;
  const tq = (lat: number): number => Math.tan(Math.PI / 4 + (lat * rad) / 2);
  const n = Math.log(Math.cos(p.lat1 * rad) / Math.cos(p.lat2 * rad)) / Math.log(tq(p.lat2) / tq(p.lat1));
  const F = (Math.cos(p.lat1 * rad) * Math.pow(tq(p.lat1), n)) / n;
  const rho = (lat: number): number => (p.R * F) / Math.pow(tq(lat), n);
  const rho0 = rho(p.lat0);
  return {
    toKm(lng, lat) {
      const r = rho(lat);
      const th = n * (lng - p.lng0) * rad;
      return [r * Math.sin(th), rho0 - r * Math.cos(th)];
    },
    toLngLat(x, y) {
      const dy = rho0 - y;
      const r = Math.sign(n) * Math.hypot(x, dy);
      const th = Math.atan2(x, dy);
      const lat = (2 * Math.atan(Math.pow((p.R * F) / r, 1 / n)) - Math.PI / 2) / rad;
      return [p.lng0 + th / n / rad, lat];
    },
  };
}

// ---------------------------------------------------------------- 样张的高程格子

/** 样张的高程格子。第 0 行最北、第 0 列最西；格点 (行 r, 列 c) 在 x = −宽/2 + c × 格，y = 高/2 − r × 格（公里）。 */
export interface TrialDem {
  cols: number;
  rows: number;
  cellKm: number;
  widthKm: number;
  heightKm: number;
  /** 文件里写的最高的一格（米）。 */
  maxM: number;
  params: ConicParams;
  conic: Conic;
  /** 米，逐行存。 */
  heights: Int16Array;
}

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 读样张的 dem.json 和 dem.bin。两个文件对不上（大小、格子和宽高、投影的数不全）就停下来说。 */
export function readTrialDem(jsonText: string, bytes: Uint8Array): TrialDem {
  const j = JSON.parse(jsonText) as { cols?: unknown; rows?: unknown; cellKm?: unknown; widthKm?: unknown; heightKm?: unknown; maxM?: unknown; projection?: Record<string, unknown> };
  const { cols, rows, cellKm, widthKm, heightKm, maxM } = j;
  const pr = j.projection ?? {};
  const { lat1, lat2, lng0, lat0, R } = pr;
  if (![cols, rows, cellKm, widthKm, heightKm, maxM, lat1, lat2, lng0, lat0, R].every(isNumber)) throw new Error('源数据的 dem.json 里格子或者投影的数不全');
  const [c, r, cell, w, h] = [cols, rows, cellKm, widthKm, heightKm] as number[];
  if ((c - 1) * cell !== w || (r - 1) * cell !== h) throw new Error(`源数据的 dem.json：${c} 列 × ${r} 行、每格 ${cell} 公里，和宽 ${w}、高 ${h} 公里对不上`);
  if (bytes.length !== c * r * 2) throw new Error(`源数据的 dem.bin 应该是 ${c * r * 2} 字节（${c} 列 × ${r} 行 × 2），实际是 ${bytes.length} 字节`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const heights = new Int16Array(c * r);
  for (let i = 0; i < heights.length; i++) heights[i] = view.getInt16(i * 2, true);
  const params: ConicParams = { lat1: lat1 as number, lat2: lat2 as number, lng0: lng0 as number, lat0: lat0 as number, R: R as number };
  return { cols: c, rows: r, cellKm: cell, widthKm: w, heightKm: h, maxM: maxM as number, params, conic: lambertConic(params), heights };
}

/** 一点在样张格子上的位置（列、行，带小数）。 */
function trialCell(dem: TrialDem, lng: number, lat: number): [number, number] {
  const [x, y] = dem.conic.toKm(lng, lat);
  return [(x + dem.widthKm / 2) / dem.cellKm, (dem.heightKm / 2 - y) / dem.cellKm];
}

/** 这一点在不在样张的桌面里（出了桌面，样张没有量过）。 */
export function insideTrial(dem: TrialDem): (lng: number, lat: number) => boolean {
  return (lng, lat) => {
    const [fx, fy] = trialCell(dem, lng, lat);
    return fx >= 0 && fx <= dem.cols - 1 && fy >= 0 && fy <= dem.rows - 1;
  };
}

/** 样张格子上任意一点的高（米）：格子之间按远近匀开；出了桌面取最近的边上的值。 */
export function trialHeightAt(dem: TrialDem): (lng: number, lat: number) => number {
  const { cols, rows, heights } = dem;
  return (lng, lat) => {
    const [fx, fy] = trialCell(dem, lng, lat);
    const cx = Math.max(0, Math.min(cols - 1, fx));
    const cy = Math.max(0, Math.min(rows - 1, fy));
    const ix = Math.min(cols - 2, Math.floor(cx));
    const iy = Math.min(rows - 2, Math.floor(cy));
    const ax = cx - ix;
    const ay = cy - iy;
    const k = iy * cols + ix;
    return heights[k] * (1 - ax) * (1 - ay) + heights[k + 1] * ax * (1 - ay) + heights[k + cols] * (1 - ax) * ay + heights[k + cols + 1] * ax * ay;
  };
}

// ---------------------------------------------------------------- 地形文件的格子

/** 一张经纬度的格子：两头都落在格点上。 */
export interface LatLngGrid {
  cols: number;
  rows: number;
  west: number;
  east: number;
  north: number;
  south: number;
}

/**
 * 一座全程沙盘的地形文件的格子：就是它的场景文件里 terrain 那一块写的六个数（cols、rows、west、east、north、south）。
 * 格子只写在场景里一处：工具照它做，页面照它读，不在这里另存一份。
 */
export function gridOf(terrain: LatLngGrid): LatLngGrid {
  const { cols, rows, west, east, north, south } = terrain;
  const numbers = [cols, rows, west, east, north, south];
  if (numbers.some((n) => typeof n !== 'number' || !Number.isFinite(n)) || !Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 || !(east > west) || !(north > south)) {
    throw new Error(`场景的 terrain 里写的格子不成样子：cols ${cols}、rows ${rows}、west ${west}、east ${east}、north ${north}、south ${south}`);
  }
  return { cols, rows, west, east, north, south };
}

/** 第 i 列的经度。两头正好是 west 和 east（不让小数的进位差出一点）。 */
export const lngOf = (grid: LatLngGrid, i: number): number => (i === 0 ? grid.west : i === grid.cols - 1 ? grid.east : grid.west + ((grid.east - grid.west) * i) / (grid.cols - 1));
/** 第 j 行的纬度（第 0 行最北）。两头正好是 north 和 south。 */
export const latOf = (grid: LatLngGrid, j: number): number => (j === 0 ? grid.north : j === grid.rows - 1 ? grid.south : grid.north - ((grid.north - grid.south) * j) / (grid.rows - 1));

/**
 * 哪些格子在陆地上（1 是，0 不是）：格点那一点落在哪一圈里面就算。
 * 几圈是合起来算的：落在两圈里面还是陆地（样张的岸线里同一个岛有重复的两圈，按“进出抵消”算的话那些岛就成了海）。
 * 每一圈当成首尾相接的；正好落在边上的点，西边、南边的算在里面，东边、北边的不算。
 */
export function landMask(grid: LatLngGrid, rings: LngLat[][]): Uint8Array {
  const { cols, rows } = grid;
  const mask = new Uint8Array(cols * rows);
  const stepLng = (grid.east - grid.west) / (cols - 1);
  const spans = rings.map((ring) => {
    let south = Infinity;
    let north = -Infinity;
    for (const p of ring) {
      south = Math.min(south, p[1]);
      north = Math.max(north, p[1]);
    }
    return { south, north };
  });
  for (let j = 0; j < rows; j++) {
    const lat = latOf(grid, j);
    rings.forEach((ring, at) => {
      if (lat < spans[at].south || lat >= spans[at].north) return;
      const crossings: number[] = [];
      for (let k = 0; k < ring.length; k++) {
        const a = ring[k];
        const b = ring[(k + 1) % ring.length];
        if ((a[1] > lat) !== (b[1] > lat)) crossings.push(a[0] + ((lat - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      crossings.sort((p, q) => p - q);
      for (let k = 0; k + 1 < crossings.length; k += 2) {
        const from = Math.max(0, Math.floor((crossings[k] - grid.west) / stepLng) - 1);
        const to = Math.min(cols - 1, Math.ceil((crossings[k + 1] - grid.west) / stepLng) + 1);
        for (let i = from; i <= to; i++) {
          const lng = lngOf(grid, i);
          if (lng >= crossings[k] && lng < crossings[k + 1]) mask[j * cols + i] = 1;
        }
      }
    });
  }
  return mask;
}

/** 做出来的格子上的一格：多高，在哪。 */
export interface CellAt {
  m: number;
  lng: number;
  lat: number;
}

export interface TerrainReport {
  /** 最高的一格。 */
  highest: CellAt;
  /** 四个角上的格子各多高（米）。 */
  corners: { nw: number; ne: number; sw: number; se: number };
  /** 陆地上的格子、不在陆地上的格子各多少。 */
  land: number;
  sea: number;
  /** 在陆地上、取样出来不到 1 米的格子（存成了 1）。 */
  raised: number;
  /** 不在陆地上、取样出来却不是 0 的格子（存成了 0）。 */
  zeroed: number;
  /** 格点落在原来的数据以外的格子（取的是最近的边上的值）；没给 known 时是 0。 */
  outside: number;
}

/** 每格取几个点平均：横竖各 3 个，匀在这一格里（离格点 −1/3、0、+1/3 格）。 */
const SAMPLES = [-1 / 3, 0, 1 / 3];

/**
 * 把高程取到经纬度的格子上。heightAt 给出任意一点的高（米）；land 是 landMask 的结果；
 * known 说一点在不在原来的数据里（只用来数“取的是边上的值”的格子有多少）。
 * 每格：横竖各 3 个点的平均，四舍五入成整米；不在陆地上的存 0，陆地上的最小存 1。
 */
export function resampleTerrain(
  grid: LatLngGrid,
  heightAt: (lng: number, lat: number) => number,
  land: Uint8Array,
  known?: (lng: number, lat: number) => boolean,
): { heights: Int16Array; report: TerrainReport } {
  const { cols, rows } = grid;
  if (land.length !== cols * rows) throw new Error(`陆地的标记有 ${land.length} 格，应该是 ${cols * rows} 格`);
  const stepLng = (grid.east - grid.west) / (cols - 1);
  const stepLat = (grid.north - grid.south) / (rows - 1);
  const heights = new Int16Array(cols * rows);
  let highest: CellAt = { m: -1, lng: 0, lat: 0 };
  let landCount = 0;
  let raised = 0;
  let zeroed = 0;
  let outside = 0;
  for (let j = 0; j < rows; j++) {
    const lat = latOf(grid, j);
    for (let i = 0; i < cols; i++) {
      const lng = lngOf(grid, i);
      let sum = 0;
      for (const b of SAMPLES) for (const a of SAMPLES) sum += heightAt(lng + a * stepLng, lat + b * stepLat);
      const mean = Math.round(sum / (SAMPLES.length * SAMPLES.length));
      if (!Number.isFinite(mean) || mean > 32767) throw new Error(`第 ${j} 行第 ${i} 列取样出来是 ${mean}，存不进 16 位整数`);
      if (known && !known(lng, lat)) outside += 1;
      let value = 0;
      if (land[j * cols + i] === 1) {
        landCount += 1;
        if (mean < 1) raised += 1;
        value = Math.max(1, mean);
      } else if (mean !== 0) {
        zeroed += 1;
      }
      heights[j * cols + i] = value;
      if (value > highest.m) highest = { m: value, lng, lat };
    }
  }
  const corner = (j: number, i: number): number => heights[j * cols + i];
  return {
    heights,
    report: {
      highest,
      corners: { nw: corner(0, 0), ne: corner(0, cols - 1), sw: corner(rows - 1, 0), se: corner(rows - 1, cols - 1) },
      land: landCount,
      sea: cols * rows - landCount,
      raised,
      zeroed,
      outside,
    },
  };
}

/** 格子写成文件的字节：每格两个字节，低位在前。 */
export function terrainBytes(heights: Int16Array): Uint8Array {
  const bytes = new Uint8Array(heights.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < heights.length; i++) view.setInt16(i * 2, heights[i], true);
  return bytes;
}

/** 把地形文件的字节读回成格子（查的时候用）。大小不对就停下来说。 */
export function readTerrain(grid: LatLngGrid, bytes: Uint8Array): Int16Array {
  const want = grid.cols * grid.rows * 2;
  if (bytes.length !== want) throw new Error(`地形文件应该是 ${want} 字节（${grid.cols} 列 × ${grid.rows} 行 × 2），实际是 ${bytes.length} 字节`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const heights = new Int16Array(grid.cols * grid.rows);
  for (let i = 0; i < heights.length; i++) heights[i] = view.getInt16(i * 2, true);
  return heights;
}

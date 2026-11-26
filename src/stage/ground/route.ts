// 全程沙盘的地面：从地形文件算出一张网格上的海拔、夸大以后的高度和“是不是陆地”。
// 和站点沙盘的地面（./index.ts 的 buildFields）是两套算法，互不相干：这里没有河床、没有修整垫高、没有田，
// 海、湖、河都是后来画在地面上的；这个文件 ./index.ts 不引，站点沙盘的地面一个字节也不受它影响。
// 只算数：不碰 three，也不碰页面，在 Node 里也能跑。规矩写在 docs/data-spec.md“全程沙盘的场景数据”。
//
// 先后（每一步的输入是上一步的结果）：
//   1 每个格点换成经纬度，到地形文件里取海拔和“是不是陆地”（文件里 0 是海）；
//   2 抹成海的圈（terrain.edits，op 是 sea）里面改成海；
//   3 沙盘四边往里 edgeTaperM 米以内，海拔慢慢收到零；
//   4 轻轻抹一下（半格）；
//   5 平原抹成缓坡（recipe 是 plain-smoothed），只动陆地；
//   6 海拔过“矮山多夸”的曲线，除以沙盘的比例，得到沙盘里的高度；
//   7 留白的圈（recipe.blank）里面，把夸大以后的高度压到 3%，再倒算回海拔，两样才对得上。
//     西边的高原和西南角那两条边不照圈的直线切，用噪声打散、顺着山谷伸进来（blankKeep）。

import { contentKey } from '../../domain/contentKey';
import type { PlainSmoothed, RouteScene, RouteTerrain } from '../../domain/scene';
import type { FrameCoords } from '../../domain/sceneGeo';
import { curveInverse } from '../../domain/sceneGeoRoute';
import type { LngLat } from '../../domain/types';
import { gauss } from './blur';
import { bilinear, gridOf } from './grid';
import type { Grid } from './grid';
import { clamp, fbm, smoothstep } from './num';
import type { Dem, GroundSamplers } from './types';

/** 第 4 步轻轻抹一下：抹开多少格。半格：0.04 度一格的地形文件抹这么多，山的样子和定稿的样张对得上。 */
export const ROUTE_SOFTEN_CELLS = 0.5;
/** “四周的平均海拔”取多大一圈（米）：定一个地方算不算平原用（第 5 步）。 */
export const REGION_BLUR_M = 20_000;
/** 沙盘四边往里这么多米以内，海拔是零；再往里到 edgeTaperM 慢慢放开（第 3 步）。 */
export const EDGE_ZERO_M = 6_000;
/**
 * 留白的边怎么收（第 7 步）。这是样式的事：一种样式的全程沙盘一份（RouteStyle.blank），造地面的时候交进来；这个文件里不留哪一座沙盘的数。
 * blurM：圈的边抹开这么多米，地势才慢慢收平、不留陡坎。
 * torn：把边打散。不写就不打散：圈是怎么写的，边就照它抹开。
 */
export interface BlankEdge {
  blurM: number;
  torn?: BlankTear;
}

/**
 * 留白的边在西边打散：圈是场景里写的直线，照直线切，高原和山地那一头就成了笔直的边。
 * 所以经线 westOf 以西，一个点算不算在圈里，不照它自己的位置，照它挪开一点以后的位置算；
 * 挪多少是两层噪声定的，山里的谷底再多挪一些：留白顺着山谷伸进来，山脊留在外面。
 */
export interface BlankTear {
  /** 两条经线（度）：第一条以西整个打散，第二条以东不动，中间匀着过渡。 */
  westOf: [number, number];
  /** 往东最多挪多少度、往西最多挪多少度、南北最多挪多少度。 */
  eastDeg: number;
  westDeg: number;
  latDeg: number;
  /** 抹开以后再打散一遍，最多把那个数挪多少（在边线上；往两头慢慢不挪）。 */
  again: number;
  /** 谷底只算到这两条经线之间为止（往东慢慢不算）。 */
  valleyWestOf: [number, number];
}
/** 留白的地方，夸大以后的高度只留这么多。 */
export const BLANK_KEEP = 0.03;

/**
 * 全程沙盘整理好的地面：一张网格。每格 cell 米（沙盘里的米），nx 列、nz 行；
 * 第 k = j × nx + i 格在 x = x0 + i × cell，z = z0 + j × cell（第 0 行最北，第 0 列最西）。
 */
export interface RouteGround {
  nx: number;
  nz: number;
  cell: number;
  x0: number;
  z0: number;
  /** 海拔：真实的米。海是 0（离岸一格以内抹过，会高出几米）。 */
  h: Float32Array;
  /** 沙盘里的高度（沙盘里的米）：过了“矮山多夸”的曲线、除了比例；留白的地方压过。 */
  y: Float32Array;
  /** 是不是陆地：1 是，0 是海。 */
  land: Uint8Array;
  /** 离留白多远（blankSoft 算的）：1 是离得远，0 是留白里面深处；这一格的高度留了多少是 keepAt(blank[k])。 */
  blank: Float32Array;
}

/**
 * 把全程沙盘的地形文件读成高程网格。文件里是 16 位整数（低位在前），单位是米，逐行存，第 0 行最北，第 0 列最西；
 * 0 是今天的陆地以外（海），陆地至少是 1。bytes 的大小不是 行 × 列 × 2 字节时抛出错误。
 */
export function readRouteDem(terrain: RouteTerrain, bytes: ArrayBuffer): Dem {
  const { cols, rows } = terrain;
  const want = cols * rows * 2;
  if (bytes.byteLength !== want) {
    throw new Error(`地形文件 ${terrain.file} 的大小不对：${rows} 行 × ${cols} 列应该是 ${want} 字节，实际是 ${bytes.byteLength} 字节`);
  }
  const view = new DataView(bytes);
  const heights = new Float32Array(cols * rows);
  for (let i = 0; i < heights.length; i++) heights[i] = view.getInt16(i * 2, true);
  return { cols, rows, west: terrain.west, east: terrain.east, south: terrain.south, north: terrain.north, heights };
}

/** 一点在不在一圈线里面（照经纬度直接算；圈不用把第一点再写一遍）。 */
function insideRing(lng: number, lat: number, ring: readonly LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a[1] > lat !== b[1] > lat && lng < ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

interface Boxed {
  ring: readonly LngLat[];
  west: number;
  east: number;
  south: number;
  north: number;
}

function boxed(ring: readonly LngLat[]): Boxed {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const [lng, lat] of ring) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return { ring, west, east, south, north };
}

const within = (lng: number, lat: number, rings: Boxed[]): boolean =>
  rings.some((b) => lng >= b.west && lng <= b.east && lat >= b.south && lat <= b.north && insideRing(lng, lat, b.ring));

/** 很轻的抹平（不到一格）：三点的小核，横竖各一遍。出了边取边上的值。 */
function soften(src: Float32Array, nx: number, nz: number, cells: number): Float32Array {
  const a = clamp((cells * cells) / 2, 0, 0.33);
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let j = 0; j < nz; j++) {
    const row = j * nx;
    for (let i = 0; i < nx; i++) tmp[row + i] = src[row + i] * (1 - 2 * a) + a * (src[row + Math.max(0, i - 1)] + src[row + Math.min(nx - 1, i + 1)]);
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) out[j * nx + i] = tmp[j * nx + i] * (1 - 2 * a) + a * (tmp[Math.max(0, j - 1) * nx + i] + tmp[Math.min(nz - 1, j + 1) * nx + i]);
  }
  return out;
}

/** 第 1 到 4 步做完的样子：海拔（真实的米）和“是不是陆地”。平原还没有抹，留白还没有压。 */
export interface RouteHeights {
  grid: Grid;
  h: Float32Array;
  land: Uint8Array;
  /** 每个格点的经纬度：[经度, 纬度] 一对一对排着。 */
  lngLat: Float32Array;
}

/**
 * 第 1 到 4 步：取海拔和陆地，抹成海的圈，四边收到零，轻轻抹一下。
 * 海拔在地形文件的格子之间按远近匀开；四个格子里不是 0 的占的分量够一半，这一点才算陆地（文件里 0 是海）。
 * 站点沙盘的 demSampler 用不得：它当经纬度和米是成比例的，两千公里的沙盘上不是。
 */
export function routeHeights(scene: RouteScene, dem: Dem, coords: FrameCoords): RouteHeights {
  const grid = gridOf(coords);
  const { nx, nz, cell, x0, z0 } = grid;
  const { cols, rows, heights } = dem;
  const n = nx * nz;
  const raw = new Float32Array(n);
  const land = new Uint8Array(n);
  const lngLat = new Float32Array(n * 2);
  const seas = scene.terrain.edits.filter((edit) => edit.op === 'sea' && edit.area.length >= 3).map((edit) => boxed(edit.area));
  const { scale } = scene.frame;
  const taper = scene.terrain.recipe.edgeTaperM;
  const zero = Math.min(EDGE_ZERO_M, taper / 2);

  for (let j = 0; j < nz; j++) {
    const z = z0 + j * cell;
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * cell;
      const k = j * nx + i;
      const [lng, lat] = coords.toLngLat(x, z);
      lngLat[k * 2] = lng;
      lngLat[k * 2 + 1] = lat;
      // 1 地形文件里取海拔和陆地
      const fx = clamp(((lng - dem.west) / (dem.east - dem.west)) * (cols - 1), 0, cols - 1.001);
      const fy = clamp(((dem.north - lat) / (dem.north - dem.south)) * (rows - 1), 0, rows - 1.001);
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      const ax = fx - ix;
      const ay = fy - iy;
      const o = iy * cols + ix;
      const h00 = heights[o];
      const h10 = heights[o + 1];
      const h01 = heights[o + cols];
      const h11 = heights[o + cols + 1];
      const w00 = (1 - ax) * (1 - ay);
      const w10 = ax * (1 - ay);
      const w01 = (1 - ax) * ay;
      const w11 = ax * ay;
      const share = (h00 !== 0 ? w00 : 0) + (h10 !== 0 ? w10 : 0) + (h01 !== 0 ? w01 : 0) + (h11 !== 0 ? w11 : 0);
      // 2 抹成海的圈
      const isLand = share >= 0.5 && !within(lng, lat, seas);
      land[k] = isLand ? 1 : 0;
      if (!isLand) continue;
      // 3 四边收到零
      const toEdge = Math.min(x - coords.x0, coords.x1 - x, z - coords.z0, coords.z1 - z) * scale;
      raw[k] = (h00 * w00 + h10 * w10 + h01 * w01 + h11 * w11) * (taper > 0 ? smoothstep(zero, taper, toEdge) : 1);
    }
  }
  // 4 轻轻抹一下
  return { grid, h: soften(raw, nx, nz, ROUTE_SOFTEN_CELLS), land, lngLat };
}

/**
 * 第 5 步，平原抹成缓坡（recipe 是 plain-smoothed）。cellM 是一格在地上有多少米。只动陆地；返回新的一张，不改传进来的。
 *   这一带算不算平原 k = 陆地 ×（1 − 从 plainBelowM 到 hillAboveM 匀着过渡（四周约 20 公里的平均海拔））
 *   平原自己的缓坡   S = 抹开 smoothM 的（海拔 × k）÷ 抹开 smoothM 的 k        山和海不掺进来
 *   比缓坡高出、低下 d = 海拔 − S
 *   留多少           kept = plainKeep +（1 − plainKeep）× 从 rippleM[0] 到 rippleM[1] 匀着过渡（|d|）
 *   抹过的海拔       = 海拔 − k ×（1 − kept）× d
 */
export function smoothPlain(h: Float32Array, land: Uint8Array, recipe: PlainSmoothed, nx: number, nz: number, cellM: number): Float32Array {
  const { k, slope } = plainSlope(h, land, recipe, nx, nz, cellM);
  const out = new Float32Array(nx * nz);
  const [low, high] = recipe.rippleM;
  for (let i = 0; i < out.length; i++) {
    if (!land[i] || k[i] === 0) {
      out[i] = h[i];
      continue;
    }
    const d = h[i] - slope[i];
    const kept = recipe.plainKeep + (1 - recipe.plainKeep) * smoothstep(low, high, Math.abs(d));
    out[i] = h[i] - k[i] * (1 - kept) * d;
  }
  return out;
}

/** smoothPlain 的前一半：每一格算不算平原（k，0 到 1），和平原自己的缓坡在这一格多高（slope，米）。测试也用它。 */
export function plainSlope(h: Float32Array, land: Uint8Array, recipe: PlainSmoothed, nx: number, nz: number, cellM: number): { k: Float32Array; slope: Float32Array } {
  const n = nx * nz;
  const around = gauss(h, nx, nz, REGION_BLUR_M / cellM);
  const k = new Float32Array(n);
  const weighted = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    k[i] = land[i] ? 1 - smoothstep(recipe.plainBelowM, recipe.hillAboveM, around[i]) : 0;
    weighted[i] = h[i] * k[i];
  }
  const sum = gauss(weighted, nx, nz, recipe.smoothM / cellM);
  const share = gauss(k, nx, nz, recipe.smoothM / cellM);
  const slope = new Float32Array(n);
  for (let i = 0; i < n; i++) slope[i] = share[i] > 1e-4 ? sum[i] / share[i] : h[i];
  return { k, slope };
}

/** 压到 limit 以内，不留平的一段：小的时候几乎不动，大了慢慢贴上去。 */
const soften1 = (v: number, limit: number): number => limit * Math.tanh(v / limit);

/**
 * 离留白多远，抹开了的：圈里面是 0、外面是 1（样式写了打散的，边先打散，见 BlankTear），抹开 edge.blurM。
 * 0.5 在（打散以后的）边线上；抹开 40 公里的话，边线以外一百公里上下才正好是 1，以内一百公里上下才正好是 0。
 * edge 是这座沙盘的样式里留白的边怎么收（RouteStyle.blank）。
 * heights 是第 1 到 4 步的结果（平原还没有抹）：山里的谷底照它量。
 * 地势照它收平（keepAt），上色的工具照它把颜色淡下去（颜色比地势先淡完）。
 */
export function blankSoft(scene: RouteScene, heights: Pick<RouteHeights, 'grid' | 'lngLat' | 'h'>, edge: BlankEdge): Float32Array {
  const { nx, nz, cell } = heights.grid;
  const n = nx * nz;
  const rings = scene.terrain.recipe.blank.filter((ring) => ring.length >= 3).map(boxed);
  const keep = new Float32Array(n).fill(1);
  if (rings.length === 0) return keep;
  const cellM = cell * scene.frame.scale;
  const tear = edge.torn;
  // 山里的谷底：比四周六十公里的平均低多少（只算七八百米以上的山里；盆地、平原不算）
  const near = gauss(heights.h, nx, nz, 9000 / cellM);
  const around = gauss(heights.h, nx, nz, 60_000 / cellM);
  for (let k = 0; k < n; k++) {
    let lng = heights.lngLat[k * 2];
    let lat = heights.lngLat[k * 2 + 1];
    const torn = tear ? 1 - smoothstep(tear.westOf[0], tear.westOf[1], lng) : 0;
    if (tear && torn > 0) {
      const valley = clamp((around[k] - near[k]) / 650, 0, 1) * smoothstep(700, 1100, near[k]) * (1 - smoothstep(tear.valleyWestOf[0], tear.valleyWestOf[1], lng));
      const wn = (fbm(lng * 2.1, lat * 2.1, 3, 301) - 0.5) * 1.5 + (fbm(lng * 0.7 + 9, lat * 0.7, 2, 307) - 0.5) * 2.6;
      const vn = (fbm(lng * 1.9 + 31, lat * 1.9 + 7, 3, 311) - 0.5) * 1.5 + (fbm(lng * 0.6 + 3, lat * 0.6 + 17, 2, 313) - 0.5) * 2.2;
      // 留白往东伸多少度（正的是往东）、往北伸多少度（正的是往北）
      const east = 1.5 * valley - wn;
      const north = 0.9 * valley - vn;
      lng -= torn * (east > 0 ? soften1(east, tear.eastDeg) : soften1(east, tear.westDeg));
      lat -= torn * soften1(north, tear.latDeg);
    }
    if (within(lng, lat, rings)) keep[k] = 0;
  }
  const soft = gauss(keep, nx, nz, edge.blurM / cellM);
  if (!tear) return soft;
  // 抹开以后边又顺了，收平的那一道坡成了一条匀匀的带子。打散的那一头再打散一遍：坡脚往前往后挪十几公里，七八十公里一个起伏。
  // 只动过渡的那一条（乘了 soft × (1 − soft)）：留白里面深处还是 0，离得远的还是 1
  for (let k = 0; k < n; k++) {
    const s = soft[k];
    if (s <= 0 || s >= 1) continue;
    const lng = heights.lngLat[k * 2];
    const torn = 1 - smoothstep(tear.westOf[0], tear.westOf[1], lng);
    if (torn <= 0) continue;
    const lat = heights.lngLat[k * 2 + 1];
    soft[k] = clamp(s + torn * tear.again * (fbm(lng * 1.3 + 5, lat * 1.3 + 11, 2, 317) - 0.5) * 4 * s * (1 - s), 0, 1);
  }
  return soft;
}

/**
 * 留白：夸大以后的高度留多少（1 是照常，BLANK_KEEP 是留白的地方）。soft 是 blankSoft 在这一格的数，从 0.5 到 0.97 匀着过渡：
 * 边线里面整个压平，边线往外约 75 公里宽的一条慢慢收平（在那一条里，路到了的地方的山也跟着矮下来）。
 */
export const keepAt = (soft: number): number => BLANK_KEEP + (1 - BLANK_KEEP) * smoothstep(0.5, 0.97, soft);

/** 每个格点上夸大以后的高度留多少：blankSoft 过一遍 keepAt。 */
export function blankKeep(scene: RouteScene, heights: Pick<RouteHeights, 'grid' | 'lngLat' | 'h'>, edge: BlankEdge): Float32Array {
  return blankSoft(scene, heights, edge).map(keepAt);
}

/**
 * 全程沙盘的地面：七步做完（见这个文件开头）。dem 用 readRouteDem 读，coords 用 coordsOf(scene)；
 * edge 是这座沙盘的样式里留白的边怎么收（RouteStyle.blank）。
 */
export function buildRouteGround(scene: RouteScene, dem: Dem, coords: FrameCoords, edge: BlankEdge): RouteGround {
  const heights = routeHeights(scene, dem, coords);
  const { nx, nz, cell, x0, z0 } = heights.grid;
  const { scale, datumM, relief } = scene.frame;
  // 5 平原抹成缓坡
  const h = smoothPlain(heights.h, heights.land, scene.terrain.recipe, nx, nz, cell * scale);
  // 6 过曲线，除以比例；7 留白的地方压平，再倒算回海拔
  const blank = blankSoft(scene, heights, edge);
  const y = new Float32Array(nx * nz);
  for (let k = 0; k < y.length; k++) {
    const keep = keepAt(blank[k]);
    const full = coords.y(h[k]);
    y[k] = full * keep;
    if (keep < 1) h[k] = datumM + curveInverse(relief, y[k] * scale);
  }
  return { nx, nz, cell, x0, z0, h, y, land: heights.land, blank };
}

/** 类别和依据那一组字段里纯是给人读的字：地面不读它们，不算进记号（和站点沙盘的 ./key.ts 一样）。 */
const WORDS_ONLY = new Set(['basis', 'sourceIds', 'unsure', 'note']);

/**
 * 全程沙盘里管地面的那一部分的记号：样式、范围、地形和修整、水（其中纯是给人读的字不算）。
 * 先画好的地面（npm run bake）记着它是照哪个记号画的；沙盘打开时再算一遍，对不上就在控制台里说一句。
 * 小节、题签、地名点、路都不算：改一个镜头、挪一条路，地面不用重画。
 * “今天的海岸、湖、河”那个文件也是画地面用的，页面不下载它，所以不在记号里：它变了，由测试重画一遍来发现。
 */
export function routeGroundKey(scene: RouteScene): string {
  const parts = [scene.style, scene.frame, scene.terrain, scene.water];
  return contentKey(JSON.stringify(parts, (name, value: unknown) => (WORDS_ONLY.has(name) ? undefined : value)));
}

/** 先画好的地面，地面的一格画几个点。 */
export const ROUTE_POINTS_PER_CELL = 3;

/** 先画好的地面多大：地面的一格画三个点（宽 = (列数 − 1) × 3 + 1）。 */
export function routePictureSize(ground: Pick<RouteGround, 'nx' | 'nz'>): { w: number; h: number } {
  return { w: (ground.nx - 1) * ROUTE_POINTS_PER_CELL + 1, h: (ground.nz - 1) * ROUTE_POINTS_PER_CELL + 1 };
}

/**
 * 在任意一点取全程沙盘地面的数，样子和站点沙盘的一样（摆镜头、摆题签的程序两层共用）。
 * height、waterH 是海拔（格子之间按远近匀开）；全程沙盘没有河床、没有垫高、没有“山”的分量：edge 是一个很大的数，别的是 0。
 */
export function routeSamplers(ground: RouteGround): GroundSamplers {
  const height = bilinear(ground.h, ground);
  return { height, waterH: height, edge: () => 1e9, lift: () => 0, hill: () => 0, hillSoft: () => 0 };
}

/**
 * 法线图（物体空间，y 向上）：nx × nz 个点，每点四个字节，排法和站点沙盘的一样（./normals.ts）。
 * 坡度直接从沙盘里的高度（y）算，不再乘倍数：曲线已经在 y 里面了。
 */
export function routeNormals(ground: RouteGround): Uint8Array {
  const { nx, nz, y, cell } = ground;
  const out = new Uint8Array(nx * nz * 4);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const l = y[j * nx + Math.max(0, i - 1)];
      const r = y[j * nx + Math.min(nx - 1, i + 1)];
      const u = y[Math.max(0, j - 1) * nx + i];
      const d = y[Math.min(nz - 1, j + 1) * nx + i];
      let vx = -(r - l) / (2 * cell);
      let vz = -(d - u) / (2 * cell);
      const len = Math.hypot(vx, 1, vz);
      vx /= len;
      vz /= len;
      const k = (j * nx + i) * 4;
      out[k] = Math.round((vx * 0.5 + 0.5) * 255);
      out[k + 1] = Math.round((1 / len) * 0.5 * 255 + 127.5);
      out[k + 2] = Math.round((vz * 0.5 + 0.5) * 255);
      out[k + 3] = 255;
    }
  }
  return out;
}

// 给全程沙盘的地面上色的工具。从定稿的样张搬来（spikes/art-direction/route/scene/fields.js 的 prepare 和 build 里上色的那一半），
// 加了类型；数从场景、地面和样式里来，不再从样张的数据文件来。它只是工具：src/ 里没有哪个文件引它，
// 所以不进任何一块发出去的程序——全程沙盘的地面不在页面上现画，页面只取这里画好的两张图。
// 谁用它：npm run bake（tests/tools/bake-ground.test.ts）画出来存进 content/；tests/stage/baked-fresh.test.ts 重画一遍，
// 看存着的是不是还和现在的场景、程序、今天的海岸湖河对得上。只算数，不碰磁盘，不碰浏览器。
//
// 画出来两份，一样大（地面的一格画三个点，全程沙盘上一个点合地上一公里多）：
//   colour  颜色，一个点三个字节（红、绿、蓝）；
//   marks   一个点一个字节：这里画不画水纹、画多重（海和湖里离岸够远的地方）。水纹自己是沙盘打开以后由着色器画的。
// 第 k 行第 i 个点在沙盘里的位置：x = x0 + i × 格宽 ÷ 3，z = z0 + k × 格宽 ÷ 3（第 0 行最北）。
//
// 上色的先后（照样张，数也是样张的）：
//   1 平地：茶色的底，西北的黄土地暖一点，水边带一点草色，上面很淡的一块一块；
//   2 山：比着“比四周低处高出多少，再加两成海拔”分带——山脚赭石，山腰石绿，每条山脉自己排前头的山顶石青；
//     顺着坡往下的细纹（皴），沟里深一点，山脊上提亮一点；
//   3 留白的地方（recipe.blank）：空绢的颜色，海岸只留一道淡线，西边的边上先过一层淡花青的白；
//   4 只染水色的水（washes）：一片化开的淡水色，没有岸线；
//   5 河：两岸先留一道白；照今天画的河用深一点的花青，示意的河和运河淡一点；粗细照样式里按 weight 写的公里数；
//   6 沙盘四边留出空绢；一点手工上色的不匀；
//   7 海和湖：淡花青，离岸远了深一点，岸边留一道白（海岸几公里宽，湖岸不到一公里）。
// 和样张不一样的四处：
//   海和湖是这里画进去的（样张是着色器现画的）：混色照样在线性的光里算，画出来和样张是一个颜色；
//   山的颜色照整理过的地面（平原抹成缓坡以后的）上，不照今天的地形；
//   每个点自己跳的那一点颗粒不要了（压成 JPEG 就糊了，还白占字节）；只染水色的水上面那几道水纹也不画；
//   留白的边是场景里写的圈，抹开了的，不再用噪声打散。

import type { RouteScene } from '../../../src/domain/scene';
import type { FrameCoords } from '../../../src/domain/sceneGeo';
import type { LngLat } from '../../../src/domain/types';
import { clamp, fbm, hash2, hex, mix3, smoothstep } from '../../../src/stage/ground/num';
import { routePictureSize } from '../../../src/stage/ground/route';
import type { RouteGround } from '../../../src/stage/ground/route';
import type { Vec2, Vec3 } from '../../../src/stage/ground/types';
import type { RouteRiverWidth, StageStyle } from '../../../src/stage/three/internal';
import { pickedLakes, pickedLines } from '../../content/routeRules';
import type { TodayFeature } from '../../content/routeRules';

/** 样张的两个尺寸：颜色图一个点合多少公里，高程一格多少公里。样张里按“几个点”“几格”写的数，在这里先换成公里再用。 */
const TRIAL_KM_PER_POINT = 2001 / 1812;
const TRIAL_KM_PER_CELL = 3;

/** 留白的圈，颜色从边上往里慢慢淡下去：把圈抹开这么多米。地势在圈的边线外面就收平了，颜色到圈里面才淡完。 */
const BLANK_COLOUR_BLUR_M = 45_000;

/** 海和湖的边在图上化开多宽（“是不是水”从 0.5 − 这个数到 0.5 + 这个数匀着过渡）：约一个点。 */
const WATER_EDGE = 0.12;
/** 水纹的标记里，岸边的白把水纹压掉多少（样张：水纹盖上去 0.66 − 0.25 × 岸边的白）。 */
const FRINGE_ON_RIPPLE = 0.25 / 0.66;

export interface RoutePainted {
  w: number;
  h: number;
  /** 颜色：w × h 个点，一个点三个字节。 */
  colour: Uint8Array;
  /** 水纹的标记：w × h 个点，一个点一个字节。 */
  marks: Uint8Array;
}

export interface RoutePaintInput {
  scene: RouteScene;
  coords: FrameCoords;
  /** 照场景算出来的地面（src/stage/ground/route.ts 的 buildRouteGround）。 */
  ground: RouteGround;
  /** 读好的“今天的海岸、湖、河”（tests/content/routeRules.ts 的 readToday）。 */
  features: TodayFeature[];
  style: StageStyle;
}

// ---------------------------------------------------------------- 栅格小工具（样张的）

/** 一圈或几圈线盖住每个点的多少（0 到 1），奇偶填充，每行取两条扫描线。坐标是“点”：第 i 个点占 [i, i + 1)。 */
export function coverage(W: number, H: number, rings: Vec2[][], SUB = 2): Float32Array {
  const cov = new Float32Array(W * H);
  const lists: number[][] = Array.from({ length: H * SUB }, () => []);
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      let x0 = ring[i][0];
      let y0 = ring[i][1];
      let x1 = ring[(i + 1) % n][0];
      let y1 = ring[(i + 1) % n][1];
      if (y0 === y1) continue;
      if (y0 > y1) [x0, y0, x1, y1] = [x1, y1, x0, y0];
      const s0 = Math.max(0, Math.ceil(y0 * SUB - 0.5));
      const s1 = Math.min(H * SUB - 1, Math.ceil(y1 * SUB - 0.5) - 1);
      for (let s = s0; s <= s1; s++) {
        const y = (s + 0.5) / SUB;
        lists[s].push(x0 + ((x1 - x0) * (y - y0)) / (y1 - y0));
      }
    }
  }
  const inc = 1 / SUB;
  for (let s = 0; s < H * SUB; s++) {
    const xs = lists[s];
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const row = Math.floor(s / SUB) * W;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, xs[k]);
      const xb = Math.min(W, xs[k + 1]);
      if (xb <= xa) continue;
      const ia = Math.floor(xa);
      const ib = Math.floor(xb);
      if (ia === ib) {
        cov[row + ia] += (xb - xa) * inc;
        continue;
      }
      cov[row + ia] += (ia + 1 - xa) * inc;
      for (let x = ia + 1; x < ib; x++) cov[row + x] += inc;
      if (ib < W) cov[row + ib] += (xb - ib) * inc;
    }
  }
  for (let i = 0; i < cov.length; i++) cov[i] = clamp(cov[i], 0, 1);
  return cov;
}

/** 几圈各算各的，一个点取盖得最多的那一圈（圈和圈叠着的地方不会被奇偶填充挖成洞）。 */
function coverageOfEach(W: number, H: number, rings: Vec2[][]): Float32Array {
  const out = new Float32Array(W * H);
  for (const ring of rings) {
    const one = coverage(W, H, [ring]);
    for (let i = 0; i < out.length; i++) if (one[i] > out[i]) out[i] = one[i];
  }
  return out;
}

/** 把一条折线按半宽（点）盖到栅格上，取最大值。坐标是“点”，和 coverage 一样。 */
function stampLine(buf: Float32Array, W: number, H: number, pts: Vec2[], halfW: number): void {
  for (let s = 0; s < pts.length - 1; s++) {
    const [ax, ay] = pts[s];
    const [bx, by] = pts[s + 1];
    const r = halfW + 1;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + r));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(ay, by) + r));
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy || 1e-9;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - ax;
        const py = y + 0.5 - ay;
        const t = clamp((px * dx + py * dy) / l2, 0, 1);
        const d = Math.hypot(px - dx * t, py - dy * t);
        const c = clamp(halfW + 0.5 - d, 0, 1);
        const i = y * W + x;
        if (c > buf[i]) buf[i] = c;
      }
    }
  }
}

function boxBlur(src: Float32Array, W: number, H: number, r: number): Float32Array {
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  const n = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    const o = y * W;
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[o + clamp(k, 0, W - 1)];
    for (let x = 0; x < W; x++) {
      tmp[o + x] = s / n;
      s += src[o + Math.min(W - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[clamp(k, 0, H - 1) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = s / n;
      s += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
    }
  }
  return out;
}

/** 近似的高斯模糊：三遍方框；sigma 不到 0.9 个点时用三点的小核。 */
export function gauss(src: Float32Array, W: number, H: number, sigma: number): Float32Array {
  if (sigma < 0.9) {
    const a = clamp((sigma * sigma) / 2, 0, 0.33);
    const tmp = new Float32Array(W * H);
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const o = y * W;
      for (let x = 0; x < W; x++) tmp[o + x] = src[o + x] * (1 - 2 * a) + a * (src[o + Math.max(0, x - 1)] + src[o + Math.min(W - 1, x + 1)]);
    }
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) out[y * W + x] = tmp[y * W + x] * (1 - 2 * a) + a * (tmp[Math.max(0, y - 1) * W + x] + tmp[Math.min(H - 1, y + 1) * W + x]);
    }
    return out;
  }
  const r = Math.max(1, Math.round(Math.sqrt(sigma * sigma + 0.25) - 0.5));
  return boxBlur(boxBlur(boxBlur(src, W, H, r), W, H, r), W, H, r);
}

/** 方框里的最小值（sign 是 1）或最大值（sign 是 −1）。 */
function minFilter(src: Float32Array, W: number, H: number, r: number, sign = 1): Float32Array {
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let m = Infinity;
      for (let k = Math.max(0, x - r); k <= Math.min(W - 1, x + r); k++) m = Math.min(m, sign * src[y * W + k]);
      tmp[y * W + x] = m;
    }
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let m = Infinity;
      for (let k = Math.max(0, y - r); k <= Math.min(H - 1, y + r); k++) m = Math.min(m, tmp[k * W + x]);
      out[y * W + x] = sign * m;
    }
  }
  return out;
}

/** 把一条折线加密成顺滑的线（Catmull-Rom，过每一个写出来的点）。step 是大约的点距，和 pts 一个单位。 */
export function densify(pts: Vec2[], step: number): Vec2[] {
  const out: Vec2[] = [];
  const P = (i: number): Vec2 => pts[clamp(i, 0, pts.length - 1)];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1);
    const p1 = P(i);
    const p2 = P(i + 1);
    const p3 = P(i + 2);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(2, Math.round(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number): number => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
  return out;
}

/** 一点在不在一圈线里面（照经纬度直接算）。 */
function insideRing(lng: number, lat: number, ring: readonly LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a[1] > lat !== b[1] > lat && lng < ((b[0] - a[0]) * (lat - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------- 平地上的大块（样张的）

type Tint = 'fieldA' | 'fieldB' | 'fieldC' | null;
const FIELD_TINTS: Tint[] = [null, 'fieldA', 'fieldB', 'fieldC', 'fieldB', 'fieldA', null];

/** 每块二十七八公里；块心是乱放的，边界按离块心的直线距离分，再加一点弯。x、z 是公里。 */
function fieldCell(x: number, z: number): { tint: Tint; border: number } {
  const S = 27;
  const cs = Math.cos(0.3);
  const sn = Math.sin(0.3);
  const wx = x + 16 * (fbm(x / 48, z / 48, 2, 131) - 0.5);
  const wz = z + 16 * (fbm(x / 48, z / 48, 2, 137) - 0.5);
  const gx = (cs * wx - sn * wz) / S;
  const gz = (sn * wx + cs * wz) / (S * 0.86);
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  let d1 = 9;
  let d2 = 9;
  let id = 0;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const cx = ix + di + 0.08 + 0.84 * hash2(ix + di, iz + dj, 201);
      const cz = iz + dj + 0.08 + 0.84 * hash2(ix + di, iz + dj, 207);
      const d = Math.hypot(gx - cx, gz - cz);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hash2(ix + di, iz + dj, 77);
      } else if (d < d2) d2 = d;
    }
  }
  return { tint: FIELD_TINTS[Math.floor(id * FIELD_TINTS.length)], border: d2 - d1 };
}

// ---------------------------------------------------------------- 河的线

export interface RiverPath {
  id: string;
  /** 用淡的那种颜色画：示意的河，和运河。 */
  pale: boolean;
  /** 画多宽，地上的公里。 */
  widthKm: number;
  /** 画出来的线：沙盘里的米（x 向东，z 向南）。自己写的线加密成顺滑的；照今天画的就是文件里的点。 */
  lines: Vec2[][];
}

/**
 * 场景里每一条河画成什么线、多宽、用哪种颜色。自己写的线（line）过每一个写出来的点，中间加密成顺滑的（约 6 公里一个点）；
 * 照今天画的（today）是文件里取出来的线。下一步给水路让出河面时也要用这同一份线。
 */
export function riverPaths(scene: RouteScene, features: TodayFeature[], coords: FrameCoords, style: StageStyle): RiverPath[] {
  const route = style.route;
  if (!route) throw new Error(`样式“${scene.style}”没有全程沙盘的那一份`);
  const stepM = 6000 / scene.frame.scale;
  return scene.water.rivers.map((river) => {
    const width: RouteRiverWidth = river.kind === 'canal' ? 'canal' : (river.weight ?? 'minor');
    const local = (line: LngLat[]): Vec2[] => line.map((p) => coords.toLocal(p));
    const lines = river.line ? [densify(local(river.line), stepM)] : pickedLines(features, river.today ?? []).map(local);
    return { id: river.id, pale: river.kind === 'canal' || river.class !== 'today', widthKm: route.riverKm[width], lines };
  });
}

// ---------------------------------------------------------------- 线性的光和屏幕上的颜色之间来回

const TO_LINEAR = Float64Array.from({ length: 256 }, (_v, i) => {
  const c = i / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});
/** 屏幕上的颜色（0 到 255，可以带小数）换成线性的光（0 到 1）。 */
const linear = (v: number): number => {
  const x = clamp(v, 0, 255);
  const i = Math.floor(x);
  return i >= 255 ? 1 : TO_LINEAR[i] + (TO_LINEAR[i + 1] - TO_LINEAR[i]) * (x - i);
};
/** 线性的光换回屏幕上的颜色（0 到 255）。 */
const screen = (l: number): number => 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055);
const linear3 = (c: Vec3): Vec3 => [linear(c[0]), linear(c[1]), linear(c[2])];

// ---------------------------------------------------------------- 上色

/** 给全程沙盘的地面上色。同样的输入画出同样的字节。 */
export function paintRoute(input: RoutePaintInput): RoutePainted {
  const { scene, coords, ground, features, style } = input;
  const route = style.route;
  if (!route) throw new Error(`样式“${scene.style}”没有全程沙盘的那一份`);
  const { nx, nz, cell } = ground;
  const { w: W, h: H } = routePictureSize(ground);
  const POINTS = (W - 1) / (nx - 1);
  const N = nx * nz;
  const { scale } = scene.frame;
  const cellKm = (cell * scale) / 1000;
  const kmPerPoint = cellKm / POINTS;
  /** 样张里按“几个点”写的宽度，在这张图上是几个点；按“几格”写的，在这张网格上是几格。 */
  const points = (trialPoints: number): number => (trialPoints * TRIAL_KM_PER_POINT) / kmPerPoint;
  const cells = (trialCells: number): number => (trialCells * TRIAL_KM_PER_CELL) / cellKm;
  /** 经纬度 → 图上的“点”坐标（第 i 个点占 [i, i + 1)，它的正中在沙盘里的 x0 + i × 格宽 ÷ 3）。 */
  const toPoint = (p: LngLat): Vec2 => {
    const [x, z] = coords.toLocal(p);
    return [((x - coords.x0) / cell) * POINTS + 0.5, ((z - coords.z0) / cell) * POINTS + 0.5];
  };
  const localToPoint = ([x, z]: Vec2): Vec2 => [((x - coords.x0) / cell) * POINTS + 0.5, ((z - coords.z0) / cell) * POINTS + 0.5];

  // ---------- 备料：岸线、湖、只染水色的水、河（图那么大的栅格）
  // 岸线：今天的陆地，减掉抹成海的几圈
  const landRings = features.filter((f) => f.kind === 'land').flatMap((f) => f.polygons.flat().map((ring) => ring.map(toPoint)));
  const land = coverage(W, H, landRings);
  const erase = coverageOfEach(W, H, scene.terrain.edits.filter((edit) => edit.op === 'sea' && edit.area.length >= 3).map((edit) => edit.area.map(toPoint)));
  for (let i = 0; i < land.length; i++) land[i] *= 1 - erase[i];
  // 湖：场景挑中的今天的湖，裁掉当时还是陆地的那一角
  const lake = new Float32Array(W * H);
  for (const item of scene.water.lakes) {
    const cover = coverage(W, H, pickedLakes(features, item.today).flatMap((polygon) => polygon.map((ring) => ring.map(toPoint))));
    const cut = item.except && item.except.area.length >= 3 ? coverage(W, H, [item.except.area.map(toPoint)]) : null;
    for (let i = 0; i < lake.length; i++) lake[i] = Math.max(lake[i], cover[i] * (cut ? 1 - cut[i] : 1));
  }
  // 只染水色的水：轮廓没有依据，不画岸线，边上化开六公里上下
  const washCover = coverageOfEach(W, H, scene.water.washes.flatMap((wash) => wash.areas.filter((ring) => ring.length >= 3).map((ring) => ring.map(toPoint))));
  const wash = gauss(washCover, W, H, points(5.5));
  // 湖里连同岸外几公里，一律当“离岸够远”，上和海一样的花青；岸边那道细白另按软边画
  const lakeIn = gauss(lake, W, H, points(3));
  const wat = new Float32Array(W * H);
  for (let i = 0; i < wat.length; i++) wat[i] = Math.max(1 - land[i], lake[i] * land[i]);
  const sdf = gauss(wat, W, H, points(1.0));
  const wide = gauss(wat, W, H, points(9));
  // 河：照今天画的一层，淡的一层（示意的河、运河）
  const riv = new Float32Array(W * H);
  const rivPale = new Float32Array(W * H);
  for (const river of riverPaths(scene, features, coords, style)) {
    for (const line of river.lines) stampLine(river.pale ? rivPale : riv, W, H, line.map(localToPoint), river.widthKm / kmPerPoint / 2);
  }
  // 离水近不近（水边的草色、岸边的留白用）
  const anyWater = new Float32Array(W * H);
  for (let i = 0; i < anyWater.length; i++) anyWater[i] = Math.max(wat[i], riv[i], rivPale[i], wash[i] * 0.7);
  const near = gauss(anyWater, W, H, points(11));
  const bank = gauss(anyWater, W, H, points(1.6));

  // ---------- 备料：地面网格上的东西
  const hp = ground.h;
  const story = new Float32Array(N); // 1 是路到了的地方，0 是留白
  const loess = new Float32Array(N); // 西北的黄土高原：偏黄，少上石绿
  const edge = new Float32Array(N); // 离沙盘的边多少公里
  const mistW = new Float32Array(N); // 是不是在西边（留白的边在西边带一点淡花青，像雾）
  const blank = scene.terrain.recipe.blank.filter((ring) => ring.length >= 3);
  const outside = new Float32Array(N);
  for (let j = 0; j < nz; j++) {
    const z = ground.z0 + j * cell;
    for (let i = 0; i < nx; i++) {
      const x = ground.x0 + i * cell;
      const k = j * nx + i;
      const [lng, lat] = coords.toLngLat(x, z);
      outside[k] = blank.some((ring) => insideRing(lng, lat, ring)) ? 0 : 1;
      mistW[k] = 1 - smoothstep(104.6, 106.2, lng);
      loess[k] = smoothstep(34.3, 35.3, lat) * (1 - smoothstep(111.6, 113.0, lng)) * smoothstep(350, 900, hp[k]);
      edge[k] = (Math.min(x - coords.x0, coords.x1 - x, z - coords.z0, coords.z1 - z) * scale) / 1000;
    }
  }
  // 留白的边：颜色比地势晚一点才淡下去（地势先收平），边上就没有发白的浮雕。
  // 地势从圈的边线外面约 75 公里起收，到边线收完（src/stage/ground/route.ts 的 blankKeep）；颜色抹开 45 公里，
  // 从边线外面一点起慢慢淡，到圈里面约 60 公里淡完（样张的留白也是近一百公里宽的一条慢慢淡下去）
  const soft = blank.length > 0 ? gauss(outside, nx, nz, BLANK_COLOUR_BLUR_M / (cell * scale)) : outside;
  for (let k = 0; k < N; k++) story[k] = smoothstep(-0.08, 0.81, soft[k]);
  // 大尺度的随机（上色用）
  const n1 = new Float32Array(N);
  const n2 = new Float32Array(N);
  const n3 = new Float32Array(N);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = i * cellKm;
      const y = j * cellKm;
      const k = j * nx + i;
      n1[k] = fbm(x / 290, y / 290, 4, 3);
      n2[k] = fbm(x / 62, y / 62, 4, 9);
      n3[k] = fbm(x / 160, y / 160, 3, 21);
    }
  }
  // 山有多“山”：比四周（三四十公里以内）的低处高出多少。范围取大，颜色才跟着整条山脉走
  const reach = Math.max(1, Math.round(cells(12)));
  const base = gauss(minFilter(hp, nx, nz, reach), nx, nz, cells(10));
  const top = gauss(minFilter(hp, nx, nz, reach, -1), nx, nz, cells(10));
  const lr = new Float32Array(N);
  const rk = new Float32Array(N); // 在自己这条山脉里排第几：0 是山脚，1 是这一带最高的山顶
  for (let k = 0; k < N; k++) {
    lr[k] = Math.max(0, hp[k] - base[k]);
    rk[k] = clamp((hp[k] - base[k]) / Math.max(top[k] - base[k], 160), 0, 1.3);
  }
  const smooth = gauss(hp, nx, nz, cells(2.6));
  const cv = new Float32Array(N); // 比两边凸出来多少（山脊是正的，沟是负的）
  for (let k = 0; k < N; k++) cv[k] = hp[k] - smooth[k];
  // 坡向和坡度（皴用）：按统一 10 倍算，和山高怎么夸大无关
  const pgx = new Float32Array(N);
  const pgz = new Float32Array(N);
  const run = 2 * cellKm * 1000;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      pgx[k] = ((hp[j * nx + Math.min(nx - 1, i + 1)] - hp[j * nx + Math.max(0, i - 1)]) * 10) / run;
      pgz[k] = ((hp[Math.min(nz - 1, j + 1) * nx + i] - hp[Math.max(0, j - 1) * nx + i]) * 10) / run;
    }
  }
  const sampleGrid = (f: Float32Array, fx: number, fy: number): number => {
    const x = clamp(fx, 0, nx - 1.001);
    const y = clamp(fy, 0, nz - 1.001);
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const ax = x - ix;
    const ay = y - iy;
    const o = iy * nx + ix;
    return f[o] * (1 - ax) * (1 - ay) + f[o + 1] * ax * (1 - ay) + f[o + nx] * (1 - ax) * ay + f[o + nx + 1] * ax * ay;
  };

  // ---------- 上色
  const G = style.ground.colours;
  const C = {
    tea: hex(G.tea),
    teaWarm: hex(G.teaWarm),
    meadow: hex(G.meadow),
    fieldA: hex(G.fieldA),
    fieldB: hex(G.fieldB),
    fieldC: hex(G.fieldC),
    ochre: hex(G.ochre),
    ochreDeep: hex(G.ochreDeep),
    shilu: hex(G.shilu),
    shiluDeep: hex(G.shiluDeep),
    shiqing: hex(G.shiqing),
    shiqingDeep: hex(G.shiqingDeep),
    blank: hex(G.blank),
    loess: hex(route.colours.loess),
    sand: hex(route.colours.sand),
    shoreInk: hex(route.colours.shoreInk),
    sea: hex(route.colours.sea),
    seaDeep: hex(route.colours.seaDeep),
    river: hex(route.colours.river),
    riverSong: hex(route.colours.riverSong),
    ripple: hex(style.palette.ripple),
    mist: hex(style.palette.mist),
  };
  const P = route.bands;
  const MIST = mix3(C.mist, C.sea, 0.38); // 淡花青的白
  const WASH = mix3(C.sea, C.seaDeep, 0.4);
  const STROKE_PALE: Vec3 = [250, 246, 228];
  const CREST_PALE: Vec3 = [255, 250, 232];
  const SEA = linear3(C.sea);
  const SEA_DEEP = linear3(C.seaDeep);
  const FOAM = linear3(C.ripple);

  const colour = new Uint8Array(W * H * 3);
  const marks = new Uint8Array(W * H);
  for (let j = 0; j < H; j++) {
    const fy = j / POINTS;
    const yk = j * kmPerPoint;
    for (let i = 0; i < W; i++) {
      const fx = i / POINTS;
      const xk = i * kmPerPoint;
      const t = j * W + i;
      const h = sampleGrid(hp, fx, fy);
      const rel = sampleGrid(lr, fx, fy);
      const curv = sampleGrid(cv, fx, fy);
      const st = sampleGrid(story, fx, fy);
      const lo = sampleGrid(loess, fx, fy);
      const ed = sampleGrid(edge, fx, fy);
      const a1 = sampleGrid(n1, fx, fy);
      const a2 = sampleGrid(n2, fx, fy);
      const a3 = sampleGrid(n3, fx, fy);

      // 1 平地：茶色底，北边的黄土地再暖一点，水边带一点草色
      let col = mix3(C.tea, C.teaWarm, smoothstep(0.3, 0.75, a1));
      const north = smoothstep(0.42, 0.2, j / H) * smoothstep(40, 400, h + 60 * (a3 - 0.5));
      col = mix3(col, C.loess, north * 0.7);
      const wet = smoothstep(0.035, 0.3, near[t]) * (1 - smoothstep(60, 220, h)) * smoothstep(0.25, 0.62, a3 + 0.15);
      col = mix3(col, C.meadow, wet * 0.8);
      // 平地上很淡的一块一块（只是装饰，不是真的田界）
      const mk = wash[t];
      const plainK = (1 - smoothstep(35, 110, rel * 0.6 + h * 0.12)) * st * (1 - smoothstep(0.3, 0.55, sdf[t])) * (1 - smoothstep(0.1, 0.5, mk));
      if (plainK > 0.02) {
        const fc = fieldCell(xk, yk);
        if (fc.tint) col = mix3(col, C[fc.tint], plainK * smoothstep(0.02, 0.2, fc.border) * smoothstep(0.3, 0.5, a3 + 0.1) * P.patch);
      }

      // 2 山：按“比四周高出多少”和海拔一起定色。山脚赭石，山腰石绿，山顶石青
      const m = (rel * P.relK + h * P.hK) * (1 - 0.5 * lo) + (a2 - 0.5) * P.noise + curv * 0.5;
      const tFoot = smoothstep(P.foot[0], P.foot[1], m);
      col = mix3(col, mix3(C.ochre, C.loess, lo * 0.55), tFoot * P.footK);
      const tGreen = smoothstep(P.green[0], P.green[1], m);
      col = mix3(col, mix3(C.shilu, C.shiluDeep, smoothstep(0.35, 0.8, a2)), tGreen);
      // 石青只上在山脊上：除了够高，还要比两边凸出来
      const rank = sampleGrid(rk, fx, fy) + curv * P.rankCurv + (a2 - 0.5) * 0.12;
      const tBlue = smoothstep(P.rank[0], P.rank[1], rank) * smoothstep(P.blue[0], P.blue[1], m);
      col = mix3(col, C.shiqing, tBlue * P.blueK);
      col = mix3(col, C.shiqingDeep, smoothstep(P.rank[1], P.rank[1] + 0.3, rank) * smoothstep(P.deep[0], P.deep[1], m) * 0.8);
      // 皴：顺着坡往下的细纹，只上在真有坡的地方
      let steep = 0;
      if (tFoot > 0.02) {
        const dx = sampleGrid(pgx, fx, fy);
        const dz = sampleGrid(pgz, fx, fy);
        const gl = Math.hypot(dx, dz);
        steep = smoothstep(P.steep[0], P.steep[1], gl);
        if (steep > 0.01) {
          const ux = dx / gl;
          const uz = dz / gl;
          const s = fbm((-xk * uz + yk * ux) / 2.6, (xk * ux + yk * uz) / 26, 3, 61);
          const sk = steep * tFoot;
          col = mix3(col, C.ochreDeep, smoothstep(0.55, 0.78, s) * sk * (0.5 - 0.22 * tBlue));
          col = mix3(col, STROKE_PALE, smoothstep(0.45, 0.22, s) * sk * 0.22);
        }
      }
      const gully = smoothstep(18, 150, -curv) * tFoot * steep;
      col = mix3(col, C.ochreDeep, gully * (0.55 - 0.28 * tBlue));
      const crest = smoothstep(25, 190, curv) * tGreen;
      col = mix3(col, CREST_PALE, crest * 0.2);

      // 3 路没到的地方留白：空绢的颜色，海岸只留一道细线。西边的边上先过一层淡花青的白，再到空绢
      if (st < 0.999) {
        const mw = sampleGrid(mistW, fx, fy);
        const to = mw > 0 ? mix3(C.blank, MIST, mw * smoothstep(0.04, 0.4, st)) : C.blank;
        col = mix3(col, to, (1 - smoothstep(0.1, 0.78, st)) * 0.97);
      }
      const sd = sdf[t];
      if (st < 0.6 && sd > 0.06) col = mix3(col, C.shoreInk, smoothstep(0.1, 0.42, sd) * (1 - smoothstep(0.1, 0.6, st)) * 0.5);
      // 4 只染水色的水：一片化开的淡水色，没有岸线
      if (mk > 0.02) col = mix3(col, WASH, smoothstep(0.08, 0.8, mk + (a2 - 0.5) * 0.25) * 0.8);
      // 5 河：先在两岸留一道白，再上花青。示意的河淡一点、素一点
      col = mix3(col, C.sand, clamp(bank[t] * 2.2, 0, 1) * 0.55 * st);
      const rv = riv[t] * (0.08 + 0.92 * st);
      if (rv > 0) col = mix3(col, C.river, rv * 0.95);
      const rs = rivPale[t];
      if (rs > 0) col = mix3(col, C.riverSong, rs * 0.92 * (1 - rv));
      // 6 四边留出空绢；一点手工上色的不匀
      const fade = 1 - smoothstep(10, 70 + a3 * 190, ed + (a1 - 0.5) * 50);
      col = mix3(col, C.blank, fade * 0.86);
      const grain = (fbm(xk / 7.5, yk / 7.5, 2, 31) - 0.5) * 9;
      let r = col[0] + grain;
      let g = col[1] + grain;
      let b = col[2] + grain * 0.9;

      // 7 海和湖：淡花青，离岸远了深一点，岸边留白。混色在线性的光里算（和着色器现画的是一个颜色）
      const water = smoothstep(0.5 - WATER_EDGE, 0.5 + WATER_EDGE, sd);
      if (water > 0) {
        const li = lakeIn[t];
        const inLake = li > 0.015 ? 0.9 + 0.06 * smoothstep(0.45, 0.98, li) : 0;
        const off = clamp(Math.max(wide[t], inLake), 0, 1);
        const deep = smoothstep(0.84, 1.0, off);
        // 湖里没有海岸那道几公里宽的白，只按软边留一道不到一公里的细白
        const fringe = Math.max(1 - smoothstep(0.5, 0.7, off), (1 - smoothstep(0.5, 0.72, sd)) * 0.8);
        const wc: Vec3 = [0, 0, 0];
        for (let c = 0; c < 3; c++) {
          const tone = SEA[c] + (SEA_DEEP[c] - SEA[c]) * deep;
          wc[c] = tone + (FOAM[c] - tone) * fringe * 0.6;
        }
        const lr0 = linear(r);
        const lg0 = linear(g);
        const lb0 = linear(b);
        r = screen(lr0 + (wc[0] - lr0) * water);
        g = screen(lg0 + (wc[1] - lg0) * water);
        b = screen(lb0 + (wc[2] - lb0) * water);
        marks[t] = Math.round(clamp(water * smoothstep(0.52, 0.8, off) * (1 - FRINGE_ON_RIPPLE * fringe), 0, 1) * 255);
      }
      const o = t * 3;
      colour[o] = clamp(Math.round(r), 0, 255);
      colour[o + 1] = clamp(Math.round(g), 0, 255);
      colour[o + 2] = clamp(Math.round(b), 0, 255);
    }
  }
  return { w: W, h: H, colour, marks };
}

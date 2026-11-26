// 给全程沙盘的地面上色的工具。从定稿的样张搬来（spikes/art-direction/route/scene/fields.js 的 prepare 和 build 里上色的那一半），
// 加了类型；数从场景、地面和样式里来，不再从样张的数据文件来。它是宋代青绿设色（'song-qinglv'）这一种样式的画法：
// 一种样式一个画法，哪种样式用哪一个，登记在 ./painters.ts。它只是工具：src/ 里没有哪个文件引它，
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
//     颜色跟着地势淡（地面的 keep），比地势先淡完，边是打散的：山谷先淡，山脊后淡；河跟着陆地一起淡；
//   4 只染水色的水（washes）：一片化开的淡水色，没有岸线；
//   5 河：两岸先留一道白；照今天画的河用深一点的花青，示意的河和运河淡一点；粗细照样式里按 weight 写的公里数；
//     空着的一头（不接着别的河、不在湖里）慢慢收细；
//   6 沙盘四边留出空绢；一点手工上色的不匀；
//   7 海和湖：淡花青，离岸远了深一点，岸边留一道白（海岸几公里宽，湖岸不到一公里）；
//     河口上海的颜色，河的线穿过岸边那道白进海，再淡掉。
// 和样张不一样的五处：
//   海和湖是这里画进去的（样张是着色器现画的）：混色照样在线性的光里算，画出来和样张是一个颜色；
//   山的颜色照整理过的地面（平原抹成缓坡以后的）上，不照今天的地形；留白那一步压过的地方照没压以前的上；
//   每个点自己跳的那一点颗粒不要了（压成 JPEG 就糊了，还白占字节）；只染水色的水上面那几道水纹也不画；
//   留白的边是场景里写的圈，西边的两条边由地面那边用噪声打散（src/stage/ground/route.ts 的 blankKeep，数在样式的 route.blank 里），这里的颜色跟着它；
//   水纹的标记离海岸远一些才有（样张贴着岸边那道白就画）。

import type { RouteScene } from '../../../src/domain/scene';
import type { FrameCoords } from '../../../src/domain/sceneGeo';
import type { LngLat } from '../../../src/domain/types';
import { clamp, fbm, hash2, hex, mix3, smoothstep } from '../../../src/stage/ground/num';
import { curveInverse } from '../../../src/domain/sceneGeoRoute';
import { keepAt, routePictureSize } from '../../../src/stage/ground/route';
import type { RouteGround } from '../../../src/stage/ground/route';
import type { Vec2, Vec3 } from '../../../src/stage/ground/types';
import type { StageStyle } from '../../../src/stage/three/internal';
import { pickedLakes, pickedLines } from '../../content/routeRules';
import type { TodayFeature } from '../../content/routeRules';

/** 画河用的粗细分几等：干流、大河、河、小河，和运河。 */
export type RouteRiverWidth = 'trunk' | 'major' | 'river' | 'minor' | 'canal';

/**
 * 这个画法自己的数。数都是定稿的样张的（spikes/art-direction/route/scene/ 里 palette.js、fields.js 的 PAINT 和河宽）。
 * 2026-11-26 以前它们写在样式里（RouteStyle 的 riverKm、colours、bands），随沙盘程序发给读者，可沙盘程序从来不读：搬到了这里，一个数没有改。
 * riverKm：河画多宽（地上的公里），按场景里写的 weight；canal 是运河。比实际宽得多，远看才是一条河。
 * colours：站点沙盘的地面颜色（样式的 ground.colours）里没有、或者这里不一样的几种——loess 北方的黄土地，sand 河岸留白，
 *   shoreInk 留白的地方的海岸线，sea 和 seaDeep 海和湖的浅处、深处，river 照今天画的河，riverSong 示意的河和运河。
 * bands：山上的分带。比着的数是“比四周低处高出多少米 × relK + 海拔 × hK”，再加一点随机（noise）。
 *   foot、green、blue、deep：从多少到多少匀着过渡成赭石、石绿、石青、深石青；footK、blueK 是盖上去几成。
 *   rank：在自己这条山脉里排到多靠前（0 到 1）才上石青；rankCurv 是山脊凸出来的那一点加分。
 *   steep：坡度从多少到多少匀着出皴。patch：平地上那些淡淡的块盖上去几成。
 */
export const SONG_QINGLV_PAINT: {
  riverKm: Record<RouteRiverWidth, number>;
  colours: Record<'loess' | 'sand' | 'shoreInk' | 'sea' | 'seaDeep' | 'river' | 'riverSong', string>;
  bands: {
    relK: number;
    hK: number;
    noise: number;
    foot: [number, number];
    footK: number;
    green: [number, number];
    blue: [number, number];
    blueK: number;
    rank: [number, number];
    rankCurv: number;
    deep: [number, number];
    steep: [number, number];
    patch: number;
  };
} = {
  riverKm: { trunk: 8, major: 4.6, river: 3.6, minor: 2.8, canal: 1.8 },
  colours: {
    loess: '#dcc592',
    sand: '#ebe1c2',
    shoreInk: '#a8936a',
    sea: '#b3ccd0',
    seaDeep: '#93b6c1',
    river: '#6f9db2',
    riverSong: '#93b3bd',
  },
  bands: {
    relK: 1.0,
    hK: 0.2,
    noise: 70,
    foot: [110, 240],
    footK: 0.6,
    green: [240, 540],
    blue: [520, 900],
    blueK: 0.92,
    rank: [0.62, 0.92],
    rankCurv: 1 / 500,
    deep: [1500, 2600],
    steep: [0.22, 0.6],
    patch: 0.24,
  },
};

/** 样张的两个尺寸：颜色图一个点合多少公里，高程一格多少公里。样张里按“几个点”“几格”写的数，在这里先换成公里再用。 */
const TRIAL_KM_PER_POINT = 2001 / 1812;
const TRIAL_KM_PER_CELL = 3;

/**
 * 留白的边上，颜色比地势先淡完。地势是从（打散以后的）边线外面约 75 公里起收、到边线收完的（地面的 keepAt）；
 * 颜色在边线外面 COLOUR_GONE_KM 公里就已经是空绢了，再往外 COLOUR_FADE_KM 公里才上足——地势开始收以前颜色已经在淡。
 * 哪里先淡是噪声和山形定的（山谷先淡，山脊后淡），最多前后挪 COLOUR_TORN_KM 公里。
 * 2026-11-20 对着沙盘上的图改的：原来颜色比地势晚淡完，西边的高原收平的那一道坡上成了一条笔直的石青带、西南角一条赭石线。
 */
const COLOUR_GONE_KM = 16;
const COLOUR_FADE_KM = 72;
const COLOUR_TORN_KM = 20;
/** 抹开了的“离留白多远”倒算回公里，只在这么多公里以内分得出远近。 */
const BLANK_REACH_KM = 108;

/** 河空着的一头在这么多公里里收细；一头离别的河的线不到 RIVER_JOIN_KM 就算接上了；离沙盘的边不到 RIVER_EDGE_KM 的不收。 */
const RIVER_TAPER_KM = 45;
const RIVER_JOIN_WIDTH = 0.5;
const RIVER_END_OPEN = 0.2;
const RIVER_END_AT_SEA = 0.42;
const RIVER_JOIN_KM = 12;
const RIVER_EDGE_KM = 90;
/**
 * 河口：离陆地 MOUTH_NARROW_KM 公里以外的海是“宽的海”，离宽的海也有这么远的海是“窄的海”（两岸相距不到三十公里上下的河口、水道）；
 * 河头四周 MOUTH_SEED_KM 公里以内的窄海是漫的起点；漫出去 MOUTH_BLEND_KM 公里，或者离宽的海不到 MOUTH_OPEN_KM 公里，河的颜色换完成海的颜色。
 */
const MOUTH_NARROW_KM = 15;
const MOUTH_SEED_KM = 30;
const MOUTH_BLEND_KM = 130;
const MOUTH_OPEN_KM = 22;
/** 水纹离岸多远才画：把“是不是水”抹开这么多公里，再从 0.6 到 0.93 过渡——离岸十公里以内不画，五十公里以外画足。 */
const RIPPLE_OFFSHORE_KM = 27;
/** 只染水色的水里面，岸边的留白少上多少（1 是一点不上）。 */
const WASH_SAND = 0.6;

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

/**
 * 把一条折线按半宽（点）盖到栅格上，取最大值。坐标是“点”，和 coverage 一样。
 * taper 写了的话：head、tail 是这一头收到原来的几成（1 是不收），在 taper.len 个点的长度里慢慢收细——
 * 河从山里出来是细的；到了海边的，收到和河口差不多宽，不留一个比河口还粗的圆头。
 */
function stampLine(buf: Float32Array, W: number, H: number, pts: Vec2[], halfW: number, taper?: { head: number; tail: number; len: number }): void {
  // 每个点离两头各多远（沿着线量）
  const along: number[] = [0];
  for (let s = 1; s < pts.length; s++) along.push(along[s - 1] + Math.hypot(pts[s][0] - pts[s - 1][0], pts[s][1] - pts[s - 1][1]));
  const total = along[along.length - 1];
  const len = taper ? Math.min(taper.len, total * 0.45) : 0;
  const widthAt = (d: number): number => {
    if (!taper || len <= 0) return halfW;
    let k = 1;
    if (taper.head < 1) k = Math.min(k, taper.head + (1 - taper.head) * smoothstep(0, len, d));
    if (taper.tail < 1) k = Math.min(k, taper.tail + (1 - taper.tail) * smoothstep(0, len, total - d));
    return halfW * k;
  };
  for (let s = 0; s < pts.length - 1; s++) {
    const [ax, ay] = pts[s];
    const [bx, by] = pts[s + 1];
    // 这一段里宽度变不变（变的话每个点照它沿着线的位置算，线上的点再稀也是在 len 里收完）
    const seg = along[s + 1] - along[s];
    const even = widthAt(along[s]) === halfW && widthAt(along[s + 1]) === halfW && (len <= 0 || (along[s] >= len && total - along[s + 1] >= len));
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
        const c = clamp((even ? halfW : widthAt(along[s] + seg * t)) + 0.5 - d, 0, 1);
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

/**
 * 每个点离最近的一个“是”的点多远（单位是点；横竖走一步算 1，斜着走一步算 1.4 上下，来回扫两遍的近似算法）。
 * 一个“是”的点也没有的话，处处是一个很大的数。
 */
function distanceTo(W: number, H: number, is: (t: number) => boolean): Float32Array {
  const d = new Float32Array(W * H);
  const A = 1;
  const B = 4 / 3;
  for (let t = 0; t < d.length; t++) d[t] = is(t) ? 0 : 1e9;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = y * W + x;
      let v = d[t];
      if (x > 0) v = Math.min(v, d[t - 1] + A);
      if (y > 0) {
        v = Math.min(v, d[t - W] + A);
        if (x > 0) v = Math.min(v, d[t - W - 1] + B);
        if (x < W - 1) v = Math.min(v, d[t - W + 1] + B);
      }
      d[t] = v;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const t = y * W + x;
      let v = d[t];
      if (x < W - 1) v = Math.min(v, d[t + 1] + A);
      if (y < H - 1) {
        v = Math.min(v, d[t + W] + A);
        if (x < W - 1) v = Math.min(v, d[t + W + 1] + B);
        if (x > 0) v = Math.min(v, d[t + W - 1] + B);
      }
      d[t] = v;
    }
  }
  return d;
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
export function riverPaths(scene: RouteScene, features: TodayFeature[], coords: FrameCoords): RiverPath[] {
  const route = SONG_QINGLV_PAINT;
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
  const route = SONG_QINGLV_PAINT;
  // 留白的边抹开多宽：和造地面的时候用的是样式里的同一个数
  const blankEdge = style.route?.blank;
  if (!blankEdge) throw new Error(`样式“${scene.style}”没有全程沙盘的那一份`);
  const BLANK_BLUR_M = blankEdge.blurM;
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
  const far = gauss(wat, W, H, RIPPLE_OFFSHORE_KM / kmPerPoint);
  // 河：照今天画的一层，淡的一层（示意的河、运河）。线还是 riverPaths() 的线，一个点也不挪；只是空着的一头收细
  const riv = new Float32Array(W * H);
  const rivPale = new Float32Array(W * H);
  const drawn =riverPaths(scene, features, coords).flatMap((river) => river.lines.filter((line) => line.length >= 2).map((line) => ({ river, pts: line.map(localToPoint) })));
  const joinPts = RIVER_JOIN_KM / kmPerPoint;
  const edgePts = RIVER_EDGE_KM / kmPerPoint;
  const pointAt = (p: Vec2): number => clamp(Math.floor(p[1]), 0, H - 1) * W + clamp(Math.floor(p[0]), 0, W - 1);
  /** 这一头是不是到了海边（十几公里以内有海）。 */
  const atSea = (p: Vec2): boolean => wide[pointAt(p)] > 0.08 && lakeIn[pointAt(p)] < 0.05;
  /**
   * 这一头收到原来的几成。接着别的河（十二公里以内有别的河的线）、在湖里或只染水色的水里、挨着沙盘的边：不收；
   * 到了海边：收到 RIVER_END_AT_SEA（和河口差不多宽）；别的（河从山里出来的那一头，断在平地上的那一头）：收到 RIVER_END_OPEN。
   */
  const endWidth = (self: number, p: Vec2): number => {
    if (p[0] < edgePts || p[0] > W - edgePts || p[1] < edgePts || p[1] > H - edgePts) return 1;
    const t = pointAt(p);
    if (lake[t] > 0.3 || wash[t] > 0.15) return 1;
    for (let o = 0; o < drawn.length; o++) {
      // 比自己细一半还多的不算接上：大江的头挨着运河，不是大江接着往下流
      if (o === self || drawn[o].river.widthKm < drawn[self].river.widthKm * RIVER_JOIN_WIDTH) continue;
      const other = drawn[o].pts;
      for (let s = 0; s < other.length - 1; s++) {
        const [ax, ay] = other[s];
        const dx = other[s + 1][0] - ax;
        const dy = other[s + 1][1] - ay;
        const u = clamp(((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1e-9), 0, 1);
        if (Math.hypot(p[0] - ax - dx * u, p[1] - ay - dy * u) < joinPts) return 1;
      }
    }
    return atSea(p) ? RIVER_END_AT_SEA : RIVER_END_OPEN;
  };
  drawn.forEach(({ river, pts }, self) => {
    const taper = { head: endWidth(self, pts[0]), tail: endWidth(self, pts[pts.length - 1]), len: RIVER_TAPER_KM / kmPerPoint };
    stampLine(river.pale ? rivPale : riv, W, H, pts, river.widthKm / kmPerPoint / 2, taper);
  });
  // 河口。今天的岸线把长江、钱塘江、珠江的下游画成窄窄的一条海，河的线到它的头上就完了；窄的海整个落在岸边那道白里，
  // 看上去像河在陆地上断了、一条白路通到海。所以：从到了海边的河头起，顺着窄的海（两岸相距不到二十几公里）一路漫出去，
  // 漫到的地方不上岸边那道白，上水的颜色——挨着河头是河的颜色，漫出去 MOUTH_BLEND_KM 公里慢慢换成海的颜色
  const narrowR = Math.max(2, Math.round(MOUTH_NARROW_KM / kmPerPoint));
  const sea = new Float32Array(W * H);
  for (let i = 0; i < sea.length; i++) sea[i] = 1 - land[i];
  // 离陆地够远的海是“宽的海”；离宽的海比这还远的海是“窄的海”（照距离量，边是圆的）
  const toLand = distanceTo(W, H, (t) => sea[t] <= 0.5);
  const toWide = distanceTo(W, H, (t) => sea[t] > 0.5 && toLand[t] > narrowR);
  const spread = new Int32Array(W * H).fill(-1); // 从河头漫到这里走了几个点；−1 是没漫到
  const reachPale = new Uint8Array(W * H);
  const queue = new Int32Array(W * H);
  let head = 0;
  let tail = 0;
  const narrowAt = (t: number): boolean => sea[t] > 0.5 && toWide[t] > narrowR + 1;
  const seedR = Math.round(MOUTH_SEED_KM / kmPerPoint);
  for (const { river, pts } of drawn) {
    for (const p of [pts[0], pts[pts.length - 1]]) {
      if (!atSea(p)) continue;
      const cx = Math.floor(p[0]);
      const cy = Math.floor(p[1]);
      for (let y = Math.max(0, cy - seedR); y <= Math.min(H - 1, cy + seedR); y++) {
        for (let x = Math.max(0, cx - seedR); x <= Math.min(W - 1, cx + seedR); x++) {
          const t = y * W + x;
          if (spread[t] >= 0 || !narrowAt(t) || Math.hypot(x - cx, y - cy) > seedR) continue;
          spread[t] = 0;
          reachPale[t] = river.pale ? 1 : 0;
          queue[tail++] = t;
        }
      }
    }
  }
  while (head < tail) {
    const t = queue[head++];
    const x = t % W;
    for (const o of [x > 0 ? t - 1 : -1, x < W - 1 ? t + 1 : -1, t - W, t + W]) {
      if (o < 0 || o >= spread.length || spread[o] >= 0 || !narrowAt(o)) continue;
      spread[o] = spread[t] + 1;
      reachPale[o] = reachPale[t];
      queue[tail++] = o;
    }
  }
  const mouthIn = new Float32Array(W * H);
  const mouthRiver = new Float32Array(W * H);
  const blend = MOUTH_BLEND_KM / kmPerPoint;
  for (let i = 0; i < spread.length; i++) {
    if (spread[i] < 0) continue;
    mouthIn[i] = 1;
    // 河的颜色：顺着河口往外慢慢换成海的颜色；快到宽的海了也换完
    mouthRiver[i] = (1 - smoothstep(0.1 * blend, blend, spread[i])) * smoothstep(narrowR + 1, narrowR + 1 + MOUTH_OPEN_KM / kmPerPoint, toWide[i]);
  }
  const mouth = gauss(mouthIn, W, H, points(1.2));
  const mouthTone = gauss(mouthRiver, W, H, points(1.2));
  // 离水近不近（水边的草色、岸边的留白用）
  const anyWater = new Float32Array(W * H);
  for (let i = 0; i < anyWater.length; i++) anyWater[i] = Math.max(wat[i], riv[i], rivPale[i], wash[i] * 0.7);
  const near = gauss(anyWater, W, H, points(11));
  const bank = gauss(anyWater, W, H, points(1.6));

  // ---------- 备料：地面网格上的东西
  // 上色照的海拔：留白那一步压过的地方照没压以前的算（样张也是）。照压过的算，高原收平的那一道坡自己成了一座“山”，
  // 坡顶上一条石青、坡脚一条赭石，顺着留白的边画成一道线
  const hp = new Float32Array(N);
  const story = new Float32Array(N); // 离（打散以后的）留白的边线多少公里：正的在外面，负的在留白里面；一百一十公里以外不再分
  const loess = new Float32Array(N); // 西北的黄土高原：偏黄，少上石绿
  const edge = new Float32Array(N); // 离沙盘的边多少公里
  const mistW = new Float32Array(N); // 是不是在西边（留白的边在西边带一点淡花青，像雾）
  for (let j = 0; j < nz; j++) {
    const z = ground.z0 + j * cell;
    for (let i = 0; i < nx; i++) {
      const x = ground.x0 + i * cell;
      const k = j * nx + i;
      const [lng, lat] = coords.toLngLat(x, z);
      const soft = ground.blank[k];
      const keep = keepAt(soft);
      hp[k] = keep < 1 ? scene.frame.datumM + curveInverse(scene.frame.relief, (ground.y[k] / keep) * scale) : ground.h[k];
      // 抹开 40 公里的那个数倒算回“离边线几公里”（照正态分布的近似式倒算；两头压在 ±110 公里）
      const side = 2 * soft - 1;
      const widths = Math.sqrt(-(Math.PI / 2) * Math.log(Math.max(1e-6, 1 - side * side)));
      story[k] = clamp(((side < 0 ? -widths : widths) * BLANK_BLUR_M) / 1000, -BLANK_REACH_KM, BLANK_REACH_KM);
      mistW[k] = 1 - smoothstep(104.6, 106.2, lng);
      loess[k] = smoothstep(34.3, 35.3, lat) * (1 - smoothstep(111.6, 113.0, lng)) * smoothstep(350, 900, hp[k]);
      edge[k] = (Math.min(x - coords.x0, coords.x1 - x, z - coords.z0, coords.z1 - z) * scale) / 1000;
    }
  }
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
  const WASH = mix3(C.sea, C.seaDeep, 0.8); // 只染水色的水：比海岸的浅水深一点，近湖的颜色（原来是 0.4，在平地上发灰发白）
  const STROKE_PALE: Vec3 = [250, 246, 228];
  const CREST_PALE: Vec3 = [255, 250, 232];
  const SEA = linear3(C.sea);
  const SEA_DEEP = linear3(C.seaDeep);
  const FOAM = linear3(C.ripple);
  const RIVER = linear3(C.river);
  const RIVER_SONG = linear3(C.riverSong);

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
      // 留白的边：颜色比地势先淡完，边是打散的——山谷先淡，山脊后淡，再加一层噪声。st 是 1 的地方颜色上足，0 是空绢
      const out = sampleGrid(story, fx, fy);
      let st = 1;
      if (out < BLANK_REACH_KM - 0.01) {
        const later = clamp((fbm(xk / 34, yk / 34, 3, 331) - 0.5) * 2.6 + clamp(curv / 260, -0.5, 0.5), -1, 1);
        const gone = COLOUR_GONE_KM - COLOUR_TORN_KM * later;
        st = smoothstep(gone, gone + COLOUR_FADE_KM, out);
      }
      /** 陆地上画的东西（河、岸边的白）跟着陆地的颜色一起淡。 */
      const shown = 0.03 + 0.97 * st;
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
        col = mix3(col, to, (1 - smoothstep(0.04, 0.96, st)) * 0.97);
      }
      const sd = sdf[t];
      if (st < 0.6 && sd > 0.06) col = mix3(col, C.shoreInk, smoothstep(0.1, 0.42, sd) * (1 - smoothstep(0.1, 0.6, st)) * 0.5);
      // 4 只染水色的水：一片化开的淡水色，没有岸线
      const washed = mk > 0.02 ? smoothstep(0.08, 0.8, mk + (a2 - 0.5) * 0.25) : 0;
      if (washed > 0) col = mix3(col, WASH, washed * 0.88);
      // 5 河：先在两岸留一道白，再上花青。示意的河淡一点、素一点。留白的地方河跟着陆地一起淡掉
      // 只染水色的水里面少留白（WASH_SAND）：照河岸那样留白，整片水色就盖成一块发灰的白了
      col = mix3(col, C.sand, clamp(bank[t] * 2.2, 0, 1) * 0.55 * shown * (1 - WASH_SAND * washed));
      const rv = riv[t] * shown;
      if (rv > 0) col = mix3(col, C.river, rv * 0.95);
      const rs = rivPale[t] * shown;
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
        // 河口：从河头漫到的窄海，当“离岸够远”，不上岸边那道白
        const inMouth = mouth[t];
        const off = clamp(Math.max(wide[t], inLake, 0.9 * inMouth), 0, 1);
        const deep = smoothstep(0.84, 1.0, off);
        // 湖里没有海岸那道几公里宽的白，只按软边留一道不到一公里的细白
        const fringe = Math.max(1 - smoothstep(0.5, 0.7, off), (1 - smoothstep(0.5, 0.72, sd)) * 0.8);
        const wc: Vec3 = [0, 0, 0];
        for (let c = 0; c < 3; c++) {
          const tone = SEA[c] + (SEA_DEEP[c] - SEA[c]) * deep;
          wc[c] = tone + (FOAM[c] - tone) * fringe * 0.6;
        }
        // 河口挨着河头的一段是河的颜色，往外慢慢换成海的颜色
        const riverShare = mouthTone[t] * 0.9 * shown;
        if (riverShare > 0) {
          const to = reachPale[t] ? RIVER_SONG : RIVER;
          for (let c = 0; c < 3; c++) wc[c] += (to[c] - wc[c]) * riverShare;
        }
        // 河的线穿过岸边那道白进海，离岸十来公里以后淡掉（湖里不画）
        const through = inLake > 0 ? 0 : (1 - smoothstep(0.62, 0.92, wide[t])) * shown;
        if (through > 0 && (riv[t] > 0 || rivPale[t] > 0)) {
          const a = riv[t] * 0.95 * through;
          const b = rivPale[t] * 0.92 * through * (1 - riv[t]);
          for (let c = 0; c < 3; c++) {
            wc[c] += (RIVER[c] - wc[c]) * a;
            wc[c] += (RIVER_SONG[c] - wc[c]) * b;
          }
        }
        const lr0 = linear(r);
        const lg0 = linear(g);
        const lb0 = linear(b);
        r = screen(lr0 + (wc[0] - lr0) * water);
        g = screen(lg0 + (wc[1] - lg0) * water);
        b = screen(lb0 + (wc[2] - lb0) * water);
        // 水纹：海上离岸十公里以内不画，五十公里以外画足（一道水纹有几十公里长，贴着岸画就压到岸上去了）；湖里照旧，离湖岸几公里起画
        const offshore = Math.max(smoothstep(0.6, 0.93, far[t]), inLake > 0 ? smoothstep(0.52, 0.8, inLake) : 0);
        marks[t] = Math.round(clamp(water * offshore * (1 - FRINGE_ON_RIPPLE * fringe), 0, 1) * 255);
      }
      const o = t * 3;
      colour[o] = clamp(Math.round(r), 0, 255);
      colour[o + 1] = clamp(Math.round(g), 0, 255);
      colour[o + 2] = clamp(Math.round(b), 0, 255);
    }
  }
  return { w: W, h: H, colour, marks };
}

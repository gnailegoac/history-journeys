// 全程沙盘的地面：把高程、岸线、湖、河整理成画得出来的东西，再一格一格上色。
// 纯计算，不碰浏览器，所以页面和 Node 里的预览脚本共用。
//
// 这里动过手脚的地方（页面的小注和报告里都要照实说）：
//  - 山的高度夸大：a 是统一 10 倍；b 是矮山 25 倍、过了 300 米按 0.6 次方收（最高处约 8 倍）。
//    两种办法只差高度和受光：颜色是照同一份（没有夸大的）高程上的，所以 a、b 两张的颜色一模一样。
//  - 桌面四边 80 公里以内的地势收低到零，切面才是平的。
//  - 路没到的地方（西南角、台湾、吕宋北端、桌面最西边的高原）留白：地势压到 3%（夸大以后再压，两种办法一样），
//    只上空绢的颜色，海岸一道细线。地势比颜色先收平，所以留白的边上没有发白的浮雕。
//    西边留白的边是用噪声打散的（不是一条直的经线），山谷里收得更靠东，像几道淡花青的雾顺着谷伸进来；雾只是画法。
//  - 湖里是和海一样的花青，岸边的白只留不到一公里宽（小湖不会整个发白）。
//  - 河画宽了（大江约 8 公里宽），不按比例。
//  - 海岸、湖、河来自矢量数据，不是从高程里取的；海是一个平面。
//  - 当时还没有的陆地不画：苏北范公堤以东、今天的黄河三角洲抹掉，崇明三岛整个去掉（都是示意，见 data/song-overlay.json）。
//  - 梁山泊的轮廓没有依据，只染一片化开的淡水色，不画岸线。
//  - 石青上在每条山脉自己排前头的山顶上（不是按统一的海拔），是画法，不是高度表。

import { TABLE, toKm, toLngLat } from './proj.js';
import { clamp, smoothstep, fbm, hash2, hex, mix3, densify } from './util.js';
import { PAL } from './palette.js';

/** 场景里的 1 公里是多少个单位：定成和站点沙盘差不多大（桌面宽约 11700），装裱、灯、镜头的数就都能照搬 */
export const U = 5.85;
/** 上色的贴图大小：每格约 1.1 公里 */
export const TEX = { w: 1812, h: 2048 };

/** 两种夸大高度的办法：给出海拔（米），返回夸大以后的高度（米） */
export const RELIEF = {
  a: { id: 'a', blur: 0.8, fn: (h) => h * 10, text: '山高夸大 10 倍', short: '山高夸大 10 倍' },
  b: {
    id: 'b',
    blur: 0.85,
    fn: (h) => (h <= 300 ? h * 25 : 7500 * Math.pow(h / 300, 0.6)),
    text: '山高夸大约 8 到 25 倍，矮山夸得多、高山夸得少',
    short: '山高夸大约 8 到 25 倍',
  },
};

/** 上色的几个数：哪个高度开始上赭石、石绿、石青。m 大致是“比四周低处高出多少米，再加两成海拔” */
export const PAINT = {
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
};

// ---------- 栅格小工具 ----------
/** 多边形的覆盖度（0..1），奇偶填充，每行取两条扫描线 */
export function coverage(W, H, rings, SUB = 2) {
  const cov = new Float32Array(W * H);
  const lists = Array.from({ length: H * SUB }, () => []);
  for (const ring of rings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      let x0 = ring[i][0];
      let y0 = ring[i][1];
      let x1 = ring[(i + 1) % n][0];
      let y1 = ring[(i + 1) % n][1];
      if (y0 === y1) continue;
      if (y0 > y1) {
        [x0, y0, x1, y1] = [x1, y1, x0, y0];
      }
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
    const row = ((s / SUB) | 0) * W;
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
  return cov;
}
/** 把一条折线按宽度（格）盖到栅格上，取最大值 */
function stampLine(buf, W, H, pts, halfW, k = 1) {
  for (let s = 0; s < pts.length - 1; s++) {
    const ax = pts[s][0];
    const ay = pts[s][1];
    const bx = pts[s + 1][0];
    const by = pts[s + 1][1];
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
        const c = clamp(halfW + 0.5 - d, 0, 1) * k;
        const i = y * W + x;
        if (c > buf[i]) buf[i] = c;
      }
    }
  }
}
function boxBlur(src, W, H, r) {
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
/** 近似的高斯模糊：三遍方框；sigma 不到 1 格时用三点小核 */
export function gauss(src, W, H, sigma) {
  if (sigma < 0.9) {
    const a = clamp((sigma * sigma) / 2, 0, 0.33);
    const tmp = new Float32Array(W * H);
    const out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = y * W;
      tmp[o + x] = src[o + x] * (1 - 2 * a) + a * (src[o + Math.max(0, x - 1)] + src[o + Math.min(W - 1, x + 1)]);
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      out[y * W + x] = tmp[y * W + x] * (1 - 2 * a) + a * (tmp[Math.max(0, y - 1) * W + x] + tmp[Math.min(H - 1, y + 1) * W + x]);
    }
    return out;
  }
  const r = Math.max(1, Math.round(Math.sqrt(sigma * sigma + 0.25) - 0.5));
  return boxBlur(boxBlur(boxBlur(src, W, H, r), W, H, r), W, H, r);
}
/** 方框里的最小值（sign = 1）或最大值（sign = -1） */
function minFilter(src, W, H, r, sign = 1) {
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = Infinity;
    for (let k = Math.max(0, x - r); k <= Math.min(W - 1, x + r); k++) m = Math.min(m, sign * src[y * W + k]);
    tmp[y * W + x] = m;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = Infinity;
    for (let k = Math.max(0, y - r); k <= Math.min(H - 1, y + r); k++) m = Math.min(m, tmp[k * W + x]);
    out[y * W + x] = sign * m;
  }
  return out;
}

// ---------- 平地上的大块 ----------
const FIELD_TINTS = [null, 'fieldA', 'fieldB', 'fieldC', 'fieldB', 'fieldA', null];
function fieldCell(x, z) {
  // 每块二十七八公里；块心是乱放的，边界按离块心的直线距离分（不是方格），再加一点弯，所以没有哪条边是横平竖直的
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

// ---------- 故事以外的陆地 ----------
/** 1 = 故事里的地方，0 = 故事以外（越南、老挝北部，台湾，吕宋北端，桌面最西边的高原）。边上是慢慢淡下去的，不照任何国界。 */
export function storyWeight(lng, lat, valley = 0) {
  // 西南角：这条线以南、107.9°E 以西
  const B = [[100, 24.7], [103.5, 23.8], [105.5, 23.25], [107.0, 22.65], [107.9, 21.95]];
  let s = 1;
  if (lng < 108.2) {
    let lb = B[B.length - 1][1];
    for (let i = 0; i < B.length - 1; i++) {
      if (lng <= B[i + 1][0]) {
        lb = B[i][1] + ((B[i + 1][1] - B[i][1]) * (Math.max(lng, B[0][0]) - B[i][0])) / (B[i + 1][0] - B[i][0]);
        break;
      }
    }
    s = Math.min(s, Math.max(smoothstep(-1.0, 0.25, lat - lb), smoothstep(107.75, 108.2, lng)));
  }
  // 最西边的高原：边不是一条直的经线，用四五十公里一个起伏的噪声打散
  // valley（0..1）：山里的谷底。谷里收得更靠东，雾就顺着谷伸进来。眉州（103.85°E）以东总是完整的。
  const wn = clamp((fbm(lng * 2.1, lat * 2.1, 3, 301) - 0.5) * 1.5 + (fbm(lng * 0.7 + 9, lat * 0.7, 2, 307) - 0.5) * 2.6, -0.75, 1.2);
  s = Math.min(s, smoothstep(101.5, 103.0, lng + wn - 1.5 * valley));
  // 台湾
  const dt = Math.hypot((lng - 121.0) / 1.25, (lat - 23.7) / 2.1);
  s = Math.min(s, smoothstep(0.86, 1.14, dt));
  // 吕宋北端
  s = Math.min(s, Math.max(smoothstep(19.3, 19.9, lat), 1 - smoothstep(119.3, 119.9, lng)));
  return s;
}

const kmToTex = ([x, y]) => [((x + TABLE.w / 2) / TABLE.w) * TEX.w, ((TABLE.h / 2 - y) / TABLE.h) * TEX.h];
const llToTex = (p) => kmToTex(toKm(p[0], p[1]));
const llToDem = (p) => {
  const [x, y] = toKm(p[0], p[1]);
  return [(x + TABLE.w / 2) / TABLE.cell + 0.5, (TABLE.h / 2 - y) / TABLE.cell + 0.5];
};

/** 河画多宽（公里）。比实际宽得多，远看才是一条河。 */
function riverWidthKm(r) {
  if (r.name === 'Yangtze') return 8.5;
  if (r.name === 'Chang Jiang') return 7;
  if (r.name === 'Huang') return 7;
  if (r.rank <= 4) return 4.6;
  if (r.rank <= 6) return 4.2;
  if (r.rank === 7) return 3.6;
  return 2.8;
}
const SONG_W = { 'huanghe-north': 6.2, bianhe: 3.2, 'huai-lower': 3.8, 'minjiang-meizhou': 3.4, sishui: 3.0 };

/**
 * 备料：和夸大办法无关的那些（岸线、湖、河的栅格，地势整理）。
 * dem：Int16Array（米）；water、song：两个数据文件。
 */
export function prepare(dem, water, song) {
  const { cols, rows, cell, w: TW_KM, h: TH_KM } = TABLE;
  const W = TEX.w;
  const H = TEX.h;
  const t0 = Date.now();

  // 岸线：今天的陆地，减掉当时还是海的苏北一条
  // 当时还没有的陆地：整个不画的岛（长江口），和抹掉的几片（苏北、今天的黄河三角洲）
  const boxes = (song.removedLand || []).map((b) => b.box);
  const gone = (ring) => boxes.some((b) => ring.every((p) => p[0] >= b[0] && p[1] >= b[1] && p[0] <= b[2] && p[1] <= b[3]));
  const landSrc = water.land.filter((ring) => !gone(ring));
  const eraseSrc = [[...song.shore.line, ...song.shore.seaSide], ...(song.eraseLand || []).map((e) => e.ring)];
  const landRings = landSrc.map((ring) => ring.map(llToTex));
  let land = coverage(W, H, landRings);
  const erase = coverage(W, H, eraseSrc.map((r) => r.map(llToTex)));
  for (let i = 0; i < land.length; i++) land[i] = clamp(land[i], 0, 1) * (1 - clamp(erase[i], 0, 1));
  // 湖
  const lakeRings = [...water.lakes.map((l) => l.ring), ...song.lakes.filter((l) => !l.wash).map((l) => l.ring)].map((r) => r.map(llToTex));
  const lake = coverage(W, H, lakeRings);
  for (let i = 0; i < lake.length; i++) lake[i] = clamp(lake[i], 0, 1);
  // 只染一片的水（梁山泊）：轮廓没有依据，不画岸线，边上化开十几公里
  const marshRings = song.lakes.filter((l) => l.wash).map((l) => l.ring.map(llToTex));
  const marshCov = marshRings.length ? coverage(W, H, marshRings).map((v) => clamp(v, 0, 1)) : new Float32Array(W * H);
  const marsh = gauss(marshCov, W, H, 5.5);
  // 湖：小湖离岸不远，照海那样留几公里的白就整个白了。所以湖里（连同岸外几公里，法线图一格有 3 公里）单算，
  // 一律当“离岸够远”，上和海一样的花青；岸边那道细白在着色器里按贴图的软边另画，不到一公里宽
  const lakeIn = gauss(lake, W, H, 3);
  const wat = new Float32Array(W * H);
  for (let i = 0; i < wat.length; i++) wat[i] = Math.max(1 - land[i], clamp(lake[i], 0, 1) * land[i]);
  const sdf = gauss(wat, W, H, 1.0);
  const wide = gauss(wat, W, H, 9);
  // 河：测出来的一层，示意的一层
  const texPerKm = W / TW_KM;
  const riv = new Float32Array(W * H);
  // 今天的河里要改的两处（漳水裁到示意的黄河为止，沭水的半截去掉）
  const edits = song.riverEdits || [];
  const rivers = water.rivers.flatMap((r) => {
    const e = edits.find((x) => x.name === r.name);
    if (!e) return [r];
    if (e.drop) return [];
    return [{ ...r, cut: true, line: r.line.filter((p) => p[0] <= e.dropEastOf) }];
  });
  for (const r of rivers) {
    const pts = r.line.map(llToTex);
    stampLine(riv, W, H, pts, (riverWidthKm(r) * texPerKm) / 2);
  }
  const rivS = new Float32Array(W * H);
  const songLines = {};
  for (const r of song.rivers) {
    const km = densify(r.line.map((p) => toKm(p[0], p[1])), 6);
    songLines[r.id] = km;
    stampLine(rivS, W, H, km.map(kmToTex), ((SONG_W[r.id] || 3) * texPerKm) / 2);
  }
  // 离水近不近（水边的草色用）
  const anyW = new Float32Array(W * H);
  for (let i = 0; i < anyW.length; i++) anyW[i] = Math.max(wat[i], riv[i], rivS[i], marsh[i] * 0.7);
  const near = gauss(anyW, W, H, 11);
  const bank = gauss(anyW, W, H, 1.6);

  // 高程格子上的东西
  const N = cols * rows;
  const landD = coverage(cols, rows, landSrc.map((ring) => ring.map(llToDem)));
  const eraseD = coverage(cols, rows, eraseSrc.map((r) => r.map(llToDem)));
  const story = new Float32Array(N);
  const loess = new Float32Array(N); // 西北的黄土高原：上色时偏黄，少上石绿
  const edge = new Float32Array(N); // 离桌边多少公里
  const mistW = new Float32Array(N); // 是不是在西边（留白的边在西边带一点淡花青，像雾）
  const flat = new Float32Array(N); // 地势留几成：路到了的地方是 1，留白的地方 3%
  // 山里的谷底：比四周六十公里的平均低多少（只算海拔七八百米以上的山里，盆地、平原不算）
  const demF = Float32Array.from(dem);
  const demS = gauss(demF, cols, rows, 3);
  const demL = gauss(demF, cols, rows, 20);
  const hf = new Float32Array(N);
  for (let r = 0; r < rows; r++) {
    const y = TH_KM / 2 - r * cell;
    for (let c = 0; c < cols; c++) {
      const x = -TW_KM / 2 + c * cell;
      const k = r * cols + c;
      const [lng, lat] = toLngLat(x, y);
      const valley = lng < 106 ? clamp((demL[k] - demS[k]) / 650, 0, 1) * smoothstep(700, 1100, demS[k]) : 0;
      story[k] = storyWeight(lng, lat, valley);
      mistW[k] = 1 - smoothstep(104.6, 106.2, lng);
      flat[k] = smoothstep(0.45, 1.0, story[k]);
      loess[k] = smoothstep(34.3, 35.3, lat) * (1 - smoothstep(111.6, 113.0, lng)) * smoothstep(350, 900, dem[k]);
      edge[k] = Math.min(x + TW_KM / 2, TW_KM / 2 - x, y + TH_KM / 2, TH_KM / 2 - y);
      const onLand = clamp(landD[k], 0, 1) * (1 - clamp(eraseD[k], 0, 1));
      // 桌边 80 公里以内收到零（留白的地方在夸大以后再压平，见 build）
      hf[k] = dem[k] * smoothstep(0.0, 0.6, onLand) * smoothstep(6, 80, edge[k]);
    }
  }
  // 留白的边上地势慢慢收平（抹开二十来公里），不留陡坎；抹开以后不到两成半的一律收到 3%，留白的地方才是平的
  const flatB = gauss(flat, cols, rows, 7);
  const flatS = new Float32Array(N);
  for (let k = 0; k < N; k++) flatS[k] = 0.03 + 0.97 * smoothstep(0.25, 0.92, flatB[k]);
  // 大尺度的随机（上色用），算在粗格子上
  const n1 = new Float32Array(N);
  const n2 = new Float32Array(N);
  const n3 = new Float32Array(N);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = c * cell;
    const y = r * cell;
    const k = r * cols + c;
    n1[k] = fbm(x / 290, y / 290, 4, 3);
    n2[k] = fbm(x / 62, y / 62, 4, 9);
    n3[k] = fbm(x / 160, y / 160, 3, 21);
  }
  // 上色用的地势：只轻轻抹一下（0.8 格），和山怎么夸大无关，所以 a、b 两种办法颜色一样
  const hp = gauss(hf, cols, rows, 0.8);
  // 山有多“山”：比四周（三四十公里以内）的低处高出多少。范围取大，颜色才跟着整条山脉走，不是一个个小包
  const base = gauss(minFilter(hp, cols, rows, 12), cols, rows, 10);
  const lr = new Float32Array(N);
  for (let k = 0; k < N; k++) lr[k] = Math.max(0, hp[k] - base[k]);
  // 在自己这条山脉里排第几：0 是山脚，1 是这一带最高的山顶。石青只上在排前头的地方，每条山脉都有青的山顶，大山也不会整片青
  const top = gauss(minFilter(hp, cols, rows, 12, -1), cols, rows, 10);
  const rk = new Float32Array(N);
  for (let k = 0; k < N; k++) rk[k] = clamp((hp[k] - base[k]) / Math.max(top[k] - base[k], 160), 0, 1.3);
  const sm = gauss(hp, cols, rows, 2.6);
  const cv = new Float32Array(N);
  for (let k = 0; k < N; k++) cv[k] = hp[k] - sm[k];
  // 坡向和坡度（皴用）：按统一 10 倍算，同夸大办法无关
  const pgx = new Float32Array(N);
  const pgz = new Float32Array(N);
  const dd = 2 * cell * 1000;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const k = r * cols + c;
    pgx[k] = ((hp[r * cols + Math.min(cols - 1, c + 1)] - hp[r * cols + Math.max(0, c - 1)]) * 10) / dd;
    pgz[k] = ((hp[Math.min(rows - 1, r + 1) * cols + c] - hp[Math.max(0, r - 1) * cols + c]) * 10) / dd;
  }
  /** 桌面上一点（公里）是不是在湖里或海里：路线检查用 */
  const waterAt = (xkm, ykm) => {
    const i = clamp(Math.round(((xkm + TW_KM / 2) / TW_KM) * W), 0, W - 1);
    const j = clamp(Math.round(((TH_KM / 2 - ykm) / TH_KM) * H), 0, H - 1);
    return lake[j * W + i] > 0.5 || marshCov[j * W + i] > 0.5 ? 'lake' : land[j * W + i] < 0.5 ? 'sea' : null;
  };
  return { land, wat, sdf, wide, lakeIn, marsh, riv, rivS, near, bank, story, mistW, flat: flatS, loess, edge, hf, hp, lr, cv, rk, pgx, pgz, n1, n2, n3, songLines, rivers, waterAt, ms: Date.now() - t0 };
}

/**
 * 按一种夸大办法把地势、法线、颜色做出来。
 * 返回：Y（高程格子上的场景高度）、color（RGBA，A 是“这里是不是水”的软边）、normal（RGBA，A 是离岸远近）。
 */
export function build(prep, relief, { paint = true } = {}) {
  const { cols, rows, cell, w: TW_KM, h: TH_KM } = TABLE;
  const N = cols * rows;
  const W = TEX.w;
  const H = TEX.h;
  const t0 = Date.now();
  const hs = gauss(prep.hf, cols, rows, relief.blur);
  const Y = new Float32Array(N);
  for (let k = 0; k < N; k++) Y[k] = (relief.fn(Math.max(0, hs[k])) / 1000) * U * prep.flat[k];
  const { hp, lr, cv } = prep;
  // 坡向（夸大以后的），法线
  const gx = new Float32Array(N);
  const gz = new Float32Array(N);
  const normal = new Uint8Array(N * 4);
  const d = 2 * cell * U;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const k = r * cols + c;
    const dx = (Y[r * cols + Math.min(cols - 1, c + 1)] - Y[r * cols + Math.max(0, c - 1)]) / d;
    const dz = (Y[Math.min(rows - 1, r + 1) * cols + c] - Y[Math.max(0, r - 1) * cols + c]) / d;
    gx[k] = dx;
    gz[k] = dz;
    const len = Math.hypot(dx, 1, dz);
    normal[k * 4] = Math.round((-dx / len) * 127.5 + 127.5);
    normal[k * 4 + 1] = Math.round((1 / len) * 127.5 + 127.5);
    normal[k * 4 + 2] = Math.round((-dz / len) * 127.5 + 127.5);
    // A：离岸远近（宽的模糊），着色器里给海分深浅、留岸边的白
    const tx = Math.min(W - 1, Math.round(((c * cell) / TW_KM) * W));
    const ty = Math.min(H - 1, Math.round(((r * cell) / TH_KM) * H));
    const li = prep.lakeIn[ty * W + tx];
    const inLake = li > 0.015 ? 0.9 + 0.06 * smoothstep(0.45, 0.98, li) : 0;
    normal[k * 4 + 3] = Math.round(clamp(Math.max(prep.wide[ty * W + tx], inLake), 0, 1) * 255);
  }
  const sampleGrid = (f, fx, fy) => {
    const x = clamp(fx, 0, cols - 1.001);
    const y = clamp(fy, 0, rows - 1.001);
    const ix = x | 0;
    const iy = y | 0;
    const ax = x - ix;
    const ay = y - iy;
    const o = iy * cols + ix;
    return f[o] * (1 - ax) * (1 - ay) + f[o + 1] * ax * (1 - ay) + f[o + cols] * (1 - ax) * ay + f[o + cols + 1] * ax * ay;
  };
  /** 桌面上一点（公里）的场景高度 */
  const heightAt = (xkm, ykm) => sampleGrid(Y, (xkm + TW_KM / 2) / cell, (TH_KM / 2 - ykm) / cell);
  const out = { Y, hs, normal, heightAt, cols, rows };
  if (!paint) return out;

  // ---------- 上色 ----------
  const C = Object.fromEntries(Object.entries(PAL).map(([k, v]) => [k, hex(v)]));
  const MIST = mix3(C.mist, C.water, 0.38); // 淡花青的白
  const color = new Uint8Array(W * H * 4);
  const sx = (cols - 1) / W;
  const sy = (rows - 1) / H;
  const kmPerTex = TW_KM / W;
  for (let j = 0; j < H; j++) {
    const fy = (j + 0.5) * sy;
    for (let i = 0; i < W; i++) {
      const fx = (i + 0.5) * sx;
      const t = j * W + i;
      const h = sampleGrid(hp, fx, fy);
      const rel = sampleGrid(lr, fx, fy);
      const curv = sampleGrid(cv, fx, fy);
      const st = sampleGrid(prep.story, fx, fy);
      const lo = sampleGrid(prep.loess, fx, fy);
      const ed = sampleGrid(prep.edge, fx, fy);
      const a1 = sampleGrid(prep.n1, fx, fy);
      const a2 = sampleGrid(prep.n2, fx, fy);
      const a3 = sampleGrid(prep.n3, fx, fy);
      const xk = i * kmPerTex;
      const yk = j * kmPerTex;

      // 平地：茶色底，北边的黄土地再暖一点，水边带一点草色
      let col = mix3(C.tea, C.teaWarm, smoothstep(0.3, 0.75, a1));
      const north = smoothstep(0.42, 0.2, j / H) * smoothstep(40, 400, h + 60 * (a3 - 0.5));
      col = mix3(col, C.loess, north * 0.7);
      const wet = smoothstep(0.035, 0.3, prep.near[t]) * (1 - smoothstep(60, 220, h)) * smoothstep(0.25, 0.62, a3 + 0.15);
      col = mix3(col, C.meadow, wet * 0.8);

      // 平地上很淡的一块一块（同站点沙盘远看的田一个意思，只是装饰，不是真的田界）
      const mk = prep.marsh[t];
      const plainK = (1 - smoothstep(35, 110, rel * 0.6 + h * 0.12)) * st * (1 - smoothstep(0.3, 0.55, prep.sdf[t])) * (1 - smoothstep(0.1, 0.5, mk));
      if (plainK > 0.02) {
        const fc = fieldCell(xk, yk);
        if (fc.tint) col = mix3(col, C[fc.tint], plainK * smoothstep(0.02, 0.2, fc.border) * smoothstep(0.3, 0.5, a3 + 0.1) * PAINT.patch);
      }

      // 山：按“比四周高出多少”和海拔一起定色。山脚赭石，山腰石绿，山顶石青
      const P = PAINT;
      const m = (rel * P.relK + h * P.hK) * (1 - 0.5 * lo) + (a2 - 0.5) * P.noise + curv * 0.5;
      const tFoot = smoothstep(P.foot[0], P.foot[1], m);
      col = mix3(col, mix3(C.ochre, C.loess, lo * 0.55), tFoot * P.footK);
      const tGreen = smoothstep(P.green[0], P.green[1], m);
      col = mix3(col, mix3(C.shilu, C.shiluDeep, smoothstep(0.35, 0.8, a2)), tGreen);
      // 石青只上在山脊上：除了够高，还要比两边凸出来（curv 是正的）
      const rank = sampleGrid(prep.rk, fx, fy) + curv * P.rankCurv + (a2 - 0.5) * 0.12;
      const tBlue = smoothstep(P.rank[0], P.rank[1], rank) * smoothstep(P.blue[0], P.blue[1], m);
      col = mix3(col, C.shiqing, tBlue * P.blueK);
      col = mix3(col, C.shiqingDeep, smoothstep(P.rank[1], P.rank[1] + 0.3, rank) * smoothstep(P.deep[0], P.deep[1], m) * 0.8);
      // 皴：顺着坡往下的细纹
      // 只上在真有坡的地方：盆地底、平地上不要
      let steep = 0;
      if (tFoot > 0.02) {
        const dx = sampleGrid(prep.pgx, fx, fy);
        const dz = sampleGrid(prep.pgz, fx, fy);
        const gl = Math.hypot(dx, dz);
        steep = smoothstep(P.steep[0], P.steep[1], gl);
        if (steep > 0.01) {
          const ux = dx / gl;
          const uz = dz / gl;
          const s = fbm((-xk * uz + yk * ux) / 2.6, (xk * ux + yk * uz) / 26, 3, 61);
          const sk = steep * tFoot;
          col = mix3(col, C.ochreDeep, smoothstep(0.55, 0.78, s) * sk * (0.5 - 0.22 * tBlue));
          col = mix3(col, [250, 246, 228], smoothstep(0.45, 0.22, s) * sk * 0.22);
        }
      }
      const gully = smoothstep(18, 150, -curv) * tFoot * steep;
      col = mix3(col, C.ochreDeep, gully * (0.55 - 0.28 * tBlue));
      const crest = smoothstep(25, 190, curv) * tGreen;
      col = mix3(col, [255, 250, 232], crest * 0.2);

      // 路没到的地方留白：空绢的颜色，海岸只留一道细线。西边的边上先过一层淡花青的白（雾），再到空绢
      if (st < 0.999) {
        const mw = sampleGrid(prep.mistW, fx, fy);
        const to = mw > 0 ? mix3(C.blank, MIST, mw * smoothstep(0.04, 0.4, st)) : C.blank;
        col = mix3(col, to, (1 - smoothstep(0.1, 0.78, st)) * 0.97);
      }
      const sd = prep.sdf[t];
      if (st < 0.6 && sd > 0.06) col = mix3(col, C.shoreInk, smoothstep(0.1, 0.42, sd) * (1 - smoothstep(0.1, 0.6, st)) * 0.5);
      // 梁山泊：一片化开的淡水色，上面几道断断续续的水纹，没有岸线
      if (mk > 0.02) {
        col = mix3(col, mix3(C.water, C.waterDeep, 0.4), smoothstep(0.08, 0.8, mk + (a2 - 0.5) * 0.25) * 0.8);
        const wv = yk / 4.4 + 0.3 * Math.sin(xk / 8 + 1.3 * Math.sin(yk / 17));
        const fr = Math.abs(wv - Math.round(wv)) * 2;
        const seg = fbm(xk / 11, Math.round(wv) * 3.7, 2, 91);
        col = mix3(col, C.ripple, (1 - smoothstep(0.1, 0.3, fr)) * smoothstep(0.5, 0.62, seg) * smoothstep(0.3, 0.75, mk) * 0.75);
      }
      // 河：先在两岸留一道白，再上花青。示意的河淡一点、素一点
      const bk = prep.bank[t];
      col = mix3(col, C.sand, clamp(bk * 2.2, 0, 1) * 0.55 * st);
      const rv = prep.riv[t] * (0.08 + 0.92 * st);
      if (rv > 0) col = mix3(col, C.river, rv * 0.95);
      const rs = prep.rivS[t];
      if (rs > 0) col = mix3(col, C.riverSong, rs * 0.92 * (1 - rv));
      // 画心四边留出空绢
      const fade = 1 - smoothstep(10, 70 + a3 * 190, ed + (a1 - 0.5) * 50);
      col = mix3(col, C.blank, fade * 0.86);
      // 一点手工上色的不匀
      const grain = (hash2(i, j, 5) - 0.5) * 5 + (fbm(xk / 7.5, yk / 7.5, 2, 31) - 0.5) * 9;
      const o = t * 4;
      color[o] = clamp(Math.round(col[0] + grain), 0, 255);
      color[o + 1] = clamp(Math.round(col[1] + grain), 0, 255);
      color[o + 2] = clamp(Math.round(col[2] + grain * 0.9), 0, 255);
      color[o + 3] = Math.round(clamp(prep.sdf[t], 0, 1) * 255);
    }
  }
  out.color = color;
  out.ms = Date.now() - t0;
  return out;
}

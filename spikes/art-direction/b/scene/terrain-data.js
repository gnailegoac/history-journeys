// 把今天的高程整理成沙盘用的地形：抹平、压低平地的起伏、城里压成平地、挖出河床，
// 再照青绿山水的办法上色（平地茶色赭色，山腰石绿，山顶石青）。这里只算数，不碰 three。

import { heightAt } from '../../shared/scene-data.js';
import { CROP, CELL, LEVEL, BANK_H, CITY_H, WALLRECT, RIVER_PATHS, DIKE_PTS, PLACE, PAL } from './config.js';
import { clamp, lerp, smoothstep, densify, distSeg, fbm, hash2, hex, mix3, mulberry32 } from './util.js';

function boxBlur(src, nx, nz, r) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const win = 2 * r + 1;
  for (let j = 0; j < nz; j++) {
    let acc = 0;
    const row = j * nx;
    for (let k = -r; k <= r; k++) acc += src[row + clamp(k, 0, nx - 1)];
    for (let i = 0; i < nx; i++) {
      tmp[row + i] = acc / win;
      acc += src[row + clamp(i + r + 1, 0, nx - 1)] - src[row + clamp(i - r, 0, nx - 1)];
    }
  }
  for (let i = 0; i < nx; i++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[clamp(k, 0, nz - 1) * nx + i];
    for (let j = 0; j < nz; j++) {
      out[j * nx + i] = acc / win;
      acc += tmp[clamp(j + r + 1, 0, nz - 1) * nx + i] - tmp[clamp(j - r, 0, nz - 1) * nx + i];
    }
  }
  return out;
}
/** 三次盒式模糊，近似高斯；sigma 以格为单位 */
function gauss(src, nx, nz, sigma) {
  const r = Math.max(1, Math.round(sigma - 0.5));
  return boxBlur(boxBlur(boxBlur(src, nx, nz, r), nx, nz, r), nx, nz, r);
}
const softplus = (t, w) => (t / w > 20 ? t : w * Math.log(1 + Math.exp(t / w)));

function sdBox(x, z, x0, x1, z0, z1) {
  const dx = Math.max(x0 - x, x - x1);
  const dz = Math.max(z0 - z, z - z1);
  if (dx > 0 && dz > 0) return Math.hypot(dx, dz);
  return Math.max(dx, dz);
}

function pointInTri(px, pz, a, b, c) {
  const s = (p, q) => (px - q[0]) * (p[1] - q[1]) - (p[0] - q[0]) * (pz - q[1]);
  const d1 = s(a, b);
  const d2 = s(b, c);
  const d3 = s(c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

export function buildTerrainData(dem) {
  const nx = Math.round((CROP.x1 - CROP.x0) / CELL) + 1;
  const nz = Math.round((CROP.z1 - CROP.z0) / CELL) + 1;
  const N = nx * nz;
  const X = (i) => CROP.x0 + i * CELL;
  const Z = (j) => CROP.z0 + j * CELL;

  const raw = new Float32Array(N);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) raw[j * nx + i] = heightAt(dem, X(i), Z(j));

  // 1 抹平：山上留细一点，平地抹得狠一点；再把平地的起伏压到原来的一成
  const A = gauss(raw, nx, nz, 2.2);
  const B = gauss(raw, nx, nz, 12);
  const M = gauss(raw, nx, nz, 6);
  const h = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const k = smoothstep(47, 60, M[i]);
    const t = lerp(B[i], A[i], k) - 47;
    h[i] = 40 + 0.1 * t + 0.9 * softplus(t, 3.5);
  }

  // 2 城外先压出一圈缓坡，城南垫高一条冈（“只有城南走得了车马”），戏马台垫一个土丘
  const W = WALLRECT;
  const P1 = [-330, 650];
  const P2 = PLACE.ximatai;
  const P3 = PLACE.fangheting;
  const [da, db, dc] = DIKE_PTS;
  const dikeCut = (x, z) => {
    // 堤外（东南）不垫高：0 是堤里，1 是堤外。堤头往外慢慢收，不留一道直上直下的坎
    let best = 1e9;
    let cut = 0;
    for (const [a, b] of [[da, db], [db, dc]]) {
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz);
      const along = ((x - a[0]) * dx + (z - a[1]) * dz) / len;
      const d = distSeg(x, z, a[0], a[1], b[0], b[1]);
      if (d < best) {
        best = d;
        const sd = ((x - a[0]) * -dz + (z - a[1]) * dx) / len;
        cut = smoothstep(-110, 10, sd) * (a === da ? smoothstep(-420, -30, along) : 1);
      }
    }
    return cut;
  };
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = X(i);
      const z = Z(j);
      const k = j * nx + i;
      const dOut = sdBox(x, z, W.x0, W.x1, W.z0, W.z1);
      let v = h[k];
      v = lerp(v, CITY_H, 1 - smoothstep(60, 260, dOut));
      const d = Math.min(distSeg(x, z, P1[0], P1[1], P2[0], P2[1]), distSeg(x, z, P2[0], P2[1], P3[0], P3[1]));
      const w = (1 - smoothstep(300, 820, d)) * (1 - dikeCut(x, z));
      const T = 46.3;
      if (v < T) v = lerp(v, T, w);
      v += 8.5 * (1 - smoothstep(70, 330, Math.hypot(x - P2[0], z - P2[1])));
      v = lerp(v, CITY_H, 1 - smoothstep(-10, 22, dOut));
      // 沙盘四边：山收低到平地，切面齐整
      const edgeD = Math.min(x - CROP.x0, CROP.x1 - x, z - CROP.z0, CROP.z1 - z);
      if (v > 40.3) v = 40.3 + (v - 40.3) * smoothstep(0, 460, edgeD);
      h[k] = v;
    }
  }

  // 3 河：先算每一格到河岸的距离（河里为负），再把两岸压成一样高，挖出河床
  const edge = new Float32Array(N).fill(1e6);
  const dense = {};
  for (const [name, r] of Object.entries(RIVER_PATHS)) {
    const pts = r.dense;
    dense[name] = pts;
    const hw = r.w / 2;
    const R = 620;
    for (let s = 0; s < pts.length - 1; s++) {
      const [ax, az] = pts[s];
      const [bx, bz] = pts[s + 1];
      const i0 = clamp(Math.floor((Math.min(ax, bx) - R - CROP.x0) / CELL), 0, nx - 1);
      const i1 = clamp(Math.ceil((Math.max(ax, bx) + R - CROP.x0) / CELL), 0, nx - 1);
      const j0 = clamp(Math.floor((Math.min(az, bz) - R - CROP.z0) / CELL), 0, nz - 1);
      const j1 = clamp(Math.ceil((Math.max(az, bz) + R - CROP.z0) / CELL), 0, nz - 1);
      if (i1 <= i0 || j1 <= j0) continue;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const d = distSeg(X(i), Z(j), ax, az, bx, bz) - hw;
          const k = j * nx + i;
          if (d < edge[k]) edge[k] = d;
        }
      }
    }
  }
  // 河岸不是一条直边：宽窄略有出入
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i;
    if (edge[k] < 300) edge[k] += (fbm(X(i) / 240, Z(j) / 240, 2, 55) - 0.5) * 40;
  }
  // 城的北面和东面，河一直贴到石岸脚下
  const MOAT_E = [W.x1 + 95, W.x1 + 215, W.z0 - 190, W.z1 + 40];
  const MOAT_N = [W.x0 - 40, W.x1 + 215, W.z0 - 200, W.z0 - 95];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = X(i);
      const z = Z(j);
      // 河画宽了，但不让它切进城墙和石岸：城这一角（石岸脚以内）算岸上，往南、往西慢慢放开
      const keepE = W.x1 + 95 - x - Math.max(0, z - (W.z1 + 60)) * 0.75;
      const keepN = z - (W.z0 - 95) - Math.max(0, W.x0 - 200 - x) * 0.75;
      edge[k] = Math.max(edge[k], Math.min(keepE, keepN));
      edge[k] = Math.min(edge[k], sdBox(x, z, ...MOAT_E), sdBox(x, z, ...MOAT_N));
    }
  }
  const bed = LEVEL.normal - 3.4;
  for (let k = 0; k < N; k++) {
    const e = edge[k];
    if (e > 500) continue;
    const hk = smoothstep(43.5, 52, h[k]);
    const w = Math.max((1 - smoothstep(100, 480, e)) * (1 - hk), 1 - smoothstep(20, 110, e));
    let v = lerp(h[k], BANK_H, w);
    if (e < 18) {
      let p;
      if (e > 0) p = lerp(LEVEL.normal, BANK_H, smoothstep(0, 18, e));
      else if (e > -40) p = LEVEL.normal - 1.4 * (-e / 40);
      else p = LEVEL.normal - 1.4 - 2.0 * smoothstep(40, 95, -e);
      v = Math.min(v, p);
    }
    h[k] = v;
  }

  // 4 水看到的地面：城里和堤后面算干的；石岸脚下算深水，让水面一直接到石岸
  const hw = new Float32Array(h);
  const triA = [W.x0, W.z1];
  const triB = [W.x1, W.z1];
  const triC = da;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = X(i);
      const z = Z(j);
      if (x >= W.x0 && x <= W.x1 && z >= W.z0 && z <= W.z1) hw[k] = 70;
      else if (pointInTri(x, z, triA, triB, triC)) hw[k] = 70;
      else if ((x > W.x1 + 47 && x < W.x1 + 130 && z > W.z0 - 130 && z < W.z1 + 30) || (z < W.z0 - 47 && z > W.z0 - 130 && x > W.x0 - 30 && x < W.x1 + 130)) hw[k] = bed;
    }
  }

  // 5 给上色、摆树用的几样：山的多少、凸凹
  const hill = new Float32Array(N);
  for (let k = 0; k < N; k++) hill[k] = smoothstep(42.6, 50, h[k]) * smoothstep(60, 200, edge[k]);
  const hBlur = gauss(h, nx, nz, 5);
  const curv = new Float32Array(N);
  for (let k = 0; k < N; k++) curv[k] = h[k] - hBlur[k];
  const hillSoft = gauss(hill, nx, nz, 14);

  const bil = (f) => (x, z) => {
    const fx = clamp((x - CROP.x0) / CELL, 0, nx - 1.001);
    const fz = clamp((z - CROP.z0) / CELL, 0, nz - 1.001);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const ax = fx - ix;
    const az = fz - iz;
    const k = iz * nx + ix;
    return f[k] * (1 - ax) * (1 - az) + f[k + 1] * ax * (1 - az) + f[k + nx] * (1 - ax) * az + f[k + nx + 1] * ax * az;
  };

  const td = {
    nx,
    nz,
    h,
    hw,
    edge,
    hill,
    hillSoft,
    curv,
    dense,
    bed,
    sample: bil(h),
    sampleEdge: bil(edge),
    sampleWet: bil(hw),
    sampleHill: bil(hill),
    sampleHillSoft: bil(hillSoft),
    sampleCurv: bil(curv),
  };
  td.villages = pickVillages(td);
  return td;
}

/** 平地上的村子：离河、离城、离山都有一段，彼此隔开 */
function pickVillages(td) {
  const rnd = mulberry32(20771);
  const out = [];
  const W = WALLRECT;
  let guard = 0;
  while (out.length < 17 && guard++ < 6000) {
    const x = lerp(CROP.x0 + 500, CROP.x1 - 500, rnd());
    const z = lerp(CROP.z0 + 500, CROP.z1 - 500, rnd());
    if (td.sample(x, z) > 41.4 || td.sample(x, z) < 38.2) continue;
    if (td.sampleEdge(x, z) < 170) continue;
    if (td.sampleHillSoft(x, z) > 0.12) continue;
    if (sdBox(x, z, W.x0, W.x1, W.z0, W.z1) < 520) continue;
    if (out.some((v) => Math.hypot(v.x - x, v.z - z) < 1250)) continue;
    out.push({ x, z, n: 5 + Math.floor(rnd() * 5), seed: Math.floor(rnd() * 1e6) });
  }
  return out;
}

/**
 * 大田块：把平地分成不规则的块（按“走横竖格子”的远近分，块的边是横、竖、斜的直线，像田）。
 * 返回这一点所在的块用哪种颜色（有的块不上色，留着底色），和离块边的远近（0 在边上）。
 */
const FIELD_TINTS = [null, 'fieldA', 'fieldB', 'fieldC', 'fieldB', 'fieldA', 'fieldC'];
function fieldCell(x, z) {
  const S = 470;
  const cs = Math.cos(0.3);
  const sn = Math.sin(0.3);
  const wx = x + 150 * (fbm(x / 1100, z / 1100, 2, 131) - 0.5);
  const wz = z + 150 * (fbm(x / 1100, z / 1100, 2, 137) - 0.5);
  const gx = (cs * wx - sn * wz) / S;
  const gz = (sn * wx + cs * wz) / (S * 0.82);
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  let d1 = 9;
  let d2 = 9;
  let id = 0;
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const cx = ix + di + 0.18 + 0.64 * hash2(ix + di, iz + dj, 201);
      const cz = iz + dj + 0.18 + 0.64 * hash2(ix + di, iz + dj, 207);
      const d = Math.max(Math.abs(gx - cx), Math.abs(gz - cz));
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = hash2(ix + di, iz + dj, 77);
      } else if (d < d2) d2 = d;
    }
  }
  return { tint: FIELD_TINTS[Math.floor(id * FIELD_TINTS.length)], border: d2 - d1 };
}

export const ROADS = [
  // 南门出来，经戏马台东边，沿云龙山东脚往南
  [[0, 640], [70, 900], [120, 1180], [-60, 1700], [-190, 2500], [-90, 3400], [160, 4200], [420, 4900]],
  // 西门出来往西（去南京、汴京的路）
  [[-640, 0], [-1500, 120], [-2900, 380], [-4600, 560], [-6900, 820]],
];

/**
 * 上底色。返回 RGBA 字节（sRGB）：RGB 是颜色，A 是“这里有没有田”（细的田垄在着色器里画）。
 * 每格 10 米。
 */
export function paintMacro(td) {
  const S = 2;
  const w = (td.nx - 1) * S + 1;
  const hgt = (td.nz - 1) * S + 1;
  const out = new Uint8Array(w * hgt * 4);
  const step = CELL / S;
  const C = Object.fromEntries(Object.entries(PAL).map(([k, v]) => [k, hex(v)]));
  const W = WALLRECT;
  const roads = ROADS.map((r) => densify(r, 80));
  const roadDist = (x, z) => {
    let d = 1e9;
    for (const r of roads) for (let s = 0; s < r.length - 1; s++) d = Math.min(d, distSeg(x, z, r[s][0], r[s][1], r[s + 1][0], r[s + 1][1]));
    return d;
  };
  // 路只在两条窄带里，先粗筛
  const roadBox = roads.map((r) => ({
    x0: Math.min(...r.map((p) => p[0])) - 40,
    x1: Math.max(...r.map((p) => p[0])) + 40,
    z0: Math.min(...r.map((p) => p[1])) - 40,
    z1: Math.max(...r.map((p) => p[1])) + 40,
  }));

  for (let j = 0; j < hgt; j++) {
    const z = CROP.z0 + j * step;
    for (let i = 0; i < w; i++) {
      const x = CROP.x0 + i * step;
      const h = td.sample(x, z);
      const e = td.sampleEdge(x, z);
      const cv = td.sampleCurv(x, z);
      const n1 = fbm(x / 1700, z / 1700, 4, 3);
      const n2 = fbm(x / 380, z / 380, 4, 9);
      const n3 = fbm(x / 950, z / 950, 3, 21);
      const r = h - 40;

      // 平地
      let col = mix3(C.tea, C.teaWarm, smoothstep(0.3, 0.75, n1));
      col = mix3(col, C.ochre, smoothstep(0.56, 0.9, n2) * 0.1);
      // 河边、洼地带一点草色
      const meadow = Math.max(smoothstep(39.5, 38.3, h), (1 - smoothstep(70, 560, e)) * 0.7) * smoothstep(0.28, 0.6, n3);
      col = mix3(col, C.meadow, meadow * 0.78);

      // 山：山脚赭石，山腰石绿，山顶石青；沟里压一点深赭，脊上提亮
      const rr = r + (n2 - 0.5) * 8 + cv * 1.4;
      const tFoot = smoothstep(2.4, 8, rr);
      col = mix3(col, C.ochre, tFoot * 0.9);
      const tGreen = smoothstep(7, 22, rr);
      col = mix3(col, mix3(C.shilu, C.shiluDeep, smoothstep(0.35, 0.8, n2)), tGreen);
      const tBlue = smoothstep(40, 84, rr);
      col = mix3(col, C.shiqing, tBlue);
      col = mix3(col, C.shiqingDeep, smoothstep(88, 125, rr) * 0.8);
      // 皴：顺着坡往下的细纹，深的是赭，浅的是留出的底色
      if (tFoot > 0.02) {
        const gx = (td.sample(x + 40, z) - td.sample(x - 40, z)) / 80;
        const gz = (td.sample(x, z + 40) - td.sample(x, z - 40)) / 80;
        const gl = Math.hypot(gx, gz);
        if (gl > 0.004) {
          const ux = gx / gl;
          const uz = gz / gl;
          const st = fbm((-x * uz + z * ux) / 24, (x * ux + z * uz) / 280, 3, 61);
          const sk = smoothstep(0.02, 0.14, gl) * tFoot;
          col = mix3(col, C.ochreDeep, smoothstep(0.55, 0.78, st) * sk * (0.5 - 0.22 * tBlue));
          col = mix3(col, [250, 246, 228], smoothstep(0.45, 0.22, st) * sk * 0.2);
        }
      }
      const gully = smoothstep(0.4, 3.0, -cv) * tFoot;
      col = mix3(col, C.ochreDeep, gully * (0.6 - 0.3 * tBlue));
      const crest = smoothstep(0.5, 3.2, cv) * tGreen;
      col = mix3(col, [255, 250, 232], crest * 0.2);

      // 河岸留白，水底淡花青
      if (e < 46) {
        col = mix3(col, C.sand, smoothstep(46, 6, e) * 0.85);
        if (e < 8) col = mix3(col, C.bed, smoothstep(8, -26, e));
      }

      // 城里城外先算好：田、路都要用
      const dOut = sdBox(x, z, W.x0, W.x1, W.z0, W.z1);
      const inCity = 1 - smoothstep(-30, 10, dOut);
      const edgeD = Math.min(x - CROP.x0, CROP.x1 - x, z - CROP.z0, CROP.z1 - z);
      const fade = 1 - smoothstep(40, 380 + n3 * 420, edgeD);

      // 路：比平地深一点的赭色细线（浅色的路远看像划痕）
      let onRoad = 0;
      if (roadBox.some((b) => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1)) {
        onRoad = 1 - smoothstep(9, 24, roadDist(x, z));
      }

      // 远看的田：四五百米一块的不规则大田块，三种浅色轮着上，块和块之间留一道底色
      const plain = (1 - smoothstep(1.2, 3.2, rr)) * smoothstep(30, 90, e) * (1 - inCity) * smoothstep(30, 110, dOut) * (1 - fade);
      let fieldMask = 0;
      if (plain > 0.01) {
        const fc = fieldCell(x, z);
        const spread = smoothstep(0.3, 0.46, fbm(x / 2300, z / 2300, 3, 143));
        const gap = smoothstep(0.02, 0.07, fc.border);
        const k = plain * spread * gap * (fc.tint ? 1 : 0);
        if (k > 0) col = mix3(col, C[fc.tint], k * 0.82);
        fieldMask = k;
      }
      if (onRoad > 0) col = mix3(col, C.path, onRoad * 0.6 * (1 - inCity));

      // 城里：浅灰黄的地，十字大街和几条小巷
      if (inCity > 0) {
        let g = C.cityGround;
        const main = Math.min(Math.abs(x), Math.abs(z));
        g = mix3(g, C.road, 1 - smoothstep(13, 22, main));
        const lane = Math.min(Math.abs(((x + 2000) % 200) - 100), Math.abs(((z + 2000) % 150) - 75));
        g = mix3(g, C.road, (1 - smoothstep(4, 10, lane)) * 0.55);
        col = mix3(col, g, inCity);
      }

      // 画心四边留出空绢
      col = mix3(col, C.blank, fade * 0.62 * (1 - tFoot));

      // 一点手工上色的不匀
      const grain = (hash2(i, j, 5) - 0.5) * 5 + (fbm(x / 70, z / 70, 2, 31) - 0.5) * 9;
      col = [col[0] + grain, col[1] + grain, col[2] + grain * 0.9];

      // 近看的田垄只画在上了色的田块里（着色器里画）
      const field = fieldMask * (1 - onRoad);

      const k = (j * w + i) * 4;
      out[k] = clamp(Math.round(col[0]), 0, 255);
      out[k + 1] = clamp(Math.round(col[1]), 0, 255);
      out[k + 2] = clamp(Math.round(col[2]), 0, 255);
      out[k + 3] = clamp(Math.round(field * 255), 0, 255);
    }
  }
  return { data: out, w, h: hgt };
}

/** 法线图（物体空间，y 向上），山的起伏按 ex 倍算 */
export function bakeNormals(td, ex) {
  const { nx, nz, h } = td;
  const out = new Uint8Array(nx * nz * 4);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const l = h[j * nx + Math.max(0, i - 1)];
      const r = h[j * nx + Math.min(nx - 1, i + 1)];
      const u = h[Math.max(0, j - 1) * nx + i];
      const d = h[Math.min(nz - 1, j + 1) * nx + i];
      let vx = (-(r - l) / (2 * CELL)) * ex;
      let vz = (-(d - u) / (2 * CELL)) * ex;
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

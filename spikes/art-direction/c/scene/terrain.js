// 沙盘的地：把今天的高程抹平、压低平地、挖出河床、垫平城里，再画出地表的颜色。
// 横向单位：1 = 100 米。竖向夸大 EXAG 倍。
import * as THREE from 'three';
import { toLocal, CITY, PLACES, RIVERS, DIKE } from '../../shared/scene-data.js';
import { mulberry32, makeNoise, clamp, lerp, smoothstep, distPolyline, distSeg, smoothLine, hexToRgb } from './util.js';
import { PAL } from './palette.js';

export const U = 0.01; // 米 → 场景单位
export const EXAG = 6; // 竖向夸大倍数
export const BASE_M = 30; // y = 0 对应的海拔
export const TABLE_M = { minX: -6000, maxX: 5600, minZ: -5500, maxZ: 4600 };
export const LEVELS_M = { river: 35.0, flood: 42.0, city: 39.4, bed: 31.2 };
export const SLAB_BOTTOM = -7.2; // 土层切面的底

export const yOf = (hM) => (hM - BASE_M) * EXAG * U;

const cw = toLocal(CITY.west, CITY.north);
const ce = toLocal(CITY.east, CITY.south);
export const CITY_M = { minX: cw.x, maxX: ce.x, minZ: cw.z, maxZ: ce.z };

export const placeM = (id) => {
  const p = PLACES.find((q) => q.id === id);
  const l = toLocal(p.lng, p.lat);
  return [l.x, l.z];
};

const XIMATAI = placeM('ximatai');
export const XIMATAI_KNOLL = { h: 14, r: 200 }; // 土山的高和半径（米，示意）
const FANGHE = placeM('fangheting');
const YUNLONG = placeM('yunlongshan');
// 城南到戏马台、再接到云龙山北头的一条高地（示意）：正文说只有城南走得了车马。
const TONGUE = [
  [0, CITY_M.maxZ - 40],
  [XIMATAI[0] + 20, XIMATAI[1]],
  [-330, 1500],
  [FANGHE[0], FANGHE[1]],
];
export const DIKE_M = DIKE.map(([lng, lat]) => {
  const l = toLocal(lng, lat);
  return [l.x, l.z];
});
// 堤里面护住的一小块（城东南角外）
const DRY_POLY = [
  [-140, DIKE_M[0][1] + 10],
  [DIKE_M[0][0], DIKE_M[0][1]],
  [DIKE_M[1][0], DIKE_M[1][1]],
  [DIKE_M[2][0], DIKE_M[2][1]],
  [DIKE_M[2][0], CITY_M.maxZ - 30],
  [-140, CITY_M.maxZ - 30],
];

function inPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const zi = poly[i][1];
    const xj = poly[j][0];
    const zj = poly[j][1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function citySD(x, z) {
  const dx = Math.max(CITY_M.minX - x, x - CITY_M.maxX);
  const dz = Math.max(CITY_M.minZ - z, z - CITY_M.maxZ);
  if (dx <= 0 && dz <= 0) return Math.max(dx, dz);
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
}

/** 河道中线：过示意折线的平滑曲线，城外的河段加一点弯。 */
function buildRivers() {
  const spec = {
    bian: { hw: 78, amp: 120, wave: 2700, phase: 0.6, taper: 'end' },
    si: { hw: 96, amp: 95, wave: 2300, phase: 2.1, taper: 'end' },
    joined: { hw: 128, amp: 110, wave: 3000, phase: 4.0, taper: 'start' },
  };
  const out = {};
  for (const key of Object.keys(spec)) {
    const s = spec[key];
    const raw = RIVERS[key].path.map(([lng, lat]) => {
      const l = toLocal(lng, lat);
      return [l.x, l.z];
    });
    const dense = smoothLine(raw, 40);
    // 弧长
    const acc = [0];
    for (let i = 1; i < dense.length; i++) acc.push(acc[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
    const total = acc[acc.length - 1];
    const pts = dense.map((p, i) => {
      const a = dense[Math.max(0, i - 1)];
      const b = dense[Math.min(dense.length - 1, i + 1)];
      let tx = b[0] - a[0];
      let tz = b[1] - a[1];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      const sFromCity = s.taper === 'end' ? total - acc[i] : acc[i];
      const w = smoothstep(1500, 3200, sFromCity);
      const off = w * s.amp * (Math.sin((acc[i] / s.wave) * Math.PI * 2 + s.phase) + 0.35 * Math.sin((acc[i] / s.wave) * Math.PI * 4.6 + s.phase * 2));
      return [p[0] - tz * off, p[1] + tx * off];
    });
    out[key] = { pts, hw: s.hw, name: RIVERS[key].name };
  }
  return out;
}

function boxBlur(src, w, h, rad, passes = 2) {
  let a = src;
  let b = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    for (let r = 0; r < h; r++) {
      let s = 0;
      let n = 0;
      for (let c = 0; c <= rad && c < w; c++) {
        s += a[r * w + c];
        n++;
      }
      for (let c = 0; c < w; c++) {
        b[r * w + c] = s / n;
        const add = c + rad + 1;
        const rem = c - rad;
        if (add < w) {
          s += a[r * w + add];
          n++;
        }
        if (rem >= 0) {
          s -= a[r * w + rem];
          n--;
        }
      }
    }
    const t = new Float32Array(src.length);
    for (let c = 0; c < w; c++) {
      let s = 0;
      let n = 0;
      for (let r = 0; r <= rad && r < h; r++) {
        s += b[r * w + c];
        n++;
      }
      for (let r = 0; r < h; r++) {
        t[r * w + c] = s / n;
        const add = r + rad + 1;
        const rem = r - rad;
        if (add < h) {
          s += b[add * w + c];
          n++;
        }
        if (rem >= 0) {
          s -= b[rem * w + c];
          n--;
        }
      }
    }
    a = t;
  }
  return a;
}

/** 处理高程，返回地形数据和取样函数。 */
export function buildTerrainData(dem) {
  const { meta } = dem;
  const C = meta.cols;
  const R = meta.rows;
  const blurred = boxBlur(dem.heights, C, R, 2, 2);

  // 三次 B 样条取样：比双线性更圆，不留格子印
  const demSmooth = (x, z) => {
    const fx = ((x - dem.minX) / (dem.maxX - dem.minX)) * (C - 1);
    const fz = ((z - dem.minZ) / (dem.maxZ - dem.minZ)) * (R - 1);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const wx = [((1 - tx) ** 3) / 6, (3 * tx ** 3 - 6 * tx ** 2 + 4) / 6, (-3 * tx ** 3 + 3 * tx ** 2 + 3 * tx + 1) / 6, tx ** 3 / 6];
    const wz = [((1 - tz) ** 3) / 6, (3 * tz ** 3 - 6 * tz ** 2 + 4) / 6, (-3 * tz ** 3 + 3 * tz ** 2 + 3 * tz + 1) / 6, tz ** 3 / 6];
    let s = 0;
    for (let j = 0; j < 4; j++) {
      const rr = clamp(iz - 1 + j, 0, R - 1);
      let row = 0;
      for (let i = 0; i < 4; i++) {
        const cc = clamp(ix - 1 + i, 0, C - 1);
        row += blurred[rr * C + cc] * wx[i];
      }
      s += row * wz[j];
    }
    return s;
  };

  const rivers = buildRivers();
  const detailNoise = makeNoise(57);
  const T = TABLE_M;
  const W = T.maxX - T.minX;
  const H = T.maxZ - T.minZ;

  // 离水边的距离（米，水里为负），先在 25 米的粗格上算
  const CS = 25;
  const NXc = Math.round(W / CS) + 1;
  const NZc = Math.round(H / CS) + 1;
  const sdc = new Float32Array(NXc * NZc).fill(400);
  const RADIUS = 330;
  for (const key of Object.keys(rivers)) {
    const { pts, hw } = rivers[key];
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0];
      const az = pts[i][1];
      const bx = pts[i + 1][0];
      const bz = pts[i + 1][1];
      const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - RADIUS - hw - T.minX) / CS));
      const c1 = Math.min(NXc - 1, Math.ceil((Math.max(ax, bx) + RADIUS + hw - T.minX) / CS));
      const r0 = Math.max(0, Math.floor((Math.min(az, bz) - RADIUS - hw - T.minZ) / CS));
      const r1 = Math.min(NZc - 1, Math.ceil((Math.max(az, bz) + RADIUS + hw - T.minZ) / CS));
      const dx = bx - ax;
      const dz = bz - az;
      const l2 = dx * dx + dz * dz || 1;
      for (let r = r0; r <= r1; r++) {
        const pz = T.minZ + r * CS;
        for (let c = c0; c <= c1; c++) {
          const px = T.minX + c * CS;
          let t = ((px - ax) * dx + (pz - az) * dz) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const d = Math.hypot(ax + dx * t - px, az + dz * t - pz) - hw;
          const k = r * NXc + c;
          if (d < sdc[k]) sdc[k] = d;
        }
      }
    }
  }
  const riverSD = (x, z) => {
    const fx = clamp((x - T.minX) / CS, 0, NXc - 1.001);
    const fz = clamp((z - T.minZ) / CS, 0, NZc - 1.001);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const ax = fx - ix;
    const az = fz - iz;
    const k = iz * NXc + ix;
    return sdc[k] * (1 - ax) * (1 - az) + sdc[k + 1] * ax * (1 - az) + sdc[k + NXc] * (1 - ax) * az + sdc[k + NXc + 1] * ax * az;
  };

  // 细格：12.5 米
  const STEP = 12.5;
  const NX = Math.round(W / STEP) + 1;
  const NZ = Math.round(H / STEP) + 1;
  const hM = new Float32Array(NX * NZ); // 处理后的“海拔”（米，未夸大）
  const prot = new Float32Array(NX * NZ); // 墙和堤护住、水进不来的地方
  const L = LEVELS_M;
  const edgeM = L.river - 0.35;
  const BANK = 115;
  for (let r = 0; r < NZ; r++) {
    const z = T.minZ + r * STEP;
    for (let c = 0; c < NX; c++) {
      const x = T.minX + c * STEP;
      const h0 = demSmooth(x, z);
      // 平地压扁，山照原样
      const plain = Math.max(36.3, 37 + (h0 - 30) * 0.25);
      const hill = h0 - 3.5;
      const k = 1.6;
      let h = Math.max(plain, hill) + k * Math.log(1 + Math.exp(-Math.abs(plain - hill) / k));
      // 山上加一点沟和脊：高程抹平以后山太圆，像面团
      const hillAmt = smoothstep(42, 52, h);
      if (hillAmt > 0) {
        const r1 = 1 - Math.abs(2 * detailNoise.fbm(x / 300, z / 300, 3) - 1);
        const r2 = 1 - Math.abs(2 * detailNoise(x / 95 + 7.3, z / 95 - 3.1) - 1);
        h += hillAmt * ((r1 - 0.55) * 9.5 + (r2 - 0.5) * 3.2);
      }
      // 城南的高地和戏马台的土山
      const dT = distPolyline(x, z, TONGUE);
      const tT = smoothstep(430, 140, dT);
      if (tT > 0) h += tT * Math.max(0, 44.0 - h);
      const dm = Math.hypot(x - XIMATAI[0], z - XIMATAI[1]);
      h += XIMATAI_KNOLL.h * Math.exp(-((dm / XIMATAI_KNOLL.r) ** 2));
      // 河床
      const sd = riverSD(x, z);
      if (sd < BANK) {
        if (sd <= 0) {
          const q = smoothstep(0, 70, -sd);
          h = lerp(edgeM, L.bed, q);
        } else {
          const t = sd / BANK;
          const e = 1 - (1 - t) * (1 - t);
          h = lerp(edgeM, h, e * e * (3 - 2 * e));
        }
      }
      // 城里垫平
      const sC = citySD(x, z);
      const tC = smoothstep(80, 30, sC);
      if (tC > 0) h = lerp(h, L.city, tC);
      hM[r * NX + c] = h;
      prot[r * NX + c] = sC < 8 || inPoly(x, z, DRY_POLY) ? 1 : 0;
    }
  }

  const hY = new Float32Array(NX * NZ);
  for (let i = 0; i < hY.length; i++) hY[i] = yOf(hM[i]);

  const sampleGrid = (arr, x, z) => {
    const fx = clamp((x - T.minX) / STEP, 0, NX - 1.001);
    const fz = clamp((z - T.minZ) / STEP, 0, NZ - 1.001);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const ax = fx - ix;
    const az = fz - iz;
    const k = iz * NX + ix;
    return arr[k] * (1 - ax) * (1 - az) + arr[k + 1] * ax * (1 - az) + arr[k + NX] * (1 - ax) * az + arr[k + NX + 1] * ax * az;
  };

  // 坡度（未夸大）和简单的环境遮蔽
  const slope = new Float32Array(NX * NZ);
  for (let r = 0; r < NZ; r++) {
    for (let c = 0; c < NX; c++) {
      const xl = hM[r * NX + Math.max(0, c - 1)];
      const xr = hM[r * NX + Math.min(NX - 1, c + 1)];
      const zu = hM[Math.max(0, r - 1) * NX + c];
      const zd = hM[Math.min(NZ - 1, r + 1) * NX + c];
      slope[r * NX + c] = Math.hypot(xr - xl, zd - zu) / (2 * STEP);
    }
  }
  const blurA = boxBlur(hY, NX, NZ, 10, 2);
  const blurB = boxBlur(hY, NX, NZ, 28, 2);
  const ao = new Float32Array(NX * NZ);
  for (let i = 0; i < ao.length; i++) {
    const a = blurA[i] - hY[i];
    const b = blurB[i] - hY[i];
    ao[i] = clamp(1 - Math.max(0, a) * 0.7 - Math.max(0, b) * 0.08 + Math.max(0, -a) * 0.28, 0.8, 1.08);
  }

  // 每座山自己的“相对高度”：附近最高处是 1，山脚是 0。粗格上做一次最大值滤波。
  const Q = 4;
  const NXq = Math.ceil(NX / Q);
  const NZq = Math.ceil(NZ / Q);
  const hq = new Float32Array(NXq * NZq);
  for (let r = 0; r < NZq; r++) for (let c = 0; c < NXq; c++) hq[r * NXq + c] = hM[Math.min(NZ - 1, r * Q) * NX + Math.min(NX - 1, c * Q)];
  const RAD = 14; // 约 700 米
  const tmpq = new Float32Array(NXq * NZq);
  for (let r = 0; r < NZq; r++) {
    for (let c = 0; c < NXq; c++) {
      let m = 0;
      for (let k = Math.max(0, c - RAD); k <= Math.min(NXq - 1, c + RAD); k++) m = Math.max(m, hq[r * NXq + k]);
      tmpq[r * NXq + c] = m;
    }
  }
  const peakq = new Float32Array(NXq * NZq);
  for (let r = 0; r < NZq; r++) {
    for (let c = 0; c < NXq; c++) {
      let m = 0;
      for (let k = Math.max(0, r - RAD); k <= Math.min(NZq - 1, r + RAD); k++) m = Math.max(m, tmpq[k * NXq + c]);
      peakq[r * NXq + c] = m;
    }
  }
  const peakS = boxBlur(peakq, NXq, NZq, 4, 2);
  const peakAtM = (x, z) => {
    const fx = clamp((x - T.minX) / (STEP * Q), 0, NXq - 1.001);
    const fz = clamp((z - T.minZ) / (STEP * Q), 0, NZq - 1.001);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const ax = fx - ix;
    const az = fz - iz;
    const k = iz * NXq + ix;
    return peakS[k] * (1 - ax) * (1 - az) + peakS[k + 1] * ax * (1 - az) + peakS[k + NXq] * (1 - ax) * az + peakS[k + NXq + 1] * ax * az;
  };

  return {
    NX,
    NZ,
    STEP,
    hM,
    hY,
    prot,
    slope,
    ao,
    rivers,
    riverSD,
    citySD,
    /** 场景单位的高度，x、z 用米 */
    yAtM: (x, z) => sampleGrid(hY, x, z),
    hAtM: (x, z) => sampleGrid(hM, x, z),
    slopeAtM: (x, z) => sampleGrid(slope, x, z),
    aoAtM: (x, z) => sampleGrid(ao, x, z),
    peakAtM,
    tongue: TONGUE,
    dryPoly: DRY_POLY,
  };
}

/** 高度和“护住”的贴图，给水面用。 */
export function makeHeightTexture(td) {
  const { NX, NZ, hY, prot } = td;
  const data = new Uint16Array(NX * NZ * 2);
  for (let i = 0; i < NX * NZ; i++) {
    data[i * 2] = THREE.DataUtils.toHalfFloat(hY[i]);
    data[i * 2 + 1] = THREE.DataUtils.toHalfFloat(prot[i]);
  }
  const tex = new THREE.DataTexture(data, NX, NZ, THREE.RGFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export function makeNormalTexture(td) {
  const { NX, NZ, hY, STEP } = td;
  const data = new Uint8Array(NX * NZ * 4);
  const d = STEP * U;
  for (let r = 0; r < NZ; r++) {
    for (let c = 0; c < NX; c++) {
      const xl = hY[r * NX + Math.max(0, c - 1)];
      const xr = hY[r * NX + Math.min(NX - 1, c + 1)];
      const zu = hY[Math.max(0, r - 1) * NX + c];
      const zd = hY[Math.min(NZ - 1, r + 1) * NX + c];
      let nx = -(xr - xl) / (2 * d);
      let nz = -(zd - zu) / (2 * d);
      let ny = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l;
      ny /= l;
      nz /= l;
      const i = (r * NX + c) * 4;
      data[i] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, NX, NZ, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.repeat.set((NX - 1) / NX, (NZ - 1) / NZ);
  tex.offset.set(0.5 / NX, 0.5 / NZ);
  tex.needsUpdate = true;
  return tex;
}

// 树林的疏密（0..1），地表上色和种树共用
const forestNoise = makeNoise(77);
export const forestDensity = (x, z) => forestNoise.fbm(x / 620, z / 620, 3);

/** 路（米）：出南门到戏马台，再往南；往西去南京的路从戏马台北边岔出去。示意。 */
export const ROADS_M = [
  smoothLine(
    [
      [0, CITY_M.maxZ + 10],
      [-20, 760],
      [-300, 960],
      [-330, 1500],
      [-200, 2300],
      [-60, 3200],
      [150, 4100],
      [260, 4900],
    ],
    60,
  ),
  smoothLine(
    [
      [-300, 960],
      [-760, 990],
      [-1700, 720],
      [-3200, 520],
      [-5000, 180],
      [-6800, -150],
    ],
    60,
  ),
];

/** 地表颜色：田块、山坡、河滩、城里的地、路。画在一张画布上。 */
export function makeAlbedoTexture(td, footprints = [], seed = 11) {
  const T = TABLE_M;
  const W = T.maxX - T.minX;
  const H = T.maxZ - T.minZ;
  const TW = 2048;
  const TH = Math.round((TW * H) / W);
  const pxPerM = TW / W;
  const canvas = document.createElement('canvas');
  canvas.width = TW;
  canvas.height = TH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rnd = mulberry32(seed);
  const nA = makeNoise(seed + 1);
  const nB = makeNoise(seed + 2);
  const nC = makeNoise(seed + 3);

  // 1. 田块
  ctx.fillStyle = PAL.fieldMid;
  ctx.fillRect(0, 0, TW, TH);
  const cell = 118;
  const cols = Math.ceil(TW / cell) + 2;
  const rows = Math.ceil(TH / cell) + 2;
  const corners = [];
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      corners.push([(i - 1 + (rnd() - 0.5) * 0.5) * cell, (j - 1 + (rnd() - 0.5) * 0.5) * cell]);
    }
  }
  const P = (i, j) => corners[j * (cols + 1) + i];
  const wheat = [PAL.fieldWheat, PAL.fieldStraw, PAL.fieldWheat, PAL.fieldStraw];
  const green = [PAL.fieldLight, PAL.fieldLight, PAL.fieldLight, PAL.fieldMid, PAL.fieldMid, PAL.fieldDeep];
  const tint = (hex, k) => {
    const [r, g, b] = hexToRgb(hex);
    return `rgb(${Math.round(clamp(r * k, 0, 255))},${Math.round(clamp(g * k, 0, 255))},${Math.round(clamp(b * k, 0, 255))})`;
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const q = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)];
      const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4;
      const cz = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
      const pWheat = 0.04 + 0.7 * smoothstep(0.5, 0.68, nA.fbm(cx / 420, cz / 420, 2));
      let ang = (nB(cx / 900, cz / 900) - 0.5) * 1.4;
      if (rnd() < 0.45) ang += Math.PI / 2;
      ang += (rnd() - 0.5) * 0.2;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(q[0][0], q[0][1]);
      for (let k = 1; k < 4; k++) ctx.lineTo(q[k][0], q[k][1]);
      ctx.closePath();
      ctx.clip();
      ctx.translate(cx, cz);
      ctx.rotate(ang);
      const Rr = cell * 1.25;
      let y = -Rr;
      while (y < Rr) {
        const w = 8 + rnd() * 13;
        const pick = () => {
          const set = rnd() < pWheat ? wheat : green;
          let col = set[Math.floor(rnd() * set.length)];
          if (rnd() < 0.05) col = PAL.fieldFallow;
          return tint(col, 0.975 + rnd() * 0.05);
        };
        if (rnd() < 0.4) {
          let x = -Rr;
          while (x < Rr) {
            const l = cell * (0.35 + rnd() * 0.8);
            ctx.fillStyle = pick();
            ctx.fillRect(x, y, l + 0.5, w + 0.5);
            ctx.fillStyle = 'rgba(240,232,204,0.4)';
            ctx.fillRect(x + l - 0.5, y, 1, w);
            x += l;
          }
        } else {
          ctx.fillStyle = pick();
          ctx.fillRect(-Rr, y, Rr * 2, w + 0.5);
        }
        ctx.fillStyle = 'rgba(240,232,204,0.42)';
        ctx.fillRect(-Rr, y + w - 0.5, Rr * 2, 1);
        y += w;
      }
      ctx.restore();
      ctx.strokeStyle = 'rgba(232,222,190,0.75)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(q[0][0], q[0][1]);
      for (let k = 1; k < 4; k++) ctx.lineTo(q[k][0], q[k][1]);
      ctx.closePath();
      ctx.stroke();
    }
  }

  // 2. 山坡、河滩、河床：逐点上色
  const img = ctx.getImageData(0, 0, TW, TH);
  const px = img.data;
  const grass = hexToRgb(PAL.hillGrass);
  const dry = hexToRgb(PAL.hillDry);
  const rock = hexToRgb(PAL.rock);
  const rockL = hexToRgb(PAL.rockLight);
  const woods = hexToRgb(PAL.woodsFloor);
  const sand = hexToRgb(PAL.sand);
  const sandWet = hexToRgb(PAL.sandWet);
  const bed = hexToRgb(PAL.riverBed);
  const mound = hexToRgb('#BFA772');
  const mix3 = (o, i, c, t) => {
    o[i] = o[i] + (c[0] - o[i]) * t;
    o[i + 1] = o[i + 1] + (c[1] - o[i + 1]) * t;
    o[i + 2] = o[i + 2] + (c[2] - o[i + 2]) * t;
  };
  const tmp = [0, 0, 0];
  for (let j = 0; j < TH; j++) {
    const z = T.minZ + ((j + 0.5) / TH) * H;
    for (let i = 0; i < TW; i++) {
      const x = T.minX + ((i + 0.5) / TW) * W;
      const k = (j * TW + i) * 4;
      const h = td.hAtM(x, z);
      const sd = td.riverSD(x, z);
      const n1 = nC.fbm(x / 160, z / 160, 3);
      // 山
      const g = smoothstep(40.9, 43.4, h + (n1 - 0.5) * 1.6);
      if (g > 0) {
        const sl = td.slopeAtM(x, z);
        const n2 = nA.fbm(x / 38, z / 38, 2);
        const f = forestDensity(x, z);
        tmp[0] = lerp(grass[0], dry[0], smoothstep(0.35, 0.7, n1));
        tmp[1] = lerp(grass[1], dry[1], smoothstep(0.35, 0.7, n1));
        tmp[2] = lerp(grass[2], dry[2], smoothstep(0.35, 0.7, n1));
        const fw = smoothstep(0.5, 0.64, f) * (1 - smoothstep(0.2, 0.34, sl)) * 0.6;
        tmp[0] = lerp(tmp[0], woods[0], fw);
        tmp[1] = lerp(tmp[1], woods[1], fw);
        tmp[2] = lerp(tmp[2], woods[2], fw);
        const peak = td.peakAtM(x, z);
        const rel = peak > 60 ? clamp((h - 44) / (peak - 44), 0, 1) : 0;
        // 越陡、越靠近山顶，露出来的石头越多；一小块一小块的，边是硬的（“满冈乱石”）
        // 云龙山的黄茅冈是正文点了名的，石头再多给一些
        const yl = smoothstep(750, 250, distSeg(x, z, YUNLONG[0], YUNLONG[1] - 1000, YUNLONG[0], YUNLONG[1] + 700)) * smoothstep(0.2, 0.5, rel);
        const cover = clamp(0.52 * smoothstep(0.38, 0.95, rel) + 0.5 * smoothstep(0.2, 0.42, sl) + 0.2 * yl, 0, 0.6);
        if (cover > 0.02) {
          const v = 0.62 * nB(x / 13 + 1.7, z / 13 - 4.2) + 0.38 * nB.fbm(x / 60, z / 60, 2);
          const thr = lerp(0.8, 0.46, cover / 0.6);
          const rk = smoothstep(thr - 0.018, thr + 0.018, v) * 0.95;
          if (rk > 0) {
            const lightK = smoothstep(0.47, 0.5, nC(x / 9 + 3.3, z / 9 - 8.1));
            tmp[0] = lerp(tmp[0], lerp(rock[0], rockL[0], lightK), rk);
            tmp[1] = lerp(tmp[1], lerp(rock[1], rockL[1], lightK), rk);
            tmp[2] = lerp(tmp[2], lerp(rock[2], rockL[2], lightK), rk);
          }
        }
        mix3(px, k, tmp, g);
      }
      // 戏马台的土山：坡上是黄茅和夯土的颜色
      {
        const dxm = Math.hypot(x - XIMATAI[0], z - XIMATAI[1]);
        if (dxm < 300) {
          const t = smoothstep(290, 150, dxm + (n1 - 0.5) * 70);
          mix3(px, k, mound, t * 0.82);
        }
      }
      // 河滩和河床
      if (sd < 110) {
        if (sd > 0) {
          const sb = smoothstep(95 + (n1 - 0.5) * 60, 8, sd);
          mix3(px, k, sand, sb * 0.95);
          mix3(px, k, sandWet, smoothstep(22, 0, sd) * 0.8);
        } else {
          const q = smoothstep(0, 70, -sd);
          tmp[0] = lerp(sandWet[0], bed[0], q);
          tmp[1] = lerp(sandWet[1], bed[1], q);
          tmp[2] = lerp(sandWet[2], bed[2], q);
          mix3(px, k, tmp, 1);
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);

  // 3. 路、城里的地
  const toPx = (x, z) => [(x - T.minX) * pxPerM, (z - T.minZ) * pxPerM];
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const road of ROADS_M) {
    for (const [lw, col] of [
      [6.5, 'rgba(150,130,92,0.34)'],
      [3.6, PAL.road],
    ]) {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.beginPath();
      road.forEach(([x, z], i) => {
        const [a, b] = toPx(x, z);
        if (i === 0) ctx.moveTo(a, b);
        else ctx.lineTo(a, b);
      });
      ctx.stroke();
    }
  }
  {
    const [x0, z0] = toPx(CITY_M.minX - 34, CITY_M.minZ - 34);
    const [x1, z1] = toPx(CITY_M.maxX + 34, CITY_M.maxZ + 34);
    ctx.fillStyle = PAL.cityGround;
    ctx.filter = 'blur(2px)';
    ctx.fillRect(x0, z0, x1 - x0, z1 - z0);
    ctx.filter = 'none';
    // 街
    ctx.strokeStyle = PAL.street;
    const line = (ax, az, bx, bz, w) => {
      const [a, b] = toPx(ax, az);
      const [c, d] = toPx(bx, bz);
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(a, b);
      ctx.lineTo(c, d);
      ctx.stroke();
    };
    line(CITY_M.minX, 0, CITY_M.maxX, 0, 6);
    line(0, CITY_M.minZ, 0, CITY_M.maxZ, 6);
    for (const s of CITY_STREETS.x) line(s, CITY_M.minZ + 40, s, CITY_M.maxZ - 40, 3);
    for (const s of CITY_STREETS.z) line(CITY_M.minX + 40, s, CITY_M.maxX - 40, s, 3);
  }

  // 3b. 房子和城墙脚下压一圈淡淡的暗，让模型像是“坐”在地上
  {
    // 先把所有房基画到另一张画布上，再整张模糊一次贴过来（逐个模糊太慢）
    const tmpC = document.createElement('canvas');
    tmpC.width = TW;
    tmpC.height = TH;
    const tc = tmpC.getContext('2d');
    tc.fillStyle = 'rgb(70,58,44)';
    for (const f of footprints) {
      const [a, b] = toPx(f.x / U, f.z / U);
      tc.save();
      tc.translate(a, b);
      tc.rotate(-f.ry);
      const w = (f.w / U) * pxPerM + 2.4;
      const d = (f.d / U) * pxPerM + 2.4;
      tc.fillRect(-w / 2, -d / 2, w, d);
      tc.restore();
    }
    ctx.save();
    ctx.filter = 'blur(1.6px)';
    ctx.globalAlpha = 0.3;
    ctx.drawImage(tmpC, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = 'blur(3px)';
    ctx.strokeStyle = 'rgba(70,58,44,0.42)';
    ctx.lineWidth = 9;
    const [x0, z0] = toPx(CITY_M.minX, CITY_M.minZ);
    const [x1, z1] = toPx(CITY_M.maxX, CITY_M.maxZ);
    ctx.strokeRect(x0, z0, x1 - x0, z1 - z0);
    ctx.restore();
  }

  // 4. 遮蔽和大块的明暗
  const img2 = ctx.getImageData(0, 0, TW, TH);
  const p2 = img2.data;
  for (let j = 0; j < TH; j++) {
    const z = T.minZ + ((j + 0.5) / TH) * H;
    for (let i = 0; i < TW; i++) {
      const x = T.minX + ((i + 0.5) / TW) * W;
      const k = (j * TW + i) * 4;
      // 细颗粒：像模型上撒的草粉
      const gr = 0.965 + 0.07 * nC(i * 0.83 + 3.1, j * 0.83 + 7.7);
      const a = td.aoAtM(x, z) * (0.965 + 0.07 * nB.fbm(x / 900, z / 900, 2)) * gr;
      p2[k] = clamp(p2[k] * a, 0, 255);
      p2[k + 1] = clamp(p2[k + 1] * a, 0, 255);
      p2[k + 2] = clamp(p2[k + 2] * a, 0, 255);
    }
  }
  ctx.putImageData(img2, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** 城里的小街（米）。两条大街在正中，接四座城门。 */
export const CITY_STREETS = {
  x: [-400, -200, 200, 400],
  z: [-400, -200, 200, 400],
};

/** 不等距的格线：城和河附近密，远处疏。返回米。 */
function axisCoords(min, max, fineMin, fineMax, fine, coarse, blend) {
  const out = [min];
  let x = min;
  while (x < max - 1e-6) {
    const d = x < fineMin ? fineMin - x : x > fineMax ? x - fineMax : 0;
    x += lerp(fine, coarse, smoothstep(0, blend, d));
    out.push(x);
  }
  // 末一格并到边上
  out.pop();
  if (max - out[out.length - 1] < fine * 0.6) out.pop();
  out.push(max);
  return out;
}

export function buildTerrainMesh(td, material) {
  const T = TABLE_M;
  const xs = axisCoords(T.minX, T.maxX, -1300, 3300, 44, 140, 900);
  const zs = axisCoords(T.minZ, T.maxZ, -2050, 2500, 44, 140, 900);
  const nx = xs.length;
  const nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  const uv = new Float32Array(nx * nz * 2);
  const nor = new Float32Array(nx * nz * 3);
  const W = T.maxX - T.minX;
  const H = T.maxZ - T.minZ;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const y = td.yAtM(xs[i], zs[j]);
      pos[k * 3] = xs[i] * U;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = zs[j] * U;
      uv[k * 2] = (xs[i] - T.minX) / W;
      uv[k * 2 + 1] = (zs[j] - T.minZ) / H;
      const e = 30;
      const dx = (td.yAtM(xs[i] + e, zs[j]) - td.yAtM(xs[i] - e, zs[j])) / (2 * e * U);
      const dz = (td.yAtM(xs[i], zs[j] + e) - td.yAtM(xs[i], zs[j] - e)) / (2 * e * U);
      const l = Math.hypot(dx, 1, dz);
      nor[k * 3] = -dx / l;
      nor[k * 3 + 1] = 1 / l;
      nor[k * 3 + 2] = -dz / l;
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let q = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      idx[q++] = a;
      idx[q++] = c;
      idx[q++] = b;
      idx[q++] = b;
      idx[q++] = c;
      idx[q++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = 'terrain';
  return { mesh, xs, zs, triangles: idx.length / 3 };
}

/**
 * 沙盘四边的切面。每条边一圈顶点：顶上跟着地面走，底下到 SLAB_BOTTOM。
 * 属性 aDepth 是“离地面多深”，着色时用来画表土。
 * 同时返回一份“水的切面”：地面低于水位的地方，从地面到水位的一条薄片。
 */
export function buildSkirt(td, xs, zs) {
  const T = TABLE_M;
  // 逆时针一圈（从上往下看时外法线朝外）：南边 西→东，东边 南→北，北边 东→西，西边 北→南
  const edges = [
    { pts: xs.map((x) => [x, T.maxZ]), n: [0, 0, 1] },
    { pts: zs.slice().reverse().map((z) => [T.maxX, z]), n: [1, 0, 0] },
    { pts: xs.slice().reverse().map((x) => [x, T.minZ]), n: [0, 0, -1] },
    { pts: zs.map((z) => [T.minX, z]), n: [-1, 0, 0] },
  ];
  const pos = [];
  const nor = [];
  const uv = [];
  const depth = [];
  const idx = [];
  const wpos = [];
  const wnor = [];
  const wground = [];
  const wtop = [];
  const widx = [];
  let run = 0;
  for (const e of edges) {
    const base = pos.length / 3;
    const wbase = wpos.length / 3;
    e.pts.forEach(([x, z], i) => {
      if (i > 0) run += Math.hypot(x - e.pts[i - 1][0], z - e.pts[i - 1][1]) * U;
      const y = td.yAtM(x, z);
      pos.push(x * U, y, z * U, x * U, SLAB_BOTTOM, z * U);
      nor.push(...e.n, ...e.n);
      uv.push(run, y, run, SLAB_BOTTOM);
      depth.push(0, y - SLAB_BOTTOM);
      wpos.push(x * U, y, z * U, x * U, y, z * U);
      wnor.push(...e.n, ...e.n);
      wground.push(y, y);
      wtop.push(0, 1);
    });
    for (let i = 0; i < e.pts.length - 1; i++) {
      const a = base + i * 2;
      idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      const w = wbase + i * 2;
      widx.push(w, w + 2, w + 1, w + 1, w + 2, w + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  geo.setIndex(idx);
  const wgeo = new THREE.BufferGeometry();
  wgeo.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
  wgeo.setAttribute('normal', new THREE.Float32BufferAttribute(wnor, 3));
  wgeo.setAttribute('aGround', new THREE.Float32BufferAttribute(wground, 1));
  wgeo.setAttribute('aTop', new THREE.Float32BufferAttribute(wtop, 1));
  wgeo.setIndex(widx);
  return { geo, wgeo, perimeter: run };
}

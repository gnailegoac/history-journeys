// 素模沙盘的地形：把高程数据切成一层一层的“卡纸”。
// 每一层是一个固定的高差；层的轮廓用等高线（marching squares）求出来，
// 再做成顶面（多边形）和侧面（一圈立着的窄条）。
//
// 坐标：x 向东，z 向南，单位米（同 shared/scene-data.js）。竖向 y 是模型单位：
// 真实高差（米）× EXAG。

import * as THREE from 'three';

export const T = {
  // 沙盘裁哪一块（米，城中心是原点）：东西 11.6 公里，南北 9.1 公里。
  // 西边和南边各往里收了几百米：这样桌子的西沿（全景里朝着镜头的那一边）不会把山切开。
  crop: { x0: -6060, x1: 5500, z0: -4300, z1: 4760 },
  cell: 20, // 求等高线用的格子
  exag: 6, // 竖向夸大的倍数
  stepM: 8, // 山每一层的真实高差（米）
  footM: 48, // 第一层山的等高线（米）：低于它的都算平地
  plainM: 4, // 平地这一层的厚度（米）：也就是河面比平地低多少
  floodM: 3.4, // 大水比平地高多少（米）：正文“比城里的平地高出一丈九寸”
};
T.layerT = T.stepM * T.exag;
T.plainY = T.plainM * T.exag; // 平地顶面（河面是 y = 0）
T.floodY = T.plainY + T.floodM * T.exag;
T.levelY = (k) => T.plainY + k * T.layerT; // 第 k 层山的顶面，k = 0 是平地

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- 高程：抹平、取样 ----------

function gaussBlur(src, cols, rows, sigma) {
  const r = Math.ceil(sigma * 3);
  const k = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(v);
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += src[y * cols + Math.min(cols - 1, Math.max(0, x + i))] * k[i + r];
      tmp[y * cols + x] = s;
    }
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      let s = 0;
      for (let i = -r; i <= r; i++) s += tmp[Math.min(rows - 1, Math.max(0, y + i)) * cols + x] * k[i + r];
      out[y * cols + x] = s;
    }
  return out;
}

function cubic(p0, p1, p2, p3, t) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}

function makeSampler(dem, sigmaCells) {
  const { cols, rows } = dem.meta;
  const arr = gaussBlur(dem.heights, cols, rows, sigmaCells);
  const at = (c, r) => arr[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))];
  return (x, z) => {
    const fx = ((x - dem.minX) / (dem.maxX - dem.minX)) * (cols - 1);
    const fz = ((z - dem.minZ) / (dem.maxZ - dem.minZ)) * (rows - 1);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const row = (r) => cubic(at(ix - 1, r), at(ix, r), at(ix + 1, r), at(ix + 2, r), tx);
    return cubic(row(iz - 1), row(iz), row(iz + 1), row(iz + 2), tz);
  };
}

// ---------- 河道（示意）：中心线 + 宽度 → 到河岸的距离 ----------

// 中心线照 shared/scene-data.js 的折线，补了几个点让它弯得自然，
// 并把贴城的两段往城墙靠了几十米（正文：“城墙下面就是河”）。
export const RIVER_LINES = {
  bian: [
    [-12420, -2718], [-10000, -2380], [-7820, -1942], [-5600, -1690], [-3220, -1220],
    [-2300, -985], [-1450, -835], [-700, -770], [0, -745], [560, -750], [800, -810],
  ],
  si: [
    [2760, -9375], [2024, -6047], [1560, -4200], [1288, -2940], [1010, -1750], [810, -900],
    [770, -300], [770, 320], [822, 940], [1076, 2053], [1660, 3180], [2484, 4161], [4000, 5560], [5980, 7267],
  ],
};

function densify(points, spacing) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], 0, p[1])), false, 'centripetal');
  const n = Math.ceil(curve.getLength() / spacing);
  return curve.getSpacedPoints(n).map((v) => [v.x, v.z]);
}

const smooth01 = (a, b, v) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function riverSamples() {
  const bian = densify(RIVER_LINES.bian, 12).map(([x, z]) => ({ x, z, hw: 56 }));
  // 泗水 110 米宽；过了合流的地方 150 米宽
  const si = densify(RIVER_LINES.si, 12).map(([x, z]) => ({ x, z, hw: 68 + 26 * smooth01(-1000, -500, z) }));
  return { bian, si };
}

// ---------- 等高线 ----------

// 每个格子四个角 a(左上) b(右上) c(右下) d(左下)；边 0 上 1 右 2 下 3 左。
// 线段的方向统一成“里面在左手边”。
const CORNER = [[0, 0], [1, 0], [1, 1], [0, 1]];
const EDGE_MID = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];
const EDGE_CORNERS = [[0, 1], [1, 2], [3, 2], [0, 3]];
function orient(e1, e2, corner, cornerInside) {
  const p1 = EDGE_MID[e1];
  const p2 = EDGE_MID[e2];
  const q = CORNER[corner];
  const cross = (p2[0] - p1[0]) * (q[1] - p1[1]) - (p2[1] - p1[1]) * (q[0] - p1[0]);
  const isLeft = cross < 0;
  return isLeft === cornerInside ? [e1, e2] : [e2, e1];
}
function cellSegments(mask, centreInside) {
  // mask：四个角是否在里面（bit0=a…bit3=d）
  const inside = [0, 1, 2, 3].map((i) => !!(mask & (1 << i)));
  const n = inside.filter(Boolean).length;
  if (n === 0 || n === 4) return [];
  const crossing = [0, 1, 2, 3].filter((e) => inside[EDGE_CORNERS[e][0]] !== inside[EDGE_CORNERS[e][1]]);
  if (crossing.length === 2) {
    const c = inside.findIndex(Boolean);
    return [orient(crossing[0], crossing[1], c, true)];
  }
  // 鞍形：四条边都被穿过
  const cutOff = centreInside ? [0, 1, 2, 3].filter((i) => !inside[i]) : [0, 1, 2, 3].filter((i) => inside[i]);
  return cutOff.map((c) => {
    const es = [0, 1, 2, 3].filter((e) => EDGE_CORNERS[e].includes(c));
    return orient(es[0], es[1], c, inside[c]);
  });
}
const SEG_TABLE = [];
for (let m = 0; m < 16; m++) SEG_TABLE.push([cellSegments(m, false), cellSegments(m, true)]);

/**
 * field：(NX+2)×(NZ+2) 的格点值，最外一圈是“桌子以外”（极小值）。
 * 返回闭合的环：{ pts: [[x,z]...], fixed: [bool...] }，里面在左手边。
 */
function contourLoops(field, NX, NZ, thr, c) {
  const W = NX + 2;
  const next = new Map();
  const pts = new Map();
  const X = (i) => Math.min(c.x1, Math.max(c.x0, c.x0 + (i - 1) * c.cell));
  const Z = (j) => Math.min(c.z1, Math.max(c.z0, c.z0 + (j - 1) * c.cell));
  const isRing = (i, j) => i === 0 || j === 0 || i === NX + 1 || j === NZ + 1;
  const edgePoint = (i1, j1, i2, j2) => {
    const v1 = field[j1 * W + i1];
    const v2 = field[j2 * W + i2];
    const r1 = isRing(i1, j1);
    const r2 = isRing(i2, j2);
    let t = r1 ? 1 : r2 ? 0 : (thr - v1) / (v2 - v1);
    t = Math.min(0.999, Math.max(0.001, t));
    if (r1) t = 1;
    if (r2) t = 0;
    const x = X(i1) + (X(i2) - X(i1)) * t;
    const z = Z(j1) + (Z(j2) - Z(j1)) * t;
    const onEdge = x <= c.x0 + 1e-6 || x >= c.x1 - 1e-6 || z <= c.z0 + 1e-6 || z >= c.z1 - 1e-6;
    return [x, z, onEdge];
  };
  for (let j = 0; j <= NZ; j++)
    for (let i = 0; i <= NX; i++) {
      const a = field[j * W + i] >= thr;
      const b = field[j * W + i + 1] >= thr;
      const cc = field[(j + 1) * W + i + 1] >= thr;
      const d = field[(j + 1) * W + i] >= thr;
      const mask = (a ? 1 : 0) | (b ? 2 : 0) | (cc ? 4 : 0) | (d ? 8 : 0);
      if (mask === 0 || mask === 15) continue;
      let centre = 0;
      if (mask === 5 || mask === 10) {
        const avg = (field[j * W + i] + field[j * W + i + 1] + field[(j + 1) * W + i + 1] + field[(j + 1) * W + i]) / 4;
        centre = avg >= thr ? 1 : 0;
      }
      const ids = [(j * W + i) * 2, (j * W + i + 1) * 2 + 1, ((j + 1) * W + i) * 2, (j * W + i) * 2 + 1];
      const ends = [
        [i, j, i + 1, j],
        [i + 1, j, i + 1, j + 1],
        [i, j + 1, i + 1, j + 1],
        [i, j, i, j + 1],
      ];
      for (const [e1, e2] of SEG_TABLE[mask][centre]) {
        next.set(ids[e1], ids[e2]);
        if (!pts.has(ids[e1])) pts.set(ids[e1], edgePoint(...ends[e1]));
        if (!pts.has(ids[e2])) pts.set(ids[e2], edgePoint(...ends[e2]));
      }
    }
  const loops = [];
  const seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = { pts: [], fixed: [] };
    let cur = start;
    let guard = 0;
    while (!seen.has(cur) && guard++ < 1e6) {
      seen.add(cur);
      const p = pts.get(cur);
      const last = loop.pts[loop.pts.length - 1];
      if (!last || Math.abs(last[0] - p[0]) + Math.abs(last[1] - p[1]) > 1e-4) {
        loop.pts.push([p[0], p[1]]);
        loop.fixed.push(p[2]);
      }
      cur = next.get(cur);
      if (cur === undefined) break;
    }
    const f = loop.pts[0];
    const l = loop.pts[loop.pts.length - 1];
    if (loop.pts.length > 1 && Math.abs(f[0] - l[0]) + Math.abs(f[1] - l[1]) < 1e-4) {
      loop.pts.pop();
      loop.fixed.pop();
    }
    if (loop.pts.length >= 3) loops.push(loop);
  }
  return loops;
}

function signedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

// 切角磨圆（Chaikin）；桌子边上的点不动
function chaikin(loop) {
  const n = loop.pts.length;
  const out = { pts: [], fixed: [] };
  for (let i = 0; i < n; i++) {
    const p = loop.pts[i];
    if (loop.fixed[i]) {
      out.pts.push(p);
      out.fixed.push(true);
      continue;
    }
    const a = loop.pts[(i - 1 + n) % n];
    const b = loop.pts[(i + 1) % n];
    out.pts.push([p[0] * 0.75 + a[0] * 0.25, p[1] * 0.75 + a[1] * 0.25]);
    out.fixed.push(false);
    out.pts.push([p[0] * 0.75 + b[0] * 0.25, p[1] * 0.75 + b[1] * 0.25]);
    out.fixed.push(false);
  }
  return out;
}

// 去掉多余的点（Douglas–Peucker）；桌子边和内部交接的点一定留着
function simplify(loop, tol) {
  const n = loop.pts.length;
  const keep = new Uint8Array(n);
  let anchors = [];
  for (let i = 0; i < n; i++) {
    const f = loop.fixed[i];
    if (f !== loop.fixed[(i + 1) % n] || f !== loop.fixed[(i - 1 + n) % n]) anchors.push(i);
  }
  if (anchors.length < 2) {
    let far = 0;
    let best = -1;
    for (let i = 1; i < n; i++) {
      const d = (loop.pts[i][0] - loop.pts[0][0]) ** 2 + (loop.pts[i][1] - loop.pts[0][1]) ** 2;
      if (d > best) {
        best = d;
        far = i;
      }
    }
    anchors = [0, far];
  }
  const P = (i) => loop.pts[((i % n) + n) % n];
  const dp = (i0, i1) => {
    // i1 > i0，可以越过 n
    if (i1 - i0 < 2) return;
    const a = P(i0);
    const b = P(i1);
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const len = Math.hypot(dx, dz) || 1e-9;
    let worst = -1;
    let wi = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const p = P(i);
      const d = Math.abs((p[0] - a[0]) * dz - (p[1] - a[1]) * dx) / len;
      if (d > worst) {
        worst = d;
        wi = i;
      }
    }
    if (worst > tol) {
      keep[((wi % n) + n) % n] = 1;
      dp(i0, wi);
      dp(wi, i1);
    }
  };
  for (let k = 0; k < anchors.length; k++) {
    const i0 = anchors[k];
    let i1 = anchors[(k + 1) % anchors.length];
    if (i1 <= i0) i1 += n;
    keep[i0] = 1;
    dp(i0, i1);
  }
  const out = { pts: [], fixed: [] };
  for (let i = 0; i < n; i++)
    if (keep[i]) {
      out.pts.push(loop.pts[i]);
      out.fixed.push(loop.fixed[i]);
    }
  return out;
}

function pointInPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** 环 → 带洞的多边形。outerSign：外圈的面积符号。 */
function toPolygons(loops, minArea) {
  const withArea = loops.map((l) => ({ ...l, area: signedArea(l.pts) })).filter((l) => Math.abs(l.area) >= minArea && l.pts.length >= 3);
  if (!withArea.length) return [];
  const biggest = withArea.reduce((a, b) => (Math.abs(b.area) > Math.abs(a.area) ? b : a));
  const sign = Math.sign(biggest.area);
  const outers = withArea.filter((l) => Math.sign(l.area) === sign).map((l) => ({ outer: l, holes: [] }));
  const holes = withArea.filter((l) => Math.sign(l.area) !== sign);
  for (const h of holes) {
    let best = null;
    for (const o of outers) {
      if (Math.abs(o.outer.area) <= Math.abs(h.area)) continue;
      if (!pointInPoly(h.pts[0], o.outer.pts)) continue;
      if (!best || Math.abs(o.outer.area) < Math.abs(best.outer.area)) best = o;
    }
    if (best) best.holes.push(h);
  }
  return outers;
}

// ---------- 总装 ----------

/**
 * 返回 { levels: [{ k, yTop, yBot, polys }], levelAt(x,z), sdfAt(x,z), ao: {data,w,h}, maxLevel }
 * extra：{ cityRect, mound, tongue } 等对地形的几处改动（见 table.js 里的说明）。
 */
export function buildTerrain(dem, extra) {
  const c = { ...T.crop, cell: T.cell };
  const NX = Math.round((c.x1 - c.x0) / c.cell) + 1;
  const NZ = Math.round((c.z1 - c.z0) / c.cell) + 1;
  const W = NX + 2;
  const sample = makeSampler(dem, 1.25);

  // 河：到河岸的距离（岸上为正），只算河两边 600 米以内
  const sdf = new Float32Array(NX * NZ).fill(600);
  const rivers = riverSamples();
  for (const line of [rivers.bian, rivers.si])
    for (const s of line) {
      const R = 600 + s.hw;
      const i0 = Math.max(0, Math.floor((s.x - R - c.x0) / c.cell));
      const i1 = Math.min(NX - 1, Math.ceil((s.x + R - c.x0) / c.cell));
      const j0 = Math.max(0, Math.floor((s.z - R - c.z0) / c.cell));
      const j1 = Math.min(NZ - 1, Math.ceil((s.z + R - c.z0) / c.cell));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const d = Math.hypot(c.x0 + i * c.cell - s.x, c.z0 + j * c.cell - s.z) - s.hw;
          if (d < sdf[j * NX + i]) sdf[j * NX + i] = d;
        }
    }

  // 高程（米）
  const H = new Float32Array(NX * NZ);
  const { cityRect, mound, tongue } = extra;
  for (let j = 0; j < NZ; j++)
    for (let i = 0; i < NX; i++) {
      const x = c.x0 + i * c.cell;
      const z = c.z0 + j * c.cell;
      let h = sample(x, z);
      // 河边一带压成平地，河才躺得进去
      const s = sdf[j * NX + i];
      if (s < 140) h = Math.min(h, 45 + Math.max(0, s - 70) * 0.2);
      // 戏马台的土山不在这里做：它是单独的一摞薄板（见 models.js），这里只在给了 mound 的时候才补
      if (mound) {
        const mdx = x - mound.x;
        const mdz = (z - mound.z) * 0.84; // 南北长一点
        const th = Math.atan2(mdz, mdx);
        const rr = Math.hypot(mdx, mdz) / (1 + 0.13 * Math.sin(3 * th + 0.7) + 0.07 * Math.sin(5 * th + 2.1));
        const prof = mound.profile;
        if (rr < prof[prof.length - 1][0]) {
          let v = prof[0][1];
          for (let i = 0; i < prof.length - 1; i++)
            if (rr >= prof[i][0] && rr <= prof[i + 1][0]) v = prof[i][1] + ((prof[i + 1][1] - prof[i][1]) * (rr - prof[i][0])) / (prof[i + 1][0] - prof[i][0]);
          h = Math.max(h, v);
        }
      }
      // 城西南到戏马台之间垫高的一条地（示意）
      {
        const ax = tongue.a[0];
        const az = tongue.a[1];
        const bx = tongue.b[0];
        const bz = tongue.b[1];
        const t = Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2)));
        const d = Math.hypot(x - (ax + (bx - ax) * t), z - (az + (bz - az) * t));
        if (d < tongue.reach) h = Math.max(h, tongue.topM - (tongue.topM - 44) * (d / tongue.reach) ** 2 + 1.3 * Math.sin(x / 47 + z / 61));
      }
      // 城墙里面是一块平地
      if (x > cityRect.x0 && x < cityRect.x1 && z > cityRect.z0 && z < cityRect.z1) h = Math.min(h, 44);
      H[j * NX + i] = h;
    }
  // 再轻轻抹一遍，去掉取样留下的折痕
  const Hs = gaussBlur(H, NX, NZ, 1.0);
  for (let j = 0; j < NZ; j++)
    for (let i = 0; i < NX; i++) {
      const x = c.x0 + i * c.cell;
      const z = c.z0 + j * c.cell;
      if (x > cityRect.x0 && x < cityRect.x1 && z > cityRect.z0 && z < cityRect.z1) Hs[j * NX + i] = Math.min(Hs[j * NX + i], 44);
    }

  // 太小的山包（和它上面的各层）先在格子上削平，这样等高线、摆东西用的层号是一致的
  const minArea = 26000;
  {
    const minCells = minArea / (c.cell * c.cell);
    const label = new Int32Array(NX * NZ);
    const stack = [];
    let maxH0 = 0;
    for (let i = 0; i < Hs.length; i++) maxH0 = Math.max(maxH0, Hs[i]);
    for (let thr = T.footM; thr < maxH0; thr += T.stepM) {
      label.fill(0);
      let id = 0;
      for (let start = 0; start < Hs.length; start++) {
        if (Hs[start] < thr || label[start]) continue;
        id++;
        const cells = [];
        stack.push(start);
        label[start] = id;
        while (stack.length) {
          const p = stack.pop();
          cells.push(p);
          const pi = p % NX;
          const pj = (p - pi) / NX;
          if (pi > 0 && !label[p - 1] && Hs[p - 1] >= thr) { label[p - 1] = id; stack.push(p - 1); }
          if (pi < NX - 1 && !label[p + 1] && Hs[p + 1] >= thr) { label[p + 1] = id; stack.push(p + 1); }
          if (pj > 0 && !label[p - NX] && Hs[p - NX] >= thr) { label[p - NX] = id; stack.push(p - NX); }
          if (pj < NZ - 1 && !label[p + NX] && Hs[p + NX] >= thr) { label[p + NX] = id; stack.push(p + NX); }
        }
        if (cells.length < minCells * 1.15) for (const p of cells) Hs[p] = Math.min(Hs[p], thr - 0.4);
      }
    }
  }

  const padded = (src) => {
    const f = new Float32Array(W * (NZ + 2)).fill(-1e9);
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) f[(j + 1) * W + i + 1] = src[j * NX + i];
    return f;
  };
  const fieldH = padded(Hs);
  const fieldLand = padded(sdf);

  let maxH = 0;
  for (let i = 0; i < Hs.length; i++) maxH = Math.max(maxH, Hs[i]);
  const levels = [];
  const prep = (loops, tol, rounds) =>
    loops.map((l) => {
      let r = l;
      for (let i = 0; i < rounds; i++) r = chaikin(r);
      return simplify(r, tol);
    });

  // 平地这一层：整张桌面挖掉河道
  levels.push({ k: 0, yTop: T.plainY, yBot: -3, polys: toPolygons(prep(contourLoops(fieldLand, NX, NZ, 0, c), 1.2, 2), 2000) });
  // 山：一层 8 米
  for (let k = 1; T.footM + (k - 1) * T.stepM < maxH; k++) {
    const thr = T.footM + (k - 1) * T.stepM;
    const polys = toPolygons(prep(contourLoops(fieldH, NX, NZ, thr, c), 1.6, 2), minArea * 0.5);
    if (!polys.length) break;
    levels.push({ k, yTop: T.levelY(k), yBot: T.levelY(k - 1), polys });
  }

  // 格点上的层号（给摆东西和压暗用）。小于 minArea 的小块已经丢掉了，这里用多边形再核一遍太慢，
  // 所以摆东西的时候离等高线远一点就行。
  const levelGrid = new Uint8Array(NX * NZ);
  for (let i = 0; i < Hs.length; i++) levelGrid[i] = Hs[i] < T.footM ? 0 : Math.min(levels.length - 1, Math.floor((Hs[i] - T.footM) / T.stepM) + 1);

  const idx = (x, z) => {
    const i = Math.min(NX - 1, Math.max(0, Math.round((x - c.x0) / c.cell)));
    const j = Math.min(NZ - 1, Math.max(0, Math.round((z - c.z0) / c.cell)));
    return j * NX + i;
  };
  const levelAt = (x, z) => levelGrid[idx(x, z)];
  const sdfAt = (x, z) => sdf[idx(x, z)];
  const heightM = (x, z) => Hs[idx(x, z)];

  // 压暗图：每一层台阶的脚下暗一点（上面那层挡住了一部分天光）
  const q = new Float32Array(NX * NZ);
  for (let i = 0; i < q.length; i++) q[i] = sdf[i] < 0 ? -0.5 : levelGrid[i];
  const qb = gaussBlur(q, NX, NZ, 2.2);
  const ao = new Uint8Array(NX * NZ);
  for (let i = 0; i < q.length; i++) {
    const d = Math.max(0, qb[i] - q[i]);
    ao[i] = Math.round(255 * (1 - Math.min(0.62, d * 0.95)));
  }

  return { levels, levelAt, sdfAt, heightM, ao: { data: ao, w: NX, h: NZ }, NX, NZ };
}

// ---------- 多边形 → 网格 ----------

/**
 * 把各层做成两张网格用的数据：顶面（caps）和侧面（walls）。
 * 返回 { caps: BufferGeometry, walls: BufferGeometry, tris }
 */
export function buildLayerGeometry(levels, opt = {}) {
  const c = T.crop;
  const grain = opt.grainTile || 1100;
  const rnd = mulberry32(7);
  const cp = [];
  const cn = [];
  const cuv = [];
  const cuv1 = [];
  const ccol = [];
  const ci = [];
  const wp = [];
  const wn = [];
  const wuv = [];
  const wcol = [];
  // 桌子边上被切开的山：切面单放一张网格（用亮一点的材料，像打了一块反光板）
  const rp = [];
  const rn = [];
  const ruv = [];
  const rcol = [];
  const cosCrease = Math.cos((48 * Math.PI) / 180);

  for (const lv of levels) {
    // 每层卡纸的颜色差一点点，纹理也错开
    const tint = 1 - 0.02 * rnd() - (lv.k % 2) * 0.012;
    const ox = rnd() * 7;
    const oz = rnd() * 7;
    for (const poly of lv.polys) {
      const contour = poly.outer.pts.map((p) => new THREE.Vector2(p[0], p[1]));
      const holes = poly.holes.map((h) => h.pts.map((p) => new THREE.Vector2(p[0], p[1])));
      const faces = THREE.ShapeUtils.triangulateShape(contour, holes);
      const all = contour.concat(...holes);
      const base = cp.length / 3;
      for (const v of all) {
        cp.push(v.x, lv.yTop, v.y);
        cn.push(0, 1, 0);
        cuv.push(v.x / grain + ox, v.y / grain + oz);
        cuv1.push((v.x - c.x0) / (c.x1 - c.x0), (v.y - c.z0) / (c.z1 - c.z0));
        ccol.push(tint, tint, tint);
      }
      for (const f of faces) {
        const a = all[f[0]];
        const b = all[f[1]];
        const d = all[f[2]];
        // 朝上：在 (x, z) 平面里 a→b→d 的叉积要让法线的 y 为正
        const cross = (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x);
        if (cross < 0) ci.push(base + f[0], base + f[1], base + f[2]);
        else ci.push(base + f[0], base + f[2], base + f[1]);
      }
      // 侧面
      for (const loop of [poly.outer, ...poly.holes]) {
        const pts = loop.pts;
        const n = pts.length;
        const segN = [];
        for (let i = 0; i < n; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % n];
          const dx = b[0] - a[0];
          const dz = b[1] - a[1];
          const len = Math.hypot(dx, dz) || 1e-9;
          segN.push([-dz / len, dx / len, len]);
        }
        let run = rnd() * 50;
        for (let i = 0; i < n; i++) {
          const a = pts[i];
          const b = pts[(i + 1) % n];
          const nc = segN[i];
          const np = segN[(i - 1 + n) % n];
          const nx = segN[(i + 1) % n];
          const blend = (m, o) => {
            if (m[0] * o[0] + m[1] * o[1] < cosCrease) return m;
            const x = m[0] + o[0];
            const z = m[1] + o[1];
            const l = Math.hypot(x, z) || 1;
            return [x / l, z / l];
          };
          const na = blend(nc, np);
          const nb = blend(nc, nx);
          const u0 = run / 60;
          run += nc[2];
          const u1 = run / 60;
          const dark = 0.86;
          // 两个三角形：a_top, b_top, b_bot / a_top, b_bot, a_bot。朝外。
          const quad = [
            [a, lv.yTop, na, u0, 1, 1],
            [b, lv.yTop, nb, u1, 1, 1],
            [b, lv.yBot, nb, u1, 0, dark],
            [a, lv.yTop, na, u0, 1, 1],
            [b, lv.yBot, nb, u1, 0, dark],
            [a, lv.yBot, na, u0, 0, dark],
          ];
          // 绕向：(a_top, b_top, b_bot) 的几何法线是 (ez·h, 0, -ex·h)，和朝外的 (-ez, 0, ex) 相反，所以反着排
          const onRim = !!(loop.fixed && loop.fixed[i] && loop.fixed[(i + 1) % n]);
          const P = onRim ? rp : wp;
          const N = onRim ? rn : wn;
          const U = onRim ? ruv : wuv;
          const Cc = onRim ? rcol : wcol;
          for (const o of [0, 2, 1, 3, 5, 4]) {
            const v = quad[o];
            P.push(v[0][0], v[1], v[0][1]);
            N.push(v[2][0], 0, v[2][1]);
            U.push(v[3], v[4]);
            Cc.push(v[5], v[5], v[5]);
          }
        }
      }
    }
  }
  const caps = new THREE.BufferGeometry();
  caps.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
  caps.setAttribute('normal', new THREE.Float32BufferAttribute(cn, 3));
  caps.setAttribute('uv', new THREE.Float32BufferAttribute(cuv, 2));
  caps.setAttribute('uv1', new THREE.Float32BufferAttribute(cuv1, 2));
  caps.setAttribute('color', new THREE.Float32BufferAttribute(ccol, 3));
  caps.setIndex(ci);
  const walls = new THREE.BufferGeometry();
  walls.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
  walls.setAttribute('normal', new THREE.Float32BufferAttribute(wn, 3));
  walls.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
  walls.setAttribute('color', new THREE.Float32BufferAttribute(wcol, 3));
  const rim = new THREE.BufferGeometry();
  rim.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  rim.setAttribute('normal', new THREE.Float32BufferAttribute(rn, 3));
  rim.setAttribute('uv', new THREE.Float32BufferAttribute(ruv, 2));
  rim.setAttribute('color', new THREE.Float32BufferAttribute(rcol, 3));
  return { caps, walls, rim, tris: ci.length / 3 + wp.length / 9 + rp.length / 9 };
}

// 沙盘上的小模型：城墙、四门、角楼、城里的屋顶、黄楼、戏马台、放鹤亭、堤、石岸、村子、船、树、石头。
// 都放大了，不按比例；位置照 shared/scene-data.js。
//
// 每样东西做两套：
//   近看的一套（near）——镜头在城边上时用，做得细；
//   远看的一套（far）——看整块沙盘时用。整块沙盘上一座城只有七八十个像素宽，照近看的尺寸摆，
//   城楼、屋顶、树都小得认不出来，所以远看的一套把城楼、屋顶、戏马台、村子、船、树再放大两倍多，
//   位置不动。博物馆的沙盘也是这么做的。

import * as THREE from 'three';
import { yOf, PAL, WALLRECT, PLACE, DIKE_PTS, CITY_H, LEVEL, CROP, RIVER_PATHS } from './config.js';
import { Batch, FB, T, box, cyl, segBox, prism, roofParts, tileTexture, brickTexture, stoneTexture, washTexture, strawTexture } from './geo.js';
import { lerp, smoothstep, mulberry32, fbm } from './util.js';

const GROUND = yOf(CITY_H); // 城里地面
export const WALL_TOP = GROUND + 62;
const GATE_TOP = WALL_TOP + 8;
const WALL_BASE_HALF = 26;
const WALL_TOP_HALF = 18;

const NEAR = { far: false, ky: 1, kt: 1, kh: 1, merlon: { step: 20, w: 11, h: 9, d: 6 } };
const FAR = { far: true, ky: 1.55, kt: 2.25, kh: 2.1, merlon: { step: 58, w: 30, h: 12, d: 8 } };

export function makeMaterials() {
  const L = (o) => new THREE.MeshLambertMaterial({ vertexColors: true, ...o });
  const tile = tileTexture();
  const brick = brickTexture();
  const stone = stoneTexture();
  const straw = strawTexture();
  return {
    tile: L({ color: PAL.tile, map: tile }),
    thatch: L({ color: PAL.thatch, map: straw }),
    mat: L({ color: PAL.mat, map: straw }),
    plaster: L({ color: PAL.plaster }),
    yellow: L({ color: PAL.earthYellow, map: washTexture() }),
    vermilion: L({ color: PAL.vermilion }),
    timber: L({ color: PAL.timber }),
    bracket: L({ color: PAL.shiluDeep }),
    brick: L({ color: PAL.brick, map: brick }),
    stone: L({ color: PAL.stone, map: stone }),
    earth: L({ color: PAL.earth }),
    boat: L({ color: PAL.boat }),
    rock: L({ color: PAL.rock }),
    rockPale: L({ color: PAL.rockPale }),
    dark: L({ color: '#2b211c' }),
    plaque: L({ color: PAL.shiqingDeep }),
  };
}

// ---------- 殿、楼 ----------

function addRoof(b, M, opts, { ridges = true, gableMat = 'plaster', roofMat = 'tile', tint } = {}) {
  const r = roofParts(opts);
  b.add(roofMat, r.roof, M, tint);
  if (r.fascia) b.add('timber', r.fascia, M);
  if (r.gable) b.add(gableMat, r.gable, M);
  if (ridges) for (const s of r.ridges) b.add(roofMat, segBox(s.a, s.b, s.w, s.h), M, [0.86, 0.86, 0.86]);
  return r;
}

/** 檐下暗一点：顶上的顶点压暗 */
function shadeTop(g, H, k) {
  const p = g.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const s = lerp(1.04, k, smoothstep(H * 0.35, H, p.getY(i)));
    c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = s;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

/** 一层殿身：台基、柱、墙、额枋、斗拱一圈。返回顶上的高度。 */
function addBody(b, M, { W, D, H, nxc = 6, nzc = 3, wall = 'plaster', colR = 1.7, base = 2.4, doors = true, doorN = 3, winN = 99 }) {
  const m = (x, y, z) => M.clone().multiply(T(x, y, z));
  if (base > 0) b.add('stone', box(W + 9, base, D + 9), m(0, 0, 0));
  const y0 = base;
  b.add(wall, shadeTop(box(W - 2.6, H - 1.6, D - 2.6), H - 1.6, 0.74), m(0, y0, 0));
  for (let i = 0; i < nxc; i++) {
    const x = lerp(-W / 2, W / 2, i / (nxc - 1));
    for (const sz of [-1, 1]) b.add('vermilion', shadeTop(cyl(colR, H, 8), H, 0.76), m(x, y0, (sz * D) / 2));
  }
  for (let j = 1; j < nzc - 1; j++) {
    const z = lerp(-D / 2, D / 2, j / (nzc - 1));
    for (const sx of [-1, 1]) b.add('vermilion', shadeTop(cyl(colR, H, 8), H, 0.76), m((sx * W) / 2, y0, z));
  }
  if (doors) {
    const bay = W / (nxc - 1);
    for (let i = 0; i < nxc - 1; i++) {
      const x = -W / 2 + bay * (i + 0.5);
      const k = Math.abs(i - (nxc - 2) / 2);
      const isDoor = k < doorN / 2;
      const isWin = !isDoor && k < doorN / 2 + winN;
      for (const sz of [-1, 1]) {
        if (isDoor) b.add('timber', box(bay - colR * 2 - 1.2, H * 0.66, 0.9), m(x, y0, sz * (D / 2 - 1.0)));
        else if (isWin) b.add('timber', box(bay - colR * 2 - 3.4, H * 0.3, 0.9), m(x, y0 + H * 0.36, sz * (D / 2 - 1.0)));
      }
    }
  }
  // 檐下一道深色的额枋，再上面是斗拱
  b.add('timber', box(W + 1.6, 2.6, D + 1.6), m(0, y0 + H - 2.6, 0));
  b.add('bracket', box(W + 3.6, 1.7, D + 3.6), m(0, y0 + H, 0));
  return y0 + H + 1.7;
}

/** 栏杆一圈 */
function addRailing(b, M, W, D, y, h = 3.4) {
  const m = (x, yy, z) => M.clone().multiply(T(x, yy, z));
  for (const sz of [-1, 1]) {
    b.add('vermilion', box(W, 0.7, 0.7), m(0, y + h, (sz * D) / 2));
    b.add('vermilion', box(W, 0.5, 0.5), m(0, y + h * 0.5, (sz * D) / 2));
  }
  for (const sx of [-1, 1]) {
    b.add('vermilion', box(0.7, 0.7, D), m((sx * W) / 2, y + h, 0));
    b.add('vermilion', box(0.5, 0.5, D), m((sx * W) / 2, y + h * 0.5, 0));
  }
  const nx = Math.round(W / 9);
  const nz = Math.round(D / 9);
  for (let i = 0; i <= nx; i++) for (const sz of [-1, 1]) b.add('vermilion', box(0.9, h + 0.8, 0.9), m(lerp(-W / 2, W / 2, i / nx), y, (sz * D) / 2));
  for (let j = 1; j < nz; j++) for (const sx of [-1, 1]) b.add('vermilion', box(0.9, h + 0.8, 0.9), m((sx * W) / 2, y, lerp(-D / 2, D / 2, j / nz)));
}

/**
 * 一座楼：下层殿身 + 腰檐 +（平坐栏杆）+ 上层殿身 + 歇山顶。
 * 黄楼用黄土墙、两层带平坐；普通城楼是重檐一层。
 */
function addTower(b, M, s) {
  const sag = 0.55;
  const m = (y) => M.clone().multiply(T(0, y, 0));
  let y = addBody(b, M, { W: s.W, D: s.D, H: s.H1, nxc: s.nxc, nzc: s.nzc, wall: s.wall, base: s.base ?? 2.4, doorN: s.doorN, winN: s.winN });
  if (s.W2) {
    const eW = s.W + 2 * s.ov1;
    const eD = s.D + 2 * s.ov1;
    const t1 = (eD - (s.D2 - 2)) / eD;
    const Hs = s.rise1 / ((1 - sag) * t1 + sag * t1 * t1);
    addRoof(b, m(y - 1.2), { W: eW, D: eD, H: Hs, ts: 1, t1, lift: s.lift ?? 5, nu: 10, nt: 4, sag }, {});
    y = y - 1.2 + s.rise1;
    if (s.balcony) {
      b.add('timber', box(s.W2 + 13, 1.3, s.D2 + 13), m(y - 0.4));
      addRailing(b, m(y + 0.9), s.W2 + 12, s.D2 + 12, 0);
      y += 0.9;
    }
    const top = addBody(b, m(y), { W: s.W2, D: s.D2, H: s.H2, nxc: s.nxc2 ?? s.nxc, nzc: s.nzc2 ?? s.nzc, wall: s.wall, base: 0, doors: s.H2 > 9, doorN: s.doorN2 ?? 1, winN: s.winN2 ?? 1 });
    if (s.plaque) b.add('plaque', box(15, 6, 1), m(y + s.H2 - 6.4).multiply(T(0, 0, s.D2 / 2 + 2.6)));
    y += top;
    addRoof(b, m(y - 1.2), { W: s.W2 + 2 * s.ov2, D: s.D2 + 2 * s.ov2, H: s.roofH, ts: s.ts ?? 0.52, lift: s.lift ?? 5, nu: 12, nt: 6, sag }, { gableMat: 'vermilion' });
    return y - 1.2 + s.roofH;
  }
  addRoof(b, m(y - 1.2), { W: s.W + 2 * s.ov1, D: s.D + 2 * s.ov1, H: s.roofH, ts: s.ts ?? 0.52, lift: s.lift ?? 4, nu: 10, nt: 6, sag }, { gableMat: 'vermilion' });
  return y - 1.2 + s.roofH;
}

/** 攒尖顶的小亭、角楼 */
function addPavilion(b, M, { S = 30, H = 14, roofH = 16, ov = 8, wall = null, lift = 4 }) {
  const m = (x, y, z) => M.clone().multiply(T(x, y, z));
  b.add('stone', box(S + 8, 2.2, S + 8), m(0, 0, 0));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add('vermilion', cyl(1.5, H, 8), m((sx * S) / 2, 2.2, (sz * S) / 2));
  if (wall) b.add(wall, box(S - 2.4, H - 1.5, S - 2.4), m(0, 2.2, 0));
  b.add('timber', box(S + 1.2, 1.8, S + 1.2), m(0, 2.2 + H - 1.8, 0));
  b.add('bracket', box(S + 3, 1.5, S + 3), m(0, 2.2 + H, 0));
  addRoof(b, m(0, 2.2 + H + 0.4, 0), { W: S + 2 * ov, D: S + 2 * ov, H: roofH, ts: 1, lift, nu: 8, nt: 6, sag: 0.6 }, {});
  b.add('tile', cyl(1.6, 4.5, 6, 0.4), m(0, 2.2 + H + 0.4 + roofH - 0.6, 0), [0.8, 0.8, 0.8]);
}

/** 两坡顶的民房。thatch 为真是茅草顶。 */
function addHouse(b, x, y, z, ry, L, Dp, wallH, roofH, wallTint, roofTint, thatch) {
  const M = T(x, y, z, ry);
  b.add(thatch ? 'earth' : 'plaster', box(L, wallH, Dp), M, wallTint);
  const r = roofParts({ W: L + 5, D: Dp + 7, H: roofH, ts: 0, nu: 1, nt: 3, sag: thatch ? 0.15 : 0.4, fascia: 0, gableInset: 2.5, tile: thatch ? 5 : 3.2 });
  const MR = M.clone().multiply(T(0, wallH - 0.6, 0));
  b.add(thatch ? 'thatch' : 'tile', r.roof, MR, roofTint);
  if (r.gable) b.add(thatch ? 'earth' : 'plaster', r.gable, MR, wallTint);
}

// ---------- 城 ----------

/** 城墙的明暗：墙脚那四分之一深两成、偏冷一点（潮气），往上是砖的本色 */
function wallShade(y) {
  const k = smoothstep(GROUND - 4, GROUND + 22, y);
  const s = lerp(0.78, 1.0, k);
  return [s * lerp(0.95, 1, k), s * lerp(0.985, 1, k), s * lerp(1.035, 1, k)];
}
const wallHalfAt = (y) => lerp(WALL_BASE_HALF, WALL_TOP_HALF, (y - (GROUND - 16)) / (WALL_TOP - (GROUND - 16)));

function addMerlons(b, M, len, zEdge, y, ml) {
  const n = Math.max(1, Math.floor(len / ml.step));
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (i + 0.5) * (len / n);
    b.add('brick', box(ml.w, ml.h, ml.d), M.clone().multiply(T(x, y, zEdge)), [1.06, 1.06, 1.06]);
  }
}

const ARCH_W = 22;
const ARCH_SPRING = GROUND + 30;
const UVB = 48; // 砖的贴图一张管 48 米：一皮砖高 1.5 米

/** 门洞口的一圈券石 */
function archRing() {
  const s = new THREE.Shape();
  const o = ARCH_W + 5;
  s.moveTo(-o, GROUND - 1);
  s.lineTo(o, GROUND - 1);
  s.lineTo(o, ARCH_SPRING);
  s.absarc(0, ARCH_SPRING, o, 0, Math.PI, false);
  s.lineTo(-o, GROUND - 1);
  const hole = new THREE.Path();
  hole.moveTo(-ARCH_W, GROUND - 1);
  hole.lineTo(ARCH_W, GROUND - 1);
  hole.lineTo(ARCH_W, ARCH_SPRING);
  hole.absarc(0, ARCH_SPRING, ARCH_W, 0, Math.PI, false);
  hole.lineTo(-ARCH_W, GROUND - 1);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: 3, bevelEnabled: false, curveSegments: 12 });
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / UVB, uv.getY(i) / UVB);
  return g;
}

function gateShape(halfW, top) {
  const s = new THREE.Shape();
  s.moveTo(-halfW - 4, GROUND - 16);
  s.lineTo(halfW + 4, GROUND - 16);
  s.lineTo(halfW, top);
  s.lineTo(-halfW, top);
  s.closePath();
  const hole = new THREE.Path();
  const aw = ARCH_W;
  const spring = ARCH_SPRING;
  hole.moveTo(-aw, GROUND - 1);
  hole.lineTo(aw, GROUND - 1);
  hole.lineTo(aw, spring);
  hole.absarc(0, spring, aw, 0, Math.PI, false);
  hole.lineTo(-aw, GROUND - 1);
  s.holes.push(hole);
  return s;
}

function gatePlatform(halfW, depth) {
  const g = new THREE.ExtrudeGeometry(gateShape(halfW, GATE_TOP), { depth, bevelEnabled: false, curveSegments: 12 });
  g.translate(0, 0, -depth / 2);
  const gn = g.index ? g.toNonIndexed() : g;
  const pos = gn.attributes.position;
  const nor = gn.attributes.normal;
  const uv = gn.attributes.uv;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const up = nor.getY(i) > 0.9;
    const inside = Math.abs(pos.getX(i)) < ARCH_W + 0.5 && pos.getY(i) < ARCH_SPRING + ARCH_W + 1 && Math.abs(nor.getZ(i)) < 0.5;
    const s = up ? [1.16, 1.16, 1.16] : inside ? [0.42, 0.42, 0.42] : wallShade(pos.getY(i));
    col[i * 3] = s[0];
    col[i * 3 + 1] = s[1];
    col[i * 3 + 2] = s[2];
    uv.setXY(i, uv.getX(i) / UVB, uv.getY(i) / UVB);
  }
  gn.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return gn;
}

const ORDINARY_TOWER = { W: 92, D: 38, H1: 17, nxc: 6, nzc: 3, ov1: 12, rise1: 7.5, W2: 78, D2: 24, H2: 7, ov2: 13, roofH: 21, wall: 'plaster', lift: 4 };
const YELLOW_TOWER = {
  W: 112,
  D: 50,
  H1: 22,
  nxc: 8,
  nzc: 4,
  ov1: 14,
  rise1: 8,
  W2: 92,
  D2: 30,
  H2: 19,
  nxc2: 6,
  nzc2: 3,
  ov2: 16,
  roofH: 27,
  wall: 'yellow',
  doorN: 1,
  winN: 1,
  plaque: true,
  balcony: true,
  lift: 4.2,
};

/**
 * 城墙四面、四门、角楼、马面、城里的屋顶。
 * B.wall 放城墙（远看的一套整体拔高），B.main 放城楼、屋顶，B.early / B.after 放东门上的两种楼。
 * 返回城里可以种树的空地。
 */
function buildCity(B, rnd, lod) {
  const { far, ky, kt, kh, merlon: ml } = lod;
  const W = WALLRECT;
  const cx = (W.x0 + W.x1) / 2;
  const cz = (W.z0 + W.z1) / 2;
  const hx = (W.x1 - W.x0) / 2;
  const hz = (W.z1 - W.z0) / 2;
  const yMid = GROUND + 20;
  const section = [
    [WALL_BASE_HALF, GROUND - 16],
    [wallHalfAt(yMid), yMid],
    [WALL_TOP_HALF, WALL_TOP],
    [-WALL_TOP_HALF, WALL_TOP],
    [-wallHalfAt(yMid), yMid],
    [-WALL_BASE_HALF, GROUND - 16],
  ];
  // 四面：local +z 朝城外
  const sides = [
    { name: 'S', len: 2 * hx, M: T(cx, 0, W.z1, 0) },
    { name: 'N', len: 2 * hx, M: T(cx, 0, W.z0, Math.PI) },
    { name: 'E', len: 2 * hz, M: T(W.x1, 0, cz, Math.PI / 2) },
    { name: 'W', len: 2 * hz, M: T(W.x0, 0, cz, -Math.PI / 2) },
  ];
  for (const s of sides) {
    // 城门两边各一段墙，门洞是通的
    const segLen = s.len / 2 + 15 - 60;
    for (const sg of [-1, 1]) B.wall.add('brick', prism(section, segLen, { shade: wallShade, topShade: 1.18, uvScale: UVB }), s.M.clone().multiply(T(sg * (60 + segLen / 2), 0, 0)));
    addMerlons(B.wall, s.M, s.len + 20, WALL_TOP_HALF - ml.d / 2, WALL_TOP, ml);
    if (!far) {
      B.wall.add('stone', box(s.len + 24, 3.2, 3), s.M.clone().multiply(T(0, WALL_TOP - 4.2, WALL_TOP_HALF + 0.9)), [1.1, 1.08, 1.04]);
      B.wall.add('brick', box(s.len + 20, 4.5, 2.6), s.M.clone().multiply(T(0, WALL_TOP, -WALL_TOP_HALF + 1.4)), [1.06, 1.06, 1.06]);
    }
    // 马面：两门之间各一座
    for (const fx of [-0.27, 0.27]) {
      const Mm = s.M.clone().multiply(T(fx * s.len, 0, WALL_BASE_HALF + 4));
      B.wall.add('brick', prism([[14, GROUND - 16], [10, WALL_TOP], [-12, WALL_TOP], [-12, GROUND - 16]], 56, { shade: wallShade, topShade: 1.18, uvScale: UVB }), Mm);
      if (!far) addMerlons(B.wall, Mm, 56, 10 - 3.2, WALL_TOP, { ...ml, step: 18.6 });
    }
    // 城门：门洞、门扇、城台上的垛口
    const depth = 2 * WALL_BASE_HALF + 34;
    B.wall.add('brick', gatePlatform(76, depth), s.M);
    B.wall.add('vermilion', box(2 * ARCH_W - 0.6, 52, 3), s.M.clone().multiply(T(0, GROUND - 1, depth / 2 - 20)), [0.5, 0.4, 0.38]);
    if (!far) {
      B.wall.add('dark', box(0.9, 52, 3.6), s.M.clone().multiply(T(0, GROUND - 1, depth / 2 - 20)));
      B.wall.add('stone', archRing(), s.M.clone().multiply(T(0, 0, depth / 2 - 1.4)), [1.12, 1.1, 1.06]);
      B.wall.add('stone', archRing(), s.M.clone().multiply(T(0, 0, -depth / 2 - 1.6)), [1.12, 1.1, 1.06]);
      addMerlons(B.wall, s.M, 150, depth / 2 - 3.4, GATE_TOP, { ...ml, step: 18.75 });
      B.wall.add('brick', box(150, 4.5, 2.6), s.M.clone().multiply(T(0, GATE_TOP, -depth / 2 + 1.6)), [1.06, 1.06, 1.06]);
      for (const sx of [-1, 1]) for (let k = 0; k < 2; k++) B.wall.add('brick', box(6, 9, 11), s.M.clone().multiply(T(sx * (76 - 3.4), GATE_TOP, depth / 2 - 16 - k * 19)), [1.06, 1.06, 1.06]);
    }
    // 城楼
    const MT = s.M.clone().multiply(T(0, GATE_TOP * ky, 0, 0, kt));
    if (s.name === 'E') {
      addTower(B.early, MT, ORDINARY_TOWER);
      addTower(B.after, MT, YELLOW_TOWER);
    } else {
      addTower(B.main, MT, ORDINARY_TOWER);
    }
  }
  // 角台和角楼
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = cx + sx * (hx + 7);
    const pz = cz + sz * (hz + 7);
    const bh = GATE_TOP - GROUND + 16;
    const g = box(92, bh, 92);
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const yy = pos.getY(i) + GROUND - 16;
      const s = nor.getY(i) > 0.9 ? [1.18, 1.18, 1.18] : wallShade(yy);
      col[i * 3] = s[0];
      col[i * 3 + 1] = s[1];
      col[i * 3 + 2] = s[2];
      g.attributes.uv.setXY(i, (g.attributes.uv.getX(i) * 92) / UVB, (g.attributes.uv.getY(i) * bh) / UVB);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    B.wall.add('brick', g, T(px, GROUND - 16, pz));
    if (!far) {
      for (const [dx, dz, rot] of [[0, sz * 42.6, sz > 0 ? 0 : Math.PI], [sx * 42.6, 0, sx > 0 ? Math.PI / 2 : -Math.PI / 2]]) {
        addMerlons(B.wall, T(px + dx, 0, pz + dz, rot), 92, 0, GATE_TOP, { ...ml, step: 18.4 });
      }
    }
    addPavilion(B.main, T(px - sx * 6, GATE_TOP * ky, pz - sz * 6, 0, far ? kt * 0.9 : 1), { S: 34, H: 15, roofH: 17, ov: 9, wall: 'plaster' });
  }

  // 城里：一排排屋顶，沿东西向的小巷两边排开；州衙占西北一块
  const ys = far ? 1.6 : 1;
  const yardC = [-170, -220];
  const yard = { x0: yardC[0] - 130 * ys, x1: yardC[0] + 130 * ys, z0: yardC[1] - 110 * ys, z1: yardC[1] + 110 * ys };
  const inYard = (x, z, pad = 0) => x > yard.x0 - pad && x < yard.x1 + pad && z > yard.z0 - pad && z < yard.z1 + pad;
  const walls = [[1, 1, 1], [0.95, 0.92, 0.84], [0.9, 0.88, 0.84], [0.97, 0.9, 0.78]];
  const treeSpots = [];
  const laneStep = far ? 300 : 150;
  const laneEdge = far ? 450 : 525;
  const block = far ? 400 : 200;
  for (let lane = -laneEdge; lane <= laneEdge; lane += laneStep) {
    for (const side of [-1, 1]) {
      const z = cz + lane + side * 25 * kh;
      if (Math.abs(z - cz) > 532 || Math.abs(z - cz) < 30 * kh) continue;
      let x = cx - 540;
      while (x < cx + 540) {
        const L = (30 + rnd() * 30) * kh;
        const xc = x + L / 2;
        const laneX = Math.abs((((xc - cx + 2000) % block) + block) % block - block / 2);
        const blocked = Math.abs(xc - cx) < 22 + L / 2 || laneX < 8 + L / 2 || inYard(xc - cx, z - cz, 26) || xc + L / 2 > cx + 540;
        if (!blocked && rnd() > 0.08) {
          const wt = walls[Math.floor(rnd() * walls.length)];
          const g = 0.9 + rnd() * 0.2;
          addHouse(B.main, xc, GROUND, z, 0, L, (19 + rnd() * 5) * kh, (10.5 + rnd() * 3) * kh, (8.5 + rnd() * 3) * kh, wt, [g, g, g * 1.01], false);
          if (!far && rnd() < 0.3) {
            const l2 = 18 + rnd() * 8;
            addHouse(B.main, xc + (rnd() - 0.5) * (L - 16), GROUND, z + side * 30, Math.PI / 2, l2, 15, 9.5, 7.5, wt, [g, g, g], false);
          } else if (rnd() < 0.45) treeSpots.push([xc + (rnd() - 0.5) * L, z + side * (30 + rnd() * 16) * kh]);
        }
        x += L + (5 + rnd() * 9) * kh;
      }
    }
  }
  // 州衙：前后三进，四面围墙
  const yc = [cx + yardC[0], cz + yardC[1]];
  const Y = (dx, dz, ry = 0) => T(yc[0] + dx * ys, GROUND, yc[1] + dz * ys, ry, ys);
  addTower(B.main, Y(0, -50), { W: 84, D: 34, H1: 16, nxc: 6, nzc: 3, ov1: 11, roofH: 19, wall: 'plaster', lift: 4 });
  addTower(B.main, Y(0, 22), { W: 66, D: 26, H1: 13, nxc: 5, nzc: 3, ov1: 9, roofH: 15, wall: 'plaster', lift: 3 });
  if (!far) {
    for (const sx of [-1, 1]) addHouse(B.main, yc[0] + sx * 84, GROUND, yc[1] - 6, Math.PI / 2, 84, 20, 11, 9, [1, 1, 1], [1, 1, 1], false);
    addHouse(B.main, yc[0], GROUND, yc[1] + 84, 0, 46, 18, 11, 9, [1, 1, 1], [1, 1, 1], false);
    for (const [dx, dz, w, d] of [[0, -105, 236, 3], [-117, -8, 3, 196], [117, -8, 3, 196]]) B.main.add('plaster', box(w, 8, d), T(yc[0] + dx, GROUND, yc[1] + dz), [0.93, 0.9, 0.84]);
    for (const sx of [-1, 1]) B.main.add('plaster', box(92, 8, 3), T(yc[0] + sx * 71, GROUND, yc[1] + 90), [0.93, 0.9, 0.84]);
  }
  treeSpots.push([yc[0] - 60 * ys, yc[1] - 10 * ys], [yc[0] + 58 * ys, yc[1] - 4 * ys], [yc[0] - 30 * ys, yc[1] + 56 * ys]);
  return treeSpots;
}

/** 北面和东面的石岸：城墙脚下一条石台，斜着下到水里；东门外有一道石阶 */
function buildBerm(base) {
  const W = WALLRECT;
  const fb = new FB();
  const yT = GROUND + 1.6;
  const yB = yOf(LEVEL.normal - 3.6);
  const o1 = 82;
  const o2 = 106;
  const A = [W.x0 - 34, W.z0 - o1];
  const B = [W.x1 + o1, W.z0 - o1];
  const C = [W.x1 + o1, W.z1 + 34];
  const A2 = [W.x0 - 34, W.z0 - o2];
  const B2 = [W.x1 + o2, W.z0 - o2];
  const C2 = [W.x1 + o2, W.z1 + 34];
  const P = (p, y) => [p[0], y, p[1]];
  const U = 48;
  const nl = Math.hypot(yT - yB, o2 - o1);
  // 贴图：顶面按 x、z 铺；斜面顺着岸铺，一皮一皮往下
  const uvTop = (...q) => q.map((v) => [v[0] / U, v[2] / U]);
  const uvN = (...q) => q.map((v) => [v[0] / U, v[1] === yT ? nl / U : 0]);
  const uvE = (...q) => q.map((v) => [v[2] / U, v[1] === yT ? nl / U : 0]);
  const quad = (a, b, c, d, n, uvf, cols) => fb.quad(a, b, c, d, n, uvf(a, b, c, d), cols);
  // 顶面
  quad(P([W.x0 - 34, W.z0 + 10], yT), P([W.x1 + o1, W.z0 + 10], yT), P(B, yT), P(A, yT), [0, 1, 0], uvTop, [1.1, 1.1, 1.1, 1.1]);
  quad(P([W.x1 - 10, W.z0 + 10], yT), P([W.x1 + o1, W.z0 + 10], yT), P(C, yT), P([W.x1 - 10, W.z1 + 34], yT), [0, 1, 0], uvTop, [1.1, 1.1, 1.1, 1.1]);
  // 斜面：越靠水越深
  const sl = [1.0, 1.0, 0.7, 0.7];
  quad(P(A, yT), P(B, yT), P(B2, yB), P(A2, yB), [0, (o2 - o1) / nl, -(yT - yB) / nl], uvN, sl);
  quad(P(B, yT), P(C, yT), P(C2, yB), P(B2, yB), [(yT - yB) / nl, (o2 - o1) / nl, 0], uvE, sl);
  // 两头
  quad(P(A, yT), P(A2, yB), P([A[0], W.z0 + 10], yB), P([A[0], W.z0 + 10], yT), [-1, 0, 0], uvE, [1, 0.7, 0.7, 1]);
  quad(P(C, yT), P(C2, yB), P([W.x1 - 10, C[1]], yB), P([W.x1 - 10, C[1]], yT), [0, 0, 1], uvN, [1, 0.7, 0.7, 1]);
  base.add('stone', fb.geo());
  // 东门外的石阶和系船桩
  const cz = (W.z0 + W.z1) / 2;
  for (let s = 0; s < 6; s++) {
    base.add('stone', box(11, yT - yB - s * 5.2, 62 - s * 3), T(W.x1 + o1 + 4 + s * 7.6, yB, cz), [1.08, 1.08, 1.08]);
  }
  for (const dz of [-52, 52, -150, 150]) base.add('timber', cyl(1.6, 9, 6), T(W.x1 + o1 - 5, yT, cz + dz));
}

/** 堤：东南那一道，从戏马台山脚接到城墙；城里贴着城墙又一道 */
function buildDike(dk) {
  const top = yOf(45.1);
  const sec = [[34, -14], [8, top], [-8, top], [-34, -14]];
  const shade = (y) => lerp(0.82, 1.02, smoothstep(-10, top, y));
  for (let i = 0; i < DIKE_PTS.length - 1; i++) {
    const [ax, az] = DIKE_PTS[i];
    const [bx, bz] = DIKE_PTS[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const ry = Math.atan2(-(bz - az), bx - ax);
    dk.add('earth', prism(sec, len + 26, { shade, topShade: 1.12, uvScale: 30 }), T((ax + bx) / 2, 0, (az + bz) / 2, ry));
  }
  const W = WALLRECT;
  const inner = [[15, GROUND - 2], [6, GROUND + 15], [-6, GROUND + 15], [-15, GROUND - 2]];
  const off = WALL_BASE_HALF + 15;
  const cx = (W.x0 + W.x1) / 2;
  const cz = (W.z0 + W.z1) / 2;
  const hx = (W.x1 - W.x0) / 2;
  const hz = (W.z1 - W.z0) / 2;
  const sh2 = (y) => lerp(0.86, 1.0, smoothstep(GROUND, GROUND + 15, y));
  dk.add('earth', prism(inner, 2 * hx - 2 * off + 12, { shade: sh2, topShade: 1.1 }), T(cx, 0, W.z1 - off));
  dk.add('earth', prism(inner, 2 * hz - 2 * off + 12, { shade: sh2, topShade: 1.1 }), T(W.x1 - off, 0, cz, Math.PI / 2));
  dk.add('earth', prism(inner, 2 * hz - 2 * off + 12, { shade: sh2, topShade: 1.1 }), T(W.x0 + off, 0, cz, Math.PI / 2));
}

/** 戏马台：土丘上一座夯土高台，台上一座殿。K 是远看时放大的倍数 */
function buildXimatai(b, td, K) {
  const [x, z] = PLACE.ximatai;
  const y = yOf(td.sample(x, z)) - 4;
  const M = T(x, y, z, 0, K);
  const m = (dx, dy, dz) => M.clone().multiply(T(dx, dy, dz));
  const fb = new FB();
  const h = 30;
  const skirt = K > 1 ? 34 : 0; // 放大以后台子比土丘顶宽，往下接一截，免得悬空
  const b0 = [78 + skirt * 0.3, 60 + skirt * 0.3];
  const b1 = [62, 46];
  const corners = (s, yy) => [[-s[0], yy, -s[1]], [s[0], yy, -s[1]], [s[0], yy, s[1]], [-s[0], yy, s[1]]];
  const lo = corners(b0, -skirt);
  const hi = corners(b1, h);
  fb.quad(hi[0], hi[1], hi[2], hi[3], [0, 1, 0], [[0, 0], [2.6, 0], [2.6, 2], [0, 2]], [1.12, 1.12, 1.12, 1.12]);
  const ns = [[0, 0.45, -1], [1, 0.45, 0], [0, 0.45, 1], [-1, 0.45, 0]];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const n = ns[i];
    const l = Math.hypot(...n);
    const len = i % 2 === 0 ? 2 * b0[0] : 2 * b0[1];
    fb.quad(lo[i], lo[j], hi[j], hi[i], n.map((v) => v / l), [[0, 0], [len / 48, 0], [len / 48, (h + skirt) / 44], [0, (h + skirt) / 44]], [0.84, 0.84, 1, 1]);
  }
  b.add('stone', fb.geo(), M, [1.0, 0.97, 0.9]);
  // 北面的台阶
  for (let s = 0; s < 7; s++) b.add('stone', box(26, h - s * 4.4, 7), m(0, 0, -b0[1] + 4 - s * 6.4), [1.08, 1.06, 1.0]);
  // 台边矮墙
  for (const sz of [-1, 1]) b.add('stone', box(2 * b1[0], 3.4, 2.2), m(0, h, sz * (b1[1] - 1.2)), [1.1, 1.08, 1.02]);
  for (const sx of [-1, 1]) b.add('stone', box(2.2, 3.4, 2 * b1[1]), m(sx * (b1[0] - 1.2), h, 0), [1.1, 1.08, 1.02]);
  addTower(b, m(0, h, 4), { W: 70, D: 30, H1: 15, nxc: 6, nzc: 3, ov1: 11, roofH: 18, wall: 'plaster', lift: 4.5 });
}

function rockGeo(seed, detail) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 0.72 + 0.56 * fbm(x * 1.3 + seed * 3.7, z * 1.3 + y * 1.1 - seed, 2, seed);
    p.setXYZ(i, x * k, Math.max(-0.25, y) * k * 0.72, z * k);
  }
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const s = lerp(0.72, 1.22, smoothstep(-0.2, 0.7, p.getY(i)));
    col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = s;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const nr = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const l = Math.hypot(p.getX(i), p.getY(i) * 1.6, p.getZ(i)) || 1;
    nr[i * 3] = p.getX(i) / l;
    nr[i * 3 + 1] = (p.getY(i) * 1.6) / l;
    nr[i * 3 + 2] = p.getZ(i) / l;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
  return g;
}

/** 百步洪的乱石（K 是远看时放大的倍数）、黄茅冈上“如群羊”的石头 */
function buildRocks(b, td, rnd, K) {
  const [bx, bz] = PLACE.baibuhong;
  const dir = [0.3, 0.95];
  const wy = yOf(LEVEL.normal);
  const hw = RIVER_PATHS.joined.w / 2;
  const n = K > 1 ? 22 : 54;
  for (let i = 0; i < n; i++) {
    const along = (rnd() - 0.5) * (K > 1 ? 560 : 520);
    const across = (rnd() - 0.5) * (2 * hw - 60);
    const x = bx + dir[0] * along + dir[1] * across;
    const z = bz + dir[1] * along - dir[0] * across;
    if (td.sampleEdge(x, z) > -10) continue;
    const s = (10 + rnd() * rnd() * 30) * K;
    b.add('rock', rockGeo(i + 1, 1), T(x, wy - 1.5, z, rnd() * 6.28, s, s * (0.7 + rnd() * 0.5), s * (0.7 + rnd() * 0.6)));
  }
  if (K > 1) return;
  // 两岸的青石
  for (let i = 0; i < 16; i++) {
    const along = (rnd() - 0.5) * 560;
    const side = rnd() < 0.5 ? -1 : 1;
    const x = bx + dir[0] * along + dir[1] * side * (hw + 14 + rnd() * 26);
    const z = bz + dir[1] * along - dir[0] * side * (hw + 14 + rnd() * 26);
    const s = 12 + rnd() * 16;
    b.add('rock', rockGeo(i + 60, 1), T(x, yOf(td.sample(x, z)) - 1, z, rnd() * 6.28, s, s * 0.8, s), [1.08, 1.08, 1.08]);
  }
  // 黄茅冈：云龙山顶一带
  const [yx, yz] = PLACE.yunlongshan;
  let placed = 0;
  let guard = 0;
  while (placed < 46 && guard++ < 800) {
    const x = yx + (rnd() - 0.5) * 760;
    const z = yz + (rnd() - 0.5) * 980;
    const h = td.sample(x, z);
    if (h < 66) continue;
    const s = 6 + rnd() * 9;
    b.add('rockPale', rockGeo(placed + 100, 0), T(x, yOf(h) - 1, z, rnd() * 6.28, s * 1.4, s, s));
    placed++;
  }
}

/** 村子：茅草顶的几间屋 */
function buildVillages(b, td, K) {
  for (const v of td.villages) {
    const r2 = mulberry32(v.seed);
    const n = K > 1 ? Math.ceil(v.n * 0.6) : v.n;
    for (let k = 0; k < n; k++) {
      const a = r2() * 6.28;
      const d = (20 + r2() * 130) * (K > 1 ? 1.5 : 1);
      const x = v.x + Math.cos(a) * d;
      const z = v.z + Math.sin(a) * d * 0.7;
      const ry = (r2() < 0.5 ? 0 : Math.PI / 2) + (r2() - 0.5) * 0.4;
      const g = 0.92 + r2() * 0.16;
      addHouse(b, x, yOf(td.sample(x, z)) - 1, z, ry, (26 + r2() * 16) * K, (16 + r2() * 4) * K, 8.5 * K, 9 * K, [1, 0.98, 0.94], [g, g, g], true);
    }
  }
}

// ---------- 船 ----------
function boatGeo() {
  const fb = new FB();
  const L = 58;
  const B = 7.6;
  const NS = 8;
  const hull = [0.52, 0.52, 0.52];
  const rail = [1.05, 1.0, 0.95];
  const deck = [1.5, 1.38, 1.2];
  const st = (i) => {
    const s = -1 + (2 * i) / NS;
    const a = Math.abs(s);
    const b = B * (1 - 0.5 * Math.pow(a, 2.4));
    const d = 3.4 + 3.0 * Math.pow(a, 2.6);
    const y0 = -1.6 + 2.6 * Math.pow(a, 3);
    return { x: (s * L) / 2, b, d, y0 };
  };
  for (let i = 0; i < NS; i++) {
    const a = st(i);
    const b = st(i + 1);
    for (const sg of [-1, 1]) {
      fb.quad([a.x, a.y0, sg * a.b * 0.7], [b.x, b.y0, sg * b.b * 0.7], [b.x, b.d, sg * b.b], [a.x, a.d, sg * a.b], [0, -0.3, sg], null, [hull, hull, rail, rail]);
    }
    fb.quad([a.x, a.d - 1.0, -a.b * 0.94], [b.x, b.d - 1.0, -b.b * 0.94], [b.x, b.d - 1.0, b.b * 0.94], [a.x, a.d - 1.0, a.b * 0.94], [0, 1, 0], null, [deck, deck, deck, deck]);
    fb.quad([a.x, a.y0, -a.b * 0.7], [b.x, b.y0, -b.b * 0.7], [b.x, b.y0, b.b * 0.7], [a.x, a.y0, a.b * 0.7], [0, -1, 0], null, [hull, hull, hull, hull]);
  }
  for (const i of [0, NS]) {
    const a = st(i);
    const sg = i === 0 ? -1 : 1;
    fb.quad([a.x, a.y0, -a.b * 0.7], [a.x, a.y0, a.b * 0.7], [a.x, a.d, a.b], [a.x, a.d, -a.b], [sg, 0, 0], null, [hull, hull, rail, rail]);
  }
  // 篷：半圆的席篷
  const matc = [1.9, 1.62, 1.15];
  const mat2 = [1.55, 1.3, 0.92];
  const R = B * 0.86;
  const x0 = -L * 0.2;
  const x1 = L * 0.19;
  const NA = 6;
  for (let k = 0; k < NA; k++) {
    const a0 = (k / NA) * Math.PI;
    const a1 = ((k + 1) / NA) * Math.PI;
    const p = (x, a) => [x, 2.6 + Math.sin(a) * R * 0.95, Math.cos(a) * R];
    const am = (a0 + a1) / 2;
    fb.quad(p(x0, a0), p(x1, a0), p(x1, a1), p(x0, a1), [0, Math.sin(am), Math.cos(am)], null, [matc, matc, matc, matc]);
    for (const [x, sg] of [[x0, -1], [x1, 1]]) fb.quad([x, 2.6, 0], p(x, a0), p(x, a1), p(x, a1), [sg, 0, 0], null, [mat2, mat2, mat2, mat2]);
  }
  const g = fb.geo();
  // 桅杆
  const mast = cyl(0.6, 34, 5).toNonIndexed();
  mast.translate(L * 0.3, 2, 0);
  const mc = new Float32Array(mast.attributes.position.count * 3).fill(0.75);
  mast.setAttribute('color', new THREE.BufferAttribute(mc, 3));
  const merged = new Batch();
  merged.add('boat', g);
  merged.add('boat', mast);
  return merged.build({ boat: null }).children[0].geometry;
}

function instanced(geo, material, list) {
  const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, list.length));
  mesh.count = list.length;
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  list.forEach((it, i) => {
    m.compose(new THREE.Vector3(it.x, it.y, it.z), q.setFromAxisAngle(up, it.ry || 0), new THREE.Vector3(it.sx ?? it.s ?? 1, it.sy ?? it.s ?? 1, it.sz ?? it.s ?? 1));
    mesh.setMatrixAt(i, m);
    if (it.color) mesh.setColorAt(i, c.set(it.color));
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** 大水时系在城下的船：一组一组分开，船头朝着城墙。K 是远看时放大的倍数（船也少摆些） */
function floodBoats(rnd, K) {
  const W = WALLRECT;
  const y = yOf(LEVEL.flood) - 0.6 * K;
  const out = [];
  const gap = 20.5 * K;
  const off0 = 26 + 36 * K + (K > 1 ? 14 : 0);
  const row = (fixed, from, to, axis, ry, off) => {
    let p = from + 40;
    while (p < to - 60) {
      const n = K > 1 ? 2 + Math.floor(rnd() * 3) : 4 + Math.floor(rnd() * 5);
      for (let i = 0; i < n && p < to - 40; i++) {
        const j = (rnd() - 0.5) * 10 * K;
        const o = off + j;
        if (axis === 'z') out.push({ x: fixed + o, y, z: p, ry: ry + (rnd() - 0.5) * 0.12, s: K });
        else out.push({ x: p, y, z: fixed + o, ry: ry + (rnd() - 0.5) * 0.12, s: K });
        p += gap + rnd() * 3 * K;
      }
      p += (46 + rnd() * 70) * (K > 1 ? 1.8 : 1);
    }
  };
  // 东门、北门、西门前留出空
  for (const [a, b] of [[W.z0 - 20, -70], [70, W.z1 - 60]]) row(W.x1, a, b, 'z', 0, off0);
  for (const [a, b] of [[W.x0 - 10, -70], [70, W.x1 + 30]]) row(W.z0, a, b, 'x', Math.PI / 2, -off0);
  for (const [a, b] of [[W.z0 + 10, -70], [70, W.z1 - 330]]) row(W.x0, a, b, 'z', Math.PI, -off0);
  // 第二排，稀一点
  if (K === 1) for (const [a, b] of [[W.z0 + 60, -110], [120, W.z1 - 160]]) row(W.x1, a, b, 'z', 0.2, 26 + 108);
  return out;
}

function calmBoats(rnd, K) {
  const W = WALLRECT;
  const y = yOf(LEVEL.normal) - 0.6 * K;
  const cz = (W.z0 + W.z1) / 2;
  const out = [];
  // 东门石阶两边泊着几条
  const xq = W.x1 + 106 + 22 * K;
  const spots = K > 1 ? [[-110, 1.5], [-250, 1.62], [120, 1.55], [300, 1.5]] : [[-74, 1.45], [-98, 1.62], [-126, 1.5], [70, 1.66], [96, 1.52], [-210, 1.57], [-236, 1.6], [176, 1.5], [330, 1.62], [352, 1.5]];
  for (const [dz, ry] of spots) out.push({ x: xq + (rnd() - 0.5) * 12, y, z: cz + dz, ry, s: K });
  // 北面汴水边两三条，下游两条
  if (K === 1) out.push({ x: -210, y, z: W.z0 - 130, ry: 0.05 }, { x: -160, y, z: W.z0 - 134, ry: -0.04 }, { x: 260, y, z: W.z0 - 128, ry: 0.02 });
  else out.push({ x: -180, y, z: W.z0 - 150, ry: 0.05, s: K });
  out.push({ x: 905, y, z: 1180, ry: 1.75, s: K }, { x: 990, y, z: 1560, ry: 1.9, s: K });
  return out;
}

// ---------- 树 ----------
// 树是一丛一丛的，像画里的点苔：下面深、上面亮（颜色的深浅写在顶点上，树自己的颜色乘上去）。
const RAMP_LO = [0.6, 0.66, 0.76];
const RAMP_HI = [1.32, 1.27, 1.06];

/** 一团叶子：细分过的二十面体，略微不圆，法线是平滑的 */
function lobe(detail, seed, r, ry, x, y, z, yLo, yHi) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const n = new Float32Array(p.count * 3);
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    let px = p.getX(i);
    let py = p.getY(i);
    let pz = p.getZ(i);
    const k = 0.86 + 0.28 * fbm(px * 1.7 + seed * 5.3, pz * 1.7 + py * 1.3 - seed * 2.1, 2, seed);
    px *= k;
    py *= k;
    pz *= k;
    const l = Math.hypot(px, py * 1.25, pz) || 1;
    n[i * 3] = px / l;
    n[i * 3 + 1] = (py * 1.25) / l;
    n[i * 3 + 2] = pz / l;
    const wy = y + py * ry;
    const t = smoothstep(yLo, yHi, wy) * (0.82 + 0.18 * (py * 0.5 + 0.5));
    col[i * 3] = lerp(RAMP_LO[0], RAMP_HI[0], t);
    col[i * 3 + 1] = lerp(RAMP_LO[1], RAMP_HI[1], t);
    col[i * 3 + 2] = lerp(RAMP_LO[2], RAMP_HI[2], t);
    p.setXYZ(i, x + px * r, wy, z + pz * r);
  }
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** 近看的树：五团叶子一根干。detail 是叶团分得多细（最近的几棵分细一档，轮廓才圆） */
function clumpGeo(detail = 1) {
  const b = new Batch();
  const lobes = [[0, 17, 0, 12.5, 10.5], [9.5, 11, 4, 9.5, 8], [-8.5, 10.5, -5.5, 10, 8], [1.5, 10, -9, 8.5, 7], [-2.5, 9.5, 8.5, 8.5, 7]];
  lobes.forEach(([x, y, z, r, ry], i) => b.add('m', lobe(detail, i + 1, r, ry, x, y, z, 3, 27)));
  const trunk = cyl(1.7, 9, 5, 1.2).toNonIndexed();
  const tc = new Float32Array(trunk.attributes.position.count * 3);
  for (let i = 0; i < tc.length; i += 3) {
    tc[i] = 1.05;
    tc[i + 1] = 0.55;
    tc[i + 2] = 0.42;
  }
  trunk.setAttribute('color', new THREE.BufferAttribute(tc, 3));
  b.add('m', trunk);
  return b.build({ m: null }).children[0].geometry;
}
/** 稍远的树只是一粒“苔点”：压扁的一团 */
function blobGeo(detail) {
  return lobe(detail, 7, 1, 0.8, 0, 0.62, 0, -0.1, 1.3);
}

function plantTrees(td, rnd, cityTrees, villages) {
  const blobs = [];
  const fine = [];
  const W = WALLRECT;
  const greens = [PAL.tree, PAL.tree, PAL.treeBlue, PAL.treeOlive];
  const pick = () => greens[Math.floor(rnd() * greens.length)];
  const okGround = (x, z) => td.sampleEdge(x, z) > 30 && !(x > W.x0 - 40 && x < W.x1 + 110 && z > W.z0 - 110 && z < W.z1 + 40);
  const put = (list, t) => {
    t.wet = td.sampleWet(t.x, t.z); // 水看到的地面有多高（城里、堤后面算干的）
    list.push(t);
  };
  // 山上：成丛的苔点，山脚到山腰多
  let guard = 0;
  let nHill = 0;
  while (nHill < 1150 && guard++ < 60000) {
    const x = lerp(CROP.x0 + 60, CROP.x1 - 60, rnd());
    const z = lerp(CROP.z0 + 60, CROP.z1 - 60, rnd());
    const h = td.sample(x, z);
    const r = h - 40;
    if (r < 3.5) continue;
    const dens = smoothstep(3.5, 9, r) * (1 - 0.75 * smoothstep(40, 95, r)) * (0.35 + 0.65 * smoothstep(0.42, 0.62, fbm(x / 260, z / 260, 3, 77)));
    if (rnd() > dens) continue;
    const n = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const xx = x + (rnd() - 0.5) * 70;
      const zz = z + (rnd() - 0.5) * 70;
      const s = 13 + rnd() * 12;
      put(blobs, { kind: 'hill', lead: k === 0, x: xx, y: yOf(td.sample(xx, zz)) - 2, z: zz, s, sy: s * (0.8 + rnd() * 0.5), ry: rnd() * 6.28, color: r > 45 ? PAL.treeBlue : pick() });
      nHill++;
    }
  }
  // 河边的柳
  for (const [name, pts] of Object.entries(td.dense)) {
    const hw = RIVER_PATHS[name].w / 2;
    for (let i = 3; i < pts.length - 3; i += 2) {
      if (rnd() < 0.42) continue;
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const l = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / l;
      const nz = (bx - ax) / l;
      const side = rnd() < 0.5 ? -1 : 1;
      const off = hw + 34 + rnd() * 90;
      const x = ax + nx * side * off;
      const z = az + nz * side * off;
      if (x < CROP.x0 + 80 || x > CROP.x1 - 80 || z < CROP.z0 + 80 || z > CROP.z1 - 80) continue;
      const e = td.sampleEdge(x, z);
      if (e < 22 || e > 160 || !okGround(x, z)) continue;
      const s = 14 + rnd() * 9;
      put(blobs, { kind: 'willow', lead: true, x, y: yOf(td.sample(x, z)) - 2, z, s, sy: s * 1.25, ry: rnd() * 6.28, color: PAL.willow });
    }
  }
  // 村子四周
  for (const v of villages) {
    const r2 = mulberry32(v.seed + 9);
    for (let k = 0; k < 7 + v.n; k++) {
      const a = r2() * 6.28;
      const d = 60 + r2() * 190;
      const x = v.x + Math.cos(a) * d;
      const z = v.z + Math.sin(a) * d;
      const s = 14 + r2() * 10;
      put(blobs, { kind: 'village', lead: k % 3 === 0, x, y: yOf(td.sample(x, z)) - 2, z, s, sy: s * 1.1, ry: r2() * 6.28, color: r2() < 0.3 ? PAL.willow : pick() });
    }
  }
  // 路边、平地上零星几棵
  guard = 0;
  let lone = 0;
  while (lone < 150 && guard++ < 6000) {
    const x = lerp(CROP.x0 + 200, CROP.x1 - 200, rnd());
    const z = lerp(CROP.z0 + 200, CROP.z1 - 200, rnd());
    if (td.sample(x, z) > 42.5 || !okGround(x, z) || td.sampleEdge(x, z) < 60) continue;
    if (fbm(x / 500, z / 500, 2, 91) < 0.52) continue;
    const s = 13 + rnd() * 9;
    put(blobs, { kind: 'lone', x, y: yOf(td.sample(x, z)) - 2, z, s, sy: s * 1.1, ry: rnd() * 6.28, color: pick() });
    lone++;
  }
  // 城里的院子
  for (const [x, z] of cityTrees) {
    const s = 15 + rnd() * 7;
    put(blobs, { kind: 'city', x, y: GROUND - 2, z, s, sy: s * 1.15, ry: rnd() * 6.28, color: pick() });
  }
  // 手摆的几处：东门外的石岸上、对岸、戏马台四周
  const cz = (W.z0 + W.z1) / 2;
  for (const [dz, s, c] of [
    [-168, 1.25, PAL.willow],
    [-260, 1.0, PAL.willow],
    [150, 1.15, PAL.willow],
    [250, 0.95, PAL.tree],
    [420, 1.2, PAL.willow],
    [-430, 1.1, PAL.treeBlue],
  ]) {
    put(fine, { kind: 'bank', x: W.x1 + 62, y: GROUND + 1.6, z: cz + dz, s, ry: rnd() * 6.28, color: c });
  }
  for (let k = 0; k < 16; k++) {
    const z = cz - 700 + k * 92 + rnd() * 40;
    const x = W.x1 + 215 + RIVER_PATHS.joined.w / 2 + 40 + rnd() * 70 + (z > 300 ? (z - 300) * 0.17 : 0);
    if (td.sampleEdge(x, z) < 24) continue;
    put(fine, { kind: 'far-bank', x, y: yOf(td.sample(x, z)) - 1, z, s: 0.62 + rnd() * 0.3, ry: rnd() * 6.28, color: rnd() < 0.55 ? PAL.willow : pick() });
  }
  const [mx, mz] = PLACE.ximatai;
  for (const [dx, dz] of [[-120, 40], [-104, -40], [118, 60], [124, -24], [-40, 96], [60, 104], [150, 130], [-150, -90]]) {
    const x = mx + dx;
    const z = mz + dz;
    put(fine, { kind: 'ximatai', x, y: yOf(td.sample(x, z)) - 1, z, s: 0.9 + rnd() * 0.4, ry: rnd() * 6.28, color: pick() });
  }
  return { blobs, fine };
}

// ---------- 总装 ----------
export function buildModels(td) {
  const mats = makeMaterials();
  const W = WALLRECT;
  const base = new Batch();
  const near = new Batch();
  const early = new Batch();
  const after = new Batch();
  const far = new Batch();
  const farWall = new Batch();
  const earlyFar = new Batch();
  const afterFar = new Batch();
  const calmFarB = new Batch();
  const dike = new Batch();
  const floodOnly = new Batch();

  const cityTrees = buildCity({ wall: near, main: near, early, after }, mulberry32(10770821), NEAR);
  const cityTreesFar = buildCity({ wall: farWall, main: far, early: earlyFar, after: afterFar }, mulberry32(10770821), FAR);
  buildBerm(base);
  buildDike(dike);
  buildXimatai(near, td, 1);
  buildXimatai(far, td, 2.0);
  buildRocks(near, td, mulberry32(1078), 1);
  buildRocks(calmFarB, td, mulberry32(1078), 2.4);
  buildVillages(near, td, 1);
  buildVillages(far, td, 2.5);

  // 放鹤亭（水退以后才有）和张山人的草屋
  const [fx, fz] = PLACE.fangheting;
  const fy = yOf(td.sample(fx, fz)) - 2;
  addPavilion(after, T(fx, fy, fz), { S: 26, H: 13, roofH: 15, ov: 8 });
  addPavilion(afterFar, T(fx, fy, fz, 0, 2.2), { S: 26, H: 13, roofH: 15, ov: 8 });
  addHouse(base, fx - 330, yOf(td.sample(fx - 330, fz + 120)) - 1, fz + 120, 0.5, 32, 18, 9, 9, [1, 1, 1], [1, 1, 1], true);

  // 大水时城墙上搭的棚子
  for (const [x, z, ry] of [[W.x1, W.z1 - 150, Math.PI / 2], [W.x1, W.z1 - 330, Math.PI / 2], [W.x1 - 210, W.z1, 0], [W.x1, -210, Math.PI / 2]]) {
    addHouse(floodOnly, x, WALL_TOP, z, ry, 22, 12, 7, 6, [1, 0.98, 0.92], [1, 1, 1], true);
  }

  const group = new THREE.Group();
  const gBase = base.build(mats);
  const gNear = near.build(mats);
  const gEarly = early.build(mats);
  const gAfter = after.build(mats);
  const gDike = dike.build(mats);
  const gFlood = floodOnly.build(mats);
  const gFar = far.build(mats);
  const gFarWall = farWall.build(mats);
  gFarWall.scale.y = FAR.ky;
  gFar.add(gFarWall);
  const gEarlyFar = earlyFar.build(mats);
  const gAfterFar = afterFar.build(mats);
  const gCalmFar = calmFarB.build(mats);

  // 船
  const boatMat = new THREE.MeshLambertMaterial({ color: PAL.boat, vertexColors: true });
  const bg = boatGeo();
  const rb = mulberry32(1079);
  gFlood.add(instanced(bg, boatMat, floodBoats(rb, 1)));
  const gCalm = new THREE.Group();
  gCalm.add(instanced(bg, boatMat, calmBoats(rb, 1)));
  const gFloodFar = new THREE.Group();
  gFloodFar.add(instanced(bg, boatMat, floodBoats(rb, 2.3)));
  gCalmFar.add(instanced(bg, boatMat, calmBoats(rb, 2.3)));

  // 树：同一批树，按镜头分几套摆法
  const trees = plantTrees(td, mulberry32(1037), cityTrees, td.villages);
  const treeMat = new THREE.MeshLambertMaterial({ color: '#ffffff', vertexColors: true });
  const gClump = clumpGeo(1);
  const gClumpHi = clumpGeo(2);
  const gBlob1 = blobGeo(1);
  const gBlob0 = blobGeo(0);
  const asClump = (t) => (t.kind === 'city' || t.sy ? { ...t, s: t.s / 17, sx: undefined, sy: undefined, sz: undefined, y: t.y + 2 } : t);
  const dry = (lv) => (t) => t.wet > lv - 1; // 淹在水下一米多的树不摆
  /** 近看的一套：手摆的树细做，城四周三公里里的用圆一点的苔点，再远用最省的 */
  const nearSet = (keep, farRound = false) => {
    const R_NEAR = 3000;
    const g = new THREE.Group();
    const bl = trees.blobs.filter(keep);
    const farOnes = bl.filter((t) => Math.hypot(t.x, t.z) >= R_NEAR);
    g.add(instanced(gClump, treeMat, trees.fine.filter(keep)));
    if (farRound) {
      // 远山上的树也用圆一点的苔点，隔一棵摆一棵、略放大，三角形数差不多
      g.add(instanced(gBlob1, treeMat, [...bl.filter((t) => Math.hypot(t.x, t.z) < R_NEAR), ...farOnes.filter((t, i) => i % 2 === 0).map((t) => ({ ...t, s: t.s * 1.22, sy: t.sy * 1.22 }))]));
    } else {
      g.add(instanced(gBlob1, treeMat, bl.filter((t) => Math.hypot(t.x, t.z) < R_NEAR)));
      g.add(instanced(gBlob0, treeMat, farOnes));
    }
    return g;
  };
  /** 东门近景：东门六百米里的树都细做；城西、城外看得见的那一片用圆一点的苔点；别处隔一棵摆一棵，用最省的 */
  const closeSet = () => {
    const g = new THREE.Group();
    const d = (t) => Math.hypot(t.x - W.x1, t.z);
    const inView = (t) => t.x < W.x1 + 500 && Math.abs(t.z) < (W.x1 - t.x) * 0.75 + 900;
    const bl = trees.blobs;
    g.add(instanced(gClumpHi, treeMat, trees.fine.filter((t) => t.kind === 'bank')));
    g.add(instanced(gClump, treeMat, [...trees.fine.filter((t) => t.kind !== 'bank'), ...bl.filter((t) => d(t) < 620).map(asClump)]));
    g.add(instanced(gBlob1, treeMat, bl.filter((t, i) => d(t) >= 620 && inView(t) && (d(t) < 2600 || i % 2 === 0))));
    g.add(instanced(gBlob0, treeMat, bl.filter((t, i) => d(t) >= 620 && !inView(t) && i % 2 === 0)));
    return g;
  };
  /** 远看的一套：三棵里留一棵，放大两倍多，颜色淡一点，成了一簇一簇的苔点；平地上零星的树不摆 */
  const dotColor = (t) => (t.color === PAL.willow ? '#86a077' : t.color === PAL.treeBlue ? '#55806f' : t.color === PAL.treeOlive ? '#778a5c' : PAL.dot);
  const dotSet = (keep) => {
    const g = new THREE.Group();
    const list = [];
    let i = 0;
    for (const t of trees.blobs) {
      if (t.kind === 'lone' || t.kind === 'city' || !keep(t)) continue;
      if (i++ % 3 !== 0) continue;
      const k = 2.4;
      list.push({ ...t, s: t.s * k, sy: t.sy * k * 0.9, color: dotColor(t) });
    }
    // 城里：远看那一套屋顶之间的空地上点几丛
    const ct = [];
    const rc = mulberry32(88);
    cityTreesFar.forEach(([x, z], j) => {
      if (j % 2 === 0) ct.push({ x, y: GROUND - 2, z, s: 28 + rc() * 12, sy: 30, ry: rc() * 6.28, color: PAL.dot });
    });
    for (const t of trees.fine) if (t.kind === 'ximatai' && keep(t) && list.length % 2 === 0) list.push({ ...t, s: 24, sy: 22, y: t.y - 2, color: PAL.dot });
    g.add(instanced(gBlob1, treeMat, [...list, ...ct]));
    return g;
  };
  const sets = {
    base: gBase,
    near: gNear,
    far: gFar,
    early: gEarly,
    earlyFar: gEarlyFar,
    after: gAfter,
    afterFar: gAfterFar,
    dike: gDike,
    flood: gFlood,
    floodFar: gFloodFar,
    calm: gCalm,
    calmFar: gCalmFar,
    trees: nearSet(() => true),
    treesRising: nearSet(dry(41.3)),
    treesFlood: nearSet(dry(LEVEL.flood), true),
    treesClose: closeSet(),
    dots: dotSet(() => true),
    dotsFlood: dotSet(dry(LEVEL.flood)),
  };
  for (const g of Object.values(sets)) group.add(g);
  return { group, sets, info: { trees: trees.blobs.length, fine: trees.fine.length } };
}

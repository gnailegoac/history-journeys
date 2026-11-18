// 城：城墙、四座城门和门楼、四个角楼、城里的房子。东门上的黄楼另做一个，水退以后才摆上去。
import * as THREE from 'three';
import { U, CITY_M, CITY_STREETS, LEVELS_M, yOf } from './terrain.js';
import { PAL } from './palette.js';
import { box, shadedBox, latticeWindow, taper, chineseRoof, gableRoof, houseBody, merge, moved, paint } from './kit.js';
import { mulberry32 } from './util.js';

export const WALL = { h: 0.62, baseHalf: 0.27, topHalf: 0.19 };
export const CITY_Y = yOf(LEVELS_M.city);
const X0 = CITY_M.minX * U;
const X1 = CITY_M.maxX * U;
const Z0 = CITY_M.minZ * U;
const Z1 = CITY_M.maxZ * U;
export const GATES = {
  east: { x: X1, z: 0, out: [1, 0] },
  west: { x: X0, z: 0, out: [-1, 0] },
  south: { x: 0, z: Z1, out: [0, 1] },
  north: { x: 0, z: Z0, out: [0, -1] },
};

function quad(pos, uv, a, b, c, d, n, uvs) {
  // 按想要的法线方向决定绕向
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cr = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  const ok = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] > 0;
  if (ok) {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    uv.push(...uvs[0], ...uvs[1], ...uvs[2], ...uvs[0], ...uvs[2], ...uvs[3]);
  } else {
    pos.push(...a, ...c, ...b, ...a, ...d, ...c);
    uv.push(...uvs[0], ...uvs[2], ...uvs[1], ...uvs[0], ...uvs[3], ...uvs[2]);
  }
}

const BRICK = 5.2; // 砖纹的密度

/** 一段城墙：外面收分，顶上是走道。out 是朝外的方向。 */
function wallRun(ax, az, bx, bz, out) {
  const { h, baseHalf: hb, topHalf: ht } = WALL;
  const y0 = CITY_Y;
  const len = Math.hypot(bx - ax, bz - az);
  const P = (x, z, o, y) => [x + out[0] * o, y, z + out[1] * o];
  const faces = [];
  const mk = (a, b, c, d, n, uvs, hex) => {
    const pos = [];
    const uv = [];
    quad(pos, uv, a, b, c, d, n, uvs);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    paint(g, hex);
    // 墙脚压暗一点，像贴着地
    const cArr = g.attributes.color;
    const pArr = g.attributes.position;
    for (let i = 0; i < pArr.count; i++) {
      const k = pArr.getY(i) < y0 + 0.1 ? 0.74 : 1.04;
      cArr.setXYZ(i, cArr.getX(i) * k, cArr.getY(i) * k, cArr.getZ(i) * k);
    }
    faces.push(g);
  };
  const drop = 0.55;
  const hbOut = hb + ((hb - ht) * drop) / h;
  const uvFace = (hh) => [
    [0, 0],
    [len * BRICK, 0],
    [len * BRICK, hh * BRICK],
    [0, hh * BRICK],
  ];
  // 外面
  mk(P(ax, az, hbOut, y0 - drop), P(bx, bz, hbOut, y0 - drop), P(bx, bz, ht, y0 + h), P(ax, az, ht, y0 + h), [out[0], 0.3, out[1]], uvFace(h + drop), PAL.wall);
  // 里面
  mk(P(ax, az, -hb, y0 - 0.1), P(bx, bz, -hb, y0 - 0.1), P(bx, bz, -ht, y0 + h), P(ax, az, -ht, y0 + h), [-out[0], 0.3, -out[1]], uvFace(h + 0.1), PAL.wall);
  // 顶
  const z4 = [
    [0, 0],
    [0.01, 0],
    [0.01, 0.01],
    [0, 0.01],
  ];
  mk(P(ax, az, ht, y0 + h), P(bx, bz, ht, y0 + h), P(bx, bz, -ht, y0 + h), P(ax, az, -ht, y0 + h), [0, 1, 0], z4, PAL.wallTop);
  return faces;
}

/** 沿一条边摆垛口。 */
function merlons(ax, az, bx, bz, out, off, y, parts, step = 0.21) {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.floor(len / step));
  const dx = (bx - ax) / len;
  const dz = (bz - az) / len;
  const along = Math.abs(dx) > 0.5;
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) / n) * len;
    const x = ax + dx * t + out[0] * off;
    const z = az + dz * t + out[1] * off;
    parts.push(flatUv(box(along ? 0.12 : 0.06, 0.085, along ? 0.06 : 0.12, PAL.wallTop, x, y, z)));
  }
  // 垛口下面一道矮墙
  const mx = (ax + bx) / 2 + out[0] * off;
  const mz = (az + bz) / 2 + out[1] * off;
  parts.push(flatUv(box(along ? len : 0.06, 0.05, along ? 0.06 : len, PAL.wall, mx, y - 0.01, mz)));
}

/** 贴图坐标缩成一个点：这块东西只要底色，不要砖纹。 */
function flatUv(g) {
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 0.005, 0.005);
  return g;
}

function archPlug(depth, k = 1, hex = '#3B2E25') {
  const s = new THREE.Shape();
  const w = 0.19 * k;
  const hh = 0.26;
  s.moveTo(-w, 0);
  s.lineTo(w, 0);
  s.lineTo(w, hh);
  s.absarc(0, hh, w, 0, Math.PI, false);
  s.lineTo(-w, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 10 });
  g.translate(0, 0, -depth / 2);
  return paint(g, hex);
}

/** 一层的门楼：白墙、朱红柱子、歇山顶。朝向沿 x（面朝 ±z）。 */
function gateTower(wallParts, roofParts, y) {
  const w = 1.3;
  const d = 0.5;
  const h = 0.25;
  wallParts.push(box(w + 0.16, 0.035, d + 0.16, PAL.stone, 0, y, 0));
  wallParts.push(shadedBox(w - 0.06, h, d - 0.06, PAL.plaster, 0, y + 0.035, 0, 0.34, 0.62));
  // 柱子和门窗
  for (let i = 0; i <= 6; i++) {
    const x = -w / 2 + 0.02 + (i * (w - 0.04)) / 6;
    for (const s of [1, -1]) wallParts.push(shadedBox(0.035, h, 0.035, PAL.timber, x, y + 0.035, s * (d / 2 - 0.02), 0.34, 0.62));
  }
  for (let i = 0; i < 6; i++) {
    const x = -w / 2 + 0.02 + ((i + 0.5) * (w - 0.04)) / 6;
    for (const s of [1, -1]) wallParts.push(box(0.13, h * 0.62, 0.012, PAL.window, x, y + 0.06, s * (d / 2 - 0.03)));
  }
  wallParts.push(box(w - 0.02, 0.035, d - 0.02, PAL.timber, 0, y + 0.035 + h - 0.035, 0));
  const r = chineseRoof(w, d, 0.3, { style: 'xieshan', over: 0.17, up: 0.075 });
  roofParts.push(moved(r.roof, 0, y + 0.035 + h, 0));
  wallParts.push(moved(r.trim, 0, y + 0.035 + h, 0));
}

/**
 * 黄楼：两层，墙刷黄土。朝向沿 x（面朝 ±z）。
 * earthParts 是刷了黄土的墙（单独一种材质），wallParts 是木作和石头，roofParts 是瓦。
 */
function huanglou(wallParts, roofParts, y, earthParts) {
  const w1 = 1.52;
  const d1 = 0.66;
  const h1 = 0.3;
  const w2 = 1.12;
  const d2 = 0.42;
  const h2 = 0.27;
  const T = PAL.timberDeep;
  const TD = PAL.timberDark;
  const roofOpt = { gable: PAL.tileDark, fascia: TD };
  wallParts.push(box(w1 + 0.22, 0.045, d1 + 0.22, PAL.stone, 0, y, 0));
  let yy = y + 0.045;
  // 一层：黄土墙，外面一圈柱廊
  earthParts.push(shadedBox(w1 - 0.16, h1, d1 - 0.16, PAL.yellowEarth, 0, yy, 0, 0.36, 0.56));
  // 墙脚一道深一点的勒脚
  wallParts.push(box(w1 - 0.15, 0.03, d1 - 0.15, '#A58F6A', 0, yy, 0));
  for (let i = 0; i <= 7; i++) {
    const x = -w1 / 2 + 0.025 + (i * (w1 - 0.05)) / 7;
    for (const s of [1, -1]) wallParts.push(shadedBox(0.04, h1, 0.04, T, x, yy, s * (d1 / 2 - 0.025), 0.3, 0.6));
  }
  for (let i = 1; i <= 2; i++) {
    const z = -d1 / 2 + 0.025 + (i * (d1 - 0.05)) / 3;
    for (const s of [1, -1]) wallParts.push(shadedBox(0.04, h1, 0.04, T, s * (w1 / 2 - 0.025), yy, z, 0.3, 0.6));
  }
  for (let i = 0; i < 7; i++) {
    const x = -w1 / 2 + 0.025 + ((i + 0.5) * (w1 - 0.05)) / 7;
    const isDoor = i === 3;
    for (const s of [1, -1]) {
      const zz = s * (d1 / 2 - 0.08);
      if (isDoor) {
        // 门：两扇，中间一道缝
        wallParts.push(box(0.15, h1 * 0.78, 0.012, PAL.window, x, yy, zz));
        wallParts.push(box(0.008, h1 * 0.78, 0.008, TD, x, yy, zz + s * 0.008));
        wallParts.push(box(0.17, 0.012, 0.01, TD, x, yy + h1 * 0.78, zz + s * 0.008));
      } else {
        wallParts.push(...latticeWindow(0.11, h1 * 0.5, x, yy + h1 * 0.26, zz, s, PAL.window, TD));
      }
    }
  }
  wallParts.push(box(w1, 0.03, d1, T, 0, yy + h1 - 0.03, 0));
  yy += h1;
  // 腰檐
  const skirt = chineseRoof(w1, d1, 0.2, { style: 'hip', over: 0.2, up: 0.08, rings: 4, ...roofOpt });
  roofParts.push(moved(skirt.roof, 0, yy, 0));
  wallParts.push(moved(skirt.trim, 0, yy, 0));
  // 平座栏杆
  const yb = yy + 0.085;
  wallParts.push(box(w2 + 0.2, 0.02, d2 + 0.2, TD, 0, yb, 0));
  for (const s of [1, -1]) {
    wallParts.push(box(w2 + 0.2, 0.012, 0.012, T, 0, yb + 0.06, s * (d2 / 2 + 0.095)));
    wallParts.push(box(0.012, 0.012, d2 + 0.2, T, s * (w2 / 2 + 0.095), yb + 0.06, 0));
  }
  for (let i = 0; i <= 8; i++) {
    const x = -(w2 + 0.19) / 2 + (i * (w2 + 0.19)) / 8;
    for (const s of [1, -1]) wallParts.push(box(0.014, 0.06, 0.014, T, x, yb + 0.01, s * (d2 / 2 + 0.095)));
  }
  for (let i = 0; i <= 3; i++) {
    const z = -(d2 + 0.19) / 2 + (i * (d2 + 0.19)) / 3;
    for (const s of [1, -1]) wallParts.push(box(0.014, 0.06, 0.014, T, s * (w2 / 2 + 0.095), yb + 0.01, z));
  }
  // 二层
  const y2 = yb + 0.02;
  earthParts.push(shadedBox(w2 - 0.06, h2, d2 - 0.06, PAL.yellowEarth, 0, y2, 0, 0.36, 0.56));
  for (let i = 0; i <= 5; i++) {
    const x = -w2 / 2 + 0.02 + (i * (w2 - 0.04)) / 5;
    for (const s of [1, -1]) wallParts.push(shadedBox(0.036, h2, 0.036, T, x, y2, s * (d2 / 2 - 0.02), 0.3, 0.6));
  }
  for (let i = 0; i < 5; i++) {
    const x = -w2 / 2 + 0.02 + ((i + 0.5) * (w2 - 0.04)) / 5;
    for (const s of [1, -1]) wallParts.push(...latticeWindow(0.13, h2 * 0.5, x, y2 + h2 * 0.26, s * (d2 / 2 - 0.028), s, PAL.window, TD));
  }
  // 两头山墙上各一扇窗（朝 ±x）
  for (const s of [1, -1]) {
    wallParts.push(box(0.012, h2 * 0.5, 0.16, PAL.window, s * (w2 / 2 - 0.028), y2 + h2 * 0.26, 0));
    wallParts.push(box(0.008, h2 * 0.5, 0.011, TD, s * (w2 / 2 - 0.02), y2 + h2 * 0.26, 0.027));
    wallParts.push(box(0.008, h2 * 0.5, 0.011, TD, s * (w2 / 2 - 0.02), y2 + h2 * 0.26, -0.027));
    wallParts.push(box(0.008, 0.011, 0.16, TD, s * (w2 / 2 - 0.02), y2 + h2 * 0.26 + h2 * 0.28, 0));
  }
  wallParts.push(box(w2 - 0.02, 0.035, d2 - 0.02, T, 0, y2 + h2 - 0.035, 0));
  // 檐下正中一块匾
  for (const s of [1, -1]) {
    wallParts.push(box(0.2, 0.075, 0.014, '#2C3B45', 0, y2 + h2 - 0.085, s * (d2 / 2 + 0.004)));
    wallParts.push(box(0.15, 0.04, 0.006, '#C9B27A', 0, y2 + h2 - 0.0675, s * (d2 / 2 + 0.012)));
  }
  const top = chineseRoof(w2, d2, 0.33, { style: 'xieshan', over: 0.2, up: 0.095, rings: 6, seg: 8, ...roofOpt });
  roofParts.push(moved(top.roof, 0, y2 + h2, 0));
  wallParts.push(moved(top.trim, 0, y2 + h2, 0));
}

function rotateParts(parts, from, ry, x, y, z) {
  for (let i = from; i < parts.length; i++) moved(parts[i], x, y, z, ry);
}

/**
 * 建城。返回几个网格：
 *  walls（城墙、城台、垛口）、body（房子的墙和木作）、roofs（瓦顶）、
 *  eastTower（东门上普通的门楼，水来之前）、huanglou（黄楼，水退以后）。
 */
export function buildCity(mats) {
  const group = new THREE.Group();
  const y0 = CITY_Y;
  const yTop = y0 + WALL.h;
  const wallParts = [];
  // 四面墙
  wallParts.push(...wallRun(X0, Z1, X1, Z1, [0, 1]));
  wallParts.push(...wallRun(X1, Z1, X1, Z0, [1, 0]));
  wallParts.push(...wallRun(X1, Z0, X0, Z0, [0, -1]));
  wallParts.push(...wallRun(X0, Z0, X0, Z1, [-1, 0]));
  const sides = [
    [X0, Z1, X1, Z1, [0, 1]],
    [X1, Z1, X1, Z0, [1, 0]],
    [X1, Z0, X0, Z0, [0, -1]],
    [X0, Z0, X0, Z1, [-1, 0]],
  ];
  for (const [ax, az, bx, bz, out] of sides) {
    merlons(ax, az, bx, bz, out, WALL.topHalf - 0.03, yTop, wallParts);
    // 里面一道矮墙
    const mx = (ax + bx) / 2 - out[0] * (WALL.topHalf - 0.02);
    const mz = (az + bz) / 2 - out[1] * (WALL.topHalf - 0.02);
    const len = Math.hypot(bx - ax, bz - az);
    wallParts.push(box(out[0] ? 0.04 : len, 0.05, out[0] ? len : 0.04, PAL.wall, mx, yTop, mz));
  }

  // 马面：墙外每隔一段凸出来的墩台
  for (const [ax, az, bx, bz, out] of sides) {
    const len = Math.hypot(bx - ax, bz - az);
    const dx = (bx - ax) / len;
    const dz = (bz - az) / len;
    for (const t of [-4.25, -2.55, 2.55, 4.25]) {
      const cx = (ax + bx) / 2 + dx * t + out[0] * (WALL.baseHalf + 0.06);
      const cz = (az + bz) / 2 + dz * t + out[1] * (WALL.baseHalf + 0.06);
      const ns = out[1] !== 0;
      const start = wallParts.length;
      wallParts.push(taper(0.66, 0.46, 0.58, 0.38, WALL.h + 0.5, PAL.wall, 0, -0.5, 0, BRICK));
      const mer = [];
      merlons(-0.29, 0.19, 0.29, 0.19, [0, 1], -0.03, WALL.h, mer, 0.19);
      merlons(0.29, -0.19, -0.29, -0.19, [0, -1], -0.03, WALL.h, mer, 0.19);
      merlons(0.29, 0.19, 0.29, -0.19, [1, 0], -0.03, WALL.h, mer, 0.19);
      merlons(-0.29, -0.19, -0.29, 0.19, [-1, 0], -0.03, WALL.h, mer, 0.19);
      wallParts.push(...mer);
      rotateParts(wallParts, start, ns ? 0 : Math.PI / 2, cx, y0, cz);
    }
  }

  const bodyParts = [];
  const roofParts = [];
  const flagParts = [];
  /** 能单独放大的小模型：门楼、角楼。每个是一个组，原点在它的底座上。 */
  const landmarks = [];
  const meshOf = (parts, mat) => {
    const m = new THREE.Mesh(merge(parts), mat);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  const makeLandmark = (x, y, z, ry, build) => {
    const b = [];
    const r = [];
    const e = [];
    build(b, r, 0, e);
    const g = new THREE.Group();
    g.add(meshOf(b, mats.body), meshOf(r, mats.roof));
    if (e.length) g.add(meshOf(e, mats.earth));
    g.position.set(x, y, z);
    g.rotation.y = ry;
    group.add(g);
    return g;
  };
  let eastTower = null;
  let hl = null;

  // 城门
  const GH = 0.8;
  for (const key of Object.keys(GATES)) {
    const g = GATES[key];
    const ns = g.out[1] !== 0; // 南北门：城台沿 x
    const ry = ns ? 0 : Math.PI / 2;
    const cx = g.x + g.out[0] * 0.1;
    const cz = g.z + g.out[1] * 0.1;
    const start = wallParts.length;
    wallParts.push(taper(2.3, 0.98, 2.22, 0.9, GH + 0.5, PAL.wall, 0, -0.5, 0, BRICK));
    wallParts.push(taper(2.37, 1.05, 2.36, 1.04, 0.56, PAL.wallDark, 0, -0.5, 0, BRICK));
    wallParts.push(moved(archPlug(1.0), 0, 0, 0));
    wallParts.push(moved(archPlug(0.972, 1.22, PAL.wallTop), 0, 0, 0));
    const mer = [];
    merlons(-1.11, 0.45, 1.11, 0.45, [0, 1], -0.03, GH, mer, 0.2);
    merlons(1.11, -0.45, -1.11, -0.45, [0, -1], -0.03, GH, mer, 0.2);
    merlons(1.11, 0.45, 1.11, -0.45, [1, 0], -0.03, GH, mer, 0.2);
    merlons(-1.11, -0.45, -1.11, 0.45, [-1, 0], -0.03, GH, mer, 0.2);
    wallParts.push(...mer);
    rotateParts(wallParts, start, ry, cx, y0, cz);
    // 城台上的两面小旗：都朝东飘，立在屋檐够不着的地方
    {
      const fs0 = flagParts.length;
      const poles = ns
        ? [
            [1.04, 0.36, 1, 0],
            [1.04, -0.36, 1, 0],
          ]
        : [
            [1.03, 0.4, 0, 1],
            [-1.03, 0.4, 0, 1],
          ];
      for (const [fx, fz, dx, dz] of poles) {
        flagParts.push(box(0.016, 0.56, 0.016, PAL.timberDark, fx, GH, fz));
        const fg = new THREE.BufferGeometry();
        const y1 = GH + 0.54;
        const tx = fx + dx * 0.22;
        const tz = fz + dz * 0.22;
        const p = [fx, y1, fz, tx, y1 - 0.065, tz, fx, y1 - 0.14, fz, fx, y1, fz, fx, y1 - 0.14, fz, tx, y1 - 0.065, tz];
        fg.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
        fg.computeVertexNormals();
        flagParts.push(paint(fg, PAL.timberDeep));
      }
      rotateParts(flagParts, fs0, ry, cx, y0, cz);
    }
    if (key === 'east') {
      eastTower = makeLandmark(cx, y0 + GH, cz, ry, gateTower);
      hl = makeLandmark(cx, y0 + GH, cz, ry, huanglou);
      landmarks.push(eastTower);
    } else {
      landmarks.push(makeLandmark(cx, y0 + GH, cz, ry, gateTower));
    }
  }

  // 角楼
  for (const [x, z, ox, oz] of [
    [X0, Z0, -1, -1],
    [X1, Z0, 1, -1],
    [X1, Z1, 1, 1],
    [X0, Z1, -1, 1],
  ]) {
    const cx = x + ox * 0.08;
    const cz = z + oz * 0.08;
    const ch = 0.72;
    wallParts.push(taper(0.98, 0.98, 0.9, 0.9, ch + 0.5, PAL.wall, cx, y0 - 0.5, cz, BRICK));
    const mer = [];
    merlons(-0.45, 0.45, 0.45, 0.45, [0, 1], -0.03, 0, mer, 0.2);
    merlons(0.45, -0.45, -0.45, -0.45, [0, -1], -0.03, 0, mer, 0.2);
    merlons(0.45, 0.45, 0.45, -0.45, [1, 0], -0.03, 0, mer, 0.2);
    merlons(-0.45, -0.45, -0.45, 0.45, [-1, 0], -0.03, 0, mer, 0.2);
    for (const m of mer) wallParts.push(moved(m, cx, y0 + ch, cz));
    landmarks.push(
      makeLandmark(cx, y0 + ch, cz, 0, (b, r) => {
        b.push(shadedBox(0.44, 0.2, 0.44, PAL.plaster, 0, 0, 0, 0.36, 0.62));
        for (const sx of [1, -1]) for (const sz of [1, -1]) b.push(shadedBox(0.035, 0.2, 0.035, PAL.timber, sx * 0.215, 0, sz * 0.215, 0.36, 0.62));
        const rf = chineseRoof(0.46, 0.46, 0.25, { style: 'pyramid', over: 0.13, up: 0.06, rings: 4, seg: 4 });
        r.push(moved(rf.roof, 0, 0.2, 0));
        b.push(moved(rf.trim, 0, 0.2, 0));
      }),
    );
  }

  // 城里的房子
  const rnd = mulberry32(2024);
  const treeSpots = [];
  const footprints = [];
  const sx = [-5.2, ...CITY_STREETS.x.map((v) => v * U), 5.2];
  const cuts = (arr) => {
    // 把大街（0）插进去
    const a = arr.slice();
    a.splice(3, 0, 0);
    return a;
  };
  const xs = cuts(sx);
  const zs = cuts(sx);
  const gap = (v) => (v === 0 ? 0.34 : Math.abs(v) > 5 ? 0 : 0.2);
  const wallTones = ['#E9DEC9', '#E2D5BC', '#EDE5D4', '#DCCDB2'];
  const roofTones = [PAL.tile, PAL.tile, PAL.tileDark, '#6E777B', PAL.tile, '#7A7F7C'];
  const addHouse = (x, z, w, d, ry, opts = {}) => {
    const hw = opts.hw ?? 0.13 + rnd() * 0.03;
    const hr = opts.hr ?? 0.1 + rnd() * 0.03;
    const thatch = opts.thatch ?? rnd() < 0.1;
    footprints.push({ x, z, w, d, ry });
    bodyParts.push(moved(houseBody(w, d, hw, hr, opts.wall ?? wallTones[Math.floor(rnd() * wallTones.length)]), x, y0, z, ry));
    roofParts.push(moved(gableRoof(w, d, hr, 0.035, thatch ? PAL.thatch : roofTones[Math.floor(rnd() * roofTones.length)]), x, y0 + hw, z, ry));
  };
  for (let bi = 0; bi < xs.length - 1; bi++) {
    for (let bj = 0; bj < zs.length - 1; bj++) {
      const bx0 = xs[bi] + gap(xs[bi]);
      const bx1 = xs[bi + 1] - gap(xs[bi + 1]);
      const bz0 = zs[bj] + gap(zs[bj]);
      const bz1 = zs[bj + 1] - gap(zs[bj + 1]);
      const isYamen = bi === 2 && bj === 2;
      if (isYamen) {
        // 州衙：一圈矮墙，正堂朝南，两厢，一座门屋
        const cx = (bx0 + bx1) / 2;
        const cz = (bz0 + bz1) / 2;
        const w = bx1 - bx0 - 0.1;
        const d = bz1 - bz0 - 0.1;
        for (const s of [1, -1]) {
          bodyParts.push(box(w, 0.1, 0.04, PAL.plaster, cx, y0, cz + (s * d) / 2));
          bodyParts.push(box(0.04, 0.1, d, PAL.plaster, cx + (s * w) / 2, y0, cz));
          bodyParts.push(box(w + 0.03, 0.02, 0.07, PAL.tile, cx, y0 + 0.1, cz + (s * d) / 2));
          bodyParts.push(box(0.07, 0.02, d + 0.03, PAL.tile, cx + (s * w) / 2, y0 + 0.1, cz));
        }
        bodyParts.push(box(0.86, 0.05, 0.5, PAL.stone, cx, y0, cz - 0.28));
        bodyParts.push(box(0.7, 0.17, 0.34, PAL.plaster, cx, y0 + 0.05, cz - 0.28));
        for (let i = 0; i <= 4; i++) bodyParts.push(box(0.03, 0.17, 0.03, PAL.timber, cx - 0.35 + i * 0.175, y0 + 0.05, cz - 0.28 + 0.17));
        const r = chineseRoof(0.7, 0.34, 0.22, { style: 'xieshan', over: 0.12, up: 0.05, rings: 4, seg: 4 });
        roofParts.push(moved(r.roof, cx, y0 + 0.22, cz - 0.28));
        bodyParts.push(moved(r.trim, cx, y0 + 0.22, cz - 0.28));
        addHouse(cx - 0.47, cz + 0.12, 0.5, 0.24, Math.PI / 2, { thatch: false });
        addHouse(cx + 0.47, cz + 0.12, 0.5, 0.24, Math.PI / 2, { thatch: false });
        addHouse(cx, cz + d / 2 - 0.14, 0.42, 0.22, 0, { thatch: false });
        treeSpots.push([cx - 0.22, cz + 0.2], [cx + 0.24, cz + 0.16]);
        continue;
      }
      const vertical = rnd() < 0.3;
      const along0 = vertical ? bz0 : bx0;
      const along1 = vertical ? bz1 : bx1;
      const across0 = vertical ? bx0 : bz0;
      const across1 = vertical ? bx1 : bz1;
      let a = across0 + 0.16;
      while (a < across1 - 0.14) {
        const d = 0.25 + rnd() * 0.07;
        let p = along0 + 0.04;
        while (p < along1 - 0.3) {
          const w = Math.min(0.42 + rnd() * 0.36, along1 - p - 0.02);
          if (rnd() < 0.86) {
            const cxh = vertical ? a : p + w / 2;
            const czh = vertical ? p + w / 2 : a;
            addHouse(cxh, czh, w, d, vertical ? Math.PI / 2 : 0);
          } else {
            treeSpots.push(vertical ? [a, p + w / 2] : [p + w / 2, a]);
          }
          p += w + 0.05 + rnd() * 0.05;
        }
        a += d + 0.17 + rnd() * 0.08;
      }
    }
  }

  const wallMesh = meshOf(wallParts, mats.brick);
  const body = meshOf(bodyParts, mats.body);
  const roofs = meshOf(roofParts, mats.roof);
  const pennants = meshOf(flagParts, mats.flag);
  group.add(wallMesh, body, roofs, pennants);
  let tris = 0;
  group.traverse((o) => {
    if (o.isMesh) tris += o.geometry.attributes.position.count / 3;
  });
  return { group, eastTower, huanglou: hl, landmarks, pennants, treeSpots, footprints, triangles: tris };
}

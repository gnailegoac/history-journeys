// 搭小模型用的零件：带颜色的方块、屋顶、台子。全是代码算出来的几何体。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PAL } from './palette.js';
import { mulberry32 } from './util.js';

/** 给几何体整体刷一个颜色（顶点色）。 */
export function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** 方块，底面在 y。 */
export function box(w, h, d, hex, x = 0, y = 0, z = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return paint(g, hex);
}

/**
 * 檐下的墙或柱子：方块，底面在 y；最上面一截（frac）往上渐渐压暗到 k，像屋檐投下的影子。
 */
export function shadedBox(w, h, d, hex, x = 0, y = 0, z = 0, frac = 0.3, k = 0.6) {
  const g = new THREE.BoxGeometry(w, h, d, 1, 2, 1);
  const p = g.attributes.position;
  const yMid = h / 2 - frac * h;
  for (let i = 0; i < p.count; i++) if (Math.abs(p.getY(i)) < 1e-6) p.setY(i, yMid);
  paint(g, hex);
  const c = g.attributes.color;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > h / 2 - 1e-6) c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k);
  }
  g.translate(x, y + h / 2, z);
  return g;
}

/** 一扇窗：浅一点的窗扇，上面两竖一横的窗棂。face 是朝外的方向（±1，沿 z）。 */
export function latticeWindow(w, h, x, y, z, face, panelHex, barHex, shade = 0.72) {
  const parts = [];
  const panel = box(w, h, 0.012, panelHex, x, y, z);
  // 窗扇上半截也在檐影里
  const c = panel.attributes.color;
  const p = panel.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > y + h * 0.5) c.setXYZ(i, c.getX(i) * shade, c.getY(i) * shade, c.getZ(i) * shade);
  parts.push(panel);
  const zf = z + face * 0.008;
  const b = Math.min(0.011, w * 0.1);
  for (const t of [-1 / 6, 1 / 6]) parts.push(box(b, h, 0.008, barHex, x + t * w, y, zf));
  parts.push(box(w, b, 0.008, barHex, x, y + h * 0.56, zf));
  // 窗框
  parts.push(box(w + b * 1.6, b, 0.01, barHex, x, y - b * 0.5, zf));
  parts.push(box(w + b * 1.6, b, 0.01, barHex, x, y + h - b * 0.5, zf));
  return parts;
}

/** 上小下大的台子（四面收分）。 */
export function taper(wBot, dBot, wTop, dTop, h, hex, x = 0, y = 0, z = 0, uvScale = 1) {
  const pos = [];
  const uv = [];
  const hb = [wBot / 2, dBot / 2];
  const ht = [wTop / 2, dTop / 2];
  const quad = (a, b, c, d, len) => {
    // a b 在下，c d 在上；逆时针朝外
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    uv.push(0, 0, len * uvScale, 0, len * uvScale, h * uvScale, 0, 0, len * uvScale, h * uvScale, 0, h * uvScale);
  };
  const B = (sx, sz) => [sx * hb[0], 0, sz * hb[1]];
  const Tp = (sx, sz) => [sx * ht[0], h, sz * ht[1]];
  quad(B(-1, 1), B(1, 1), Tp(1, 1), Tp(-1, 1), wBot); // 南
  quad(B(1, 1), B(1, -1), Tp(1, -1), Tp(1, 1), dBot); // 东
  quad(B(1, -1), B(-1, -1), Tp(-1, -1), Tp(1, -1), wBot); // 北
  quad(B(-1, -1), B(-1, 1), Tp(-1, 1), Tp(-1, -1), dBot); // 西
  // 顶
  pos.push(...Tp(-1, 1), ...Tp(1, 1), ...Tp(1, -1), ...Tp(-1, 1), ...Tp(1, -1), ...Tp(-1, -1));
  uv.push(0, 0, 0.01, 0, 0.01, 0.01, 0, 0, 0.01, 0.01, 0, 0.01);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  g.translate(x, y, z);
  return paint(g, hex);
}

function fromGrid(rows, uvs, hex) {
  // rows[k][i] = [x,y,z]；k 从檐口到屋脊，i 沿檐口方向。逆时针朝外/朝上。
  const pos = [];
  const uv = [];
  for (let k = 0; k < rows.length - 1; k++) {
    for (let i = 0; i < rows[k].length - 1; i++) {
      const a = rows[k][i];
      const b = rows[k][i + 1];
      const c = rows[k + 1][i + 1];
      const d = rows[k + 1][i];
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      uv.push(...uvs[k][i], ...uvs[k][i + 1], ...uvs[k + 1][i + 1], ...uvs[k][i], ...uvs[k + 1][i + 1], ...uvs[k + 1][i]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  paint(g, hex);
  // 檐口一圈略亮，往上到屋脊略深：小尺寸下屋面也有起伏
  const col = g.attributes.color;
  const K = rows.length - 1;
  let v = 0;
  for (let k = 0; k < K; k++) {
    for (let i = 0; i < rows[k].length - 1; i++) {
      const f0 = 1.16 - 0.26 * (k / K);
      const f1 = 1.16 - 0.26 * ((k + 1) / K);
      for (const f of [f0, f0, f1, f0, f1, f1]) {
        col.setXYZ(v, col.getX(v) * f, col.getY(v) * f, col.getZ(v) * f);
        v++;
      }
    }
  }
  return g;
}

export const TILE_W = 0.05; // 一垄瓦的宽度（场景单位）

/**
 * 中式屋顶。w 沿 x，d 沿 z，h 是从檐口到屋脊的高。
 * style: 'hip' 庑殿（四面坡）、'xieshan' 歇山（上半截两头是山墙）、'pyramid' 攒尖。
 * 返回 { roof, trim }：roof 用瓦的材质，trim（屋脊、封檐、山花）用墙的材质。
 */
export function chineseRoof(w, d, h, opt = {}) {
  const { style = 'xieshan', over = 0.12, up = 0.06, rings = 5, seg = 6, tile = PAL.tile, ridge = PAL.tileLight, gable = PAL.timber, fascia = PAL.timberDark, ridgeW = 0.03 } = opt;
  const ex = w / 2 + over;
  const ez = d / 2 + over;
  const split = style === 'xieshan' ? 0.48 : 1;
  const ridgeHalf = style === 'pyramid' ? 0 : style === 'xieshan' ? w / 2 - d * 0.18 : Math.max(0.02, (w - d) / 2 + d * 0.08);
  const hx = (t) => (style === 'xieshan' ? lerpN(ex, ridgeHalf, Math.min(1, t / split)) : lerpN(ex, ridgeHalf, t));
  const hz = (t) => ez * (1 - t);
  const Y = (t) => h * (0.3 * t + 0.7 * Math.pow(t, 2.1));
  const lift = (a, t) => up * Math.pow(Math.abs(a), 3) * (1 - t) * (1 - t);
  const slope = Math.hypot(ez, h);
  const roofParts = [];
  const trimParts = [];
  const makeFace = (pt, tMax) => {
    const rows = [];
    const uvs = [];
    const K = Math.max(1, Math.round(rings * tMax));
    for (let k = 0; k <= K; k++) {
      const t = (k / K) * tMax;
      const row = [];
      const uvr = [];
      for (let i = 0; i <= seg; i++) {
        const a = -1 + (2 * i) / seg;
        const p = pt(a, t);
        row.push(p.pos);
        uvr.push([p.along / TILE_W, (t * slope) / TILE_W]);
      }
      rows.push(row);
      uvs.push(uvr);
    }
    roofParts.push(fromGrid(rows, uvs, tile));
  };
  // 南坡、北坡
  makeFace((a, t) => ({ pos: [a * hx(t), Y(t) + lift(a, t), hz(t)], along: a * hx(t) }), 1);
  makeFace((a, t) => ({ pos: [-a * hx(t), Y(t) + lift(a, t), -hz(t)], along: -a * hx(t) }), 1);
  // 东坡、西坡（歇山只到一半高）
  makeFace((a, t) => ({ pos: [hx(t), Y(t) + lift(a, t), -a * hz(t)], along: -a * hz(t) }), split);
  makeFace((a, t) => ({ pos: [-hx(t), Y(t) + lift(a, t), a * hz(t)], along: a * hz(t) }), split);
  if (style === 'xieshan') {
    // 两头的山花
    for (const s of [1, -1]) {
      const g = new THREE.BufferGeometry();
      const x = s * (ridgeHalf - 0.004);
      const z0 = hz(split);
      const y0 = Y(split);
      const p = s > 0 ? [x, y0, z0, x, y0, -z0, x, Y(1), 0] : [x, y0, -z0, x, y0, z0, x, Y(1), 0];
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0.01, 0, 0.005, 0.01], 2));
      g.computeVertexNormals();
      trimParts.push(paint(g, gable));
    }
  }
  // 正脊和两头的吻
  if (style !== 'pyramid') {
    trimParts.push(box(ridgeHalf * 2 + 0.03, ridgeW * 1.5, ridgeW, ridge, 0, Y(1) - ridgeW * 0.35, 0));
    for (const s of [1, -1]) trimParts.push(box(ridgeW * 1.3, ridgeW * 2.6, ridgeW * 1.25, ridge, s * (ridgeHalf + 0.012), Y(1) - ridgeW * 0.3, 0));
  } else {
    const fin = new THREE.SphereGeometry(ridgeW * 1.2, 8, 6);
    fin.translate(0, Y(1) + ridgeW * 0.6, 0);
    trimParts.push(paint(fin, ridge));
  }
  // 四条垂脊
  const hipSteps = 4;
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const tEnd = split;
      for (let k = 0; k < hipSteps; k++) {
        const t0 = (k / hipSteps) * tEnd;
        const t1 = ((k + 1) / hipSteps) * tEnd;
        const a = new THREE.Vector3(sx * hx(t0), Y(t0) + lift(1, t0), sz * hz(t0));
        const b = new THREE.Vector3(sx * hx(t1), Y(t1) + lift(1, t1), sz * hz(t1));
        trimParts.push(beam(a, b, ridgeW * 0.8, ridgeW * 0.9, ridge));
      }
      if (style === 'xieshan') {
        // 上半截沿山墙的脊
        const a = new THREE.Vector3(sx * ridgeHalf, Y(split), sz * hz(split));
        const b = new THREE.Vector3(sx * ridgeHalf, Y(1), 0);
        trimParts.push(beam(a, b, ridgeW * 0.8, ridgeW * 0.9, ridge));
      }
    }
  }
  // 封檐：檐口下面一条深色的边
  const f = 0.028;
  trimParts.push(box(ex * 2 - 0.01, f, ez * 2 - 0.01, fascia, 0, -f, 0));
  return { roof: merge(roofParts), trim: merge(trimParts), height: Y(1) };
}

const lerpN = (a, b, t) => a + (b - a) * t;

/** 从 a 到 b 的一根方木。 */
export function beam(a, b, w, hgt, hex) {
  const len = a.distanceTo(b);
  const g = new THREE.BoxGeometry(w, hgt, len + w * 0.3);
  const m = new THREE.Matrix4();
  const mid = a.clone().add(b).multiplyScalar(0.5);
  m.lookAt(a, b, new THREE.Vector3(0, 1, 0));
  g.applyMatrix4(m);
  g.translate(mid.x, mid.y + hgt * 0.3, mid.z);
  return paint(g, hex);
}

/** 人字顶（民房）：两面坡，屋脊沿 x。 */
export function gableRoof(w, d, h, over = 0.03, tile = '#ffffff') {
  const ex = w / 2 + over;
  const ez = d / 2 + over;
  const sl = Math.hypot(ez, h);
  const pos = [
    // 南坡
    -ex, 0, ez, ex, 0, ez, ex, h, 0, -ex, 0, ez, ex, h, 0, -ex, h, 0,
    // 北坡
    ex, 0, -ez, -ex, 0, -ez, -ex, h, 0, ex, 0, -ez, -ex, h, 0, ex, h, 0,
  ];
  const u0 = -ex / TILE_W;
  const u1 = ex / TILE_W;
  const v1 = sl / TILE_W;
  const uv = [u0, 0, u1, 0, u1, v1, u0, 0, u1, v1, u0, v1, u0, 0, u1, 0, u1, v1, u0, 0, u1, v1, u0, v1];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return paint(g, tile);
}

/** 民房的墙身：方盒子加两头的山尖。屋脊沿 x。 */
export function houseBody(w, d, hWall, hRoof, hex = '#ffffff') {
  const parts = [box(w, hWall, d, hex)];
  for (const s of [1, -1]) {
    const g = new THREE.BufferGeometry();
    const x = (s * w) / 2;
    const p = s > 0 ? [x, hWall, d / 2, x, hWall, -d / 2, x, hWall + hRoof, 0] : [x, hWall, -d / 2, x, hWall, d / 2, x, hWall + hRoof, 0];
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
    g.computeVertexNormals();
    parts.push(paint(g, hex));
  }
  return merge(parts);
}

/** 合并一批带顶点色的几何体。 */
export function merge(parts) {
  const list = parts.filter(Boolean).map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (!n.attributes.uv) n.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
    if (!n.attributes.color) paint(n, '#ffffff');
    if (!n.attributes.normal) n.computeVertexNormals();
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) n.deleteAttribute(k);
    return n;
  });
  return mergeGeometries(list, false);
}

export function moved(geo, x, y, z, ry = 0) {
  if (ry) geo.rotateY(ry);
  geo.translate(x, y, z);
  return geo;
}

/** 瓦垄的贴图：浅灰的条纹，乘在顶点色上。 */
export function tileTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  for (let i = 0; i < 4; i++) {
    const x = i * 16;
    const grad = g.createLinearGradient(x, 0, x + 16, 0);
    grad.addColorStop(0, '#8E8E8E');
    grad.addColorStop(0.18, '#C8C8C8');
    grad.addColorStop(0.5, '#FFFFFF');
    grad.addColorStop(0.82, '#D2D2D2');
    grad.addColorStop(1, '#8E8E8E');
    g.fillStyle = grad;
    g.fillRect(x, 0, 16, 64);
  }
  g.fillStyle = 'rgba(0,0,0,0.10)';
  for (let y = 0; y < 64; y += 8) g.fillRect(0, y, 64, 1.2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(0.25, 0.25);
  t.anisotropy = 8;
  return t;
}

/** 刷了黄土的墙面：深浅不匀的一层，带一点往下淌的痕迹。乘在顶点色上。 */
export function earthTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const rnd = mulberry32(77);
  // 低频的斑：几层随机的格点插值
  const grid = (n) => {
    const a = new Float32Array((n + 1) * (n + 1));
    for (let i = 0; i < a.length; i++) a[i] = rnd();
    return (u, v) => {
      const x = u * n;
      const y = v * n;
      const ix = Math.min(n - 1, Math.floor(x));
      const iy = Math.min(n - 1, Math.floor(y));
      const fx = x - ix;
      const fy = y - iy;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const k = iy * (n + 1) + ix;
      return a[k] * (1 - sx) * (1 - sy) + a[k + 1] * sx * (1 - sy) + a[k + n + 1] * (1 - sx) * sy + a[k + n + 2] * sx * sy;
    };
  };
  const g1 = grid(4);
  const g2 = grid(11);
  const g3 = grid(40);
  const streak = new Float32Array(S);
  for (let i = 0; i < S; i++) streak[i] = rnd();
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const u = i / S;
      const v = j / S;
      const st = (streak[i] * 0.6 + streak[(i + 1) % S] * 0.4 - 0.5) * 0.05 * (0.4 + v * 0.6);
      const val = 0.9 + (g1(u, v) - 0.5) * 0.1 + (g2(u, v) - 0.5) * 0.07 + (g3(u, v) - 0.5) * 0.05 + st;
      const o = (j * S + i) * 4;
      const b = Math.max(0, Math.min(255, Math.round(val * 255)));
      img.data[o] = b;
      img.data[o + 1] = b;
      img.data[o + 2] = Math.round(b * 0.985);
      img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** 砖缝的贴图：横缝密、竖缝错开，乘在顶点色上。 */
export function brickTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  const rnd = mulberry32(9);
  const bh = 16;
  for (let r = 0; r < 8; r++) {
    for (let k = 0; k < 4; k++) {
      const x = k * 32 + (r % 2 ? 16 : 0);
      const v = 236 + Math.floor(rnd() * 19);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, r * bh, 32, bh);
      if (x + 32 > 128) g.fillRect(x - 128, r * bh, 32, bh);
      g.fillStyle = 'rgba(70,60,50,0.16)';
      g.fillRect(x, r * bh, 1.5, bh);
      if (x + 32 > 128) g.fillRect(x - 128, r * bh, 1.5, bh);
    }
    g.fillStyle = 'rgba(70,60,50,0.24)';
    g.fillRect(0, r * bh, 128, 1.6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

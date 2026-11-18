// 搭小模型用的几样零件：按材质归拢的批次、屋顶（带举折和翼角）、棱柱、贴图。

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lerp, mulberry32 } from './util.js';

export function T(x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = sx, sz = sx) {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz));
  return m;
}

/** 同一种材质的零件攒在一起，最后并成一个网格 */
export class Batch {
  constructor() {
    this.parts = new Map();
    this.tris = 0;
  }
  add(mat, geo, matrix, tint) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    if (!g.attributes.color) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    if (tint) {
      const c = g.attributes.color.array;
      for (let i = 0; i < n; i++) {
        c[i * 3] *= tint[0];
        c[i * 3 + 1] *= tint[1];
        c[i * 3 + 2] *= tint[2];
      }
    }
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    if (!this.parts.has(mat)) this.parts.set(mat, []);
    this.parts.get(mat).push(g);
    this.tris += n / 3;
    return this;
  }
  build(materials) {
    const group = new THREE.Group();
    for (const [name, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      const mesh = new THREE.Mesh(merged, materials[name]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }
}

/** 一格一格铺出来的曲面（共用顶点，法线平滑） */
export class GB {
  constructor() {
    this.p = [];
    this.uv = [];
    this.i = [];
  }
  grid(P, rows, cols, flip) {
    const base = this.p.length / 3;
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= cols; c++) {
        const q = P(r, c);
        this.p.push(q[0], q[1], q[2]);
        this.uv.push(q[3] ?? 0, q[4] ?? 0);
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = base + r * (cols + 1) + c;
        const b = a + 1;
        const d = a + cols + 1;
        const e = d + 1;
        if (flip) this.i.push(a, e, b, a, d, e);
        else this.i.push(a, b, e, a, e, d);
      }
    }
  }
  get empty() {
    return this.i.length === 0;
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.i);
    g.computeVertexNormals();
    return g;
  }
}

/** 平面拼的硬边零件（每个面自己的法线） */
export class FB {
  constructor() {
    this.p = [];
    this.n = [];
    this.uv = [];
    this.c = [];
  }
  /** a b c d 依次绕一圈；n 是朝外的法线，绕向自动对齐 */
  quad(a, b, c, d, n, uvs, cols) {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    const same = cx * n[0] + cy * n[1] + cz * n[2] >= 0;
    const order = same ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    const pts = [a, b, c, d];
    const uu = uvs || [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const k of order) {
      this.p.push(...pts[k]);
      this.n.push(...n);
      this.uv.push(...uu[k]);
      const col = cols ? cols[k] : 1;
      if (Array.isArray(col)) this.c.push(...col);
      else this.c.push(col, col, col);
    }
  }
  tri(a, b, c, n, shade = 1) {
    this.quad(a, b, c, c, n, [[0, 0], [1, 0], [0.5, 1], [0.5, 1]], [shade, shade, shade, shade]);
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    return g;
  }
}

/** 底面在 y=0 的盒子 */
export function box(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  return g;
}
export function cyl(r, h, seg = 8, rTop = r) {
  const g = new THREE.CylinderGeometry(rTop, r, h, seg, 1, false);
  g.translate(0, h / 2, 0);
  return g;
}
/** 两点之间的一根方条 */
export function segBox(a, b, w, h) {
  const va = new THREE.Vector3(...a);
  const vb = new THREE.Vector3(...b);
  const len = va.distanceTo(vb);
  const g = new THREE.BoxGeometry(len, h, w);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), vb.clone().sub(va).normalize());
  const m = new THREE.Matrix4().compose(va.clone().add(vb).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(m);
  return g;
}

/**
 * 棱柱：截面是 (z, y) 上的凸多边形，沿 x 拉长 L。
 * shade(y) 给顶点明暗（墙脚深一点）；topShade 给朝上的面的明暗。
 */
export function prism(section, L, { shade = () => 1, topShade = 1, uvScale = 40 } = {}) {
  const fb = new FB();
  const n = section.length;
  let cz = 0;
  let cy = 0;
  for (const [z, y] of section) {
    cz += z / n;
    cy += y / n;
  }
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const [z0, y0] = section[i];
    const [z1, y1] = section[(i + 1) % n];
    const dz = z1 - z0;
    const dy = y1 - y0;
    const len = Math.hypot(dz, dy);
    let nz = dy / len;
    let ny = -dz / len;
    if (nz * ((z0 + z1) / 2 - cz) + ny * ((y0 + y1) / 2 - cy) < 0) {
      nz = -nz;
      ny = -ny;
    }
    const s0 = ny > 0.9 ? topShade : shade(y0);
    const s1 = ny > 0.9 ? topShade : shade(y1);
    fb.quad(
      [-L / 2, y0, z0],
      [L / 2, y0, z0],
      [L / 2, y1, z1],
      [-L / 2, y1, z1],
      [0, ny, nz],
      [[-L / 2 / uvScale, acc / uvScale], [L / 2 / uvScale, acc / uvScale], [L / 2 / uvScale, (acc + len) / uvScale], [-L / 2 / uvScale, (acc + len) / uvScale]],
      [s0, s0, s1, s1],
    );
    acc += len;
  }
  for (const sx of [-1, 1]) {
    for (let i = 1; i < n - 1; i++) {
      const a = section[0];
      const b = section[i];
      const c = section[i + 1];
      fb.quad(
        [(sx * L) / 2, a[1], a[0]],
        [(sx * L) / 2, b[1], b[0]],
        [(sx * L) / 2, c[1], c[0]],
        [(sx * L) / 2, c[1], c[0]],
        [sx, 0, 0],
        [[a[0] / uvScale, a[1] / uvScale], [b[0] / uvScale, b[1] / uvScale], [c[0] / uvScale, c[1] / uvScale], [c[0] / uvScale, c[1] / uvScale]],
        [shade(a[1]), shade(b[1]), shade(c[1]), shade(c[1])],
      );
    }
  }
  return fb.geo();
}

/**
 * 屋顶。W 是面阔方向的檐口长，D 是进深方向的檐口宽，檐口在 y=0，正脊在 y=H。
 * ts：戗脊走到哪里换成山面（1 是庑殿，0 是两坡顶，中间是歇山）。
 * t1：只做到多高（腰檐用，<1）。lift：翼角起翘。sag：举折（越大越凹）。
 * 返回 { roof, fascia, gable, ridges }。
 */
export function roofParts({ W, D, H, ts = 1, t1 = 1, lift = 0, nu = 6, nt = 5, sag = 0.55, tile = 3.2, fascia = 1.5, gableInset = 0, liftLen = null }) {
  const prof = (t) => H * ((1 - sag) * t + sag * t * t);
  const hd = D / 2;
  const tEnd = Math.min(t1, 1);
  const span = (t) => W / 2 - Math.min(t, ts) * hd;
  // 翼角只在离角一小段里翘起来（面阔、进深两边一样长），中间的檐口是平的
  const curl = lift > 0 && ts > 0;
  const Lc = liftLen ?? Math.max(5, Math.min(0.2 * D, 16));
  const cOf = (u, L0) => (curl ? Math.max(0, 1 - (Math.min(u, 1 - u) * L0) / Lc) : 0);
  const yv = (t, c) => prof(t) + lift * c * c * (1 - t) * (1 - t);
  // 檐口上的分格：角上分细一点，曲线才圆
  const cols = (L0, n) => {
    if (!curl) return Array.from({ length: n + 1 }, (_, i) => i / n);
    const a = Math.min(0.45, Lc / L0);
    const mid = Math.max(1, n - 6);
    const us = [0, a / 3, (2 * a) / 3, a];
    for (let k = 1; k <= mid; k++) us.push(a + ((1 - 2 * a) * k) / mid);
    us.push(1 - (2 * a) / 3, 1 - a / 3, 1);
    return us;
  };
  const usW = cols(W, nu);
  const roof = new GB();
  const fas = new GB();
  const gab = new GB();
  for (const sgn of [1, -1]) {
    const P = (r, c) => {
      const t = (r / nt) * tEnd;
      const u = usW[c];
      const x = lerp(-span(t), span(t), u);
      return [x, yv(t, cOf(u, W)), sgn * hd * (1 - t), x / tile, t * 2];
    };
    roof.grid(P, nt, usW.length - 1, sgn < 0);
    if (fascia > 0) fas.grid((r, c) => {
      const q = P(0, c);
      return [q[0], q[1] - r * fascia, q[2], q[0] / tile, r];
    }, 1, usW.length - 1, sgn > 0);
  }
  const tS = Math.min(tEnd, ts);
  if (tS > 0) {
    const usD = cols(D, Math.max(2, Math.round((nu * D) / W)));
    const ns = Math.max(1, Math.round(nt * (tS / tEnd)));
    for (const sgn of [1, -1]) {
      const P = (r, c) => {
        const t = (r / ns) * tS;
        const u = usD[c];
        const z = lerp(hd * (1 - t), -hd * (1 - t), u);
        return [sgn * (W / 2 - t * hd), yv(t, cOf(u, D)), z, z / tile, t * 2];
      };
      roof.grid(P, ns, usD.length - 1, sgn < 0);
      if (fascia > 0) fas.grid((r, c) => {
        const q = P(0, c);
        return [q[0], q[1] - r * fascia, q[2], q[2] / tile, r];
      }, 1, usD.length - 1, sgn > 0);
    }
  }
  if (ts < 1 && tEnd > ts) {
    const ng = 3;
    for (const sgn of [1, -1]) {
      const x = sgn * (span(1) - gableInset);
      gab.grid((r, c) => {
        const t = lerp(ts, tEnd, r / ng);
        return [x, prof(t) - 0.25, lerp(hd * (1 - t), -hd * (1 - t), c), c, r / ng];
      }, ng, 1, sgn < 0);
    }
  }
  // 脊
  const ridges = [];
  if (tEnd >= 1) {
    const s = span(1);
    if (s > 0.5) {
      ridges.push({ a: [-s - 1.2, H + 0.7, 0], b: [s + 1.2, H + 0.7, 0], w: 2.4, h: 2.6 });
      ridges.push({ a: [-s - 1.2, H + 1.2, 0], b: [-s - 3.6, H + 4.6, 0], w: 2.4, h: 2.4 });
      ridges.push({ a: [s + 1.2, H + 1.2, 0], b: [s + 3.6, H + 4.6, 0], w: 2.4, h: 2.4 });
    }
    if (ts < 1) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const N = 3;
        for (let k = 0; k < N; k++) {
          const ta = lerp(ts, 1, k / N);
          const tb = lerp(ts, 1, (k + 1) / N);
          ridges.push({ a: [sx * s, prof(ta) + 0.6, sz * hd * (1 - ta)], b: [sx * s, prof(tb) + 0.6, sz * hd * (1 - tb)], w: 1.8, h: 1.8 });
        }
      }
    }
  }
  if (tS > 0) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const N = 4;
      for (let k = 0; k < N; k++) {
        const ta = (k / N) * tS;
        const tb = ((k + 1) / N) * tS;
        ridges.push({
          a: [sx * (W / 2 - ta * hd), yv(ta, 1) + 0.6, sz * hd * (1 - ta)],
          b: [sx * (W / 2 - tb * hd), yv(tb, 1) + 0.6, sz * hd * (1 - tb)],
          w: 1.8,
          h: 1.8,
        });
      }
    }
  }
  return { roof: roof.geo(), fascia: fas.empty ? null : fas.geo(), gable: gab.empty ? null : gab.geo(), ridges, prof };
}

// ---------- 贴图（都是代码画的） ----------
function tex(canvas, repeat = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

/** 瓦垄：u 方向一格一条瓦垄，v 方向是从檐口到脊 */
export function tileTexture() {
  const [c, g] = canvas(64, 128);
  const grad = g.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, '#8d8d88');
  grad.addColorStop(0.18, '#d9d9d2');
  grad.addColorStop(0.5, '#ffffff');
  grad.addColorStop(0.82, '#d9d9d2');
  grad.addColorStop(1, '#8d8d88');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 128);
  g.fillStyle = 'rgba(40,40,40,0.16)';
  for (let y = 0; y < 128; y += 16) g.fillRect(0, y, 64, 2);
  return tex(c);
}
/** 城砖：一皮一皮错缝砌的长砖，砖缝深一点，每块砖深浅略有不同；四边接得上 */
export function brickTexture() {
  const S = 512;
  const [c, g] = canvas(S, S);
  const rnd = mulberry32(77);
  g.fillStyle = '#cfcbc0'; // 砖缝：比砖面深一成多
  g.fillRect(0, 0, S, S);
  const rh = 16;
  const bw = 64;
  const n = S / bw;
  for (let r = 0; r < S / rh; r++) {
    const off = (r % 2) * (bw / 2);
    for (let i = 0; i < n; i++) {
      const v = 240 * (1 + (rnd() - 0.5) * 0.1);
      const warm = (rnd() - 0.5) * 5;
      g.fillStyle = `rgb(${Math.round(v + warm)},${Math.round(v)},${Math.round(v - 5 - warm)})`;
      for (const x of [i * bw + off, i * bw + off - S]) g.fillRect(x, r * rh, bw - 1, rh - 1);
    }
  }
  // 雨水留下的很淡的竖痕
  for (let i = 0; i < 46; i++) {
    const x = rnd() * S;
    const w = 6 + rnd() * 44;
    g.fillStyle = rnd() < 0.6 ? `rgba(70,60,40,${0.015 + rnd() * 0.035})` : `rgba(255,255,255,${0.02 + rnd() * 0.04})`;
    for (const xx of [x, x - S]) g.fillRect(xx, 0, w, S);
  }
  return tex(c);
}
/** 条石：石岸、台基用。一皮高，石块长短不一 */
export function stoneTexture() {
  const S = 512;
  const [c, g] = canvas(S, S);
  const rnd = mulberry32(131);
  g.fillStyle = '#cdc8bb';
  g.fillRect(0, 0, S, S);
  const rh = 32;
  for (let r = 0; r < S / rh; r++) {
    const ws = [];
    let sum = 0;
    while (sum < S) {
      const w = 84 + rnd() * 76;
      ws.push(w);
      sum += w;
    }
    let x = -rnd() * 60;
    for (const w0 of ws) {
      const w = (w0 * S) / sum;
      const v = 240 * (1 + (rnd() - 0.5) * 0.12);
      const warm = (rnd() - 0.5) * 6;
      g.fillStyle = `rgb(${Math.round(v + warm)},${Math.round(v)},${Math.round(v - 6 - warm)})`;
      for (const xx of [x, x + S]) g.fillRect(xx, r * rh, w - 2, rh - 2);
      x += w;
    }
  }
  for (let i = 0; i < 30; i++) {
    const x = rnd() * S;
    const w = 10 + rnd() * 50;
    g.fillStyle = rnd() < 0.6 ? `rgba(70,60,40,${0.015 + rnd() * 0.03})` : `rgba(255,255,255,${0.02 + rnd() * 0.04})`;
    for (const xx of [x, x - S]) g.fillRect(xx, 0, w, S);
  }
  return tex(c);
}
/** 刷了黄土的墙：一道一道往下刷的痕，墙脚深一点 */
export function washTexture() {
  const [c, g] = canvas(256, 256);
  const rnd = mulberry32(23);
  g.fillStyle = '#f7f4ea';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 170; i++) {
    const x = rnd() * 256;
    const w = 1 + rnd() * 5;
    g.fillStyle = rnd() < 0.62 ? `rgba(120,88,36,${0.03 + rnd() * 0.06})` : `rgba(255,255,255,${0.05 + rnd() * 0.1})`;
    const y0 = rnd() < 0.55 ? 0 : rnd() * 130;
    g.fillRect(x, y0, w, 256 - y0);
  }
  const grad = g.createLinearGradient(0, 170, 0, 256);
  grad.addColorStop(0, 'rgba(110,80,40,0)');
  grad.addColorStop(1, 'rgba(110,80,40,0.16)');
  g.fillStyle = grad;
  g.fillRect(0, 170, 256, 86);
  return tex(c);
}
/** 茅草、篷席：细的竖纹 */
export function strawTexture() {
  const [c, g] = canvas(64, 64);
  const rnd = mulberry32(5);
  g.fillStyle = '#f4f0e6';
  g.fillRect(0, 0, 64, 64);
  for (let x = 0; x < 64; x += 2) {
    const v = Math.floor(200 + rnd() * 55);
    g.fillStyle = `rgb(${v},${v},${v - 8})`;
    g.fillRect(x, 0, 2, 64);
  }
  g.fillStyle = 'rgba(60,40,10,0.18)';
  for (let y = 0; y < 64; y += 21) g.fillRect(0, y, 64, 2);
  return tex(c);
}
/** 绫边：浅底上很淡的菱格小花 */
export function brocadeTexture(base, fig) {
  const [c, g] = canvas(128, 128);
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = fig;
  g.lineWidth = 1.6;
  g.globalAlpha = 0.8;
  for (const [ox, oy] of [[0, 0], [64, 64], [-64, 64], [64, -64], [0, 128], [128, 0], [128, 128]]) {
    g.beginPath();
    g.moveTo(ox + 32, oy);
    g.lineTo(ox + 64, oy + 32);
    g.lineTo(ox + 32, oy + 64);
    g.lineTo(ox, oy + 32);
    g.closePath();
    g.stroke();
    g.beginPath();
    g.arc(ox + 32, oy + 32, 7, 0, Math.PI * 2);
    g.stroke();
  }
  g.globalAlpha = 0.07;
  g.fillStyle = '#6b5530';
  for (let y = 0; y < 128; y += 2) g.fillRect(0, y, 128, 1);
  g.fillStyle = '#ffffff';
  for (let x = 0; x < 128; x += 2) g.fillRect(x, 0, 1, 128);
  return tex(c);
}
/** 紫檀：顺长的木纹 */
export function woodTexture() {
  const [c, g] = canvas(512, 64);
  const rnd = mulberry32(11);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 64);
  for (let i = 0; i < 90; i++) {
    const y = rnd() * 64;
    const v = rnd();
    g.strokeStyle = v < 0.6 ? `rgba(0,0,0,${0.05 + rnd() * 0.16})` : `rgba(255,220,190,${0.04 + rnd() * 0.08})`;
    g.lineWidth = 0.5 + rnd() * 1.6;
    g.beginPath();
    g.moveTo(0, y);
    const amp = rnd() * 3;
    for (let x = 0; x <= 512; x += 32) g.lineTo(x, y + Math.sin(x / 80 + i) * amp);
    g.stroke();
  }
  return tex(c);
}

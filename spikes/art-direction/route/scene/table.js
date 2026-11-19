// 装裱和座子：同站点沙盘（b/scene/table.js）一样——地形板四周一圈浅色绫边，外面是紫檀的框和矮座。
// 这里是照抄过来再按全程沙盘的大小改的，不跨目录引用。

import * as THREE from 'three';
import { PAL } from './palette.js';
import { mulberry32 } from './util.js';

export const BLOCK_BASE_Y = -170;
export const BORDER = 620;
export const STAND_OUT = 880;
export const FLOOR_Y = BLOCK_BASE_Y - 600;

class FB {
  constructor() {
    this.p = [];
    this.n = [];
    this.uv = [];
  }
  /** a b c d 依次绕一圈；n 是朝外的法线，绕向自动对齐 */
  quad(a, b, c, d, n, uvs) {
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
    }
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}
function tex(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}
/** 绫边：浅底上很淡的菱格小花 */
function brocadeTexture(base, fig) {
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
function woodTexture() {
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
/** 地形板四边的切面：像一叠裱起来的纸板 */
export function layerTexture() {
  const [c, g] = canvas(8, 64);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 8, 64);
  for (let y = 0; y < 64; y += 8) {
    g.fillStyle = 'rgba(120,96,60,0.20)';
    g.fillRect(0, y, 8, 1);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(0, y + 1, 8, 1);
  }
  return tex(c);
}

/** hx、hz：地形板的半宽、半深（场景单位） */
export function buildTable(hx, hz) {
  const group = new THREE.Group();
  const B = BLOCK_BASE_Y;
  const cx = 0;
  const cz = 0;

  // 绫边
  const bro = brocadeTexture(PAL.brocade, PAL.brocadeFig);
  const bw = 2 * (hx + BORDER + 4);
  const bd = 2 * (hz + BORDER + 4);
  const bgeo = new THREE.PlaneGeometry(bw, bd);
  bgeo.rotateX(-Math.PI / 2);
  const buv = bgeo.attributes.uv;
  for (let i = 0; i < buv.count; i++) buv.setXY(i, (buv.getX(i) * bw) / 300, (buv.getY(i) * bd) / 300);
  const border = new THREE.Mesh(bgeo, new THREE.MeshLambertMaterial({ map: bro }));
  border.position.set(cx, B + 0.5, cz);
  border.receiveShadow = true;
  group.add(border);

  // 紫檀框和座：一圈截面
  const prof = [
    [BORDER, B],
    [BORDER, B + 64],
    [BORDER + 34, B + 88],
    [BORDER + 250, B + 88],
    [BORDER + 284, B + 64],
    [BORDER + 284, B - 70],
    [BORDER + 224, B - 70],
    [BORDER + 224, B - 250],
    [BORDER + 330, B - 250],
    [BORDER + 356, B - 282],
    [BORDER + 356, B - 440],
    [BORDER + 322, B - 482],
  ];
  const fb = new FB();
  const sides = [
    { o: [0, 1], a: [1, 0], ho: hz, ha: hx },
    { o: [1, 0], a: [0, -1], ho: hx, ha: hz },
    { o: [0, -1], a: [-1, 0], ho: hz, ha: hx },
    { o: [-1, 0], a: [0, 1], ho: hx, ha: hz },
  ];
  let acc = 0;
  for (let i = 0; i < prof.length - 1; i++) {
    const [d0, y0] = prof[i];
    const [d1, y1] = prof[i + 1];
    const dd = d1 - d0;
    const dy = y1 - y0;
    const len = Math.hypot(dd, dy);
    const nd = -dy / len;
    const ny = dd / len;
    for (const s of sides) {
      const P = (d, y, e) => [cx + s.o[0] * (s.ho + d) + s.a[0] * e * (s.ha + d), y, cz + s.o[1] * (s.ho + d) + s.a[1] * e * (s.ha + d)];
      const L0 = 2 * (s.ha + d0);
      const L1 = 2 * (s.ha + d1);
      fb.quad(P(d0, y0, -1), P(d0, y0, 1), P(d1, y1, 1), P(d1, y1, -1), [s.o[0] * nd, ny, s.o[1] * nd], [[-L0 / 2 / 900, acc / 900], [L0 / 2 / 900, acc / 900], [L1 / 2 / 900, (acc + len) / 900], [-L1 / 2 / 900, (acc + len) / 900]]);
    }
    acc += len;
  }
  const wood = new THREE.MeshStandardMaterial({ color: PAL.sandal, map: woodTexture(), roughness: 0.5, metalness: 0.0, envMapIntensity: 0.55 });
  const frame = new THREE.Mesh(fb.geo(), wood);
  frame.castShadow = true;
  frame.receiveShadow = true;
  group.add(frame);

  // 框面上嵌一道黄杨木细线
  const line = new FB();
  for (const s of sides) {
    const P = (d, e) => [cx + s.o[0] * (s.ho + d) + s.a[0] * e * (s.ha + d), B + 88.8, cz + s.o[1] * (s.ho + d) + s.a[1] * e * (s.ha + d)];
    line.quad(P(BORDER + 96, -1), P(BORDER + 96, 1), P(BORDER + 124, 1), P(BORDER + 124, -1), [0, 1, 0]);
  }
  const inlay = new THREE.Mesh(line.geo(), new THREE.MeshLambertMaterial({ color: '#b3925c' }));
  inlay.receiveShadow = true;
  group.add(inlay);

  // 四只矮脚
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const g = new THREE.BoxGeometry(620, 120, 620);
    g.translate(cx + sx * (hx + BORDER + 20), B - 600 + 60, cz + sz * (hz + BORDER + 20));
    const m = new THREE.Mesh(g, wood);
    m.castShadow = true;
    group.add(m);
  }

  // 座子落在案上的影子：一块柔和的暗影
  const [c, g2] = canvas(256, 256);
  const sw = hx + STAND_OUT;
  const sd = hz + STAND_OUT;
  const pad = 2600;
  const fw = 2 * (sw + pad);
  const fd = 2 * (sd + pad);
  const img = g2.createImageData(256, 256);
  for (let j = 0; j < 256; j++) {
    for (let i = 0; i < 256; i++) {
      const x = (i / 255 - 0.5) * fw;
      const z = (j / 255 - 0.5) * fd;
      const dx = Math.max(Math.abs(x) - sw, 0);
      const dz = Math.max(Math.abs(z) - sd, 0);
      const d = Math.hypot(dx, dz);
      const a = Math.pow(Math.max(0, 1 - d / pad), 2.4) * 0.62;
      const k = (j * 256 + i) * 4;
      img.data[k] = 46;
      img.data[k + 1] = 30;
      img.data[k + 2] = 16;
      img.data[k + 3] = Math.round(a * 255);
    }
  }
  g2.putImageData(img, 0, 0);
  const st = new THREE.CanvasTexture(c);
  st.colorSpace = THREE.SRGBColorSpace;
  const sgeo = new THREE.PlaneGeometry(fw, fd);
  sgeo.rotateX(-Math.PI / 2);
  const shadow = new THREE.Mesh(sgeo, new THREE.MeshBasicMaterial({ map: st, transparent: true, depthWrite: false }));
  shadow.position.set(cx + 500, FLOOR_Y, cz + 420);
  shadow.renderOrder = -1;
  group.add(shadow);

  return { group, wood };
}

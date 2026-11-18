// 所有贴图都是用画布现画的：木纹、多层板的断面、胡桃木、地面的光斑。
import * as THREE from 'three';
import { mulberry32 } from './terrain.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function finish(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** 椴木薄板的木纹：很淡的横向细丝。亮度贴图（接近白），颜色由材质给。 */
export function grainTexture(seed = 1, strength = 1) {
  const S = 1024;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const rnd = mulberry32(seed);
  g.fillStyle = '#f7f7f7';
  g.fillRect(0, 0, S, S);
  // 宽的明暗带
  for (let i = 0; i < 26; i++) {
    const y = rnd() * S;
    const h = 10 + rnd() * 70;
    const a = (0.012 + rnd() * 0.03) * strength;
    g.fillStyle = rnd() < 0.5 ? `rgba(120,90,50,${a})` : `rgba(255,255,255,${a * 2})`;
    for (const yy of [y, y - S]) g.fillRect(0, yy, S, h);
  }
  // 细丝
  for (let i = 0; i < 2600; i++) {
    const y = rnd() * S;
    const x = rnd() * S;
    const len = 60 + rnd() * 420;
    const a = (0.02 + rnd() * 0.07) * strength;
    g.strokeStyle = rnd() < 0.72 ? `rgba(105,78,44,${a})` : `rgba(255,255,255,${a * 1.6})`;
    g.lineWidth = 0.5 + rnd() * 1.1;
    const dy = (rnd() - 0.5) * 3;
    for (const ox of [0, -S, S]) {
      g.beginPath();
      g.moveTo(x + ox, y);
      g.bezierCurveTo(x + ox + len * 0.3, y + dy, x + ox + len * 0.7, y - dy, x + ox + len, y + dy * 0.5);
      g.stroke();
    }
  }
  // 细小的孔
  for (let i = 0; i < 1500; i++) {
    g.fillStyle = `rgba(90,66,36,${(0.03 + rnd() * 0.06) * strength})`;
    g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 5, 1);
  }
  return finish(c);
}

/** 切口：激光切出来的边，上下各有一道深一点的线。 */
export function edgeTexture(seed = 3) {
  const W = 256;
  const H = 64;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const rnd = mulberry32(seed);
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#d9d9d9');
  grad.addColorStop(0.12, '#f4f4f4');
  grad.addColorStop(0.8, '#ececec');
  grad.addColorStop(1, '#c4c4c4');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 200; i++) {
    g.fillStyle = `rgba(80,56,30,${0.015 + rnd() * 0.03})`;
    g.fillRect(rnd() * W, 0, 1, H);
  }
  const t = finish(c);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** 多层板的断面（底板的侧面）：几层深浅相间的横条。 */
export function plyTexture(seed = 5) {
  const W = 512;
  const H = 128;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const rnd = mulberry32(seed);
  const plies = 7;
  for (let i = 0; i < plies; i++) {
    g.fillStyle = i % 2 === 0 ? '#e9dcc0' : '#c9b08a';
    g.fillRect(0, (i * H) / plies, W, H / plies + 1);
  }
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(70,48,24,${0.03 + rnd() * 0.06})`;
    g.fillRect(rnd() * W, rnd() * H, 2 + rnd() * 12, 1);
  }
  g.fillStyle = 'rgba(60,40,20,0.25)';
  for (let i = 1; i < plies; i++) g.fillRect(0, (i * H) / plies - 0.5, W, 1);
  const t = finish(c);
  t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** 胡桃木：深色，纹理长而直，夹着几道更深的线。 */
export function walnutTexture(seed = 9) {
  const S = 1024;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const rnd = mulberry32(seed);
  g.fillStyle = '#6b4a33';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 60; i++) {
    const y = rnd() * S;
    const h = 6 + rnd() * 60;
    g.fillStyle = rnd() < 0.55 ? `rgba(30,16,8,${0.05 + rnd() * 0.12})` : `rgba(150,110,70,${0.04 + rnd() * 0.08})`;
    for (const yy of [y, y - S]) g.fillRect(0, yy, S, h);
  }
  for (let i = 0; i < 1800; i++) {
    const y = rnd() * S;
    const x = rnd() * S;
    const len = 120 + rnd() * 700;
    g.strokeStyle = rnd() < 0.7 ? `rgba(26,14,6,${0.05 + rnd() * 0.16})` : `rgba(170,128,84,${0.04 + rnd() * 0.08})`;
    g.lineWidth = 0.6 + rnd() * 1.6;
    const dy = (rnd() - 0.5) * 8;
    for (const ox of [0, -S, S]) {
      g.beginPath();
      g.moveTo(x + ox, y);
      g.bezierCurveTo(x + ox + len * 0.3, y + dy, x + ox + len * 0.7, y - dy, x + ox + len, y + dy * 0.4);
      g.stroke();
    }
  }
  return finish(c);
}

/** 展厅台面上的一摊顶光：中间亮，往外退到背景色。 */
export function poolTexture(inner, outer) {
  const S = 512;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.28, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  return finish(c, { repeat: false });
}

/** 底座压在台面上的一圈软影。 */
export function blobTexture() {
  const S = 512;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  // 圆角矩形往外虚化：叠几层
  for (let i = 0; i < 46; i++) {
    const t = i / 45;
    const pad = 40 + t * 150;
    g.fillStyle = `rgba(40,30,22,${0.02 + 0.016 * t})`;
    const r = 110 - t * 80;
    g.beginPath();
    g.roundRect(pad, pad, S - pad * 2, S - pad * 2, Math.max(4, r));
    g.fill();
  }
  return finish(c, { repeat: false });
}

/** 田：浅刻的平行线（激光浅刻的效果），透明底。 */
export function hatchTexture(seed = 11) {
  const S = 128;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const rnd = mulberry32(seed);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#fbfbfb';
  g.fillRect(0, 0, S, S);
  for (let y = 0; y < S; y += 16) {
    g.fillStyle = `rgba(110,84,52,${0.2 + rnd() * 0.08})`;
    g.fillRect(0, y + 6, S, 3);
    g.fillStyle = 'rgba(110,84,52,0.06)';
    g.fillRect(0, y + 4, S, 2);
    g.fillRect(0, y + 9, S, 2);
  }
  return finish(c);
}

/** 屋顶的瓦垄：一道一道竖着的浅线。 */
export function tileTexture() {
  const S = 128;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  g.fillStyle = '#fbfbfb';
  g.fillRect(0, 0, S, S);
  for (let x = 0; x < S; x += 16) {
    g.fillStyle = 'rgba(70,48,26,0.3)';
    g.fillRect(x, 0, 3, S);
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(x + 7, 0, 4, S);
  }
  return finish(c);
}

/** 城墙的砖缝：很淡的横线，隔行错开的竖缝。 */
export function brickTexture(seed = 13) {
  const S = 128;
  const c = canvas(S, S);
  const g = c.getContext('2d');
  const rnd = mulberry32(seed);
  g.fillStyle = '#fafafa';
  g.fillRect(0, 0, S, S);
  const rows = 8;
  for (let r = 0; r < rows; r++) {
    const y = (r * S) / rows;
    g.fillStyle = 'rgba(96,72,44,0.2)';
    g.fillRect(0, y, S, 1.4);
    g.fillStyle = 'rgba(96,72,44,0.12)';
    for (let k = 0; k < 4; k++) g.fillRect(((k + (r % 2) * 0.5) * S) / 4, y, 1.2, S / rows);
    if (rnd() < 0.5) {
      g.fillStyle = 'rgba(96,72,44,0.035)';
      g.fillRect(0, y, S, S / rows);
    }
  }
  return finish(c);
}

/** 把一张 8 位灰度数据做成贴图（压暗图）。 */
export function dataTexture(data, w, h) {
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = data[i];
    rgba[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(rgba, w, h, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

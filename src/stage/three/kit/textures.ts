// 从样张搬来，结构没有动（spikes/art-direction/b/scene/geo.js 的后一半），只加了类型。
// 贴图都是代码画的。画在一张 canvas 上，所以要有页面（document）才能用；
// 零件库里只有 materials.ts 调用这里，算形状的程序不碰它。
// 样张里另有绫边、紫檀两种贴图，是座子用的，在宋代青绿设色那种样式自己的文件夹里（../style/song-qinglv/stand.ts）。

import * as THREE from 'three';
import { mulberry32 } from './util';

function tex(canvas: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}
function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (!g) throw new Error('这个浏览器画不了贴图（拿不到二维的画布）');
  return [c, g];
}

/** 瓦垄：u 方向一格一条瓦垄，v 方向是从檐口到脊 */
export function tileTexture(): THREE.CanvasTexture {
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
export function brickTexture(): THREE.CanvasTexture {
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
/**
 * 夯土的城墙：一版一版夯起来的横层。一张图管 48 米，分八层；层和层之间一道浅缝，每层深浅略有不同，
 * 层里面还有几道更淡的细夯层。要的是安静：远看只是一点横纹，不抢眼。四边接得上。
 */
export function rammedTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S, S);
  const rnd = mulberry32(211);
  g.fillStyle = '#f3efe6';
  g.fillRect(0, 0, S, S);
  const layers = 8;
  const lh = S / layers;
  for (let r = 0; r < layers; r++) {
    const y = r * lh;
    // 每一层深浅略有不同
    const v = 243 * (1 + (rnd() - 0.5) * 0.045);
    const warm = (rnd() - 0.5) * 4;
    g.fillStyle = `rgb(${Math.round(v + warm)},${Math.round(v)},${Math.round(v - 4 - warm)})`;
    g.fillRect(0, y, S, lh);
    // 层里面的细夯层：几道很淡的横线
    for (let k = 1; k < 4; k++) {
      g.fillStyle = `rgba(104,80,44,${0.03 + rnd() * 0.035})`;
      g.fillRect(0, Math.round(y + (k * lh) / 4 + (rnd() - 0.5) * 4), S, 1);
    }
    // 层和层之间的缝：上面一道深的，下面一道亮的
    g.fillStyle = 'rgba(92,68,36,0.17)';
    g.fillRect(0, y, S, 2);
    g.fillStyle = 'rgba(255,255,255,0.12)';
    g.fillRect(0, y + 2, S, 1);
    // 夯土用的木板一块接一块：每层几道很淡的竖缝，上下两层错开
    let x = rnd() * 150;
    while (x < S) {
      g.fillStyle = 'rgba(92,68,36,0.07)';
      g.fillRect(Math.round(x), y + 2, 1, lh - 2);
      x += 120 + rnd() * 90;
    }
  }
  // 雨水留下的很淡的竖痕
  for (let i = 0; i < 26; i++) {
    const x = rnd() * S;
    const w = 8 + rnd() * 40;
    g.fillStyle = rnd() < 0.6 ? `rgba(70,56,34,${0.012 + rnd() * 0.022})` : `rgba(255,255,255,${0.015 + rnd() * 0.03})`;
    for (const xx of [x, x - S]) g.fillRect(xx, 0, w, S);
  }
  return tex(c);
}
/** 条石：石岸、台基用。一皮高，石块长短不一 */
export function stoneTexture(): THREE.CanvasTexture {
  const S = 512;
  const [c, g] = canvas(S, S);
  const rnd = mulberry32(131);
  g.fillStyle = '#cdc8bb';
  g.fillRect(0, 0, S, S);
  const rh = 32;
  for (let r = 0; r < S / rh; r++) {
    const ws: number[] = [];
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
export function washTexture(): THREE.CanvasTexture {
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
export function strawTexture(): THREE.CanvasTexture {
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

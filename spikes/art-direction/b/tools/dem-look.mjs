// 开工前看一眼高程：把高程画成一张带等高色的灰度图，标出城、河、地点。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const shared = path.join(here, '../../shared');
const meta = JSON.parse(fs.readFileSync(path.join(shared, 'xuzhou-dem.json'), 'utf8'));
const buf = fs.readFileSync(path.join(shared, 'xuzhou-dem.bin'));
const raw = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
const { cols, rows } = meta;
const H = (c, r) => raw[r * cols + c] / 10;
const ORIGIN = { lng: 117.185, lat: 34.2655 };
const MLAT = 110950, MLNG = 111320 * Math.cos(ORIGIN.lat * Math.PI / 180);
const toLocal = (lng, lat) => ({ x: (lng - ORIGIN.lng) * MLNG, z: -(lat - ORIGIN.lat) * MLAT });
const nw = toLocal(meta.west, meta.north), se = toLocal(meta.east, meta.south);
console.log('extent x', nw.x.toFixed(0), se.x.toFixed(0), 'z', nw.z.toFixed(0), se.z.toFixed(0));
const hAt = (x, z) => {
  const c = Math.round((x - nw.x) / (se.x - nw.x) * (cols - 1)), r = Math.round((z - nw.z) / (se.z - nw.z) * (rows - 1));
  return H(Math.max(0, Math.min(cols - 1, c)), Math.max(0, Math.min(rows - 1, r)));
};
const P = { city: [117.185, 34.2655], ximatai: [117.1842, 34.2564], yunlong: [117.1723, 34.2394], fanghe: [117.1787, 34.2477], baibu: [117.1967, 34.247], conf: [117.1935, 34.2724] };
for (const [k, [lng, lat]] of Object.entries(P)) { const p = toLocal(lng, lat); console.log(k, p.x.toFixed(0), p.z.toFixed(0), hAt(p.x, p.z)); }
// histogram
const hist = {};
for (let i = 0; i < raw.length; i++) { const b = Math.floor(raw[i] / 100) * 10; hist[b] = (hist[b] || 0) + 1; }
console.log(Object.entries(hist).map(([k, v]) => k + ':' + v).join(' '));
// image
const S = 3;
const png = new PNG({ width: cols * S, height: rows * S });
for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
  const h = H(c, r);
  const hx = H(Math.min(cols - 1, c + 1), r) - H(Math.max(0, c - 1), r);
  const hz = H(c, Math.min(rows - 1, r + 1)) - H(c, Math.max(0, r - 1));
  let sh = 0.75 - (hx + hz) * 0.02; sh = Math.max(0.2, Math.min(1.1, sh));
  let col;
  if (h < 30) col = [120, 160, 200]; else if (h < 36) col = [170, 200, 190]; else if (h < 42) col = [215, 210, 170]; else if (h < 48) col = [225, 195, 150]; else if (h < 60) col = [200, 170, 120]; else if (h < 90) col = [150, 170, 110]; else if (h < 130) col = [90, 140, 100]; else col = [60, 100, 140];
  for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) {
    const i = ((r * S + dy) * cols * S + c * S + dx) * 4;
    png.data[i] = Math.min(255, col[0] * sh); png.data[i + 1] = Math.min(255, col[1] * sh); png.data[i + 2] = Math.min(255, col[2] * sh); png.data[i + 3] = 255;
  }
}
const dot = (x, z, rgb, rad = 3) => {
  const c = (x - nw.x) / (se.x - nw.x) * (cols - 1) * S, r = (z - nw.z) / (se.z - nw.z) * (rows - 1) * S;
  for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
    const px = Math.round(c + dx), py = Math.round(r + dy); if (px < 0 || py < 0 || px >= cols * S || py >= rows * S) continue;
    const i = (py * cols * S + px) * 4; png.data[i] = rgb[0]; png.data[i + 1] = rgb[1]; png.data[i + 2] = rgb[2];
  }
};
const line = (pts, rgb) => { for (let k = 0; k < pts.length - 1; k++) { const a = toLocal(...pts[k]), b = toLocal(...pts[k + 1]); for (let t = 0; t <= 1; t += 0.002) dot(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, rgb, 1); } };
line([[117.05, 34.29], [117.1, 34.283], [117.15, 34.2765], [117.176, 34.2728], [117.1935, 34.2724]], [0, 60, 255]);
line([[117.215, 34.35], [117.207, 34.32], [117.199, 34.292], [117.1935, 34.2724]], [0, 60, 255]);
line([[117.1935, 34.2724], [117.1938, 34.262], [117.1967, 34.247], [117.212, 34.228], [117.25, 34.2], [117.3, 34.172]], [0, 60, 255]);
line([[117.1785, 34.2709], [117.1915, 34.2709], [117.1915, 34.2601], [117.1785, 34.2601], [117.1785, 34.2709]], [255, 0, 0]);
for (const [k, [lng, lat]] of Object.entries(P)) { const p = toLocal(lng, lat); dot(p.x, p.z, [255, 0, 255], 4); }
// crop candidates
const rect = (x0, x1, z0, z1, rgb) => { for (let t = 0; t <= 1; t += 0.001) { dot(x0 + (x1 - x0) * t, z0, rgb, 1); dot(x0 + (x1 - x0) * t, z1, rgb, 1); dot(x0, z0 + (z1 - z0) * t, rgb, 1); dot(x1, z0 + (z1 - z0) * t, rgb, 1); } };
rect(-7500, 5500, -4500, 5500, [255, 255, 255]);
fs.writeFileSync(path.join(here, '../shots-work/dem-look.png'), PNG.sync.write(png));
console.log('ok');

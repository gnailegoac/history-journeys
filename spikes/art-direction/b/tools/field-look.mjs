// 不开浏览器，先看整理后的地形：平时的水、大水的水各淹到哪里。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { toLocal } from '../../shared/scene-data.js';
import { buildTerrainData } from '../scene/terrain-data.js';
import { CROP, CELL, LEVEL } from '../scene/config.js';
const here = path.dirname(fileURLToPath(import.meta.url));
const shared = path.join(here, '../../shared');
const meta = JSON.parse(fs.readFileSync(path.join(shared, 'xuzhou-dem.json'), 'utf8'));
const buf = fs.readFileSync(path.join(shared, 'xuzhou-dem.bin'));
const raw = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
const heights = new Float32Array(raw.length);
for (let i = 0; i < raw.length; i++) heights[i] = raw[i] / 10;
const nw = toLocal(meta.west, meta.north), se = toLocal(meta.east, meta.south);
const dem = { meta, heights, minX: nw.x, maxX: se.x, minZ: nw.z, maxZ: se.z };
const t0 = Date.now();
const td = buildTerrainData(dem);
console.log('build ms', Date.now() - t0, 'grid', td.nx, td.nz, 'villages', td.villages.length);
let mn = 1e9, mx = -1e9; const hist = {};
for (let k = 0; k < td.h.length; k++) { mn = Math.min(mn, td.h[k]); mx = Math.max(mx, td.h[k]); const b = Math.floor(td.h[k]); if (b < 50) hist[b] = (hist[b] || 0) + 1; }
console.log('min', mn.toFixed(1), 'max', mx.toFixed(1), Object.entries(hist).map(([k, v]) => k + ':' + v).join(' '));
const { nx, nz } = td;
const png = new PNG({ width: nx, height: nz });
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
  const k = j * nx + i; const h = td.h[k]; const hw = td.hw[k];
  const sl = (td.h[j * nx + Math.min(nx - 1, i + 1)] - td.h[j * nx + Math.max(0, i - 1)]) + (td.h[Math.min(nz - 1, j + 1) * nx + i] - td.h[Math.max(0, j - 1) * nx + i]);
  let sh = Math.max(0.35, Math.min(1.15, 0.85 - sl * 0.06));
  let c = h < 41 ? [214, 196, 150] : h < 44 ? [200, 170, 110] : h < 60 ? [120, 165, 125] : h < 90 ? [80, 130, 150] : [50, 90, 150];
  c = c.map((v) => v * sh);
  if (hw < LEVEL.flood) c = [c[0] * 0.55 + 70, c[1] * 0.55 + 95, c[2] * 0.55 + 110];
  if (hw < LEVEL.normal) c = [40, 90, 200];
  const o = k * 4; png.data[o] = Math.min(255, c[0]); png.data[o + 1] = Math.min(255, c[1]); png.data[o + 2] = Math.min(255, c[2]); png.data[o + 3] = 255;
}
for (const v of td.villages) { const i = Math.round((v.x - CROP.x0) / CELL), j = Math.round((v.z - CROP.z0) / CELL); for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const o = ((j + a) * nx + i + b) * 4; png.data[o] = 255; png.data[o + 1] = 0; png.data[o + 2] = 0; } }
fs.writeFileSync(path.join(here, '../shots-work/field-look.png'), PNG.sync.write(png));

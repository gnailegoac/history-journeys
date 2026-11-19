// 干活时用：不开浏览器，在 Node 里把上色的结果（加上大致的受光和水）画成一张正上方看的 PNG。
//   node tools/preview.mjs [a|b] [缩小几倍，默认 2]
// 图放在 ../shots-work/preview-<a|b>.png。同页面里真正的沙盘不完全一样（没有水纹、没有装裱）。
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepare, build, RELIEF, TEX } from '../scene/fields.js';
import { TABLE } from '../scene/proj.js';
import { PAL } from '../scene/palette.js';
import { hex, mix3, smoothstep, clamp } from '../scene/util.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../package.json'));
const { PNG } = require('pngjs');
const data = path.join(here, '../data');
const which = process.argv[2] || 'a';
const DS = Number(process.argv[3] || 2);

const buf = readFileSync(path.join(data, 'dem.bin'));
const dem = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
const water = JSON.parse(readFileSync(path.join(data, 'water.json'), 'utf8'));
const song = JSON.parse(readFileSync(path.join(data, 'song-overlay.json'), 'utf8'));
const t0 = Date.now();
const prep = prepare(dem, water, song);
const t1 = Date.now();
const out = build(prep, RELIEF[which]);
console.log('prepare', t1 - t0, 'ms; build', Date.now() - t1, 'ms');

const W = Math.floor(TEX.w / DS);
const H = Math.floor(TEX.h / DS);
const png = new PNG({ width: W, height: H });
const L = [-0.66, 0.6, -0.42];
const ll = Math.hypot(...L);
const shallow = hex(PAL.water);
const deep = hex(PAL.waterDeep);
const foam = hex(PAL.ripple);
const { cols, rows } = TABLE;
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const t = j * DS * TEX.w + i * DS;
  const c = Math.min(cols - 1, Math.round(((i * DS) / TEX.w) * (cols - 1)));
  const r = Math.min(rows - 1, Math.round(((j * DS) / TEX.h) * (rows - 1)));
  const k = (r * cols + c) * 4;
  const nx = out.normal[k] / 127.5 - 1;
  const ny = out.normal[k + 1] / 127.5 - 1;
  const nz = out.normal[k + 2] / 127.5 - 1;
  const ndl = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / ll);
  const hemi = 0.5 + 0.5 * ny;
  const lit = (2.6 * ndl) / Math.PI + (1.55 / Math.PI) * (0.77 + 0.23 * hemi);
  let col = [out.color[t * 4] * lit, out.color[t * 4 + 1] * lit, out.color[t * 4 + 2] * lit];
  const sdf = out.color[t * 4 + 3] / 255;
  const wat = smoothstep(0.42, 0.58, sdf);
  if (wat > 0) {
    const off = prep.wide[t];
    let wc = mix3(shallow, deep, smoothstep(0.82, 1.0, off));
    wc = mix3(wc, foam, (1 - smoothstep(0.5, 0.66, off)) * 0.55);
    col = mix3(col, wc, wat);
  }
  const o = (j * W + i) * 4;
  png.data[o] = clamp(Math.round(col[0]), 0, 255);
  png.data[o + 1] = clamp(Math.round(col[1]), 0, 255);
  png.data[o + 2] = clamp(Math.round(col[2]), 0, 255);
  png.data[o + 3] = 255;
}
mkdirSync(path.join(here, '../shots-work'), { recursive: true });
const file = path.join(here, `../shots-work/preview-${which}.png`);
writeFileSync(file, PNG.sync.write(png));
console.log('wrote', path.relative(path.join(here, '..'), file), W, H);

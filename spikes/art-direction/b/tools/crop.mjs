// 从一张图里裁一块出来细看：node tools/crop.mjs <图> <存成> x y w h
import fs from 'node:fs';
import { PNG } from 'pngjs';
const [src, dst, x, y, w, h] = process.argv.slice(2);
const a = PNG.sync.read(fs.readFileSync(src));
const b = new PNG({ width: +w, height: +h });
PNG.bitblt(a, b, +x, +y, +w, +h, 0, 0);
fs.writeFileSync(dst, PNG.sync.write(b));

// 开发用：量一张图里某几块的平均颜色。node probe.mjs in.png x,y[,r] x,y[,r] ...
import fs from 'node:fs';
import { PNG } from 'pngjs';
const [, , inp, ...pts] = process.argv;
const src = PNG.sync.read(fs.readFileSync(inp));
for (const p of pts) {
  const [x, y, r = 3] = p.split(',').map(Number);
  let R = 0, G = 0, B = 0, n = 0;
  for (let j = y - r; j <= y + r; j++)
    for (let i = x - r; i <= x + r; i++) {
      if (i < 0 || j < 0 || i >= src.width || j >= src.height) continue;
      const k = (j * src.width + i) * 4;
      R += src.data[k]; G += src.data[k + 1]; B += src.data[k + 2]; n++;
    }
  const h = (v) => Math.round(v / n).toString(16).padStart(2, '0');
  console.log(p, '#' + h(R) + h(G) + h(B));
}

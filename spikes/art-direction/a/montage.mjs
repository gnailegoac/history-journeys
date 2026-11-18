// 开发用：把几张图缩小拼成一张，一眼看完。node montage.mjs out.png a.png b.png c.png d.png
import fs from 'node:fs';
import { PNG } from 'pngjs';
const [, , out, ...files] = process.argv;
const imgs = files.map((f) => PNG.sync.read(fs.readFileSync(f)));
const cell = 560;
const cols = 2;
const rows = Math.ceil(imgs.length / cols);
const dst = new PNG({ width: cell * cols, height: cell * rows });
dst.data.fill(255);
imgs.forEach((src, n) => {
  const k = Math.max(src.width, src.height) / cell;
  const ox = (n % cols) * cell;
  const oy = Math.floor(n / cols) * cell;
  for (let y = 0; y < Math.floor(src.height / k); y++)
    for (let x = 0; x < Math.floor(src.width / k); x++) {
      // 取一小块的平均，免得缩小以后发花
      let r = 0, g = 0, b = 0, c = 0;
      for (let dy = 0; dy < k; dy++)
        for (let dx = 0; dx < k; dx++) {
          const sx = Math.min(src.width - 1, Math.floor(x * k + dx));
          const sy = Math.min(src.height - 1, Math.floor(y * k + dy));
          const i = (sy * src.width + sx) * 4;
          r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; c++;
        }
      const o = ((oy + y) * dst.width + ox + x) * 4;
      dst.data[o] = r / c; dst.data[o + 1] = g / c; dst.data[o + 2] = b / c; dst.data[o + 3] = 255;
    }
});
fs.writeFileSync(out, PNG.sync.write(dst));
console.log(out);

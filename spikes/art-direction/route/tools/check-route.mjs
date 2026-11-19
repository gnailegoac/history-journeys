// 检查路线：有没有哪一段从湖上、海上穿过去（明说过水的除外）。有就报出来，退出码 1。
//   node tools/check-route.mjs
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepare } from '../scene/fields.js';
import { buildLegs, strokes } from '../scene/route.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const data = path.join(here, '../data');
const buf = readFileSync(path.join(data, 'dem.bin'));
const dem = new Int16Array(buf.buffer, buf.byteOffset, buf.length / 2);
const J = (f) => JSON.parse(readFileSync(path.join(data, f), 'utf8'));
const water = J('water.json');
const song = J('song-overlay.json');
const fig = J('figure.json');
const prep = prepare(dem, water, song);
const { legs, problems } = buildLegs(fig, prep.rivers, prep.songLines, prep.waterAt);
legs.forEach((l, i) => console.log(`第 ${i + 1} 段 ${l.from} → ${l.to}：${Math.round(l.km)} 公里，${l.spans.length} 截；` + l.spans.map((s) => s.a + (s.river ? '~' : s.dash ? '··' : '-') + s.b).join(' ')));
const all = strokes(legs, legs.map(() => 'ink'));
console.log('整张图上的笔画：', all.length, '（虚线', all.filter((s) => s.dash).length, '）');
if (problems.length) {
  console.log('从水上穿过去的：', JSON.stringify(problems));
  process.exit(1);
}
console.log('没有哪一段从湖上或海上穿过去。');

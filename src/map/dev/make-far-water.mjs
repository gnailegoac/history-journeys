// 生成 src/map/maplibre/data/far-water.json：从远处看时用的大河和大湖（全球）。
// 数据来自 Natural Earth 1:5000 万（公有领域，https://www.naturalearthdata.com/）。
// 只在数据要更新时手工运行一次：
//   node src/map/dev/make-far-water.mjs <ne_50m_rivers_lake_centerlines.geojson> <ne_50m_lakes.geojson>
// 两个输入文件取自 https://github.com/nvkelso/natural-earth-vector 的 geojson 目录。
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [riversFile, lakesFile] = process.argv.slice(2);
if (!riversFile || !lakesFile) {
  console.error('用法：node make-far-water.mjs <河流.geojson> <湖泊.geojson>');
  process.exit(1);
}
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../maplibre/data/far-water.json');

// 坐标留两位小数（约 1 公里），比原数据的精度还细；去掉取整后重复的点。
const round = (v) => Math.round(v * 100) / 100;
function line(points) {
  const result = [];
  for (const p of points) {
    const q = [round(p[0]), round(p[1])];
    const last = result[result.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) result.push(q);
  }
  return result;
}

const features = [];
const rivers = JSON.parse(readFileSync(riversFile, 'utf8'));
for (const f of rivers.features) {
  const lines = (f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates)
    .map(line)
    .filter((l) => l.length >= 2);
  if (!lines.length) continue;
  // r：Natural Earth 的 scalerank，1 是最大的河
  features.push({ type: 'Feature', properties: { k: 'river', r: f.properties.scalerank }, geometry: { type: 'MultiLineString', coordinates: lines } });
}
const lakes = JSON.parse(readFileSync(lakesFile, 'utf8'));
for (const f of lakes.features) {
  if (f.properties.featurecla === 'Reservoir') continue; // 水库是今天才有的
  const rings = f.geometry.coordinates.map(line).filter((r) => r.length >= 4);
  if (!rings.length) continue;
  features.push({ type: 'Feature', properties: { k: 'lake' }, geometry: { type: 'Polygon', coordinates: rings } });
}
writeFileSync(out, JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`${out}: ${features.length} 个要素`);

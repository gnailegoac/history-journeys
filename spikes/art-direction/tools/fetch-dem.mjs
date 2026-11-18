// 取徐州一带的真实高程，存成样张共用的一张高程网格。
// 数据：Mapzen Terrarium 高程瓦片（公开，不需要密钥）。运行：node tools/fetch-dem.mjs
import { writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';

const AREA = { west: 117.05, east: 117.32, south: 34.17, north: 34.35 };
const Z = 12;
const CELL_M = 60;
const OUT = new URL('../shared/', import.meta.url);

const n = 2 ** Z;
const lngToX = (lng) => ((lng + 180) / 360) * n;
const latToY = (lat) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
};

const x0 = Math.floor(lngToX(AREA.west));
const x1 = Math.floor(lngToX(AREA.east));
const y0 = Math.floor(latToY(AREA.north));
const y1 = Math.floor(latToY(AREA.south));
const tw = x1 - x0 + 1;
const th = y1 - y0 + 1;
console.log(`tiles z${Z}: x ${x0}..${x1}, y ${y0}..${y1} (${tw * th} tiles)`);

const mosaic = new Float32Array(tw * 256 * th * 256);
for (let ty = y0; ty <= y1; ty++) {
  for (let tx = x0; tx <= x1; tx++) {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
    for (let py = 0; py < 256; py++) {
      for (let px = 0; px < 256; px++) {
        const i = (py * 256 + px) * 4;
        const h = png.data[i] * 256 + png.data[i + 1] + png.data[i + 2] / 256 - 32768;
        mosaic[((ty - y0) * 256 + py) * tw * 256 + (tx - x0) * 256 + px] = h;
      }
    }
  }
}

const midLat = (AREA.south + AREA.north) / 2;
const widthM = (AREA.east - AREA.west) * 111320 * Math.cos((midLat * Math.PI) / 180);
const heightM = (AREA.north - AREA.south) * 110950;
const cols = Math.round(widthM / CELL_M) + 1;
const rows = Math.round(heightM / CELL_M) + 1;

const sample = (lng, lat) => {
  const fx = (lngToX(lng) - x0) * 256 - 0.5;
  const fy = (latToY(lat) - y0) * 256 - 0.5;
  const ix = Math.max(0, Math.min(tw * 256 - 2, Math.floor(fx)));
  const iy = Math.max(0, Math.min(th * 256 - 2, Math.floor(fy)));
  const ax = Math.max(0, Math.min(1, fx - ix));
  const ay = Math.max(0, Math.min(1, fy - iy));
  const at = (x, y) => mosaic[y * tw * 256 + x];
  return (
    at(ix, iy) * (1 - ax) * (1 - ay) + at(ix + 1, iy) * ax * (1 - ay) + at(ix, iy + 1) * (1 - ax) * ay + at(ix + 1, iy + 1) * ax * ay
  );
};

const grid = new Int16Array(cols * rows);
let min = Infinity;
let max = -Infinity;
for (let r = 0; r < rows; r++) {
  const lat = AREA.north - ((AREA.north - AREA.south) * r) / (rows - 1);
  for (let c = 0; c < cols; c++) {
    const lng = AREA.west + ((AREA.east - AREA.west) * c) / (cols - 1);
    const h = sample(lng, lat);
    min = Math.min(min, h);
    max = Math.max(max, h);
    grid[r * cols + c] = Math.round(h * 10);
  }
}

writeFileSync(new URL('xuzhou-dem.bin', OUT), Buffer.from(grid.buffer));
const meta = {
  ...AREA,
  cols,
  rows,
  widthM: Math.round(widthM),
  heightM: Math.round(heightM),
  cellM: CELL_M,
  minM: Math.round(min * 10) / 10,
  maxM: Math.round(max * 10) / 10,
  format: 'Int16 little-endian, 分米；第 0 行在最北，第 0 列在最西；逐行存',
  source: 'Mapzen Terrarium 高程瓦片（今天的地形）',
};
writeFileSync(new URL('xuzhou-dem.json', OUT), JSON.stringify(meta, null, 2) + '\n');
console.log(meta);

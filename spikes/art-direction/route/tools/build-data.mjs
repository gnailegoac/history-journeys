// 做全程沙盘要用的数据（只在做数据时跑一次，结果放在 ../data/ 里随页面走）：
//   node tools/build-data.mjs <放高程瓦片的目录> <放 Natural Earth geojson 的目录>
// 高程：Mapzen Terrarium 公开瓦片（z7），重新取样到圆锥投影的 3 公里格子，整米，海面按 0。
// 岸线、河、湖：Natural Earth 1:10m（公有领域），裁到桌面范围；后来才有的湖和水库去掉。
// 两个目录里缺的文件会从公开地址取（不带任何个人信息）。
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toLngLat, TABLE, PROJ } from '../scene/proj.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../package.json'));
const { PNG } = require('pngjs');
const [tileDir, neDir] = process.argv.slice(2);
if (!tileDir || !neDir) throw new Error('用法：node tools/build-data.mjs <瓦片目录> <NaturalEarth 目录>');
const outDir = path.join(here, '../data');
mkdirSync(outDir, { recursive: true });

// ---------- 1. 高程 ----------
const Z = 7;
const NT = 2 ** Z;
const lngToX = (lng) => ((lng + 180) / 360) * NT;
const latToY = (lat) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * NT;
};
const tiles = new Map();
async function loadTile(tx, ty) {
  const key = `${Z}_${tx}_${ty}`;
  const file = path.join(tileDir, key + '.png');
  let buf;
  if (existsSync(file)) buf = readFileSync(file);
  else {
    const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${tx}/${ty}.png`);
    if (!res.ok) throw new Error('取瓦片失败 ' + key + ' ' + res.status);
    buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(file, buf);
    console.log('fetched', key, buf.length);
  }
  const png = PNG.sync.read(buf);
  const h = new Float32Array(256 * 256);
  for (let i = 0; i < 65536; i++) h[i] = Math.max(0, png.data[i * 4] * 256 + png.data[i * 4 + 1] + png.data[i * 4 + 2] / 256 - 32768);
  tiles.set(key, h);
}
{
  const { cols, rows, cell, w, h } = TABLE;
  // 先看要哪些瓦片
  const need = new Set();
  for (let r = 0; r <= rows; r += 4) for (let c = 0; c <= cols; c += 4) {
    const [lng, lat] = toLngLat(-w / 2 + c * cell, h / 2 - r * cell);
    for (const dx of [-0.02, 0.02]) for (const dy of [-0.02, 0.02]) need.add(`${Math.floor(lngToX(lng + dx))}_${Math.floor(latToY(lat + dy))}`);
  }
  for (const k of need) {
    const [tx, ty] = k.split('_').map(Number);
    await loadTile(tx, ty);
  }
  const at = (x, y) => {
    const t = tiles.get(`${Z}_${x >> 8}_${y >> 8}`);
    return t ? t[(y & 255) * 256 + (x & 255)] : 0;
  };
  const elev = (lng, lat) => {
    const fx = lngToX(lng) * 256 - 0.5;
    const fy = latToY(lat) * 256 - 0.5;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const ax = fx - ix;
    const ay = fy - iy;
    return at(ix, iy) * (1 - ax) * (1 - ay) + at(ix + 1, iy) * ax * (1 - ay) + at(ix, iy + 1) * (1 - ax) * ay + at(ix + 1, iy + 1) * ax * ay;
  };
  const out = new Int16Array(cols * rows);
  let max = 0;
  const SS = 3;
  for (let r = 0; r < rows; r++) {
    const y = h / 2 - r * cell;
    for (let c = 0; c < cols; c++) {
      const x = -w / 2 + c * cell;
      let s = 0;
      for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) {
        const [lng, lat] = toLngLat(x + ((i + 0.5) / SS - 0.5) * cell, y + ((j + 0.5) / SS - 0.5) * cell);
        s += elev(lng, lat);
      }
      const v = Math.round(s / (SS * SS));
      out[r * cols + c] = v;
      if (v > max) max = v;
    }
  }
  writeFileSync(path.join(outDir, 'dem.bin'), Buffer.from(out.buffer));
  const corners = [[-w / 2, h / 2], [w / 2, h / 2], [-w / 2, -h / 2], [w / 2, -h / 2], [0, h / 2], [0, -h / 2]].map(([x, y]) => toLngLat(x, y).map((v) => +v.toFixed(2)));
  writeFileSync(path.join(outDir, 'dem.json'), JSON.stringify({
    what: '苏轼全程沙盘的高程：今天的地形，整米（Int16，小端），海面按 0，第 0 行在北边',
    source: 'Mapzen Terrarium 公开高程瓦片 z7，每格取 3x3 个点平均',
    projection: { kind: '兰勃特等角圆锥', ...PROJ },
    cols, rows, cellKm: cell, widthKm: w, heightKm: h, maxM: max,
    cornersLngLat: { nw: corners[0], ne: corners[1], sw: corners[2], se: corners[3], n: corners[4], s: corners[5] },
  }, null, 1));
  console.log('dem', cols, rows, 'max', max, 'tiles', tiles.size, 'corners', JSON.stringify(corners));
}

// ---------- 2. 岸线、河、湖 ----------
const BOX = { w: 100.3, e: 124.3, s: 16.8, n: 39.3 };
const r3 = (v) => Math.round(v * 1000) / 1000;
const ne = (name) => JSON.parse(readFileSync(path.join(neDir, name + '.geojson'), 'utf8'));
// 多边形裁到方框（Sutherland–Hodgman）
function clipRing(ring) {
  let pts = ring;
  const edges = [
    [(p) => p[0] >= BOX.w, (a, b) => [BOX.w, a[1] + ((b[1] - a[1]) * (BOX.w - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= BOX.e, (a, b) => [BOX.e, a[1] + ((b[1] - a[1]) * (BOX.e - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= BOX.s, (a, b) => [a[0] + ((b[0] - a[0]) * (BOX.s - a[1])) / (b[1] - a[1]), BOX.s]],
    [(p) => p[1] <= BOX.n, (a, b) => [a[0] + ((b[0] - a[0]) * (BOX.n - a[1])) / (b[1] - a[1]), BOX.n]],
  ];
  for (const [inside, cut] of edges) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ia = inside(a);
      const ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) out.push(cut(a, b));
    }
    pts = out;
    if (pts.length < 3) return null;
  }
  const res = [];
  for (const p of pts) {
    const q = [r3(p[0]), r3(p[1])];
    const l = res[res.length - 1];
    if (!l || l[0] !== q[0] || l[1] !== q[1]) res.push(q);
  }
  return res.length >= 3 ? res : null;
}
const ringsOf = (g) => (g.type === 'Polygon' ? g.coordinates : g.coordinates.flat());
const land = [];
for (const name of ['ne_10m_land', 'ne_10m_minor_islands']) {
  for (const f of ne(name).features) for (const ring of ringsOf(f.geometry)) {
    const c = clipRing(ring);
    if (c) land.push(c);
  }
}
const nV = (a) => a.reduce((s, l) => s + l.length, 0);
console.log('land rings', land.length, 'vertices', nV(land));

// 湖：去掉的每一个都写明原因
const DROP_LAKES = [
  ['Hongze Hu', '洪泽湖：明清黄河夺淮以后才成大湖'],
  ['Weishan Hu', '微山湖（南四湖）：明清以后才有'],
  ['Luoma Hu', '骆马湖：后来才成湖'],
  ['Dongping Hu', '东平湖：用示意的梁山泊代替'],
  ['Xinfengjiang Shuiku', '新丰江水库：现代水库'],
  ['Danjiangkou Shuiku', '丹江口水库：现代水库'],
  ['Xinanjiang Shuiku', '新安江水库（千岛湖）：现代水库'],
  ['Baidagang Shuiku', '北大港水库：现代水库'],
  ['Nam Ngum Reservoir', '现代水库（境外）'],
  ['Ubolratna Reservoir', '现代水库（境外）'],
  ['Siri Kit Dam', '现代水库（境外）'],
  ['Qinghai Hu', '在桌面以外'],
];
// 没有名字、按位置认出来的水库
const DROP_AT = [
  [114.25, 33.02, '宿鸭湖水库（按位置认的）：现代水库'],
  [112.57, 33.32, '大概是白龟山水库（按位置猜的，没有核对）：现代水库'],
];
const ZH = { 'Tai Hu': '太湖', 'Poyang Hu': '鄱阳湖', 'Daguan Hu': '大官湖', 'Long Hu': '龙感湖', 'Liangzi Hu': '梁子湖', 'Gaoyou Hu': '高邮湖', 'Po Hu': '泊湖', 'Shijiu Hu': '石臼湖', 'Hong Hu': '洪湖', 'Chao Hu': '巢湖', 'Huangtang Hu': '黄盖湖一带', 'Dongting Hu': '洞庭湖', 'Ge Hu': '滆湖', 'Wuchang Hu': '武昌湖' };
const lakes = [];
const removed = [];
for (const f of ne('ne_10m_lakes').features) {
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const p of polys) {
    const ring = p[0];
    if (!ring.some((q) => q[0] > BOX.w && q[0] < BOX.e && q[1] > BOX.s && q[1] < BOX.n)) continue;
    let cx = 0;
    let cy = 0;
    let A = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const c = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      A += c;
      cx += (ring[i][0] + ring[i + 1][0]) * c;
      cy += (ring[i][1] + ring[i + 1][1]) * c;
    }
    A /= 2;
    cx /= 6 * A;
    cy /= 6 * A;
    const km2 = Math.round(Math.abs(A) * 111 * 111 * Math.cos((cy * Math.PI) / 180));
    const nm = f.properties.name;
    const drop = DROP_LAKES.find((d) => d[0] === nm) || DROP_AT.find((d) => Math.hypot(d[0] - cx, d[1] - cy) < 0.08);
    if (drop) {
      removed.push({ kind: '湖', name: nm || '（无名）', at: [r3(cx), r3(cy)], km2, why: drop[drop.length - 1] });
      continue;
    }
    if (km2 < 40) continue; // 太小，桌面上不到一个点
    let pts = ring.map((q) => [r3(q[0]), r3(q[1])]);
    let note;
    if (nm === 'Gaoyou Hu') {
      // 当时是一串小湖，不是今天这一大片：按中心缩到六成，示意
      pts = ring.map((q) => [r3(cx + (q[0] - cx) * 0.6), r3(cy + (q[1] - cy) * 0.6)]);
      note = '示意：当时是一串小湖，把今天的湖按中心缩小到六成（面积约三分之一）';
    }
    lakes.push({ name: nm || null, zh: ZH[nm] || null, at: [r3(cx), r3(cy)], km2, note, ring: pts });
  }
}
console.log('lakes kept', lakes.length, 'vertices', nV(lakes.map((l) => l.ring)), 'removed', removed.length);

// 河：只留故事里这片地方的；今天才这样流的几段去掉
const RZH = { Huang: '黄河', 'Chang Jiang': '大江（长江）', Yangtze: '大江（长江）', Jinsha: '金沙江', Han: '汉水', Huai: '淮水', Hudi: '淮水', Xiang: '湘水', Gan: '赣水', Jialing: '嘉陵江', Wu: '乌江', Wei: '渭水', Fen: '汾水', Fuchun: '浙江（钱塘江）', Bei: '北江', Dong: '东江', Xi: '西江', Xun: '浔江', Min: '岷江', Dadu: '大渡河', Tuo: '岷江上游、沱江', Yuan: '沅水', Ying: '颍水', Jing: '泾水', Qin: '沁水', Zhang: '漳水', Dan: '丹水', Ou: '瓯江', Jiulong: '九龙江', Mei: '梅江', Yi: '沭水', Huan: '环江', Nanpan: '南盘江', Hongshui: '红水河', Liu: '柳江', Rong: '融江', Duliu: '都柳江', Yu: '郁江', Yong: '邕江', You: '右江', Zuo: '左江', Dali: '大理河', Wuding: '无定河' };
const OFF = new Set(['Hong', 'Da', 'Ca', 'Mekong', 'Lancang', 'Ngun', 'Yom', 'Chi', 'Kong', 'Cagayan', 'Hai', 'Yongding', 'Luan', 'Sanggan', 'Yalong']);
const rivers = [];
for (const f of ne('ne_10m_rivers_lake_centerlines').features) {
  if (!f.geometry) continue;
  const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (let line of lines) {
    if (!line.some((q) => q[0] > BOX.w && q[0] < BOX.e && q[1] > BOX.s && q[1] < BOX.n)) continue;
    const nm = f.properties.name;
    const a = line[0];
    const b = line[line.length - 1];
    const drop = (why) => removed.push({ kind: '河', name: nm || '（无名）', from: [r3(a[0]), r3(a[1])], to: [r3(b[0]), r3(b[1])], why });
    if (OFF.has(nm) || (nm === 'Ou' && a[0] < 105) || (!nm && a[0] < 105)) {
      drop('不在故事里的地方（境外或桌面以外），不画');
      continue;
    }
    let zh = RZH[nm] || null;
    let cut;
    if (nm === 'Jinsha') line = line.filter((q) => q[0] > 102.9); // 只留进盆地前的一小段
    if (nm === 'Huang') {
      if (a[0] > 114.5) {
        drop('今天的黄河下游（1855 年以后的河道，过济南入海）：当时不走这里');
        continue;
      }
      if (b[0] > 114.5) {
        line = line.filter((q) => q[0] <= 113.42);
        cut = '今天的河道只留到汴口上游（113.42°E），往下当时不走这里';
      }
    }
    if (nm === 'Hudi') {
      const west = Math.min(a[0], b[0]);
      if (west > 118.6) {
        drop('今天淮河经洪泽湖、高邮湖入长江的河道：当时不走这里');
        continue;
      }
      if (Math.max(a[0], b[0]) > 118.5) {
        line = line.filter((q) => q[0] <= 118.5);
        cut = '只留到泗州（今盱眙对岸），往下今天穿过洪泽湖';
      }
    }
    if (nm === 'Yi') {
      line = line.filter((q) => q[1] >= 34.93);
      cut = '只留上游；下游往东入海的一段是现代开的新沭河';
    }
    if (nm === 'Quan' && a[0] > 112) zh = '颍水上游（沙河）';
    if (nm === 'Quan' && a[0] < 112) zh = '黔江';
    if (nm === 'Min' && a[0] > 110) zh = '闽江';
    if (!nm && a[0] > 120) zh = '吴淞江';
    if (!nm && a[0] > 117 && a[0] < 119) zh = '巢湖通江的水道';
    if (line.length < 2) continue;
    rivers.push({ name: nm || null, zh, rank: f.properties.scalerank, cut, line: line.map((q) => [r3(q[0]), r3(q[1])]) });
  }
}
console.log('rivers kept', rivers.length, 'vertices', nV(rivers.map((l) => l.line)));
const water = {
  what: '苏轼全程沙盘的岸线、湖、河：Natural Earth 1:10m（公有领域），裁到桌面范围。是今天的；后来才有的湖、水库和今天才这样流的河段去掉了，见 removed。',
  land,
  lakes,
  rivers,
  removed,
};
const s = JSON.stringify(water);
writeFileSync(path.join(outDir, 'water.json'), s);
console.log('water.json', s.length, 'bytes');

// ---------- 3. 人物数据（只抄页面要用的） ----------
const fig = JSON.parse(readFileSync(path.join(here, '../../../../content/figures/su-shi/figure.json'), 'utf8'));
const idx = JSON.parse(readFileSync(path.join(here, '../../../../content/figures/index.json'), 'utf8')).find((f) => f.id === 'su-shi');
const figOut = {
  what: '从 content/figures/su-shi/figure.json 和 content/figures/index.json 抄来的、这张样张要用的几样',
  id: fig.id,
  name: fig.name,
  era: fig.era,
  years: fig.years,
  tagline: idx.tagline,
  stops: fig.stops.map((s2) => ({ id: s2.id, title: s2.title, years: s2.years, ancient: s2.place.ancient, modern: s2.place.modern, lngLat: s2.place.lngLat, status: s2.status })),
  legs: fig.legs.map((l) => ({ from: l.from, to: l.to, via: l.via.map((v) => ({ name: v.name, lngLat: v.lngLat })) })),
};
writeFileSync(path.join(outDir, 'figure.json'), JSON.stringify(figOut, null, 1));

// 干活时查位置用：今天的苏北海岸
if (process.env.DEBUG_COAST) {
  const dbg = [];
  for (const ring of land) for (const p of ring) if (p[0] > 119 && p[0] < 122.2 && p[1] > 31.6 && p[1] < 35) dbg.push(p);
  console.log('N Jiangsu coast', JSON.stringify(dbg));
}

// 写出测试用的那一座编出来的全程沙盘（tests/content/fixtures/made-up/figures/traveller/）：一位人物的文件夹，
// 里面是 figure.json、scenes/route.json、scenes/route.terrain.bin、scenes/route.today.geojson 四个文件。
// 全是编的：东经 160 度、北纬 20 度的海上的一段海岸和一个小岛；城用天干起名（甲城、乙渡、丙港……），河和湖用地支（子河、午湖）。
// 它里面有苏轼的那一座没有的几样：一站分两段讲（甲城），一趟路里陆路和水路相接，船走在水上（roads.boats 写 on），
// 有记载的水路和只知道两头的水路，一条海路，一条没有写走哪条水的水路，看一站的小节画的是那几年走的路（roads.stopShows 写 stop-years），
// 地面照量到的样子（recipe 是 as-measured），一圈离路、离地名点都在六十公里以外的留白。
// 用它的测试：tests/stage/made-up-route.test.ts（经 tests/stage/support/madeUpRoute.ts）。
// 那四个文件不手改。要改，改这个脚本，在项目的根目录里重做一遍：
//   node tests/content/fixtures/made-up/make-fixture.mjs tests/content/fixtures/made-up/figures/traveller
// 同样的脚本写出同样的字节。这个脚本不随 npm test 跑，也不进读者的构建。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2];
if (!out) throw new Error('要写到哪个文件夹：node make-fixture.mjs <文件夹>');
mkdirSync(join(out, 'scenes'), { recursive: true });

// ---------------------------------------------------------------- 山川城镇在哪
const COAST = 161.9;
const ISLAND = { west: 162.45, east: 162.75, south: 19.45, north: 19.75 };
const LAKE = { west: 159.2, east: 159.9, south: 19.0, north: 19.5 };
const JIA = [158.0, 21.05];
const YI = [160.6, 20.4];
const BING = [161.85, 20.304];
const DING = [159.55, 19.53];
const WU = [159.55, 18.97];
const JI = [162.6, 19.6];
const XIN = [159.0, 18.6];
const RIVER = [[156.9, 21.4], JIA, [158.8, 20.75], [159.7, 20.85], YI, [161.3, 20.35], [COAST, 20.3], [162.05, 20.29]];

// ---------------------------------------------------------------- 地形文件：16 位整数（低位在前），单位是米，第 0 行最北，0 是海
const T = { west: 156.6, east: 163.4, south: 17.9, north: 22.06, cols: 86, rows: 53 };
const isLand = (lng, lat) => lng < COAST || (lng >= ISLAND.west && lng <= ISLAND.east && lat >= ISLAND.south && lat <= ISLAND.north);
const bump = (lng, lat, cx, cy, sx, sy) => Math.exp(-(((lng - cx) * (lng - cx)) / sx + ((lat - cy) * (lat - cy)) / sy));
function height(lng, lat) {
  if (!isLand(lng, lat)) return 0;
  const massif = 620 * bump(lng, lat, 158.5, 19.7, 0.45, 0.3);
  const ridge = 380 * bump(lng, lat, 160.1, 21.45, 0.5, 0.08);
  const downs = 140 * bump(lng, lat, 160.9, 19.2, 0.3, 0.25);
  // 平原上的起伏和一块台地：抹平原的办法会抹掉它们，照量到的样子的这一座留着
  const ripple = 22 * Math.sin(lng * 9.1) * Math.cos(lat * 7.3) + 14 * Math.sin((lng + lat) * 17);
  const terrace = lng > 159.9 && lng < 161.2 && lat > 20.5 && lat < 21.0 ? 35 : 0;
  return Math.max(1, Math.round(45 + massif + ridge + downs + ripple + terrace));
}
const bytes = Buffer.alloc(T.cols * T.rows * 2);
for (let j = 0; j < T.rows; j++) {
  const lat = T.north - ((T.north - T.south) * j) / (T.rows - 1);
  for (let i = 0; i < T.cols; i++) {
    const lng = T.west + ((T.east - T.west) * i) / (T.cols - 1);
    bytes.writeInt16LE(height(lng, lat), (j * T.cols + i) * 2);
  }
}
writeFileSync(join(out, 'scenes', 'route.terrain.bin'), bytes);

// ---------------------------------------------------------------- “今天的海岸、湖、河”
const box = (b) => [[[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north], [b.west, b.south]]];
const today = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { kind: 'land', name: 'made-up mainland' }, geometry: { type: 'Polygon', coordinates: box({ west: 156, east: COAST, south: 17, north: 23 }) } },
    { type: 'Feature', properties: { kind: 'land', name: 'made-up island' }, geometry: { type: 'Polygon', coordinates: box(ISLAND) } },
    { type: 'Feature', properties: { kind: 'river', name: 'Zi' }, geometry: { type: 'LineString', coordinates: RIVER } },
    { type: 'Feature', properties: { kind: 'lake', name: 'Wu' }, geometry: { type: 'Polygon', coordinates: box(LAKE) } },
  ],
};
writeFileSync(join(out, 'scenes', 'route.today.geojson'), JSON.stringify(today, null, 2) + '\n');

// ---------------------------------------------------------------- 场景文件
const today2 = { class: 'today', basis: '照编出来的今天的地图画。', sourceIds: ['m2'] };
const place = (id, name, at, stops) => ({ id, name, at, ...(stops ? { stops } : {}), class: 'today', basis: '照编出来的今天的地图上的位置。', sourceIds: ['m2'] });
const text = (name, ways, note) => ({ name, ways, class: 'text', basis: '编出来的《行记》里写了途中的地方。', sourceIds: ['m1'], ...(note ? { note } : {}) });
const ends = (name, ways, note) => ({ name, ways, class: 'schematic', basis: '编出来的《行记》里只有两头。', sourceIds: [], ...(note ? { note } : {}) });
const camera = (target, distanceM, extra = {}) => ({ target, distanceM, pitch: 46, bearing: 0, ...extra });
const scene = {
  level: 'route',
  stopId: 'route',
  style: 'made-up-lines',
  credits: ['地形：测试用的假数据，不是真的高程。', '海岸、河、湖：测试用的假数据，不是今天的地图。'],
  sources: [
    { id: 'm1', basis: 'own-words', cite: '编出来的《行记》' },
    { id: 'm2', basis: 'later', cite: '编出来的今天的地图' },
  ],
  frame: {
    center: [160, 20],
    projection: { kind: 'lambert-conic', lat1: 18, lat2: 22 },
    scale: 60,
    westM: 300000,
    eastM: 300000,
    northM: 200000,
    southM: 200000,
    datumM: 0,
    relief: { kind: 'low-hills-more', lowBelowM: 300, lowTimes: 25, power: 0.6, highTimes: 16 },
  },
  terrain: {
    class: 'real',
    basis: '山的位置和形状照编出来的高程网格。',
    sourceIds: ['m2'],
    note: '山的位置和形状是编出来的。',
    file: 'route.terrain.bin',
    cols: T.cols,
    rows: T.rows,
    west: T.west,
    east: T.east,
    south: T.south,
    north: T.north,
    heightUnit: 'm',
    recipe: {
      class: 'schematic',
      basis: '地面照网格量到的样子，平原不抹；西南角路没到，留白。',
      sourceIds: [],
      note: '地面照今天的样子，没有抹平。路没到的西南角留白。',
      kind: 'as-measured',
      edgeTaperM: 20000,
      blank: [[[157.3, 18.35], [158.3, 18.35], [157.3, 19.2]]],
    },
    edits: [],
  },
  water: {
    levels: { ...today2, basis: '海面画在海拔 0 米。', note: '海面是一个平面。海岸、湖和河是照线画上去的。', values: { normal: 0 } },
    todayFile: 'route.today.geojson',
    coast: { name: '海岸', ...today2, note: '海岸是照编出来的今天的地图画的。' },
    rivers: [{ id: 'zi', name: '子河', kind: 'river', weight: 'major', today: [{ names: ['Zi'] }], ...today2, note: '子河照编出来的今天的地图画。' }],
    lakes: [{ id: 'wu', name: '午湖', today: [{ names: ['Wu'] }], ...today2, note: '午湖照编出来的今天的地图画。' }],
    washes: [],
  },
  places: [
    place('p-jia', '甲城', JIA, ['jia']),
    place('p-yi', '乙渡', YI),
    place('p-bing', '丙港', BING, ['bing']),
    place('p-ding', '丁镇', DING, ['ding']),
    place('p-wu', '戊庄', WU),
    place('p-ji', '己岛', JI),
    place('p-xin', '辛集', XIN),
  ],
  strips: [
    { id: 's-jia', text: '甲城', of: 'p-jia' },
    { id: 's-bing', text: '丙港', of: 'p-bing', side: 'left' },
    { id: 's-ding', text: '丁镇', of: 'p-ding' },
    { id: 's-zi', text: '子河', of: 'zi', at: [159.7, 20.85] },
    { id: 's-wu', text: '午湖', of: 'wu', at: [159.55, 19.25] },
    { id: 's-sea', text: '海', of: 'coast', at: [162.3, 20.7] },
  ],
  far: [],
  roads: {
    stopShows: 'stop-years',
    boats: 'on',
    ways: [
      { id: 'w-west', by: 'land', line: [[157.25, 21.55], [157.62, 21.35], JIA] },
      { id: 'w-zi-up', by: 'water', along: 'zi', line: [JIA, [158.8, 20.75], [159.7, 20.85], YI] },
      { id: 'w-zi-down', by: 'water', along: 'zi', line: [YI, [161.3, 20.35], BING] },
      { id: 'w-sea', by: 'sea', line: [BING, [162.2, 20.0], JI] },
      { id: 'w-ridge', by: 'land', line: [YI, [159.5, 21.35], JIA] },
      { id: 'w-south', by: 'land', line: [YI, [160.2, 19.9], DING] },
      { id: 'w-lake', by: 'water', along: 'wu', line: [DING, [159.55, 19.25], WU] },
      { id: 'w-ferry', by: 'water', line: [WU, XIN] },
    ],
    // 照走的先后写：甲城的头一段，丙港，甲城的后一段，丁镇
    journeys: [
      { id: 'j-arrive', name: '头一回到甲城', stop: 'jia', date: '编的元年', parts: [text('元年从西边到甲城的路', ['w-west'], '从西边到甲城的路是照《行记》画的。')] },
      {
        id: 'j-down',
        name: '下子河到丙港',
        stop: 'bing',
        date: '编的二年',
        parts: [text('二年甲城到乙渡的水路', ['w-zi-up'], '甲城到乙渡坐船走子河，《行记》里写了。'), ends('二年乙渡到丙港的水路', ['w-zi-down'], '乙渡到丙港只知道两头，画成空长的虚线。')],
      },
      { id: 'j-island', name: '出海到己岛', stop: 'bing', date: '编的二年秋', parts: [ends('二年丙港到己岛的海路', ['w-sea'], '到己岛的海路只知道两头。')] },
      { id: 'j-return', name: '回甲城', stop: 'jia', date: '编的三年', parts: [ends('三年乙渡回甲城的路', ['w-ridge'], '回甲城的路只知道两头，画成虚线。')] },
      {
        id: 'j-lake',
        name: '到丁镇，过午湖',
        stop: 'ding',
        date: '编的五年',
        parts: [text('五年乙渡到丁镇、过午湖到戊庄的路', ['w-south', 'w-lake'], '到丁镇走陆路，过午湖坐船。'), text('五年戊庄到辛集的水路', ['w-ferry'], '戊庄到辛集坐船，走的是哪条水没有写。')],
      },
    ],
  },
  sections: [
    {
      heading: '全程',
      date: '编的元年到五年',
      line: '编出来的旅人走过的三站。实线是他写到过的路，虚线只知道两头。',
      camera: { target: [160, 20], distanceM: 40000, pitch: 40, bearing: 0, fov: 18, closest: 0.75, mustShow: ['frame'] },
      strips: ['s-jia', 's-bing', 's-ding', 's-zi', 's-wu', 's-sea'],
      explain: ['recipe', 'coast'],
    },
    { heading: '甲城那几年', date: '编的元年到三年', line: '住在甲城的两段日子里走的路。', camera: camera([159.3, 20.9], 17000), strips: ['s-jia', 's-zi'], explain: ['j-arrive'], stop: 'jia' },
    { heading: '丙港那几年', date: '编的二年', line: '下子河到丙港，又出海到己岛。', camera: camera([161.4, 20.2], 16000), strips: ['s-bing', 's-zi', 's-sea'], explain: ['j-down', 'levels'], stop: 'bing' },
    { heading: '丁镇那几年', date: '编的五年', line: '到丁镇，坐船过午湖。', camera: camera([159.8, 19.5], 16000), strips: ['s-ding', 's-wu'], explain: ['j-lake'], stop: 'ding' },
  ],
  notDrawn: [],
};
writeFileSync(join(out, 'scenes', 'route.json'), JSON.stringify(scene, null, 2) + '\n');

// ---------------------------------------------------------------- 人物资料
const stop = (id, name, at, years) => ({
  id,
  title: `${name}：编出来的一站`,
  shortTitle: name,
  years,
  age: '编的',
  place: { id, ancient: name, modern: name, lngLat: at },
  summary: '测试用的一站，不是史实。',
  status: 'outline',
});
const figure = {
  id: 'traveller',
  name: '编出来的旅人',
  era: '编出来的年代',
  years: '1000–1005',
  tagline: '测试用的虚构人物，不是史实。',
  intro: ['这是测试用的一座编出来的全程沙盘：一站分两段讲，船走在水上，地面照量到的样子。'],
  stops: [stop('jia', '甲城', JIA, '1000–1002'), stop('bing', '丙港', BING, '1001'), stop('ding', '丁镇', DING, '1004')],
};
writeFileSync(join(out, 'figure.json'), JSON.stringify(figure, null, 2) + '\n');
console.log(`写到 ${out}：figure.json，scenes/route.json，scenes/route.terrain.bin（${bytes.length} 字节），scenes/route.today.geojson`);

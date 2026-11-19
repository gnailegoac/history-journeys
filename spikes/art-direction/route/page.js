// 人物页的样张：左边一页纸是八站的目录，右边绢上摆着全程沙盘。
// 网址上的开关：
//   ?relief=a | b        山的高度怎么夸大（a：统一 10 倍；b：矮山夸得多、高山夸得少）。两种只差高度和受光，颜色一样
//   ?shot=whole          整张沙盘（默认）
//   ?shot=leg&to=xuzhou  进一站之前“先看路”：刚走的一段是红的，早先走过的是淡墨，还没走的不画
//   ?shot=relief         低一点、近一点，看山（四川盆地—三峡—江汉），没有左边那页纸
//   ?shot=top            正上方往下看，每条河、湖、岸线都标出来：核对用的，不是给读者看的

import { createRouteTable, SHOTS } from './scene/routetable.js';

const NS = 'http://www.w3.org/2000/svg';
const NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const q = new URLSearchParams(location.search);
const shot = SHOTS[q.get('shot')] ? q.get('shot') : 'whole';
const relief = q.get('relief') === 'b' ? 'b' : 'a';
const toId = q.get('to') || 'xuzhou';
if (shot === 'relief' || shot === 'top') document.body.classList.add('wide');
if (shot === 'top') document.body.classList.add('top');
document.body.classList.add('shot-' + shot);

await document.fonts.ready;
const root = document.getElementById('scene');
const table = await createRouteTable(document.getElementById('table'), { shot, relief });
window.table = table;
const fig = table.fig;
const stopIndex = Object.fromEntries(fig.stops.map((s, i) => [s.id, i]));
const toIdx = stopIndex[toId] ?? 3;

// ---------- 左边：八站的目录 ----------
document.getElementById('fig-name').textContent = fig.name;
document.getElementById('fig-era').textContent = `${fig.era} · ${fig.years}`;
document.getElementById('fig-tag').textContent = fig.tagline;
const list = document.getElementById('stops');
fig.stops.forEach((s, i) => {
  const li = document.createElement('li');
  const ready = s.status === 'complete';
  if (!ready) li.className = 'soon';
  if (shot === 'leg' && i === toIdx) li.classList.add('now');
  const no = document.createElement('span');
  no.className = 'sealno';
  no.textContent = NUM[i];
  const place = document.createElement('span');
  place.className = 'place';
  place.textContent = s.ancient;
  const what = document.createElement('span');
  what.className = 'what';
  const b = document.createElement('b');
  b.textContent = s.title;
  const yrs = document.createElement('small');
  yrs.textContent = s.years;
  what.append(b, yrs);
  li.append(no, place, what);
  if (!ready) {
    const ny = document.createElement('span');
    ny.className = 'notyet';
    ny.textContent = '还没写';
    li.append(ny);
  }
  list.append(li);
});

// ---------- 沙盘上的字 ----------
// 同一个地方的几站并成一个点：杭州是第 2、7 两站，一面题签、两方小印
const points = [];
fig.stops.forEach((s, i) => {
  const p = points.find((o) => o.lngLat[0] === s.lngLat[0] && o.lngLat[1] === s.lngLat[1]);
  if (p) p.nos.push(i);
  else points.push({ name: s.ancient, lngLat: s.lngLat, nos: [i] });
});
// 站点的题签：小红印（第几站）就是题签的印，印正落在地点上，题签从印上往上（up）或往下（down）立着，没有引线；
// 手机上桌面小，有两处改成字在印的左边（left）或右边（right）。
// narrow：手机上换个方向。role：dest 是这一段要到的站（印大一号），orig 是出发的站（淡一点）。
const flag = (name, dir, extra = {}) => {
  const p = points.find((o) => o.name === name);
  return { text: name, at: p.lngLat, kind: 'stop', nos: p.nos, dir, ...extra };
};
// 别的字：小一号的纸条，没有印。dx dy 是纸条中心离它指的那一点多少像素（按 880 宽的画面定，窄了按比例缩）
const via = (text, at, dx, dy, extra = {}) => ({ text, at, dx, dy, kind: 'via', ...extra });
const wat = (text, at, dx, dy, extra = {}) => ({ text, at, dx, dy, kind: 'via water', ...extra });
const land = (text, at, dx, dy) => ({ text, at, dx, dy, kind: 'land' });

const LABELS = {
  whole: [
    flag('眉州', 'up'),
    flag('杭州', 'down'),
    flag('密州', 'up', { narrow: 'right' }), // 手机上桌面小，往上立会顶出画框，改成印在左、字在右，落在海上
    flag('徐州', 'up'),
    flag('汴京', 'up', { narrow: 'left' }), // 手机上字在左、印在右，不顶到画框
    flag('黄州', 'down'),
    flag('昌化军', 'up'),
    via('惠州', [114.416, 23.112], 30, 30, { wideOnly: true }),
    wat('黄河', [112.6, 34.84], -4, -42, { wideOnly: true }),
    wat('大江', [108.2, 30.72], 12, 44, { wideOnly: true }),
    wat('淮水', [116.75, 32.62], 6, 40, { wideOnly: true }),
    wat('海', [121.9, 27.4], 0, 0, { free: true, wideOnly: true }),
  ],
  leg: [
    flag('密州', 'up', { role: 'orig' }),
    flag('徐州', 'up', { role: 'dest' }),
    via('济南', [117.02, 36.65], -8, -50),
    via('南都', [115.65, 34.44], -26, 50),
    wat('黄河', [115.5, 36.8], -40, -8),
    wat("梁山泊", [115.95, 35.82], 2, -64),
    wat('泗水', [116.72, 35.05], -40, 2),
    wat('汴河', [114.9, 34.52], -22, 52),
    wat('淮水', [117.6, 33.0], 34, 44, { wideOnly: true }),
    wat('大江', [117.9, 31.25], -30, 44, { wideOnly: true }),
  ],
  relief: [
    flag('眉州', 'up'),
    via('渝州', [106.551, 29.563], -8, 70),
    via('夔州', [109.464, 31.019], -40, 78),
    via('江陵', [112.24, 30.335], 20, 74),
    land('秦岭', [108.2, 33.95], 0, -74),
    land('三峡', [110.35, 30.95], 26, -86),
    land('四川盆地', [105.3, 30.6], 0, -92),
    wat('大江', [107.75, 30.1], 30, 64),
    wat('汉水', [110.4, 32.82], 56, -36),
  ],
  top: [],
};
const CAPTION = {
  whole: { sec: '全程', when: '1056–1100', line: '从眉州出发，最远过海到了昌化军；北归的路还没有画。' },
  relief: { sec: '近看', when: '', line: '四川盆地四面是山，大江从三峡里穿出去，到江陵就是平地了。' },
  top: { sec: '', when: '', line: '' },
};

const labelsEl = document.getElementById('labels');
const marksEl = document.getElementById('marks');
const tagsEl = document.getElementById('tags');
const svg = document.getElementById('leaders');
const needle = document.getElementById('needle');
const scale = document.getElementById('scalebar');
const capEl = root.querySelector('.caption');
const scrim = root.querySelector('.scrim');
const legendEl = root.querySelector('.legend');
const isNarrow = () => root.clientWidth < 700;
let items = [];
let tagItems = [];

const sealEl = (n) => {
  const s = document.createElement('span');
  s.className = 'sealno';
  s.textContent = NUM[n];
  return s;
};
function buildLabels() {
  const narrow = isNarrow();
  const flagged = new Set(LABELS[shot].filter((l) => l.kind === 'stop').map((l) => l.text));
  // 没有题签的站（“先看路”时早先到过的站）：只落一方淡一点的小印
  const marks = shot === 'leg' ? points.filter((p) => !flagged.has(p.name) && p.nos.some((n) => n <= toIdx)) : [];
  for (const p of marks) {
    const el = document.createElement('div');
    el.className = 'mark';
    for (const n of p.nos) if (n <= toIdx) el.append(sealEl(n));
    marksEl.append(el);
    items.push({ l: { at: p.lngLat, mark: true }, el });
  }
  for (const l of LABELS[shot].filter((x) => !(narrow && x.wideOnly))) {
    const el = document.createElement('div');
    if (l.kind === 'stop') {
      const dir = (narrow && l.narrow) || l.dir;
      el.className = `tiqian stop ${dir} ${l.role || ''}`;
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = l.text;
      const seals = document.createElement('span');
      seals.className = 'seals';
      for (const n of l.nos) if (shot !== 'leg' || n <= toIdx) seals.append(sealEl(n));
      if (dir === 'down' || dir === 'right') el.append(seals, nm);
      else el.append(nm, seals);
      labelsEl.append(el);
      items.push({ l, el, seals });
      continue;
    }
    el.className = 'tiqian ' + l.kind;
    el.textContent = l.text;
    labelsEl.append(el);
    let line = null;
    let dot = null;
    if (!l.free) {
      line = document.createElementNS(NS, 'line');
      dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('r', '2.4');
      svg.append(line, dot);
    }
    items.push({ l, el, line, dot });
  }
}

// 核对用：每条河、湖、岸线一个小标签。蓝的是今天的数据，红框的是手画的示意。
function buildTags() {
  const add = (text, at, cls = '') => {
    const el = document.createElement('div');
    el.className = 'tag ' + cls;
    el.textContent = text;
    tagsEl.append(el);
    const line = document.createElementNS(NS, 'line');
    svg.append(line);
    tagItems.push({ text, at, el, line });
  };
  const S = table.song;
  const groups = new Map();
  for (const r of table.rivers) {
    const key = r.zh || r.name || '（无名）';
    const g = groups.get(key);
    if (!g || r.line.length > g.line.length) groups.set(key, r);
  }
  for (const [key, r] of groups) add(key + (r.cut ? '＊' : ''), r.line[Math.floor(r.line.length * 0.5)]);
  for (const l of table.water.lakes) if (l.km2 >= 100) add((l.zh || '湖（无名）') + (l.note ? '＊' : ''), l.at);
  for (const r of S.rivers) add('示意：' + r.label, r.line[Math.floor(r.line.length * (r.id === 'bianhe' ? 0.7 : 0.55))], 'song');
  for (const l of S.lakes) add('示意：' + l.label + (l.wash ? '（只染一片，没有岸线）' : ''), l.at[0], 'song');
  add('示意：当时的海岸（范公堤一线）', [120.14, 33.38], 'song');
  add('示意：当时的淮口', [119.85, 34.03], 'song');
  for (const e of S.eraseLand || []) add('示意：' + e.name, e.at[0], 'song');
  for (const e of S.removedLand || []) add('示意：' + e.name, e.at[0], 'song');
  add('今天的海岸', [121.6, 29.1]);
  add('今天的海岸', [116.6, 23.2]);
  add('今天的海岸（山东半岛）', [121.0, 36.6]);
  for (const p of points) add(p.nos.map((n) => NUM[n]).join('、') + ' ' + p.name, p.lngLat, 'stopname');
  const note = document.createElement('div');
  note.className = 'checknote';
  note.innerHTML = '<b>核对用的正上方视图</b><br>蓝字：今天的数据（Natural Earth 1:10m），带＊的是裁过或缩过的。<br><i style="color:#8f2a1c">红框</i>：手画的示意，只凭常识，还没有对照史料核对。<br>墨线：七段路，同一条道只画一笔；沿河的画在河的一边。虚线：只是把两站连起来、中间省掉没画的路。<br>去掉没画的：洪泽湖、微山湖、骆马湖、东平湖、几处水库、今天的黄河下游和黄河三角洲、淮河入江水道、崇明三岛、沭水的半截。';
  root.querySelector('.over').append(note);
}

function update() {
  const W = root.clientWidth;
  const H = root.clientHeight;
  const k = Math.max(0.5, Math.min(1, W / 800));
  for (const it of items) {
    const p = table.project(it.l.at[0], it.l.at[1], it.l.mark || it.seals ? 14 : 8);
    const off = p.behind || p.x < 6 || p.y < 6 || p.x > W - 6 || p.y > H - 6;
    it.el.style.display = off ? 'none' : '';
    if (it.line) it.line.style.display = off ? 'none' : '';
    if (it.dot) it.dot.style.display = off ? 'none' : '';
    it.p = off ? null : p;
    if (off) continue;
    if (it.l.mark) {
      it.el.style.left = p.x.toFixed(1) + 'px';
      it.el.style.top = p.y.toFixed(1) + 'px';
      continue;
    }
    if (it.seals) {
      // 印的正中落在地点上
      const x = Math.round(p.x - (it.seals.offsetLeft + it.seals.offsetWidth / 2));
      const y = Math.round(p.y - (it.seals.offsetTop + it.seals.offsetHeight / 2));
      it.el.style.left = x + 'px';
      it.el.style.top = y + 'px';
      it.rect = [x, y, x + it.el.offsetWidth, y + it.el.offsetHeight];
      continue;
    }
    const w = it.el.offsetWidth / 2;
    const h = it.el.offsetHeight / 2;
    const cx = Math.round(Math.max(w + 4, Math.min(W - w - 4, p.x + it.l.dx * k)));
    const cy = Math.round(Math.max(h + 4, p.y + it.l.dy * k));
    it.el.style.left = cx + 'px';
    it.el.style.top = cy + 'px';
    it.rect = [cx - w, cy - h, cx + w, cy + h].map(Math.round);
    if (!it.line) continue;
    const qx = Math.max(cx - w, Math.min(cx + w, p.x));
    const qy = Math.max(cy - h, Math.min(cy + h, p.y));
    it.line.setAttribute('x1', p.x.toFixed(1));
    it.line.setAttribute('y1', p.y.toFixed(1));
    it.line.setAttribute('x2', qx.toFixed(1));
    it.line.setAttribute('y2', qy.toFixed(1));
    it.dot.setAttribute('cx', p.x.toFixed(1));
    it.dot.setAttribute('cy', p.y.toFixed(1));
  }
  // 核对视图的小标签：挨个摆，尽量不压着已经摆好的
  if (tagItems.length) {
    const placed = [];
    const hit = (r) => placed.some((o) => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1]);
    for (const it of tagItems) {
      const p = table.project(it.at[0], it.at[1], 4);
      const w = it.el.offsetWidth / 2 + 1;
      const h = it.el.offsetHeight / 2 + 1;
      let best = null;
      for (const [dx, dy] of [[0, -14], [0, 14], [w + 8, 0], [-w - 8, 0], [w + 6, -14], [-w - 6, -14], [w + 6, 14], [-w - 6, 14], [0, -30], [0, 30], [w + 22, -24], [-w - 22, -24], [w + 22, 24], [-w - 22, 24], [0, -46], [0, 46]]) {
        const r = [p.x + dx - w, p.y + dy - h, p.x + dx + w, p.y + dy + h];
        if (!hit(r)) {
          best = [dx, dy, r];
          break;
        }
      }
      if (!best) best = [0, -14, [p.x - w, p.y - 14 - h, p.x + w, p.y - 14 + h]];
      placed.push(best[2]);
      it.el.style.left = (p.x + best[0]).toFixed(0) + 'px';
      it.el.style.top = (p.y + best[1]).toFixed(0) + 'px';
      it.line.setAttribute('x1', p.x.toFixed(1));
      it.line.setAttribute('y1', p.y.toFixed(1));
      it.line.setAttribute('x2', (p.x + best[0]).toFixed(1));
      it.line.setAttribute('y2', (p.y + best[1]).toFixed(1));
    }
  }
  if (needle) needle.setAttribute('transform', `rotate(${(-table.heading()).toFixed(1)})`);
  if (scale) {
    // 镜头是斜着看的，南北方向在画面上短一些，所以明说这把尺量的是东西方向
    const max = Math.min(130, W * 0.3);
    let pick = [20, '20 公里'];
    for (const c of [[50, '50 公里'], [100, '100 公里'], [200, '200 公里'], [500, '500 公里'], [1000, '1000 公里']]) {
      if (table.pxPer(c[0]) <= max) pick = c;
    }
    scale.querySelector('span').textContent = (shot === 'top' ? '' : '东西 ') + pick[1];
    scale.querySelector('.bar').style.width = table.pxPer(pick[0]).toFixed(0) + 'px';
  }
}

// ---------- 题记、图例和如实的小注 ----------
// 小注是按画面里看得见什么写的：每样示意的东西有一两个点，点落在画面里才提它。
const rel = table.relief;
const S = table.song;
function seen(at) {
  const W = root.clientWidth;
  const H = root.clientHeight - (shot === 'top' ? 0 : capEl.offsetHeight + 30);
  return (at || []).some(([lng, lat]) => {
    const p = table.project(lng, lat, 0);
    return !p.behind && p.x > 8 && p.x < W - 8 && p.y > 8 && p.y < H;
  });
}
// 一共三句，按画面里有什么来写：（一）地形、山高、河宽；（二）哪些河、湖、海岸是示意，没核对；（三）哪些后来才有的湖没画，别的照今天。
// 桌面上不超过两行，手机上不超过三行。手机上桌面小，高邮湖和岷江手连的一段只有几个像素，就不单说了。
// 这里没写的细处（黄河只画了北流一股、梁山泊的形状是随手画的）都记在 data/song-overlay.json 里。
function honestText() {
  const all = shot === 'top';
  const narrow = isNarrow();
  const roomy = shot === 'relief' || shot === 'top'; // 这两种画面题记宽，山高怎么夸大说全
  const river = Object.fromEntries(S.rivers.map((r) => [r.id, r]));
  const has = (o) => all || seen(o && o.at);
  const names = [];
  if (has(river['huanghe-north'])) names.push('黄河');
  if (has(river.bianhe)) names.push('汴河');
  if (has(river.sishui)) names.push('泗水');
  if (has(river['huai-lower'])) names.push('淮水下游');
  if (has(S.lakes.find((l) => l.id === 'liangshanpo'))) names.push('梁山泊');
  const shores = [];
  if (has(S.shore)) shores.push('苏北');
  if (has((S.eraseLand || [])[0])) shores.push('黄河口');
  if (has((S.removedLand || [])[0])) shores.push('长江口');
  const minjiang = !narrow && has(river['minjiang-meizhou']);
  const out = [`地形是今天的，${roomy ? rel.text : rel.short}，河画宽了。`];
  if (names.length || shores.length) {
    const what = names.join('、') + (shores.length ? (names.length ? '和' : '') + shores.join('、') + '的海岸' : '');
    out.push(`${what}${narrow ? '是示意' : '是照当时大致位置示意的'}，${minjiang ? '岷江一段是手连的，都' : ''}没核对。`);
  } else if (minjiang) out.push('岷江一段是手连的，没核对。');
  const tail = [];
  const gone = [['洪泽湖', [118.47, 33.25]], ['微山湖', [117.22, 34.61]], ['骆马湖', [118.2, 34.08]]].filter((g) => all || seen([g[1]])).map((g) => g[0]);
  if (gone.length) tail.push(`后来才有的${gone.length === 3 ? '洪泽、微山、骆马三湖' : gone.join('、')}没画`);
  if (!narrow && (all || seen([[119.3, 32.9]]))) tail.push('高邮湖画小了');
  const rest = names.length || shores.length || tail.length || minjiang ? '别的照今天画' : '河、湖、海岸照今天画';
  out.push((tail.length ? tail.join('，') + '；' : '') + rest + '。');
  return out.join('');
}
function buildKey() {
  const key = document.getElementById('cap-key');
  if (shot === 'top') return;
  const narrow = isNarrow();
  // ph：手机上也留着的两样（虚线是什么、留白是什么）；别的几样手机上不摆
  const item = (html, ph = false) => {
    const s = document.createElement('span');
    if (ph) s.className = 'k-ph';
    s.innerHTML = html;
    key.append(s);
  };
  item(`<i class="k-line${shot === 'leg' ? ' red' : ''}"></i>${shot === 'leg' ? '刚走的这一段' : '走过的路'}`);
  if (shot === 'leg') item('<i class="k-line pale"></i>早先走过的');
  if (table.dashed) item(`<i class="k-dash${shot === 'leg' ? ' red' : ''}"></i>${narrow ? '' : '中间'}省掉没画的路`, true);
  item('<i class="k-sw" style="background:#3a6c9c"></i><i class="k-sw" style="background:#629b80"></i>山　<i class="k-sw" style="background:#c0975f"></i>山脚　<i class="k-sw" style="background:#e4d6ae"></i>平地（画法，不是地面的颜色）');
  if (seen([[121.0, 23.7], [105.0, 21.3], [101.9, 30.0]])) item('路没到的地方留白', true);
}

const capSec = document.getElementById('cap-sec');
const capLine = document.getElementById('cap-line');
let cap = CAPTION[shot];
if (shot === 'leg') {
  const leg = table.legs[toIdx - 1];
  const from = fig.stops[toIdx - 1];
  const to = fig.stops[toIdx];
  const km = Math.round(leg.km / 10) * 10;
  // “先看路”说的是路：从哪里到哪里、路过哪里，只照内容里这一段的途经地写（这一站自己的故事留给站点页）。
  // 楷书的题记里不放阿拉伯数字：第几站写成汉字，年份和公里数在旁边那行宋体小字里。
  const via = fig.legs[toIdx - 1].via.map((v) => v.name.replace(/（.*?）/g, ''));
  const passed = via.length > 4 ? via.slice(0, 3).join('、') + '等地' : via.join('、');
  const road = `从${from.ancient}到${to.ancient}${via.length ? '，路过' + passed : ''}。`;
  cap = { sec: `第${NUM[toIdx]}站 · ${to.ancient}`, when: `${to.years.split('–')[0]} 年 · 图上这条红线约 ${km} 公里，实际走的路更长`, line: road };
  table.setLegs(table.legs.map((_, i) => (i === toIdx - 1 ? 'now' : i < toIdx - 1 ? 'faded' : 'off')));
} else if (shot === 'relief') {
  table.setLegs(table.legs.map((_, i) => (i === 0 ? 'ink' : 'off')));
}
capSec.textContent = cap.sec;
if (!cap.sec) capSec.style.display = 'none';
if (cap.when) {
  const w = document.createElement('span');
  w.className = 'when';
  w.textContent = cap.when;
  capSec.append(w);
}
capLine.textContent = cap.line;

/** 题记占多高，下边那条绢色就留多高（字不压在地形上），比例尺和指北摆在题记那一行的右边 */
function layoutFoot() {
  const honest = document.getElementById('cap-honest');
  honest.textContent = honestText();
  if (shot === 'top') return;
  const narrow = isNarrow();
  const capH = capEl.offsetHeight;
  const bottom = parseFloat(getComputedStyle(capEl).bottom) || 0;
  const fade = narrow ? 26 : shot === 'whole' ? 28 : 56;
  const solid = bottom + capH + (narrow ? 4 : 14);
  scrim.style.height = solid + fade + 'px';
  const mask = `linear-gradient(to top, #000 0, #000 ${solid}px, transparent 100%)`;
  scrim.style.webkitMaskImage = mask;
  scrim.style.maskImage = mask;
  // 手机上图例那一行只有两样，短，同比例尺、指北摆在一行；桌面上比例尺在图例那一行的上面
  const under = honest.offsetHeight + (narrow ? 0 : document.getElementById('cap-key').offsetHeight);
  legendEl.style.bottom = bottom + under + (narrow ? 5 : 12) + 'px';
}

buildLabels();
if (shot === 'top') buildTags();
table.onAfterRender(update);
table.render();
layoutFoot();
buildKey();
layoutFoot();
table.render();
window.__debug = () => ({
  info: table.info,
  problems: table.problems,
  legs: table.legs.map((l) => ({ from: l.from, to: l.to, km: Math.round(l.km), spans: l.spans.length })),
  labels: items.filter((it) => !it.l.mark).map((it) => ({ text: it.l.text, at: it.p ? [Math.round(it.p.x), Math.round(it.p.y)] : null, rect: it.rect })),
  note: document.getElementById('cap-honest').textContent,
  noteLines: Math.round(document.getElementById('cap-honest').offsetHeight / parseFloat(getComputedStyle(document.getElementById('cap-honest')).lineHeight)),
  keyLines: Math.round(document.getElementById('cap-key').offsetHeight / (parseFloat(getComputedStyle(document.getElementById('cap-key')).lineHeight) || 1)),
  key: document.getElementById('cap-key').innerText.replace(/\s+/g, ' ').trim(),
  caption: [document.getElementById('cap-sec').textContent, document.getElementById('cap-line').textContent],
});
window.addEventListener('resize', () => {
  table.resize();
  layoutFoot();
});
requestAnimationFrame(() => {
  table.render();
  requestAnimationFrame(() => {
    window.__ready = true;
  });
});

// 七段路在桌面上怎么走。数据里每段只有起点、终点和几个途经地。
// 这里做四件事（都只是“怎么画”，不是内容）：
//  1. 走水路的几段照着河走，画在河的一边（离河心几公里），河才露得出来；
//  2. 两点直连会从湖上穿过去的地方，加几个只管画线的地方（照今天的城的位置定的，未核对）；
//  3. 几段路走的是同一条道（汴河—淮水—运河一线）时，用的是同一条线，整张图上只画一笔；
//  4. 只是把两站连起来、中间其实省掉了没画的几段，标成虚线。
// 纯计算，不碰浏览器。坐标都是桌面公里（x 东、y 北）。

import { toKm } from './proj.js';
import { smoothstep } from './util.js';

const km = (p) => toKm(p[0], p[1]);
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const id2 = (name) => name.slice(0, 2);

/** 只管画线的地方：不是内容里的途经地。照今天的城定的位置，未核对。 */
const WAY = {
  泗州: [118.48, 33.03],
  宝应: [119.31, 33.24],
  高邮: [119.45, 32.78],
  无锡: [120.3, 31.57],
  望亭: [120.47, 31.48], // 运河在太湖东北角外面几公里，线不贴着湖岸
  平望: [120.64, 30.98],
  南浔: [120.43, 30.87],
  秀州: [120.755, 30.745],
  怀仁: [119.05, 34.9], // 海州湾西边的两个拐点，为的是线不从海湾上切过去
  莒南: [119.25, 35.45],
};

/** 内容里相邻的两个地方之间，画线时中间多经过哪些地方（正着反着都算） */
const INSERT = [
  ['汴京', '宿州', ['南都']], // 汴河过南都
  ['宿州', '扬州', ['泗州', '楚州', '宝应', '高邮']], // 汴河到泗州入淮，顺淮水到楚州，再走运河
  ['南都', '扬州', ['宿州', '泗州', '楚州', '宝应', '高邮']],
  ['润州', '楚州', ['扬州', '高邮', '宝应']], // 运河在高邮湖东边
  ['润州', '苏州', ['常州', '无锡', '望亭']],
  ['苏州', '杭州', ['平望', '秀州']],
  ['扬州', '湖州', ['润州', '常州', '无锡', '望亭', '苏州', '平望', '南浔']], // 绕着太湖东边、南边走
  ['常州', '杭州', ['无锡', '望亭', '苏州', '平望', '秀州']],
  ['惠州', '梧州', ['广州']], // 顺东江回广州，再溯西江
  ['海州', '密州', ['怀仁', '莒南']],
];

/** 沿着河走的几趟：经过哪些地方，线画在河的哪一边（side：顺着走的方向，1 是左手边），离河心多少公里 */
const RUNS = [
  { river: 'song:minjiang-meizhou', nodes: ['眉州', '嘉州'], off: 5, side: -1 },
  { river: 'ne:MinSichuan', nodes: ['嘉州', '戎州'], off: 6, side: 1 },
  { river: 'ne:Yangtze', nodes: ['戎州', '渝州', '夔州', '巫山', '夷陵', '江陵'], off: 9, side: 1 },
  { river: 'song:bianhe', nodes: ['汴京', '南都', '宿州', '泗州'], off: 6, side: 1 },
  { river: 'song:huai-lower', nodes: ['泗州', '楚州'], off: 6, side: -1 },
  { river: 'ne:Yangtze', nodes: ['黄州', '江州', '金陵'], off: 9, side: 1 },
  { river: 'ne:Bei', nodes: ['韶州', '广州'], off: 6, side: 1 },
  { river: 'ne:Dong', nodes: ['广州', '惠州'], off: 6, side: 1 },
  { river: 'ne:Xi', nodes: ['广州', '梧州'], off: 6, side: -1 },
];

/** 只是把两站连起来的几段（第几段路，内容里的哪两个地方之间）：画成虚线 */
const CONNECTOR = [
  [2, '济南', '南都'], // 1077 年他先到了汴京城外，这里省掉了
  [5, '常州', '杭州'], // 1084 到 1089 中间隔了五年（去过登州、汴京）
  [6, '杭州', '虔州'], // 1094 年其实是从北边的定州南下的
];
/** 明说是过水的几段（过江、过海），不算“从水上穿过去” */
const CROSSING = [['徐闻', '琼州'], ['扬州', '润州']];

/** 把同一条河的几段接成一条 */
function stitch(lines) {
  const rest = lines.filter((l) => l.length >= 3).map((l) => l.map(km));
  if (!rest.length) return [];
  rest.sort((a, b) => a[0][0] - b[0][0]);
  let cur = rest.shift();
  for (;;) {
    const end = cur[cur.length - 1];
    let best = -1;
    let rev = false;
    let bd = 12;
    rest.forEach((l, i) => {
      const da = d2(end, l[0]);
      const db = d2(end, l[l.length - 1]);
      if (da < bd) {
        bd = da;
        best = i;
        rev = false;
      }
      if (db < bd) {
        bd = db;
        best = i;
        rev = true;
      }
    });
    if (best < 0) break;
    const l = rest.splice(best, 1)[0];
    cur = cur.concat(rev ? l.slice().reverse() : l);
  }
  return cur;
}
function nearest(line, p) {
  let bi = 0;
  let bd = Infinity;
  for (let i = 0; i < line.length; i++) {
    const d = d2(line[i], p);
    if (d < bd) {
      bd = d;
      bi = i;
    }
  }
  return bi;
}
/** 折线化简（Douglas–Peucker），tol 是公里 */
function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const ax = pts[a][0];
    const ay = pts[a][1];
    const dx = pts[b][0] - ax;
    const dy = pts[b][1] - ay;
    const l2 = dx * dx + dy * dy || 1e-9;
    let worst = -1;
    let wd = tol;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((pts[i][0] - ax) * dx + (pts[i][1] - ay) * dy) / l2));
      const d = Math.hypot(pts[i][0] - ax - dx * t, pts[i][1] - ay - dy * t);
      if (d > wd) {
        wd = d;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}
/** 削角抹圆（Chaikin），两头不动 */
function chaikin(pts, times = 1) {
  let p = pts;
  for (let k = 0; k < times; k++) {
    if (p.length < 3) return p;
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i];
      const b = p[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}
/** 折线按点距加密（直线插值） */
function dense(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.max(1, Math.ceil(d2(a, b) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}
/** 拐角抹圆：每个拐角换成一小段弧，半径不超过 r 公里 */
function roundCorners(pts, r) {
  if (pts.length < 3) return pts.slice();
  const out = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i - 1];
    const v = pts[i];
    const n = pts[i + 1];
    const l1 = d2(p, v);
    const l2 = d2(v, n);
    const cos = ((v[0] - p[0]) * (n[0] - v[0]) + (v[1] - p[1]) * (n[1] - v[1])) / (l1 * l2 || 1);
    const d = Math.min(r, l1 * 0.45, l2 * 0.45);
    if (cos > 0.99 || d < 1) {
      out.push(v);
      continue;
    }
    const a = [v[0] + ((p[0] - v[0]) / l1) * d, v[1] + ((p[1] - v[1]) / l1) * d];
    const b = [v[0] + ((n[0] - v[0]) / l2) * d, v[1] + ((n[1] - v[1]) / l2) * d];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const u = 1 - t;
      out.push([u * u * a[0] + 2 * u * t * v[0] + t * t * b[0], u * u * a[1] + 2 * u * t * v[1] + t * t * b[1]]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/**
 * 沿河的一条“岸线”：从 a 到 b，先把河心线化简、抹顺（整张桌面上看不出锯齿），再往一边挪 off 公里；
 * 两头慢慢收回到 a、b 上。挪过去落在湖里的点不挪。
 */
function bankLine(line, a, b, off, side, waterAt) {
  const ia = nearest(line, a);
  const ib = nearest(line, b);
  let sub = ia <= ib ? line.slice(ia, ib + 1) : line.slice(ib, ia + 1).reverse();
  if (sub.length < 2) return [a, b];
  sub = chaikin(simplify(sub, 9), 2);
  const L = [0];
  for (let i = 1; i < sub.length; i++) L.push(L[i - 1] + d2(sub[i - 1], sub[i]));
  const tot = L[L.length - 1];
  const taper = Math.min(34, tot * 0.3);
  const nrm = sub.map((p, i) => {
    const q = sub[Math.min(sub.length - 1, i + 1)];
    const o = sub[Math.max(0, i - 1)];
    const tl = d2(o, q) || 1;
    return [(-(q[1] - o[1]) / tl) * side, ((q[0] - o[0]) / tl) * side];
  });
  let w = sub.map((_, i) => smoothstep(0, taper, L[i]) * smoothstep(0, taper, tot - L[i]) * off);
  const place = () => sub.map((p, i) => [p[0] + nrm[i][0] * w[i], p[1] + nrm[i][1] * w[i]]);
  let out = place();
  // 挪到岸上以后碰到湖的地方（江边的小湖）：那一截收回河心，前后慢慢过渡
  const inLake = (p) => waterAt && waterAt(p[0], p[1]) === 'lake';
  for (let pass = 0; pass < 4; pass++) {
    const block = new Uint8Array(sub.length);
    let any = false;
    for (let i = 0; i < out.length; i++) {
      const n = out[Math.min(out.length - 1, i + 1)];
      const hit = inLake(out[i]) || [0.25, 0.5, 0.75].some((t) => inLake([out[i][0] + (n[0] - out[i][0]) * t, out[i][1] + (n[1] - out[i][1]) * t]));
      if (hit && w[i] > 0) {
        any = true;
        for (let k = Math.max(0, i - 1); k <= Math.min(sub.length - 1, i + 2); k++) block[k] = 1;
      }
    }
    if (!any) break;
    w = w.map((v, i) => (block[i] ? 0 : v));
    for (let r = 0; r < 3; r++) w = w.map((v, i) => Math.min(v, (w[Math.max(0, i - 1)] + w[Math.min(w.length - 1, i + 1)]) / 2 + off * 0.3));
    out = place();
  }
  out[0] = a;
  out[out.length - 1] = b;
  return simplify(out, 1.2);
}

/**
 * 返回 { legs, problems }。
 * legs[i] = { from, to, spans, path, km }；span = { a, b, key, pts, dash, river, crossing }，pts 是从 a 到 b 的折线。
 * problems：有哪一段从湖上或海上穿过去了（除了明说过水的），页面和拍图脚本都会报出来。
 */
export function buildLegs(fig, rivers, songLines, waterAt) {
  const pick = (name, test = () => true) => rivers.filter((r) => r.name === name && test(r)).map((r) => r.line);
  const riverLine = {
    'ne:Yangtze': stitch([...pick('Chang Jiang'), ...pick('Yangtze')]),
    'ne:MinSichuan': stitch(pick('Min', (r) => r.line[0][0] < 110)),
    'ne:Bei': stitch(pick('Bei')),
    'ne:Dong': stitch(pick('Dong', (r) => r.line.length > 50)),
    'ne:Xi': stitch(pick('Xi', (r) => r.line.length > 50)),
  };
  for (const [id, line] of Object.entries(songLines)) riverLine['song:' + id] = line;

  // 每个地方在哪里
  const pos = {};
  for (const [name, ll] of Object.entries(WAY)) pos[name] = km(ll);
  const stop = Object.fromEntries(fig.stops.map((s) => [s.id, s]));
  for (const s of fig.stops) pos[id2(s.ancient)] = km(s.lngLat);
  for (const leg of fig.legs) for (const v of leg.via) pos[id2(v.name)] = km(v.lngLat);

  // 沿河的几趟：每趟一条岸线，相邻两个地方之间取其中一截
  const geom = new Map(); // 'A-B'（按名字排过序） -> { from, pts, river }
  const keyOf = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  for (const run of RUNS) {
    const first = run.nodes[0];
    const last = run.nodes[run.nodes.length - 1];
    const bank = bankLine(riverLine[run.river], pos[first], pos[last], run.off, run.side, waterAt);
    const at = run.nodes.map((n, i) => (i === 0 ? 0 : i === run.nodes.length - 1 ? bank.length - 1 : nearest(bank, pos[n])));
    for (let i = 0; i < run.nodes.length - 1; i++) {
      geom.set(keyOf(run.nodes[i], run.nodes[i + 1]), { from: run.nodes[i], pts: bank.slice(at[i], at[i + 1] + 1), river: true });
    }
  }
  const spanGeom = (a, b) => {
    const key = keyOf(a, b);
    if (!geom.has(key)) geom.set(key, { from: a, pts: [pos[a], pos[b]], river: false });
    const g = geom.get(key);
    return { key, pts: g.from === a ? g.pts : g.pts.slice().reverse(), river: g.river };
  };

  const problems = [];
  const legs = fig.legs.map((leg, li) => {
    const places = [id2(stop[leg.from].ancient), ...leg.via.map((v) => id2(v.name)), id2(stop[leg.to].ancient)];
    const spans = [];
    for (let i = 0; i < places.length - 1; i++) {
      const A = places[i];
      const B = places[i + 1];
      const ins = INSERT.find((r) => (r[0] === A && r[1] === B) || (r[0] === B && r[1] === A));
      const mids = !ins ? [] : ins[0] === A ? ins[2] : ins[2].slice().reverse();
      const dash = CONNECTOR.some((c) => c[0] === li && ((c[1] === A && c[2] === B) || (c[1] === B && c[2] === A)));
      const seq = [A, ...mids, B];
      for (let j = 0; j < seq.length - 1; j++) {
        const a = seq[j];
        const b = seq[j + 1];
        const crossing = CROSSING.some((c) => (c[0] === a && c[1] === b) || (c[0] === b && c[1] === a));
        spans.push({ a, b, dash, crossing, ...spanGeom(a, b) });
      }
    }
    let path = [];
    for (const s of spans) {
      const pts = dense(s.pts, 3);
      path = path.concat(path.length ? pts.slice(1) : pts);
      if (s.crossing) continue;
      const wet = pts.filter((p) => waterAt && waterAt(p[0], p[1]));
      const lake = wet.filter((p) => waterAt(p[0], p[1]) === 'lake').length;
      // 靠海的城、河口上的城，线头落在水边算不得穿水：只报湖，和连着三个点以上落在海里的
      if (lake > 0 || wet.length - lake > 3) problems.push({ leg: li + 1, span: `${s.a}→${s.b}`, lake, sea: wet.length - lake });
    }
    let len = 0;
    for (let i = 1; i < path.length; i++) len += d2(path[i - 1], path[i]);
    return { from: leg.from, to: leg.to, spans, path, km: len };
  });
  return { legs, problems };
}

/**
 * 按每段路的画法（'now' 印泥红、'ink' 墨线、'faded' 淡墨、'off' 不画）排出要画的笔画。
 * 同一条道只画一笔：红的压过墨的，墨的压过淡墨的；同一种里实线压过虚线。
 * 返回 [{ state, dash, pts }]，pts 已经抹过拐角、加密过。
 */
export function strokes(legs, states, corner = 16) {
  const out = [];
  const taken = new Set();
  for (const state of ['now', 'ink', 'faded']) {
    const mine = legs.filter((_, i) => states[i] === state);
    const solid = new Set();
    for (const leg of mine) for (const s of leg.spans) if (!s.dash) solid.add(s.key);
    const seen = new Set();
    for (const leg of mine) {
      let cur = null;
      for (const s of leg.spans) {
        if (taken.has(s.key) || seen.has(s.key) || (s.dash && solid.has(s.key))) {
          cur = null;
          continue;
        }
        seen.add(s.key);
        if (cur && cur.dash === s.dash) cur.pts = cur.pts.concat(d2(cur.pts[cur.pts.length - 1], s.pts[0]) < 0.5 ? s.pts.slice(1) : s.pts);
        else {
          cur = { state, dash: s.dash, pts: s.pts.slice() };
          out.push(cur);
        }
      }
    }
    for (const k of seen) taken.add(k);
  }
  for (const st of out) st.pts = dense(roundCorners(st.pts, corner), 6);
  return out;
}

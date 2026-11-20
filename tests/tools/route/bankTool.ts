// 走水路的路贴着河岸走的线（npm run route:bank）。做场景的人用的小工具：它只把线印出来，人看过以后贴进 scenes/route.json。
// 没有哪个测试查“场景里的线是不是这个工具现在做得出来的那一条”；查的是结果（tests/stage/route-roads.test.ts：
// 沿着河走的路离它的河不超过 15 公里，又不贴到 2 公里以内）。
//
// 为什么要它：水路要是照河的中线画，路就把河盖住了。所以画在河的一边，离河心几公里，河才露得出来。
// 做法是从定稿的样张里来的（spikes/art-direction/route/scene/route.js 的 bankLine），一步一步：
//   1 取河的线。用的是画在地面上的那一条（tests/tools/route/paint.ts 的 riverPaths）：自己写的河是加密、抹顺以后的线，
//     照今天画的河是文件里的几段，这里把头尾挨着（不到 12 公里）的接成一条。
//   2 在河上找离路的两头最近的两点，取中间那一截。
//   3 抽稀到 9 公里（离连线不到 9 公里的弯都抹掉），再削两遍角：整张沙盘上看不出锯齿。这是“引线”，路顺着它走。
//     然后加密到 3 公里一个点（样张没有这一步：它的路都长；这里有四五十公里的短路，不加密中间就没有点可挪）。
//   4 往一边挪（BANKS 里每条路写着离河心多少公里、挪到哪一边）。样张是从引线挪一个定数；真的河在引线两边摆来摆去，
//     那样挪出来的线有的地方压在河上，有的地方离河十几公里。这里每一点各自量：挪到离画出来的河正好那么多公里为止；
//     挪得多的点前后慢慢带过去（每走一公里最多变 BANK_SLOPE 公里），所以线只会比写的数离河远，不会近。
//   5 两头各 34 公里（路短的是全长的三成）里慢慢收回到城里：路的两头是城，城在河边上。
//     样张是收回到河心；这里收回到城自己的位置（城就在河心上的，两样是一回事；城在岸上几公里的，线不用先回河心再折出来）。
//     城不在这条河边上的那一头（离河心超过 TOWN_BY_RIVER_KM）不收：线从岸上直着连到城里；
//     直着连要过海、过湖的话，就从河上再往前、头一个直着连得过去的地方连（东江口外面是海湾）。
//   6 挪过去落进湖里、只染水色的水里、海里的点往河这边收（最多收到离河 BANK_NEAREST_KM 公里），前后慢慢过渡。
//   7 头尾是路自己的两头（城的位置一点不动），再抽稀到 1.2 公里，取三位小数。
// 坐标：算的时候用“公里”，x 向东、y 向北，是沙盘自己的投影里的公里（和样张一样）；进出都是经纬度。
// 只算数，不碰磁盘。

import type { RoadWay, RouteScene } from '../../../src/domain/scene';
import type { FrameCoords } from '../../../src/domain/sceneGeo';
import type { LngLat } from '../../../src/domain/types';
import { pickedLakes } from '../../content/routeRules';
import type { TodayFeature } from '../../content/routeRules';
import type { RiverPath } from './paint';

/** 沙盘的投影里的一点：公里，x 向东，y 向北。 */
export type Km = [number, number];

/** 河的中线先抽稀到多少公里（引线）。 */
export const BANK_THIN_KM = 9;
/** 两头在多少公里里收回到城里；路短的是全长的这么多成。查路的测试也用这两个数：这一截里不查“不贴到 2 公里以内”。 */
export const BANK_TAPER_KM = 34;
export const BANK_TAPER_SHARE = 0.3;
/** 城离河心不超过这么多公里，算“在这条河边上”，线慢慢收回到城里；超过的，线从岸上直着连到城里。 */
export const TOWN_BY_RIVER_KM = 12;
/** 引线加密到多少公里一个点。 */
export const BANK_STEP_KM = 3;
/** 离河的远近沿线每走一公里最多变多少公里。 */
export const BANK_SLOPE = 0.35;
/** 为了躲开湖和海往河这边收，最多收到离河多少公里。 */
export const BANK_NEAREST_KM = 2.5;
/** 照今天画的河是几段线：头尾相距不到这么多公里的接成一条。 */
export const STITCH_KM = 12;
/** 最后抽稀到多少公里。 */
export const BANK_OUT_KM = 1.2;

/** 一条路的岸线怎么做。side：顺着这条路走的方向，1 是左手边，-1 是右手边。 */
export interface BankSpec {
  /** 离画出来的河的中线多少公里。 */
  offKm: number;
  side: 1 | -1;
  /** 引线抽稀到多少公里；不写是 BANK_THIN_KM。河弯得大、线离河会超过 15 公里的写小一点。 */
  thinKm?: number;
  /** 城不在这条河边上的那一头，在河上的哪一点上岸（经纬度）；不写就取河上离城最近的一点。 */
  meet?: LngLat;
  /** false：这一条不贴进场景（定了照直线画），工具照样印出来给人看。 */
  paste?: boolean;
  /** 一句话：为什么是这一边。 */
  why: string;
}

/**
 * 苏轼的全程沙盘上每条沿着河走的路：离河多远、在哪一边。边是这样定的：一条路从头到尾在河的同一边；
 * 同一条河上接着走的几条路在同一边；城在河的哪一边，路尽量就在哪一边。样张里有的照样张。
 */
export const BANKS: Record<string, BankSpec> = {
  'w-min': { offKm: 5, side: -1, why: '往南走的右手边，就是西岸：眉州城在岷江西边（样张也是这一边）' },
  'w-min-low': { offKm: 6, side: 1, why: '往东南走的左手边，就是东北岸：接着大江的北岸（样张也是这一边）' },
  'w-jiang-upper': { offKm: 8, side: 1, thinKm: 6, why: '往东走的左手边，就是北岸（样张也是这一边）。三峡里河弯得大，引线抽得细一些' },
  'w-ying': { offKm: 6, side: 1, why: '往东南走的左手边，就是东北岸：陈州在颍水的东北面，接着淮水的北岸' },
  'w-huai-mid': { offKm: 6, side: 1, why: '往东走的左手边，就是北岸：下蔡、涡口、泗州都在北岸' },
  'w-huai-low': { offKm: 6, side: -1, why: '往东北走的右手边，就是东南岸：淮阴、楚州在这一边（样张也是这一边）' },
  'w-canal-n1': { offKm: 5, side: -1, why: '往南走的右手边，就是西岸：东边是射阳湖那一片水' },
  'w-canal-n2': { offKm: 5, side: -1, why: '同上一条，西岸' },
  'w-canal-s1': { offKm: 5, side: 1, paste: false, why: '不贴：大江以南的两段运河定了照直线画' },
  'w-canal-s2': { offKm: 5, side: 1, paste: false, why: '不贴：大江以南的两段运河定了照直线画' },
  'w-bian-a': { offKm: 6, side: 1, why: '往东南走的左手边，就是东北岸（样张也是这一边）' },
  'w-bian-b': { offKm: 6, side: 1, why: '同上一条' },
  'w-bian-c': { offKm: 6, side: 1, why: '同上一条' },
  'w-jiang-lower': { offKm: 8, side: -1, why: '往西南（上水）走的右手边，就是北岸、西岸：和样张的大江下游是同一边，不碰南岸的彭蠡' },
  'w-gan': { offKm: 6, side: 1, why: '往南（上水）走的左手边，就是东岸：吉州、虔州一带的路不压着西边的山' },
  'w-bei': { offKm: 6, side: 1, why: '往南走的左手边，就是东岸：广州在北江的东面（样张也是这一边）' },
  'w-dong': { offKm: 6, side: 1, why: '往东走的左手边，就是北岸：博罗在北岸（样张也是这一边）' },
  'w-xi': {
    offKm: 6,
    side: -1,
    meet: [112.83, 23.18],
    why: '往西走的右手边，就是北岸：端州、康州、封州、梧州都在北岸（样张也是这一边）。从广州直着连到西江、北江汇合的地方（今三水）上岸：数据里离广州最近的是三角洲里往南的一条汊，照它走要先往南绕一个弯',
  },
};

const d2 = (a: Km, b: Km): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0 || 1)));
  return t * t * (3 - 2 * t);
};

/** 折线化简（Douglas–Peucker）：离连线不到 tol 公里的点去掉，头尾不动。 */
export function simplify(pts: Km[], tol: number): Km[] {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop() as [number, number];
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
  return pts.filter((_, i) => keep[i] === 1);
}

/** 削角抹圆（Chaikin）：每一段换成它四分之一、四分之三处的两点，两头不动。 */
export function chaikin(pts: Km[], times = 1): Km[] {
  let p = pts;
  for (let k = 0; k < times; k++) {
    if (p.length < 3) return p;
    const out: Km[] = [p[0]];
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

/** 折线按点距加密（直线上匀着添点）。 */
export function dense(pts: Km[], step: number): Km[] {
  const out: Km[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.max(1, Math.ceil(d2(a, b) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

/** 线上离 p 最近的是第几个点。 */
export function nearestIndex(line: Km[], p: Km): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < line.length; i++) {
    const d = d2(line[i], p);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** 一点离几条线最近多少公里。 */
export function kmToLines(p: Km, lines: Km[][]): number {
  let best = Infinity;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const ax = line[i - 1][0];
      const ay = line[i - 1][1];
      const dx = line[i][0] - ax;
      const dy = line[i][1] - ay;
      const t = Math.min(1, Math.max(0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy || 1)));
      best = Math.min(best, Math.hypot(p[0] - ax - dx * t, p[1] - ay - dy * t));
    }
  }
  return best;
}

/**
 * 把一条河的几段线接起来：从最长的一段起，哪一段的头或尾离现在这条的头或尾不到 joinKm 公里就接上（要倒过来的倒过来），
 * 接不上的另起一条。给出来的每一条都是接到不能再接的。
 */
export function stitch(lines: Km[][], joinKm = STITCH_KM): Km[][] {
  const length = (l: Km[]): number => l.reduce((sum, p, i) => (i === 0 ? 0 : sum + d2(l[i - 1], p)), 0);
  const rest = lines.filter((l) => l.length >= 2).sort((a, b) => length(b) - length(a));
  const chains: Km[][] = [];
  while (rest.length > 0) {
    let cur = rest.shift() as Km[];
    for (;;) {
      let best = -1;
      let bd = joinKm;
      let how = 0;
      const head = cur[0];
      const tail = cur[cur.length - 1];
      rest.forEach((l, i) => {
        // 0 接在尾上；1 倒过来接在尾上；2 接在头前面；3 倒过来接在头前面
        [d2(tail, l[0]), d2(tail, l[l.length - 1]), d2(head, l[l.length - 1]), d2(head, l[0])].forEach((d, c) => {
          if (d < bd) {
            bd = d;
            best = i;
            how = c;
          }
        });
      });
      if (best < 0) break;
      const l = rest.splice(best, 1)[0];
      if (how === 0) cur = cur.concat(l);
      else if (how === 1) cur = cur.concat(l.slice().reverse());
      else if (how === 2) cur = l.concat(cur);
      else cur = l.slice().reverse().concat(cur);
    }
    chains.push(cur);
  }
  return chains;
}

export interface BankInput {
  /** 河的中线里用的那一条（公里，已经接好）。 */
  centre: Km[];
  /** 画出来的这条河的每一段线：离河多远是对着它们量的。不写就只对着 centre 量。 */
  painted?: Km[][];
  /** 路的两头。 */
  a: Km;
  b: Km;
  /** 两头各自在河上的哪一点上岸；不写就是河上离这一头最近的一点。 */
  meetA?: Km;
  meetB?: Km;
  /** 离画出来的河的中线多少公里。 */
  off: number;
  /** 挪到哪一边：顺着 a 到 b 的方向，1 是左手边。 */
  side: 1 | -1;
  /** 一点是不是落在湖里、只染水色的水里、海里。 */
  inWater: (p: Km) => boolean;
  /** 两头各自是不是慢慢收回到城里（false：从岸上直着连过去）。不写都是 true。 */
  taperA?: boolean;
  taperB?: boolean;
  /** 引线抽稀到多少公里。不写是 BANK_THIN_KM。 */
  thinKm?: number;
}

export interface BankOutput {
  /** 做出来的线，头是 a，尾是 b，还没有最后抽稀。 */
  line: Km[];
  /** 为了躲开水往河这边收过的点数。 */
  pulled: number;
  /** 收到头还在水里的点数（有的话，这一边走不通，换另一边）。 */
  wet: number;
  /** 挪到最远还是离河不够远的点数（河在这里绕得太密）。 */
  tight: number;
  /** 因为线折回去、去掉的点数。 */
  folded: number;
  /** 直着连到城里的那一头，为了不过水，从河上往前让了多少公里。 */
  skippedKm: [number, number];
}

/** 沿河的一条岸线，从 a 到 b。怎么做的见这个文件的开头。 */
export function bankLine(input: BankInput): BankOutput {
  const { centre, a, b, off, side, inWater } = input;
  const painted = input.painted ?? [centre];
  const taperA = input.taperA ?? true;
  const taperB = input.taperB ?? true;
  const thin = input.thinKm ?? BANK_THIN_KM;
  const none: BankOutput = { line: [a, b], pulled: 0, wet: 0, tight: 0, folded: 0, skippedKm: [0, 0] };
  const ia = nearestIndex(centre, input.meetA ?? a);
  const ib = nearestIndex(centre, input.meetB ?? b);
  let sub = ia <= ib ? centre.slice(ia, ib + 1) : centre.slice(ib, ia + 1).reverse();
  if (sub.length < 2) return none;
  sub = dense(chaikin(simplify(sub, thin), 2), BANK_STEP_KM);
  const n = sub.length;
  const L = [0];
  for (let i = 1; i < n; i++) L.push(L[i - 1] + d2(sub[i - 1], sub[i]));
  const tot = L[n - 1];
  const taper = Math.min(BANK_TAPER_KM, tot * BANK_TAPER_SHARE);
  const nrm = sub.map((_, i): Km => {
    const q = sub[Math.min(n - 1, i + 1)];
    const o = sub[Math.max(0, i - 1)];
    const tl = d2(o, q) || 1;
    return [(-(q[1] - o[1]) / tl) * side, ((q[0] - o[0]) / tl) * side];
  });
  const at = (i: number, w: number): Km => [sub[i][0] + nrm[i][0] * w, sub[i][1] + nrm[i][1] * w];

  // 每一点各自挪多少：从够远的地方往回收，收到离画出来的河正好 off 公里为止
  const far = off + thin + 3;
  let tight = 0;
  const raw = sub.map((_, i) => {
    if (kmToLines(at(i, far), painted) < off) {
      tight += 1;
      return far;
    }
    let w = far;
    while (w - 0.25 >= -far && kmToLines(at(i, w - 0.25), painted) >= off) w -= 0.25;
    return w;
  });
  /** 一串数的“慢慢带过去”：每一点取各点的数减去（或者加上）离它的路程乘 BANK_SLOPE 以后最大（最小）的那个。 */
  const spread = (values: number[], sign: 1 | -1): number[] =>
    values.map((_, i) => {
      let best = values[i];
      for (let j = 0; j < n; j++) {
        const v = values[j] - sign * BANK_SLOPE * Math.abs(L[i] - L[j]);
        if (sign * v > sign * best) best = v;
      }
      return best;
    });
  const env = spread(raw, 1);

  // 两头各自“到了岸上几成”：0 是还在城里，1 是完全在岸上
  const sA = sub.map((_, i) => (taperA ? smoothstep(0, taper, L[i]) : 1));
  const sB = sub.map((_, i) => (taperB ? smoothstep(0, taper, tot - L[i]) : 1));
  // 城离河上那一点差多少：收回的那一截里，线连同这一点差数一起慢慢挪回来
  const da: Km = [a[0] - sub[0][0], a[1] - sub[0][1]];
  const db: Km = [b[0] - sub[n - 1][0], b[1] - sub[n - 1][1]];
  let dip = new Array<number>(n).fill(0);
  const point = (i: number, lower = dip[i]): Km => {
    const p = at(i, (env[i] - lower) * sA[i] * sB[i]);
    return [p[0] + (1 - sA[i]) * da[0] + (1 - sB[i]) * db[0], p[1] + (1 - sA[i]) * da[1] + (1 - sB[i]) * db[1]];
  };
  /** 从 p 直着走到 q，中间（每公里看一眼，两头也看）有没有落在水里的。 */
  const crossesWater = (p: Km, q: Km): boolean => {
    const steps = Math.max(1, Math.ceil(d2(p, q)));
    for (let s = 0; s <= steps; s++) if (inWater([p[0] + ((q[0] - p[0]) * s) / steps, p[1] + ((q[1] - p[1]) * s) / steps])) return true;
    return false;
  };

  // 直着连到城里的那一头：直着连要过水的话，从河上往前让，让到头一个连得过去的点（最多让到半路）
  let first = 0;
  let last = n - 1;
  if (!taperA) while (first < Math.floor(n / 2) && crossesWater(a, point(first))) first++;
  if (!taperB) while (last > Math.ceil(n / 2) && crossesWater(b, point(last))) last--;

  // 挪到岸上以后落进水里的点：往河这边收，最多收到离河 BANK_NEAREST_KM 公里；前后慢慢过渡
  const room = Math.max(0, off - BANK_NEAREST_KM);
  let pulled = 0;
  let wet = 0;
  for (let pass = 0; pass < 4; pass++) {
    const need = dip.slice();
    let any = false;
    for (let i = first; i <= last; i++) {
      const hit = (lower: number): boolean => inWater(point(i, lower)) || (i < last && crossesWater(point(i, lower), point(i + 1)));
      if (!hit(dip[i])) continue;
      let lower = dip[i];
      while (lower + 0.5 <= room && hit(lower)) lower += 0.5;
      if (lower > dip[i]) {
        need[i] = lower;
        any = true;
      }
    }
    if (!any) break;
    dip = spread(need, 1).map((v) => Math.min(room, Math.max(0, v)));
  }
  for (let i = first; i <= last; i++) {
    if (dip[i] > 0) pulled += 1;
    if (inWater(point(i))) wet += 1;
  }

  // 河弯得急、岸又在弯里面的地方，挪出来的点会前后叠在一起，线折回去一小截（一个倒刺）。
  // 只留顺着引线往前走的点：从上一个留下的点到这一点，对着两处引线的方向都是往前的才留。
  const tangent = (i: number): Km => [nrm[i][1] * side, -nrm[i][0] * side];
  const ahead = (from: Km, to: Km, i: number): boolean => (to[0] - from[0]) * tangent(i)[0] + (to[1] - from[1]) * tangent(i)[1] > 0;
  const kept: number[] = [first];
  const spots = new Map<number, Km>([[first, point(first)]]);
  let folded = 0;
  for (let i = first + 1; i <= last; i++) {
    const p = point(i);
    const j = kept[kept.length - 1];
    const from = spots.get(j) as Km;
    if (ahead(from, p, i) && ahead(from, p, j)) {
      kept.push(i);
      spots.set(i, p);
    } else folded += 1;
  }
  // 最后一点一定要在：它前面要是有挡着它的点，去掉
  if (kept[kept.length - 1] !== last) {
    const p = point(last);
    while (kept.length > 1 && !ahead(spots.get(kept[kept.length - 1]) as Km, p, last)) kept.pop();
    kept.push(last);
    spots.set(last, p);
  }

  const line: Km[] = kept.map((i) => spots.get(i) as Km);
  if (taperA) line[0] = a;
  else line.unshift(a);
  if (taperB) line[line.length - 1] = b;
  else line.push(b);
  return { line, pulled, wet, tight, folded, skippedKm: [L[first], tot - L[last]] };
}

// ---------------------------------------------------------------- 照场景做

const insideRing = (p: LngLat, ring: readonly LngLat[]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};

interface Boxed {
  polygon: LngLat[][];
  box: [number, number, number, number];
}
function boxed(polygon: LngLat[][]): Boxed {
  let w = Infinity;
  let e = -Infinity;
  let s = Infinity;
  let n = -Infinity;
  for (const [lng, lat] of polygon[0]) {
    w = Math.min(w, lng);
    e = Math.max(e, lng);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  return { polygon, box: [w, e, s, n] };
}
const inAny = (p: LngLat, list: Boxed[]): boolean =>
  list.some(({ polygon, box }) => p[0] >= box[0] && p[0] <= box[1] && p[1] >= box[2] && p[1] <= box[3] && insideRing(p, polygon[0]) && !polygon.slice(1).some((hole) => insideRing(p, hole)));

/** 沙盘上哪里是水（湖、只染水色的水、海）：路不该落进去的地方。和 tests/stage/route-roads.test.ts 查的是同一批。 */
export function waterTest(scene: RouteScene, features: TodayFeature[]): (p: LngLat) => boolean {
  const land = features.filter((feature) => feature.kind === 'land').flatMap((feature) => feature.polygons.map(boxed));
  const seas = scene.terrain.edits.map((edit) => boxed([edit.area]));
  const lakes = scene.water.lakes.map((lake) => ({ areas: pickedLakes(features, lake.today).map(boxed), except: lake.except?.area }));
  const washes = scene.water.washes.flatMap((wash) => wash.areas.map((ring) => boxed([ring])));
  return (p) => !inAny(p, land) || inAny(p, seas) || inAny(p, washes) || lakes.some((lake) => inAny(p, lake.areas) && !(lake.except && insideRing(p, lake.except)));
}

export interface BankResult {
  way: string;
  river: string;
  spec: BankSpec;
  /** 做出来的线：经纬度，三位小数，头尾是路原来的两头。 */
  line: LngLat[];
  /** 路的两头离河心多少公里；哪一头是慢慢收回到城里的。 */
  ends: { km: [number, number]; tapered: [boolean, boolean] };
  made: Omit<BankOutput, 'line'>;
  /** 沿线一共多少公里。 */
  km: number;
  /** 做出来的线（每 2 公里量一点）离画出来的河最远、最近多少公里。最近的不算收回到城里的两截；直着连到城里的那一截两样都不算。 */
  farKm: number;
  nearKm: number;
  /** 河的线接成了几条，用的那一条有多少公里。 */
  chains: number;
  chainKm: number;
}

/**
 * 给场景里的一条路做岸线。paths 是 riverPaths(…) 给的画在地面上的河；spec 不写就查 BANKS。
 * 这条路没有写 along、along 写的是湖、BANKS 里没有它：都说不出线，抛出原因。
 */
export function bankOfWay(scene: RouteScene, features: TodayFeature[], coords: FrameCoords, paths: RiverPath[], way: RoadWay, spec: BankSpec | undefined = BANKS[way.id]): BankResult {
  if (!way.along) throw new Error(`路“${way.id}”没有写 along，不是沿着河走的`);
  const path = paths.find((item) => item.id === way.along);
  if (!path) throw new Error(`路“${way.id}”的 along 写的“${way.along}”不是一条河（沿着湖走的路不做岸线）`);
  if (!spec) throw new Error(`路“${way.id}”在 BANKS 里没有写离河多远、在哪一边（tests/tools/route/bankTool.ts）`);
  const k = scene.frame.scale / 1000;
  const toKm = (p: [number, number]): Km => [p[0] * k, -p[1] * k];
  const kmOf = (p: LngLat): Km => toKm(coords.toLocal(p));
  const lngLatOf = (p: Km): LngLat => coords.toLngLat(p[0] / k, -p[1] / k);
  const a = kmOf(way.line[0]);
  const b = kmOf(way.line[way.line.length - 1]);

  // 河的线：接成几条，取离两头合起来最近的那一条，加密到 2 公里一个点（找“最近的点”才准）
  const painted = path.lines.map((line) => line.map(toKm));
  const chains = stitch(painted).map((line) => dense(line, 2));
  if (chains.length === 0) throw new Error(`河“${path.id}”没有线`);
  const reach = (line: Km[], p: Km): number => d2(line[nearestIndex(line, p)], p);
  const centre = chains.reduce((best, line) => (reach(line, a) + reach(line, b) < reach(best, a) + reach(best, b) ? line : best));
  const endKm: [number, number] = [reach(centre, a), reach(centre, b)];
  const tapered: [boolean, boolean] = [endKm[0] <= TOWN_BY_RIVER_KM, endKm[1] <= TOWN_BY_RIVER_KM];

  const wet = waterTest(scene, features);
  // 写了在哪上岸的，只管直着连到城里的那一头
  const meet = spec.meet ? kmOf(spec.meet) : undefined;
  const { line: full, ...made } = bankLine({ centre, painted, a, b, meetA: tapered[0] ? undefined : meet, meetB: tapered[1] ? undefined : meet, off: spec.offKm, side: spec.side, inWater: (p) => wet(lngLatOf(p)), taperA: tapered[0], taperB: tapered[1], thinKm: spec.thinKm });
  const thinned = simplify(full, BANK_OUT_KM);
  const round3 = (v: number): number => Math.round(v * 1000) / 1000;
  const line = thinned.map((p, i): LngLat => {
    // 两头是路原来的两头，一点不动
    if (i === 0) return way.line[0];
    if (i === thinned.length - 1) return way.line[way.line.length - 1];
    const [lng, lat] = lngLatOf(p);
    return [round3(lng), round3(lat)];
  });

  // 量一遍做出来的线（量的是取过三位小数、要贴进场景的那一条）
  const final = line.map(kmOf);
  const samples = dense(final, 2);
  const run = [0];
  for (let i = 1; i < samples.length; i++) run.push(run[i - 1] + d2(samples[i - 1], samples[i]));
  const km = run[run.length - 1];
  const taper = Math.min(BANK_TAPER_KM, km * BANK_TAPER_SHARE);
  const headKm = tapered[0] ? 0 : d2(final[0], final[1]);
  const tailKm = tapered[1] ? 0 : d2(final[final.length - 2], final[final.length - 1]);
  let farKm = 0;
  let nearKm = Infinity;
  samples.forEach((p, i) => {
    if (run[i] < headKm || km - run[i] < tailKm) return;
    const d = kmToLines(p, painted);
    farKm = Math.max(farKm, d);
    if ((tapered[0] && run[i] < taper) || (tapered[1] && km - run[i] < taper)) return;
    nearKm = Math.min(nearKm, d);
  });
  const chainKm = centre.reduce((sum, p, i) => (i === 0 ? 0 : sum + d2(centre[i - 1], p)), 0);
  return { way: way.id, river: path.id, spec, line, ends: { km: endKm, tapered }, made, km, farKm, nearKm, chains: chains.length, chainKm };
}

/** 一条线写成场景文件里的样子：一行，[经, 纬] 之间一个逗号一个空格。 */
export function lineText(line: LngLat[]): string {
  return `[${line.map((p) => `[${p[0]}, ${p[1]}]`).join(', ')}]`;
}

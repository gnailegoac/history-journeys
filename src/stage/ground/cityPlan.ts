// 一座城的平面：从城墙那一圈线算出城的中心、城门、大街和小巷。
// 上色（街巷）和零件库（民居）都读这一份，两边才对得上。“离城多远”“第几条巷”一律从城自己的中心算，
// 不从沙盘的原点算（样张里城的中心正好是原点，这里不是）。
//
// 街和巷是登记在场景里的规则，没有登记就不画：
//   大街  点缀里有一条 roads 写了 inside: <这道城墙>，才有；
//   小巷  点缀里有一条 houses 写了 inside: <这道城墙>，而且 params.lanes 是 true，才有。

import type { SceneThing, StopScene } from '../../domain/scene';
import type { FrameCoords } from '../../domain/sceneGeo';
import { dressingParams, thingParams } from '../../domain/sceneParams';
import { asRing, ringCentre, ringSigned } from './lines';
import type { CityPlan, Vec2 } from './types';

/** 小巷、横巷离城墙的线至少这么多米（城墙有厚度，墙根还要留一圈空地）。 */
const LANE_MARGIN_M = 60;
/** 小巷：隔 150 米一条，最靠中间的两条离城的中心 75 米（样张的数）。 */
const LANE_STEP_M = 150;
const LANE_FIRST_M = 75;
/** 横巷：隔 200 米一条，最靠中间的两条离城的中心 100 米（样张的数）。 */
const ALLEY_STEP_M = 200;
const ALLEY_FIRST_M = 100;
/** 短于这么多米的一截巷子不要。 */
const LANE_MIN_M = 40;

/**
 * 城门的城台多宽（一半）；big 的城门再加多少；城台离这一面墙的两头至少留多少。沙盘里的米（模型放大了，不按比例）。
 * 城门落在哪一点只在这里定（见 gateSeat）：零件库造城门、地面画大街、题签指着城门，用的都是这一点。
 */
export const GATE_HALF_M = 76;
export const GATE_BIG_EXTRA_M = 14;
const GATE_END_ROOM_M = 10;

/** 大街离院落的围墙这么远就停住（街画出来有十几米宽，再近就画到围墙底下去了）。 */
const STREET_OFF_YARD_M = 20;

/** 一道城墙的线：一圈，最后一点不重复第一点。 */
export interface WallRing {
  id: string;
  ring: Vec2[];
}

/** 场景里所有的城墙（kind 是 wall、线至少三个点的摆件）。城墙写了 when 也照样算：地面只算一次，不跟着小节变。 */
export function wallRings(scene: StopScene, coords: FrameCoords): WallRing[] {
  const out: WallRing[] = [];
  for (const thing of scene.things) {
    if (thing.kind !== 'wall' || !thing.line) continue;
    const ring = asRing(thing.line.map((p): Vec2 => coords.toLocal(p)));
    if (ring.length >= 3) out.push({ id: thing.id, ring });
  }
  return out;
}

/** 每道城墙一座城。heightAt 是整理好的地面（城里没有写修整时，城里地面的海拔从它取）。 */
export function cityPlans(scene: StopScene, coords: FrameCoords, walls: WallRing[], heightAt: (x: number, z: number) => number): CityPlan[] {
  return walls.map(({ id, ring }): CityPlan => {
    const centre = ringCentre(ring);

    let groundM = heightAt(centre[0], centre[1]);
    for (const edit of scene.terrain.edits) {
      if (edit.op === 'level' && edit.inside === id && edit.mode === 'set') groundM = edit.toM;
    }

    const gates: CityPlan['gates'] = [];
    for (const thing of scene.things) {
      if (thing.kind !== 'gate' || thing.on !== id || !thing.at) continue;
      gates.push({ id: thing.id, ...gateSeat(coords.toLocal(thing.at), ring, thingParams('gate', thing.params).big ?? false) });
    }

    const hasStreets = scene.dressing.some((d) => d.kind === 'roads' && d.inside === id);
    const hasLanes = scene.dressing.some((d) => d.kind === 'houses' && d.inside === id && dressingParams('houses', d.params).lanes === true);
    // 城里的院落（官署、寺）：大街不从它们的围墙里穿过去
    const yards = scene.things.filter((t) => t.kind === 'hall-group' && t.at && ringSigned(...coords.toLocal(t.at), ring) < 0).map((t) => yardOf(t, coords));

    return {
      wallId: id,
      wall: ring,
      centre,
      groundM,
      gates,
      streets: hasStreets ? planStreets(gates, centre).flatMap((street) => aroundYards(street, yards)) : [],
      lanes: hasLanes ? planLanes(ring, centre) : [],
    };
  });
}

/**
 * 一座城门落在城墙线上的哪一点，和那里朝城外的方向。
 * 先挪到城墙线上离它最近的地方；城台有宽度，不能伸出这一面墙，所以离这一面墙的两头至少留出半个城台再加 10 米
 * （这一面墙太短、留不出来时，落在这一面墙的正中）。big 是门墩加大的城门。
 */
export function gateSeat(p: Vec2, ring: Vec2[], big = false): { at: Vec2; outward: Vec2 } {
  let best = Infinity;
  let at: Vec2 = [p[0], p[1]];
  let outward: Vec2 = [0, 1];
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [ax, az] = ring[j];
    const [bx, bz] = ring[i];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len === 0) continue;
    let t = ((p[0] - ax) * dx + (p[1] - az) * dz) / (len * len);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(p[0] - (ax + dx * t), p[1] - (az + dz * t));
    if (d >= best) continue;
    best = d;
    // 离这一面墙的两头至少这么远
    const room = Math.min(len / 2, GATE_HALF_M + (big ? GATE_BIG_EXTRA_M : 0) + GATE_END_ROOM_M);
    const along = Math.min(Math.max(t * len, room), len - room);
    const qx = ax + (dx * along) / len;
    const qz = az + (dz * along) / len;
    at = [qx, qz];
    // 和这一段墙垂直的两个方向里，朝城外的那一个。
    let nxOut = dz / len;
    let nzOut = -dx / len;
    if (ringSigned(qx + nxOut, qz + nzOut, ring) < 0) {
      nxOut = -nxOut;
      nzOut = -nzOut;
    }
    outward = [nxOut, nzOut];
  }
  return { at, outward };
}

/**
 * 场景里每座城门落在哪一点（沙盘里的米），按城门的 id 取。城门写的 on 不是一道城墙、或者没有写 at 的不在里面。
 * 镜头和题签不经过地面也要知道城门在哪，所以单给一个只看场景的算法；城的平面（cityPlans）里的 gates 是同一个数。
 */
export function gateSeats(scene: StopScene, coords: FrameCoords): Map<string, Vec2> {
  const walls = wallRings(scene, coords);
  const out = new Map<string, Vec2>();
  for (const thing of scene.things) {
    if (thing.kind !== 'gate' || !thing.at) continue;
    const wall = walls.find((w) => w.id === thing.on);
    if (!wall) continue;
    out.set(thing.id, gateSeat(coords.toLocal(thing.at), wall.ring, thingParams('gate', thing.params).big ?? false).at);
  }
  return out;
}

// ---------------------------------------------------------------- 院落占的地

/**
 * 一组院落（kind 是 hall-group）自己的坐标里怎么排：正面朝 +z，中轴是 x = 0。
 * zs 是几进殿各在哪（从最后面一座起，隔 72 米一座）；back、front 是后墙和前墙在哪；gate 是前面那座门屋在哪；
 * halfWidth 是东西两道围墙各离中轴多远。零件库照这个造，地面照这个让大街绕开，两边才对得上（样张的数）。
 */
export function yardLayout(halls: number): { zs: number[]; back: number; gate: number; front: number; halfWidth: number } {
  const n = Math.min(5, Math.max(1, Math.round(halls)));
  const zs = Array.from({ length: n }, (_, i) => -50 - (n - 2) * 36 + i * 72);
  const gate = zs[n - 1] + 62;
  return { zs, back: zs[0] - 55, gate, front: gate + 6, halfWidth: 117 };
}

/** 一组院落在沙盘上占的那一块：中轴上的原点、正面朝哪边（长度为 1）、围墙前后左右各在哪。 */
interface YardBox {
  at: Vec2;
  /** 院落自己的 +x、+z（正面）在沙盘上朝哪边。 */
  ax: Vec2;
  az: Vec2;
  back: number;
  front: number;
  halfWidth: number;
}

function yardOf(thing: SceneThing, coords: FrameCoords): YardBox {
  const layout = yardLayout(thingParams('hall-group', thing.params).halls ?? 2);
  // facing：0 朝北，顺时针，度；不写是朝南（沙盘上南是 +z）
  const f = ((thing.facing ?? 180) * Math.PI) / 180;
  const az: Vec2 = [Math.sin(f), -Math.cos(f)];
  const ax: Vec2 = [az[1], -az[0]];
  return { at: coords.toLocal(thing.at as [number, number]), ax, az, back: layout.back, front: layout.front, halfWidth: layout.halfWidth };
}

/**
 * 一条大街让开各组院落：穿过围墙里面的那一截去掉，街在离围墙 STREET_OFF_YARD_M 的地方停住；
 * 停在院落正面的那一头，再顺着前墙接到大门口。
 */
function aroundYards(street: Vec2[], yards: YardBox[]): Vec2[][] {
  let pieces: Vec2[][] = [street];
  for (const yard of yards) pieces = pieces.flatMap((piece) => aroundYard(piece, yard));
  return pieces;
}

function aroundYard(street: Vec2[], yard: YardBox): Vec2[][] {
  const m = STREET_OFF_YARD_M;
  const x1 = yard.halfWidth + m;
  const z0 = yard.back - m;
  const z1 = yard.front + m;
  const toYard = (p: Vec2): Vec2 => {
    const dx = p[0] - yard.at[0];
    const dz = p[1] - yard.at[1];
    return [dx * yard.ax[0] + dz * yard.ax[1], dx * yard.az[0] + dz * yard.az[1]];
  };
  const toTable = (q: Vec2): Vec2 => [yard.at[0] + yard.ax[0] * q[0] + yard.az[0] * q[1], yard.at[1] + yard.ax[1] * q[0] + yard.az[1] * q[1]];
  /** 停在院落正面（前墙外）的一头：顺着前墙接到大门口。 */
  const door = (q: Vec2): Vec2[] => (Math.abs(q[1] - z1) < 0.5 && Math.abs(q[0]) > 1 ? [toTable([0, z1])] : []);

  const out: Vec2[][] = [];
  let current: Vec2[] = [];
  const close = (): void => {
    if (current.length >= 2) out.push(current);
    current = [];
  };
  for (let i = 0; i < street.length - 1; i++) {
    const a = toYard(street[i]);
    const b = toYard(street[i + 1]);
    // 这一段在那一块里面的是哪一截（t 从 0 到 1）：两个方向各收一次
    let t0 = 0;
    let t1 = 1;
    const clip = (from: number, to: number, lo: number, hi: number): void => {
      const d = to - from;
      if (Math.abs(d) < 1e-9) {
        if (from <= lo || from >= hi) t1 = -1;
        return;
      }
      const ta = (lo - from) / d;
      const tb = (hi - from) / d;
      t0 = Math.max(t0, Math.min(ta, tb));
      t1 = Math.min(t1, Math.max(ta, tb));
    };
    clip(a[0], b[0], -x1, x1);
    clip(a[1], b[1], z0, z1);
    if (current.length === 0) current.push(street[i]);
    if (t1 - t0 <= 1e-6) {
      // 这一段没有进那一块
      current.push(street[i + 1]);
      continue;
    }
    const at = (t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    if (t0 > 1e-6) {
      // 走到那一块的边上停住
      const stop = at(t0);
      current.push(toTable(stop), ...door(stop));
      close();
    } else {
      // 这一段的起点就在那一块里面：前面攒的那一截到此为止
      current.pop();
      close();
    }
    if (t1 < 1 - 1e-6) {
      // 从那一块的另一边出来，接着走
      const start = at(t1);
      current = [...door(start), toTable(start), street[i + 1]];
    }
  }
  close();
  return out;
}

/**
 * 大街，从城门到城门。每座城门的街先笔直往城里走，走到离城的中心最近的那一点；
 * 对面有城门的，两条街在那里接上（两座门不正对时，中间折一段）；对面没有城门的，接到城的中心。
 * 同一个地方前后两座城门（先是土门，后来包了砖）只算一条街。
 */
function planStreets(gates: CityPlan['gates'], centre: Vec2): Vec2[][] {
  const unique: CityPlan['gates'] = [];
  for (const g of gates) {
    if (!unique.some((u) => Math.hypot(u.at[0] - g.at[0], u.at[1] - g.at[1]) < 1)) unique.push(g);
  }

  // 从城门笔直往城里走，离城的中心最近的那一点。
  const foot = (g: CityPlan['gates'][number]): Vec2 => {
    const along = Math.max(0, (g.at[0] - centre[0]) * g.outward[0] + (g.at[1] - centre[1]) * g.outward[1]);
    return [g.at[0] - g.outward[0] * along, g.at[1] - g.outward[1] * along];
  };

  const streets: Vec2[][] = [];
  const used = new Set<number>();
  for (let i = 0; i < unique.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    const a = unique[i];
    // 对面的城门：朝外的方向和这一座最相反的那一座。
    let partner = -1;
    let most = -0.5;
    for (let j = i + 1; j < unique.length; j++) {
      if (used.has(j)) continue;
      const dot = a.outward[0] * unique[j].outward[0] + a.outward[1] * unique[j].outward[1];
      if (dot < most) {
        most = dot;
        partner = j;
      }
    }
    if (partner < 0) {
      streets.push(tidy([a.at, foot(a), centre]));
    } else {
      used.add(partner);
      const b = unique[partner];
      streets.push(tidy([a.at, foot(a), foot(b), b.at]));
    }
  }
  return streets;
}

/** 去掉重复的点和夹在一条直线中间的点。 */
function tidy(line: Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  for (const p of line) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1) continue;
    out.push([p[0], p[1]]);
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const [ax, az] = out[i - 1];
    const [bx, bz] = out[i];
    const [cx, cz] = out[i + 1];
    const off = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax)) / (Math.hypot(cx - ax, cz - az) || 1);
    if (off < 0.5) out.splice(i, 1);
  }
  return out;
}

/**
 * 巷子顺着哪边排：along 是小巷的走向（长度为 1），across 和它垂直。
 * 取城墙最长的那一边的走向，再转到最接近正东的那一个；横平竖直的城，小巷就是东西向的。
 */
export function laneAxes(ring: Vec2[]): { along: Vec2; across: Vec2 } {
  let ux = 1;
  let uz = 0;
  let longest = 0;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const dx = ring[i][0] - ring[j][0];
    const dz = ring[i][1] - ring[j][1];
    const len = Math.hypot(dx, dz);
    if (len > longest) {
      longest = len;
      ux = dx / len;
      uz = dz / len;
    }
  }
  if (Math.abs(ux) < Math.abs(uz)) [ux, uz] = [-uz, ux];
  if (ux < 0) [ux, uz] = [-ux, -uz];
  return { along: [ux, uz], across: [-uz, ux] };
}

/** 小巷：两边排民居的那些，从北到南（顺着 across）一条一条给，每条从西到东。 */
function planLanes(ring: Vec2[], centre: Vec2): Vec2[][] {
  const { along, across } = laneAxes(ring);
  return stripes(ring, centre, along, across, LANE_FIRST_M, LANE_STEP_M);
}

/**
 * 横巷：和小巷垂直、把一排排民居断开的那些。只给上色用；
 * 零件库照“沿着小巷，离城的中心 100 米、300 米……的地方留一个口子”这条规矩自己留。
 */
export function crossAlleys(city: CityPlan): Vec2[][] {
  if (city.lanes.length === 0) return [];
  const { along, across } = laneAxes(city.wall);
  return stripes(city.wall, city.centre, across, along, ALLEY_FIRST_M, ALLEY_STEP_M);
}

/**
 * 一组平行的线：走向是 dir，从城的中心往 side 的两边排，第一条离中心 first 米，以后隔 step 米一条；
 * 每条只留离城墙的线够远的那几截。
 */
function stripes(ring: Vec2[], centre: Vec2, dir: Vec2, side: Vec2, first: number, step: number): Vec2[][] {
  // 城墙这一圈顺着 dir、顺着 side 各伸到哪。
  let sMin = Infinity;
  let sMax = -Infinity;
  let oMin = Infinity;
  let oMax = -Infinity;
  for (const [x, z] of ring) {
    const s = (x - centre[0]) * dir[0] + (z - centre[1]) * dir[1];
    const o = (x - centre[0]) * side[0] + (z - centre[1]) * side[1];
    sMin = Math.min(sMin, s);
    sMax = Math.max(sMax, s);
    oMin = Math.min(oMin, o);
    oMax = Math.max(oMax, o);
  }

  const offsets: number[] = [];
  for (let o = first; o < oMax - LANE_MARGIN_M; o += step) offsets.push(o);
  for (let o = -first; o > oMin + LANE_MARGIN_M; o -= step) offsets.push(o);
  offsets.sort((a, b) => a - b);

  const out: Vec2[][] = [];
  for (const o of offsets) {
    const at = (s: number): Vec2 => [centre[0] + dir[0] * s + side[0] * o, centre[1] + dir[1] * s + side[1] * o];
    const clear = (s: number): boolean => {
      const [x, z] = at(s);
      return ringSigned(x, z, ring) <= -LANE_MARGIN_M + 1e-6;
    };
    // 找“够远”和“不够远”交界的那一点：两头夹着对半分。
    const boundary = (inS: number, outS: number): number => {
      for (let n = 0; n < 16; n++) {
        const mid = (inS + outS) / 2;
        if (clear(mid)) inS = mid;
        else outS = mid;
      }
      return inS;
    };
    const walk = 5;
    let start: number | null = null;
    let prev = sMin;
    for (let s = sMin; s <= sMax + walk; s += walk) {
      const here = Math.min(s, sMax);
      const ok = clear(here);
      if (ok && start === null) start = here === sMin ? here : boundary(here, prev);
      if (!ok && start !== null) {
        const end = boundary(prev, here);
        if (end - start >= LANE_MIN_M) out.push([at(start), at(end)]);
        start = null;
      }
      prev = here;
    }
    if (start !== null && sMax - start >= LANE_MIN_M) out.push([at(start), at(sMax)]);
  }
  return out;
}

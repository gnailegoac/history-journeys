// 七种点缀各怎么造。每种一个函数，按 kind 收在 DRESSING_BUILDERS 里：domain 的表里添了一种点缀，这里不添就编译不过。
// 做法照样张（spikes/art-direction/b/scene/models.js 的 buildCity 里摆民居的一段、buildVillages、floodBoats、calmBoats、buildRocks），
// 改成了照场景数据摆：民居沿着地面给的小巷排，船沿着数据里的线系，石头摆在数据里的点周围。
// 路和田是画在地面上的（src/stage/ground），树另见 trees.ts；这三种在这里什么也不造。只算形状，不碰页面。
//
// 只造一遍：近看的样子、本来的大小和位置。远了怎么变由显卡照每样东西的记号算（geo.ts 的 FigureTag、figureMaterial.ts）：
//   民居  绕着自己的脚放大，从巷子往两边摊开，按次序去掉一些；
//   村子  屋绕着自己的脚放大，从村子的中心往外摊开，按次序去掉一些；
//   船、石头  绕着自己的脚放大，一样也不去掉（数目、分组是依据里说了的）。
// 每样东西的次序在这里定好（0 到 1，小的留到最后），不看镜头；每一类放大几倍、留几成在样式的表里。

import type { DressingKind, SceneDressing } from '../../../domain/scene';
import { existsAt } from '../../../domain/sceneText';
import type { CityPlan, Vec2, Vec3 } from '../../ground/types';
import type { FigureClass, FigureRule } from '../internal';
import { KEEP_FRINGE } from './figureMaterial';
import { Batch, T } from './geo';
import type { FigureTag } from './geo';
import { dressingParams } from './params';
import { addHouse } from './parts';
import { groundY, groupPoint, joinedTo, local, pointedAt, rankOf, wetAt } from './pass';
import type { Lot, Pass } from './pass';
import { BOAT_BEAM_M, BOAT_LENGTH_M, rockGeo } from './shapes';
import type { Instance } from './shapes';
import { grownYard, inYard, insidePolygon, lineDistance, ringDistance } from './site';
import type { WallSite, Yard } from './site';
import { bankFootGap } from './things';
import { clamp, distSeg, mulberry32 } from './util';

export type DressingBuilder = (pass: Pass, rule: SceneDressing) => void;

/** 民居的墙色：白的多，掺几种旧一点的。 */
const HOUSE_WALLS: Vec3[] = [
  [1, 1, 1],
  [0.95, 0.92, 0.84],
  [0.9, 0.88, 0.84],
  [0.97, 0.9, 0.78],
];

const lineLength = (line: Vec2[]): number => {
  let s = 0;
  for (let i = 0; i < line.length - 1; i++) s += Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
  return s;
};

/** 折线上从起点走了 s 米的那一点，和那里的走向（长度为 1）。 */
function pointAlong(line: Vec2[], s: number): { x: number; z: number; dx: number; dz: number } {
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (s <= len || i === line.length - 2) {
      const t = len > 0 ? clamp(s / len, 0, 1) : 0;
      return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: len > 0 ? (bx - ax) / len : 1, dz: len > 0 ? (bz - az) / len : 0 };
    }
    s -= len;
  }
  return { x: line[0][0], z: line[0][1], dx: 1, dz: 0 };
}

// ---------------------------------------------------------------- 成片的民居

/** 一座民居：摆在哪、多大，和“远了留不留它”要用的几样。 */
interface Home {
  x: number;
  z: number;
  /** 巷子上正对着它的那一点：远了它从这一点往外摊开。散着摆的就是它自己。 */
  fx: number;
  fz: number;
  /** 屋脊的走向（长度为 1）和绕竖轴转多少。 */
  dx: number;
  dz: number;
  ry: number;
  L: number;
  Dp: number;
  wallH: number;
  roofH: number;
  wall: Vec3;
  grey: number;
  /** 在第几条巷子上（按巷子离城的中心的远近排）。散着摆的都是 0。 */
  lane: number;
  /** 画质里留不留它（不留就不造）。 */
  built: boolean;
  /** 屋后接的一间横着的小屋。 */
  back: { x: number; z: number; len: number } | null;
}

/**
 * 给一片民居排次序：远了按它去掉一些，剩下的要排得开。返回每一座的次序（0 到 1，小的留到最后）。
 * 先挑出“放大到头时留着的”一批：只在隔一条的巷子上挑（屋子放大了，一条挨一条的巷子排不下两排），
 * 顺着巷子一座一座看，它放大、摊开以后不碰到已经挑上的、也不压着城墙脚、院落和大街，才挑上。
 * 这一批的次序排在“放大到头时留几成”那条线以内，别的排在线以外：放大到头时正好只剩这一批，谁也不压着谁。
 * 次序只看屋子摆在哪，不看画质：减配时少造一半，远了留下的还是这一批里造了的那几座。
 * turned：这一片是散着摆的，屋子各有各的朝向（差着十来度）。那样的两座屋不能再当成走向一样来比：
 * 各照自己真的朝向，算出它在沙盘的东西、南北两个方向上占多宽（斜着的占得宽一些），两个方向上都隔不开才算碰到。
 * 沿巷子排的不写，照原来的比法。
 */
function rankHomes(pass: Pass, ruleId: string, homes: Home[], seed: number, clear: (x: number, z: number, dx: number, dz: number) => boolean, turned = false): number[] {
  const rule: FigureRule = pass.ctx.style.figure.rules.cityHouse;
  const grow = Math.max(1, rule.maxTimes);
  const spread = Math.max(1, rule.spreadAtMax ?? 1);
  const keepAtMax = clamp(rule.keepAtMax ?? 1, 0, 1);
  const n = homes.length;
  /** 放大到头时这一座的正中，和顺着屋脊、横着屋脊各占多宽（一半，算上出檐）。 */
  const grown = (h: Home): { x: number; z: number; hl: number; hd: number } => ({
    x: h.fx + (h.x - h.fx) * spread,
    z: h.fz + (h.z - h.fz) * spread,
    hl: ((h.L + 5) / 2) * grow,
    hd: ((h.Dp + 7) / 2) * grow,
  });
  const first: number[] = [];
  const picked: { x: number; z: number; hl: number; hd: number; dx: number; dz: number }[] = [];
  homes.forEach((h, i) => {
    if (h.lane % 2 !== 0) return;
    const g = grown(h);
    for (const along of [0, -1, 1]) if (!clear(g.x + h.dx * along * g.hl, g.z + h.dz * along * g.hl, h.dx, h.dz)) return;
    for (const p of picked) {
      // 两座屋的走向差不多是一样的（巷子平行）：在这一座自己的方向上看隔得够不够开
      const u = Math.abs((g.x - p.x) * h.dx + (g.z - p.z) * h.dz);
      const v = Math.abs(-(g.x - p.x) * h.dz + (g.z - p.z) * h.dx);
      if (turned) {
        const wide = (q: { hl: number; hd: number }, dx: number, dz: number): Vec2 => [Math.abs(dx) * q.hl + Math.abs(dz) * q.hd, Math.abs(dz) * q.hl + Math.abs(dx) * q.hd];
        const a = wide(g, h.dx, h.dz);
        const b = wide(p, p.dx, p.dz);
        if (Math.abs(g.x - p.x) < a[0] + b[0] + 2 && Math.abs(g.z - p.z) < a[1] + b[1] + 2) return;
        continue;
      }
      const aligned = Math.abs(h.dx * p.dx + h.dz * p.dz) > 0.7;
      const reachU = g.hl + (aligned ? p.hl : p.hd) + 2;
      const reachV = g.hd + (aligned ? p.hd : p.hl) + 2;
      if (u < reachU && v < reachV) return;
    }
    picked.push({ ...g, dx: h.dx, dz: h.dz });
    first.push(i);
  });
  // 有题签指着这片民居时，离题签最近的那一座排在最前面
  const to = pointedAt(pass.ctx, ruleId);
  if (to && first.length > 1) {
    let best = 0;
    for (let k = 1; k < first.length; k++) {
      if (Math.hypot(homes[first[k]].x - to[0], homes[first[k]].z - to[1]) < Math.hypot(homes[first[best]].x - to[0], homes[first[best]].z - to[1])) best = k;
    }
    first.unshift(...first.splice(best, 1));
  }
  // 别的打乱了排在后面
  const chosen = new Set(first);
  const rest = homes.map((_, i) => i).filter((i) => !chosen.has(i));
  const rnd = mulberry32((seed ^ 0x2545f491) >>> 0);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const rank = new Array<number>(n).fill(0);
  const edge = keepAtMax / KEEP_FRINGE;
  if (first.length === 0 || rest.length === 0 || edge >= 1) {
    [...first, ...rest].forEach((i, position) => {
      rank[i] = position / n;
    });
    return rank;
  }
  first.forEach((i, position) => {
    rank[i] = (keepAtMax * position) / first.length;
  });
  rest.forEach((i, position) => {
    rank[i] = edge + ((1 - edge) * position) / rest.length;
  });
  return rank;
}

/** 把排好次序的民居造出来：每一座带上自己的记号；屋后的小屋是细处。 */
function addHomes(B: Batch, homes: Home[], rank: number[], y: (h: Home) => number, wet: (h: Home) => boolean): void {
  homes.forEach((h, i) => {
    if (!h.built) return;
    const g = y(h);
    const tag: FigureTag = { pivot: [h.x, g, h.z], group: [h.fx, g, h.fz], cls: 'cityHouse', rank: rank[i], wet: wet(h) };
    B.tagged(tag, () => {
      addHouse(B, h.x, g, h.z, h.ry, h.L, h.Dp, h.wallH, h.roofH, h.wall, [h.grey, h.grey, h.grey * 1.01], false);
      const back = h.back;
      if (back) B.detail([back.x, g, back.z], () => addHouse(B, back.x, g, back.z, h.ry + Math.PI / 2, back.len, 15, 9.5, 7.5, h.wall, [h.grey, h.grey, h.grey], false));
    });
  });
}

/**
 * 沿着小巷排的民居：每条巷子两边各一排，屋脊顺着巷子；遇到大街、横巷、院落和城墙脚就空开。
 * 小巷是地面给的（ground.cities 的 lanes，一条条平行）。横巷地面只画不给：照同一条规矩留口子，
 * 顺着小巷走，离城的中心 100 米、300 米……的地方各空一段。
 */
function housesAlongLanes(pass: Pass, B: Batch, ruleId: string, wall: WallSite, city: CityPlan, seed: number, density: number): void {
  const rnd = mulberry32(seed);
  // 画质里“民居留几成”另用一串随机数，留多留少不改变屋子摆在哪
  const keep = mulberry32(seed ^ 0x5bd1e995);
  const houseKeep = pass.ctx.quality.houseKeep;
  const g = wall.groundY;
  const lanes = city.lanes.filter((l) => l.length >= 2);
  // 小巷的走向，和垂直于它的方向
  const first = lanes[0];
  const fl = Math.hypot(first[first.length - 1][0] - first[0][0], first[first.length - 1][1] - first[0][1]) || 1;
  const dir: Vec2 = [(first[first.length - 1][0] - first[0][0]) / fl, (first[first.length - 1][1] - first[0][1]) / fl];
  const nrm: Vec2 = [-dir[1], dir[0]];
  /** 这条巷子在城的中心的哪一边、离多远。 */
  const offsetOf = (l: Vec2[]): number => Math.round(((l[0][0] + l[l.length - 1][0]) / 2 - city.centre[0]) * nrm[0] + ((l[0][1] + l[l.length - 1][1]) / 2 - city.centre[1]) * nrm[1]);
  const offsets = [...new Set(lanes.map(offsetOf))].sort((a, b) => a - b);
  /** 横巷隔多远一条。 */
  const block = 200;

  /**
   * 这一点摆不摆得了屋：离城墙脚、院落、大街都够远才行。
   * 和巷子平行的大街，至少离 alongGap 米；横穿过去的大街，至少离 22 米。(dx, dz) 是巷子的走向。
   */
  const blockedAt = (x: number, z: number, dx: number, dz: number, alongGap: number, yards: Yard[] = pass.yards): boolean => {
    if (ringDistance(wall.ring, x, z) > -58) return true;
    for (const y of yards) if (inYard(y, x, z, 26)) return true;
    for (const s of city.streets) {
      for (let k = 0; k < s.length - 1; k++) {
        const sx = s[k + 1][0] - s[k][0];
        const sz = s[k + 1][1] - s[k][1];
        const sl = Math.hypot(sx, sz);
        if (sl === 0) continue;
        const gap = Math.abs(sx * dx + sz * dz) / sl > 0.7 ? alongGap : 22;
        if (distSeg(x, z, s[k][0], s[k][1], s[k + 1][0], s[k + 1][1]) < gap) return true;
      }
    }
    return false;
  };

  const homes: Home[] = [];
  /** 屋后的空地：是第几座屋的，巷子上正对着它的是哪一点。 */
  const backLots: { lot: Lot; home: number; foot: Vec2 }[] = [];
  for (const lane of lanes) {
    const laneIndex = offsets.indexOf(offsetOf(lane));
    for (let i = 0; i < lane.length - 1; i++) {
      const [ax, az] = lane[i];
      const [bx, bz] = lane[i + 1];
      const segLen = Math.hypot(bx - ax, bz - az);
      if (segLen < 1) continue;
      const dx = (bx - ax) / segLen;
      const dz = (bz - az) / segLen;
      const ry = Math.atan2(-dz, dx);
      for (const side of [-1, 1]) {
        // 这一排的中线离巷子 25 米
        const ox = -dz * side * 25;
        const oz = dx * side * 25;
        let t = 0;
        while (t < segLen) {
          const L = 30 + rnd() * 30;
          const tc = t + L / 2;
          const xc = ax + dx * tc + ox;
          const zc = az + dz * tc + oz;
          // 顺着巷子，离城的中心多远；离最近的一条横巷多远
          const along = (xc - city.centre[0]) * dx + (zc - city.centre[1]) * dz;
          const toAlley = Math.abs((((along % block) + block) % block) - block / 2);
          const blocked =
            t + L > segLen ||
            toAlley < 8 + L / 2 ||
            blockedAt(xc, zc, dx, dz, 30) ||
            blockedAt(xc - (dx * L) / 2, zc - (dz * L) / 2, dx, dz, 30) ||
            blockedAt(xc + (dx * L) / 2, zc + (dz * L) / 2, dx, dz, 30);
          if (!blocked && rnd() < 0.92 * density) {
            // 画质里不留的也照样把它的数取完：后面的屋子摆在哪才不跟着变
            const built = keep() < houseKeep;
            const wt = HOUSE_WALLS[Math.floor(rnd() * HOUSE_WALLS.length)];
            const grey = 0.9 + rnd() * 0.2;
            const home: Home = { x: xc, z: zc, fx: ax + dx * tc, fz: az + dz * tc, dx, dz, ry, L, Dp: 19 + rnd() * 5, wallH: 10.5 + rnd() * 3, roofH: 8.5 + rnd() * 3, wall: wt, grey, lane: laneIndex, built, back: null };
            if (rnd() < 0.3) {
              // 屋后再接一间横着的小屋（屋后就是城墙脚、大街或院落的不接）
              const l2 = 18 + rnd() * 8;
              const off = (rnd() - 0.5) * (L - 16);
              const hx = xc + dx * off + -dz * side * 30;
              const hz = zc + dz * off + dx * side * 30;
              if (!blockedAt(hx, hz, dx, dz, 30)) home.back = { x: hx, z: hz, len: l2 };
            } else if (rnd() < 0.45) {
              // 屋后留一块空地，种树用
              const off = (rnd() - 0.5) * L;
              const back = 30 + rnd() * 16;
              const lx = xc + dx * off + -dz * side * back;
              const lz = zc + dz * off + dx * side * back;
              if (built && !blockedAt(lx, lz, dx, dz, 22)) {
                const lot: Lot = { x: lx, z: lz, y: g };
                pass.lots.push(lot);
                backLots.push({ lot, home: homes.length, foot: [ax + dx * (tc + off), az + dz * (tc + off)] });
              }
            }
            homes.push(home);
          }
          t += L + (5 + rnd() * 9);
        }
      }
    }
  }
  // 远了留哪几座：院落也放大了，要让开它放大以后占的那一块；屋子放大了，离顺着巷子的大街也要远一些
  const grow = Math.max(1, pass.ctx.style.figure.rules.cityHouse.maxTimes);
  const grownYards = pass.yards.map(grownYard);
  const rank = rankHomes(pass, ruleId, homes, seed, (x, z, dx, dz) => !blockedAt(x, z, dx, dz, 30 * grow, grownYards));
  for (const { lot, home, foot } of backLots) lot.follow = { cls: 'cityHouse', group: foot, rank: rank[home] };
  addHomes(B, homes, rank, () => g, () => false);
}

/** 一块地方里散着摆的民居（不排街巷，或者这块地方没有巷子）。 */
function housesScattered(pass: Pass, B: Batch, ruleId: string, area: Vec2[], wall: WallSite | undefined, seed: number, density: number): void {
  const rnd = mulberry32(seed);
  const keep = mulberry32(seed ^ 0x5bd1e995);
  const xs = area.map((p) => p[0]);
  const zs = area.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const z0 = Math.min(...zs);
  const z1 = Math.max(...zs);
  // 大约 70 米见方一座
  const want = Math.min(1500, Math.round((density * (x1 - x0) * (z1 - z0)) / 4900));
  const homes: Home[] = [];
  const heights: number[] = [];
  const backLots: { lot: Lot; home: number }[] = [];
  for (let tries = 0; tries < want * 8 && homes.length < want; tries++) {
    const x = x0 + rnd() * (x1 - x0);
    const z = z0 + rnd() * (z1 - z0);
    if (!insidePolygon(area, x, z)) continue;
    if (wall && ringDistance(wall.ring, x, z) > -70) continue;
    if (!wall && pass.ctx.samplers.edge(x, z) < 30) continue;
    if (pass.yards.some((y) => inYard(y, x, z, 40))) continue;
    if (homes.some((p) => Math.hypot(p.x - x, p.z - z) < 52)) continue;
    const built = keep() < pass.ctx.quality.houseKeep;
    const wt = HOUSE_WALLS[Math.floor(rnd() * HOUSE_WALLS.length)];
    const grey = 0.9 + rnd() * 0.2;
    const ry = (rnd() < 0.5 ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.3;
    const y = wall ? wall.groundY : groundY(pass, x, z) - 1;
    homes.push({ x, z, fx: x, fz: z, dx: Math.cos(ry), dz: -Math.sin(ry), ry, L: 30 + rnd() * 30, Dp: 19 + rnd() * 5, wallH: 10.5 + rnd() * 3, roofH: 8.5 + rnd() * 3, wall: wt, grey, lane: 0, built, back: null });
    heights.push(y);
    if (wall && rnd() < 0.4) {
      const lot: Lot = { x: x + (rnd() - 0.5) * 60, z: z + 34 + rnd() * 12, y };
      if (built) {
        pass.lots.push(lot);
        backLots.push({ lot, home: homes.length - 1 });
      }
    }
  }
  const grownYards = pass.yards.map(grownYard);
  const rank = rankHomes(pass, ruleId, homes, seed, (x, z) => !grownYards.some((y) => inYard(y, x, z, 40)), true);
  for (const { lot, home } of backLots) lot.follow = { cls: 'cityHouse', group: [homes[home].x, homes[home].z], rank: rank[home] };
  addHomes(B, homes, rank, (h) => heights[homes.indexOf(h)], (h) => !wall && wetAt(pass, h.x, h.z));
}

/** 成片的民居：瓦顶。写了 inside 是一道城墙里面；lanes 写了 true 就沿着地面给的小巷排，不写、或者没有巷子就散着摆。 */
function buildHouses(pass: Pass, rule: SceneDressing): void {
  const p = dressingParams('houses', rule.params);
  const B = pass.bucket(rule.when).main;
  const seed = p.seed ?? 10770821;
  const density = clamp(p.density ?? 1, 0, 3);
  const wall = rule.inside ? pass.survey.walls.get(rule.inside) : undefined;
  if (wall && wall.city && p.lanes === true && wall.city.lanes.some((l) => l.length >= 2)) {
    housesAlongLanes(pass, B, rule.id, wall, wall.city, seed, density);
    return;
  }
  const area = wall ? wall.ring.pts : rule.area?.map((q) => local(pass, q));
  if (area && area.length >= 3) housesScattered(pass, B, rule.id, area, wall, seed, density);
}

// ---------------------------------------------------------------- 村子

/**
 * 村子：茅草顶的几间屋。村子摆在哪由地面定（ground.villages），这里只管在每个村子里摆屋。
 * 远了屋子放大、从村子的中心往外摊开，去掉一些：每个村子都从自己的最后几间去起，不会哪一个村子先整个没了。
 */
function buildVillages(pass: Pass, rule: SceneDressing): void {
  const { ground, scene } = pass.ctx;
  const B = pass.bucket(rule.when).main;
  // 写了一块地方的规则管那块地方里的村子；没写的管剩下的
  const areas = scene.dressing.filter((d) => d.kind === 'villages' && d.area).map((d) => (d.area ?? []).map((q) => local(pass, q)));
  const own = rule.area ? rule.area.map((q) => local(pass, q)) : null;
  const mine = ground.villages.filter((v) => (own ? insidePolygon(own, v.x, v.z) : !areas.some((a) => insidePolygon(a, v.x, v.z))));
  const homes: { x: number; y: number; z: number; ry: number; L: number; Dp: number; grey: number; centre: Vec2; turn: number }[] = [];
  mine.forEach((v, vi) => {
    const r2 = mulberry32(v.seed);
    for (let k = 0; k < v.n; k++) {
      const a = r2() * 6.28;
      const d = 20 + r2() * 130;
      const x = v.x + Math.cos(a) * d;
      const z = v.z + Math.sin(a) * d * 0.7;
      const ry = (r2() < 0.5 ? 0 : Math.PI / 2) + (r2() - 0.5) * 0.4;
      const grey = 0.92 + r2() * 0.16;
      // turn：这一间在自己村子里排第几成，各个村子轮着来
      homes.push({ x, y: groundY(pass, x, z) - 1, z, ry, L: 26 + r2() * 16, Dp: 16 + r2() * 4, grey, centre: [v.x, v.z], turn: (k + 0.5) / v.n + vi * 1e-6 });
    }
  });
  const rank = rankOf(
    pass.ctx,
    rule.id,
    0,
    homes.map((h): Vec2 => [h.x, h.z]),
    homes.map((h) => h.turn),
  );
  homes.forEach((h, i) => {
    B.tagged({ pivot: [h.x, h.y, h.z], group: [h.centre[0], h.y, h.centre[1]], cls: 'village', rank: rank[i], wet: wetAt(pass, h.x, h.z) }, () =>
      addHouse(B, h.x, h.y, h.z, h.ry, h.L, h.Dp, 8.5, 9, [1, 0.98, 0.94], [h.grey, h.grey, h.grey], true),
    );
  });
}

// ---------------------------------------------------------------- 船

/** 系着的船：一条船连同它旁边的空占多长；两组船之间至少空多长。米。 */
export const MOORED_SLOT_M = 34;
export const MOORED_GAP_M = 70;

/** 离这一点最近的那一段河往哪边流（长度为 1）。沙盘上没有河就朝东。 */
function riverDirection(pass: Pass, x: number, z: number): Vec2 {
  let best = Infinity;
  let dir: Vec2 = [1, 0];
  for (const line of Object.values(pass.ctx.ground.rivers)) {
    for (let i = 0; i < line.length - 1; i++) {
      const d = lineDistance([line[i], line[i + 1]], x, z);
      if (d < best) {
        const dx = line[i + 1][0] - line[i][0];
        const dz = line[i + 1][1] - line[i][1];
        const len = Math.hypot(dx, dz);
        if (len > 0) {
          best = d;
          dir = [dx / len, dz / len];
        }
      }
    }
  }
  return dir;
}

/** 这一点是不是正对着一座城门：城门外 300 米以内、门的中线左右各 70 米。 */
function facesGate(pass: Pass, x: number, z: number): boolean {
  for (const gate of pass.survey.gates.values()) {
    const side = gate.wall.ring.sides[gate.side];
    const cx = side.mid[0] + side.ax[0] * gate.u;
    const cz = side.mid[1] + side.ax[1] * gate.u;
    const along = (x - cx) * side.ax[0] + (z - cz) * side.ax[1];
    const out = (x - cx) * side.out[0] + (z - cz) * side.out[1];
    if (Math.abs(along) < 70 && out > 0 && out < 300) return true;
  }
  return false;
}

/** 系着的船，船头离城门城台的正面至少留这么多米。 */
const GATE_FRONT_ROOM_M = 3;
/** 船的中线离城台的墙脚（比台顶左右各宽 4 米）不到这么多米，算是挨着城台：船身半边宽 8 米，船头再偏一点。 */
const GATE_SIDE_ROOM_M = 4 + 12;

/**
 * 系着的船贴着墙摆，城门的城台却比墙面突出十几米：挨着城台的那一条，船头会扎进城台里。
 * 这样的船顺着“朝城外”的方向往外挪一点，让船头离城台的正面留出空；不挨着城台的原地不动。
 * 只看和这条规则同在一节里的城门（改筑以后的东门比原来的大，大水那一节还没有它）。hullHalf 是船身的一半长。
 */
function clearOfGates(pass: Pass, rule: SceneDressing, x: number, z: number, hullHalf: number): Vec2 {
  const { scene } = pass.ctx;
  const headings = scene.sections.map((s) => s.heading);
  let push = 0;
  let dir: Vec2 = [0, 0];
  for (const gate of pass.survey.gates.values()) {
    const when = scene.things.find((t) => t.id === gate.id)?.when;
    if (!headings.some((h) => existsAt(rule.when, h, headings) && existsAt(when, h, headings))) continue;
    const side = gate.wall.ring.sides[gate.side];
    const cx = side.mid[0] + side.ax[0] * gate.u;
    const cz = side.mid[1] + side.ax[1] * gate.u;
    const along = (x - cx) * side.ax[0] + (z - cz) * side.ax[1];
    const out = (x - cx) * side.out[0] + (z - cz) * side.out[1];
    if (out <= 0 || Math.abs(along) >= gate.halfW + GATE_SIDE_ROOM_M) continue;
    // 城台的正面在墙的中线外 depth / 2；船头要在它外面
    const short = gate.depth / 2 + GATE_FRONT_ROOM_M + hullHalf - out;
    if (short > push) {
      push = short;
      dir = side.out;
    }
  }
  return [x + dir[0] * push, z + dir[1] * push];
}

/**
 * 船。沿一条线：系着的（moored，不写是系着）松松地分成几组，三到六条一组，组和组之间空出一大段；
 * 船身大致横对着线（线贴着城墙时就是船头朝着城墙），每组、每条各偏一点，不排成一把梯子；城门前面留出空；
 * 线上照这样摆不下 count 那么多条，就少摆。
 * 不系的顺着线一条一条散开。一个点周围：摆在那一圈里有水的地方，船身顺着最近的河，让开河里露着的石头；
 * 不系的（在走的船）彼此还要隔开放大到头时的一个船身——它们远了要放大给人看，挤在乱石中间就认不出是船了。
 * 船的高低不在这里定：总装时整组跟着水位走。远了每条船绕着自己吃水的那一点放大，一条也不去掉，也不挪地方
 * （数目和分组是依据里说了的）；所以最多放大几倍要看场景容不容得下，样式里的数由测试管着。
 */
function buildBoats(pass: Pass, rule: SceneDressing): void {
  const p = dressingParams('boats', rule.params);
  const small = p.type === 'small';
  const K = small ? 0.6 : 1;
  const rnd = mulberry32(p.seed ?? 1079);
  const boats: Instance[] = [];
  const n = Math.max(0, Math.round(p.count ?? (rule.line ? 24 : 4)));
  const y = -0.6 * K;
  // 船身（船自己的 x 轴）朝 (ux, uz) 时要转多少
  const heading = (ux: number, uz: number): number => Math.atan2(-uz, ux);

  if (rule.line) {
    const line = rule.line.map((q) => local(pass, q));
    const total = lineLength(line);
    if (line.length < 2 || total <= 0) return;
    if (p.moored ?? true) {
      // 线上能系船的几段：城门前面留出空
      const usable: Vec2[] = [];
      let open: number | null = null;
      for (let s = 0; s <= total; s += 5) {
        const at = pointAlong(line, s);
        const ok = !facesGate(pass, at.x, at.z);
        if (ok && open === null) open = s;
        if ((!ok || s + 5 > total) && open !== null) {
          usable.push([open, ok ? total : s - 5]);
          open = null;
        }
      }
      const room = usable.reduce((sum, [a, b]) => sum + (b - a), 0);
      /** 在能系船的几段上走了 u 米，是线上的哪里。 */
      const place = (u: number): number => {
        for (const [a, b] of usable) {
          if (u <= b - a) return a + u;
          u -= b - a;
        }
        return total;
      };
      // 一条船连同它旁边的空占 slot 米；两组之间至少空 minBetween 米（线短的时候按线长缩一点）
      const slot = MOORED_SLOT_M * K;
      const minBetween = Math.min(MOORED_GAP_M * K, room * 0.14);
      // 先分组：三到六条一组，分到线上摆不下为止。最后不剩下一两条单独成组：并进前一组，或者前一组让出几条
      const least = 3;
      const most = 6;
      const sizes: number[] = [];
      let used = 0;
      let left = n;
      while (left > 0) {
        let size = Math.min(left, least + Math.floor(rnd() * (most - least + 1)));
        const rest = left - size;
        if (rest > 0 && rest < least) size = size + rest <= most ? left : size - (least - rest);
        const need = size * slot + minBetween;
        if (used + need > room) break;
        sizes.push(size);
        used += need;
        left -= size;
      }
      // 剩下的地方不匀地分给各组之间的空
      const spare = room - used;
      const shares = sizes.map(() => 0.4 + rnd());
      const shareSum = shares.reduce((a, b) => a + b, 0) || 1;
      let u = 0;
      sizes.forEach((size, gi) => {
        const between = minBetween + (spare * shares[gi]) / shareSum;
        u += between / 2;
        // 这一组的船头一起往一边偏一点；一组里从这一头到那一头像扇子那样慢慢张开或收拢；每条再各偏一点、前后错开一点
        const lean = (rnd() - 0.5) * 0.7;
        const fan = (rnd() - 0.5) * 0.18;
        for (let i = 0; i < size; i++) {
          const at = pointAlong(line, place(u + slot / 2 + (rnd() - 0.5) * 6 * K));
          const j = (rnd() - 0.5) * 16 * K;
          const turn = lean + (i - (size - 1) / 2) * fan + (rnd() - 0.5) * 0.2;
          const [bx, bz] = clearOfGates(pass, rule, at.x - at.dz * j, at.z + at.dx * j, (BOAT_LENGTH_M / 2) * K);
          boats.push({ x: bx, y, z: bz, ry: heading(-at.dz, at.dx) + turn, s: K, cluster: gi });
          u += slot;
        }
        u += between / 2;
      });
    } else {
      for (let i = 0; i < n; i++) {
        const at = pointAlong(line, (total * (i + 0.5 + (rnd() - 0.5) * 0.5)) / n);
        const j = (rnd() - 0.5) * 30;
        boats.push({ x: at.x - at.dz * j, y, z: at.z + at.dx * j, ry: heading(at.dx, at.dz) + (rnd() - 0.5) * 0.3, s: K, cluster: i });
      }
    }
  } else if (rule.at) {
    const [cx, cz] = local(pass, rule.at);
    const radius = p.radiusM ?? 150;
    // 放大到头时船身多长、多宽（各一半）；河里的石头放大到头时各占多大一圈
    const grow = Math.max(1, pass.ctx.style.figure.rules[small ? 'smallBoat' : 'boat'].maxTimes);
    const halfLong = (BOAT_LENGTH_M / 2) * K * grow;
    const halfWide = (BOAT_BEAM_M / 2) * K * grow;
    const rocks = rocksBeside(pass, rule);
    const underWay = p.moored === false;
    const open: Instance[] = [];
    for (let tries = 0; tries < n * 200 && boats.length < n; tries++) {
      const a = rnd() * 6.28;
      const d = radius * Math.sqrt(rnd());
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      // 船身有几十米长，岸边的土坡又伸进水里一截：离岸不够远的地方不摆
      if (pass.ctx.samplers.edge(x, z) > -(10 + 16 * K)) continue;
      // 贴着城墙的土坡在墙角是方的，比地面的水边多伸出去一块：离坡脚不够远的地方也不摆
      if (bankFootGap(pass, x, z) < 10 + 16 * K) continue;
      if (boats.some((q) => Math.hypot(q.x - x, q.z - z) < 26 * K)) continue;
      const dir = riverDirection(pass, x, z);
      // 船身放大到头时压着哪块石头（离石头不到 3 米）的地方不摆
      const onRock = rocks.some((rock) => {
        const along = Math.abs((rock.x - x) * dir[0] + (rock.z - z) * dir[1]);
        const across = Math.abs((rock.x - x) * dir[1] - (rock.z - z) * dir[0]);
        return Math.hypot(Math.max(0, along - halfLong), Math.max(0, across - halfWide)) < rock.r + 3;
      });
      if (onRock) continue;
      // 在走的船：摆得下的地方先都记下来，下面再挑
      if (underWay) {
        open.push({ x, y, z, ry: heading(dir[0], dir[1]) + (rnd() - 0.5) * 0.2, s: K, cluster: 0 });
        continue;
      }
      // 船身都顺着河：和已经摆下的哪一条船身叠在一起的也不摆（前后、左右各留 4 米）
      const overlaps = boats.some((q) => {
        const along = (q.x - x) * dir[0] + (q.z - z) * dir[1];
        const across = (q.x - x) * dir[1] - (q.z - z) * dir[0];
        return Math.abs(along) < BOAT_LENGTH_M * K + 4 && Math.abs(across) < BOAT_BEAM_M * K + 4;
      });
      if (overlaps) continue;
      boats.push({ x, y, z, ry: heading(dir[0], dir[1]) + (rnd() - 0.5) * 0.2, s: K, cluster: 0 });
    }
    // 在走的船挑离得最远的几处：先取离得最远的两处，再一处一处添“离已经挑了的最远”的。
    // 乱石中间那一线水路很窄，随手摆的两条常常挨在一起，远了放大以后首尾相接成一道；挑开了，远近都看得出是一前一后的两条
    if (underWay && open.length > 0) {
      const apart = (p: Instance, q: Instance): number => Math.hypot(p.x - q.x, p.z - q.z);
      let first = 0;
      let second = 0;
      for (let i = 0; i < open.length; i++) for (let j = i + 1; j < open.length; j++) if (apart(open[i], open[j]) > apart(open[first], open[second])) [first, second] = [i, j];
      boats.push(open[first]);
      if (n > 1 && second !== first) boats.push(open[second]);
      while (boats.length < n) {
        let best: Instance | null = null;
        let room = 0;
        for (const spot of open) {
          const nearest = Math.min(...boats.map((q) => apart(spot, q)));
          if (nearest > room) [best, room] = [spot, nearest];
        }
        // 剩下的地方和已经摆下的船身叠在一起了（放大到头时的船身，前后、左右各留 4 米）：不再添
        if (!best || room < BOAT_LENGTH_M * K * grow + 4) break;
        boats.push(best);
      }
    }
  }
  // 每条船的记号：绕着船身正中吃水的那一点放大（它自己的坐标里比原点高 0.6：原点沉在水面下 0.6）
  const cls: FigureClass = small ? 'smallBoat' : 'boat';
  const rank = rankOf(
    pass.ctx,
    rule.id,
    p.seed ?? 1079,
    boats.map((b): Vec2 => [b.x, b.z]),
  );
  const out = pass.bucket(rule.when).boats;
  boats.forEach((b, i) => out.push({ ...b, rule: rule.id, figure: { cls, rank: rank[i], pivot: [0, 0.6, 0] } }));
}

// ---------------------------------------------------------------- 露着的石头

/** 一块石头：摆在哪、什么样。 */
export interface Rock {
  mat: 'rock' | 'rockPale';
  shape: [number, number];
  foot: Vec3;
  ry: number;
  size: Vec3;
  tint: Vec3 | null;
  detail: boolean;
}

/** 一条石头的规则摆出来的每块石头在哪、什么样（只算，不造）。造石头和往石头中间摆船用的是同一份。 */
function layRocks(pass: Pass, rule: SceneDressing): Rock[] {
  if (!rule.at) return [];
  const p = dressingParams('rocks', rule.params);
  // 按家分块的那几种石头（崖脚的石头）：摆法跟着那一家的程序来
  const family = pass.ctx.kit?.rocks?.[p.type ?? ''];
  if (family) return family(pass, rule);
  if (p.type === 'shore') throw new Error('零件库里没有 shore 这种石头的摆法：它那一家的程序没有取到');
  const { coords, samplers, scene } = pass.ctx;
  const rnd = mulberry32(p.seed ?? 1078);
  const [bx, bz] = local(pass, rule.at);
  const inDisc = (r: number): Vec2 => {
    const a = rnd() * 6.28;
    const d = r * Math.sqrt(rnd());
    return [bx + Math.cos(a) * d, bz + Math.sin(a) * d];
  };
  const rocks: Rock[] = [];
  if (p.type === 'pale') {
    const radius = p.radiusM ?? 150;
    const n = Math.round(p.count ?? 46);
    for (let i = 0; i < n; i++) {
      const [x, z] = inDisc(radius);
      const s = 6 + rnd() * 9;
      rocks.push({ mat: 'rockPale', shape: [i + 100, 0], foot: [x, groundY(pass, x, z) - 1, z], ry: rnd() * 6.28, size: [s * 1.4, s, s], tint: null, detail: false });
    }
  } else {
    const radius = p.radiusM ?? 260;
    const count = Math.round(p.count ?? 54);
    const wy = coords.y(scene.water.levels.values.normal ?? pass.ctx.ground.baseM);
    for (let i = 0; i < count; i++) {
      const [x, z] = inDisc(radius);
      if (samplers.edge(x, z) > -10) continue;
      const s = 10 + rnd() * rnd() * 30;
      const ry = rnd() * 6.28;
      const sy = s * (0.7 + rnd() * 0.5);
      const sz = s * (0.7 + rnd() * 0.6);
      rocks.push({ mat: 'rock', shape: [i + 1, 1], foot: [x, wy - 1.5, z], ry, size: [s, sy, sz], tint: null, detail: false });
    }
    // 两岸的青石
    const want = Math.round(count * 0.3);
    let placed = 0;
    for (let tries = 0; tries < want * 12 && placed < want; tries++) {
      const [x, z] = inDisc(radius * 1.15);
      const e = samplers.edge(x, z);
      if (e < 14 || e > 44) continue;
      const s = 12 + rnd() * 16;
      rocks.push({ mat: 'rock', shape: [placed + 60, 1], foot: [x, groundY(pass, x, z) - 1, z], ry: rnd() * 6.28, size: [s, s * 0.8, s], tint: [1.08, 1.08, 1.08], detail: true });
      placed++;
    }
  }
  return rocks;
}

/** 河里露着的石头的形状最宽出到它大小的这么多倍（shapes.ts 的 rockGeo）。 */
const ROCK_REACH = 1.15;

/**
 * 和这条船的规则同在一节里的、河里露着的石头：各在哪，放大到头时占多大一圈（半径）。
 * 两岸添的那几块和山冈上的白石头不算（船到不了那里）。
 */
function rocksBeside(pass: Pass, rule: SceneDressing): { x: number; z: number; r: number }[] {
  const { scene, style } = pass.ctx;
  const headings = scene.sections.map((sec) => sec.heading);
  const grow = Math.max(1, style.figure.rules.rock.maxTimes);
  const out: { x: number; z: number; r: number }[] = [];
  for (const other of scene.dressing) {
    if (other.kind !== 'rocks' || !headings.some((h) => existsAt(rule.when, h, headings) && existsAt(other.when, h, headings))) continue;
    for (const rock of layRocks(pass, other)) {
      if (rock.mat === 'rock' && !rock.detail) out.push({ x: rock.foot[0], z: rock.foot[2], r: Math.max(rock.size[0], rock.size[2]) * ROCK_REACH * grow });
    }
  }
  return out;
}

/**
 * 露着的石头，摆在一个点周围。grey 是河里的青石（急滩的乱石）：只摆在有水的地方，露出平时的水面；两岸再添几块（细处，远了收掉）。
 * pale 是山冈上的白石头（“如群羊”）。远了每块石头绕着自己的脚放大，一块也不去掉。
 */
function buildRocks(pass: Pass, rule: SceneDressing): void {
  const p = dressingParams('rocks', rule.params);
  const B = pass.bucket(rule.when).main;
  const rocks = layRocks(pass, rule);
  // 这堆石头要是挨着一座小建筑，就跟着那一组放大
  const joined = joinedTo(pass, rule.id);
  const rank = rankOf(
    pass.ctx,
    rule.id,
    p.seed ?? 1078,
    rocks.map((r): Vec2 => [r.foot[0], r.foot[2]]),
  );
  rocks.forEach((r, i) => {
    B.tagged({ pivot: r.foot, group: joined ? groupPoint(pass, joined, r.foot, 1) : r.foot, cls: joined ? joined.cls : 'rock', rank: rank[i], detail: r.detail }, () =>
      B.add(r.mat, rockGeo(r.shape[0], r.shape[1]), T(r.foot[0], r.foot[1], r.foot[2], r.ry, r.size[0], r.size[1], r.size[2]), r.tint),
    );
  });
}

/** 这一种点缀不在这里造模型。 */
const nothing: DressingBuilder = () => {};

/** 七种点缀，一种一个造法。 */
export const DRESSING_BUILDERS: Record<DressingKind, DressingBuilder> = {
  houses: buildHouses,
  villages: buildVillages,
  /** 田画在地面上。 */
  fields: nothing,
  /** 树不在这里造：见 trees.ts，总装时按规则什么时候有分到各组里。 */
  trees: nothing,
  boats: buildBoats,
  rocks: buildRocks,
  /** 路画在地面上。 */
  roads: nothing,
};

// 造模型时，各个零件手里拿到的东西。整套模型只造一遍：近看的样子、本来的大小和位置；远了怎么变由显卡照每样东西的记号算。
// 零件不直接往场景里放网格：它把形状放进“这样东西什么时候有”对应的那一组，总装的时候一组并成几个网格。
// 这里还有几样零件都要用的小事：一样东西跟着哪一组放大、它站的地方水漫不漫得到、一条规则摆出来的东西谁先去掉。

import type { LngLat } from '../../../domain/types';
import type { SceneThing, When } from '../../../domain/scene';
import { stripPoint } from '../../../domain/sceneStripPoint';
import type { Vec2, Vec3 } from '../../ground/types';
import type { FigureClass, KitContext } from '../internal';
import { figureGroups } from './figure';
import type { Batch } from './geo';
import type { Instance } from './shapes';
import { insideRing } from './site';
import type { Survey, Yard } from './site';
import { mulberry32 } from './util';

/** 同一些小节里有的东西归成一组。 */
export interface Bucket {
  /** 一般的零件。 */
  main: Batch;
  /** 城墙、城门这些：远了整体拔高（总装时这一组竖向乘城墙这一类的倍数）。 */
  raised: Batch;
  /** 船：y 写的是比水面高多少，总装时整组跟着水位走。 */
  boats: Instance[];
  /**
   * 照镜头远近换着显的东西（浮桥：近了船小而多，远了船大而少）。一项是一样东西的几套样子：第 k 套从折算过的远近 fromM[k] 起显，
   * 到 fromM[k + 1] 为止（fromM 从小到大，第一个是 0）。几套都只造一遍，总装时各并成自己的网格，apply 每一帧只开关它们（见 assemble.ts）。
   */
  steps?: { fromM: number[]; batches: Batch[] }[];
}

/** 城里一块可以种树的空地。 */
export interface Lot {
  x: number;
  z: number;
  /** 地面在沙盘里的高度。 */
  y: number;
  /**
   * 这块空地是谁家的：屋后的空地跟着那座屋（同一类、同一个次序，从巷子上正对着它的那一点摊开），院子里的跟着院落。
   * 远了屋子放大、摊开、去掉一些，空地上的树跟着它那座屋一起：屋在树在，屋去树去，树一直在屋后，不会被放大的屋顶盖住，
   * 城里也不会只剩屋没有树。group 是从哪一点摊开（沙盘里的 x、z）。
   */
  follow?: { cls: FigureClass; group: Vec2; rank: number };
}

export interface Pass {
  ctx: KitContext;
  survey: Survey;
  /** 已经被院落占了的地。民居、树要让开。 */
  yards: Yard[];
  /** 城里留出来可以种树的空地。 */
  lots: Lot[];
  /** 这样东西该放进哪一组（按它的 when）。 */
  bucket(when: When | undefined): Bucket;
}

/** 经纬度换成沙盘里的 [x, z]。 */
export const local = (pass: Pass, p: LngLat): Vec2 => pass.ctx.coords.toLocal(p);

/** 沙盘里这一点的地面有多高（沙盘里的高度，已经乘了山高夸大的倍数）。 */
export const groundY = (pass: Pass, x: number, z: number): number => pass.ctx.coords.y(pass.ctx.samplers.height(x, z));

/**
 * 正面朝哪边换成绕竖轴转多少。facing：0 朝北，顺时针，度；不写是朝南。
 * 零件自己的坐标里正面是 +z（朝南），所以朝南是不转。
 */
export const facingRy = (facing: number | undefined): number => (facing === undefined ? 0 : Math.PI - (facing * Math.PI) / 180);

// ---------------------------------------------------------------- 脚在哪，水漫不漫得到

/**
 * 立在地上的单座的屋、亭、一组院落的脚在哪（沙盘里的 x、y、z）：模型绕着这一点放大，挨着它的东西从这一点摊开。
 * 屋比地面低 1，亭和坟低 2（埋进土里一点，不悬空）；院落在城里是城里的地面，在城外是院子正中的地面低 1。别的摆件是 null。
 */
export function footOf(pass: Pass, thing: SceneThing): Vec3 | null {
  if (!thing.at) return null;
  const [x, z] = local(pass, thing.at);
  if (thing.kind === 'house') return [x, groundY(pass, x, z) - 1, z];
  if (thing.kind === 'pavilion' || thing.kind === 'grave-mound') return [x, groundY(pass, x, z) - 2, z];
  if (thing.kind === 'hall-group') {
    const city = [...pass.survey.walls.values()].find((w) => insideRing(w.ring, x, z));
    return [x, city ? city.groundY : groundY(pass, x, z) - 1, z];
  }
  return null;
}

/** 这一点水漫不漫得到：闭合的城墙里面、场景里写了水漫不进去的地方（ground.dry）漫不到，别处都可能。 */
export function wetAt(pass: Pass, x: number, z: number): boolean {
  const { ground } = pass.ctx;
  const i = Math.round((x - ground.x0) / ground.cell);
  const j = Math.round((z - ground.z0) / ground.cell);
  if (i < 0 || i >= ground.nx || j < 0 || j >= ground.nz) return false;
  return ground.dry[j * ground.nx + i] !== 1;
}

// ---------------------------------------------------------------- 跟着哪一组放大

/** 一样东西跟着哪一组放大：那一组的类，整组绕着放大的那一点（主角的脚）；main 是它自己就是主角。 */
export interface Joined {
  cls: FigureClass;
  foot: Vec3;
  main: boolean;
}

const joinedByPass = new WeakMap<Pass, Map<string, Joined>>();

/**
 * id 这样东西（摆件，或者一条点状的点缀）跟着哪一组放大。不在哪一组是 null。
 * 分组只有一个算法（figure.ts 的 figureGroups），题签那一边用的也是它：单座的小建筑和挨着它的东西像一件小摆设，整组放大。
 */
export function joinedTo(pass: Pass, id: string): Joined | null {
  let map = joinedByPass.get(pass);
  if (!map) {
    map = new Map();
    const { scene, style } = pass.ctx;
    for (const g of figureGroups(scene, style)) {
      const main = scene.things.find((t) => t.id === g.main);
      const foot = main ? footOf(pass, main) : null;
      if (!foot) continue;
      map.set(g.main, { cls: g.cls, foot, main: true });
      for (const member of g.members) map.set(member, { cls: g.cls, foot, main: false });
    }
    joinedByPass.set(pass, map);
  }
  return map.get(id) ?? null;
}

/**
 * 跟着一座小建筑整组放大的东西（亭下的小屋、屋旁的果树），它“从哪一点摊开”要写成什么：横竖是主角的脚，高度另算。
 * 整组照一个比例摊开时，它的脚按“主角的脚到它的脚”这条斜线往外走；山坡不是一条直线（亭子下面先陡后缓），
 * 走远了不是埋进土里就是悬在半空。所以高度这样定：摊开到头时，它的脚正好落在那里的地面上（再埋 sink 这么深）；
 * 中间按比例走。foot 是它自己的脚（本来的位置），sink 是它的脚比地面低多少。
 */
export function groupPoint(pass: Pass, joined: Joined, foot: Vec3, sink: number): Vec3 {
  const spread = pass.ctx.style.figure.rules[joined.cls].spreadAtMax ?? 1;
  const [gx, , gz] = joined.foot;
  if (!(spread > 1)) return [gx, joined.foot[1], gz];
  const x = gx + (foot[0] - gx) * spread;
  const z = gz + (foot[2] - gz) * spread;
  const landed = groundY(pass, x, z) - sink;
  return [gx, foot[1] - (landed - foot[1]) / (spread - 1), gz];
}

// ---------------------------------------------------------------- 次序

/**
 * 一条点缀规则摆出来的 n 样东西，远了谁先去掉：返回每一样的次序（0 到 1，不含 1；小的留到最后）。
 * 先打乱（用自己的一串随机数，不动东西摆在哪），第几个除以总数就是次序。
 * 有题签指着这条规则时，离题签那一点最近的一样排第一：次序是 0，留几成都去不掉它，题签不会指着空地。
 * order 写了就不打乱，照它给的先后排（值小的在前）。
 */
export function rankOf(ctx: KitContext, ruleId: string, seed: number, points: Vec2[], order?: number[]): number[] {
  const n = points.length;
  const index = points.map((_, i) => i);
  if (order) {
    index.sort((a, b) => order[a] - order[b] || a - b);
  } else {
    const rnd = mulberry32((seed ^ 0x2545f491) >>> 0);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [index[i], index[j]] = [index[j], index[i]];
    }
  }
  const to = pointedAt(ctx, ruleId);
  if (to && n > 0) {
    let best = 0;
    for (let k = 1; k < n; k++) {
      const a = points[index[k]];
      const b = points[index[best]];
      if (Math.hypot(a[0] - to[0], a[1] - to[1]) < Math.hypot(b[0] - to[0], b[1] - to[1])) best = k;
    }
    const [first] = index.splice(best, 1);
    index.unshift(first);
  }
  const rank = new Array<number>(n).fill(0);
  index.forEach((i, position) => {
    rank[i] = position / n;
  });
  return rank;
}

/** 指着 id 这样东西的题签落在沙盘里的哪一点；没有题签指着它是 null。 */
export function pointedAt(ctx: KitContext, id: string): Vec2 | null {
  const { scene, coords } = ctx;
  const strip = scene.strips.find((s) => s.of === id);
  if (!strip) return null;
  try {
    return coords.toLocal(stripPoint(scene, strip));
  } catch {
    // 题签没写 at、指的又不是一个点的东西：校验规则管这个，这里只当没有题签
    return null;
  }
}

// 模型跟着镜头远近怎么变：只算数的那一部分。不碰 three，也不碰页面，在 Node 里也能跑。
// 零件库（造模型）和镜头（题签抬多高、指着哪里）都从这里取，两边才对得上。每一类的数在样式里（style.figure）。
//
// 这里有四样：
//   折算过的远近 D 怎么算（equivalentDistance）；
//   一类东西在 D 这么远时放大几倍、留几成、摊开几倍（figureNow），细处收掉多少，细做的树还剩多少；
//   一样摆件算哪一类（liftClass）；
//   哪几样东西挨着一座单座的小建筑、跟着它整组放大（figureGroups）。

import type { SceneThing, StopScene, ThingKind, When } from '../../../domain/scene';
import { frameCoords } from '../../../domain/sceneGeo';
import { thingParams } from '../../../domain/sceneParams';
import { existsAt, sectionHeadings } from '../../../domain/sceneText';
import type { LngLat } from '../../../domain/types';
import { yardLayout } from '../../ground';
import { smoothstep } from '../../ground/num';
import type { Vec2 } from '../../ground/types';
import type { FigureClass, FigureRule, StageStyle } from '../internal';

// ---------------------------------------------------------------- 折算过的远近

/** 900 像素高、视角 21 度的画面上，离镜头 1 米远、1 米宽的东西是多少像素（900 ÷ 2 ÷ tan(10.5°)）。 */
const REFERENCE_FOCAL_PX = 2428;

/** 折算过的远近 D = distanceM × 2428 ÷ (viewHeightPx ÷ 2 ÷ tan(fovDeg ÷ 2))。 */
export function equivalentDistance(distanceM: number, fovDeg: number, viewHeightPx: number): number {
  const focal = Math.max(1, viewHeightPx) / 2 / Math.tan((fovDeg * Math.PI) / 360);
  return (distanceM * REFERENCE_FOCAL_PX) / focal;
}

// ---------------------------------------------------------------- 放大几倍、留几成、摊开几倍

/** ln(1 + e^x)，x 很大时就是 x（免得 e^x 算爆）。 */
function softplus(x: number): number {
  return x > 30 ? x : Math.log1p(Math.exp(x));
}

/**
 * 从 0 平滑地升到 1：u 在 0 以下差不多是 0，在 1 以上差不多是 1，中间差不多是 u 自己，两头的拐弯是圆的。
 * sat(u) = (softplus(12u) − softplus(12(u − 1))) ÷ 12。
 */
export function sat(u: number): number {
  return (softplus(12 * u) - softplus(12 * (u - 1))) / 12;
}

/**
 * 这一类东西在 D 这么远时：放大几倍、留几成、摊开几倍。
 * 比 holdFromM 近是本来的大小；从那里往外，它在画面上不再变小，一直到放大了 maxTimes 倍；再远又跟着变小。
 * 走到这一段的几成（0 到 1）是 sat(ln(D ÷ holdFromM) ÷ ln(maxTimes))；三个数都是“到头时的数”的这么多次方，
 * 所以三样一起变，中间没有哪一处是跳的。倍数涨得总比 D 慢：镜头往后退，东西在画面上只会变小或者不变，不会变大。
 * 写得不对的规则（maxTimes 不比 1 大、holdFromM 或者 D 不是正数）当作“什么都不变”；D 大得没有边就是走到了头。
 */
export function figureNow(rule: FigureRule, D: number): { times: number; keep: number; spread: number } {
  if (!(rule.maxTimes > 1) || !(rule.holdFromM > 0) || !(D > 0)) return { times: 1, keep: 1, spread: 1 };
  // 封一个顶：D 是无穷大时 sat 里是“无穷大减无穷大”，算不出数
  const way = sat(Math.min(1e6, Math.log(D / rule.holdFromM) / Math.log(rule.maxTimes)));
  return {
    times: Math.pow(rule.maxTimes, way),
    keep: Math.pow(rule.keepAtMax ?? 1, way),
    spread: Math.pow(rule.spreadAtMax ?? 1, way),
  };
}

/** cls 这一类在 D 这么远时放大几倍。 */
export function figureTimes(style: StageStyle, cls: FigureClass, D: number): number {
  return figureNow(style.figure.rules[cls], D).times;
}

/** 从 near 到 far 匀着从 0 升到 1，两头是平的。far 不比 near 远时在 near 那里一步到头。 */
function fade([near, far]: [number, number], D: number): number {
  if (!(far > near)) return D < near ? 0 : 1;
  return smoothstep(near, far, D);
}

/** 0 是细处全在，1 是收完了。 */
export function detailGone(style: StageStyle, D: number): number {
  return fade(style.figure.detailFadeM, D);
}

/** 1 是细做的树全在，0 是都换回了苔点。 */
export function closeTrees(style: StageStyle, D: number): number {
  return 1 - fade(style.figure.closeTreesM, D);
}

// ---------------------------------------------------------------- 一样摆件算哪一类

/** 这样摆件摆在哪种东西上：城门、城墙，或者地上（null）。on 写的东西找不到时当作摆在地上，和零件库一样。 */
function hostKind(thing: SceneThing, scene: StopScene): ThingKind | null {
  if (!thing.on) return null;
  return scene.things.find((t) => t.id === thing.on)?.kind ?? null;
}

/** 这一点在不在哪一道城墙里面。经纬度直接比：换成米只是横竖各乘一个数，在不在圈里不变。 */
function insideAWall(at: LngLat, scene: StopScene): boolean {
  for (const wall of scene.things) {
    if (wall.kind !== 'wall' || !wall.line || wall.line.length < 3) continue;
    const ring = wall.line;
    let inside = false;
    // 从这一点往东画一条线，看它穿过圈的边几次：奇数次就在圈里
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > at[1] !== yj > at[1] && at[0] < ((xj - xi) * (at[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

/**
 * 题签抬高的每一环乘哪一类的倍数：wall、gate → wallH；tower → tower 或 wallTop；pavilion → wallTop 或 pavilion；
 * house → shed 或 hut；hall-group → yardCity 或 yardOut；dike、bank、timber-bank → null（不乘）。
 * 两样里取哪一样，看它摆在哪：楼在城门上、在地上是 tower，直接在城墙上（角楼）是 wallTop；亭和单座的屋在城墙上是
 * wallTop、shed，在地上是 pavilion、hut；院落在城墙里面是 yardCity，在外面是 yardOut。
 * 模型放大多少和题签抬多高要照同一类算，两边才对得上。
 * 挨着一座小建筑、跟着它整组放大的东西（见 figureGroups）用那一组的类，不用这里给的。
 */
export function liftClass(thing: SceneThing, scene: StopScene): FigureClass | null {
  switch (thing.kind) {
    case 'wall':
    case 'gate':
      return 'wallH';
    case 'tower':
      return hostKind(thing, scene) === 'wall' ? 'wallTop' : 'tower';
    case 'pavilion':
      return hostKind(thing, scene) === 'wall' ? 'wallTop' : 'pavilion';
    case 'house':
      return hostKind(thing, scene) === 'wall' ? 'shed' : 'hut';
    case 'hall-group':
      return thing.at && insideAWall(thing.at, scene) ? 'yardCity' : 'yardOut';
    case 'dike':
    case 'bank':
    case 'timber-bank':
    case 'cliff':
      return null;
  }
}

// ---------------------------------------------------------------- 整组放大的小建筑

export interface FigureGroup {
  /** 这一组的主角（单座的小建筑）的 id。 */
  main: string;
  /** 主角摆在哪。整组绕着它的脚放大。 */
  at: LngLat;
  cls: FigureClass;
  /** 跟着主角一起放大的东西的 id（摆件，或者点状的点缀）。 */
  members: string[];
}

/** 一座小建筑近看时占的那一块，在它自己的坐标里（正面是 +z）：左右各 halfX 米，往后到 back、往前到 front。 */
interface Plot {
  halfX: number;
  back: number;
  front: number;
}

/**
 * 立在地上的单座的屋、亭、一组院落近看时各占多大一块；别的摆件不当主角，是 null。
 * 数是照零件库里这几样模型的大小写的（kit/things.ts）：屋的顶宽 29、长 32 米，带篱笆的算到篱笆那一圈（宽 52、长 56）；
 * 亭的顶 42 米见方；院落是围墙那一圈（yardLayout）。那边改了大小，这里要跟着改。
 */
function plotOf(thing: SceneThing): Plot | null {
  if (thing.kind === 'house') {
    return thingParams('house', thing.params).fence ? { halfX: 26, back: -28, front: 28 } : { halfX: 14.5, back: -16, front: 16 };
  }
  if (thing.kind === 'pavilion') return { halfX: 21, back: -21, front: 21 };
  if (thing.kind === 'hall-group') {
    const yard = yardLayout(thingParams('hall-group', thing.params).halls ?? 2);
    return { halfX: yard.halfWidth, back: yard.back, front: yard.front };
  }
  return null;
}

/** 两样东西有没有哪一小节是同时在场的。都没写 when 就是一直都在。 */
function together(a: When | undefined, b: When | undefined, headings: string[]): boolean {
  if (a === undefined && b === undefined) return true;
  return headings.some((heading) => existsAt(a, heading, headings) && existsAt(b, heading, headings));
}

/**
 * 单座的小建筑和挨着它的东西各成一组。只看场景和样式，不看地面。
 *
 * 主角是立在地上的单座的屋、亭、一组院落（类是 hut、pavilion、yardCity、yardOut），按场景里写的先后。
 * 后面的摆件（有 at、立在地上的）和点状的点缀（写了 at 的），at 落在前面某个主角放大到头时占的那一块里面、
 * 又和它有同时在场的小节，就进那一组，跟着主角的类走：整组像一件小摆设，绕着主角的脚放大。
 * 进了别人那一组的摆件不再当主角。摆在城墙、城门上的东西不进组（它跟着墙走）。没有东西挨着的主角也算一组，members 是空的。
 * 不同时在场的不算挨着：放鹤亭后来盖在草屋旁边，草屋那时候已经没有了。
 */
export function figureGroups(scene: StopScene, style: StageStyle): FigureGroup[] {
  const coords = frameCoords(scene.frame);
  const headings = sectionHeadings(scene);
  const found: { group: FigureGroup; when: When | undefined; covers: (p: Vec2) => boolean }[] = [];
  /** at 这一点落在前面哪一组里。 */
  const hostFor = (at: LngLat, when: When | undefined): FigureGroup | undefined => {
    const p = coords.toLocal(at);
    return found.find((g) => g.covers(p) && together(g.when, when, headings))?.group;
  };

  for (const thing of scene.things) {
    if (!thing.at || hostKind(thing, scene) !== null) continue;
    const host = hostFor(thing.at, thing.when);
    if (host) {
      host.members.push(thing.id);
      continue;
    }
    const plot = plotOf(thing);
    const cls = liftClass(thing, scene);
    if (!plot || !cls) continue;
    const [x, z] = coords.toLocal(thing.at);
    // 正面朝哪边：0 朝北，顺时针，不写是朝南（和零件库的 facingRy、地面的 yardOf 一样）
    const f = ((thing.facing ?? 180) * Math.PI) / 180;
    const front: Vec2 = [Math.sin(f), -Math.cos(f)];
    const right: Vec2 = [front[1], -front[0]];
    const times = Math.max(1, style.figure.rules[cls].maxTimes);
    found.push({
      group: { main: thing.id, at: [thing.at[0], thing.at[1]], cls, members: [] },
      when: thing.when,
      covers: ([px, pz]) => {
        const across = ((px - x) * right[0] + (pz - z) * right[1]) / times;
        const along = ((px - x) * front[0] + (pz - z) * front[1]) / times;
        return Math.abs(across) <= plot.halfX && along >= plot.back && along <= plot.front;
      },
    });
  }
  for (const rule of scene.dressing) {
    if (!rule.at) continue;
    hostFor(rule.at, rule.when)?.members.push(rule.id);
  }
  return found.map((g) => g.group);
}

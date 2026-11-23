// 树。种在哪照样张（spikes/art-direction/b/scene/models.js 的 plantTrees），改成了照点缀规则种：
//   哪里都不写的规则：按样式的规矩种，山上成丛，村子四周，平地上零星几棵，城里的空地上；
//   写了线的：沿着线两边种（河边的柳）；写了点的：在那一点四周种几棵细做的；写了一块地方的：在里面散着种。
// 树只种一遍、只摆一套（每棵树是一个实例），远了近了、水涨水落都由显卡照每棵树的记号算（figureMaterial.ts）：
//   远了苔点放大、按次序去掉一些（每条规则各排各的次序）；水深过了树脚一米就开始缩，再深一米缩没；
//   镜头贴近的那一节，对准的那一点四周的苔点另有一棵细做的，两样此消彼长。
// 有三处不是“随手种”的：城里空地上的树跟着它那座屋、那个院落走（屋在树在，一直在屋后）；
//   一座屋四周的树种在两边和屋后，不种在门前；题签指着的小建筑，从那一节的镜头看过去，前面不种山上的杂树。
// 竹、柏这样细高的树是按家分块的（families.ts 的 TreeKind）：种法跟着那一家的程序来，种下去的还是苔点，只是细高，贴近了也不换成细做的。
// 规则写了 except 的（这几处修整的范围里不种），种下以后落在里面的去掉。
// 这里只算数和形状，不碰页面。

import * as THREE from 'three';
import type { SceneDressing } from '../../../domain/scene';
import type { Vec2, Vec3 } from '../../ground/types';
import type { FigureClass, KitContext } from '../internal';
import { figureGroups, liftClass } from './figure';
import type { TreeKind } from './families';
import { FIG_TREE, FIG_TREE_DOT, FIG_TREE_FINE } from './figureMaterial';
import type { TreeColours } from './materials';
import { dressingParams } from './params';
import { rankOf } from './pass';
import type { Lot } from './pass';
import { blobGeo, clumpGeo } from './shapes';
import type { Instance } from './shapes';
import { insidePolygon, ringDistance } from './site';
import type { Survey } from './site';
import { houseRy } from './things';
import { densify, fbm, lerp, mulberry32, smoothstep } from './util';

/** 一棵树。 */
export interface Tree {
  /** hill 山上的，bank 沿线的，village 村子四周的，lone 平地上零星的，city 城里的，grove 一块地方里的，spot 一个点四周细做的。 */
  kind: 'hill' | 'bank' | 'village' | 'lone' | 'city' | 'grove' | 'spot';
  x: number;
  y: number;
  z: number;
  /** 多大。苔点是米；细做的（spot）是倍数。 */
  s: number;
  /** 苔点竖向多大；细做的不写。 */
  sy?: number;
  ry: number;
  color: string;
  /** 水看到的这里的地面有多高（海拔，米）；水漫不进去的地方是无穷大。 */
  wet: number;
  /** 属于哪一条点缀规则（规则在 scene.dressing 里是第几条）。 */
  rule: number;
  /** 城里空地上的树：跟着哪座屋、哪个院落走（见 pass.ts 的 Lot）。 */
  follow?: Lot['follow'];
  /** 细高的树（竹、柏）：镜头贴近了也还是这粒苔点，不另长一棵细做的。 */
  slim?: boolean;
}

/** 树用的几个形状，各组的树共用：细做的一棵（五团叶子一根干），圆一点的苔点，最省的苔点。 */
export interface TreeShapes {
  clump: THREE.BufferGeometry;
  blob1: THREE.BufferGeometry;
  blob0: THREE.BufferGeometry;
}

export function treeShapes(): TreeShapes {
  return { clump: clumpGeo(1), blob1: blobGeo(1), blob0: blobGeo(0) };
}

/** 城四周这么远以内的苔点用圆一点的，再远用最省的。 */
const R_NEAR = 3000;
/** 镜头贴近的那一节，对准的那一点四周这么远以内的苔点另有一棵细做的。 */
const R_CLOSE = 620;
/** 水比树脚下的地面深过这么多米，树开始缩；再深这么多米，缩没了。 */
const DROWN_FROM_M = 1;
/** 水漫不到的树，“水面到多高它开始缩”写这个数（沙盘里的高度，水到不了这么高）。 */
export const NEVER_WET = 1e6;

type TreeType = 'mixed' | 'pine' | 'willow' | 'fruit' | 'bamboo' | 'cypress';
/** 沙盘程序自己会种的几种；别的是按家分块的。 */
const CORE_TYPES: readonly TreeType[] = ['mixed', 'pine', 'willow', 'fruit'];

/** 种树的人：知道地面、城墙在哪，种下的每一棵都记上水看到的地面有多高。 */
interface Planter {
  out: Tree[];
  /** 城墙四周（墙外 110 米以内，连同墙里面）和水边不种。 */
  okGround(x: number, z: number): boolean;
  /** 这一点的地面在沙盘里的高度。 */
  y(x: number, z: number): number;
  /** 这一种树用什么颜色。杂树从几种绿里挑。 */
  colour(type: TreeType, rnd: () => number): string;
  put(t: Omit<Tree, 'wet'>): void;
  /** 这一种要是细高的树（按家分块的）：它的种法。不是就没有。 */
  slim(type: TreeType): TreeKind | undefined;
  /** 在这一点种一处细高的树：一棵，或者一丛。 */
  putSlim(kind: Tree['kind'], rule: number, slim: TreeKind, x: number, z: number, rnd: () => number): void;
}

function makePlanter(ctx: KitContext, survey: Survey, colours: TreeColours): Planter {
  const { ground, samplers, coords } = ctx;
  const out: Tree[] = [];
  const planter: Planter = {
    out,
    okGround(x, z) {
      if (samplers.edge(x, z) <= 30) return false;
      for (const w of survey.walls.values()) if (ringDistance(w.ring, x, z) < 110) return false;
      return true;
    },
    y: (x, z) => coords.y(samplers.height(x, z)),
    colour(type, rnd) {
      const slim = ctx.kit?.trees?.[type];
      if (slim) return ctx.style.palette[slim.colour];
      if (type === 'pine') return colours.treeBlue;
      if (type === 'willow') return colours.willow;
      if (type === 'fruit') return colours.treeOlive;
      return [colours.tree, colours.tree, colours.treeBlue, colours.treeOlive][Math.floor(rnd() * 4)];
    },
    put(t) {
      const i = Math.round((t.x - ground.x0) / ground.cell);
      const j = Math.round((t.z - ground.z0) / ground.cell);
      const dry = i >= 0 && i < ground.nx && j >= 0 && j < ground.nz && ground.dry[j * ground.nx + i] === 1;
      out.push({ ...t, wet: dry ? Infinity : samplers.waterH(t.x, t.z) });
    },
    slim: (type) => ctx.kit?.trees?.[type],
    putSlim(kind, rule, slim, x, z, rnd) {
      const n = slim.clump ? slim.clump(rnd) : 1;
      const reach = n > 1 ? (slim.spreadM ?? 0) : 0;
      for (let k = 0; k < n; k++) {
        const a = rnd() * 6.28;
        const d = reach * Math.sqrt(rnd());
        const xx = x + Math.cos(a) * d;
        const zz = z + Math.sin(a) * d;
        const [s, sy] = slim.size(rnd);
        planter.put({ kind, rule, x: xx, y: planter.y(xx, zz) - 2, z: zz, s, sy, ry: rnd() * 6.28, color: ctx.style.palette[slim.colour], slim: true });
      }
    },
  };
  return planter;
}

/** 哪里都不写的规则：山上成丛的苔点，村子四周，平地上零星几棵。城里空地上的另算（见 cityTrees）。 */
function plantEverywhere(pl: Planter, ctx: KitContext, rule: number, type: TreeType, density: number, seed: number): void {
  const { coords, samplers, ground } = ctx;
  const rnd = mulberry32(seed);
  const pick = (): string => pl.colour(type, rnd);
  // 山上：山脚到山腰多
  let guard = 0;
  let nHill = 0;
  const wantHill = Math.round(1150 * density);
  while (nHill < wantHill && guard++ < 60000) {
    const x = lerp(coords.x0 + 60, coords.x1 - 60, rnd());
    const z = lerp(coords.z0 + 60, coords.z1 - 60, rnd());
    // 比平地高出多少：修整垫高的那一截不算山，不种山上的树
    const r = samplers.height(x, z) - samplers.lift(x, z) - ground.baseM;
    if (r < 3.5) continue;
    const dens = smoothstep(3.5, 9, r) * (1 - 0.75 * smoothstep(40, 95, r)) * (0.35 + 0.65 * smoothstep(0.42, 0.62, fbm(x / 260, z / 260, 3, 77)));
    if (rnd() > dens) continue;
    const n = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const xx = x + (rnd() - 0.5) * 70;
      const zz = z + (rnd() - 0.5) * 70;
      const s = 13 + rnd() * 12;
      pl.put({ kind: 'hill', rule, x: xx, y: pl.y(xx, zz) - 2, z: zz, s, sy: s * (0.8 + rnd() * 0.5), ry: rnd() * 6.28, color: type === 'mixed' && r > 45 ? pl.colour('pine', rnd) : pick() });
      nHill++;
    }
  }
  // 村子四周
  for (const v of ground.villages) {
    const r2 = mulberry32(v.seed + 9);
    for (let k = 0; k < 7 + v.n; k++) {
      const a = r2() * 6.28;
      const d = 60 + r2() * 190;
      const x = v.x + Math.cos(a) * d;
      const z = v.z + Math.sin(a) * d;
      const s = 14 + r2() * 10;
      pl.put({ kind: 'village', rule, x, y: pl.y(x, z) - 2, z, s, sy: s * 1.1, ry: r2() * 6.28, color: type === 'mixed' && r2() < 0.3 ? pl.colour('willow', r2) : pl.colour(type, r2) });
    }
  }
  // 路边、平地上零星几棵
  guard = 0;
  let lone = 0;
  const wantLone = Math.round(150 * density);
  while (lone < wantLone && guard++ < 6000) {
    const x = lerp(coords.x0 + 200, coords.x1 - 200, rnd());
    const z = lerp(coords.z0 + 200, coords.z1 - 200, rnd());
    if (samplers.height(x, z) - samplers.lift(x, z) > ground.baseM + 2.5 || !pl.okGround(x, z) || samplers.edge(x, z) < 60) continue;
    if (fbm(x / 500, z / 500, 2, 91) < 0.52) continue;
    const s = 13 + rnd() * 9;
    pl.put({ kind: 'lone', rule, x, y: pl.y(x, z) - 2, z, s, sy: s * 1.1, ry: rnd() * 6.28, color: pick() });
    lone++;
  }
}

/** 沿着一条线两边种（河边的柳）。线在水里时，先往外找到岸，再往岸上退一点。 */
function plantAlong(pl: Planter, ctx: KitContext, rule: number, line: Vec2[], type: TreeType, density: number, seed: number): void {
  const { coords, samplers } = ctx;
  const rnd = mulberry32(seed);
  const pts = densify(line, 60);
  for (let i = 3; i < pts.length - 3; i += 2) {
    if (rnd() > 0.58 * density) continue;
    const [ax, az] = pts[i];
    const [bx, bz] = pts[i + 1];
    const l = Math.hypot(bx - ax, bz - az);
    if (l === 0) continue;
    const nx = -(bz - az) / l;
    const nz = (bx - ax) / l;
    const side = rnd() < 0.5 ? -1 : 1;
    // 往这一边走到岸上
    const inWater = samplers.edge(ax, az) < 22;
    let off = 0;
    while (off < 700 && samplers.edge(ax + nx * side * off, az + nz * side * off) < 22) off += 20;
    off += 12 + rnd() * 90;
    const x = ax + nx * side * off;
    const z = az + nz * side * off;
    if (x < coords.x0 + 80 || x > coords.x1 - 80 || z < coords.z0 + 80 || z > coords.z1 - 80) continue;
    const e = samplers.edge(x, z);
    if (e < 22 || (inWater && e > 160) || !pl.okGround(x, z)) continue;
    const s = 14 + rnd() * 9;
    pl.put({ kind: 'bank', rule, x, y: pl.y(x, z) - 2, z, s, sy: s * (type === 'willow' ? 1.25 : 1.1), ry: rnd() * 6.28, color: pl.colour(type, rnd) });
  }
}

/** 一个点四周种几棵细做的：离那一点半个半径以外，一圈。 */
function plantAround(pl: Planter, ctx: KitContext, rule: number, at: Vec2, radius: number, type: TreeType, density: number, seed: number): void {
  const rnd = mulberry32(seed);
  const want = Math.min(60, Math.max(3, Math.round(8 * density * (radius / 150) ** 2)));
  const size = type === 'fruit' ? 0.7 : type === 'pine' ? 1.1 : 1;
  let placed = 0;
  for (let tries = 0; tries < want * 10 && placed < want; tries++) {
    const a = rnd() * 6.28;
    const d = radius * (0.55 + 0.45 * rnd());
    const x = at[0] + Math.cos(a) * d;
    const z = at[1] + Math.sin(a) * d;
    if (ctx.samplers.edge(x, z) < 20) continue;
    const slim = pl.slim(type);
    if (slim) pl.putSlim('spot', rule, slim, x, z, rnd);
    else pl.put({ kind: 'spot', rule, x, y: pl.y(x, z) - 1, z, s: (0.9 + rnd() * 0.4) * size, ry: rnd() * 6.28, color: pl.colour(type, rnd) });
    placed++;
  }
}

/**
 * 一座屋四周的几棵树：匀着种在屋子两边和屋后，屋前（门口那一面，左右各 70 度）空着。front 是屋子正面朝哪边（长度为 1）。
 * 屋子远了要放大好几倍给人看，树跟着放大：种在门前，从正面看过去屋子就被挡住了。
 */
function plantBeside(pl: Planter, ctx: KitContext, rule: number, at: Vec2, front: Vec2, radius: number, type: TreeType, density: number, seed: number): void {
  const rnd = mulberry32(seed);
  const want = Math.min(60, Math.max(3, Math.round(8 * density * (radius / 150) ** 2)));
  const size = type === 'fruit' ? 0.7 : type === 'pine' ? 1.1 : 1;
  for (let i = 0; i < want; i++) {
    for (let tries = 0; tries < 6; tries++) {
      // 从正面转过 70 度起，到 290 度为止的那一大半圈，一棵占一段，在自己那一段里偏一点
      const a = ((70 + (220 * (i + 0.5 + (rnd() - 0.5) * 0.5)) / want) * Math.PI) / 180;
      const d = radius * (0.55 + 0.3 * rnd());
      const x = at[0] + (front[0] * Math.cos(a) - front[1] * Math.sin(a)) * d;
      const z = at[1] + (front[0] * Math.sin(a) + front[1] * Math.cos(a)) * d;
      if (ctx.samplers.edge(x, z) < 20) continue;
      pl.put({ kind: 'spot', rule, x, y: pl.y(x, z) - 1, z, s: (0.9 + rnd() * 0.4) * size, ry: rnd() * 6.28, color: pl.colour(type, rnd) });
      break;
    }
  }
}

/** 一块地方里散着种。 */
function plantArea(pl: Planter, ctx: KitContext, rule: number, area: Vec2[], type: TreeType, density: number, seed: number): void {
  const rnd = mulberry32(seed);
  const xs = area.map((p) => p[0]);
  const zs = area.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const z0 = Math.min(...zs);
  const z1 = Math.max(...zs);
  const want = Math.min(600, Math.round((density * (x1 - x0) * (z1 - z0)) / 14400));
  let placed = 0;
  for (let tries = 0; tries < want * 8 && placed < want; tries++) {
    const x = x0 + rnd() * (x1 - x0);
    const z = z0 + rnd() * (z1 - z0);
    if (!insidePolygon(area, x, z) || ctx.samplers.edge(x, z) < 30) continue;
    const slim = pl.slim(type);
    if (slim) {
      pl.putSlim('grove', rule, slim, x, z, rnd);
      placed++;
      continue;
    }
    const s = 13 + rnd() * 10;
    pl.put({ kind: 'grove', rule, x, y: pl.y(x, z) - 2, z, s, sy: s * 1.1, ry: rnd() * 6.28, color: pl.colour(type, rnd) });
    placed++;
  }
}

/** 小节里题签指着的一座单座的小建筑，从那一节的镜头看过去：脚在哪，放大到头时多宽（一半）、多高，镜头的右、上、前。 */
interface Featured {
  foot: Vec3;
  halfWide: number;
  tall: number;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
}

/** 单座的屋、亭近看时顶有多宽（一半）、从脚到顶多高（things.ts、parts.ts 里的尺寸）。 */
const FEATURE_SIZE = { house: { halfWide: 19, tall: 26 }, pavilion: { halfWide: 21, tall: 34 } };
/** 小建筑放大到头的那个远近上，苔点也放大了一点。 */
const DOT_GROW = 1.3;

/**
 * 哪几座小建筑是题签指着要人看的（地上单座的屋、亭），各在哪一节、从哪边看。
 * 它们远了放大好几倍，就为了让人认出来；山上的杂树只是表示山林，随手种的，不该正好挡在它前面。
 */
function featured(ctx: KitContext): Featured[] {
  const { scene, coords, samplers, style } = ctx;
  const out: Featured[] = [];
  for (const section of scene.sections) {
    for (const id of section.strips) {
      const of = scene.strips.find((s) => s.id === id)?.of;
      const thing = scene.things.find((t) => t.id === of);
      if (!thing || !thing.at || thing.on || (thing.kind !== 'house' && thing.kind !== 'pavilion')) continue;
      const cls = liftClass(thing, scene);
      const grow = cls ? Math.max(1, style.figure.rules[cls].maxTimes) : 1;
      const [x, z] = coords.toLocal(thing.at);
      const b = (section.camera.bearing * Math.PI) / 180;
      const p = (section.camera.pitch * Math.PI) / 180;
      const size = FEATURE_SIZE[thing.kind];
      out.push({
        foot: [x, coords.y(samplers.height(x, z)) - 1, z],
        halfWide: size.halfWide * grow,
        tall: size.tall * grow,
        // 和镜头那一边（rig.ts）是同一套方向
        right: [Math.cos(b), 0, Math.sin(b)],
        up: [Math.sin(b) * Math.cos(p), Math.sin(p), -Math.cos(b) * Math.cos(p)],
        forward: [Math.sin(b) * Math.sin(p), -Math.cos(p), -Math.cos(b) * Math.sin(p)],
      });
    }
  }
  return out;
}

/** 这粒苔点从哪一节的镜头看过去，是不是挡在一座要人看的小建筑前面。 */
function hides(t: Tree, features: Featured[]): boolean {
  if (t.sy === undefined) return false;
  const r = t.s * DOT_GROW;
  for (const f of features) {
    const d: Vec3 = [t.x - f.foot[0], t.y + t.sy * 0.6 - f.foot[1], t.z - f.foot[2]];
    const dot = (v: Vec3): number => d[0] * v[0] + d[1] * v[1] + d[2] * v[2];
    // 在它和镜头之间；画面上横着压着它，竖着在它的脚和顶之间
    if (dot(f.forward) < -r && Math.abs(dot(f.right)) < f.halfWide + r && dot(f.up) > -r && dot(f.up) < f.tall * f.up[1] + r) return true;
  }
  return false;
}

/** 把场景里每条树的规则都种下去。 */
export function plantTrees(ctx: KitContext, survey: Survey, colours: TreeColours): Tree[] {
  const pl = makePlanter(ctx, survey, colours);
  const groups = figureGroups(ctx.scene, ctx.style);
  /** 这条规则要是跟着一座单座的屋：那座屋在哪、正面朝哪边。 */
  const houseOf = (id: string): { at: Vec2; front: Vec2 } | null => {
    const group = groups.find((g) => g.members.includes(id));
    const main = group ? ctx.scene.things.find((t) => t.id === group.main) : undefined;
    if (!main || main.kind !== 'house' || !main.at) return null;
    const at = ctx.coords.toLocal(main.at);
    const ry = houseRy(ctx, main, at[0], at[1]);
    return { at, front: [Math.sin(ry), Math.cos(ry)] };
  };
  ctx.scene.dressing.forEach((rule, index) => {
    if (rule.kind !== 'trees') return;
    const p = dressingParams('trees', rule.params);
    const type: TreeType = p.type ?? 'mixed';
    if (!CORE_TYPES.includes(type) && !pl.slim(type)) throw new Error(`零件库里没有 ${type} 这种树的种法：它那一家的程序没有取到`);
    const density = Math.max(0, p.density ?? 1);
    const seed = p.seed ?? 1037;
    if (rule.line) plantAlong(pl, ctx, index, rule.line.map((q) => ctx.coords.toLocal(q)), type, density, seed);
    else if (rule.at) {
      const house = houseOf(rule.id);
      if (house) plantBeside(pl, ctx, index, house.at, house.front, p.radiusM ?? 150, type, density, seed);
      else plantAround(pl, ctx, index, ctx.coords.toLocal(rule.at), p.radiusM ?? 150, type, density, seed);
    }
    else if (rule.area) plantArea(pl, ctx, index, rule.area.map((q) => ctx.coords.toLocal(q)), type, density, seed);
    else plantEverywhere(pl, ctx, index, type, density, seed);
  });
  // 规则写了“这几处不种”（except：修整的 id）的：种下以后落在那几处修整的范围里的去掉
  const barred = ctx.scene.dressing.map((rule) =>
    (rule.except ?? []).flatMap((id) => {
      const edit = ctx.scene.terrain.edits.find((e) => e.id === id);
      return edit?.op === 'level' && edit.area ? [edit.area.map((q) => ctx.coords.toLocal(q))] : [];
    }),
  );
  const allowed = barred.some((areas) => areas.length) ? pl.out.filter((t) => !barred[t.rule].some((area) => insidePolygon(area, t.x, t.z))) : pl.out;
  // 挡在要人看的小建筑前面的苔点不种（先都种下再去掉：别的树种在哪不跟着变）
  const features = featured(ctx);
  return features.length ? allowed.filter((t) => !hides(t, features)) : allowed;
}

/** 哪一条规则管城里空地上的树：第一条哪里都不写的树的规则。没有就是 −1。 */
export function cityTreeRule(rules: SceneDressing[]): number {
  return rules.findIndex((d) => d.kind === 'trees' && !d.line && !d.at && !d.area && !d.inside);
}

/** 城里留出的空地上种的树。 */
export function cityTrees(lots: Lot[], rule: number, type: TreeType, colours: TreeColours, seed: number): Tree[] {
  const rnd = mulberry32(seed + 3);
  const pick = (): string => (type === 'mixed' ? [colours.tree, colours.tree, colours.treeBlue, colours.treeOlive][Math.floor(rnd() * 4)] : type === 'pine' ? colours.treeBlue : type === 'willow' ? colours.willow : colours.treeOlive);
  return lots.map((lot) => {
    const s = 15 + rnd() * 7;
    return { kind: 'city', rule, x: lot.x, y: lot.y - 2, z: lot.z, s, sy: s * 1.15, ry: rnd() * 6.28, color: pick(), wet: Infinity, follow: lot.follow };
  });
}

/** 排好次序的一棵树。 */
export interface RankedTree extends Tree {
  /** 次序，0 到 1（不含 1）：远了去掉一些的时候，小的留到最后。每条规则各排各的。 */
  rank: number;
}

/**
 * 给树排次序：每条规则各排各的，打乱以后第几棵除以总数；有题签指着这条规则时，离题签最近的一棵排第一。
 * 平地上零星的树排在这条规则的最后：远了它们先去掉（零星的几棵放大了反而乱）。
 * 城里空地上跟着屋子、院落走的树，远了留不留不看这里的次序（看它那座屋的），这里的次序只管画质里留不留：和别的树一样打乱了排。
 * 不跟着谁的城里的树还是排在最后。
 */
export function rankTrees(ctx: KitContext, trees: Tree[]): RankedTree[] {
  const out: RankedTree[] = trees.map((t) => ({ ...t, rank: 0 }));
  const rules = [...new Set(trees.map((t) => t.rule))];
  for (const rule of rules) {
    const mine = out.filter((t) => t.rule === rule);
    const data = ctx.scene.dressing[rule];
    const seed = (dressingParams('trees', data?.params).seed ?? 1037) + rule * 7919;
    const rnd = mulberry32((seed ^ 0x51ed270b) >>> 0);
    const order = mine.map((t) => (t.kind === 'lone' || (t.kind === 'city' && !t.follow) ? 1 : 0) + rnd());
    const rank = rankOf(
      ctx,
      data?.id ?? '',
      seed,
      mine.map((t): Vec2 => [t.x, t.z]),
      order,
    );
    mine.forEach((t, i) => {
      t.rank = rank[i];
    });
  }
  return out;
}

/** 画质里“树留几成”：每条规则留次序在前面的那几成，至少留一棵（排第一的那一棵）。不留的不造。 */
export function keptTree(t: RankedTree, treeKeep: number): boolean {
  return treeKeep >= 1 || t.rank < treeKeep || t.rank === 0;
}

/** 一组里的树分到的几个网格。每一份都按次序从小到大排好。 */
export interface TreeLists {
  /** 城四周的苔点（圆一点的形状）、再远的苔点（最省的形状）。 */
  round: Instance[];
  plain: Instance[];
  /** 城里空地上跟着屋子、院落走的苔点：各跟各的，不是同一类，所以单放一份（别的苔点才好按次序只画前面的）。 */
  city: Instance[];
  /** 细做的树（一个点四周种的那几棵）。 */
  fine: Instance[];
  /** 镜头贴近时才长出来的细做的树：和 round、plain 里对应的那几粒苔点是同一棵。 */
  close: Instance[];
}

export interface TreeSorting {
  ctx: KitContext;
  /** “离城多远”从哪里算起。 */
  centre: Vec2;
  /** 镜头贴近的那几节各对准哪一点（沙盘里的 x、z）。 */
  closeSpots: Vec2[];
  /**
   * 这条规则（scene.dressing 里的第几条）要是跟着一座小建筑整组放大：那一组的类，和这棵树从哪一点摊开
   * （横竖是主角的脚，高度跟着地面走，见 pass.ts 的 groupPoint）。foot 是这棵树的脚，sink 是它的脚比地面低多少。
   */
  joined(rule: number, foot: Vec3, sink: number): { cls: FigureClass; group: Vec3 } | null;
}

const byRank = (a: Instance, b: Instance): number => (a.figure?.rank ?? 0) - (b.figure?.rank ?? 0);

/**
 * 把一组里的树（同一些小节里有的几条规则的，已经去掉了画质里不留的）分到几个网格里，每棵带上自己的记号：
 * 哪一类（平常是“树”，跟着小建筑的用那一组的类）、次序、水面到多高它开始缩。
 */
export function treeLists(trees: RankedTree[], { ctx, centre, closeSpots, joined }: TreeSorting): TreeLists {
  const lists: TreeLists = { round: [], plain: [], city: [], fine: [], close: [] };
  for (const t of trees) {
    // 跟着屋子、院落走的：从那一点摊开，高度不变。跟着小建筑的：细做的树脚比地面低 1，苔点低 2
    const follow = t.follow;
    const group: { cls: FigureClass; group: Vec3 } | null = follow ? { cls: follow.cls, group: [follow.group[0], t.y, follow.group[1]] } : joined(t.rule, [t.x, t.y, t.z], t.sy === undefined ? 1 : 2);
    const cls: FigureClass = group ? group.cls : 'tree';
    // 水漫不到的地方写一个到不了的高度（不能大得离谱：显卡上是单精度的数，太大了“再深一米”就加不上去了）
    const mark = Number.isFinite(t.wet) ? ctx.coords.y(t.wet + DROWN_FROM_M) : NEVER_WET;
    const rule = ctx.scene.dressing[t.rule]?.id;
    // 跟着屋子走的：远了留不留照那座屋的次序
    const figure = { cls, rank: follow ? follow.rank : t.rank, mark, group: group?.group };
    if (t.sy === undefined) {
      lists.fine.push({ x: t.x, y: t.y, z: t.z, ry: t.ry, s: t.s, color: t.color, rule, figure: { ...figure, kind: FIG_TREE } });
      continue;
    }
    const close = !t.slim && closeSpots.some((p) => Math.hypot(t.x - p[0], t.z - p[1]) < R_CLOSE);
    const dot: Instance = { x: t.x, y: t.y, z: t.z, ry: t.ry, s: t.s, sy: t.sy, color: t.color, rule, figure: { ...figure, kind: close ? FIG_TREE_DOT : FIG_TREE } };
    (follow ? lists.city : Math.hypot(t.x - centre[0], t.z - centre[1]) < R_NEAR ? lists.round : lists.plain).push(dot);
    // 细做的一棵：大小按苔点的大小折算，脚比苔点高一点（苔点埋得深）
    if (close) lists.close.push({ x: t.x, y: t.y + 2, z: t.z, ry: t.ry, s: t.s / 17, color: t.color, rule, figure: { ...figure, kind: FIG_TREE_FINE } });
  }
  lists.round.sort(byRank);
  lists.plain.sort(byRank);
  lists.city.sort(byRank);
  lists.fine.sort(byRank);
  lists.close.sort(byRank);
  return lists;
}

/** 一米深的水合沙盘里多高（树从“水深一米”缩到“水深两米”，这一段有多高）。 */
export function metreOfWater(ctx: KitContext, levelM: number): number {
  return ctx.coords.y(levelM + 1) - ctx.coords.y(levelM);
}

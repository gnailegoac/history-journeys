// 小工程这一家：浮桥（摆件 pontoon-bridge），池（pool），坟（grave-mound）。
// 按家分块：场景里写到了这三样里的一样，造模型以前才下载这个文件（登记在 src/stage/families.ts，规矩见 ../kit/families.ts）。
// 只算形状，不碰页面。
//
// 三样都要站在读者看见的那块地上。读者看见的是地形板（59 米一格，每个顶点取四周 22 米里最低的地面），不是 20 米一格的高程：
// 坡上两边差着好几米。所以脚都往下接到“高程和地形板里低的那个”以下（../meshHeight.ts），不悬空；
// 浮桥的船只摆在地形板低过水面、水也真画出来的那一截，两头的桥板顺着岸搭到地面上。

import * as THREE from 'three';
import type { SceneThing } from '../../../domain/scene';
import { existsAt, sectionHeadings } from '../../../domain/sceneText';
import { POOL_RADIUS_M, plotHalfM } from '../../ground';
import type { Vec2, Vec3 } from '../../ground/types';
import type { KitFamily } from '../kit/families';
import { FB, T, box, segBox } from '../kit/geo';
import type { FigureTag } from '../kit/geo';
import { thingParams } from '../kit/params';
import { groundY, groupPoint, joinedTo, local } from '../kit/pass';
import type { Pass } from '../kit/pass';
import { insideRing } from '../kit/site';
import { hex, lerp, mix3 } from '../kit/util';
import { meshHeightAt } from '../meshHeight';
// 这一句只为打包：这一家的程序只在沙盘程序已经下载了以后才取。写了这一句，打包的工具就知道沙盘程序那一块一定在，
// 两边共用的东西（three 的核心、零件库的批次和小工具）留在那一块里直接用（和另外两家一样）。
import '../engine';

/** 这一家自己的材质：白的，颜色全写在顶点上。 */
const MAT = 'works';

/** 样式里的一种颜色写成顶点上的数（线性的光，0 到 1）。 */
function vertexColour(rgb: Vec3): Vec3 {
  const c = new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);
  return [c.r, c.g, c.b];
}

/** 这一点的脚往下接到哪：高程和地形板里低的那个（沙盘里的高度）。 */
function lowY(pass: Pass, mesh: (x: number, z: number) => number, x: number, z: number): number {
  return Math.min(groundY(pass, x, z), pass.ctx.coords.y(mesh(x, z)));
}

/** 挨着一座单座的屋、亭的东西跟着它整组放大（见 ../kit/pass.ts 的 joinedTo）；不挨着谁的原样摆，不放大。 */
function tagOf(pass: Pass, thing: SceneThing, foot: Vec3): FigureTag | null {
  const joined = joinedTo(pass, thing.id);
  return joined && !joined.main ? { pivot: foot, group: groupPoint(pass, joined, foot, 0), cls: joined.cls } : null;
}

// ---------------------------------------------------------------- 坟

/** 坟的尺寸：半径（米）、高（沙盘里的高度）；圆冢分几面；从脚到顶的三圈各在半径的几成、高的几成；裙边埋多深。 */
export const MOUND = {
  large: { r: 22, h: 13 },
  small: { r: 14, h: 8 },
  sides: 12,
  rings: [
    [1, 0],
    [0.82, 0.46],
    [0.5, 0.83],
  ] as [number, number][],
  underY: 3,
};

/**
 * 一座圆的土冢：没有碑、没有墙、没有石头。最下面一圈的每个顶点落在它自己脚下读者看得见的那块地上
 * （高程和地形板里低的那个，顺着坡），冢顶比这一圈的平均高出 h；圈下面一道裙边再往下埋 3。土色，顶上是草色。
 */
function buildMound(pass: Pass, thing: SceneThing): void {
  if (!thing.at) return;
  const { r, h } = MOUND[thingParams('grave-mound', thing.params).size ?? 'large'];
  const [cx, cz] = local(pass, thing.at);
  const { ctx } = pass;
  const mesh = meshHeightAt(ctx.samplers, ctx.coords);
  const n = MOUND.sides;
  const dir = (i: number): Vec2 => [Math.cos((i / n) * 6.2832), Math.sin((i / n) * 6.2832)];
  const feet = Array.from({ length: n }, (_, i) => lowY(pass, mesh, cx + dir(i)[0] * r, cz + dir(i)[1] * r));
  const mean = feet.reduce((sum, y) => sum + y, 0) / n;
  // 浅土色（新土的黄掺一半白墙的白），顶上草色：山坡是赭石和石绿，旧土色的冢在坡上认不出来
  const pale = mix3(hex(ctx.style.palette.earth), hex(ctx.style.palette.plaster), 0.5);
  const earth = vertexColour(pale);
  const grass = vertexColour(mix3(pale, hex(ctx.style.palette.treeOlive), 0.5));
  /** 第 k 圈（0 是脚）上第 i 个顶点，和它的颜色。 */
  const at = (k: number, i: number): Vec3 => {
    const [rk, hk] = MOUND.rings[k];
    const [dx, dz] = dir(i);
    return [cx + dx * r * rk, lerp(feet[i % n], mean, 1 - rk) + h * hk, cz + dz * r * rk];
  };
  const tone = (k: number): Vec3 => mix3(earth, grass, [0, 0.55, 1][k]);
  const top: Vec3 = [cx, mean + h, cz];
  const fb = new FB();
  for (let i = 0; i < n; i++) {
    const [mx, mz] = dir(i + 0.5);
    for (let k = 0; k < 2; k++) fb.quad(at(k, i), at(k, i + 1), at(k + 1, i + 1), at(k + 1, i), [mx, 0.6 + k * 0.8, mz], null, [tone(k), tone(k), tone(k + 1), tone(k + 1)]);
    fb.quad(at(2, i), at(2, i + 1), top, top, [mx * 0.3, 1, mz * 0.3], null, [grass, grass, grass, grass]);
    // 裙边：顺着坡往下接，不留缝
    const a = at(0, i);
    const b = at(0, i + 1);
    const under = (p: Vec3): Vec3 => [p[0], p[1] - MOUND.underY, p[2]];
    fb.quad(under(a), under(b), b, a, [mx, 0, mz], null, [earth, earth, earth, earth]);
  }
  const B = pass.bucket(thing.when).main;
  B.tagged(tagOf(pass, thing, [cx, mean, cz]), () => B.add(MAT, fb.geo()));
}

// ---------------------------------------------------------------- 池

/** 池的尺寸：分几面；池沿多宽（米）；水面比池沿下最高的地面高多少、土的池沿比水面高多少、砌石的高多少；池沿的脚埋多深。 */
export const POOL = { sides: 10, kerbM: { small: 2.5, large: 3.5 }, aboveY: 1, earthY: 0.4, stoneY: 1.6, underY: 3 };

/**
 * 一口池：一片平的十边形水面（水的颜色，边上淡一点），四周一圈池沿。它不是沙盘上那一片水面，不跟着水位走。
 * 水面是平的，比池沿脚下读者看得见的那块地（高程和地形板里低的那个）最高的一处高 1，地形板盖不住它；
 * 池沿的外面往下接到那块地以下 3：坡上的池，下坡那一面就是一道砌起来的沿。stone：池沿是浅色的石头，比水面高一截。
 * 在城墙里面的池占着一块地（见 src/stage/ground/cityPlan.ts 的 plotHalfM），民居让开它。
 */
function buildPool(pass: Pass, thing: SceneThing): void {
  if (!thing.at) return;
  const p = thingParams('pool', thing.params);
  const size = p.size ?? 'small';
  const r = POOL_RADIUS_M[size];
  const out = r + POOL.kerbM[size];
  const [cx, cz] = local(pass, thing.at);
  const { ctx } = pass;
  const mesh = meshHeightAt(ctx.samplers, ctx.coords);
  const n = POOL.sides;
  const dir = (i: number): Vec2 => [Math.cos((i / n) * 6.2832), Math.sin((i / n) * 6.2832)];
  let water = lowY(pass, mesh, cx, cz);
  for (let i = 0; i < n; i++) water = Math.max(water, lowY(pass, mesh, cx + dir(i)[0] * out, cz + dir(i)[1] * out));
  water += POOL.aboveY;
  const kerbY = water + (p.stone ? POOL.stoneY : POOL.earthY);
  const pal = ctx.style.palette;
  const blue = vertexColour(hex(pal.waterCalm));
  const pale = vertexColour(mix3(hex(pal.waterCalm), hex(pal.ripple), 0.45));
  const kerb = vertexColour(hex(p.stone ? pal.stone : pal.bankEarth));
  const side: Vec3 = [kerb[0] * 0.86, kerb[1] * 0.86, kerb[2] * 0.86];
  const ring = (i: number, radius: number, y: number): Vec3 => [cx + dir(i)[0] * radius, y, cz + dir(i)[1] * radius];
  const fb = new FB();
  for (let i = 0; i < n; i++) {
    const [mx, mz] = dir(i + 0.5);
    fb.quad([cx, water, cz], ring(i, r, water), ring(i + 1, r, water), ring(i + 1, r, water), [0, 1, 0], null, [blue, pale, pale, pale]);
    fb.quad(ring(i, r, kerbY), ring(i + 1, r, kerbY), ring(i + 1, out, kerbY), ring(i, out, kerbY), [0, 1, 0], null, [kerb, kerb, kerb, kerb]);
    fb.quad(ring(i, r, water), ring(i + 1, r, water), ring(i + 1, r, kerbY), ring(i, r, kerbY), [-mx, 0, -mz], null, [side, side, side, side]);
    const a = ring(i, out, kerbY);
    const b = ring(i + 1, out, kerbY);
    const under = (q: Vec3): Vec3 => [q[0], lowY(pass, mesh, q[0], q[2]) - POOL.underY, q[2]];
    fb.quad(under(a), under(b), b, a, [mx, 0, mz], null, [side, side, kerb, kerb]);
  }
  // 城里的池：它那一块地民居让开（大街、小巷由地面那一边让开，是同一个数）
  const half = plotHalfM(thing);
  if ([...pass.survey.walls.values()].some((w) => insideRing(w.ring, cx, cz))) pass.yards.push({ cx, cz, ry: 0, hx: half, hz: half });
  const B = pass.bucket(thing.when).main;
  B.tagged(tagOf(pass, thing, [cx, water, cz]), () => B.add(MAT, fb.geo()));
}

// ---------------------------------------------------------------- 浮桥

/**
 * 浮桥的尺寸。pitchM：贴近了看时一条船占桥上多长（米）；farOver：镜头远了船造得大一些、少一些——
 * 要看这座桥的各节里镜头最近的一节离它多远，除以这个数，比 pitchM 大就用它（一万二千米外，十米宽的船在画面上只有两个像素，认不出是船）。
 * beam：船宽是它占的那一段的几成；long：船长是船宽的几倍；freeY、keelY：船宽 9 米时船帮比水面高多少、船底比水面低多少（沙盘里的高度，跟着船宽放大）；
 * deckM：桥板最窄多宽，和船占的那一段的几成比着取大的；stepM：沿桥线隔多远量一次水；postY：两头的桩多高。
 */
export const PONTOON = { pitchM: 10, farOver: 480, beam: 0.9, long: 3.8, freeY: 3, keelY: 1.4, deckM: 7, deckOfPitch: 0.45, stepM: 2, postY: 9 };

/** 浮桥摆出来的样子：船各在哪（沿桥线离第一个点多少米）、多宽多长，有水的一截从哪到哪，桥板多高。 */
export interface PontoonPlan {
  /** 桥线的两头（沙盘里的 x、z）、全长（米）。 */
  a: Vec2;
  b: Vec2;
  length: number;
  /** 有水的一截：沿桥线从哪到哪（米）。没有水是 null：不摆船，只有一道贴着地面的桥板。 */
  wet: [number, number] | null;
  /** 每条船的中心沿桥线在哪（米）。 */
  hulls: number[];
  beamM: number;
  longM: number;
  /** 水面、桥板的顶面（沙盘里的高度）。 */
  waterY: number;
  deckY: number;
  deckM: number;
}

/**
 * 一座浮桥怎么摆（造它和查它用的是同一份，tests/stage/meishan-figures.test.ts）。
 * 有水的一截从地形板上读：沿桥线每两米量一次，地形板低过平时的水面、水也画得出来（地面比水面低 0.25 米以上）的算有水，取连着的最长的一截。
 * 船只摆在这一截里，一条挨一条横在水上（船身顺着水流），不摆到岸上去。
 */
export function pontoonPlan(pass: Pass, thing: SceneThing): PontoonPlan | null {
  const line = (thing.line ?? []).map((q) => local(pass, q));
  if (line.length < 2) return null;
  const { ctx } = pass;
  const a = line[0];
  const b = line[line.length - 1];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length < 1) return null;
  const P = PONTOON;
  const levelM = ctx.scene.water.levels.values.normal;
  const mesh = meshHeightAt(ctx.samplers, ctx.coords);
  const steps = Math.ceil(length / P.stepM);
  let wet: [number, number] | null = null;
  let from = -1;
  for (let i = 0; i <= steps + 1; i++) {
    const x = lerp(a[0], b[0], i / steps);
    const z = lerp(a[1], b[1], i / steps);
    const isWet = i <= steps && mesh(x, z) < levelM && ctx.samplers.waterH(x, z) < levelM - 0.25;
    if (isWet && from < 0) from = i;
    if (!isWet && from >= 0) {
      if (!wet || i - 1 - from > (wet[1] - wet[0]) / (length / steps)) wet = [(from * length) / steps, ((i - 1) * length) / steps];
      from = -1;
    }
  }
  // 镜头最近的一节离多远：只算这座桥在场的小节
  const headings = sectionHeadings(ctx.scene);
  const near = Math.min(...ctx.scene.sections.filter((s) => existsAt(thing.when, s.heading, headings)).map((s) => s.camera.distanceM));
  const want = Math.max(P.pitchM, near / P.farOver);
  const span = wet ? wet[1] - wet[0] : 0;
  const count = wet ? Math.max(1, Math.round(span / want)) : 0;
  const pitch = count ? span / count : want;
  const beamM = pitch * P.beam;
  const waterY = ctx.coords.y(levelM);
  return {
    a,
    b,
    length,
    wet,
    hulls: Array.from({ length: count }, (_, i) => (wet as [number, number])[0] + (i + 0.5) * pitch),
    beamM,
    longM: beamM * P.long,
    waterY,
    deckY: waterY + (P.freeY * beamM) / 9 + 1.2,
    deckM: Math.max(P.deckM, pitch * P.deckOfPitch),
  };
}

/** 一条船身：两头尖，没有篷和桅；长边顺着它自己的 x。k 是船宽 ÷ 9。 */
function hullGeo(beamM: number, longM: number): THREE.BufferGeometry {
  const k = beamM / 9;
  const top = PONTOON.freeY * k;
  const keel = -PONTOON.keelY * k;
  const dark: Vec3 = [0.55, 0.55, 0.55];
  const rail: Vec3 = [1.0, 0.95, 0.9];
  const boards: Vec3 = [2.3, 2.1, 1.8];
  const NS = 6;
  const st = (i: number): { x: number; half: number } => {
    const s = -1 + (2 * i) / NS;
    // 两头收到船宽的百分之六，不收成一个点（收成一个点，那一格的面是一条线，朝哪边算不出来）
    return { x: (s * longM) / 2, half: (beamM / 2) * Math.max(0.06, 1 - Math.pow(Math.abs(s), 2.2)) };
  };
  const fb = new FB();
  for (let i = 0; i < NS; i++) {
    const p = st(i);
    const q = st(i + 1);
    for (const sg of [-1, 1]) fb.quad([p.x, keel, sg * p.half * 0.6], [q.x, keel, sg * q.half * 0.6], [q.x, top, sg * q.half], [p.x, top, sg * p.half], [0, -0.3, sg], null, [dark, dark, rail, rail]);
    fb.quad([p.x, top - 0.6 * k, -p.half * 0.94], [q.x, top - 0.6 * k, -q.half * 0.94], [q.x, top - 0.6 * k, q.half * 0.94], [p.x, top - 0.6 * k, p.half * 0.94], [0, 1, 0], null, [boards, boards, boards, boards]);
  }
  return fb.geo();
}

/**
 * 浮桥：一排船横在水上，一条挨一条，上面铺一道桥板，两头各立两根桩。线是两个点，从这一岸到那一岸。
 * 船只摆在有水的那一截里；桥板在水上是平的，到了岸边顺着地面搭上去（不埋进地里，也不悬着）。照平时的水位造，不跟着水位走，也不跟着镜头远近放大。
 */
function buildPontoon(pass: Pass, thing: SceneThing): void {
  const plan = pontoonPlan(pass, thing);
  if (!plan) return;
  const { a, b, length, wet, waterY, deckY, deckM } = plan;
  const { ctx } = pass;
  const mesh = meshHeightAt(ctx.samplers, ctx.coords);
  const ux = (b[0] - a[0]) / length;
  const uz = (b[1] - a[1]) / length;
  const B = pass.bucket(thing.when).main;
  /** 沿桥线走到 d 米的那一点。 */
  const at = (d: number): Vec2 => [a[0] + ux * d, a[1] + uz * d];
  /** 这一点的地面（高程和地形板里高的那个）上面一点：桥板不埋进地里。 */
  const landY = (d: number): number => {
    const [x, z] = at(d);
    return Math.max(groundY(pass, x, z), ctx.coords.y(mesh(x, z))) + 0.8;
  };
  // 船身横在桥线上：它自己的 x 轴和桥线垂直
  const across = Math.atan2(ux, uz);
  const hull = hullGeo(plan.beamM, plan.longM);
  for (const d of plan.hulls) {
    const [x, z] = at(d);
    B.add('plainTimber', hull, T(x, waterY, z, across));
  }
  // 桥板的顶面：水上是平的；岸上从水边那一头斜到桥头，一路不低过地面
  const [w0, w1] = wet ?? [length / 2, length / 2];
  const marks = [0, w0 / 3, (w0 * 2) / 3, w0, w1, w1 + (length - w1) / 3, w1 + ((length - w1) * 2) / 3, length];
  const topAt = (d: number): number => {
    if (!wet) return landY(d);
    if (d >= w0 && d <= w1) return deckY;
    const t = d < w0 ? d / (w0 || 1) : (length - d) / (length - w1 || 1);
    return Math.max(landY(d), lerp(landY(d < w0 ? 0 : length), deckY, t));
  };
  // 桥板是浅色的木板（材质是船的深木色，乘到新土那样的浅黄）：横在深色的船身上才看得出是一道桥
  const boards: Vec3 = [3.9, 6, 4.8];
  for (let i = 0; i < marks.length - 1; i++) {
    if (marks[i + 1] - marks[i] < 0.5) continue;
    const [px, pz] = at(marks[i]);
    const [qx, qz] = at(marks[i + 1]);
    B.add('plainTimber', segBox([px, topAt(marks[i]) - 0.6, pz], [qx, topAt(marks[i + 1]) - 0.6, qz], deckM, 1.2), null, boards);
  }
  // 两头各两根桩
  for (const d of [0, length]) {
    const [x, z] = at(d);
    for (const sg of [-1, 1]) {
      const px = x - uz * sg * (deckM / 2 + 1.5);
      const pz = z + ux * sg * (deckM / 2 + 1.5);
      B.add('plainTimber', box(2, PONTOON.postY + 2, 2), T(px, Math.min(groundY(pass, px, pz), ctx.coords.y(mesh(px, pz))) - 2, pz));
    }
  }
}

export const family: KitFamily = {
  things: { 'pontoon-bridge': buildPontoon, pool: buildPool, 'grave-mound': buildMound },
  materials: [MAT],
};

// 零件库里从样张搬来的几样形状（src/stage/three/kit/geo.ts），和样张原来的程序（spikes/art-direction/b/scene/geo.js）
// 对一遍：同样的输入，算出来的数一个不差。看不到画面的机器上，靠它保证搬的时候没有搬走样。
// 比的是普通的数组，不比对象的类型：两边的 three 可能是从两个 node_modules 里装进来的。
// 样张退役（spikes/art-direction/b 删掉）的时候，这个文件一起删。
//
// 后面还有一组：零件库的小工具（kit/util.ts）。随机数、噪声、插值、颜色这八样和算地面的一边是同一份
// （src/stage/ground/num.ts），零件库自己不留；连同它自己的两样，算出来的数和样张的 util.js 一个不差。

import { describe, expect, it } from 'vitest';
import * as groundNum from '../../src/stage/ground/num';
import type { Vec2, Vec3 } from '../../src/stage/ground/types';
import * as mine from '../../src/stage/three/kit/geo';
import * as kitUtil from '../../src/stage/three/kit/util';

/** 两边的形状都只看这几样：各个顶点属性的数，和顶点的次序。 */
interface GeoLike {
  attributes: Record<string, { array: ArrayLike<number> } | undefined>;
  index: { array: ArrayLike<number> } | null;
}
interface RoofLike {
  roof: GeoLike;
  fascia: GeoLike | null;
  gable: GeoLike | null;
  ridges: { a: number[]; b: number[]; w: number; h: number }[];
  prof(t: number): number;
}
/** 样张 geo.js 里要对的几个函数（样张是 JavaScript，没有类型，这里按它的用法写）。 */
interface SampleGeo {
  box(w: number, h: number, d: number): GeoLike;
  cyl(r: number, h: number, seg?: number, rTop?: number): GeoLike;
  segBox(a: number[], b: number[], w: number, h: number): GeoLike;
  prism(section: number[][], L: number, options?: { shade?: (y: number) => number | number[]; topShade?: number; uvScale?: number }): GeoLike;
  roofParts(options: Record<string, number>): RoofLike;
}

const found = import.meta.glob<SampleGeo>('../../spikes/art-direction/b/scene/geo.js', { eager: true });
const sample = Object.values(found)[0];

/** 一个形状里所有的数，摊成普通的数组。 */
function numbers(g: GeoLike): Record<string, number[] | null> {
  const out: Record<string, number[] | null> = { index: g.index ? Array.from(g.index.array) : null };
  for (const name of ['position', 'normal', 'uv', 'color']) {
    const attribute = g.attributes[name];
    out[name] = attribute ? Array.from(attribute.array) : null;
  }
  return out;
}

function same(a: GeoLike, b: GeoLike): void {
  const na = numbers(a);
  const nb = numbers(b);
  expect(na.position?.length).toBeGreaterThan(0);
  expect(na).toEqual(nb);
}

describe('从样张搬来的形状和样张算出来的一样', () => {
  it('找得到样张的 geo.js', () => {
    expect(sample).toBeDefined();
    expect(typeof sample.roofParts).toBe('function');
  });

  it('box：底面在 y=0 的盒子', () => {
    same(mine.box(10, 4, 6), sample.box(10, 4, 6));
    same(mine.box(92, 86, 92), sample.box(92, 86, 92));
  });

  it('cyl：柱子，上下一样粗的和上头收细的', () => {
    same(mine.cyl(1.7, 16, 8), sample.cyl(1.7, 16, 8));
    same(mine.cyl(2, 9), sample.cyl(2, 9));
    same(mine.cyl(1.6, 4.5, 6, 0.4), sample.cyl(1.6, 4.5, 6, 0.4));
  });

  it('segBox：两点之间的一根方条', () => {
    const a: Vec3 = [-12.5, 19.7, 0];
    const b: Vec3 = [14.2, 23.1, -6];
    same(mine.segBox(a, b, 2.4, 2.6), sample.segBox(a, b, 2.4, 2.6));
    same(mine.segBox([0, 1, 2], [10, 1, 2], 1.8, 1.8), sample.segBox([0, 1, 2], [10, 1, 2], 1.8, 1.8));
  });

  it('prism：城墙那样的棱柱，明暗按高度给', () => {
    const section: Vec2[] = [
      [26, -8.8],
      [21.9, 27.2],
      [18, 69.2],
      [-18, 69.2],
      [-21.9, 27.2],
      [-26, -8.8],
    ];
    const shade = (y: number): Vec3 => [0.78 + y / 500, 0.8 + y / 600, 0.82 + y / 700];
    const options = { shade, topShade: 1.18, uvScale: 48 };
    same(mine.prism(section, 553, options), sample.prism(section, 553, options));
  });

  it('prism：堤那样的棱柱，明暗是一个数；什么都不写时用默认', () => {
    const section: Vec2[] = [
      [34, -14],
      [8, 30.6],
      [-8, 30.6],
      [-34, -14],
    ];
    const shade = (y: number): number => 0.82 + y / 200;
    same(mine.prism(section, 226, { shade, topShade: 1.12, uvScale: 30 }), sample.prism(section, 226, { shade, topShade: 1.12, uvScale: 30 }));
    same(mine.prism(section, 80), sample.prism(section, 80));
  });

  const roofs: [string, Record<string, number>][] = [
    ['歇山顶（城楼）', { W: 104, D: 50, H: 21, ts: 0.52, lift: 4, nu: 12, nt: 6, sag: 0.55 }],
    ['腰檐（只做到一半高）', { W: 116, D: 62, H: 13.4, ts: 1, t1: 0.645, lift: 5, nu: 10, nt: 4, sag: 0.55 }],
    ['攒尖顶（亭子）', { W: 46, D: 46, H: 16, ts: 1, lift: 4, nu: 8, nt: 6, sag: 0.6 }],
    ['两坡顶（民房，没有封檐板）', { W: 47, D: 27, H: 9.5, ts: 0, nu: 1, nt: 3, sag: 0.4, fascia: 0, gableInset: 2.5, tile: 3.2 }],
    ['茅草顶', { W: 37, D: 25, H: 9, ts: 0, nu: 1, nt: 3, sag: 0.15, fascia: 0, gableInset: 2.5, tile: 5 }],
    ['只写宽、深、高，别的用默认', { W: 60, D: 30, H: 12 }],
  ];
  for (const [name, options] of roofs) {
    it(`roofParts：${name}`, () => {
      const a = mine.roofParts({ W: options.W, D: options.D, H: options.H, ...options });
      const b = sample.roofParts(options);
      same(a.roof, b.roof);
      expect(a.fascia === null).toBe(b.fascia === null);
      if (a.fascia && b.fascia) same(a.fascia, b.fascia);
      expect(a.gable === null).toBe(b.gable === null);
      if (a.gable && b.gable) same(a.gable, b.gable);
      expect(a.ridges).toEqual(b.ridges);
      for (const t of [0, 0.25, 0.5, 0.8, 1]) expect(a.prof(t)).toBe(b.prof(t));
    });
  }
});

// ---------------------------------------------------------------- 小工具只有一份

/** 样张 util.js 里的十样（样张是 JavaScript，没有类型，这里按它的用法写）。 */
interface SampleUtil {
  mulberry32(seed: number): () => number;
  clamp(v: number, a: number, b: number): number;
  lerp(a: number, b: number, t: number): number;
  smoothstep(e0: number, e1: number, x: number): number;
  hash2(ix: number, iz: number, seed?: number): number;
  fbm(x: number, z: number, oct?: number, seed?: number): number;
  hex(h: string): number[];
  mix3(a: number[], b: number[], t: number): number[];
  distSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number;
  densify(pts: number[][], step?: number): number[][];
}

const foundUtil = import.meta.glob<SampleUtil>('../../spikes/art-direction/b/scene/util.js', { eager: true });
const sampleUtil = Object.values(foundUtil)[0];

/** 算地面的一边和零件库共用的八样。 */
const SHARED = ['mulberry32', 'clamp', 'lerp', 'smoothstep', 'hash2', 'fbm', 'hex', 'mix3'] as const;

describe('零件库的小工具（src/stage/three/kit/util.ts）', () => {
  it('随机数、噪声、插值、颜色这八样零件库自己不留一份：给出来的就是算地面那一边的那一个函数', () => {
    const kit: Record<string, unknown> = kitUtil;
    const ground: Record<string, unknown> = groundNum;
    for (const name of SHARED) {
      expect(typeof kit[name], `kit/util 没有给出 ${name}`).toBe('function');
      expect(kit[name], `kit/util 里的 ${name} 不是 ground/num 的那一个`).toBe(ground[name]);
    }
    // 零件库自己的只有两样
    expect(Object.keys(kitUtil).sort()).toEqual([...SHARED, 'densify', 'distSeg'].sort());
  });

  it('十样东西算出来的数和样张的 util.js 一个不差（零件库造出来的东西没有因为换了这一份走样）', () => {
    expect(typeof sampleUtil.mulberry32).toBe('function');
    const mine = kitUtil.mulberry32(1077);
    const theirs = sampleUtil.mulberry32(1077);
    for (let i = 0; i < 200; i++) expect(mine()).toBe(theirs());
    const rnd = kitUtil.mulberry32(5);
    for (let i = 0; i < 200; i++) {
      const a = rnd() * 2000 - 1000;
      const b = rnd() * 2000 - 1000;
      const c = rnd() * 3 - 1;
      expect(kitUtil.clamp(a, -300, 400)).toBe(sampleUtil.clamp(a, -300, 400));
      expect(kitUtil.lerp(a, b, c)).toBe(sampleUtil.lerp(a, b, c));
      expect(kitUtil.smoothstep(-200, 500, a)).toBe(sampleUtil.smoothstep(-200, 500, a));
      expect(kitUtil.hash2(Math.round(a), Math.round(b), i)).toBe(sampleUtil.hash2(Math.round(a), Math.round(b), i));
      expect(kitUtil.fbm(a / 260, b / 260, 3, 77)).toBe(sampleUtil.fbm(a / 260, b / 260, 3, 77));
      expect(kitUtil.fbm(a, b)).toBe(sampleUtil.fbm(a, b));
      expect(kitUtil.distSeg(a, b, -100, 20, 300, c * 100)).toBe(sampleUtil.distSeg(a, b, -100, 20, 300, c * 100));
      expect(kitUtil.mix3([a, b, c], [b, c, a], c)).toEqual(sampleUtil.mix3([a, b, c], [b, c, a], c));
    }
    expect(kitUtil.hex('#4a6e56')).toEqual(sampleUtil.hex('#4a6e56'));
    const line: Vec2[] = [
      [0, 0],
      [120, 40],
      [200, 300],
      [180, 520],
    ];
    expect(kitUtil.densify(line, 60)).toEqual(sampleUtil.densify(line, 60));
    expect(kitUtil.densify(line)).toEqual(sampleUtil.densify(line));
  });
});

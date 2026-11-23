// 地面（src/stage/ground）的单元测试：读地形文件、整理、修整、挖河、壕、水漫不进去的地方、城的平面、上色。
// 用的是 tests/support/fixtureScene.ts 那座小沙盘（3000 × 2400 米，位置都落在 20 米的格点上）；
// 要别的情形时拿一份来改。最后一组拿徐州真的地形文件跑一遍整理。

import { describe, expect, it } from 'vitest';
import type { Grounds, LevelEdit, SceneDressing, SceneThing, StopScene } from '../../src/domain/scene';
import { frameCoords } from '../../src/domain/sceneGeo';
import { buildFields, gateSeats, paintGround, readDem, samplers, yardLayout } from '../../src/stage/ground';
import { OPEN_SEED_BELOW_M, OPEN_SEED_OUTSIDE_M, openWater } from '../../src/stage/ground/fields';
import { asRing, distLine, ringCentre, ringSigned, smoothLine, subdivide } from '../../src/stage/ground/lines';
import type { Ground, GroundSamplers, GroundStyle, Vec2 } from '../../src/stage/ground/types';
import { FIXTURE_HEIGHTS, FIXTURE_M, fixturePoint, fixtureScene, fixtureTerrainBytes } from '../support/fixtureScene';
import { readBytes } from '../support/readBytes';
import { flatGround, flatSamplers } from './support/flatGround';

const H = FIXTURE_HEIGHTS;
const M = FIXTURE_M;
/** 小沙盘的河床海拔。 */
const BED = H.normal - H.bed;

/** 样张的颜色和山上的分带（spikes/art-direction/b/scene/config.js 的 PAL）。 */
const STYLE: GroundStyle = {
  colours: {
    tea: '#e6d9b8',
    teaWarm: '#e4d3a8',
    meadow: '#c4c9a2',
    fieldA: '#d8cc9f',
    fieldB: '#cfc994',
    fieldC: '#c4c9a2',
    ochre: '#c0975f',
    ochreDeep: '#99683f',
    shilu: '#629b80',
    shiluDeep: '#4f8a73',
    shiqing: '#3a6c9c',
    shiqingDeep: '#2d5689',
    sand: '#e6dbb9',
    bed: '#b7c9c8',
    blank: '#efe6cf',
    road: '#ecdfbd',
    path: '#c9b184',
    cityGround: '#d3c5a4',
    court: '#f6f2e6',
    sprout: '#a9bf7e',
  },
  bands: { foot: [2.4, 8], green: [7, 22], blue: [40, 84], deepBlue: [88, 125] },
};

// ---------------------------------------------------------------- 帮手

interface Built {
  scene: StopScene;
  ground: Ground;
  at: GroundSamplers;
}

/** 拿一份小沙盘，改一改，算出地面。 */
function build(change?: (scene: StopScene) => void): Built {
  const scene = fixtureScene();
  change?.(scene);
  const ground = buildFields(scene, readDem(scene.terrain, fixtureTerrainBytes()));
  return { scene, ground, at: samplers(ground) };
}

/** 没有改过的小沙盘。各组测试共用，只读不改。 */
const plainBuild = build();

/** 类别和依据（测试里添的东西都用这一份）。 */
const grounds = (): Grounds => ({ class: 'schematic', basis: '测试用。', sourceIds: [] });

/** 格点 (x, z) 是第几格。x、z 要是 20 的整倍数。 */
const cellOf = (g: Ground, x: number, z: number): number => Math.round((z - g.z0) / g.cell) * g.nx + Math.round((x - g.x0) / g.cell);

/** 一格一格走一遍。 */
function eachCell(g: Ground, visit: (k: number, x: number, z: number) => void): void {
  for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) visit(j * g.nx + i, g.x0 + i * g.cell, g.z0 + j * g.cell);
}

/** 到小沙盘城墙的线多远：城里是负数（另写一遍，不借用被测的程序）。 */
function wallSd(x: number, z: number): number {
  const W = M.wall;
  const dx = Math.max(W.x0 - x, x - W.x1);
  const dz = Math.max(W.z0 - z, z - W.z1);
  return dx > 0 && dz > 0 ? Math.hypot(dx, dz) : Math.max(dx, dz);
}

type BoxM = [number, number, number, number];

/** 一块横平竖直的地方，四个角。 */
const boxArea = ([x0, z0, x1, z1]: BoxM) => [fixturePoint(x0, z0), fixturePoint(x1, z0), fixturePoint(x1, z1), fixturePoint(x0, z1)];

/** 一处 level 修整。 */
function level(id: string, box: BoxM, mode: LevelEdit['mode'], toM: number, featherM: number): LevelEdit {
  return { ...grounds(), id, name: id, op: 'level', area: boxArea(box), mode, toM, featherM };
}

/** 一条点缀规则。 */
const dressing = (rule: Omit<SceneDressing, keyof Grounds | 'name'>): SceneDressing => ({ ...grounds(), class: 'dressing', name: rule.id, ...rule });

/** 一座城门，摆在小沙盘的城墙上。 */
const gate = (id: string, x: number, z: number): SceneThing => ({ ...grounds(), id, name: id, kind: 'gate', at: fixturePoint(x, z), on: 'wall' });

/** 水位到了 levelM，这一格有没有水。高过平时的水位时，水漫不进去的地方不算。 */
function wet(g: Ground, k: number, levelM: number, normalM: number): boolean {
  if (levelM > normalM && g.dry[k] === 1) return false;
  return g.waterH[k] < levelM;
}

/** 两个数组是不是一模一样。 */
function same(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** 颜色图上沙盘里某一点的颜色和“有没有田”。 */
function pixel(paint: { colour: Uint8Array; w: number }, g: Ground, x: number, z: number): [number, number, number, number] {
  const i = Math.round((x - g.x0) / (g.cell / 2));
  const j = Math.round((z - g.z0) / (g.cell / 2));
  const k = (j * paint.w + i) * 4;
  return [paint.colour[k], paint.colour[k + 1], paint.colour[k + 2], paint.colour[k + 3]];
}

// ---------------------------------------------------------------- 线和圈

describe('线和圈上的几何', () => {
  const square: Vec2[] = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ];

  it('ringSigned：圈里是负数，圈外是正数，压在线上是 0', () => {
    expect(ringSigned(50, 50, square)).toBe(-50);
    expect(ringSigned(10, 50, square)).toBe(-10);
    expect(ringSigned(130, 50, square)).toBe(30);
    expect(ringSigned(50, -20, square)).toBe(20);
    expect(ringSigned(103, 104, square)).toBe(5);
    expect(ringSigned(100, 40, square)).toBe(0);
    expect(ringSigned(0, 0, square)).toBe(0);
  });

  it('ringSigned：凹进去的一块算圈外', () => {
    const notch: Vec2[] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [60, 100],
      [60, 40],
      [40, 40],
      [40, 100],
      [0, 100],
    ];
    expect(ringSigned(50, 80, notch)).toBe(10);
    expect(ringSigned(50, 20, notch)).toBe(-20);
    expect(ringSigned(20, 80, notch)).toBe(-20);
  });

  it('asRing 去掉重复写的最后一点；ringCentre 是围住的那一块的重心', () => {
    expect(asRing([...square, [0, 0]])).toEqual(square);
    expect(asRing(square)).toEqual(square);
    expect(ringCentre(square)).toEqual([50, 50]);
    const [cx, cz] = ringCentre([
      [0, 0],
      [300, 0],
      [0, 300],
    ]);
    expect(cx).toBeCloseTo(100, 9);
    expect(cz).toBeCloseTo(100, 9);
  });

  it('subdivide：直线上匀着加点，拐角和两头都留着', () => {
    const line = subdivide(
      [
        [0, 0],
        [0, 120],
        [90, 120],
      ],
      60,
    );
    expect(line).toEqual([
      [0, 0],
      [0, 60],
      [0, 120],
      [45, 120],
      [90, 120],
    ]);
  });

  /** 样张 util.js 的 densify，照抄在这里当对照。 */
  function sampleDensify(pts: Vec2[], step: number): Vec2[] {
    const out: Vec2[] = [];
    const P = (i: number): Vec2 => pts[Math.max(0, Math.min(pts.length - 1, i))];
    for (let i = 0; i < pts.length - 1; i++) {
      const [p0, p1, p2, p3] = [P(i - 1), P(i), P(i + 1), P(i + 2)];
      const n = Math.max(2, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const f = (a: number, b: number, c: number, d: number): number =>
          0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
        out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    const last = pts[pts.length - 1];
    out.push([last[0], last[1]]);
    return out;
  }

  it('smoothLine：点距差不多的线，和样张的 densify 算出来一样', () => {
    const river: Vec2[] = [
      [-3000, 200],
      [-2000, 420],
      [-1000, 380],
      [0, 0],
      [900, -500],
    ];
    const mine = smoothLine(river, 60);
    const theirs = sampleDensify(river, 60);
    expect(mine.length).toBe(theirs.length);
    for (let i = 0; i < mine.length; i++) {
      expect(mine[i][0]).toBeCloseTo(theirs[i][0], 6);
      expect(mine[i][1]).toBeCloseTo(theirs[i][1], 6);
    }
  });

  it('smoothLine：穿过原来的每一个点', () => {
    const river: Vec2[] = [
      [-3000, 200],
      [-2000, 420],
      [-1785, 400],
      [-200, 0],
    ];
    const line = smoothLine(river, 60);
    for (const p of river) expect(line.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6)).toBe(true);
  });

  it('smoothLine：点距一长一短挨着时不往回走（样张的算法会）', () => {
    const uneven: Vec2[] = [
      [0, 0],
      [1000, 0],
      [1215, 0],
      [2805, 0],
    ];
    const backwards = (line: Vec2[]): number => line.filter((p, i) => i > 0 && p[0] < line[i - 1][0]).length;
    expect(backwards(sampleDensify(uneven, 60))).toBeGreaterThan(0);
    expect(backwards(smoothLine(uneven, 60))).toBe(0);
  });
});

// ---------------------------------------------------------------- 读地形文件

describe('readDem', () => {
  it('读出 8 × 8 的网格：单位从分米换成米，第 0 行最北，第 0 列最西', () => {
    const scene = fixtureScene();
    const dem = readDem(scene.terrain, fixtureTerrainBytes());
    expect([dem.cols, dem.rows]).toEqual([8, 8]);
    expect(dem.heights).toBeInstanceOf(Float32Array);
    expect(dem.heights.length).toBe(64);
    expect(dem.heights[0]).toBe(H.plainToday);
    expect(dem.heights[3 * 8 + 5]).toBe(H.hillToday);
    expect(dem.heights[3 * 8 + 4]).toBe(46);
    expect(dem.heights[2 * 8 + 5]).toBe(46);
    expect([dem.west, dem.east, dem.south, dem.north]).toEqual([scene.terrain.west, scene.terrain.east, scene.terrain.south, scene.terrain.north]);
  });

  it('16 位整数低位在前，可以是负数', () => {
    const terrain = { ...fixtureScene().terrain, cols: 2, rows: 1 };
    const dem = readDem(terrain, new Uint8Array([0x34, 0x12, 0xf6, 0xff]).buffer);
    expect(dem.heights[0]).toBeCloseTo(466, 4);
    expect(dem.heights[1]).toBeCloseTo(-1, 6);
  });

  it('文件大小不是 行 × 列 × 2 字节时抛出错误', () => {
    const terrain = fixtureScene().terrain;
    expect(() => readDem(terrain, new ArrayBuffer(126))).toThrow(/大小不对/);
    expect(() => readDem(terrain, new ArrayBuffer(130))).toThrow(/128 字节/);
    expect(() => readDem(terrain, new ArrayBuffer(0))).toThrow();
  });
});

// ---------------------------------------------------------------- 网格和取数

describe('网格和 samplers', () => {
  const { ground: g, at } = plainBuild;

  it('每格 20 米，四边压在格点上；每张网格都是 nx × nz 个数', () => {
    expect([g.nx, g.nz, g.cell, g.x0, g.z0]).toEqual([151, 121, 20, M.frame.x0, M.frame.z0]);
    const n = g.nx * g.nz;
    for (const field of [g.h, g.waterH, g.edge, g.hill, g.hillSoft, g.curv]) {
      expect(field).toBeInstanceOf(Float32Array);
      expect(field.length).toBe(n);
    }
    expect(g.dry).toBeInstanceOf(Uint8Array);
    expect(g.dry.length).toBe(n);
  });

  it('第 k = j × nx + i 格在 x = x0 + i × cell，z = z0 + j × cell：山在东边偏北，河在中间', () => {
    const top = cellOf(g, M.hill[0], M.hill[1]);
    expect(g.h[top]).toBeGreaterThan(100);
    expect(top % g.nx).toBe((M.hill[0] - M.frame.x0) / 20);
    expect(Math.floor(top / g.nx)).toBe((M.hill[1] - M.frame.z0) / 20);
    expect(g.h[cellOf(g, -100, -800)]).toBeLessThan(H.normal);
  });

  it('格点上取到的就是那一格的数；格子之间按远近匀开', () => {
    const k = cellOf(g, 500, -200);
    expect(at.height(500, -200)).toBeCloseTo(g.h[k], 4);
    expect(at.height(510, -200)).toBeCloseTo((g.h[k] + g.h[k + 1]) / 2, 4);
    expect(at.height(500, -190)).toBeCloseTo((g.h[k] + g.h[k + g.nx]) / 2, 4);
    expect(at.height(505, -195)).toBeCloseTo((9 * g.h[k] + 3 * g.h[k + 1] + 3 * g.h[k + g.nx] + g.h[k + g.nx + 1]) / 16, 4);
    expect(at.edge(-100, -800)).toBeCloseTo(g.edge[cellOf(g, -100, -800)], 3);
    expect(at.waterH(500, -200)).toBeCloseTo(g.waterH[k], 4);
    expect(at.hill(M.hill[0], M.hill[1])).toBeCloseTo(1, 3);
    expect(at.hillSoft(M.hill[0], M.hill[1])).toBeGreaterThan(0.5);
  });

  it('出了沙盘取边上的值', () => {
    expect(at.height(-9999, 0)).toBeCloseTo(at.height(M.frame.x0, 0), 3);
    expect(at.height(9999, 9999)).toBeCloseTo(at.height(M.frame.x1, M.frame.z1), 3);
    expect(at.edge(0, -9999)).toBeCloseTo(at.edge(0, M.frame.z0), 1);
  });

  it('从场景带过来的两个数：平地的海拔和山高夸大的倍数', () => {
    expect(g.baseM).toBe(H.plainBase);
    expect(g.reliefTimes).toBe(6);
    expect(build((s) => (s.frame.relief = { kind: 'uniform', times: 4 })).ground.reliefTimes).toBe(4);
  });
});

// ---------------------------------------------------------------- 整理

describe('整理：平地抹平（低的垫高、高的压低），山留着', () => {
  const { ground: g, at } = plainBuild;

  it('平地在 plainBaseM 上下，差不到 1.5 米', () => {
    // 今天 43 米的平地，压到 40 + 0.1 × (43 − 47) + 0.9 × 0.969 = 40.47
    expect(at.height(-1000, -600)).toBeCloseTo(40.47, 2);
    let count = 0;
    eachCell(g, (k, x) => {
      if (x > -800) return;
      count++;
      expect(Math.abs(g.h[k] - H.plainBase)).toBeLessThan(1.5);
    });
    expect(count).toBeGreaterThan(4000);
  });

  it('离河、离城、离山都远的平地，哪里都差不多一样高', () => {
    for (const [x, z] of [
      [-1200, -900],
      [-1000, 0],
      [-900, 900],
      [-1300, 600],
    ]) {
      expect(Math.abs(at.height(x, z) - 40.47)).toBeLessThan(0.05);
    }
  });

  it('plainKeep 是平地的起伏留几成', () => {
    // 留五成：40 + 0.5 × (43 − 47) + 0.5 × 0.969 = 38.48
    const half = build((s) => (s.terrain.recipe.plainKeep = 0.5));
    expect(half.at.height(-1000, -600)).toBeCloseTo(38.48, 2);
  });

  it('山留着：山顶还在原处，还是最高的地方，比平地高出一大截', () => {
    const top = cellOf(g, M.hill[0], M.hill[1]);
    let highest = 0;
    eachCell(g, (k) => {
      if (g.h[k] > g.h[highest]) highest = k;
    });
    expect(highest).toBe(top);
    expect(g.h[top]).toBeGreaterThan(H.plainBase + 60);
    // 往四面都是下坡
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      let prev = g.h[top];
      for (let step = 1; step <= 15; step++) {
        const here = g.h[cellOf(g, M.hill[0] + dx * step * 20, M.hill[1] + dz * step * 20)];
        expect(here).toBeLessThan(prev);
        prev = here;
      }
    }
  });

  it('哪里算山：山上是 1，平地是 0；抹开以后山脚一带在 0 和 1 之间', () => {
    expect(g.hill[cellOf(g, M.hill[0], M.hill[1])]).toBe(1);
    expect(g.hill[cellOf(g, -1000, -600)]).toBe(0);
    expect(g.hillSoft[cellOf(g, -1000, -600)]).toBeLessThan(0.01);
    const foot = g.hillSoft[cellOf(g, M.hill[0] + 460, M.hill[1])];
    expect(foot).toBeGreaterThan(0.05);
    expect(foot).toBeLessThan(0.95);
  });

  it('凸凹：山顶比四周高是正的，平地是 0 上下', () => {
    expect(g.curv[cellOf(g, M.hill[0], M.hill[1])]).toBeGreaterThan(5);
    expect(Math.abs(g.curv[cellOf(g, -1000, -600)])).toBeLessThan(0.05);
  });

  it('沙盘四边：高出平地的部分收低，边上不超过 plainBaseM + 0.3', () => {
    const floor = H.plainBase + 0.3;
    eachCell(g, (k, x, z) => {
      if (x === M.frame.x0 || x === M.frame.x1 || z === M.frame.z0 || z === M.frame.z1) expect(g.h[k]).toBeLessThanOrEqual(floor + 1e-4);
    });
    // 离边 100 米（收低的一半处）：40.3 + (40.47 − 40.3) × 0.5
    expect(at.height(-1400, 0)).toBeCloseTo(40.39, 2);
    // 离边 200 米以外不动
    expect(at.height(-1300, 0)).toBeCloseTo(40.47, 2);
  });

  it('edgeTaperM 放大以后，离边不远的山也跟着收低', () => {
    // 山顶离东边 700 米。收低的范围放到 800 米：高出 40.3 的部分只剩 smoothstep(0, 800, 700) = 0.957
    const wide = build((s) => (s.terrain.recipe.edgeTaperM = 800));
    const top = cellOf(g, M.hill[0], M.hill[1]);
    const before = g.h[top] - 40.3;
    const after = wide.ground.h[top] - 40.3;
    expect(after / before).toBeCloseTo(0.957, 2);
  });
});

// ---------------------------------------------------------------- 修整

describe('修整：set、raise、lower、mound', () => {
  const baseline = plainBuild.ground;
  /** 西北角的一块平地，离河、离城、离沙盘的边都够远。 */
  const PLAIN: BoxM = [-1300, -1000, -1000, -700];
  /** 山顶周围的一块，整块都比 60 米高。 */
  const HILL: BoxM = [600, -400, 1000, 0];

  const insideBox = (x: number, z: number, [x0, z0, x1, z1]: BoxM, margin: number): boolean =>
    x >= x0 + margin && x <= x1 - margin && z >= z0 + margin && z <= z1 - margin;
  const outsideBox = (x: number, z: number, [x0, z0, x1, z1]: BoxM, margin: number): boolean =>
    x < x0 - margin || x > x1 + margin || z < z0 - margin || z > z1 + margin;

  it('set：整块变成这个高度；线外面 featherM 以内慢慢过渡；再远的不动', () => {
    const { ground: g } = build((s) => s.terrain.edits.push(level('pad', PLAIN, 'set', 44, 60)));
    let inside = 0;
    eachCell(g, (k, x, z) => {
      if (insideBox(x, z, PLAIN, 20)) {
        inside++;
        expect(g.h[k]).toBe(44);
      }
      if (outsideBox(x, z, PLAIN, 61)) expect(g.h[k]).toBe(baseline.h[k]);
    });
    expect(inside).toBe(14 * 14);
    // 东边线外 20 米、40 米：在 44 和原来的 40.47 之间，越远越低
    const near = g.h[cellOf(g, -980, -860)];
    const far = g.h[cellOf(g, -960, -860)];
    expect(near).toBeLessThan(44);
    expect(far).toBeLessThan(near);
    expect(far).toBeGreaterThan(baseline.h[cellOf(g, -960, -860)]);
    // 压在线上的那一圈也是 44（差不到一毫米）
    expect(g.h[cellOf(g, -1000, -860)]).toBeCloseTo(44, 3);
  });

  it('raise：低于它的垫上来', () => {
    const area: BoxM = [300, 400, 700, 800];
    const { ground: g } = build((s) => s.terrain.edits.push(level('fill', area, 'raise', 45, 40)));
    eachCell(g, (k, x, z) => {
      if (!insideBox(x, z, area, 20)) return;
      expect(baseline.h[k]).toBeLessThan(45);
      expect(g.h[k]).toBe(45);
    });
  });

  it('raise：本来就比它高的不动', () => {
    const { ground: g } = build((s) => s.terrain.edits.push(level('fill', HILL, 'raise', 45, 40)));
    expect(same(g.h, baseline.h)).toBe(true);
    expect(g.lift.every((v) => v === 0)).toBe(true);
  });

  it('lift 记着“垫高一块地方”垫了多少：垫出来的平地不算山；压低、压成一个高度、土丘都不记', () => {
    // 离河够远的一块平地（离河近的地方，垫不垫还牵扯到压不压河岸，比不出来）
    const area = PLAIN;
    const { ground: g, at } = build((s) => s.terrain.edits.push(level('fill', area, 'raise', 46, 40)));
    let inside = 0;
    eachCell(g, (k, x, z) => {
      // 过渡的那一圈以外没有垫
      if (outsideBox(x, z, area, 41)) expect(g.lift[k]).toBe(0);
      if (!insideBox(x, z, area, 20)) return;
      inside++;
      // 垫了多少，正好是垫高以后比原来高出的那一截
      expect(g.lift[k]).toBeCloseTo(46 - baseline.h[k], 4);
      expect(g.lift[k]).toBeGreaterThan(5);
      // 46 米比平地高出一大截，可它是垫出来的平地：不算山
      expect(g.hill[k]).toBe(0);
    });
    expect(inside).toBe(14 * 14);
    expect(at.lift(-1150, -850)).toBeCloseTo(46 - baseline.h[cellOf(g, -1160, -860)], 1);
    // 不记的话，这一块会被当成山
    expect(g.h[cellOf(g, -1160, -860)] - H.plainBase).toBeGreaterThan(2.6);
    // 别的几种修整都不记
    expect(baseline.lift.every((v) => v === 0)).toBe(true);
    const others = build((s) =>
      s.terrain.edits.push(level('pad', PLAIN, 'set', 46, 60), level('cut', HILL, 'lower', 60, 40), { ...grounds(), id: 'knoll', name: 'knoll', op: 'mound', at: fixturePoint(500, 600), addM: 8, innerM: 100, outerM: 300 }),
    ).ground;
    expect(others.lift.every((v) => v === 0)).toBe(true);
    // 土丘是要看着像山的：照样算山
    expect(others.hill[cellOf(others, 500, 600)]).toBeGreaterThan(0.5);
  });

  it('lower：高于它的压下去', () => {
    const { ground: g } = build((s) => s.terrain.edits.push(level('cut', HILL, 'lower', 60, 40)));
    let inside = 0;
    eachCell(g, (k, x, z) => {
      if (insideBox(x, z, HILL, 20)) {
        inside++;
        expect(baseline.h[k]).toBeGreaterThan(60);
        expect(g.h[k]).toBe(60);
      }
      if (outsideBox(x, z, HILL, 41)) expect(g.h[k]).toBe(baseline.h[k]);
    });
    expect(inside).toBe(19 * 19);
  });

  it('lower：本来就比它低的不动', () => {
    const { ground: g } = build((s) => s.terrain.edits.push(level('cut', PLAIN, 'lower', 60, 40)));
    expect(same(g.h, baseline.h)).toBe(true);
  });

  it('mound：innerM 以内垫足 addM，到 outerM 减到零', () => {
    const { ground: g } = build((s) =>
      s.terrain.edits.push({ ...grounds(), id: 'knoll', name: '土丘', op: 'mound', at: fixturePoint(-1100, -840), addM: 8, innerM: 60, outerM: 200 }),
    );
    const rise = (x: number, z: number): number => g.h[cellOf(g, x, z)] - baseline.h[cellOf(g, x, z)];
    expect(rise(-1100, -840)).toBeCloseTo(8, 3);
    expect(rise(-1040, -840)).toBeCloseTo(8, 3);
    expect(rise(-1100, -720)).toBeGreaterThan(1);
    expect(rise(-1100, -720)).toBeLessThan(7);
    expect(rise(-900, -840)).toBeCloseTo(0, 3);
    expect(rise(-860, -840)).toBe(0);
  });

  it('按写的先后做：后一处盖住前一处', () => {
    const a = build((s) => s.terrain.edits.push(level('one', PLAIN, 'set', 44, 60), level('two', PLAIN, 'set', 42, 60)));
    const b = build((s) => s.terrain.edits.push(level('two', PLAIN, 'set', 42, 60), level('one', PLAIN, 'set', 44, 60)));
    expect(a.ground.h[cellOf(a.ground, -1160, -860)]).toBe(42);
    expect(b.ground.h[cellOf(b.ground, -1160, -860)]).toBe(44);
  });

  it('inside 指的城墙找不到，或者 area 和 inside 都没写：报错，不悄悄跳过', () => {
    expect(() =>
      build((s) => s.terrain.edits.push({ ...grounds(), id: 'lost', name: '找不到', op: 'level', inside: 'no-such-wall', mode: 'set', toM: 41, featherM: 50 })),
    ).toThrow(/no-such-wall/);
    expect(() => build((s) => s.terrain.edits.push({ ...grounds(), id: 'bare', name: '没写地方', op: 'level', mode: 'set', toM: 41, featherM: 50 }))).toThrow(
      /没有写 area/,
    );
  });
});

// ---------------------------------------------------------------- 河

describe('河：河床、河岸、离城墙的远近', () => {
  const { ground: g, at } = plainBuild;
  /** 没有河、只有壕的小沙盘：拿来比“河有没有把地面垫高”。 */
  const noRiver = build((s) => (s.water.rivers = s.water.rivers.filter((r) => r.kind !== 'river'))).ground;
  /** 离城和壕都远的两段河：城北和城南。 */
  const awayFromCity = (z: number): boolean => z <= -160 || z >= 560;

  it('河床最深处比平时的水面低 bedM；哪里都不比它更低', () => {
    expect(g.h[cellOf(g, -100, -800)]).toBeCloseTo(BED, 4);
    expect(g.h[cellOf(g, -100, -400)]).toBeCloseTo(BED, 4);
    let lowest = Infinity;
    eachCell(g, (k) => (lowest = Math.min(lowest, g.h[k])));
    expect(lowest).toBeCloseTo(BED, 4);
  });

  it('河里是水：中线上都比平时的水面低，离河岸的远近是负数', () => {
    const line = g.rivers.river;
    let checked = 0;
    for (const [x, z] of line) {
      if (z < M.frame.z0 || z > M.frame.z1) continue;
      checked++;
      expect(at.height(x, z)).toBeLessThan(H.normal - 1);
      expect(at.edge(x, z)).toBeLessThan(0);
    }
    expect(checked).toBeGreaterThan(30);
  });

  it('从岸边往河心越来越深，岸边是一道斜坡', () => {
    const row = [-40, -60, -80, -100].map((x) => g.h[cellOf(g, x, -800)]);
    expect(row[0]).toBeLessThanOrEqual(H.bank + 1e-3);
    for (let i = 1; i < row.length; i++) expect(row[i]).toBeLessThanOrEqual(row[i - 1]);
    expect(row[row.length - 1]).toBeCloseTo(BED, 4);
  });

  it('河岸不高过 bankM：高出来的压下去', () => {
    let count = 0;
    eachCell(g, (k, _x, z) => {
      if (!awayFromCity(z) || !(g.edge[k] > 0 && g.edge[k] <= 20)) return;
      count++;
      expect(noRiver.h[k]).toBeGreaterThan(H.bank);
      expect(g.h[k]).toBeLessThanOrEqual(H.bank + 1e-3);
      expect(g.h[k]).toBeGreaterThan(H.normal - 0.5);
    });
    expect(count).toBeGreaterThan(40);
    // 离河 100 米的平地也压到了 bankM
    expect(at.height(60, -800)).toBeCloseTo(H.bank, 2);
  });

  it('河只往下压，哪一格都没有垫高', () => {
    eachCell(g, (k) => expect(g.h[k]).toBeLessThanOrEqual(noRiver.h[k] + 1e-4));
  });

  it('岸本来就比 bankM 低的不动：不垫上来', () => {
    // 把 bankM 提到 45，比平地（40.47）高：除了水边那道斜坡，平地应该原样
    const high = build((s) => (s.water.banks.bankM = 45)).ground;
    let count = 0;
    eachCell(high, (k, x, z) => {
      expect(high.h[k]).toBeLessThanOrEqual(noRiver.h[k] + 1e-4);
      if (!awayFromCity(z) || x > 100 || !(high.edge[k] >= 18 && high.edge[k] <= 150)) return;
      count++;
      expect(high.h[k]).toBe(noRiver.h[k]);
      expect(high.h[k]).toBeLessThan(45);
    });
    expect(count).toBeGreaterThan(200);
  });

  it('修整过的地方不受 bankM 管', () => {
    const area: BoxM = [60, 600, 260, 800];
    // 没有修整时，这里离河一百来米，从 40.5 压到了 bankM 上下
    expect(g.h[cellOf(g, 160, 700)]).toBeLessThan(H.bank + 0.4);
    const kept = build((s) => s.terrain.edits.push(level('terrace', area, 'set', 43, 40))).ground;
    expect(kept.h[cellOf(kept, 160, 700)]).toBe(43);
    expect(kept.h[cellOf(kept, 100, 700)]).toBe(43);
  });

  it('山不因为离河近就整座压平：只有紧挨着河的地方压到 bankM', () => {
    // 让河贴着山脚走：山顶离河 300 米，还是比平地高得多
    const close = build((s) => {
      s.water.rivers[0].line = [fixturePoint(500, -1400), fixturePoint(500, 1400)];
    }).ground;
    expect(close.h[cellOf(close, M.hill[0], M.hill[1])]).toBeGreaterThan(H.plainBase + 50);
    expect(plainBuild.ground.h[cellOf(close, 560, -200)]).toBeGreaterThan(H.plainBase + 30);
    expect(close.h[cellOf(close, 560, -200)]).toBeLessThanOrEqual(H.bank + 1e-3);
  });

  it('河离城墙的线至少 keepOffWallsM：画宽了也不切进城墙', () => {
    // 河的中线离东墙 100 米，画宽 120 米，照画的宽度西岸离墙只有 40 米；规矩是 70 米
    let count = 0;
    eachCell(g, (k, x, z) => {
      const sd = wallSd(x, z);
      if (!(x > M.wall.x1 && z >= 0 && z <= 320 && sd > 0 && sd <= 60)) return;
      count++;
      expect(g.edge[k]).toBeGreaterThan(0);
      expect(g.h[k]).toBeGreaterThan(H.normal);
    });
    expect(count).toBe(3 * 17);
    // 离墙 70 米正好是岸边；再往外是水
    expect(g.edge[cellOf(g, -140, 160)]).toBeCloseTo(10, 0);
    expect(g.edge[cellOf(g, -120, 160)]).toBeCloseTo(-10, 0);
    expect(g.h[cellOf(g, -120, 160)]).toBeLessThan(H.normal);
    expect(g.h[cellOf(g, -100, 160)]).toBeLessThan(H.normal - 1);
  });

  it('不写这条规矩（keepOffWallsM 是 0）时，河照画的宽度一直到墙外 40 米', () => {
    const free = build((s) => (s.water.banks.keepOffWallsM = 0)).ground;
    expect(free.edge[cellOf(free, -140, 160)]).toBeLessThan(0);
    expect(free.h[cellOf(free, -140, 160)]).toBeLessThan(H.normal);
    // 城里还是平的
    expect(free.h[cellOf(free, -220, 160)]).toBe(Math.fround(H.city));
  });

  it('离河很远的地方，edge 是一个很大的数', () => {
    expect(g.edge[cellOf(g, 1400, -1000)]).toBeGreaterThan(1e5);
    expect(g.edge[cellOf(g, -1400, 1000)]).toBeGreaterThan(600);
  });

  it('中线加密到 60 米上下一个点，两头是写的那两点，离写的折线不远', () => {
    const line = g.rivers.river;
    expect(line[0][0]).toBeCloseTo(M.river[0][0], 1);
    expect(line[0][1]).toBeCloseTo(M.river[0][1], 1);
    expect(line[line.length - 1][0]).toBeCloseTo(M.river[2][0], 1);
    expect(line[line.length - 1][1]).toBeCloseTo(M.river[2][1], 1);
    const authored = M.river.map((p): Vec2 => [p[0], p[1]]);
    for (let i = 0; i < line.length; i++) {
      expect(distLine(line[i][0], line[i][1], authored)).toBeLessThan(30);
      // 点不是匀的（样张的算法也这样）：两头密、中间稀，最稀的地方不到 120 米
      if (i > 0) expect(Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])).toBeLessThan(120);
    }
  });

  it('没有河的沙盘也算得出来', () => {
    const none = build((s) => (s.water.rivers = [])).ground;
    expect(none.rivers).toEqual({});
    expect(none.edge.every((e) => e > 1e5)).toBe(true);
    expect(Math.abs(none.h[cellOf(none, -100, -800)] - 40.47)).toBeLessThan(0.15);
  });
});

// ---------------------------------------------------------------- 壕

describe('壕：只在画的宽度里挖，不受“离城墙至少多远”管', () => {
  const { ground: g, at } = plainBuild;
  const noMoat = build((s) => (s.water.rivers = s.water.rivers.filter((r) => r.kind !== 'moat'))).ground;
  const moatLine = M.moat.map((p): Vec2 => [p[0], p[1]]);
  const crossing = M.moatCrossing;

  it('中线照写的折线走，拐角不抹圆', () => {
    const line = g.rivers.moat;
    for (const [x, z] of line) expect(distLine(x, z, moatLine)).toBeLessThan(0.05);
    for (const corner of moatLine) expect(line.some((p) => Math.hypot(p[0] - corner[0], p[1] - corner[1]) < 0.05)).toBe(true);
  });

  it('沿着整条线都有水（跨过去的地方除外），没有被“离城墙至少多远”抹掉', () => {
    // 壕离城墙 60 米，比河的规矩（70 米）近
    expect(wallSd(-660, 160)).toBeLessThan(H.keepOffWalls);
    let checked = 0;
    for (const [x, z] of g.rivers.moat) {
      // 跨过去的地方留出一个圆不挖：半径是画的宽度的一半加 25 米（这里是 40 米），再过一格才到底
      const fromCrossing = Math.hypot(x - crossing[0], z - crossing[1]);
      if (fromCrossing < 45) continue;
      checked++;
      expect(at.height(x, z)).toBeLessThan(H.normal - 1);
      expect(at.waterH(x, z)).toBeLessThan(H.normal - 1);
      expect(at.edge(x, z)).toBeLessThan(0);
      if (fromCrossing > 60) expect(at.height(x, z)).toBeCloseTo(BED, 2);
    }
    expect(checked).toBeGreaterThan(14);
    expect(g.h[cellOf(g, -660, 160)]).toBeCloseTo(BED, 4);
    expect(g.h[cellOf(g, -500, 420)]).toBeCloseTo(BED, 4);
  });

  it('路跨过去的地方不挖', () => {
    const k = cellOf(g, crossing[0], crossing[1]);
    expect(g.h[k]).toBe(noMoat.h[k]);
    expect(g.h[k]).toBeGreaterThan(H.normal + 1);
    expect(g.edge[k]).toBeGreaterThan(0);
    expect(g.h[cellOf(g, crossing[0] + 20, crossing[1])]).toBe(noMoat.h[cellOf(g, crossing[0] + 20, crossing[1])]);
  });

  it('画的宽度外面 15 米以外，地面原样：不压两边的岸', () => {
    let untouched = 0;
    let cut = 0;
    eachCell(g, (k, x, z) => {
      const off = distLine(x, z, moatLine) - M.moatWidth / 2;
      if (off >= 15) {
        untouched++;
        expect(g.h[k]).toBe(noMoat.h[k]);
      } else if (g.h[k] < noMoat.h[k]) cut++;
    });
    expect(untouched).toBeGreaterThan(17000);
    expect(cut).toBeGreaterThan(40);
    // 壕外 40 米的平地还是 40.47，没有压到 bankM
    expect(g.h[cellOf(g, -700, 160)]).toBeCloseTo(40.47, 2);
  });

  it('紧挨着壕的那一格是岸坡：在水面以上，比原来的地面低；水面的宽窄和画的差不多', () => {
    for (const x of [-680, -640]) {
      const k = cellOf(g, x, 160);
      expect(g.h[k]).toBeGreaterThan(H.normal);
      expect(g.h[k]).toBeLessThan(noMoat.h[k]);
    }
    // 画宽 30 米：离中线 10 米有水，离中线 20 米没有
    expect(at.height(-670, 160)).toBeLessThan(H.normal);
    expect(at.height(-650, 160)).toBeLessThan(H.normal);
    expect(at.height(-680, 160)).toBeGreaterThan(H.normal);
    expect(at.height(-640, 160)).toBeGreaterThan(H.normal);
  });

  it('从水边往中线慢慢深下去，到中线才有河床那么深：一道窄沟，岸是缓的，不是直上直下的槽', () => {
    // 画宽一点（80 米）才看得出截面：中线在 x = −660
    const wide = build((s) => {
      for (const r of s.water.rivers) if (r.kind === 'moat') r.drawWidthM = 80;
    }).ground;
    const hAt = (x: number): number => wide.h[cellOf(wide, x, 160)];
    expect(hAt(-660)).toBeCloseTo(BED, 4);
    // 离中线 20 米：正好半深
    expect(hAt(-640)).toBeCloseTo(H.normal - H.bed / 2, 3);
    expect(hAt(-680)).toBeCloseTo(H.normal - H.bed / 2, 3);
    // 水边（离中线 40 米）：就在平时的水面上（东边那一头离城墙太近，城墙脚下又压过一遍，不看）
    expect(hAt(-700)).toBeCloseTo(H.normal, 3);
    // 再往外是岸坡
    expect(hAt(-720)).toBeGreaterThan(H.normal);
    // 凸凹不把这道沟算进去：有没有壕，凸凹都一样（沟外面的平地还是平地，上得了田的颜色）
    expect(same(wide.curv, noMoat.curv)).toBe(true);
    expect(same(g.curv, noMoat.curv)).toBe(true);
  });

  it('bankHalf：最近的那条河或壕画的宽度的一半；离河很远的地方是 0', () => {
    expect(g.bankHalf[cellOf(g, -660, 160)]).toBe(M.moatWidth / 2);
    expect(g.bankHalf[cellOf(g, -700, 160)]).toBe(M.moatWidth / 2);
    expect(g.bankHalf[cellOf(g, -100, -800)]).toBe(M.riverWidth / 2);
    expect(g.bankHalf[cellOf(g, 0, -800)]).toBe(M.riverWidth / 2);
    expect(g.bankHalf[cellOf(g, 1300, 1000)]).toBe(0);
    expect(g.bankHalf.length).toBe(g.nx * g.nz);
  });

  it('只有壕、没有河的沙盘：河的规矩都不起作用', () => {
    const only = build((s) => (s.water.rivers = s.water.rivers.filter((r) => r.kind === 'moat'))).ground;
    expect(only.h[cellOf(only, -660, 160)]).toBeCloseTo(BED, 4);
    expect(Math.abs(only.h[cellOf(only, -100, -800)] - 40.47)).toBeLessThan(0.15);
    expect(Object.keys(only.rivers)).toEqual(['moat']);
  });
});

// ---------------------------------------------------------------- 写了 inside 的修整

describe('写了 inside 的修整：城里是一块平地', () => {
  const city = Math.fround(H.city);

  it('挖完河、壕以后，城墙里面每一格都正好是那个高度', () => {
    const g = plainBuild.ground;
    let inside = 0;
    eachCell(g, (k, x, z) => {
      if (wallSd(x, z) > -1) return;
      inside++;
      expect(g.h[k]).toBe(city);
    });
    expect(inside).toBe(19 * 19);
    // 压在墙线上的那一圈也是（差不到一毫米）
    expect(g.h[cellOf(g, M.wall.x0, 160)]).toBeCloseTo(H.city, 3);
    expect(g.h[cellOf(g, M.wall.x1, M.wall.z1)]).toBeCloseTo(H.city, 3);
  });

  it('河从城中间穿过去也一样：最后再压一遍', () => {
    const { ground: g } = build((s) => {
      s.water.rivers[0].line = [fixturePoint(-400, -1400), fixturePoint(-400, 1400)];
      s.water.banks.keepOffWallsM = 0;
    });
    eachCell(g, (k, x, z) => {
      if (wallSd(x, z) <= -1) expect(g.h[k]).toBe(city);
    });
    // 城外的河照挖
    expect(g.h[cellOf(g, -400, -600)]).toBeCloseTo(BED, 4);
  });

  it('后面别的修整压过城里，城里还是平的', () => {
    const { ground: g } = build((s) => s.terrain.edits.push(level('over', [-700, 100, -300, 500], 'set', 46, 60)));
    eachCell(g, (k, x, z) => {
      if (wallSd(x, z) <= -1) expect(g.h[k]).toBe(city);
    });
    // 城外那一半照后一处修整
    expect(g.h[cellOf(g, -400, 480)]).toBe(46);
  });

  it('城墙外面 featherM 以内慢慢过渡到原来的地面', () => {
    const g = build((s) => (s.water.rivers = [])).ground;
    const row = [0, 20, 40, 60, 80, 100, 120].map((d) => g.h[cellOf(g, M.wall.x0 - d, 160)]);
    expect(row[0]).toBeCloseTo(H.city, 3);
    for (let i = 1; i < row.length; i++) expect(row[i]).toBeLessThanOrEqual(row[i - 1]);
    expect(row[5]).toBeCloseTo(40.47, 2);
    expect(row[6]).toBeCloseTo(40.47, 2);
  });
});

// ---------------------------------------------------------------- 水漫不进去的地方

describe('水看到的地面，水漫不进去的地方', () => {
  const { ground: g, scene } = plainBuild;
  const levels = scene.water.levels.values;

  it('闭合的城墙里面是 1，城外是 0', () => {
    eachCell(g, (k, x, z) => {
      const sd = wallSd(x, z);
      if (sd <= -1) expect(g.dry[k]).toBe(1);
      if (sd >= 1) expect(g.dry[k]).toBe(0);
    });
  });

  it('城墙里面什么水位都不进水', () => {
    // 大水的水位（43 米）比城里的地面（41.2 米）高：要不是这张表，城里就淹了
    expect(levels.flood).toBeGreaterThan(H.city);
    for (const levelM of Object.values(levels)) {
      eachCell(g, (k, x, z) => {
        if (wallSd(x, z) <= -1) expect(wet(g, k, levelM, levels.normal)).toBe(false);
      });
    }
    expect(g.waterH[cellOf(g, -400, 160)]).toBeLessThan(levels.flood);
  });

  it('城外的平地：平时是干的，大水时进水；山上什么时候都是干的', () => {
    const plain = cellOf(g, -1000, -600);
    expect(wet(g, plain, levels.normal, levels.normal)).toBe(false);
    expect(wet(g, plain, levels.flood, levels.normal)).toBe(true);
    const top = cellOf(g, M.hill[0], M.hill[1]);
    expect(wet(g, top, levels.flood, levels.normal)).toBe(false);
    // 河里平时就有水
    expect(wet(g, cellOf(g, -100, -800), levels.normal, levels.normal)).toBe(true);
  });

  it('water.dry 里写的地方也是 1；地面的高度不变', () => {
    const { ground: d } = build((s) => s.water.dry.push({ ...grounds(), id: 'pocket', name: '堤后面', area: boxArea([200, 600, 600, 1000]) }));
    eachCell(d, (k, x, z) => {
      const inPocket = x >= 220 && x <= 580 && z >= 620 && z <= 980;
      const outPocket = x < 200 - 1 || x > 600 + 1 || z < 600 - 1 || z > 1000 + 1;
      if (inPocket) {
        expect(d.dry[k]).toBe(1);
        expect(wet(d, k, levels.flood, levels.normal)).toBe(false);
      }
      if (outPocket && wallSd(x, z) >= 1) expect(d.dry[k]).toBe(0);
    });
    expect(same(d.h, g.h)).toBe(true);
    expect(same(d.waterH, g.waterH)).toBe(true);
  });

  it('没有土坡的时候，水看到的地面就是地面', () => {
    expect(same(g.waterH, g.h)).toBe(true);
  });

  it('贴在城墙外侧的土坡：坡脚下水看到的地面压到河床，地面本身不动', () => {
    const { ground: b } = build((s) =>
      s.things.push({ ...grounds(), id: 'east-bank', name: '东墙外的土坡', kind: 'bank', on: 'wall', line: [fixturePoint(-200, -40), fixturePoint(-200, 360)] }),
    );
    expect(same(b.h, g.h)).toBe(true);
    // 东墙外 40 米、60 米：地面比平时的水面高，水看到的是河床
    for (const x of [-160, -140]) {
      const k = cellOf(b, x, 160);
      expect(b.h[k]).toBeGreaterThan(H.normal);
      expect(b.waterH[k]).toBeCloseTo(BED, 4);
    }
    // 紧贴墙根的 20 米不压（墙身压在上面）
    expect(b.waterH[cellOf(b, -180, 160)]).toBe(b.h[cellOf(b, -180, 160)]);
    // 土坡两头多压 30 米：墙角往北 20 米压，往北 80 米不压
    expect(b.waterH[cellOf(b, -160, -60)]).toBeCloseTo(BED, 4);
    expect(b.waterH[cellOf(b, -160, -120)]).toBe(b.h[cellOf(b, -160, -120)]);
    // 别的三面墙外不动
    let changed = 0;
    eachCell(b, (k, x) => {
      if (b.waterH[k] === b.h[k]) return;
      changed++;
      expect(x).toBeGreaterThan(M.wall.x1);
      expect(b.waterH[k]).toBeCloseTo(BED, 4);
    });
    expect(changed).toBeGreaterThan(40);
  });
});

// ---------------------------------------------------------------- 城的平面

describe('城的平面', () => {
  const W = M.wall;

  it('每道闭合的城墙一座城：城墙的线、中心、城里地面的海拔', () => {
    const { cities } = plainBuild.ground;
    expect(cities.length).toBe(1);
    const city = cities[0];
    expect(city.wallId).toBe('wall');
    expect(city.wall.length).toBe(4);
    const corners = [
      [W.x0, W.z0],
      [W.x1, W.z0],
      [W.x1, W.z1],
      [W.x0, W.z1],
    ];
    city.wall.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(corners[i][0], 1);
      expect(p[1]).toBeCloseTo(corners[i][1], 1);
    });
    expect(city.centre[0]).toBeCloseTo(M.city[0], 1);
    expect(city.centre[1]).toBeCloseTo(M.city[1], 1);
    expect(city.groundM).toBe(H.city);
  });

  it('城里没有写修整时，城里地面的海拔取城中心的地面', () => {
    const { ground } = build((s) => (s.terrain.edits = []));
    expect(ground.cities[0].groundM).toBeCloseTo(samplers(ground).height(M.city[0], M.city[1]), 4);
  });

  it('城门：挪到城墙线上，朝城外的方向长度为 1', () => {
    const { cities } = build((s) => {
      s.things.push(gate('gate-north', -400, -40), gate('gate-west', -600, 160), gate('gate-east', -200, 100), gate('gate-loose', -350, 390));
    }).ground;
    const byId = new Map(cities[0].gates.map((gt) => [gt.id, gt]));
    expect([...byId.keys()]).toEqual(['gate-south', 'gate-north', 'gate-west', 'gate-east', 'gate-loose']);
    const expectGate = (id: string, at: [number, number], outward: [number, number]): void => {
      const gt = byId.get(id);
      expect(gt).toBeDefined();
      if (!gt) return;
      expect(gt.at[0]).toBeCloseTo(at[0], 1);
      expect(gt.at[1]).toBeCloseTo(at[1], 1);
      expect(gt.outward[0]).toBeCloseTo(outward[0], 6);
      expect(gt.outward[1]).toBeCloseTo(outward[1], 6);
    };
    expectGate('gate-south', [-400, 360], [0, 1]);
    expectGate('gate-north', [-400, -40], [0, -1]);
    expectGate('gate-west', [-600, 160], [-1, 0]);
    expectGate('gate-east', [-200, 100], [1, 0]);
    // 写在墙外 30 米的，挪回墙线上
    expectGate('gate-loose', [-350, 360], [0, 1]);
  });

  it('城门写得离墙角太近：挪到城台伸不出这一面墙的地方（离墙角 86 米，门墩加大的 100 米）；只看场景的 gateSeats 给的是同一点', () => {
    const { scene, ground: g } = build((s) => {
      s.things.push(gate('gate-near', -580, 360), { ...gate('gate-big', -200, 340), params: { big: true } }, gate('gate-fine', -600, 100));
    });
    const byId = new Map(g.cities[0].gates.map((gt) => [gt.id, gt.at]));
    expect(byId.get('gate-near')?.[0]).toBeCloseTo(-600 + 86, 1);
    expect(byId.get('gate-near')?.[1]).toBeCloseTo(360, 1);
    expect(byId.get('gate-big')?.[0]).toBeCloseTo(-200, 1);
    expect(byId.get('gate-big')?.[1]).toBeCloseTo(360 - 100, 1);
    // 离墙角够远的不动
    expect(byId.get('gate-fine')?.[0]).toBeCloseTo(-600, 1);
    expect(byId.get('gate-fine')?.[1]).toBeCloseTo(100, 1);
    const seats = gateSeats(scene, frameCoords(scene.frame));
    expect([...seats.keys()].sort()).toEqual([...byId.keys()].sort());
    for (const [id, at] of byId) {
      expect(seats.get(id)?.[0]).toBeCloseTo(at[0], 6);
      expect(seats.get(id)?.[1]).toBeCloseTo(at[1], 6);
    }
  });

  it('大街不从城里的院落（官署、寺）里穿过去：到围墙外 20 米停住，正面的一头接到大门口，背面的一头停在后墙外', () => {
    const yard = (s: StopScene, x: number, z: number, more: Partial<SceneThing> = {}): void => {
      s.things.push({ ...grounds(), id: 'yamen', name: 'yamen', kind: 'hall-group', at: fixturePoint(x, z), params: { halls: 1 }, ...more });
    };
    const withYard = (x: number, z: number, more: Partial<SceneThing> = {}): number[][][] =>
      build((s) => {
        s.things.push(gate('gate-north', -400, -40));
        s.dressing.push(dressing({ id: 'streets', kind: 'roads', inside: 'wall' }));
        yard(s, x, z, more);
      }).ground.cities[0].streets.map((line) => line.map((p) => [Math.round(p[0]), Math.round(p[1])]));

    // 一进的院落：后墙在它的点往北 69 米，前墙在往南 54 米，左右各 117 米
    expect(yardLayout(1)).toEqual({ zs: [-14], back: -69, gate: 48, front: 54, halfWidth: 117 });
    // 两进的（样张的州衙）：后墙往北 105 米，前墙往南 90 米
    expect(yardLayout(2)).toMatchObject({ zs: [-50, 22], back: -105, front: 90 });

    // 院落在大街东边 70 米：街正好从它的围墙里面穿过去。南门来的街停在前墙外，折到大门口；北门来的街停在后墙外
    expect(withYard(-330, 100)).toEqual([
      [
        [-400, 360],
        [-400, 174],
        [-330, 174],
      ],
      [
        [-400, 11],
        [-400, -40],
      ],
    ]);
    // 朝北的院落：前后对调
    expect(withYard(-330, 100, { facing: 0 })).toEqual([
      [
        [-400, 360],
        [-400, 189],
      ],
      [
        [-330, 26],
        [-400, 26],
        [-400, -40],
      ],
    ]);
    // 离大街够远的院落（围墙离街 20 米以外）：街不动
    expect(withYard(-250, 100)).toEqual([
      [
        [-400, 360],
        [-400, -40],
      ],
    ]);
    // 城外的院落不管
    expect(
      build((s) => {
        s.things.push(gate('gate-north', -400, -40));
        s.dressing.push(dressing({ id: 'streets', kind: 'roads', inside: 'wall' }));
        yard(s, 500, 600);
      }).ground.cities[0].streets.length,
    ).toBe(1);
  });

  it('大街是登记了才有的：点缀里没有写 inside 这道城墙的 roads，就没有街', () => {
    expect(plainBuild.ground.cities[0].streets).toEqual([]);
  });

  it('只有一座城门：一条街，从城门到城的中心', () => {
    const { cities } = build((s) => s.dressing.push(dressing({ id: 'streets', kind: 'roads', inside: 'wall' }))).ground;
    const streets = cities[0].streets;
    expect(streets.length).toBe(1);
    expect(streets[0].length).toBe(2);
    expect(streets[0][0][0]).toBeCloseTo(-400, 1);
    expect(streets[0][0][1]).toBeCloseTo(360, 1);
    expect(streets[0][1][0]).toBeCloseTo(-400, 1);
    expect(streets[0][1][1]).toBeCloseTo(160, 1);
  });

  it('四座城门：正对的两座一条直街；不正对的两座，中间折一段', () => {
    const { cities } = build((s) => {
      s.things.push(gate('gate-north', -400, -40), gate('gate-west', -600, 160), gate('gate-east', -200, 100));
      s.dressing.push(dressing({ id: 'streets', kind: 'roads', inside: 'wall' }));
    }).ground;
    const streets = cities[0].streets.map((line) => line.map((p) => [Math.round(p[0]), Math.round(p[1])]));
    expect(streets).toEqual([
      [
        [-400, 360],
        [-400, -40],
      ],
      [
        [-600, 160],
        [-400, 160],
        [-400, 100],
        [-200, 100],
      ],
    ]);
  });

  it('同一个地方前后两座城门（先是土门，后来包了砖）只算一条街', () => {
    const { cities } = build((s) => {
      s.things.push({ ...gate('gate-south-rebuilt', -400, 360), when: { from: '后来' } });
      s.dressing.push(dressing({ id: 'streets', kind: 'roads', inside: 'wall' }));
    }).ground;
    expect(cities[0].gates.length).toBe(2);
    expect(cities[0].streets.length).toBe(1);
  });

  it('小巷：离城的中心 75 米、225 米……一条，东西向，两头离城墙的线 60 米', () => {
    const lanes = plainBuild.ground.cities[0].lanes.map((line) => line.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]));
    expect(lanes).toEqual([
      [
        [-540, 85],
        [-260, 85],
      ],
      [
        [-540, 235],
        [-260, 235],
      ],
    ]);
  });

  it('小巷也是登记了才有的：民居的规则没有写 lanes: true，或者没有民居的规则，就没有巷', () => {
    expect(build((s) => (s.dressing[0].params = { seed: 7 })).ground.cities[0].lanes).toEqual([]);
    expect(build((s) => (s.dressing[0].params = { lanes: false })).ground.cities[0].lanes).toEqual([]);
    expect(build((s) => (s.dressing = [])).ground.cities[0].lanes).toEqual([]);
  });

  it('城墙不是方的也行：五个角的一圈', () => {
    const ring: Vec2[] = [
      [-600, -340],
      [-200, -340],
      [-100, 60],
      [-200, 460],
      [-600, 460],
    ];
    const { ground } = build((s) => {
      s.things[0].line = ring.map((p) => fixturePoint(p[0], p[1]));
      s.things.push(gate('gate-north', -400, -340));
      s.things[1].at = fixturePoint(-400, 460);
      s.dressing.push(dressing({ id: 'streets', kind: 'roads', inside: 'wall' }));
      s.water.rivers = s.water.rivers.filter((r) => r.kind === 'river');
    });
    const city = ground.cities[0];
    expect(city.wall.length).toBe(5);
    expect(ringSigned(city.centre[0], city.centre[1], ring)).toBeLessThan(-150);
    // 城里是平的、不进水
    eachCell(ground, (k, x, z) => {
      if (ringSigned(x, z, ring) > -1) return;
      expect(ground.h[k]).toBe(Math.fround(H.city));
      expect(ground.dry[k]).toBe(1);
    });
    // 小巷都在城里，东西向，离城墙的线至少 60 米，离城的中心 75、225……米
    expect(city.lanes.length).toBeGreaterThanOrEqual(4);
    for (const lane of city.lanes) {
      expect(lane[0][1]).toBeCloseTo(lane[1][1], 6);
      expect(lane[1][0] - lane[0][0]).toBeGreaterThanOrEqual(40);
      for (const [x, z] of lane) expect(ringSigned(x, z, ring)).toBeLessThanOrEqual(-59.9);
      expect((Math.abs(lane[0][1] - city.centre[1]) - 75) % 150).toBeCloseTo(0, 6);
    }
    // 两座城门正对：一条直街
    expect(city.streets.length).toBe(1);
    expect(city.streets[0].length).toBe(2);
    // 河让开了东边的那个角
    expect(ground.h[cellOf(ground, -60, 60)]).toBeGreaterThan(H.normal);
  });

  it('没有城墙的沙盘没有城', () => {
    const { ground } = build((s) => {
      s.things = [];
      s.terrain.edits = [];
      s.dressing = [];
    });
    expect(ground.cities).toEqual([]);
    expect(ground.dry.every((d) => d === 0)).toBe(true);
  });
});

// ---------------------------------------------------------------- 村子、路、田

describe('点缀里和地面有关的：村子、路、田', () => {
  it('场景里没有登记的就没有', () => {
    const g = plainBuild.ground;
    expect(g.villages).toEqual([]);
    expect(g.roads).toEqual([]);
    expect(g.fields).toEqual([]);
  });

  it('村子：在平地上，离河、离城、离山都有一段，彼此隔开', () => {
    const { ground: g, at } = build((s) => s.dressing.push(dressing({ id: 'hamlets', kind: 'villages', params: { count: 3, seed: 5 } })));
    expect(g.villages.length).toBeGreaterThanOrEqual(1);
    expect(g.villages.length).toBeLessThanOrEqual(3);
    for (const v of g.villages) {
      expect(Math.abs(v.x)).toBeLessThanOrEqual(1000);
      expect(Math.abs(v.z)).toBeLessThanOrEqual(700);
      expect(at.height(v.x, v.z)).toBeGreaterThanOrEqual(H.plainBase - 1.8);
      expect(at.height(v.x, v.z)).toBeLessThanOrEqual(H.plainBase + 1.4);
      expect(at.edge(v.x, v.z)).toBeGreaterThanOrEqual(170);
      expect(at.hillSoft(v.x, v.z)).toBeLessThanOrEqual(0.12);
      expect(wallSd(v.x, v.z)).toBeGreaterThanOrEqual(520);
      expect(v.n).toBeGreaterThanOrEqual(5);
      expect(v.n).toBeLessThanOrEqual(9);
      expect(Number.isInteger(v.seed)).toBe(true);
      for (const other of g.villages) if (other !== v) expect(Math.hypot(other.x - v.x, other.z - v.z)).toBeGreaterThanOrEqual(1250);
    }
  });

  it('村子：同一个种子每次一样，换一个种子换地方', () => {
    const withSeed = (seed: number): Ground['villages'] =>
      build((s) => s.dressing.push(dressing({ id: 'hamlets', kind: 'villages', params: { count: 2, seed } }))).ground.villages;
    expect(withSeed(5)).toEqual(withSeed(5));
    expect(withSeed(5)).not.toEqual(withSeed(6));
  });

  it('村子：写了 area 的只摆在那一块里', () => {
    const { ground: g } = build((s) => s.dressing.push(dressing({ id: 'hamlets', kind: 'villages', area: boxArea([200, 400, 1100, 800]), params: { count: 2 } })));
    expect(g.villages.length).toBeGreaterThanOrEqual(1);
    for (const v of g.villages) {
      expect(v.x).toBeGreaterThanOrEqual(200);
      expect(v.z).toBeGreaterThanOrEqual(400);
    }
  });

  it('路：写了 line 的 roads 带过来，不写 type 的算城外的路；写 inside 的是城里的街，不在这里', () => {
    const { ground: g } = build((s) =>
      s.dressing.push(
        dressing({ id: 'south-road', kind: 'roads', line: [fixturePoint(-400, 360), fixturePoint(-380, 700)] }),
        dressing({ id: 'market', kind: 'roads', line: [fixturePoint(-500, 100), fixturePoint(-300, 100)], params: { type: 'street' } }),
        dressing({ id: 'streets', kind: 'roads', inside: 'wall' }),
      ),
    );
    expect(g.roads.map((r) => r.type)).toEqual(['road', 'street']);
    expect(g.roads[0].line.length).toBe(2);
    expect(g.roads[0].line[1][0]).toBeCloseTo(-380, 1);
    expect(g.roads[0].line[1][1]).toBeCloseTo(700, 1);
  });

  it('田：不写 area 是整块沙盘，不写 seed 是 0', () => {
    const { ground: g } = build((s) =>
      s.dressing.push(dressing({ id: 'fields', kind: 'fields' }), dressing({ id: 'west-fields', kind: 'fields', area: boxArea([-1400, -400, -900, 400]), params: { seed: 3 } })),
    );
    expect(g.fields.length).toBe(2);
    expect(g.fields[0]).toEqual({ area: null, seed: 0 });
    expect(g.fields[1].seed).toBe(3);
    expect(g.fields[1].area?.length).toBe(4);
  });
});

// ---------------------------------------------------------------- 同样的输入，同样的结果

describe('同样的输入，同样的结果', () => {
  const full = (s: StopScene): void => {
    s.dressing.push(
      dressing({ id: 'streets', kind: 'roads', inside: 'wall' }),
      dressing({ id: 'hamlets', kind: 'villages', params: { count: 3 } }),
      dressing({ id: 'fields', kind: 'fields' }),
      dressing({ id: 'south-road', kind: 'roads', line: [fixturePoint(-400, 360), fixturePoint(-380, 700), fixturePoint(-600, 1100)] }),
    );
  };

  it('算两遍，每张网格、每样东西都一模一样', () => {
    const a = build(full).ground;
    const b = build(full).ground;
    for (const name of ['h', 'waterH', 'dry', 'edge', 'hill', 'hillSoft', 'curv'] as const) expect(same(a[name], b[name])).toBe(true);
    expect(a.rivers).toEqual(b.rivers);
    expect(a.villages).toEqual(b.villages);
    expect(a.cities).toEqual(b.cities);
    expect(a.roads).toEqual(b.roads);
    expect(a.fields).toEqual(b.fields);
  });

  it('上色两遍也一模一样', () => {
    const g = build(full).ground;
    const a = paintGround(g, STYLE);
    const b = paintGround(g, STYLE);
    expect(same(a.colour, b.colour)).toBe(true);
    expect(same(a.normals, b.normals)).toBe(true);
  });

  it('不改动传进来的场景、高程网格和地面', () => {
    const scene = fixtureScene();
    full(scene);
    const before = structuredClone(scene);
    const dem = readDem(scene.terrain, fixtureTerrainBytes());
    const heights = Float32Array.from(dem.heights);
    const g = buildFields(scene, dem);
    expect(scene).toEqual(before);
    expect(same(dem.heights, heights)).toBe(true);
    const h = Float32Array.from(g.h);
    paintGround(g, STYLE);
    expect(same(g.h, h)).toBe(true);
  });
});

// ---------------------------------------------------------------- 上色

describe('paintGround', () => {
  const { ground: g } = build((s) => {
    s.dressing.push(
      dressing({ id: 'streets', kind: 'roads', inside: 'wall' }),
      dressing({ id: 'fields', kind: 'fields' }),
      dressing({ id: 'south-road', kind: 'roads', line: [fixturePoint(-400, 360), fixturePoint(-400, 800), fixturePoint(-600, 1100)] }),
    );
  });
  const paint = paintGround(g, STYLE);

  it('颜色图每格 10 米，每点四个字节；法线图和地面网格一样大', () => {
    expect([paint.w, paint.h]).toEqual([301, 241]);
    expect(paint.colour.length).toBe(301 * 241 * 4);
    expect(paint.normals.length).toBe(g.nx * g.nz * 4);
  });

  it('平地是茶色绢底，山顶是石青，河底是淡花青', () => {
    const [r, gr, b] = pixel(paint, g, -1100, 300);
    expect(r).toBeGreaterThan(195);
    expect(gr).toBeGreaterThan(185);
    expect(b).toBeGreaterThan(130);
    expect(r).toBeGreaterThan(b + 25);
    const top = pixel(paint, g, M.hill[0], M.hill[1]);
    expect(top[2]).toBeGreaterThan(top[0] + 40);
    const bed = pixel(paint, g, -100, -800);
    expect(bed[2]).toBeGreaterThan(bed[0]);
    expect(bed[1]).toBeGreaterThan(bed[0]);
  });

  it('城里是浅灰黄的地；大街、小巷比地面亮', () => {
    const groundCol = pixel(paint, g, -330, 150);
    expect(Math.abs(groundCol[0] - 211)).toBeLessThan(12);
    expect(Math.abs(groundCol[1] - 197)).toBeLessThan(12);
    expect(Math.abs(groundCol[2] - 164)).toBeLessThan(12);
    // 大街：从南门到城的中心
    const street = pixel(paint, g, -400, 260);
    expect(street[0]).toBeGreaterThan(groundCol[0] + 12);
    // 小巷：城中心往南 75 米的那一条；横巷：城中心往东 100 米的那一条
    expect(pixel(paint, g, -330, 235)[0]).toBeGreaterThan(groundCol[0] + 5);
    expect(pixel(paint, g, -300, 150)[0]).toBeGreaterThan(groundCol[0] + 5);
    // 城中心往北没有街（那边没有城门）
    expect(Math.abs(pixel(paint, g, -400, 40)[0] - groundCol[0])).toBeLessThan(12);
  });

  it('城外的路是比平地深一点的细线；进了城就不画', () => {
    // 同一块地面，去掉那条路再画一遍，逐点比
    const noRoad = paintGround({ ...g, roads: [] }, STYLE);
    // 路从南门出来往南，到 z = 600 一带略偏东（线顺过了）
    const on = pixel(paint, g, -390, 600);
    const off = pixel(noRoad, g, -390, 600);
    expect(on[1]).toBeLessThan(off[1] - 8);
    expect(on[2]).toBeLessThan(off[2] - 5);
    // 离路 60 米以外一模一样
    expect(pixel(paint, g, -320, 600)).toEqual(pixel(noRoad, g, -320, 600));
    expect(pixel(paint, g, -1100, 300)).toEqual(pixel(noRoad, g, -1100, 300));
    // 路的头在南门（城墙线上）：城里那一小截不画
    expect(pixel(paint, g, -400, 320)).toEqual(pixel(noRoad, g, -400, 320));
  });

  it('第四个字节是“这里有没有田”：平地上有，城里、河里、山上、路上没有', () => {
    let fields = 0;
    for (let k = 3; k < paint.colour.length; k += 4) if (paint.colour[k] > 128) fields++;
    expect(fields).toBeGreaterThan(1000);
    expect(pixel(paint, g, -400, 160)[3]).toBe(0);
    expect(pixel(paint, g, -330, 150)[3]).toBe(0);
    expect(pixel(paint, g, -100, -800)[3]).toBe(0);
    expect(pixel(paint, g, M.hill[0], M.hill[1])[3]).toBe(0);
    expect(pixel(paint, g, -400, 600)[3]).toBe(0);
  });

  it('修整垫高的地面和四周的平地一个颜色，上面也是田；垫出来的土丘才是山的颜色', () => {
    const area: BoxM = [-1300, 500, -900, 900];
    const change = (s: StopScene): void => {
      s.dressing.push(dressing({ id: 'fields', kind: 'fields' }));
    };
    const flat = build(change).ground;
    const raised = build((s) => {
      change(s);
      s.terrain.edits.push(level('fill', area, 'raise', 46, 60));
    }).ground;
    const mound = build((s) => {
      change(s);
      s.terrain.edits.push({ ...grounds(), id: 'knoll', name: 'knoll', op: 'mound', at: fixturePoint(-1100, 700), addM: 6, innerM: 200, outerM: 320 });
    }).ground;
    const base = paintGround(flat, STYLE);
    const up = paintGround(raised, STYLE);
    const hill = paintGround(mound, STYLE);
    let compared = 0;
    let ochre = 0;
    for (let x = -1250; x <= -950; x += 50) {
      for (let z = 550; z <= 850; z += 50) {
        const a = pixel(base, flat, x, z);
        const b = pixel(up, raised, x, z);
        // 垫高了 5 米多，颜色和没垫的时候一样，田也还在
        for (let c = 0; c < 4; c++) expect(Math.abs(a[c] - b[c])).toBeLessThanOrEqual(2);
        compared++;
        // 同样高的土丘是赭石色：比平地红得多，没有田
        const m = pixel(hill, mound, x, z);
        if (m[0] - m[2] > a[0] - a[2] + 20 && m[3] === 0) ochre++;
      }
    }
    expect(compared).toBe(49);
    expect(ochre).toBeGreaterThan(25);
  });

  it('壕这样窄的水道不带一大片留白：离它几十米的地方照样是田', () => {
    // 壕西边 45 米的一条线（x = −720）：有壕和没有壕，田差不多一样多
    const change = (s: StopScene): void => {
      s.dressing.push(dressing({ id: 'fields', kind: 'fields' }));
    };
    const withMoat = build(change).ground;
    const without = build((s) => {
      change(s);
      s.water.rivers = s.water.rivers.filter((r) => r.kind !== 'moat');
    }).ground;
    const a = paintGround(withMoat, STYLE);
    const b = paintGround(without, STYLE);
    let sumA = 0;
    let sumB = 0;
    for (let z = 0; z <= 360; z += 10) {
      sumA += pixel(a, withMoat, -720, z)[3];
      sumB += pixel(b, without, -720, z)[3];
    }
    expect(sumB).toBeGreaterThan(1000);
    expect(sumA).toBeGreaterThan(sumB * 0.8);
    // 河就不一样：离河岸 45 米的地方田很淡（河边留白）
    let nearRiver = 0;
    for (let z = -900; z <= -500; z += 10) nearRiver += pixel(a, withMoat, -100 - 60 - 45, z)[3];
    let farFromRiver = 0;
    for (let z = -900; z <= -500; z += 10) farFromRiver += pixel(a, withMoat, -100 - 60 - 200, z)[3];
    expect(nearRiver).toBeLessThan(farFromRiver * 0.5);
  });

  it('田是登记了才有的：没有 fields 规则，第四个字节全是 0', () => {
    const bare = paintGround(plainBuild.ground, STYLE);
    let fields = 0;
    for (let k = 3; k < bare.colour.length; k += 4) if (bare.colour[k] > 0) fields++;
    expect(fields).toBe(0);
  });

  it('田写了 area 的，只画在那一块里', () => {
    const { ground: part } = build((s) => s.dressing.push(dressing({ id: 'west-fields', kind: 'fields', area: boxArea([-1400, -400, -900, 400]) })));
    const p = paintGround(part, STYLE);
    let inside = 0;
    for (let j = 0; j < p.h; j++) {
      for (let i = 0; i < p.w; i++) {
        if (p.colour[(j * p.w + i) * 4 + 3] === 0) continue;
        const x = part.x0 + i * 10;
        const z = part.z0 + j * 10;
        expect(x).toBeGreaterThanOrEqual(-1400);
        expect(x).toBeLessThanOrEqual(-900);
        expect(z).toBeGreaterThanOrEqual(-400);
        expect(z).toBeLessThanOrEqual(400);
        inside++;
      }
    }
    expect(inside).toBeGreaterThan(300);
  });

  it('颜色只从样式里取：换一种平地的颜色，平地跟着变', () => {
    const red = paintGround(g, { ...STYLE, colours: { ...STYLE.colours, tea: '#ff0000', teaWarm: '#ff0000' } });
    const [r, gr] = pixel(red, g, -1100, 300);
    expect(r).toBeGreaterThan(gr + 20);
  });

  it('手做的地面（tests/stage/support/flatGround.ts）也画得出来，取数的约定和它自带的一样', () => {
    const flat = flatGround();
    const p = paintGround(flat, STYLE);
    expect([p.w, p.h]).toEqual([301, 241]);
    expect(p.normals.length).toBe(flat.nx * flat.nz * 4);
    // 城里的大街（南门到城的中心）比旁边的地面亮
    expect(pixel(p, flat, -400, 260)[0]).toBeGreaterThan(pixel(p, flat, -330, 150)[0] + 12);
    const mine = samplers(flat);
    const theirs = flatSamplers(flat);
    for (const [x, z] of [
      [-1000, -700],
      [-395, 163],
      [803, -207],
      [-101, 512],
      [5000, -5000],
    ]) {
      expect(mine.height(x, z)).toBe(theirs.height(x, z));
      expect(mine.waterH(x, z)).toBe(theirs.waterH(x, z));
      expect(mine.edge(x, z)).toBe(theirs.edge(x, z));
      expect(mine.hill(x, z)).toBe(theirs.hill(x, z));
      expect(mine.hillSoft(x, z)).toBe(theirs.hillSoft(x, z));
    }
  });

  it('法线图：平地朝正上方；山的东坡朝东、西坡朝西，坡度按夸大以后的算', () => {
    const normal = (x: number, z: number): number[] => {
      const k = cellOf(g, x, z) * 4;
      return [paint.normals[k], paint.normals[k + 1], paint.normals[k + 2], paint.normals[k + 3]];
    };
    const flat = normal(-1100, 300);
    expect(Math.abs(flat[0] - 128)).toBeLessThanOrEqual(1);
    expect(flat[1]).toBeGreaterThanOrEqual(254);
    expect(Math.abs(flat[2] - 128)).toBeLessThanOrEqual(1);
    expect(flat[3]).toBe(255);
    const east = normal(M.hill[0] + 200, M.hill[1]);
    const west = normal(M.hill[0] - 200, M.hill[1]);
    expect(east[0]).toBeGreaterThan(160);
    expect(west[0]).toBeLessThan(96);
    expect(east[1]).toBeLessThan(250);
    // 夸大的倍数小了，坡就缓了
    const gentle = paintGround({ ...g, reliefTimes: 1 }, STYLE).normals;
    expect(gentle[cellOf(g, M.hill[0] + 200, M.hill[1]) * 4]).toBeLessThan(east[0]);
  });
});

// ---------------------------------------------------------------- 这个文件夹只算数

describe('src/stage/ground 只算数', () => {
  const sources = import.meta.glob<string>('/src/stage/ground/**/*.ts', { query: '?raw', import: 'default', eager: true });
  /** 去掉注释，只看程序。 */
  const code = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('找得到这个文件夹里的文件', () => {
    const names = Object.keys(sources).map((path) => path.split('/').pop());
    expect(names).toContain('index.ts');
    expect(names).toContain('types.ts');
    expect(names.length).toBeGreaterThanOrEqual(8);
  });

  it('不从 three 拿东西，也不从 src/stage/three 拿东西', () => {
    for (const [path, text] of Object.entries(sources)) {
      const imports = code(text).match(/from\s+['"][^'"]+['"]|import\s*\(\s*['"][^'"]+['"]\s*\)/g) ?? [];
      for (const line of imports) expect(`${path}: ${line}`).not.toMatch(/three/);
    }
  });

  it('不碰页面：没有 document、window', () => {
    for (const [path, text] of Object.entries(sources)) {
      const touchesPage = /\b(document|window|navigator|requestAnimationFrame)\b/.test(code(text));
      expect(`${path}: ${touchesPage}`).toBe(`${path}: false`);
    }
  });
});

// ---------------------------------------------------------------- 修整压出来的宽水面

describe('修整压出来的宽水面（openWater）和最低的水位露出来的沙', () => {
  /** 小沙盘西边的平地上压出一块水面：x −1400 到 −1000，z −1000 到 −400，压到 31 米（平时的水位 37.6）；四周 60 米过渡。 */
  const POND = { x0: -1400, x1: -1000, z0: -1000, z1: -400, toM: 31, feather: 60 };
  /** 水面的西半边再垫回 36 米：比平时的水位低 1.6 米，比下面添的“水落” 34 米高 2 米——水落了它露出来。 */
  const SHELF = { x0: -1400, x1: -1200, toM: 36 };
  const ring = (x0: number, x1: number, z0: number, z1: number) => [fixturePoint(x0, z0), fixturePoint(x1, z0), fixturePoint(x1, z1), fixturePoint(x0, z1)];
  const withPond = (s: StopScene, low?: number): void => {
    s.terrain.edits.push(
      { id: 'pond', name: '压出来的水面', op: 'level', mode: 'lower', toM: POND.toM, featherM: POND.feather, area: ring(POND.x0, POND.x1, POND.z0, POND.z1), ...grounds() } as LevelEdit,
      { id: 'shelf', name: '水面里的滩', op: 'level', mode: 'raise', toM: SHELF.toM, featherM: 20, area: ring(SHELF.x0, SHELF.x1, POND.z0, POND.z1), ...grounds() } as LevelEdit,
    );
    if (low !== undefined) s.water.levels.values.low = low;
  };
  const pond = build((s) => withPond(s));
  const g = pond.ground;
  const plain = plainBuild.ground;
  /** 离河和壕都远的那一片（小沙盘的西边）：这里的 edge 只可能是这块水面给的。 */
  const west = (x: number): boolean => x <= -800;

  it('没有这样的地方：一格“种子”也没有，什么也不动（小沙盘原样）', () => {
    expect(plain.openSeeds).toBe(0);
    expect(plain.lowWaterM).toBeNull();
    // 每一格最近的还是画出来的河或壕（记的是它们画的宽度的一半），没有一格被当成宽水面的岸（那是 200）
    expect([...new Set(Array.from(plain.bankHalf))].sort((p, q) => p - q)).toEqual([0, M.moatWidth / 2, M.riverWidth / 2]);
    // 直接叫一遍：返回 0，三张网格一个字节不差
    const h = Float32Array.from(plain.h);
    const edge = Float32Array.from(plain.edge);
    const half = Float32Array.from(plain.bankHalf);
    expect(openWater(h, edge, half, plain, H.normal)).toBe(0);
    expect(h).toEqual(plain.h);
    expect(edge).toEqual(plain.edge);
    expect(half).toEqual(plain.bankHalf);
  });

  it('两个门槛：比平时的水位低不到 0.25 米的不算；在画出来的河的岸外 20 米以内的不算；过了两个门槛的才算', () => {
    const grid = { nx: 5, nz: 5, cell: 20 };
    const make = (dip: number, edgeAt: number) => {
      const h = new Float32Array(25).fill(40);
      const edge = new Float32Array(25).fill(1e6);
      const half = new Float32Array(25);
      h[12] = 37.6 - dip;
      edge[12] = edgeAt;
      return { h, edge, half };
    };
    expect([OPEN_SEED_BELOW_M, OPEN_SEED_OUTSIDE_M]).toEqual([0.25, 20]);
    // 低了一丝（程序挖河时岸坡正好斜到水位，差在小数点后第四位上的格子徐州有 8 格）
    for (const [dip, at] of [[0.0001, 1e6], [0.2, 1e6], [0.24, 1e6], [3, 5], [3, 20], [3, -40]] as const) {
      const a = make(dip, at);
      const before = Float32Array.from(a.edge);
      expect(openWater(a.h, a.edge, a.half, grid, 37.6), `低 ${dip} 米、离岸 ${at} 米`).toBe(0);
      expect(a.edge).toEqual(before);
      expect(Array.from(a.half).every((v) => v === 0)).toBe(true);
    }
    // 明明白白低、明明白白在河外面：算。它自己成了水（负数），四邻成了岸边（几米到二十米）
    const b = make(0.3, 21);
    expect(openWater(b.h, b.edge, b.half, grid, 37.6)).toBe(1);
    expect(b.edge[12]).toBeLessThan(0);
    expect(b.edge[12]).toBeGreaterThan(-20);
    for (const k of [7, 11, 13, 17]) {
      expect(b.edge[k]).toBeGreaterThan(0);
      expect(b.edge[k]).toBeLessThanOrEqual(20);
      expect(b.half[k]).toBe(200);
    }
    // 岸在两格之间“地面正好是水位”的地方：水里的这一格离它 20 × 0.3 ÷ 2.7 米，岸上的那一格是剩下的
    expect(b.edge[12]).toBeCloseTo((-20 * 0.3) / 2.7, 3);
    expect(b.edge[13]).toBeCloseTo(20 - (20 * 0.3) / 2.7, 3);
  });

  it('压出来的水面：里面是负数，越往里越小；外面是正数，越往外越大；岸就在地面和平时的水位相交的地方', () => {
    expect(g.openSeeds).toBeGreaterThan(300);
    expect(g.lowWaterM).toBeNull();
    const at = pond.at;
    // 深处（东半边的正中）离岸一百多米；滩的正中也在水里
    expect(at.edge(-1100, -700)).toBeLessThan(-80);
    expect(at.edge(-1300, -700)).toBeLessThan(-80);
    expect(at.edge(-1100, -700)).toBeGreaterThan(-320);
    // 往东出去：圈外 60 米过渡，岸在过渡带里；再往外一路变大
    const east = [-960, -900, -860, -820].map((x) => at.edge(x, -700));
    expect(east[0]).toBeGreaterThan(0);
    east.slice(1).forEach((v, i) => expect(v).toBeGreaterThan(east[i] + 20));
    expect(at.edge(-900, -700)).toBeGreaterThan(40);
    expect(at.edge(-900, -700)).toBeLessThan(100);
    // 一格一格看：西边这一片里，比平时的水位低的格子都是负数，别的都是正数；岸两边紧挨着的两格都在 20 米以内
    let wet = 0;
    eachCell(g, (k, x) => {
      if (!west(x)) return;
      const under = g.h[k] < H.normal;
      if (under) wet++;
      expect(g.edge[k] < 0, `第 ${k} 格`).toBe(under);
      if (x + g.cell <= -800 && g.h[k + 1] < H.normal !== under) {
        expect(Math.abs(g.edge[k])).toBeLessThanOrEqual(g.cell);
        expect(Math.abs(g.edge[k + 1])).toBeLessThanOrEqual(g.cell);
        expect(Math.abs(g.edge[k]) + Math.abs(g.edge[k + 1])).toBeCloseTo(g.cell, 3);
      }
    });
    expect(wet).toBeGreaterThan(600);
    // 岸边照宽的河上色（不是壕那样一道细边）；河那边、壕那边原来的数不动
    expect(g.bankHalf[cellOf(g, -1100, -700)]).toBe(200);
    expect(g.bankHalf[cellOf(g, -900, -700)]).toBe(200);
    expect(g.bankHalf[cellOf(g, -100, -800)]).toBe(M.riverWidth / 2);
    expect(g.edge[cellOf(g, -100, -800)]).toBe(plain.edge[cellOf(g, -100, -800)]);
    // 水面四周算河边，不算山，也不摆村子、不种田（下游读的都是 edge）
    expect(g.hill[cellOf(g, -1100, -700)]).toBe(0);
    for (const v of g.villages) expect(pond.at.edge(v.x, v.z), `村子 (${v.x}, ${v.z})`).toBeGreaterThan(0);
  });

  it('壕这样窄的水道不会被别处的宽水面改成“宽的河”：有了压出来的水面，壕里和壕边的格子还是原来的数', () => {
    // 壕的格子也比平时的水位低；宽水面的那一遍量岸要是把它们也换了，壕的岸就一块一块地成了大河的留白和水纹
    let narrow = 0;
    eachCell(plain, (k) => {
      if (plain.bankHalf[k] !== M.moatWidth / 2 || plain.edge[k] > OPEN_SEED_OUTSIDE_M) return;
      narrow++;
      expect(g.bankHalf[k], `第 ${k} 格的半宽`).toBe(M.moatWidth / 2);
      expect(g.edge[k], `第 ${k} 格到岸多远`).toBe(plain.edge[k]);
    });
    expect(narrow).toBeGreaterThan(100);
  });

  it('上色：水面里面是水底的淡花青，岸边留白；没有比平时低的水位时，滩和深处一个颜色', () => {
    const paint = paintGround(g, STYLE);
    const deep = pixel(paint, g, -1100, -700);
    const shelf = pixel(paint, g, -1300, -700);
    const land = pixel(paint, g, -1200, 300);
    // 平地：红比蓝多得多；水底偏蓝得多（这块水面挨着沙盘的西北角，四边留的空绢把颜色冲淡了一些，所以比着平地说）
    expect(land[0]).toBeGreaterThan(land[2] + 25);
    expect(deep[0] - deep[2]).toBeLessThan(land[0] - land[2] - 20);
    expect(shelf[0] - shelf[2]).toBeLessThan(land[0] - land[2] - 20);
  });

  it('最低的水位比平时低：它露出来的地面（滩）是沙色，比它还低的地方还是水底的颜色；别处一个字节不差', () => {
    const low = build((s) => withPond(s, 34));
    expect(low.ground.lowWaterM).toBe(34);
    // 最低的水位只差一丝（不到 0.01 米）不算
    expect(build((s) => withPond(s, H.normal - 0.005)).ground.lowWaterM).toBeNull();
    const before = paintGround(g, STYLE);
    const after = paintGround(low.ground, STYLE);
    const sand: [number, number, number] = [0xe6, 0xdb, 0xb9];
    const bed: [number, number, number] = [0xb7, 0xc9, 0xc8];
    const far = (p: number[], c: number[]): number => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
    const shelf = pixel(after, low.ground, -1300, -700);
    const deep = pixel(after, low.ground, -1100, -700);
    // 滩（36 米，在 34 和 37.6 之间）：离沙色近；深处（31 米）：离水底的颜色近
    expect(far(shelf, sand)).toBeLessThan(far(shelf, bed) - 20);
    expect(far(deep, bed)).toBeLessThan(far(deep, sand) - 20);
    expect(shelf[0]).toBeGreaterThan(shelf[2] + 20);
    // 同一个点，没有“水落”这一档时是水底的颜色：红减蓝差出三十多
    const was = pixel(before, g, -1300, -700);
    expect(shelf[0] - shelf[2] - (was[0] - was[2])).toBeGreaterThan(25);
    // 深处、岸上、河里、城里：和没有“水落”这一档时一个字节不差；变了的点都在滩那一带
    expect(pixel(after, low.ground, -1100, -700)).toEqual(pixel(before, g, -1100, -700));
    let changed = 0;
    for (let k = 0; k < after.colour.length; k += 4) {
      if (after.colour[k] === before.colour[k] && after.colour[k + 1] === before.colour[k + 1] && after.colour[k + 2] === before.colour[k + 2]) continue;
      changed++;
      const x = g.x0 + ((k / 4) % after.w) * (g.cell / 2);
      const z = g.z0 + Math.floor(k / 4 / after.w) * (g.cell / 2);
      // 变了的点：都在水边 8 米以内或者水里（上水底颜色的地方），地面都比“水落”高（差 0.3 米以内的在过渡里）。
      // 河边、壕边的浅处也在里面：那里的地面同样比“水落”高
      expect(pond.at.edge(x, z), `(${x}, ${z})`).toBeLessThan(8);
      expect(pond.at.height(x, z), `(${x}, ${z})`).toBeGreaterThan(34 - 0.31);
    }
    expect(changed).toBeGreaterThan(1000);
  });
});

// ---------------------------------------------------------------- 徐州真的地形文件

describe('徐州真的地形文件', () => {
  /** 只有范围、地形和整理的办法，别的都空着（数和定稿的样张一样）。 */
  function xuzhouTerrainOnly(): StopScene {
    const scene = fixtureScene();
    scene.frame = { center: [117.185, 34.2655], westM: 6300, eastM: 5400, northM: 5400, southM: 4300, datumM: 40, relief: { kind: 'uniform', times: 6 } };
    scene.terrain = {
      ...scene.terrain,
      file: 'xuzhou.terrain.bin',
      cols: 415,
      rows: 334,
      west: 117.05,
      east: 117.32,
      south: 34.17,
      north: 34.35,
      recipe: { ...scene.terrain.recipe, plainBelowM: 47, hillAboveM: 60, plainBaseM: 40, plainKeep: 0.1, edgeTaperM: 460 },
      edits: [],
    };
    scene.water.rivers = [];
    scene.places = [];
    scene.things = [];
    scene.dressing = [];
    scene.strips = [];
    scene.far = [];
    return scene;
  }

  it('读得出来，整理得出来：平地在 40 米上下，云龙山还是山', () => {
    const scene = xuzhouTerrainOnly();
    const dem = readDem(scene.terrain, readBytes('content/figures/su-shi/scenes/xuzhou.terrain.bin'));
    expect(dem.heights.length).toBe(415 * 334);
    let low = Infinity;
    let high = -Infinity;
    for (const v of dem.heights) {
      low = Math.min(low, v);
      high = Math.max(high, v);
    }
    expect(low).toBeGreaterThan(0);
    expect(high).toBeLessThan(400);

    const started = performance.now();
    const g = buildFields(scene, dem);
    const took = performance.now() - started;
    expect([g.nx, g.nz]).toEqual([586, 486]);
    expect(took).toBeLessThan(10_000);

    const at = samplers(g);
    // 沙盘里的米：城西的平地、云龙山（[117.1723, 34.2394]）、沙盘的西北角
    expect(Math.abs(at.height(-4140, 610) - 40)).toBeLessThan(2);
    expect(at.height(-1168, 2896)).toBeGreaterThan(70);
    expect(at.hill(-1168, 2896)).toBe(1);
    expect(at.height(-6300, -5400)).toBeLessThanOrEqual(40.3 + 1e-3);
    // 没有河、没有城：哪里都不比平地低很多，也没有水漫不进去的地方
    let lowest = Infinity;
    for (const v of g.h) lowest = Math.min(lowest, v);
    expect(lowest).toBeGreaterThan(36);
    expect(g.dry.every((d) => d === 0)).toBe(true);
  });
});

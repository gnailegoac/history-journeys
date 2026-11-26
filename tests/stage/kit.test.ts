// 零件库（src/stage/three/kit）的测试。在 Node 里跑，没有页面：材质不带贴图，形状一点不差。
// 用的是几组测试共用的那座小沙盘（tests/support/fixtureScene.ts）和手做的地面（tests/stage/support/flatGround.ts）。
//
// 模型只有一套，远了近了由显卡照每个顶点带的记号算。这里没有显卡：着色器里的那一段算术在
// src/stage/three/kit/figureMaterial.ts 里用 TypeScript 又写了一遍（figureMove、figureShow），测试用它查
// “每个顶点现在在哪、多大”。着色器真的编译出来、画出来什么样，要到浏览器里看。

import { describe, expect, it, vi } from 'vitest';
import { ShaderLib } from 'three';
import type { BufferGeometry, Group, InstancedMesh, Mesh, Object3D } from 'three';
import { DRESSING_KINDS, FAMILY_THING_KINDS, THING_KINDS } from '../../src/domain/sceneKinds';
import type { SceneDressing, SceneThing, StopScene, ThingKind, When } from '../../src/domain/scene';
import { frameCoords } from '../../src/domain/sceneGeo';
import { gateSeats } from '../../src/stage/ground';
import type { Ground, GroundColour, Vec2, Vec3 } from '../../src/stage/ground/types';
import type { FigureClass, KitContext, Quality, StageStyle } from '../../src/stage/three/internal';
import { buildModels } from '../../src/stage/three/kit';
import { presentIn } from '../../src/stage/three/kit/assemble';
import { DRESSING_BUILDERS, MOORED_GAP_M, MOORED_SLOT_M } from '../../src/stage/three/kit/dressing';
import { detailGone, figureNow, liftClass } from '../../src/stage/three/kit/figure';
import {
  FIGURE_SLOT,
  FIGURE_SLOTS,
  FIG_DETAIL,
  FIG_ON_WALL,
  FIG_TREE,
  FIG_TREE_DOT,
  FIG_TREE_FINE,
  FIG_WET,
  KEEP_FRINGE,
  figureMove,
  figureShow,
  figureVertex,
  makeFigureUniforms,
  setFigure,
} from '../../src/stage/three/kit/figureMaterial';
import type { FigureMarks, FigureUniforms } from '../../src/stage/three/kit/figureMaterial';
import { Batch } from '../../src/stage/three/kit/geo';
import { MATERIAL_NAMES, makeMaterials } from '../../src/stage/three/kit/materials';
import { dressingParams, thingParams } from '../../src/stage/three/kit/params';
import type { Bucket, Pass } from '../../src/stage/three/kit/pass';
import { cornerOffset, insideRing, lineDistance, makeRing, nearestOnRing, ringDistance, ringPath, snapLineToRing, surveyWalls } from '../../src/stage/three/kit/site';
import { PILE_ABOVE, THING_BUILDERS, bankSurfaceY } from '../../src/stage/three/kit/things';
import type { ThingBuilder } from '../../src/stage/three/kit/things';
import { style as songQinglv } from '../../src/stage/three/style/song-qinglv/song-qinglv';
import { SONG_QINGLV_FIGURE } from '../../src/stage/three/style/song-qinglv/figure';
import { FIXTURE_HEADINGS, FIXTURE_HEIGHTS, FIXTURE_M, fixturePoint, fixtureScene } from '../support/fixtureScene';
import { flatGround, flatSamplers } from './support/flatGround';

// ---------------------------------------------------------------- 测试用的样式、画质和沙盘

const GROUND_COLOURS: Record<GroundColour, string> = {
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
};

/** 测试自己的样式：颜色的名字照样张的 PAL，加上夯土色；数是样张的数。不靠沙盘程序里真的那一份。 */
const testStyle: StageStyle = {
  id: 'song-qinglv',
  palette: {
    ...GROUND_COLOURS,
    tile: '#70767a',
    plaster: '#efe8d6',
    vermilion: '#9a3a2c',
    earthYellow: '#c8a765',
    timber: '#4b3229',
    brick: '#a9a08c',
    stone: '#c7bda4',
    earth: '#d6ba7c',
    thatch: '#a38a58',
    boat: '#74513a',
    tree: '#4a6e56',
    treeBlue: '#47705f',
    treeOlive: '#6b7d50',
    willow: '#7c9468',
    dot: '#5d8268',
    rock: '#6d767b',
    rockPale: '#d9d5c6',
    rammedEarth: '#bda27a',
    bankEarth: '#c9b791',
  },
  ground: { colours: GROUND_COLOURS, bands: { foot: [2.4, 8], green: [7, 22], blue: [40, 84], deepBlue: [88, 125] } },
  // 模型跟着远近怎么变：用真的那一份表
  figure: SONG_QINGLV_FIGURE,
  stripLift: { wall: 62, gate: 8, tower: 76, pavilion: 30, 'hall-group': 40, house: 14, dike: 30, bank: 6, 'timber-bank': 10, cliff: 100, 'earth-wall': 12, 'small-gate': 24, 'pontoon-bridge': 8, pool: 5, 'grave-mound': 15 },
  light: () => ({ dir: [-0.66, 0.6, -0.42], sun: 2.6, sunColor: '#fff4e2', hemi: 1.55, sky: '#fffaf0', ground: '#c4b494' }),
  fogFor: () => [40000, 140000],
  mistFor: () => 1,
  // 装裱和座子是样式自己造的；零件库不造它，这里的测试也用不着：交一个一造就说话的
  stand: {
    reachM: 0,
    reachY: 0,
    build: () => {
      throw new Error('零件库的测试不造座子');
    },
  },
};

const FULL: Quality = { tier: 'full', pixelRatioCap: 2, maxDrawPixels: 4_000_000, antialias: true, shadowMapSize: 2048, treeKeep: 1, houseKeep: 1, mistLayers: 3 };

const [FIRST, SECOND] = FIXTURE_HEADINGS;
const M = FIXTURE_M;

function makeCtx(scene: StopScene = fixtureScene(), ground: Ground = flatGround(), quality: Quality = FULL): KitContext {
  return { scene, ground, samplers: flatSamplers(ground), coords: frameCoords(scene.frame), style: testStyle, quality };
}

/** 类别和依据：测试里添的东西都用这一份。 */
const GROUNDS = { class: 'schematic', basis: '测试里添的。', sourceIds: [] } as const;

function thing(id: string, kind: ThingKind, more: Partial<SceneThing>): SceneThing {
  return { id, name: id, kind, ...GROUNDS, sourceIds: [], ...more };
}
function rule(id: string, kind: SceneDressing['kind'], more: Partial<SceneDressing>): SceneDressing {
  return { id, name: id, kind, class: 'dressing', basis: '测试里添的。', sourceIds: [], ...more };
}

const REDUCED: Quality = { ...FULL, tier: 'reduced', treeKeep: 0.5, houseKeep: 0.5 };

/**
 * 沙盘程序自己带着的九种摆件的造法。按家分块的（崖壁）不在 THING_BUILDERS 里，这个文件里编出来的场景也不摆它们：
 * 它们在 tests/stage/kit-families.test.ts 和 huangzhou-figures.test.ts 里查。
 */
function coreBuilder(kind: ThingKind): ThingBuilder {
  const build = (THING_BUILDERS as Partial<Record<ThingKind, ThingBuilder>>)[kind];
  if (!build) throw new Error(`${kind} 是按家分块的零件，不在沙盘程序自己的表里`);
  return build;
}

/** 只走一种零件：所有东西放进同一组，好数、好量。 */
function soloPass(ctx: KitContext): { pass: Pass; bucket: Bucket } {
  const bucket: Bucket = { main: new Batch(), raised: new Batch(), boats: [] };
  const pass: Pass = { ctx, survey: surveyWalls(ctx), yards: [], lots: [], bucket: () => bucket };
  return { pass, bucket };
}

/** 镜头在 D 这么远、水面在 levelM 时，交给显卡的那一份数（用测试自己的样式）。 */
function figureAt(D: number, levelM: number = FIXTURE_HEIGHTS.normal, style: StageStyle = testStyle): FigureUniforms {
  const coords = frameCoords(fixtureScene().frame);
  const u = makeFigureUniforms();
  setFigure(u, style, D, coords.y(levelM), coords.y(levelM + 1) - coords.y(levelM));
  return u;
}

/** 一个零件（并进网格以前）带的记号：它的每个顶点带的都一样，取第一个。 */
function marksOf(g: BufferGeometry, i = 0): FigureMarks {
  const p = g.attributes.aPivot;
  const q = g.attributes.aGroup;
  const f = g.attributes.aFig;
  return { pivot: [p.getX(i), p.getY(i), p.getZ(i)], group: [q.getX(i), q.getY(i), q.getZ(i)], fig: [f.getX(i), f.getY(i), f.getZ(i), f.getW(i)] };
}

/** 一个零件在这一份数下画出来占的范围（每个顶点照显卡的算术挪过）。 */
function movedBox(g: BufferGeometry, u: FigureUniforms): Box {
  const pos = g.attributes.position;
  const box: Box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity, vertices: pos.count };
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = figureMove([pos.getX(i), pos.getY(i), pos.getZ(i)], marksOf(g, i), u);
    box.x0 = Math.min(box.x0, x);
    box.x1 = Math.max(box.x1, x);
    box.y0 = Math.min(box.y0, y);
    box.y1 = Math.max(box.y1, y);
    box.z0 = Math.min(box.z0, z);
    box.z1 = Math.max(box.z1, z);
  }
  return box;
}

/** 批次里某一种材质的零件。 */
const partsOf = (batch: Batch, material: string): BufferGeometry[] => batch.parts.get(material) ?? [];

/** 一个零件原样占的范围。 */
function boxOf(g: BufferGeometry): Box {
  g.computeBoundingBox();
  const b = g.boundingBox;
  if (!b) throw new Error('量不出范围');
  return { x0: b.min.x, x1: b.max.x, y0: b.min.y, y1: b.max.y, z0: b.min.z, z1: b.max.z, vertices: g.attributes.position.count };
}

const slotOf = (cls: FigureClass): number => FIGURE_SLOT[cls];

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
  vertices: number;
}

/** 批次里某一种材质的每个零件占的范围。 */
function boxesOf(batch: Batch, material: string): Box[] {
  return partsOf(batch, material).map(boxOf);
}
const covers = (b: Box, x: number, z: number): boolean => x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1;
/** 城墙的墙身：六边截面的棱柱，84 个顶点（垛口、角台是盒子，36 个）。 */
const wallBodies = (batch: Batch): Box[] => boxesOf(batch, 'rammed').filter((b) => b.vertices === 84);
/** 角台：从墙脚以下一直到比墙顶还高的大方墩。 */
const cornerBlocks = (batch: Batch): Box[] => boxesOf(batch, 'rammed').filter((b) => b.vertices === 36 && b.y1 - b.y0 > 80);

const visibleNames = (group: Group): string[] =>
  group.children
    .filter((c) => c.visible)
    .map((c) => c.name)
    .sort();

/** 四面各一座城门的小沙盘。 */
function fourGateScene(): StopScene {
  const scene = fixtureScene();
  const W = M.wall;
  scene.things.push(
    thing('gate-north', 'gate', { at: fixturePoint(M.city[0], W.z0), on: 'wall' }),
    thing('gate-east', 'gate', { at: fixturePoint(W.x1, M.city[1]), on: 'wall' }),
    thing('gate-west', 'gate', { at: fixturePoint(W.x0, M.city[1]), on: 'wall' }),
  );
  return scene;
}
const FOUR_GATES: Vec2[] = [
  [M.city[0], M.wall.z1],
  [M.city[0], M.wall.z0],
  [M.wall.x1, M.city[1]],
  [M.wall.x0, M.city[1]],
];

/** 每种摆件、每种点缀都有的一座沙盘。 */
function everythingScene(): StopScene {
  const scene = fourGateScene();
  const W = M.wall;
  const cx = M.city[0];
  const cz = M.city[1];
  scene.things.push(
    thing('tower-east', 'tower', { at: fixturePoint(W.x1, cz), on: 'gate-east', params: { size: 'small', storeys: 1 } }),
    thing('tower-corner', 'tower', { at: fixturePoint(W.x1, W.z0), on: 'wall', params: { size: 'small' } }),
    thing('tower-free', 'tower', { at: fixturePoint(-1000, 600), params: { storeys: 2, timber: 'plain', walls: 'yellow-wash' } }),
    thing('pavilion-corner', 'pavilion', { at: fixturePoint(W.x1, W.z1), on: 'wall', when: { from: SECOND } }),
    thing('pavilion-hill', 'pavilion', { at: fixturePoint(700, -200), facing: 270, params: { roof: 'thatch' } }),
    thing('yamen', 'hall-group', { at: fixturePoint(cx - 60, cz - 60), params: { halls: 2, enclosed: true } }),
    thing('temple', 'hall-group', { at: fixturePoint(800, -200), params: { halls: 3, galleries: true, enclosed: true, terraced: true } }),
    thing('hut', 'house', { at: fixturePoint(500, -200), params: { roof: 'thatch', fence: true }, when: { until: FIRST } }),
    thing('shed', 'house', { at: fixturePoint(W.x1, cz + 120), on: 'wall', when: { only: [SECOND] } }),
    thing('dike', 'dike', { line: [fixturePoint(-300, 700), fixturePoint(-300, 500), fixturePoint(-320, 380)], params: { topM: 45 }, when: { from: SECOND } }),
    thing('dike-inner', 'dike', { line: [fixturePoint(W.x1 - 30, W.z1 - 30), fixturePoint(W.x1 - 30, W.z0 + 30), fixturePoint(W.x0 + 30, W.z0 + 30)], on: 'wall', params: { topM: 44 } }),
    thing('bank', 'bank', { line: [fixturePoint(W.x0, W.z0), fixturePoint(W.x1, W.z0), fixturePoint(W.x1, W.z1)], on: 'wall' }),
    thing('bank-free', 'bank', { line: [fixturePoint(300, 900), fixturePoint(500, 900)] }),
    thing('timber-bank', 'timber-bank', { line: [fixturePoint(-140, 380), fixturePoint(-140, 460)] }),
  );
  scene.dressing.push(
    rule('streets', 'roads', { inside: 'wall', params: { type: 'street' } }),
    rule('road', 'roads', { line: [fixturePoint(-400, 420), fixturePoint(-400, 1100)], params: { type: 'road' } }),
    rule('villages', 'villages', { params: { count: 2 } }),
    rule('fields', 'fields', {}),
    rule('trees', 'trees', { params: { type: 'mixed' } }),
    rule('willows', 'trees', { line: M.river.map((p) => fixturePoint(p[0], p[1])), params: { type: 'willow' } }),
    rule('pines', 'trees', { at: fixturePoint(800, -200), params: { type: 'pine', radiusM: 200 } }),
    rule('orchard', 'trees', { area: [fixturePoint(300, 300), fixturePoint(700, 300), fixturePoint(700, 600), fixturePoint(300, 600)], params: { type: 'fruit' }, when: { until: FIRST } }),
    rule('moored', 'boats', { line: [fixturePoint(W.x1 + 70, W.z1 - 20), fixturePoint(W.x1 + 70, W.z0 + 20)], params: { count: 8, moored: true }, when: { only: [SECOND] } }),
    rule('small-boats', 'boats', { at: fixturePoint(-100, 700), params: { type: 'small', count: 2, moored: false, radiusM: 120 } }),
    rule('rapids-rocks', 'rocks', { at: fixturePoint(-100, 800), params: { type: 'grey', count: 30, radiusM: 200 } }),
    rule('sheep-rocks', 'rocks', { at: fixturePoint(800, -150), params: { type: 'pale', count: 12, radiusM: 120 } }),
    rule('suburb', 'houses', { area: [fixturePoint(-1300, 300), fixturePoint(-900, 300), fixturePoint(-900, 700), fixturePoint(-1300, 700)] }),
  );
  return scene;
}

/** 模型里每个顶点的数都是正常的数。 */
function expectAllFinite(root: Object3D): void {
  let meshes = 0;
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    meshes++;
    const p = m.geometry.attributes.position.array;
    for (let i = 0; i < p.length; i++) {
      if (!Number.isFinite(p[i])) throw new Error(`${m.parent?.parent?.name ?? ''} 里有一个顶点的数不对`);
    }
  });
  expect(meshes).toBeGreaterThan(0);
}

// ---------------------------------------------------------------- 表和参数

describe('零件的表', () => {
  it('九种摆件、七种点缀各有一个造法；按家分块的摆件不在沙盘程序自己的表里', () => {
    expect(Object.keys(THING_BUILDERS).sort()).toEqual(THING_KINDS.filter((kind) => !(FAMILY_THING_KINDS as readonly string[]).includes(kind)).sort());
    expect(Object.keys(THING_BUILDERS)).toHaveLength(9);
    expect(Object.keys(DRESSING_BUILDERS).sort()).toEqual([...DRESSING_KINDS].sort());
  });

  it('参数只照表读：表里没有的、样子不对的都当没写', () => {
    expect(thingParams('wall', { face: 'brick', parapet: false })).toEqual({ face: 'brick', parapet: false });
    expect(thingParams('wall', { face: 'marble', parapet: 'yes', height: 12 })).toEqual({});
    expect(thingParams('tower', { storeys: 2, size: 'large', walls: 'yellow-wash', timber: 'plain' })).toEqual({ storeys: 2, size: 'large', walls: 'yellow-wash', timber: 'plain' });
    expect(thingParams('gate', undefined)).toEqual({});
    expect(dressingParams('boats', { type: 'small', count: 3, moored: true, radiusM: 80, seed: 5, sail: true })).toEqual({ type: 'small', count: 3, moored: true, radiusM: 80, seed: 5 });
    expect(dressingParams('houses', { density: Number.NaN, lanes: true })).toEqual({ lanes: true });
  });
});

describe('什么时候有（presentIn）', () => {
  const headings = ['一', '二', '三', '四'];
  const cases: [string, When | undefined, boolean[]][] = [
    ['不写就是一直有', undefined, [true, true, true, true]],
    ['from：从那一节起，含那一节', { from: '二' }, [false, true, true, true]],
    ['until：到那一节为止，含那一节', { until: '二' }, [true, true, false, false]],
    ['from 和 until 一起写', { from: '二', until: '三' }, [false, true, true, false]],
    ['only：只在这几节', { only: ['一', '四'] }, [true, false, false, true]],
    ['标题写错了的，哪一节都没有', { from: '五' }, [false, false, false, false]],
  ];
  for (const [name, when, expected] of cases) {
    it(name, () => expect(presentIn(when, headings)).toEqual(expected));
  }
});

// ---------------------------------------------------------------- 城墙那一圈线

describe('城墙那一圈线上的算术', () => {
  const W = M.wall;
  const square: Vec2[] = [
    [W.x0, W.z0],
    [W.x1, W.z0],
    [W.x1, W.z1],
    [W.x0, W.z1],
  ];

  it('每一面朝外的方向都朝着城外，顺时针、逆时针写都一样', () => {
    for (const pts of [square, [...square].reverse()]) {
      const ring = makeRing(pts);
      for (const s of ring.sides) {
        expect(insideRing(ring, s.mid[0] + s.out[0] * 5, s.mid[1] + s.out[1] * 5)).toBe(false);
        expect(insideRing(ring, s.mid[0] - s.out[0] * 5, s.mid[1] - s.out[1] * 5)).toBe(true);
        expect(Math.hypot(s.out[0], s.out[1])).toBeCloseTo(1, 9);
      }
      expect(ring.length).toBeCloseTo(1600, 6);
    }
  });

  it('离墙多远：城外是正的，城里是负的', () => {
    const ring = makeRing(square);
    expect(ringDistance(ring, M.city[0], M.city[1])).toBeCloseTo(-200, 6);
    expect(ringDistance(ring, W.x1 + 70, M.city[1])).toBeCloseTo(70, 6);
    expect(ringDistance(ring, W.x0 - 30, W.z0 - 40)).toBeCloseTo(50, 6);
  });

  it('墙角往外、往里挪：两面墙各挪一样远', () => {
    const ring = makeRing(square);
    const out = cornerOffset(ring, 2, 7);
    expect(out[0]).toBeCloseTo(W.x1 + 7, 6);
    expect(out[1]).toBeCloseTo(W.z1 + 7, 6);
    const inn = cornerOffset(ring, 0, -41);
    expect(inn[0]).toBeCloseTo(W.x0 + 41, 6);
    expect(inn[1]).toBeCloseTo(W.z0 + 41, 6);
  });

  it('墙上最近的位置：离墙角近的算在墙角上', () => {
    const ring = makeRing(square);
    const mid = nearestOnRing(ring, M.city[0], W.z1 + 25);
    expect(mid.corner).toBeNull();
    expect(mid.side).toBe(2);
    expect(Math.abs(mid.u)).toBeLessThan(1e-6);
    expect(nearestOnRing(ring, W.x1 - 28, W.z1 - 33).corner).toBe(2);
  });

  it('沿着墙走，挑近的那一边：顺着走、倒着走都经过中间的墙角', () => {
    const ring = makeRing(square);
    const northMid = nearestOnRing(ring, M.city[0], W.z0);
    const eastMid = nearestOnRing(ring, W.x1, M.city[1]);
    const corners = (path: { corner: number | null }[]): (number | null)[] => path.map((p) => p.corner);
    expect(corners(ringPath(ring, northMid, eastMid))).toEqual([null, 1, null]);
    expect(corners(ringPath(ring, eastMid, northMid))).toEqual([null, 1, null]);
    // 从东南角里面，经东墙、北墙，到西南角里面：四个墙角依次是 2、1、0、3
    const line: Vec2[] = [
      [W.x1 - 30, W.z1 - 30],
      [W.x1 - 30, W.z0 + 30],
      [W.x0 + 30, W.z0 + 30],
      [W.x0 + 30, W.z1 - 30],
    ];
    expect(corners(snapLineToRing(ring, line))).toEqual([2, 1, 0, 3]);
  });
});

// ---------------------------------------------------------------- 城墙和城门

describe('城墙', () => {
  it('四个角、四座城门：四面墙都造出来，城门那里是通的', () => {
    const { pass, bucket } = soloPass(makeCtx(fourGateScene()));
    const wall = pass.ctx.scene.things.find((t) => t.id === 'wall');
    if (!wall) throw new Error('小沙盘里没有城墙');
    THING_BUILDERS.wall(pass, wall);

    // 每面墙在城门两边各一段墙身
    const bodies = wallBodies(bucket.raised);
    expect(bodies).toHaveLength(8);
    for (const b of bodies) {
      expect(b.y1).toBeCloseTo(pass.ctx.coords.y(FIXTURE_HEIGHTS.city) + 62, 3);
    }
    // 城门的位置没有墙身；往两边 100 米就有
    const W = M.wall;
    for (const [gx, gz] of FOUR_GATES) {
      expect(bodies.some((b) => covers(b, gx, gz))).toBe(false);
      const alongX = gz === W.z0 || gz === W.z1;
      for (const d of [-100, 100]) {
        const x = alongX ? gx + d : gx;
        const z = alongX ? gz : gz + d;
        expect(bodies.filter((b) => covers(b, x, z))).toHaveLength(1);
      }
    }
    // 四个墙角各一座角台，比墙顶高 8
    const blocks = cornerBlocks(bucket.raised);
    expect(blocks).toHaveLength(4);
    for (const [x, z] of [
      [W.x0, W.z0],
      [W.x1, W.z0],
      [W.x1, W.z1],
      [W.x0, W.z1],
    ]) {
      expect(blocks.filter((b) => covers(b, x, z))).toHaveLength(1);
    }
    // 垛口不摆在城门的城台上
    const merlons = boxesOf(bucket.raised, 'rammed').filter((b) => b.vertices === 36 && b.x1 - b.x0 < 20 && b.z1 - b.z0 < 20);
    expect(merlons.length).toBeGreaterThan(20);
    for (const [gx, gz] of FOUR_GATES) {
      expect(merlons.some((b) => Math.hypot((b.x0 + b.x1) / 2 - gx, (b.z0 + b.z1) / 2 - gz) < 60)).toBe(false);
    }
  });

  it('同一处前后两座城门，城墙只让开一次；没有垛口的城墙不摆垛口', () => {
    const scene = fixtureScene();
    scene.things.push(thing('gate-south-later', 'gate', { at: fixturePoint(M.gate[0], M.gate[1]), on: 'wall', params: { face: 'brick', big: true }, when: { from: SECOND } }));
    const wall = scene.things.find((t) => t.id === 'wall');
    if (!wall) throw new Error('小沙盘里没有城墙');
    wall.params = { face: 'earth', parapet: false };
    const { pass, bucket } = soloPass(makeCtx(scene));
    expect(pass.survey.walls.get('wall')?.openings).toHaveLength(1);
    // 加大的城门，城墙多让开一些
    expect(pass.survey.walls.get('wall')?.openings[0].clear).toBe(74);
    THING_BUILDERS.wall(pass, wall);
    expect(wallBodies(bucket.raised)).toHaveLength(5);
    // 剩下的盒子只有四座角台
    expect(boxesOf(bucket.raised, 'rammed').filter((b) => b.vertices === 36)).toHaveLength(4);
  });

  it('城门落在城墙上离它最近的那一点，朝城外；写偏了也一样', () => {
    const scene = fixtureScene();
    const gate = scene.things.find((t) => t.id === 'gate-south');
    if (!gate) throw new Error('小沙盘里没有南门');
    gate.at = fixturePoint(M.gate[0] + 20, M.gate[1] - 35);
    const { pass, bucket } = soloPass(makeCtx(scene));
    const site = pass.survey.gates.get('gate-south');
    expect(site).toBeDefined();
    if (!site) return;
    const e = site.M.elements;
    expect(e[12]).toBeCloseTo(M.gate[0] + 20, 1);
    expect(e[14]).toBeCloseTo(M.wall.z1, 1);
    // 城门自己的 +z 朝南（城外）
    expect(e[8]).toBeCloseTo(0, 6);
    expect(e[10]).toBeCloseTo(1, 6);
    THING_BUILDERS.gate(pass, gate);
    // 城台跨在墙线上，比墙顶高
    const platform = boxesOf(bucket.raised, 'rammed').reduce((a, b) => (b.x1 - b.x0 > a.x1 - a.x0 ? b : a));
    expect(covers(platform, M.gate[0] + 20, M.wall.z1)).toBe(true);
    expect(platform.y1).toBeCloseTo(pass.ctx.coords.y(FIXTURE_HEIGHTS.city) + 70, 3);
  });

  it('城门写得离墙角太近：挪到城台伸不出这一面墙的地方；地面画街、题签指的也是这一点', () => {
    const scene = fixtureScene();
    const gate = scene.things.find((t) => t.id === 'gate-south');
    if (!gate) throw new Error('小沙盘里没有南门');
    // 离西南角 40 米，还写在墙外 25 米
    gate.at = fixturePoint(M.wall.x0 + 40, M.wall.z1 + 25);
    const ctx = makeCtx(scene);
    const { pass } = soloPass(ctx);
    const site = pass.survey.gates.get('gate-south');
    expect(site).toBeDefined();
    if (!site) return;
    const e = site.M.elements;
    // 城台半宽 76 米，再留 10 米
    expect(e[12]).toBeCloseTo(M.wall.x0 + 86, 1);
    expect(e[14]).toBeCloseTo(M.wall.z1, 1);
    const seat = gateSeats(scene, ctx.coords).get('gate-south');
    expect(seat?.[0]).toBeCloseTo(e[12], 6);
    expect(seat?.[1]).toBeCloseTo(e[14], 6);
    // 城墙给它让开的口子也在这一点
    expect(pass.survey.walls.get('wall')?.openings[0].u).toBeCloseTo(M.wall.x0 + 86 - M.city[0], 1);
  });

  it('五个角的城墙也造得出来', () => {
    const scene = fixtureScene();
    const W = M.wall;
    const wall = scene.things.find((t) => t.id === 'wall');
    if (!wall) throw new Error('小沙盘里没有城墙');
    wall.line = [fixturePoint(W.x0, W.z0), fixturePoint(M.city[0], W.z0 - 120), fixturePoint(W.x1, W.z0), fixturePoint(W.x1, W.z1), fixturePoint(W.x0, W.z1)];
    const ctx = makeCtx(scene);
    const { pass, bucket } = soloPass(ctx);
    THING_BUILDERS.wall(pass, wall);
    // 五面墙，南面有城门，分成两段
    expect(wallBodies(bucket.raised)).toHaveLength(6);
    expect(cornerBlocks(bucket.raised)).toHaveLength(5);

    // 不是直角的墙角，角台是一个斜的墩子：角台上的每一个垛口都站在角台的顶面上，没有悬在外面的
    const site = pass.survey.walls.get('wall');
    if (!site) throw new Error('没有量到城墙');
    const blocks = (bucket.raised.parts.get('rammed') ?? []).filter((geo) => {
      geo.computeBoundingBox();
      const b = geo.boundingBox;
      return geo.attributes.position.count === 36 && b !== null && b.max.y - b.min.y > 80;
    });
    /** 一座角台顶面的四个角（沙盘里的 x、z）。 */
    const topOf = (geo: (typeof blocks)[number]): Vec2[] => {
      const p = geo.attributes.position;
      const out: Vec2[] = [];
      for (let i = 0; i < p.count; i++) {
        if (Math.abs(p.getY(i) - site.gateTopY) > 0.01) continue;
        if (!out.some((q) => Math.hypot(q[0] - p.getX(i), q[1] - p.getZ(i)) < 0.01)) out.push([p.getX(i), p.getZ(i)]);
      }
      expect(out).toHaveLength(4);
      // 绕着中心排好，才是一圈
      const cx = out.reduce((s, q) => s + q[0], 0) / 4;
      const cz = out.reduce((s, q) => s + q[1], 0) / 4;
      return out.sort((a, b) => Math.atan2(a[1] - cz, a[0] - cx) - Math.atan2(b[1] - cz, b[0] - cx));
    };
    const tops = blocks.map(topOf);
    const onBlocks = boxesOf(bucket.raised, 'rammed').filter((b) => b.vertices === 36 && b.y1 - b.y0 < 20 && Math.abs(b.y0 - site.gateTopY) < 0.01);
    // 五座角台，每座朝外的两条边上各一排
    expect(onBlocks.length).toBeGreaterThanOrEqual(5 * 2 * 4);
    for (const m of onBlocks) {
      const x = (m.x0 + m.x1) / 2;
      const z = (m.z0 + m.z1) / 2;
      expect(tops.some((ring) => insideRing(makeRing(ring), x, z)), `(${x.toFixed(0)}, ${z.toFixed(0)}) 的垛口悬在角台外面`).toBe(true);
    }

    const models = buildModels(ctx);
    expect(models.apply(FIRST, FIXTURE_HEIGHTS.normal, 6000)).toBe(true);
    expect(models.triangles()).toBeGreaterThan(1000);
    expectAllFinite(models.group);
    models.dispose();
  });
});

// ---------------------------------------------------------------- 民居

describe('城里的民居', () => {
  const city = flatGround().cities[0];

  it('沿着城的平面里的小巷排：每座屋离巷子 25 米（屋后的小屋 55 米），都在城墙里面，让开大街和横巷', () => {
    const ctx = makeCtx();
    const { pass, bucket } = soloPass(ctx);
    const homes = ctx.scene.dressing.find((d) => d.id === 'homes');
    if (!homes) throw new Error('小沙盘里没有民居');
    DRESSING_BUILDERS.houses(pass, homes);
    const roofs = boxesOf(bucket.main, 'tile');
    // 这座小城只有四百米见方，两条巷子，摆不下几座
    expect(roofs.length).toBeGreaterThanOrEqual(4);
    const ring = makeRing(city.wall);
    let onLane = 0;
    for (const r of roofs) {
      const x = (r.x0 + r.x1) / 2;
      const z = (r.z0 + r.z1) / 2;
      expect(ringDistance(ring, x, z)).toBeLessThan(-50);
      const d = Math.min(...city.lanes.map((l) => lineDistance(l, x, z)));
      const main = Math.abs(d - 25) < 0.5;
      const behind = Math.abs(d - 55) < 0.5;
      expect(main || behind).toBe(true);
      if (main) {
        onLane++;
        // 横巷在离城的中心 100 米的地方：屋子不压在上面
        for (const alley of [M.city[0] - 100, M.city[0] + 100]) expect(r.x0 < alley && r.x1 > alley).toBe(false);
      }
      for (const s of city.streets) expect(lineDistance(s, x, z)).toBeGreaterThan(20);
      // 屋顶在城里的地面以上
      expect(r.y0).toBeGreaterThan(ctx.coords.y(FIXTURE_HEIGHTS.city));
    }
    expect(onLane).toBeGreaterThanOrEqual(4);
    // 屋后留了几块空地给树
    expect(pass.lots.length).toBeGreaterThan(0);
  });

  it('一座和徐州差不多大的城（一千二百米见方，八条巷子）：每条巷子两边都排满，横巷和十字大街空着', () => {
    // 城墙的线、城的平面都另做一份：中心在 (0, 100)，巷子离中心 75、225、375、525 米，十字大街过中心
    const scene = fixtureScene();
    const wall = scene.things.find((t) => t.id === 'wall');
    if (!wall) throw new Error('小沙盘里没有城墙');
    const half = 600;
    const centre: Vec2 = [0, 100];
    const ringPts: Vec2[] = [
      [centre[0] - half, centre[1] - half],
      [centre[0] + half, centre[1] - half],
      [centre[0] + half, centre[1] + half],
      [centre[0] - half, centre[1] + half],
    ];
    wall.line = ringPts.map((q) => fixturePoint(q[0], q[1]));
    const ground = flatGround();
    const offsets = [-525, -375, -225, -75, 75, 225, 375, 525];
    ground.cities = [
      {
        wallId: 'wall',
        wall: ringPts,
        centre,
        groundM: FIXTURE_HEIGHTS.city,
        gates: [],
        streets: [
          [
            [centre[0], centre[1] - half],
            [centre[0], centre[1] + half],
          ],
          [
            [centre[0] - half, centre[1]],
            [centre[0] + half, centre[1]],
          ],
        ],
        lanes: offsets.map((o): Vec2[] => [
          [centre[0] - 540, centre[1] + o],
          [centre[0] + 540, centre[1] + o],
        ]),
      },
    ];
    const ctx = makeCtx(scene, ground);
    const homes = scene.dressing.find((d) => d.id === 'homes');
    if (!homes) throw new Error('小沙盘里没有民居');

    const near = soloPass(ctx);
    DRESSING_BUILDERS.houses(near.pass, homes);
    const roofs = boxesOf(near.bucket.main, 'tile');
    // 样张里这样一座城有两百来座屋
    expect(roofs.length).toBeGreaterThan(150);
    expect(roofs.length).toBeLessThan(400);
    const mains = roofs.filter((r) => offsets.some((o) => Math.abs(Math.abs((r.z0 + r.z1) / 2 - centre[1] - o) - 25) < 0.5));
    for (const o of offsets) {
      for (const side of [-1, 1]) {
        const row = mains.filter((r) => Math.abs((r.z0 + r.z1) / 2 - (centre[1] + o + side * 25)) < 0.5);
        // 最外面两条巷子朝着城墙的那一排离墙脚太近，不排
        if (Math.abs(o + side * 25) > half - 58) expect(row).toHaveLength(0);
        else expect(row.length).toBeGreaterThanOrEqual(6);
      }
    }
    for (const r of mains) {
      // 横巷（离中心 100、300、500 米）和南北大街（过中心）上没有屋
      for (const alley of [-500, -300, -100, 100, 300, 500]) expect(r.x0 < centre[0] + alley - 4 && r.x1 > centre[0] + alley + 4).toBe(false);
      expect(r.x0 < centre[0] + 18 && r.x1 > centre[0] - 18).toBe(false);
    }
    for (const r of roofs) {
      const x = (r.x0 + r.x1) / 2;
      const z = (r.z0 + r.z1) / 2;
      expect(Math.abs(x - centre[0])).toBeLessThan(half - 50);
      expect(Math.abs(z - centre[1])).toBeLessThan(half - 50);
    }
    expect(near.pass.lots.length).toBeGreaterThan(20);

    // 远了留哪几座是造的时候就排好的（次序）：放大到头时留两成，只在隔一条的巷子上，放大、摊开以后谁也不压着谁
    const rule = testStyle.figure.rules.cityHouse;
    const keepAtMax = rule.keepAtMax ?? 1;
    const far = figureAt(500_000);
    expect(far.uFigTimes.value[slotOf('cityHouse')]).toBeCloseTo(rule.maxTimes, 6);
    const houses = partsOf(near.bucket.main, 'tile')
      .map((g) => ({ g, m: marksOf(g) }))
      .filter((h) => h.m.fig[2] !== FIG_DETAIL);
    for (const h of houses) expect(h.m.fig[0]).toBe(slotOf('cityHouse'));
    const kept = houses.filter((h) => h.m.fig[1] < keepAtMax);
    const gone = houses.filter((h) => h.m.fig[1] >= keepAtMax);
    expect(kept.length).toBeGreaterThan(20);
    expect(kept.length).toBeLessThan(houses.length / 2);
    // 排在线以外的，次序都在“缩没了”的那一头：放大到头时一座也不剩
    for (const h of gone) {
      expect(h.m.fig[1]).toBeGreaterThanOrEqual(keepAtMax / KEEP_FRINGE - 1e-6);
      expect(figureShow(h.m.fig, far)).toBeLessThan(1e-6);
    }
    // 留着的：原样大小的 2.1 倍，排在离巷子 52.5 米的地方，只在 −525、−225、75、375 这四条巷子上
    const farBoxes = kept.map((h) => {
      expect(figureShow(h.m.fig, far)).toBe(1);
      const lane = h.m.group[2] - centre[1];
      expect([-525, -225, 75, 375].some((o) => Math.abs(lane - o) < 0.5), `留着的屋在离中心 ${lane.toFixed(0)} 米的巷子上`).toBe(true);
      const b = movedBox(h.g, far);
      expect(Math.abs(Math.abs((b.z0 + b.z1) / 2 - h.m.group[2]) - 25 * rule.maxTimes)).toBeLessThan(0.5);
      const was = boxOf(h.g);
      expect((b.x1 - b.x0) / (was.x1 - was.x0)).toBeCloseTo(rule.maxTimes, 3);
      return b;
    });
    for (let a = 0; a < farBoxes.length; a++) {
      for (let b = a + 1; b < farBoxes.length; b++) {
        const overlap = farBoxes[a].x0 < farBoxes[b].x1 && farBoxes[b].x0 < farBoxes[a].x1 && farBoxes[a].z0 < farBoxes[b].z1 && farBoxes[b].z0 < farBoxes[a].z1;
        expect(overlap, `放大以后第 ${a} 座和第 ${b} 座压在一起`).toBe(false);
      }
    }
    // 南北大街过中心：留着的屋放大以后也不压着它
    for (const b of farBoxes) expect(b.x0 < centre[0] + 18 && b.x1 > centre[0] - 18).toBe(false);
    // 次序最小的是 0；每条巷子近看时都有屋
    expect(Math.min(...houses.map((h) => h.m.fig[1]))).toBe(0);
  });

  it('同一个种子每次摆出来一样；换一个种子就不一样', () => {
    const run = (seed: number): Box[] => {
      const scene = fixtureScene();
      const homes = scene.dressing.find((d) => d.id === 'homes');
      if (!homes) throw new Error('小沙盘里没有民居');
      homes.params = { lanes: true, seed };
      const { pass, bucket } = soloPass(makeCtx(scene));
      DRESSING_BUILDERS.houses(pass, homes);
      return boxesOf(bucket.main, 'tile');
    };
    expect(run(7)).toEqual(run(7));
    expect(run(8)).not.toEqual(run(7));
  });

  it('每座屋带着自己的记号：脚在屋的正中，从巷子上正对着它的那一点往外摊开；屋后的小屋是细处，跟着前面的屋', () => {
    const ctx = makeCtx();
    const { pass, bucket } = soloPass(ctx);
    const homes = ctx.scene.dressing.find((d) => d.id === 'homes');
    if (!homes) throw new Error('小沙盘里没有民居');
    DRESSING_BUILDERS.houses(pass, homes);
    const g = ctx.coords.y(FIXTURE_HEIGHTS.city);
    const roofs = partsOf(bucket.main, 'tile');
    expect(roofs.length).toBeGreaterThanOrEqual(4);
    const far = figureAt(500_000);
    const k = testStyle.figure.rules.cityHouse.maxTimes;
    for (const roof of roofs) {
      const m = marksOf(roof);
      const b = boxOf(roof);
      expect(m.fig[0]).toBe(slotOf('cityHouse'));
      expect(m.fig[3]).toBe(0);
      // 城里的屋都落在城里的地面上；共同的那一点在巷子上
      expect(m.pivot[1]).toBeCloseTo(g, 4);
      expect(m.group[1]).toBeCloseTo(g, 4);
      expect(Math.min(...city.lanes.map((l) => lineDistance(l, m.group[0], m.group[2])))).toBeLessThan(0.01);
      // 脚在这一座的正中
      expect(m.pivot[0]).toBeCloseTo((b.x0 + b.x1) / 2, 0);
      expect(m.pivot[2]).toBeCloseTo((b.z0 + b.z1) / 2, 0);
      if (m.fig[2] === FIG_DETAIL) continue;
      // 放大到头：离巷子 25 米的那一排到了 52.5 米，屋子大了 2.1 倍，屋脚还在城里的地面上
      const moved = movedBox(roof, { ...far, uFigKeep: { value: new Float32Array(FIGURE_SLOTS).fill(1) } });
      expect(Math.abs((moved.z0 + moved.z1) / 2 - m.group[2])).toBeCloseTo(25 * k, 1);
      expect((moved.x1 - moved.x0) / (b.x1 - b.x0)).toBeCloseTo(k, 3);
      expect(moved.y0 - g).toBeCloseTo((b.y0 - g) * k, 3);
    }
    // 墙和屋顶的记号是同一份
    const walls = partsOf(bucket.main, 'plaster').map((w) => marksOf(w));
    for (const roof of roofs) expect(walls).toContainEqual(marksOf(roof));
  });

  it('画质里民居留几成：留得少，屋就少，留下的还在原处，次序也不变', () => {
    const built = (houseKeep: number): { box: Box; rank: number }[] => {
      const ctx = makeCtx(fixtureScene(), flatGround(), { ...FULL, houseKeep });
      const { pass, bucket } = soloPass(ctx);
      const homes = ctx.scene.dressing.find((d) => d.id === 'homes');
      if (!homes) throw new Error('小沙盘里没有民居');
      // 密一点，屋多一些才看得出留了几成
      DRESSING_BUILDERS.houses(pass, { ...homes, params: { lanes: true, seed: 3, density: 1.08 } });
      return partsOf(bucket.main, 'tile').map((g) => ({ box: boxOf(g), rank: marksOf(g).fig[1] }));
    };
    const all = built(1);
    expect(built(0)).toHaveLength(0);
    const half = built(0.5);
    expect(half.length).toBeLessThan(all.length);
    expect(half.length).toBeGreaterThan(0);
    for (const h of half) expect(all).toContainEqual(h);
  });
});

// ---------------------------------------------------------------- 总装

/** 一组东西下面所有的网格（并出来的和成批摆的），连同它现在是不是真的在画（它自己和上面每一层都显着）。 */
function meshesUnder(root: Object3D): { mesh: Mesh; shown: boolean }[] {
  const out: { mesh: Mesh; shown: boolean }[] = [];
  const visit = (o: Object3D, above: boolean): void => {
    const shown = above && o.visible;
    if ((o as Mesh).isMesh) out.push({ mesh: o as Mesh, shown });
    for (const child of o.children) visit(child, shown);
  };
  visit(root, true);
  return out;
}

/** 这个网格所在的那一组（同一些小节里有的东西）现在显没显。 */
function inShownSet(mesh: Object3D): boolean {
  for (let o = mesh.parent; o; o = o.parent) if (o.name.startsWith('set:')) return o.visible;
  return false;
}

/** 成批摆的网格里第 i 个实例带的记号。 */
function instanceMarks(mesh: InstancedMesh, i: number): FigureMarks {
  return marksOf(mesh.geometry, i);
}

/** 现在真的在画的网格：每个的顶点数、画几个实例、头几个数。两座模型一样不一样，比这个。 */
function digest(group: Group): (number | string)[] {
  const out: (number | string)[] = [];
  for (const { mesh, shown } of meshesUnder(group)) {
    if (!shown) continue;
    const position = mesh.geometry.attributes.position;
    out.push(mesh.name, position.count, position.array[0], position.array[7], (mesh as InstancedMesh).isInstancedMesh ? (mesh as InstancedMesh).count : -1);
    for (const name of ['aPivot', 'aGroup', 'aFig']) {
      const a = mesh.geometry.attributes[name];
      out.push(a.count, a.array[0], a.array[a.array.length - 1]);
    }
  }
  return out;
}

describe('总装（buildModels）', () => {
  /** 小沙盘上再添几样写了 when 的东西：三种写法都有。 */
  function whenScene(): StopScene {
    const scene = fixtureScene();
    scene.things.push(
      thing('hut', 'house', { at: fixturePoint(500, 400), when: { until: FIRST } }),
      thing('shed', 'house', { at: fixturePoint(M.wall.x1, M.city[1] + 100), on: 'wall', when: { only: [SECOND] } }),
      thing('pavilion', 'pavilion', { at: fixturePoint(600, -300), when: { from: FIRST, until: SECOND } }),
    );
    return scene;
  }

  it('造模型本身不造什么；还没有摆过小节时什么都不显', () => {
    const models = buildModels(makeCtx(whenScene()));
    expect(models.group.children).toHaveLength(0);
    expect(models.triangles()).toBe(0);
    models.dispose();
  });

  it('每一小节显出来的，正好是 when 里有这一节的那几组', () => {
    const models = buildModels(makeCtx(whenScene()));
    // 一直有的（城墙、南门、民居、亭子）一组，只在前一节的（草屋）一组，只在后一节的（门上的楼、墙上的棚子）一组
    expect(models.apply(FIRST, FIXTURE_HEIGHTS.normal, 6000)).toBe(true);
    expect(visibleNames(models.group)).toEqual(['set:10', 'set:11']);
    const first = models.triangles();

    expect(models.apply(SECOND, FIXTURE_HEIGHTS.flood, 2400)).toBe(true);
    expect(visibleNames(models.group)).toEqual(['set:01', 'set:11']);
    // 后一节多了一座楼，三角形多得多
    expect(models.triangles()).toBeGreaterThan(first + 500);

    expect(models.apply(FIRST, FIXTURE_HEIGHTS.normal, 6000)).toBe(true);
    expect(visibleNames(models.group)).toEqual(['set:10', 'set:11']);
    expect(models.triangles()).toBe(first);
    models.dispose();
  });

  it('显出来的东西没有变，apply 就说没变：镜头远了近了只是大小变，不算；水碰到了东西才算；不认识的小节不动', () => {
    const models = buildModels(makeCtx(whenScene()));
    expect(models.apply(FIRST, FIXTURE_HEIGHTS.normal, 6000)).toBe(true);
    expect(models.apply(FIRST, FIXTURE_HEIGHTS.normal, 6000)).toBe(false);
    // 镜头贴近、退到头：模型大小变了，显出来的还是那几组
    for (const D of [1000, 5000, 20000, 44000, 120000]) expect(models.apply(FIRST, FIXTURE_HEIGHTS.normal, D)).toBe(false);
    // 没有船，水也没有碰到哪样东西的脚：水位变一点不算
    expect(models.apply(FIRST, FIXTURE_HEIGHTS.normal + 0.5, 6000)).toBe(false);
    // 大水漫过了平地上的草屋的脚（它改成绕着水面那条线放大）：算，影子要重画
    expect(models.apply(FIRST, FIXTURE_HEIGHTS.flood, 6000)).toBe(true);
    expect(models.apply(FIRST, FIXTURE_HEIGHTS.flood, 6000)).toBe(false);
    expect(models.apply(FIRST, FIXTURE_HEIGHTS.flood - 0.2, 6000)).toBe(true);
    expect(models.apply('没有这一节', FIXTURE_HEIGHTS.normal, 6000)).toBe(false);
    expect(visibleNames(models.group)).toEqual(['set:10', 'set:11']);
    models.dispose();
  });

  it('只有一套模型：先 prepare 过，镜头再远再近 apply 都不造东西、不添网格', async () => {
    const models = buildModels(makeCtx(everythingScene()));
    await models.prepare([FIRST, SECOND]);
    const before = meshesUnder(models.group).map((m) => m.mesh.geometry.uuid);
    expect(before.length).toBeGreaterThan(20);
    const add = vi.spyOn(Batch.prototype, 'add');
    const build = vi.spyOn(Batch.prototype, 'build');
    try {
      for (const [heading, level] of [
        [FIRST, FIXTURE_HEIGHTS.normal],
        [SECOND, FIXTURE_HEIGHTS.flood],
      ] as const) {
        for (const D of [1000, 10000, 44000, 120000]) {
          models.apply(heading, level, D);
          expect(models.triangles()).toBeGreaterThan(3000);
        }
      }
      expect(add).not.toHaveBeenCalled();
      expect(build).not.toHaveBeenCalled();
    } finally {
      add.mockRestore();
      build.mockRestore();
    }
    expect(meshesUnder(models.group).map((m) => m.mesh.geometry.uuid)).toEqual(before);
    models.dispose();
  });

  it('没有先 prepare 的小节，apply 当场造，造出来是全的：和先 prepare 的一模一样', async () => {
    const onDemand = buildModels(makeCtx(everythingScene()));
    expect(onDemand.apply(SECOND, FIXTURE_HEIGHTS.flood, 2400)).toBe(true);
    const prepared = buildModels(makeCtx(everythingScene()));
    await prepared.prepare([FIRST, SECOND]);
    prepared.apply(SECOND, FIXTURE_HEIGHTS.flood, 2400);
    expect(onDemand.triangles()).toBe(prepared.triangles());
    expect(onDemand.triangles()).toBeGreaterThan(20000);
    expect(digest(onDemand.group)).toEqual(digest(prepared.group));
    // 当场造的只造了这一节要用的两组；换到另一节，再补上那一组
    expect(onDemand.group.children).toHaveLength(2);
    expect(prepared.group.children).toHaveLength(3);
    onDemand.apply(FIRST, FIXTURE_HEIGHTS.normal, 6000);
    prepared.apply(FIRST, FIXTURE_HEIGHTS.normal, 6000);
    expect(onDemand.group.children).toHaveLength(3);
    expect(digest(onDemand.group)).toEqual(digest(prepared.group));
    onDemand.dispose();
    prepared.dispose();
  });

  it('prepare 一小块一小块地把要用的先造好', async () => {
    const models = buildModels(makeCtx(whenScene()));
    const pending = models.prepare([FIRST, SECOND, '没有这一节']);
    // 让出时间以前什么都还没有造
    expect(models.group.children).toHaveLength(0);
    await pending;
    expect(models.group.children).toHaveLength(3);
    expect(models.group.children.every((c) => !c.visible)).toBe(true);
    models.apply(SECOND, FIXTURE_HEIGHTS.flood, 2400);
    expect(models.group.children).toHaveLength(3);
    models.dispose();
  });

  it('只 prepare 一节：只造这一节要用的几组', async () => {
    const models = buildModels(makeCtx(whenScene()));
    await models.prepare([FIRST]);
    expect(models.group.children.map((c) => c.name).sort()).toEqual(['set:10', 'set:11']);
    models.dispose();
  });

  it('放掉以后：什么都不显，apply 说没变，还在排队的 prepare 照常结束', async () => {
    const models = buildModels(makeCtx(whenScene()));
    models.apply(FIRST, FIXTURE_HEIGHTS.normal, 6000);
    const pending = models.prepare([SECOND]);
    models.dispose();
    models.dispose();
    await expect(pending).resolves.toBeUndefined();
    expect(models.group.children).toHaveLength(0);
    expect(models.triangles()).toBe(0);
    expect(models.apply(SECOND, FIXTURE_HEIGHTS.flood, 2400)).toBe(false);
  });

  it('同样的输入造出来一模一样', () => {
    const positions = (): (number | string)[] => {
      const models = buildModels(makeCtx(everythingScene()));
      models.apply(SECOND, FIXTURE_HEIGHTS.flood, 2400);
      const out = [models.triangles(), ...digest(models.group)];
      models.apply(SECOND, FIXTURE_HEIGHTS.flood, 40000);
      out.push(models.triangles(), ...digest(models.group));
      models.dispose();
      return out;
    };
    expect(positions()).toEqual(positions());
  });

  it('每个网格都不让 three 按没放大的范围剔掉，画影子用的都是同一份补过的材质；每种材质都补过那一段', () => {
    const models = buildModels(makeCtx(everythingScene()));
    models.apply(FIRST, FIXTURE_HEIGHTS.normal, 6000);
    models.apply(SECOND, FIXTURE_HEIGHTS.flood, 2400);
    const all = meshesUnder(models.group);
    expect(all.length).toBeGreaterThan(25);
    expect(all.some((m) => (m.mesh as InstancedMesh).isInstancedMesh)).toBe(true);
    const depth = all[0].mesh.customDepthMaterial;
    expect((depth as { isMeshDepthMaterial?: boolean } | undefined)?.isMeshDepthMaterial).toBe(true);
    expect(depth?.customProgramCacheKey()).toMatch(/^figure:.*depth$/);
    for (const { mesh } of all) {
      expect(mesh.frustumCulled, `${mesh.name} 会被整个剔掉`).toBe(false);
      expect(mesh.customDepthMaterial, `${mesh.name} 的影子不跟着模型变`).toBe(depth);
      expect(mesh.castShadow).toBe(true);
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      expect(material.customProgramCacheKey()).toMatch(/^figure:.*lit$/);
      // 用了补过的材质的网格都带着那三样
      for (const name of ['aPivot', 'aGroup', 'aFig']) expect(mesh.geometry.attributes[name], `${mesh.name} 没有 ${name}`).toBeDefined();
    }
    models.dispose();
  });

  it('城墙、城门那一组远了整体拔高：竖向的倍数就是城墙这一类现在的倍数，回到近处又是 1', () => {
    const models = buildModels(makeCtx());
    const raisedScale = (): number[] => (models.group.children.find((c) => c.name === 'set:11')?.children ?? []).map((c) => c.scale.y);
    for (const D of [3000, 16000, 20000, 60000, 3000]) {
      models.apply(SECOND, FIXTURE_HEIGHTS.flood, D);
      const times = figureNow(testStyle.figure.rules.wallH, D).times;
      const scales = raisedScale();
      // 这一组里有两份并出来的东西：一般的零件（不拔高）和城墙、城门
      expect(scales).toHaveLength(2);
      expect(scales[0]).toBe(1);
      // 那一份数是单精度的
      expect(scales[1]).toBeCloseTo(times, 6);
    }
    expect(figureNow(testStyle.figure.rules.wallH, 60000).times).toBeCloseTo(1.55, 3);
    models.dispose();
  });

  it('看得见的东西没有哪一样是一下子换掉的：一个网格只在里面的东西都缩成一个点时才不画；成批摆的只省掉缩没了的那些', async () => {
    const models = buildModels(makeCtx(everythingScene()));
    await models.prepare([FIRST, SECOND]);
    /** 这个网格里现在最大的一个实例是本来的几成大。 */
    const largest = (mesh: InstancedMesh, u: FigureUniforms, from = 0): number => {
      let most = 0;
      for (let i = from; i < mesh.geometry.attributes.aFig.count; i++) most = Math.max(most, figureShow(instanceMarks(mesh, i).fig, u));
      return most;
    };
    const switched = new Set<Mesh>();
    for (const [heading, level] of [
      [FIRST, FIXTURE_HEIGHTS.normal],
      [SECOND, FIXTURE_HEIGHTS.flood],
    ] as const) {
      let last: { D: number; shown: Map<Mesh, boolean> } | null = null;
      for (let D = 800; D <= 130000; D *= 1.05) {
        models.apply(heading, level, D);
        const u = figureAt(D, level);
        const now = new Map(meshesUnder(models.group).map((m) => [m.mesh, m.shown]));
        for (const { mesh, shown } of meshesUnder(models.group)) {
          const flock = mesh as InstancedMesh;
          if (!inShownSet(mesh)) continue;
          if (!flock.isInstancedMesh) {
            // 并出来的网格只跟着小节开关，不跟着远近
            expect(mesh.visible).toBe(true);
            continue;
          }
          // 整个不画的：里面每一个都缩成一个点了。只画前几个的：省掉的那些都缩成一个点了
          if (!mesh.visible) expect(largest(flock, u)).toBe(0);
          else if (shown) expect(largest(flock, u, flock.count)).toBe(0);
        }
        if (last) {
          for (const [mesh, shown] of now) {
            if (last.shown.get(mesh) === shown) continue;
            switched.add(mesh);
            // 开关的那一下落在 last.D 和 D 之间：找到那一点，紧挨着它、还画着的那一边，里面的东西已经小得看不见了
            let lo = last.D;
            let hi = D;
            const shownAtLo = last.shown.get(mesh) === true;
            for (let k = 0; k < 40; k++) {
              const mid = (lo + hi) / 2;
              models.apply(heading, level, mid);
              if (mesh.visible === shownAtLo) lo = mid;
              else hi = mid;
            }
            const edge = shownAtLo ? lo : hi;
            models.apply(heading, level, edge);
            expect(mesh.visible).toBe(true);
            expect(largest(mesh as InstancedMesh, figureAt(edge, level))).toBeLessThan(1e-3);
            models.apply(heading, level, D);
          }
        }
        last = { D, shown: now };
      }
    }
    // 这座沙盘上真有跟着远近开关的网格（镜头贴近才长出来的细做的树），不然上面什么也没查到
    expect(switched.size).toBeGreaterThan(0);
    for (const mesh of switched) {
      expect(mesh.name).toBe('trees:close');
      // 细处不放在会开关的网格里
      const figs = mesh.geometry.attributes.aFig;
      for (let i = 0; i < figs.count; i++) expect(figs.getZ(i)).not.toBe(FIG_DETAIL);
    }
    models.dispose();
  });

  it('细处都并在它那一组的网格里，带着“细处”的记号：远了先矮下去，再收成一个点，网格一直画着', () => {
    const models = buildModels(makeCtx(everythingScene()));
    models.apply(SECOND, FIXTURE_HEIGHTS.flood, 2400);
    let detailVertices = 0;
    for (const { mesh, shown } of meshesUnder(models.group)) {
      if (!shown || (mesh as InstancedMesh).isInstancedMesh) continue;
      const figs = mesh.geometry.attributes.aFig;
      for (let i = 0; i < figs.count; i++) if (figs.getZ(i) === FIG_DETAIL) detailVertices++;
    }
    // 垛口、矮墙、门缝、券石、长廊、院墙、木桩……
    expect(detailVertices).toBeGreaterThan(3000);
    const near = models.triangles();
    models.apply(SECOND, FIXTURE_HEIGHTS.flood, 60000);
    // 远了三角形只少在成批摆的树上：收掉的细处照样交给显卡
    let instancedNear = 0;
    let instancedFar = 0;
    for (const { mesh, shown } of meshesUnder(models.group)) {
      if (!shown || !(mesh as InstancedMesh).isInstancedMesh) continue;
      instancedFar += ((mesh as InstancedMesh).count * mesh.geometry.attributes.position.count) / 3;
    }
    models.apply(SECOND, FIXTURE_HEIGHTS.flood, 2400);
    for (const { mesh, shown } of meshesUnder(models.group)) {
      if (!shown || !(mesh as InstancedMesh).isInstancedMesh) continue;
      instancedNear += ((mesh as InstancedMesh).count * mesh.geometry.attributes.position.count) / 3;
    }
    models.apply(SECOND, FIXTURE_HEIGHTS.flood, 60000);
    expect(near - models.triangles()).toBe(instancedNear - instancedFar);
    expect(instancedFar).toBeLessThan(instancedNear);
    models.dispose();
  });

  it('减配的一档：树留一半上下，每条树的规则至少留一棵；成片的民居少了', () => {
    const count = (quality: Quality): { trees: Map<string, number>; total: number; triangles: number } => {
      const models = buildModels(makeCtx(everythingScene(), flatGround(), quality));
      models.apply(FIRST, FIXTURE_HEIGHTS.normal, 6000);
      const trees = new Map<string, number>();
      let total = 0;
      for (const { mesh } of meshesUnder(models.group)) {
        // 镜头贴近才有的那几棵和它们对应的苔点是同一棵树，不重复数
        if (!mesh.name.startsWith('trees:') || mesh.name === 'trees:close') continue;
        for (const rule of mesh.userData.rules as string[]) {
          trees.set(rule, (trees.get(rule) ?? 0) + 1);
          total++;
        }
      }
      const triangles = models.triangles();
      models.dispose();
      return { trees, total, triangles };
    };
    const full = count(FULL);
    const reduced = count(REDUCED);
    expect([...full.trees.keys()].sort()).toEqual(['orchard', 'pines', 'trees', 'willows']);
    expect(full.total).toBeGreaterThan(100);
    expect(Math.abs(reduced.total / full.total - 0.5)).toBeLessThan(0.1);
    for (const [rule, n] of full.trees) {
      const kept = reduced.trees.get(rule) ?? 0;
      expect(kept, `${rule} 一棵也没留`).toBeGreaterThanOrEqual(1);
      expect(kept).toBeLessThanOrEqual(Math.ceil(n * 0.5) + 1);
    }
    expect(reduced.triangles).toBeLessThan(full.triangles);
    // 留得再少，每条规则也留着排第一的那一棵
    const scene = everythingScene();
    const pines = scene.dressing.find((d) => d.id === 'pines');
    if (!pines) throw new Error('没有松树');
    pines.params = { type: 'pine', radiusM: 40 };
    const models = buildModels(makeCtx(scene, flatGround(), { ...REDUCED, treeKeep: 0.01 }));
    models.apply(FIRST, FIXTURE_HEIGHTS.normal, 6000);
    const left = meshesUnder(models.group)
      .filter((m) => m.mesh.name.startsWith('trees:'))
      .flatMap((m) => m.mesh.userData.rules as string[]);
    for (const rule of ['orchard', 'pines', 'trees', 'willows']) expect(left.filter((r) => r === rule).length, `${rule} 一棵也没留`).toBeGreaterThanOrEqual(1);
    models.dispose();
  });
});

describe('每种摆件、每种点缀都摆上的一座沙盘', () => {
  it('镜头远远近近都造得出来，每个顶点都是正常的数', () => {
    const models = buildModels(makeCtx(everythingScene()));
    for (const [heading, level] of [
      [FIRST, FIXTURE_HEIGHTS.normal],
      [SECOND, FIXTURE_HEIGHTS.flood],
    ] as const) {
      for (const distance of [1500, 6000, 40000]) {
        models.apply(heading, level, distance);
        expect(models.triangles()).toBeGreaterThan(3000);
        expect(models.triangles()).toBeLessThan(200000);
      }
    }
    expectAllFinite(models.group);
    models.dispose();
  });

  it('零件用到的材质，零件库里都有', () => {
    const { pass, bucket } = soloPass(makeCtx(everythingScene()));
    for (const kind of THING_KINDS) for (const t of pass.ctx.scene.things) if (t.kind === kind) coreBuilder(kind)(pass, t);
    for (const kind of DRESSING_KINDS) for (const d of pass.ctx.scene.dressing) if (d.kind === kind) DRESSING_BUILDERS[kind](pass, d);
    const used = new Set([...bucket.main.parts.keys(), ...bucket.raised.parts.keys()]);
    expect(used.size).toBeGreaterThan(8);
    for (const name of used) expect(MATERIAL_NAMES as readonly string[]).toContain(name);
  });

  it('院落占的地，民居让开；楼摆在城门上，比城台高', () => {
    const ctx = makeCtx(everythingScene());
    const { pass, bucket } = soloPass(ctx);
    const find = (id: string): SceneThing => {
      const t = ctx.scene.things.find((x) => x.id === id);
      if (!t) throw new Error(`没有 ${id}`);
      return t;
    };
    THING_BUILDERS['hall-group'](pass, find('yamen'));
    expect(pass.yards).toHaveLength(1);
    const before = boxesOf(bucket.main, 'tile').length;
    const homes = ctx.scene.dressing.find((d) => d.id === 'homes');
    if (!homes) throw new Error('小沙盘里没有民居');
    DRESSING_BUILDERS.houses(pass, homes);
    const yard = pass.yards[0];
    const houses = boxesOf(bucket.main, 'tile').slice(before);
    expect(houses.length).toBeGreaterThan(0);
    for (const r of houses) {
      const x = (r.x0 + r.x1) / 2;
      const z = (r.z0 + r.z1) / 2;
      expect(Math.abs(x - yard.cx) < yard.hx && Math.abs(z - yard.cz) < yard.hz).toBe(false);
    }

    const solo = soloPass(ctx);
    THING_BUILDERS.tower(solo.pass, find('tower-east'));
    const roofs = boxesOf(solo.bucket.main, 'tile');
    const top = Math.max(...roofs.map((r) => r.y1));
    const gateTop = ctx.coords.y(FIXTURE_HEIGHTS.city) + 70;
    expect(top).toBeGreaterThan(gateTop + 40);
    expect(Math.min(...boxesOf(solo.bucket.main, 'stone').map((r) => r.y0))).toBeCloseTo(gateTop, 3);
    // 楼的正中在东门上
    const big = roofs.reduce((a, b) => (b.vertices > a.vertices ? b : a));
    expect((big.x0 + big.x1) / 2).toBeCloseTo(M.wall.x1, 0);
    expect((big.z0 + big.z1) / 2).toBeCloseTo(M.city[1], 0);
  });

  it('贴在城墙里侧的堤、外侧的土坡：线只说贴着哪几面墙，离墙多远由零件库定', () => {
    const ctx = makeCtx(everythingScene());
    const find = (id: string): SceneThing => {
      const t = ctx.scene.things.find((x) => x.id === id);
      if (!t) throw new Error(`没有 ${id}`);
      return t;
    };
    const W = M.wall;
    const inner = soloPass(ctx);
    THING_BUILDERS.dike(inner.pass, find('dike-inner'));
    const runs = boxesOf(inner.bucket.main, 'earth');
    // 东墙、北墙里面各一段，都在城里，离墙的中线 26 到 56 米
    expect(runs).toHaveLength(2);
    const east = runs.find((r) => r.z1 - r.z0 > r.x1 - r.x0);
    const north = runs.find((r) => r.x1 - r.x0 > r.z1 - r.z0);
    expect(east && north).toBeTruthy();
    if (!east || !north) return;
    expect(east.x1).toBeCloseTo(W.x1 - 26, 1);
    expect(east.x0).toBeCloseTo(W.x1 - 56, 1);
    expect(north.z0).toBeCloseTo(W.z0 + 26, 1);
    expect(east.y1).toBeCloseTo(ctx.coords.y(44), 3);

    const outer = soloPass(ctx);
    THING_BUILDERS.bank(outer.pass, find('bank'));
    // 墙脚的土坡用它自己的材质（旧土），不和新筑的堤一个颜色
    expect(boxesOf(outer.bucket.main, 'earth')).toHaveLength(0);
    const [apron] = boxesOf(outer.bucket.main, 'bank');
    // 北墙、东墙外面：从墙里一点铺到墙外 106 米，下到平时的水面以下
    expect(apron.z0).toBeCloseTo(W.z0 - 106, 1);
    expect(apron.x1).toBeCloseTo(W.x1 + 106, 1);
    expect(apron.x0).toBeCloseTo(W.x0, 0);
    expect(apron.z1).toBeCloseTo(W.z1, 0);
    expect(apron.y0).toBeLessThan(ctx.coords.y(FIXTURE_HEIGHTS.normal - FIXTURE_HEIGHTS.bed));
    expect(apron.y1).toBeCloseTo(ctx.coords.y(FIXTURE_HEIGHTS.city) + 1.6, 3);
  });

  it('船跟着水位走：水位一变，船那一组升降，apply 说变了', () => {
    const models = buildModels(makeCtx(everythingScene()));
    const coords = frameCoords(fixtureScene().frame);
    expect(models.apply(SECOND, FIXTURE_HEIGHTS.normal, 2400)).toBe(true);
    const floats = (): Object3D[] =>
      meshesUnder(models.group)
        .filter((m) => m.shown && m.mesh.name === 'boats')
        .map((m) => m.mesh.parent)
        .filter((o): o is Object3D => o !== null);
    expect(floats().length).toBeGreaterThanOrEqual(2);
    for (const f of floats()) expect(f.position.y).toBeCloseTo(coords.y(FIXTURE_HEIGHTS.normal), 6);
    expect(models.apply(SECOND, FIXTURE_HEIGHTS.flood, 2400)).toBe(true);
    for (const f of floats()) expect(f.position.y).toBeCloseTo(coords.y(FIXTURE_HEIGHTS.flood), 6);
    expect(models.apply(SECOND, FIXTURE_HEIGHTS.flood, 2400)).toBe(false);
    // 镜头退远：船放大了，船那一组还是只跟着水位走，显出来的东西没有变
    expect(models.apply(SECOND, FIXTURE_HEIGHTS.flood, 40000)).toBe(false);
    for (const f of floats()) expect(f.position.y).toBeCloseTo(coords.y(FIXTURE_HEIGHTS.flood), 6);
    models.dispose();
  });

  it('系着的船沿着线排，船头大致朝着城墙，城门前面留出空；线上摆不下的就少摆', () => {
    const ctx = makeCtx(everythingScene());
    const { pass, bucket } = soloPass(ctx);
    const moored = ctx.scene.dressing.find((d) => d.id === 'moored');
    if (!moored) throw new Error('没有系着的船');
    DRESSING_BUILDERS.boats(pass, moored);
    // 这条线去掉城门前面只剩两百多米：要八条，松松地摆只摆得下一两组
    expect(bucket.boats.length).toBeGreaterThanOrEqual(3);
    expect(bucket.boats.length).toBeLessThanOrEqual(8);
    for (const b of bucket.boats) {
      expect(Math.abs(b.x - (M.wall.x1 + 70))).toBeLessThan(9);
      expect(b.z).toBeGreaterThan(M.wall.z0);
      expect(b.z).toBeLessThan(M.wall.z1);
      // 东门在东墙正中：门的中线左右各 70 米里没有船
      expect(Math.abs(b.z - M.city[1])).toBeGreaterThanOrEqual(68);
      // 船身大致横对着线（线是南北向的，船身东西向），最多偏三十几度
      expect(Math.abs(Math.sin(b.ry ?? 0))).toBeLessThan(0.65);
    }
    // 要五十条，这条线上摆不下：少摆，船和船不叠在一起
    const crowded = soloPass(ctx);
    DRESSING_BUILDERS.boats(crowded.pass, { ...moored, params: { count: 50, moored: true } });
    expect(crowded.bucket.boats.length).toBeGreaterThanOrEqual(3);
    expect(crowded.bucket.boats.length).toBeLessThan(10);
    const zs = crowded.bucket.boats.map((b) => b.z).sort((a, b) => a - b);
    for (let i = 1; i < zs.length; i++) expect(zs[i] - zs[i - 1]).toBeGreaterThan(18);
  });

  it('系着的船松松地分成几组：三到六条一组，组和组之间空出一大段，各组的船头朝向不一样（不排成一把梯子）', () => {
    const ctx = makeCtx(everythingScene());
    const moored = ctx.scene.dressing.find((d) => d.id === 'moored');
    if (!moored) throw new Error('没有系着的船');
    // 一条两公里长的线，离城门远：三十条都摆得下
    const long = soloPass(ctx);
    DRESSING_BUILDERS.boats(long.pass, { ...moored, line: [fixturePoint(900, -1000), fixturePoint(900, 1000)], params: { count: 30, moored: true, seed: 7 } });
    const boats = [...long.bucket.boats].sort((a, b) => a.z - b.z);
    expect(boats).toHaveLength(30);
    // 要五十五条：一条挨一条排得下，可是组和组之间要空着，所以少摆；空的地方一处也不省
    const full = soloPass(ctx);
    DRESSING_BUILDERS.boats(full.pass, { ...moored, line: [fixturePoint(900, -1000), fixturePoint(900, 1000)], params: { count: 55, moored: true, seed: 7 } });
    expect(55 * MOORED_SLOT_M).toBeLessThan(2000);
    expect(full.bucket.boats.length).toBeGreaterThan(30);
    expect(full.bucket.boats.length).toBeLessThan(55);
    const fullZ = full.bucket.boats.map((b) => b.z).sort((a, b) => a - b);
    for (let i = 1; i < fullZ.length; i++) {
      const gap = fullZ[i] - fullZ[i - 1];
      if (gap > MOORED_SLOT_M + 8) expect(gap).toBeGreaterThan(MOORED_GAP_M);
      else expect(gap).toBeGreaterThan(MOORED_SLOT_M - 6);
    }
    // 顺着线，相邻两条隔多远：同一组里差不多一个船位，两组之间至少空出一大段
    const groups: (typeof boats)[] = [[boats[0]]];
    for (let i = 1; i < boats.length; i++) {
      const gap = boats[i].z - boats[i - 1].z;
      if (gap > MOORED_SLOT_M + 8) {
        expect(gap).toBeGreaterThan(MOORED_GAP_M);
        groups.push([]);
      } else {
        expect(gap).toBeGreaterThan(MOORED_SLOT_M - 6);
      }
      groups[groups.length - 1].push(boats[i]);
    }
    expect(groups.length).toBeGreaterThanOrEqual(5);
    for (const g of groups) {
      expect(g.length).toBeGreaterThanOrEqual(3);
      expect(g.length).toBeLessThanOrEqual(6);
    }
    // 船头不都朝一个方向：各组偏的不一样，同一组里也各偏一点
    const turns = boats.map((b) => Math.asin(Math.sin(b.ry ?? 0)));
    expect(Math.max(...turns) - Math.min(...turns)).toBeGreaterThan(0.3);
    const means = groups.map((g) => g.reduce((s, b) => s + Math.asin(Math.sin(b.ry ?? 0)), 0) / g.length);
    expect(Math.max(...means) - Math.min(...means)).toBeGreaterThan(0.15);
    // 同一个种子每次一样
    const again = soloPass(ctx);
    DRESSING_BUILDERS.boats(again.pass, { ...moored, line: [fixturePoint(900, -1000), fixturePoint(900, 1000)], params: { count: 30, moored: true, seed: 7 } });
    expect(again.bucket.boats).toEqual(long.bucket.boats);
    // 每条船记着自己在第几组；远了一条也不去掉、不挪地方，只是各自放大
    expect(new Set(boats.map((b) => b.cluster)).size).toBe(groups.length);
    groups.forEach((g) => expect(new Set(g.map((b) => b.cluster)).size).toBe(1));
    const far = figureAt(500_000);
    for (const b of boats) {
      expect(b.figure?.cls).toBe('boat');
      expect(figureShow([slotOf('boat'), b.figure?.rank ?? 0, 0, 0], far)).toBe(1);
    }
  });

  it('木桩护岸：每根桩落在自己脚下，地面、盖在地面上的土坡、平时的水面里最高的那个；横木一根桩一根桩地接', () => {
    const ctx = makeCtx(everythingScene());
    const W = M.wall;
    const waterY = ctx.coords.y(FIXTURE_HEIGHTS.normal);
    /** 一排桩：每根桩的位置和桩顶。 */
    const piles = (line: Vec2[]): { x: number; z: number; top: number }[] => {
      const { pass, bucket } = soloPass(ctx);
      THING_BUILDERS['timber-bank'](pass, thing('piles', 'timber-bank', { line: line.map((p) => fixturePoint(p[0], p[1])) }));
      const posts = boxesOf(bucket.main, 'plainTimber').filter((b) => b.vertices === 72);
      // 横木：两道，一根桩到下一根桩一段
      expect(boxesOf(bucket.main, 'plainTimber').filter((b) => b.vertices === 36)).toHaveLength((posts.length - 1) * 2);
      return posts.map((b) => ({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2, top: b.y1 }));
    };
    // 河里的一排（河床比水面低）：桩顶露出水面
    const inRiver = piles([
      [-100, 500],
      [-100, 600],
    ]);
    expect(inRiver.length).toBeGreaterThan(10);
    for (const p of inRiver) expect(p.top).toBeCloseTo(waterY + PILE_ABOVE, 3);
    // 从东墙外的土坡平台上一直排到河里：坡上的桩站在坡面上，没有一根埋在土坡里
    const { pass } = soloPass(ctx);
    const across = piles([
      [W.x1 + 40, 100],
      [W.x1 + 130, 100],
    ]);
    const flatTop = ctx.coords.y(FIXTURE_HEIGHTS.city) + 1.6;
    expect(bankSurfaceY(pass, W.x1 + 40, 100)).toBeCloseTo(flatTop, 6);
    expect(bankSurfaceY(pass, W.x1 + 130, 100)).toBeNull();
    // 土坡只贴着北墙和东墙：南墙外、东南角往南都没有
    expect(bankSurfaceY(pass, M.city[0], W.z1 + 40)).toBeNull();
    expect(bankSurfaceY(pass, W.x1 + 40, W.z1 + 30)).toBeNull();
    let onSlope = 0;
    for (const p of across) {
      const cover = bankSurfaceY(pass, p.x, p.z);
      const foot = Math.max(ctx.coords.y(ctx.samplers.height(p.x, p.z)), cover ?? -Infinity, waterY);
      expect(p.top).toBeCloseTo(foot + PILE_ABOVE, 3);
      if (cover !== null && cover > waterY) onSlope++;
    }
    expect(across[0].top).toBeCloseTo(flatTop + PILE_ABOVE, 3);
    expect(onSlope).toBeGreaterThan(5);
    expect(across[across.length - 1].top).toBeCloseTo(waterY + PILE_ABOVE, 3);
  });

  it('树：没有树的规则就没有树；只摆一套；大水的一节，淹在水下的缩没了；远了苔点只画次序在前面的；镜头贴近才有细做的那几棵', async () => {
    const none = buildModels(makeCtx());
    none.apply(FIRST, FIXTURE_HEIGHTS.normal, 6000);
    expect(meshesUnder(none.group).some((m) => m.mesh.name.startsWith('trees:'))).toBe(false);
    none.dispose();

    const models = buildModels(makeCtx(everythingScene()));
    await models.prepare([FIRST, SECOND]);
    const flocks = (): InstancedMesh[] =>
      meshesUnder(models.group)
        .filter((m) => m.shown && m.mesh.name.startsWith('trees:'))
        .map((m) => m.mesh as InstancedMesh);
    /** 现在画着的树里，原样大小的有几棵、缩没了的有几棵。 */
    const tally = (D: number, level: number): { full: number; gone: number; drawn: number } => {
      const u = figureAt(D, level);
      let full = 0;
      let gone = 0;
      let drawn = 0;
      for (const mesh of flocks()) {
        for (let i = 0; i < mesh.count; i++) {
          const show = figureShow(instanceMarks(mesh, i).fig, u);
          drawn++;
          if (show > 0.999) full++;
          if (show < 0.001) gone++;
        }
      }
      return { full, gone, drawn };
    };

    models.apply(FIRST, FIXTURE_HEIGHTS.normal, 6000);
    // 圆一点的苔点（城四周）、城里跟着屋子走的苔点、细做的树（松树那一条规则，写了点的）；这座小沙盘不到三公里宽，没有“再远的苔点”
    expect(flocks().map((m) => m.name).sort()).toEqual(['trees:city', 'trees:fine', 'trees:round', 'trees:round']);
    const calm = tally(6000, FIXTURE_HEIGHTS.normal);
    expect(calm.full).toBeGreaterThan(50);
    expect(calm.gone).toBe(0);
    expect(calm.full).toBe(calm.drawn);
    // 每一棵都是“树”这一类；水漫不到的（城里的）写的是一个到不了的高度
    for (const mesh of flocks()) {
      for (let i = 0; i < mesh.count; i++) {
        const m = instanceMarks(mesh, i);
        expect([FIG_TREE, FIG_TREE_DOT]).toContain(m.fig[2]);
        expect(m.pivot).toEqual([0, 0, 0]);
      }
    }

    // 大水（43 米，平地 40 米）：平地上的树脚下水深三米，缩没了；山上的还是原样。网格还是那几个，没有另造一套
    const meshesBefore = meshesUnder(models.group).length;
    models.apply(SECOND, FIXTURE_HEIGHTS.flood, 6000);
    expect(meshesUnder(models.group)).toHaveLength(meshesBefore);
    const flood = tally(6000, FIXTURE_HEIGHTS.flood);
    expect(flood.gone).toBeGreaterThan(10);
    expect(flood.full).toBeGreaterThan(0);
    expect(flood.full).toBeLessThan(calm.full);
    // 水刚到树脚下一米深的时候树还是原样，再深一米才缩没：水位落到 40.9 米（平地上水深不到一米），平地上的树都回来了
    models.apply(SECOND, 40.9, 6000);
    expect(tally(6000, 40.9).gone).toBe(0);
    models.apply(SECOND, 41.5, 6000);
    const half = tally(6000, 41.5);
    expect(half.gone).toBe(0);
    expect(half.full).toBeLessThan(half.drawn);

    // 远了：苔点放大，按次序去掉一些，成批摆的网格只画前面的那些
    models.apply(FIRST, FIXTURE_HEIGHTS.normal, 60000);
    const far = tally(60000, FIXTURE_HEIGHTS.normal);
    const keepAtMax = testStyle.figure.rules.tree.keepAtMax ?? 1;
    expect(far.drawn).toBeLessThan(calm.drawn * (keepAtMax / KEEP_FRINGE) + 12);
    expect(far.full).toBeGreaterThan(calm.drawn * keepAtMax * 0.7);
    expect(far.full).toBeLessThan(calm.drawn * keepAtMax + 20);
    expect(figureAt(60000).uFigTimes.value[slotOf('tree')]).toBeCloseTo(testStyle.figure.rules.tree.maxTimes, 3);

    // 镜头贴近（后一节写的是 2400 米）：对准的那一点四周的苔点换成细做的，两样此消彼长
    models.apply(SECOND, FIXTURE_HEIGHTS.normal, 1500);
    const close = flocks().find((m) => m.name === 'trees:close');
    expect(close).toBeDefined();
    if (!close) return;
    expect(close.count).toBeGreaterThan(0);
    const near = figureAt(1500);
    const mid = figureAt(3700);
    const away = figureAt(6000);
    for (let i = 0; i < close.count; i++) {
      const m = instanceMarks(close, i);
      expect(m.fig[2]).toBe(FIG_TREE_FINE);
      expect(figureShow(m.fig, near)).toBe(1);
      expect(figureShow(m.fig, away)).toBe(0);
      expect(figureShow(m.fig, mid)).toBeGreaterThan(0.2);
      expect(figureShow(m.fig, mid)).toBeLessThan(0.8);
    }
    const dots = flocks()
      .filter((m) => m.name !== 'trees:close')
      .flatMap((mesh) => Array.from({ length: mesh.count }, (_, i) => instanceMarks(mesh, i)))
      .filter((m) => m.fig[2] === FIG_TREE_DOT);
    expect(dots).toHaveLength(close.count);
    for (const m of dots) {
      expect(figureShow(m.fig, near)).toBe(0);
      expect(figureShow(m.fig, away)).toBe(1);
      // 一棵缩多少，另一棵就长多少
      const fine: FigureMarks['fig'] = [m.fig[0], m.fig[1], FIG_TREE_FINE, m.fig[3]];
      expect(figureShow(m.fig, mid) + figureShow(fine, mid)).toBeCloseTo(1, 9);
    }
    models.apply(SECOND, FIXTURE_HEIGHTS.normal, 6000);
    expect(flocks().some((m) => m.name === 'trees:close')).toBe(false);
    models.dispose();
  });

  it('画质里树留几成：留得少，树就少；留下的次序没有变', () => {
    // city 是城里跟着屋子走的那一份：它们记号上的次序是各自那座屋的（远了屋在树在），不是这条规则里的次序
    const ranks = (treeKeep: number, city: boolean): number[] => {
      const models = buildModels(makeCtx(everythingScene(), flatGround(), { ...FULL, treeKeep }));
      models.apply(FIRST, FIXTURE_HEIGHTS.normal, 6000);
      const out = meshesUnder(models.group)
        .filter((m) => m.mesh.name.startsWith('trees:') && m.mesh.name !== 'trees:close' && (m.mesh.name === 'trees:city') === city)
        .flatMap((m) => Array.from({ length: (m.mesh as InstancedMesh).count }, (_, i) => instanceMarks(m.mesh as InstancedMesh, i).fig[1]));
      models.dispose();
      return out.sort((a, b) => a - b);
    };
    const all = ranks(1, false);
    const half = ranks(0.5, false);
    expect(half.length).toBeLessThan(all.length * 0.6);
    expect(half.length).toBeGreaterThan(all.length * 0.4);
    // 留下的就是次序在前一半的那些
    expect(Math.max(...half)).toBeLessThan(0.5);
    expect(half).toEqual(all.filter((r) => r < 0.5));
    // 城里的树不比完整的一档多；留下的还是原来那几块空地上的（次序是那几座屋的，没有变）
    const cityAll = ranks(1, true);
    const cityHalf = ranks(0.5, true);
    expect(cityAll.length).toBeGreaterThanOrEqual(3);
    expect(cityHalf.length).toBeLessThanOrEqual(cityAll.length);
    const left = [...cityAll];
    for (const r of cityHalf) {
      const at = left.indexOf(r);
      expect(at, `减配的一档里城里有一棵树，完整的一档里没有（次序 ${r}）`).toBeGreaterThanOrEqual(0);
      left.splice(at, 1);
    }
  });
});

// ---------------------------------------------------------------- 记号

describe('每样东西带的记号（脚在哪、哪一类、是不是细处、立在哪）', () => {
  const ctx = makeCtx(everythingScene());
  const find = (id: string): SceneThing => {
    const t = ctx.scene.things.find((x) => x.id === id);
    if (!t) throw new Error(`没有 ${id}`);
    return t;
  };
  const rule = (id: string): SceneDressing => {
    const d = ctx.scene.dressing.find((x) => x.id === id);
    if (!d) throw new Error(`没有 ${id}`);
    return d;
  };
  /** 只造这一样摆件，返回它放进去的零件（一般的零件和城墙、城门那一组的分开）。 */
  const build = (id: string): { main: BufferGeometry[]; raised: BufferGeometry[]; thing: SceneThing } => {
    const { pass, bucket } = soloPass(ctx);
    const t = find(id);
    coreBuilder(t.kind)(pass, t);
    return { main: [...bucket.main.parts.values()].flat(), raised: [...bucket.raised.parts.values()].flat(), thing: t };
  };
  const W = M.wall;
  const cityY = ctx.coords.y(FIXTURE_HEIGHTS.city);
  /** 不是细处的那些零件。 */
  const body = (parts: BufferGeometry[]): BufferGeometry[] => parts.filter((g) => marksOf(g).fig[2] !== FIG_DETAIL);
  const details = (parts: BufferGeometry[]): BufferGeometry[] => parts.filter((g) => marksOf(g).fig[2] === FIG_DETAIL);
  /** 这些零件合起来占的范围。 */
  const union = (parts: BufferGeometry[]): Box => {
    const out: Box = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, z0: Infinity, z1: -Infinity, vertices: 0 };
    for (const b of parts.map(boxOf)) {
      out.x0 = Math.min(out.x0, b.x0);
      out.x1 = Math.max(out.x1, b.x1);
      out.y0 = Math.min(out.y0, b.y0);
      out.y1 = Math.max(out.y1, b.y1);
      out.z0 = Math.min(out.z0, b.z0);
      out.z1 = Math.max(out.z1, b.z1);
      out.vertices += b.vertices;
    }
    return out;
  };

  it('批次里的每个零件都带着三样数据，一个零件的每个顶点带的都一样；没有记号的零件都是 0', () => {
    const { pass, bucket } = soloPass(ctx);
    for (const kind of THING_KINDS) for (const t of ctx.scene.things) if (t.kind === kind) coreBuilder(kind)(pass, t);
    for (const kind of DRESSING_KINDS) for (const d of ctx.scene.dressing) if (d.kind === kind) DRESSING_BUILDERS[kind](pass, d);
    let parts = 0;
    for (const batch of [bucket.main, bucket.raised]) {
      expect(batch.tag).toBeNull();
      for (const list of batch.parts.values()) {
        for (const g of list) {
          parts++;
          const n = g.attributes.position.count;
          expect(g.attributes.aPivot.count).toBe(n);
          expect(g.attributes.aGroup.count).toBe(n);
          expect(g.attributes.aFig.count).toBe(n);
          expect(g.attributes.aPivot.itemSize).toBe(3);
          expect(g.attributes.aGroup.itemSize).toBe(3);
          expect(g.attributes.aFig.itemSize).toBe(4);
          const first = marksOf(g, 0);
          expect(marksOf(g, n - 1)).toEqual(first);
          expect(marksOf(g, n >> 1)).toEqual(first);
          for (const v of [...first.pivot, ...first.group, ...first.fig]) expect(Number.isFinite(v)).toBe(true);
          expect(first.fig[0]).toBeGreaterThanOrEqual(0);
          expect(first.fig[0]).toBeLessThan(FIGURE_SLOTS);
          expect(first.fig[1]).toBeGreaterThanOrEqual(0);
          expect(first.fig[1]).toBeLessThan(1);
          // 城墙、城门那一组里只有细处带记号（垛口这些），别的不归类：整组拔高
          if (batch === bucket.raised) expect(first.fig[0]).toBe(0);
        }
      }
    }
    expect(parts).toBeGreaterThan(500);
    // 墙身、堤、土坡没有记号：三样都是 0，显卡原样画
    for (const id of ['dike', 'dike-inner', 'bank', 'bank-free']) {
      const { main } = build(id);
      expect(main.length).toBeGreaterThan(0);
      for (const g of main) expect(marksOf(g)).toEqual({ pivot: [0, 0, 0], group: [0, 0, 0], fig: [0, 0, 0, 0] });
    }
  });

  it('归了类的东西，脚都在它自己的底下：横着在它占的那一块里面，竖着在它的底上', () => {
    const { pass, bucket } = soloPass(ctx);
    for (const kind of THING_KINDS) for (const t of ctx.scene.things) if (t.kind === kind) coreBuilder(kind)(pass, t);
    for (const kind of DRESSING_KINDS) for (const d of ctx.scene.dressing) if (d.kind === kind) DRESSING_BUILDERS[kind](pass, d);
    // 脚一样的零件是同一样东西的
    const things = new Map<string, { marks: FigureMarks; parts: BufferGeometry[] }>();
    for (const g of body([...bucket.main.parts.values()].flat())) {
      const m = marksOf(g);
      if (m.fig[0] === 0) continue;
      const key = m.pivot.map((v) => v.toFixed(3)).join(',');
      const entry = things.get(key) ?? { marks: m, parts: [] };
      entry.parts.push(g);
      things.set(key, entry);
    }
    expect(things.size).toBeGreaterThan(40);
    const yards = [slotOf('yardCity'), slotOf('yardOut')];
    for (const { marks, parts } of things.values()) {
      const b = union(parts);
      const where = `类 ${marks.fig[0]}，脚 (${marks.pivot.map((v) => v.toFixed(0)).join(', ')})`;
      expect(marks.pivot[0] > b.x0 - 1 && marks.pivot[0] < b.x1 + 1 && marks.pivot[2] > b.z0 - 1 && marks.pivot[2] < b.z1 + 1, `${where} 的脚不在它脚下`).toBe(true);
      if (yards.includes(marks.fig[0])) {
        // 一组院落是一样东西，顺着山坡的几座殿高高低低：脚在院子正中的地上，在这一组的最低和最高之间
        expect(marks.pivot[1]).toBeGreaterThanOrEqual(b.y0 - 0.01);
        expect(marks.pivot[1]).toBeLessThan(b.y1);
      } else {
        // 单独的一样东西：脚在它的底上（石头的底埋在脚下面一点）。
        // 地上单座的茅屋底下有台基，坡地上台基往下埋到最低的一角以下，脚（屋子正中的地面）在台基里面：最多到一半高
        const share = marks.fig[0] === slotOf('hut') ? 0.5 : 0.3;
        expect(marks.pivot[1], `${where} 的脚悬在半空`).toBeLessThan(b.y0 + share * (b.y1 - b.y0) + 0.01);
        expect(marks.pivot[1], `${where} 的脚在它的底下面老远`).toBeGreaterThan(b.y0 - 0.01);
      }
    }
  });

  it('楼：城门上的是“楼”这一类，脚在城台顶上，立在墙上；墙角上的是“墙顶上的”一类；地上的脚在地面下 1', () => {
    const gateTop = cityY + 70;
    const onGate = build('tower-east');
    expect(onGate.main.length).toBeGreaterThan(50);
    for (const g of onGate.main) {
      const m = marksOf(g);
      expect(m.fig).toEqual([slotOf('tower'), 0, 0, FIG_ON_WALL]);
      expect(m.pivot[0]).toBeCloseTo(W.x1, 1);
      expect(m.pivot[1]).toBeCloseTo(gateTop, 3);
      expect(m.pivot[2]).toBeCloseTo(M.city[1], 1);
      expect(m.group).toEqual(m.pivot);
    }
    expect(union(onGate.main).y0).toBeCloseTo(gateTop, 3);

    const corner = build('tower-corner');
    for (const g of corner.main) {
      const m = marksOf(g);
      expect(m.fig).toEqual([slotOf('wallTop'), 0, 0, FIG_ON_WALL]);
      expect(m.pivot[1]).toBeCloseTo(gateTop, 3);
    }
    const free = build('tower-free');
    const freeY = ctx.coords.y(FIXTURE_HEIGHTS.plainBase) - 1;
    for (const g of free.main) {
      const m = marksOf(g);
      // 平地上，水漫得到
      expect(m.fig).toEqual([slotOf('tower'), 0, 0, FIG_WET]);
      expect(m.pivot[0]).toBeCloseTo(-1000, 1);
      expect(m.pivot[1]).toBeCloseTo(freeY, 3);
      expect(m.pivot[2]).toBeCloseTo(600, 1);
    }
    // 三样的类都和题签那一边用的算法（liftClass）说的一样
    for (const built of [onGate, corner, free]) expect(marksOf(built.main[0]).fig[0]).toBe(slotOf(liftClass(built.thing, ctx.scene) ?? 'rock'));
  });

  it('亭、单座的屋：墙上的立在墙顶，地上的绕着自己的脚；草屋的篱笆是细处，跟着草屋', () => {
    const top = cityY + 62;
    const shed = build('shed');
    for (const g of shed.main) {
      const m = marksOf(g);
      expect(m.fig).toEqual([slotOf('shed'), 0, 0, FIG_ON_WALL]);
      expect(m.pivot[1]).toBeCloseTo(top, 3);
      expect(m.pivot[0]).toBeCloseTo(W.x1, 1);
    }
    expect(union(shed.main).y0).toBeCloseTo(top, 3);
    const onCorner = build('pavilion-corner');
    for (const g of onCorner.main) expect(marksOf(g).fig).toEqual([slotOf('wallTop'), 0, 0, FIG_ON_WALL]);
    const hill = build('pavilion-hill');
    const hillY = ctx.coords.y(ctx.samplers.height(700, -200)) - 2;
    for (const g of hill.main) {
      const m = marksOf(g);
      expect(m.fig).toEqual([slotOf('pavilion'), 0, 0, FIG_WET]);
      expect(m.pivot[0]).toBeCloseTo(700, 1);
      // 山坡上：经纬度换回米差几毫米，高度跟着差一点
      expect(m.pivot[1]).toBeCloseTo(hillY, 1);
      expect(m.group).toEqual(m.pivot);
    }
    const hut = build('hut');
    const slopeFoot = marksOf(body(hut.main)[0]).pivot;
    expect(slopeFoot[0]).toBeCloseTo(500, 1);
    expect(slopeFoot[2]).toBeCloseTo(-200, 1);
    for (const g of body(hut.main)) expect(marksOf(g).fig).toEqual([slotOf('hut'), 0, 0, FIG_WET]);
    // 夹具里的这座草屋在山坡上（离山顶 300 米）：篱笆只围平地，上了坡的不做，这里一段也没有
    expect(details(hut.main)).toHaveLength(0);
    // 同样的一座摆到平地上：一圈篱笆
    const flat = soloPass(ctx);
    THING_BUILDERS.house(flat.pass, { ...hut.thing, id: 'hut-flat', at: fixturePoint(700, 700) });
    const flatParts = [...flat.bucket.main.parts.values()].flat();
    const hutFoot = marksOf(body(flatParts)[0]).pivot;
    expect(hutFoot[0]).toBeCloseTo(700, 1);
    expect(hutFoot[2]).toBeCloseTo(700, 1);
    const fence = details(flatParts);
    // 篱笆一圈：十几根桩、十几段编起来的篱
    expect(fence.length).toBeGreaterThan(30);
    const spreadOut = figureAt(1_000_000, FIXTURE_HEIGHTS.normal - 50);
    for (const g of fence) {
      const m = marksOf(g);
      expect(m.fig).toEqual([slotOf('hut'), 0, FIG_DETAIL, FIG_WET]);
      // 它跟着草屋放大：横竖从草屋的脚摊开，高度跟着地面走（摊开到头时，桩脚在它到了的那个地方的地面下 1 上下）；它自己的脚在自己底下
      expect(m.group[0]).toBe(hutFoot[0]);
      expect(m.group[2]).toBe(hutFoot[2]);
      const landed = figureMove(m.pivot, m, spreadOut);
      expect(Math.abs(landed[1] - (ctx.coords.y(ctx.samplers.height(landed[0], landed[2])) - 1))).toBeLessThan(1.5);
      const b = boxOf(g);
      expect(m.pivot[0]).toBeGreaterThan(b.x0 - 0.5);
      expect(m.pivot[0]).toBeLessThan(b.x1 + 0.5);
      expect(m.pivot[1]).toBeLessThan(b.y1);
      expect(Math.hypot(m.pivot[0] - hutFoot[0], m.pivot[2] - hutFoot[2])).toBeGreaterThan(20);
    }
    for (const built of [shed, onCorner, hill, hut]) expect(marksOf(body(built.main)[0]).fig[0]).toBe(slotOf(liftClass(built.thing, ctx.scene) ?? 'rock'));
  });

  it('一组院落是一样东西：脚在院子正中的地上，长廊、门屋、围墙是细处；城里的和城外的各是一类', () => {
    const yamen = build('yamen');
    const yardFoot: Vec3 = [M.city[0] - 60, cityY, M.city[1] - 60];
    for (const g of yamen.main) {
      const m = marksOf(g);
      // 城里水漫不进去
      expect(m.fig[0]).toBe(slotOf('yardCity'));
      expect(m.fig[3]).toBe(0);
      expect(m.group[0]).toBeCloseTo(yardFoot[0], 1);
      expect(m.group[1]).toBeCloseTo(yardFoot[1], 3);
      expect(m.group[2]).toBeCloseTo(yardFoot[2], 1);
      if (m.fig[2] !== FIG_DETAIL) expect(m.pivot).toEqual(m.group);
    }
    // 两进殿是本体；两条长廊、一座门屋、一圈围墙是细处
    expect(body(yamen.main).length).toBeGreaterThan(40);
    expect(details(yamen.main).length).toBeGreaterThanOrEqual(2 * 2 + 2 + 5);
    const temple = build('temple');
    for (const g of temple.main) expect(marksOf(g).fig[0]).toBe(slotOf('yardOut'));
    for (const built of [yamen, temple]) expect(marksOf(body(built.main)[0]).fig[0]).toBe(slotOf(liftClass(built.thing, ctx.scene) ?? 'rock'));
    // 放大到头：整组绕着院子正中放大，殿和围墙还对得上（围墙的四个角到院子正中的远近，正好是原来的倍数）
    const far = figureAt(500_000);
    const k = testStyle.figure.rules.yardCity.maxTimes;
    const was = union(yamen.main);
    const noFade: FigureUniforms = { ...far, uFigDetail: makeFigureUniforms().uFigDetail };
    const moved = yamen.main.map((g) => movedBox(g, noFade));
    for (const [edge, sign] of [
      ['x0', -1],
      ['x1', 1],
      ['z0', -1],
      ['z1', 1],
    ] as const) {
      const axis = edge[0] === 'x' ? 0 : 2;
      const now = sign < 0 ? Math.min(...moved.map((b) => b[edge])) : Math.max(...moved.map((b) => b[edge]));
      expect(now - yardFoot[axis]).toBeCloseTo((was[edge] - yardFoot[axis]) * k, 1);
    }
  });

  it('城墙、城门上的细处：垛口、里侧的矮墙、门缝、门洞口的一圈，各带各的脚', () => {
    const wall = build('wall');
    expect(wall.main).toHaveLength(0);
    const merlons = details(wall.raised);
    // 四面墙的垛口、角台上的垛口、四道矮墙
    expect(merlons.length).toBeGreaterThan(60);
    for (const g of merlons) {
      const m = marksOf(g);
      const b = boxOf(g);
      expect(m.fig).toEqual([0, 0, FIG_DETAIL, 0]);
      expect(m.group).toEqual(m.pivot);
      // 脚在这一处的底面正中
      expect(m.pivot[1]).toBeCloseTo(b.y0, 3);
      expect(m.pivot[0]).toBeCloseTo((b.x0 + b.x1) / 2, 1);
      expect(m.pivot[2]).toBeCloseTo((b.z0 + b.z1) / 2, 1);
    }
    // 墙身、角台不是细处
    expect(body(wall.raised).length).toBe(8 + 4);
    const gate = build('gate-south');
    // 城台和门扇是本体；门缝、两圈门洞口、垛口、矮墙、四个墩子是细处
    expect(body(gate.raised)).toHaveLength(2);
    expect(details(gate.raised).length).toBeGreaterThan(10);
    for (const g of details(gate.raised)) {
      const m = marksOf(g);
      const b = boxOf(g);
      expect(m.pivot[1]).toBeCloseTo(b.y0, 2);
      expect(m.pivot[0]).toBeGreaterThan(b.x0 - 0.01);
      expect(m.pivot[0]).toBeLessThan(b.x1 + 0.01);
    }
    const piles = build('timber-bank');
    expect(body(piles.main)).toHaveLength(0);
    expect(details(piles.main).length).toBeGreaterThan(10);
  });

  it('村子：屋绕着自己的脚放大，从村子的中心摊开；每个村子的第一间排在最前面', () => {
    const { pass, bucket } = soloPass(ctx);
    DRESSING_BUILDERS.villages(pass, rule('villages'));
    const roofs = partsOf(bucket.main, 'thatch');
    expect(roofs).toHaveLength(6 + 7);
    const centres = ctx.ground.villages.map((v): Vec2 => [v.x, v.z]);
    const ranks: number[] = [];
    for (const g of roofs) {
      const m = marksOf(g);
      expect(m.fig[0]).toBe(slotOf('village'));
      expect(m.fig[2]).toBe(0);
      expect(m.fig[3]).toBe(FIG_WET);
      expect(centres.some((c) => Math.abs(c[0] - m.group[0]) < 0.01 && Math.abs(c[1] - m.group[2]) < 0.01)).toBe(true);
      // 摊开的时候不改高低
      expect(m.group[1]).toBe(m.pivot[1]);
      ranks.push(m.fig[1]);
    }
    // 次序一个不重，从 0 起
    expect(new Set(ranks).size).toBe(roofs.length);
    expect(Math.min(...ranks)).toBe(0);
    // 放大到头留六成五：两个村子都还有屋
    const far = figureAt(500_000);
    const left = roofs.filter((g) => figureShow(marksOf(g).fig, far) === 1).map((g) => marksOf(g).group[0]);
    expect(left.length).toBeGreaterThanOrEqual(8);
    expect(left.length).toBeLessThan(roofs.length);
    expect(new Set(left.map((x) => Math.round(x))).size).toBe(2);
    // 一间屋放大到头：离村子中心 1.5 倍远，自己 2.5 倍大
    const g = roofs[0];
    const m = marksOf(g);
    const b = boxOf(g);
    const moved = movedBox(g, { ...far, uFigKeep: { value: new Float32Array(FIGURE_SLOTS).fill(1) } });
    expect((moved.x0 + moved.x1) / 2 - m.group[0]).toBeCloseTo(((b.x0 + b.x1) / 2 - m.group[0]) * 1.5 + ((b.x0 + b.x1) / 2 - m.pivot[0]) * (2.5 - 1.5), 1);
    expect(moved.x1 - moved.x0).toBeCloseTo((b.x1 - b.x0) * 2.5, 2);
  });

  it('石头、船：一块一条各带各的次序，一样也不去掉；两岸的石头是细处；挨着寺的那堆石头跟着寺放大', () => {
    const grey = soloPass(ctx);
    DRESSING_BUILDERS.rocks(grey.pass, rule('rapids-rocks'));
    const rocks = partsOf(grey.bucket.main, 'rock');
    expect(rocks.length).toBeGreaterThan(10);
    const far = figureAt(500_000);
    const waterY = ctx.coords.y(FIXTURE_HEIGHTS.normal);
    const ranks = new Set<number>();
    for (const g of rocks) {
      const m = marksOf(g);
      expect(m.fig[0]).toBe(slotOf('rock'));
      expect(m.group).toEqual(m.pivot);
      ranks.add(m.fig[1]);
      // 再远也是原样留着
      expect(figureShow(m.fig, far)).toBe(1);
      // 河里的石头脚在平时的水面下一点；两岸的是细处，脚在地面下 1
      if (m.fig[2] === FIG_DETAIL) expect(m.pivot[1]).toBeGreaterThan(waterY);
      else expect(m.pivot[1]).toBeCloseTo(waterY - 1.5, 3);
    }
    expect(ranks.size).toBe(rocks.length);
    expect(rocks.some((g) => marksOf(g).fig[2] === FIG_DETAIL)).toBe(true);
    expect(rocks.some((g) => marksOf(g).fig[2] !== FIG_DETAIL)).toBe(true);

    // 山冈上的白石头摆在寺旁边（寺放大到头时占的那一块里面）：跟着寺那一组，类是城外的院落，横竖从寺的脚摊开；
    // 高度跟着地面走：摊开到头时，每块石头的脚正好在它到了的那个地方的地面下 1（不埋进坡里，也不悬空）
    const pale = soloPass(ctx);
    DRESSING_BUILDERS.rocks(pale.pass, rule('sheep-rocks'));
    const sheep = partsOf(pale.bucket.main, 'rockPale');
    expect(sheep).toHaveLength(12);
    const templeFoot: Vec3 = [800, ctx.coords.y(ctx.samplers.height(800, -200)) - 1, -200];
    const spreadOut = figureAt(1_000_000, FIXTURE_HEIGHTS.normal - 50);
    for (const g of sheep) {
      const m = marksOf(g);
      expect(m.fig[0]).toBe(slotOf('yardOut'));
      expect(m.group[0]).toBeCloseTo(templeFoot[0], 1);
      expect(m.group[2]).toBeCloseTo(templeFoot[2], 1);
      const landed = figureMove(m.pivot, m, spreadOut);
      expect(Math.hypot(landed[0] - templeFoot[0], landed[2] - templeFoot[2])).toBeGreaterThan(Math.hypot(m.pivot[0] - templeFoot[0], m.pivot[2] - templeFoot[2]) * 1.5);
      expect(landed[1]).toBeCloseTo(ctx.coords.y(ctx.samplers.height(landed[0], landed[2])) - 1, 1);
    }

    const boats = soloPass(ctx);
    DRESSING_BUILDERS.boats(boats.pass, rule('moored'));
    DRESSING_BUILDERS.boats(boats.pass, rule('small-boats'));
    expect(boats.bucket.boats.length).toBeGreaterThanOrEqual(5);
    for (const b of boats.bucket.boats) {
      const small = b.rule === 'small-boats';
      expect(b.figure?.cls).toBe(small ? 'smallBoat' : 'boat');
      // 绕着船身正中吃水的那一点放大：它自己的坐标里高 0.6，摆出来正好在水面上
      expect(b.figure?.pivot).toEqual([0, 0.6, 0]);
      expect(b.y + 0.6 * (b.s ?? 1)).toBeCloseTo(0, 9);
      expect(b.s).toBe(small ? 0.6 : 1);
      expect(b.cluster).toBeGreaterThanOrEqual(0);
    }
    const mooredRanks = boats.bucket.boats.filter((b) => b.rule === 'moored').map((b) => b.figure?.rank ?? -1);
    expect(new Set(mooredRanks).size).toBe(mooredRanks.length);
    expect(Math.min(...mooredRanks)).toBe(0);
  });

  it('有题签指着一条点缀规则时，离题签最近的那一样次序是 0：再远也去不掉它', () => {
    const scene = everythingScene();
    scene.strips.push({ id: 's-village', text: '某村', of: 'villages', at: fixturePoint(600, 800) });
    const pointed = makeCtx(scene);
    const { pass, bucket } = soloPass(pointed);
    const villages = scene.dressing.find((d) => d.id === 'villages');
    if (!villages) throw new Error('没有村子');
    DRESSING_BUILDERS.villages(pass, villages);
    const roofs = partsOf(bucket.main, 'thatch').map((g) => marksOf(g));
    const first = roofs.filter((m) => m.fig[1] === 0);
    expect(first).toHaveLength(1);
    const nearest = roofs.reduce((a, b) => (Math.hypot(a.pivot[0] - 600, a.pivot[2] - 800) < Math.hypot(b.pivot[0] - 600, b.pivot[2] - 800) ? a : b));
    expect(first[0]).toEqual(nearest);
  });
});

// ---------------------------------------------------------------- 显卡上的那一段

describe('补进材质的那一段着色器，和同一套算术', () => {
  it('three 的 Lambert 和画影子的顶点着色器都补得进去；落脚的地方没有了就报错', () => {
    const lit = figureVertex(ShaderLib.lambert.vertexShader, true);
    const depth = figureVertex(ShaderLib.depth.vertexShader);
    for (const source of [lit, depth]) {
      for (const name of ['attribute vec3 aPivot;', 'attribute vec3 aGroup;', 'attribute vec4 aFig;', 'uFigTimes', 'uFigKeep', 'uFigSpread', 'uFigDetail', 'uFigWater', 'uFigClose']) expect(source).toContain(name);
      // 声明在 <common> 后面，挪顶点在 <begin_vertex> 后面
      expect(source.indexOf('attribute vec3 aPivot;')).toBeGreaterThan(source.indexOf('#include <common>'));
      expect(source.indexOf('transformed = figAt')).toBeGreaterThan(source.indexOf('#include <begin_vertex>'));
      expect(source.indexOf('transformed = figAt')).toBeLessThan(source.indexOf('#include <project_vertex>'));
      expect(source.split('transformed = figAt')).toHaveLength(2);
    }
    // 画进画面的改法线，在算法线的那一段以前；画影子的不改
    expect(lit.indexOf('objectNormal = normalize')).toBeGreaterThan(lit.indexOf('#include <beginnormal_vertex>'));
    expect(lit.indexOf('objectNormal = normalize')).toBeLessThan(lit.indexOf('#include <defaultnormal_vertex>'));
    expect(depth).not.toContain('objectNormal = normalize');
    expect(() => figureVertex('void main() {}')).toThrow(/common/);
    expect(() => figureVertex('#include <common>\nvoid main() {}')).toThrow(/begin_vertex/);
    expect(() => figureVertex('#include <common>\n#include <begin_vertex>', true)).toThrow(/beginnormal_vertex/);
  });

  it('每种材质编译以前都接上同一份数；改这一份数，不用重新编译', () => {
    const materials = makeMaterials(testStyle);
    const all = [...Object.values(materials.named), materials.boat, materials.tree, materials.depth];
    const keys = new Set<string>();
    for (const material of all) {
      const shader = { uniforms: {} as Record<string, unknown>, vertexShader: material === materials.depth ? ShaderLib.depth.vertexShader : ShaderLib.lambert.vertexShader, fragmentShader: '' };
      (material.onBeforeCompile as unknown as (s: typeof shader) => void)(shader);
      for (const name of ['uFigTimes', 'uFigKeep', 'uFigSpread', 'uFigDetail', 'uFigWater', 'uFigClose'] as const) expect(shader.uniforms[name]).toBe(materials.figure[name]);
      expect(shader.vertexShader).toContain('transformed = figAt');
      keys.add(material.customProgramCacheKey());
    }
    // 画进画面的都是一个记号（three 才能共用编译好的程序），画影子的是另一个
    expect([...keys].sort()).toEqual([`figure:4:${FIGURE_SLOTS}:depth`, `figure:4:${FIGURE_SLOTS}:lit`]);
    // 一开始什么都不变
    expect(Array.from(materials.figure.uFigTimes.value)).toEqual(new Array(FIGURE_SLOTS).fill(1));
    setFigure(materials.figure, testStyle, 60000, 5, 6);
    expect(materials.figure.uFigTimes.value[0]).toBe(1);
    expect(materials.figure.uFigKeep.value[0]).toBe(1);
    expect(materials.figure.uFigSpread.value[0]).toBe(1);
    expect(materials.figure.uFigTimes.value[slotOf('tower')]).toBeCloseTo(2.25, 3);
    expect(materials.figure.uFigKeep.value[slotOf('cityHouse')]).toBeCloseTo(0.2, 3);
    expect(materials.figure.uFigSpread.value[slotOf('village')]).toBeCloseTo(1.5, 3);
    expect(materials.figure.uFigWater.value.x).toBe(5);
    expect(materials.figure.uFigWater.value.y).toBe(6);
    expect(materials.figure.uFigClose.value).toBe(0);
    materials.dispose();
  });

  const P: Vec3 = [100, 20, -50];
  const plain = (cls: FigureClass | null, more: Partial<{ rank: number; kind: number; flags: number; group: Vec3 }> = {}): FigureMarks => ({
    pivot: P,
    group: more.group ?? P,
    fig: [cls ? slotOf(cls) : 0, more.rank ?? 0, more.kind ?? 0, more.flags ?? 0],
  });

  it('没有记号的顶点在哪儿都原样；归了类的绕着脚放大，近处是 1 倍', () => {
    for (const D of [1000, 9000, 60000]) {
      const u = figureAt(D);
      expect(figureMove([3, 4, 5], { pivot: [0, 0, 0], group: [0, 0, 0], fig: [0, 0, 0, 0] }, u)).toEqual([3, 4, 5]);
    }
    const near = figureAt(100);
    const far = figureAt(500_000);
    const p: Vec3 = [110, 50, -44];
    expect(figureMove(p, plain('tower'), near)).toEqual(p);
    const moved = figureMove(p, plain('tower'), far);
    const k = far.uFigTimes.value[slotOf('tower')];
    expect(k).toBeCloseTo(2.25, 4);
    expect(moved[0]).toBeCloseTo(100 + 10 * k, 9);
    expect(moved[1]).toBeCloseTo(20 + 30 * k, 9);
    expect(moved[2]).toBeCloseTo(-50 + 6 * k, 9);
    // 脚自己不动
    expect(figureMove(P, plain('tower'), far)).toEqual(P);
  });

  it('一群东西从共同的那一点摊开：脚挪到几倍远的地方，高低也照比例；自己再绕着脚放大', () => {
    const far = figureAt(500_000);
    const G: Vec3 = [60, 10, -50];
    const marks = plain('village', { group: G });
    const foot = figureMove(P, marks, far);
    expect(foot[0]).toBeCloseTo(60 + 40 * 1.5, 6);
    expect(foot[1]).toBeCloseTo(10 + 10 * 1.5, 6);
    expect(foot[2]).toBeCloseTo(-50, 6);
    const top = figureMove([100, 30, -50], marks, far);
    expect(top[1] - foot[1]).toBeCloseTo(10 * 2.5, 6);
    // 整组一样的倍数（草屋和它的篱笆）：就是一件小摆设整个放大
    const hutFoot: Vec3 = [0, 0, 0];
    const post = figureMove([33, 5, 7], { pivot: [32, 1, 7], group: hutFoot, fig: [slotOf('hut'), 0, 0, 0] }, far);
    const k = far.uFigTimes.value[slotOf('hut')];
    expect(post[0]).toBeCloseTo(33 * k, 6);
    expect(post[1]).toBeCloseTo(5 * k, 6);
    expect(post[2]).toBeCloseTo(7 * k, 6);
  });

  it('立在城墙上的：脚的高度跟着城墙一起拔高，自己绕着拔高以后的脚放大', () => {
    const far = figureAt(500_000);
    const wall = far.uFigTimes.value[slotOf('wallH')];
    expect(wall).toBeCloseTo(1.55, 4);
    const shed = plain('shed', { flags: FIG_ON_WALL });
    const foot = figureMove(P, shed, far);
    expect(foot).toEqual([100, 20 * wall, -50]);
    const k = far.uFigTimes.value[slotOf('shed')];
    const top = figureMove([100, 26, -50], shed, far);
    expect(top[1]).toBeCloseTo(20 * wall + 6 * k, 9);
    // 近处城墙不拔高，它也不动
    expect(figureMove([100, 26, -50], shed, figureAt(100))).toEqual([100, 26, -50]);
  });

  it('站在水会漫到的地方的：水高过脚，就绕着水面那一条线放大——水淹到它的几成，放大以后还是几成；水在脚下面时绕着脚', () => {
    const coords = frameCoords(fixtureScene().frame);
    const hut = plain('hut', { flags: FIG_WET });
    // 屋身从 20 到 29（9 高）。水面在 24.5：正好半截
    const levelM = 40 + 24.5 / 6;
    expect(coords.y(levelM)).toBeCloseTo(24.5, 9);
    for (const D of [1000, 4000, 9600, 25000, 120000]) {
      const u = figureAt(D, levelM);
      const k = u.uFigTimes.value[slotOf('hut')];
      const bottom = figureMove([100, 20, -50], hut, u)[1];
      const top = figureMove([100, 29, -50], hut, u)[1];
      expect(top - bottom).toBeCloseTo(9 * k, 6);
      expect((24.5 - bottom) / (top - bottom)).toBeCloseTo(0.5, 9);
      // 水面那一条线上的点不动
      expect(figureMove([100, 24.5, -50], hut, u)[1]).toBeCloseTo(24.5, 9);
    }
    // 平时的水位在它脚下面老远：绕着脚放大，脚不动
    const dry = figureAt(120000, FIXTURE_HEIGHTS.normal);
    expect(figureMove(P, hut, dry)).toEqual(P);
    // 不带这个开关的：脚不动，水淹到的那一截不跟着长
    const u = figureAt(120000, levelM);
    expect(figureMove(P, plain('hut'), u)).toEqual(P);
  });

  it('细处：远了先矮下去（平面不动），再收成一个点；收的时候法线不出坏数', () => {
    const [from, to] = testStyle.figure.detailFadeM;
    const merlon: FigureMarks = { pivot: P, group: P, fig: [0, 0, FIG_DETAIL, 0] };
    const corner: Vec3 = [105.5, 29, -47];
    // 还没开始收
    expect(figureMove(corner, merlon, figureAt(from))).toEqual(corner);
    // 收到一半：高剩一半，平面不动
    let half = from;
    for (let lo = from, hi = to, i = 0; i < 60; i++) {
      half = (lo + hi) / 2;
      if (detailGone(testStyle, half) < 0.5) lo = half;
      else hi = half;
    }
    const mid = figureMove(corner, merlon, figureAt(half));
    expect(mid[0]).toBeCloseTo(105.5, 6);
    expect(mid[2]).toBeCloseTo(-47, 6);
    expect(mid[1]).toBeCloseTo(20 + 9 * 0.5, 4);
    // 收完了：成了脚上的一个点
    const gone = figureMove(corner, merlon, figureAt(to));
    expect(gone[0]).toBeCloseTo(100, 9);
    expect(gone[1]).toBeCloseTo(20, 9);
    expect(gone[2]).toBeCloseTo(-50, 9);
    // 一路只往小里变，不来回
    let last = Infinity;
    for (let D = from * 0.9; D <= to * 1.1; D *= 1.01) {
      const at = figureMove(corner, merlon, figureAt(D));
      const size = Math.hypot(at[0] - 100, at[1] - 20, at[2] + 50);
      expect(size).toBeLessThanOrEqual(last + 1e-9);
      last = size;
    }
    // 跟着一样归了类的东西的细处（草屋的篱笆）：先收，再跟着那样东西放大
    const fence: FigureMarks = { pivot: P, group: [90, 20, -50], fig: [slotOf('hut'), 0, FIG_DETAIL, 0] };
    const u = figureAt(half);
    const k = u.uFigTimes.value[slotOf('hut')];
    const post = figureMove([100, 26, -50], fence, u);
    expect(post[0]).toBeCloseTo(90 + 10 * k, 6);
    expect(post[1]).toBeCloseTo(20 + 6 * 0.5 * k, 4);
  });

  it('留几成：次序在线以内的原样，线以外一小段里缩小，再往外没有；全留的时候一样也不缩', () => {
    const near = figureAt(1000);
    for (const rank of [0, 0.5, 0.86, 0.999]) expect(figureShow(plain('tree', { rank }).fig, near)).toBe(1);
    const far = figureAt(500_000);
    const keep = far.uFigKeep.value[slotOf('tree')];
    expect(keep).toBeCloseTo(0.335, 3);
    expect(figureShow(plain('tree', { rank: 0 }).fig, far)).toBe(1);
    expect(figureShow(plain('tree', { rank: keep - 0.001 }).fig, far)).toBe(1);
    const fringe = figureShow(plain('tree', { rank: keep * 1.08 }).fig, far);
    expect(fringe).toBeGreaterThan(0.2);
    expect(fringe).toBeLessThan(0.8);
    expect(figureShow(plain('tree', { rank: keep / KEEP_FRINGE }).fig, far)).toBe(0);
    expect(figureShow(plain('tree', { rank: 0.9 }).fig, far)).toBe(0);
    // 缩是朝着脚缩
    const moved = figureMove([110, 50, -44], plain('tree', { rank: 0.9 }), far);
    expect(moved).toEqual(P);
    // 船、石头这些“一样也不去掉”的：次序再靠后，再远也是原样
    for (const cls of ['boat', 'smallBoat', 'rock', 'hut', 'shed', 'pavilion', 'tower'] as const) expect(figureShow(plain(cls, { rank: 0.999 }).fig, far)).toBe(1);
    // 镜头一路退远，一样东西只会越来越小或者不变（次序 0.3 的一棵树：从原样到缩没，中间不跳）
    let last = 1;
    for (let D = 3000; D < 200000; D *= 1.01) {
      const show = figureShow(plain('tree', { rank: 0.36 }).fig, figureAt(D));
      expect(show).toBeLessThanOrEqual(last);
      expect(last - show).toBeLessThan(0.12);
      last = show;
    }
    expect(last).toBeGreaterThan(0);
    expect(last).toBeLessThan(1);
  });

  it('镜头一路退远，每样东西只往小里缩、不来回，也没有哪一步是跳的：放大的倍数、摊开的远近、留下的大小都是连着变的', { timeout: 30_000 }, () => {
    // 这一项在发布流程的机器上要比默认的 5 秒久（这台机器上 3 到 5 秒左右）：给它自己的时限，不把要走的步数减少。
    const thinning = ['cityHouse', 'village', 'tree'] as const;
    // 远近每次变 1%，从 800 米到 130 公里
    const steps: number[] = [];
    for (let D = 800; D <= 130_000; D *= 1.01) steps.push(D);
    const units = steps.map((D) => figureAt(D));
    let fastest = 0;
    for (const cls of Object.keys(FIGURE_SLOT) as FigureClass[]) {
      const slot = slotOf(cls);
      for (let i = 1; i < units.length; i++) {
        // 放大的倍数：远近变 1%，它最多变 1%（东西在画面上不会越退越大）
        const times = units[i].uFigTimes.value[slot] / units[i - 1].uFigTimes.value[slot];
        expect(times).toBeGreaterThanOrEqual(1 - 1e-6);
        expect(times).toBeLessThan(1.0101);
        const spread = units[i].uFigSpread.value[slot] / units[i - 1].uFigSpread.value[slot];
        expect(spread).toBeGreaterThanOrEqual(1 - 1e-6);
        expect(spread).toBeLessThan(1.0101);
      }
      for (let rank = 0; rank < 1; rank += 0.01) {
        let last = 1;
        for (const u of units) {
          const show = figureShow([slot, rank, 0, 0], u);
          expect(show).toBeLessThanOrEqual(last + 1e-6);
          fastest = Math.max(fastest, last - show);
          last = show;
        }
        // 不是“会去掉一些”的那三类，再远也是原样
        if (!(thinning as readonly string[]).includes(cls)) expect(last).toBe(1);
      }
    }
    // 去掉的那一下不是一步到位的：远近变 1%，一样东西最多缩掉两成（成片的民居缩得最快：退远 8% 上下，一座屋从原样缩到没有）
    expect(fastest).toBeGreaterThan(0.02);
    expect(fastest).toBeLessThan(0.2);
    // 细处、细做的树也是连着变的
    for (let i = 1; i < units.length; i++) {
      expect(Math.abs(units[i].uFigDetail.value.x - units[i - 1].uFigDetail.value.x)).toBeLessThan(0.06);
      expect(Math.abs(units[i].uFigDetail.value.y - units[i - 1].uFigDetail.value.y)).toBeLessThan(0.15);
      expect(Math.abs(units[i].uFigClose.value - units[i - 1].uFigClose.value)).toBeLessThan(0.06);
    }
  });

  it('成批摆的：算术是在实例自己的坐标里做的，摆出来和在沙盘的坐标里做是一样的', async () => {
    const { instanced } = await import('../../src/stage/three/kit/shapes');
    const THREE = await import('three');
    const shape = new THREE.BoxGeometry(2, 2, 2).toNonIndexed();
    const G: Vec3 = [400, 12, -300];
    const list = [
      { x: 430, y: 10, z: -280, ry: 0.7, s: 14, sy: 20, figure: { cls: 'hut' as const, rank: 0, kind: FIG_TREE, mark: 1e6, group: G } },
      { x: -50, y: -0.36, z: 90, ry: 2.1, s: 0.6, figure: { cls: 'smallBoat' as const, rank: 0.4, pivot: [0, 0.6, 0] as Vec3 } },
    ];
    const mesh = instanced(shape, new THREE.MeshBasicMaterial(), list);
    expect(mesh.count).toBe(2);
    expect(mesh.frustumCulled).toBe(false);
    for (const name of ['aPivot', 'aGroup', 'aFig']) expect((mesh.geometry.attributes[name] as { isInstancedBufferAttribute?: boolean }).isInstancedBufferAttribute).toBe(true);
    // 形状自己的数据是和别的网格共用的那一份
    expect(mesh.geometry.attributes.position).toBe(shape.attributes.position);
    const u = figureAt(500_000);
    const matrix = new THREE.Matrix4();
    const corner: Vec3 = [1, 1, -1];
    const world = (i: number, p: Vec3): Vec3 => {
      mesh.getMatrixAt(i, matrix);
      const v = new THREE.Vector3(...p).applyMatrix4(matrix);
      return [v.x, v.y, v.z];
    };
    // 跟着一组放大的树：从那一组的脚摊开 4.3 倍，自己大 4.3 倍
    const k = u.uFigTimes.value[slotOf('hut')];
    const was = world(0, corner);
    const now = world(0, figureMove(corner, instanceMarks(mesh, 0), u));
    for (let a = 0; a < 3; a++) expect(now[a]).toBeCloseTo(G[a] + (was[a] - G[a]) * k, 3);
    // 船：绕着船身正中吃水的那一点（水面上，y 是 0）放大
    const kb = u.uFigTimes.value[slotOf('smallBoat')];
    const boatWas = world(1, corner);
    const boatNow = world(1, figureMove(corner, instanceMarks(mesh, 1), u));
    const waterline: Vec3 = [-50, 0, 90];
    for (let a = 0; a < 3; a++) expect(boatNow[a]).toBeCloseTo(waterline[a] + (boatWas[a] - waterline[a]) * kb, 4);
    mesh.geometry.dispose();
    shape.dispose();
    mesh.dispose();
  });
});

// ---------------------------------------------------------------- 材质

describe('材质', () => {
  it('没有页面的时候不画贴图，颜色照样式', () => {
    const materials = makeMaterials(testStyle);
    expect(Object.keys(materials.named).sort()).toEqual([...MATERIAL_NAMES].sort());
    expect(materials.named.brick.map).toBeNull();
    expect(materials.named.rammed.color.getHexString()).toBe('bda27a');
    expect(materials.named.tile.vertexColors).toBe(true);
    expect(materials.treeColours.tree).toBe('#4a6e56');
    materials.dispose();
  });

  it('样式里少了一种颜色，说得出是哪一种', () => {
    const palette = { ...testStyle.palette };
    delete palette.rammedEarth;
    expect(() => makeMaterials({ ...testStyle, palette })).toThrow(/rammedEarth/);
  });

  it('沙盘程序里真的那一份样式，零件库要的颜色都有', () => {
    const materials = makeMaterials(songQinglv);
    expect(Object.keys(materials.named)).toHaveLength(MATERIAL_NAMES.length);
    materials.dispose();
    const models = buildModels({ ...makeCtx(everythingScene()), style: songQinglv });
    expect(models.apply(FIRST, FIXTURE_HEIGHTS.normal, 6000)).toBe(true);
    models.dispose();
  });
});

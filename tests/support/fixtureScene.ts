// 几组测试共用的一座小沙盘（假的，地名都是编的）。场景数据、地面、零件库、页面的测试都用它，
// 各处就不用各编一份。它本身符合 docs/data-spec.md 的规则 10 到 15。
//
// 每次调用都给一份新的，测试里尽管改；要别的情形（多一处修整、多一条题签），拿一份来改，不要改这个文件。
//
// 沙盘 3000 × 2400 米，原点 [117, 34]。下面的位置写的是沙盘里的米（x 向东，z 向南），也在 FIXTURE_M 里；
// 都取 20 米的整倍数，正好落在地面网格的格点上：
//   地形    8 × 8 的网格，每格 500 米，x、z 都从 −1700 到 1800。平地海拔 43 米；东边一座山，山顶在 (800, −200)，140 米。
//   城墙    wall：四边，x −600 到 −200，z −40 到 360。城里的地面是一处写了 inside 的修整（city-ground，41.2 米）。
//   城门    gate-south：南墙正中 (−400, 360)。门上的楼 gate-tower 从第二节“后来”才有。
//   河      river：从北到南，贴着东墙外面走（中线离东墙 100 米，画宽 120 米，比“离城墙至少 70 米”近，正好用来测这一条）。
//   壕      moat：西墙、南墙外 60 米，东头接到河里；南门外 (−400, 420) 有路跨过去。
//   地名点  hill：那座山。
//   点缀    homes：城里的民居。
//   远处    far-town：在西南 30 公里（往西 18 公里、往南 24 公里）。
//   题签    s-town（指城墙，有今名）、s-river（指河）、s-far（指远处）。
//   小节    “起初”（平时的水位）、“后来”（大水，水位 43 米，比城里的地面高）。
//   没有画的 inner-wall。
//   出处    f1、f2、f3（fixtureSources）。

import type { StopScene } from '../../src/domain/scene';
import type { LngLat, Source } from '../../src/domain/types';

/** 两个小节的标题，按先后。 */
export const FIXTURE_HEADINGS = ['起初', '后来'] as const;

/** 这座小沙盘上各样东西的位置，沙盘里的米（x 向东，z 向南）。 */
export const FIXTURE_M = {
  /** 沙盘的四边。 */
  frame: { x0: -1500, x1: 1500, z0: -1200, z1: 1200 },
  /** 地形网格的四边，和每格多大。 */
  dem: { x0: -1700, x1: 1800, z0: -1700, z1: 1800, cell: 500 },
  /** 城墙的四边。 */
  wall: { x0: -600, x1: -200, z0: -40, z1: 360 },
  /** 城的中心。 */
  city: [-400, 160],
  /** 南门。 */
  gate: [-400, 360],
  /** 山顶。 */
  hill: [800, -200],
  /** 河的中线和画的宽度。 */
  river: [
    [-100, -1400],
    [-100, 500],
    [60, 1400],
  ],
  riverWidth: 120,
  /** 壕的中线、画的宽度，和路跨过去的那一点。 */
  moat: [
    [-660, -40],
    [-660, 420],
    [-100, 420],
  ],
  moatWidth: 30,
  moatCrossing: [-400, 420],
  /** 远处：离原点正好 30 公里，方向 216.87 度（西南）。 */
  far: [-18000, 24000],
} as const;

/** 今天的平地、山顶的海拔，和整理以后的几个高度（米）。 */
export const FIXTURE_HEIGHTS = {
  /** 地形网格里平地的海拔。 */
  plainToday: 43,
  /** 地形网格里山顶的海拔。 */
  hillToday: 140,
  /** 平地整理以后在这个数上下（recipe.plainBaseM）。 */
  plainBase: 40,
  /** 城里的地面。 */
  city: 41.2,
  /** 平时的水位、大水的水位。 */
  normal: 37.6,
  flood: 43,
  /** 河岸最高到多少；河床比平时的水面低多少；河离城墙至少多远。 */
  bank: 39,
  bed: 3,
  keepOffWalls: 70,
} as const;

const CENTER: LngLat = [117, 34];
const M_PER_DEG_LAT = 110950;
const M_PER_DEG_LNG = 111320 * Math.cos((CENTER[1] * Math.PI) / 180);
const round7 = (v: number): number => Math.round(v * 1e7) / 1e7;

/** 沙盘里的米换成经纬度（和 src/domain/sceneGeo.ts 同一个算法，这里另写一遍，不借用被测的程序）。差不到 1 厘米。 */
export function fixturePoint(x: number, z: number): LngLat {
  return [round7(CENTER[0] + x / M_PER_DEG_LNG), round7(CENTER[1] - z / M_PER_DEG_LAT)];
}

const at = (p: readonly [number, number]): LngLat => fixturePoint(p[0], p[1]);

/** 这座小沙盘的出处（相当于 stops/<站>.json 里的 sources）。每次给一份新的。 */
export function fixtureSources(): Source[] {
  return [
    { id: 'f1', basis: 'own-words', cite: '某人《样城记》' },
    { id: 'f2', basis: 'record', cite: '《某史》卷一' },
    { id: 'f3', basis: 'later', cite: '今天的高程数据和地图（测试用的假数据）' },
  ];
}

/**
 * 地形网格：8 × 8 个数，单位分米，第 0 行最北，第 0 列最西，逐行存（和地形文件一样）。每次给一份新的。
 * 平地都是 43 米；山顶在第 3 行第 5 列，140 米；它上下左右四格 46 米。
 */
export function fixtureTerrain(): Int16Array {
  const cols = 8;
  const grid = new Int16Array(cols * cols).fill(FIXTURE_HEIGHTS.plainToday * 10);
  const peak = { col: 5, row: 3 };
  grid[peak.row * cols + peak.col] = FIXTURE_HEIGHTS.hillToday * 10;
  for (const [dc, dr] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    grid[(peak.row + dr) * cols + (peak.col + dc)] = 460;
  }
  return grid;
}

/** 同一张地形网格，写成地形文件里的字节：16 位整数，低位在前，一共 128 字节。 */
export function fixtureTerrainBytes(): ArrayBuffer {
  const grid = fixtureTerrain();
  const bytes = new ArrayBuffer(grid.length * 2);
  const view = new DataView(bytes);
  grid.forEach((v, i) => view.setInt16(i * 2, v, true));
  return bytes;
}

/** 这座小沙盘的场景。每次给一份新的。 */
export function fixtureScene(): StopScene {
  const m = FIXTURE_M;
  const [first, second] = FIXTURE_HEADINGS;
  const [west, north] = fixturePoint(m.dem.x0, m.dem.z0);
  const [east, south] = fixturePoint(m.dem.x1, m.dem.z1);

  return {
    stopId: 'sample-town',
    style: 'song-qinglv',
    credits: ['地形：测试用的假数据。'],
    frame: {
      center: [CENTER[0], CENTER[1]],
      westM: -m.frame.x0,
      eastM: m.frame.x1,
      northM: -m.frame.z0,
      southM: m.frame.z1,
      datumM: 40,
      relief: { kind: 'uniform', times: 6 },
    },
    terrain: {
      class: 'real',
      basis: '山的位置和形状照高程网格。',
      sourceIds: ['f3'],
      file: 'sample-town.terrain.bin',
      cols: 8,
      rows: 8,
      west,
      east,
      south,
      north,
      recipe: {
        class: 'schematic',
        basis: '平地压平，压到海拔 40 米上下；这个数是设计上定的。',
        sourceIds: [],
        note: '平地是修整过的，压平、压低是示意。',
        kind: 'plain-and-hills',
        plainBelowM: 47,
        hillAboveM: 60,
        plainBaseM: FIXTURE_HEIGHTS.plainBase,
        plainKeep: 0.1,
        edgeTaperM: 200,
      },
      edits: [
        {
          id: 'city-ground',
          name: '城里的地面',
          op: 'level',
          inside: 'wall',
          mode: 'set',
          toM: FIXTURE_HEIGHTS.city,
          featherM: 100,
          class: 'schematic',
          basis: '城里压成一块平地，比城外高多少是设计上定的。',
          sourceIds: [],
        },
      ],
    },
    water: {
      levels: {
        class: 'schematic',
        basis: '水位从模型上定，不照今天的高程算。',
        sourceIds: ['f1'],
        note: '水位是示意。',
        values: { normal: FIXTURE_HEIGHTS.normal, flood: FIXTURE_HEIGHTS.flood },
      },
      banks: {
        class: 'schematic',
        basis: '河两边的岸不高；这几个数是设计上定的。',
        sourceIds: [],
        bankM: FIXTURE_HEIGHTS.bank,
        bedM: FIXTURE_HEIGHTS.bed,
        keepOffWallsM: FIXTURE_HEIGHTS.keepOffWalls,
      },
      rivers: [
        {
          id: 'river',
          name: '样水',
          kind: 'river',
          line: m.river.map(at),
          drawWidthM: m.riverWidth,
          class: 'schematic',
          basis: '从北往南、贴着城东有记载；线位和宽窄没有依据。',
          sourceIds: ['f1'],
          note: '样水从北往南流过城东，河道走哪条线是示意。',
        },
        {
          id: 'moat',
          name: '城壕',
          kind: 'moat',
          line: m.moat.map(at),
          drawWidthM: m.moatWidth,
          crossings: [at(m.moatCrossing)],
          class: 'text',
          basis: '记里说城西、城南有壕。',
          sourceIds: ['f1'],
          unsure: '线位',
        },
      ],
      rapids: [],
      dry: [],
    },
    places: [
      {
        id: 'hill',
        name: '样山',
        at: at(m.hill),
        class: 'real',
        basis: '城东的山，位置照高程网格。',
        sourceIds: ['f3'],
      },
    ],
    things: [
      {
        id: 'wall',
        name: '城墙',
        kind: 'wall',
        line: [fixturePoint(m.wall.x0, m.wall.z0), fixturePoint(m.wall.x1, m.wall.z0), fixturePoint(m.wall.x1, m.wall.z1), fixturePoint(m.wall.x0, m.wall.z1)],
        params: { face: 'earth', parapet: true },
        class: 'schematic',
        basis: '城墙的位置和大小没有记载，是自己定的。',
        sourceIds: [],
        note: '城墙是示意：位置和大小都没有记载。',
      },
      {
        id: 'gate-south',
        name: '南门',
        kind: 'gate',
        at: at(m.gate),
        on: 'wall',
        params: { face: 'earth' },
        class: 'text',
        basis: '记里说南面有门。',
        sourceIds: ['f1'],
        unsure: '位置（在南墙的哪一点）',
      },
      {
        id: 'gate-tower',
        name: '南门上的楼',
        kind: 'tower',
        at: at(m.gate),
        on: 'gate-south',
        params: { storeys: 2, size: 'large', walls: 'plaster', timber: 'red' },
        when: { from: second },
        class: 'text',
        basis: '记里说后来在南门上盖了一座楼。',
        sourceIds: ['f1', 'f2'],
        unsure: '层数和高矮',
        note: '南门上的楼是按记载摆的；楼有几层、多高没有记载，样子是示意。',
      },
    ],
    dressing: [
      {
        id: 'homes',
        name: '城里的民居',
        kind: 'houses',
        inside: 'wall',
        params: { lanes: true, seed: 7 },
        class: 'dressing',
        basis: '只表示这是一座城。',
        sourceIds: [],
      },
    ],
    strips: [
      { id: 's-town', text: '样城', modern: '样市', of: 'wall', at: fixturePoint(m.city[0], m.wall.z0) },
      { id: 's-river', text: '样水', of: 'river', at: fixturePoint(m.river[0][0], -600) },
      { id: 's-far', text: '远镇', of: 'far-town' },
    ],
    far: [
      {
        id: 'far-town',
        name: '远镇',
        at: at(m.far),
        gloss: '今远镇',
        class: 'today',
        basis: '按今天远镇的位置算方向和距离。',
        sourceIds: ['f3'],
        note: '远镇在这块沙盘外面。',
      },
    ],
    sections: [
      {
        heading: first,
        date: '某年春',
        line: '城在河的西边，河从北往南流。',
        camera: { target: at(m.city), distanceM: 6000, pitch: 50, bearing: 0, mustShow: ['frame'] },
        water: 'normal',
        strips: ['s-town', 's-river'],
        explain: ['wall'],
      },
      {
        heading: second,
        date: '某年秋',
        line: '水涨到了城下，南门上添了一座楼。',
        camera: { target: fixturePoint(m.gate[0], m.gate[1] - 100), targetUpM: 5, distanceM: 2400, pitch: 60, bearing: 20, fov: 22, closest: 0.8 },
        water: 'flood',
        strips: ['s-town', 's-far'],
        explain: ['levels', 'gate-tower'],
      },
    ],
    notDrawn: [
      {
        id: 'inner-wall',
        name: '内城',
        why: '记载里有这道墙，在哪里没有查到，沙盘上没有画。',
        sourceIds: ['f2'],
      },
    ],
  };
}

// 一块手做的地面，给沙盘程序的测试用：不经过 src/stage/ground 的整理和挖河，所以零件库、镜头的测试
// 不用等地面那一边做好，也不会因为那一边改了算法而变。
//
// 它和 tests/support/fixtureScene.ts 那座小沙盘是同一块地方（位置都取自 FIXTURE_M），两样可以一起用：
//   平地    海拔 40 米，一马平川。
//   山      一座，山顶在 (800, −200)，比平地高 60 米，半径 450 米。
//   城      城墙里面 41.2 米，水漫不进去；一座城的平面（cities[0]）：南门一座，一条从南门到城中心的大街，两条东西向的小巷。
//   河和壕  按画的宽度直上直下挖到河床（34.6 米）；河离城墙不到 70 米的地方不挖。
//   村子    两个，在平地上。
//   路、田  没有。
// 每格 20 米，151 列、121 行。每次调用都给一份新的。

import type { Ground, GroundSamplers, Vec2 } from '../../../src/stage/ground/types';
import { FIXTURE_HEIGHTS, FIXTURE_M } from '../../support/fixtureScene';

const CELL = 20;
/** 山顶比平地高多少米，山脚离山顶多少米。 */
const HILL_UP = 60;
const HILL_RADIUS = 450;

const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 点到线段的距离。 */
function distSeg(px: number, pz: number, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const t = clamp(((px - a[0]) * dx + (pz - a[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(px - (a[0] + dx * t), pz - (a[1] + dz * t));
}

/** 点到一条折线的距离。 */
function distLine(px: number, pz: number, line: Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) best = Math.min(best, distSeg(px, pz, line[i], line[i + 1]));
  return best;
}

/** 把折线加密到大约 step 米一个点（直线上匀着加，不改形状）。 */
function subdivide(line: Vec2[], step: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  const last = line[line.length - 1];
  out.push([last[0], last[1]]);
  return out;
}

const copy = (line: readonly (readonly [number, number])[]): Vec2[] => line.map((p): Vec2 => [p[0], p[1]]);

/** 手做的地面。 */
export function flatGround(): Ground {
  const m = FIXTURE_M;
  const H = FIXTURE_HEIGHTS;
  const nx = Math.round((m.frame.x1 - m.frame.x0) / CELL) + 1;
  const nz = Math.round((m.frame.z1 - m.frame.z0) / CELL) + 1;
  const N = nx * nz;
  const river = copy(m.river);
  const moat = copy(m.moat);
  const W = m.wall;
  const bedM = H.normal - H.bed;

  const h = new Float32Array(N);
  const dry = new Uint8Array(N);
  const edge = new Float32Array(N);
  const bankHalf = new Float32Array(N);
  const hill = new Float32Array(N);

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = m.frame.x0 + i * CELL;
      const z = m.frame.z0 + j * CELL;

      // 离城墙那一圈线多远：城里是负数。
      const dx = Math.max(W.x0 - x, x - W.x1);
      const dz = Math.max(W.z0 - z, z - W.z1);
      const outside = dx > 0 && dz > 0 ? Math.hypot(dx, dz) : Math.max(dx, dz);

      // 离河岸多远：河里是负数。河离城墙不到 keepOffWalls 的地方算岸上；壕不受这一条管。
      const riverEdge = Math.max(distLine(x, z, river) - m.riverWidth / 2, H.keepOffWalls - outside);
      const moatEdge = distLine(x, z, moat) - m.moatWidth / 2;
      edge[k] = Math.min(riverEdge, moatEdge);
      bankHalf[k] = (moatEdge < riverEdge ? m.moatWidth : m.riverWidth) / 2;

      let v = H.plainBase + HILL_UP * (1 - smoothstep(0, HILL_RADIUS, Math.hypot(x - m.hill[0], z - m.hill[1])));
      if (outside <= 0) {
        v = H.city;
        dry[k] = 1;
      } else if (edge[k] < 0) {
        v = bedM;
      }
      h[k] = v;
      hill[k] = smoothstep(H.plainBase + 2.6, H.plainBase + 10, v) * smoothstep(60, 200, edge[k]);
    }
  }

  return {
    nx,
    nz,
    cell: CELL,
    x0: m.frame.x0,
    z0: m.frame.z0,
    h,
    waterH: new Float32Array(h),
    dry,
    edge,
    bankHalf,
    lift: new Float32Array(N),
    hill,
    hillSoft: new Float32Array(hill),
    curv: new Float32Array(N),
    rivers: { river: subdivide(river, 60), moat: subdivide(moat, 60) },
    villages: [
      { x: -1000, z: -700, n: 6, seed: 11 },
      { x: 600, z: 800, n: 7, seed: 12 },
    ],
    cities: [
      {
        wallId: 'wall',
        wall: [
          [W.x0, W.z0],
          [W.x1, W.z0],
          [W.x1, W.z1],
          [W.x0, W.z1],
        ],
        centre: [m.city[0], m.city[1]],
        groundM: H.city,
        gates: [{ id: 'gate-south', at: [m.gate[0], m.gate[1]], outward: [0, 1] }],
        streets: [
          [
            [m.gate[0], m.gate[1]],
            [m.city[0], m.city[1]],
          ],
        ],
        lanes: [
          [
            [W.x0 + 20, m.city[1] - 100],
            [W.x1 - 20, m.city[1] - 100],
          ],
          [
            [W.x0 + 20, m.city[1] + 100],
            [W.x1 - 20, m.city[1] + 100],
          ],
        ],
      },
    ],
    baseM: H.plainBase,
    reliefTimes: 6,
    roads: [],
    fields: [],
  };
}

/** 在手做的地面上任意一点取数（格子之间按远近匀开；出了沙盘取边上的值）。和 src/stage/ground 的 samplers 是同一个约定。 */
export function flatSamplers(ground: Ground): GroundSamplers {
  const { nx, nz, cell, x0, z0 } = ground;
  const bilinear = (field: Float32Array) => (x: number, z: number): number => {
    const fx = clamp((x - x0) / cell, 0, nx - 1.001);
    const fz = clamp((z - z0) / cell, 0, nz - 1.001);
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const ax = fx - ix;
    const az = fz - iz;
    const k = iz * nx + ix;
    return field[k] * (1 - ax) * (1 - az) + field[k + 1] * ax * (1 - az) + field[k + nx] * (1 - ax) * az + field[k + nx + 1] * ax * az;
  };
  return {
    height: bilinear(ground.h),
    waterH: bilinear(ground.waterH),
    edge: bilinear(ground.edge),
    lift: bilinear(ground.lift),
    hill: bilinear(ground.hill),
    hillSoft: bilinear(ground.hillSoft),
  };
}

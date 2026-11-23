// 点缀里和地面有关的三样：村子摆在哪，哪些路、哪些田要画在地面上。
// 都是登记在场景里的规则：场景里没有写，就没有。
// 路和田是画在地面上的，地面只画一次，所以这两样的 when 不起作用（哪一节都有）。

import type { StopScene } from '../../domain/scene';
import type { FrameCoords } from '../../domain/sceneGeo';
import { dressingParams } from '../../domain/sceneParams';
import type { WallRing } from './cityPlan';
import { asRing, ringSigned } from './lines';
import { lerp, mulberry32 } from './num';
import type { Ground, Vec2 } from './types';

/** 村子离沙盘的边至少这么远（样张的数）。沙盘小的时候按短边的四分之一算。 */
const VILLAGE_EDGE_M = 500;
/** 村子离河岸、离城墙至少这么远，彼此至少隔这么远（样张的数）。 */
const VILLAGE_OFF_BANK_M = 170;
const VILLAGE_OFF_WALL_M = 520;
const VILLAGE_APART_M = 1250;
/** 不写 count 时，大约每 6.7 平方公里一个村子（样张那块沙盘是 17 个）。 */
const KM2_PER_VILLAGE = 6.7;
/** 不写 seed 时用的种子（样张的数）。 */
const VILLAGE_SEED = 20771;

/** 整理好的地面上任意一点的几个数。 */
interface Lookups {
  height(x: number, z: number): number;
  edge(x: number, z: number): number;
  hillSoft(x: number, z: number): number;
}

/**
 * 平地上的村子：离河、离城、离山都有一段，彼此隔开。每条 villages 规则摆 count 个（地方不够时摆不满）。
 * 规则写了 area 的，只摆在那一块里。
 */
export function pickVillages(scene: StopScene, coords: FrameCoords, at: Lookups, walls: WallRing[]): Ground['villages'] {
  const out: Ground['villages'] = [];
  const base = scene.terrain.recipe.plainBaseM;
  const width = coords.x1 - coords.x0;
  const depth = coords.z1 - coords.z0;
  const margin = Math.min(VILLAGE_EDGE_M, Math.min(width, depth) / 4);

  for (const rule of scene.dressing) {
    if (rule.kind !== 'villages') continue;
    const p = dressingParams('villages', rule.params);
    const count = p.count ?? Math.max(1, Math.round((width * depth) / 1e6 / KM2_PER_VILLAGE));
    const rnd = mulberry32(p.seed ?? VILLAGE_SEED);
    const area = rule.area ? asRing(rule.area.map((p): Vec2 => coords.toLocal(p))) : null;
    const limit = Math.max(6000, count * 400);
    let placed = 0;
    let guard = 0;
    while (placed < count && guard++ < limit) {
      const x = lerp(coords.x0 + margin, coords.x1 - margin, rnd());
      const z = lerp(coords.z0 + margin, coords.z1 - margin, rnd());
      const h = at.height(x, z);
      if (h > base + 1.4 || h < base - 1.8) continue;
      if (at.edge(x, z) < VILLAGE_OFF_BANK_M) continue;
      if (at.hillSoft(x, z) > 0.12) continue;
      if (area && ringSigned(x, z, area) > 0) continue;
      if (walls.some((w) => ringSigned(x, z, w.ring) < VILLAGE_OFF_WALL_M)) continue;
      if (out.some((v) => Math.hypot(v.x - x, v.z - z) < VILLAGE_APART_M)) continue;
      out.push({ x, z, n: 5 + Math.floor(rnd() * 5), seed: Math.floor(rnd() * 1e6) });
      placed++;
    }
  }
  return out;
}

/** 要画在地面上的路：点缀里写了 line 的 roads。不写 type 的算城外的路。 */
export function paintedRoads(scene: StopScene, coords: FrameCoords): Ground['roads'] {
  const out: Ground['roads'] = [];
  for (const rule of scene.dressing) {
    if (rule.kind !== 'roads' || !rule.line || rule.line.length < 2) continue;
    out.push({ type: dressingParams('roads', rule.params).type === 'street' ? 'street' : 'road', line: rule.line.map((p): Vec2 => coords.toLocal(p)) });
  }
  return out;
}

/** 要画在地面上的田：点缀里的 fields。不写 area 的是整块沙盘的平地；不写 seed 的用 0（和样张一样的田块）。 */
export function paintedFields(scene: StopScene, coords: FrameCoords): Ground['fields'] {
  const out: Ground['fields'] = [];
  for (const rule of scene.dressing) {
    if (rule.kind !== 'fields') continue;
    const p = dressingParams('fields', rule.params);
    const field: Ground['fields'][number] = { area: rule.area ? asRing(rule.area.map((q): Vec2 => coords.toLocal(q))) : null, seed: p.seed ?? 0 };
    // 青苗只认写了 area 的；不写 green 的田和原来一样，连字段都不多
    if (p.green && field.area) field.green = true;
    out.push(field);
  }
  return out;
}

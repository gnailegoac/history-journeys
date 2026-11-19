// 场景验收（一）：每一座真的站点沙盘，地面算出来对不对。在 Node 里跑，只算地面（buildFields），不上色，不要浏览器。
// content/ 里有几座沙盘就查几座；以后添了黄州，这里自己会把它也查一遍。
//
// 查七样（都是摆上沙盘以后读者一眼看得出错的事）：
//   1 闭合的城墙里面，哪个水位都没有水；
//   2 写在 water.dry 里的地方，水位高过平时就没有水；
//   3 每条河、每道壕，平时沿着中线都有水（路和堤跨过去的地方除外）；
//   4 河不在垄上流：城墙以外，河岸不比旁边的平地高出 0.3 米，平时的水面在两岸以下；
//   5 不靠城墙的堤，堤顶比最高的水位高；
//   6 城里的大街不从院落（官署、寺）的围墙里穿过去；
//   7 修整垫高的地面不算山（上色、种树时和平地一样）。
// “有没有水”的规矩见 support/realScenes.ts 的 wetCell，和画水的着色器是同一条。

import { describe, expect, it } from 'vitest';
import { yardLayout } from '../../src/stage/ground';
import { ringSigned } from '../../src/stage/ground/lines';
import type { Vec2 } from '../../src/stage/ground/types';
import { cellAt, localRing, realScene, realSceneKeys, wetCell } from './support/realScenes';
import type { RealScene } from './support/realScenes';

/** 压在线上的格子算哪一边说不准，查的时候离线留出这么多米。 */
const LINE_MARGIN_M = 1;
/** 跨过河、壕的地方留出一个圆不挖（半径是河宽的一半加 25 米）；再加一格（20 米）才是完全挖到的地方。 */
const CROSSING_CLEAR_M = 45;
/** 河岸：从水边往外 20 到 60 米这一段里最高的地面（水边 18 米以内是斜坡，不算）。 */
const BANK_FROM_M = 20;
const BANK_TO_M = 60;
/** 旁边的平地：从水边往外 250 到 350 米这一段地面的平均。 */
const PLAIN_FROM_M = 250;
const PLAIN_TO_M = 350;
/** 河岸最多比旁边的平地高这么多米。 */
const BANK_OVER_PLAIN_M = 0.3;
/** 离城墙的线不到这么多米的地方算“城墙边”，河岸那一条不查这里（城外垫高的地面、河离城墙留的空都在这里面）。 */
const WALL_REACH_M = 300;
/** 不靠城墙的堤没有写堤顶时，零件库按堤线上最高的地面加这么多米造（src/stage/three/kit/things.ts）。 */
const DIKE_DEFAULT_ABOVE_M = 4;

const keys = realSceneKeys();

it('content/ 里至少有一座站点沙盘', () => {
  expect(keys.length).toBeGreaterThan(0);
});

function wallRings(R: RealScene): { id: string; ring: Vec2[] }[] {
  return R.scene.things.filter((t) => t.kind === 'wall' && t.line && t.line.length >= 3).map((t) => ({ id: t.id, ring: localRing(t.line ?? [], R.coords) }));
}

/** 一圈线里面（离线至少 LINE_MARGIN_M）的格子。 */
function cellsInside(R: RealScene, ring: Vec2[]): number[] {
  const { ground } = R;
  const out: number[] = [];
  for (let k = 0; k < ground.nx * ground.nz; k++) {
    const [x, z] = cellAt(ground, k);
    if (ringSigned(x, z, ring) < -LINE_MARGIN_M) out.push(k);
  }
  return out;
}

interface BankReading {
  river: string;
  /** 中线上的哪一点，哪一边（1 是顺着线走时的右手边，−1 是左手边）。 */
  x: number;
  z: number;
  side: number;
  /** 河岸最高、最低处的海拔，旁边平地的平均海拔。 */
  bankHigh: number;
  bankLow: number;
  plain: number;
}

/** 沿一条河的中线，一个点一个点、两边各量一次河岸和旁边的平地。量不了的地方（靠城墙、出了沙盘、旁边又是一条河）不量。 */
function bankReadings(R: RealScene, riverId: string, drawWidthM: number): BankReading[] {
  const { coords, ground, samplers } = R;
  const walls = wallRings(R);
  const inFrame = (x: number, z: number): boolean => x >= coords.x0 && x <= coords.x1 && z >= coords.z0 && z <= coords.z1;
  const usable = (x: number, z: number): boolean => inFrame(x, z) && !walls.some((w) => ringSigned(x, z, w.ring) < WALL_REACH_M);
  const line = ground.rivers[riverId] ?? [];
  const out: BankReading[] = [];
  for (let i = 1; i < line.length - 1; i++) {
    const [x, z] = line[i];
    if (!inFrame(x, z)) continue;
    const tx = line[i + 1][0] - line[i - 1][0];
    const tz = line[i + 1][1] - line[i - 1][1];
    const tl = Math.hypot(tx, tz);
    if (tl === 0) continue;
    for (const side of [1, -1]) {
      const nx = (-tz / tl) * side;
      const nz = (tx / tl) * side;
      // 从中线往外走，走到水边
      let shore = -1;
      for (let d = 0; d <= drawWidthM / 2 + 250; d += 5) {
        if (samplers.edge(x + nx * d, z + nz * d) > 0) {
          shore = d;
          break;
        }
      }
      if (shore < 0) continue;
      let ok = true;
      let bankHigh = -Infinity;
      let bankLow = Infinity;
      for (let d = shore + BANK_FROM_M; d <= shore + BANK_TO_M; d += 10) {
        const px = x + nx * d;
        const pz = z + nz * d;
        // 又进了水（另一条河，或者这条河拐回来了）：这一边量不了
        if (!usable(px, pz) || samplers.edge(px, pz) <= 0) ok = false;
        const h = samplers.height(px, pz);
        bankHigh = Math.max(bankHigh, h);
        bankLow = Math.min(bankLow, h);
      }
      let sum = 0;
      let n = 0;
      for (let d = shore + PLAIN_FROM_M; d <= shore + PLAIN_TO_M; d += 10) {
        const px = x + nx * d;
        const pz = z + nz * d;
        if (!usable(px, pz) || samplers.edge(px, pz) <= BANK_FROM_M) ok = false;
        sum += samplers.height(px, pz);
        n++;
      }
      if (ok) out.push({ river: riverId, x, z, side, bankHigh, bankLow, plain: sum / n });
    }
  }
  return out;
}

describe.each(keys)('%s 的地面', (key) => {
  it('闭合的城墙里面，哪个水位都没有水', () => {
    const R = realScene(key);
    const levels = R.scene.water.levels.values;
    for (const { id, ring } of wallRings(R)) {
      const cells = cellsInside(R, ring);
      expect(cells.length, `城墙 ${id} 里面一格也没有`).toBeGreaterThan(0);
      for (const [name, level] of Object.entries(levels)) {
        const wet = cells.filter((k) => wetCell(R.ground, k, level, levels.normal));
        expect(wet.length, `城墙 ${id} 里面在水位 ${name}（${level} 米）时有 ${wet.length} 格有水`).toBe(0);
      }
    }
  });

  it('写在 water.dry 里的地方，水位高过平时就没有水', () => {
    const R = realScene(key);
    const levels = R.scene.water.levels.values;
    for (const area of R.scene.water.dry) {
      const cells = cellsInside(R, localRing(area.area, R.coords));
      expect(cells.length, `${area.name}（${area.id}）里面一格也没有`).toBeGreaterThan(0);
      for (const [name, level] of Object.entries(levels)) {
        if (!(level > levels.normal)) continue;
        const wet = cells.filter((k) => wetCell(R.ground, k, level, levels.normal));
        expect(wet.length, `${area.name}（${area.id}）在水位 ${name}（${level} 米）时有 ${wet.length} 格有水`).toBe(0);
      }
    }
  });

  it('每条河、每道壕，平时沿着中线都有水（跨过去的地方除外）', () => {
    const R = realScene(key);
    const { coords, ground, samplers, scene } = R;
    const normal = scene.water.levels.values.normal;
    for (const river of scene.water.rivers) {
      const crossings = (river.crossings ?? []).map((p): Vec2 => coords.toLocal(p));
      const clear = river.drawWidthM / 2 + CROSSING_CLEAR_M;
      // 用程序真的挖的那条中线（河顺过，壕照写的走）；出了沙盘的不看
      const points = (ground.rivers[river.id] ?? []).filter(
        ([x, z]) => x >= coords.x0 && x <= coords.x1 && z >= coords.z0 && z <= coords.z1 && !crossings.some(([cx, cz]) => Math.hypot(x - cx, z - cz) < clear),
      );
      expect(points.length, `${river.name}（${river.id}）在沙盘里面没有可查的点`).toBeGreaterThan(1);
      const dry = points.filter(([x, z]) => !(samplers.waterH(x, z) < normal)).map(([x, z]) => `(${x.toFixed(0)}, ${z.toFixed(0)}) 地面 ${samplers.waterH(x, z).toFixed(2)} 米`);
      expect(dry, `${river.name}（${river.id}）的中线上有 ${dry.length} 处平时没有水`).toEqual([]);
    }
  });

  it('河不在垄上流：城墙以外，河岸不比旁边的平地高出 0.3 米，平时的水面在两岸以下', () => {
    const R = realScene(key);
    const normal = R.scene.water.levels.values.normal;
    for (const river of R.scene.water.rivers) {
      if (river.kind !== 'river') continue;
      const readings = bankReadings(R, river.id, river.drawWidthM);
      expect(readings.length, `${river.name}（${river.id}）没有一处量得了河岸`).toBeGreaterThan(0);
      const say = (r: BankReading): string =>
        `(${r.x.toFixed(0)}, ${r.z.toFixed(0)}) ${r.side > 0 ? '右' : '左'}岸 ${r.bankHigh.toFixed(2)} 米，平地 ${r.plain.toFixed(2)} 米`;
      const ridged = readings.filter((r) => r.bankHigh > r.plain + BANK_OVER_PLAIN_M).map(say);
      expect(ridged, `${river.name}（${river.id}）有 ${ridged.length} 处河岸比旁边的平地高出 ${BANK_OVER_PLAIN_M} 米以上`).toEqual([]);
      const drowned = readings.filter((r) => !(r.bankLow > normal)).map(say);
      expect(drowned, `${river.name}（${river.id}）有 ${drowned.length} 处河岸不比平时的水面（${normal} 米）高`).toEqual([]);
    }
  });

  it('不靠城墙的堤，堤顶比最高的水位高', () => {
    const R = realScene(key);
    const { coords, samplers, scene } = R;
    const highest = Math.max(...Object.values(scene.water.levels.values));
    for (const thing of scene.things) {
      if (thing.kind !== 'dike' || thing.on !== undefined || !thing.line) continue;
      const written = thing.params?.topM;
      const onLine = thing.line.map((p) => samplers.height(...coords.toLocal(p)));
      const top = typeof written === 'number' ? written : Math.max(...onLine) + DIKE_DEFAULT_ABOVE_M;
      expect(top, `${thing.name}（${thing.id}）的堤顶 ${top} 米不比最高的水位 ${highest} 米高`).toBeGreaterThan(highest);
    }
  });

  it('城里的大街不从院落的围墙里穿过去', () => {
    const R = realScene(key);
    const { coords, scene, ground } = R;
    for (const city of ground.cities) {
      for (const thing of scene.things) {
        if (thing.kind !== 'hall-group' || !thing.at) continue;
        const [cx, cz] = coords.toLocal(thing.at);
        if (ringSigned(cx, cz, city.wall) >= 0) continue;
        const halls = typeof thing.params?.halls === 'number' ? thing.params.halls : 2;
        const yard = yardLayout(halls);
        // 院落正面朝哪边（不写是朝南），沙盘上南是 +z
        const f = ((thing.facing ?? 180) * Math.PI) / 180;
        const front: Vec2 = [Math.sin(f), -Math.cos(f)];
        const inside: string[] = [];
        for (const street of city.streets) {
          for (let i = 0; i < street.length - 1; i++) {
            const [ax, az] = street[i];
            const [bx, bz] = street[i + 1];
            const steps = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 5));
            for (let s = 0; s <= steps; s++) {
              const x = ax + ((bx - ax) * s) / steps - cx;
              const z = az + ((bz - az) * s) / steps - cz;
              const along = x * front[0] + z * front[1];
              const across = Math.abs(x * front[1] - z * front[0]);
              // 街画出来十几米宽：离围墙不到 10 米也算压上了
              if (across < yard.halfWidth + 10 && along > yard.back - 10 && along < yard.front + 10) inside.push(`(${(x + cx).toFixed(0)}, ${(z + cz).toFixed(0)})`);
            }
          }
        }
        expect(inside.slice(0, 10), `大街有 ${inside.length} 处压在${thing.name}（${thing.id}）的院子里`).toEqual([]);
      }
    }
  });

  it('修整垫高的地面不算山：比平地高出一截，可是“哪里算山”那张图上是 0', () => {
    const R = realScene(key);
    const { coords, scene, ground } = R;
    const base = scene.terrain.recipe.plainBaseM;
    for (const edit of scene.terrain.edits) {
      if (edit.op !== 'level' || edit.mode !== 'raise' || !edit.area) continue;
      const ring = localRing(edit.area, coords);
      const mounds = scene.terrain.edits.flatMap((e) => (e.op === 'mound' ? [{ at: coords.toLocal(e.at), reach: e.outerM }] : []));
      let cells = 0;
      let hills = 0;
      for (let k = 0; k < ground.nx * ground.nz; k++) {
        const [x, z] = cellAt(ground, k);
        // 垫高的那一块里面，离边 20 米以上；垫出来的土丘够得着的地方不算（土丘是要像山的）
        if (ringSigned(x, z, ring) > -20 || mounds.some((m) => Math.hypot(x - m.at[0], z - m.at[1]) < m.reach)) continue;
        // 垫到的高度要是不比平地高出 2.6 米，本来就不算山，查不出什么
        if (edit.toM < base + 2.6 || ground.h[k] < edit.toM - 0.01) continue;
        cells++;
        expect(ground.lift[k]).toBeGreaterThan(0);
        if (ground.hill[k] > 0) hills++;
      }
      if (edit.toM >= base + 2.6) expect(cells, `${edit.name}（${edit.id}）里没有找到垫高的格子`).toBeGreaterThan(5);
      expect(hills, `${edit.name}（${edit.id}）垫高的地面有 ${hills} 格被算成了山`).toBe(0);
    }
  });
});

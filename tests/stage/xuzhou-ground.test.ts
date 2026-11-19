// 场景验收（二）：徐州这座沙盘的地面，照考证记录和正文该有的样子查一遍。
// 在 Node 里跑，只算地面，不要浏览器。各座沙盘都要查的那几样在 scene-ground.test.ts 里，这里只查徐州自己的：
//   大水时城西、城北、城东的平地至少八成有水；城南堤里面的那块地是干的，四周挡得住；
//   “水来了”那一节（堤还没有筑）水只是刚漫出河岸：城南那块地靠自己的地面就是干的，边上没有水，城外的山脚也比大水时露得多；
//   水到云龙山的西山脚；平时今天云龙湖那一片是干的；
//   张山人的草屋比大水的水面低半米到一米半（水到门扇的一半），在放鹤亭西边、比它低；放鹤亭在水面以上；
//   抹掉的故黄河高地没有一处比旁边的平地高出半米；
//   东南角的木岸立在墙脚土坡的水边上，在城角以北。
// 这里的数（水位、修整的范围、草屋的位置）调过以后要重新跑；改了定下来的做法，场景文件里的依据和
// docs/research/xuzhou-scene.md 第九节要跟着改。

import { describe, expect, it } from 'vitest';
import type { LevelEdit } from '../../src/domain/scene';
import { existsAt } from '../../src/domain/sceneText';
import { distLine, ringSigned } from '../../src/stage/ground/lines';
import type { Vec2 } from '../../src/stage/ground/types';
import { FULL_QUALITY } from '../../src/stage/three/host';
import { Batch } from '../../src/stage/three/kit/geo';
import type { Pass } from '../../src/stage/three/kit/pass';
import { surveyWalls } from '../../src/stage/three/kit/site';
import { bankSurfaceY } from '../../src/stage/three/kit/things';
import { styleFor } from '../../src/stage/three/style';
import { cellAt, localRing, realScene, wetCell } from './support/realScenes';

const KEY = 'su-shi/xuzhou';

/** “城外的平地”看到离城墙多远。 */
const NEAR_CITY_M = 3000;
/** 城墙、堤的模型盖得住离它的线这么多米以内的地面。 */
const COVERED_BY_MODEL_M = 30;

function thingAt(id: string): Vec2 {
  const R = realScene(KEY);
  const item = R.scene.things.find((t) => t.id === id) ?? R.scene.places.find((p) => p.id === id);
  if (!item?.at) throw new Error(`场景里没有 ${id}，或者它没有写 at`);
  return R.coords.toLocal(item.at);
}

function levelEdit(id: string): LevelEdit & { area: [number, number][] } {
  const edit = realScene(KEY).scene.terrain.edits.find((e) => e.id === id);
  if (!edit || edit.op !== 'level' || !edit.area) throw new Error(`场景里没有 ${id} 这处修整，或者它没有写 area`);
  return { ...edit, area: edit.area };
}

function wallRing(): Vec2[] {
  const R = realScene(KEY);
  const wall = R.scene.things.find((t) => t.id === 'wall');
  if (!wall?.line) throw new Error('场景里没有城墙');
  return localRing(wall.line, R.coords);
}

describe('徐州的地面', () => {
  it('三个水位是：平时低于城里的地面，大水高过城里的地面；“水来了”那一节刚漫出河岸，还不到城里的地面', () => {
    const R = realScene(KEY);
    const { normal, rising, flood } = R.scene.water.levels.values;
    const city = R.ground.cities[0].groundM;
    expect(normal).toBeLessThan(rising);
    expect(rising).toBeLessThan(flood);
    expect(normal).toBeLessThan(city);
    expect(flood).toBeGreaterThan(city);
    // 河岸最高压到 bankM：水位比它高，河水才漫得出来；比城里的地面低，城才明明白白地站在水上面
    expect(rising).toBeGreaterThan(R.scene.water.banks.bankM);
    expect(rising).toBeLessThan(city - 1);
  });

  it('“水来了”那一节和大水明显不一样：城外的平地有水的不到八成，城西、城北各有四成以上；水到了北墙、东墙的墙脚', () => {
    const R = realScene(KEY);
    const { ground, scene, samplers } = R;
    const { normal, rising, flood } = scene.water.levels.values;
    const wall = wallRing();
    const [cx, cz] = ground.cities[0].centre;
    const count: Record<'west' | 'north' | 'east', { rising: number; flood: number; all: number }> = {
      west: { rising: 0, flood: 0, all: 0 },
      north: { rising: 0, flood: 0, all: 0 },
      east: { rising: 0, flood: 0, all: 0 },
    };
    for (let k = 0; k < ground.nx * ground.nz; k++) {
      const [x, z] = cellAt(ground, k);
      const out = ringSigned(x, z, wall);
      if (out <= 0 || out > NEAR_CITY_M || ground.hill[k] >= 0.5) continue;
      const dx = x - cx;
      const dz = z - cz;
      const side = Math.abs(dx) > Math.abs(dz) ? (dx < 0 ? 'west' : 'east') : dz < 0 ? 'north' : null;
      if (!side) continue;
      count[side].all++;
      if (wetCell(ground, k, rising, normal)) count[side].rising++;
      if (wetCell(ground, k, flood, normal)) count[side].flood++;
    }
    for (const [side, c] of Object.entries(count)) {
      const share = c.rising / c.all;
      // 有水，但露着的地比大水时多得多（山脚露得宽）
      expect(share, `${side} 一面“水来了”时 ${(100 * share).toFixed(1)}% 有水`).toBeGreaterThan(0.3);
      expect(share, `${side} 一面“水来了”时 ${(100 * share).toFixed(1)}% 有水，和大水分不出来`).toBeLessThan(0.8);
      expect(c.flood - c.rising, `${side} 一面“水来了”时露着、大水时淹了的地太少`).toBeGreaterThan(c.all * 0.15);
    }
    expect(count.west.rising / count.west.all).toBeGreaterThan(0.4);
    expect(count.north.rising / count.north.all).toBeGreaterThan(0.4);
    // 北墙、东墙外面 110 米（土坡的坡脚外面）是水；西墙、南墙外面 110 米是干的
    const [x0, z0] = wall[0];
    const [x1, z1] = wall[2];
    expect(samplers.waterH(cx, z0 - 110)).toBeLessThan(rising);
    expect(samplers.waterH(x1 + 110, cz)).toBeLessThan(rising);
    expect(samplers.waterH(x0 - 130, cz + 300)).toBeGreaterThan(rising);
    expect(samplers.waterH(cx + 200, z1 + 130)).toBeGreaterThan(rising);
  });

  it('大水时，城西、城北、城东的平地至少八成有水', () => {
    const R = realScene(KEY);
    const { ground, scene } = R;
    const { normal, flood } = scene.water.levels.values;
    const wall = wallRing();
    const [cx, cz] = ground.cities[0].centre;
    const count: Record<'west' | 'north' | 'east', { wet: number; all: number }> = {
      west: { wet: 0, all: 0 },
      north: { wet: 0, all: 0 },
      east: { wet: 0, all: 0 },
    };
    for (let k = 0; k < ground.nx * ground.nz; k++) {
      const [x, z] = cellAt(ground, k);
      const out = ringSigned(x, z, wall);
      // 城外三公里以内、不算山的格子（hill 不到一半：平地和山脚刚起坡的地方）
      if (out <= 0 || out > NEAR_CITY_M || ground.hill[k] >= 0.5) continue;
      const dx = x - cx;
      const dz = z - cz;
      // 从城的中心看，这一格在哪一面
      const side = Math.abs(dx) > Math.abs(dz) ? (dx < 0 ? 'west' : 'east') : dz < 0 ? 'north' : null;
      if (!side) continue;
      count[side].all++;
      if (wetCell(ground, k, flood, normal)) count[side].wet++;
    }
    for (const [side, { wet, all }] of Object.entries(count)) {
      expect(all, `${side} 一面没有平地的格子`).toBeGreaterThan(1000);
      expect(wet / all, `${side} 一面的平地只有 ${((100 * wet) / all).toFixed(1)}% 有水`).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('城南堤里面的那块地，水位高过平时也是干的', () => {
    const R = realScene(KEY);
    const { ground, scene, coords } = R;
    const levels = scene.water.levels.values;
    const pocket = scene.water.dry.find((d) => d.id === 'south-pocket');
    expect(pocket, '场景里没有 south-pocket').toBeDefined();
    if (!pocket) return;
    const ring = localRing(pocket.area, coords);
    let cells = 0;
    for (let k = 0; k < ground.nx * ground.nz; k++) {
      const [x, z] = cellAt(ground, k);
      if (ringSigned(x, z, ring) > 0) continue;
      cells++;
      for (const name of ['rising', 'flood']) expect(wetCell(ground, k, levels[name], levels.normal), `(${x}, ${z}) 在水位 ${name} 时有水`).toBe(false);
    }
    expect(cells).toBeGreaterThan(100);
  });

  it('大水时，城南那块干地四周挡得住：不是城墙、东南的堤，就是比水面高的地', () => {
    const R = realScene(KEY);
    const { scene, coords, samplers, headings } = R;
    const flood = scene.water.levels.values.flood;
    const pocket = scene.water.dry.find((d) => d.id === 'south-pocket');
    const dike = scene.things.find((t) => t.id === 'dike-se');
    expect(pocket && dike?.line, '场景里没有 south-pocket 或者 dike-se').toBeTruthy();
    if (!pocket || !dike?.line) return;

    // 用大水水位的小节里，堤都已经筑起来了
    const floodSections = scene.sections.filter((s) => s.water === 'flood').map((s) => s.heading);
    expect(floodSections.length).toBeGreaterThan(0);
    for (const heading of floodSections) expect(existsAt(dike.when, heading, headings), `${heading} 用的是大水的水位，东南的堤却还没有`).toBe(true);
    const topM = dike.params?.topM;
    expect(typeof topM === 'number' && topM > flood, '东南的堤顶不比大水的水面高').toBe(true);

    const ring = localRing(pocket.area, coords);
    const wall = wallRing();
    const dikeLine = dike.line.map((p): Vec2 => coords.toLocal(p));
    const open: string[] = [];
    let checked = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const steps = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 10));
      for (let s = 0; s <= steps; s++) {
        const x = a[0] + ((b[0] - a[0]) * s) / steps;
        const z = a[1] + ((b[1] - a[1]) * s) / steps;
        // 压在城墙、堤底下的那几段，模型挡着，不看地面
        if (Math.abs(ringSigned(x, z, wall)) < COVERED_BY_MODEL_M || distLine(x, z, dikeLine) < COVERED_BY_MODEL_M) continue;
        checked++;
        const h = samplers.height(x, z);
        if (!(h > flood)) open.push(`(${x.toFixed(0)}, ${z.toFixed(0)}) 地面 ${h.toFixed(2)} 米`);
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(open, `干地的边上有 ${open.length} 处不比大水的水面（${flood} 米）高，水边会齐齐地断在那里`).toEqual([]);
  });

  // 水来了（水位 rising）那一节东南的堤还没有筑。负责人定的办法：把 rising 降到以后筑堤的那条线上的地面以下，
  // 城南这块地靠自己的地面就是干的，不靠“水漫不进去”那张标记；不然沙盘上会看到一道齐齐的斜水边，却没有堤。
  it('水来了那一节（堤还没有筑），城南那块干地的边上没有哪一段挨着水：除了城墙底下，一圈的地面都比水面高', () => {
    const R = realScene(KEY);
    const { scene, coords, samplers, ground, headings } = R;
    const { normal, rising } = scene.water.levels.values;
    const pocket = scene.water.dry.find((d) => d.id === 'south-pocket');
    const dike = scene.things.find((t) => t.id === 'dike-se');
    expect(pocket && dike?.line, '场景里没有 south-pocket 或者 dike-se').toBeTruthy();
    if (!pocket || !dike?.line) return;

    // 用这个水位的小节里，堤都还没有筑：不能指望堤的模型挡着
    const risingSections = scene.sections.filter((s) => s.water === 'rising').map((s) => s.heading);
    expect(risingSections.length).toBeGreaterThan(0);
    for (const heading of risingSections) expect(existsAt(dike.when, heading, headings), `${heading} 里已经有东南的堤了，这条测试要改`).toBe(false);

    const ring = localRing(pocket.area, coords);
    const wall = wallRing();
    const low: string[] = [];
    let checked = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const steps = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 10));
      for (let s = 0; s <= steps; s++) {
        const x = a[0] + ((b[0] - a[0]) * s) / steps;
        const z = a[1] + ((b[1] - a[1]) * s) / steps;
        // 压在城墙底下的那一段，城墙的模型挡着，不看地面
        if (Math.abs(ringSigned(x, z, wall)) < COVERED_BY_MODEL_M) continue;
        checked++;
        const h = samplers.waterH(x, z);
        if (!(h > rising + 0.3)) low.push(`(${x.toFixed(0)}, ${z.toFixed(0)}) 地面 ${h.toFixed(2)} 米`);
      }
    }
    expect(checked).toBeGreaterThan(60);
    expect(low, `干地的边上有 ${low.length} 处不比“水来了”的水面（${rising} 米）高出 0.3 米，水边会齐齐地断在那里`).toEqual([]);

    // 这块地里面不靠标记也是干的：除了壕和它两边的岸坡（壕里本来就有水，两头被跨过去的路和高地隔开，水位不跟着外面涨），
    // 没有一格比水面低
    let inside = 0;
    const wet: string[] = [];
    for (let k = 0; k < ground.nx * ground.nz; k++) {
      const [x, z] = cellAt(ground, k);
      if (ringSigned(x, z, ring) > 0 || ground.edge[k] < 20) continue;
      inside++;
      if (ground.waterH[k] < rising) wet.push(`(${x}, ${z}) ${ground.waterH[k].toFixed(2)} 米`);
    }
    expect(inside).toBeGreaterThan(100);
    expect(wet, '这块地里有比“水来了”的水面低的地面，要靠标记才干').toEqual([]);
    expect(rising).toBeGreaterThan(normal);
  });

  it('大水到了云龙山的西山脚', () => {
    const R = realScene(KEY);
    const { samplers, scene } = R;
    const flood = scene.water.levels.values.flood;
    const [x0, z0] = thingAt('yunlongshan');
    expect(samplers.height(x0, z0), '云龙山的山头不该在水里').toBeGreaterThan(flood + 10);
    // 从山头往西走：五百米以内碰到水，再往西五百米都是水（接着城西的那一大片，不是山脚下的一个水坑）
    let shore = -1;
    for (let d = 0; d <= 500; d += 10) {
      if (samplers.waterH(x0 - d, z0) < flood) {
        shore = d;
        break;
      }
    }
    expect(shore, '从云龙山的山头往西五百米以内没有碰到水').toBeGreaterThan(0);
    for (let d = shore; d <= shore + 500; d += 20) {
      expect(samplers.waterH(x0 - d, z0), `山头往西 ${d} 米的地方大水时是干的`).toBeLessThan(flood);
    }
  });

  it('平时，今天云龙湖那一片是干的', () => {
    const R = realScene(KEY);
    const { ground, scene, coords } = R;
    const normal = scene.water.levels.values.normal;
    const ring = localRing(levelEdit('lake-fill').area, coords);
    let cells = 0;
    let lowest = Infinity;
    for (let k = 0; k < ground.nx * ground.nz; k++) {
      const [x, z] = cellAt(ground, k);
      if (ringSigned(x, z, ring) > 0) continue;
      cells++;
      lowest = Math.min(lowest, ground.waterH[k]);
    }
    expect(cells).toBeGreaterThan(1000);
    expect(lowest, `云龙湖那一片最低的地面 ${lowest.toFixed(2)} 米，不比平时的水面高`).toBeGreaterThan(normal);
  });

  it('张山人的草屋比大水的水面低半米到一米半，在放鹤亭西边、比它低；放鹤亭在水面以上', () => {
    const R = realScene(KEY);
    const { samplers, scene, ground } = R;
    const { normal, flood } = scene.water.levels.values;
    const hut = thingAt('old-hut');
    const pavilion = thingAt('fangheting');
    const hutM = samplers.height(...hut);
    const pavilionM = samplers.height(...pavilion);
    expect(flood - hutM, `草屋的地面 ${hutM.toFixed(2)} 米，大水 ${flood} 米`).toBeGreaterThanOrEqual(0.5);
    expect(flood - hutM, `草屋的地面 ${hutM.toFixed(2)} 米，大水 ${flood} 米`).toBeLessThanOrEqual(1.5);
    // 草屋那里大水时真的有水（没有被算成水漫不进去的地方），平时是干的
    expect(samplers.waterH(...hut)).toBeLessThan(flood);
    expect(samplers.waterH(...hut)).toBeGreaterThan(normal);
    const k = Math.round((hut[1] - ground.z0) / ground.cell) * ground.nx + Math.round((hut[0] - ground.x0) / ground.cell);
    expect(ground.dry[k]).toBe(0);
    expect(hut[0], '草屋要在放鹤亭的西边').toBeLessThan(pavilion[0]);
    expect(hutM, '草屋要比放鹤亭低').toBeLessThan(pavilionM);
    expect(pavilionM, `放鹤亭的地面 ${pavilionM.toFixed(2)} 米，不比大水（${flood} 米）高`).toBeGreaterThan(flood);
  });

  it('东南角的木岸立在墙脚土坡的水边上：线上每一点脚下都是土坡，坡面离平时的水面不到一米；整条线在东南城角以北', () => {
    const R = realScene(KEY);
    const { scene, ground, samplers, coords } = R;
    const style = styleFor(scene.style);
    const ctx = { scene, ground, samplers, coords, style, quality: FULL_QUALITY };
    const pass: Pass = { ctx, survey: surveyWalls(ctx), yards: [], lots: [], bucket: () => ({ main: new Batch(), raised: new Batch(), boats: [] }) };
    const timber = scene.things.find((t) => t.id === 'timber-bank');
    expect(timber?.line, '场景里没有东南角的木岸').toBeDefined();
    if (!timber?.line) return;
    const line = timber.line.map((p): Vec2 => coords.toLocal(p));
    const wall = wallRing();
    const cornerZ = Math.max(...wall.map((p) => p[1]));
    const eastX = Math.max(...wall.map((p) => p[0]));
    const waterY = coords.y(scene.water.levels.values.normal);
    const off: string[] = [];
    let checked = 0;
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i];
      const [bx, bz] = line[i + 1];
      const steps = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / 7));
      for (let s = 0; s <= steps; s++) {
        const x = ax + ((bx - ax) * s) / steps;
        const z = az + ((bz - az) * s) / steps;
        checked++;
        const slope = bankSurfaceY(pass, x, z);
        // 沙盘里的高度是真实的米乘山高夸大的倍数
        const metres = slope === null ? null : (slope - waterY) / scene.frame.relief.times;
        if (metres === null || Math.abs(metres) > 1) off.push(`(${x.toFixed(0)}, ${z.toFixed(0)}) ${metres === null ? '脚下没有土坡' : `坡面比水面${metres > 0 ? '高' : '低'} ${Math.abs(metres).toFixed(2)} 米`}`);
        expect(z, '木岸伸到了东南城角以南').toBeLessThan(cornerZ);
        expect(x, '木岸不在东墙外面').toBeGreaterThan(eastX + 60);
      }
    }
    expect(checked).toBeGreaterThan(10);
    expect(off, `木岸有 ${off.length} 处不在土坡的水边上`).toEqual([]);
    // 城的东南角：离南墙的线不到 150 米
    expect(Math.max(...line.map((p) => p[1]))).toBeGreaterThan(cornerZ - 150);
  });

  it('抹掉的故黄河高地，没有一处比旁边的平地高出半米', () => {
    const R = realScene(KEY);
    const { ground, scene, coords } = R;
    const { nx, nz } = ground;
    const N = nx * nz;
    const base = scene.terrain.recipe.plainBaseM;
    const bed = levelEdit('old-bed');
    const ring = localRing(bed.area, coords);

    // 每一格离“抹掉的那一带”的边多远（里面是负数）
    const out = new Float32Array(N);
    for (let k = 0; k < N; k++) out[k] = ringSigned(...cellAt(ground, k), ring);

    // 别的修整够得着的地方不算“旁边的平地”（城外垫高的一圈、戏马台、城南的高地）
    const others: { ring: Vec2[] | null; at: Vec2; reach: number }[] = [];
    for (const edit of scene.terrain.edits) {
      if (edit.id === bed.id) continue;
      if (edit.op === 'mound') others.push({ ring: null, at: coords.toLocal(edit.at), reach: edit.outerM });
      else if (edit.inside !== undefined) others.push({ ring: wallRing(), at: [0, 0], reach: edit.featherM });
      else if (edit.area) others.push({ ring: localRing(edit.area, coords), at: [0, 0], reach: edit.featherM });
    }
    const touched = (x: number, z: number): boolean => others.some((o) => (o.ring ? ringSigned(x, z, o.ring) < o.reach : Math.hypot(x - o.at[0], z - o.at[1]) < o.reach));

    // “旁边的平地”：这一带的过渡以外 400 米以内，是平地（不到 平地 + 2.6 米），不在河边，别的修整没有动过。
    // 用累加表，后面取一格四周 1200 米见方里这些格子的平均。
    const W = nx + 1;
    const sum = new Float64Array(W * (nz + 1));
    const cnt = new Float64Array(W * (nz + 1));
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const beside = out[k] > bed.featherM && out[k] <= bed.featherM + 400 && ground.h[k] < base + 2.6 && ground.edge[k] > 60 && !touched(...cellAt(ground, k));
        const a = (j + 1) * W + (i + 1);
        sum[a] = (beside ? ground.h[k] : 0) + sum[a - 1] + sum[a - W] - sum[a - W - 1];
        cnt[a] = (beside ? 1 : 0) + cnt[a - 1] + cnt[a - W] - cnt[a - W - 1];
      }
    }
    const reach = Math.round(1200 / ground.cell);
    const high: string[] = [];
    let inside = 0;
    let compared = 0;
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (out[k] > 0) continue;
        inside++;
        const i0 = Math.max(0, i - reach);
        const i1 = Math.min(nx - 1, i + reach) + 1;
        const j0 = Math.max(0, j - reach);
        const j1 = Math.min(nz - 1, j + reach) + 1;
        const box = (t: Float64Array): number => t[j1 * W + i1] - t[j0 * W + i1] - t[j1 * W + i0] + t[j0 * W + i0];
        const n = box(cnt);
        if (n < 50) continue;
        compared++;
        const plain = box(sum) / n;
        if (ground.h[k] > plain + 0.5) high.push(`(${cellAt(ground, k).join(', ')}) ${ground.h[k].toFixed(2)} 米，旁边的平地 ${plain.toFixed(2)} 米`);
      }
    }
    expect(inside).toBeGreaterThan(5000);
    // 这一带绝大部分的格子旁边都找得到平地来比
    expect(compared / inside).toBeGreaterThan(0.9);
    expect(high.slice(0, 20), `这一带有 ${high.length} 格比旁边的平地高出半米以上`).toEqual([]);
  });
});

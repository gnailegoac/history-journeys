// 场景验收：黄州这座沙盘的地面，照考证记录（docs/research/huangzhou-scene.md）和正文该有的样子查一遍。
// 在 Node 里跑，只算地面，不要浏览器。各座沙盘都要查的那几样在 scene-ground.test.ts 里，这里只查黄州自己的：
//   大江不是照一条中线挖出来的，是用修整把江底压到水位以下做的；水位有三档——水落（十月）、平时、高水（寒食前后和七月）。
//   哪几处在哪一档有水、哪一档露出来，就是这座沙盘要讲的事：
//     崖脚的石滩、江心的滩      平时在水下，水落才露出来（“水落石出”）；
//     临皋亭门前的滩、长洲      平时是干的，高水时没在水里（“春江欲入户”）；
//     临皋亭脚下的矮岸、长洲的高处、平地、寺、城   哪一档都是干的；
//     江的主道、崖下的水道、夏澳   哪一档都有水，夏澳哪一档都连着江。
// 这里的数（水位、修整的高低和范围）调过以后要重新跑；改了定下来的做法，场景文件里的依据要跟着改。

import { describe, expect, it } from 'vitest';
import type { LevelEdit } from '../../src/domain/scene';
import type { LngLat } from '../../src/domain/types';
import { ringSigned } from '../../src/stage/ground/lines';
import type { StopScene } from '../../src/domain/scene';
import { buildFields, readDem } from '../../src/stage/ground';
import { demSampler } from '../../src/stage/ground/dem';
import { readBytes } from '../support/readBytes';
import { cellAt, localRing, realScene, realSceneFile, realSceneKeys, wetCell } from './support/realScenes';

const KEY = 'su-shi/huangzhou';

/** 三档水位的名字，从低到高。 */
const LEVELS = ['low', 'normal', 'high'] as const;
type Level = (typeof LEVELS)[number];

/** 一处有名字的地方，和它在三档水位上该不该有水。 */
interface Spot {
  name: string;
  at: LngLat;
  wet: Record<Level, boolean>;
}
const always = { low: true, normal: true, high: true };
const never = { low: false, normal: false, high: false };
const SPOTS: Spot[] = [
  { name: '江的主道', at: [114.833, 30.4565], wet: always },
  { name: '崖下的水道', at: [114.8585, 30.4565], wet: always },
  { name: '临皋亭外系船的地方', at: [114.8622, 30.4447], wet: always },
  { name: '夏澳', at: [114.8655, 30.4435], wet: always },
  { name: '夏澳的口', at: [114.8641, 30.4434], wet: always },
  { name: '崖脚的石滩', at: [114.8613, 30.456], wet: { low: false, normal: true, high: true } },
  { name: '江心的滩（长洲西边）', at: [114.837, 30.465], wet: { low: false, normal: true, high: true } },
  { name: '长洲', at: [114.853, 30.45], wet: { low: false, normal: false, high: true } },
  { name: '长洲的南梢', at: [114.864, 30.435], wet: { low: false, normal: false, high: true } },
  { name: '临皋亭门前的滩', at: [114.8634, 30.4448], wet: { low: false, normal: false, high: true } },
  { name: '临皋亭脚下的矮岸', at: [114.8642, 30.4445], wet: never },
  { name: '长洲的高处', at: [114.8482, 30.465], wet: never },
  { name: '赤壁所在的山（崖脚的线后面 60 米）', at: [114.8622, 30.4565], wet: never },
  { name: '城东南的平地', at: [114.885, 30.435], wet: never },
  { name: '对岸的平地', at: [114.818, 30.45], wet: never },
  { name: '承天寺', at: [114.868, 30.445], wet: never },
  { name: '定惠院', at: [114.8746, 30.4466], wet: never },
  { name: '安国寺', at: [114.8717, 30.4401], wet: never },
  { name: '州衙', at: [114.8643, 30.4548], wet: never },
];

describe.runIf(realSceneKeys().includes(KEY))('黄州的地面', () => {
  const R = realScene(KEY);
  const { ground, scene, coords, samplers } = R;
  const values = scene.water.levels.values;
  const N = ground.nx * ground.nz;
  const cellOf = (at: LngLat): number => {
    const [x, z] = coords.toLocal(at);
    return Math.round((z - ground.z0) / ground.cell) * ground.nx + Math.round((x - ground.x0) / ground.cell);
  };
  const wetAt = (k: number, level: Level): boolean => wetCell(ground, k, values[level], values.normal);

  it('三档水位：水落比平时低，高水比平时高；高水也不上平地', () => {
    expect(Object.keys(values).sort()).toEqual(['high', 'low', 'normal']);
    expect(values.low).toBeLessThan(values.normal);
    expect(values.normal).toBeLessThan(values.high);
    expect(values.high).toBeLessThan(scene.terrain.recipe.plainBaseM);
    expect(ground.lowWaterM).toBe(values.low);
  });

  it('大江是修整压出来的宽水面，程序认得：江里是水（离岸是负数），两条写了名字的河在水里；岸上是岸上', () => {
    // 四万格上下明明白白在水位以下、又不在哪条画出来的河里
    console.log(`黄州：修整压出来的宽水面有 ${ground.openSeeds} 格“种子”（一共 ${N} 格）`);
    expect(ground.openSeeds).toBeGreaterThan(30_000);
    const edge = (at: LngLat): number => samplers.edge(...coords.toLocal(at));
    const rows = [
      ['崖下的水道（船在这里）', [114.86, 30.456]],
      ['崖脚的石滩', [114.8613, 30.456]],
      ['夏澳', [114.8655, 30.4435]],
      ['临皋亭外系船的地方', [114.8622, 30.4447]],
      ['江的主道', [114.833, 30.4565]],
      ['临皋亭脚下的矮岸', [114.8642, 30.4445]],
    ] as const;
    console.log(rows.map(([name, at]) => `  ${name}：离岸 ${edge([at[0], at[1]]).toFixed(0)} 米`).join('\n'));
    // 水里：负数，而且不是贴着岸（石滩、夏澳只有几十米宽）
    expect(edge([114.86, 30.456])).toBeLessThan(-60);
    expect(edge([114.8613, 30.456])).toBeLessThan(-15);
    expect(edge([114.8655, 30.4435])).toBeLessThan(-15);
    expect(edge([114.8622, 30.4447])).toBeLessThan(-20);
    // 江心离岸几百米（最多记到 620 米）
    expect(edge([114.833, 30.4565])).toBeLessThan(-300);
    // 岸上：正数
    expect(edge([114.8642, 30.4445])).toBeGreaterThan(20);
    expect(edge([114.868, 30.445])).toBeGreaterThan(100);
    // 一格一格看：平时有水的格子都是负数（不在哪条画出来的河的岸上）
    let wrong = 0;
    for (let k = 0; k < N; k++) if (ground.h[k] < values.normal - 0.25 && !(ground.edge[k] < 0)) wrong++;
    expect(wrong).toBe(0);
  });

  it('有名字的各处，在水落、平时、高水三档上有没有水，同考证记录说的一样', () => {
    const lines: string[] = ['黄州：各处的地面多高，三档水位上有没有水（水落 / 平时 / 高水）'];
    const wrong: string[] = [];
    for (const spot of SPOTS) {
      const k = cellOf(spot.at);
      const h = ground.h[k];
      const got = LEVELS.map((level) => wetAt(k, level));
      lines.push(`  ${spot.name}：${h.toFixed(1)} 米；${LEVELS.map((level, i) => (got[i] ? `水深 ${(values[level] - h).toFixed(1)}` : `干，高出 ${(h - values[level]).toFixed(1)}`)).join(' / ')}`);
      LEVELS.forEach((level, i) => {
        if (got[i] !== spot.wet[level]) wrong.push(`${spot.name}在“${level}”（${values[level]} 米）上${got[i] ? '有水' : '没有水'}，该${spot.wet[level] ? '有' : '没有'}`);
      });
    }
    console.log(lines.join('\n'));
    expect(wrong).toEqual([]);
  });

  it('城东的湖荡：圈的正中三档水位都有水（它的岸缓，水面跟着水位大小变得最多）', () => {
    const lake = scene.terrain.edits.find((e) => e.id === 'east-lake');
    expect(lake?.op === 'level' && lake.area !== undefined).toBe(true);
    if (!lake || lake.op !== 'level' || !lake.area) return;
    const ring = localRing(lake.area, coords);
    const cx = ring.reduce((sum, p) => sum + p[0], 0) / ring.length;
    const cz = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
    expect(ringSigned(cx, cz, ring), '圈的正中要在圈里面').toBeLessThan(0);
    const k = Math.round((cz - ground.z0) / ground.cell) * ground.nx + Math.round((cx - ground.x0) / ground.cell);
    console.log(`黄州：城东的湖荡正中的地面 ${ground.h[k].toFixed(1)} 米`);
    for (const level of LEVELS) expect(wetAt(k, level), level).toBe(true);
  });

  it('要看得出来的那几样，高低差得够：石滩在水落以上、平时以下各半米多；门前的滩在平时以上、高水以下各半米多；矮岸、长洲的高处比高水高', () => {
    const h = (at: LngLat): number => ground.h[cellOf(at)];
    const shelf = h([114.8613, 30.456]);
    expect(shelf - values.low).toBeGreaterThan(0.5);
    expect(values.normal - shelf).toBeGreaterThan(0.5);
    const apron = h([114.8634, 30.4448]);
    expect(apron - values.normal).toBeGreaterThan(0.5);
    expect(values.high - apron).toBeGreaterThan(0.5);
    // 高水时滩上的水有一米来深：水面岸边那道白只到 1.25 米深为止，水再浅，淹了的滩是一片发白的浅水，
    // 和平时干着的滩（浅的草色）分不出来——“寒食，沙湖”和“一天一百五十钱”两节比的就是亭子门前这一块
    expect(values.high - apron).toBeGreaterThan(1);
    const bar = h([114.853, 30.45]);
    expect(bar - values.normal).toBeGreaterThan(0.3);
    expect(values.high - bar).toBeGreaterThan(0.5);
    expect(h([114.8642, 30.4445]) - values.high).toBeGreaterThan(0.2);
    expect(h([114.8482, 30.465]) - values.high).toBeGreaterThan(0.2);
  });

  it('水占沙盘的几成：水落最少，高水最多，一档比一档多出一截', () => {
    const share = LEVELS.map((level) => {
      let wet = 0;
      for (let k = 0; k < N; k++) if (wetAt(k, level)) wet++;
      return wet / N;
    });
    console.log(`黄州：水占沙盘的 ${share.map((v, i) => `${LEVELS[i]} ${(v * 100).toFixed(1)}%`).join('，')}`);
    expect(share[0]).toBeGreaterThan(0.2);
    expect(share[1] - share[0]).toBeGreaterThan(0.04);
    expect(share[2] - share[1]).toBeGreaterThan(0.04);
    expect(share[2]).toBeLessThan(0.45);
  });

  it('高水也不上平地：修整的圈和它们的过渡带以外，没有一格有水', () => {
    const rings = scene.terrain.edits
      .filter((e): e is LevelEdit & { area: [number, number][] } => e.op === 'level' && e.area !== undefined)
      .map((e) => ({ ring: localRing(e.area, coords), feather: e.featherM }));
    let stray = 0;
    let checked = 0;
    for (let k = 0; k < N; k++) {
      const [x, z] = cellAt(ground, k);
      if (rings.some(({ ring, feather }) => ringSigned(x, z, ring) < feather + ground.cell)) continue;
      checked++;
      if (wetAt(k, 'high')) stray++;
    }
    expect(checked).toBeGreaterThan(N * 0.3);
    expect(stray).toBe(0);
  });

  it('夏澳三档水位都连着江；临皋亭外系船的地方、崖下的水道也都连着江的主道', () => {
    const { nx, nz } = ground;
    for (const level of LEVELS) {
      // 从江的主道起，一格一格漫开（上下左右）
      const seen = new Uint8Array(N);
      const start = cellOf([114.833, 30.4565]);
      expect(wetAt(start, level)).toBe(true);
      const queue = [start];
      seen[start] = 1;
      while (queue.length > 0) {
        const k = queue.pop()!;
        const i = k % nx;
        const j = Math.floor(k / nx);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || ii >= nx || jj < 0 || jj >= nz) continue;
          const q = jj * nx + ii;
          if (seen[q] || !wetAt(q, level)) continue;
          seen[q] = 1;
          queue.push(q);
        }
      }
      for (const [name, at] of [['夏澳', [114.8655, 30.4435]], ['夏澳的口', [114.8641, 30.4434]], ['临皋亭外系船的地方', [114.8622, 30.4447]], ['崖下的水道', [114.8585, 30.4565]]] as const) {
        expect(seen[cellOf([at[0], at[1]])], `${name}在“${level}”上连不到江的主道`).toBe(1);
      }
      // 连不到江的水：只有城东的湖荡和几处小水洼。数出来印给看图的人
      let apart = 0;
      let lake = 0;
      const lakeRing = scene.terrain.edits.find((e) => e.id === 'east-lake');
      const ring = lakeRing && lakeRing.op === 'level' && lakeRing.area ? localRing(lakeRing.area, coords) : null;
      for (let k = 0; k < N; k++) {
        if (!wetAt(k, level) || seen[k]) continue;
        const [x, z] = cellAt(ground, k);
        if (ring && ringSigned(x, z, ring) < 240) lake++;
        else apart++;
      }
      console.log(`黄州“${level}”：连不到江的水，湖荡 ${lake} 格，别处的小水洼 ${apart} 格（一格 20 米见方）`);
      expect(apart, `“${level}”上江和湖荡以外的水洼`).toBeLessThanOrEqual(12);
    }
  });

  it('“地形的整理”的依据里没有留着“以后再写”的话；里面的数是在摆出来的地面上量的：对岸两座山、城北的山今天多高、摆出来多高，平地垫高、压低了多少', { timeout: 30_000 }, () => {
    const basis = scene.terrain.recipe.basis;
    // 整个场景文件里给读者看的话，没有一句是“量过再写进来”这样的待办
    const texts: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === 'string') texts.push(value);
      else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    walk(scene);
    for (const text of texts) expect(text).not.toMatch(/再写进来|量过再写|以后再补|待补/);

    // 今天的高程和只做“整理”（不做修整、不挖河）的地面
    const { terrainPath } = realSceneFile(KEY);
    const dem = readDem(scene.terrain, readBytes(terrainPath));
    const today = demSampler(dem, coords);
    const bare = buildFields({ ...scene, terrain: { ...scene.terrain, edits: [] }, water: { ...scene.water, rivers: [], rapids: [], dry: [] }, things: [], dressing: [] } as StopScene, dem);
    const recipe = scene.terrain.recipe;
    if (recipe.kind !== 'plain-and-hills') throw new Error('黄州的整理不是“平地和山”这一种');

    // 一、山：一圈里今天最高的一点，摆出来最高的一点（修整没有碰这三座山）
    const peak = (at: LngLat, radiusM: number): { was: number; now: number } => {
      const [cx, cz] = coords.toLocal(at);
      let was = -Infinity;
      let now = -Infinity;
      for (let k = 0; k < N; k++) {
        const [x, z] = cellAt(ground, k);
        if (Math.hypot(x - cx, z - cz) > radiusM) continue;
        was = Math.max(was, today(x, z));
        now = Math.max(now, ground.h[k]);
      }
      return { was, now };
    };
    const east = peak([114.8631, 30.4124], 400);
    const west = peak([114.8487, 30.413], 400);
    const north = peak([114.868, 30.466], 600);
    console.log(`黄州：对岸东边的山 今天 ${east.was.toFixed(1)}、摆出来 ${east.now.toFixed(1)}；西边的山 ${west.was.toFixed(1)}、${west.now.toFixed(1)}；城北的山 ${north.was.toFixed(1)}、${north.now.toFixed(1)}`);
    expect(basis).toContain(`最高读 ${Math.round(east.was)}、${Math.round(west.was)} 米`);
    expect(basis).toContain(`摆出来是 ${Math.round(east.now)}、${Math.round(west.now)} 米`);
    expect(basis).toContain(`城北的山从 ${Math.round(north.was)} 米变成 ${Math.round(north.now)} 米`);

    // 二、平地：离沙盘四边 edgeTaperM 以外、今天低于 plainBelowM 的格子，照今天的高低分三拨
    const taper = recipe.edgeTaperM;
    const { westM, eastM, northM, southM } = scene.frame;
    const low: number[] = [];
    const high: number[] = [];
    const after: number[] = [];
    const slopes: number[] = [];
    for (let k = 0; k < N; k++) {
      const [x, z] = cellAt(bare, k);
      if (x < -westM + taper || x > eastM - taper || z < -northM + taper || z > southM - taper) continue;
      const t = today(x, z);
      const d = bare.h[k] - t;
      if (t >= recipe.plainBelowM && t < recipe.hillAboveM) slopes.push(d);
      if (t < 15 || t >= recipe.plainBelowM) continue;
      (t < 22 ? low : high).push(d);
      after.push(bare.h[k]);
    }
    const sorted = (list: number[]): number[] => [...list].sort((a, b) => a - b);
    const at = (list: number[], p: number): number => sorted(list)[Math.round((list.length - 1) * p)];
    console.log(`黄州的平地：今天 15 到 22 米的 ${low.length} 格，垫高的中数 ${at(low, 0.5).toFixed(1)}、九成半以内 ${at(low, 0.95).toFixed(1)}；今天 22 到 33 米的 ${high.length} 格，压低的中数 ${(-at(high, 0.5)).toFixed(1)}、最多 ${(-at(high, 0)).toFixed(1)}；整理以后 ${at(after, 0.05).toFixed(1)} 到 ${at(after, 0.95).toFixed(1)}；山坡矮了 ${(-at(slopes, 0.95)).toFixed(1)} 到 ${(-at(slopes, 0.05)).toFixed(1)}`);
    // “多数垫高一两米，最多六米上下”
    expect(basis).toContain('多数垫高一两米，最多六米上下');
    expect(at(low, 0.5)).toBeGreaterThan(1);
    expect(at(low, 0.5)).toBeLessThan(2);
    expect(at(low, 0.95)).toBeGreaterThan(5);
    expect(at(low, 0.95)).toBeLessThan(7);
    // “多数压低三四米，最多 11 米”
    expect(basis).toContain('多数压低三四米，最多 11 米');
    expect(-at(high, 0.5)).toBeGreaterThan(3);
    expect(-at(high, 0.5)).toBeLessThan(4);
    expect(Math.round(-at(high, 0))).toBe(11);
    // “整理以后的平地都在 21 到 24 米之间”（二十格里十九格）
    expect(basis).toContain('整理以后的平地都在 21 到 24 米之间');
    expect(Math.round(at(after, 0.05))).toBe(21);
    expect(Math.round(at(after, 0.95))).toBe(24);
    // “山坡矮了 7 到 13 米”（今天 33 到 42 米的格子，二十格里十九格）
    expect(basis).toContain('山坡矮了 7 到 13 米');
    expect(Math.round(-at(slopes, 0.95))).toBe(7);
    expect(Math.round(-at(slopes, 0.05))).toBe(13);
  });

  it('赤壁所在的山：山顶比平时的水面高 25 到 32 米（史料说“三十米上下”是这座山，不是崖）', () => {
    const mound = scene.terrain.edits.find((e) => e.id === 'cliff-hill');
    expect(mound?.op).toBe('mound');
    if (!mound || mound.op !== 'mound') return;
    const [cx, cz] = coords.toLocal(mound.at);
    let top = -Infinity;
    for (let k = 0; k < N; k++) {
      const [x, z] = cellAt(ground, k);
      // 只看垫足了的那一圈里面（innerM）：再往外是往州衙去的高地，不是这座山的顶
      if (Math.hypot(x - cx, z - cz) <= mound.innerM && ground.h[k] > top) top = ground.h[k];
    }
    console.log(`黄州：赤壁所在的山，山顶 ${top.toFixed(1)} 米，比平时的水面高 ${(top - values.normal).toFixed(1)} 米`);
    expect(top - values.normal).toBeGreaterThanOrEqual(25);
    expect(top - values.normal).toBeLessThanOrEqual(32);
  });
});

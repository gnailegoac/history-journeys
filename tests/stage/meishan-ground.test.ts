// 场景验收：眉州这座沙盘的地面，照考证记录（docs/research/meishan-scene.md）和建造时定下来的样子查一遍。
// 在 Node 里跑，只算地面和一座殿，不要浏览器。各座沙盘都要查的那几样在 scene-ground.test.ts 里，这里只查眉州自己的：
//   水      只有平时的一档。岷江、蟆颐山脚下的一股、城东的小河都是照线挖出来的河：没有修整压出来的宽水面（一格“种子”也没有），
//           河以外没有水；三条河从头到尾有水；蟆颐山脚下两股水中间的卵石滩是干的，四面是水，上面不画田。
//   道观    蟆颐山上那座殿脚下垫了一块平台。读者看到的是地形板（59 米一格，每个顶点取四周 22 米里最低的地面），
//           所以平台是照地形板定的大小：它里面的六个顶点一样高；殿下面的石台不高，不悬在坡上，也不埋在坡里；殿离水远。
//   城      离城墙最近的水、城里的地面。
//   字      场景文件里给读者看的话没有一句是“以后再做”的待办；依据里写的数是在摆出来的地面上量的。
// 这里的数（河的线、平台的范围和高低）调过以后要重新跑；改了定下来的做法，场景文件里的依据要跟着改。

import { describe, expect, it } from 'vitest';
import type { StopScene } from '../../src/domain/scene';
import type { LngLat } from '../../src/domain/types';
import { buildFields, paintColour, readDem } from '../../src/stage/ground';
import { demSampler } from '../../src/stage/ground/dem';
import { distLine, ringSigned, smoothLine } from '../../src/stage/ground/lines';
import type { Vec2 } from '../../src/stage/ground/types';
import type { KitContext } from '../../src/stage/three/internal';
import { Batch } from '../../src/stage/three/kit/geo';
import type { Pass } from '../../src/stage/three/kit/pass';
import { surveyWalls } from '../../src/stage/three/kit/site';
import { THING_BUILDERS } from '../../src/stage/three/kit/things';
import { meshHeightAt, terrainGrid, vertexHeightM } from '../../src/stage/three/meshHeight';
import { FULL_QUALITY } from '../../src/stage/three/quality';
import { styleFor } from '../../src/stage/three/style';
import { MADE_FILES_PENDING } from '../support/pendingTables';
import { readBytes } from '../support/readBytes';
import { cellAt, localRing, realScene, realSceneFile, realSceneKeys, wetCell } from './support/realScenes';

const KEY = 'su-shi/meishan';

describe.runIf(realSceneKeys().includes(KEY))('眉州的地面', () => {
  const R = realScene(KEY);
  const { ground, scene, coords, samplers } = R;
  const normal = scene.water.levels.values.normal;
  const N = ground.nx * ground.nz;
  const cellOf = (x: number, z: number): number => Math.round((z - ground.z0) / ground.cell) * ground.nx + Math.round((x - ground.x0) / ground.cell);
  const wet = (k: number): boolean => wetCell(ground, k, normal, normal);
  const wetAt = (x: number, z: number): boolean => wet(cellOf(x, z));
  const local = (at: LngLat): Vec2 => coords.toLocal(at);
  const river = (id: string): Vec2[] => {
    const found = scene.water.rivers.find((r) => r.id === id);
    if (!found) throw new Error(`场景里没有 ${id} 这条河`);
    return found.line.map(local);
  };
  const place = (id: string): Vec2 => {
    const found = scene.places.find((p) => p.id === id) ?? scene.things.find((t) => t.id === id);
    if (!found?.at) throw new Error(`场景里没有 ${id}，或者它没有写 at`);
    return local(found.at);
  };
  /** 沙盘上的高度（地面的海拔照夸大的倍数换过）。 */
  const tableY = (heightM: number): number => coords.y(heightM);
  const times = scene.frame.relief.times;

  it('只有平时的一档水位；没有修整压出来的宽水面：一格“种子”也没有，河以外最低的地面比水面高一米以上', () => {
    expect(Object.keys(scene.water.levels.values)).toEqual(['normal']);
    expect(ground.lowWaterM).toBeNull();
    expect(ground.openSeeds).toBe(0);
    // 画出来的河的岸外 20 米以外，最低的地面比水位高多少（黄州那种宽水面的门槛是低 0.25 米）
    let lowest = Infinity;
    let wetOutside = 0;
    for (let k = 0; k < N; k++) {
      if (!(ground.edge[k] > 20)) continue;
      lowest = Math.min(lowest, ground.h[k]);
      if (wet(k)) wetOutside++;
    }
    console.log(`眉州：河岸 20 米以外最低的地面 ${lowest.toFixed(2)} 米，比水面（${normal} 米）高 ${(lowest - normal).toFixed(2)} 米；那里有水的格子 ${wetOutside} 个`);
    expect(wetOutside).toBe(0);
    expect(lowest - normal).toBeGreaterThan(1);
    expect(lowest - normal).toBeLessThan(1.5);
  });

  it('三条河从头到尾有水；水占沙盘的一小块（百分之四到七）', () => {
    for (const id of ['minjiang', 'minjiang-foot', 'side-channel']) {
      const line = smoothLine(river(id), 20).filter(([x, z]) => x > ground.x0 + 30 && x < ground.x0 + (ground.nx - 1) * ground.cell - 30 && z > ground.z0 + 30 && z < ground.z0 + (ground.nz - 1) * ground.cell - 30);
      const dry = line.filter(([x, z]) => !wetAt(x, z));
      expect(line.length, id).toBeGreaterThan(20);
      expect(dry.length, `${id} 的中线上干的点`).toBe(0);
    }
    let water = 0;
    for (let k = 0; k < N; k++) if (wet(k)) water++;
    console.log(`眉州：水占沙盘的 ${((water / N) * 100).toFixed(1)}%`);
    expect(water / N).toBeGreaterThan(0.04);
    expect(water / N).toBeLessThan(0.07);
  });

  it('蟆颐山脚下：从西往东是宽的一股水、卵石滩、窄的一股水、山脚的岸；滩是干的，四面是水，上面不画田', { timeout: 60_000 }, () => {
    // 滩：从“卵石滩上的路”的中点起，把连着的干格子都找出来。四面是水的话，找到的是一小块；连到岸上就会一直漫出去
    const road = scene.dressing.find((rule) => rule.id === 'road-bar');
    if (!road?.line) throw new Error('场景里没有卵石滩上的路');
    const [a, b] = road.line.map(local);
    const seed = cellOf((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    expect(wet(seed)).toBe(false);
    const seen = new Uint8Array(N);
    const island: number[] = [];
    const queue = [seed];
    seen[seed] = 1;
    const LIMIT = 4000;
    while (queue.length > 0 && island.length <= LIMIT) {
      const k = queue.pop() as number;
      island.push(k);
      const i = k % ground.nx;
      const j = Math.floor(k / ground.nx);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= ground.nx || nj >= ground.nz) continue;
        const n = nj * ground.nx + ni;
        if (seen[n] || wet(n)) continue;
        seen[n] = 1;
        queue.push(n);
      }
    }
    const hectares = (island.length * ground.cell * ground.cell) / 10_000;
    const heights = island.map((k) => ground.h[k]);
    console.log(`眉州：卵石滩 ${island.length} 格（${hectares.toFixed(1)} 公顷），地面 ${Math.min(...heights).toFixed(2)} 到 ${Math.max(...heights).toFixed(2)} 米，比水面高 ${(Math.min(...heights) - normal).toFixed(2)} 米以上`);
    // 四面是水：没有漫到岸上去；有一片滩的大小（几公顷到几十公顷）
    expect(island.length).toBeLessThanOrEqual(LIMIT);
    expect(hectares).toBeGreaterThan(5);
    expect(hectares).toBeLessThan(60);
    expect(Math.max(...heights)).toBeLessThanOrEqual(scene.water.banks.bankM + 0.01);

    // 道观那一条纬线上，从西往东量：宽的一股、滩、窄的一股、岸
    const temple = scene.things.find((t) => t.id === 'temple');
    if (!temple?.at) throw new Error('场景里没有道观');
    const [tx, tz] = local(temple.at);
    const [fx] = place('ferry');
    const runs: { wet: boolean; fromX: number; toX: number }[] = [];
    for (let x = fx - 300; x <= tx; x += 5) {
      const w = wetAt(x, tz);
      const last = runs[runs.length - 1];
      if (last && last.wet === w) last.toX = x;
      else runs.push({ wet: w, fromX: x, toX: x });
    }
    const widths = runs.map((run) => `${run.wet ? '水' : '干'} ${run.toX - run.fromX + 5} 米`);
    console.log(`眉州：道观那一条纬线上，从渡口西边 300 米到道观：${widths.join('，')}`);
    expect(runs.map((run) => run.wet)).toEqual([false, true, false, true, false]);
    const [, wide, bar, foot, bank] = runs.map((run) => run.toX - run.fromX + 5);
    expect(wide).toBeGreaterThan(380);
    expect(wide).toBeLessThan(560);
    expect(bar).toBeGreaterThan(120);
    expect(foot).toBeGreaterThan(110);
    expect(foot).toBeLessThan(220);
    expect(bank).toBeGreaterThan(60);

    // 滩上不画田（当时的人只写水浅、露着白石；洲上至多有草）
    const paint = paintColour(ground, styleFor(scene.style).ground);
    const fieldAt = (x: number, z: number): number => {
      const i = Math.max(0, Math.min(paint.w - 1, Math.round(((x - coords.x0) / (coords.x1 - coords.x0)) * (paint.w - 1))));
      const j = Math.max(0, Math.min(paint.h - 1, Math.round(((z - coords.z0) / (coords.z1 - coords.z0)) * (paint.h - 1))));
      return paint.colour[(j * paint.w + i) * 4 + 3] / 255;
    };
    const painted = island.filter((k) => fieldAt(...cellAt(ground, k)) > 0.05).length;
    expect(painted, '卵石滩上画了田的格子').toBe(0);
    // 对照：江西的平地上是画了田的（不然上面那一句什么也没查）
    let plain = 0;
    for (let x = fx - 1500; x <= fx - 500; x += 20) if (fieldAt(x, tz) > 0.05) plain++;
    expect(plain).toBeGreaterThan(10);
  });

  it('道观脚下的平台是照地形板定的：它里面的六个顶点一样高；殿下面的石台不高、不悬在坡上、不埋在坡里；殿离水远、在半山', () => {
    const bench = scene.terrain.edits.find((edit) => edit.id === 'temple-bench');
    if (!bench || bench.op !== 'level' || !bench.area) throw new Error('场景里没有道观脚下的平台');
    const ring = localRing(bench.area, coords);
    // 落在平台里面、四周 22 米都还在平台里面的地形板顶点
    const { sx, sz } = terrainGrid(coords);
    const W = coords.x1 - coords.x0;
    const D = coords.z1 - coords.z0;
    const level: string[] = [];
    let lowestVertex = Infinity;
    for (let j = 0; j <= sz; j++) {
      for (let i = 0; i <= sx; i++) {
        const x = coords.x0 + (i / sx) * W;
        const z = coords.z0 + (j / sz) * D;
        if (ringSigned(x, z, ring) > -22) continue;
        const m = vertexHeightM(samplers, x, z);
        level.push(`${i}/${j} ${m.toFixed(2)}`);
        lowestVertex = Math.min(lowestVertex, m);
        // 一样高：差不到半米（沙盘上 3 米，一格 59 米）。朝江一排的顶点比 toM 低一点——山脚那股水的岸把近处的地面往下带了一点
        expect(m, `地形板第 ${i} 列第 ${j} 行的顶点`).toBeLessThanOrEqual(bench.toM + 0.01);
        expect(m, `地形板第 ${i} 列第 ${j} 行的顶点`).toBeGreaterThan(bench.toM - 0.5);
      }
    }
    console.log(`眉州：平台里的地形板顶点（列/行 海拔）：${level.join('，')}；最低的比 ${bench.toM} 米低 ${(bench.toM - lowestVertex).toFixed(2)} 米（沙盘上 ${((bench.toM - lowestVertex) * times).toFixed(1)}）`);
    expect(level).toHaveLength(6);

    // 殿：用零件库自己的那一段造出来，量它下面的石台
    const temple = scene.things.find((t) => t.id === 'temple');
    if (!temple?.at) throw new Error('场景里没有道观');
    expect(temple.params).toMatchObject({ halls: 1, enclosed: false, terraced: true });
    const ctx: KitContext = { scene, ground, samplers, coords, style: styleFor(scene.style), quality: FULL_QUALITY, kit: R.kit };
    const main = new Batch();
    const bucket = { main, raised: new Batch(), boats: [] };
    const pass: Pass = { ctx, survey: surveyWalls(ctx), yards: [], lots: [], bucket: () => bucket };
    THING_BUILDERS['hall-group'](pass, temple);
    // 石头的两块：头一块是殿下面的石台（things.ts 里先放它），后一块是殿自己的台基
    const stones = main.parts.get('stone') ?? [];
    expect(stones).toHaveLength(2);
    const pos = stones[0].attributes.position;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      x0 = Math.min(x0, pos.getX(i)); x1 = Math.max(x1, pos.getX(i));
      y0 = Math.min(y0, pos.getY(i)); y1 = Math.max(y1, pos.getY(i));
      z0 = Math.min(z0, pos.getZ(i)); z1 = Math.max(z1, pos.getZ(i));
    }
    const mesh = meshHeightAt(samplers, coords);
    let meshLow = Infinity, meshHigh = -Infinity, nearestWater = Infinity;
    for (let u = 0; u <= 1; u += 0.125) {
      for (let v = 0; v <= 1; v += 0.125) {
        const x = x0 + (x1 - x0) * u;
        const z = z0 + (z1 - z0) * v;
        const y = tableY(mesh(x, z));
        meshLow = Math.min(meshLow, y);
        meshHigh = Math.max(meshHigh, y);
        nearestWater = Math.min(nearestWater, samplers.edge(x, z));
      }
    }
    const [tx, tz] = local(temple.at);
    const groundM = samplers.height((x0 + x1) / 2, (z0 + z1) / 2);
    console.log(
      `眉州：道观的石台 ${(x1 - x0).toFixed(0)} × ${(z1 - z0).toFixed(0)} 米，高 ${(y1 - y0).toFixed(1)}（沙盘上的米）；它下面的地形板比石台的底高 ${(meshLow - y0).toFixed(1)} 到 ${(meshHigh - y0).toFixed(1)}，石台的顶比地形板最高处高 ${(y1 - meshHigh).toFixed(1)}；` +
        `离水最近 ${nearestWater.toFixed(0)} 米；殿脚下的地面 ${groundM.toFixed(1)} 米，比水面高 ${(groundM - normal).toFixed(1)} 米；殿的中心离写的那一点 ${Math.hypot((x0 + x1) / 2 - tx, (z0 + z1) / 2 - tz).toFixed(0)} 米`,
    );
    // 不高：一座殿的台基，不是一堵墙（没有平台的时候是八十多到一百多）
    expect(y1 - y0).toBeLessThanOrEqual(20);
    // 不悬在坡上：地形板哪里都不比石台的底低；不埋在坡里：石台的顶露在地形板上面
    expect(meshLow - y0).toBeGreaterThanOrEqual(0);
    expect(y1 - meshHigh).toBeGreaterThan(0);
    // 殿离水至少 60 米；殿在半山：比水面高 25 米以上，比山顶矮
    expect(nearestWater).toBeGreaterThanOrEqual(60);
    expect(groundM).toBeCloseTo(bench.toM, 1);
    expect(groundM - normal).toBeGreaterThan(25);
    const [mx, mz] = place('mayishan');
    expect(samplers.height(mx, mz)).toBeGreaterThan(groundM + 20);
    // 平台朝江的一边垫了多高、靠山的一边挖了多深，都是沙盘上夸大了 times 倍以后才显眼的：记下来给看图的人
    expect(times).toBeGreaterThanOrEqual(6);
  });

  it('离城墙最近的水至少 40 米；城里的地面比水面高四米多', () => {
    const wall = scene.things.find((t) => t.id === 'wall');
    if (!wall?.line) throw new Error('场景里没有城墙');
    const ring = localRing(wall.line, coords);
    const closed = [...ring, ring[0]];
    let nearest = Infinity;
    for (let k = 0; k < N; k++) {
      if (!wet(k)) continue;
      const [x, z] = cellAt(ground, k);
      nearest = Math.min(nearest, distLine(x, z, closed));
    }
    const [hx, hz] = place('home');
    console.log(`眉州：离城墙的线最近的水 ${nearest.toFixed(0)} 米；城里的地面 ${samplers.height(hx, hz).toFixed(1)} 米`);
    expect(nearest).toBeGreaterThanOrEqual(40);
    expect(samplers.height(hx, hz) - normal).toBeGreaterThan(4);
    expect(samplers.height(hx, hz) - normal).toBeLessThan(5);
  });

  it('路到水边为止：过小河、过西边宽的一股水的地方，路的头离水不到 60 米，路上没有一点在水里', () => {
    const ends: [string, number][] = [
      ['road-east', -1],
      ['road-ferry', 0],
      ['road-ferry', -1],
      ['road-bar', 0],
      ['road-bar', -1],
      ['road-hill', 0],
    ];
    for (const [id, which] of ends) {
      const rule = scene.dressing.find((r) => r.id === id);
      if (!rule?.line) throw new Error(`场景里没有 ${id}`);
      const [x, z] = local(rule.line.at(which) as LngLat);
      const edge = samplers.edge(x, z);
      expect(edge, `${id} 的头离水`).toBeGreaterThan(0);
      expect(edge, `${id} 的头离水`).toBeLessThan(60);
    }
    for (const rule of scene.dressing.filter((r) => r.kind === 'roads' && r.line)) {
      for (const [x, z] of smoothLine((rule.line as LngLat[]).map(local), 10)) expect(wetAt(x, z), `${rule.id} 在 (${x.toFixed(0)}, ${z.toFixed(0)})`).toBe(false);
    }
  });

  it('给读者看的话里没有“以后再做”的待办；依据里写的数是在摆出来的地面上量的', { timeout: 60_000 }, () => {
    const texts: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === 'string') texts.push(value);
      else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    walk(scene);
    for (const text of texts) expect(text).not.toMatch(/再写进来|量过再写|以后再补|待补|还没有模型|还没有做|还没做|先摆|暂时|以后再|下一步/);

    // 今天的高程，和只做“整理”（不做修整、不挖河）的地面
    const { terrainPath } = realSceneFile(KEY);
    const dem = readDem(scene.terrain, readBytes(terrainPath));
    const today = demSampler(dem, coords);
    const bare = buildFields({ ...scene, terrain: { ...scene.terrain, edits: [] }, water: { ...scene.water, rivers: [], rapids: [], dry: [] }, things: [], dressing: [] } as StopScene, dem);
    const recipe = scene.terrain.recipe;
    const basis = recipe.basis;

    // 一、山：一圈里今天最高的一点、摆出来最高的一点
    const peak = (at: Vec2, radiusM: number): { was: number; now: number } => {
      let was = -Infinity;
      let now = -Infinity;
      for (let k = 0; k < N; k++) {
        const [x, z] = cellAt(ground, k);
        if (Math.hypot(x - at[0], z - at[1]) > radiusM) continue;
        was = Math.max(was, today(x, z));
        now = Math.max(now, ground.h[k]);
      }
      return { was, now };
    };
    const mayi = peak(place('mayishan'), 500);
    const laoweng = peak(place('laowengshan'), 500);
    let top = { was: -Infinity, now: -Infinity };
    for (let k = 0; k < N; k++) {
      const [x, z] = cellAt(ground, k);
      top = { was: Math.max(top.was, today(x, z)), now: Math.max(top.now, ground.h[k]) };
    }
    const plainNear = samplers.height(...local([103.8497, 30.0497]));
    console.log(
      `眉州的山：蟆颐山 今天 ${mayi.was.toFixed(1)}、摆出来 ${mayi.now.toFixed(1)}；老翁山 ${laoweng.was.toFixed(1)}、${laoweng.now.toFixed(1)}；整块沙盘最高 ${top.was.toFixed(1)}、${top.now.toFixed(1)}；城和江之间的平地 ${plainNear.toFixed(1)}（今天 ${today(...local([103.8497, 30.0497])).toFixed(1)}）`,
    );

    // 二、平地：离沙盘四边 edgeTaperM 以外、今天低于 plainBelowM 的格子，照今天的高低分两拨
    const taper = recipe.edgeTaperM;
    const { westM, eastM, northM, southM } = scene.frame;
    const low: number[] = [];
    const high: number[] = [];
    const after: number[] = [];
    const slopes: number[] = [];
    const todayPlain: number[] = [];
    for (let k = 0; k < N; k++) {
      const [x, z] = cellAt(bare, k);
      if (x < -westM + taper || x > eastM - taper || z < -northM + taper || z > southM - taper) continue;
      const t = today(x, z);
      const d = bare.h[k] - t;
      if (t >= recipe.plainBelowM && t < recipe.hillAboveM) slopes.push(d);
      if (t < 400 || t >= recipe.plainBelowM) continue;
      (t < recipe.plainBaseM ? low : high).push(d);
      after.push(bare.h[k]);
      todayPlain.push(t);
    }
    const sorted = (list: number[]): number[] => [...list].sort((p, q) => p - q);
    const at = (list: number[], p: number): number => sorted(list)[Math.round((list.length - 1) * p)];
    console.log(
      `眉州的平地：今天 ${at(todayPlain, 0.05).toFixed(1)} 到 ${at(todayPlain, 0.95).toFixed(1)} 米（二十格里十九格）；今天低于 ${recipe.plainBaseM} 米的 ${low.length} 格，垫高的中数 ${at(low, 0.5).toFixed(1)}、九成半以内 ${at(low, 0.95).toFixed(1)}；` +
        `今天 ${recipe.plainBaseM} 到 ${recipe.plainBelowM} 米的 ${high.length} 格，压低的中数 ${(-at(high, 0.5)).toFixed(1)}、九成半以内 ${(-at(high, 0.05)).toFixed(1)}、最多 ${(-at(high, 0)).toFixed(1)}；整理以后 ${at(after, 0.05).toFixed(1)} 到 ${at(after, 0.95).toFixed(1)}；` +
        `山坡（今天 ${recipe.plainBelowM} 到 ${recipe.hillAboveM} 米）矮了 ${(-at(slopes, 0.95)).toFixed(1)} 到 ${(-at(slopes, 0.05)).toFixed(1)}`,
    );
    // “今天的平地北高南低，多数在 409 到 422 米之间”（二十格里十九格）；说明里的“差着十几米”
    expect(basis).toContain(`今天的平地北高南低，多数在 ${Math.round(at(todayPlain, 0.05))} 到 ${Math.round(at(todayPlain, 0.95))} 米之间`);
    const spread = at(todayPlain, 0.95) - at(todayPlain, 0.05);
    expect(recipe.note).toContain('今天的平地北高南低，差着十几米');
    expect(spread).toBeGreaterThan(11);
    expect(spread).toBeLessThan(19);
    const meanToday = (north: boolean): number => {
      let sum = 0;
      let count = 0;
      for (let k = 0; k < N; k += 7) {
        const [x, z] = cellAt(bare, k);
        if (x > 0 || (north ? z > -northM / 2 : z < southM / 2)) continue;
        const t = today(x, z);
        if (t < 400 || t >= recipe.plainBelowM) continue;
        sum += t;
        count++;
      }
      return sum / count;
    };
    expect(meanToday(true) - meanToday(false)).toBeGreaterThan(4);
    // “今天低于 412 米的地方垫高了，多数垫高不到一米，最多五米上下”（最多：二十格里十九格以内）
    expect(basis).toContain(`今天低于 ${recipe.plainBaseM} 米的地方垫高了，多数垫高不到一米，最多五米上下`);
    expect(at(low, 0.5)).toBeGreaterThan(0);
    expect(at(low, 0.5)).toBeLessThan(1);
    expect(at(low, 0.95)).toBeGreaterThan(4);
    expect(at(low, 0.95)).toBeLessThan(6);
    // “今天 412 到 426 米的地方压低了，多数压低五六米，最多 15 米”
    expect(basis).toContain(`今天 ${recipe.plainBaseM} 到 ${recipe.plainBelowM} 米的地方压低了，多数压低五六米，最多 ${Math.round(-at(high, 0))} 米`);
    expect(-at(high, 0.5)).toBeGreaterThan(5);
    expect(-at(high, 0.5)).toBeLessThan(6);
    // “整理以后的平地都在 410 到 412 米之间”（二十格里十九格）
    expect(basis).toContain(`整理以后的平地都在 ${Math.round(at(after, 0.05))} 到 ${Math.round(at(after, 0.95))} 米之间`);
    // “山坡矮了 7 到 16 米”（今天 426 到 442 米的格子，二十格里十九格）
    expect(basis).toContain(`山坡矮了 ${Math.round(-at(slopes, 0.95))} 到 ${Math.round(-at(slopes, 0.05))} 米`);
    // 两座有名字的山
    expect(basis).toContain(`蟆颐山在这张网格上最高读 ${Math.round(mayi.was)} 米，摆出来是 ${Math.round(mayi.now)} 米`);
    expect(basis).toContain(`老翁山从 ${Math.round(laoweng.was)} 米变成 ${Math.round(laoweng.now)} 米`);
    // 山没有变成平地：摆出来比水面高五十多米
    expect(mayi.now - normal).toBeGreaterThan(50);
    expect(laoweng.now - normal).toBeGreaterThan(50);

    // 三、沙盘边上：离边 edgeTaperM 以内，今天哪几边有山（比 hillAboveM 高），摆出来压到了多高
    const strips: Record<string, { was: number; now: number }> = { 西: { was: -Infinity, now: -Infinity }, 东: { was: -Infinity, now: -Infinity }, 北: { was: -Infinity, now: -Infinity }, 南: { was: -Infinity, now: -Infinity } };
    const EDGE_STRIP_M = 60;
    for (let k = 0; k < N; k++) {
      const [x, z] = cellAt(ground, k);
      const sides: string[] = [];
      if (x < -westM + EDGE_STRIP_M) sides.push('西');
      if (x > eastM - EDGE_STRIP_M) sides.push('东');
      if (z < -northM + EDGE_STRIP_M) sides.push('北');
      if (z > southM - EDGE_STRIP_M) sides.push('南');
      for (const side of sides) strips[side] = { was: Math.max(strips[side].was, today(x, z)), now: Math.max(strips[side].now, ground.h[k]) };
    }
    console.log(`眉州的四边（最外面 ${EDGE_STRIP_M} 米）：${Object.entries(strips).map(([side, s]) => `${side}边 今天最高 ${s.was.toFixed(1)}、摆出来 ${s.now.toFixed(1)}`).join('；')}`);
    const hilly = Object.entries(strips).filter(([, s]) => s.was > recipe.hillAboveM).map(([side]) => side);
    expect(basis).toContain(`伸到沙盘${hilly.join('边、')}边的山，在离边 ${taper} 米以内收低到平地`);
    for (const side of hilly) expect(strips[side].now, `${side}边摆出来`).toBeLessThan(recipe.plainBaseM + 6);

    // 四、别处依据里的几个数
    // 水位“比江边的平地低两米多”
    expect(scene.water.levels.basis).toContain('比江边的平地低两米多');
    expect(plainNear - normal).toBeGreaterThan(2);
    expect(plainNear - normal).toBeLessThan(3);
    // 平台“海拔 438 米上下，南北约 170 米、东西约 110 米”
    const bench = scene.terrain.edits.find((edit) => edit.id === 'temple-bench');
    if (!bench || bench.op !== 'level' || !bench.area) throw new Error('场景里没有道观脚下的平台');
    const ring = localRing(bench.area, coords);
    const spanX = Math.max(...ring.map((p) => p[0])) - Math.min(...ring.map((p) => p[0]));
    const spanZ = Math.max(...ring.map((p) => p[1])) - Math.min(...ring.map((p) => p[1]));
    expect(bench.basis).toContain(`海拔 ${bench.toM} 米上下，南北约 ${Math.round(spanZ / 10) * 10} 米、东西约 ${Math.round(spanX / 10) * 10} 米`);
    // 渡口：考证记录里“从东门到蟆颐山的直线同今天的河线相交”的那一点，在沙盘上的渡口东南约五百米
    const RECORD_FERRY: LngLat = [103.868, 30.0537];
    const [fx, fz] = place('ferry');
    const [rx, rz] = local(RECORD_FERRY);
    console.log(`眉州的渡口：记录里的那一点在它东边 ${(rx - fx).toFixed(0)} 米、南边 ${(rz - fz).toFixed(0)} 米，相距 ${Math.hypot(rx - fx, rz - fz).toFixed(0)} 米`);
    const ferry = scene.places.find((p) => p.id === 'ferry');
    expect(ferry?.basis).toContain('在沙盘上的渡口东南约五百米');
    expect(ferry?.basis).toContain('往北挪了三百多米');
    expect(ferry?.basis).toContain('往西挪了三百多米');
    expect(Math.round(Math.hypot(rx - fx, rz - fz) / 100)).toBe(5);
    expect(rx - fx).toBeGreaterThan(300);
    expect(rx - fx).toBeLessThan(400);
    expect(rz - fz).toBeGreaterThan(300);
    expect(rz - fz).toBeLessThan(400);
    // 墓：说明里“在蟆颐山的北偏东约七公里”
    const [gx, gz] = place('dongying');
    const [mx, mz] = place('mayishan');
    const bearing = (Math.atan2(gx - mx, -(gz - mz)) * 180) / Math.PI;
    expect(scene.places.find((p) => p.id === 'dongying')?.note).toContain('在蟆颐山的北偏东约七公里');
    expect(Math.round(Math.hypot(gx - mx, gz - mz) / 1000)).toBe(7);
    expect(bearing).toBeGreaterThan(5);
    expect(bearing).toBeLessThan(40);
  });

  it('工具做的两样（先画好的地面、定格图）还没有做：名字在“还没做出来”的表里', () => {
    // 这两样做好、放进 content/ 以后，把名字从表里拿掉，这一条跟着删（校验的规则 17、18 那时自己会查）
    expect(MADE_FILES_PENDING).toContain(KEY);
  });
});

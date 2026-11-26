// 全程沙盘的地面（src/stage/ground/route.ts）照真的场景文件和地形文件做出来对不对。
// 在 Node 里跑，不要浏览器。分两组：
//   “每一座”那一组：content/ 里有几座全程沙盘就查几座，查的是哪一座都该有的事（海是 0，四边收到零，抹成海的圈真的抹掉了陆地，山没有动……）；
//   “su-shi/route”那一组：苏轼这一座自己的数和地名（四个角、586 × 662、海岸的对照点、六处湖和河道、西边打散的边……）。
// 添一位人物，他的沙盘只进头一组；他自己的数另写一组、写上他的名字，不拿他的沙盘去对苏轼的数。
//
// 查的是 docs/data-spec.md“全程沙盘的场景数据”里说到地面的那几句：范围和网格；海是 0；抹成海的每一圈都真的抹掉了陆地，
// 该留的地方留着、该抹的地方抹了；平原抹过以后六处台阶不到 3 米，山没有动；“矮山多夸”的曲线；highTimes 和做出来的地面对得上；
// 留白的地方是平的。最后把写进 terrain.recipe.basis 的那几个数打印出来：那句话里的数只从这里抄。

import { describe, expect, it } from 'vitest';
import type { RouteScene } from '../../src/domain/scene';
import { curve, curveInverse, routeCoords } from '../../src/domain/sceneGeoRoute';
import type { LngLat } from '../../src/domain/types';
import { BLANK_KEEP, blankKeep, blankSoft, buildRouteGround, keepAt, plainSlope, readRouteDem, routeHeights, routeNormals, smoothPlain } from '../../src/stage/ground/route';
import type { BlankEdge, RouteHeights } from '../../src/stage/ground/route';
import { readToday } from '../content/routeRules';
import { readBytes } from '../support/readBytes';
import { realRouteScene, realSceneKeys } from './support/realScenes';
import { blankEdgeFor } from './support/styles';
import type { RealRouteScene } from './support/realScenes';

/** 定稿样张的投影（spikes/art-direction/route/scene/proj.js）算出来的四个角：西北、东北、西南、东南。 */
const TRIAL_CORNERS: LngLat[] = [
  [100.8996, 38.0138],
  [123.6004, 38.0138],
  [102.8977, 17.7229],
  [121.6023, 17.7229],
];

/**
 * 海岸改动的对照点（设计时照今天的海岸核过）：这些地方今天是陆地，当时也是，不能被抹掉；
 * 另一些今天是陆地，当时还是海，要抹掉。如东（掘港）正压在范公堤那条线上，留着。
 */
const STAYS_LAND: Record<string, LngLat> = {
  海州城: [119.16, 34.57], 云台山: [119.35, 34.65], 涟水: [119.26, 33.78], 阜宁西: [119.72, 33.78], 盐城西: [120.08, 33.38], 泰州: [119.91, 32.49],
  如皋: [120.56, 32.39], 通州: [120.86, 32.01], 上海老城: [121.49, 31.23], 松江: [121.22, 31.03], 嘉定: [121.26, 31.38], 太仓: [121.11, 31.45],
  余姚: [121.15, 30.04], 慈城: [121.45, 29.99], 宁波: [121.55, 29.87], 海盐: [120.94, 30.52], 利津: [118.24, 37.5], 滨州: [118.01, 37.43],
  宁海: [118.39, 37.56], 无棣: [117.62, 37.77], 广饶: [118.41, 37.05], 寿光: [118.74, 36.88], '如东（掘港）': [121.19, 32.31],
};
const BECOMES_SEA: Record<string, LngLat> = {
  射阳: [120.26, 33.77], 大丰: [120.46, 33.2], 滨海: [119.83, 34.0], 启东: [121.66, 31.81], 海门南: [121.18, 31.87], 崇明: [121.4, 31.62], 长兴岛: [121.72, 31.38],
  浦东机场: [121.8, 31.15], 南汇: [121.76, 31.0], 杭州湾新区: [121.3, 30.32], 东营: [118.67, 37.43], 垦利: [118.55, 37.59], 河口: [118.53, 37.89], 黄河口: [119.1, 37.76],
};

/** 平原上当时没有、今天有的六处形状：沿一条纬线或经线每 0.05 度取一个点，看相邻两点最多差几米。 */
const PROFILES: { name: string; along: 'lat' | 'lng'; fixed: number; from: number; to: number }[] = [
  { name: '洪泽湖（北纬 33.30 度，自西向东）', along: 'lat', fixed: 33.3, from: 118.1, to: 119.4 },
  { name: '洪泽湖（北纬 33.15 度，自西向东）', along: 'lat', fixed: 33.15, from: 118.3, to: 119.3 },
  { name: '骆马湖（北纬 34.08 度，自西向东）', along: 'lat', fixed: 34.08, from: 117.9, to: 118.5 },
  { name: '微山湖（北纬 34.60 度，自西向东）', along: 'lat', fixed: 34.6, from: 116.7, to: 117.6 },
  { name: '今天的黄河（开封，东经 114.35 度，自南向北）', along: 'lng', fixed: 114.35, from: 34.6, to: 35.2 },
  { name: '黄河旧道（砀山，东经 116.35 度，自南向北）', along: 'lng', fixed: 116.35, from: 34.2, to: 34.7 },
  { name: '黄河旧道（涟水，东经 119.20 度，自南向北）', along: 'lng', fixed: 119.2, from: 33.5, to: 34.0 },
];
/** 抹过以后，这几处相邻两点最多差几米。 */
const STEP_MAX_M = 3;

const todayTexts = import.meta.glob<string>('/content/figures/*/scenes/*.geojson', { query: '?raw', import: 'default', eager: true });

const insideRing = (p: LngLat, ring: LngLat[]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};

/** 最近的那个格点是第几格。 */
function cellOf(R: RealRouteScene, p: LngLat): number {
  const { nx, nz, cell, x0, z0 } = R.ground;
  const [x, z] = R.coords.toLocal(p);
  const i = Math.min(nx - 1, Math.max(0, Math.round((x - x0) / cell)));
  const j = Math.min(nz - 1, Math.max(0, Math.round((z - z0) / cell)));
  return j * nx + i;
}

/** 一点四周的四个格点各是第几格。 */
function cellsAround(R: RealRouteScene, p: LngLat): number[] {
  const { nx, nz, cell, x0, z0 } = R.ground;
  const [x, z] = R.coords.toLocal(p);
  const i = Math.min(nx - 2, Math.max(0, Math.floor((x - x0) / cell)));
  const j = Math.min(nz - 2, Math.max(0, Math.floor((z - z0) / cell)));
  return [j * nx + i, j * nx + i + 1, (j + 1) * nx + i, (j + 1) * nx + i + 1];
}

/** 一点离一圈线的边最近多少公里（在沙盘的投影里量）。 */
function kmToRing(R: RealRouteScene, p: LngLat, ring: LngLat[]): number {
  const [px, pz] = R.coords.toLocal(p);
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = R.coords.toLocal(ring[i]);
    const [bx, bz] = R.coords.toLocal(ring[(i + 1) % ring.length]);
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(px - ax - dx * t, pz - az - dz * t));
  }
  return (best * R.scene.frame.scale) / 1000;
}

/** 在一张网格上任意一点取数（格子之间按远近匀开）。 */
function sampler(R: RealRouteScene, field: Float32Array): (p: LngLat) => number {
  const { nx, nz, cell, x0, z0 } = R.ground;
  return (p) => {
    const [x, z] = R.coords.toLocal(p);
    const fx = Math.min(nx - 1.001, Math.max(0, (x - x0) / cell));
    const fz = Math.min(nz - 1.001, Math.max(0, (z - z0) / cell));
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const ax = fx - ix;
    const az = fz - iz;
    const k = iz * nx + ix;
    return field[k] * (1 - ax) * (1 - az) + field[k + 1] * ax * (1 - az) + field[k + nx] * (1 - ax) * az + field[k + nx + 1] * ax * az;
  };
}

/** 沿一条线每 0.05 度取一个点，相邻两点最多差几米。 */
function largestStep(at: (p: LngLat) => number, profile: (typeof PROFILES)[number]): number {
  let worst = 0;
  let before: number | null = null;
  for (let v = profile.from; v <= profile.to + 1e-9; v += 0.05) {
    const now = at(profile.along === 'lat' ? [v, profile.fixed] : [profile.fixed, v]);
    if (before !== null) worst = Math.max(worst, Math.abs(now - before));
    before = now;
  }
  return worst;
}

/** 第 1 到 4 步的结果，和只做到第 5 步（平原抹过）的海拔。一座沙盘只算一次。 */
const stagesOf = new Map<string, { before: RouteHeights; after: Float32Array; keep: Float32Array }>();
function stages(R: RealRouteScene): { before: RouteHeights; after: Float32Array; keep: Float32Array } {
  const have = stagesOf.get(R.key);
  if (have) return have;
  const before = routeHeights(R.scene, R.dem, R.coords);
  const { nx, nz, cell } = before.grid;
  const after = smoothPlain(before.h, before.land, R.scene.terrain.recipe, nx, nz, cell * R.scene.frame.scale);
  const made = { before, after, keep: blankKeep(R.scene, before, blankEdgeFor(R.scene.style)) };
  stagesOf.set(R.key, made);
  return made;
}

/** 海有多少格、离陆地两格以外的海有多少格、其中海拔或者高度不是 0 的有多少格。 */
function seaCounts(R: RealRouteScene): { sea: number; far: number; nonZero: number } {
  const { nx, nz, land, h, y } = R.ground;
  let sea = 0;
  let far = 0;
  let nonZero = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      if (land[k]) continue;
      sea++;
      let near = false;
      for (let dj = -2; dj <= 2 && !near; dj++) {
        for (let di = -2; di <= 2 && !near; di++) {
          const jj = j + dj;
          const ii = i + di;
          if (jj >= 0 && jj < nz && ii >= 0 && ii < nx && land[jj * nx + ii]) near = true;
        }
      }
      if (near) continue;
      far++;
      if (h[k] !== 0 || y[k] !== 0) nonZero++;
    }
  }
  return { sea, far, nonZero };
}

/** 最外面一圈格子：平原抹平以前是陆地的有多少格、海拔不是 0 的有多少格；抹平以后又高出 0 的有多少格、一共多高、最高多少。 */
function edgeCounts(R: RealRouteScene): { landOnEdge: number; notZero: number; lifted: number; highest: number; sum: number } {
  const { before } = stages(R);
  const { nx, nz, h, land } = R.ground;
  const found = { landOnEdge: 0, notZero: 0, lifted: 0, highest: 0, sum: 0 };
  const check = (k: number): void => {
    if (before.land[k]) found.landOnEdge++;
    if (before.h[k] !== 0) found.notZero++;
    if (land[k] && h[k] > 0) {
      found.lifted++;
      found.sum += h[k];
      found.highest = Math.max(found.highest, h[k]);
    }
  };
  for (let i = 0; i < nx; i++) {
    check(i);
    check((nz - 1) * nx + i);
  }
  for (let j = 1; j < nz - 1; j++) {
    check(j * nx);
    check(j * nx + nx - 1);
  }
  return found;
}

/**
 * 平原抹过以后，各样格子动了多少：海拔 highM 米以上的、midM 到 highM 米的、海。
 * 两个数由叫它的人给：哪两个数有意思是一座沙盘自己的事（苏轼的是 100 和 300），这里不替谁定。
 */
function movedBySmoothing(R: RealRouteScene, midM: number, highM: number): { high: number; highMoved: number; mid: number; midSum: number; midMax: number; seaMoved: number } {
  const { before, after } = stages(R);
  const found = { high: 0, highMoved: 0, mid: 0, midSum: 0, midMax: 0, seaMoved: 0 };
  for (let k = 0; k < after.length; k++) {
    const d = Math.abs(after[k] - before.h[k]);
    if (!before.land[k]) {
      if (d !== 0) found.seaMoved++;
      continue;
    }
    if (before.h[k] > highM) {
      found.high++;
      found.highMoved = Math.max(found.highMoved, d);
    } else if (before.h[k] > midM) {
      found.mid++;
      found.midSum += d;
      found.midMax = Math.max(found.midMax, d);
    }
  }
  return found;
}

/**
 * 平原抹过以后，照这一座沙盘自己写的办法分：算山地的格子（四周约 20 公里的平均海拔高过 recipe.hillAboveM，算平原的分量正好是 0）
 * 有多少、动得最多的动了多少米；海动了的有几格；海上算平原的分量不是 0 的有几格。
 * 另数两个只印不查的数：自己的海拔高过 hillAboveM 的陆地有多少格、其中动了的有几格（四周低的孤山算不算山地，看的是四周，不是它自己）。
 */
function mountainsAndSea(R: RealRouteScene): { mountain: number; mountainMoved: number; seaMoved: number; seaInPlain: number; above: number; aboveMoved: number } {
  const { before, after } = stages(R);
  const { nx, nz } = before.grid;
  const recipe = R.scene.terrain.recipe;
  const { k: plainShare } = plainSlope(before.h, before.land, recipe, nx, nz, before.grid.cell * R.scene.frame.scale);
  const found = { mountain: 0, mountainMoved: 0, seaMoved: 0, seaInPlain: 0, above: 0, aboveMoved: 0 };
  for (let k = 0; k < after.length; k++) {
    const d = Math.abs(after[k] - before.h[k]);
    if (!before.land[k]) {
      if (d !== 0) found.seaMoved++;
      if (plainShare[k] !== 0) found.seaInPlain++;
      continue;
    }
    if (plainShare[k] === 0) {
      found.mountain++;
      found.mountainMoved = Math.max(found.mountainMoved, d);
    }
    if (before.h[k] > recipe.hillAboveM) {
      found.above++;
      if (d !== 0) found.aboveMoved++;
    }
  }
  return found;
}

/** 留白：压到底的陆地有多少格、它们的坡加起来多少度；一点没有压的有多少格。 */
function blankCounts(R: RealRouteScene): { blank: number; sum: number; open: number } {
  const { keep } = stages(R);
  const { nx, nz, cell, y, land } = R.ground;
  let blank = 0;
  let sum = 0;
  let open = 0;
  for (let j = 1; j < nz - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i;
      if (keep[k] === 1) open++;
      if (!land[k] || keep[k] > BLANK_KEEP + 1e-6) continue;
      blank++;
      const gx = (y[k + 1] - y[k - 1]) / (2 * cell);
      const gz = (y[k + nx] - y[k - nx]) / (2 * cell);
      sum += (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
    }
  }
  return { blank, sum, open };
}

// ---------------------------------------------------------------- 每一座全程沙盘

describe.each(realSceneKeys('route'))('%s 的地面', (key) => {
  // 第一次要算整张地面（三十几万格，几遍抹平）：这台机器上一秒上下，流水线的机器慢一倍，给足时间
  it('网格：海拔、沙盘里的高度、陆地各一张，都是 nx × nz 格（这一座的范围和格数，写着名字的那一组查）', { timeout: 60_000 }, () => {
    const t0 = Date.now();
    const R = realRouteScene(key);
    console.log(`${key}：地面算了 ${Date.now() - t0} 毫秒`);
    const { nx, nz } = R.ground;
    console.log(`${key}：网格 ${nx} × ${nz}，一格在地上是 ${((R.ground.cell * R.scene.frame.scale) / 1000).toFixed(2)} 公里`);
    expect(nx).toBeGreaterThan(1);
    expect(nz).toBeGreaterThan(1);
    expect(R.ground.h.length).toBe(nx * nz);
    expect(R.ground.y.length).toBe(nx * nz);
    expect(R.ground.land.length).toBe(nx * nz);
  });

  it('同样的输入每次算出一样的地面；海拔、高度都是数，没有负的', { timeout: 60_000 }, () => {
    const R = realRouteScene(key);
    const again = routeHeights(R.scene, R.dem, R.coords);
    expect(again.h).toEqual(stages(R).before.h);
    for (let k = 0; k < R.ground.h.length; k++) {
      if (!(R.ground.h[k] >= 0) || !(R.ground.y[k] >= 0)) throw new Error(`第 ${k} 格：海拔 ${R.ground.h[k]}，沙盘里的高度 ${R.ground.y[k]}`);
    }
  });

  it('海：离陆地两格以外的海，海拔和沙盘里的高度正好是 0（这一座有多少陆地、多少海，写着名字的那一组查）', () => {
    const R = realRouteScene(key);
    const { nx, nz } = R.ground;
    const { sea, far, nonZero } = seaCounts(R);
    console.log(`${key}：陆地 ${nx * nz - sea} 格，海 ${sea} 格（离陆地两格以外的 ${far} 格）`);
    expect(nonZero).toBe(0);
  });

  it('陆地和海照地形文件分（四个格子里陆地占够一半才算陆地）：和“今天的海岸”那个文件逐格比，两头错开的差不多一样多，都不到陆地的百分之一', { timeout: 60_000 }, () => {
    const R = realRouteScene(key);
    const text = todayTexts[`/${R.todayPath}`];
    const today = readToday({ today: text }, 'today');
    if (!today || 'problem' in today) throw new Error(`${R.todayPath} 读不出来`);
    const rings = today.features
      .filter((feature) => feature.kind === 'land')
      .flatMap((feature) => feature.polygons.map((polygon) => polygon[0]))
      .map((ring) => {
        let w = Infinity;
        let e = -Infinity;
        let s = Infinity;
        let n = -Infinity;
        for (const [lng, lat] of ring) {
          w = Math.min(w, lng);
          e = Math.max(e, lng);
          s = Math.min(s, lat);
          n = Math.max(n, lat);
        }
        return { ring, w, e, s, n };
      });
    // 不带抹成海的圈：比的是“今天的陆地”
    const untouched = routeHeights({ ...R.scene, terrain: { ...R.scene.terrain, edits: [] } }, R.dem, R.coords);
    let land = 0;
    let onlyGround = 0;
    let onlyToday = 0;
    for (let k = 0; k < untouched.land.length; k++) {
      const p: LngLat = [untouched.lngLat[k * 2], untouched.lngLat[k * 2 + 1]];
      const isLand = rings.some((b) => p[0] >= b.w && p[0] <= b.e && p[1] >= b.s && p[1] <= b.n && insideRing(p, b.ring));
      if (untouched.land[k]) land++;
      if (untouched.land[k] && !isLand) onlyGround++;
      if (!untouched.land[k] && isLand) onlyToday++;
    }
    console.log(`${key}：陆地 ${land} 格；地面说是陆地、岸线说是海的 ${onlyGround} 格，反过来的 ${onlyToday} 格`);
    expect(onlyGround).toBeLessThan(land * 0.01);
    expect(onlyToday).toBeLessThan(land * 0.01);
    // 两头差不多：要是只要沾到一点陆地就算陆地，岸边会整整多出一圈
    expect(onlyGround).toBeLessThan(onlyToday * 2 + 50);
    expect(onlyToday).toBeLessThan(onlyGround * 2 + 50);
  });

  it('沙盘四边：往里 6 公里以内收到零——平原抹平以前，最外面一圈格子海拔正好是 0，陆地也一样（抹平以后边上又高出多少，打印出来）', () => {
    const R = realRouteScene(key);
    const { nx, nz } = R.ground;
    const { landOnEdge, notZero, lifted, highest, sum } = edgeCounts(R);
    // 做出来的地面上，边上的平原又被“平原抹成缓坡”那一步往缓坡上拉回去了一些：这是照设计的先后（先收边，后抹平）做出来的结果，量给人看
    console.log(`${key}：最外面一圈 ${2 * (nx + nz) - 4} 格里陆地 ${landOnEdge} 格；平原抹平以前海拔都是 0；抹平以后 ${lifted} 格高出 0，平均 ${(sum / Math.max(1, lifted)).toFixed(1)} 米，最高 ${highest.toFixed(1)} 米`);
    expect(notZero).toBe(0);
  });

  it('抹成海的每一圈都抹掉了今天的陆地（哪些地方该留、哪些该抹的对照点，写着名字的那一组查）', () => {
    const R = realRouteScene(key);
    const { before } = stages(R);
    const untouched = routeHeights({ ...R.scene, terrain: { ...R.scene.terrain, edits: [] } }, R.dem, R.coords);
    const cellKm2 = ((R.ground.cell * R.scene.frame.scale) / 1000) ** 2;
    const lines: string[] = [];
    for (const edit of R.scene.terrain.edits) {
      let taken = 0;
      for (let k = 0; k < untouched.land.length; k++) {
        if (untouched.land[k] && !before.land[k] && insideRing([before.lngLat[k * 2], before.lngLat[k * 2 + 1]], edit.area)) taken++;
      }
      lines.push(`  ${edit.name}（${edit.id}）：抹掉今天的陆地 ${taken} 格，约 ${Math.round(taken * cellKm2)} 平方公里`);
      expect(taken, `${edit.id} 一格陆地也没有抹掉`).toBeGreaterThan(0);
    }
    console.log(`${key} 抹成海的 ${R.scene.terrain.edits.length} 圈：\n${lines.join('\n')}`);
  });

  it('平原抹过以后：算山地的地方（四周约 20 公里的平均海拔高过场景里写的 hillAboveM）一米也没有动；海没有动；海不算平原（这一座多高以上的山有多少格、平原上抹掉了多少台阶，写着名字的那一组查）', () => {
    const R = realRouteScene(key);
    const recipe = R.scene.terrain.recipe;
    // 从多高起算山地，照这一座沙盘自己的 recipe 读，不在这里写一个数：平原高的地方（plainBelowM、hillAboveM 写得高）三四百米的台地也算平原，是要抹的
    const { mountain, mountainMoved, seaMoved, seaInPlain, above, aboveMoved } = mountainsAndSea(R);
    console.log(
      `${key}：算平原的是四周平均海拔 ${recipe.plainBelowM} 米以下，算山地的是 ${recipe.hillAboveM} 米以上；算山地的 ${mountain} 格，动得最多的 ${mountainMoved.toFixed(2)} 米；` +
        `自己的海拔高过 ${recipe.hillAboveM} 米的陆地 ${above} 格，其中动了的 ${aboveMoved} 格（只印不查）`,
    );
    expect(mountainMoved).toBe(0);
    expect(seaMoved).toBe(0);
    // 海不算平原：算平原的分量在海上是 0（不然海把岸边平原的缓坡往下拉）
    expect(seaInPlain).toBe(0);
  });

  it('“矮山多夸”的曲线：300 米是 7500，接得上，倒得回去；做出来的地面上最高的山夸大的倍数正好是 highTimes', () => {
    const R = realRouteScene(key);
    const relief = R.scene.frame.relief;
    expect(curve(relief, relief.lowBelowM)).toBeCloseTo(relief.lowBelowM * relief.lowTimes, 9);
    expect(curve({ ...relief, lowBelowM: 300, lowTimes: 25 }, 300)).toBe(7500);
    expect(curve(relief, relief.lowBelowM + 1e-6) - curve(relief, relief.lowBelowM - 1e-6)).toBeLessThan(1e-3);
    for (const m of [0, 1, 50, 299, 300, 301, 1000, 3000, 5000]) expect(curveInverse(relief, curve(relief, m))).toBeCloseTo(m, 6);

    let top = 0;
    let at = 0;
    for (let k = 0; k < R.ground.h.length; k++) {
      if (R.ground.h[k] > top) {
        top = R.ground.h[k];
        at = k;
      }
    }
    const { before } = stages(R);
    const times = curve(relief, top) / top;
    console.log(`${key}：做出来的地面上最高 ${top.toFixed(0)} 米（东经 ${before.lngLat[at * 2].toFixed(2)} 度、北纬 ${before.lngLat[at * 2 + 1].toFixed(2)} 度），夸大 ${times.toFixed(2)} 倍；场景里写的 highTimes 是 ${relief.highTimes}`);
    expect(Math.round(times)).toBe(relief.highTimes);
    // 沙盘里的高度就是曲线除以比例（留白的地方另压过）
    expect(R.ground.y[at]).toBeCloseTo(curve(relief, top) / R.scene.frame.scale, 3);
  });

  it('留白的地方是平的：陆地上的坡平均不到 0.6 度（没有留白的沙盘不查这一句）；地名点都不在留白里，地势一点没有压', () => {
    const R = realRouteScene(key);
    const { keep } = stages(R);
    const { blank, sum, open } = blankCounts(R);
    console.log(`${key}：留白的陆地 ${blank} 格，坡平均 ${(sum / Math.max(1, blank)).toFixed(3)} 度；一点没有压的 ${open} 格`);
    if (blank > 0) expect(sum / blank).toBeLessThan(0.6);
    // 各站都不在留白里；别的地名点也一样，地势一点没有压
    for (const place of R.scene.places.filter((p) => p.stops)) expect(keep[cellOf(R, place.at)], place.name).toBe(1);
    for (const place of R.scene.places) expect(keep[cellOf(R, place.at)], place.name).toBe(1);
  });

  it('法线图：每格四个字节，平地朝上，没有倒过来的', () => {
    const R = realRouteScene(key);
    const normals = routeNormals(R.ground);
    expect(normals.length).toBe(R.ground.nx * R.ground.nz * 4);
    let down = 0;
    for (let k = 0; k < normals.length; k += 4) if (normals[k + 1] < 128) down++;
    expect(down).toBe(0);
  });
});

// ---------------------------------------------------------------- 苏轼的这一座自己的数和地名

describe('su-shi/route 的地面：苏轼这一座自己的数和地名', () => {
  const key = 'su-shi/route';

  it('范围和网格：四个角和定稿的样张对得上（差不到 0.01 度）；网格是 586 × 662，一格在地上是 3.42 公里', { timeout: 60_000 }, () => {
    const R = realRouteScene(key);
    const { x0, x1, z0, z1 } = R.coords;
    const corners = [R.coords.toLngLat(x0, z0), R.coords.toLngLat(x1, z0), R.coords.toLngLat(x0, z1), R.coords.toLngLat(x1, z1)];
    corners.forEach((corner, i) => {
      expect(Math.abs(corner[0] - TRIAL_CORNERS[i][0]), `第 ${i + 1} 个角的经度 ${corner[0]}`).toBeLessThan(0.01);
      expect(Math.abs(corner[1] - TRIAL_CORNERS[i][1]), `第 ${i + 1} 个角的纬度 ${corner[1]}`).toBeLessThan(0.01);
    });
    expect([R.ground.nx, R.ground.nz]).toEqual([586, 662]);
    expect((R.ground.cell * R.scene.frame.scale) / 1000).toBeCloseTo(3.42, 6);
    expect(R.ground.h.length).toBe(586 * 662);
    expect(R.ground.y.length).toBe(586 * 662);
    expect(R.ground.land.length).toBe(586 * 662);
  });

  it('海：陆地和海都有——海五万格以上，陆地二十万格以上，离陆地两格以外的海四万格以上', { timeout: 60_000 }, () => {
    const R = realRouteScene(key);
    const { nx, nz } = R.ground;
    const { sea, far } = seaCounts(R);
    expect(sea).toBeGreaterThan(50_000);
    expect(nx * nz - sea).toBeGreaterThan(200_000);
    expect(far).toBeGreaterThan(40_000);
  });

  it('沙盘四边：最外面一圈格子里，平原抹平以前是陆地的有五百格以上（收到零的那一步在这一座上真的管着陆地）', { timeout: 60_000 }, () => {
    const R = realRouteScene(key);
    expect(edgeCounts(R).landOnEdge).toBeGreaterThan(500);
  });

  it('抹成海的圈：该留的二十三处留着，该抹的十四处抹了', { timeout: 60_000 }, () => {
    const R = realRouteScene(key);

    const wrong: string[] = [];
    for (const [name, p] of Object.entries(STAYS_LAND)) {
      if (R.scene.terrain.edits.some((edit) => insideRing(p, edit.area))) wrong.push(`${name} 落在抹成海的圈里`);
      if (!R.ground.land[cellOf(R, p)]) wrong.push(`${name} 在地面上成了海`);
    }
    const cellKm = (R.ground.cell * R.scene.frame.scale) / 1000;
    const nearEdge: string[] = [];
    for (const [name, p] of Object.entries(BECOMES_SEA)) {
      const rings = R.scene.terrain.edits.filter((edit) => insideRing(p, edit.area));
      if (rings.length === 0) {
        wrong.push(`${name} 不在任何一圈里`);
        continue;
      }
      // 离圈的边不到一格的：网格分不了这么细，它四周的四个格点里有海就算；离得远的，最近的格点必须是海
      const toEdge = Math.max(...rings.map((edit) => kmToRing(R, p, edit.area)));
      if (toEdge >= cellKm) {
        if (R.ground.land[cellOf(R, p)]) wrong.push(`${name} 在地面上还是陆地（离圈的边 ${toEdge.toFixed(1)} 公里）`);
      } else {
        nearEdge.push(`${name}（离圈的边 ${toEdge.toFixed(1)} 公里）`);
        if (cellsAround(R, p).every((k) => R.ground.land[k])) wrong.push(`${name} 四周的四个格点都还是陆地`);
      }
    }
    console.log(`${key}：要抹成海的对照点里，离圈的边不到一格（${cellKm.toFixed(2)} 公里）的：${nearEdge.join('、') || '没有'}`);
    expect(wrong).toEqual([]);
  });

  it('平原抹过以后：六处后来才有的形状，相邻两点差不到 3 米（打印抹以前和抹以后的数）', () => {
    const R = realRouteScene(key);
    const { before, after } = stages(R);
    const was = sampler(R, before.h);
    const now = sampler(R, after);
    const lines: string[] = [];
    const steep: string[] = [];
    for (const profile of PROFILES) {
      const a = largestStep(was, profile);
      const b = largestStep(now, profile);
      lines.push(`  ${profile.name}：抹以前最多差 ${a.toFixed(1)} 米，抹以后 ${b.toFixed(1)} 米`);
      if (!(b < STEP_MAX_M)) steep.push(`${profile.name}：抹以后还差 ${b.toFixed(1)} 米`);
    }
    console.log(`${key} 平原上的六处形状（每 0.05 度取一个点，相邻两点的海拔最多差多少）：\n${lines.join('\n')}`);
    expect(steep).toEqual([]);
  });

  it('平原抹过以后：海拔 300 米以上的山有五万格以上，一米也没有动；华北、黄淮、苏北的平地上和邻格差 3 米以上的比抹以前少；打印 100 到 300 米之间动了多少、平原上还剩多少处台阶', () => {
    const R = realRouteScene(key);
    const { before, after } = stages(R);
    const { nx, nz } = before.grid;
    // 100 米、300 米是苏轼这一座的数（他的 recipe：四周平均 100 米以下算平原，200 米以上算山地）
    const { high, highMoved, mid, midSum, midMax } = movedBySmoothing(R, 100, 300);
    // 平原上的台阶：华北、黄淮、苏北（东经 113 到 122 度，北纬 32 到 39 度）里海拔不到 60 米、四邻没有高过 80 米的、也不挨着海的格子，
    // 和东边、南边的邻格差 3 米以上的有几格
    const { slope } = plainSlope(before.h, before.land, R.scene.terrain.recipe, nx, nz, before.grid.cell * R.scene.frame.scale);
    /** 这一格比平原自己的缓坡高出或低下 15 米以上：是一座照原样留着的小山（rippleM 的头一个数就是 15）。 */
    const hill = (k: number): boolean => Math.abs(before.h[k] - slope[k]) >= R.scene.terrain.recipe.rippleM[0];
    let plain = 0;
    let stepsBefore = 0;
    let stepsAfter = 0;
    let stepsAtHills = 0;
    let worst = 0;
    let worstOpen = 0;
    for (let j = 1; j < nz - 1; j++) {
      for (let i = 1; i < nx - 1; i++) {
        const k = j * nx + i;
        const lng = before.lngLat[k * 2];
        const lat = before.lngLat[k * 2 + 1];
        if (lng < 113 || lng > 122 || lat < 32 || lat > 39) continue;
        const h = before.h;
        if (!before.land[k] || !(h[k] < 60)) continue;
        if (Math.max(h[k - 1], h[k + 1], h[k - nx], h[k + nx]) > 80) continue;
        if (!before.land[k - 1] || !before.land[k + 1] || !before.land[k - nx] || !before.land[k + nx]) continue;
        plain++;
        if (Math.max(Math.abs(h[k + 1] - h[k]), Math.abs(h[k + nx] - h[k])) > 3) stepsBefore++;
        const step = Math.max(Math.abs(after[k + 1] - after[k]), Math.abs(after[k + nx] - after[k]));
        if (step > 3) {
          stepsAfter++;
          if (hill(k) || hill(k + 1) || hill(k + nx)) stepsAtHills++;
          else worstOpen = Math.max(worstOpen, step);
        }
        worst = Math.max(worst, step);
      }
    }
    console.log(
      [
        `${key} 平原抹过以后：`,
        `  海拔 300 米以上的 ${high} 格，动得最多的 ${highMoved.toFixed(2)} 米`,
        `  海拔 100 到 300 米的 ${mid} 格，平均动了 ${(midSum / Math.max(1, mid)).toFixed(2)} 米，最多 ${midMax.toFixed(1)} 米`,
        `  华北、黄淮、苏北的平地 ${plain} 格：和邻格差 3 米以上的，抹以前 ${stepsBefore} 格，抹以后 ${stepsAfter} 格（最大的一处 ${worst.toFixed(1)} 米）；`,
        `    其中 ${stepsAtHills} 格挨着照原样留着的小山（比平原的缓坡高出 15 米以上），不挨着小山的 ${stepsAfter - stepsAtHills} 格，最大的一处 ${worstOpen.toFixed(1)} 米`,
      ].join('\n'),
    );
    expect(high).toBeGreaterThan(50_000);
    // 300 米以上的山一米也没有动。“每一座”那一组查的是照各自的 recipe 算山地的格子；300 米这个数只在这里，是苏轼这一座的
    expect(highMoved).toBe(0);
    expect(stepsAfter).toBeLessThan(stepsBefore);
  });

  it('留白的地方：留白的陆地一万格以上，坡平均不到 0.6 度；一点没有压的二十五万格以上', () => {
    const R = realRouteScene(key);
    const { blank, sum, open } = blankCounts(R);
    // 留白是哪些格子，照程序自己说的算（压到底的那些）。2026-11-20 西边的边打散以前：33574 格，坡平均 0.589 度，一点没有压的 313784 格
    console.log(`${key}：留白的陆地 ${blank} 格，坡平均 ${(sum / Math.max(1, blank)).toFixed(3)} 度；一点没有压的 ${open} 格（边打散以前是 33574 格、0.589 度、313784 格）`);
    expect(blank).toBeGreaterThan(10_000);
    expect(sum / blank).toBeLessThan(0.6);
    expect(open).toBeGreaterThan(250_000);
  });

  it('留白的边在西边是打散的：最西边的高原那条边前后挪动半度以上，是来回弯的；西南角那条边离场景里写的直线也有远有近', () => {
    const R = realRouteScene(key);
    const { keep, before } = stages(R);
    const { nx, nz } = R.ground;
    const flat = (k: number): boolean => keep[k] <= BLANK_KEEP + 1e-6;
    // 西边：每六行（约 20 公里）取一行，只取场景里写的那条经线（圈的东边）在这一行落在北纬 27.5 到 33.5 度之间的；
    // 这一行压到底的格子最东到哪条经线。来回几次：这条边从它自己的平均经线的一侧走到另一侧算一次
    const ringEast = Math.max(...R.scene.terrain.recipe.blank[1].map((p) => p[0]));
    const west: number[] = [];
    for (let j = 0; j < nz; j += 6) {
      let edge = NaN;
      let latAtRing = NaN;
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const lng = before.lngLat[k * 2];
        if (lng > 105.5) break;
        if (lng <= ringEast) latAtRing = before.lngLat[k * 2 + 1];
        if (flat(k)) edge = lng;
      }
      if (!Number.isNaN(edge) && latAtRing >= 27.5 && latAtRing <= 33.5) west.push(edge);
    }
    const westMean = west.reduce((a, b) => a + b, 0) / Math.max(1, west.length);
    let turns = 0;
    for (let r = 1; r < west.length; r++) if ((west[r] - westMean) * (west[r - 1] - westMean) < 0) turns++;
    const westRange = Math.max(...west) - Math.min(...west);
    // 西南角：东经 103.2 到 106 度之间（再往西是高原的那一圈），每一列从南往北，头一个没压到底的格子在哪条纬线，减掉场景里写的那条线在这条经线上的纬度
    const ring = R.scene.terrain.recipe.blank[0];
    const lineLat = (lng: number): number => {
      for (let s = 0; s + 1 < ring.length; s++) {
        const [a, b] = [ring[s], ring[s + 1]];
        if (lng >= a[0] && lng <= b[0] && b[0] > a[0]) return a[1] + ((b[1] - a[1]) * (lng - a[0])) / (b[0] - a[0]);
      }
      return NaN;
    };
    const south: number[] = [];
    for (let i = 0; i < nx; i++) {
      for (let j = nz - 1; j >= 0; j--) {
        const k = j * nx + i;
        const lng = before.lngLat[k * 2];
        if (lng < 103.2 || lng > 106) break;
        if (!flat(k)) {
          const off = before.lngLat[k * 2 + 1] - lineLat(lng);
          if (!Number.isNaN(off)) south.push(off);
          break;
        }
      }
    }
    const southRange = Math.max(...south) - Math.min(...south);
    console.log(
      `${key}：西边的边（北纬 27.5 到 33.5 度，每六行取一行，${west.length} 行）最东到东经 ${Math.max(...west).toFixed(2)} 度、最西到 ${Math.min(...west).toFixed(2)} 度，在自己的平均经线（东经 ${westMean.toFixed(2)} 度）两侧来回了 ${turns} 次；` +
        `西南角的边（${south.length} 列）比写的直线最多靠北 ${Math.max(...south).toFixed(2)} 度、最少 ${Math.min(...south).toFixed(2)} 度`,
    );
    expect(west.length).toBeGreaterThan(25);
    expect(westRange).toBeGreaterThan(0.5);
    // 一条斜着的直线只过自己的平均经线一次；过两次以上，才是来回弯的
    expect(turns).toBeGreaterThanOrEqual(2);
    expect(south.length).toBeGreaterThan(60);
    expect(southRange).toBeGreaterThan(0.3);
    // 眉州以东不动：最东也到不了东经 103 度
    expect(Math.max(...west)).toBeLessThan(103);
  });

  it('法线图：远海的一格（东经 121.5 度、北纬 21.0 度）正好朝上', () => {
    const R = realRouteScene(key);
    const normals = routeNormals(R.ground);
    const k = cellOf(R, [121.5, 21.0]) * 4;
    expect([normals[k], normals[k + 1], normals[k + 2], normals[k + 3]]).toEqual([128, 255, 128, 255]);
  });
});

// 留白的边打不打散是样式的事（BlankEdge.torn）：不写就不打散。content/ 里现在每一座全程沙盘的样式都写了打散，
// “不打散”的那一条路在这里用一种编出来的样式走一遍：只写抹开多宽、不写 torn。场景是校验用的那一份样本（一圈留白在西南角）。
describe('另一种样式不打散留白的边（编出来的样式，只写抹开多宽）：圈是怎么写的，边就照它抹开', () => {
  const FIXTURE = 'tests/content/fixtures/good/figures/demo/scenes/';
  const scene = JSON.parse(new TextDecoder().decode(readBytes(`${FIXTURE}route.json`))) as RouteScene;
  const coords = routeCoords(scene.frame);
  const dem = readRouteDem(scene.terrain, readBytes(`${FIXTURE}${scene.terrain.file}`));
  const heights = routeHeights(scene, dem, coords);
  /** 编出来的样式的边：抹开两格，不打散。 */
  const plain: BlankEdge = { blurM: 2 * heights.grid.cell * scene.frame.scale };
  /** 同样宽，写了打散，可打散的那条经线在整座沙盘的西边：一格也轮不到。 */
  const tornNowhere: BlankEdge = { ...plain, torn: { westOf: [-179, -178], eastDeg: 0.4, westDeg: 0.6, latDeg: 0.6, again: 0.45, valleyWestOf: [-179, -178] } };
  /** 同样宽，写了打散，那条经线在整座沙盘的东边：每一格都打散。 */
  const tornEverywhere: BlankEdge = { ...plain, torn: { westOf: [178, 179], eastDeg: 0.4, westDeg: 0.6, latDeg: 0.6, again: 0.45, valleyWestOf: [178, 179] } };

  it('不写 torn：每一格是 0 到 1 之间的数，圈里面深处压到底、离得远的一点不压，过渡的格子也有；同样的输入算出同样的数', () => {
    expect(scene.terrain.recipe.blank.length).toBeGreaterThan(0);
    const soft = blankSoft(scene, heights, plain);
    expect(soft).toHaveLength(heights.grid.nx * heights.grid.nz);
    let deep = 0;
    let open = 0;
    let between = 0;
    for (const s of soft) {
      expect(Number.isFinite(s) && s >= 0 && s <= 1).toBe(true);
      if (s < 0.02) deep++;
      else if (s > 0.98) open++;
      else between++;
    }
    console.log(`样本上不打散的留白：压到底的 ${deep} 格，一点不压的 ${open} 格，过渡的 ${between} 格（一共 ${soft.length} 格）`);
    expect(deep).toBeGreaterThan(0);
    expect(open).toBeGreaterThan(deep);
    expect(between).toBeGreaterThan(0);
    expect(blankSoft(scene, heights, plain)).toEqual(soft);
  });

  it('不写 torn 和“写了、可一格也轮不到”算出来一格不差；和“每一格都打散”的不一样（打散的那几句真的管着边）', () => {
    const soft = blankSoft(scene, heights, plain);
    expect(blankSoft(scene, heights, tornNowhere)).toEqual(soft);
    const torn = blankSoft(scene, heights, tornEverywhere);
    let differ = 0;
    for (let k = 0; k < soft.length; k++) if (torn[k] !== soft[k]) differ++;
    expect(differ).toBeGreaterThan(0);
  });

  it('造地面、算高度留多少，交一份不写 torn 的边照样做得出：留白那一张就是上面那一份，高度留多少是它过一遍 keepAt', () => {
    const soft = blankSoft(scene, heights, plain);
    const ground = buildRouteGround(scene, dem, coords, plain);
    expect(ground.blank).toEqual(soft);
    const keep = blankKeep(scene, heights, plain);
    expect(keep).toEqual(soft.map(keepAt));
    // 压到底的地方高度只留 BLANK_KEEP 那么多
    expect(keep.reduce((least, value) => Math.min(least, value), 1)).toBeCloseTo(BLANK_KEEP, 6);
  });
});

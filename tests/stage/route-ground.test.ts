// 全程沙盘的地面（src/stage/ground/route.ts）照真的场景文件和地形文件做出来对不对。
// 在 Node 里跑，不要浏览器。content/ 里有几座全程沙盘就查几座（现在只有苏轼的）。
//
// 查的是 docs/data-spec.md“全程沙盘的场景数据”里说到地面的那几句：范围和网格；海是 0；抹成海的每一圈都真的抹掉了陆地，
// 该留的地方留着、该抹的地方抹了；平原抹过以后六处台阶不到 3 米，山没有动；“矮山多夸”的曲线；highTimes 和做出来的地面对得上；
// 留白的地方是平的。最后把写进 terrain.recipe.basis 的那几个数打印出来：那句话里的数只从这里抄。

import { describe, expect, it } from 'vitest';
import { curve, curveInverse } from '../../src/domain/sceneGeoRoute';
import type { LngLat } from '../../src/domain/types';
import { BLANK_KEEP, blankKeep, plainSlope, routeHeights, routeNormals, smoothPlain } from '../../src/stage/ground/route';
import type { RouteHeights } from '../../src/stage/ground/route';
import { readToday } from '../content/routeRules';
import { realRouteScene, realSceneKeys } from './support/realScenes';
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
  const made = { before, after, keep: blankKeep(R.scene, before) };
  stagesOf.set(R.key, made);
  return made;
}

describe.each(realSceneKeys('route'))('%s 的地面', (key) => {
  // 第一次要算整张地面（三十几万格，几遍抹平）：这台机器上一秒上下，流水线的机器慢一倍，给足时间
  it('范围和网格：四个角和定稿的样张对得上（差不到 0.01 度）；网格是 586 × 662，一格在地上是 3.42 公里', { timeout: 60_000 }, () => {
    const t0 = Date.now();
    const R = realRouteScene(key);
    console.log(`${key}：地面算了 ${Date.now() - t0} 毫秒`);
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

  it('同样的输入每次算出一样的地面；海拔、高度都是数，没有负的', { timeout: 60_000 }, () => {
    const R = realRouteScene(key);
    const again = routeHeights(R.scene, R.dem, R.coords);
    expect(again.h).toEqual(stages(R).before.h);
    for (let k = 0; k < R.ground.h.length; k++) {
      if (!(R.ground.h[k] >= 0) || !(R.ground.y[k] >= 0)) throw new Error(`第 ${k} 格：海拔 ${R.ground.h[k]}，沙盘里的高度 ${R.ground.y[k]}`);
    }
  });

  it('海：离陆地两格以外的海，海拔和沙盘里的高度正好是 0；陆地和海都有', () => {
    const R = realRouteScene(key);
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
    console.log(`${key}：陆地 ${nx * nz - sea} 格，海 ${sea} 格（离陆地两格以外的 ${far} 格）`);
    expect(sea).toBeGreaterThan(50_000);
    expect(nx * nz - sea).toBeGreaterThan(200_000);
    expect(far).toBeGreaterThan(40_000);
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
    const { before } = stages(R);
    const { nx, nz, h, land } = R.ground;
    let landOnEdge = 0;
    let notZero = 0;
    let lifted = 0;
    let highest = 0;
    let sum = 0;
    const check = (k: number): void => {
      if (before.land[k]) landOnEdge++;
      if (before.h[k] !== 0) notZero++;
      if (land[k] && h[k] > 0) {
        lifted++;
        sum += h[k];
        highest = Math.max(highest, h[k]);
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
    // 做出来的地面上，边上的平原又被“平原抹成缓坡”那一步往缓坡上拉回去了一些：这是照设计的先后（先收边，后抹平）做出来的结果，量给人看
    console.log(`${key}：最外面一圈 ${2 * (nx + nz) - 4} 格里陆地 ${landOnEdge} 格；平原抹平以前海拔都是 0；抹平以后 ${lifted} 格高出 0，平均 ${(sum / Math.max(1, lifted)).toFixed(1)} 米，最高 ${highest.toFixed(1)} 米`);
    expect(landOnEdge).toBeGreaterThan(500);
    expect(notZero).toBe(0);
  });

  it('抹成海的每一圈都抹掉了今天的陆地；该留的二十三处留着，该抹的十四处抹了', () => {
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
    console.log(`${key} 抹成海的六圈：\n${lines.join('\n')}`);

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

  it('平原抹过以后：海拔 300 米以上的山一米也没有动；海没有动；打印 100 到 300 米之间动了多少、平原上还剩多少处台阶', () => {
    const R = realRouteScene(key);
    const { before, after } = stages(R);
    const { nx, nz } = before.grid;
    let high = 0;
    let highMoved = 0;
    let mid = 0;
    let midSum = 0;
    let midMax = 0;
    let seaMoved = 0;
    for (let k = 0; k < after.length; k++) {
      const d = Math.abs(after[k] - before.h[k]);
      if (!before.land[k]) {
        if (d !== 0) seaMoved++;
        continue;
      }
      if (before.h[k] > 300) {
        high++;
        highMoved = Math.max(highMoved, d);
      } else if (before.h[k] > 100) {
        mid++;
        midSum += d;
        midMax = Math.max(midMax, d);
      }
    }
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
    expect(highMoved).toBe(0);
    expect(seaMoved).toBe(0);
    // 海不算平原：算平原的分量在海上是 0（不然海把岸边平原的缓坡往下拉）
    const { k: plainShare } = plainSlope(before.h, before.land, R.scene.terrain.recipe, nx, nz, before.grid.cell * R.scene.frame.scale);
    let seaInPlain = 0;
    for (let k = 0; k < plainShare.length; k++) if (!before.land[k] && plainShare[k] !== 0) seaInPlain++;
    expect(seaInPlain).toBe(0);
    expect(stepsAfter).toBeLessThan(stepsBefore);
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

  it('留白的地方是平的：陆地上的坡平均不到 0.6 度；不留白的地方没有压', () => {
    const R = realRouteScene(key);
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
    console.log(`${key}：留白的陆地 ${blank} 格，坡平均 ${(sum / Math.max(1, blank)).toFixed(3)} 度；一点没有压的 ${open} 格`);
    expect(blank).toBeGreaterThan(10_000);
    expect(sum / blank).toBeLessThan(0.6);
    expect(open).toBeGreaterThan(250_000);
    // 八站都不在留白里
    for (const place of R.scene.places.filter((p) => p.stops)) expect(keep[cellOf(R, place.at)], place.name).toBe(1);
  });

  it('法线图：每格四个字节，平地朝上，没有倒过来的', () => {
    const R = realRouteScene(key);
    const normals = routeNormals(R.ground);
    expect(normals.length).toBe(R.ground.nx * R.ground.nz * 4);
    let down = 0;
    for (let k = 0; k < normals.length; k += 4) if (normals[k + 1] < 128) down++;
    expect(down).toBe(0);
    // 远海的一格：正好朝上
    const k = cellOf(R, [121.5, 21.0]) * 4;
    expect([normals[k], normals[k + 1], normals[k + 2], normals[k + 3]]).toEqual([128, 255, 128, 255]);
  });
});

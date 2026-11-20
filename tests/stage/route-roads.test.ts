// 全程沙盘的路（roads.ways）写得对不对：照真的场景文件和“今天的海岸、湖、河”查。在 Node 里跑，不要浏览器。
// 校验（规则 13）管的是路连不连得上、有没有人走；这里管的是路落在哪：
//   1 路不从海里过（今天的陆地外面，或者抹成海的圈里面），走海路的（by 是 sea）除外；
//   2 路不从湖里、只染水色的水里过；沿着这个湖走的路（along 写的是它）除外；
//   3 沿着一条河走的路（along 写的是它），线上每一点离这条河不超过 15 公里，又不贴到 2 公里以内。
// 沿线每 2 公里取一个点来查。河可以过（扬州到润州过大江），不算。
//
// 第 3 条现在只量、只打印，还不算数（BANK_LINES_IN 是 false）。现在路上的线是把考证记录里的地方直着连起来的：
// 两个地方之间它会离开弯弯曲曲的河（戎州到渝州最远 31 公里），和河的线重在一起的地方又是 0 公里，这一条不可能过。
// 走水路的那几条换成贴着河岸走的线（npm run route:bank）以后，把 BANK_LINES_IN 改成 true。
// 那时还要定一件事：有三条路的一头是不在这条河边的城（陈州离颍水 22 公里；广州离北江、东江的线各四十多公里，它在珠江上），
// 是把路在河口分开，还是两头的城不算。现在把每条路“写的地方离河最远多少”和“沿线最远、最近多少”都打印出来。
// 拐角抹圆以后离写的线不超过 3 公里那一条，等画路的程序（抹圆的算法在它里面）有了再添。

import { describe, expect, it } from 'vitest';
import type { RouteScene } from '../../src/domain/scene';
import type { FrameCoords } from '../../src/domain/sceneGeo';
import type { LngLat } from '../../src/domain/types';
import { pickedLakes, pickedLines, readToday } from '../content/routeRules';
import type { TodayFeature } from '../content/routeRules';
import { realRouteScene, realSceneKeys } from './support/realScenes';
import type { RealRouteScene } from './support/realScenes';

/** 走水路的那几条路是不是已经换成了贴着河岸走的线。 */
const BANK_LINES_IN = false;
/** 沿线每隔多少公里取一个点。 */
const STEP_KM = 2;
/** 沿着河走的路，离这条河最远多少公里。 */
const ALONG_MAX_KM = 15;
/** 贴岸的线离河的中线最近多少公里（换成贴岸的线以后才查）。 */
const ALONG_MIN_KM = 2;

const texts = import.meta.glob<string>('/content/figures/*/scenes/*.geojson', { query: '?raw', import: 'default', eager: true });

function todayOf(R: RealRouteScene): TodayFeature[] {
  const text = texts[`/${R.todayPath}`];
  if (text === undefined) throw new Error(`没有 ${R.todayPath}`);
  const today = readToday({ today: text }, 'today');
  if (!today || 'problem' in today) throw new Error(`${R.todayPath} 读不出来`);
  return today.features;
}

const insideRing = (p: LngLat, ring: LngLat[]): boolean => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};
const insidePolygon = (p: LngLat, polygon: LngLat[][]): boolean => insideRing(p, polygon[0]) && !polygon.slice(1).some((hole) => insideRing(p, hole));

interface Boxed {
  polygon: LngLat[][];
  box: [number, number, number, number];
}
function boxed(polygon: LngLat[][]): Boxed {
  let w = Infinity;
  let e = -Infinity;
  let s = Infinity;
  let n = -Infinity;
  for (const [lng, lat] of polygon[0]) {
    w = Math.min(w, lng);
    e = Math.max(e, lng);
    s = Math.min(s, lat);
    n = Math.max(n, lat);
  }
  return { polygon, box: [w, e, s, n] };
}
const inAny = (p: LngLat, list: Boxed[]): boolean => list.some(({ polygon, box }) => p[0] >= box[0] && p[0] <= box[1] && p[1] >= box[2] && p[1] <= box[3] && insidePolygon(p, polygon));

/** 沿一条线每 STEP_KM 公里取一个点（两头也取）：经纬度，和它是从头量起的第几公里。 */
function along(scene: RouteScene, coords: FrameCoords, line: LngLat[]): { at: LngLat; km: number }[] {
  const out: { at: LngLat; km: number }[] = [];
  let walked = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = coords.toLocal(line[i - 1]);
    const [bx, bz] = coords.toLocal(line[i]);
    const km = (Math.hypot(bx - ax, bz - az) * scene.frame.scale) / 1000;
    const steps = Math.max(1, Math.ceil(km / STEP_KM));
    for (let s = i === 1 ? 0 : 1; s <= steps; s++) {
      const t = s / steps;
      out.push({ at: coords.toLngLat(ax + (bx - ax) * t, az + (bz - az) * t), km: walked + km * t });
    }
    walked += km;
  }
  return out;
}

/** 一点离几条线最近多少公里（在沙盘的投影里量）。 */
function kmToLines(scene: RouteScene, coords: FrameCoords, p: LngLat, lines: LngLat[][]): number {
  const [px, pz] = coords.toLocal(p);
  let best = Infinity;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const [ax, az] = coords.toLocal(line[i - 1]);
      const [bx, bz] = coords.toLocal(line[i]);
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
      best = Math.min(best, Math.hypot(px - ax - dx * t, pz - az - dz * t));
    }
  }
  return (best * scene.frame.scale) / 1000;
}

describe.each(realSceneKeys('route'))('%s 的路', (key) => {
  it('路不从海里过（走海路的除外）：沿线每 2 公里一个点，都在今天的陆地上，不在抹成海的圈里', () => {
    const R = realRouteScene(key);
    const land = todayOf(R)
      .filter((feature) => feature.kind === 'land')
      .flatMap((feature) => feature.polygons.map(boxed));
    const seas = R.scene.terrain.edits.map((edit) => boxed([edit.area]));
    const wet: string[] = [];
    let checked = 0;
    for (const way of R.scene.roads.ways) {
      if (way.by === 'sea') continue;
      const points = along(R.scene, R.coords, way.line);
      checked += points.length;
      const off = points.filter(({ at }) => !inAny(at, land) || inAny(at, seas));
      if (off.length > 0) wet.push(`${way.id}：${off.length} 个点在海里，从第 ${off[0].km.toFixed(0)} 公里（东经 ${off[0].at[0].toFixed(2)}、北纬 ${off[0].at[1].toFixed(2)}）起`);
    }
    console.log(`${key}：不走海路的 ${R.scene.roads.ways.filter((way) => way.by !== 'sea').length} 条路，沿线查了 ${checked} 个点`);
    expect(wet).toEqual([]);
    // 走海路的那一条真的过海：不然 by 写错了
    for (const way of R.scene.roads.ways.filter((item) => item.by === 'sea')) {
      const points = along(R.scene, R.coords, way.line);
      expect(points.some(({ at }) => !inAny(at, land)), `${way.id} 写的是海路，沿线却没有一个点在海里`).toBe(true);
    }
  });

  it('路不从湖里、只染水色的水里过；沿着这个湖走的路除外', () => {
    const R = realRouteScene(key);
    const features = todayOf(R);
    const waters: { id: string; name: string; areas: Boxed[]; except?: LngLat[] }[] = [
      ...R.scene.water.lakes.map((lake) => ({ id: lake.id, name: lake.name, areas: pickedLakes(features, lake.today).map(boxed), except: lake.except?.area })),
      ...R.scene.water.washes.map((wash) => ({ id: wash.id, name: wash.name, areas: wash.areas.map((ring) => boxed([ring])) })),
    ];
    const wet: string[] = [];
    for (const way of R.scene.roads.ways) {
      const points = along(R.scene, R.coords, way.line);
      for (const water of waters) {
        if (way.along === water.id) continue;
        const inside = points.filter(({ at }) => inAny(at, water.areas) && !(water.except && insideRing(at, water.except)));
        if (inside.length > 0) wet.push(`${way.id} 从${water.name}（${water.id}）里过：${inside.length} 个点，从第 ${inside[0].km.toFixed(0)} 公里（东经 ${inside[0].at[0].toFixed(2)}、北纬 ${inside[0].at[1].toFixed(2)}）起`);
      }
    }
    expect(wet).toEqual([]);
  });

  it('沿着一条河走的路：每条路离它的河多远，量出来打印；换成贴岸的线以后才算数（线上每一点 2 到 15 公里）', () => {
    const R = realRouteScene(key);
    const features = todayOf(R);
    const lines: string[] = [];
    const loose: string[] = [];
    for (const way of R.scene.roads.ways) {
      if (!way.along) continue;
      const river = R.scene.water.rivers.find((item) => item.id === way.along);
      // along 写的是湖的不在这一条里（上一条管它）
      if (!river) continue;
      const centre = river.line ? [river.line] : pickedLines(features, river.today ?? []);
      const written = way.line.map((p) => kmToLines(R.scene, R.coords, p, centre));
      const sampled = along(R.scene, R.coords, way.line).map(({ at }) => kmToLines(R.scene, R.coords, at, centre));
      const worstWritten = Math.max(...written);
      const worstSampled = Math.max(...sampled);
      lines.push(`  ${way.id} 沿 ${river.name}（${river.id}）：写的 ${way.line.length} 个地方离河最远 ${worstWritten.toFixed(1)} 公里；沿线最远 ${worstSampled.toFixed(1)} 公里，最近 ${Math.min(...sampled).toFixed(1)} 公里`);
      // 这条河在场景里有线可量：不然上面的数都是无穷大
      expect(Number.isFinite(worstSampled), `${way.id} 沿着的 ${river.id} 没有线`).toBe(true);
      if (worstSampled > ALONG_MAX_KM || Math.min(...sampled) < ALONG_MIN_KM) loose.push(way.id);
    }
    console.log(`${key} 沿着河走的路：\n${lines.join('\n')}\n  线上有的点离河超过 ${ALONG_MAX_KM} 公里、或者不到 ${ALONG_MIN_KM} 公里的（换成贴岸的线以前是这样）：${loose.join('、') || '没有'}`);
    expect(lines.length).toBeGreaterThan(0);
    if (BANK_LINES_IN) expect(loose).toEqual([]);
  });

  it('每条路都有两头以上的点，写的 by 是三种之一；沿着的河、湖在场景里；一共多少公里（打印出来）', () => {
    const R = realRouteScene(key);
    let total = 0;
    for (const way of R.scene.roads.ways) {
      expect(way.line.length).toBeGreaterThanOrEqual(2);
      const points = along(R.scene, R.coords, way.line);
      total += points[points.length - 1].km;
    }
    console.log(`${key}：${R.scene.roads.ways.length} 条路，沿线一共 ${Math.round(total)} 公里；${R.scene.roads.journeys.length} 趟，${R.scene.roads.journeys.reduce((n, journey) => n + journey.parts.length, 0)} 截`);
    expect(total).toBeGreaterThan(5000);
  });
});

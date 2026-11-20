// 全程沙盘的路（roads.ways）写得对不对：照真的场景文件和“今天的海岸、湖、河”查。在 Node 里跑，不要浏览器。
// 校验（规则 13）管的是路连不连得上、有没有人走；这里管的是路落在哪：
//   1 路不从海里过（今天的陆地外面，或者抹成海的圈里面），走海路的（by 是 sea）除外；
//   2 路不从湖里、只染水色的水里过；沿着这个湖走的路（along 写的是它）除外；
//   3 沿着一条河走的路（along 写的是它），线上每一点离这条河不超过 15 公里，又不贴到 2 公里以内。
// 沿线每 2 公里取一个点来查。河可以过（扬州到润州过大江），不算。
//
// 第 3 条量的是画在地面上的那条河（tests/tools/route/paint.ts 的 riverPaths：自己写的河是抹顺以后的线，不是直着连的）。
// 走水路的路是贴着河岸走的线（npm run route:bank 做出来、贴进场景文件的），所以这一条算数。定下来不查的只有三样：
//   甲 路的两头各 34 公里（路短的是全长的三成）以内不查“不贴到 2 公里以内”：路的两头是城，城在河边上，线要收回到城里
//     （这两个数是做岸线的工具的，从它那里取）。“不超过 15 公里”照查。
//   乙 有三条路的一头是不在这条河边上的城：陈州离颍水二十多公里（w-ying 的头），广州离北江、东江的线各四十多公里
//     （w-bei 的尾、w-dong 的头；它在珠江上）。从城到线上头一个离河不到 15 公里的点，这一截两样都不查——
//     它得是直着连过去的一截（不超过这条路写的头一段或者末一段的长），量出来打印。这一头没有收回的一截，所以也没有“甲”。
//   丙 大江以南的两段运河（w-canal-s1、w-canal-s2）定了不做岸线，照直线画，就压在运河的线上：只查“不超过 15 公里”。
// 每条路量到的数都打印出来。
// 拐角抹圆以后离写的线不超过 3 公里那一条，在 tests/unit/road-lines.test.ts（抹圆的算法在 src/stage/roadLines.ts）。

import { describe, expect, it } from 'vitest';
import type { RouteScene } from '../../src/domain/scene';
import type { FrameCoords } from '../../src/domain/sceneGeo';
import type { LngLat } from '../../src/domain/types';
import { styleFor } from '../../src/stage/three/style';
import { pickedLakes, readToday } from '../content/routeRules';
import type { TodayFeature } from '../content/routeRules';
import { BANK_TAPER_KM, BANK_TAPER_SHARE } from '../tools/route/bankTool';
import { riverPaths } from '../tools/route/paint';
import { realRouteScene, realSceneKeys } from './support/realScenes';
import type { RealRouteScene } from './support/realScenes';

/** 走水路的那几条路是不是已经换成了贴着河岸走的线。换了，第 3 条才算数。 */
const BANK_LINES_IN = true;
/** 沿线每隔多少公里取一个点。 */
const STEP_KM = 2;
/** 沿着河走的路，离这条河最远多少公里。 */
const ALONG_MAX_KM = 15;
/** 贴岸的线离河的中线最近多少公里（换成贴岸的线以后才查）。 */
const ALONG_MIN_KM = 2;
/** 一头是不在这条河边上的城的路，和是哪一头（上面的“乙”）。 */
const TOWN_OFF_RIVER: Record<string, 'first' | 'last'> = { 'w-ying': 'first', 'w-bei': 'last', 'w-dong': 'first' };
/** 定了不做岸线、照直线画的路（上面的“丙”）。 */
const STRAIGHT_ON_CANAL = ['w-canal-s1', 'w-canal-s2'];

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

/** 一点离画在地面上的几条线最近多少公里。lines 是沙盘里的米（riverPaths 给的）。 */
function kmToPainted(scene: RouteScene, coords: FrameCoords, p: LngLat, lines: [number, number][][]): number {
  const [px, pz] = coords.toLocal(p);
  let best = Infinity;
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const [ax, az] = line[i - 1];
      const dx = line[i][0] - ax;
      const dz = line[i][1] - az;
      const t = Math.min(1, Math.max(0, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
      best = Math.min(best, Math.hypot(px - ax - dx * t, pz - az - dz * t));
    }
  }
  return (best * scene.frame.scale) / 1000;
}

/** 两点之间多少公里（在沙盘的投影里量）。 */
function segmentKm(scene: RouteScene, coords: FrameCoords, a: LngLat, b: LngLat): number {
  const [ax, az] = coords.toLocal(a);
  const [bx, bz] = coords.toLocal(b);
  return (Math.hypot(bx - ax, bz - az) * scene.frame.scale) / 1000;
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

  it('沿着一条河走的路：线上每一点离它的河 2 到 15 公里（两头收回到城里的一截、三座不在河边的城、大江以南的两段运河另算），量出来打印', () => {
    const R = realRouteScene(key);
    const features = todayOf(R);
    const paths = riverPaths(R.scene, features, R.coords, styleFor(R.scene.style));
    const lines: string[] = [];
    const loose: string[] = [];
    const listed = new Set<string>();
    for (const way of R.scene.roads.ways) {
      if (!way.along) continue;
      // along 写的是湖的不在这一条里（上一条管它）
      const river = paths.find((item) => item.id === way.along);
      if (!river) continue;
      const points = along(R.scene, R.coords, way.line);
      const total = points[points.length - 1].km;
      const from = points.map(({ at }) => kmToPainted(R.scene, R.coords, at, river.lines));
      // 这条河在场景里有线可量：不然下面的数都是无穷大
      expect(Number.isFinite(Math.max(...from)), `${way.id} 沿着的 ${river.id} 没有线`).toBe(true);

      // 乙：从城到头一个离河不到 15 公里的点，不查
      const end = TOWN_OFF_RIVER[way.id];
      let first = 0;
      let last = points.length - 1;
      let leftOut = 0;
      if (end === 'first') {
        while (first < last && from[first] > ALONG_MAX_KM) first++;
        leftOut = points[first].km;
        const straightKm = segmentKm(R.scene, R.coords, way.line[0], way.line[1]);
        expect(leftOut, `${way.id} 从城到河边不查的一截有 ${leftOut.toFixed(0)} 公里，比它写的头一段（${straightKm.toFixed(0)} 公里）还长：那一截应该是直着连过去的`).toBeLessThanOrEqual(straightKm + STEP_KM);
      } else if (end === 'last') {
        while (last > first && from[last] > ALONG_MAX_KM) last--;
        leftOut = total - points[last].km;
        const straightKm = segmentKm(R.scene, R.coords, way.line[way.line.length - 2], way.line[way.line.length - 1]);
        expect(leftOut, `${way.id} 从河边到城不查的一截有 ${leftOut.toFixed(0)} 公里，比它写的末一段（${straightKm.toFixed(0)} 公里）还长：那一截应该是直着连过去的`).toBeLessThanOrEqual(straightKm + STEP_KM);
      }
      if (end) listed.add(way.id);
      // 甲：两头收回到城里的一截，不查“不贴到 2 公里以内”（不在河边的城那一头没有这一截）
      const taper = Math.min(BANK_TAPER_KM, total * BANK_TAPER_SHARE);
      let far = 0;
      let near = Infinity;
      for (let i = first; i <= last; i++) {
        far = Math.max(far, from[i]);
        const inHeadTaper = end !== 'first' && points[i].km < taper;
        const inTailTaper = end !== 'last' && total - points[i].km < taper;
        if (!inHeadTaper && !inTailTaper) near = Math.min(near, from[i]);
      }
      const straight = STRAIGHT_ON_CANAL.includes(way.id);
      if (straight) listed.add(way.id);
      const bad = far > ALONG_MAX_KM || (!straight && near < ALONG_MIN_KM);
      if (bad) loose.push(way.id);
      lines.push(
        `  ${way.id} 沿 ${river.id}：${way.line.length} 个点，${total.toFixed(0)} 公里；离河最远 ${far.toFixed(1)} 公里，两头 ${taper.toFixed(0)} 公里以外最近 ${Number.isFinite(near) ? near.toFixed(1) : '—'} 公里` +
          `${leftOut > 0 ? `；城不在这条河边，直着连过去、不查的一截 ${leftOut.toFixed(0)} 公里` : ''}${straight ? '；照直线画，不查最近' : ''}${bad ? '　← 不合' : ''}`,
      );
    }
    console.log(`${key} 沿着河走的路（离河不超过 ${ALONG_MAX_KM} 公里，不贴到 ${ALONG_MIN_KM} 公里以内）：\n${lines.join('\n')}\n  不合的：${loose.join('、') || '没有'}`);
    expect(lines.length).toBeGreaterThan(0);
    if (BANK_LINES_IN) expect(loose).toEqual([]);
    // 上面两张名单里写的路都在场景里、都沿着一条河：名单不留没有用的名字
    if (key === 'su-shi/route') expect([...listed].sort()).toEqual([...Object.keys(TOWN_OFF_RIVER), ...STRAIGHT_ON_CANAL].sort());
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

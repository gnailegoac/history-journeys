// 全程沙盘的路（roads.ways）写得对不对：照真的场景文件和“今天的海岸、湖、河”查。在 Node 里跑，不要浏览器。
// 校验（规则 13）管的是路连不连得上、有没有人走；这里管的是路落在哪：
//   1 路不从海里过（今天的陆地外面，或者抹成海的圈里面），走海路的（by 是 sea）除外；
//   2 路不从湖里、只染水色的水里过；沿着这个湖走的路（along 写的是它）除外；
//   3 沿着一条河走的路（along 写的是它），线上每一点离这条河不超过 15 公里，又不贴到 2 公里以内。
//     这是船画在河边的沙盘（场景的 roads.boats 不写，或者写 beside；苏轼的这一座）。船走在水上的沙盘（写 on）反过来量：
//     每一条水路（by 是 water）写了 along 的，线上每一点都在它走的那条河上（离画出来的河不超过那一座沙盘定的公里数）、
//     那个湖的圈里，两头靠岸的一截让开；没有写 along 的水路说不出走的是哪条水，另数、印出来，不算不合（./support/routeFacts.ts）。
// 沿线每 2 公里取一个点来查。河可以过（扬州到润州过大江），不算。
//
// 第 3 条量的是画在地面上的那条河（这座沙盘的样式的画法画的那一条，照 tests/tools/route/painters.ts 取；宋代青绿设色的是 tests/tools/route/paint.ts 的 riverPaths：自己写的河是抹顺以后的线，不是直着连的）。
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
import { pickedLakes, readToday } from '../content/routeRules';
import type { TodayFeature } from '../content/routeRules';
import { BANK_TAPER_KM, BANK_TAPER_SHARE } from '../tools/route/bankTool';
import { routeRiversFor } from '../tools/route/painters';
import { realRouteScene, realSceneKeys } from './support/realScenes';
import type { RealRouteScene } from './support/realScenes';
import { STEP_KM, along, boatsOn, boatsOnWater, boxed, inAny, insideRing, kmToPainted } from './support/routeFacts';
import type { BoatLimits, Boxed } from './support/routeFacts';

/** 走水路的那几条路是不是已经换成了贴着河岸走的线。换了，第 3 条才算数。 */
const BANK_LINES_IN = true;
/** 沿着河走的路，离这条河最远多少公里。 */
const ALONG_MAX_KM = 15;
/** 贴岸的线离河的中线最近多少公里（换成贴岸的线以后才查）。 */
const ALONG_MIN_KM = 2;
/**
 * 第 3 条定下来不查的路，一座沙盘一份（路的 id 是那一座沙盘自己的，不拿一座的名单去认另一座的路）：
 *   townOffRiver   一头是不在这条河边上的城的路，和是哪一头（上面的“乙”）；
 *   straightOnCanal 定了不做岸线、照直线画的路（上面的“丙”）。
 * 表里没有的沙盘两样都是空的：它每一条沿着河走的路都照第 3 条查。上面“乙”“丙”说的是苏轼的那一座。
 */
interface AlongExceptions {
  townOffRiver: Record<string, 'first' | 'last'>;
  straightOnCanal: string[];
}
const ALONG_EXCEPTIONS: Record<string, AlongExceptions> = {
  'su-shi/route': { townOffRiver: { 'w-ying': 'first', 'w-bei': 'last', 'w-dong': 'first' }, straightOnCanal: ['w-canal-s1', 'w-canal-s2'] },
};
const NO_EXCEPTIONS: AlongExceptions = { townOffRiver: {}, straightOnCanal: [] };
/**
 * 船走在水上的沙盘（场景的 roads.boats 写 on），一座一份：沿河的水路离画出来的那条河最多多少公里，两头让出多少公里
 *（./support/routeFacts.ts 的 boatsOnWater 照它量）。数是照那一座沙盘的线量过定的，跟着它的场景文件一起进来；
 * content/ 里现在没有这样的沙盘，表是空的。编出来的那一座的两个数在 tests/stage/made-up-route.test.ts 里。
 */
const BOAT_LIMITS: Record<string, BoatLimits> = {};

const texts = import.meta.glob<string>('/content/figures/*/scenes/*.geojson', { query: '?raw', import: 'default', eager: true });

function todayOf(R: RealRouteScene): TodayFeature[] {
  const text = texts[`/${R.todayPath}`];
  if (text === undefined) throw new Error(`没有 ${R.todayPath}`);
  const today = readToday({ today: text }, 'today');
  if (!today || 'problem' in today) throw new Error(`${R.todayPath} 读不出来`);
  return today.features;
}

/** 两点之间多少公里（在沙盘的投影里量）。 */
function segmentKm(scene: RouteScene, coords: FrameCoords, a: LngLat, b: LngLat): number {
  const [ax, az] = coords.toLocal(a);
  const [bx, bz] = coords.toLocal(b);
  return (Math.hypot(bx - ax, bz - az) * scene.frame.scale) / 1000;
}

/** 每条路沿线一共多少公里。 */
function totalKm(R: RealRouteScene): number {
  let total = 0;
  for (const way of R.scene.roads.ways) {
    const points = along(R.scene, R.coords, way.line);
    total += points[points.length - 1].km;
  }
  return total;
}

/**
 * 第 3 条：沿着一条河走的每一条路量一遍。lines 是每条路量到的数（打印用），loose 是不合的路，
 * listed 是这一座沙盘的名单里写着、场景里真的有、真的沿着一条河的路，exceptions 是这一座沙盘的名单。
 */
function alongRivers(R: RealRouteScene): { lines: string[]; loose: string[]; listed: Set<string>; exceptions: AlongExceptions } {
  const exceptions = ALONG_EXCEPTIONS[R.key] ?? NO_EXCEPTIONS;
  const features = todayOf(R);
  // 画在地面上的河照这座沙盘自己的样式的画法取（河画多宽是画法的数）：另一种样式的沙盘量的是它自己的河，没有画法的说一句就停
  const paths = routeRiversFor(R.scene.style)(R.scene, features, R.coords);
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
    const end = exceptions.townOffRiver[way.id];
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
    const straight = exceptions.straightOnCanal.includes(way.id);
    if (straight) listed.add(way.id);
    const bad = far > ALONG_MAX_KM || (!straight && near < ALONG_MIN_KM);
    if (bad) loose.push(way.id);
    lines.push(
      `  ${way.id} 沿 ${river.id}：${way.line.length} 个点，${total.toFixed(0)} 公里；离河最远 ${far.toFixed(1)} 公里，两头 ${taper.toFixed(0)} 公里以外最近 ${Number.isFinite(near) ? near.toFixed(1) : '—'} 公里` +
        `${leftOut > 0 ? `；城不在这条河边，直着连过去、不查的一截 ${leftOut.toFixed(0)} 公里` : ''}${straight ? '；照直线画，不查最近' : ''}${bad ? '　← 不合' : ''}`,
    );
  }
  return { lines, loose, listed, exceptions };
}

// ---------------------------------------------------------------- 每一座全程沙盘
// content/ 里有几座全程沙盘就查几座。一座沙盘自己的数和路名在文件最后写着它名字的那一组里。

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

  it('沿着一条河走的路：线上每一点离它的河 2 到 15 公里（两头收回到城里的一截另算；这一座沙盘定下来不查的路照它自己的名单），量出来打印；船走在水上的沙盘（roads.boats 写 on）反过来量：每一条水路都在它走的河上、湖里', () => {
    const R = realRouteScene(key);
    if (boatsOn(R.scene)) {
      // 船走在水上的沙盘：水路不在河边，就在水上。离河最多差多少、两头让出多少是这一座沙盘自己定的数，没有定的说一句就停
      const limits = BOAT_LIMITS[key];
      expect(limits, `${key} 的船走在水上（roads.boats 写 on），可这里的 BOAT_LIMITS 里没有它的两个数（离河最多多少公里、两头让出多少公里）`).toBeDefined();
      const { lines, off, nameless, unmeasured } = boatsOnWater(R.scene, R.coords, todayOf(R), routeRiversFor(R.scene.style)(R.scene, todayOf(R), R.coords), limits);
      console.log(
        `${key} 的船走在水上（离河不超过 ${limits.riverKm} 公里，两头 ${limits.landingKm} 公里以内不查）：\n${lines.join('\n')}\n  没有写走的是哪条水的水路（另数，不查）：${nameless.join('、') || '没有'}\n  两头一让就一个点也不剩的水路（另数，没有量）：${unmeasured.join('、') || '没有'}\n  不合的：${off.join('；') || '没有'}`,
      );
      expect(off).toEqual([]);
      return;
    }
    const { lines, loose, listed, exceptions } = alongRivers(R);
    console.log(`${key} 沿着河走的路（离河不超过 ${ALONG_MAX_KM} 公里，不贴到 ${ALONG_MIN_KM} 公里以内）：\n${lines.join('\n')}\n  不合的：${loose.join('、') || '没有'}`);
    if (BANK_LINES_IN) expect(loose).toEqual([]);
    // 这一座沙盘的两张名单里写的路都在场景里、都沿着一条河：名单不留没有用的名字（没有名单的沙盘，两头都是空的）
    expect([...listed].sort()).toEqual([...Object.keys(exceptions.townOffRiver), ...exceptions.straightOnCanal].sort());
  });

  it('每条路都有两头以上的点，写的 by 是三种之一；沿着的河、湖在场景里；一共多少公里（打印出来）', () => {
    const R = realRouteScene(key);
    for (const way of R.scene.roads.ways) expect(way.line.length).toBeGreaterThanOrEqual(2);
    const total = totalKm(R);
    console.log(`${key}：${R.scene.roads.ways.length} 条路，沿线一共 ${Math.round(total)} 公里；${R.scene.roads.journeys.length} 趟，${R.scene.roads.journeys.reduce((n, journey) => n + journey.parts.length, 0)} 截`);
    expect(total).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- 苏轼的这一座自己的数和路名

describe('su-shi/route 的路：苏轼这一座自己的数和路名', () => {
  const key = 'su-shi/route';

  it('有沿着一条河走的路；定下来不查的是三座不在河边的城的那三条（w-ying、w-bei、w-dong）和大江以南的两段运河（w-canal-s1、w-canal-s2），都在场景里、都沿着一条河', () => {
    const { lines, listed } = alongRivers(realRouteScene(key));
    expect(lines.length).toBeGreaterThan(0);
    expect([...listed].sort()).toEqual(['w-bei', 'w-canal-s1', 'w-canal-s2', 'w-dong', 'w-ying']);
  });

  it('路沿线一共五千公里以上', () => {
    expect(totalKm(realRouteScene(key))).toBeGreaterThan(5000);
  });
});

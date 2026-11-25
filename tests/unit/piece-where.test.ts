// 小像站在全程沙盘的哪里（src/stage/pieceWhere.ts），照真的场景文件和真的行迹查。在 Node 里跑，不要浏览器。
// 真的：content/ 里的全程沙盘（scenes/route.json）、手写的行迹（itinerary.json）和照它做出来的时间轴用的那一份（itinerary.bar.json）。
// 这里只查平面上的位置（沙盘里的米）；他站多高、在画面上多大，在 tests/stage/route-view.test.ts。
// 页面那一边“哪一天 → 哪一段 → 站在哪”的说法（src/timebar/barWhere.ts 的 whereAt）也是真的：这里拿它把每一段从头走到尾。

import { describe, expect, it } from 'vitest';
import type { Itinerary, ItineraryBar, ItineraryBarStretch } from '../../src/domain/itinerary';
import type { RouteScene } from '../../src/domain/scene';
import { coordsOf } from '../../src/domain/sceneGeoRoute';
import { chainNearest, chainPoint, pieceChain, pieceWhere } from '../../src/stage/pieceWhere';
import type { PieceEnd } from '../../src/stage/types';
import { whereAt } from '../../src/timebar/barWhere';
import { readBytes } from '../support/readBytes';

const DIR = 'content/figures/su-shi';
const readJson = <T>(path: string): T => JSON.parse(new TextDecoder().decode(readBytes(path))) as T;
const scene = readJson<RouteScene>(`${DIR}/scenes/route.json`);
const bar = readJson<ItineraryBar>(`${DIR}/itinerary.bar.json`);
const itinerary = readJson<Itinerary>(`${DIR}/itinerary.json`);
const coords = coordsOf(scene);
/** 沙盘里的一米合地上多少公里。 */
const KM = scene.frame.scale / 1000;

/** 每一段从第几天起（上一段的 until；头一段从第 0 天）。 */
const starts = bar.stretches.map((_, i) => (i === 0 ? 0 : bar.stretches[i - 1].until));
const roads = bar.stretches.flatMap((stretch, i) => (stretch.ways ? [{ stretch, ways: stretch.ways, from: starts[i] }] : []));
const shown = (stretch: ItineraryBarStretch): boolean => stretch.look !== 'off';
const far = (a: readonly number[], b: readonly number[]): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
/** 一段里的一天，他站在哪（沙盘里的米）。 */
function at(i: number, day: number): [number, number] | null {
  const where = whereAt(bar, day);
  // 问的就是这一段
  expect(bar.stretches.findIndex((s, k) => day < s.until || k === bar.stretches.length - 1), `第 ${day} 天`).toBe(i);
  return where && pieceWhere(scene, coords, where);
}

describe('小像站在哪：路', () => {
  it('每一段路（有几段照手写的那一份数）：各截接起来没有缺口，从头走到尾，位置一步不往回', () => {
    expect(roads.map((road) => road.stretch.id)).toEqual(itinerary.stretches.filter((stretch) => stretch.kind === 'road').map((stretch) => stretch.id));
    expect(roads.length).toBeGreaterThan(0);
    const lines: string[] = [];
    for (const { stretch, ways, from } of roads) {
      const chain = pieceChain(scene, coords, ways);
      if (!chain) throw new Error(`${stretch.id}：有一截路沙盘上没有`);
      const total = chain.along[chain.along.length - 1];
      expect(total, stretch.id).toBeGreaterThan(0);
      // 各截之间没有缺口：前一截的尾就是后一截的头
      let gap = 0;
      for (let k = 1; k < ways.length; k++) {
        const a = pieceChain(scene, coords, [ways[k - 1]]);
        const b = pieceChain(scene, coords, [ways[k]]);
        if (!a || !b) throw new Error(`${stretch.id}：有一截路沙盘上没有`);
        gap = Math.max(gap, far(a.points[a.points.length - 1], b.points[0]) * KM);
      }
      expect(gap, `${stretch.id} 各截之间的缺口（公里）`).toBeLessThan(0.01);
      // 从头走到尾：头一刻在线的起头，最后一刻在线的末尾
      const first = at(bar.stretches.indexOf(stretch), from);
      const last = at(bar.stretches.indexOf(stretch), stretch.until - 1e-6);
      expect(far(first!, chain.points[0]) * KM, `${stretch.id} 头一刻离线的起头（公里）`).toBeLessThan(0.01);
      expect(far(last!, chain.points[chain.points.length - 1]) * KM, `${stretch.id} 最后一刻离线的末尾（公里）`).toBeLessThan(0.01);
      // 一步不往回：一天一天走，沿着线量的远近只增不减；两天之间走的直线距离不超过沿线走的那一段
      let s = -1;
      let prev: [number, number] | null = null;
      let prevS = 0;
      const steps = Math.max(200, Math.ceil(stretch.until - from));
      for (let n = 0; n <= steps; n++) {
        const day = Math.min(from + ((stretch.until - from) * n) / steps, stretch.until - 1e-6);
        const p = at(bar.stretches.indexOf(stretch), day);
        if (!p) throw new Error(`${stretch.id} 第 ${day} 天没有位置`);
        const here = chainNearestFrom(chain, p, s);
        expect(here, `${stretch.id} 第 ${day.toFixed(1)} 天往回走了`).toBeGreaterThanOrEqual(s - 1e-6);
        if (prev) expect(far(p, prev), `${stretch.id} 第 ${day.toFixed(1)} 天跳了一下`).toBeLessThanOrEqual(here - prevS + 1e-6);
        prev = p;
        prevS = here;
        s = here;
      }
      lines.push(`${stretch.id} ${stretch.label} ${Math.round(total * KM)} 公里`);
    }
    console.log(`十二段路沿着画出来的线各有多长：${lines.join('，')}`);
  });

  /** p 落在这条线上离起头多远——线自己绕回来的地方有两个答案，取不比 from 靠前的里面最近的那一个。 */
  function chainNearestFrom(chain: NonNullable<ReturnType<typeof pieceChain>>, p: readonly [number, number], from: number): number {
    const { points, along } = chain;
    let best = { s: Math.max(0, from), off: Infinity };
    for (let i = 1; i < points.length; i++) {
      if (along[i] < from - 1e-6) continue;
      const [ax, az] = points[i - 1];
      const dx = points[i][0] - ax;
      const dz = points[i][1] - az;
      const t = Math.min(1, Math.max(0, ((p[0] - ax) * dx + (p[1] - az) * dz) / (dx * dx + dz * dz || 1)));
      const s = along[i - 1] + (along[i] - along[i - 1]) * t;
      const off = Math.hypot(p[0] - ax - dx * t, p[1] - az - dz * t);
      if (s >= from - 1e-6 && off < best.off - 1e-9) best = { s, off };
    }
    expect(best.off * KM, '这一点不在线上').toBeLessThan(0.01);
    return best.s;
  }

  it('走到几成：0 是起头，1 是末尾；两头是同一点就是停在那里', () => {
    for (const { stretch, ways } of roads) {
      const chain = pieceChain(scene, coords, ways);
      if (!chain) throw new Error(`${stretch.id}：有一截路沙盘上没有`);
      const total = chain.along[chain.along.length - 1];
      const on = (k: number, from: PieceEnd = 'start', to: PieceEnd = 'end') => pieceWhere(scene, coords, { on: 'road', ways, from, to, k });
      expect(on(0), stretch.id).toEqual(chain.points[0]);
      expect(on(1), stretch.id).toEqual(chain.points[chain.points.length - 1]);
      expect(on(0.5), stretch.id).toEqual(chainPoint(chain, total / 2));
      expect(on(0.25), stretch.id).toEqual(chainPoint(chain, total / 4));
      // 出了 0 到 1 就是两头
      expect(on(-3), stretch.id).toEqual(on(0));
      expect(on(7), stretch.id).toEqual(on(1));
      // 倒过来说（从末尾到起头）：走到三成就是正着走到七成
      const back = on(0.3, 'end', 'start');
      const forth = on(0.7);
      expect(far(back!, forth!), stretch.id).toBeLessThan(1e-6);
      // 两头是同一点：不管几成，停在那里
      const mid = coords.toLngLat(...chainPoint(chain, total * 0.4));
      const halt = on(0, mid, mid);
      for (const k of [0.2, 0.5, 1]) expect(on(k, mid, mid), stretch.id).toEqual(halt);
      expect(far(halt!, chainPoint(chain, total * 0.4)) * KM, stretch.id).toBeLessThan(0.01);
      for (const k of [0, 0.6, 1]) expect(on(k, 'end', 'end'), stretch.id).toEqual(on(1));
    }
  });

  it('路上有日子的地方落在线上：离线不超过 25 公里，先后和走的方向一样', () => {
    const lines: string[] = [];
    let points = 0;
    for (const { stretch, ways, from } of roads) {
      if (!stretch.legs) continue;
      const chain = pieceChain(scene, coords, ways);
      if (!chain) throw new Error(`${stretch.id}：有一截路沙盘上没有`);
      let s = 0;
      let day = from;
      for (const [lngLat, when] of stretch.legs) {
        const near = chainNearest(chain, coords.toLocal(lngLat));
        points++;
        expect(near.offM * KM, `${stretch.id} ${lngLat.join('，')} 离线（公里）`).toBeLessThanOrEqual(25);
        // 沿着线越走越远（同一处有两个日子的，是在那里停着：不往前，也不往回），日子越来越晚，都在这一段里面
        expect(near.s, `${stretch.id} ${lngLat.join('，')} 的先后`).toBeGreaterThanOrEqual(s);
        expect(when, `${stretch.id} ${lngLat.join('，')} 的日子`).toBeGreaterThan(day);
        expect(when).toBeLessThan(stretch.until);
        // 到了那一天，他就站在线上离那里最近的那一点
        const there = at(bar.stretches.indexOf(stretch), when);
        expect(far(there!, chainPoint(chain, near.s)) * KM, `${stretch.id} 第 ${when} 天`).toBeLessThan(0.01);
        lines.push(`${stretch.id} ${(near.offM * KM).toFixed(1)}`);
        s = near.s;
        day = when;
      }
    }
    // 有这样的地方的路、这样的地方一共多少，照手写的那一份数：路上精确到日、又有位置的各处
    const written = itinerary.stretches.flatMap((stretch) => (stretch.kind === 'road' ? (stretch.waypoints ?? []).filter((w) => w.at && w.date?.precision === 'day').map(() => stretch.id) : []));
    expect(points).toBe(written.length);
    expect(new Set(lines.map((line) => line.split(' ')[0]))).toEqual(new Set(written));
    console.log(`路上有日子的 ${points} 处离画出来的线多远（公里）：${lines.join('，')}`);
  });
});

describe('小像站在哪：线上没有立名字的地方，认不得的地方，一生的每一段', () => {
  it('站在线上没有立名字的地方（哪几段照手写的那一份数）：他站的就是线上离那里最近的一点，离那个地方不到 15 公里（各处多远印出来）；同一个地方的几段是同一个位置', () => {
    const spots = bar.stretches.flatMap((stretch) => (stretch.spot ? [{ stretch, way: stretch.spot[0], lngLat: stretch.spot[1] }] : []));
    const written = itinerary.stretches.filter((stretch) => stretch.kind === 'elsewhere' && stretch.tablePoint.type === 'way-vertex');
    expect(spots.map((spot) => spot.stretch.id)).toEqual(written.map((stretch) => stretch.id));
    expect(spots.length).toBeGreaterThan(0);
    const off = new Map<string, number[]>();
    for (const { stretch, way, lngLat } of spots) {
      const chain = pieceChain(scene, coords, [way]);
      if (!chain) throw new Error(`${stretch.id}：沙盘上没有 ${way} 这一截路`);
      const near = chainNearest(chain, coords.toLocal(lngLat));
      // 他站的就是线上离那里最近的那一点
      const p = pieceWhere(scene, coords, { on: 'spot', way, at: lngLat });
      expect(far(p!, chainPoint(chain, near.s)), stretch.id).toBeLessThan(1e-6);
      expect(far(p!, coords.toLocal(lngLat)) * KM, stretch.id).toBeCloseTo(near.offM * KM, 6);
      // 第二行说的是哪个地方（“沙盘上没有立某地的名字。”）
      const town = /^沙盘上没有立(.+?)的名字。/.exec(stretch.says)?.[1];
      expect(town, `${stretch.id} 的第二行`).toBeDefined();
      off.set(town!, [...(off.get(town!) ?? []), near.offM * KM]);
    }
    // 第二行说的地方，就是手写的那一份里这几段的 where 开头的地名
    expect([...off.keys()].sort()).toEqual([...new Set(written.map((stretch) => (stretch.kind === 'elsewhere' ? stretch.where.split(/[（(]/)[0].trim() : '')))].sort());
    for (const [town, list] of off) {
      // 离画出来的线不到 15 公里（校验的规则 22 也是这个数）；同一个地方的几段（常州两回）离线一样远，是同一个位置
      for (const km of list) expect(km, town).toBeLessThan(15);
      for (const km of list) expect(km, town).toBeCloseTo(list[0], 9);
    }
    console.log(`线上没有立名字的 ${spots.length} 段离画出来的线多远（公里）：${[...off].map(([town, list]) => `${town} ${list.map((km) => km.toFixed(2)).join('、')}`).join('，')}`);
  });

  it('认不得的地名点、认不得的路：null', () => {
    const known = roads[0].ways;
    expect(pieceWhere(scene, coords, { on: 'place', place: 'no-such-place' })).toBeNull();
    expect(pieceWhere(scene, coords, { on: 'road', ways: ['no-such-way'], from: 'start', to: 'end', k: 0.5 })).toBeNull();
    expect(pieceWhere(scene, coords, { on: 'road', ways: [...known, 'no-such-way'], from: 'start', to: 'end', k: 0.5 })).toBeNull();
    expect(pieceWhere(scene, coords, { on: 'road', ways: [], from: 'start', to: 'end', k: 0.5 })).toBeNull();
    expect(pieceWhere(scene, coords, { on: 'spot', way: 'no-such-way', at: [110, 30] })).toBeNull();
    expect(pieceChain(scene, coords, ['-no-such-way'])).toBeNull();
    // 认得的照常给
    expect(pieceWhere(scene, coords, { on: 'road', ways: known, from: 'start', to: 'end', k: 0.5 })).not.toBeNull();
    expect(pieceWhere(scene, coords, { on: 'place', place: scene.places[0].id })).toEqual(coords.toLocal(scene.places[0].at));
  });

  it('行迹里有他的各段，每一段都算得出位置，都在沙盘里面；没有他的各段不给位置（哪几段有他照手写的那一份数）', () => {
    // 手写的那一份里：住在一站的、在画出来的路上的、站在沙盘上有的地方（地名点，或者线上的一处）的，有他；别的没有
    const onTable = itinerary.stretches.filter((s) => s.kind !== 'elsewhere' || ['stop-point', 'place', 'way-vertex'].includes(s.tablePoint.type)).map((s) => s.id);
    expect(bar.stretches.filter(shown).map((s) => s.id)).toEqual(onTable);
    expect(onTable.length).toBeGreaterThan(0);
    expect(onTable.length).toBeLessThan(bar.stretches.length);
    let jump = 0;
    let last: { p: [number, number]; id: string } | null = null;
    bar.stretches.forEach((stretch, i) => {
      const from = starts[i];
      const days = [from, (from + stretch.until) / 2, stretch.until - 1e-6];
      if (!shown(stretch)) {
        for (const day of days) expect(whereAt(bar, day), `${stretch.id} 第 ${day} 天`).toBeNull();
        expect([stretch.place, stretch.spot, stretch.ways], stretch.id).toEqual([undefined, undefined, undefined]);
        last = null;
        return;
      }
      // 一段只有一种站法
      expect([stretch.place, stretch.spot, stretch.ways].filter((x) => x !== undefined), stretch.id).toHaveLength(1);
      const where = days.map((day) => at(i, day));
      where.forEach((p, k) => {
        expect(p, `${stretch.id} 第 ${days[k]} 天`).not.toBeNull();
        expect(p![0], stretch.id).toBeGreaterThan(coords.x0);
        expect(p![0], stretch.id).toBeLessThan(coords.x1);
        expect(p![1], stretch.id).toBeGreaterThan(coords.z0);
        expect(p![1], stretch.id).toBeLessThan(coords.z1);
      });
      // 接着上一段的（中间没有隔着“沙盘上没有他”的一段）：他不跳，上一段最后一刻在哪，这一段头一刻就在哪
      if (last) {
        const km = far(last.p, where[0]!) * KM;
        jump = Math.max(jump, km);
        expect(km, `${last.id} 的最后一刻到 ${stretch.id} 的头一刻（公里）`).toBeLessThan(0.01);
      }
      last = { p: where[2]!, id: stretch.id };
    });
    console.log(`有他的 40 段都在沙盘里面；一段接着一段的地方他最多挪 ${jump.toFixed(3)} 公里`);
  });
});

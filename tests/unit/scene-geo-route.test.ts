// 全程沙盘的换算（src/domain/sceneGeoRoute.ts）的单元测试：圆锥投影、矮山多夸的曲线、两层沙盘各用哪一组换算。
// 参考数不是这个文件自己算的：是拿定稿的样张自己的投影程序（spikes/art-direction/route/scene/proj.js，单位公里）
// 在 Node 里另跑出来的，抄在这里。苏轼全程沙盘的范围就是样张的范围：2001 × 2262 公里，原点东经 112.25 度、北纬 28.25 度。

import { describe, expect, it } from 'vitest';
import type { RouteFrame, RouteScene } from '../../src/domain/scene';
import { frameCoords } from '../../src/domain/sceneGeo';
import { coordsOf, curve, curveInverse, routeCoords } from '../../src/domain/sceneGeoRoute';
import type { LngLat } from '../../src/domain/types';
import { fixtureScene } from '../support/fixtureScene';

const FRAME: RouteFrame = {
  center: [112.25, 28.25],
  projection: { kind: 'lambert-conic', lat1: 22, lat2: 35 },
  scale: 171,
  westM: 1_000_500,
  eastM: 1_000_500,
  northM: 1_131_000,
  southM: 1_131_000,
  datumM: 0,
  relief: { kind: 'low-hills-more', lowBelowM: 300, lowTimes: 25, power: 0.6, highTimes: 8 },
};

const coords = routeCoords(FRAME);

/** 沙盘里的一点换成“离原点往东、往北各多少公里”（样张的程序用的就是这个单位）。 */
const km = (p: LngLat): [number, number] => {
  const [x, z] = coords.toLocal(p);
  return [(x * FRAME.scale) / 1000, (-z * FRAME.scale) / 1000];
};

/** 这一点离沙盘最近的一条边多少公里；在外面是负数。 */
const toEdgeKm = (p: LngLat): number => {
  const [x, z] = coords.toLocal(p);
  return (Math.min(x - coords.x0, coords.x1 - x, z - coords.z0, coords.z1 - z) * FRAME.scale) / 1000;
};

describe('routeCoords：全程沙盘的范围', () => {
  it('四条边是范围的米数除以比例：沙盘 11,702 × 13,228 米，和徐州的沙盘差不多宽', () => {
    expect(coords.x0).toBeCloseTo(-1_000_500 / 171, 9);
    expect(coords.x1).toBeCloseTo(1_000_500 / 171, 9);
    expect(coords.z0).toBeCloseTo(-1_131_000 / 171, 9);
    expect(coords.z1).toBeCloseTo(1_131_000 / 171, 9);
    expect(Math.round(coords.x1 - coords.x0)).toBe(11_702);
    expect(Math.round(coords.z1 - coords.z0)).toBe(13_228);
  });

  it('原点在 [0, 0]；x 向东，z 向南', () => {
    const [x, z] = coords.toLocal(FRAME.center);
    expect(x).toBeCloseTo(0, 9);
    expect(z).toBeCloseTo(0, 9);
    expect(coords.toLocal([113.25, 28.25])[0]).toBeGreaterThan(0);
    expect(coords.toLocal([112.25, 29.25])[1]).toBeLessThan(0);
  });

  it('四个角的经纬度和样张的一样：北边两个角在北纬 38.01 度，南边两个角在 17.72 度', () => {
    const corner = (x: number, z: number) => coords.toLngLat(x, z);
    const near = (got: LngLat, want: LngLat) => {
      expect(got[0]).toBeCloseTo(want[0], 4);
      expect(got[1]).toBeCloseTo(want[1], 4);
    };
    near(corner(coords.x0, coords.z0), [100.8996, 38.0138]);
    near(corner(coords.x1, coords.z0), [123.6004, 38.0138]);
    near(corner(coords.x0, coords.z1), [102.8977, 17.7229]);
    near(corner(coords.x1, coords.z1), [121.6023, 17.7229]);
  });

  it('圆锥投影的边是弯的：北边的正中比两个角更靠北（38.44 度），南边的正中比两个角靠北（18.07 度）', () => {
    expect(coords.toLngLat(0, coords.z0)[1]).toBeCloseTo(38.4367, 4);
    expect(coords.toLngLat(0, coords.z1)[1]).toBeCloseTo(18.0706, 4);
    expect(coords.toLngLat(coords.x0, 0)[0]).toBeCloseTo(101.9948, 4);
    expect(coords.toLngLat(coords.x1, 0)[0]).toBeCloseTo(122.5052, 4);
    // 沿四条边走一圈，经纬度的范围：东经 100.8996 到 123.6004，北纬 17.7229 到 38.4367
    const box = { west: Infinity, east: -Infinity, south: Infinity, north: -Infinity };
    for (let i = 0; i <= 2000; i++) {
      const t = i / 2000;
      const x = coords.x0 + t * (coords.x1 - coords.x0);
      const z = coords.z0 + t * (coords.z1 - coords.z0);
      for (const [lng, lat] of [coords.toLngLat(x, coords.z0), coords.toLngLat(x, coords.z1), coords.toLngLat(coords.x0, z), coords.toLngLat(coords.x1, z)]) {
        box.west = Math.min(box.west, lng);
        box.east = Math.max(box.east, lng);
        box.south = Math.min(box.south, lat);
        box.north = Math.max(box.north, lat);
      }
    }
    expect(box.west).toBeCloseTo(100.8996, 4);
    expect(box.east).toBeCloseTo(123.6004, 4);
    expect(box.south).toBeCloseTo(17.7229, 4);
    expect(box.north).toBeCloseTo(38.4367, 4);
  });
});

describe('routeCoords：八站落在哪', () => {
  /** 地方，经纬度，样张的程序算出来的（往东、往北多少公里），离最近的边多少公里。 */
  const PLACES: [string, LngLat, [number, number], number][] = [
    ['眉州', [103.83, 30.04], [-804.891, 226.07], 195.6],
    ['杭州', [120.16, 30.24], [754.754, 244.804], 245.7],
    ['密州', [119.4, 36.0], [644.237, 877.803], 253.2],
    ['徐州', [117.185, 34.262], [452.757, 674.583], 456.4],
    ['汴京', [114.35, 34.8], [191.66, 726.706], 404.3],
    ['黄州', [114.866, 30.451], [249.265, 245.925], 751.2],
    ['惠州', [114.4, 23.09], [219.477, -569.019], 562.0],
    ['昌化军', [109.35, 19.74], [-305.052, -940.294], 190.7],
  ];

  it.each(PLACES)('%s：位置和样张算的一样（差不到一米），在沙盘里面', (_name, at, want, edge) => {
    const [east, north] = km(at);
    expect(east).toBeCloseTo(want[0], 3);
    expect(north).toBeCloseTo(want[1], 3);
    expect(coords.inside(at)).toBe(true);
    expect(toEdgeKm(at)).toBeCloseTo(edge, 1);
  });

  it('离边最近的是昌化军（191 公里）和眉州（196 公里）', () => {
    const sorted = [...PLACES].sort((a, b) => toEdgeKm(a[1]) - toEdgeKm(b[1]));
    expect(sorted.slice(0, 2).map((place) => place[0])).toEqual(['昌化军', '眉州']);
  });

  it('定州在北边外面 11 公里；从定州来的路进沙盘的那一点在边里面 2 公里', () => {
    const dingzhou: LngLat = [115.0, 38.51];
    expect(coords.inside(dingzhou)).toBe(false);
    expect(toEdgeKm(dingzhou)).toBeCloseTo(-11.0, 1);
    expect(km(dingzhou)[1]).toBeCloseTo(1141.991, 3);
    const enters: LngLat = [114.946, 38.395];
    expect(coords.inside(enters)).toBe(true);
    expect(toEdgeKm(enters)).toBeCloseTo(2.0, 1);
  });

  it('inside 的 marginM 是沙盘里的米：离边 191 公里的昌化军，留 1100 米算在里面，留 1200 米就不算', () => {
    const changhua: LngLat = [109.35, 19.74];
    // 190.7 公里 ÷ 171 = 1115 米
    expect(coords.inside(changhua, 1100)).toBe(true);
    expect(coords.inside(changhua, 1200)).toBe(false);
    // 负数是把沙盘往外放
    expect(coords.inside([115.0, 38.51], -70)).toBe(true);
    expect(coords.inside([115.0, 38.51], -60)).toBe(false);
  });

  it('换过去再换回来，还是原来的经纬度', () => {
    for (const [, at] of PLACES) {
      const back = coords.toLngLat(...coords.toLocal(at));
      expect(back[0]).toBeCloseTo(at[0], 9);
      expect(back[1]).toBeCloseTo(at[1], 9);
    }
    for (const [x, z] of [
      [coords.x0, coords.z0],
      [coords.x1, coords.z1],
      [1234.5, -4321],
    ]) {
      const [bx, bz] = coords.toLocal(coords.toLngLat(x, z));
      expect(bx).toBeCloseTo(x, 6);
      expect(bz).toBeCloseTo(z, 6);
    }
  });

  it('两条标准纬线（22 度、35 度）上长度不走样；中间短 0.6%，南北两头长 1% 上下', () => {
    /** 这个纬度上，沙盘上南北方向的一小段是实际的多少倍（等角投影，哪个方向都是这个数）。 */
    const stretch = (lat: number): number => {
      const step = 0.001;
      const [, z1] = coords.toLocal([112.25, lat - step / 2]);
      const [, z2] = coords.toLocal([112.25, lat + step / 2]);
      const onTable = Math.abs(z2 - z1) * FRAME.scale;
      const real = 6_371_000 * ((step * Math.PI) / 180);
      return onTable / real;
    };
    expect(stretch(22)).toBeCloseTo(1, 4);
    expect(stretch(35)).toBeCloseTo(1, 4);
    expect(stretch(28.25)).toBeCloseTo(0.99358, 4);
    expect(stretch(18)).toBeCloseTo(1.01017, 4);
    expect(stretch(38.4367)).toBeCloseTo(1.00901, 4);
  });

  it('等角：同一点上往东、往北各走一小段，沙盘上一样长', () => {
    const at: LngLat = [117.185, 34.262];
    const d = 0.001;
    const [x0, z0] = coords.toLocal(at);
    const [xe, ze] = coords.toLocal([at[0] + d / Math.cos((at[1] * Math.PI) / 180), at[1]]);
    const [xn, zn] = coords.toLocal([at[0], at[1] + d]);
    expect(Math.hypot(xe - x0, ze - z0) / Math.hypot(xn - x0, zn - z0)).toBeCloseTo(1, 4);
  });
});

describe('矮山多夸的曲线', () => {
  const relief = FRAME.relief;

  it('300 米以下夸大 25 倍：300 米是 7,500', () => {
    expect(curve(relief, 0)).toBe(0);
    expect(curve(relief, 60)).toBe(1500);
    expect(curve(relief, 300)).toBe(7500);
  });

  it('再往上慢下来：地形文件里最高的 6,292 米是 46,565（7.4 倍），做出来的地面上最高的 4,650 米是 38,838（8.35 倍）', () => {
    expect(curve(relief, 6292)).toBeCloseTo(46565.23, 2);
    expect(curve(relief, 6292) / 6292).toBeCloseTo(7.401, 3);
    expect(curve(relief, 4650)).toBeCloseTo(38838.31, 2);
    expect(Math.round(curve(relief, 4650) / 4650)).toBe(relief.highTimes);
    expect(curve(relief, 1000)).toBeCloseTo(15445.02, 2);
  });

  it('在 300 米那一点上两段接得上；越高越高，夸大的倍数越来越小', () => {
    expect(curve(relief, 300 + 1e-9)).toBeCloseTo(7500, 5);
    let last = -Infinity;
    let lastTimes = Infinity;
    for (let h = 10; h <= 7000; h += 10) {
      const raised = curve(relief, h);
      expect(raised).toBeGreaterThan(last);
      expect(raised / h).toBeLessThanOrEqual(lastTimes + 1e-12);
      last = raised;
      lastTimes = raised / h;
    }
  });

  it('比桌面低的地方照直线往下算', () => {
    expect(curve(relief, -4)).toBe(-100);
  });

  it('curveInverse 把它倒回去', () => {
    for (const h of [-4, 0, 1, 59.5, 299.999, 300, 300.001, 1000, 4650, 6292]) expect(curveInverse(relief, curve(relief, h))).toBeCloseTo(h, 8);
    expect(curveInverse(relief, 7500)).toBe(300);
  });

  it('y：曲线夸大以后再除以比例；300 米高的山在沙盘上是 43.9 米，沙盘宽度的 0.37%', () => {
    expect(coords.y(300)).toBeCloseTo(7500 / 171, 9);
    expect(coords.y(300) / (coords.x1 - coords.x0)).toBeCloseTo(0.0037, 3);
    expect(coords.y(6292)).toBeCloseTo(46565.23 / 171, 2);
    // 桌面不在海面上的时候，先减掉桌面的海拔
    const raised = routeCoords({ ...FRAME, datumM: 100 });
    expect(raised.y(400)).toBeCloseTo(7500 / 171, 9);
    expect(raised.y(100)).toBe(0);
  });
});

describe('coordsOf：一座沙盘用哪一组换算', () => {
  it('全程沙盘用圆锥投影', () => {
    const route = { level: 'route', frame: FRAME } as RouteScene;
    const got = coordsOf(route);
    const at: LngLat = [117.185, 34.262];
    expect(got.toLocal(at)).toEqual(coords.toLocal(at));
    expect(got.y(300)).toBe(coords.y(300));
    expect(got.x0).toBe(coords.x0);
  });

  it('站点沙盘照旧：和 frameCoords 给出来的一个数不差（写没写 level 都一样）', () => {
    const scene = fixtureScene();
    const want = frameCoords(scene.frame);
    for (const stop of [scene, { ...scene, level: 'stop' as const }]) {
      const got = coordsOf(stop);
      const at: LngLat = [scene.frame.center[0] + 0.004, scene.frame.center[1] - 0.003];
      expect(got.toLocal(at)).toEqual(want.toLocal(at));
      expect(got.toLngLat(120, -80)).toEqual(want.toLngLat(120, -80));
      expect(got.y(52)).toBe(want.y(52));
      expect([got.x0, got.x1, got.z0, got.z1]).toEqual([want.x0, want.x1, want.z0, want.z1]);
    }
  });
});

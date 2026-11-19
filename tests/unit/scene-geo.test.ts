// 经纬度和沙盘里的米之间换算的单元测试：frameCoords、farEdgePoint。
// 用的是徐州沙盘的范围（定稿的样张也是这一块），数都是另外用手算过的。

import { describe, expect, it } from 'vitest';
import type { SceneFrame } from '../../src/domain/scene';
import { farEdgePoint, frameCoords } from '../../src/domain/sceneGeo';
import type { LngLat } from '../../src/domain/types';

const xuzhou: SceneFrame = {
  center: [117.185, 34.2655],
  westM: 6300,
  eastM: 5400,
  northM: 5400,
  southM: 4300,
  datumM: 40,
  relief: { kind: 'uniform', times: 6 },
};

/** 白土镇（今安徽萧县白土镇），在沙盘外面的西南。 */
const baitu: LngLat = [117.0314, 34.0953];
/** 宋代的南京（今河南商丘古城），在沙盘外面的西边。 */
const nanjing: LngLat = [115.61278, 34.38778];

describe('frameCoords', () => {
  const coords = frameCoords(xuzhou);

  it('原点在 [0, 0]；x 向东，z 向南', () => {
    const [x0, z0] = coords.toLocal(xuzhou.center);
    expect(x0).toBeCloseTo(0, 9);
    expect(z0).toBeCloseTo(0, 9);
    const [east] = coords.toLocal([117.195, 34.2655]);
    const [, north] = coords.toLocal([117.185, 34.2755]);
    expect(east).toBeGreaterThan(0);
    expect(north).toBeLessThan(0);
  });

  it('纬度 1 度 110950 米，经度 1 度 111320 × cos(原点纬度) 米', () => {
    const [, z] = coords.toLocal([117.185, 35.2655]);
    expect(z).toBeCloseTo(-110950, 6);
    const [x] = coords.toLocal([118.185, 34.2655]);
    expect(x).toBeCloseTo(111320 * Math.cos((34.2655 * Math.PI) / 180), 6);
    expect(x).toBeCloseTo(91999.0, 0);
  });

  it('四边是从原点量出去的米数', () => {
    expect([coords.x0, coords.x1, coords.z0, coords.z1]).toEqual([-6300, 5400, -5400, 4300]);
  });

  it('徐州沙盘的四边：经度 117.1165 到 117.2437，纬度 34.2267 到 34.3142', () => {
    const [west, north] = coords.toLngLat(coords.x0, coords.z0);
    const [east, south] = coords.toLngLat(coords.x1, coords.z1);
    expect(west).toBeCloseTo(117.1165, 4);
    expect(east).toBeCloseTo(117.2437, 4);
    expect(south).toBeCloseTo(34.2267, 4);
    expect(north).toBeCloseTo(34.3142, 4);
  });

  it('换过去再换回来还是原来的点', () => {
    for (const p of [xuzhou.center, [117.1765, 34.2717], [117.1957, 34.2529], baitu] as LngLat[]) {
      const [x, z] = coords.toLocal(p);
      const [lng, lat] = coords.toLngLat(x, z);
      expect(lng).toBeCloseTo(p[0], 10);
      expect(lat).toBeCloseTo(p[1], 10);
    }
  });

  it('城墙的大小：东西约 1104 米，南北约 1276 米', () => {
    const [x0, z0] = coords.toLocal([117.1765, 34.2717]);
    const [x1, z1] = coords.toLocal([117.1885, 34.2602]);
    expect(x1 - x0).toBeCloseTo(1104, 0);
    expect(z1 - z0).toBeCloseTo(1276, 0);
  });

  it('inside：沙盘里面的点、压在边上的点算在里面，外面的不算', () => {
    expect(coords.inside(xuzhou.center)).toBe(true);
    expect(coords.inside([117.1765, 34.2717])).toBe(true);
    expect(coords.inside(coords.toLngLat(coords.x1, 0))).toBe(true);
    expect(coords.inside(coords.toLngLat(coords.x1 + 1, 0))).toBe(false);
    expect(coords.inside(coords.toLngLat(0, coords.z0 - 1))).toBe(false);
    expect(coords.inside(baitu)).toBe(false);
    expect(coords.inside(nanjing)).toBe(false);
  });

  it('inside 的 marginM：正数是离边至少这么远才算，负数是往外放这么多再看', () => {
    const nearEdge = coords.toLngLat(coords.x0 + 100, 0);
    expect(coords.inside(nearEdge)).toBe(true);
    expect(coords.inside(nearEdge, 99)).toBe(true);
    expect(coords.inside(nearEdge, 101)).toBe(false);
    const justOutside = coords.toLngLat(0, coords.z1 + 100);
    expect(coords.inside(justOutside)).toBe(false);
    expect(coords.inside(justOutside, -101)).toBe(true);
    expect(coords.inside(justOutside, -99)).toBe(false);
  });

  it('y：桌面的海拔是 0，往上按夸大的倍数算', () => {
    expect(coords.y(40)).toBe(0);
    expect(coords.y(41.2)).toBeCloseTo(7.2, 9);
    expect(coords.y(37.6)).toBeCloseTo(-14.4, 9);
    expect(frameCoords({ ...xuzhou, datumM: 30, relief: { kind: 'uniform', times: 2 } }).y(41)).toBe(22);
  });
});

describe('farEdgePoint', () => {
  it('白土镇：方向 216.8 度，离原点 23.6 公里', () => {
    const far = farEdgePoint(xuzhou, baitu);
    expect(far.bearingDeg).toBeCloseTo(216.8, 1);
    expect(far.km).toBeCloseTo(23.6, 1);
  });

  it('白土镇：朝它走，从南边出沙盘，在 [117.150, 34.2267] 附近', () => {
    const { point } = farEdgePoint(xuzhou, baitu);
    expect(point[0]).toBeCloseTo(117.15, 3);
    expect(point[1]).toBeCloseTo(34.2267, 4);
    const coords = frameCoords(xuzhou);
    const [x, z] = coords.toLocal(point);
    expect(z).toBeCloseTo(coords.z1, 6);
    expect(x).toBeGreaterThan(coords.x0);
    expect(x).toBeLessThan(coords.x1);
  });

  it('南京（今商丘古城）：方向约 275 度，约 145 公里，从西边出沙盘', () => {
    const far = farEdgePoint(xuzhou, nanjing);
    expect(far.bearingDeg).toBeGreaterThan(274.5);
    expect(far.bearingDeg).toBeLessThan(275.5);
    expect(far.km).toBeGreaterThan(144.5);
    expect(far.km).toBeLessThan(145.5);
    const coords = frameCoords(xuzhou);
    const [x, z] = coords.toLocal(far.point);
    expect(x).toBeCloseTo(coords.x0, 6);
    expect(far.point[1]).toBeGreaterThan(34.26);
    expect(far.point[1]).toBeLessThan(34.275);
    expect(z).toBeLessThan(0);
  });

  it('四个正方向：北 0，东 90，南 180，西 270；出去的点压在那一边的正中', () => {
    const coords = frameCoords(xuzhou);
    const cases: { at: LngLat; bearing: number; edge: [number, number] }[] = [
      { at: coords.toLngLat(0, -20000), bearing: 0, edge: [0, coords.z0] },
      { at: coords.toLngLat(20000, 0), bearing: 90, edge: [coords.x1, 0] },
      { at: coords.toLngLat(0, 20000), bearing: 180, edge: [0, coords.z1] },
      { at: coords.toLngLat(-20000, 0), bearing: 270, edge: [coords.x0, 0] },
    ];
    for (const c of cases) {
      const far = farEdgePoint(xuzhou, c.at);
      expect(far.bearingDeg).toBeCloseTo(c.bearing, 6);
      expect(far.km).toBeCloseTo(20, 6);
      const [x, z] = coords.toLocal(far.point);
      expect(x).toBeCloseTo(c.edge[0], 4);
      expect(z).toBeCloseTo(c.edge[1], 4);
    }
  });

  it('朝着沙盘的一个角走，从那个角出去', () => {
    const coords = frameCoords(xuzhou);
    const far = farEdgePoint(xuzhou, coords.toLngLat(coords.x1 * 3, coords.z0 * 3));
    const [x, z] = coords.toLocal(far.point);
    expect(x).toBeCloseTo(coords.x1, 4);
    expect(z).toBeCloseTo(coords.z0, 4);
  });

  it('方向总在 0 到 360 之间（不含 360）', () => {
    const coords = frameCoords(xuzhou);
    for (let deg = 0; deg < 360; deg += 7.5) {
      const rad = (deg * Math.PI) / 180;
      const far = farEdgePoint(xuzhou, coords.toLngLat(30000 * Math.sin(rad), -30000 * Math.cos(rad)));
      expect(far.bearingDeg).toBeGreaterThanOrEqual(0);
      expect(far.bearingDeg).toBeLessThan(360);
      expect(Math.abs(((far.bearingDeg - deg + 540) % 360) - 180)).toBeLessThan(1e-6);
      expect(coords.inside(far.point, -0.01)).toBe(true);
      expect(coords.inside(far.point, 0.01)).toBe(false);
    }
  });

  it('这个地方在沙盘里面时，给出的点就是它自己', () => {
    const inFrame: LngLat = [117.1957, 34.2529];
    const far = farEdgePoint(xuzhou, inFrame);
    expect(far.point[0]).toBeCloseTo(inFrame[0], 10);
    expect(far.point[1]).toBeCloseTo(inFrame[1], 10);
    expect(far.km).toBeGreaterThan(0);
  });

  it('正好在原点上：方向算 0，距离是 0', () => {
    expect(farEdgePoint(xuzhou, xuzhou.center)).toEqual({ point: [117.185, 34.2655], bearingDeg: 0, km: 0 });
  });

  it('不改动传进来的范围和坐标', () => {
    const frame = structuredClone(xuzhou);
    const at: LngLat = [...baitu];
    farEdgePoint(frame, at);
    frameCoords(frame);
    expect(frame).toEqual(xuzhou);
    expect(at).toEqual(baitu);
  });
});

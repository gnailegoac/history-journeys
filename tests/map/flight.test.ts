// 镜头飞行计划的纯计算。运行：npx vitest run tests/map
import { describe, expect, it } from 'vitest';
import type { LngLat } from '../../src/domain/types';
import { FLIGHT_MAX_MS, FLIGHT_MIN_MS, planFlight, stopDistanceScale, type Camera } from '../../src/map/maplibre/flight';
import { Path, haversineKm, lerpAngle } from '../../src/map/maplibre/geo';

// 画面高 900 像素时的换算，和地图里的公式一样
const zoomForDistanceKm = (km: number, lat: number) =>
  Math.log2((1350 * ((40075016.686 * Math.cos((lat * Math.PI) / 180)) / 512)) / (km * 1000));

const bianjing: LngLat = [114.307, 34.797];
const huangzhou: LngLat = [114.872, 30.447];
const leg: LngLat[] = [bianjing, [114.88, 33.73], [114.36, 33], [114.74, 32.34], [114.92, 32.01], [115.01, 31.17], [114.88, 31.02], huangzhou];
const atBianjing: Camera = { center: bianjing, zoom: zoomForDistanceKm(50, bianjing[1]), pitch: 50, bearing: 0 };
const atHuangzhou: Camera = { center: huangzhou, zoom: zoomForDistanceKm(18, huangzhou[1]), pitch: 62, bearing: -15 };
const overview: Camera = { center: [112.5, 29], zoom: zoomForDistanceKm(5500, 29), pitch: 0, bearing: 0 };

/** 点到折线的距离，公里（小范围内按平面算）。 */
function distanceToLineKm(p: LngLat, line: LngLat[]): number {
  const kx = 111.32 * Math.cos((p[1] * Math.PI) / 180);
  const ky = 110.57;
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1][0] - p[0]) * kx;
    const ay = (line[i - 1][1] - p[1]) * ky;
    const dx = (line[i][0] - line[i - 1][0]) * kx;
    const dy = (line[i][1] - line[i - 1][1]) * ky;
    const t = Math.min(1, Math.max(0, -(ax * dx + ay * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

describe('相邻两站之间的飞行', () => {
  const plan = planFlight(atBianjing, atHuangzhou, [atBianjing.center, ...leg, atHuangzhou.center], { zoomForDistanceKm });

  it('用时在 4 到 9 秒之间', () => {
    expect(plan.durationMs).toBeGreaterThanOrEqual(FLIGHT_MIN_MS);
    expect(plan.durationMs).toBeLessThanOrEqual(FLIGHT_MAX_MS);
  });

  it('从起点的镜头出发，正好停在终点的镜头上', () => {
    expect(plan.at(0)).toEqual(atBianjing);
    expect(plan.at(1)).toEqual(atHuangzhou);
    expect(plan.at(2)).toEqual(atHuangzhou);
  });

  it('镜头中心一直贴着这一段轨迹，并且只往前走', () => {
    let travelled = -1;
    for (let i = 0; i <= 100; i++) {
      const c = plan.at(i / 100).center;
      expect(distanceToLineKm(c, leg)).toBeLessThan(12);
      const done = haversineKm(bianjing, c);
      expect(done).toBeGreaterThanOrEqual(travelled - 1);
      travelled = done;
    }
  });

  it('途中升高，起步和收尾都慢', () => {
    const lowest = Math.min(atBianjing.zoom, atHuangzhou.zoom);
    expect(plan.at(0.5).zoom).toBeLessThan(lowest - 2);
    expect(haversineKm(plan.at(0).center, plan.at(0.05).center)).toBeLessThan(1);
    expect(haversineKm(plan.at(0.95).center, plan.at(1).center)).toBeLessThan(1);
  });
});

describe('从总览降到一站', () => {
  const plan = planFlight(overview, atHuangzhou, [overview.center, atHuangzhou.center], { zoomForDistanceKm });

  it('一路往下，不先升高', () => {
    let zoom = overview.zoom;
    for (let i = 1; i <= 100; i++) {
      const next = plan.at(i / 100).zoom;
      expect(next).toBeGreaterThanOrEqual(zoom - 1e-9);
      zoom = next;
    }
    expect(plan.at(1)).toEqual(atHuangzhou);
  });
});

describe('回到这一站', () => {
  it('只转了方向时，原地转回去，用时不到 2.5 秒', () => {
    const turned: Camera = { ...atHuangzhou, bearing: 120, pitch: 30 };
    const plan = planFlight(turned, atHuangzhou, [turned.center, atHuangzhou.center], { zoomForDistanceKm, quick: true });
    expect(plan.durationMs).toBeLessThanOrEqual(2500);
    expect(plan.at(0.5).center).toEqual(atHuangzhou.center);
    expect(plan.at(1)).toEqual(atHuangzhou);
  });
});

describe('小地图上各站的镜头拉近', () => {
  it('短边 720 像素以上，距离不变', () => {
    expect(stopDistanceScale(1440, 900)).toBe(1);
    expect(stopDistanceScale(900, 1440)).toBe(1);
    expect(stopDistanceScale(720, 720)).toBe(1);
  });

  it('短边不到 720 像素，按短边的比例拉近，横放竖放一样', () => {
    expect(stopDistanceScale(1000, 640)).toBeCloseTo(640 / 720, 12);
    expect(stopDistanceScale(768, 410)).toBeCloseTo(410 / 720, 12);
    expect(stopDistanceScale(410, 768)).toBeCloseTo(410 / 720, 12);
  });

  it('最多拉近到 0.55 倍', () => {
    expect(stopDistanceScale(390, 337)).toBe(0.55);
    expect(stopDistanceScale(0, 0)).toBe(0.55);
  });
});

describe('路径', () => {
  it('跨过 180 度经线时走近的一边', () => {
    const path = new Path([[170, 0], [-170, 0]]);
    expect(path.totalKm).toBeLessThan(2300);
    expect(path.at(0.5)[0]).toBeCloseTo(180, 5);
  });

  it('方位角插值走近的一边', () => {
    expect(lerpAngle(170, -170, 0.5)).toBeCloseTo(180, 5);
    expect(lerpAngle(-15, 10, 1)).toBeCloseTo(10, 5);
  });
});

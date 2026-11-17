// 轨迹相关纯逻辑的单元测试：toMapRoute、neighbours。

import { describe, expect, it } from 'vitest';
import { neighbours, toMapRoute } from '../../src/domain/route';
import type { Figure, LngLat, StopMeta } from '../../src/domain/types';

function stop(id: string, lngLat: LngLat, extra: Partial<StopMeta> = {}): StopMeta {
  return {
    id,
    title: `${id}：站名`,
    shortTitle: id,
    years: '1080',
    age: '四十四岁',
    place: { id, ancient: `古${id}`, modern: `今${id}`, lngLat },
    camera: { distanceKm: 20, pitch: 60, bearing: 0 },
    summary: '一句话。',
    status: 'outline',
    localPlaces: [],
    ...extra,
  };
}

const figure: Figure = {
  id: 'demo',
  name: '示例',
  era: '某代',
  years: '1000–1060',
  tagline: '一句话介绍。',
  intro: ['他是谁。'],
  overview: { center: [112, 30], distanceKm: 3000 },
  stops: [
    stop('a', [100, 30], { camera: { distanceKm: 70, pitch: 55, bearing: -20 } }),
    stop('b', [110, 31], {
      localPlaces: [
        { id: 'ting', ancient: '临皋亭', modern: '临皋亭旧址', lngLat: [110.1, 31.1] },
        { id: 'po', ancient: '东坡', modern: '东坡旧址', lngLat: [110.2, 31.2] },
      ],
    }),
    stop('c', [120, 32], { localPlaces: [{ id: 'ting', ancient: '望湖楼', modern: '望湖楼', lngLat: [120.1, 32.1] }] }),
  ],
  legs: [
    {
      from: 'a',
      to: 'b',
      via: [
        { name: '甲', lngLat: [103, 30.2] },
        { name: '乙', lngLat: [106, 30.6] },
      ],
    },
    { from: 'b', to: 'c', via: [] },
  ],
};

describe('toMapRoute', () => {
  const route = toMapRoute(figure);

  it('总览镜头原样带过去', () => {
    expect(route.overview).toEqual({ center: [112, 30], distanceKm: 3000 });
  });

  it('各站按先后排列，序号从 1 开始，带上古今地名、坐标和镜头', () => {
    expect(route.stops).toEqual([
      { id: 'a', order: 1, ancient: '古a', modern: '今a', lngLat: [100, 30], camera: { distanceKm: 70, pitch: 55, bearing: -20 } },
      { id: 'b', order: 2, ancient: '古b', modern: '今b', lngLat: [110, 31], camera: { distanceKm: 20, pitch: 60, bearing: 0 } },
      { id: 'c', order: 3, ancient: '古c', modern: '今c', lngLat: [120, 32], camera: { distanceKm: 20, pitch: 60, bearing: 0 } },
    ]);
  });

  it('每段路从起点站出发，依次经过途经点，到终点站', () => {
    expect(route.legs).toEqual([
      {
        from: 'a',
        to: 'b',
        path: [
          [100, 30],
          [103, 30.2],
          [106, 30.6],
          [110, 31],
        ],
      },
      {
        from: 'b',
        to: 'c',
        path: [
          [110, 31],
          [120, 32],
        ],
      },
    ]);
  });

  it('路的段数比站少一个，并且首尾相连', () => {
    expect(route.legs).toHaveLength(route.stops.length - 1);
    route.legs.forEach((leg, i) => {
      expect(leg.path[0]).toEqual(route.stops[i].lngLat);
      expect(leg.path[leg.path.length - 1]).toEqual(route.stops[i + 1].lngLat);
    });
  });

  it('站内地点带上所属的站；不同站里同名的 id 不会撞在一起', () => {
    expect(route.places).toEqual([
      { id: 'b/ting', stopId: 'b', ancient: '临皋亭', modern: '临皋亭旧址', lngLat: [110.1, 31.1] },
      { id: 'b/po', stopId: 'b', ancient: '东坡', modern: '东坡旧址', lngLat: [110.2, 31.2] },
      { id: 'c/ting', stopId: 'c', ancient: '望湖楼', modern: '望湖楼', lngLat: [120.1, 32.1] },
    ]);
    expect(new Set(route.places.map((p) => p.id)).size).toBe(route.places.length);
  });

  it('只有一站时没有路', () => {
    const single = toMapRoute({ ...figure, stops: [figure.stops[0]], legs: [] });
    expect(single.stops).toHaveLength(1);
    expect(single.legs).toEqual([]);
    expect(single.places).toEqual([]);
  });

  it('不改动传进来的人物数据', () => {
    const before = JSON.stringify(figure);
    toMapRoute(figure);
    expect(JSON.stringify(figure)).toBe(before);
  });
});

describe('neighbours', () => {
  it('中间的站有上一站和下一站', () => {
    const { index, prev, next } = neighbours(figure, 'b');
    expect(index).toBe(1);
    expect(prev?.id).toBe('a');
    expect(next?.id).toBe('c');
  });

  it('第一站没有上一站', () => {
    const { index, prev, next } = neighbours(figure, 'a');
    expect(index).toBe(0);
    expect(prev).toBeNull();
    expect(next?.id).toBe('b');
  });

  it('最后一站没有下一站', () => {
    const { index, prev, next } = neighbours(figure, 'c');
    expect(index).toBe(2);
    expect(prev?.id).toBe('b');
    expect(next).toBeNull();
  });

  it('找不到这一站时 index 为 -1，前后都没有', () => {
    expect(neighbours(figure, 'nowhere')).toEqual({ index: -1, prev: null, next: null });
  });

  it('只有一站时前后都没有', () => {
    expect(neighbours({ ...figure, stops: [figure.stops[0]], legs: [] }, 'a')).toEqual({ index: 0, prev: null, next: null });
  });
});

// 轨迹相关纯逻辑的单元测试：neighbours。

import { describe, expect, it } from 'vitest';
import { neighbours } from '../../src/domain/route';
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

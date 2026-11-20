// 轨迹相关纯逻辑的单元测试：neighbours。后面是页面读地址的程序（哪一页）。

import { describe, expect, it } from 'vitest';
import { figureHref, homeHref, parseHash, sourcesHref, stopHref } from '../../src/app/router';
import { neighbours } from '../../src/domain/route';
import { RESERVED_FIGURE_IDS } from '../content/rules';
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

// 页面读地址的程序（src/app/router.ts）：# 后面的那一截是哪一页。
describe('地址', () => {
  it('四种页面：首页、“来源”页、人物页、站点页', () => {
    for (const hash of ['', '#', '#/', '#//']) expect(parseHash(hash), `“${hash}”`).toEqual({ page: 'home' });
    expect(parseHash('#/sources')).toEqual({ page: 'sources' });
    expect(parseHash('#/sources/')).toEqual({ page: 'sources' });
    expect(parseHash('#/su-shi')).toEqual({ page: 'figure', figureId: 'su-shi' });
    expect(parseHash('#/su-shi/xuzhou')).toEqual({ page: 'stop', figureId: 'su-shi', stopId: 'xuzhou' });
    // 大小写不一样的、后面还跟着一截的，不是“来源”页（照人物、照一站去找，找不到就说没有）
    expect(parseHash('#/Sources')).toEqual({ page: 'figure', figureId: 'Sources' });
    expect(parseHash('#/sources/x')).toEqual({ page: 'stop', figureId: 'sources', stopId: 'x' });
  });

  it('链接写出来再读回去是同一页；名字里的汉字、斜线都转得回来', () => {
    expect(parseHash(homeHref)).toEqual({ page: 'home' });
    expect(sourcesHref).toBe('#/sources');
    expect(parseHash(sourcesHref)).toEqual({ page: 'sources' });
    expect(parseHash(figureHref('su-shi'))).toEqual({ page: 'figure', figureId: 'su-shi' });
    expect(parseHash(stopHref('苏轼', '徐/州'))).toEqual({ page: 'stop', figureId: '苏轼', stopId: '徐/州' });
    // 转码坏了的地址不让页面出错，原样当名字用
    expect(parseHash('#/%E4%')).toEqual({ page: 'figure', figureId: '%E4%' });
  });

  it('内容校验不许做人物 id 的词，正好是地址里另有用处的那几个：照人物页的写法写出来，读回去不是人物页', () => {
    expect(RESERVED_FIGURE_IDS.length).toBeGreaterThan(0);
    for (const id of RESERVED_FIGURE_IDS) expect(parseHash(figureHref(id)).page, `#/${id}`).not.toBe('figure');
    // 反过来：平常的 id 都是人物页（表里没有多列）
    for (const id of ['su-shi', 'xu-xiake', 'darwin', 'source', 'home']) {
      expect(RESERVED_FIGURE_IDS).not.toContain(id);
      expect(parseHash(figureHref(id))).toEqual({ page: 'figure', figureId: id });
    }
  });
});

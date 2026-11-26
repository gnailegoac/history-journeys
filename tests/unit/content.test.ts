// 读取内容的单元测试：loadFigureCards、loadFigure、loadStop、loadItinerarySources，对着真实的 content/ 目录。
// 这里只管“读得对不对”；内容本身合不合规格由 npm run validate 管。

import { describe, expect, it } from 'vitest';
import { parseBody } from '../../src/domain/body';
import { loadFigure, loadFigureCards, loadItinerarySources, loadStop } from '../../src/domain/content';
import type { ItinerarySource } from '../../src/domain/itinerary';
import type { Figure, FigureCard, StopExtras } from '../../src/domain/types';

const ROOT = '/content/figures';

// 直接从磁盘读到的文字，用来和读取函数的结果对照。
const texts = import.meta.glob<string>('/content/figures/**/*.{json,md}', { query: '?raw', import: 'default', eager: true });
// 目录里有哪些文件（含图片），只用路径，不读内容。
const paths = new Set(Object.keys(import.meta.glob('/content/figures/**/*')));

function json<T>(path: string): T {
  return JSON.parse(texts[path].replace(/^﻿/, '')) as T;
}

const cardsOnDisk = json<FigureCard[]>(`${ROOT}/index.json`);
const figureIdsOnDisk = Object.keys(texts)
  .map((path) => /^\/content\/figures\/([^/]+)\/figure\.json$/.exec(path)?.[1])
  .filter((id): id is string => id !== undefined);

describe('loadFigureCards', () => {
  it('读出 index.json 里的全部卡片，一张不多、一张不少', async () => {
    const cards = await loadFigureCards();
    expect(cards.length).toBeGreaterThan(0);
    expect(cards).toHaveLength(cardsOnDisk.length);
    for (const card of cardsOnDisk) expect(cards).toContainEqual(card);
  });

  it('按 sortYear 从早到晚排列', async () => {
    const years = (await loadFigureCards()).map((c) => c.sortYear);
    expect(years).toEqual([...years].sort((a, b) => a - b));
  });

  it('每次给出新的数组，调用的人改了它不影响下一次', async () => {
    const first = await loadFigureCards();
    first.reverse();
    const second = await loadFigureCards();
    const years = second.map((c) => c.sortYear);
    expect(years).toEqual([...years].sort((a, b) => a - b));
  });
});

describe('loadFigure', () => {
  it('目录里有的人物，读出来和 figure.json 一样', async () => {
    expect(figureIdsOnDisk.length).toBeGreaterThan(0);
    for (const id of figureIdsOnDisk) {
      expect(await loadFigure(id)).toEqual(json<Figure>(`${ROOT}/${id}/figure.json`));
    }
  });

  it('可以点进去的卡片都读得到人物', async () => {
    for (const card of cardsOnDisk.filter((c) => c.available)) {
      const figure = await loadFigure(card.id);
      expect(figure, `卡片 ${card.id} 可以点进去，却读不到人物`).not.toBeNull();
      expect(figure?.id).toBe(card.id);
    }
  });

  it('没有这位人物时返回 null', async () => {
    expect(await loadFigure('no-such-figure')).toBeNull();
    for (const card of cardsOnDisk.filter((c) => !figureIdsOnDisk.includes(c.id))) {
      expect(await loadFigure(card.id)).toBeNull();
    }
  });
});

describe('loadStop', () => {
  it('正文和 .json 都在的站读得出来，缺一个就是 null', async () => {
    let loaded = 0;
    for (const figureId of figureIdsOnDisk) {
      const figure = json<Figure>(`${ROOT}/${figureId}/figure.json`);
      for (const meta of figure.stops) {
        const base = `${ROOT}/${figureId}/stops/${meta.id}`;
        const written = paths.has(`${base}.md`) && paths.has(`${base}.json`);
        const stop = await loadStop(figureId, meta.id);
        expect(stop !== null, `${figureId}/${meta.id}`).toBe(written);
        if (stop) loaded += 1;
      }
    }
    expect(loaded, '至少要有一站读得出来').toBeGreaterThan(0);
  });

  it('读出来的小注、原文、图片、凭据和 .json 文件里的一样', async () => {
    for (const { figureId, stopId } of writtenStops()) {
      const stop = await loadStop(figureId, stopId);
      const extras = json<StopExtras>(`${ROOT}/${figureId}/stops/${stopId}.json`);
      expect(stop).toMatchObject(extras);
    }
  });

  it('小节和段落与 .md 文件一致，标小注没有改动一个字', async () => {
    for (const { figureId, stopId } of writtenStops()) {
      const stop = await loadStop(figureId, stopId);
      const raw = parseBody(texts[`${ROOT}/${figureId}/stops/${stopId}.md`]);
      expect(stop?.sections.map((s) => s.heading)).toEqual(raw.map((s) => s.heading));
      stop?.sections.forEach((section, i) => {
        const blocks = section.blocks.map((b) => (b.type === 'paragraph' ? b.segments.map((s) => s.text).join('') : b.lines.join('\n')));
        const rawBlocks = raw[i].blocks.map((b) => (b.type === 'paragraph' ? b.text : b.lines.join('\n')));
        expect(blocks, `${figureId}/${stopId} 小节“${section.heading}”`).toEqual(rawBlocks);
      });
    }
  });

  it('标出来的每一处都是某条小注的原词，同一条小注只标一处', async () => {
    for (const { figureId, stopId } of writtenStops()) {
      const stop = await loadStop(figureId, stopId);
      if (!stop) continue;
      const anchors = new Map(stop.notes.map((n) => [n.id, n.anchor]));
      const seen: string[] = [];
      for (const section of stop.sections) {
        for (const block of section.blocks) {
          if (block.type !== 'paragraph') continue;
          for (const segment of block.segments) {
            if (segment.noteId === undefined) continue;
            expect(anchors.get(segment.noteId), `${figureId}/${stopId} 小注 ${segment.noteId}`).toBe(segment.text);
            seen.push(segment.noteId);
          }
        }
      }
      expect(new Set(seen).size).toBe(seen.length);
    }
  });

  it('图片文件在的给出网址，不在的不给', async () => {
    for (const { figureId, stopId } of writtenStops()) {
      const stop = await loadStop(figureId, stopId);
      if (!stop) continue;
      const present = stop.images.map((image) => image.file).filter((file) => paths.has(`${ROOT}/${figureId}/images/${file}`));
      expect(Object.keys(stop.imageUrls).sort()).toEqual([...new Set(present)].sort());
      for (const url of Object.values(stop.imageUrls)) expect(url).not.toBe('');
    }
  });

  it('没有这位人物或没有这一站时返回 null', async () => {
    expect(await loadStop('no-such-figure', 'no-such-stop')).toBeNull();
    for (const figureId of figureIdsOnDisk) expect(await loadStop(figureId, 'no-such-stop')).toBeNull();
    for (const { stopId } of writtenStops()) expect(await loadStop('no-such-figure', stopId)).toBeNull();
  });
});

describe('loadItinerarySources', () => {
  it('有行迹的人物：读出来的就是手写的那一份（itinerary.json）里的 sources，一条不多、一条不少，先后不变', async () => {
    const withItinerary = figureIdsOnDisk.filter((id) => paths.has(`${ROOT}/${id}/itinerary.json`));
    expect(withItinerary.length).toBeGreaterThan(0);
    for (const id of withItinerary) {
      const hand = json<{ sources: ItinerarySource[] }>(`${ROOT}/${id}/itinerary.json`);
      expect(hand.sources.length).toBeGreaterThan(0);
      expect(await loadItinerarySources(id), id).toEqual(hand.sources);
    }
  });

  it('没有这位人物、还没有行迹的人物：空的', async () => {
    expect(await loadItinerarySources('no-such-figure')).toEqual([]);
    for (const id of figureIdsOnDisk.filter((figureId) => !paths.has(`${ROOT}/${figureId}/itinerary.json`))) expect(await loadItinerarySources(id), id).toEqual([]);
  });
});

/** 磁盘上正文和 .json 都在的站。 */
function writtenStops(): { figureId: string; stopId: string }[] {
  const stops: { figureId: string; stopId: string }[] = [];
  for (const path of paths) {
    const match = /^\/content\/figures\/([^/]+)\/stops\/([^/]+)\.md$/.exec(path);
    if (match && paths.has(path.replace(/\.md$/, '.json'))) stops.push({ figureId: match[1], stopId: match[2] });
  }
  return stops;
}

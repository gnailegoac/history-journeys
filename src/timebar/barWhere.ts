// 哪一天，小像站在哪：时间轴用的那一份行迹（content/figures/<人物>/itinerary.bar.json）里的一段 → 交给沙盘的说法（src/stage/types.ts 的 PiecePlace）。
// 只算数。页面这一边手里没有路的线：只说“在哪个地名点上”“在哪一截路上的哪一处”“哪几截路、从哪一头到哪一头、走到几成”，
// 线在沙盘那一边（src/stage/pieceWhere.ts）。日子是“从 day0 数起的第几天”，可以带小数；这里从不把它写成哪一天给读者看。

import type { ItineraryBar, ItineraryBarStretch } from '../domain/itinerary';
import type { PieceEnd, PiecePlace } from '../stage/types';

/** 第 day 天落在第几段（从 0 数）：头一段从第 0 天起，每一段到它的 until 为止（until 那一刻算下一段的）；出了两头的算头一段、最后一段。 */
export function stretchIndexAt(bar: ItineraryBar, day: number): number {
  const list = bar.stretches;
  let i = 0;
  while (i < list.length - 1 && day >= list[i].until) i++;
  return i;
}

/** 第 index 段从第几天起（上一段的 until；头一段是第 0 天）。 */
export function stretchStart(bar: ItineraryBar, index: number): number {
  return index > 0 ? bar.stretches[index - 1].until : 0;
}

/**
 * 这一段里的第 day 天，小像站在哪；沙盘上没有他的一段是 null。from 是这一段从第几天起。
 * 路上的一段照“精确到日、又有位置的各处”（legs）分成几程：每一程从前一处到后一处，照日子匀着走。
 */
export function whereInStretch(stretch: ItineraryBarStretch, from: number, day: number): PiecePlace | null {
  if (stretch.place !== undefined) return { on: 'place', place: stretch.place };
  if (stretch.spot) return { on: 'spot', way: stretch.spot[0], at: [stretch.spot[1][0], stretch.spot[1][1]] };
  if (!stretch.ways) return null;
  const cuts: { day: number; end: PieceEnd }[] = [{ day: from, end: 'start' }];
  for (const [at, when] of stretch.legs ?? []) cuts.push({ day: when, end: [at[0], at[1]] });
  cuts.push({ day: stretch.until, end: 'end' });
  let j = 0;
  while (j < cuts.length - 2 && day >= cuts[j + 1].day) j++;
  const a = cuts[j];
  const b = cuts[j + 1];
  return { on: 'road', ways: stretch.ways, from: a.end, to: b.end, k: b.day > a.day ? Math.min(1, Math.max(0, (day - a.day) / (b.day - a.day))) : 0 };
}

/** 第 day 天小像站在哪；沙盘上没有他是 null。 */
export function whereAt(bar: ItineraryBar, day: number): PiecePlace | null {
  const i = stretchIndexAt(bar, day);
  return whereInStretch(bar.stretches[i], stretchStart(bar, i), day);
}

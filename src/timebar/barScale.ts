// 时间轴的刻度：哪一天落在轴的哪里。只算数，不碰页面。
// 轴不是匀的。行迹里的每一段是轴上的一格，从上一段的 until 到它自己的 until：
//   一趟画出来的路 5 个单位（几十天的路和几年的住处差不多宽，路上的日子才拖得动）；
//   一站住下来的年月 max(3, 2·√年数)；
//   别的（沙盘上有、不在各站年份里的地方，沙盘上没有他的年月）max(1, 1.5·√年数)。
// 一格里面是匀的：过了这一格几成的日子，就在这一格几成的地方（路上的一格也一样，路上有日子的各处之间都照日子匀着排）。
// 位置的单位是“单位”，乘上“一个单位多少像素”（轴宽 ÷ 一共多少单位）才是像素。

import type { ItineraryBar, ItineraryLook } from '../domain/itinerary';

/** 一趟路在轴上占几个单位。 */
export const ROAD_UNITS = 5;
/** 一站住下来的年月至少占几个单位；别的至少几个。 */
export const STAY_MIN_UNITS = 3;
export const OTHER_MIN_UNITS = 1;
/** 一年多少天（算“年数”用）。 */
const DAYS_A_YEAR = 365.25;
/** 住下来的格子至少这么宽（像素）才画两道斜线。 */
export const SQUEEZE_MIN_PX = 9;
/** 两个年份的数字至少隔这么远（像素），不到的后一个不写。 */
export const YEAR_GAP_PX = 40;
/** 不到这么宽（像素）的空格子、白底格子不画左右两条边：好几格挤在一起的地方只剩上下两道线。 */
export const THIN_BLOCK_PX = 4;

/** 轴上的一格。 */
export interface BarBlock {
  /** 行迹里的第几段（从 0 数）。 */
  index: number;
  id: string;
  look: ItineraryLook;
  /** 落在哪一站讲的年月里；不在哪一站的没有。 */
  group?: string;
  /** 路上的一格是不是画虚线（有一截是示意的）。 */
  dashed: boolean;
  /** 从第几天到第几天。 */
  from: number;
  until: number;
  /** 在轴上从第几个单位到第几个单位。 */
  u0: number;
  u1: number;
}

export interface BarScale {
  blocks: BarBlock[];
  /** 一共多少单位。 */
  total: number;
  /** 最后一天是第几天（头一天是第 0 天）。 */
  lastDay: number;
}

/** 这样一段、这么多天，在轴上占几个单位。 */
export function blockUnits(look: ItineraryLook, days: number): number {
  const years = Math.max(0, days) / DAYS_A_YEAR;
  if (look === 'road') return ROAD_UNITS;
  return look === 'stop' ? Math.max(STAY_MIN_UNITS, 2 * Math.sqrt(years)) : Math.max(OTHER_MIN_UNITS, 1.5 * Math.sqrt(years));
}

/** 照一位人物的行迹排出轴上的每一格。 */
export function barScale(bar: Pick<ItineraryBar, 'stretches'>): BarScale {
  const blocks: BarBlock[] = [];
  let from = 0;
  let u = 0;
  bar.stretches.forEach((stretch, index) => {
    const units = blockUnits(stretch.look, stretch.until - from);
    blocks.push({ index, id: stretch.id, look: stretch.look, group: stretch.group, dashed: stretch.dashed?.some(Boolean) ?? false, from, until: stretch.until, u0: u, u1: u + units });
    from = stretch.until;
    u += units;
  });
  return { blocks, total: u, lastDay: from };
}

/** 第 day 天在轴上的第几个单位。出了两头的算两头。 */
export function unitsAt(scale: BarScale, day: number): number {
  if (day <= 0) return 0;
  if (day >= scale.lastDay) return scale.total;
  const block = scale.blocks.find((b) => day < b.until) ?? scale.blocks[scale.blocks.length - 1];
  return block.u0 + ((day - block.from) / (block.until - block.from)) * (block.u1 - block.u0);
}

/** 轴上的第 units 个单位是第几天（unitsAt 倒过来）。出了两头的算两头。 */
export function dayAt(scale: BarScale, units: number): number {
  if (units <= 0) return 0;
  if (units >= scale.total) return scale.lastDay;
  const block = scale.blocks.find((b) => units < b.u1) ?? scale.blocks[scale.blocks.length - 1];
  return block.from + ((units - block.u0) / (block.u1 - block.u0)) * (block.until - block.from);
}

/** 轴下面的一道刻度：公元哪一年，在第几个单位。 */
export interface BarTick {
  year: number;
  u: number;
}

/**
 * 每十年一道的刻度，再加最前面的一道（行迹里头一个有正月初一的年份：1037）。一道刻度就在那一个农历年正月初一的地方，
 * 所以它们之间不一样远——这是说“这条轴不匀”的一样记号。
 */
export function barTicks(bar: Pick<ItineraryBar, 'years'>, scale: BarScale): BarTick[] {
  const dated = bar.years.filter((row): row is [number, string, number, number] => row[2] !== null);
  return dated.filter((row, i) => i === 0 || row[0] % 10 === 0).map((row) => ({ year: row[0], u: unitsAt(scale, row[2]) }));
}

/** 哪几道刻度下面写年份：头一道总写；后面的，离上一个写了的不到 YEAR_GAP_PX 像素就不写。pxPerUnit 是一个单位多少像素。 */
export function labelledTicks(ticks: readonly BarTick[], pxPerUnit: number): BarTick[] {
  const out: BarTick[] = [];
  for (const tick of ticks) {
    const last = out[out.length - 1];
    if (!last || (tick.u - last.u) * pxPerUnit >= YEAR_GAP_PX) out.push(tick);
  }
  return out;
}

/** 这一格画不画两道斜线（“这一格是压窄了画的”）：住下来的格子（一站的，和沙盘上有的别的地方的）够宽才画；路上的、没有他的不画。 */
export function squeezed(block: BarBlock, pxPerUnit: number): boolean {
  return (block.look === 'stop' || block.look === 'quiet') && (block.u1 - block.u0) * pxPerUnit >= SQUEEZE_MIN_PX;
}

/** 一站讲的那几年（来路加上住下来的年月）在轴上从哪到哪，照先后。一站的几段是连着的（校验的规则 22 守着）。 */
export function groupSpans(scale: BarScale): { stop: string; u0: number; u1: number }[] {
  const out: { stop: string; u0: number; u1: number }[] = [];
  for (const block of scale.blocks) {
    if (!block.group) continue;
    const last = out[out.length - 1];
    if (last && last.stop === block.group) last.u1 = block.u1;
    else out.push({ stop: block.group, u0: block.u0, u1: block.u1 });
  }
  return out;
}

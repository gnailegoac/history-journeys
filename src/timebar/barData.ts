// 时间轴用的那一份行迹（content/figures/<人物>/itinerary.bar.json，工具做的：npm run itinerary）。
// 整份跟着时间轴的那一段程序走（import.meta.glob 写成 eager）：这个文件只许时间轴的那一块引，页面的程序引了它，
// 每位人物的行迹就都进了页面一打开就下载的程序。手写的那一份（itinerary.json）不在这里，哪一段程序也不带它。

import type { ItineraryBar } from '../domain/itinerary';

const files = import.meta.glob<ItineraryBar>('/content/figures/*/itinerary.bar.json', { import: 'default', eager: true });

/** 这座全程沙盘（key 是“人物/route”）的那位人物的行迹；这位人物还没有行迹是 null。 */
export function barFor(tableKey: string): ItineraryBar | null {
  return files[`/content/figures/${tableKey.split('/')[0]}/itinerary.bar.json`] ?? null;
}

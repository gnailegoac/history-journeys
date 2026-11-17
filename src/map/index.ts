// 地图适配层的入口。界面只从这里和 types.ts 取东西。
// 这个文件要保持很小：引擎的代码用动态 import 加载，不显示地图的页面不会下载它。

import type { MapEngine } from './types';

/** 地图上要告诉读者的一句话。 */
export const MAP_DATA_NOTICE = '地图上的山川、河道、湖泊和海岸线是今天的样子，和当时不完全一样。';

/** 取得地图引擎。第一次调用时才下载引擎的代码和样式表。 */
export async function loadMapEngine(): Promise<MapEngine> {
  const { engine } = await import('./maplibre/engine');
  return engine;
}

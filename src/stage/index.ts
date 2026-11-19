// 沙盘适配层的入口。页面只从这里、types.ts 和 overlay 取东西。
// 这个文件要保持很小：沙盘程序（three.js 和造沙盘的代码）用动态 import 加载，没有沙盘的页面不会下载它。
// 定格图的沙盘（stillEngine）和“这个浏览器能不能画立体的沙盘”（probeWebgl）是直接带上的：
// 它们很小，不碰 three，而且正是在沙盘程序下载之前、下载不了的时候要用。

import type { StageEngine } from './types';

export { stillEngine } from './still';
export { probeWebgl } from './support';

/** 取得沙盘程序。第一次调用时才下载它的代码。 */
export async function loadStageEngine(): Promise<StageEngine> {
  const { engine } = await import('./three/engine');
  return engine;
}

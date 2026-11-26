// 沙盘适配层的入口。页面只从这里、types.ts 和 overlay 取东西。
// 这个文件要保持很小：沙盘程序（three.js 和造沙盘的代码）用动态 import 加载，没有沙盘的页面不会下载它。
// 定格图的沙盘（stillEngine）和“这个浏览器能不能画立体的沙盘”（probeWebgl）是直接带上的：
// 它们很小，不碰 three，而且正是在沙盘程序下载之前、下载不了的时候要用。

import { FAMILIES } from './families';
import { STYLES } from './styles';
import type { StageEngine } from './types';

export { stillEngine } from './still';
export { probeWebgl } from './support';

/**
 * 取得沙盘程序。第一次调用时才下载它的代码。
 * 全程沙盘另有一小块程序，摆全程沙盘时才下载：怎么取在这里交给沙盘程序（这一句动态 import 要是写在沙盘程序里面，
 * 打包的工具会把页面的程序拆成两个文件；tests/build/dist-size.test.ts 守着）。
 * 按家分块的零件也是这样交进去的：登记表在 ./families.ts。时代样式也是：登记表在 ./styles.ts。
 * 样式那一小块不在这里先要：它引着沙盘程序，赶在沙盘程序前头去要它的话，沙盘程序没取到的那一回会被它再要一遍
 * （tests/e2e/pane-stills.spec.ts 里“沙盘程序头一次没取到”那一条守着：没取到的那一回只要过一次）。
 * 沙盘一摆就自己照登记表去取（src/stage/three/view.ts 的 build）：那时沙盘程序刚到，样式和地形文件一起在路上，不多等一个来回。
 */
export async function loadStageEngine(): Promise<StageEngine> {
  const { engine, provideFamilies, provideRouteLevel, provideStyles } = await import('./three/engine');
  provideRouteLevel(() => import('./three/routeLevel'));
  provideFamilies(FAMILIES);
  provideStyles(STYLES);
  return engine;
}

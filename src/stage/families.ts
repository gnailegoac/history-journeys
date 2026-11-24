// 按家分块的零件的登记表：一家叫什么、管哪几种、从哪里取。
// 只有一部分沙盘用得着的零件不放在沙盘程序里，一家一小块，场景里写到了才下载（怎么用见 ./three/kit/families.ts）。
// 以后的沙盘添新零件：在这里添一行，把程序放进 ./three/families/ 里它那一家的文件；沙盘程序不用动。
// 这个文件跟着页面的程序走（取它们的动态 import 只能写在这一边），所以只有这张表，别的不放。

import type { FamilyEntry } from './three/kit/families';

export const FAMILIES: readonly FamilyEntry[] = [
  /** 石和土：崖壁，不闭合的矮土墙，单立的小门，只在水落时露出来的石头。 */
  { name: 'rock', holds: ['cliff', 'earth-wall', 'small-gate', 'rocks:shore'], load: () => import('./three/families/rock') },
  /** 草木：竹，柏。 */
  { name: 'plants', holds: ['trees:bamboo', 'trees:cypress'], load: () => import('./three/families/plants') },
  /** 小工程：浮桥，池，坟。 */
  { name: 'works', holds: ['pontoon-bridge', 'pool', 'grave-mound'], load: () => import('./three/families/works') },
];

// 草木这一家：竹和柏（点缀 trees 的 type: bamboo、cypress）。
// 按家分块：场景里写到了这两种里的一种，造模型以前才下载这个文件（登记在 src/stage/families.ts，规矩见 ../kit/families.ts）。
// 没有新的形状：都是苔点，只是细高；怎么种在 ../kit/trees.ts（一处一棵或一丛，贴近了也不换成细做的）。只算数，不碰页面。

import type { KitFamily } from '../kit/families';
// 这一句只为打包：这一家的程序只在沙盘程序已经下载了以后才取。写了这一句，打包的工具就知道沙盘程序那一块一定在，
// 两边共用的东西（three 的核心、零件库的批次和小工具）留在那一块里直接用；不写的话，它们会被另拆成一块，
// 徐州这样一家也用不着的沙盘也要多下载一个文件、多五千来字节（量过；全程沙盘那一块也是这样写的）。
import '../engine';

export const family: KitFamily = {
  trees: {
    /** 竹：宽 7 到 10 米，高是宽的 1.9 到 2.4 倍；三到五竿一丛，离丛心 6 米以内。淡绿。 */
    bamboo: {
      colour: 'bamboo',
      size: (rnd) => {
        const s = 7 + rnd() * 3;
        return [s, s * (1.9 + rnd() * 0.5)];
      },
      clump: (rnd) => 3 + Math.floor(rnd() * 3),
      spreadM: 6,
    },
    /** 柏：宽 6 到 8 米，高是宽的 3 到 3.6 倍；一处一棵。墨绿。 */
    cypress: {
      colour: 'cypress',
      size: (rnd) => {
        const s = 6 + rnd() * 2;
        return [s, s * (3 + rnd() * 0.6)];
      },
    },
  },
};

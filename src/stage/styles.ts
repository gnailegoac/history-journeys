// 时代样式的登记表：一种样式叫什么、从哪里取。
// 一种样式（颜色、灯、雾、模型跟着远近怎么变、题签抬多高……）是单独的小块程序，摆写着它的沙盘时才下载（怎么用见 ./three/style/index.ts）。
// 一行两个取法：load 取整套（站点沙盘用），loadRoute 只取每一座沙盘都用的那一半（全程沙盘用，它不下载站点沙盘才用的那些数）。
// 场景文件的 style 能写哪几种，就是这张表里有哪几行：npm run validate 照这张表查。
// 添一种样式：在这里添一行，把它的文件放进 ./three/style/<样式的名字>/（整套的入口是 <样式的名字>.ts，那一半是 <样式的名字>-route.ts）；沙盘程序不用动。
// 这个文件跟着页面的程序走（取它们的动态 import 只能写在这一边），所以只有这张表，别的不放。

import type { StyleEntry } from './three/style';

export const STYLES: readonly StyleEntry[] = [
  /** 宋代青绿设色。 */
  { id: 'song-qinglv', load: () => import('./three/style/song-qinglv/song-qinglv'), loadRoute: () => import('./three/style/song-qinglv/song-qinglv-route') },
];

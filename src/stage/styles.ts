// 时代样式的登记表：一种样式叫什么、从哪里取。
// 一种样式（颜色、灯、雾、模型跟着远近怎么变、题签抬多高……）是单独的小块程序，摆写着它的沙盘时才下载（怎么用见 ./three/style/index.ts）。
// 一行两个取法：load 取整套（站点沙盘用），loadRoute 只取每一座沙盘都用的那一半（全程沙盘用，它不下载站点沙盘才用的那些数）。
// 场景文件的 style 能写哪几种，就是这张表里有哪几行：npm run validate 照这张表查。
// 添一种样式：在这里添一行，把它的文件放进 ./three/style/<样式的名字>/（整套的入口是 <样式的名字>.ts，那一半是 <样式的名字>-route.ts）；沙盘程序不用动。
// 这个文件跟着页面的程序走（取它们的动态 import 只能写在这一边），所以只有这张表，别的不放。
//
// 一行上还可以写题签是哪一种（labels）：不写是竖着的纸条（strip），写 'slip' 是平着的纸条（docs/data-spec.md“题签摆在哪”末尾）。
// 这一项只在页面这一边：沙盘程序那一边的那一行（./three/style/index.ts 的 StyleEntry）没有它，所以在这里另写一种行（StyleRow）。
// 谁要知道一座沙盘的题签是哪一种，都问 labelKind，不认样式的名字。

import type { LabelKind } from './overlay/types';
import type { StyleEntry } from './three/style';

/** 登记表里的一行：沙盘程序要的那几样，加上页面这一边才看的。 */
export interface StyleRow extends StyleEntry {
  /** 写着这种样式的沙盘，题签是哪一种。不写是 'strip'。 */
  labels?: LabelKind;
}

export const STYLES: readonly StyleRow[] = [
  /** 宋代青绿设色。 */
  { id: 'song-qinglv', load: () => import('./three/style/song-qinglv/song-qinglv'), loadRoute: () => import('./three/style/song-qinglv/song-qinglv-route') },
];

/** 写着 style 这种样式的沙盘，题签是哪一种。rows 不写用上面那张表（测试交编出来的表）；表里没有这种样式、那一行没写的，都是 'strip'。 */
export const labelKind = (style: string | undefined, rows: readonly StyleRow[] = STYLES): LabelKind => rows.find((row) => row.id === style)?.labels ?? 'strip';

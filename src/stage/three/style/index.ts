// 时代样式的入口：按场景文件里写的 style 取出那一种样式。
// 一种样式是单独的小块程序，不在沙盘程序里：摆写着它的沙盘时才下载，别的沙盘不下载它。
// 一种样式分两半：每一座沙盘都用的一半，站点沙盘才用的一半。全程沙盘只取前一半；站点沙盘取整套（它那一块引着前一半，两小块一起下载）。
// 有哪几种、各从哪里取，登记在 src/stage/styles.ts（页面那一边），取沙盘程序的时候交进来（provideStyles）：
// 取它们的那几句动态 import 不能写在沙盘程序里面，缘故和全程沙盘那一块一样（见 ../view.ts 的 RouteLevelLoader）。
// 添一种样式不用动这里：登记表里添一行，把它的文件放进这个文件夹里以它的名字命名的子文件夹
// （style/<样式的名字>/：整套的入口是 <样式的名字>.ts，全程沙盘用的那一半是 <样式的名字>-route.ts，交出来的东西都叫 style）。

import type { StageStyle, TableStyle } from '../internal';

/** 登记表里的一行。 */
export interface StyleEntry {
  /** 样式的名字：场景文件的 style 写的就是它，它的文件夹也叫这个名字。 */
  id: string;
  /**
   * 取整套样式的程序（站点沙盘用）。可以不写：只有全程沙盘用的样式（它只有每一座沙盘都用的那一半）没有整套可取。
   * 站点沙盘不能写这样的样式（校验的规则 10 挡着）；真拿它去摆站点沙盘，loadStyle 说一句就停。
   */
  load?(): Promise<{ style: StageStyle }>;
  /** 只取每一座沙盘都用的那一半（全程沙盘用）。 */
  loadRoute(): Promise<{ style: TableStyle }>;
}

let registry: readonly StyleEntry[] = [];

/** 把登记表交进来（src/stage/index.ts 取到沙盘程序以后交）。 */
export function provideStyles(list: readonly StyleEntry[]): void {
  registry = list;
}

/**
 * 取 id 这种样式。level 是给哪一层的沙盘取：'stop' 取整套，'route' 只取每一座沙盘都用的那一半。
 * 登记表里没有它，或者它的程序没有取到，都拒绝：沙盘说“没能摆出来”，读者再试一次的时候重新取。
 * 给站点沙盘取一种只有全程沙盘用的样式（那一行没有写 load），也拒绝：话里说了这一行缺什么、场景文件该怎么改。
 * list 不写用交进来的那一张。
 */
export async function loadStyle(id: string, level: 'stop' | 'route', list: readonly StyleEntry[] = registry): Promise<TableStyle> {
  const entry = list.find((row) => row.id === id);
  if (!entry) throw new Error(`样式“${id}”的程序没有登记，沙盘没能摆出来`);
  if (level === 'route') return (await entry.loadRoute()).style;
  // 这一句里的字都是随站的字体里本来就有的（程序里原样写着的字都算进字体：tests/support/fontTool.ts）
  if (!entry.load) throw new Error(`样式“${id}”只有全程沙盘用的那一半（登记的这一行没有 load），摆不了站点沙盘：场景文件的 style 换一种两半都有的样式`);
  return (await entry.load()).style;
}

/** 这一份样式是不是整套的（站点沙盘才用的那几样都在）。 */
function isWhole(style: TableStyle): style is StageStyle {
  return 'ground' in style && 'figure' in style && 'stripLift' in style;
}

/**
 * 站点沙盘要整套样式。给站点沙盘取的样式本来就是整套的（loadStyle 的 stop）；这里核对一下再交出去，
 * 拿着只取了一半的样式来摆站点沙盘的，说一句就停，不带着缺的东西往下造。
 */
export function wholeStyle(style: TableStyle): StageStyle {
  if (!isWhole(style)) throw new Error(`样式“${style.id}”只取了全程沙盘用的那一半，摆不了站点沙盘`);
  return style;
}

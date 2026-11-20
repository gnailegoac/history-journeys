// 题签层的入口。约定见 ./types.ts。
// 沙盘程序、定格图和沙盘的替身都只从这里取：mountStrips 把题签挂进容器，sectionStripSpecs 说一小节要摆哪几条，placeStrips 是算位置的纯函数，
// sideOfSlot 说一个候选的号摆在那一点的哪一边（给测试用）。这个文件夹不碰 three，也不碰地面。

export type { StripInput, StripLayer, StripPlacement, StripSeal, StripSpec } from './types';
export { mountStrips, sectionStripSpecs } from './strips';
export { placeStrips, sideOfSlot } from './placeStrips';

// 题签层的入口。约定见 ./types.ts。
// 沙盘程序、定格图和沙盘的替身都只从这里取：mountStrips 把题签挂进容器，sectionStripSpecs 说一小节要摆哪几条，placeStrips 是算位置的纯函数，
// sideOfSlot 说一个候选的号摆在那一点的哪一边（给测试用）。这个文件夹不碰 three，也不碰地面。

// 另一种题签（平着的纸条）不从这里取：它是单独的一小块程序（./slips.ts），页面那一边取来以后用 labelsIn 记在容器上。

export type { LabelKind, LabelKit, LabelKitMaker, StripInput, StripLayer, StripPlacement, StripPlacer, StripSeal, StripSpec } from './types';
export { labelsIn, mountStrips, sectionStripSpecs } from './strips';
export { placeStrips, sideOfSlot } from './placeStrips';

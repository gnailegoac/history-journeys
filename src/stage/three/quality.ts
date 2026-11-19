// 两档画质各是哪几个数，和画布该用多少像素比。只算数，不碰 three，也不碰页面。
// 挑哪一档、什么时候往下降，在 tier.ts；这里只管“这一档是什么样”。
//
// 这些数都还没有在平板和手机上量过（开发的机器和发布流程的机器都没有显卡）。

import type { StageTier } from '../types';
import type { Quality } from './internal';

/** 完整的一档：照定稿的样张。 */
export const FULL_QUALITY: Quality = {
  tier: 'full',
  pixelRatioCap: 2,
  maxDrawPixels: 4_000_000,
  antialias: true,
  shadowMapSize: 2048,
  treeKeep: 1,
  houseKeep: 1,
  mistLayers: 3,
};

/** 减配的一档：像素少一些，不开抗锯齿，影子贴图小一半，树和成片的民居各留一半，雾只画一层。别的都和完整的一样。 */
export const REDUCED_QUALITY: Quality = {
  tier: 'reduced',
  pixelRatioCap: 1.5,
  maxDrawPixels: 2_000_000,
  antialias: false,
  shadowMapSize: 1024,
  treeKeep: 0.5,
  houseKeep: 0.5,
  mistLayers: 1,
};

/** 某一档画质的那一份数。 */
export function qualityFor(tier: StageTier): Quality {
  return tier === 'reduced' ? REDUCED_QUALITY : FULL_QUALITY;
}

/**
 * 画布用多少像素比：屏幕的像素比，最多到这一档定的数；画布的像素总数超了这一档的上限，再往下调，最低到 1。
 * 取到小数点后两位（四舍五入，所以像素总数可能比上限多出不到百分之一）。cssWidth、cssHeight 是沙盘栏的大小（CSS 像素）。
 */
export function pixelRatioFor(q: Quality, devicePixelRatio: number, cssWidth: number, cssHeight: number): number {
  const area = Math.max(1, cssWidth * cssHeight);
  const ratio = Math.max(1, Math.min(devicePixelRatio || 1, q.pixelRatioCap, Math.sqrt(q.maxDrawPixels / area)));
  return Math.round(ratio * 100) / 100;
}

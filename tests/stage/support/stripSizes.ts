// 题签有多大（CSS 像素）。Node 里的测试量不了页面，就照 src/styles/stage.css 里 .strip 的数算：
//   宽的栏：字 17 像素，字距 0.12em，上下各垫 8、左右各垫 5，边 1 → 宽 29，高 18 + 19.04 × 字数；
//   窄的栏（不到 560 像素宽）：字 14 像素，上下各垫 6、左右各垫 4 → 宽 24，高 14 + 15.68 × 字数。
// 题签是竖写的，所以窄而高。页面上量出来的是整数（offsetWidth、offsetHeight），这里也四舍五入。
//
// 题签的测试（scene-strips）、定格图的测试都从这里取，只有这一处写着这几个数。
// 样式改了（第 2 步要换字体），浏览器测试里有一项会量一条真的题签来和这里比（tests/e2e/pane-stills.spec.ts），
// 比不上就得回来改这里，再把用到它的测试重跑一遍。

import type { NamesMode, StopScene } from '../../../src/domain/scene';
import { stripTexts } from '../../../src/domain/sceneText';
import type { StripInput } from '../../../src/stage/overlay/types';

/** 题签的两种大小：宽的栏用大一号的，窄的栏用小一号的。 */
export type StripSizeKind = 'wide' | 'narrow';

/** 沙盘栏不到这么宽（像素）时题签小一号：stage.css 里那一条 @container 的线。 */
export const STRIP_NARROW_BELOW_PX = 560;

/** 两种大小各自的数：宽；高 = base + perChar × 字数。 */
export const STRIP_SIZE: Record<StripSizeKind, { w: number; base: number; perChar: number }> = {
  wide: { w: 29, base: 18, perChar: 19.04 },
  narrow: { w: 24, base: 14, perChar: 15.68 },
};

/** 这么宽的沙盘栏上，题签是哪一种大小。 */
export function stripSizeKind(paneWidth: number): StripSizeKind {
  return paneWidth < STRIP_NARROW_BELOW_PX ? 'narrow' : 'wide';
}

/** 写着 text 的一条题签多宽多高。字数按一个一个的字算（不按编码的长度）。 */
export function stripSize(text: string, kind: StripSizeKind): { w: number; h: number } {
  const { w, base, perChar } = STRIP_SIZE[kind];
  return { w, h: Math.round(base + [...text].length * perChar) };
}

/**
 * 一小节要摆的题签，照这么宽的沙盘栏算好大小：就是题签层自己量出来、交给 placeStrips 的那一份
 * （先后就是要紧的先后；side 是场景里写的愿望）。names 不写就用当时的名字。
 */
export function sectionStrips(scene: StopScene, heading: string, paneWidth: number, names: NamesMode = 'ancient'): StripInput['strips'] {
  const kind = stripSizeKind(paneWidth);
  return stripTexts(scene, heading, names).map((t, rank) => ({
    id: t.id,
    ...stripSize(t.text, kind),
    rank,
    side: scene.strips.find((s) => s.id === t.id)?.side,
  }));
}

// 题签有多大（CSS 像素）。Node 里的测试量不了页面，就照 src/styles/stage.css 里 .strip 的数算：
//   宽的栏：字 17 像素，字距 0.12em，上垫 6、下垫 16（脚上的那方小红印画在这 16 像素里）、左右各垫 6 → 宽 29，高 22 + 19.04 × 字数；
//   窄的栏（不到 584 像素宽）：字 14 像素，上垫 4、下垫 13、左右各垫 5 → 宽 24，高 17 + 15.68 × 字数。
// 重做顺序第 2 步给题签添了那方印以前，两种各矮 4 像素和 3 像素（18 + … 和 14 + …）。
// 题签是竖写的，所以窄而高。页面上量出来的是整数（offsetWidth、offsetHeight），这里也四舍五入。
//
// 题签的测试（scene-strips）、定格图的测试都从这里取，只有这一处写着这几个数。
// 样式改了，浏览器测试里有一项会量一条真的题签来和这里比（tests/e2e/pane-stills.spec.ts），
// 比不上就得回来改这里，再把用到它的测试重跑一遍。

//
// 题签有两种（样式的登记表那一行的 labels，src/stage/styles.ts）：竖着的纸条（strip）的数是上面这些，一个没有动；
// 平着的纸条（slip）的数在这个文件的后半截（SLIP_SIZE、slipSize），照 stage.css“平着的纸条”那一段算。
// 一座沙盘一小节的题签多大（sectionStrips、routeSectionStrips）照这座沙盘的那一种算：哪一种是照它的样式从登记表查的，可以另交（测试里编出来的样式不在登记表里）。

import type { NamesMode, RouteScene, StopScene } from '../../../src/domain/scene';
import { stripTexts } from '../../../src/domain/sceneText';
import type { LabelKind, StripInput } from '../../../src/stage/overlay/types';
import { labelKind } from '../../../src/stage/styles';

/** 题签的两种大小：宽的栏用大一号的，窄的栏用小一号的。 */
export type StripSizeKind = 'wide' | 'narrow';

/**
 * 沙盘栏（连它的一像素边线）不到这么宽（像素）时题签小一号、题记用窄的排法：页面量了栏宽，够宽才在栏上挂 .is-wide
 *（src/ui/StagePane.tsx 的 WIDE_PANE_PX，是同一个数；样子在 stage.css）。584 是横着拿的平板上沙盘栏的宽。
 */
export const STRIP_NARROW_BELOW_PX = 584;

/** 两种大小各自的数：宽；高 = base + perChar × 字数。 */
export const STRIP_SIZE: Record<StripSizeKind, { w: number; base: number; perChar: number }> = {
  wide: { w: 29, base: 22, perChar: 19.04 },
  narrow: { w: 24, base: 17, perChar: 15.68 },
};

/** 这么宽的沙盘栏上，题签是哪一种大小。 */
export function stripSizeKind(paneWidth: number): StripSizeKind {
  return paneWidth < STRIP_NARROW_BELOW_PX ? 'narrow' : 'wide';
}

/**
 * 全程沙盘上是站的地名，题签脚上不是那方小红印，是一方一方写着第几站的红印（一站一方，杭州两方）。
 * 这样的题签的高 = base + perChar × 字数 + perSeal × 印的方数：宽的栏上下各垫 6，一方印 19 像素、上面空 3；
 * 窄的栏上垫 4、下垫 5，一方印 16 像素、上面空 2（样式在 src/styles/stage.css 的 .strip.has-seals 和 .strip-seal）。
 * 2026-11-20 在浏览器里对着真的题签量过（沙盘测试页接上页面的样式）：宽的栏上徐州 29 × 72、杭州 29 × 94、昌化军 29 × 91，
 * 窄的栏上 24 × 58、24 × 76、24 × 74，和这里算出来的一样。浏览器测试里量带印的题签的那一项，等人物页摆上全程沙盘时添。
 */
export const SEALED_STRIP_SIZE: Record<StripSizeKind, { base: number; perSeal: number }> = {
  wide: { base: 12, perSeal: 22 },
  narrow: { base: 9, perSeal: 18 },
};

/** 写着 text 的一条题签多宽多高。字数按一个一个的字算（不按编码的长度）。seals 是脚上有几方站号的印（全程沙盘上才有）。 */
export function stripSize(text: string, kind: StripSizeKind, seals = 0): { w: number; h: number } {
  const { w, base, perChar } = STRIP_SIZE[kind];
  if (seals > 0) return { w, h: Math.round(SEALED_STRIP_SIZE[kind].base + [...text].length * perChar + seals * SEALED_STRIP_SIZE[kind].perSeal) };
  return { w, h: Math.round(base + [...text].length * perChar) };
}

// ---------------------------------------------------------------- 平着的纸条（另一种题签）
//
// 照 src/styles/stage.css“平着的纸条”那一段的数算（tests/unit/page/slip-discs.test.ts 把样式表里的数读出来和这里比）：
//   名字那一块：字号 f（宽的栏 17，窄的栏 14），行高 1，字距 0.06em，上垫 0.24em、右 0.42em、下 0.3em、左 0.46em，一圈 1 像素的边
//     → 高 f × 1.54 + 2（17 像素时 28.18，量出来是 28；14 像素时 23.56，量出来是 24），宽 f × 1.06 × 字数 + f × 0.88 + 2
//     （17 像素：18.02 × 字数 + 16.96；14 像素：14.84 × 字数 + 14.32）；
//   没有点的名字：字距 0.22em，右垫 0.3em → 宽 f × 1.22 × 字数 + f × 0.76 + 2（17 像素：20.74 × 字数 + 14.92；14 像素：17.08 × 字数 + 12.64）；
//   一个圆：宽的栏 19 像素、窄的栏 16 像素，右边空 2 → 加 21、18；两个圆之间再空 1。
// 这些数还没有在浏览器里对着真的纸条量过（content/ 里没有一座沙盘用这一种）：用它的人物进来的时候，浏览器测试里添量它的一项。

/** 平着的纸条两种大小各自的数：字号；名字那一块的宽 = base + perChar × 字数（没有点的名字是 areaBase、areaPerChar）；高；一个圆占多宽；两个圆之间多空多少。 */
export const SLIP_SIZE: Record<StripSizeKind, { font: number; h: number; base: number; perChar: number; areaBase: number; areaPerChar: number; disc: number; between: number }> = {
  wide: { font: 17, h: 28.18, base: 16.96, perChar: 18.02, areaBase: 14.92, areaPerChar: 20.74, disc: 21, between: 1 },
  narrow: { font: 14, h: 23.56, base: 14.32, perChar: 14.84, areaBase: 12.64, areaPerChar: 17.08, disc: 18, between: 1 },
};

/** 写着 text 的一条平着的纸条多宽多高。discs 是名字前头有几个站号的圆；area 是没有点的名字（字距拉开）。 */
export function slipSize(text: string, kind: StripSizeKind, discs = 0, area = false): { w: number; h: number } {
  const size = SLIP_SIZE[kind];
  const chars = [...text].length;
  const name = area ? size.areaBase + chars * size.areaPerChar : size.base + chars * size.perChar;
  return { w: Math.round(name + discs * size.disc + Math.max(0, discs - 1) * size.between), h: Math.round(size.h) };
}

/** 一条题签多宽多高，照题签是哪一种算。seals 是站号的印（圆）有几个；area 只有平着的纸条看。 */
export function labelSize(labels: LabelKind, text: string, kind: StripSizeKind, seals = 0, area = false): { w: number; h: number } {
  return labels === 'slip' ? slipSize(text, kind, seals, area) : stripSize(text, kind, seals);
}

/**
 * 一小节要摆的题签，照这么宽的沙盘栏算好大小：就是题签层自己量出来、交给 placeStrips 的那一份
 * （先后就是要紧的先后；side、lean 是场景里写的愿望）。names 不写就用当时的名字。
 * labels 是这座沙盘的题签是哪一种：不写照它的样式从登记表查（content/ 里的沙盘现在都是竖着的纸条，算出来的和原来一个数不差）。
 */
export function sectionStrips(scene: StopScene, heading: string, paneWidth: number, names: NamesMode = 'ancient', labels: LabelKind = labelKind(scene.style)): StripInput['strips'] {
  const kind = stripSizeKind(paneWidth);
  return stripTexts(scene, heading, names).map((t, rank) => ({
    id: t.id,
    ...labelSize(labels, t.text, kind),
    rank,
    side: scene.strips.find((s) => s.id === t.id)?.side,
    lean: scene.strips.find((s) => s.id === t.id)?.lean,
  }));
}

/**
 * 全程沙盘一小节要摆的题签，照这么宽的沙盘栏算好大小。字和“是哪几站”都是页面拼出来的那一份
 * （src/domain/sceneText.ts 的 stripTexts）：当时的名字，或者今天的名字（写了 modern 的才换）；
 * 指着“是站的地名点”的题签带着站号的印，一站一方。
 */
export function routeSectionStrips(scene: RouteScene, heading: string, paneWidth: number, names: NamesMode = 'ancient', labels: LabelKind = labelKind(scene.style)): StripInput['strips'] {
  const kind = stripSizeKind(paneWidth);
  return stripTexts(scene, heading, names).map((t, rank) => {
    const written = scene.strips.find((s) => s.id === t.id);
    // 竖着的纸条：同原来一样的几项，一项不多。平着的纸条：没有点的名字多带一项 area（题签层交给摆法的也是这样）
    const area = labels === 'slip' && isAreaName(scene, t.id);
    return {
      id: t.id,
      ...labelSize(labels, t.text, kind, t.stops?.length ?? 0, area),
      rank,
      side: written?.side,
      lean: written?.lean,
      ...(area ? { area: true } : {}),
    };
  });
}

/**
 * 这条题签是不是没有点的名字（平着的纸条才看）：题签层拿到的那一份（src/stage/overlay/strips.ts 的 sectionStripSpecs）上写着 area 的那几条——
 * 指着海（coast）的，和地名点写了 area 的。
 */
export function isAreaName(scene: RouteScene, stripId: string): boolean {
  const of = scene.strips.find((s) => s.id === stripId)?.of;
  return of === 'coast' || scene.places.some((place) => place.id === of && (place as { area?: boolean }).area === true);
}

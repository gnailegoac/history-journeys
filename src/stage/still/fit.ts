// 定格图怎么摆进一块它不是照着拍的沙盘栏。全是算数，不碰页面。
//
// 办法和立体的沙盘摆镜头是一回事（src/stage/three/rig.ts 的 fitFactor）：画面的大小跟着栏的高走；
// 这一节一定要看得见的点在留出来的那一块里摆不下，就缩小（等于镜头退远），最多退到 maxFit 倍；
// 场景里写了 closest 而且摆得下，就放大一点（等于镜头靠近）。拍的时候留出来的那一块的中心，
// 落在现在留出来的那一块的中心上——立体的沙盘也是把对准的那一点摆在那里。
// 这样立体的沙盘接手时，画面几乎不跳（差多少由 tests/unit/still-fit.test.ts 守着）。
//
// 像素都是 CSS 像素，从沙盘栏（容器）的左上角量。

import type { StillAnchor, StillManifest, StillShape, StillShapeSpec, StillShot } from '../../domain/stills';
import type { StripInput } from '../overlay/types';
import type { StageInsets } from '../types';

/** 现在的沙盘栏：多大，四边各留出多少。 */
export interface StillPane {
  width: number;
  height: number;
  insets: StageInsets;
}

/** 一张图摆好以后的样子。 */
export interface StillFit {
  /** 图片的左上角落在沙盘栏的哪里（可以是负的：图片比栏大，多出来的在外面）。 */
  left: number;
  top: number;
  /** 图片摆多宽多高。 */
  width: number;
  height: number;
  /** 拍的时候的一个像素，现在是几个像素。 */
  scale: number;
  /** 立体的沙盘在这块栏里，镜头会离场景里写的距离的几倍。 */
  fit: number;
}

/** 图片不够铺到的那一边，贴着图片的边盖一条由底色淡出的过渡。 */
export interface StillFade {
  side: 'left' | 'right' | 'top' | 'bottom';
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 过渡那一条多宽（像素）。 */
export const FADE_PX = 28;
/** 留出来的那一块再小，半边也按这么多像素算（和 rig.ts 的 fitFactor 一样）。 */
const MIN_HALF_PX = 16;

/** 拍的时候整张图多大（CSS 像素）：沙盘栏的宽加上左右各多拍的，高就是沙盘栏的高。 */
export function pictureSize(spec: StillShapeSpec): { width: number; height: number } {
  return { width: spec.pane[0] + 2 * spec.extra, height: spec.pane[1] };
}

/** 拍的时候留出来的那一块在图片里的哪里。 */
export function referenceArea(spec: StillShapeSpec): { x0: number; y0: number; x1: number; y1: number } {
  const [top, right, bottom, left] = spec.insets;
  return { x0: spec.extra + left, y0: top, x1: spec.extra + spec.pane[0] - right, y1: spec.pane[1] - bottom };
}

/**
 * 把一张图摆进现在的沙盘栏。
 * shot 是清单里这张图的 fit 和 reach；made 是拍的时候镜头用的两个数；closest 是这一节的镜头写的 closest（没写不传）。
 */
export function fitStill(
  shot: Pick<StillShot, 'fit' | 'reach'>,
  spec: StillShapeSpec,
  made: Pick<StillManifest['made'], 'fitMarginPx' | 'maxFit'>,
  pane: StillPane,
  closest?: number,
): StillFit {
  const picture = pictureSize(spec);
  const area = referenceArea(spec);
  const { insets } = pane;
  const halfW = (pane.width - insets.left - insets.right) / 2;
  const halfH = (pane.height - insets.top - insets.bottom) / 2;

  // 画面的大小先跟着栏的高走（镜头的视角是竖着量的）
  const k = pane.height / picture.height;
  // 要看的点最远的那个，镜头得离多远才进得了留出来的那一块：是写的距离的几倍
  const need =
    shot.fit * k * Math.max(shot.reach[0] / Math.max(MIN_HALF_PX, halfW - made.fitMarginPx), shot.reach[1] / Math.max(MIN_HALF_PX, halfH - made.fitMarginPx));
  const fit = need > 1 ? Math.min(need, made.maxFit) : Math.max(need, Math.min(1, closest ?? 1));
  const scale = (k * shot.fit) / fit;

  return {
    left: insets.left + halfW - scale * ((area.x0 + area.x1) / 2),
    top: insets.top + halfH - scale * ((area.y0 + area.y1) / 2),
    width: scale * picture.width,
    height: scale * picture.height,
    scale,
    fit,
  };
}

/**
 * 清单里记的各条题签指着的点（占整张图的几成）落在沙盘栏的哪里：就是交给题签层的那一份。
 * out 原样传过去；看不看得见，是清单里记的，再加上这一点现在在不在栏里。
 */
export function anchorsOnPane(anchors: StillAnchor[], fit: StillFit, pane: { width: number; height: number }): StripInput['anchors'] {
  return anchors.map((anchor) => {
    const x = fit.left + anchor.x * fit.width;
    const y = fit.top + anchor.y * fit.height;
    const placed: StripInput['anchors'][number] = {
      id: anchor.id,
      x,
      y,
      visible: anchor.visible && x >= 0 && x <= pane.width && y >= 0 && y <= pane.height,
    };
    if (anchor.out) placed.out = [anchor.out[0], anchor.out[1]];
    if (anchor.foot) placed.foot = { x: fit.left + anchor.foot[0] * fit.width, y: fit.top + anchor.foot[1] * fit.height };
    return placed;
  });
}

/** 图片没铺到沙盘栏的哪几边：那几边各要一条过渡，贴着图片的边、盖在图片上。 */
export function edgeFades(fit: StillFit, pane: { width: number; height: number }): StillFade[] {
  const right = fit.left + fit.width;
  const bottom = fit.top + fit.height;
  // 图片在栏里看得见的那一块
  const x0 = Math.max(0, fit.left);
  const x1 = Math.min(pane.width, right);
  const y0 = Math.max(0, fit.top);
  const y1 = Math.min(pane.height, bottom);
  if (x1 <= x0 || y1 <= y0) return [];
  const across = Math.min(FADE_PX, fit.width / 2);
  const down = Math.min(FADE_PX, fit.height / 2);
  const fades: StillFade[] = [];
  // 差不到半个像素不算没铺到
  if (fit.left > 0.5) fades.push({ side: 'left', left: fit.left, top: y0, width: across, height: y1 - y0 });
  if (right < pane.width - 0.5) fades.push({ side: 'right', left: right - across, top: y0, width: across, height: y1 - y0 });
  if (fit.top > 0.5) fades.push({ side: 'top', left: x0, top: fit.top, width: x1 - x0, height: down });
  if (bottom < pane.height - 0.5) fades.push({ side: 'bottom', left: x0, top: bottom - down, width: x1 - x0, height: down });
  return fades;
}

/**
 * 页面没有说现在是宽的排法还是窄的排法时（开发用的单独一页），自己挑一种：
 * 把拍的时候留出来的那一块整块放进现在留出来的那一块里（放到最大、不出边），看盖住了几成，取盖得多的——
 * 也就是长宽的比例和现在最接近的那一种。一样多取宽的。have 是有图的那几种（不写就是两种都有）。
 */
export function pickShape(shapes: Record<StillShape, StillShapeSpec>, pane: StillPane, have: readonly StillShape[] = ['wide', 'narrow']): StillShape {
  const width = Math.max(1, pane.width - pane.insets.left - pane.insets.right);
  const height = Math.max(1, pane.height - pane.insets.top - pane.insets.bottom);
  let best: StillShape = have[0] ?? 'wide';
  let bestCover = -1;
  for (const shape of ['wide', 'narrow'] as const) {
    if (!have.includes(shape)) continue;
    const area = referenceArea(shapes[shape]);
    const w = Math.max(1, area.x1 - area.x0);
    const h = Math.max(1, area.y1 - area.y0);
    const scale = Math.min(width / w, height / h);
    const cover = (w * scale * h * scale) / (width * height);
    if (cover > bestCover) {
      best = shape;
      bestCover = cover;
    }
  }
  return best;
}

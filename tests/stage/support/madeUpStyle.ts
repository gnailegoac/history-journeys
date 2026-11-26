// 测试用的一种编出来的时代样式（'made-up-lines'）：只有全程沙盘用的那一半，不在登记表里（src/stage/styles.ts），读者的构建里没有它。
// 它是给“另一位人物的样式会写、宋代青绿设色不写”的那几样作证的：线型的表（陆路的实线和虚线，水路、海路的两种细虚线，
// 垫底的浅色线跟着虚线断开），线的粗细跟着画面的比例（roads.fit，样式自己带的函数），留白的边只抹开、不打散。
// 灯、雾、装裱和座子、小像的颜色借宋代青绿设色那一半的（这里要的只是路和留白的边）；路的颜色、宽度也借它的，只添线型和 fit。
// 交给沙盘程序的办法：MADE_UP_STYLES 这张单子（provideStyles(MADE_UP_STYLES)，或者 loadStyle(id, 'route', MADE_UP_STYLES)）。
// 这个文件交出来的 style 就是那一半，写法和登记表里一行的 loadRoute 取到的文件一样。

import type { RoadLineNow, RoadPattern, RouteStyle, TableStyle } from '../../../src/stage/three/internal';
import type { StyleRow } from '../../../src/stage/styles';
import { style as borrowed } from '../../../src/stage/three/style/song-qinglv/song-qinglv-route';

export const MADE_UP_STYLE_ID = 'made-up-lines';

const BASE = borrowed.route as RouteStyle;

/** 垫底的浅色线跟着一种虚线断开：每一划两头各宽出 e 像素（e 不超过 1.2，也不超过空的一半减 0.9），空着的地方不垫。 */
function under(dashPx: [number, number]): RoadPattern['under'] {
  const e = Math.min(1.2, dashPx[1] / 2 - 0.9);
  return { dashPx: [dashPx[0] + 2 * e, dashPx[1] - 2 * e], offsetPx: e };
}

/** 陆路的虚线：一划 7、一空 5.5（和借来的那一种一样）。水路的细虚线：一划 3.4、一空 3；只知道两头的水路把空拉长一倍。 */
const LAND_DASH: [number, number] = [BASE.roads.dashPx[0], BASE.roads.dashPx[1]];
const WATER_DASH: [number, number] = [3.4, 3];
const WATER_ENDS_DASH: [number, number] = [3.4, 6];
/** 水路、海路的线是陆路的几成宽。 */
const WATER_WIDTH = 0.68;

/** 四种线型：0 陆路、有记载（实线）；1 陆路、只知道两头；2 水路和海路、有记载；3 水路和海路、只知道两头。 */
export const MADE_UP_PATTERNS: readonly RoadPattern[] = [
  {},
  { dashPx: LAND_DASH, under: under(LAND_DASH) },
  { dashPx: WATER_DASH, widthTimes: WATER_WIDTH, under: under(WATER_DASH) },
  { dashPx: WATER_ENDS_DASH, widthTimes: WATER_WIDTH, under: under(WATER_ENDS_DASH) },
];

/** 一笔用第几种线型：陆路照虚实是 0、1；水路、海路照虚实是 2、3。 */
export const madeUpPatternOf = (dotted: boolean, by: 'water' | 'land' | 'sea'): number => (by === 'land' ? 0 : 2) + (dotted ? 1 : 0);

/** 粗细跟着画面的比例：倍数 = 画面上 100 公里合多少像素 ÷ 这个数，夹在 FIT_MIN 和 1 之间。 */
export const FIT_REFERENCE_PX = 72.5;
export const FIT_MIN = 0.6;
/** 跟着比例调的时候：垫底的浅色线比线两边各宽出多少像素、多透；水路的线最细多少像素。 */
export const FIT_UNDER_SIDE_PX = 1;
export const FIT_UNDER_OPACITY = 0.4;
export const FIT_WATER_MIN_PX = 1;

/** 倍数。pxPer100Km 是 null（看一站的小节）时没有倍数。 */
export const fitFactor = (pxPer100Km: number | null): number | null => (pxPer100Km === null ? null : Math.min(1, Math.max(FIT_MIN, pxPer100Km / FIT_REFERENCE_PX)));

/**
 * 样式自己带的函数（RouteStyle.roads.fit）：画线的程序每一帧把造着的几种线交来。
 * 头一节（全程）：线宽乘倍数，水路的线不细过 1 像素；垫底的浅色线是它上面那种墨线的宽度两边各加 1 像素、四成透明度。
 * 看一站的小节（交来 null）：都放回样式里写的宽度和透明度。
 */
function fit(lines: readonly RoadLineNow[], pxPer100Km: number | null): void {
  const factor = fitFactor(pxPer100Km);
  for (const line of lines) {
    if (factor === null) {
      line.material.linewidth = line.widthPx;
      line.material.opacity = line.opacity;
      continue;
    }
    // 垫底的不断的那一道（第 -1 种）垫在实线下面：照第 0 种算
    const pattern = Math.max(0, line.pattern);
    const least = pattern >= 2 ? FIT_WATER_MIN_PX : 0;
    if (line.state === 'halo') {
      // 这一道垫底线上面的墨线现在多宽（减配的一档加粗的那一点照样加）
      const extra = line.widthPx - BASE.roads.halo.widthPx;
      const over = Math.max(least, (BASE.roads.lines.ink.widthPx * (MADE_UP_PATTERNS[pattern].widthTimes ?? 1) + extra) * factor);
      line.material.linewidth = over + 2 * FIT_UNDER_SIDE_PX;
      line.material.opacity = FIT_UNDER_OPACITY;
    } else {
      line.material.linewidth = Math.max(least, line.widthPx * factor);
      line.material.opacity = line.opacity;
    }
  }
}

/** 全程沙盘的那一份：借来的数，留白的边只抹开 20 公里、不打散，路添上线型和 fit。 */
const ROUTE: RouteStyle = {
  ...BASE,
  blank: { blurM: 20_000 },
  roads: { ...BASE.roads, patterns: { list: MADE_UP_PATTERNS, of: madeUpPatternOf }, fit },
};

/** 这种编出来的样式里每一座沙盘都用的那一半（它只有这一半）。 */
export const style: TableStyle = { ...borrowed, id: MADE_UP_STYLE_ID, route: ROUTE };

/**
 * 交给沙盘程序的单子：只有这一种。它没有站点沙盘才用的那一半，取整套的拒绝。
 * 这一行的写法和登记表里的一行一样（src/stage/styles.ts 的 StyleRow）：它写了 labels: 'slip'——写着这种样式的沙盘，题签是平着的纸条。
 * 要问“这座编出来的沙盘的题签是哪一种”，把这张单子交给 labelKind(样式的名字, MADE_UP_STYLES)，和页面查登记表是同一个函数。
 */
export const MADE_UP_STYLES: readonly StyleRow[] = [
  {
    id: MADE_UP_STYLE_ID,
    load: () => Promise.reject(new Error(`样式“${MADE_UP_STYLE_ID}”是测试里编出来的，只有全程沙盘用的那一半`)),
    loadRoute: () => Promise.resolve({ style }),
    labels: 'slip',
  },
];

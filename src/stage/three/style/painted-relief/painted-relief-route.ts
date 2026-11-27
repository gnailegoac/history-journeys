// 彩绘地形模型（'painted-relief'）这一种时代样式里，每一座沙盘都用的那一半：灯、雾、云气，全程沙盘自己的那一份（留白的边、路的线），
// 匣子，和哪一层的沙盘都要的几种颜色。全程沙盘只取这一半：这个文件是单独的一小块程序，登记在 src/stage/styles.ts 的 loadRoute。
// 样子是一座上了色的地形模型摆在一只素胡桃木匣里：平着的纸签，胭脂红的圆点，细细的墨线。
// 数是定稿的样张的（它的 palette.js、routetable.js、table.js）；样张里按它自己的单位写的长度，换算成了这座沙盘里的米（见 ./stand.ts 开头）。
// 给地面上色用的数不在这里：沙盘程序不读它们，在做图的工具里（tests/tools/route/paintRelief.ts）。
// 这种样式现在只有这一半：站点沙盘才用的那一半（地面的颜色和分带、小模型、题签抬多高、夜里的一套灯）还没有做。

import type { Vec2 } from '../../../ground/types';
import type { LightSpec, RoadLineNow, RoadPattern, RouteLineStyle, RouteStyle, TableStyle } from '../../internal';
import { STAND } from './stand';
// 这一句只为打包：这一块程序是和沙盘程序一起取的。写了这一句，打包的工具就知道沙盘程序那一块一定在，
// 两边共用的东西（匣子要用的 three 的核心）留在那一块里直接用，不另拆一块。
import '../../engine';

// ---------------------------------------------------------------- 颜色

/** 哪一层的沙盘都要的几种颜色。前四种的名字是沙盘程序认的；后三种是匣子自己取的（./stand.ts）。 */
const PALETTE: Record<string, string> = {
  // 这种样式的海和湖上不画水纹、没有云气、没有雾：这三种沙盘程序要有，写的是贴着岸的浅水色和沙盘栏的底色，画面上用不到
  ripple: '#dfe9ea',
  mist: '#dfe9ea',
  fog: '#bfc1b6',
  // 地形板四边的切面
  blockSide: '#cbc4b0',
  // 匣子：胡桃木的框，里面一圈浅色的衬条，地形板边上的一道细线
  walnut: '#5a4130',
  band: '#e6e0cf',
  rim: '#8d8672',
};

// ---------------------------------------------------------------- 灯

/** 一盏灯：从东北上方来的暖光。全程沙盘没有夜，问哪一种天色给的都是这一盏。影子的虚实和偏移不在这里（../../rig.ts 的 shadowTuning）。 */
const LIGHT: LightSpec = {
  dir: [0.66, 0.6, -0.42],
  sun: 2.6,
  sunColor: '#fff4e2',
  hemi: 1.55,
  sky: '#fffaf0',
  ground: '#c4b494',
};

function light(): LightSpec {
  return LIGHT;
}

// ---------------------------------------------------------------- 雾和云气

/** 没有雾：雾从沙盘程序画得到的最远处以外才起（它画到镜头的三倍远再加三万米），画面上哪一点也到不了。 */
function fogFor(distanceM: number): Vec2 {
  const beyond = distanceM * 3 + 30_000;
  return [beyond, beyond * 2];
}

/** 没有云气。 */
function mistFor(): number {
  return 0;
}

// ---------------------------------------------------------------- 路的线

/** 三种路的线：墨线（全程那一节），这一站那几年走的（胭脂红），早先走过的（淡墨，八成）。宽度是页面上的像素。 */
const LINES: Record<'ink' | 'now' | 'past', RouteLineStyle> = {
  ink: { colour: '#3f3027', opacity: 0.92, widthPx: 1.8 },
  now: { colour: '#a3283c', opacity: 1, widthPx: 2.4 },
  past: { colour: '#85776a', opacity: 0.8, widthPx: 1.4 },
};
/** 垫在墨线和胭脂红的线下面的浅色线。 */
const HALO: RouteLineStyle = { colour: '#f7f2e3', opacity: 0.62, widthPx: 4.5 };

/**
 * 陆路的虚线：一划 7、一空 5.5。水路、海路的细点线：一划 3.4、一空 3，只有这一种——
 * 记录写到了的水路和只知道两头的水路画得一样（试过把空拉长一倍来分，要放大了才分得出），哪一种只在话里说。
 */
const LAND_DASH: [number, number] = [7, 5.5];
const WATER_DASH: [number, number] = [3.4, 3];
/** 水路、海路的线是陆路的几成宽；看一站的小节里，垫在它下面的浅色线是陆路那一道的几成宽。 */
const WATER_WIDTH = 0.68;
const WATER_UNDER = 0.72;

/** 垫底的浅色线跟着一种虚线断开：每一划两头各宽出 e 像素（e 不超过 1.2，也不超过空的一半减 0.9），空着的地方露出地面。 */
function under(dashPx: [number, number]): RoadPattern['under'] {
  const e = Math.min(1.2, dashPx[1] / 2 - 0.9);
  return { dashPx: [dashPx[0] + 2 * e, dashPx[1] - 2 * e], offsetPx: e };
}

/** 三种线型：0 陆路、他的记录写到了（实线）；1 陆路、只知道两头（虚线）；2 水路和海路（细点线，不分虚实）。 */
const LAND_SOLID = 0;
const LAND_DASHED = 1;
const WATER = 2;
const PATTERNS: readonly RoadPattern[] = [{}, { dashPx: LAND_DASH, under: under(LAND_DASH) }, { dashPx: WATER_DASH, widthTimes: WATER_WIDTH, under: under(WATER_DASH) }];

/** 一笔用第几种线型：陆路照虚实是 0、1；水路、海路都是 2。给的只有上面那张单子里的序号。 */
function patternOf(dotted: boolean, by: 'water' | 'land' | 'sea'): number {
  if (by !== 'land') return WATER;
  return dotted ? LAND_DASHED : LAND_SOLID;
}

/** 粗细跟着画面的比例：倍数 = 画面上 100 公里合多少像素 ÷ 72.5，夹在 0.6 和 1 之间。 */
const FIT_REFERENCE_PX = 72.5;
const FIT_MIN = 0.6;
/** 跟着比例调的时候：垫底的浅色线比线两边各宽出 1 像素、四成透明；水路的线最细 1 像素。 */
const FIT_UNDER_SIDE_PX = 1;
const FIT_UNDER_OPACITY = 0.4;
const FIT_WATER_MIN_PX = 1;

/**
 * 画线的程序每一帧把造着的几种线交来（RouteStyle.roads.fit）。
 * 全程那一节（一百多趟路挤在一张图上）：线宽乘倍数，水路的线不细过 1 像素；垫底的浅色线是它上面那种墨线的宽度两边各加 1 像素、四成透明。
 * 看一站的小节（交来 null）：照上面写的宽度和透明度；水路下面垫的那一道窄一些。
 */
function fit(lines: readonly RoadLineNow[], pxPer100Km: number | null): void {
  const factor = pxPer100Km === null ? null : Math.min(1, Math.max(FIT_MIN, pxPer100Km / FIT_REFERENCE_PX));
  for (const line of lines) {
    // 垫底的不断的那一道（第 -1 种）垫在实线下面：照第 0 种算
    const pattern = Math.max(0, line.pattern);
    const water = pattern === WATER;
    const below = line.state === 'halo';
    if (factor === null) {
      line.material.linewidth = below && water ? line.widthPx - HALO.widthPx * (1 - WATER_UNDER) : line.widthPx;
      line.material.opacity = line.opacity;
    } else if (below) {
      // 这一道垫底线上面的墨线现在多宽（减配的一档加粗的那一点照样加）
      const over = Math.max(water ? FIT_WATER_MIN_PX : 0, (LINES.ink.widthPx * (PATTERNS[pattern].widthTimes ?? 1) + line.widthPx - HALO.widthPx) * factor);
      line.material.linewidth = over + 2 * FIT_UNDER_SIDE_PX;
      line.material.opacity = FIT_UNDER_OPACITY;
    } else {
      line.material.linewidth = Math.max(water ? FIT_WATER_MIN_PX : 0, line.widthPx * factor);
      line.material.opacity = line.opacity;
    }
  }
}

// ---------------------------------------------------------------- 全程沙盘

/** 全程沙盘自己的那一份。 */
const ROUTE: RouteStyle = {
  // 地形板的网格：45 米一格，合地上约 6.5 公里（样张是一个高程格点一个顶点，2.5 公里；一个画面的三角形有上限，这里粗一些）。
  // 减配的一档格子放大 1.08 倍（样张没有这一档）：看整块沙盘时一个画面的三角形比完整的一档少一成出头；
  // 再放大，地形板上的三角形就少过两成了（减配的地面不许比完整的粗那么多）
  segmentM: 45,
  reducedSegmentTimes: 1.08,
  // 海和湖上不画水纹（做图的工具交来的标记整张是 0）：这个数沙盘程序要有，画面上用不到
  ripplePx: 8,
  // 留白的边：只抹开 20 公里，不打散。科西嘉岛那一圈的东边挨着厄尔巴岛和托斯卡纳的海岸，抹得再宽，那一带的地势也跟着压平了
  blank: { blurM: 20_000 },
  roads: {
    lines: LINES,
    halo: HALO,
    haloUnder: ['ink', 'now'],
    dashPx: LAND_DASH,
    // 减配的一档没有抗锯齿，线加粗一点（样张没有这一档；这个数是沙盘程序现在用的）
    reducedExtraPx: 0.3,
    // 线比地面抬高多少：4 米，合地上 0.6 公里。样张是 14 个单位（这里的 16.5 米，合地上 2.4 公里）：斜着看，线就落在它的地面北边两公里上下，
    // 河上的船线跑到了东北岸上；看了头一批真的图以后压低的
    liftM: 4,
    patterns: { list: PATTERNS, of: patternOf },
    fit,
  },
};

// ---------------------------------------------------------------- 合起来

/** 这种样式里每一座沙盘都用的那一半。全程沙盘照登记表（src/stage/styles.ts 的 loadRoute）取到这个文件，拿的就是它。 */
export const style: TableStyle = {
  id: 'painted-relief',
  palette: PALETTE,
  light,
  fogFor,
  mistFor,
  route: ROUTE,
  // 匣子：浅色的衬条，素胡桃木的直边框（./stand.ts）
  stand: STAND,
  // 小像（piece）不写：这位人物的小像（长外套、窄檐圆帽，没有脸，没有姿势）还没有做，沙盘程序里也还没有它的形状；
  // 不写，这种样式的沙盘上就不摆小像。它的颜色等小像做的时候同形状一起定。
};

// 宋代青绿设色（'song-qinglv'）这一种时代样式里，每一座沙盘都用的那一半：白天的灯、雾、云气的浓淡，全程沙盘自己的那一份，装裱和座子，小像的颜色，
// 和七种哪一层的沙盘都要的颜色（水纹、云气、雾、地形板的侧面、绫边两种、紫檀）。
// 全程沙盘只取这一半（它不摆小模型，不现画地面）：这个文件是单独的一小块程序，登记在 src/stage/styles.ts 的 loadRoute。
// 站点沙盘另外要的那一半（地面的颜色和分带、小模型的颜色、模型跟着远近怎么变、题签抬多高、夜里的一套灯）在 ./song-qinglv.ts：那个文件引着这一个，合成整套。
// 颜色和数大多是从样张搬来的（spikes/art-direction/b/scene/ 里 config.js 的 PAL、sandtable.js 的灯和各个镜头的雾），没有改。
// 灯在这一半里只有白天的一盏（夜里的一套在 ./song-qinglv.ts），不看镜头。

import type { Vec2 } from '../../../ground/types';
import type { LightSpec, RouteStyle, TableStyle } from '../../internal';
import { STAND } from './stand';
// 这一句只为打包：这一块程序是和沙盘程序一起取的，没有沙盘程序它什么也做不了。写了这一句，打包的工具就知道沙盘程序那一块一定在，
// 两边共用的东西（座子要用的 three 的核心，整套样式夜里算月亮方向的函数）留在那一块里直接用，不另拆一块（按家分块的零件、全程沙盘那一块也是这样写的）。
import '../../engine';

// ---------------------------------------------------------------- 颜色

/** 哪一层的沙盘都要的七种颜色。名字照样张的 PAL；fog 是新添的。站点沙盘另外的颜色在 ./song-qinglv.ts，那里的这七种取的就是这里的。 */
const PALETTE: Record<string, string> = {
  // 水和云气
  ripple: '#f7f3e6',
  mist: '#f3ecdb',
  // 装裱和座子
  brocade: '#e4d8ba', // 绫边
  brocadeFig: '#c9b88e',
  blockSide: '#c2a97c',
  sandal: '#33201b', // 紫檀
  // 新添的
  fog: '#ece3cf', // 远处的雾（样张里直接写在 sandtable.js 里）
};

// ---------------------------------------------------------------- 灯

/**
 * 这种样式的一盏灯：从东北上方来的暖光（强弱、颜色是样张平常用的那一盏，方向是它左右对调）。不看镜头朝哪边、离多远。
 * 光从哪边来是定过的事（docs/decisions.md 第 21 条），要改先由负责人定；tests/stage/rig.test.ts 里记着现在的方向，改了这里那边会不通过。
 * 影子的虚实和偏移不在这里：按影子罩多大一块来定（../../rig.ts 的 shadowTuning）。
 */
const LIGHT: LightSpec = {
  dir: [0.66, 0.6, -0.42],
  sun: 2.6,
  sunColor: '#fff4e2',
  hemi: 1.55,
  sky: '#fffaf0',
  ground: '#c4b494',
};

/**
 * 这一半里的灯只有白天这一盏：全程沙盘没有夜（它的小节不写天色），问它哪一种天色给的都是这一盏。
 * 夜里的一套（跟着月亮走的月光、天光，夜里的雾和云气）是站点沙盘才用的，在 ./song-qinglv.ts：整套样式的 light 是那边的，白天还是交这一盏。
 */
function light(): LightSpec {
  return LIGHT;
}

// ---------------------------------------------------------------- 雾

/** 样张五个镜头的远近和它们各自的雾：[镜头多远, 雾从多远起, 到多远全白]，米。 */
const FOG_STOPS: [number, number, number][] = [
  [1150, 3000, 30000],
  [5900, 7000, 34000],
  [9600, 12000, 60000],
  [10800, 14000, 60000],
  [52000, 40000, 140000],
];

/**
 * 镜头这么远时，雾从多远开始、到多远全白。
 * 在样张那五个镜头的远近上，给的就是样张的数；两个之间匀着过渡；比最近的还近、比最远的还远时，跟着远近按比例缩放
 * （画面窄了镜头要退远，雾也跟着退，沙盘不会整个罩在雾里）。
 */
function fogFor(distanceM: number): Vec2 {
  const first = FOG_STOPS[0];
  const last = FOG_STOPS[FOG_STOPS.length - 1];
  if (distanceM <= first[0]) return [(first[1] * distanceM) / first[0], (first[2] * distanceM) / first[0]];
  if (distanceM >= last[0]) return [(last[1] * distanceM) / last[0], (last[2] * distanceM) / last[0]];
  for (let i = 0; i < FOG_STOPS.length - 1; i++) {
    const a = FOG_STOPS[i];
    const b = FOG_STOPS[i + 1];
    if (distanceM <= b[0]) {
      const t = (distanceM - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    }
  }
  return [last[1], last[2]];
}

/** 山脚的云气：近看是平常的浓淡（1），看整块沙盘时淡到四成（样张的数），中间匀着过渡。 */
function mistFor(distanceM: number): number {
  const t = Math.min(1, Math.max(0, (distanceM - 15000) / (52000 - 15000)));
  return 1 - 0.6 * t;
}

// ---------------------------------------------------------------- 全程沙盘

/**
 * 全程沙盘自己的那一份。数都是定稿的样张的（spikes/art-direction/route/scene/）。
 * 给地面上色用的数（河画多宽、黄土和海的颜色、山上的分带）不在这里：沙盘程序不读它们，在做图的工具里（tests/tools/route/paint.ts）。
 * 网格 59 米一格，合地上约 10 公里。2026-11-20 对着图片和 48 米一格的比过（从低处看四川一带）：山脊和山的轮廓看不出差别，所以用粗的。
 */
const ROUTE: RouteStyle = {
  segmentM: 59,
  reducedSegmentTimes: 1.07,
  ripplePx: 8,
  // 留白的边（2026-11-26 从 src/stage/ground/route.ts 搬来，数一个没有改）。
  // 抹开 40 公里：原来是 20 公里、从 0.25 到 0.92 过渡（约 40 公里宽的一条，跨在圈的边线上），对着沙盘上的图看，西边的高原在那里成了一道笔直的陡崖。
  // 改成 40 公里、从 0.5 到 0.97 过渡：圈里面整个是平的，地势从边线外面约 75 公里起慢慢收下来，到边线收完。
  // 定稿的样张也是这样收的（它的留白本来就有一百多公里宽的软边，地势比颜色先收平）。
  // 西边打散：圈是场景里写的直线，照直线切，西边的高原和西南角就成了两道笔直的边。所以东经 106.3 度以西（到 107.7 度匀着过渡），
  // 边照噪声挪开（定稿的样张就是这样打散西边的，数是它的），山里的谷底（只算到东经 105.2 到 106.2 度之间为止）再多挪一些。
  // 往东最多挪 0.4 度、往西最多 0.6 度（所以眉州以东的地势一米也不动）；南北最多 0.6 度。台湾和吕宋的两圈在东边，不动。
  // 抹开以后再打散一遍，最多挪 0.45。tests/stage/styles.test.ts 里一个字不差地记着这几个数。
  blank: {
    blurM: 40_000,
    torn: { westOf: [106.3, 107.7], eastDeg: 0.4, westDeg: 0.6, latDeg: 0.6, again: 0.45, valleyWestOf: [105.2, 106.2] },
  },
  // 路：墨线、刚走的路的颜色和虚线的长短是定稿的样张的（scene/routetable.js 的 STYLE）。宽度比样张远看时的粗：样张的 1.45、1.75、0.95 像素
  // 在电脑的大沙盘栏上太细，这里是 1.8、2.4、1.4，垫底的浅色线照着加宽。不分远近，一个宽度。
  // 走过的路是淡了的墨线：下面不垫浅色线（垫了，远看是一条白线），颜色比样张的深一些，在平地上、在河边上认得出是旧墨，不是河。
  roads: {
    lines: {
      ink: { colour: '#3a2d24', opacity: 0.92, widthPx: 1.8 },
      now: { colour: '#b03a2a', opacity: 1, widthPx: 2.4 },
      past: { colour: '#665645', opacity: 0.8, widthPx: 1.4 },
    },
    halo: { colour: '#f4ecd6', opacity: 0.62, widthPx: 4.5 },
    haloUnder: ['ink', 'now'],
    dashPx: [7, 5.5],
    reducedExtraPx: 0.3,
    liftM: 14,
  },
};

// ---------------------------------------------------------------- 合起来

/** 这种样式里每一座沙盘都用的那一半。全程沙盘照登记表（src/stage/styles.ts 的 loadRoute）取到这个文件，拿的就是它。 */
export const style: TableStyle = {
  id: 'song-qinglv',
  palette: PALETTE,
  light,
  fogFor,
  mistFor,
  route: ROUTE,
  // 装裱和座子：浅色绫边，紫檀的框和须弥座式的矮座（./stand.ts）
  stand: STAND,
  // 小像：赭石的底座、印泥红的边（和“刚走的路”一个红）、花青的袍子、陶土色的脸、墨色的高帽。长袍、高帽是示意的，没有照哪一幅画像。
  // 花青是这一套画里本来就有的颜色（“大江”“海”的题签就是用它写的）：沙地上、海边、山里、红线上、题签堆里，一眼都找得到他。
  // 脸比题签的纸、比沙地深一点：平板的屏幕上（画得比电脑上大一倍）脸同沙地、同题签的纸分得开。
  piece: { base: '#a8643c', rim: '#b03a2a', robe: '#30486a', head: '#d4a373', cap: '#1f1b18' },
};

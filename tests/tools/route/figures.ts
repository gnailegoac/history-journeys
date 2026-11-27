// 做全程沙盘的文件的四个工具（npm run route:terrain、route:today、route:map、route:bank）给哪一位人物做，
// 和这位人物自己的那几样：源数据在哪，“今天的岸线、湖、河”裁到哪个方框，源数据里哪个湖要放回原来的大小，
// 沿着河走的每条路贴着河岸走的线怎么做。一位人物一行。
//
// 怎么说给哪一位做：环境变量 ROUTE_FIGURE=<人物的文件夹名>（同 ROUTE_OUT、STILLS_OUT 一个写法），四个工具都认它，只认它。
//   表里只有一位人物的时候可以不写，做的就是他；有两位以上就得写，不写工具停下来说表里有谁——不悄悄挑一位。
// 不写在这张表里、从场景文件自己读的：地形文件的格子（场景的 terrain 那一块的 cols、rows、west、east、north、south）、
//   地形文件叫什么（terrain.file）、岸线文件叫什么（water.todayFile）。场景文件是 content/figures/<人物>/scenes/route.json。
// 添一位人物：先有他的场景文件（哪怕只有范围和格子）和他的源数据，再在下面添一行。只有常数和算数的函数，不碰磁盘。
// 一行里的方框和湖不是随意定的，是跟着源数据走的：工具不裁陆地、不裁湖，方框得是源数据的陆地已经裁到的那一个
//  （有一圈陆地、一个湖出了方框，工具停下来说）；源数据里写着“改过”的湖，每一个都要列在 shrunkLakes 里（漏了一个，工具停下来说）。
// 一行要写全了才提交：npm test 对表里的每一行都查（场景里沿着河走的路，banks 里一条不多、一条不少；格子落在方框里面）。
//   来做文件的时候（npm run route:…）只查正在做的那一位：别人的一行还没写全，不碍这一位的工具；
//   正在做的那一位自己的 banks 还没写全，他的工具照做、照印，末了说他那一行和场景里沿着河走的路对不上、以失败收场——banks 就是这样一条一条配出来的。

import type { BankSpec } from './bankTool';
import type { Box, ShrunkLake } from './todayTool';

/** 一位人物的源数据：文件夹（相对项目的根目录，以“/”结尾）和里面的三个文件。 */
export interface RouteSource {
  folder: string;
  /** 高程格子的说明（投影、多少格、每格多少公里、最高的一格）。 */
  dem: string;
  /** 高程格子的数。 */
  demBytes: string;
  /** 陆地的圈、湖、河。 */
  water: string;
}

/** 表里的一行：一位人物的全程沙盘照什么做。 */
export interface RouteToolFigure {
  source: RouteSource;
  /** “今天的岸线、湖、河”那个文件裁到的方框（比沙盘的范围四边各宽出一截）。 */
  todayBox: Box;
  /** 源数据里按中心缩小过、工具要放回原来大小的湖。没有就是空的。 */
  shrunkLakes: readonly ShrunkLake[];
  /** 每条沿着河走的路：离河多远、在哪一边（路的 id 是这位人物的场景里的）。没有沿着河走的路就是空的。 */
  banks: Record<string, BankSpec>;
}

/**
 * 苏轼的全程沙盘上每条沿着河走的路：离河多远、在哪一边。边是这样定的：一条路从头到尾在河的同一边；
 * 同一条河上接着走的几条路在同一边；城在河的哪一边，路尽量就在哪一边。样张里有的照样张。
 */
const SU_SHI_BANKS: Record<string, BankSpec> = {
  'w-min': { offKm: 5, side: -1, why: '往南走的右手边，就是西岸：眉州城在岷江西边（样张也是这一边）' },
  'w-min-low': { offKm: 6, side: 1, why: '往东南走的左手边，就是东北岸：接着大江的北岸（样张也是这一边）' },
  'w-jiang-upper': { offKm: 8, side: 1, thinKm: 6, why: '往东走的左手边，就是北岸（样张也是这一边）。三峡里河弯得大，引线抽得细一些' },
  'w-ying': { offKm: 6, side: 1, why: '往东南走的左手边，就是东北岸：陈州在颍水的东北面，接着淮水的北岸' },
  'w-huai-mid': { offKm: 6, side: 1, why: '往东走的左手边，就是北岸：下蔡、涡口、泗州都在北岸' },
  'w-huai-low': { offKm: 6, side: -1, why: '往东北走的右手边，就是东南岸：淮阴、楚州在这一边（样张也是这一边）' },
  'w-canal-n1': { offKm: 5, side: -1, why: '往南走的右手边，就是西岸：东边是射阳湖那一片水' },
  'w-canal-n2': { offKm: 5, side: -1, why: '同上一条，西岸' },
  'w-canal-s1': { offKm: 5, side: 1, paste: false, why: '不贴：大江以南的两段运河定了照直线画' },
  'w-canal-s2': { offKm: 5, side: 1, paste: false, why: '不贴：大江以南的两段运河定了照直线画' },
  'w-bian-a': { offKm: 6, side: 1, why: '往东南走的左手边，就是东北岸（样张也是这一边）' },
  'w-bian-b': { offKm: 6, side: 1, why: '同上一条' },
  'w-bian-c': { offKm: 6, side: 1, why: '同上一条' },
  'w-jiang-lower': { offKm: 8, side: -1, why: '往西南（上水）走的右手边，就是北岸、西岸：和样张的大江下游是同一边，不碰南岸的彭蠡' },
  'w-gan': { offKm: 6, side: 1, why: '往南（上水）走的左手边，就是东岸：吉州、虔州一带的路不压着西边的山' },
  'w-bei': { offKm: 6, side: 1, why: '往南走的左手边，就是东岸：广州在北江的东面（样张也是这一边）' },
  'w-dong': { offKm: 6, side: 1, why: '往东走的左手边，就是北岸：博罗在北岸（样张也是这一边）' },
  'w-xi': {
    offKm: 6,
    side: -1,
    meet: [112.83, 23.18],
    why: '往西走的右手边，就是北岸：端州、康州、封州、梧州都在北岸（样张也是这一边）。从广州直着连到西江、北江汇合的地方（今三水）上岸：数据里离广州最近的是三角洲里往南的一条汊，照它走要先往南绕一个弯',
  },
};

/** 那张表：人物的文件夹名 → 他的那一行。 */
export const ROUTE_TOOL_FIGURES: Record<string, RouteToolFigure> = {
  'su-shi': {
    // 定稿的样张做的数据：高程是圆锥投影上每格 3 公里的格子，岸线、湖、河是 Natural Earth 1:10m 裁出来的
    source: { folder: 'spikes/art-direction/route/data/', dem: 'dem.json', demBytes: 'dem.bin', water: 'water.json' },
    // 样张用的那一个方框
    todayBox: { west: 100.3, east: 124.3, south: 16.8, north: 39.3 },
    // 样张把今天的高邮湖按中心缩到了六成
    shrunkLakes: [{ name: 'Gaoyou Hu', factor: 0.6 }],
    banks: SU_SHI_BANKS,
  },
  goethe: {
    // 高程是圆锥投影上每格 2.5 公里的格子；岸线、湖、河是 Natural Earth 1:10m 连同它的欧洲补充裁出来的，另有手工补的几条河、几个湖的岸
    source: { folder: 'spikes/art-direction/route-goethe/data/', dem: 'dem.json', demBytes: 'dem.bin', water: 'water.json' },
    // 源数据的陆地已经裁到的那一个方框
    todayBox: { west: 1.9, east: 22.8, south: 35.5, north: 54.1 },
    // 源数据里没有缩小过的湖
    shrunkLakes: [],
    // 他的沙盘上船走的线画在水上（roads.boats 是 on），没有贴着河岸走的路
    banks: {},
  },
};

/** 这位人物的场景文件所在的文件夹（相对项目的根目录，以“/”结尾）。做出来的文件平常也放在这里。 */
export const scenesFolder = (figureId: string): string => `content/figures/${figureId}/scenes/`;

/** 全程沙盘的场景文件叫什么（在 scenesFolder 里）。 */
export const ROUTE_SCENE_FILE = 'route.json';

/**
 * 这一次给哪一位人物做。asked 是 ROUTE_FIGURE 的值（没设是 undefined，设成空的也算没设）。
 * 写了：得是表里有的。没写：表里只有一位就是他；有两位以上、或者一位也没有，停下来说。
 */
export function routeToolFigure(asked: string | undefined, table: Record<string, RouteToolFigure> = ROUTE_TOOL_FIGURES): { id: string; figure: RouteToolFigure } {
  const ids = Object.keys(table);
  const listed = ids.join('、') || '一位也没有';
  if (asked) {
    const figure = Object.hasOwn(table, asked) ? table[asked] : undefined;
    if (!figure) throw new Error(`ROUTE_FIGURE 写的“${asked}”不在做全程沙盘的那张表里（tests/tools/route/figures.ts）：表里有 ${listed}`);
    return { id: asked, figure };
  }
  if (ids.length !== 1) throw new Error(`要说给哪一位人物做：设环境变量 ROUTE_FIGURE=<人物的文件夹名>。做全程沙盘的那张表里（tests/tools/route/figures.ts）有 ${listed}`);
  return { id: ids[0], figure: table[ids[0]] };
}

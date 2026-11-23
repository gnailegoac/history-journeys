// 宋代青绿设色（'song-qinglv'）这一种时代样式：颜色、山上的分带、模型跟着远近怎么变、题签抬多高、灯、雾。
// 颜色和数大多是从样张搬来的（spikes/art-direction/b/scene/ 里 config.js 的 PAL、sandtable.js 的灯和各个镜头的雾），没有改。
// 样张里没有、这里新定的只有四样：夯土色、墙脚土坡的颜色、雾的颜色单列出来、题签的抬高。
// 模型跟着远近怎么变的那张表在 ./songQinglvFigure.ts。灯白天只有一盏，夜里一套（方向跟着月亮），都不看镜头。

import type { SceneMoon, SceneSky, ThingKind } from '../../../domain/scene';
import type { GroundColour, Vec2 } from '../../ground/types';
import type { FigureClass, LightSpec, RouteStyle, StageStyle } from '../internal';
import { moonDir, sheenFor } from '../rig';
import { SONG_QINGLV_FIGURE } from './songQinglvFigure';

// ---------------------------------------------------------------- 颜色

/** 地面上色用的颜色（样张 PAL 的“沙盘”一组）。 */
const GROUND_COLOURS: Record<GroundColour, string> = {
  tea: '#e6d9b8', // 平地：茶色绢底
  teaWarm: '#e4d3a8', // 平地：带一点藤黄
  meadow: '#c4c9a2', // 河边、洼地的草色
  fieldA: '#d8cc9f', // 远看的田：三种浅色轮着上
  fieldB: '#cfc994',
  fieldC: '#c4c9a2',
  ochre: '#c0975f', // 山脚：赭石
  ochreDeep: '#99683f', // 沟里：深赭
  shilu: '#629b80', // 山腰：石绿
  shiluDeep: '#4f8a73',
  shiqing: '#3a6c9c', // 山顶：石青
  shiqingDeep: '#2d5689',
  sand: '#e6dbb9', // 河岸留白
  bed: '#b7c9c8', // 水底
  blank: '#efe6cf', // 画心四边留出的空绢
  road: '#ecdfbd', // 城里的街巷
  path: '#c9b184', // 城外的路
  cityGround: '#d3c5a4',
};

/** 全部颜色。名字照样张的 PAL；rammedEarth、bankEarth 和 fog 是新添的。 */
const PALETTE: Record<string, string> = {
  ...GROUND_COLOURS,
  // 水
  water: '#aac6cd', // 淡花青（大水）
  waterDeep: '#7da3b4',
  waterCalm: '#8fb5c2', // 平时的河深一点，河才看得见
  waterCalmDeep: '#6f9db2',
  ripple: '#f7f3e6',
  mist: '#f3ecdb',
  // 小模型
  tile: '#70767a', // 灰瓦
  plaster: '#efe8d6', // 白墙
  vermilion: '#9a3a2c', // 朱柱
  earthYellow: '#c8a765', // 刷了黄土的墙
  timber: '#4b3229',
  brick: '#a9a08c', // 城砖
  stone: '#c7bda4',
  earth: '#d6ba7c', // 新筑的堤
  thatch: '#a38a58',
  boat: '#74513a',
  mat: '#bfa26a',
  tree: '#4a6e56', // 树的中间色；下暗上亮在模型里做
  treeBlue: '#47705f',
  treeOlive: '#6b7d50',
  willow: '#7c9468',
  rock: '#6d767b',
  rockPale: '#d9d5c6',
  // 装裱和座子
  brocade: '#e4d8ba', // 绫边
  brocadeFig: '#c9b88e',
  blockSide: '#c2a97c',
  sandal: '#33201b', // 紫檀
  // 新添的
  rammedEarth: '#bda27a', // 夯土的城墙：比新筑的堤旧一点、灰一点
  bankEarth: '#c2b292', // 墙脚到水边的旧土坡：在平地的茶色和夯土城墙之间，不比城墙亮眼
  fog: '#ece3cf', // 远处的雾（样张里直接写在 sandtable.js 里）
};

// ---------------------------------------------------------------- 题签抬多高

/**
 * 题签指着一样摆件时，比它脚下的地面高出多少（沙盘里的米，模型是本来的大小时）。差不多是这样东西的顶。
 * 摆在别的东西上面的（城门在城墙上，楼在城门上），这里写的是比底下那样东西的顶再高出多少。
 * 模型跟着远近放大时，镜头那一边把每一环各乘上它那一类的倍数（../rig.ts 的 liftOf）。
 * 城墙的 62、城门的 8 是样张的数；单座的屋是对着图片定的；别的是照样张里的模型估的。
 */
const STRIP_LIFT: Record<ThingKind, number> = {
  wall: 62,
  gate: 8,
  tower: 76,
  // 亭子连台基到宝顶 35 上下：题签的那个点落在宝顶尖上，不压在屋顶上（亭子小，一压就盖掉小半个顶）
  pavilion: 38,
  'hall-group': 40,
  // 地上单座的茅屋连台基到屋脊 26 上下：那个点落在屋脊上面一点
  house: 28,
  dike: 30,
  bank: 6,
  'timber-bank': 10,
};

/**
 * 墙顶上单座的屋（城墙上的棚子）另写一个数：那个点悬在棚子上面一点，不压着它。
 * 棚子从墙顶到棚顶才 12.5，顺着墙长 34 米：斜着看，它在画面上比那个点大不了多少。点落在棚顶上（13）就把它盖住了，
 * 竖着拿的平板上盖得一点不剩；照上面“屋”的 28 算，点还压着棚子靠里的那一头。36 是对着三种屏幕的图片定的：
 * 点的下沿离棚子最高的那一头一到四个像素。
 */
const STRIP_LIFT_BY_CLASS: Partial<Record<FigureClass, number>> = { shed: 36 };

// ---------------------------------------------------------------- 灯

/**
 * 这种样式的一盏灯：从东北上方来的暖光（强弱、颜色是样张平常用的那一盏，方向是它左右对调）。不看镜头朝哪边、离多远。
 * 光从哪边来是定过的事（docs/decisions.md 第 21 条），要改先由负责人定；tests/stage/rig.test.ts 里记着现在的方向，改了这里那边会不通过。
 * 影子的虚实和偏移不在这里：按影子罩多大一块来定（../rig.ts 的 shadowTuning）。
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
 * 夜里的一套：月光是冷的、淡的，天光补得多（夜色不黑到看不清地形），方向照这一小节写的月亮。
 * 白天平地的亮算 100 的话：月亮 12 度高时平地 26、影子里 20；68 度高时平地 46（都是线性的光；屏幕上看是 54、49、70）。
 * fog、mist 是照足了光时的颜色，用的时候按上面的比例压暗；云气夜里淡到八成。
 * 这是第一次试看用的数（在徐州的沙盘上试的），负责人看过图以后再定；tests/stage/rig.test.ts 里记着，改了那边会不通过。
 */
const NIGHT = {
  sun: 1.15,
  sunColor: '#cfdcf2',
  hemi: 1.05,
  sky: '#b8c8e6',
  ground: '#5f6a7a',
  fog: '#d5deea',
  mist: '#dfe6ee',
  mistStrength: 0.8,
};

/** 月光直接照到的水面多亮出几倍，照 ../rig.ts 的 sheenFor 算时用的强弱：月亮 12 度高时是 4.8 倍，68 度高时几乎没有。 */
const NIGHT_SHEEN = 2;

function light(sky: SceneSky, moon?: SceneMoon): LightSpec {
  return sky === 'night' && moon ? { ...NIGHT, dir: moonDir(moon.azimuth, moon.altitude), sheen: sheenFor(NIGHT_SHEEN, moon.altitude) } : LIGHT;
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
 * 全程沙盘自己的那一份。数都是定稿的样张的（spikes/art-direction/route/scene/ 里 palette.js、fields.js 的 PAINT 和河宽）。
 * 网格 59 米一格，合地上约 10 公里。2026-11-20 对着图片和 48 米一格的比过（从低处看四川一带）：山脊和山的轮廓看不出差别，所以用粗的。
 */
const ROUTE: RouteStyle = {
  segmentM: 59,
  reducedSegmentTimes: 1.07,
  ripplePx: 8,
  riverKm: { trunk: 8, major: 4.6, river: 3.6, minor: 2.8, canal: 1.8 },
  colours: {
    loess: '#dcc592',
    sand: '#ebe1c2',
    shoreInk: '#a8936a',
    sea: '#b3ccd0',
    seaDeep: '#93b6c1',
    river: '#6f9db2',
    riverSong: '#93b3bd',
  },
  bands: {
    relK: 1.0,
    hK: 0.2,
    noise: 70,
    foot: [110, 240],
    footK: 0.6,
    green: [240, 540],
    blue: [520, 900],
    blueK: 0.92,
    rank: [0.62, 0.92],
    rankCurv: 1 / 500,
    deep: [1500, 2600],
    steep: [0.22, 0.6],
    patch: 0.24,
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

export const songQinglv: StageStyle = {
  id: 'song-qinglv',
  palette: PALETTE,
  ground: {
    colours: GROUND_COLOURS,
    bands: { foot: [2.4, 8], green: [7, 22], blue: [40, 84], deepBlue: [88, 125] },
  },
  figure: SONG_QINGLV_FIGURE,
  stripLift: STRIP_LIFT,
  stripLiftByClass: STRIP_LIFT_BY_CLASS,
  light,
  fogFor,
  mistFor,
  route: ROUTE,
};

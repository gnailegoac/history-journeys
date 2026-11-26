// 宋代青绿设色（'song-qinglv'）这一种时代样式，整套：颜色、山上的分带、模型跟着远近怎么变、题签抬多高、灯、雾。
// 这个文件里是站点沙盘才用的那一半（地面的颜色和分带，小模型的颜色，题签抬多高，夜里的一套灯；模型跟着远近怎么变的那张表在 ./figure.ts）；
// 每一座沙盘都用的那一半（白天的灯、雾、全程沙盘的那一份、装裱和座子、小像）在 ./song-qinglv-route.ts，这里引进来合成整套。
// 站点沙盘取这个文件（连它引的那一半，两小块一起下载）；全程沙盘只取那一半。登记在 src/stage/styles.ts，怎么取见 ../index.ts。
// 颜色和数大多是从样张搬来的（spikes/art-direction/b/scene/ 里 config.js 的 PAL），没有改。
// 样张里没有、这里新定的只有四样：夯土色、墙脚土坡的颜色、雾的颜色单列出来、题签的抬高。

import type { SceneMoon, SceneSky, ThingKind } from '../../../../domain/scene';
import type { GroundColour } from '../../../ground/types';
import type { FigureClass, LightSpec, StageStyle } from '../../internal';
import { moonDir, sheenFor } from '../../rig';
import { SONG_QINGLV_FIGURE } from './figure';
import { style as common } from './song-qinglv-route';
// 这一句只为打包（缘故见 ./song-qinglv-route.ts 里同样的一句）。
import '../../engine';

/** 哪一层的沙盘都要的那七种颜色，写在 ./song-qinglv-route.ts 里：下面那张表里的这七种取的是它们，不另写一遍。 */
const COMMON = common.palette;

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
  court: '#eee9de', // 写明了要浅色的院子：比平地白，夜里是画面上最亮的地面（原来是 #f6f2e6：白天近看时它成了画面里最白最大的一块，抢了要看的东西）
  sprout: '#a9bf7e', // 青苗的田：草绿，比山腰的石绿黄、浅
};

/** 全部颜色。名字照样张的 PAL；rammedEarth、bankEarth 和 fog 是新添的。 */
const PALETTE: Record<string, string> = {
  ...GROUND_COLOURS,
  // 水
  water: '#aac6cd', // 淡花青（大水）
  waterDeep: '#7da3b4',
  waterCalm: '#8fb5c2', // 平时的河深一点，河才看得见
  waterCalmDeep: '#6f9db2',
  ripple: COMMON.ripple,
  mist: COMMON.mist,
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
  brocade: COMMON.brocade,
  brocadeFig: COMMON.brocadeFig,
  blockSide: COMMON.blockSide,
  sandal: COMMON.sandal,
  // 新添的
  rammedEarth: '#bda27a', // 夯土的城墙：比新筑的堤旧一点、灰一点
  bankEarth: '#c2b292', // 墙脚到水边的旧土坡：在平地的茶色和夯土城墙之间，不比城墙亮眼
  fog: COMMON.fog,
  // 黄州添的：崖壁的红褐色和崖脚的深色，竹、柏，崖脚石头的三种颜色。
  // 崖壁的两种颜色写得比白天看到的浅、红：崖面背着光（白天的光从东北来，夜里的月亮在东南），照到它的只有天光，
  // 夜里的天光偏蓝，红褐色的石头在蓝光底下最吃亏。原来的 #a4563c、#7d4130 在夜里是画面上最黑的一块，认不出是红的。
  cliff: '#d46242',
  cliffDeep: '#b6563a',
  bamboo: '#8fae6a',
  cypress: '#2f4f48',
  // 石头只用石头的颜色（红褐、灰褐、深褐）：原来的黄和浅色，石头小的时候看着像花瓣
  shoreRed: '#9a5a44',
  shoreBrown: '#7d6a5c',
  shoreDark: '#5a4a42',
};

// ---------------------------------------------------------------- 夜里的灯

/** 白天的那一盏：写在 ./song-qinglv-route.ts 里（每一座沙盘都用），这里取的就是它，不另写一遍。 */
const LIGHT: LightSpec = common.light('day');

// 下面到 light 为止，2026-11-26 从 ./song-qinglv-route.ts 搬来，一行没有改：全程沙盘没有夜，夜里的这一套只有站点沙盘用，不叫全程沙盘下载。
/**
 * 夜里的一套：月光是冷的、淡的，天光补得多（夜色不黑到看不清地形），方向照这一小节写的月亮。
 * 月光和天光多强跟着月亮的高矮走（NIGHT_ENDS）：月亮高，光直着下来，平地亮得多；两头用一样的数的话，
 * 月亮 68 度高的一夜看着像阴天的下午，12 度高的一夜才像夜里。所以月亮越高，这两样越弱。
 * 白天平地的亮算 100 的话：月亮 12 度高时平地 26、影子里 20；68 度高时平地 35、影子里 15（都是线性的光；屏幕上看是 54、49、62、42）。
 * fog、mist 是照足了光时的颜色，用的时候按上面的比例压暗；云气夜里淡到八成。
 * 2026-11-23 负责人看过徐州上试的图以后定的；tests/stage/rig.test.ts 里记着，改了那边会不通过。
 * 同一天看过黄州三夜的样张以后，三种光的颜色换成了冷一点的一套（月光 #aac4f3、天色 #95b3ec、地色 #42527a；
 * 原来是 #cfdcf2、#b8c8e6、#5f6a7a）：照到月光的平地带一点蓝，原来是暖灰，承天寺那一夜看着像阴天。
 * 颜色暗了，两头的强弱照颜色的亮度各乘回去（月光 1.30 倍、天光 1.28 倍），平地还是原来那么亮。
 */
const NIGHT = {
  sunColor: '#aac4f3',
  sky: '#95b3ec',
  ground: '#42527a',
  fog: '#d5deea',
  mist: '#dfe6ee',
  mistStrength: 0.8,
};

/**
 * 夜里月光（sun）、天光（hemi）的两头：月亮在 low.altitude 度以下用 low 的数，high.altitude 度以上用 high 的数，
 * 中间照月亮高度的正弦匀过去（平地上直接照到的光就是照正弦长的）。
 */
const NIGHT_ENDS = { low: { altitude: 12, sun: 1.495, hemi: 1.344 }, high: { altitude: 68, sun: 1.17, hemi: 0.96 } };

/** 月亮 12 度高时，月光直接照到的水面多亮出几倍；月亮再高照 ../../rig.ts 的 sheenFor 降下去：24 度高时 5.1 倍，68 度以上没有。 */
const NIGHT_SHEEN = 9.1;

const sinDeg = (deg: number): number => Math.sin((deg * Math.PI) / 180);

function light(sky: SceneSky, moon?: SceneMoon): LightSpec {
  if (sky !== 'night' || !moon) return LIGHT;
  const { low, high } = NIGHT_ENDS;
  const t = Math.min(1, Math.max(0, (sinDeg(moon.altitude) - sinDeg(low.altitude)) / (sinDeg(high.altitude) - sinDeg(low.altitude))));
  return {
    ...NIGHT,
    sun: low.sun + (high.sun - low.sun) * t,
    hemi: low.hemi + (high.hemi - low.hemi) * t,
    dir: moonDir(moon.azimuth, moon.altitude),
    sheen: sheenFor(NIGHT_SHEEN, moon.altitude),
  };
}

// ---------------------------------------------------------------- 题签抬多高

/**
 * 题签指着一样摆件时，比它脚下的地面高出多少（沙盘里的米，模型是本来的大小时）。差不多是这样东西的顶。
 * 摆在别的东西上面的（城门在城墙上，楼在城门上），这里写的是比底下那样东西的顶再高出多少。
 * 模型跟着远近放大时，镜头那一边把每一环各乘上它那一类的倍数（../../rig.ts 的 liftOf）。
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
  // 崖壁：那个点落在崖顶的边上面一点
  cliff: 100,
  // 矮土墙高 11，小门连瓦顶 22 上下
  'earth-wall': 12,
  'small-gate': 24,
  // 浮桥的桥面比水面高 4；池沿高 3；坟大的高 13、小的 8（题签指着大的那一座的顶）
  'pontoon-bridge': 8,
  pool: 5,
  'grave-mound': 15,
};

/**
 * 墙顶上单座的屋（城墙上的棚子）另写一个数：那个点悬在棚子上面一点，不压着它。
 * 棚子从墙顶到棚顶才 12.5，顺着墙长 34 米：斜着看，它在画面上比那个点大不了多少。点落在棚顶上（13）就把它盖住了，
 * 竖着拿的平板上盖得一点不剩；照上面“屋”的 28 算，点还压着棚子靠里的那一头。36 是对着三种屏幕的图片定的：
 * 点的下沿离棚子最高的那一头一到四个像素。
 */
const STRIP_LIFT_BY_CLASS: Partial<Record<FigureClass, number>> = { shed: 36 };

// ---------------------------------------------------------------- 合起来

/** 这种样式，整套：每一座沙盘都用的那一半，加上站点沙盘才用的。登记表（src/stage/styles.ts 的 load）取到这个文件以后，拿的就是它。 */
export const style: StageStyle = {
  ...common,
  light,
  palette: PALETTE,
  ground: {
    colours: GROUND_COLOURS,
    bands: { foot: [2.4, 8], green: [7, 22], blue: [40, 84], deepBlue: [88, 125] },
  },
  figure: SONG_QINGLV_FIGURE,
  stripLift: STRIP_LIFT,
  stripLiftByClass: STRIP_LIFT_BY_CLASS,
};

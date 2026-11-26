// 全程沙盘的地面由谁来画：一种时代样式一个画法，登记在这里。
// 全程沙盘的地面不在页面上现画，页面只取制作时画好的两张图；怎么画是做图的工具的事，画法和它用的数不随沙盘程序发给读者。
// 画法各是各的（山上怎么分带、黄土和海是什么颜色、留白的边怎么淡下去），不是同一个画法换几个数：所以按样式分，一种样式一个文件。
// 一行两样：paint 给地面上色；rivers 是画在地面上的那几条河的线（多宽是这个画法自己的数）——上色用它，
// 给走水路的路做岸线的工具（npm run route:bank）、量“沿河的路离河多远”的测试（tests/stage/route-roads.test.ts）也用它：
// 它们照场景里写的样式从这张表里取，拿到的是这座沙盘自己的画法画出来的河，不是别的样式的。
// 做图的工具（npm run bake，经 ./bakeRoute.ts）和查“旧不旧”的测试（tests/stage/baked-fresh.test.ts）都从这张表里取画法；
// content/ 里每一座全程沙盘写的样式，这里都要有它的画法（tests/stage/route-paint.test.ts 查着）。
// 添一种样式的全程沙盘：写它的画法（一个文件），在这里添一行；已有的画法不动。

import type { RouteScene } from '../../../src/domain/scene';
import type { FrameCoords } from '../../../src/domain/sceneGeo';
import type { TodayFeature } from '../../content/routeRules';
import { paintRoute, riverPaths } from './paint';
import type { RiverPath, RoutePaintInput, RoutePainted } from './paint';

/** 一种画法：给全程沙盘的地面上色。同样的输入画出同样的字节。 */
export type RoutePainter = (input: RoutePaintInput) => RoutePainted;

/** 一种画法画在地面上的河：场景里每一条河画成什么线、多宽、用哪种颜色。 */
export type RouteRivers = (scene: RouteScene, features: TodayFeature[], coords: FrameCoords) => RiverPath[];

/** 表里的一行：一种样式的画法，和它画在地面上的河的线。 */
export interface RoutePainterRow {
  paint: RoutePainter;
  rivers: RouteRivers;
}

/** 样式的名字 → 它的画法。 */
export const ROUTE_PAINTERS: Readonly<Record<string, RoutePainterRow>> = {
  /** 宋代青绿设色。 */
  'song-qinglv': { paint: paintRoute, rivers: riverPaths },
};

/** 画法的一张表：样式的名字 → 它的那一行。 */
export type RoutePainterTable = Readonly<Record<string, RoutePainterRow>>;

/** style 这种样式的那一行。没有登记的，说一句就停。 */
function rowFor(style: string, table: RoutePainterTable): RoutePainterRow {
  const row = Object.keys(table).includes(style) ? table[style] : undefined;
  if (!row) throw new Error(`样式“${style}”还没有全程沙盘地面的画法（tests/tools/route/painters.ts）；有画法的是：${Object.keys(table).join('、')}`);
  return row;
}

/**
 * style 这种样式的画法。没有登记的，说一句就停。
 * table 不写就是上面那张表；测试里编出来的样式不进那张表，查编出来的沙盘时把它自己的一张交进来（下面的 routeRiversFor 也一样）。
 */
export function routePainterFor(style: string, table: RoutePainterTable = ROUTE_PAINTERS): RoutePainter {
  return rowFor(style, table).paint;
}

/** style 这种样式的画法画在地面上的河。没有登记的，说一句就停（不悄悄拿别的样式的河宽来顶）。 */
export function routeRiversFor(style: string, table: RoutePainterTable = ROUTE_PAINTERS): RouteRivers {
  return rowFor(style, table).rivers;
}

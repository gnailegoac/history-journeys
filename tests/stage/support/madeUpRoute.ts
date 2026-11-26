// 测试用的一座编出来的全程沙盘（tests/content/fixtures/made-up/figures/traveller/），和它的编出来的样式（./madeUpStyle.ts）。
// 它不在 content/ 里，读者看不到；给“另一位人物的全程沙盘会有、苏轼的那一座没有”的几样作证，在他的文件进来以前把每一条新路都跑一遍：
//   一站分两段讲（甲城：头一回到，去了丙港，又回来），哪一节画哪些路照写的先后算；
//   一趟路里陆路和水路相接，一笔在线型变的地方断开；水路的两种线型（有记载的，只知道两头的），海路用水路的线型；
//   船走在水上（roads.boats 写 on），有一条船走的路没有写走的是哪条水；
//   看一站的小节画的是这一站那几年走的路（roads.stopShows 写 stop-years）；
//   地面照量到的样子（recipe 是 as-measured）；留白的一圈离路、离地名点六十公里以上。
// 人名、地名都是编的（甲城、乙渡、丙港、丁镇、戊庄、己岛、辛集、西岭，子河、午湖），在东经 160 度、北纬 20 度的海上。
// 题签的另一种——平着的纸条——也在它上面试（../made-up-labels.test.ts）：乙渡算在两站名下（两个站号的印），西岭是没有点的名字，头一节九条名字；
// 它的样式那一行写了 labels: 'slip'（./madeUpStyle.ts）。
// 那个文件夹里的四个文件是一个小脚本写出来的，不手改：要改，改 tests/content/fixtures/made-up/make-fixture.mjs 再重做一遍（怎么跑写在它开头）。

import type { RouteScene } from '../../../src/domain/scene';
import { coordsOf } from '../../../src/domain/sceneGeoRoute';
import { buildRouteGround, readRouteDem, routeSamplers } from '../../../src/stage/ground/route';
import type { BlankEdge } from '../../../src/stage/ground/route';
import type { RouteStyle } from '../../../src/stage/three/internal';
import { readToday } from '../../content/routeRules';
import type { TodayFeature } from '../../content/routeRules';
import { readBytes } from '../../support/readBytes';
import { paintRoute, riverPaths } from '../../tools/route/paint';
import type { RoutePainterRow } from '../../tools/route/painters';
import { MADE_UP_STYLE_ID, style } from './madeUpStyle';
import type { RealRouteScene } from './realScenes';

/** 这座编出来的沙盘在哪（相对项目的根目录）。 */
export const MADE_UP_FOLDER = 'tests/content/fixtures/made-up/figures/traveller';
/** 它在测试里叫什么（“人物/route”的写法）。 */
export const MADE_UP_KEY = 'traveller/route';
/** 它的三站，照 figure.json 的先后。 */
export const MADE_UP_STOPS: readonly string[] = ['jia', 'bing', 'ding'];

const read = (file: string): string => new TextDecoder().decode(readBytes(`${MADE_UP_FOLDER}/${file}`));

/** 它的场景文件：每叫一次读一份新的（测试里可以放心改）。 */
export function madeUpScene(): RouteScene {
  return JSON.parse(read('scenes/route.json')) as RouteScene;
}

/** 它的样式里全程沙盘的那一份，和留白的边怎么收。 */
export const MADE_UP_ROUTE_STYLE = style.route as RouteStyle;
export const MADE_UP_BLANK_EDGE: BlankEdge = MADE_UP_ROUTE_STYLE.blank;

/**
 * 它的地面的画法：这种编出来的样式没有自己的画法，借宋代青绿设色的（只为有一条“画在地面上的河”可量、有一张地面可拍）。
 * 交给认样式取画法的地方（tests/tools/route/painters.ts 的 routeRiversFor、routePainterFor 的第二个参数）。
 */
export const MADE_UP_PAINTERS: Readonly<Record<string, RoutePainterRow>> = { [MADE_UP_STYLE_ID]: { paint: paintRoute, rivers: riverPaths } };

let built: (RealRouteScene & { features: TodayFeature[] }) | null = null;

/** 照 scene 这份场景（不写就是文件里的那一份）算出来的地面，样子和 ./realScenes.ts 给 content/ 里的沙盘的一样。 */
export function madeUpRouteOf(scene: RouteScene): RealRouteScene {
  const coords = coordsOf(scene);
  const dem = readRouteDem(scene.terrain, readBytes(`${MADE_UP_FOLDER}/scenes/${scene.terrain.file}`));
  const ground = buildRouteGround(scene, dem, coords, MADE_UP_BLANK_EDGE);
  return { key: MADE_UP_KEY, scene, coords, headings: scene.sections.map((s) => s.heading), dem, ground, samplers: routeSamplers(ground), todayPath: `${MADE_UP_FOLDER}/scenes/${scene.water.todayFile}` };
}

/** 这座编出来的沙盘：场景、地面、“今天的海岸、湖、河”。只算一次。 */
export function madeUpRoute(): RealRouteScene & { features: TodayFeature[] } {
  if (built) return built;
  const made = madeUpRouteOf(madeUpScene());
  built = { ...made, features: madeUpToday() };
  return built;
}

/** 它的“今天的海岸、湖、河”。 */
export function madeUpToday(): TodayFeature[] {
  const today = readToday({ today: read('scenes/route.today.geojson') }, 'today');
  if (!today || 'problem' in today) throw new Error('编出来的沙盘的“今天的海岸、湖、河”读不出来');
  return today.features;
}

/** 校验规则要的那几样：文件的单子（路径照内容目录的写法）、地形文件和岸线文件的大小、各站的 id。 */
export function madeUpFiles(scene: RouteScene = madeUpScene()): { file: string; files: Record<string, string>; sizes: Record<string, number> } {
  const dir = 'figures/traveller/scenes';
  const terrain = readBytes(`${MADE_UP_FOLDER}/scenes/route.terrain.bin`);
  const today = read('scenes/route.today.geojson');
  return {
    file: `${dir}/route.json`,
    files: { [`${dir}/route.json`]: JSON.stringify(scene), [`${dir}/route.terrain.bin`]: '', [`${dir}/route.today.geojson`]: today, 'figures/traveller/figure.json': read('figure.json') },
    sizes: { [`${dir}/route.terrain.bin`]: terrain.byteLength, [`${dir}/route.today.geojson`]: new TextEncoder().encode(today).length },
  };
}

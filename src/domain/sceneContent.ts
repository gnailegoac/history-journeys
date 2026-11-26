// 读取 content/ 目录里的场景数据：一站的沙盘、一位人物的全程沙盘（场景文件和地形文件的网址，加上工具照着它做出来的两样——
// 先画好的地面、每一小节的定格图）。
// 加一站的沙盘只加内容文件，这里不用改。
//
// 场景文件只用 import.meta.glob<StopScene>(...) 读，不直接 import 那个 JSON
// （直接 import 时坐标会被当成 number[]，对不上 LngLat）；两份清单也是这样读。
// 有哪些场景文件、哪些清单，地形文件、先画好的地面、定格图的网址，打包时就知道，但是不带在页面一打开就下载的那一块里
// （一座沙盘十几二十个文件，沙盘越多越长）：它们在 contentLists.ts 里，是另一小块，页面的程序一开始跑就去要（content.ts 的 loadLists），
// 这里先等它到，再照它去取场景文件和清单。文件本身仍然是用到时才下载。
//
// 工具做的两样可以没有：还没做的沙盘照样摆得出来（地面打开时现画，没有定格图）。清单在、它写的图片却不齐时，
// 这一样就当作没有——宁可不用，也不拿半套去用。它们齐不齐、对不对得上，由 npm run validate 的规则 17、18 管。

import type { RouteTable, StopTable } from '../stage/types';
import type { BakedGroundManifest } from './bakedGround';
import { loadLists } from './content';
import type { StopScene, TableScene } from './scene';
import type { StillManifest } from './stills';
import type { Figure } from './types';

const ROOT = '/content/figures';

/**
 * 从一张“路径 → 怎么读”的表里马上去读这一项（没有这一项就什么也不读），返回只有这一项的表：
 * 再读它，给的是已经在路上的那一份，不读第二遍。
 */
function started<T>(table: Record<string, () => Promise<T>>, path: string): Record<string, () => Promise<T>> {
  const load = table[path];
  if (!load) return {};
  const reading = load();
  // 这一份要是没读出来，而别的先出了错、没有人来接它：不让浏览器另报一次“未处理的错误”
  reading.catch(() => {});
  return { [path]: () => reading };
}

/**
 * 一站的沙盘读出来的样子：就是 StopTable（src/stage/types.ts）里由内容决定的那几样，字段的意思见那里。
 * ground、stills 没有的时候不写。
 */
export type StopTableContent = Pick<StopTable, 'scene' | 'terrainUrl' | 'ground' | 'stills'>;

/** 工具做出来的文件：两份清单“路径 → 怎么读”，两种图片“路径 → 网址”。 */
export interface MadeFiles {
  bakedManifests?: Record<string, () => Promise<BakedGroundManifest>>;
  bakedUrls?: Record<string, string>;
  stillManifests?: Record<string, () => Promise<StillManifest>>;
  stillUrls?: Record<string, string>;
}

/**
 * 这一站有没有自己的沙盘。不用等：figure.json 里这一站写着（table），读到人物就知道了；它和 scenes/ 里的文件
 * 对不对得上，由 npm run validate 的规则 3 管。
 * 页面用它决定沙盘栏一上来放什么：有，摆这一站的沙盘；没有，摆全程沙盘上到这一站去的来路。
 */
export function hasStopTable(figure: Figure, stopId: string): boolean {
  return figure.stops.some((stop) => stop.id === stopId && stop.table === true);
}

/**
 * 一站的沙盘：场景和地形文件的网址；做过先画好的地面、每一小节的定格图的，一并带上。
 * 这一站还没有场景文件、或者场景写的地形文件不在时返回 null。
 */
export async function loadStopTable(figureId: string, stopId: string): Promise<StopTableContent | null> {
  const lists = await loadLists();
  const dir = `${ROOT}/${figureId}`;
  // 没有场景文件的站，什么也不用取
  if (!(`${dir}/scenes/${stopId}.json` in lists.scenes)) return null;
  // 三样一起去取，不排队：场景，两份清单。网址的那三张表和清单是一块儿到的，照场景和清单就能挑出这一站要的那几个
  const scenes = started(lists.scenes, `${dir}/scenes/${stopId}.json`);
  const baked = started(lists.bakedManifests, `${dir}/baked/${stopId}.json`);
  const stills = started(lists.stillManifests, `${dir}/stills/${stopId}.json`);
  const terrains = Object.fromEntries(Object.entries(lists.terrain).map(([path, url]) => [path, () => Promise.resolve(url)]));
  return pickStopTable(scenes, terrains, figureId, stopId, { bakedManifests: baked, bakedUrls: lists.baked, stillManifests: stills, stillUrls: lists.stills });
}

/**
 * 从几张“路径 → 怎么读”的表里读出一站的沙盘（loadStopTable 用的就是它，那几张表是打包时列出来的，在 contentLists.ts 里）。
 * 单拿出来，是为了不靠磁盘上真有一份缺了地形文件、缺了一张图的沙盘，也测得到这些情形。
 */
export async function pickStopTable(
  scenes: Record<string, () => Promise<StopScene>>,
  terrains: Record<string, () => Promise<string>>,
  figureId: string,
  stopId: string,
  made: MadeFiles = {},
): Promise<StopTableContent | null> {
  const dir = `${ROOT}/${figureId}`;
  const loadScene = scenes[`${dir}/scenes/${stopId}.json`];
  if (!loadScene) return null;
  // 两份清单和场景一起读，不排队
  const [scene, ground, stills] = await Promise.all([loadScene(), pickGround(made, dir, stopId), pickStills(made, dir, stopId)]);
  const loadUrl = terrains[`${dir}/scenes/${scene.terrain.file}`];
  if (!loadUrl) return null;
  const table: StopTableContent = { scene, terrainUrl: await loadUrl() };
  if (ground) table.ground = ground;
  if (stills) table.stills = stills;
  return table;
}

/**
 * 先画好的地面：清单在、它写的两张图都在、两张一样大，才算有。清单读不出来也当作没有（沙盘打开时现画，只是慢两秒）。
 * 这里只管文件在不在；这两张图和手里的场景、地形文件对不对得上，沙盘程序打开时自己再对一遍。
 */
async function pickGround(made: MadeFiles, dir: string, stopId: string): Promise<StopTable['ground']> {
  const load = made.bakedManifests?.[`${dir}/baked/${stopId}.json`];
  if (!load) return undefined;
  try {
    const manifest = await load();
    const colourUrl = made.bakedUrls?.[`${dir}/baked/${manifest.colour.file}`];
    const fieldsUrl = made.bakedUrls?.[`${dir}/baked/${manifest.fields.file}`];
    if (!colourUrl || !fieldsUrl) return undefined;
    if (manifest.colour.width !== manifest.fields.width || manifest.colour.height !== manifest.fields.height) return undefined;
    return { colourUrl, fieldsUrl, width: manifest.colour.width, height: manifest.colour.height, inputs: { ground: manifest.inputs.ground, terrain: manifest.inputs.terrain } };
  } catch (error) {
    console.warn(`[内容] ${dir}/baked/${stopId}.json 没有读出来，地面改成打开时现画`, error);
    return undefined;
  }
}

/**
 * 每一小节的定格图：清单在、它写的每一张图都在，才算有；少一张就当作这座沙盘没有定格图
 *（读到一半才发现没有图，不如一开始就照没有图的办法来）。urls 的键是清单里的文件名。
 */
async function pickStills(made: MadeFiles, dir: string, stopId: string): Promise<StopTable['stills']> {
  const load = made.stillManifests?.[`${dir}/stills/${stopId}.json`];
  if (!load) return undefined;
  try {
    const manifest = await load();
    if (manifest.stills.length === 0) return undefined;
    const urls: Record<string, string> = {};
    for (const still of manifest.stills) {
      const url = made.stillUrls?.[`${dir}/stills/${still.file}`];
      if (!url) return undefined;
      urls[still.file] = url;
    }
    return { manifest, urls };
  } catch (error) {
    console.warn(`[内容] ${dir}/stills/${stopId}.json 没有读出来，这座沙盘当作没有定格图`, error);
    return undefined;
  }
}

/** 一位人物的全程沙盘读出来的样子：RouteTable（src/stage/types.ts）里由内容决定的那几样。 */
export type RouteTableContent = Pick<RouteTable, 'scene' | 'terrainUrl' | 'ground' | 'stills'>;

/**
 * 一位人物的全程沙盘（scenes/route.json，“route”这个名字不许站用）：和一站的沙盘是同一种读法，带的也是同样几样。
 * 这位人物还没有全程沙盘、那个文件写的不是全程沙盘、或者它写的地形文件不在时返回 null。
 */
export async function loadRouteTable(figureId: string): Promise<RouteTableContent | null> {
  const [found, lists] = await Promise.all([loadStopTable(figureId, 'route'), loadLists()]);
  return routeTableOf(found, `${ROOT}/${figureId}/baked/route.json` in lists.bakedManifests);
}

/**
 * 读出来的是不是一座全程沙盘。baked：这座沙盘做过先画好的地面（清单在）。全程沙盘的地面不能打开时现画，
 * 清单在、地面却没带上来（清单那一小段这一次没取到），就算这一次没读成：页面说一句，读者可以再试一次。
 */
export function routeTableOf(found: { scene: TableScene; ground?: unknown } | null, baked: boolean): RouteTableContent | null {
  if (found?.scene.level !== 'route') return null;
  if (baked && !found.ground) throw new Error('baked');
  return found as RouteTableContent;
}

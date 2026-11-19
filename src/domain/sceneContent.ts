// 读取 content/ 目录里的场景数据：一站的沙盘（场景文件和地形文件的网址，加上工具照着它做出来的两样——
// 先画好的地面、每一小节的定格图），人物页的定格图。
// 加一站的沙盘只加内容文件，这里不用改。
//
// 场景文件只用 import.meta.glob<StopScene>(...) 读，不直接 import 那个 JSON
// （直接 import 时坐标会被当成 number[]，对不上 LngLat）；两份清单也是这样读。
// 地形文件、先画好的地面、定格图的网址打包时就知道，但是不带在页面一打开就下载的那一块里
// （一座沙盘十几二十个网址，沙盘越多越长）：它们在 sceneFileUrls.ts 里，这里用动态 import 取，
// 打开人物页或者一站时才下载，和场景文件、清单一起取，不排队。文件本身仍然是用到时才下载。
//
// 工具做的两样可以没有：还没做的沙盘照样摆得出来（地面打开时现画，没有定格图）。清单在、它写的图片却不齐时，
// 这一样就当作没有——宁可不用，也不拿半套去用。它们齐不齐、对不对得上，由 npm run validate 的规则 17、18 管。

import type { StopTable } from '../stage/types';
import type { BakedGroundManifest } from './bakedGround';
import type { StopScene } from './scene';
import type { StillManifest } from './stills';
import type { Figure } from './types';

const ROOT = '/content/figures';

const sceneFiles = import.meta.glob<StopScene>('/content/figures/*/scenes/*.json', { import: 'default' });
const stillManifests = import.meta.glob<StillManifest>('/content/figures/*/stills/*.json', { import: 'default' });
const bakedManifests = import.meta.glob<BakedGroundManifest>('/content/figures/*/baked/*.json', { import: 'default' });

/** 文件的网址那三张表（地形文件、先画好的地面、stills/ 里的图片）。第一次叫它时才下载；没取到的话，下一次叫它再取。 */
const loadFileUrls = () => import('./sceneFileUrls');

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
 * 这一站有没有场景文件。不用等：有哪些场景文件，程序打包的时候就知道了。
 * 页面用它决定沙盘栏一上来放什么：有，才说“沙盘正在摆出来”；没有，直接放定格图。
 */
export function hasStopTable(figureId: string, stopId: string): boolean {
  return `${ROOT}/${figureId}/scenes/${stopId}.json` in sceneFiles;
}

/**
 * 一站的沙盘：场景和地形文件的网址；做过先画好的地面、每一小节的定格图的，一并带上。
 * 这一站还没有场景文件、或者场景写的地形文件不在时返回 null。
 */
export async function loadStopTable(figureId: string, stopId: string): Promise<StopTableContent | null> {
  // 没有场景文件的站，什么也不用取
  if (!hasStopTable(figureId, stopId)) return null;
  const dir = `${ROOT}/${figureId}`;
  // 四样一起去取，不排队：场景，两份清单，网址的那三张表。网址到了，就能照场景和清单挑出这一站要的那几个
  const scenes = started(sceneFiles, `${dir}/scenes/${stopId}.json`);
  const baked = started(bakedManifests, `${dir}/baked/${stopId}.json`);
  const stills = started(stillManifests, `${dir}/stills/${stopId}.json`);
  const urls = await loadFileUrls();
  const terrains = Object.fromEntries(Object.entries(urls.terrain).map(([path, url]) => [path, () => Promise.resolve(url)]));
  return pickStopTable(scenes, terrains, figureId, stopId, { bakedManifests: baked, bakedUrls: urls.baked, stillManifests: stills, stillUrls: urls.stills });
}

/**
 * 从几张“路径 → 怎么读”的表里读出一站的沙盘（loadStopTable 用的就是它，那几张表是打包时列出来的）。
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

/** 人物页的定格图：图片的网址和图旁边的字。figure.json 没有写 routeStill、或图片文件不在时返回 null。 */
export async function loadRouteStill(
  figure: Figure,
): Promise<{ url: string; width: number; height: number; alt: string; caption: string; note: string; credit: string } | null> {
  const still = figure.routeStill;
  if (!still) return null;
  const url = (await loadFileUrls()).stills[`${ROOT}/${figure.id}/stills/${still.file}`];
  if (!url) return null;
  return { url, width: still.width, height: still.height, alt: still.alt, caption: still.caption, note: still.note, credit: still.credit };
}

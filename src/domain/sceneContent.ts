// 读取 content/ 目录里的场景数据：一站的沙盘（场景文件和地形文件的网址，加上工具照着它做出来的两样——
// 先画好的地面、每一小节的定格图），人物页的定格图。
// 加一站的沙盘只加内容文件，这里不用改。
//
// 场景文件只用 import.meta.glob<StopScene>(...) 读，不直接 import 那个 JSON
// （直接 import 时坐标会被当成 number[]，对不上 LngLat）；两份清单也是这样读。
// 地形文件用 ?url 取网址，要用的时候才去下载。图片的网址打包时就知道，直接带在页面的程序里（一个网址几十个字节），
// 图片本身仍然是用到时才下载。
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
const terrainFiles = import.meta.glob<string>('/content/figures/*/scenes/*.terrain.bin', { query: '?url', import: 'default' });
// stills/ 里只取图片（人物页的一张，每一小节的）；每一站的清单另读。
const stillUrls = import.meta.glob<string>('/content/figures/*/stills/*.{jpg,jpeg,png,webp,svg}', { query: '?url', import: 'default', eager: true });
const stillManifests = import.meta.glob<StillManifest>('/content/figures/*/stills/*.json', { import: 'default' });
const bakedUrls = import.meta.glob<string>('/content/figures/*/baked/*.{jpg,png}', { query: '?url', import: 'default', eager: true });
const bakedManifests = import.meta.glob<BakedGroundManifest>('/content/figures/*/baked/*.json', { import: 'default' });

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
export function loadStopTable(figureId: string, stopId: string): Promise<StopTableContent | null> {
  return pickStopTable(sceneFiles, terrainFiles, figureId, stopId, { bakedManifests, bakedUrls, stillManifests, stillUrls });
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
  const url = stillUrls[`${ROOT}/${figure.id}/stills/${still.file}`];
  if (!url) return null;
  return { url, width: still.width, height: still.height, alt: still.alt, caption: still.caption, note: still.note, credit: still.credit };
}

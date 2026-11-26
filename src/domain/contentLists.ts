// 内容的清单：content/ 里每位人物的每个文件。打包时就列好了；文件本身仍然是用到时才下载。
//   前七张是“路径 → 怎么读”：各站的 .json 和正文、图片、场景文件、两种清单（定格图的、先画好的地面的）、行迹的出处；
//   后三张是“路径 → 打包以后的网址”：每座沙盘的地形文件，工具做出来的两样（先画好的地面、每一小节的定格图）。
//
// 这几张表单独放一个模块，是为了不让它们进页面一打开就下载的那一块：一位人物有几十个文件，一个文件一项，
// 人物越多、站越多越长。页面的那一块里只留两张：首页的卡片，每位人物的 figure.json（一位人物一项），都在 content.ts 里。
// 这个模块由 content.ts 的 loadLists 用动态 import 取，页面的程序一开始跑就去要（src/main.tsx），和 index.json、figure.json
// 同时要，不排在谁后面。除了 content.ts，别处不要直接引入它（引了，这些表就回到页面那一块里去了）。
// 这个文件的名字不以 scene 打头：改它不算改了沙盘的程序（定格图的记号不动，见 tests/support/programKey.ts）。

import type { BakedGroundManifest } from './bakedGround';
import type { ItinerarySource } from './itinerary';
import type { StopScene } from './scene';
import type { StillManifest } from './stills';
import type { StopExtras } from './types';

/** 各站的小注、原文、图片、凭据（stops/<站>.json）。 */
export const stopJson = import.meta.glob<StopExtras>('/content/figures/*/stops/*.json', { import: 'default' });
/** 各站的正文（stops/<站>.md）。 */
export const stopBody = import.meta.glob<string>('/content/figures/*/stops/*.md', { query: '?raw', import: 'default' });
/** 正文里的图片：读出来是它的网址。 */
export const images = import.meta.glob<string>('/content/figures/*/images/*', { query: '?url', import: 'default' });
/** 场景文件：各站的沙盘和全程沙盘。 */
export const scenes = import.meta.glob<StopScene>('/content/figures/*/scenes/*.json', { import: 'default' });
/** 每一小节的定格图的清单。 */
export const stillManifests = import.meta.glob<StillManifest>('/content/figures/*/stills/*.json', { import: 'default' });
/** 先画好的地面的清单。 */
export const bakedManifests = import.meta.glob<BakedGroundManifest>('/content/figures/*/baked/*.json', { import: 'default' });
/** 每位人物手写的那一份行迹里的出处（import: 'sources'：别的字段——每一段、考证的话——不进网站）。 */
export const itinerarySources = import.meta.glob<ItinerarySource[]>('/content/figures/*/itinerary.json', { import: 'sources' });

/** 地形文件的网址。 */
export const terrain = import.meta.glob<string>('/content/figures/*/scenes/*.terrain.bin', { query: '?url', import: 'default', eager: true });
/** 先画好的地面的网址：颜色和田的标记两张图。 */
export const baked = import.meta.glob<string>('/content/figures/*/baked/*.{jpg,png}', { query: '?url', import: 'default', eager: true });
/** stills/ 里的图片的网址：每座沙盘每一小节的定格图。 */
export const stills = import.meta.glob<string>('/content/figures/*/stills/*.{jpg,jpeg,png,webp,svg}', { query: '?url', import: 'default', eager: true });

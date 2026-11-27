// 读取 content/ 目录里的内容。加一位人物只加内容文件，这里不用改。
// 页面一打开就下载的那一块里只有两张清单：首页的卡片，每位人物的 figure.json（一位人物一项）。
// 每位人物别的文件列在另一小块里（contentLists.ts），用 loadLists 取。

import { annotate, parseBody } from './body';
import type { ItinerarySource } from './itinerary';
import type { Figure, FigureCard, StopContent } from './types';

const ROOT = '/content/figures';

const cardFiles = import.meta.glob<FigureCard[]>('/content/figures/index.json', { import: 'default' });
const figureFiles = import.meta.glob<Figure>('/content/figures/*/figure.json', { import: 'default' });

/**
 * 内容的清单（每位人物的每个文件怎么读，和沙盘用到的文件的网址）。第一次叫它时才下载；正在取、取到了的，再叫给的是同一份；
 * 没取到的话，下一次叫它再取。页面的程序一开始跑就叫一次（src/main.tsx），读一站、读一座沙盘的时候它多半已经到了。
 */
export const loadLists = () => import('./contentLists').then((lists) => (arrived = lists));

/** 内容的清单到了以后记在这里：有一处要当场知道它到没到、里面有什么（lacksItinerary），不能等。 */
let arrived: typeof import('./contentLists') | undefined;

/**
 * 这位人物没有行迹（content/figures/<人物>/ 里没有 itinerary.json）。当场答，不等、不另取什么：照内容的清单答，
 * 清单还没到（或者还不知道是哪位人物：figureId 是空的）答 false——还不知道的时候，页面照有行迹的办。
 * 沙盘栏照它决定带不带时间轴（src/ui/StagePane.tsx 的 noBar；docs/data-spec.md“谁要有行迹”）。
 */
export const lacksItinerary = (figureId: string): boolean => !!figureId && !!arrived && !(`${ROOT}/${figureId}/itinerary.json` in arrived.itinerarySources);

/** 首页的人物卡片，按时代先后排列。 */
export async function loadFigureCards(): Promise<FigureCard[]> {
  const load = cardFiles[`${ROOT}/index.json`];
  if (!load) return [];
  return [...(await load())].sort((a, b) => a.sortYear - b.sortYear);
}

/** 一位人物；没有这位人物时返回 null。 */
export async function loadFigure(figureId: string): Promise<Figure | null> {
  const load = figureFiles[`${ROOT}/${figureId}/figure.json`];
  return load ? await load() : null;
}

/** 一站的完整内容；这一站还没写（没有正文文件）时返回 null。 */
export async function loadStop(figureId: string, stopId: string): Promise<StopContent | null> {
  const lists = await loadLists();
  const loadJson = lists.stopJson[`${ROOT}/${figureId}/stops/${stopId}.json`];
  const loadBody = lists.stopBody[`${ROOT}/${figureId}/stops/${stopId}.md`];
  if (!loadJson || !loadBody) return null;
  const [extras, body] = await Promise.all([loadJson(), loadBody()]);
  const { sections } = annotate(parseBody(body), extras.notes);

  const imageUrls: Record<string, string> = {};
  await Promise.all(
    extras.images.map(async (image) => {
      const loadUrl = lists.images[`${ROOT}/${figureId}/images/${image.file}`];
      if (loadUrl) imageUrls[image.file] = await loadUrl();
    }),
  );
  return { ...extras, sections, imageUrls };
}

/** 这位人物的行迹的出处（手写的那一份行迹里的 sources，照文件里的先后）；这位人物没有行迹时是空的。 */
export async function loadItinerarySources(figureId: string): Promise<ItinerarySource[]> {
  const load = (await loadLists()).itinerarySources[`${ROOT}/${figureId}/itinerary.json`];
  return load ? await load() : [];
}

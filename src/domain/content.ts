// 读取 content/ 目录里的内容。加一位人物只加内容文件，这里不用改。

import { annotate, parseBody } from './body';
import type { Figure, FigureCard, StopContent, StopExtras } from './types';

const ROOT = '/content/figures';

const cardFiles = import.meta.glob<FigureCard[]>('/content/figures/index.json', { import: 'default' });
const figureFiles = import.meta.glob<Figure>('/content/figures/*/figure.json', { import: 'default' });
const stopJsonFiles = import.meta.glob<StopExtras>('/content/figures/*/stops/*.json', { import: 'default' });
const stopBodyFiles = import.meta.glob<string>('/content/figures/*/stops/*.md', { query: '?raw', import: 'default' });
const imageFiles = import.meta.glob<string>('/content/figures/*/images/*', { query: '?url', import: 'default' });

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
  const loadJson = stopJsonFiles[`${ROOT}/${figureId}/stops/${stopId}.json`];
  const loadBody = stopBodyFiles[`${ROOT}/${figureId}/stops/${stopId}.md`];
  if (!loadJson || !loadBody) return null;
  const [extras, body] = await Promise.all([loadJson(), loadBody()]);
  const { sections } = annotate(parseBody(body), extras.notes);

  const imageUrls: Record<string, string> = {};
  await Promise.all(
    extras.images.map(async (image) => {
      const loadUrl = imageFiles[`${ROOT}/${figureId}/images/${image.file}`];
      if (loadUrl) imageUrls[image.file] = await loadUrl();
    }),
  );
  return { ...extras, sections, imageUrls };
}

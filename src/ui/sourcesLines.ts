// “来源”页上从内容里来的两栏是怎么收齐的：地形和水（一位人物一段），每一张图片和它是哪一站的。
// 这个文件不用 React，也不印字：页面（SourcesBody.tsx）用它，做字体的工具也用它问“那一页印些什么”（tests/support/fontTool.ts）——
// 两头问的是同一个函数（collectSources），那一页印的字和工具数到的字就不会对不上。
// 它跟着“来源”页的那一块程序走，读者打开那一页才下载；页面一打开就下载的程序不要引它。

import { loadFigure, loadFigureCards, loadRouteTable, loadStop, loadStopTable } from '../domain';
import type { StopImage } from '../domain';

/**
 * 从内容里读出来的两栏：地形和水——一位人物一段（他的 id、卡片上的名字、他的沙盘的每一行，一段里不重复）；
 * 每一张图片和它是哪一站的（那一站的短名字）。
 */
export interface FromContent {
  tables: { figureId: string; name: string; lines: string[] }[];
  pictures: { stop: string; picture: StopImage }[];
}

/** 收那两栏要的东西，一位可以点进去的人物一份（照首页卡片的先后给）。 */
export interface SourcesFigure {
  figureId: string;
  /** 卡片上他的名字。 */
  name: string;
  /** 他的全程沙盘的 credits；没有全程沙盘是 null。 */
  route: string[] | null;
  /** 他的每一站，照先后：短名字；这一站自己的沙盘的 credits（没有沙盘是 null）；写好了的正文里的图片（正文还没写是 null）。 */
  stops: { name: string; table: string[] | null; pictures: StopImage[] | null }[];
}

/**
 * 说过的话只留头一回，先后不变。算“说过”的有两种：
 * 一模一样的一行（两座沙盘用的是同一份数据的时候，它们的出处是同一句话）；
 * 分号前面的半句，前面留下的哪一行就是这样开头的——同一份数据，全程的图片署过一遍，沙盘的凭据里又署一遍，
 * 后面带的半句是说给凭据里的读者听的（“裁剪和修整见上面的说明”），在这一页上“上面”没有那段说明。
 * 所以内容里一行出处要署的名都写在头一个分号前面；分号后面只写补充的话。
 * 给的是一位人物的那几行：说没说过只在他自己的一段里算。
 */
export function uniqueLines(lines: string[]): string[] {
  const kept: string[] = [];
  for (const line of lines) {
    const head = line.split('；')[0];
    if (!kept.some((seen) => seen.startsWith(head))) kept.push(line);
  }
  return kept;
}

/** 照给的几位人物收齐那两栏。只是排和挑，不读文件：页面把读出来的交给它，做字体的工具把它数到的交给它。 */
export function collectSources(figures: SourcesFigure[]): FromContent {
  const tables: FromContent['tables'] = [];
  const pictures: FromContent['pictures'] = [];
  for (const figure of figures) {
    // 这位人物的一段。全程沙盘的出处排在最前面，只印头一个分号前面署名的半句：后半句（“裁剪和修整见上面的说明”）是说给凭据里的读者听的
    const lines: string[] = [];
    for (const line of figure.route ?? []) lines.push(line.includes('；') ? `${line.split('；')[0]}。` : line);
    for (const stop of figure.stops) {
      if (stop.table) lines.push(...stop.table);
      if (stop.pictures) pictures.push(...stop.pictures.map((picture) => ({ stop: stop.name, picture })));
    }
    // 一座沙盘也没有的人物没有他的一段；只有一位人物的时候也是这样的一段，不另作一种样子
    if (lines.length > 0) tables.push({ figureId: figure.figureId, name: figure.name, lines: uniqueLines(lines) });
  }
  return { tables, pictures };
}

/** 把每位可以点进去的人物、他的每一站和每一座沙盘读一遍，收齐那两栏。 */
export async function loadFromContent(): Promise<FromContent> {
  const figures: SourcesFigure[] = [];
  for (const card of await loadFigureCards()) {
    const figure = card.available ? await loadFigure(card.id) : null;
    if (!figure) continue;
    const route = (await loadRouteTable(figure.id))?.scene.credits ?? null;
    const stops = await Promise.all(
      figure.stops.map((stop) => Promise.all([loadStopTable(figure.id, stop.id), stop.status === 'complete' ? loadStop(figure.id, stop.id) : null, stop.shortTitle] as const)),
    );
    figures.push({ figureId: figure.id, name: card.name, route, stops: stops.map(([table, content, name]) => ({ name, table: table?.scene.credits ?? null, pictures: content?.images ?? null })) });
  }
  return collectSources(figures);
}

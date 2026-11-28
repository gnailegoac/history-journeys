// 内容校验规则：docs/data-spec.md 的那几条，加上“格式”（文件读得出来、字段齐全、id 对得上）。
// 规则 1 到 9 和总的入口在这里；“格式”怎么查在 shape.ts；场景数据的规则 10 到 18 和规则 21（夜）在 sceneRules.ts；
// 全程沙盘的场景文件（写着 "level": "route" 的）走 routeRules.ts，规则的号码和站点沙盘一样，另有规则 20；
// 规则 22（行迹：itinerary.json 和工具照它做的那一份）在 itineraryRules.ts；大小的上限在 budgetRules.ts。
// 全是纯函数：输入是读进内存的内容文件，输出是不合规格的地方。不读磁盘，也不依赖测试框架。

import { annotate, BodyFormatError, bodyLength, parseBody } from '../../src/domain/body';
import type { RawSection } from '../../src/domain/body';
import { ROUTE_SCENE_ID } from '../../src/domain/scene';
import type { RouteScene, StopScene, TableScene } from '../../src/domain/scene';
import type { Figure, FigureCard, StopExtras, StopMeta } from '../../src/domain/types';
import { PRESSED_SUFFIX, scopeFileNames, scopeNameOwners } from '../support/fontNames';
import { MADE_FILES_PENDING } from '../support/pendingTables';
import { validateItinerary } from './itineraryRules';
import { checkRouteScene, checkRouteShape, checkStopPlaces, isRouteLevel } from './routeRules';
import { checkBakedGround, checkScene, checkSceneShape, checkSectionStills, MADE_FILES_REQUIRED } from './sceneRules';
import type { FileKeys, Measured, MeasuredPictures, SceneStop } from './sceneRules';
import { anything, bool, checkShape, has, list, lngLatProblem, number, object, oneOf, optional, readJson, text, violation } from './shape';
import type { ContentFiles, FileSizes, PictureSizes, Violation } from './shape';

export { lngLatProblem };
export type { ContentFiles, FileKeys, FileSizes, MeasuredPictures, PictureSizes, Violation };

export const RULE_NAMES = [
  '格式',
  '坐标',
  '站点与轨迹',
  '文件齐全',
  '正文',
  '小注',
  '原文',
  '图片',
  '凭据',
  '没有占位',
  '场景文件',
  '范围',
  '类别和依据',
  '零件',
  '小节',
  '题签',
  '全程沙盘',
  '先画好的地面',
  '每一小节的定格图',
  '随站的字体',
  '站的位置',
  '夜',
  '行迹',
] as const;

/**
 * 号码在上面那张表里、却不归内容校验查的规则：规则 19（随站的字体）由 npm test 里的 tests/fonts/font-files.test.ts 查。
 * npm run validate 逐条报告的时候跳过它们。
 */
export const RULES_CHECKED_ELSEWHERE: readonly number[] = [19];

/** 正文字数的上下限（规则 4）。 */
export const BODY_MIN = 800;
export const BODY_MAX = 1400;

const NOTE_KINDS = ['history', 'geography', 'humanities', 'science'];
const SOURCE_BASES = ['own-words', 'record', 'later'];
const ITEM_BASES = [...SOURCE_BASES, 'editor'];

/** 把一处问题写成一句话：哪条规则、哪个文件、哪个字段、哪里不对。 */
export function formatViolation(v: Violation): string {
  const rule = v.rule === 0 ? RULE_NAMES[0] : `规则 ${v.rule} ${RULE_NAMES[v.rule]}`;
  const where = v.field === '' ? `content/${v.file}` : `content/${v.file} › ${v.field}`;
  return `【${rule}】${where}：${v.problem}`;
}

/** 把全部问题写成一份清单。 */
export function formatReport(violations: Violation[]): string {
  if (violations.length === 0) return '内容校验通过。';
  const lines = violations.map((v, i) => `${i + 1}. ${formatViolation(v)}`);
  const note = violations.some((v) => v.rule === 0) ? ['（格式有问题的文件，其余规则要等格式改好以后才检查。）'] : [];
  return [`内容校验没有通过，共 ${violations.length} 处：`, ...lines, ...note].join('\n');
}

/**
 * 校验整个内容目录：首页卡片，以及每位人物、他的每一站和每一站的沙盘。
 * sizes 是二进制文件（地形文件、先画好的地面、定格图）的大小，pictures 是图片各有多宽多高、是哪一种图片，
 * keys 是工具做出来的图片各自的记号，都由调用的人从磁盘量好给进来；没有给的文件不查。
 * madeFilesRequired：是不是每座沙盘都必须有先画好的地面和每一小节的定格图（规则 17、18 的第一句）；
 * 不写就照 sceneRules.ts 的开关 MADE_FILES_REQUIRED。
 * pending：这两样还没有做出来、暂时不要求有的沙盘（“人物/场景文件的名字”）；不写就照 tests/support/pendingTables.ts 的那张表。
 */
export function validateContent(
  files: ContentFiles,
  sizes: FileSizes = {},
  pictures: MeasuredPictures = {},
  keys: FileKeys = {},
  madeFilesRequired: boolean = MADE_FILES_REQUIRED,
  pending: readonly string[] = MADE_FILES_PENDING,
): Violation[] {
  const figureIds = new Set<string>();
  for (const path of Object.keys(files)) {
    const match = /^figures\/([^/]+)\//.exec(path);
    if (match) figureIds.add(match[1]);
  }
  return [...checkIndex(files), ...[...figureIds].sort().flatMap((id) => validateFigure(files, id, sizes, pictures, keys, madeFilesRequired, pending)), ...checkFontFileNames(files, [...figureIds].sort())];
}

/**
 * 规则 0 里跨人物的一条：随站的字体按范围分文件的时候（做法见 docs/data-spec.md“随站的字体”，名字怎么拼在 tests/support/fontNames.ts），
 * 文件是照人物和站的 id 起名的——yanlu-song-<人物>、yanlu-song-<人物>-<站>，点开才要的再接 -more。两个 id 拼出同一个名字，
 * 后一个文件就把前一个盖掉了：人物 su 的一站 shi，和人物 su-shi，是同一个名字。照每位人物的 figure.json 里的 id 查，不看哪一站现在有没有正文。
 * 已经另有一句话说的不在这里再说：叫 sources 的人物（RESERVED_FIGURE_IDS），叫 more 的站（RESERVED_STOP_IDS），同一位人物里两站同名（规则 2）。
 * figure.json 读不出来、格式不对的人物不查（它的毛病另报）。撞上了的每个名字一处，记在后来的那一位人物的 figure.json 上。
 */
export function checkFontFileNames(files: ContentFiles, figureIds: readonly string[]): Violation[] {
  /** 每位人物：他的 id；各站的 id 照 figure.json 里的先后（written）；拿去拼名字的（stops：重了的只算一回，叫 more 的不算）。 */
  const figures: { id: string; written: string[]; stops: string[] }[] = [];
  for (const id of figureIds) {
    if (RESERVED_FIGURE_IDS.includes(id)) continue;
    const file = `figures/${id}/figure.json`;
    if (!has(files, file)) continue;
    const read = readJson(files, file);
    if (read.data === undefined || checkShape(read.data, FIGURE, file).length > 0) continue;
    const written = (read.data as Figure).stops.map((stop) => stop.id);
    figures.push({ id, written, stops: [...new Set(written)].filter((stop) => !RESERVED_STOP_IDS.includes(stop)) });
  }
  const names = scopeFileNames(figures);
  return scopeNameOwners(names).map(({ name, owners }) => {
    // 记在后来的那一位身上：是一站就指着那一站的 id，是人物就指着他的 id
    const last = [...names].reverse().find((item) => item.name === name && item.figure !== null);
    const figure = figures.find((item) => item.id === last?.figure);
    const field = last?.stop && figure ? `stops[${figure.written.indexOf(last.stop)}].id` : 'id';
    return violation(0, `figures/${figure?.id ?? figureIds[0]}/figure.json`, field, `人物和站的 id 拼出了同一个字体文件的名字：${name}.woff2 会被写两回（${owners.join('，和')}）。换掉其中一个 id`);
  });
}

// ---------------------------------------------------------------- 首页卡片

/**
 * 不能拿来做人物的 id 的词：页面的地址里它们另有用处。#/sources 是“来源”页（src/app/router.ts），
 * 叫这个 id 的人物，他的人物页就打不开了。tests/unit/route.test.ts 对着页面读地址的程序把这张表核了一遍。
 */
export const RESERVED_FIGURE_IDS: readonly string[] = ['sources'];
/**
 * 不能拿来做一站的 id 的词：随站的字体按范围分文件的时候，点开才要的文件名字末尾接的是 more（tests/support/fontNames.ts 的 PRESSED_SUFFIX）；
 * 叫这个 id 的一站，它不用点开就要的那个文件就和人物点开才要的那个同名了。
 */
export const RESERVED_STOP_IDS: readonly string[] = [PRESSED_SUFFIX];

export function checkIndex(files: ContentFiles): Violation[] {
  const file = 'figures/index.json';
  const read = readJson(files, file);
  if (read.data === undefined) return read.violations;
  const shape = checkShape(read.data, list(CARD), file);
  if (shape.length > 0) return shape;
  const cards = read.data as FigureCard[];

  const out = duplicateIds(cards, file, '');
  cards.forEach((card, i) => {
    if (RESERVED_FIGURE_IDS.includes(card.id)) {
      out.push(violation(0, file, `[${i}].id`, `“${card.id}”不能做人物的 id：地址 #/${card.id} 是网站自己的一页（“来源”页），换一个`));
    }
    if (card.available && !has(files, `figures/${card.id}/figure.json`)) {
      out.push(violation(0, file, `[${i}].available`, `“${card.name}”标了可以点进去，但没有 figures/${card.id}/figure.json`));
    } else if (card.available && !has(files, `figures/${card.id}/scenes/${ROUTE_SCENE_ID}.json`)) {
      // 规则 16：可以点进去的人物要有全程沙盘（人物页上摆的就是它）
      out.push(violation(16, file, `[${i}].available`, `“${card.name}”标了可以点进去，但没有全程沙盘的场景文件 figures/${card.id}/scenes/${ROUTE_SCENE_ID}.json`));
    }
    out.push(...checkCardOutline(files, card, file, i));
  });
  out.push(...findPlaceholders(cards, file, ''));
  return out;
}

/**
 * 卡片上的 outline（“这位人物的各站都还没写”）要和人物自己的 figure.json 说的一样：figure.json 里每一站都是 outline，卡片写 true；
 * 有一站写好了（complete），卡片不写。首页照它决定可以点进去的卡片最后一行写哪一句，写错了读者会被领到一位“从第一站读起”却没有一站可读的人物那里。
 * 没有 figure.json 的人物（卡片先放着的）不许写它：没有东西可以对。figure.json 自己的格式有问题时这里不查（它的毛病另报）。
 */
function checkCardOutline(files: ContentFiles, card: FigureCard, file: string, i: number): Violation[] {
  const figureFile = `figures/${card.id}/figure.json`;
  if (!has(files, figureFile)) {
    return card.outline === undefined ? [] : [violation(0, file, `[${i}].outline`, `“${card.name}”写了 outline，但没有 ${figureFile}：这一项要照人物的文件查，没有文件就不写`)];
  }
  const read = readJson(files, figureFile);
  if (read.data === undefined || checkShape(read.data, FIGURE, figureFile).length > 0) return [];
  const stops = (read.data as Figure).stops;
  const allOutline = stops.length > 0 && stops.every((stop) => stop.status === 'outline');
  if (allOutline && card.outline !== true) {
    return [violation(0, file, `[${i}].outline`, `“${card.name}”的各站都还没写（${figureFile} 里每一站都是 outline），卡片要写 "outline": true`)];
  }
  if (!allOutline && card.outline !== undefined) {
    const written = stops.filter((stop) => stop.status === 'complete').map((stop) => stop.id);
    return [violation(0, file, `[${i}].outline`, `“${card.name}”有写好了的站（${written.join('、') || '一站也没有'}），卡片不写 outline`)];
  }
  return [];
}

// ---------------------------------------------------------------- 一位人物

export function validateFigure(
  files: ContentFiles,
  figureId: string,
  sizes: FileSizes = {},
  pictures: MeasuredPictures = {},
  keys: FileKeys = {},
  madeFilesRequired: boolean = MADE_FILES_REQUIRED,
  pending: readonly string[] = MADE_FILES_PENDING,
): Violation[] {
  const dir = `figures/${figureId}`;
  const file = `${dir}/figure.json`;
  const read = readJson(files, file);
  if (read.data === undefined) return read.violations;
  const shape = checkShape(read.data, FIGURE, file);
  if (shape.length > 0) return shape;
  const figure = read.data as Figure;

  const out: Violation[] = [];
  if (figure.id !== figureId) out.push(violation(0, file, 'id', `应该和文件夹的名字一样（${figureId}），现在是“${figure.id}”`));
  if (RESERVED_FIGURE_IDS.includes(figureId)) {
    out.push(violation(0, file, 'id', `“${figureId}”不能做人物的 id（文件夹也不能叫这个名字）：地址 #/${figureId} 是网站自己的一页（“来源”页），换一个`));
  }
  figure.stops.forEach((stop, i) => out.push(...duplicateIds(stop.localPlaces ?? [], file, `stops[${i}].localPlaces`)));
  figure.stops.forEach((stop, i) => {
    if (RESERVED_STOP_IDS.includes(stop.id)) {
      out.push(violation(0, file, `stops[${i}].id`, `“${stop.id}”不能做一站的 id：随站的字体按范围分文件的时候，点开才要的文件名字末尾接的就是这个词，这一站的文件会和人物自己的那个重名，换一个`));
    }
  });
  out.push(...checkCoordinates(figure, file));
  out.push(...checkRoute(figure, file));
  out.push(...checkStopFiles(figure, files, dir));
  out.push(...checkFigurePlaceholders(figure, file));
  for (const stop of figure.stops) {
    if (stop.status === 'complete') out.push(...validateStop(files, dir, stop));
  }
  out.push(...validateScenes(files, sizes, dir, figure, { sizes, pictures, keys }, madeFilesRequired, pending));
  // 规则 22：这位人物有行迹的话（没有全程沙盘的不许有）
  out.push(...validateItinerary(files, dir, figure));
  return out;
}

/**
 * 一位人物 scenes/ 里的每个场景文件：格式，规则 10 到 15，规则 9 在场景文件里的部分，
 * 再加上工具照着它做出来的两样（规则 17 先画好的地面，规则 18 每一小节的定格图）。
 * 写着 "level": "route" 的是全程沙盘，格式和规则 10 到 15 走 routeRules.ts 的那一套，另查规则 20（站的位置）；
 * 别的都当站点沙盘查。
 * 格式有问题的文件，其余规则先不查。规则 10 到 15 有问题的场景文件，规则 17、18 先不查：
 * 那两样是照着一份合格的场景做的，场景自己还不对的时候去对它们，同一处毛病会报成好几处。
 * measured 是从磁盘量好的三样（见 Measured）；madeFilesRequired、pending 见 validateContent：
 * pending 里的沙盘不要求有那两样，已经有的照规则查。
 */
export function validateScenes(
  files: ContentFiles,
  sizes: FileSizes,
  dir: string,
  figure: Figure,
  measured: Measured = { sizes },
  madeFilesRequired: boolean = MADE_FILES_REQUIRED,
  pending: readonly string[] = MADE_FILES_PENDING,
): Violation[] {
  const out: Violation[] = [];
  const figureId = dir.slice(dir.lastIndexOf('/') + 1);
  for (const file of Object.keys(files).sort()) {
    if (!file.startsWith(`${dir}/scenes/`)) continue;
    const match = /^([^/]+)\.json$/.exec(file.slice(`${dir}/scenes/`.length));
    if (!match) continue;
    const read = readJson(files, file);
    if (read.data === undefined) {
      out.push(...read.violations);
      continue;
    }
    let scene: TableScene;
    let found: Violation[];
    if (isRouteLevel(read.data)) {
      const shape = checkRouteShape(read.data, file);
      if (shape.length > 0) {
        out.push(...shape);
        continue;
      }
      const route = read.data as RouteScene;
      scene = route;
      found = checkRouteScene(route, file, { stops: figure.stops.map((stop) => stop.id) }, files, sizes);
      out.push(...found, ...findPlaceholders(route, file, ''), ...checkStopPlaces(figure, `${dir}/figure.json`, route));
    } else {
      const shape = checkSceneShape(read.data, file);
      if (shape.length > 0) {
        out.push(...shape);
        continue;
      }
      const stop = read.data as StopScene;
      scene = stop;
      found = checkScene(stop, file, sceneStop(files, dir, figure, match[1]), files, sizes);
      out.push(...found);
      out.push(...findPlaceholders(stop, file, ''));
    }
    if (found.length > 0) continue;
    const required = madeFilesRequired && !pending.includes(`${figureId}/${match[1]}`);
    out.push(...checkBakedGround(scene, dir, files, measured, required));
    out.push(...checkSectionStills(scene, dir, files, measured, required));
  }
  return out;
}

/** 场景文件对着的那一站：在 figure.json 里标的状态，正文的小节标题，出处的 id。读不出来的给 null，不在这里报。 */
function sceneStop(files: ContentFiles, dir: string, figure: Figure, stopId: string): SceneStop {
  const mdFile = `${dir}/stops/${stopId}.md`;
  const jsonFile = `${dir}/stops/${stopId}.json`;
  const headings = has(files, mdFile) ? (checkBody(files[mdFile], mdFile).sections?.map((section) => section.heading) ?? null) : null;
  let sourceIds: string[] | null = null;
  const extras = has(files, jsonFile) ? readJson(files, jsonFile).data : undefined;
  if (extras !== undefined && checkShape(extras, EXTRAS, jsonFile).length === 0) sourceIds = (extras as StopExtras).sources.map((source) => source.id);
  return { id: stopId, status: figure.stops.find((stop) => stop.id === stopId)?.status, headings, sourceIds };
}

/**
 * 规则 1 坐标：[经度, 纬度]，经度在 −180 到 180 之间，纬度在 −90 到 90 之间。
 * 停用的那几个字段（overview、localPlaces、legs）可以不写；写了的，里面的坐标照旧查。
 */
export function checkCoordinates(figure: Figure, file: string): Violation[] {
  const out: Violation[] = [];
  const check = (value: unknown, field: string) => {
    const problem = lngLatProblem(value);
    if (problem) out.push(violation(1, file, field, problem));
  };
  if (figure.overview) check(figure.overview.center, 'overview.center');
  figure.stops.forEach((stop, i) => {
    check(stop.place.lngLat, `stops[${i}].place.lngLat`);
    (stop.localPlaces ?? []).forEach((place, j) => check(place.lngLat, `stops[${i}].localPlaces[${j}].lngLat`));
  });
  (figure.legs ?? []).forEach((leg, i) => leg.via.forEach((point, j) => check(point.lngLat, `legs[${i}].via[${j}].lngLat`)));
  return out;
}

/**
 * 规则 2 站点与轨迹：站的 id 不重复，也不能叫 route（scenes/route.json、baked/route.*、stills/route-* 是全程沙盘的文件）；
 * 写了 legs 的（停用的字段，可以不写），legs 比 stops 少一个，并且依次首尾相连。
 */
export function checkRoute(figure: Figure, file: string): Violation[] {
  const out: Violation[] = [];
  const { stops } = figure;
  stops.forEach((stop, i) => {
    const first = stops.findIndex((s) => s.id === stop.id);
    if (first < i) out.push(violation(2, file, `stops[${i}].id`, `站的 id“${stop.id}”和第 ${first + 1} 站重复了`));
    if (stop.id === ROUTE_SCENE_ID) {
      out.push(violation(2, file, `stops[${i}].id`, `“${ROUTE_SCENE_ID}”不能做站的 id：scenes/${ROUTE_SCENE_ID}.json 是全程沙盘的场景文件，先画好的地面和定格图也用这个名字；换一个`));
    }
  });
  // 没有写 legs 的人物：后半句没有可查的
  const legs = figure.legs;
  if (legs === undefined) return out;
  const expected = Math.max(0, stops.length - 1);
  if (legs.length !== expected) {
    out.push(violation(2, file, 'legs', `有 ${stops.length} 站，应该有 ${expected} 段路，现在是 ${legs.length} 段`));
  }
  legs.slice(0, expected).forEach((leg, i) => {
    if (leg.from !== stops[i].id) {
      out.push(violation(2, file, `legs[${i}].from`, `第 ${i + 1} 段路应该从第 ${i + 1} 站“${stops[i].id}”出发，现在是“${leg.from}”`));
    }
    if (leg.to !== stops[i + 1].id) {
      out.push(violation(2, file, `legs[${i}].to`, `第 ${i + 1} 段路应该到第 ${i + 2} 站“${stops[i + 1].id}”，现在是“${leg.to}”`));
    }
  });
  return out;
}

/**
 * 规则 3 文件齐全：complete 的站同时有 .md 和 .json；outline 的站两个都没有。
 * 写了 "table": true 的站有 scenes/<站>.json；有 scenes/<站>.json 的站写了 "table": true（两头都查：
 * 页面照 figure.json 里的这个字段决定沙盘栏先摆什么，不去看有哪些文件）。对不上任何一站的场景文件由规则 10 报。
 */
export function checkStopFiles(figure: Figure, files: ContentFiles, dir: string): Violation[] {
  const out: Violation[] = [];
  figure.stops.forEach((stop, i) => {
    const scene = `${dir}/scenes/${stop.id}.json`;
    const says = stop.table === true;
    if (says && !has(files, scene)) {
      out.push(violation(3, `${dir}/figure.json`, `stops[${i}].table`, `“${stop.shortTitle}”这一站写了有自己的沙盘（"table": true），但没有场景文件 scenes/${stop.id}.json；沙盘还没做就不写这个字段`));
    }
    if (!says && has(files, scene)) {
      out.push(violation(3, `${dir}/figure.json`, `stops[${i}].table`, `“${stop.shortTitle}”这一站有场景文件 scenes/${stop.id}.json，这里要写上 "table": true：页面照这个字段决定沙盘栏先摆这一站自己的沙盘`));
    }
  });
  for (const stop of figure.stops) {
    for (const ext of ['md', 'json']) {
      const path = `${dir}/stops/${stop.id}.${ext}`;
      if (stop.status === 'complete' && !has(files, path)) {
        out.push(violation(3, path, '', `没有这个文件；“${stop.shortTitle}”这一站在 figure.json 里标的是 complete，.md 和 .json 都要有`));
      }
      if (stop.status === 'outline' && has(files, path)) {
        out.push(violation(3, path, '', `“${stop.shortTitle}”这一站在 figure.json 里标的还是 outline，不该有这个文件；写好了就把 status 改成 complete`));
      }
    }
  }
  const stopIds = new Set(figure.stops.map((s) => s.id));
  for (const path of Object.keys(files).sort()) {
    if (!path.startsWith(`${dir}/stops/`)) continue;
    const match = /^(.+)\.(md|json)$/.exec(path.slice(`${dir}/stops/`.length));
    if (match && !stopIds.has(match[1])) {
      out.push(violation(3, path, '', `figure.json 里没有 id 是“${match[1]}”的站，这个文件对不上任何一站`));
    }
  }
  return out;
}

/** 规则 9 在人物资料里的部分：人物自己的资料和 complete 的站的抬头。outline 的站不查。 */
export function checkFigurePlaceholders(figure: Figure, file: string): Violation[] {
  const { stops, ...rest } = figure;
  const out = findPlaceholders(rest, file, '');
  stops.forEach((stop, i) => {
    if (stop.status === 'complete') out.push(...findPlaceholders(stop, file, `stops[${i}]`));
  });
  return out;
}

// ---------------------------------------------------------------- 一站

/** 一个 complete 的站：正文、.json，以及两者对不对得上。 */
export function validateStop(files: ContentFiles, dir: string, stop: StopMeta): Violation[] {
  const out: Violation[] = [];
  const mdFile = `${dir}/stops/${stop.id}.md`;
  const jsonFile = `${dir}/stops/${stop.id}.json`;

  let body: RawSection[] | null = null;
  if (has(files, mdFile)) {
    const checked = checkBody(files[mdFile], mdFile);
    out.push(...checked.violations);
    body = checked.sections;
    out.push(...findBodyPlaceholders(files[mdFile], mdFile));
  }

  if (!has(files, jsonFile)) return out;
  const read = readJson(files, jsonFile);
  if (read.data === undefined) return [...out, ...read.violations];
  const shape = checkShape(read.data, EXTRAS, jsonFile);
  if (shape.length > 0) return [...out, ...shape];
  const extras = read.data as StopExtras;

  if (extras.stopId !== stop.id) out.push(violation(0, jsonFile, 'stopId', `应该和文件名一样（${stop.id}），现在是“${extras.stopId}”`));
  for (const key of ['notes', 'originals', 'images', 'sources'] as const) out.push(...duplicateIds(extras[key], jsonFile, key));
  if (body) {
    out.push(...checkNotes(extras, body, jsonFile));
    out.push(...checkOriginals(extras, body, jsonFile));
    out.push(...checkImages(extras, body, jsonFile, (name) => has(files, `${dir}/images/${name}`)));
    out.push(...checkProvenance(extras, body, jsonFile));
  }
  out.push(...findPlaceholders(extras, jsonFile, ''));
  return out;
}

/** 规则 4 正文：800 到 1400 字，每个小节至少有一段。正文写法不对时 sections 为 null。 */
export function checkBody(markdown: string, file: string): { sections: RawSection[] | null; violations: Violation[] } {
  let sections: RawSection[];
  try {
    sections = parseBody(markdown);
  } catch (error) {
    if (!(error instanceof BodyFormatError)) throw error;
    return { sections: null, violations: [violation(4, file, '', error.message)] };
  }
  const out: Violation[] = [];
  const length = bodyLength(sections);
  if (length < BODY_MIN || length > BODY_MAX) {
    out.push(violation(4, file, '', `正文有 ${length} 字（不算小节标题），应在 ${BODY_MIN} 到 ${BODY_MAX} 字之间`));
  }
  sections.forEach((section, i) => {
    if (!section.blocks.some((b) => b.type === 'paragraph')) {
      out.push(violation(4, file, `小节“${section.heading}”`, '这个小节没有段落，至少要有一段'));
    }
    if (sections.findIndex((s) => s.heading === section.heading) < i) {
      out.push(violation(4, file, `小节“${section.heading}”`, '这个小节标题出现了不止一次；原文、图片和凭据靠标题对应小节，标题不能重复'));
    }
  });
  return { sections, violations: out };
}

/** 规则 5 小注：anchor 在正文的段落里原样出现；kind 是四类之一；sourceIds 至少一个，并且都在 sources 里。 */
export function checkNotes(extras: StopExtras, body: RawSection[], file: string): Violation[] {
  const out: Violation[] = [];
  const paragraphs = body.flatMap((s) => s.blocks).flatMap((b) => (b.type === 'paragraph' ? [b.text] : []));
  const unplaced = new Set(annotate(body, extras.notes).missing);
  const sourceIds = new Set(extras.sources.map((s) => s.id));
  extras.notes.forEach((note, i) => {
    const at = `notes[${i}]`;
    if (!NOTE_KINDS.includes(note.kind)) {
      out.push(violation(5, file, `${at}.kind`, `小注“${note.id}”的类别是“${note.kind}”，只能是 history（历史）、geography（地理）、humanities（人文）、science（科学）之一`));
    }
    if (note.anchor === '') {
      out.push(violation(5, file, `${at}.anchor`, `小注“${note.id}”没有填原词`));
    } else if (!paragraphs.some((p) => p.includes(note.anchor))) {
      out.push(violation(5, file, `${at}.anchor`, `小注“${note.id}”的原词“${note.anchor}”在正文的段落里找不到（要一字不差；小节标题和引用行不算）`));
    } else if (unplaced.has(note.id)) {
      out.push(violation(5, file, `${at}.anchor`, `小注“${note.id}”的原词“${note.anchor}”在正文里出现的地方都被别的小注的原词占了，标不出来`));
    }
    if (note.sourceIds.length === 0) out.push(violation(5, file, `${at}.sourceIds`, `小注“${note.id}”至少要填一个出处`));
    note.sourceIds.forEach((id, j) => {
      if (!sourceIds.has(id)) out.push(violation(5, file, `${at}.sourceIds[${j}]`, `小注“${note.id}”的出处“${id}”在 sources 里找不到`));
    });
  });
  return out;
}

/** 规则 6 原文：section 是正文里的小节标题；sourceId 在 sources 里；原文和白话都不为空。 */
export function checkOriginals(extras: StopExtras, body: RawSection[], file: string): Violation[] {
  const out: Violation[] = [];
  const headings = new Set(body.map((s) => s.heading));
  const sourceIds = new Set(extras.sources.map((s) => s.id));
  extras.originals.forEach((original, i) => {
    const at = `originals[${i}]`;
    if (!headings.has(original.section)) out.push(violation(6, file, `${at}.section`, `原文“${original.id}”要放在小节“${original.section}”后面，但正文里没有这个小节标题`));
    if (!sourceIds.has(original.sourceId)) out.push(violation(6, file, `${at}.sourceId`, `原文“${original.id}”的出处“${original.sourceId}”在 sources 里找不到`));
    if (original.text.trim() === '') out.push(violation(6, file, `${at}.text`, `原文“${original.id}”的原文是空的`));
    if (original.plain.trim() === '') out.push(violation(6, file, `${at}.plain`, `原文“${original.id}”的白话是空的`));
  });
  return out;
}

/** 规则 7 图片：文件存在；section 是正文里的小节标题；alt、caption、credit、license、sourceUrl 都填写。 */
export function checkImages(extras: StopExtras, body: RawSection[], file: string, imageExists: (name: string) => boolean): Violation[] {
  const out: Violation[] = [];
  const headings = new Set(body.map((s) => s.heading));
  extras.images.forEach((image, i) => {
    const at = `images[${i}]`;
    if (image.file.trim() === '') out.push(violation(7, file, `${at}.file`, `图片“${image.id}”没有填文件名`));
    else if (!imageExists(image.file)) out.push(violation(7, file, `${at}.file`, `图片“${image.id}”的文件 images/${image.file} 不存在`));
    if (!headings.has(image.section)) out.push(violation(7, file, `${at}.section`, `图片“${image.id}”要放在小节“${image.section}”后面，但正文里没有这个小节标题`));
    for (const key of ['alt', 'caption', 'credit', 'license', 'sourceUrl'] as const) {
      if (image[key].trim() === '') out.push(violation(7, file, `${at}.${key}`, `图片“${image.id}”的 ${key}（${IMAGE_FIELD_NAMES[key]}）没有填写`));
    }
  });
  return out;
}

const IMAGE_FIELD_NAMES = { alt: '图片的文字说明', caption: '图注', credit: '作者或收藏机构', license: '授权方式', sourceUrl: '图片出处的网址' };

/** 规则 8 凭据：正文每个小节都有一组，每组至少一条；依据不是“编写时补的”时至少填一个出处。 */
export function checkProvenance(extras: StopExtras, body: RawSection[], file: string): Violation[] {
  const out: Violation[] = [];
  const headings = new Set(body.map((s) => s.heading));
  const sourceIds = new Set(extras.sources.map((s) => s.id));
  extras.sources.forEach((source, i) => {
    if (!SOURCE_BASES.includes(source.basis)) {
      out.push(violation(8, file, `sources[${i}].basis`, `出处“${source.id}”的依据是“${source.basis}”，只能是 own-words（他本人的诗文书信）、record（史书和同时代人的记载）、later（后人的记载和研究）之一`));
    }
  });
  const covered = new Set(extras.provenance.map((g) => g.section));
  for (const heading of headings) {
    if (!covered.has(heading)) out.push(violation(8, file, 'provenance', `正文的小节“${heading}”没有凭据，每个小节都要有一组`));
  }
  extras.provenance.forEach((group, i) => {
    const at = `provenance[${i}]`;
    if (!headings.has(group.section)) out.push(violation(8, file, `${at}.section`, `这组凭据写的小节是“${group.section}”，但正文里没有这个小节标题`));
    if (group.items.length === 0) out.push(violation(8, file, `${at}.items`, `小节“${group.section}”的这组凭据是空的，至少要有一条`));
    group.items.forEach((item, j) => {
      const itemAt = `${at}.items[${j}]`;
      if (!ITEM_BASES.includes(item.basis)) {
        out.push(violation(8, file, `${itemAt}.basis`, `依据是“${item.basis}”，只能是 own-words、record、later、editor（编写时补的）之一`));
      } else if (item.basis !== 'editor' && item.sourceIds.length === 0) {
        out.push(violation(8, file, `${itemAt}.sourceIds`, `依据是“${item.basis}”，不是编写时补的，至少要填一个出处`));
      }
      item.sourceIds.forEach((id, k) => {
        if (!sourceIds.has(id)) out.push(violation(8, file, `${itemAt}.sourceIds[${k}]`, `出处“${id}”在 sources 里找不到`));
      });
    });
  });
  return out;
}

// ---------------------------------------------------------------- 规则 9 没有占位

/**
 * “（待”开头的占位文字，如“（待填）”“（待核）”；半角括号也算。
 * 括号里带“待核、待填、待补、待定、待查、待写”的话也算，如“（约数，待核）”。
 * 起步稿里留下的“（起步稿……”也算：没有填写凭据的内容不能通过校验（技术方案第四节第 8 条）。
 */
const PLACEHOLDER =
  /[（(](?:待|起步稿)[^（()）]{0,30}[)）]?|[（(][^（()）]{0,40}(?:待核|待填|待补|待定|待查|待写|起步稿)[^（()）]{0,30}[)）]/;

/** 在一份 JSON 数据的所有文字里找占位。 */
export function findPlaceholders(value: unknown, file: string, field: string): Violation[] {
  if (typeof value === 'string') {
    const found = PLACEHOLDER.exec(value);
    return found ? [violation(9, file, field, `还留着占位文字“${found[0]}”`)] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item, i) => findPlaceholders(item, file, `${field}[${i}]`));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => findPlaceholders(item, file, field === '' ? key : `${field}.${key}`));
  }
  return [];
}

/** 在正文里一行一行地找占位。 */
export function findBodyPlaceholders(markdown: string, file: string): Violation[] {
  return markdown
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .flatMap((line, i) => {
      const found = PLACEHOLDER.exec(line);
      return found ? [violation(9, file, `第 ${i + 1} 行`, `还留着占位文字“${found[0]}”`)] : [];
    });
}

// ---------------------------------------------------------------- 格式

// 字段该是什么样子（怎么对照着查，见 shape.ts）。kind、basis 另有规则细查，这里只看有没有、是不是文字。
// 首页卡片、人物资料和一站的 .json 多出别的字段不管；场景文件查得严，它的样子在 sceneRules.ts。

/** 人物资料里的坐标另由规则 1 查，这里不管。 */
const coordinate = anything;

const CARD = object({ id: text, name: text, era: text, years: text, sortYear: number, tagline: text, available: bool, outline: optional(bool) });

const PLACE = object({ id: text, ancient: text, modern: text, lngLat: coordinate });

const FIGURE = object({
  id: text,
  name: text,
  era: text,
  years: text,
  tagline: text,
  intro: list(text),
  // 停用的四个字段（overview，每一站的 camera、localPlaces，legs）可以不写；写了的照这里的样子查
  overview: optional(object({ center: coordinate, distanceKm: number })),
  stops: list(
    object({
      id: text,
      title: text,
      shortTitle: text,
      years: text,
      age: text,
      place: PLACE,
      camera: optional(object({ distanceKm: number, pitch: number, bearing: number })),
      summary: text,
      status: oneOf(['complete', 'outline']),
      // 这一站有自己的沙盘：写 true；没有的不写（和 scenes/ 里的文件对不对得上，规则 3 查）
      table: optional(bool),
      localPlaces: optional(list(PLACE)),
    }),
  ),
  legs: optional(list(object({ from: text, to: text, via: list(object({ name: text, lngLat: coordinate })) }))),
});

const EXTRAS = object({
  stopId: text,
  notes: list(object({ id: text, kind: text, anchor: text, title: text, body: text, sourceIds: list(text) })),
  originals: list(object({ id: text, title: text, date: text, text, plain: text, section: text, sourceId: text })),
  images: list(object({ id: text, file: text, alt: text, caption: text, section: text, credit: text, license: text, sourceUrl: text })),
  sources: list(object({ id: text, basis: text, cite: text })),
  provenance: list(object({ section: text, items: list(object({ what: text, basis: text, sourceIds: list(text) })) })),
  sampleQuestions: list(text),
});

/** 同一个列表里 id 不能重复。 */
function duplicateIds(items: { id: string }[], file: string, field: string): Violation[] {
  const out: Violation[] = [];
  items.forEach((item, i) => {
    const first = items.findIndex((other) => other.id === item.id);
    if (first < i) out.push(violation(0, file, `${field}[${i}].id`, `id“${item.id}”和这个列表里的第 ${first + 1} 项重复了`));
  });
  return out;
}

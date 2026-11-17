// 内容校验规则：docs/data-spec.md 的九条，加上“格式”（文件读得出来、字段齐全、id 对得上）。
// 全是纯函数：输入是读进内存的内容文件，输出是不合规格的地方。不读磁盘，也不依赖测试框架。

import { annotate, BodyFormatError, bodyLength, parseBody } from '../../src/domain/body';
import type { RawSection } from '../../src/domain/body';
import type { Figure, FigureCard, StopExtras, StopMeta } from '../../src/domain/types';

/**
 * 内容目录读进内存的样子：相对 content/ 的路径（用“/”分隔，如 figures/su-shi/figure.json）→ 文件里的文字。
 * 图片等文件只看有没有，文字留空。
 */
export type ContentFiles = Record<string, string>;

/** 一处不合规格的地方。 */
export interface Violation {
  /** 0 是“格式”；1 到 9 对应数据规格里的九条校验规则。 */
  rule: number;
  /** 哪个文件，相对 content/ 的路径。 */
  file: string;
  /** 哪个字段（正文则是哪一行、哪个小节）；说的是整个文件时为空。 */
  field: string;
  /** 哪里不对。 */
  problem: string;
}

export const RULE_NAMES = ['格式', '坐标', '站点与轨迹', '文件齐全', '正文', '小注', '原文', '图片', '凭据', '没有占位'] as const;

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

/** 校验整个内容目录：首页卡片，以及每位人物和他的每一站。 */
export function validateContent(files: ContentFiles): Violation[] {
  const figureIds = new Set<string>();
  for (const path of Object.keys(files)) {
    const match = /^figures\/([^/]+)\//.exec(path);
    if (match) figureIds.add(match[1]);
  }
  return [...checkIndex(files), ...[...figureIds].sort().flatMap((id) => validateFigure(files, id))];
}

// ---------------------------------------------------------------- 首页卡片

export function checkIndex(files: ContentFiles): Violation[] {
  const file = 'figures/index.json';
  const read = readJson(files, file);
  if (read.data === undefined) return read.violations;
  const shape = checkShape(read.data, list(CARD), file);
  if (shape.length > 0) return shape;
  const cards = read.data as FigureCard[];

  const out = duplicateIds(cards, file, '');
  cards.forEach((card, i) => {
    if (card.available && !has(files, `figures/${card.id}/figure.json`)) {
      out.push(violation(0, file, `[${i}].available`, `“${card.name}”标了可以点进去，但没有 figures/${card.id}/figure.json`));
    }
  });
  out.push(...findPlaceholders(cards, file, ''));
  return out;
}

// ---------------------------------------------------------------- 一位人物

export function validateFigure(files: ContentFiles, figureId: string): Violation[] {
  const dir = `figures/${figureId}`;
  const file = `${dir}/figure.json`;
  const read = readJson(files, file);
  if (read.data === undefined) return read.violations;
  const shape = checkShape(read.data, FIGURE, file);
  if (shape.length > 0) return shape;
  const figure = read.data as Figure;

  const out: Violation[] = [];
  if (figure.id !== figureId) out.push(violation(0, file, 'id', `应该和文件夹的名字一样（${figureId}），现在是“${figure.id}”`));
  figure.stops.forEach((stop, i) => out.push(...duplicateIds(stop.localPlaces, file, `stops[${i}].localPlaces`)));
  out.push(...checkCoordinates(figure, file));
  out.push(...checkRoute(figure, file));
  out.push(...checkStopFiles(figure, files, dir));
  out.push(...checkFigurePlaceholders(figure, file));
  for (const stop of figure.stops) {
    if (stop.status === 'complete') out.push(...validateStop(files, dir, stop));
  }
  return out;
}

/** 规则 1 坐标：[经度, 纬度]，经度在 −180 到 180 之间，纬度在 −90 到 90 之间。 */
export function checkCoordinates(figure: Figure, file: string): Violation[] {
  const out: Violation[] = [];
  const check = (value: unknown, field: string) => {
    const problem = lngLatProblem(value);
    if (problem) out.push(violation(1, file, field, problem));
  };
  check(figure.overview.center, 'overview.center');
  figure.stops.forEach((stop, i) => {
    check(stop.place.lngLat, `stops[${i}].place.lngLat`);
    stop.localPlaces.forEach((place, j) => check(place.lngLat, `stops[${i}].localPlaces[${j}].lngLat`));
  });
  figure.legs.forEach((leg, i) => leg.via.forEach((point, j) => check(point.lngLat, `legs[${i}].via[${j}].lngLat`)));
  return out;
}

/** 一个坐标哪里不对；没问题时返回 null。 */
export function lngLatProblem(value: unknown): string | null {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return '应该写成 [经度, 纬度] 两个数';
  }
  const [lng, lat] = value as [number, number];
  if (lng < -180 || lng > 180) return `经度 ${lng} 超出范围（应在 -180 到 180 之间）`;
  if (lat < -90 || lat > 90) {
    const swapped = Math.abs(lng) <= 90 ? '；是不是把经度和纬度写反了？' : '';
    return `纬度 ${lat} 超出范围（应在 -90 到 90 之间）${swapped}`;
  }
  return null;
}

/** 规则 2 站点与轨迹：站的 id 不重复；legs 比 stops 少一个，并且依次首尾相连。 */
export function checkRoute(figure: Figure, file: string): Violation[] {
  const out: Violation[] = [];
  const { stops, legs } = figure;
  stops.forEach((stop, i) => {
    const first = stops.findIndex((s) => s.id === stop.id);
    if (first < i) out.push(violation(2, file, `stops[${i}].id`, `站的 id“${stop.id}”和第 ${first + 1} 站重复了`));
  });
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

/** 规则 3 文件齐全：complete 的站同时有 .md 和 .json；outline 的站两个都没有。 */
export function checkStopFiles(figure: Figure, files: ContentFiles, dir: string): Violation[] {
  const out: Violation[] = [];
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

/** 字段该是什么样子。坐标、kind、basis 另有规则细查，这里只看有没有、是不是文字。 */
type Shape =
  | { is: 'string' | 'number' | 'boolean' | 'any' }
  | { is: 'oneOf'; values: readonly string[] }
  | { is: 'list'; item: Shape }
  | { is: 'object'; fields: Record<string, Shape> };

const text: Shape = { is: 'string' };
const number: Shape = { is: 'number' };
const lngLat: Shape = { is: 'any' };
const list = (item: Shape): Shape => ({ is: 'list', item });
const object = (fields: Record<string, Shape>): Shape => ({ is: 'object', fields });

const CARD = object({ id: text, name: text, era: text, years: text, sortYear: number, tagline: text, available: { is: 'boolean' } });

const PLACE = object({ id: text, ancient: text, modern: text, lngLat });

const FIGURE = object({
  id: text,
  name: text,
  era: text,
  years: text,
  tagline: text,
  intro: list(text),
  overview: object({ center: lngLat, distanceKm: number }),
  stops: list(
    object({
      id: text,
      title: text,
      shortTitle: text,
      years: text,
      age: text,
      place: PLACE,
      camera: object({ distanceKm: number, pitch: number, bearing: number }),
      summary: text,
      status: { is: 'oneOf', values: ['complete', 'outline'] },
      localPlaces: list(PLACE),
    }),
  ),
  legs: list(object({ from: text, to: text, via: list(object({ name: text, lngLat })) })),
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

/** 对照样子检查一份 JSON 数据：缺了哪个字段，哪个字段的类型不对。 */
export function checkShape(value: unknown, shape: Shape, file: string, field = ''): Violation[] {
  const bad = (problem: string) => [violation(0, file, field, problem)];
  if (shape.is !== 'any' && value === undefined) return bad('缺少这个字段');
  switch (shape.is) {
    case 'any':
      return [];
    case 'string':
      return typeof value === 'string' ? [] : bad('应该是一段文字（写在双引号里）');
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? [] : bad('应该是一个数');
    case 'boolean':
      return typeof value === 'boolean' ? [] : bad('应该是 true 或 false');
    case 'oneOf':
      return typeof value === 'string' && shape.values.includes(value) ? [] : bad(`只能是 ${shape.values.join(' 或 ')}`);
    case 'list':
      if (!Array.isArray(value)) return bad('应该是一个列表（写在 [ ] 里）');
      return value.flatMap((item, i) => checkShape(item, shape.item, file, `${field}[${i}]`));
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return bad('应该是一组字段（写在 { } 里）');
      const record = value as Record<string, unknown>;
      return Object.entries(shape.fields).flatMap(([name, item]) => checkShape(record[name], item, file, field === '' ? name : `${field}.${name}`));
    }
  }
}

/** 读一个 JSON 文件；没有这个文件或读不出来时 data 为 undefined，并说明原因。 */
function readJson(files: ContentFiles, file: string): { data?: unknown; violations: Violation[] } {
  if (!has(files, file)) return { violations: [violation(0, file, '', '没有这个文件')] };
  try {
    return { data: JSON.parse(files[file].replace(/^﻿/, '')) as unknown, violations: [] };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { violations: [violation(0, file, '', `不是合法的 JSON，程序读不出来（${detail}）`)] };
  }
}

/** 同一个列表里 id 不能重复。 */
function duplicateIds(items: { id: string }[], file: string, field: string): Violation[] {
  const out: Violation[] = [];
  items.forEach((item, i) => {
    const first = items.findIndex((other) => other.id === item.id);
    if (first < i) out.push(violation(0, file, `${field}[${i}].id`, `id“${item.id}”和这个列表里的第 ${first + 1} 项重复了`));
  });
  return out;
}

function has(files: ContentFiles, path: string): boolean {
  return Object.hasOwn(files, path);
}

function violation(rule: number, file: string, field: string, problem: string): Violation {
  return { rule, file, field, problem };
}

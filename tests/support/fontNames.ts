// 字体文件按范围分的时候（tests/support/fontTool.ts 第五段，开关关着）各个文件叫什么。单放在这个什么也不引的小文件里：
// 做字体的工具照它拼名字，内容校验也照它查“文件名在人物和站之间不重样”（tests/content/rules.ts 的规则 0）——两头用的是同一条拼法。

/** 一个文件是照哪个原字体做的。 */
type Source = 'sans' | 'song' | 'kai';

/** “来源”页这个范围的名字。没有哪位人物可以叫这个名字（内容校验守着）。 */
export const SOURCES_SCOPE = 'sources';
/** 点开才要的文件名字末尾接的那个词。没有哪一站可以叫这个名字：那样它的文件就和人物点开才要的那个重名了（内容校验守着）。 */
export const PRESSED_SUFFIX = 'more';

/** 一个范围的一个文件叫什么（不带 .woff2）。只有这一处拼名字：框架的是 yanlu-sans、yanlu-song；别的在后面接上范围、站，点开才要的再接 more。 */
export function scopeFileName(source: Source, scope: string, unit: string | null, role: 'rest' | 'pressed'): string {
  return ['yanlu', source, ...(scope === 'frame' ? [] : [scope]), ...(unit === null ? [] : [unit]), ...(role === 'pressed' ? [PRESSED_SUFFIX] : [])].join('-');
}

/** 可能写出来的一个文件名，和它是谁的。 */
export interface ScopeFileOwner {
  name: string;
  /** 给人看的叫法：框架，人物 su-shi，su-shi 的 xuzhou 这一站，“来源”页。 */
  of: string;
  /** 是哪位人物的（框架和“来源”页的是 null），哪一站的（不归哪一站是 null）。 */
  figure: string | null;
  stop: string | null;
}

/**
 * 照人物和站的 id，按范围分的时候可能写出来的每一个文件名（不看哪一站现在有没有正文、有没有沙盘：以后有了就会写）。
 * 人物照给的先后，一位人物先是他自己的四个，再照站的先后是各站的两个；框架在最前，“来源”页在最后。
 */
export function scopeFileNames(figures: readonly { id: string; stops: readonly string[] }[]): ScopeFileOwner[] {
  const names: ScopeFileOwner[] = [];
  const scopeNames = (scope: string, of: string, figure: string | null): void => {
    for (const source of ['sans', 'song', 'kai'] as const) names.push({ name: scopeFileName(source, scope, null, 'rest'), of, figure, stop: null });
    names.push({ name: scopeFileName('song', scope, null, 'pressed'), of, figure, stop: null });
  };
  for (const source of ['sans', 'song'] as const) names.push({ name: scopeFileName(source, 'frame', null, 'rest'), of: '框架', figure: null, stop: null });
  for (const figure of figures) {
    scopeNames(figure.id, `人物 ${figure.id}`, figure.id);
    for (const stop of figure.stops) for (const role of ['rest', 'pressed'] as const) names.push({ name: scopeFileName('song', figure.id, stop, role), of: `${figure.id} 的 ${stop} 这一站`, figure: figure.id, stop });
  }
  scopeNames(SOURCES_SCOPE, '“来源”页', null);
  return names;
}

/** 人物和站的 id 里能用的字：小写的英文字母、数字、连字符。 */
const SCOPE_ID = /^[a-z0-9-]+$/;

/**
 * 按范围分的时候，人物和站的 id 原样写进好几处，哪一处都不转码：文件名，fonts.css 里换名称的规则（:root[data-fonts='…']）和样式表里的名称，
 * scopes.ts 里的键和引入的路径，index.html 里的那一段，点开才要的字的样式表的名字（<人物>.<站>.css），文件里的 PostScript 名称。
 * 带了引号、点、空格、大写字母、汉字的 id，会把这些文件写坏，或者让两站的样式表撞成一个名字。不合格的每个 id 一句话，都合格是空的。
 * （不看哪一站现在有没有正文、有没有沙盘：以后有了就会写。）
 */
export function scopeIdProblems(figures: readonly { id: string; stops: readonly string[] }[]): string[] {
  const problems: string[] = [];
  const check = (id: string, of: string): void => {
    if (!SCOPE_ID.test(id)) problems.push(`${of}的 id “${id}”里有小写英文字母、数字、连字符以外的字（或者是空的）：字体文件的名字、样式表里的规则都照 id 原样写，写不了`);
  };
  for (const figure of figures) {
    check(figure.id, '人物');
    for (const stop of figure.stops) check(stop, `${figure.id} 的一站`);
  }
  return problems;
}

/** 一串文件名里重了的：每一个重了的名字一项，带着是哪几个撞上了（照给的先后）。都不重是空的。 */
export function scopeNameOwners(names: readonly Pick<ScopeFileOwner, 'name' | 'of'>[]): { name: string; owners: string[] }[] {
  const owners = new Map<string, string[]>();
  for (const { name, of } of names) owners.set(name, [...(owners.get(name) ?? []), of]);
  return [...owners].filter(([, list]) => list.length > 1).map(([name, list]) => ({ name, owners: list }));
}

/** 重了的名字各写成一句话。 */
export function scopeNameClashes(names: readonly Pick<ScopeFileOwner, 'name' | 'of'>[]): string[] {
  return scopeNameOwners(names).map(({ name, owners }) => `字体文件 ${name}.woff2 会被写两回：${owners.join('，和')}`);
}

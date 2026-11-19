// 构建出来的网站里，随站的字体带得对不对。查构建结果的测试用它（tests/build/dist-size.test.ts）；只在 Node 里跑。
// 这里全是读文字、比对：index.html 和样式表的原文、每个字体文件的记号由调用的人从 dist/ 读了给进来，
// 真的 dist/ 和测试里编出来的走的是同一条路。
//
// 为什么要查构建出来的，不只查源文件：
//   一、字体文件的名字构建以后带了一串每次都可能变的字符。index.html 里预先声明的地址和样式表里写的地址
//       要是成了两个文件，同一个字体会下载两遍。
//   二、预先声明少了 crossorigin，浏览器取来的那一份样式表用不上，也会再取一遍。
//   三、构建的工具会改写样式表：把分开写的 text-decoration-line、-style、-color 合回一句，Safari 26.2 以前就不认了
//      （带虚线的词会没有线）；@container 和 cqw 老平板（iPadOS 15）不认，不许比现在多。
// Safari 在这台机器上跑不了，这几条靠“写成什么样”来守。

import { countIn, readCss } from './sourceScan';

/** index.html 里预先声明的一个字体文件。 */
export interface FontPreload {
  /** 地址，原样。 */
  href: string;
  as: string;
  type: string;
  crossorigin: boolean;
}

/** 样式表里的一条 @font-face。 */
export interface FontFace {
  family: string;
  /** src 里 url(...) 的地址，原样。 */
  url: string;
  /** 有没有 unicode-range（有的话，页面上用到它里面的字时才下载）。 */
  ranged: boolean;
  display: string;
}

/** 一段 HTML 里的 <link rel="preload" as="font">，按先后。注释里的不算。 */
export function fontPreloads(html: string): FontPreload[] {
  const found: FontPreload[] = [];
  for (const [tag] of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<link\b[^>]*>/g)) {
    const attr = (name: string): string | null => {
      const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`).exec(tag);
      return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null;
    };
    if (attr('rel') !== 'preload' || attr('as') !== 'font') continue;
    found.push({ href: attr('href') ?? '', as: attr('as') ?? '', type: attr('type') ?? '', crossorigin: /\scrossorigin(?=[\s=/>])/.test(tag) });
  }
  return found;
}

/** 一份样式表里的每一条 @font-face，按先后。 */
export function fontFaces(css: string): FontFace[] {
  const faces: FontFace[] = [];
  // 一条 @font-face 是一对大括号，里面没有别的大括号：一块一块取出来读，不靠里面几条声明的先后
  for (const [, body] of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const face: FontFace = { family: '', url: '', ranged: false, display: '' };
    for (const { property, value } of readCss(`face{${body}}`).declarations) {
      if (property === 'font-family') face.family = value.replace(/^['"]|['"]$/g, '');
      if (property === 'src') face.url = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/.exec(value)?.slice(1).find((part) => part !== undefined) ?? '';
      if (property === 'unicode-range') face.ranged = true;
      if (property === 'font-display') face.display = value;
    }
    faces.push(face);
  }
  return faces;
}

/** 一个地址相对着 base（dist/ 里的一个文件）算出来，是 dist/ 里的哪个文件；指到别的网站去的是 null。 */
export function inDist(address: string, base: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(address) || address.startsWith('//')) return null;
  const url = new URL(address, `http://dist.invalid/${base}`);
  return decodeURIComponent(url.pathname.slice(1));
}

/** 构建出来的网站里和字体有关的几样，由调用的人读了给进来。路径都相对 dist/。 */
export interface BuiltSite {
  /** index.html 的原文。 */
  html: string;
  /** 每一份样式表：路径 → 原文。 */
  sheets: Record<string, string>;
  /** dist/ 里每一个 .woff2：路径 → 字节数和 SHA-256。 */
  fonts: Record<string, { bytes: number; sha256: string }>;
}

/** 放进仓库的一个字体文件（src/fonts/fonts.json 里记的）。 */
export interface CommittedFont {
  file: string;
  sha256: string;
  /** 样式表里有没有给它写 unicode-range。 */
  range: boolean;
  /** 装的是不是不用点开就看得见的字；只归哪一站（宋体按站拆开以后才有，大家共用的是 null）。算首次打开要下载多少时用。 */
  first: boolean;
  stop: string | null;
}

export interface BuiltFonts {
  /** 不对的地方，一句一条；都对是空的。 */
  problems: string[];
  /** dist/ 里的每个字体文件：是放进仓库的哪一个，多少字节，是不是一打开就下载的（index.html 里预先声明了的）。 */
  files: { file: string; built: string; bytes: number; first: boolean }[];
}

/** @container 至多几处、cqw 至多几处：就是现在的数。老平板不认这两样，不许再添。 */
export const CONTAINER_MAX = 4;
export const CQW_MAX = 2;

/**
 * 构建出来的网站里的字体对着放进仓库的查一遍：
 *   dist/ 里的 .woff2 正好是放进仓库的那几个（一个字节不差），不多不少；
 *   index.html 预先声明的，正好是样式表里不带 unicode-range 的那几条，地址是同一个文件，都带 crossorigin、type；
 *   每一条 @font-face 指着 dist/ 里有的文件，都是 font-display: swap；带 unicode-range 的和放进仓库的记录一致。
 */
export function builtFonts(site: BuiltSite, committed: CommittedFont[]): BuiltFonts {
  const problems: string[] = [];
  const say = (line: string): void => {
    problems.push(line);
  };

  // dist/ 里的字体文件各是放进仓库的哪一个
  const builtOf = new Map<string, string>();
  for (const [path, { sha256 }] of Object.entries(site.fonts)) {
    const match = committed.find((item) => item.sha256 === sha256);
    if (!match) say(`dist/ 里的 ${path} 不是放进仓库的字体文件（记号对不上）`);
    else if (builtOf.has(match.file)) say(`${match.file} 在 dist/ 里有两份：${builtOf.get(match.file)} 和 ${path}（同一个字体会下载两遍）`);
    else builtOf.set(match.file, path);
  }
  for (const item of committed) if (!builtOf.has(item.file)) say(`放进仓库的 ${item.file} 不在 dist/ 里：页面没有用上它`);

  // 样式表里的 @font-face
  const faces = Object.entries(site.sheets).flatMap(([sheet, css]) => fontFaces(css).map((face) => ({ ...face, sheet, path: inDist(face.url, sheet) })));
  if (faces.length !== committed.length) say(`构建出来的样式表里有 ${faces.length} 条 @font-face，放进仓库的字体文件是 ${committed.length} 个`);
  for (const face of faces) {
    const where = `${face.sheet} 里 ${face.family} 的 @font-face`;
    if (face.path === null) say(`${where}指着别的网站：${face.url}`);
    else if (!Object.hasOwn(site.fonts, face.path)) say(`${where}指着 ${face.url}，dist/ 里没有这个文件`);
    else {
      const source = committed.find((item) => builtOf.get(item.file) === face.path);
      if (source && source.range !== face.ranged) say(`${where}（${source.file}）${face.ranged ? '带着' : '没有'} unicode-range，和放进仓库的记录不一样`);
    }
    if (face.display !== 'swap') say(`${where}的 font-display 是“${face.display}”，应该是 swap（字体文件来得晚，字先用别的字体显示，不能空着）`);
  }

  // index.html 里预先声明的
  const preloads = fontPreloads(site.html).map((link) => ({ ...link, path: inDist(link.href, 'index.html') }));
  const firstFaces = faces.filter((face) => !face.ranged && face.path !== null).map((face) => face.path as string);
  for (const link of preloads) {
    const where = `index.html 里预先声明的 ${link.href}`;
    if (link.path === null) say(`${where}指着别的网站`);
    else if (!Object.hasOwn(site.fonts, link.path)) say(`${where}，dist/ 里没有这个文件`);
    else if (!firstFaces.includes(link.path)) say(`${where}不是样式表里一打开就要用的字体文件（样式表里写的是 ${firstFaces.join('、') || '没有'}）：会多下载一个文件`);
    if (!link.crossorigin) say(`${where}没有 crossorigin：浏览器取来的这一份样式表用不上，会再取一遍`);
    if (link.type !== 'font/woff2') say(`${where}的 type 是“${link.type}”，应该是 font/woff2`);
  }
  for (const path of firstFaces) if (!preloads.some((link) => link.path === path)) say(`样式表里一打开就要用的 ${path} 没有在 index.html 里预先声明`);
  const paths = preloads.map((link) => link.path);
  if (paths.some((path, i) => path !== null && paths.indexOf(path) !== i)) say('index.html 里同一个字体文件预先声明了两次');

  const first = new Set(preloads.map((link) => link.path));
  const files = committed.flatMap((item) => {
    const built = builtOf.get(item.file);
    return built ? [{ file: item.file, built, bytes: site.fonts[built].bytes, first: first.has(built) }] : [];
  });
  return { problems, files };
}

/**
 * 构建出来的样式表里不该有的写法（sheets：路径 → 原文）：
 *   text-decoration、-webkit-text-decoration 的值里带着 var(（合成一句、又带着颜色的写法，Safari 26.2 以前线会没有）；
 *   @container 超过四处、cqw 超过两处（几份样式表合起来数）；
 *   url( 指着别的网站。
 */
export function builtStyleProblems(sheets: Record<string, string>): string[] {
  const problems: string[] = [];
  let containers = 0;
  let cqws = 0;
  for (const [sheet, css] of Object.entries(sheets)) {
    for (const { selector, property, value } of readCss(css).declarations) {
      if ((property === 'text-decoration' || property === '-webkit-text-decoration') && value.includes('var(')) {
        problems.push(`${sheet} 里 ${selector} 的 ${property}: ${value} —— 合成一句又带着变量，Safari 26.2 以前这道线会没有：源文件里要分开写成 text-decoration-line、-style、-color；已经分开写了的话，是构建把它合回去了，那就改用下边框画这道线`);
      }
      for (const [, quoted, bare] of value.matchAll(/url\(\s*(?:["']([^"']*)["']|([^)\s]*))\s*\)/g)) {
        const address = quoted ?? bare ?? '';
        if (!address.startsWith('data:') && inDist(address, sheet) === null) problems.push(`${sheet} 里 ${selector} 的 ${property} 指着别的网站：${address}`);
      }
    }
    containers += countIn(css, '@container');
    cqws += countIn(css, 'cqw');
  }
  if (containers > CONTAINER_MAX) problems.push(`构建出来的样式表里 @container 有 ${containers} 处，最多 ${CONTAINER_MAX} 处（iPadOS 15 不认，写在里面的东西老平板上等于没有）`);
  if (cqws > CQW_MAX) problems.push(`构建出来的样式表里 cqw 有 ${cqws} 处，最多 ${CQW_MAX} 处（iPadOS 15 不认）`);
  return problems;
}

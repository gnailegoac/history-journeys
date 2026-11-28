// 构建出来的网站里，随站的字体带得对不对。查构建结果的测试用它（tests/build/dist-size.test.ts）；只在 Node 里跑。
// 这里全是读文字、比对：index.html 和样式表的原文、每个字体文件的记号由调用的人从 dist/ 读了给进来，
// 真的 dist/ 和测试里编出来的走的是同一条路。
//
// 为什么要查构建出来的，不只查源文件：
//   一、字体文件的名字构建以后带了一串每次都可能变的字符。index.html 里预先声明的地址和样式表里写的地址
//       要是成了两个文件，同一个字体会下载两遍。
//   二、预先声明少了 crossorigin，浏览器取来的那一份样式表用不上，也会再取一遍。
//   三、构建的工具会改写样式表：把分开写的 text-decoration-line、-style、-color 合回一句，Safari 26.2 以前就不认了
//      （带虚线的词会没有线）；@container 和 cqw 老平板（iPadOS 15）不认，一处也不许有。
//   四、字体文件是按范围分的：不用点开就要的文件的 @font-face 都在页面一打开就读的那一份样式表里，点开才要的各在自己的一份里
//       （并进了页面那一份，它的 unicode-range 那一长串就成了每位读者一打开都要下载的）；index.html 里各个范围的预先声明先不生效，
//       行上写着它是给谁的——构建以后这几样还得是这样。
// Safari 在这台机器上跑不了，这几条靠“写成什么样”来守。

import { countIn, mediaProblems, mediaQueries, readCss } from './sourceScan';

/** index.html 里预先声明的一个字体文件。 */
export interface FontPreload {
  /** 地址，原样。 */
  href: string;
  as: string;
  type: string;
  crossorigin: boolean;
  /** media 属性写的什么；没有写是 null。写着 not all 的是先不生效的一行。 */
  media: string | null;
  /** 先不生效的一行上写着它是给谁的：范围、哪一站（没有写是 null，写着空的是空的）、黑体还是宋体、是不是首页也要。 */
  fonts: string | null;
  unit: string | null;
  family: string | null;
  home: boolean;
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
    found.push({
      href: attr('href') ?? '',
      as: attr('as') ?? '',
      type: attr('type') ?? '',
      crossorigin: /\scrossorigin(?=[\s=/>])/.test(tag),
      media: attr('media'),
      fonts: attr('data-fonts'),
      unit: attr('data-fonts-unit'),
      family: attr('data-fonts-family'),
      home: /\sdata-fonts-home(?=[\s=/>])/.test(tag),
    });
  }
  return found;
}

/** 一段 HTML 里挂着的样式表（<link rel="stylesheet">）的地址，按先后。注释里的不算。 */
export function styleSheetLinks(html: string): string[] {
  const found: string[] = [];
  for (const [tag] of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<link\b[^>]*>/g)) {
    if (!/\srel\s*=\s*["']?stylesheet["']?(?=[\s/>])/.test(tag)) continue;
    const href = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/.exec(tag);
    if (href) found.push(href[1] ?? href[2] ?? href[3] ?? '');
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

/** 放进仓库的一个字体文件（src/fonts/fonts.json 里记的，格式 4）。 */
export interface CommittedFont {
  /** 在 src/fonts/ 里的路径：yanlu-song.woff2，scopes/yanlu-song-su-shi.woff2。 */
  file: string;
  sha256: string;
  /** 样式表里有没有给它写 unicode-range（只有点开才要的有）。 */
  range: boolean;
  /**
   * 在 index.html 里怎么声明（做字体的工具定的）：always 框架的两个，一打开就取；scope 各个范围不用点开就要的黑体、宋体，
   * 先不生效，地址合得上才取；none 不声明（楷体，和点开才要的）。
   */
  preload: 'always' | 'scope' | 'none';
  /** 它的 @font-face 写在哪一份样式表里（相对 src/fonts/）：fonts.css 是页面一打开就读的那一份；别的是这个范围点开才要的字自己的一份。 */
  sheet: string;
  /** 归哪个范围（frame、人物的 id、sources），哪一站（不归哪一站是 null），是照哪个原字体做的（sans、song、kai）。 */
  scope: string;
  unit: string | null;
  source: string;
}

export interface BuiltFonts {
  /** 不对的地方，一句一条；都对是空的。 */
  problems: string[];
  /** dist/ 里的每个字体文件：是放进仓库的哪一个，多少字节，是不是一打开就下载的（index.html 里预先声明了、生效的）。 */
  files: { file: string; built: string; bytes: number; first: boolean }[];
}

/**
 * @container 至多几处、cqw 至多几处：一处也不许有。老平板（iPadOS 15）不认这两样，写在里面的东西在它上面等于没有。
 * 沙盘栏里宽窄两种排法原来靠它们分，重做顺序第 2 步改成页面量了栏宽以后挂类名、写 --pane-w（src/ui/StagePane.tsx），
 * 从那以后样式表里就没有它们了。
 */
export const CONTAINER_MAX = 0;
export const CQW_MAX = 0;

/**
 * 构建出来的网站里的字体对着放进仓库的查一遍：
 *   dist/ 里的 .woff2 正好是放进仓库的那几个（一个字节不差），不多不少；
 *   每一条 @font-face 指着 dist/ 里有的文件，都是 font-display: swap；带不带 unicode-range 和放进仓库的记录一致；
 *   不用点开就要的文件的 @font-face 都在页面一打开就读的那一份样式表里（index.html 挂着的），点开才要的各在别的一份里、一份只有它一条；
 *   index.html 里生效的预先声明，正好是记录里说一打开就取的那几个（框架的两个），地址和样式表里写的是同一个文件，都带 crossorigin、type；
 *   先不生效的预先声明（media="not all"），正好是记录里各个范围不用点开就要的黑体、宋体文件各一行，地址也是样式表里写的那个文件，
 *   行上写着的范围、站、黑体还是宋体和记录里的一样（“来源”页的那一行写着空的站）。
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
  const pageSheets = styleSheetLinks(site.html).map((href) => inDist(href, 'index.html'));
  const faces = Object.entries(site.sheets).flatMap(([sheet, css]) => fontFaces(css).map((face) => ({ ...face, sheet, path: inDist(face.url, sheet) })));
  if (faces.length !== committed.length) say(`构建出来的样式表里有 ${faces.length} 条 @font-face，放进仓库的字体文件是 ${committed.length} 个`);
  for (const face of faces) {
    const where = `${face.sheet} 里 ${face.family} 的 @font-face`;
    if (face.path === null) say(`${where}指着别的网站：${face.url}`);
    else if (!Object.hasOwn(site.fonts, face.path)) say(`${where}指着 ${face.url}，dist/ 里没有这个文件`);
    else {
      const source = committed.find((item) => builtOf.get(item.file) === face.path);
      if (source && source.range !== face.ranged) say(`${where}（${source.file}）${face.ranged ? '带着' : '没有'} unicode-range，和放进仓库的记录不一样`);
      // 不用点开就要的在页面一打开就读的那一份里；点开才要的不在那一份里，自己的一份里只有它一条
      const onPage = pageSheets.includes(face.sheet);
      if (source && source.sheet === 'fonts.css' && !onPage) say(`${where}（${source.file}）不在页面一打开就读的那一份样式表里：这一页要它的时候还得等另一份样式表`);
      if (source && source.sheet !== 'fonts.css' && onPage) say(`${where}（${source.file}）是点开才要的字，却并进了页面一打开就读的那一份样式表：它那一长串 unicode-range 每位读者一打开都要下载`);
      if (source && source.sheet !== 'fonts.css' && !onPage && faces.filter((other) => other.sheet === face.sheet).length !== 1) say(`${face.sheet} 里不止一条 @font-face：点开才要的字的样式表一个范围一份，一份只有它自己的一条`);
    }
    if (face.display !== 'swap') say(`${where}的 font-display 是“${face.display}”，应该是 swap（字体文件来得晚，字先用别的字体显示，不能空着）`);
  }

  // index.html 里预先声明的：生效的，和先不生效的（media="not all"）
  const all = fontPreloads(site.html).map((link) => ({ ...link, path: inDist(link.href, 'index.html') }));
  const preloads = all.filter((link) => link.media !== 'not all');
  const inert = all.filter((link) => link.media === 'not all');
  // 要预先声明的：记录里标着一打开就取的那几个文件，在样式表里的那一条指着的地址
  const preloadFiles = committed.filter((item) => item.preload === 'always').map((item) => builtOf.get(item.file));
  const firstFaces = faces.filter((face) => face.path !== null && preloadFiles.includes(face.path)).map((face) => face.path as string);
  for (const link of preloads) {
    const where = `index.html 里预先声明的 ${link.href}`;
    if (link.path === null) say(`${where}指着别的网站`);
    else if (!Object.hasOwn(site.fonts, link.path)) say(`${where}，dist/ 里没有这个文件`);
    else if (!firstFaces.includes(link.path)) say(`${where}不是记录里说要预先声明的字体文件（要预先声明的是 ${firstFaces.join('、') || '没有'}）：会多下载一个文件，或者下载得太早`);
    if (!link.crossorigin) say(`${where}没有 crossorigin：浏览器取来的这一份样式表用不上，会再取一遍`);
    if (link.type !== 'font/woff2') say(`${where}的 type 是“${link.type}”，应该是 font/woff2`);
    if (link.media !== null) say(`${where}写着 media="${link.media}"：一打开就取的不写 media，先不生效的写 not all`);
  }
  for (const path of firstFaces) if (!preloads.some((link) => link.path === path)) say(`记录里说要预先声明的 ${path} 没有在 index.html 里预先声明`);
  // 带 unicode-range 的文件用到它里面的字时才下载：记录里把它标成要预先声明，是记错了
  for (const item of committed) if (item.preload !== 'none' && item.range) say(`${item.file} 带着 unicode-range（用到时才下载），记录里却说要预先声明`);
  const paths = all.map((link) => link.path);
  if (paths.some((path, i) => path !== null && paths.indexOf(path) !== i)) say('index.html 里同一个字体文件预先声明了两次');

  // 先不生效的那几行：正好是记录里各个范围不用点开就要的黑体、宋体文件，一个一行，照记录的先后
  const scoped = committed.filter((item) => item.preload === 'scope');
  for (const link of inert) {
    const where = `index.html 里先不生效的预先声明 ${link.href}`;
    const source = scoped.find((item) => link.path !== null && builtOf.get(item.file) === link.path);
    if (link.path === null) say(`${where}指着别的网站`);
    else if (!Object.hasOwn(site.fonts, link.path)) say(`${where}，dist/ 里没有这个文件`);
    else if (!source) say(`${where}不是记录里哪个范围不用点开就要的黑体、宋体文件`);
    else if (!faces.some((face) => face.path === link.path)) say(`${where}和样式表里写的不是同一个文件`);
    else {
      const wantUnit = source.unit ?? (source.scope === 'sources' ? '' : null);
      if (link.fonts !== source.scope || link.unit !== wantUnit || link.family !== source.source) {
        say(`${where}（${source.file}）行上写的是范围“${link.fonts ?? '（没有）'}”、站“${link.unit ?? '（没有）'}”、${link.family ?? '（没有）'}，记录里是范围“${source.scope}”、站“${wantUnit ?? '（没有）'}”、${source.source}：页面开头的脚本照这几样认这一行是给谁的`);
      }
    }
    if (!link.crossorigin) say(`${where}没有 crossorigin：浏览器取来的这一份样式表用不上，会再取一遍`);
    if (link.type !== 'font/woff2') say(`${where}的 type 是“${link.type}”，应该是 font/woff2`);
  }
  for (const item of scoped) if (!inert.some((link) => link.path !== null && link.path === builtOf.get(item.file))) say(`${item.file} 是一个范围不用点开就要的文件，index.html 里没有它那一行先不生效的预先声明`);
  // 首页的地址里没有人物：首页要的几行带着 data-fonts-home，是同一位人物不归哪一站的文件——他的宋体，有黑体的话还有黑体；
  // 一行也没有就是首页没有摆着谁
  const home = inert.filter((link) => link.home);
  const homeFamilies = [...home.map((link) => link.family)].sort().join();
  if (home.length > 0 && (new Set(home.map((link) => link.fonts)).size !== 1 || home.some((link) => link.unit !== null) || (homeFamilies !== 'sans,song' && homeFamilies !== 'song'))) {
    say(`index.html 里带着 data-fonts-home 的预先声明应该是同一位人物的黑体和宋体各一行，现在是 ${home.map((link) => [link.fonts, link.unit, link.family].filter((part) => part !== null && part !== '').join(' ')).join('、')}`);
  }

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
 *   有 @container、有 cqw（几份样式表合起来数，一处也不许有）；
 *   url( 指着别的网站；
 *   @media 的条件里有老平板不认的写法，或者照窗口的宽窄分版面的一句少了“横着”（构建会改写样式表：源文件里写对了，这里再看一遍改写以后的）。
 *   这一条只查网站自己的样式表：samples/ 里是早先给负责人看风格的几张样张（public/samples/，另外构建好了原样放进来的），
 *   不是给读者读的页面，版面也不是这一套；其中一张用了比大小的新写法（@media (width<=760px)），老平板上那一句不算数。
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
    for (const query of sheet.startsWith('samples/') ? [] : mediaQueries(css)) {
      const wrong = mediaProblems(query);
      if (wrong.includes('wide-layout')) problems.push(`${sheet} 里 @media ${query} —— 照窗口的宽窄分版面的一句少了 (orientation: landscape)：竖着拿的大平板上它会照左右排的版面算`);
      if (wrong.includes('max-width')) problems.push(`${sheet} 里 @media ${query} —— 上下排的版面不只是窄的窗口：用 not all and (min-width: 960px) and (orientation: landscape)`);
      if (wrong.includes('media-range')) problems.push(`${sheet} 里 @media ${query} —— 这种写法 iPadOS 15 的 Safari 不认，整句在它上面不算数`);
    }
    containers += countIn(css, '@container');
    cqws += countIn(css, 'cqw');
  }
  if (containers > CONTAINER_MAX) problems.push(`构建出来的样式表里 @container 有 ${containers} 处，最多 ${CONTAINER_MAX} 处（iPadOS 15 不认，写在里面的东西老平板上等于没有）`);
  if (cqws > CQW_MAX) problems.push(`构建出来的样式表里 cqw 有 ${cqws} 处，最多 ${CQW_MAX} 处（iPadOS 15 不认）`);
  return problems;
}

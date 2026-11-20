// 随站的字体：哪些字归哪个文件，文件怎么做，做出来的几样长什么样。说明见 docs/data-spec.md“随站的字体”。
// 三个地方用它：做字体的工具（tests/tools/make-fonts.test.ts，npm run fonts）、它自己的测试（同一个文件，随 npm test 跑）、
// 查放进仓库的字体文件的测试（tests/fonts/font-files.test.ts，随 npm test 跑）。只在 Node 里跑；src/ 里的程序不要用。
//
// 分四段：
//   一、做法      用哪两个原字体、留哪些排版功能、名称怎么写。改了其中一样，RECIPE 加一。
//   二、数字      网站上显示哪些字、各归哪一组。不靠人列字表：正文用页面解析正文的那段程序读，沙盘旁边的字、题签、
//                 “沙盘上的东西”一栏用页面生成它们的那几个函数算；界面上的字是 src/ 里的程序原样写着的每一个字。
//   三、做文件    给原字体换名称表、裁剪、压成 WOFF2；样式表、记录、给页面用的那个模块各是什么字。
//   四、读回来    放进仓库的那几个文件读成什么样，网站要的字它们有没有。
//
// 原字体不进仓库：放在 .cache/fonts/（见 README）。第二段和第四段都不用原字体，所以 npm test 在没有原字体的机器上照样跑。

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import type { RouteScene, StopScene, TableScene } from '../../src/domain/scene';
import { ROUTE_SCENE_ID, SCENE_CLASS_LABEL } from '../../src/domain/scene';
import { loadFigure, loadFigureCards, loadStop } from '../../src/domain/content';
import { loadStopTable } from '../../src/domain/sceneContent';
import { sceneRegister, sectionHeadings, sectionInfo, stripTexts } from '../../src/domain/sceneText';
import type { Figure, FigureCard, Source, StopContent } from '../../src/domain/types';
import { KAI_LABELS, placeLabel } from '../../src/ui/text';
import type { FontTables } from './sfnt';
import { charactersOf, checkSfnt, cmapOf, englishName, featuresOf, glyphCountOf, hintingOf, namesOf, readSfnt, readWoff2, renameSfnt } from './sfnt';

/** 项目的根目录：这个文件在 tests/support/ 里，往上两层。 */
const ROOT = new URL('../../', import.meta.url);

const utf8 = new TextDecoder();
const readText = (path: string): string => utf8.decode(readFileSync(new URL(path, ROOT)));
export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

// ================================================================ 一、做法

/**
 * 记录（fonts.json）格式的版本。2：每个原字体那一项里多了留哪些排版功能（keepFeatures），每个文件那一项里多了
 * 是不是一打开就要的（first）、只归哪一站（stop），hinting 改成从做出来的文件里读。
 */
export const RECORD_VERSION = 2;
/**
 * 做法的编号。名称表里除了下面查得到的那几条以外怎么写（说明那一条后半截的“谁做的、谁设计的”）、裁剪时另外交给库的选项，
 * 改了就加一：记录里的编号对不上，工具会重做。
 * 别的几样不靠人记着加一，改了工具自己看得出来：原字体的说明和留哪些排版功能记在记录里，逐项比；
 * 名称、说明那一条的头一句、留没留提示信息，是从做出来的文件里读出来对着这里查的（fontFileProblems）。
 */
export const RECIPE = 1;

/**
 * 宋体要不要按站拆开。现在不拆，而且**还不能直接打开**：这里写好的只是前一半。
 * 写好了、有测试的：哪个字归哪个文件（planFonts）、样式表里各文件的 unicode-range（fontsCss）、
 * “字都在不在”认哪几个文件（servedBy）、首次打开要下载多少按站分开算（budgetRules.ts 的 fontReport）、
 * 构建以后查的是记录里的那几个文件（tests/build/dist-size.test.ts）。
 * 打开以前还要做的三件事（都要动页面，所以没有先做）：
 *   一、给页面用的模块（shipped.ts）现在只带大家共用的那个“点开才要”的文件里的一个字，页面空下来时只会把那一个文件先取来；
 *       一站自己的 …-<站>-more 要各带一个字，src/ui/StopPage.tsx 按站去取。
 *   二、一站自己的头一个文件带着 unicode-range，index.html 里没法预先声明它（index.html 只有一份）：
 *       这一站一打开，它比头两个文件晚到一步，要看一看那一会儿的样子，决定要不要由页面去催。
 *   三、tests/e2e/fonts.spec.ts 里“第三个字体文件什么时候取”那一项是照三个文件写的，要照新的文件重写。
 * 做完这三件，再改成 true、跑 npm run fonts，并把 tests/fonts/font-files.test.ts 里守着这个开关的那一项删掉。
 * 规矩见 docs/data-spec.md“随站的字体·大小”。
 */
export const SPLIT_SONG_BY_STOP = false;

/**
 * 原字体里没有、网站上又非用不可的字：字 → 为什么。这些字不进字体文件，用设备自带的字显示。现在一个也没有。
 * 没有记在这里的字要是原字体里没有，工具会停下来。
 */
export const FALLBACK_OK: Readonly<Record<string, string>> = {};

/**
 * 界面的程序里，字要点了才看得见的那几个文件：“来源”页上的话（读者从链接点进那一页才看得见）。
 * 这几个文件里的字算作“点开才看得见的”：别处不点就看得见的字里没有它的话，它归点开才要的那个宋体文件（yanlu-song-more），
 * 不进每位读者一打开网站就要下载的那一个（yanlu-song）。那一页打开的时候，浏览器照 unicode-range 自己去取那个文件。
 * 列在这里的文件里只许写点了才看得见的字。有一个字其实不点也看得见、别处又没有，它就会让那个页面提前去取那个文件：
 * tests/e2e/fonts.spec.ts（首页、人物页上那个文件不许被取）会发现。
 */
export const PRESSED_SOURCES: readonly string[] = ['src/ui/sourcesText.ts'];

/** 用楷体排的字里不能有的：弯引号在这套楷体里只有三分之一个字宽。 */
export const KAI_FORBIDDEN = '“”‘’';

export type FontSourceId = 'kai' | 'song';

export interface FontSource {
  /** 原字体叫什么、哪一版。 */
  name: string;
  version: string;
  /** 放在 .cache/fonts/ 里的文件名。 */
  file: string;
  /** 从哪里取的。 */
  from: string;
  /** 它的网站（“来源”页上给读者的链接）。 */
  site: string;
  bytes: number;
  sha256: string;
  /** 原字体名称表里的版权声明（第 0 条），裁剪以后要原样留着。 */
  copyright: string;
  /** 许可全文：放在 .cache/fonts/ 和 public/licences/ 里都叫这个名字。 */
  licence: { file: string; sha256: string };
  /** 做出来的文件里写的字体名称。 */
  family: string;
  /** 只留这几种排版功能（原字体里有的才留得下；别的，尤其是把标点挤窄的那几种，不留）。 */
  keepFeatures: string[];
}

export const FONT_SOURCES: Readonly<Record<FontSourceId, FontSource>> = {
  kai: {
    name: 'LXGW WenKai GB Regular',
    version: '1.530',
    file: 'LXGWWenKaiGB-Regular.ttf',
    from: 'https://github.com/lxgw/LxgwWenkaiGB/releases/download/v1.530/LXGWWenKaiGB-Regular.ttf',
    site: 'https://github.com/lxgw/LxgwWenkaiGB',
    bytes: 26_170_696,
    sha256: '5561d48097d92e5ab99fe7b1459d381bbcdff533bfc479207b089c6860c3990e',
    copyright:
      "Copyright 2022-2026 LXGW (https://github.com/lxgw/LxgwWenKaiGB), with Reserved Font Name '霞鹜', '霞鶩', '落霞孤鹜', '落霞孤鶩' and 'LXGW'.\nCopyright 2020 The Klee Project Authors (https://github.com/fontworks-fonts/Klee)",
    licence: { file: 'lxgw-wenkai-gb-OFL.txt', sha256: 'a8aa32c38a3402ba4e40fb6d39c913300dd4a0336290dce5c14e3a2f9308d092' },
    family: 'Yanlu Kai',
    keepFeatures: ['ccmp', 'calt', 'vert'],
  },
  song: {
    name: 'Noto Serif SC Regular',
    version: '2.003',
    file: 'NotoSerifSC-Regular.otf',
    from: 'https://github.com/notofonts/noto-cjk 的 Serif2.003 这一版，Serif/SubsetOTF/SC/NotoSerifSC-Regular.otf',
    site: 'https://github.com/notofonts/noto-cjk',
    bytes: 11_625_800,
    sha256: 'e8f396decc1f0963a016a989c3d8852e863d1350996f573860a80767c83a1cd3',
    copyright: '© 2017-2024 Adobe (http://www.adobe.com/).',
    licence: { file: 'noto-serif-cjk-OFL.txt', sha256: '6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2' },
    family: 'Yanlu Song',
    keepFeatures: ['ccmp', 'locl', 'liga', 'kern', 'mark', 'vert', 'vrt2'],
  },
};

/**
 * 做出来的文件里留没留提示信息（hinting）。宋体留着：去掉能小 16%，但是普通的 Windows 屏幕上小字会不会变糊，
 * 开发用的机器上看不出来（technical-plan.md 第五节）。楷体是 none：霞鹜文楷本来就没有，没什么可留。
 * 这里写的是“应该是什么样”，做出来的文件里是什么样由 hintingOf 从文件里读（fontFileProblems 拿两头比）。
 * 哪天要去掉宋体的：makeFont 里给库加上 noHinting，这里改成 none；只改了一头，工具不肯写，测试也通不过。
 */
export const HINTING: Readonly<Record<FontSourceId, 'kept' | 'none'>> = { kai: 'none', song: 'kept' };

/** 做出来的文件名称表里“说明”那一条（第 10 条）的头一句：从哪个原字体裁剪出来的，不是原字体。 */
export function subsetSentence(source: Pick<FontSource, 'name' | 'version' | 'site'>): string {
  return `Subset of ${source.name} ${source.version} (${source.site}) with only the characters one website uses. Not the original font.`;
}

/** 原字体保留的名字（霞鹜文楷的许可里写的四个中文名和 LXGW；Adobe 发行的思源宋体保留的 Source）。做出来的文件写名称的那几条里不能有。 */
export const RESERVED_WORDS = ['霞鹜', '霞鶩', '落霞孤鹜', '落霞孤鶩', 'LXGW', 'Source'] as const;
/** 名称表里写“这是什么字体”的那几条：这几条里不能有保留的名字（有的话读者的字体菜单里就会出现它）。 */
export const NAMING_IDS = [1, 3, 4, 6, 16, 17, 18] as const;
/** 做出来的文件里，名称表正好是这几条（原字体里没有的那一条就没有）。 */
export const NAME_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 10, 13, 14] as const;

/** 四份许可全文在 public/licences/ 里叫什么。两份字体的见 FONT_SOURCES；两份程序库的在这里。 */
export const LIBRARY_LICENCES: readonly { file: string; from: string[] }[] = [
  // react、react-dom、scheduler 三个库的许可文件是同一份（一个字节不差），放一份
  { file: 'react-LICENSE.txt', from: ['node_modules/react/LICENSE', 'node_modules/react-dom/LICENSE', 'node_modules/scheduler/LICENSE'] },
  { file: 'three-LICENSE.txt', from: ['node_modules/three/LICENSE'] },
];

/** 做字体用到的库：记录里记着做的时候各是哪一版。 */
export const TOOL_PACKAGES = ['subset-font', 'harfbuzzjs', 'fontverter', 'wawoff2'] as const;

export const FONTS_DIR = 'src/fonts';
export const LICENCES_DIR = 'public/licences';
export const CACHE_DIR = '.cache/fonts';

// ================================================================ 二、数字

/** 网站上会显示的字的来处。做字体的工具和测试给的是仓库里真的这些；工具自己的测试给的是编出来的。 */
export interface SiteText {
  /** 界面：src/ 里各个程序文件和 index.html 的原文，路径 → 文字。 */
  sources: Record<string, string>;
  /** 界面上用楷体排的固定的字（src/ui/text.ts 的 KAI_LABELS）。 */
  kaiLabels: readonly string[];
  /** 首页的人物卡片。 */
  cards: FigureCard[];
  figures: SiteFigure[];
}

export interface SiteFigure {
  figure: Figure;
  /** 写好了正文的站，和有沙盘的站。 */
  stops: SiteStop[];
  /** 这位人物的全程沙盘的场景（scenes/route.json）；没有是 null。 */
  route: RouteScene | null;
}

export interface SiteStop {
  id: string;
  /** 这一站读出来的内容（页面拿到的就是它）；还没写是 null。 */
  content: StopContent | null;
  /** 这一站的沙盘的场景；没有沙盘是 null。 */
  scene: StopScene | null;
}

/**
 * 着色器的程序写在这两个文件夹的模板字符串里。它里面“//”到行尾是着色器自己的注释，谁也看不到：数字的时候去掉。
 * 这两个文件夹里出错时的话、印在控制台里的话照旧算（它们不带“//”；带网址的，“:”后面的“//”不算注释）。
 */
export const SHADER_DIRS: readonly string[] = ['src/stage/three/', 'src/stage/ground/'];

/** 这个文件里的模板字符串是不是可能装着着色器的程序。 */
export function holdsShaders(path: string): boolean {
  return SHADER_DIRS.some((dir) => path.startsWith(dir));
}

/**
 * 去掉程序里的注释：“//”到行尾，“/* … *\/”，JSX 里的“{/* … *\/}”。字符串、模板字符串、JSX 里的字都留着。
 * 不认识语法，只是一个字一个字地扫：所以字符串里的“//”不会被当成注释，网址里“:”后面的“//”也不会。
 * shaders：模板字符串里“//”到行尾也去掉（着色器的注释，见 SHADER_DIRS）；单引号、双引号的字符串照旧不动。
 */
export function stripComments(code: string, options: { shaders?: boolean } = {}): string {
  let out = '';
  let i = 0;
  const n = code.length;
  while (i < n) {
    const c = code[i];
    const d = code[i + 1];
    if (c === '/' && d === '/' && code[i - 1] !== ':') {
      while (i < n && code[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      const end = code.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (c === '{' && d === '/' && code[i + 2] === '*') {
      const end = code.indexOf('*/}', i);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n && code[j] !== c) {
        if (code[j] === '\\') j++;
        j++;
      }
      const text = code.slice(i, j + 1);
      out += c === '`' && options.shaders ? text.replace(/(^|[^:])\/\/[^\n`]*/g, '$1') : text;
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** 一段文字里能放进字体的字：去掉文件开头可能有的 U+FEFF 和各种控制字符（换行、制表符）。 */
export function shippable(text: string): string[] {
  return [...text].filter((ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code >= 0x20 && code !== 0x7f && code !== 0xfeff && !(code >= 0x80 && code < 0xa0);
  });
}

/** 按编码的先后连成一串。 */
export function sortedString(chars: Iterable<string>): string {
  return [...new Set(chars)].sort((a, b) => (a.codePointAt(0) ?? 0) - (b.codePointAt(0) ?? 0)).join('');
}

/** 一个字写成“‘䃜’（U+40DC）”里括号中的那一截。 */
export function codeOf(ch: string): string {
  return `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;
}

/** 要做的一个字体文件。 */
export interface PlannedFile {
  /** 文件名，不带 .woff2：yanlu-kai、yanlu-song、yanlu-song-more；按站拆开以后还有 yanlu-song-<站>、yanlu-song-<站>-more。 */
  name: string;
  /** 装的是哪一组字：kai、song、song-more、song-<站>、song-<站>-more。 */
  group: string;
  source: FontSourceId;
  /** 写进文件里的两个名称。 */
  family: string;
  postscript: string;
  /** 样式表里要不要给它写 unicode-range（楷体和头一个宋体文件不写：它们总是要下载的）。 */
  range: boolean;
  /** 装的是不是“不用点开就看得见”的字。 */
  first: boolean;
  /** 只归哪一站（按站拆开以后）；大家共用的是 null。 */
  stop: string | null;
  /** 这一组字，按编码的先后连成一串。 */
  characters: string;
  /** 每个字用在哪：字 → 几个地方的名字（给“哪个字不在字体里”那句话用）。 */
  where: Map<string, string[]>;
}

export interface FontPlan {
  files: PlannedFile[];
  /** 头一组宋体字里只在 src/ 的程序和 index.html 里出现、content/ 里哪儿也没有的字（英文字母、数字、半角符号不算）。 */
  onlyFromSrc: string;
  /** 记在 FALLBACK_OK 里、网站上又真的用到了的字：不进字体。 */
  fallback: string;
}

/** 文件名对应的 PostScript 名称：yanlu-song-more → YanluSongMore-Regular。 */
export function postscriptName(name: string): string {
  return `${name.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')}-Regular`;
}

/**
 * 数出网站上显示的字，分好组，列出要做哪几个文件。
 * splitByStop：宋体要不要按站拆开（不写就照 SPLIT_SONG_BY_STOP）。fallbackOk：不进字体的字（不写就照 FALLBACK_OK）。
 * pressedSources：界面的程序里字要点了才看得见的文件（不写就照 PRESSED_SOURCES）。
 */
export function planFonts(
  site: SiteText,
  options: { splitByStop?: boolean; fallbackOk?: Readonly<Record<string, string>>; pressedSources?: readonly string[] } = {},
): FontPlan {
  const splitByStop = options.splitByStop ?? SPLIT_SONG_BY_STOP;
  const fallbackOk = options.fallbackOk ?? FALLBACK_OK;
  const pressedSources = options.pressedSources ?? PRESSED_SOURCES;

  // 三种篮子：kai；first:<归谁>；more:<归谁>。“归谁”是 common（界面、首页、人物页）或者一站的 id。每个篮子：字 → 用在哪。
  const baskets = new Map<string, Map<string, Set<string>>>();
  const fallbackUsed = new Set<string>();
  const put = (basket: string, label: string, text: string | undefined | null): void => {
    if (text === undefined || text === null) return;
    let map = baskets.get(basket);
    if (!map) baskets.set(basket, (map = new Map()));
    for (const ch of shippable(text)) {
      if (Object.hasOwn(fallbackOk, ch)) {
        fallbackUsed.add(ch);
        continue;
      }
      let labels = map.get(ch);
      if (!labels) map.set(ch, (labels = new Set()));
      labels.add(label);
    }
  };
  /** 不用点开就看得见的。 */
  const first = (home: string, label: string, text: string | undefined | null): void => put(`first:${home}`, label, text);
  /** 点开才看得见的。 */
  const more = (home: string, label: string, text: string | undefined | null): void => put(`more:${home}`, label, text);
  /**
   * 用楷体排的。同一个字在头一组宋体里也放一份：楷体文件还在路上的那一会儿，这些字先用宋体显示，
   * 不能为这个去下载点开才要的那个文件。
   */
  const kai = (home: string, label: string, text: string | undefined | null): void => {
    put('kai', label, text);
    first(home, label, text);
  };

  // ---- 界面：程序里原样写着的每一个字（注释不算），index.html 里的字，英文字母、数字和半角的符号
  for (const [path, text] of Object.entries(site.sources)) {
    const code = path.endsWith('.html') ? text.replace(/<!--[\s\S]*?-->/g, '') : text;
    // 字要点了才看得见的文件（“来源”页上的话）：算作点开才看得见的。着色器的注释不算（见 SHADER_DIRS）
    (pressedSources.includes(path) ? more : first)('common', `程序里（${path}）`, stripComments(code, { shaders: holdsShaders(path) }));
  }
  for (let code = 0x20; code < 0x7f; code++) first('common', '英文字母、数字和半角符号', String.fromCodePoint(code));
  for (const label of site.kaiLabels) kai('common', '界面上用楷体排的字', label);
  for (const label of Object.values(SCENE_CLASS_LABEL)) kai('common', '沙盘上东西的类别名', label);
  put('kai', '空格', ' ');
  // 一行楷体的字放不下、被截掉的时候（沙盘旁边的题记只占一行），浏览器自己在行尾添一个省略号：楷体文件里有它，
  // 这个省略号才是楷体画的。没有的话 Chromium 改画三个半角的句点，用的是设备自带的字体（在浏览器里看过）。
  kai('common', '一行楷体截掉时行尾的省略号', '…');

  // ---- 首页
  for (const card of site.cards) {
    for (const text of [card.name, card.era, card.years, card.tagline]) first('common', '首页的人物卡片', text);
    kai('common', '首页的人物卡片', card.name);
  }

  // ---- 每位人物
  const stopIds: string[] = [];
  for (const { figure, stops, route } of site.figures) {
    const page = `${figure.name}的人物页`;
    for (const text of [figure.name, figure.era, figure.years, figure.tagline, ...figure.intro]) first('common', page, text);
    kai('common', page, figure.name);
    for (const stop of figure.stops) {
      // 目录里的一行；站点页的抬头、底下的上一站和下一站用的也是这几样
      for (const text of [stop.years, stop.age, stop.summary, placeLabel(stop.place)]) first('common', `${page}（各站目录）`, text);
      kai('common', `${page}（各站目录）`, stop.title);
      kai('common', `${page}（各站目录）`, stop.shortTitle);
    }
    if (figure.routeStill) {
      for (const text of [figure.routeStill.note, figure.routeStill.credit]) first('common', `${page}（全程沙盘的图片）`, text);
      kai('common', `${page}（全程沙盘的图片）`, figure.routeStill.caption);
      more('common', `${page}（全程沙盘的图片）`, figure.routeStill.alt);
    }

    // ---- 每一站
    for (const { id, content, scene } of stops) {
      if (!stopIds.includes(id)) stopIds.push(id);
      const stopName = figure.stops.find((stop) => stop.id === id)?.shortTitle ?? id;
      const says = (what: string): string => `${stopName}的${what}`;

      if (content) {
        const cite = new Map(content.sources.map((source) => [source.id, source.cite]));
        const cites = (ids: string[]): string[] => ids.flatMap((sourceId) => cite.get(sourceId) ?? []);
        // 正文：小节标题是楷体，段落和引用是宋体
        for (const section of content.sections) {
          kai(id, says('正文'), section.heading);
          for (const block of section.blocks) {
            for (const text of block.type === 'quote' ? block.lines : block.segments.map((segment) => segment.text)) first(id, says('正文'), text);
          }
        }
        // 小注：点开才有。标题是楷体
        for (const note of content.notes) {
          kai(id, says('小注'), note.title);
          for (const text of [note.title, note.body, ...cites(note.sourceIds)]) more(id, says('小注'), text);
        }
        // 原文：标题印在折着的那一行上，别的点开才有
        for (const original of content.originals) {
          first(id, says('原文'), original.title);
          for (const text of [original.date, original.text, original.plain]) more(id, says('原文'), text);
        }
        // 图片：题记、作者、许可印在图下面；alt 只在图片取不到时才显示
        for (const image of content.images) {
          for (const text of [image.caption, image.credit, image.license]) first(id, says('图片'), text);
          more(id, says('图片'), image.alt);
        }
        // 凭据：点开才有。小节标题是楷体
        for (const group of content.provenance) {
          kai(id, says('凭据'), group.section);
          more(id, says('凭据'), group.section);
          for (const item of group.items) for (const text of [item.what, ...cites(item.sourceIds)]) more(id, says('凭据'), text);
        }
        for (const question of content.sampleQuestions) more(id, says('示例问题'), question);
      }

      if (scene) table(id, says, scene, content?.sources ?? []);
    }

    // ---- 全程沙盘：摆在人物页上（首页也用它），所以它的字归大家共用的那一拨，不归哪一站。出处是场景文件自己的 sources
    if (route) table('common', (what) => `${page}（全程沙盘的${what}）`, route, route.sources);
  }

  /**
   * 一座沙盘（站点沙盘，或者全程沙盘）要显示的字：都是页面生成它们的那几个函数算出来的。
   * home 是这些字归谁（一站的 id，或者 common）；says 给出“用在哪”的叫法。
   * 全程沙盘上站名的题签脚上还有写着站号的印：那几个数字（一到十）是楷体的，列在界面上用楷体排的字里（KAI_LABELS）。
   */
  function table(home: string, says: (what: string) => string, scene: TableScene, sources: Source[]): void {
    // 沙盘旁边的字：小节名和题记是楷体；时间、远处的那句话、一句说明的两种写法是宋体；完整的说明点开才有
    for (const heading of sectionHeadings(scene)) {
      const info = sectionInfo(scene, heading);
      kai(home, says('沙盘'), info.section);
      kai(home, says('沙盘'), info.line);
      for (const text of [info.date, info.note.short, info.note.brief, ...info.far.map((far) => `${far.name}：${far.say}`)]) first(home, says('沙盘'), text);
      for (const line of info.note.lines) more(home, says('“说明”'), line);
      // 题签：古名、今名两种叫法
      for (const names of ['ancient', 'modern'] as const) for (const strip of stripTexts(scene, heading, names)) kai(home, says('题签'), strip.text);
    }
    // 凭据里“沙盘上的东西”一栏：点开才有
    const register = sceneRegister(scene, sources);
    const column = says('“沙盘上的东西”');
    for (const group of register.groups) {
      for (const entry of group.entries) {
        for (const text of [entry.name, entry.basis, ...entry.cites]) more(home, column, text);
        if (entry.unsure) more(home, column, `${entry.name}的${entry.unsure}是示意。`);
      }
    }
    for (const item of register.notDrawn) for (const text of [item.name, item.why, ...item.cites]) more(home, column, text);
    for (const credit of register.credits) more(home, column, credit);
  }

  // ---- 分组
  const basket = (name: string): Map<string, Set<string>> => baskets.get(name) ?? new Map();
  const union = (prefix: string): Set<string> => {
    const set = new Set<string>();
    for (const [name, map] of baskets) if (name.startsWith(prefix)) for (const ch of map.keys()) set.add(ch);
    return set;
  };
  /** 一个字在这几个篮子里用在哪。 */
  const whereOf = (ch: string, names: string[]): string[] => {
    const labels = new Set<string>();
    for (const name of names) for (const label of basket(name).get(ch) ?? []) labels.add(label);
    return [...labels];
  };
  const allFirst = [...baskets.keys()].filter((name) => name.startsWith('first:'));
  const allMore = [...baskets.keys()].filter((name) => name.startsWith('more:'));
  const song = union('first:');
  const songMore = new Set([...union('more:')].filter((ch) => !song.has(ch)));

  // 每个字归哪个文件（宋体）。不拆：看得见的归 song，点开才看得见的归 song-more。
  // 按站拆开：一个字只有一个去处；界面、首页、人物页用到的，和两站以上用到的，归大家共用的文件；只有一站用到的归这一站自己的文件。
  const home = (ch: string): string => {
    if (!splitByStop) return song.has(ch) ? 'song' : 'song-more';
    if (basket('first:common').has(ch)) return 'song';
    const users = stopIds.filter((stop) => basket(`first:${stop}`).has(ch) || basket(`more:${stop}`).has(ch));
    const seenAtOnce = stopIds.some((stop) => basket(`first:${stop}`).has(ch));
    if (users.length >= 2 || (users.length === 1 && basket('more:common').has(ch))) return seenAtOnce ? 'song' : 'song-more';
    if (users.length === 1) return seenAtOnce ? `song-${users[0]}` : `song-${users[0]}-more`;
    return 'song-more';
  };
  const groups = new Map<string, string[]>();
  for (const ch of [...song, ...songMore]) {
    const group = home(ch);
    const list = groups.get(group);
    if (list) list.push(ch);
    else groups.set(group, [ch]);
  }
  // 文件的先后：楷体；song；各站自己的；song-more；各站自己的 -more。样式表里也是这个先后
  const order = ['song', ...stopIds.map((stop) => `song-${stop}`), 'song-more', ...stopIds.map((stop) => `song-${stop}-more`)];

  const fileOf = (group: string, source: FontSourceId, chars: Iterable<string>, baskets: string[]): PlannedFile => {
    const characters = sortedString(chars);
    const name = `yanlu-${group}`;
    const stop = stopIds.find((id) => group === `song-${id}` || group === `song-${id}-more`) ?? null;
    return {
      name,
      group,
      source,
      family: FONT_SOURCES[source].family,
      postscript: postscriptName(name),
      range: group !== 'kai' && group !== 'song',
      first: group === 'kai' || !(group === 'song-more' || group.endsWith('-more')),
      stop,
      characters,
      where: new Map([...characters].map((ch) => [ch, whereOf(ch, baskets)])),
    };
  };
  const files: PlannedFile[] = [fileOf('kai', 'kai', basket('kai').keys(), ['kai'])];
  for (const group of order) {
    const chars = groups.get(group);
    if (!chars && group !== 'song' && group !== 'song-more') continue; // 这一站没有自己独有的字：不做空文件
    files.push(fileOf(group, 'song', chars ?? [], group.endsWith('more') ? [...allFirst, ...allMore] : allFirst));
  }

  // 只在程序里出现、content/ 里哪儿也没有的字（下面这几种来处不算 content/ 里的）
  const NOT_CONTENT = ['英文字母、数字和半角符号', '界面上用楷体排的字', '沙盘上东西的类别名', '一行楷体截掉时行尾的省略号'];
  const fromContent = new Set<string>();
  for (const [name, map] of baskets) {
    if (name === 'kai') continue;
    for (const [ch, labels] of map) if ([...labels].some((label) => !label.startsWith('程序里（') && !NOT_CONTENT.includes(label))) fromContent.add(ch);
  }
  const onlyFromSrc = sortedString([...song].filter((ch) => !fromContent.has(ch) && (ch.codePointAt(0) ?? 0) > 0x7e));

  return { files, onlyFromSrc, fallback: sortedString(fallbackUsed) };
}

/** src/ 里算作“界面”的程序文件：.ts 和 .tsx，不算这三个文件夹（替身和开发用的页面不是给读者看的；src/fonts/ 是工具做的）。 */
export function isInterfaceSource(path: string): boolean {
  return /^src\/.*\.tsx?$/.test(path) && !path.startsWith('src/ui/dev/') && !path.startsWith('src/stage/dev/') && !path.startsWith(`${FONTS_DIR}/`);
}

/** src/ 里所有的 .ts、.tsx 文件（相对项目的根目录，用“/”分隔，按名字排）。 */
export function sourceFiles(): string[] {
  return readdirSync(new URL('src/', ROOT), { recursive: true })
    .map((name) => `src/${name.split('\\').join('/')}`)
    .filter((path) => /\.tsx?$/.test(path))
    .sort();
}

/** 仓库里真的这个网站：界面的程序，首页的卡片，content/ 里的每位人物、每一站（用页面自己读内容的那几个函数读）。 */
export async function readSite(): Promise<SiteText> {
  const sources: Record<string, string> = {};
  for (const path of sourceFiles().filter(isInterfaceSource)) sources[path] = readText(path);
  sources['index.html'] = readText('index.html');

  const figures: SiteFigure[] = [];
  const folders = readdirSync(new URL('content/figures/', ROOT), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const folder of folders) {
    const figure = await loadFigure(folder);
    if (!figure) continue;
    const stops: SiteStop[] = [];
    for (const stop of figure.stops) {
      const content = await loadStop(figure.id, stop.id);
      const table = await loadStopTable(figure.id, stop.id);
      if (content || table) stops.push({ id: stop.id, content, scene: table?.scene ?? null });
    }
    // 全程沙盘的场景文件：页面读它的程序还没有接上（接人物页的那一步），这里直接读文件
    const routePath = `content/figures/${folder}/scenes/${ROUTE_SCENE_ID}.json`;
    const route = existsSync(new URL(routePath, ROOT)) ? (JSON.parse(readText(routePath).replace(/^﻿/, '')) as RouteScene) : null;
    figures.push({ figure, stops, route });
  }
  return { sources, kaiLabels: KAI_LABELS, cards: await loadFigureCards(), figures };
}

// ================================================================ 三、做文件

/** 给一个要做的文件写名称表里的那几条。original 是原字体的各张表（版权、版本、许可那几条照抄它的）。 */
export function nameRecordsFor(file: Pick<PlannedFile, 'source' | 'family' | 'postscript'>, original: FontTables): { nameId: number; text: string }[] {
  const source = FONT_SOURCES[file.source];
  const en = (id: number): string | undefined => englishName(original, id);
  const version = en(5);
  if (!version) throw new Error(`${source.file} 的名称表里没有版本那一条`);
  // 原字体里写“谁做的、谁设计的”那几条不单独留着（那样看起来像是原作者在给这个裁剪过的文件署名），并进说明那一条里
  const sentence = (label: string, text: string | undefined): string | undefined => (text ? `${label}: ${text.replace(/\.$/, '')}.` : undefined);
  const credits = [sentence('Manufacturer', en(8)), sentence('Designer', en(9)), file.source === 'song' ? en(10) : undefined].filter((text): text is string => Boolean(text));
  const records: { nameId: number; text: string | undefined }[] = [
    { nameId: 0, text: en(0) },
    { nameId: 1, text: file.family },
    { nameId: 2, text: 'Regular' },
    { nameId: 3, text: `${file.postscript};${source.version};subset` },
    { nameId: 4, text: file.family },
    { nameId: 5, text: `${version}; subset` },
    { nameId: 6, text: file.postscript },
    { nameId: 7, text: en(7) },
    { nameId: 10, text: [subsetSentence(source), ...credits].join(' ') },
    { nameId: 13, text: en(13) },
    { nameId: 14, text: en(14) },
  ];
  return records.flatMap(({ nameId, text }) => (text === undefined ? [] : [{ nameId, text }]));
}

/** 读一个原字体（.cache/fonts/ 里的），核对字节数和记号。不在、对不上时抛出错误，话里写着该放什么文件、从哪里取。 */
export function readOriginal(id: FontSourceId): Uint8Array {
  const source = FONT_SOURCES[id];
  const path = `${CACHE_DIR}/${source.file}`;
  const how = `把 ${source.file}（${source.name} ${source.version}，${source.bytes} 字节，SHA-256 ${source.sha256}）放到 ${path}。取的地方：${source.from}`;
  if (!existsSync(new URL(path, ROOT))) throw new Error(`做字体要用的原字体不在：${how}`);
  const bytes = readFileSync(new URL(path, ROOT));
  const got = sha256(bytes);
  if (got !== source.sha256) throw new Error(`${path} 不是要的那个文件（SHA-256 是 ${got}）：${how}`);
  return bytes;
}

/**
 * 做一个字体文件：先在原字体里换上新的名称表，再裁剪到只剩这一组字、压成 WOFF2。返回 .woff2 的字节。
 * original 是原字体的字节（readOriginal 给的）。noHinting 只在比大小的时候用。
 */
export async function makeFont(file: PlannedFile, original: Uint8Array, options: { noHinting?: boolean } = {}): Promise<Uint8Array> {
  const source = FONT_SOURCES[file.source];
  const { tables } = readSfnt(original);
  const has = cmapOf(tables);
  const missing = [...file.characters].filter((ch) => !has.has(ch.codePointAt(0) ?? 0));
  if (missing.length > 0) {
    const list = missing.map((ch) => `“${ch}”（${codeOf(ch)}，${(file.where.get(ch) ?? []).slice(0, 3).join('、')}里）`).join('，');
    throw new Error(`${source.name} 里没有这几个字：${list}。把字改掉；实在要用，记进 tests/support/fontTool.ts 的 FALLBACK_OK（它就用设备自带的字显示）。`);
  }
  if (englishName(tables, 0) !== source.copyright) throw new Error(`${source.file} 里的版权声明和 tests/support/fontTool.ts 里记的不一样：换了一版原字体的话，先核对许可，再改 FONT_SOURCES`);
  const renamed = renameSfnt(original, nameRecordsFor(file, tables));
  const wrong = checkSfnt(renamed);
  if (wrong.length > 0) throw new Error(`${file.name}：换了名称表以后的字体不对：${wrong.join('，')}`);
  // 裁剪和压缩都在这一个库里做。它只认 Node 的 Buffer
  const { default: subsetFont } = await import('subset-font');
  return subsetFont(Buffer.from(renamed), file.characters, {
    targetFormat: 'woff2',
    preserveNameIds: [...NAME_IDS],
    keepFeatures: [...source.keepFeatures],
    ...(options.noHinting ? { noHinting: true } : {}),
  });
}

/** 一个字的 unicode-range 写法：U+4E11。 */
const rangeOf = (ch: string): string => `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase()}`;

/** 样式表（fonts.css）的字：每个文件一条 @font-face，不带 unicode-range 的在前。 */
export function fontsCss(files: readonly Pick<PlannedFile, 'name' | 'family' | 'range' | 'characters'>[]): string {
  const rule = (file: (typeof files)[number]): string =>
    [
      '@font-face {',
      `  font-family: '${file.family}';`,
      `  src: url('./${file.name}.woff2') format('woff2');`,
      '  font-weight: 400;',
      '  font-style: normal;',
      '  font-display: swap;',
      ...(file.range ? [`  unicode-range: ${[...file.characters].map(rangeOf).join(', ')};`] : []),
      '}',
    ].join('\n');
  return [
    '/* 工具做的（npm run fonts），不要手改。说明见 docs/data-spec.md“随站的字体”。',
    '   带 unicode-range 的文件，页面上用到它里面的字时浏览器才下载；那一行逐个列着它里面的字。 */',
    ...files.map(rule),
    '',
  ].join('\n');
}

/** 记录里一个字体文件的那一项。 */
export interface FontFileRecord {
  file: string;
  family: string;
  postscript: string;
  source: FontSourceId;
  group: string;
  range: boolean;
  /** 装的是不是“不用点开就看得见”的字（楷体也算）。 */
  first: boolean;
  /** 只归哪一站（宋体按站拆开以后）；大家共用的是 null。 */
  stop: string | null;
  bytes: number;
  sha256: string;
  count: number;
  glyphs: number;
  characters: string;
  onlyFromSrc: string;
  features: string[];
  /** 文件里留没留着提示信息：从做出来的文件里读的（sfnt.ts 的 hintingOf）。 */
  hinting: 'kept' | 'none';
}

/** 记录（fonts.json）。 */
export interface FontRecord {
  tool: number;
  recipe: number;
  made: Record<string, string>;
  /** 两个原字体各一项：FONT_SOURCES 里的那一项，去掉 family（它在每个文件那一项里）。 */
  sources: Record<FontSourceId, Omit<FontSource, 'family'>>;
  files: FontFileRecord[];
}

/** 做字体用到的几个库现在装的是哪一版（读 node_modules 里各自的 package.json）。 */
export function toolVersions(): Record<string, string> {
  return Object.fromEntries(TOOL_PACKAGES.map((name) => [name, (JSON.parse(readText(`node_modules/${name}/package.json`)) as { version: string }).version]));
}

/** 从做好的文件写出记录里的一项。woff2 是做出来的字节。 */
export function fileRecord(file: PlannedFile, woff2: Uint8Array, onlyFromSrc: string): FontFileRecord {
  const { tables } = readWoff2(woff2);
  const characters = charactersOf(tables);
  return {
    file: `${file.name}.woff2`,
    family: file.family,
    postscript: file.postscript,
    source: file.source,
    group: file.group,
    range: file.range,
    first: file.first,
    stop: file.stop,
    bytes: woff2.length,
    sha256: sha256(woff2),
    count: [...characters].length,
    glyphs: glyphCountOf(tables),
    characters,
    onlyFromSrc: sortedString([...onlyFromSrc].filter((ch) => characters.includes(ch))),
    features: [...new Set([...featuresOf(tables, 'GSUB'), ...featuresOf(tables, 'GPOS')])].sort(),
    hinting: hintingOf(tables),
  };
}

/** 记录里一个原字体的那一项：FONT_SOURCES 里现在写的，去掉 family。记录新不新、对不对，都拿它和记录里的逐项比。 */
export function sourceRecord(id: FontSourceId): Omit<FontSource, 'family'> {
  const { family: _family, ...rest } = FONT_SOURCES[id];
  return { ...rest, licence: { ...rest.licence }, keepFeatures: [...rest.keepFeatures] };
}

/** 整份记录。 */
export function fontRecord(files: FontFileRecord[], made: Record<string, string>): FontRecord {
  return { tool: RECORD_VERSION, recipe: RECIPE, made, sources: { kai: sourceRecord('kai'), song: sourceRecord('song') }, files };
}

/** 记录写成文件里的字：缩进两格，行尾是 LF，最后有一个换行。 */
export function recordText(record: FontRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

/** 给页面用的那个模块（shipped.ts）的字。probe 是点开才要的那个宋体文件里的一个字。 */
export function shippedTs(probe: string): string {
  const entry = (id: FontSourceId): string => {
    const source = FONT_SOURCES[id];
    return `  ${id}: { family: '${source.family}', name: '${source.name.replace(/ Regular$/, '')}', version: '${source.version}', site: '${source.site}', licence: 'licences/${source.licence.file}' },`;
  };
  return [
    '// 工具做的（npm run fonts），不要手改。说明见 docs/data-spec.md“随站的字体”。',
    '// 给页面用的几样。页面不引入 fonts.json：那里面记着每一个字，太大。',
    '',
    '/** 随站的两套字体：文件里的名称、原字体叫什么、哪一版、它的网站、许可全文在网站上的地址（相对网站的根）。 */',
    'export const SHIPPED_FONTS = {',
    entry('kai'),
    entry('song'),
    '} as const;',
    '',
    '/** 点开才要的那个宋体文件里的一个字：页面空下来的时候拿它叫浏览器先把那个文件取来。 */',
    `export const SONG_MORE_PROBE = '${probe}';`,
    '',
  ].join('\n');
}

/**
 * 照记录写出来的两样（都用不到原字体）：样式表（fonts.css）和给页面用的模块（shipped.ts）。
 * 做字体的工具写文件时用它；字体文件是新的、这两样却被改坏了的时候，工具也照它重写；测试拿它和仓库里的比。
 */
export function writtenFromRecord(record: FontRecord): { css: string; shipped: string } {
  const more = record.files.find((item) => item.group === 'song-more');
  const probe = [...(more?.characters ?? '')][0];
  if (!probe) throw new Error('点开才看得见的那一组一个字也没有：shipped.ts 里的那一个字没处取。');
  return {
    css: fontsCss(record.files.map((item) => ({ name: item.file.replace(/\.woff2$/, ''), family: item.family, range: item.range, characters: item.characters }))),
    shipped: shippedTs(probe),
  };
}

// ================================================================ 四、读回来

/** 放进仓库的字体：记录，和记录里每个文件读出来的样子。 */
export interface ShippedFonts {
  record: FontRecord;
  files: { record: FontFileRecord; bytes: Uint8Array; tables: FontTables; characters: Set<string> }[];
}

/** 读 src/fonts/ 里的记录和它写的每个字体文件（dir 不写就是 src/fonts）。缺了哪个文件就抛出错误。 */
export function readShipped(dir: string = FONTS_DIR): ShippedFonts {
  const record = JSON.parse(readText(`${dir}/fonts.json`)) as FontRecord;
  return {
    record,
    files: record.files.map((item) => {
      const bytes = readFileSync(new URL(`${dir}/${item.file}`, ROOT));
      const { tables } = readWoff2(bytes);
      return { record: item, bytes, tables, characters: new Set(charactersOf(tables)) };
    }),
  };
}

/**
 * 一个要做的文件里的字，放进仓库的字体里哪几个文件有了才算数：
 *   楷体        只认楷体那个文件；
 *   看得见的     自己那个文件，或者大家共用的头一个宋体文件（它们是一打开就下载的；光在点开才下载的文件里有不算）；
 *   点开才看得见的 同一站的两个文件和大家共用的两个文件里，哪个有都行。
 */
export function servedBy(file: PlannedFile): string[] {
  if (file.group === 'kai') return ['yanlu-kai'];
  const own = file.stop ? [`yanlu-song-${file.stop}`] : [];
  if (file.first) return [...new Set([file.name, ...own, 'yanlu-song'])];
  return [...new Set([file.name, ...own, ...own.map((name) => `${name}-more`), 'yanlu-song', 'yanlu-song-more'])];
}

/** 网站要的字里，放进仓库的字体没有的：每个字一句话。都有是空的。 */
export function missingFromShipped(plan: FontPlan, shipped: ShippedFonts): string[] {
  const problems: string[] = [];
  for (const file of plan.files) {
    const names = servedBy(file);
    const have = shipped.files.filter((item) => names.includes(item.record.file.replace(/\.woff2$/, '')));
    for (const ch of file.characters) {
      if (have.some((item) => item.characters.has(ch))) continue;
      const where = (file.where.get(ch) ?? []).slice(0, 3).join('、');
      problems.push(`“${ch}”（${codeOf(ch)}，${where}里）不在随站的字体里：运行 npm run fonts，再提交。`);
    }
  }
  return problems;
}

/** 放进仓库的字体里带着、网站已经不用的字（每个文件一串）。多带了不算错，太多了提醒一句。 */
export function unusedInShipped(plan: FontPlan, shipped: ShippedFonts): { file: string; characters: string }[] {
  const wanted = new Map(plan.files.map((file) => [`${file.name}.woff2`, new Set(file.characters)]));
  return shipped.files.map((item) => ({ file: item.record.file, characters: sortedString([...item.characters].filter((ch) => !wanted.get(item.record.file)?.has(ch))) }));
}

/** 记录是不是照现在的字、现在的做法做的（是的话不用重做）。说不是的时候给出头一条理由。 */
export function recordIsFresh(plan: FontPlan, record: FontRecord, made: Record<string, string>): { fresh: boolean; why: string } {
  const no = (why: string): { fresh: boolean; why: string } => ({ fresh: false, why });
  if (record.tool !== RECORD_VERSION) return no('记录的格式换了');
  if (record.recipe !== RECIPE) return no('做法改过了');
  if (JSON.stringify(record.made) !== JSON.stringify(made)) return no('裁剪字体的库换了版本');
  for (const id of ['kai', 'song'] as const) {
    if (record.sources[id]?.sha256 !== FONT_SOURCES[id].sha256) return no('原字体换了');
    // 不只比记号：名字、版本、网站写进了文件里的名称表，留哪些排版功能决定文件里有什么；别的几样（从哪里取、许可文件）
    // 记录和给页面用的模块里也写着。改了哪一样都重做，免得“测试说对不上、工具说已经是新的”
    if (JSON.stringify(record.sources[id]) !== JSON.stringify(sourceRecord(id))) return no(`${FONT_SOURCES[id].name} 的说明、许可或者留哪些排版功能改过了（FONT_SOURCES）`);
  }
  if (record.files.map((file) => file.file).join() !== plan.files.map((file) => `${file.name}.woff2`).join()) return no('要做的文件和记录里的不是同一些');
  for (const file of plan.files) {
    const recorded = record.files.find((item) => item.file === `${file.name}.woff2`);
    if (recorded?.characters !== file.characters) {
      const have = new Set(recorded?.characters ?? '');
      const want = new Set(file.characters);
      const added = sortedString([...want].filter((ch) => !have.has(ch)));
      const gone = sortedString([...have].filter((ch) => !want.has(ch)));
      return no(`${file.name} 的字变了${added ? `，多了“${added}”` : ''}${gone ? `，少了“${gone}”` : ''}`);
    }
  }
  return { fresh: true, why: '' };
}

/**
 * 仓库里的字体文件对着记录和现在的做法查一遍（做字体的工具拿它定“要不要重做”）：每个文件都在，记号和记录里的一样，
 * 读出来的名称、提示信息合现在的做法（fontFileProblems）。read 给出一个文件的字节，不在是 null。都对是空的。
 */
export function shippedFileProblems(record: FontRecord, read: (file: string) => Uint8Array | null): string[] {
  const problems: string[] = [];
  for (const item of record.files) {
    const bytes = read(item.file);
    if (!bytes) problems.push(`${item.file} 不在`);
    else if (sha256(bytes) !== item.sha256) problems.push(`${item.file} 和记录对不上（记号不一样）`);
    else problems.push(...fontFileProblems(item, readWoff2(bytes).tables));
  }
  return problems;
}

/**
 * 一个做好的字体文件里不对的地方：名称表（正好是那几条、都是 Windows 英文的、名称是自己的、没有原字体保留的名字、
 * 版权声明和原字体的一样、说明那一条的头一句是现在的写法），楷体另外查竖排用的两张表，留没留提示信息对着做法查。
 * 都对是空的。做字体的工具写文件以前查一遍，定“要不要重做”时查一遍，查放进仓库的文件的测试再查一遍。
 */
export function fontFileProblems(item: Pick<FontFileRecord, 'file' | 'family' | 'postscript' | 'source'>, tables: FontTables): string[] {
  const problems: string[] = [];
  const say = (text: string): void => {
    problems.push(`${item.file}：${text}`);
  };
  const source = FONT_SOURCES[item.source];
  const { names, others } = englishNames(tables);
  if (others > 0) say(`名称表里有 ${others} 条不是 Windows 英文的`);
  for (const id of names.keys()) if (!(NAME_IDS as readonly number[]).includes(id)) say(`名称表里多了第 ${id} 条`);
  const must = (id: number, want: string, what: string): void => {
    if (names.get(id) !== want) say(`名称表第 ${id} 条（${what}）是“${names.get(id) ?? '（没有）'}”，应该是“${want}”`);
  };
  must(0, source.copyright, '版权声明，要和原字体的一样');
  must(1, item.family, '字体名称');
  must(2, 'Regular', '粗细');
  must(3, `${item.postscript};${source.version};subset`, '这个文件自己的标识');
  must(4, item.family, '完整的名称');
  must(6, item.postscript, 'PostScript 名称');
  if (!(names.get(5) ?? '').endsWith('; subset')) say('名称表第 5 条（版本）没有写明是裁剪过的');
  if (!(names.get(10) ?? '').startsWith(subsetSentence(source))) say(`名称表第 10 条（说明）开头不是“${subsetSentence(source)}”`);
  for (const id of [13, 14]) if (!names.get(id)) say(`名称表里没有第 ${id} 条（许可）`);
  for (const id of NAMING_IDS) for (const word of RESERVED_WORDS) if ((names.get(id) ?? '').includes(word)) say(`名称表第 ${id} 条里有原字体保留的名字“${word}”`);
  // 题签和首页卡片上的名字是竖着写的：每个字往下走多少，靠这两张表
  if (item.source === 'kai') for (const tag of ['vhea', 'vmtx']) if (!tables.has(tag)) say(`没有 ${tag} 这张表（竖着写的字靠它定每个字往下走多少）`);
  // 留没留提示信息：读文件自己，对着做法里写的
  const hinting = hintingOf(tables);
  if (hinting !== HINTING[item.source]) say(`文件里${hinting === 'kept' ? '留着' : '没有'}提示信息，做法里写的是${HINTING[item.source] === 'kept' ? '留着' : '不留'}（tests/support/fontTool.ts 的 HINTING）`);
  return problems;
}

/** 名称表里的各条，写成“编号 → 字”，只取 Windows、英文的；另外报告有没有别的平台、别的语言的条目。 */
export function englishNames(tables: FontTables): { names: Map<number, string>; others: number } {
  const all = namesOf(tables);
  const english = all.filter((n) => n.platform === 3 && n.lang === 0x409);
  return { names: new Map(english.map((n) => [n.nameId, n.text])), others: all.length - english.length };
}

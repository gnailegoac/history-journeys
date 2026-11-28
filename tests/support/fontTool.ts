// 随站的字体：哪些字归哪个文件，文件怎么做，做出来的几样长什么样。说明见 docs/data-spec.md“随站的字体”。
// 三个地方用它：做字体的工具（tests/tools/make-fonts.test.ts，npm run fonts）、它自己的测试（同一个文件，随 npm test 跑）、
// 查放进仓库的字体文件的测试（tests/fonts/font-files.test.ts，随 npm test 跑）。只在 Node 里跑；src/ 里的程序不要用。
//
// 分五段（前四段是现在用着的；第五段是另一种分法，写好了，开关关着）：
//   一、做法      用哪三个原字体、留哪些排版功能、名称怎么写。改了其中一样，RECIPE 加一。
//   二、数字      网站上显示哪些字、各归哪一组。不靠人列字表：正文用页面解析正文的那段程序读，沙盘旁边的字、题签、
//                 “沙盘上的东西”一栏用页面生成它们的那几个函数算；界面上的字是 src/ 里的程序原样写着的每一个字。
//   三、做文件    给原字体换名称表、裁剪、压成 WOFF2；样式表、记录、给页面用的那个模块各是什么字。
//   四、读回来    放进仓库的那几个文件读成什么样，网站要的字它们有没有。
//   五、按范围分  字体文件照“一页显示什么”分范围的那一种分法（FONTS_BY_SCOPE，关着）：每一种页面显示哪些字、要做哪些文件、
//                 照清单写的几样、格式 4 的记录；量“挨着别的字会变样的字”、拿做好的文件和原字体比字形（这两样要 HarfBuzz，做文件时才用）。
//                 它的测试在 tests/fonts/font-scopes.test.ts。
//
// 原字体不进仓库：放在 .cache/fonts/（见 README）。第二段和第四段都不用原字体，所以 npm test 在没有原字体的机器上照样跑。

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import type { ItineraryBar, ItinerarySource } from '../../src/domain/itinerary';
import type { RouteScene, StopScene, TableScene } from '../../src/domain/scene';
import { ROUTE_SCENE_ID, SCENE_CLASS_LABEL } from '../../src/domain/scene';
import { loadFigure, loadFigureCards, loadStop } from '../../src/domain/content';
import { loadStopTable } from '../../src/domain/sceneContent';
import { sceneRegister, sectionHeadings, sectionInfo, stripTexts } from '../../src/domain/sceneText';
import { stopMarks } from '../../src/domain/stopMarks';
import type { Figure, FigureCard, Source, StopContent } from '../../src/domain/types';
import type { LabelKind } from '../../src/stage/overlay/types';
import { labelKind } from '../../src/stage/styles';
import { collectSources } from '../../src/ui/sourcesLines';
import { SANS_LABELS, placeLabel } from '../../src/ui/text';
import { SOURCES_SCOPE, scopeFileName, scopeIdProblems, scopeNameClashes } from './fontNames';
import type { FontTables } from './sfnt';
import { charactersOf, checkSfnt, cmapOf, englishName, featuresOf, glyphCountOf, hintingOf, namesOf, readSfnt, readWoff2, renameSfnt, weightOf } from './sfnt';

/** 项目的根目录：这个文件在 tests/support/ 里，往上两层。 */
const ROOT = new URL('../../', import.meta.url);

const utf8 = new TextDecoder();
const readText = (path: string): string => utf8.decode(readFileSync(new URL(path, ROOT)));
export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

// ================================================================ 一、做法

/**
 * 记录（fonts.json）格式的版本。2：每个原字体那一项里多了留哪些排版功能（keepFeatures），每个文件那一项里多了
 * 是不是一打开就要的（first）、只归哪一站（stop），hinting 改成从做出来的文件里读。
 * 3：原字体有三个了（多了黑体）；每个原字体那一项里多了粗细（weight）；每个文件那一项里多了粗细（weight，从做出来的文件里读）、
 * 要不要在 index.html 里预先声明（preload）。
 */
export const RECORD_VERSION = 3;
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
 *   一、给页面用的模块（probe.ts）现在只带大家共用的那个“点开才要”的文件里的一个字，页面空下来时只会把那一个文件先取来；
 *       一站自己的 …-<站>-more 要各带一个字，src/ui/StopPage.tsx 按站去取。
 *   二、一站自己的头一个文件带着 unicode-range，index.html 里没法预先声明它（index.html 只有一份）：
 *       这一站一打开，它比头两个文件晚到一步，要看一看那一会儿的样子，决定要不要由页面去催。
 *   三、tests/e2e/fonts.spec.ts 里“第三个字体文件什么时候取”那一项是照现在的四个文件写的，要照新的文件重写。
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
 * 界面的程序里，字要点了才看得见的那几个文件：“来源”页上的话（读者从链接点进那一页才看得见），
 * 时间轴的“图例”点开的那一块里的几句话。
 * 这几个文件里的字算作“点开才看得见的”：别处不点就看得见的字里没有它的话，它归点开才要的那个宋体文件（yanlu-song-more），
 * 不进每位读者一打开网站就要下载的那一个（yanlu-song）。那一页打开的时候，浏览器照 unicode-range 自己去取那个文件。
 * 列在这里的文件里只许写点了才看得见的字。有一个字其实不点也看得见、别处又没有，它就会让那个页面提前去取那个文件：
 * tests/e2e/fonts.spec.ts（首页、人物页上那个文件不许被取）会发现。
 */
export const PRESSED_SOURCES: readonly string[] = ['src/ui/sourcesText.ts', 'src/timebar/barNoteText.ts'];

/** 用楷体排的字里不能有的：弯引号在这套楷体里只有三分之一个字宽。 */
export const KAI_FORBIDDEN = '“”‘’';

export type FontSourceId = 'kai' | 'song' | 'sans';
/** 三个原字体，照文件的先后：黑体、宋体、楷体。要“每个原字体都过一遍”的地方都照这一张走，不各写各的。 */
export const FONT_SOURCE_IDS: readonly FontSourceId[] = ['sans', 'song', 'kai'];

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
  /** 这套字体的粗细（原字体只有这一种）：样式表里这一套的 @font-face 写的就是它，做出来的文件里读得出同一个数。 */
  weight: number;
  /** 只留这几种排版功能（原字体里有的才留得下；别的，尤其是把标点挤窄的那几种，不留——黑体的 halt 除外，见 SQUEEZE_KEPT）。 */
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
    weight: 400,
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
    weight: 400,
    keepFeatures: ['ccmp', 'locl', 'liga', 'kern', 'mark', 'vert', 'vrt2'],
  },
  // 黑体：标题、标签、按钮、年份用的。只有 500 这一种粗细。不留竖排用的 vert、vrt2（框架里没有竖着写的字）；
  // 留着 halt：标题里全角的冒号、顿号占半个字宽，靠的是它（见 SQUEEZE_KEPT）。
  sans: {
    name: 'Noto Sans SC Medium',
    version: '2.004',
    file: 'NotoSansSC-Medium.otf',
    from: 'https://github.com/notofonts/noto-cjk 的 Sans2.004 这一版，Sans/SubsetOTF/SC/NotoSansSC-Medium.otf',
    site: 'https://github.com/notofonts/noto-cjk',
    bytes: 8_345_436,
    sha256: '7633f5a016d4dd95e685a69633d818aabc4644c4b08e26bd35b1b30c45ed5dda',
    copyright: '© 2014-2021 Adobe (http://www.adobe.com/).',
    licence: { file: 'noto-sans-cjk-OFL.txt', sha256: '6a73f9541c2de74158c0e7cf6b0a58ef774f5a780bf191f2d7ec9cc53efe2bf2' },
    family: 'Yanlu Sans',
    weight: 500,
    keepFeatures: ['ccmp', 'locl', 'liga', 'kern', 'mark', 'halt'],
  },
};

/**
 * 做出来的文件里留没留提示信息（hinting）。宋体留着：去掉能小 16%，但是普通的 Windows 屏幕上小字会不会变糊，
 * 开发用的机器上看不出来（technical-plan.md 第五节）。黑体也留着，道理一样：它排的多是 14、15 像素的小字。
 * 楷体是 none：霞鹜文楷本来就没有，没什么可留。
 * 这里写的是“应该是什么样”，做出来的文件里是什么样由 hintingOf 从文件里读（fontFileProblems 拿两头比）。
 * 哪天要去掉宋体的：makeFont 里给库加上 noHinting，这里改成 none；只改了一头，工具不肯写，测试也通不过。
 */
export const HINTING: Readonly<Record<FontSourceId, 'kept' | 'none'>> = { kai: 'none', song: 'kept', sans: 'kept' };

/** 把标点挤窄的六种排版功能。文件里有了它们，浏览器就能把挨着的全角标点挤到一起。 */
export const SQUEEZE_FEATURES = ['halt', 'vhal', 'chws', 'vchw', 'palt', 'vpal'] as const;
/**
 * 每个原字体许可留、而且一定要留的“挤标点”的功能。楷体和宋体一种也不留：全角的标点个个占满一个字宽。
 * 黑体留 halt 这一种，别的五种不留：标题上写了 font-feature-settings: 'halt' 的地方，全角的冒号、顿号占半个字宽
 *（“徐州：大水围城”冒号后面不空出一大块）；没有写的地方（标签、按钮、年份）不挤，靠的是 html 上的 text-spacing-trim: space-all。
 * 做出来的黑体文件里没有 halt，工具不肯写：少了它什么也不报错，只是标题里冒号后面的空又回来了。
 */
export const SQUEEZE_KEPT: Readonly<Record<FontSourceId, readonly string[]>> = { kai: [], song: [], sans: ['halt'] };

/** 一个做好的文件里“挤标点”的功能哪里不对：该留的没留下，不该有的有了。都对是空的。 */
export function squeezeProblems(item: Pick<FontFileRecord, 'file' | 'source' | 'features'>): string[] {
  const kept = SQUEEZE_KEPT[item.source];
  const problems: string[] = [];
  for (const feature of kept) if (!item.features.includes(feature)) problems.push(`${item.file}：文件里没有 ${feature} 这种排版功能（标题里全角标点占半个字宽靠它；少了它，标题里冒号后面的空又回来了）`);
  for (const feature of SQUEEZE_FEATURES) if (!kept.includes(feature) && item.features.includes(feature)) problems.push(`${item.file}：文件里有把标点挤窄的排版功能 ${feature}`);
  return problems;
}

/**
 * 哪几个文件在 index.html 里预先声明（浏览器不等样式表读完就去取）：按装的是哪一组字说。
 * 是黑体和头一个宋体文件：页面一打开，标题、标签、按钮要黑体，成句的话要宋体。楷体只有沙盘上的题签和印在用，
 * 不预先声明：页面知道要摆沙盘了，才叫浏览器去取（src/ui/StagePane.tsx）。改了这里，index.html 里的两行跟着改（构建以后的测试守着两头一致）。
 */
export const PRELOAD_GROUPS: readonly string[] = ['sans', 'song'];

/** 做出来的文件名称表里“说明”那一条（第 10 条）的头一句：从哪个原字体裁剪出来的，不是原字体。 */
export function subsetSentence(source: Pick<FontSource, 'name' | 'version' | 'site'>): string {
  return `Subset of ${source.name} ${source.version} (${source.site}) with only the characters one website uses. Not the original font.`;
}

/**
 * 原字体保留的名字（霞鹜文楷的许可里写的四个中文名和 LXGW；Adobe 发行的思源宋体保留的 Source；
 * Noto 是 Google 的商标，宋体和黑体的原字体名称表第 7 条里都写着）。做出来的文件写名称的那几条里不能有。
 */
export const RESERVED_WORDS = ['霞鹜', '霞鶩', '落霞孤鹜', '落霞孤鶩', 'LXGW', 'Source', 'Noto'] as const;
/** 名称表里写“这是什么字体”的那几条：这几条里不能有保留的名字（有的话读者的字体菜单里就会出现它）。 */
export const NAMING_IDS = [1, 3, 4, 6, 16, 17, 18] as const;
/** 做出来的文件里，名称表正好是这几条（原字体里没有的那一条就没有）。 */
export const NAME_IDS = [0, 1, 2, 3, 4, 5, 6, 7, 10, 13, 14] as const;

/** 五份许可全文在 public/licences/ 里叫什么。三份字体的见 FONT_SOURCES；两份程序库的在这里。 */
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
  /** 界面上用黑体排的固定的字（src/ui/text.ts 的 SANS_LABELS）。 */
  sansLabels: readonly string[];
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
  /** 这位人物时间轴用的那一份行迹（itinerary.bar.json，页面带的就是它）；没有是 null。 */
  bar: ItineraryBar | null;
  /** 手写的那一份行迹里的出处（itinerary.json 的 sources）：全程沙盘的凭据最后印它们。没有行迹的不写。 */
  itinerarySources?: ItinerarySource[];
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
  /** 文件名，不带 .woff2：yanlu-sans、yanlu-song、yanlu-kai、yanlu-song-more；按站拆开以后还有 yanlu-song-<站>、yanlu-song-<站>-more。 */
  name: string;
  /** 装的是哪一组字：sans、song、kai、song-more、song-<站>、song-<站>-more。 */
  group: string;
  source: FontSourceId;
  /** 写进文件里的两个名称。 */
  family: string;
  postscript: string;
  /** 这套字体的粗细（原字体的那一种）：样式表里这个文件的 @font-face 照它写。 */
  weight: number;
  /** 样式表里要不要给它写 unicode-range（黑体、头一个宋体文件和楷体不写）。 */
  range: boolean;
  /** 装的是不是“不用点开就看得见”的字。 */
  first: boolean;
  /** 要不要在 index.html 里预先声明（见 PRELOAD_GROUPS）。 */
  preload: boolean;
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

/** 文件名对应的 PostScript 名称：yanlu-song-more → YanluSongMore-Regular；粗细是 500 的（黑体）结尾写 Medium：yanlu-sans → YanluSans-Medium。 */
export function postscriptName(name: string, weight = 400): string {
  return `${name.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('')}-${weight === 500 ? 'Medium' : 'Regular'}`;
}

/**
 * 数出网站上显示的字，分好组，列出要做哪几个文件。
 * splitByStop：宋体要不要按站拆开（不写就照 SPLIT_SONG_BY_STOP）。fallbackOk：不进字体的字（不写就照 FALLBACK_OK）。
 * pressedSources：界面的程序里字要点了才看得见的文件（不写就照 PRESSED_SOURCES）。
 * labelKindOf：写着这种样式的沙盘题签是哪一种（不写就照样式的登记表查，src/stage/styles.ts 的 labelKind——页面查的也是它；测试交编出来的）。
 */
export function planFonts(
  site: SiteText,
  options: { splitByStop?: boolean; fallbackOk?: Readonly<Record<string, string>>; pressedSources?: readonly string[]; labelKindOf?: (style: string | undefined) => LabelKind } = {},
): FontPlan {
  const splitByStop = options.splitByStop ?? SPLIT_SONG_BY_STOP;
  const fallbackOk = options.fallbackOk ?? FALLBACK_OK;
  const pressedSources = options.pressedSources ?? PRESSED_SOURCES;
  const labelKindOf = options.labelKindOf ?? ((style: string | undefined): LabelKind => labelKind(style));

  // 四种篮子：sans；kai；first:<归谁>；more:<归谁>。“归谁”是 common（界面、首页、人物页）或者一站的 id。每个篮子：字 → 用在哪。
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
  // 把网站走一遍，每一处的字放进它的篮子（在网站的哪一块上，这里用不着：按范围分文件的那一头才看，见 pageTexts）
  walkSite(site, { pressedSources, labelKindOf }, put);
  // 有正文或者有沙盘的站，照走到的先后
  const stopIds: string[] = [];
  for (const { stops } of site.figures) for (const { id } of stops) if (!stopIds.includes(id)) stopIds.push(id);

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
  // 文件的先后：黑体；song；楷体（这三个不带 unicode-range）；各站自己的；song-more；各站自己的 -more。样式表里也是这个先后
  const ranged = [...stopIds.map((stop) => `song-${stop}`), 'song-more', ...stopIds.map((stop) => `song-${stop}-more`)];
  /** 不带 unicode-range 的三组：页面一用到这套字体，浏览器就取它。 */
  const WHOLE = ['sans', 'song', 'kai'];

  const fileOf = (group: string, source: FontSourceId, chars: Iterable<string>, baskets: string[]): PlannedFile => {
    const characters = sortedString(chars);
    const name = `yanlu-${group}`;
    const stop = stopIds.find((id) => group === `song-${id}` || group === `song-${id}-more`) ?? null;
    return {
      name,
      group,
      source,
      family: FONT_SOURCES[source].family,
      postscript: postscriptName(name, FONT_SOURCES[source].weight),
      weight: FONT_SOURCES[source].weight,
      range: !WHOLE.includes(group),
      first: !(group === 'song-more' || group.endsWith('-more')),
      preload: PRELOAD_GROUPS.includes(group),
      stop,
      characters,
      where: new Map([...characters].map((ch) => [ch, whereOf(ch, baskets)])),
    };
  };
  const songFile = (group: string): PlannedFile => fileOf(group, 'song', groups.get(group) ?? [], group.endsWith('more') ? [...allFirst, ...allMore] : allFirst);
  const files: PlannedFile[] = [fileOf('sans', 'sans', basket('sans').keys(), ['sans']), songFile('song'), fileOf('kai', 'kai', basket('kai').keys(), ['kai'])];
  for (const group of ranged) {
    if (!groups.get(group) && group !== 'song-more') continue; // 这一站没有自己独有的字：不做空文件
    files.push(songFile(group));
  }

  // 只在程序里出现、content/ 里哪儿也没有的字（下面这几种来处不算 content/ 里的）
  const NOT_CONTENT = ['英文字母、数字和半角符号', '界面上用黑体排的字', '沙盘上东西的类别名', '一行黑体截掉时行尾的省略号'];
  const fromContent = new Set<string>();
  for (const [name, map] of baskets) {
    if (name === 'kai' || name === 'sans') continue;
    for (const [ch, labels] of map) if ([...labels].some((label) => !label.startsWith('程序里（') && !NOT_CONTENT.includes(label))) fromContent.add(ch);
  }
  const onlyFromSrc = sortedString([...song].filter((ch) => !fromContent.has(ch) && (ch.codePointAt(0) ?? 0) > 0x7e));

  return { files, onlyFromSrc, fallback: sortedString(fallbackUsed) };
}

/**
 * 一处字在网站的哪一块上。数字的时候每一处都带着它：不拆的时候用不着；按范围分文件的时候（pageTexts），照它把字归到各种页面。
 *   program    src/ 里的一个程序文件，或者 index.html
 *   fixed      不跟着哪个文件的固定的字：英文字母、数字、半角符号，界面上用黑体排的字，沙盘上东西的类别名，空格，省略号
 *   card       首页的一张人物卡片
 *   name       人物的名字：人物页的抬头印它，他每一站的页面上（“位置”那一行、讲解员面板里）也印它
 *   head       人物页抬头里别的几样：朝代、年份、一句话、简介
 *   row        各站目录里的一行（summary 是 true 的是那一句摘要；别的几样——标题、短标题、年份、地点、年纪——站点页的抬头也印）
 *   marks      全程沙盘上站名的题签脚上的印
 *   route      全程沙盘：沙盘旁边的字、题签、“说明”、“沙盘上的东西”
 *   bar        时间轴上跟着日子变的字，和小像旁边立出的名字
 *   itinerary  凭据里行迹的出处
 *   stop       一站自己的：正文、小注、原文、图片、凭据、示例问题，和它自己的沙盘
 */
export type SitePart =
  | { at: 'program'; path: string }
  | { at: 'fixed' }
  | { at: 'card'; card: string }
  | { at: 'name' | 'head' | 'marks' | 'route' | 'bar' | 'itinerary'; figure: string }
  | { at: 'row'; figure: string; stop: string; summary: boolean }
  | { at: 'stop'; figure: string; stop: string };

/**
 * 把网站走一遍：每一处显示的字交给 emit——进哪个篮子（sans；kai；first:<归谁>；more:<归谁>）、用在哪（给人看的叫法）、是什么字、在网站的哪一块上。
 * 用的都是页面自己的函数（见文件开头）。数字的两头——不拆的四个文件（planFonts）和按范围分的文件（pageTexts）——走的是这同一遍。
 */
export function walkSite(
  site: SiteText,
  options: { pressedSources: readonly string[]; labelKindOf: (style: string | undefined) => LabelKind },
  emit: (basket: string, label: string, text: string | undefined | null, part: SitePart) => void,
): void {
  const { pressedSources, labelKindOf } = options;
  /** 现在走到网站的哪一块了。 */
  let part: SitePart = { at: 'fixed' };
  const put = (basket: string, label: string, text: string | undefined | null): void => emit(basket, label, text, part);
  /** 不用点开就看得见的。 */
  const first = (home: string, label: string, text: string | undefined | null): void => put(`first:${home}`, label, text);
  /** 点开才看得见的。 */
  const more = (home: string, label: string, text: string | undefined | null): void => put(`more:${home}`, label, text);
  /**
   * 用楷体排的：只有沙盘上的题签和题签脚上的印。同一个字在头一组宋体里也放一份：楷体文件不预先声明，总比页面晚到，
   * 它还在路上的那一会儿，这些字先用宋体显示，不能为这个去下载点开才要的那个文件。
   */
  const kai = (home: string, label: string, text: string | undefined | null): void => {
    put('kai', label, text);
    first(home, label, text);
  };
  /**
   * 一座沙盘上的题签（连站号的印、小像旁边立出的名字）归哪里，照这座沙盘的题签是哪一种分：
   *   竖着的纸条（strip）用楷体排：进楷体那一组（上面的 kai）；
   *   平着的纸条（slip）用读正文的宋体排，圆点上的数字也是：不进楷体那一组，只归头一组宋体（不用点开就看得见）。
   * 不知道是哪一座沙盘的（scene 没有给）照竖着的纸条。平着的纸条的字要是也放进楷体那一组，楷体的文件就白白大出一截，读苏轼的人也得下载。
   */
  const labelOn = (scene: TableScene | null | undefined): ((home: string, label: string, text: string | undefined | null) => void) => (scene && labelKindOf(scene.style) === 'slip' ? first : kai);
  /**
   * 用黑体排的。同一个字在头一组宋体里也记一份。道理和楷体不一样：楷体的文件还在路上时题签落到随站的宋体上，
   * 黑体的名单（--font-sans）里没有宋体，黑体还在路上时顶着的是设备上的黑体。记这一份的规矩是：黑体的字不管点没点开都归头一组
   * （小注的标题点开才看得见，也在头一组）；现在的内容里这些字本来就都在头一组宋体里，文件没有因此多一个字。
   */
  const sans = (home: string, label: string, text: string | undefined | null): void => {
    put('sans', label, text);
    first(home, label, text);
  };

  // ---- 界面：程序里原样写着的每一个字（注释不算），index.html 里的字，英文字母、数字和半角的符号
  for (const [path, text] of Object.entries(site.sources)) {
    part = { at: 'program', path };
    const code = path.endsWith('.html') ? text.replace(/<!--[\s\S]*?-->/g, '') : text;
    // 字要点了才看得见的文件（“来源”页上的话）：算作点开才看得见的。着色器的注释不算（见 SHADER_DIRS）
    (pressedSources.includes(path) ? more : first)('common', `程序里（${path}）`, stripComments(code, { shaders: holdsShaders(path) }));
  }
  part = { at: 'fixed' };
  for (let code = 0x20; code < 0x7f; code++) first('common', '英文字母、数字和半角符号', String.fromCodePoint(code));
  for (const label of site.sansLabels) sans('common', '界面上用黑体排的字', label);
  for (const label of Object.values(SCENE_CLASS_LABEL)) sans('common', '沙盘上东西的类别名', label);
  put('kai', '空格', ' ');
  put('sans', '空格', ' ');
  // 一行黑体的字放不下、被截掉的时候（现在只有沙盘旁边的时间那一行会截，.stage-date），浏览器自己在行尾添一个省略号：黑体文件里有它，
  // 这个省略号才是黑体画的。没有的话 Chromium 改画三个半角的句点，用的是设备自带的字体（在浏览器里看过）。
  // 题签不截，楷体的文件里不放省略号。
  sans('common', '一行黑体截掉时行尾的省略号', '…');

  // ---- 首页
  for (const card of site.cards) {
    part = { at: 'card', card: card.id };
    for (const text of [card.name, card.era, card.years, card.tagline]) first('common', '首页的人物卡片', text);
    sans('common', '首页的人物卡片', card.name);
    // 朝代和年份那一行是黑体
    for (const text of [card.era, card.years]) sans('common', '首页的人物卡片', text);
  }

  // ---- 每位人物
  for (const { figure, stops, route, bar, itinerarySources } of site.figures) {
    const page = `${figure.name}的人物页`;
    // 名字单记一块：人物页的抬头印它，他每一站的页面上“位置”那一行、讲解员面板里也印它
    part = { at: 'name', figure: figure.id };
    first('common', page, figure.name);
    part = { at: 'head', figure: figure.id };
    for (const text of [figure.era, figure.years, figure.tagline, ...figure.intro]) first('common', page, text);
    part = { at: 'name', figure: figure.id };
    sans('common', page, figure.name);
    part = { at: 'head', figure: figure.id };
    for (const text of [figure.era, figure.years]) sans('common', page, text);
    for (const stop of figure.stops) {
      // 目录里的一行；站点页的抬头、底下的上一站和下一站用的也是这几样（那一句摘要除外：它只印在目录里，单记一块）
      part = { at: 'row', figure: figure.id, stop: stop.id, summary: true };
      first('common', `${page}（各站目录）`, stop.summary);
      part = { at: 'row', figure: figure.id, stop: stop.id, summary: false };
      for (const text of [stop.years, stop.age, placeLabel(stop.place)]) first('common', `${page}（各站目录）`, text);
      sans('common', `${page}（各站目录）`, stop.title);
      sans('common', `${page}（各站目录）`, stop.shortTitle);
      // 目录里每一行的时间、地点、年纪是黑体（站点页抬头里的同样几个字是宋体，所以两套里都有）
      for (const text of [stop.years, stop.age, placeLabel(stop.place)]) sans('common', `${page}（各站目录）`, text);
    }
    // 全程沙盘上站名的题签脚上写着第几站的印（平着的纸条上是名字前头的圆点）：印上的字和题签是同一套字，照页面拼印的那个函数数（网址用不着，给个空的）
    part = { at: 'marks', figure: figure.id };
    if (route) for (const mark of Object.values(stopMarks(figure, () => ''))) labelOn(route)('common', `${page}（全程沙盘的印）`, mark.label);

    // ---- 每一站
    for (const { id, content, scene } of stops) {
      part = { at: 'stop', figure: figure.id, stop: id };
      const stopName = figure.stops.find((stop) => stop.id === id)?.shortTitle ?? id;
      const says = (what: string): string => `${stopName}的${what}`;

      if (content) {
        const cite = new Map(content.sources.map((source) => [source.id, source.cite]));
        const cites = (ids: string[]): string[] => ids.flatMap((sourceId) => cite.get(sourceId) ?? []);
        // 正文：小节标题是黑体，段落和引用是宋体
        for (const section of content.sections) {
          sans(id, says('正文'), section.heading);
          for (const block of section.blocks) {
            for (const text of block.type === 'quote' ? block.lines : block.segments.map((segment) => segment.text)) first(id, says('正文'), text);
          }
        }
        // 小注：点开才有。标题是黑体
        for (const note of content.notes) {
          sans(id, says('小注'), note.title);
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
        // 凭据：点开才有。小节标题是黑体
        for (const group of content.provenance) {
          sans(id, says('凭据'), group.section);
          more(id, says('凭据'), group.section);
          for (const item of group.items) for (const text of [item.what, ...cites(item.sourceIds)]) more(id, says('凭据'), text);
        }
        for (const question of content.sampleQuestions) more(id, says('示例问题'), question);
      }

      // 出处：写好了正文的站在 stops/<站>.json 里；正文还没写的站在场景文件自己的 sources 里（没有这一句，凭据里的书名就不在第三个字体文件里）
      if (scene) table(id, says, scene, content?.sources ?? scene.sources ?? []);
    }

    // ---- 全程沙盘：摆在人物页上（首页也用它），所以它的字归大家共用的那一拨，不归哪一站。出处是场景文件自己的 sources
    part = { at: 'route', figure: figure.id };
    if (route) table('common', (what) => `${page}（全程沙盘的${what}）`, route, route.sources);

    // ---- 行迹：全程沙盘下面那一条时间轴上跟着日子变的字（时间轴摆在人物页和首页上，所以也归大家共用的那一拨）。
    // 第一行是黑体：每一个农历年的年名、每一段的“在哪”、首页上排在最前面的名字（括号和数字是固定的字，在 SANS_LABELS 里）；
    // 第二行的句子是宋体，拖到哪一段就印哪一句，不用点开就看得见；每一段里说不准的，点开时间轴的“图例”才看得见。
    // 他站在线上、沙盘平时没有立名字的一处的时候，旁边立出那一处的名字（有今名的，读者选了“今名”就立今名）：是题签，楷体，
    // 名字照行迹里写的数，不在这里另列
    part = { at: 'bar', figure: figure.id };
    if (bar) {
      const where = `${page}（时间轴）`;
      sans('common', where, bar.name);
      for (const [, name] of bar.years) sans('common', where, name);
      for (const item of [bar.first, bar.last, ...bar.stretches]) {
        sans('common', where, item.label);
        first('common', where, item.says);
      }
      for (const stretch of bar.stretches) more('common', where, stretch.unsure);
      for (const stretch of bar.stretches) for (const name of stretch.spot?.slice(2) ?? []) labelOn(route)('common', `${page}（小像旁边立出的名字）`, name as string);
    }

    // ---- 行迹的出处：全程沙盘的凭据最后的一段（一条出处、读了它的什么），点开才看得见
    part = { at: 'itinerary', figure: figure.id };
    for (const source of itinerarySources ?? []) for (const text of [source.cite, source.read]) more('common', `${page}（凭据里行迹的出处）`, text);
  }

  /**
   * 一座沙盘（站点沙盘，或者全程沙盘）要显示的字：都是页面生成它们的那几个函数算出来的。
   * home 是这些字归谁（一站的 id，或者 common）；says 给出“用在哪”的叫法。
   * 全程沙盘上站名的题签脚上还有写着站号的印：那几个数字是楷体的，在上面“每位人物”那一段里数（照页面拼印的函数）。
   */
  function table(home: string, says: (what: string) => string, scene: TableScene, sources: Source[]): void {
    // 沙盘旁边的字：小节名和时间是黑体；
    // 题记是一句话，和远处的那句话、一句说明的两种写法一样是宋体；完整的说明点开才有
    for (const heading of sectionHeadings(scene)) {
      const info = sectionInfo(scene, heading);
      sans(home, says('沙盘'), info.section);
      sans(home, says('沙盘'), info.date);
      for (const text of [info.line, info.date, info.note.short, info.note.brief, ...info.far.map((far) => `${far.name}：${far.say}`)]) first(home, says('沙盘'), text);
      for (const line of info.note.lines) more(home, says('“说明”'), line);
      // 题签：古名、今名两种叫法。竖着的纸条归楷体那一组，平着的纸条只归头一组宋体（labelOn）
      for (const names of ['ancient', 'modern'] as const) for (const strip of stripTexts(scene, heading, names)) labelOn(scene)(home, says('题签'), strip.text);
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
    // 全程沙盘上的小像（场景文件最外面的 piece）：“记号”一栏里的三句
    if (scene.level === 'route' && scene.piece) for (const text of [scene.piece.name, scene.piece.basis, scene.piece.note]) more(home, column, text);
    // 全程沙盘的凭据开头的几条总的说明（场景文件最外面的 general）：印的是每一条的那段话（id 不印），点开才有
    if (scene.level === 'route') for (const line of scene.general ?? []) more(home, column, line.text);
  }
}

/** src/ 里算作“界面”的程序文件：.ts 和 .tsx，不算这三个文件夹（替身和开发用的页面不是给读者看的；src/fonts/ 是工具做的——那里唯一手写的 scope.ts 里没有给读者看的字）。 */
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
    // 全程沙盘的场景文件：这里直接读文件（页面是经 loadRouteTable 读的，读到的是同一份）
    const routePath = `content/figures/${folder}/scenes/${ROUTE_SCENE_ID}.json`;
    const route = existsSync(new URL(routePath, ROOT)) ? (JSON.parse(readText(routePath).replace(/^﻿/, '')) as RouteScene) : null;
    // 时间轴用的那一份行迹：也直接读文件（时间轴的那一段程序带的是同一份）
    const barPath = `content/figures/${folder}/itinerary.bar.json`;
    const bar = existsSync(new URL(barPath, ROOT)) ? (JSON.parse(readText(barPath).replace(/^﻿/, '')) as ItineraryBar) : null;
    // 手写的那一份行迹里的出处：凭据点开才下载的那一块程序带的是同一个字段
    const handPath = `content/figures/${folder}/itinerary.json`;
    const itinerarySources = existsSync(new URL(handPath, ROOT)) ? (JSON.parse(readText(handPath).replace(/^﻿/, '')) as { sources: ItinerarySource[] }).sources : undefined;
    figures.push({ figure, stops, route, bar, ...(itinerarySources ? { itinerarySources } : {}) });
  }
  return { sources, sansLabels: SANS_LABELS, cards: await loadFigureCards(), figures };
}

// ================================================================ 三、做文件

/** 给一个要做的文件写名称表里的那几条。original 是原字体的各张表（版权、版本、许可那几条照抄它的）。 */
export function nameRecordsFor(file: Pick<PlannedFile, 'source' | 'family' | 'postscript'>, original: FontTables): { nameId: number; text: string }[] {
  const source = FONT_SOURCES[file.source];
  const en = (id: number): string | undefined => englishName(original, id);
  const version = en(5);
  if (!version) throw new Error(`${source.file} 的名称表里没有版本那一条`);
  // 原字体里写“谁做的、谁设计的”那几条不单独留着（那样看起来像是原作者在给这个裁剪过的文件署名），并进说明那一条里；
  // 宋体和黑体的原字体自己的说明（第 10 条）接在后面；楷体的照旧不接
  const sentence = (label: string, text: string | undefined): string | undefined => (text ? `${label}: ${text.replace(/\.$/, '')}.` : undefined);
  const credits = [sentence('Manufacturer', en(8)), sentence('Designer', en(9)), file.source !== 'kai' ? en(10) : undefined].filter((text): text is string => Boolean(text));
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
export async function makeFont(file: Pick<PlannedFile, 'name' | 'source' | 'family' | 'postscript' | 'characters' | 'where'>, original: Uint8Array, options: { noHinting?: boolean } = {}): Promise<Uint8Array> {
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

/** 样式表（fonts.css）的字：每个文件一条 @font-face，不带 unicode-range 的在前；粗细写的是这套字体自己的那一种。 */
export function fontsCss(files: readonly Pick<PlannedFile, 'name' | 'family' | 'weight' | 'range' | 'characters'>[]): string {
  const rule = (file: (typeof files)[number]): string =>
    [
      '@font-face {',
      `  font-family: '${file.family}';`,
      `  src: url('./${file.name}.woff2') format('woff2');`,
      `  font-weight: ${file.weight};`,
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
  /** 装的是不是“不用点开就看得见”的字（黑体、楷体也算）。 */
  first: boolean;
  /** 要不要在 index.html 里预先声明（PRELOAD_GROUPS）。 */
  preload: boolean;
  /** 粗细：从做出来的文件里读的（sfnt.ts 的 weightOf），要和原字体那一项里写的一样。 */
  weight: number;
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
  /** 三个原字体各一项：FONT_SOURCES 里的那一项，去掉 family（它在每个文件那一项里）。 */
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
    preload: file.preload,
    weight: weightOf(tables),
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
  return { tool: RECORD_VERSION, recipe: RECIPE, made, sources: { sans: sourceRecord('sans'), song: sourceRecord('song'), kai: sourceRecord('kai') }, files };
}

/** 记录写成文件里的字：缩进两格，行尾是 LF，最后有一个换行。 */
export function recordText(record: FontRecord): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

/**
 * 给页面用的模块有两个，都是工具写的。这是头一个（shipped.ts）的字：随站的三套字体的那张表，只有“来源”页用，
 * 跟着“来源”页的那一块程序走，不进页面一打开就下载的程序。
 */
export function shippedTs(): string {
  const entry = (id: FontSourceId): string => {
    const source = FONT_SOURCES[id];
    return `  ${id}: { family: '${source.family}', name: '${source.name.replace(/ Regular$/, '')}', version: '${source.version}', site: '${source.site}', licence: 'licences/${source.licence.file}' },`;
  };
  return [
    '// 工具做的（npm run fonts），不要手改。说明见 docs/data-spec.md“随站的字体”。',
    '// 给“来源”页用的一张表。页面不引入 fonts.json：那里面记着每一个字，太大。',
    '// 页面一打开就下载的程序不要引入这个文件（它要的几样在 probe.ts 里）：引入了，这张表就跟着进了那一块程序。',
    '',
    '/** 随站的三套字体：文件里的名称、原字体叫什么、哪一版、它的网站、许可全文在网站上的地址（相对网站的根）。 */',
    'export const SHIPPED_FONTS = {',
    ...FONT_SOURCE_IDS.map(entry),
    '} as const;',
    '',
  ].join('\n');
}

/**
 * 给页面用的第二个模块（probe.ts）的字：页面一打开就下载的程序要的几样，就这么一点。
 * probe 是点开才要的那个宋体文件里的一个字；song、kai 是记录里宋体和楷体的文件写着的字体名称
 * （页面叫浏览器先去取字体的时候要说名称：名称只在记录里写一遍，这里照抄）。
 */
export function probeTs(probe: string, families: { song: string; kai: string }): string {
  return [
    '// 工具做的（npm run fonts），不要手改。说明见 docs/data-spec.md“随站的字体”。',
    '// 页面一打开就下载的程序用的几样，单放在这里：三套字体的那张表（shipped.ts）只有“来源”页用，不跟着进那一块程序。',
    '',
    '/** 写在字体文件里的名称：宋体的，楷体的（题签和印上的字）。页面叫浏览器先去取哪一套字体的时候用。 */',
    `export const SONG_FAMILY = '${families.song}';`,
    `export const KAI_FAMILY = '${families.kai}';`,
    '',
    '/** 点开才要的那个宋体文件里的一个字：页面空下来的时候拿它叫浏览器先把那个文件取来。 */',
    `export const SONG_MORE_PROBE = '${probe}';`,
    '',
  ].join('\n');
}

/** 记录里的一个文件，写样式表要的那几样。粗细照原字体那一项里写的（记录里读回来的那个数要和它一样，测试守着）。 */
export function cssFace(item: Pick<FontFileRecord, 'file' | 'family' | 'source' | 'range' | 'characters'>): Pick<PlannedFile, 'name' | 'family' | 'weight' | 'range' | 'characters'> {
  return { name: item.file.replace(/\.woff2$/, ''), family: item.family, weight: FONT_SOURCES[item.source].weight, range: item.range, characters: item.characters };
}

/**
 * 照记录写出来的三样（都用不到原字体）：样式表（fonts.css）和给页面用的两个模块（shipped.ts、probe.ts）。
 * 做字体的工具写文件时用它；字体文件是新的、这三样却被改坏了的时候，工具也照它重写；测试拿它和仓库里的比。
 */
export function writtenFromRecord(record: FontRecord): { css: string; shipped: string; probe: string } {
  const more = record.files.find((item) => item.group === 'song-more');
  const probe = [...(more?.characters ?? '')][0];
  if (!more || !probe) throw new Error('点开才看得见的那一组一个字也没有：probe.ts 里的那一个字没处取。');
  const kai = record.files.find((item) => item.group === 'kai');
  if (!kai) throw new Error('记录里没有楷体的那个文件：probe.ts 里楷体的名称没处取。');
  return {
    css: fontsCss(record.files.map(cssFace)),
    shipped: shippedTs(),
    probe: probeTs(probe, { song: more.family, kai: kai.family }),
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
 *   黑体        只认黑体那个文件（宋体的文件里有不算：那样这个字在一行黑体里是宋体画的）；
 *   看得见的     自己那个文件，或者大家共用的头一个宋体文件（它们是一打开就下载的；光在点开才下载的文件里有不算）；
 *   点开才看得见的 同一站的两个文件和大家共用的两个文件里，哪个有都行。
 */
export function servedBy(file: PlannedFile): string[] {
  if (file.group === 'kai') return ['yanlu-kai'];
  if (file.group === 'sans') return ['yanlu-sans'];
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
  for (const id of FONT_SOURCE_IDS) {
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
    // 字没变，写在记录里的别的几样变了（最要紧的是“要不要预先声明”：它不改字体文件，只改记录）：也要重写
    const flags = (item: Pick<FontFileRecord, 'family' | 'postscript' | 'source' | 'group' | 'range' | 'first' | 'preload' | 'stop'>): string =>
      JSON.stringify([item.family, item.postscript, item.source, item.group, item.range, item.first, item.preload, item.stop]);
    if (recorded && flags(recorded) !== flags(file)) return no(`${file.name} 的说明变了（名称、归哪一组、带不带 unicode-range、是不是一打开就要、预不预先声明）`);
  }
  return { fresh: true, why: '' };
}

/** 记录里照文件写下来的几样（粗细、排版功能、提示信息、字节数、字数、字形数）：从一个文件的字节里再读一遍。 */
function readFacts(bytes: Uint8Array, tables: FontTables): Record<'weight' | 'features' | 'hinting' | 'bytes' | 'count' | 'glyphs', string | number> {
  return {
    weight: weightOf(tables),
    features: [...new Set([...featuresOf(tables, 'GSUB'), ...featuresOf(tables, 'GPOS')])].sort().join(' '),
    hinting: hintingOf(tables),
    bytes: bytes.length,
    count: [...charactersOf(tables)].length,
    glyphs: glyphCountOf(tables),
  };
}
const FACT_NAMES = { weight: '粗细', features: '排版功能', hinting: '提示信息', bytes: '字节数', count: '字数', glyphs: '字形数' } as const;

/**
 * 仓库里的字体文件对着记录和现在的做法查一遍（做字体的工具拿它定“要不要重做”）：每个文件都在，记号和记录里的一样，
 * 读出来的名称、提示信息合现在的做法（fontFileProblems）；记录里照文件写下来的那几样——粗细、排版功能、提示信息、字节数、
 * 字数、字形数——和文件里再读出来的一样（记录被手改过、合并坏了的时候，文件的记号还对得上，这几样却不对：
 * 不查的话，测试说对不上，工具却说“已经是新的”）。read 给出一个文件的字节，不在是 null。都对是空的。
 */
export function shippedFileProblems(
  record: { files: readonly Pick<FontFileRecord, 'file' | 'family' | 'postscript' | 'source' | 'sha256' | 'weight' | 'features' | 'hinting' | 'bytes' | 'count' | 'glyphs'>[] },
  read: (file: string) => Uint8Array | null,
): string[] {
  const problems: string[] = [];
  for (const item of record.files) {
    const bytes = read(item.file);
    if (!bytes) problems.push(`${item.file} 不在`);
    else if (sha256(bytes) !== item.sha256) problems.push(`${item.file} 和记录对不上（记号不一样）`);
    else {
      const { tables } = readWoff2(bytes);
      problems.push(...fontFileProblems(item, tables));
      const inFile = readFacts(bytes, tables);
      const inRecord = { weight: item.weight, features: [...item.features].join(' '), hinting: item.hinting, bytes: item.bytes, count: item.count, glyphs: item.glyphs };
      for (const key of Object.keys(FACT_NAMES) as (keyof typeof FACT_NAMES)[]) {
        if (inRecord[key] !== inFile[key]) problems.push(`${item.file} 的记录和文件对不上：${FACT_NAMES[key]}记录里写的是 ${inRecord[key] === '' ? '（没有）' : inRecord[key]}，文件里是 ${inFile[key] === '' ? '（没有）' : inFile[key]}`);
      }
    }
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
  // 题签是竖着写的：每个字往下走多少，靠这两张表
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

// ================================================================ 五、按范围分文件（开关关着）
//
// 现在的四个文件是全站共用的：读哪位人物的人，都下载了每一位人物的字。这一段是另一种分法，写好了、有测试，开关关着：
// 字体文件照“一页显示什么”分范围——框架的两个文件（程序自己印的字、每一张卡片），每位人物的（他的人物页不点开就看得见的、
// 点开才看得见的，他的黑体，他的题签用的楷体），他每一站的（有正文或者有自己的沙盘的站：那一站的页面除了框架以外显示的字，整份，
// 别的页面也有的字照样带着），“来源”页的。范围之间不比较：两个范围都用到的字，两个文件里各有一份。
// 开关（FONTS_BY_SCOPE）关着的时候这一段只被测试叫到（tests/fonts/font-scopes.test.ts，随 npm test 跑，不看开关），
// 做字体的工具走的还是上面四段，写的还是那四个文件和格式 3 的记录。

/**
 * 字体文件要不要按范围分。**现在关着**。看这个开关的只有一处：做字体的工具开头的那一处分叉（tests/tools/make-fonts.test.ts）。
 * 关着：工具做的是全站共用的那四个文件，一个字节也不多写。
 * 打开（改成 true，跑 npm run fonts）：工具照 planScopes 做文件，写 fonts.css（每个范围一条换名称的规则）、scopes/ 里点开才要的文件的样式表、
 * scopes.ts、index.html 里先不生效的预先声明、格式 4 的记录。
 * **现在还不能打开**，有两件事没有做完：
 *   一、页面那一头。页面已经在 <html> 上写着自己的范围（src/fonts/scope.ts），样式表里的字体记号也留好了位置
 *       （var(--own-song, …)、var(--own-sans, …)）；还没有做的是按范围去要文件（楷体的名称、点开才要的文件、probe.ts 里给页面的几样），
 *       查放进仓库的字体、查构建结果、浏览器里走一遍的那几份测试也都还是照四个文件写的。
 *   二、“来源”页的那个文件的名称。照现在的拼法它叫 yanlu-song-sources，写进文件里的 PostScript 名称就是 YanluSongSources-Regular，
 *       里面有原字体保留的名字 Source（RESERVED_WORDS）：做文件的时候 fontFileProblems 查得出来，工具不肯写。这一条不能放松；
 *       要先给这个文件另定一个写进文件里的名称（或者另定文件名），再打开。别的十五个文件没有这个毛病。
 * 试做过一回（在仓库外面，把开关打开）：十六个文件，每个做两遍字节都一样，每个字的字形和现在的四个文件里的一样。
 */
export const FONTS_BY_SCOPE: boolean = false;
/** 按范围分了以后记录的格式（多了 pages、home、joiners，每个文件那一项里多了 face、scope、unit、role、sheet）。开关关着的时候记录还是 RECORD_VERSION。 */
export const SCOPE_RECORD_VERSION = 4;
/** 各个范围自己的文件都在这个文件夹里（它在 src/fonts/ 里面）；框架的两个还在 src/fonts/ 这一层。 */
export const SCOPES_DIR = 'scopes';

/**
 * PRESSED_SOURCES 里的每个文件，按范围分的时候它的字归哪里：
 *   sources  “来源”页自己的话：归“来源”页，在那一页上不用点开就看得见；
 *   bar      时间轴的“图例”里的话：归每一位有时间轴的人物，点开才看得见。
 * PRESSED_SOURCES 里的文件都要在这里写明；不在 PRESSED_SOURCES 里的界面文件归框架。
 */
export const PRESSED_SOURCE_SCOPES: Readonly<Record<string, 'sources' | 'bar'>> = { 'src/ui/sourcesText.ts': 'sources', 'src/timebar/barNoteText.ts': 'bar' };

/** 字 → 用在哪几处。 */
export type Uses = Map<string, Set<string>>;

const addUses = (uses: Uses, label: string, chars: Iterable<string>): void => {
  for (const ch of chars) {
    let labels = uses.get(ch);
    if (!labels) uses.set(ch, (labels = new Set()));
    labels.add(label);
  }
};
const mergeUses = (parts: readonly (Uses | undefined)[]): Uses => {
  const out: Uses = new Map();
  for (const part of parts) for (const [ch, labels] of part ?? []) for (const label of labels) addUses(out, label, [ch]);
  return out;
};

/**
 * 页面有这几种：
 *   frame    只有框架的字的页面（没找到人物的那一页）
 *   home     首页：框架的字以外，沙盘栏里摆着头一位可以点进去的人物的全程沙盘和时间轴
 *   figure   一位人物的人物页
 *   unit     有正文或者有自己的沙盘的一站：它有自己的文件
 *   stop     两样都没有的一站：没有自己的文件，用的是这位人物的
 *   sources  “来源”页
 */
export type PageKind = 'frame' | 'home' | 'figure' | 'unit' | 'stop' | 'sources';

/** 一种页面显示的字，四组（和不拆的时候同一条规矩：黑体的字、楷体的字在 rest 里也各记一份）。 */
export interface PageText {
  kind: PageKind;
  /** 是哪位人物的页面（首页：沙盘栏里摆着的那一位）；没有是 null。 */
  figure: string | null;
  /** 是哪一站的页面；不是站点页是 null。 */
  stop: string | null;
  /** 这一页的叫法（给“哪个字不在字体里”那句话用）。 */
  name: string;
  /** 不用点开就看得见的。 */
  rest: Uses;
  /** 点开才看得见的。 */
  pressed: Uses;
  /** 用黑体排的。 */
  sans: Uses;
  /** 用楷体排的（竖着的题签和印）。 */
  kai: Uses;
}

/** 全站的字，按页面分好。 */
export interface SiteTexts {
  /** 框架：程序自己印的字、英文字母数字和半角符号、界面上用黑体排的字、每一张人物卡片。哪一页都带着。 */
  frame: { song: Uses; sans: Uses };
  /** 首页的沙盘栏里摆着哪位人物（头一位可以点进去的）；没有是 null。 */
  home: string | null;
  /** 每一种页面：只有框架的，首页，每位人物的人物页和他的每一站，“来源”页。 */
  pages: PageText[];
  /** 记在 FALLBACK_OK 里、网站上又真的用到了的字。 */
  fallback: string;
}

export interface ScopeOptions {
  fallbackOk?: Readonly<Record<string, string>>;
  pressedSources?: readonly string[];
  pressedScopes?: Readonly<Record<string, 'sources' | 'bar'>>;
  labelKindOf?: (style: string | undefined) => LabelKind;
}

/**
 * 每一种页面显示哪些字。走的是 planFonts 的那同一遍（walkSite），只是照“在网站的哪一块上”把字归到页面：
 *   人物页    抬头，各站目录的每一行，印，全程沙盘，时间轴；点开才有的：全程沙盘的“说明”和“沙盘上的东西”，时间轴上说不准的，
 *             行迹的出处，有时间轴的还有“图例”里的话
 *   首页      他的印、全程沙盘、时间轴（卡片和首页自己的话在框架里）
 *   一站      人物的名字（“位置”那一行印它），它在目录里那一行的几样（标题、短标题、年份、地点、年纪；摘要不印），它的正文和它自己的沙盘；
 *             没有自己的沙盘的，沙盘栏里摆的是全程沙盘：全程沙盘和印整份算进来。黑体那一组另有上一站、下一站的名字
 *   “来源”页  那一页自己的话（sourcesText.ts），和页面收齐两栏的那个函数（src/ui/sourcesLines.ts 的 collectSources）给出的每一行、
 *             每一张图片是哪一站的、题记、作者、许可
 */
export function pageTexts(site: SiteText, options: ScopeOptions = {}): SiteTexts {
  const fallbackOk = options.fallbackOk ?? FALLBACK_OK;
  const pressedSources = options.pressedSources ?? PRESSED_SOURCES;
  const pressedScopes = options.pressedScopes ?? PRESSED_SOURCE_SCOPES;
  const labelKindOf = options.labelKindOf ?? ((style: string | undefined): LabelKind => labelKind(style));
  for (const path of pressedSources) {
    if (!Object.hasOwn(pressedScopes, path)) throw new Error(`${path} 列在 PRESSED_SOURCES 里，按范围分的时候它的字归哪里没有写：在 tests/support/fontTool.ts 的 PRESSED_SOURCE_SCOPES 里写明`);
  }

  // 每一块、每一组各一个篮子：<组>|<块> → 字 → 用在哪。组是 first、more、sans、kai
  const bins = new Map<string, Uses>();
  const fallbackUsed = new Set<string>();
  const keep = (text: string): string[] =>
    shippable(text).filter((ch) => {
      if (!Object.hasOwn(fallbackOk, ch)) return true;
      fallbackUsed.add(ch);
      return false;
    });
  const blockOf = (part: SitePart): string => {
    if (part.at === 'program') return `program|${part.path}`;
    if (part.at === 'fixed') return 'fixed';
    if (part.at === 'card') return 'card';
    if (part.at === 'row') return `row|${part.figure}|${part.stop}|${part.summary ? 'summary' : 'head'}`;
    if (part.at === 'stop') return `stop|${part.figure}|${part.stop}`;
    return `${part.at}|${part.figure}`;
  };
  walkSite(site, { pressedSources, labelKindOf }, (basket, label, text, part) => {
    if (text === undefined || text === null) return;
    const group = basket.startsWith('first:') ? 'first' : basket.startsWith('more:') ? 'more' : basket;
    const key = `${group}|${blockOf(part)}`;
    let uses = bins.get(key);
    if (!uses) bins.set(key, (uses = new Map()));
    addUses(uses, label, keep(text));
  });
  const pick = (group: 'first' | 'more' | 'sans' | 'kai', blocks: readonly string[]): Uses => mergeUses(blocks.map((block) => bins.get(`${group}|${block}`)));
  const programs = (scope: 'sources' | 'bar'): string[] => pressedSources.filter((path) => pressedScopes[path] === scope).map((path) => `program|${path}`);

  const frame = {
    song: pick('first', [...Object.keys(site.sources).filter((path) => !pressedSources.includes(path)).map((path) => `program|${path}`), 'fixed', 'card']),
    sans: pick('sans', ['fixed', 'card']),
  };
  const none = (): Uses => new Map();
  const pages: PageText[] = [{ kind: 'frame', figure: null, stop: null, name: '只有框架的字的页面', rest: mergeUses([frame.song]), pressed: none(), sans: mergeUses([frame.sans]), kai: none() }];

  const homeCard = site.cards.find((card) => card.available);
  const home = (homeCard && site.figures.find((item) => item.figure.id === homeCard.id)?.figure.id) ?? null;
  const figurePages: PageText[] = [];
  // 人物照 id 的先后（给进来的先后不算数：同样的网站，列出来的总是同样的先后）
  for (const { figure, stops, bar } of [...site.figures].sort((a, b) => (a.figure.id < b.figure.id ? -1 : a.figure.id > b.figure.id ? 1 : 0))) {
    const f = figure.id;
    const table = [`marks|${f}`, `route|${f}`, `bar|${f}`];
    const legend = bar ? programs('bar') : [];
    const row = (stop: string): string => `row|${f}|${stop}|head`;
    if (f === home) {
      pages.push({ kind: 'home', figure: f, stop: null, name: '首页', rest: pick('first', table), pressed: pick('more', [`route|${f}`, `bar|${f}`, ...legend]), sans: pick('sans', table), kai: pick('kai', table) });
    }
    figurePages.push({
      kind: 'figure',
      figure: f,
      stop: null,
      name: `${figure.name}的人物页`,
      rest: pick('first', [`name|${f}`, `head|${f}`, ...figure.stops.flatMap((stop) => [`row|${f}|${stop.id}|summary`, row(stop.id)]), ...table]),
      pressed: pick('more', [`route|${f}`, `bar|${f}`, `itinerary|${f}`, ...legend]),
      sans: pick('sans', [`name|${f}`, `head|${f}`, ...figure.stops.map((stop) => row(stop.id)), ...table]),
      kai: pick('kai', table),
    });
    figure.stops.forEach((stop, index) => {
      const own = stops.find((item) => item.id === stop.id);
      const block = `stop|${f}|${stop.id}`;
      // 没有自己的沙盘的一站，沙盘栏里摆的是全程沙盘（连印）：整份算进来。时间轴不在站点页上
      const pane = own?.scene ? [] : [`route|${f}`, `marks|${f}`];
      const neighbours = [figure.stops[index - 1], figure.stops[index + 1]].flatMap((other) => (other ? [row(other.id)] : []));
      figurePages.push({
        kind: own ? 'unit' : 'stop',
        figure: f,
        stop: stop.id,
        name: `${figure.name}的${stop.shortTitle}`,
        rest: pick('first', [`name|${f}`, row(stop.id), block, ...pane]),
        pressed: pick('more', [block, ...(own?.scene ? [] : [`route|${f}`])]),
        sans: pick('sans', [`name|${f}`, row(stop.id), block, ...pane, ...neighbours]),
        kai: pick('kai', [block, ...pane]),
      });
    });
  }
  if (!home) pages.push({ kind: 'home', figure: null, stop: null, name: '首页', rest: none(), pressed: none(), sans: none(), kai: none() });
  pages.push(...figurePages);

  // “来源”页：那一页自己的话，和页面收齐两栏的那个函数给出的东西（给它的是页面读到的那几样：可以点进去的人物，照卡片的先后）
  const found = collectSources(
    site.cards.flatMap((card) => {
      const item = card.available ? site.figures.find((entry) => entry.figure.id === card.id) : undefined;
      if (!item) return [];
      const stops = item.figure.stops.map((stop) => {
        const own = item.stops.find((entry) => entry.id === stop.id);
        return { name: stop.shortTitle, table: own?.scene?.credits ?? null, pictures: stop.status === 'complete' ? (own?.content?.images ?? null) : null };
      });
      return [{ figureId: card.id, name: card.name, route: item.route?.credits ?? null, stops }];
    }),
  );
  const sources: PageText = { kind: 'sources', figure: null, stop: null, name: '“来源”页', rest: pick('more', programs('sources')), pressed: none(), sans: none(), kai: none() };
  for (const table of found.tables) {
    // 每一段的小标题是黑体：卡片上的名字（后面的“的沙盘”是那一页自己的话）
    addUses(sources.sans, `“来源”页（${table.name}的一段的小标题）`, keep(table.name));
    addUses(sources.rest, `“来源”页（${table.name}的一段的小标题）`, keep(table.name));
    for (const line of table.lines) addUses(sources.rest, `“来源”页（${table.name}的沙盘的出处）`, keep(line));
  }
  for (const { stop, picture } of found.pictures) for (const text of [stop, picture.caption, picture.credit, picture.license]) addUses(sources.rest, '“来源”页（图片）', keep(text));
  pages.push(sources);

  return { frame, home, pages, fallback: sortedString(fallbackUsed) };
}

// 各个文件叫什么（scopeFileName）、照 id 可能写出来哪些名字、哪些重了，在 ./fontNames.ts 里（内容校验也用它们）；从这里也给出去。
export { SOURCES_SCOPE, scopeFileName, scopeFileNames, scopeIdProblems, scopeNameClashes } from './fontNames';

/** 一个范围的一套字在样式表里的名称：框架的是文件里写的那个名称（Yanlu Song），别的在后面接上范围和站（Yanlu Song su-shi xuzhou）。 */
export function scopeFace(source: FontSourceId, scope: string, unit: string | null): string {
  return [FONT_SOURCES[source].family, ...(scope === 'frame' ? [] : [scope]), ...(unit === null ? [] : [unit])].join(' ');
}

/** 按范围分的时候要做的一个字体文件。前六样和 PlannedFile 的同名的那几样是一回事（做文件的 makeFont 只看它们）。 */
export interface ScopeFile {
  /** 文件名，不带 .woff2。 */
  name: string;
  source: FontSourceId;
  /** 写进文件里的名称（Yanlu Song、Yanlu Sans、Yanlu Kai：哪个范围的文件都一样）和 PostScript 名称（各是各的）。 */
  family: string;
  postscript: string;
  weight: number;
  characters: string;
  where: Map<string, string[]>;
  /** 样式表里的名称：这个范围自己的（scopeFace）。 */
  face: string;
  /** 归哪个范围：frame，一位人物的 id，或者 sources。 */
  scope: string;
  /** 归哪一站；不归哪一站是 null。 */
  unit: string | null;
  /** rest 不用点开就要的；pressed 点开才要的。 */
  role: 'rest' | 'pressed';
  /** 样式表里带不带 unicode-range：只有点开才要的带。 */
  range: boolean;
  /** 在 index.html 里怎么声明：always 框架的两个，一打开就取；scope 先不生效，地址合得上才取；none 不声明。 */
  preload: 'always' | 'scope' | 'none';
  /** 它的 @font-face 写在哪一份样式表里（相对 src/fonts/）：不用点开就要的都在 fonts.css，点开才要的各在自己范围的那一份。 */
  sheet: string;
}

/** 一种页面拿到哪几个文件。 */
export interface ScopePage {
  kind: PageKind;
  figure: string | null;
  stop: string | null;
  name: string;
  /** 不用点开就要的文件（名字，不带 .woff2），照要的先后：框架的两个，这位人物的黑体，楷体（这一页上有竖着的题签才要），宋体。 */
  rest: string[];
  /** 点开以后才会取的文件。 */
  pressed: string[];
}

export interface ScopePlan {
  files: ScopeFile[];
  pages: ScopePage[];
  home: string | null;
  /** 挨着别的字会变样的字（做文件的时候在原字体里一对一对量出来的）：都放在框架的宋体文件里。 */
  joiners: string;
  fallback: string;
}

/**
 * 照范围列出要做的文件，和每一种页面拿到哪几个。规矩只有这几条，范围之间不比较：
 *   框架的宋体 = 框架的字 + joiners；框架的黑体 = 框架里用黑体排的字。
 *   一个范围不用点开就要的宋体文件 = 用这个范围的页面不点开就显示的字 − 框架的宋体；
 *   点开才要的 = 那些页面点开才显示的字 − 框架的宋体 − 前一个文件。
 *   人物的范围管三种页面：他的人物页，摆着他的全程沙盘的首页，他没有自己的文件的站。一站的范围只管那一站的页面，整份。
 *   人物的黑体 = 他每一种页面上用黑体排的字合起来 − 框架的黑体；人物的楷体 = 他每一种页面上的题签和印合起来，加一个空格（没有题签用楷体的不做）。
 *   空文件不做。先后：框架；人物照 id 的先后；一位人物里先是他自己的（黑体、楷体、宋体两个），再照站的先后是各站的；“来源”页最后。
 * 多大、哪一天做的、谁先谁后来的，都不进这些规矩：同样的网站，列出来的总是同样的文件。
 * 人物和站的 id 原样写进文件名和照清单写的每一样里：有一个 id 带了小写英文字母、数字、连字符以外的字，就停下来（scopeIdProblems）；
 * 拼出来的文件名重了也停下来。
 */
export function planScopes(site: SiteText, options: ScopeOptions & { joiners: string }): ScopePlan {
  const badIds = scopeIdProblems(site.figures.map(({ figure }) => ({ id: figure.id, stops: figure.stops.map((stop) => stop.id) })));
  if (badIds.length > 0) throw new Error(`按范围分的字体文件写不了：${badIds.join('；')}。人物和站的 id 要改。`);
  const texts = pageTexts(site, options);
  const fallbackOk = options.fallbackOk ?? FALLBACK_OK;
  const frameSong = mergeUses([texts.frame.song]);
  const joiners = sortedString(shippable(options.joiners).filter((ch) => !Object.hasOwn(fallbackOk, ch)));
  addUses(frameSong, '挨着别的字会变样的字', joiners);
  const frameSans = texts.frame.sans;

  const files: ScopeFile[] = [];
  const add = (source: FontSourceId, scope: string, unit: string | null, role: 'rest' | 'pressed', uses: Uses, minus: readonly { has(ch: string): boolean }[] = []): string | null => {
    const characters = sortedString([...uses.keys()].filter((ch) => !minus.some((set) => set.has(ch))));
    if (characters === '') return null; // 不做空文件
    const name = scopeFileName(source, scope, unit, role);
    files.push({
      name,
      source,
      family: FONT_SOURCES[source].family,
      postscript: postscriptName(name, FONT_SOURCES[source].weight),
      weight: FONT_SOURCES[source].weight,
      characters,
      where: new Map([...characters].map((ch) => [ch, [...(uses.get(ch) ?? [])]])),
      face: scopeFace(source, scope, unit),
      scope,
      unit,
      role,
      range: role === 'pressed',
      preload: scope === 'frame' ? 'always' : role === 'rest' && source !== 'kai' ? 'scope' : 'none',
      sheet: role === 'rest' ? 'fonts.css' : `${SCOPES_DIR}/${unit === null ? scope : `${scope}.${unit}`}.css`,
    });
    return name;
  };
  const list = (...names: (string | null)[]): string[] => names.filter((name): name is string => name !== null);

  const frameFiles = list(add('sans', 'frame', null, 'rest', frameSans), add('song', 'frame', null, 'rest', frameSong));
  const pages: ScopePage[] = [];
  const page = (text: PageText, rest: (string | null)[], pressed: (string | null)[]): void => {
    pages.push({ kind: text.kind, figure: text.figure, stop: text.stop, name: text.name, rest: [...frameFiles, ...list(...rest)], pressed: list(...pressed) });
  };
  for (const text of texts.pages) if (text.kind === 'frame' || (text.kind === 'home' && text.figure === null)) page(text, [], []);

  const figureIds = [...new Set(texts.pages.flatMap((text) => (text.figure === null ? [] : [text.figure])))].sort();
  for (const f of figureIds) {
    const all = texts.pages.filter((text) => text.figure === f);
    /** 用这位人物自己的文件的页面：他的人物页，摆着他的全程沙盘的首页，他没有自己的文件的站。 */
    const base = all.filter((text) => text.kind !== 'unit');
    const sans = add('sans', f, null, 'rest', mergeUses(all.map((text) => text.sans)), [frameSans]);
    const kaiUses = mergeUses(all.map((text) => text.kai));
    if (kaiUses.size > 0) addUses(kaiUses, '空格', ' ');
    const kai = add('kai', f, null, 'rest', kaiUses);
    const restUses = mergeUses(base.map((text) => text.rest));
    const rest = add('song', f, null, 'rest', restUses, [frameSong]);
    const pressed = add('song', f, null, 'pressed', mergeUses(base.map((text) => text.pressed)), [frameSong, restUses]);
    for (const text of base) page(text, [sans, text.kai.size > 0 ? kai : null, rest], [pressed]);
    for (const text of all.filter((item) => item.kind === 'unit')) {
      const unitRest = add('song', f, text.stop, 'rest', text.rest, [frameSong]);
      const unitPressed = add('song', f, text.stop, 'pressed', text.pressed, [frameSong, text.rest]);
      page(text, [sans, text.kai.size > 0 ? kai : null, unitRest], [unitPressed]);
    }
  }
  for (const text of texts.pages.filter((item) => item.kind === 'sources')) {
    const sans = add('sans', SOURCES_SCOPE, null, 'rest', text.sans, [frameSans]);
    const rest = add('song', SOURCES_SCOPE, null, 'rest', text.rest, [frameSong]);
    const pressed = add('song', SOURCES_SCOPE, null, 'pressed', text.pressed, [frameSong, text.rest]);
    page(text, [sans, rest], [pressed]);
  }
  // 页面照 pageTexts 的先后排回去（上面是照范围的先后做的）
  const order = new Map(texts.pages.map((text, index) => [`${text.kind}|${text.figure}|${text.stop}`, index]));
  pages.sort((a, b) => (order.get(`${a.kind}|${a.figure}|${a.stop}`) ?? 0) - (order.get(`${b.kind}|${b.figure}|${b.stop}`) ?? 0));

  const clashes = scopeNameClashes(files.map((file) => ({ name: file.name, of: file.unit === null ? file.scope : `${file.scope} 的 ${file.unit}` })));
  if (clashes.length > 0) throw new Error(`按范围分的字体文件名重了：${clashes.join('；')}。人物和站的 id 要改（内容校验的规则 0 守着这一条）。`);
  return { files, pages, home: texts.home, joiners, fallback: texts.fallback };
}

/**
 * 每一种页面显示的字，在不在给它的文件里：每个不在的字一句话，都在是空的。范围之间不借：只在别的范围的文件里有的字不算数。
 *   不用点开就看得见的   框架的宋体文件，或者这一页不用点开就要的那个宋体文件；
 *   点开才看得见的       上面两个，或者这一页点开才要的那个；
 *   用黑体排的           框架的黑体文件，或者这位人物（这个范围）的黑体文件；
 *   用楷体排的           这位人物的楷体文件。
 * has 给出一个文件里真有哪些字（不写就照要做的清单算；开关打开以后给放进仓库的文件读出来的）。
 */
export function missingOnPages(texts: SiteTexts, plan: ScopePlan, has: (name: string) => { has(ch: string): boolean } | undefined = (name) => charactersByName(plan).get(name)): string[] {
  const sourceOf = new Map(plan.files.map((file) => [file.name, file.source]));
  const problems: string[] = [];
  for (const text of texts.pages) {
    const given = plan.pages.find((item) => item.kind === text.kind && item.figure === text.figure && item.stop === text.stop);
    if (!given) {
      problems.push(`${text.name}：要做的清单里没有说这一页拿哪几个文件`);
      continue;
    }
    const check = (uses: Uses, source: FontSourceId, names: readonly string[], what: string): void => {
      const from = names.filter((name) => sourceOf.get(name) === source);
      const sets = from.flatMap((name) => has(name) ?? []);
      for (const [ch, labels] of uses) {
        if (sets.some((set) => set.has(ch))) continue;
        problems.push(`“${ch}”（${codeOf(ch)}，${[...labels].slice(0, 3).join('、')}里）是${text.name}上${what}，不在这一页拿到的字体文件里（${from.map((name) => `${name}.woff2`).join('、') || '一个也没有'}）`);
      }
    };
    check(text.rest, 'song', given.rest, '不用点开就看得见的字');
    check(text.pressed, 'song', [...given.rest, ...given.pressed], '点开才看得见的字');
    check(text.sans, 'sans', given.rest, '用黑体排的字');
    check(text.kai, 'kai', given.rest, '用楷体排的字');
  }
  return problems;
}

/**
 * 要做的清单里，写进文件里的两个名称带着原字体保留的名字（RESERVED_WORDS）的文件：每处一句话，都没有是空的。
 * 做出来的文件 fontFileProblems 会再查一遍名称表（那时工具不肯写）；这里照清单查，不用原字体，做文件以前就知道。
 */
export function reservedNameProblems(files: readonly Pick<ScopeFile, 'name' | 'family' | 'postscript'>[]): string[] {
  const problems: string[] = [];
  for (const file of files) {
    for (const [what, written] of [['字体名称', file.family], ['PostScript 名称', file.postscript]] as const) {
      for (const word of RESERVED_WORDS) if (written.includes(word)) problems.push(`${file.name}：${what} ${written} 里有原字体保留的名字“${word}”（写进文件里的名称不许带它）`);
    }
  }
  return problems;
}

/** 要做的清单里每个文件的字：文件名 → 字。 */
export function charactersByName(plan: Pick<ScopePlan, 'files'>): Map<string, Set<string>> {
  return new Map(plan.files.map((file) => [file.name, new Set(file.characters)]));
}

/** 一个文件在 src/fonts/ 里的路径：框架的两个就在那里，别的在 scopes/ 里。 */
export function scopeFilePath(file: Pick<ScopeFile, 'name' | 'scope'>): string {
  return file.scope === 'frame' ? `${file.name}.woff2` : `${SCOPES_DIR}/${file.name}.woff2`;
}

const faceRule = (file: Pick<ScopeFile, 'name' | 'face' | 'weight' | 'range' | 'characters'>, url: string): string =>
  [
    '@font-face {',
    `  font-family: '${file.face}';`,
    `  src: url('${url}') format('woff2');`,
    `  font-weight: ${file.weight};`,
    '  font-style: normal;',
    '  font-display: swap;',
    ...(file.range ? [`  unicode-range: ${[...file.characters].map(rangeOf).join(', ')};`] : []),
    '}',
  ].join('\n');

/** 按范围分的时候各个范围，照文件的先后：每个范围一项，它的黑体、宋体各叫什么名称（没有那一种文件的是 null）。框架不算。 */
function scopesOf(files: readonly Pick<ScopeFile, 'source' | 'face' | 'scope' | 'unit'>[]): { scope: string; unit: string | null; sans: string | null; song: string | null }[] {
  const scopes: { scope: string; unit: string | null; sans: string | null; song: string | null }[] = [];
  for (const file of files) {
    if (file.scope === 'frame' || file.source === 'kai') continue;
    let entry = scopes.find((item) => item.scope === file.scope && item.unit === file.unit);
    if (!entry) scopes.push((entry = { scope: file.scope, unit: file.unit, sans: null, song: null }));
    entry[file.source] = file.face;
  }
  return scopes;
}

/**
 * 按范围分的时候 fonts.css 的字：框架的两条在前；每个范围不用点开就要的文件各一条，名称各是各的，都不带 unicode-range；
 * 最后每个范围一条换名称的规则——页面在 <html> 上写着自己的范围（data-fonts、data-fonts-unit），哪一条合得上，
 * 就把那个范围的名称交给 --own-sans、--own-song（tokens.css 里三个字体记号都在框架的名称后面读它们）。
 * 一站的规则比人物的多一个条件，所以站点页上宋体换成那一站的，黑体还是人物的。楷体不在这里换：人物的那一块记号自己写它的名称。
 */
export function scopeFontsCss(files: readonly ScopeFile[]): string {
  const rest = files.filter((file) => file.role === 'rest');
  const rule = (entry: ReturnType<typeof scopesOf>[number]): string => {
    const selector = `:root[data-fonts='${entry.scope}']${entry.unit === null ? '' : `[data-fonts-unit='${entry.unit}']`}`;
    const sets = [...(entry.sans ? [`--own-sans: '${entry.sans}';`] : []), ...(entry.song ? [`--own-song: '${entry.song}';`] : [])];
    return `${selector} { ${sets.join(' ')} }`;
  };
  return [
    '/* 工具做的（npm run fonts），不要手改。说明见 docs/data-spec.md“随站的字体”。',
    '   框架的两个文件在前；后面是每个范围不用点开就要的文件，名称各是各的，都不带 unicode-range（点开才要的在 scopes/ 里各自的样式表里）；',
    '   最后每个范围一条规则：页面在 <html> 上写着自己的范围，合得上的那一条把这个范围的名称接到框架的后面。 */',
    ...rest.map((file) => faceRule(file, `./${scopeFilePath(file)}`)),
    ...scopesOf(files).map(rule),
    '',
  ].join('\n');
}

/** 点开才要的一个文件的样式表（scopes/ 里，和文件在一起）：一条 @font-face，带着 unicode-range，逐个列着它里面的字。 */
export function pressedSheetCss(file: ScopeFile): string {
  return ['/* 工具做的（npm run fonts），不要手改。这个范围点开才要的字：页面上用到其中的字时浏览器才下载那个文件。 */', faceRule(file, `./${file.name}.woff2`), ''].join('\n');
}

/**
 * scopes.ts 的字：每个范围点开才要的那个文件——它的样式表（用到时才引入，所以这张表自成一小块，不跟着页面一打开就下载的程序长大），
 * 和它里面编码最小的一个字（页面拿它叫浏览器先把那个文件取来）。范围的叫法：人物的 id，一站是“人物/站”。
 */
export function scopesTs(files: readonly ScopeFile[]): string {
  const pressed = files.filter((file) => file.role === 'pressed');
  return [
    '// 工具做的（npm run fonts），不要手改。说明见 docs/data-spec.md“随站的字体”。',
    '// 每个范围点开才要的那个字体文件：它的样式表（用到时才引入），和它里面的一个字（页面拿它叫浏览器先把那个文件取来）。',
    '',
    'export const SCOPE_PRESSED: Record<string, { sheet: () => Promise<unknown>; probe: string }> = {',
    ...pressed.map((file) => `  '${file.unit === null ? file.scope : `${file.scope}/${file.unit}`}': { sheet: () => import('./${file.sheet}'), probe: '${[...file.characters][0]}' },`),
    '};',
    '',
  ].join('\n');
}

/** index.html 里工具写的那一段的头尾两行记号。 */
export const PRELOAD_BLOCK = { start: '<!-- fonts:scopes 起：这一段是工具做的（npm run fonts），不要手改 -->', end: '<!-- fonts:scopes 止 -->' } as const;

/**
 * index.html 里那一段的字：每个范围不用点开就要的黑体、宋体文件各一行预先声明，先不生效（media="not all"），
 * 行上写着它归哪个范围；首页的沙盘栏里摆着的那位人物的几行另有 data-fonts-home。页面开头的那几行脚本照地址把合得上的几行抄一份生效的。
 */
export function preloadBlock(files: readonly ScopeFile[], home: string | null, indent = '    '): string {
  const lines = files
    .filter((file) => file.preload === 'scope')
    .map((file) => `<link rel="preload" href="/${FONTS_DIR}/${scopeFilePath(file)}" as="font" type="font/woff2" crossorigin media="not all" data-fonts="${file.scope}"${file.unit === null ? '' : ` data-fonts-unit="${file.unit}"`}${file.unit === null && file.scope === home ? ' data-fonts-home' : ''} />`);
  return [PRELOAD_BLOCK.start, ...lines, PRELOAD_BLOCK.end].map((line) => `${indent}${line}`).join('\n');
}

/** 把那一段放进 index.html 的原文：已经有的换掉；还没有的，接在最后一行预先声明字体的 <link> 后面。找不到地方就抛出错误。 */
export function withPreloadBlock(html: string, block: string): string {
  const start = html.indexOf(PRELOAD_BLOCK.start);
  const end = html.indexOf(PRELOAD_BLOCK.end);
  if (start >= 0 && end > start) {
    const lineStart = html.lastIndexOf('\n', start) + 1;
    return `${html.slice(0, lineStart)}${block}${html.slice(end + PRELOAD_BLOCK.end.length)}`;
  }
  const links = [...html.matchAll(/^[ \t]*<link rel="preload"[^>]*as="font"[^>]*>[ \t]*$/gm)];
  const last = links[links.length - 1];
  if (!last || last.index === undefined) throw new Error('index.html 里没有预先声明字体的 <link>：那一段不知道接在哪');
  const at = last.index + last[0].length;
  return `${html.slice(0, at)}\n${block}${html.slice(at)}`;
}

/** 格式 4 的记录里一个字体文件的那一项。 */
export interface ScopeFileRecord {
  /** 在 src/fonts/ 里的路径：yanlu-song.woff2，scopes/yanlu-song-su-shi.woff2。 */
  file: string;
  face: string;
  family: string;
  postscript: string;
  source: FontSourceId;
  scope: string;
  unit: string | null;
  role: 'rest' | 'pressed';
  range: boolean;
  preload: 'always' | 'scope' | 'none';
  sheet: string;
  weight: number;
  bytes: number;
  sha256: string;
  count: number;
  glyphs: number;
  characters: string;
  onlyFromSrc: string;
  features: string[];
  hinting: 'kept' | 'none';
}

/** 格式 4 的记录里一种页面的那一项：不用点开就要哪几个文件、点开以后还会取哪几个（都是 file 那一栏的写法）、前一拨合计多少字节。 */
export interface ScopePageRecord {
  kind: Exclude<PageKind, 'stop'>;
  figure: string | null;
  unit: string | null;
  rest: string[];
  pressed: string[];
  bytes: number;
}

/** 格式 4 的记录。 */
export interface ScopeRecord {
  tool: number;
  recipe: number;
  made: Record<string, string>;
  sources: Record<FontSourceId, Omit<FontSource, 'family'>>;
  /** 首页的沙盘栏里摆着哪位人物。 */
  home: string | null;
  /** 挨着别的字会变样的字。 */
  joiners: string;
  pages: ScopePageRecord[];
  files: ScopeFileRecord[];
}

/** 从做好的文件写出格式 4 的记录里的一项。 */
export function scopeFileRecord(file: ScopeFile, woff2: Uint8Array, onlyFromSrc: string): ScopeFileRecord {
  const { tables } = readWoff2(woff2);
  const characters = charactersOf(tables);
  return {
    file: scopeFilePath(file),
    face: file.face,
    family: file.family,
    postscript: file.postscript,
    source: file.source,
    scope: file.scope,
    unit: file.unit,
    role: file.role,
    range: file.range,
    preload: file.preload,
    sheet: file.sheet,
    weight: weightOf(tables),
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

/** 一种页面拿到的文件，从名字换成 file 那一栏的写法（scopeFilePath：只有这一处拼路径）。清单里没有的名字原样接上 .woff2——查大小、写记录的地方认不出它，会说出来。 */
export function scopePagePaths(plan: Pick<ScopePlan, 'files'>, names: readonly string[]): string[] {
  const path = new Map(plan.files.map((file) => [file.name, scopeFilePath(file)]));
  return names.map((name) => path.get(name) ?? `${name}.woff2`);
}

/**
 * 整份格式 4 的记录。没有自己的文件的站不单列（它们用的是人物的那一项）。
 * 一种页面要的文件，files 里没有它的那一项（名字对不上）：不当成 0 字节记下来，停下来说是哪一页、哪个文件。
 */
export function scopeRecord(plan: ScopePlan, files: ScopeFileRecord[], made: Record<string, string>): ScopeRecord {
  const bytes = new Map(files.map((item) => [item.file, item.bytes]));
  const pages = plan.pages.flatMap((page): ScopePageRecord[] => {
    if (page.kind === 'stop') return [];
    const rest = scopePagePaths(plan, page.rest);
    const pressed = scopePagePaths(plan, page.pressed);
    const unknown = [...rest, ...pressed].filter((file) => !bytes.has(file));
    if (unknown.length > 0) throw new Error(`${page.name}要的字体文件 ${unknown.join('、')} 不在做出来的文件里（名字对不上）：它的字节没处算，记录不能这样写`);
    return [{ kind: page.kind, figure: page.figure, unit: page.stop, rest, pressed, bytes: rest.reduce((sum, file) => sum + (bytes.get(file) ?? 0), 0) }];
  });
  return { tool: SCOPE_RECORD_VERSION, recipe: RECIPE, made, sources: { sans: sourceRecord('sans'), song: sourceRecord('song'), kai: sourceRecord('kai') }, home: plan.home, joiners: plan.joiners, pages, files };
}

/** 格式 4 的记录是不是照现在的字、现在的做法做的。说不是的时候给出头一条理由。joiners 不在这里比：它是做文件的时候量的，要做的清单用的就是记录里的那一串。 */
export function scopeRecordIsFresh(plan: ScopePlan, record: ScopeRecord, made: Record<string, string>): { fresh: boolean; why: string } {
  const no = (why: string): { fresh: boolean; why: string } => ({ fresh: false, why });
  if (record.tool !== SCOPE_RECORD_VERSION) return no('记录的格式换了');
  if (record.recipe !== RECIPE) return no('做法改过了');
  if (JSON.stringify(record.made) !== JSON.stringify(made)) return no('裁剪字体的库换了版本');
  for (const id of FONT_SOURCE_IDS) if (JSON.stringify(record.sources[id]) !== JSON.stringify(sourceRecord(id))) return no(`${FONT_SOURCES[id].name} 换了，或者它的说明、许可、留哪些排版功能改过了（FONT_SOURCES）`);
  if (record.files.map((file) => file.file).join() !== plan.files.map(scopeFilePath).join()) return no('要做的文件和记录里的不是同一些');
  for (const file of plan.files) {
    const recorded = record.files.find((item) => item.file === scopeFilePath(file));
    if (recorded?.characters !== file.characters) return no(`${file.name} 的字变了`);
    const flags = (item: Pick<ScopeFileRecord, 'face' | 'family' | 'postscript' | 'source' | 'scope' | 'unit' | 'role' | 'range' | 'preload' | 'sheet'>): string =>
      JSON.stringify([item.face, item.family, item.postscript, item.source, item.scope, item.unit, item.role, item.range, item.preload, item.sheet]);
    if (recorded && flags(recorded) !== flags(file)) return no(`${file.name} 的说明变了（名称、归哪个范围、带不带 unicode-range、怎么声明、样式表）`);
  }
  if (record.home !== plan.home) return no('首页的沙盘栏里摆着的人物换了');
  const pages = scopeRecord(plan, record.files, made).pages;
  if (JSON.stringify(record.pages) !== JSON.stringify(pages)) return no('每一种页面拿哪几个文件变了');
  return { fresh: true, why: '' };
}

/** 照要做的清单写的几样（都用不到原字体）：fonts.css，scopes/ 里点开才要的文件的样式表（路径 → 字），scopes.ts，index.html 里的那一段。 */
export function writtenForScopes(plan: Pick<ScopePlan, 'files' | 'home'>): { css: string; sheets: Record<string, string>; scopes: string; preloads: string } {
  return {
    css: scopeFontsCss(plan.files),
    sheets: Object.fromEntries(plan.files.filter((file) => file.role === 'pressed').map((file) => [file.sheet, pressedSheetCss(file)])),
    scopes: scopesTs(plan.files),
    preloads: preloadBlock(plan.files, plan.home),
  };
}

/** HarfBuzz（裁剪字体的库自己带的那一份）排一串字：每个字形是哪一个、往前走多少、挪了多少。script 是 Hani 或者 Latn。 */
type Shaped = { gid: number; cluster: number; xAdvance: number; yAdvance: number; xOffset: number; yOffset: number }[];
async function shaper(sfnt: Uint8Array): Promise<{ shape: (text: string, script: string) => Shaped; path: (gid: number) => string }> {
  const hb = await import('harfbuzzjs');
  const font = new hb.Font(new hb.Face(new hb.Blob(sfnt)));
  return {
    shape: (text, script) => {
      const buffer = new hb.Buffer();
      buffer.addText(text);
      buffer.guessSegmentProperties();
      buffer.setScript(script);
      buffer.setLanguage('zh-cn');
      hb.shape(font, buffer);
      const infos = buffer.getGlyphInfos();
      const positions = buffer.getGlyphPositions();
      return infos.map((info, index) => ({ gid: info.codepoint, cluster: info.cluster, ...positions[index] }));
    },
    path: (gid) => font.glyphToPath(gid),
  };
}

/** 把一个 WOFF2 还原成普通的字体文件（HarfBuzz 只读这一种）。 */
async function unpackWoff2(woff2: Uint8Array): Promise<Uint8Array> {
  const { default: wawoff2 } = await import('wawoff2');
  return wawoff2.decompress(woff2);
}

/**
 * 挨着别的字会变样的字：把这些字一对一对排一遍（每一对两种先后，汉字的排法和拉丁字母的排法各一遍），
 * 两个字放在一起和各自单放，字形、往前走多少、挪了多少有一样不同，这两个字就都算。
 * font 是装着这些字的一个字体文件（WOFF2，照做随站字体的同一个做法做的：留下的排版功能一样，量到的才是浏览器里会有的）。
 * 这些字要是分在两个文件里，浏览器就把它们分开排，挨着时该有的那一点挪动就没了：所以它们都放进框架的宋体文件，哪一页都在一个文件里。
 */
export async function joinersIn(font: Uint8Array, characters: string): Promise<{ joiners: string; pairs: number; differing: number }> {
  const { shape } = await shaper(await unpackWoff2(font));
  const chars = [...characters];
  const involved = new Set<string>();
  let differing = 0;
  for (const script of ['Hani', 'Latn']) {
    const solo = new Map(chars.map((ch) => [ch, shape(ch, script)]));
    const same = (got: Shaped, alone: Shaped | undefined): boolean =>
      got.length === 1 && alone?.length === 1 && got[0].gid === alone[0].gid && got[0].xAdvance === alone[0].xAdvance && got[0].yAdvance === alone[0].yAdvance && got[0].xOffset === alone[0].xOffset && got[0].yOffset === alone[0].yOffset;
    for (const a of chars) {
      // 一行一对，一次排完这个字打头的每一对；cluster 是这个字形从第几个 UTF-16 单元来的
      const glyphs = shape(chars.map((b) => `${a}${b}\n`).join(''), script);
      const byCluster = new Map<number, Shaped>();
      for (const glyph of glyphs) byCluster.set(glyph.cluster, [...(byCluster.get(glyph.cluster) ?? []), glyph]);
      let offset = 0;
      for (const b of chars) {
        if (!same(byCluster.get(offset) ?? [], solo.get(a)) || !same(byCluster.get(offset + a.length) ?? [], solo.get(b))) {
          differing++;
          involved.add(a);
          involved.add(b);
        }
        offset += a.length + b.length + 1;
      }
    }
  }
  return { joiners: sortedString(involved), pairs: chars.length ** 2 * 2, differing };
}

/**
 * 拿一个字体（against：WOFF2，或者原字体那样的普通字体文件）当样子，给出一个比字形的函数：做好的一个文件（WOFF2）里的每个字，
 * 字形和样子里同一个字的是不是一个样——轮廓一样，往前走的一样。不一样的、样子里没有的，每个字一句话；都一样是空的。
 */
export async function glyphComparer(against: Uint8Array): Promise<(file: string, made: Uint8Array, characters: string) => Promise<string[]>> {
  const unpack = async (bytes: Uint8Array): Promise<Uint8Array> => (bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x32 ? unpackWoff2(bytes) : bytes);
  const theirs = await shaper(await unpack(against));
  return async (file, made, characters) => {
    const mine = await shaper(await unpack(made));
    const problems: string[] = [];
    for (const ch of characters) {
      const [a] = mine.shape(ch, 'Hani');
      const [b] = theirs.shape(ch, 'Hani');
      if (!a || !b || a.gid === 0 || b.gid === 0) problems.push(`${file}：“${ch}”（${codeOf(ch)}）没处比：${!b || b.gid === 0 ? '拿来比的字体里没有这个字' : '做好的文件里没有这个字'}`);
      else if (a.xAdvance !== b.xAdvance || a.yAdvance !== b.yAdvance || mine.path(a.gid) !== theirs.path(b.gid)) problems.push(`${file}：“${ch}”（${codeOf(ch)}）的字形和拿来比的字体里的不一样`);
    }
    return problems;
  };
}

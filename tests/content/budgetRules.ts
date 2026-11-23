// 文件大小的上限：每个数只在这里写一次。校验规则（sceneRules.ts 的规则 16、17、18）、拍定格图的工具、
// 先画好地面的工具、做字体的工具和查字体文件的测试（tests/fonts/font-files.test.ts）、
// 查构建结果有多大的测试（tests/build/dist-size.test.ts）都从这里取，不各记一遍。
// 一个画面的三角形数、画几批这两个上限不是文件大小，写在 tests/stage/support/budgets.ts。
//
// 照这些数查大小的函数也在这里。全是算数：不读磁盘，不压缩，不依赖测试框架；
// 文件多大、压缩以后多大，由调用的人量好了给进来。
//
// 一条规矩处处一样：正好等于上限算合格，超过才算不合格。

// ---------------------------------------------------------------- 内容里的文件

/** 一张定格图最大多少字节：300 KB。人物页的那一张（规则 16）和每一小节的（规则 18）都是这个数。 */
export const STILL_MAX_BYTES = 300 * 1024;

/** 一座沙盘的文件（地形文件、先画好的颜色、田的标记）加起来最大多少字节：1.5 MB。 */
export const TABLE_FILES_MAX_BYTES = 1536 * 1024;
/** 一座沙盘的文件加起来过了上限的这么多成，提醒一句（还算合格）。 */
export const TABLE_FILES_WARN_SHARE = 0.8;

/** 图片（先画好的地面、定格图）和沙盘程序现做的贴图，宽和高最大多少像素。 */
export const PICTURE_EDGE_MAX = 2048;

/** 先画好的颜色压成 JPEG 以后，和原来比的清晰度（psnr，分贝）最低多少。 */
export const COLOUR_PSNR_MIN = 40;
/**
 * 全程沙盘的那一张另有一个数。它有三百多万个点，山上是两个点宽的细纹：要到 40 分贝，文件得有 1.5 MB 上下，一座沙盘的文件就放不下了。
 * 所以定在“浏览器照定下的质量压出来的清晰度，再低一分贝”：质量 0.90 时量到 37.05 分贝
 *（实测的数写在 tests/tools/bake-ground.test.ts 的 JPEG_QUALITY_ROUTE 上面）。
 */
export const COLOUR_PSNR_MIN_ROUTE = 36;

// ---------------------------------------------------------------- 随站的字体

/**
 * 首次打开网站要下载的字体（楷体和头一个宋体文件；宋体按站拆开以后，再加上这一站自己的那个）合计最大多少字节：450 KB。
 * 字体的大小都按放进仓库的 .woff2 文件自己的字节数算（它本身就是压缩过的），不另外压。
 */
export const FONT_FIRST_MAX_BYTES = 450 * 1024;
/** 任何一个字体文件最大多少字节：300 KB。 */
export const FONT_FILE_MAX_BYTES = 300 * 1024;
/** 一个字体文件过了这么多字节，提醒一句（还算合格）：280 KB。到了这条线，就把宋体按站拆开，不抬上限。 */
export const FONT_FILE_WARN_BYTES = 280 * 1024;

// ---------------------------------------------------------------- 程序自己的下载量

/** 沙盘程序（摆立体的沙盘时才下载的那几块）压缩以后最大多少字节；过了多少提醒一句。 */
export const ENGINE_GZIP_MAX = 230_000;
export const ENGINE_GZIP_WARN = 215_000;
/**
 * 页面的程序（一打开就下载的那几块）压缩以后最大多少字节；过了多少提醒一句。
 * 上限原来是 95,000。2026-11-23 加“从全程沙盘潜到一站自己的沙盘”时量到 95,340 字节，照事先定的规矩挪到
 * “量到的数加 1,500、往上取到整五百”，就是 97,000（缘故和量到的数在 docs/technical-plan.md 第七节）。
 */
export const PAGE_GZIP_MAX = 97_000;
export const PAGE_GZIP_WARN = 90_000;
/** 样式表压缩以后最大多少字节；过了多少提醒一句。 */
export const STYLE_GZIP_MAX = 15_000;
// 提醒的线原来是 10,000。随站的字体里，点开才下载的那个文件有哪些字要逐个列在样式表里（每个字压缩以后约三个字节），
// 字越写越多，这一截跟着长：线挪到 13,000，免得每次都提醒。上限没有动。
export const STYLE_GZIP_WARN = 13_000;
/** 整个 dist/ 最大多少字节：900 MB（发布的地方最多放 1 GB）；过了 500 MB 提醒一句。 */
export const DIST_MAX_BYTES = 900 * 1024 * 1024;
export const DIST_WARN_BYTES = 500 * 1024 * 1024;

/** 构建清单里，页面的入口和沙盘程序各叫什么（清单的键是源文件的路径）。 */
export const PAGE_ENTRY = 'index.html';
export const ENGINE_ENTRY = 'src/stage/three/engine.ts';
/**
 * 全程沙盘才用的那一块程序在清单里叫什么。摆全程沙盘时才用动态 import 取它（src/stage/index.ts），所以它不在沙盘程序静态引入的东西里；
 * 不另算的话，全程沙盘的程序就挪到了哪一条上限都看不见的地方。
 */
export const ROUTE_ENTRY = 'src/stage/three/routeLevel.ts';
/** 沙盘用到的文件（地形文件、先画好的地面、定格图）的网址那一块在清单里叫什么。它要用到时才下载，不能进页面那一块。 */
export const FILE_URLS_ENTRY = 'src/domain/sceneFileUrls.ts';

// ---------------------------------------------------------------- 一个数查下来怎么样

/** ok 合格；warn 合格，但是快到上限了；fail 超了。 */
export type Verdict = 'ok' | 'warn' | 'fail';

/** 一个数对着上限查：超过 max 是 fail，没超但是过了 warnAbove 是 warn。正好等于 max 算合格。 */
export function verdict(value: number, max: number, warnAbove: number = max): Verdict {
  if (value > max) return 'fail';
  return value > warnAbove ? 'warn' : 'ok';
}

/** 字节数写成“多少 KB”（往上取整：301 KB 就是超了 300 KB）。 */
export function kilobytes(bytes: number): string {
  return `${Math.ceil(bytes / 1024)} KB`;
}

/** 字节数写成“多少 MB”，两位小数。 */
export function megabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** 整数加上千位的逗号。 */
export function withCommas(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ---------------------------------------------------------------- 定格图、图片的边长、一座沙盘的文件

/** 一张定格图是不是太大了（超过 300 KB）。 */
export function stillTooBig(bytes: number): boolean {
  return bytes > STILL_MAX_BYTES;
}

/** 一张图片的宽或高是不是超过了 2048 像素。 */
export function edgeTooLong(width: number, height: number): boolean {
  return width > PICTURE_EDGE_MAX || height > PICTURE_EDGE_MAX;
}

/** 颜色那张图压得是不是太狠了（清晰度不到最低的数；不写是站点沙盘的 40 分贝，全程沙盘写 COLOUR_PSNR_MIN_ROUTE）。 */
export function psnrTooLow(psnr: number, min: number = COLOUR_PSNR_MIN): boolean {
  return psnr < min;
}

/** 一座沙盘的三个文件加起来多大，超没超 1.5 MB（过了八成是 warn）。 */
export function tableFiles(bytes: { terrain: number; colour: number; fields: number }): { total: number; verdict: Verdict } {
  const total = bytes.terrain + bytes.colour + bytes.fields;
  return { total, verdict: verdict(total, TABLE_FILES_MAX_BYTES, TABLE_FILES_MAX_BYTES * TABLE_FILES_WARN_SHARE) };
}

// ---------------------------------------------------------------- 随站的字体

/**
 * 一个字体文件：叫什么，多少字节，是不是不用点开就要的（first），只归哪一站（stop：宋体按站拆开以后才有；
 * 大家共用的不写，或者写 null）。
 */
export interface FontFileSize {
  file: string;
  bytes: number;
  first: boolean;
  stop?: string | null;
}

/**
 * 字体文件对着上限查一遍：每个文件一行，再加首次打开要下载的合计和全部合计（全部合计没有上限，只是印出来）。
 * 首次打开要下载的：first 是 true、大家共用的那几个（楷体和头一个宋体文件）。宋体按站拆开以后，打开一站还要这一站
 * 自己的那一个（first 是 true、stop 是这一站）；一位读者一次只打开一站，所以按站分开算，取最大的那一站——
 * 不是把各站自己的文件都加在一起（那样站越多越大，其实没有谁要下载那么多）。
 */
export function fontReport(files: FontFileSize[]): SizeReport {
  const report: SizeReport = { lines: [], fails: [], warns: [] };
  for (const { file, bytes } of files) {
    const share = Math.round((bytes / FONT_FILE_MAX_BYTES) * 100);
    report.lines.push(`${file}：${withCommas(bytes)} 字节，上限 ${withCommas(FONT_FILE_MAX_BYTES)}（用了 ${share}%）`);
    const result = verdict(bytes, FONT_FILE_MAX_BYTES, FONT_FILE_WARN_BYTES);
    if (result === 'fail') report.fails.push(`字体文件 ${file} 有 ${withCommas(bytes)} 字节，超过了上限 ${withCommas(FONT_FILE_MAX_BYTES)}`);
    if (result === 'warn') report.warns.push(`字体文件 ${file} 有 ${withCommas(bytes)} 字节，快到上限 ${withCommas(FONT_FILE_MAX_BYTES)} 了（过了 ${withCommas(FONT_FILE_WARN_BYTES)} 就提醒）：该把宋体按站拆开了（打开以前还要做什么，写在 tests/support/fontTool.ts 的 SPLIT_SONG_BY_STOP 上面）`);
  }
  const bytesOf = (list: FontFileSize[]): number => list.reduce((sum, item) => sum + item.bytes, 0);
  const common = files.filter((item) => item.first && !item.stop);
  // 各站自己的、不用点开就要的文件，按站合起来，取最大的一站（一样大时取先碰到的）
  const byStop = new Map<string, FontFileSize[]>();
  for (const item of files) if (item.first && item.stop) byStop.set(item.stop, [...(byStop.get(item.stop) ?? []), item]);
  let largest: { stop: string; files: FontFileSize[]; bytes: number } | null = null;
  for (const [stop, own] of byStop) if (!largest || bytesOf(own) > largest.bytes) largest = { stop, files: own, bytes: bytesOf(own) };
  const firstBytes = bytesOf(common) + (largest?.bytes ?? 0);
  const firstShare = Math.round((firstBytes / FONT_FIRST_MAX_BYTES) * 100);
  const firstNames = common.map((item) => item.file).join('、') + (largest ? `，加上自己的文件最大的一站（${largest.stop}）的 ${largest.files.map((item) => item.file).join('、')}` : '');
  report.lines.push(`首次打开要下载的字体（${firstNames}）：${withCommas(firstBytes)} 字节，上限 ${withCommas(FONT_FIRST_MAX_BYTES)}（用了 ${firstShare}%）`);
  if (firstBytes > FONT_FIRST_MAX_BYTES) report.fails.push(`首次打开要下载的字体合计 ${withCommas(firstBytes)} 字节，超过了上限 ${withCommas(FONT_FIRST_MAX_BYTES)}`);
  report.lines.push(`全部字体文件合计：${withCommas(files.reduce((sum, item) => sum + item.bytes, 0))} 字节（没有上限）`);
  return report;
}

// ---------------------------------------------------------------- 构建出来的程序

/** 构建清单（dist/.vite/manifest.json）里的一项：一个源文件构建成了哪个文件，它又引入了谁。 */
export interface BuildChunk {
  /** 构建出来的文件，相对 dist/。 */
  file: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  /** 一起下载的（静态引入的）别的项：清单里的键。 */
  imports?: string[];
  /** 用到时才下载的（动态引入的）别的项。 */
  dynamicImports?: string[];
  /** 跟着这一项一起下载的样式表，相对 dist/。 */
  css?: string[];
  /** 这一项的程序里写着网址的图片和别的文件，相对 dist/。 */
  assets?: string[];
}

export type BuildManifest = Record<string, BuildChunk>;

/** 从清单里的一项出发，它自己连同一层一层静态引入的各项（清单里的键，按碰到的先后）。清单里没有的键不算。 */
export function staticClosure(manifest: BuildManifest, from: string): string[] {
  const seen: string[] = [];
  const visit = (key: string): void => {
    if (seen.includes(key) || !Object.hasOwn(manifest, key)) return;
    seen.push(key);
    for (const next of manifest[key].imports ?? []) visit(next);
  };
  visit(from);
  return seen;
}

/** 几个文件合起来：是哪几个，压缩以后一共多少字节。 */
export interface FileGroup {
  files: string[];
  gzip: number;
}

export interface ProgramSizes {
  /** 页面一打开就要下载的程序：入口和它静态引入的各块。清单里没有入口时是 null。 */
  page: FileGroup | null;
  /** 页面一打开就要下载的样式表。 */
  style: FileGroup;
  /**
   * 摆立体的沙盘时另外要下载的程序：沙盘程序那一块和它静态引入的各块，页面已经带着的不重复算。
   * 清单里没有沙盘程序这一项时是 null。
   */
  engine: FileGroup | null;
  /**
   * 全程沙盘另外要下载的程序：全程沙盘那一块和它静态引入的各块，页面和沙盘程序已经带着的不重复算。
   * 清单里没有这一项时是 null（还没有全程沙盘的程序，或者它被打进了别的块）。
   */
  route: FileGroup | null;
  /** 全程沙盘那一块在清单里是不是标着“用到时才下载”。 */
  routeIsDynamic: boolean;
  /** 全程沙盘那一块是不是成了沙盘程序一来就带着的东西（沙盘程序静态引入了它）：站点沙盘的页面就白下载了它。 */
  routeInEngine: boolean;
  /** 沙盘程序是不是成了页面一打开就下载的东西（页面静态引入了它）。 */
  engineInPage: boolean;
  /** 沙盘程序在清单里是不是标着“用到时才下载”。 */
  engineIsDynamic: boolean;
}

/**
 * 照构建清单量出页面、样式表、沙盘程序各多大。gzipOf 给出一个构建出来的文件（相对 dist/）压缩以后的字节数，
 * 由调用的人从磁盘读了、压了给进来。
 */
export function programSizes(manifest: BuildManifest, gzipOf: (file: string) => number): ProgramSizes {
  const group = (files: string[]): FileGroup => ({ files, gzip: files.reduce((sum, file) => sum + gzipOf(file), 0) });
  const unique = (files: string[]): string[] => files.filter((file, i) => files.indexOf(file) === i);

  const pageKeys = staticClosure(manifest, PAGE_ENTRY);
  const engineKeys = staticClosure(manifest, ENGINE_ENTRY);
  const pageFiles = unique(pageKeys.map((key) => manifest[key].file));
  const styleFiles = unique(pageKeys.flatMap((key) => manifest[key].css ?? []));
  const engineFiles = unique(engineKeys.filter((key) => !pageKeys.includes(key)).map((key) => manifest[key].file));
  const routeKeys = staticClosure(manifest, ROUTE_ENTRY);
  const routeFiles = unique(routeKeys.filter((key) => !pageKeys.includes(key) && !engineKeys.includes(key)).map((key) => manifest[key].file)).filter((file) => !pageFiles.includes(file) && !engineFiles.includes(file));

  return {
    page: pageKeys.length > 0 ? group(pageFiles) : null,
    style: group(styleFiles),
    engine: engineKeys.length > 0 ? group(engineFiles) : null,
    route: routeKeys.length > 0 ? group(routeFiles) : null,
    routeIsDynamic: manifest[ROUTE_ENTRY]?.isDynamicEntry === true,
    routeInEngine: engineKeys.includes(ROUTE_ENTRY) || pageKeys.includes(ROUTE_ENTRY),
    engineInPage: pageKeys.includes(ENGINE_ENTRY),
    engineIsDynamic: manifest[ENGINE_ENTRY]?.isDynamicEntry === true,
  };
}

/** 查下来的结果：lines 是给人看的一张表（每次都印），fails 是不合格的，warns 是快到上限的。 */
export interface SizeReport {
  lines: string[];
  fails: string[];
  warns: string[];
}

/** 程序自己的下载量对着上限查一遍。distBytes 是整个 dist/ 有多少字节。 */
export function programReport(sizes: ProgramSizes, distBytes: number): SizeReport {
  const report: SizeReport = { lines: [], fails: [], warns: [] };
  const row = (what: string, value: number, max: number, warnAbove: number, unit: string, files?: string[]): void => {
    const share = Math.round((value / max) * 100);
    const line = `${what}：${withCommas(value)} ${unit}，上限 ${withCommas(max)}（用了 ${share}%）`;
    report.lines.push(files ? `${line}　${files.join('、')}` : line);
    const result = verdict(value, max, warnAbove);
    if (result === 'fail') report.fails.push(`${what}有 ${withCommas(value)} ${unit}，超过了上限 ${withCommas(max)}`);
    if (result === 'warn') report.warns.push(`${what}有 ${withCommas(value)} ${unit}，快到上限 ${withCommas(max)} 了（过了 ${withCommas(warnAbove)} 就提醒）`);
  };

  if (!sizes.page) report.fails.push(`构建清单里没有页面的入口（${PAGE_ENTRY}）`);
  else row('页面的程序（压缩以后）', sizes.page.gzip, PAGE_GZIP_MAX, PAGE_GZIP_WARN, '字节', sizes.page.files);

  row('样式表（压缩以后）', sizes.style.gzip, STYLE_GZIP_MAX, STYLE_GZIP_WARN, '字节', sizes.style.files);

  if (sizes.engineInPage) {
    report.fails.push(`沙盘程序（${ENGINE_ENTRY}）成了页面一打开就下载的东西：页面只能用动态 import 取它（src/stage/index.ts 的 loadStageEngine）`);
  } else if (!sizes.engine) {
    report.fails.push(`构建清单里没有沙盘程序这一项（${ENGINE_ENTRY}）：它要么被打进了页面那一块，要么挪了地方（挪了就改 tests/content/budgetRules.ts 的 ENGINE_ENTRY）`);
  } else {
    if (!sizes.engineIsDynamic) report.fails.push(`沙盘程序（${ENGINE_ENTRY}）在构建清单里没有标成“用到时才下载”`);
    row('沙盘程序（压缩以后）', sizes.engine.gzip, ENGINE_GZIP_MAX, ENGINE_GZIP_WARN, '字节', sizes.engine.files);
    // 全程沙盘另外的程序：单印一行（它自己没有上限），再和沙盘程序加在一起查——上限说的是“摆一座沙盘，读者要下载多少程序”：
    // 站点沙盘是沙盘程序，全程沙盘是沙盘程序加上这一块，两样都不能超过同一个数
    if (sizes.routeInEngine) {
      report.fails.push(`全程沙盘那一块程序（${ROUTE_ENTRY}）成了沙盘程序一来就带着的东西：只能用动态 import 取它（src/stage/index.ts 的 loadStageEngine）`);
    } else if (sizes.route) {
      if (!sizes.routeIsDynamic) report.fails.push(`全程沙盘那一块程序（${ROUTE_ENTRY}）在构建清单里没有标成“用到时才下载”`);
      report.lines.push(`全程沙盘另外的程序（压缩以后）：${withCommas(sizes.route.gzip)} 字节（没有单独的上限，和沙盘程序加在一起查）　${sizes.route.files.join('、')}`);
      row('摆全程沙盘要下载的程序：沙盘程序加上全程沙盘另外的（压缩以后）', sizes.engine.gzip + sizes.route.gzip, ENGINE_GZIP_MAX, ENGINE_GZIP_WARN, '字节');
    }
  }

  row('整个 dist/', distBytes, DIST_MAX_BYTES, DIST_WARN_BYTES, '字节');
  return report;
}

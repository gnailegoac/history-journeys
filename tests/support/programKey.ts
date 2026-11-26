// 沙盘程序和拍照的工具的记号（定格图清单里的 madeFrom.program）。一座沙盘一个。
// 定格图是这些程序画出来的：这座沙盘用得着的文件里哪一个改了一个字节，或者 three、Playwright 换了版本，存着的图就可能不是现在画得出来的那一张。
// 算的是文件原样的字节（仓库里统一是 LF 换行），连注释也算：注释去不干净（着色器的字符串里也有“//”），宁可严一点。
// 拍定格图的工具和查“旧不旧”的测试（tests/stage/stills-fresh.test.ts）用的是这同一个函数。只算数，不碰磁盘。
//
// 文件分四类（programPart），一座沙盘的记号里只有它用得着的：
//   各座沙盘共用的          每座沙盘都算。改一个字节，每座沙盘的定格图都算旧的。
//   一种样式自己的          场景文件里写着这种样式（style）的沙盘才算。
//   一家零件自己的          场景里写到了这一家的东西的沙盘才算（哪几家，和沙盘程序决定下载哪几家是同一个函数：familiesOf）。
//   全程沙盘才用的那一块    只有全程沙盘算。
// 这样分有它的限度：给样式的类型添一个字段（src/stage/three/internal.ts）、添一种东西（src/domain/sceneKinds.ts）、
// 在场景文件的规格里添一种写法（src/domain/scene.ts），改的都是共用的文件——每座沙盘的记号都跟着变，都要重拍一遍
// （画面没有变的图片不重写，只是清单里的这一个记号换了）。
// 样式的登记表（src/stage/styles.ts）不在记号里，和零件的登记表一样：它挑的是哪一种样式，那种样式的文件自己在记号里。

import { contentKey } from '../../src/domain/contentKey';
import { STYLES } from '../../src/stage/styles';

/** 这几个文件夹里的文件都算（连子文件夹）；不另外点名的都是共用的。路径相对项目的根目录，用“/”分隔。 */
export const PROGRAM_FOLDERS = ['src/stage/three/', 'src/stage/ground/', 'src/stage/dev/'] as const;

/**
 * 另外单算的几个共用的文件。
 * 拍照的工具是两个文件：make-stills.spec.ts 管浏览器，stillsTool.ts 里是它不靠浏览器的部分
 * （两种形状各照什么拍、质量从高往低试哪几档、清单里的数取几位）——都决定拍出来什么样，都算。
 */
export const PROGRAM_FILES = ['src/stage/scale.ts', 'stage-dev.html', 'tests/tools/make-stills.spec.ts', 'tests/support/stillsTool.ts', 'playwright.stills.config.ts'] as const;

/** 场景数据的那几个文件：src/domain/ 里名字以 scene 打头的 .ts（共用的；下面点了名不算的除外）。 */
const SCENE_SOURCE = /^src\/domain\/scene[^/]*\.ts$/;

/**
 * 全程沙盘才用的那一块：地面的另一种算法，路怎么走（roadLines.ts 不在上面那几个文件夹里），画路的，和把它们转出去的那个文件。
 * 站点沙盘的程序不引它们（只取类型的不算；tests/unit/still-keys.test.ts 查着），所以只算进全程沙盘的记号。
 */
export const ROUTE_LEVEL_FILES = ['src/stage/ground/route.ts', 'src/stage/roadLines.ts', 'src/stage/three/routeKit.ts', 'src/stage/three/routeLevel.ts'] as const;

/**
 * 名字合得上、却不算的两个文件：
 *   src/stage/three/piece.ts        小像不在定格图里：拍照的那一页和工具从不叫沙盘摆小像（placePiece），模型头一回要用才造。
 *   src/domain/sceneContent.ts      只管从 content/ 里读文件，自己什么也不画：它交给沙盘的三样（场景，地形文件，先画好的地面）
 *                                   各有自己的记号（madeFrom.scene、terrain、ground），第四样（定格图）立体的沙盘不用。
 */
export const LEFT_OUT_FILES = ['src/stage/three/piece.ts', 'src/domain/sceneContent.ts'] as const;

/** 样式的文件夹，和里面各种样式共用的文件（按名字取样式的那个入口：照登记表去取）。 */
export const STYLE_FOLDER = 'src/stage/three/style/';
export const STYLE_SHARED_FILES = ['src/stage/three/style/index.ts'] as const;

/**
 * 一种样式自己的文件。表里有哪几行，就是认得哪几种样式：行是照样式的登记表（src/stage/styles.ts）来的，登记了一种就有它的一行。
 * 一种样式的文件都放在以它的名字命名的子文件夹里（style/<样式的名字>/），那里面的不用点名，照文件夹认——所以每一行都是空的，
 * 行要留着：有这一行，那个文件夹才算一种认得的样式。子文件夹叫别的名字的（几种样式合用的小东西，或者名字写错了一个字），没有哪一种样式认。
 * 行里也可以点名（直接放在样式的文件夹里的文件归哪一种）：现在没有这样的文件，算记号的几个函数还认这种写法（测试用编出来的表查着）。
 * 样式的文件夹里的每一个文件，要么在共用的单子里，要么正好归一种样式（tests/unit/still-keys.test.ts 查着）；
 * 都不是的先当共用的算（宁可严一点），那一条测试会说该把它写进哪里。
 */
export const STYLE_FILES: Readonly<Record<string, readonly string[]>> = Object.fromEntries(STYLES.map((row) => [row.id, []]));

/** 按家分块的零件的文件夹：一家一个文件 families/<这一家>.ts（或者一个文件夹 families/<这一家>/），名字就是登记表里那一家的名字。 */
export const FAMILY_FOLDER = 'src/stage/three/families/';

/** 一个文件归哪一类。out 是不算在任何一座沙盘的记号里。 */
export type ProgramPart = { part: 'shared' | 'route' | 'out' } | { part: 'style'; style: string } | { part: 'family'; family: string };

/**
 * 哪几种样式认这个文件：先看那张表，再看它是不是在以样式的名字命名的子文件夹里。styles 不写用上面那张表。
 * 子文件夹的名字要是表里有的一种样式才算；叫别的名字的子文件夹里的文件没有谁认（programPart 把它当共用的算）。
 */
export function stylesClaiming(path: string, styles: Readonly<Record<string, readonly string[]>> = STYLE_FILES): string[] {
  const known = Object.keys(styles);
  const named = known.filter((id) => styles[id].includes(path));
  if (!path.startsWith(STYLE_FOLDER)) return named;
  const rest = path.slice(STYLE_FOLDER.length);
  const folder = rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : null;
  return folder !== null && known.includes(folder) && !named.includes(folder) ? [...named, folder] : named;
}

/** 这个文件归哪一类。path 相对项目的根目录，用“/”分隔。styles 不写用上面那张表。 */
export function programPart(path: string, styles: Readonly<Record<string, readonly string[]>> = STYLE_FILES): ProgramPart {
  if ((LEFT_OUT_FILES as readonly string[]).includes(path)) return { part: 'out' };
  if ((ROUTE_LEVEL_FILES as readonly string[]).includes(path)) return { part: 'route' };
  if (path.startsWith(FAMILY_FOLDER)) {
    const rest = path.slice(FAMILY_FOLDER.length);
    const family = rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : rest.replace(/\.[^.]+$/, '');
    return { part: 'family', family };
  }
  if (path.startsWith(STYLE_FOLDER) && !(STYLE_SHARED_FILES as readonly string[]).includes(path)) {
    const claimed = stylesClaiming(path, styles);
    // 正好一种样式认它，才归那一种；没有谁认、两种都认的，当共用的算
    if (claimed.length === 1) return { part: 'style', style: claimed[0] };
    return { part: 'shared' };
  }
  if (PROGRAM_FOLDERS.some((folder) => path.startsWith(folder)) || (PROGRAM_FILES as readonly string[]).includes(path) || SCENE_SOURCE.test(path)) return { part: 'shared' };
  return { part: 'out' };
}

/**
 * paths 里归 style 这一种样式自己的那些文件（照 programPart 认：表里点了名的，和以它的名字命名的子文件夹里的）。
 * 要问“这座沙盘的样式有哪些文件”都从这里问，不直接翻那张表：样式的文件搬进子文件夹以后表里那一行是空的。
 */
export function styleFilesIn(paths: readonly string[], style: string, styles: Readonly<Record<string, readonly string[]>> = STYLE_FILES): string[] {
  return paths.filter((path) => {
    const part = programPart(path, styles);
    return part.part === 'style' && part.style === style;
  });
}

/** 这个文件算不算在记号里（不管是哪一座沙盘的）。path 相对项目的根目录，用“/”分隔。 */
export function isProgramPath(path: string): boolean {
  return programPart(path).part !== 'out';
}

/** 一座沙盘用的是什么：哪一种样式，哪几家零件（登记表里的名字），是不是全程沙盘。 */
export interface TableUse {
  style: string;
  families: readonly string[];
  route: boolean;
}

/** 这个文件算不算在这座沙盘的记号里。styles 不写用上面那张表。 */
export function inTableKey(path: string, use: TableUse, styles: Readonly<Record<string, readonly string[]>> = STYLE_FILES): boolean {
  const part = programPart(path, styles);
  if (part.part === 'shared') return true;
  if (part.part === 'style') return part.style === use.style;
  if (part.part === 'family') return use.families.includes(part.family);
  if (part.part === 'route') return use.route;
  return false;
}

/** 从一批文件里挑出这座沙盘的记号要算的那些。styles 不写用上面那张表。 */
export function tableFiles<T>(files: Record<string, T>, use: TableUse, styles: Readonly<Record<string, readonly string[]>> = STYLE_FILES): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [path, content] of Object.entries(files)) if (inTableKey(path, use, styles)) out[path] = content;
  return out;
}

/** 两个库的版本，和 package.json 里写的一样。 */
export interface ProgramVersions {
  three: string;
  playwright: string;
}

/**
 * 算记号。files 是“路径 → 文件的内容”（字节，或者原样的字），只该放这座沙盘要算的那些（tableFiles 挑出来的）；
 * 路径在这里按字符排好再算，所以传进来的先后不要紧。
 */
export function programKey(files: Record<string, Uint8Array | string>, versions: ProgramVersions): string {
  const paths = Object.keys(files).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return contentKey(JSON.stringify({ three: versions.three, playwright: versions.playwright, files: paths.map((path) => [path, contentKey(files[path])]) }));
}

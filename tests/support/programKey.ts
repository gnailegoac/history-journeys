// 沙盘程序和拍照的工具的记号（定格图清单里的 madeFrom.program）。
// 定格图是这些程序画出来的：哪一个文件改了一个字节，或者 three、Playwright 换了版本，存着的图就可能不是现在画得出来的那一张。
// 算的是文件原样的字节（仓库里统一是 LF 换行），连注释也算：注释去不干净（着色器的字符串里也有“//”），宁可严一点。
// 拍定格图的工具和查“旧不旧”的测试（tests/stage/stills-fresh.test.ts）用的是这同一个函数。只算数，不碰磁盘。

import { contentKey } from '../../src/domain/contentKey';

/** 这几个文件夹里的文件都算（连子文件夹）。路径相对项目的根目录，用“/”分隔。 */
export const PROGRAM_FOLDERS = ['src/stage/three/', 'src/stage/ground/', 'src/stage/dev/'] as const;

/**
 * 另外单算的几个文件。src/stage/roadLines.ts 算的是全程沙盘上的路怎么走（画路的 src/stage/three/routeKit.ts 用它），不在上面那几个文件夹里。
 * 拍照的工具是两个文件：make-stills.spec.ts 管浏览器，stillsTool.ts 里是它不靠浏览器的部分
 * （两种形状各照什么拍、质量从高往低试哪几档、清单里的数取几位）——都决定拍出来什么样，都算。
 */
export const PROGRAM_FILES = ['src/stage/scale.ts', 'src/stage/roadLines.ts', 'stage-dev.html', 'tests/tools/make-stills.spec.ts', 'tests/support/stillsTool.ts', 'playwright.stills.config.ts'] as const;

/** 场景数据的那几个文件：src/domain/ 里名字以 scene 打头的 .ts。 */
const SCENE_SOURCE = /^src\/domain\/scene[^/]*\.ts$/;

/** 这个文件算不算在记号里。path 相对项目的根目录，用“/”分隔。 */
export function isProgramPath(path: string): boolean {
  return PROGRAM_FOLDERS.some((folder) => path.startsWith(folder)) || (PROGRAM_FILES as readonly string[]).includes(path) || SCENE_SOURCE.test(path);
}

/** 两个库的版本，和 package.json 里写的一样。 */
export interface ProgramVersions {
  three: string;
  playwright: string;
}

/**
 * 算记号。files 是“路径 → 文件的内容”（字节，或者原样的字），只该放 isProgramPath 认的那些；
 * 路径在这里按字符排好再算，所以传进来的先后不要紧。
 */
export function programKey(files: Record<string, Uint8Array | string>, versions: ProgramVersions): string {
  const paths = Object.keys(files).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return contentKey(JSON.stringify({ three: versions.three, playwright: versions.playwright, files: paths.map((path) => [path, contentKey(files[path])]) }));
}

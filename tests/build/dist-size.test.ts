// 构建出来的 dist/ 有多大。npm run check 的最后一步（npm run check:size）跑它，这时 dist/ 刚构建好；
// 单独跑要先 npm run build。它不在 npm test 里：那一步之前 dist/ 可能还是旧的。
//
// 查四个数，每次都印一张表：
//   沙盘程序  摆立体的沙盘时才下载的那几块（src/stage/three/engine.ts 那一块，和它另外静态引入的块），压缩以后
//   页面      一打开就下载的程序（index.html 的入口和它静态引入的块），压缩以后
//   样式表    页面一打开就下载的样式表，压缩以后
//   dist/     整个文件夹，不压缩
// 另外查一件事：沙盘程序不能是页面一打开就下载的东西（页面只许用动态 import 取它）。
// “压缩以后”用的是 gzip 平常的力度，和构建时印在屏幕上的那一列是同一个算法。
//
// 哪一块是哪一块，照构建清单（dist/.vite/manifest.json，vite.config.ts 里开的）找：
// 构建出来的文件名里有一串每次都可能变的字符，猜不得。
// 上限和怎么算都在 tests/content/budgetRules.ts（它自己的测试在 budgetRules.test.ts，随 npm run validate 跑）；
// 这里只管从磁盘读、压、量。最后一组用编出来的清单再走一遍同一条路，看超了的时候这里是不是真的通不过。

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ENGINE_ENTRY, ENGINE_GZIP_MAX, PAGE_ENTRY, programReport, programSizes } from '../content/budgetRules';
import type { BuildManifest, SizeReport } from '../content/budgetRules';

/** 项目的根目录下的 dist/：这个文件在 tests/build/ 里，往上两层。 */
const DIST = new URL('../../dist/', import.meta.url);
const MANIFEST = new URL('.vite/manifest.json', DIST);

/** 把清单的文字读成清单。 */
function readManifest(text: string): BuildManifest {
  return JSON.parse(text) as BuildManifest;
}

/** 一份构建对着上限查：清单，每个文件压缩以后多大，整个文件夹多大。真的 dist/ 和编出来的清单走的都是这里。 */
function measure(manifest: BuildManifest, gzipOf: (file: string) => number, distBytes: number): SizeReport {
  return programReport(programSizes(manifest, gzipOf), distBytes);
}

/** 一个文件夹里所有文件一共多少字节（子文件夹里的也算）。 */
function folderBytes(dir: URL): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const name = encodeURIComponent(entry.name);
    if (entry.isDirectory()) total += folderBytes(new URL(`${name}/`, dir));
    else if (entry.isFile()) total += statSync(new URL(name, dir)).size;
  }
  return total;
}

/** dist/ 里的一个文件压缩以后多少字节。 */
function gzipOnDisk(file: string): number {
  return gzipSync(readFileSync(new URL(file, DIST))).length;
}

describe('构建出来的文件', () => {
  it('带着清单，清单里有页面的入口和沙盘程序，它们的文件在 dist/ 里', () => {
    expect(existsSync(MANIFEST), '没有 dist/.vite/manifest.json：先运行 npm run build（vite.config.ts 里要开着 build.manifest）').toBe(true);
    const manifest = readManifest(new TextDecoder().decode(readFileSync(MANIFEST)));
    const page = manifest[PAGE_ENTRY];
    expect(page, `清单里没有 ${PAGE_ENTRY} 这一项`).toBeDefined();
    expect(page.isEntry).toBe(true);
    expect(existsSync(new URL(page.file, DIST)), `清单说入口是 ${page.file}，dist/ 里没有这个文件`).toBe(true);
    const engine = manifest[ENGINE_ENTRY];
    expect(engine, `清单里没有 ${ENGINE_ENTRY} 这一项`).toBeDefined();
    expect(existsSync(new URL(engine.file, DIST)), `清单说沙盘程序是 ${engine.file}，dist/ 里没有这个文件`).toBe(true);
  });

  it('沙盘程序、页面的程序、样式表、整个 dist/ 都不超过上限；沙盘程序不是页面一打开就下载的', () => {
    expect(existsSync(MANIFEST), '没有 dist/.vite/manifest.json：先运行 npm run build').toBe(true);
    const manifest = readManifest(new TextDecoder().decode(readFileSync(MANIFEST)));
    const report = measure(manifest, gzipOnDisk, folderBytes(DIST));
    console.log(['构建出来的程序有多大', ...report.lines.map((line) => `  ${line}`)].join('\n'));
    for (const warn of report.warns) console.warn(`[check:size] 快到上限了：${warn}`);
    expect(report.fails).toEqual([]);
  });
});

describe('超了的时候这里通不过（用编出来的清单和大小，走的是同一条路）', () => {
  /** 一份编出来的清单：和真的清单一样是一段 JSON 文字。engineImports、pageImports 是这两块各自静态引入了谁。 */
  const manifestText = (pageImports: string[] = [], engineImports: string[] = [PAGE_ENTRY, '_shared.js']): string =>
    JSON.stringify({
      [PAGE_ENTRY]: { file: 'assets/index.js', src: PAGE_ENTRY, isEntry: true, imports: pageImports, dynamicImports: [ENGINE_ENTRY], css: ['assets/index.css'] },
      [ENGINE_ENTRY]: { file: 'assets/engine.js', src: ENGINE_ENTRY, isDynamicEntry: true, imports: engineImports },
      '_shared.js': { file: 'assets/shared.js' },
    });
  /** 编出来的大小（压缩以后的字节数）。 */
  const made = (table: Record<string, number>) => (file: string) => table[file] ?? 0;
  const SMALL = { 'assets/index.js': 80_000, 'assets/index.css': 5_000, 'assets/engine.js': 190_000, 'assets/shared.js': 2_000 };

  it('都在上限里：通过', () => {
    expect(measure(readManifest(manifestText()), made(SMALL), 2_000_000).fails).toEqual([]);
  });

  it('沙盘程序大了：通不过', () => {
    const report = measure(readManifest(manifestText()), made({ ...SMALL, 'assets/engine.js': ENGINE_GZIP_MAX }), 2_000_000);
    expect(report.fails).toEqual(['沙盘程序（压缩以后）有 232,000 字节，超过了上限 230,000']);
  });

  it('页面静态引入了沙盘程序：通不过，哪怕两块都很小', () => {
    const report = measure(readManifest(manifestText([ENGINE_ENTRY], ['_shared.js'])), made({ 'assets/index.js': 100, 'assets/engine.js': 100 }), 1_000);
    expect(report.fails).toHaveLength(1);
    expect(report.fails[0]).toContain('成了页面一打开就下载的东西');
  });

  it('清单里找不到沙盘程序：通不过', () => {
    const manifest = readManifest(manifestText());
    delete manifest[ENGINE_ENTRY];
    const report = measure(manifest, made(SMALL), 2_000_000);
    expect(report.fails).toHaveLength(1);
    expect(report.fails[0]).toContain('构建清单里没有沙盘程序这一项');
  });
});

// 构建出来的 dist/ 有多大。npm run check 的最后一步（npm run check:size）跑它，这时 dist/ 刚构建好；
// 单独跑要先 npm run build。它不在 npm test 里：那一步之前 dist/ 可能还是旧的。
//
// 查四个数，每次都印一张表：
//   沙盘程序  摆立体的沙盘时才下载的那几块（src/stage/three/engine.ts 那一块，和它另外静态引入的块），压缩以后
//   页面      一打开就下载的程序（index.html 的入口和它静态引入的块），压缩以后
//   样式表    页面一打开就下载的样式表，压缩以后
//   dist/     整个文件夹，不压缩
// 沙盘程序那一行查的是摆一座站点沙盘要下载的程序。全程沙盘另有一块用到时才下载的程序（src/stage/three/routeLevel.ts），
// 表里单印一行，再和沙盘程序加在一起对着同一个上限查：上限说的是“摆一座沙盘，读者要下载多少程序”。
// 另外查四件事：沙盘程序不能是页面一打开就下载的东西（页面只许用动态 import 取它）；
// 沙盘用到的文件（地形文件、先画好的地面、定格图）的网址也不能在页面一打开就下载的那一块里
//（一座沙盘十几二十个网址，沙盘越多越长：它们单独一块，打开人物页或者一站时才下载）；
// 随站的字体带得对不对（dist/ 里正好是放进仓库的那三个文件，index.html 预先声明的和样式表里写的是同一个文件），
// 字体多大也印出来；构建出来的样式表里没有 Safari 读不懂的那几种写法（查的是构建以后的原文：构建的工具会改写样式表）。
// 后两件怎么查在 tests/support/builtFonts.ts。
// 按家分块的零件（src/stage/families.ts）：每一家是单独的一块，场景里写到了才下载。对 content/ 里的每一座沙盘查
// “沙盘程序加上这座沙盘要下载的那几块”不超过同一个上限；徐州和全程沙盘一家也不下载；沙盘程序还是一个文件
//（分块分得不对，打包的工具会把两边共用的东西另拆一块，哪座沙盘都要多下载一个文件）。
// 还有一件：点开才下载的三段界面程序（凭据里面的东西、讲解员面板里面的东西、“来源”页里面的东西）各是单独的一块，
// 页面一打开就下载的程序只有入口那一个文件——React 的核心没有被打包的工具单拆出去（拆出去的话页面的程序凭空多出约 600 字节）。
// “压缩以后”用的是 gzip 平常的力度，和构建时印在屏幕上的那一列是同一个算法。
//
// 哪一块是哪一块，照构建清单（dist/.vite/manifest.json，vite.config.ts 里开的）找：
// 构建出来的文件名里有一串每次都可能变的字符，猜不得。
// 上限和怎么算都在 tests/content/budgetRules.ts（它自己的测试在 budgetRules.test.ts，随 npm run validate 跑）；
// 这里只管从磁盘读、压、量。最后一组用编出来的清单再走一遍同一条路，看超了的时候这里是不是真的通不过。

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { ENGINE_ENTRY, ENGINE_GZIP_MAX, FILE_URLS_ENTRY, PAGE_ENTRY, ROUTE_ENTRY, familyEntry, fontReport, programReport, programSizes, staticClosure, withCommas } from '../content/budgetRules';
import type { BuildManifest, SizeReport } from '../content/budgetRules';
import { CONTAINER_MAX, CQW_MAX, builtFonts, builtStyleProblems } from '../support/builtFonts';
import { oldIpadSheet } from '../support/oldIpadSheet';
import { SOURCES_TEXT } from '../../src/ui/sourcesText';
import { FAMILIES } from '../../src/stage/families';
import { familyNamesFor } from '../stage/support/kitFamilies';
import { realRouteScene, realSceneFile, realSceneKeys } from '../stage/support/realScenes';
import type { BuiltSite, CommittedFont } from '../support/builtFonts';

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

describe('全程沙盘另外的那一块程序', () => {
  it('单独一块，沙盘程序用到时才下载它；站点沙盘要下载的程序（沙盘程序静态带着的）里没有它', () => {
    expect(existsSync(MANIFEST), '没有 dist/.vite/manifest.json：先运行 npm run build').toBe(true);
    const manifest = readManifest(new TextDecoder().decode(readFileSync(MANIFEST)));
    const route = manifest[ROUTE_ENTRY];
    expect(route, `清单里没有 ${ROUTE_ENTRY} 这一项：它被打进了别的块（多半是沙盘程序那一块），或者挪了地方（挪了就改 tests/content/budgetRules.ts 的 ROUTE_ENTRY）`).toBeDefined();
    expect(route.isDynamicEntry, '全程沙盘那一块在清单里没有标成“用到时才下载”').toBe(true);
    expect(staticClosure(manifest, ENGINE_ENTRY), '全程沙盘那一块成了沙盘程序一来就带着的东西').not.toContain(ROUTE_ENTRY);
    expect(staticClosure(manifest, PAGE_ENTRY), '全程沙盘那一块成了页面一打开就下载的东西').not.toContain(ROUTE_ENTRY);
    // 量到的两个数另印一行，交接的时候抄这里的
    const sizes = programSizes(manifest, gzipOnDisk);
    expect(sizes.route, '量不出全程沙盘另外的程序').not.toBeNull();
    expect(sizes.engine, '量不出沙盘程序').not.toBeNull();
    const engine = sizes.engine?.gzip ?? 0;
    const extra = sizes.route?.gzip ?? 0;
    console.log(`  摆站点沙盘要下载的程序 ${withCommas(engine)} 字节；摆全程沙盘 ${withCommas(engine)} + ${withCommas(extra)} = ${withCommas(engine + extra)} 字节；上限都是 ${withCommas(ENGINE_GZIP_MAX)}`);
    expect(engine + extra).toBeLessThanOrEqual(ENGINE_GZIP_MAX);
  });
});

describe('按家分块的零件：每一座沙盘要下载多少程序', () => {
  /** 一家的程序另外要下载的文件（页面和沙盘程序已经带着的不重复算）。 */
  const familyFiles = (manifest: BuildManifest, name: string): string[] => {
    const have = new Set([...staticClosure(manifest, PAGE_ENTRY), ...staticClosure(manifest, ENGINE_ENTRY)].map((key) => manifest[key].file));
    const files = staticClosure(manifest, familyEntry(name)).map((key) => manifest[key].file);
    return files.filter((file, i) => !have.has(file) && files.indexOf(file) === i);
  };

  it('登记表里的每一家都是单独的一块，用到时才下载；沙盘程序、全程沙盘那一块、页面的程序都不带着它；沙盘程序还是一个文件', () => {
    expect(existsSync(MANIFEST), '没有 dist/.vite/manifest.json：先运行 npm run build').toBe(true);
    const manifest = readManifest(new TextDecoder().decode(readFileSync(MANIFEST)));
    expect(FAMILIES.length).toBeGreaterThan(0);
    for (const { name } of FAMILIES) {
      const key = familyEntry(name);
      expect(manifest[key], `清单里没有 ${key} 这一项：这一家的程序被打进了别的块，或者文件不叫这个名字（src/stage/three/families/<家的名字>.ts）`).toBeDefined();
      expect(manifest[key].isDynamicEntry, `${key} 在清单里没有标成“用到时才下载”`).toBe(true);
      for (const entry of [ENGINE_ENTRY, ROUTE_ENTRY, PAGE_ENTRY]) expect(staticClosure(manifest, entry), `${key} 成了 ${entry} 一来就带着的东西`).not.toContain(key);
      // 它另外要下载的只有它自己那一个文件：和沙盘程序共用的东西留在沙盘程序里，没有另拆一块
      expect(familyFiles(manifest, name), `${key} 另外要下载的文件`).toEqual([manifest[key].file]);
    }
    // 沙盘程序还是一个文件（共用的东西另拆了一块的话，这里是两个）
    expect(programSizes(manifest, gzipOnDisk).engine?.files).toEqual([manifest[ENGINE_ENTRY].file]);
  });

  it(`content/ 里的每一座沙盘：沙盘程序加上它要下载的那几块，不超过 ${withCommas(ENGINE_GZIP_MAX)} 字节；徐州和全程沙盘一家也不下载`, () => {
    expect(existsSync(MANIFEST), '没有 dist/.vite/manifest.json：先运行 npm run build').toBe(true);
    const manifest = readManifest(new TextDecoder().decode(readFileSync(MANIFEST)));
    const sizes = programSizes(manifest, gzipOnDisk);
    const engine = sizes.engine?.gzip ?? 0;
    const route = sizes.route?.gzip ?? 0;
    expect(engine).toBeGreaterThan(0);
    const lines: string[] = [];
    const stops = realSceneKeys();
    expect(stops).toContain('su-shi/xuzhou');
    for (const key of stops) {
      const names = familyNamesFor(realSceneFile(key).scene);
      const each = names.map((name) => ({ name, gzip: familyFiles(manifest, name).reduce((sum, file) => sum + gzipOnDisk(file), 0) }));
      const total = engine + each.reduce((sum, family) => sum + family.gzip, 0);
      lines.push(`${key}：沙盘程序 ${withCommas(engine)}${each.map((family) => ` + ${family.name} ${withCommas(family.gzip)}`).join('')} = ${withCommas(total)} 字节${names.length ? '' : '（一家也不下载）'}`);
      expect(total, `${key} 要下载的程序超过了上限`).toBeLessThanOrEqual(ENGINE_GZIP_MAX);
      for (const family of each) expect(family.gzip, `${family.name} 这一家量不出大小`).toBeGreaterThan(0);
    }
    // 徐州：场景里没有写到哪一家的东西
    expect(familyNamesFor(realSceneFile('su-shi/xuzhou').scene)).toEqual([]);
    // 全程沙盘：它下载的是全程沙盘那一块；场景里没有摆件和点缀，写不到哪一家的东西，摆它的那条路也不问登记表（src/stage/three/view.ts 的 buildRouteParts）
    for (const key of realSceneKeys('route')) {
      const scene = realRouteScene(key).scene as unknown as Record<string, unknown>;
      expect(scene.things, `${key} 有了摆件`).toBeUndefined();
      expect(scene.dressing, `${key} 有了点缀`).toBeUndefined();
      lines.push(`${key}：沙盘程序 ${withCommas(engine)} + 全程沙盘那一块 ${withCommas(route)} = ${withCommas(engine + route)} 字节（一家也不下载）`);
      expect(engine + route).toBeLessThanOrEqual(ENGINE_GZIP_MAX);
    }
    console.log(['每一座沙盘要下载的程序（压缩以后）', ...lines.map((line) => `  ${line}`), ...FAMILIES.map(({ name, holds }) => `  ${name} 这一家：${holds.join('、')}　${withCommas(familyFiles(manifest, name).reduce((sum, file) => sum + gzipOnDisk(file), 0))} 字节　${manifest[familyEntry(name)].file}`)].join('\n'));
  });
});

describe('沙盘用到的文件的网址', () => {
  it('单独一块，用到时才下载；页面一打开就下载的程序里一个也没有', () => {
    expect(existsSync(MANIFEST), '没有 dist/.vite/manifest.json：先运行 npm run build').toBe(true);
    const manifest = readManifest(new TextDecoder().decode(readFileSync(MANIFEST)));
    const urls = manifest[FILE_URLS_ENTRY];
    expect(urls, `清单里没有 ${FILE_URLS_ENTRY} 这一项：它被打进了别的块，或者挪了地方（挪了就改 tests/content/budgetRules.ts 的 FILE_URLS_ENTRY）`).toBeDefined();
    expect(urls.isDynamicEntry, '网址那一块在清单里没有标成“用到时才下载”').toBe(true);
    const pageKeys = staticClosure(manifest, PAGE_ENTRY);
    expect(pageKeys, '网址那一块成了页面一打开就下载的东西').not.toContain(FILE_URLS_ENTRY);
    // 它里面写着网址的文件：content/ 里有沙盘的话，至少有一个地形文件
    const files = (urls.assets ?? []).map((file) => file.slice(file.lastIndexOf('/') + 1));
    expect(files.length).toBeGreaterThan(0);
    const page = pageKeys.map((key) => new TextDecoder().decode(readFileSync(new URL(manifest[key].file, DIST)))).join(' ');
    expect(files.filter((file) => page.includes(file)), '这几个文件的网址出现在页面一打开就下载的程序里').toEqual([]);
    console.log(`  沙盘用到的文件的网址（压缩以后）：${withCommas(gzipOnDisk(urls.file))} 字节，${files.length} 个网址，用到时才下载　${urls.file}`);
  });
});

describe('点开才下载的几块', () => {
  /** 点开才下载的几段界面程序：凭据里面的东西，讲解员面板里面的东西，“来源”页里面的东西。 */
  const ON_DEMAND = ['src/ui/ProvenanceBody.tsx', 'src/ui/GuideBody.tsx', 'src/ui/SourcesBody.tsx'];

  it('各是单独一块，页面一打开就下载的东西里没有它们；页面的程序只有一个文件（React 没有被单拆出去）', () => {
    expect(existsSync(MANIFEST), '没有 dist/.vite/manifest.json：先运行 npm run build').toBe(true);
    const manifest = readManifest(new TextDecoder().decode(readFileSync(MANIFEST)));
    const pageKeys = staticClosure(manifest, PAGE_ENTRY);
    for (const key of ON_DEMAND) {
      expect(manifest[key], `清单里没有 ${key} 这一项：它被打进了别的块（多半是页面那一块），或者挪了地方`).toBeDefined();
      expect(manifest[key].isDynamicEntry, `${key} 在清单里没有标成“用到时才下载”`).toBe(true);
      expect(pageKeys, `${key} 成了页面一打开就下载的东西`).not.toContain(key);
    }
    // “来源”页上的话跟着那一块走，不在页面一打开就下载的程序里
    const page = pageKeys.map((key) => new TextDecoder().decode(readFileSync(new URL(manifest[key].file, DIST)))).join(' ');
    expect(page.includes(SOURCES_TEXT.lead), '“来源”页上的话出现在页面一打开就下载的程序里').toBe(false);
    expect(new TextDecoder().decode(readFileSync(new URL(manifest['src/ui/SourcesBody.tsx'].file, DIST))).includes(SOURCES_TEXT.lead), '“来源”页上的话不在它自己的那一块里').toBe(true);
    // 页面一打开就下载的程序只有入口那一个文件。点开才下载的一块要是引入了页面那一块里自己又用到 react 的程序
    //（src/app/router.ts、useLoaded.ts，PageTitle.tsx，别的组件），打包的工具（rolldown 1.2）会把 React 的核心单拆成一个文件：
    // 页面的程序凭空多出约 600 字节，页面一打开还多一次请求。量过：引入 src/domain、src/fonts/shipped.ts、不用 react 的文字模块没有事。
    expect(
      pageKeys.map((key) => manifest[key].file),
      '页面一打开就下载的程序不止一个文件：多半是哪一块点开才下载的程序引入了页面那一块里用到 react 的模块（钩子要直接从 react 引，别的经过参数传进去）',
    ).toEqual([manifest[PAGE_ENTRY].file]);
  });
});

/** dist/ 里叫这种名字的文件（子文件夹里的也算），路径相对 dist/，用“/”分隔。 */
function filesEnding(ending: string): string[] {
  return readdirSync(DIST, { recursive: true })
    .map((name) => name.split('\\').join('/'))
    .filter((name) => name.endsWith(ending))
    .sort();
}

const utf8 = new TextDecoder();
/** dist/ 里的一个文件，路径相对 dist/（文件名里可能有汉字，一段一段转好再拼）。 */
const inDistFolder = (file: string): URL => new URL(file.split('/').map(encodeURIComponent).join('/'), DIST);

/** 构建出来的网站里和字体有关的几样：index.html、每一份样式表、每一个 .woff2。 */
function readBuiltSite(): BuiltSite {
  const sheets: Record<string, string> = {};
  for (const file of filesEnding('.css')) sheets[file] = utf8.decode(readFileSync(inDistFolder(file)));
  const fonts: Record<string, { bytes: number; sha256: string }> = {};
  for (const file of filesEnding('.woff2')) {
    const bytes = readFileSync(inDistFolder(file));
    fonts[file] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  return { html: utf8.decode(readFileSync(new URL('index.html', DIST))), sheets, fonts };
}

/** 放进仓库的字体文件（src/fonts/fonts.json 里记的）。 */
function committedFonts(): CommittedFont[] {
  const record = JSON.parse(utf8.decode(readFileSync(new URL('../../src/fonts/fonts.json', import.meta.url)))) as { files: CommittedFont[] };
  return record.files.map(({ file, sha256, range, first, stop }) => ({ file, sha256, range, first, stop }));
}

describe('随站的字体在构建出来的网站里', () => {
  it('dist/ 里正好是放进仓库的那几个字体文件（现在是三个）；index.html 预先声明的两个就是样式表里一打开就要用的两个，地址是同一个文件；大小不超过上限', () => {
    expect(existsSync(MANIFEST), '没有 dist/.vite/manifest.json：先运行 npm run build').toBe(true);
    // 是哪几个文件，照记录（src/fonts/fonts.json）来，不在这里另写一遍名字：记录对不对由 tests/fonts/font-files.test.ts 查
    const committed = committedFonts();
    expect(committed.length).toBeGreaterThanOrEqual(3);
    const site = readBuiltSite();
    const built = builtFonts(site, committed);
    expect(built.problems).toEqual([]);
    expect(Object.keys(site.fonts)).toHaveLength(committed.length);
    expect(built.files.map((item) => item.file)).toEqual(committed.map((item) => item.file));
    // 一打开就下载的（index.html 里预先声明了的）：正好是样式表里不带 unicode-range 的那几个——楷体和头一个宋体文件
    expect(built.files.filter((item) => item.first).map((item) => item.file)).toEqual(committed.filter((item) => !item.range).map((item) => item.file));
    expect(built.files.filter((item) => item.first).map((item) => item.file)).toEqual(['yanlu-kai.woff2', 'yanlu-song.woff2']);
    // 大小量的是 dist/ 里的文件；哪几个算首次打开要下载的、各归哪一站，照记录（宋体按站拆开以后按站分开算）
    const sized = built.files.map(({ file, bytes }) => {
      const record = committed.find((item) => item.file === file);
      return { file, bytes, first: record?.first ?? false, stop: record?.stop ?? null };
    });
    const report = fontReport(sized);
    const where = built.files.map((item) => `${item.file} → ${item.built}${item.first ? '（index.html 里预先声明了，一打开就下载）' : '（用到时才下载）'}`);
    console.log(['构建出来的网站带的字体有多大（.woff2 文件自己的字节数，不另外压缩）', ...report.lines.map((line) => `  ${line}`), ...where.map((line) => `  ${line}`)].join('\n'));
    for (const warn of report.warns) console.warn(`[check:size] 快到上限了：${warn}`);
    expect(report.fails).toEqual([]);
  });

  it(`构建出来的样式表里：带虚线的词那道线没有被合回一句的写法；@container 至多 ${CONTAINER_MAX} 处、cqw 至多 ${CQW_MAX} 处；没有指着别的网站的地址；@media 的条件里分版面的都带着“横着”，没有老平板不认的写法`, () => {
    const site = readBuiltSite();
    expect(Object.keys(site.sheets).length).toBeGreaterThan(0);
    expect(builtStyleProblems(site.sheets)).toEqual([]);
    // 照老平板的读法改一遍（@container 的块去掉、用了 cqw 的声明作废），一个字都不差：老平板读到的和别的浏览器读到的是同一份
    for (const [sheet, css] of Object.entries(site.sheets)) expect(oldIpadSheet(css), sheet).toEqual({ css, containers: 0, cqw: 0 });
    // index.html 里的样式表和程序也都是网站自己的
    const addresses = [...site.html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/\s(?:href|src)\s*=\s*["']([^"']*)["']/g)].map((match) => match[1]);
    expect(addresses.length).toBeGreaterThan(3);
    expect(addresses.filter((address) => /^[a-z][a-z0-9+.-]*:|^\/\//i.test(address)), 'index.html 里指着别的网站的地址').toEqual([]);
  });
});

describe('字体带得不对的时候这里通不过（用编出来的网页和样式表，走的是同一条路）', () => {
  const COMMITTED: CommittedFont[] = [
    { file: 'yanlu-kai.woff2', sha256: 'k', range: false, first: true, stop: null },
    { file: 'yanlu-song.woff2', sha256: 's', range: false, first: true, stop: null },
    { file: 'yanlu-song-more.woff2', sha256: 'm', range: true, first: false, stop: null },
  ];
  const FONTS = { 'assets/kai-1.woff2': { bytes: 50_000, sha256: 'k' }, 'assets/song-2.woff2': { bytes: 240_000, sha256: 's' }, 'assets/more-3.woff2': { bytes: 180_000, sha256: 'm' } };
  const RANGE = ';unicode-range:U+A9,U+2014';
  const face = (family: string, file: string, rest = ''): string => `@font-face{font-family:${family};src:url(./${file})format("woff2");font-weight:400;font-style:normal;font-display:swap${rest}}`;
  const SHEET = [face('Yanlu Kai', 'kai-1.woff2'), face('Yanlu Song', 'song-2.woff2'), face('Yanlu Song', 'more-3.woff2', RANGE), '.a{color:red}'].join('');
  const link = (file: string, rest = ' crossorigin'): string => `<link rel="preload" href="./assets/${file}" as="font" type="font/woff2"${rest} />`;
  const HTML = `<html><head>${link('kai-1.woff2')}${link('song-2.woff2')}<link rel="stylesheet" crossorigin href="./assets/index.css"></head></html>`;
  const site = (change: Partial<BuiltSite> = {}): BuiltSite => ({ html: HTML, sheets: { 'assets/index.css': SHEET }, fonts: FONTS, ...change });
  const sheet = (css: string): Partial<BuiltSite> => ({ sheets: { 'assets/index.css': css } });

  it('都对：没有话说，前两个是一打开就下载的', () => {
    const built = builtFonts(site(), COMMITTED);
    expect(built.problems).toEqual([]);
    expect(built.files).toEqual([
      { file: 'yanlu-kai.woff2', built: 'assets/kai-1.woff2', bytes: 50_000, first: true },
      { file: 'yanlu-song.woff2', built: 'assets/song-2.woff2', bytes: 240_000, first: true },
      { file: 'yanlu-song-more.woff2', built: 'assets/more-3.woff2', bytes: 180_000, first: false },
    ]);
  });

  it('预先声明的和样式表里的成了两个文件（同一个字体有两份）：通不过', () => {
    const problems = builtFonts(site({ html: HTML.replace('kai-1.woff2', 'kai-9.woff2'), fonts: { ...FONTS, 'assets/kai-9.woff2': { bytes: 50_000, sha256: 'k' } } }), COMMITTED).problems;
    expect(problems).toContain('yanlu-kai.woff2 在 dist/ 里有两份：assets/kai-1.woff2 和 assets/kai-9.woff2（同一个字体会下载两遍）');
    expect(problems).toContain('样式表里一打开就要用的 assets/kai-1.woff2 没有在 index.html 里预先声明');
  });

  it('预先声明少了 crossorigin、把第三个文件也预先声明了、少声明了一个：各有一句；写在注释里的不算声明了', () => {
    expect(builtFonts(site({ html: HTML.replace(link('kai-1.woff2'), link('kai-1.woff2', '')) }), COMMITTED).problems).toEqual(['index.html 里预先声明的 ./assets/kai-1.woff2没有 crossorigin：浏览器取来的这一份样式表用不上，会再取一遍']);
    expect(builtFonts(site({ html: HTML.replace('</head>', `${link('more-3.woff2')}</head>`) }), COMMITTED).problems).toHaveLength(1);
    expect(builtFonts(site({ html: HTML.replace(link('song-2.woff2'), '') }), COMMITTED).problems).toEqual(['样式表里一打开就要用的 assets/song-2.woff2 没有在 index.html 里预先声明']);
    expect(builtFonts(site({ html: HTML.replace(link('song-2.woff2'), `<!-- ${link('song-2.woff2')} -->`) }), COMMITTED).problems).toHaveLength(1);
  });

  it('dist/ 里的字体不是放进仓库的那一个、少了一个、font-display 不是 swap、第三个文件没带 unicode-range、指着别的网站：通不过', () => {
    expect(builtFonts(site({ fonts: { ...FONTS, 'assets/kai-1.woff2': { bytes: 50_000, sha256: 'x' } } }), COMMITTED).problems).toContain('dist/ 里的 assets/kai-1.woff2 不是放进仓库的字体文件（记号对不上）');
    const two = { 'assets/kai-1.woff2': FONTS['assets/kai-1.woff2'], 'assets/song-2.woff2': FONTS['assets/song-2.woff2'] };
    expect(builtFonts(site({ ...sheet(SHEET.replace(face('Yanlu Song', 'more-3.woff2', RANGE), '')), fonts: two }), COMMITTED).problems).toContain('放进仓库的 yanlu-song-more.woff2 不在 dist/ 里：页面没有用上它');
    expect(builtFonts(site(sheet(SHEET.replace('font-display:swap', 'font-display:block'))), COMMITTED).problems.some((line) => line.includes('应该是 swap'))).toBe(true);
    expect(builtFonts(site(sheet(SHEET.replace(RANGE, ''))), COMMITTED).problems.some((line) => line.includes('unicode-range'))).toBe(true);
    expect(builtFonts(site(sheet(SHEET.replace('url(./kai-1.woff2)', 'url(https://fonts.example/kai.woff2)'))), COMMITTED).problems.some((line) => line.includes('指着别的网站'))).toBe(true);
  });

  it('构建出来的样式表里，带虚线的词那道线合成了一句、@container 和 cqw 多了、地址指着别的网站、分版面的 @media 少了“横着”或者用了比大小的新写法：通不过；分开写的不算', () => {
    const apart = '.note-term{text-decoration-line:underline;text-decoration-style:dotted;-webkit-text-decoration-color:var(--color-accent);text-decoration-color:var(--color-accent)}a{text-decoration:none}';
    expect(builtStyleProblems({ 'a.css': apart })).toEqual([]);
    const folded = builtStyleProblems({ 'a.css': '.note-term{-webkit-text-decoration:underline dotted var(--color-accent);text-decoration:underline dotted var(--color-accent)}' });
    expect(folded).toHaveLength(2);
    expect(folded[0]).toContain('Safari 26.2 以前这道线会没有');
    const tooMany = Array.from({ length: CONTAINER_MAX + 1 }, (_, i) => `@container pane (min-width:${i}px){.a{width:1cqw}}`).join('');
    expect(builtStyleProblems({ 'a.css': tooMany })).toEqual([
      `构建出来的样式表里 @container 有 ${CONTAINER_MAX + 1} 处，最多 ${CONTAINER_MAX} 处（iPadOS 15 不认，写在里面的东西老平板上等于没有）`,
      `构建出来的样式表里 cqw 有 ${CONTAINER_MAX + 1} 处，最多 ${CQW_MAX} 处（iPadOS 15 不认）`,
    ]);
    const addresses = '.a{background:url(https://example.com/a.png)}.b{background:url("data:image/svg+xml;utf8,<svg/>")}.c{background:url(./c.png)}';
    expect(builtStyleProblems({ 'a.css': addresses })).toEqual(['a.css 里 .a 的 background 指着别的网站：https://example.com/a.png']);
    const media =
      '@media (min-width:960px){.a{color:red}}@media (min-width:960px) and (orientation:landscape){.b{color:red}}@media not all and (min-width:960px) and (orientation:landscape){.c{color:red}}@media (width>=960px) and (orientation:landscape){.d{color:red}}@media (max-width:959px){.e{color:red}}@media (hover:hover){.f{color:red}}';
    const wrong = builtStyleProblems({ 'a.css': media });
    expect(wrong).toHaveLength(3);
    expect(wrong[0]).toContain('@media (min-width:960px) —— 照窗口的宽窄分版面的一句少了 (orientation: landscape)');
    expect(wrong[1]).toContain('@media (width>=960px) and (orientation:landscape) —— 这种写法 iPadOS 15 的 Safari 不认');
    expect(wrong[2]).toContain('@media (max-width:959px) —— 上下排的版面不只是窄的窗口');
    // 样张（samples/）不是给读者读的页面，这一条不查它们
    expect(builtStyleProblems({ 'samples/x/assets/a.css': media })).toEqual([]);
  });

  it('照老平板的读法改样式表：@container 的块整块去掉（套在 @media 里的也是），用了 cqw 的声明改成 unset，别的一个字不动', () => {
    const before = [
      ':root{--grain:url("data:image/svg+xml;utf8,<svg>{;}</svg>")}',
      '.foot{--caption-h:5.875rem;position:relative}',
      '@container stage-pane (min-width:560px){.foot{--caption-h:8.125rem}.line{font-size:clamp(14px,calc((100cqw - 1.5rem)/40),17px)}}',
      '.brief{flex:1 1 auto;font-size:clamp(.6875rem,calc((100cqw - 4rem)/27),var(--size-small));white-space:nowrap}',
      '@media (min-width:960px){.a{color:red}@container stage-pane (width<560px){.strip{font-size:14px}}.b{width:50cqw}}',
      '.c{content:"@container {"}',
    ].join('');
    const after = [
      ':root{--grain:url("data:image/svg+xml;utf8,<svg>{;}</svg>")}',
      '.foot{--caption-h:5.875rem;position:relative}',
      '.brief{flex:1 1 auto;font-size:unset;white-space:nowrap}',
      '@media (min-width:960px){.a{color:red}.b{width:unset}}',
      '.c{content:"@container {"}',
    ].join('');
    expect(oldIpadSheet(before)).toEqual({ css: after, containers: 2, cqw: 2 });
    // 没有这两样的样式表，一个字不动
    expect(oldIpadSheet(after)).toEqual({ css: after, containers: 0, cqw: 0 });
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

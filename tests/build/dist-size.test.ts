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
// 时代样式（src/stage/styles.ts 的登记表）也是这样：一种样式是单独的一块，摆写着它的沙盘时才下载，不在沙盘程序里；
// 每一种单印一行，“沙盘程序加上最大的一种样式”对着同一个上限查。上限的数没有动：样式原来在沙盘程序里，现在单算一块，加回去查。
// 一种样式分两半：每一座沙盘都用的一半是单独的一块，全程沙盘只下载它；整套的那一块静态引着它，站点沙盘两块都下载。
// 另外查四件事：沙盘程序不能是页面一打开就下载的东西（页面只许用动态 import 取它）；
// 沙盘用到的文件（地形文件、先画好的地面、定格图）的网址也不能在页面一打开就下载的那一块里
//（一座沙盘十几二十个网址，沙盘越多越长：它们在内容的清单那一块里，src/domain/contentLists.ts）；
// 页面一打开就下载的那一块里，内容文件只列两种——首页的卡片，每位人物的 figure.json（一位人物一项）；
// 每位人物别的文件（各站的文件、图片、场景文件、两种清单、行迹的出处）都列在内容的清单那一块里：
// 加一位人物，页面那一块只多一项，他有多少文件都长在那一块里（2026-11-25 起；以前一个文件在页面那一块里一项）；
// 随站的字体带得对不对（dist/ 里正好是放进仓库的那四个文件，index.html 预先声明的和样式表里写的是同一个文件），
// 字体多大也印出来；构建出来的样式表里没有 Safari 读不懂的那几种写法（查的是构建以后的原文：构建的工具会改写样式表）。
// 后两件怎么查在 tests/support/builtFonts.ts。
// 按家分块的零件（src/stage/families.ts）：每一家是单独的一块，场景里写到了才下载。对 content/ 里的每一座沙盘查
// “沙盘程序，加上这座沙盘自己的样式，加上这座沙盘要下载的那几块”不超过同一个上限；徐州和全程沙盘一家也不下载；沙盘程序还是一个文件
//（分块分得不对，打包的工具会把两边共用的东西另拆一块，哪座沙盘都要多下载一个文件）。
// 还有一件：点开才下载的三段界面程序（凭据里面的东西、讲解员面板里面的东西、“来源”页里面的东西）和摆上全程沙盘才下载的时间轴（src/timebar/）各是单独的一块，
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
import { BAR_ENTRY, ENGINE_ENTRY, ENGINE_GZIP_MAX, LISTS_ENTRY, PAGE_ENTRY, ROUTE_ENTRY, SLIPS_ENTRY, SMALL_CHUNKS, familyEntry, fontScopeReport, programReport, programSizes, smallChunkReport, staticClosure, styleEntry, styleRouteEntry, withCommas } from '../content/budgetRules';
import type { BuildManifest, SizeReport } from '../content/budgetRules';
import { CONTAINER_MAX, CQW_MAX, builtFonts, builtStyleProblems, fontFaces, fontPreloads, inDist, styleSheetLinks } from '../support/builtFonts';
import { oldIpadSheet } from '../support/oldIpadSheet';
import { SHIPPED_FONTS } from '../../src/fonts/shipped';
import { SOURCES_TEXT } from '../../src/ui/sourcesText';
import { BAR_TEXT } from '../../src/timebar/barText';
import { FAMILIES } from '../../src/stage/families';
import { STYLES } from '../../src/stage/styles';
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

  it('构建出来的程序里不叫最老的那一版浏览器还没有的函数：at()、findLast()、Object.hasOwn()、structuredClone()（构建只改写法，不补函数）', () => {
    // 最老要能打开的是 iOS 15 上的 Safari 15（vite.config.ts）；这四样是 15.4 才有的。叫到了，那一块程序在老平板上当场出错
    // at() 只认带一个参数的叫法（数组、字符串的那一个）：three 的射线和线段自己有一个 at(t, 放结果的向量)，带两个参数，不是它
    const NEWER = /\.at\(-?[\w$.]+\)|\.findLast(?:Index)?\(|Object\.hasOwn\(|structuredClone\(/g;
    const scripts = (readdirSync(DIST, { recursive: true }) as string[]).map((name) => name.replace(/\\/g, '/')).filter((name) => name.endsWith('.js'));
    expect(scripts.length).toBeGreaterThan(5);
    for (const name of scripts) {
      const text = new TextDecoder().decode(readFileSync(new URL(name.split('/').map(encodeURIComponent).join('/'), DIST)));
      expect([...new Set(text.match(NEWER) ?? [])], `dist/${name}`).toEqual([]);
    }
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
    // 量到的数另印一行，交接的时候抄这里的。2026-11-26 样式从沙盘程序里搬出去以后，这一行原来印的两个数（沙盘程序；沙盘程序加全程沙盘那一块）
    // 不再是“摆一座沙盘要下载的程序”：少了样式。现在印的两个数都带着样式（有几种样式取最大的一种；站点沙盘是整套，全程沙盘是它只取的那一半），
    // 下面查的也是这两个数——印出来说的是多少，查的就是多少。按家分块的零件另算，每一座沙盘自己的那一笔账在最后一组里。
    const sizes = programSizes(manifest, gzipOnDisk);
    expect(sizes.route, '量不出全程沙盘另外的程序').not.toBeNull();
    expect(sizes.engine, '量不出沙盘程序').not.toBeNull();
    const engine = sizes.engine?.gzip ?? 0;
    const extra = sizes.route?.gzip ?? 0;
    expect(sizes.styles.length, '量不出样式').toBeGreaterThan(0);
    const whole = sizes.styles.reduce((most, one) => Math.max(most, one.gzip), 0);
    const half = sizes.styles.reduce((most, one) => Math.max(most, one.route ? one.route.gzip : one.gzip), 0);
    expect(whole).toBeGreaterThan(0);
    expect(half).toBeGreaterThan(0);
    console.log(
      `  摆站点沙盘要下载的程序（不算按家分块的零件）${withCommas(engine)} + 样式 ${withCommas(whole)} = ${withCommas(engine + whole)} 字节；` +
        `摆全程沙盘 ${withCommas(engine)} + ${withCommas(extra)} + 样式的一半 ${withCommas(half)} = ${withCommas(engine + extra + half)} 字节；上限都是 ${withCommas(ENGINE_GZIP_MAX)}`,
    );
    // 原来的那一句还在（不带样式的）；带着样式的两句是新添的，比它严
    expect(engine + extra).toBeLessThanOrEqual(ENGINE_GZIP_MAX);
    expect(engine + whole).toBeLessThanOrEqual(ENGINE_GZIP_MAX);
    expect(engine + extra + half).toBeLessThanOrEqual(ENGINE_GZIP_MAX);
  });
});

describe('时代样式：一种一块', () => {
  // 2026-11-26 样式分成两半以前，这一条的名字里是“它另外要下载的只有它自己那一个文件”：那时一种样式一块。现在整套是两块（它自己，和它引的那一半），
  // 那一半自己还是只有一个文件；别的几样查的没有变。
  // 2026-11-26 一行可以没有 load 以前，这一条对登记表里的每一行都要整套的那一块。现在只有全程沙盘用的样式（那一行没有 load）只有那一半这一块：
  // 它的那一半照样查（单独一块、用到时才下载、谁也不静态带着、另外要下载的只有它自己），整套的那几句只对有 load 的行查——查的东西没有少。
  it('登记表里的每一种样式都是单独的一块，用到时才下载；沙盘程序、全程沙盘那一块、页面的程序都不带着它；整套另外要下载的正好是它自己和它引的那一半两个文件，那一半另外要下载的只有它自己那一个文件（只有全程沙盘用的样式——那一行没有 load——只有那一半这一块，清单里没有它整套的入口）；沙盘程序和页面的程序各还是一个文件', () => {
    expect(existsSync(MANIFEST), '没有 dist/.vite/manifest.json：先运行 npm run build').toBe(true);
    const manifest = readManifest(new TextDecoder().decode(readFileSync(MANIFEST)));
    expect(STYLES.length).toBeGreaterThan(0);
    const sizes = programSizes(manifest, gzipOnDisk);
    const have = new Set([...staticClosure(manifest, PAGE_ENTRY), ...staticClosure(manifest, ENGINE_ENTRY)].map((key) => manifest[key].file));
    for (const row of STYLES) {
      const { id } = row;
      const key = styleEntry(id);
      // 每一座沙盘都用的那一半：哪一行都有，是单独的一块，用到时才下载，哪一块都不静态带着它（整套的那一块除外）
      const halfKey = styleRouteEntry(id);
      expect(manifest[halfKey], `清单里没有 ${halfKey} 这一项：这种样式没有分出全程沙盘取的那一半，或者文件不叫这个名字`).toBeDefined();
      expect(manifest[halfKey].isDynamicEntry, `${halfKey} 在清单里没有标成“用到时才下载”`).toBe(true);
      for (const entry of [ENGINE_ENTRY, ROUTE_ENTRY, PAGE_ENTRY]) expect(staticClosure(manifest, entry), `${halfKey} 成了 ${entry} 一来就带着的东西`).not.toContain(halfKey);
      const extra = (from: string): string[] => {
        const files = staticClosure(manifest, from).map((one) => manifest[one].file);
        return files.filter((file, i) => !have.has(file) && files.indexOf(file) === i);
      };
      if (!row.load) {
        // 只有全程沙盘用的样式：清单里没有整套的入口；那一半另外要下载的只有它自己；量大小的那个函数照那一半认它
        expect(manifest[key], `${key} 在清单里：登记表里这一行没有 load，却有整套的那一块`).toBeUndefined();
        expect(extra(halfKey), `${halfKey} 另外要下载的文件`).toEqual([manifest[halfKey].file]);
        const half = sizes.styles.find((one) => one.id === id);
        expect(half, `量不出样式“${id}”多大`).toBeDefined();
        expect(half?.halfOnly, `样式“${id}”只有那一半，量大小的那个函数没有认出来`).toBe(true);
        expect(half?.files).toEqual([manifest[halfKey].file]);
        expect(half?.gzip).toBeGreaterThan(0);
        expect(half?.isDynamic).toBe(true);
        expect(half?.inOthers).toBe(false);
        continue;
      }
      expect(manifest[key], `清单里没有 ${key} 这一项：这种样式的程序被打进了别的块（多半是沙盘程序那一块），或者文件不叫这个名字（src/stage/three/style/<样式的名字>/<样式的名字>.ts）`).toBeDefined();
      expect(manifest[key].isDynamicEntry, `${key} 在清单里没有标成“用到时才下载”`).toBe(true);
      for (const entry of [ENGINE_ENTRY, ROUTE_ENTRY, PAGE_ENTRY]) expect(staticClosure(manifest, entry), `${key} 成了 ${entry} 一来就带着的东西`).not.toContain(key);
      // 整套另外要下载的正好是两个文件（它自己，和它引的那一半）；那一半另外要下载的只有它自己：和沙盘程序共用的东西留在沙盘程序里，没有另拆一块
      expect(extra(key), `${key} 另外要下载的文件`).toEqual([manifest[key].file, manifest[halfKey].file]);
      expect(extra(halfKey), `${halfKey} 另外要下载的文件`).toEqual([manifest[halfKey].file]);
      // 量大小的那个函数认到的也是它们
      const measured = sizes.styles.find((one) => one.id === id);
      expect(measured, `量不出样式“${id}”多大`).toBeDefined();
      expect(measured?.files).toEqual([manifest[key].file, manifest[halfKey].file]);
      expect(measured?.route?.files).toEqual([manifest[halfKey].file]);
      expect(measured?.route?.gzip ?? 0).toBeGreaterThan(0);
      expect(measured?.route?.gzip ?? 0).toBeLessThan(measured?.gzip ?? 0);
      expect(measured?.routeIsDynamic).toBe(true);
      expect(measured?.gzip).toBeGreaterThan(0);
      expect(measured?.isDynamic).toBe(true);
      expect(measured?.inOthers).toBe(false);
      expect(measured?.halfOnly, `样式“${id}”是整套的，却被认成只有那一半`).toBeUndefined();
    }
    // 清单里的样式正好是登记表里的那几种
    expect(sizes.styles.map((one) => one.id).sort()).toEqual(STYLES.map((row) => row.id).sort());
    // 沙盘程序还是一个文件，页面一打开就下载的程序也还是一个文件（样式的那一句动态 import 写在页面那一边，没有把哪一边拆开）
    expect(sizes.engine?.files).toEqual([manifest[ENGINE_ENTRY].file]);
    expect(sizes.page?.files).toEqual([manifest[PAGE_ENTRY].file]);
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

  // 2026-11-26 以前的名字是“content/ 里的每一座沙盘：沙盘程序加上它要下载的那几块，不超过 230,000 字节；徐州和全程沙盘一家也不下载”：
  // 那时样式在沙盘程序里面。现在它是单独的一块，每座沙盘的那一笔账里添上它自己的样式；上限还是那个数。
  it(`content/ 里的每一座沙盘：沙盘程序加上它自己的样式、加上它要下载的那几块，不超过 ${withCommas(ENGINE_GZIP_MAX)} 字节；徐州和全程沙盘一家也不下载`, () => {
    expect(existsSync(MANIFEST), '没有 dist/.vite/manifest.json：先运行 npm run build').toBe(true);
    const manifest = readManifest(new TextDecoder().decode(readFileSync(MANIFEST)));
    const sizes = programSizes(manifest, gzipOnDisk);
    const engine = sizes.engine?.gzip ?? 0;
    const route = sizes.route?.gzip ?? 0;
    expect(engine).toBeGreaterThan(0);
    /**
     * 这座沙盘的场景里写的样式，它要下载的那一部分多大：站点沙盘是整套（两块），全程沙盘只是每一座沙盘都用的那一半。
     * 清单里量不到它（没有登记，或者被打进了别的块）就不通过。
     */
    const styleOf = (key: string, id: string, route = false): number => {
      const found = sizes.styles.find((one) => one.id === id);
      expect(found, `${key} 的场景里写的样式“${id}”在构建出来的东西里量不到`).toBeDefined();
      // 只有全程沙盘用的样式（清单里只有那一半）：站点沙盘下载不到它（校验的规则 10 也不让站点沙盘写它）
      expect(!route && found?.halfOnly === true, `${key} 是站点沙盘，写的样式“${id}”只有全程沙盘用的那一半`).toBe(false);
      const gzip = (route ? (found?.route ?? found)?.gzip : found?.gzip) ?? 0;
      expect(gzip, `${key} 的样式“${id}”量不出大小`).toBeGreaterThan(0);
      return gzip;
    };
    const lines: string[] = [];
    const stops = realSceneKeys();
    expect(stops).toContain('su-shi/xuzhou');
    for (const key of stops) {
      const scene = realSceneFile(key).scene;
      const names = familyNamesFor(scene);
      const each = names.map((name) => ({ name, gzip: familyFiles(manifest, name).reduce((sum, file) => sum + gzipOnDisk(file), 0) }));
      const style = styleOf(key, scene.style);
      const total = engine + style + each.reduce((sum, family) => sum + family.gzip, 0);
      lines.push(`${key}：沙盘程序 ${withCommas(engine)} + 样式 ${scene.style} ${withCommas(style)}${each.map((family) => ` + ${family.name} ${withCommas(family.gzip)}`).join('')} = ${withCommas(total)} 字节，离上限 ${withCommas(ENGINE_GZIP_MAX - total)}${names.length ? '' : '（一家也不下载）'}`);
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
      const style = styleOf(key, realRouteScene(key).scene.style, true);
      lines.push(`${key}：沙盘程序 ${withCommas(engine)} + 全程沙盘那一块 ${withCommas(route)} + 样式 ${realRouteScene(key).scene.style} 的一半 ${withCommas(style)} = ${withCommas(engine + route + style)} 字节，离上限 ${withCommas(ENGINE_GZIP_MAX - engine - route - style)}（一家也不下载）`);
      expect(engine + route + style, `${key} 要下载的程序超过了上限`).toBeLessThanOrEqual(ENGINE_GZIP_MAX);
    }
    console.log(['每一座沙盘要下载的程序（压缩以后）', ...lines.map((line) => `  ${line}`), ...FAMILIES.map(({ name, holds }) => `  ${name} 这一家：${holds.join('、')}　${withCommas(familyFiles(manifest, name).reduce((sum, file) => sum + gzipOnDisk(file), 0))} 字节　${manifest[familyEntry(name)].file}`)].join('\n'));
  });
});

describe('沙盘用到的文件的网址', () => {
  // 2026-11-25 以前的名字是“单独一块，用到时才下载；页面一打开就下载的程序里一个也没有”：那时网址自己是一块（sceneFileUrls.ts），
  // 读一座沙盘时才去要。现在它们在内容的清单那一块里，页面的程序一开始跑就去要；查的几样没有变。
  it('在内容的清单那一块里，那一块是页面用动态 import 取的、不在页面的程序里；页面一打开就下载的程序里一个网址也没有', () => {
    expect(existsSync(MANIFEST), '没有 dist/.vite/manifest.json：先运行 npm run build').toBe(true);
    const manifest = readManifest(new TextDecoder().decode(readFileSync(MANIFEST)));
    const urls = manifest[LISTS_ENTRY];
    expect(urls, `清单里没有 ${LISTS_ENTRY} 这一项：它被打进了别的块，或者挪了地方（挪了就改 tests/content/budgetRules.ts 的 LISTS_ENTRY）`).toBeDefined();
    expect(urls.isDynamicEntry, '内容的清单那一块在构建清单里没有标成“用到时才下载”（用动态 import 取）').toBe(true);
    const pageKeys = staticClosure(manifest, PAGE_ENTRY);
    expect(pageKeys, '内容的清单那一块成了页面一打开就下载的东西').not.toContain(LISTS_ENTRY);
    // 它里面写着网址的文件：content/ 里有沙盘的话，至少有一个地形文件
    const files = (urls.assets ?? []).map((file) => file.slice(file.lastIndexOf('/') + 1));
    expect(files.length).toBeGreaterThan(0);
    expect(files.some((file) => /\.terrain-[^.]+\.bin$/.test(file)), '那一块里没有地形文件的网址').toBe(true);
    const page = pageKeys.map((key) => new TextDecoder().decode(readFileSync(new URL(manifest[key].file, DIST)))).join(' ');
    expect(files.filter((file) => page.includes(file)), '这几个文件的网址出现在页面一打开就下载的程序里').toEqual([]);
    console.log(`  内容的清单那一块（压缩以后）：${withCommas(gzipOnDisk(urls.file))} 字节，里面有 ${files.length} 个网址；页面的程序一开始跑就去要　${urls.file}`);
  });

  // content/ 里的文件不许塞进程序里（vite.config.ts 的 assetsInlineLimit）：打包的工具平常把 4 KB 以下的小文件写成 data: 地址塞进引它的那一块，
  // 一张很小的图片就进了每位读者一打开都要下载的这一块。这一条守着那一句规矩，也守着这一块自己的上限（tests/content/budgetRules.ts）。
  it(`内容的清单那一块里只有网址：content/ 里的每一张图片、每一个地形文件在 dist/ 里都是它自己的一个文件，字节和仓库里的一样，没有哪一个被写成 data: 地址塞进程序里；这一块压缩以后不超过 ${withCommas(SMALL_CHUNKS.lists.max)} 字节（过了 ${withCommas(SMALL_CHUNKS.lists.warnAbove)} 提醒）`, () => {
    expect(existsSync(MANIFEST), '没有 dist/.vite/manifest.json：先运行 npm run build').toBe(true);
    const manifest = readManifest(new TextDecoder().decode(readFileSync(MANIFEST)));
    const lists = manifest[LISTS_ENTRY];
    // 那一块里直接写着网址的文件（地形文件，先画好的地面的两张图，定格图），和正文里的图片（它的网址是用到时才读的一小块，不直接写在那一块里）
    const written = [
      ...Object.keys(import.meta.glob('/content/figures/*/scenes/*.terrain.bin', { query: '?url' })),
      ...Object.keys(import.meta.glob('/content/figures/*/baked/*.{jpg,png}', { query: '?url' })),
      ...Object.keys(import.meta.glob('/content/figures/*/stills/*.{jpg,jpeg,png,webp,svg}', { query: '?url' })),
    ].map((path) => path.slice(1));
    const images = Object.keys(import.meta.glob('/content/figures/*/images/*', { query: '?url' })).map((path) => path.slice(1));
    const sources = [...written, ...images];
    expect(written.length).toBeGreaterThan(10);
    const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
    const listed = new Set(lists.assets ?? []);
    const small: string[] = [];
    for (const source of sources) {
      const item = manifest[source];
      expect(item, `${source} 在 dist/ 里不是它自己的一个文件（构建清单里没有这一项）：它多半被写成 data: 地址塞进了程序里`).toBeDefined();
      const original = readFileSync(new URL(`../../${source}`, import.meta.url));
      expect(sha(readFileSync(new URL(item.file, DIST))), `${source} 在 dist/ 里的那个文件（${item.file}）和仓库里的不是一样的字节`).toBe(sha(original));
      if (written.includes(source)) expect(listed.has(item.file), `${source} 的网址（${item.file}）没有列在内容的清单那一块里`).toBe(true);
      // 打包的工具平常会塞进去的那一种（不到 4 KB）：真的有这样的文件，这一条才算查到了东西
      if (original.length < 4096) small.push(`${source}（${withCommas(original.length)} 字节）`);
    }
    // 那一块列着的网址不多不少就是直接写着网址的那些文件
    expect(listed.size).toBe(written.length);
    // 构建出来的每一块程序里都没有 data: 开头的图片、字体、二进制文件
    const inlined = readdirSync(new URL('assets/', DIST))
      .filter((name) => name.endsWith('.js'))
      .filter((name) => /data:(image|font|application)\//.test(new TextDecoder().decode(readFileSync(new URL(`assets/${encodeURIComponent(name)}`, DIST)))));
    expect(inlined, '这几块程序里有写成 data: 地址的文件').toEqual([]);
    const report = smallChunkReport('lists', gzipOnDisk(lists.file), lists.file);
    console.log(`  ${report.lines.join('\n  ')}\n  里面有 ${listed.size} 个网址，一个 data: 地址也没有；content/ 里不到 4 KB 的文件 ${small.length} 个${small.length ? `：${small.join('、')}` : ''}`);
    for (const warn of report.warns) console.warn(`[check:size] 快到上限了：${warn}`);
    expect(report.fails).toEqual([]);
  });
});

describe('内容的清单', () => {
  /** 构建清单里 content/ 下面的各项（内容文件各自的那一小块，和图片、地形文件），连同构建出来的文件名（不带文件夹）。 */
  const contentItems = (manifest: BuildManifest): { key: string; name: string }[] =>
    Object.keys(manifest)
      .filter((key) => key.startsWith('content/'))
      .sort()
      .map((key) => ({ key, name: manifest[key].file.slice(manifest[key].file.lastIndexOf('/') + 1) }));
  const read = (file: string): string => new TextDecoder().decode(readFileSync(new URL(file, DIST)));

  it('页面一打开就下载的程序里，内容文件只列着两种：首页的卡片，每位人物的 figure.json（一位人物一项）；别的一个也没有', () => {
    expect(existsSync(MANIFEST), '没有 dist/.vite/manifest.json：先运行 npm run build').toBe(true);
    const manifest = readManifest(new TextDecoder().decode(readFileSync(MANIFEST)));
    const page = staticClosure(manifest, PAGE_ENTRY).map((key) => read(manifest[key].file)).join(' ');
    const figures = Object.keys(import.meta.glob('/content/figures/*/figure.json')).map((path) => path.slice(1));
    expect(figures.length).toBeGreaterThan(0);
    const items = contentItems(manifest);
    expect(items.length).toBeGreaterThan(figures.length + 1);
    const named = items.filter((item) => page.includes(item.name)).map((item) => item.key);
    expect(named, '页面一打开就下载的程序里列着的内容文件').toEqual(['content/figures/index.json', ...figures].sort());
    console.log(`  页面的程序里列着 ${named.length} 个内容文件（首页的卡片，${figures.length} 位人物的 figure.json）；content/ 里一共 ${items.length} 项`);
  });

  it('每位人物别的文件——各站的 .json 和正文、图片、场景文件、两种清单、行迹的出处——都列在内容的清单那一块里，是用到时才下载的一小块', () => {
    const manifest = readManifest(new TextDecoder().decode(readFileSync(MANIFEST)));
    const lists = read(manifest[LISTS_ENTRY].file);
    const globbed = [
      ...Object.keys(import.meta.glob('/content/figures/*/stops/*.json')),
      ...Object.keys(import.meta.glob('/content/figures/*/stops/*.md')).map((path) => `${path}?raw`),
      ...Object.keys(import.meta.glob('/content/figures/*/images/*')).map((path) => `${path}?url`),
      ...Object.keys(import.meta.glob('/content/figures/*/scenes/*.json')),
      ...Object.keys(import.meta.glob('/content/figures/*/stills/*.json')),
      ...Object.keys(import.meta.glob('/content/figures/*/baked/*.json')),
      ...Object.keys(import.meta.glob('/content/figures/*/itinerary.json')),
    ].map((path) => path.slice(1));
    expect(globbed.length).toBeGreaterThan(10);
    for (const key of globbed) {
      const item = manifest[key];
      expect(item, `构建清单里没有 ${key} 这一项`).toBeDefined();
      expect(item.isDynamicEntry, `${key} 在构建清单里没有标成“用到时才下载”`).toBe(true);
      expect(lists.includes(item.file.slice(item.file.lastIndexOf('/') + 1)), `${key} 的那一小块（${item.file}）没有列在内容的清单那一块里`).toBe(true);
    }
    // 人物的 figure.json、首页的卡片不在这一块里列着：它们是页面自己列的
    for (const key of ['content/figures/index.json', ...Object.keys(import.meta.glob('/content/figures/*/figure.json')).map((path) => path.slice(1))]) {
      const name = manifest[key].file.slice(manifest[key].file.lastIndexOf('/') + 1);
      expect(lists.includes(name), `${key} 列在了内容的清单那一块里`).toBe(false);
    }
    // 它另外要下载的只有它自己那一个文件（它引的是页面的程序里取文件的那个小函数，页面的程序没有因此被拆成两个文件：最后一组查着）
    const have = new Set(staticClosure(manifest, PAGE_ENTRY).map((key) => manifest[key].file));
    const files = staticClosure(manifest, LISTS_ENTRY).map((key) => manifest[key].file);
    expect(files.filter((file, i) => !have.has(file) && files.indexOf(file) === i)).toEqual([manifest[LISTS_ENTRY].file]);
    expect(manifest[LISTS_ENTRY].css ?? []).toEqual([]);
  });
});

describe('时间轴的那一块', () => {
  // 2026-11-27 以前这一条的名字末尾是“多大印出来（没有单独的上限）”：那时它没有自己的上限。别的几样没有动。
  it(`单独一块，栏里摆上全程沙盘才下载；它另外要下载的只有它自己那一个文件；压缩以后不超过 ${withCommas(SMALL_CHUNKS.bar.max)} 字节（过了 ${withCommas(SMALL_CHUNKS.bar.warnAbove)} 提醒），多大印出来`, () => {
    expect(existsSync(MANIFEST), '没有 dist/.vite/manifest.json：先运行 npm run build').toBe(true);
    const manifest = readManifest(new TextDecoder().decode(readFileSync(MANIFEST)));
    const bar = manifest[BAR_ENTRY];
    expect(bar, `清单里没有 ${BAR_ENTRY} 这一项：它被打进了别的块（多半是页面那一块），或者挪了地方（挪了就改 tests/content/budgetRules.ts 的 BAR_ENTRY）`).toBeDefined();
    expect(bar.isDynamicEntry, '时间轴的那一块在清单里没有标成“用到时才下载”').toBe(true);
    // 沙盘程序、全程沙盘那一块、页面的程序都不带着它
    for (const entry of [PAGE_ENTRY, ENGINE_ENTRY, ROUTE_ENTRY]) expect(staticClosure(manifest, entry), `时间轴的那一块成了 ${entry} 一来就带着的东西`).not.toContain(BAR_ENTRY);
    // 它另外要下载的只有它自己那一个文件：和页面共用的东西（React）留在页面的程序里，没有另拆一块；它自己也没有样式表
    const have = new Set(staticClosure(manifest, PAGE_ENTRY).map((key) => manifest[key].file));
    const files = staticClosure(manifest, BAR_ENTRY).map((key) => manifest[key].file);
    expect(files.filter((file, i) => !have.has(file) && files.indexOf(file) === i)).toEqual([bar.file]);
    expect(bar.css ?? [], '时间轴的那一块自己带了样式表：它的样式写在页面的样式表里（src/styles/timebar.css，由 StagePane.tsx 引）').toEqual([]);
    const report = smallChunkReport('bar', gzipOnDisk(bar.file), bar.file);
    console.log(`  ${report.lines.join('\n  ')}\n  栏里摆上有行迹的人物的全程沙盘才下载`);
    for (const warn of report.warns) console.warn(`[check:size] 快到上限了：${warn}`);
    expect(report.fails).toEqual([]);
  });
});

describe('另一种题签（平着的纸条）的那一块', () => {
  it('单独一块，写了这一种题签的沙盘才下载；页面的程序、沙盘程序、全程沙盘那一块都不带着它，它自己什么也不引；页面的程序还是一个文件；多大印出来（没有单独的上限）', () => {
    expect(existsSync(MANIFEST), '没有 dist/.vite/manifest.json：先运行 npm run build').toBe(true);
    const manifest = readManifest(new TextDecoder().decode(readFileSync(MANIFEST)));
    const read = (file: string): string => new TextDecoder().decode(readFileSync(new URL(file, DIST)));
    const slips = manifest[SLIPS_ENTRY];
    expect(slips, `清单里没有 ${SLIPS_ENTRY} 这一项：它被打进了别的块（多半是页面那一块），或者挪了地方（挪了就改 tests/content/budgetRules.ts 的 SLIPS_ENTRY）`).toBeDefined();
    expect(slips.isDynamicEntry, '平着的纸条的那一块在清单里没有标成“用到时才下载”').toBe(true);
    for (const entry of [PAGE_ENTRY, ENGINE_ENTRY, ROUTE_ENTRY]) expect(staticClosure(manifest, entry), `平着的纸条的那一块成了 ${entry} 一来就带着的东西`).not.toContain(SLIPS_ENTRY);
    // 它自己什么也不引（连页面的程序也不引）：要下载的只有它这一个文件；它引了页面里的文件的话，打包的工具会把那个文件从页面的程序里单拆出去
    expect(staticClosure(manifest, SLIPS_ENTRY)).toEqual([SLIPS_ENTRY]);
    expect(slips.css ?? [], '平着的纸条的那一块自己带了样式表：它的样式写在页面的样式表里（src/styles/stage.css 末尾）').toEqual([]);
    // 页面一打开就下载的程序还是一个文件
    expect(staticClosure(manifest, PAGE_ENTRY).filter((key) => manifest[key].file.endsWith('.js'))).toEqual([PAGE_ENTRY]);
    // 平着的纸条的东西（它的类名、它的摆法里的缘故）只在这一块里：读竖着的纸条的沙盘的人，页面的程序、沙盘程序、全程沙盘那一块里都没有它们
    const chunk = read(slips.file);
    for (const word of ['strip-slip', 'strip-disc', 'strip-name']) {
      expect(chunk, `平着的纸条的那一块里没有 ${word}`).toContain(word);
      for (const entry of [PAGE_ENTRY, ENGINE_ENTRY, ROUTE_ENTRY]) expect(read(manifest[entry].file).includes(word), `${entry} 的那一块里有 ${word}`).toBe(false);
    }
    console.log(`  平着的纸条（另一种题签）的那一块（压缩以后）：${withCommas(gzipOnDisk(slips.file))} 字节（没有单独的上限），写了这一种题签的沙盘才下载　${slips.file}`);
  });
});

// 时间轴的那一块的后一条（和上面那一组同名：这一条的名字照旧）
describe('时间轴的那一块', () => {
  it('时间轴上固定的字在时间轴的那一块里，不在页面的程序里；每位人物时间轴用的那一份行迹也只在那一块里', () => {
    expect(existsSync(MANIFEST), '没有 dist/.vite/manifest.json：先运行 npm run build').toBe(true);
    const manifest = readManifest(new TextDecoder().decode(readFileSync(MANIFEST)));
    const read = (file: string): string => new TextDecoder().decode(readFileSync(new URL(file, DIST)));
    const page = staticClosure(manifest, PAGE_ENTRY).map((key) => read(manifest[key].file)).join(' ');
    const chunk = read(manifest[BAR_ENTRY].file);
    // 固定的字
    for (const word of [BAR_TEXT.play, BAR_TEXT.pause, BAR_TEXT.prev, BAR_TEXT.next, BAR_TEXT.note, BAR_TEXT.noteName, BAR_TEXT.enterName, BAR_TEXT.age]) {
      expect(page.includes(word), `“${word}”出现在页面一打开就下载的程序里：src/timebar/barText.ts 的字只许经 SANS_LABELS 那张表进页面的文件，那张表打包的时候是去掉的`).toBe(false);
      expect(chunk.includes(word), `“${word}”不在时间轴的那一块里`).toBe(true);
    }
    // 每位人物的行迹：最前一个位置的那一句、每一段的第二行，都在那一块里，页面的程序里一句也没有
    const bars = Object.entries(import.meta.glob<{ first: { says: string }; stretches: { id: string; says: string }[] }>('/content/figures/*/itinerary.bar.json', { import: 'default', eager: true }));
    expect(bars.length).toBeGreaterThan(0);
    for (const [path, made] of bars) {
      for (const says of [made.first.says, ...made.stretches.map((stretch) => stretch.says)]) {
        expect(page.includes(says), `${path} 里的“${says}”出现在页面一打开就下载的程序里：src/timebar/barData.ts 被页面的文件引了`).toBe(false);
        expect(chunk.includes(says), `${path} 里的“${says}”不在时间轴的那一块里`).toBe(true);
      }
    }
  });
});

describe('手写的那一份行迹', () => {
  // 2026-11-25 以前的名字是“手写的那一份行迹不在页面的程序里，也不在时间轴的那一块里；凭据点开才下载的那一块里只有它的出处”：
  // 那时每位人物的出处都打在凭据的那一块里。现在每位人物的出处是他自己的一小块（读者在他的人物页上点开凭据才取），
  // 凭据的那一块里一条也没有；“只有 sources 一个字段进网站”照旧查，查的是那一小块。
  it('手写的那一份行迹不在页面的程序里，不在时间轴的那一块里，也不在凭据点开才下载的那一块里；每位人物的出处是他自己的一小块，里面只有出处', () => {
    expect(existsSync(MANIFEST), '没有 dist/.vite/manifest.json：先运行 npm run build').toBe(true);
    const manifest = readManifest(new TextDecoder().decode(readFileSync(MANIFEST)));
    const read = (file: string): string => new TextDecoder().decode(readFileSync(new URL(file, DIST)));
    const page = staticClosure(manifest, PAGE_ENTRY).map((key) => read(manifest[key].file)).join(' ');
    const bar = read(manifest[BAR_ENTRY].file);
    const fold = read(manifest['src/ui/ProvenanceBody.tsx'].file);
    const lists = read(manifest[LISTS_ENTRY].file);
    interface Hand {
      about: unknown;
      sources: { cite: string; read: string }[];
      stretches: { id: string; note?: string; where?: string; waypoints?: { note?: string }[] }[];
    }
    const hands = Object.entries(import.meta.glob<Hand>('/content/figures/*/itinerary.json', { import: 'default', eager: true }));
    expect(hands.length).toBeGreaterThan(0);
    /** 一样东西里所有的字（一层一层找下去）。 */
    const strings = (value: unknown): string[] => (typeof value === 'string' ? [value] : value !== null && typeof value === 'object' ? Object.values(value).flatMap(strings) : []);
    // 程序里的字是照 JSON 的写法存的（引号、反斜杠前面多一道反斜杠）
    const written = (text: string): string => JSON.stringify(text).slice(1, -1);
    for (const [path, hand] of hands) {
      const made = new TextDecoder().decode(readFileSync(new URL(`../..${path.replace('itinerary.json', 'itinerary.bar.json')}`, import.meta.url)));
      // 这位人物的出处自己的那一小块：用到时才下载，只有内容的清单那一块里列着它（页面的程序里没有它的名字）
      const item = manifest[path.slice(1)];
      expect(item, `构建清单里没有 ${path.slice(1)} 这一项：这位人物的出处没有成为单独的一小块`).toBeDefined();
      expect(item.isDynamicEntry, `${path} 的出处那一小块没有标成“用到时才下载”`).toBe(true);
      const name = item.file.slice(item.file.lastIndexOf('/') + 1);
      expect(lists.includes(name), `${path} 的出处那一小块没有列在内容的清单那一块里`).toBe(true);
      expect(page.includes(name), `${path} 的出处那一小块列在了页面一打开就下载的程序里`).toBe(false);
      const own = read(item.file);
      // 出处：每一条的写法和“读了什么”都在他自己的那一小块里；“读了什么”只在那一小块里
      expect(hand.sources.length).toBeGreaterThan(0);
      for (const source of hand.sources) {
        expect(own.includes(written(source.cite)), `${path} 的出处“${source.cite}”不在这位人物的出处那一小块里`).toBe(true);
        expect(own.includes(written(source.read)), `${path} 的“${source.read}”不在这位人物的出处那一小块里`).toBe(true);
        if (source.read.length < 8) continue;
        expect(page.includes(written(source.read)), `${path} 的“${source.read}”出现在页面一打开就下载的程序里`).toBe(false);
        expect(bar.includes(written(source.read)), `${path} 的“${source.read}”出现在时间轴的那一块里`).toBe(false);
        expect(fold.includes(written(source.read)), `${path} 的“${source.read}”出现在凭据点开才下载的那一块里：每位人物的出处该在他自己的那一小块里`).toBe(false);
        expect(lists.includes(written(source.read)), `${path} 的“${source.read}”出现在内容的清单那一块里`).toBe(false);
      }
      // 别的字段：说明这份文件怎么写的那几段（about），每一段、路上每一处考证的话（note）——时间轴用的那一份里没有的，哪一块里都没有
      const rest = [...strings(hand.about), ...hand.stretches.flatMap((stretch) => [stretch.note, ...(stretch.waypoints ?? []).map((point) => point.note)])]
        .filter((text): text is string => typeof text === 'string' && text.length >= 12 && !made.includes(written(text)));
      expect(rest.length, `${path}：about 和 note 里够长的话`).toBeGreaterThan(20);
      for (const text of rest) {
        for (const [where, chunk] of [['页面一打开就下载的程序', page], ['时间轴的那一块', bar], ['凭据点开才下载的那一块', fold], ['这位人物的出处那一小块', own], ['内容的清单那一块', lists]] as const) {
          expect(chunk.includes(written(text)), `${path} 里的“${text.slice(0, 30)}…”出现在${where}里：只有 sources 一个字段该进网站`).toBe(false);
        }
      }
      console.log(`  ${path.slice(1)} 的出处那一小块（压缩以后）：${withCommas(gzipOnDisk(item.file))} 字节，${hand.sources.length} 条，读者在这位人物的人物页上点开凭据才下载　${item.file}`);
    }
  });
});

describe('点开才下载的几块', () => {
  /** 用到才下载的几段界面程序：凭据里面的东西，讲解员面板里面的东西，“来源”页里面的东西（这三段点开才下载），和全程沙盘下面的时间轴（栏里摆上全程沙盘才下载）。 */
  const ON_DEMAND = ['src/ui/ProvenanceBody.tsx', 'src/ui/GuideBody.tsx', 'src/ui/SourcesBody.tsx', BAR_ENTRY];

  it('各是单独一块，页面一打开就下载的东西里没有它们；三套字体的那张表跟着“来源”页的那一块走；页面的程序只有一个文件（React 没有被单拆出去）', () => {
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
    const sourcesChunk = new TextDecoder().decode(readFileSync(new URL(manifest['src/ui/SourcesBody.tsx'].file, DIST)));
    expect(sourcesChunk.includes(SOURCES_TEXT.lead), '“来源”页上的话不在它自己的那一块里').toBe(true);
    // 三套字体的那张表（原字体叫什么、哪一版、网站、许可文件：src/fonts/shipped.ts）也跟着“来源”页的那一块走。
    // 页面一打开就下载的程序只引 src/fonts/probe.ts（两个字体名称、一个字）；哪个文件又引了 shipped.ts，整张表就回到那一块里（约 220 字节）。
    for (const font of Object.values(SHIPPED_FONTS)) {
      for (const [what, value] of [['原字体的名字', font.name], ['许可文件', font.licence]] as const) {
        expect(page.includes(value), `${what}“${value}”出现在页面一打开就下载的程序里：三套字体的表只给“来源”页用，页面要名称、要那一个字，从 src/fonts/probe.ts 引`).toBe(false);
        expect(sourcesChunk.includes(value), `${what}“${value}”不在“来源”页的那一块里`).toBe(true);
      }
    }
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

/** 放进仓库的字体的记录（src/fonts/fonts.json，格式 4）：每个文件，和每一种页面拿哪几个。 */
interface CommittedRecord {
  files: (CommittedFont & { role: 'rest' | 'pressed'; bytes: number })[];
  pages: { kind: string; figure: string | null; unit: string | null; rest: string[]; pressed: string[]; bytes: number }[];
}
function committedRecord(): CommittedRecord {
  return JSON.parse(utf8.decode(readFileSync(new URL('../../src/fonts/fonts.json', import.meta.url)))) as CommittedRecord;
}
/** 放进仓库的字体文件（src/fonts/fonts.json 里记的）。 */
function committedFonts(): CommittedFont[] {
  return committedRecord().files.map(({ file, sha256, range, preload, sheet, scope, unit, source }) => ({ file, sha256, range, preload, sheet, scope, unit, source }));
}

describe('随站的字体在构建出来的网站里', () => {
  it('dist/ 里正好是放进仓库的那几个字体文件（框架的两个，和各个范围的）；index.html 里生效的预先声明就是框架的两个，先不生效的那一段正好是各个范围不用点开就要的黑体、宋体文件各一行，地址和样式表里写的是同一个文件；点开才要的字各在自己的一份样式表里，不在页面一打开就读的那一份里；大小不超过上限', () => {
    expect(existsSync(MANIFEST), '没有 dist/.vite/manifest.json：先运行 npm run build').toBe(true);
    // 是哪几个文件，照记录（src/fonts/fonts.json）来，不在这里另写一遍名字：记录对不对由 tests/fonts/font-files.test.ts 查
    const record = committedRecord();
    const committed = committedFonts();
    expect(committed.length).toBeGreaterThanOrEqual(4);
    const site = readBuiltSite();
    const built = builtFonts(site, committed);
    expect(built.problems).toEqual([]);
    expect(Object.keys(site.fonts)).toHaveLength(committed.length);
    expect(built.files.map((item) => item.file)).toEqual(committed.map((item) => item.file));
    // 一打开就下载的（index.html 里预先声明了、生效的）：正好是记录里说一打开就取的那几个——框架的黑体和宋体
    //（各个范围的文件先不生效，照地址合得上的才取；楷体不声明：页面知道要摆沙盘了才叫浏览器去取）
    expect(built.files.filter((item) => item.first).map((item) => item.file)).toEqual(committed.filter((item) => item.preload === 'always').map((item) => item.file));
    expect(built.files.filter((item) => item.first).map((item) => item.file).sort()).toEqual(['yanlu-sans.woff2', 'yanlu-song.woff2']);
    // 先不生效的那一段：各个范围不用点开就要的黑体、宋体文件各一行（builtFonts 一行一行对过了）；一行也没有就是这一段丢了
    const inert = fontPreloads(site.html).filter((link) => link.media === 'not all');
    expect(inert.length).toBe(committed.filter((item) => item.preload === 'scope').length);
    expect(inert.length).toBeGreaterThan(0);
    // 页面开头那几行照地址把合得上的几行抄一份生效的：这几行脚本构建以后还在 index.html 里，在页面的程序前面
    expect(site.html.indexOf('link[media="not all"]'), 'index.html 里照地址取字体的那几行脚本').toBeGreaterThan(-1);
    expect(site.html.indexOf('link[media="not all"]')).toBeLessThan(site.html.indexOf('type="module"'));
    // 一行不差：源文件 index.html 里不经过构建的那两段脚本（头一段就是照地址取字体的那几行），构建出来的 index.html 里原样都在
    //（那几行写得对不对由 tests/unit/page/font-scope.test.tsx 照源文件查；这里查构建没有动它）
    const plain = [...utf8.decode(readFileSync(new URL('../../index.html', import.meta.url))).matchAll(/<script>[\s\S]*?<\/script>/g)].map((match) => match[0]);
    expect(plain).toHaveLength(2);
    expect(plain[0]).toContain('link[media="not all"]');
    for (const script of plain) expect(site.html.includes(script), `构建出来的 index.html 里少了或者改了这一段脚本：${script.slice(0, 80)}…`).toBe(true);
    // 点开才要的字的样式表：一个范围一份，是它自己的文件，页面一打开不读它（index.html 挂着的样式表只有页面的那一份）
    const pageSheets = styleSheetLinks(site.html).map((href) => inDist(href, 'index.html'));
    expect(pageSheets).toHaveLength(1);
    const pressed = record.files.filter((item) => item.role === 'pressed');
    const pressedSheets = Object.entries(site.sheets).filter(([sheet, css]) => !pageSheets.includes(sheet) && fontFaces(css).length > 0);
    expect(pressedSheets).toHaveLength(pressed.length);
    // 大小量的是 dist/ 里的文件；每一种页面拿哪几个文件照记录，各算各的
    const builtBytes = new Map(built.files.map((item) => [item.file, item.bytes]));
    const named = (page: CommittedRecord['pages'][number]): string =>
      page.kind === 'frame' ? '只有框架的字的页面' : page.kind === 'sources' ? '“来源”页' : page.kind === 'home' ? `首页（摆着 ${page.figure}）` : page.unit ? `${page.figure}/${page.unit} 这一站` : `${page.figure} 的人物页`;
    const report = fontScopeReport({
      files: committed.map((item) => ({ file: item.file, bytes: builtBytes.get(item.file) ?? 0, frame: item.scope === 'frame' })),
      pages: record.pages.map((page) => ({ name: named(page), rest: page.rest, pressed: page.pressed })),
      sheets: pressedSheets.map(([sheet, css]) => ({ file: sheet, gzip: gzipSync(new TextEncoder().encode(css), { level: 9 }).length })),
    });
    const where = built.files.map((item) => `${item.file} → ${item.built}${item.first ? '（index.html 里预先声明了，一打开就下载）' : '（这一页要它才下载）'}`);
    console.log(['构建出来的网站带的字体有多大（.woff2 文件自己的字节数，不另外压缩）', ...report.lines.map((line) => `  ${line}`), ...where.map((line) => `  ${line}`)].join('\n'));
    for (const warn of report.warns) console.warn(`[check:size] 快到上限了：${warn}`);
    expect(report.fails).toEqual([]);
    // 记录里每一种页面的合计，就是 dist/ 里这几个文件的字节加起来
    for (const page of record.pages) expect(page.rest.reduce((sum, name) => sum + (builtBytes.get(name) ?? NaN), 0), named(page)).toBe(page.bytes);
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

  it('构建清单里每一项都从项目的根目录写起，没有一条整条的路径；点开才要的字的那几份样式表各有自己的一项，键就是它在仓库里的路径；构建出来的每一个程序、样式表、网页、清单里都没有这个项目所在的文件夹的名字（在哪个文件夹里构建，出来的都一样）', () => {
    expect(existsSync(MANIFEST), '没有 dist/.vite/manifest.json：先运行 npm run build').toBe(true);
    const manifest = readManifest(utf8.decode(readFileSync(MANIFEST)));
    /** 整条的路径：打头是“/”，或者盘符。 */
    const whole = /^([A-Za-z]:)?[\\/]/;
    expect(Object.keys(manifest).length).toBeGreaterThan(100);
    expect(Object.keys(manifest).filter((key) => whole.test(key)), '清单里写着整条路径的键').toEqual([]);
    expect(Object.values(manifest as Record<string, { src?: string }>).map((item) => item.src ?? '').filter((src) => whole.test(src)), '清单里写着整条路径的 src').toEqual([]);
    // 键照原来的先后排着
    expect(Object.keys(manifest)).toEqual(Object.keys(manifest).sort());
    // 点开才要的字的那几份样式表（src/fonts/scopes.ts 照地址引的）：各有自己的一项
    const sheets = [...new Set(committedRecord().files.filter((item) => item.role === 'pressed').map((item) => `src/fonts/${item.sheet}`))];
    expect(sheets.length).toBeGreaterThan(0);
    for (const sheet of sheets) {
      expect(manifest[sheet], `清单里没有 ${sheet} 这一项`).toBeDefined();
      expect(existsSync(inDistFolder(manifest[sheet].file)), `${sheet} → ${manifest[sheet].file}`).toBe(true);
    }
    // 这个项目所在的文件夹：斜杠朝哪边、反斜杠写没写成两个，都算
    const folder = decodeURIComponent(new URL('../../', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\/$/, '');
    expect(folder.length).toBeGreaterThan(3);
    const spellings = [folder, folder.split('/').join('\\'), folder.split('/').join('\\\\')];
    const texts = ['.js', '.css', '.html', '.json'].flatMap(filesEnding);
    expect(texts.length).toBeGreaterThan(50);
    expect(texts).toContain('.vite/manifest.json');
    const holding = texts.filter((file) => {
      const body = utf8.decode(readFileSync(inDistFolder(file))).toLowerCase();
      return spellings.some((spelling) => body.includes(spelling.toLowerCase()));
    });
    expect(holding, '构建出来的这几个文件里写着项目所在的文件夹').toEqual([]);
  });
});

describe('字体带得不对的时候这里通不过（用编出来的网页和样式表，走的是同一条路）', () => {
  // 编出来的网站，按范围分的八个文件：框架的两个（一打开就取）；人物 p 的黑体、楷体、宋体两个；他的一站 s 的宋体；“来源”页的。
  // 楷体不带 unicode-range、也不声明（页面知道要摆沙盘了才取）；点开才要的那一个带着 unicode-range，在它自己的一份样式表里
  const COMMITTED: CommittedFont[] = [
    { file: 'yanlu-sans.woff2', sha256: 'h', range: false, preload: 'always', sheet: 'fonts.css', scope: 'frame', unit: null, source: 'sans' },
    { file: 'yanlu-song.woff2', sha256: 's', range: false, preload: 'always', sheet: 'fonts.css', scope: 'frame', unit: null, source: 'song' },
    { file: 'scopes/yanlu-sans-p.woff2', sha256: 'ph', range: false, preload: 'scope', sheet: 'fonts.css', scope: 'p', unit: null, source: 'sans' },
    { file: 'scopes/yanlu-kai-p.woff2', sha256: 'k', range: false, preload: 'none', sheet: 'fonts.css', scope: 'p', unit: null, source: 'kai' },
    { file: 'scopes/yanlu-song-p.woff2', sha256: 'p', range: false, preload: 'scope', sheet: 'fonts.css', scope: 'p', unit: null, source: 'song' },
    { file: 'scopes/yanlu-song-p-more.woff2', sha256: 'm', range: true, preload: 'none', sheet: 'scopes/p.css', scope: 'p', unit: null, source: 'song' },
    { file: 'scopes/yanlu-song-p-s.woff2', sha256: 'u', range: false, preload: 'scope', sheet: 'fonts.css', scope: 'p', unit: 's', source: 'song' },
    { file: 'scopes/yanlu-song-credits.woff2', sha256: 'c', range: false, preload: 'scope', sheet: 'fonts.css', scope: 'sources', unit: null, source: 'song' },
  ];
  const FONTS = {
    'assets/sans-0.woff2': { bytes: 30_000, sha256: 'h' },
    'assets/kai-1.woff2': { bytes: 32_000, sha256: 'k' },
    'assets/song-2.woff2': { bytes: 116_000, sha256: 's' },
    'assets/more-3.woff2': { bytes: 128_000, sha256: 'm' },
    'assets/psans-4.woff2': { bytes: 30_000, sha256: 'ph' },
    'assets/psong-5.woff2': { bytes: 56_000, sha256: 'p' },
    'assets/unit-6.woff2': { bytes: 72_000, sha256: 'u' },
    'assets/credits-7.woff2': { bytes: 24_000, sha256: 'c' },
  };
  const RANGE = ';unicode-range:U+A9,U+2014';
  const face = (family: string, file: string, rest = ''): string => `@font-face{font-family:${family};src:url(./${file})format("woff2");font-weight:400;font-style:normal;font-display:swap${rest}}`;
  const MORE = face('Yanlu Song p', 'more-3.woff2', RANGE);
  const SHEET = [
    face('Yanlu Sans', 'sans-0.woff2').replace('font-weight:400', 'font-weight:500'),
    face('Yanlu Song', 'song-2.woff2'),
    face('Yanlu Sans p', 'psans-4.woff2').replace('font-weight:400', 'font-weight:500'),
    face('Yanlu Kai p', 'kai-1.woff2'),
    face('Yanlu Song p', 'psong-5.woff2'),
    face('Yanlu Song p s', 'unit-6.woff2'),
    face('Yanlu Song credits', 'credits-7.woff2'),
    '.a{color:red}',
  ].join('');
  const link = (file: string, rest = ' crossorigin'): string => `<link rel="preload" href="./assets/${file}" as="font" type="font/woff2"${rest} />`;
  /** 先不生效的一行：写着它是给谁的。 */
  const inert = (file: string, whose: string, rest = ' crossorigin'): string => link(file, `${rest} media="not all" ${whose}`);
  const INERT = {
    sans: inert('psans-4.woff2', 'data-fonts="p" data-fonts-family="sans" data-fonts-home'),
    song: inert('psong-5.woff2', 'data-fonts="p" data-fonts-family="song" data-fonts-home'),
    unit: inert('unit-6.woff2', 'data-fonts="p" data-fonts-unit="s" data-fonts-family="song"'),
    credits: inert('credits-7.woff2', 'data-fonts="sources" data-fonts-unit="" data-fonts-family="song"'),
  };
  const HTML = `<html><head>${link('sans-0.woff2')}${link('song-2.woff2')}${INERT.sans}${INERT.song}${INERT.unit}${INERT.credits}<link rel="stylesheet" crossorigin href="./assets/index.css"></head></html>`;
  const site = (change: Partial<BuiltSite> = {}): BuiltSite => ({ html: HTML, sheets: { 'assets/index.css': SHEET, 'assets/p.css': MORE }, fonts: FONTS, ...change });
  const sheet = (css: string, more = MORE): Partial<BuiltSite> => ({ sheets: { 'assets/index.css': css, 'assets/p.css': more } });

  it('都对：没有话说，预先声明了的两个是一打开就下载的', () => {
    const built = builtFonts(site(), COMMITTED);
    expect(built.problems).toEqual([]);
    expect(built.files).toEqual([
      { file: 'yanlu-sans.woff2', built: 'assets/sans-0.woff2', bytes: 30_000, first: true },
      { file: 'yanlu-song.woff2', built: 'assets/song-2.woff2', bytes: 116_000, first: true },
      { file: 'scopes/yanlu-sans-p.woff2', built: 'assets/psans-4.woff2', bytes: 30_000, first: false },
      { file: 'scopes/yanlu-kai-p.woff2', built: 'assets/kai-1.woff2', bytes: 32_000, first: false },
      { file: 'scopes/yanlu-song-p.woff2', built: 'assets/psong-5.woff2', bytes: 56_000, first: false },
      { file: 'scopes/yanlu-song-p-more.woff2', built: 'assets/more-3.woff2', bytes: 128_000, first: false },
      { file: 'scopes/yanlu-song-p-s.woff2', built: 'assets/unit-6.woff2', bytes: 72_000, first: false },
      { file: 'scopes/yanlu-song-credits.woff2', built: 'assets/credits-7.woff2', bytes: 24_000, first: false },
    ]);
  });

  it('不带 unicode-range、记录里又说不预先声明的文件：index.html 里没有它是对的，有了通不过；记录里说要预先声明的没有声明，也通不过', () => {
    // 这里的楷体文件就是这样：不声明是对的（上一项）；声明了（生效的一行），说得出来
    expect(builtFonts(site({ html: HTML.replace('</head>', `${link('kai-1.woff2')}</head>`) }), COMMITTED).problems).toEqual([
      'index.html 里预先声明的 ./assets/kai-1.woff2不是记录里说要预先声明的字体文件（要预先声明的是 assets/sans-0.woff2、assets/song-2.woff2）：会多下载一个文件，或者下载得太早',
    ]);
    // 反过来：记录改成“楷体一打开就取、框架的黑体不声明”，index.html 还是原来的两行——两处都说得出来
    const flipped = COMMITTED.map((item): CommittedFont => (item.file === 'scopes/yanlu-kai-p.woff2' ? { ...item, preload: 'always' } : item.file === 'yanlu-sans.woff2' ? { ...item, preload: 'none' } : item));
    expect(builtFonts(site(), flipped).problems).toEqual([
      'index.html 里预先声明的 ./assets/sans-0.woff2不是记录里说要预先声明的字体文件（要预先声明的是 assets/song-2.woff2、assets/kai-1.woff2）：会多下载一个文件，或者下载得太早',
      '记录里说要预先声明的 assets/kai-1.woff2 没有在 index.html 里预先声明',
    ]);
    // index.html 跟着改了：没有话说，框架的黑体不算一打开就下载的
    const flippedHtml = HTML.replace(link('sans-0.woff2'), link('kai-1.woff2'));
    const built = builtFonts(site({ html: flippedHtml }), flipped);
    expect(built.problems).toEqual([]);
    expect(built.files.filter((item) => item.first).map((item) => item.file)).toEqual(['yanlu-song.woff2', 'scopes/yanlu-kai-p.woff2']);
    // 带 unicode-range 的文件，记录里标成要预先声明：记错了
    const wrong = COMMITTED.map((item): CommittedFont => (item.file === 'scopes/yanlu-song-p-more.woff2' ? { ...item, preload: 'always' } : item));
    expect(builtFonts(site({ html: HTML.replace('</head>', `${link('more-3.woff2')}</head>`) }), wrong).problems).toEqual(['scopes/yanlu-song-p-more.woff2 带着 unicode-range（用到时才下载），记录里却说要预先声明']);
  });

  it('预先声明的和样式表里的成了两个文件（同一个字体有两份）：通不过', () => {
    const problems = builtFonts(site({ html: HTML.replace('song-2.woff2', 'song-9.woff2'), fonts: { ...FONTS, 'assets/song-9.woff2': { bytes: 116_000, sha256: 's' } } }), COMMITTED).problems;
    expect(problems).toContain('yanlu-song.woff2 在 dist/ 里有两份：assets/song-2.woff2 和 assets/song-9.woff2（同一个字体会下载两遍）');
    expect(problems).toContain('记录里说要预先声明的 assets/song-2.woff2 没有在 index.html 里预先声明');
  });

  it('预先声明少了 crossorigin、把第三个文件也预先声明了、少声明了一个：各有一句；写在注释里的不算声明了', () => {
    expect(builtFonts(site({ html: HTML.replace(link('song-2.woff2'), link('song-2.woff2', '')) }), COMMITTED).problems).toEqual(['index.html 里预先声明的 ./assets/song-2.woff2没有 crossorigin：浏览器取来的这一份样式表用不上，会再取一遍']);
    // 第三个：点开才要的那个文件，也写了一行生效的
    expect(builtFonts(site({ html: HTML.replace('</head>', `${link('more-3.woff2')}</head>`) }), COMMITTED).problems).toHaveLength(1);
    expect(builtFonts(site({ html: HTML.replace(link('song-2.woff2'), '') }), COMMITTED).problems).toEqual(['记录里说要预先声明的 assets/song-2.woff2 没有在 index.html 里预先声明']);
    expect(builtFonts(site({ html: HTML.replace(link('song-2.woff2'), `<!-- ${link('song-2.woff2')} -->`) }), COMMITTED).problems).toHaveLength(1);
  });

  it('dist/ 里的字体不是放进仓库的那一个、少了一个、font-display 不是 swap、第三个文件没带 unicode-range、指着别的网站：通不过', () => {
    expect(builtFonts(site({ fonts: { ...FONTS, 'assets/kai-1.woff2': { bytes: 32_000, sha256: 'x' } } }), COMMITTED).problems).toContain('dist/ 里的 assets/kai-1.woff2 不是放进仓库的字体文件（记号对不上）');
    const without = Object.fromEntries(Object.entries(FONTS).filter(([path]) => path !== 'assets/more-3.woff2'));
    expect(builtFonts(site({ sheets: { 'assets/index.css': SHEET }, fonts: without }), COMMITTED).problems).toContain('放进仓库的 scopes/yanlu-song-p-more.woff2 不在 dist/ 里：页面没有用上它');
    expect(builtFonts(site(sheet(SHEET.replace('font-display:swap', 'font-display:block'))), COMMITTED).problems.some((line) => line.includes('应该是 swap'))).toBe(true);
    expect(builtFonts(site(sheet(SHEET, MORE.replace(RANGE, ''))), COMMITTED).problems.some((line) => line.includes('unicode-range'))).toBe(true);
    expect(builtFonts(site(sheet(SHEET.replace('url(./kai-1.woff2)', 'url(https://fonts.example/kai.woff2)'))), COMMITTED).problems.some((line) => line.includes('指着别的网站'))).toBe(true);
  });

  it('按范围分的那几样带得不对，也通不过：先不生效的预先声明少了一行、行上写错了范围、站、黑体还是宋体，“来源”页的那一行没有写空的站，那一行生效了，没有 crossorigin；点开才要的字并进了页面一打开就读的那一份样式表，不用点开就要的落在了别的一份里；首页要的两行不是同一位人物的黑体和宋体', () => {
    const said = (html: string): string[] => builtFonts(site({ html }), COMMITTED).problems;
    // 少了一行
    expect(said(HTML.replace(INERT.unit, ''))).toEqual(['scopes/yanlu-song-p-s.woff2 是一个范围不用点开就要的文件，index.html 里没有它那一行先不生效的预先声明']);
    // 行上写错了：范围、站、黑体还是宋体，各一处
    const wrong = (line: string, from: string, to: string): string[] => said(HTML.replace(line, line.replace(from, to)));
    expect(wrong(INERT.unit, 'data-fonts="p"', 'data-fonts="q"')).toEqual([
      'index.html 里先不生效的预先声明 ./assets/unit-6.woff2（scopes/yanlu-song-p-s.woff2）行上写的是范围“q”、站“s”、song，记录里是范围“p”、站“s”、song：页面开头的脚本照这几样认这一行是给谁的',
    ]);
    expect(wrong(INERT.unit, 'data-fonts-unit="s"', 'data-fonts-unit="t"')).toHaveLength(1);
    expect(wrong(INERT.unit, ' data-fonts-unit="s"', '')).toHaveLength(1);
    // 黑体的一行写成了宋体：这一行对不上，首页要的那两行也就成了两行宋体——两句
    expect(wrong(INERT.sans, 'data-fonts-family="sans"', 'data-fonts-family="song"')).toHaveLength(2);
    // “来源”页的那一行要写着空的站：不写的话，地址 #/sources/… 上也会取它
    expect(wrong(INERT.credits, ' data-fonts-unit=""', '')).toEqual([
      'index.html 里先不生效的预先声明 ./assets/credits-7.woff2（scopes/yanlu-song-credits.woff2）行上写的是范围“sources”、站“（没有）”、song，记录里是范围“sources”、站“”、song：页面开头的脚本照这几样认这一行是给谁的',
    ]);
    // 那一行生效了（没有写 media="not all"）：每一页一打开都取它
    const live = said(HTML.replace(INERT.song, INERT.song.replace(' media="not all"', '')));
    expect(live).toContain('index.html 里预先声明的 ./assets/psong-5.woff2不是记录里说要预先声明的字体文件（要预先声明的是 assets/sans-0.woff2、assets/song-2.woff2）：会多下载一个文件，或者下载得太早');
    expect(live).toContain('scopes/yanlu-song-p.woff2 是一个范围不用点开就要的文件，index.html 里没有它那一行先不生效的预先声明');
    // 没有 crossorigin
    expect(wrong(INERT.unit, ' crossorigin', '')).toEqual(['index.html 里先不生效的预先声明 ./assets/unit-6.woff2没有 crossorigin：浏览器取来的这一份样式表用不上，会再取一遍']);
    // 一个不是哪个范围不用点开就要的文件（楷体）写了一行先不生效的
    expect(said(HTML.replace('</head>', `${inert('kai-1.woff2', 'data-fonts="p" data-fonts-family="kai"')}</head>`))).toEqual(['index.html 里先不生效的预先声明 ./assets/kai-1.woff2不是记录里哪个范围不用点开就要的黑体、宋体文件']);
    // 首页要的两行：换成了一行是一站的
    expect(said(HTML.replace(INERT.song, INERT.song.replace(' data-fonts-home', '')).replace(INERT.unit, INERT.unit.replace(' />', ' data-fonts-home />')))).toEqual([
      'index.html 里带着 data-fonts-home 的预先声明应该是同一位人物的黑体和宋体各一行，现在是 p sans、p s song',
    ]);
    // 样式表：点开才要的字并进了页面那一份；不用点开就要的落在了别的一份里
    expect(builtFonts(site({ sheets: { 'assets/index.css': SHEET + MORE } }), COMMITTED).problems).toEqual([
      'assets/index.css 里 Yanlu Song p 的 @font-face（scopes/yanlu-song-p-more.woff2）是点开才要的字，却并进了页面一打开就读的那一份样式表：它那一长串 unicode-range 每位读者一打开都要下载',
    ]);
    const moved = face('Yanlu Song p s', 'unit-6.woff2');
    expect(builtFonts(site({ sheets: { 'assets/index.css': SHEET.replace(moved, ''), 'assets/p.css': MORE + moved } }), COMMITTED).problems).toEqual([
      'assets/p.css 里不止一条 @font-face：点开才要的字的样式表一个范围一份，一份只有它自己的一条',
      'assets/p.css 里 Yanlu Song p s 的 @font-face（scopes/yanlu-song-p-s.woff2）不在页面一打开就读的那一份样式表里：这一页要它的时候还得等另一份样式表',
    ]);
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

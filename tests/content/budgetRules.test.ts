// 大小的上限和照着它们查的函数（budgetRules.ts）自己的测试：每一条都用编出来的大小试一遍“超了查得出、正好等于上限算合格”。
// 真的文件有多大不在这里查：内容里的由 validate.test.ts（规则 16、17、18）查，构建出来的由 tests/build/dist-size.test.ts 查。

import { describe, expect, it } from 'vitest';
import {
  COLOUR_PSNR_MIN,
  COLOUR_PSNR_MIN_ROUTE,
  DIST_MAX_BYTES,
  DIST_WARN_BYTES,
  ENGINE_ENTRY,
  ROUTE_ENTRY,
  ENGINE_GZIP_MAX,
  ENGINE_GZIP_WARN,
  FONT_FILE_MAX_BYTES,
  FONT_FILE_WARN_BYTES,
  FONT_FIRST_MAX_BYTES,
  PAGE_ENTRY,
  PAGE_GZIP_MAX,
  PAGE_GZIP_WARN,
  PICTURE_EDGE_MAX,
  STILL_MAX_BYTES,
  STYLE_GZIP_MAX,
  STYLE_GZIP_WARN,
  TABLE_FILES_MAX_BYTES,
  edgeTooLong,
  fontReport,
  kilobytes,
  megabytes,
  programReport,
  programSizes,
  psnrTooLow,
  staticClosure,
  stillTooBig,
  styleEntry,
  styleRouteEntry,
  tableFiles,
  verdict,
  withCommas,
} from './budgetRules';
import type { BuildManifest } from './budgetRules';

describe('上限是哪几个数', () => {
  it('内容里的文件：定格图 300 KB，一座沙盘的文件 1.5 MB，图片的边 2048 像素，颜色的清晰度 40', () => {
    expect(STILL_MAX_BYTES).toBe(307_200);
    expect(TABLE_FILES_MAX_BYTES).toBe(1_572_864);
    expect(PICTURE_EDGE_MAX).toBe(2048);
    expect(COLOUR_PSNR_MIN).toBe(40);
  });

  it('程序的下载量（压缩以后）：沙盘程序 230,000，页面 99,000，样式表 15,000；整个 dist/ 900 MB', () => {
    expect([ENGINE_GZIP_MAX, ENGINE_GZIP_WARN]).toEqual([230_000, 215_000]);
    expect([PAGE_GZIP_MAX, PAGE_GZIP_WARN]).toEqual([99_000, 90_000]);
    expect([STYLE_GZIP_MAX, STYLE_GZIP_WARN]).toEqual([15_000, 13_000]);
    expect([DIST_MAX_BYTES, DIST_WARN_BYTES]).toEqual([943_718_400, 524_288_000]);
  });

  it('随站的字体（字体文件自己的字节数）：首次打开要下载的合计 450 KB，一个文件 300 KB，过了 280 KB 提醒', () => {
    expect(FONT_FIRST_MAX_BYTES).toBe(460_800);
    expect([FONT_FILE_MAX_BYTES, FONT_FILE_WARN_BYTES]).toEqual([307_200, 286_720]);
  });
});

describe('一个数对着上限查', () => {
  it('正好等于上限算合格，多一点就不行', () => {
    expect(verdict(100, 100)).toBe('ok');
    expect(verdict(100.001, 100)).toBe('fail');
    expect(verdict(0, 100)).toBe('ok');
  });

  it('没超，但是过了提醒的线：提醒', () => {
    expect(verdict(80, 100, 80)).toBe('ok');
    expect(verdict(81, 100, 80)).toBe('warn');
    expect(verdict(100, 100, 80)).toBe('warn');
    expect(verdict(101, 100, 80)).toBe('fail');
  });

  it('大小写给人看：KB 往上取整，MB 两位小数，整数带千位的逗号', () => {
    expect(kilobytes(STILL_MAX_BYTES)).toBe('300 KB');
    expect(kilobytes(STILL_MAX_BYTES + 1)).toBe('301 KB');
    expect(megabytes(TABLE_FILES_MAX_BYTES)).toBe('1.50 MB');
    expect(megabytes(2_000_000)).toBe('1.91 MB');
    expect(withCommas(197_198)).toBe('197,198');
    expect(withCommas(950)).toBe('950');
    expect(withCommas(1_234_567.4)).toBe('1,234,567');
  });
});

describe('定格图、图片的边、颜色的清晰度', () => {
  it('定格图超过 300 KB', () => {
    expect(stillTooBig(STILL_MAX_BYTES)).toBe(false);
    expect(stillTooBig(STILL_MAX_BYTES + 1)).toBe(true);
    expect(stillTooBig(1)).toBe(false);
  });

  it('图片的宽或高超过 2048 像素', () => {
    expect(edgeTooLong(2048, 2048)).toBe(false);
    expect(edgeTooLong(2049, 100)).toBe(true);
    expect(edgeTooLong(100, 2049)).toBe(true);
    expect(edgeTooLong(1800, 1350)).toBe(false);
    expect(edgeTooLong(1171, 971)).toBe(false);
  });

  it('颜色压完以后的清晰度不到 40', () => {
    expect(psnrTooLow(40)).toBe(false);
    expect(psnrTooLow(39.99)).toBe(true);
    expect(psnrTooLow(41.4)).toBe(false);
    // 全程沙盘的那一张另有一个数：浏览器照 0.90 压出来是 37.05 分贝，定在低一分贝
    expect(COLOUR_PSNR_MIN_ROUTE).toBe(36);
    expect(psnrTooLow(37.05, COLOUR_PSNR_MIN_ROUTE)).toBe(false);
    expect(psnrTooLow(36, COLOUR_PSNR_MIN_ROUTE)).toBe(false);
    expect(psnrTooLow(35.99, COLOUR_PSNR_MIN_ROUTE)).toBe(true);
    // 站点沙盘的数没有跟着松：37 分贝在站点沙盘上还是太狠
    expect(psnrTooLow(37.05)).toBe(true);
  });
});

describe('一座沙盘的文件合计', () => {
  it('徐州现在的三个文件：811,136 字节，一半多一点，合格', () => {
    expect(tableFiles({ terrain: 277_220, colour: 279_735, fields: 254_181 })).toEqual({ total: 811_136, verdict: 'ok' });
  });

  it('正好 1.5 MB 合格（已经过了八成，提醒）；多一个字节不行', () => {
    expect(tableFiles({ terrain: 1_000_000, colour: 500_000, fields: 72_864 })).toEqual({ total: TABLE_FILES_MAX_BYTES, verdict: 'warn' });
    expect(tableFiles({ terrain: 1_000_000, colour: 500_000, fields: 72_865 }).verdict).toBe('fail');
    expect(tableFiles({ terrain: TABLE_FILES_MAX_BYTES + 1, colour: 0, fields: 0 }).verdict).toBe('fail');
  });

  it('过了八成提醒一句，正好八成不提醒', () => {
    const eighty = TABLE_FILES_MAX_BYTES * 0.8;
    expect(tableFiles({ terrain: Math.floor(eighty), colour: 0, fields: 0 }).verdict).toBe('ok');
    expect(tableFiles({ terrain: Math.floor(eighty) + 1, colour: 0, fields: 0 }).verdict).toBe('warn');
    // 颜色压得轻一些（质量 0.99）以后的徐州：1,118,000 字节上下，七成，不提醒
    expect(tableFiles({ terrain: 277_220, colour: 586_307, fields: 254_181 }).verdict).toBe('ok');
  });
});

// ---------------------------------------------------------------- 构建出来的程序（编出来的清单）

/** 和现在的构建一个样子的清单：页面一块，沙盘程序一块，沙盘程序和替身共用的一小块，一个用到才下载的内容文件。 */
function manifestLikeToday(): BuildManifest {
  return {
    [PAGE_ENTRY]: { file: 'assets/index-a.js', isEntry: true, dynamicImports: ['content/figures/index.json', ENGINE_ENTRY, 'src/ui/dev/fakeStage.ts'], css: ['assets/index-a.css'] },
    [ENGINE_ENTRY]: { file: 'assets/engine-b.js', isDynamicEntry: true, imports: [PAGE_ENTRY, '_strips-c.js'] },
    '_strips-c.js': { file: 'assets/strips-c.js' },
    'src/ui/dev/fakeStage.ts': { file: 'assets/fakeStage-d.js', isDynamicEntry: true, imports: [PAGE_ENTRY, '_strips-c.js'], css: ['assets/fakeStage-d.css'] },
    'content/figures/index.json': { file: 'assets/figures-e.js', isDynamicEntry: true },
  };
}

/** 编出来的大小：每个文件压缩以后多少字节。没有列的文件算 0。 */
function sizesOf(table: Record<string, number>): (file: string) => number {
  return (file) => table[file] ?? 0;
}

const TODAY = { 'assets/index-a.js': 84_000, 'assets/index-a.css': 4_900, 'assets/engine-b.js': 197_200, 'assets/strips-c.js': 1_400, 'assets/fakeStage-d.js': 1_500, 'assets/fakeStage-d.css': 300 };
const DIST_TODAY = 2_000_000;

describe('照构建清单找出页面和沙盘程序各是哪几块', () => {
  it('一项连同它一层一层静态引入的；用到才下载的不算；互相引入也不会转圈', () => {
    const manifest = manifestLikeToday();
    expect(staticClosure(manifest, PAGE_ENTRY)).toEqual([PAGE_ENTRY]);
    expect(staticClosure(manifest, ENGINE_ENTRY)).toEqual([ENGINE_ENTRY, PAGE_ENTRY, '_strips-c.js']);
    expect(staticClosure(manifest, 'no-such-entry')).toEqual([]);
    const loop: BuildManifest = { a: { file: 'a.js', imports: ['b'] }, b: { file: 'b.js', imports: ['a', 'c', 'gone'] }, c: { file: 'c.js' } };
    expect(staticClosure(loop, 'a')).toEqual(['a', 'b', 'c']);
  });

  it('页面：入口那一块。沙盘程序：它自己和它另外带的小块，页面已经带着的不重复算。样式表：页面的那一份', () => {
    const sizes = programSizes(manifestLikeToday(), sizesOf(TODAY));
    expect(sizes.page).toEqual({ files: ['assets/index-a.js'], gzip: 84_000 });
    expect(sizes.engine).toEqual({ files: ['assets/engine-b.js', 'assets/strips-c.js'], gzip: 198_600 });
    expect(sizes.style).toEqual({ files: ['assets/index-a.css'], gzip: 4_900 });
    expect(sizes.engineInPage).toBe(false);
    expect(sizes.engineIsDynamic).toBe(true);
  });

  it('两边共用的一小块要是页面也静态引入了，就算在页面头上，沙盘程序不再算它', () => {
    const manifest = manifestLikeToday();
    manifest[PAGE_ENTRY].imports = ['_strips-c.js'];
    const sizes = programSizes(manifest, sizesOf(TODAY));
    expect(sizes.page).toEqual({ files: ['assets/index-a.js', 'assets/strips-c.js'], gzip: 85_400 });
    expect(sizes.engine).toEqual({ files: ['assets/engine-b.js'], gzip: 197_200 });
  });

  it('页面静态引入的块带着的样式表也算；用到才下载的块的样式表不算', () => {
    const manifest = manifestLikeToday();
    manifest[PAGE_ENTRY].imports = ['_still-f.js'];
    manifest['_still-f.js'] = { file: 'assets/still-f.js', css: ['assets/still-f.css', 'assets/index-a.css'] };
    const sizes = programSizes(manifest, sizesOf({ ...TODAY, 'assets/still-f.js': 5_000, 'assets/still-f.css': 600 }));
    expect(sizes.style).toEqual({ files: ['assets/index-a.css', 'assets/still-f.css'], gzip: 5_500 });
    expect(sizes.page?.gzip).toBe(89_000);
  });
});

describe('程序的下载量对着上限查', () => {
  const report = (manifest: BuildManifest, table: Record<string, number> = TODAY, distBytes = DIST_TODAY) => programReport(programSizes(manifest, sizesOf(table)), distBytes);

  it('现在这么大：都合格，不提醒；表里四行', () => {
    const today = report(manifestLikeToday());
    expect(today.fails).toEqual([]);
    expect(today.warns).toEqual([]);
    expect(today.lines).toEqual([
      '页面的程序（压缩以后）：84,000 字节，上限 99,000（用了 85%）　assets/index-a.js',
      '样式表（压缩以后）：4,900 字节，上限 15,000（用了 33%）　assets/index-a.css',
      '沙盘程序（压缩以后）：198,600 字节，上限 230,000（用了 86%）　assets/engine-b.js、assets/strips-c.js',
      '整个 dist/：2,000,000 字节，上限 943,718,400（用了 0%）',
    ]);
  });

  it('沙盘程序超过 230,000 字节（比如把 three 整个引进来了）；正好 230,000 合格', () => {
    const over = report(manifestLikeToday(), { ...TODAY, 'assets/engine-b.js': ENGINE_GZIP_MAX - 1_400 + 1 });
    expect(over.fails).toEqual(['沙盘程序（压缩以后）有 230,001 字节，超过了上限 230,000']);
    const exact = report(manifestLikeToday(), { ...TODAY, 'assets/engine-b.js': ENGINE_GZIP_MAX - 1_400 });
    expect(exact.fails).toEqual([]);
    expect(exact.warns).toEqual(['沙盘程序（压缩以后）有 230,000 字节，快到上限 230,000 了（过了 215,000 就提醒）']);
  });

  it('沙盘程序自己不大，它另外带的一块大了，合起来超了也查得出', () => {
    const over = report(manifestLikeToday(), { ...TODAY, 'assets/strips-c.js': 40_000 });
    expect(over.fails).toEqual(['沙盘程序（压缩以后）有 237,200 字节，超过了上限 230,000']);
  });

  it('页面的程序超过 99,000 字节；过了 90,000 提醒', () => {
    expect(report(manifestLikeToday(), { ...TODAY, 'assets/index-a.js': 99_001 }).fails).toEqual(['页面的程序（压缩以后）有 99,001 字节，超过了上限 99,000']);
    const near = report(manifestLikeToday(), { ...TODAY, 'assets/index-a.js': 90_001 });
    expect(near.fails).toEqual([]);
    expect(near.warns).toEqual(['页面的程序（压缩以后）有 90,001 字节，快到上限 99,000 了（过了 90,000 就提醒）']);
    expect(report(manifestLikeToday(), { ...TODAY, 'assets/index-a.js': 99_000 }).fails).toEqual([]);
  });

  it('样式表超过 15,000 字节；整个 dist/ 超过 900 MB', () => {
    expect(report(manifestLikeToday(), { ...TODAY, 'assets/index-a.css': 15_001 }).fails).toEqual(['样式表（压缩以后）有 15,001 字节，超过了上限 15,000']);
    expect(report(manifestLikeToday(), { ...TODAY, 'assets/index-a.css': 13_001 }).warns).toEqual(['样式表（压缩以后）有 13,001 字节，快到上限 15,000 了（过了 13,000 就提醒）']);
    expect(report(manifestLikeToday(), TODAY, DIST_MAX_BYTES + 1).fails).toEqual(['整个 dist/有 943,718,401 字节，超过了上限 943,718,400']);
    expect(report(manifestLikeToday(), TODAY, DIST_MAX_BYTES).fails).toEqual([]);
    expect(report(manifestLikeToday(), TODAY, DIST_WARN_BYTES + 1).warns).toHaveLength(1);
  });

  it('沙盘程序成了页面一打开就下载的东西', () => {
    const manifest = manifestLikeToday();
    manifest[PAGE_ENTRY].imports = [ENGINE_ENTRY];
    manifest[ENGINE_ENTRY].imports = ['_strips-c.js'];
    const found = report(manifest);
    expect(found.fails).toHaveLength(2);
    // 页面连同它带着的沙盘程序，也就超了页面的上限
    expect(found.fails[0]).toBe('页面的程序（压缩以后）有 282,600 字节，超过了上限 99,000');
    expect(found.fails[1]).toContain('成了页面一打开就下载的东西');
    // 就算小到没有超，也不行：定格图的沙盘是页面直接带着的，它不能把沙盘程序拖进来
    const small = report(manifest, { 'assets/index-a.js': 10, 'assets/engine-b.js': 10 });
    expect(small.fails).toHaveLength(1);
    expect(small.fails[0]).toContain('成了页面一打开就下载的东西');
  });

  it('隔着一块引进来的也算（页面 → 定格图的沙盘 → 沙盘程序）', () => {
    const manifest = manifestLikeToday();
    manifest[PAGE_ENTRY].imports = ['_still-f.js'];
    manifest['_still-f.js'] = { file: 'assets/still-f.js', imports: [ENGINE_ENTRY] };
    manifest[ENGINE_ENTRY].imports = ['_strips-c.js'];
    expect(programSizes(manifest, sizesOf(TODAY)).engineInPage).toBe(true);
  });

  it('清单里没有沙盘程序这一项（被打进了页面那一块，或者挪了地方）', () => {
    const manifest = manifestLikeToday();
    delete manifest[ENGINE_ENTRY];
    const found = report(manifest);
    expect(found.fails).toHaveLength(1);
    expect(found.fails[0]).toContain('构建清单里没有沙盘程序这一项（src/stage/three/engine.ts）');
  });

  it('沙盘程序没有标成“用到时才下载”；清单里没有页面的入口', () => {
    const notDynamic = manifestLikeToday();
    delete notDynamic[ENGINE_ENTRY].isDynamicEntry;
    expect(report(notDynamic).fails).toEqual(['沙盘程序（src/stage/three/engine.ts）在构建清单里没有标成“用到时才下载”']);
    const noPage = manifestLikeToday();
    delete noPage[PAGE_ENTRY];
    expect(report(noPage).fails).toEqual(['构建清单里没有页面的入口（index.html）']);
  });
});

describe('全程沙盘另外的那一块程序', () => {
  /** 和现在的构建一个样子，再添上全程沙盘那一块：沙盘程序用到时才取它；它静态引入沙盘程序（共用的东西在那边）和自己的一小块。 */
  function withRoute(): BuildManifest {
    const manifest = manifestLikeToday();
    manifest[ENGINE_ENTRY].dynamicImports = [ROUTE_ENTRY];
    manifest[ROUTE_ENTRY] = { file: 'assets/routeLevel-g.js', isDynamicEntry: true, imports: [ENGINE_ENTRY, '_lines-h.js'] };
    manifest['_lines-h.js'] = { file: 'assets/lines-h.js' };
    return manifest;
  }
  const WITH_ROUTE = { ...TODAY, 'assets/routeLevel-g.js': 2_100, 'assets/lines-h.js': 6_500 };
  const report = (manifest: BuildManifest, table: Record<string, number> = WITH_ROUTE) => programReport(programSizes(manifest, sizesOf(table)), DIST_TODAY);

  it('它自己和它另外带的小块算一组，页面和沙盘程序已经带着的不重复算；沙盘程序那一组不因为它变大', () => {
    const sizes = programSizes(withRoute(), sizesOf(WITH_ROUTE));
    expect(sizes.route).toEqual({ files: ['assets/routeLevel-g.js', 'assets/lines-h.js'], gzip: 8_600 });
    expect(sizes.engine).toEqual({ files: ['assets/engine-b.js', 'assets/strips-c.js'], gzip: 198_600 });
    expect(sizes.routeIsDynamic).toBe(true);
    expect(sizes.routeInEngine).toBe(false);
    // 清单里没有这一块：null，不算出错（查真的构建时另有一项管它在不在）
    expect(programSizes(manifestLikeToday(), sizesOf(TODAY)).route).toBeNull();
  });

  it('表里多两行：它自己多大，和沙盘程序加在一起多大；加在一起对着沙盘程序的上限查', () => {
    const found = report(withRoute());
    expect(found.fails).toEqual([]);
    expect(found.lines).toContain('全程沙盘另外的程序（压缩以后）：8,600 字节（没有单独的上限，和沙盘程序加在一起查）　assets/routeLevel-g.js、assets/lines-h.js');
    expect(found.lines).toContain('摆全程沙盘要下载的程序：沙盘程序加上全程沙盘另外的（压缩以后）：207,200 字节，上限 230,000（用了 90%）');
  });

  it('沙盘程序自己没有超，加上全程沙盘那一块超了：不合格；正好 230,000 合格', () => {
    const over = report(withRoute(), { ...WITH_ROUTE, 'assets/lines-h.js': 6_500 + (ENGINE_GZIP_MAX - 207_200) + 1 });
    expect(over.fails).toEqual(['摆全程沙盘要下载的程序：沙盘程序加上全程沙盘另外的（压缩以后）有 230,001 字节，超过了上限 230,000']);
    const exact = report(withRoute(), { ...WITH_ROUTE, 'assets/lines-h.js': 6_500 + (ENGINE_GZIP_MAX - 207_200) });
    expect(exact.fails).toEqual([]);
  });

  it('沙盘程序静态引入了它（站点沙盘的页面也得下载它）、它没有标成“用到时才下载”：都不合格', () => {
    const inEngine = withRoute();
    inEngine[ENGINE_ENTRY].imports = [PAGE_ENTRY, '_strips-c.js', ROUTE_ENTRY];
    inEngine[ROUTE_ENTRY].imports = ['_lines-h.js'];
    const found = report(inEngine);
    expect(found.fails).toHaveLength(1);
    expect(found.fails[0]).toContain('成了沙盘程序一来就带着的东西');
    const notDynamic = withRoute();
    delete notDynamic[ROUTE_ENTRY].isDynamicEntry;
    expect(report(notDynamic).fails).toEqual(['全程沙盘那一块程序（src/stage/three/routeLevel.ts）在构建清单里没有标成“用到时才下载”']);
  });
});

describe('时代样式：一种一块，和沙盘程序加在一起查', () => {
  /** 和现在的构建一个样子，添上全程沙盘那一块，再添上样式：页面那一边用到时才取它；它静态引入沙盘程序（共用的东西在那边）。名字都是编的。 */
  function withStyles(ids: string[] = ['style-a']): BuildManifest {
    const manifest = manifestLikeToday();
    manifest[ENGINE_ENTRY].dynamicImports = [ROUTE_ENTRY];
    manifest[ROUTE_ENTRY] = { file: 'assets/routeLevel-g.js', isDynamicEntry: true, imports: [ENGINE_ENTRY, '_lines-h.js'] };
    manifest['_lines-h.js'] = { file: 'assets/lines-h.js' };
    for (const id of ids) {
      manifest[PAGE_ENTRY].dynamicImports = [...(manifest[PAGE_ENTRY].dynamicImports ?? []), styleEntry(id)];
      manifest[styleEntry(id)] = { file: `assets/${id}-j.js`, isDynamicEntry: true, imports: [ENGINE_ENTRY] };
    }
    return manifest;
  }
  const WITH_STYLES = { ...TODAY, 'assets/routeLevel-g.js': 2_100, 'assets/lines-h.js': 6_500, 'assets/style-a-j.js': 2_000, 'assets/style-b-j.js': 3_000 };
  const report = (manifest: BuildManifest, table: Record<string, number> = WITH_STYLES) => programReport(programSizes(manifest, sizesOf(table)), DIST_TODAY);
  const STOP_ROW = '摆站点沙盘要下载的程序：沙盘程序加上最大的一种时代样式（压缩以后）';
  const ROUTE_ROW = '摆全程沙盘要下载的程序：沙盘程序加上全程沙盘另外的，再加上最大的一种时代样式（压缩以后）';

  it('一种样式在清单里叫什么：它自己的文件夹里和它同名的那个文件；文件夹里别的文件、别处的文件都不是', () => {
    expect(styleEntry('song-qinglv')).toBe('src/stage/three/style/song-qinglv/song-qinglv.ts');
    const manifest = withStyles();
    manifest['src/stage/three/style/style-a/figure.ts'] = { file: 'assets/figure-k.js', isDynamicEntry: true };
    manifest['src/stage/three/style/index.ts'] = { file: 'assets/index-l.js' };
    manifest['src/stage/three/style/style-c/style-d.ts'] = { file: 'assets/style-d-m.js', isDynamicEntry: true };
    expect(programSizes(manifest, sizesOf(WITH_STYLES)).styles.map((one) => one.id)).toEqual(['style-a']);
  });

  it('它自己那一块算一组，页面和沙盘程序已经带着的不重复算；沙盘程序、全程沙盘那一组不因为它变大；清单里没有样式时是空的', () => {
    const sizes = programSizes(withStyles(), sizesOf(WITH_STYLES));
    expect(sizes.styles).toEqual([{ id: 'style-a', files: ['assets/style-a-j.js'], gzip: 2_000, isDynamic: true, inOthers: false, route: null, routeIsDynamic: true }]);
    expect(sizes.engine).toEqual({ files: ['assets/engine-b.js', 'assets/strips-c.js'], gzip: 198_600 });
    expect(sizes.route).toEqual({ files: ['assets/routeLevel-g.js', 'assets/lines-h.js'], gzip: 8_600 });
    expect(programSizes(manifestLikeToday(), sizesOf(TODAY)).styles).toEqual([]);
    // 两种：照名字排，各算各的
    expect(programSizes(withStyles(['style-b', 'style-a']), sizesOf(WITH_STYLES)).styles.map((one) => [one.id, one.gzip])).toEqual([['style-a', 2_000], ['style-b', 3_000]]);
  });

  it('表里每一种样式一行；摆站点沙盘、摆全程沙盘各一行，都把样式加进去对着沙盘程序的上限查；原来不带样式的那一行换成了带样式的', () => {
    const found = report(withStyles());
    expect(found.fails).toEqual([]);
    expect(found.lines).toEqual([
      '页面的程序（压缩以后）：84,000 字节，上限 99,000（用了 85%）　assets/index-a.js',
      '样式表（压缩以后）：4,900 字节，上限 15,000（用了 33%）　assets/index-a.css',
      '沙盘程序（压缩以后）：198,600 字节，上限 230,000（用了 86%）　assets/engine-b.js、assets/strips-c.js',
      '时代样式“style-a”的程序（压缩以后）：2,000 字节（没有单独的上限，和沙盘程序加在一起查）　assets/style-a-j.js',
      `${STOP_ROW}：200,600 字节，上限 230,000（用了 87%）`,
      '全程沙盘另外的程序（压缩以后）：8,600 字节（没有单独的上限，和沙盘程序加在一起查）　assets/routeLevel-g.js、assets/lines-h.js',
      `${ROUTE_ROW}：209,200 字节，上限 230,000（用了 91%）`,
      '整个 dist/：2,000,000 字节，上限 943,718,400（用了 0%）',
    ]);
  });

  it('沙盘程序自己没有超，加上样式超了：不合格；正好 230,000 合格。全程沙盘：沙盘程序加上那一块没有超，再加上样式超了，也不合格', () => {
    const room = ENGINE_GZIP_MAX - 198_600;
    const over = report(withStyles(), { ...WITH_STYLES, 'assets/style-a-j.js': room + 1, 'assets/lines-h.js': 0, 'assets/routeLevel-g.js': 0 });
    expect(over.fails).toEqual([`${STOP_ROW}有 230,001 字节，超过了上限 230,000`, `${ROUTE_ROW}有 230,001 字节，超过了上限 230,000`]);
    const exact = report(withStyles(), { ...WITH_STYLES, 'assets/style-a-j.js': room, 'assets/lines-h.js': 0, 'assets/routeLevel-g.js': 0 });
    expect(exact.fails).toEqual([]);
    // 站点沙盘够，全程沙盘不够：只有全程沙盘那一行不合格（207,200 + 样式）
    const routeOver = report(withStyles(), { ...WITH_STYLES, 'assets/style-a-j.js': ENGINE_GZIP_MAX - 207_200 + 1 });
    expect(routeOver.fails).toEqual([`${ROUTE_ROW}有 230,001 字节，超过了上限 230,000`]);
    expect(report(withStyles(), { ...WITH_STYLES, 'assets/style-a-j.js': ENGINE_GZIP_MAX - 207_200 }).fails).toEqual([]);
  });

  it('有两种样式：照最大的一种查（一座沙盘只下载它自己的那一种，这里不看内容，取最坏的）', () => {
    const found = report(withStyles(['style-a', 'style-b']));
    expect(found.fails).toEqual([]);
    expect(found.lines).toContain('时代样式“style-a”的程序（压缩以后）：2,000 字节（没有单独的上限，和沙盘程序加在一起查）　assets/style-a-j.js');
    expect(found.lines).toContain('时代样式“style-b”的程序（压缩以后）：3,000 字节（没有单独的上限，和沙盘程序加在一起查）　assets/style-b-j.js');
    expect(found.lines).toContain(`${STOP_ROW}：201,600 字节，上限 230,000（用了 88%）`);
    expect(found.lines).toContain(`${ROUTE_ROW}：210,200 字节，上限 230,000（用了 91%）`);
    // 小的那一种再大也不算数，大的那一种超了才不合格
    const over = report(withStyles(['style-a', 'style-b']), { ...WITH_STYLES, 'assets/style-b-j.js': ENGINE_GZIP_MAX - 207_200 + 1 });
    expect(over.fails).toEqual([`${ROUTE_ROW}有 230,001 字节，超过了上限 230,000`]);
  });

  it('沙盘程序（或者页面、全程沙盘那一块）静态引入了它、它没有标成“用到时才下载”：都不合格', () => {
    for (const holder of [ENGINE_ENTRY, PAGE_ENTRY, ROUTE_ENTRY]) {
      const held = withStyles();
      held[styleEntry('style-a')].imports = [];
      held[holder].imports = [...(held[holder].imports ?? []), styleEntry('style-a')];
      const found = report(held);
      expect(found.fails.filter((line) => line.includes('时代样式“style-a”')), holder).toEqual([
        '时代样式“style-a”那一块程序（src/stage/three/style/style-a/style-a.ts）成了页面、沙盘程序或者全程沙盘那一块一来就带着的东西：只能用动态 import 取它（src/stage/styles.ts 的登记表）',
      ]);
    }
    const notDynamic = withStyles();
    delete notDynamic[styleEntry('style-a')].isDynamicEntry;
    expect(report(notDynamic).fails).toEqual(['时代样式“style-a”那一块程序（src/stage/three/style/style-a/style-a.ts）在构建清单里没有标成“用到时才下载”']);
  });
});

describe('时代样式分两半：全程沙盘只取每一座沙盘都用的那一半', () => {
  /** 和现在的构建一个样子：一种样式，整套的那一块静态引着那一半；页面那一边两块都是用到时才取。名字是编的。 */
  function withHalves(): BuildManifest {
    const manifest = manifestLikeToday();
    manifest[ENGINE_ENTRY].dynamicImports = [ROUTE_ENTRY];
    manifest[ROUTE_ENTRY] = { file: 'assets/routeLevel-g.js', isDynamicEntry: true, imports: [ENGINE_ENTRY, '_lines-h.js'] };
    manifest['_lines-h.js'] = { file: 'assets/lines-h.js' };
    manifest[PAGE_ENTRY].dynamicImports = [...(manifest[PAGE_ENTRY].dynamicImports ?? []), styleEntry('style-a'), styleRouteEntry('style-a')];
    manifest[styleEntry('style-a')] = { file: 'assets/style-a-j.js', isDynamicEntry: true, imports: [styleRouteEntry('style-a'), ENGINE_ENTRY] };
    manifest[styleRouteEntry('style-a')] = { file: 'assets/style-a-route-k.js', isDynamicEntry: true, imports: [ENGINE_ENTRY] };
    return manifest;
  }
  const HALVES = { ...TODAY, 'assets/routeLevel-g.js': 2_100, 'assets/lines-h.js': 6_500, 'assets/style-a-j.js': 1_200, 'assets/style-a-route-k.js': 3_800 };
  const report = (manifest: BuildManifest, table: Record<string, number> = HALVES) => programReport(programSizes(manifest, sizesOf(table)), DIST_TODAY);

  it('那一半在清单里叫什么；整套的一组是两块（站点沙盘都下载），那一半自己一组（全程沙盘只下载它）；那一半不另算成一种样式', () => {
    expect(styleRouteEntry('song-qinglv')).toBe('src/stage/three/style/song-qinglv/song-qinglv-route.ts');
    const sizes = programSizes(withHalves(), sizesOf(HALVES));
    expect(sizes.styles).toEqual([
      { id: 'style-a', files: ['assets/style-a-j.js', 'assets/style-a-route-k.js'], gzip: 5_000, isDynamic: true, inOthers: false, route: { files: ['assets/style-a-route-k.js'], gzip: 3_800 }, routeIsDynamic: true },
    ]);
  });

  it('摆站点沙盘照整套查，摆全程沙盘照那一半查；表里那一半另有一行', () => {
    const found = report(withHalves());
    expect(found.fails).toEqual([]);
    expect(found.lines).toContain('时代样式“style-a”的程序（压缩以后）：5,000 字节（没有单独的上限，和沙盘程序加在一起查）　assets/style-a-j.js、assets/style-a-route-k.js');
    expect(found.lines).toContain('时代样式“style-a”里全程沙盘取的那一半（压缩以后）：3,800 字节　assets/style-a-route-k.js');
    expect(found.lines).toContain('摆站点沙盘要下载的程序：沙盘程序加上最大的一种时代样式（压缩以后）：203,600 字节，上限 230,000（用了 89%）');
    expect(found.lines).toContain('摆全程沙盘要下载的程序：沙盘程序加上全程沙盘另外的，再加上最大的一种时代样式（压缩以后）：211,000 字节，上限 230,000（用了 92%）');
    // 那一半大到全程沙盘超了：不合格（207,200 + 那一半）；站点沙盘那一行跟着也超
    const over = report(withHalves(), { ...HALVES, 'assets/style-a-route-k.js': ENGINE_GZIP_MAX - 207_200 + 1 });
    expect(over.fails).toContain('摆全程沙盘要下载的程序：沙盘程序加上全程沙盘另外的，再加上最大的一种时代样式（压缩以后）有 230,001 字节，超过了上限 230,000');
    // 站点沙盘才用的那一半再大，全程沙盘那一行不动
    const stopHeavy = report(withHalves(), { ...HALVES, 'assets/style-a-j.js': 20_000 });
    expect(stopHeavy.lines).toContain('摆全程沙盘要下载的程序：沙盘程序加上全程沙盘另外的，再加上最大的一种时代样式（压缩以后）：211,000 字节，上限 230,000（用了 92%）');
  });

  it('那一半没有标成“用到时才下载”、沙盘程序静态引入了那一半：都不合格', () => {
    const notDynamic = withHalves();
    delete notDynamic[styleRouteEntry('style-a')].isDynamicEntry;
    expect(report(notDynamic).fails).toEqual(['时代样式“style-a”里全程沙盘取的那一半（src/stage/three/style/style-a/style-a-route.ts）在构建清单里没有标成“用到时才下载”']);
    const held = withHalves();
    held[ENGINE_ENTRY].imports = [...(held[ENGINE_ENTRY].imports ?? []), styleRouteEntry('style-a')];
    held[styleRouteEntry('style-a')].imports = [];
    held[styleEntry('style-a')].imports = [styleRouteEntry('style-a')];
    expect(report(held).fails.filter((line) => line.includes('时代样式“style-a”'))).toHaveLength(1);
    expect(report(held).fails.join('\n')).toContain('成了页面、沙盘程序或者全程沙盘那一块一来就带着的东西');
  });
});

describe('只有全程沙盘用的样式：清单里只有那一半，没有整套的入口', () => {
  /** 和现在的构建一个样子：一种整套的样式（style-a，两块），另一种只有全程沙盘用的那一半（style-half：登记表里那一行没有 load）。名字是编的。 */
  function withHalfOnly(): BuildManifest {
    const manifest = manifestLikeToday();
    manifest[ENGINE_ENTRY].dynamicImports = [ROUTE_ENTRY];
    manifest[ROUTE_ENTRY] = { file: 'assets/routeLevel-g.js', isDynamicEntry: true, imports: [ENGINE_ENTRY, '_lines-h.js'] };
    manifest['_lines-h.js'] = { file: 'assets/lines-h.js' };
    manifest[PAGE_ENTRY].dynamicImports = [...(manifest[PAGE_ENTRY].dynamicImports ?? []), styleEntry('style-a'), styleRouteEntry('style-a'), styleRouteEntry('style-half')];
    manifest[styleEntry('style-a')] = { file: 'assets/style-a-j.js', isDynamicEntry: true, imports: [styleRouteEntry('style-a'), ENGINE_ENTRY] };
    manifest[styleRouteEntry('style-a')] = { file: 'assets/style-a-route-k.js', isDynamicEntry: true, imports: [ENGINE_ENTRY] };
    manifest[styleRouteEntry('style-half')] = { file: 'assets/style-half-route-m.js', isDynamicEntry: true, imports: [ENGINE_ENTRY] };
    return manifest;
  }
  const SIZES = { ...TODAY, 'assets/routeLevel-g.js': 2_100, 'assets/lines-h.js': 6_500, 'assets/style-a-j.js': 1_200, 'assets/style-a-route-k.js': 3_800, 'assets/style-half-route-m.js': 2_500 };
  const report = (manifest: BuildManifest, table: Record<string, number> = SIZES) => programReport(programSizes(manifest, sizesOf(table)), DIST_TODAY);

  it('它算一种样式：照那一半认，一组就是那一半，标着 halfOnly；整套的那一种照旧，没有这个记号；那一半不另算成第三种', () => {
    const sizes = programSizes(withHalfOnly(), sizesOf(SIZES));
    expect(sizes.styles).toEqual([
      { id: 'style-a', files: ['assets/style-a-j.js', 'assets/style-a-route-k.js'], gzip: 5_000, isDynamic: true, inOthers: false, route: { files: ['assets/style-a-route-k.js'], gzip: 3_800 }, routeIsDynamic: true },
      { id: 'style-half', files: ['assets/style-half-route-m.js'], gzip: 2_500, isDynamic: true, inOthers: false, route: { files: ['assets/style-half-route-m.js'], gzip: 2_500 }, routeIsDynamic: true, halfOnly: true },
    ]);
    expect('halfOnly' in sizes.styles[0]).toBe(false);
    // 沙盘程序、全程沙盘那一组不因为它变大
    expect(sizes.engine).toEqual({ files: ['assets/engine-b.js', 'assets/strips-c.js'], gzip: 198_600 });
    expect(sizes.route).toEqual({ files: ['assets/routeLevel-g.js', 'assets/lines-h.js'], gzip: 8_600 });
  });

  it('表里它一行，说的是“只有全程沙盘用的那一半”；摆站点沙盘的那一行不算它，摆全程沙盘的那一行算', () => {
    const found = report(withHalfOnly());
    expect(found.fails).toEqual([]);
    expect(found.lines).toContain('时代样式“style-half”只有全程沙盘用的那一半（压缩以后）：2,500 字节（没有单独的上限，和沙盘程序、全程沙盘那一块加在一起查）　assets/style-half-route-m.js');
    expect(found.lines.filter((line) => line.includes('style-half'))).toHaveLength(1);
    expect(found.lines).toContain('摆站点沙盘要下载的程序：沙盘程序加上最大的一种时代样式（压缩以后）：203,600 字节，上限 230,000（用了 89%）');
    expect(found.lines).toContain('摆全程沙盘要下载的程序：沙盘程序加上全程沙盘另外的，再加上最大的一种时代样式（压缩以后）：211,000 字节，上限 230,000（用了 92%）');
    // 它那一半比整套的那一种还大：站点沙盘那一行不动（站点沙盘下载不到它），全程沙盘那一行照它查
    const heavy = report(withHalfOnly(), { ...SIZES, 'assets/style-half-route-m.js': 9_000 });
    expect(heavy.lines).toContain('摆站点沙盘要下载的程序：沙盘程序加上最大的一种时代样式（压缩以后）：203,600 字节，上限 230,000（用了 89%）');
    expect(heavy.lines).toContain('摆全程沙盘要下载的程序：沙盘程序加上全程沙盘另外的，再加上最大的一种时代样式（压缩以后）：216,200 字节，上限 230,000（用了 94%）');
    // 大到全程沙盘超了：不合格
    const over = report(withHalfOnly(), { ...SIZES, 'assets/style-half-route-m.js': ENGINE_GZIP_MAX - 207_200 + 1 });
    expect(over.fails).toContain('摆全程沙盘要下载的程序：沙盘程序加上全程沙盘另外的，再加上最大的一种时代样式（压缩以后）有 230,001 字节，超过了上限 230,000');
  });

  it('它没有标成“用到时才下载”、沙盘程序静态引入了它：都不合格，说的是那一半的名字', () => {
    const notDynamic = withHalfOnly();
    delete notDynamic[styleRouteEntry('style-half')].isDynamicEntry;
    expect(report(notDynamic).fails).toEqual(['时代样式“style-half”里全程沙盘取的那一半（src/stage/three/style/style-half/style-half-route.ts）在构建清单里没有标成“用到时才下载”']);
    const held = withHalfOnly();
    held[ENGINE_ENTRY].imports = [...(held[ENGINE_ENTRY].imports ?? []), styleRouteEntry('style-half')];
    held[styleRouteEntry('style-half')].imports = [];
    expect(report(held).fails.filter((line) => line.includes('时代样式“style-half”'))).toEqual([
      '时代样式“style-half”（只有全程沙盘用的那一半，src/stage/three/style/style-half/style-half-route.ts）成了页面、沙盘程序或者全程沙盘那一块一来就带着的东西：只能用动态 import 取它（src/stage/styles.ts 的登记表）',
    ]);
  });

  it('只有它一种样式的时候：摆站点沙盘的那一行查的是沙盘程序自己（没有哪一种样式站点沙盘下载得到）', () => {
    const manifest = withHalfOnly();
    delete manifest[styleEntry('style-a')];
    delete manifest[styleRouteEntry('style-a')];
    const sizes = programSizes(manifest, sizesOf(SIZES));
    expect(sizes.styles.map((one) => [one.id, one.halfOnly])).toEqual([['style-half', true]]);
    const found = programReport(sizes, DIST_TODAY);
    expect(found.fails).toEqual([]);
    expect(found.lines).toContain('摆站点沙盘要下载的程序：沙盘程序加上最大的一种时代样式（压缩以后）：198,600 字节，上限 230,000（用了 86%）');
  });
});

describe('字体文件对着上限查', () => {
  /** 四个文件，照工具排的先后：黑体、头一个宋体、楷体、点开才要的宋体。黑体不说就是 49,000 字节。 */
  const files = (kai: number, song: number, more: number, sans = 49_000) => [
    { file: 'yanlu-sans.woff2', bytes: sans, first: true },
    { file: 'yanlu-song.woff2', bytes: song, first: true },
    { file: 'yanlu-kai.woff2', bytes: kai, first: true },
    { file: 'yanlu-song-more.woff2', bytes: more, first: false },
  ];

  it('都在上限里：每个文件一行，首次打开的合计一行，全部合计一行', () => {
    const report = fontReport(files(56_000, 243_000, 186_000));
    expect(report.fails).toEqual([]);
    expect(report.warns).toEqual([]);
    expect(report.lines).toEqual([
      'yanlu-sans.woff2：49,000 字节，上限 307,200（用了 16%）',
      'yanlu-song.woff2：243,000 字节，上限 307,200（用了 79%）',
      'yanlu-kai.woff2：56,000 字节，上限 307,200（用了 18%）',
      'yanlu-song-more.woff2：186,000 字节，上限 307,200（用了 61%）',
      '首次打开要下载的字体（yanlu-sans.woff2、yanlu-song.woff2、yanlu-kai.woff2）：348,000 字节，上限 460,800（用了 76%）',
      '全部字体文件合计：534,000 字节（没有上限）',
    ]);
  });

  it('一个文件正好 300 KB 算合格（只是提醒），多一个字节就不合格；过了 280 KB 提醒', () => {
    expect(fontReport(files(56_000, FONT_FILE_MAX_BYTES, 186_000)).fails).toEqual([]);
    expect(fontReport(files(56_000, FONT_FILE_MAX_BYTES + 1, 186_000)).fails).toEqual(['字体文件 yanlu-song.woff2 有 307,201 字节，超过了上限 307,200']);
    expect(fontReport(files(56_000, 243_000, FONT_FILE_MAX_BYTES + 1)).fails).toEqual(['字体文件 yanlu-song-more.woff2 有 307,201 字节，超过了上限 307,200']);
    expect(fontReport(files(56_000, FONT_FILE_WARN_BYTES, 186_000)).warns).toEqual([]);
    expect(fontReport(files(56_000, FONT_FILE_WARN_BYTES + 1, 186_000)).warns).toEqual([
      '字体文件 yanlu-song.woff2 有 286,721 字节，快到上限 307,200 了（过了 286,720 就提醒）：该把宋体按站拆开了（打开以前还要做什么，写在 tests/support/fontTool.ts 的 SPLIT_SONG_BY_STOP 上面）',
    ]);
    // “该把宋体按站拆开了”只对宋体的文件说：黑体、楷体的文件大了，只提醒，不出这个主意
    expect(fontReport(files(56_000, 100_000, 186_000, FONT_FILE_WARN_BYTES + 1)).warns).toEqual(['字体文件 yanlu-sans.woff2 有 286,721 字节，快到上限 307,200 了（过了 286,720 就提醒）']);
    expect(fontReport(files(FONT_FILE_WARN_BYTES + 1, 100_000, 186_000)).warns).toEqual(['字体文件 yanlu-kai.woff2 有 286,721 字节，快到上限 307,200 了（过了 286,720 就提醒）']);
    expect(fontReport(files(56_000, 100_000, FONT_FILE_WARN_BYTES + 1)).warns[0]).toContain('yanlu-song-more.woff2');
    expect(fontReport(files(56_000, 100_000, FONT_FILE_WARN_BYTES + 1)).warns[0]).toContain('该把宋体按站拆开了');
  });

  it('首次打开要下载的合计正好 450 KB 算合格，多一个字节就不合格；点开才下载的不算在里面', () => {
    // 黑体 49,000 + 宋体 300,000 + 楷体 111,800 = 460,800
    expect(fontReport(files(111_800, 300_000, 300_000)).fails).toEqual([]);
    expect(fontReport(files(111_801, 300_000, 0)).fails).toEqual(['首次打开要下载的字体合计 460,801 字节，超过了上限 460,800']);
  });

  it('宋体按站拆开以后：首次打开的合计是大家共用的三个，加上自己的文件最大的那一站的；不是各站的都加起来', () => {
    // 黑体 49 KB，大家共用的宋体 205 KB，楷体 56 KB，八站各有自己的 35 到 42 KB：都加起来早过了 450 KB，可是没有谁一次要下载八站的
    const split = [
      { file: 'yanlu-sans.woff2', bytes: 49_000, first: true, stop: null },
      { file: 'yanlu-song.woff2', bytes: 205_000, first: true, stop: null },
      { file: 'yanlu-kai.woff2', bytes: 56_000, first: true, stop: null },
      ...Array.from({ length: 8 }, (_, i) => ({ file: `yanlu-song-s${i + 1}.woff2`, bytes: 35_000 + i * 1_000, first: true, stop: `s${i + 1}` })),
      { file: 'yanlu-song-more.woff2', bytes: 34_000, first: false, stop: null },
      ...Array.from({ length: 8 }, (_, i) => ({ file: `yanlu-song-s${i + 1}-more.woff2`, bytes: 95_000, first: false, stop: `s${i + 1}` })),
    ];
    expect(split.filter((item) => item.first).reduce((sum, item) => sum + item.bytes, 0)).toBeGreaterThan(460_800);
    const report = fontReport(split);
    expect(report.fails).toEqual([]);
    expect(report.lines).toHaveLength(split.length + 2);
    expect(report.lines[split.length]).toBe('首次打开要下载的字体（yanlu-sans.woff2、yanlu-song.woff2、yanlu-kai.woff2，加上自己的文件最大的一站（s8）的 yanlu-song-s8.woff2）：352,000 字节，上限 460,800（用了 76%）');
    // 一站自己的文件大到连同大家共用的过了上限：通不过，说的是合计；正好到上限算合格
    const withS3 = (bytes: number) => split.map((item) => (item.file === 'yanlu-song-s3.woff2' ? { ...item, bytes } : item));
    expect(fontReport(withS3(150_801)).fails).toEqual(['首次打开要下载的字体合计 460,801 字节，超过了上限 460,800']);
    expect(fontReport(withS3(150_800)).fails).toEqual([]);
    // 点开才下载的那些，哪一站的都不算在里面
    expect(fontReport(split.map((item) => (item.first ? item : { ...item, bytes: 300_000 }))).fails).toEqual([]);
  });
});

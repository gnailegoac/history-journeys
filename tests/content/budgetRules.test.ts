// 大小的上限和照着它们查的函数（budgetRules.ts）自己的测试：每一条都用编出来的大小试一遍“超了查得出、正好等于上限算合格”。
// 真的文件有多大不在这里查：内容里的由 validate.test.ts（规则 16、17、18）查，构建出来的由 tests/build/dist-size.test.ts 查。

import { describe, expect, it } from 'vitest';
import {
  COLOUR_PSNR_MIN,
  DIST_MAX_BYTES,
  DIST_WARN_BYTES,
  ENGINE_ENTRY,
  ENGINE_GZIP_MAX,
  ENGINE_GZIP_WARN,
  PAGE_ENTRY,
  PAGE_GZIP_MAX,
  PAGE_GZIP_WARN,
  PICTURE_EDGE_MAX,
  STILL_MAX_BYTES,
  STYLE_GZIP_MAX,
  STYLE_GZIP_WARN,
  TABLE_FILES_MAX_BYTES,
  edgeTooLong,
  kilobytes,
  megabytes,
  programReport,
  programSizes,
  psnrTooLow,
  staticClosure,
  stillTooBig,
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

  it('程序的下载量（压缩以后）：沙盘程序 230,000，页面 95,000，样式表 15,000；整个 dist/ 900 MB', () => {
    expect([ENGINE_GZIP_MAX, ENGINE_GZIP_WARN]).toEqual([230_000, 215_000]);
    expect([PAGE_GZIP_MAX, PAGE_GZIP_WARN]).toEqual([95_000, 90_000]);
    expect([STYLE_GZIP_MAX, STYLE_GZIP_WARN]).toEqual([15_000, 10_000]);
    expect([DIST_MAX_BYTES, DIST_WARN_BYTES]).toEqual([943_718_400, 524_288_000]);
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
      '页面的程序（压缩以后）：84,000 字节，上限 95,000（用了 88%）　assets/index-a.js',
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

  it('页面的程序超过 95,000 字节；过了 90,000 提醒', () => {
    expect(report(manifestLikeToday(), { ...TODAY, 'assets/index-a.js': 95_001 }).fails).toEqual(['页面的程序（压缩以后）有 95,001 字节，超过了上限 95,000']);
    const near = report(manifestLikeToday(), { ...TODAY, 'assets/index-a.js': 90_001 });
    expect(near.fails).toEqual([]);
    expect(near.warns).toEqual(['页面的程序（压缩以后）有 90,001 字节，快到上限 95,000 了（过了 90,000 就提醒）']);
    expect(report(manifestLikeToday(), { ...TODAY, 'assets/index-a.js': 95_000 }).fails).toEqual([]);
  });

  it('样式表超过 15,000 字节；整个 dist/ 超过 900 MB', () => {
    expect(report(manifestLikeToday(), { ...TODAY, 'assets/index-a.css': 15_001 }).fails).toEqual(['样式表（压缩以后）有 15,001 字节，超过了上限 15,000']);
    expect(report(manifestLikeToday(), { ...TODAY, 'assets/index-a.css': 10_001 }).warns).toEqual(['样式表（压缩以后）有 10,001 字节，快到上限 15,000 了（过了 10,000 就提醒）']);
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
    expect(found.fails[0]).toBe('页面的程序（压缩以后）有 282,600 字节，超过了上限 95,000');
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

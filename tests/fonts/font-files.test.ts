// 随站的字体：放进仓库的字体文件对不对、够不够（docs/data-spec.md 校验规则 19）。随 npm test 跑。
// 不用原字体，不连网：读的是 src/fonts/ 里放进仓库的那几个文件（照 WOFF2 的格式解开，看它里面真有哪些字），
// 和现在的网站要显示哪些字（tests/support/fontTool.ts 照页面自己的程序数出来的）。
//
// 分三组：
//   一、网站上显示的每一个字都在字体文件里。少了一个，这里说出是哪个字、在哪里用的，办法是 npm run fonts。
//   二、字体文件、记录、样式表、给页面用的模块、许可全文，彼此对得上；文件里的名称合许可的要求；大小不超过上限。
//   三、源文件里没有“工具数不到的字”和“Safari 15 读不懂的写法”。换字体以前的页面留下过几处，一处一处点了名列在
//       PENDING 里，后面的单元改到哪里删到哪里；现在这张名单是空的（最后两处是“读原文”“凭据”前面用 content 画的加号、减号，
//       换正文那一栏的样子时换成了页面上真的字）。名单只许变短，所以它只能一直空着：新冒出来的不许往里加，改掉它。

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fontReport } from '../content/budgetRules';
import {
  FALLBACK_OK,
  FONTS_DIR,
  FONT_SOURCES,
  FONT_SOURCE_IDS,
  KAI_FORBIDDEN,
  LIBRARY_LICENCES,
  LICENCES_DIR,
  RECIPE,
  RECORD_VERSION,
  SPLIT_SONG_BY_STOP,
  SQUEEZE_FEATURES,
  SQUEEZE_KEPT,
  codeOf,
  cssFace,
  fontFileProblems,
  fontsCss,
  isInterfaceSource,
  missingFromShipped,
  planFonts,
  readShipped,
  readSite,
  sha256,
  shippedTs,
  sortedString,
  sourceFiles,
  sourceRecord,
  squeezeProblems,
  stripComments,
  toolVersions,
  unusedInShipped,
  writtenFromRecord,
} from '../support/fontTool';
import type { FontPlan, PlannedFile } from '../support/fontTool';
import { charactersOf, englishName, featuresOf, glyphCountOf, hintingOf, readWoff2, weightOf } from '../support/sfnt';
import { countIn, mediaProblems, mediaQueries, scanMedia, scanProgram, scanStyle, stripCssComments, tally } from '../support/sourceScan';

/** 项目的根目录：这个文件在 tests/fonts/ 里，往上两层。 */
const ROOT = new URL('../../', import.meta.url);
const at = (path: string): URL => new URL(path, ROOT);
const utf8 = new TextDecoder();
const text = (path: string): string => utf8.decode(readFileSync(at(path)));

/** 现在的网站要哪些字、各归哪个文件（读一次，几项测试共用）。 */
const plan: Promise<FontPlan> = readSite().then((site) => planFonts(site));
const shipped = readShipped();
/** 要做的清单里装某一组字的那个文件（不照先后取：文件的先后是黑体、宋体、楷体……）。 */
const planned = async (group: string): Promise<PlannedFile> => {
  const found = (await plan).files.find((item) => item.group === group);
  if (!found) throw new Error(`要做的文件里没有 ${group} 这一组`);
  return found;
};

/** 照一份要做的清单另编一份：给其中一组添一个字（看“少了字”查不查得出来）。 */
function withExtra(from: FontPlan, group: string, ch: string, where: string): FontPlan {
  return {
    ...from,
    files: from.files.map((file): PlannedFile => (file.group === group ? { ...file, characters: sortedString(file.characters + ch), where: new Map([...file.where, [ch, [where]]]) } : file)),
  };
}

// ---------------------------------------------------------------- 一、字都在

describe('网站上显示的每一个字都在随站的字体里', () => {
  it('用黑体排的字都在 yanlu-sans 里；题签和印上的字都在 yanlu-kai 里；不用点开就看得见的成句的字都在 yanlu-song 里；点开才看得见的字在两个宋体文件之一里', async () => {
    expect(missingFromShipped(await plan, shipped)).toEqual([]);
  });

  it('查得出来：网站上多了一个字体里没有的字，这里通不过，说出是哪个字、在哪里用的、该跑哪条命令', async () => {
    const all = new Set(shipped.files.flatMap((file) => [...file.characters]));
    const absent = [...'龘䨻𪚥'].find((ch) => !all.has(ch));
    expect(absent, '找不到一个字体里没有的字来试').toBeDefined();
    if (!absent) return;
    for (const [group, where] of [
      ['kai', '徐州的题签'],
      ['sans', '徐州的标题'],
      ['song', '徐州的正文'],
      ['song-more', '徐州的原文'],
    ]) {
      expect(missingFromShipped(withExtra(await plan, group, absent, where), shipped), group).toEqual([`“${absent}”（${codeOf(absent)}，${where}里）不在随站的字体里：运行 npm run fonts，再提交。`]);
    }
  });

  it('查得出来：要一打开就看得见的字，只在点开才下载的那个文件里有，不算数；要用楷体排的字、要用黑体排的字，只在宋体里有，也不算数', async () => {
    const file = (name: string) => shipped.files.find((item) => item.record.file === name);
    const kai = file('yanlu-kai.woff2')?.characters ?? new Set<string>();
    const sans = file('yanlu-sans.woff2')?.characters ?? new Set<string>();
    const song = file('yanlu-song.woff2')?.characters ?? new Set<string>();
    const more = file('yanlu-song-more.woff2')?.characters ?? new Set<string>();
    const onlyMore = [...more].find((ch) => !song.has(ch));
    const onlySong = [...song].find((ch) => !kai.has(ch) && (ch.codePointAt(0) ?? 0) > 0x2e7f);
    expect(onlyMore && onlySong, '要有只在 yanlu-song-more 里的字和只在 yanlu-song 里的汉字，这一项才试得了').toBeTruthy();
    if (!onlyMore || !onlySong) return;
    expect(missingFromShipped(withExtra(await plan, 'song', onlyMore, '徐州的正文'), shipped)).toEqual([`“${onlyMore}”（${codeOf(onlyMore)}，徐州的正文里）不在随站的字体里：运行 npm run fonts，再提交。`]);
    expect(missingFromShipped(withExtra(await plan, 'kai', onlySong, '徐州的题签'), shipped)).toEqual([`“${onlySong}”（${codeOf(onlySong)}，徐州的题签里）不在随站的字体里：运行 npm run fonts，再提交。`]);
    // 黑体的字只认黑体的文件：头一个宋体文件里有、黑体文件里没有的一个汉字，排进黑体那一组——不算数
    const notInSans = [...song].find((ch) => !sans.has(ch) && (ch.codePointAt(0) ?? 0) > 0x2e7f);
    expect(notInSans, '要有只在 yanlu-song 里、不在 yanlu-sans 里的汉字，这一项才试得了').toBeTruthy();
    if (!notInSans) return;
    expect(missingFromShipped(withExtra(await plan, 'sans', notInSans, '徐州的标题'), shipped)).toEqual([`“${notInSans}”（${codeOf(notInSans)}，徐州的标题里）不在随站的字体里：运行 npm run fonts，再提交。`]);
    // 反过来不算错：点开才看得见的字，头一个宋体文件里有也行
    expect(missingFromShipped(withExtra(await plan, 'song-more', onlySong, '徐州的原文'), shipped)).toEqual([]);
  });

  it('题签和印上的字里没有弯引号（这套楷体里它们只有三分之一个字宽）；标题、小节名是黑体的了，里面有弯引号不归这一条管', async () => {
    const kai = await planned('kai');
    const found = [...KAI_FORBIDDEN].filter((ch) => kai.characters.includes(ch)).map((ch) => `“${ch}”（${codeOf(ch)}）用在${(kai.where.get(ch) ?? []).join('、')}里：换个说法，或者先问一声`);
    expect(found).toEqual([]);
  });

  it('楷体那一组、黑体那一组的每一个字，头一组宋体里也有（那个文件还在路上时先用宋体显示，不为它去取点开才要的文件）', async () => {
    const song = await planned('song');
    for (const group of ['kai', 'sans']) expect([...(await planned(group)).characters].filter((ch) => !song.characters.includes(ch)), group).toEqual([]);
  });

  it('没有哪个字是指望设备自带的字体的；有的话要记着理由', async () => {
    // 记着的正好是网站上真的用到了的那几个：不用了的要从 FALLBACK_OK 里拿掉
    expect((await plan).fallback).toBe(sortedString(Object.keys(FALLBACK_OK)));
    for (const [ch, why] of Object.entries(FALLBACK_OK)) expect(why.trim(), `FALLBACK_OK 里“${ch}”没有写理由`).not.toBe('');
  });

  it('文件里多带了已经不用的字不算错；多到四十个以上提醒一句', async () => {
    for (const { file, characters } of unusedInShipped(await plan, shipped)) {
      const count = [...characters].length;
      if (count > 40) console.warn(`[字体] ${file} 里有 ${count} 个字网站已经不用了（${characters}）：运行 npm run fonts 重做一遍，文件能小一些。`);
      expect(count).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------- 二、文件、记录、样式表、许可对得上

describe('放进仓库的字体文件和它的记录、样式表、许可全文对得上', () => {
  it('记录的格式、做法、原字体，是 tests/support/fontTool.ts 里现在写的那些', () => {
    expect(shipped.record.tool, '记录的格式换了（RECORD_VERSION）：运行 npm run fonts，再提交').toBe(RECORD_VERSION);
    expect(shipped.record.recipe, '做法改过了（RECIPE）：运行 npm run fonts，再提交').toBe(RECIPE);
    // 原字体的每一项说明（名字、版本、从哪里取、网站、字节数、记号、版权声明、许可文件、留哪些排版功能）都和现在写的一样
    expect(Object.keys(shipped.record.sources).sort(), '记录里的原字体正好是这三个').toEqual([...FONT_SOURCE_IDS].sort());
    for (const id of FONT_SOURCE_IDS) {
      expect(shipped.record.sources[id], `${FONT_SOURCES[id].name} 的说明改过了（tests/support/fontTool.ts 的 FONT_SOURCES）：运行 npm run fonts，再提交`).toEqual(sourceRecord(id));
    }
    // 做的时候裁剪工具的版本，就是现在装着的（换了版本，字节可能不一样：重做一遍）
    expect(shipped.record.made, '裁剪字体的库换了版本：运行 npm run fonts，再提交').toEqual(toolVersions());
  });

  it('要做的是哪几个文件，记录里就是哪几个，先后也一样', async () => {
    expect(shipped.record.files.map((item) => item.file)).toEqual((await plan).files.map((file) => `${file.name}.woff2`));
    for (const file of (await plan).files) {
      const item = shipped.record.files.find((entry) => entry.file === `${file.name}.woff2`);
      expect([item?.family, item?.postscript, item?.source, item?.group, item?.range, item?.first, item?.preload, item?.stop], file.name).toEqual([file.family, file.postscript, file.source, file.group, file.range, file.first, file.preload, file.stop]);
    }
    // 四个文件：黑体、头一个宋体、楷体不带 unicode-range，点开才要的那个宋体带着
    expect(shipped.record.files.map((item) => [item.group, item.source, item.range])).toEqual([
      ['sans', 'sans', false],
      ['song', 'song', false],
      ['kai', 'kai', false],
      ['song-more', 'song', true],
    ]);
  });

  it('宋体按站拆开的开关关着：页面那一头还没有接上，现在不能打开', () => {
    // 工具里按站分字的规矩写好了、有测试，但是打开以前还要做三件动页面的事，一件一件写在 tests/support/fontTool.ts 的
    // SPLIT_SONG_BY_STOP 上面。做完那三件再打开，同时把这一项删掉。
    expect(SPLIT_SONG_BY_STOP, '先做完 tests/support/fontTool.ts 的 SPLIT_SONG_BY_STOP 上面列的三件事，再打开这个开关').toBe(false);
    expect(shipped.record.files.every((item) => item.stop === null)).toBe(true);
  });

  it.each(shipped.files.map((file) => [file.record.file, file] as const))('%s：字节数、记号、里面的字、字形数、粗细、留下的排版功能，都和记录里写的一样', (_name, file) => {
    const { record, bytes, tables } = file;
    expect(bytes.length).toBe(record.bytes);
    expect(sha256(bytes)).toBe(record.sha256);
    const { info, flavor } = readWoff2(bytes);
    expect(info.length, '文件头里写的长度').toBe(bytes.length);
    expect(flavor).toBe(record.source === 'kai' ? '\u0000\u0001\u0000\u0000' : 'OTTO');
    expect(charactersOf(tables)).toBe(record.characters);
    expect(record.characters).toBe(sortedString(record.characters));
    expect([...record.characters].length).toBe(record.count);
    expect(glyphCountOf(tables)).toBe(record.glyphs);
    expect([...new Set([...featuresOf(tables, 'GSUB'), ...featuresOf(tables, 'GPOS')])].sort()).toEqual(record.features);
    // 留下的排版功能都在说好留的那几种里
    for (const feature of record.features) expect(FONT_SOURCES[record.source].keepFeatures, feature).toContain(feature);
    // 把标点挤窄的那六种：楷体和宋体的文件里一种也没有，说好留的名单里也不许有——“全角的标点个个占满一个字宽”靠的就是文件里没有它们
    //（浏览器没有这几种功能可用，就挤不了）。黑体的文件里有 halt 这一种、而且一定要有（标题上写了 font-feature-settings 的地方，
    // 全角标点占半个字宽）；别的五种它也没有。没有写 font-feature-settings 的黑体字不挤，靠的是 html 上的 text-spacing-trim: space-all
    //（tests/e2e/fonts.spec.ts 在浏览器里量）
    expect(squeezeProblems(record)).toEqual([]);
    for (const squeeze of SQUEEZE_FEATURES) {
      const kept = SQUEEZE_KEPT[record.source].includes(squeeze);
      expect(record.features.includes(squeeze), `${record.file} 里${kept ? '该有' : '不该有'}把标点挤窄的排版功能 ${squeeze}`).toBe(kept);
      expect(FONT_SOURCES[record.source].keepFeatures.includes(squeeze), `说好留的排版功能里${kept ? '该有' : '不该有'}把标点挤窄的 ${squeeze}`).toBe(kept);
    }
    expect(SQUEEZE_KEPT, '只有黑体留着 halt').toEqual({ kai: [], song: [], sans: ['halt'] });
    // 粗细：记录里写的就是从这个文件里读出来的，也是原字体那一项里写的（样式表里这个文件的 @font-face 照它写）
    expect(weightOf(tables), '文件里写的粗细').toBe(record.weight);
    expect(record.weight, '这套字体的粗细').toBe(FONT_SOURCES[record.source].weight);
    expect(record.weight).toBe(record.source === 'sans' ? 500 : 400);
    // 留没留提示信息：记录里写的就是从这个文件里读出来的（和做法对不对得上，下一项的 fontFileProblems 查）
    expect(hintingOf(tables), '文件里留没留提示信息').toBe(record.hinting);
    for (const ch of record.onlyFromSrc) expect(record.characters).toContain(ch);
  });

  it('文件里的名称是自己的，没有原字体保留的名字；版权声明和原字体的一样；楷体带着竖排用的两张表；提示信息照做法里写的（宋体留着）', () => {
    const problems = shipped.files.flatMap((file) => fontFileProblems(file.record, file.tables));
    expect(problems, '字体文件和现在的做法对不上：运行 npm run fonts，再提交').toEqual([]);
    // 查得出来：把宋体的文件当成楷体的来查（楷体的做法是没有提示信息），说得出提示信息对不上
    const song = shipped.files.find((file) => file.record.source === 'song');
    expect(song && fontFileProblems({ ...song.record, source: 'kai' }, song.tables).some((line) => line.includes('提示信息'))).toBe(true);
    // 名称表里记着的版权声明就是记录里那一条（记录里的又和 fontTool.ts 里的一样，上面查过）
    for (const file of shipped.files) expect(englishName(file.tables, 0)).toBe(shipped.record.sources[file.record.source].copyright);
  });

  it('每个文件的名称互不相同（两个宋体文件是同一套字体的两个文件，标识和 PostScript 名称要分得开）', () => {
    for (const id of [3, 6]) {
      const names = shipped.files.map((file) => englishName(file.tables, id));
      expect(new Set(names).size, `名称表第 ${id} 条`).toBe(names.length);
    }
    // 同一套字体的文件，字体名称相同：浏览器把它们当一套字体用
    const families = new Map<string, Set<string | undefined>>();
    for (const file of shipped.files) families.set(file.record.source, (families.get(file.record.source) ?? new Set()).add(englishName(file.tables, 1)));
    for (const [source, names] of families) expect(names.size, source).toBe(1);
  });

  it('样式表正好是照这几个文件写的：一个文件一条，带 unicode-range 的那一条列的正好是这个文件里的字', () => {
    const css = text(`${FONTS_DIR}/fonts.css`);
    expect(css, '样式表不是照记录写的：运行 npm run fonts（字体文件没变的话它只把这一份照记录重写），再提交').toBe(fontsCss(shipped.record.files.map(cssFace)));
    // 工具重写这一份时用的就是这一个函数
    expect(writtenFromRecord(shipped.record).css).toBe(css);
    // 不靠写样式表的那个函数，另读一遍
    const rules = stripCssComments(css).split('@font-face').slice(1);
    expect(rules).toHaveLength(shipped.files.length);
    rules.forEach((rule, i) => {
      const file = shipped.files[i];
      expect(rule.match(/url\('\.\/([^']+)'\)/)?.[1]).toBe(file.record.file);
      expect(rule.match(/font-family: '([^']+)'/)?.[1]).toBe(file.record.family);
      // 粗细是这个文件自己的那一种：黑体那一条是 500，别的是 400
      expect(rule.match(/font-weight: (\d+);/)?.[1], `${file.record.file} 的粗细`).toBe(String(file.record.weight));
      const range = rule.match(/unicode-range: ([^;]+);/)?.[1];
      expect(range !== undefined, file.record.file).toBe(file.record.range);
      if (range === undefined) return;
      const listed = range.split(', ').map((entry) => String.fromCodePoint(parseInt(entry.replace(/^U\+/, ''), 16)));
      expect(listed.join('')).toBe(file.record.characters);
      expect(new Set(listed)).toEqual(file.characters);
    });
    // 不带 unicode-range 的排在带的前面（后面的规则先被查）
    const ranged = shipped.record.files.map((item) => item.range);
    expect(ranged).toEqual([...ranged].sort((a, b) => Number(a) - Number(b)));
  });

  it('给页面用的模块是照记录写的；它里面除了那一个字，没有别的汉字', () => {
    const module = text(`${FONTS_DIR}/shipped.ts`);
    const more = shipped.record.files.find((item) => item.group === 'song-more');
    const probe = [...(more?.characters ?? '')][0];
    expect(module, '给页面用的模块不是照记录写的：运行 npm run fonts（字体文件没变的话它只把这一份照记录重写），再提交').toBe(shippedTs(probe));
    expect(writtenFromRecord(shipped.record).shipped).toBe(module);
    expect([...stripComments(module)].filter((ch) => (ch.codePointAt(0) ?? 0) > 0x7e)).toEqual([probe]);
    // 那一个字只在点开才下载的那个文件里
    expect(shipped.files.filter((file) => file.characters.has(probe)).map((file) => file.record.file)).toEqual(['yanlu-song-more.woff2']);
  });

  it('src/fonts/ 里只有这几样', () => {
    const want = [...shipped.record.files.map((item) => item.file), 'fonts.css', 'fonts.json', 'shipped.ts'].sort();
    expect(readdirSync(at(`${FONTS_DIR}/`)).sort()).toEqual(want);
  });

  it('五份许可全文都在 public/licences/：三份字体的和记录里记的记号一样，两份程序库的和装着的一样', () => {
    const want = [...FONT_SOURCE_IDS.map((id) => FONT_SOURCES[id].licence.file), ...LIBRARY_LICENCES.map((licence) => licence.file)].sort();
    expect(want).toHaveLength(5);
    expect(readdirSync(at(`${LICENCES_DIR}/`)).sort()).toEqual(want);
    for (const id of FONT_SOURCE_IDS) {
      const { file, sha256: recorded } = shipped.record.sources[id].licence;
      expect(sha256(readFileSync(at(`${LICENCES_DIR}/${file}`))), `${file} 不是记录里记的那一份许可全文：运行 npm run fonts（它照 .cache/fonts/ 里的那一份重抄），再提交`).toBe(recorded);
      // 许可的开头就是原字体里的版权声明的头一行（宋体、黑体的许可文件没有版权那一行，不查）
      if (id === 'kai') expect(text(`${LICENCES_DIR}/${file}`).startsWith(FONT_SOURCES.kai.copyright.split('\n')[0])).toBe(true);
    }
    for (const licence of LIBRARY_LICENCES) {
      const ours = sha256(readFileSync(at(`${LICENCES_DIR}/${licence.file}`)));
      for (const from of licence.from) {
        expect(existsSync(at(from)), from).toBe(true);
        expect(sha256(readFileSync(at(from))), `${licence.file} 和 ${from} 不一样了（程序库升级以后许可文件变了）：运行 npm run fonts，再提交`).toBe(ours);
      }
    }
  });

  it('大小不超过上限：首次打开要下载的合计 450 KB，一个文件 300 KB', () => {
    // 哪几个是不用点开就要的、各归哪一站，记录里记着（上面查过和现在要做的一样）；按站拆开以后，合计按站分开算，取最大的一站
    const report = fontReport(shipped.record.files.map((item) => ({ file: item.file, bytes: item.bytes, first: item.first, stop: item.stop })));
    console.log(['随站的字体有多大', ...report.lines.map((line) => `  ${line}`)].join('\n'));
    for (const warn of report.warns) console.warn(`[字体] 快到上限了：${warn}`);
    expect(report.fails).toEqual([]);
  });
});

// ---------------------------------------------------------------- 三、源文件里没有工具数不到的字、Safari 15 读不懂的写法

/**
 * 眼下还许可的几处，一处一处点了名：哪个文件，犯的哪一条，原样是什么，有几处，由哪个单元去掉。
 * 这些都是换字体、换样子以前的页面留下的，改到哪里删到哪里（不删测试也通不过：它查的是“找到的”和“名单”一模一样）。
 * 现在一处也没有了。名单只许变短，所以不要往里加：样式表里新冒出来的写法，改掉它。
 */
const PENDING: { file: string; rule: string; what: string; times: number; unit: string }[] = [];

describe('源文件里的写法', () => {
  const programs = sourceFiles().filter((path) => isInterfaceSource(path) || path.startsWith(`${FONTS_DIR}/`));
  const styles = readdirSync(at('src/styles/'))
    .filter((name) => name.endsWith('.css'))
    .sort()
    .map((name) => `src/styles/${name}`);

  it('界面上的字都是原样写在程序里的：没有转义、HTML 实体、String.fromCharCode、Intl、toLocale 打头的函数；index.html 也一样', () => {
    expect(programs.length).toBeGreaterThan(50);
    expect(tally(programs.flatMap((path) => scanProgram(path, text(path))))).toEqual([]);
    // index.html 里的字工具也数（程序起不来时显示的那两句话就写在它里面），所以同样的规矩它也要守。HTML 的注释先去掉，和工具一样
    expect(tally(scanProgram('index.html', text('index.html').replace(/<!--[\s\S]*?-->/g, '')))).toEqual([]);
  });

  it('查得出来：程序里写了转义、实体、现造字的函数', () => {
    const bad = ["const a = '\\u4e00';", "const b = '\\u{4e00}\\x41';", 'const c = <p>a&nbsp;b&#8212;c</p>;', 'const d = String.fromCharCode(0x4e00) + String.fromCodePoint(0x4e00);', 'const e = new Intl.NumberFormat().format(1) + (1).toLocaleString() + new Date().toLocaleDateString();'].join('\n');
    expect(tally(scanProgram('x.tsx', bad))).toEqual([
      'x.tsx | Intl | Intl. × 1',
      'x.tsx | entity | &#8212; × 1',
      'x.tsx | entity | &nbsp; × 1',
      'x.tsx | escape | \\u4e00 × 1',
      'x.tsx | escape | \\u{4e00} × 1',
      'x.tsx | escape | \\x41 × 1',
      'x.tsx | fromCharCode | fromCharCode × 1',
      'x.tsx | fromCharCode | fromCodePoint × 1',
      'x.tsx | toLocale | toLocaleDateString × 1',
      'x.tsx | toLocale | toLocaleString × 1',
    ]);
    // 注释里提到这些不算
    expect(scanProgram('x.ts', '// 不用 Intl. 和 toLocaleString，也不写 \\u4e00\nconst a = 1; /* &nbsp; */')).toEqual([]);
    // index.html 里也查得出来：那句话里写了转义，或者页面上写了实体
    const page = "<!-- &nbsp; 写在注释里的不算 --><noscript>要开着脚本&hellip;</noscript><script>var SAYS = '太旧\\u2026';</script>";
    expect(tally(scanProgram('index.html', page.replace(/<!--[\s\S]*?-->/g, '')))).toEqual(['index.html | entity | &hellip; × 1', 'index.html | escape | \\u2026 × 1']);
  });

  it('样式表里：每套字体只用它那一种粗细（黑体 500，别的 400）、不用斜体、字体只用三个记号（宋体、黑体、题签用的人物自己的一个）、设黑体的每一条都同时写粗细、框架的样式和题签的样式各读各的那一套记号、content 里不写字、不用 Safari 15 读不懂的写法（PENDING 里点了名的除外：现在一处也没有）', () => {
    expect(styles.length).toBeGreaterThan(5);
    const found = tally(styles.flatMap((path) => scanStyle(path, text(path))));
    const allowed = PENDING.map((item) => `${item.file} | ${item.rule} | ${item.what} × ${item.times}`).sort();
    const fresh = found.filter((line) => !allowed.includes(line));
    const gone = allowed.filter((line) => !found.includes(line));
    expect(fresh, '样式表里新冒出来的写法（不许往 PENDING 里加，改掉它）').toEqual([]);
    expect(gone, 'PENDING 里的这几项样式表里已经没有了（或者次数变了）：把它们从 PENDING 里删掉（次数少了就改小）').toEqual([]);
    for (const item of PENDING) expect(item.unit, `${item.file} ${item.what}：要写明由哪个单元去掉`).toMatch(/^U[2-6]$/);
  });

  it('查得出来：样式表里加粗、斜体、别的字体、content 里的字、带颜色的 text-decoration 简写、color-mix、text-wrap、嵌套、框架和题签读错了记号、黑体没有写粗细', () => {
    const bad = `
      :root { --font-ui: system-ui, 'PingFang SC', 'Microsoft YaHei', sans-serif; --weight-heading: 700; --grain: url("data:image/svg+xml;utf8,<svg/>"); }
      h1 { font-weight: 700; font-style: italic; font-family: var(--font-ui); font: bold 1rem serif; }
      h2 { font-weight: var(--weight-heading); font-family: var(--font-kai); font: inherit; font-style: normal; }
      .strip { font-family: var(--font-kai, 'Kaiti SC', serif); }
      summary::before { content: '+'; }
      .mark::before { content: ''; }
      .note-term { text-decoration: underline dotted var(--color-accent); text-decoration-line: underline; }
      a { text-decoration: none; color: color-mix(in srgb, red, blue); text-wrap: balance; }
      .card { color: red; &:hover { color: blue; } .inner { color: green; } }
      @media (min-width: 960px) { .wide { color: red; } @supports (height: 100dvh) { .tall { height: 100dvh; } } }
      @keyframes arrive { from { opacity: 0; } to { opacity: 1; } }
      .strip-seal { font-family: var(--figure-font, 'Kaiti SC', serif); color: var(--figure-mark, #b03a2a); }
      .stage-pane:not(.is-wide) .strip { color: var(--color-ink); border-radius: var(--radius); }
      .tag { color: var(--figure-ink); background: var(--color-paper-sunk); }
      .stage-pane { background: var(--color-paper-sunk); --figure-ink: #28231f; }
      .card-name { --figure-ink: #000000; }
      .label { font-family: var(--font-sans); font-size: 1rem; }
      .label-fine { font-family: var(--font-sans); font-weight: var(--weight-sans); }
      .label-fine span { font-family: var(--font-song); font-weight: 400; }
      .frame { --weight-sans: 400; --font-kai: 'Kaiti SC', serif; --font-sans: 'Yanlu Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
    `;
    expect(tally(scanStyle('x.css', bad))).toEqual([
      'x.css | color-mix | color: color-mix(in srgb, red, blue) × 1',
      "x.css | content | content: '+' × 1",
      'x.css | font | font: bold 1rem serif × 1',
      'x.css | font-family | --font-kai: … × 1',
      'x.css | font-family | --font-ui: … × 1',
      'x.css | font-family | font-family: var(--font-kai) × 1',
      "x.css | font-family | font-family: var(--font-kai, 'Kaiti SC', serif) × 1",
      'x.css | font-family | font-family: var(--font-ui) × 1',
      'x.css | font-style | font-style: italic × 1',
      'x.css | font-weight | --weight-heading: … × 1',
      'x.css | font-weight | --weight-sans: 400 × 1',
      'x.css | font-weight | font-weight: 700 × 1',
      'x.css | font-weight | font-weight: var(--weight-heading) × 1',
      'x.css | nesting | &:hover × 1',
      'x.css | nesting | .inner × 1',
      'x.css | sans | PingFang × 1',
      'x.css | sans | YaHei × 1',
      'x.css | sans | sans-serif × 1',
      'x.css | sans | system-ui × 1',
      'x.css | sans-weight | .label × 1',
      'x.css | seam | .card-name { --figure-ink: … } × 1',
      'x.css | seam | .stage-pane:not(.is-wide) .strip { border-radius: var(--radius) } × 1',
      'x.css | seam | .stage-pane:not(.is-wide) .strip { color: var(--color-ink) } × 1',
      "x.css | seam | .strip { font-family: var(--font-kai, 'Kaiti SC', serif) } × 1",
      'x.css | seam | .tag { background: var(--color-paper-sunk) } × 1',
      'x.css | seam | .tag { color: var(--figure-ink) } × 1',
      'x.css | text-decoration | text-decoration: underline dotted var(--color-accent) × 1',
      'x.css | text-wrap | text-wrap: balance × 1',
    ]);
  });

  it('样式表里每一句 @media：照窗口的宽窄分版面的都带着“横着”（竖着拿的大平板够宽，可它是上下排的版面），没有老平板不认的写法', () => {
    const found = tally(styles.flatMap((path) => scanMedia(path, text(path))));
    expect(
      found,
      '左右排的版面要窗口 960 像素以上宽、而且横着：写成 @media (min-width: 960px) and (orientation: landscape)；要说“不是左右排”，写 @media not all and (min-width: 960px) and (orientation: landscape)。比大小的新写法（width >= …）iPadOS 15 不认',
    ).toEqual([]);
    // 确实查到了东西：分版面的那一句有好几处（layout.css、stage.css、guide.css、tokens.css），句句带着“横着”
    const byWidth = styles.flatMap((path) => mediaQueries(text(path))).filter((query) => /min-width:\s*(960|1280)px/.test(query));
    expect(byWidth.length).toBeGreaterThanOrEqual(8);
    for (const query of byWidth) expect(query).toContain('(orientation: landscape)');
    // 页面的程序里用到这句条件的只有一处（只有上下排的时候能收起沙盘）：和 layout.css 里分版面的那一句一字不差
    const inProgram = /const WIDE_SCREEN = '([^']+)';/.exec(text('src/ui/StagePane.tsx'))?.[1] ?? '';
    expect(mediaProblems(inProgram), `StagePane.tsx 的 WIDE_SCREEN：${inProgram}`).toEqual([]);
    expect(mediaQueries(text('src/styles/layout.css')), 'StagePane.tsx 的 WIDE_SCREEN 和 layout.css 分版面的那一句不是同一句了').toContain(inProgram);
  });

  it('查得出来：分版面的一句少了“横着”、拿 max-width 说上下排、比大小的新写法；别的 @media 不算', () => {
    expect(mediaProblems('(min-width: 960px)')).toEqual(['wide-layout']);
    expect(mediaProblems('(min-width: 1280px)')).toEqual(['wide-layout']);
    expect(mediaProblems('(min-width: 60rem)')).toEqual(['wide-layout']);
    expect(mediaProblems('not all and (min-width: 960px)')).toEqual(['wide-layout']);
    expect(mediaProblems('(max-width: 959px)')).toEqual(['max-width']);
    expect(mediaProblems('(width >= 960px) and (orientation: landscape)')).toEqual(['media-range']);
    expect(mediaProblems('(400px <= width <= 700px)')).toEqual(['media-range']);
    expect(mediaProblems('not (hover: hover)')).toEqual(['media-range']);
    expect(mediaProblems('(hover: hover) or (pointer: fine)')).toEqual(['media-range']);
    // 对的写法：源文件里的，和构建压缩以后的
    for (const fine of [
      '(min-width: 960px) and (orientation: landscape)',
      '(min-width:960px) and (orientation:landscape)',
      'not all and (min-width: 960px) and (orientation: landscape)',
      '(min-width: 1280px) and (orientation: landscape)',
      '(min-width: 600px)',
      '(max-width: 420px)',
      '(hover: hover)',
      '(prefers-reduced-motion: reduce)',
    ]) {
      expect(mediaProblems(fine), fine).toEqual([]);
    }
    const sheet = '/* @media (min-width: 960px) { 注释里的不算 } */ @media (min-width: 960px) { .a { color: red; } } @media (hover: hover) { .a:hover { color: blue; } } @media (min-width:960px) and (orientation:landscape){.b{color:red}}';
    expect(mediaQueries(sheet)).toEqual(['(min-width: 960px)', '(hover: hover)', '(min-width:960px) and (orientation:landscape)']);
    expect(tally(scanMedia('x.css', sheet))).toEqual(['x.css | wide-layout | (min-width: 960px) × 1']);
  });

  it('@container、cqw 一处也没有；:has( 最多六处，只在 layout.css 里（iPadOS 15 的 Safari 都不认：前两样原来分着沙盘栏宽窄两种排法，现在由页面量了栏宽挂类名来分）', () => {
    const count = (needle: string): Record<string, number> => Object.fromEntries(styles.map((path) => [path, countIn(stripCssComments(text(path)), needle)] as const).filter(([, times]) => times > 0));
    const total = (counts: Record<string, number>): number => Object.values(counts).reduce((sum, times) => sum + times, 0);
    const container = count('@container');
    const cqw = count('cqw');
    const has = count(':has(');
    expect(container, '样式表里又有了 @container：老平板上它里面的东西等于没有。改用沙盘栏上的 .is-wide（见 stage.css 开头）').toEqual({});
    expect(cqw, '样式表里又有了 cqw：老平板不认。沙盘栏的宽度用 --pane-w（见 stage.css 开头）').toEqual({});
    // 给沙盘栏起“可以按它的宽度查询”的名字（container、container-type、container-name）也不要了：用不着，还会让新旧浏览器排版的规矩不一样
    expect(count('container:'), JSON.stringify(count('container:'))).toEqual({});
    expect(count('container-'), JSON.stringify(count('container-'))).toEqual({});
    expect(Object.keys(has).every((path) => path === 'src/styles/layout.css'), JSON.stringify(has)).toBe(true);
    expect(total(has)).toBeLessThanOrEqual(6);
  });
});

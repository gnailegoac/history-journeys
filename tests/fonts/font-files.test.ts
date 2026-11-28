// 随站的字体：放进仓库的字体文件对不对、够不够（docs/data-spec.md 校验规则 19）。随 npm test 跑。
// 不用原字体，不连网：读的是 src/fonts/ 里放进仓库的那些文件（照 WOFF2 的格式解开，看它里面真有哪些字），
// 和现在的网站每一种页面要显示哪些字（tests/support/fontTool.ts 照页面自己的程序数出来的）。
// 字体文件是按范围分的：框架的两个哪一页都带着，别的一页只拿它自己那个范围的（一位人物的、他的一站的、“来源”页的）。
//
// 分三组：
//   一、每一种页面显示的每一个字都在给这一页的字体文件里。少了一个，这里说出是哪个字、在哪里用的，办法是 npm run fonts。
//   二、字体文件、记录、样式表、给页面用的三个模块、index.html 里的那一段、许可全文，彼此对得上；文件里的名称合许可的要求；大小不超过上限。
//   三、源文件里没有“工具数不到的字”和“Safari 15 读不懂的写法”。换字体以前的页面留下过几处，一处一处点了名列在
//       PENDING 里，后面的单元改到哪里删到哪里；现在这张名单是空的（最后两处是“读原文”“凭据”前面用 content 画的加号、减号，
//       换正文那一栏的样子时换成了页面上真的字）。名单只许变短，所以它只能一直空着：新冒出来的不许往里加，改掉它。

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { fontScopeReport } from '../content/budgetRules';
import {
  FALLBACK_OK,
  FONTS_BY_SCOPE,
  FONTS_DIR,
  FONT_SOURCES,
  FONT_SOURCE_IDS,
  KAI_FORBIDDEN,
  LIBRARY_LICENCES,
  LICENCES_DIR,
  PRELOAD_BLOCK,
  RECIPE,
  SCOPES_DIR,
  SCOPE_RECORD_VERSION,
  SQUEEZE_FEATURES,
  SQUEEZE_KEPT,
  codeOf,
  fontFileProblems,
  isInterfaceSource,
  missingOnPages,
  pageTexts,
  planFonts,
  planScopes,
  pressedSheetCss,
  readScoped,
  readSite,
  scopeFilePath,
  scopeFontsCss,
  scopeProbeTs,
  scopeRecord,
  scopesTs,
  sha256,
  shippedTs,
  sortedString,
  sourceFiles,
  sourceRecord,
  squeezeProblems,
  stripComments,
  toolVersions,
  withPreloadBlock,
  writtenForScopes,
} from '../support/fontTool';
import type { FontPlan, PageText, PlannedFile, ScopePlan, SiteTexts } from '../support/fontTool';
import { charactersOf, englishName, featuresOf, glyphCountOf, hintingOf, readWoff2, weightOf } from '../support/sfnt';
import { countIn, mediaProblems, mediaQueries, readCss, scanMedia, scanProgram, scanStyle, stripCssComments, tally } from '../support/sourceScan';
import { labelKind } from '../../src/stage/styles';

/** 项目的根目录：这个文件在 tests/fonts/ 里，往上两层。 */
const ROOT = new URL('../../', import.meta.url);
const at = (path: string): URL => new URL(path, ROOT);
const utf8 = new TextDecoder();
const text = (path: string): string => utf8.decode(readFileSync(at(path)));

/** 放进仓库的字体：记录（格式 4），和记录里每个文件读出来的样子。 */
const shipped = readScoped();
/** 现在的网站：每一种页面显示哪些字，照范围要做哪些文件、每一种页面拿哪几个（读一次，几项测试共用）。挨着会变样的字照记录里量到的那一串。 */
const site = readSite();
const texts: Promise<SiteTexts> = site.then((real) => pageTexts(real));
const plan: Promise<ScopePlan> = site.then((real) => planScopes(real, { joiners: shipped.record.joiners }));
/** 不分的时候的那四组（数字的那同一遍分出来的）：有几项只问“这个字数没数进去、算哪一种字”，还照它问。 */
const flat: Promise<FontPlan> = site.then((real) => planFonts(real));
const planned = async (group: string): Promise<PlannedFile> => {
  const found = (await flat).files.find((item) => item.group === group);
  if (!found) throw new Error(`数出来的字里没有 ${group} 这一组`);
  return found;
};
/** 放进仓库的一个文件里真有的字（照清单里的名字找，不带 .woff2）。 */
const inShipped = (name: string): Set<string> | undefined => shipped.files.find((item) => item.record.file.replace(/^.*\//, '') === `${name}.woff2`)?.characters;
/** 每一种页面显示的字，不在给这一页的、放进仓库的文件里的：每个字一句话，句尾是该跑哪条命令。都在是空的。 */
const missing = (from: SiteTexts, scoped: ScopePlan): string[] => missingOnPages(from, scoped, inShipped).map((line) => `${line}：运行 npm run fonts，再提交。`);
/** 照一份“每一种页面显示哪些字”另编一份：给其中一页的一组添一个字（看“少了字”查不查得出来）。 */
function withExtra(from: SiteTexts, pick: (page: PageText) => boolean, group: 'rest' | 'pressed' | 'sans' | 'kai', ch: string, where: string): SiteTexts {
  let done = false;
  const pages = from.pages.map((page) => {
    if (done || !pick(page)) return page;
    done = true;
    return { ...page, [group]: new Map([...page[group], [ch, new Set([where])]]) };
  });
  if (!done) throw new Error('没有找到要添字的那一页');
  return { ...from, pages };
}
/** 一站自己有文件的页面里的头一个（现在是眉州）；写好了正文的头一站（它有点开才要的字）。 */
const isUnit = (page: PageText): boolean => page.kind === 'unit';

// ---------------------------------------------------------------- 一、字都在

describe('网站上显示的每一个字都在随站的字体里', () => {
  // 这一条头一个等“要做的清单”（读整个网站的字、分到各种页面）：单独跑一秒多，机器忙的时候（两组测试一起跑）超过过平常的五秒——给它自己的时限。
  // 这个仓库的规矩：在 Node 里跑的测试，一条超过 1.5 秒的自己写时限。
  it('每一种页面显示的每一个字，都在给这一页的字体文件里（照放进仓库的文件里真有的字查）：用黑体排的字在框架的黑体或者这位人物的黑体里；题签和印上的字在这位人物的楷体里；不用点开就看得见的成句的字在框架的宋体或者这一页不用点开就要的那个宋体文件里；点开才看得见的字在这两个或者这一页点开才要的那个文件里', { timeout: 30_000 }, async () => {
    expect(missing(await texts, await plan)).toEqual([]);
    // 每一种页面都查到了：只有框架的、首页、每位人物的人物页、他有文件的站和没有文件的站、“来源”页
    expect([...new Set((await texts).pages.map((page) => page.kind))].sort()).toEqual(['figure', 'frame', 'home', 'sources', 'stop', 'unit']);
    // 清单里的每个文件，放进仓库的里面都有同名的一个（不然上面那一句查的是空的）
    for (const file of (await plan).files) expect(inShipped(file.name), `${file.name}.woff2 不在放进仓库的字体里：运行 npm run fonts，再提交`).toBeDefined();
  });

  it('全程沙盘的凭据里另外的两样也数进去了：“记号”一栏里小像的三句（场景文件的 piece），行迹的出处（手写的那一份的 sources：每一条的写法和读了它的什么）——每一个汉字都在框架的宋体文件，或者这位人物自己的两个宋体文件（不用点开的、点开才要的）之一里', async () => {
    const scoped = await plan;
    const figures = readdirSync(at('content/figures'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const lacking: string[] = [];
    let counted = 0;
    for (const figure of figures) {
      // 这位人物的人物页拿到的宋体文件：框架的，他自己不用点开的，点开才要的
      const page = scoped.pages.find((item) => item.kind === 'figure' && item.figure === figure);
      const song = new Set((page ? [...page.rest, ...page.pressed] : []).flatMap((name) => (scoped.files.find((file) => file.name === name && file.source === 'song') ? [...(scoped.files.find((file) => file.name === name)?.characters ?? '')] : [])));
      const need = (where: string, written: string): void => {
        for (const ch of written.match(/\p{Script=Han}/gu) ?? []) {
          counted++;
          if (!song.has(ch)) lacking.push(`${where}的“${ch}”`);
        }
      };
      const routePath = `content/figures/${figure}/scenes/route.json`;
      const handPath = `content/figures/${figure}/itinerary.json`;
      if (existsSync(at(routePath))) {
        const piece = (JSON.parse(text(routePath).replace(/^﻿/, '')) as { piece?: { name: string; basis: string; note: string } }).piece;
        if (piece) for (const written of [piece.name, piece.basis, piece.note]) need(`${routePath} 的 piece`, written);
      }
      if (existsSync(at(handPath))) {
        const sources = (JSON.parse(text(handPath).replace(/^﻿/, '')) as { sources: { cite: string; read: string }[] }).sources;
        for (const source of sources) for (const written of [source.cite, source.read]) need(`${handPath} 的出处`, written);
      }
    }
    // 真的数到了东西（至少一位人物有小像、有行迹）
    expect(counted).toBeGreaterThan(200);
    expect([...new Set(lacking)], '凭据里这几个字没有数进字体：tests/support/fontTool.ts 里数小像的三句、数行迹出处的那两处').toEqual([]);
  });

  it('查得出来：网站上多了一个字体里没有的字，这里通不过，说出是哪个字、在哪里用的、该跑哪条命令', async () => {
    const all = new Set(shipped.files.flatMap((file) => [...file.characters]));
    const absent = [...'龘䨻𪚥'].find((ch) => !all.has(ch));
    expect(absent, '找不到一个字体里没有的字来试').toBeDefined();
    if (!absent) return;
    const scoped = await plan;
    const unit = (await texts).pages.find(isUnit);
    expect(unit, '要有一站有自己的字体文件，这一项才试得了').toBeDefined();
    if (!unit) return;
    const given = scoped.pages.find((item) => item.kind === 'unit' && item.figure === unit.figure && item.stop === unit.stop);
    const files = (source: string, names: readonly string[]): string => names.filter((name) => scoped.files.find((file) => file.name === name)?.source === source).map((name) => `${name}.woff2`).join('、');
    for (const [group, where, what, source, names] of [
      ['kai', '徐州的题签', '用楷体排的字', 'kai', given?.rest ?? []],
      ['sans', '徐州的标题', '用黑体排的字', 'sans', given?.rest ?? []],
      ['rest', '徐州的正文', '不用点开就看得见的字', 'song', given?.rest ?? []],
      ['pressed', '徐州的原文', '点开才看得见的字', 'song', [...(given?.rest ?? []), ...(given?.pressed ?? [])]],
    ] as const) {
      expect(missing(withExtra(await texts, (page) => page === unit, group, absent, where), scoped), group).toEqual([
        `“${absent}”（${codeOf(absent)}，${where}里）是${unit.name}上${what}，不在这一页拿到的字体文件里（${files(source, names)}）：运行 npm run fonts，再提交。`,
      ]);
    }
  });

  it('查得出来：要一打开就看得见的字，只在这一页点开才下载的那个文件里有，不算数；要用楷体排的字、要用黑体排的字，只在宋体里有，也不算数；只在别的范围的文件里有的字也不算数', async () => {
    const scoped = await plan;
    const all = await texts;
    // 一站自己有两个宋体文件的页面（写好了正文的站）
    const given = scoped.pages.find((item) => item.kind === 'unit' && item.pressed.length > 0);
    const unit = all.pages.find((page) => page.kind === 'unit' && page.figure === given?.figure && page.stop === given?.stop);
    expect(given && unit, '要有一站有自己的两个宋体文件，这一项才试得了').toBeTruthy();
    if (!given || !unit) return;
    const of = (name: string): Set<string> => inShipped(name) ?? new Set<string>();
    const own = of(given.rest[given.rest.length - 1]);
    const more = of(given.pressed[0]);
    const frame = of('yanlu-song');
    const sans = new Set([...of('yanlu-sans'), ...of(`yanlu-sans-${given.figure}`)]);
    const kai = of(`yanlu-kai-${given.figure}`);
    const han = (ch: string): boolean => (ch.codePointAt(0) ?? 0) > 0x2e7f;
    const onlyMore = [...more].find((ch) => !own.has(ch) && !frame.has(ch));
    const onlySong = [...own].find((ch) => han(ch) && !kai.has(ch) && !sans.has(ch));
    expect(onlyMore && onlySong, '要有只在点开才要的那个文件里的字，和只在这一站不用点开的宋体文件里的汉字，这一项才试得了').toBeTruthy();
    if (!onlyMore || !onlySong) return;
    const said = (group: 'rest' | 'pressed' | 'sans' | 'kai', ch: string, where: string): string[] => missing(withExtra(all, (page) => page === unit, group, ch, where), scoped);
    expect(said('rest', onlyMore, '徐州的正文')).toHaveLength(1);
    expect(said('rest', onlyMore, '徐州的正文')[0]).toContain(`“${onlyMore}”（${codeOf(onlyMore)}，徐州的正文里）是${unit.name}上不用点开就看得见的字，不在这一页拿到的字体文件里`);
    expect(said('kai', onlySong, '徐州的题签')[0]).toContain(`“${onlySong}”（${codeOf(onlySong)}，徐州的题签里）是${unit.name}上用楷体排的字，不在这一页拿到的字体文件里`);
    expect(said('sans', onlySong, '徐州的标题')[0]).toContain(`“${onlySong}”（${codeOf(onlySong)}，徐州的标题里）是${unit.name}上用黑体排的字，不在这一页拿到的字体文件里`);
    // 反过来不算错：点开才看得见的字，这一页不用点开的那个文件里有也行
    expect(said('pressed', onlySong, '徐州的原文')).toEqual([]);
    // 范围之间不借：另一位人物的文件里有、这一页拿到的文件里没有的一个字，排进这一页——不算数
    const mine = new Set([...frame, ...own, ...more]);
    const others = scoped.files.filter((file) => file.source === 'song' && file.scope !== 'frame' && file.scope !== given.figure);
    const elsewhere = others.flatMap((file) => [...(inShipped(file.name) ?? [])]).find((ch) => !mine.has(ch));
    expect(elsewhere, '要有一个字只在别的范围的宋体文件里有').toBeDefined();
    if (!elsewhere) return;
    expect(said('pressed', elsewhere, '徐州的原文')).toHaveLength(1);
  });

  it('题签和印上的字里没有弯引号（这套楷体里它们只有三分之一个字宽）；标题、小节名是黑体的了，里面有弯引号不归这一条管', async () => {
    const kai = await planned('kai');
    const found = [...KAI_FORBIDDEN].filter((ch) => kai.characters.includes(ch)).map((ch) => `“${ch}”（${codeOf(ch)}）用在${(kai.where.get(ch) ?? []).join('、')}里：换个说法，或者先问一声`);
    expect(found).toEqual([]);
  });

  it('楷体那一组里只有题签是竖着的纸条的沙盘上的字：content/ 里题签是平着的纸条的全程沙盘（样式的登记表里写了 slip），它的人物页没有一个字是为它放进楷体的，这位人物也就没有楷体的文件；这样的人物自己的那一套记号里题签的字体打头的是随站的宋体，竖着的纸条的打头的是随站的楷体里他自己的那一个（名称后面带着他的 id），放进仓库的楷体文件正好是这样的人物各一个', { timeout: 30_000 }, async () => {
    const kai = await planned('kai');
    const usedIn = new Set([...kai.where.values()].flat());
    const figures = readdirSync(at('content/figures'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const tokens = stripCssComments(text('src/styles/tokens.css'));
    /** 这位人物的沙盘栏上题签的字体记号写的是什么：他自己的那一块里写了就是它，没写就是不写人物的那一块里的。 */
    const figureFont = (id: string): string =>
      new RegExp(`\\[data-figure='${id}'\\] \\.stage-pane \\{[^}]*--figure-font:\\s*([^;]+);`).exec(tokens)?.[1] ?? /(?:^|\n)\.stage-pane \{[^}]*--figure-font:\s*([^;]+);/.exec(tokens)?.[1] ?? '';
    const seen: string[] = [];
    const strips: string[] = [];
    for (const id of figures) {
      const routePath = `content/figures/${id}/scenes/route.json`;
      if (!existsSync(at(routePath))) continue;
      const route = JSON.parse(text(routePath).replace(/^﻿/, '')) as { style: string };
      const name = (JSON.parse(text(`content/figures/${id}/figure.json`).replace(/^﻿/, '')) as { name: string }).name;
      const kind = labelKind(route.style);
      const mine = [...usedIn].filter((where) => where.startsWith(`${name}的人物页`));
      seen.push(`${id} ${kind}`);
      if (kind === 'slip') {
        expect(mine, `${id}：题签是平着的纸条，楷体那一组里不该有为它放的字`).toEqual([]);
        expect(figureFont(id).startsWith("'Yanlu Song'"), `${id}：题签是平着的纸条，--figure-font 打头的要是随站的宋体（写的是 ${figureFont(id)}）`).toBe(true);
      } else {
        strips.push(id);
        expect(mine.length, `${id}：题签是竖着的纸条，楷体那一组里要有它的题签和印`).toBeGreaterThan(0);
        expect(figureFont(id).startsWith(`'Yanlu Kai ${id}'`), `${id}：题签是竖着的纸条，--figure-font 打头的要是随站的楷体里他自己的那一个（'Yanlu Kai ${id}'；写的是 ${figureFont(id)}）`).toBe(true);
      }
    }
    // 两种都真的查到了
    expect(seen.some((line) => line.endsWith(' slip')), seen.join('、')).toBe(true);
    expect(seen.some((line) => line.endsWith(' strip')), seen.join('、')).toBe(true);
    // 放进仓库的楷体文件：题签是竖着的纸条的人物各一个，样式表里的名称就是记号里打头的那一个
    expect(shipped.record.files.filter((item) => item.source === 'kai').map((item) => [item.file, item.face])).toEqual(strips.sort().map((id) => [`${SCOPES_DIR}/yanlu-kai-${id}.woff2`, `Yanlu Kai ${id}`]));
  });

  it('楷体那一组、黑体那一组的每一个字，头一组宋体里也有（楷体还在路上时题签先用宋体，不为它去取点开才要的文件；黑体的字不管点没点开都归头一组）', async () => {
    const song = await planned('song');
    for (const group of ['kai', 'sans']) expect([...(await planned(group)).characters].filter((ch) => !song.characters.includes(ch)), group).toEqual([]);
  });

  it('没有哪个字是指望设备自带的字体的；有的话要记着理由', async () => {
    // 记着的正好是网站上真的用到了的那几个：不用了的要从 FALLBACK_OK 里拿掉
    expect((await flat).fallback).toBe(sortedString(Object.keys(FALLBACK_OK)));
    expect((await plan).fallback).toBe(sortedString(Object.keys(FALLBACK_OK)));
    for (const [ch, why] of Object.entries(FALLBACK_OK)) expect(why.trim(), `FALLBACK_OK 里“${ch}”没有写理由`).not.toBe('');
  });

  it('文件里多带了已经不用的字不算错；多到四十个以上提醒一句', async () => {
    const wanted = new Map((await plan).files.map((file) => [scopeFilePath(file), new Set(file.characters)]));
    let seen = 0;
    for (const item of shipped.files) {
      const characters = sortedString([...item.characters].filter((ch) => !wanted.get(item.record.file)?.has(ch)));
      const count = [...characters].length;
      seen++;
      if (count > 40) console.warn(`[字体] ${item.record.file} 里有 ${count} 个字网站已经不用了（${characters}）：运行 npm run fonts 重做一遍，文件能小一些。`);
      expect(count).toBeGreaterThanOrEqual(0);
    }
    expect(seen).toBe(shipped.record.files.length);
  });
});

// ---------------------------------------------------------------- 二、文件、记录、样式表、许可对得上

describe('放进仓库的字体文件和它的记录、样式表、许可全文对得上', () => {
  it('记录的格式、做法、原字体，是 tests/support/fontTool.ts 里现在写的那些', () => {
    expect(shipped.record.tool, '记录的格式换了（SCOPE_RECORD_VERSION）：运行 npm run fonts，再提交').toBe(SCOPE_RECORD_VERSION);
    expect(shipped.record.recipe, '做法改过了（RECIPE）：运行 npm run fonts，再提交').toBe(RECIPE);
    // 原字体的每一项说明（名字、版本、从哪里取、网站、字节数、记号、版权声明、许可文件、留哪些排版功能）都和现在写的一样
    expect(Object.keys(shipped.record.sources).sort(), '记录里的原字体正好是这三个').toEqual([...FONT_SOURCE_IDS].sort());
    for (const id of FONT_SOURCE_IDS) {
      expect(shipped.record.sources[id], `${FONT_SOURCES[id].name} 的说明改过了（tests/support/fontTool.ts 的 FONT_SOURCES）：运行 npm run fonts，再提交`).toEqual(sourceRecord(id));
    }
    // 做的时候裁剪工具的版本，就是现在装着的（换了版本，字节可能不一样：重做一遍）
    expect(shipped.record.made, '裁剪字体的库换了版本：运行 npm run fonts，再提交').toEqual(toolVersions());
  });

  it('要做的是哪几个文件，记录里就是哪几个，先后也一样；每一种页面拿哪几个文件、合计多少字节，记录里写的就是照清单和这些文件算出来的', async () => {
    const scoped = await plan;
    expect(shipped.record.files.map((item) => item.file)).toEqual(scoped.files.map(scopeFilePath));
    for (const file of scoped.files) {
      const item = shipped.record.files.find((entry) => entry.file === scopeFilePath(file));
      expect([item?.face, item?.family, item?.postscript, item?.source, item?.scope, item?.unit, item?.role, item?.range, item?.preload, item?.sheet], file.name).toEqual([file.face, file.family, file.postscript, file.source, file.scope, file.unit, file.role, file.range, file.preload, file.sheet]);
    }
    // 框架的两个在最前面（黑体、宋体），哪一页都要，在 index.html 里预先声明；带 unicode-range 的正好是点开才要的那几个，名字末尾都是 -more
    expect(shipped.record.files.slice(0, 2).map((item) => [item.file, item.scope, item.source, item.range, item.preload])).toEqual([
      ['yanlu-sans.woff2', 'frame', 'sans', false, 'always'],
      ['yanlu-song.woff2', 'frame', 'song', false, 'always'],
    ]);
    expect(shipped.record.files.filter((item) => item.scope === 'frame')).toHaveLength(2);
    for (const item of shipped.record.files) {
      expect(item.range, item.file).toBe(item.role === 'pressed');
      expect(/-more\.woff2$/.test(item.file), item.file).toBe(item.role === 'pressed');
      if (item.scope !== 'frame') expect(item.file.startsWith(`${SCOPES_DIR}/`), item.file).toBe(true);
    }
    // 每一种页面的那一项、首页摆着谁、挨着会变样的字（都在框架的宋体文件里，别的宋体文件里没有）
    const again = scopeRecord(scoped, shipped.record.files, shipped.record.made);
    expect(shipped.record.pages).toEqual(again.pages);
    expect(shipped.record.home).toBe(scoped.home);
    expect(shipped.record.joiners).toBe(scoped.joiners);
    expect([...shipped.record.joiners].length).toBeGreaterThan(50);
    const frameSong = shipped.files.find((item) => item.record.file === 'yanlu-song.woff2')?.characters ?? new Set<string>();
    for (const ch of shipped.record.joiners) {
      expect(frameSong.has(ch), `“${ch}”`).toBe(true);
      expect(shipped.files.filter((item) => item.record.source === 'song' && item.characters.has(ch)).map((item) => item.record.file), `“${ch}”`).toEqual(['yanlu-song.woff2']);
    }
    // 每一种页面的合计：就是它不用点开就要的那几个文件的字节加起来（文件真的那么大，下一项一个一个查）
    for (const page of shipped.record.pages) expect(page.bytes).toBe(page.rest.reduce((sum, file) => sum + (shipped.record.files.find((item) => item.file === file)?.bytes ?? NaN), 0));
  });

  it('宋体按站拆开的那个开关没有了（早先想过的一种分法，没有用上，换成了按范围分）：tests/support/fontTool.ts 里不再有它；按范围分的开关开着；记录里每个文件写着归哪个范围、哪一站，不再有“只归哪一站”“是哪一组”那两栏', () => {
    expect(text('tests/support/fontTool.ts')).not.toContain('SPLIT_SONG_BY_STOP');
    expect(FONTS_BY_SCOPE).toBe(true);
    for (const item of shipped.record.files) {
      expect(Object.keys(item), item.file).toEqual(expect.arrayContaining(['scope', 'unit', 'role']));
      expect(Object.keys(item).filter((key) => key === 'stop' || key === 'group' || key === 'first'), item.file).toEqual([]);
    }
    // 归哪一站的文件，名字里就带着那一站；不归哪一站的 unit 是 null
    for (const item of shipped.record.files) expect(item.unit === null || item.file.includes(`-${item.scope}-${item.unit}`), item.file).toBe(true);
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

  it('文件里的名称是自己的，没有原字体保留的名字；版权声明和原字体的一样；楷体带着竖排用的两张表；提示信息照做法里写的（宋体和黑体留着，楷体没有）', () => {
    const problems = shipped.files.flatMap((file) => fontFileProblems(file.record, file.tables));
    expect(problems, '字体文件和现在的做法对不上：运行 npm run fonts，再提交').toEqual([]);
    // 查得出来：把宋体的文件当成楷体的来查（楷体的做法是没有提示信息），说得出提示信息对不上
    const song = shipped.files.find((file) => file.record.source === 'song');
    expect(song && fontFileProblems({ ...song.record, source: 'kai' }, song.tables).some((line) => line.includes('提示信息'))).toBe(true);
    // 名称表里记着的版权声明就是记录里那一条（记录里的又和 fontTool.ts 里的一样，上面查过）
    for (const file of shipped.files) expect(englishName(file.tables, 0)).toBe(shipped.record.sources[file.record.source].copyright);
  });

  it('每个文件的名称互不相同（同一套字体分成了好几个文件，标识和 PostScript 名称要分得开）', () => {
    for (const id of [3, 6]) {
      const names = shipped.files.map((file) => englishName(file.tables, id));
      expect(new Set(names).size, `名称表第 ${id} 条`).toBe(names.length);
    }
    // 同一套字体的文件，写在文件里的字体名称相同（哪个范围的文件都是 Yanlu Sans、Yanlu Song、Yanlu Kai）；样式表里的名称各个范围是各自的
    const families = new Map<string, Set<string | undefined>>();
    for (const file of shipped.files) families.set(file.record.source, (families.get(file.record.source) ?? new Set()).add(englishName(file.tables, 1)));
    for (const [source, names] of families) expect(names.size, source).toBe(1);
    expect(new Set(shipped.record.files.filter((item) => item.role === 'rest').map((item) => item.face)).size).toBe(shipped.record.files.filter((item) => item.role === 'rest').length);
  });

  it('样式表正好是照这几个文件写的：fonts.css 里不用点开就要的文件一个一条，都不带 unicode-range，每个范围一条换名称的规则；点开才要的文件各在自己的一份样式表里，那一条带着 unicode-range，列的正好是这个文件里的字', async () => {
    const scoped = await plan;
    const css = text(`${FONTS_DIR}/fonts.css`);
    const hint = '不是照清单写的：运行 npm run fonts（字体文件没变的话它只把这一份重写），再提交';
    expect(css, `样式表${hint}`).toBe(scopeFontsCss(scoped.files));
    // 工具重写这一份时用的就是这一个函数
    const written = writtenForScopes(scoped);
    expect(written.css).toBe(css);
    // 不靠写样式表的那个函数，另读一遍
    const rest = shipped.files.filter((file) => file.record.role === 'rest');
    const rules = stripCssComments(css).split('@font-face').slice(1);
    expect(rules).toHaveLength(rest.length);
    rules.forEach((rule, i) => {
      const file = rest[i];
      expect(rule.match(/url\('\.\/([^']+)'\)/)?.[1]).toBe(file.record.file);
      expect(rule.match(/font-family: '([^']+)'/)?.[1]).toBe(file.record.face);
      // 粗细是这个文件自己的那一种：黑体的是 500，别的是 400
      expect(rule.match(/font-weight: (\d+);/)?.[1], `${file.record.file} 的粗细`).toBe(String(file.record.weight));
      expect(rule.includes('unicode-range'), file.record.file).toBe(false);
    });
    // 换名称的规则：有不用点开就要的黑体或者宋体文件的范围各一条（楷体不在这里换），写的名称前面都有 @font-face
    const switches = stripCssComments(css).split('\n').filter((line) => line.startsWith(':root'));
    const scopes = [...new Set(rest.filter((file) => file.record.scope !== 'frame' && file.record.source !== 'kai').map((file) => `${file.record.scope}|${file.record.unit ?? ''}`))];
    expect(switches).toHaveLength(scopes.length);
    for (const line of switches) for (const [, name] of line.matchAll(/: '([^']+)';/g)) expect(rest.map((file) => file.record.face)).toContain(name);
    // 点开才要的：一个文件一份样式表，在 scopes/ 里
    const pressed = shipped.files.filter((file) => file.record.role === 'pressed');
    expect(Object.keys(written.sheets)).toEqual(pressed.map((file) => file.record.sheet));
    for (const file of pressed) {
      const sheet = text(`${FONTS_DIR}/${file.record.sheet}`);
      const planned = scoped.files.find((item) => scopeFilePath(item) === file.record.file);
      expect(sheet, `${file.record.sheet} ${hint}`).toBe(planned ? pressedSheetCss(planned) : '');
      const faces = stripCssComments(sheet).split('@font-face').slice(1);
      expect(faces).toHaveLength(1);
      expect(faces[0].match(/url\('\.\/([^']+)'\)/)?.[1]).toBe(file.record.file.replace(`${SCOPES_DIR}/`, ''));
      expect(faces[0].match(/font-family: '([^']+)'/)?.[1]).toBe(file.record.face);
      const listed = (faces[0].match(/unicode-range: ([^;]+);/)?.[1] ?? '').split(', ').map((entry) => String.fromCodePoint(parseInt(entry.replace(/^U\+/, ''), 16)));
      expect(listed.join('')).toBe(file.record.characters);
      expect(new Set(listed)).toEqual(file.characters);
      // 它的名称和同一个范围不用点开就要的那个宋体文件的名称是同一个（一套字体的两个文件）
      expect(rest.filter((item) => item.record.source === 'song' && item.record.scope === file.record.scope && item.record.unit === file.record.unit).map((item) => item.record.face)).toEqual([file.record.face]);
    }
  });

  it('给页面用的三个模块和 index.html 里的那一段是照清单写的：三套字体的表（shipped.ts）里没有汉字；页面一打开就要的那一样（probe.ts）是楷体文件里写的名称，没有汉字；每个范围点开才要的文件的那张表（scopes.ts）里除了每个文件的那一个字，没有别的汉字，那一个字只在这个文件里；index.html 里那一段每个范围不用点开就要的黑体、宋体文件各一行', async () => {
    const scoped = await plan;
    const written = writtenForScopes(scoped);
    const table = text(`${FONTS_DIR}/shipped.ts`);
    const small = text(`${FONTS_DIR}/probe.ts`);
    const lazy = text(`${FONTS_DIR}/scopes.ts`);
    const hint = '不是照清单写的：运行 npm run fonts（字体文件没变的话它只把这一份重写），再提交';
    expect(table, `给“来源”页用的模块${hint}`).toBe(shippedTs());
    expect(small, `页面一打开就要的那个模块${hint}`).toBe(scopeProbeTs());
    expect(written.probe).toBe(small);
    expect(lazy, `每个范围点开才要的文件的那张表${hint}`).toBe(scopesTs(scoped.files));
    expect(written.scopes).toBe(lazy);
    expect([...stripComments(table)].filter((ch) => (ch.codePointAt(0) ?? 0) > 0x7e)).toEqual([]);
    expect([...stripComments(small)].filter((ch) => (ch.codePointAt(0) ?? 0) > 0x7e)).toEqual([]);
    // probe.ts 里的名称就是楷体的文件里写着的名称；样式表里一位人物的楷体叫“这个名称 + 他的 id”
    const kaiFamily = /KAI_FAMILY = '([^']+)'/.exec(small)?.[1] ?? '';
    for (const file of shipped.files.filter((item) => item.record.source === 'kai')) {
      expect(englishName(file.tables, 1)).toBe(kaiFamily);
      expect(file.record.face).toBe(`${kaiFamily} ${file.record.scope}`);
    }
    // scopes.ts：点开才要的文件各一行，那一个字是这个文件里编码最小的，只在这个文件里（这一页拿到的别的文件里没有）
    const pressed = shipped.files.filter((file) => file.record.role === 'pressed');
    const rows = lazy.split('\n').filter((line) => line.startsWith("  '"));
    expect(rows).toHaveLength(pressed.length);
    const probes = rows.map((row) => /probe: '([^']+)'/.exec(row)?.[1] ?? '');
    expect([...stripComments(lazy)].filter((ch) => (ch.codePointAt(0) ?? 0) > 0x7e).sort()).toEqual([...probes].sort());
    pressed.forEach((file, index) => {
      expect(probes[index], file.record.file).toBe([...file.record.characters][0]);
      expect(rows[index]).toContain(`face: '${file.record.face}'`);
      expect(rows[index].startsWith(`  '${file.record.unit === null ? file.record.scope : `${file.record.scope}/${file.record.unit}`}'`), rows[index]).toBe(true);
      const page = shipped.record.pages.find((item) => item.pressed.includes(file.record.file));
      expect(page, file.record.file).toBeDefined();
      for (const other of page?.rest ?? []) expect(shipped.files.find((item) => item.record.file === other)?.characters.has(probes[index]), `${other} 里也有“${probes[index]}”`).toBe(false);
    });
    // index.html 里的那一段：就是照清单写的那几行，接在两行生效的预先声明后面
    const html = text('index.html');
    expect(html, `index.html 里的那一段${hint.replace('这一份', '那一段')}`).toBe(withPreloadBlock(html, written.preloads));
    const block = html.slice(html.indexOf(PRELOAD_BLOCK.start), html.indexOf(PRELOAD_BLOCK.end));
    const inert = [...block.matchAll(/<link rel="preload" href="\/src\/fonts\/([^"]+)"[^>]*media="not all"[^>]*>/g)].map((match) => match[1]);
    expect(inert).toEqual(shipped.record.files.filter((item) => item.preload === 'scope').map((item) => item.file));
    expect(shipped.record.files.filter((item) => item.preload === 'scope').map((item) => [item.role, item.source === 'kai'])).toEqual(inert.map(() => ['rest', false]));
    const live = [...html.replace(block, '').matchAll(/<link rel="preload" href="\/src\/fonts\/([^"]+)" as="font"[^>]*>/g)].map((match) => match[1]);
    expect(live).toEqual(shipped.record.files.filter((item) => item.preload === 'always').map((item) => item.file));
  });

  // 这一条把 src/ 里的每一个文件读两遍：单独跑不到一秒，机器忙的时候到过两秒、超过过平常的五秒——给它自己的时限（规矩同文件开头那一条）
  it('页面一打开就下载的程序不引入三套字体的那张表，也不直接引入每个范围点开才要的文件的那张表：src/ 里引入 shipped.ts 的只有“来源”页的那一块（SourcesBody.tsx）；scopes.ts 只在 main.tsx 里用到时才引入（import(…)）；别处要楷体的名称，引 probe.ts', { timeout: 30_000 }, () => {
    const importers = (module: string): string[] =>
      sourceFiles()
        .filter((path) => new RegExp(`from '[./]+/fonts/${module}'`).test(text(path)))
        .sort();
    expect(importers('shipped')).toEqual(['src/ui/SourcesBody.tsx']);
    expect(importers('probe')).toEqual(['src/ui/StagePane.tsx']);
    // scopes.ts：没有谁一上来就引入它；用到时才引入的只有一处
    expect(importers('scopes')).toEqual([]);
    //（src/fonts/scope.ts 里写的 typeof import('./scopes') 只是说它是什么样子，不引入）
    const lazily = sourceFiles().filter((path) => /(?<!typeof )import\('[./]+\/(fonts\/)?scopes'\)/.test(stripComments(text(path))));
    expect(lazily).toEqual(['src/main.tsx']);
    // 字体的名称在页面的程序里不另写一遍
    for (const path of sourceFiles().filter((file) => !file.startsWith(`${FONTS_DIR}/`))) {
      expect(stripComments(text(path)), `${path} 里又写了一遍字体名称：从 src/fonts/probe.ts 引`).not.toMatch(/Yanlu (Song|Kai|Sans)/);
    }
  });

  it('src/fonts/ 里只有这几样', () => {
    // 工具做的：框架的两个字体文件、样式表、记录、给页面用的三个模块，和 scopes/ 这个文件夹（各个范围的字体文件、点开才要的字的样式表）。
    // 另有手写的一个 scope.ts（页面把自己的字体归哪个范围写到 <html> 上，照它要文件）
    const frame = shipped.record.files.filter((item) => item.scope === 'frame').map((item) => item.file);
    const want = [...frame, 'fonts.css', 'fonts.json', 'shipped.ts', 'probe.ts', 'scopes.ts', 'scope.ts', SCOPES_DIR].sort();
    expect(readdirSync(at(`${FONTS_DIR}/`)).sort()).toEqual(want);
    const scoped = shipped.record.files.filter((item) => item.scope !== 'frame');
    const inScopes = [...scoped.map((item) => item.file), ...new Set(scoped.filter((item) => item.role === 'pressed').map((item) => item.sheet))].map((path) => path.replace(`${SCOPES_DIR}/`, '')).sort();
    expect(readdirSync(at(`${FONTS_DIR}/${SCOPES_DIR}/`)).sort()).toEqual(inScopes);
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

  it('大小不超过上限：每一种页面首次打开要下载的合计 360 KB，框架的两个文件合计 170 KB，一个文件 300 KB，点开才要的字的样式表压缩以后 4,096 字节', () => {
    // 每一种页面拿哪几个文件，记录里记着（上面查过和现在要做的一样）；每一种页面各算各的，哪一页超了说哪一页
    const named = (page: (typeof shipped.record.pages)[number]): string =>
      page.kind === 'frame' ? '只有框架的字的页面' : page.kind === 'sources' ? '“来源”页' : page.kind === 'home' ? `首页（摆着 ${page.figure}）` : page.unit ? `${page.figure}/${page.unit} 这一站` : `${page.figure} 的人物页`;
    const sheets = [...new Set(shipped.record.files.filter((item) => item.role === 'pressed').map((item) => item.sheet))];
    const report = fontScopeReport({
      files: shipped.files.map((item) => ({ file: item.record.file, bytes: item.bytes.length, frame: item.record.scope === 'frame' })),
      pages: shipped.record.pages.map((page) => ({ name: named(page), rest: page.rest, pressed: page.pressed })),
      sheets: sheets.map((file) => ({ file, gzip: gzipSync(readFileSync(at(`${FONTS_DIR}/${file}`)), { level: 9 }).length })),
    });
    console.log(['随站的字体有多大', ...report.lines.map((line) => `  ${line}`)].join('\n'));
    for (const warn of report.warns) console.warn(`[字体] 快到上限了：${warn}`);
    expect(report.fails).toEqual([]);
    // 真的查到了东西：每一种页面一行，样式表各一行
    expect(shipped.record.pages.length).toBeGreaterThanOrEqual(5);
    expect(sheets.length).toBeGreaterThan(0);
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

  it('样式表里：每套字体只用它那一种粗细（黑体 500，别的 400）、不用斜体、字体只用三个记号（宋体、黑体、题签用的人物自己的一个）、设黑体的每一条都同时写粗细（黑体的粗细也只写在设黑体的规则里）、框架的字体记号只写在 :root 上、框架的样式和题签的样式各读各的那一套记号（题签不和别的东西写在同一条规则里，题签上面的五层上、紧挨在它们下面的 * 上不写它会接过去的粗细、排版功能、字距）、content 里不写字、不用 Safari 15 读不懂的写法（PENDING 里点了名的除外：现在一处也没有）', () => {
    expect(styles.length).toBeGreaterThan(5);
    const found = tally(styles.flatMap((path) => scanStyle(path, text(path))));
    const allowed = PENDING.map((item) => `${item.file} | ${item.rule} | ${item.what} × ${item.times}`).sort();
    const fresh = found.filter((line) => !allowed.includes(line));
    const gone = allowed.filter((line) => !found.includes(line));
    expect(fresh, '样式表里新冒出来的写法（不许往 PENDING 里加，改掉它）').toEqual([]);
    expect(gone, 'PENDING 里的这几项样式表里已经没有了（或者次数变了）：把它们从 PENDING 里删掉（次数少了就改小）').toEqual([]);
    for (const item of PENDING) expect(item.unit, `${item.file} ${item.what}：要写明由哪个单元去掉`).toMatch(/^U[2-6]$/);
  });

  it('查得出来：样式表里加粗、斜体、别的字体、content 里的字、带颜色的 text-decoration 简写、color-mix、text-wrap、嵌套、框架和题签读错了记号、题签和别的东西写在同一条规则里、人物的那一块里（栏上挂着状态类名的规则也算）写了框架的记号、题签上面的五层上和紧挨在它们下面的 * 上写了题签会接过去的东西、黑体没有写粗细、没设黑体的写了黑体的粗细（一条规则里写了两次字体算后一次）、字体的记号写在了 :root 以外或者不是随站的字体打头', () => {
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
      :root { --font-sans: 'Yanlu Sans', 'PingFang SC', 'Microsoft YaHei', sans-serif; --font-song: 'Songti SC', serif; }
      .frame { --weight-sans: 400; --font-kai: 'Kaiti SC', serif; }
      .guide-panel { --font-sans: 'Yanlu Sans', 'Microsoft YaHei', sans-serif; }
      .strip, .tag { color: var(--color-ink); }
      [data-figure='x'] .stage-pane { --color-accent: #000000; --figure-font: 'Yanlu Sans', serif; }
      .prose strong { font-weight: var(--weight-sans); }
      .label-last { font-family: var(--font-sans); font-weight: var(--weight-sans); font-weight: 400; }
      .stage-pane.is-wide .stage-host { letter-spacing: 0.04em; }
      .stage-pane::after { letter-spacing: 0.04em; }
      .stage-pane .stage-reset { letter-spacing: 0.04em; }
      .stage-still-host .strips { letter-spacing: 0.04em; }
      .strips::before { letter-spacing: 0.04em; }
      .stage-host * { font-weight: 400; }
      .stage-pane > * { font-feature-settings: normal; }
      .stage-pane .stage-controls * { letter-spacing: 0.04em; }
      .stage-pane.is-wide { --color-accent: #000000; --shade-more: #000000; --stage-pane-h: 10px; }
      [data-figure='y'] .stage-pane { --fade-plate: #ffffff; }
      .label-twice { font-family: var(--font-sans); font-family: var(--font-song); font-weight: var(--weight-sans); }
      .label-back { font-family: var(--font-song); font-family: var(--font-sans); font-weight: var(--weight-sans); }
    `;
    expect(tally(scanStyle('x.css', bad))).toEqual([
      'x.css | color-mix | color: color-mix(in srgb, red, blue) × 1',
      "x.css | content | content: '+' × 1",
      'x.css | font | font: bold 1rem serif × 1',
      // 人物的字体记号不是网站自己带的题签用的字（随站的楷体、读正文的宋体）打头
      "x.css | font-family | --figure-font: 'Yanlu Sans', serif × 1",
      'x.css | font-family | --font-kai: … × 1',
      // :root 上的宋体记号不是随站的宋体打头
      "x.css | font-family | --font-song: 'Songti SC', serif × 1",
      'x.css | font-family | --font-ui: … × 1',
      // 黑体的记号写在了 :root 以外（它里面那两个设备上的名字也就不算数了，见下面 sans 的两行各多一次）
      'x.css | font-family | .guide-panel { --font-sans: … } × 1',
      'x.css | font-family | font-family: var(--font-kai) × 1',
      "x.css | font-family | font-family: var(--font-kai, 'Kaiti SC', serif) × 1",
      'x.css | font-family | font-family: var(--font-ui) × 1',
      'x.css | font-style | font-style: italic × 1',
      'x.css | font-weight | --weight-heading: … × 1',
      'x.css | font-weight | --weight-sans: 400 × 1',
      // 黑体粗细的记号写在了 :root 以外
      'x.css | font-weight | .frame { --weight-sans: … } × 1',
      'x.css | font-weight | font-weight: 700 × 1',
      'x.css | font-weight | font-weight: var(--weight-heading) × 1',
      // 紧挨在题签上面那几层下面的 *：题签和放题签的几层都在里面（栏里按钮那一排下面的 * 不算）
      'x.css | inherit | .stage-host * { font-weight: 400 } × 1',
      'x.css | inherit | .stage-pane > * { font-feature-settings: normal } × 1',
      // 题签上面的那五层上写了题签会接过去的东西（.stage-pane::after、.strips::before 和栏里面的按钮不算）
      'x.css | inherit | .stage-pane.is-wide .stage-host { letter-spacing: 0.04em } × 1',
      // 题签自己的那一层（.strips）也是这五层之一，从哪里说到它都算
      'x.css | inherit | .stage-still-host .strips { letter-spacing: 0.04em } × 1',
      'x.css | nesting | &:hover × 1',
      'x.css | nesting | .inner × 1',
      'x.css | sans | PingFang × 1',
      'x.css | sans | YaHei × 2',
      'x.css | sans | sans-serif × 2',
      'x.css | sans | system-ui × 1',
      'x.css | sans-weight | .label × 1',
      // 设了黑体，可是这一条里最后写的粗细是 400
      'x.css | sans-weight | .label-last × 1',
      // 一条规则里写了两次字体，后写的算数：先黑体、后宋体，这一条就没有设黑体，写黑体的粗细不对（先宋体、后黑体的 .label-back 是对的）
      'x.css | sans-weight | .label-twice { font-weight: var(--weight-sans) } × 1',
      // 没有设黑体的规则写了黑体的粗细
      'x.css | sans-weight | .prose strong { font-weight: var(--weight-sans) } × 1',
      'x.css | seam | .card-name { --figure-ink: … } × 1',
      // 栏上挂着状态的类名的规则也是人物的那一块：里面写了框架的记号（栏自己量的 --stage-… 不算）；--shade-…、--fade-… 也是框架的
      'x.css | seam | .stage-pane.is-wide { --color-accent: … } × 1',
      'x.css | seam | .stage-pane.is-wide { --shade-more: … } × 1',
      'x.css | seam | .stage-pane:not(.is-wide) .strip { border-radius: var(--radius) } × 1',
      'x.css | seam | .stage-pane:not(.is-wide) .strip { color: var(--color-ink) } × 1',
      "x.css | seam | .strip { font-family: var(--font-kai, 'Kaiti SC', serif) } × 1",
      // 题签和别的东西写在了同一条规则里
      'x.css | seam | .strip, .tag × 1',
      'x.css | seam | .tag { background: var(--color-paper-sunk) } × 1',
      'x.css | seam | .tag { color: var(--figure-ink) } × 1',
      // 人物的那一块里写了框架的记号
      "x.css | seam | [data-figure='x'] .stage-pane { --color-accent: … } × 1",
      "x.css | seam | [data-figure='y'] .stage-pane { --fade-plate: … } × 1",
      'x.css | text-decoration | text-decoration: underline dotted var(--color-accent) × 1',
      'x.css | text-wrap | text-wrap: balance × 1',
    ]);
  });

  it('人物的字体记号：打头的是网站自己带的题签用的字——随站的楷体里这位人物自己的那一个（名称后面带着他的 id），或者读正文的宋体（平着的纸条用它）；别的字体打头的、光写楷体不带人物的，都查得出来；tokens.css 里不写人物的那一块还是楷体打头，写的是苏轼的', () => {
    // 另外几位人物的块（编的）：宋体打头、带着人物的楷体打头，查不出毛病；设备上的宋体、随站的黑体打头的、光写楷体不带人物的，各是一处
    const blocks = `
      [data-figure='made-up'] .stage-pane { --figure-font: 'Yanlu Song', 'Songti SC', serif; --figure-line: rgb(0 0 0 / 0.5); }
      [data-figure='other'] .stage-pane { --figure-font: 'Songti SC', serif; }
      [data-figure='third'] .stage-pane { --figure-font: 'Yanlu Sans', sans-serif; }
      [data-figure='fourth'] .stage-pane { --figure-font: 'Yanlu Kai fourth', 'Kaiti SC', serif; }
      [data-figure='fifth'] .stage-pane { --figure-font: 'Yanlu Kai', 'Kaiti SC', serif; }
    `;
    expect(tally(scanStyle('x.css', blocks)).filter((line) => line.includes('| font-family |'))).toEqual([
      "x.css | font-family | --figure-font: 'Songti SC', serif × 1",
      "x.css | font-family | --figure-font: 'Yanlu Kai', 'Kaiti SC', serif × 1",
      "x.css | font-family | --figure-font: 'Yanlu Sans', sans-serif × 1",
    ]);
    // 苏轼用的那一块（tokens.css 里不写人物的 .stage-pane）：题签是竖着的纸条，字还是随站的楷体打头——按人物分了文件以后，是他自己的那一个
    const written = /\n\.stage-pane \{[^}]*--figure-font:\s*([^;]+);/.exec(text('src/styles/tokens.css'))?.[1] ?? '';
    expect(written.startsWith("'Yanlu Kai su-shi'"), written).toBe(true);
    // 样式表里真有这个名称的 @font-face（做字体的工具写的）
    expect(text(`${FONTS_DIR}/fonts.css`)).toContain("font-family: 'Yanlu Kai su-shi';");
  });

  it('“这一页自己那个范围的字体”的两个记号（--own-song、--own-sans）：只许由工具做的 fonts.css 写——它每个范围写一条，认的是 <html> 上的 data-fonts、data-fonts-unit，手写的样式表里一处也没有；只许在字体的记号里读——--font-song 和人物的 --figure-font 里读宋体的，--font-sans 里读黑体的，备用的写的就是随站的那一套；tokens.css 里四处都紧跟在随站的名称后面。别处读了、别处写了、读错了地方、备用的换了，都查得出来', () => {
    const tokens = stripCssComments(text('src/styles/tokens.css'));
    const value = (pattern: RegExp): string => pattern.exec(tokens)?.[1] ?? '';
    // 四处：框架的两个记号，苏轼用的那一块（不写人物的），歌德的一块。每一处都是随站的名称打头，后面紧跟着读它，再后面才是设备自带的
    expect(value(/:root \{[^}]*--font-song:\s*([^;]+);/)).toMatch(/^'Yanlu Song', var\(--own-song, 'Yanlu Song'\), 'Songti SC', /);
    expect(value(/:root \{[^}]*--font-sans:\s*([^;]+);/)).toMatch(/^'Yanlu Sans', var\(--own-sans, 'Yanlu Sans'\), 'Noto Sans SC', /);
    expect(value(/\n\.stage-pane \{[^}]*--figure-font:\s*([^;]+);/)).toMatch(/^'Yanlu Kai su-shi', .*'Yanlu Song', var\(--own-song, 'Yanlu Song'\), 'Songti SC', /);
    expect(value(/\[data-figure='goethe'\] \.stage-pane \{[^}]*--figure-font:\s*([^;]+);/)).toMatch(/^'Yanlu Song', var\(--own-song, 'Yanlu Song'\), 'Songti SC', /);
    expect(styles.reduce((sum, path) => sum + countIn(stripCssComments(text(path)), 'var(--own-'), 0)).toBe(4);
    expect(countIn(tokens, 'var(--own-')).toBe(4);
    // 写这两个记号的只有工具做的 fonts.css：手写的样式表里一处也没有；fonts.css 里每一处都在认 <html> 上那两个属性的规则里，
    // 写的名称前面都有 @font-face（没有自己的文件的页面哪一条也合不上，读到的是备用的那一个：框架的那一套）
    for (const path of styles) expect(stripCssComments(text(path)), path).not.toMatch(/--own-[a-z-]+\s*:/);
    const made = stripCssComments(text(`${FONTS_DIR}/fonts.css`));
    const writes = made.split('\n').filter((line) => /--own-[a-z-]+\s*:/.test(line));
    expect(writes.length).toBeGreaterThan(0);
    for (const line of writes) {
      expect(line, line).toMatch(/^:root\[data-fonts='[a-z0-9-]+'\](\[data-fonts-unit='[a-z0-9-]+'\]|:not\(\[data-fonts-unit\]\))? \{ (--own-(sans|song): '[^']+'; )+\}$/);
      for (const [, name] of line.matchAll(/: '([^']+)';/g)) expect(made).toContain(`font-family: '${name}';`);
    }
    expect(tally(scanStyle(`${FONTS_DIR}/fonts.css`, text(`${FONTS_DIR}/fonts.css`))).filter((line) => line.includes('| own-font |'))).toEqual([]);
    // 查得出来
    const bad = `
      :root { --font-song: 'Yanlu Song', var(--own-song, 'Songti SC'), serif; --font-sans: 'Yanlu Sans', var(--own-song, 'Yanlu Song'), sans-serif; }
      .stage-pane { --figure-font: 'Yanlu Kai', var(--own-sans, 'Yanlu Sans'), serif; }
      .reading { --font-song: 'Yanlu Song', var(--own-song, 'Yanlu Song'), serif; }
      .prose { font-family: var(--own-song, 'Yanlu Song'); --own-song: 'Yanlu Song x'; }
      .note { color: var(--own-ink); }
      :root[data-fonts='x'] { --own-sans: 'Yanlu Sans x'; }
    `;
    expect(tally(scanStyle('src/styles/x.css', bad)).filter((line) => line.includes('| own-font |'))).toEqual([
      // 备用的不是随站的宋体
      "src/styles/x.css | own-font | --font-song: var(--own-song, 'Songti SC') × 1",
      // 写法对，可是写在了 :root 以外的 --font-song 里
      "src/styles/x.css | own-font | --font-song: var(--own-song, 'Yanlu Song') × 1",
      // 黑体的名单里读了宋体的
      "src/styles/x.css | own-font | --font-sans: var(--own-song, 'Yanlu Song') × 1",
      // 人物的字体记号里读了黑体的
      "src/styles/x.css | own-font | --figure-font: var(--own-sans, 'Yanlu Sans') × 1",
      // 没有这样一个记号
      'src/styles/x.css | own-font | color: var(--own-ink) × 1',
      // 字体的记号以外读了
      "src/styles/x.css | own-font | font-family: var(--own-song, 'Yanlu Song') × 1",
      // 写在了工具做的那一份样式表以外
      'src/styles/x.css | own-font | .prose { --own-song: … } × 1',
      "src/styles/x.css | own-font | :root[data-fonts='x'] { --own-sans: … } × 1",
    ].sort());
    // 对的写法没有话说；工具做的那一份样式表里写这两个记号是许可的
    const good = ":root { --font-song: 'Yanlu Song', var(--own-song, 'Yanlu Song'), serif; --font-sans: 'Yanlu Sans', var(--own-sans, 'Yanlu Sans'), sans-serif; } [data-figure='x'] .stage-pane { --figure-font: 'Yanlu Song', var(--own-song, 'Yanlu Song'), serif; }";
    expect(tally(scanStyle('src/styles/x.css', good))).toEqual([]);
    expect(tally(scanStyle('src/fonts/fonts.css', ":root[data-fonts='x'] { --own-sans: 'Yanlu Sans x'; --own-song: 'Yanlu Song x'; }"))).toEqual([]);
  });

  it('正文那一栏等字体的那一会儿（<html> 上的 data-fonts-wait）：样式表里认这个属性的只有一条规则，在 layout.css 里，不在哪一句 @media 里面——选的是正文那一栏里面的东西（main > *），只写了一句 opacity: 0：看不见，地方照占，读屏的工具照样读得到；查得出来：换成 display、visibility，选到整页，多写一句，另一份样式表里又认了一回', () => {
    /** 一批样式表里，选择器里认 data-fonts-wait 的每一句声明，和这个属性一共写了几回（注释不算）。 */
    const waiting = (sheets: [string, string][]): { rules: string[]; written: number } => ({
      rules: sheets.flatMap(([path, css]) => readCss(css).declarations.filter((item) => item.selector.includes('data-fonts-wait')).map((item) => `${path} | ${item.selector} { ${item.property}: ${item.value} }`)),
      written: sheets.reduce((sum, [, css]) => sum + countIn(stripCssComments(css), 'data-fonts-wait'), 0),
    });
    const ONLY = { rules: ['src/styles/layout.css | :root[data-fonts-wait] main > * { opacity: 0 }'], written: 1 };
    // 网站自己的每一份样式表：手写的，和工具做的（fonts.css、点开才要的字的那几份）
    const made = readdirSync(at(`${FONTS_DIR}/scopes/`))
      .filter((name) => name.endsWith('.css'))
      .sort()
      .map((name) => `${FONTS_DIR}/scopes/${name}`);
    const all = [...styles, `${FONTS_DIR}/fonts.css`, ...made].map((path): [string, string] => [path, text(path)]);
    expect(all.length).toBeGreaterThan(10);
    expect(waiting(all)).toEqual(ONLY);
    // 这一条规则是顶层的一条（不在 @media、@supports 里面：哪种窗口、哪种设备上都一样）
    expect(stripCssComments(text('src/styles/layout.css'))).toMatch(/(^|\n):root\[data-fonts-wait\] main > \* \{\n {2}opacity: 0;\n\}\n/);
    // 查得出来
    const layout = (rule: string): [string, string][] => [['src/styles/layout.css', `.reading { flex: 1 0 auto; }\n${rule}\n`]];
    expect(waiting(layout(':root[data-fonts-wait] main > * { opacity: 0; }'))).toEqual(ONLY);
    for (const bad of [
      // 整页都藏起来，读屏的工具也读不到
      ':root[data-fonts-wait] { visibility: hidden; }',
      ':root[data-fonts-wait] main > * { visibility: hidden; }',
      ':root[data-fonts-wait] main > * { display: none; }',
      // 选到了整页、沙盘栏
      ':root[data-fonts-wait] body { opacity: 0; }',
      ':root[data-fonts-wait] main > *, :root[data-fonts-wait] .stage-pane { opacity: 0; }',
      // 多写了一句
      ':root[data-fonts-wait] main > * { opacity: 0; pointer-events: none; }',
      // 一条也没有了
      '.reading-inner { opacity: 1; }',
    ])
      expect(waiting(layout(bad)), bad).not.toEqual(ONLY);
    // 另一份样式表里又认了一回
    expect(waiting([...layout(':root[data-fonts-wait] main > * { opacity: 0; }'), ['src/styles/reading.css', ':root[data-fonts-wait] .prose { display: none; }']])).not.toEqual(ONLY);
    // 写在 @media 里面的认得出来（上面那一句顶层的写法对不上）
    expect(`@media (min-width: 960px) {\n  :root[data-fonts-wait] main > * {\n    opacity: 0;\n  }\n}\n`).not.toMatch(/(^|\n):root\[data-fonts-wait\] main > \* \{\n {2}opacity: 0;\n\}\n/);
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

  it('@container、cqw 一处也没有；:has( 最多七处，只在 layout.css 里（iPadOS 15 的 Safari 都不认：前两样原来分着沙盘栏宽窄两种排法，现在由页面量了栏宽挂类名来分）', () => {
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
    // 七处：原来的六处，加上摆着时间轴的沙盘栏（比别的栏高一条时间轴）上面留的空那一条。这个数是防着它散开的篱笆，别的样式表里一处也不许有
    expect(total(has)).toBeLessThanOrEqual(7);
  });
});

// 字体文件按范围分（一页显示什么，就给它哪几个文件）：做字体的工具照这一套规矩做文件（tests/support/fontTool.ts 第五段）。
// 这一份测试查的是规矩本身，随 npm test 跑：不用原字体，不连网，什么也不写。分五组：
//   一、编出来的网站上的规矩：哪些字归哪个范围的文件，哪一种页面拿哪几个文件。
//   二、隔开：动一位人物，别的范围的文件一个字不变，框架只跟着他的卡片变。
//   三、仓库里真的这个网站：每一种页面显示的每一个字，都在给这一页的文件里。
//   四、照清单写的几样：fonts.css、点开才要的字的样式表、scopes.ts、index.html 里的那一段、格式 4 的记录。
//   五、上限，和开关（开着，关不回去）。

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ItineraryBar } from '../../src/domain/itinerary';
import type { RouteScene } from '../../src/domain/scene';
import { stopMarks } from '../../src/domain/stopMarks';
import type { Figure, LngLat, StopContent, StopMeta } from '../../src/domain/types';
import {
  FONT_FILE_MAX_BYTES,
  FONT_FILE_WARN_BYTES,
  FONT_FRAME_MAX_BYTES,
  FONT_FRAME_WARN_BYTES,
  FONT_PAGE_FIRST_MAX_BYTES,
  FONT_PAGE_FIRST_WARN_BYTES,
  FONT_SHEET_GZIP_MAX,
  FONT_SHEET_GZIP_WARN,
  fontScopeReport,
} from '../content/budgetRules';
import type { FontScopeSizes } from '../content/budgetRules';
import { fixtureScene } from '../support/fixtureScene';
import {
  FONTS_BY_SCOPE,
  PRELOAD_BLOCK,
  PRESSED_SOURCES,
  PRESSED_SOURCE_SCOPES,
  RECORD_VERSION,
  SCOPE_RECORD_VERSION,
  charactersByName,
  isInterfaceSource,
  missingOnPages,
  pageTexts,
  planFonts,
  planScopes,
  preloadBlock,
  pressedSheetCss,
  postscriptName,
  readScoped,
  readSite,
  reservedNameProblems,
  SOURCES_SCOPE,
  SOURCES_SLUG,
  scopeFileName,
  scopeFileNames,
  scopeFilePath,
  scopeFontsCss,
  scopeIdProblems,
  scopeNameClashes,
  scopePagePaths,
  scopeRecord,
  scopeRecordIsFresh,
  scopeReservedNames,
  scopeSlug,
  scopesTs,
  shippable,
  sortedString,
  sourceFiles,
  stripComments,
  withPreloadBlock,
  writtenForScopes,
} from '../support/fontTool';
import type { ScopeFile, ScopeFileRecord, ScopePlan, SiteText, SiteTexts } from '../support/fontTool';
import { countIn, stripCssComments } from '../support/sourceScan';

const ROOT = new URL('../../', import.meta.url);
const utf8 = new TextDecoder();
const text = (path: string): string => utf8.decode(readFileSync(new URL(path, ROOT)));

// ---------------------------------------------------------------- 编出来的网站

/** 校验规则那座合格的全程沙盘小样本。 */
const routeSample = (): RouteScene => JSON.parse(text('tests/content/fixtures/good/figures/demo/scenes/route.json')) as RouteScene;

/**
 * 编出来的两位人物，每样东西各用几个别处没有的字，好看它们落进了哪个文件：
 *   ann（甲人）  有全程沙盘（题签是竖着的纸条）和时间轴；三站：a1 有正文、有自己的沙盘，a2 有正文、没有自己的沙盘，a3 两样都没有；
 *   bob（乙人）  没有全程沙盘；两站：b1 有正文，b2 两样都没有；
 *   cat          只有一张还点不进去的卡片。
 * “鹤”两位人物的简介里都有；“鳌”甲人的简介和 a1 的正文里都有；“鹏”是甲人卡片上的字，乙人 b1 的正文里也有。
 */
function madeUpSite(change: (site: SiteText) => void = () => {}): SiteText {
  const place = { id: 'pl', ancient: '古地', modern: '今地', lngLat: [117, 34] as LngLat };
  const meta = (id: string, title: string, shortTitle: string, status: 'complete' | 'outline'): StopMeta => ({ id, title, shortTitle, years: '1–2', age: '虚岁三十', place, camera: { distanceKm: 1, pitch: 0, bearing: 0 }, summary: `${shortTitle}概要`, status, localPlaces: [] });
  const figure = (id: string, name: string, intro: string, stops: StopMeta[]): Figure => ({ id, name, era: '某代', years: '1–9', tagline: '一句话', intro: [intro], overview: { center: [117, 34], distanceKm: 100 }, stops, legs: [] });
  const content = (stopId: string, body: string, pressed: string, heading: string, over: Partial<StopContent> = {}): StopContent => ({
    stopId,
    notes: [{ id: 'n1', kind: 'history', anchor: body[0], title: '注', body: pressed, sourceIds: [] }],
    originals: [],
    images: [],
    sources: [],
    provenance: [],
    sampleQuestions: [],
    sections: [{ heading, blocks: [{ type: 'paragraph', segments: [{ text: body }] }] }],
    imageUrls: {},
    ...over,
  });
  const bar: ItineraryBar = {
    day0: '1000-01-01',
    name: '轼',
    years: [[1000, '熙宁', null, 1]],
    first: { label: '诞', says: '曩' },
    last: { label: '殁', says: '迄' },
    stretches: [{ id: 't1', look: 'quiet', label: '徙', says: '匀', unsure: '疑', until: 100, spot: ['w', [110, 30], '郓'] }],
  };
  const site: SiteText = {
    sources: {
      'src/ui/a.tsx': "export const A = '楹棂';\n",
      'src/ui/sourcesText.ts': "export const S = '甗';\n",
      'src/timebar/barNoteText.ts': "export const L = '甑';\n",
      'index.html': '<p>显</p>',
    },
    sansLabels: ['黑签'],
    cards: [
      { id: 'ann', name: '甲人', era: '某代', years: '1–9', sortYear: 1, tagline: '鹏鹍', available: true },
      { id: 'bob', name: '乙人', era: '某代', years: '1–9', sortYear: 2, tagline: '鸿鹔', available: true },
      { id: 'cat', name: '丙人', era: '某代', years: '1–9', sortYear: 3, tagline: '鹄鹓', available: false },
    ],
    figures: [
      {
        figure: figure('ann', '甲人', '鲸鹤鳌', [meta('a1', '子站：头一站', '子站', 'complete'), meta('a2', '丑站：第二站', '丑站', 'complete'), meta('a3', '寅站：鹅', '寅站', 'outline')]),
        stops: [
          {
            id: 'a1',
            content: content('a1', '鳄鳌', '鳅', '鲤', {
              images: [{ id: 'i1', file: 'x.jpg', alt: '替', caption: '鹭图', section: '鲤', credit: '鸬藏', license: '公有', sourceUrl: 'https://example.org/' }],
            }),
            scene: fixtureScene(),
          },
          { id: 'a2', content: content('a2', '鲨', '鲟', '鲫'), scene: null },
        ],
        route: routeSample(),
        bar,
        itinerarySources: [{ id: 'h1', cite: '鳜书', read: '读了鳝' } as never],
      },
      {
        figure: figure('bob', '乙人', '鸥鹤', [meta('b1', '卯站：头一站', '卯站', 'complete'), meta('b2', '辰站：后一站', '辰站', 'outline')]),
        stops: [{ id: 'b1', content: content('b1', '鸦鹏', '鸭', '鸽'), scene: null }],
        route: null,
        bar: null,
      },
    ],
  };
  change(site);
  return site;
}

const STRIPS = { labelKindOf: () => 'strip' as const };
const plan = (site: SiteText = madeUpSite(), joiners = ''): ScopePlan => planScopes(site, { joiners, ...STRIPS });
const texts = (site: SiteText = madeUpSite()): SiteTexts => pageTexts(site, STRIPS);
const file = (from: ScopePlan, name: string): ScopeFile => {
  const found = from.files.find((item) => item.name === name);
  if (!found) throw new Error(`要做的文件里没有 ${name}（有的是 ${from.files.map((item) => item.name).join('、')}）`);
  return found;
};
const has = (from: ScopePlan, name: string, chars: string): boolean => [...chars].every((ch) => file(from, name).characters.includes(ch));
const hasNone = (from: ScopePlan, name: string, chars: string): boolean => [...chars].every((ch) => !file(from, name).characters.includes(ch));
const names = (from: ScopePlan): string[] => from.files.map((item) => item.name);
const page = (from: ScopePlan, kind: string, figure: string | null, stop: string | null) => {
  const found = from.pages.find((item) => item.kind === kind && item.figure === figure && item.stop === stop);
  if (!found) throw new Error(`没有 ${kind} ${figure} ${stop} 这一页`);
  return found;
};
/** 一份清单里每个文件的字，写成“文件名：字”的一串（比两份清单用）。 */
const lines = (from: ScopePlan, keep: (item: ScopeFile) => boolean = () => true): string[] => from.files.filter(keep).map((item) => `${item.name}：${item.characters}`);

// ---------------------------------------------------------------- 一、规矩

describe('字体文件按范围分：哪些字归哪个文件（编出来的两位人物）', () => {
  it('要做的文件和先后：框架的两个；人物照 id 的先后，一位人物先是他自己的（黑体、楷体、宋体两个），再照站的先后是有正文或者有沙盘的各站，每一站不用点开的在前；“来源”页最后。名称各是各的', () => {
    const made = plan();
    expect(names(made)).toEqual([
      'yanlu-sans',
      'yanlu-song',
      'yanlu-sans-ann',
      'yanlu-kai-ann',
      'yanlu-song-ann',
      'yanlu-song-ann-more',
      'yanlu-song-ann-a1',
      'yanlu-song-ann-a1-more',
      'yanlu-song-ann-a2',
      'yanlu-song-ann-a2-more',
      'yanlu-sans-bob',
      'yanlu-song-bob',
      'yanlu-song-bob-b1',
      'yanlu-song-bob-b1-more',
      'yanlu-song-credits',
    ]);
    // 给进来的人物换个先后，列出来的一个字不差
    const turned = plan(madeUpSite((site) => site.figures.reverse()));
    expect(lines(turned)).toEqual(lines(made));
    expect(turned.pages).toEqual(made.pages);
    // 各站是照站的先后，不看哪一站的文件大：上面 a1 的文件比 a2 的小（a2 带着整座全程沙盘的字）；把 a1 的正文写长，它的文件比 a2 的大了，先后还是原来的
    const count = (from: ScopePlan, name: string): number => [...file(from, name).characters].length;
    expect(count(made, 'yanlu-song-ann-a1')).toBeLessThan(count(made, 'yanlu-song-ann-a2'));
    const long = plan(
      madeUpSite((site) => {
        const a1 = site.figures[0].stops[0];
        a1.content = { ...a1.content!, sections: [{ heading: '鲤', blocks: [{ type: 'paragraph', segments: [{ text: String.fromCodePoint(...Array.from({ length: 600 }, (_, index) => 0x5000 + index)) }] }] }] };
      }),
    );
    expect(count(long, 'yanlu-song-ann-a1')).toBeGreaterThan(count(long, 'yanlu-song-ann-a2'));
    expect(names(long)).toEqual(names(made));
    // 写进文件里的名称哪个范围都一样（一套字体一个）；样式表里的名称、PostScript 名称各是各的
    expect(made.files.map((item) => [item.name, item.family, item.face, item.postscript, item.scope, item.unit, item.role, item.range, item.preload, item.sheet])).toEqual([
      ['yanlu-sans', 'Yanlu Sans', 'Yanlu Sans', 'YanluSans-Medium', 'frame', null, 'rest', false, 'always', 'fonts.css'],
      ['yanlu-song', 'Yanlu Song', 'Yanlu Song', 'YanluSong-Regular', 'frame', null, 'rest', false, 'always', 'fonts.css'],
      ['yanlu-sans-ann', 'Yanlu Sans', 'Yanlu Sans ann', 'YanluSansAnn-Medium', 'ann', null, 'rest', false, 'scope', 'fonts.css'],
      ['yanlu-kai-ann', 'Yanlu Kai', 'Yanlu Kai ann', 'YanluKaiAnn-Regular', 'ann', null, 'rest', false, 'none', 'fonts.css'],
      ['yanlu-song-ann', 'Yanlu Song', 'Yanlu Song ann', 'YanluSongAnn-Regular', 'ann', null, 'rest', false, 'scope', 'fonts.css'],
      ['yanlu-song-ann-more', 'Yanlu Song', 'Yanlu Song ann', 'YanluSongAnnMore-Regular', 'ann', null, 'pressed', true, 'none', 'scopes/ann.css'],
      ['yanlu-song-ann-a1', 'Yanlu Song', 'Yanlu Song ann a1', 'YanluSongAnnA1-Regular', 'ann', 'a1', 'rest', false, 'scope', 'fonts.css'],
      ['yanlu-song-ann-a1-more', 'Yanlu Song', 'Yanlu Song ann a1', 'YanluSongAnnA1More-Regular', 'ann', 'a1', 'pressed', true, 'none', 'scopes/ann.a1.css'],
      ['yanlu-song-ann-a2', 'Yanlu Song', 'Yanlu Song ann a2', 'YanluSongAnnA2-Regular', 'ann', 'a2', 'rest', false, 'scope', 'fonts.css'],
      ['yanlu-song-ann-a2-more', 'Yanlu Song', 'Yanlu Song ann a2', 'YanluSongAnnA2More-Regular', 'ann', 'a2', 'pressed', true, 'none', 'scopes/ann.a2.css'],
      ['yanlu-sans-bob', 'Yanlu Sans', 'Yanlu Sans bob', 'YanluSansBob-Medium', 'bob', null, 'rest', false, 'scope', 'fonts.css'],
      ['yanlu-song-bob', 'Yanlu Song', 'Yanlu Song bob', 'YanluSongBob-Regular', 'bob', null, 'rest', false, 'scope', 'fonts.css'],
      ['yanlu-song-bob-b1', 'Yanlu Song', 'Yanlu Song bob b1', 'YanluSongBobB1-Regular', 'bob', 'b1', 'rest', false, 'scope', 'fonts.css'],
      ['yanlu-song-bob-b1-more', 'Yanlu Song', 'Yanlu Song bob b1', 'YanluSongBobB1More-Regular', 'bob', 'b1', 'pressed', true, 'none', 'scopes/bob.b1.css'],
      // “来源”页的范围还叫 sources（页面写在 <html> 上的那个词），工具写出来的名字里它叫 credits：只有这一处例外，见 fontNames.ts 的 SOURCES_SLUG
      ['yanlu-song-credits', 'Yanlu Song', 'Yanlu Song credits', 'YanluSongCredits-Regular', 'sources', null, 'rest', false, 'scope', 'fonts.css'],
    ]);
    // 每个文件里的字按编码的先后连成一串，没有重的
    for (const item of made.files) expect(item.characters, item.name).toBe(sortedString(item.characters));
    expect(made.files.map(scopeFilePath)).toEqual(made.files.map((item) => (item.scope === 'frame' ? `${item.name}.woff2` : `scopes/${item.name}.woff2`)));
  });

  it('框架的两个文件：程序里的字、英文字母数字和半角符号、界面上用黑体排的字、每一张卡片（点不进去的也算）；“来源”页自己的话、“图例”里的话不在里面', () => {
    const made = plan();
    expect(has(made, 'yanlu-song', '楹棂显黑签甲人乙人丙人某代鹏鹍鸿鹔鹄鹓Az09 ')).toBe(true);
    expect(has(made, 'yanlu-sans', '黑签甲人乙人丙人某代19– …')).toBe(true);
    // 卡片上的那一句话是宋体：不进黑体的文件
    expect(hasNone(made, 'yanlu-sans', '鹏鹍鸿鹔鹄鹓楹棂')).toBe(true);
    expect(hasNone(made, 'yanlu-song', '甗甑鲸鳄鸥')).toBe(true);
  });

  it('卡片上的字不进哪个范围自己的文件：乙人的正文里用了甲人卡片上的“鹏”，他的文件里没有它（它在框架里，哪一页都带着）', () => {
    const made = plan();
    // 卡片上的每一个字都是宋体画得到的（名字、朝代、年份、那一句话）：哪个范围的宋体文件里都没有；名字、朝代、年份是黑体的：哪个范围的黑体文件里都没有
    const song = sortedString(shippable(madeUpSite().cards.flatMap((card) => [card.name, card.era, card.years, card.tagline]).join('')));
    const sans = sortedString(shippable(madeUpSite().cards.flatMap((card) => [card.name, card.era, card.years]).join('')));
    for (const item of made.files.filter((entry) => entry.scope !== 'frame' && entry.source !== 'kai')) {
      expect([...(item.source === 'song' ? song : sans)].filter((ch) => item.characters.includes(ch)), item.name).toEqual([]);
    }
    expect(has(made, 'yanlu-song-bob-b1', '鸦')).toBe(true);
    expect(hasNone(made, 'yanlu-song-bob-b1', '鹏')).toBe(true);
    // 框架里已经有的字，哪个范围的文件里都不再放（不只是卡片上的）
    const frame = new Set(file(made, 'yanlu-song').characters);
    for (const item of made.files.filter((entry) => entry.scope !== 'frame' && entry.source === 'song')) expect([...item.characters].filter((ch) => frame.has(ch)), item.name).toEqual([]);
    const frameSans = new Set(file(made, 'yanlu-sans').characters);
    for (const item of made.files.filter((entry) => entry.scope !== 'frame' && entry.source === 'sans')) expect([...item.characters].filter((ch) => frameSans.has(ch)), item.name).toEqual([]);
  });

  it('人物自己的两个宋体文件：人物页不用点开就看得见的（抬头、各站目录的每一行连摘要、印、全程沙盘旁边的字和题签、时间轴的句子）；点开才看得见的（全程沙盘的“说明”和“沙盘上的东西”、时间轴上说不准的、行迹的出处、“图例”里的话）——前一个文件里有的后一个不再放', () => {
    const made = plan();
    const route = routeSample();
    // 抬头，目录（连没有文件的寅站的摘要），时间轴第二行的句子，小像旁边立出的名字，时间轴第一行（黑体的字宋体里也记一份）
    expect(has(made, 'yanlu-song-ann', '鲸鹤鳌子站丑站寅站鹅概要曩迄匀郓轼熙宁诞殁徙')).toBe(true);
    // 全程沙盘上的题签（框架里已经有的字不再放）
    const frame = new Set(file(made, 'yanlu-song').characters);
    const labels = sortedString(shippable(route.strips.map((one) => one.text).join('')).filter((ch) => ch !== ' ' && !frame.has(ch)));
    expect(labels.length).toBeGreaterThan(10);
    expect(has(made, 'yanlu-song-ann', labels)).toBe(true);
    // 点开才看得见的：说不准的、行迹的出处、“图例”里的话；全程沙盘的出处里的字
    expect(has(made, 'yanlu-song-ann-more', '疑鳜鳝甑')).toBe(true);
    expect(hasNone(made, 'yanlu-song-ann', '疑鳜鳝甑')).toBe(true);
    const rest = new Set(file(made, 'yanlu-song-ann').characters);
    expect([...file(made, 'yanlu-song-ann-more').characters].filter((ch) => rest.has(ch))).toEqual([]);
    // 各站的正文不在人物自己的文件里
    expect(hasNone(made, 'yanlu-song-ann', '鳄鲨鳅鲟')).toBe(true);
    expect(hasNone(made, 'yanlu-song-ann-more', '鳄鲨鳅鲟')).toBe(true);
    // 没有时间轴的人物：“图例”里的话不归他
    expect(names(made)).not.toContain('yanlu-song-bob-more');
  });

  it('一站的文件是整份的：那一站的页面除了框架以外显示的字都在，人物页上也有的字（“鳌”、它自己的标题）照样带着——范围之间不比较', () => {
    const made = plan();
    // a1：正文、标题和短标题、年纪和地点、图片的题记作者许可；它自己的沙盘旁边的字
    expect(has(made, 'yanlu-song-ann-a1', '鳄鳌鲤子站头一虚岁三十古地鹭图鸬藏')).toBe(true);
    // 小注点开才有；图片的 alt 也是
    expect(has(made, 'yanlu-song-ann-a1-more', '鳅替')).toBe(true);
    expect(hasNone(made, 'yanlu-song-ann-a1', '鳅替')).toBe(true);
    // “鳌”人物页上也有：两个文件里各有一份
    expect(has(made, 'yanlu-song-ann', '鳌')).toBe(true);
    // 摘要只印在目录里，站点页不印：“概要”不为这一站放（别处也没有用到它的话）
    expect(hasNone(made, 'yanlu-song-ann-a1', '概')).toBe(true);
    // 别的站的字不在
    expect(hasNone(made, 'yanlu-song-ann-a1', '鲨鲟丑寅鹅')).toBe(true);
    // 整份：正好是这一页不用点开就显示的字减去框架
    const frame = new Set(file(made, 'yanlu-song').characters);
    const shown = texts().pages.find((item) => item.kind === 'unit' && item.stop === 'a1');
    expect(file(made, 'yanlu-song-ann-a1').characters).toBe(sortedString([...(shown?.rest.keys() ?? [])].filter((ch) => !frame.has(ch))));
  });

  it('每一站的页面上“位置”那一行印着人物的名字：名字里有卡片上没有的字的时候（卡片上写的是另一个叫法），他每一站的文件里都带着它，没有自己的文件的站用的人物的文件里也有；黑体的在他的黑体文件里', () => {
    // 平常名字就是卡片上的那几个字，都在框架里，哪个范围的文件里都没有
    const usual = plan();
    for (const item of usual.files.filter((entry) => entry.scope === 'ann')) expect(hasNone(usual, item.name, '甲人'), item.name).toBe(true);
    // 人物自己的文件里名字叫“甲翁”，卡片上还是“甲人”
    const site = madeUpSite((made) => (made.figures[0].figure.name = '甲翁'));
    const made = plan(site);
    expect(hasNone(made, 'yanlu-song', '翁')).toBe(true);
    for (const name of ['yanlu-song-ann', 'yanlu-song-ann-a1', 'yanlu-song-ann-a2', 'yanlu-sans-ann']) expect(has(made, name, '翁'), name).toBe(true);
    // 每一种他的页面上都算着这个字（首页不算：首页印的是卡片上的名字）
    const shown = texts(site).pages.filter((item) => item.rest.has('翁')).map((item) => `${item.kind} ${item.stop ?? ''}`.trim());
    expect(shown).toEqual(['figure', 'unit a1', 'unit a2', 'stop a3']);
    expect(missingOnPages(texts(site), made)).toEqual([]);
    // 别的人物的文件不跟着变
    expect(lines(made, (item) => item.scope === 'bob' || item.scope === 'sources' || item.scope === 'frame')).toEqual(lines(usual, (item) => item.scope === 'bob' || item.scope === 'sources' || item.scope === 'frame'));
  });

  it('两位人物都用到的字，两位的文件里各有一份（“鹤”）', () => {
    const made = plan();
    expect(has(made, 'yanlu-song-ann', '鹤')).toBe(true);
    expect(has(made, 'yanlu-song-bob', '鹤')).toBe(true);
  });

  it('有正文、没有自己的沙盘的一站：沙盘栏里摆的是全程沙盘，全程沙盘旁边的字、题签和印整份算进这一站的文件，“说明”和“沙盘上的东西”算进它点开才要的文件；有自己的沙盘的一站不带全程沙盘的字', () => {
    const made = plan();
    const route = routeSample();
    const frame = new Set(file(made, 'yanlu-song').characters);
    const labels = sortedString(shippable(route.strips.map((one) => one.text).join('')).filter((ch) => ch !== ' ' && !frame.has(ch)));
    expect(labels.length).toBeGreaterThan(10);
    expect(has(made, 'yanlu-song-ann-a2', `鲨鲫丑站${labels}`)).toBe(true);
    expect(has(made, 'yanlu-song-ann-a2-more', '鲟')).toBe(true);
    // 印（写着第几站：一、二、三……，在全程沙盘站名的题签脚上）也摆在这一页的沙盘栏里：除了框架里已经有的，都在这一站的文件里；楷体的在人物的楷体文件里
    const marks = Object.values(stopMarks(madeUpSite().figures[0].figure, () => ''))
      .map((mark) => mark.label)
      .join('');
    expect(marks).toBe('一二三');
    const beyond = [...marks].filter((ch) => !frame.has(ch)).join('');
    expect(beyond).toBe(marks);
    expect(has(made, 'yanlu-song-ann-a2', beyond)).toBe(true);
    expect(has(made, 'yanlu-kai-ann', marks)).toBe(true);
    // 里面有这一页上只有印才用到的字（“一”：这一站自己的那一行、正文、全程沙盘的题签上都没有它）：上面那一句查的真是印，不是碰巧别处也有
    const shown = texts().pages.find((item) => item.kind === 'unit' && item.stop === 'a2');
    const onlyMarks = [...beyond].filter((ch) => [...(shown?.rest.get(ch) ?? ['别处'])].every((where) => where.includes('全程沙盘的印')));
    expect(onlyMarks).toEqual(['一']);
    // 题签是平着的纸条的人物（没有楷体的文件）：印只在宋体的文件里，没有自己的沙盘的一站照样整份带着
    const slips = planScopes(madeUpSite(), { joiners: '', labelKindOf: () => 'slip' });
    expect(names(slips)).not.toContain('yanlu-kai-ann');
    expect(has(slips, 'yanlu-song-ann-a2', beyond)).toBe(true);
    expect(has(slips, 'yanlu-song-ann', beyond)).toBe(true);
    expect(page(slips, 'unit', 'ann', 'a2').rest).toEqual(['yanlu-sans', 'yanlu-song', 'yanlu-sans-ann', 'yanlu-song-ann-a2']);
    // 全程沙盘点开才有的字：人物点开才要的文件里有的，这一站点开才要的文件里也都有（除了已经在这一站头一个文件里的）
    const a2 = new Set([...file(made, 'yanlu-song-ann-a2').characters, ...file(made, 'yanlu-song-ann-a2-more').characters]);
    const routePressed = sortedString(shippable(route.credits.join('')));
    expect(routePressed.length).toBeGreaterThan(5);
    expect([...routePressed].filter((ch) => !frame.has(ch) && !a2.has(ch))).toEqual([]);
    // 时间轴不在站点页上：它的句子、说不准的，不为这一站放
    expect(hasNone(made, 'yanlu-song-ann-a2', '曩迄匀')).toBe(true);
    expect(hasNone(made, 'yanlu-song-ann-a2-more', '疑甑')).toBe(true);
    // a1 有自己的沙盘：只在全程沙盘的题签上有的字不在它的文件里
    const own = new Set(file(made, 'yanlu-song-ann-a1').characters);
    const onlyRoute = [...labels].filter((ch) => !own.has(ch));
    expect(onlyRoute.length).toBeGreaterThan(5);
    // 这一页拿到的文件：题签是楷体的，所以也要人物的楷体
    expect(page(made, 'unit', 'ann', 'a2').rest).toEqual(['yanlu-sans', 'yanlu-song', 'yanlu-sans-ann', 'yanlu-kai-ann', 'yanlu-song-ann-a2']);
  });

  it('两样都没有的一站没有自己的文件：它的页面拿的是人物的那几个；不做空文件（没有题签用楷体的人物没有楷体文件，没有点开才看得见的字的范围没有后一个文件）', () => {
    const made = plan();
    expect(names(made).filter((name) => name.includes('a3') || name.includes('b2'))).toEqual([]);
    expect(page(made, 'stop', 'ann', 'a3')).toEqual({ kind: 'stop', figure: 'ann', stop: 'a3', name: '甲人的寅站', rest: ['yanlu-sans', 'yanlu-song', 'yanlu-sans-ann', 'yanlu-kai-ann', 'yanlu-song-ann'], pressed: ['yanlu-song-ann-more'] });
    expect(page(made, 'figure', 'ann', null).rest).toEqual(page(made, 'stop', 'ann', 'a3').rest);
    expect(page(made, 'stop', 'bob', 'b2')).toEqual({ kind: 'stop', figure: 'bob', stop: 'b2', name: '乙人的辰站', rest: ['yanlu-sans', 'yanlu-song', 'yanlu-sans-bob', 'yanlu-song-bob'], pressed: [] });
    expect(names(made)).not.toContain('yanlu-kai-bob');
    for (const item of made.files) expect(item.characters.length, item.name).toBeGreaterThan(0);
    // 一站点开才看得见的字全在框架里：它没有后一个文件，这一页点开以后什么也不用再取
    const plain = plan(madeUpSite((site) => (site.figures[1].stops[0].content = { ...site.figures[1].stops[0].content!, notes: [{ id: 'n1', kind: 'history', anchor: '鸦', title: '黑签', body: '楹棂', sourceIds: [] }] })));
    expect(names(plain).filter((name) => name.includes('b1'))).toEqual(['yanlu-song-bob-b1']);
    expect(page(plain, 'unit', 'bob', 'b1')).toMatchObject({ rest: ['yanlu-sans', 'yanlu-song', 'yanlu-sans-bob', 'yanlu-song-bob-b1'], pressed: [] });
  });

  it('首页拿的是沙盘栏里摆着的那位人物（头一位可以点进去的）的文件：他的印、全程沙盘、时间轴都在那几个文件里；只有框架的字的页面只拿框架的两个', () => {
    const made = plan();
    expect(made.home).toBe('ann');
    expect(page(made, 'home', 'ann', null).rest).toEqual(['yanlu-sans', 'yanlu-song', 'yanlu-sans-ann', 'yanlu-kai-ann', 'yanlu-song-ann']);
    expect(page(made, 'home', 'ann', null).pressed).toEqual(['yanlu-song-ann-more']);
    expect(page(made, 'frame', null, null)).toEqual({ kind: 'frame', figure: null, stop: null, name: '只有框架的字的页面', rest: ['yanlu-sans', 'yanlu-song'], pressed: [] });
    // 首页上显示的：全程沙盘和时间轴上的字；人物页的简介不在首页上
    const home = texts().pages.find((item) => item.kind === 'home');
    expect(home?.rest.has('曩') && home.rest.has('郓') && !home.rest.has('鲸')).toBe(true);
    // 头一位点不进去：摆的是下一位可以点进去的；一位也点不进去：首页只拿框架的两个
    const second = plan(madeUpSite((site) => (site.cards[0].available = false)));
    expect(second.home).toBe('bob');
    const nobody = plan(madeUpSite((site) => site.cards.forEach((card) => (card.available = false))));
    expect(nobody.home).toBeNull();
    expect(page(nobody, 'home', null, null).rest).toEqual(['yanlu-sans', 'yanlu-song']);
  });

  it('人物的黑体是他每一种页面上用黑体排的字合起来（各站的标题、小节标题、小注的标题、沙盘旁边的小节名……）；楷体是他的题签和印合起来，加一个空格', () => {
    const made = plan();
    expect(has(made, 'yanlu-sans-ann', '子站丑站寅站鹅头一第二鲤鲫注轼熙宁诞殁徙')).toBe(true);
    expect(hasNone(made, 'yanlu-sans-ann', '鲸鳄鲨曩匀')).toBe(true);
    expect(has(made, 'yanlu-sans-bob', '卯站辰站鸽')).toBe(true);
    const kai = file(made, 'yanlu-kai-ann').characters;
    expect(kai.startsWith(' ')).toBe(true);
    expect(has(made, 'yanlu-kai-ann', '郓')).toBe(true);
    // 楷体的每一个字，用到它的那一页不用点开的字里也记着一份（楷体的文件还在路上时题签先用宋体：框架的宋体文件或者那一页自己的宋体文件里有它）
    const strips = texts().pages.filter((item) => item.kai.size > 0);
    expect(strips.map((item) => `${item.kind} ${item.stop ?? ''}`.trim())).toEqual(['home', 'figure', 'unit a1', 'unit a2', 'stop a3']);
    for (const item of strips) expect([...item.kai.keys()].filter((ch) => !item.rest.has(ch)), item.name).toEqual([]);
    expect(missingOnPages(texts(), made)).toEqual([]);
  });

  it('“来源”页的文件：那一页自己的话，和页面收齐两栏的那个函数给出的每一行、每一张图片是哪一站的、题记、作者、许可——只算可以点进去的人物的；小标题上的名字是黑体，都在框架的黑体里，这个范围没有黑体文件', () => {
    const made = plan();
    expect(has(made, 'yanlu-song-credits', '甗鹭鸬')).toBe(true);
    const route = routeSample();
    const credits = sortedString(shippable(route.credits.map((line) => line.split('；')[0]).join('')));
    const frame = new Set(file(made, 'yanlu-song').characters);
    expect([...credits].filter((ch) => !frame.has(ch) && !file(made, 'yanlu-song-credits').characters.includes(ch))).toEqual([]);
    // “图例”里的话、人物的正文不在
    expect(hasNone(made, 'yanlu-song-credits', '甑鲸鳄')).toBe(true);
    expect(names(made)).not.toContain('yanlu-sans-credits');
    expect(names(made).filter((name) => name.includes('sources'))).toEqual([]);
    expect(page(made, 'sources', null, null)).toEqual({ kind: 'sources', figure: null, stop: null, name: '“来源”页', rest: ['yanlu-sans', 'yanlu-song', 'yanlu-song-credits'], pressed: [] });
    // 甲人点不进去了：他的图片不印在那一页上
    const closed = plan(madeUpSite((site) => (site.cards[0].available = false)));
    expect(hasNone(closed, 'yanlu-song-credits', '鹭鸬')).toBe(true);
  });

  it('挨着别的字会变样的字都放进框架的宋体文件，别的文件里不再有；用设备自带的字显示的字哪个文件里都没有', () => {
    const made = plan(madeUpSite(), '鳄鹤');
    expect(made.joiners).toBe(sortedString('鳄鹤'));
    expect(has(made, 'yanlu-song', '鳄鹤')).toBe(true);
    for (const item of made.files.filter((entry) => entry.scope !== 'frame')) expect(hasNone(made, item.name, '鳄鹤'), item.name).toBe(true);
    expect(file(made, 'yanlu-song').where.get('鳄')).toContain('挨着别的字会变样的字');
    // 别的字原样
    expect(lines(made, (item) => item.source !== 'song')).toEqual(lines(plan(), (item) => item.source !== 'song'));
    const fallback = planScopes(madeUpSite(), { joiners: '鳄', fallbackOk: { 鳄: '试一试', 鲸: '试一试' }, ...STRIPS });
    expect(fallback.fallback).toBe(sortedString('鳄鲸'));
    for (const item of fallback.files) expect(hasNone(fallback, item.name, '鳄鲸'), item.name).toBe(true);
  });

  it('同一遍数出来的：各种页面的字合起来，正好是不分的时候那四组（编出来的网站，和仓库里真的这个网站）', { timeout: 30_000 }, async () => {
    const check = (site: SiteText, options: { labelKindOf?: () => 'strip' }): void => {
      const flat = planFonts(site, options);
      const by = pageTexts(site, options);
      const group = (name: string): string => flat.files.find((item) => item.group === name)?.characters ?? '';
      const all = (pick: (item: SiteTexts['pages'][number]) => Iterable<string>): string[] => by.pages.flatMap((item) => [...pick(item)]);
      const rest = sortedString([...by.frame.song.keys(), ...all((item) => (item.kind === 'sources' ? [] : item.rest.keys()))]);
      expect(rest, '不用点开就看得见的').toBe(group('song'));
      expect(sortedString([...by.frame.sans.keys(), ...all((item) => (item.kind === 'sources' ? [] : item.sans.keys()))]), '黑体的').toBe(group('sans'));
      expect(sortedString([' ', ...all((item) => item.kai.keys())]), '楷体的').toBe(group('kai'));
      // 点开才看得见的：各页点开才显示的，加上“来源”页自己的话（不分的时候它们算点开才看得见的），去掉头一组里已经有的
      const words = Object.entries(site.sources).filter(([path]) => PRESSED_SOURCE_SCOPES[path] === 'sources').flatMap(([, code]) => shippable(code.replace(/[\s\S]*?'([^']*)'[\s\S]*/, '$1')));
      const pressed = new Set([...all((item) => item.pressed.keys()), ...words]);
      const more = new Set(group('song-more'));
      expect([...more].filter((ch) => !pressed.has(ch) && !by.pages.some((item) => item.kind === 'sources' && item.rest.has(ch))), '点开才看得见的：不分的时候有、哪一页都没有的').toEqual([]);
      expect([...pressed].filter((ch) => !more.has(ch) && !rest.includes(ch)), '点开才看得见的：页面上有、不分的时候没有的').toEqual([]);
    };
    check(madeUpSite(), STRIPS);
    check(await readSite(), {});
  });

  it('文件名在人物和站之间不许重：一站叫 more、两站的 id 拼出同一个名字，列清单的时候就停下来', () => {
    // b1 和 b1-more 两站都有正文：b1 点开才要的文件和 b1-more 不用点开的文件是同一个名字
    const clash = madeUpSite((site) => {
      const bob = site.figures[1];
      bob.figure.stops[1] = { ...bob.figure.stops[1], id: 'b1-more', status: 'complete' };
      bob.stops.push({ id: 'b1-more', content: { ...bob.stops[0].content!, stopId: 'b1-more' }, scene: null });
    });
    expect(() => plan(clash)).toThrow(/yanlu-song-bob-b1-more\.woff2 会被写两回/);
    // 照 id 就查得出来（内容校验用的就是这两个函数），不用等到哪一站有了正文
    expect(scopeNameClashes(scopeFileNames([{ id: 'bob', stops: ['b1', 'b1-more'] }]))).toEqual(['字体文件 yanlu-song-bob-b1-more.woff2 会被写两回：bob 的 b1 这一站，和bob 的 b1-more 这一站']);
    expect(scopeNameClashes(scopeFileNames([{ id: 'bob', stops: ['more'] }]))).toEqual(['字体文件 yanlu-song-bob-more.woff2 会被写两回：人物 bob，和bob 的 more 这一站']);
    expect(scopeNameClashes(scopeFileNames([{ id: 'su', stops: ['shi'] }, { id: 'su-shi', stops: [] }]))).toEqual([
      '字体文件 yanlu-song-su-shi.woff2 会被写两回：su 的 shi 这一站，和人物 su-shi',
      '字体文件 yanlu-song-su-shi-more.woff2 会被写两回：su 的 shi 这一站，和人物 su-shi',
    ]);
    // 没有哪位人物可以叫 sources（那是“来源”页的范围），也不能叫 credits（那是“来源”页的文件名字里的那个词）
    expect(scopeNameClashes(scopeFileNames([{ id: 'sources', stops: [] }])).length).toBeGreaterThan(0);
    expect(scopeNameClashes(scopeFileNames([{ id: 'credits', stops: [] }]))).toContain('字体文件 yanlu-song-credits.woff2 会被写两回：人物 credits，和“来源”页');
    expect(scopeNameClashes(scopeFileNames([{ id: 'ann', stops: ['a1', 'a2'] }, { id: 'bob', stops: ['b1'] }]))).toEqual([]);
  });

  it('人物和站的 id 原样写进文件名、样式表里的规则和名称、scopes.ts、index.html 里的那一段：只许小写的英文字母、数字和连字符。带了引号、点、空格、大写字母、汉字的，列清单的时候就停下来（还没有正文和沙盘的站也查）；照 id 就查得出来', () => {
    const renamed = (id: string, figure = false): SiteText =>
      madeUpSite((site) => {
        const ann = site.figures[0].figure;
        // 寅站两样都没有，现在不为它写什么：也查（以后有了正文就会写）
        if (figure) ann.id = id;
        else ann.stops[2] = { ...ann.stops[2], id };
      });
    for (const bad of ["a'3", 'a.3', 'a 3', 'A3', '寅', 'a_3', 'a/3', 'a"3', '']) {
      expect(() => plan(renamed(bad)), `站的 id “${bad}”`).toThrow(/按范围分的字体文件写不了：ann 的一站的 id/);
      expect(() => plan(renamed(bad, true)), `人物的 id “${bad}”`).toThrow(/按范围分的字体文件写不了：人物的 id/);
    }
    for (const good of ['a3', 'a-3', '3a', 'su-shi-2']) {
      expect(() => plan(renamed(good)), good).not.toThrow();
    }
    // 照 id 就查得出来：每个不合格的 id 一句
    expect(scopeIdProblems([{ id: 'ann', stops: ['a1', 'a-2'] }, { id: 'su-shi', stops: ['xuzhou'] }])).toEqual([]);
    expect(scopeIdProblems([{ id: "o'neil", stops: ['a1', 'a.2'] }])).toEqual([
      "人物的 id “o'neil”里有小写英文字母、数字、连字符以外的字（或者是空的）：字体文件的名字、样式表里的规则都照 id 原样写，写不了",
      "o'neil 的一站的 id “a.2”里有小写英文字母、数字、连字符以外的字（或者是空的）：字体文件的名字、样式表里的规则都照 id 原样写，写不了",
    ]);
    // 点：两站的样式表会撞成一个名字（a.b 的 c 这一站，和 a 的 b.c 这一站，都是 a.b.c.css），字体文件的名字却不重——所以单查 id
    expect(scopeNameClashes(scopeFileNames([{ id: 'a.b', stops: ['c'] }, { id: 'a', stops: ['b.c'] }]))).toEqual([]);
    expect(scopeIdProblems([{ id: 'a.b', stops: ['c'] }, { id: 'a', stops: ['b.c'] }])).toHaveLength(2);
  });

  it('写进文件里的名称不许带原字体保留的名字，照清单就查得出来（不用等到做文件）。原来有一处：“来源”页的那个文件照范围的名字拼就叫 yanlu-song-sources，PostScript 名称里就有了 Source——所以工具写出来的东西里这个范围叫 credits（只有这一处例外，写在 fontNames.ts 里），现在一处也没有了；照 sources 拼的话还是查得出来', { timeout: 30_000 }, async () => {
    expect(reservedNameProblems(plan().files)).toEqual([]);
    expect(reservedNameProblems(planScopes(await readSite(), { joiners: '' }).files)).toEqual([]);
    // 那一处例外：范围叫 sources，文件、样式表里的名称、PostScript 名称、点开才要的字的样式表里都是 credits；别的范围原样
    expect([SOURCES_SCOPE, SOURCES_SLUG, scopeSlug(SOURCES_SCOPE), scopeSlug('su-shi'), scopeSlug('frame')]).toEqual(['sources', 'credits', 'credits', 'su-shi', 'frame']);
    expect([scopeFileName('song', SOURCES_SCOPE, null, 'rest'), scopeFileName('song', SOURCES_SCOPE, null, 'pressed'), scopeFileName('sans', SOURCES_SCOPE, null, 'rest')]).toEqual(['yanlu-song-credits', 'yanlu-song-credits-more', 'yanlu-sans-credits']);
    const credits = file(plan(), 'yanlu-song-credits');
    expect([credits.scope, credits.face, credits.postscript]).toEqual(['sources', 'Yanlu Song credits', 'YanluSongCredits-Regular']);
    // 照 sources 拼出来的那个名称，还是查得出来的那一句（原来清单里的那一处就是它）
    expect(reservedNameProblems([{ name: 'yanlu-song-sources', family: 'Yanlu Song', postscript: postscriptName('yanlu-song-sources') }])).toEqual(['yanlu-song-sources：PostScript 名称 YanluSongSources-Regular 里有原字体保留的名字“Source”（写进文件里的名称不许带它）']);
    // 照 id 就查得出来（内容校验用的是这一个函数）：叫 noto 的站、叫 source-… 的人物；合格的 id 没有
    expect(scopeReservedNames([{ id: 'ann', stops: ['a1', 'noto'] }]).map((item) => `${item.of}：${item.postscript}（${item.words.join('、')}）`)).toEqual(['ann 的 noto 这一站：YanluSongAnnNoto-Regular（Noto）', 'ann 的 noto 这一站：YanluSongAnnNotoMore-Regular（Noto）']);
    expect(scopeReservedNames([{ id: 'source-book', stops: [] }]).length).toBe(4);
    expect(scopeReservedNames([{ id: 'ann', stops: ['a1', 'a2'] }, { id: 'su-shi', stops: ['xuzhou'] }])).toEqual([]);
    // 查得出来：人物、站的 id 拼进名称里带出保留的名字（noto 开头大写就是 Noto）；名称本身带着的也算
    expect(reservedNameProblems([{ name: 'yanlu-song-noto-a', family: 'Yanlu Song', postscript: 'YanluSongNotoA-Regular' }])).toEqual(['yanlu-song-noto-a：PostScript 名称 YanluSongNotoA-Regular 里有原字体保留的名字“Noto”（写进文件里的名称不许带它）']);
    expect(reservedNameProblems([{ name: 'x', family: 'LXGW Song', postscript: 'X-Regular' }])).toEqual(['x：字体名称 LXGW Song 里有原字体保留的名字“LXGW”（写进文件里的名称不许带它）']);
  });

  it('同样的网站列两遍，清单和照它写的每一样都一个字不差', () => {
    const one = plan(madeUpSite(), '鳄');
    const two = plan(madeUpSite(), '鳄');
    expect(JSON.stringify([one.files.map((item) => ({ ...item, where: [...item.where] })), one.pages, one.home, one.joiners])).toBe(JSON.stringify([two.files.map((item) => ({ ...item, where: [...item.where] })), two.pages, two.home, two.joiners]));
    expect(writtenForScopes(one)).toEqual(writtenForScopes(two));
  });
});

// ---------------------------------------------------------------- 二、隔开

describe('字体文件按范围分：动一位人物，别的范围不跟着变', () => {
  const others = (from: ScopePlan, scope: string): string[] => lines(from, (item) => item.scope !== scope);

  it('改一位人物的内容（不动他的卡片，也不动印在“来源”页上的那几样）：他自己的文件变了，别的范围的文件和框架一个字不差', () => {
    const before = plan();
    const after = plan(
      madeUpSite((site) => {
        const bob = site.figures[1];
        bob.figure.intro = ['鸥鹤鹬鳄'];
        bob.figure.stops[0] = { ...bob.figure.stops[0], title: '卯站：鹳', summary: '鹦' };
        bob.stops[0].content = { ...bob.stops[0].content!, sections: [{ heading: '鹈', blocks: [{ type: 'paragraph', segments: [{ text: '鸦鹏鹕鲸' }] }] }] };
      }),
    );
    expect(lines(after, (item) => item.scope === 'bob')).not.toEqual(lines(before, (item) => item.scope === 'bob'));
    expect(has(after, 'yanlu-song-bob', '鹬鳄鹳鹦')).toBe(true);
    expect(others(after, 'bob')).toEqual(others(before, 'bob'));
    // 每一种别的页面拿的文件也没有变
    expect(after.pages.filter((item) => item.figure !== 'bob')).toEqual(before.pages.filter((item) => item.figure !== 'bob'));
  });

  it('添一站有正文的、拿掉一站：只有这位人物的文件多了少了，别人的不变', () => {
    const before = plan();
    const more = plan(
      madeUpSite((site) => {
        const bob = site.figures[1];
        bob.figure.stops[1] = { ...bob.figure.stops[1], status: 'complete' };
        bob.stops.push({ id: 'b2', content: { ...bob.stops[0].content!, stopId: 'b2', sections: [{ heading: '鹈', blocks: [{ type: 'paragraph', segments: [{ text: '鹕鲸' }] }] }] }, scene: null });
      }),
    );
    expect(names(more).filter((name) => !names(before).includes(name))).toEqual(['yanlu-song-bob-b2', 'yanlu-song-bob-b2-more']);
    expect(others(more, 'bob')).toEqual(others(before, 'bob'));
    const less = plan(madeUpSite((site) => site.figures[1].stops.pop()));
    expect(names(before).filter((name) => !names(less).includes(name))).toEqual(['yanlu-song-bob-b1', 'yanlu-song-bob-b1-more']);
    expect(others(less, 'bob')).toEqual(others(before, 'bob'));
  });

  it('拿掉一位人物（连他的卡片）：框架只少了他卡片上别处没有的字；别的范围的文件只在那几个字上有出入（原来在框架里、现在要自己带），“来源”页少了他的几行', () => {
    const before = plan();
    const after = plan(
      madeUpSite((site) => {
        site.figures.pop();
        site.cards.splice(1, 1);
      }),
    );
    const card = new Set(shippable('乙人某代1–9鸿鹔'));
    const gone = [...file(before, 'yanlu-song').characters].filter((ch) => !file(after, 'yanlu-song').characters.includes(ch));
    expect(sortedString(gone)).toBe(sortedString('乙鸿鹔'));
    expect([...file(after, 'yanlu-song').characters].filter((ch) => !file(before, 'yanlu-song').characters.includes(ch))).toEqual([]);
    expect(names(after)).toEqual(names(before).filter((name) => !name.includes('bob')));
    for (const item of after.files.filter((entry) => entry.scope !== 'frame')) {
      const was = new Set(file(before, item.name).characters);
      const now = new Set(item.characters);
      const changed = [...new Set([...was, ...now])].filter((ch) => was.has(ch) !== now.has(ch));
      expect(changed.filter((ch) => !card.has(ch)), item.name).toEqual([]);
    }
  });

  it('只改一位人物的卡片：变的只有框架，和框架新带的字从别的文件里拿走的那几个', () => {
    const before = plan();
    const after = plan(madeUpSite((site) => (site.cards[1] = { ...site.cards[1], tagline: '鸿鹔鲸鸦' })));
    expect(has(after, 'yanlu-song', '鲸鸦')).toBe(true);
    for (const item of after.files.filter((entry) => entry.scope !== 'frame')) {
      const was = file(before, item.name).characters;
      expect(sortedString([...was].filter((ch) => !'鲸鸦'.includes(ch))), item.name).toBe(item.characters);
    }
    expect(hasNone(after, 'yanlu-song-ann', '鲸')).toBe(true);
    expect(hasNone(after, 'yanlu-song-bob-b1', '鸦')).toBe(true);
  });
});

// ---------------------------------------------------------------- 三、真的这个网站

describe('字体文件按范围分：仓库里真的这个网站', () => {
  const site = readSite();

  it('每一种页面显示的每一个字，都在给这一页的文件里（只有框架的页面、首页、每位人物的人物页、他的每一站、“来源”页）；挨着别的字会变样的字不管是哪几个都一样', { timeout: 60_000 }, async () => {
    const real = await site;
    const by = pageTexts(real);
    // 每一种页面都走到了：两位人物以上，有正文的站、有沙盘没正文的站、两样都没有的站都有
    expect(by.pages.map((item) => item.kind).filter((kind, index, all) => all.indexOf(kind) === index).sort()).toEqual(['figure', 'frame', 'home', 'sources', 'stop', 'unit']);
    expect(by.pages.filter((item) => item.kind === 'figure').length).toBeGreaterThanOrEqual(2);
    const made = planScopes(real, { joiners: '' });
    expect(missingOnPages(by, made)).toEqual([]);
    expect(made.pages).toHaveLength(by.pages.length);
    // 换一串“挨着会变样的字”（拿真的文件里的字来试：一站不用点开的文件的头三个字，人物点开才要的文件的头三个字）：照样都在
    const unit = made.files.find((item) => item.unit !== null && item.role === 'rest');
    const pressed = made.files.find((item) => item.unit === null && item.role === 'pressed');
    const joiners = [...(unit?.characters ?? '')].slice(0, 3).join('') + [...(pressed?.characters ?? '')].slice(0, 3).join('');
    expect([...joiners]).toHaveLength(6);
    const moved = planScopes(real, { joiners });
    expect(missingOnPages(by, moved)).toEqual([]);
    for (const ch of joiners) expect(moved.files.filter((item) => item.source === 'song' && item.characters.includes(ch)).map((item) => item.name), ch).toEqual(['yanlu-song']);
    console.log(['字体文件按范围分（照现在的内容列的清单，挨着会变样的字一个也不算的时候）',...made.files.map((item) => `  ${item.name}：${[...item.characters].length} 个字`)].join('\n'));
  });

  it('查得出来：一站的文件里少了它的页面上的一个字；那个字只在别的范围的文件里有，不算数；人物的黑体、楷体里少一个字', { timeout: 60_000 }, async () => {
    const real = await site;
    const by = pageTexts(real);
    const made = planScopes(real, { joiners: '' });
    const without = (name: string, ch: string): ScopePlan => ({ ...made, files: made.files.map((item) => (item.name === name ? { ...item, characters: item.characters.replace(ch, '') } : item)) });
    const unit = made.files.find((item) => item.unit !== null && item.role === 'rest');
    expect(unit).toBeDefined();
    if (!unit) return;
    // 这一站的文件里的一个字，人物自己的文件里也有的（范围之间不借：拿掉它，这一站的页面就少了这个字）
    const own = made.files.find((item) => item.scope === unit.scope && item.unit === null && item.role === 'rest' && item.source === 'song');
    const shared = [...unit.characters].find((ch) => own?.characters.includes(ch));
    expect(shared, '要有一个字，一站的文件里和人物的文件里都有').toBeDefined();
    if (!shared) return;
    const missing = missingOnPages(by, without(unit.name, shared));
    // 说的都是这个字、这一站的页面（这个字在那一页上点开才看得见的地方也用到的话，再说一句）
    expect(missing.length).toBeGreaterThanOrEqual(1);
    expect(missing.length).toBeLessThanOrEqual(2);
    for (const line of missing) {
      expect(line).toContain(`“${shared}”`);
      expect(line).toContain('不在这一页拿到的字体文件里');
      expect(line).toContain(`${unit.name}.woff2`);
    }
    expect(missing[0]).toContain('不用点开就看得见的字，不在这一页拿到的字体文件里');
    // 人物的黑体里少一个字：用到它的每一页都说得出来；楷体里少一个字也是
    for (const source of ['sans', 'kai'] as const) {
      const whole = made.files.find((item) => item.scope === unit.scope && item.source === source);
      expect(whole, source).toBeDefined();
      if (!whole) continue;
      const ch = [...whole.characters].find((one) => one !== ' ') ?? '';
      const said = missingOnPages(by, without(whole.name, ch));
      expect(said.length, source).toBeGreaterThan(0);
      for (const line of said) expect(line).toContain(source === 'sans' ? '用黑体排的字' : '用楷体排的字');
    }
    // 照做出来的文件里真有的字查的时候也一样（开关打开以后给的是放进仓库的文件读出来的）
    const inFiles = charactersByName(made);
    inFiles.get(unit.name)?.delete(shared);
    expect(missingOnPages(by, made, (name) => inFiles.get(name))).toEqual(missing);
  });

  it('放进仓库的就是照范围做的这些文件：照现在的内容列的清单里每个文件要的每一个字，放进仓库的同名的那个文件里都有（黑体的在那个黑体文件里，楷体的在那个楷体文件里，宋体的在那个宋体文件里——不是“哪个文件里有就行”）', { timeout: 60_000 }, async () => {
    const real = await site;
    const shipped = readScoped();
    // 挨着会变样的字照记录里量到的那一串（做文件的时候量的）
    const made = planScopes(real, { joiners: shipped.record.joiners });
    expect(shipped.record.files.map((item) => item.file)).toEqual(made.files.map(scopeFilePath));
    for (const item of made.files) {
      const own = shipped.files.find((entry) => entry.record.file === scopeFilePath(item));
      expect(own?.record.source, item.name).toBe(item.source);
      expect([...item.characters].filter((ch) => !own?.characters.has(ch)), item.name).toEqual([]);
    }
    // 每一种页面的每一个字，在给这一页的、放进仓库的文件里（不是清单里，是文件里真有的字）
    expect(missingOnPages(pageTexts(real), made, (name) => shipped.files.find((entry) => entry.record.file.replace(/^.*\//, '') === `${name}.woff2`)?.characters)).toEqual([]);
  });
});

// ---------------------------------------------------------------- 四、照清单写的几样

describe('字体文件按范围分：照清单写的几样', () => {
  const made = plan(madeUpSite(), '鳄');
  const written = writtenForScopes(made);

  it('fonts.css：框架的两条在前，后面是每个范围不用点开就要的文件各一条，都不带 unicode-range；最后每个范围正好一条换名称的规则，一站的规则比人物的多一个条件、只换宋体', () => {
    expect(written.css).toBe(scopeFontsCss(made.files));
    const css = stripCssComments(written.css);
    const faces = css.split('@font-face').slice(1);
    const rest = made.files.filter((item) => item.role === 'rest');
    expect(faces).toHaveLength(rest.length);
    faces.forEach((rule, index) => {
      const item = rest[index];
      expect(rule.match(/font-family: '([^']+)'/)?.[1]).toBe(item.face);
      expect(rule.match(/url\('\.\/([^']+)'\)/)?.[1]).toBe(scopeFilePath(item));
      expect(rule.match(/font-weight: (\d+);/)?.[1]).toBe(String(item.weight));
      expect(rule).toContain('font-display: swap;');
      expect(rule).not.toContain('unicode-range');
    });
    expect(css).not.toContain('unicode-range');
    expect(css).not.toContain('-more.woff2');
    const rules = css.split('\n').filter((line) => line.startsWith(':root'));
    expect(rules).toEqual([
      ":root[data-fonts='ann'] { --own-sans: 'Yanlu Sans ann'; --own-song: 'Yanlu Song ann'; }",
      ":root[data-fonts='ann'][data-fonts-unit='a1'] { --own-song: 'Yanlu Song ann a1'; }",
      ":root[data-fonts='ann'][data-fonts-unit='a2'] { --own-song: 'Yanlu Song ann a2'; }",
      ":root[data-fonts='bob'] { --own-sans: 'Yanlu Sans bob'; --own-song: 'Yanlu Song bob'; }",
      ":root[data-fonts='bob'][data-fonts-unit='b1'] { --own-song: 'Yanlu Song bob b1'; }",
      // “来源”页的那一条只认没有写着站的时候：地址 #/sources/… 不是哪一页，那里不要这个文件；名称里它叫 credits
      ":root[data-fonts='sources']:not([data-fonts-unit]) { --own-song: 'Yanlu Song credits'; }",
    ]);
    // 规则里写的名称，前面都有 @font-face 写着
    for (const name of rules.flatMap((rule) => Array.from(rule.matchAll(/: '([^']+)';/g), (match) => match[1]))) expect(css).toContain(`font-family: '${name}';`);
    // 换的只有这两个记号
    expect([...new Set(Array.from(css.matchAll(/(--[a-z-]+):/g), (match) => match[1]))].sort()).toEqual(['--own-sans', '--own-song']);
  });

  it('点开才要的字的样式表：一个文件一份，放在 scopes/ 里，一条 @font-face，unicode-range 列的正好是这个文件里的字，名称是这个范围的', () => {
    const pressed = made.files.filter((item) => item.role === 'pressed');
    expect(Object.keys(written.sheets)).toEqual(['scopes/ann.css', 'scopes/ann.a1.css', 'scopes/ann.a2.css', 'scopes/bob.b1.css']);
    expect(Object.keys(written.sheets)).toEqual(pressed.map((item) => item.sheet));
    for (const item of pressed) {
      const css = stripCssComments(written.sheets[item.sheet]);
      expect(written.sheets[item.sheet]).toBe(pressedSheetCss(item));
      expect(css.split('@font-face')).toHaveLength(2);
      expect(css.match(/font-family: '([^']+)'/)?.[1]).toBe(item.face);
      expect(css.match(/url\('\.\/([^']+)'\)/)?.[1]).toBe(`${item.name}.woff2`);
      const range = css.match(/unicode-range: ([^;]+);/)?.[1] ?? '';
      expect(range.split(', ').map((entry) => String.fromCodePoint(parseInt(entry.replace(/^U\+/, ''), 16))).join('')).toBe(item.characters);
    }
  });

  it('scopes.ts：每个范围点开才要的那个文件一行——它的样式表的地址（照地址引的，页面用到时才挂上去）、它里面编码最小的一个字、它在样式表里的名称；范围的叫法是人物的 id，一站是“人物/站”', () => {
    expect(written.scopes).toBe(scopesTs(made.files));
    const pressed = made.files.filter((item) => item.role === 'pressed');
    const rows = written.scopes.split('\n').filter((line) => line.startsWith("  '"));
    expect(rows).toEqual(pressed.map((item, index) => `  '${item.unit === null ? item.scope : `${item.scope}/${item.unit}`}': { sheet: sheet${index}, probe: '${[...item.characters][0]}', face: '${item.face}' },`));
    // 样式表是照地址引的（?url），一份一句；这个文件里没有 import(…)：有的话打包的工具会把页面的程序拆成两块
    expect(written.scopes.split('\n').filter((line) => line.startsWith('import '))).toEqual(pressed.map((item, index) => `import sheet${index} from './${item.sheet}?url';`));
    expect(written.scopes).not.toContain('import(');
    expect(rows.map((row) => row.match(/^ {2}'([^']+)'/)?.[1])).toEqual(['ann', 'ann/a1', 'ann/a2', 'bob/b1']);
  });

  it('index.html 里的那一段：每个范围不用点开就要的黑体、宋体文件各一行，先不生效，写着归哪个范围、哪一站、是黑体还是宋体（“来源”页的那一行写着空的站：只给地址里没有站的那一页）；首页摆着的那位人物的几行另有记号；楷体和点开才要的不在；放进 index.html 是接在最后一行预先声明后面，再放一次是换掉原来的', () => {
    expect(written.preloads).toBe(preloadBlock(made.files, made.home));
    const rows = written.preloads.split('\n').map((line) => line.trim());
    expect(rows[0]).toBe(PRELOAD_BLOCK.start);
    expect(rows[rows.length - 1]).toBe(PRELOAD_BLOCK.end);
    expect(rows.slice(1, -1)).toEqual([
      '<link rel="preload" href="/src/fonts/scopes/yanlu-sans-ann.woff2" as="font" type="font/woff2" crossorigin media="not all" data-fonts="ann" data-fonts-family="sans" data-fonts-home />',
      '<link rel="preload" href="/src/fonts/scopes/yanlu-song-ann.woff2" as="font" type="font/woff2" crossorigin media="not all" data-fonts="ann" data-fonts-family="song" data-fonts-home />',
      '<link rel="preload" href="/src/fonts/scopes/yanlu-song-ann-a1.woff2" as="font" type="font/woff2" crossorigin media="not all" data-fonts="ann" data-fonts-unit="a1" data-fonts-family="song" />',
      '<link rel="preload" href="/src/fonts/scopes/yanlu-song-ann-a2.woff2" as="font" type="font/woff2" crossorigin media="not all" data-fonts="ann" data-fonts-unit="a2" data-fonts-family="song" />',
      '<link rel="preload" href="/src/fonts/scopes/yanlu-sans-bob.woff2" as="font" type="font/woff2" crossorigin media="not all" data-fonts="bob" data-fonts-family="sans" />',
      '<link rel="preload" href="/src/fonts/scopes/yanlu-song-bob.woff2" as="font" type="font/woff2" crossorigin media="not all" data-fonts="bob" data-fonts-family="song" />',
      '<link rel="preload" href="/src/fonts/scopes/yanlu-song-bob-b1.woff2" as="font" type="font/woff2" crossorigin media="not all" data-fonts="bob" data-fonts-unit="b1" data-fonts-family="song" />',
      '<link rel="preload" href="/src/fonts/scopes/yanlu-song-credits.woff2" as="font" type="font/woff2" crossorigin media="not all" data-fonts="sources" data-fonts-unit="" data-fonts-family="song" />',
    ]);
    // 放进一份还没有这一段的 index.html（真的那一份，把工具写的那一段拿掉）：原来的每一行都还在、先后不变，那一段接在两行预先声明的后面
    const real = text('index.html');
    const start = real.lastIndexOf('\n', real.indexOf(PRELOAD_BLOCK.start));
    const html = real.slice(0, start) + real.slice(real.indexOf(PRELOAD_BLOCK.end) + PRELOAD_BLOCK.end.length);
    expect(real).toContain(PRELOAD_BLOCK.start);
    expect(html).not.toContain(PRELOAD_BLOCK.start);
    expect(html).not.toMatch(/<link rel="preload"[^>]*media="not all"/);
    const once = withPreloadBlock(html, written.preloads);
    expect(once.replace(`\n${written.preloads}`, '')).toBe(html);
    expect(once.indexOf(PRELOAD_BLOCK.start)).toBeGreaterThan(once.indexOf('yanlu-song.woff2'));
    expect(once.indexOf(PRELOAD_BLOCK.end)).toBeLessThan(once.indexOf('</head>'));
    // 再放一次（换一份清单）：换掉原来的，不多出一段
    const other = preloadBlock(plan(madeUpSite((site) => site.figures.pop())).files, 'ann');
    const twice = withPreloadBlock(once, other);
    expect(twice.split(PRELOAD_BLOCK.start)).toHaveLength(2);
    expect(twice.replace(`\n${other}`, '')).toBe(html);
    expect(withPreloadBlock(once, written.preloads)).toBe(once);
    expect(() => withPreloadBlock('<html><head></head></html>', written.preloads)).toThrow(/不知道接在哪/);
  });

  it('格式 4 的记录：每个文件一项（路径、样式表里的名称、归哪个范围、哪一站、是不是点开才要的、怎么声明、在哪一份样式表里）；每一种页面一项（不用点开要哪几个、点开以后还会取哪几个、前一拨合计多少字节，没有自己的文件的站不单列）；首页摆着谁；挨着会变样的字。照同一份清单列的是新的，动了一样就不是', () => {
    // 文件多大这里是编的（每个字 100 字节）：做文件要原字体，这一项只查记录怎么拼
    const records: ScopeFileRecord[] = made.files.map((item) => ({
      file: scopeFilePath(item),
      face: item.face,
      family: item.family,
      postscript: item.postscript,
      source: item.source,
      scope: item.scope,
      unit: item.unit,
      role: item.role,
      range: item.range,
      preload: item.preload,
      sheet: item.sheet,
      weight: item.weight,
      bytes: [...item.characters].length * 100,
      sha256: '',
      count: [...item.characters].length,
      glyphs: 0,
      characters: item.characters,
      onlyFromSrc: '',
      features: [],
      hinting: 'kept',
    }));
    const versions = { 'subset-font': '0' };
    const record = scopeRecord(made, records, versions);
    expect(record.tool).toBe(SCOPE_RECORD_VERSION);
    expect(record.tool).toBe(4);
    expect(Object.keys(record)).toEqual(['tool', 'recipe', 'made', 'sources', 'home', 'joiners', 'pages', 'files']);
    expect(record.home).toBe('ann');
    expect(record.joiners).toBe('鳄');
    expect(record.files).toBe(records);
    expect(record.pages.map((item) => [item.kind, item.figure, item.unit])).toEqual([
      ['frame', null, null],
      ['home', 'ann', null],
      ['figure', 'ann', null],
      ['unit', 'ann', 'a1'],
      ['unit', 'ann', 'a2'],
      ['figure', 'bob', null],
      ['unit', 'bob', 'b1'],
      ['sources', null, null],
    ]);
    const bytes = (path: string): number => records.find((item) => item.file === path)?.bytes ?? NaN;
    for (const item of record.pages) {
      expect(item.rest.slice(0, 2)).toEqual(['yanlu-sans.woff2', 'yanlu-song.woff2']);
      expect(item.bytes).toBe(item.rest.reduce((sum, path) => sum + bytes(path), 0));
      for (const path of [...item.rest, ...item.pressed]) expect(records.map((entry) => entry.file)).toContain(path);
    }
    expect(record.pages[3]).toMatchObject({ rest: ['yanlu-sans.woff2', 'yanlu-song.woff2', 'scopes/yanlu-sans-ann.woff2', 'scopes/yanlu-kai-ann.woff2', 'scopes/yanlu-song-ann-a1.woff2'], pressed: ['scopes/yanlu-song-ann-a1-more.woff2'] });
    // 是不是新的
    expect(scopeRecordIsFresh(made, record, versions)).toEqual({ fresh: true, why: '' });
    expect(scopeRecordIsFresh(made, record, { 'subset-font': '1' }).why).toBe('裁剪字体的库换了版本');
    expect(scopeRecordIsFresh(made, { ...record, tool: RECORD_VERSION }, versions).why).toBe('记录的格式换了');
    expect(scopeRecordIsFresh(plan(madeUpSite((site) => (site.figures[1].figure.intro = ['鸥鹤鹬'])), '鳄'), record, versions).why).toBe('yanlu-song-bob 的字变了');
    expect(scopeRecordIsFresh(plan(madeUpSite((site) => site.figures[1].stops.pop()), '鳄'), record, versions).why).toBe('要做的文件和记录里的不是同一些');
    expect(scopeRecordIsFresh(made, { ...record, home: 'bob' }, versions).why).toBe('首页的沙盘栏里摆着的人物换了');
    expect(scopeRecordIsFresh(made, { ...record, pages: record.pages.slice(1) }, versions).why).toBe('每一种页面拿哪几个文件变了');
    expect(scopeRecordIsFresh(made, { ...record, files: records.map((item, index) => (index === 2 ? { ...item, preload: 'none' as const } : item)) }, versions).why).toContain('yanlu-sans-ann 的说明变了');
    // 一种页面要的文件，做出来的文件里没有它的那一项（名字对不上）：不当成 0 字节记下来，停下来说是哪一页、哪个文件
    expect(() => scopeRecord(made, records.filter((item) => item.file !== 'scopes/yanlu-song-ann-a1.woff2'), versions)).toThrow(/甲人的子站要的字体文件 scopes\/yanlu-song-ann-a1\.woff2 不在做出来的文件里/);
    expect(() => scopeRecord(made, records.filter((item) => item.file !== 'scopes/yanlu-song-ann-a1-more.woff2'), versions)).toThrow(/甲人的子站要的字体文件 scopes\/yanlu-song-ann-a1-more\.woff2 不在做出来的文件里/);
    const misspelt: ScopePlan = { ...made, pages: made.pages.map((item) => (item.kind === 'unit' && item.stop === 'a2' ? { ...item, rest: [...item.rest.slice(0, -1), 'yanlu-song-ann-a2-x'] } : item)) };
    expect(() => scopeRecord(misspelt, records, versions)).toThrow(/甲人的丑站要的字体文件 yanlu-song-ann-a2-x\.woff2 不在做出来的文件里/);
    // 名字换成路径只有一种拼法：框架的在这一层，别的在 scopes/ 里，点开才要的也一样
    expect(scopePagePaths(made, ['yanlu-sans', 'yanlu-song-ann-a1', 'yanlu-song-ann-a1-more'])).toEqual(['yanlu-sans.woff2', 'scopes/yanlu-song-ann-a1.woff2', 'scopes/yanlu-song-ann-a1-more.woff2']);
    expect(scopePagePaths(made, ['yanlu-song-ann-a1'])).toEqual([scopeFilePath(file(made, 'yanlu-song-ann-a1'))]);
  });
});

// ---------------------------------------------------------------- 五、上限，和开关

describe('字体文件按范围分：上限和开关', () => {
  /** 一种页面的文件：框架的两个，人物的黑体、楷体，这一页的宋体，和它点开才要的。 */
  const sizes = (over: Partial<Record<'sans' | 'song' | 'own' | 'kai' | 'page' | 'more' | 'sheet', number>> = {}): FontScopeSizes => {
    const bytes = { sans: 30_000, song: 116_000, own: 30_000, kai: 32_000, page: 72_000, more: 150_000, sheet: 1_600, ...over };
    return {
      files: [
        { file: 'yanlu-sans.woff2', bytes: bytes.sans, frame: true },
        { file: 'yanlu-song.woff2', bytes: bytes.song, frame: true },
        { file: 'scopes/yanlu-sans-p.woff2', bytes: bytes.own, frame: false },
        { file: 'scopes/yanlu-kai-p.woff2', bytes: bytes.kai, frame: false },
        { file: 'scopes/yanlu-song-p-s.woff2', bytes: bytes.page, frame: false },
        { file: 'scopes/yanlu-song-p-s-more.woff2', bytes: bytes.more, frame: false },
      ],
      pages: [
        { name: '只有框架的字的页面', rest: ['yanlu-sans.woff2', 'yanlu-song.woff2'], pressed: [] },
        { name: '某人的甲站', rest: ['yanlu-sans.woff2', 'yanlu-song.woff2', 'scopes/yanlu-sans-p.woff2', 'scopes/yanlu-kai-p.woff2', 'scopes/yanlu-song-p-s.woff2'], pressed: ['scopes/yanlu-song-p-s-more.woff2'] },
      ],
      sheets: [{ file: 'scopes/p.s.css', gzip: bytes.sheet }],
    };
  };

  it('是哪几个数：一种页面首次打开 360 KB、过了 330 KB 提醒；框架的两个文件 170 KB、过了 160 KB 提醒；点开才要的字的样式表压缩以后 4,096、过了 3,584 提醒；一个文件还是 300 KB、280 KB', () => {
    expect([FONT_PAGE_FIRST_MAX_BYTES, FONT_PAGE_FIRST_WARN_BYTES]).toEqual([368_640, 337_920]);
    expect([FONT_FRAME_MAX_BYTES, FONT_FRAME_WARN_BYTES]).toEqual([174_080, 163_840]);
    expect([FONT_SHEET_GZIP_MAX, FONT_SHEET_GZIP_WARN]).toEqual([4_096, 3_584]);
    expect([FONT_FILE_MAX_BYTES, FONT_FILE_WARN_BYTES]).toEqual([307_200, 286_720]);
  });

  it('都在上限里：每个文件一行，框架一行，每一种页面一行（连每一折都点开的合计），每份样式表一行，全部合计一行', () => {
    const report = fontScopeReport(sizes());
    expect(report.fails).toEqual([]);
    expect(report.warns).toEqual([]);
    expect(report.lines).toEqual([
      'yanlu-sans.woff2：30,000 字节，上限 307,200（用了 10%）',
      'yanlu-song.woff2：116,000 字节，上限 307,200（用了 38%）',
      'scopes/yanlu-sans-p.woff2：30,000 字节，上限 307,200（用了 10%）',
      'scopes/yanlu-kai-p.woff2：32,000 字节，上限 307,200（用了 10%）',
      'scopes/yanlu-song-p-s.woff2：72,000 字节，上限 307,200（用了 23%）',
      'scopes/yanlu-song-p-s-more.woff2：150,000 字节，上限 307,200（用了 49%）',
      '框架的字体（yanlu-sans.woff2、yanlu-song.woff2，哪一页都要下载）：146,000 字节，上限 174,080（用了 84%）',
      '只有框架的字的页面首次打开要下载的字体（2 个文件）：146,000 字节，上限 368,640（用了 40%）；每一折都点开一共 146,000 字节（没有上限）',
      '某人的甲站首次打开要下载的字体（5 个文件）：280,000 字节，上限 368,640（用了 76%）；每一折都点开一共 430,000 字节（没有上限）',
      'scopes/p.s.css（压缩以后）：1,600 字节，上限 4,096',
      '全部字体文件合计：430,000 字节（没有上限）',
    ]);
  });

  it('一种页面首次打开的合计正好 360 KB 算合格，多一个字节就不合格，说的是哪一页；过了 330 KB 提醒；点开才要的不算在里面；各页各算各的', () => {
    // 框架 146,000 + 黑体 30,000 + 楷体 32,000 = 208,000；这一页的宋体 160,640 时正好 368,640
    expect(fontScopeReport(sizes({ page: 160_640 })).fails).toEqual([]);
    expect(fontScopeReport(sizes({ page: 160_641 })).fails).toEqual(['某人的甲站首次打开要下载的字体合计有 368,641 字节，超过了上限 368,640']);
    expect(fontScopeReport(sizes({ page: 129_920 })).warns).toEqual([]);
    expect(fontScopeReport(sizes({ page: 129_921 })).warns).toEqual(['某人的甲站首次打开要下载的字体合计有 337,921 字节，快到上限 368,640 了（过了 337,920 就提醒）：把这位人物的黑体和楷体也按站分开']);
    expect(fontScopeReport(sizes({ more: 300_000 })).fails).toEqual([]);
  });

  it('框架的两个文件合计正好 170 KB 算合格，多一个字节就不合格；过了 160 KB 提醒', () => {
    expect(fontScopeReport(sizes({ song: 144_080 })).fails).toEqual([]);
    expect(fontScopeReport(sizes({ song: 144_081 })).fails).toEqual(['框架的字体合计有 174,081 字节，超过了上限 174,080']);
    expect(fontScopeReport(sizes({ song: 133_840 })).warns).toEqual([]);
    expect(fontScopeReport(sizes({ song: 133_841 })).warns).toEqual(['框架的字体合计有 163,841 字节，快到上限 174,080 了（过了 163,840 就提醒）：把人物卡片上的字从框架里挪到首页自己的一个文件里']);
  });

  it('一个文件正好 300 KB 算合格，多一个字节就不合格，过了 280 KB 提醒；样式表压缩以后正好 4,096 算合格，多一个字节就不合格，过了 3,584 提醒', () => {
    expect(fontScopeReport(sizes({ more: FONT_FILE_MAX_BYTES })).fails).toEqual([]);
    expect(fontScopeReport(sizes({ more: FONT_FILE_MAX_BYTES + 1 })).fails).toEqual(['字体文件 scopes/yanlu-song-p-s-more.woff2 有 307,201 字节，超过了上限 307,200']);
    expect(fontScopeReport(sizes({ more: FONT_FILE_WARN_BYTES + 1 })).warns).toEqual(['字体文件 scopes/yanlu-song-p-s-more.woff2 有 286,721 字节，快到上限 307,200 了（过了 286,720 就提醒）：点开才要的文件照折着的那几块再分开']);
    expect(fontScopeReport(sizes({ sheet: 4_096 })).fails).toEqual([]);
    expect(fontScopeReport(sizes({ sheet: 4_097 })).fails).toEqual(['点开才要的字的样式表 scopes/p.s.css 压缩以后有 4,097 字节，超过了上限 4,096']);
    expect(fontScopeReport(sizes({ sheet: 3_584 })).warns).toEqual([]);
    expect(fontScopeReport(sizes({ sheet: 3_585 })).warns).toEqual(['点开才要的字的样式表 scopes/p.s.css 压缩以后有 3,585 字节，快到上限 4,096 了（过了 3,584 就提醒）']);
  });

  it('一种页面要的文件，量过大小的文件里没有（名字拼得不一样）：不当成 0 字节放过去——算一条不合格，说出是哪一页、哪个文件；不用点开的、点开才要的都查', () => {
    const wrong = sizes();
    // 不用点开就要的那个宋体文件拼错了：这一页的合计少了 72,000，照数看还在上限里
    wrong.pages[1].rest[4] = 'scopes/yanlu-song-p-x.woff2';
    const said = fontScopeReport(wrong);
    expect(said.lines).toContain('某人的甲站首次打开要下载的字体（5 个文件）：208,000 字节，上限 368,640（用了 56%）；每一折都点开一共 358,000 字节（没有上限）');
    expect(said.fails).toEqual(['某人的甲站要的字体文件 scopes/yanlu-song-p-x.woff2 不在量过大小的文件里（名字对不上）：它的字节没有算进这一页的合计']);
    // 点开才要的那个少写了文件夹
    const pressed = sizes();
    pressed.pages[1].pressed[0] = 'yanlu-song-p-s-more.woff2';
    expect(fontScopeReport(pressed).fails).toEqual(['某人的甲站要的字体文件 yanlu-song-p-s-more.woff2 不在量过大小的文件里（名字对不上）：它的字节没有算进这一页的合计']);
    expect(fontScopeReport(sizes()).fails).toEqual([]);
  });

  it('src/fonts/ 里手写的那一个文件（scope.ts）注释以外没有汉字，也没有别的英文以外的字：这个文件夹做字体的工具不读，写在这里给读者看的字进不了哪个字体文件', () => {
    // 工具不读这个文件夹（所以要在这里守着）
    expect(isInterfaceSource('src/fonts/scope.ts')).toBe(false);
    const beyondAscii = (code: string): string[] => [...stripComments(code)].filter((ch) => (ch.codePointAt(0) ?? 0) > 0x7e);
    expect(beyondAscii(text('src/fonts/scope.ts'))).toEqual([]);
    // 查得出来：注释里的不算，字符串里的算
    expect(beyondAscii("// 注释\nexport const WORD = '鑫'; /* 也是注释 */\n")).toEqual(['鑫']);
  });

  it('开关开着：做字体的工具做的是按范围分的文件，记录是格式 4，src/fonts/ 里是按范围分的那些（框架的两个在这一层，别的在 scopes/ 里），全站共用的那两个旧文件（楷体、点开才要的宋体）不在了；关不回去——工具里关着的那一头只有一句话；PRESSED_SOURCES 里的每个文件都写明了按范围分的时候归哪里', () => {
    // 页面那一头是按范围要文件的（src/fonts/scope.ts）：所以这个开关关不回去
    expect(FONTS_BY_SCOPE, '字体文件按范围分的开关关不回去：页面是按范围要文件的，全站共用的那四个文件已经不做了').toBe(true);
    const shipped = readScoped();
    expect(shipped.record.tool).toBe(SCOPE_RECORD_VERSION);
    expect([RECORD_VERSION, SCOPE_RECORD_VERSION]).toEqual([3, 4]);
    expect(shipped.record.files.slice(0, 2).map((item) => item.file)).toEqual(['yanlu-sans.woff2', 'yanlu-song.woff2']);
    expect(shipped.record.files.length).toBeGreaterThan(4);
    expect(shipped.record.files.slice(2).every((item) => item.file.startsWith('scopes/'))).toBe(true);
    expect(shipped.record.files.map((item) => item.file).filter((name) => name === 'yanlu-kai.woff2' || name === 'yanlu-song-more.woff2')).toEqual([]);
    expect(Object.keys(shipped.record as unknown as Record<string, unknown>)).toEqual(['tool', 'recipe', 'made', 'sources', 'home', 'joiners', 'pages', 'files']);
    expect(text('index.html')).toContain(PRELOAD_BLOCK.start);
    expect(text('src/fonts/fonts.css')).toContain('--own-');
    expect(Object.keys(PRESSED_SOURCE_SCOPES).sort()).toEqual([...PRESSED_SOURCES].sort());
    // 看这个开关的只有一处：做字体的工具开头。开着走按范围分的那一条路；紧跟着的一句是关着的那一头——停下来说一句话，什么也不做。页面的程序里没有谁提到它
    const tool = text('tests/tools/make-fonts.test.ts');
    expect(countIn(tool, 'if (FONTS_BY_SCOPE)')).toBe(1);
    expect(tool).toMatch(/if \(FONTS_BY_SCOPE\) return makeByScope\(\{ say, trial, outDir \}\);\n\s*throw new Error\(/);
    expect(countIn(text('tests/support/fontTool.ts'), 'if (FONTS_BY_SCOPE')).toBe(0);
    for (const path of sourceFiles()) expect(text(path).includes('FONTS_BY_SCOPE'), path).toBe(false);
  });
});

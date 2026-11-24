// 做随站的字体的工具：npm run fonts。从三个原字体里裁出网站用到的字，做成 src/fonts/ 里的几样：
//   yanlu-sans.woff2、yanlu-song.woff2、yanlu-kai.woff2、yanlu-song-more.woff2   四个字体文件
//   fonts.css      这几个文件的样式表
//   fonts.json     记录：每个文件里有哪些字、多大、照哪个原字体做的
//   shipped.ts     给页面用的几样
// 再把五份许可全文照原样放进 public/licences/。这些做好以后放进仓库，随网站一起发；发布的流程不重新做。都不手改。
// 说明见 docs/data-spec.md“随站的字体”；哪些字归哪个文件、文件怎么做，写在 tests/support/fontTool.ts。
//
// 它是一个测试文件，因为这个项目是靠 vitest 在 Node 里跑 TypeScript 的。
// 最下面“不用原字体也查得了的”那一组随 npm test 跑（package.json 的 test 里列着这个文件），什么也不写；
// 上面真的做字体的那一组只有 npm run fonts（vitest --mode fonts）才跑。直接跑这个文件和 npm test 一样，只跑最下面那一组。
// 要是哪一版的 vitest 不把 --mode 交到 import.meta.env.MODE 里，设环境变量 FONTS=1 也算。
//
// 另外两个环境变量：
//   FONTS_OUT      试做：做出来的几样放到这个文件夹（相对项目的根目录，如 .cache/fonts-trial），
//                  不动 src/fonts/ 和 public/licences/，也不管记录新不新，一定做。用来看“同样的字，做两遍，字节一样不一样”。
//   FONTS_COMPARE  设成 1：另外把两个宋体文件和黑体的文件不留提示信息各做一遍，只印出大小来比，不写。
//
// 步骤：
//   1 数出网站上显示的字，分成四组（黑体、看得见的宋体、楷体、点开才看得见的宋体）。印出每组多少个字。
//   2 两个程序库的许可全文和装着的不一样，就照装着的重抄一份。
//   3 记录里的字、原字体的说明、做法、库的版本都和现在的一样，字体文件也都在、和记录对得上、读出来合现在的做法：不重做。
//     这时再看照记录写的另外几样（样式表、给页面用的模块、三份字体的许可全文）：都对，说一声“已经是新的”，什么也不写；
//     哪一样不在、被改过，照记录把它重写（许可全文照 .cache/fonts/ 里的那一份重抄），说写了哪几样。前两样用不到原字体。
//     所以查字体的测试（tests/fonts/font-files.test.ts）说“运行 npm run fonts”的地方，跑这一条命令都修得好。
//   4 读原字体（.cache/fonts/ 里；不在、或者不是要的那一版，就停下来说该放什么文件）。原字体里没有的字：停下来列出来。
//   5 每个文件：在原字体里换上新的名称表，裁剪，压成 WOFF2。
//   6 读回来查一遍：里面的字正好是要的那些；名称对；楷体带着竖排用的两张表；粗细是原字体的那一种；黑体的文件里留着 halt，
//     别的“挤标点”的排版功能哪个文件里都没有。大小对着上限查。不对就停，什么也不写。
//   7 写文件；src/fonts/ 里不再要的字体文件删掉；三份字体的许可全文从 .cache/fonts/ 抄进 public/licences/。

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RouteScene } from '../../src/domain/scene';
import type { LngLat, Figure, StopContent, StopMeta } from '../../src/domain/types';
import { fontReport, withCommas } from '../content/budgetRules';
import { fixtureScene, fixtureSources } from '../support/fixtureScene';
import {
  CACHE_DIR,
  FONTS_DIR,
  FONT_SOURCES,
  FONT_SOURCE_IDS,
  KAI_FORBIDDEN,
  SQUEEZE_FEATURES,
  SQUEEZE_KEPT,
  LIBRARY_LICENCES,
  LICENCES_DIR,
  NAME_IDS,
  PRESSED_SOURCES,
  RECIPE,
  RECORD_VERSION,
  SHADER_DIRS,
  codeOf,
  fileRecord,
  fontFileProblems,
  fontRecord,
  fontsCss,
  holdsShaders,
  isInterfaceSource,
  makeFont,
  missingFromShipped,
  nameRecordsFor,
  planFonts,
  postscriptName,
  readOriginal,
  readSite,
  recordIsFresh,
  recordText,
  servedBy,
  sha256,
  shippable,
  shippedFileProblems,
  shippedTs,
  sortedString,
  sourceFiles,
  sourceRecord,
  squeezeProblems,
  stripComments,
  subsetSentence,
  toolVersions,
  writtenFromRecord,
} from '../support/fontTool';
import type { FontFileRecord, FontPlan, FontRecord, FontSourceId, PlannedFile, ShippedFonts, SiteText } from '../support/fontTool';
import { charactersOf, checkSfnt, cmapOf, englishName, glyphCountOf, hintingOf, namesOf, readSfnt, readWoff2, renameSfnt } from '../support/sfnt';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** 是不是真的要做（npm run fonts）。 */
const MAKING = import.meta.env.MODE === 'fonts' || env.FONTS === '1';

/** 项目的根目录：这个文件在 tests/tools/ 里，往上两层。 */
const ROOT = new URL('../../', import.meta.url);
const at = (path: string): URL => new URL(path, ROOT);
const utf8 = new TextDecoder();

/** 把一套字体的许可全文从 .cache/fonts/ 抄进 public/licences/：先核对记号；不在、不是那一份，就停下来说该放什么。 */
function copyLicence(id: FontSourceId): void {
  const { file, sha256: want } = FONT_SOURCES[id].licence;
  const from = `${CACHE_DIR}/${file}`;
  if (!existsSync(at(from))) throw new Error(`${FONT_SOURCES[id].name} 的许可全文不在：把它放到 ${from}（SHA-256 ${want}；原字体的仓库里和字体同一版的许可文件）`);
  const bytes = readFileSync(at(from));
  if (sha256(bytes) !== want) throw new Error(`${from} 不是要的那一份许可全文（SHA-256 是 ${sha256(bytes)}，应该是 ${want}）`);
  mkdirSync(at(`${LICENCES_DIR}/`), { recursive: true });
  writeFileSync(at(`${LICENCES_DIR}/${file}`), bytes);
}

// ---------------------------------------------------------------- 真的做

describe.skipIf(!MAKING)('做随站的字体（npm run fonts）', () => {
  it('数字、裁剪、读回来查、写进仓库', { timeout: 300_000 }, async () => {
    const say = (line: string): void => console.log(line);
    const trial = env.FONTS_OUT !== undefined && env.FONTS_OUT !== '';
    const outDir = trial ? String(env.FONTS_OUT).replace(/\/+$/, '') : FONTS_DIR;
    if (/^([a-zA-Z]:|\/|\.\.)/.test(outDir)) throw new Error(`FONTS_OUT 要写相对项目根目录的文件夹（如 .cache/fonts-trial），现在是“${outDir}”`);

    // 1 数字
    const plan = planFonts(await readSite());
    for (const file of plan.files) say(`[字体] ${file.name}：${[...file.characters].length} 个字`);
    say(`[字体] 只在 src/ 的程序里出现、content/ 里没有的字（${[...plan.onlyFromSrc].length} 个）：${plan.onlyFromSrc}`);
    if (plan.fallback) say(`[字体] 记在 FALLBACK_OK 里、不进字体、用设备自带的字显示的：${plan.fallback}`);
    const kai = plan.files.find((file) => file.group === 'kai');
    if (!kai) throw new Error('要做的文件里没有楷体的那一个');
    const bad = [...KAI_FORBIDDEN].filter((ch) => kai.characters.includes(ch));
    if (bad.length > 0) throw new Error(`用楷体排的字里有弯引号 ${bad.map((ch) => `“${ch}”（${(kai.where.get(ch) ?? []).join('、')}里）`).join('，')}：这套楷体里它只有三分之一个字宽。换个说法，或者先问一声。`);

    // 2 两个程序库的许可全文
    if (!trial) {
      mkdirSync(at(`${LICENCES_DIR}/`), { recursive: true });
      for (const licence of LIBRARY_LICENCES) {
        const [first, ...rest] = licence.from.map((path) => readFileSync(at(path)));
        for (const other of rest) if (sha256(other) !== sha256(first)) throw new Error(`${licence.from.join('、')} 不再是同一份许可：各放一份，并改 tests/support/fontTool.ts 的 LIBRARY_LICENCES`);
        const target = at(`${LICENCES_DIR}/${licence.file}`);
        if (existsSync(target) && sha256(readFileSync(target)) === sha256(first)) continue;
        writeFileSync(target, first);
        say(`[字体] 许可全文：${LICENCES_DIR}/${licence.file} 照 ${licence.from[0]} 重抄了一份`);
      }
    }

    // 3 已经是新的？
    const made = toolVersions();
    if (!trial && existsSync(at(`${FONTS_DIR}/fonts.json`))) {
      const record = JSON.parse(utf8.decode(readFileSync(at(`${FONTS_DIR}/fonts.json`)))) as FontRecord;
      const fresh = recordIsFresh(plan, record, made);
      // 字体文件：都在，记号和记录里的一样，读出来的名称、提示信息和现在的做法对得上
      const wrong = fresh.fresh ? shippedFileProblems(record, (file) => (existsSync(at(`${FONTS_DIR}/${file}`)) ? readFileSync(at(`${FONTS_DIR}/${file}`)) : null)) : [];
      if (fresh.fresh && wrong.length === 0) {
        // 字体文件是新的。照记录写的另外几样——样式表、给页面用的模块、三份字体的许可全文——要是不在、被改过，
        // 这里照记录重写（许可全文照 .cache/fonts/ 里的那一份重抄）。前两样用不到原字体
        const repaired: string[] = [];
        const texts = writtenFromRecord(record);
        for (const [name, want] of [
          ['fonts.css', texts.css],
          ['shipped.ts', texts.shipped],
        ]) {
          const target = at(`${FONTS_DIR}/${name}`);
          if (existsSync(target) && utf8.decode(readFileSync(target)) === want) continue;
          writeFileSync(target, want);
          repaired.push(`${FONTS_DIR}/${name}`);
        }
        for (const id of FONT_SOURCE_IDS) {
          const { file, sha256: want } = FONT_SOURCES[id].licence;
          const target = at(`${LICENCES_DIR}/${file}`);
          if (existsSync(target) && sha256(readFileSync(target)) === want) continue;
          copyLicence(id);
          repaired.push(`${LICENCES_DIR}/${file}`);
        }
        if (repaired.length === 0) say('[字体] 已经是新的：网站用到的字、原字体、做法都和记录里的一样，什么也没有写。');
        else say(`[字体] 字体文件已经是新的，没有重做；照记录重写了：${repaired.join('、')}。把它们提交。`);
        return;
      }
      say(`[字体] 要重做：${fresh.fresh ? wrong[0] : fresh.why}`);
    }

    // 4、5 读原字体，做文件
    const originals: Record<FontSourceId, Uint8Array> = { sans: readOriginal('sans'), song: readOriginal('song'), kai: readOriginal('kai') };
    const started = performance.now();
    const results: { file: PlannedFile; woff2: Uint8Array; record: FontFileRecord }[] = [];
    for (const file of plan.files) {
      const woff2 = await makeFont(file, originals[file.source]);
      results.push({ file, woff2, record: fileRecord(file, woff2, plan.onlyFromSrc) });
    }
    const seconds = (performance.now() - started) / 1000;

    // 6 读回来查
    const problems: string[] = [];
    for (const { file, woff2, record } of results) {
      const { tables, info } = readWoff2(woff2);
      if (record.characters !== file.characters) {
        const got = new Set(record.characters);
        const want = new Set(file.characters);
        problems.push(`${record.file}：里面的字和要的不一样（少了“${sortedString([...want].filter((ch) => !got.has(ch)))}”，多了“${sortedString([...got].filter((ch) => !want.has(ch)))}”）`);
      }
      problems.push(...fontFileProblems(record, tables));
      // 粗细是原字体的那一种（样式表里这一套的 @font-face 照它写）；“挤标点”的功能：黑体留着 halt，别的一种也没有
      if (record.weight !== FONT_SOURCES[file.source].weight) problems.push(`${record.file}：文件里写的粗细是 ${record.weight}，原字体那一项里写的是 ${FONT_SOURCES[file.source].weight}（tests/support/fontTool.ts 的 FONT_SOURCES）`);
      problems.push(...squeezeProblems(record));
      const outline = info.entries.find((entry) => entry.tag === 'glyf' || entry.tag === 'CFF ')?.origLength ?? 0;
      say(
        `[字体] ${record.file}：${record.count} 个字，${record.glyphs} 个字形，${withCommas(record.bytes)} 字节` +
          `（还原成普通的字体文件是 ${withCommas(info.totalSfntSize)} 字节：字形 ${withCommas(outline)}，别的表 ${withCommas(info.totalSfntSize - outline)}）；粗细 ${record.weight}；留下的排版功能：${record.features.join(' ') || '没有'}`,
      );
    }
    const sizes = fontReport(results.map(({ record }) => ({ file: record.file, bytes: record.bytes, first: record.first, stop: record.stop })));
    for (const line of sizes.lines) say(`[字体] ${line}`);
    for (const warn of sizes.warns) console.warn(`[字体] 快到上限了：${warn}`);
    problems.push(...sizes.fails);
    say(`[字体] ${results.length} 个文件裁剪、压缩用了 ${seconds.toFixed(1)} 秒`);
    if (env.FONTS_COMPARE === '1') {
      for (const { file, record } of results.filter((item) => item.file.source !== 'kai')) {
        const plain = await makeFont(file, originals[file.source], { noHinting: true });
        say(`[字体] 比一比：${record.file} 不留提示信息是 ${withCommas(plain.length)} 字节，留着是 ${withCommas(record.bytes)}（小 ${(100 - (plain.length / record.bytes) * 100).toFixed(1)}%）。没有写。`);
      }
    }
    expect(problems, '做出来的字体不对，什么也没有写').toEqual([]);

    // 7 写
    mkdirSync(at(`${outDir}/`), { recursive: true });
    const record = fontRecord(results.map((item) => item.record), made);
    const texts = writtenFromRecord(record);
    for (const { record: item, woff2 } of results) writeFileSync(at(`${outDir}/${item.file}`), woff2);
    writeFileSync(at(`${outDir}/fonts.css`), texts.css);
    writeFileSync(at(`${outDir}/fonts.json`), recordText(record));
    writeFileSync(at(`${outDir}/shipped.ts`), texts.shipped);
    for (const name of readdirSync(at(`${outDir}/`))) {
      if (/\.woff2$/.test(name) && !record.files.some((item) => item.file === name)) {
        rmSync(at(`${outDir}/${name}`));
        say(`[字体] 删掉了不再要的 ${outDir}/${name}`);
      }
    }
    if (!trial) for (const id of FONT_SOURCE_IDS) copyLicence(id);
    say(`[字体] 写好了：${outDir}/ 里 ${results.length} 个字体文件、fonts.css、fonts.json、shipped.ts${trial ? '（试做，没有动 src/fonts/ 和 public/licences/）' : `；${LICENCES_DIR}/ 里三份字体的许可全文。把变了的文件同改动一起提交`}。`);
  });
});

// ---------------------------------------------------------------- 不用原字体也查得了的

/** 编出来的一位人物、两站。每样东西各用几个不相干的字，好看它们落进了哪一组。 */
function madeUpSite(change: (site: SiteText) => void = () => {}): SiteText {
  const place = { id: 'pl', ancient: '古地', modern: '今地', lngLat: [117, 34] as LngLat };
  const meta = (id: string, title: string, shortTitle: string): StopMeta => ({
    id,
    title,
    shortTitle,
    years: '1–2',
    age: '虚岁三十',
    place,
    camera: { distanceKm: 1, pitch: 0, bearing: 0 },
    summary: '概要',
    status: 'complete',
    localPlaces: [],
  });
  const figure: Figure = {
    id: 'p',
    name: '某人',
    era: '某代',
    years: '1–9',
    tagline: '一句话',
    intro: ['他是谁'],
    overview: { center: [117, 34], distanceKm: 100 },
    stops: [meta('s1', '甲站：头一站', '甲站'), meta('s2', '乙站：后一站', '乙站')],
    legs: [{ from: 's1', to: 's2', via: [] }],
  };
  const content = (stopId: string, over: Partial<StopContent>): StopContent => ({ stopId, notes: [], originals: [], images: [], sources: [], provenance: [], sampleQuestions: [], sections: [], imageUrls: {}, ...over });
  const site: SiteText = {
    sources: {
      // 文件开头带一个 U+FEFF；三种注释里各有一个字；字符串、JSX 里的字、模板字符串、带“//”的网址各一处
      'src/ui/a.tsx': "﻿// 藏一\nexport const A = '串';\n/* 藏二 */\nexport const B = <p>文{/* 藏三 */}</p>;\nexport const C = `模${A}`;\nexport const D = 'https://example.org/址';\n",
      'index.html': "<!-- 藏四 --><p>显</p><script>// 藏五\nvar s = '脚';</script>",
    },
    kaiLabels: ['楷签'],
    sansLabels: ['黑签'],
    cards: [{ id: 'p', name: '某人', era: '某代', years: '1–9', sortYear: 1, tagline: '卡片上的一句', available: true }],
    figures: [
      {
        figure,
        stops: [
          {
            id: 's1',
            content: content('s1', {
              sections: [{ heading: '起初', blocks: [{ type: 'paragraph', segments: [{ text: '午' }, { text: '共', noteId: 'n1' }] }, { type: 'quote', lines: ['引'] }] }],
              sources: [{ id: 'c1', basis: 'record', cite: '酉' }],
              notes: [{ id: 'n1', kind: 'history', anchor: '共', title: '未', body: '申洪荒', sourceIds: ['c1'] }],
              originals: [{ id: 'o1', title: '戌', date: '日', text: '亥', plain: '白', section: '起初', sourceId: 'c1' }],
              images: [{ id: 'i1', file: 'x.jpg', alt: '玄', caption: '天', section: '起初', credit: '地', license: '许', sourceUrl: 'https://example.org/' }],
              provenance: [{ section: '起初', items: [{ what: '黄', basis: 'record', sourceIds: ['c1'] }] }],
              sampleQuestions: ['宇'],
            }),
            scene: null,
          },
          {
            id: 's2',
            content: content('s2', {
              sections: [{ heading: '后来', blocks: [{ type: 'paragraph', segments: [{ text: '宙共荒' }] }] }],
              notes: [{ id: 'n2', kind: 'science', anchor: '宙', title: '辰', body: '宿洪', sourceIds: [] }],
            }),
            scene: null,
          },
        ],
        route: null,
      },
    ],
  };
  change(site);
  return site;
}

/** 校验规则那座合格的全程沙盘小样本（tests/content/fixtures/good/figures/demo/scenes/route.json）。 */
const routeSample = (): RouteScene => JSON.parse(utf8.decode(readFileSync(at('tests/content/fixtures/good/figures/demo/scenes/route.json')))) as RouteScene;

const fileOf = (plan: FontPlan, group: string): PlannedFile => {
  const file = plan.files.find((item) => item.group === group);
  if (!file) throw new Error(`没有 ${group} 这一组`);
  return file;
};
const has = (plan: FontPlan, group: string, chars: string): boolean => [...chars].every((ch) => fileOf(plan, group).characters.includes(ch));
const hasNone = (plan: FontPlan, group: string, chars: string): boolean => [...chars].every((ch) => !fileOf(plan, group).characters.includes(ch));

describe('数字：哪些字归哪一组（编出来的一位人物）', () => {
  it('只有 npm run fonts（--mode fonts，或者 FONTS=1）才真的做', () => {
    // 两头各查一句（不照抄 MAKING 的那一行）：没有要做的时候一定不做（随 npm test 跑就是这样）；--mode fonts 的时候一定做
    if (import.meta.env.MODE !== 'fonts' && env.FONTS !== '1') expect(MAKING).toBe(false);
    if (import.meta.env.MODE === 'fonts') expect(MAKING).toBe(true);
  });

  it('注释去掉，字符串、JSX 里的字、模板字符串留着；网址里的“//”不算注释', () => {
    const code = "// 藏一\nconst a = '串'; /* 藏二 */ const b = <p>文{/* 藏三 */}</p>; const c = `模`; const d = 'https://example.org/址'; // 藏四";
    const kept = stripComments(code);
    expect(kept).toContain('串');
    expect(kept).toContain('文');
    expect(kept).toContain('模');
    expect(kept).toContain('https://example.org/址');
    expect(kept).not.toContain('藏');
    // 字符串里的引号、反斜杠不会把后面的注释放进来
    expect(stripComments("const q = 'it\\'s // 留'; // 藏")).toBe("const q = 'it\\'s // 留'; ");
  });

  it('U+FEFF、换行、制表符这些不算字', () => {
    expect(shippable('﻿甲\n乙\t丙\r\u007f\u0085')).toEqual(['甲', '乙', '丙']);
    expect(sortedString('甲乙丙乙 a')).toBe(' a丙乙甲');
    expect(codeOf('䃜')).toBe('U+40DC');
    expect(codeOf(' ')).toBe('U+0020');
  });

  it('界面的字：程序里原样写着的都算，注释里的不算；index.html 也一样；英文字母、数字、半角符号一个不落', () => {
    const plan = planFonts(madeUpSite());
    expect(has(plan, 'song', '串文模址显脚')).toBe(true);
    expect(hasNone(plan, 'song', '藏')).toBe(true);
    expect(hasNone(plan, 'song-more', '藏')).toBe(true);
    expect(hasNone(plan, 'song', '﻿\n')).toBe(true);
    for (let code = 0x20; code < 0x7f; code++) expect(fileOf(plan, 'song').characters, codeOf(String.fromCodePoint(code))).toContain(String.fromCodePoint(code));
    // 只在程序里出现的字单独记着（英文不列）
    // “的、今、天”三个字编出来的内容里也有，不算只在程序里出现；省略号是工具自己添进楷体那一组的（见下一项），内容里没有
    expect(plan.onlyFromSrc).toBe(sortedString('串文模址显脚楷签黑真位置按史料摆示意点缀…'));
  });

  it('字要点了才看得见的界面文件（“来源”页上的话）：只有它里面有的字归点开才看得见的一组，别处不点就看得见的字还在头一组；不列在名单里就照平常的界面文件算', () => {
    const later = 'src/ui/later.ts';
    const withLater = (): SiteText =>
      madeUpSite((site) => {
        site.sources[later] = "// 藏六\nexport const LATER = '晚串';\n";
      });
    // “串”在 src/ui/a.tsx 里不点就看得见：还在头一组，不重复放。“晚”只有这个文件里有：归点开才看得见的一组
    const plan = planFonts(withLater(), { pressedSources: [later] });
    expect(has(plan, 'song-more', '晚')).toBe(true);
    expect(hasNone(plan, 'song', '晚')).toBe(true);
    expect(has(plan, 'song', '串')).toBe(true);
    expect(hasNone(plan, 'song-more', '串藏')).toBe(true);
    expect(fileOf(plan, 'song-more').where.get('晚')).toEqual([`程序里（${later}）`]);
    // “只在程序里出现的字”那一栏记的是头一组的：不算它
    expect(plan.onlyFromSrc).not.toContain('晚');
    // 没列在名单里：照平常的界面文件算，进头一组
    const plain = planFonts(withLater(), { pressedSources: [] });
    expect(has(plain, 'song', '晚')).toBe(true);
    expect(hasNone(plain, 'song-more', '晚')).toBe(true);
    expect(plain.onlyFromSrc).toContain('晚');
    // 真的名单：“来源”页上的话在里面；列着的都是 src/ 里真有的界面文件（挪了地方、改了名字，这里通不过）
    expect(PRESSED_SOURCES).toContain('src/ui/sourcesText.ts');
    for (const path of PRESSED_SOURCES) {
      expect(isInterfaceSource(path), path).toBe(true);
      expect(sourceFiles(), `${path} 不在 src/ 里了`).toContain(path);
    }
  });

  it('着色器的注释（沙盘程序那两个文件夹里，模板字符串里“//”到行尾）不算字；出错的话、印在控制台里的话照旧算；别的文件夹里不这样', () => {
    // 一段着色器：两行注释，一行程序后面跟着注释；同一个文件里还有一句出错的话、一句带网址的话、一句写在单引号里的话
    const shader = [
      'const GLSL = `',
      'uniform float uTime;',
      '// 藏七：一整行',
      'float f = 1.0; // 藏八',
      '`;',
      'throw new Error(`错${1}话`);',
      "console.warn('[沙盘] 控台 // 留一');",
      'const SITE = `https://example.org/留二`;',
      '',
    ].join('\n');
    const withShader = (path: string): SiteText =>
      madeUpSite((site) => {
        site.sources[path] = shader;
      });
    for (const path of ['src/stage/three/x.ts', 'src/stage/ground/y.ts']) {
      expect(holdsShaders(path), path).toBe(true);
      const plan = planFonts(withShader(path));
      expect(hasNone(plan, 'song', '藏七整行八'), path).toBe(true);
      expect(hasNone(plan, 'song-more', '藏七整行八'), path).toBe(true);
      expect(has(plan, 'song', '错话沙盘控台留一二'), path).toBe(true);
      expect(plan.onlyFromSrc, path).not.toContain('藏');
    }
    // 别的文件夹（界面、沙盘程序的别处）：模板字符串里的字一个不少，和以前一样
    for (const path of ['src/ui/z.ts', 'src/stage/scale.ts', 'src/stage/threex/x.ts']) {
      expect(holdsShaders(path), path).toBe(false);
      expect(has(planFonts(withShader(path)), 'song', '藏七整行八错话留一二'), path).toBe(true);
    }
    // 只动模板字符串里的：程序自己的注释照旧去掉，单引号里的“//”照旧留着，着色器那一行的程序留着，字符串没有被截短
    const kept = stripComments(shader, { shaders: true });
    expect(kept).toContain('uniform float uTime;\n\nfloat f = 1.0; \n`;');
    expect(kept).toContain("'[沙盘] 控台 // 留一'");
    expect(kept).toContain('`https://example.org/留二`');
    expect(stripComments(shader)).toContain('// 藏七：一整行');
    // 真的那两个文件夹都在，里面真有着色器（挪了地方，这里通不过）
    for (const dir of SHADER_DIRS) expect(sourceFiles().some((path) => path.startsWith(dir) && isInterfaceSource(path)), dir).toBe(true);
    const utf8 = new TextDecoder();
    expect(sourceFiles().filter((path) => holdsShaders(path) && /\/\* glsl \*\/ `/.test(utf8.decode(readFileSync(at(path))))).length).toBeGreaterThanOrEqual(2);
  });

  it('替身、开发用的页面、工具做的文件不算界面', () => {
    expect(isInterfaceSource('src/ui/text.ts')).toBe(true);
    expect(isInterfaceSource('src/main.tsx')).toBe(true);
    expect(isInterfaceSource('src/ui/dev/fakeStage.ts')).toBe(false);
    expect(isInterfaceSource('src/stage/dev/harness.ts')).toBe(false);
    expect(isInterfaceSource('src/fonts/shipped.ts')).toBe(false);
    expect(isInterfaceSource('src/styles/base.css')).toBe(false);
    expect(isInterfaceSource('tests/support/fontTool.ts')).toBe(false);
  });

  it('楷体的一组：界面上列着的字、类别名、人物的名字、站名、小节标题、小注的标题、空格', () => {
    const plan = planFonts(madeUpSite());
    expect(has(plan, 'kai', '楷签 真的今天位置按史料摆示意点缀某人甲站：头一乙后起初来未辰')).toBe(true);
    // 正文、卡片上的一句、图片的题记不是楷体
    expect(hasNone(plan, 'kai', '午共引卡片上句地许')).toBe(true);
    // 省略号：哪儿也没写着，工具自己添的。一行楷体的字被截掉时，浏览器在行尾添的那个省略号要有楷体的字形可用
    expect(has(plan, 'kai', '…')).toBe(true);
    expect(fileOf(plan, 'kai').where.get('…')).toEqual(['一行楷体截掉时行尾的省略号']);
    expect(fileOf(plan, 'kai').range).toBe(false);
    expect(fileOf(plan, 'kai').postscript).toBe('YanluKai-Regular');
    expect(fileOf(plan, 'kai').family).toBe('Yanlu Kai');
  });

  it('黑体的一组：界面上列着的字、类别名、人物的名字和年份、站名和时间地点年纪、小节标题、小注的标题、沙盘旁边的小节名和时间、省略号', () => {
    const plan = planFonts(madeUpSite());
    // 界面上列着的、类别名、名字、朝代和年份、站名、每一站的时间、年纪、地点、小节标题、小注的标题、凭据里的小节名、空格
    expect(has(plan, 'sans', '黑签 真的今天位置按史料摆示意点缀某人某代1–9甲站：头一乙后2虚岁三十古地（今）起初来未辰')).toBe(true);
    // 成句的话不是黑体：正文、卡片上的一句、人物页的介绍、目录里的摘要、图片的题记；楷体那张表里的字也不在
    expect(hasNone(plan, 'sans', '午共引卡片句许概要他是谁楷')).toBe(true);
    // 省略号：工具自己添的。黑体的一行被截掉时（沙盘旁边的时间只占一行），行尾的省略号要有黑体的字形可用
    expect(has(plan, 'sans', '…')).toBe(true);
    expect(fileOf(plan, 'sans').where.get('…')).toEqual(['一行黑体截掉时行尾的省略号']);
    const sans = fileOf(plan, 'sans');
    expect({ range: sans.range, first: sans.first, postscript: sans.postscript, family: sans.family, weight: sans.weight }).toEqual({ range: false, first: true, postscript: 'YanluSans-Medium', family: 'Yanlu Sans', weight: 500 });
    expect(fileOf(plan, 'kai').weight).toBe(400);
    expect(fileOf(plan, 'song').weight).toBe(400);
    // 沙盘旁边的小节名和时间：有沙盘的站才有
    const scene = fixtureScene();
    const withTable = planFonts(madeUpSite((site) => (site.figures[0].stops[0].scene = scene)));
    for (const section of scene.sections) {
      expect(has(withTable, 'sans', section.heading), section.heading).toBe(true);
      expect(has(withTable, 'sans', section.date), section.date).toBe(true);
    }
    // 题签上的字不因为是题签就进黑体：只在题签上有的字，黑体那一组里没有
    const onlyOnStrips = [...new Set(scene.strips.flatMap((strip) => shippable(`${strip.text}${strip.modern ?? ''}`)))].filter((ch) => !fileOf(plan, 'sans').characters.includes(ch) && !scene.sections.some((section) => `${section.heading}${section.date}`.includes(ch)));
    expect(onlyOnStrips.length).toBeGreaterThan(0);
    expect(hasNone(withTable, 'sans', onlyOnStrips.join(''))).toBe(true);
  });

  it('哪几个文件在 index.html 里预先声明：现在是头一个宋体文件和楷体；黑体的文件页面的样式还没有用，先不声明；点开才要的不声明', () => {
    const plan = planFonts(madeUpSite());
    expect(plan.files.map((item) => [item.group, item.preload])).toEqual([
      ['sans', false],
      ['song', true],
      ['kai', true],
      ['song-more', false],
    ]);
  });

  it('楷体那一组、黑体那一组的每一个字，头一组宋体里也有一份（那个文件还在路上时先用宋体，不为它去取点开才要的文件）', () => {
    const plan = planFonts(madeUpSite());
    for (const group of ['kai', 'sans']) for (const ch of fileOf(plan, group).characters) expect(fileOf(plan, 'song').characters, `${group} “${ch}”`).toContain(ch);
    // 小注的标题点开才看得见，但它是楷体（黑体里也备着），所以也在头一组里
    expect(has(plan, 'song', '未辰')).toBe(true);
  });

  it('看得见的一组：正文、原文的标题、图片的题记、作者和许可、人物页上的字', () => {
    const plan = planFonts(madeUpSite());
    expect(has(plan, 'song', '午共引宙荒')).toBe(true); // 正文
    expect(has(plan, 'song', '戌')).toBe(true); // 原文的标题
    expect(has(plan, 'song', '天地许')).toBe(true); // 图片的题记、作者、许可
    expect(has(plan, 'song', '某代卡片上的一句话他是谁概要虚岁三十古地（今）')).toBe(true);
    expect(fileOf(plan, 'song').range).toBe(false);
    expect(fileOf(plan, 'song').first).toBe(true);
  });

  it('点开才看得见的一组：小注、原文、凭据、示例问题、图片的 alt；已经在看得见的那一组里的不重复放', () => {
    const plan = planFonts(madeUpSite());
    expect(has(plan, 'song-more', '申洪酉日亥白玄黄宇宿')).toBe(true);
    expect(hasNone(plan, 'song', '申洪酉日亥白玄黄宇宿')).toBe(true);
    // “荒”在甲站的小注里，也在乙站的正文里：算看得见的
    expect(hasNone(plan, 'song-more', '荒共')).toBe(true);
    const both = new Set([...fileOf(plan, 'song').characters, ...fileOf(plan, 'song-more').characters]);
    expect(both.size).toBe([...fileOf(plan, 'song').characters].length + [...fileOf(plan, 'song-more').characters].length);
    expect(fileOf(plan, 'song-more').range).toBe(true);
    expect(fileOf(plan, 'song-more').first).toBe(false);
    expect(plan.files.map((file) => file.name)).toEqual(['yanlu-sans', 'yanlu-song', 'yanlu-kai', 'yanlu-song-more']);
    expect(plan.files.map((file) => file.postscript)).toEqual(['YanluSans-Medium', 'YanluSong-Regular', 'YanluKai-Regular', 'YanluSongMore-Regular']);
    expect(plan.files.map((file) => file.source)).toEqual(['sans', 'song', 'kai', 'song']);
  });

  it('一个字从小注挪进正文：从点开才看得见的那一组挪到看得见的那一组', () => {
    expect(has(planFonts(madeUpSite()), 'song-more', '申')).toBe(true);
    const moved = planFonts(
      madeUpSite((site) => {
        const story = site.figures[0].stops[0].content?.sections[0].blocks[0];
        if (story?.type === 'paragraph') story.segments.push({ text: '申' });
      }),
    );
    expect(has(moved, 'song', '申')).toBe(true);
    expect(hasNone(moved, 'song-more', '申')).toBe(true);
  });

  it('有沙盘的站：题签上的字、小节名是楷体；题记是一句话，是宋体，不进楷体也不进黑体；沙盘旁边别的字看得见；“说明”展开的、“沙盘上的东西”一栏点开才看得见', () => {
    const scene = fixtureScene();
    const plan = planFonts(
      madeUpSite((site) => {
        site.figures[0].stops[0].scene = scene;
        const first = site.figures[0].stops[0].content;
        if (first) first.sources = fixtureSources();
      }),
    );
    for (const strip of scene.strips) {
      expect(has(plan, 'kai', strip.text), strip.text).toBe(true);
      if (strip.modern) expect(has(plan, 'kai', strip.modern), strip.modern).toBe(true);
    }
    for (const section of scene.sections) {
      expect(has(plan, 'kai', section.heading)).toBe(true);
      expect(has(plan, 'song', section.line)).toBe(true);
      expect(has(plan, 'song', section.date)).toBe(true);
      // 小节名和时间在黑体的文件里也备着
      expect(has(plan, 'sans', section.heading)).toBe(true);
      expect(has(plan, 'sans', section.date)).toBe(true);
    }
    // 只在题记里有的字（题签、小节名、别的楷体和黑体的字里都没有）：楷体那一组、黑体那一组里都没有它
    const bare = planFonts(madeUpSite());
    const elsewhere = new Set([...fileOf(bare, 'kai').characters, ...fileOf(bare, 'sans').characters, ...scene.strips.flatMap((strip) => shippable(`${strip.text}${strip.modern ?? ''}`)), ...scene.sections.flatMap((section) => shippable(`${section.heading}${section.date}`))]);
    const onlyInLines = [...new Set(scene.sections.flatMap((section) => shippable(section.line)))].filter((ch) => !elsewhere.has(ch));
    expect(onlyInLines.length, '那座小沙盘的题记里要有别处没有的字，这一句才查得到东西').toBeGreaterThan(0);
    expect(hasNone(plan, 'kai', onlyInLines.join(''))).toBe(true);
    expect(hasNone(plan, 'sans', onlyInLines.join(''))).toBe(true);
    // 远处的那句话印在沙盘旁边：看得见
    expect(has(plan, 'song', scene.far[0].gloss ?? '')).toBe(true);
    // “沙盘上的东西”一栏里的字，在两组宋体里总有一份
    const all = new Set([...fileOf(plan, 'song').characters, ...fileOf(plan, 'song-more').characters]);
    for (const text of [...scene.credits, ...scene.notDrawn.map((item) => item.why), ...scene.things.map((thing) => thing.basis)]) for (const ch of shippable(text)) expect(all.has(ch), `“${ch}”`).toBe(true);
    // 用了谁的数据那一行只在这一栏里：有它自己才有的字时，那个字在点开才看得见的一组里
    const onlyInCredits = shippable(scene.credits.join('')).filter((ch) => !fileOf(plan, 'song').characters.includes(ch));
    for (const ch of onlyInCredits) expect(fileOf(plan, 'song-more').characters).toContain(ch);
  });

  it('正文还没写、沙盘先做好的站：出处在场景文件自己的 sources 里，书名在点开才看得见的一组里；小节名照样是楷体，题记照样是宋体', () => {
    const scene = fixtureScene();
    // 那座小沙盘的出处 id 不变，书名换成别处都没有的三个字
    const marks = ['鼍', '鼋', '鳌'];
    scene.sources = fixtureSources().map((source, i) => ({ ...source, cite: marks[i % marks.length] }));
    const used = new Set([...scene.things, ...scene.places, ...scene.far, ...scene.dressing].flatMap((item) => item.sourceIds));
    const cited = scene.sources.filter((source) => used.has(source.id)).map((source) => source.cite);
    expect(cited.length).toBeGreaterThan(0);
    const plan = planFonts(
      madeUpSite((site) => {
        site.figures[0].figure.stops[0].status = 'outline';
        site.figures[0].stops[0] = { id: 's1', content: null, scene };
      }),
    );
    for (const cite of cited) {
      expect(has(plan, 'song-more', cite), cite).toBe(true);
      expect(hasNone(plan, 'song', cite), cite).toBe(true);
    }
    for (const section of scene.sections) {
      expect(has(plan, 'kai', section.heading)).toBe(true);
      expect(has(plan, 'song', section.line)).toBe(true);
    }
    // 场景里不写 sources 的时候（写好了正文的站），这几个字哪一组里都没有
    const bare = planFonts(
      madeUpSite((site) => {
        site.figures[0].stops[0] = { id: 's1', content: null, scene: fixtureScene() };
      }),
    );
    for (const cite of cited) expect(hasNone(bare, 'song-more', cite), cite).toBe(true);
  });

  it('全程沙盘（人物页上的那一座）：题签的古名今名、小节名是楷体，站名的题签脚上的印也是；题记、时间、那一句说明、远处的那句话看得见（宋体）；“说明”展开的、“沙盘上的东西”点开才看得见', () => {
    const route = routeSample();
    const plan = planFonts(madeUpSite((site) => (site.figures[0].route = route)));
    for (const strip of route.strips) {
      expect(has(plan, 'kai', strip.text), strip.text).toBe(true);
      if (strip.modern) expect(has(plan, 'kai', strip.modern), strip.modern).toBe(true);
    }
    for (const section of route.sections) {
      expect(has(plan, 'kai', section.heading)).toBe(true);
      expect(has(plan, 'song', section.line)).toBe(true);
      expect(has(plan, 'song', section.date)).toBe(true);
      expect(has(plan, 'sans', section.heading)).toBe(true);
      expect(has(plan, 'sans', section.date)).toBe(true);
    }
    // 站名的题签脚上写着第几站的印：印上的字（一、二……）是楷体的，照页面拼印的那个函数数；这位编出来的人物有两站
    expect(has(plan, 'kai', '一二')).toBe(true);
    expect(fileOf(plan, 'kai').where.get('二')).toEqual(['某人的人物页（全程沙盘的印）']);
    // 常印着的那一句（示意的东西的名字，一截路的名字也在里面）和远处的那句话：看得见
    expect(has(plan, 'song', '南溪、新渠、镜湖的西南角等 7 样是示意；平地抹平；山高夸大 12 到 25 倍；河和路都画宽了')).toBe(true);
    expect(has(plan, 'song', '示例五年溪口到东港的水路')).toBe(true);
    expect(has(plan, 'song', `北都：往北约 80 公里（${route.far[0].gloss}）`)).toBe(true);
    // “说明”展开的每一句、“沙盘上的东西”一栏（依据、出处的写法、没有画的、用了谁的数据），在两组宋体里总有一份
    const all = new Set([...fileOf(plan, 'song').characters, ...fileOf(plan, 'song-more').characters]);
    const pressed = [
      route.terrain.recipe.note,
      route.water.coast.note,
      ...route.roads.journeys.flatMap((journey) => journey.parts.flatMap((part) => [part.note, part.basis, part.name])),
      ...route.water.rivers.map((river) => river.basis),
      route.water.lakes[0].except?.basis,
      ...route.sources.map((source) => source.cite),
      ...route.notDrawn.map((item) => item.why),
      ...route.credits,
    ];
    for (const text of pressed) for (const ch of shippable(text ?? '')) expect(all.has(ch), `“${ch}”（${text}）`).toBe(true);
    // 只在依据里有的字归点开才看得见的一组，不进一打开就下载的那个文件
    const onlyPressed = [...new Set(shippable(route.water.rivers.map((river) => river.basis).join('')))].filter((ch) => !fileOf(plan, 'song').characters.includes(ch));
    expect(onlyPressed.length).toBeGreaterThan(0);
    for (const ch of onlyPressed) expect(fileOf(plan, 'song-more').characters).toContain(ch);
    // 没有全程沙盘的时候，这些字一个也不在；用在哪写的是人物页
    const without = planFonts(madeUpSite());
    expect(hasNone(without, 'kai', '镜湖')).toBe(true);
    // 没有全程沙盘就没有印：“二”哪儿也不用楷体写
    expect(hasNone(without, 'kai', '二')).toBe(true);
    expect(fileOf(plan, 'kai').where.get('镜')).toEqual(['某人的人物页（全程沙盘的题签）']);
    expect(fileOf(plan, 'song').where.get('抹')).toEqual(['某人的人物页（全程沙盘的沙盘）']);
  });

  it('全程沙盘的字归大家共用的文件（它摆在人物页上），按站拆开的时候也不归哪一站', () => {
    const route = routeSample();
    const split = planFonts(madeUpSite((site) => (site.figures[0].route = route)), { splitByStop: true });
    const same = planFonts(madeUpSite(), { splitByStop: true });
    expect(split.files.map((file) => file.group)).toEqual(same.files.map((file) => file.group));
    expect(has(split, 'song', '镜湖抹')).toBe(true);
    // 一站自己的文件里一个字也没有多：只会少（原来只有这一站用的字，全程沙盘也用了，就挪进大家共用的文件）
    for (const file of split.files.filter((item) => item.stop !== null)) for (const ch of file.characters) expect(fileOf(same, file.group).characters, `${file.name} “${ch}”`).toContain(ch);
    const moved = [...fileOf(same, 'song-s2').characters].filter((ch) => !fileOf(split, 'song-s2').characters.includes(ch)).join('');
    expect(has(split, 'song', moved)).toBe(true);
  });

  it('记在“用设备自带的字显示”里的字不进字体，另外报出来', () => {
    const plan = planFonts(madeUpSite(), { fallbackOk: { 午: '试一试' } });
    expect(plan.fallback).toBe('午');
    for (const file of plan.files) expect(file.characters).not.toContain('午');
    expect(planFonts(madeUpSite()).fallback).toBe('');
  });

  it('每个字记着用在哪（给“哪个字不在字体里”那句话用）', () => {
    const plan = planFonts(madeUpSite());
    expect(fileOf(plan, 'song-more').where.get('亥')).toEqual(['甲站的原文']);
    expect(fileOf(plan, 'song').where.get('午')).toEqual(['甲站的正文']);
    expect(fileOf(plan, 'song').where.get('串')).toEqual(['程序里（src/ui/a.tsx）']);
    expect(fileOf(plan, 'kai').where.get('楷')).toEqual(['界面上用楷体排的字']);
    expect(fileOf(plan, 'sans').where.get('黑')).toEqual(['界面上用黑体排的字']);
  });
});

describe('数字：宋体按站拆开（现在关着，规矩先写好）', () => {
  const plan = planFonts(madeUpSite(), { splitByStop: true });

  it('文件：黑体和楷体各一个，宋体大家共用的两个、每一站自己的两个；只有黑体、头一个宋体文件和楷体不带 unicode-range', () => {
    expect(plan.files.map((file) => file.name)).toEqual(['yanlu-sans', 'yanlu-song', 'yanlu-kai', 'yanlu-song-s1', 'yanlu-song-s2', 'yanlu-song-more', 'yanlu-song-s1-more', 'yanlu-song-s2-more']);
    expect(plan.files.filter((file) => !file.range).map((file) => file.name)).toEqual(['yanlu-sans', 'yanlu-song', 'yanlu-kai']);
    expect(fileOf(plan, 'song-s1').postscript).toBe('YanluSongS1-Regular');
    expect(fileOf(plan, 'song-s1-more').postscript).toBe('YanluSongS1More-Regular');
    expect(plan.files.map((file) => file.stop)).toEqual([null, null, null, 's1', 's2', null, 's1', 's2']);
    expect(plan.files.map((file) => file.first)).toEqual([true, true, true, true, true, false, false, false]);
    // 带 unicode-range 的文件没法在 index.html 里预先声明（它只有一份）：一站自己的文件都不声明
    expect(plan.files.map((file) => file.preload)).toEqual([false, true, true, false, false, false, false, false]);
  });

  it('两站都用到的字归大家共用的文件：有一处看得见就归头一个，都要点开才归后一个', () => {
    expect(has(plan, 'song', '共')).toBe(true); // 两站的正文里都有
    expect(has(plan, 'song', '荒')).toBe(true); // 甲站的小注、乙站的正文
    expect(has(plan, 'song-more', '洪')).toBe(true); // 两站的小注里都有
  });

  it('只有一站用到的字归这一站自己的文件：看得见的一个，点开才看得见的一个', () => {
    expect(has(plan, 'song-s1', '午引戌许起初未')).toBe(true);
    expect(has(plan, 'song-s2', '宙来辰')).toBe(true);
    expect(has(plan, 'song-s1-more', '申酉日亥白玄黄宇')).toBe(true);
    expect(has(plan, 'song-s2-more', '宿')).toBe(true);
    // 界面、首页、人物页用到的字归大家共用的
    expect(has(plan, 'song', '串文模址显脚某代卡片')).toBe(true);
  });

  it('一个字只有一个去处；拆开以后的字合起来，和不拆的时候一样', () => {
    const songFiles = plan.files.filter((file) => file.source === 'song');
    const all = songFiles.flatMap((file) => [...file.characters]);
    expect(new Set(all).size).toBe(all.length);
    const whole = planFonts(madeUpSite());
    expect(sortedString(all)).toBe(sortedString([...fileOf(whole, 'song').characters, ...fileOf(whole, 'song-more').characters]));
    expect(fileOf(plan, 'kai').characters).toBe(fileOf(whole, 'kai').characters);
    expect(fileOf(plan, 'sans').characters).toBe(fileOf(whole, 'sans').characters);
  });

  it('哪几个文件有了才算数：楷体的字只认楷体的文件，黑体的字只认黑体的文件；一站看得见的字认它自己的文件和大家共用的头一个；点开才看得见的多认两个', () => {
    expect(servedBy(fileOf(plan, 'kai'))).toEqual(['yanlu-kai']);
    expect(servedBy(fileOf(plan, 'sans'))).toEqual(['yanlu-sans']);
    expect(servedBy(fileOf(plan, 'song'))).toEqual(['yanlu-song']);
    expect(servedBy(fileOf(plan, 'song-s1'))).toEqual(['yanlu-song-s1', 'yanlu-song']);
    expect(servedBy(fileOf(plan, 'song-more'))).toEqual(['yanlu-song-more', 'yanlu-song']);
    expect(servedBy(fileOf(plan, 'song-s1-more'))).toEqual(['yanlu-song-s1-more', 'yanlu-song-s1', 'yanlu-song', 'yanlu-song-more']);
  });
});

describe('样式表、给页面用的模块、名称', () => {
  it('样式表：每个文件一条，粗细是这套字体自己的那一种（黑体 500，别的 400）；不带 unicode-range 的在前；带的那一条逐个列着它的字', () => {
    const css = fontsCss([
      { name: 'yanlu-sans', family: 'Yanlu Sans', weight: 500, range: false, characters: '丁' },
      { name: 'yanlu-song', family: 'Yanlu Song', weight: 400, range: false, characters: 'a乙' },
      { name: 'yanlu-kai', family: 'Yanlu Kai', weight: 400, range: false, characters: '甲' },
      { name: 'yanlu-song-more', family: 'Yanlu Song', weight: 400, range: true, characters: '丙䃜\u{2A6A5}' },
    ]);
    expect(css.match(/@font-face/g)).toHaveLength(4);
    expect(css.match(/unicode-range:/g)).toHaveLength(1);
    expect(css).toContain("src: url('./yanlu-song-more.woff2') format('woff2');");
    expect(css).toContain('unicode-range: U+4E19, U+40DC, U+2A6A5;');
    expect(css.match(/font-display: swap;/g)).toHaveLength(4);
    expect(css.match(/font-weight: 400;/g)).toHaveLength(3);
    expect(css.match(/font-weight: 500;/g)).toHaveLength(1);
    // 500 写在黑体那一条里
    expect(css.split('@font-face').find((rule) => rule.includes('yanlu-sans.woff2'))).toContain('font-weight: 500;');
    expect(css.indexOf('yanlu-song.woff2')).toBeLessThan(css.indexOf('yanlu-song-more.woff2'));
    expect(css.endsWith('}\n')).toBe(true);
    expect(css).not.toContain('\r');
  });

  it('给页面用的模块：三套字体各一项（黑体、宋体、楷体，照这个先后），和点开才要的那个文件里的一个字', () => {
    const text = shippedTs('丑');
    expect(text).toContain("export const SONG_MORE_PROBE = '丑';");
    expect(text).toContain("sans: { family: 'Yanlu Sans', name: 'Noto Sans SC Medium', version: '2.004', site: 'https://github.com/notofonts/noto-cjk', licence: 'licences/noto-sans-cjk-OFL.txt' },");
    expect(Array.from(text.matchAll(/^ {2}(\w+): \{ family:/gm), (match) => match[1])).toEqual(['sans', 'song', 'kai']);
    expect(text).toContain("kai: { family: 'Yanlu Kai', name: 'LXGW WenKai GB', version: '1.530', site: 'https://github.com/lxgw/LxgwWenkaiGB', licence: 'licences/lxgw-wenkai-gb-OFL.txt' },");
    expect(text).toContain("song: { family: 'Yanlu Song', name: 'Noto Serif SC', version: '2.003', site: 'https://github.com/notofonts/noto-cjk', licence: 'licences/noto-serif-cjk-OFL.txt' },");
  });

  it('文件名对应的 PostScript 名称', () => {
    expect(postscriptName('yanlu-kai')).toBe('YanluKai-Regular');
    expect(postscriptName('yanlu-song-more')).toBe('YanluSongMore-Regular');
    expect(postscriptName('yanlu-song-xuzhou-more')).toBe('YanluSongXuzhouMore-Regular');
    // 粗细是 500 的那一套（黑体）结尾写 Medium；不说粗细就是 400
    expect(postscriptName('yanlu-sans', 500)).toBe('YanluSans-Medium');
    expect(postscriptName('yanlu-sans', 400)).toBe('YanluSans-Regular');
  });
});

// ---------------------------------------------------------------- 换名称表

/** 做一张名称表，条目可以是别的平台、别的语言的（原字体里就有中文的条目）。 */
function rawNameTable(records: { platform: number; lang: number; nameId: number; text: string }[]): Uint8Array {
  const blobs = records.map(({ platform, text }) =>
    platform === 1 ? Uint8Array.from(text, (ch) => ch.charCodeAt(0)) : Uint8Array.from([...text].flatMap((ch) => Array.from({ length: ch.length }, (_, i) => [ch.charCodeAt(i) >> 8, ch.charCodeAt(i) & 0xff]).flat())),
  );
  const head = 6 + 12 * records.length;
  const out = new Uint8Array(head + blobs.reduce((sum, blob) => sum + blob.length, 0));
  const v = new DataView(out.buffer);
  v.setUint16(2, records.length);
  v.setUint16(4, head);
  let offset = 0;
  records.forEach((record, i) => {
    const p = 6 + i * 12;
    v.setUint16(p, record.platform);
    v.setUint16(p + 2, record.platform === 1 ? 0 : 1);
    v.setUint16(p + 4, record.lang);
    v.setUint16(p + 6, record.nameId);
    v.setUint16(p + 8, blobs[i].length);
    v.setUint16(p + 10, offset);
    out.set(blobs[i], head + offset);
    offset += blobs[i].length;
  });
  return out;
}

/** 拼一个最简单的字体文件：几张表，目录里的校验和都先空着（renameSfnt 会重新算）。表在文件里照给的先后放。 */
function rawSfnt(tables: [string, Uint8Array][]): Uint8Array {
  let end = 12 + tables.length * 16;
  const placed = tables.map(([tag, data]) => {
    const offset = end;
    end += (data.length + 3) & ~3;
    return { tag, data, offset };
  });
  const out = new Uint8Array(end);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x00010000);
  v.setUint16(4, tables.length);
  [...placed]
    .sort((a, b) => (a.tag < b.tag ? -1 : 1))
    .forEach((entry, i) => {
      const d = 12 + i * 16;
      for (let k = 0; k < 4; k++) out[d + k] = entry.tag.charCodeAt(k);
      v.setUint32(d + 8, entry.offset);
      v.setUint32(d + 12, entry.data.length);
      out.set(entry.data, entry.offset);
    });
  return out;
}

describe('给字体换名称表', () => {
  /** 一个编出来的“原字体”：名称表里有英文的、中文的、Mac 平台的条目，还有写着保留名字的几条。 */
  const original = (): Uint8Array =>
    rawSfnt([
      ['head', new Uint8Array(54).fill(7)],
      ['maxp', Uint8Array.from([0, 0, 0x50, 0, 0, 9])],
      [
        'name',
        rawNameTable([
          { platform: 1, lang: 0, nameId: 1, text: 'LXGW WenKai GB' },
          { platform: 3, lang: 0x409, nameId: 0, text: FONT_SOURCES.kai.copyright },
          { platform: 3, lang: 0x409, nameId: 1, text: 'LXGW WenKai GB' },
          { platform: 3, lang: 0x409, nameId: 2, text: 'Regular' },
          { platform: 3, lang: 0x409, nameId: 3, text: 'LXGW WenKai GB:Version 1.530' },
          { platform: 3, lang: 0x409, nameId: 4, text: 'LXGW WenKai GB Regular' },
          { platform: 3, lang: 0x409, nameId: 5, text: 'Version 1.530; October 18, 2026' },
          { platform: 3, lang: 0x409, nameId: 6, text: 'LXGWWenKaiGB-Regular' },
          { platform: 3, lang: 0x409, nameId: 8, text: 'LXGW' },
          { platform: 3, lang: 0x409, nameId: 9, text: 'LXGW; Fontworks Inc.' },
          { platform: 3, lang: 0x409, nameId: 10, text: 'About the original.' },
          { platform: 3, lang: 0x409, nameId: 11, text: 'https://example.org/' },
          { platform: 3, lang: 0x409, nameId: 13, text: 'This Font Software is licensed under the SIL Open Font License, Version 1.1.' },
          { platform: 3, lang: 0x409, nameId: 14, text: 'https://openfontlicense.org' },
          { platform: 3, lang: 0x409, nameId: 16, text: 'LXGW WenKai GB' },
          { platform: 3, lang: 0x804, nameId: 1, text: '霞鹜文楷 GB' },
          { platform: 3, lang: 0x804, nameId: 2, text: 'Regular' },
        ]),
      ],
      ['OS/2', Uint8Array.from([1, 2, 3, 4, 5, 6, 7])], // 长度不是四的倍数：看补齐
      ['cmap', Uint8Array.from([9, 9, 9, 9, 9])],
    ]);
  const file = { source: 'kai', family: 'Yanlu Kai', postscript: 'YanluKai-Regular' } as const;

  it('要写的几条：版权、版本、许可照抄原字体的；名称是自己的；谁做的、谁设计的并进说明里', () => {
    const records = nameRecordsFor(file, readSfnt(original()).tables);
    const by = new Map(records.map((record) => [record.nameId, record.text]));
    expect([...by.keys()]).toEqual([0, 1, 2, 3, 4, 5, 6, 10, 13, 14]); // 这个“原字体”没有第 7 条（商标）
    expect(by.get(0)).toBe(FONT_SOURCES.kai.copyright);
    expect(by.get(1)).toBe('Yanlu Kai');
    expect(by.get(2)).toBe('Regular');
    expect(by.get(3)).toBe('YanluKai-Regular;1.530;subset');
    expect(by.get(4)).toBe('Yanlu Kai');
    expect(by.get(5)).toBe('Version 1.530; October 18, 2026; subset');
    expect(by.get(6)).toBe('YanluKai-Regular');
    expect(by.get(10)).toBe('Subset of LXGW WenKai GB Regular 1.530 (https://github.com/lxgw/LxgwWenkaiGB) with only the characters one website uses. Not the original font. Manufacturer: LXGW. Designer: LXGW; Fontworks Inc.');
    expect(subsetSentence(FONT_SOURCES.kai)).toBe('Subset of LXGW WenKai GB Regular 1.530 (https://github.com/lxgw/LxgwWenkaiGB) with only the characters one website uses. Not the original font.');
    expect(by.get(13)).toBe('This Font Software is licensed under the SIL Open Font License, Version 1.1.');
    expect(by.get(14)).toBe('https://openfontlicense.org');
    for (const id of by.keys()) expect(NAME_IDS as readonly number[]).toContain(id);
  });

  it('原字体自己的说明（第 10 条）：宋体和黑体的接在说明那一条的后面，楷体的不接；黑体的标识和 PostScript 名称写的是 Medium', () => {
    const tables = readSfnt(original()).tables;
    const tenth = (source: 'kai' | 'song' | 'sans', postscript: string): string => new Map(nameRecordsFor({ source, family: FONT_SOURCES[source].family, postscript }, tables).map((record) => [record.nameId, record.text])).get(10) ?? '';
    expect(tenth('kai', 'YanluKai-Regular')).not.toContain('About the original.');
    expect(tenth('song', 'YanluSong-Regular').endsWith(' About the original.')).toBe(true);
    expect(tenth('sans', 'YanluSans-Medium')).toBe(`${subsetSentence(FONT_SOURCES.sans)} Manufacturer: LXGW. Designer: LXGW; Fontworks Inc. About the original.`);
    const sans = new Map(nameRecordsFor({ source: 'sans', family: 'Yanlu Sans', postscript: 'YanluSans-Medium' }, tables).map((record) => [record.nameId, record.text]));
    expect([sans.get(1), sans.get(2), sans.get(3), sans.get(4), sans.get(6)]).toEqual(['Yanlu Sans', 'Regular', 'YanluSans-Medium;2.004;subset', 'Yanlu Sans', 'YanluSans-Medium']);
  });

  it('换好的字体读回来：名称表里正好是那几条，都是 Windows 英文的；校验和都对；别的表一个字节没动', () => {
    const before = original();
    const tables = readSfnt(before).tables;
    const records = nameRecordsFor(file, tables);
    const after = renameSfnt(before, records);
    expect(checkSfnt(after)).toEqual([]);
    const read = readSfnt(after);
    expect(read.flavor).toBe('\u0000\u0001\u0000\u0000');
    expect(namesOf(read.tables).map((n) => [n.platform, n.lang, n.nameId, n.text])).toEqual(records.map((record) => [3, 0x409, record.nameId, record.text]));
    expect(englishName(read.tables, 1)).toBe('Yanlu Kai');
    expect(englishName(read.tables, 16)).toBeUndefined();
    for (const tag of ['maxp', 'OS/2', 'cmap']) expect([...(read.tables.get(tag) ?? [])], tag).toEqual([...(tables.get(tag) ?? [])]);
    expect(glyphCountOf(read.tables)).toBe(9);
    // head 表只有整个文件的校验数那四个字节变了
    const head = [...(read.tables.get('head') ?? [])];
    expect(head.slice(0, 8)).toEqual(new Array(8).fill(7));
    expect(head.slice(12)).toEqual(new Array(42).fill(7));
    // 查得出错：改一个字节，校验和就不对了
    const broken = new Uint8Array(after);
    broken[broken.length - 1] ^= 0xff;
    expect(checkSfnt(broken).length).toBeGreaterThan(0);
    // 编出来的“原字体”目录里的校验和是空着的：查得出来
    expect(checkSfnt(before).length).toBeGreaterThan(0);
    expect(fontFileProblems({ file: 'x.woff2', ...file }, read.tables).filter((line) => !line.includes('vhea') && !line.includes('vmtx'))).toEqual([]);
    // 说明那一条的头一句换了写法（做法改了，文件还是旧的）：查得出来
    const reworded = renameSfnt(before, records.map((record) => (record.nameId === 10 ? { nameId: 10, text: record.text.replace('Subset of', 'A subset of') } : record)));
    expect(fontFileProblems({ file: 'x.woff2', ...file }, readSfnt(reworded).tables).filter((line) => line.includes('第 10 条'))).toHaveLength(1);
  });

  it('一个真的小字体（裁剪工具自带的样本）：读得出来，校验和是对的；换了名称表以后还是对的，字没有变', () => {
    // 这两个样本是 fontverter 这个库自己带的（它是跟着 subset-font 装进来的）。用它，是因为校验和怎么算要拿一个别人做的
    // 字体来对，自己拼的字体对不出来。哪一版的 fontverter 不带样本了，这里说清楚，不让人对着“找不到文件”猜：
    // 那时把这一项改成读别的现成的字体。（换 fontverter 的版本本来也要重做字体：记录里记着它的版本。）
    for (const sample of ['Roboto-400.ttf', 'Roboto-400.woff2']) {
      expect(existsSync(at(`node_modules/fontverter/testdata/${sample}`)), `这一项借用 fontverter 自带的样本字体 testdata/${sample}，装着的这一版里没有它了：换一个别人做的小字体来对（不要改成自己拼的）`).toBe(true);
    }
    const roboto = readFileSync(at('node_modules/fontverter/testdata/Roboto-400.ttf'));
    const untouched = sha256(roboto);
    expect(checkSfnt(roboto)).toEqual([]);
    const { tables } = readSfnt(roboto);
    const characters = charactersOf(tables);
    expect(characters.length).toBeGreaterThan(0);
    const after = renameSfnt(roboto, [
      { nameId: 1, text: 'Yanlu Kai' },
      { nameId: 6, text: 'YanluKai-Regular' },
    ]);
    expect(checkSfnt(after)).toEqual([]);
    const read = readSfnt(after).tables;
    expect(namesOf(read).map((n) => [n.nameId, n.text])).toEqual([
      [1, 'Yanlu Kai'],
      [6, 'YanluKai-Regular'],
    ]);
    expect(charactersOf(read)).toBe(characters);
    expect([...cmapOf(read)]).toEqual([...cmapOf(tables)]);
    // 查和换都不改交进来的字节（从磁盘读来的那一份后面还要用）
    expect(sha256(roboto)).toBe(untouched);
    // 同一处另有一个 WOFF2 的样本（字多一些的另一份 Roboto）：照 WOFF2 的读法读得出来——目录里各张表的长度加起来
    // 正好是解开以后的长度，字形那张表是变换过的（楷体的文件也是这样），字和名称读得出来
    const woff2Bytes = readFileSync(at('node_modules/fontverter/testdata/Roboto-400.woff2'));
    const woff2 = readWoff2(woff2Bytes);
    expect(woff2.info.length).toBe(woff2Bytes.length);
    expect(woff2.info.sumOfLengths).toBe(woff2.info.streamLength);
    expect(woff2.info.entries.find((entry) => entry.tag === 'glyf')?.transformLength).toBeGreaterThan(0);
    expect(charactersOf(woff2.tables)).toContain('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    expect(englishName(woff2.tables, 1)).toBe('Roboto');
    expect(() => readWoff2(roboto)).toThrow('这不是一个 WOFF2 文件');
  });

  it('名称不对的字体查得出来：留着原字体的名字、多了一条、少了竖排的表', () => {
    const tables = readSfnt(original()).tables;
    const problems = fontFileProblems({ file: 'x.woff2', ...file }, tables);
    expect(problems.some((line) => line.includes('不是 Windows 英文的'))).toBe(true);
    expect(problems.some((line) => line.includes('第 1 条') && line.includes('Yanlu Kai'))).toBe(true);
    expect(problems.some((line) => line.includes('保留的名字“LXGW”'))).toBe(true);
    expect(problems.some((line) => line.includes('多了第 16 条'))).toBe(true);
    expect(problems.some((line) => line.includes('没有 vhea'))).toBe(true);
    expect(problems.some((line) => line.includes('没有 vmtx'))).toBe(true);
  });
});

// ---------------------------------------------------------------- 留没留提示信息

/**
 * 拼一张最小的 CFF 表：表头、名字、最上面的字典、两张空的索引，后面是私有字典。privates 是每一本私有字典的字节。
 * grouped 是 false：最上面的字典直接指着一本私有字典（字少的字体）；true：它指着一张“分组”的索引，每组各指一本（宋体是这样）。
 */
function tinyCff(privates: number[][], grouped: boolean): Uint8Array {
  const index = (items: number[][]): number[] => {
    if (items.length === 0) return [0, 0];
    const offsets = [1];
    for (const item of items) offsets.push(offsets[offsets.length - 1] + item.length);
    return [0, items.length, 1, ...offsets, ...items.flat()];
  };
  /** 一个数，写成五个字节的那一种（长度固定，好算位置）。 */
  const int = (n: number): number[] => [29, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const pointer = (size: number, offset: number): number[] => [...int(size), ...int(offset), 18];
  const header = [1, 0, 4, 1];
  const names = index([[0x41]]);
  const topLength = grouped ? 7 : 11;
  const afterTop = header.length + names.length + (2 + 1 + 2 + topLength) + 2 + 2;
  const groupsLength = grouped ? 2 + 1 + (privates.length + 1) + privates.length * 11 : 0;
  let at = afterTop + groupsLength;
  const pointers = privates.map((dict) => {
    const here = pointer(dict.length, at);
    at += dict.length;
    return here;
  });
  const top = index([grouped ? [...int(afterTop), 12, 36] : pointers[0]]);
  return Uint8Array.from([...header, ...names, ...top, ...index([]), ...index([]), ...(grouped ? index(pointers) : []), ...privates.flat()]);
}

describe('文件里留没留提示信息（从文件里读，不是照规矩猜）', () => {
  // 私有字典里的几样。数 0 到 107 写成一个字节（数 + 139）。
  const BLUE_VALUES = [139, 149, 6]; // 0 10 BlueValues
  const STD_HW = [189, 10]; // 50 StdHW
  const STEM_SNAP_H = [189, 199, 12, 12]; // 50 60 StemSnapH（两个字节的记号）
  const WIDTHS = [239, 20, 239, 21]; // defaultWidthX、nominalWidthX：和提示信息无关，裁剪时不留提示信息它们也在
  const BLUE_SCALE = [30, 0x0a, 0x03, 0x96, 0x25, 0xff, 12, 9]; // 一个带小数的数（0.039625）：读得过去

  it('带 CFF 的字体：私有字典里有 BlueValues、StdHW、StemSnapH 这些数就是留着；只剩字宽的就是没留', () => {
    const tables = (privates: number[][], grouped: boolean) => new Map([['CFF ', tinyCff(privates, grouped)]]);
    expect(hintingOf(tables([[...BLUE_VALUES, ...STD_HW, ...WIDTHS]], false))).toBe('kept');
    expect(hintingOf(tables([[...STEM_SNAP_H, ...WIDTHS]], false))).toBe('kept');
    expect(hintingOf(tables([WIDTHS], false))).toBe('none');
    expect(hintingOf(tables([[...BLUE_SCALE, ...WIDTHS]], false))).toBe('none');
    // 分了组的（宋体）：每组一本，有一本留着就算留着；都没有才是没留
    expect(hintingOf(tables([WIDTHS, [...BLUE_VALUES, ...WIDTHS], WIDTHS], true))).toBe('kept');
    expect(hintingOf(tables([WIDTHS, WIDTHS, [...BLUE_SCALE, ...WIDTHS]], true))).toBe('none');
    // 一本私有字典也找不到：不猜，报出来
    expect(() => hintingOf(new Map([['CFF ', Uint8Array.from([1, 0, 4, 1, 0, 1, 1, 1, 2, 0x41, 0, 1, 1, 1, 3, 139, 15, 0, 0, 0, 0])]]))).toThrow('私有字典');
  });

  it('TrueType 的字体：有 fpgm 或者 cvt 这两张表就是留着；只有 prep 不算（霞鹜文楷就是这样）', () => {
    const table = new Uint8Array(4);
    expect(hintingOf(new Map([['glyf', table], ['prep', table]]))).toBe('none');
    expect(hintingOf(new Map([['glyf', table], ['fpgm', table]]))).toBe('kept');
    expect(hintingOf(new Map([['glyf', table], ['cvt ', table]]))).toBe('kept');
    // 一个真的、带着提示信息的小字体（裁剪工具自带的样本，见上面“一个真的小字体”那一项）
    expect(hintingOf(readSfnt(readFileSync(at('node_modules/fontverter/testdata/Roboto-400.ttf'))).tables)).toBe('kept');
  });
});

// ---------------------------------------------------------------- 记录新不新，字在不在

describe('记录是不是新的；网站要的字在不在放进仓库的字体里', () => {
  const plan = planFonts(madeUpSite());
  const made = { 'subset-font': '2.9.0' };
  const record = (): FontRecord => ({
    tool: RECORD_VERSION,
    recipe: RECIPE,
    made: { ...made },
    sources: { sans: sourceRecord('sans'), song: sourceRecord('song'), kai: sourceRecord('kai') },
    files: plan.files.map((file) => ({
      file: `${file.name}.woff2`,
      family: file.family,
      postscript: file.postscript,
      source: file.source,
      group: file.group,
      range: file.range,
      first: file.first,
      preload: file.preload,
      weight: file.weight,
      stop: file.stop,
      bytes: 1,
      sha256: '',
      count: [...file.characters].length,
      glyphs: 1,
      characters: file.characters,
      onlyFromSrc: '',
      features: [],
      hinting: 'kept',
    })),
  });
  /** 照记录编一份“放进仓库的字体”（只有每个文件里有哪些字）。 */
  const shipped = (from: FontRecord = record()): ShippedFonts => ({ record: from, files: from.files.map((item) => ({ record: item, bytes: new Uint8Array(0), tables: new Map(), characters: new Set(item.characters) })) });

  it('字、原字体、做法、库的版本都没变：是新的', () => {
    expect(recordIsFresh(plan, record(), made)).toEqual({ fresh: true, why: '' });
  });

  it('多了一个字、少了一个字、做法改了、库换了版本、原字体换了、要做的文件不一样：都不是新的，说得出为什么', () => {
    const more = planFonts(madeUpSite((site) => site.cards.push({ id: 'q', name: '某人', era: '某代', years: '1', sortYear: 2, tagline: '龘', available: false })));
    expect(recordIsFresh(more, record(), made)).toEqual({ fresh: false, why: 'yanlu-song 的字变了，多了“龘”' });
    const less = record();
    less.files[1].characters += '龘';
    expect(recordIsFresh(plan, less, made)).toEqual({ fresh: false, why: 'yanlu-song 的字变了，少了“龘”' });
    expect(recordIsFresh(plan, { ...record(), recipe: RECIPE + 1 }, made).why).toBe('做法改过了');
    expect(recordIsFresh(plan, record(), { 'subset-font': '2.9.1' }).why).toBe('裁剪字体的库换了版本');
    for (const id of FONT_SOURCE_IDS) {
      const otherFont = record();
      otherFont.sources[id].sha256 = 'x';
      expect(recordIsFresh(plan, otherFont, made).why, id).toBe('原字体换了');
    }
    // 记录里少了一个原字体（旧格式的记录只有两个）：也说得出来
    const twoSources = record();
    delete (twoSources.sources as Partial<FontRecord['sources']>).sans;
    expect(recordIsFresh(plan, twoSources, made).why).toBe('原字体换了');
    expect(recordIsFresh(planFonts(madeUpSite(), { splitByStop: true }), record(), made).why).toBe('要做的文件和记录里的不是同一些');
    expect(recordIsFresh(plan, { ...record(), tool: RECORD_VERSION - 1 }, made).why).toBe('记录的格式换了');
  });

  it('字一个没变，只是哪个文件要预先声明变了（它不改字体文件，只改记录）：也不是新的', () => {
    const flagged = record();
    const kai = flagged.files.find((item) => item.group === 'kai');
    expect(kai).toBeDefined();
    if (!kai) return;
    kai.preload = !kai.preload;
    expect(recordIsFresh(plan, flagged, made)).toEqual({ fresh: false, why: 'yanlu-kai 的说明变了（名称、归哪一组、带不带 unicode-range、是不是一打开就要、预不预先声明）' });
    const renamed = record();
    renamed.files[0].postscript = 'YanluSans-Regular';
    expect(recordIsFresh(plan, renamed, made).why).toContain('yanlu-sans 的说明变了');
  });

  it('“挤标点”的排版功能：黑体的文件里一定有 halt，别的五种哪个文件里都不许有；楷体和宋体六种都不许有', () => {
    expect(squeezeProblems({ file: 'yanlu-sans.woff2', source: 'sans', features: ['halt', 'kern', 'locl'] })).toEqual([]);
    // 查得出来：做出来的黑体里没有 halt（少了它什么也不报错，只是标题里冒号后面的空又回来了）
    expect(squeezeProblems({ file: 'yanlu-sans.woff2', source: 'sans', features: ['kern', 'locl'] })).toEqual(['yanlu-sans.woff2：文件里没有 halt 这种排版功能（标题里全角标点占半个字宽靠它；少了它，标题里冒号后面的空又回来了）']);
    expect(squeezeProblems({ file: 'yanlu-sans.woff2', source: 'sans', features: ['halt', 'palt'] })).toEqual(['yanlu-sans.woff2：文件里有把标点挤窄的排版功能 palt']);
    expect(squeezeProblems({ file: 'yanlu-song.woff2', source: 'song', features: ['kern', 'liga', 'locl', 'vert', 'vrt2'] })).toEqual([]);
    expect(squeezeProblems({ file: 'yanlu-song.woff2', source: 'song', features: ['halt', 'kern'] })).toEqual(['yanlu-song.woff2：文件里有把标点挤窄的排版功能 halt']);
    expect(squeezeProblems({ file: 'yanlu-kai.woff2', source: 'kai', features: ['vert', 'vhal'] })).toEqual(['yanlu-kai.woff2：文件里有把标点挤窄的排版功能 vhal']);
    // 说好留的名单和这张表对得上：黑体的名单里有 halt，另两套的名单里六种一种也没有
    expect(FONT_SOURCES.sans.keepFeatures).toContain('halt');
    for (const id of FONT_SOURCE_IDS) for (const feature of SQUEEZE_FEATURES) expect(FONT_SOURCES[id].keepFeatures.includes(feature), `${id} ${feature}`).toBe(SQUEEZE_KEPT[id].includes(feature));
  });

  it('原字体的说明改了一样（网站、从哪里取、许可文件、留哪些排版功能），记号没变：也不是新的——不然测试说对不上，工具却说已经是新的', () => {
    const why = 'Noto Serif SC Regular 的说明、许可或者留哪些排版功能改过了（FONT_SOURCES）';
    for (const change of [
      (r: FontRecord) => (r.sources.song.site = 'https://example.org/moved'),
      (r: FontRecord) => (r.sources.song.from = '另一个地方'),
      (r: FontRecord) => (r.sources.song.licence.sha256 = 'x'),
      (r: FontRecord) => r.sources.song.keepFeatures.push('halt'),
      (r: FontRecord) => r.sources.song.keepFeatures.pop(),
    ]) {
      const changed = record();
      change(changed);
      expect(recordIsFresh(plan, changed, made)).toEqual({ fresh: false, why });
    }
    // 改记录不会顺手改了 FONT_SOURCES（sourceRecord 给的是另抄的一份）
    expect(recordIsFresh(plan, record(), made).fresh).toBe(true);
    // 记录里的每一项就是 FONT_SOURCES 里的，少一个 family
    expect(sourceRecord('song')).toEqual(Object.fromEntries(Object.entries(FONT_SOURCES.song).filter(([key]) => key !== 'family')));
    expect(Object.keys(sourceRecord('kai'))).toContain('keepFeatures');
    // 粗细也记在每个原字体那一项里：黑体 500，另两套 400
    expect(FONT_SOURCE_IDS.map((id) => sourceRecord(id).weight)).toEqual([500, 400, 400]);
    // 黑体的那一项改了一样：也不是新的
    const sansChanged = record();
    sansChanged.sources.sans.keepFeatures.pop();
    expect(recordIsFresh(plan, sansChanged, made)).toEqual({ fresh: false, why: 'Noto Sans SC Medium 的说明、许可或者留哪些排版功能改过了（FONT_SOURCES）' });
  });

  it('照记录写的两样：样式表和给页面用的模块，都从记录里来，用不到原字体', () => {
    const texts = writtenFromRecord(record());
    expect(texts.css).toBe(fontsCss(plan.files));
    const probe = [...fileOf(plan, 'song-more').characters][0];
    expect(texts.shipped).toBe(shippedTs(probe));
    // 点开才看得见的那一组没有字：给页面的那一个字没处取，说出来
    const empty = record();
    empty.files = empty.files.filter((item) => item.group !== 'song-more');
    expect(() => writtenFromRecord(empty)).toThrow('没处取');
  });

  it('仓库里的字体文件对着记录查：少了一个、和记录对不上，都说得出来（这时工具要重做）', () => {
    const one = record();
    one.files = one.files.slice(0, 1);
    expect(shippedFileProblems(one, () => null)).toEqual(['yanlu-sans.woff2 不在']);
    one.files[0].sha256 = sha256(Uint8Array.from([1, 2, 3]));
    expect(shippedFileProblems(one, () => Uint8Array.from([1, 2, 4]))).toEqual(['yanlu-sans.woff2 和记录对不上（记号不一样）']);
  });

  it('字都在：没有话说', () => {
    expect(missingFromShipped(plan, shipped())).toEqual([]);
  });

  it('网站上多了一个字，字体里没有：说出是哪个字、在哪里用的、该跑哪条命令', () => {
    const more = planFonts(
      madeUpSite((site) => {
        const first = site.figures[0].stops[0].content;
        if (first) first.originals[0].text += '䃜';
      }),
    );
    expect(missingFromShipped(more, shipped())).toEqual(['“䃜”（U+40DC，甲站的原文里）不在随站的字体里：运行 npm run fonts，再提交。']);
  });

  it('一个字从小注挪进了正文，字体里它还只在点开才下载的那个文件里：不算数', () => {
    const moved = planFonts(
      madeUpSite((site) => {
        const story = site.figures[0].stops[0].content?.sections[0].blocks[0];
        if (story?.type === 'paragraph') story.segments.push({ text: '申' });
      }),
    );
    expect(missingFromShipped(moved, shipped())).toEqual(['“申”（U+7533，甲站的正文里）不在随站的字体里：运行 npm run fonts，再提交。']);
  });

  it('反过来，一个字从正文挪进了小注，字体里它还在头一个宋体文件里：算数（多带了不算错）', () => {
    const moved = planFonts(
      madeUpSite((site) => {
        const first = site.figures[0].stops[0].content;
        if (!first) return;
        first.sections[0].blocks = first.sections[0].blocks.filter((block) => block.type !== 'quote');
        first.notes[0].body += '引';
      }),
    );
    expect(has(moved, 'song-more', '引')).toBe(true);
    expect(missingFromShipped(moved, shipped())).toEqual([]);
  });

  it('要用楷体排的字、要用黑体排的字，只在宋体的文件里有：不算数', () => {
    const more = planFonts(madeUpSite((site) => (site.kaiLabels = [...site.kaiLabels, '午'])));
    expect(missingFromShipped(more, shipped())).toEqual(['“午”（U+5348，界面上用楷体排的字里）不在随站的字体里：运行 npm run fonts，再提交。']);
    // 黑体的字只认黑体的文件：宋体的文件里有“午”，楷体的文件里有“楷”，都不算
    const sansMore = planFonts(madeUpSite((site) => (site.sansLabels = [...site.sansLabels, '午楷'])));
    expect(missingFromShipped(sansMore, shipped())).toEqual([
      '“午”（U+5348，界面上用黑体排的字里）不在随站的字体里：运行 npm run fonts，再提交。',
      '“楷”（U+6977，界面上用黑体排的字里）不在随站的字体里：运行 npm run fonts，再提交。',
    ]);
  });
});

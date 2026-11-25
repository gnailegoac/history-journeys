// 随站的字体，在真的页面上查。字体文件本身对不对在 tests/fonts/font-files.test.ts（随 npm test 跑，不开浏览器）；
// 这里看的是浏览器真的拿哪个字体画了哪些字。
//
// 一、每一个字都是随站的字体画的。走一遍网站：首页、人物页、“来源”页、每一站（写好的两站把每一条小注、每一篇原文、凭据都点开，
//     讲解员面板也打开）、有沙盘的那一站每一小节的题记和“说明”、两种“没找到”的页面；有沙盘的那一站另外用“只放图片”的样子
//     把每一小节的题签按古名、今名各看一遍，再摆一次真的沙盘。上面这些都在电脑的窗口（1440 × 900）里看。另外看：
//     沙盘栏平常看不到的几种样子（浏览器画不了、太慢、读者要来的沙盘、画面断了、没摆出来、图片先垫着——那一行话，
//     和“试试立体的沙盘”“重新摆出来”“再试一次”“换回图片”这几个按钮）；竖着拿的平板（多“收起沙盘”“展开沙盘”）、
//     横着拿的平板、一个手机那么窄的窗口（题记是窄的排法，老平板上都是这一种）；页面的程序起不来时的那两句话。
//     没有看的：“加载中…”和“没能读出来”那几句（要把取内容的请求压住、掐断才出得来；它们是宋体，字都在头一个宋体文件里，
//     由 tests/fonts/font-files.test.ts 守着）。
//     每到一处，问浏览器：页面上显出来的每一段字，各用了哪些字体、
//     画了几个字形（用的是 Chromium 自己的调试接口 CSS.getPlatformFontsForNode，一段字一段字地问）。要求：
//       · 用到的每一个字体都是网页自己带的（isCustomFont），名字是 Yanlu Sans、Yanlu Song 或者 Yanlu Kai：
//         有一个字掉到了设备自带的字体上，这里就通不过，说出是哪一段字、掉到了哪个字体上；
//       · 样式里写着用黑体的，只用了黑体那一个文件（黑体文件里没有的字不能排成黑体）；写着用楷体的，只用了楷体那一个文件，
//         而且只在题签上（.strip，题签脚上的印也在里面）：框架里没有楷体；别的只用了宋体的文件；
//       · 每套字体只有它自己的那一种粗细：黑体 500，宋体和楷体 400；没有斜体。
//     另有两处问的是整个元素：故意把题记写长、让它被截掉，行尾那个浏览器自己添的省略号也得是那一行的字体画的——
//     题记是一句话，多大都是宋体：竖着拿的平板上（18px）、横着拿的平板上（14px）各查一遍，省略号都得是随站的宋体。
//     沙盘的替身和定格图的替身（.fake-stage、.fake-still）上面的字是给测试看的，不查。
//     查不到的：样式表用 content 画出来的字。样式表里不许这样写（tests/fonts/font-files.test.ts 守着）：“读原文”“凭据”前面的
//     加号、减号是页面上真的字，折着显加号，点开显减号，两样这里都看得到。
// 二、两个全角的标点挨着，占满两个字宽（不被浏览器挤紧）：宋体量句号和后引号。
//     量出来的 200 像素，靠的是文件里没有把标点挤窄的排版功能（halt、chws 这些；由 tests/fonts/font-files.test.ts 守着）：
//     在这个浏览器里，样式表里那一句 text-spacing-trim: space-all 写不写，量出来都是 200（两个数都印出来）。
//     黑体不一样：它的文件里留着 halt（标题上要用它把全角标点收成半个字宽）。所以黑体量四个数（冒号和前括号），
//     照字体的名字量一遍，照样式表里的记号（--font-sans）再量一遍：
//     照页面的写法、不开 halt，两个挨着是 200——这回靠的就是 html 上那一句 text-spacing-trim: space-all（去掉那一句是多少也印出来）；
//     开着 halt，“州：大”是 250，冒号和前括号挨着是 100；不开，“州：大”是 300。
//     页面上哪里开着 halt：一页的大标题和目录里各站的标题（.page-title、.stop-title），别的黑体的字都不开。
//     楷体不量：题签上的字里没有标点。照记录查——楷体的文件里一个全角的标点也没有；哪天题签上写进了标点，这一句通不过，
//     那时再回来量它（不能照旧拿 --font-kai 量：那个记号没有了，量到的是宋体，永远是 200）。
// 三、从打开网站走到最后，没有一个请求出了网站自己的地址。
// 四、第三个字体文件（点开才看得见的字）什么时候取：首页、人物页上等五秒也不取；还没写的站上等三秒半也不取；
//     写好的站上，从点开算起不到两秒不取，字体到齐以后五秒之内自己取来，只取一次；以后点开什么、换到哪一站，都不再取。
//     黑体和头一个宋体文件各只取一次（index.html 里预先声明的那一份，样式表接着用）；楷体的文件不预先声明，页面一知道
//     沙盘栏要摆沙盘就叫浏览器去取（不等图片、不等沙盘程序；另有一项把这两样压住来查），题签摆出来不再取第二次，
//     也只取一次。这一项不用沙盘的替身：替身上那几行给测试看的字
//     不在头两个文件里，有它在，第三个文件一打开就会被取来。用的是“只放图片”的样子。
//     “来源”页上的话是点进那一页才看得见的，它们独有的字在第三个文件里（tests/support/fontTool.ts 的 PRESSED_SOURCES）：
//     另有一项看，在首页上等着不取，点进“来源”页才取、只取一次，那一页里面的那一段程序也是点进去才下载的；
//     直接打开“来源”页（那一页上没有沙盘）楷体的文件一次也不取。
// 五、网慢的时候：把黑体文件压住不给，过一秒看，沙盘栏的按钮、底下“问讲解员”的按钮、标题上都有字
//    （先用别的字体顶着，不空着），正文也有字；放行以后换成随站的黑体。把头两个文件（黑体和头一个宋体）都压住，也一样。
//     楷体的文件不预先声明，总比页面晚到，这是平常的样子：把它压住，题签上照样有字（设备上有楷体就先用它，没有就先用随站的宋体），
//     放行以后换成随站的楷体；换的前后每一条题签还在原处、还是那么大（差不过半个像素）。各拍一张照（拍的是字体还没到的样子）。
//
// 照片存到 tests/shots/fonts/（不进仓库）；想另存一处，设环境变量 SHOTS_DIR。
// 这些只证明 Chromium 里是这样。iPad 上的 Safari 这台机器跑不了。

import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import type { CDPSession, Page, Route } from '@playwright/test';
import { expectRealTable, expectStageAt, expectRoute, fakeUrl, firstStopWithScene, firstWrittenStop, foldBodiesReady, fontsReady, headingsOf, openFigureWithTable, realUrl, routeOnDisk, sceneOnDisk, scrollToBottom, scrollToSection, stagePane, stripsOf } from './helpers';
import { namesIn, readBytes } from '../support/readBytes';
import type { ItineraryBar } from '../../src/domain/itinerary';
import { SHIPPED_FONTS } from '../../src/fonts/shipped';
import { SOURCES_TEXT } from '../../src/ui/sourcesText';
import { PANE_QUERIES, PANE_SAYS, expectPane, notice, stopUrl } from './paneHelpers';

/** 页面的主程序（构建以后的，或者开发服务上的）。 */
const MAIN_SCRIPT = /\/(assets\/index-[\w-]+\.js|src\/main\.tsx)(\?.*)?$/;

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const DIR = env.SHOTS_DIR ?? 'tests/shots/fonts';

/** “来源”页上说楷体的那一条（照 shipped.ts 里的名字和版本拼出来的原话）。 */
const SOURCES_KAI_LINE = SOURCES_TEXT.kai(SHIPPED_FONTS.kai);

/** 工具写进字体文件里的三个名字（src/fonts/fonts.css 的 font-family）。 */
const KAI = 'Yanlu Kai';
const SONG = 'Yanlu Song';
const SANS = 'Yanlu Sans';

/** 页面上显出来的一段字：在哪个元素里，开头是什么，那个元素的样式算出来的字体、粗细、正斜。 */
interface Run {
  where: string;
  text: string;
  family: string;
  weight: string;
  style: string;
  /** 是不是在题签上（.strip 里面；题签脚上的印也算）。 */
  onStrip: boolean;
}

/** 浏览器说的：一段字用了哪个字体、画了几个字形。 */
interface UsedFont {
  familyName: string;
  postScriptName: string;
  isCustomFont: boolean;
  glyphCount: number;
}

/** 一个请求要的是哪个字体文件（构建以后文件名里多了一串字符，照名字的开头认）；不是字体文件是 null。 */
function fontFileOf(url: string): 'yanlu-sans' | 'yanlu-kai' | 'yanlu-song' | 'yanlu-song-more' | null {
  const name = new URL(url).pathname.split('/').pop() ?? '';
  if (!name.endsWith('.woff2')) return null;
  if (name.startsWith('yanlu-song-more')) return 'yanlu-song-more';
  if (name.startsWith('yanlu-song')) return 'yanlu-song';
  if (name.startsWith('yanlu-kai')) return 'yanlu-kai';
  if (name.startsWith('yanlu-sans')) return 'yanlu-sans';
  return null;
}

/**
 * 找出页面上显出来的每一段字（文字节点），按在页面里的先后，记在 window.__fontRuns 里，给出每一段的说明。
 * within 是只看哪些元素里面的（不写是整页）。不算：沙盘和定格图的替身；没显出来的（折着的原文和凭据里面的、
 * display: none 的）；只有空白的。
 */
async function markRuns(page: Page, within: string | null): Promise<Run[]> {
  return page.evaluate((within) => {
    const found: { where: string; text: string; family: string; weight: string; style: string; onStrip: boolean }[] = [];
    const nodes: Text[] = [];
    const nameOf = (el: Element): string => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() !== '' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`;
    const roots = within === null ? [document.body] : Array.from(document.querySelectorAll(within));
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = (node.textContent ?? '').trim();
        const el = node.parentElement;
        if (text === '' || !el) continue;
        if (el.closest('.fake-stage, .fake-still, script, style, noscript')) continue;
        if (el.getClientRects().length === 0) continue;
        if (!el.checkVisibility({ visibilityProperty: true, checkVisibilityCSS: true })) continue;
        const style = getComputedStyle(el);
        const above = el.parentElement ? `${nameOf(el.parentElement)} > ` : '';
        nodes.push(node as Text);
        found.push({ where: above + nameOf(el), text: text.length > 28 ? `${text.slice(0, 28)}…` : text, family: style.fontFamily, weight: style.fontWeight, style: style.fontStyle, onStrip: el.closest('.strip') !== null });
      }
    }
    (window as Window & { __fontRuns?: Text[] }).__fontRuns = nodes;
    return found;
  }, within);
}

/**
 * 页面上显出来的每一段字各用了哪些字体。问的是文字节点自己：问元素的话，浏览器会把它里面两层以内别的元素的字也算进来
 *（标题里嵌着的小标签就会算到标题头上）。settle 是先不先等字体到齐（看“字体还没到的样子”时不等）。
 */
async function fontsOfRuns(page: Page, client: CDPSession, within: string | null = null, settle = true): Promise<{ run: Run; fonts: UsedFont[] }[]> {
  if (settle) await fontsReady(page);
  const runs = await markRuns(page, within);
  await client.send('DOM.getDocument', { depth: 0 });
  const { result: list } = (await client.send('Runtime.evaluate', { expression: 'window.__fontRuns', returnByValue: false })) as { result: { objectId?: string } };
  if (!list.objectId) throw new Error('页面上没有记下那些字');
  const { result: properties } = (await client.send('Runtime.getProperties', { objectId: list.objectId, ownProperties: true })) as { result: { name: string; value?: { objectId?: string } }[] };
  const handles = new Map(properties.filter((property) => /^\d+$/.test(property.name)).map((property) => [Number(property.name), property.value?.objectId]));
  expect(handles.size, '记下来的那些字，调试接口拿到的个数不一样（页面在这中间变了）').toBe(runs.length);
  const result: { run: Run; fonts: UsedFont[] }[] = [];
  for (const [i, run] of runs.entries()) {
    const objectId = handles.get(i);
    if (!objectId) throw new Error(`第 ${i} 段字没有拿到`);
    const { nodeId } = (await client.send('DOM.requestNode', { objectId })) as { nodeId: number };
    const { fonts } = (await client.send('CSS.getPlatformFontsForNode', { nodeId })) as { fonts: UsedFont[] };
    result.push({ run, fonts });
  }
  await client.send('Runtime.releaseObject', { objectId: list.objectId });
  return result;
}

/**
 * 一个元素（照选择器找头一个）用了哪些字体。和上面不一样，这里问的是元素：它里面的字，连同浏览器自己添在行尾的省略号
 *（一行放不下、被截掉时），都算在里面。
 */
async function fontsOfElement(client: CDPSession, selector: string): Promise<UsedFont[]> {
  const { root } = (await client.send('DOM.getDocument', { depth: 0 })) as { root: { nodeId: number } };
  const { nodeId } = (await client.send('DOM.querySelector', { nodeId: root.nodeId, selector })) as { nodeId: number };
  if (!nodeId) throw new Error(`页面上没有 ${selector}`);
  const { fonts } = (await client.send('CSS.getPlatformFontsForNode', { nodeId })) as { fonts: UsedFont[] };
  return fonts;
}

/**
 * 浏览器报的这个字体是不是随站的那一套。名字照工具写进文件里的认：family 是 Yanlu Kai / Yanlu Song / Yanlu Sans，
 * 或者 PostScript 名字是 YanluKai-Regular / YanluSong-Regular / YanluSongMore-Regular / YanluSans-Medium。
 * 两样认一样就算：调试接口只说名字是“系统报上来的”，Windows 上两样都是我们写的名字，别的系统上哪一样靠得住没有试过。
 */
function isShipped(font: UsedFont, family: string): boolean {
  const postScript = family === KAI ? ['YanluKai-Regular'] : family === SANS ? ['YanluSans-Medium'] : ['YanluSong-Regular', 'YanluSongMore-Regular'];
  return font.isCustomFont && (font.familyName === family || postScript.includes(font.postScriptName));
}

/** 样式里写的是哪一套字体打头：黑体、楷体，别的都算宋体。 */
function wants(family: string): typeof SANS | typeof KAI | typeof SONG {
  const first = family.replace(/^["']/, '');
  return first.startsWith(SANS) ? SANS : first.startsWith(KAI) ? KAI : SONG;
}

/** 每套字体只带了一种粗细。 */
const WEIGHT_OF = { [SANS]: '500', [SONG]: '400', [KAI]: '400' } as const;
/** 给人看的叫法。 */
const CALLED = { [SANS]: '黑体', [SONG]: '宋体', [KAI]: '楷体' } as const;

/** 看过多少段字，其中样式是黑体的、楷体的各多少段；一共多少个字形，黑体、楷体各画了多少。 */
interface Tally {
  runs: number;
  sansRuns: number;
  kaiRuns: number;
  glyphs: number;
  sansGlyphs: number;
  kaiGlyphs: number;
}

/**
 * 查一页：显出来的每一段字都只用了随站的字体，黑体的只用黑体，楷体的只用楷体、而且只在题签上，别的只用宋体；
 * 粗细是这套字体自己的那一种，没有斜体。不对的每一处一句话。顺手记数。
 */
async function checkPage(page: Page, client: CDPSession, label: string, tally: Tally, expectAtLeast: number): Promise<void> {
  const seen = await fontsOfRuns(page, client);
  const problems: string[] = [];
  for (const { run, fonts } of seen) {
    const at = `${run.where}“${run.text}”`;
    const family = wants(run.family);
    const glyphs = fonts.reduce((sum, font) => sum + font.glyphCount, 0);
    tally.runs++;
    tally.glyphs += glyphs;
    if (family === SANS) {
      tally.sansRuns++;
      tally.sansGlyphs += glyphs;
    }
    if (family === KAI) {
      tally.kaiRuns++;
      tally.kaiGlyphs += glyphs;
      // 楷体是人物自己的：只有沙盘上的题签（和题签脚上的印）用它，框架里没有
      if (!run.onStrip) problems.push(`${at}：样式是楷体，可它不在题签上`);
    }
    if (glyphs === 0) problems.push(`${at}：浏览器说它一个字形也没画`);
    for (const font of fonts) {
      const said = `${font.familyName}（${font.postScriptName}，${font.glyphCount} 个字形${font.isCustomFont ? '' : '，设备自带的'}）`;
      if (family === SONG && !isShipped(font, SONG)) problems.push(`${at}：有字是 ${said} 画的，不是随站的宋体`);
      else if (family !== SONG && !isShipped(font, family)) problems.push(`${at}：样式是${CALLED[family]}，却有字是 ${said} 画的`);
    }
    if (run.weight !== WEIGHT_OF[family]) problems.push(`${at}：粗细是 ${run.weight}，这套字体只带了 ${WEIGHT_OF[family]}`);
    if (run.style !== 'normal') problems.push(`${at}：字是 ${run.style} 的，应该是正的`);
  }
  expect(seen.length, `${label}：页面上显出来的字太少，怕是没打开`).toBeGreaterThanOrEqual(expectAtLeast);
  expect(problems, `${label}：这几处的字不是随站的字体画的（或者粗细不对、斜体了，或者楷体用在了题签以外）。字体里没有这个字就运行 npm run fonts（黑体的字要先列进 src/ui/text.ts 的 SANS_LABELS）；样式写错了就改样式`).toEqual([]);
}

/**
 * 量一量几个挨着的字有多宽（字号 100px，所以两个全角标点占满是 200）。trim 不写是照页面的写法量（html 上的
 * text-spacing-trim: space-all 传下来）；写 normal 是量“要是没有那一句，浏览器平常会怎样”，只为印出来对比。
 * font 是样式表里的一个记号（--font-song、--font-sans），或者直接是字体的名字（不是“--”打头的就原样写进 font-family）。
 * 量黑体时粗细写 500（它只有这一种）；features 是 font-feature-settings 的值（如 "'halt'"），不写就不设。
 */
async function twoMarksWide(page: Page, font: string, marks: string, trim = '', features = ''): Promise<number> {
  return page.evaluate(
    ({ font, marks, trim, features, sans }) => {
      const probe = document.createElement('span');
      const family = font.startsWith('--') ? `var(${font})` : `'${font}'`;
      const weight = font === sans || font === '--font-sans' ? ';font-weight:500' : '';
      probe.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;white-space:nowrap;letter-spacing:0;font-size:100px;font-family:${family}${weight}${trim === '' ? '' : `;text-spacing-trim:${trim}`}${features === '' ? '' : `;font-feature-settings:${features}`}`;
      probe.textContent = marks;
      document.body.appendChild(probe);
      const width = probe.getBoundingClientRect().width;
      probe.remove();
      return width;
    },
    { font, marks, trim, features, sans: SANS },
  );
}

/** 是不是网站自己的地址（data:、blob:、about: 不是往哪里发的请求，也算自己的）。 */
function isOwn(url: string, base: string): boolean {
  if (/^(data|blob|about):/.test(url)) return true;
  return new URL(url).origin === new URL(base).origin;
}

/** 接上 Chromium 的调试接口。 */
async function debugger_(page: Page): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page);
  await client.send('DOM.enable');
  await client.send('CSS.enable');
  await client.send('Runtime.enable');
  return client;
}

test('走一遍网站：每一个字都是随站的字体画的，黑体的只用黑体，楷体的只用楷体、而且只在题签上，每套字体只有它自己的那一种粗细；全角标点不挤（标题上开着 halt 的除外）；没有请求出网站自己的地址', async ({ page, baseURL }) => {
  test.setTimeout(900_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  const client = await debugger_(page);
  const tally: Tally = { runs: 0, sansRuns: 0, kaiRuns: 0, glyphs: 0, sansGlyphs: 0, kaiGlyphs: 0 };
  const visited: string[] = [];
  const look = async (label: string, atLeast: number): Promise<void> => {
    const before = tally.runs;
    await checkPage(page, client, label, tally, atLeast);
    visited.push(`${label}：${tally.runs - before} 段字`);
  };

  // ---- 首页
  const { figureId, found } = await openFigureWithTable(page, fakeUrl('#/'));
  await page.goto('about:blank');
  await page.goto(fakeUrl('#/'));
  await expect(page.locator('.card').first()).toBeVisible();
  await look('首页', 8);

  // 全角标点：两个挨着，占满两个字宽
  const songMarks = await twoMarksWide(page, '--font-song', '。”');
  const untrimmed = await twoMarksWide(page, '--font-song', '。”', 'normal');
  expect(songMarks, '宋体里句号和后引号挨着的宽度（字号 100px）').toBeCloseTo(200, 0);
  // 楷体不量：题签上的字里没有标点（照记录查楷体那个文件里的字）。哪天题签上写进了标点，这一句通不过，那时再回来量它
  const FULL_WIDTH_MARKS = '，。、；：？！“”‘’（）《》〈〉「」『』【】〔〕…—·';
  const kaiRecord = (JSON.parse(new TextDecoder().decode(readBytes('src/fonts/fonts.json'))) as { files: { group: string; characters: string }[] }).files.find((item) => item.group === 'kai');
  expect([...(kaiRecord?.characters ?? '')].length, '记录里楷体那个文件的字').toBeGreaterThan(50);
  expect([...FULL_WIDTH_MARKS].filter((mark) => (kaiRecord?.characters ?? '').includes(mark)), '楷体的文件里有全角的标点了（题签上写进了标点）：把楷体里两个标点挨着的宽度量回来').toEqual([]);
  // 黑体：文件里留着 halt。先确认浏览器手里有黑体的文件（样式表里声明的那一条，粗细 500），不然量到的是设备自带的字体
  const sansLoaded = await page.evaluate((family) => document.fonts.load(`500 100px '${family}'`, '州：大（').then((faces) => faces.map((face) => `${face.family} ${face.weight} ${face.status}`)), SANS);
  expect(sansLoaded, '黑体的文件取来了（样式表里声明的那一条，粗细 500）').toEqual([`${SANS} 500 loaded`]);
  const HALT = "'halt'";
  const sansWidths = async (font: string): Promise<{ plain: number; untrimmed: number; haltTitle: number; haltPair: number; plainTitle: number }> => ({
    plain: await twoMarksWide(page, font, '：（'),
    untrimmed: await twoMarksWide(page, font, '：（', 'normal'),
    haltTitle: await twoMarksWide(page, font, '州：大', '', HALT),
    haltPair: await twoMarksWide(page, font, '：（', '', HALT),
    plainTitle: await twoMarksWide(page, font, '州：大'),
  });
  // 照字体的名字量一遍，照样式表里的记号再量一遍：两遍是同样的数（记号指着的头一个就是这套字体）
  const sansMarks = await sansWidths(SANS);
  expect(sansMarks.plain, '黑体里冒号和前括号挨着的宽度（字号 100px，不开 halt）').toBeCloseTo(200, 0);
  expect(sansMarks.haltTitle, '黑体开着 halt：“州：大”的宽度').toBeCloseTo(250, 0);
  expect(sansMarks.haltPair, '黑体开着 halt：冒号和前括号挨着的宽度').toBeCloseTo(100, 0);
  expect(sansMarks.plainTitle, '黑体不开 halt：“州：大”的宽度').toBeCloseTo(300, 0);
  expect(await sansWidths('--font-sans'), '照样式表里的记号 --font-sans 量，和照字体的名字量是同样的数').toEqual(sansMarks);
  // 页面上哪里开着 halt：首页的标题不开（它是一句话，没有标点）；一页的大标题和目录里各站的标题开着，见下面人物页和站点页
  expect(await page.locator('.home-title').evaluate((el) => getComputedStyle(el).fontFeatureSettings), '首页上网站的名字不开 halt').toBe('normal');

  // ---- 人物页
  await page.goto(fakeUrl(`#/${figureId}`));
  await expect(page.locator('.stop-item').first()).toBeVisible();
  await expectRoute(page);
  await look('人物页', 30);
  // 一页的大标题、目录里各站的标题开着 halt（标题里的全角标点占半个字宽）；标签不开
  const feature = (selector: string): Promise<string> => page.locator(selector).first().evaluate((el) => getComputedStyle(el).fontFeatureSettings);
  expect({ title: await feature('.page-title'), stop: await feature('.stop-item .stop-title'), label: await feature('.stop-item .stop-meta'), tag: await feature('.tag') }, '人物页上哪里开着 halt').toEqual({ title: '"halt"', stop: '"halt"', label: 'normal', tag: 'normal' });
  const stops = await page.locator('.stop-item').evaluateAll((items) => items.map((item) => ({ id: item.getAttribute('data-stop-id') ?? '', written: item.getAttribute('data-stop-status') === 'complete' })));
  expect(stops.length).toBeGreaterThan(0);

  // ---- 时间轴（沙盘的替身上要在地址里写从哪一天起才摆）：人物页和首页上，停在他住在一站里、走在路上、沙盘上没有他的一段各看一遍；
  // 人物页上再点开“图例”（里面是这一段的“说不准的”和那几句固定的话）
  if (namesIn(`content/figures/${figureId}`).includes('itinerary.bar.json')) {
    const made = JSON.parse(new TextDecoder().decode(readBytes(`content/figures/${figureId}/itinerary.bar.json`))) as ItineraryBar;
    const at = (look: ItineraryBar['stretches'][number]['look']): { day: number; label: string } => {
      const i = made.stretches.findIndex((stretch, k) => k > 0 && stretch.look === look);
      expect(i, `行迹里要有一段是 ${look}`).toBeGreaterThan(0);
      return { day: Math.round((made.stretches[i - 1].until + made.stretches[i].until) / 2), label: made.stretches[i].label };
    };
    for (const [where, hash] of [['人物页', `#/${figureId}`], ['首页', '#/']] as const) {
      for (const [what, look_] of [['住在一站里', 'stop'], ['走在路上', 'road'], ['沙盘上没有他', 'off']] as const) {
        const { day, label } = at(look_);
        await page.goto('about:blank');
        await page.goto(fakeUrl(hash, `&bar=${day}`));
        await expect(page.locator('.bar-thumb')).toHaveCount(1);
        await expect(page.locator('.bar-when .bar-label')).toHaveText(label);
        await expect(page.locator('.bar-known')).not.toBeEmpty();
        await look(`${where}，时间轴停在${what}的一段`, 12);
      }
    }
    await page.goto('about:blank');
    await page.goto(fakeUrl(`#/${figureId}`, `&bar=${at('stop').day}`));
    await expect(page.locator('.bar-thumb')).toHaveCount(1);
    await page.locator('.bar-note').click();
    await expect(page.locator('.bar-panel .stage-note-lines p').first()).toBeVisible();
    await fontsReady(page);
    await look('人物页，时间轴的“图例”开着', 30);
    // 回到人物页（下面从它的目录点进“来源”页）
    await page.goto(fakeUrl(`#/${figureId}`));
    await expect(page.locator('.stop-item').first()).toBeVisible();
    await expectRoute(page);
  }

  // ---- “来源”页：从人物页目录后面的链接点进去。里面的东西是另一段程序，两栏又要读内容：等它们都到了再查
  await page.locator('.figure-page .stop-nav a').evaluate((link: HTMLElement) => link.click());
  await expect(page.locator('.sources .page-title')).toHaveText('来源');
  await expect(page.locator('.sources-lead')).toBeVisible();
  await expect(page.locator('.sources-list li').first()).toBeVisible();
  await expect(page.locator('.sources .quiet')).toHaveCount(0);
  await fontsReady(page);
  await look('“来源”页', 25);
  // 这一页上通到别的网站的链接（字体的网站、图片出处）只是链接：页面没有去取它们（最后那一条“没有请求出了网站自己的地址”守着）
  expect(await page.locator('.sources a[target="_blank"]').count(), '“来源”页上通到别的网站的链接').toBeGreaterThanOrEqual(2);

  // ---- 每一站
  const hasRoute = routeOnDisk(figureId) !== null;
  for (const stop of stops) {
    await page.goto('about:blank');
    await page.goto(fakeUrl(`#/${figureId}/${stop.id}`));
    await expect(page.locator('.page-title')).toBeVisible();
    if (!stop.written) {
      await expect(page.locator('.not-written')).toBeVisible();
      // 还没写的站也可以有自己的沙盘（眉州）：那样的站摆着它自己的头一个画面，题签、题记、那一句说明都是这一页上才印的字。
      // 没有的：沙盘栏里是到这一站去的那一节，它的题记只在这一页上印。都等摆好了再看字
      const table = sceneOnDisk(figureId, stop.id);
      if (table) await expectStageAt(page, headingsOf(table)[0]);
      else expect(await expectRoute(page), `${stop.id}：这位人物有全程沙盘，这一页上就该摆着它`).toBe(hasRoute);
      await look(`还没写的一站 ${stop.id}${table ? '（有自己的沙盘）' : ''}`, 8);
      continue;
    }
    await expect(page.locator('.text-section').first()).toBeVisible();
    // 这一站有没有自己的沙盘，一站一站从 content/ 里看（有沙盘的站不止一个：徐州、黄州）。有的摆着它自己的第一节；
    // 没有的（写好了正文、沙盘还没做的一站）摆着全程沙盘上到这一站去的来路
    const own = sceneOnDisk(figureId, stop.id);
    if (own) await expectStageAt(page, headingsOf(own)[0]);
    else expect(await expectRoute(page), `${stop.id}：这位人物有全程沙盘，这一页上就该摆着它`).toBe(hasRoute);
    await look(`${stop.id}，刚打开`, 40);

    // 每一条小注、每一篇原文、凭据都点开（在页面里直接点：不让测试工具把钉着的沙盘栏滚来滚去）
    const opened = await page.evaluate(() => {
      const terms = Array.from(document.querySelectorAll<HTMLElement>('.note-term[aria-expanded="false"]'));
      for (const term of terms) term.click();
      const folds = Array.from(document.querySelectorAll<HTMLDetailsElement>('details.original, details.provenance'));
      for (const fold of folds) fold.open = true;
      return { notes: terms.length, folds: folds.length };
    });
    expect(opened.notes).toBeGreaterThan(0);
    await expect(page.locator('.note')).not.toHaveCount(0);
    await expect(page.locator('.provenance-body')).toBeVisible();
    // 凭据里面的东西是点开才取的：等它到了再查（不然查到的只是一句“加载中…”）
    await foldBodiesReady(page);
    await expect(page.locator('.provenance-body .provenance-item')).not.toHaveCount(0);
    await look(`${stop.id}，小注（${opened.notes} 处）、原文和凭据（${opened.folds} 处）都点开`, 200);

    // 讲解员面板（里面的东西也是点开才取的）
    await page.getByRole('button', { name: '问讲解员' }).evaluate((button: HTMLElement) => button.click());
    await expect(page.getByRole('dialog')).toBeVisible();
    await foldBodiesReady(page);
    await expect(page.locator('.guide-panel .guide-form')).toBeVisible();
    await look(`${stop.id}，讲解员面板开着`, 200);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }

  // ---- 有沙盘的那一站：每一小节的题记，“说明”
  if (found) {
    const headings = headingsOf(found.scene);
    const pane = stagePane(page);
    await page.goto('about:blank');
    await page.goto(fakeUrl(`#/${figureId}/${found.stopId}`));
    await expectStageAt(page, headings[0]);
    for (const [i, heading] of headings.entries()) {
      if (i === headings.length - 1) await scrollToBottom(page);
      else if (i > 0) await scrollToSection(page, heading);
      await expectStageAt(page, heading);
      await expect(pane.locator('.stage-caption')).toHaveAttribute('data-section', heading);
      // 照着按钮的位置点“说明”，像手指那样
      const note = (await pane.locator('.stage-note-button').boundingBox())!;
      await page.mouse.click(note.x + note.width / 2, note.y + note.height / 2);
      await expect(pane.locator('.stage-note-panel')).toBeVisible();
      await look(`${found.stopId} 第 ${i + 1} 节的题记，“说明”开着`, 40);
      await page.keyboard.press('Escape');
      await expect(pane.locator('.stage-note-panel')).toHaveCount(0);
    }

    // ---- 只放图片的样子：每一小节的题签，古名、今名各一遍（不摆立体的沙盘，快）
    await page.goto('about:blank');
    await page.goto(realUrl(`#/${figureId}/${found.stopId}`, null, '&tier=still'));
    await expect(pane).toHaveAttribute('data-stage-picture', 'still', { timeout: 60_000 });
    const names = pane.locator('.names-switch button');
    for (const [i, heading] of headings.entries()) {
      if (i === headings.length - 1) await scrollToBottom(page);
      else if (i > 0) await scrollToSection(page, heading);
      await expect(pane).toHaveAttribute('data-stage-section', heading, { timeout: 60_000 });
      await expect(page.locator('.stage-still-host .still-table')).toHaveAttribute('data-still-section', heading);
      const wanted = stripsOf(found.scene, heading);
      for (const mode of ['ancient', 'modern'] as const) {
        const button = names.nth(mode === 'ancient' ? 0 : 1);
        const box = (await button.boundingBox())!;
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await expect(page.locator('.stage-still-host .strip')).toHaveCount(wanted.length);
        await page.waitForTimeout(300);
        await look(`${found.stopId} 第 ${i + 1} 节，只放图片，${mode === 'ancient' ? '古名' : '今名'}的题签（${wanted.length} 条）`, 40);
      }
    }
    // 题签的样式就是楷体（上面只要求“样式是楷体的只用楷体，而且只在题签上”）
    await expect.poll(() => page.locator('.stage-still-host .strip').evaluateAll((items) => items.filter((item) => item.isConnected).map((item) => getComputedStyle(item).fontFamily)[0] ?? '')).toMatch(/^"?Yanlu Kai/);

    // ---- 沙盘栏别的几种样子（沙盘和图片都用替身）：那一行话、“试试立体的沙盘”“重新摆出来”“再试一次”“换回图片”这几个
    //      平常看不到的按钮，也都得是随站的字体画的（按钮是黑体：它上面的字要都在黑体的文件里）
    const openPane = async (query: string): Promise<void> => {
      await page.goto('about:blank');
      await page.goto(stopUrl(query, figureId, found.stopId));
      await expect(page.locator('.text-section').first()).toBeVisible();
    };
    await openPane(PANE_QUERIES.unsupported);
    await expectPane(page, 'unsupported', 'still');
    await expect(notice(page)).toHaveText(PANE_SAYS.unsupported);
    await look(`${found.stopId}，沙盘栏：浏览器画不了`, 40);

    await openPane(PANE_QUERIES.slow);
    await expectPane(page, 'slow', 'still');
    await expect(pane.locator('.stage-controls .stage-retry')).toHaveText(PANE_SAYS.tryTable);
    await look(`${found.stopId}，沙盘栏：太慢，放着图片`, 40);
    await pane.locator('.stage-controls .stage-retry').click();
    await expectPane(page, 'ready', 'table');
    await expect(notice(page)).toContainText(PANE_SAYS.back);
    await look(`${found.stopId}，沙盘栏：读者要来的沙盘（句尾“换回图片”）`, 40);

    await openPane(PANE_QUERIES.ready);
    await expectStageAt(page, headings[0]);
    await page.evaluate(() => document.querySelector<HTMLElement>('.fake-stage-lose')?.click());
    await expectPane(page, 'lost', 'still');
    await expect(pane.locator('.stage-controls .stage-retry')).toHaveText(PANE_SAYS.rebuild);
    await look(`${found.stopId}，沙盘栏：画面断了`, 40);

    await openPane(PANE_QUERIES.failed);
    await expectPane(page, 'failed', 'still');
    await expect(pane.locator('.stage-controls .stage-retry')).toHaveText(PANE_SAYS.retry);
    await look(`${found.stopId}，沙盘栏：没摆出来`, 40);

    await openPane(PANE_QUERIES.stillFirst);
    await expectPane(page, 'loading', 'still');
    await look(`${found.stopId}，沙盘栏：图片垫着，沙盘还在摆`, 40);

    // ---- 别的窗口：上面都是电脑的窗口。竖着拿的平板（沙盘在上，多一个“收起沙盘”的按钮；收起以后是“展开沙盘”）、
    //      横着拿的平板（题记那一行缩到最小）、一个手机那么窄的窗口（题记是窄的排法：老平板 iPadOS 15 上不管多宽都是这一种）
    await page.setViewportSize({ width: 768, height: 1024 });
    await openPane('stage=fake');
    await expectStageAt(page, headings[0]);
    const fold = pane.locator('.stage-fold');
    await expect(fold).toHaveText('收起沙盘');
    await look(`${found.stopId}，768 × 1024（沙盘在上）`, 40);
    await fold.click();
    await expect(fold).toHaveText('展开沙盘');
    await look(`${found.stopId}，768 × 1024，沙盘收起来了`, 40);
    await fold.click();
    await expect(fold).toHaveText('收起沙盘');
    // 题记放不下、被截掉的时候，行尾的省略号是浏览器自己添的，不是页面上的字（上面一段一段地问，问不到它）。
    // 这里故意把题记写长三倍让它被截掉，再问整个元素：连那个省略号在内，都得是那一行的字体画的。
    // 题记是一句话，多大都是宋体：竖着拿的平板上（18px）省略号得是随站的宋体
    //（文件里没有省略号的话，Chromium 改画三个半角的句点，用的是设备自带的字体）。
    // 横着拿的平板上题记只有 14px：那里再查一遍。
    const line = pane.locator('.stage-line');
    const cutLineFonts = async (family: string, where: string): Promise<void> => {
      expect(await line.evaluate((el) => getComputedStyle(el).fontFamily), `${where}题记的字体`).toMatch(new RegExp(`^"?${family}`));
      await line.evaluate((el) => {
        el.textContent = (el.textContent ?? '').repeat(3);
      });
      await fontsReady(page);
      expect(await line.evaluate((el) => el.scrollWidth > el.clientWidth), `${where}题记写长了三倍还没有被截掉：这一项没查到东西`).toBe(true);
      const cutLine = await fontsOfElement(client, '.stage-pane .stage-line');
      expect(cutLine.length).toBeGreaterThan(0);
      expect(
        cutLine.filter((font) => !isShipped(font, family)).map((font) => `${font.familyName}（${font.glyphCount} 个字形${font.isCustomFont ? '' : '，设备自带的'}）`),
        `${where}题记被截掉时，行尾的省略号不是随站的${family === KAI ? '楷体' : '宋体'}画的`,
      ).toEqual([]);
    };
    await cutLineFonts(SONG, '768 × 1024：');

    await page.setViewportSize({ width: 1024, height: 768 });
    await openPane('stage=fake');
    await expectStageAt(page, headings[0]);
    await look(`${found.stopId}，1024 × 768`, 40);
    await cutLineFonts(SONG, '1024 × 768：');
    // 黑体的一行也会截：沙盘旁边的时间只占一行，放不下就截掉，行尾的省略号得是随站的黑体画的（黑体的文件里有省略号）
    const date = pane.locator('.stage-date');
    expect(await date.evaluate((el) => getComputedStyle(el).fontFamily), '沙盘旁边的时间的字体').toMatch(/^"?Yanlu Sans/);
    await date.evaluate((el) => {
      el.textContent = (el.textContent ?? '').repeat(12);
    });
    await fontsReady(page);
    expect(await date.evaluate((el) => el.scrollWidth > el.clientWidth), '时间写长了十二倍还没有被截掉：这一项没查到东西').toBe(true);
    const cutDate = await fontsOfElement(client, '.stage-pane .stage-date');
    expect(cutDate.length).toBeGreaterThan(0);
    expect(cutDate.filter((font) => !isShipped(font, SANS)).map((font) => `${font.familyName}（${font.glyphCount} 个字形${font.isCustomFont ? '' : '，设备自带的'}）`), '时间被截掉时，行尾的省略号不是随站的黑体画的').toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    await openPane('stage=fake');
    await expectStageAt(page, headings[0]);
    // 窄的排法：题记和远处那句话合成一块，是宋体（宽的排法里题记自己一行，也是宋体）
    expect(await pane.locator('.stage-line').evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Yanlu Song/);
    await look(`${found.stopId}，390 × 844（题记是窄的排法）`, 40);
    await page.setViewportSize({ width: 1440, height: 900 });

    // ---- 真的沙盘摆一次（没有显卡的机器上要等一阵）
    await page.goto('about:blank');
    await page.goto(realUrl(`#/${figureId}/${found.stopId}`, 'full'));
    await expectRealTable(page, 'full', 240_000);
    await expect(pane).toHaveAttribute('data-stage-section', headings[0], { timeout: 120_000 });
    await expect(page.locator('.stage-host .strip').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1_500);
    await look(`${found.stopId} 第 1 节，真的沙盘`, 40);
  }

  // ---- 两种“没找到”
  await page.goto('about:blank');
  await page.goto(fakeUrl('#/no-such-figure'));
  await expect(page.locator('.page-title')).toHaveText('没有找到这位人物');
  await look('没有这位人物', 2);
  await page.goto('about:blank');
  await page.goto(fakeUrl(`#/${figureId}/no-such-stop`));
  await expect(page.locator('.page-title')).toHaveText('没有这一站');
  await look('没有这一站', 3);

  // ---- 页面的程序起不来时的那两句话（写在 index.html 里）：浏览器读不懂程序，程序没取到。
  //      这两句不靠程序，样式表要是 index.html 自己带着的才管得到它们（构建出来的网站是这样；对着开发服务跑时
  //      样式表是程序带进来的，程序起不来就没有样式，那时不查）。
  for (const [label, says, answer] of [
    ['程序起不来：浏览器读不懂', PANE_SAYS.tooOld, (route: Route) => route.fulfill({ contentType: 'text/javascript', body: "throw new Error('这个浏览器读不懂这段程序');" })],
    ['程序起不来：没取到', PANE_SAYS.cut, (route: Route) => route.abort()],
  ] as const) {
    await page.goto('about:blank');
    await page.route(MAIN_SCRIPT, answer);
    await page.goto(fakeUrl('#/'));
    await expect(page.locator('#too-old')).toHaveText(says);
    if (await page.evaluate(() => document.querySelector('link[rel="stylesheet"]') !== null)) await look(label, 1);
    await page.unroute(MAIN_SCRIPT);
  }

  console.log(
    [
      `看了 ${visited.length} 处，显出来的字 ${tally.runs} 段（样式是黑体的 ${tally.sansRuns} 段，是楷体的 ${tally.kaiRuns} 段、都在题签上），字形 ${tally.glyphs} 个（黑体画的 ${tally.sansGlyphs} 个，楷体画的 ${tally.kaiGlyphs} 个）：全是随站的字体画的`,
      `两个全角标点挨着（字号 100px）：宋体 ${songMarks} 像素（不写 text-spacing-trim: space-all 的话，这个浏览器里是 ${untrimmed}）；楷体不量，题签上的字里没有标点`,
      `黑体（文件里留着 halt；字号 100px）：冒号和前括号挨着，照页面的写法 ${sansMarks.plain} 像素（不写 text-spacing-trim: space-all 的话是 ${sansMarks.untrimmed}）；开着 halt，“州：大” ${sansMarks.haltTitle} 像素、冒号和前括号 ${sansMarks.haltPair} 像素；不开 halt，“州：大” ${sansMarks.plainTitle} 像素`,
      ...visited.map((label) => `  ${label}`),
    ].join('\n'),
  );
  // 确实查到了东西：黑体的字（标题、标签、按钮）到处都是；楷体的只有题签上的。量到过的数（2026-11-24，四座沙盘）：
  // 黑体 2399 段、8301 个字形，楷体 265 段、577 个字形。下面两个数是留了余地的下限：少到这以下，是这一趟没走全
  expect(tally.sansGlyphs).toBeGreaterThan(4000);
  expect(tally.kaiGlyphs).toBeGreaterThan(300);

  // ---- 没有一个请求出了网站自己的地址
  expect(requests.length).toBeGreaterThan(20);
  const base = baseURL ?? page.url();
  expect(requests.filter((url) => !isOwn(url, base)), '出了网站自己地址的请求').toEqual([]);
  console.log(`一共 ${requests.length} 个请求，都是网站自己的地址（${new URL(base).origin}）`);
});

/**
 * 第三个字体文件被要的那一刻，页面上是什么样：给“不该这么早取”那一条通不过时印出来，好知道是谁把它引来的。
 * 它是页面上画出了那个文件里的字才取的。平常这些字都折着：小注没点开，原文和凭据折着（折着的东西浏览器不排版），
 * 图片的 alt 不显出来。见过的三种会把它提前引来的情形：一张带 alt 的图片没取到（浏览器把 alt 当字画出来）；
 * 有程序去量折着的东西里面的字（一量，浏览器就得把它排出来）；测试工具用“看得见了没有”等正文出来
 *（十几遍里有一遍，见下面那一项里的说明）。所以记这几样：在哪一页，沙盘栏什么状态，
 * 点开了几条小注、几处折着的，哪张图片没取到，页面上显出来的字里哪几段带着那个文件里的字
 *（这一项是空的、又没有坏的图片：要么是页面的程序自己叫浏览器去取的，要么是折着的东西被排了一遍）。
 * 只在请求发出以后才去看页面（看的时候不会再引来什么：该取的已经取了）。
 * 试过问浏览器的调试接口“这个请求是谁发的”：不管是程序叫取的还是排字引来的，它都只说是样式表（parser），分不出来，所以没有用它。
 */
function sceneWhenAsked(page: Page): () => Promise<string> {
  const record = JSON.parse(new TextDecoder().decode(readBytes('src/fonts/fonts.json'))) as { files: { group: string; characters: string }[] };
  const more = record.files.find((file) => file.group === 'song-more')?.characters ?? '';
  let scene: Promise<string> | null = null;
  page.on('request', (request) => {
    if (scene !== null || fontFileOf(request.url()) !== 'yanlu-song-more') return;
    scene = page
      .evaluate((more) => {
        const inFile = new Set(more);
        const shown: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const el = node.parentElement;
          const text = node.textContent ?? '';
          if (!el || el.closest('script, style') || !Array.from(text).some((ch) => inFile.has(ch))) continue;
          // 折着的东西里面的字不算显出来（checkVisibility 认得出，也不会叫浏览器去排它）
          if (el.checkVisibility()) shown.push(`${el.tagName.toLowerCase()}.${el.className}“${text.trim().slice(0, 12)}”`);
        }
        const pane = document.querySelector('.stage-pane');
        return JSON.stringify({
          at: location.hash,
          stop: document.querySelector('.stop-page')?.getAttribute('data-stop-text') ?? null,
          pane: pane ? `${pane.getAttribute('data-stage-state')} / ${pane.getAttribute('data-stage-picture')}` : null,
          notesOpen: document.querySelectorAll('.note').length,
          foldsOpen: document.querySelectorAll('details[open]').length,
          // 没取到、又带着 alt 的图片（alt 是空的不算：没有字可画，放每一小节图片的地方就有一张这样空着的）
          brokenImages: Array.from(document.images)
            .filter((img) => img.complete && img.naturalWidth === 0 && (img.getAttribute('alt') ?? '') !== '')
            .map((img) => (img.getAttribute('alt') ?? '').slice(0, 12)),
          shown: shown.slice(0, 8),
        });
      }, more)
      .catch((error: unknown) => `没看成：${String(error)}`);
  });
  return async () => (scene === null ? '（没有记到）' : scene);
}

/** 记下每一个字体文件被请求的时刻（从记录开始算起的毫秒）。now() 是这时候的同一种读数。 */
function watchFonts(page: Page): { of: (file: string) => number[]; all: () => string[]; now: () => number } {
  const started = Date.now();
  const seen: { name: string; at: number }[] = [];
  page.on('request', (request) => {
    const name = fontFileOf(request.url());
    if (name) seen.push({ name, at: Date.now() - started });
  });
  return { of: (file) => seen.filter((item) => item.name === file).map((item) => item.at), all: () => seen.map((item) => `${item.name}@${item.at}`), now: () => Date.now() - started };
}

test('第三个字体文件：首页、人物页、还没写的站上不取；写好的站上，点开不到两秒不取，字体到齐以后五秒之内自己取来，只取一次；黑体、头一个宋体文件、楷体各只取一次', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const fonts = watchFonts(page);
  const whenAsked = sceneWhenAsked(page);
  // 不用沙盘的替身（它上面给测试看的字会把第三个文件引来）；只放图片，不摆立体的沙盘
  const url = (hash: string): string => realUrl(hash, null, '&tier=still');

  // 首页：等五秒
  await page.goto(url('#/'));
  const card = page.locator('a.card[data-available="true"]').first();
  await expect(card).toBeVisible();
  const figureId = (await card.getAttribute('data-figure-id'))!;
  // 首页的沙盘栏里摆着全程沙盘（这里是它的图片，上面的题签、下面的题记和立体的那一档是同样的字）：等它摆出来、题签挂上了再数那五秒，
  // 不然“没有取”说的只是一页还空着的首页。全程沙盘不用点开就看得见的字都在头两个文件里（做字体的工具把它们归在大家共用的那一拨）
  await expect(stagePane(page)).toHaveAttribute('data-stage-picture', 'still', { timeout: 60_000 });
  await expect(stagePane(page)).toHaveAttribute('data-stage-level', 'route');
  await expect.poll(() => page.locator('.stage-pane .strip').evaluateAll((strips) => strips.filter((strip) => getComputedStyle(strip).visibility === 'visible').length), { message: '首页的全程沙盘上题签该挂出来' }).toBeGreaterThan(5);
  await expect(page.locator('.stage-pane .stage-line')).not.toBeEmpty();
  await fontsReady(page);
  await page.waitForTimeout(5_000);
  expect(fonts.of('yanlu-song-more'), `首页上等了五秒，第三个字体文件不该取（取字体的记录：${fonts.all().join(' ')}）`).toEqual([]);

  // 人物页：等五秒
  await card.click();
  await expect(page.locator('.stop-item').first()).toBeVisible();
  await fontsReady(page);
  await page.waitForTimeout(5_000);
  expect(fonts.of('yanlu-song-more'), `人物页上等了五秒，第三个字体文件不该取（${fonts.all().join(' ')}）`).toEqual([]);

  // 还没写的一站：等三秒半也不取。没有自己的沙盘的，那里没有要点开的东西；有自己的沙盘的（眉州）有一行折着的凭据，
  // 同人物页一样，点开的那一刻才取——单子“沙盘上看的几处”上的字不用点就看得见，都得在头两个字体文件里
  const unwritten = page.locator('.stop-item:not([data-stop-status="complete"])').first();
  let unwrittenId: string | null = null;
  if ((await unwritten.count()) > 0) {
    unwrittenId = await unwritten.getAttribute('data-stop-id');
    await unwritten.click();
    await expect(page.locator('.not-written')).toBeVisible();
    await fontsReady(page);
    await page.waitForTimeout(3_500);
    expect(fonts.of('yanlu-song-more'), `还没写的一站（${unwrittenId}）上等了三秒半，第三个字体文件不该取（${fonts.all().join(' ')}）`).toEqual([]);
    await page.goBack();
    await expect(page.locator('.stop-item').first()).toBeVisible();
  }

  // 写好的一站：页面是“正文出来、头两个文件到齐以后再过两秒”才去取的。
  // 下限：从点开这一站算起，不到两秒不该取。两头用的都是测试这一边的钟，起点取在点之前、终点是浏览器真的发出请求以后，
  // 所以机器再慢，量出来的只会比页面上的两秒长，不会短：这一条不会因为机器慢而误报。
  // 上限：字体到齐以后五秒之内自己取来。
  const found = await firstStopWithScene(page, figureId);
  const stopId = found ? found.stopId : await firstWrittenStop(page);
  //
  // 等正文出来，这里不用测试工具的“看得见了没有”（toBeVisible）：那一种等法每隔几十毫秒问一遍浏览器这个元素的样式和框。
  // 用它等的时候，十几遍里有一遍，第三个文件在点开以后 100 到 116 毫秒就被要了；那一刻页面上显出来的字里没有那个文件里的字，
  // 也没有坏的图片（见 sceneWhenAsked），页面自己的那一步也还没有走到（那一步要等两秒）。为什么会这样没有查到底；
  // 量到的是（同样的走法，每种 80 遍，数第三个文件在点开以后两秒之内就被要的有几遍）：
  // 用 toBeVisible 等，这一版页面 6 遍、换样子以前的页面 1 遍；只问“页面上有没有这个元素”，0 遍；后面再照常等字体到齐，也是 0 遍。
  // 所以是这种等法自己把文件引来的，不是页面取的：这里只问有没有，不问看不看得见。
  // 下面那条“不到两秒不该取”一点没有放松；它通不过时会印出取的那一刻页面上是什么样。
  const clicked = fonts.now();
  await page.locator(`.stop-item[data-stop-id="${stopId}"]`).click();
  await page.waitForFunction(() => document.querySelector('.text-section') !== null);
  await fontsReady(page);
  const ready = fonts.now();
  await expect.poll(() => fonts.of('yanlu-song-more').length, { timeout: 5_000, message: '站点页的字体到齐五秒了，第三个字体文件还没有自己取来' }).toBe(1);
  const asked = fonts.of('yanlu-song-more')[0];
  expect(asked - clicked, `从点开这一站到取第三个字体文件，不该不到两秒（${fonts.all().join(' ')}；点开是在 ${clicked}）。取的那一刻页面上：${await whenAsked()}`).toBeGreaterThanOrEqual(2_000);
  const took = asked - ready;
  await fontsReady(page);

  // 点开小注、原文、凭据，再换一站：不再取
  await page.evaluate(() => {
    for (const term of Array.from(document.querySelectorAll<HTMLElement>('.note-term'))) term.click();
    for (const fold of Array.from(document.querySelectorAll<HTMLDetailsElement>('details.original, details.provenance'))) fold.open = true;
  });
  await expect(page.locator('.note')).not.toHaveCount(0);
  await foldBodiesReady(page);
  await expect(page.locator('.provenance-body .provenance-item')).not.toHaveCount(0);
  await fontsReady(page);
  const next = page.locator('.guide-dock a[rel="next"]');
  if ((await next.count()) > 0) {
    await next.evaluate((link: HTMLElement) => link.click());
    await expect(page.locator('.page-title')).toBeVisible();
    await fontsReady(page);
    await page.waitForTimeout(3_500);
  }
  expect(fonts.of('yanlu-song-more'), `第三个字体文件只该取一次（${fonts.all().join(' ')}）`).toHaveLength(1);
  expect(fonts.of('yanlu-sans'), `黑体文件只该取一次（${fonts.all().join(' ')}）`).toHaveLength(1);
  expect(fonts.of('yanlu-song'), `头一个宋体文件只该取一次（${fonts.all().join(' ')}）`).toHaveLength(1);
  // 楷体的文件不预先声明：首页一知道要摆全程沙盘就去取，题签摆出来不再取，一共只取一次
  expect(fonts.of('yanlu-kai'), `楷体文件只该取一次（${fonts.all().join(' ')}）`).toHaveLength(1);
  console.log(
    `${figureId}/${stopId}：第三个字体文件是点开这一站以后 ${asked - clicked} 毫秒、字体到齐以后 ${took} 毫秒取的，以后没有再取；` +
      `${unwrittenId ? `还没写的一站（${unwrittenId}）上没有取。` : '没有还没写的站可试。'}取字体的记录（文件@毫秒）：${fonts.all().join(' ')}`,
  );
});

test('“来源”页：在首页上等着，第三个字体文件和那一页的程序都不取；点进“来源”页才取，各只取一次；那一页上的字都画出来了；直接打开“来源”页，楷体的文件一次也不取', async ({ page, browser, baseURL }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const fonts = watchFonts(page);
  const whenAsked = sceneWhenAsked(page);
  const scripts: string[] = [];
  const all: string[] = [];
  page.on('request', (request) => {
    all.push(request.url());
    // “来源”页里面的那一段程序（构建以后叫 assets/SourcesBody-….js；对着开发服务跑时是 src/ui/SourcesBody.tsx）
    if (new URL(request.url()).pathname.includes('/SourcesBody')) scripts.push(request.url());
  });

  // “来源”页上的话里真的有头两个文件里没有的字（不然这一项查不到东西）：照做字体的记录读
  const record = JSON.parse(new TextDecoder().decode(readBytes('src/fonts/fonts.json'))) as { files: { group: string; characters: string }[] };
  const group = (name: string): string => record.files.find((file) => file.group === name)?.characters ?? '';
  const words = new TextDecoder().decode(readBytes('src/ui/sourcesText.ts'));
  const onlyLater = [...new Set(words)].filter((ch) => ch > '~' && group('song-more').includes(ch) && !group('song').includes(ch));
  expect(onlyLater.length, '“来源”页上的话里，只在点开才要的那个字体文件里有的字').toBeGreaterThan(0);

  // 首页（不用沙盘的替身，和上一项一样）：等五秒，都不取
  await page.goto(realUrl('#/', null, '&tier=still'));
  await expect(page.locator('a.card[data-available="true"]').first()).toBeVisible();
  await expect(stagePane(page)).toHaveAttribute('data-stage-picture', 'still', { timeout: 60_000 });
  await fontsReady(page);
  await page.waitForTimeout(5_000);
  expect(fonts.of('yanlu-song-more'), `首页上等了五秒，第三个字体文件不该取（${fonts.all().join(' ')}）。取的那一刻页面上：${fonts.of('yanlu-song-more').length > 0 ? await whenAsked() : ''}`).toEqual([]);
  expect(scripts, '首页上不该取“来源”页里面的那一段程序').toEqual([]);

  // 点卡片后面的“来源”
  await page.locator('.home .stop-nav a').evaluate((link: HTMLElement) => link.click());
  await expect(page).toHaveURL(/#\/sources$/);
  await expect(page.locator('.sources .page-title')).toHaveText('来源');
  await expect(page.locator('.sources-lead')).toBeVisible();
  await expect(page.locator('.sources-list li').first()).toBeVisible();
  await expect(page.locator('.sources .quiet')).toHaveCount(0);
  await fontsReady(page);
  await expect.poll(() => fonts.of('yanlu-song-more').length, { message: '点进“来源”页以后，第三个字体文件该取来（那一页上有它才有的字）' }).toBe(1);
  await fontsReady(page);
  expect(scripts, '“来源”页里面的那一段程序：点进去才取，只取一次').toHaveLength(1);
  // 楷体那一条里有“楷”“鹜”这些头两个文件里没有的字：问浏览器这一段是拿什么字体画的，得全是随站的宋体
  //（整页每一段字都查的是上面“走一遍网站”那一项）
  //（三套字体照黑体、宋体、楷体排：楷体那一条照 data-font 找，不靠它排第几）
  const KAI_ITEM = `.sources-item[data-font="${KAI}"] p`;
  const kaiLine = page.locator(KAI_ITEM).first();
  expect([...onlyLater].some((ch) => SOURCES_KAI_LINE.includes(ch)), '楷体那一条里没有只在第三个文件里有的字：这一句查不到东西').toBe(true);
  await expect(kaiLine).toHaveText(SOURCES_KAI_LINE);
  const client = await debugger_(page);
  const used = await fontsOfElement(client, KAI_ITEM);
  expect(used.reduce((sum, font) => sum + font.glyphCount, 0), '楷体那一条画出来的字形').toBeGreaterThanOrEqual([...SOURCES_KAI_LINE].filter((ch) => ch !== ' ').length);
  expect(used.filter((font) => !isShipped(font, SONG)).map((font) => `${font.familyName}（${font.glyphCount} 个字形）`), '“来源”页上楷体那一条里有字不是随站的宋体画的').toEqual([]);
  // 回首页再进来：都不再取
  await page.locator('.sources .crumbs a').evaluate((link: HTMLElement) => link.click());
  await expect(page.locator('.card').first()).toBeVisible();
  await page.locator('.home .stop-nav a').evaluate((link: HTMLElement) => link.click());
  await expect(page.locator('.sources-list li').first()).toBeVisible();
  await fontsReady(page);
  expect(fonts.of('yanlu-song-more'), `第三个字体文件只该取一次（${fonts.all().join(' ')}）`).toHaveLength(1);
  expect(scripts, '“来源”页里面的那一段程序只该取一次').toHaveLength(1);
  // 从头到尾没有一个请求出了网站自己的地址（这一页上有通到别的网站的链接，页面不去取它们）
  const base = baseURL ?? page.url();
  expect(all.filter((url) => !isOwn(url, base)), '出了网站自己地址的请求').toEqual([]);
  console.log(`“来源”页：只在第三个字体文件里有的字 ${onlyLater.length} 个（${onlyLater.join('')}）；那个文件是点进这一页以后取的（${fonts.all().join(' ')}）；里面的程序 ${scripts.map((url) => url.slice(url.lastIndexOf('/') + 1)).join('、')} 取了一次`);

  // 直接打开“来源”页（另开一个干净的页面，什么都没存着）：这一页上没有沙盘、没有题签，楷体的文件一次也不取；
  // 黑体和头一个宋体文件照常各取一次。等字体到齐以后再多等两秒
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL });
  try {
    const direct = await context.newPage();
    const asked = watchFonts(direct);
    await direct.goto(realUrl('#/sources', null, '&tier=still'));
    await expect(direct.locator('.sources .page-title')).toHaveText('来源');
    await expect(direct.locator('.sources-list li').first()).toBeVisible();
    await expect(direct.locator('.sources .quiet')).toHaveCount(0);
    await fontsReady(direct);
    await direct.waitForTimeout(2_000);
    expect(asked.of('yanlu-kai'), `直接打开“来源”页，楷体的文件不该取（${asked.all().join(' ')}）`).toEqual([]);
    expect({ sans: asked.of('yanlu-sans').length, song: asked.of('yanlu-song').length }, `直接打开“来源”页，黑体和头一个宋体文件各取一次（${asked.all().join(' ')}）`).toEqual({ sans: 1, song: 1 });
  } finally {
    await context.close();
  }
});

/**
 * 压住几个字体文件不给，直到叫 release() 才放行（不按时间放：机器慢的时候，定死的几秒可能在查之前就过去了）。
 * held() 是现在压着几个请求。
 */
async function holdFonts(page: Page, files: string[]): Promise<{ release: () => void; held: () => number }> {
  let open: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  let held = 0;
  await page.route(
    (url) => files.includes(fontFileOf(url.href) ?? ''),
    async (route) => {
      held++;
      await gate;
      await route.continue().catch(() => {});
    },
  );
  return { release: open, held: () => held };
}

/**
 * 不等字体，照现在的样子拍一张（测试工具自己的拍照会先等字体到齐，字体压着的时候它就一直等，拍不到“还没到”的样子；
 * 这里直接叫浏览器拍）。
 */
async function shootNow(client: CDPSession, path: string): Promise<void> {
  const { data } = (await client.send('Page.captureScreenshot', { format: 'png' })) as { data: string };
  mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
  writeFileSync(path, Uint8Array.from(atob(data), (ch) => ch.charCodeAt(0)));
}

/** 沙盘栏的按钮、底下“问讲解员”的按钮、标题：这几样都是黑体，黑体到之前也得有字。 */
const MUST_HAVE_WORDS = '.stage-controls button, .guide-open, .page-title';

/** 几段字各是什么字体画的，写成一句话。 */
function saidOf(items: { run: Run; fonts: UsedFont[] }[]): string {
  return items.map((item) => `“${item.run.text}”：${item.fonts.map((font) => `${font.familyName}${font.isCustomFont ? '（随站的）' : '（设备自带的）'}×${font.glyphCount}`).join('、') || '没有字形'}`).join('；');
}

for (const slow of [
  { name: '黑体文件来得慢', files: ['yanlu-sans'], shot: 'slow-sans', late: [SANS] },
  { name: '头两个字体文件都来得慢', files: ['yanlu-sans', 'yanlu-song'], shot: 'slow-both', late: [SANS, SONG] },
]) {
  test(`${slow.name}（压住不给）：过了一秒，按钮和标题上都有字，先用别的字体顶着；放行以后按钮和标题换成随站的黑体`, async ({ page, browser, baseURL }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    // 先不压，找到有沙盘的那一站
    const { figureId, found } = await openFigureWithTable(page, fakeUrl('#/'));
    const stopId = found ? found.stopId : await firstWrittenStop(page);
    await page.goto('about:blank');

    // 另开一个干净的页面（什么都没存着），压住字体文件，从头打开这一站。用真的沙盘：读者平常看到的就是它
    //（图片先垫着，沙盘随后才摆好；这里只看头一两秒，不等它）。
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', baseURL });
    const fresh = await context.newPage();
    try {
      const gate = await holdFonts(fresh, slow.files);
      const client = await debugger_(fresh);
      const started = Date.now();
      // 不等页面“加载完”：字体文件压着的时候，浏览器不认为页面加载完了
      await fresh.goto(realUrl(`#/${figureId}/${stopId}`, 'full'), { waitUntil: 'commit' });
      await expect(fresh.locator('.page-title')).toBeVisible();
      await expect(fresh.locator('.text-section').first()).toBeVisible();
      await expect(fresh.locator('.stage-controls button').first()).toBeVisible();
      await expect(fresh.locator('.guide-open')).toBeVisible();
      await fresh.waitForTimeout(1_000);
      const waited = Date.now() - started;
      expect(gate.held(), '要压住的字体文件，浏览器都来要过了（压着没放）').toBe(slow.files.length);

      const early = await fontsOfRuns(fresh, client, MUST_HAVE_WORDS, false);
      expect(early.length).toBeGreaterThanOrEqual(4);
      for (const item of early) {
        expect(item.fonts.reduce((sum, font) => sum + font.glyphCount, 0), `压着字体文件的时候，“${item.run.text}”上没有字（${saidOf(early)}）`).toBeGreaterThan(0);
        for (const font of item.fonts) for (const family of slow.late) expect(isShipped(font, family), `“${item.run.text}”已经是 ${family} 画的了：文件没有压住，这一项没查到东西`).toBe(false);
      }
      // 正文这时候是什么字体画的，记一笔（只压黑体时已经是随站的宋体；两个都压着时是设备自带的）
      const body = await fontsOfRuns(fresh, client, '.stop-text p', false);
      const bodyFonts = [...new Set(body.flatMap((item) => item.fonts.map((font) => `${font.familyName}${font.isCustomFont ? '（随站的）' : '（设备自带的）'}`)))];
      expect(body.length).toBeGreaterThan(0);
      for (const item of body) expect(item.fonts.reduce((sum, font) => sum + font.glyphCount, 0), `压着字体文件的时候，正文“${item.run.text}”上没有字`).toBeGreaterThan(0);
      await shootNow(client, `${DIR}/${slow.shot}-1440x900.png`);
      console.log(`${slow.name}：打开 ${waited} 毫秒时，${saidOf(early)}。正文：${bodyFonts.join('、')}`);

      // 放行：换成随站的黑体
      gate.release();
      let late = early;
      await expect
        .poll(
          async () => {
            late = await fontsOfRuns(fresh, client, MUST_HAVE_WORDS, false);
            return late.every((item) => item.fonts.length > 0 && item.fonts.every((font) => isShipped(font, SANS)));
          },
          { timeout: 30_000, message: '字体文件放行以后，按钮和标题没有换成随站的黑体' },
        )
        .toBe(true);
      console.log(`${slow.name}：放行以后，${saidOf(late)}`);
    } finally {
      await context.close();
    }
  });
}

test('楷体文件来得慢（它不预先声明，总比页面晚到）：题签上有字，先用设备上的楷体或者随站的宋体顶着；到了换成随站的楷体', async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  // 先不压，找到有沙盘的那一站
  const { figureId, found } = await openFigureWithTable(page, fakeUrl('#/'));
  test.skip(!found, '还没有哪一站有沙盘');
  if (!found) return;
  await page.goto('about:blank');

  // 另开一个干净的页面（什么都没存着），压住楷体的文件，从头打开这一站。只放图片（题签是页面摆的，和立体的那一档是同样的字）
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', baseURL });
  const fresh = await context.newPage();
  try {
    const gate = await holdFonts(fresh, ['yanlu-kai']);
    const client = await debugger_(fresh);
    await fresh.goto(realUrl(`#/${figureId}/${found.stopId}`, null, '&tier=still'), { waitUntil: 'commit' });
    const strips = fresh.locator('.stage-still-host .strip');
    await expect(stagePane(fresh)).toHaveAttribute('data-stage-picture', 'still', { timeout: 60_000 });
    await expect.poll(() => strips.evaluateAll((items) => items.filter((item) => getComputedStyle(item).visibility === 'visible').length), { message: '题签该挂出来（楷体的文件压着也一样）' }).toBeGreaterThan(0);
    // 楷体的文件浏览器来要过了（它不预先声明；页面一知道要摆沙盘就叫浏览器去取，题签摆出来的时候不再要第二次）：压着没放，只有一次
    await expect.poll(() => gate.held(), { message: '题签摆出来以后，浏览器该来要过楷体的文件' }).toBe(1);
    await fresh.waitForTimeout(1_000);
    expect(gate.held(), '楷体的文件只要了一次（页面先要的那一次和题签引来的是同一次）').toBe(1);

    const STRIP_WORDS = '.stage-still-host .strip';
    /** 显出来的每一条题签：写的什么，在哪，多大（像素，不取整）。 */
    const boxes = (): Promise<{ text: string; x: number; y: number; width: number; height: number }[]> =>
      strips.evaluateAll((items) =>
        items
          .filter((item) => getComputedStyle(item).visibility === 'visible')
          .map((item) => {
            const box = item.getBoundingClientRect();
            return { text: item.textContent ?? '', x: box.x, y: box.y, width: box.width, height: box.height };
          }),
      );
    const said = (list: { text: string; width: number; height: number }[]): string => list.map((item) => `${item.text}：${Math.round(item.width * 10) / 10} × ${Math.round(item.height * 10) / 10}`).join('、');
    const early = await fontsOfRuns(fresh, client, STRIP_WORDS, false);
    const earlyBoxes = await boxes();
    expect(early.length, '题签上的字').toBeGreaterThan(0);
    for (const item of early) {
      expect(item.fonts.reduce((sum, font) => sum + font.glyphCount, 0), `压着楷体文件的时候，题签“${item.run.text}”上没有字（${saidOf(early)}）`).toBeGreaterThan(0);
      for (const font of item.fonts) {
        expect(isShipped(font, KAI), `题签“${item.run.text}”已经是随站的楷体画的了：文件没有压住，这一项没查到东西`).toBe(false);
        // 顶着的只许是设备自带的字体（电脑上多半有楷体），或者随站的宋体（题签上的每一个字头一个宋体文件里都有一份）
        expect(!font.isCustomFont || isShipped(font, SONG), `压着楷体文件的时候，题签“${item.run.text}”是 ${font.familyName} 画的：既不是设备自带的，也不是随站的宋体`).toBe(true);
      }
    }
    await shootNow(client, `${DIR}/slow-kai-1440x900.png`);
    console.log(`楷体文件来得慢：压着的时候，${saidOf(early)}`);

    // 放行：换成随站的楷体
    gate.release();
    let late = early;
    await expect
      .poll(
        async () => {
          late = await fontsOfRuns(fresh, client, STRIP_WORDS, false);
          return late.length > 0 && late.every((item) => item.fonts.length > 0 && item.fonts.every((font) => isShipped(font, KAI)));
        },
        { timeout: 30_000, message: '楷体的文件放行以后，题签没有换成随站的楷体' },
      )
      .toBe(true);
    // 换了字体，题签不动：每一条还在原处，还是那么大（差不过半个像素）。换完字体页面要重排一遍，量一次不算数，等到量出来对上为止
    const moved = (now: { text: string; x: number; y: number; width: number; height: number }[]): string[] => {
      if (now.length !== earlyBoxes.length) return [`题签原来 ${earlyBoxes.length} 条，现在 ${now.length} 条`];
      return now.flatMap((item, i) => {
        const was = earlyBoxes[i];
        const same = item.text === was.text && Math.abs(item.x - was.x) <= 0.5 && Math.abs(item.y - was.y) <= 0.5 && Math.abs(item.width - was.width) <= 0.5 && Math.abs(item.height - was.height) <= 0.5;
        return same ? [] : [`“${was.text}”原来在 (${was.x.toFixed(1)}, ${was.y.toFixed(1)})、${was.width.toFixed(1)} × ${was.height.toFixed(1)}，现在“${item.text}”在 (${item.x.toFixed(1)}, ${item.y.toFixed(1)})、${item.width.toFixed(1)} × ${item.height.toFixed(1)}`];
      });
    };
    let lateBoxes = earlyBoxes;
    await expect.poll(async () => moved((lateBoxes = await boxes())), { message: '楷体的文件到了以后，题签挪了地方或者变了大小（差过了半个像素）' }).toEqual([]);
    console.log(`楷体文件来得慢：放行以后，${saidOf(late)}。题签的大小，换字体以前：${said(earlyBoxes)}；以后：${said(lateBoxes)}（一样，差不过半个像素）`);
  } finally {
    await context.close();
  }
});

/** 沙盘程序那一块代码的网址：构建出来叫 assets/engine-一串字符.js；对着开发服务跑时是源文件。和 pane-stills.spec.ts 里的是同一句。 */
const ENGINE_REQUEST = /\/engine(-[\w-]+)?\.(js|ts)(\?.*)?$/;
/** 图片的网址：每一小节的定格图、先画好的地面都是图片文件。 */
const PICTURE_REQUEST = /\.(jpe?g|png|webp)(\?.*)?$/;

test('楷体的文件先要：一知道这一栏要摆沙盘，页面就叫浏览器去取，不等图片、也不等沙盘程序——把图片和沙盘程序都压住，栏上还没有画面、题签一条也没摆，楷体的文件照样来要了；放行以后题签是随站的楷体，文件一共只要一次', async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  // 先不压，找到有沙盘的那一站
  const { figureId, found } = await openFigureWithTable(page, fakeUrl('#/'));
  expect(found, '要有一站有自己的沙盘，这一项才查得到东西').not.toBeNull();
  if (!found) return;
  await page.goto('about:blank');

  // 另开一个干净的页面（什么都没存着），压住图片和沙盘程序，从头打开这一站。用真的沙盘，指定完整的一档：读者平常看到的就是它
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', baseURL });
  const fresh = await context.newPage();
  try {
    let open: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const held: string[] = [];
    await fresh.route(
      (url) => PICTURE_REQUEST.test(url.pathname) || ENGINE_REQUEST.test(url.pathname),
      async (route) => {
        held.push(new URL(route.request().url()).pathname.split('/').pop() ?? '');
        await gate;
        await route.continue().catch(() => {});
      },
    );
    const fonts = watchFonts(fresh);
    const client = await debugger_(fresh);
    await fresh.goto(realUrl(`#/${figureId}/${found.stopId}`, 'full'), { waitUntil: 'commit' });

    // 图片和沙盘程序都压着：楷体的文件照样来要了。没有页面里那一句“先去取”的话，它要等题签摆出来才要，这里就等不到
    await expect
      .poll(() => fonts.of('yanlu-kai').length, { timeout: 30_000, message: '图片和沙盘程序都压着的时候，页面该已经叫浏览器去取楷体的文件了（它不等题签摆出来）' })
      .toBe(1);
    // 这时候栏上什么画面都没有，题签一条也没有摆出来：这一次不是排题签引来的
    const atAsk = await fresh.evaluate(() => ({
      picture: document.querySelector('.stage-pane')?.getAttribute('data-stage-picture') ?? null,
      strips: Array.from(document.querySelectorAll('.stage-pane .strip')).filter((strip) => getComputedStyle(strip).visibility === 'visible').length,
    }));
    expect(atAsk, '楷体的文件来要的时候，栏上还没有画面，也没有题签').toEqual({ picture: 'none', strips: 0 });
    await expect.poll(() => held.length, { message: '图片或者沙盘程序该来要过了（压着没放）：不然这一项没有压住什么' }).toBeGreaterThanOrEqual(1);
    const heldAtAsk = [...held];

    // 放行：图片出来，题签摆出来，是随站的楷体画的；楷体的文件前后只要了一次
    open();
    const STRIP_WORDS = '.stage-pane .strip';
    let drawn: { run: Run; fonts: UsedFont[] }[] = [];
    await expect
      .poll(
        async () => {
          drawn = await fontsOfRuns(fresh, client, STRIP_WORDS, false);
          return drawn.length > 0 && drawn.every((item) => item.fonts.length > 0 && item.fonts.every((font) => isShipped(font, KAI)));
        },
        { timeout: 60_000, message: '放行以后，题签该摆出来，是随站的楷体画的' },
      )
      .toBe(true);
    expect(fonts.of('yanlu-kai').length, '楷体的文件一共只要一次（先要的那一次，题签摆出来不再要）').toBe(1);
    console.log(`楷体的文件先要：打开 ${fonts.of('yanlu-kai')[0]} 毫秒时来要的，那时压着的是 ${heldAtAsk.join('、')}；放行以后题签 ${drawn.length} 段字都是随站的楷体，文件只要了一次`);
  } finally {
    await context.close();
  }
});

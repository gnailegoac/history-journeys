// 沙盘栏的样子，在真的页面上量。只量说得出数的几样；好不好看要看照片。
// 沙盘栏的底是一块绢（tokens.css 的 --color-paper-sunk）；摆在绢上的东西——按钮、题签、展开的说明——是纸条。
//
// 一、绢上的字都是墨色，够深。沙盘栏里显出来的每一段字，往上找到垫在它下面的那一层底色：
//     直接落在绢上的（栏自己、题记那一条、按钮下面那一行话），字的颜色只许是墨色或者“绢上的墨色”（墨色九成二），
//     和绢比不低于 6 比 1；落在纸条上的，和纸条比不低于 4.5 比 1（点不了的按钮除外）。每一种配法印出来。
//     焦点框：沙盘栏自己、它里面的按钮，框都是墨色（红框在绢上只有 2.9 比 1）。
// 二、四种标准的窗口上，沙盘栏里给读者看的字没有小于 14px 的；小节名、题记、说明、时间、比例尺、“北”、
//     两个小按钮各是多大、什么字体，一样一样对。题记那一行：够 16px 才是楷体，不到是宋体。
//     窄的排法（沙盘栏不到 584 像素宽；拿 1000 × 768 的窗口量，栏 560 宽）也一样：没有小于 14px 的字，
//     题记那一块 94 像素高，题记和远处两行、说明一行都看得全。
// 三、题记写满 40 个字（场景里许可的最多的字数），从 560 像素宽的栏往上，哪一种栏宽都放得下：
//     584 像素起是宽的排法，一行，不截断，字号不小于 14px；不到 584 是窄的排法，连同远处两行放得下。
//     窗口从窄到宽换二十几种宽度，每一种都量。
// 四、按钮、题记那一条、题签的样子：古名今名选中的是红字加一个实心的小红方块，不铺红底，换着选按钮不挪地方；
//     题记那一条的底是绢色、上边一道细线，没有淡出去的一截；题签脚上有一方印，水名是靛青，远处是虚线；窄的栏上题签小一号。
// 五、人物页上的全程图片：电脑和横着拿的平板上，图片、题记、说明、出处都在栏里，不用在栏里滚；图片没有被压扁。
//     竖着拿的两种平板上图片在上面、跟着页面滚走，和放它的地方一样宽。
// 六、“老平板”的替身：把构建出来的样式表照 iPadOS 15 的读法改一遍（@container 的块去掉，用了 cqw 的声明作废；
//     tests/support/oldIpadSheet.ts），拿它顶替真的样式表。三种平板的窗口上（竖着的、横着的、竖着的大平板）：沙盘栏的大小和四边留的空
//     就是标准的那几个数，题记是宽的排法（130 像素高），字没有小于 14px 的，题记和说明没有被截掉，题签是大的那一种。
//     题记的排法现在不靠 @container 了（页面量了栏宽挂类名），所以这一项证明的是两件事：样式表里确实没有老平板会丢掉的东西
//     （改完一个字不差）；就算以后有人再写进去，丢掉以后是什么样，这里会量出来。它是照规矩推出来的替身，不是 Safari。
//
// 沙盘用的是替身（?stage=fake）。数从真的页面读：栏宽是量的，不是写死的。

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { STANDARD_PANES } from '../stage/support/standardPanes';
import { STRIP_NARROW_BELOW_PX } from '../stage/support/stripSizes';
import { oldIpadSheet } from '../support/oldIpadSheet';
import { expectStageAt, expectStill, fakeStage, fakeUrl, firstWrittenStopWithoutScene, fontsReady, headingsOf, openFigureWithTable, scrollToBottom, scrollToSection, stagePane, twoFrames } from './helpers';
import { PANE_QUERIES, expectPane, notice, stopUrl } from './paneHelpers';

const WINDOWS = STANDARD_PANES.map((pane) => pane.window);
const nameOf = (size: { width: number; height: number }): string => `${size.width} × ${size.height}`;

/** tokens.css 里的几种颜色，算出来的样子。 */
const SILK = 'rgb(197, 177, 137)';
const INK = 'rgb(40, 35, 31)';
const INK_ON_SILK = 'rgba(40, 35, 31, 0.92)';
const ACCENT = 'rgb(176, 58, 42)';
const INK_SOFT = 'rgb(90, 81, 70)';
const SLIP = 'rgb(250, 245, 231)';
const WATER = 'rgb(62, 96, 114)';
const VEIL = 'rgba(197, 177, 137, 0.94)';

/** 题记那一行的字号（像素）：照 stage.css 的算法，栏里面的宽度减 21，除以 40，最小 14，最大 19。 */
const lineSize = (inner: number): number => Math.min(19, Math.max(14, (inner - 21) / 40));
/** 题记够这么大才用楷体。 */
const KAI_FROM_PX = 16;

type Rgba = [number, number, number, number];

function rgba(colour: string): Rgba {
  const parts = colour.match(/[\d.]+/g)?.map(Number) ?? [];
  if (parts.length < 3) throw new Error(`读不懂这个颜色：${colour}`);
  return [parts[0], parts[1], parts[2], parts[3] ?? 1];
}

/** 半透明的颜色盖在底下那一层上是什么颜色。 */
function over(top: Rgba, under: Rgba): Rgba {
  const a = top[3];
  return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
}

/** 两种颜色的对比（WCAG 的算法）。 */
function contrast(a: Rgba, b: Rgba): number {
  const lum = (c: Rgba): number => {
    const [r, g, bl] = [c[0], c[1], c[2]].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** 沙盘栏里显出来的一段字：在哪个元素里，什么颜色、多大、什么字体；垫在它下面的那一层是谁、什么底色；是不是点不了的。 */
interface PaneRun {
  where: string;
  text: string;
  colour: string;
  size: number;
  family: string;
  holder: string;
  ground: string;
  disabled: boolean;
}

/** 沙盘栏里显出来的每一段字（沙盘和定格图的替身、?debug=1 的读数不算）。 */
async function paneRuns(page: Page): Promise<PaneRun[]> {
  await fontsReady(page);
  return page.evaluate(() => {
    const pane = document.querySelector('.stage-pane');
    if (!pane) throw new Error('页面上没有沙盘栏');
    const nameOf = (el: Element): string => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() !== '' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`;
    const clear = (colour: string): boolean => colour === 'transparent' || /^rgba\(\d+, \d+, \d+, 0\)$/.test(colour);
    const runs: { where: string; text: string; colour: string; size: number; family: string; holder: string; ground: string; disabled: boolean }[] = [];
    const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? '').trim();
      const el = node.parentElement;
      if (text === '' || !el) continue;
      if (el.closest('.fake-stage, .fake-still, .stage-debug')) continue;
      if (el.getClientRects().length === 0 || !el.checkVisibility({ visibilityProperty: true })) continue;
      const style = getComputedStyle(el);
      let holder: Element = el;
      let ground = getComputedStyle(holder).backgroundColor;
      while (clear(ground) && holder !== pane && holder.parentElement) {
        holder = holder.parentElement;
        ground = getComputedStyle(holder).backgroundColor;
      }
      runs.push({
        where: nameOf(el),
        text: text.length > 12 ? `${text.slice(0, 12)}…` : text,
        colour: style.color,
        size: parseFloat(style.fontSize),
        family: style.fontFamily.replace(/^["']/, '').split(/["',]/)[0],
        holder: nameOf(holder).split('.').slice(0, 2).join('.'),
        ground,
        disabled: el.closest('[aria-disabled="true"], :disabled') !== null,
      });
    }
    return runs;
  });
}

/** 直接落在绢上的字，垫在下面的是这几样：沙盘栏自己，题记那一条，按钮下面的那一行话。 */
const ON_SILK = ['section.stage-pane', 'div.stage-foot', 'div.stage-notice'];

/** 一批字对着“绢上只许墨色、都要够深”查一遍。给出不对的，和见到的每一种配法（字的颜色、底、对比）。 */
function judge(runs: PaneRun[]): { problems: string[]; pairs: Map<string, string> } {
  const problems: string[] = [];
  const pairs = new Map<string, string>();
  const silk = rgba(SILK);
  for (const run of runs) {
    const at = `${run.where}“${run.text}”`;
    const onSilk = ON_SILK.includes(run.holder);
    // 半透明的底（题记那一条、垫着的纸条）盖在绢上
    const ground = over(rgba(run.ground), silk);
    const ratio = contrast(over(rgba(run.colour), ground), ground);
    pairs.set(`${run.colour} 在 ${run.holder}（${run.ground}）上${run.disabled ? '，点不了的' : ''}`, ratio.toFixed(2));
    if (onSilk) {
      if (run.colour !== INK && run.colour !== INK_ON_SILK) problems.push(`${at}：落在绢上（${run.holder}），颜色是 ${run.colour}，只许是墨色`);
      if (ratio < 6) problems.push(`${at}：落在绢上，对比只有 ${ratio.toFixed(2)}`);
    } else if (!run.disabled && ratio < 4.5) {
      problems.push(`${at}：在 ${run.holder}（${run.ground}）上，颜色 ${run.colour}，对比只有 ${ratio.toFixed(2)}`);
    }
  }
  return { problems, pairs };
}

/** 换一种窗口，从头打开有沙盘的那一站，等沙盘（替身）摆好。query 是地址里的开关。 */
async function openStop(page: Page, size: { width: number; height: number }, query = 'stage=fake'): Promise<{ figureId: string; stopId: string; headings: string[] }> {
  const { figureId, found } = await openFigureWithTable(page, fakeUrl('#/'));
  test.skip(!found, '还没有哪一站有沙盘');
  if (!found) throw new Error('还没有哪一站有沙盘');
  await page.goto('about:blank');
  await page.setViewportSize(size);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(stopUrl(query, figureId, found.stopId));
  await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-text', 'written');
  return { figureId, stopId: found.stopId, headings: headingsOf(found.scene) };
}

/** 照着按钮的位置点，像手指那样（测试工具自己的“点这个元素”会先把钉在顶上的沙盘栏滚回页面开头）。 */
async function tap(page: Page, selector: string): Promise<void> {
  const box = (await page.locator(selector).first().boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** 沙盘栏量到的宽：连边线的、不连边线的；挂着的类名；页面写在栏上的 --pane-w。 */
async function paneWidth(page: Page): Promise<{ outer: number; inner: number; wide: boolean; kai: boolean; written: string }> {
  return stagePane(page).evaluate((el: HTMLElement) => ({ outer: el.offsetWidth, inner: el.clientWidth, wide: el.classList.contains('is-wide'), kai: el.classList.contains('is-kai'), written: el.style.getPropertyValue('--pane-w') }));
}

test('绢上的字都是墨色，和绢比不低于 6 比 1；纸条上的字不低于 4.5 比 1；沙盘栏和它里面的焦点框是墨色', async ({ page }) => {
  test.setTimeout(180_000);
  const seen = new Map<string, string>();
  const look = async (label: string, atLeast: number): Promise<void> => {
    const runs = await paneRuns(page);
    expect(runs.length, `${label}：沙盘栏里显出来的字太少，怕是没打开`).toBeGreaterThanOrEqual(atLeast);
    const { problems, pairs } = judge(runs);
    expect(problems, `${label}：沙盘栏里这几处的字颜色不对，或者太淡`).toEqual([]);
    for (const [pair, ratio] of pairs) seen.set(pair, ratio);
  };
  const pane = stagePane(page);

  for (const size of [WINDOWS[0], WINDOWS[2]]) {
    const where = nameOf(size);
    // 摆着沙盘：最后一节（有“远处”那一行），再点开“说明”
    const { headings } = await openStop(page, size);
    await expectStageAt(page, headings[0]);
    expect(await pane.evaluate((el) => getComputedStyle(el).backgroundColor), `${where}：沙盘栏的底色`).toBe(SILK);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--color-paper-sunk').trim()), 'tokens.css 里沙盘栏的底色').toBe('#c5b189');
    await look(`${where}，第 1 节`, 8);
    await scrollToBottom(page);
    await expectStageAt(page, headings[headings.length - 1]);
    await expect(pane.locator('.stage-caption')).toHaveAttribute('data-section', headings[headings.length - 1]);
    await tap(page, '.stage-note-button');
    await expect(pane.locator('.stage-note-panel')).toBeVisible();
    await look(`${where}，最后一节，“说明”开着`, 12);

    // 只放图片：按钮下面有一行话
    await openStop(page, size, PANE_QUERIES.only);
    await expectPane(page, 'slow', 'still');
    await expect(notice(page)).toBeVisible();
    expect(await notice(page).evaluate((el) => getComputedStyle(el).backgroundColor), `${where}：按钮下面那一行话的底色，就是沙盘栏的底色`).toBe(SILK);
    await look(`${where}，只放图片`, 8);
    // 读者要来的沙盘：那一行话后面有“换回图片”
    await tap(page, '.stage-controls .stage-retry');
    await expectPane(page, 'ready', 'table');
    await expect(pane.locator('.stage-notice-button')).toBeVisible();
    await look(`${where}，读者要来的沙盘`, 8);

    // 画面断了、又没有图片：一句话和一个按钮
    await openStop(page, size);
    await expectStageAt(page, headings[0]);
    await page.evaluate(() => document.querySelector<HTMLElement>('.fake-stage-lose')?.click());
    await expectPane(page, 'lost', 'none');
    await expect(pane.locator('.stage-message p')).toBeVisible();
    await look(`${where}，画面断了`, 4);
  }

  // 人物页上的全程图片：题记、说明、出处直接落在绢上
  await page.goto('about:blank');
  await page.setViewportSize(WINDOWS[0]);
  const { figureId } = await openFigureWithTable(page, fakeUrl('#/'));
  await page.goto('about:blank');
  await page.goto(fakeUrl(`#/${figureId}`));
  if (await expectStill(page)) await look('人物页的全程图片', 3);

  console.log(['沙盘栏里见到的每一种配法（字的颜色、垫在下面的是谁、对比）：', ...[...seen].sort().map(([pair, ratio]) => `  ${ratio} 比 1　${pair}`)].join('\n'));

  // 焦点框。用键盘走到“到沙盘”，按回车：焦点到沙盘栏上；再按 Tab：到它的第一个按钮上。
  const { headings } = await openStop(page, WINDOWS[0]);
  await expectStageAt(page, headings[0]);
  await page.locator('.skip-to-stage').focus();
  await page.keyboard.press('Enter');
  await expect(pane).toBeFocused();
  const ring = (selector: string): Promise<{ colour: string; style: string; width: string; offset: string }> =>
    page.locator(selector).first().evaluate((el) => {
      const style = getComputedStyle(el);
      return { colour: style.outlineColor, style: style.outlineStyle, width: style.outlineWidth, offset: style.outlineOffset };
    });
  expect(await ring('.stage-pane'), '焦点在沙盘栏上时的框').toEqual({ colour: INK, style: 'solid', width: '3px', offset: '-3px' });
  // 沙盘的替身自己也有几个按钮，排在页面的按钮前面：一路按 Tab，走到“古名”上为止
  for (let presses = 0; presses < 8; presses++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => Boolean(document.activeElement?.closest('.names-switch')))) break;
  }
  await expect(pane.locator('.names-switch button').first()).toBeFocused();
  expect(await ring('.names-switch button'), '焦点在沙盘栏的按钮上时的框').toEqual({ colour: INK, style: 'solid', width: '3px', offset: '2px' });
});

for (const size of WINDOWS) {
  test(`${nameOf(size)}：沙盘栏里给读者看的字没有小于 14px 的；各样字的大小和字体`, async ({ page }) => {
    test.setTimeout(120_000);
    const pane = stagePane(page);
    const small = async (label: string): Promise<void> => {
      const runs = await paneRuns(page);
      expect(runs.length, `${label}：沙盘栏里显出来的字太少`).toBeGreaterThanOrEqual(4);
      expect(runs.filter((run) => run.size < 14).map((run) => `${run.where}“${run.text}”${run.size}px`), `${label}：小于 14px 的字`).toEqual([]);
    };
    const { headings } = await openStop(page, size);
    await expectStageAt(page, headings[0]);
    const width = await paneWidth(page);
    expect(width.wide, '四种标准的窗口上都是宽的排法').toBe(true);
    expect(width.written, '页面写在栏上的 --pane-w').toBe(`${width.inner}px`);
    await small('第 1 节');

    // 一样一样对：多大，什么字体
    const of = (selector: string): Promise<{ size: number; family: string; colour: string }> =>
      pane.locator(selector).first().evaluate((el) => {
        const style = getComputedStyle(el);
        return { size: parseFloat(style.fontSize), family: style.fontFamily.replace(/^["']/, '').split(/["',]/)[0], colour: style.color };
      });
    expect(await of('.stage-section-name'), '小节的名字').toEqual({ size: 17, family: 'Yanlu Kai', colour: INK });
    expect(await of('.stage-date'), '时间').toEqual({ size: 14, family: 'Yanlu Song', colour: INK_ON_SILK });
    expect(await of('.stage-note-short'), '说明').toEqual({ size: 14, family: 'Yanlu Song', colour: INK_ON_SILK });
    expect(await of('.stage-scale-label'), '比例尺上的数').toEqual({ size: 14, family: 'Yanlu Song', colour: INK });
    expect(await of('.stage-north span'), '“北”').toEqual({ size: 14, family: 'Yanlu Kai', colour: INK });
    expect(await of('.stage-note-button'), '“说明”按钮').toEqual({ size: 14, family: 'Yanlu Song', colour: ACCENT });
    expect(await of('.stage-reset'), '“回到这一节”').toMatchObject({ size: 17, family: 'Yanlu Kai' });
    // 题记那一行：字号照栏宽算；够 16px 才是楷体
    const line = await of('.stage-line');
    const wanted = lineSize(width.inner);
    expect(line.size, `题记的字号（栏里面宽 ${width.inner}）`).toBeCloseTo(wanted, 1);
    expect(line.family, `题记 ${line.size}px`).toBe(wanted >= KAI_FROM_PX ? 'Yanlu Kai' : 'Yanlu Song');
    expect(width.kai).toBe(wanted >= KAI_FROM_PX);
    expect(line.colour).toBe(INK);
    console.log(`${nameOf(size)}：沙盘栏连边线 ${width.outer}、里面 ${width.inner} 像素宽；题记 ${line.size}px ${line.family}`);

    // 最后一节（有“远处”那一行），点开“说明”
    await scrollToBottom(page);
    await expectStageAt(page, headings[headings.length - 1]);
    await expect(pane.locator('.stage-caption')).toHaveAttribute('data-section', headings[headings.length - 1]);
    if ((await pane.locator('.stage-far li').count()) > 0) expect(await of('.stage-far li'), '远处').toEqual({ size: 14, family: 'Yanlu Song', colour: INK });
    await tap(page, '.stage-note-button');
    await expect(pane.locator('.stage-note-panel')).toBeVisible();
    await small('最后一节，“说明”开着');
    expect(await of('.stage-note-lines p'), '展开的说明').toMatchObject({ size: 15, family: 'Yanlu Song' });

    // 只放图片：那一行话；读者要来的沙盘：“换回图片”
    await openStop(page, size, PANE_QUERIES.only);
    await expectPane(page, 'slow', 'still');
    await small('只放图片');
    expect(await of('.stage-notice p'), '按钮下面的那一行话').toEqual({ size: 14, family: 'Yanlu Song', colour: INK });
    await tap(page, '.stage-controls .stage-retry');
    await expectPane(page, 'ready', 'table');
    await small('读者要来的沙盘');
    expect(await of('.stage-notice-button'), '“换回图片”').toEqual({ size: 14, family: 'Yanlu Song', colour: ACCENT });
  });
}

test('窄的排法（窗口 1000 × 768，沙盘栏 560 宽）：题记那一块 94 像素高，字也没有小于 14px 的，题记和远处两行、说明一行都看得全', async ({ page }) => {
  const pane = stagePane(page);
  const { headings } = await openStop(page, { width: 1000, height: 768 });
  await expectStageAt(page, headings[0]);
  const width = await paneWidth(page);
  expect({ outer: width.outer, wide: width.wide, kai: width.kai }).toEqual({ outer: 560, wide: false, kai: false });
  for (const last of [false, true]) {
    if (last) {
      await scrollToBottom(page);
      await expectStageAt(page, headings[headings.length - 1]);
      await expect(pane.locator('.stage-caption')).toHaveAttribute('data-section', headings[headings.length - 1]);
    }
    const at = last ? '最后一节' : '第 1 节';
    const runs = await paneRuns(page);
    expect(runs.filter((run) => run.size < 14).map((run) => `${run.where}“${run.text}”${run.size}px`), `${at}：小于 14px 的字`).toEqual([]);
    expect(judge(runs).problems, `${at}：字的颜色`).toEqual([]);
    const caption = await pane.locator('.stage-caption').evaluate((el) => {
      const of = (selector: string): { size: number; family: string } => {
        const style = getComputedStyle(el.querySelector(selector)!);
        return { size: parseFloat(style.fontSize), family: style.fontFamily.replace(/^["']/, '').split(/["',]/)[0] };
      };
      const words = el.querySelector<HTMLElement>('.stage-words')!;
      const brief = el.querySelector<HTMLElement>('.stage-note-brief')!;
      return {
        height: el.getBoundingClientRect().height,
        overflow: el.scrollHeight > el.clientHeight + 1,
        name: of('.stage-section-name'),
        line: of('.stage-line'),
        brief: of('.stage-note-brief'),
        wordsCut: words.scrollHeight > words.clientHeight + 1,
        briefCut: brief.scrollWidth > brief.clientWidth + 1,
        shortShown: getComputedStyle(el.querySelector('.stage-note-short')!).display !== 'none',
      };
    });
    expect(caption, at).toEqual({
      height: 94,
      overflow: false,
      name: { size: 16, family: 'Yanlu Kai' },
      line: { size: 14, family: 'Yanlu Song' },
      brief: { size: 14, family: 'Yanlu Song' },
      wordsCut: false,
      briefCut: false,
      shortShown: false,
    });
  }
});

test('题记写满 40 个字：从 560 像素宽的栏往上，哪一种栏宽都放得下；584 起一行不截断、不小于 14px，够 16px 才是楷体', async ({ page }) => {
  test.setTimeout(180_000);
  const pane = stagePane(page);
  const { headings } = await openStop(page, { width: 1440, height: 800 });
  await expectStageAt(page, headings[0]);
  // 把题记写满 40 个字：拿这一节自己的题记接起来截 40 个（都是字体里有的字）
  const written = await pane.locator('.stage-line').evaluate((el) => {
    const own = (el.textContent ?? '').replace(/\s/g, '');
    el.textContent = Array.from(own.repeat(Math.ceil(40 / Math.max(1, Array.from(own).length)) + 1))
      .slice(0, 40)
      .join('');
    return Array.from(el.textContent).length;
  });
  expect(written).toBe(40);

  // 横排的版面（窗口 960 起，栏 = 窗口 − 正文那一栏），和竖排的版面（栏和窗口一样宽）。
  // 1000 的窗口上栏正好 560 宽；1024 是横着拿的平板（栏 584）；1100 到 1102 跨过“够 16px、换楷体”的那条线。
  const widths = [1000, 1001, 1010, 1022, 1023, 1024, 1025, 1040, 1060, 1080, 1100, 1101, 1102, 1103, 1120, 1180, 1280, 1366, 1440, 1920, 560, 583, 584, 585, 600, 660, 661, 662, 700, 768, 820, 959];
  const rows: string[] = [];
  let kaiSeen = 0;
  let songSeen = 0;
  let narrowSeen = 0;
  for (const windowWidth of widths) {
    await page.setViewportSize({ width: windowWidth, height: 800 });
    // 页面在下一帧才重量栏宽：等它把新的宽度写到栏上
    await expect.poll(async () => (await paneWidth(page)).written === `${(await paneWidth(page)).inner}px`, { message: `窗口 ${windowWidth}：页面没有把新的栏宽写到栏上` }).toBe(true);
    await twoFrames(page);
    await fontsReady(page);
    const width = await paneWidth(page);
    expect(width.outer, `窗口 ${windowWidth}：栏宽`).toBeGreaterThanOrEqual(560);
    const where = `窗口 ${windowWidth}（栏连边线 ${width.outer}、里面 ${width.inner}）`;
    expect(width.wide, `${where}：是不是宽的排法`).toBe(width.outer >= STRIP_NARROW_BELOW_PX);
    const got = await pane.locator('.stage-line').evaluate((el) => {
      const style = getComputedStyle(el);
      const words = el.closest('.stage-words') as HTMLElement;
      return {
        size: parseFloat(style.fontSize),
        family: style.fontFamily.replace(/^["']/, '').split(/["',]/)[0],
        display: style.display,
        cut: el.scrollWidth > el.clientWidth,
        rows: Math.round(el.getBoundingClientRect().height / parseFloat(style.lineHeight)),
        wordsCut: words.scrollHeight > words.clientHeight + 1,
        wordsDisplay: getComputedStyle(words).display,
      };
    });
    if (width.wide) {
      const wanted = lineSize(width.inner);
      expect(got.display, `${where}：题记自己一行`).toBe('block');
      expect(got.rows, `${where}：题记占几行`).toBe(1);
      expect(got.cut, `${where}：40 个字的题记被截掉了（字号 ${got.size}px）`).toBe(false);
      expect(got.size, `${where}：题记的字号`).toBeGreaterThanOrEqual(14);
      expect(got.size, `${where}：题记的字号`).toBeCloseTo(wanted, 1);
      expect(got.family, `${where}：题记 ${got.size}px 的字体`).toBe(got.size >= KAI_FROM_PX ? 'Yanlu Kai' : 'Yanlu Song');
      expect(width.kai, `${where}：栏上挂没挂 is-kai`).toBe(got.size >= KAI_FROM_PX);
      if (got.family === 'Yanlu Kai') kaiSeen++;
      else songSeen++;
    } else {
      expect(got.wordsDisplay, `${where}：窄的排法`).toBe('block');
      expect(got.family, `${where}：窄的排法里题记是宋体`).toBe('Yanlu Song');
      expect(got.size, `${where}：窄的排法里题记的字号`).toBe(14);
      expect(got.wordsCut, `${where}：窄的排法里，40 个字的题记连同远处两行放不下`).toBe(false);
      expect(width.kai).toBe(false);
      narrowSeen++;
    }
    rows.push(`  窗口 ${windowWidth}：栏 ${width.outer}（里面 ${width.inner}），${width.wide ? `宽的排法，题记 ${got.size.toFixed(2)}px ${got.family === 'Yanlu Kai' ? '楷体' : '宋体'}` : '窄的排法，题记 14px 宋体，两行'}`);
  }
  console.log(['40 个字的题记，各种栏宽上：', ...rows].join('\n'));
  // 三种情形都量到了：不然这一项没查到东西
  expect(kaiSeen).toBeGreaterThan(5);
  expect(songSeen).toBeGreaterThan(5);
  expect(narrowSeen).toBeGreaterThan(3);
});

test('按钮是纸条，古名今名选中的是红字加小红方块、不铺红底，换着选按钮不挪地方；题记那一条是绢色、上边一道细线；题签脚上有印', async ({ page }) => {
  test.setTimeout(120_000);
  const pane = stagePane(page);
  const { headings } = await openStop(page, WINDOWS[0]);
  await expectStageAt(page, headings[0]);

  // ---- 按钮
  const slip = (selector: string): Promise<{ ground: string; edge: string; shadow: string; radius: string }> =>
    pane.locator(selector).first().evaluate((el) => {
      const style = getComputedStyle(el);
      return { ground: style.backgroundColor, edge: style.borderTopColor, shadow: style.boxShadow, radius: style.borderTopLeftRadius };
    });
  for (const selector of ['.names-switch', '.stage-reset']) {
    const got = await slip(selector);
    expect({ ground: got.ground, edge: got.edge, radius: got.radius }, `${selector} 是一张方角的纸条，最外面一道是纸色`).toEqual({ ground: SLIP, edge: SLIP, radius: '0px' });
    expect(got.shadow, `${selector} 里面有一圈深色的细线`).toContain('inset');
  }
  const names = async (): Promise<{ text: string; pressed: string | null; colour: string; fill: string; mark: string; markLine: string; markSize: string; left: number; width: number }[]> =>
    pane.locator('.names-switch button').evaluateAll((buttons) =>
      buttons.map((button) => {
        const style = getComputedStyle(button);
        const mark = getComputedStyle(button, '::before');
        const box = button.getBoundingClientRect();
        return { text: button.textContent ?? '', pressed: button.getAttribute('aria-pressed'), colour: style.color, fill: style.backgroundColor, mark: mark.backgroundColor, markLine: mark.boxShadow, markSize: `${mark.width} × ${mark.height}`, left: box.left, width: box.width };
      }),
    );
  const before = await names();
  expect(before.map((item) => item.pressed)).toEqual(['true', 'false']);
  for (const item of before) {
    expect(item.fill, `“${item.text}”不铺底色`).toBe('rgba(0, 0, 0, 0)');
    expect(item.markSize, `“${item.text}”前面的小方块`).toBe('6px × 6px');
  }
  expect({ colour: before[0].colour, mark: before[0].mark, line: before[0].markLine }, '选中的：红字，实心的小红方块').toEqual({ colour: ACCENT, mark: ACCENT, line: 'none' });
  expect({ colour: before[1].colour, mark: before[1].mark }, '没选中的：灰字，空心的小方块').toEqual({ colour: INK_SOFT, mark: 'rgba(0, 0, 0, 0)' });
  expect(before[1].markLine, '没选中的小方块有一圈线').toContain('inset');
  const resetLeft = (): Promise<number> => pane.locator('.stage-reset').evaluate((el) => el.getBoundingClientRect().left);
  const resetBefore = await resetLeft();
  await tap(page, '.names-switch button[aria-pressed="false"]');
  await expect(pane.locator('.names-switch button').nth(1)).toHaveAttribute('aria-pressed', 'true');
  const after = await names();
  expect(after.map((item) => ({ left: item.left, width: item.width })), '换着选，两个按钮都不变宽、不挪地方').toEqual(before.map((item) => ({ left: item.left, width: item.width })));
  expect(await resetLeft()).toBe(resetBefore);
  expect({ colour: after[1].colour, mark: after[1].mark }).toEqual({ colour: ACCENT, mark: ACCENT });
  expect(after[0].colour).toBe(INK_SOFT);

  // ---- 题记那一条
  const foot = await pane.locator('.stage-foot').evaluate((el) => {
    const style = getComputedStyle(el);
    return { ground: style.backgroundColor, line: style.boxShadow, fadeAbove: getComputedStyle(el, '::before').content, fadeBelow: getComputedStyle(el, '::after').content };
  });
  expect(foot.ground, '题记那一条的底').toBe(VEIL);
  expect(foot.line, '题记那一条上边的细线（画在里面，不占地方）').toMatch(/inset/);
  expect({ above: foot.fadeAbove, below: foot.fadeBelow }, '题记那一条上面没有另外垫着淡出去的一截').toEqual({ above: 'none', below: 'none' });
  const rule = await pane.locator('.stage-section-name').evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(rule, '小节名上面那道红线').toContain('176, 58, 42');

  // ---- 题签：每一小节看一遍。脚上有印；水名是靛青；远处是虚线
  const tones = new Set<string>();
  for (const [i, heading] of headings.entries()) {
    if (i === headings.length - 1) await scrollToBottom(page);
    else if (i > 0) await scrollToSection(page, heading);
    await expectStageAt(page, heading);
    await expect(pane.locator('.stage-host .strip').first()).toBeVisible();
    const strips = await pane.locator('.stage-host .strip').evaluateAll((items) =>
      items
        .filter((item) => (item as HTMLElement).style.visibility !== 'hidden')
        .map((item) => {
          const style = getComputedStyle(item);
          const seal = getComputedStyle(item, '::after');
          return {
            text: item.textContent ?? '',
            tone: item.getAttribute('data-tone') ?? '',
            colour: style.color,
            ground: style.backgroundColor,
            size: style.fontSize,
            family: style.fontFamily.replace(/^["']/, '').split(/["',]/)[0],
            edge: style.borderTopWidth,
            outline: style.outlineStyle,
            pad: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
            seal: `${seal.width} × ${seal.height} ${seal.backgroundColor} ${seal.bottom}`,
          };
        }),
    );
    expect(strips.length, `“${heading}”摆出来的题签`).toBeGreaterThan(0);
    for (const strip of strips) {
      const at = `“${heading}”的题签“${strip.text}”`;
      tones.add(strip.tone);
      expect({ ground: strip.ground, size: strip.size, family: strip.family, edge: strip.edge, pad: strip.pad }, at).toEqual({ ground: SLIP, size: '17px', family: 'Yanlu Kai', edge: '0px', pad: '6px 6px 16px 6px' });
      expect(strip.seal, `${at}脚上的印`).toBe(`6px × 6px ${ACCENT} 5px`);
      expect(strip.colour, `${at}的字`).toBe(strip.tone === 'water' ? WATER : INK);
      expect(strip.outline, `${at}的边`).toBe(strip.tone === 'far' ? 'dashed' : 'none');
    }
  }
  expect([...tones].sort(), '水名、远处、平常的地名三种题签都看到了').toEqual(['far', 'place', 'water']);

  // ---- 窄的栏（窗口 1000 宽，栏 560）：题签小一号，印也小一号
  await page.setViewportSize({ width: 1000, height: 768 });
  await expect.poll(async () => (await paneWidth(page)).wide).toBe(false);
  await twoFrames(page);
  const small = await pane.locator('.stage-host .strip').first().evaluate((item) => {
    const style = getComputedStyle(item);
    const seal = getComputedStyle(item, '::after');
    return { size: style.fontSize, pad: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`, seal: `${seal.width} × ${seal.height} ${seal.bottom}` };
  });
  expect(small).toEqual({ size: '14px', pad: '4px 5px 13px 5px', seal: '5px × 5px 4px' });
});

test('人物页上的全程图片：电脑和横着拿的平板上，图片、题记、说明、出处都在栏里，不用在栏里滚；图片没有被压扁', async ({ page }) => {
  test.setTimeout(120_000);
  const { figureId } = await openFigureWithTable(page, fakeUrl('#/'));
  const noTable = await firstWrittenStopWithoutScene(page, figureId);
  /** 沙盘栏里那张图片和它下面的字量一遍。 */
  const measure = async (): Promise<{ paneHeight: number; content: number; creditBottom: number; ratio: number; natural: number; imageWidth: number; boxWidth: number; pinned: boolean; shape: string }> => {
    await expect.poll(() => page.locator('.stage-still img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await fontsReady(page);
    return page.evaluate(() => {
      const pane = document.querySelector<HTMLElement>('.stage-pane')!;
      const img = document.querySelector<HTMLImageElement>('.stage-still img')!;
      const credit = document.querySelector('.stage-still-credit')!;
      const box = document.querySelector<HTMLElement>('.stage-still-box')!;
      const image = img.getBoundingClientRect();
      const boxStyle = getComputedStyle(box);
      return {
        paneHeight: pane.clientHeight,
        content: pane.scrollHeight,
        creditBottom: credit.getBoundingClientRect().bottom - pane.getBoundingClientRect().top,
        ratio: image.width / image.height,
        natural: img.naturalWidth / img.naturalHeight,
        imageWidth: image.width,
        boxWidth: box.clientWidth - parseFloat(boxStyle.paddingLeft) - parseFloat(boxStyle.paddingRight),
        pinned: getComputedStyle(pane).position === 'sticky',
        // 页面自己说的排法：wide 是横排（文字在左、沙盘在右），narrow 是竖排（沙盘在上）
        shape: getComputedStyle(pane).getPropertyValue('--stage-shape').trim(),
      };
    });
  };
  for (const size of WINDOWS) {
    const where = nameOf(size);
    await page.goto('about:blank');
    await page.setViewportSize(size);
    await page.goto(fakeUrl(`#/${figureId}`));
    test.skip(!(await expectStill(page)), '人物页上还没有全程的图片');
    const got = await measure();
    expect(Math.abs(got.ratio - got.natural), `${where}：图片的宽高比（原来是 ${got.natural.toFixed(3)}，现在 ${got.ratio.toFixed(3)}）`).toBeLessThan(0.01);
    // 横排的版面：窗口 960 像素宽以上、而且横着（宽比高大）。竖着拿的大平板（1024 × 1366）够宽，可它是竖着的，是竖排
    const sideBySide = size.width >= 960 && size.width > size.height;
    expect(got.shape, `${where}：页面说的排法`).toBe(sideBySide ? 'wide' : 'narrow');
    if (sideBySide) {
      // 横排的版面：沙盘栏占满一边，和窗口一样高；里面的东西都看得见，不用滚
      expect(got.pinned).toBe(true);
      expect(got.content, `${where}：沙盘栏里的东西有 ${got.content} 高，栏只有 ${got.paneHeight} 高，要在栏里滚才看得全`).toBeLessThanOrEqual(got.paneHeight);
      expect(got.creditBottom, `${where}：出处的最后一行`).toBeLessThanOrEqual(got.paneHeight);
    } else {
      // 竖排的版面：图片在上面跟着页面滚走（不钉着），和栏一样宽
      expect(got.pinned, `${where}：人物页上沙盘栏不钉在顶上`).toBe(false);
      expect(got.imageWidth, `${where}：图片的宽`).toBeCloseTo(got.boxWidth, 0);
    }
    console.log(`人物页 ${where}：沙盘栏 ${got.paneHeight} 高，里面的东西 ${got.content} 高，出处的下边在 ${Math.round(got.creditBottom)}；图片 ${Math.round(got.imageWidth)} 宽（放图片的地方 ${Math.round(got.boxWidth)} 宽）`);
  }
  // 写好了正文、还没有沙盘的一站：图片上面多一句话。电脑上也都在栏里
  if (noTable) {
    await page.goto('about:blank');
    await page.setViewportSize(WINDOWS[0]);
    await page.goto(fakeUrl(`#/${figureId}/${noTable}`));
    if (await expectStill(page)) {
      const got = await measure();
      expect(got.content, `还没有沙盘的一站（${noTable}），${nameOf(WINDOWS[0])}：沙盘栏里的东西有 ${got.content} 高，栏只有 ${got.paneHeight} 高`).toBeLessThanOrEqual(got.paneHeight);
      console.log(`还没有沙盘的一站（${noTable}）${nameOf(WINDOWS[0])}：沙盘栏 ${got.paneHeight} 高，里面的东西 ${got.content} 高`);
    }
  }
});

test('“老平板”的替身（样式表照 iPadOS 15 的读法改过）：三种平板的窗口上，沙盘栏的大小和留的空、题记的排法、字的大小都和别的浏览器一样', async ({ page }) => {
  test.setTimeout(180_000);
  // 把构建出来的样式表改一遍再给页面。对着开发服务跑的时候样式是程序带进来的，没有样式表文件，这一项不查
  const changed: { sheet: string; containers: number; cqw: number; same: boolean }[] = [];
  await page.route(/\.css(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const css = await response.text();
    const made = oldIpadSheet(css);
    changed.push({ sheet: new URL(route.request().url()).pathname.split('/').pop() ?? '', containers: made.containers, cqw: made.cqw, same: made.css === css });
    await route.fulfill({ response, body: made.css });
  });
  const pane = stagePane(page);
  for (const standard of [STANDARD_PANES[2], STANDARD_PANES[1], STANDARD_PANES[3]]) {
    const where = `老平板的替身，窗口 ${nameOf(standard.window)}`;
    const { headings } = await openStop(page, standard.window);
    test.skip(!(await page.evaluate(() => document.querySelector('link[rel="stylesheet"]') !== null)), '没有样式表文件（对着开发服务跑）');
    await expectStageAt(page, headings[0]);
    expect(changed.length, '样式表是从这里经过的').toBeGreaterThan(0);

    // 沙盘栏的大小和四边留的空：就是标准的那几个数
    const { top, right, bottom, left } = standard.insets;
    await expect.poll(async () => (await fakeStage(page).getAttribute('data-fake-insets')) ?? '', { message: `${where}：四边留的空` }).toBe(`${top} ${right} ${bottom} ${left}`);
    expect(await pane.evaluate((el: HTMLElement) => `${el.offsetWidth} × ${el.offsetHeight}`), `${where}：沙盘栏的大小`).toBe(`${standard.size.width} × ${standard.size.height}`);

    for (const last of [false, true]) {
      if (last) {
        await scrollToBottom(page);
        await expectStageAt(page, headings[headings.length - 1]);
        await expect(pane.locator('.stage-caption')).toHaveAttribute('data-section', headings[headings.length - 1]);
      }
      const at = `${where}，${last ? '最后一节' : '第 1 节'}`;
      // 题记是宽的排法：130 像素高；题记一行、说明最多两行，都没有被截掉
      const caption = await pane.locator('.stage-caption').evaluate((el) => {
        const cut = (selector: string): boolean | null => {
          const item = el.querySelector<HTMLElement>(selector);
          return item ? item.scrollWidth > item.clientWidth + 1 || item.scrollHeight > item.clientHeight + 1 : null;
        };
        const short = el.querySelector<HTMLElement>('.stage-note-short');
        return {
          height: el.getBoundingClientRect().height,
          overflow: el.scrollHeight > el.clientHeight + 1,
          lineCut: cut('.stage-line'),
          noteCut: cut('.stage-note-short'),
          noteShown: short !== null && getComputedStyle(short).display !== 'none',
          briefShown: getComputedStyle(el.querySelector('.stage-note-brief')!).display !== 'none',
        };
      });
      expect(caption, at).toEqual({ height: 130, overflow: false, lineCut: false, noteCut: false, noteShown: true, briefShown: false });
      const runs = await paneRuns(page);
      expect(runs.length).toBeGreaterThanOrEqual(6);
      expect(runs.filter((run) => run.size < 14).map((run) => `${run.where}“${run.text}”${run.size}px`), `${at}：小于 14px 的字`).toEqual([]);
      expect(judge(runs).problems, `${at}：字的颜色`).toEqual([]);
    }
    // 题签是大的那一种
    expect(await pane.locator('.stage-host .strip').first().evaluate((el) => getComputedStyle(el).fontSize), `${where}：题签的字号`).toBe('17px');
    const width = await paneWidth(page);
    console.log(`${where}：沙盘栏 ${width.outer} 宽，${width.wide ? '宽的排法' : '窄的排法'}，四边留 ${top} ${right} ${bottom} ${left}，题记 130 高`);
  }
  // 样式表里没有老平板会丢掉的东西：改完一个字不差
  console.log(`老平板的替身：经手的样式表 ${[...new Set(changed.map((item) => item.sheet))].join('、')}；去掉的 @container ${changed.reduce((sum, item) => sum + item.containers, 0)} 块，作废的 cqw 声明 ${changed.reduce((sum, item) => sum + item.cqw, 0)} 条`);
  expect(changed.filter((item) => !item.same || item.containers > 0 || item.cqw > 0), '样式表里有老平板会丢掉的东西（@container、cqw）').toEqual([]);
});

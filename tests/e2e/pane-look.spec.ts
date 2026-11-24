// 沙盘栏的样子，在真的页面上量。只量说得出数的几样；好不好看要看照片。
// 沙盘栏的底色是人物自己的（tokens.css 末尾那一块的 --color-paper-sunk）。框架摆在栏里的东西有两种面：
// 带子（按钮下面的那一行话、题记那一条：页面的颜色，边上一道细线）和板（按钮、展开的说明、等着和出了错时的那几句话：白底，一圈细边）。
// 题签是人物自己的：纸条、楷体、脚上有印。
//
// 一、框架的字都不直接落在沙盘栏的底色上。沙盘栏里显出来的每一段字，往上找到垫在它下面的那一层底色：
//     垫着的不许是沙盘栏自己；落在带子上的（题记那一条、按钮下面那一行话），和带子比不低于 6 比 1；
//     落在板上的（题签的纸条也算一种板），和它比不低于 4.5 比 1（点不了的按钮除外）。每一种配法印出来。
//     焦点框：沙盘栏自己、它里面的按钮，框是两道——外面一圈深灰，里面贴着一圈白（栏的底是深是浅，总有一道看得见）。
// 二、四种标准的窗口上，沙盘栏里给读者看的字没有小于 14px 的；小节名、题记、说明、时间、比例尺、“北”、
//     两个小按钮各是多大、什么字体、什么粗细，一样一样对：名字、时间、数、“北”、按钮是黑体（500），成句的话是宋体（400）。
//     题记那一行是一句话：多大都是宋体，栏上不挂 is-kai。
//     窄的排法（沙盘栏不到 584 像素宽；拿 1000 × 768 的窗口量，栏 560 宽）也一样：没有小于 14px 的字，
//     题记那一块 94 像素高，题记和远处两行、说明一行都看得全。
// 三、题记写满 40 个字（场景里许可的最多的字数），从 560 像素宽的栏往上，哪一种栏宽都放得下：
//     584 像素起是宽的排法，一行，不截断，字号不小于 14px；不到 584 是窄的排法，连同远处两行放得下。
//     窗口从窄到宽换二十几种宽度，每一种都量。
// 四、按钮、题记那一条、题签的样子：按钮是白底的板；古名今名选中的是墨蓝的字加一个实心的圆点、垫一块淡蓝，换着选按钮不挪地方；
//     题记那一条的底是页面的颜色、上边一道细线，没有淡出去的一截；题签还是人物自己的样子：纸条、楷体，脚上有一方印，
//     水名是靛青，远处是虚线；窄的栏上题签小一号。
//     四种标准的窗口上，每一小节再量一遍题记那一条：底是不透明的页面颜色（沙盘不从字底下透上来），130 像素高；
//     说明那一句占满这一条的宽，“说明”按钮立在右头、和说明的头一行对齐、在比例尺和指北的下面，说明的字到不了按钮底下；
//     题记、说明、远处都没有截掉的字，远处那一行紧接在说明下面。“说明”和“换回图片”是白底小板的打扮（白底、一圈细边、圆角、
//     一道影子），不是一圈线的小标签；能点的地方有 44 像素高。
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
import { expectStageAt, expectRoute, fakeStage, fakeUrl, fontsReady, headingsOf, openFigureWithTable, routeOnDisk, scrollToBottom, scrollToSection, stagePane, twoFrames } from './helpers';
import { PANE_QUERIES, expectPane, notice, stopUrl } from './paneHelpers';

const WINDOWS = STANDARD_PANES.map((pane) => pane.window);
const nameOf = (size: { width: number; height: number }): string => `${size.width} × ${size.height}`;

/**
 * tokens.css 里的几种颜色，算出来的样子。分两组，各是各的记号：
 * 人物自己的一套（写在沙盘栏上：栏的底色，题签的纸条、字、印、水名），和框架的一套（:root：按钮、几句话、题记那一条）。
 * 框架换成中性的样子时只改了框架的那一组；人物的一组一个数也没有动。
 */
const FIGURE_GROUND = 'rgb(197, 177, 137)';
const FIGURE_SLIP = 'rgb(250, 245, 231)';
const FIGURE_INK = 'rgb(40, 35, 31)';
const FIGURE_MARK = 'rgb(176, 58, 42)';
const FIGURE_WATER = 'rgb(62, 96, 114)';
const FRAME_INK = 'rgb(35, 34, 31)';
const FRAME_SOFT = 'rgb(92, 90, 85)';
const FRAME_ACCENT = 'rgb(31, 75, 110)';
/** 按钮、面板这些板的底：白。 */
const PLATE = 'rgb(255, 255, 255)';
/** 板的那一圈细边：半透明的深灰。 */
const PLATE_EDGE = 'rgba(35, 34, 31, 0.5)';
/** 两条带子（按钮下面那一行话、题记那一条）的底：页面的颜色，不透明（沙盘不从字底下透上来）。 */
const PAGE = 'rgb(251, 250, 247)';
/** 沙盘栏上的线：用不了的按钮的边。 */
const LINE_PANE = 'rgb(211, 209, 203)';
/** 选中的古名今名底下垫的淡蓝。 */
const WASH = 'rgb(231, 238, 243)';

/** 一样东西的打扮：底色，最外面的边，圆角，里面有没有另画一圈线，外面有没有影子。板是白底、一圈半透明深灰的细边、圆角、有影子、里面没有线。 */
async function slipDress(page: Page, selector: string): Promise<{ ground: string; edge: string; radius: string; innerLine: boolean; dropShadow: boolean; height: number; tapHeight: number }> {
  return stagePane(page)
    .locator(selector)
    .first()
    .evaluate((el) => {
      const style = getComputedStyle(el);
      // 影子可以有几道，逗号隔开（颜色里的逗号在括号里，不算）
      const shadows = style.boxShadow.split(/,(?![^(]*\))/).map((part) => part.trim());
      return {
        ground: style.backgroundColor,
        edge: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}`,
        radius: style.borderTopLeftRadius,
        innerLine: shadows.some((part) => part.includes('inset')),
        dropShadow: shadows.some((part) => part !== 'none' && !part.includes('inset')),
        height: el.getBoundingClientRect().height,
        // 看着小，能点的地方由 ::after 撑出来
        tapHeight: parseFloat(getComputedStyle(el, '::after').height),
      };
    });
}

/**
 * 题记那一行的字号（像素）：栏里面的宽度减 21，除以 40，往下取成整数，最小 14，最大 19（页面算好写在栏上，StagePane.tsx 的 fitPane）。
 * 取整是为了哪种系统上都放得下：有的系统上一个字只占整数个像素（Linux，平常的设置），14.95px 的字排成 15px 一个，
 * 40 个字就比算好的宽出 2 像素，行尾被截掉——发布流程的机器上量到过。
 */
const lineSize = (inner: number): number => Math.min(19, Math.max(14, Math.floor((inner - 21) / 40)));

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

/** 沙盘栏自己：它的底色是沙盘的，人物自己的。框架的字不许直接落在它上面。 */
const PANE_ITSELF = 'section.stage-pane';
/** 两条带子：题记那一条，按钮下面的那一行话。底是页面的颜色。 */
const BANDS = ['div.stage-foot', 'div.stage-notice'];

/** 一批字对着“不直接落在沙盘栏的底色上、带子上不低于 6 比 1、板上不低于 4.5 比 1”查一遍。给出不对的，和见到的每一种配法（字的颜色、底、对比）。 */
function judge(runs: PaneRun[]): { problems: string[]; pairs: Map<string, string> } {
  const problems: string[] = [];
  const pairs = new Map<string, string>();
  const paneGround = rgba(FIGURE_GROUND);
  for (const run of runs) {
    const at = `${run.where}“${run.text}”`;
    // 半透明的底盖在沙盘栏的底色上
    const ground = over(rgba(run.ground), paneGround);
    const ratio = contrast(over(rgba(run.colour), ground), ground);
    pairs.set(`${run.colour} 在 ${run.holder}（${run.ground}）上${run.disabled ? '，点不了的' : ''}`, ratio.toFixed(2));
    if (run.holder === PANE_ITSELF) {
      problems.push(`${at}：直接落在沙盘栏的底色上（底下没有垫带子，也没有垫板）`);
    } else if (BANDS.includes(run.holder)) {
      if (ratio < 6) problems.push(`${at}：落在带子上（${run.holder}，${run.ground}），颜色 ${run.colour}，对比只有 ${ratio.toFixed(2)}`);
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

/** 沙盘栏量到的宽：连边线的、不连边线的；挂着的类名（kai 是栏上还挂没挂 is-kai：这个类名不要了，哪里都该是没挂）；页面写在栏上的 --pane-w。 */
async function paneWidth(page: Page): Promise<{ outer: number; inner: number; wide: boolean; kai: boolean; written: string; lineSize: string }> {
  return stagePane(page).evaluate((el: HTMLElement) => ({
    outer: el.offsetWidth,
    inner: el.clientWidth,
    wide: el.classList.contains('is-wide'),
    kai: el.classList.contains('is-kai'),
    written: el.style.getPropertyValue('--pane-w'),
    lineSize: el.style.getPropertyValue('--line-size'),
  }));
}

test('沙盘栏里框架的字都不直接落在沙盘栏的底色上：落在页面颜色的带子上的不低于 6 比 1，落在白底的板上的不低于 4.5 比 1；沙盘栏和它里面的焦点框是两道，里面一圈白、外面一圈深灰', async ({ page }) => {
  test.setTimeout(180_000);
  const seen = new Map<string, string>();
  const look = async (label: string, atLeast: number): Promise<void> => {
    const runs = await paneRuns(page);
    expect(runs.length, `${label}：沙盘栏里显出来的字太少，怕是没打开`).toBeGreaterThanOrEqual(atLeast);
    const { problems, pairs } = judge(runs);
    expect(problems, `${label}：沙盘栏里这几处的字直接落在了沙盘栏的底色上，或者太淡`).toEqual([]);
    for (const [pair, ratio] of pairs) seen.set(pair, ratio);
  };
  const pane = stagePane(page);

  for (const size of [WINDOWS[0], WINDOWS[2]]) {
    const where = nameOf(size);
    // 摆着沙盘：最后一节（有“远处”那一行），再点开“说明”
    const { headings } = await openStop(page, size);
    await expectStageAt(page, headings[0]);
    expect(await pane.evaluate((el) => getComputedStyle(el).backgroundColor), `${where}：沙盘栏的底色`).toBe(FIGURE_GROUND);
    expect(await pane.evaluate((el) => getComputedStyle(el).getPropertyValue('--color-paper-sunk').trim()), 'tokens.css 里沙盘栏的底色（人物自己的一套，写在沙盘栏上）').toBe('#c5b189');
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
    expect(await notice(page).evaluate((el) => getComputedStyle(el).backgroundColor), `${where}：按钮下面那一行话的底色是页面的颜色，不是沙盘栏的底色`).toBe(PAGE);
    await look(`${where}，只放图片`, 8);
    // 读者要来的沙盘：那一行话后面有“换回图片”
    await tap(page, '.stage-controls .stage-retry');
    await expectPane(page, 'ready', 'table');
    await expect(pane.locator('.stage-notice-button')).toBeVisible();
    // “换回图片”是一个按钮，不是一枚小标签：白底小板的打扮（白底、一圈细边、圆角、一道影子），22 像素高，能点的地方有 44
    const back = await slipDress(page, '.stage-notice-button');
    expect({ ground: back.ground, edge: back.edge, radius: back.radius, innerLine: back.innerLine, dropShadow: back.dropShadow, height: back.height }, `${where}：“换回图片”`).toEqual({
      ground: PLATE,
      edge: `1px solid ${PLATE_EDGE}`,
      radius: '3px',
      innerLine: false,
      dropShadow: true,
      height: 22,
    });
    expect(back.tapHeight, `${where}：“换回图片”能点的地方`).toBeGreaterThanOrEqual(44);
    await look(`${where}，读者要来的沙盘`, 8);

    // 画面断了、又没有图片：一句话和一个按钮
    await openStop(page, size);
    await expectStageAt(page, headings[0]);
    await page.evaluate(() => document.querySelector<HTMLElement>('.fake-stage-lose')?.click());
    await expectPane(page, 'lost', 'none');
    await expect(pane.locator('.stage-message p')).toBeVisible();
    await look(`${where}，画面断了`, 4);
  }

  // 人物页上的全程沙盘（替身）：按钮、题记那一条的配法和一站的沙盘是同一套
  await page.goto('about:blank');
  await page.setViewportSize(WINDOWS[0]);
  const { figureId } = await openFigureWithTable(page, fakeUrl('#/'));
  await page.goto('about:blank');
  await page.goto(fakeUrl(`#/${figureId}`));
  // 这位人物有全程沙盘，人物页上就该摆着它：摆不出来算没通过，不是“没有就不看”
  const routeShown = await expectRoute(page);
  expect(routeShown, '人物页上摆着全程沙盘').toBe(routeOnDisk(figureId) !== null);
  if (routeShown) await look('人物页的全程沙盘', 3);

  console.log(['沙盘栏里见到的每一种配法（字的颜色、垫在下面的是谁、对比）：', ...[...seen].sort().map(([pair, ratio]) => `  ${ratio} 比 1　${pair}`)].join('\n'));

  // 焦点框。用键盘走到“到沙盘”，按回车：焦点到沙盘栏上；再按 Tab：到它的第一个按钮上。
  const { headings } = await openStop(page, WINDOWS[0]);
  await expectStageAt(page, headings[0]);
  await page.locator('.skip-to-stage').focus();
  await page.keyboard.press('Enter');
  await expect(pane).toBeFocused();
  const ring = (selector: string, pseudo?: string): Promise<{ colour: string; style: string; width: string; offset: string; shadow: string; edge: string }> =>
    page.locator(selector).first().evaluate((el, which) => {
      const style = getComputedStyle(el, which ?? null);
      return { colour: style.outlineColor, style: style.outlineStyle, width: style.outlineWidth, offset: style.outlineOffset, shadow: style.boxShadow, edge: `${style.borderTopWidth} ${style.borderTopStyle} ${style.borderTopColor}` };
    }, pseudo);
  // 栏自己的框画在栏里面（栏贴着屏幕的边）：深灰的一道，2 像素
  const paneRing = await ring('.stage-pane');
  expect({ colour: paneRing.colour, style: paneRing.style, width: paneRing.width, offset: paneRing.offset }, '焦点在沙盘栏上时的框').toEqual({ colour: FRAME_INK, style: 'solid', width: '2px', offset: '-2px' });
  // 摆着沙盘的时候栏被盖满了，另画一圈叠在所有东西上面：外面深灰 2 像素，里面贴着一圈白 2 像素
  const paneOver = await ring('.stage-pane', '::after');
  expect(paneOver.edge, '叠在栏里所有东西上面的那一圈：外面深灰').toBe(`2px solid ${FRAME_INK}`);
  expect(paneOver.shadow, '叠在栏里所有东西上面的那一圈：里面一圈白').toBe(`${PLATE} 0px 0px 0px 2px inset`);
  // 沙盘的替身自己也有几个按钮，排在页面的按钮前面：一路按 Tab，走到“古名”上为止
  for (let presses = 0; presses < 8; presses++) {
    await page.keyboard.press('Tab');
    if (await page.evaluate(() => Boolean(document.activeElement?.closest('.names-switch')))) break;
  }
  await expect(pane.locator('.names-switch button').first()).toBeFocused();
  // 按钮上的框是两道：外面一圈深灰（2 像素，离开 2 像素），里面贴着按钮的一圈白（画出来的影子，2 像素）
  const buttonRing = await ring('.names-switch button');
  expect({ colour: buttonRing.colour, style: buttonRing.style, width: buttonRing.width, offset: buttonRing.offset }, '焦点在沙盘栏的按钮上时的框：外面一圈深灰').toEqual({ colour: FRAME_INK, style: 'solid', width: '2px', offset: '2px' });
  expect(buttonRing.shadow, '焦点在沙盘栏的按钮上时的框：里面一圈白').toContain(`${PLATE} 0px 0px 0px 2px`);
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
    // 粗细也对：黑体的是 500（这套黑体只带了这一种），宋体的是 400
    const of = (selector: string): Promise<{ size: number; family: string; weight: string; colour: string }> =>
      pane.locator(selector).first().evaluate((el) => {
        const style = getComputedStyle(el);
        return { size: parseFloat(style.fontSize), family: style.fontFamily.replace(/^["']/, '').split(/["',]/)[0], weight: style.fontWeight, colour: style.color };
      });
    expect(await of('.stage-section-name'), '小节的名字').toEqual({ size: 15, family: 'Yanlu Sans', weight: '500', colour: FRAME_INK });
    expect(await of('.stage-date'), '时间').toEqual({ size: 14, family: 'Yanlu Sans', weight: '500', colour: FRAME_SOFT });
    expect(await of('.stage-note-short'), '说明').toEqual({ size: 14, family: 'Yanlu Song', weight: '400', colour: FRAME_SOFT });
    expect(await of('.stage-scale-label'), '比例尺上的数').toEqual({ size: 14, family: 'Yanlu Sans', weight: '500', colour: FRAME_INK });
    expect(await of('.stage-north span'), '“北”').toEqual({ size: 14, family: 'Yanlu Sans', weight: '500', colour: FRAME_INK });
    // 指北针朝北的那一头是实心的，用的是强调色（照记号量：在页面上放一个读这个记号的小块，比它算出来的颜色）；另一头是一道线，颜色跟着字
    const needleLook = await pane.locator('.stage-north svg').evaluate((svg) => {
      const probe = document.createElement('i');
      probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--color-accent)';
      document.body.appendChild(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      const paths = Array.from(svg.querySelectorAll('g path'));
      const tip = paths.filter((item) => item.classList.contains('stage-north-tip'));
      const rest = paths.filter((item) => !item.classList.contains('stage-north-tip'));
      return { accent, tips: tip.length, tipFill: tip[0] ? getComputedStyle(tip[0]).fill : '', others: rest.length, shaftStroke: rest[0] ? getComputedStyle(rest[0]).stroke : '', shaftWidth: rest[0] ? parseFloat(getComputedStyle(rest[0]).strokeWidth) : 0, ink: getComputedStyle(svg).color };
    });
    expect({ tips: needleLook.tips, others: needleLook.others }, '指北针：一个实心的箭头，一道线').toEqual({ tips: 1, others: 1 });
    expect(needleLook.tipFill, '指北针朝北的那一头的颜色').toBe(needleLook.accent);
    expect(needleLook.accent).toBe(FRAME_ACCENT);
    expect(needleLook.shaftStroke, '指北针另一头那道线的颜色').toBe(needleLook.ink);
    expect(needleLook.shaftWidth, '那道线的粗细（画布上的单位）').toBeGreaterThanOrEqual(2);
    expect(await of('.stage-note-button'), '“说明”按钮').toEqual({ size: 14, family: 'Yanlu Sans', weight: '500', colour: FRAME_ACCENT });
    expect(await of('.stage-reset'), '“回到这一节”').toMatchObject({ size: 15, family: 'Yanlu Sans', weight: '500' });
    // 题记那一行：字号照栏宽算；它是一句话，多大都是宋体
    const line = await of('.stage-line');
    const wanted = lineSize(width.inner);
    expect(line.size, `题记的字号（栏里面宽 ${width.inner}）`).toBe(wanted);
    expect(width.lineSize, '页面写在栏上的 --line-size').toBe(`${wanted}px`);
    expect({ family: line.family, weight: line.weight }, `题记 ${line.size}px`).toEqual({ family: 'Yanlu Song', weight: '400' });
    expect(width.kai, '栏上不挂 is-kai').toBe(false);
    expect(line.colour).toBe(FRAME_INK);
    console.log(`${nameOf(size)}：沙盘栏连边线 ${width.outer}、里面 ${width.inner} 像素宽；题记 ${line.size}px ${line.family}`);

    // 最后一节（有“远处”那一行），点开“说明”
    await scrollToBottom(page);
    await expectStageAt(page, headings[headings.length - 1]);
    await expect(pane.locator('.stage-caption')).toHaveAttribute('data-section', headings[headings.length - 1]);
    if ((await pane.locator('.stage-far li').count()) > 0) expect(await of('.stage-far li'), '远处').toEqual({ size: 14, family: 'Yanlu Song', weight: '400', colour: FRAME_INK });
    await tap(page, '.stage-note-button');
    await expect(pane.locator('.stage-note-panel')).toBeVisible();
    await small('最后一节，“说明”开着');
    expect(await of('.stage-note-lines p'), '展开的说明').toMatchObject({ size: 15, family: 'Yanlu Song', weight: '400' });

    // 只放图片：那一行话；读者要来的沙盘：“换回图片”
    await openStop(page, size, PANE_QUERIES.only);
    await expectPane(page, 'slow', 'still');
    await small('只放图片');
    expect(await of('.stage-notice p'), '按钮下面的那一行话').toEqual({ size: 14, family: 'Yanlu Song', weight: '400', colour: FRAME_SOFT });
    await tap(page, '.stage-controls .stage-retry');
    await expectPane(page, 'ready', 'table');
    await small('读者要来的沙盘');
    expect(await of('.stage-notice-button'), '“换回图片”').toEqual({ size: 14, family: 'Yanlu Sans', weight: '500', colour: FRAME_ACCENT });
  });
}

test('窄的排法（窗口 1000 × 768，沙盘栏 560 宽）：题记那一块 94 像素高，字也没有小于 14px 的，题记和远处两行、说明一行都看得全', async ({ page }) => {
  const pane = stagePane(page);
  const { headings } = await openStop(page, { width: 1000, height: 768 });
  await expectStageAt(page, headings[0]);
  const width = await paneWidth(page);
  expect({ outer: width.outer, wide: width.wide }).toEqual({ outer: 560, wide: false });
  for (const last of [false, true]) {
    if (last) {
      await scrollToBottom(page);
      await expectStageAt(page, headings[headings.length - 1]);
      await expect(pane.locator('.stage-caption')).toHaveAttribute('data-section', headings[headings.length - 1]);
    }
    const at = last ? '最后一节' : '第 1 节';
    const runs = await paneRuns(page);
    expect(runs.filter((run) => run.size < 14).map((run) => `${run.where}“${run.text}”${run.size}px`), `${at}：小于 14px 的字`).toEqual([]);
    expect(judge(runs).problems, `${at}：字垫着什么、够不够深`).toEqual([]);
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
      name: { size: 14, family: 'Yanlu Sans' },
      line: { size: 14, family: 'Yanlu Song' },
      brief: { size: 14, family: 'Yanlu Song' },
      wordsCut: false,
      briefCut: false,
      shortShown: false,
    });
  }
});

test('题记写满 40 个字：从 560 像素宽的栏往上，哪一种栏宽都放得下；584 起一行不截断、不小于 14px；题记是一句话，多大都是宋体，栏上不挂 is-kai', async ({ page }) => {
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
  // 1000 的窗口上栏正好 560 宽；1024 是横着拿的平板（栏 584）；1100 到 1102 跨过题记从 15px 长到 16px 的那条线（原来到了 16px 换楷体，现在不换）。
  const widths = [1000, 1001, 1010, 1022, 1023, 1024, 1025, 1040, 1060, 1080, 1100, 1101, 1102, 1103, 1120, 1180, 1280, 1366, 1440, 1920, 560, 583, 584, 585, 600, 660, 661, 662, 700, 768, 820, 959];
  const rows: string[] = [];
  let wideSeen = 0;
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
        room: el.clientWidth,
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
      // 字号是整数的像素，就是算法往下取整的那个数；40 个这么大的字不比这一行宽。
      // 这三句是算术，不靠这台机器怎么排字：一个字只占整数个像素的系统上（Linux），不是整数的字号会多排出一两个像素，行尾被截掉。
      expect(Number.isInteger(got.size), `${where}：题记的字号是 ${got.size}px，不是整数的像素`).toBe(true);
      expect(got.size, `${where}：题记的字号`).toBe(wanted);
      expect(width.lineSize, `${where}：页面写在栏上的 --line-size`).toBe(`${wanted}px`);
      expect(40 * got.size, `${where}：40 个 ${got.size}px 的字要 ${40 * got.size} 像素，这一行只有 ${got.room} 像素`).toBeLessThanOrEqual(got.room);
      expect(got.family, `${where}：题记 ${got.size}px 的字体`).toBe('Yanlu Song');
      expect(width.kai, `${where}：栏上挂没挂 is-kai`).toBe(false);
      wideSeen++;
    } else {
      expect(got.wordsDisplay, `${where}：窄的排法`).toBe('block');
      expect(got.family, `${where}：窄的排法里题记是宋体`).toBe('Yanlu Song');
      expect(got.size, `${where}：窄的排法里题记的字号`).toBe(14);
      expect(got.wordsCut, `${where}：窄的排法里，40 个字的题记连同远处两行放不下`).toBe(false);
      expect(width.kai).toBe(false);
      narrowSeen++;
    }
    rows.push(`  窗口 ${windowWidth}：栏 ${width.outer}（里面 ${width.inner}），${width.wide ? `宽的排法，题记 ${got.size}px ${got.family}，40 个字 ${40 * got.size} 像素，这一行 ${got.room} 像素` : '窄的排法，题记 14px 宋体，两行'}`);
  }
  console.log(['40 个字的题记，各种栏宽上：', ...rows].join('\n'));
  // 三种情形都量到了：不然这一项没查到东西
  expect(wideSeen).toBeGreaterThan(10);
  expect(narrowSeen).toBeGreaterThan(3);
});

test('按钮是白底的板，古名今名选中的是墨蓝的字加实心的圆点、垫一块淡蓝，换着选按钮不挪地方；题记那一条是页面的颜色、上边一道细线；题签还是人物自己的样子：纸条、楷体、脚上有印', async ({ page }) => {
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
  // 古名今名那一块：白底的板，一圈半透明深灰的细边，圆角，外面一道影子（没有画在里面的线）
  const switchPlate = await slip('.names-switch');
  expect({ ground: switchPlate.ground, edge: switchPlate.edge, radius: switchPlate.radius }, '.names-switch 是一块白底的板').toEqual({ ground: PLATE, edge: PLATE_EDGE, radius: '4px' });
  expect(switchPlate.shadow, '.names-switch 有影子').not.toBe('none');
  expect(switchPlate.shadow, '.names-switch 里面没有另画一圈线').not.toContain('inset');
  // “回到这一节”：刚摆好、还没转动过，用不了——平的一块板，边是沙盘栏上的线，没有影子
  await expect(pane.locator('.stage-reset')).toHaveAttribute('aria-disabled', 'true');
  const resetOff = await slip('.stage-reset');
  expect(resetOff, '.stage-reset 还用不了的时候').toEqual({ ground: PLATE, edge: LINE_PANE, shadow: 'none', radius: '4px' });
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
  for (const item of before) expect(item.markSize, `“${item.text}”前面的圆点`).toBe('7px × 7px');
  expect(before[0].fill, '选中的垫一块淡蓝').toBe(WASH);
  expect(before[1].fill, '没选中的不铺底色').toBe('rgba(0, 0, 0, 0)');
  expect({ colour: before[0].colour, mark: before[0].mark, line: before[0].markLine }, '选中的：墨蓝的字，实心的圆点').toEqual({ colour: FRAME_ACCENT, mark: FRAME_ACCENT, line: 'none' });
  expect({ colour: before[1].colour, mark: before[1].mark }, '没选中的：灰字，空心的圆圈').toEqual({ colour: FRAME_SOFT, mark: 'rgba(0, 0, 0, 0)' });
  expect(before[1].markLine, '没选中的圆圈有一圈线').toContain('inset');
  const resetLeft = (): Promise<number> => pane.locator('.stage-reset').evaluate((el) => el.getBoundingClientRect().left);
  const resetBefore = await resetLeft();
  await tap(page, '.names-switch button[aria-pressed="false"]');
  await expect(pane.locator('.names-switch button').nth(1)).toHaveAttribute('aria-pressed', 'true');
  const after = await names();
  expect(after.map((item) => ({ left: item.left, width: item.width })), '换着选，两个按钮都不变宽、不挪地方').toEqual(before.map((item) => ({ left: item.left, width: item.width })));
  expect(await resetLeft()).toBe(resetBefore);
  expect({ colour: after[1].colour, mark: after[1].mark, fill: after[1].fill }).toEqual({ colour: FRAME_ACCENT, mark: FRAME_ACCENT, fill: WASH });
  expect({ colour: after[0].colour, fill: after[0].fill }).toEqual({ colour: FRAME_SOFT, fill: 'rgba(0, 0, 0, 0)' });
  // 读者动过镜头以后（替身上有一个按钮说“动过了”），“回到这一节”用得了：和别的按钮一样是一块完整的板
  await page.evaluate(() => document.querySelector<HTMLElement>('.fake-stage-nudge')?.click());
  await expect(pane.locator('.stage-reset')).not.toHaveAttribute('aria-disabled', 'true');
  const resetOn = await slip('.stage-reset');
  expect({ ground: resetOn.ground, edge: resetOn.edge, radius: resetOn.radius }, '.stage-reset 用得了的时候').toEqual({ ground: PLATE, edge: PLATE_EDGE, radius: '4px' });
  expect(resetOn.shadow, '.stage-reset 用得了的时候有影子').toBe(switchPlate.shadow);

  // ---- 题记那一条
  const foot = await pane.locator('.stage-foot').evaluate((el) => {
    const style = getComputedStyle(el);
    return { ground: style.backgroundColor, line: style.boxShadow, fadeAbove: getComputedStyle(el, '::before').content, fadeBelow: getComputedStyle(el, '::after').content };
  });
  expect(foot.ground, '题记那一条的底').toBe(PAGE);
  expect(foot.line, '题记那一条上边的细线（画在里面，不占地方）').toMatch(/inset/);
  expect({ above: foot.fadeAbove, below: foot.fadeBelow }, '题记那一条上面没有另外垫着淡出去的一截').toEqual({ above: 'none', below: 'none' });
  const rule = await pane.locator('.stage-section-name').evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(rule, '小节名上面那道墨蓝的短线').toContain('31, 75, 110');

  // ---- 题签：每一小节看一遍。人物自己的样子，框架换了它一个数也不动：纸条、楷体，脚上有印；水名是靛青；远处是虚线
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
      expect({ ground: strip.ground, size: strip.size, family: strip.family, edge: strip.edge, pad: strip.pad }, at).toEqual({ ground: FIGURE_SLIP, size: '17px', family: 'Yanlu Kai', edge: '0px', pad: '6px 6px 16px 6px' });
      expect(strip.seal, `${at}脚上的印`).toBe(`6px × 6px ${FIGURE_MARK} 5px`);
      expect(strip.colour, `${at}的字`).toBe(strip.tone === 'water' ? FIGURE_WATER : FIGURE_INK);
      expect(strip.outline, `${at}的边`).toBe(strip.tone === 'far' ? 'dashed' : 'none');
    }
  }
  expect([...tones].sort(), '水名、远处、平常的地名三种题签都看到了').toEqual(['far', 'place', 'water']);

  // ---- 窄的栏（窗口 1000 宽，栏 560）：题签小一号，印也小一号
  await page.setViewportSize({ width: 1000, height: 768 });
  await expect.poll(async () => (await paneWidth(page)).wide).toBe(false);
  await twoFrames(page);
  // 窗口的大小变了以后题签要重摆一遍：刚才那几个可能正好被换掉，读到的是已经不在页面上的一个，样样都是空的
  //（发布流程的机器上碰到过）。所以读了再读，直到读出来的是摆在页面上的那一个的数。
  const readSmall = (): Promise<{ size: string; pad: string; seal: string } | null> =>
    pane.locator('.stage-host .strip').evaluateAll((items) => {
      const item = items.find((one) => one.isConnected && (one as HTMLElement).style.visibility !== 'hidden');
      if (!item) return null;
      const style = getComputedStyle(item);
      const seal = getComputedStyle(item, '::after');
      return { size: style.fontSize, pad: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`, seal: `${seal.width} × ${seal.height} ${seal.bottom}` };
    });
  await expect.poll(readSmall, { message: '窄的栏上的题签：小一号，印也小一号' }).toEqual({ size: '14px', pad: '4px 5px 13px 5px', seal: '5px × 5px 4px' });
});

test('四种标准的窗口上，每一小节：题记那一条是不透明的页面颜色；说明那一句占满这一条的宽，“说明”按钮在右头，是白底小板的打扮；没有截掉的字', async ({ page }) => {
  test.setTimeout(240_000);
  const pane = stagePane(page);
  const rows: string[] = [];
  for (const size of WINDOWS) {
    const where = nameOf(size);
    const { headings } = await openStop(page, size);
    await expectStageAt(page, headings[0]);
    expect((await paneWidth(page)).wide, `${where}：是宽的排法`).toBe(true);
    for (const [i, heading] of headings.entries()) {
      if (i === headings.length - 1) await scrollToBottom(page);
      else if (i > 0) await scrollToSection(page, heading);
      await expectStageAt(page, heading);
      await expect(pane.locator('.stage-caption')).toHaveAttribute('data-section', heading);
      await fontsReady(page);
      const got = await pane.locator('.stage-foot').evaluate((foot) => {
        const need = (selector: string): HTMLElement => {
          const el = foot.querySelector<HTMLElement>(selector);
          if (!el) throw new Error(`题记那一条里没有 ${selector}`);
          return el;
        };
        const caption = need('.stage-caption');
        const style = getComputedStyle(caption);
        const box = caption.getBoundingClientRect();
        const contentLeft = box.left + parseFloat(style.paddingLeft);
        const contentRight = box.right - parseFloat(style.paddingRight);
        const short = need('.stage-note-short');
        const shortBox = short.getBoundingClientRect();
        const button = need('.stage-note-button').getBoundingClientRect();
        const legend = need('.stage-caption-head').lastElementChild?.getBoundingClientRect();
        const line = need('.stage-line');
        const far = foot.querySelector<HTMLElement>('.stage-far');
        // 说明那一句自己的字：占了几行，最右到哪
        const range = document.createRange();
        range.selectNodeContents(short);
        const rects = Array.from(range.getClientRects());
        const lineHeight = parseFloat(getComputedStyle(short).lineHeight);
        const noteLines = new Set(rects.map((rect) => Math.round(rect.top))).size;
        const last = far ?? short;
        return {
          band: foot.getBoundingClientRect().height,
          ground: getComputedStyle(foot).backgroundColor,
          noteLeft: shortBox.left - contentLeft,
          noteRoom: shortBox.width,
          noteLines,
          lineHeight,
          noteCut: short.scrollHeight > short.clientHeight + 1,
          noteTextRight: Math.max(...rects.map((rect) => rect.right)),
          buttonLeft: button.left,
          buttonRightGap: contentRight - button.right,
          buttonTop: button.top - shortBox.top,
          buttonHeight: button.height,
          buttonWidth: button.width,
          legendRightGap: legend ? contentRight - legend.right : null,
          legendBottom: legend ? legend.bottom : null,
          buttonTopAt: button.top,
          gap: button.left - shortBox.right,
          lineCut: line.scrollWidth > line.clientWidth,
          farCut: far !== null && (far.scrollWidth > far.clientWidth + 1 || Array.from(far.children).some((item) => item.scrollWidth > item.clientWidth)),
          farTop: far ? far.getBoundingClientRect().top - box.top : null,
          ends: last.getBoundingClientRect().bottom - box.top,
          captionWidth: contentRight - contentLeft,
        };
      });
      const at = `${where}，“${heading}”`;
      // 题记那一条：130 像素高（宽的排法），底是页面的颜色，不透明
      expect({ band: got.band, ground: got.ground }, `${at}：题记那一条`).toEqual({ band: 130, ground: PAGE });
      // 说明那一句从这一条的左边排起，一直占到“说明”按钮跟前：这一条有多宽，它一行就有多长（不再有 704 像素的上限）
      expect(got.noteLeft, `${at}：说明那一句从这一条的左边排起`).toBeCloseTo(0, 0);
      expect(got.noteRoom + got.gap + got.buttonWidth, `${at}：说明那一句、中间的空、按钮，合起来占满这一条`).toBeCloseTo(got.captionWidth, 0);
      expect(got.gap, `${at}：说明那一句和按钮之间的空`).toBeCloseTo(12, 0);
      // “说明”按钮：在这一条的右头（和上面的比例尺、指北一样靠右），和说明的头一行一样高低，在比例尺和指北的下面
      expect(got.buttonRightGap, `${at}：“说明”按钮贴着这一条的右头`).toBeCloseTo(0, 0);
      expect(got.legendRightGap, `${at}：比例尺和指北也贴着右头`).toBeCloseTo(0, 0);
      expect(got.buttonTop, `${at}：“说明”按钮和说明的头一行对齐`).toBeCloseTo(0, 0);
      expect(got.buttonHeight, `${at}：“说明”按钮看着多高`).toBe(20);
      expect(got.buttonTopAt, `${at}：“说明”按钮在比例尺和指北的下面`).toBeGreaterThanOrEqual(got.legendBottom ?? Infinity);
      // 说明的字到不了按钮底下；最多两行，没有截掉的；题记、远处也没有截掉的
      expect(got.noteTextRight, `${at}：说明的字没有排到按钮底下`).toBeLessThanOrEqual(got.buttonLeft);
      expect(got.noteLines, `${at}：说明占几行`).toBeLessThanOrEqual(2);
      expect({ note: got.noteCut, line: got.lineCut, far: got.farCut }, `${at}：有没有截掉的字`).toEqual({ note: false, line: false, far: false });
      // 各行的位置：上边 8，抬头 26，题记 26，说明每行 20，远处一行 20——远处那一行紧接在说明下面
      if (got.farTop !== null) expect(got.farTop, `${at}：远处那一行的位置`).toBeCloseTo(8 + 26 + 26 + got.noteLines * got.lineHeight, 0);
      expect(got.ends, `${at}：最后一行字的下边，在这一条里面`).toBeLessThanOrEqual(130 - 10 + 0.5);
      rows.push(`  ${at}：说明 ${got.noteLines} 行（一行能有 ${Math.round(got.noteRoom)} 像素宽）${got.farTop === null ? '' : `，远处那一行在 ${Math.round(got.farTop)}`}，字到 ${Math.round(got.ends)} 为止`);
    }
    // “说明”按钮是一个按钮，不是一枚小标签：白底小板的打扮，能点的地方有 44 像素高
    const note = await slipDress(page, '.stage-note-button');
    expect({ ground: note.ground, edge: note.edge, radius: note.radius, innerLine: note.innerLine, dropShadow: note.dropShadow }, `${where}：“说明”按钮`).toEqual({
      ground: PLATE,
      edge: `1px solid ${PLATE_EDGE}`,
      radius: '3px',
      innerLine: false,
      dropShadow: true,
    });
    expect(note.tapHeight, `${where}：“说明”按钮能点的地方`).toBeGreaterThanOrEqual(44);
  }
  console.log(['题记那一条，四种标准的窗口上每一小节：', ...rows].join('\n'));
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
      expect(judge(runs).problems, `${at}：字垫着什么、够不够深`).toEqual([]);
    }
    // 题签是大的那一种
    // 读了再读，直到读出数来：题签会被重摆，单读一次可能读到刚被换掉的那一个
    await expect.poll(() => pane.locator('.stage-host .strip').evaluateAll((items) => items.filter((item) => item.isConnected).map((item) => getComputedStyle(item).fontSize)[0] ?? ''), { message: `${where}：题签的字号` }).toBe('17px');
    const width = await paneWidth(page);
    console.log(`${where}：沙盘栏 ${width.outer} 宽，${width.wide ? '宽的排法' : '窄的排法'}，四边留 ${top} ${right} ${bottom} ${left}，题记 130 高`);
  }
  // 样式表里没有老平板会丢掉的东西：改完一个字不差
  console.log(`老平板的替身：经手的样式表 ${[...new Set(changed.map((item) => item.sheet))].join('、')}；去掉的 @container ${changed.reduce((sum, item) => sum + item.containers, 0)} 块，作废的 cqw 声明 ${changed.reduce((sum, item) => sum + item.cqw, 0)} 条`);
  expect(changed.filter((item) => !item.same || item.containers > 0 || item.cqw > 0), '样式表里有老平板会丢掉的东西（@container、cqw）').toEqual([]);
});

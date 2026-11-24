// 首页和“来源”页，在真的页面上看。要对的东西都从真的文件读（卡片照 index.json，图片和题记照 figure.json，
// 字体照 src/fonts/shipped.ts，地形和水照每个场景文件的 credits，图片照每一站的 images，许可全文照 public/licences/）。
//
// 一、首页，四种标准的窗口上：一页纸和绢上的那一块。
//     宽屏（窗口 960 像素以上宽，而且横着）：纸在左，宽是窗口的 46%（最窄 464、最宽 640 像素），和屏幕一样高；绢在右，占满剩下的，
//     钉着不动。别的窗口：绢在上，和窗口一样宽，钉在顶上，高是屏幕的 56%（和人物页一样）；纸在下。
//     绢上摆的是第一位可以点进去的人物的全程沙盘，和人物页上是同一栏、同一座：看的是“全程”那一节，按钮是“古名、今名”“回到全程”，
//     下面是同一条题记；栏多大就是 tests/stage/support/standardPanes.ts 的 HOME_PANES 里写的；按一方印，就到那一站。
//     网站的名字是楷体，一行；内容里的每一张卡片都在，名字竖着写；可以点进去的是链接，
//     写着“从第一站读起”，点了进人物页；还没写的不是链接，标着“还没写”，点了哪也不去。页面不比窗口宽。
//     （能点的东西够不够 44 像素见方在 tests/e2e/leaf.spec.ts：首页和“来源”页都在那里一个一个点。）
// 二、“来源”页：一页纸独自立在绢上（最宽 640 像素，和屏幕一样高），没有沙盘栏。标题和四个小标题是楷体，字是宋体 17 像素。
//     三套字体各一条（黑体、宋体、楷体），名字、版本就是 shipped.ts 里的；每位可以点进去的人物的全程图片、每一座沙盘写的每一行都在，不重复；
//     每一站正文里的每一张图片都在。五份许可全文的链接答的是 200，是文本，和 public/licences/ 里的文件一个字不差；
//     点了就在这一页打开。“字体的网站”“图片出处”是新开一页的平常链接，页面自己不去取。链接下面是一道印泥红的线。
// 三、“来源”页里面的那一段程序是点进这一页才下载的：在首页、人物页、站点页上都没有取；从首页、人物页的目录后面、
//     一站的末尾三处都点得进去，那一段程序只取一次。从头到尾没有一个请求出了网站自己的地址。
//
// 沙盘用的是替身（?stage=fake）。这些只证明 Chromium 里是这样。

import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Figure, FigureCard, StopExtras } from '../../src/domain/types';
import { SHIPPED_FONTS } from '../../src/fonts/shipped';
import { LIBRARY_LICENCES, SOURCES_TEXT } from '../../src/ui/sourcesText';
import { HOME_PANES, STANDARD_PANES } from '../stage/support/standardPanes';
import { readBytes } from '../support/readBytes';
import { expectStageAt, expectRoute, fakeUrl, fontsReady, headingsOf, routeOnDisk, sceneOnDisk, stagePane } from './helpers';

const utf8 = new TextDecoder();
const readJson = <T,>(path: string): T => JSON.parse(utf8.decode(readBytes(path))) as T;
const WINDOWS = STANDARD_PANES.map((pane) => pane.window);
const nameOf = (size: { width: number; height: number }): string => `${size.width} × ${size.height}`;

/** 首页的卡片，按时代先后；可以点进去的人物的资料。 */
const CARDS = readJson<FigureCard[]>('content/figures/index.json').sort((a, b) => a.sortYear - b.sortYear);
const OPEN = CARDS.filter((card) => card.available);
const FIGURES = OPEN.map((card) => readJson<Figure>(`content/figures/${card.id}/figure.json`));

const INK = 'rgb(40, 35, 31)';
const INK_SOFT = 'rgb(90, 81, 70)';
const SEAL_RED = 'rgb(176, 58, 42)';
const SILK = 'rgb(197, 177, 137)';

/** 换一种窗口，从头打开一个地址。 */
async function openAt(page: Page, size: { width: number; height: number }, hash: string): Promise<void> {
  await page.goto('about:blank');
  await page.setViewportSize(size);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(fakeUrl(hash));
}

/** 等绢上的全程沙盘（替身）摆好。 */
async function tableShown(page: Page): Promise<void> {
  expect(await expectRoute(page), '绢上该摆着全程沙盘').toBe(true);
  await fontsReady(page);
}

test('首页，四种标准的窗口上：一页纸（网站的名字、一句话、每一张卡片、“来源”）和绢上的全程沙盘；宽屏上左右排，别的窗口上绢在上、钉在顶上', async ({ page }) => {
  test.setTimeout(240_000);
  expect(CARDS.length, '内容里的卡片').toBeGreaterThanOrEqual(2);
  expect(OPEN.length, '可以点进去的人物').toBeGreaterThanOrEqual(1);
  expect(CARDS.length - OPEN.length, '内容里要有还没写的人物，才查得到点不了的卡片').toBeGreaterThanOrEqual(1);
  const route = routeOnDisk(FIGURES[0].id);
  expect(route, '第一位可以点进去的人物要有全程沙盘').not.toBeNull();
  if (!route) return;

  const rows: string[] = [];
  for (const size of WINDOWS) {
    const where = nameOf(size);
    const sideBySide = size.width >= 960 && size.width > size.height;
    await openAt(page, size, '#/');
    await expect(page.locator('.cards .card')).toHaveCount(CARDS.length);
    await tableShown(page);

    const got = await page.evaluate(() => {
      const need = (selector: string): HTMLElement => {
        const el = document.querySelector<HTMLElement>(selector);
        if (!el) throw new Error(`页面上没有 ${selector}`);
        return el;
      };
      const box = (el: Element): { x: number; y: number; width: number; height: number; bottom: number; right: number } => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right };
      };
      const type = (el: Element): { family: string; size: number; colour: string } => {
        const style = getComputedStyle(el);
        return { family: style.fontFamily.replace(/^["']/, '').split(/["',]/)[0], size: parseFloat(style.fontSize), colour: style.color };
      };
      const leaf = need('.reading');
      const pane = need('.stage-pane');
      const title = need('.home-title');
      return {
        layout: Array.from(need('.home-layout').children).map((child) => child.className.split(' ')[0]),
        leaf: box(leaf),
        leafGround: getComputedStyle(leaf).backgroundColor,
        pane: box(pane),
        panePosition: getComputedStyle(pane).position,
        paneGround: getComputedStyle(pane).backgroundColor,
        shape: getComputedStyle(pane).getPropertyValue('--stage-shape').trim(),
        title: { ...type(title), text: title.textContent, lines: Math.round(title.getBoundingClientRect().height / parseFloat(getComputedStyle(title).lineHeight)) },
        line: { ...type(need('.home-line')), text: need('.home-line').textContent },
        paneSize: `${pane.offsetWidth} × ${pane.offsetHeight}`,
        section: pane.getAttribute('data-stage-section'),
        reset: need('.stage-reset').textContent,
        strips: Array.from(document.querySelectorAll('.stage-host .strip')).map((strip) => strip.getAttribute('data-strip-id')),
        seals: Array.from(document.querySelectorAll('.stage-host .strip-seal')).map((seal) => `${seal.getAttribute('data-stop-id')} ${seal.getAttribute('href')}`),
        shownStrips: Array.from(document.querySelectorAll('.stage-host .strip')).filter((strip) => getComputedStyle(strip).visibility === 'visible').length,
        controls: [...Array.from(document.querySelectorAll('.stage-pane .names-switch button')).map((button) => button.textContent), need('.stage-reset').textContent],
        caption: { section: need('.stage-caption').getAttribute('data-section'), line: need('.stage-caption .stage-line').textContent },
        cards: Array.from(document.querySelectorAll<HTMLElement>('.cards .card')).map((card) => {
          const name = card.querySelector<HTMLElement>('.card-name')!;
          const go = card.querySelector<HTMLElement>('.card-go');
          const tag = card.querySelector<HTMLElement>('.tag');
          return {
            id: card.getAttribute('data-figure-id'),
            element: card.tagName.toLowerCase(),
            href: card.getAttribute('href'),
            box: box(card),
            cursor: getComputedStyle(card).cursor,
            name: { ...type(name), text: name.textContent, writing: getComputedStyle(name).writingMode, tall: name.getBoundingClientRect().height > name.getBoundingClientRect().width },
            era: card.querySelector('.card-era')?.textContent,
            tagline: { ...type(card.querySelector('.card-tagline')!), text: card.querySelector('.card-tagline')?.textContent },
            go: go ? { ...type(go), text: go.textContent, rule: getComputedStyle(go, '::after').width } : null,
            tag: tag ? { text: tag.textContent, right: box(tag).right, top: box(tag).y } : null,
            bodyRight: box(card.querySelector('.card-body')!).right,
            top: box(card).y,
          };
        }),
        foot: { text: need('.reading .stop-nav a').textContent, href: need('.reading .stop-nav a').getAttribute('href'), ...box(need('.reading .stop-nav a')) },
        pageWidth: document.documentElement.scrollWidth,
        window: { width: window.innerWidth, height: window.innerHeight },
      };
    });

    // ---- 两块怎么摆
    expect(got.layout, `${where}：一页纸，后面是绢上的那一块`).toEqual(['reading', 'stage-pane']);
    expect(got.shape, `${where}：页面说的排法`).toBe(sideBySide ? 'wide' : 'narrow');
    expect(got.pageWidth, `${where}：页面不比窗口宽`).toBeLessThanOrEqual(size.width);
    expect(got.paneGround, `${where}：绢上的那一块的底`).toBe(SILK);
    if (sideBySide) {
      const wanted = Math.min(640, Math.max(464, size.width * 0.46));
      expect(got.leaf.x, `${where}：纸在左`).toBe(0);
      expect(Math.abs(got.leaf.width - wanted), `${where}：纸宽 ${got.leaf.width}，该是 ${wanted}（窗口的 46%，最窄 464、最宽 640）`).toBeLessThan(1);
      expect(got.leaf.height, `${where}：纸和屏幕一样高（或者更长）`).toBeGreaterThanOrEqual(size.height);
      expect(Math.abs(got.pane.x - got.leaf.width), `${where}：绢紧挨着纸的右边`).toBeLessThan(1);
      expect(Math.abs(got.pane.right - size.width), `${where}：绢占满右边`).toBeLessThan(1);
      expect({ y: got.pane.y, height: got.pane.height, position: got.panePosition }, `${where}：绢上的那一块和屏幕一样高，钉着不动`).toEqual({ y: 0, height: size.height, position: 'sticky' });
    } else {
      // 绢在上：和人物页上一样，沙盘栏钉在顶上，高是屏幕的 56%
      expect({ x: got.pane.x, y: got.pane.y, width: got.pane.width }, `${where}：绢在上，和窗口一样宽`).toEqual({ x: 0, y: 0, width: size.width });
      expect(got.panePosition, `${where}：绢上的那一块钉在顶上`).toBe('sticky');
      expect(Math.abs(got.pane.height - size.height * 0.56), `${where}：绢上的那一块高 ${got.pane.height}，该是屏幕的 56%`).toBeLessThan(1);
      expect(got.leaf.x, `${where}：纸在下，和窗口一样宽`).toBe(0);
      expect(got.leaf.width, `${where}：纸和窗口一样宽`).toBe(size.width);
      expect(Math.abs(got.leaf.y - got.pane.bottom), `${where}：纸紧接在绢的下面`).toBeLessThan(1);
      // 头一张卡片的上边在第一屏里：一打开就看得见有卡片
      expect(got.cards[0].top, `${where}：头一张卡片的上边在第一屏里`).toBeLessThan(size.height - 44);
    }

    // ---- 绢上摆的是第一位可以点进去的人物的全程沙盘：看的是头一节，印通到他的各站。
    //      栏多大就是 HOME_PANES 里写的（宽屏上首页那页纸比人物页的宽，栏就窄一些；题签在这样的栏上摆不摆得下，
    //      tests/stage/route-views.test.ts 照同一份数查）；按钮、题记和人物页上是同一套。
    const wantedPane = HOME_PANES.find((pane) => pane.window.width === size.width && pane.window.height === size.height)!;
    expect(got.paneSize, `${where}：绢上的那一块多大`).toBe(`${wantedPane.size.width} × ${wantedPane.size.height}`);
    expect({ section: got.section, reset: got.reset, strips: got.strips }, `${where}：绢上的全程沙盘`).toEqual({ section: route.sections[0].heading, reset: '回到全程', strips: route.sections[0].strips });
    expect(got.controls, `${where}：栏上的按钮`).toEqual(['古名', '今名', '回到全程']);
    expect(got.caption, `${where}：栏下面的题记`).toEqual({ section: route.sections[0].heading, line: route.sections[0].line });
    expect(got.shownStrips, `${where}：题签都摆出来了`).toBe(route.sections[0].strips.length);
    expect(got.seals.length, `${where}：站的题签带着印`).toBeGreaterThanOrEqual(FIGURES[0].stops.length);
    for (const seal of got.seals) expect(FIGURES[0].stops.some((stop) => seal === `${stop.id} #/${FIGURES[0].id}/${stop.id}`), `${where}：印“${seal}”通到他的一站`).toBe(true);

    // ---- 那页纸上的字
    expect(got.title, `${where}：网站的名字`).toMatchObject({ family: 'Yanlu Kai', colour: INK, lines: 1 });
    expect(got.title.text).toBe((await page.title()).trim());
    expect(got.line, `${where}：名字下面的一句`).toMatchObject({ family: 'Yanlu Song', size: 19, colour: INK_SOFT });

    // ---- 卡片：一张不多、一张不少，按时代先后；一张在一张下面
    expect(got.cards.map((card) => card.id), `${where}：卡片`).toEqual(CARDS.map((card) => card.id));
    for (const [i, card] of CARDS.entries()) {
      const shown = got.cards[i];
      const at = `${where}，“${card.name}”的卡片`;
      expect(shown.name, at).toMatchObject({ text: card.name, family: 'Yanlu Kai', size: 40, writing: 'vertical-rl', tall: true });
      expect(shown.era, at).toBe(`${card.era} · ${card.years}`);
      expect(shown.tagline, at).toMatchObject({ text: card.tagline, family: 'Yanlu Song' });
      expect(shown.box.height, `${at}的高`).toBeGreaterThanOrEqual(150);
      expect(shown.box.right, `${at}在那页纸里`).toBeLessThanOrEqual(got.leaf.right);
      if (i > 0) expect(shown.box.y, `${at}排在上一张的下面`).toBeGreaterThanOrEqual(got.cards[i - 1].box.bottom + 8);
      if (card.available) {
        expect({ element: shown.element, href: shown.href, cursor: shown.cursor }, `${at}：可以点进去`).toEqual({ element: 'a', href: `#/${card.id}`, cursor: 'pointer' });
        expect(shown.go, `${at}：最后一行`).toMatchObject({ text: '从第一站读起', family: 'Yanlu Kai', size: 19, colour: SEAL_RED, rule: '26px' });
        expect(shown.tag, at).toBeNull();
      } else {
        expect({ element: shown.element, href: shown.href }, `${at}：不是链接`).toEqual({ element: 'div', href: null });
        expect(shown.cursor, `${at}：鼠标移上去不是“能点”的手`).not.toBe('pointer');
        expect(shown.tag?.text, at).toBe('还没写');
        // “还没写”在卡片的右上角
        expect(Math.abs((shown.tag?.right ?? 0) - shown.bodyRight), `${at}：“还没写”靠右`).toBeLessThan(1);
        expect((shown.tag?.top ?? 0) - shown.box.y, `${at}：“还没写”在上头`).toBeLessThan(40);
        expect(shown.go, at).toBeNull();
      }
    }
    expect({ text: got.foot.text, href: got.foot.href }, `${where}：卡片后面的链接`).toEqual({ text: '来源', href: '#/sources' });
    expect(got.foot.y, `${where}：“来源”在最后一张卡片下面`).toBeGreaterThan(got.cards[got.cards.length - 1].box.bottom);

    // ---- 点还没写的卡片：哪也不去
    const idle = page.locator('.card[data-available="false"]').first();
    await idle.scrollIntoViewIfNeeded();
    const idleBox = (await idle.boundingBox())!;
    await page.mouse.click(idleBox.x + idleBox.width / 2, idleBox.y + idleBox.height / 2);
    await page.waitForTimeout(150);
    expect(page.url(), `${where}：点了还没写的卡片，地址不该变`).toMatch(/#\/$/);
    await expect(page.locator('.cards .card')).toHaveCount(CARDS.length);

    // ---- 按绢上的一方印（像手指那样点在印的正中）：到那一站；后退，回到首页，沙盘还是那一节
    await page.evaluate(() => window.scrollTo(0, 0));
    //      挑一方正中没有被旁边的印的按处盖住的（全程那一节里有几方印挨得近，按处有相叠的）
    const sealAt = await page.evaluate(() => {
      for (const seal of Array.from(document.querySelectorAll<HTMLElement>('.stage-host .strip-seal'))) {
        const r = seal.getBoundingClientRect();
        const x = r.x + r.width / 2;
        const y = r.y + r.height / 2;
        if (document.elementFromPoint(x, y)?.closest('.strip-seal') === seal) return { stop: seal.getAttribute('data-stop-id') ?? '', x, y };
      }
      return null;
    });
    expect(sealAt, `${where}：要有一方按得到的印`).not.toBeNull();
    if (!sealAt) return;
    const sealStop = sealAt.stop;
    await page.mouse.click(sealAt.x, sealAt.y);
    await expect(page, `${where}：按了“${sealStop}”的印`).toHaveURL(new RegExp(`#/${FIGURES[0].id}/${sealStop}$`));
    await expect(page.locator('.stop-page')).toHaveAttribute('data-stop-id', sealStop);
    await page.goBack();
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.locator('.cards .card')).toHaveCount(CARDS.length);
    await tableShown(page);
    await expect(stagePane(page)).toHaveAttribute('data-stage-section', route.sections[0].heading);

    // ---- 点可以点进去的卡片：进人物页；那里摆的是同一位人物的全程沙盘，同一节、同样几条题签
    await page.locator('a.card').first().evaluate((link: HTMLElement) => link.click());
    await expect(page).toHaveURL(new RegExp(`#/${OPEN[0].id}$`));
    await expect(page.locator('.stop-item').first()).toBeVisible();
    await tableShown(page);
    const onFigure = await page.evaluate(() => ({
      section: document.querySelector('.stage-pane')!.getAttribute('data-stage-section'),
      strips: Array.from(document.querySelectorAll('.stage-host .strip')).map((strip) => strip.getAttribute('data-strip-id')),
    }));
    expect(onFigure, `${where}：首页绢上的全程沙盘，和人物页上是同一节、同样几条题签`).toEqual({ section: got.section, strips: got.strips });

    rows.push(
      `  ${where}：${sideBySide ? '左右排' : '绢在上'}；纸 ${Math.round(got.leaf.width)} 宽，绢上的那一块 ${got.paneSize}；` +
        `网站的名字 ${got.title.size}px 一行；卡片各高 ${got.cards.map((card) => Math.round(card.box.height)).join('、')}`,
    );
  }
  console.log(['首页：', ...rows].join('\n'));
});

test('“来源”页：一页纸立在绢上；三套字体照 shipped.ts，地形和水、图片照内容，一条不少；五份许可全文答的是 200、是文本；通到别的网站的只是链接', async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  // 要有的每一行，从文件里读
  const lines: string[] = [];
  const pictures: { stop: string; picture: StopExtras['images'][number] }[] = [];
  let scenes = 0;
  for (const figure of FIGURES) {
    // 全程沙盘的出处排在最前面，只印头一个分号前面署名的半句
    for (const line of routeOnDisk(figure.id)?.credits ?? []) lines.push(line.includes('；') ? `${line.split('；')[0]}。` : line);
    for (const stop of figure.stops) {
      const scene = sceneOnDisk(figure.id, stop.id);
      if (scene) {
        scenes++;
        lines.push(...scene.credits);
      }
      if (stop.status === 'complete') pictures.push(...readJson<StopExtras>(`content/figures/${figure.id}/stops/${stop.id}.json`).images.map((picture) => ({ stop: stop.shortTitle, picture })));
    }
  }
  // 说过的不再印：一模一样的一行，和“分号前面的半句，前面哪一行就是这样开头的”的一行（同一份数据在沙盘的凭据里又署了一遍，
  // 后半句“见上面的说明”是说给凭据里的读者听的）
  const wantedLines: string[] = [];
  for (const line of lines) if (!wantedLines.some((seen) => seen.startsWith(line.split('；')[0]))) wantedLines.push(line);
  expect(scenes, 'content/ 里要有沙盘，才查得到东西').toBeGreaterThan(0);
  expect(pictures.length, 'content/ 里要有图片，才查得到东西').toBeGreaterThan(0);

  for (const size of [WINDOWS[0], WINDOWS[2]]) {
    const where = nameOf(size);
    await openAt(page, size, '#/sources');
    await expect(page.locator('.sources .page-title')).toHaveText('来源');
    await expect(page.locator('.sources-list li').first()).toBeVisible();
    await expect(page.locator('.sources .quiet')).toHaveCount(0);
    await fontsReady(page);
    expect(await page.title()).toBe('来源 · 沿着他走过的路');

    const got = await page.evaluate(() => {
      const need = (selector: string): HTMLElement => {
        const el = document.querySelector<HTMLElement>(selector);
        if (!el) throw new Error(`页面上没有 ${selector}`);
        return el;
      };
      const type = (el: Element): { family: string; size: number; colour: string } => {
        const style = getComputedStyle(el);
        return { family: style.fontFamily.replace(/^["']/, '').split(/["',]/)[0], size: parseFloat(style.fontSize), colour: style.color };
      };
      const leaf = need('main.sources');
      const r = leaf.getBoundingClientRect();
      const section = (name: string): HTMLElement => need(`.sources [data-sources="${name}"]`);
      const linksOf = (root: Element): { text: string; href: string | null; target: string | null; rel: string | null; line: string; colour: string; lineColour: string }[] =>
        Array.from(root.querySelectorAll<HTMLAnchorElement>('.sources-links a')).map((a) => {
          const style = getComputedStyle(a);
          return { text: a.textContent ?? '', href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel'), line: style.textDecorationLine, colour: style.color, lineColour: style.textDecorationColor };
        });
      return {
        leaf: { x: r.x, width: r.width, height: r.height, right: r.right },
        ground: getComputedStyle(document.body).backgroundColor,
        panes: document.querySelectorAll('.stage-pane').length,
        crumbs: Array.from(leaf.querySelectorAll<HTMLAnchorElement>('.crumbs a')).map((a) => [a.textContent, a.getAttribute('href')]),
        title: type(need('.sources .page-title')),
        lead: { ...type(need('.sources-lead')), text: need('.sources-lead').textContent },
        headings: Array.from(leaf.querySelectorAll('h2')).map((h) => ({ ...type(h), text: h.textContent })),
        sections: Array.from(leaf.querySelectorAll('section')).map((s) => s.getAttribute('data-sources')),
        fonts: Array.from(section('fonts').querySelectorAll<HTMLElement>('.sources-item')).map((item) => ({ family: item.getAttribute('data-font'), says: item.querySelector('p')!.textContent, type: type(item.querySelector('p')!), links: linksOf(item) })),
        subset: section('fonts').lastElementChild!.textContent,
        land: Array.from(section('land').querySelectorAll('.sources-list li')).map((li) => li.textContent),
        pictures: Array.from(section('pictures').querySelectorAll('.sources-list li')).map((li) => ({ paragraphs: Array.from(li.querySelectorAll('p')).slice(0, 2).map((p) => p.textContent), links: linksOf(li) })),
        program: { says: section('program').querySelector('p')!.textContent, links: linksOf(section('program')), last: section('program').lastElementChild!.textContent },
        pageWidth: document.documentElement.scrollWidth,
      };
    });

    // ---- 一页纸独自立在绢上
    expect(got.panes, `${where}：“来源”页没有沙盘栏`).toBe(0);
    expect(got.ground, `${where}：页面的底是绢`).toBe(SILK);
    expect(got.leaf.width, `${where}：那页纸最宽 640 像素`).toBe(Math.min(640, size.width));
    expect(Math.abs(got.leaf.x - (size.width - got.leaf.width) / 2), `${where}：那页纸在正中`).toBeLessThan(1);
    expect(got.leaf.height, `${where}：那页纸和屏幕一样高（或者更长）`).toBeGreaterThanOrEqual(size.height);
    expect(got.pageWidth, `${where}：页面不比窗口宽`).toBeLessThanOrEqual(size.width);
    expect(got.crumbs).toEqual([['沿着他走过的路', '#/']]);

    // ---- 字：标题和四个小标题是楷体，别的是宋体 17 像素
    expect(got.title, `${where}：标题`).toMatchObject({ family: 'Yanlu Kai', colour: INK });
    expect(got.title.size, `${where}：标题和别的页面的大标题一样大`).toBeGreaterThanOrEqual(38);
    expect(got.lead, `${where}：标题下面的一句`).toMatchObject({ text: SOURCES_TEXT.lead, family: 'Yanlu Song', size: 17 });
    expect(got.sections).toEqual(['fonts', 'land', 'pictures', 'program']);
    expect(got.headings.map((h) => h.text)).toEqual(['字体', '地形和水', '图片', '程序']);
    for (const heading of got.headings) expect(heading, `${where}：小标题“${heading.text}”`).toMatchObject({ family: 'Yanlu Kai', colour: INK });

    // ---- 字体：三套各一条（黑体、宋体、楷体），照 shipped.ts
    expect(got.fonts.map((font) => font.family)).toEqual([SHIPPED_FONTS.sans.family, SHIPPED_FONTS.song.family, SHIPPED_FONTS.kai.family]);
    for (const [i, font] of [SHIPPED_FONTS.sans, SHIPPED_FONTS.song, SHIPPED_FONTS.kai].entries()) {
      const shown = got.fonts[i];
      expect(shown.says, `${where}：${font.family} 那一条`).toBe([SOURCES_TEXT.sans, SOURCES_TEXT.song, SOURCES_TEXT.kai][i](font));
      expect(shown.says, `${where}：${font.family} 那一条里的名字`).toContain(font.name);
      expect(shown.says, `${where}：${font.family} 那一条里的版本`).toContain(`${font.version} 版`);
      expect(shown.type, `${where}：${font.family} 那一条的字`).toEqual({ family: 'Yanlu Song', size: 17, colour: INK });
      expect(shown.links.map((link) => [link.text, link.href, link.target, link.rel]), `${where}：${font.family} 那一条的链接`).toEqual([
        ['许可全文（英文）', font.licence, null, null],
        ['字体的网站', font.site, '_blank', 'noopener noreferrer'],
      ]);
      for (const link of shown.links) expect({ line: link.line, colour: link.colour, lineColour: link.lineColour }, `${where}：链接“${link.text}”下面一道印泥红的线`).toEqual({ line: 'underline', colour: SEAL_RED, lineColour: SEAL_RED });
    }
    expect(got.subset).toBe(SOURCES_TEXT.subset(SHIPPED_FONTS.sans, SHIPPED_FONTS.song, SHIPPED_FONTS.kai));

    // ---- 地形和水：每一行都在，不重复
    expect(got.land, `${where}：地形和水`).toEqual(wantedLines);
    expect(new Set(got.land).size, `${where}：地形和水里有重复的行`).toBe(got.land.length);
    expect(new Set(got.land.map((line) => (line ?? '').split('；')[0])).size, `${where}：地形和水里有两行是一样开头的（像同一句印了两遍）`).toBe(got.land.length);
    for (const line of got.land) expect(line, `${where}：“见上面的说明”在这一页上指不到东西`).not.toContain('见上面的说明');

    // ---- 图片：每一张都在
    expect(got.pictures.map((picture) => picture.paragraphs), `${where}：图片`).toEqual(pictures.map(({ stop, picture }) => [`${stop}：${picture.caption}`, `${picture.credit} · ${picture.license}`]));
    expect(got.pictures.map((picture) => picture.links.map((link) => [link.text, link.href, link.target, link.rel]))).toEqual(pictures.map(({ picture }) => [['图片出处', picture.sourceUrl, '_blank', 'noopener noreferrer']]));

    // ---- 程序
    expect(got.program.says).toBe(SOURCES_TEXT.program);
    expect(got.program.links.map((link) => [link.text, link.href, link.target])).toEqual([
      ['React 的许可全文（英文）', LIBRARY_LICENCES.react, null],
      ['three.js 的许可全文（英文）', LIBRARY_LICENCES.three, null],
    ]);
    expect(got.program.last).toBe(SOURCES_TEXT.shipped);
  }

  // ---- 五份许可全文：答的是 200，是文本，和 public/licences/ 里的文件一个字不差
  //      （光看 200 不够：测试用的这个服务对不存在的地址也答 200，给的是首页；所以还要看它是文本、内容对得上）
  const licences = [SHIPPED_FONTS.sans.licence, SHIPPED_FONTS.song.licence, SHIPPED_FONTS.kai.licence, LIBRARY_LICENCES.react, LIBRARY_LICENCES.three];
  expect(new Set(licences).size).toBe(5);
  const said: string[] = [];
  for (const href of licences) {
    const address = new URL(href, page.url()).href;
    const answer = await page.request.get(address);
    expect(answer.status(), `${href} 答的`).toBe(200);
    expect(answer.headers()['content-type'] ?? '', `${href} 是文本`).toMatch(/^text\/plain/);
    const onDisk = utf8.decode(readBytes(`public/${href}`));
    const text = utf8.decode(await answer.body());
    expect(text.length, `${href} 的长短`).toBeGreaterThan(1000);
    expect(text === onDisk, `${href}：网站答的和 public/licences/ 里的文件不一样`).toBe(true);
    expect(text, `${href} 是不是许可的原文`).toMatch(href.includes('OFL') ? /SIL OPEN FONT LICENSE Version 1\.1/ : /MIT License/);
    said.push(`${href} ${text.length} 个字`);
  }
  // 点头一条（黑体）的“许可全文”：就在这一页打开那份文本；后退，回到“来源”页
  await page.locator('.sources [data-sources="fonts"] .sources-links a').first().click();
  await expect(page).toHaveURL(new RegExp(`${SHIPPED_FONTS.sans.licence.replace(/[.]/g, '[.]')}$`));
  await expect(page.locator('body')).toContainText('SIL OPEN FONT LICENSE');
  await page.goBack();
  await expect(page.locator('.sources .page-title')).toHaveText('来源');
  await expect(page.locator('.sources-list li').first()).toBeVisible();

  // ---- 通到别的网站的只是链接：从头到尾没有一个请求出了网站自己的地址
  const base = new URL(baseURL ?? page.url()).origin;
  expect(requests.length).toBeGreaterThan(10);
  expect(requests.filter((url) => !/^(data|blob|about):/.test(url) && new URL(url).origin !== base), '出了网站自己地址的请求').toEqual([]);
  console.log(`“来源”页：字体 ${Object.keys(SHIPPED_FONTS).length} 条，地形和水 ${wantedLines.length} 行（${scenes} 座沙盘、${FIGURES.length} 位人物），图片 ${pictures.length} 张；许可全文：${said.join('，')}；${requests.length} 个请求都是网站自己的地址`);
});

test('“来源”页里面的那一段程序点进去才下载：首页、人物页、站点页上都不取；从首页、人物页、一站的末尾三处都点得进去，只取一次', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const asked: string[] = [];
  page.on('request', (request) => {
    // 构建以后叫 assets/SourcesBody-….js；对着开发服务跑时是 src/ui/SourcesBody.tsx
    if (new URL(request.url()).pathname.includes('/SourcesBody')) asked.push(request.url());
  });
  const figure = FIGURES[0];
  // 写好了正文、有沙盘的头一站（下面要等它的正文出来）。有沙盘的站不一定写好了正文：眉州的沙盘比正文先做好
  const withTable = figure.stops.find((stop) => stop.status === 'complete' && sceneOnDisk(figure.id, stop.id) !== null);
  test.skip(!withTable, '还没有哪一站写好了正文又有沙盘');
  if (!withTable) return;
  const headings = headingsOf(sceneOnDisk(figure.id, withTable.id)!);

  const arrived = async (from: string): Promise<void> => {
    await expect(page, `${from}：地址`).toHaveURL(/#\/sources$/);
    await expect(page.locator('.sources .page-title')).toHaveText('来源');
    // 换页以后焦点在标题上（读屏和键盘从新页的开头接着走）
    await expect(page.locator('.sources .page-title')).toBeFocused();
    await expect(page.locator('.sources-lead'), `${from}：里面的东西`).toBeVisible();
    await expect(page.locator('.sources-list li').first()).toBeVisible();
    expect(await page.evaluate(() => window.scrollY), `${from}：换页以后从头读起`).toBe(0);
  };

  // 首页：不取
  await page.goto(fakeUrl('#/'));
  await expect(page.locator('.card').first()).toBeVisible();
  await expectRoute(page);
  await page.waitForTimeout(500);
  expect(asked, '首页上不该取“来源”页里面的那一段程序').toEqual([]);
  // 从首页点进去：取一次
  await page.locator('.home .stop-nav a').click();
  await arrived('从首页');
  expect(asked, '点进“来源”页，取它里面的那一段程序').toHaveLength(1);

  // 回首页（位置那一行），进人物页：不再取
  await page.locator('.sources .crumbs a').click();
  await expect(page.locator('.card').first()).toBeVisible();
  await page.locator('a.card').first().click();
  await expect(page.locator('.stop-item').first()).toBeVisible();
  await expectRoute(page);
  // 从人物页的目录后面点进去
  await page.locator('.figure-page .stop-nav a').click();
  await arrived('从人物页');

  // 进一站，滚到末尾，从“回到各站目录”旁边点进去
  await page.goBack();
  await expect(page.locator('.stop-item').first()).toBeVisible();
  await page.locator(`.stop-item[data-stop-id="${withTable.id}"]`).click();
  await expectStageAt(page, headings[0]);
  const foot = page.locator('.stop-page .stop-nav a');
  await expect(foot).toHaveText(['回到各站目录', '来源']);
  await foot.nth(1).evaluate((link: HTMLElement) => link.click());
  await arrived('从一站的末尾');
  expect(asked, '“来源”页里面的那一段程序只取一次').toHaveLength(1);

  // 另开一页，直接打开一站：没点“来源”就不取
  const other = await page.context().newPage();
  const askedThere: string[] = [];
  other.on('request', (request) => {
    if (new URL(request.url()).pathname.includes('/SourcesBody')) askedThere.push(request.url());
  });
  await other.goto(fakeUrl(`#/${figure.id}/${withTable.id}`));
  await expect(other.locator('.stop-page')).toHaveAttribute('data-stop-text', 'written');
  await expectStageAt(other, headings[0]);
  await other.goto(fakeUrl(`#/${figure.id}`));
  await expect(other.locator('.stop-item').first()).toBeVisible();
  await other.waitForTimeout(500);
  expect(askedThere, '人物页、站点页上不该取“来源”页里面的那一段程序').toEqual([]);
  await other.close();
  console.log(`“来源”页里面的那一段程序：${asked.map((url) => url.slice(url.lastIndexOf('/') + 1)).join('、')}，三处点进去一共取了 ${asked.length} 次；没点“来源”的时候不取`);
});

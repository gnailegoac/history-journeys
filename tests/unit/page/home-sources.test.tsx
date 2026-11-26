// 首页和“来源”页的行为：用假 DOM（miniDom.ts）在 Node 里连同 content/ 里真的内容跑一遍。
// 不看版面和样式（那是 tests/e2e 的事）。要对的东西都从真的文件读：卡片照 index.json，沙盘栏里的沙盘照 scenes/route.json，
// 字体照 src/fonts/shipped.ts，地形和水的每一行照每个场景文件的 credits，图片照每一站的 images，许可全文照 public/licences/。
import { readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { stopHref } from '../../../src/app/router';
import type { Figure, FigureCard, RouteScene, StopExtras, StopScene } from '../../../src/domain';
import { SHIPPED_FONTS } from '../../../src/fonts/shipped';
import { LIBRARY_LICENCES, SOURCES_TEXT } from '../../../src/ui/sourcesText';
import { SANS_LABELS, SITE_LINE, SITE_TITLE } from '../../../src/ui/text';
import { LIBRARY_LICENCES as LIBRARY_LICENCE_FILES, LICENCES_DIR } from '../../support/fontTool';
import { readBytes } from '../../support/readBytes';
import { installMiniDom, MiniElement } from './miniDom';

const doc = installMiniDom('?stage=fake');
const win = (globalThis as any).window;

// 全程沙盘读不出来的情形：__routeFails 是接下来还要读不出来几次（平常是 0，照常读）。
vi.mock('../../../src/ui/stageEngineSource', async (original) => {
  const actual = await original<typeof import('../../../src/ui/stageEngineSource')>();
  return {
    ...actual,
    pickRouteTable: (figureId: string) => {
      if (!((globalThis as any).__routeFails > 0)) return actual.pickRouteTable(figureId);
      (globalThis as any).__routeFails -= 1;
      return Promise.reject(new Error('这一次没读出来'));
    },
  };
});

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { HomePage } = await import('../../../src/ui/HomePage');
const { SourcesPage } = await import('../../../src/ui/SourcesPage');

const utf8 = new TextDecoder();
const readJson = <T,>(path: string): T => JSON.parse(utf8.decode(readBytes(path))) as T;
const ROOT = new URL('../../../', import.meta.url);
/** 一个文件夹里叫 .json 的文件（没有这个文件夹就是空的）。 */
const jsonIn = (dir: string): string[] => {
  try {
    return readdirSync(new URL(`${dir}/`, ROOT))
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => `${dir}/${name}`);
  } catch {
    return [];
  }
};

const cards = readJson<FigureCard[]>('content/figures/index.json').sort((a, b) => a.sortYear - b.sortYear);
const open = cards.filter((card) => card.available);
const figures = open.map((card) => readJson<Figure>(`content/figures/${card.id}/figure.json`));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = (ms = 40) => act(async () => void (await sleep(ms)));
const attr = (el: MiniElement | null | undefined, name: string) => el?.getAttribute(name) ?? null;
async function waitFor(ok: () => boolean, ms = 15000) {
  const until = Date.now() + ms;
  while (!ok() && Date.now() < until) await settle(20);
  if (!ok()) throw new Error('等不到');
}

async function mount(search: string, what: 'home' | 'sources') {
  win.location.search = search;
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container as any);
  await act(async () => root.render(what === 'home' ? <HomePage /> : <SourcesPage />));
  return {
    container,
    q: (selector: string) => container.querySelector(selector),
    all: (selector: string) => container.querySelectorAll(selector),
    unmount: () => act(async () => root.unmount()),
  };
}

describe('首页', () => {
  it('文字栏：网站的名字、一句话、内容里的每一张卡片、“来源”；可以点进去的是链接、写着“从第一站读起”，还没写的不是链接、标着“还没写”', { timeout: 30_000 }, async () => {
    expect(cards.length).toBeGreaterThanOrEqual(2);
    expect(open.length).toBeGreaterThanOrEqual(1);
    expect(cards.length - open.length, '内容里要有还没写的人物，这一项才查得到“点不了的卡片”').toBeGreaterThanOrEqual(1);
    const page = await mount('?stage=fake', 'home');
    await waitFor(() => page.all('.card').length > 0);
    // 版面是人物页的那一种：文字栏，后面跟着沙盘栏
    const layout = page.q('.home-layout')!;
    expect(layout.className).toBe('figure-layout home-layout');
    expect(layout.childNodes.map((node) => (node as MiniElement).className.split(' ')[0])).toEqual(['reading', 'stage-pane']);
    expect(page.q('.reading')!.localName).toBe('main');
    expect(page.q('h1.home-title')!.textContent).toBe(SITE_TITLE);
    expect(page.all('h1')).toHaveLength(1);
    expect(page.q('.home-line')!.textContent).toBe(SITE_LINE);
    expect((doc as any).title).toBe(SITE_TITLE);

    // 卡片：一张不多、一张不少，按时代先后
    const shown = page.all('.cards .card');
    expect(shown.map((card) => attr(card, 'data-figure-id'))).toEqual(cards.map((card) => card.id));
    for (const [i, card] of cards.entries()) {
      const el = shown[i];
      const where = `“${card.name}”的卡片`;
      expect(el.querySelector('.card-name')!.textContent, where).toBe(card.name);
      expect(el.querySelector('.card-era')!.textContent, where).toBe(`${card.era} · ${card.years}`);
      expect(el.querySelector('.card-tagline')!.textContent, where).toBe(card.tagline);
      if (card.available) {
        expect(el.localName, `${where}可以点进去`).toBe('a');
        expect(attr(el, 'href'), where).toBe(`#/${card.id}`);
        expect(el.querySelector('.card-go')!.textContent, where).toBe('从第一站读起');
        expect(el.querySelector('.tag'), where).toBeNull();
      } else {
        expect(el.localName, `${where}点不了`).toBe('div');
        expect(attr(el, 'href'), where).toBeNull();
        expect(el.querySelectorAll('a'), where).toHaveLength(0);
        expect(attr(el, 'tabindex'), where).toBeNull();
        expect(attr(el, 'role'), where).toBeNull();
        expect(el.querySelector('.tag')!.textContent, where).toBe('还没写');
        expect(el.querySelector('.card-go'), where).toBeNull();
      }
      // 卡片上只有这几样：名字、朝代和年份、一句话，加上“从第一站读起”或者“还没写”。没有记读者读过什么、读到哪的东西
      expect(el.textContent, `${where}上的字`).toBe(`${card.name}${card.era} · ${card.years}${card.available ? '' : '还没写'}${card.tagline}${card.available ? '从第一站读起' : ''}`);
      expect(el.querySelectorAll('progress'), where).toHaveLength(0);
      expect(el.querySelectorAll('meter'), where).toHaveLength(0);
    }
    // 黑体排的两句都在黑体的名单里（不在的话，黑体文件里没有这些字）
    expect(SANS_LABELS).toContain('从第一站读起');
    expect(SANS_LABELS).toContain(SITE_TITLE);

    // 卡片后面：通到“来源”页的链接
    expect(page.all('.reading .stop-nav a').map((link) => [link.textContent, attr(link, 'href')])).toEqual([['来源', '#/sources']]);
    await page.unmount();
  });

  it('旁边的沙盘栏就是人物页的那一栏：摆着第一位可以点进去的人物的全程沙盘，看的是头一节，印通到他的各站；没有全程沙盘时是一句话', { timeout: 30_000 }, async () => {
    const figure = figures[0];
    const route = readJson<RouteScene>(`content/figures/${figure.id}/scenes/route.json`);
    const page = await mount('?stage=fake', 'home');
    await waitFor(() => attr(page.q('.stage-pane'), 'data-stage-state') === 'ready');
    const pane = page.q('.stage-pane')!;
    expect(page.all('.stage-pane')).toHaveLength(1);
    expect(pane.localName).toBe('section');
    // 版面的元素上记着沙盘是哪位人物的（data-figure：人物自己的那一套记号照它单写一块），记在沙盘栏外面的那一层上，不在沙盘栏自己身上
    expect(attr(page.q('.figure-layout'), 'data-figure')).toBe(figure.id);
    expect(pane.hasAttribute('data-figure')).toBe(false);
    expect(attr(pane, 'data-stage-level')).toBe('route');
    expect(attr(pane, 'data-stage-section')).toBe(route.sections[0].heading);
    expect(attr(page.q('.stage-caption'), 'data-section')).toBe(route.sections[0].heading);
    expect(page.q('.stage-reset')!.textContent).toBe('回到全程');
    expect(page.all('.stage-host .strip').map((el) => attr(el, 'data-strip-id'))).toEqual(route.sections[0].strips);
    // 印通到这位人物的那一站
    const seals = page.all('.strip-seal');
    expect(new Set(seals.map((seal) => attr(seal, 'data-stop-id')))).toEqual(new Set(figure.stops.map((stop) => stop.id)));
    for (const seal of seals) expect(attr(seal, 'href')).toBe(stopHref(figure.id, attr(seal, 'data-stop-id')!));
    expect(page.q('.stage-still-line')).toBeNull();
    await page.unmount();

    // 当作这位人物还没有全程沙盘（?route=none）：一句话，没有沙盘
    const none = await mount('?stage=fake&route=none', 'home');
    await waitFor(() => none.q('.stage-still-line') !== null);
    expect(attr(none.q('.stage-pane'), 'data-stage-state')).toBe('still');
    expect(none.q('.fake-stage')).toBeNull();
    expect(none.q('.stage-still-line')!.textContent).toBe('全程沙盘还没接进来。');
    // 文字栏照常
    expect(none.all('.cards .card')).toHaveLength(cards.length);
    await none.unmount();
  });

  it('全程沙盘这一次没读出来：说“沙盘没能摆出来”，带“再试一次”，不说“还没接进来”；再试读出来了就摆上；文字栏照常', { timeout: 30_000 }, async () => {
    (globalThis as any).__routeFails = 1;
    const page = await mount('?stage=fake', 'home');
    await waitFor(() => attr(page.q('.stage-pane'), 'data-stage-state') === 'failed');
    expect(page.q('.stage-message p')!.textContent).toBe('沙盘没能摆出来，正文可以照常读。');
    expect(page.q('.stage-still-line')).toBeNull();
    expect(page.all('.cards .card')).toHaveLength(cards.length);
    expect(page.q('.stage-retry')!.textContent).toBe('再试一次');
    await act(async () => page.q('.stage-retry')!.click());
    await waitFor(() => attr(page.q('.stage-pane'), 'data-stage-state') === 'ready');
    expect(attr(page.q('.stage-pane'), 'data-stage-level')).toBe('route');
    expect(page.all('.strip-seal').length).toBeGreaterThan(0);
    await page.unmount();
  });
});

describe('“来源”页', () => {
  it('架子马上就有（位置那一行、标题），里面的东西取到了才换上；四栏：字体、地形和水、图片、程序', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake', 'sources');
    // 一上来：一栏字独自立着，没有沙盘栏；标题是“来源”，下面一句“加载中…”
    const main = page.q('main')!;
    expect(main.className).toBe('plain-page sources');
    expect(page.q('.stage-pane')).toBeNull();
    expect(page.all('.crumbs a').map((link) => [link.textContent, attr(link, 'href')])).toEqual([[SITE_TITLE, '#/']]);
    expect(page.q('h1.page-title')!.textContent).toBe('来源');
    expect((doc as any).title).toBe(`来源 · ${SITE_TITLE}`);
    expect(page.all('.sources-lead')).toHaveLength(0);
    expect(page.all('main .quiet').map((line) => line.textContent)).toEqual(['加载中…']);

    await waitFor(() => page.q('.sources-lead') !== null);
    expect(page.q('.sources-lead')!.textContent).toBe(SOURCES_TEXT.lead);
    const sections = page.all('main section');
    expect(sections.map((section) => attr(section, 'data-sources'))).toEqual(['fonts', 'land', 'pictures', 'program']);
    expect(sections.map((section) => section.querySelector('h2.section-heading')!.textContent)).toEqual(['字体', '地形和水', '图片', '程序']);
    // 标题和四个小标题用黑体排：都在黑体的名单里
    for (const heading of ['来源', '字体', '地形和水', '图片', '程序']) expect(SANS_LABELS, heading).toContain(heading);
    await waitFor(() => page.all('main .quiet').length === 0);
    await page.unmount();
  });

  it('字体：三套各一条（黑体、宋体、楷体），名字和版本就是 shipped.ts 里的；各有“许可全文”（网站自己带的文本文件）和“字体的网站”（通到外面的平常链接）', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake', 'sources');
    await waitFor(() => page.all('.sources-item').length > 0 && page.all('main .quiet').length === 0);
    const fonts = page.all('section').find((section) => attr(section, 'data-sources') === 'fonts')!;
    const items = fonts.querySelectorAll('.sources-item');
    expect(items.map((item) => attr(item, 'data-font'))).toEqual([SHIPPED_FONTS.sans.family, SHIPPED_FONTS.song.family, SHIPPED_FONTS.kai.family]);
    for (const [i, font] of [SHIPPED_FONTS.sans, SHIPPED_FONTS.song, SHIPPED_FONTS.kai].entries()) {
      const item = items[i];
      const said = item.querySelector('p')!.textContent!;
      expect(said, `${font.family} 那一条`).toContain(font.name);
      expect(said, `${font.family} 那一条`).toContain(`${font.version} 版`);
      expect(said, `${font.family} 那一条`).toContain('按 SIL 开放字体许可 1.1 版使用。');
      const links = item.querySelectorAll('.sources-links a');
      expect(links.map((link) => link.textContent)).toEqual(['许可全文（英文）', '字体的网站']);
      // 三套字体的链接写的字一样：给读屏软件的名字里带着是哪一套字体的，六个名字各不相同
      expect(links.map((link) => attr(link, 'aria-label'))).toEqual([`${font.name} 许可全文（英文）`, `${font.name} 字体的网站`]);
      // 许可全文：网站自己带着的文件，相对的地址，在这一页打开
      expect(attr(links[0], 'href')).toBe(font.licence);
      expect(attr(links[0], 'target')).toBeNull();
      expect(readBytes(`${LICENCES_DIR}/${font.licence.replace('licences/', '')}`).byteLength, `${font.licence} 在 public/licences/ 里`).toBeGreaterThan(1000);
      // 字体的网站：外面的地址，新开一页，不把这一页的地址带过去
      expect(attr(links[1], 'href')).toBe(font.site);
      expect(font.site).toMatch(/^https:\/\//);
      expect([attr(links[1], 'target'), attr(links[1], 'rel')]).toEqual(['_blank', 'noopener noreferrer']);
    }
    expect(items[0].querySelector('p')!.textContent).toBe(SOURCES_TEXT.sans(SHIPPED_FONTS.sans));
    expect(items[1].querySelector('p')!.textContent).toBe(SOURCES_TEXT.song(SHIPPED_FONTS.song));
    expect(items[2].querySelector('p')!.textContent).toBe(SOURCES_TEXT.kai(SHIPPED_FONTS.kai));
    // 六个给读屏软件的名字各不相同（黑体的名字里带着 Medium，和宋体的分得开）
    const labels = items.flatMap((item) => item.querySelectorAll('.sources-links a').map((link) => attr(link, 'aria-label')));
    expect(new Set(labels).size).toBe(6);
    // 末一句：文件里的名称改成了什么
    const last = fonts.childNodes[fonts.childNodes.length - 1] as MiniElement;
    expect(last.textContent).toBe(SOURCES_TEXT.subset(SHIPPED_FONTS.sans, SHIPPED_FONTS.song, SHIPPED_FONTS.kai));
    expect(last.textContent).toContain(`“${SHIPPED_FONTS.sans.family}”“${SHIPPED_FONTS.song.family}”“${SHIPPED_FONTS.kai.family}”`);
    await page.unmount();
  });

  it('地形和水：每位可以点进去的人物的全程沙盘（只印署名的半句）、他每一站的沙盘写的每一行都在，说过的只印一遍；图片：每一站正文里的每一张都在', { timeout: 30_000 }, async () => {
    // 要有的每一行，从文件里读
    const lines: string[] = [];
    const pictures: { stop: string; picture: StopExtras['images'][number] }[] = [];
    let sceneFiles = 0;
    for (const figure of figures) {
      // 全程沙盘的出处排在最前面，只印头一个分号前面署名的半句（后半句说的“上面的说明”在这一页上没有）
      const routeFile = `content/figures/${figure.id}/scenes/route.json`;
      const scenes = jsonIn(`content/figures/${figure.id}/scenes`);
      expect(scenes, figure.id).toContain(routeFile);
      for (const line of readJson<RouteScene>(routeFile).credits) {
        expect(line, '全程沙盘的出处要有分号后面的半句，这一项才查得到“只印前半句”').toContain('；');
        lines.push(`${line.split('；')[0]}。`);
      }
      // 各站的沙盘照这位人物走的先后排（页面是照 figure.stops 一站一站取的），不照文件名：有了第二座沙盘（黄州）才分得出来
      const stopFiles = figure.stops.map((stop) => `content/figures/${figure.id}/scenes/${stop.id}.json`).filter((path) => scenes.includes(path));
      expect(stopFiles.length, '每个站点沙盘的文件名都是一站的 id').toBe(scenes.length - 1);
      for (const path of stopFiles) {
        sceneFiles++;
        lines.push(...readJson<StopScene>(path).credits);
      }
      for (const stop of figure.stops) {
        if (stop.status === 'complete') pictures.push(...readJson<StopExtras>(`content/figures/${figure.id}/stops/${stop.id}.json`).images.map((picture) => ({ stop: stop.shortTitle, picture })));
      }
    }
    // 说过的不再印：一模一样的一行，和“分号前面的半句，前面哪一行就是这样开头的”的一行（同一份数据在沙盘的凭据里又署了一遍）
    const wanted: string[] = [];
    for (const line of lines) if (!wanted.some((seen) => seen.startsWith(line.split('；')[0]))) wanted.push(line);
    // 现在的内容里正有这样的一行（徐州的沙盘和全程沙盘用的是同一份地形）：页面上少了它，可它署的名一个字不少地在前面那一行里
    const dropped = lines.filter((line) => !wanted.includes(line));
    expect(dropped.length, '内容里要有一行说过的出处，这一项才查得到东西').toBeGreaterThan(0);
    for (const line of dropped) expect(wanted.some((seen) => seen.startsWith(line.split('；')[0])), line).toBe(true);
    expect(sceneFiles, 'content/ 里要有沙盘，这一项才查得到东西').toBeGreaterThan(0);
    expect(lines.length).toBeGreaterThan(sceneFiles);
    expect(pictures.length, 'content/ 里要有图片，这一项才查得到东西').toBeGreaterThan(0);

    const page = await mount('?stage=fake', 'sources');
    await waitFor(() => page.all('.sources-list').length > 0 && page.all('main .quiet').length === 0);
    const section = (name: string) => page.all('section').find((one) => attr(one, 'data-sources') === name)!;
    const land = section('land').querySelectorAll('.sources-list li').map((li) => li.textContent);
    expect(land).toEqual(wanted);
    // “见上面的说明”是说给凭据里的读者听的，这一页上没有那段说明：这半句不该印出来
    for (const line of land) expect(line, '“来源”页上指不到东西的半句').not.toContain('见上面的说明');

    const shown = section('pictures').querySelectorAll('.sources-list li');
    expect(shown).toHaveLength(pictures.length);
    for (const [i, { stop, picture }] of pictures.entries()) {
      const li = shown[i];
      const paragraphs = li.querySelectorAll('p');
      // 头一句先说是哪一站的图片，后面是它的题记
      expect(stop.length).toBeGreaterThan(0);
      expect(paragraphs[0].textContent).toBe(`${stop}：${picture.caption}`);
      expect(paragraphs[1].textContent).toBe(`${picture.credit} · ${picture.license}`);
      const links = li.querySelectorAll('.sources-links a');
      expect(links.map((link) => [link.textContent, attr(link, 'href'), attr(link, 'target'), attr(link, 'rel')])).toEqual([['图片出处', picture.sourceUrl, '_blank', 'noopener noreferrer']]);
    }
    await page.unmount();
  });

  it('说过的出处只印一遍，先后不变：一模一样的一行，和分号前面的半句前面已经有一行这样开头的（拿编出来的几行查）', async () => {
    // 到这里才引入那一段程序：文件开头就引入的话，上面“架子马上就有”那一项就看不到“加载中…”的那一下了
    const { uniqueLines } = await import('../../../src/ui/SourcesBody');
    expect(uniqueLines(['甲', '乙', '甲', '丙', '乙'])).toEqual(['甲', '乙', '丙']);
    expect(uniqueLines([])).toEqual([]);
    // 分号前面的半句，前面留下的一行就是这样开头的：不再印（后半句是说给凭据里的读者听的）
    expect(uniqueLines(['地形：甲。海岸：丁。', '地形：甲；乙见上面。', '河道：丙；戊。'])).toEqual(['地形：甲。海岸：丁。', '河道：丙；戊。']);
    // 差一个字的不算说过；开头一样、署的名不一样的也不算（分号前面的半句要整个对得上前面那一行的开头）
    expect(uniqueLines(['地形：甲。', '地形：乙。'])).toEqual(['地形：甲。', '地形：乙。']);
    expect(uniqueLines(['地形：甲。', '地形：甲和乙；丙。'])).toEqual(['地形：甲。', '地形：甲和乙；丙。']);
    // 只看前面留下的行：带着后半句的排在前头，它就留着
    expect(uniqueLines(['地形：甲；乙。', '地形：甲。海岸：丁。'])).toEqual(['地形：甲；乙。', '地形：甲。海岸：丁。']);
  });

  it('程序：两个程序库的许可全文，就是 public/licences/ 里工具抄来的那两个文件；最后一句说打开网页时不访问别的网站', { timeout: 30_000 }, async () => {
    const page = await mount('?stage=fake', 'sources');
    await waitFor(() => page.q('.sources-lead') !== null);
    const program = page.all('section').find((section) => attr(section, 'data-sources') === 'program')!;
    const links = program.querySelectorAll('.sources-links a');
    expect(links.map((link) => [link.textContent, attr(link, 'href'), attr(link, 'target')])).toEqual([
      ['React 的许可全文（英文）', LIBRARY_LICENCES.react, null],
      ['three.js 的许可全文（英文）', LIBRARY_LICENCES.three, null],
    ]);
    // 页面写的两个地址，正好是做字体的工具抄进 public/licences/ 的那两个文件
    expect(Object.values(LIBRARY_LICENCES).sort()).toEqual(LIBRARY_LICENCE_FILES.map((item) => `licences/${item.file}`).sort());
    for (const href of Object.values(LIBRARY_LICENCES)) expect(utf8.decode(readBytes(`public/${href}`)), href).toMatch(/MIT License/);
    expect((program.childNodes[program.childNodes.length - 1] as MiniElement).textContent).toBe(SOURCES_TEXT.shipped);
    // 这一页上所有的链接：站内的五份许可全文和回首页的一个，别的都是新开一页的外面的地址
    const all = page.all('main a').map((link) => ({ href: attr(link, 'href') ?? '', target: attr(link, 'target') }));
    const inside = all.filter((link) => link.target === null).map((link) => link.href);
    expect(inside.sort()).toEqual(['#/', SHIPPED_FONTS.sans.licence, SHIPPED_FONTS.song.licence, SHIPPED_FONTS.kai.licence, LIBRARY_LICENCES.react, LIBRARY_LICENCES.three].sort());
    for (const link of all.filter((one) => one.target !== null)) expect(link.href, '新开一页的链接是外面的地址').toMatch(/^https:\/\//);
    await page.unmount();
  });
});

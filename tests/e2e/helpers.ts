// 端到端测试共用的小工具。测试只看结构和行为，不看正文的字句（内容还在改）。
// 沙盘用的是替身（?stage=fake）。哪一站有沙盘、每一小节该摆哪几条题签，直接从 content/ 里的场景文件读出来比对。
// 用真沙盘的几项（real-table、real-shots、zoom-shots）的地址由 realUrl 给：都指定画质，慢机器上跑出来也是同一个结果。

import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { RouteScene, SceneStrip, StopScene } from '../../src/domain/scene';
import type { StageReadout, StageTier } from '../../src/stage/types';
import { fileSize, readBytes } from '../support/readBytes';

/** 带沙盘替身的地址。extra 是另外要带的参数，如 "&route=none"。 */
export function fakeUrl(hash: string, extra = ''): string {
  return `/?stage=fake${extra}${hash}`;
}

/**
 * 真沙盘的地址（不带 ?stage=fake）。tier 是指定的画质，不写就是完整的一档：
 * 指定了画质，沙盘程序就照它摆，不量快慢，也不自己换档——开发机和发布流程的机器都没有显卡，
 * 让它自己挑的话，同一项测试这一次是完整的、下一次是减配的，照片也不知道是哪一档拍的。
 * tier 写 null 是不指定，只有“让它自己挑”的那一项测试这样用。
 * extra 是另外要带的参数，如 "&debug=1"；path 是哪个页面，不写就是网站自己。
 */
export function realUrl(hash: string, tier: StageTier | null = 'full', extra = '', path = '/'): string {
  const query = [tier ? `tier=${tier}` : '', extra.replace(/^[&?]/, '')].filter((part) => part !== '').join('&');
  return `${path}${query === '' ? '' : `?${query}`}${hash}`;
}

export function stagePane(page: Page): Locator {
  return page.locator('.stage-pane');
}

/** 沙盘的替身（写着它收到的指令）。 */
export function fakeStage(page: Page): Locator {
  return page.locator('.fake-stage');
}

/** 等沙盘摆好，并且摆着指定的那一小节。 */
export async function expectStageAt(page: Page, section: string): Promise<void> {
  await expect(stagePane(page)).toHaveAttribute('data-stage-state', 'ready');
  await expect(stagePane(page)).toHaveAttribute('data-stage-section', section);
}

/**
 * 等立体的沙盘摆好，并且是指定的那一档画质：沙盘栏上现在放着的是立体的沙盘（不是顶替它的图片），画质是 tier。
 * 真沙盘拍照之前都要过这一关：不然减配的一档、或者一张图片拍出来的照片，会被当成完整的沙盘。
 */
export async function expectRealTable(page: Page, tier: StageTier, timeout?: number): Promise<void> {
  const pane = stagePane(page);
  await expect(pane).toHaveAttribute('data-stage-state', 'ready', timeout === undefined ? undefined : { timeout });
  await expect(pane).toHaveAttribute('data-stage-picture', 'table');
  await expect(pane).toHaveAttribute('data-stage-tier', tier);
}

/** 页面上挂着的沙盘读数（地址里带 ?debug=1 时才有）；没有是 null。 */
export async function stageReadout(page: Page): Promise<StageReadout | null> {
  return page.evaluate(() => (window as Window & { __stageReadout?: () => StageReadout }).__stageReadout?.() ?? null);
}

/**
 * 等随站的字体都到了、页面也照着排好了。字体文件比页面晚到一步的那一会儿，字是设备自带的字体顶着的
 *（样式里写的是 font-display: swap）：这时候拍的照片、量的字宽，都不是读者平常看到的样子。
 * 页面上新出来的字要是用到了还没取的那个字体文件（点开小注、原文、凭据），浏览器这时才去取，所以多等几轮，
 * 到“没有正在取的字体”为止。
 */
export async function fontsReady(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let i = 0; i < 5; i++) {
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (document.fonts.status === 'loaded') return;
    }
  });
}

/**
 * 点开才去取的东西都到了。“凭据”里面的东西、讲解员面板里面的东西是另外两段程序，读者点开了才下载（src/ui/Provenance.tsx、
 * GuidePanel.tsx）：一点就开，里面先是一句“加载中…”，取到了才换成内容。点开了这两样的测试，先等这一步，再看、再量、再拍里面的东西。
 * 等的是：点开着的凭据里、开着的面板里，那一句等着的话不在了（折着的凭据里那一句一直在，不算）。
 */
export async function foldBodiesReady(page: Page): Promise<void> {
  await expect(page.locator('details.provenance[open] .provenance-body > .quiet, .guide-panel > .quiet')).toHaveCount(0);
}

/** 拍一张照：先等字体到齐（见 fontsReady），再拍。给人看的照片都从这里拍。 */
export async function shoot(page: Page, options: Parameters<Page['screenshot']>[0]): Promise<void> {
  await fontsReady(page);
  await page.screenshot(options);
}

/** 等页面画过两帧（沙盘是有变化才画的，约好的一帧画完，指北和比例尺也就跟着改了）。 */
export async function twoFrames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/**
 * 从首页进第一位可以打开的人物，找到他第一个有沙盘的站。url 是首页的地址（带着要用的参数）。
 * 没有人物卡片时抛出错误；还没有哪一站有沙盘时 found 是 null。
 */
export async function openFigureWithTable(page: Page, url: string): Promise<{ figureId: string; found: { stopId: string; scene: StopScene } | null }> {
  await page.goto(url);
  const card = page.locator('a.card[data-available="true"]').first();
  await expect(card).toBeVisible();
  const figureId = await card.getAttribute('data-figure-id');
  if (!figureId) throw new Error('人物卡片上没有 id');
  await card.click();
  await expect(page.locator('.stop-item').first()).toBeVisible();
  return { figureId, found: await firstStopWithScene(page, figureId) };
}

/**
 * 等沙盘栏定下来，摆的不是哪一站自己的沙盘：摆好了全程沙盘（人物页、首页、没有自己的沙盘的站），
 * 或者说了那一句“全程沙盘还没接进来”。返回摆的是不是全程沙盘。
 */
export async function expectRoute(page: Page): Promise<boolean> {
  const pane = stagePane(page);
  const now = async (): Promise<string> => `${await pane.getAttribute('data-stage-state')} ${await pane.getAttribute('data-stage-level')}`;
  await expect.poll(now, { message: '沙盘栏里该摆好全程沙盘，或者说一句“还没接进来”' }).toMatch(/^(ready route|still null)$/);
  return (await now()) === 'ready route';
}

/** content/ 里这位人物的全程沙盘的场景；没有是 null。 */
export function routeOnDisk(figureId: string): RouteScene | null {
  const scene = sceneOnDisk(figureId, 'route') as StopScene | RouteScene | null;
  return scene && scene.level === 'route' ? scene : null;
}

/** 全程沙盘上到这一站去的那一节叫什么；没有这一节是 null。 */
export function roadOf(route: RouteScene, stopId: string): string | null {
  return route.sections.find((section) => section.stop === stopId)?.heading ?? null;
}

/** 从首页进入第一位可以打开的人物，返回他的 id。 */
export async function openFirstFigure(page: Page): Promise<string> {
  await page.goto(fakeUrl('#/'));
  const card = page.locator('a.card[data-available="true"]').first();
  await expect(card).toBeVisible();
  const figureId = await card.getAttribute('data-figure-id');
  if (!figureId) throw new Error('人物卡片上没有 id');
  await card.click();
  await expect(page).toHaveURL(new RegExp(`#/${figureId}$`));
  // 等目录出来，后面数目录项时才数得准。
  await expect(page.locator('.stop-item').first()).toBeVisible();
  return figureId;
}

/** 目录里第一个已经写好的站的 id。 */
export async function firstWrittenStop(page: Page): Promise<string> {
  const item = page.locator('.stop-item[data-stop-status="complete"]').first();
  await expect(item).toBeVisible();
  const stopId = await item.getAttribute('data-stop-id');
  if (!stopId) throw new Error('目录项上没有站的 id');
  return stopId;
}

/** content/ 里这一站的场景文件；这一站还没有沙盘时是 null。 */
export function sceneOnDisk(figureId: string, stopId: string): StopScene | null {
  const path = `content/figures/${figureId}/scenes/${stopId}.json`;
  try {
    fileSize(path);
  } catch {
    return null;
  }
  return JSON.parse(new TextDecoder().decode(readBytes(path))) as StopScene;
}

/** 目录里写好了的各站的 id，按先后。要先打开人物页。 */
async function writtenStops(page: Page): Promise<string[]> {
  const ids = await page.locator('.stop-item[data-stop-status="complete"]').evaluateAll((items) => items.map((item) => item.getAttribute('data-stop-id')));
  return ids.filter((id): id is string => id !== null);
}

/** 目录里第一个有沙盘的站和它的场景；一个都没有时是 null。要先打开人物页。 */
export async function firstStopWithScene(page: Page, figureId: string): Promise<{ stopId: string; scene: StopScene } | null> {
  for (const stopId of await writtenStops(page)) {
    const scene = sceneOnDisk(figureId, stopId);
    if (scene) return { stopId, scene };
  }
  return null;
}

/** 目录里第一个写好了正文、却还没有沙盘的站；没有时是 null。要先打开人物页。 */
export async function firstWrittenStopWithoutScene(page: Page, figureId: string): Promise<string | null> {
  for (const stopId of await writtenStops(page)) {
    if (!sceneOnDisk(figureId, stopId)) return stopId;
  }
  return null;
}

/** 场景里各小节的标题，按先后。 */
export function headingsOf(scene: StopScene): string[] {
  return scene.sections.map((section) => section.heading);
}

/** 这一小节该摆的题签，按要紧的先后。 */
export function stripsOf(scene: StopScene, heading: string): SceneStrip[] {
  const section = scene.sections.find((item) => item.heading === heading);
  if (!section) throw new Error(`场景里没有这一小节：${heading}`);
  return section.strips.map((id) => {
    const strip = scene.strips.find((item) => item.id === id);
    if (!strip) throw new Error(`场景里没有这条题签：${id}`);
    return strip;
  });
}

/** 一条题签在“古名”“今名”两种叫法下写什么字：没有今天的名字时，两种都写当时的名字。 */
export function stripText(strip: SceneStrip, names: 'ancient' | 'modern'): string {
  return names === 'modern' && strip.modern ? strip.modern : strip.text;
}

/** 沙盘上现在挂着的题签：id 和字，按挂的先后（不管这一条眼下摆没摆出来）。 */
export async function stripsOnStage(page: Page): Promise<{ id: string; text: string }[]> {
  return page.locator('.stage-host .strip').evaluateAll((strips) => strips.map((strip) => ({ id: strip.getAttribute('data-strip-id') ?? '', text: strip.textContent ?? '' })));
}

/**
 * 把正文的某一小节滚到“正在读”的位置：标题在阅读线上面 above 像素。
 * 阅读线怎么算见 src/ui/useReadingSection.ts：看得见正文的那一块里从上往下 42%，窄屏上从沙盘栏的下边算起；
 * 页面快到底时，线跟着往下挪到底边（所以最后几节也滚得到）。这里照同一个算法算出该滚到哪。
 * 只在沙盘栏不跟着页面滚走的时候用（宽屏，或者窄屏上摆着沙盘）。
 */
export async function scrollToSection(page: Page, heading: string, above = 40): Promise<void> {
  await scrollThrough(page, [heading], above);
}

/**
 * 一口气滚过几个小节，停在最后一个上：前面的每一个都只在“正在读”的位置上待两帧（三十来毫秒），
 * 远不到“连着当上 150 毫秒才算读到”的数。整个过程在页面里一次做完，不受测试程序一来一回快慢的影响。
 * startOnceRequested：在第一个小节上不是只待两帧，而是等到沙盘的替身收到去那一节的指令（镜头刚起步），再接着往下滚。
 */
export async function scrollThrough(page: Page, headings: string[], above = 40, startOnceRequested = false): Promise<void> {
  await page.evaluate(
    async ({ headings, above, startOnceRequested }) => {
      const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const lastRequest = () => (document.querySelector('.fake-stage')?.getAttribute('data-fake-requests') ?? '').split('|').pop();
      for (const [i, heading] of headings.entries()) {
        if (i === 1 && startOnceRequested) {
          const giveUpAt = Date.now() + 5000;
          while (lastRequest() !== headings[0]) {
            if (Date.now() > giveUpAt) throw new Error(`等了 5 秒，沙盘没有收到去“${headings[0]}”的指令`);
            await frame();
          }
        } else if (i > 0) {
          await frame();
          await frame();
        }
        const target = Array.from(document.querySelectorAll<HTMLElement>('.text-section[data-section]')).find((el) => el.dataset.section === heading);
        const pane = document.querySelector('.stage-pane');
        const text = document.querySelector('.stop-page');
        if (!target || !pane || !text) throw new Error(`页面上找不到这一小节：${heading}`);
        const paneBox = pane.getBoundingClientRect();
        const textBox = text.getBoundingClientRect();
        const paneAbove = paneBox.left < textBox.right && paneBox.right > textBox.left;
        const height = window.innerHeight;
        const textTop = paneAbove ? Math.max(0, Math.min(paneBox.bottom, height)) : 0;
        const line = textTop + (height - textTop) * 0.42;
        const maxScroll = document.documentElement.scrollHeight - height;
        // 标题在整页里的位置。
        const at = target.getBoundingClientRect().top + window.scrollY;
        // 线还在 42% 的地方时，滚到这里正好；要是这里已经是页面的最后一截，线挪了，另算。
        let to = at - line + above;
        if (to > maxScroll - (height - line)) to = (at - height + maxScroll + above) / 2;
        window.scrollTo(0, Math.max(0, Math.min(maxScroll, to)));
      }
    },
    { headings, above, startOnceRequested },
  );
}

/** 替身收到过的每一次 showSection 要去哪一小节，按先后。 */
export async function fakeRequests(page: Page): Promise<string[]> {
  return ((await fakeStage(page).getAttribute('data-fake-requests')) ?? '').split('|').filter(Boolean);
}

/** 沙盘栏一路上的样子（见 watchPane）。 */
export interface PaneMoment {
  /** 沙盘栏说自己摆着哪一节。 */
  pane: string | null;
  /** 题记是哪一节的。 */
  caption: string | null;
  /** 替身实际摆着哪一节。 */
  fake: string | null;
  /** 替身这时候收到过哪些 showSection。 */
  requests: string;
}

/**
 * 从现在起，沙盘栏里每变一下就记一笔：沙盘栏说自己摆着哪一节、题记是哪一节的、替身实际摆着哪一节。
 * 记在页面里，变的那一刻当场记，所以“镜头还在路上的时候沙盘栏说的是什么”不会漏掉。用 paneMoments 取回来。
 */
export async function watchPane(page: Page): Promise<void> {
  await page.evaluate(() => {
    const pane = document.querySelector('.stage-pane');
    if (!pane) throw new Error('页面上没有沙盘栏');
    const seen: PaneMoment[] = [];
    const read = () => {
      const fake = pane.querySelector('.fake-stage');
      seen.push({
        pane: pane.getAttribute('data-stage-section'),
        caption: pane.querySelector('.stage-caption')?.getAttribute('data-section') ?? null,
        fake: fake?.getAttribute('data-fake-section') ?? null,
        requests: fake?.getAttribute('data-fake-requests') ?? '',
      });
    };
    read();
    const target = window as Window & { __paneSeen?: PaneMoment[]; __paneWatch?: MutationObserver };
    target.__paneWatch?.disconnect();
    target.__paneSeen = seen;
    target.__paneWatch = new MutationObserver(read);
    target.__paneWatch.observe(pane, { attributes: true, childList: true, subtree: true });
  });
}

/** watchPane 以来记下的每一笔。 */
export async function paneMoments(page: Page): Promise<PaneMoment[]> {
  return page.evaluate(() => (window as Window & { __paneSeen?: PaneMoment[] }).__paneSeen ?? []);
}

/** 滚到页面的最底下。 */
export async function scrollToBottom(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
}

// 在浏览器里查随站的字体，几份测试共用的东西（tests/e2e/fonts.spec.ts、font-scopes.spec.ts；goethe-route.spec.ts 照它认字体文件）：
// 照记录（src/fonts/fonts.json）说“这一种页面拿哪几个字体文件”；认出一个请求要的是哪个字体文件；记下、压住字体文件的请求；
// 问浏览器页面上显出来的每一段字各是哪个字体画的（Chromium 自己的调试接口 CSS.getPlatformFontsForNode）。

import { expect } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';
import { readBytes } from '../support/readBytes';
import { fontsReady } from './helpers';

/** 记录里的一个字体文件，和一种页面的那一项（只取这里用得着的几样）。 */
export interface RecordedFont {
  /** 在 src/fonts/ 里的路径：yanlu-song.woff2，scopes/yanlu-song-su-shi.woff2。 */
  file: string;
  face: string;
  family: string;
  postscript: string;
  source: 'sans' | 'song' | 'kai';
  scope: string;
  unit: string | null;
  role: 'rest' | 'pressed';
  bytes: number;
  characters: string;
}
export interface RecordedPage {
  kind: 'frame' | 'home' | 'figure' | 'unit' | 'sources';
  figure: string | null;
  unit: string | null;
  rest: string[];
  pressed: string[];
  bytes: number;
}
export interface FontRecord {
  home: string | null;
  joiners: string;
  pages: RecordedPage[];
  files: RecordedFont[];
}

/** 放进仓库的字体的记录（做字体的工具写的，格式 4）。 */
export const FONT_RECORD = JSON.parse(new TextDecoder().decode(readBytes('src/fonts/fonts.json'))) as FontRecord;

/** 一个字体文件不带文件夹、不带 .woff2 的名字：scopes/yanlu-song-su-shi.woff2 → yanlu-song-su-shi。 */
export const plainName = (file: string): string => file.replace(/^.*\//, '').replace(/\.woff2$/, '');
const KNOWN = FONT_RECORD.files.map((item) => plainName(item.file)).sort((a, b) => b.length - a.length);

/**
 * 一个请求要的是哪个字体文件（构建以后文件名里多了一串八个字符，照名字认：先试长的名字）；不是字体文件是 null。
 * 记录里没有的 .woff2 原样给出它的文件名——谁要是取了一个不认识的字体文件，查的地方会看见。
 */
export function fontFileOf(url: string): string | null {
  const name = new URL(url).pathname.split('/').pop() ?? '';
  if (!name.endsWith('.woff2')) return null;
  return KNOWN.find((known) => name === `${known}.woff2` || (name.startsWith(`${known}-`) && /^[\w-]{8}\.woff2$/.test(name.slice(known.length + 1)))) ?? name;
}

/** 记录里的一个文件（照不带文件夹的名字找）。 */
export function recorded(name: string): RecordedFont {
  const found = FONT_RECORD.files.find((item) => plainName(item.file) === name);
  if (!found) throw new Error(`记录里没有 ${name} 这个字体文件`);
  return found;
}

/**
 * 一个地址（#/…）是哪一种页面，照记录它拿哪几个字体文件（名字不带文件夹、不带 .woff2）：
 *   rest     不用点开就要的：框架的两个，这一页自己那个范围的黑体、（题签用楷体的人物的）楷体、宋体；
 *   pressed  点开以后才会取的。
 * 首页是沙盘栏里摆着的那位人物的；一站没有自己的文件，用的是人物的；内容里没有的人物（还有 #/sources/…）只有框架的两个。
 * 人物在内容里、站不在（#/人物/没有这一站）：那一页摆着他的全程沙盘，用的是人物的。
 */
export function pageFiles(hash: string): { rest: string[]; pressed: string[]; page: RecordedPage } {
  const parts = hash
    .replace(/^#/, '')
    .split('/')
    .filter((part) => part !== '');
  const pages = FONT_RECORD.pages;
  const frame = pages.find((page) => page.kind === 'frame');
  if (!frame) throw new Error('记录里没有“只有框架的字的页面”那一项');
  let page: RecordedPage | undefined;
  if (parts.length === 0) page = pages.find((item) => item.kind === 'home');
  else if (parts[0] === 'sources') page = parts.length === 1 ? pages.find((item) => item.kind === 'sources') : frame;
  else page = (parts.length > 1 ? pages.find((item) => item.kind === 'unit' && item.figure === parts[0] && item.unit === parts[1]) : undefined) ?? pages.find((item) => item.kind === 'figure' && item.figure === parts[0]);
  const found = page ?? frame;
  return { rest: found.rest.map(plainName), pressed: found.pressed.map(plainName), page: found };
}

/** 一种页面拿到的文件里，自己那个范围的（框架的两个不算）。 */
export const ownOf = (names: readonly string[]): string[] => names.filter((name) => recorded(name).scope !== 'frame');

/** 记下每一个字体文件被请求的时刻（从记录开始算起的毫秒）。now() 是这时候的同一种读数；names() 是照请求的先后要了哪几个。 */
export function watchFonts(page: Page): { of: (file: string) => number[]; all: () => string[]; names: () => string[]; now: () => number } {
  const started = Date.now();
  const seen: { name: string; at: number }[] = [];
  page.on('request', (request) => {
    const name = fontFileOf(request.url());
    if (name) seen.push({ name, at: Date.now() - started });
  });
  return { of: (file) => seen.filter((item) => item.name === file).map((item) => item.at), all: () => seen.map((item) => `${item.name}@${item.at}`), names: () => seen.map((item) => item.name), now: () => Date.now() - started };
}

/**
 * 压住几个字体文件不给，直到叫 release() 才放行（不按时间放：机器慢的时候，定死的几秒可能在查之前就过去了）。
 * which 说压哪几个（给名字的表，或者给一个函数）。held() 是现在压着的是哪几个（照来要的先后）。
 */
export async function holdFonts(page: Page, which: readonly string[] | ((name: string) => boolean)): Promise<{ release: () => void; held: () => string[] }> {
  const wanted = typeof which === 'function' ? which : (name: string): boolean => which.includes(name);
  let open: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const held: string[] = [];
  await page.route(
    (url) => {
      const name = fontFileOf(url.href);
      return name !== null && wanted(name);
    },
    async (route) => {
      held.push(fontFileOf(route.request().url()) ?? '');
      await gate;
      await route.continue().catch(() => {});
    },
  );
  return { release: open, held: () => [...held] };
}

/** 页面上显出来的一段字：在哪个元素里，开头是什么，那个元素的样式算出来的字体、粗细、正斜。 */
export interface Run {
  where: string;
  text: string;
  family: string;
  weight: string;
  style: string;
  /** 是不是在题签上（.strip 里面；题签脚上的印也算）。 */
  onStrip: boolean;
}

/** 浏览器说的：一段字用了哪个字体、画了几个字形。 */
export interface UsedFont {
  familyName: string;
  postScriptName: string;
  isCustomFont: boolean;
  glyphCount: number;
}

/** 接上 Chromium 的调试接口。 */
export async function debugger_(page: Page): Promise<CDPSession> {
  const client = await page.context().newCDPSession(page);
  await client.send('DOM.enable');
  await client.send('CSS.enable');
  await client.send('Runtime.enable');
  return client;
}

/**
 * 找出页面上显出来的每一段字（文字节点），按在页面里的先后，记在 window.__fontRuns 里，给出每一段的说明。
 * within 是只看哪些元素里面的（不写是整页）。不算：沙盘和定格图的替身；没显出来的（折着的原文和凭据里面的、
 * display: none 的）；只有空白的。（正文那一栏等字体的那一小会儿只是透明，照样算显出来了。）
 */
export async function markRuns(page: Page, within: string | null): Promise<Run[]> {
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
export async function fontsOfRuns(page: Page, client: CDPSession, within: string | null = null, settle = true): Promise<{ run: Run; fonts: UsedFont[] }[]> {
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

/** 工具写进字体文件里的三个名字（哪个范围的文件里都是这三个之一）。 */
export const KAI = 'Yanlu Kai';
export const SONG = 'Yanlu Song';
export const SANS = 'Yanlu Sans';

/**
 * 浏览器报的这个字体是不是随站的那一套。名字照工具写进文件里的认：family 是 Yanlu Kai / Yanlu Song / Yanlu Sans，
 * 或者 PostScript 名字是记录里这一套的哪个文件的（YanluSong-Regular、YanluSongSuShiXuzhou-Regular……）。
 * 两样认一样就算：调试接口只说名字是“系统报上来的”，Windows 上两样都是我们写的名字，别的系统上哪一样靠得住没有试过。
 */
export function isShipped(font: UsedFont, family: string): boolean {
  const source = family === KAI ? 'kai' : family === SANS ? 'sans' : 'song';
  return font.isCustomFont && (font.familyName === family || FONT_RECORD.files.some((item) => item.source === source && item.postscript === font.postScriptName));
}

/**
 * 浏览器报的这个字体是记录里的哪个文件（照 PostScript 名字认：每个文件的各不相同）；认不出来是 null
 *（设备自带的字体，或者这个系统不报我们写的 PostScript 名字）。
 */
export function fileOfFont(font: UsedFont): string | null {
  const found = font.isCustomFont ? FONT_RECORD.files.find((item) => item.postscript === font.postScriptName) : undefined;
  return found ? plainName(found.file) : null;
}

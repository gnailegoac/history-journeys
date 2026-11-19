// 拍定格图的工具：npm run stills（= playwright test -c playwright.stills.config.ts）。会打开一个浏览器。
// 给 content/ 里每一座站点沙盘的每一小节拍两张图（宽的、窄的），用的是完整的画质，图上不带字。
//
// 存到哪：平时是 tests/shots/stills-trial/（不进仓库，试拍用）；要放进仓库时设环境变量 STILLS_OUT=content/figures。
// 存成 <STILLS_OUT>/<人物>/stills/<站>-<第几节>-wide.jpg、…-narrow.jpg 和清单 <站>.json。
// 另外在 tests/shots/stills/<人物>-<站>.html 留一页给人看的（不进仓库），这一次画面变了的有标记。
//
// 一座沙盘怎么拍：
//   1 到真的页面上量版面：带着沙盘的替身打开这一站，在 1440 × 900 和 768 × 1024（竖着拿的平板）两种窗口上各量一次
//     沙盘的容器多大、四边留多少、沙盘栏的底色。版面的数一个也不写在这里。
//   2 每种形状开一个窗口：宽 = 沙盘栏的宽 + 左右各多拍的一截，高 = 沙盘栏的高，像素比照这种形状的；
//     打开沙盘测试页（stage-dev.html，只留沙盘、指定完整的画质、底色和四边留的空）。
//   3 一节一节直接摆到位，等两帧，读沙盘的读数（镜头、题签指着的点），截图。
//   4 截图都拍完、拍照的窗口都关了以后，才压成 JPEG、写文件（开发服务看见 content/ 里添了文件会重新加载页面，
//     所以不能边拍边写）。质量从高往低试，取第一个不超过 300 KB 的。
//   5 画面变没变只看截图的像素：和清单里记的一模一样、文件也还在，就不动那个文件；别的情形一律重写、算“变了”。
//   6 写清单，删掉这一站清单里不再有的图，写给人看的那一页。
//
// 不靠浏览器的部分（记号、清单的一项怎么做、变没变、检查）在 tests/support/stillsTool.ts，Node 里的测试查着。

import { expect, test } from '@playwright/test';
import type { Browser, Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { contentKey } from '../../src/domain/contentKey';
import type { StopScene } from '../../src/domain/scene';
import { stripTexts } from '../../src/domain/sceneText';
import type { StillManifest, StillShape, StillShapeSpec, StillShot } from '../../src/domain/stills';
import type { StageReadout, StageShot } from '../../src/stage/types';
import { decodePng } from '../support/png';
import {
  SHAPE_PLANS,
  SHOT_CAMERA,
  STILL_MAX_BYTES,
  checkShot,
  fileExists,
  flatColour,
  keepStill,
  keepWithin,
  madeFromNow,
  manifestText,
  pixelSum,
  programVersions,
  rawKey,
  readFile,
  readPaneLayout,
  relativePath,
  reviewPage,
  reviewWord,
  sameLayout,
  shapeSpec,
  shotInsets,
  shotViewport,
  stillFile,
  stillFromShot,
  worstTileOf,
  type PaneLayout,
  type RawPicture,
  type ReviewEntry,
} from '../support/stillsTool';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
/** 存到哪。相对项目的根目录（也可以写完整的路径）。 */
const OUT = (env.STILLS_OUT ?? 'tests/shots/stills-trial').replace(/\\/g, '/').replace(/\/+$/, '');
/** 给人看的那一页放在哪。 */
const REVIEW_DIR = 'tests/shots/stills';

/**
 * 备用的办法的开关，平时是 null：画面变没变只看截图的像素，差一个像素也算变了。
 * 这台机器要是连着拍两遍、没改过任何东西的画面像素都不一样（第二遍 npm run stills 还在重写图片），
 * 把它改成 1.5：新拍的和原来那一张一小块一小块（32 × 32 像素）地比，差得最多的那一块平均不超过 1.5 级，就留着原来的文件。
 * 这样留下的图在给人看的那一页上写着差多少。（改了这个数，这个文件的记号就变了，存着的定格图要重拍一遍。）
 */
const TILE_TOLERANCE: number | null = null;

const ROOT = new URL('../../', import.meta.url);
const SHAPES: readonly StillShape[] = ['wide', 'narrow'];

/** 完整的路径（盘符或“/”开头）原样用，别的当成相对项目根目录的。 */
const isAbsolute = (path: string): boolean => /^([a-zA-Z]:)?\//.test(path);
const onDisk = (path: string): string | URL => (isAbsolute(path) ? path : new URL(path, ROOT));

const text = (path: string): string => new TextDecoder().decode(readFile(path));

/** content/ 里每一座站点沙盘。 */
function tables(): { figureId: string; stopId: string }[] {
  const found: { figureId: string; stopId: string }[] = [];
  for (const figure of readdirSync(new URL('content/figures/', ROOT), { withFileTypes: true })) {
    if (!figure.isDirectory() || !fileExists(`content/figures/${figure.name}/scenes`)) continue;
    for (const name of readdirSync(new URL(`content/figures/${figure.name}/scenes/`, ROOT)).sort()) {
      if (name.endsWith('.json')) found.push({ figureId: figure.name, stopId: name.slice(0, -'.json'.length) });
    }
  }
  return found.sort((a, b) => (`${a.figureId}/${a.stopId}` < `${b.figureId}/${b.stopId}` ? -1 : 1));
}

/** 这一站给人看的名字：人物资料里这一站的短名；找不到就用“人物/站”。 */
function stopName(figureId: string, stopId: string): string {
  try {
    const figure = JSON.parse(text(`content/figures/${figureId}/figure.json`)) as { stops?: { id: string; shortTitle?: string }[] };
    return figure.stops?.find((stop) => stop.id === stopId)?.shortTitle ?? `${figureId}/${stopId}`;
  } catch {
    return `${figureId}/${stopId}`;
  }
}

// ---------------------------------------------------------------- 字节和页面之间来回

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

type ShotWindow = Window & { __shot?: HTMLCanvasElement };

/** 把一张截图放进帮忙的那一页（画在一块画布上，后面照它压 JPEG）。返回画布上的像素顺着加出来的数，用来和 Node 里读出来的核对。 */
async function loadShot(helper: Page, png: Uint8Array): Promise<{ width: number; height: number; sum: number }> {
  return helper.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    // 截图里的颜色原样用，不做任何换算
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('帮忙的那一页拿不到画布');
    context.drawImage(bitmap, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      sum = (Math.imul(sum, 31) + data[i]) >>> 0;
      sum = (Math.imul(sum, 31) + data[i + 1]) >>> 0;
      sum = (Math.imul(sum, 31) + data[i + 2]) >>> 0;
    }
    (window as ShotWindow).__shot = canvas;
    return { width: canvas.width, height: canvas.height, sum };
  }, toBase64(png));
}

/** 把刚放进去的那张截图压成 JPEG。quality 是 0 到 100。 */
async function encodeJpeg(helper: Page, quality: number): Promise<Uint8Array> {
  const b64 = await helper.evaluate(async (q) => {
    const canvas = (window as ShotWindow).__shot;
    if (!canvas) throw new Error('帮忙的那一页里没有截图');
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', q / 100));
    if (!blob) throw new Error('这个浏览器压不出 JPEG');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }, quality);
  const bytes = fromBase64(b64);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('压出来的不是 JPEG');
  return bytes;
}

/**
 * 新旧两张 JPEG 解出来，一小块一小块（32 × 32 像素）地比，返回差得最多的那一块平均差几级（0 到 255）。
 * 两张大小不一样（没法一块一块比）时是 null。只给人看，不拿来决定留不留。
 */
async function worstTile(helper: Page, before: Uint8Array, after: Uint8Array): Promise<number | null> {
  return helper.evaluate(
    async ({ a, b, compare }) => {
      const pixels = async (b64: string): Promise<ImageData> => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('帮忙的那一页拿不到画布');
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height);
      };
      // 怎么比是 tests/support/stillsTool.ts 的 worstTileOf（Node 里的测试查着）：把它原样的字拿过来，在这一页里跑
      const worstOf = new Function(`return (${compare})`)() as (p: ImageData, q: ImageData) => number | null;
      return worstOf(await pixels(a), await pixels(b));
    },
    { a: toBase64(before), b: toBase64(after), compare: worstTileOf.toString() },
  );
}

// ---------------------------------------------------------------- 量版面

/** 在这种形状照着拍的窗口上，带着沙盘的替身打开这一站，量版面。 */
async function measureLayout(browser: Browser, baseURL: string, shape: StillShape, figureId: string, stopId: string): Promise<PaneLayout> {
  const [width, height] = SHAPE_PLANS[shape].window;
  const context = await browser.newContext({ baseURL, viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  try {
    const page = await context.newPage();
    await page.goto(`/?stage=fake#/${figureId}/${stopId}`);
    await expect(page.locator('.stage-pane'), `${figureId}/${stopId} 在 ${width} × ${height} 的窗口上，沙盘的替身没有摆好`).toHaveAttribute('data-stage-state', 'ready', { timeout: 120_000 });
    // 连着两次量到一样的数才算数（页面刚摆好时题记的高还可能再变一下；开发服务第一次还可能重新加载一次页面）
    let last: PaneLayout | null = null;
    for (let tries = 0; tries < 40; tries++) {
      await page.waitForTimeout(250);
      let now: PaneLayout;
      try {
        now = await readPaneLayout(page);
      } catch {
        last = null;
        continue;
      }
      if (last && sameLayout(last, now)) return now;
      last = now;
    }
    throw new Error(`${figureId}/${stopId} 在 ${width} × ${height} 的窗口上，版面一直在变，量不准`);
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------- 拍

interface Captured {
  shape: StillShape;
  /** 第几节，从 1 数起。 */
  section: number;
  heading: string;
  shot: StageShot;
  png: Uint8Array;
}

/** 等沙盘测试页上的沙盘摆好。开发服务第一次遇到新的库会重新加载页面：等到一半页面换了，就再等一遍。 */
async function waitForTable(page: Page): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.waitForFunction(() => typeof window.__stageDev !== 'undefined', undefined, { timeout: 180_000 });
      await page.evaluate(() => window.__stageDev.ready);
      const state = await page.evaluate(() => ({ up: window.__stageDev.view !== null, status: window.__stageDev.status }));
      if (!state.up) throw new Error(`沙盘没有摆出来：${state.status}`);
      return;
    } catch (error) {
      const reloaded = error instanceof Error && /Execution context was destroyed/i.test(error.message);
      if (!reloaded || attempt >= 4) throw error;
    }
  }
}

/** 一种形状：开一个窗口，一节一节摆好、读数、截图。 */
async function shootShape(browser: Browser, baseURL: string, shape: StillShape, spec: StillShapeSpec, background: string, figureId: string, stopId: string, scene: StopScene): Promise<Captured[]> {
  const viewport = shotViewport(spec);
  const insets = shotInsets(spec);
  const context = await browser.newContext({ baseURL, viewport, deviceScaleFactor: spec.pixelRatio });
  try {
    const page = await context.newPage();
    const problems: string[] = [];
    page.on('pageerror', (error) => problems.push(`页面出错：${error.message}`));
    page.on('console', (message) => {
      // 浏览器自己去要网站的小图标，开发服务没有这个文件：不算页面的毛病
      if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) problems.push(`控制台报错：${message.text()}`);
    });
    const query = new URLSearchParams({
      figure: figureId,
      stop: stopId,
      tier: 'full',
      bg: background,
      insets: [insets.top, insets.right, insets.bottom, insets.left].join(','),
    });
    await page.goto(`/stage-dev.html?${query.toString()}&reduced&bare`);
    await waitForTable(page);

    const captured: Captured[] = [];
    for (const [i, section] of scene.sections.entries()) {
      const heading = section.heading;
      const read = await page.evaluate(async (wanted): Promise<{ shot: StageShot | null; perf: StageReadout['perf'] | null } | null> => {
        const view = window.__stageDev.view;
        if (!view) return null;
        await view.showSection(wanted, { animate: false });
        // 等两帧：摆到位的那一帧之后，页面才真的画过
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const readout = view.readout();
        return { shot: readout.shot ?? null, perf: readout.perf ?? null };
      }, heading);
      const where = `${figureId}/${stopId} “${heading}” ${shape}`;
      if (!read) throw new Error(`${where}：沙盘不见了（画面断了？）`);
      if (!read.shot) throw new Error(`${where}：沙盘没有给出这个画面的底细（readout().shot）`);
      // 定格图只用完整的画质拍，像素比就是这种形状定的那个
      expect(read.perf?.tier, `${where}：画质`).toBe('full');
      expect(read.perf?.pixelRatio, `${where}：像素比`).toBe(spec.pixelRatio);
      const stripIds = stripTexts(scene, heading, 'ancient').map((strip) => strip.id);
      expect(checkShot(read.shot, heading, stripIds, spec), where).toEqual([]);
      const png: Uint8Array = await page.screenshot({ type: 'png' });
      captured.push({ shape, section: i + 1, heading, shot: read.shot, png });
    }
    expect(problems, `${figureId}/${stopId} ${shape}：拍的时候页面上的报错`).toEqual([]);
    return captured;
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------- 一座沙盘从头到尾

async function shootTable(browser: Browser, baseURL: string, figureId: string, stopId: string): Promise<void> {
  const started = Date.now();
  const name = stopName(figureId, stopId);
  const scene = JSON.parse(text(`content/figures/${figureId}/scenes/${stopId}.json`)) as StopScene;

  // 1 量版面
  const layouts = { wide: await measureLayout(browser, baseURL, 'wide', figureId, stopId), narrow: await measureLayout(browser, baseURL, 'narrow', figureId, stopId) };
  expect(layouts.narrow.background, '两种窗口上沙盘栏的底色要一样').toBe(layouts.wide.background);
  const background = layouts.wide.background;
  const specs: Record<StillShape, StillShapeSpec> = { wide: shapeSpec('wide', layouts.wide), narrow: shapeSpec('narrow', layouts.narrow) };
  for (const shape of SHAPES) {
    const { width, height } = shotViewport(specs[shape]);
    console.log(`[${name}] ${shape}：沙盘栏 ${specs[shape].pane.join(' × ')}，四边留 ${specs[shape].insets.join('、')}，左右各多拍 ${specs[shape].extra}，图片 ${width * specs[shape].pixelRatio} × ${height * specs[shape].pixelRatio}`);
  }

  // 照什么拍的：四个记号。底色要和 tokens.css 里写的是同一个（查“旧不旧”的测试比的是那里）
  const made = madeFromNow(figureId, stopId);
  expect(made.background, '页面上量到的沙盘栏的底色，要和 src/styles/tokens.css 里的 --color-paper-sunk 一样').toBe(background);

  // 2、3 拍。拍完才往下走：下面一写文件，开发服务就可能重新加载页面
  const captured: Captured[] = [];
  for (const shape of SHAPES) captured.push(...(await shootShape(browser, baseURL, shape, specs[shape], background, figureId, stopId, scene)));
  captured.sort((a, b) => a.section - b.section || SHAPES.indexOf(a.shape) - SHAPES.indexOf(b.shape));

  // 原来的清单（没有、读不出来都当没有）
  const dir = `${OUT}/${figureId}/stills`;
  const manifestPath = `${dir}/${stopId}.json`;
  let old: StillShot[] = [];
  try {
    const parsed = JSON.parse(new TextDecoder().decode(readOut(manifestPath))) as Partial<StillManifest>;
    if (Array.isArray(parsed.stills)) old = parsed.stills;
  } catch {
    old = [];
  }

  // 4、5 压成 JPEG，看变没变
  const context = await browser.newContext();
  const stills: StillShot[] = [];
  const writes: { path: string; bytes: Uint8Array }[] = [];
  const review: ReviewEntry[] = [];
  try {
    const helper = await context.newPage();
    await helper.goto('about:blank');
    for (const item of captured) {
      const file = stillFile(stopId, item.section, item.shape);
      const path = `${dir}/${file}`;
      const where = `${name} ${file}`;
      const spec = specs[item.shape];
      const picture: RawPicture = decodePng(item.png);
      const size = shotViewport(spec);
      expect([picture.width, picture.height], `${where}：截图的大小`).toEqual([size.width * spec.pixelRatio, size.height * spec.pixelRatio]);
      expect(Math.max(picture.width, picture.height), `${where}：宽和高都不超过 2048`).toBeLessThanOrEqual(2048);
      expect(flatColour(picture), `${where}：整张图是一种颜色，沙盘没有画出来`).toBe(false);

      const raw = rawKey(picture);
      const previous = old.find((still) => still.file === file);
      const onDiskNow = outExists(path) ? readOut(path) : null;
      const view = stillFromShot(item.shot, item.shape);
      const labels = stripTexts(scene, item.heading, 'ancient').map((strip) => strip.text);

      const keyOnDisk = onDiskNow ? contentKey(onDiskNow) : null;

      if (previous && keepStill(previous, raw, keyOnDisk)) {
        const kept: StillShot = { ...view, file, width: picture.width, height: picture.height, bytes: previous.bytes, quality: previous.quality, key: previous.key, raw };
        stills.push(kept);
        review.push({ still: kept, src: reviewSrc(path), changed: false, worstTile: null, labels });
        continue;
      }

      const loaded = await loadShot(helper, item.png);
      expect(loaded, `${where}：浏览器里拿去压的像素，要和算记号的是同一份`).toEqual({ width: picture.width, height: picture.height, sum: pixelSum(picture) });
      let jpeg: Uint8Array | null = null;
      let quality = 0;
      let smallest = Infinity;
      for (const q of SHAPE_PLANS[item.shape].qualities) {
        const bytes = await encodeJpeg(helper, q);
        smallest = Math.min(smallest, bytes.length);
        if (bytes.length <= STILL_MAX_BYTES) {
          jpeg = bytes;
          quality = q;
          break;
        }
      }
      if (!jpeg) throw new Error(`${where}：质量降到 ${SHAPE_PLANS[item.shape].qualities.at(-1)} 还有 ${smallest} 个字节，超过 ${STILL_MAX_BYTES}（300 KB）`);
      // 原来那个文件要是解不出来（不是工具写的），就不比了
      const worst = onDiskNow ? await worstTile(helper, onDiskNow, jpeg).catch(() => null) : null;
      // 备用的办法（平时关着）：原来的文件就是清单里记的那一份，新拍的和它一小块一小块比都差得很少，就留着原来的
      if (previous && keyOnDisk === previous.key && keepWithin(worst, TILE_TOLERANCE)) {
        const kept: StillShot = { ...view, file, width: previous.width, height: previous.height, bytes: previous.bytes, quality: previous.quality, key: previous.key, raw: previous.raw };
        stills.push(kept);
        review.push({ still: kept, src: reviewSrc(path), changed: false, worstTile: worst, labels });
        continue;
      }
      const fresh: StillShot = { ...view, file, width: picture.width, height: picture.height, bytes: jpeg.length, quality, key: contentKey(jpeg), raw };
      stills.push(fresh);
      writes.push({ path, bytes: jpeg });
      review.push({ still: fresh, src: reviewSrc(path), changed: true, worstTile: worst, labels });
    }
  } finally {
    await context.close();
  }

  // 6 写文件、清单，删掉这一站清单里不再有的图，写给人看的那一页
  const manifest: StillManifest = {
    tool: 1,
    made: { tier: 'full', three: programVersions().three, background, fitMarginPx: SHOT_CAMERA.fitMarginPx, maxFit: SHOT_CAMERA.maxFit },
    madeFrom: made.madeFrom,
    shapes: specs,
    stills,
  };
  mkdirSync(onDisk(dir), { recursive: true });
  for (const { path, bytes } of writes) writeFileSync(onDisk(path), bytes);
  const named = new Set(stills.map((still) => still.file));
  const own = new RegExp(`^${stopId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+-(wide|narrow)\\.jpg$`);
  const removed: string[] = [];
  for (const entry of readdirSync(onDisk(`${dir}/`))) {
    if (own.test(entry) && !named.has(entry)) {
      rmSync(onDisk(`${dir}/${entry}`));
      removed.push(entry);
    }
  }
  writeFileSync(onDisk(manifestPath), manifestText(manifest));
  mkdirSync(onDisk(REVIEW_DIR), { recursive: true });
  const reviewPath = `${REVIEW_DIR}/${figureId}-${stopId}.html`;
  writeFileSync(onDisk(reviewPath), reviewPage(name, background, review));

  // 说一遍做了什么
  const changed = review.filter((entry) => entry.changed);
  for (const entry of review) {
    const { still } = entry;
    console.log(`[${name}] ${still.file}：${still.width} × ${still.height}，${still.bytes} 字节，质量 ${still.quality}。${reviewWord(entry)}`);
  }
  if (removed.length > 0) console.log(`[${name}] 删掉了清单里不再有的图：${removed.join('、')}`);
  console.log(`[${name}] 一共 ${stills.length} 张，重写了 ${changed.length} 张，合计 ${stills.reduce((n, still) => n + still.bytes, 0)} 字节；用了 ${((Date.now() - started) / 1000).toFixed(0)} 秒`);
  console.log(`[${name}] 清单：${manifestPath}；给人看的那一页：${reviewPath}`);

  // 齐不齐：每一小节两种形状各一张
  expect(stills.length, `${name}：每一小节宽、窄各一张`).toBe(scene.sections.length * SHAPES.length);

  // 往 content/ 里写了文件，开发服务过一小会儿会重新加载页面：等它过去，再让下一座沙盘开拍
  if (writes.length > 0) await new Promise<void>((resolve) => setTimeout(resolve, 2000));
}

/** 读、查存图的那个文件夹里的文件（STILLS_OUT 可以是完整的路径）。 */
function readOut(path: string): Uint8Array {
  return readFileSync(onDisk(path));
}

function outExists(path: string): boolean {
  return existsSync(onDisk(path));
}

/** 给人看的那一页里，这张图的网址。 */
function reviewSrc(path: string): string {
  return isAbsolute(path) ? `file:///${path.replace(/^\//, '')}` : relativePath(REVIEW_DIR, path);
}

// ---------------------------------------------------------------- 入口

const found = tables();

test('content/ 里找得到要拍的沙盘', () => {
  expect(found.length).toBeGreaterThan(0);
});

for (const { figureId, stopId } of found) {
  test(`${figureId}/${stopId}：每一小节拍宽、窄两张定格图，存到 ${OUT}`, async ({ browser, baseURL }) => {
    if (!baseURL) throw new Error('配置里没有 baseURL');
    await shootTable(browser, baseURL, figureId, stopId);
  });
}

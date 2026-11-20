// 做“先画好的地面”的工具：npm run bake。给 content/ 里每座站点沙盘的地面上色，存成两张图和一份清单：
//   content/figures/<人物>/baked/<站>.colour.jpg   颜色（JPEG）
//   content/figures/<人物>/baked/<站>.fields.png   哪里是田（8 位灰度的 PNG）
//   content/figures/<人物>/baked/<站>.json         清单（src/domain/bakedGround.ts 的 BakedGroundManifest）
// 这三样做好以后放进仓库，随网站一起发；发布的流程不重新做。清单和图片都不手改。说明见 docs/data-spec.md“制作时做好的两样”。
//
// 它是一个测试文件，因为这个项目是靠 vitest 在 Node 里跑 TypeScript 的。
// 它最下面“不开浏览器也查得了的”那一组随 npm test 跑（package.json 的 test 里列着这个文件），什么也不往 content/ 里写；
// 上面真的做图的那一组只有 npm run bake（vitest --mode bake）才跑。直接跑这个文件（npx vitest run tests/tools/bake-ground.test.ts）
// 和 npm test 一样，只跑最下面那一组。
// 要是哪一版的 vitest 不把 --mode 交到 import.meta.env.MODE 里，设环境变量 BAKE=1 也算。
//
// 压 JPEG 要用浏览器：工具自己打开一个不显示窗口的 Chromium（同一时刻只能开一个浏览器，所以不要和
// npm run test:e2e、npm run stills 同时跑），做完关掉。不连任何外面的服务。
//
// 每座沙盘的步骤：
//   1 读高程、整理地面、上色（和页面打开时现画是同一段程序），拆成颜色和田的标记两份，各算一个记号；
//     再算“照什么画的”两个记号：场景里管地面的那一部分，地形文件。
//   2 清单里这四个记号都没变、压缩的质量也没变、两张图都在而且是清单记的那两份：说一声“已经是新的”，什么也不写。
//     只是“照什么画的”记号变了、画出来的像素没变（比如只改了摆件什么时候有）：图不动，只重写清单。
//   3 田的标记写成 PNG（tests/support/png.ts），读回来对一遍。
//   4 颜色交给浏览器压成 JPEG；浏览器把压好的图再解开，和原来的比，算出清晰度（psnr）。不到 40 分贝就不通过，不写。
//   5 地形文件、颜色、田的标记三个文件合计超过 1.5 MB 也不通过，不写。
//   6 写两张图和清单（字段的先后固定，缩进两格，行尾是 LF，最后有一个换行）。印出各个文件多大、合计用了上限的几成。

import type { Browser } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BakedGroundManifest } from '../../src/domain/bakedGround';
import { contentKey } from '../../src/domain/contentKey';
import type { StopScene } from '../../src/domain/scene';
import { buildFields, paintColour, readDem } from '../../src/stage/ground';
import type { Ground } from '../../src/stage/ground/types';
import { colourBytes, fieldBytes, groundInputs, groundPictureSize } from '../../src/stage/three/groundPaint';
import { styleFor } from '../../src/stage/three/style';
import { COLOUR_PSNR_MIN, TABLE_FILES_MAX_BYTES, edgeTooLong, psnrTooLow, tableFiles, withCommas } from '../content/budgetRules';
import { realScene, realSceneFile, realSceneKeys } from '../stage/support/realScenes';
import { fixtureScene, fixtureTerrainBytes } from '../support/fixtureScene';
import { decodePng, encodeGreyPng } from '../support/png';
import { readBytes } from '../support/readBytes';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** 是不是真的要做（npm run bake）。 */
const BAKING = import.meta.env.MODE === 'bake' || env.BAKE === '1';

/**
 * 颜色压成 JPEG 的质量，0 到 1。0.95 时徐州的颜色约 280 KB，清晰度约 41 分贝。
 * 贴近了看（“水退以后”那一节）要是看得出压过的痕迹，改成 0.97（约 395 KB）或 0.99（约 586 KB），都还在 1.5 MB 以内；
 * 改了以后再跑一遍 npm run bake。
 */
const JPEG_QUALITY = 0.95;

/** 项目的根目录：这个文件在 tests/tools/ 里，往上两层。 */
const ROOT = new URL('../../', import.meta.url);

// ---------------------------------------------------------------- 在浏览器里跑的那一段

interface PageJob {
  /** 颜色：一个点三个字节，逐行存，写成 base64。 */
  rgb64: string;
  width: number;
  height: number;
  quality: number;
}

interface PageResult {
  /** 压好的 JPEG 文件，写成 base64。 */
  jpeg64: string;
  /** 压好的图解开以后和原来比的清晰度（分贝）；一点不差时记 99。 */
  psnr: number;
  /** 解开以后的宽高。 */
  width: number;
  height: number;
}

/**
 * 这个函数是整个交给浏览器、在一张空白的页面里跑的：把颜色画到画布上，压成 JPEG，再把压好的图解开和原来的比。
 * 所以它里面不能用这个文件里别的任何东西（别的函数、常数、引入的模块），只能用浏览器自己有的。
 */
async function encodeInPage(job: PageJob): Promise<PageResult> {
  const { width, height } = job;
  const n = width * height;
  const raw = atob(job.rgb64);
  if (raw.length !== n * 3) throw new Error(`交进来的颜色有 ${raw.length} 个字节，应该是 ${n * 3} 个`);

  const image = new ImageData(width, height);
  for (let k = 0; k < n; k++) {
    image.data[k * 4] = raw.charCodeAt(k * 3);
    image.data[k * 4 + 1] = raw.charCodeAt(k * 3 + 1);
    image.data[k * 4 + 2] = raw.charCodeAt(k * 3 + 2);
    image.data[k * 4 + 3] = 255;
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const pen = canvas.getContext('2d');
  if (!pen) throw new Error('浏览器没有给出画布的画笔');
  pen.putImageData(image, 0, 0);

  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg', job.quality));
  if (!blob) throw new Error('浏览器没能把画布压成 JPEG');

  // 把压好的图解开，和原来的比
  const bitmap = await createImageBitmap(blob);
  const check = document.createElement('canvas');
  check.width = width;
  check.height = height;
  const reader = check.getContext('2d', { willReadFrequently: true });
  if (!reader) throw new Error('浏览器没有给出画布的画笔');
  reader.drawImage(bitmap, 0, 0);
  const got = reader.getImageData(0, 0, width, height).data;
  let squares = 0;
  for (let k = 0; k < n; k++) {
    for (let c = 0; c < 3; c++) {
      const d = got[k * 4 + c] - image.data[k * 4 + c];
      squares += d * d;
    }
  }
  const mse = squares / (n * 3);
  const psnr = mse === 0 ? 99 : 10 * Math.log10((255 * 255) / mse);

  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { jpeg64: btoa(text), psnr, width: bitmap.width, height: bitmap.height };
}

// ---------------------------------------------------------------- 字节和 base64

function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------- 清单

/** 清单写成文件的样子：字段的先后固定（同样的内容每次写出同样的字节），缩进两格，行尾 LF，最后一个换行。 */
function manifestText(m: BakedGroundManifest): string {
  const ordered: BakedGroundManifest = {
    tool: m.tool,
    inputs: { ground: m.inputs.ground, terrain: m.inputs.terrain },
    pixels: { colour: m.pixels.colour, fields: m.pixels.fields },
    colour: { file: m.colour.file, width: m.colour.width, height: m.colour.height, bytes: m.colour.bytes, key: m.colour.key, quality: m.colour.quality, psnr: m.colour.psnr },
    fields: { file: m.fields.file, width: m.fields.width, height: m.fields.height, bytes: m.fields.bytes, key: m.fields.key },
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** 读一份已有的清单。没有、读不出来、不是这一版的格式，都当成没有。 */
function readManifest(file: URL): BakedGroundManifest | null {
  if (!existsSync(file)) return null;
  try {
    const m = JSON.parse(new TextDecoder().decode(readFileSync(file))) as Partial<BakedGroundManifest> | null;
    if (!m || m.tool !== 1 || !m.inputs || !m.pixels || !m.colour || !m.fields) return null;
    return m as BakedGroundManifest;
  } catch {
    return null;
  }
}

/** 一个文件的记号；文件不在是 null。 */
function fileKey(file: URL): string | null {
  return existsSync(file) ? contentKey(readFileSync(file)) : null;
}

// ---------------------------------------------------------------- 做一座沙盘

interface Encoded {
  bytes: Uint8Array;
  psnr: number;
  width: number;
  height: number;
}

/** 把颜色（一个点三个字节）压成 JPEG。真的做时是浏览器压的；查这个工具时换成假的。 */
type EncodeJpeg = (rgb: Uint8Array, width: number, height: number, quality: number) => Promise<Encoded>;

interface BakeJob {
  /** 印出来给人看的名字，如 su-shi/xuzhou。 */
  label: string;
  /** 文件名开头的站名，如 xuzhou。 */
  stop: string;
  scene: StopScene;
  terrainBytes: ArrayBuffer;
  ground: Ground;
  /** 写到哪个文件夹（以“/”结尾）。 */
  dir: URL;
  quality: number;
  encodeJpeg: EncodeJpeg;
  say(line: string): void;
}

/** fresh：已经是新的，什么也没写。manifest：图没变，只重写了清单。written：两张图和清单都写了。 */
type BakeOutcome = 'fresh' | 'manifest' | 'written';

async function bakeGround(job: BakeJob): Promise<BakeOutcome> {
  const { label, stop, scene, terrainBytes, ground, dir, quality } = job;
  const tag = `[先画好的地面] ${label}`;

  // 1 上色，拆成两份，算记号
  const painted = paintColour(ground, styleFor(scene.style).ground);
  const { w, h } = groundPictureSize(ground);
  if (painted.w !== w || painted.h !== h) throw new Error(`${tag}：画出来是 ${painted.w} × ${painted.h}，照沙盘的范围应该是 ${w} × ${h}`);
  if (edgeTooLong(w, h)) throw new Error(`${tag}：颜色图是 ${w} × ${h}，宽或高超过了上限`);
  const rgb = colourBytes(painted.colour);
  const mask = fieldBytes(painted.colour);
  const inputs = groundInputs(scene, terrainBytes);
  const pixels = { colour: contentKey(rgb), fields: contentKey(mask) };

  const colourFile = `${stop}.colour.jpg`;
  const fieldsFile = `${stop}.fields.png`;
  const manifestFile = new URL(`${stop}.json`, dir);
  const report = (m: BakedGroundManifest): void => {
    const total = tableFiles({ terrain: terrainBytes.byteLength, colour: m.colour.bytes, fields: m.fields.bytes });
    job.say(`  颜色　　　${colourFile}　${m.colour.width} × ${m.colour.height}　${withCommas(m.colour.bytes)} 字节　质量 ${m.colour.quality}　清晰度 ${m.colour.psnr} 分贝（最低 ${COLOUR_PSNR_MIN}）`);
    job.say(`  田的标记　${fieldsFile}　${m.fields.width} × ${m.fields.height}　${withCommas(m.fields.bytes)} 字节`);
    job.say(`  地形文件　${scene.terrain.file}　${withCommas(terrainBytes.byteLength)} 字节`);
    job.say(`  三个文件合计 ${withCommas(total.total)} 字节，上限 ${withCommas(TABLE_FILES_MAX_BYTES)}（用了 ${Math.round((total.total / TABLE_FILES_MAX_BYTES) * 100)}%）${total.verdict === 'warn' ? '　快到上限了' : ''}`);
  };

  // 2 已经是新的？图没变、只是“照什么画的”变了？
  const old = readManifest(manifestFile);
  if (old) {
    const picturesKept =
      old.pixels.colour === pixels.colour &&
      old.pixels.fields === pixels.fields &&
      old.colour.quality === quality &&
      old.colour.file === colourFile &&
      old.fields.file === fieldsFile &&
      fileKey(new URL(colourFile, dir)) === old.colour.key &&
      fileKey(new URL(fieldsFile, dir)) === old.fields.key;
    if (picturesKept && old.inputs.ground === inputs.ground && old.inputs.terrain === inputs.terrain) {
      job.say(`${tag}：已经是新的，什么也没写。`);
      report(old);
      return 'fresh';
    }
    if (picturesKept) {
      const next: BakedGroundManifest = { ...old, inputs };
      writeFileSync(manifestFile, manifestText(next));
      job.say(`${tag}：画出来的和存着的一样，两张图没有动，只重写了清单（场景或地形文件的记号变了）。`);
      report(next);
      return 'manifest';
    }
  }

  // 3 田的标记：写成 PNG，读回来对一遍
  const png = encodeGreyPng(mask, w, h);
  const back = decodePng(png);
  if (back.width !== w || back.height !== h || back.channels !== 1 || contentKey(back.pixels) !== pixels.fields) {
    throw new Error(`${tag}：田的标记写成 PNG 以后读回来不一样，没有写任何文件`);
  }

  // 4 颜色：压成 JPEG，看清晰度
  const jpeg = await job.encodeJpeg(rgb, w, h, quality);
  if (jpeg.bytes.length < 4 || jpeg.bytes[0] !== 0xff || jpeg.bytes[1] !== 0xd8 || jpeg.bytes[2] !== 0xff) throw new Error(`${tag}：压出来的不是 JPEG，没有写任何文件`);
  if (jpeg.width !== w || jpeg.height !== h) throw new Error(`${tag}：压出来的图是 ${jpeg.width} × ${jpeg.height}，应该是 ${w} × ${h}，没有写任何文件`);
  // 清单里记两位小数，往小里记：记下来的数不会比真的好
  const psnr = Math.floor(jpeg.psnr * 100) / 100;
  if (!Number.isFinite(psnr) || psnrTooLow(psnr)) {
    throw new Error(`${tag}：颜色压成 JPEG（质量 ${quality}）以后清晰度只有 ${psnr} 分贝，不到 ${COLOUR_PSNR_MIN}，没有写任何文件。把 tests/tools/bake-ground.test.ts 里的 JPEG_QUALITY 调高再跑`);
  }

  // 5 三个文件合计
  const total = tableFiles({ terrain: terrainBytes.byteLength, colour: jpeg.bytes.length, fields: png.length });
  if (total.verdict === 'fail') {
    throw new Error(
      `${tag}：地形文件 ${withCommas(terrainBytes.byteLength)}、颜色 ${withCommas(jpeg.bytes.length)}、田的标记 ${withCommas(png.length)} 字节，合计 ${withCommas(total.total)}，超过了上限 ${withCommas(TABLE_FILES_MAX_BYTES)}，没有写任何文件`,
    );
  }

  // 6 写
  const manifest: BakedGroundManifest = {
    tool: 1,
    inputs,
    pixels,
    colour: { file: colourFile, width: w, height: h, bytes: jpeg.bytes.length, key: contentKey(jpeg.bytes), quality, psnr },
    fields: { file: fieldsFile, width: w, height: h, bytes: png.length, key: contentKey(png) },
  };
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL(colourFile, dir), jpeg.bytes);
  writeFileSync(new URL(fieldsFile, dir), png);
  writeFileSync(manifestFile, manifestText(manifest));
  job.say(`${tag}：写好了（${old ? '换掉了旧的' : '以前没有'}）。`);
  report(manifest);
  return 'written';
}

// ---------------------------------------------------------------- npm run bake

describe.skipIf(!BAKING)('给每座沙盘的地面上色，存成图（npm run bake）', () => {
  let browser: Browser | null = null;

  afterAll(async () => {
    await browser?.close();
  });

  /** 用浏览器压。浏览器到第一次真的要压时才打开：都已经是新的，就不开。 */
  const encodeJpeg: EncodeJpeg = async (rgb, width, height, quality) => {
    if (!browser) {
      const { chromium } = await import('@playwright/test');
      browser = await chromium.launch({ headless: true });
    }
    const page = await browser.newPage();
    try {
      const result = await page.evaluate(encodeInPage, { rgb64: toBase64(rgb), width, height, quality });
      return { bytes: fromBase64(result.jpeg64), psnr: result.psnr, width: result.width, height: result.height };
    } finally {
      await page.close();
    }
  };

  const keys = realSceneKeys();

  it('content/ 里至少有一座站点沙盘', () => {
    expect(keys.length).toBeGreaterThan(0);
  });

  it.each(keys)('%s', { timeout: 300_000 }, async (key) => {
    const [figureId, stopId] = key.split('/');
    const { scene, terrainPath } = realSceneFile(key);
    const outcome = await bakeGround({
      label: key,
      stop: stopId,
      scene,
      terrainBytes: readBytes(terrainPath),
      ground: realScene(key).ground,
      dir: new URL(`content/figures/${figureId}/baked/`, ROOT),
      quality: JPEG_QUALITY,
      encodeJpeg,
      say: (line) => console.log(line),
    });
    expect(['fresh', 'manifest', 'written']).toContain(outcome);
  });
});

// ---------------------------------------------------------------- 不开浏览器也查得了的

describe('做图的工具自己（不开浏览器，不动 content/）', () => {
  /** 查的时候往这里写，查完删掉。tests/shots/ 不进仓库。 */
  const SCRATCH = new URL('tests/shots/bake-check/', ROOT);
  const said: string[] = [];

  beforeAll(() => {
    // 上一次要是半路断了，留下的东西先清掉
    rmSync(SCRATCH, { recursive: true, force: true });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    said.length = 0;
  });
  afterAll(() => {
    rmSync(SCRATCH, { recursive: true, force: true });
  });

  /** 测试用的小沙盘，添一条“田”（不然田的标记全是 0）。 */
  function sample(change?: (scene: StopScene) => void): { scene: StopScene; terrainBytes: ArrayBuffer; ground: Ground } {
    const scene = fixtureScene();
    scene.dressing.push({ id: 'fields', name: '田', kind: 'fields', class: 'dressing', basis: '平地上的田，示意。', sourceIds: [] });
    change?.(scene);
    const terrainBytes = fixtureTerrainBytes();
    return { scene, terrainBytes, ground: buildFields(scene, readDem(scene.terrain, terrainBytes)) };
  }

  /** 假的“压成 JPEG”：开头三个字节是 JPEG 的，后面跟着颜色的记号（颜色变了，文件就变）。记下被叫了几次。 */
  function fakeEncoder(psnr = 41.4567): { encode: EncodeJpeg; calls: { width: number; height: number; quality: number; bytes: number }[] } {
    const calls: { width: number; height: number; quality: number; bytes: number }[] = [];
    const encode: EncodeJpeg = (rgb, width, height, quality) => {
      calls.push({ width, height, quality, bytes: rgb.length });
      const tail = new TextEncoder().encode(`${contentKey(rgb)} q${quality}`);
      return Promise.resolve({ bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...tail]), psnr, width, height });
    };
    return { encode, calls };
  }

  const job = (dirName: string, parts: ReturnType<typeof sample>, encodeJpeg: EncodeJpeg, quality = 0.95): BakeJob => ({
    label: 'demo/sample-town',
    stop: 'sample-town',
    ...parts,
    dir: new URL(`${dirName}/`, SCRATCH),
    quality,
    encodeJpeg,
    say: (line) => said.push(line),
  });

  const read = (dirName: string, file: string): Uint8Array => readFileSync(new URL(`${dirName}/${file}`, SCRATCH));
  const readText = (dirName: string, file: string): string => new TextDecoder().decode(read(dirName, file));

  it('只有 npm run bake（--mode bake，或者 BAKE=1）才真的做', () => {
    expect(typeof import.meta.env.MODE).toBe('string');
    // 两头各查一句（不照抄 BAKING 的那一行，那样永远不会红）：没有要做的时候一定不做（随 npm test 跑就是这样）；
    // 用 bake 模式跑的时候一定做。
    if (import.meta.env.MODE !== 'bake' && env.BAKE !== '1') expect(BAKING).toBe(false);
    if (import.meta.env.MODE === 'bake') expect(BAKING).toBe(true);
  });

  it('压 JPEG 要用的浏览器库在这里引得进来（只引入，不打开浏览器），引了以后这里的检查照常管用', async () => {
    const { chromium } = await import('@playwright/test');
    expect(typeof chromium.launch).toBe('function');
    expect(() => expect(1).toBe(2)).toThrow();
  });

  it('第一次：写两张图和清单；清单里的记号、大小、文件的记号都是对的', async () => {
    const parts = sample();
    const { encode, calls } = fakeEncoder();
    expect(await bakeGround(job('first', parts, encode))).toBe('written');

    // 交给浏览器的是颜色：一个点三个字节，301 × 241
    expect(calls).toEqual([{ width: 301, height: 241, quality: 0.95, bytes: 301 * 241 * 3 }]);

    const painted = paintColour(parts.ground, styleFor(parts.scene.style).ground);
    const text = readText('first', 'sample-town.json');
    const manifest = JSON.parse(text) as BakedGroundManifest;
    const jpeg = read('first', 'sample-town.colour.jpg');
    const png = read('first', 'sample-town.fields.png');

    expect(manifest.tool).toBe(1);
    expect(manifest.inputs).toEqual(groundInputs(parts.scene, parts.terrainBytes));
    expect(manifest.pixels).toEqual({ colour: contentKey(colourBytes(painted.colour)), fields: contentKey(fieldBytes(painted.colour)) });
    expect(manifest.colour).toEqual({ file: 'sample-town.colour.jpg', width: 301, height: 241, bytes: jpeg.length, key: contentKey(jpeg), quality: 0.95, psnr: 41.45 });
    expect(manifest.fields).toEqual({ file: 'sample-town.fields.png', width: 301, height: 241, bytes: png.length, key: contentKey(png) });

    // 田的标记那张图读回来，就是 paintColour 画的每个点的第四个字节
    const back = decodePng(png);
    expect([back.width, back.height, back.channels]).toEqual([301, 241, 1]);
    expect(contentKey(back.pixels)).toBe(manifest.pixels.fields);
    expect(back.pixels.some((v) => v > 128) && back.pixels.some((v) => v === 0)).toBe(true);

    // 清单的写法：字段的先后固定，缩进两格，行尾 LF，最后一个换行，没有别的字段
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.includes('\r')).toBe(false);
    expect(text.split('\n')[1]).toBe('  "tool": 1,');
    expect(Object.keys(manifest)).toEqual(['tool', 'inputs', 'pixels', 'colour', 'fields']);
    expect(Object.keys(manifest.inputs)).toEqual(['ground', 'terrain']);
    expect(Object.keys(manifest.pixels)).toEqual(['colour', 'fields']);
    expect(Object.keys(manifest.colour)).toEqual(['file', 'width', 'height', 'bytes', 'key', 'quality', 'psnr']);
    expect(Object.keys(manifest.fields)).toEqual(['file', 'width', 'height', 'bytes', 'key']);
    expect(manifestText(manifest)).toBe(text);

    // 印出来的话：写好了，各个文件多大，合计
    expect(said[0]).toBe('[先画好的地面] demo/sample-town：写好了（以前没有）。');
    expect(said.some((line) => line.includes('三个文件合计') && line.includes('上限 1,572,864'))).toBe(true);
  });

  it('再跑一遍：已经是新的，不叫浏览器，一个字节也不写', async () => {
    const { encode } = fakeEncoder();
    await bakeGround(job('again', sample(), encode));
    const before = ['sample-town.json', 'sample-town.colour.jpg', 'sample-town.fields.png'].map((f) => contentKey(read('again', f)));
    said.length = 0;

    const second = fakeEncoder();
    expect(await bakeGround(job('again', sample(), second.encode))).toBe('fresh');
    expect(second.calls).toEqual([]);
    expect(['sample-town.json', 'sample-town.colour.jpg', 'sample-town.fields.png'].map((f) => contentKey(read('again', f)))).toEqual(before);
    expect(said[0]).toBe('[先画好的地面] demo/sample-town：已经是新的，什么也没写。');
  });

  it('只改了镜头、题记、依据：还是“已经是新的”', async () => {
    const { encode } = fakeEncoder();
    await bakeGround(job('words', sample(), encode));
    const edited = sample((s) => {
      s.sections[0].camera.distanceM += 800;
      s.sections[1].line = '换了一句题记。';
      s.things[0].basis = '换了一句依据。';
    });
    const second = fakeEncoder();
    expect(await bakeGround(job('words', edited, second.encode))).toBe('fresh');
    expect(second.calls).toEqual([]);
  });

  it('挪了一条河：两张图和清单都重写，清单里的四个记号里场景和颜色的变了', async () => {
    const { encode } = fakeEncoder();
    await bakeGround(job('moved', sample(), encode));
    const old = JSON.parse(readText('moved', 'sample-town.json')) as BakedGroundManifest;

    const moved = sample((s) => {
      const [lng, lat] = s.water.rivers[0].line[1];
      s.water.rivers[0].line[1] = [lng + 0.003, lat];
    });
    const second = fakeEncoder();
    expect(await bakeGround(job('moved', moved, second.encode))).toBe('written');
    expect(second.calls).toHaveLength(1);
    const now = JSON.parse(readText('moved', 'sample-town.json')) as BakedGroundManifest;
    expect(now.inputs.ground).not.toBe(old.inputs.ground);
    expect(now.inputs.terrain).toBe(old.inputs.terrain);
    expect(now.pixels.colour).not.toBe(old.pixels.colour);
    expect(now.colour.key).toBe(contentKey(read('moved', 'sample-town.colour.jpg')));
    expect(said.some((line) => line.includes('写好了（换掉了旧的）'))).toBe(true);
  });

  it('场景的记号变了、画出来的没变（摆件换了类别）：图不动，只重写清单，不叫浏览器', async () => {
    const { encode } = fakeEncoder();
    await bakeGround(job('same-pixels', sample(), encode));
    const pictures = ['sample-town.colour.jpg', 'sample-town.fields.png'].map((f) => contentKey(read('same-pixels', f)));
    const old = JSON.parse(readText('same-pixels', 'sample-town.json')) as BakedGroundManifest;

    const reclassed = sample((s) => (s.things[1].class = s.things[1].class === 'text' ? 'schematic' : 'text'));
    const second = fakeEncoder();
    expect(await bakeGround(job('same-pixels', reclassed, second.encode))).toBe('manifest');
    expect(second.calls).toEqual([]);
    expect(['sample-town.colour.jpg', 'sample-town.fields.png'].map((f) => contentKey(read('same-pixels', f)))).toEqual(pictures);
    const now = JSON.parse(readText('same-pixels', 'sample-town.json')) as BakedGroundManifest;
    expect(now.inputs).toEqual(groundInputs(reclassed.scene, reclassed.terrainBytes));
    expect(now.inputs.ground).not.toBe(old.inputs.ground);
    expect({ ...now, inputs: old.inputs }).toEqual(old);
  });

  it('少了一张图、图被换过、清单读不出来、压缩的质量改了：都重做', { timeout: 30_000 }, async () => {
    // 这一项在发布流程的机器上要比默认的 5 秒久（这台机器上 3 秒左右）：给它自己的时限，不把要走的步数减少。
    const spoil: [string, (dirName: string) => void, number][] = [
      ['少了颜色那张图', (d) => rmSync(new URL(`${d}/sample-town.colour.jpg`, SCRATCH)), 0.95],
      ['田的标记那张图被换过', (d) => writeFileSync(new URL(`${d}/sample-town.fields.png`, SCRATCH), encodeGreyPng(new Uint8Array(4), 2, 2)), 0.95],
      ['清单读不出来', (d) => writeFileSync(new URL(`${d}/sample-town.json`, SCRATCH), '{ 不是 JSON'), 0.95],
      ['清单是别的格式', (d) => writeFileSync(new URL(`${d}/sample-town.json`, SCRATCH), '{"tool": 2}\n'), 0.95],
      ['压缩的质量改了', () => undefined, 0.97],
    ];
    for (const [name, change, quality] of spoil) {
      const dirName = `spoil-${spoil.findIndex((s) => s[0] === name)}`;
      await bakeGround(job(dirName, sample(), fakeEncoder().encode));
      change(dirName);
      const second = fakeEncoder();
      expect(await bakeGround(job(dirName, sample(), second.encode, quality)), name).toBe('written');
      expect(second.calls.map((c) => c.quality), name).toEqual([quality]);
      const now = JSON.parse(readText(dirName, 'sample-town.json')) as BakedGroundManifest;
      expect(now.colour.quality, name).toBe(quality);
      expect(now.colour.key, name).toBe(contentKey(read(dirName, 'sample-town.colour.jpg')));
      expect(now.fields.key, name).toBe(contentKey(read(dirName, 'sample-town.fields.png')));
    }
  });

  it('压得太狠（清晰度不到 40 分贝）、压出来的不是 JPEG、大小不对：不通过，什么也不写', async () => {
    const bad: [string, EncodeJpeg, string][] = [
      ['清晰度 39.99', fakeEncoder(39.999).encode, '清晰度只有 39.99 分贝'],
      ['清晰度不是数', fakeEncoder(Number.NaN).encode, '清晰度只有'],
      ['不是 JPEG', (_rgb, width, height) => Promise.resolve({ bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), psnr: 45, width, height }), '不是 JPEG'],
      ['大小不对', (_rgb, width, height) => Promise.resolve({ bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]), psnr: 45, width: width - 1, height }), '应该是 301 × 241'],
    ];
    for (const [name, encode, message] of bad) {
      const dirName = `bad-${bad.findIndex((b) => b[0] === name)}`;
      await expect(bakeGround(job(dirName, sample(), encode)), name).rejects.toThrow(message);
      expect(existsSync(new URL(`${dirName}/`, SCRATCH)), name).toBe(false);
    }
    // 正好 40 分贝算合格
    expect(await bakeGround(job('just-enough', sample(), fakeEncoder(40).encode))).toBe('written');
  });

  it('三个文件合计超过 1.5 MB：不通过，什么也不写', async () => {
    const huge: EncodeJpeg = (_rgb, width, height) => {
      const bytes = new Uint8Array(TABLE_FILES_MAX_BYTES);
      bytes.set([0xff, 0xd8, 0xff, 0xe0]);
      return Promise.resolve({ bytes, psnr: 45, width, height });
    };
    await expect(bakeGround(job('huge', sample(), huge))).rejects.toThrow('超过了上限 1,572,864');
    expect(existsSync(new URL('huge/', SCRATCH))).toBe(false);
  });

  it('字节和 base64 来回换，一个字节不差', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_v, i) => (i * 7 + (i >> 8)) & 0xff);
    const back = fromBase64(toBase64(bytes));
    expect(back.length).toBe(bytes.length);
    expect(contentKey(back)).toBe(contentKey(bytes));
    expect(toBase64(new Uint8Array(0))).toBe('');
    expect(toBase64(Uint8Array.from([0xff, 0xd8, 0xff]))).toBe('/9j/');
  });

  it('交给浏览器的那一段：离了这个文件也跑得起来；画上去的是交进来的颜色，清晰度算得对，压好的图原样带回来', async () => {
    // 假的浏览器：画布记下画上去的像素；“压成 JPEG”时每个字节加减一点（像压过的样子）；“解开”时给出加减过的像素
    const width = 5;
    const height = 4;
    const rgb = Uint8Array.from({ length: width * height * 3 }, (_v, i) => (i * 11) % 251);
    const put: Uint8ClampedArray[] = [];
    const jpegBytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 250, 251, 252]);
    const errorAt = (i: number): number => (i % 3) - 1; // −1、0、1 轮着来
    let asked: { type?: string; quality?: number } = {};

    class FakeImageData {
      data: Uint8ClampedArray;
      constructor(public width: number, public height: number) {
        this.data = new Uint8ClampedArray(width * height * 4);
      }
    }
    const makeCanvas = () => {
      let pixels: Uint8ClampedArray = new Uint8ClampedArray(0);
      return {
        width: 0,
        height: 0,
        getContext: () => ({
          putImageData(image: FakeImageData) {
            pixels = Uint8ClampedArray.from(image.data);
            put.push(pixels);
          },
          drawImage(bitmap: { pixels: Uint8ClampedArray }) {
            pixels = bitmap.pixels;
          },
          getImageData: () => ({ data: pixels }),
        }),
        toBlob(done: (blob: unknown) => void, type: string, quality: number) {
          asked = { type, quality };
          const decoded = pixels.map((v, i) => (i % 4 === 3 ? 255 : v + errorAt(i)));
          done({ arrayBuffer: () => Promise.resolve(jpegBytes.buffer), decoded });
        },
      };
    };
    vi.stubGlobal('ImageData', FakeImageData);
    vi.stubGlobal('document', { createElement: makeCanvas });
    vi.stubGlobal('createImageBitmap', (blob: { decoded: Uint8ClampedArray }) => Promise.resolve({ width, height, pixels: blob.decoded }));

    // 只拿这个函数的文字，在这个文件外面重新做成函数：它要是用了文件里别的东西，这里就跑不起来
    const alone = new Function(`return (${encodeInPage.toString()});`)() as typeof encodeInPage;
    const result = await alone({ rgb64: toBase64(rgb), width, height, quality: 0.95 });

    expect(asked).toEqual({ type: 'image/jpeg', quality: 0.95 });
    // 画上去的：交进来的颜色，第四个字节是 255
    expect(put).toHaveLength(1);
    for (let k = 0; k < width * height; k++) {
      expect([put[0][k * 4], put[0][k * 4 + 1], put[0][k * 4 + 2], put[0][k * 4 + 3]]).toEqual([rgb[k * 3], rgb[k * 3 + 1], rgb[k * 3 + 2], 255]);
    }
    // 清晰度：照同样的差另算一遍（只算颜色的三路，不算第四个字节）
    let squares = 0;
    let n = 0;
    for (let i = 0; i < width * height * 4; i++) {
      if (i % 4 === 3) continue;
      const before = put[0][i];
      const after = Math.max(0, Math.min(255, before + errorAt(i)));
      squares += (after - before) ** 2;
      n++;
    }
    expect(squares).toBeGreaterThan(0);
    expect(result.psnr).toBeCloseTo(10 * Math.log10((255 * 255) / (squares / n)), 9);
    expect([result.width, result.height]).toEqual([width, height]);
    expect([...fromBase64(result.jpeg64)]).toEqual([...jpegBytes]);

    // 交进来的字节数和宽高对不上：说出来，不乱画
    await expect(alone({ rgb64: toBase64(rgb.subarray(3)), width, height, quality: 0.95 })).rejects.toThrow('应该是 60 个');
  });
});

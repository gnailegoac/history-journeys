// 拍定格图的工具（tests/tools/make-stills.spec.ts）里不靠浏览器的那一部分。
// 单拿出来，是因为工具那个文件只能由 Playwright 来跑，Node 里的测试引不了它；放在这里，
// tests/unit/still-keys.test.ts、tests/stage/stills-fresh.test.ts、tests/unit/still-fit.test.ts 都查得到，
// 查“版面变没变”的浏览器测试（tests/e2e/still-layout.spec.ts）也用得上。
//
// 这里有：两种形状各照什么拍；从沙盘的读数做出清单里的一项；工具自己的几项检查；画面变没变；
// 这些图是照什么拍的（四个记号），存着的图旧在哪里；清单写成什么样；给人看的那一页。
// 只给 tests/ 里的程序用（在 Node 里跑）；src/ 里的程序不要用。

import type { Page } from '@playwright/test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { contentKey } from '../../src/domain/contentKey';
import type { StopScene, TableScene } from '../../src/domain/scene';
import type { StillManifest, StillShape, StillShapeSpec, StillShot } from '../../src/domain/stills';
import { FAMILIES } from '../../src/stage/families';
import { familiesOf } from '../../src/stage/three/kit/families';
import type { StageInsets, StageShot } from '../../src/stage/types';
import { STILL_MAX_BYTES } from '../content/budgetRules';
import { pictureKey } from './pictureKey';
import { PROGRAM_FILES, PROGRAM_FOLDERS, ROUTE_LEVEL_FILES, isProgramPath, programKey, styleFilesIn, tableFiles, type ProgramVersions, type TableUse } from './programKey';

export { STILL_MAX_BYTES };

/** 项目的根目录：这个文件在 tests/support/ 里，往上两层。 */
const ROOT = new URL('../../', import.meta.url);

// ---------------------------------------------------------------- 两种形状各照什么拍

/** 一种形状的拍法：照哪种窗口，左右各多拍多少，像素比，JPEG 的质量从高到低试哪几档。 */
export interface ShapePlan {
  window: [number, number];
  extra: number;
  pixelRatio: number;
  qualities: number[];
}

/**
 * 宽的照 1440 × 900 的电脑窗口，窄的照竖着拿的 768 × 1024 平板（手机不在考虑之内）。沙盘栏多大、四边留多少是到页面上量的，不写在这里。
 * 左右多拍一截：图片的大小是跟着高走的，同样的高、更宽的画面只是两边多看到一些，更宽的栏里也铺得满。
 */
export const SHAPE_PLANS: Record<StillShape, ShapePlan> = {
  wide: { window: [1440, 900], extra: 130, pixelRatio: 1.5, qualities: [82, 78, 74, 70, 66] },
  narrow: { window: [768, 1024], extra: 96, pixelRatio: 2, qualities: [86, 82, 78, 74, 70] },
};

/**
 * 拍的时候镜头用的两个数：要看的点离留出来的边至少多少像素，镜头最多退到写的距离的几倍。
 * 就是 src/stage/three/rig.ts 的 FIT_MARGIN_PX 和 MAX_FIT；记进清单，定格图照同样的数摆。
 * 两边对不对得上由 tests/unit/still-keys.test.ts 查。
 */
export const SHOT_CAMERA = { fitMarginPx: 12, maxFit: 2.5 };

/** 在页面上量到的版面：沙盘的容器多大，四边各留多少（上、右、下、左），沙盘栏的底色（'#rrggbb'）。 */
export interface PaneLayout {
  pane: [number, number];
  insets: [number, number, number, number];
  background: string;
}

/**
 * 照量到的版面定这一种形状怎么拍。
 * 左右多拍的一截照计划里的数；整张图的宽乘上像素比不是整数时再加宽一点（各加半个像素也行），
 * 图片文件的宽才正好是整数个像素。
 */
export function shapeSpec(shape: StillShape, layout: Pick<PaneLayout, 'pane' | 'insets'>): StillShapeSpec {
  const plan = SHAPE_PLANS[shape];
  const [paneWidth, paneHeight] = layout.pane;
  let width = paneWidth + 2 * plan.extra;
  for (let tries = 0; !Number.isInteger(width * plan.pixelRatio); tries++) {
    if (tries > 100) throw new Error(`${shape}：图片的宽乘上像素比 ${plan.pixelRatio} 凑不成整数`);
    width += 1;
  }
  return {
    window: [plan.window[0], plan.window[1]],
    pane: [paneWidth, paneHeight],
    insets: [layout.insets[0], layout.insets[1], layout.insets[2], layout.insets[3]],
    extra: (width - paneWidth) / 2,
    pixelRatio: plan.pixelRatio,
  };
}

/**
 * 到页面上量版面。page 要已经带着 ?stage=fake 打开了有沙盘的那一站，而且沙盘的替身摆好了。
 * 量三样：交给沙盘的容器（.stage-host）多大，页面让沙盘四边各留多少（替身记在 data-fake-insets 上），沙盘栏的底色。
 * 拍定格图的工具和查“版面变没变”的测试用的是这同一个函数：量法不一样，就比不出变没变了。
 */
export async function readPaneLayout(page: Page): Promise<PaneLayout> {
  const raw = await page.evaluate(() => {
    const pane = document.querySelector('.stage-pane');
    const host = document.querySelector('.stage-host');
    const fake = document.querySelector('.fake-stage');
    if (!pane || !host || !fake) return null;
    return { width: host.clientWidth, height: host.clientHeight, insets: fake.getAttribute('data-fake-insets') ?? '', background: getComputedStyle(pane).backgroundColor };
  });
  if (!raw) throw new Error('页面上没有找到沙盘栏、沙盘的容器或沙盘的替身：要带着 ?stage=fake 打开有沙盘的那一站，等它摆好了再量');
  const insets = raw.insets.trim().split(/\s+/).map(Number);
  if (insets.length !== 4 || !insets.every((n) => Number.isFinite(n) && n >= 0)) throw new Error(`四边留的空要是四个数（上 右 下 左），页面上记的是“${raw.insets}”`);
  const background = hexColour(raw.background);
  if (!background) throw new Error(`沙盘栏的底色要是一种不透明的颜色，页面上是“${raw.background}”`);
  return { pane: [raw.width, raw.height], insets: [insets[0], insets[1], insets[2], insets[3]], background };
}

/** 两次量到的版面是不是一样。 */
export function sameLayout(a: PaneLayout, b: PaneLayout): boolean {
  return a.pane.join() === b.pane.join() && a.insets.join() === b.insets.join() && a.background === b.background;
}

/** 拍的时候浏览器的窗口多大（CSS 像素）：沙盘栏的宽加上左右多拍的，高就是沙盘栏的高。 */
export function shotViewport(spec: StillShapeSpec): { width: number; height: number } {
  return { width: spec.pane[0] + 2 * spec.extra, height: spec.pane[1] };
}

/** 拍的时候告诉沙盘四边各留多少：左右把多拍的那一截也算进去，镜头就照真的沙盘栏里留出来的那一块摆。 */
export function shotInsets(spec: StillShapeSpec): StageInsets {
  const [top, right, bottom, left] = spec.insets;
  return { top, right: right + spec.extra, bottom, left: left + spec.extra };
}

/** 这张图的文件名：<站>-<第几节>-wide.jpg 或 <站>-<第几节>-narrow.jpg。section 从 1 数起。 */
export function stillFile(stopId: string, section: number, shape: StillShape): string {
  return `${stopId}-${section}-${shape}.jpg`;
}

// ---------------------------------------------------------------- 从沙盘的读数做出清单里的一项

const round = (value: number, digits: number): number => {
  const scale = 10 ** digits;
  const rounded = Math.round(value * scale) / scale;
  // −0 写进 JSON 是 0，读回来就和原来的不“相等”了：一律写成 0
  return rounded === 0 ? 0 : rounded;
};

/** 清单里一张图不跟文件走的那几项：镜头、退了几倍、要看的点伸多远、指北、比例、题签指着的点。 */
export type StillShotView = Pick<StillShot, 'section' | 'shape' | 'pose' | 'fit' | 'reach' | 'northDeg' | 'pxPerMetre' | 'anchors'>;

/**
 * 从立体沙盘的读数（readout().shot）做出清单里的一项。
 * 题签指着的点从像素换成“占整张图宽、高的几成”，别的窗口大小才好照着算。数都取到够用的几位，清单才不会每次都变一点。
 */
export function stillFromShot(shot: StageShot, shape: StillShape): StillShotView {
  const { width, height } = shot.size;
  const metres = (v: [number, number, number]): [number, number, number] => [round(v[0], 1), round(v[1], 1), round(v[2], 1)];
  return {
    section: shot.section,
    shape,
    pose: { target: metres(shot.pose.target), position: metres(shot.pose.position), fov: round(shot.pose.fov, 3) },
    fit: round(shot.fit, 4),
    reach: [round(shot.reach[0], 1), round(shot.reach[1], 1)],
    northDeg: round(shot.northDeg, 1),
    pxPerMetre: round(shot.pxPerMetre, 6),
    anchors: shot.anchors.map((anchor) => {
      const out: StillShot['anchors'][number] = { id: anchor.id, x: round(anchor.x / width, 5), y: round(anchor.y / height, 5), visible: anchor.visible };
      // 朝外的方向是长度为 1 的一对数：多留几位，取整以后长度还是 1（差不到百万分之一）
      if (anchor.out) out.out = [round(anchor.out[0], 6), round(anchor.out[1], 6)];
      if (anchor.foot) out.foot = [round(anchor.foot.x / width, 5), round(anchor.foot.y / height, 5)];
      return out;
    }),
  };
}

// ---------------------------------------------------------------- 工具自己的几项检查

/**
 * 沙盘给的读数对不对：是这一节的；画面的大小是照着拍的那么大；每条题签一个点，先后和这一节写的一样；
 * 第一条题签（最要紧的）指着的点看得见，而且在留出来的那一块里。返回不对的地方，一处一句；空的就是都对。
 * stripIds 是这一节该摆的题签（src/domain/sceneText.ts 的 stripTexts 给的先后）。
 */
export function checkShot(shot: StageShot, heading: string, stripIds: string[], spec: StillShapeSpec): string[] {
  const problems: string[] = [];
  const size = shotViewport(spec);
  const insets = shotInsets(spec);
  if (shot.section !== heading) problems.push(`沙盘摆着的是“${shot.section}”，不是“${heading}”`);
  if (shot.size.width !== size.width || shot.size.height !== size.height) {
    problems.push(`画面是 ${shot.size.width} × ${shot.size.height}，该是 ${size.width} × ${size.height}`);
  }
  const sides = ['top', 'right', 'bottom', 'left'] as const;
  if (sides.some((side) => shot.insets[side] !== insets[side])) {
    problems.push(`四边留的空是 ${sides.map((side) => shot.insets[side]).join('、')}（上、右、下、左），该是 ${sides.map((side) => insets[side]).join('、')}`);
  }
  if (!(shot.fit > 0) || !(shot.pxPerMetre > 0)) problems.push(`fit（${shot.fit}）和 pxPerMetre（${shot.pxPerMetre}）都要大于 0`);
  const got = shot.anchors.map((anchor) => anchor.id);
  if (got.join('|') !== stripIds.join('|')) problems.push(`题签指着的点是 [${got.join('、')}]，这一节的题签是 [${stripIds.join('、')}]：要一条一个，先后相同`);
  const first = shot.anchors[0];
  if (first) {
    const inside = first.x >= insets.left && first.x <= size.width - insets.right && first.y >= insets.top && first.y <= size.height - insets.bottom;
    if (!first.visible || !inside) problems.push(`第一条题签“${first.id}”指着的点（${first.x.toFixed(0)}, ${first.y.toFixed(0)}）不在画面留出来的那一块里`);
  }
  for (const anchor of shot.anchors) {
    if (![anchor.x, anchor.y].every(Number.isFinite)) problems.push(`题签“${anchor.id}”指着的点不是数`);
  }
  return problems;
}

/** 一张截图的像素（tests/support/png.ts 的 decodePng 读出来的样子）。 */
export interface RawPicture {
  width: number;
  height: number;
  /** 每个点几个字节：3 是红绿蓝，4 是红绿蓝加透明。 */
  channels: number;
  pixels: Uint8Array;
}

/** 把像素理成一个点三个字节（红绿蓝）：截图是不透明的，透明那一个字节不算。 */
function rgbOf(picture: RawPicture): Uint8Array {
  const { width, height, channels, pixels } = picture;
  if (channels !== 3 && channels !== 4) throw new Error(`截图该是彩色的（每个点 3 或 4 个字节），这一张是 ${channels} 个`);
  if (pixels.length !== width * height * channels) throw new Error(`截图的像素数不对：${width} × ${height} × ${channels} 该是 ${width * height * channels} 个字节，实际 ${pixels.length} 个`);
  if (channels === 3) return pixels;
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, o = 0; i < pixels.length; i += 4, o += 3) {
    rgb[o] = pixels[i];
    rgb[o + 1] = pixels[i + 1];
    rgb[o + 2] = pixels[i + 2];
  }
  return rgb;
}

/**
 * 截图的像素的记号（清单里的 raw）：宽、高和每个点的红绿蓝。
 * 画面变没变就看它：差一个像素、差一级，记号就不一样。
 */
export function rawKey(picture: RawPicture): string {
  const rgb = rgbOf(picture);
  const bytes = new Uint8Array(8 + rgb.length);
  new DataView(bytes.buffer).setUint32(0, picture.width);
  new DataView(bytes.buffer).setUint32(4, picture.height);
  bytes.set(rgb, 8);
  return contentKey(bytes);
}

/** 这些像素顺着加出来的一个数。工具用它核对：浏览器里拿去压成 JPEG 的，就是 Node 里算记号的这些像素。 */
export function pixelSum(picture: RawPicture): number {
  const rgb = rgbOf(picture);
  let sum = 0;
  for (let i = 0; i < rgb.length; i++) sum = (Math.imul(sum, 31) + rgb[i]) >>> 0;
  return sum;
}

/** 整张图是不是一种颜色（沙盘没画出来，只剩底色）。每一级都差不到 3 算同一种。 */
export function flatColour(picture: RawPicture): boolean {
  const rgb = rgbOf(picture);
  for (let i = 3; i < rgb.length; i++) {
    if (Math.abs(rgb[i] - rgb[i % 3]) > 2) return false;
  }
  return true;
}

/**
 * 这张图的文件要不要留着不动。只有三样都对才留：清单里有它；这一次截图的像素的记号和清单里记的一样；
 * 文件还在，而且就是清单里记的那一份（fileKey 是磁盘上那个文件的记号，文件不在是 null）。
 * 别的情形一律重新压、重新写，算“变了”。没有“差不多”：冒出来一座二十几像素的小屋也要算变了。
 */
export function keepStill(old: Pick<StillShot, 'raw' | 'key'> | undefined, raw: string, fileKey: string | null): boolean {
  return old !== undefined && fileKey !== null && old.raw === raw && old.key === fileKey;
}

/**
 * 两张图一小块一小块（32 × 32 像素）地比：差得最多的那一块，红绿蓝平均差几级（0 到 255）。两张大小不一样时比不了，是 null。
 * data 是每个点 4 个字节（红、绿、蓝、透明），逐行存——浏览器画布上读出来的就是这个样子。
 * 工具把这个函数原样的字交给浏览器里那一页去跑（新旧两张 JPEG 只有浏览器解得开），所以它不能用到函数外面的任何东西。
 */
export function worstTileOf(a: { width: number; height: number; data: ArrayLike<number> }, b: { width: number; height: number; data: ArrayLike<number> }): number | null {
  if (a.width !== b.width || a.height !== b.height) return null;
  let worst = 0;
  for (let ty = 0; ty < a.height; ty += 32) {
    for (let tx = 0; tx < a.width; tx += 32) {
      let sum = 0;
      let count = 0;
      for (let y = ty; y < ty + 32 && y < a.height; y++) {
        for (let x = tx; x < tx + 32 && x < a.width; x++) {
          const i = (y * a.width + x) * 4;
          sum += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
          count += 3;
        }
      }
      if (count > 0 && sum / count > worst) worst = sum / count;
    }
  }
  return worst;
}

/**
 * 备用的办法，平时不用（tolerance 是 null 时从不这样留）。
 * 这台机器要是连着拍两遍、同一个画面的像素都不一样（画得不重复），“差一个像素就算变了”会让每次都重写所有的图。
 * 那时改成：新旧两张 JPEG 解出来，一小块一小块（32 × 32 像素）地比，差得最多的那一块平均不超过 tolerance 级，
 * 就留着原来的文件。worstTile 是差得最多的那一块平均差几级；比不了（原来没有、大小不一样）是 null，不留。
 */
export function keepWithin(worstTile: number | null, tolerance: number | null): boolean {
  return tolerance !== null && worstTile !== null && worstTile <= tolerance;
}

// ---------------------------------------------------------------- 照什么拍的，旧在哪里

/** 读一个文件的字节。path 相对项目的根目录，用“/”分隔。 */
export function readFile(path: string): Uint8Array {
  return readFileSync(new URL(path, ROOT));
}

export function fileExists(path: string): boolean {
  return existsSync(new URL(path, ROOT));
}

function readText(path: string): string {
  return new TextDecoder().decode(readFile(path));
}

/** 一个文件夹里所有的文件（连子文件夹），路径相对项目的根目录。 */
function filesUnder(folder: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(new URL(folder, ROOT), { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...filesUnder(`${folder}${entry.name}/`));
    else if (entry.isFile()) out.push(`${folder}${entry.name}`);
  }
  return out;
}

/**
 * 算在程序的记号里的文件，都读进来：“路径 → 字节”。各座沙盘的并在一起（共用的，每一种样式的，每一家零件的，全程沙盘才用的）：
 * 哪一座沙盘算哪些，由 tableFiles 照 tableUse 从里面挑。
 */
export function readProgramFiles(): Record<string, Uint8Array> {
  const paths = [...PROGRAM_FOLDERS.flatMap((folder) => filesUnder(folder)), ...PROGRAM_FILES, ...ROUTE_LEVEL_FILES, ...filesUnder('src/domain/')].filter(isProgramPath);
  const files: Record<string, Uint8Array> = {};
  for (const path of paths) {
    if (!fileExists(path)) throw new Error(`算程序的记号要读 ${path}，这个文件不在`);
    files[path] = readFile(path);
  }
  return files;
}

/**
 * 这座沙盘用的是什么：场景文件里写的样式；场景里写到了哪几家零件的东西；是不是全程沙盘。
 * 哪几家，和沙盘程序决定下载哪几家是同一个函数、同一张登记表（src/stage/three/kit/families.ts 的 familiesOf，src/stage/families.ts）；
 * 全程沙盘上没有摆件和点缀，沙盘程序不给它取哪一家（src/stage/three/view.ts），这里也是一家没有。
 */
export function tableUse(scene: TableScene): TableUse {
  const route = scene.level === 'route';
  return { style: scene.style, route, families: route ? [] : familiesOf(scene as StopScene, FAMILIES).map((entry) => entry.name) };
}

/**
 * 这座沙盘的记号要算的文件：“路径 → 字节”。scene 是它的场景文件解析出来的东西，name 是出了错时怎么称呼它（“人物/场景文件的名字”）。
 * 场景里写的样式要是一个自己的文件也找不到（样式的名字写错了，或者算记号的程序还不认得这种样式），不悄悄算出一个没有样式的记号：停下来说清楚。
 */
export function readTableFiles(scene: TableScene, name = '这座沙盘'): Record<string, Uint8Array> {
  const use = tableUse(scene);
  const files = tableFiles(readProgramFiles(), use);
  if (styleFilesIn(Object.keys(files), use.style).length === 0) {
    throw new Error(
      `${name}的场景文件里写的样式是“${use.style}”，算记号的时候没有找到这种样式自己的文件，记号算不出来。` +
        '一种样式要在样式的登记表（src/stage/styles.ts）里有它的一行，它的文件放在 src/stage/three/style/ 里以它的名字命名的子文件夹里（文件夹的名字和登记的名字一个字不差）；' +
        '场景里能写哪几种样式，npm run validate 会说。',
    );
  }
  return files;
}

/** package.json 里写的 three 和 Playwright 的版本。 */
export function programVersions(): ProgramVersions {
  const pack = JSON.parse(readText('package.json')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const three = pack.dependencies?.three;
  const playwright = pack.devDependencies?.['@playwright/test'];
  if (!three || !playwright) throw new Error('package.json 里没有找到 three 或 @playwright/test 的版本');
  return { three, playwright };
}

/** 先画好的地面的记号：清单里两份像素的记号接起来再算一遍。这座沙盘没有先画好的地面（地面是打开时现画的）时，是空字的记号。 */
export function groundKeyOf(baked: { pixels?: { colour?: string; fields?: string } } | null): string {
  return contentKey(baked ? `${baked.pixels?.colour ?? ''}${baked.pixels?.fields ?? ''}` : '');
}

/**
 * tokens.css 里沙盘栏的底色（--color-paper-sunk），小写的 '#rrggbb'。找不到是 null。
 * 写了 figureId：这位人物自己有一块的（选择符里带着 [data-figure='<人物>']，落在 .stage-pane 上——tokens.css 里说的再添一位人物时的写法），
 * 读他那一块里的；没有他那一块、或者那一块里没有写这个颜色，读文件里的头一处（现在是苏轼的那一块，没有写人物）。不写 figureId 也是读头一处。
 * 头一处：去掉注释、去掉写着人物的那几块（每个选择符里都带着 [data-figure…] 的）以后，文件里头一个写着这个颜色的地方。
 * 别的人物的一块写在前面，也不会被当成头一处；注释里举的例子不算。苏轼读到的还是原来那个颜色。
 */
export function paneColour(tokensCss: string, figureId?: string): string | null {
  const css = tokensCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const own = figureId === undefined ? null : figurePaneColour(css, figureId);
  if (own) return own;
  const unnamed = css.replace(/([^{}]*)\{([^{}]*)\}/g, (block: string, selectors: string) => (selectors.split(',').every((selector) => selector.includes('[data-figure')) ? '' : block));
  const m = /--color-paper-sunk:\s*(#[0-9a-fA-F]{6})\s*;/.exec(unnamed);
  return m ? m[1].toLowerCase() : null;
}

/**
 * 这位人物自己那一块里写的沙盘栏的底色；没有这一块、里面没有写，是 null。css 是去掉了注释的样式表。
 * 那一块要落在沙盘栏上：选择符的最后一截就是 .stage-pane。写在沙盘栏里面的东西上的（[data-figure='…'] .stage-pane .strip）不是栏的底色。
 */
function figurePaneColour(css: string, figureId: string): string | null {
  const marks = [`[data-figure='${figureId}']`, `[data-figure="${figureId}"]`];
  const onPane = (selector: string): boolean => /\.stage-pane(?![\w-])/.test(selector.split(/[\s>+~]+/).pop() ?? '');
  for (const block of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selectors = block[1].split(',').map((selector) => selector.trim());
    if (!selectors.some((selector) => marks.some((mark) => selector.includes(mark)) && onPane(selector))) continue;
    const m = /--color-paper-sunk:\s*(#[0-9a-fA-F]{6})\s*;/.exec(block[2]);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/** 浏览器给的颜色（'rgb(235, 227, 211)'）写成 '#ebe3d3'。不是不透明的 rgb 时是 null。 */
export function hexColour(css: string): string | null {
  const m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(css.trim());
  if (!m) return null;
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * 一座沙盘的定格图是照什么拍的：四个记号，加上沙盘栏的底色。
 * route 写 true：这是一座全程沙盘（“旧在哪里”的那句话里要说到全程沙盘才用的那一块）。
 */
export interface MadeFromNow {
  madeFrom: StillManifest['madeFrom'];
  background: string | null;
  route?: boolean;
}

/** 照磁盘上现在的文件算：这座沙盘的定格图该是照什么拍的。工具拍的时候记下它，测试拿它和清单比。 */
export function madeFromNow(figureId: string, stopId: string): MadeFromNow {
  const dir = `content/figures/${figureId}`;
  const scene = JSON.parse(readText(`${dir}/scenes/${stopId}.json`)) as TableScene;
  const bakedPath = `${dir}/baked/${stopId}.json`;
  const baked = fileExists(bakedPath) ? (JSON.parse(readText(bakedPath)) as { pixels?: { colour?: string; fields?: string } }) : null;
  return {
    madeFrom: {
      scene: pictureKey(scene),
      terrain: contentKey(readFile(`${dir}/scenes/${scene.terrain.file}`)),
      ground: groundKeyOf(baked),
      // 这座沙盘用得着的那些文件：共用的，它的样式的，它用到的那几家零件的；全程沙盘另加它才用的那一块
      program: programKey(readTableFiles(scene, `${figureId}/${stopId}`), programVersions()),
    },
    background: paneColour(readText('src/styles/tokens.css'), figureId),
    route: scene.level === 'route',
  };
}

// 不带 STILLS_OUT 的 npm run stills 只是试拍（存到 tests/shots/stills-trial/），不动仓库里的图：这里说的是真的往仓库里拍的那一条。
const COMMAND = '运行 STILLS_OUT=content/figures npm run stills（见 README），再提交。';

/** 五样东西各是什么变了（接在“某某的定格图是旧的：”后面）。沙盘程序的那一句，全程沙盘另有一种说法（见 programChanged）。 */
const WHAT_CHANGED = {
  scene: '场景文件里决定画面的部分改过了（镜头、题签指的点、范围、地形、水、摆件、点缀）',
  terrain: '地形文件换过了',
  ground: '先画好的地面重做过了',
  program: '沙盘程序改过了（各座沙盘共用的部分，这座沙盘用的样式，它用到的那几家零件，拍照的工具，或者 three、Playwright 的版本）',
  background: '沙盘栏的底色改了（src/styles/tokens.css 里的 --color-paper-sunk）',
} as const;

/**
 * 沙盘程序的记号对不上时说的那半句。记号是一座沙盘一个，括号里说的是这座沙盘的记号里算了哪几样
 * （各是哪些文件，见 tests/support/programKey.ts）。全程沙盘不用哪一家零件，另有它才用的那一块。
 */
function programChanged(route: boolean): string {
  return route ? '沙盘程序改过了（各座沙盘共用的部分，这座沙盘用的样式，全程沙盘才用的那一块，拍照的工具，或者 three、Playwright 的版本）' : WHAT_CHANGED.program;
}

/**
 * 存着的定格图旧在哪里：一样一句话，说出是什么变了、该跑哪条命令。空的就是不旧。
 * name 是这一站的名字（如“徐州”）。manifest 是 null（这座沙盘还没有定格图）时不算旧：“每座沙盘都得有”是校验规则 18 的事。
 */
export function staleStills(name: string, manifest: { madeFrom?: Partial<StillManifest['madeFrom']>; made?: { background?: string } } | null, now: MadeFromNow): string[] {
  if (!manifest) return [];
  if (!manifest.madeFrom || !manifest.made) return [`${name}的定格图的清单不完整（少了 madeFrom 或 made）。${COMMAND}`];
  const head = `${name}的定格图是旧的：`;
  const reasons: string[] = [];
  for (const key of ['scene', 'terrain', 'ground', 'program'] as const) {
    if (manifest.madeFrom[key] !== now.madeFrom[key]) reasons.push(`${head}${key === 'program' ? programChanged(now.route === true) : WHAT_CHANGED[key]}。${COMMAND}`);
  }
  if (manifest.made.background?.toLowerCase() !== now.background) reasons.push(`${head}${WHAT_CHANGED.background}。${COMMAND}`);
  return reasons;
}

// ---------------------------------------------------------------- 清单写成什么样

/**
 * 清单写进文件的字：字段的先后固定（不管传进来的东西是怎么拼的），缩进两格，LF 换行，末尾一个换行。
 * 同样的清单每次写出同样的字节。
 */
export function manifestText(manifest: StillManifest): string {
  const shape = (spec: StillShapeSpec): StillShapeSpec => ({ window: spec.window, pane: spec.pane, insets: spec.insets, extra: spec.extra, pixelRatio: spec.pixelRatio });
  const ordered: StillManifest = {
    tool: manifest.tool,
    made: {
      tier: manifest.made.tier,
      three: manifest.made.three,
      background: manifest.made.background,
      fitMarginPx: manifest.made.fitMarginPx,
      maxFit: manifest.made.maxFit,
    },
    madeFrom: { scene: manifest.madeFrom.scene, terrain: manifest.madeFrom.terrain, ground: manifest.madeFrom.ground, program: manifest.madeFrom.program },
    shapes: { wide: shape(manifest.shapes.wide), narrow: shape(manifest.shapes.narrow) },
    stills: manifest.stills.map((still) => ({
      section: still.section,
      shape: still.shape,
      file: still.file,
      width: still.width,
      height: still.height,
      bytes: still.bytes,
      quality: still.quality,
      key: still.key,
      raw: still.raw,
      pose: { target: still.pose.target, position: still.pose.position, fov: still.pose.fov },
      fit: still.fit,
      reach: still.reach,
      northDeg: still.northDeg,
      pxPerMetre: still.pxPerMetre,
      anchors: still.anchors.map((anchor) => {
        const out: StillShot['anchors'][number] = { id: anchor.id, x: anchor.x, y: anchor.y, visible: anchor.visible };
        if (anchor.out) out.out = anchor.out;
        if (anchor.foot) out.foot = anchor.foot;
        return out;
      }),
    })),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

// ---------------------------------------------------------------- 给人看的那一页

/** 给人看的那一页上的一张图。 */
export interface ReviewEntry {
  still: StillShot;
  /** 图片文件相对那一页的路径。 */
  src: string;
  /** 这一次重新写过。 */
  changed: boolean;
  /**
   * 和原来那张比，差得最多的一小块（32 × 32 像素）平均差几级（0 到 255）。原来没有这张图，或者没有比，是 null。
   * 没有重新写却有这个数：是照备用的办法留下来的（见 keepWithin），这一次拍的和留着的那一张差这么多。
   */
  worstTile: number | null;
  /** 题签上写的字（当时的名字），按 still.anchors 的先后。 */
  labels: string[];
}

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 从一个文件夹到一个文件的相对路径。两个都相对项目的根目录，用“/”分隔。 */
export function relativePath(fromDir: string, toFile: string): string {
  const from = fromDir.split('/').filter(Boolean);
  const to = toFile.split('/').filter(Boolean);
  let same = 0;
  while (same < from.length && same < to.length - 1 && from[same] === to[same]) same++;
  return [...from.slice(same).map(() => '..'), ...to.slice(same)].join('/');
}

/** 一张图这一次怎么样了，一句话：没有变；变了（和原来差多少）；或者照备用的办法留着原来那一张。 */
export function reviewWord(entry: Pick<ReviewEntry, 'changed' | 'worstTile'>): string {
  if (entry.changed) return entry.worstTile === null ? '变了：新拍的，原来没有这一张' : `变了：和原来那一张比，差得最多的一小块平均差 ${entry.worstTile.toFixed(1)} 级`;
  return entry.worstTile === null ? '没有变' : `留着原来那一张：这一次拍的和它比，差得最多的一小块平均只差 ${entry.worstTile.toFixed(1)} 级`;
}

/**
 * 一座沙盘的定格图拼成一页（不进仓库）：每一小节宽、窄各一张，这一次画面变了的标出来，人只用看变了的。
 * 图上的小点是清单里记的题签指着的点（页面上题签就照它摆），旁边是题签上的字：点没落在它说的东西上，就是记错了。
 */
export function reviewPage(title: string, background: string, entries: ReviewEntry[]): string {
  const changed = entries.filter((entry) => entry.changed).length;
  const figures = entries.map((entry) => {
    const { still } = entry;
    const dots = still.anchors
      .map((anchor, i) => {
        const label = escapeHtml(entry.labels[i] ?? anchor.id);
        return `<span class="dot${anchor.visible ? '' : ' unseen'}" style="left:${(anchor.x * 100).toFixed(2)}%;top:${(anchor.y * 100).toFixed(2)}%"><i>${label}</i></span>`;
      })
      .join('');
    const what = reviewWord(entry);
    return [
      `<figure class="${entry.changed ? 'changed' : 'same'}">`,
      `<div class="picture" style="background:${escapeHtml(background)}"><img src="${escapeHtml(entry.src)}" alt="" width="${still.width}" height="${still.height}">${dots}</div>`,
      `<figcaption><b>${escapeHtml(still.section)}</b>，${still.shape === 'wide' ? '宽的' : '窄的'}（${still.width} × ${still.height}）。${what}。`,
      `文件 ${escapeHtml(still.file)}，${(still.bytes / 1024).toFixed(0)} KB，质量 ${still.quality}。</figcaption>`,
      '</figure>',
    ].join('\n');
  });
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}的定格图</title>`,
    '<style>',
    'body { margin: 16px; font: 14px/1.6 system-ui, "PingFang SC", "Microsoft YaHei", sans-serif; color: #2a2520; background: #f5efe3; }',
    'figure { margin: 0 0 24px; padding: 8px; border: 2px solid #d6cab4; }',
    'figure.changed { border-color: #8f2d1c; }',
    '.picture { position: relative; max-width: 1200px; }',
    '.picture img { display: block; width: 100%; height: auto; }',
    '.dot { position: absolute; width: 8px; height: 8px; margin: -4px 0 0 -4px; border-radius: 50%; background: #8f2d1c; box-shadow: 0 0 0 2px #fffaf2; }',
    '.dot.unseen { background: #5e5548; }',
    '.dot i { position: absolute; left: 12px; top: -8px; padding: 0 4px; font-style: normal; white-space: nowrap; background: rgba(255, 250, 242, 0.85); }',
    '</style>',
    '</head>',
    '<body>',
    `<h1>${escapeHtml(title)}的定格图</h1>`,
    `<p>一共 ${entries.length} 张，这一次画面变了的 ${changed} 张（红框）。图上没有字：页面上的题签照图上小点的位置摆，这里把题签上的字写在点的旁边，供人核对。</p>`,
    ...figures,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

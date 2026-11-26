// 题签摆在画面的哪里（src/stage/overlay/placeStrips.ts），和题签层怎么把它们放到页面上（strips.ts）。
// 前一半是纯函数，后一半用一个很小的假页面；都不用浏览器。真的沙盘、真的镜头上摆不摆得下，在 tests/stage/scene-strips.test.ts。

import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import type { NamesMode, RouteSection, SceneSection, SceneStrip, TableScene } from '../../src/domain/scene';
import type { FrameCoords } from '../../src/domain/sceneGeo';
import type { GroundSamplers } from '../../src/stage/ground/types';
import { mountStrips, placeStrips, sideOfSlot } from '../../src/stage/overlay';
import type { StripInput, StripPlacement, StripSpec } from '../../src/stage/overlay';
import { PIECE_NAME, aroundPiece } from '../../src/stage/overlay/placeAround';
import { centreShift, equivalentDistance, placeCamera, screenAnchors } from '../../src/stage/three/rig';
import { styleFor } from '../stage/support/styles';
import type { StageInsets } from '../../src/stage/types';
import { realRouteScene, realScene, realSceneKeys } from '../stage/support/realScenes';
import { HOME_PANES, STANDARD_PANES } from '../stage/support/standardPanes';
import { routeSectionStrips, sectionStrips } from '../stage/support/stripSizes';
import { namesIn, readBytes } from '../support/readBytes';
import { readCss } from '../support/sourceScan';

const SIZE = { width: 800, height: 600 };
const NO_INSETS: StageInsets = { top: 0, right: 0, bottom: 0, left: 0 };
/** 一条竖写的题签：窄而高。 */
const W = 30;
const H = 90;
/** 这几个数和 placeStrips.ts 里的一样：离留出来的边至少 4，两条题签之间至少 4，每一点周围半边长 6 的方块不压，800 宽的画面上离那一点 26。 */
const MARGIN = 4;
const GUTTER = 4;
const DOT = 6;
const GAP = 26;

type Side = 'above' | 'below' | 'left' | 'right';
type Anchor = StripInput['anchors'][number];
type Strip = StripInput['strips'][number];

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function input(parts: Partial<StripInput> = {}): StripInput {
  return {
    strips: [{ id: 'a', w: W, h: H, rank: 0 }],
    anchors: [{ id: 'a', x: 400, y: 300, visible: true }],
    size: SIZE,
    insets: NO_INSETS,
    ...parts,
  };
}

/** 几条一样大的题签，要紧的先后就是写的先后。 */
function strips(...ids: string[]): Strip[] {
  return ids.map((id, rank) => ({ id, w: W, h: H, rank }));
}

function at(id: string, x: number, y: number, more: Partial<Anchor> = {}): Anchor {
  return { id, x, y, visible: true, ...more };
}

function one(side?: Side, where: { x: number; y: number } = { x: 400, y: 300 }, parts: Partial<StripInput> = {}): StripPlacement {
  return placeStrips(input({ strips: [{ id: 'a', w: W, h: H, rank: 0, side }], anchors: [{ id: 'a', ...where, visible: true }], ...parts }))[0];
}

/** 题签占的那一块。 */
function box(p: StripPlacement, w = W, h = H): Box {
  return { left: p.x - w / 2, right: p.x + w / 2, top: p.y - h / 2, bottom: p.y + h / 2 };
}

/** 一点周围不让压的那一块。 */
function dotBox(a: { x: number; y: number }): Box {
  return { left: a.x - DOT, right: a.x + DOT, top: a.y - DOT, bottom: a.y + DOT };
}

function grown(b: Box, by: number): Box {
  return { left: b.left - by, right: b.right + by, top: b.top - by, bottom: b.bottom + by };
}

/** 两块有没有叠在一起。只是边挨着边不算。 */
function overlap(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** 一条线段有没有从一块里面穿过去：沿线取很多点，看有没有落在里面的（和程序里的算法不是一个写法，互相对一对）。 */
function passesThrough(x1: number, y1: number, x2: number, y2: number, b: Box): boolean {
  const steps = Math.max(8, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 4));
  for (let i = 0; i <= steps; i++) {
    const x = x1 + ((x2 - x1) * i) / steps;
    const y = y1 + ((y2 - y1) * i) / steps;
    if (x > b.left + 0.01 && x < b.right - 0.01 && y > b.top + 0.01 && y < b.bottom - 0.01) return true;
  }
  return false;
}

/** 留出来的那一块。 */
function freeArea(given: StripInput): Box {
  const { size, insets } = given;
  return { left: insets.left + MARGIN, top: insets.top + MARGIN, right: size.width - insets.right - MARGIN, bottom: size.height - insets.bottom - MARGIN };
}

/**
 * 一份结果里不该有的事，一条一句；没有就是空的。查的是：
 * 结果和题签一一对上；摆出来的不出留出来的那一块；两条之间隔开；不压任何一条看得见的题签指的那一点；
 * 不压自己那一点到脚下的那一段；引线不穿过别的题签；远处的题签不摆在朝着沙盘里面的那一边；没摆的写了缘故。
 */
function faults(given: StripInput, result: StripPlacement[]): string[] {
  const found: string[] = [];
  const free = freeArea(given);
  const anchorOf = (id: string): Anchor | undefined => given.anchors.find((a) => a.id === id);
  const seen = (a: Anchor | undefined): a is Anchor =>
    a !== undefined && a.visible && a.x >= free.left - 8 && a.x <= free.right + 8 && a.y >= free.top - 8 && a.y <= free.bottom + 8;
  if (result.length !== given.strips.length) return [`结果有 ${result.length} 条，题签有 ${given.strips.length} 条`];
  const shown: { id: string; box: Box; p: StripPlacement }[] = [];
  result.forEach((p, i) => {
    const strip = given.strips[i];
    if (p.id !== strip.id) found.push(`第 ${i + 1} 条是 ${p.id}，应该是 ${strip.id}`);
    const anchor = anchorOf(strip.id);
    if (p.hidden) {
      if (p.leader !== null) found.push(`${p.id} 没摆却有引线`);
      if (p.why !== (seen(anchor) ? 'room' : 'unseen')) found.push(`${p.id} 没摆的缘故写成了 ${p.why}`);
      if (seen(anchor) && (p.x !== anchor.x || p.y !== anchor.y)) found.push(`${p.id} 摆不下，但给的不是那一点的位置`);
      return;
    }
    if (!seen(anchor)) {
      found.push(`${p.id} 那一点看不见，却摆出来了`);
      return;
    }
    const b = box(p, strip.w, strip.h);
    shown.push({ id: p.id, box: b, p });
    if (p.slot === undefined || p.why !== undefined) found.push(`${p.id} 摆出来了，应该有号、没有缘故`);
    if (b.left < free.left || b.right > free.right || b.top < free.top || b.bottom > free.bottom) found.push(`${p.id} 出了留出来的那一块`);
    if (!p.leader) found.push(`${p.id} 没有引线`);
    else if (p.leader[0] !== anchor.x || p.leader[1] !== anchor.y || p.leader[2] < b.left || p.leader[2] > b.right || p.leader[3] < b.top || p.leader[3] > b.bottom) {
      found.push(`${p.id} 的引线不是从那一点连到题签上`);
    }
    if (anchor.foot && passesThrough(anchor.x, anchor.y, anchor.foot.x, anchor.foot.y, grown(b, DOT))) found.push(`${p.id} 压住了它指的那样东西`);
    if (anchor.out && p.slot !== undefined) {
      const side = sideOfSlot(p.slot);
      const along = side === 'above' ? -anchor.out[1] : side === 'below' ? anchor.out[1] : side === 'left' ? -anchor.out[0] : side === 'right' ? anchor.out[0] : null;
      const centre = (p.x - anchor.x) * anchor.out[0] + (p.y - anchor.y) * anchor.out[1];
      if (along !== null ? along <= -0.2 : centre < -1) found.push(`${p.id} 是远处的题签，却摆在朝着沙盘里面的那一边`);
    }
  });
  for (const a of shown) {
    for (const strip of given.strips) {
      const anchor = anchorOf(strip.id);
      if (seen(anchor) && overlap(a.box, dotBox(anchor))) found.push(`${a.id} 压住了 ${strip.id} 指的那一点`);
    }
    for (const b of shown) {
      if (a === b) continue;
      if (a.id < b.id && overlap(grown(a.box, GUTTER), b.box)) found.push(`${a.id} 和 ${b.id} 挨得太近`);
      if (a.p.leader && passesThrough(...a.p.leader, b.box)) found.push(`${a.id} 的引线穿过了 ${b.id}`);
    }
  }
  return found;
}

/** 一串定死的随机数（测试每次跑都一样）。 */
function randomFrom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 随便编一个画面：手机那么大或者宽屏那么大，一到六条题签，有的带脚下的点，有的是远处的，偶尔有一条看不见。 */
function randomScene(rand: () => number): StripInput {
  const narrow = rand() < 0.5;
  const size = narrow ? { width: 390, height: 337 } : { width: 940, height: 900 };
  const insets: StageInsets = narrow ? { top: 54, right: 0, bottom: 95, left: 0 } : { top: 62, right: 0, bottom: 130, left: 0 };
  const count = 1 + Math.floor(rand() * 6);
  // 一半的画面把几个点挤在一小块里
  const crowded = rand() < 0.5;
  const spanX = (size.width - 8) * (crowded ? 0.3 : 1);
  const spanY = (size.height - insets.top - insets.bottom - 8) * (crowded ? 0.4 : 1);
  const fromX = 4 + rand() * (size.width - 8 - spanX);
  const fromY = insets.top + 4 + rand() * (size.height - insets.top - insets.bottom - 8 - spanY);
  const list: Strip[] = [];
  const anchors: Anchor[] = [];
  for (let i = 0; i < count; i++) {
    const chars = 2 + Math.floor(rand() * 5);
    const id = `s${i}`;
    const side = rand() < 0.3 ? (['above', 'below', 'left', 'right'] as const)[Math.floor(rand() * 4)] : undefined;
    list.push({ id, w: narrow ? 24 : 29, h: Math.round(narrow ? 14 + 15.68 * chars : 18 + 19.04 * chars), rank: i, side });
    const anchor: Anchor = { id, x: fromX + rand() * spanX, y: fromY + rand() * spanY, visible: rand() > 0.05 };
    if (rand() < 0.3) anchor.foot = { x: anchor.x + (rand() - 0.5) * 8, y: anchor.y + rand() * 60 };
    if (rand() < 0.2) {
      const angle = rand() * Math.PI * 2;
      anchor.out = [Math.cos(angle), Math.sin(angle)];
    }
    anchors.push(anchor);
  }
  return { strips: list, anchors, size, insets };
}

const leftOut = (result: StripPlacement[]): number => result.filter((p) => p.hidden && p.why === 'room').length;

// ---------------------------------------------------------------- 一条题签

describe('摆在哪一边', () => {
  it('不写哪一边：摆在那一点的正上方，隔开一段；引线从那一点连到题签的下边', () => {
    const p = one();
    expect(p.hidden).toBe(false);
    expect(p.x).toBe(400);
    expect(300 - box(p).bottom).toBe(GAP);
    expect(p.leader).toEqual([400, 300, 400, box(p).bottom]);
    expect(p.why).toBeUndefined();
  });

  it('写了哪一边就摆哪一边，隔开的远近一样', () => {
    const above = one('above');
    const below = one('below');
    const left = one('left');
    const right = one('right');

    expect(above).toEqual(one());

    expect(below.x).toBe(400);
    expect(box(below).top - 300).toBe(GAP);
    expect(below.leader).toEqual([400, 300, 400, box(below).top]);

    expect(left.y).toBe(300);
    expect(400 - box(left).right).toBe(GAP);
    expect(left.leader).toEqual([400, 300, box(left).right, 300]);

    expect(right.y).toBe(300);
    expect(box(right).left - 400).toBe(GAP);
    expect(right.leader).toEqual([400, 300, box(right).left, 300]);
  });

  it('写了 lean（往哪一头偏一格）：题签斜着站在那一点的一角上；那里摆不下，先试同一个位置远一档的，再试正对着的；没有写 side、两样不是一横一竖、远处的题签，都和没写一样', () => {
    const leaning = (side: Side | undefined, lean: Side, parts: Partial<StripInput> = {}, anchor: Partial<Anchor> = {}): StripPlacement =>
      placeStrips(input({ strips: [{ id: 'a', w: W, h: H, rank: 0, side, lean }], anchors: [at('a', 400, 300, anchor)], ...parts }))[0];
    const stepAcross = (W + GUTTER) / 2;
    const stepAlong = H / 3;

    // 上边往左偏一格：题签整条在那一点的上面，右边让开那一点两个像素；引线从那一点连到题签的右下角
    const upLeft = leaning('above', 'left');
    expect(sideOfSlot(upLeft.slot!)).toBe('above');
    expect(upLeft.x).toBe(400 - stepAcross);
    expect(300 - box(upLeft).bottom).toBe(GAP);
    expect(box(upLeft).right).toBe(400 - GUTTER / 2);
    expect(upLeft.leader).toEqual([400, 300, box(upLeft).right, box(upLeft).bottom]);
    // 四边、两头都一样：往右、往下是加
    expect(leaning('above', 'right').x).toBe(400 + stepAcross);
    expect(leaning('below', 'left').x).toBe(400 - stepAcross);
    expect(box(leaning('below', 'left')).top - 300).toBe(GAP);
    expect(leaning('left', 'above').y).toBe(300 - stepAlong);
    expect(400 - box(leaning('left', 'above')).right).toBe(GAP);
    expect(leaning('right', 'below').y).toBe(300 + stepAlong);
    // 号认的是位置，不认先后：上边、最近的一档、往左一格是 2 号（左右挪的几格依次是 0、右 1、左 1、右 2、左 2……），写不写 lean 都是它
    expect(upLeft.slot).toBe(2);
    expect(leaning('above', 'right').slot).toBe(1);
    // 照上一次的结果再摆一遍，还在原处
    const again = placeStrips(input({ strips: [{ id: 'a', w: W, h: H, rank: 0, side: 'above', lean: 'left' }], anchors: [at('a', 400, 300)] }), [upLeft])[0];
    expect(again).toEqual(upLeft);

    // 偏一格的位置上有别的题签指的点：先试同一个位置远一档的（还是偏一格），不回到正对着的
    const blockedNear = placeStrips(
      input({ strips: [{ id: 'a', w: W, h: H, rank: 0, side: 'above', lean: 'left' }, { id: 'b', w: W, h: H, rank: 1 }], anchors: [at('a', 400, 300), at('b', 400 - stepAcross, 300 - GAP - 3)] }),
    )[0];
    expect(blockedNear.x).toBe(400 - stepAcross);
    expect(300 - box(blockedNear).bottom).toBeCloseTo(GAP * 1.7, 0);

    // 和没写一样的三种
    expect(leaning(undefined, 'left')).toEqual(one());
    expect(leaning('above', 'below')).toEqual(one('above'));
    expect(leaning('left', 'right')).toEqual(one('left'));
    const far = placeStrips(input({ strips: [{ id: 'a', w: W, h: H, rank: 0, side: 'above' }], anchors: [at('a', 400, 300, { out: [0, -1] })] }))[0];
    expect(leaning('above', 'left', {}, { out: [0, -1] })).toEqual(far);
  });

  it('写了 lean 的题签，想摆的那一边整边都摆不下（那一点到了画面的边上）：先退到 lean 说的那一边，那一边也摆不下再照原来的先后；没写 lean 的还到原来的那一边', () => {
    const placedAt = (where: { x: number; y: number }, side: Side | undefined, lean?: Side, anchor: Partial<Anchor> = {}): StripPlacement =>
      placeStrips(input({ strips: [{ id: 'a', w: W, h: H, rank: 0, side, lean }], anchors: [at('a', where.x, where.y, anchor)] }))[0];
    const sideOf = (p: StripPlacement): Side | null => sideOfSlot(p.slot ?? -1);
    // 那一点离画面的上边 60：上边摆不下（题签高 90，推回来就压着那一点）
    const top = { x: 400, y: 60 };
    // 没写 lean：照原来的先后，上边以后是右边，正对着那一点，隔开的远近不变
    const plain = placedAt(top, 'above');
    expect(sideOf(plain)).toBe('right');
    expect(box(plain).left - 400).toBe(GAP);
    expect(plain.y).toBe(60);
    expect(plain).toEqual(one('above', top));
    // 写了往左偏：退到左边，也是正对着那一点（偏一格只在想摆的那一边）；号是左边、最近的一档、不挪的那一个
    const fallen = placedAt(top, 'above', 'left');
    expect(sideOf(fallen)).toBe('left');
    expect(400 - box(fallen).right).toBe(GAP);
    expect(fallen.y).toBe(60);
    expect(fallen.slot).toBe(200);
    expect(fallen.leader).toEqual([400, 60, box(fallen).right, 60]);
    // 写了往右偏：退到右边，和没写的摆在同一个位置
    expect(placedAt(top, 'above', 'right')).toEqual(plain);
    // 另外三边一样：下边摆不下退到左、右；左边摆不下退到上、下；右边摆不下退到下
    const bottom = { x: 400, y: 540 };
    expect(sideOf(placedAt(bottom, 'below'))).toBe('above');
    expect(sideOf(placedAt(bottom, 'below', 'left'))).toBe('left');
    expect(sideOf(placedAt(bottom, 'below', 'right'))).toBe('right');
    const leftEdge = { x: 20, y: 300 };
    expect(sideOf(placedAt(leftEdge, 'left'))).toBe('above');
    expect(sideOf(placedAt(leftEdge, 'left', 'above'))).toBe('above');
    expect(sideOf(placedAt(leftEdge, 'left', 'below'))).toBe('below');
    const rightEdge = { x: 780, y: 300 };
    expect(sideOf(placedAt(rightEdge, 'right'))).toBe('above');
    expect(sideOf(placedAt(rightEdge, 'right', 'below'))).toBe('below');
    // lean 说的那一边也摆不下（那一点在左上角）：照原来的先后往下试，和没写的摆在同一个位置
    const corner = { x: 20, y: 60 };
    expect(sideOf(placedAt(corner, 'above'))).toBe('right');
    expect(placedAt(corner, 'above', 'left')).toEqual(placedAt(corner, 'above'));
    // 想摆的那一边摆得下时不退：还是那一角
    expect(sideOf(placedAt({ x: 400, y: 300 }, 'above', 'left'))).toBe('above');
    // 和没写一样的三种：没有写 side、两样不是一横一竖、远处的题签
    expect(placedAt(top, undefined, 'left')).toEqual(one(undefined, top));
    expect(placedAt(top, 'above', 'below')).toEqual(plain);
    expect(placedAt(bottom, 'below', 'above')).toEqual(placedAt(bottom, 'below'));
    expect(placedAt(top, 'above', 'left', { out: [1, 0] })).toEqual(placedAt(top, 'above', undefined, { out: [1, 0] }));
  });

  it('摆出来的每一条都带着号；号说得出摆在哪一边', () => {
    for (const side of ['above', 'below', 'left', 'right'] as const) {
      const p = one(side);
      expect(p.slot).toBeTypeOf('number');
      expect(sideOfSlot(p.slot!)).toBe(side);
    }
    expect(sideOfSlot(1000)).toBeNull();
    expect(sideOfSlot(-1)).toBeNull();
    expect(sideOfSlot(0.5)).toBeNull();
  });

  it('画面窄了，题签离那一点近一些，但不少于一半', () => {
    const wide = 300 - box(one()).bottom;
    const narrow = 300 - box(one(undefined, { x: 200, y: 300 }, { size: { width: 400, height: 600 } })).bottom;
    const tiny = 300 - box(one(undefined, { x: 100, y: 300 }, { size: { width: 200, height: 600 } })).bottom;
    expect(narrow).toBe(wide / 2);
    expect(tiny).toBe(narrow);
  });
});

describe('不出留出来的那一块', () => {
  it('那一点靠着画面的角：题签整条留在画面里，离边至少 4 像素，也不压那一点', () => {
    for (const where of [
      { x: 5, y: 20 },
      { x: 795, y: 20 },
      { x: 5, y: 590 },
      { x: 795, y: 590 },
    ]) {
      const given = input({ anchors: [at('a', where.x, where.y)] });
      const [p] = placeStrips(given);
      expect(p.hidden).toBe(false);
      expect(faults(given, [p])).toEqual([]);
      expect(box(p).left).toBeGreaterThanOrEqual(MARGIN);
      expect(box(p).top).toBeGreaterThanOrEqual(MARGIN);
      expect(box(p).right).toBeLessThanOrEqual(SIZE.width - MARGIN);
      expect(box(p).bottom).toBeLessThanOrEqual(SIZE.height - MARGIN);
    }
  });

  it('不摆进四边留出来的地方', () => {
    const insets = { top: 60, right: 40, bottom: 150, left: 20 };
    for (const where of [
      { x: 30, y: 70 },
      { x: 750, y: 70 },
      { x: 30, y: 440 },
      { x: 750, y: 440 },
      { x: 400, y: 250 },
    ]) {
      for (const side of ['above', 'below', 'left', 'right'] as const) {
        const p = one(side, where, { insets });
        expect(p.hidden).toBe(false);
        const b = box(p);
        expect(b.left).toBeGreaterThanOrEqual(insets.left + MARGIN);
        expect(b.top).toBeGreaterThanOrEqual(insets.top + MARGIN);
        expect(b.right).toBeLessThanOrEqual(SIZE.width - insets.right - MARGIN);
        expect(b.bottom).toBeLessThanOrEqual(SIZE.height - insets.bottom - MARGIN);
      }
    }
  });

  it('引线连到题签上离那一点最近的地方', () => {
    // 那一点在左上角（比留出来的边还靠外一点），题签只能摆在它的右下方：引线连到题签的左上角。
    const p = one('left', { x: 3, y: 3 });
    const b = box(p);
    expect(p.hidden).toBe(false);
    expect(b.left).toBeGreaterThan(3 + DOT);
    expect(b.top).toBe(MARGIN);
    expect(p.leader).toEqual([3, 3, b.left, b.top]);
    // 那一点正对着题签的一边时，引线是平的
    const beside = one('right');
    expect(beside.leader).toEqual([400, 300, box(beside).left, 300]);
  });

  it('想摆的那一边推回来会压住自己指的那一点：换一边，不压上去', () => {
    // 那一点离上边不到一条题签高：摆不到正上方。
    const p = one('above', { x: 400, y: 60 });
    expect(p.hidden).toBe(false);
    expect(overlap(box(p), dotBox({ x: 400, y: 60 }))).toBe(false);
    expect(sideOfSlot(p.slot!)).not.toBe('above');
    expect(p.leader).not.toBeNull();
  });

  it('留出来的地方比题签还小：不摆，说是摆不下，位置是那一点', () => {
    const insets = { top: 260, right: 0, bottom: 260, left: 0 };
    const p = one(undefined, { x: 400, y: 300 }, { insets });
    expect(p).toEqual({ id: 'a', x: 400, y: 300, hidden: true, leader: null, why: 'room' });
  });
});

// ---------------------------------------------------------------- 互相避让

describe('两条指着同一处（T1）', () => {
  const same = (rankA: number, rankB: number): StripInput =>
    input({
      strips: [
        { id: 'a', w: W, h: H, rank: rankA },
        { id: 'b', w: W, h: H, rank: rankB },
      ],
      anchors: [at('a', 400, 300), at('b', 400, 300)],
    });

  it('两条都摆，不叠，中间隔开', () => {
    const given = same(0, 1);
    const [a, b] = placeStrips(given);
    expect(a.hidden).toBe(false);
    expect(b.hidden).toBe(false);
    expect(overlap(grown(box(a), GUTTER), box(b))).toBe(false);
    expect(faults(given, [a, b])).toEqual([]);
  });

  it('要紧的那一条先挑：它在正上方，另一条让开', () => {
    const [a, b] = placeStrips(same(0, 1));
    expect(a).toEqual(one());
    expect(b.slot).not.toBe(a.slot);
  });

  it('看的是 rank，不是写的先后；结果的顺序和传进来的一样', () => {
    const [a, b] = placeStrips(same(1, 0));
    expect(a.id).toBe('a');
    expect(b.id).toBe('b');
    expect({ ...b, id: 'a' }).toEqual(one());
    expect(a.slot).not.toBe(b.slot);
  });

  it('一样要紧时，先写的先挑', () => {
    const [a, b] = placeStrips(same(0, 0));
    expect(a).toEqual(one());
    expect(b.hidden).toBe(false);
  });

  it('挨得很近的六条也都摆得下，互不相压', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const given = input({ strips: strips(...ids), anchors: ids.map((id, i) => at(id, 380 + (i % 3) * 20, 290 + Math.floor(i / 3) * 20)) });
    const result = placeStrips(given);
    expect(result.map((p) => p.hidden)).toEqual([false, false, false, false, false, false]);
    expect(faults(given, result)).toEqual([]);
  });
});

describe('不压任何一点，引线不穿过题签（T2、T3）', () => {
  it('后摆的题签指的那一点，先摆的也不压', () => {
    // b 指的那一点正好在 a 想摆的地方（a 的正上方）。
    const given = input({ strips: strips('a', 'b'), anchors: [at('a', 400, 300), at('b', 400, 230)] });
    const [a, b] = placeStrips(given);
    expect(a.hidden).toBe(false);
    expect(b.hidden).toBe(false);
    expect(overlap(box(a), dotBox({ x: 400, y: 230 }))).toBe(false);
    expect(a).not.toEqual(one());
    expect(faults(given, [a, b])).toEqual([]);
  });

  it('摆不下的那一条指的那一点也不压（那里要画一个圈）', () => {
    // b 太高，哪里也摆不下；它的点在 a 的正上方。
    const given = input({
      strips: [
        { id: 'a', w: W, h: H, rank: 0 },
        { id: 'b', w: W, h: 700, rank: 1 },
      ],
      anchors: [at('a', 400, 300), at('b', 400, 230)],
    });
    const [a, b] = placeStrips(given);
    expect(b).toMatchObject({ hidden: true, why: 'room', x: 400, y: 230 });
    expect(a.hidden).toBe(false);
    expect(overlap(box(a), dotBox({ x: 400, y: 230 }))).toBe(false);
  });

  it('看不见的那一条不占地方，它的点也不用让', () => {
    const given = input({ strips: strips('a', 'b'), anchors: [at('a', 400, 230, { visible: false }), at('b', 400, 300)] });
    const [a, b] = placeStrips(given);
    expect(a).toMatchObject({ hidden: true, why: 'unseen' });
    expect({ ...b, id: 'a' }).toEqual(one());
  });

  it('不压别人的引线', () => {
    // a 摆在右边（场景里这么写的），引线是从 (400, 300) 到 (426, 300) 的一小段。
    // b 很窄，想摆在自己那一点的正下方：那里不碰 a 的题签，也不碰 a 的点，只是正好压在 a 的引线上。
    const narrow: Strip = { id: 'b', w: 10, h: H, rank: 1, side: 'below' };
    const given = input({ strips: [{ id: 'a', w: W, h: H, rank: 0, side: 'right' }, narrow], anchors: [at('a', 400, 300), at('b', 413, 240)] });
    const [a, b] = placeStrips(given);
    expect(a.leader).toEqual([400, 300, 426, 300]);
    expect(b.hidden).toBe(false);
    expect(passesThrough(...a.leader!, box(b, 10))).toBe(false);
    expect(faults(given, [a, b])).toEqual([]);

    // 没有 a 的时候，b 就摆在正下方；那个位置不碰 a 的题签和点，只压着 a 的引线
    const [alone] = placeStrips(input({ strips: [narrow], anchors: [at('b', 413, 240)] }));
    expect(sideOfSlot(alone.slot!)).toBe('below');
    expect(passesThrough(...a.leader!, box(alone, 10))).toBe(true);
    expect(overlap(grown(box(a), GUTTER), box(alone, 10))).toBe(false);
    expect(overlap(box(alone, 10), dotBox({ x: 400, y: 300 }))).toBe(false);
    expect(b).not.toEqual(alone);
  });

  it('自己的引线不从别的题签上穿过去', () => {
    // 留出来的是一条竖带，只比题签宽一点：题签只能摆在点的上边或下边。两条短题签指着同一点，a 摆在上边。
    // a 的上面还空着，够 b 摆（最远的一档正好越过 a）；可那样 b 的引线得从 a 身上穿过去，所以 b 摆到下边。
    const column = { width: 44, height: 600 };
    const short = (id: string, rank: number): Strip => ({ id, w: 30, h: 30, rank });
    const given = input({ size: column, strips: [short('a', 0), short('b', 1)], anchors: [at('a', 22, 300), at('b', 22, 300)] });
    const [a, b] = placeStrips(given);
    expect(box(a, 30, 30).bottom).toBe(300 - GAP / 2);
    expect(b.hidden).toBe(false);
    expect(box(b, 30, 30).top).toBe(300 + GAP / 2);
    expect(passesThrough(...b.leader!, box(a, 30, 30))).toBe(false);
    expect(faults(given, [a, b])).toEqual([]);
    // a 上面确实有地方：一条题签自己摆的话，最远的一档在 a 的上面，中间还隔得开
    const beyond = { left: 7, right: 37, top: 300 - 3.8 * (GAP / 2) - 30, bottom: 300 - 3.8 * (GAP / 2) };
    expect(overlap(grown(box(a, 30, 30), GUTTER), beyond)).toBe(false);
  });

  it('随便编的四百个画面：不出界，不相压，不压任何一点，不压自己指的东西，引线不穿过题签，远处的不朝里摆', () => {
    const rand = randomFrom(20261119);
    let shown = 0;
    let hidden = 0;
    for (let i = 0; i < 400; i++) {
      const given = randomScene(rand);
      const result = placeStrips(given);
      expect(faults(given, result), `第 ${i + 1} 个画面`).toEqual([]);
      shown += result.filter((p) => !p.hidden).length;
      hidden += leftOut(result);
    }
    // 这一项不是空转的：大多数摆下了，也确实有摆不下的。
    expect(shown).toBeGreaterThan(900);
    expect(hidden).toBeGreaterThan(0);
  });
});

describe('一条摆不下时，回头挪一条已经摆好的', () => {
  // 留出来的是一条横带，只比题签高一点：题签只能摆在点的左边或右边。
  const band = { width: 800, height: 108 };
  const given = input({ size: band, strips: strips('a', 'b'), anchors: [at('a', 700, 54), at('b', 780, 54)] });

  it('a 自己先挑会堵死 b；挪开 a，两条都摆得下', () => {
    const alone = placeStrips(input({ size: band, strips: strips('a'), anchors: [at('a', 700, 54)] }))[0];
    // 只有 a 时它摆在右边，正好占了 b 唯一能摆的地方（b 靠着右边，只能往左摆）。
    expect(box(alone).left).toBe(700 + GAP);

    const [a, b] = placeStrips(given);
    expect(a.hidden).toBe(false);
    expect(b.hidden).toBe(false);
    expect(box(a).right).toBe(700 - GAP);
    expect(box(b).right).toBe(780 - GAP);
    expect(faults(given, [a, b])).toEqual([]);
  });
});

describe('四边都摆不下时，绕着那一点一圈一圈往外找', () => {
  it('找得到空位就摆在那里；这样的位置不算哪一边', () => {
    // 画面很小。a 在它那一点的正上方；b 的点靠着左边，四边的位置不是出界压了自己的点，就是碰着 a。
    const given = input({
      size: { width: 160, height: 150 },
      strips: [
        { id: 'a', w: 30, h: 60, rank: 0 },
        { id: 'b', w: 30, h: 80, rank: 1 },
      ],
      anchors: [at('a', 80, 80), at('b', 30, 80)],
    });
    const [a, b] = placeStrips(given);
    expect(a.slot).toBe(0);
    expect(b.hidden).toBe(false);
    expect(b.slot).toBeGreaterThanOrEqual(1000);
    expect(sideOfSlot(b.slot!)).toBeNull();
    expect(faults(given, [a, b])).toEqual([]);
    // 再摆一遍还在那里；那一点挪一点点也跟着走
    expect(placeStrips(given, [a, b])).toEqual([a, b]);
    const nudged = placeStrips({ ...given, anchors: [at('a', 80, 80), at('b', 31, 81)] }, [a, b]);
    expect(nudged[1].slot).toBe(b.slot);
  });
});

// ---------------------------------------------------------------- 远处的题签，脚下的一段

describe('远处的题签朝沙盘外面摆（T4）', () => {
  const far = (out: [number, number], where = { x: 400, y: 300 }, parts: Partial<StripInput> = {}, side?: Side): StripPlacement =>
    placeStrips(input({ strips: [{ id: 'a', w: W, h: H, rank: 0, side }], anchors: [at('a', where.x, where.y, { out })], ...parts }))[0];

  it('地方够时摆在最朝外的那一边；场景里写的哪一边不管用', () => {
    expect(sideOfSlot(far([0, -1], undefined, {}, 'below').slot!)).toBe('above');
    expect(sideOfSlot(far([0, 1], undefined, {}, 'above').slot!)).toBe('below');
    expect(sideOfSlot(far([1, 0], undefined, {}, 'left').slot!)).toBe('right');
    expect(sideOfSlot(far([-1, 0], undefined, {}, 'right').slot!)).toBe('left');
  });

  it('十六个方向：题签都在那一点朝外的一边', () => {
    for (let k = 0; k < 16; k++) {
      const angle = (k / 16) * Math.PI * 2 + 0.1;
      const out: [number, number] = [Math.cos(angle), Math.sin(angle)];
      const p = far(out);
      expect(p.hidden).toBe(false);
      expect((p.x - 400) * out[0] + (p.y - 300) * out[1], `方向 ${k}`).toBeGreaterThan(GAP * 0.7);
    }
  });

  it('最朝外的那一边摆不下：摆在旁边，不摆到朝里的一边', () => {
    // 远处在画面上方，那一点离上边很近：正上方摆不下。
    const p = far([0, -1], { x: 400, y: 40 });
    expect(p.hidden).toBe(false);
    expect(['left', 'right']).toContain(sideOfSlot(p.slot!));
    // 同一个位置，不是远处的题签会摆到下边去。
    expect(sideOfSlot(one('below', { x: 400, y: 40 }).slot!)).toBe('below');
  });

  it('只剩朝里的一边有地方：不摆，画一个圈', () => {
    // 画面很窄，左右都摆不开；远处在上方，上边又摆不下。
    const narrow = { width: 60, height: 400 };
    const p = far([0, -1], { x: 30, y: 60 }, { size: narrow });
    expect(p).toMatchObject({ hidden: true, why: 'room', x: 30, y: 60 });
    // 不是远处的，同一个位置摆在下边。
    const near = one(undefined, { x: 30, y: 60 }, { size: narrow });
    expect(near.hidden).toBe(false);
    expect(box(near).top).toBeGreaterThan(60);
  });

  it('朝外的方向写得不成方向（长度是 0）：当作没有写', () => {
    expect(far([0, 0], undefined, {}, 'below')).toEqual(one('below'));
  });
});

describe('不压它指的那样东西（T5）', () => {
  it('从那一点到脚下的一段，题签不压：想摆在下边的改摆别处', () => {
    const foot = { x: 400, y: 360 };
    const given = input({ strips: [{ id: 'a', w: W, h: H, rank: 0, side: 'below' }], anchors: [at('a', 400, 300, { foot })] });
    const [p] = placeStrips(given);
    expect(p.hidden).toBe(false);
    expect(passesThrough(400, 300, foot.x, foot.y, grown(box(p), DOT))).toBe(false);
    expect(faults(given, [p])).toEqual([]);
    // 没有脚下的点时，它就摆在正下方（压着那一段）。
    const plain = one('below');
    expect(passesThrough(400, 300, foot.x, foot.y, box(plain))).toBe(true);
    expect(p).not.toEqual(plain);
  });

  it('脚下的点在旁边（东西是斜着的）：也让开', () => {
    const foot = { x: 450, y: 300 };
    const given = input({ strips: [{ id: 'a', w: W, h: H, rank: 0, side: 'right' }], anchors: [at('a', 400, 300, { foot })] });
    const [p] = placeStrips(given);
    expect(p.hidden).toBe(false);
    expect(faults(given, [p])).toEqual([]);
    expect(sideOfSlot(p.slot!)).not.toBe('right');
  });

  it('脚下的点就是那一点自己：和没有写一样', () => {
    expect(placeStrips(input({ anchors: [at('a', 400, 300, { foot: { x: 400, y: 300 } })] }))[0]).toEqual(one());
  });
});

// ---------------------------------------------------------------- 上一次的结果

describe('那一点挪一点点，题签不换地方（T6）', () => {
  // 那一点离上边不够一条题签高，题签摆在右边。
  const first = input({ anchors: [at('a', 400, 99)] });
  const prev = placeStrips(first);

  it('挪 3 像素，朝哪边挪都还在原来的号上', () => {
    expect(sideOfSlot(prev[0].slot!)).toBe('right');
    for (const [dx, dy] of [
      [3, 0],
      [-3, 0],
      [0, 3],
      [0, -3],
      [2, 2],
      [-2, 2],
      [2, -2],
      [-2, -2],
    ]) {
      const [p] = placeStrips(input({ anchors: [at('a', 400 + dx, 99 + dy)] }), prev);
      expect(p.slot, `挪 (${dx}, ${dy})`).toBe(prev[0].slot);
      // 题签跟着那一点走：相对那一点的位置没有变
      expect(p.x - (400 + dx)).toBe(prev[0].x - 400);
      expect(p.y - (99 + dy)).toBe(prev[0].y - 99);
    }
  });

  it('要是不看上一次，往下挪 3 像素它就跳到上边去了', () => {
    const [p] = placeStrips(input({ anchors: [at('a', 400, 102)] }));
    expect(sideOfSlot(p.slot!)).toBe('above');
  });

  it('几条挤在一起的，各挪一点点，一条也不换号', () => {
    const rand = randomFrom(7);
    let checked = 0;
    for (let i = 0; i < 60; i++) {
      const given = randomScene(rand);
      const before = placeStrips(given);
      const moved: StripInput = {
        ...given,
        anchors: given.anchors.map((a) => {
          const dx = (rand() - 0.5) * 4;
          const dy = (rand() - 0.5) * 4;
          return { ...a, x: a.x + dx, y: a.y + dy, ...(a.foot ? { foot: { x: a.foot.x + dx, y: a.foot.y + dy } } : {}) };
        }),
      };
      const after = placeStrips(moved, before);
      const fresh = placeStrips(moved);
      // 挪过以后原来的号有的摆不下了（那就只能换）：只看“不看上一次时也都摆得下、而且照原样摆也不犯规”的画面
      const kept = after.every((p, k) => p.hidden === before[k].hidden && p.slot === before[k].slot);
      if (leftOut(fresh) === 0 && leftOut(before) === 0 && kept) checked++;
      expect(faults(moved, after), `第 ${i + 1} 个画面`).toEqual([]);
      expect(leftOut(after)).toBeLessThanOrEqual(leftOut(fresh));
    }
    // 六十个画面里，绝大多数一条也没换
    expect(checked).toBeGreaterThan(40);
  });

  it('上一次的号摆不下了才换；为了不换而少摆一条，不干', () => {
    const rand = randomFrom(99);
    for (let i = 0; i < 300; i++) {
      const given = randomScene(rand);
      // 上一次的号是随便编的
      const made: StripPlacement[] = given.strips.map((s) => ({ id: s.id, x: 0, y: 0, hidden: false, leader: null, slot: Math.floor(rand() * 4) * 100 + Math.floor(rand() * 4) * 10 + Math.floor(rand() * 5) }));
      const sticky = placeStrips(given, made);
      expect(faults(given, sticky), `第 ${i + 1} 个画面`).toEqual([]);
      expect(leftOut(sticky), `第 ${i + 1} 个画面`).toBeLessThanOrEqual(leftOut(placeStrips(given)));
    }
  });

  it('照上一次的号摆会少摆一条时：不照了，从头摆', () => {
    // 一个挤的画面，三条题签从头摆都摆得下。
    const given = input({
      size: { width: 208, height: 154 },
      strips: [
        { id: 'a', w: 30, h: 80, rank: 0 },
        { id: 'b', w: 30, h: 60, rank: 1 },
        { id: 'c', w: 30, h: 80, rank: 2 },
      ],
      anchors: [at('a', 102, 105), at('b', 63, 22), at('c', 169, 83)],
    });
    const fresh = placeStrips(given);
    expect(fresh.map((p) => p.hidden)).toEqual([false, false, false]);

    // 上一次（沙盘转过、画面变过以后）a 和 b 摆在别的号上。这两个号现在都还摆得下，可它们一占，c 就没有地方了：
    // 手按着的时候就是这样，c 先藏着。
    const before: StripPlacement[] = [102, 301, 100].map((slot, i) => ({ id: 'abc'[i], x: 0, y: 0, hidden: false, leader: null, slot }));
    const held = placeStrips(given, before, { moving: true });
    expect(held.map((p) => (p.hidden ? p.why : p.slot))).toEqual([102, 301, 'room']);

    // 手一放开：为了 a、b 不动而少摆 c 不值得，照从头摆的来
    expect(placeStrips(given, before)).toEqual(fresh);
    expect(placeStrips(given, held)).toEqual(fresh);
  });

  it('上一次的结果里没有这一条、是空的：和不给一样', () => {
    const given = input({ strips: strips('a', 'b'), anchors: [at('a', 200, 300), at('b', 600, 200)] });
    const plain = placeStrips(given);
    expect(placeStrips(given, [])).toEqual(plain);
    expect(placeStrips(given, [{ id: 'zz', x: 1, y: 2, hidden: false, leader: null, slot: 311 }])).toEqual(plain);
  });
});

describe('摆不下、看不见、顺序（T7）', () => {
  // 画面很窄，上下只摆得开一条。
  const tight = { width: 60, height: 200 };
  const two = (rankA: number, rankB: number): StripInput =>
    input({
      size: tight,
      strips: [
        { id: 'a', w: W, h: H, rank: rankA },
        { id: 'b', w: W, h: H, rank: rankB },
      ],
      anchors: [at('a', 30, 150), at('b', 30, 160)],
    });

  it('摆不下：不那么要紧的那一条不摆，缘故是 room，位置是它指的那一点', () => {
    const [a, b] = placeStrips(two(0, 1));
    expect(a.hidden).toBe(false);
    expect(b).toEqual({ id: 'b', x: 30, y: 160, hidden: true, leader: null, why: 'room' });
  });

  it('看的是 rank，不是写的先后', () => {
    const [a, b] = placeStrips(two(1, 0));
    expect(b.hidden).toBe(false);
    expect(a).toEqual({ id: 'a', x: 30, y: 150, hidden: true, leader: null, why: 'room' });
  });

  it('那一点看不见：不摆，缘故是 unseen，也没有引线', () => {
    const [p] = placeStrips(input({ anchors: [at('a', 400, 300, { visible: false })] }));
    expect(p).toEqual({ id: 'a', x: 400, y: 300, hidden: true, leader: null, why: 'unseen' });
  });

  it('没有给那一点：不摆，缘故是 unseen', () => {
    const [p] = placeStrips(input({ anchors: [] }));
    expect(p).toEqual({ id: 'a', x: 0, y: 0, hidden: true, leader: null, why: 'unseen' });
  });

  it('那一点在留出来的那一块外面：出去不到 8 像素还摆，再远就算看不见', () => {
    const insets = { top: 60, right: 0, bottom: 130, left: 0 };
    // 留出来的那一块：上边 64，下边 466，左边 4，右边 796
    for (const where of [
      { x: 400, y: 57 },
      { x: 400, y: 473 },
      { x: -3, y: 300 },
      { x: 803, y: 300 },
    ]) {
      const given = input({ anchors: [at('a', where.x, where.y)], insets });
      const [p] = placeStrips(given);
      expect(p.hidden, `(${where.x}, ${where.y})`).toBe(false);
      expect(faults(given, [p])).toEqual([]);
    }
    for (const where of [
      { x: 400, y: 55 },
      { x: 400, y: 475 },
      { x: -5, y: 300 },
      { x: 805, y: 300 },
      { x: Number.NaN, y: 300 },
      { x: 400, y: Number.POSITIVE_INFINITY },
    ]) {
      const [p] = placeStrips(input({ anchors: [at('a', where.x, where.y)], insets }));
      expect(p, `(${where.x}, ${where.y})`).toMatchObject({ hidden: true, why: 'unseen', leader: null });
    }
  });

  it('结果和传进来的题签一一对上，顺序相同', () => {
    const given = input({
      strips: [
        { id: 'c', w: W, h: H, rank: 2 },
        { id: 'a', w: W, h: H, rank: 0 },
        { id: 'b', w: W, h: H, rank: 1 },
      ],
      anchors: [at('b', 300, 300), at('c', 500, 300), at('a', 100, 300, { visible: false })],
    });
    const result = placeStrips(given);
    expect(result.map((p) => p.id)).toEqual(['c', 'a', 'b']);
    expect(result.map((p) => p.hidden)).toEqual([false, true, false]);
  });

  it('不改传进来的东西；同样的东西算两遍，结果一样', () => {
    const rand = randomFrom(3);
    for (let i = 0; i < 20; i++) {
      const given = randomScene(rand);
      const prev = placeStrips(given);
      const copy = JSON.stringify(given);
      const prevCopy = JSON.stringify(prev);
      const again = placeStrips(given, prev);
      const moving = placeStrips(given, prev, { moving: true });
      expect(JSON.stringify(given)).toBe(copy);
      expect(JSON.stringify(prev)).toBe(prevCopy);
      expect(placeStrips(given)).toEqual(prev);
      // 位置没有变：再摆一遍、手按着再摆一遍，都和上一次一样
      expect(again).toEqual(prev);
      expect(moving).toEqual(prev);
    }
  });

  it('一条题签也没有：空的', () => {
    expect(placeStrips(input({ strips: [], anchors: [] }))).toEqual([]);
  });
});

// ---------------------------------------------------------------- 读者的手还在动沙盘

describe('手还在动时不重新挑位置（T9，纯函数的一半）', () => {
  const given = input();
  /** 上一次摆在一个很偏的位置上：下边、最远的一档、往旁边挪了一格。 */
  const odd: StripPlacement[] = [{ id: 'a', x: 0, y: 0, hidden: false, leader: null, slot: 332 }];

  it('留在原来的号上，哪怕别处好得多', () => {
    const [held] = placeStrips(given, odd, { moving: true });
    expect(held.hidden).toBe(false);
    expect(held.slot).toBe(332);
    expect(sideOfSlot(held.slot!)).toBe('below');
    // 手放开以后的那一次：重新挑，回到正上方
    const [released] = placeStrips(given, [held]);
    expect(released).toEqual(one());
  });

  it('没有上一次（刚换的一批）：照常摆，要挪一条才摆得下的也照挪', () => {
    expect(placeStrips(given, undefined, { moving: true })).toEqual(placeStrips(given));
    // 见“回头挪一条已经摆好的”：a 不让开，b 就摆不下
    const band = input({ size: { width: 800, height: 108 }, strips: strips('a', 'b'), anchors: [at('a', 700, 54), at('b', 780, 54)] });
    const first = placeStrips(band, undefined, { moving: true });
    expect(first.map((p) => p.hidden)).toEqual([false, false]);
    expect(first).toEqual(placeStrips(band));
  });

  // a 在正上方，b 也在正上方；b 的点挪到 a 的点旁边时，b 原来的位置和 a 叠在一起。
  const apart = input({ strips: strips('a', 'b'), anchors: [at('a', 300, 300), at('b', 500, 300)] });
  const close = input({ strips: strips('a', 'b'), anchors: [at('a', 300, 300), at('b', 320, 300)] });

  it('留不住原来的号：先不摆，缘故是 room，号还记着；要紧的那一条不动', () => {
    const before = placeStrips(apart);
    expect(before.map((p) => p.slot)).toEqual([0, 0]);
    const held = placeStrips(close, before, { moving: true });
    expect(held[0]).toEqual(before[0]);
    expect(held[1]).toEqual({ id: 'b', x: 320, y: 300, hidden: true, leader: null, why: 'room', slot: 0 });
    // 不按着的话，b 会换一个地方摆出来
    const free = placeStrips(close, before);
    expect(free[1].hidden).toBe(false);
    expect(free[1].slot).not.toBe(0);
  });

  it('那个位置又空出来了：摆回原来的号上', () => {
    const before = placeStrips(apart);
    const held = placeStrips(close, before, { moving: true });
    const back = placeStrips(apart, held, { moving: true });
    expect(back).toEqual(before);
  });

  it('手放开以后的那一次：都重新摆出来', () => {
    const held = placeStrips(close, placeStrips(apart), { moving: true });
    const released = placeStrips(close, held);
    expect(released.map((p) => p.hidden)).toEqual([false, false]);
    expect(released[0].slot).toBe(0);
    expect(faults(close, released)).toEqual([]);
  });

  it('上一次就摆不下的：手放开以前不给它挑位置', () => {
    const was: StripPlacement[] = [{ id: 'a', x: 400, y: 300, hidden: true, leader: null, why: 'room' }];
    expect(placeStrips(given, was, { moving: true })).toEqual(was);
    expect(placeStrips(given, was)[0]).toEqual(one());
  });

  it('刚转进画面的（上一次看不见）：挑一个空位摆出来，别的不动', () => {
    const hiddenB = input({ strips: strips('a', 'b'), anchors: [at('a', 300, 300), at('b', 320, 300, { visible: false })] });
    const before = placeStrips(hiddenB);
    expect(before[1]).toMatchObject({ hidden: true, why: 'unseen' });
    const held = placeStrips(close, before, { moving: true });
    expect(held[0]).toEqual(before[0]);
    expect(held[1].hidden).toBe(false);
    expect(faults(close, held)).toEqual([]);
  });

  it('刚转进画面的那一条要挪别的题签才摆得下：手按着的时候不挪，它先不摆', () => {
    // 留出来的是一条横带；a 摆在右边，正好占了 b 唯一能摆的地方（见“回头挪一条已经摆好的”）。
    const band = { width: 800, height: 108 };
    const without = input({ size: band, strips: strips('a', 'b'), anchors: [at('a', 700, 54), at('b', 780, 54, { visible: false })] });
    const withB = input({ size: band, strips: strips('a', 'b'), anchors: [at('a', 700, 54), at('b', 780, 54)] });
    const before = placeStrips(without);
    expect(sideOfSlot(before[0].slot!)).toBe('right');

    const held = placeStrips(withB, before, { moving: true });
    expect(held[0]).toEqual(before[0]);
    expect(held[1]).toEqual({ id: 'b', x: 780, y: 54, hidden: true, leader: null, why: 'room' });

    // 手放开以后挪开 a，两条都摆出来
    const released = placeStrips(withB, held);
    expect(released.map((p) => p.hidden)).toEqual([false, false]);
    expect(sideOfSlot(released[0].slot!)).toBe('left');
  });

  it('转出画面又转回来：还在原来的号上', () => {
    const before = placeStrips(apart);
    const gone = placeStrips(input({ strips: strips('a', 'b'), anchors: [at('a', 300, 300), at('b', 500, 300, { visible: false })] }), before, { moving: true });
    expect(gone[1]).toEqual({ id: 'b', x: 500, y: 300, hidden: true, leader: null, why: 'unseen', slot: 0 });
    expect(placeStrips(apart, gone, { moving: true })).toEqual(before);
  });

  it('随便编的画面，按着转来转去：摆着的一条也不换号，也不犯别的规', () => {
    const rand = randomFrom(11);
    for (let i = 0; i < 80; i++) {
      const given0 = randomScene(rand);
      let prev = placeStrips(given0);
      for (let step = 0; step < 12; step++) {
        const moved: StripInput = { ...given0, anchors: given0.anchors.map((a) => ({ ...a, x: a.x + (rand() - 0.5) * 60, y: a.y + (rand() - 0.5) * 40, foot: undefined })) };
        const now = placeStrips(moved, prev, { moving: true });
        expect(faults(moved, now.map((p) => ({ ...p, slot: p.hidden ? undefined : p.slot }))), `第 ${i + 1} 个画面第 ${step + 1} 步`).toEqual([]);
        now.forEach((p, k) => {
          // 有过号的，号不变（摆着也好，先藏着也好）
          if (prev[k].slot !== undefined) expect(p.slot).toBe(prev[k].slot);
          // 上一次摆不下的，这一次不会冒出来
          if (prev[k].why === 'room' && prev[k].slot === undefined) expect(p.hidden).toBe(true);
        });
        prev = now;
      }
    }
  });
});

// ---------------------------------------------------------------- 题签层（一个很小的假页面）

/** 假的元素：只有题签层用到的那几样。 */
class FakeElement {
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  attributes = new Map<string, string>();
  dataset: Record<string, string> = {};
  className = '';
  text = '';
  style: Record<string, string>;
  ownerDocument!: FakeDocument;

  constructor(readonly tag: string) {
    const store: Record<string, string> = {};
    // style.cssText = '…' 是把整串样式换掉；别的是一条一条改
    this.style = new Proxy(store, {
      set(target, key: string, value: string) {
        if (key === 'cssText') {
          for (const name of Object.keys(target)) delete target[name];
          for (const part of value.split(';')) {
            const colon = part.indexOf(':');
            if (colon > 0) target[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
          }
        } else target[key] = value;
        return true;
      },
    });
  }

  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join('');
  }
  set textContent(value: string) {
    this.children = [];
    this.text = value;
  }
  /** 假页面不排版：题签的大小按字数算（宽 24，高 14 + 16 × 字数）。 */
  get offsetWidth(): number {
    return this.className === 'strip' ? 24 : 0;
  }
  get offsetHeight(): number {
    return this.className === 'strip' ? 14 + 16 * [...this.text].length : 0;
  }
  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.remove();
      node.parent = this;
      this.children.push(node);
    }
  }
  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
  /** 题签层在自己那一层上听“按了一下”（带站号的印的题签才用得着，查它的是 tests/unit/page/strip-seals.test.ts）；这个假页面里没有人按。 */
  addEventListener(): void {}
  /** 自己底下所有的元素（不算自己）。 */
  all(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.all()]);
  }
}

class FakeDocument {
  createElement(tag: string): FakeElement {
    const el = new FakeElement(tag);
    el.ownerDocument = this;
    return el;
  }
  createElementNS(_ns: string, tag: string): FakeElement {
    return this.createElement(tag);
  }
}

/** 一个假的容器，挂上真的题签层。 */
function mounted() {
  const container = new FakeDocument().createElement('div');
  const layer = mountStrips(container as unknown as HTMLElement);
  const root = container.children[0];
  const els = (): FakeElement[] => root.all().filter((el) => el.className === 'strip');
  const strip = (id: string): FakeElement => els().find((el) => el.dataset.stripId === id)!;
  const ring = (id: string): FakeElement => root.all().find((el) => el.getAttribute('data-strip-ring') === id)!;
  return {
    container,
    layer,
    root,
    els,
    strip,
    ring,
    /** 这一条摆出来没有。 */
    shown: (id: string): boolean => strip(id).style.visibility !== 'hidden',
    /** 这一条的那一点上画了圈没有。 */
    ringed: (id: string): boolean => ring(id).style.display !== 'none',
    /** 摆出来的题签的中心。 */
    centre: (id: string): { x: number; y: number } => ({ x: Number.parseFloat(strip(id).style.left), y: Number.parseFloat(strip(id).style.top) }),
    /** 显着的线和实心的点各几个。 */
    marks: (): { lines: number; dots: number } => {
      const svg = root.children[0];
      return {
        lines: svg.children.filter((el) => el.tag === 'line' && el.style.display !== 'none').length,
        dots: svg.children.filter((el) => el.tag === 'circle' && el.style.display !== 'none').length,
      };
    },
  };
}

const spec = (id: string, text: string, more: Partial<StripSpec> = {}): StripSpec => ({ id, text, tone: 'place', ...more });
const PHONE = { width: 390, height: 337 };
const PHONE_INSETS: StageInsets = { top: 54, right: 0, bottom: 95, left: 0 };

describe('题签层：只留一条（only）', () => {
  // 两条指的点挨着：后一条头一个位置被前一条占了，摆在别处
  const pair = [spec('a', '汴京'), spec('b', '徐州')];
  const anchors = [at('a', 200, 180), at('b', 212, 180)];

  it('别的都拿掉，留下的那一条还在原处；换成 set 重新换一批的话，它会跳到头一个位置上', () => {
    const m = mounted();
    m.layer.set(pair);
    m.layer.place(anchors, PHONE, PHONE_INSETS);
    expect(m.shown('b')).toBe(true);
    const was = m.centre('b');

    m.layer.only?.('b');
    expect(m.els().map((el) => el.dataset.stripId)).toEqual(['b']);
    m.layer.place([anchors[1]], PHONE, PHONE_INSETS);
    expect(m.shown('b')).toBe(true);
    expect(m.centre('b')).toEqual(was);
    expect(m.marks()).toEqual({ lines: 1, dots: 1 });

    // 对照：重新换一批（set），它一个人的时候摆在头一个位置上，和原来的不是一处——所以潜的时候不能用 set
    const fresh = mounted();
    fresh.layer.set([pair[1]]);
    fresh.layer.place([anchors[1]], PHONE, PHONE_INSETS);
    expect(fresh.centre('b')).not.toEqual(was);
  });

  it('藏着的时候只留一条：下一次 place 照常摆出来', () => {
    const m = mounted();
    m.layer.set(pair);
    m.layer.place(anchors, PHONE, PHONE_INSETS);
    m.layer.hide();
    m.layer.only?.('a');
    m.layer.place([anchors[0]], PHONE, PHONE_INSETS);
    expect(m.els().map((el) => el.dataset.stripId)).toEqual(['a']);
    expect(m.shown('a')).toBe(true);
  });
});

describe('题签层：摆不下的画一个空心的圈，不写句子（T8）', () => {
  it('摆得下的：字、引线、实心的点都显着，没有圈', () => {
    const m = mounted();
    m.layer.set([spec('a', '徐州'), spec('b', '泗水', { tone: 'water' })]);
    m.layer.place([at('a', 100, 200), at('b', 300, 200)], PHONE, PHONE_INSETS);
    expect(m.shown('a')).toBe(true);
    expect(m.shown('b')).toBe(true);
    expect(m.ringed('a')).toBe(false);
    expect(m.ringed('b')).toBe(false);
    expect(m.marks()).toEqual({ lines: 2, dots: 2 });
    expect(m.strip('b').dataset.tone).toBe('water');
  });

  it('摆不下的：字和引线不显，那一点上有一个空心的圈；看不见的：什么也没有', () => {
    const m = mounted();
    // 中间那一条太长（十二个字，比留出来的地方还高），哪里也摆不下；第三条指的那一点看不见。
    m.layer.set([spec('a', '徐州'), spec('b', '一条长得摆不下去的题签啊'), spec('c', '汴水')]);
    m.layer.place([at('a', 100, 200), at('b', 200, 150.26), at('c', 300, 200, { visible: false })], PHONE, PHONE_INSETS);

    expect(m.shown('a')).toBe(true);
    expect(m.ringed('a')).toBe(false);

    expect(m.shown('b')).toBe(false);
    expect(m.ringed('b')).toBe(true);
    expect(m.ring('b').getAttribute('transform')).toBe('translate(200.0 150.3)');

    expect(m.shown('c')).toBe(false);
    expect(m.ringed('c')).toBe(false);

    // 只有摆出来的那一条有引线和实心的点
    expect(m.marks()).toEqual({ lines: 1, dots: 1 });
  });

  it('圈是空心的：不填色，有边；样子写在元素自己身上，不靠样式表', () => {
    const m = mounted();
    m.layer.set([spec('a', '徐州')]);
    const circles = m.ring('a').children;
    expect(circles.length).toBeGreaterThan(0);
    for (const circle of circles) {
      expect(circle.tag).toBe('circle');
      expect(circle.style.fill).toBe('none');
      expect(circle.style.stroke).toBeTruthy();
      expect(Number(circle.getAttribute('r'))).toBeGreaterThan(2.6);
    }
    // 圈在画引线的那一层里（那一层整个不念给读屏的人听）
    expect(m.ring('a').parent).toBe(m.root.children[0]);
    expect(m.root.children[0].getAttribute('aria-hidden')).toBe('true');
  });

  it('这一层除了题签上的字，一个字也不添：摆不下也不写句子', () => {
    const m = mounted();
    const texts = ['徐州', '一条长得摆不下去的题签啊', '汴水'];
    m.layer.set(texts.map((text, i) => spec(`s${i}`, text)));
    m.layer.place([at('s0', 100, 200), at('s1', 200, 150), at('s2', 300, 200, { visible: false })], PHONE, PHONE_INSETS);
    expect(m.ringed('s1')).toBe(true);
    // 有字的元素只有题签自己
    const worded = m.container.all().filter((el) => el.text !== '');
    expect(worded.map((el) => el.className)).toEqual(['strip', 'strip', 'strip']);
    expect(worded.map((el) => el.text)).toEqual(texts);
    expect(m.container.textContent).toBe(texts.join(''));
    // 这一层里只有：一层线，三条题签
    expect(m.root.children.map((el) => el.className || el.getAttribute('class'))).toEqual(['strip-leaders', 'strip', 'strip', 'strip']);
    // 没有哪个属性里藏着一句话（title、aria-label 之类）
    for (const el of m.container.all()) {
      expect(el.getAttribute('title')).toBeNull();
      expect(el.getAttribute('aria-label')).toBeNull();
    }
  });

  it('摆不下的后来摆得下了：圈收起来；换一批题签、藏起来、拿走，圈都不留', () => {
    const m = mounted();
    m.layer.set([spec('a', '徐州'), spec('b', '汴水')]);
    // 画面很窄，只摆得开一条
    const tight = { width: 44, height: 337 };
    m.layer.place([at('a', 22, 200), at('b', 22, 210)], tight, PHONE_INSETS);
    expect(m.shown('a')).toBe(true);
    expect(m.ringed('b')).toBe(true);

    m.layer.place([at('a', 100, 200), at('b', 300, 200)], PHONE, PHONE_INSETS);
    expect(m.shown('b')).toBe(true);
    expect(m.ringed('b')).toBe(false);

    m.layer.place([at('a', 22, 200), at('b', 22, 210)], tight, PHONE_INSETS);
    expect(m.ringed('b')).toBe(true);
    m.layer.hide();
    expect(m.ringed('b')).toBe(false);
    expect(m.shown('a')).toBe(false);

    m.layer.place([at('a', 22, 200), at('b', 22, 210)], tight, PHONE_INSETS);
    expect(m.ringed('b')).toBe(true);
    m.layer.set([spec('c', '泗水')]);
    // 旧的一批连圈一起拿走了：线那一层里只剩新的一条的引线的衬边和引线、（远处的题签才显的）箭头的衬边和箭头、点、圈
    expect(m.root.children[0].children.map((el) => el.tag)).toEqual(['path', 'line', 'path', 'path', 'circle', 'g']);
    expect(m.els().map((el) => el.dataset.stripId)).toEqual(['c']);

    m.layer.destroy();
    expect(m.container.children).toEqual([]);
  });
});

describe('题签层：引线底下垫着纸色的衬边，横平竖直的引线画在整像素上', () => {
  /** 一条题签的引线，和线那一层里紧挨在它前面的那一条（先画的在底下）：它的衬边。 */
  const leaderOf = (m: ReturnType<typeof mounted>, index: number): { line: FakeElement; under: FakeElement } => {
    const siblings = m.root.children[0].children;
    const line = siblings.filter((el) => el.tag === 'line')[index];
    return { line, under: siblings[siblings.indexOf(line) - 1] };
  };
  const num = (el: FakeElement, name: string): number => Number(el.getAttribute(name));

  it('摆出来的题签：衬边和引线是同一条线，纸色、比引线宽；白天夜里都一样（样子写在元素自己身上）', () => {
    const m = mounted();
    m.layer.set([spec('a', '徐州')]);
    m.layer.place([at('a', 100, 200)], PHONE, PHONE_INSETS);
    const { line, under } = leaderOf(m, 0);
    expect(line.style.display).not.toBe('none');
    expect(under.tag).toBe('path');
    expect(under.style.display).not.toBe('none');
    expect(under.getAttribute('d')).toBe(`M${line.getAttribute('x1')} ${line.getAttribute('y1')}L${line.getAttribute('x2')} ${line.getAttribute('y2')}`);
    expect(under.style.fill).toBe('none');
    expect(under.style.stroke).toContain('--figure-halo');
    expect(Number(under.style['stroke-width'])).toBeGreaterThan(num(line, 'stroke-width'));
  });

  it('引线是竖的，横向就落在半个像素上（一像素宽的线正好占一列像素）；是横的，竖向也一样；实心的点跟着线走', () => {
    const m = mounted();
    m.layer.set([spec('a', '徐州')]);
    // 那一点写在整数上、写在小数上，都挪到半个像素的地方
    for (const [x, y] of [
      [100, 200],
      [100.4, 200.3],
      [137.8, 180.6],
    ]) {
      m.layer.place([at('a', x, y)], PHONE, PHONE_INSETS);
      const { line, under } = leaderOf(m, 0);
      const [x1, y1, x2, y2] = ['x1', 'y1', 'x2', 'y2'].map((name) => num(line, name));
      const upright = Math.abs(x2 - x1) < 0.5;
      const level = Math.abs(y2 - y1) < 0.5;
      expect(upright || level, `(${x}, ${y}) 的引线不是横平竖直的`).toBe(true);
      if (upright) {
        expect(x1).toBe(Math.floor(x) + 0.5);
        expect(x2).toBe(x1);
      }
      if (level) {
        expect(y1).toBe(Math.floor(y) + 0.5);
        expect(y2).toBe(y1);
      }
      const dot = m.root.children[0].children.find((el) => el.tag === 'circle' && el.style.display !== 'none')!;
      expect(num(dot, 'cx')).toBe(x1);
      expect(num(dot, 'cy')).toBe(y1);
      expect(under.getAttribute('d')).toBe(`M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`);
    }
  });

  it('藏起来、摆不下、那一点看不见时，衬边跟着引线一起不显', () => {
    const m = mounted();
    m.layer.set([spec('a', '徐州'), spec('b', '一条长得摆不下去的题签啊')]);
    m.layer.place([at('a', 100, 200), at('b', 200, 150)], PHONE, PHONE_INSETS);
    expect(leaderOf(m, 0).under.style.display).not.toBe('none');
    expect(leaderOf(m, 1).under.style.display).toBe('none');
    m.layer.hide();
    expect(leaderOf(m, 0).under.style.display).toBe('none');
    m.layer.place([at('a', 100, 200, { visible: false }), at('b', 200, 150)], PHONE, PHONE_INSETS);
    expect(leaderOf(m, 0).under.style.display).toBe('none');
  });

  it('每一条引线带着它那条题签的 id（data-strip-leader）；样式表照它只把“他站处立出的地名”的那一条加深——不透、不比别的引线细，别的引线一条也不动', () => {
    const m = mounted();
    m.layer.set([spec('a', '徐州'), spec('b', '汴水'), spec(PIECE_NAME, '泗州')]);
    m.layer.place([at('a', 100, 200), at('b', 300, 200), at(PIECE_NAME, 200, 120)], PHONE, PHONE_INSETS);
    const lines = m.root.children[0].children.filter((el) => el.tag === 'line');
    expect(lines.map((line) => line.getAttribute('data-strip-leader'))).toEqual(['a', 'b', PIECE_NAME]);
    // 样式表：说到 data-strip-leader 的规则只在 stage.css 里，只有一条选择器，点的就是 PIECE_NAME 那一条
    const sheets = namesIn('src/styles').filter((name) => name.endsWith('.css'));
    expect(sheets).toContain('stage.css');
    const all = sheets.flatMap((name) => readCss(new TextDecoder().decode(readBytes(`src/styles/${name}`))).declarations.map((declaration) => ({ ...declaration, sheet: name })));
    const mine = all.filter((declaration) => declaration.selector.includes('data-strip-leader'));
    expect([...new Set(mine.map((declaration) => `${declaration.sheet} ${declaration.selector}`))]).toEqual([`stage.css .strip-leaders line[data-strip-leader='${PIECE_NAME}']`]);
    // 它只改两样：粗细和透不透；比起所有引线共用的那一条，不透（1），不更细
    const base = Object.fromEntries(all.filter((declaration) => declaration.sheet === 'stage.css' && declaration.selector === '.strip-leaders line').map((declaration) => [declaration.property, declaration.value]));
    const strong = Object.fromEntries(mine.map((declaration) => [declaration.property, declaration.value]));
    expect(Object.keys(strong).sort()).toEqual(['opacity', 'stroke-width']);
    expect(Number(base.opacity)).toBeLessThan(1);
    expect(Number(strong.opacity)).toBe(1);
    expect(Number(strong['stroke-width'])).toBeGreaterThanOrEqual(Number(base['stroke-width']));
    console.log(`  引线：共用的一条粗 ${base['stroke-width']}、透明度 ${base.opacity}；他站处立出的地名的那一条粗 ${strong['stroke-width']}、透明度 ${strong.opacity}`);
  });
});

describe('题签层：远处的题签，那一点上有一个朝外的小箭头', () => {
  const arrowOf = (m: ReturnType<typeof mounted>, id: string): FakeElement => m.root.all().find((el) => el.getAttribute('data-strip-arrow') === id)!;
  /** 垫在箭头底下的衬边：线那一层里紧挨在箭头前面的那一条（先画的在底下）。 */
  const haloOf = (m: ReturnType<typeof mounted>, id: string): FakeElement => {
    const siblings = m.root.children[0].children;
    return siblings[siblings.indexOf(arrowOf(m, id)) - 1];
  };

  it('题签没能摆在朝外的那一边时画箭头：从那一点起，朝外 16 像素；不是远处的题签，给了方向也不画', () => {
    const m = mounted();
    m.layer.set([spec('far', '白土镇', { tone: 'far' }), spec('a', '徐州')]);
    // 那一点贴着留出来的那一块的上边：朝外是朝上，可上面摆不下，题签只好摆在旁边
    m.layer.place([at('far', 200, 62, { out: [0, -1] }), at('a', 100, 200, { out: [0, -1] })], PHONE, PHONE_INSETS);
    expect(m.shown('far')).toBe(true);
    expect(m.centre('far').x).not.toBe(200);
    expect(arrowOf(m, 'far').style.display).not.toBe('none');
    expect(arrowOf(m, 'far').getAttribute('d')).toMatch(/^M200\.0 62\.0L200\.0 46\.0M/);
    // 箭头的样子写在元素自己身上：一条线，不填色
    expect(arrowOf(m, 'far').style.fill).toBe('none');
    expect(arrowOf(m, 'far').style.stroke).toBeTruthy();
    expect(arrowOf(m, 'a').style.display).toBe('none');
    // 箭头底下垫着一条一样的线，纸色、粗一些：箭头尖落在沙盘深色的边框上时也看得见
    const halo = haloOf(m, 'far');
    expect(halo.tag).toBe('path');
    expect(halo.style.display).not.toBe('none');
    expect(halo.getAttribute('d')).toBe(arrowOf(m, 'far').getAttribute('d'));
    expect(halo.style.fill).toBe('none');
    expect(halo.style.stroke).toContain('--figure-halo');
    expect(Number(halo.style['stroke-width'])).toBeGreaterThan(Number(arrowOf(m, 'far').style['stroke-width']));
    expect(haloOf(m, 'a').style.display).toBe('none');
  });

  it('题签摆在了朝外的那一边：引线就是朝外的，不再画箭头；藏起来、那一点看不见时也不画', () => {
    const m = mounted();
    m.layer.set([spec('far', '白土镇', { tone: 'far' })]);
    m.layer.place([at('far', 200, 200, { out: [0, -1] })], PHONE, PHONE_INSETS);
    expect(m.shown('far')).toBe(true);
    expect(m.centre('far').y).toBeLessThan(200);
    expect(arrowOf(m, 'far').style.display).toBe('none');

    // 换到贴着上边的地方：箭头出来；藏起来，箭头跟着收
    m.layer.hide();
    m.layer.place([at('far', 200, 62, { out: [0, -1] })], PHONE, PHONE_INSETS);
    expect(arrowOf(m, 'far').style.display).not.toBe('none');
    expect(haloOf(m, 'far').style.display).not.toBe('none');
    m.layer.hide();
    expect(arrowOf(m, 'far').style.display).toBe('none');
    expect(haloOf(m, 'far').style.display).toBe('none');
    m.layer.place([at('far', 200, 62, { out: [0, -1], visible: false })], PHONE, PHONE_INSETS);
    expect(arrowOf(m, 'far').style.display).toBe('none');
    expect(haloOf(m, 'far').style.display).toBe('none');
    // 没有给方向（那一点在镜头背后算不出来）：不画
    m.layer.place([at('far', 200, 62)], PHONE, PHONE_INSETS);
    expect(m.shown('far')).toBe(true);
    expect(arrowOf(m, 'far').style.display).toBe('none');
  });
});

describe('题签层：手还在动沙盘时（T9）', () => {
  const two = [spec('a', '徐州'), spec('b', '汴水')];
  const apart = [at('a', 100, 200), at('b', 300, 200)];
  const close = [at('a', 100, 200), at('b', 112, 200)];

  it('按着的时候题签跟着那一点走，不换位置；留不住的先藏起来，留一个圈；那个位置空出来又摆回去', () => {
    const m = mounted();
    m.layer.set(two);
    m.layer.place(apart, PHONE, PHONE_INSETS);
    const offset = (id: string, anchors: Anchor[]): { dx: number; dy: number } => {
      const a = anchors.find((x) => x.id === id)!;
      return { dx: m.centre(id).x - a.x, dy: m.centre(id).y - a.y };
    };
    const a0 = offset('a', apart);
    const b0 = offset('b', apart);

    // 那两点挪了一点：两条都跟着走
    const nudged = [at('a', 130, 190), at('b', 280, 215)];
    m.layer.place(nudged, PHONE, PHONE_INSETS, { moving: true });
    expect(offset('a', nudged)).toEqual(a0);
    expect(offset('b', nudged)).toEqual(b0);

    // b 的点挪到 a 的点旁边：b 原来的位置和 a 叠了，b 先藏起来，留一个圈；a 不动
    m.layer.place(close, PHONE, PHONE_INSETS, { moving: true });
    expect(m.shown('a')).toBe(true);
    expect(offset('a', close)).toEqual(a0);
    expect(m.shown('b')).toBe(false);
    expect(m.ringed('b')).toBe(true);
    expect(m.ring('b').getAttribute('transform')).toBe('translate(112.0 200.0)');

    // 又挪开了：b 摆回原来的位置上，圈收起来
    m.layer.place(apart, PHONE, PHONE_INSETS, { moving: true });
    expect(m.shown('b')).toBe(true);
    expect(m.ringed('b')).toBe(false);
    expect(offset('b', apart)).toEqual(b0);
  });

  it('手放开以后的那一次整个重摆：藏着的都摆出来', () => {
    const m = mounted();
    m.layer.set(two);
    m.layer.place(apart, PHONE, PHONE_INSETS);
    m.layer.place(close, PHONE, PHONE_INSETS, { moving: true });
    expect(m.shown('b')).toBe(false);

    m.layer.place(close, PHONE, PHONE_INSETS);
    expect(m.shown('a')).toBe(true);
    expect(m.shown('b')).toBe(true);
    expect(m.ringed('b')).toBe(false);
    // 两条不叠
    const boxOf = (id: string): Box => {
      const el = m.strip(id);
      const c = m.centre(id);
      return { left: c.x - el.offsetWidth / 2, right: c.x + el.offsetWidth / 2, top: c.y - el.offsetHeight / 2, bottom: c.y + el.offsetHeight / 2 };
    };
    expect(overlap(grown(boxOf('a'), GUTTER), boxOf('b'))).toBe(false);
  });

  it('刚换的一批题签还没摆过：按着也照常摆', () => {
    const m = mounted();
    m.layer.set(two);
    m.layer.place(close, PHONE, PHONE_INSETS, { moving: true });
    expect(m.shown('a')).toBe(true);
    expect(m.shown('b')).toBe(true);
  });

  it('按着的时候换了一批题签（set）：上一批摆在哪不算数，新的一批马上照常摆', () => {
    const m = mounted();
    m.layer.set(two);
    m.layer.place(apart, PHONE, PHONE_INSETS);
    m.layer.place(close, PHONE, PHONE_INSETS, { moving: true });
    expect(m.shown('b')).toBe(false);
    // 同样两个 id 的新一批（换小节、换古今的叫法都是这样）
    m.layer.set(two);
    expect(m.shown('a')).toBe(true);
    expect(m.shown('b')).toBe(true);
    expect(m.ringed('b')).toBe(false);
  });

  it('镜头自己滑过一回以后（hide）重新摆：和头一次摆的一样，不记着滑之前的位置', () => {
    const turned = mounted();
    turned.layer.set(two);
    turned.layer.place(apart, PHONE, PHONE_INSETS);
    turned.layer.place(close, PHONE, PHONE_INSETS, { moving: true });
    turned.layer.place(close, PHONE, PHONE_INSETS);
    turned.layer.hide();
    turned.layer.place(apart, PHONE, PHONE_INSETS);

    const fresh = mounted();
    fresh.layer.set(two);
    fresh.layer.place(apart, PHONE, PHONE_INSETS);
    for (const id of ['a', 'b']) expect(turned.centre(id)).toEqual(fresh.centre(id));
  });

  it('换了小节（set 换成别的几条题签，没有先 hide）：不照上一节的那几点摆，两节都有的那一条也和头一次摆的一样', () => {
    // 上一节：“徐州”指的那一点贴着上边，上面摆不下，只好摆在别的一边
    const before = [at('a', 195, 70), at('b', 60, 200)];
    // 这一节：还有“徐州”，那一点到了画面中间；另一条是新的
    const now = [at('a', 195, 200), at('c', 330, 200)];
    const next = [spec('a', '徐州'), spec('c', '汴水')];

    const fresh = mounted();
    fresh.layer.set(next);
    fresh.layer.place(now, PHONE, PHONE_INSETS);
    // 头一次摆：在那一点的正上方
    expect(fresh.centre('a').x).toBe(195);
    expect(fresh.centre('a').y).toBeLessThan(200);

    const m = mounted();
    m.layer.set([spec('a', '徐州'), spec('b', '泗水')]);
    m.layer.place(before, PHONE, PHONE_INSETS);
    expect(m.centre('a')).not.toEqual({ x: 195, y: fresh.centre('a').y - 130 });
    expect(m.centre('a').y).toBeGreaterThanOrEqual(70);
    // 不滑、直接换到这一节（系统设了“减少动态效果”时就是这样）：先 set，紧接着 place
    m.layer.set(next);
    // 手里那几点还是上一节的：新的一批先不摆
    expect(m.shown('a')).toBe(false);
    expect(m.shown('c')).toBe(false);
    m.layer.place(now, PHONE, PHONE_INSETS);
    for (const id of ['a', 'c']) expect(m.centre(id), id).toEqual(fresh.centre(id));
    expect(m.shown('a')).toBe(true);
    expect(m.shown('c')).toBe(true);
  });

  it('换了古今的叫法（set）：马上照原来那几点重摆', () => {
    const m = mounted();
    m.layer.set(two);
    m.layer.place(apart, PHONE, PHONE_INSETS);
    m.layer.set([spec('a', '彭城'), spec('b', '汴河故道')]);
    expect(m.shown('a')).toBe(true);
    expect(m.shown('b')).toBe(true);
    expect(m.strip('b').text).toBe('汴河故道');
    // 字多了，题签高了，还是在那一点的正上方
    expect(m.centre('b').x).toBe(300);
    expect(m.centre('b').y).toBeLessThan(200);
  });
});

// ---------------------------------------------------------------- 沙盘上另有东西占着的一块（avoid）

describe('沙盘上另有东西占着画面的一块（avoid：全程沙盘上停在一处的小像）', () => {
  type AvoidBox = NonNullable<StripInput['avoid']>[number];
  const NAMES: NamesMode[] = ['ancient', 'modern'];

  /** 真的一座沙盘的一小节，在一种沙盘栏上：交给 placeStrips 的那一份（镜头、那几点的算法和页面上的沙盘是同一套）。 */
  function realInput(
    scene: TableScene,
    coords: FrameCoords,
    samplers: GroundSamplers,
    section: SceneSection | RouteSection,
    pane: { size: { width: number; height: number }; insets: StageInsets },
    list: StripInput['strips'],
  ): StripInput {
    const style = styleFor(scene.style);
    const view = placeCamera(section, scene, samplers, coords, style, pane.size, pane.insets);
    const camera = new PerspectiveCamera(view.pose.fov, pane.size.width / pane.size.height, Math.max(60, view.distanceM * 0.1), view.distanceM * 3 + 30000);
    camera.position.set(...view.pose.position);
    camera.lookAt(...view.pose.target);
    const [shiftX, shiftY] = centreShift(pane.insets);
    if (shiftX || shiftY) camera.setViewOffset(pane.size.width, pane.size.height, -shiftX, -shiftY, pane.size.width, pane.size.height);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const written = list.map((s) => scene.strips.find((x) => x.id === s.id)).filter((s): s is SceneStrip => s !== undefined);
    const D = equivalentDistance(view.distanceM, view.pose.fov, pane.size.height);
    return { strips: list, anchors: screenAnchors(written, scene, samplers, coords, style, D, camera, pane.size), size: pane.size, insets: pane.insets };
  }

  /** content/ 里的每一座沙盘（站点的、全程的）、每一小节、每一种标准的沙盘栏（全程沙盘再加首页的两种）、古今两种名字。 */
  function everyRealInput(): { at: string; input: StripInput }[] {
    const out: { at: string; input: StripInput }[] = [];
    for (const key of realSceneKeys()) {
      const R = realScene(key);
      for (const pane of STANDARD_PANES)
        for (const section of R.scene.sections)
          for (const names of NAMES) out.push({ at: `${key} ${pane.name} ${section.heading} ${names}`, input: realInput(R.scene, R.coords, R.samplers, section, pane, sectionStrips(R.scene, section.heading, pane.size.width, names)) });
    }
    for (const key of realSceneKeys('route')) {
      const R = realRouteScene(key);
      for (const pane of [...STANDARD_PANES, ...HOME_PANES.filter((p) => !STANDARD_PANES.includes(p))])
        for (const section of R.scene.sections)
          for (const names of NAMES) out.push({ at: `${key} ${pane.name} ${section.heading} ${names}`, input: realInput(R.scene, R.coords, R.samplers, section, pane, routeSectionStrips(R.scene, section.heading, pane.size.width, names)) });
    }
    return out;
  }

  const rectOf = (p: StripPlacement, s: { w: number; h: number }): AvoidBox => ({ x0: p.x - s.w / 2, y0: p.y - s.h / 2, x1: p.x + s.w / 2, y1: p.y + s.h / 2 });
  const touches = (a: AvoidBox, b: AvoidBox): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  /** 一条线段有没有从一块里面穿过去：沿线取很多点，看有没有落在里面的。 */
  function passes(leader: readonly [number, number, number, number], b: AvoidBox): boolean {
    const [x1, y1, x2, y2] = leader;
    const steps = Math.max(8, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 4));
    for (let i = 0; i <= steps; i++) {
      const x = x1 + ((x2 - x1) * i) / steps;
      const y = y1 + ((y2 - y1) * i) / steps;
      if (x > b.x0 + 0.01 && x < b.x1 - 0.01 && y > b.y0 + 0.01 && y < b.y1 - 0.01) return true;
    }
    return false;
  }
  const insideBox = (a: { x: number; y: number }, b: AvoidBox): boolean => a.x > b.x0 && a.x < b.x1 && a.y > b.y0 && a.y < b.y1;

  it(
    '不给 avoid、给一个空的 avoid：摆出来的和原来一个数不差（四座沙盘、每一种标准的画面、古今两种名字）',
    () => {
      const all = everyRealInput();
      let placements = 0;
      for (const { at: where, input: given } of all) {
        // “原来”：这个字段根本不写（改以前的页面给的就是这样）
        expect('avoid' in given, where).toBe(false);
        const plain = placeStrips(given);
        placements += plain.length;
        expect(placeStrips({ ...given, avoid: [] }), `${where}：空的 avoid`).toEqual(plain);
        expect(placeStrips({ ...given, avoid: undefined }), `${where}：avoid 写成 undefined`).toEqual(plain);
        // 接着上一次摆、手还按着的时候也一样
        expect(placeStrips({ ...given, avoid: [] }, plain), `${where}：接着上一次摆`).toEqual(placeStrips(given, plain));
        expect(placeStrips({ ...given, avoid: [] }, plain, { moving: true }), `${where}：手还按着`).toEqual(placeStrips(given, plain, { moving: true }));
      }
      // 四座沙盘都在里面，每一座都摆了题签
      const tables = [...realSceneKeys(), ...realSceneKeys('route')];
      expect(tables.length).toBeGreaterThanOrEqual(4);
      for (const key of tables) expect(all.some((x) => x.at.startsWith(`${key} `) && x.input.strips.length > 0), key).toBe(true);
      console.log(`不给 avoid 和给空的 avoid：${tables.length} 座沙盘，${all.length} 个画面，${placements} 条题签，摆出来的一个数不差`);
    },
    60_000,
  );

  it(
    '不给 ground、给了 ground，不给 area、每一条都写上 area：竖着的纸条的摆法摆出来的和原来一个数不差（四座沙盘、每一种标准的画面、古今两种名字）；让开小像的那一个不交摆法、交 placeStrips 也一样',
    () => {
      // 这两样是给另一种题签（平着的纸条）添的：地面的四个角，和“这个名字没有点”。竖着的纸条的摆法不看它们
      const all = everyRealInput();
      let placements = 0;
      for (const { at: where, input: given } of all) {
        expect('ground' in given, where).toBe(false);
        expect(given.strips.some((s) => 'area' in s), where).toBe(false);
        const plain = placeStrips(given);
        placements += plain.length;
        const { width, height } = given.size;
        // 一块很小的地面（画面正中的四十像素见方）：要是摆法看了它，没有一条摆得进去
        const small = [
          { x: width / 2 - 20, y: height / 2 - 20 },
          { x: width / 2 + 20, y: height / 2 - 20 },
          { x: width / 2 + 20, y: height / 2 + 20 },
          { x: width / 2 - 20, y: height / 2 + 20 },
        ];
        const everyArea = given.strips.map((s) => ({ ...s, area: true }));
        expect(placeStrips({ ...given, ground: small }), `${where}：给了 ground`).toEqual(plain);
        expect(placeStrips({ ...given, ground: undefined }), `${where}：ground 写成 undefined`).toEqual(plain);
        expect(placeStrips({ ...given, strips: everyArea }), `${where}：每一条都写上 area`).toEqual(plain);
        expect(placeStrips({ ...given, strips: everyArea, ground: small }, plain), `${where}：接着上一次摆`).toEqual(placeStrips(given, plain));
        expect(placeStrips({ ...given, strips: everyArea, ground: small }, plain, { moving: true }), `${where}：手还按着`).toEqual(placeStrips(given, plain, { moving: true }));
        // 让开小像的那一个：它多接的那一样（拿哪一套摆法去让）不给，和给 placeStrips，摆出来的一样；给了 ground 也一样
        const stand: AvoidBox = { x0: width / 2 - 10, y0: height / 2 - 36, x1: width / 2 + 10, y1: height / 2 + 8 };
        const around = aroundPiece()({ ...given, avoid: [stand] });
        expect((aroundPiece() as (...args: [...Parameters<typeof placeStrips>, typeof placeStrips]) => StripPlacement[])({ ...given, avoid: [stand] }, undefined, undefined, placeStrips), `${where}：让开小像，交 placeStrips`).toEqual(around);
        expect(aroundPiece()({ ...given, avoid: [stand], ground: small }), `${where}：让开小像，给了 ground`).toEqual(around);
      }
      const tables = [...realSceneKeys(), ...realSceneKeys('route')];
      expect(tables.length).toBeGreaterThanOrEqual(4);
      for (const key of tables) expect(all.some((x) => x.at.startsWith(`${key} `) && x.input.strips.length > 0), key).toBe(true);
      console.log(`不给和给了 ground、area：${tables.length} 座沙盘，${all.length} 个画面，${placements} 条题签，摆出来的一个数不差`);
    },
    60_000,
  );

  it(
    '给了一块：没有一条题签压着它，也没有一条引线从它上面穿过去；指着它里面一点的那一条，引线从里面出来',
    () => {
      // 先是编的一个画面：a 指的那一点就在那一块里面（小像站在这个地名点上），b、c 在它旁边
      const box: AvoidBox = { x0: 390, y0: 264, x1: 410, y1: 308 };
      const three = input({ strips: strips('a', 'b', 'c'), anchors: [at('a', 400, 300), at('b', 400, 380), at('c', 452, 290)] });
      const without = placeStrips(three);
      // 没有那一块的时候，a 摆在正上方，正好压着它（不然这个测试什么也没查）
      expect(touches(rectOf(without[0], { w: W, h: H }), box)).toBe(true);
      const withBox = placeStrips({ ...three, avoid: [box] });
      expect(withBox.map((p) => p.hidden)).toEqual([false, false, false]);
      for (const p of withBox) {
        expect(touches(rectOf(p, { w: W, h: H }), box), `${p.id} 压着那一块`).toBe(false);
        if (p.id !== 'a') expect(passes(p.leader!, box), `${p.id} 的引线穿过那一块`).toBe(false);
      }
      // a 的引线从那一块里面出来：起头就是它指的那一点
      expect(withBox[0].leader!.slice(0, 2)).toEqual([400, 300]);
      expect(insideBox({ x: withBox[0].leader![0], y: withBox[0].leader![1] }, box)).toBe(true);
      // 只有一条、指的点在那一块正下方：不给那一块时它摆在正上方，压着那一块；给了以后换了地方，引线也不从那一块上穿过去
      const below = input({ anchors: [at('a', 400, 340)] });
      expect(touches(rectOf(placeStrips(below)[0], { w: W, h: H }), box)).toBe(true);
      const aside = placeStrips({ ...below, avoid: [box] })[0];
      expect(aside.hidden).toBe(false);
      expect(touches(rectOf(aside, { w: W, h: H }), box)).toBe(false);
      expect(passes(aside.leader!, box)).toBe(false);

      // 再是真的全程沙盘：小像依次站在每一条站名题签指的那一点上（那一块照 view.ts 的量法：左右各 10，往上 36，往下 8）
      let cases = 0;
      let moved = 0;
      for (const key of realSceneKeys('route')) {
        const R = realRouteScene(key);
        for (const pane of STANDARD_PANES)
          for (const section of R.scene.sections) {
            const given = realInput(R.scene, R.coords, R.samplers, section, pane, routeSectionStrips(R.scene, section.heading, pane.size.width));
            const plain = placeStrips(given);
            for (const anchor of given.anchors) {
              const strip = R.scene.strips.find((s) => s.id === anchor.id);
              if (!anchor.visible || !strip || !('of' in strip) || !R.scene.places.some((place) => place.id === strip.of)) continue;
              const stand: AvoidBox = { x0: anchor.x - 10, y0: anchor.y - 36, x1: anchor.x + 10, y1: anchor.y + 8 };
              const result = placeStrips({ ...given, avoid: [stand] });
              cases++;
              if (JSON.stringify(result) !== JSON.stringify(plain)) moved++;
              result.forEach((p, i) => {
                if (p.hidden) return;
                const where = `${key} ${pane.name} ${section.heading}，小像在 ${anchor.id}：${p.id}`;
                expect(touches(rectOf(p, given.strips[i]), stand), `${where} 压着他`).toBe(false);
                const own = given.anchors.find((a) => a.id === p.id)!;
                if (!insideBox(own, stand)) expect(passes(p.leader!, stand), `${where} 的引线从他身上穿过去`).toBe(false);
              });
            }
          }
      }
      expect(cases).toBeGreaterThan(0);
      // 这一块不是白给的：有的画面上题签真的为它挪了位置
      expect(moved).toBeGreaterThan(0);
      console.log(`全程沙盘上小像站在各个地名点上：${cases} 个画面，其中 ${moved} 个画面上有题签为他挪了位置；没有一条压着他、引线穿过他`);
    },
    60_000,
  );

  it('给了一块，手还按着沙盘（moving）：原来的位置压着它的那一条先藏起来，不挪别的', () => {
    const three = input({ strips: strips('a', 'b', 'c'), anchors: [at('a', 300, 300), at('b', 500, 300), at('c', 650, 420)] });
    const before = placeStrips(three);
    expect(before.map((p) => p.hidden)).toEqual([false, false, false]);
    // 那一块正压在 b 现在的位置上（b 指的点不在它里面）
    const r = rectOf(before[1], { w: W, h: H });
    const box: AvoidBox = { x0: r.x0 + 4, y0: r.y0 + 10, x1: r.x1 - 4, y1: r.y0 + 40 };
    expect(insideBox({ x: 500, y: 300 }, box)).toBe(false);
    const held = placeStrips({ ...three, avoid: [box] }, before, { moving: true });
    // b 先藏起来，缘故是 room，号还记着；a、c 一个数不动
    expect(held[1]).toEqual({ id: 'b', x: 500, y: 300, hidden: true, leader: null, why: 'room', slot: before[1].slot });
    expect(held[0]).toEqual(before[0]);
    expect(held[2]).toEqual(before[2]);
    // 手放开以后的那一次：b 换一个不压那一块的位置摆出来，别的还在原处
    const released = placeStrips({ ...three, avoid: [box] }, held);
    expect(released[1].hidden).toBe(false);
    expect(touches(rectOf(released[1], { w: W, h: H }), box)).toBe(false);
    expect(released[0]).toEqual(before[0]);
    expect(released[2]).toEqual(before[2]);
    // 那一块拿走了，手还按着：b 摆回原来的号上
    expect(placeStrips(three, held, { moving: true })).toEqual(before);
  });
});

// 小像在画面上：多大，站在哪，题签怎么让开他，头探不探出沙盘的那一块。在 Node 里跑，不要浏览器。
// 真的：全程沙盘的场景和算出来的地面、行迹（时间轴用的那一份）、镜头（src/stage/three/rig.ts 的 placeCamera，沙盘程序用的就是它）、
// 小像站在哪（src/stage/pieceWhere.ts，页面那一边的 whereAt）、小像的模型（src/stage/three/piece.ts）、
// 题签的摆法（src/stage/overlay/placeStrips.ts 和全程沙盘用的 placeAround.ts）。他站在线上、沙盘平时没有立名字的一处的时候，
// 旁边多一条写着那一处名字的题签（没有印），照沙盘程序的做法添在这一节的题签的最后、指着他脚下。画面是 ./support/standardPanes.ts 里带着时间轴的各种栏
//（人物页的四种、首页宽屏上的两种、别的竖着拿的平板五种）：小像只在这些栏上有。题签多大照 ./support/stripSizes.ts。
// 小像在画面上占的那一块照沙盘程序的算法（view.ts）：脚下那一点左右各 10 像素，从帽顶到脚下再多 8 像素。
// 他站着的时候沙盘摆着哪一节：时间轴停着，沙盘栏摆的是这一段该看的那一节（落在哪一站讲的年月里就是那一站的那一节，不然是全程）；
// 读者没动过时间轴、或者正拖着的时候摆着的是全程。所以每一处都在这两节上查（那一节里看不见他的不算）。
// 沙盘程序真的把这一块交给题签层、他在路上走的时候不交，在 route-view.test.ts（假的渲染器）。

import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import type { ItineraryBar } from '../../src/domain/itinerary';
import type { NamesMode, RouteSection, SceneStrip } from '../../src/domain/scene';
import { placeStrips } from '../../src/stage/overlay';
import { LEADER_MAX_PX, NAME_LEADER_MAX_PX, PIECE_NAME, SLOTS, aroundPiece, leavesAt, touches } from '../../src/stage/overlay/placeAround';
import type { StripInput, StripPlacement } from '../../src/stage/overlay';
import { pieceWhere } from '../../src/stage/pieceWhere';
import { PIECE_PX, buildPiece } from '../../src/stage/three/piece';
import { centreShift, equivalentDistance, placeCamera, project, screenAnchors } from '../../src/stage/three/rig';
import { styleFor } from '../../src/stage/three/style';
import type { PiecePlace, StageInsets } from '../../src/stage/types';
import { sectionAt } from '../../src/timebar/barState';
import { whereAt } from '../../src/timebar/barWhere';
import { readBytes } from '../support/readBytes';
import { realRouteScene, realSceneKeys } from './support/realScenes';
import { NOTICE_HEAD_PX, ROUTE_HOME_PANES, ROUTE_NOTICE_ROW_TOP, ROUTE_PANES, ROUTE_UPRIGHT_PANES, STANDARD_PANES } from './support/standardPanes';
import { routeSectionStrips, stripSize, stripSizeKind } from './support/stripSizes';

const KEY = realSceneKeys('route')[0];
const [FIGURE] = KEY.split('/');
const R = realRouteScene(KEY);
const style = styleFor(R.scene.style);
const bar = JSON.parse(new TextDecoder().decode(readBytes(`content/figures/${FIGURE}/itinerary.bar.json`))) as ItineraryBar;
const NAMES: NamesMode[] = ['ancient', 'modern'];
const WHOLE = R.scene.sections[0];
/** 小像在画面上占的那一块：脚下那一点左右各多少像素，往下多少像素（view.ts 里的两个数）。 */
const HALF = 10;
const UNDER = 8;
/** 折算过的远近是 1 米时，沙盘里的 1 米合多少像素（piece.ts 里的那个数）。 */
const FOCAL_PX = 2428;

interface Pane {
  name: string;
  size: { width: number; height: number };
  insets: StageInsets;
}
const plain = ({ name, size, insets }: Pane): Pane => ({ name, size, insets });
/** 人物页的四种栏、首页宽屏上的两种：都带着时间轴。 */
const STANDARD: Pane[] = [...ROUTE_PANES.map(plain), ...ROUTE_HOME_PANES.slice(0, 2).map(plain)];
/** 连别的竖着拿的平板。 */
const ALL: Pane[] = [...STANDARD, ...ROUTE_UPRIGHT_PANES.map(plain)];
/** 读者点了“试试立体的沙盘”以后：按钮下面那一行话留着，它下面再给小像留出 36 像素。 */
const underNotice = (pane: Pane): { pane: Pane; row: number } => {
  const row = ROUTE_NOTICE_ROW_TOP[pane.name] ?? ROUTE_NOTICE_ROW_TOP[ROUTE_PANES[pane.size.width > pane.size.height ? 0 : 2].name];
  return { pane: { name: `${pane.name}，上面多一行话`, size: pane.size, insets: { ...pane.insets, top: row + NOTICE_HEAD_PX } }, row };
};

/** 一节的镜头在一种画面上摆好（同 route-views.test.ts 的那一个）：题签指的各点，把沙盘里的一点投到画面上，小像多大。 */
function placed(section: RouteSection, pane: Pane) {
  const { scene, coords, samplers } = R;
  const view = placeCamera(section, scene, samplers, coords, style, pane.size, pane.insets);
  const camera = new PerspectiveCamera(view.pose.fov, pane.size.width / pane.size.height, Math.max(60, view.distanceM * 0.1), view.distanceM * 3 + 30000);
  camera.position.set(...view.pose.position);
  camera.lookAt(...view.pose.target);
  const [shiftX, shiftY] = centreShift(pane.insets);
  if (shiftX || shiftY) camera.setViewOffset(pane.size.width, pane.size.height, -shiftX, -shiftY, pane.size.width, pane.size.height);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  const written = section.strips.map((id) => scene.strips.find((s) => s.id === id)).filter((s): s is SceneStrip => s !== undefined);
  const D = equivalentDistance(view.distanceM, view.pose.fov, pane.size.height);
  const anchors = screenAnchors(written, scene, samplers, coords, style, D, camera, pane.size);
  /** 小像的模型放大了多少倍（piece.ts 的 size）。 */
  const tall = (PIECE_PX * Math.max(1, D)) / FOCAL_PX;
  const sea = scene.water.levels.values.normal ?? -Infinity;
  const lift = style.route?.roads.liftM ?? 0;
  /** 小像站在这里的时候，在画面上的哪里：脚下那一点、多高、占的那一块；沙盘上没有这个地方是 null。 */
  const figure = (where: PiecePlace): { x: number; y: number; h: number; box: { x0: number; y0: number; x1: number; y1: number } } | null => {
    const at = pieceWhere(scene, coords, where);
    if (!at) return null;
    const foot: [number, number, number] = [at[0], coords.y(Math.max(samplers.height(at[0], at[1]), sea)) + lift, at[1]];
    const p = project(foot, camera, pane.size);
    const h = p.y - project([foot[0], foot[1] + tall, foot[2]], camera, pane.size).y;
    return { x: p.x, y: p.y, h, box: { x0: p.x - HALF, y0: p.y - h, x1: p.x + HALF, y1: p.y + UNDER } };
  };
  return { written, anchors, figure };
}

const leaderPx = (p: StripPlacement): number => (p.leader ? Math.hypot(p.leader[2] - p.leader[0], p.leader[3] - p.leader[1]) : 0);
const rectOf = (p: StripPlacement, s: { w: number; h: number }) => ({ x0: p.x - s.w / 2, y0: p.y - s.h / 2, x1: p.x + s.w / 2, y1: p.y + s.h / 2 });
const overlap = (a: { x0: number; y0: number; x1: number; y1: number }, b: { x0: number; y0: number; x1: number; y1: number }): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
const same = (a: StripPlacement, b: StripPlacement): boolean => a.hidden === b.hidden && a.x === b.x && a.y === b.y && a.slot === b.slot && JSON.stringify(a.leader) === JSON.stringify(b.leader);
/** 他的脚在不在画面留出来的那一块里（左右、下边；上边可以探出去）。 */
const footSeen = (f: { x: number; y: number }, pane: Pane): boolean => f.x >= pane.insets.left && f.x <= pane.size.width - pane.insets.right && f.y >= pane.insets.top && f.y <= pane.size.height - pane.insets.bottom;

/** 每一段从第几天起。 */
const startOf = (i: number): number => (i === 0 ? 0 : bar.stretches[i - 1].until);
const lastDay = bar.stretches[bar.stretches.length - 1].until;
/** 他停着的各处：每一段站在一处的（站、别的有名字的地方、线上没有立名字的一处）取正中间的一天；最后一天。 */
const STANDING: { name: string; day: number }[] = [
  ...bar.stretches.flatMap((stretch, i) => (stretch.place !== undefined || stretch.spot ? [{ name: `${stretch.id} ${stretch.label}`, day: (startOf(i) + stretch.until) / 2 }] : [])),
  { name: '最后一天', day: lastDay },
];
/** 停在路上的日子：每一段路的八分之一、八分之二……八分之七处（左右键一下一下走到的地方）。 */
const ON_ROAD: { name: string; day: number }[] = bar.stretches.flatMap((stretch, i) =>
  stretch.ways ? [1, 2, 3, 4, 5, 6, 7].map((k) => ({ name: `${stretch.id} ${stretch.label} ${k}/8`, day: startOf(i) + ((stretch.until - startOf(i)) * k) / 8 })) : [],
);
/** 这一天时间轴停着的时候沙盘栏摆的那一节；和全程（没动过时间轴、正拖着的时候）。两个是同一节的只算一次。 */
function sectionsFor(day: number): RouteSection[] {
  const own = R.scene.sections.find((section) => section.heading === sectionAt(bar, R.scene.sections, day)) ?? WHOLE;
  return own === WHOLE ? [WHOLE] : [own, WHOLE];
}

describe(`${KEY} 上的小像：多大`, () => {
  it('小像一批画完，不超过 300 个三角形', () => {
    const colours = style.piece;
    if (!colours) throw new Error('样式里没有小像的颜色');
    const piece = buildPiece(colours, style.light('day').dir);
    const index = piece.mesh.geometry.getIndex();
    expect(index).not.toBeNull();
    const triangles = (index?.count ?? 0) / 3;
    expect(triangles).toBeGreaterThan(100);
    expect(triangles).toBeLessThanOrEqual(300);
    // 一个网格、一种材质：一批画完
    expect(Array.isArray(piece.mesh.material)).toBe(false);
    // 模型从脚到帽顶高 1，最宽的地方（底座）半径 0.2：头、帽子都没有超出去
    const position = piece.mesh.geometry.getAttribute('position');
    let top = -Infinity;
    let wide = 0;
    for (let i = 0; i < position.count; i++) {
      top = Math.max(top, position.getY(i));
      wide = Math.max(wide, Math.hypot(position.getX(i), position.getZ(i)));
    }
    expect(top).toBeCloseTo(1, 6);
    expect(wide).toBeCloseTo(0.2, 6);
    piece.dispose();
  });

  it('小像的颜色是定下来的那一套：赭石的底座、印泥红的边、花青的袍子、墨色的高帽；脸是深一点的陶土色（比题签的纸、比原来的那一种都深）', () => {
    expect(style.piece).toEqual({ base: '#a8643c', rim: '#b03a2a', robe: '#30486a', head: '#d4a373', cap: '#1f1b18' });
    // 深浅照红绿蓝三个数加起来比：脸比原来的那一种（#e2bd95）深，比袍子、帽子浅得多（脸和袍子、帽子分得开）
    const sum = (hex: string): number => [1, 3, 5].reduce((total, i) => total + parseInt(hex.slice(i, i + 2), 16), 0);
    const { head, robe, cap } = style.piece as { head: string; robe: string; cap: string };
    expect(sum(head)).toBeLessThan(sum('#e2bd95'));
    expect(sum(head)).toBeGreaterThan(sum(robe) + 150);
    expect(sum(head)).toBeGreaterThan(sum(cap) + 150);
  });

  it('在画面上总是那么高：全程 32 像素上下，凑近的几节 36 像素上下，各种画面上差不出百分之八', () => {
    const lines: string[] = [];
    for (const section of R.scene.sections) {
      const heights: number[] = [];
      for (const pane of ALL) {
        const { figure } = placed(section, pane);
        for (const place of R.scene.places) {
          const f = figure({ on: 'place', place: place.id });
          if (f && footSeen(f, pane)) heights.push(f.h);
        }
      }
      expect(heights.length, section.heading).toBeGreaterThan(0);
      const [low, high] = [Math.min(...heights), Math.max(...heights)];
      lines.push(`${section.heading} ${low.toFixed(1)}–${high.toFixed(1)}`);
      // 这一节的倾角定了他多高：平着看是 PIECE_PX，斜着看矮一些
      const want = PIECE_PX * Math.sin((section.camera.pitch * Math.PI) / 180);
      expect(low, section.heading).toBeGreaterThan(want * 0.92);
      expect(high, section.heading).toBeLessThan(want * 1.08);
      expect((high - low) / low, section.heading).toBeLessThan(0.08);
    }
    // 全程那一节（看得最斜）三十二像素上下；别的各节不比它矮，最高三十六七像素
    const whole = placed(WHOLE, STANDARD[0]).figure({ on: 'place', place: R.scene.places[0].id });
    expect(whole?.h).toBeGreaterThan(30);
    expect(whole?.h).toBeLessThan(34);
    console.log(`小像在各节的画面上多高（像素，各种栏、看得见的各个地名点里最矮到最高）：${lines.join('，')}`);
  });
});

describe(`${KEY} 上的小像：题签只挪碰着他的那几条`, () => {
  type Line = readonly [number, number, number, number];
  /**
   * 只挪碰着他的那几条的摆法，照原样写在这里对着查（placeAround.ts 平常走的就是这两步）：先照没有他摆；碰着他的各条另找位置，
   * 别的带着号留在原处；找不到位置的留在原处。
   */
  function onlyTouched(input: StripInput, boxes: { x0: number; y0: number; x1: number; y1: number }[]): { placed: StripPlacement[]; hit: boolean[]; stuck: boolean[] } {
    const base = placeStrips({ ...input, avoid: undefined });
    const hit = base.map((p, i) => !!p.leader && boxes.some((box) => touches(p.x, p.y, input.strips[i].w, input.strips[i].h, p.leader as Line, box)));
    if (!hit.includes(true)) return { placed: base, hit, stuck: hit };
    const again = placeStrips({ ...input, avoid: boxes, strips: input.strips.map((strip, i) => (hit[i] ? strip : { ...strip, rank: strip.rank - 1e6 })) }, base.filter((_, i) => !hit[i]), { moving: true });
    // stuck：碰着了、又找不到别的位置、留在原处的
    return { placed: again.map((p, i) => (hit[i] && p.hidden ? base[i] : p)), hit, stuck: again.map((p, i) => hit[i] && p.hidden) };
  }
  /** 引线落在他身上的那一截不画：照 placeAround.ts 的算法给一份摆法补上 from。 */
  const trimmed = (placements: StripPlacement[], box: { x0: number; y0: number; x1: number; y1: number }): StripPlacement[] =>
    placements.map((p) => {
      const from = p.leader ? leavesAt(p.leader as Line, box) : 0;
      return from > 0 ? { ...p, from } : p;
    });
  /** 题签占的那一块离一点多远（像素；点在那一块里面是 0）。 */
  const gapTo = (r: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number): number => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.y0 - y, 0, y - r.y1));
  type Rect = { x0: number; y0: number; x1: number; y1: number };
  /** 两块隔着多远（像素；叠着、挨着是 0）。 */
  const gapBetween = (a: Rect, b: Rect): number => Math.hypot(Math.max(b.x0 - a.x1, 0, a.x0 - b.x1), Math.max(b.y0 - a.y1, 0, a.y0 - b.y1));
  /** 一条摆好的题签的引线，从他占的那一块的边上量多长（像素）；没摆出来是无穷大。 */
  const leaderFromHim = (p: StripPlacement, box: Rect): number => (p.hidden || !p.leader ? Infinity : leaderPx(p) * (1 - leavesAt(p.leader as Line, box)));
  /**
   * 他旁边的名字摆在 p（多大是 size）：占的那一块离别的题签指的哪一点比离他占的那一块还近？是的话交回最近的那一点
   *（哪一条的、离那一点多远、离他多远）；不是，交回 null。别的题签指的点：画面里看得见的每一点，名字自己指的他脚下不算。
   */
  function against(p: StripPlacement, size: { w: number; h: number }, box: Rect, anchors: StripInput['anchors']): { id: string; px: number; his: number } | null {
    const rect = rectOf(p, size);
    const his = gapBetween(rect, box);
    let worst: { id: string; px: number; his: number } | null = null;
    for (const anchor of anchors) {
      if (anchor.id === PIECE_NAME || !anchor.visible) continue;
      const px = gapTo(rect, anchor.x, anchor.y);
      if (px < his && px < (worst?.px ?? Infinity)) worst = { id: anchor.id, px, his };
    }
    return worst;
  }
  /** 他的名字照“手还在动”的规矩只试一个号：站得上去就交回来（引线落在他身上的那一截去掉），站不上去是藏着的一条。 */
  const probe = (from: StripInput, fixed: StripPlacement[], slot: number, box: Rect): StripPlacement =>
    trimmed([placeStrips(from, [...fixed, { id: PIECE_NAME, x: 0, y: 0, hidden: true, leader: null, slot }], { moving: true })[from.strips.length - 1]], box)[0];
  /** 让他的名字站在 q、别的只挪碰着他、碰着它的那几条的话：摆出来的一份，和让不让得开（没有一条没处让，没有一条让到 40 像素以外）。 */
  function stepAside(input: StripInput, box: Rect, q: StripPlacement, size: { w: number; h: number }) {
    const reference = onlyTouched(input, [box, rectOf(q, size)]);
    const pushed = reference.placed.flatMap((p, i) => (reference.stuck[i] ? [{ id: p.id, why: '没处让' }] : reference.hit[i] && leaderPx(p) > NAME_LEADER_MAX_PX ? [{ id: p.id, why: `要让到 ${leaderPx(p).toFixed(0)} 像素远` }] : []));
    return { reference, pushed };
  }
  /**
   * 不靠 SLOTS 另数一遍：他的名字能站的每一个号（四边的号 0 到 399，绕着圈找的号 1000 起的四十圈）一个一个试，
   * 站得上去、引线不超过 40 像素的有几个（near），其中不挨着别的地名点的有几个（clear）；给了 input 的（让它先挑的那一回），
   * 再数其中别的题签也让得开的有几个（clean），让不开的头一个是为什么（why）。
   */
  function freeSlots(from: StripInput, fixed: StripPlacement[], box: Rect, input?: StripInput): { near: number; clear: number; clean: number; why: string } {
    const size = from.strips[from.strips.length - 1];
    const count = { near: 0, clear: 0, clean: 0, why: '' };
    for (const slot of [...Array.from({ length: 400 }, (_, i) => i), ...Array.from({ length: 640 }, (_, i) => 1000 + i)]) {
      const q = probe(from, fixed, slot, box);
      if (leaderFromHim(q, box) > NAME_LEADER_MAX_PX) continue;
      count.near++;
      if (against(q, size, box, from.anchors)) continue;
      count.clear++;
      if (!input) continue;
      const { pushed } = stepAside(input, box, q, size);
      if (pushed.length === 0) count.clean++;
      else if (!count.why) count.why = pushed.map((one) => `${one.id} ${one.why}`).join('、');
    }
    return count;
  }
  /** 他的名字最后才摆的那一回交给 placeStrips 的：别的题签带着号排在前头，都躲着他占的那一块。 */
  const nameLast = (full: StripInput, box: Rect): StripInput => ({ ...full, strips: full.strips.map((strip) => (strip.id === PIECE_NAME ? strip : { ...strip, rank: strip.rank - 1e6 })), avoid: [box] });
  /** 让他的名字先挑的那一回交给 placeStrips 的：它排在最前头，躲着他占的那一块。 */
  const nameFirst = (full: StripInput, box: Rect): StripInput => ({ ...full, strips: full.strips.map((strip) => (strip.id === PIECE_NAME ? { ...strip, rank: -1 } : strip)), avoid: [box] });
  /**
   * placeAround.ts 给他旁边的名字找位置的做法，照原样写在这里对着查。input 是别的题签，full 是连名字，touched 是别的题签只挪碰着他的那几条摆出来的。
   * 交回它该站在哪（mine）、别的题签该怎么摆（others）、是哪一种：
   *   plain  最后才摆，别的一条不为它动。swapped：挑出来的位置挨着别的地名点，照 SLOTS 的先后换成了头一个不挨着的空位；
   *          shy：挨着，可是两回都找不到不挨着的，留在原处；
   *   aside  让它先挑（照 SLOTS 的先后，头一个站得上去、离他近、不挨着别的点、别的题签又让得开的号），别的只挪碰着他、碰着它的那几条。
   *          had：最后才摆也摆得成，只是都挨着别的点；
   *   whole  两样都不成：整个重摆（others 不给）。
   */
  function nameByTheMethod(input: StripInput, full: StripInput, box: Rect, touched: StripPlacement[]) {
    const n = full.strips.length - 1;
    const size = full.strips[n];
    const [last, first] = [nameLast(full, box), nameFirst(full, box)];
    const after = placeStrips(last, touched, { moving: true });
    const picked = trimmed([after[n]], box)[0];
    const good = (q: StripPlacement): boolean => leaderFromHim(q, box) <= NAME_LEADER_MAX_PX && !against(q, size, box, full.anchors);
    const had = leaderFromHim(picked, box) <= NAME_LEADER_MAX_PX && touched.every((p, i) => same(p, after[i]));
    const none = touched.map(() => false);
    if (had && good(picked)) return { kind: 'plain' as const, mine: picked, others: touched, forName: none, swapped: false, shy: false, had };
    if (had)
      for (const slot of SLOTS) {
        const q = probe(last, touched, slot, box);
        if (good(q)) return { kind: 'plain' as const, mine: q, others: touched, forName: none, swapped: true, shy: false, had };
      }
    for (const slot of SLOTS) {
      const q = probe(first, [], slot, box);
      if (!good(q)) continue;
      const { reference, pushed } = stepAside(input, box, q, size);
      if (pushed.length === 0) return { kind: 'aside' as const, mine: q, others: reference.placed, forName: reference.hit, swapped: false, shy: false, had };
    }
    if (had) return { kind: 'plain' as const, mine: picked, others: touched, forName: none, swapped: false, shy: true, had };
    return { kind: 'whole' as const, mine: null, others: null, forName: none, swapped: false, shy: false, had };
  }

  /**
   * 一种栏、一节、一种名字、他在一处。without 是没有他时怎么摆；touched 是只挪碰着他的那几条摆出来的；withHim 是沙盘上真的摆法
   *（他站在线上没有立名字的一处的时候，最后多一条他旁边的名字 mine）。mode 是这一回是哪一种摆法：
   *   plain  平常：别的题签就是 touched，他的名字最后才摆、谁也不为它动；
   *   aside  他近处没有空位：他的名字先挑，别的只挪碰着他、碰着它的那几条（forName 是碰着它的）；
   *   whole  整个重摆：每一条都躲着他从头挑。
   */
  function around(pane: Pane, section: RouteSection, names: NamesMode, where: PiecePlace) {
    const { anchors, figure, written } = placed(section, pane);
    const f = figure(where);
    if (!f || !footSeen(f, pane)) return null;
    const strips = routeSectionStrips(R.scene, section.heading, pane.size.width, names);
    const input: StripInput = { strips, anchors, size: pane.size, insets: pane.insets };
    const without = placeStrips(input);
    const { placed: touched, hit } = onlyTouched(input, [f.box]);
    // 他旁边立出的名字：选了今名、这一处又有今名的写今名；没有印；排在最后，指着他脚下
    const nameText = where.on === 'spot' ? (names === 'modern' && where.modern ? where.modern : where.name) : null;
    const full: StripInput =
      nameText === null
        ? input
        : { ...input, strips: [...strips, { id: PIECE_NAME, ...stripSize(nameText, stripSizeKind(pane.size.width)), rank: strips.length }], anchors: [...anchors, { id: PIECE_NAME, x: f.x, y: f.y, visible: true }] };
    const all = aroundPiece()({ ...full, avoid: [f.box] });
    const withHim = all.slice(0, strips.length);
    const mine = nameText === null ? null : all[strips.length];
    // 有他旁边的名字的：照 nameByTheMethod 另摆一遍来比，摆出来的一样，就是那一种；不一样（或者那个做法说该整个重摆）算整个重摆，下面再对
    const method = mine && nameText !== null ? nameByTheMethod(input, full, f.box, touched) : null;
    let mode: 'plain' | 'aside' | 'whole' = withHim.some((p, i) => !same(p, touched[i])) ? 'whole' : 'plain';
    let forName: boolean[] = hit.map(() => false);
    if (method && mine) {
      mode = method.mine && method.others && same(mine, method.mine) && withHim.every((p, i) => same(p, (method.others as StripPlacement[])[i])) ? method.kind : 'whole';
      // 给它让开的：碰着它、又没有碰着他的那几条
      if (mode === 'aside') forName = method.forName.map((touchedEither, i) => touchedEither && !hit[i]);
    }
    const text = (id: string): string => {
      const strip = written.find((s) => s.id === id);
      return strip ? (names === 'modern' && strip.modern ? strip.modern : strip.text) : id;
    };
    return { f, input, full, without, touched, hit, forName, withHim, all, mine, nameText, mode, method, anchors, text };
  }
  type Around = NonNullable<ReturnType<typeof around>>;
  /**
   * 有没有两条题签对调了位置：各自离对方指的那一点，比离自己指的那一点还近。placements 是哪一种摆法（不给就是有他时真的摆法）。
   * 没有他的时候本来就这样的不算他的事（出川那一节“眉州”和“岷江”的两点挨得很近）：beyond 只说有他以后才有的。
   */
  function swapped(got: Around, placements: StripPlacement[] = got.withHim): string[] {
    const out: string[] = [];
    const at = (id: string) => got.anchors.find((anchor) => anchor.id === id);
    placements.forEach((p, i) => {
      placements.forEach((q, j) => {
        if (j <= i || p.hidden || q.hidden) return;
        const [pa, qa] = [at(p.id), at(q.id)];
        if (!pa || !qa) return;
        const [pr, qr] = [rectOf(p, got.input.strips[i]), rectOf(q, got.input.strips[j])];
        if (gapTo(pr, qa.x, qa.y) < gapTo(pr, pa.x, pa.y) && gapTo(qr, pa.x, pa.y) < gapTo(qr, qa.x, qa.y)) out.push(`“${got.text(p.id)}”和“${got.text(q.id)}”`);
      });
    });
    return out;
  }
  const beyond = (got: Around): string[] => {
    const already = swapped(got, got.without);
    return swapped(got).filter((pair) => !already.includes(pair));
  };
  /** 他旁边那一条名字的引线，从他占的那一块的边上量多长（像素）。 */
  const nameLeader = (got: Around): number => (got.mine?.leader ? leaderPx(got.mine) * (1 - (got.mine.from ?? 0)) : Infinity);

  it('小像站在每一个站的地名点上、线上没有立名字的每一处、最后一天，停在每一趟路的各处：没有碰着他的题签一条也不动——只有碰着他的一条让开以后引线比 70 像素还长（或者他旁边的名字摆不到 40 像素以内）的那几回整个重摆，那几回哪几条没碰着他的也动了印出来；没有一条题签因为他摆不下（带着时间轴的每一种栏上都查，数打印出来）', { timeout: 240_000 }, () => {
    expect(LEADER_MAX_PX).toBe(70);
    expect(NAME_LEADER_MAX_PX).toBe(40);
    const totals = { cases: 0, strips: 0, touched: 0, moved: 0, movedUntouched: 0, movedForName: 0, lost: 0, whole: 0, aside: 0 };
    const wholes = new Map<string, Set<string>>();
    const asides = new Map<string, Set<string>>();
    for (const [kind, list] of [['站着', STANDING], ['停在路上', ON_ROAD]] as const) {
      for (const pane of ALL) {
        let cases = 0;
        let touched = 0;
        let moved = 0;
        let whole = 0;
        for (const { name, day } of list) {
          const where = whereAt(bar, Math.min(day, lastDay - 1e-6));
          if (!where) continue;
          for (const section of sectionsFor(day)) {
            for (const names of NAMES) {
              const got = around(pane, section, names, where);
              if (!got) continue;
              cases++;
              const state = `${kind}，${pane.name} ${section.heading} ${name}`;
              if (got.mode === 'whole') {
                whole++;
                // 整个重摆只在两种时候：只挪碰着他的那几条的话，有一条的引线比 70 像素还长；或者他旁边的名字摆不到 40 像素以内、让它先挑以后别的又有一条让得太远
                const far = got.touched.some((p, i) => got.hit[i] && leaderPx(p) > LEADER_MAX_PX);
                expect(far || got.nameText !== null, `${state}：没有哪一条让得太远，却整个重摆了`).toBe(true);
                // 那一回摆出来的就是“每一条都躲着他从头摆”（有他旁边的名字的，名字排在最前头先挑）
                expect(got.all, state).toEqual(trimmed(placeStrips({ ...got.full, strips: got.full.strips.map((strip) => (strip.id === PIECE_NAME ? { ...strip, rank: -1 } : strip)), avoid: [got.f.box] }), got.f.box));
                if (!wholes.has(state)) wholes.set(state, new Set());
              } else if (got.mode === 'aside') {
                // 给他的名字让开：他的名字先挑，别的只挪碰着他、碰着它的（around 里已经照那个做法对过）
                totals.aside++;
                if (!asides.has(state)) asides.set(state, new Set());
              } else {
                // 平常：摆出来的就是“只挪碰着他的那几条”（他旁边的名字不算在里面：它最后才摆，别的都不为它动）
                got.withHim.forEach((p, i) => expect(same(p, got.touched[i]), `${state} ${names}：“${got.text(p.id)}”`).toBe(true));
              }
              got.without.forEach((before, i) => {
                const after = got.withHim[i];
                totals.strips++;
                if (got.hit[i]) touched++;
                if (!before.hidden && after.hidden) totals.lost++;
                if (same(before, after)) return;
                moved++;
                if (got.hit[i]) return;
                // 没碰着他却动了的：碰着他旁边的名字（给它让开的那几回），印出来
                if (got.forName[i]) {
                  totals.movedForName++;
                  asides.get(state)?.add(`“${got.text(before.id)}”`);
                  return;
                }
                // 再就只许在整个重摆的那几回，也印出来
                totals.movedUntouched++;
                expect(got.mode, `${state} ${names}：“${got.text(before.id)}”没有碰着他，却从 (${before.x}, ${before.y}) 挪到了 (${after.x}, ${after.y})`).toBe('whole');
                wholes.get(state)?.add(`“${got.text(before.id)}”`);
              });
            }
          }
        }
        totals.cases += cases;
        totals.touched += touched;
        totals.moved += moved;
        totals.whole += whole;
        console.log(`${kind}，${pane.name}：${cases} 种摆法（哪一处 × 哪一节 × 古今名字）里，碰着他的题签 ${touched} 条，挪开了 ${moved} 条；整个重摆的 ${whole} 种`);
      }
    }
    console.log(`一共 ${totals.cases} 种摆法、${totals.strips} 条题签：碰着他的 ${totals.touched} 条，挪开的 ${totals.moved} 条；给他旁边的名字让开的 ${totals.aside} 种摆法（古今名字各算一种）里，碰着那个名字挪开的 ${totals.movedForName} 条；整个重摆的 ${totals.whole} 种摆法，那几回里没碰着他却动了的 ${totals.movedUntouched} 条；因为他摆不下的 ${totals.lost} 条`);
    console.log(asides.size === 0 ? '给他旁边的名字让开的：没有' : `他近处没有空位、让他的名字先挑的 ${asides.size} 处，和那时候碰着它挪开的题签：\n  ${[...asides].map(([state, moved]) => `${state}：${moved.size ? [...moved].join('、') : '（没有别的动）'}`).join('\n  ')}`);
    console.log(wholes.size === 0 ? '整个重摆的：没有' : `整个重摆的 ${wholes.size} 处，和那时候没碰着他也动了的题签：\n  ${[...wholes].map(([state, moved]) => `${state}：${moved.size ? [...moved].join('、') : '（没有别的动）'}`).join('\n  ')}`);
    expect(totals.cases).toBeGreaterThan(2000);
    expect(totals.moved).toBeGreaterThan(0);
    expect(totals.lost).toBe(0);
    // 整个重摆的、给他的名字让开的都是少数
    expect(totals.whole).toBeLessThan(totals.cases / 10);
    expect(totals.aside).toBeLessThan(totals.cases / 10);
  });

  it('小像站在每一个站的地名点上、线上没有立名字的每一处、最后一天（带着时间轴的每一种栏）：没有一条题签压着他，没有一条因为他摆不下，引线最长不超过 70 像素，没有两条题签因为他对调了位置（各自离对方指的那一点比离自己的还近）', { timeout: 240_000 }, () => {
    const over: string[] = [];
    const long: string[] = [];
    const swaps: string[] = [];
    const already = new Set<string>();
    let lost = 0;
    let cases = 0;
    const longest = new Map<string, { px: number; where: string }>();
    for (const pane of ALL) {
      for (const { name, day } of STANDING) {
        const where = whereAt(bar, Math.min(day, lastDay - 1e-6));
        if (!where) continue;
        for (const section of sectionsFor(day)) {
          for (const names of NAMES) {
            const got = around(pane, section, names, where);
            if (!got) continue;
            cases++;
            const state = `${pane.name} ${section.heading} ${names} ${name}`;
            got.withHim.forEach((p, i) => {
              if (p.hidden) {
                if (!got.without[i].hidden) lost++;
                return;
              }
              const at = `${state}：“${got.text(p.id)}”`;
              if (overlap(rectOf(p, got.input.strips[i]), got.f.box)) over.push(at);
              if (leaderPx(p) > (longest.get(pane.name)?.px ?? 0)) longest.set(pane.name, { px: leaderPx(p), where: at });
              if (leaderPx(p) > LEADER_MAX_PX) long.push(`${at} ${leaderPx(p).toFixed(0)} 像素（没有他的时候 ${leaderPx(got.without[i]).toFixed(0)}）`);
            });
            for (const pair of beyond(got)) swaps.push(`${state}：${pair} ${got.withHim.map((p, i) => (same(p, got.touched[i]) ? '' : `[${got.text(p.id)} ${leaderPx(got.touched[i]).toFixed(0)}→${leaderPx(p).toFixed(0)}]`)).join('')}`);
            for (const pair of swapped(got, got.without)) already.add(`${section.heading}：${pair}`);
          }
        }
      }
    }
    console.log(`没有他的时候本来就挨得近、算得上“对调”的：${already.size ? [...already].join("，") : "没有"}`);
    console.log(`他站着的 ${cases} 种摆法里：压着他的题签 ${over.length} 条；超过 ${LEADER_MAX_PX} 像素的 ${long.length} 条；对调了位置的 ${swaps.length} 对。各种栏上最长的引线：\n  ${[...longest].map(([pane, worst]) => `${pane}：${worst.px.toFixed(0)} 像素（${worst.where}）`).join('\n  ')}`);
    expect(cases).toBeGreaterThan(600);
    expect(lost).toBe(0);
    expect(over).toEqual([]);
    expect(long).toEqual([]);
    expect(swaps).toEqual([]);
  });

  it('他站在线上、沙盘平时没有立名字的每一处（连最后一天），带着时间轴的每一种栏，古名今名：旁边立着那一处的名字，没有东西压着他、压着它，它的引线从他占的那一块的边上量不超过 40 像素；它占的那一块离他不比离别的题签指的哪一点远——他近处一个这样的空位也没有的几回除外（连数印出来）；别的题签一条也不为它动——他近处没有空位的几回除外：那几回让它先挑，只有碰着它的题签挪开（印出来）', { timeout: 240_000 }, () => {
    const spots = [...STANDING.filter(({ day }) => whereAt(bar, Math.min(day, lastDay - 1e-6))?.on === 'spot')];
    expect(spots.length).toBeGreaterThan(0);
    let cases = 0;
    let wholes = 0;
    let swappedPlace = 0;
    let firstForPoint = 0;
    const lines: string[] = [];
    const beside: string[] = [];
    const nearest = new Map<string, { px: number; his: number; where: string }>();
    const longest = new Map<string, { px: number; where: string }>();
    const texts = new Set<string>();
    for (const pane of ALL) {
      for (const { name, day } of spots) {
        const where = whereAt(bar, Math.min(day, lastDay - 1e-6));
        if (where?.on !== 'spot') continue;
        for (const names of NAMES) {
          // 这些地方不在哪一站讲的年月里：时间轴停着的时候、拖着的时候，摆着的都是全程
          expect(sectionsFor(day)).toEqual([WHOLE]);
          const got = around(pane, WHOLE, names, where);
          expect(got, `${pane.name} ${name}：他不在画面里`).not.toBeNull();
          if (!got || !got.mine || got.nameText === null) continue;
          cases++;
          texts.add(got.nameText);
          const state = `${pane.name} ${names} ${name}`;
          // 写的是那一处的名字；选了今名、这一处有今名的，写今名
          expect(got.nameText, state).toBe(names === 'modern' && where.modern ? where.modern : where.name);
          // 摆出来了，而且是照做法摆的（nameByTheMethod 另摆了一遍：最后才摆、让它先挑、整个重摆，是哪一种就是哪一种）
          expect(got.mine.hidden, `${state}：他旁边的名字没有摆出来`).toBe(false);
          expect(got.mode, `${state}：名字和别的题签没有照做法摆`).toBe(got.method?.kind);
          const size = got.full.strips[got.full.strips.length - 1];
          const rect = rectOf(got.mine, size);
          // 不压着他；别的题签不压着它（隔着摆的规矩里的那一点空），它也不压着别的题签指的那一点
          expect(overlap(rect, got.f.box), `${state}：名字压着他`).toBe(false);
          got.withHim.forEach((p, i) => {
            if (p.hidden) return;
            expect(overlap(rectOf(p, got.input.strips[i]), rect), `${state}：“${got.text(p.id)}”压着他旁边的名字`).toBe(false);
            expect(overlap(rectOf(p, got.input.strips[i]), got.f.box), `${state}：“${got.text(p.id)}”压着他`).toBe(false);
          });
          for (const anchor of got.anchors) if (anchor.visible) expect(gapTo(rect, anchor.x, anchor.y), `${state}：名字压着“${got.text(anchor.id)}”指的那一点`).toBeGreaterThan(0);
          // 引线从他占的那一块的边上画起，不超过 40 像素
          expect(got.mine.from ?? 0, state).toBeGreaterThan(0);
          const px = nameLeader(got);
          expect(px, `${state}：名字的引线`).toBeLessThanOrEqual(NAME_LEADER_MAX_PX);
          if (px > (longest.get(pane.name)?.px ?? -1)) longest.set(pane.name, { px, where: `${names} ${name}` });
          // 它不挨着别的地名点：占的那一块离他，不比离别的题签指的哪一点远。挨着的话，得是他近处一个不挨着的空位也没有
          //（最后才摆的那一回：别的题签都留在原处；让它先挑的那一回：只有他和各条题签指的点挡着它）。整个重摆的那一回不管，只印出来
          const last = nameLast(got.full, got.f.box);
          const first = nameFirst(got.full, got.f.box);
          const wrong = against(got.mine, size, got.f.box, got.anchors);
          const his = gapBetween(rect, got.f.box);
          const others = got.anchors.filter((anchor) => anchor.id !== PIECE_NAME && anchor.visible).map((anchor) => ({ id: anchor.id, px: gapTo(rect, anchor.x, anchor.y) })).sort((a, b) => a.px - b.px)[0];
          if (others && others.px - his < (nearest.get(pane.name) ? (nearest.get(pane.name) as { px: number; his: number }).px - (nearest.get(pane.name) as { px: number; his: number }).his : Infinity)) nearest.set(pane.name, { px: others.px, his, where: `${names} ${name}，最近的是“${got.text(others.id)}”指的那一点` });
          if (wrong) {
            // 留在挨着别的地名点的地方，得是真的没有办法：别的题签都不动的时候他近处没有不挨着的空位；
            // 让它先挑的话，不挨着的号要么没有，要么站上去别的题签让不开。整个重摆的那一回不管，只印出来
            const freeLast = got.mode === 'plain' ? freeSlots(last, got.touched, got.f.box) : null;
            const freeFirst = got.mode === 'whole' ? null : freeSlots(first, [], got.f.box, got.input);
            if (freeLast) expect(freeLast.clear, `${state}：名字挨着“${got.text(wrong.id)}”指的那一点，可是别的题签都不动的时候他近处还有不挨着别的点的空位`).toBe(0);
            if (freeFirst) expect(freeFirst.clean, `${state}：名字挨着“${got.text(wrong.id)}”指的那一点，可是让它先挑就躲得开，别的题签也让得开`).toBe(0);
            beside.push(
              `${state}（${got.mode === 'plain' ? '最后才摆' : got.mode === 'aside' ? '让它先挑' : '整个重摆'}）：名字离“${got.text(wrong.id)}”指的那一点 ${wrong.px.toFixed(1)} 像素，离他 ${wrong.his.toFixed(1)} 像素；` +
                `别的题签都不动的时候他近处站得上去的号 ${freeLast ? `${freeLast.near} 个，其中不挨着别的点的 ${freeLast.clear} 个` : '（没有数）'}；` +
                `让它先挑的时候 ${freeFirst ? `${freeFirst.near} 个，不挨着别的点的 ${freeFirst.clear} 个，其中别的题签让得开的 ${freeFirst.clean} 个${freeFirst.why ? `（让不开的头一个：${freeFirst.why.replace(/^(\S+)/, (id) => `“${got.text(id)}”`)}）` : ''}` : '（没有数）'}`,
            );
          }
          if (got.mode === 'plain' && got.method?.swapped) swappedPlace++;
          if (got.mode === 'aside' && got.method?.had) firstForPoint++;
          // 别的题签：同没有这个名字的时候一个数不差——除非他近处没有空位（那几回让它先挑，只挪碰着它的那几条），或者整个重摆了
          if (got.mode !== 'plain') {
            wholes++;
            lines.push(`${state}，${got.mode === 'aside' ? '让它先挑' : '整个重摆'}（${got.withHim.filter((p, i) => !same(p, got.touched[i])).map((p) => `“${got.text(p.id)}”`).join('、') || '没有别的'}换了位置）`);
            // 让它先挑的那几回，换了位置的都是碰着它的，或者本来就碰着他、这一回连它也要躲开的
            if (got.mode === 'aside') got.withHim.forEach((p, i) => expect(same(p, got.touched[i]) || got.forName[i] || got.hit[i], `${state}：“${got.text(p.id)}”没有碰着他、也没有碰着他的名字，却动了`).toBe(true));
          } else got.withHim.forEach((p, i) => expect(same(p, got.touched[i]), `${state}：“${got.text(p.id)}”为他的名字动了`).toBe(true));
        }
      }
    }
    // 行迹里写着的每一个名字（连今名）都立出来过
    const written = new Set(bar.stretches.flatMap((stretch) => (stretch.spot ? (stretch.spot.slice(2) as string[]) : [])));
    expect([...texts].sort()).toEqual([...written].sort());
    expect(cases).toBe(ALL.length * spots.length * NAMES.length);
    console.log(`他站在线上没有立名字的各处，一共 ${cases} 种摆法（哪一处 × 哪一种栏 × 古今名字）：名字都立出来了。各种栏上名字的引线最长（从他占的那一块的边上量）：\n  ${[...longest].map(([pane, worst]) => `${pane}：${worst.px.toFixed(0)} 像素（${worst.where}）`).join('\n  ')}`);
    console.log(wholes === 0 ? '他近处没有空位、别的题签为他的名字动了的：没有' : `他近处没有空位、别的题签为他的名字动了的 ${wholes} 种摆法：\n  ${lines.join('\n  ')}`);
    console.log(`最后才摆的那几回里，挑出来的位置挨着别的地名点、照先后换了一个的：${swappedPlace} 种摆法；最后才摆的位置都挨着别的地名点、改成让它先挑的：${firstForPoint} 种摆法`);
    console.log(`各种栏上，名字占的那一块离别的题签指的一点最近的一回（离那一点 − 离他，像素；是正数就是离他更近）：\n  ${[...nearest].map(([pane, worst]) => `${pane}：离那一点 ${worst.px.toFixed(1)}，离他 ${worst.his.toFixed(1)}（${worst.where}）`).join('\n  ')}`);
    console.log(beside.length === 0 ? '名字离别的题签指的一点比离他还近的：没有' : `名字离别的题签指的一点比离他还近、他近处又没有别的空位的 ${beside.length} 种摆法（留在原处）：\n  ${beside.join('\n  ')}`);
  });

  it('每一种栏上他停在路上：没有一条题签压着他，没有一条因为他摆不下；引线超过 70 像素的、对调了位置的各处印出来（不判错：没有他的时候琼州海峡那一条就有九十多像素）', { timeout: 240_000 }, () => {
    const over: string[] = [];
    const long = new Map<string, number>();
    const swaps = new Set<string>();
    let lost = 0;
    let cases = 0;
    for (const pane of ALL) {
      for (const { name, day } of ON_ROAD) {
        const where = whereAt(bar, Math.min(day, lastDay - 1e-6));
        if (!where) continue;
        for (const section of sectionsFor(day)) {
          for (const names of NAMES) {
            const got = around(pane, section, names, where);
            if (!got) continue;
            cases++;
            got.withHim.forEach((p, i) => {
              const before = got.without[i];
              if (p.hidden) {
                if (!before.hidden) lost++;
                return;
              }
              const at = `${pane.name} ${section.heading} ${name}：“${got.text(p.id)}”`;
              if (overlap(rectOf(p, got.input.strips[i]), got.f.box)) over.push(at);
              if (leaderPx(p) > LEADER_MAX_PX) long.set(`${at} ${leaderPx(p).toFixed(0)} 像素（没有他的时候 ${leaderPx(before).toFixed(0)}）`, 1);
            });
            for (const pair of beyond(got)) swaps.add(`${pane.name} ${section.heading} ${name}：${pair}`);
          }
        }
      }
    }
    console.log(`每一种栏上他停在路上，一共 ${cases} 种摆法：压着他的题签 ${over.length} 条；因为他摆不下的 ${lost} 条；引线超过 ${LEADER_MAX_PX} 像素的 ${long.size} 处（古今名字各算一处）${long.size ? `：\n  ${[...long.keys()].join('\n  ')}` : ''}`);
    console.log(swaps.size === 0 ? '停在路上的时候对调了位置的题签：没有' : `停在路上的时候对调了位置的 ${swaps.size} 处：\n  ${[...swaps].join('\n  ')}`);
    expect(cases).toBeGreaterThan(2000);
    expect(lost).toBe(0);
    expect(over).toEqual([]);
  });

  it('引线不画在他身上：他站的那个地名点自己的题签，引线从他占的那一块的边上画起；一帧一帧接着摆，他不动题签也不动；他走了，题签都回到原处', () => {
    let cut = 0;
    let towns = 0;
    for (const pane of STANDARD) {
      for (const { day } of STANDING) {
        const where = whereAt(bar, Math.min(day, lastDay - 1e-6));
        if (where?.on !== 'place') continue;
        for (const section of sectionsFor(day)) {
          const { anchors, figure, written } = placed(section, pane);
          const f = figure(where);
          const own = written.findIndex((strip) => strip.of === where.place);
          if (!f || !footSeen(f, pane) || own < 0) continue;
          towns++;
          const strips = routeSectionStrips(R.scene, section.heading, pane.size.width, 'ancient');
          const input: StripInput = { strips, anchors, size: pane.size, insets: pane.insets, avoid: [f.box] };
          const place = aroundPiece();
          const first = place(input);
          const mine = first[own];
          expect(mine.hidden, `${pane.name} ${section.heading} ${where.place}`).toBe(false);
          // 这一条指的那一点就在他脚下：引线从他占的那一块里出来，画的时候从那一块的边上起
          expect(mine.from, `${pane.name} ${section.heading} ${where.place}`).toBeGreaterThan(0);
          expect(mine.from).toBeLessThan(1);
          const [x1, y1, x2, y2] = mine.leader as [number, number, number, number];
          const start = { x: x1 + (x2 - x1) * (mine.from ?? 0), y: y1 + (y2 - y1) * (mine.from ?? 0) };
          const onEdge = [Math.abs(start.x - f.box.x0), Math.abs(start.x - f.box.x1), Math.abs(start.y - f.box.y0), Math.abs(start.y - f.box.y1)].some((d) => d < 1e-6);
          expect(onEdge, `${pane.name} ${section.heading} ${where.place}：线从 (${start.x.toFixed(1)}, ${start.y.toFixed(1)}) 画起`).toBe(true);
          cut++;
          // 别的题签的引线都不经过他：没有 from
          first.forEach((p, i) => {
            if (i !== own && !p.hidden) expect(p.from, `${pane.name} ${section.heading}：${p.id}`).toBeUndefined();
          });
          // 下一帧（把上一帧的结果交回去）：一条也不动
          const second = place(input, first);
          second.forEach((p, i) => expect(same(p, first[i]) && p.from === first[i].from, `${pane.name} ${section.heading}：${p.id} 第二帧动了`).toBe(true));
          // 他走了（不再给那一块）：同没有他的时候一模一样
          const gone = place({ ...input, avoid: undefined }, second);
          const never = placeStrips({ ...input, avoid: undefined });
          gone.forEach((p, i) => {
            expect(same(p, never[i]), `${pane.name} ${section.heading}：${p.id} 没有回到原处`).toBe(true);
            expect(p.from).toBeUndefined();
          });
        }
      }
    }
    expect(towns).toBeGreaterThan(20);
    expect(cut).toBe(towns);
  });

  it('没有给让开的那一块：摆出来的就是 placeStrips 摆出来的，接着摆也一样（全程沙盘上没有小像的日子、站点沙盘）', () => {
    for (const pane of STANDARD) {
      for (const section of R.scene.sections) {
        const { anchors } = placed(section, pane);
        const input: StripInput = { strips: routeSectionStrips(R.scene, section.heading, pane.size.width, 'ancient'), anchors, size: pane.size, insets: pane.insets };
        const place = aroundPiece();
        const first = place(input);
        expect(first).toEqual(placeStrips(input));
        expect(place(input, first)).toEqual(placeStrips(input, first));
        expect(place({ ...input, avoid: [] }, first, { moving: true })).toEqual(placeStrips(input, first, { moving: true }));
      }
    }
  });
});

describe(`${KEY} 上的小像：头探不探出沙盘的那一块`, () => {
  /** 一生里他在沙盘上的日子：站着的各处，和每一趟路上密密地取的各处（一趟路取 64 处，连两头）。 */
  const DAYS: { name: string; day: number }[] = [
    ...STANDING,
    ...bar.stretches.flatMap((stretch, i) => (stretch.ways ? Array.from({ length: 65 }, (_, k) => ({ name: `${stretch.id} ${stretch.label}`, day: Math.min(startOf(i) + ((stretch.until - startOf(i)) * k) / 64, stretch.until - 1e-6) })) : [])),
  ];

  it('小像从不被沙盘栏的边切掉，脚从不落在时间轴底下；头探出沙盘那一块的，都是往上探进按钮的那一行，最多 26 像素（各种画面上的数打印出来）', { timeout: 120_000 }, () => {
    const lines: string[] = [];
    let seen = 0;
    for (const pane of ALL) {
      let worst = { px: 0, where: '' };
      for (const { name, day } of DAYS) {
        const where = whereAt(bar, Math.min(day, lastDay - 1e-6));
        if (!where) continue;
        // 时间轴停着的时候摆的是这一段的那一节：那一节里他一定看得见
        const section = sectionsFor(day)[0];
        const f = placed(section, pane).figure(where);
        expect(f, `${name} 第 ${day.toFixed(1)} 天：沙盘上没有这个地方`).not.toBeNull();
        if (!f) continue;
        seen++;
        const at = `${pane.name} ${section.heading} ${name}`;
        // 脚在沙盘的那一块里：不出左右，不落到时间轴底下，也不在按钮那一排上面
        expect(footSeen(f, pane), `${at}：脚落在 (${f.x.toFixed(0)}, ${f.y.toFixed(0)})`).toBe(true);
        // 整个人不出沙盘栏的边
        expect(f.box.x0, at).toBeGreaterThanOrEqual(0);
        expect(f.box.x1, at).toBeLessThanOrEqual(pane.size.width);
        expect(f.y - f.h, at).toBeGreaterThanOrEqual(0);
        const above = pane.insets.top - (f.y - f.h);
        if (above > worst.px) worst = { px: above, where: `${section.heading} ${name}` };
      }
      lines.push(`${pane.name}：${worst.px > 0 ? `最多 ${worst.px.toFixed(1)} 像素（${worst.where}）` : '不探出去'}`);
      expect(worst.px, pane.name).toBeLessThanOrEqual(26);
    }
    expect(seen).toBeGreaterThan(1000);
    console.log(`小像的头往上探出沙盘那一块多少（探进按钮的那一行里；按钮之间的空里看得见他）：\n  ${lines.join('\n  ')}`);
  });

  it('读者点了“试试立体的沙盘”、按钮下面那一行话留着的时候：那一行话下面多留 36 像素，小像站在每一处、走在每一趟路上，整个都在那一行话的下面（各种画面上最近的数打印出来）', { timeout: 120_000 }, () => {
    expect(NOTICE_HEAD_PX).toBe(36);
    const lines: string[] = [];
    for (const base of ALL) {
      const { pane, row } = underNotice(base);
      expect(row, base.name).toBeGreaterThan(base.insets.top);
      let least = { px: Infinity, where: '' };
      for (const { name, day } of DAYS) {
        const where = whereAt(bar, Math.min(day, lastDay - 1e-6));
        if (!where) continue;
        for (const section of sectionsFor(day)) {
          const f = placed(section, pane).figure(where);
          if (!f || !footSeen(f, pane)) continue;
          // 帽顶到那一行话的下边还有多远
          const clear = f.y - f.h - row;
          if (clear < least.px) least = { px: clear, where: `${section.heading} ${name}` };
          expect(clear, `${pane.name} ${section.heading} ${name}：帽顶在那一行话下边以上 ${(-clear).toFixed(1)} 像素`).toBeGreaterThanOrEqual(0);
        }
      }
      lines.push(`${pane.name}：帽顶离那一行话的下边最近 ${least.px.toFixed(1)} 像素（${least.where}）`);
    }
    console.log(`那一行话下面给小像留出 ${NOTICE_HEAD_PX} 像素以后：\n  ${lines.join('\n  ')}`);
    // 不留的话（照原来的摆法），在这样的栏上他的头会被那一行话盖住：这一条规矩不是白立的
    const { pane, row } = underNotice(plain(ROUTE_PANES[2]));
    const tight: Pane = { ...pane, insets: { ...pane.insets, top: row } };
    let covered = 0;
    for (const { day } of DAYS) {
      const where = whereAt(bar, Math.min(day, lastDay - 1e-6));
      const f = where && placed(sectionsFor(day)[0], tight).figure(where);
      if (f && f.y - f.h < row - 1) covered++;
    }
    expect(covered).toBeGreaterThan(0);
  });

  it('那一行话下面的 36 像素在全程那一节也少不了：只在各站的那几节留的话，他从北边的框上往惠州走的那一截，帽顶在全程里被那一行话盖住（各种栏上差多少印出来）', { timeout: 120_000 }, () => {
    // 全程的沙盘在那一行话下面小了一圈（多留了 36 像素）。这里量的是“全程那一节不多留”会怎样：全程那一节上面只留到那一行话为止。
    // 量出来：十一种栏里十种，他在去惠州的那趟路的起头（路是从北边的框上画起的）帽顶探到那一行话底下去。所以哪一节都留着。
    const lines: string[] = [];
    let least = Infinity;
    for (const base of ALL) {
      const { pane, row } = underNotice(base);
      const tight: Pane = { ...pane, insets: { ...pane.insets, top: row } };
      let worst = { px: Infinity, where: '' };
      for (const { name, day } of DAYS) {
        const where = whereAt(bar, Math.min(day, lastDay - 1e-6));
        if (!where) continue;
        const f = placed(WHOLE, tight).figure(where);
        if (!f || !footSeen(f, tight)) continue;
        const clear = f.y - f.h - row;
        if (clear < worst.px) worst = { px: clear, where: name };
      }
      least = Math.min(least, worst.px);
      lines.push(`${base.name}：${worst.px.toFixed(1)} 像素（${worst.where}）`);
    }
    console.log(`全程那一节要是不多留 36 像素，他的帽顶离那一行话的下边最近：\n  ${lines.join('\n  ')}`);
    expect(lines).toHaveLength(ALL.length);
    // 不留的话有被盖住的（差的是负数）：全程那一节也要留
    expect(least).toBeLessThan(0);
  });

  it('一站自己的沙盘的栏不在这些栏里：它们没有时间轴，上面留的空不因为小像多留', () => {
    // 带着时间轴的各种栏都是全程沙盘的（人物页、首页）；站点沙盘照 STANDARD_PANES 查，它们的数这一回一个没有动
    for (const pane of STANDARD_PANES) {
      expect(ALL.some((item) => item.name === pane.name), pane.name).toBe(false);
      expect(ROUTE_NOTICE_ROW_TOP[pane.name], pane.name).toBeUndefined();
    }
    expect(STANDARD_PANES.map((pane) => [pane.insets.top, pane.insets.bottom])).toEqual([
      [62, 130],
      [62, 130],
      [54, 131],
      [54, 131],
    ]);
  });
});

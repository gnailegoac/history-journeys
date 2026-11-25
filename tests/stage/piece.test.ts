// 小像在画面上：多大，站在哪，题签怎么让开他，头探不探出沙盘的那一块。在 Node 里跑，不要浏览器。
// 真的：全程沙盘的场景和算出来的地面、行迹（时间轴用的那一份）、镜头（src/stage/three/rig.ts 的 placeCamera，沙盘程序用的就是它）、
// 小像站在哪（src/stage/pieceWhere.ts，页面那一边的 whereAt）、小像的模型（src/stage/three/piece.ts）、
// 题签的摆法（src/stage/overlay/placeStrips.ts 和全程沙盘用的 placeAround.ts）。画面是 ./support/standardPanes.ts 里带着时间轴的各种栏
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
import { aroundPiece, touches } from '../../src/stage/overlay/placeAround';
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
import { routeSectionStrips } from './support/stripSizes';

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
/** 小像停着的时候，一条引线最长多少像素（没有他的时候是 48）。 */
const LEADER_MAX_PX = 70;
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
  /** 一种栏、一节、一种名字、他在一处：没有他时怎么摆，有他时怎么摆，各条碰没碰着他。 */
  function around(pane: Pane, section: RouteSection, names: NamesMode, where: PiecePlace) {
    const { anchors, figure, written } = placed(section, pane);
    const f = figure(where);
    if (!f || !footSeen(f, pane)) return null;
    const strips = routeSectionStrips(R.scene, section.heading, pane.size.width, names);
    const input: StripInput = { strips, anchors, size: pane.size, insets: pane.insets };
    const without = placeStrips(input);
    const withHim = aroundPiece()({ ...input, avoid: [f.box] });
    const text = (id: string): string => {
      const strip = written.find((s) => s.id === id);
      return strip ? (names === 'modern' && strip.modern ? strip.modern : strip.text) : id;
    };
    return { f, input, without, withHim, text };
  }

  it('小像站在每一个站的地名点上、线上没有立名字的每一处、最后一天，停在每一趟路的各处：没有碰着他的题签，一条也不动；没有一条题签因为他摆不下（带着时间轴的每一种栏上都查，数打印出来）', { timeout: 120_000 }, () => {
    const totals = { cases: 0, strips: 0, touched: 0, moved: 0, movedUntouched: 0, lost: 0 };
    const stuck = new Map<string, number>();
    for (const [kind, list] of [['站着', STANDING], ['停在路上', ON_ROAD]] as const) {
      for (const pane of ALL) {
        let cases = 0;
        let touched = 0;
        let moved = 0;
        for (const { name, day } of list) {
          const where = whereAt(bar, Math.min(day, lastDay - 1e-6));
          if (!where) continue;
          for (const section of sectionsFor(day)) {
            for (const names of NAMES) {
              const got = around(pane, section, names, where);
              if (!got) continue;
              cases++;
              got.without.forEach((before, i) => {
                const after = got.withHim[i];
                totals.strips++;
                const hit = !before.hidden && before.leader !== null && touches(before.x, before.y, got.input.strips[i].w, got.input.strips[i].h, before.leader, got.f.box);
                if (hit) touched++;
                if (!before.hidden && after.hidden) totals.lost++;
                if (same(before, after)) {
                  // 碰着他却没有动的：找不到别的位置，留在原处（哪几条、在哪种栏上，下面印出来）
                  if (hit) stuck.set(`${pane.name} ${section.heading} ${name}：“${got.text(before.id)}”`, (stuck.get(`${pane.name} ${section.heading} ${name}：“${got.text(before.id)}”`) ?? 0) + 1);
                  return;
                }
                moved++;
                // 动了的，一定是碰着他的
                if (!hit) totals.movedUntouched++;
                expect(hit, `${pane.name} ${section.heading} ${names} ${name}：“${got.text(before.id)}”没有碰着他，却从 (${before.x}, ${before.y}) 挪到了 (${after.x}, ${after.y})`).toBe(true);
              });
            }
          }
        }
        totals.cases += cases;
        totals.touched += touched;
        totals.moved += moved;
        console.log(`${kind}，${pane.name}：${cases} 种摆法（哪一处 × 哪一节 × 古今名字）里，碰着他的题签 ${touched} 条，挪开了 ${moved} 条`);
      }
    }
    console.log(`一共 ${totals.cases} 种摆法、${totals.strips} 条题签：碰着他的 ${totals.touched} 条，挪开的 ${totals.moved} 条；没碰着他却动了的 ${totals.movedUntouched} 条；因为他摆不下的 ${totals.lost} 条`);
    console.log(stuck.size === 0 ? '碰着他又找不到别的位置、留在原处的：没有' : `碰着他又找不到别的位置、留在原处的 ${stuck.size} 处：\n  ${[...stuck.keys()].join('\n  ')}`);
    expect(totals.cases).toBeGreaterThan(2000);
    expect(totals.moved).toBeGreaterThan(0);
    expect(totals.movedUntouched).toBe(0);
    expect(totals.lost).toBe(0);
  });

  it('小像站在每一个站的地名点上、线上没有立名字的每一处：没有一条题签压着他，没有一条题签因为他摆不下，引线最长不超过 70 像素', { timeout: 120_000 }, () => {
    const over: string[] = [];
    const long: string[] = [];
    let lost = 0;
    let cases = 0;
    let longest = { px: 0, where: '' };
    for (const pane of STANDARD) {
      for (const { name, day } of STANDING) {
        const where = whereAt(bar, Math.min(day, lastDay - 1e-6));
        if (!where) continue;
        for (const section of sectionsFor(day)) {
          for (const names of NAMES) {
            const got = around(pane, section, names, where);
            if (!got) continue;
            cases++;
            got.withHim.forEach((p, i) => {
              if (p.hidden) {
                if (!got.without[i].hidden) lost++;
                return;
              }
              const at = `${pane.name} ${section.heading} ${names} ${name}：“${got.text(p.id)}”`;
              if (overlap(rectOf(p, got.input.strips[i]), got.f.box)) over.push(at);
              if (leaderPx(p) > longest.px) longest = { px: leaderPx(p), where: at };
              if (leaderPx(p) > LEADER_MAX_PX) long.push(`${at} ${leaderPx(p).toFixed(0)} 像素（没有他的时候 ${leaderPx(got.without[i]).toFixed(0)}）`);
            });
          }
        }
      }
    }
    console.log(`他站着的 ${cases} 种摆法里：压着他的题签 ${over.length} 条；最长的引线 ${longest.px.toFixed(0)} 像素（${longest.where}）；超过 ${LEADER_MAX_PX} 像素的 ${long.length} 条`);
    expect(cases).toBeGreaterThan(300);
    expect(lost).toBe(0);
    expect(over).toEqual([]);
    expect(long).toEqual([]);
  });

  it('别的竖着拿的平板上他站着、每一种栏上他停在路上：也没有一条题签压着他，没有一条因为他摆不下；引线超过 70 像素的各处印出来——都是碰着他、给他让开的那一条（别的题签不动，引线还是没有他时的那么长）', { timeout: 120_000 }, () => {
    // 题签只挪碰着他的那几条：别的都不肯让，碰着他的那一条有时就得挪得远。四种标准的窗口和首页上他站着的时候不超过 70 像素（上一项）；
    // 这里是剩下的：别的五种竖着拿的平板上他站着，和每一种栏上他停在路上。超过 70 像素的不判错，一处一处印出来。
    const over: string[] = [];
    const long = new Map<string, number>();
    let lost = 0;
    let cases = 0;
    let untouchedLong = 0;
    const sets: [string, Pane[], { name: string; day: number }[]][] = [
      ['站着', ALL.filter((pane) => !STANDARD.includes(pane)), STANDING],
      ['停在路上', ALL, ON_ROAD],
    ];
    for (const [kind, panes, list] of sets) {
      for (const pane of panes) {
        for (const { name, day } of list) {
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
                const at = `${kind}，${pane.name} ${section.heading} ${name}：“${got.text(p.id)}”`;
                if (overlap(rectOf(p, got.input.strips[i]), got.f.box)) over.push(at);
                if (leaderPx(p) <= LEADER_MAX_PX) return;
                long.set(`${at} ${leaderPx(p).toFixed(0)} 像素（没有他的时候 ${leaderPx(before).toFixed(0)}）`, 1);
                // 超过的都是给他让开的那一条；没碰着他的题签一条也没有变长
                if (same(before, p)) untouchedLong++;
              });
            }
          }
        }
      }
    }
    console.log(`别的竖着拿的平板上他站着、每一种栏上他停在路上，一共 ${cases} 种摆法：压着他的题签 ${over.length} 条；因为他摆不下的 ${lost} 条；引线超过 ${LEADER_MAX_PX} 像素的 ${long.size} 处（古今名字各算一处）${long.size ? `：\n  ${[...long.keys()].join('\n  ')}` : ''}`);
    expect(cases).toBeGreaterThan(2000);
    expect(lost).toBe(0);
    expect(over).toEqual([]);
    expect(untouchedLong).toBe(0);
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

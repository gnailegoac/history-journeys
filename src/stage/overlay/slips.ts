// 另一种题签：平着的纸条（docs/data-spec.md“题签摆在哪”末尾的“另一种题签”）。约定见 ./types.ts 的 LabelKit。
// 这是单独的一小块程序：样式的登记表里写了 labels: 'slip' 的沙盘才下载（取它的那一句动态 import 在 src/stage/index.ts）；
// 页面的程序、竖着的纸条的沙盘都不带它。它什么程序也不引（只取类型）：不碰 three，不碰地面，连 ./placeStrips.ts 也不引——
// 引了它，打包的工具会把它从页面的程序里单拆成一个文件，每一位读者一打开页面就多一次请求（tests/build/dist-size.test.ts 守着）。
//
// 里面三样：
//   一、造一条平着的纸条的元素（make）：不竖写；站的号码是名字前头的圆（一站一个，每一个是通到那一站的链接）；名字自己包一层，
//       纸和细线只垫在名字下面。是站的地名，它那一点上的圆点做一个记号（data-stop），样式表把它画成印的颜色。样子在 src/styles/stage.css。
//   二、摆法（placeSlips）。同竖着的纸条的摆法（./placeStrips.ts）是一套规矩——要紧的先摆，每条在它那一点周围有一批带号的候选位置，
//       取摆得下的里面代价最小的；号认位置，转动沙盘时能不换就不换；手还在动时一条也不重新挑——只有四处不一样：
//         先试右边，再试左边，然后上边、下边（平着的纸条站在点的旁边，不站在它头上）；离那一点近一些；
//         摆在上边、下边时左右挪的一格是 20 像素，摆在左右时上下挪的一格是纸条高的一半（纸条宽而矮）；
//         没有点的名字（strip.area）：纸条的正中摆在写的那个位置上，摆不下就绕着它一圈一圈往外找，最远 48 像素；没有引线，
//         那个位置不算一个点（别的题签可以压过去）；还摆不下就不摆，缘故记成 area，题签层什么也不画；
//         给了地面的四个角（input.ground）：纸条的四个角都要落在那一块里面、离边至少 3 像素——出去的先朝那一块的中间横着推回来，
//         推不回来再竖着推，还不行就不要这个位置。远处的题签不查这一条（它本来就站在沙盘边上、朝着外面）。
//       竖着的纸条的摆法一个字没有动：这里是另写的一份，不是在它里面加岔路。
//   三、定格图那一边地面的四个角怎么算（ground）：照清单里记的镜头，和沙盘程序投一点到画面上是同一个算法。

import type { LabelKit, LabelKitMaker, ScreenPoint, StripInput, StripPlacement, StripPlacer, YieldingPlacer } from './types';

type Side = 'above' | 'right' | 'left' | 'below';
type Anchor = StripInput['anchors'][number];
type Strip = StripInput['strips'][number];

/** 同 placeStrips.ts 里的是一个意思的几个数（各自的讲法见那里）。 */
const MARGIN = 4;
const GUTTER = 4;
const DOT = 6;
const SEEN_OUTSIDE = 8;
const GAP_FULL_WIDTH = 800;
const GAPS = [1, 1.7, 2.6, 3.8];
const SLIDES_ACROSS = [0, 1, -1, 2, -2, 3, -3];
const SLIDES_ALONG = [0, 1, -1, 1.5, -1.5];
const COST_SIDE = 8;
const COST_GAP = 5;
const COST_SLIDE = 3;
const COST_PUSHED = 0.3;
const COST_LEADER = 0.05;
const RING_DIRECTIONS = 16;
const RING_STEP = 14;
const RING_COST = 60;
const RING_COST_PER_PX = 0.4;
const STAY_BONUS = 20;
const REPAIR_TRIES = 8;
const INWARD_BELOW = -0.2;
const SIDE_VEC: Record<Side, readonly [number, number]> = { above: [0, -1], right: [1, 0], left: [-1, 0], below: [0, 1] };
const SIDE_CODE: Record<Side, number> = { above: 0, right: 1, left: 2, below: 3 };
const RING_SLOT = 1000;

/** 平着的纸条不一样的几个数。 */
/** 先试哪一边。 */
export const SLIP_SIDES: readonly Side[] = ['right', 'left', 'above', 'below'];
/** 纸条离它指的那一点多远：按 800 宽的画面定，画面窄了按比例收近，最多收到一半（竖着的纸条是 26）。 */
export const SLIP_GAP = 14;
/** 摆在上边、下边时左右挪的一格（像素）。 */
export const SLIP_STEP_ACROSS = 20;
/** 没有点的名字绕着写的那个位置找，最远这么多像素。 */
export const AREA_REACH_PX = 48;
/** 纸条离地面的边至少这么远（像素）。 */
export const GROUND_INSET_PX = 3;
/** 出了地面的边的位置，最多推回来这么多像素；一步两像素。 */
const PUSH_MAX = 80;
const PUSH_STEP = 2;

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Candidate {
  slot: number;
  cost: number;
  x: number;
  y: number;
  rect: Rect;
  /** 没有点的名字没有引线：这里放的是它正中的那一点（两头是同一点），画的时候不画。 */
  leader: [number, number, number, number];
}

interface Taken {
  id: string;
  index: number;
  cand: Candidate;
  all: Candidate[];
  area: boolean;
}

/**
 * 平着的纸条的摆法。接的东西、交回去的东西和 placeStrips 一样（见 ./types.ts）；多看两样：strips 里的 area，和 ground。
 */
export function placeSlips(input: StripInput, prev?: StripPlacement[], opts?: { moving?: boolean }): StripPlacement[] {
  const moving = opts?.moving === true && prev !== undefined;
  const placed = arrange(input, prev, moving);
  if (moving || prev === undefined || !placed.some(leftOut)) return placed;
  const fresh = arrange(input, undefined, false);
  return fresh.filter(leftOut).length < placed.filter(leftOut).length ? fresh : placed;
}

/** 看得见但是摆不下的（有点的名字）。 */
function leftOut(p: StripPlacement): boolean {
  return p.hidden && p.why === 'room';
}

function arrange(input: StripInput, prev: StripPlacement[] | undefined, moving: boolean): StripPlacement[] {
  const { size, insets } = input;
  const free: Rect = { x0: insets.left + MARGIN, y0: insets.top + MARGIN, x1: size.width - insets.right - MARGIN, y1: size.height - insets.bottom - MARGIN };
  const gap = SLIP_GAP * clamp(size.width / GAP_FULL_WIDTH, 0.5, 1);
  const anchors = new Map(input.anchors.map((anchor) => [anchor.id, anchor]));
  const before = new Map((prev ?? []).map((p) => [p.id, p]));
  const avoid = input.avoid ?? [];
  const inside = insideOf(input.ground);

  const order = input.strips.map((strip, index) => ({ strip, index })).sort((a, b) => a.strip.rank - b.strip.rank || a.index - b.index);

  // 每一条有点的、看得见的题签指的那一点，都不让别的题签压住；没有点的名字写的那个位置不算
  const dots: { id: string; rect: Rect }[] = [];
  for (const { strip } of order) {
    const anchor = anchors.get(strip.id);
    if (anchor && !strip.area && seen(anchor, free)) dots.push({ id: strip.id, rect: dotRect(anchor) });
  }

  const taken: Taken[] = [];
  const result = new Array<StripPlacement>(input.strips.length);

  const allowed = (id: string, c: Candidate, others: Taken[]): boolean => {
    for (const dot of dots) if (dot.id !== id && overlaps(dot.rect, c.rect)) return false;
    for (const other of others) {
      if (overlaps(grow(other.cand.rect, GUTTER), c.rect)) return false;
      if (crosses(c.leader, other.cand.rect)) return false;
      if (crosses(other.cand.leader, c.rect)) return false;
    }
    return true;
  };

  const makeRoom = (id: string, all: Candidate[]): Candidate | undefined => {
    for (let j = taken.length - 1; j >= 0; j--) {
      const earlier = taken[j];
      const rest = taken.filter((_, k) => k !== j);
      let tried = 0;
      for (const alt of earlier.all) {
        if (alt === earlier.cand || !allowed(earlier.id, alt, rest)) continue;
        if (++tried > REPAIR_TRIES) break;
        const mine = all.find((c) => allowed(id, c, [...rest, { ...earlier, cand: alt }]));
        if (!mine) continue;
        earlier.cand = alt;
        result[earlier.index] = shown(earlier.id, alt, earlier.area);
        return mine;
      }
    }
    return undefined;
  };

  for (const { strip, index } of order) {
    const anchor = anchors.get(strip.id);
    const was = before.get(strip.id);
    const area = strip.area === true;
    const kept = moving && was?.slot !== undefined ? { slot: was.slot } : {};
    if (!anchor || !seen(anchor, free)) {
      result[index] = { id: strip.id, x: anchor?.x ?? 0, y: anchor?.y ?? 0, hidden: true, leader: null, why: 'unseen', ...kept };
      continue;
    }
    const all = area ? areaCandidates(strip, anchor, free, was?.slot, avoid, inside) : candidates(strip, anchor, free, gap, was?.slot, avoid, inside);

    let pick: Candidate | undefined;
    if (moving && was?.slot !== undefined) {
      const same = all.find((c) => c.slot === was.slot);
      if (same && allowed(strip.id, same, taken)) pick = same;
    } else if (!moving || (was?.why !== 'room' && was?.why !== 'area')) {
      pick = all.find((c) => allowed(strip.id, c, taken));
      // 没有点的名字不为自己去挪别的题签
      if (!pick && !moving && !area) pick = makeRoom(strip.id, all);
    }

    if (!pick) {
      result[index] = { id: strip.id, x: anchor.x, y: anchor.y, hidden: true, leader: null, why: area ? 'area' : 'room', ...kept };
      continue;
    }
    taken.push({ id: strip.id, index, cand: pick, all, area });
    result[index] = shown(strip.id, pick, area);
  }

  return result;
}

function shown(id: string, c: Candidate, area: boolean): StripPlacement {
  return { id, x: c.x, y: c.y, hidden: false, leader: area ? null : c.leader, slot: c.slot };
}

function seen(anchor: Anchor, free: Rect): boolean {
  return anchor.visible && anchor.x >= free.x0 - SEEN_OUTSIDE && anchor.x <= free.x1 + SEEN_OUTSIDE && anchor.y >= free.y0 - SEEN_OUTSIDE && anchor.y <= free.y1 + SEEN_OUTSIDE;
}

/** 地面那一块：一点在不在里面（已经往里收过），和这一块的中间。没有给四个角（或者给的不成一块）是 null：都算在里面。 */
type Inside = { has(x: number, y: number): boolean; midX: number; midY: number } | null;

/** 地面的四个角围成的那一块，往里收 GROUND_INSET_PX：一点在不在里面。四个角要照绕一圈的先后给。 */
function insideOf(ground: StripInput['ground']): Inside {
  if (!ground || ground.length < 3 || ground.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  // 绕的方向：面积的正负
  let twice = 0;
  ground.forEach((p, i) => {
    const q = ground[(i + 1) % ground.length];
    twice += p.x * q.y - q.x * p.y;
  });
  if (twice === 0) return null;
  const turn = Math.sign(twice);
  const edges = ground.map((p, i) => {
    const q = ground[(i + 1) % ground.length];
    const length = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { px: p.x, py: p.y, nx: (-(q.y - p.y) / length) * turn, ny: ((q.x - p.x) / length) * turn };
  });
  return {
    // 离每一条边（朝里量）都不少于 GROUND_INSET_PX
    has: (x, y) => edges.every((e) => (x - e.px) * e.nx + (y - e.py) * e.ny >= GROUND_INSET_PX),
    midX: ground.reduce((sum, p) => sum + p.x, 0) / ground.length,
    midY: ground.reduce((sum, p) => sum + p.y, 0) / ground.length,
  };
}

/** 这一块的四个角都在地面里面。 */
function fits(rect: Rect, inside: Inside): boolean {
  return !inside || (inside.has(rect.x0, rect.y0) && inside.has(rect.x1, rect.y0) && inside.has(rect.x1, rect.y1) && inside.has(rect.x0, rect.y1));
}

/**
 * 中心在 x、y 的一条纸条出了地面的边：朝地面那一块的中间推回来，先横着、再竖着，一步两像素，最多 PUSH_MAX。
 * 交回推过以后的中心，和推了多少像素；本来就在里面的原样交回（推了 0）；推不回来是 null。
 */
function pushInside(x: number, y: number, halfW: number, halfH: number, inside: Inside): { x: number; y: number; pushed: number } | null {
  const at = (cx: number, cy: number): Rect => ({ x0: cx - halfW, y0: cy - halfH, x1: cx + halfW, y1: cy + halfH });
  if (!inside || fits(at(x, y), inside)) return { x, y, pushed: 0 };
  for (const [dx, dy] of [
    [Math.sign(inside.midX - x), 0],
    [0, Math.sign(inside.midY - y)],
  ]) {
    if (dx === 0 && dy === 0) continue;
    for (let by = PUSH_STEP; by <= PUSH_MAX; by += PUSH_STEP) if (fits(at(x + dx * by, y + dy * by), inside)) return { x: x + dx * by, y: y + dy * by, pushed: by };
  }
  return null;
}

/** 一条有点的纸条的候选位置，从便宜到贵。 */
function candidates(strip: Strip, anchor: Anchor, free: Rect, gap: number, stay: number | undefined, avoid: readonly Rect[], inside: Inside): Candidate[] {
  const halfW = strip.w / 2;
  const halfH = strip.h / 2;
  const loX = Math.ceil(free.x0 + halfW);
  const hiX = Math.floor(free.x1 - halfW);
  const loY = Math.ceil(free.y0 + halfH);
  const hiY = Math.floor(free.y1 - halfH);
  if (loX > hiX || loY > hiY) return [];

  const out = outward(anchor);
  const own = dotRect(anchor);
  const foot = anchor.foot && Number.isFinite(anchor.foot.x) && Number.isFinite(anchor.foot.y) ? anchor.foot : null;
  // 远处的题签站在沙盘边上、朝着外面：不查地面的边
  const within = out ? null : inside;
  const found: Candidate[] = [];
  const add = (slot: number, cost: number, wantX: number, wantY: number): void => {
    const back = pushInside(wantX, wantY, halfW, halfH, within);
    if (!back) return;
    const { x, y } = back;
    if (x < loX || x > hiX || y < loY || y > hiY) return;
    const rect: Rect = { x0: x - halfW, y0: y - halfH, x1: x + halfW, y1: y + halfH };
    if (overlaps(rect, own)) return;
    if (foot && crosses([anchor.x, anchor.y, foot.x, foot.y], grow(rect, DOT))) return;
    const nearX = clamp(anchor.x, rect.x0, rect.x1);
    const nearY = clamp(anchor.y, rect.y0, rect.y1);
    for (const box of avoid) {
      if (overlaps(rect, box)) return;
      const on = anchor.x > box.x0 && anchor.x < box.x1 && anchor.y > box.y0 && anchor.y < box.y1;
      if (!on && crosses([anchor.x, anchor.y, nearX, nearY], box)) return;
    }
    const total = cost + back.pushed * COST_PUSHED + Math.hypot(nearX - anchor.x, nearY - anchor.y) * COST_LEADER - (slot === stay ? STAY_BONUS : 0);
    found.push({ slot, cost: total, x, y, rect, leader: [anchor.x, anchor.y, nearX, nearY] });
  };

  sidesFor(strip, out).forEach((side, sideIndex) => {
    const [vx, vy] = SIDE_VEC[side];
    const upright = vx === 0;
    const slides = upright ? SLIDES_ACROSS : SLIDES_ALONG;
    const step = upright ? SLIP_STEP_ACROSS : strip.h / 2;
    const lean = !out && strip.lean && side === strip.side ? SIDE_VEC[strip.lean][upright ? 0 : 1] : 0;
    GAPS.forEach((times, gapIndex) => {
      slides.forEach((slide, slideIndex) => {
        const wantX = anchor.x + vx * (gap * times + halfW) + (upright ? slide * step : 0);
        const wantY = anchor.y + vy * (gap * times + halfH) + (upright ? 0 : slide * step);
        const pushed = Math.hypot(clamp(wantX, free.x0 + halfW, free.x1 - halfW) - wantX, clamp(wantY, free.y0 + halfH, free.y1 - halfH) - wantY);
        add(
          SIDE_CODE[side] * 100 + gapIndex * 10 + slideIndex,
          sideIndex * COST_SIDE + gapIndex * COST_GAP + (lean ? Math.abs(slide - lean) * 2 : slideIndex) * COST_SLIDE + pushed * COST_PUSHED,
          clamp(Math.round(wantX), loX, hiX),
          clamp(Math.round(wantY), loY, hiY),
        );
      });
    });
  });

  // 最后的办法：绕着那一点一圈一圈往外找
  const reach = Math.min(free.x1 - free.x0, free.y1 - free.y0) / 2;
  const first = gap + Math.max(halfW, halfH);
  for (let ring = 0; first + ring * RING_STEP <= reach + Math.max(halfW, halfH); ring++) {
    const radius = first + ring * RING_STEP;
    for (let k = 0; k < RING_DIRECTIONS; k++) {
      const angle = (k / RING_DIRECTIONS) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      if (out && dx * out[0] + dy * out[1] < 0) continue;
      add(RING_SLOT + ring * RING_DIRECTIONS + k, RING_COST + radius * RING_COST_PER_PX, Math.round(anchor.x + dx * radius), Math.round(anchor.y + dy * radius));
    }
  }

  return found.sort((a, b) => a.cost - b.cost);
}

/**
 * 一个没有点的名字的候选位置：头一个是正中摆在写的那个位置上（0 号），然后绕着它一圈一圈往外，一圈远 RING_STEP，最远 AREA_REACH_PX。
 * 出了地面的边、出了留出来的那一块、压着不许压的那几块的不要（不往回推：推过的位置离写的地方就说不准多远了）。
 */
function areaCandidates(strip: Strip, anchor: Anchor, free: Rect, stay: number | undefined, avoid: readonly Rect[], inside: Inside): Candidate[] {
  const halfW = strip.w / 2;
  const halfH = strip.h / 2;
  const found: Candidate[] = [];
  const add = (slot: number, cost: number, x: number, y: number): void => {
    const rect: Rect = { x0: x - halfW, y0: y - halfH, x1: x + halfW, y1: y + halfH };
    if (rect.x0 < free.x0 || rect.x1 > free.x1 || rect.y0 < free.y0 || rect.y1 > free.y1) return;
    if (!fits(rect, inside) || avoid.some((box) => overlaps(rect, box))) return;
    found.push({ slot, cost: cost - (slot === stay ? STAY_BONUS : 0), x, y, rect, leader: [x, y, x, y] });
  };
  add(0, 0, Math.round(anchor.x), Math.round(anchor.y));
  for (let ring = 0; (ring + 1) * RING_STEP <= AREA_REACH_PX; ring++) {
    const radius = (ring + 1) * RING_STEP;
    for (let k = 0; k < RING_DIRECTIONS; k++) {
      const angle = (k / RING_DIRECTIONS) * Math.PI * 2;
      add(RING_SLOT + ring * RING_DIRECTIONS + k, RING_COST + radius * RING_COST_PER_PX, Math.round(anchor.x + Math.cos(angle) * radius), Math.round(anchor.y + Math.sin(angle) * radius));
    }
  }
  return found.sort((a, b) => a.cost - b.cost);
}

/** 先试哪一边：远处的题签按哪一边最朝外；别的先试场景里写的那一边（写了 lean 的接着试 lean 说的那一边），再照右、左、上、下。 */
function sidesFor(strip: Strip, out: readonly [number, number] | null): Side[] {
  if (out) {
    const along = (side: Side): number => SIDE_VEC[side][0] * out[0] + SIDE_VEC[side][1] * out[1];
    return SLIP_SIDES.filter((side) => along(side) > INWARD_BELOW).sort((a, b) => along(b) - along(a));
  }
  const wish = strip.side;
  if (!wish) return [...SLIP_SIDES];
  const lean = strip.lean && (SIDE_VEC[strip.lean][0] === 0) !== (SIDE_VEC[wish][0] === 0) ? strip.lean : undefined;
  return [wish, ...(lean ? [lean] : []), ...SLIP_SIDES.filter((side) => side !== wish && side !== lean)];
}

function outward(anchor: Anchor): [number, number] | null {
  if (!anchor.out) return null;
  const length = Math.hypot(anchor.out[0], anchor.out[1]);
  return length > 0 && Number.isFinite(length) ? [anchor.out[0] / length, anchor.out[1] / length] : null;
}

function dotRect(anchor: Anchor): Rect {
  return { x0: anchor.x - DOT, y0: anchor.y - DOT, x1: anchor.x + DOT, y1: anchor.y + DOT };
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function grow(r: Rect, by: number): Rect {
  return { x0: r.x0 - by, y0: r.y0 - by, x1: r.x1 + by, y1: r.y1 + by };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

/** 一条线段有没有从一块里面穿过去。只是碰到边不算；两头是同一点的（没有点的名字）算“这一点在不在里面”。 */
function crosses([ax, ay, bx, by]: readonly [number, number, number, number], r: Rect): boolean {
  let enter = 0;
  let leave = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q > 0;
    const t = q / p;
    if (p < 0) {
      if (t > leave) return false;
      if (t > enter) enter = t;
    } else {
      if (t < enter) return false;
      if (t < leave) leave = t;
    }
    return true;
  };
  return clip(-dx, ax - r.x0) && clip(dx, r.x1 - ax) && clip(-dy, ay - r.y0) && clip(dy, r.y1 - ay) && enter < leave;
}

// ---------------------------------------------------------------- 定格图那一边：地面的四个角

/**
 * 地面的四个角（海面那么高）落在沙盘栏的哪里。镜头是清单里记的那一个（从 position 看着 target，上面是 +y，视角是竖着量的）；
 * 画面的中心挪到留出来的那一块中间（和沙盘程序摆镜头时一样）；算出来的是整张图里的像素，再照这张图现在摆在哪换到栏里。
 * 沙盘程序自己是用 three 的镜头投的（src/stage/three/rig.ts 的 project）；两边差多少由 tests/unit/still-fit.test.ts 查。
 */
export const stillGround: LabelKit['ground'] = (frame, pose, shape, fit) => {
  // 整张图多大：沙盘栏的宽加上左右各多拍的；四边留的空是 [上, 右, 下, 左]（左右多拍的那两截一样宽，中心不跟着它们挪）
  const size = { width: shape.pane[0] + 2 * shape.extra, height: shape.pane[1] };
  const [top, rightIn, bottom, leftIn] = shape.insets;
  // 场景的范围换成沙盘里的米：全程沙盘除以它的比例
  const k = frame.scale ?? 1;
  const sub = (a: readonly number[], b: readonly number[]): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = (a: readonly number[]): [number, number, number] => {
    const length = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / length, a[1] / length, a[2] / length];
  };
  // 镜头自己的三根轴：back 从对准的那一点指向镜头，right 朝右，up 朝上
  const back = unit(sub(pose.position, pose.target));
  const right = unit([back[2], 0, -back[0]]);
  const up: [number, number, number] = [back[1] * right[2] - back[2] * right[1], back[2] * right[0] - back[0] * right[2], back[0] * right[1] - back[1] * right[0]];
  const focal = size.height / 2 / Math.tan((pose.fov * Math.PI) / 360);
  const shiftX = (leftIn - rightIn) / 2;
  const shiftY = (top - bottom) / 2;
  const corners: [number, number][] = [
    [-frame.westM / k, -frame.northM / k],
    [frame.eastM / k, -frame.northM / k],
    [frame.eastM / k, frame.southM / k],
    [-frame.westM / k, frame.southM / k],
  ];
  const out: ScreenPoint[] = [];
  for (const [x, z] of corners) {
    const d = sub([x, 0, z], pose.position);
    const depth = -dot(d, back);
    // 这个角到了镜头背后（近看一处的小节）：四个角围不成一块，不给——沙盘程序那一边也是这样（rig.ts 的 groundCorners）
    if (!(depth > 0)) return undefined;
    const px = size.width / 2 + (focal * dot(d, right)) / depth + shiftX;
    const py = size.height / 2 - (focal * dot(d, up)) / depth + shiftY;
    out.push({ x: fit.left + (px / size.width) * fit.width, y: fit.top + (py / size.height) * fit.height });
  }
  return out;
};

// ---------------------------------------------------------------- 一层题签用的那一份

/**
 * 给一层题签造一份。root 是那一层的元素：在它上面记下这一层是平着的纸条（data-kind），样式表照它挑。
 */
export const slipKit: LabelKitMaker = (root) => {
  root.dataset.kind = 'slip';
  /** 这一层里哪几条是没有点的名字（造元素的时候记下，摆的时候告诉摆法）。 */
  const areas = new Set<string>();
  const slip: StripPlacer = (input, prev, opts) => placeSlips({ ...input, strips: input.strips.map((strip) => (areas.has(strip.id) ? { ...strip, area: true } : strip)) }, prev, opts);
  return {
    make(doc, spec, dot) {
      const el = doc.createElement('div');
      el.className = spec.seals?.length ? 'strip-slip has-seals' : 'strip-slip';
      el.dataset.stripId = spec.id;
      el.dataset.tone = spec.tone;
      if (spec.area) {
        el.dataset.area = 'true';
        areas.add(spec.id);
      } else areas.delete(spec.id);
      // 先藏着：量得出大小，但还没摆好位置的时候不让人看见。圆和名字排成一行
      el.style.cssText = 'position:absolute;left:0;top:0;transform:translate(-50%,-50%);display:flex;align-items:center;white-space:nowrap;visibility:hidden';
      for (const seal of spec.seals ?? []) {
        const a = doc.createElement('a');
        a.className = 'strip-disc';
        a.setAttribute('href', seal.href);
        a.dataset.stopId = seal.stop;
        a.dataset.filled = String(seal.filled);
        a.dataset.here = String(seal.here);
        a.setAttribute('aria-label', seal.title);
        // 站的先后在正文那一栏的目录里，键盘从那里走；这里不再排一遍
        a.setAttribute('tabindex', '-1');
        a.textContent = seal.label;
        el.append(a);
      }
      const name = doc.createElement('span');
      name.className = 'strip-name';
      name.textContent = spec.text;
      el.append(name);
      // 是站的地名：它指的那一点画成印的颜色
      if (spec.seals?.length) dot.setAttribute('data-stop', 'true');
      return el;
    },
    // 交进来的带着“让开小像”的记号（./placeAround.ts 造的那一个，见 ./types.ts 的 YieldingPlacer）：让它拿平着的纸条的摆法去让。
    // 别的——平常的 placeStrips，或者谁另写的一个——都换成平着的纸条的摆法：这一层里没有一条照别的规矩摆
    place: (base) => ((base as Partial<YieldingPlacer>).yields ? (input, prev, opts) => (base as YieldingPlacer)(input, prev, opts, slip) : slip),
    ground: stillGround,
  };
};

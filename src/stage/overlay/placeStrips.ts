// 题签摆在画面的哪里。纯函数，不碰页面；约定见 ./types.ts。
//
// 做法：要紧的先摆。每条题签在它指的那一点周围有一批候选的位置（四边、几种远近、沿边挪几格，最后绕着那一点找一圈），
// 每个位置有一个代价，取摆得下的里面代价最小的。摆得下是说：
//   不出留出来的那一块；不压别的题签（还要隔开一点）；不压任何一条题签指的那一点（后摆的那一点也不能被先摆的盖住）；
//   不压自己指的那一点，也不压从那一点到它脚下的那一段（不盖住它指的那样东西）；
//   不压别人的引线，自己的引线也不从别的题签上穿过去。
// 一条实在摆不下时，回头挪一条已经摆好的试试（只挪一条，不连着挪）；还摆不下，这一条这次不摆，
// 由题签层在那一点上画一个空心的圈。
// 候选的位置是“相对那一点偏多少”，各有一个号（slot）。上一次摆在几号，这一次还摆几号就便宜一截，
// 所以转动沙盘时题签跟着那一点走，不到不得已不换地方。
// 读者的手还在动沙盘时（opts.moving）一条也不重新挑：留得住原来的号就留，留不住就先不摆。

import type { StripInput, StripPlacement } from './types';

type Side = 'above' | 'right' | 'left' | 'below';
type Anchor = StripInput['anchors'][number];
type Strip = StripInput['strips'][number];

/** 题签离留出来的边至少这么远（像素）。 */
const MARGIN = 4;
/** 两条题签之间至少隔这么多。 */
const GUTTER = 4;
/** 每一点周围留出来不压的方块，半边这么长。 */
const DOT = 6;
/** 那一点在留出来的那一块外面不超过这么多，还算看得见。 */
const SEEN_OUTSIDE = 8;
/** 题签离它指的那一点多远。按 800 宽的画面定；画面窄了按比例收近，最多收到一半。 */
const GAP = 26;
const GAP_FULL_WIDTH = 800;
/** 四种远近：GAP 的几倍。 */
const GAPS = [1, 1.7, 2.6, 3.8];
/** 摆在上边、下边时左右挪几格（一格是半条题签的宽加半个间隔）；摆在左边、右边时上下挪几格（一格是题签高的三分之一）。 */
const SLIDES_ACROSS = [0, 1, -1, 2, -2, 3, -3];
const SLIDES_ALONG = [0, 1, -1, 1.5, -1.5];
/** 代价：换一边、远一档、挪一格各加多少；被推回来每像素、引线每像素各加多少。 */
const COST_SIDE = 8;
const COST_GAP = 5;
const COST_SLIDE = 3;
const COST_PUSHED = 0.3;
const COST_LEADER = 0.05;
/** 最后的办法：绕着那一点一圈一圈往外找。一圈 16 个方向，每圈远 14 像素。 */
const RING_DIRECTIONS = 16;
const RING_STEP = 14;
const RING_COST = 60;
const RING_COST_PER_PX = 0.4;
/** 还摆在上一次的号上，代价减这么多。 */
const STAY_BONUS = 20;
/** 回头挪一条已经摆好的时，它最多试几个别的位置。 */
const REPAIR_TRIES = 8;
/** 远处的题签：一边和“朝外的方向”的夹角大过这个数（余弦比它小）就算朝着沙盘里面，不试。 */
const INWARD_BELOW = -0.2;

const SIDES: readonly Side[] = ['above', 'right', 'left', 'below'];
const SIDE_VEC: Record<Side, readonly [number, number]> = { above: [0, -1], right: [1, 0], left: [-1, 0], below: [0, 1] };
/** 号的百位：摆在哪一边。号认的是位置，不认“第几个想试的”，所以远处的题签朝外的方向转了，同一个号还是同一个位置。 */
const SIDE_CODE: Record<Side, number> = { above: 0, right: 1, left: 2, below: 3 };
/** 绕圈找到的位置，号从这里起。 */
const RING_SLOT = 1000;

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
  leader: [number, number, number, number];
}

/** 已经摆好的一条。all 是它所有的候选，从便宜到贵。 */
interface Taken {
  id: string;
  index: number;
  cand: Candidate;
  all: Candidate[];
}

/**
 * 给每条题签算出摆在哪。返回的结果和 input.strips 一一对上，顺序相同。
 * 那一点看不见（在镜头背后、在留出来的那一块外面）或者没有给那一点的，这次不摆（why 是 unseen）；
 * 看得见但是摆不下的也不摆（why 是 room），x、y 是那一点的位置，题签层在那里画一个空心的圈。
 *
 * prev 是上一次的结果：题签尽量留在上一次的号上。
 * opts.moving 是 true 时（读者的手还在动沙盘）不重新挑位置：摆过的留在原来的号上，留不住的先不摆（why 是 room，
 * 号还记着：那个位置再空出来就摆回去，手放开以后重摆时也先试它）；上一次因为摆不下没摆的还是不摆；
 * 从来没摆过的（刚转进画面的）照常挑一个空位，但不为它去挪别的题签。
 */
export function placeStrips(input: StripInput, prev?: StripPlacement[], opts?: { moving?: boolean }): StripPlacement[] {
  // 没有上一次（刚换了一批题签）就没有什么要留住的：照常摆
  const moving = opts?.moving === true && prev !== undefined;
  const placed = arrange(input, prev, moving);
  if (moving || prev === undefined || !placed.some(leftOut)) return placed;
  // 为了不动而少摆了一条，不值得：照“从头摆”再算一遍，那样摆得下的更多就用那一份。
  // 这样，从头摆时摆得下的画面（每一节在几种标准的画面上都查过），不管之前转过、缩放过什么，手一放开总是摆得全。
  const fresh = arrange(input, undefined, false);
  return fresh.filter(leftOut).length < placed.filter(leftOut).length ? fresh : placed;
}

/** 看得见但是摆不下的。 */
function leftOut(p: StripPlacement): boolean {
  return p.hidden && p.why === 'room';
}

/** 摆一遍。prev 不给就是从头摆；moving 的意思见 placeStrips。 */
function arrange(input: StripInput, prev: StripPlacement[] | undefined, moving: boolean): StripPlacement[] {
  const { size, insets } = input;
  const free: Rect = { x0: insets.left + MARGIN, y0: insets.top + MARGIN, x1: size.width - insets.right - MARGIN, y1: size.height - insets.bottom - MARGIN };
  const gap = GAP * clamp(size.width / GAP_FULL_WIDTH, 0.5, 1);
  const anchors = new Map(input.anchors.map((anchor) => [anchor.id, anchor]));
  const before = new Map((prev ?? []).map((p) => [p.id, p]));

  // 要紧的先摆；一样要紧的，按写的先后。
  const order = input.strips.map((strip, index) => ({ strip, index })).sort((a, b) => a.strip.rank - b.strip.rank || a.index - b.index);

  // 每一条看得见的题签指的那一点，摆没摆下都不让别的题签压住。
  const dots: { id: string; rect: Rect }[] = [];
  for (const { strip } of order) {
    const anchor = anchors.get(strip.id);
    if (anchor && seen(anchor, free)) dots.push({ id: strip.id, rect: dotRect(anchor) });
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

  // 一条摆不下时：回头挪一条已经摆好的（从最后摆的那一条试起），看这一条摆不摆得下。只挪一条，不连着挪。
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
        result[earlier.index] = shown(earlier.id, alt);
        return mine;
      }
    }
    return undefined;
  };

  for (const { strip, index } of order) {
    const anchor = anchors.get(strip.id);
    const was = before.get(strip.id);
    // 手还在动时，没摆的那一条把原来的号带着：手放开以后好回到原处
    const kept = moving && was?.slot !== undefined ? { slot: was.slot } : {};
    if (!anchor || !seen(anchor, free)) {
      result[index] = { id: strip.id, x: anchor?.x ?? 0, y: anchor?.y ?? 0, hidden: true, leader: null, why: 'unseen', ...kept };
      continue;
    }
    const all = candidates(strip, anchor, free, gap, was?.slot);

    let pick: Candidate | undefined;
    if (moving && was?.slot !== undefined) {
      // 留在原来的号上；留不住就先不摆，那个位置再空出来时摆回去
      const same = all.find((c) => c.slot === was.slot);
      if (same && allowed(strip.id, same, taken)) pick = same;
    } else if (!moving || was?.why !== 'room') {
      pick = all.find((c) => allowed(strip.id, c, taken));
      // 手还在动时不为新来的一条去挪别的
      if (!pick && !moving) pick = makeRoom(strip.id, all);
    }
    // 剩下的一种：手还在动，这一条上一次就摆不下。手放开以前不给它挑位置

    if (!pick) {
      result[index] = { id: strip.id, x: anchor.x, y: anchor.y, hidden: true, leader: null, why: 'room', ...kept };
      continue;
    }
    taken.push({ id: strip.id, index, cand: pick, all });
    result[index] = shown(strip.id, pick);
  }

  return result;
}

/**
 * 一个号摆在那一点的哪一边。绕着那一点找到的位置（最后的办法）不算哪一边，是 null。
 * 给测试用：定格图和真沙盘要把远处的题签摆在同一边。
 */
export function sideOfSlot(slot: number): Side | null {
  if (!Number.isInteger(slot) || slot < 0 || slot >= RING_SLOT) return null;
  return SIDES.find((side) => SIDE_CODE[side] === Math.floor(slot / 100)) ?? null;
}

function shown(id: string, c: Candidate): StripPlacement {
  return { id, x: c.x, y: c.y, hidden: false, leader: c.leader, slot: c.slot };
}

/** 那一点看不看得见：没被挡住，而且在留出来的那一块里面（出去一点点不算出去）。 */
function seen(anchor: Anchor, free: Rect): boolean {
  return (
    anchor.visible &&
    anchor.x >= free.x0 - SEEN_OUTSIDE &&
    anchor.x <= free.x1 + SEEN_OUTSIDE &&
    anchor.y >= free.y0 - SEEN_OUTSIDE &&
    anchor.y <= free.y1 + SEEN_OUTSIDE
  );
}

/** 这一条题签的候选位置，从便宜到贵。stay 是上一次的号。 */
function candidates(strip: Strip, anchor: Anchor, free: Rect, gap: number, stay: number | undefined): Candidate[] {
  const halfW = strip.w / 2;
  const halfH = strip.h / 2;
  // 题签的中心能到哪：取整以后也不出留出来的那一块。留出来的地方比题签还小，就没有位置。
  const loX = Math.ceil(free.x0 + halfW);
  const hiX = Math.floor(free.x1 - halfW);
  const loY = Math.ceil(free.y0 + halfH);
  const hiY = Math.floor(free.y1 - halfH);
  if (loX > hiX || loY > hiY) return [];

  const out = outward(anchor);
  const own = dotRect(anchor);
  const foot = anchor.foot && Number.isFinite(anchor.foot.x) && Number.isFinite(anchor.foot.y) ? anchor.foot : null;
  const found: Candidate[] = [];
  const add = (slot: number, cost: number, x: number, y: number): void => {
    const rect: Rect = { x0: x - halfW, y0: y - halfH, x1: x + halfW, y1: y + halfH };
    // 压住了自己指的那一点，或者压住了从那一点到它脚下的那一段：不要
    if (overlaps(rect, own)) return;
    if (foot && crosses([anchor.x, anchor.y, foot.x, foot.y], grow(rect, DOT))) return;
    // 引线连到题签上离那一点最近的地方
    const nearX = clamp(anchor.x, rect.x0, rect.x1);
    const nearY = clamp(anchor.y, rect.y0, rect.y1);
    const total = cost + Math.hypot(nearX - anchor.x, nearY - anchor.y) * COST_LEADER - (slot === stay ? STAY_BONUS : 0);
    found.push({ slot, cost: total, x, y, rect, leader: [anchor.x, anchor.y, nearX, nearY] });
  };

  sidesFor(strip, out).forEach((side, sideIndex) => {
    const [vx, vy] = SIDE_VEC[side];
    const upright = vx === 0;
    const slides = upright ? SLIDES_ACROSS : SLIDES_ALONG;
    const step = upright ? (strip.w + GUTTER) / 2 : strip.h / 3;
    GAPS.forEach((times, gapIndex) => {
      slides.forEach((slide, slideIndex) => {
        const wantX = anchor.x + vx * (gap * times + halfW) + (upright ? slide * step : 0);
        const wantY = anchor.y + vy * (gap * times + halfH) + (upright ? 0 : slide * step);
        // 出了留出来的那一块就推回来
        const pushed = Math.hypot(clamp(wantX, free.x0 + halfW, free.x1 - halfW) - wantX, clamp(wantY, free.y0 + halfH, free.y1 - halfH) - wantY);
        add(
          SIDE_CODE[side] * 100 + gapIndex * 10 + slideIndex,
          sideIndex * COST_SIDE + gapIndex * COST_GAP + slideIndex * COST_SLIDE + pushed * COST_PUSHED,
          clamp(Math.round(wantX), loX, hiX),
          clamp(Math.round(wantY), loY, hiY),
        );
      });
    });
  });

  // 最后的办法：绕着那一点一圈一圈往外找，最远找到留出来的那一块短边的一半
  const reach = Math.min(free.x1 - free.x0, free.y1 - free.y0) / 2;
  const first = gap + Math.max(halfW, halfH);
  for (let ring = 0; first + ring * RING_STEP <= reach + Math.max(halfW, halfH); ring++) {
    const radius = first + ring * RING_STEP;
    for (let k = 0; k < RING_DIRECTIONS; k++) {
      const angle = (k / RING_DIRECTIONS) * Math.PI * 2;
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      // 远处的题签不往沙盘里面找
      if (out && dx * out[0] + dy * out[1] < 0) continue;
      const x = Math.round(anchor.x + dx * radius);
      const y = Math.round(anchor.y + dy * radius);
      if (x < loX || x > hiX || y < loY || y > hiY) continue;
      add(RING_SLOT + ring * RING_DIRECTIONS + k, RING_COST + radius * RING_COST_PER_PX, x, y);
    }
  }

  // 代价一样的，先想到的在前（sort 不打乱原来的先后）
  return found.sort((a, b) => a.cost - b.cost);
}

/** 先试哪一边、后试哪一边。远处的题签按哪一边最朝外来排，朝着沙盘里面的不试；别的先试场景里写的那一边。 */
function sidesFor(strip: Strip, out: readonly [number, number] | null): Side[] {
  if (out) {
    const along = (side: Side): number => SIDE_VEC[side][0] * out[0] + SIDE_VEC[side][1] * out[1];
    return SIDES.filter((side) => along(side) > INWARD_BELOW).sort((a, b) => along(b) - along(a));
  }
  const wish = strip.side;
  return wish ? [wish, ...SIDES.filter((side) => side !== wish)] : [...SIDES];
}

/** 远处的题签朝外的方向（长度为 1）。没有写、写得不成方向的，当作没有。 */
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

/** 两块有没有叠在一起。只是边挨着边不算。 */
function overlaps(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

/** 一条线段有没有从一块里面穿过去。只是碰到边不算。 */
function crosses([ax, ay, bx, by]: readonly [number, number, number, number], r: Rect): boolean {
  let enter = 0;
  let leave = 1;
  const dx = bx - ax;
  const dy = by - ay;
  // 线段上的点是 a + t(b − a)，t 从 0 到 1；一条边一条边地把 t 的范围收窄
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

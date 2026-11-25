// 全程沙盘上小像停着的时候，题签怎么让开他。只在全程沙盘那一块程序里（routeLevel.ts 把它转出去；页面的程序、站点沙盘都不带它）。
//
// 做法（两步，都是叫 placeStrips，这里不另写一套摆法）：
//   一、先照“没有小像”摆一遍（不给 avoid）：这就是别的日子里沙盘上的样子。
//   二、只有碰着小像的那几条——题签压着他占的那一块，或者引线从那一块上穿过去——另找位置；别的题签一条也不动。
//       办法是再叫一次 placeStrips，这一次给 avoid，并且照“读者的手还在动”的规矩摆（那套规矩正好是：摆过的留在原来的号上，
//       没摆过的照常挑一个空位、不为它去挪别的）：没碰着他的各条带着第一步的号、排在最前头，原样留住；
//       碰着他的各条不带号，照要紧的先后一条一条在剩下的地方里挑——不碰他，不碰留在原处的那些，彼此也不碰。
//       一条找不到位置的，就留在第一步给它的地方（那是别的都不动的时候，摆的规矩给它的最好的位置）。
// 这样他走到哪一处，离他远的地名都不换地方（整个重摆的话，两个镇的名字会对调）。
//   三、只有一种时候整个重摆（每一条都重新挑，都躲着他，就是直接叫 placeStrips）：碰着他的一条让开以后，引线比 LEADER_MAX_PX 还长——
//       近处的位置都被没动的那几条占着，它只好站到别的镇旁边去（竖着拿的平板上他在汴京的时候，“汴京”站到了一百像素以外）。
//       那一回宁可多挪几条，也不让一个名字离它的点那么远。
//
// 他站在线上、沙盘平时没有立名字的一处的时候，这一层的最后多一条题签（id 是 PIECE_NAME）：那一处的名字，指着他脚下。
// 它不参加上面的两步（别的题签摆出来同没有它的时候一个数不差），最后才摆：别的都留在原处，它在剩下的地方里照摆的规矩挑一个，
// 引线从他占的那一块的边上起。摆不下，或者引线（从那一块的边上量）比 NAME_LEADER_MAX_PX 长（他近处的位置都被别的题签占着）：
// 让它先挑一个紧挨着他的位置，别的题签只挪碰着他、碰着它的那几条（它占的那一块同他占的那一块一样不许压）。
// 这样还有一条让得太远，才整个重摆——那一回它排在最前头先挑，别的再躲开他和它。
//
// 引线不画在他身上：一条题签的引线有一截落在他占的那一块里的（他站在这个地名点上，名字的线从他脚下出去；或者找不到位置、线还穿着他的），
// 结果里记下 from——线从哪里画起（从它指的那一点数，走了全长的几成，就是线从那一块里出来的地方）；题签层照它画（strips.ts）。
//
// 上一回的摆法要记两份：题签层交回来的 prev 是上一回最后摆成的样子（挪过的那几条在挪过以后的位置上）；第一步要的是上一回“没有小像”的那一份，
// 不然挪过的几条会带着新位置去占别人的地方。所以这里造出来的是一个带着记性的函数，一层题签用一个。

import { placeStrips } from './placeStrips';
import type { StripInput, StripPlacement } from './types';

type Box = NonNullable<StripInput['avoid']>[number];
type Line = readonly [number, number, number, number];

/**
 * 一条线段从一块里面穿过去（只是碰到边不算）的话，它从这一块里出来的地方：从线段的起头数，走了全长的几成（大于 0，最多是 1）。
 * 没有穿过去是 0。
 */
export function leavesAt([ax, ay, bx, by]: Line, box: Box): number {
  let enter = 0;
  let leave = 1;
  // 线段上的点是 a + t(b − a)，t 从 0 到 1；一条边一条边地把 t 的范围收窄
  for (const [p, q] of [
    [ax - bx, ax - box.x0],
    [bx - ax, box.x1 - ax],
    [ay - by, ay - box.y0],
    [by - ay, box.y1 - ay],
  ]) {
    if (p === 0) {
      if (q <= 0) return 0;
    } else if (p < 0) enter = Math.max(enter, q / p);
    else leave = Math.min(leave, q / p);
  }
  return enter < leave ? leave : 0;
}

/**
 * 一条题签（中心在 x、y，宽 w、高 h，引线是 leader）碰没碰着小像占的那一块：压住了算；引线从上面穿过去也算——
 * 引线起头的那一点自己就在那一块里面的除外（小像站在这个地名点上，名字的线从他脚下出去）。
 */
export function touches(x: number, y: number, w: number, h: number, leader: Line, box: Box): boolean {
  if (x - w / 2 < box.x1 && x + w / 2 > box.x0 && y - h / 2 < box.y1 && y + h / 2 > box.y0) return true;
  return !(leader[0] > box.x0 && leader[0] < box.x1 && leader[1] > box.y0 && leader[1] < box.y1) && leavesAt(leader, box) > 0;
}

/** 算题签摆在哪的函数：同 placeStrips 一个样子。 */
export type StripPlacer = typeof placeStrips;

/** 没碰着他的各条排在最前头：要紧的号（rank）减这么多。 */
const FIRST = 1e6;

/** 小像站在线上、沙盘平时没有立名字的一处的时候，旁边立出的那一条题签的 id（沙盘程序把它添在这一节的题签的最后）。 */
export const PIECE_NAME = 'piece-name';
/** 碰着他的一条让开以后，引线最长这么长（像素）；再长，这一回整个重摆。 */
export const LEADER_MAX_PX = 70;
/** 他自己的名字，引线从他占的那一块的边上量，最长这么长（像素）；再长，或者摆不下，这一回整个重摆。 */
export const NAME_LEADER_MAX_PX = 40;

/** 一条摆好的题签的引线多长（像素）；没有引线是 0。 */
const reach = (p: StripPlacement): number => (p.leader ? Math.hypot(p.leader[2] - p.leader[0], p.leader[3] - p.leader[1]) : 0);

/** 造一个“让开小像”的摆法（一层题签用一个）。没有给 avoid 的时候，它摆出来的就是 placeStrips 摆出来的。 */
export function aroundPiece(): StripPlacer {
  /** 上一回照“没有小像”摆出来的那一份。 */
  let without: StripPlacement[] | undefined;
  return (input, prev, opts) => {
    const boxes = input.avoid ?? [];
    /** 引线落在他身上的那一截不画。 */
    const trim = (p: StripPlacement): StripPlacement => {
      const from = p.leader ? Math.max(0, ...boxes.map((box) => leavesAt(p.leader as Line, box))) : 0;
      return from > 0 ? { ...p, from } : p;
    };
    // 他自己的名字（有的话是最后一条）先放在一边：别的照下面两步摆，同没有它的时候一个数不差
    const self = input.strips.at(-1)?.id === PIECE_NAME ? input.strips.at(-1) : undefined;
    const strips = self ? input.strips.slice(0, -1) : input.strips;
    // 题签层说“没有上一回”（刚换了一批、镜头刚滑到）：这里也从头摆
    const base = placeStrips({ ...input, strips, avoid: undefined }, prev && (without ?? prev), opts);
    without = base;
    if (boxes.length === 0) return self ? [...base, { id: PIECE_NAME, x: 0, y: 0, hidden: true, leader: null, why: 'unseen' }] : base;
    // 手真的还在动沙盘的时候，碰着他的也不重新挑：上一回挪到的号还空着就留在那里，不然先留在第一步的地方
    const kept = (id: string): StripPlacement[] => (opts?.moving ? (prev ?? []).filter((p) => p.id === id) : []);
    /** 第二步：只挪碰着这几块（avoid）的那几条。far 是挪开的里面有一条的引线太长了。 */
    const aside = (avoid: Box[]): { out: StripPlacement[]; far: boolean } => {
      const hit = base.map((p, i) => !!p.leader && avoid.some((box) => touches(p.x, p.y, strips[i].w, strips[i].h, p.leader as Line, box)));
      const first = strips.map((strip, i) => (hit[i] ? strip : { ...strip, rank: strip.rank - FIRST }));
      const again = hit.includes(true) ? placeStrips({ ...input, strips: first, avoid }, base.flatMap((p, i) => (hit[i] ? kept(p.id) : [p])), { moving: true }) : base;
      // 找不到位置的留在原处
      const out = again.map((p, i) => (hit[i] && p.hidden ? base[i] : p));
      return { out, far: out.some((p, i) => hit[i] && reach(p) > LEADER_MAX_PX) };
    };
    /** 他自己的名字摆出来了，引线（从他占的那一块的边上量）也不太长。 */
    const near = (p: StripPlacement): boolean => !p.hidden && reach(p) * (1 - (p.from ?? 0)) <= NAME_LEADER_MAX_PX;
    /** 整个重摆的时候用的那一批：他自己的名字排在最前头（它要紧挨着他），别的再躲开他和它。 */
    const lead = self ? { ...input, strips: [...strips, { ...self, rank: -1 }] } : input;
    let { out, far } = aside(boxes);
    if (self && !far) {
      // 他自己的名字：别的都带着号、排在前头，留在原处；它在剩下的地方里挑
      const last = placeStrips({ ...input, strips: [...strips.map((strip) => ({ ...strip, rank: strip.rank - FIRST })), self] }, [...out, ...kept(PIECE_NAME)], { moving: true });
      let mine = trim(last[strips.length]);
      if (near(mine) && !out.some((p, i) => p.hidden !== last[i].hidden || p.x !== last[i].x || p.y !== last[i].y)) return [...out.map(trim), mine];
      // 他近处没有空位：让它先挑（只躲着他和各条题签指的那一点），别的只挪碰着他、碰着它的那几条
      mine = trim(placeStrips(lead)[strips.length]);
      ({ out, far } = aside([...boxes, { x0: mine.x - self.w / 2, y0: mine.y - self.h / 2, x1: mine.x + self.w / 2, y1: mine.y + self.h / 2 }]));
      if (near(mine) && !far) return [...out.map(trim), mine];
      far = true;
    }
    // 整个重摆：每一条都躲着他重新挑
    return (far ? placeStrips(lead, opts?.moving ? prev : undefined, opts) : out).map(trim);
  };
}

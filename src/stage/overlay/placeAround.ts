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
// 它挑的位置不挨着别的地名点：占的那一块离别的题签指的一点比离他还近的话，名字会被读成那个点的。最后才摆的那一回挑出来的位置要是这样
//（或者他近处根本没有空位），就照摆的规矩里的先后把它能站的号一个一个试过去（叫 placeStrips、照“手还在动”的规矩给它一个号：那套规矩正好是
// 只试这一个号）：先是别的题签都不动的时候，头一个站得上去、离他不超过 NAME_LEADER_MAX_PX、又不挨着别的点的号；没有，再让它先挑——
// 头一个这样的号，而且碰着他、碰着它的那几条都让得开（没有一条没处让，没有一条让到 LEADER_MAX_PX 以外）。两回都没有：最后才摆的那一回
// 摆成了的，就留在挨着的那个地方；摆不成的照上面说的让它先挑、再不行整个重摆。手真的还在动沙盘的时候不试（它留在原来的号上）；整个重摆的那一回也不试。
//
// 引线不画在他身上：一条题签的引线有一截落在他占的那一块里的（他站在这个地名点上，名字的线从他脚下出去；或者找不到位置、线还穿着他的），
// 结果里记下 from——线从哪里画起（从它指的那一点数，走了全长的几成，就是线从那一块里出来的地方）；题签层照它画（strips.ts）。
//
// 上一回的摆法要记两份：题签层交回来的 prev 是上一回最后摆成的样子（挪过的那几条在挪过以后的位置上）；第一步要的是上一回“没有小像”的那一份，
// 不然挪过的几条会带着新位置去占别人的地方。所以这里造出来的是一个带着记性的函数，一层题签用一个。

import { placeStrips } from './placeStrips';
import type { StripInput, StripPlacement, YieldingPlacer } from './types';

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

/**
 * 他自己的名字能站的各个号，照摆的规矩里的先后（placeStrips.ts：一个号是哪一边 × 100 + 隔多远 × 10 + 偏几格，
 * 换一边贵 8、远一档贵 5、偏一格贵 3）。只有四边的号；绕着那一点一圈一圈找的位置（号从 1000 起，摆的规矩里最后的办法）这里不试。
 */
const order = (slot: number): number => ((slot / 100) | 0) * 8 + (((slot / 10) | 0) % 10) * 5 + (slot % 10) * 3;
export const SLOTS = [...Array(400).keys()].sort((a, b) => order(a) - order(b));

/** 一条摆好的题签的引线多长（像素）；没有引线是 0。 */
const reach = (p: StripPlacement): number => (p.leader ? Math.hypot(p.leader[2] - p.leader[0], p.leader[3] - p.leader[1]) : 0);

/**
 * 造一个“让开小像”的摆法（一层题签用一个）。没有给 avoid 的时候，它摆出来的就是 placeStrips 摆出来的。
 * 造出来的函数可以多接一样（第四个）：place，拿哪一套摆法去让。不给就是 placeStrips，同原来一个数不差；
 * 另一种题签（平着的纸条，./slips.ts）把它自己的摆法交进来，上面说的每一步就都照那一套摆。
 * 它身上带着 yields 这个记号（./types.ts 的 YieldingPlacer）：另一种题签靠这个记号认出它，别的摆法它一律换成自己的。
 */
export function aroundPiece(): YieldingPlacer {
  /** 上一回照“没有小像”摆出来的那一份。 */
  let without: StripPlacement[] | undefined;
  const around = (input: StripInput, prev?: StripPlacement[], opts?: { moving?: boolean }, place: StripPlacer = placeStrips): StripPlacement[] => {
    const boxes = input.avoid ?? [];
    /** 引线落在他身上的那一截不画。 */
    const trim = (p: StripPlacement): StripPlacement => {
      const from = p.leader ? Math.max(0, ...boxes.map((box) => leavesAt(p.leader as Line, box))) : 0;
      return from > 0 ? { ...p, from } : p;
    };
    // 他自己的名字（有的话是最后一条）先放在一边：别的照下面两步摆，同没有它的时候一个数不差
    // 不用数组的 at()：iOS 15 起头的几版 Safari 还没有它，摆题签的这一步在那里会整个出错
    const last = input.strips.slice(-1)[0];
    const self = last?.id === PIECE_NAME ? last : undefined;
    const strips = self ? input.strips.slice(0, -1) : input.strips;
    // 题签层说“没有上一回”（刚换了一批、镜头刚滑到）：这里也从头摆
    const base = place({ ...input, strips, avoid: undefined }, prev && (without ?? prev), opts);
    without = base;
    if (boxes.length === 0) return self ? [...base, { id: PIECE_NAME, x: 0, y: 0, hidden: true, leader: null, why: 'unseen' }] : base;
    // 手真的还在动沙盘的时候，碰着他的也不重新挑：上一回挪到的号还空着就留在那里，不然先留在第一步的地方
    const kept = (id: string): StripPlacement[] => (opts?.moving ? (prev ?? []).filter((p) => p.id === id) : []);
    /** 第二步：只挪碰着这几块（avoid）的那几条。far 是挪开的里面有一条的引线太长了（比 max 长）；stuck 是有一条找不到位置、留在了原处。 */
    const aside = (avoid: Box[], max = LEADER_MAX_PX): { out: StripPlacement[]; far: boolean; stuck: boolean } => {
      const hit = base.map((p, i) => !!p.leader && avoid.some((box) => touches(p.x, p.y, strips[i].w, strips[i].h, p.leader as Line, box)));
      const first = strips.map((strip, i) => (hit[i] ? strip : { ...strip, rank: strip.rank - FIRST }));
      const again = hit.includes(true) ? place({ ...input, strips: first, avoid }, base.flatMap((p, i) => (hit[i] ? kept(p.id) : [p])), { moving: true }) : base;
      // 找不到位置的留在原处
      const out = again.map((p, i) => (hit[i] && p.hidden ? base[i] : p));
      return { out, far: out.some((p, i) => hit[i] && reach(p) > max), stuck: again.some((p, i) => hit[i] && p.hidden) };
    };
    /** 他自己的名字摆出来了，引线（从他占的那一块的边上量；p 是 trim 过的）也不太长。 */
    const near = (p: StripPlacement): boolean => !p.hidden && reach(p) * (1 - (p.from ?? 0)) <= NAME_LEADER_MAX_PX;
    /** 整个重摆的时候用的那一批：他自己的名字排在最前头（它要紧挨着他），别的再躲开他和它。 */
    const lead = self ? { ...input, strips: [...strips, { ...self, rank: -1 }] } : input;
    const { out, far: beyond } = aside(boxes);
    let far = beyond;
    if (self && !far) {
      const [w, h] = [self.w / 2, self.h / 2];
      /** 他的名字摆在 p：占的那一块离别的题签指的一点比离他还近。 */
      const shy = (p: StripPlacement): boolean => {
        /** 它占的那一块离另一块多远（一点就是没有大小的一块）。 */
        const gap = (b: Box): number => Math.hypot(Math.max(b.x0 - p.x - w, 0, p.x - w - b.x1), Math.max(b.y0 - p.y - h, 0, p.y - h - b.y1));
        // 他占的是头一块（沙盘程序给的就这一块）。名字自己指的是他脚下，在那一块里面，从来不比那一块近，不用另外除开
        return input.anchors.some((a) => a.visible && gap({ x0: a.x, y0: a.y, x1: a.x, y1: a.y }) < gap(boxes[0]));
      };
      /**
       * 他的名字站在 q，别的只挪碰着他、碰着它的那几条：摆出来的一份。让开的里面有一条让到 NAME_LEADER_MAX_PX 以外的
       *（为了一个名字，别的不该让得比它自己还远：让远了，两个镇的名字会站到对方的点旁边去），
       * 或者有一条没处让、留在原处的（它会压着这个名字），不算数（false）。
       */
      const beside = (q: StripPlacement): StripPlacement[] | false => {
        const next = aside([...boxes, { x0: q.x - w, y0: q.y - h, x1: q.x + w, y1: q.y + h }], NAME_LEADER_MAX_PX);
        return !next.far && !next.stuck && [...next.out.map(trim), q];
      };
      // 他自己的名字：别的都带着号、排在前头，留在原处；它在剩下的地方里挑
      const rest = { ...input, strips: [...strips.map((strip) => ({ ...strip, rank: strip.rank - FIRST })), self] };
      const after = place(rest, [...out, ...kept(PIECE_NAME)], { moving: true });
      const mine = trim(after[strips.length]);
      /**
       * 照先后一个号一个号地试：它站得上去、离他近、不挨着别的地名点，摆出来的一份又算数的，头一个就是。
       * 平常别的题签都留在原处；first：让它先挑，别的照 beside 让开。
       */
      const seek = (first?: boolean): StripPlacement[] | false | undefined => {
        for (const slot of SLOTS) {
          const q = trim(place(first ? lead : rest, [...(first ? [] : out), { ...mine, slot }], { moving: true })[strips.length]);
          const all = near(q) && !shy(q) && (first ? beside(q) : [...out.map(trim), q]);
          if (all) return all;
        }
      };
      /** 最后才摆的那一回摆成了（离他近，别的一条没动）的话，那一回的结果。 */
      const calm = near(mine) && !out.some((p, i) => p.hidden !== after[i].hidden || p.x !== after[i].x || p.y !== after[i].y) && [...out.map(trim), mine];
      // 摆成了，又不挨着别的地名点（手还在动的时候不挑）：就是它
      if (calm && (opts?.moving || !shy(mine))) return calm;
      // 挨着别的地名点，或者他近处没有空位。先在别的都不动的时候找一个不挨着的号；没有，让它先挑一个不挨着的
      //（只躲着他和各条题签指的那一点），别的只挪碰着他、碰着它的那几条，都让得开才算；再没有，摆成了的就留在挨着的那个地方，
      // 摆不成的整个重摆。手真的还在动沙盘的时候不试
      const found = (!opts?.moving && ((calm && seek()) || seek(true))) || calm;
      if (found) return found;
      far = true;
    }
    // 整个重摆：每一条都躲着他重新挑
    return (far ? place(lead, opts?.moving ? prev : undefined, opts) : out).map(trim);
  };
  return Object.assign(around, { yields: true as const });
}

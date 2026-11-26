// 题签这一层：页面上的字，竖着写，带一条引线，盖在沙盘上面。约定见 ./types.ts。
// 摆在哪由 placeStrips 算，这里只管把字和线放到页面上。
//
// 排版离不了的几条样式（绝对定位、竖写、不折行）直接写在元素上：没有样式表也量得出大小、摆得对位置。
// 字体、颜色、纸条的底这些样子，在 src/styles/stage.css 里按类名 .strip、.strip-leaders 写。
// 容器要是定了位的元素（position 不是 static），这一层才盖得住它。
//
// 一条题签摆不下时不摆，在它指的那一点上画一个空心的圈：这里有一处没标出。这一层不写句子——沙盘旁边的话都是页面的。
// 远处的题签，那一点上另画一个朝沙盘外面的小箭头（见 ARROW_LENGTH），底下垫一圈纸色的衬边。
// 全程沙盘上是站的地名，名字下面带着站号的印（StripSpec.seals）：每一方是一个链接，按名字就是按头一方。
// 带印的题签接得住手指和鼠标（样式表里 .has-seals 开了 pointer-events），从它上面起手的拖动转不动沙盘。
// 圈的样子（不填色、墨色的边）直接写在元素上：样式表里 .strip-leaders circle 那一条是给实心的点用的，会把圈也填上。

import type { TableScene } from '../../domain/scene';
import type { StripText } from '../../domain/sceneText';
import type { StageInsets, StopMark } from '../types';
import { placeStrips } from './placeStrips';
import type { LabelKitMaker, StripInput, StripLayer, StripPlacement, StripPlacer, StripSeal, StripSpec } from './types';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * 另一种题签（平着的纸条，./slips.ts，写了这一种的沙盘才下载）是页面那一边取来、记在容器上的（src/stage/index.ts）：
 * 挂在这个容器里的那一层题签就照它造、照它摆。root 是那一层的元素（它在上面记下自己是哪一种，样式表照着挑）。
 * 没有记的容器（竖着的纸条的沙盘从来不记），下面的每一处都照原来的走。
 * 记了就不收回——靠的是一个容器从头到尾只摆一座沙盘：沙盘栏换一座沙盘就换一个容器（src/ui/StagePane.tsx 里那一层的 key 是沙盘的 key）。
 * 哪一天要在同一个容器里先后摆两座题签不是一种的沙盘，这里得添“收回”（竖着的纸条的沙盘摆之前把记的拿掉）。
 */
const kits = new WeakMap<HTMLElement, LabelKitMaker>();
export function labelsIn(container: HTMLElement, kit: LabelKitMaker): void {
  kits.set(container, kit);
}

/** 空心的圈：半径，和两层的样子（底下一圈纸色的衬边，深色的地面上也看得见；上面一圈墨色的线）。颜色和实心的点用同样的两个。 */
const RING_RADIUS = '4.2';
const RING_HALO_STYLE = 'fill:none;stroke:var(--figure-halo, #f5efe3);stroke-width:3.6;opacity:0.85';
const RING_LINE_STYLE = 'fill:none;stroke:var(--figure-leader, #2a2520);stroke-width:1.3';

/**
 * 远处的题签，在它指的那一点上再画一个朝沙盘外面的小箭头：那一点只是沙盘的边，地方还在外面很远。
 * 没有箭头的话，读的人会把沙盘边上的那一点当成那个地方。箭头多长、箭头尖多大（像素），和它的样子。
 */
const ARROW_LENGTH = 16;
const ARROW_HEAD = 5;
const ARROW_STYLE = 'fill:none;stroke:var(--figure-leader, #2a2520);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round';
/** 箭头底下垫的衬边（和空心圈的衬边一个颜色）：竖着拿的平板上箭头尖正落在沙盘深色的边框上，墨色压着深褐色，没有衬边就只剩半截。 */
const ARROW_HALO_STYLE = 'fill:none;stroke:var(--figure-halo, #f5efe3);stroke-width:3.6;opacity:0.85;stroke-linecap:round;stroke-linejoin:round';

/**
 * 引线底下垫的衬边（和空心圈、箭头的衬边一个颜色）：一像素宽的墨线压在夜里的深色水面、深色的屋顶上，反差只剩白天的一半，
 * 垫一条纸色的、宽三像素的线，哪种天色都看得清。
 */
const LEADER_UNDER_STYLE = 'fill:none;stroke:var(--figure-halo, #f5efe3);stroke-width:3;opacity:0.8';

/**
 * 一条横平竖直的线画在整像素上：中线挪到半个像素的地方，一像素宽的线正好占一行（一列）像素。
 * 中线落在别处（比如 200.0）的话，这一像素的墨被分到相邻的两行里，各淡一半。
 */
const onPixel = (v: number): number => Math.floor(v) + 0.5;

interface Item {
  spec: StripSpec;
  el: HTMLDivElement;
  /** 引线，和垫在它底下的衬边（一起显、一起藏）。 */
  under: SVGPathElement;
  line: SVGLineElement;
  dot: SVGCircleElement;
  /** 远处的题签才画的小箭头，和垫在它底下的衬边（两条一样的线，一起显、一起藏）。 */
  arrow: SVGPathElement;
  halo: SVGPathElement;
  /** 摆不下时画在那一点上的空心的圈。 */
  ring: SVGGElement;
  w: number;
  h: number;
}

/**
 * 一小节要摆的题签。texts 是页面拼的那一份字（src/domain/sceneText.ts 的 stripTexts(scene, heading, 古今)，叫的人自己拼好交进来：
 * 这个文件不引 sceneText.ts——引了，打包的工具会把它从页面的程序里单拆成一个文件）；side 是场景里写的；
 * 全程沙盘上是站的地名带上站号的印。marks 是每一站的印怎么写、通到哪（页面从 figure.json 里拼的）；
 * 没有交、或者里面没有这一站，这一站就没有印。立体的沙盘和定格图都用这一个函数。
 */
export function sectionStripSpecs(scene: TableScene, heading: string, texts: StripText[], marks?: Record<string, StopMark>): StripSpec[] {
  const here = scene.level === 'route' ? scene.sections.find((section) => section.heading === heading)?.stop : undefined;
  return texts.map((t) => {
    const written = scene.strips.find((s) => s.id === t.id);
    const spec: StripSpec = { id: t.id, text: t.text, tone: t.tone, side: written?.side, lean: written?.lean };
    const seals: StripSeal[] = [];
    for (const stop of t.stops ?? []) {
      const mark = marks?.[stop];
      if (mark) seals.push({ stop, label: mark.label, href: mark.href, filled: mark.written, here: stop === here, title: mark.title });
    }
    if (seals.length > 0) spec.seals = seals;
    // 地名点写了“这个名字没有点”的，和指着海的名字，指的是一片地方，不是一点（平着的纸条才看这一项，见 ./types.ts 的 StripSpec.area）
    if (t.area || written?.of === 'coast') spec.area = true;
    return spec;
  });
}

/**
 * 在沙盘的容器里挂一层题签。只往 container 里面添东西，destroy 时把自己添的都拿走。
 * place 是算位置的函数：不给就是 placeStrips；全程沙盘交进来的是“小像停着的时候只挪碰着他的那几条”的那一个（./placeAround.ts）。
 */
export function mountStrips(container: HTMLElement, place: StripPlacer = placeStrips): StripLayer {
  const doc = container.ownerDocument;

  const root = doc.createElement('div');
  root.className = 'strips';
  root.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none';
  // 这个容器记着另一种题签的：照它造、照它摆（摆法套在交进来的那一个外面）
  const kit = kits.get(container)?.(root);
  if (kit) place = kit.place(place);

  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'strip-leaders');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible';
  root.append(svg);
  container.append(root);
  // 带印的题签，按在名字上（印的外面）：去头一方印的那一站。按在印上的是链接自己的事
  root.addEventListener('click', (event) => {
    const target = event.target as Element | null;
    if (!target || target.closest('a')) return;
    const first = target.closest('.has-seals')?.querySelector<HTMLElement>('a');
    first?.click();
  });

  let items: Item[] = [];
  // 上一次 place 给的位置。换一批题签、重新量大小以后，先照它摆。
  let last: { anchors: StripInput['anchors']; size: StripInput['size']; insets: StageInsets; moving: boolean; avoid?: StripInput['avoid']; ground?: StripInput['ground'] } | null = null;
  let placements: StripPlacement[] | undefined;
  // hide() 之后、下一次 place 之前。
  let concealed = false;

  /** 竖着的纸条的元素。 */
  function strip(spec: StripSpec): HTMLDivElement {
    const el = doc.createElement('div');
    el.className = 'strip';
    el.dataset.stripId = spec.id;
    el.dataset.tone = spec.tone;
    // 先藏着：量得出大小，但还没摆好位置的时候不让人看见。
    el.style.cssText = 'position:absolute;left:0;top:0;transform:translate(-50%,-50%);writing-mode:vertical-rl;white-space:nowrap;visibility:hidden';
    el.textContent = spec.text;
    if (spec.seals?.length) {
      el.className = 'strip has-seals';
      for (const seal of spec.seals) {
        const a = doc.createElement('a');
        a.className = 'strip-seal';
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
    }
    return el;
  }

  function make(spec: StripSpec): Item {
    const under = doc.createElementNS(SVG_NS, 'path');
    under.style.cssText = LEADER_UNDER_STYLE;
    under.style.display = 'none';
    const line = doc.createElementNS(SVG_NS, 'line');
    // 引线带着这条题签的 id：样式表照它把“他站处立出的地名”的那一条引线加深（stage.css）
    line.setAttribute('data-strip-leader', spec.id);
    line.setAttribute('stroke', 'currentColor');
    line.setAttribute('stroke-width', '1');
    line.style.display = 'none';
    const dot = doc.createElementNS(SVG_NS, 'circle');
    dot.setAttribute('r', '2.6');
    dot.setAttribute('fill', 'currentColor');
    dot.style.display = 'none';
    const arrow = doc.createElementNS(SVG_NS, 'path');
    arrow.setAttribute('data-strip-arrow', spec.id);
    arrow.style.cssText = ARROW_STYLE;
    arrow.style.display = 'none';
    const halo = doc.createElementNS(SVG_NS, 'path');
    halo.style.cssText = ARROW_HALO_STYLE;
    halo.style.display = 'none';

    const ring = doc.createElementNS(SVG_NS, 'g');
    ring.setAttribute('data-strip-ring', spec.id);
    ring.style.display = 'none';
    for (const style of [RING_HALO_STYLE, RING_LINE_STYLE]) {
      const circle = doc.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('r', RING_RADIUS);
      circle.style.cssText = style;
      ring.append(circle);
    }

    const el = kit ? kit.make(doc, spec, dot) : strip(spec);
    svg.append(under, line, halo, arrow, dot, ring);
    root.append(el);
    return { spec, el, under, line, dot, arrow, halo, ring, w: 0, h: 0 };
  }

  function measure(): void {
    for (const item of items) {
      item.w = item.el.offsetWidth;
      item.h = item.el.offsetHeight;
    }
  }

  /** 箭头和它的衬边：d 是画成什么样；null 是收起来。 */
  function setArrow(item: Item, d: string | null): void {
    for (const path of [item.halo, item.arrow]) {
      if (d) path.setAttribute('d', d);
      path.style.display = d ? '' : 'none';
    }
  }

  function conceal(item: Item): void {
    item.el.style.visibility = 'hidden';
    item.under.style.display = 'none';
    item.line.style.display = 'none';
    item.dot.style.display = 'none';
    setArrow(item, null);
    item.ring.style.display = 'none';
  }

  /** 这条题签指的那一点朝沙盘外面是哪个方向；不是远处的题签、或者这一帧没有给方向时是 null。 */
  function outOf(item: Item): [number, number] | null {
    if (item.spec.tone !== 'far') return null;
    return last?.anchors.find((anchor) => anchor.id === item.spec.id)?.out ?? null;
  }

  function show(item: Item, placement: StripPlacement): void {
    if (placement.hidden) {
      conceal(item);
      // 看得见但是摆不下：在那一点上留一个空心的圈。那一点不在画面里的，什么也不画。
      if (placement.why === 'room') {
        item.ring.setAttribute('transform', `translate(${placement.x.toFixed(1)} ${placement.y.toFixed(1)})`);
        item.ring.style.display = '';
      }
      return;
    }
    item.ring.style.display = 'none';
    item.el.style.left = `${placement.x}px`;
    item.el.style.top = `${placement.y}px`;
    item.el.style.visibility = '';
    if (!placement.leader) {
      item.under.style.display = 'none';
      item.line.style.display = 'none';
      item.dot.style.display = 'none';
      setArrow(item, null);
      return;
    }
    const [ax, ay] = placement.leader;
    let [x1, y1, x2, y2] = placement.leader;
    // 竖着的引线横向落在整像素上，横着的竖向落在整像素上；那个点跟着线走（朝外的小箭头还从原来那一点起）
    if (Math.abs(x2 - x1) < 0.5) x1 = x2 = onPixel(x1);
    if (Math.abs(y2 - y1) < 0.5) y1 = y2 = onPixel(y1);
    // 线从哪里画起：平常就是那一点；小像停在线上的时候，落在他身上的那一截不画（placement.from），圆点照旧在那一点上
    const from = placement.from ?? 0;
    const sx = (x1 + (x2 - x1) * from).toFixed(1);
    const sy = (y1 + (y2 - y1) * from).toFixed(1);
    item.under.setAttribute('d', `M${sx} ${sy}L${x2.toFixed(1)} ${y2.toFixed(1)}`);
    item.under.style.display = '';
    item.line.setAttribute('x1', sx);
    item.line.setAttribute('y1', sy);
    item.line.setAttribute('x2', x2.toFixed(1));
    item.line.setAttribute('y2', y2.toFixed(1));
    item.line.style.display = '';
    item.dot.setAttribute('cx', x1.toFixed(1));
    item.dot.setAttribute('cy', y1.toFixed(1));
    item.dot.style.display = '';
    // 朝外的小箭头。题签自己已经摆在朝外的那一边时不画：引线就是朝外的，再画一个会叠在引线上
    const out = outOf(item);
    const length = Math.hypot(x2 - ax, y2 - ay);
    if (!out || (length > 0 && ((x2 - ax) * out[0] + (y2 - ay) * out[1]) / length > 0.5)) {
      setArrow(item, null);
      return;
    }
    const tipX = ax + out[0] * ARROW_LENGTH;
    const tipY = ay + out[1] * ARROW_LENGTH;
    // 箭头尖的两条边：从尖上往回，各偏开半个弧度
    const wing = (turn: number): string => {
      const c = Math.cos(turn);
      const s = Math.sin(turn);
      return `${(tipX - (out[0] * c - out[1] * s) * ARROW_HEAD).toFixed(1)} ${(tipY - (out[0] * s + out[1] * c) * ARROW_HEAD).toFixed(1)}`;
    };
    const tip = `${tipX.toFixed(1)} ${tipY.toFixed(1)}`;
    setArrow(item, `M${ax.toFixed(1)} ${ay.toFixed(1)}L${tip}M${wing(0.5)}L${tip}L${wing(-0.5)}`);
  }

  function arrange(): void {
    if (!last) return;
    // 传进来的先后就是要紧的先后。
    const strips = items.map((item, rank) => ({ id: item.spec.id, w: item.w, h: item.h, rank, side: item.spec.side, lean: item.spec.lean }));
    const placed = place({ strips, anchors: last.anchors, size: last.size, insets: last.insets, avoid: last.avoid, ground: last.ground }, placements, { moving: last.moving });
    placements = placed;
    items.forEach((item, i) => show(item, placed[i]));
  }

  /** 把一条题签的东西从页面上拿走。 */
  const take = (item: (typeof items)[number]): void => {
    item.el.remove();
    item.under.remove();
    item.line.remove();
    item.dot.remove();
    item.arrow.remove();
    item.halo.remove();
    item.ring.remove();
  };

  return {
    only(id) {
      items.filter((item) => item.spec.id !== id).forEach(take);
      items = items.filter((item) => item.spec.id === id);
      placements = placements?.filter((p) => p.id === id);
    },

    set(strips) {
      // 还是原来那几条（只是换了古今的叫法，或者同一节重摆），还是换了别的几条（换了小节）
      const sameStrips = strips.length === items.length && strips.every((strip, i) => strip.id === items[i].spec.id);
      items.forEach(take);
      items = strips.map(make);
      measure();
      // 换了一批：上一次摆在哪不算数了，每条重新挑位置（手还在动沙盘时也是）。
      placements = undefined;
      // 还是原来那几条（只是换了古今的叫法）：马上照原来的那几点摆。
      // 换了别的几条：手里那几点是上一节的。照着摆的话，两节都有的题签（“徐州”“汴水”）先落在上一节的位置上，
      // 下一次 place 又把它当成“上一次摆在哪”跟着走，这一节摆成什么样就看上一节是哪一节了。所以先不摆，等下一次 place。
      if (!concealed && sameStrips) arrange();
    },

    place(anchors, size, insets, opts) {
      // 画面大小变了，题签的字号可能跟着变，重新量一遍。
      if (last && (last.size.width !== size.width || last.size.height !== size.height)) measure();
      // 不许压的那几块（小像）也抄一份：换古今名字、重新量大小以后照它再摆
      // 地面的四个角不抄：交的人每一次都交新的一份
      last = { anchors: anchors.map(copyAnchor), size: { ...size }, insets: { ...insets }, moving: opts?.moving === true, avoid: opts?.avoid?.map((box) => ({ ...box })), ground: opts?.ground };
      concealed = false;
      arrange();
    },

    hide() {
      concealed = true;
      items.forEach(conceal);
      // 藏起来是因为镜头要滑到别处去：到了以后每条重新挑位置，不照滑之前的摆（“回到这一节”以后和头一次摆的一样）。
      placements = undefined;
    },

    remeasure() {
      measure();
      if (!concealed) arrange();
    },

    ground: kit?.ground,

    destroy() {
      root.remove();
      items = [];
      last = null;
      placements = undefined;
    },
  };
}

/** 把一点抄一份留着：沙盘程序下一帧可能接着用原来那个对象。 */
function copyAnchor(anchor: StripInput['anchors'][number]): StripInput['anchors'][number] {
  const copy = { ...anchor };
  if (anchor.out) copy.out = [anchor.out[0], anchor.out[1]];
  if (anchor.foot) copy.foot = { x: anchor.foot.x, y: anchor.foot.y };
  return copy;
}

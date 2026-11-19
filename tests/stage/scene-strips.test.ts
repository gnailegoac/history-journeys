// 场景验收（题签）：每一座真的站点沙盘、每一小节的题签，在几种画面上摆不摆得下。
// 在 Node 里跑：地面是真的，镜头用 src/stage/three/rig.ts 的 placeCamera 摆，题签指着的点用同一个文件的 screenAnchors 算
// （页面上的沙盘用的也是这两个），摆法是 src/stage/overlay/placeStrips.ts；题签多大照 ./support/stripSizes.ts。不要浏览器。
// content/ 里有几座沙盘就查几座。规矩写在 docs/data-spec.md 的“题签摆在哪”。
//
// 查三样：
//   1 三种标准的画面（电脑、横着拿的平板、竖着拿的平板，四边留的是在浏览器里量出来的空；手机不在标准里，不查）：
//     每一节的题签一条也不能少；摆出来的不压任何一条题签指的那一点，不压自己指的那样东西，引线不穿过别的题签。
//     不过的话三种改法：少立一条题签；挪镜头；改这条题签的 side。
//   2 两种只报告的画面（沙盘栏上面多了一行说明的电脑和竖着拿的平板）：结果打印出来；
//     一节里摆不下的超过一条，或者更要紧的一条给排在它后面的让了地方，才算不过。
//     题签比留出来的地方还高（或者还宽）、怎么也放不进去的，单独列出来，不算在“摆不下的”里面。
//   3 宽屏上把沙盘左右各转 40 度，一度一步，每一步都照上一步的结果接着摆：没有一条摆不下；
//     另外两种标准的画面只把数打印出来（读者自己转动以后，摆不下是许可的）。

import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import type { SceneSection, SceneStrip } from '../../src/domain/scene';
import { placeStrips } from '../../src/stage/overlay';
import type { StripInput, StripPlacement } from '../../src/stage/overlay';
import { centreShift, equivalentDistance, placeCamera, poseAt, screenAnchors } from '../../src/stage/three/rig';
import { styleFor } from '../../src/stage/three/style';
import type { StageInsets } from '../../src/stage/types';
import { realScene, realSceneKeys } from './support/realScenes';
import type { RealScene } from './support/realScenes';
import { sectionStrips } from './support/stripSizes';

interface Pane {
  name: string;
  size: { width: number; height: number };
  /** 页面上留的空：上面一排按钮（有时再加一行说明），下面的题记。在浏览器里量出来的数。 */
  insets: StageInsets;
}

const leave = (top: number, bottom: number): StageInsets => ({ top, right: 0, bottom, left: 0 });

/** 三种标准的画面：每一节的题签在这上面必须都摆得下（docs/data-spec.md）。 */
const STANDARD: Pane[] = [
  { name: '940 × 900', size: { width: 940, height: 900 }, insets: leave(62, 130) },
  { name: '584 × 768', size: { width: 584, height: 768 }, insets: leave(62, 130) },
  { name: '768 × 573', size: { width: 768, height: 573 }, insets: leave(54, 131) },
];

/** 只报告的画面。 */
const REPORTED: Pane[] = [
  { name: '940 × 900，上面多一行说明', size: { width: 940, height: 900 }, insets: leave(96, 130) },
  { name: '768 × 573，上面多一行说明', size: { width: 768, height: 573 }, insets: leave(84, 131) },
];

/** 这几个数和 placeStrips.ts 里的一样：题签离留出来的边至少 4；每一点周围半边长 6 的方块不压；那一点出了留出来的那一块 8 像素以内还算看得见。 */
const MARGIN = 4;
const DOT = 6;
const SEEN_OUTSIDE = 8;

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function overlap(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** 一条线段有没有从一块里面穿过去：沿线取很多点，看有没有落在里面的。 */
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
function freeArea(pane: Pane): Box {
  const { size, insets } = pane;
  return { left: insets.left + MARGIN, top: insets.top + MARGIN, right: size.width - insets.right - MARGIN, bottom: size.height - insets.bottom - MARGIN };
}

/** 一节的题签在一种画面上：交给 placeStrips 的那一份，和每条题签上写的字。turnDeg 是读者把沙盘转了多少度。 */
function arranged(R: RealScene, section: SceneSection, pane: Pane, turnDeg = 0): { input: StripInput; text: (id: string) => string } {
  const { scene, coords, samplers } = R;
  const style = styleFor(scene.style);
  const placed = placeCamera(section, scene, samplers, coords, style, pane.size, pane.insets);
  // 转动沙盘：对准的那一点、离多远都不变，只是朝向变了
  const pose = turnDeg === 0 ? placed.pose : poseAt({ ...section.camera, bearing: section.camera.bearing + turnDeg }, placed.pose.target, placed.distanceM);

  // 和 view.ts 的 drawFrame 一样的镜头
  const camera = new PerspectiveCamera(pose.fov, pane.size.width / pane.size.height, Math.max(60, placed.distanceM * 0.1), placed.distanceM * 3 + 30000);
  camera.position.set(...pose.position);
  camera.lookAt(...pose.target);
  const [shiftX, shiftY] = centreShift(pane.insets);
  if (shiftX || shiftY) camera.setViewOffset(pane.size.width, pane.size.height, -shiftX, -shiftY, pane.size.width, pane.size.height);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const strips = sectionStrips(scene, section.heading, pane.size.width);
  const written = strips.map((s) => scene.strips.find((x) => x.id === s.id)).filter((s): s is SceneStrip => s !== undefined);
  const D = equivalentDistance(placed.distanceM, pose.fov, pane.size.height);
  const anchors = screenAnchors(written, scene, samplers, coords, style, D, camera, pane.size);
  return { input: { strips, anchors, size: pane.size, insets: pane.insets }, text: (id) => written.find((s) => s.id === id)?.text ?? id };
}

/** 没摆出来的题签，一条一句。 */
function missing(result: StripPlacement[], text: (id: string) => string): string[] {
  return result.filter((p) => p.hidden).map((p) => (p.why === 'room' ? `“${text(p.id)}”摆不下` : `“${text(p.id)}”指的那一点不在画面里`));
}

const leftOut = (result: StripPlacement[]): StripPlacement[] => result.filter((p) => p.hidden && p.why === 'room');

/** 摆出来的题签里不该有的事，一条一句：压住了哪一点，压住了自己指的东西，引线穿过了别的题签，出了留出来的那一块。 */
function faults(input: StripInput, result: StripPlacement[], pane: Pane, text: (id: string) => string): string[] {
  const found: string[] = [];
  const free = freeArea(pane);
  const seen = input.anchors.filter(
    (a) => a.visible && a.x >= free.left - SEEN_OUTSIDE && a.x <= free.right + SEEN_OUTSIDE && a.y >= free.top - SEEN_OUTSIDE && a.y <= free.bottom + SEEN_OUTSIDE,
  );
  const shown = result.flatMap((p, i) => {
    if (p.hidden) return [];
    const { w, h } = input.strips[i];
    return [{ p, box: { left: p.x - w / 2, right: p.x + w / 2, top: p.y - h / 2, bottom: p.y + h / 2 } }];
  });
  for (const a of shown) {
    const name = `“${text(a.p.id)}”`;
    if (a.box.left < free.left || a.box.right > free.right || a.box.top < free.top || a.box.bottom > free.bottom) found.push(`${name}出了留出来的那一块`);
    for (const dot of seen) {
      if (overlap(a.box, { left: dot.x - DOT, right: dot.x + DOT, top: dot.y - DOT, bottom: dot.y + DOT })) found.push(`${name}压住了“${text(dot.id)}”指的那一点`);
    }
    const own = input.anchors.find((anchor) => anchor.id === a.p.id);
    if (own?.foot && passesThrough(own.x, own.y, own.foot.x, own.foot.y, { left: a.box.left - DOT, right: a.box.right + DOT, top: a.box.top - DOT, bottom: a.box.bottom + DOT })) {
      found.push(`${name}压住了它指的那样东西`);
    }
    for (const b of shown) {
      if (a === b) continue;
      if (a.p.id < b.p.id && overlap(a.box, b.box)) found.push(`${name}和“${text(b.p.id)}”叠在一起`);
      if (a.p.leader && passesThrough(...a.p.leader, b.box)) found.push(`${name}的引线穿过了“${text(b.p.id)}”`);
    }
  }
  return found;
}

/** 最长的一条引线多少像素。 */
function longestLeader(result: StripPlacement[]): number {
  return Math.round(Math.max(0, ...result.map((p) => (p.leader ? Math.hypot(p.leader[2] - p.leader[0], p.leader[3] - p.leader[1]) : 0))));
}

/**
 * 摆不下的那几条里，哪几条是给排在它后面的题签让了地方：把排在它后面的都拿掉再摆一遍，它要是摆得下，就是。
 * （排在后面的题签不会抢它的位置，但它们指的点是不让压的。）
 */
function gaveWayToLater(input: StripInput, result: StripPlacement[]): string[] {
  const out: string[] = [];
  result.forEach((p, i) => {
    if (!p.hidden || p.why !== 'room') return;
    const mine = input.strips[i];
    const strips = input.strips.filter((s, k) => s.rank < mine.rank || (s.rank === mine.rank && k <= i));
    const again = placeStrips({ ...input, strips, anchors: input.anchors.filter((a) => strips.some((s) => s.id === a.id)) });
    if (!again.find((q) => q.id === p.id)?.hidden) out.push(p.id);
  });
  return out;
}

/** 把沙盘从左转 40 度一度一度转到右转 40 度，每一步照上一步的结果接着摆。 */
function sweep(R: RealScene, section: SceneSection, pane: Pane): { leftOut: string[]; faults: string[]; changes: number } {
  const out: string[] = [];
  const bad: string[] = [];
  let changes = 0;
  let prev: StripPlacement[] | undefined;
  for (let turn = -40; turn <= 40; turn++) {
    const { input, text } = arranged(R, section, pane, turn);
    const now = placeStrips(input, prev);
    for (const p of leftOut(now)) out.push(`转 ${turn} 度：“${text(p.id)}”摆不下`);
    for (const fault of faults(input, now, pane, text)) bad.push(`转 ${turn} 度：${fault}`);
    if (prev) now.forEach((p, i) => (changes += !p.hidden && !prev![i].hidden && p.slot !== prev![i].slot ? 1 : 0));
    prev = now;
  }
  return { leftOut: out, faults: bad, changes };
}

describe.each(realSceneKeys())('%s 的题签', (key) => {
  describe.each(STANDARD)('标准的画面 $name', (pane) => {
    it('每一节的题签一条也不少', () => {
      const R = realScene(key);
      const problems: string[] = [];
      for (const section of R.scene.sections) {
        const { input, text } = arranged(R, section, pane);
        expect(input.strips.map((s) => s.id), `${section.heading}：题签和小节里写的对不上`).toEqual(section.strips);
        for (const problem of missing(placeStrips(input), text)) problems.push(`${section.heading}：${problem}`);
      }
      expect(problems).toEqual([]);
    });

    it('摆出来的题签不压任何一点，不压自己指的那样东西，引线不穿过别的题签', () => {
      const R = realScene(key);
      const problems: string[] = [];
      for (const section of R.scene.sections) {
        const { input, text } = arranged(R, section, pane);
        for (const fault of faults(input, placeStrips(input), pane, text)) problems.push(`${section.heading}：${fault}`);
      }
      expect(problems).toEqual([]);
    });
  });

  it('三种标准的画面上各摆下几条（打印出来）', () => {
    const R = realScene(key);
    const lines: string[] = [];
    for (const pane of STANDARD) {
      let asked = 0;
      let shown = 0;
      let longest = 0;
      let feet = 0;
      let outward = 0;
      for (const section of R.scene.sections) {
        const { input } = arranged(R, section, pane);
        const result = placeStrips(input);
        asked += input.strips.length;
        shown += result.filter((p) => !p.hidden).length;
        longest = Math.max(longest, longestLeader(result));
        feet += input.anchors.filter((a) => a.foot).length;
        outward += input.anchors.filter((a) => a.out).length;
      }
      lines.push(`${key} ${pane.name}：${asked} 条里摆下 ${shown} 条；最长的引线 ${longest} 像素；带着脚下那一点的 ${feet} 条，朝沙盘外面摆的 ${outward} 条`);
      expect(shown, pane.name).toBe(asked);
    }
    console.log(lines.join('\n'));
  });

  describe.each(REPORTED)('只报告的画面 $name', (pane) => {
    it('一节里摆不下的最多一条，而且不是给排在它后面的让了地方（结果打印出来）', () => {
      const R = realScene(key);
      const free = freeArea(pane);
      const lines: string[] = [];
      const problems: string[] = [];
      let asked = 0;
      let shown = 0;
      for (const section of R.scene.sections) {
        const { input, text } = arranged(R, section, pane);
        const result = placeStrips(input);
        asked += input.strips.length;
        shown += result.filter((p) => !p.hidden).length;
        // 比留出来的地方还高（或者还宽）的题签，这种画面上怎么也放不进去：单独列出来
        const tooBig = new Set(input.strips.filter((s) => s.w > free.right - free.left || s.h > free.bottom - free.top).map((s) => s.id));
        const out = leftOut(result);
        const noRoom = out.filter((p) => !tooBig.has(p.id));
        const unseen = result.filter((p) => p.hidden && p.why === 'unseen');
        const said = [
          `${input.strips.length} 条里摆下 ${result.filter((p) => !p.hidden).length} 条`,
          ...(noRoom.length ? [`摆不下：${noRoom.map((p) => text(p.id)).join('、')}`] : []),
          ...(out.length > noRoom.length ? [`放不进（题签比留出来的地方还大）：${out.filter((p) => tooBig.has(p.id)).map((p) => text(p.id)).join('、')}`] : []),
          ...(unseen.length ? [`那一点不在画面里：${unseen.map((p) => text(p.id)).join('、')}`] : []),
          `最长的引线 ${longestLeader(result)} 像素`,
        ];
        lines.push(`${key} ${pane.name} ${section.heading}：${said.join('；')}`);
        if (noRoom.length > 1) problems.push(`${section.heading}：有 ${noRoom.length} 条摆不下（${noRoom.map((p) => text(p.id)).join('、')}）`);
        for (const id of gaveWayToLater(input, result)) problems.push(`${section.heading}：“${text(id)}”摆不下，是给排在它后面的题签让了地方`);
      }
      lines.push(`${key} ${pane.name}：共 ${asked} 条，摆下 ${shown} 条`);
      console.log(lines.join('\n'));
      expect(problems).toEqual([]);
    });
  });

  it('940 × 900：把沙盘左右各转 40 度，一度一步，没有一条摆不下，也不压点、不压自己指的东西', () => {
    const R = realScene(key);
    const pane = STANDARD[0];
    const problems: string[] = [];
    const lines: string[] = [];
    for (const section of R.scene.sections) {
      const turned = sweep(R, section, pane);
      for (const problem of [...turned.leftOut, ...turned.faults]) problems.push(`${section.heading}：${problem}`);
      lines.push(`${key} ${pane.name} ${section.heading}：转 ±40 度，81 步里换了 ${turned.changes} 次位置`);
    }
    console.log(lines.join('\n'));
    expect(problems).toEqual([]);
  });

  it('另外两种标准的画面：转 ±40 度时有几步摆不下（只打印；转动以后摆不下是许可的），不压点、不压自己指的东西', () => {
    const R = realScene(key);
    const problems: string[] = [];
    const lines: string[] = [];
    for (const pane of STANDARD.slice(1)) {
      for (const section of R.scene.sections) {
        const turned = sweep(R, section, pane);
        for (const fault of turned.faults) problems.push(`${pane.name} ${section.heading}：${fault}`);
        lines.push(`${key} ${pane.name} ${section.heading}：转 ±40 度，81 步里换了 ${turned.changes} 次位置，摆不下 ${turned.leftOut.length} 条次`);
      }
    }
    console.log(lines.join('\n'));
    expect(problems).toEqual([]);
  });

  it('940 × 900 和 768 × 573：手按着从左 40 度转到右 40 度，题签一条也不换位置；每转 10 度放一次手，放手以后都摆得出来', () => {
    const R = realScene(key);
    const problems: string[] = [];
    for (const pane of [STANDARD[0], STANDARD[2]]) {
      for (const section of R.scene.sections) {
        let prev = placeStrips(arranged(R, section, pane, -40).input);
        for (let turn = -39; turn <= 40; turn++) {
          const { input, text } = arranged(R, section, pane, turn);
          const held = placeStrips(input, prev, { moving: true });
          held.forEach((p, i) => {
            if (prev[i].slot !== undefined && p.slot !== prev[i].slot) problems.push(`${pane.name} ${section.heading} 转 ${turn} 度：手还按着，“${text(p.id)}”换了位置`);
          });
          for (const fault of faults(input, held, pane, text)) problems.push(`${pane.name} ${section.heading} 转 ${turn} 度（手按着）：${fault}`);
          prev = held;
          if (turn % 10 !== 0) continue;
          // 放手：整个重摆。照这个朝向从头摆时摆得下几条，放手以后至少也摆得下几条
          const released = placeStrips(input, held);
          const fresh = placeStrips(input);
          if (leftOut(released).length > leftOut(fresh).length) problems.push(`${pane.name} ${section.heading} 转 ${turn} 度：放手以后比从头摆少摆了题签`);
          for (const fault of faults(input, released, pane, text)) problems.push(`${pane.name} ${section.heading} 转 ${turn} 度（放手以后）：${fault}`);
          prev = released;
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

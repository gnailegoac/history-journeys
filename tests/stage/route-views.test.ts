// 全程沙盘的验收：每一小节的镜头、题签、说明，照真的场景文件和算出来的地面查。在 Node 里跑，不要浏览器。
// 查法和站点沙盘的三组（scene-cameras、scene-strips、scene-notes）是同一套：镜头用 src/stage/three/rig.ts 的 placeCamera 摆，
// 题签指着的点用 screenAnchors 算，摆法是 src/stage/overlay/placeStrips.ts，题签多大照 ./support/stripSizes.ts，
// 画面是 ./support/standardPanes.ts 的四种标准的沙盘栏。全程沙盘另有三条自己的规矩（docs/data-spec.md“题签摆在哪”）：
//   引线不超过 48 像素（一条题签离它指的那一点太远，孩子会把名字读到别处去）；当时的名字、今天的名字两种都查；
//   沙盘栏上面多一行说明的三种画面上，题签也一条不能少（最长的引线只打印，不设上限）。
// 沙盘旁边那几句话的生成（src/domain/sceneText.ts）还没有接上全程沙盘，所以“说明”这一组现在照数据查：
// 写了 note 的东西，要有哪一节的 explain 点到它，不然读者永远看不到这句话。接上以后改成查印出来的字。

import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import type { NamesMode, RouteSection, SceneStrip } from '../../src/domain/scene';
import { placeStrips } from '../../src/stage/overlay';
import type { StripInput, StripPlacement } from '../../src/stage/overlay';
import type { Vec3 } from '../../src/stage/ground/types';
import { centreShift, equivalentDistance, framePoints, placeCamera, project, screenAnchors, wholeTable } from '../../src/stage/three/rig';
import { styleFor } from '../../src/stage/three/style';
import type { StageInsets } from '../../src/stage/types';
import { realRouteScene, realSceneKeys } from './support/realScenes';
import type { RealRouteScene } from './support/realScenes';
import { STANDARD_PANES } from './support/standardPanes';
import { routeSectionStrips } from './support/stripSizes';

interface Pane {
  name: string;
  size: { width: number; height: number };
  insets: StageInsets;
}

const leave = (top: number, bottom: number): StageInsets => ({ top, right: 0, bottom, left: 0 });
const NO_INSETS: StageInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** 四种标准的沙盘栏，四边留的是在浏览器里量出来的空。 */
const STANDARD: Pane[] = STANDARD_PANES.map(({ name, size, insets }) => ({ name, size, insets }));
/** 沙盘栏上面多一行说明的三种（只有图片的那一档就是这样；数和 scene-strips.test.ts 里的一样）。 */
const WITH_NOTICE: Pane[] = [
  { name: '940 × 900，上面多一行说明', size: { width: 940, height: 900 }, insets: leave(96, 130) },
  { name: '768 × 573，上面多一行说明', size: { width: 768, height: 573 }, insets: leave(84, 131) },
  { name: '1024 × 765，上面多一行说明', size: { width: 1024, height: 765 }, insets: leave(84, 131) },
];
/** 定稿样张的画面：照它定的镜头，在它上面程序不该再挪。 */
const TRIAL_PANE: Pane = { name: '880 × 900', size: { width: 880, height: 900 }, insets: NO_INSETS };

/** 全程沙盘上一条引线最长多少像素。 */
const ROUTE_LEADER_MAX_PX = 48;
/** 镜头最近多少米（沙盘里的米）：再近，先画好的地面一个点就有两个像素以上了。 */
const ROUTE_DISTANCE_MIN = 15_000;
const NAMES: NamesMode[] = ['ancient', 'modern'];

/** 这几个数和 placeStrips.ts 里的一样。 */
const MARGIN = 4;
const DOT = 6;
const SEEN_OUTSIDE = 8;

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
const overlap = (a: Box, b: Box): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
function passesThrough(x1: number, y1: number, x2: number, y2: number, b: Box): boolean {
  const steps = Math.max(8, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 4));
  for (let i = 0; i <= steps; i++) {
    const x = x1 + ((x2 - x1) * i) / steps;
    const y = y1 + ((y2 - y1) * i) / steps;
    if (x > b.left + 0.01 && x < b.right - 0.01 && y > b.top + 0.01 && y < b.bottom - 0.01) return true;
  }
  return false;
}
const freeArea = ({ size, insets }: Pane): Box => ({ left: insets.left + MARGIN, top: insets.top + MARGIN, right: size.width - insets.right - MARGIN, bottom: size.height - insets.bottom - MARGIN });

/** 一节的镜头在一种画面上摆好：镜头、离多远是写的距离的几倍、要看得见的点、把沙盘里的一点投到画面上。 */
function placed(R: RealRouteScene, section: RouteSection, pane: Pane) {
  const { scene, coords, samplers } = R;
  const style = styleFor(scene.style);
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
  return { view, written, anchors, at: (point: Vec3) => project(point, camera, pane.size) };
}

/** 一节的题签在一种画面上：交给 placeStrips 的那一份。 */
function arranged(R: RealRouteScene, section: RouteSection, pane: Pane, names: NamesMode): { input: StripInput; text: (id: string) => string } {
  const { written, anchors } = placed(R, section, pane);
  const strips = routeSectionStrips(R.scene, section.heading, pane.size.width, names);
  const text = (id: string): string => {
    const strip = written.find((s) => s.id === id);
    return strip ? (names === 'modern' && strip.modern ? strip.modern : strip.text) : id;
  };
  return { input: { strips, anchors, size: pane.size, insets: pane.insets }, text };
}

const inside = (p: { x: number; y: number; visible?: boolean }, { size, insets }: Pane): boolean =>
  p.visible !== false && p.x >= insets.left && p.x <= size.width - insets.right && p.y >= insets.top && p.y <= size.height - insets.bottom;

const leaderPx = (p: StripPlacement): number => (p.leader ? Math.hypot(p.leader[2] - p.leader[0], p.leader[3] - p.leader[1]) : 0);

/** 摆出来的题签里不该有的事（和 scene-strips.test.ts 查的是同样几件）。 */
function faults(input: StripInput, result: StripPlacement[], pane: Pane, text: (id: string) => string): string[] {
  const found: string[] = [];
  const free = freeArea(pane);
  const seen = input.anchors.filter((a) => a.visible && a.x >= free.left - SEEN_OUTSIDE && a.x <= free.right + SEEN_OUTSIDE && a.y >= free.top - SEEN_OUTSIDE && a.y <= free.bottom + SEEN_OUTSIDE);
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
    for (const b of shown) {
      if (a === b) continue;
      if (a.p.id < b.p.id && overlap(a.box, b.box)) found.push(`${name}和“${text(b.p.id)}”叠在一起`);
      if (a.p.leader && passesThrough(...a.p.leader, b.box)) found.push(`${name}的引线穿过了“${text(b.p.id)}”`);
    }
  }
  return found;
}

describe.each(realSceneKeys('route'))('%s 的镜头', (key) => {
  it('每一节：朝北、不转；不比 15000 米近（看整块沙盘的一节除外，它由 closest 管）；视角是 18 度', () => {
    const R = realRouteScene(key);
    for (const section of R.scene.sections) {
      expect(section.camera.bearing, section.heading).toBe(0);
      expect(section.camera.fov, section.heading).toBe(18);
      if (!wholeTable(section)) {
        expect(section.camera.distanceM, section.heading).toBeGreaterThanOrEqual(ROUTE_DISTANCE_MIN);
        expect(section.camera.closest, `${section.heading}：看路的小节不写 closest`).toBeUndefined();
      }
    }
  });

  describe.each(STANDARD)('画面 $name', (pane) => {
    it('每条题签指着的那一点、mustShow 里的每个点，都在画面留出来的那一块里（镜头退到头的不算）', () => {
      const R = realRouteScene(key);
      const outside: string[] = [];
      for (const section of R.scene.sections) {
        const { view, written, anchors, at } = placed(R, section, pane);
        anchors.forEach((anchor, i) => {
          if (!inside(anchor, pane)) outside.push(`${section.heading}：“${written[i].text}”落在 (${anchor.x.toFixed(0)}, ${anchor.y.toFixed(0)})，镜头是写的距离的 ${view.fit.toFixed(2)} 倍`);
        });
        if (view.fit >= 2.49) continue;
        view.points.forEach((point, i) => {
          const p = at(point);
          if (!inside(p, pane)) outside.push(`${section.heading}：第 ${i + 1} 个要看的点落在 (${p.x.toFixed(0)}, ${p.y.toFixed(0)})`);
        });
      }
      expect(outside).toEqual([]);
    });

    it('看路的小节：到这一站的每一趟路，路上写的每个点都在画面留出来的那一块里（点是从场景里另算的，不是镜头自己报的）', () => {
      const R = realRouteScene(key);
      const outside: string[] = [];
      let checked = 0;
      for (const section of R.scene.sections.slice(1)) {
        const { view, at } = placed(R, section, pane);
        if (view.fit >= 2.49) continue;
        for (const journey of R.scene.roads.journeys.filter((item) => item.stop === section.stop)) {
          for (const part of journey.parts) {
            for (const written of part.ways) {
              const way = R.scene.roads.ways.find((item) => item.id === (written.startsWith('-') ? written.slice(1) : written));
              for (const p of way?.line ?? []) {
                const [x, z] = R.coords.toLocal(p);
                const on = at([x, R.coords.y(Math.max(0, R.samplers.height(x, z))), z]);
                checked++;
                if (!inside(on, pane)) outside.push(`${section.heading}：${journey.id} 的 ${way?.id} 上 [${p[0]}, ${p[1]}] 落在 (${on.x.toFixed(0)}, ${on.y.toFixed(0)})`);
              }
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(200);
      expect(outside).toEqual([]);
    });

    it('看整块沙盘的一节，沙盘（连座子）上下的空一样、左右的空一样', () => {
      const R = realRouteScene(key);
      const off: string[] = [];
      for (const section of R.scene.sections) {
        if (!wholeTable(section)) continue;
        const { at } = placed(R, section, pane);
        const corners = framePoints(R.coords).map((p) => at(p));
        const { size, insets } = pane;
        const left = Math.min(...corners.map((p) => p.x)) - insets.left;
        const right = size.width - insets.right - Math.max(...corners.map((p) => p.x));
        const top = Math.min(...corners.map((p) => p.y)) - insets.top;
        const bottom = size.height - insets.bottom - Math.max(...corners.map((p) => p.y));
        if (Math.abs(top - bottom) > 2 || Math.abs(left - right) > 2 || Math.min(left, right, top, bottom) < 8) off.push(`${section.heading}：上 ${top.toFixed(0)}、下 ${bottom.toFixed(0)}、左 ${left.toFixed(0)}、右 ${right.toFixed(0)}`);
      }
      expect(off).toEqual([]);
    });
  });

  it('画面很窄的时候（420 × 800，不是标准的沙盘栏）：镜头照着路退远，路上写的每个点还都在画面里', () => {
    // 标准的沙盘栏上，每一节写的距离本来就装得下整条路，镜头用不着退；这里用一块窄得多的画面，看“mustShow 里写的那几趟路”真的在管事
    const R = realRouteScene(key);
    const narrow: Pane = { name: '420 × 800', size: { width: 420, height: 800 }, insets: leave(62, 130) };
    const outside: string[] = [];
    let retreated = 0;
    for (const section of R.scene.sections.slice(1)) {
      const { view, at } = placed(R, section, narrow);
      if (view.fit > 1.05) retreated++;
      if (view.fit >= 2.49) continue;
      for (const journey of R.scene.roads.journeys.filter((item) => item.stop === section.stop)) {
        for (const written of journey.parts.flatMap((part) => part.ways)) {
          const way = R.scene.roads.ways.find((item) => item.id === (written.startsWith('-') ? written.slice(1) : written));
          for (const p of way?.line ?? []) {
            const [x, z] = R.coords.toLocal(p);
            const on = at([x, R.coords.y(Math.max(0, R.samplers.height(x, z))), z]);
            if (!inside(on, narrow)) outside.push(`${section.heading}：${way?.id} 上 [${p[0]}, ${p[1]}] 落在 (${on.x.toFixed(0)}, ${on.y.toFixed(0)})，镜头是写的距离的 ${view.fit.toFixed(2)} 倍`);
          }
        }
      }
    }
    expect(retreated).toBeGreaterThan(0);
    expect(outside).toEqual([]);
  });

  it('把每一节在四种标准的沙盘栏和样张的画面上摆好的数印出来：写的距离的几倍 / 镜头离多少米', () => {
    const R = realRouteScene(key);
    const lines: string[] = [`${key} 每一节的镜头（写的距离的几倍 / 镜头离多少米）：`];
    for (const section of R.scene.sections) {
      const cells = [TRIAL_PANE, ...STANDARD].map((pane) => {
        const { view } = placed(R, section, pane);
        return `${pane.name} ${view.fit.toFixed(2)} / ${view.distanceM.toFixed(0)}`;
      });
      lines.push(`  ${section.heading}（写的 ${section.camera.distanceM}）：${cells.join('；')}`);
    }
    console.log(lines.join('\n'));
    expect(lines.length).toBe(R.scene.sections.length + 1);
  });
});

describe.each(realSceneKeys('route'))('%s 的题签', (key) => {
  describe.each(STANDARD)('标准的画面 $name', (pane) => {
    it.each(NAMES)('%s：每一节的题签一条也不少，不压点、不相叠、引线不穿过别的题签', (names) => {
      const R = realRouteScene(key);
      const problems: string[] = [];
      for (const section of R.scene.sections) {
        const { input, text } = arranged(R, section, pane, names);
        expect(input.strips.map((s) => s.id), section.heading).toEqual(section.strips);
        const result = placeStrips(input);
        for (const p of result) if (p.hidden) problems.push(`${section.heading}：“${text(p.id)}”${p.why === 'room' ? '摆不下' : '指的那一点不在画面里'}`);
        for (const fault of faults(input, result, pane, text)) problems.push(`${section.heading}：${fault}`);
      }
      expect(problems).toEqual([]);
    });

    it.each(NAMES)(`%s：没有一条引线超过 ${ROUTE_LEADER_MAX_PX} 像素`, (names) => {
      const R = realRouteScene(key);
      const long: string[] = [];
      for (const section of R.scene.sections) {
        const { input, text } = arranged(R, section, pane, names);
        for (const p of placeStrips(input)) {
          if (!p.hidden && leaderPx(p) > ROUTE_LEADER_MAX_PX) long.push(`${section.heading}：“${text(p.id)}”的引线 ${leaderPx(p).toFixed(0)} 像素`);
        }
      }
      expect(long).toEqual([]);
    });
  });

  it('四种标准的画面上各摆下几条、最长的引线多少像素（打印出来）', () => {
    const R = realRouteScene(key);
    const lines: string[] = [];
    for (const pane of STANDARD) {
      for (const names of NAMES) {
        let asked = 0;
        let shown = 0;
        const longest: string[] = [];
        for (const section of R.scene.sections) {
          const { input, text } = arranged(R, section, pane, names);
          const result = placeStrips(input);
          asked += input.strips.length;
          shown += result.filter((p) => !p.hidden).length;
          const worst = result.reduce((best, p) => (leaderPx(p) > leaderPx(best) ? p : best), result[0]);
          longest.push(`${section.heading} ${leaderPx(worst).toFixed(0)}（${text(worst.id)}）`);
        }
        lines.push(`${key} ${pane.name} ${names === 'ancient' ? '当时的名字' : '今天的名字'}：${asked} 条里摆下 ${shown} 条；各节最长的引线：${longest.join('，')}`);
      }
    }
    console.log(lines.join('\n'));
    expect(lines.length).toBe(STANDARD.length * NAMES.length);
  });

  describe.each(WITH_NOTICE)('上面多一行说明的画面 $name', (pane) => {
    it.each(NAMES)('%s：每一节的题签一条也不少（最长的引线打印出来，不设上限）', (names) => {
      const R = realRouteScene(key);
      const problems: string[] = [];
      const lines: string[] = [];
      for (const section of R.scene.sections) {
        const { input, text } = arranged(R, section, pane, names);
        const result = placeStrips(input);
        for (const p of result) if (p.hidden) problems.push(`${section.heading}：“${text(p.id)}”${p.why === 'room' ? '摆不下' : '指的那一点不在画面里'}`);
        const worst = result.reduce((best, p) => (leaderPx(p) > leaderPx(best) ? p : best), result[0]);
        lines.push(`${section.heading} ${leaderPx(worst).toFixed(0)}（${text(worst.id)}）`);
      }
      console.log(`${key} ${pane.name} ${names === 'ancient' ? '当时的名字' : '今天的名字'}：各节最长的引线 ${lines.join('，')}`);
      expect(problems).toEqual([]);
    });
  });
});

describe.each(realSceneKeys('route'))('%s 的说明', (key) => {
  /** 场景里带 note 的东西：explain 里怎么指它，叫什么。一趟路的 note 写在它的各截上，explain 点的是这一趟。 */
  function noted(R: RealRouteScene): { id: string; name: string }[] {
    const { terrain, water } = R.scene;
    const all: { id: string; name: string; note?: string }[] = [
      { id: 'terrain', name: '地形', note: terrain.note },
      ...terrain.edits,
      { id: 'levels', name: '海面', note: water.levels.note },
      { id: 'coast', name: water.coast.name, note: water.coast.note },
      ...water.rivers,
      ...water.lakes,
      ...water.lakes.flatMap((lake) => (lake.except ? [lake.except] : [])),
      ...water.washes,
      ...R.scene.places,
      ...R.scene.far,
      ...R.scene.roads.journeys.map((journey) => ({ id: journey.id, name: journey.name, note: journey.parts.map((part) => part.note?.trim() ?? '').join('') })),
    ];
    return all.filter((item) => item.note?.trim()).map(({ id, name }) => ({ id, name }));
  }

  it('写了的每一句说明，至少有一节的 explain 点到它（地形的整理不用点，每一节都印）', () => {
    const R = realRouteScene(key);
    const explained = new Set(R.scene.sections.flatMap((section) => section.explain));
    const lost = noted(R)
      .filter((item) => !explained.has(item.id))
      .map((item) => `${item.name}（${item.id}）`);
    expect(lost, '这几样写了说明，却没有哪一节的 explain 点到它们').toEqual([]);
    expect(R.scene.terrain.recipe.note?.trim()).toBeTruthy();
  });

  it('每一节看路的小节，explain 里有到这一站的每一趟路；头一节讲的是黄河、大江、海岸、湖和路这五样', () => {
    const R = realRouteScene(key);
    for (const section of R.scene.sections.slice(1)) {
      const journeys = R.scene.roads.journeys.filter((journey) => journey.stop === section.stop).map((journey) => journey.id);
      expect(journeys.length, section.heading).toBeGreaterThan(0);
      for (const id of journeys) expect(section.explain, `${section.heading} 的 explain 里没有 ${id}`).toContain(id);
      // mustShow 里也有这几趟路：镜头照着路摆
      for (const id of journeys) expect(section.camera.mustShow ?? [], `${section.heading} 的 mustShow 里没有 ${id}`).toContain(id);
    }
    expect(R.scene.sections[0].explain).toHaveLength(5);
  });

  it('题记：最多 40 个字；提到的站名、水名、山名，这一节都立着题签', () => {
    const R = realRouteScene(key);
    const names = [...new Set(R.scene.strips.map((strip) => strip.text))];
    const missing: string[] = [];
    for (const section of R.scene.sections) {
      expect([...section.line].length, section.heading).toBeLessThanOrEqual(40);
      const shown = new Set(section.strips.map((id) => R.scene.strips.find((strip) => strip.id === id)?.text));
      for (const name of names) {
        // “海”是一个字，题记里的“海边”“过海”不一定是说那条题签：只有站名和两个字以上的名字才这样查
        if ([...name].length < 2) continue;
        if (section.line.includes(name) && !shown.has(name)) missing.push(`${section.heading}：题记里说到“${name}”，这一节却没有它的题签`);
      }
    }
    expect(missing).toEqual([]);
  });
});

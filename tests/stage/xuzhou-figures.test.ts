// 场景验收（徐州）：每一节要看的那几样东西，在画面上够不够大。
// 在 Node 里跑：地面是真的，镜头用 src/stage/three/rig.ts 的 placeCamera 摆（页面上的沙盘用的也是它），
// 放大几倍用 src/stage/three/kit/figure.ts 照样式里的表算。不造模型，不要浏览器。
// 运行：npx vitest run tests/stage/xuzhou-figures.test.ts（要看印出来的表，后面加 --silent=false）
//
// 怎么量：一样东西在画面上多宽 = 它近看的模型多宽（米）× 它那里一米是多少像素 × 它这一类在这个远近放大几倍。
//   模型多宽是照零件库里的尺寸写在下面表里的（屋顶的宽、船身的长）；一米多少像素按摆好的镜头算；
//   远近是折算过的远近 D：竖着拿的平板上沙盘栏矮，D 就大，放大得也多。
// 两种画面：电脑上的沙盘栏 940 × 900（上面留 62、下面留 130），竖着拿的平板上的 768 × 573（上面留 54、下面留 131）。
// 手机不在标准的画面里（负责人定的），不查。
//
// 这张表拦的是：有人改了样式里的表、或者改了镜头，要看的东西又小回几个像素。
// 它量的是算出来的大小，不是画出来的样子；看不看得清，要看图片。

import { describe, expect, it } from 'vitest';
import type { SceneDressing, SceneSection, SceneThing } from '../../src/domain/scene';
import { dressingParams } from '../../src/domain/sceneParams';
import { existsAt } from '../../src/domain/sceneText';
import type { Vec3 } from '../../src/stage/ground/types';
import type { FigureClass } from '../../src/stage/three/internal';
import { detailGone, equivalentDistance, figureGroups, figureNow, liftClass } from '../../src/stage/three/kit/figure';
import { placeCamera } from '../../src/stage/three/rig';
import { styleFor } from '../../src/stage/three/style';
import type { StageInsets } from '../../src/stage/types';
import { realScene } from './support/realScenes';

interface Pane {
  name: string;
  size: { width: number; height: number };
  insets: StageInsets;
}

/** 两种画面，和页面上真的留的空（在浏览器里量过的数）。 */
const WIDE: Pane = { name: '电脑 940 × 900', size: { width: 940, height: 900 }, insets: { top: 62, right: 0, bottom: 130, left: 0 } };
const UPRIGHT: Pane = { name: '竖着拿的平板 768 × 573', size: { width: 768, height: 573 }, insets: { top: 54, right: 0, bottom: 131, left: 0 } };

/** 城墙顶比城里的地面高多少米；城门的城台顶比城里的地面高多少米（零件库 kit/site.ts 里的数：62，再加 8）。 */
const WALL_TOP_M = 62;
const GATE_TOP_M = 70;

interface Subject {
  /** 印出来的名字。 */
  name: string;
  /** 哪一小节。 */
  section: string;
  /** 摆件或点缀的 id：量的是它那一点（点缀沿一条线的，量线的头一点）。 */
  id: string;
  /** 它的大小跟着哪一类变。 */
  cls: FigureClass;
  /** times：一样东西，乘放大的倍数。spread：一片东西占多宽，乘摊开的倍数。 */
  by: 'times' | 'spread';
  /** 近看的模型多宽（米）。 */
  widthM: number;
  /** 那一点比脚下的地面高多少米；'water' 是浮在这一节的水面上。 */
  up: number | 'water';
  /** 至少多少像素：[电脑, 竖着拿的平板]。 */
  atLeast: [number, number];
}

// ======================================================================================================
// 对着图片看的人要重读的，就是这张表里的 atLeast。
// 电脑那一栏是对着图片读的（2026-11-19，最后一轮调完以后拍的 tests/shots/b-look-final/，1440 × 900）：
//   在放大的图上量每样东西画出来多宽，和这里算出来的数对过（差不到两个像素），取量到的数的九成。
//   量到的（像素）：草屋正面的顶 19 到 20，系着的船 15，放鹤亭的顶 24，一块石头 10 上下，那一片乱石 84，小船 19 到 20，“要走了”的黄楼 43。
//   草屋这一轮改成了山墙朝正面的样子，小了一圈（看图的人说原来的和城楼一般大）：量的是正面的顶宽 29 米，不是原来的 37 米。
//   棚子顺着城墙摆，镜头正好顺着墙看过去，它的长（顶长 34 米）在画面上是纵深，量不出来：画面上它宽 10、高 17 像素，这一行用算出来的数。
//   棚子最多放大到 2.6 倍（再大就比它站的墙顶宽）。
// 竖着拿的平板那一栏也是对着图片读的（2026-11-19，沙盘栏加高到屏幕的 56% 以后拍的 tests/shots/b-tab-final/，768 × 1024；沙盘栏 768 × 573）：
//   量到的（像素）：草屋正面的顶 18，系着的船 14，放鹤亭的顶 24，一块石头 9 上下，那一片乱石 55，小船 12 到 13，
//   “要走了”的黄楼 31，“水退以后”的黄楼上层的顶 163。和算出来的数差不到两个像素；取量到的和算出来的里面小的那个的九成。
//   棚子在平板上五六像素宽、十像素高（题签的那个点悬在它上面，不压着它了）；和电脑上一样，它的长在画面上是纵深，这一行用算出来的数。
// 每一行后面注的是算出来的数（电脑 / 竖着拿的平板）。
// 手机原来是第二栏，负责人定了以后的客户端不考虑手机，换成了竖着拿的平板。
// 船和石头不为了放大去掉几条、几块（依据里说了数目和分组），所以在平板上也小；它们的下限也按图片定，不照别的东西的标准。
// 改这些数要有图片作依据，不要为了让测试通过去改。
// ======================================================================================================
const SUBJECTS: Subject[] = [
  // 住在城墙上
  { name: '城墙上的棚子', section: '住在城墙上', id: 'shed', cls: 'shed', by: 'times', widthM: 34, up: WALL_TOP_M, atLeast: [20.1, 12.9] }, // 22.3 / 14.3
  { name: '张山人的草屋', section: '住在城墙上', id: 'old-hut', cls: 'hut', by: 'times', widthM: 29, up: 0, atLeast: [17.5, 16.2] }, // 19.8 / 19.3
  { name: '系在城下的船', section: '住在城墙上', id: 'boats-flood', cls: 'boat', by: 'times', widthM: 58, up: 'water', atLeast: [13.6, 12.0] }, // 15.2 / 13.3
  // 云龙山和百步洪
  { name: '放鹤亭', section: '云龙山和百步洪', id: 'fangheting', cls: 'pavilion', by: 'times', widthM: 42, up: 0, atLeast: [20.2, 20.1] }, // 22.5 / 22.3
  { name: '百步洪的乱石（一块）', section: '云龙山和百步洪', id: 'rocks-rapids', cls: 'rock', by: 'times', widthM: 35, up: 0, atLeast: [8.2, 7.2] }, // 9.2 / 8.0
  { name: '百步洪的乱石（一片）', section: '云龙山和百步洪', id: 'rocks-rapids', cls: 'rock', by: 'spread', widthM: 340, up: 0, atLeast: [73.3, 46.7] }, // 81.5 / 51.9
  { name: '百步洪的小船', section: '云龙山和百步洪', id: 'boats-rapids', cls: 'smallBoat', by: 'times', widthM: 35, up: 0, atLeast: [17.4, 10.8] }, // 19.8 / 12.9
  // 黄楼：远看的一节，和它自己那一节
  { name: '黄楼', section: '要走了', id: 'huanglou', cls: 'tower', by: 'times', widthM: 140, up: GATE_TOP_M, atLeast: [38.2, 27.5] }, // 42.5 / 30.6
  { name: '黄楼', section: '水退以后', id: 'huanglou', cls: 'tower', by: 'times', widthM: 140, up: GATE_TOP_M, atLeast: [257.4, 146.7] }, // 286 / 165
];

const R = realScene('su-shi/xuzhou');
const style = styleFor(R.scene.style);

function sectionOf(heading: string): SceneSection {
  const section = R.scene.sections.find((s) => s.heading === heading);
  if (!section) throw new Error(`徐州没有“${heading}”这一小节`);
  return section;
}

/** 表里的一样东西在场景里是哪一样摆件，或者哪一条点缀。 */
function itemOf(subject: Subject): { thing?: SceneThing; rule?: SceneDressing } {
  return { thing: R.scene.things.find((t) => t.id === subject.id), rule: R.scene.dressing.find((d) => d.id === subject.id) };
}

/** 点缀的大小跟着哪一类变。零件库按种类定：货船、小船、石头；这里照同一条规矩从场景里读。别的点缀不在这张表里。 */
function dressingClass(rule: SceneDressing): FigureClass | null {
  if (rule.kind === 'boats') return dressingParams('boats', rule.params).type === 'small' ? 'smallBoat' : 'boat';
  if (rule.kind === 'rocks') return 'rock';
  return null;
}

/** 这样东西的那一点在沙盘里的哪里。 */
function pointOf(subject: Subject, section: SceneSection): Vec3 {
  const { scene, coords, samplers } = R;
  const { thing, rule } = itemOf(subject);
  const at = (thing ?? rule)?.at ?? (thing ?? rule)?.line?.[0];
  if (!at) throw new Error(`${subject.id} 找不到，或者没有写在哪`);
  const [x, z] = coords.toLocal(at);
  if (subject.up === 'water') return [x, coords.y(scene.water.levels.values[section.water]), z];
  // 地面的高乘过山高夸大的倍数，墙和楼的高没有乘：直接加
  return [x, coords.y(samplers.height(x, z)) + subject.up, z];
}

/** 一节的镜头在这种画面上摆好以后：折算过的远近，镜头是写的距离的几倍，沙盘里的一点那里一米是多少像素。 */
function lookAt(section: SceneSection, pane: Pane): { D: number; fit: number; pxPerMetre: (p: Vec3) => number } {
  const { scene, coords, samplers } = R;
  const placed = placeCamera(section, scene, samplers, coords, style, pane.size, pane.insets);
  const { position, target, fov } = placed.pose;
  const focal = pane.size.height / 2 / Math.tan((fov * Math.PI) / 360);
  const forward: Vec3 = [target[0] - position[0], target[1] - position[1], target[2] - position[2]];
  const length = Math.hypot(forward[0], forward[1], forward[2]);
  return {
    D: equivalentDistance(placed.distanceM, fov, pane.size.height),
    fit: placed.fit,
    // 顺着镜头看过去的方向，这一点离镜头多远
    pxPerMetre: (p) => focal / (((p[0] - position[0]) * forward[0] + (p[1] - position[1]) * forward[1] + (p[2] - position[2]) * forward[2]) / length),
  };
}

/** 一样东西在一种画面上：不放大时多少像素，放大以后多少像素，放大了几倍。 */
function measure(subject: Subject, pane: Pane): { plain: number; now: number; times: number; D: number } {
  const section = sectionOf(subject.section);
  const look = lookAt(section, pane);
  const plain = subject.widthM * look.pxPerMetre(pointOf(subject, section));
  const times = figureNow(style.figure.rules[subject.cls], look.D)[subject.by];
  return { plain, now: plain * times, times, D: look.D };
}

describe('徐州：每一节要看的东西在画面上够不够大', () => {
  it('表里的每样东西，场景里有，在它那一小节里也有', () => {
    for (const subject of SUBJECTS) {
      const { thing, rule } = itemOf(subject);
      const item = thing ?? rule;
      expect(item, `${subject.id} 场景里没有`).toBeDefined();
      expect(existsAt(item?.when, subject.section, R.headings), `${subject.section}：${subject.id}`).toBe(true);
    }
  });

  it('表里写的类，就是这样东西的大小真的跟着变的那一类', () => {
    const { scene } = R;
    const groups = figureGroups(scene, style);
    for (const subject of SUBJECTS) {
      const { thing, rule } = itemOf(subject);
      // 跟着一座小建筑整组放大的用那一组的类；别的摆件照 liftClass；点缀按种类
      const group = groups.find((g) => g.members.includes(subject.id));
      const real = group?.cls ?? (thing ? liftClass(thing, scene) : rule ? dressingClass(rule) : null);
      expect(subject.cls, `“${subject.section}”里的${subject.name}`).toBe(real);
    }
  });

  it.each([
    { pane: WIDE, column: 0 },
    { pane: UPRIGHT, column: 1 },
  ] as const)('$pane.name：每样东西都不小于表里写的像素', ({ pane, column }) => {
    const small: string[] = [];
    for (const subject of SUBJECTS) {
      const { now, times, D } = measure(subject, pane);
      const atLeast = subject.atLeast[column];
      if (!(now >= atLeast)) small.push(`“${subject.section}”里的${subject.name}：${now.toFixed(1)} 像素，至少要 ${atLeast}（D ${Math.round(D)}，${subject.cls} 是 ${times.toFixed(2)} 倍）`);
    }
    expect(small).toEqual([]);
  });

  it('放大以后不比不放大小', () => {
    for (const subject of SUBJECTS) {
      for (const pane of [WIDE, UPRIGHT]) {
        const { plain, now } = measure(subject, pane);
        expect(now, `“${subject.section}”里的${subject.name}，${pane.name}`).toBeGreaterThanOrEqual(plain);
      }
    }
  });

  it('把量出来的数印出来：每样东西不放大多宽、放大以后多宽；每一节折算过的远近、细处收掉几成', () => {
    const px = (n: number): string => (n >= 100 ? n.toFixed(0) : n.toFixed(1));
    const lines = ['徐州：要看的东西在画面上多宽（像素）。不放大 → 放大以后（几倍；至少要多少）', `  ${'东西'.padEnd(11, '　')}${'小节'.padEnd(8, '　')}${WIDE.name.padEnd(36)}${UPRIGHT.name}`];
    for (const subject of SUBJECTS) {
      const cells = [WIDE, UPRIGHT].map((pane, column) => {
        const { plain, now, times } = measure(subject, pane);
        return `${px(plain)} → ${px(now)}（${times.toFixed(2)} 倍；至少 ${subject.atLeast[column]}）`;
      });
      lines.push(`  ${subject.name.padEnd(11, '　')}${subject.section.padEnd(8, '　')}${cells[0].padEnd(36)}${cells[1]}`);
    }
    lines.push('每一小节：折算过的远近 D（镜头是场景里写的距离的几倍），细处收掉几成');
    for (const section of R.scene.sections) {
      const cells = [WIDE, UPRIGHT].map((pane) => {
        const look = lookAt(section, pane);
        return `D ${String(Math.round(look.D)).padStart(6)}（${look.fit.toFixed(2)} 倍），细处收掉 ${Math.round(detailGone(style, look.D) * 100)}%`;
      });
      lines.push(`  ${section.heading.padEnd(8, '　')}${cells[0].padEnd(36)}${cells[1]}`);
    }
    console.log(lines.join('\n'));
    expect(lines.length).toBe(2 + SUBJECTS.length + 1 + R.scene.sections.length);
  });
});

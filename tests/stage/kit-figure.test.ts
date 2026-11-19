// 模型跟着镜头远近怎么变，只算数的那一部分（src/stage/three/kit/figure.ts）和样式里那张表
// （src/stage/three/style/songQinglvFigure.ts）的单元测试。
// 运行：npx vitest run tests/stage/kit-figure.test.ts
// 不造模型，不算地面，不要浏览器。编的情形用 tests/support/fixtureScene.ts 那座小沙盘；徐州只读它的场景文件。
//
// 查五样：
//   1 折算过的远近：宽屏上就是镜头的远近，画面矮了跟着变大。
//   2 每一类的倍数：往远处只增不减；镜头往后退，东西在画面上不会变大；近处差不多是本来的大小，远处差不多放大到头；
//     留几成只减不增，摊开只增不减，都不出界。
//   3 样式里那张表守着的几条规矩：船和石头一样不去掉、放大的倍数不超过设计给的上限；整组放大的几类，摊开和放大是一个数。
//   4 九种摆件各算哪一类：摆在城墙上的和摆在地上的。
//   5 哪几样东西跟着一座小建筑整组放大：放鹤亭和亭下的小屋，草屋和它的篱笆、果树，台头寺和寺旁的松树。

import { describe, expect, it } from 'vitest';
import type { SceneDressing, SceneThing, StopScene, ThingKind } from '../../src/domain/scene';
import { thingParams } from '../../src/domain/sceneParams';
import type { FigureClass, FigureRule, StageStyle } from '../../src/stage/three/internal';
import { closeTrees, detailGone, equivalentDistance, figureGroups, figureNow, figureTimes, liftClass, sat } from '../../src/stage/three/kit/figure';
import { styleFor } from '../../src/stage/three/style';
import { SONG_QINGLV_FIGURE } from '../../src/stage/three/style/songQinglvFigure';
import { FIXTURE_HEADINGS, fixturePoint, fixtureScene } from '../support/fixtureScene';
import { realSceneFile } from './support/realScenes';

const style = styleFor('song-qinglv');
const RULES = style.figure.rules;

/** 十四类，照 src/stage/three/internal.ts 的 FigureClass 抄的。 */
const CLASSES: FigureClass[] = ['wallH', 'tower', 'wallTop', 'yardCity', 'yardOut', 'cityHouse', 'village', 'boat', 'smallBoat', 'rock', 'tree', 'hut', 'shed', 'pavilion'];

/** D 从 800 米到 130 公里，每一步远 1%。 */
function sweep(): number[] {
  const out: number[] = [];
  for (let D = 800; D <= 130000; D *= 1.01) out.push(D);
  return out;
}

/** 算出来的数差在第十二位以后的不算（加减乘除的零头）。 */
const SLACK = 1e-12;

// ---------------------------------------------------------------- 折算过的远近

describe('折算过的远近', () => {
  it('900 像素高、视角 21 度的画面上，就是镜头离对准的那一点多远', () => {
    for (const d of [1150, 9600, 52000]) expect(equivalentDistance(d, 21, 900) / d).toBeCloseTo(1, 4);
  });

  it('量过的两个数：到徐州（52 公里，视角 18 度）在电脑上（栏高 900）是 44,437，在竖着拿的平板上（栏高 573，屏幕的 56%）是 69,798', () => {
    expect(Math.abs(equivalentDistance(52000, 18, 900) - 44437)).toBeLessThan(2);
    expect(Math.abs(equivalentDistance(52000, 18, 573) - 69798)).toBeLessThan(3);
    // 页面上放画面的那一块比沙盘栏矮一个像素（栏下边的边线），是 572 高：在页面上读到的是 69,920
    expect(Math.abs(equivalentDistance(52000, 18, 572) - 69920)).toBeLessThan(3);
  });

  it('画面矮一半，同样的远近算出来远一倍；镜头远一倍，也远一倍', () => {
    expect(equivalentDistance(9600, 21, 450)).toBeCloseTo(2 * equivalentDistance(9600, 21, 900), 6);
    expect(equivalentDistance(19200, 21, 900)).toBeCloseTo(2 * equivalentDistance(9600, 21, 900), 6);
  });

  it('视角大了，同样的远近东西在画面上小，算出来就远', () => {
    expect(equivalentDistance(9600, 30, 900)).toBeGreaterThan(equivalentDistance(9600, 21, 900));
  });

  it('画面还没有高度（0）时也给得出一个数，不是无穷大', () => {
    expect(Number.isFinite(equivalentDistance(9600, 21, 0))).toBe(true);
  });
});

// ---------------------------------------------------------------- sat

describe('sat：从 0 平滑地升到 1', () => {
  it('几个定点：−1 是 0，0 是 0.058，0.5 正好是 0.5，1 是 0.942，2 是 1', () => {
    expect(sat(-1)).toBeCloseTo(0, 5);
    expect(sat(0)).toBeCloseTo(0.0578, 3);
    expect(sat(0.5)).toBeCloseTo(0.5, 12);
    expect(sat(1)).toBeCloseTo(0.9422, 3);
    expect(sat(2)).toBeCloseTo(1, 5);
  });

  it('只增不减，不出 0 到 1，涨得不比 u 快', () => {
    let prev = sat(-3);
    for (let u = -3 + 0.01; u <= 4; u += 0.01) {
      const v = sat(u);
      expect(v).toBeGreaterThanOrEqual(prev - SLACK);
      expect(v - prev).toBeLessThanOrEqual(0.01 + SLACK);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
  });

  it('很远的两头不会算爆', () => {
    expect(sat(-1e6)).toBe(0);
    expect(sat(1e6)).toBe(1);
    expect(sat(-Infinity)).toBe(0);
  });
});

// ---------------------------------------------------------------- 每一类的倍数

describe('样式里的表', () => {
  it('沙盘用的就是 songQinglvFigure.ts 里的这一张，十四类一类不少', () => {
    expect(style.figure).toBe(SONG_QINGLV_FIGURE);
    expect(Object.keys(RULES).sort()).toEqual([...CLASSES].sort());
  });

  it('每一类的数都写得对：起点是正数，放大的倍数比 1 大，留的成数在 0 到 1 之间，摊开不小于 1', () => {
    for (const cls of CLASSES) {
      const rule = RULES[cls];
      expect(rule.holdFromM, cls).toBeGreaterThan(0);
      expect(rule.maxTimes, cls).toBeGreaterThan(1);
      expect(rule.keepAtMax ?? 1, cls).toBeGreaterThan(0);
      expect(rule.keepAtMax ?? 1, cls).toBeLessThanOrEqual(1);
      expect(rule.spreadAtMax ?? 1, cls).toBeGreaterThanOrEqual(1);
    }
  });

  it('船和石头一样不去掉（依据里说了数目和分组）；远看会去掉一些的只有民居、村子里的屋和树', () => {
    for (const cls of ['boat', 'smallBoat', 'rock'] as const) expect(RULES[cls].keepAtMax ?? 1, cls).toBe(1);
    const thinned = CLASSES.filter((cls) => (RULES[cls].keepAtMax ?? 1) < 1);
    expect(thinned.sort()).toEqual(['cityHouse', 'tree', 'village']);
  });

  it('船和石头放大的倍数不超过设计给的上限（货船 2.3，小船 3.8，石头 2.4）；场景容得下多少由 scene-figures.test.ts 量', () => {
    expect(RULES.boat.maxTimes).toBeLessThanOrEqual(2.3);
    expect(RULES.smallBoat.maxTimes).toBeLessThanOrEqual(3.8);
    expect(RULES.rock.maxTimes).toBeLessThanOrEqual(2.4);
  });

  it('整组放大的四类（草屋、亭、城里城外的院落），摊开的倍数和放大的倍数是一个数：整组像一件小摆设', () => {
    for (const cls of ['hut', 'pavilion', 'yardCity', 'yardOut'] as const) expect(RULES[cls].spreadAtMax, cls).toBe(RULES[cls].maxTimes);
  });

  it('细处和细做的树，都是从近的一头收到远的一头', () => {
    expect(style.figure.detailFadeM[1]).toBeGreaterThan(style.figure.detailFadeM[0]);
    expect(style.figure.closeTreesM[1]).toBeGreaterThan(style.figure.closeTreesM[0]);
  });
});

describe.each(CLASSES)('%s 这一类跟着远近怎么变', (cls) => {
  const rule = RULES[cls];
  const keepAtMax = rule.keepAtMax ?? 1;
  const spreadAtMax = rule.spreadAtMax ?? 1;

  it('往远处：倍数只增不减，留的成数只减不增，摊开只增不减，都不出界', () => {
    let prev = figureNow(rule, 800 / 1.01);
    for (const D of sweep()) {
      const now = figureNow(rule, D);
      expect(now.times, `D=${D.toFixed(0)}`).toBeGreaterThanOrEqual(prev.times * (1 - SLACK));
      expect(now.keep, `D=${D.toFixed(0)}`).toBeLessThanOrEqual(prev.keep * (1 + SLACK));
      expect(now.spread, `D=${D.toFixed(0)}`).toBeGreaterThanOrEqual(prev.spread * (1 - SLACK));
      expect(now.times).toBeGreaterThanOrEqual(1);
      expect(now.times).toBeLessThanOrEqual(rule.maxTimes * (1 + SLACK));
      expect(now.keep).toBeGreaterThanOrEqual(keepAtMax * (1 - SLACK));
      expect(now.keep).toBeLessThanOrEqual(1);
      expect(now.spread).toBeGreaterThanOrEqual(1);
      expect(now.spread).toBeLessThanOrEqual(spreadAtMax * (1 + SLACK));
      prev = now;
    }
  });

  it('镜头往后退，东西在画面上不会变大（倍数涨得比 D 慢）', () => {
    // 画面上的大小跟“倍数 ÷ D”成正比
    let prev = figureNow(rule, 800 / 1.01).times / (800 / 1.01);
    for (const D of sweep()) {
      const onScreen = figureNow(rule, D).times / D;
      expect(onScreen, `D=${D.toFixed(0)}`).toBeLessThanOrEqual(prev * (1 + SLACK));
      prev = onScreen;
    }
  });

  it('比起点的七成还近：差不多是本来的大小（不到 1.02 倍）', () => {
    expect(figureNow(rule, 0.7 * rule.holdFromM).times).toBeLessThanOrEqual(1.02);
    for (const D of sweep()) if (D < 0.7 * rule.holdFromM) expect(figureNow(rule, D).times, `D=${D.toFixed(0)}`).toBeLessThanOrEqual(1.02);
    // 再近得多，就一点不变
    const close = figureNow(rule, 0.1 * rule.holdFromM);
    expect(close.times).toBeCloseTo(1, 6);
    expect(close.keep).toBeCloseTo(1, 6);
    expect(close.spread).toBeCloseTo(1, 6);
  });

  it('比“起点 × 最大倍数”的 1.3 倍还远：差不多放大到头（最大倍数的九成五以上）', () => {
    const from = 1.3 * rule.holdFromM * rule.maxTimes;
    expect(figureNow(rule, from).times).toBeGreaterThanOrEqual(0.95 * rule.maxTimes);
    for (const D of sweep()) if (D > from) expect(figureNow(rule, D).times, `D=${D.toFixed(0)}`).toBeGreaterThanOrEqual(0.95 * rule.maxTimes);
    // 再远得多，三个数都到了头
    const far = figureNow(rule, 20 * rule.holdFromM * rule.maxTimes);
    expect(far.times).toBeCloseTo(rule.maxTimes, 6);
    expect(far.keep).toBeCloseTo(keepAtMax, 6);
    expect(far.spread).toBeCloseTo(spreadAtMax, 6);
  });

  it('走到半路（D 是起点乘最大倍数的平方根）：三个数都正好是到头时的平方根', () => {
    const half = figureNow(rule, rule.holdFromM * Math.sqrt(rule.maxTimes));
    expect(half.times).toBeCloseTo(Math.sqrt(rule.maxTimes), 9);
    expect(half.keep).toBeCloseTo(Math.sqrt(keepAtMax), 9);
    expect(half.spread).toBeCloseTo(Math.sqrt(spreadAtMax), 9);
  });

  it('figureTimes 给的就是这一类的倍数', () => {
    for (const D of [1206, 9600, 25638, 118676]) expect(figureTimes(style, cls, D)).toBe(figureNow(rule, D).times);
  });
});

describe('figureNow：写得不对的数', () => {
  const rule: FigureRule = { holdFromM: 5000, maxTimes: 3, keepAtMax: 0.5, spreadAtMax: 2 };
  const SAME = { times: 1, keep: 1, spread: 1 };

  it('D 是 0、负数、不是数：什么都不变', () => {
    for (const D of [0, -100, Number.NaN]) expect(figureNow(rule, D)).toEqual(SAME);
  });

  it('最大倍数不比 1 大、起点不是正数：什么都不变（不会除以 0）', () => {
    expect(figureNow({ ...rule, maxTimes: 1 }, 20000)).toEqual(SAME);
    expect(figureNow({ ...rule, maxTimes: 0.5 }, 20000)).toEqual(SAME);
    expect(figureNow({ ...rule, holdFromM: 0 }, 20000)).toEqual(SAME);
  });

  it('不写留几成、摊开几倍：一样不去，不摊开', () => {
    const plain = figureNow({ holdFromM: 5000, maxTimes: 3 }, 1e6);
    expect(plain.times).toBeCloseTo(3, 9);
    expect(plain.keep).toBe(1);
    expect(plain.spread).toBe(1);
  });

  it('离得极远也到头为止，不会越涨越大；D 是无穷大也一样，不出“不是数”', () => {
    for (const D of [1e12, 1e300, Infinity]) {
      const far = figureNow(rule, D);
      expect(far.times).toBeCloseTo(3, 9);
      expect(far.keep).toBeCloseTo(0.5, 9);
      expect(far.spread).toBeCloseTo(2, 9);
    }
  });
});

// ---------------------------------------------------------------- 细处，细做的树

describe('细处和细做的树', () => {
  const [detailNear, detailFar] = style.figure.detailFadeM;
  const [treesNear, treesFar] = style.figure.closeTreesM;

  it('细处：近的一头以内全在（0），远的一头以外收完（1），正中间是一半，往远处只增不减', () => {
    expect(detailGone(style, detailNear)).toBe(0);
    expect(detailGone(style, 800)).toBe(0);
    expect(detailGone(style, detailFar)).toBe(1);
    expect(detailGone(style, 130000)).toBe(1);
    expect(detailGone(style, (detailNear + detailFar) / 2)).toBeCloseTo(0.5, 9);
    let prev = 0;
    for (const D of sweep()) {
      const w = detailGone(style, D);
      expect(w).toBeGreaterThanOrEqual(prev);
      expect(w).toBeLessThanOrEqual(1);
      prev = w;
    }
  });

  it('细做的树：近的一头以内全在（1），远的一头以外都换回了苔点（0），往远处只减不增', () => {
    expect(closeTrees(style, treesNear)).toBe(1);
    expect(closeTrees(style, 800)).toBe(1);
    expect(closeTrees(style, treesFar)).toBe(0);
    expect(closeTrees(style, 130000)).toBe(0);
    expect(closeTrees(style, (treesNear + treesFar) / 2)).toBeCloseTo(0.5, 9);
    let prev = 1;
    for (const D of sweep()) {
      const w = closeTrees(style, D);
      expect(w).toBeLessThanOrEqual(prev);
      expect(w).toBeGreaterThanOrEqual(0);
      prev = w;
    }
  });

  it('两头写成一个数：在那里一步到头，不出“不是数”', () => {
    const step: StageStyle = { ...style, figure: { ...style.figure, detailFadeM: [20000, 20000], closeTreesM: [4000, 4000] } };
    expect(detailGone(step, 19999)).toBe(0);
    expect(detailGone(step, 20000)).toBe(1);
    expect(closeTrees(step, 3999)).toBe(1);
    expect(closeTrees(step, 4000)).toBe(0);
  });
});

// ---------------------------------------------------------------- 一样摆件算哪一类

const GROUNDS = { class: 'schematic', basis: '测试用的。', sourceIds: [] } as const;

/** 编一样摆件。 */
function thing(id: string, kind: ThingKind, extra: Partial<SceneThing> = {}): SceneThing {
  return { id, name: id, kind, ...GROUNDS, sourceIds: [], ...extra };
}

/** 编一条点缀。 */
function dressing(id: string, kind: SceneDressing['kind'], extra: Partial<SceneDressing> = {}): SceneDressing {
  return { id, name: id, kind, ...GROUNDS, class: 'dressing', sourceIds: [], ...extra };
}

/** 那座小沙盘，添上几样摆件、几条点缀（原有的城墙、南门、门上的楼、城里的民居都留着）。 */
function sceneWith(things: SceneThing[], rules: SceneDressing[] = []): StopScene {
  const scene = fixtureScene();
  return { ...scene, things: [...scene.things, ...things], dressing: [...scene.dressing, ...rules] };
}

/** 那座小沙盘上的城墙：x 从 −600 到 −200，z 从 −40 到 360。下面的位置都是沙盘里的米。 */
const IN_CITY = fixturePoint(-400, 160);
const ON_EAST_WALL = fixturePoint(-200, 160);
const OUT_OF_TOWN = fixturePoint(600, 600);

describe('九种摆件各算哪一类', () => {
  const line = [fixturePoint(300, 300), fixturePoint(500, 300)];
  const scene = sceneWith([
    thing('tower-on-wall', 'tower', { at: fixturePoint(-200, -40), on: 'wall' }),
    thing('tower-on-ground', 'tower', { at: OUT_OF_TOWN }),
    thing('pavilion-on-wall', 'pavilion', { at: ON_EAST_WALL, on: 'wall' }),
    thing('pavilion-on-ground', 'pavilion', { at: OUT_OF_TOWN }),
    thing('house-on-wall', 'house', { at: ON_EAST_WALL, on: 'wall' }),
    thing('house-on-ground', 'house', { at: OUT_OF_TOWN }),
    thing('yard-in-city', 'hall-group', { at: IN_CITY }),
    thing('yard-out-of-town', 'hall-group', { at: OUT_OF_TOWN }),
    thing('yard-just-outside', 'hall-group', { at: fixturePoint(-180, 160) }),
    thing('dike-free', 'dike', { line }),
    thing('dike-on-wall', 'dike', { line: [fixturePoint(-600, 360), fixturePoint(-200, 360)], on: 'wall' }),
    thing('bank-on-wall', 'bank', { line: [fixturePoint(-200, -40), fixturePoint(-200, 360)], on: 'wall' }),
    thing('bank-free', 'bank', { line }),
    thing('piles', 'timber-bank', { line }),
    thing('house-on-nothing', 'house', { at: OUT_OF_TOWN, on: 'no-such-thing' }),
  ]);
  const of = (id: string): FigureClass | null => {
    const found = scene.things.find((t) => t.id === id);
    if (!found) throw new Error(`没有 ${id}`);
    return liftClass(found, scene);
  };

  it.each<[string, FigureClass | null, string]>([
    ['wall', 'wallH', '城墙：只拉高'],
    ['gate-south', 'wallH', '城门：跟着城墙拉高'],
    ['gate-tower', 'tower', '城门上的楼'],
    ['tower-on-wall', 'wallTop', '直接摆在城墙上的楼（角楼）'],
    ['tower-on-ground', 'tower', '立在地上的楼'],
    ['pavilion-on-wall', 'wallTop', '城墙上的亭'],
    ['pavilion-on-ground', 'pavilion', '地上的亭'],
    ['house-on-wall', 'shed', '城墙上的棚子'],
    ['house-on-ground', 'hut', '地上单座的屋'],
    ['yard-in-city', 'yardCity', '城墙里面的院落'],
    ['yard-out-of-town', 'yardOut', '城外的院落'],
    ['yard-just-outside', 'yardOut', '紧贴在城墙外面的院落也算城外'],
    ['dike-free', null, '独立的堤：不乘'],
    ['dike-on-wall', null, '贴在城墙里侧的堤：不乘'],
    ['bank-on-wall', null, '贴在城墙外侧的土坡：不乘'],
    ['bank-free', null, '独立的土埂：不乘'],
    ['piles', null, '木桩护岸：不乘'],
    ['house-on-nothing', 'hut', 'on 写的东西找不到：当作摆在地上'],
  ])('%s → %s（%s）', (id, cls) => {
    expect(of(id)).toBe(cls);
  });

  it('徐州：二十三样摆件各是哪一类', () => {
    const { scene: xuzhou } = realSceneFile('su-shi/xuzhou');
    const got = Object.fromEntries(xuzhou.things.map((t) => [t.id, liftClass(t, xuzhou)]));
    expect(got).toEqual({
      wall: 'wallH',
      'gate-west': 'wallH',
      'gate-north': 'wallH',
      'gate-south': 'wallH',
      'gate-east': 'wallH',
      'gate-east-1078': 'wallH',
      'tower-west': 'tower',
      'tower-north': 'tower',
      'tower-south': 'tower',
      'tower-east': 'tower',
      huanglou: 'tower',
      'corner-tower': 'wallTop',
      yamen: 'yardCity',
      shed: 'shed',
      kuaizaiting: 'wallTop',
      'timber-bank': null,
      bank: null,
      'dike-se': null,
      'dike-inner': null,
      taitousi: 'yardOut',
      fangheting: 'pavilion',
      'fangheting-house': 'hut',
      'old-hut': 'hut',
    });
  });
});

// ---------------------------------------------------------------- 整组放大的小建筑

describe('单座的小建筑和挨着它的东西各成一组', () => {
  const [first, second] = FIXTURE_HEADINGS;
  /** 只留主角和跟着它的东西，好比对。 */
  const brief = (scene: StopScene, s: StageStyle = style): { main: string; cls: FigureClass; members: string[] }[] =>
    figureGroups(scene, s).map((g) => ({ main: g.main, cls: g.cls, members: g.members }));
  /** 草屋带篱笆时，放大到头占的那一块：左右各 26 × 4.3 = 111.8 米，前后各 28 × 4.3 = 120.4 米。 */
  const hut = (extra: Partial<SceneThing> = {}): SceneThing => thing('hut', 'house', { at: fixturePoint(600, 600), params: { roof: 'thatch', fence: true }, ...extra });

  it('徐州：放鹤亭带着亭下的小屋，草屋带着果树（篱笆是草屋自己的一部分），台头寺带着松树，州衙自己一组', () => {
    const { scene: xuzhou } = realSceneFile('su-shi/xuzhou');
    expect(figureGroups(xuzhou, style)).toEqual([
      { main: 'yamen', at: [117.182, 34.2695], cls: 'yardCity', members: [] },
      { main: 'taitousi', at: [117.1842, 34.2564], cls: 'yardOut', members: ['pines-temple'] },
      { main: 'fangheting', at: [117.1772, 34.2486], cls: 'pavilion', members: ['fangheting-house'] },
      { main: 'old-hut', at: [117.1763, 34.2486], cls: 'hut', members: ['fruit-trees'] },
    ]);
    const oldHut = xuzhou.things.find((t) => t.id === 'old-hut');
    expect(thingParams('house', oldHut?.params).fence).toBe(true);
  });

  it('徐州：船和石头都不在哪一组里（它们的大小另有上限）；草屋离放鹤亭不到 90 米，也没有被算进放鹤亭那一组', () => {
    const { scene: xuzhou } = realSceneFile('su-shi/xuzhou');
    const members = figureGroups(xuzhou, style).flatMap((g) => g.members);
    const kindOf = (id: string): string | undefined => xuzhou.dressing.find((d) => d.id === id)?.kind;
    expect(members.filter((id) => kindOf(id) === 'boats' || kindOf(id) === 'rocks')).toEqual([]);
    expect(members).not.toContain('old-hut');
    // 就算亭放大得再多一点（4.2 倍，往前占到 88 米）、把草屋那一点也罩住了，草屋还是自己一组：它和放鹤亭没有同时在场的小节
    const bigger: StageStyle = { ...style, figure: { ...style.figure, rules: { ...RULES, pavilion: { ...RULES.pavilion, maxTimes: 4.2, spreadAtMax: 4.2 } } } };
    const groups = figureGroups(xuzhou, bigger);
    expect(groups.find((g) => g.main === 'fangheting')?.members).toEqual(['fangheting-house']);
    expect(groups.find((g) => g.main === 'old-hut')?.members).toEqual(['fruit-trees']);
  });

  it('落在主角放大到头时占的那一块里面的进组，外面的自己当主角', () => {
    const scene = sceneWith([hut(), thing('near', 'house', { at: fixturePoint(700, 600) }), thing('far', 'house', { at: fixturePoint(750, 600) })]);
    expect(brief(scene)).toEqual([
      { main: 'hut', cls: 'hut', members: ['near'] },
      { main: 'far', cls: 'hut', members: [] },
    ]);
  });

  it('没有篱笆的屋占的地方小：同样 100 米外的屋就不算挨着了', () => {
    const scene = sceneWith([hut({ params: { roof: 'thatch' } }), thing('near', 'house', { at: fixturePoint(700, 600) })]);
    expect(brief(scene)).toEqual([
      { main: 'hut', cls: 'hut', members: [] },
      { main: 'near', cls: 'hut', members: [] },
    ]);
  });

  it('那一块跟着主角的朝向转：朝南时东边 116 米在外面，朝东时同一点在里面', () => {
    // 那一块前后比左右长（前后各 120.4 米，左右各 111.8 米）：朝南时东边是“左右”，朝东时东边是“前后”
    const east = thing('east', 'house', { at: fixturePoint(716, 600) });
    expect(brief(sceneWith([hut(), east]))[0].members).toEqual([]);
    expect(brief(sceneWith([hut({ facing: 90 }), east]))[0].members).toEqual(['east']);
  });

  it('样式里放大得少了，那一块跟着小：100 米外的屋不再算挨着', () => {
    const small: StageStyle = { ...style, figure: { ...style.figure, rules: { ...RULES, hut: { ...RULES.hut, maxTimes: 2, spreadAtMax: 2 } } } };
    const scene = sceneWith([hut(), thing('near', 'house', { at: fixturePoint(700, 600) })]);
    expect(brief(scene)[0].members).toEqual(['near']);
    expect(brief(scene, small)[0].members).toEqual([]);
  });

  it('不同时在场的不算挨着；有一小节同时在场就算', () => {
    const early = hut({ when: { only: [first] } });
    const late = thing('late', 'house', { at: fixturePoint(700, 600), when: { from: second } });
    expect(brief(sceneWith([early, late]))).toEqual([
      { main: 'hut', cls: 'hut', members: [] },
      { main: 'late', cls: 'hut', members: [] },
    ]);
    const always = thing('always', 'house', { at: fixturePoint(700, 600) });
    expect(brief(sceneWith([early, always]))).toEqual([{ main: 'hut', cls: 'hut', members: ['always'] }]);
  });

  it('先写的是主角：屋在前，亭进屋那一组；亭在前，屋进亭那一组，跟着亭的类走', () => {
    const house = thing('house', 'house', { at: fixturePoint(600, 600) });
    const pavilion = thing('pavilion', 'pavilion', { at: fixturePoint(630, 600) });
    expect(brief(sceneWith([house, pavilion]))).toEqual([{ main: 'house', cls: 'hut', members: ['pavilion'] }]);
    const scene = sceneWith([pavilion, house]);
    expect(brief(scene)).toEqual([{ main: 'pavilion', cls: 'pavilion', members: ['house'] }]);
    // 屋自己算 hut，进了亭那一组就用那一组的类
    expect(liftClass(house, scene)).toBe('hut');
  });

  it('进了别人那一组的不再当主角：挨着它、却不挨着主角的东西不进组', () => {
    const scene = sceneWith([hut(), thing('near', 'house', { at: fixturePoint(700, 600) })], [dressing('trees-by-near', 'trees', { at: fixturePoint(800, 600) })]);
    expect(brief(scene)).toEqual([{ main: 'hut', cls: 'hut', members: ['near'] }]);
  });

  it('摆在城墙上的东西不进组，也不当主角', () => {
    // 亭在东墙外 50 米，墙上的棚子落在它那一块里面（21 × 3.8 = 79.8 米）
    const scene = sceneWith([thing('pavilion', 'pavilion', { at: fixturePoint(-150, 160) }), thing('shed', 'house', { at: ON_EAST_WALL, on: 'wall' })]);
    expect(brief(scene)).toEqual([{ main: 'pavilion', cls: 'pavilion', members: [] }]);
  });

  it('楼、堤这些不当主角', () => {
    const scene = sceneWith([thing('tower', 'tower', { at: OUT_OF_TOWN }), thing('dike', 'dike', { line: [fixturePoint(300, 300), fixturePoint(500, 300)] })]);
    expect(brief(scene)).toEqual([]);
  });

  it('点状的点缀进组；沿线的、整块沙盘的、离得远的不进', () => {
    const scene = sceneWith(
      [hut()],
      [
        dressing('trees-here', 'trees', { at: fixturePoint(620, 620) }),
        dressing('trees-line', 'trees', { line: [fixturePoint(560, 600), fixturePoint(640, 600)] }),
        dressing('trees-all', 'trees'),
        dressing('trees-away', 'trees', { at: fixturePoint(900, 600) }),
      ],
    );
    expect(brief(scene)).toEqual([{ main: 'hut', cls: 'hut', members: ['trees-here'] }]);
  });

  it('摆件在前，点缀在后，各按场景里写的先后', () => {
    const scene = sceneWith(
      [hut(), thing('b', 'house', { at: fixturePoint(650, 600) }), thing('a', 'house', { at: fixturePoint(550, 600) })],
      [dressing('d', 'trees', { at: fixturePoint(600, 640) }), dressing('c', 'trees', { at: fixturePoint(600, 560) })],
    );
    expect(brief(scene)[0].members).toEqual(['b', 'a', 'd', 'c']);
  });

  it('院落占的那一块不是以 at 为中心的：两进的院落放大 2 倍，往后到 210 米，往前到 180 米，左右各 234 米', () => {
    const yard = thing('yard', 'hall-group', { at: fixturePoint(600, 0) });
    const rules = [
      dressing('behind', 'trees', { at: fixturePoint(600, -200) }),
      dressing('in-front', 'trees', { at: fixturePoint(600, 200) }),
      dressing('beside', 'trees', { at: fixturePoint(830, 0) }),
      dressing('beside-far', 'trees', { at: fixturePoint(840, 0) }),
    ];
    expect(brief(sceneWith([yard], rules))).toEqual([{ main: 'yard', cls: 'yardOut', members: ['behind', 'beside'] }]);
  });

  it('同样的场景算两遍一样；不改场景；at 是抄出来的一份', () => {
    const scene = sceneWith([hut(), thing('near', 'house', { at: fixturePoint(700, 600) })], [dressing('trees-here', 'trees', { at: fixturePoint(620, 620) })]);
    const before = JSON.stringify(scene);
    const once = figureGroups(scene, style);
    expect(figureGroups(scene, style)).toEqual(once);
    expect(JSON.stringify(scene)).toBe(before);
    const main = scene.things.find((t) => t.id === 'hut');
    expect(once[0].at).toEqual(main?.at);
    expect(once[0].at).not.toBe(main?.at);
  });

  it('没有单座的小建筑的场景：没有组', () => {
    expect(figureGroups(fixtureScene(), style)).toEqual([]);
  });
});

// ---------------------------------------------------------------- 这个文件只算数

describe('kit/figure.ts 只算数', () => {
  const sources = import.meta.glob<string>('/src/stage/three/kit/figure.ts', { query: '?raw', import: 'default', eager: true });
  /** 去掉注释，只看程序。 */
  const code = (Object.values(sources)[0] ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('找得到这个文件', () => {
    expect(code).toContain('export function figureNow');
  });

  it('不从 three 拿东西：只从场景数据（domain）和地面（ground，它也不碰 three）取，样式和类只取类型', () => {
    const imports = code.match(/import\s+(type\s+)?[^;]*?from\s+['"][^'"]+['"]/g) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const line of imports) {
      const from = /from\s+['"]([^'"]+)['"]/.exec(line)?.[1] ?? '';
      const typeOnly = /^import\s+type\b/.test(line);
      const allowed = from.startsWith('../../../domain/') || from === '../../ground' || from.startsWith('../../ground/') || (typeOnly && from === '../internal');
      expect(`${line.replace(/\s+/g, ' ')} → ${allowed}`).toBe(`${line.replace(/\s+/g, ' ')} → true`);
    }
  });

  it('不碰页面：没有 document、window', () => {
    expect(/\b(document|window|navigator|requestAnimationFrame)\b/.test(code)).toBe(false);
  });
});

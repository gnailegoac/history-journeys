// 从场景数据生成的文字和查询的单元测试：某一节有哪些东西，题签指在哪、写什么字，远处怎么说，
// 沙盘旁边的说明，凭据里“沙盘上的东西”一栏。用的是几组测试共用的那座小沙盘（tests/support/fixtureScene.ts）；
// 全程沙盘那一支用校验规则的那座小样本；最后把 content/ 里真的场景（两层的沙盘）都过一遍。

import { describe, expect, it } from 'vitest';
import type { RouteScene, SceneFarPlace, SceneFrame, SceneStrip, StopScene, TableScene } from '../../src/domain/scene';
import { coordsOf } from '../../src/domain/sceneGeoRoute';
import { stripPoint } from '../../src/domain/sceneStripPoint';
import { NOTE_BRIEF_MAX, NOTE_SHORT_MAX, existsAt, farSay, farSayFrom, reliefSay, sceneRegister, sectionHeadings, sectionInfo, stripTexts, thingsAt } from '../../src/domain/sceneText';
import type { LngLat, Source } from '../../src/domain/types';
import { FIXTURE_HEADINGS, FIXTURE_M, fixturePoint, fixtureScene, fixtureSources } from '../support/fixtureScene';

const [FIRST, SECOND] = FIXTURE_HEADINGS;

/** 拿一份小沙盘来改。 */
function sceneWith(change: (scene: StopScene) => void): StopScene {
  const scene = fixtureScene();
  change(scene);
  return scene;
}

/** 徐州那块沙盘的范围（docs/research/xuzhou-scene.md 第一节）。 */
const XUZHOU: SceneFrame = { center: [117.185, 34.2655], westM: 6300, eastM: 5400, northM: 5400, southM: 4300, datumM: 40, relief: { kind: 'uniform', times: 6 } };

function farPlace(at: LngLat, gloss?: string): SceneFarPlace {
  return { id: 'far', name: '远处', at, ...(gloss === undefined ? {} : { gloss }), class: 'today', basis: '按今天的位置算方向和距离。', sourceIds: ['f3'] };
}

describe('sectionHeadings', () => {
  it('各小节的标题，按先后', () => {
    expect(sectionHeadings(fixtureScene())).toEqual(['起初', '后来']);
  });
});

describe('existsAt', () => {
  const headings = ['一', '二', '三', '四'];
  const at = (when: Parameters<typeof existsAt>[0]) => headings.filter((heading) => existsAt(when, heading, headings));

  it('不写 when 就是一直有', () => {
    expect(at(undefined)).toEqual(headings);
  });

  it('from：从这一节起有，含这一节', () => {
    expect(at({ from: '三' })).toEqual(['三', '四']);
    expect(at({ from: '一' })).toEqual(headings);
  });

  it('until：到这一节为止，含这一节', () => {
    expect(at({ until: '二' })).toEqual(['一', '二']);
    expect(at({ until: '四' })).toEqual(headings);
  });

  it('from 和 until 一起写', () => {
    expect(at({ from: '二', until: '三' })).toEqual(['二', '三']);
    expect(at({ from: '三', until: '三' })).toEqual(['三']);
    expect(at({ from: '三', until: '二' })).toEqual([]);
  });

  it('only：只在这几节有，和先后没有关系', () => {
    expect(at({ only: ['四', '二'] })).toEqual(['二', '四']);
    expect(at({ only: [] })).toEqual([]);
  });

  it('when 里写的标题找不到，或者问的小节找不到，算没有', () => {
    expect(at({ from: '零' })).toEqual([]);
    expect(at({ until: '五' })).toEqual([]);
    expect(at({ from: '二', until: '五' })).toEqual([]);
    expect(existsAt({ from: '一' }, '五', headings)).toBe(false);
    expect(existsAt({ only: ['五'] }, '五', headings)).toBe(true);
    expect(existsAt(undefined, '五', headings)).toBe(true);
  });
});

describe('thingsAt', () => {
  it('每一节沙盘上有哪些摆件、哪些点缀：南门上的楼第二节才有', () => {
    const scene = fixtureScene();
    expect(thingsAt(scene, FIRST).things.map((t) => t.id)).toEqual(['wall', 'gate-south']);
    expect(thingsAt(scene, SECOND).things.map((t) => t.id)).toEqual(['wall', 'gate-south', 'gate-tower']);
    expect(thingsAt(scene, FIRST).dressing.map((d) => d.id)).toEqual(['homes']);
  });

  it('点缀也看 when', () => {
    const scene = sceneWith((s) => (s.dressing[0].when = { only: [SECOND] }));
    expect(thingsAt(scene, FIRST).dressing).toEqual([]);
    expect(thingsAt(scene, SECOND).dressing.map((d) => d.id)).toEqual(['homes']);
  });

  it('给出来的就是场景里的那几样东西，没有另抄一份', () => {
    const scene = fixtureScene();
    expect(thingsAt(scene, SECOND).things[2]).toBe(scene.things[2]);
  });
});

describe('stripPoint', () => {
  const strip = (of: string, at?: LngLat): SceneStrip => ({ id: 'x', text: '字', of, ...(at ? { at } : {}) });

  it('写了 at 就是 at：一圈城墙上的一点，一条河上的一点', () => {
    const scene = fixtureScene();
    expect(stripPoint(scene, scene.strips[0])).toEqual(scene.strips[0].at);
    expect(stripPoint(scene, scene.strips[1])).toEqual(fixturePoint(FIXTURE_M.river[0][0], -600));
  });

  it('没写 at：只有一个点的摆件、地名点、急滩、一个点周围的点缀，用它自己的位置', () => {
    const scene = sceneWith((s) => {
      s.water.rapids.push({ id: 'shoal', name: '乱石滩', river: 'river', at: fixturePoint(-100, 600), lengthM: 200, class: 'schematic', basis: '示意。', sourceIds: [] });
      s.dressing.push({ id: 'boats', name: '船', kind: 'boats', at: fixturePoint(-100, 200), class: 'dressing', basis: '点缀。', sourceIds: [] });
    });
    expect(stripPoint(scene, strip('gate-south'))).toEqual(fixturePoint(FIXTURE_M.gate[0], FIXTURE_M.gate[1]));
    expect(stripPoint(scene, strip('hill'))).toEqual(fixturePoint(FIXTURE_M.hill[0], FIXTURE_M.hill[1]));
    expect(stripPoint(scene, strip('shoal'))).toEqual(fixturePoint(-100, 600));
    expect(stripPoint(scene, strip('boats'))).toEqual(fixturePoint(-100, 200));
  });

  it('指着远处：沙盘边上朝着它的那一点', () => {
    const scene = fixtureScene();
    // 远镇在往西 18 公里、往南 24 公里：朝着它走，从南边上往西 900 米的地方出去。
    const [lng, lat] = stripPoint(scene, scene.strips[2]);
    const [edgeLng, edgeLat] = fixturePoint(-900, FIXTURE_M.frame.z1);
    expect(lng).toBeCloseTo(edgeLng, 6);
    expect(lat).toBeCloseTo(edgeLat, 6);
  });

  it('给出来的是一份新的坐标，改了它不影响场景', () => {
    const scene = fixtureScene();
    const point = stripPoint(scene, scene.strips[0]);
    point[0] = 0;
    expect(scene.strips[0].at).toEqual(fixtureScene().strips[0].at);
    const gate = stripPoint(scene, strip('gate-south'));
    gate[1] = 0;
    expect(scene.things[1].at).toEqual(fixtureScene().things[1].at);
  });

  it('指着一条线却没有写 at，或者指的东西找不到，给不出点来就报错', () => {
    const scene = fixtureScene();
    expect(() => stripPoint(scene, strip('wall'))).toThrow('没有写 at');
    expect(() => stripPoint(scene, strip('river'))).toThrow('没有写 at');
    expect(() => stripPoint(scene, strip('nowhere'))).toThrow('nowhere');
  });
});

describe('stripTexts', () => {
  it('这一节的题签，按写的先后；指着河的是水名，指着远处的是远处', () => {
    const scene = fixtureScene();
    expect(stripTexts(scene, FIRST, 'ancient')).toEqual([
      { id: 's-town', text: '样城', tone: 'place' },
      { id: 's-river', text: '样水', tone: 'water' },
    ]);
    expect(stripTexts(scene, SECOND, 'ancient')).toEqual([
      { id: 's-town', text: '样城', tone: 'place' },
      { id: 's-far', text: '远镇', tone: 'far' },
    ]);
  });

  it('选今天的名字：写了 modern 的换成 modern，没写的还用当时的名字', () => {
    const scene = fixtureScene();
    expect(stripTexts(scene, FIRST, 'modern')).toEqual([
      { id: 's-town', text: '样市', tone: 'place' },
      { id: 's-river', text: '样水', tone: 'water' },
    ]);
  });

  it('指着急滩的也是水名；指着地名点、点缀的是地方', () => {
    const scene = sceneWith((s) => {
      s.water.rapids.push({ id: 'shoal', name: '乱石滩', river: 'river', at: fixturePoint(-100, 600), lengthM: 200, class: 'schematic', basis: '示意。', sourceIds: [] });
      s.strips.push({ id: 's-shoal', text: '乱石滩', of: 'shoal' }, { id: 's-hill', text: '样山', of: 'hill' }, { id: 's-homes', text: '民居', of: 'homes', at: fixturePoint(-400, 160) });
      s.sections[0].strips = ['s-shoal', 's-hill', 's-homes'];
    });
    expect(stripTexts(scene, FIRST, 'ancient').map((t) => t.tone)).toEqual(['water', 'place', 'place']);
  });

  it('小节里写了场景里没有的题签、或者同一条写了两次，跳过去', () => {
    const scene = sceneWith((s) => (s.sections[0].strips = ['s-ghost', 's-town', 's-town', 's-river']));
    expect(stripTexts(scene, FIRST, 'ancient').map((t) => t.id)).toEqual(['s-town', 's-river']);
  });

  it('没有这一小节就报错', () => {
    expect(() => stripTexts(fixtureScene(), '没有的小节', 'ancient')).toThrow('没有“没有的小节”这一小节');
  });
});

describe('farSay', () => {
  it('徐州的两处远处：白土镇和南京', () => {
    expect(farSay(XUZHOU, farPlace([117.0314, 34.0953], '今安徽萧县白土镇'))).toBe('往西南约 24 公里（今安徽萧县白土镇）');
    expect(farSay(XUZHOU, farPlace([115.61278, 34.38778], '今河南商丘'))).toBe('往西约 145 公里（今河南商丘）');
  });

  it('小沙盘的远镇：西南 30 公里', () => {
    const scene = fixtureScene();
    expect(farSay(scene.frame, scene.far[0])).toBe('往西南约 30 公里（今远镇）');
  });

  it('没有括注就不带括号', () => {
    const scene = fixtureScene();
    expect(farSay(scene.frame, farPlace(scene.far[0].at))).toBe('往西南约 30 公里');
    expect(farSay(scene.frame, farPlace(scene.far[0].at, '  '))).toBe('往西南约 30 公里');
  });

  /** 从小沙盘的原点朝 bearing 方向（0 是北，顺时针）走 km 公里的地方。 */
  const away = (bearing: number, km: number): LngLat => {
    const radians = (bearing * Math.PI) / 180;
    return fixturePoint(Math.sin(radians) * km * 1000, -Math.cos(radians) * km * 1000);
  };
  const frame = fixtureScene().frame;

  it('方向用八个方位词，每个管 45 度', () => {
    const words = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
    words.forEach((word, i) => expect(farSay(frame, farPlace(away(i * 45, 50))), word).toBe(`往${word}约 50 公里`));
    expect(farSay(frame, farPlace(away(22, 50)))).toBe('往北约 50 公里');
    expect(farSay(frame, farPlace(away(23, 50)))).toBe('往东北约 50 公里');
    expect(farSay(frame, farPlace(away(338, 50)))).toBe('往北约 50 公里');
    expect(farSay(frame, farPlace(away(337, 50)))).toBe('往西北约 50 公里');
    expect(farSay(frame, farPlace(away(359, 50)))).toBe('往北约 50 公里');
  });

  it('距离不到 100 公里取整公里', () => {
    expect(farSay(frame, farPlace(away(90, 23.4)))).toBe('往东约 23 公里');
    expect(farSay(frame, farPlace(away(90, 23.6)))).toBe('往东约 24 公里');
    expect(farSay(frame, farPlace(away(90, 97.4)))).toBe('往东约 97 公里');
    expect(farSay(frame, farPlace(away(90, 99.8)))).toBe('往东约 100 公里');
  });

  it('100 公里以上取最近的 5 公里', () => {
    expect(farSay(frame, farPlace(away(180, 102)))).toBe('往南约 100 公里');
    expect(farSay(frame, farPlace(away(180, 103)))).toBe('往南约 105 公里');
    expect(farSay(frame, farPlace(away(180, 145.2)))).toBe('往南约 145 公里');
    expect(farSay(frame, farPlace(away(180, 147.4)))).toBe('往南约 145 公里');
    expect(farSay(frame, farPlace(away(180, 147.6)))).toBe('往南约 150 公里');
    expect(farSay(frame, farPlace(away(180, 1238)))).toBe('往南约 1240 公里');
  });
});

describe('reliefSay', () => {
  it('统一夸大几倍，长短两种说法', () => {
    expect(reliefSay({ kind: 'uniform', times: 6 })).toEqual({ full: '山的高度夸大了 6 倍', short: '山高夸大 6 倍' });
    expect(reliefSay({ kind: 'uniform', times: 2.5 })).toEqual({ full: '山的高度夸大了 2.5 倍', short: '山高夸大 2.5 倍' });
  });

  it('1 倍就是没有夸大', () => {
    expect(reliefSay({ kind: 'uniform', times: 1 })).toEqual({ full: '山的高度没有夸大', short: '山高没有夸大' });
  });
});

describe('sectionInfo', () => {
  const RECIPE_NOTE = '平地是修整过的，压平、压低是示意。';
  const SIZES = '山的高度夸大了 6 倍；摆在沙盘上的模型都放大了，镜头离得越远放得越大，不按比例；河画宽了。';

  it('第一节：时间、题记、说明的四样、没有远处', () => {
    expect(sectionInfo(fixtureScene(), FIRST)).toEqual({
      section: '起初',
      date: '某年春',
      line: '城在河的西边，河从北往南流。',
      note: {
        short: '城墙、水位、河岸和河床等 7 样是示意；平地修整过；山高夸大 6 倍；模型和河都放大了',
        brief: '7 样是示意；平地修整过；山高夸大 6 倍；模型和河放大了',
        lines: ['城墙、水位、河岸和河床、样水，还有城壕的线位，等 7 样是示意。', RECIPE_NOTE, '城墙是示意：位置和大小都没有记载。', SIZES],
      },
      far: [],
    });
  });

  it('第二节：explain 点到的排在前面，按正文摆的写成“某某的某某”，题签指到的远处带着方向和距离', () => {
    expect(sectionInfo(fixtureScene(), SECOND)).toEqual({
      section: '后来',
      date: '某年秋',
      line: '水涨到了城下，南门上添了一座楼。',
      note: {
        short: '水位、南门上的楼的细节、河岸和河床等 8 样是示意；平地修整过；山高夸大 6 倍；模型和河都放大了',
        brief: '8 样是示意；平地修整过；山高夸大 6 倍；模型和河放大了',
        lines: [
          '水位、河岸和河床、样水，还有南门上的楼的层数和高矮；城壕的线位，等 8 样是示意。',
          RECIPE_NOTE,
          '水位是示意。',
          '南门上的楼是按记载摆的；楼有几层、多高没有记载，样子是示意。',
          SIZES,
        ],
      },
      far: [{ id: 'far-town', name: '远镇', say: '往西南约 30 公里（今远镇）' }],
    });
  });

  it('explain 不管怎么写，四样都在：哪些是示意，地形修整过，山高夸大几倍，模型和河都放大了', () => {
    const explains = [[], ['wall'], ['recipe'], ['terrain', 'banks'], ['nothing'], ['inner-wall', 'far-town'], ['homes', 'hill', 'moat', 'river', 'levels', 'wall']];
    for (const explain of explains) {
      for (const heading of FIXTURE_HEADINGS) {
        const { note } = sectionInfo(
          sceneWith((s) => s.sections.forEach((section) => (section.explain = explain))),
          heading,
        );
        const label = `${heading} explain=${JSON.stringify(explain)}`;
        expect(note.lines[0], label).toMatch(/是示意。$/);
        expect(note.lines[1], label).toBe(RECIPE_NOTE);
        expect(note.lines[note.lines.length - 1], label).toBe(SIZES);
        expect(note.short, label).toMatch(/^.+是示意；平地修整过；山高夸大 6 倍；模型和河都放大了$/);
        expect(note.brief, label).toMatch(/^\d+ 样是示意；平地修整过；山高夸大 6 倍；模型和河放大了$/);
      }
    }
  });

  it('示意的东西：explain 里点到的在前；其余的先是水，再是摆在上面的东西，最后是地形的修整', () => {
    const scene = sceneWith((s) => (s.sections[0].explain = ['river', 'moat', 'wall']));
    const { note } = sectionInfo(scene, FIRST);
    expect(note.lines[0]).toBe('样水、城墙、水位、河岸和河床，还有城壕的线位，等 7 样是示意。');
    // 排在最后的是地形的修整：把别的都去掉以后才轮到它。
    const terrainLast = sceneWith((s) => {
      s.sections[0].explain = ['wall'];
      for (const item of [s.water.levels, s.water.banks, s.water.rivers[0]]) Object.assign(item, { class: 'text', sourceIds: ['f1'] });
    });
    expect(sectionInfo(terrainLast, FIRST).note.lines[0]).toBe('城墙、城里的地面，还有城壕的线位；南门的位置（在南墙的哪一点），都是示意。');
    expect(note.short).toBe('样水、城壕的细节、城墙等 7 样是示意；平地修整过；山高夸大 6 倍；模型和河都放大了');
  });

  it('不超过五样就都列出来，不写“等几样”', () => {
    const scene = sceneWith((s) => {
      // 把两样改成有出处的，剩下：城墙、水位、样水，和两样只有一部分说不准的。
      Object.assign(s.terrain.edits[0], { class: 'text', sourceIds: ['f1'] });
      Object.assign(s.water.banks, { class: 'text', sourceIds: ['f1'] });
    });
    const { note } = sectionInfo(scene, FIRST);
    expect(note.lines[0]).toBe('城墙、水位、样水，还有城壕的线位；南门的位置（在南墙的哪一点），都是示意。');
    expect(note.short).toBe('城墙、水位、样水等 5 样是示意；平地修整过；山高夸大 6 倍；模型和河都放大了');
  });

  it('只有一样按正文摆、有一部分说不准的：拼成“某某的某某是示意”', () => {
    const scene = sceneWith((s) => {
      for (const item of [s.terrain.edits[0], s.water.levels, s.water.banks, s.water.rivers[0], s.things[0]]) Object.assign(item, { class: 'text', sourceIds: ['f1'] });
      delete s.water.rivers[1].unsure;
      delete s.things[1].unsure;
    });
    expect(sectionInfo(scene, SECOND).note.lines[0]).toBe('南门上的楼的层数和高矮是示意。');
    expect(sectionInfo(scene, SECOND).note.short).toMatch(/^南门上的楼的细节是示意；/);
    expect(sectionInfo(scene, SECOND).note.brief).toMatch(/^1 样是示意；/);
    // 第一节那座楼还没有，就一样示意的也没有了；这句话还是要有。
    expect(sectionInfo(scene, FIRST).note.lines[0]).toBe('这一节摆出来的东西里，没有归在示意一类的。');
    expect(sectionInfo(scene, FIRST).note.short).toMatch(/^没有归为示意的东西；平地修整过；/);
    expect(sectionInfo(scene, FIRST).note.brief).toMatch(/^没有归为示意的东西；平地修整过；/);
  });

  it('这一节没有的摆件和点缀不算；远处只算这一节的题签指到的', () => {
    const scene = sceneWith((s) => {
      s.far[0].class = 'schematic';
      s.things[0].when = { only: [SECOND] };
    });
    const first = sectionInfo(scene, FIRST).note.lines[0];
    expect(first).not.toContain('城墙');
    expect(first).not.toContain('远镇');
    expect(first).not.toContain('南门上的楼');
    const second = sectionInfo(sceneWith((s) => ((s.far[0].class = 'schematic'), (s.sections[1].explain = ['far-town']))), SECOND).note.lines[0];
    expect(second).toMatch(/^远镇、/);
    // 数也要对：远处归成了示意，第一节的题签没有指到它，“一共几样”不多；第二节指到了，多一样。
    const count = (scene: StopScene, heading: string) => Number(/^(\d+) 样/.exec(sectionInfo(scene, heading).note.brief)?.[1]);
    const farIsSchematic = sceneWith((s) => (s.far[0].class = 'schematic'));
    expect(count(farIsSchematic, FIRST)).toBe(count(fixtureScene(), FIRST));
    expect(count(farIsSchematic, SECOND)).toBe(count(fixtureScene(), SECOND) + 1);
  });

  it('地形的整理不列在示意的东西里：它自己的那句话每一节都有', () => {
    for (const heading of FIXTURE_HEADINGS) expect(sectionInfo(fixtureScene(), heading).note.lines[0]).not.toContain('整理');
  });

  it('特别要说的：explain 里点到的每一样的 note 都印，按点的先后；没有画的东西用它的 why', () => {
    const scene = sceneWith((s) => (s.sections[0].explain = ['inner-wall', 'river', 'wall']));
    expect(sectionInfo(scene, FIRST).note.lines.slice(2, -1)).toEqual([
      '记载里有这道墙，在哪里没有查到，沙盘上没有画。',
      '样水从北往南流过城东，河道走哪条线是示意。',
      '城墙是示意：位置和大小都没有记载。',
    ]);
  });

  it('常印着的一句（short）最多点三样的名字；名字太长、两行放不下，就少点几样，一样也放不下就只说一共几样', () => {
    const long = (count: number) =>
      sceneWith((s) => {
        s.sections[0].explain = ['wall', 'river', 'levels'];
        s.things[0].name = '城'.repeat(count);
      });
    const tail = '是示意；平地修整过；山高夸大 6 倍；模型和河都放大了';
    // 名字不长：三样都点。
    expect(sectionInfo(long(2), FIRST).note.short).toBe(`城城、样水、水位等 7 样${tail}`);
    // 第一样的名字长了：三样放不下，点两样；再长，点一样；长到一样也放不下，只说一共几样。
    expect(sectionInfo(long(24), FIRST).note.short).toBe(`${'城'.repeat(24)}、样水等 7 样${tail}`);
    expect(sectionInfo(long(27), FIRST).note.short).toBe(`${'城'.repeat(27)}等 7 样${tail}`);
    expect(sectionInfo(long(29), FIRST).note.short).toBe(`7 样${tail}`);
    for (const count of [2, 24, 27, 29, 80]) {
      const { note } = sectionInfo(long(count), FIRST);
      expect(note.short.length, String(count)).toBeLessThanOrEqual(NOTE_SHORT_MAX);
      // 栏窄时的一句不点名字，名字多长都不碍事。
      expect(note.brief).toBe('7 样是示意；平地修整过；山高夸大 6 倍；模型和河放大了');
      expect(note.brief.length).toBeLessThanOrEqual(NOTE_BRIEF_MAX);
    }
  });

  it('explain 点到整理、点到同一样两次、点到没有 note 的东西：同一句话不印两遍，没有的不印', () => {
    const lines = (explain: string[]) => sectionInfo(sceneWith((s) => (s.sections[0].explain = explain)), FIRST).note.lines;
    expect(lines(['recipe', 'wall'])).toEqual([lines(['wall'])[0], RECIPE_NOTE, '城墙是示意：位置和大小都没有记载。', SIZES]);
    expect(lines(['wall', 'wall']).slice(2, -1)).toEqual(['城墙是示意：位置和大小都没有记载。']);
    expect(lines(['gate-south', 'homes'])).toHaveLength(3);
    expect(lines(['levels', 'banks']).slice(2, -1)).toEqual(['水位是示意。']);
  });

  it('recipe 没有写 note 时（校验不让这样），地形修整过这一句也不缺', () => {
    const scene = sceneWith((s) => delete s.terrain.recipe.note);
    expect(sectionInfo(scene, FIRST).note.lines[1]).toBe('平地是修整过的：高高低低的平地抹成了差不多一样高，山也跟着矮了一截。');
  });

  it('同一处远处有两条题签指着，只说一次；按题签的先后', () => {
    const scene = sceneWith((s) => {
      s.far.push({ id: 'far-city', name: '远城', at: fixturePoint(60000, 0), class: 'today', basis: '按今天的位置算。', sourceIds: ['f3'] });
      s.strips.push({ id: 's-far-2', text: '远镇口', of: 'far-town' }, { id: 's-city', text: '远城', of: 'far-city' });
      s.sections[1].strips = ['s-city', 's-far', 's-far-2', 's-town'];
    });
    expect(sectionInfo(scene, SECOND).far).toEqual([
      { id: 'far-city', name: '远城', say: '往东约 60 公里' },
      { id: 'far-town', name: '远镇', say: '往西南约 30 公里（今远镇）' },
    ]);
  });

  it('没有这一小节就报错', () => {
    expect(() => sectionInfo(fixtureScene(), '没有的小节')).toThrow('没有“没有的小节”这一小节');
  });

  it('不改传进来的场景', () => {
    const scene = fixtureScene();
    for (const heading of FIXTURE_HEADINGS) sectionInfo(scene, heading);
    expect(scene).toEqual(fixtureScene());
  });
});

describe('sceneRegister', () => {
  it('五类都给，顺序固定，带页面上的叫法', () => {
    const register = sceneRegister(fixtureScene(), fixtureSources());
    expect(register.groups.map((group) => `${group.class} ${group.label}`)).toEqual(['real 真的', 'today 今天的位置', 'text 按正文摆的', 'schematic 示意的', 'dressing 点缀']);
  });

  it('每样东西归在它的类别下面，按场景文件里写的先后', () => {
    const register = sceneRegister(fixtureScene(), fixtureSources());
    expect(register.groups.map((group) => group.entries.map((entry) => entry.name))).toEqual([
      ['地形', '样山'],
      ['远镇'],
      ['城壕', '南门', '南门上的楼'],
      ['地形的整理', '城里的地面', '水位', '河岸和河床', '样水', '城墙'],
      ['城里的民居'],
    ]);
    for (const group of register.groups) for (const entry of group.entries) expect(entry.class).toBe(group.class);
  });

  it('一项里有 id、名字、依据、说不准的部分、出处的写法', () => {
    const register = sceneRegister(fixtureScene(), fixtureSources());
    expect(register.groups[2].entries[2]).toEqual({
      id: 'gate-tower',
      name: '南门上的楼',
      class: 'text',
      basis: '记里说后来在南门上盖了一座楼。',
      unsure: '层数和高矮',
      cites: ['某人《样城记》', '《某史》卷一'],
    });
    // 没有 unsure 的不带这个字段；地形、整理、水位、河岸用的是 explain 里指它们的那四个词当 id。
    expect(register.groups[0].entries[0]).toEqual({ id: 'terrain', name: '地形', class: 'real', basis: '山的位置和形状照高程网格。', cites: ['今天的高程数据和地图（测试用的假数据）'] });
    expect(register.groups[3].entries.slice(0, 4).map((entry) => entry.id)).toEqual(['recipe', 'city-ground', 'levels', 'banks']);
    expect(register.groups[3].entries[5]).toEqual({ id: 'wall', name: '城墙', class: 'schematic', basis: '城墙的位置和大小没有记载，是自己定的。', cites: [] });
  });

  it('后面是没有画的东西，最后是用了谁的数据', () => {
    const register = sceneRegister(fixtureScene(), fixtureSources());
    expect(register.notDrawn).toEqual([{ id: 'inner-wall', name: '内城', why: '记载里有这道墙，在哪里没有查到，沙盘上没有画。', cites: ['《某史》卷一'] }]);
    expect(register.credits).toEqual(['地形：测试用的假数据。']);
  });

  it('修整、急滩、水漫不进去的地方、各小节才有的东西，都列进来', () => {
    const scene = sceneWith((s) => {
      s.water.rapids.push({ id: 'shoal', name: '乱石滩', river: 'river', at: fixturePoint(-100, 600), lengthM: 200, class: 'text', basis: '记里有。', sourceIds: ['f1'] });
      s.water.dry.push({ id: 'yard', name: '城南的高地', area: [fixturePoint(-600, 500), fixturePoint(-200, 500), fixturePoint(-200, 700)], class: 'text', basis: '记里有。', sourceIds: ['f1'] });
    });
    const names = sceneRegister(scene, fixtureSources()).groups[2].entries.map((entry) => entry.name);
    expect(names).toEqual(['城壕', '乱石滩', '城南的高地', '南门', '南门上的楼']);
  });

  it('出处对不上的跳过去；空白的 unsure 不带', () => {
    const scene = sceneWith((s) => {
      s.things[1].sourceIds = ['f1', 'f9'];
      s.things[1].unsure = '  ';
      s.notDrawn[0].sourceIds = ['f9'];
    });
    const register = sceneRegister(scene, fixtureSources());
    expect(register.groups[2].entries[1]).toEqual({ id: 'gate-south', name: '南门', class: 'text', basis: '记里说南面有门。', cites: ['某人《样城记》'] });
    expect(register.notDrawn[0].cites).toEqual([]);
  });

  it('不改传进来的场景；给出来的 credits 是另一份', () => {
    const scene = fixtureScene();
    const register = sceneRegister(scene, fixtureSources());
    register.credits.push('多出来的');
    expect(scene).toEqual(fixtureScene());
  });
});

// ---------------------------------------------------------------- 全程沙盘
// 同一套函数，交给它一座全程沙盘（场景文件里写着 "level": "route"）。用的是校验规则那座合格的小样本
// （tests/content/fixtures/good/figures/demo/scenes/route.json）：三站，三趟路四截，一处远处，一个裁了角的湖。

const routeSamples = import.meta.glob<string>('../content/fixtures/good/figures/demo/scenes/route.json', { query: '?raw', import: 'default', eager: true });
const ROUTE_SAMPLE = Object.values(routeSamples)[0];

/** 拿一份全程沙盘的小样本来改。 */
function routeWith(change: (scene: RouteScene) => void = () => {}): RouteScene {
  const scene = JSON.parse(ROUTE_SAMPLE) as RouteScene;
  change(scene);
  return scene;
}

describe('全程沙盘：题签（stripTexts）', () => {
  it('站的地名带着它是哪几站；水名是河、湖、只染水色的水和海；指着远处的是远处；别的地方没有 stops 这一项', () => {
    const scene = routeWith();
    expect(stripTexts(scene, '全程', 'ancient')).toEqual([
      { id: 's-river', text: '示例城', tone: 'place', stops: ['river'] },
      { id: 's-pass', text: '南山口', tone: 'place', stops: ['pass'] },
      { id: 's-port', text: '东港', tone: 'place', stops: ['port'] },
      { id: 's-long', text: '长河', tone: 'water' },
      { id: 's-sea', text: '海', tone: 'water' },
    ]);
    expect(stripTexts(scene, '到示例城', 'ancient')[0]).toEqual({ id: 's-far', text: '北都', tone: 'far' });
    const last = stripTexts(scene, '到东港', 'ancient');
    expect(last.map((t) => `${t.text} ${t.tone}`)).toEqual(['南山口 place', '东港 place', '南溪 water', '镜湖 water', '大泽 water', '南岭 place', '海 water']);
    // 南岭是地名点，不是站：没有 stops 这一项（不是空的一串）
    expect(last[5]).toEqual({ id: 's-ridge', text: '南岭', tone: 'place' });
    expect('stops' in last[5]).toBe(false);
  });

  it('一个地方是两站（杭州那样）：两站都带着，按场景里写的先后；stops 写成空的就当没有', () => {
    const twice = routeWith((s) => (s.places[0].stops = ['river', 'port']));
    expect(stripTexts(twice, '全程', 'ancient')[0].stops).toEqual(['river', 'port']);
    const none = routeWith((s) => (s.places[0].stops = []));
    expect('stops' in stripTexts(none, '全程', 'ancient')[0]).toBe(false);
  });

  it('选今天的名字：写了 modern 的换，没写的不换；带着哪几站不变', () => {
    const scene = routeWith();
    expect(stripTexts(scene, '全程', 'modern').map((t) => t.text)).toEqual(['示例市', '南山口', '东港市', '长河', '海']);
    expect(stripTexts(scene, '全程', 'modern')[0].stops).toEqual(['river']);
    expect(stripTexts(scene, '到示例城', 'modern')[0].text).toBe('北都市');
  });

  it('站点沙盘的题签没有 stops 这一项', () => {
    for (const heading of FIXTURE_HEADINGS) for (const strip of stripTexts(fixtureScene(), heading, 'ancient')) expect(Object.keys(strip)).toEqual(['id', 'text', 'tone']);
  });
});

describe('全程沙盘：远处（farSayFrom）和山高（reliefSay）', () => {
  it('从题签指的那一点量，不从沙盘的原点量：定州在路进沙盘的那一点往北约 14 公里', () => {
    expect(farSayFrom([114.946, 38.395], { at: [115.0, 38.51], gloss: '今河北定州' })).toBe('往北约 14 公里（今河北定州）');
    // 同一处远处，要是从苏轼全程沙盘的原点量，是往北一千多公里：不是这句话
    expect(farSayFrom([112.25, 28.25], { at: [115.0, 38.51] })).toBe('往北约 1170 公里');
  });

  it('球面上量：沿经线一度是 111.19 公里；赤道上沿纬线一度也是；北纬 60 度上沿纬线一度是一半', () => {
    expect(farSayFrom([110, 30], { at: [110, 31] })).toBe('往北约 110 公里');
    expect(farSayFrom([110, 31], { at: [110, 30] })).toBe('往南约 110 公里');
    expect(farSayFrom([110, 0], { at: [111, 0] })).toBe('往东约 110 公里');
    expect(farSayFrom([111, 0], { at: [110, 0] })).toBe('往西约 110 公里');
    expect(farSayFrom([10, 60], { at: [11, 60] })).toBe('往东约 56 公里');
    // 沿经线 0.5 度是 55.6 公里：不到 100 公里取整公里
    expect(farSayFrom([110, 30], { at: [110, 30.5] })).toBe('往北约 56 公里');
  });

  it('八个方位词、括注的写法和站点沙盘的一样；同一点是 0 公里', () => {
    expect(farSayFrom([110, 30], { at: [111, 31] })).toBe('往东北约 145 公里');
    expect(farSayFrom([110, 30], { at: [109, 29] })).toBe('往西南约 145 公里');
    expect(farSayFrom([110, 30], { at: [111, 29], gloss: ' 今某地 ' })).toBe('往东南约 145 公里（今某地）');
    expect(farSayFrom([110, 30], { at: [109, 31], gloss: '  ' })).toBe('往西北约 145 公里');
    expect(farSayFrom([110, 30], { at: [110, 30] })).toBe('往北约 0 公里');
  });

  it('矮山多夸：两个数是 highTimes 和 lowTimes', () => {
    expect(reliefSay({ kind: 'low-hills-more', lowBelowM: 300, lowTimes: 25, power: 0.6, highTimes: 8 })).toEqual({
      full: '山的高度夸大了约 8 到 25 倍，矮山夸得多、高山夸得少',
      short: '山高夸大 8 到 25 倍',
    });
    expect(reliefSay(routeWith().frame.relief).short).toBe('山高夸大 12 到 25 倍');
  });
});

describe('全程沙盘：沙盘旁边的说明（sectionInfo）', () => {
  const SIZES = '山的高度夸大了约 12 到 25 倍，矮山夸得多、高山夸得少；河和路都画宽了，不按比例。';
  const RECIPE_NOTE = '平地抹平了，山的位置和形状是今天的。路没到的西南角留白。';

  it('头一节（全程）：路都画着，每一截各算一样；三种写法里说的是“平地抹平”、highTimes 到 lowTimes 两个数、“河和路都画宽了”', () => {
    expect(sectionInfo(routeWith(), '全程')).toEqual({
      section: '全程',
      date: '示例三年到五年',
      line: '示例先生走过的三站。实线是他写到过的路，虚线只知道两头。',
      note: {
        short: '南溪、新渠、镜湖的西南角等 7 样是示意；平地抹平；山高夸大 12 到 25 倍；河和路都画宽了',
        brief: '7 样是示意；平地抹平；山高夸大 12 到 25 倍；河画宽了',
        // 先是水（河、从湖面里裁掉的角、只染水色的水），再是路，最后是抹成海的地方；explain 点的 recipe 不印第二遍
        lines: ['南溪、新渠、镜湖的西南角、大泽、示例四年示例城到南山口的水路等 7 样是示意。', RECIPE_NOTE, '海岸是照今天画的，当时差多少没有查。', SIZES],
      },
      far: [],
    });
  });

  it('看路的一节：后面各站的路还没有画，不算；远处从题签指的那一点量；explain 点到一趟路，印的是它各截的 note', () => {
    expect(sectionInfo(routeWith(), '到示例城')).toEqual({
      section: '到示例城',
      date: '示例三年春',
      line: '从北都往西南，到示例城。',
      note: {
        // 到这一站去的路里没有整截示意的：常印着的一句不点名字，只说一共几样（点出来的只会是别处的水）；展开的那一句照旧点名字
        short: '5 样是示意；平地抹平；山高夸大 12 到 25 倍；河和路都画宽了',
        brief: '5 样是示意；平地抹平；山高夸大 12 到 25 倍；河画宽了',
        lines: ['南溪、新渠、镜湖的西南角、大泽、东边的海岸是示意。', RECIPE_NOTE, '从北都来的路是照《行记》画的。', '北都在这块沙盘的北边外面。', SIZES],
      },
      far: [{ id: 'far-north', name: '北都', say: '往北约 80 公里（今北都市）' }],
    });
  });

  it('一共几样，一节一节多起来：5、6、7；头一节是全部 7 样', () => {
    const count = (heading: string) => Number(/^(\d+) 样/.exec(sectionInfo(routeWith(), heading).note.brief)?.[1]);
    expect(['全程', '到示例城', '到南山口', '到东港'].map(count)).toEqual([7, 5, 6, 7]);
  });

  it('看来路的一节：到这一站去的路里整截示意的排在最前面，再是水，再是别的（不看 explain）；按正文摆的那一截不算示意，写了 unsure 才算一部分示意', () => {
    expect(sectionInfo(routeWith(), '到南山口').note.lines[0]).toBe('示例四年示例城到南山口的水路、南溪、新渠、镜湖的西南角、大泽等 6 样是示意。');
    // 这一节的 explain 还点了裁掉的角和抹成海的地方：裁掉的角照样排在水里，抹成海的地方照样排在最后，不提到前面
    expect(sectionInfo(routeWith(), '到东港').note.lines[0]).toBe('示例五年溪口到东港的水路、南溪、新渠、镜湖的西南角、大泽等 7 样是示意。');
    // 来路里只有一部分是示意的那一截（写了 unsure）不提前：排在水的后面，和别的路在一起
    const partly = routeWith((s) => (s.roads.journeys[2].parts[0].unsure = '过山的山口'));
    expect(sectionInfo(partly, '到东港').note.lines[0]).toBe('示例五年溪口到东港的水路、南溪、新渠、镜湖的西南角、大泽等 8 样是示意。');
    expect(sectionInfo(partly, '到东港').note.short).toBe('示例五年溪口到东港的水路、南溪、新渠等 8 样是示意；平地抹平；山高夸大 12 到 25 倍；河和路都画宽了');
    // 前一节这趟路还没有画：不算
    expect(sectionInfo(partly, '到南山口').note.brief).toMatch(/^6 样是示意；/);
    // 这一站的来路里没有整截示意的：从水说起
    const none = routeWith((s) => s.roads.journeys[2].parts.forEach((part) => (part.class = 'text')));
    expect(sectionInfo(none, '到东港').note.lines[0]).toMatch(/^南溪、新渠、镜湖的西南角、大泽、/);
    // ……而常印着的那一句这时不点名字，只说一共几样；来路里有整截示意的一节照旧点三样
    expect(sectionInfo(none, '到东港').note.short).toMatch(/^\d+ 样是示意；平地抹平；/);
    expect(sectionInfo(routeWith(), '到东港').note.short).toMatch(/^示例五年溪口到东港的水路、南溪、新渠等 7 样是示意；/);
    // 头一节（全程）照旧：explain 点到的在前
    const whole = routeWith((s) => (s.sections[0].explain = ['j-pass']));
    expect(sectionInfo(whole, '全程').note.lines[0]).toMatch(/^示例四年示例城到南山口的水路、/);
  });

  it('“还有”后面的名字是数字打头的，前面空一格；别的名字不空', () => {
    // 全程那一节照 explain 的先后：点到的一趟路里只有一部分示意的那一截，接在“还有”后面
    const digits = routeWith((s) => {
      s.sections[0].explain = ['j-port'];
      s.roads.journeys[2].parts[0].name = '1097 年南山口到溪口的路';
      s.roads.journeys[2].parts[0].unsure = '过山的山口';
    });
    expect(sectionInfo(digits, '全程').note.lines[0]).toContain('，还有 1097 年南山口到溪口的路的过山的山口，');
    const words = routeWith((s) => {
      s.sections[0].explain = ['j-port'];
      s.roads.journeys[2].parts[0].unsure = '过山的山口';
    });
    expect(sectionInfo(words, '全程').note.lines[0]).toContain('，还有示例五年南山口到溪口的路的过山的山口，');
  });

  it('展开的说明：一趟路各截的 note 按先后，裁掉的角、抹成海的地方、没有画的东西（用 why）、地形，都印；同一句话只印一遍', () => {
    expect(sectionInfo(routeWith(), '到东港').note.lines.slice(2, -1)).toEqual([
      '溪口到东港的路只知道两头，画成虚线。',
      '镜湖的西南角当时还是陆地，裁掉了。',
      '东边的一小块陆地是后来才有的，抹成了海。',
      '今天的水库当时没有，沙盘上没有画。',
      '山的位置和形状是今天的。',
    ]);
    // 两截都写了 note：照先后各印一句；两截写的是同一句话：只印一遍
    const both = routeWith((s) => (s.roads.journeys[2].parts[0].note = '南山口到溪口要翻山。'));
    expect(sectionInfo(both, '到东港').note.lines.slice(2, 4)).toEqual(['南山口到溪口要翻山。', '溪口到东港的路只知道两头，画成虚线。']);
    const same = routeWith((s) => (s.roads.journeys[2].parts[0].note = s.roads.journeys[2].parts[1].note));
    expect(sectionInfo(same, '到东港').note.lines).toHaveLength(8);
    // 后一节再点前面的一趟路、海面、海岸：也照点的先后印
    const again = routeWith((s) => s.sections[3].explain.push('j-pass', 'levels', 'coast'));
    expect(sectionInfo(again, '到东港').note.lines.slice(-4, -1)).toEqual(['到南山口的路只知道两头，画成虚线。', '海面是一个平面。海岸、湖和河是照线画上去的。', '海岸是照今天画的，当时差多少没有查。']);
  });

  it('远处：这一节的题签指到了才有；题签没写 at 的量不了，跳过去', () => {
    expect(sectionInfo(routeWith(), '到南山口').far).toEqual([]);
    const moved = routeWith((s) => (s.strips.find((strip) => strip.id === 's-far')!.at = [112, 31.4]));
    expect(sectionInfo(moved, '到示例城').far[0].say).toBe('往北约 11 公里（今北都市）');
    const bare = routeWith((s) => delete s.strips.find((strip) => strip.id === 's-far')!.at);
    expect(sectionInfo(bare, '到示例城').far).toEqual([]);
  });

  it('recipe 没有写 note 时（校验不让这样），地形修整过这一句也不缺；没有这一小节就报错；不改传进来的场景', () => {
    expect(sectionInfo(routeWith((s) => delete s.terrain.recipe.note), '全程').note.lines[1]).toBe('平地抹平了，山照原样。');
    expect(() => sectionInfo(routeWith(), '到北都')).toThrow('没有“到北都”这一小节');
    const scene = routeWith();
    for (const heading of sectionHeadings(scene)) sectionInfo(scene, heading);
    expect(scene).toEqual(routeWith());
  });
});

describe('全程沙盘：凭据里“沙盘上的东西”（sceneRegister）', () => {
  it('海面、海岸、从湖面里裁掉的角各是一项；一趟路的每一截是一项，id 是“这一趟/第几截”；出处用场景自己的 sources', () => {
    const scene = routeWith();
    const register = sceneRegister(scene, scene.sources);
    expect(register.groups.map((group) => `${group.label}：${group.entries.map((entry) => entry.id).join(' ')}`)).toEqual([
      '真的：terrain p-ridge',
      '今天的位置：levels coast long mirror p-river p-pass p-port far-north',
      '按正文摆的：j-river/1 j-port/1',
      '示意的：recipe sea-east south-stream cut mirror-sw marsh j-pass/1 j-port/2',
      '点缀：',
    ]);
    const names = new Map(register.groups.flatMap((group) => group.entries.map((entry) => [entry.id, entry.name] as const)));
    expect(names.get('levels')).toBe('海面');
    expect(names.get('coast')).toBe('海岸');
    expect(names.get('j-port/2')).toBe('示例五年溪口到东港的水路');
    const part = register.groups[3].entries.find((entry) => entry.id === 'j-port/2')!;
    expect(part.unsure).toBe('路线');
    expect(part.basis).toBe(scene.roads.journeys[2].parts[1].basis);
    const river = register.groups[2].entries[0];
    expect(river.cites).toEqual(scene.roads.journeys[0].parts[0].sourceIds.map((id) => scene.sources.find((source) => source.id === id)!.cite));
    expect(river.cites.length).toBeGreaterThan(0);
    expect(register.notDrawn.map((item) => item.name)).toEqual(['水库']);
    expect(register.credits).toEqual(scene.credits);
  });
});

// ---------------------------------------------------------------- content/ 里真实的场景
// 上面用的是假的小沙盘。这里把 content/ 里每个真的场景文件都过一遍：每一节都拼得出说明，每条题签都指得到一个点。
// 站点沙盘和全程沙盘（写着 "level": "route" 的）都在里面；两层说法不一样的三处照各自的查。
// 全程沙盘的镜头、题签摆不摆得下、说明印没印全，另有 tests/stage/route-views.test.ts。

const BOM = String.fromCharCode(0xfeff);
const parse = <T>(raw: string): T => JSON.parse(raw.startsWith(BOM) ? raw.slice(1) : raw) as T;
const sceneTexts = import.meta.glob<string>('/content/figures/*/scenes/*.json', { query: '?raw', import: 'default', eager: true });
const stopTexts = import.meta.glob<string>('/content/figures/*/stops/*.json', { query: '?raw', import: 'default', eager: true });
const realScenes = Object.entries(sceneTexts).map(([path, raw]) => ({ path, scene: parse<TableScene>(raw) }));

/** 两层的沙盘说法不一样的三处：地形修整了哪里（一句话里的），第四样（一句话里的两种、展开的那一句里的）。 */
function wordsOf(scene: TableScene): { recipe: string; short: string; brief: string; full: string } {
  return scene.level === 'route'
    ? { recipe: '平地抹平', short: '河和路都画宽了', brief: '河画宽了', full: '河和路都画宽了，不按比例。' }
    : { recipe: '平地修整过', short: '模型和河都放大了', brief: '模型和河放大了', full: '都放大了' };
}

describe('content/ 里真实的场景', () => {
  it('至少有一个场景文件；两层的沙盘都有', () => {
    expect(realScenes.filter(({ scene }) => scene.level !== 'route').length).toBeGreaterThan(0);
    expect(realScenes.filter(({ scene }) => scene.level === 'route').length).toBeGreaterThan(0);
  });

  it('每一节都拼得出说明，四样都在；题记和时间是场景里写的', () => {
    for (const { path, scene } of realScenes) {
      const words = wordsOf(scene);
      for (const section of scene.sections) {
        const info = sectionInfo(scene, section.heading);
        const label = `${path} 小节“${section.heading}”`;
        expect(info, label).toMatchObject({ section: section.heading, date: section.date, line: section.line });
        expect(info.note.lines.length, label).toBeGreaterThanOrEqual(3);
        expect(info.note.lines[0], label).toMatch(/是示意。$|没有归在示意一类的。$/);
        expect(info.note.lines[1], label).toBe(scene.terrain.recipe.note);
        expect(info.note.lines[info.note.lines.length - 1], label).toContain(reliefSay(scene.frame.relief).full);
        expect(info.note.lines[info.note.lines.length - 1], label).toContain(words.full);
        expect(info.note.short, label).toContain(`；${words.recipe}；`);
        expect(info.note.short, label).toContain(reliefSay(scene.frame.relief).short);
        expect(info.note.short.endsWith(`；${words.short}`), label).toBe(true);
        expect(info.note.short, label).not.toContain('\n');
        // 沙盘旁边给这一句留的地方是定死的：栏宽时两行，栏窄时一行。超了就会被截掉。
        expect(info.note.short.length, label).toBeLessThanOrEqual(NOTE_SHORT_MAX);
        expect(info.note.brief, label).toContain(`是示意；${words.recipe}；`);
        expect(info.note.brief, label).toContain(reliefSay(scene.frame.relief).short);
        expect(info.note.brief.endsWith(`；${words.brief}`), label).toBe(true);
        expect(info.note.brief.length, label).toBeLessThanOrEqual(NOTE_BRIEF_MAX);
        // explain 里点到的每一样，它的那句话都在展开的说明里（全程沙盘上点到一趟路，是它的每一截各一句）。
        const journeys = scene.level === 'route' ? scene.roads.journeys : [];
        const most = section.explain.reduce((sum, id) => sum + (journeys.find((journey) => journey.id === id)?.parts.length ?? 1), 0);
        expect(info.note.lines.length, label).toBeLessThanOrEqual(most + 3);
        for (const far of info.far) expect(far.say, label).toMatch(/^往(东|南|西|北|东南|西南|东北|西北)约 \d+ 公里/);
      }
    }
  });

  it('每一节的每条题签都有字，都指得到沙盘里面或者边上的一个点', () => {
    for (const { path, scene } of realScenes) {
      // 站点沙盘：照原点的纬度另算一遍（不用程序里的换算）。全程沙盘：圆锥投影，用 sceneGeoRoute 的换算，量的是沙盘里的米
      const frame = scene.frame;
      const kx = 111320 * Math.cos((frame.center[1] * Math.PI) / 180);
      const scale = scene.level === 'route' ? scene.frame.scale : 1;
      const local = scene.level === 'route' ? coordsOf(scene).toLocal : ([lng, lat]: LngLat): [number, number] => [(lng - frame.center[0]) * kx, -(lat - frame.center[1]) * 110950];
      for (const section of scene.sections) {
        const texts = stripTexts(scene, section.heading, 'ancient');
        expect(texts.map((t) => t.id), `${path} 小节“${section.heading}”`).toEqual(section.strips);
        expect(stripTexts(scene, section.heading, 'modern').map((t) => t.id)).toEqual(section.strips);
        for (const { id, text } of texts) {
          const strip = scene.strips.find((s) => s.id === id);
          expect(text).not.toBe('');
          if (!strip) continue;
          const [x, z] = local(stripPoint(scene, strip));
          const label = `${path} 题签“${id}”（${text}）`;
          // 指着远处的摆在边上，算出来的点可能差出去一丁点，放宽 1 米。
          expect(x, label).toBeGreaterThanOrEqual(-frame.westM / scale - 1);
          expect(x, label).toBeLessThanOrEqual(frame.eastM / scale + 1);
          expect(z, label).toBeGreaterThanOrEqual(-frame.northM / scale - 1);
          expect(z, label).toBeLessThanOrEqual(frame.southM / scale + 1);
        }
      }
    }
  });

  it('全程沙盘：是站的地名点，它的题签带着这几站，古名今名都一样；看路的一节里到的这一站一定带着；头一节里每一站都带着', () => {
    for (const { path, scene } of realScenes) {
      if (scene.level !== 'route') continue;
      const stops = scene.sections.flatMap((section) => (section.stop ? [section.stop] : []));
      expect(stops.length, path).toBeGreaterThan(0);
      for (const section of scene.sections) {
        for (const names of ['ancient', 'modern'] as const) {
          for (const strip of stripTexts(scene, section.heading, names)) {
            const place = scene.places.find((item) => item.id === scene.strips.find((s) => s.id === strip.id)?.of);
            expect(strip.stops, `${path} ${section.heading} ${strip.id}`).toEqual(place?.stops);
            if (strip.stops) expect(strip.tone).toBe('place');
          }
        }
        if (section.stop) expect(stripTexts(scene, section.heading, 'ancient').flatMap((strip) => strip.stops ?? []), `${path} ${section.heading}`).toContain(section.stop);
      }
      const first = stripTexts(scene, scene.sections[0].heading, 'ancient').flatMap((strip) => strip.stops ?? []);
      expect([...new Set(first)].sort(), path).toEqual([...stops].sort());
    }
  });

  it('凭据里的一栏：带类别和依据的东西一样不少，出处都对得出写法', () => {
    for (const { path, scene } of realScenes) {
      const stopPath = path.replace('/scenes/', '/stops/');
      const sources = scene.level === 'route' ? scene.sources : parse<{ sources: Source[] }>(stopTexts[stopPath]).sources;
      const register = sceneRegister(scene, sources);
      const listed = register.groups.reduce((sum, group) => sum + group.entries.length, 0);
      // 站点沙盘：地形、整理、水位、河岸的规矩四样，加上各样东西。
      // 全程沙盘：地形、整理、海面、海岸四样，加上各样东西；从湖面里裁掉的角、一趟路的每一截各一项。
      const expected =
        scene.level === 'route'
          ? 4 +
            scene.terrain.edits.length +
            scene.water.rivers.length +
            scene.water.lakes.length +
            scene.water.lakes.filter((lake) => lake.except).length +
            scene.water.washes.length +
            scene.places.length +
            scene.far.length +
            scene.roads.journeys.reduce((sum, journey) => sum + journey.parts.length, 0)
          : 4 + scene.terrain.edits.length + scene.water.rivers.length + scene.water.rapids.length + scene.water.dry.length + scene.places.length + scene.things.length + scene.dressing.length + scene.far.length;
      expect(listed, path).toBe(expected);
      for (const group of register.groups) {
        for (const entry of group.entries) {
          expect(entry.name, `${path} ${entry.id}`).not.toBe('');
          expect(entry.basis, `${path} ${entry.id}`).not.toBe('');
        }
      }
      // 全程沙盘的出处在场景文件自己的 sources 里：真的、今天的位置、按正文摆的三类，每一项都对得出至少一条写法
      if (scene.level === 'route') {
        for (const group of register.groups.slice(0, 3)) for (const entry of group.entries) expect(entry.cites.length, `${path} ${entry.id}`).toBeGreaterThan(0);
      }
      expect(register.notDrawn).toHaveLength(scene.notDrawn.length);
      expect(register.credits).toEqual(scene.credits);
    }
  });
});

// 另一种题签（平着的纸条）在那一座编出来的全程沙盘上（./support/madeUpRoute.ts，样式是 ./support/madeUpStyle.ts 的 'made-up-lines'）。
// content/ 里没有一座沙盘用这一种：每一条新路都先在这里跑一遍。在 Node 里跑，不要浏览器。
//   题签是哪一种，从样式那一行来：编出来的那一行写了 slip；登记表里的每一行是它自己写的那一种（没有写的是 strip），表里没有的名字是 strip；没有谁认样式的名字；
//   取那一小块程序的地方（src/stage/index.ts 的 labelsFor）：竖着的纸条的沙盘不取，平着的纸条的沙盘取；取不到就拒绝，再叫一次再取一次；
//     ——这是在 Node 里查取的那一处，不是在浏览器里看请求：编出来的样式不在登记表里，页面上摆不出一座写着它的沙盘；
//   摆法（placeSlips）：先右后左，离那一点 14 像素；没有点的名字正中摆在写的地方，摆不下绕着找，再摆不下不摆、缘故是 area，
//     它不为自己挪别的纸条，手还按着的时候也不替它挑；给了地面的四个角就摆在里面（四个角都算），出了边的先横着推回来；远处的题签不查；
//     “让开小像”的那一个靠它身上的记号认，别的摆法一律换成平着的纸条的；
//   题签层照它造、照它摆：没有点的名字没有圆点、没有引线，摆不下也没有空心的圈；地面的四个角经过这一层到摆法手里；
//   几处接头：取沙盘程序的两处（loadStageEngine、loadStillEngine）把那一小块记在容器上，挂在那里的一层就是平着的纸条——
//     立体的沙盘那一处等那一小块到了才交出沙盘程序；定格图那一处不等（图片先放，那一小块到了才记在容器上、才挂题签层；没取到由摆出来的那一座说，
//     见 tests/unit/still-fit.test.ts 里“题签晚到”的几条，沙盘栏怎么接在 tests/unit/page/slip-stills-pane.test.tsx）
//     （沙盘栏把样式交到这两处，在 tests/unit/page/label-style-wire.test.tsx 里查；沙盘程序每一帧交四个角，在 route-view.test.ts 和 still-fit.test.ts 里）；
//   数一遍（验收时报给负责人的数）：这一座沙盘的每一节，在每一种标准的沙盘栏和竖着拿的各种平板上，摆下几条、最长的引线、出了地面的边的有几条；
//   同一个画面照竖着的纸条摆一遍（比一比用的）。

import { PerspectiveCamera } from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { NamesMode, RouteSection, SceneStrip } from '../../src/domain/scene';
import { stripTexts } from '../../src/domain/sceneText';
import { stopMarks } from '../../src/domain/stopMarks';
import type { Figure } from '../../src/domain/types';
import { labelsFor, loadStageEngine, loadStillEngine, stillEngine } from '../../src/stage';
import { labelsIn, mountStrips, placeStrips, sectionStripSpecs } from '../../src/stage/overlay';
import type { LabelKitMaker, StripInput, StripPlacement, StripPlacer } from '../../src/stage/overlay';
import { PIECE_NAME, aroundPiece } from '../../src/stage/overlay/placeAround';
import { AREA_REACH_PX, GROUND_INSET_PX, SLIP_GAP, SLIP_SIDES, placeSlips, slipKit, stillGround } from '../../src/stage/overlay/slips';
import { STYLES, labelKind } from '../../src/stage/styles';
import { centreShift, equivalentDistance, groundCorners, placeCamera, screenAnchors } from '../../src/stage/three/rig';
import type { StageEngine, StageInsets, StageOptions, StageTable, StopStageView } from '../../src/stage/types';
import { checkRouteScene, checkRouteShape } from '../content/routeRules';
import { readBytes } from '../support/readBytes';
import { MADE_UP_FOLDER, MADE_UP_STOPS, madeUpFiles, madeUpRoute, madeUpScene } from './support/madeUpRoute';
import { MADE_UP_STYLES, MADE_UP_STYLE_ID, style } from './support/madeUpStyle';
import { realRouteScene, realScene, realSceneKeys } from './support/realScenes';
import { HOME_PANES, ROUTE_PANES, ROUTE_UPRIGHT_PANES, STANDARD_PANES, UPRIGHT_PANES } from './support/standardPanes';
import { isAreaName, routeSectionStrips, slipSize, stripSizeKind } from './support/stripSizes';

interface Pane {
  name: string;
  size: { width: number; height: number };
  insets: StageInsets;
}

const NAMES: NamesMode[] = ['ancient', 'modern'];
/** 这座编出来的沙盘的题签是哪一种：照它的样式，从编出来的那张单子查（和页面查登记表是同一个函数）。 */
const LABELS = labelKind(madeUpRoute().scene.style, MADE_UP_STYLES);
const figure = JSON.parse(new TextDecoder().decode(readBytes(`${MADE_UP_FOLDER}/figure.json`))) as Figure;
const MARKS = stopMarks(figure, (id) => `#/${figure.id}/${id}`);

/** 一节在一种沙盘栏上：题签指着的点，和地面的四个角（海面那么高）落在画面的哪里——都是照沙盘程序摆镜头、投点的那一套算的。 */
function seenOn(section: RouteSection, pane: Pane): { anchors: StripInput['anchors']; ground: { x: number; y: number }[] } {
  const { scene, coords, samplers } = madeUpRoute();
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
  // 地面的四个角：沙盘程序每一帧交给题签层的就是这个函数算的（src/stage/three/view.ts 的 drawFrame）
  const ground = groundCorners(coords, camera, pane.size);
  if (!ground) throw new Error(`${section.heading} 在 ${pane.name} 上：地面有一个角在镜头背后`);
  return { anchors: screenAnchors(written, scene, samplers, coords, style, D, camera, pane.size), ground };
}

/** 一节在一种沙盘栏上交给摆法的那一份。labels 是照哪一种题签算大小（不写就是这座沙盘自己的那一种）。 */
function inputFor(section: RouteSection, pane: Pane, names: NamesMode, labels = LABELS): StripInput {
  const { anchors, ground } = seenOn(section, pane);
  return { strips: routeSectionStrips(madeUpRoute().scene, section.heading, pane.size.width, names, labels), anchors, size: pane.size, insets: pane.insets, ground };
}

const leaderPx = (p: StripPlacement): number => (p.leader ? Math.hypot(p.leader[2] - p.leader[0], p.leader[3] - p.leader[1]) : 0);

/** 一点离四个角围成的那一块的边（朝里量）最近多少像素；在外面是负的。 */
function insideBy(p: { x: number; y: number }, ground: { x: number; y: number }[]): number {
  let twice = 0;
  ground.forEach((a, i) => {
    const b = ground[(i + 1) % ground.length];
    twice += a.x * b.y - b.x * a.y;
  });
  const turn = Math.sign(twice);
  return Math.min(
    ...ground.map((a, i) => {
      const b = ground[(i + 1) % ground.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      return (((p.x - a.x) * -(b.y - a.y) + (p.y - a.y) * (b.x - a.x)) / length) * turn;
    }),
  );
}

/** 摆出来的一条纸条的四个角里，离地面的边最近的那一个离多少像素（在外面是负的）。 */
function slipInsideBy(p: StripPlacement, s: { w: number; h: number }, ground: { x: number; y: number }[]): number {
  return Math.min(
    ...[
      [p.x - s.w / 2, p.y - s.h / 2],
      [p.x + s.w / 2, p.y - s.h / 2],
      [p.x + s.w / 2, p.y + s.h / 2],
      [p.x - s.w / 2, p.y + s.h / 2],
    ].map(([x, y]) => insideBy({ x, y }, ground)),
  );
}

describe('题签是哪一种，从样式那一行来', () => {
  // 2026-11-27 以前这一条的名字是“编出来的那一行写了 slip；登记表里的每一行都没有写，是 strip；表里没有的名字、没有给名字，也是 strip”：
  // 那时候登记表里只有宋代青绿设色一行。登记表里有了写 slip 的一行（彩绘地形模型）以后，查的是“每一行是它自己写的那一种”，
  // 原来那一行（什么也没有添）和 content/ 里原来的四座沙盘照旧是 strip。
  it('编出来的那一行写了 slip；登记表里的每一行是它自己写的那一种，没有写的是 strip（宋代青绿设色没有写，彩绘地形模型写了 slip）；表里没有的名字、没有给名字，也是 strip；content/ 里的每一座沙盘是它的样式那一行说的那一种', () => {
    expect(LABELS).toBe('slip');
    expect(MADE_UP_STYLES.map((row) => row.labels)).toEqual(['slip']);
    // 登记表里：写了 labels 的一行是它写的那一种，没有写的是 strip
    for (const row of STYLES) expect(labelKind(row.id), row.id).toBe(row.labels ?? 'strip');
    // 现在的两行：宋代青绿设色什么也没有添（没有 labels 这个字段），彩绘地形模型写了 slip
    expect(STYLES.map((row) => [row.id, 'labels' in row ? row.labels : '没有写'])).toEqual([
      ['song-qinglv', '没有写'],
      ['painted-relief', 'slip'],
    ]);
    // 编出来的名字不在登记表里：照登记表查它是 strip（读者的构建里没有这一行）
    expect(labelKind(MADE_UP_STYLE_ID)).toBe('strip');
    expect(labelKind('没有这种样式', MADE_UP_STYLES)).toBe('strip');
    expect(labelKind(undefined, MADE_UP_STYLES)).toBe('strip');
    // content/ 里的每一座沙盘：它的样式那一行说的那一种——苏轼的四座是竖着的纸条，歌德的全程沙盘是平着的纸条。
    // 只读场景文件里写的样式，不造地面（造一座要一秒多）
    const keys = [...realSceneKeys(), ...realSceneKeys('route')];
    expect(keys.length).toBeGreaterThanOrEqual(4);
    const kinds: Record<string, string> = {};
    for (const key of keys) {
      const [figureId, name] = key.split('/');
      const written = JSON.parse(new TextDecoder().decode(readBytes(`content/figures/${figureId}/scenes/${name}.json`))) as { style?: string };
      expect(typeof written.style, key).toBe('string');
      expect(labelKind(written.style), key).toBe(STYLES.find((row) => row.id === written.style)?.labels ?? 'strip');
      kinds[key] = labelKind(written.style);
    }
    expect(kinds).toEqual({ 'su-shi/huangzhou': 'strip', 'su-shi/meishan': 'strip', 'su-shi/xuzhou': 'strip', 'su-shi/route': 'strip', 'goethe/route': 'slip' });
  });

  it('认的是那一行上写的，不是样式的名字：同一个名字的一行，写了就是 slip，不写就是 strip', () => {
    const [row] = MADE_UP_STYLES;
    const { labels: _labels, ...plain } = row;
    expect(labelKind(row.id, [plain])).toBe('strip');
    expect(labelKind(row.id, [{ ...plain, labels: 'slip' }])).toBe('slip');
    expect(labelKind('song-qinglv', [{ ...plain, id: 'song-qinglv', labels: 'slip' }])).toBe('slip');
  });
});

describe('“这个名字没有点”：场景里地名点的 area', () => {
  /** 校验这座编出来的沙盘（改过一处的也行）：说的话。 */
  function words(change: (scene: ReturnType<typeof madeUpScene>) => void = () => {}): string[] {
    const scene = madeUpScene();
    change(scene);
    const { file, files, sizes } = madeUpFiles(scene);
    const shape = checkRouteShape(JSON.parse(JSON.stringify(scene)), file);
    return (shape.length > 0 ? shape : checkRouteScene(scene, file, { stops: [...MADE_UP_STOPS] }, files, sizes, [MADE_UP_STYLE_ID])).map((v) => `${v.rule} ${v.field}：${v.problem}`);
  }
  const massif = (scene: ReturnType<typeof madeUpScene>) => {
    const index = scene.places.findIndex((place) => place.id === 'p-massif');
    return { index, place: scene.places[index] };
  };

  it('页面拼的那一份题签（stripTexts）：地名点写了 area 的那一条带着 area，别的一条也不带——指着海的也不带（它算不算没有点，是题签那一种定的）', () => {
    const { scene, headings } = madeUpRoute();
    expect(scene.places.filter((place) => place.area).map((place) => place.name)).toEqual(['西岭']);
    for (const heading of headings) {
      for (const names of NAMES) {
        const texts = stripTexts(scene, heading, names);
        expect(texts.filter((t) => t.area).map((t) => t.id), heading).toEqual(texts.some((t) => t.id === 's-massif') ? ['s-massif'] : []);
        for (const t of texts) if (t.id !== 's-massif') expect('area' in t, `${heading} ${t.id}`).toBe(false);
      }
    }
    // 题签层拿到的那一份：写了 area 的那一条，和指着海的那一条
    const specs = sectionStripSpecs(scene, headings[0], stripTexts(scene, headings[0], 'ancient'), MARKS);
    expect(specs.filter((spec) => spec.area).map((spec) => spec.text)).toEqual(['海', '西岭']);
  });

  // 2026-11-27 以前这一条的名字是“content/ 里的每一座沙盘：没有一个地名点写 area，页面拼的题签里没有一条带着它；题签层拿到的那一份里只有指着海的那一条
  // （竖着的纸条不看）”：那时候 content/ 里没有一个地名点写 area。有了写它的一座（歌德的全程沙盘，十三个）以后，查的是“带着它的正好是写了它的那几条”；
  // 站点沙盘和苏轼的全程沙盘照旧一条也不带。
  it('content/ 里的每一座沙盘：站点沙盘的题签没有一条带着 area；全程沙盘上，页面拼的题签里带着它的正好是地名点写了 area 的那几条，题签层拿到的那一份里另有指着海的那一条——苏轼的那一座没有一个地名点写 area，歌德的那一座写了十三个', { timeout: 60_000 }, () => {
    for (const key of realSceneKeys()) {
      const { scene, headings } = realScene(key);
      for (const heading of headings) for (const names of NAMES) expect(stripTexts(scene, heading, names).some((t) => 'area' in t), `${key} ${heading}`).toBe(false);
      for (const heading of headings) expect(sectionStripSpecs(scene, heading, stripTexts(scene, heading, 'ancient')).some((spec) => 'area' in spec), `${key} ${heading}`).toBe(false);
    }
    const written: Record<string, number> = {};
    for (const key of realSceneKeys('route')) {
      const { scene, headings } = realRouteScene(key);
      const areas = new Set(scene.places.filter((place) => place.area).map((place) => place.id));
      written[key] = areas.size;
      const of = (id: string): string => scene.strips.find((s) => s.id === id)?.of ?? '';
      for (const heading of headings) {
        for (const names of NAMES) {
          const texts = stripTexts(scene, heading, names);
          expect(texts.filter((t) => 'area' in t).map((t) => t.id), `${key} ${heading}`).toEqual(texts.filter((t) => areas.has(of(t.id))).map((t) => t.id));
          for (const t of texts) if ('area' in t) expect(t.area, `${key} ${heading} ${t.id}`).toBe(true);
        }
        const specs = sectionStripSpecs(scene, heading, stripTexts(scene, heading, 'ancient'));
        expect(specs.filter((spec) => spec.area).map((spec) => of(spec.id)), `${key} ${heading}`).toEqual(specs.map((spec) => of(spec.id)).filter((id) => id === 'coast' || areas.has(id)));
      }
    }
    expect(written).toEqual({ 'su-shi/route': 0, 'goethe/route': 13 });
  });

  it('规则 13：这一座（西岭写了 area）通得过；area 写成 false 通不过，说只能写 true；写了 area 又写 stops 通不过，说两样只能写一样；写成别的东西格式就通不过', () => {
    expect(words()).toEqual([]);
    expect(
      words((scene) => {
        (massif(scene).place as { area?: unknown }).area = false;
      }),
    ).toEqual([`13 places[${massif(madeUpScene()).index}].area：地名点“p-massif”的 area 只能写 true（这个名字指的是一片地方，没有点）；不要这个记号就不写这个字段`]);
    expect(
      words((scene) => {
        massif(scene).place.stops = ['jia'];
      }),
    ).toEqual([`13 places[${massif(madeUpScene()).index}].area：地名点“p-massif”写了 area（这个名字没有点），又写了 stops：一站是一个地方，它的题签要指着那一点；两样只能写一样`]);
    const wrong = words((scene) => {
      (massif(scene).place as { area?: unknown }).area = 'yes';
    });
    expect(wrong).toHaveLength(1);
    expect(wrong[0]).toContain(`places[${massif(madeUpScene()).index}].area`);
    // 不写：就是一个平常的地名点，照样通得过
    expect(
      words((scene) => {
        delete massif(scene).place.area;
      }),
    ).toEqual([]);
  });
});

/** 一个记着被叫了几次的假取法（取平着的纸条那一小块程序）。 */
const loader = (fail = 0): { load: () => Promise<{ slipKit: LabelKitMaker }>; calls: () => number } => {
  let calls = 0;
  return {
    load: () => {
      calls += 1;
      return calls <= fail ? Promise.reject(new Error('那一小块程序没有取到')) : Promise.resolve({ slipKit });
    },
    calls: () => calls,
  };
};

describe('取平着的纸条那一小块程序的地方（src/stage/index.ts 的 labelsFor）', () => {
  // 2026-11-27 以前这一条的名字是“竖着的纸条的沙盘不取：登记表里的每一种样式、表里没有的样式，交回的都是 undefined，取法一次也没有叫”：
  // 那时候登记表里的每一行都是竖着的纸条。现在照那一行写的分：没有写 slip 的不取（宋代青绿设色照旧），写了 slip 的取。
  it('竖着的纸条的沙盘不取：登记表里没有写 slip 的每一种样式、表里没有的样式，交回的都是 undefined，取法一次也没有叫；登记表里写了 slip 的样式取，一种叫一次', async () => {
    const fake = loader();
    const strips = STYLES.filter((row) => (row.labels ?? 'strip') === 'strip');
    expect(strips.map((row) => row.id)).toContain('song-qinglv');
    for (const row of strips) expect(labelsFor(row.id, STYLES, fake.load), row.id).toBeUndefined();
    expect(labelsFor('没有这种样式', MADE_UP_STYLES, fake.load)).toBeUndefined();
    expect(labelsFor(undefined, MADE_UP_STYLES, fake.load)).toBeUndefined();
    // 编出来的样式照读者的登记表查：表里没有它，不取
    expect(labelsFor(MADE_UP_STYLE_ID, STYLES, fake.load)).toBeUndefined();
    expect(fake.calls()).toBe(0);
    // 登记表里写了 slip 的每一种样式：取，交回来的是那一小块里造一层题签的那个函数
    const slips = STYLES.filter((row) => row.labels === 'slip');
    for (const row of slips) expect(await labelsFor(row.id, STYLES, fake.load), row.id).toBe(slipKit);
    expect(fake.calls()).toBe(slips.length);
  });

  it('平着的纸条的沙盘取：交回的是那一小块程序里造一层题签用的那一个函数，取法叫了一次', async () => {
    const fake = loader();
    const got = labelsFor(MADE_UP_STYLE_ID, MADE_UP_STYLES, fake.load);
    expect(got).toBeInstanceOf(Promise);
    expect(await got).toBe(slipKit);
    expect(fake.calls()).toBe(1);
  });

  it('没取到就拒绝（页面照“沙盘没能摆出来”办）；再叫一次就再取一次，这一回取到了', async () => {
    const fake = loader(1);
    await expect(labelsFor(MADE_UP_STYLE_ID, MADE_UP_STYLES, fake.load)).rejects.toThrow('那一小块程序没有取到');
    expect(await labelsFor(MADE_UP_STYLE_ID, MADE_UP_STYLES, fake.load)).toBe(slipKit);
    expect(fake.calls()).toBe(2);
  });

  it('真的那一块取得到（不交取法）：交出来的就是 slips.ts 的 slipKit', async () => {
    expect(await labelsFor(MADE_UP_STYLE_ID, MADE_UP_STYLES)).toBe(slipKit);
  });
});

describe('平着的纸条的摆法（placeSlips）', () => {
  const size = { width: 800, height: 600 };
  const insets: StageInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  const slip = (id: string, more: Partial<StripInput['strips'][number]> = {}): StripInput['strips'][number] => ({ id, w: 90, h: 28, rank: 0, ...more });
  const at = (id: string, x: number, y: number): StripInput['anchors'][number] => ({ id, x, y, visible: true });

  it('先试右边，再试左边，然后上边、下边；竖着的纸条的摆法先试上边', () => {
    expect(SLIP_SIDES).toEqual(['right', 'left', 'above', 'below']);
    const one: StripInput = { strips: [slip('a')], anchors: [at('a', 400, 300)], size, insets };
    const [right] = placeSlips(one);
    expect(right.hidden).toBe(false);
    // 在点的右边，上下对着点；引线是横的，从点到纸条的左边
    expect(right.x - 45).toBeGreaterThan(400);
    expect(right.y).toBe(300);
    expect(right.leader).toEqual([400, 300, right.x - 45, 300]);
    // 离那一点 14 像素（画面 800 宽的时候；竖着的纸条是 26）；画面窄了按比例收近，最多收到一半
    expect(SLIP_GAP).toBe(14);
    expect(right.x - 45 - 400).toBe(SLIP_GAP);
    const [close] = placeSlips({ ...one, anchors: [at('a', 100, 300)], size: { width: 400, height: 600 } });
    expect(close.x - 45 - 100).toBe(SLIP_GAP / 2);
    const [closest] = placeSlips({ ...one, anchors: [at('a', 100, 300)], size: { width: 300, height: 600 } });
    expect(closest.x - 45 - 100).toBe(SLIP_GAP / 2);
    // 右边没有地方（点挨着画面的右边）：摆在左边
    const [left] = placeSlips({ ...one, anchors: [at('a', 780, 300)] });
    expect(left.x + 45).toBeLessThan(780);
    expect(left.y).toBe(300);
    // 同一份交给竖着的纸条的摆法：它摆在点的上边
    const [above] = placeStrips(one);
    expect(above.x).toBe(400);
    expect(above.y).toBeLessThan(300);
    // 场景里写了想摆的那一边：先试那一边
    const [below] = placeSlips({ ...one, strips: [slip('a', { side: 'below' })] });
    expect(below.x).toBe(400);
    expect(below.y).toBeGreaterThan(300);
  });

  it('没有点的名字：正中摆在写的那个位置上，没有引线；那个位置不算一个点，别的纸条可以压过去', () => {
    const input: StripInput = { strips: [slip('town'), slip('range', { rank: 1, area: true })], anchors: [at('town', 300, 300), at('range', 500, 200)], size, insets };
    const [town, range] = placeSlips(input);
    expect(range).toEqual({ id: 'range', x: 500, y: 200, hidden: false, leader: null, slot: 0 });
    expect(town.leader).not.toBeNull();
    // 镇的纸条想站的地方正好盖着“山脉”写的那个位置：有点的名字的话它得躲开那一点，没有点的名字不拦它
    const crowded: StripInput = { strips: [slip('town'), slip('range', { rank: 1, area: true })], anchors: [at('town', 300, 300), at('range', 360, 300)], size, insets };
    const [first, second] = placeSlips(crowded);
    expect(first.x - 45).toBeLessThan(360);
    expect(first.x + 45).toBeGreaterThan(360);
    expect(first.y).toBe(300);
    // “山脉”自己让开镇的纸条：绕着写的那个位置找，离它不超过 AREA_REACH_PX
    expect(second.hidden).toBe(false);
    expect(second.leader).toBeNull();
    expect(Math.hypot(second.x - 360, second.y - 300)).toBeLessThanOrEqual(AREA_REACH_PX);
    expect(Math.hypot(second.x - 360, second.y - 300)).toBeGreaterThan(0);
    // 不交 area：同一份照有点的名字摆——有引线，镇的纸条躲开那一点
    const pointed = placeSlips({ ...crowded, strips: [slip('town'), slip('range', { rank: 1 })] });
    expect(pointed[1].leader).not.toBeNull();
    expect(pointed[0].x - 45 >= 366 || pointed[0].x + 45 <= 354 || pointed[0].y !== 300).toBe(true);
  });

  it('没有点的名字摆不下：不摆，缘故是 area（不是 room）——题签层什么也不画；手还按着的时候也不替它挑', () => {
    // 四周都是别的纸条的点和纸条：写的那个位置和绕着它的每一圈都摆不下
    const strips = [slip('a'), slip('b', { rank: 1 }), slip('c', { rank: 2 }), slip('d', { rank: 3 }), slip('range', { rank: 9, area: true, w: 300, h: 120 })];
    const anchors = [at('a', 300, 250), at('b', 300, 350), at('c', 500, 250), at('d', 500, 350), at('range', 400, 300)];
    const result = placeSlips({ strips, anchors, size, insets });
    expect(result.slice(0, 4).map((p) => p.hidden)).toEqual([false, false, false, false]);
    expect(result[4]).toEqual({ id: 'range', x: 400, y: 300, hidden: true, leader: null, why: 'area' });
    expect(placeSlips({ strips, anchors, size, insets }, result, { moving: true })[4].why).toBe('area');
    // 手还按着的时候，周围空出来了也不替它挑（和摆不下的有点的名字一样，等手放开）；手放开以后的那一次才摆上
    const roomy = [at('a', 100, 100), at('b', 100, 200), at('c', 700, 100), at('d', 700, 200), at('range', 400, 400)];
    const held = placeSlips({ strips, anchors: roomy, size, insets }, result, { moving: true });
    expect(held[4]).toEqual({ id: 'range', x: 400, y: 400, hidden: true, leader: null, why: 'area' });
    const released = placeSlips({ strips, anchors: roomy, size, insets }, held);
    expect(released[4]).toEqual({ id: 'range', x: 400, y: 400, hidden: false, leader: null, slot: 0 });
  });

  it('没有点的名字不为自己去挪别的纸条：别的纸条换一个位置它就摆得下，也不换——它不摆（缘故是 area）', () => {
    const range = slip('range', { rank: 1, area: true, w: 200, h: 100 });
    const anchors = [at('town', 300, 300), at('range', 420, 300)];
    const [town, hidden] = placeSlips({ strips: [slip('town'), range], anchors, size, insets });
    // 镇的纸条照它自己的规矩站在点的右边，同没有“山脉”的时候一个数不差
    expect(town).toEqual(placeSlips({ strips: [slip('town')], anchors: [at('town', 300, 300)], size, insets })[0]);
    expect(town.x - 45).toBeGreaterThan(300);
    expect(hidden).toEqual({ id: 'range', x: 420, y: 300, hidden: true, leader: null, why: 'area' });
    // 镇的纸条要是站在左边，“山脉”就摆得下：上面看的确实是“不挪”，不是“挪了也没有用”
    const [left, shown] = placeSlips({ strips: [slip('town', { side: 'left' }), range], anchors, size, insets });
    expect(left.x + 45).toBeLessThan(300);
    expect(shown).toEqual({ id: 'range', x: 420, y: 300, hidden: false, leader: null, slot: 0 });
    // 同一份里“山脉”要是有点的名字（不写 area）：摆的规矩许它挪别的，它自己也有四边可站——摆得出来
    expect(placeSlips({ strips: [slip('town'), { ...range, area: undefined }], anchors, size, insets })[1].hidden).toBe(false);
  });

  it(`给了地面的四个角：纸条的四个角都在那一块里面，离边至少 ${GROUND_INSET_PX} 像素——本来要出去的被推了回来；不给就不查`, () => {
    // 地面是一块斜的四边形（上窄下宽，同斜着看一块沙盘一样）；点挨着它的右边
    const ground = [
      { x: 250, y: 150 },
      { x: 550, y: 150 },
      { x: 650, y: 450 },
      { x: 150, y: 450 },
    ];
    const input: StripInput = { strips: [slip('a')], anchors: [at('a', 560, 300)], size, insets };
    const [free] = placeSlips(input);
    // 不给四个角：摆在右边，出了地面的边
    expect(free.x).toBeGreaterThan(560);
    expect(slipInsideBy(free, input.strips[0], ground)).toBeLessThan(0);
    const [held] = placeSlips({ ...input, ground });
    expect(held.hidden).toBe(false);
    expect(slipInsideBy(held, input.strips[0], ground)).toBeGreaterThanOrEqual(GROUND_INSET_PX);
    // 没有点的名字也一样：写的那个位置挨着边，纸条摆在里面
    const range: StripInput = { strips: [slip('range', { area: true })], anchors: [at('range', 590, 400)], size, insets, ground };
    const [moved] = placeSlips(range);
    expect(moved.hidden).toBe(false);
    expect(slipInsideBy(moved, range.strips[0], ground)).toBeGreaterThanOrEqual(GROUND_INSET_PX);
    expect(slipInsideBy({ ...moved, x: 590, y: 400 }, range.strips[0], ground)).toBeLessThan(GROUND_INSET_PX);
    // 竖着的纸条的摆法不看四个角：给不给一个数不差
    expect(placeStrips({ ...input, ground })).toEqual(placeStrips(input));
    // 四个角都算，下面的两个也算：写的位置上面两个角在里面、下面两个角出了地面的底边的，往上挪进来
    const low: StripInput = { strips: [slip('range', { area: true })], anchors: [at('range', 400, 440)], size, insets, ground };
    expect(insideBy({ x: 355, y: 426 }, ground)).toBeGreaterThanOrEqual(GROUND_INSET_PX);
    expect(insideBy({ x: 445, y: 426 }, ground)).toBeGreaterThanOrEqual(GROUND_INSET_PX);
    expect(insideBy({ x: 355, y: 454 }, ground)).toBeLessThan(0);
    const [lifted] = placeSlips(low);
    expect(lifted.hidden).toBe(false);
    expect(lifted.y).toBeLessThan(440);
    expect(slipInsideBy(lifted, low.strips[0], ground)).toBeGreaterThanOrEqual(GROUND_INSET_PX);
    // 有点的名字也是：点在底边上面一点，写了要站在点的下边——那里下面两个角出了底边，换到别的位置，四个角都在里面
    const under: StripInput = { strips: [slip('a', { side: 'below' })], anchors: [at('a', 400, 425)], size, insets };
    const [below] = placeSlips(under);
    expect(below.y).toBeGreaterThan(425);
    expect(slipInsideBy(below, under.strips[0], ground)).toBeLessThan(GROUND_INSET_PX);
    const [inside] = placeSlips({ ...under, ground });
    expect(inside.hidden).toBe(false);
    expect(slipInsideBy(inside, under.strips[0], ground)).toBeGreaterThanOrEqual(GROUND_INSET_PX);
  });

  it('出了地面的边的位置先横着推回来（朝地面的中间）：横着推得回来的，不竖着推', () => {
    // 右边是一条斜边（越往下越靠右）。点右边的那个位置出了边 1 像素不到：往左推 6 像素进得来，往下推 10 像素也进得来——取横着的
    const ground = [
      { x: 200, y: 100 },
      { x: 500, y: 100 },
      { x: 700, y: 500 },
      { x: 100, y: 500 },
    ];
    const input: StripInput = { strips: [slip('a', { w: 60 })], anchors: [at('a', 470, 200)], size, insets };
    const [free] = placeSlips(input);
    expect([free.x, free.y]).toEqual([470 + SLIP_GAP + 30, 200]);
    expect(slipInsideBy(free, input.strips[0], ground)).toBeLessThan(GROUND_INSET_PX);
    // 竖着推也进得来（所以下面看的是先后）：同一个位置往下 10 像素，四个角都在里面
    expect(slipInsideBy({ ...free, y: free.y + 10 }, input.strips[0], ground)).toBeGreaterThanOrEqual(GROUND_INSET_PX);
    const [held] = placeSlips({ ...input, ground });
    expect(held.hidden).toBe(false);
    expect(held.slot).toBe(free.slot);
    expect([held.x, held.y]).toEqual([free.x - 6, 200]);
    expect(slipInsideBy(held, input.strips[0], ground)).toBeGreaterThanOrEqual(GROUND_INSET_PX);
    // 少推一步（4 像素）还在外面：推的是刚好进来的那一步
    expect(slipInsideBy({ ...held, x: held.x + 2 }, input.strips[0], ground)).toBeLessThan(GROUND_INSET_PX);
  });

  it('远处的题签不查地面的边：它站在沙盘边上、朝着外面，给不给四个角一个数不差；同一点不是远处的，给了四个角就摆在里面', () => {
    const ground = [
      { x: 250, y: 150 },
      { x: 550, y: 150 },
      { x: 650, y: 450 },
      { x: 150, y: 450 },
    ];
    // 右边那条斜边上的一点（那一行的边在 x = 600），朝外是右
    const far: StripInput = { strips: [slip('far')], anchors: [{ id: 'far', x: 598, y: 300, visible: true, out: [1, 0] }], size, insets };
    const [plain] = placeSlips(far);
    expect(plain.hidden).toBe(false);
    expect(plain.x - 45).toBeGreaterThan(598);
    expect(slipInsideBy(plain, far.strips[0], ground)).toBeLessThan(0);
    expect(placeSlips({ ...far, ground })).toEqual([plain]);
    const near: StripInput = { ...far, anchors: [at('far', 598, 300)] };
    expect(slipInsideBy(placeSlips(near)[0], near.strips[0], ground)).toBeLessThan(0);
    const [held] = placeSlips({ ...near, ground });
    expect(held.hidden).toBe(false);
    expect(slipInsideBy(held, near.strips[0], ground)).toBeGreaterThanOrEqual(GROUND_INSET_PX);
  });

  it('离地面的边至少 3 像素、没有点的名字最远找 48 像素，是写定的两个数；一块正好容得下纸条四边各留 3 像素的地面摆得下，每边再收 1 像素就摆不下', () => {
    expect(GROUND_INSET_PX).toBe(3);
    expect(AREA_REACH_PX).toBe(48);
    // 没有点的名字 90 × 28，正中在 (400, 300)。地面是正着的一块长方形：左右、上下各比纸条宽出 margin
    const box = (margin: number) => [
      { x: 355 - margin, y: 286 - margin },
      { x: 445 + margin, y: 286 - margin },
      { x: 445 + margin, y: 314 + margin },
      { x: 355 - margin, y: 314 + margin },
    ];
    const range = (ground: { x: number; y: number }[]): StripPlacement => placeSlips({ strips: [slip('range', { area: true })], anchors: [at('range', 400, 300)], size, insets, ground })[0];
    expect(range(box(3))).toEqual({ id: 'range', x: 400, y: 300, hidden: false, leader: null, slot: 0 });
    expect(range(box(2)).hidden).toBe(true);
    expect(range(box(2)).why).toBe('area');
  });

  it('全程沙盘上“让开小像”的那一个（placeAround）交到平着的纸条的那一份手里：照平着的纸条的摆法去让，不照竖着的纸条的', () => {
    const root = { dataset: {} as Record<string, string> };
    const kit = slipKit(root as unknown as HTMLElement);
    expect(root.dataset.kind).toBe('slip');
    const around = kit.place(aroundPiece());
    // 小像站在远处，碰不着这一条：摆出来的就是平着的纸条的摆法——在点的右边
    const far = { x0: 700, y0: 500, x1: 720, y1: 544 };
    const input: StripInput = { strips: [slip('a')], anchors: [at('a', 400, 300)], size, insets, avoid: [far] };
    const [calm] = around(input);
    expect(calm).toEqual(placeSlips({ ...input, avoid: undefined })[0]);
    expect(calm.x - 45).toBeGreaterThan(400);
    expect(calm.y).toBe(300);
    // 同一份直接交给让开小像的那一个（不经过平着的纸条的那一份）：照竖着的纸条摆在点的上边
    const [old] = aroundPiece()(input);
    expect(old.x).toBe(400);
    expect(old.y).toBeLessThan(300);
    // 小像站在这一条想站的地方：它让开——还是平着的纸条的位置（左边），不压着他
    const stand = { x0: calm.x - 20, y0: calm.y - 30, x1: calm.x + 20, y1: calm.y + 10 };
    const [moved] = around({ ...input, avoid: [stand] });
    expect(moved.hidden).toBe(false);
    expect(moved.x + 45 <= stand.x0 || moved.x - 45 >= stand.x1 || moved.y + 14 <= stand.y0 || moved.y - 14 >= stand.y1).toBe(true);
    expect(moved.x + 45).toBeLessThan(400);
    expect(moved.y).toBe(300);
    // 交给它的是平常的摆法（定格图、站点沙盘）：换成平着的纸条的摆法
    expect(kit.place(placeStrips)({ ...input, avoid: undefined })).toEqual(placeSlips({ ...input, avoid: undefined }));
  });

  it('平着的纸条的那一份认的是“让开小像”的那个记号（yields）：带着的，小像自己的名字照它的规矩办——他不在沙盘上就不摆；不带的，不管是谁写的摆法，都换成平着的纸条的摆法', () => {
    const kit = slipKit({ dataset: {} } as unknown as HTMLElement);
    const around = aroundPiece();
    expect(around.yields).toBe(true);
    expect('yields' in placeStrips).toBe(false);
    // 小像自己的名字是最后一条（PIECE_NAME）。没有交他占的那一块（他这时候不在沙盘上）：让开小像的那一个不摆它，别的照平着的纸条的摆法
    const input: StripInput = { strips: [slip('a'), slip(PIECE_NAME, { rank: 1 })], anchors: [at('a', 400, 300), at(PIECE_NAME, 200, 200)], size, insets };
    const [a, own] = kit.place(around)(input);
    expect(own).toEqual({ id: PIECE_NAME, x: 0, y: 0, hidden: true, leader: null, why: 'unseen' });
    expect(a).toEqual(placeSlips({ ...input, strips: [slip('a')] })[0]);
    expect(a.x - 45).toBeGreaterThan(400);
    // 平着的纸条的摆法自己不认这个名字：直接交给它，它当平常的一条摆出来——所以上面那一条确实经过了让开小像的那一个
    expect(placeSlips(input)[1].hidden).toBe(false);
    // 他站在沙盘上（交了他占的那一块）：名字摆在他旁边，是平着的纸条的位置（左右，不在头上），不压着他
    const stand = { x0: 190, y0: 170, x1: 210, y1: 214 };
    const [, beside] = kit.place(around)({ ...input, avoid: [stand] });
    expect(beside.hidden).toBe(false);
    expect(beside.x + 45 <= stand.x0 || beside.x - 45 >= stand.x1).toBe(true);
    expect(Math.abs(beside.y - 200)).toBeLessThanOrEqual(28);
    // 不带记号的：平常的 placeStrips 换掉；别人另写的一个（不理第四样）也换掉，没有一条照它摆
    const other: StripPlacer = (given) => given.strips.map((s) => ({ id: s.id, x: 1, y: 2, hidden: false, leader: null }));
    expect(kit.place(other)(input)).toEqual(placeSlips(input));
    expect(kit.place(placeStrips)(input)).toEqual(placeSlips(input));
    // 记号是那个函数自己带着的：外面包了一层就不带了，也照平着的纸条的摆法摆（小像的名字就不归它管了）
    expect(kit.place((given, prev, opts) => around(given, prev, opts))(input)).toEqual(placeSlips(input));
  });
});

describe('题签层照平着的纸条造、照它摆（编出来的那一座沙盘的头一节）', () => {
  /** 一个只够题签层用的假页面：纸条多大照 slipSize 算（它不排版）。 */
  class El {
    parent: El | null = null;
    children: El[] = [];
    text = '';
    attributes = new Map<string, string>();
    style: Record<string, string> = {};
    ownerDocument!: Doc;
    constructor(readonly tag: string) {
      const store: Record<string, string> = {};
      this.style = new Proxy(store, {
        set(target, key: string, value: string) {
          if (key === 'cssText') {
            for (const name of Object.keys(target)) delete target[name];
            for (const part of value.split(';')) {
              const colon = part.indexOf(':');
              if (colon > 0) target[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
            }
          } else target[key] = value;
          return true;
        },
      });
    }
    get className(): string {
      return this.attributes.get('class') ?? '';
    }
    set className(value: string) {
      this.attributes.set('class', value);
    }
    get dataset(): Record<string, string> {
      const attr = (key: string): string => 'data-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
      return new Proxy({} as Record<string, string>, {
        get: (_t, key: string) => this.attributes.get(attr(key)),
        set: (_t, key: string, value: string) => {
          this.attributes.set(attr(key), value);
          return true;
        },
      });
    }
    get textContent(): string {
      return this.text + this.children.map((child) => child.textContent).join('');
    }
    set textContent(value: string) {
      this.children = [];
      this.text = value;
    }
    setAttribute(name: string, value: string): void {
      this.attributes.set(name, value);
    }
    getAttribute(name: string): string | null {
      return this.attributes.get(name) ?? null;
    }
    /** 一条平着的纸条多大：照它里面的圆和名字算（宽的栏）。 */
    private box(): { w: number; h: number } {
      if (!this.className.startsWith('strip-slip')) return { w: 0, h: 0 };
      const name = this.children.find((child) => child.className === 'strip-name')?.text ?? '';
      return slipSize(name, stripSizeKind(paneWidth), this.children.filter((child) => child.className === 'strip-disc').length, this.attributes.has('data-area'));
    }
    get offsetWidth(): number {
      return this.box().w;
    }
    get offsetHeight(): number {
      return this.box().h;
    }
    append(...nodes: El[]): void {
      for (const node of nodes) {
        node.remove();
        node.parent = this;
        this.children.push(node);
      }
    }
    remove(): void {
      if (!this.parent) return;
      this.parent.children = this.parent.children.filter((child) => child !== this);
      this.parent = null;
    }
    addEventListener(): void {}
    all(): El[] {
      return this.children.flatMap((child) => [child, ...child.all()]);
    }
  }
  class Doc {
    createElement(tag: string): El {
      const el = new El(tag);
      el.ownerDocument = this;
      return el;
    }
    createElementNS(_ns: string, tag: string): El {
      return this.createElement(tag);
    }
  }
  let paneWidth = 940;

  function layerOn(pane: Pane, slips: boolean) {
    paneWidth = pane.size.width;
    const { scene, headings } = madeUpRoute();
    const container = new Doc().createElement('div');
    if (slips) labelsIn(container as unknown as HTMLElement, slipKit);
    const layer = mountStrips(container as unknown as HTMLElement);
    const section = scene.sections[0];
    const specs = sectionStripSpecs(scene, headings[0], stripTexts(scene, headings[0], 'ancient'), MARKS);
    layer.set(specs);
    const { anchors, ground } = seenOn(section, pane);
    layer.place(anchors, pane.size, pane.insets, { ground });
    const root = container.children[0];
    const svg = root.children[0];
    const of = (id: string) => {
      const index = specs.findIndex((spec) => spec.id === id);
      // 线那一层里一条题签六样：衬边、引线、箭头的衬边、箭头、圆点、圈
      const [under, line, , , dot, ring] = svg.children.slice(index * 6, index * 6 + 6);
      const el = root.children.slice(1)[index];
      return { el, under, line, dot, ring, shown: el.style.visibility !== 'hidden' };
    };
    return { root, specs, of, layer };
  }

  it('那一层上写着 slip；九条都是平着的纸条；乙渡两个圆（二、三）在名字前头；指着海的那一条和西岭是没有点的名字', () => {
    const m = layerOn(STANDARD_PANES[0], true);
    expect(m.root.getAttribute('data-kind')).toBe('slip');
    expect(m.specs).toHaveLength(9);
    for (const spec of m.specs) expect(m.of(spec.id).el.className.split(' ')[0], spec.id).toBe('strip-slip');
    const yi = m.of('s-yi').el;
    expect(yi.children.map((child) => `${child.className}:${child.textContent}`)).toEqual(['strip-disc:二', 'strip-disc:三', 'strip-name:乙渡']);
    expect(yi.children.slice(0, 2).map((child) => child.getAttribute('data-stop-id'))).toEqual(['bing', 'ding']);
    expect(m.specs.filter((spec) => spec.area).map((spec) => spec.id)).toEqual(['s-sea', 's-massif']);
    expect(m.of('s-sea').el.getAttribute('data-area')).toBe('true');
    expect(m.of('s-massif').el.getAttribute('data-area')).toBe('true');
    expect(m.of('s-jia').el.getAttribute('data-area')).toBeNull();
    // 是站的地名（甲城、丙港、丁镇、乙渡）那一点上有记号，别的没有
    expect(m.specs.filter((spec) => m.of(spec.id).dot.getAttribute('data-stop') === 'true').map((spec) => spec.id)).toEqual(['s-jia', 's-bing', 's-ding', 's-yi']);
  });

  it('没有点的名字摆出来：没有圆点、没有引线、没有空心的圈；有点的名字都有圆点和引线', () => {
    const m = layerOn(STANDARD_PANES[0], true);
    for (const spec of m.specs) {
      const item = m.of(spec.id);
      expect(item.shown, spec.id).toBe(true);
      const drawn = { dot: item.dot.style.display !== 'none', line: item.line.style.display !== 'none', under: item.under.style.display !== 'none', ring: item.ring.style.display !== 'none' };
      expect(drawn, spec.id).toEqual(spec.area ? { dot: false, line: false, under: false, ring: false } : { dot: true, line: true, under: true, ring: false });
    }
  });

  it('没有点的名字摆不下：纸条藏着，那个位置上也没有空心的圈；有点的名字摆不下才留圈', () => {
    const m = layerOn(STANDARD_PANES[0], true);
    // 画面收成很小的一块：什么也摆不下
    const tiny = { width: 60, height: 40 };
    const none: StageInsets = { top: 0, right: 0, bottom: 0, left: 0 };
    m.layer.place(
      m.specs.map((spec) => ({ id: spec.id, x: 30, y: 20, visible: true })),
      tiny,
      none,
    );
    for (const spec of m.specs) {
      const item = m.of(spec.id);
      expect(item.shown, spec.id).toBe(false);
      expect(item.ring.style.display !== 'none', spec.id).toBe(!spec.area);
    }
  });

  it('容器上没有记另一种题签：同一节造出来的是竖着的纸条，指着海的那一条照旧有圆点和引线', () => {
    const m = layerOn(STANDARD_PANES[0], false);
    expect(m.root.getAttribute('data-kind')).toBeNull();
    for (const spec of m.specs) expect(m.of(spec.id).el.className.split(' ')[0], spec.id).toBe('strip');
    // 假页面量不出竖着的纸条的大小（都是 0），摆得出来；海那一条有点、有线
    const sea = m.of('s-sea');
    expect(sea.el.getAttribute('data-area')).toBeNull();
    expect(sea.dot.style.display).not.toBe('none');
    expect(sea.line.style.display).not.toBe('none');
  });

  it('地面的四个角经过题签层到了摆法手里：交了，本来要出边的那一条站在里面；下一次不交就不查，再交又查；平着的纸条的那一层带着 ground（两种沙盘程序认它），竖着的纸条的那一层没有', () => {
    // 两种沙盘程序都先看这一层有没有 ground，有才交四个角（src/stage/three/view.ts、src/stage/still/engine.ts）
    expect(layerOn(STANDARD_PANES[0], true).layer.ground).toBe(stillGround);
    expect(layerOn(STANDARD_PANES[0], false).layer.ground).toBeUndefined();

    paneWidth = 800;
    const size = { width: 800, height: 600 };
    const none: StageInsets = { top: 0, right: 0, bottom: 0, left: 0 };
    const container = new Doc().createElement('div');
    labelsIn(container as unknown as HTMLElement, slipKit);
    const layer = mountStrips(container as unknown as HTMLElement);
    layer.set([{ id: 'a', text: '甲城', tone: 'place' }]);
    const el = container.children[0].children[1];
    const box = { w: el.offsetWidth, h: el.offsetHeight };
    expect(box).toEqual(slipSize('甲城', 'wide', 0, false));
    const where = (): StripPlacement => ({ id: 'a', x: Number.parseFloat(el.style.left), y: Number.parseFloat(el.style.top), hidden: el.style.visibility === 'hidden', leader: null });
    // 地面是一块斜的四边形；点挨着它的右边
    const ground = [
      { x: 250, y: 150 },
      { x: 550, y: 150 },
      { x: 650, y: 450 },
      { x: 150, y: 450 },
    ];
    const anchors = [{ id: 'a', x: 560, y: 300, visible: true }];
    layer.place(anchors, size, none, { ground });
    expect(where().hidden).toBe(false);
    expect(slipInsideBy(where(), box, ground)).toBeGreaterThanOrEqual(GROUND_INSET_PX);
    const held = where();
    // 这一次没有交四个角（近看一处、有一个角到了镜头背后的那一帧）：不查。先藏起来再摆（镜头滑到了别处：从头挑；
    // 不藏的话它照“能不换就不换”留在原处），纸条站到了点的右边、出了边
    layer.hide();
    layer.place(anchors, size, none);
    expect(where().x).toBeGreaterThan(560);
    expect(slipInsideBy(where(), box, ground)).toBeLessThan(0);
    // 再交：又在里面，还是头一次的那个位置；手还在动的那几帧交的也算
    layer.hide();
    layer.place(anchors, size, none, { ground });
    expect(where()).toEqual(held);
    layer.hide();
    layer.place(anchors, size, none, { ground, moving: true });
    expect(where()).toEqual(held);
    // 重新量大小（字体到了）以后照最近交的那四个角再摆
    layer.remeasure();
    expect(slipInsideBy(where(), box, ground)).toBeGreaterThanOrEqual(GROUND_INSET_PX);
    layer.destroy();
  });

  // 2026-11-26 以前这一条的名字是“页面那一边取沙盘程序的两处（loadStageEngine、loadStillEngine）：平着的纸条的沙盘，交出来的沙盘程序每摆一座，
  // 先把那一小块记在容器上、再照原样去摆——那时候挂上去的一层题签已经是平着的纸条；竖着的纸条的沙盘，交出来的就是沙盘程序自己；没取到就拒绝”，两处一起查。
  // 定格图的那一处改了（图片不等那一小块：先摆图，题签到了再摆上去；没取到不拒绝，由摆出来的那一座说），它另有下面的一条；
  // 立体的沙盘的那一处没有动，还是这里查的这几样。
  it('页面那一边取立体的沙盘的那一处（loadStageEngine）：平着的纸条的沙盘，交出来的沙盘程序每摆一座，先把那一小块记在容器上、再照原样去摆——那时候挂上去的一层题签已经是平着的纸条；竖着的纸条的沙盘，交出来的就是沙盘程序自己；没取到就拒绝', { timeout: 60_000 }, async () => {
    const { engine } = await import('../../src/stage/three/engine');
    const cases: [string, typeof loadStageEngine, StageEngine][] = [['立体的沙盘', loadStageEngine, engine]];
    for (const [what, load, own] of cases) {
      const fake = loader();
      // 竖着的纸条的沙盘（登记表里没有写 slip 的每一种样式、没有写样式、表里没有的样式）：就是沙盘程序自己，那一小块一次也没有取。
      // 2026-11-27 以前这里走的是登记表里的每一行：那时候每一行都是竖着的纸条
      const strips = STYLES.filter((row) => (row.labels ?? 'strip') === 'strip');
      expect(strips.map((row) => row.id)).toContain('song-qinglv');
      for (const row of strips) expect(await load(row.id, STYLES, fake.load), `${what} ${row.id}`).toBe(own);
      expect(await load(undefined, MADE_UP_STYLES, fake.load), what).toBe(own);
      expect(await load(MADE_UP_STYLE_ID, STYLES, fake.load), what).toBe(own);
      expect(fake.calls(), what).toBe(0);
      // 不交表、不交取法：照登记表查，苏轼的样式还是它自己
      expect(await load(STYLES[0].id), what).toBe(own);
      // 登记表里写了 slip 的每一种样式：取一次，交出来的不是沙盘程序自己（只有 create 换了）
      const slips = STYLES.filter((row) => row.labels === 'slip');
      const registered = loader();
      for (const row of slips) {
        const wrapped = await load(row.id, STYLES, registered.load);
        expect(wrapped, `${what} ${row.id}`).not.toBe(own);
        expect({ ...wrapped, create: own.create }, `${what} ${row.id}`).toEqual({ ...own });
      }
      expect(registered.calls(), what).toBe(slips.length);

      // 平着的纸条的沙盘：取了一次；交出来的不是沙盘程序自己，只有 create 换了
      const got = await load(MADE_UP_STYLE_ID, MADE_UP_STYLES, fake.load);
      expect(fake.calls(), what).toBe(1);
      expect(got, what).not.toBe(own);
      expect(got.create, what).not.toBe(own.create);
      expect({ ...got, create: own.create }, what).toEqual({ ...own });

      // 它摆一座（这里不真的摆：沙盘程序自己的 create 换成一个只挂题签层的）：交过去的三样原样；那时候容器上已经记了
      const page = new Doc();
      const container = page.createElement('div');
      const table = { key: '编的' } as unknown as StageTable;
      const options = { namesMode: 'ancient' } as unknown as StageOptions;
      const view = { made: what } as unknown as StopStageView;
      let kindWhenCreated: string | null = '还没有摆';
      const create = vi.spyOn(own, 'create').mockImplementation((host) => {
        mountStrips(host);
        kindWhenCreated = (host as unknown as El).children[0].getAttribute('data-kind');
        return view;
      });
      try {
        expect(got.create(container as unknown as HTMLElement, table, options), what).toBe(view);
        expect(create, what).toHaveBeenCalledTimes(1);
        expect(create.mock.calls[0][0], what).toBe(container);
        expect(create.mock.calls[0][1], what).toBe(table);
        expect(create.mock.calls[0][2], what).toBe(options);
        expect(kindWhenCreated, what).toBe('slip');
        // 沙盘程序自己（没有套过的）在别的容器里摆：什么也不记，挂上去的是竖着的纸条
        const other = page.createElement('div');
        own.create(other as unknown as HTMLElement, table, options);
        expect(kindWhenCreated, what).toBeNull();
      } finally {
        create.mockRestore();
      }

      // 没取到：拒绝（页面照“没能摆出来”、“这一次不放图片”办）；再叫一次再取一次
      const failing = loader(1);
      await expect(load(MADE_UP_STYLE_ID, MADE_UP_STYLES, failing.load), what).rejects.toThrow('那一小块程序没有取到');
      expect(await load(MADE_UP_STYLE_ID, MADE_UP_STYLES, failing.load), what).not.toBe(own);
      expect(failing.calls(), what).toBe(2);
    }
  });

  it('页面那一边取定格图的沙盘的那一处（loadStillEngine）：竖着的纸条的沙盘，交出来的就是定格图的沙盘自己；平着的纸条的沙盘不等那一小块——马上交出去，每摆一座把“那一小块到了、记在这个容器上了”交给那一座（options.labels），到了以后在那个容器里挂的一层才是平着的纸条；没取到也不拒绝，交给那一座的那一样拒绝，再叫一次再取一次', { timeout: 60_000 }, async () => {
    const what = '定格图的沙盘';
    const own = stillEngine;
    const fake = loader();
    // 竖着的纸条的沙盘（登记表里没有写 slip 的每一种样式、没有写样式、表里没有的样式）：就是定格图的沙盘自己，那一小块一次也没有取。
    // 2026-11-27 以前这里走的是登记表里的每一行：那时候每一行都是竖着的纸条
    const strips = STYLES.filter((row) => (row.labels ?? 'strip') === 'strip');
    expect(strips.map((row) => row.id)).toContain('song-qinglv');
    for (const row of strips) expect(await loadStillEngine(row.id, STYLES, fake.load), `${what} ${row.id}`).toBe(own);
    expect(await loadStillEngine(undefined, MADE_UP_STYLES, fake.load), what).toBe(own);
    expect(await loadStillEngine(MADE_UP_STYLE_ID, STYLES, fake.load), what).toBe(own);
    expect(fake.calls(), what).toBe(0);
    // 不交表、不交取法：照登记表查，苏轼的样式还是它自己
    expect(await loadStillEngine(STYLES[0].id), what).toBe(own);
    // 登记表里写了 slip 的每一种样式：取一次，交出来的不是定格图的沙盘自己（只有 create 换了）
    const slips = STYLES.filter((row) => row.labels === 'slip');
    const registered = loader();
    for (const row of slips) {
      const wrapped = await loadStillEngine(row.id, STYLES, registered.load);
      expect(wrapped, `${what} ${row.id}`).not.toBe(own);
      expect({ ...wrapped, create: own.create }, `${what} ${row.id}`).toEqual({ ...own });
    }
    expect(registered.calls(), what).toBe(slips.length);

    // 平着的纸条的沙盘，那一小块压着不给：取的那一处照样马上交出来（不等它）；取了一次；交出来的不是定格图的沙盘自己，只有 create 换了
    let release: (got: { slipKit: LabelKitMaker }) => void = () => {};
    let asked = 0;
    const held = (): Promise<{ slipKit: LabelKitMaker }> => {
      asked += 1;
      return new Promise((resolve) => (release = resolve));
    };
    const got = await loadStillEngine(MADE_UP_STYLE_ID, MADE_UP_STYLES, held);
    expect(asked).toBe(1);
    expect(got).not.toBe(own);
    expect(got.create).not.toBe(own.create);
    expect({ ...got, create: own.create }).toEqual({ ...own });

    // 它摆一座（这里不真的摆：定格图的沙盘自己的 create 换成一个只记交来的东西的）：容器、沙盘原样；交过去的选项多了一样 labels，别的原样
    const page = new Doc();
    const container = page.createElement('div');
    const table = { key: '编的' } as unknown as StageTable;
    const options = { namesMode: 'ancient' } as unknown as StageOptions;
    const view = { made: what } as unknown as StopStageView;
    const kindIn = (host: unknown): string | null => {
      const layer = mountStrips(host as HTMLElement);
      const children = (host as El).children;
      const kind = children[children.length - 1].getAttribute('data-kind');
      layer.destroy();
      return kind;
    };
    const create = vi.spyOn(own, 'create').mockImplementation(() => view);
    try {
      expect(got.create(container as unknown as HTMLElement, table, options)).toBe(view);
      expect(create).toHaveBeenCalledTimes(1);
      expect(create.mock.calls[0][0]).toBe(container);
      expect(create.mock.calls[0][1]).toBe(table);
      const handed = create.mock.calls[0][2];
      expect(handed).toEqual({ ...options, labels: expect.any(Promise) });
      // 那一小块还没到：容器上什么也没有记，这时候在里面挂一层是竖着的纸条（所以定格图那一座先不挂）
      expect(kindIn(container)).toBeNull();
      // 到了：交过去的那一样兑现，这时候容器上已经记了，挂上去的一层是平着的纸条
      release({ slipKit });
      await handed.labels;
      expect(kindIn(container)).toBe('slip');
      // 定格图的沙盘自己（没有套过的）在别的容器里摆：交过去的选项没有 labels，那个容器上什么也不记
      const other = page.createElement('div');
      own.create(other as unknown as HTMLElement, table, options);
      expect(create.mock.calls[1][2]).toBe(options);
      expect(kindIn(other)).toBeNull();

      // 没取到：取的那一处不拒绝（图片照样要放）；交给那一座的那一样拒绝，容器上什么也不记；再叫一次再取一次，这一回取到了
      const failing = loader(1);
      const lost = await loadStillEngine(MADE_UP_STYLE_ID, MADE_UP_STYLES, failing.load);
      expect(lost).not.toBe(own);
      const bare = page.createElement('div');
      lost.create(bare as unknown as HTMLElement, table, options);
      await expect(create.mock.calls[2][2].labels).rejects.toThrow('那一小块程序没有取到');
      expect(kindIn(bare)).toBeNull();
      const again = await loadStillEngine(MADE_UP_STYLE_ID, MADE_UP_STYLES, failing.load);
      expect(failing.calls()).toBe(2);
      again.create(bare as unknown as HTMLElement, table, options);
      await create.mock.calls[3][2].labels;
      expect(kindIn(bare)).toBe('slip');
    } finally {
      create.mockRestore();
    }
  });

  it('定格图的沙盘、竖着的纸条：取它的那一处不等什么——交回的 Promise 是已经兑现的，和直接拿 stillEngine 一样快（一个微任务就到手）', async () => {
    const order: string[] = [];
    const first = loadStillEngine(STYLES[0].id).then(() => order.push('取到了定格图的沙盘'));
    const second = Promise.resolve(stillEngine).then(() => order.push('直接拿的'));
    await Promise.all([first, second]);
    expect(order).toEqual(['取到了定格图的沙盘', '直接拿的']);
  });
});

describe('数一遍：这座编出来的沙盘上平着的纸条摆得怎么样（报给负责人的数；摆不下、引线长、出了边的都照实印出来）', () => {
  const plain = ({ name, size, insets }: Pane): Pane => ({ name, size, insets });
  /** 标准的四种（一站的页面）、带着时间轴的四种（人物页）、首页宽屏上的两种、竖着拿的各种平板（不带、带时间轴）。 */
  const PANES: Pane[] = [...STANDARD_PANES, ...ROUTE_PANES, ...HOME_PANES.slice(0, 2), ...UPRIGHT_PANES, ...ROUTE_UPRIGHT_PANES].map(plain);
  const LEADER_MAX_PX = 48;

  it('头一节有九条名字：四个站名（一个两站）、三个水名里一个是海、一个岛上的镇、一片没有点的山', () => {
    const { scene, headings } = madeUpRoute();
    const texts = stripTexts(scene, headings[0], 'ancient');
    expect(texts.map((t) => t.text)).toEqual(['甲城', '丙港', '丁镇', '乙渡', '子河', '午湖', '海', '己岛', '西岭']);
    expect(texts.filter((t) => t.stops?.length).map((t) => `${t.text}:${t.stops?.join('+')}`)).toEqual(['甲城:jia', '丙港:bing', '丁镇:ding', '乙渡:bing+ding']);
    expect(texts.filter((t) => t.tone === 'water').map((t) => t.text)).toEqual(['子河', '午湖', '海']);
    // 没有点的名字：指着海的，和地名点写了 area 的
    expect(texts.filter((t) => isAreaName(scene, t.id)).map((t) => t.text)).toEqual(['海', '西岭']);
  });

  it('每一节、每一种沙盘栏、古今两种名字：摆下几条、最长的引线、离地面的边最近多少（印出来）；纸条没有相叠的、没有压着别的点的', () => {
    const { scene } = madeUpRoute();
    const lines: string[] = [];
    const notHeld: string[] = [];
    let views = 0;
    for (const pane of PANES) {
      for (const section of scene.sections) {
        for (const names of NAMES) {
          const input = inputFor(section, pane, names);
          const result = placeSlips(input);
          views += 1;
          const shown = result.filter((p) => !p.hidden);
          const hidden = result.filter((p) => p.hidden).map((p) => `${scene.strips.find((s) => s.id === p.id)?.text}（${p.why}）`);
          const longest = result.reduce((best, p) => (leaderPx(p) > leaderPx(best) ? p : best), result[0]);
          const long = result.filter((p) => leaderPx(p) > LEADER_MAX_PX).map((p) => `${scene.strips.find((s) => s.id === p.id)?.text} ${leaderPx(p).toFixed(0)}`);
          const nearest = Math.min(...result.flatMap((p, i) => (p.hidden ? [] : [slipInsideBy(p, input.strips[i], input.ground as { x: number; y: number }[])])));
          const outside = result.filter((p, i) => !p.hidden && slipInsideBy(p, input.strips[i], input.ground as { x: number; y: number }[]) < GROUND_INSET_PX - 1e-6).length;
          if (names === 'ancient') lines.push(`  ${pane.name} | ${section.heading}：${shown.length}/${result.length} 条，最长的引线 ${leaderPx(longest).toFixed(0)}，离地面的边最近 ${nearest.toFixed(0)}，出边 ${outside}`);
          if (hidden.length || long.length || outside) notHeld.push(`${pane.name} | ${section.heading} | ${names}：${[hidden.length ? `没摆 ${hidden.join('、')}` : '', long.length ? `引线超过 ${LEADER_MAX_PX}：${long.join('、')}` : '', outside ? `出边 ${outside} 条` : ''].filter(Boolean).join('；')}`);
          // 不该有的事：两条纸条叠在一起，一条纸条压着别的有点的名字的那一点
          shown.forEach((a) => {
            const sa = input.strips[result.indexOf(a)];
            shown.forEach((b) => {
              if (a.id >= b.id) return;
              const sb = input.strips[result.indexOf(b)];
              const apart = Math.abs(a.x - b.x) >= (sa.w + sb.w) / 2 || Math.abs(a.y - b.y) >= (sa.h + sb.h) / 2;
              expect(apart, `${pane.name} ${section.heading}：${a.id} 和 ${b.id} 叠在一起`).toBe(true);
            });
            input.anchors.forEach((dot, k) => {
              if (dot.id === a.id || input.strips[k].area || !dot.visible) return;
              const covers = Math.abs(a.x - dot.x) < sa.w / 2 + 6 && Math.abs(a.y - dot.y) < sa.h / 2 + 6;
              expect(covers, `${pane.name} ${section.heading}：${a.id} 压着 ${dot.id} 的点`).toBe(false);
            });
          });
          // 摆出来的每一条都在地面的边里面
          expect(outside, `${pane.name} ${section.heading} ${names}`).toBe(0);
        }
      }
    }
    console.log(`平着的纸条在编出来的沙盘上（${PANES.length} 种沙盘栏 × ${scene.sections.length} 节，当时的名字）：\n${lines.join('\n')}`);
    console.log(notHeld.length ? `没有守住“每一条都摆下、引线不超过 ${LEADER_MAX_PX} 像素”的画面（${notHeld.length} 个，共查 ${views} 个）：\n  ${notHeld.join('\n  ')}` : `查了 ${views} 个画面：每一条都摆下了，引线都不超过 ${LEADER_MAX_PX} 像素，都在地面的边里面`);
    expect(views).toBe(PANES.length * scene.sections.length * NAMES.length);
  });

  it('同一个画面照竖着的纸条摆一遍（比一比用的，印出来）：竖着的纸条的摆法不管地面的边', () => {
    const { scene } = madeUpRoute();
    const lines: string[] = [];
    for (const pane of PANES) {
      const input = inputFor(scene.sections[0], pane, 'ancient', 'strip');
      const result = placeStrips(input);
      const longest = result.reduce((best, p) => (leaderPx(p) > leaderPx(best) ? p : best), result[0]);
      const outside = result.filter((p, i) => !p.hidden && slipInsideBy(p, input.strips[i], input.ground as { x: number; y: number }[]) < GROUND_INSET_PX).length;
      lines.push(`  ${pane.name}：${result.filter((p) => !p.hidden).length}/${result.length} 条，最长的引线 ${leaderPx(longest).toFixed(0)}，出了地面的边 ${outside} 条`);
      // 竖着的纸条的大小里没有 area 这一项
      expect(input.strips.some((s) => 'area' in s)).toBe(false);
    }
    console.log(`同一节（全程）照竖着的纸条摆：\n${lines.join('\n')}`);
    expect(lines).toHaveLength(PANES.length);
  });
});

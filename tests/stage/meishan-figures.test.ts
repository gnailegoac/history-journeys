// 场景验收：眉州这座沙盘上的模型，照建造设计该有的样子查一遍。在 Node 里跑，不要浏览器。
// 各座沙盘都要查的那些（预算、每一节造不造得出来、船不搁在岸上、民居不压着、题签摆得下）在 scene-budgets、scene-models、
// scene-figures、scene-cameras、scene-strips 里；地面的事在 meishan-ground.test.ts；这里只查眉州自己的模型：
//   水纹    头一节（看全景）在 573 到 1600 像素高的沙盘栏上整片水面都不画水纹，另外三节照画；门槛到一倍半之间匀着过去；
//           没有写门槛的沙盘哪一节都画。（从真的沙盘上读水面的数——摆好的一节、滑到半路、滚轮推近——在 view.test.ts。）
//   浮桥    只在“正月上蟆颐山”一节有；有水的一截是从地形板上读出来的，船只摆在这一截里，一条挨一条；
//           两头在干地上，离山脚下那一股水的岸不到 60 米；在那一节的画面上一条船至少 4 个像素宽。
//           造三套（贴近的、中间的、远看的），读者把镜头推近就换；桥板在岸上贴着看得见的地，不埋、不悬。
//           路的尽头是“蟆颐津”，“浮桥”的点在卵石滩上、不压着桥；嘉州的题签挂在江流出沙盘的地方。
//   坟      一大一小挨着，小的没有被大的吞掉；每座的脚落在读者看得见的那块地上（高程和地形板里低的那个），不悬着；
//           墓地是一组（大坟是主角，小坟、泉、亭子跟着它放大）；“老翁泉”一节电脑上大坟 40 个像素以上、竖着拿的平板上 24 个以上；
//           三条题签（父母的墓、王弗的墓、老翁泉）的点两两 30 个像素以上，“老翁泉”的点在池沿外面；平常的树不长到坟的跟前。
//   池      水面是平的，哪一处的地面、地形板都盖不住它；池沿往下接到看得见的那块地以下；老翁泉的池砌石，下坡那一面不高过 12。
//           亭子在池的旁边，画面上不压着池，也不挡在坟的前面。
//   家      一户带篱笆的人家（瓦顶的屋），不是一组院落；它那一块地和池的那一块地里，大街、小巷不过，民居的规则让开；竹在屋的北面，是细高的那一种。
//           池在篱笆里面（小一号）；这一块地跟着屋放大；跟着屋放大的池水面不落在地面那一层里；园子里的树摊开以后还在城墙里面。
//   小松树  墓地四周的松只有平常的一半大。
//   路      东门到渡口的大路在地面上比平地深十八级以上、四十米以上宽；上山的那一段还是平常的路。
//   山里的平地  五块浅色的平地上都种了树。
// 这里的数调过以后要重新跑；改了定下来的做法，场景文件里的依据要跟着改。

import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import type { BufferGeometry, Mesh, Object3D } from 'three';
import type { SceneSection, SceneThing } from '../../src/domain/scene';
import { existsAt, sectionHeadings } from '../../src/domain/sceneText';
import type { LngLat } from '../../src/domain/types';
import { paintColour, plotHalfM } from '../../src/stage/ground';
import type { Vec2 } from '../../src/stage/ground/types';
import { distLine } from '../../src/stage/ground/lines';
import { MOUND, POOL, PONTOON, family as worksFamily, pontoonPlan, pontoonPlans } from '../../src/stage/three/families/works';
import type { KitContext } from '../../src/stage/three/internal';
import { STEP_HOLD, buildModels } from '../../src/stage/three/kit/assemble';
import { equivalentDistance, figureGroups, figureNow } from '../../src/stage/three/kit/figure';
import { FIGURE_SLOT, figureMove, makeFigureUniforms, setFigure } from '../../src/stage/three/kit/figureMaterial';
import type { FigureMarks, FigureUniforms } from '../../src/stage/three/kit/figureMaterial';
import { Batch } from '../../src/stage/three/kit/geo';
import { makeMaterials } from '../../src/stage/three/kit/materials';
import type { Bucket, Pass } from '../../src/stage/three/kit/pass';
import { grownYard, inYard, insidePolygon, ringDistance, surveyWalls } from '../../src/stage/three/kit/site';
import { THING_BUILDERS } from '../../src/stage/three/kit/things';
import { plantTrees } from '../../src/stage/three/kit/trees';
import { meshHeightAt } from '../../src/stage/three/meshHeight';
import { FULL_QUALITY } from '../../src/stage/three/quality';
import { centreShift, placeCamera, project, screenAnchors } from '../../src/stage/three/rig';
import { styleFor } from '../../src/stage/three/style';
import { CALM_RANGE, rippleFor, rippleShare } from '../../src/stage/three/water';
import { realScene, realSceneKeys } from './support/realScenes';
import { STANDARD_PANES, UPRIGHT_PANES } from './support/standardPanes';

const KEY = 'su-shi/meishan';
const VIEW_ALL = '眉州';
const VIEW_HOME = '纱縠行的家';
const VIEW_HILL = '正月上蟆颐山';
const VIEW_GRAVES = '老翁泉';
const [WIDE, , UPRIGHT] = STANDARD_PANES;

// 树要种好几遍、地面要画一遍：整套测试一起跑的时候一条要好几秒，整组单给一个时限
describe.runIf(realSceneKeys().includes(KEY))('眉州的模型', { timeout: 60_000 }, () => {
  const R = realScene(KEY);
  const { scene, coords, samplers, ground } = R;
  const style = styleFor(scene.style);
  const ctx: KitContext = { scene, ground, samplers, coords, style, quality: FULL_QUALITY, kit: R.kit };
  const mesh = meshHeightAt(samplers, coords);
  const normal = scene.water.levels.values.normal;
  const headings = sectionHeadings(scene);
  const thing = (id: string): SceneThing => {
    const found = scene.things.find((t) => t.id === id);
    if (!found) throw new Error(`场景里没有摆件 ${id}`);
    return found;
  };
  const section = (heading: string): SceneSection => {
    const found = scene.sections.find((s) => s.heading === heading);
    if (!found) throw new Error(`场景里没有小节 ${heading}`);
    return found;
  };
  const local = (at: LngLat | undefined): Vec2 => {
    if (!at) throw new Error('没有写 at');
    return coords.toLocal(at);
  };
  /** 读者看得见的那块地在这一点多高（沙盘里的高度）：高程和地形板里低的那个。 */
  const seenY = (x: number, z: number): number => Math.min(coords.y(samplers.height(x, z)), coords.y(mesh(x, z)));
  /** 只造一样东西用的那一趟：零件拿到的东西和总装时一样，形状都放进同一个批次。 */
  const soloPass = (): { pass: Pass; main: Batch; bucket: Bucket } => {
    const main = new Batch();
    const bucket: Bucket = { main, raised: new Batch(), boats: [] };
    return { pass: { ctx, survey: surveyWalls(ctx), yards: [], lots: [], bucket: () => bucket }, main, bucket };
  };
  /** 一个批次里的零件（各是一块形状），按材质取。 */
  const partsOf = (batch: Batch, material: string): BufferGeometry[] => batch.parts.get(material) ?? [];
  /** 镜头在 D 这么远、水面在平时的水位时交给显卡的那一份数。 */
  const figureAt = (D: number): FigureUniforms => {
    const u = makeFigureUniforms();
    setFigure(u, style, D, coords.y(normal), coords.y(normal + 1) - coords.y(normal));
    return u;
  };
  const marksOf = (g: BufferGeometry, i = 0): FigureMarks => {
    const p = g.attributes.aPivot;
    const q = g.attributes.aGroup;
    const f = g.attributes.aFig;
    return { pivot: [p.getX(i), p.getY(i), p.getZ(i)], group: [q.getX(i), q.getY(i), q.getZ(i)], fig: [f.getX(i), f.getY(i), f.getZ(i), f.getW(i)] };
  };
  /** 镜头从 1 公里到 130 公里，每次远 5%。 */
  const sweep = (): number[] => {
    const out: number[] = [];
    for (let D = 1000; D <= 130_000; D *= 1.05) out.push(D);
    return out;
  };
  /** 造出来的一样东西的全部顶点（沙盘里的 x、y、z），按材质取。 */
  const vertices = (main: Batch, material: string): [number, number, number][] => {
    const out: [number, number, number][] = [];
    for (const g of main.parts.get(material) ?? []) {
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) out.push([p.getX(i), p.getY(i), p.getZ(i)]);
    }
    return out;
  };
  const builders = worksFamily.things ?? {};
  /** 一小节在一种沙盘栏上摆好的镜头，和“地上一米合几个页面像素”。 */
  const look = (heading: string, pane: (typeof STANDARD_PANES)[number]) => {
    const placed = placeCamera(section(heading), scene, samplers, coords, style, pane.size, pane.insets);
    const camera = new PerspectiveCamera(placed.pose.fov, pane.size.width / pane.size.height, Math.max(60, placed.distanceM * 0.1), placed.distanceM * 3 + 30000);
    camera.position.set(...placed.pose.position);
    camera.lookAt(...placed.pose.target);
    const [shiftX, shiftY] = centreShift(pane.insets);
    if (shiftX || shiftY) camera.setViewOffset(pane.size.width, pane.size.height, -shiftX, -shiftY, pane.size.width, pane.size.height);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const D = equivalentDistance(placed.distanceM, placed.pose.fov, pane.size.height);
    return { camera, D, pxPerM: 2428 / D, on: (x: number, y: number, z: number) => project([x, y, z], camera, pane.size) };
  };

  // ---------------------------------------------------------------- 水纹

  it('水纹：头一节在 573 到 1600 像素高的各种沙盘栏上一道也不画，另外三节在哪一种上都照常画；门槛是场景里写的 48（照 900 像素高的画面算）', () => {
    expect(scene.water.calmUnderPx).toBe(48);
    const widest = Math.max(...scene.water.rivers.map((r) => r.drawWidthM));
    const leave = (top: number, bottom: number) => ({ top, right: 0, bottom, left: 0 });
    // 四种标准的沙盘栏、别的竖着拿的平板、定格图的两种形状，再加宽屏上高的、矮的窗口（栏 = 窗口宽 − 500，和窗口一样高）
    // 和竖着的大屏幕（栏和窗口一样宽，高是窗口的 56%）：高从 573 到 1600
    const panes = [
      ...[...STANDARD_PANES, ...UPRIGHT_PANES].map((p) => ({ size: p.size, insets: p.insets })),
      { size: { width: 1200, height: 900 }, insets: leave(62, 130) },
      { size: { width: 960, height: 573 }, insets: leave(54, 131) },
      ...[[780, 600], [780, 720], [1180, 1050], [1420, 1080], [1420, 1200], [2060, 1300], [2060, 1440], [2060, 1600], [3340, 1600], [700, 1600], [600, 1600], [500, 573]].map(([width, height]) => ({ size: { width, height }, insets: leave(62, 130) })),
      ...[[900, 896], [1080, 1075], [1440, 1434], [1600, 1600]].map(([width, height]) => ({ size: { width, height }, insets: leave(54, 131) })),
    ];
    expect(Math.min(...panes.map((p) => p.size.height))).toBe(573);
    expect(Math.max(...panes.map((p) => p.size.height))).toBe(1600);
    const seen = new Map<string, { real: number[]; at900: number[] }>();
    for (const pane of panes) {
      for (const heading of headings) {
        const placed = placeCamera(section(heading), scene, samplers, coords, style, pane.size, pane.insets);
        const share = rippleShare(scene.water, placed.distanceM, placed.pose.fov);
        expect(share, `${heading} ${pane.size.width} × ${pane.size.height}`).toBe(heading === VIEW_ALL ? 0 : 1);
        // 摆好的一节交给水面的数：不画是门槛到 1（着色器里一团水纹要“随机数比门槛大”才有，随机数到不了 1），照常是原来的数
        const ripple = rippleFor(section(heading).camera.bearing, placed.distanceM, share);
        expect(ripple.dense).toBe(heading === VIEW_ALL ? 1 : placed.distanceM < 3000 ? 0.3 : 0.5);
        const at900 = (widest * 2428) / equivalentDistance(placed.distanceM, placed.pose.fov, 900);
        const real = (widest * 2428) / equivalentDistance(placed.distanceM, placed.pose.fov, pane.size.height);
        const s = seen.get(heading) ?? { real: [], at900: [] };
        s.real.push(real);
        s.at900.push(at900);
        seen.set(heading, s);
      }
    }
    const range = (list: number[]): string => `${Math.min(...list).toFixed(1)} 到 ${Math.max(...list).toFixed(1)}`;
    console.log(`眉州的水纹（最宽的河 ${widest} 米，${panes.length} 种沙盘栏）：${headings.map((h) => `${h} 真的像素 ${range(seen.get(h)?.real ?? [])}、照 900 高算 ${range(seen.get(h)?.at900 ?? [])}`).join('；')}`);
    // 照真的像素分不开：头一节在最高的沙盘栏上比“正月上蟆颐山”在最矮的上还宽（所以门槛照 900 像素高的画面算）
    expect(Math.max(...(seen.get(VIEW_ALL)?.real ?? []))).toBeGreaterThan(Math.min(...(seen.get(VIEW_HILL)?.real ?? [])));
    // 照 900 高算分得开，两边都留着两成以上的余地
    expect(Math.max(...(seen.get(VIEW_ALL)?.at900 ?? []))).toBeLessThan(48 / 1.2);
    for (const heading of headings.filter((h) => h !== VIEW_ALL)) expect(Math.min(...(seen.get(heading)?.at900 ?? [])), heading).toBeGreaterThan(48 * CALM_RANGE * 1.2);
  });

  it('水纹：门槛到一倍半之间匀着过去，不是一下子换；没有写门槛的沙盘（徐州、黄州）哪一节、多远都照常画，和原来一个数不差', () => {
    const widest = Math.max(...scene.water.rivers.map((r) => r.drawWidthM));
    /** 在 900 像素高、视角 21 度的画面上，最宽的河正好 px 个像素的时候离多远。 */
    const distanceFor = (px: number): number => (widest * 2428) / px;
    expect(rippleShare(scene.water, distanceFor(47.9), 21)).toBe(0);
    expect(rippleShare(scene.water, distanceFor(72.1), 21)).toBe(1);
    let last = 0;
    for (let px = 48; px <= 72; px += 1) {
      const share = rippleShare(scene.water, distanceFor(px), 21);
      expect(share).toBeGreaterThanOrEqual(last);
      // 一个像素一个像素地走，哪一步也不超过一成：没有哪一处是跳的
      expect(share - last, `${px} 像素`).toBeLessThan(0.1);
      last = share;
    }
    expect(last).toBeCloseTo(1, 6);
    expect(rippleShare(scene.water, distanceFor(60), 21)).toBeCloseTo(0.5, 3);
    // 视角小一半，镜头远一倍，画面一样：留几成也一样（看的是画面，不是米数）
    expect(rippleShare(scene.water, distanceFor(60) * (Math.tan((21 * Math.PI) / 360) / Math.tan((10 * Math.PI) / 360)), 10)).toBeCloseTo(0.5, 3);
    // 交给水面的数跟着走：从平常的 0.5 匀着到 1
    expect(rippleFor(38, 36000)).toEqual({ dense: 0.5, turnDeg: 0 });
    expect(rippleFor(38, 36000, 1)).toEqual({ dense: 0.5, turnDeg: 0 });
    expect(rippleFor(38, 36000, 0.5).dense).toBeCloseTo(0.75, 9);
    expect(rippleFor(38, 36000, 0)).toEqual({ dense: 1, turnDeg: 0 });
    expect(rippleFor(70, 2000, 0)).toEqual({ dense: 1, turnDeg: 90 });
    expect(rippleFor(70, 2000)).toEqual({ dense: 0.3, turnDeg: 90 });
    for (const key of realSceneKeys().filter((k) => k !== KEY)) {
      const other = realScene(key).scene;
      expect(other.water.calmUnderPx, key).toBeUndefined();
      for (const distance of [500, 5000, 50000, 5e6]) expect(rippleShare(other.water, distance, 21), `${key} ${distance}`).toBe(1);
    }
  });

  // ---------------------------------------------------------------- 浮桥

  describe('浮桥', () => {
    const bridge = thing('bridge');
    const { pass } = soloPass();
    const plan = pontoonPlan(pass, bridge);
    if (!plan) throw new Error('浮桥摆不出来');
    const at = (d: number): Vec2 => [plan.a[0] + ((plan.b[0] - plan.a[0]) * d) / plan.length, plan.a[1] + ((plan.b[1] - plan.a[1]) * d) / plan.length];
    const drawnWet = (x: number, z: number): boolean => mesh(x, z) < normal && samplers.waterH(x, z) < normal - 0.25;
    const foot = scene.water.rivers.find((r) => r.id === 'minjiang-foot');
    const main = scene.water.rivers.find((r) => r.id === 'minjiang');
    if (!foot || !main) throw new Error('场景里没有那两股水');

    it('只在“正月上蟆颐山”一节有；别的三节江上是渡船', () => {
      expect(bridge.kind).toBe('pontoon-bridge');
      expect(headings.filter((h) => existsAt(bridge.when, h, headings))).toEqual([VIEW_HILL]);
      expect(section(VIEW_HILL).strips.map((id) => scene.strips.find((s) => s.id === id)?.of)).toContain('bridge');
      const ferry = scene.dressing.find((d) => d.id === 'boats-ferry');
      expect(ferry?.kind).toBe('boats');
      expect(headings.filter((h) => existsAt(ferry?.when, h, headings))).toEqual(headings);
      expect(section(VIEW_HILL).line).toContain('浮桥');
      for (const heading of headings.filter((h) => h !== VIEW_HILL)) expect(section(heading).line).not.toContain('桥');
    });

    it('过江的两步画面上都有名字：路到宽的一股水边是“蟆颐津”（题签指着路的尽头，渡船在那里），卵石滩到山脚是“浮桥”；题记两样都说；“浮桥”的点在卵石滩那一头的外面，不压着桥', () => {
      // 题记：从蟆颐津过江，走过浮桥
      const line = section(VIEW_HILL).line;
      expect(line).toContain('蟆颐津');
      expect(line.indexOf('蟆颐津')).toBeLessThan(line.indexOf('浮桥'));
      // “蟆颐津”的题签指着渡口那一点，就是东门来的大路在宽的一股水边的尽头；渡船摆在它前面的水上
      const ferryStrip = scene.strips.find((s) => s.id === 't-ferry');
      expect(ferryStrip).toMatchObject({ text: '蟆颐津', of: 'ferry' });
      expect(section(VIEW_HILL).strips).toEqual(['t-eastgate', 't-ferry', 't-bridge', 't-mayishan', 't-river-ferry']);
      const place = scene.places.find((p) => p.id === 'ferry');
      const road = scene.dressing.find((d) => d.id === 'road-ferry');
      expect(place?.at).toEqual(road?.line?.at(-1));
      const [fx, fz] = local(place?.at);
      // 在岸上（宽的一股的西岸），离水边不到 40 米；离宽的一股的中线比离山脚那一股近
      expect(samplers.edge(fx, fz)).toBeGreaterThan(0);
      expect(samplers.edge(fx, fz)).toBeLessThan(40);
      expect(distLine(fx, fz, main.line.map((p) => coords.toLocal(p)))).toBeLessThan(distLine(fx, fz, foot.line.map((p) => coords.toLocal(p))));
      const boats = scene.dressing.find((d) => d.id === 'boats-ferry');
      expect(Math.hypot(local(boats?.at)[0] - fx, local(boats?.at)[1] - fz)).toBeLessThan(300);
      // “浮桥”的点：在桥线的延长线上、卵石滩那一头（西头）的外面 50 到 70 米，不在桥上
      const strip = scene.strips.find((s) => s.id === 't-bridge');
      const [bx, bz] = local(strip?.at);
      const ux = (plan.b[0] - plan.a[0]) / plan.length;
      const uz = (plan.b[1] - plan.a[1]) / plan.length;
      const along = (bx - plan.a[0]) * ux + (bz - plan.a[1]) * uz;
      const off = Math.abs((bx - plan.a[0]) * -uz + (bz - plan.a[1]) * ux);
      expect(along).toBeLessThan(-50);
      expect(along).toBeGreaterThan(-70);
      expect(off).toBeLessThan(5);
      // 画面上：这个点（半径四个像素）离最近的一条船（远看的一套）的船身，电脑和横着拿的平板上 8 个像素以上，
      // 竖着拿的平板上（画面小一半，船只有三个像素宽）5 个以上——点盖不到桥
      for (const pane of [WIDE, STANDARD_PANES[1], UPRIGHT]) {
        const view = look(VIEW_HILL, pane);
        const strips = section(VIEW_HILL).strips.map((id) => scene.strips.find((s) => s.id === id)).filter((s) => s !== undefined);
        const dot = screenAnchors(strips, scene, samplers, coords, style, view.D, view.camera, pane.size).find((a) => a.id === 't-bridge');
        if (!dot) throw new Error('没有“浮桥”的题签');
        let nearest = Infinity;
        for (const d of plan.hulls) {
          for (const k of [-0.5, 0, 0.5]) {
            const x = plan.a[0] + ux * d - uz * plan.longM * k;
            const z = plan.a[1] + uz * d + ux * plan.longM * k;
            const p = view.on(x, plan.waterY, z);
            nearest = Math.min(nearest, Math.hypot(p.x - dot.x, p.y - dot.y));
          }
        }
        expect(nearest, `${pane.name} 上“浮桥”的点离最近的船`).toBeGreaterThan(pane === UPRIGHT ? 5 : 8);
        expect(nearest, `${pane.name} 上“浮桥”的点离最近的船`).toBeLessThan(40);
      }
    });

    it('嘉州的题签挂在江流出沙盘的地方：在沙盘的南边上，离江的中线和南边的交点不到 30 米（规则 15 放宽的那一条）', () => {
      const strip = scene.strips.find((s) => s.id === 't-jiazhou');
      const [x, z] = local(strip?.at);
      expect(Math.abs(z - coords.z1)).toBeLessThan(1);
      const line = main.line.map((p) => coords.toLocal(p));
      let exit: number | null = null;
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, az] = line[i];
        const [bxx, bzz] = line[i + 1];
        if ((az - coords.z1) * (bzz - coords.z1) < 0) exit = ax + ((bxx - ax) * (coords.z1 - az)) / (bzz - az);
      }
      expect(exit).not.toBeNull();
      expect(Math.abs(x - (exit ?? 0))).toBeLessThan(30);
      // 依据里说了题签为什么挂在这里；头一节的画面上四种沙盘栏都摆得下它（scene-strips 的测试查）
      expect(scene.far.find((f) => f.id === 'jiazhou')?.basis).toContain('题签');
      expect(section(VIEW_ALL).strips).toContain('t-jiazhou');
    });

    it('两头在干地上，离山脚下那一股水的岸不到 60 米；跨的是这一股，不是西边宽的一股', () => {
      const footLine = foot.line.map((p) => coords.toLocal(p));
      const mainLine = main.line.map((p) => coords.toLocal(p));
      const said: string[] = [];
      for (const [name, [x, z]] of [['西头', plan.a], ['东头', plan.b]] as const) {
        expect(samplers.height(x, z), `${name}的地面`).toBeGreaterThan(normal + 0.5);
        expect(drawnWet(x, z), `${name}在水里`).toBe(false);
        const toBank = samplers.edge(x, z);
        expect(toBank, `${name}离岸`).toBeGreaterThan(0);
        expect(toBank, `${name}离岸`).toBeLessThan(60);
        // 最近的是山脚下那一股
        expect(distLine(x, z, footLine), `${name}离山脚下那一股的中线`).toBeLessThan(distLine(x, z, mainLine));
        expect(distLine(x, z, footLine)).toBeLessThan(foot.drawWidthM / 2 + 60);
        said.push(`${name}离岸 ${toBank.toFixed(0)} 米、比水面高 ${(samplers.height(x, z) - normal).toFixed(1)} 米`);
      }
      // 两头在这一股水的两边
      const side = ([x, z]: Vec2): number => {
        let best = Infinity;
        let sign = 0;
        for (let i = 0; i < footLine.length - 1; i++) {
          const [ax, az] = footLine[i];
          const [bx, bz] = footLine[i + 1];
          const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / ((bx - ax) ** 2 + (bz - az) ** 2)));
          const d = Math.hypot(x - ax - (bx - ax) * t, z - az - (bz - az) * t);
          if (d < best) {
            best = d;
            sign = Math.sign((bx - ax) * (z - az) - (bz - az) * (x - ax));
          }
        }
        return sign;
      };
      expect(side(plan.a) * side(plan.b)).toBe(-1);
      console.log(`眉州的浮桥：全长 ${plan.length.toFixed(0)} 米，${said.join('；')}`);
    });

    it('有水的一截是从地形板上读的：这一截里处处地形板低过水面、水也画得出来，两头以外不是；船只摆在这一截里，一条挨一条', () => {
      expect(plan.wet).not.toBeNull();
      const [w0, w1] = plan.wet as [number, number];
      expect(w0).toBeGreaterThan(5);
      expect(w1).toBeLessThan(plan.length - 5);
      expect(w1 - w0).toBeGreaterThan(100);
      for (let d = w0; d <= w1; d += 1) expect(drawnWet(...at(d)), `沿桥线 ${d.toFixed(0)} 米处`).toBe(true);
      // 再往外一步（量水的步子是 2 米）就不算有水了
      expect(drawnWet(...at(w0 - PONTOON.stepM * 1.5))).toBe(false);
      expect(drawnWet(...at(w1 + PONTOON.stepM * 1.5))).toBe(false);
      // 船
      const n = plan.hulls.length;
      const pitch = (w1 - w0) / n;
      expect(plan.beamM).toBeCloseTo(pitch * PONTOON.beam, 6);
      expect(plan.longM).toBeCloseTo(plan.beamM * PONTOON.long, 6);
      plan.hulls.forEach((d, i) => {
        // 船宽的两边都还在有水的一截里；和下一条的间隔正好是一条船占的那一段
        expect(d - plan.beamM / 2, `第 ${i + 1} 条`).toBeGreaterThanOrEqual(w0 - 1e-6);
        expect(d + plan.beamM / 2, `第 ${i + 1} 条`).toBeLessThanOrEqual(w1 + 1e-6);
        if (i > 0) expect(d - plan.hulls[i - 1]).toBeCloseTo(pitch, 6);
        // 船身横在桥线上，船头船尾也在水里（船身顺着水流）
        const [x, z] = at(d);
        const ux = (plan.b[0] - plan.a[0]) / plan.length;
        const uz = (plan.b[1] - plan.a[1]) / plan.length;
        for (const along of [-0.5, -0.25, 0, 0.25, 0.5]) expect(samplers.waterH(x - uz * plan.longM * along, z + ux * plan.longM * along), `第 ${i + 1} 条的船身`).toBeLessThan(normal);
      });
      // 桥板比船帮高，比水面高不过 12
      expect(plan.deckY).toBeGreaterThan(plan.waterY + (PONTOON.freeY * plan.beamM) / 9);
      expect(plan.deckY - plan.waterY).toBeLessThan(12);
      console.log(`眉州的浮桥：有水的一截 ${w0.toFixed(0)} 到 ${w1.toFixed(0)} 米（${(w1 - w0).toFixed(0)} 米），${n} 条船，一条占 ${pitch.toFixed(1)} 米，船宽 ${plan.beamM.toFixed(1)} 米、长 ${plan.longM.toFixed(0)} 米；桥板宽 ${plan.deckM.toFixed(1)} 米，比水面高 ${(plan.deckY - plan.waterY).toFixed(1)}`);
    });

    it('镜头远了船造得大一些、少一些：在这一节的画面上一条船电脑上至少 4 个像素宽、14 个像素长，至少 5 条；贴近了看是十米一条', () => {
      const wide = look(VIEW_HILL, WIDE);
      const upright = look(VIEW_HILL, UPRIGHT);
      console.log(`眉州的浮桥在“${VIEW_HILL}”：电脑上船宽 ${(plan.beamM * wide.pxPerM).toFixed(1)}、长 ${(plan.longM * wide.pxPerM).toFixed(1)} 像素，竖着拿的平板上 ${(plan.beamM * upright.pxPerM).toFixed(1)}、${(plan.longM * upright.pxPerM).toFixed(1)} 像素；${plan.hulls.length} 条`);
      expect(plan.hulls.length).toBeGreaterThanOrEqual(5);
      expect(plan.beamM * wide.pxPerM).toBeGreaterThanOrEqual(4);
      expect(plan.longM * wide.pxPerM).toBeGreaterThanOrEqual(14);
      expect(plan.beamM * upright.pxPerM).toBeGreaterThanOrEqual(2.5);
      // 一条占的那一段：这一节的镜头写的距离 ÷ 480，比 10 米大
      const want = section(VIEW_HILL).camera.distanceM / PONTOON.farOver;
      expect(want).toBeGreaterThan(PONTOON.pitchM);
      const [w0, w1] = plan.wet as [number, number];
      expect(plan.hulls.length).toBe(Math.round((w1 - w0) / want));
      // 同一座桥要是每一节都在（最近的一节 3400 米）：十米一条
      const always = pontoonPlan(pass, { ...bridge, when: undefined });
      expect(always?.hulls.length).toBe(Math.round((w1 - w0) / PONTOON.pitchM));
      expect(always?.beamM).toBeCloseTo(((w1 - w0) / (always?.hulls.length ?? 1)) * PONTOON.beam, 6);
    });

    const ux = (plan.b[0] - plan.a[0]) / plan.length;
    const uz = (plan.b[1] - plan.a[1]) / plan.length;
    const near = section(VIEW_HILL).camera.distanceM;
    /** 造出来的三套：贴近的、中间的、远看的（各一个批次），和照同一个算法算出来的三套样子。 */
    const built = (): { fromM: number[]; batches: Batch[]; plans: NonNullable<ReturnType<typeof pontoonPlans>>['plans']; main: Batch } => {
      const { pass: solo, main, bucket } = soloPass();
      builders['pontoon-bridge']?.(solo, bridge);
      const set = pontoonPlans(solo, bridge);
      if (!set || bucket.steps?.length !== 1) throw new Error('浮桥没有造成“照远近换着显”的几套');
      return { ...bucket.steps[0], plans: set.plans, main };
    };

    it('造得出来：三套（贴近的、中间的、远看的），都是木头的颜色，远看的一套三角形不到 700 个；船身都在水上，没有一个顶点高过桩顶', () => {
      const { fromM, batches, plans, main } = built();
      // 三套都放在“照远近换着显”的那一格里，平常的批次里没有它
      expect(main.parts.size).toBe(0);
      expect(fromM).toEqual([0, near * PONTOON.midFrom, near * PONTOON.farFrom]);
      expect(fromM).toEqual([0, 3840, 6000]);
      expect(batches).toHaveLength(3);
      const [w0, w1] = plan.wet as [number, number];
      // 贴近的十米一条；远看的就是这一节摆好时的那一套；中间的在两头之间
      expect(plans[0].hulls.length).toBe(Math.round((w1 - w0) / PONTOON.pitchM));
      expect(plans[2].hulls).toEqual(plan.hulls);
      expect(plans[1].hulls.length).toBeGreaterThan(plans[2].hulls.length);
      expect(plans[1].hulls.length).toBeLessThan(plans[0].hulls.length);
      console.log(`眉州的浮桥三套：${plans.map((p, k) => `从 ${fromM[k]} 米起 ${p.hulls.length} 条船（宽 ${p.beamM.toFixed(1)}、长 ${p.longM.toFixed(0)} 米），${batches[k].tris} 个三角形`).join('；')}`);
      expect(batches[2].tris).toBeGreaterThan(200);
      expect(batches[2].tris).toBeLessThan(700);
      expect(batches[0].tris).toBeGreaterThan(batches[2].tris * 2);
      batches.forEach((batch, k) => {
        expect([...batch.parts.keys()], `第 ${k + 1} 套`).toEqual(['plainTimber']);
        const p = plans[k];
        const points = vertices(batch, 'plainTimber');
        // 没有一个顶点高过桥板的顶面和两头的桩顶
        const top = Math.max(...points.map((q) => q[1]));
        const ends = [p.a, p.b].map(([x, z]) => seenY(x, z));
        expect(top).toBeLessThan(Math.max(p.deckY, ...ends) + PONTOON.postY + 3);
        // 船身的顶点没有落在岸上的：离桥线远的那些顶点（船头船尾）脚下都是水
        const far = points.filter(([x, , z]) => Math.abs((x - p.a[0]) * -uz + (z - p.a[1]) * ux) > p.deckM);
        expect(far.length).toBeGreaterThan(50);
        for (const [x, , z] of far) expect(samplers.waterH(x, z), `第 ${k + 1} 套船身的一点 (${x.toFixed(0)}, ${z.toFixed(0)})`).toBeLessThan(normal);
      });
    });

    it('桥板在岸上不埋进地里，也不悬着：桥头贴着读者看得见的那块地，往水边匀着升到水上桥板的高；两头的桩立在那块地上（三套都是）', () => {
      const { batches, plans } = built();
      batches.forEach((batch, k) => {
        const p = plans[k];
        const [w0, w1] = p.wet as [number, number];
        // 桥板的零件上了浅色（绿的那一路是 6），船身和桩没有
        const deck = partsOf(batch, 'plainTimber').filter((g) => Math.abs(g.attributes.color.getY(0) - 6) < 1e-6);
        expect(deck.length, `第 ${k + 1} 套桥板的段数`).toBeGreaterThanOrEqual(5);
        let ends = 0;
        let onBank = 0;
        for (const g of deck) {
          const pos = g.attributes.position;
          // 这一段两头在桥线上的位置，和各自顶面的高
          const along = Array.from({ length: pos.count }, (_, i) => (pos.getX(i) - p.a[0]) * ux + (pos.getZ(i) - p.a[1]) * uz);
          for (const end of [Math.min(...along), Math.max(...along)]) {
            // 这一段是斜的，它两头的面跟着歪一点：离这一头不到一米的顶点都算这一头的，顶面是其中最高的，位置取它们的平均
            let y = -Infinity;
            let sum = 0;
            let count = 0;
            for (let i = 0; i < pos.count; i++) {
              if (Math.abs(along[i] - end) >= 1) continue;
              y = Math.max(y, pos.getY(i));
              sum += along[i];
              count += 1;
            }
            const d = sum / count;
            const [x, z] = [p.a[0] + ux * d, p.a[1] + uz * d];
            const seen = seenY(x, z);
            const where = `第 ${k + 1} 套沿桥线 ${d.toFixed(0)} 米处`;
            if (d >= w0 - 0.5 && d <= w1 + 0.5) {
              // 水上：平的，就是桥板的高
              expect(Math.abs(y - p.deckY), where).toBeLessThan(1);
              continue;
            }
            onBank += 1;
            // 岸上：顶面不低过看得见的地（不埋），也不高过水上的桥板；底面离地不比“水上的桥板离水面”再高（不悬在岸的上空）
            expect(y - seen, `${where}埋进地里了`).toBeGreaterThanOrEqual(PONTOON.landY - 1);
            expect(y, `${where}比水上的桥板还高`).toBeLessThanOrEqual(p.deckY + 1e-6);
            // （水边的地形板有的地方比水面还低一点，水没有画出来的那几米：从水面量）
            expect(y - 1.2 - Math.max(seen, p.waterY), `${where}悬着`).toBeLessThan(p.deckY - p.waterY);
            // 两个桥头：顶面正好比看得见的地高 landY（桥板一米二厚，底面贴着地、陷进去不到半米）
            if (d < 0.5 || d > p.length - 0.5) {
              ends += 1;
              // （这一段是斜的，它两头的面跟着歪一点，顶面的角不正好在桥头那一点的正上方：留一个单位的量，合十几厘米）
              expect(Math.abs(y - seen - PONTOON.landY), `${where}（桥头）`).toBeLessThan(1);
            }
          }
        }
        expect(ends, `第 ${k + 1} 套的两个桥头`).toBe(2);
        expect(onBank).toBeGreaterThanOrEqual(6);
        // 桩：四根，各比它脚下看得见的地低 2、高出 postY
        const posts = partsOf(batch, 'plainTimber').filter((g) => {
          const pos = g.attributes.position;
          const xs = Array.from({ length: pos.count }, (_, i) => pos.getX(i));
          return pos.count === 36 && Math.max(...xs) - Math.min(...xs) < 2.01 && Math.abs(g.attributes.color.getY(0) - 1) < 1e-6;
        });
        expect(posts, `第 ${k + 1} 套的桩`).toHaveLength(4);
        for (const g of posts) {
          const pos = g.attributes.position;
          const ys = Array.from({ length: pos.count }, (_, i) => pos.getY(i));
          const x = (Math.max(...Array.from({ length: pos.count }, (_, i) => pos.getX(i))) + Math.min(...Array.from({ length: pos.count }, (_, i) => pos.getX(i)))) / 2;
          const z = (Math.max(...Array.from({ length: pos.count }, (_, i) => pos.getZ(i))) + Math.min(...Array.from({ length: pos.count }, (_, i) => pos.getZ(i)))) / 2;
          expect(Math.min(...ys)).toBeCloseTo(seenY(x, z) - 2, 4);
          expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(PONTOON.postY + 2, 4);
        }
      });
    });

    it('读者把镜头推近，船不还是远看的那几条大船：这一节摆好的远近上（573 到 1600 像素高的沙盘栏）是远看的一套，四千米是中间的一套，一千五百米是贴近的一套；换的是开关，不重造；界线上下一成多里不来回换', () => {
      const models = buildModels(ctx);
      const sets: Object3D[] = [];
      const shown = (D: number, heading = VIEW_HILL): number[] => {
        models.apply(heading, normal, D);
        if (sets.length === 0) models.group.traverse((o) => void (o.name === 'step' && sets.push(o)));
        return sets.flatMap((o, k) => (o.visible && o.parent?.visible ? [k] : []));
      };
      // 这一节在各种沙盘栏上摆好的远近：都是远看的一套（和定格图一样）
      const placedD = [WIDE, STANDARD_PANES[1], UPRIGHT, STANDARD_PANES[3]].map((pane) => look(VIEW_HILL, pane).D);
      const tall = equivalentDistance(near, 21, 1600);
      expect(tall).toBeGreaterThan(6000 * STEP_HOLD);
      for (const D of [...placedD, tall]) expect(shown(D), `${D.toFixed(0)} 米`).toEqual([2]);
      expect(sets).toHaveLength(3);
      const meshes = (): string[] => {
        const out: string[] = [];
        models.group.traverse((o) => void ((o as Mesh).isMesh && out.push((o as Mesh).geometry.uuid)));
        return out.sort();
      };
      const before = meshes();
      const trisFar = models.triangles();
      expect(shown(4000)).toEqual([1]);
      const trisMid = models.triangles();
      expect(shown(1500)).toEqual([0]);
      const trisClose = models.triangles();
      // 三套各多少个三角形，读数跟着换
      const { batches, plans } = built();
      expect(trisMid - trisFar).toBe(batches[1].tris - batches[2].tris);
      expect(trisClose - trisFar).toBe(batches[0].tris - batches[2].tris);
      // 推近了不是那几条九十多米长的大船：一千五百米上船长三十来米，画面上船宽十几个像素
      expect(plans[2].longM).toBeGreaterThan(90);
      expect(plans[0].longM).toBeLessThan(40);
      expect((plans[0].beamM * 2428) / 1500).toBeGreaterThan(10);
      // 每一套在它那一段的两头，一条船在画面上都有四个像素以上宽（远看的一套算到竖着拿的平板的这一节）
      expect((plans[0].beamM * 2428) / 3840).toBeGreaterThan(4);
      expect((plans[1].beamM * 2428) / 6000).toBeGreaterThan(4);
      expect((plans[2].beamM * 2428) / near).toBeGreaterThan(4);
      // 界线上下一成多里不来回换：从近处推远，过了 3840 的 1.12 倍才换；从远处拉近，到了 3840 ÷ 1.12 以下才换
      expect(shown(3840 * 1.1)).toEqual([0]);
      expect(shown(3840 * 1.13)).toEqual([1]);
      expect(shown(3840 / 1.1)).toEqual([1]);
      expect(shown(6000 * 1.1)).toEqual([1]);
      expect(shown(6000 * 1.13)).toEqual([2]);
      expect(shown(6000 / 1.1)).toEqual([2]);
      expect(shown(6000 / 1.13)).toEqual([1]);
      expect(shown(3840 / 1.13)).toEqual([0]);
      // 一下子跳得远：换成那个远近该显的一套
      expect(shown(near)).toEqual([2]);
      expect(shown(1500)).toEqual([0]);
      // 换来换去，网格还是那几个，形状一个也没有重造
      expect(meshes()).toEqual(before);
      // 别的小节里没有桥：三套都不显
      expect(shown(30000, VIEW_ALL)).toEqual([]);
      expect(shown(near)).toEqual([2]);
      models.dispose();
      // 另一座刚摆出来的沙盘，头一帧就在四千米：中间的一套
      const fresh = buildModels(ctx);
      fresh.apply(VIEW_HILL, normal, 4000);
      const first: number[] = [];
      let k = 0;
      fresh.group.traverse((o) => void (o.name === 'step' && (o.visible && first.push(k), (k += 1))));
      expect(first).toEqual([1]);
      fresh.dispose();
    });
  });

  // ---------------------------------------------------------------- 坟、泉、亭

  describe('墓地：两座坟、老翁泉、泉边的亭子', () => {
    const parents = thing('grave-parents');
    const wangfu = thing('grave-wangfu');
    const spring = thing('spring');
    const pavilion = thing('spring-pavilion');
    const [px, pz] = local(parents.at);
    const [wx, wz] = local(wangfu.at);
    const [sx, sz] = local(spring.at);
    const [vx, vz] = local(pavilion.at);

    it('四样都只在“老翁泉”一节有；别的三节那里是空的山坡', () => {
      for (const item of [parents, wangfu, spring, pavilion]) expect(headings.filter((h) => existsAt(item.when, h, headings)), item.id).toEqual([VIEW_GRAVES]);
      expect(parents.kind).toBe('grave-mound');
      expect(parents.params?.size).toBe('large');
      expect(wangfu.params?.size).toBe('small');
      expect(spring.kind).toBe('pool');
      expect(spring.params).toEqual({ size: 'small', stone: true });
      // 亭子排在最后：前面三样不跟着它整组放大（kit/figure.ts 的 figureGroups 只收排在主角后面的）
      expect(scene.things[scene.things.length - 1].id).toBe('spring-pavilion');
    });

    it('一大一小挨着：小的在大的西北，两座碰得着，小的没有被大的吞掉；泉在坟的西南', () => {
      const apart = Math.hypot(wx - px, wz - pz);
      console.log(`眉州的墓：两座坟的中心相距 ${apart.toFixed(1)} 米（半径 ${MOUND.large.r} 和 ${MOUND.small.r}）；泉离大坟 ${Math.hypot(sx - px, sz - pz).toFixed(0)} 米；亭子离泉 ${Math.hypot(vx - sx, vz - sz).toFixed(0)} 米`);
      expect(apart).toBeLessThanOrEqual(MOUND.large.r + MOUND.small.r);
      expect(apart).toBeGreaterThan(MOUND.large.r + 2);
      // 西北：往西、往北（沙盘上北是 −z）
      expect(wx).toBeLessThan(px);
      expect(wz).toBeLessThan(pz);
      // 西南
      expect(sx).toBeLessThan(px);
      expect(sz).toBeGreaterThan(pz);
      expect(Math.hypot(sx - px, sz - pz)).toBeGreaterThan(MOUND.large.r + 20);
      expect(Math.hypot(sx - px, sz - pz)).toBeLessThan(110);
    });

    it('坟的脚落在读者看得见的那块地上：最下面一圈的顶点不比那里的地面高，裙边再往下埋 3；冢顶比这一圈的平均高出 17、10.5', () => {
      for (const [item, size] of [[parents, MOUND.large], [wangfu, MOUND.small]] as const) {
        const { pass, main } = soloPass();
        builders['grave-mound']?.(pass, item);
        expect([...main.parts.keys()], item.id).toEqual(['works']);
        // 每一面：两圈坡面各一格、顶上一格、裙边一格，一格两个三角形
        expect(main.tris, item.id).toBe(MOUND.sides * 8);
        const [cx, cz] = local(item.at);
        const points = vertices(main, 'works');
        const rim = points.filter(([x, , z]) => Math.abs(Math.hypot(x - cx, z - cz) - size.r) < 0.01);
        expect(rim.length).toBeGreaterThan(MOUND.sides);
        const feet: number[] = [];
        for (const [x, y, z] of rim) {
          const seen = seenY(x, z);
          // 这一圈上的顶点只有两种：贴着地面的，和它下面 3 的
          expect(Math.min(Math.abs(y - seen), Math.abs(y - (seen - MOUND.underY))), `${item.id} (${x.toFixed(1)}, ${z.toFixed(1)}) 的 ${y.toFixed(2)}`).toBeLessThan(1e-3);
          feet.push(seen);
        }
        const mean = Array.from({ length: MOUND.sides }, (_, i) => seenY(cx + Math.cos((i / MOUND.sides) * 6.2832) * size.r, cz + Math.sin((i / MOUND.sides) * 6.2832) * size.r)).reduce((a, b) => a + b, 0) / MOUND.sides;
        // 冢顶（正中的那一点）：坡上靠山的一边，圈上的顶点可以比它高一点，冢是顺着坡歪的
        const top = Math.max(...points.filter(([x, , z]) => Math.hypot(x - cx, z - cz) < 0.01).map((p) => p[1]));
        expect(top, item.id).toBeCloseTo(mean + size.h, 3);
        expect(Math.max(...points.map((p) => p[1])) - top, `${item.id} 圈上最高的顶点比冢顶高出`).toBeLessThan(size.h * 0.35);
        // 坡不陡：这一圈脚下高低差不到 14（坟自己高 13、8）
        const span = Math.max(...feet) - Math.min(...feet);
        console.log(`眉州的${item.name}：脚下那一圈的地面高低差 ${span.toFixed(1)}，冢顶比平均高 ${size.h}`);
        expect(span, item.id).toBeLessThan(14);
      }
    });

    it('老翁泉的池：水面是平的，地面和地形板都盖不住它；池沿砌石，往下接到看得见的那块地以下；下坡那一面不高过 12', () => {
      const { pass, main } = soloPass();
      builders.pool?.(pass, spring);
      // 每一面：水面、池沿的顶、里面、外面各一格
      expect(main.tris).toBe(POOL.sides * 8);
      const points = vertices(main, 'works');
      const r = 9;
      const out = r + POOL.kerbM.small;
      const near = (radius: number) => points.filter(([x, , z]) => Math.abs(Math.hypot(x - sx, z - sz) - radius) < 0.01);
      const water = Math.min(...near(r).map((p) => p[1]));
      // 水面那一圈和正中是一个高度
      expect(points.filter(([x, , z]) => Math.hypot(x - sx, z - sz) < 0.01).every((p) => Math.abs(p[1] - water) < 1e-6)).toBe(true);
      let highest = -Infinity;
      let lowest = Infinity;
      for (let i = 0; i < 72; i++) {
        const x = sx + Math.cos((i / 72) * 6.2832) * out;
        const z = sz + Math.sin((i / 72) * 6.2832) * out;
        highest = Math.max(highest, seenY(x, z));
        lowest = Math.min(lowest, seenY(x, z));
      }
      for (let i = 0; i < 36; i++) for (const k of [0, 0.5, 1]) expect(seenY(sx + Math.cos((i / 36) * 6.2832) * r * k, sz + Math.sin((i / 36) * 6.2832) * r * k), '水面下面的地').toBeLessThan(water);
      expect(water - highest).toBeGreaterThan(0.3);
      expect(water - highest).toBeLessThan(POOL.aboveY + 0.5);
      // 池沿：顶比水面高 1.6（砌石）；外面那一圈最低的顶点在看得见的那块地以下 3
      const rim = near(out);
      expect(Math.max(...rim.map((p) => p[1]))).toBeCloseTo(water + POOL.stoneY, 4);
      for (const [x, y, z] of rim) if (y < water) expect(y, `池沿的脚 (${x.toFixed(1)}, ${z.toFixed(1)})`).toBeCloseTo(seenY(x, z) - POOL.underY, 3);
      console.log(`眉州的老翁泉：水面比池沿脚下最高的地面高 ${(water - highest).toFixed(1)}，下坡那一面的池沿露出来 ${(water + POOL.stoneY - lowest).toFixed(1)}`);
      expect(water + POOL.stoneY - lowest).toBeLessThan(12);
    });

    it('墓地是一组：大坟是主角，小坟、泉、亭子跟着它整组放大、从它的脚摊开（和地上的亭一类）', () => {
      const group = figureGroups(scene, style).find((g) => g.main === 'grave-parents');
      expect(group?.cls).toBe('pavilion');
      expect(group?.members).toEqual(['grave-wangfu', 'spring', 'spring-pavilion']);
      // 造出来的四样带着同一类的记号；跟着的三样从大坟的脚摊开
      const { pass, main } = soloPass();
      for (const item of [parents, wangfu]) builders['grave-mound']?.(pass, item);
      builders.pool?.(pass, spring);
      THING_BUILDERS.pavilion(pass, pavilion);
      const all = [...main.parts.values()].flat();
      expect(all.length).toBeGreaterThan(3);
      for (const g of all) {
        const m = marksOf(g);
        expect(m.fig[0]).toBe(FIGURE_SLOT.pavilion);
        expect([m.group[0], m.group[2]].map((v) => Math.round(v))).toEqual([px, pz].map((v) => Math.round(v)));
      }
    });

    it('“老翁泉”一节的画面上：电脑上大坟至少 40 个像素宽、竖着拿的平板上至少 24 个，小坟看得出小一号；亭子不压着池、不挡在坟的前面；三条题签的点两两相距 30 个像素以上；“老翁泉”的点在池沿外面，不盖着水', () => {
      for (const pane of [WIDE, STANDARD_PANES[1], UPRIGHT]) {
        const view = look(VIEW_GRAVES, pane);
        // 这一组在这个远近上放大几倍、从大坟的脚摊开几倍
        const { times, spread } = figureNow(style.figure.rules.pavilion, view.D);
        const widths = [MOUND.large.r * 2 * times * view.pxPerM, MOUND.small.r * 2 * times * view.pxPerM];
        const moved = (x: number, z: number): Vec2 => [px + (x - px) * spread, pz + (z - pz) * spread];
        const on = (x0: number, z0: number, up = 0) => {
          const [x, z] = moved(x0, z0);
          return view.on(x, coords.y(samplers.height(x, z)) + up, z);
        };
        const pool = on(sx, sz);
        const kiosk = on(vx, vz);
        const kioskTop = on(vx, vz, 30 * times);
        const big = on(px, pz);
        const small = on(wx, wz);
        // 亭顶 42 米见方，池连池沿半径 11.5 米
        const roofHalf = 21 * times * view.pxPerM;
        const poolHalf = (9 + POOL.kerbM.small) * times * view.pxPerM;
        const strips = section(VIEW_GRAVES).strips.map((id) => scene.strips.find((s) => s.id === id)).filter((s) => s !== undefined);
        const anchors = screenAnchors(strips, scene, samplers, coords, style, view.D, view.camera, pane.size);
        const dot = (id: string): { x: number; y: number } => {
          const found = anchors.find((a) => a.id === id);
          if (!found) throw new Error(`没有题签 ${id}`);
          return { x: found.x, y: found.y };
        };
        const graves = dot('t-graves');
        const wife = dot('t-wangfu');
        const well = dot('t-spring');
        const apart = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);
        const between = [apart(graves, well), apart(graves, wife), apart(wife, well)];
        const offPool = apart(well, pool);
        console.log(`眉州“${VIEW_GRAVES}” ${pane.name}：这一组放大 ${times.toFixed(2)} 倍；坟宽 ${widths.map((w) => w.toFixed(0)).join('、')} 像素；亭子在池左边 ${(pool.x - kiosk.x).toFixed(0)} 像素（亭顶半宽 ${roofHalf.toFixed(0)}、池半宽 ${poolHalf.toFixed(0)}）；亭顶比小坟的下沿低 ${(kioskTop.y - (small.y + MOUND.small.r * times * view.pxPerM * 0.6)).toFixed(0)} 像素；题签的点：父母的墓—老翁泉 ${between[0].toFixed(0)}、父母的墓—王弗的墓 ${between[1].toFixed(0)}、王弗的墓—老翁泉 ${between[2].toFixed(0)} 像素；“老翁泉”的点离池心 ${offPool.toFixed(0)} 像素`);
        // 大坟：电脑上 40 个像素以上，竖着拿的平板上 24 个以上；小坟是大坟的六成到七成
        if (pane === WIDE) expect(widths[0]).toBeGreaterThanOrEqual(40);
        if (pane === UPRIGHT) expect(widths[0]).toBeGreaterThanOrEqual(24);
        expect(widths[1] / widths[0]).toBeGreaterThan(0.55);
        expect(widths[1] / widths[0]).toBeLessThan(0.7);
        // 题签的点两两相距 30 个像素以上（电脑上）；别的沙盘栏上也不叠在一起
        for (const d of between) expect(d).toBeGreaterThanOrEqual(pane === WIDE ? 30 : 16);
        // “老翁泉”的点在池沿外面：离池心比池连池沿的半宽还远，水露在外面
        expect(offPool).toBeGreaterThan(poolHalf);
        expect(offPool).toBeLessThan(poolHalf + 14);
        // 亭子在池的左边，隔开了：不压着池
        expect(pool.x - kiosk.x).toBeGreaterThan(roofHalf + poolHalf * 0.5);
        // 两座坟都在亭子的上方（更远），亭顶够不着大坟；大坟在亭子右边，隔开了
        expect(big.y).toBeLessThan(kiosk.y);
        expect(small.y).toBeLessThan(kiosk.y);
        expect(big.x - kiosk.x).toBeGreaterThan(roofHalf);
        // 题签指着的东西
        expect(scene.strips.find((s) => s.id === 't-graves')?.of).toBe('grave-parents');
        expect(scene.strips.find((s) => s.id === 't-wangfu')).toMatchObject({ text: '王弗的墓', of: 'grave-wangfu' });
        expect(scene.strips.find((s) => s.id === 't-spring')?.of).toBe('spring');
      }
    });

    it('平常的树不长到坟的跟前：整块沙盘的那条树的规则圈出了墓地四周，圈里、离两座坟 250 米以内一棵也没有；不圈就有', () => {
      const index = scene.dressing.findIndex((d) => d.id === 'trees-hills');
      const rule = scene.dressing[index];
      expect(rule.exceptAreas).toHaveLength(1);
      const area = (rule.exceptAreas?.[0] ?? []).map((p) => coords.toLocal(p));
      // 圈把两座坟、泉、亭子都包在里面，四边离大坟都在 250 米以上
      for (const [x, z] of [[px, pz], [wx, wz], [sx, sz], [vx, vz]]) expect(insidePolygon(area, x, z)).toBe(true);
      for (let i = 0; i < 72; i++) expect(insidePolygon(area, px + Math.cos((i / 72) * 6.2832) * 250, pz + Math.sin((i / 72) * 6.2832) * 250), `大坟四周 250 米的一圈上第 ${i} 点`).toBe(true);
      const colours = makeMaterials(style).treeColours;
      const near = (list: { x: number; z: number; rule: number }[]): number => list.filter((t) => t.rule === index && (insidePolygon(area, t.x, t.z) || Math.hypot(t.x - px, t.z - pz) < 250 || Math.hypot(t.x - wx, t.z - wz) < 250)).length;
      const planted = plantTrees(ctx, surveyWalls(ctx), colours);
      expect(planted.filter((t) => t.rule === index).length).toBeGreaterThan(200);
      expect(near(planted)).toBe(0);
      // 同一条规则不圈：那一片里本来有平常的树
      const open = structuredClone(scene);
      delete open.dressing[index].exceptAreas;
      const before = near(plantTrees({ ...ctx, scene: open }, surveyWalls(ctx), colours));
      console.log(`眉州的墓地四周：不圈的时候那一片里有 ${before} 棵平常的树，圈了以后 0 棵`);
      expect(before).toBeGreaterThan(5);
      // 小松树还在那一片里
      const pines = scene.dressing.findIndex((d) => d.id === 'grave-pines');
      expect(planted.filter((t) => t.rule === pines && insidePolygon(area, t.x, t.z)).length).toBeGreaterThan(40);
    });

    it('墓地四周的松是小松树：只有平常的一半大，矮胖一点；坟、泉、亭子上不种', () => {
      const index = scene.dressing.findIndex((d) => d.id === 'grave-pines');
      const rule = scene.dressing[index];
      expect(rule.params).toMatchObject({ type: 'pine', young: true });
      const trees = plantTrees(ctx, surveyWalls(ctx), makeMaterials(style).treeColours).filter((t) => t.rule === index);
      expect(trees.length).toBeGreaterThan(40);
      for (const t of trees) {
        expect(t.s).toBeGreaterThanOrEqual(6.5);
        expect(t.s).toBeLessThanOrEqual(11.5);
        expect(t.sy).toBeCloseTo(t.s * 0.9, 9);
        for (const [x, z, clear] of [[px, pz, MOUND.large.r], [wx, wz, MOUND.small.r], [sx, sz, 11.5], [vx, vz, 13]] as const) expect(Math.hypot(t.x - x, t.z - z), '小松树离坟、泉、亭').toBeGreaterThan(clear);
      }
      // 同一条规则不写 young：平常的大小（13 到 23）
      const usual = structuredClone(scene);
      delete usual.dressing[index].params?.young;
      const big = plantTrees({ ...ctx, scene: usual }, surveyWalls(ctx), makeMaterials(style).treeColours).filter((t) => t.rule === index);
      expect(big.length).toBe(trees.length);
      big.forEach((t, i) => {
        expect(t.s).toBeCloseTo(trees[i].s * 2, 9);
        expect(t.sy).toBeCloseTo(t.s * 1.1, 9);
        expect([t.x, t.z]).toEqual([trees[i].x, trees[i].z]);
      });
    });

    it('小松树写在一座单座的屋旁边（一个点落在屋的那一块里）也照一半大种，不是悄悄种成平常的大小', () => {
      // 把家里园子的那条规则换成松：不写 young 是平常的大小，写了是一半
      const index = scene.dressing.findIndex((d) => d.id === 'home-garden');
      const planted = (young: boolean) => {
        const copy = structuredClone(scene);
        copy.dressing[index].params = { ...copy.dressing[index].params, type: 'pine', ...(young ? { young: true } : {}) };
        return plantTrees({ ...ctx, scene: copy }, surveyWalls(ctx), makeMaterials(style).treeColours).filter((t) => t.rule === index);
      };
      const usual = planted(false);
      const small = planted(true);
      expect(usual.length).toBeGreaterThanOrEqual(3);
      expect(small.length).toBe(usual.length);
      small.forEach((t, i) => {
        expect(t.s).toBeCloseTo(usual[i].s / 2, 9);
        expect([t.x, t.z]).toEqual([usual[i].x, usual[i].z]);
      });
    });
  });

  // ---------------------------------------------------------------- 家

  describe('纱縠行的家', () => {
    const home = thing('home');
    const pool = thing('home-pool');
    const [hx, hz] = local(home.at);
    const [qx, qz] = local(pool.at);
    const city = ground.cities[0];
    /** 城墙里面要留一块地的东西（城外的池——老翁泉——不算）。 */
    const plots: { id: string; x: number; z: number; half: number }[] = scene.things
      .filter((t) => plotHalfM(t) > 0 && t.at && insidePolygon(city.wall, ...local(t.at)))
      .map((t) => ({ id: t.id, x: local(t.at)[0], z: local(t.at)[1], half: plotHalfM(t) }));

    it('是一户带篱笆的人家（瓦顶的单座的屋，朝南），不是一组院落；池在篱笆里面、屋前的院子里，门口那条道的东边，小一号', () => {
      expect(home.kind).toBe('house');
      expect(home.params).toEqual({ roof: 'tile', fence: true });
      expect(home.facing).toBe(180);
      expect(pool.kind).toBe('pool');
      // 篱笆在屋外东西 26、南北 28 米（屋身 24 × 28，篱笆在外 14 米）；瓦顶的屋长 32、进深 18；门口在南面正中，左右各 9 米。
      // 家里的池小一号（半径、池沿乘 0.72）：连池沿半径 8.3 米，整个在屋和南面的篱笆之间、东面的篱笆以里，不堵着门口正中的那条道
      const out = (9 + POOL.kerbM.small) * POOL.homeTimes;
      const east = qx - hx;
      const south = qz - hz;
      console.log(`眉州的家：池在屋子东边 ${east.toFixed(1)} 米、南边 ${south.toFixed(1)} 米，连池沿半径 ${out.toFixed(1)} 米`);
      expect(south - out).toBeGreaterThan(9 + 0.5);
      expect(south + out).toBeLessThan(28 - 0.5);
      expect(east + out).toBeLessThan(26 - 0.5);
      expect(east - out).toBeGreaterThan(4);
      // 造出来的池真的是小一号：水面和池沿的顶点离池心不超过 8.3 米（裙边不算）
      const { pass, main } = soloPass();
      builders.pool?.(pass, pool);
      const reach = Math.max(...vertices(main, 'works').map(([x, , z]) => Math.hypot(x - qx, z - qz)));
      expect(reach).toBeCloseTo(out, 3);
      // 城里的池塘和老翁泉还是平常的大小
      const { pass: other, main: pond } = soloPass();
      builders.pool?.(other, thing('spring'));
      const [sx, sz] = local(thing('spring').at);
      expect(Math.max(...vertices(pond, 'works').map(([x, , z]) => Math.hypot(x - sx, z - sz)))).toBeCloseTo(9 + POOL.kerbM.small, 3);
      expect(section(VIEW_HOME).line).toContain('小池');
      expect(section(VIEW_HOME).line).toContain('竹子');
    });

    it('家里的小池和老翁泉跟着一组放大：四个画面、三种沙盘栏的远近上，水面都比它脚下画出来的地形板高，高出的那一截跟着放大的倍数长；从一公里到一百三十公里哪个远近上都不落在地面那一层里', () => {
      const said: string[] = [];
      for (const id of ['home-pool', 'spring']) {
        const item = thing(id);
        const { pass, main } = soloPass();
        builders.pool?.(pass, item);
        const [geo] = partsOf(main, 'works');
        const marks = marksOf(geo);
        // 池是跟着一组的（家里的池跟着屋，老翁泉跟着坟）：记号里有类，脚是水面的中心
        expect(marks.fig[0], `${id} 的类`).toBeGreaterThan(0);
        expect(marks.group).not.toEqual(marks.pivot);
        const [cx, cz] = local(item.at);
        const reach = Math.max(...vertices(main, 'works').map(([x, , z]) => Math.hypot(x - cx, z - cz)));
        /** D 这么远时：放大几倍，水面比它脚下（放大以后那一圈里）最高的地形板高多少。 */
        const above = (D: number): { times: number; above: number } => {
          const u = figureAt(D);
          const times = u.uFigTimes.value[Math.round(marks.fig[0])];
          const [x, y, z] = figureMove(marks.pivot, marks, u);
          let top = coords.y(mesh(x, z));
          for (let i = 0; i < 36; i++) for (const k of [0.5, 1]) top = Math.max(top, coords.y(mesh(x + Math.cos((i / 36) * 6.2832) * reach * times * k, z + Math.sin((i / 36) * 6.2832) * reach * times * k)));
          return { times, above: y - top };
        };
        for (const heading of headings.filter((h) => existsAt(item.when, h, headings))) {
          for (const pane of [WIDE, STANDARD_PANES[1], UPRIGHT]) {
            const D = look(heading, pane).D;
            const now = above(D);
            said.push(`${id} ${heading} ${pane.name}：放大 ${now.times.toFixed(2)} 倍，水面高出 ${now.above.toFixed(2)}`);
            expect(now.above, `${id} ${heading} ${pane.name}`).toBeGreaterThanOrEqual(POOL.aboveY * now.times * 0.5);
          }
        }
        let least = Infinity;
        for (const D of sweep()) {
          const now = above(D);
          least = Math.min(least, now.above / now.times);
        }
        said.push(`${id} 一公里到一百三十公里：水面高出的最少是放大倍数的 ${least.toFixed(2)} 倍`);
        expect(least, `${id} 哪个远近上水面离地形板最近`).toBeGreaterThan(0.3);
        // 放大到头时：高出的那一截也大到了头（不比“本来的一截 × 放大的倍数”少）
        const far = above(1_000_000);
        expect(far.above).toBeGreaterThanOrEqual(POOL.aboveY * far.times * 0.8);
      }
      console.log(`眉州的池：${said.join('；')}`);
    });

    it('园子里的几棵树在篱笆里外的那一圈里；屋远了放大、树跟着摊开，哪个远近上都还在城墙里面，不碰墙身', () => {
      const index = scene.dressing.findIndex((d) => d.id === 'home-garden');
      const trees = plantTrees(ctx, surveyWalls(ctx), makeMaterials(style).treeColours).filter((t) => t.rule === index);
      expect(trees.length).toBeGreaterThanOrEqual(3);
      const wall = [...surveyWalls(ctx).walls.values()][0];
      const rule = style.figure.rules.hut;
      let closest = Infinity;
      for (const t of trees) {
        // 近看时：离屋 17 到 28 米（radiusM 32 的五成半到八成半）
        expect(Math.hypot(t.x - hx, t.z - hz)).toBeGreaterThan(17);
        expect(Math.hypot(t.x - hx, t.z - hz)).toBeLessThan(28);
        for (const D of [...sweep(), 1_000_000]) {
          const { times, spread } = figureNow(rule, D);
          const [x, z] = [hx + (t.x - hx) * spread, hz + (t.z - hz) * spread];
          // 细做的树近看 17 米宽乘它的倍数，再跟着屋放大；城墙的墙身从中线往里 26 米
          const clear = -ringDistance(wall.ring, x, z) - 26 - ((17 * t.s) / 2) * times;
          closest = Math.min(closest, clear);
          expect(clear, `园子里的一棵树在 ${D.toFixed(0)} 米上离墙身`).toBeGreaterThan(5);
        }
      }
      console.log(`眉州的家：园子里 ${trees.length} 棵树，放大、摊开的一路上离城墙的墙身最近 ${closest.toFixed(0)} 米`);
    });

    it('城里给这一户人家和每一口池各留了一块地：大街、小巷不从里面过', () => {
      expect(plots.map((p) => p.id).sort()).toEqual(['home', 'home-pool', 'pond-1', 'pond-2', 'pond-3'].filter((id) => scene.things.some((t) => t.id === id)).sort());
      expect(plots.find((p) => p.id === 'home')?.half).toBe(45);
      expect(plots.find((p) => p.id === 'home-pool')?.half).toBe(24);
      expect(city.lanes.length).toBeGreaterThan(4);
      const inPlot = (x: number, z: number): string | undefined => plots.find((p) => Math.abs(x - p.x) < p.half - 0.5 && Math.abs(z - p.z) < p.half - 0.5)?.id;
      for (const [name, lines] of [['小巷', city.lanes], ['大街', city.streets]] as const) {
        for (const line of lines) {
          for (let i = 0; i < line.length - 1; i++) {
            const steps = Math.ceil(Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]) / 5);
            for (let k = 0; k <= steps; k++) {
              const x = line[i][0] + ((line[i + 1][0] - line[i][0]) * k) / steps;
              const z = line[i][1] + ((line[i + 1][1] - line[i][1]) * k) / steps;
              expect(inPlot(x, z), `${name}上的一点 (${x.toFixed(0)}, ${z.toFixed(0)}) 在哪一块地里`).toBeUndefined();
            }
          }
        }
      }
      // 小巷没有短于 40 米的一截
      for (const lane of city.lanes) expect(Math.hypot(lane[lane.length - 1][0] - lane[0][0], lane[lane.length - 1][1] - lane[0][1])).toBeGreaterThanOrEqual(40);
    });

    it('零件库那一边照同一个数让开：造屋的时候登记一块地，民居离它 26 米以上；这一块地跟着屋放大（远了留着的民居让开放大以后的那一块）；家里的池在这一块里，不另登记', () => {
      const { pass } = soloPass();
      THING_BUILDERS.house(pass, home);
      expect(pass.yards).toHaveLength(1);
      const times = style.figure.rules.hut.maxTimes;
      expect(pass.yards[0]).toMatchObject({ cx: hx, cz: hz, hx: 45, hz: 45, grow: times, about: [hx, hz] });
      expect(times).toBeGreaterThan(4);
      const grown = grownYard(pass.yards[0]);
      expect(grown).toMatchObject({ cx: hx, cz: hz, hx: 45 * times, hz: 45 * times });
      // 家里的池放大、摊开到头时还在放大了的这一块地里
      builders.pool?.(pass, pool);
      expect(pass.yards).toHaveLength(1);
      const out = (9 + POOL.kerbM.small) * POOL.homeTimes;
      expect(Math.abs(qx - hx) * times + out * times).toBeLessThan(grown.hx);
      expect(Math.abs(qz - hz) * times + out * times).toBeLessThan(grown.hz);
      expect(inYard(pass.yards[0], hx + 70, hz, 26)).toBe(true);
      expect(inYard(pass.yards[0], hx + 72, hz, 26)).toBe(false);
      // 城里的池塘各登记自己的一块（不放大）；城外的池（老翁泉）不登记
      builders.pool?.(pass, thing('pond-1'));
      expect(pass.yards).toHaveLength(2);
      expect(pass.yards[1]).toMatchObject({ hx: 45, hz: 45 });
      expect(pass.yards[1].grow).toBeUndefined();
      builders.pool?.(pass, thing('spring'));
      expect(pass.yards).toHaveLength(2);
    });

    it('竹在屋的北面，是细高的那一种，一丛一丛的；都在这一户的地块四周，不在篱笆里面', () => {
      const index = scene.dressing.findIndex((d) => d.id === 'home-bamboo');
      const rule = scene.dressing[index];
      expect(rule.params?.type).toBe('bamboo');
      expect(rule.area).toBeDefined();
      const trees = plantTrees(ctx, surveyWalls(ctx), makeMaterials(style).treeColours).filter((t) => t.rule === index);
      console.log(`眉州的家：竹 ${trees.length} 竿`);
      expect(trees.length).toBeGreaterThanOrEqual(20);
      const area = (rule.area ?? []).map((p) => coords.toLocal(p));
      for (const t of trees) {
        expect(t.slim).toBe(true);
        // 丛心在写的那一块里，丛里的各竿离丛心 6 米以内
        expect(insidePolygon(area.map(([x, z]): Vec2 => [x + Math.sign(x - hx) * 6.5, z + Math.sign(z - (hz - 51)) * 6.5]), t.x, t.z)).toBe(true);
        // 在屋的北面，篱笆（屋外 28 米）以外
        expect(hz - t.z).toBeGreaterThan(28);
        expect(Math.abs(t.x - hx)).toBeLessThan(45 + 26);
        expect(hz - t.z).toBeLessThan(45 + 30);
      }
    });
  });

  // ---------------------------------------------------------------- 路、山里的平地

  it('东门到渡口的三段路是大路：在地面上比两旁的平地深十八级以上，四十米以上宽；上山的那一段还是平常的路', { timeout: 60_000 }, () => {
    const type = (id: string): unknown => scene.dressing.find((d) => d.id === id)?.params?.type;
    expect(['road-east', 'road-ferry', 'road-bar'].map(type)).toEqual(['wide', 'wide', 'wide']);
    expect(type('road-hill')).toBe('road');
    const { colour, w } = paintColour(ground, style.ground);
    const step = ground.cell / 2;
    const lum = (x: number, z: number): number => {
      const k = (Math.round((z - ground.z0) / step) * w + Math.round((x - ground.x0) / step)) * 4;
      return 0.2126 * colour[k] + 0.7152 * colour[k + 1] + 0.0722 * colour[k + 2];
    };
    const road = scene.dressing.find((d) => d.id === 'road-ferry');
    const line = (road?.line ?? []).map((p) => coords.toLocal(p));
    // 第一段的正中，和它两边垂直方向上的一排点
    const [ax, az] = line[0];
    const [bx, bz] = line[1];
    const len = Math.hypot(bx - ax, bz - az);
    const [nx, nz] = [-(bz - az) / len, (bx - ax) / len];
    const across = (d: number): number => {
      // 沿路 200 米取平均：田块的颜色一块一块不一样
      let sum = 0;
      for (let k = 0; k < 20; k++) sum += lum(ax + ((bx - ax) * (0.3 + 0.4 * (k / 19))) + nx * d, az + ((bz - az) * (0.3 + 0.4 * (k / 19))) + nz * d);
      return sum / 20;
    };
    const centre = across(0);
    const plain = (across(120) + across(-120) + across(160) + across(-160)) / 4;
    let width = 0;
    for (let d = -80; d <= 80; d += 5) if (plain - across(d) > (plain - centre) / 2) width += 5;
    console.log(`眉州的大路（小河到渡口的一段）：路心亮度 ${centre.toFixed(0)}，两旁的平地 ${plain.toFixed(0)}，差 ${(plain - centre).toFixed(0)} 级；深到一半以上的有 ${width} 米宽`);
    // 改以前（平常的路）在图上量到的是 12 到 17 级
    expect(plain - centre).toBeGreaterThanOrEqual(18);
    expect(width).toBeGreaterThanOrEqual(40);
    expect(width).toBeLessThanOrEqual(70);
  });

  it('江东山里的五块浅色的平地上都种了树，每一块二十棵以上', () => {
    const flats = scene.dressing.filter((d) => d.id.startsWith('trees-flat-'));
    expect(flats).toHaveLength(5);
    const trees = plantTrees(ctx, surveyWalls(ctx), makeMaterials(style).treeColours);
    for (const rule of flats) {
      const index = scene.dressing.indexOf(rule);
      const mine = trees.filter((t) => t.rule === index);
      expect(rule.class).toBe('dressing');
      expect(mine.length, rule.id).toBeGreaterThanOrEqual(20);
      const area = (rule.area ?? []).map((p) => coords.toLocal(p));
      for (const t of mine) expect(insidePolygon(area, t.x, t.z)).toBe(true);
      // 都在江东
      for (const [x] of area) expect(x).toBeGreaterThan(coords.toLocal([103.876, 30.05])[0]);
    }
  });
});

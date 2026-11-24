// 场景验收：眉州这座沙盘上的模型，照建造设计该有的样子查一遍。在 Node 里跑，不要浏览器。
// 各座沙盘都要查的那些（预算、每一节造不造得出来、船不搁在岸上、民居不压着、题签摆得下）在 scene-budgets、scene-models、
// scene-figures、scene-cameras、scene-strips 里；地面的事在 meishan-ground.test.ts；这里只查眉州自己的模型：
//   水纹    头一节（看全景）整片水面不画水纹，“正月上蟆颐山”照画；没有写门槛的沙盘哪一节都画。
//   浮桥    只在“正月上蟆颐山”一节有；有水的一截是从地形板上读出来的，船只摆在这一截里，一条挨一条；
//           两头在干地上，离山脚下那一股水的岸不到 60 米；在那一节的画面上一条船至少 4 个像素宽。
//   坟      一大一小挨着，小的没有被大的吞掉；每座的脚落在读者看得见的那块地上（高程和地形板里低的那个），不悬着；
//           在“老翁泉”一节电脑的画面上各不到 14 个像素宽的不行；“父母的墓”的题签指着大的那一座，离“老翁泉”的点 30 个像素以上。
//   池      水面是平的，哪一处的地面、地形板都盖不住它；池沿往下接到看得见的那块地以下；老翁泉的池砌石，下坡那一面不高过 12。
//           亭子在池的旁边，画面上不压着池，也不挡在坟的前面。
//   家      一户带篱笆的人家（瓦顶的屋），不是一组院落；它那一块地和池的那一块地里，大街、小巷不过，民居的规则让开；竹在屋的北面，是细高的那一种。
//   小松树  墓地四周的松只有平常的一半大。
//   路      东门到渡口的大路在地面上比平地深十八级以上、四十米以上宽；上山的那一段还是平常的路。
//   山里的平地  五块浅色的平地上都种了树。
// 这里的数调过以后要重新跑；改了定下来的做法，场景文件里的依据要跟着改。

import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';
import type { SceneSection, SceneThing } from '../../src/domain/scene';
import { existsAt, sectionHeadings } from '../../src/domain/sceneText';
import type { LngLat } from '../../src/domain/types';
import { paintColour, plotHalfM } from '../../src/stage/ground';
import type { Vec2 } from '../../src/stage/ground/types';
import { distLine } from '../../src/stage/ground/lines';
import { MOUND, POOL, PONTOON, family as worksFamily, pontoonPlan } from '../../src/stage/three/families/works';
import type { KitContext } from '../../src/stage/three/internal';
import { equivalentDistance } from '../../src/stage/three/kit/figure';
import { Batch } from '../../src/stage/three/kit/geo';
import { makeMaterials } from '../../src/stage/three/kit/materials';
import type { Pass } from '../../src/stage/three/kit/pass';
import { inYard, insidePolygon, surveyWalls } from '../../src/stage/three/kit/site';
import { THING_BUILDERS } from '../../src/stage/three/kit/things';
import { plantTrees } from '../../src/stage/three/kit/trees';
import { meshHeightAt } from '../../src/stage/three/meshHeight';
import { FULL_QUALITY } from '../../src/stage/three/quality';
import { centreShift, placeCamera, project, screenAnchors } from '../../src/stage/three/rig';
import { styleFor } from '../../src/stage/three/style';
import { calmWater, rippleFor } from '../../src/stage/three/water';
import { realScene, realSceneKeys } from './support/realScenes';
import { STANDARD_PANES } from './support/standardPanes';

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
  const soloPass = (): { pass: Pass; main: Batch } => {
    const main = new Batch();
    const bucket = { main, raised: new Batch(), boats: [] };
    return { pass: { ctx, survey: surveyWalls(ctx), yards: [], lots: [], bucket: () => bucket }, main };
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

  it('水纹：头一节整片水面不画（河在画面上比一道水纹还窄），“正月上蟆颐山”照画；门槛是场景里写的 48 个页面像素', () => {
    expect(scene.water.calmUnderPx).toBe(48);
    const widest = Math.max(...scene.water.rivers.map((r) => r.drawWidthM));
    const lines: string[] = [];
    for (const pane of STANDARD_PANES) {
      for (const heading of headings) {
        const { D, pxPerM } = look(heading, pane);
        const calm = calmWater(scene.water, D);
        lines.push(`${heading} ${pane.name}：最宽的河 ${(widest * pxPerM).toFixed(0)} 像素，${calm ? '不画' : '画'}`);
        expect(calm, `${heading} ${pane.name}`).toBe(heading === VIEW_ALL);
        expect(calm).toBe(widest * pxPerM < 48);
      }
    }
    console.log(`眉州的水纹：${lines.join('；')}`);
    // 不画就是疏密写到 2：着色器里那一团一团的水纹要“随机数比疏密大”才有，随机数到不了 1
    expect(rippleFor(38, 36000, true)).toEqual({ dense: 2, turnDeg: 0 });
    expect(rippleFor(38, 36000, false)).toEqual({ dense: 0.5, turnDeg: 0 });
    expect(rippleFor(38, 36000)).toEqual(rippleFor(38, 36000, false));
  });

  it('水纹：没有写门槛的沙盘（徐州、黄州）哪一节、多远都照画，和原来一个数不差', () => {
    for (const key of realSceneKeys().filter((k) => k !== KEY)) {
      const other = realScene(key).scene;
      expect(other.water.calmUnderPx, key).toBeUndefined();
      for (const D of [500, 5000, 50000, 5e6]) expect(calmWater(other.water, D), `${key} ${D}`).toBe(false);
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

    it('造得出来：木头的颜色，三角形不到 700 个；桥板在岸上不埋进地里，两头的桩立在地上', () => {
      const { pass: solo, main } = soloPass();
      builders['pontoon-bridge']?.(solo, bridge);
      expect([...main.parts.keys()]).toEqual(['plainTimber']);
      expect(main.tris).toBeGreaterThan(200);
      expect(main.tris).toBeLessThan(700);
      const points = vertices(main, 'plainTimber');
      // 没有一个顶点高过桥板的顶面和两头的桩顶
      const top = Math.max(...points.map((p) => p[1]));
      const ends = [plan.a, plan.b].map(([x, z]) => seenY(x, z));
      expect(top).toBeLessThan(Math.max(plan.deckY, ...ends) + PONTOON.postY + 3);
      // 船身的顶点没有落在岸上的：离桥线远的那些顶点（船头船尾）脚下都是水
      const ux = (plan.b[0] - plan.a[0]) / plan.length;
      const uz = (plan.b[1] - plan.a[1]) / plan.length;
      const far = points.filter(([x, , z]) => Math.abs((x - plan.a[0]) * -uz + (z - plan.a[1]) * ux) > plan.deckM);
      expect(far.length).toBeGreaterThan(50);
      for (const [x, , z] of far) expect(samplers.waterH(x, z), `船身的一点 (${x.toFixed(0)}, ${z.toFixed(0)})`).toBeLessThan(normal);
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

    it('坟的脚落在读者看得见的那块地上：最下面一圈的顶点不比那里的地面高，裙边再往下埋 3；冢顶比这一圈的平均高出 13、8', () => {
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

    it('“老翁泉”一节的画面上：电脑上两座坟各至少 14 个像素宽；亭子不压着池、不挡在坟的前面；两条题签的点相距 30 个像素以上', () => {
      for (const pane of [WIDE, UPRIGHT]) {
        const view = look(VIEW_GRAVES, pane);
        const widths = [MOUND.large.r * 2 * view.pxPerM, MOUND.small.r * 2 * view.pxPerM];
        const on = (x: number, z: number, up = 0) => view.on(x, coords.y(samplers.height(x, z)) + up, z);
        const pool = on(sx, sz);
        const kiosk = on(vx, vz);
        const kioskTop = on(vx, vz, 30);
        const big = on(px, pz);
        const small = on(wx, wz);
        // 亭顶 42 米见方，池连池沿半径 11.5 米
        const roofHalf = 21 * view.pxPerM;
        const poolHalf = (9 + POOL.kerbM.small) * view.pxPerM;
        const strips = section(VIEW_GRAVES).strips.map((id) => scene.strips.find((s) => s.id === id)).filter((s) => s !== undefined);
        const anchors = screenAnchors(strips, scene, samplers, coords, style, view.D, view.camera, pane.size);
        const dot = (id: string): { x: number; y: number } => {
          const found = anchors.find((a) => a.id === id);
          if (!found) throw new Error(`没有题签 ${id}`);
          return { x: found.x, y: found.y };
        };
        const graves = dot('t-graves');
        const well = dot('t-spring');
        const between = Math.hypot(graves.x - well.x, graves.y - well.y);
        console.log(`眉州“${VIEW_GRAVES}” ${pane.name}：坟宽 ${widths.map((w) => w.toFixed(0)).join('、')} 像素；亭子在池左边 ${(pool.x - kiosk.x).toFixed(0)} 像素（亭顶半宽 ${roofHalf.toFixed(0)}、池半宽 ${poolHalf.toFixed(0)}）；亭顶比小坟的下沿低 ${(kioskTop.y - (small.y + MOUND.small.r * view.pxPerM * 0.6)).toFixed(0)} 像素；两条题签的点相距 ${between.toFixed(0)} 像素`);
        if (pane === WIDE) {
          for (const w of widths) expect(w).toBeGreaterThanOrEqual(14);
          expect(between).toBeGreaterThanOrEqual(30);
        }
        // 亭子在池的左边，隔开了：不压着池
        expect(pool.x - kiosk.x).toBeGreaterThan(roofHalf + poolHalf * 0.5);
        // 两座坟都在亭子的上方（更远），亭顶够不着大坟；大坟在亭子右边，隔开了
        expect(big.y).toBeLessThan(kiosk.y);
        expect(small.y).toBeLessThan(kiosk.y);
        expect(big.x - kiosk.x).toBeGreaterThan(roofHalf);
        // 题签指着的东西
        expect(scene.strips.find((s) => s.id === 't-graves')?.of).toBe('grave-parents');
        expect(scene.strips.find((s) => s.id === 't-spring')?.of).toBe('spring');
      }
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

    it('是一户带篱笆的人家（瓦顶的单座的屋，朝南），不是一组院落；池在篱笆外面、门的右前方', () => {
      expect(home.kind).toBe('house');
      expect(home.params).toEqual({ roof: 'tile', fence: true });
      expect(home.facing).toBe(180);
      expect(pool.kind).toBe('pool');
      // 篱笆在屋外东西 26、南北 28 米；池连池沿半径 11.5 米：整个在篱笆南边的外面，不压着篱笆，也不堵着门（门口左右各 9 米）
      const east = qx - hx;
      const south = qz - hz;
      console.log(`眉州的家：池在屋子东边 ${east.toFixed(0)} 米、南边 ${south.toFixed(0)} 米`);
      expect(south - 11.5).toBeGreaterThan(28 + 3);
      expect(east - 11.5).toBeGreaterThan(9);
      expect(Math.hypot(east, south)).toBeLessThan(70);
      expect(section(VIEW_HOME).line).toContain('小池');
      expect(section(VIEW_HOME).line).toContain('竹子');
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

    it('零件库那一边照同一个数让开：造屋、造池的时候各登记一块地，民居离它 26 米以上', () => {
      const { pass } = soloPass();
      THING_BUILDERS.house(pass, home);
      expect(pass.yards).toHaveLength(1);
      expect(pass.yards[0]).toMatchObject({ cx: hx, cz: hz, hx: 45, hz: 45 });
      builders.pool?.(pass, pool);
      expect(pass.yards).toHaveLength(2);
      expect(pass.yards[1]).toMatchObject({ cx: qx, cz: qz, hx: 24, hz: 24 });
      expect(inYard(pass.yards[0], hx + 70, hz, 26)).toBe(true);
      expect(inYard(pass.yards[0], hx + 72, hz, 26)).toBe(false);
      // 城外的池（老翁泉）不登记
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

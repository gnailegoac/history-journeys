// 场景验收（三）：每一座真的站点沙盘、每一小节的镜头，在几种大小的画面上摆出来对不对。
// 在 Node 里跑：地面是真的，镜头和题签的位置用 src/stage/three/rig.ts 算（和页面上的沙盘是同一套算法：
// 镜头用 placeCamera，题签指着的点用 screenAnchors，见 view.ts 的 lookFor 和 drawFrame），不要浏览器。
// content/ 里有几座沙盘就查几座。
//
// 查四样：
//   1 每一节的每条题签指着的东西，这一节里有；
//   2 四种画面（880 × 900 是定稿样张的大小；后面三种是页面上标准的沙盘栏：940 × 900 是电脑，584 × 768 是横着拿的平板，
//     768 × 573 是竖着拿的平板上面那一块；手机不在标准里，不查），镜头按“画面窄了自己退远”的规矩摆好以后，
//     每条题签指着的那一点都落在画面留出来的那一块里面；四边不留空、留出页面上真的留的空（上面是按钮，下面是题记：
//     在浏览器里量过，宽的栏上 62、下 130，竖着的平板上 54、下 131），各查一遍。
//     题签指着的点是按镜头最后摆在的远近算的：模型跟着远近放大，那一点跟着抬高；镜头摆在哪却是按
//     “场景里写的距离”时的抬高定的（rig.ts 的 showPoints 只算一遍）。两样差出来的那一点，就是这里要查的。
//     mustShow 里写的东西，顶上和脚下也都在那一块里面；看整块沙盘的一节，沙盘在留出来的那一块里上下、左右都居中；
//   3 880 × 900、四边不留空时，镜头离得正好是场景里写的距离（差不到 2%；写了 closest 的可以正好是 closest 那么近）：
//     场景里的 distanceM 就是照宽和高差不多的画面定的，这种画面上程序不该再挪它。
//     设计稿只要求从样张来的五个镜头这样，这里每一节都查，没有例外。
//     照电脑上的沙盘栏定的镜头（写在 SET_ON_COMPUTER_PANE 里）另查一条：在电脑的沙盘栏上它正好是写的距离，程序不挪它。
//   4 头一节的镜头不是朝北看的，题记开头先说从哪边往哪边看（“从城的北边往南看：……”），说的和镜头的朝向对得上。

import { PerspectiveCamera } from 'three';
import { describe, expect, it } from 'vitest';
import type { SceneSection, SceneStrip, When } from '../../src/domain/scene';
import { existsAt } from '../../src/domain/sceneText';
import type { Vec3 } from '../../src/stage/ground/types';
import type { StripInput } from '../../src/stage/overlay/types';
import { centreShift, equivalentDistance, framePoints, placeCamera, project, screenAnchors, wholeTable } from '../../src/stage/three/rig';
import { styleFor } from '../../src/stage/three/style';
import type { StageInsets } from '../../src/stage/types';
import { realScene, realSceneKeys } from './support/realScenes';
import type { RealScene } from './support/realScenes';

interface Pane {
  name: string;
  size: { width: number; height: number };
  /** 页面上留的空：上面一排按钮，下面的题记。是在浏览器里量出来的数（题记的高是定死的，每一节都一样）。 */
  pageInsets: StageInsets;
}

const NO_INSETS: StageInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const WIDE_INSETS: StageInsets = { top: 62, right: 0, bottom: 130, left: 0 };
const UPRIGHT_INSETS: StageInsets = { top: 54, right: 0, bottom: 131, left: 0 };
const PANES: Pane[] = [
  { name: '880 × 900', size: { width: 880, height: 900 }, pageInsets: WIDE_INSETS },
  { name: '940 × 900', size: { width: 940, height: 900 }, pageInsets: WIDE_INSETS },
  { name: '584 × 768', size: { width: 584, height: 768 }, pageInsets: WIDE_INSETS },
  { name: '768 × 573', size: { width: 768, height: 573 }, pageInsets: UPRIGHT_INSETS },
];

/**
 * 镜头不是样张来的、是照电脑上的沙盘栏（940 宽，上留 62、下留 130）对着图片定的小节。
 * 徐州的“云龙山和百步洪”：急滩在 mustShow 里上下两头都算（rig.ts 的 rapidsEnds），镜头对准的点和朝向是让整片乱石滩
 * 离栏的左边四十多像素、山的南头也在画面里定的。电脑上定下来的图片就是照写的距离拍的，所以另查一条：
 * 在电脑的沙盘栏上，程序一点也不挪它（退远了，图片上的东西就小了）。
 * 这一节原来在 880 × 900 的样本上要退远百分之八，是一条有名字的例外；镜头重新对过以后不用退了，例外去掉了。
 */
const SET_ON_COMPUTER_PANE: Record<string, string[]> = {
  'su-shi/xuzhou': ['云龙山和百步洪'],
};

type Anchor = StripInput['anchors'][number];

/**
 * 一节的镜头在这么大的画面上摆好：离多远（是写的距离的几倍），这时候折算过的远近，
 * 每条题签指着的那一点、每个一定要看得见的点落在画面的哪里。
 */
function placed(
  R: RealScene,
  section: SceneSection,
  size: Pane['size'],
  insets: StageInsets,
): { factor: number; D: number; strips: { strip: SceneStrip; anchor: Anchor }[]; at: (point: Vec3) => { x: number; y: number; visible: boolean }; points: Vec3[] } {
  const { scene, coords, samplers } = R;
  const style = styleFor(scene.style);
  // 和 view.ts 的 lookFor 是同一个函数
  const { pose, distanceM, fit, points } = placeCamera(section, scene, samplers, coords, style, size, insets);

  // 和 view.ts 的 drawFrame 一样的镜头
  const camera = new PerspectiveCamera(pose.fov, size.width / size.height, Math.max(60, distanceM * 0.1), distanceM * 3 + 30000);
  camera.position.set(...pose.position);
  camera.lookAt(...pose.target);
  const [shiftX, shiftY] = centreShift(insets);
  if (shiftX || shiftY) camera.setViewOffset(size.width, size.height, -shiftX, -shiftY, size.width, size.height);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  const strips = section.strips.map((id) => {
    const strip = scene.strips.find((s) => s.id === id);
    if (!strip) throw new Error(`${section.heading} 写的题签 ${id}，场景里没有`);
    return strip;
  });
  // 题签指着的点按镜头真的摆在的远近算（模型这时候多大，就抬多高）
  const D = equivalentDistance(distanceM, pose.fov, size.height);
  const anchors = screenAnchors(strips, scene, samplers, coords, style, D, camera, size);
  return { factor: fit, D, strips: strips.map((strip, i) => ({ strip, anchor: anchors[i] })), at: (point) => project(point, camera, size), points };
}

/** 这一点在不在画面留出来的那一块里面。 */
function insideFree(p: { x: number; y: number; visible?: boolean }, size: Pane['size'], insets: StageInsets): boolean {
  return p.visible !== false && p.x >= insets.left && p.x <= size.width - insets.right && p.y >= insets.top && p.y <= size.height - insets.bottom;
}

/** 题签指着的那样东西写的 when；它不是摆件也不是点缀（地名点、河、急滩、远处）就一直有。指着的东西找不到时是 null。 */
function targetWhen(R: RealScene, id: string): { when: When | undefined } | null {
  const { scene } = R;
  const dated = scene.things.find((t) => t.id === id) ?? scene.dressing.find((d) => d.id === id);
  if (dated) return { when: dated.when };
  const always = scene.places.some((p) => p.id === id) || scene.water.rivers.some((r) => r.id === id) || scene.water.rapids.some((r) => r.id === id) || scene.far.some((f) => f.id === id);
  return always ? { when: undefined } : null;
}

/** 八个方向，从正北起顺时针。 */
const EIGHT = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'] as const;
const OPPOSITE: Record<string, string> = { 北: '南', 东北: '西南', 东: '西', 东南: '西北', 南: '北', 西南: '东北', 西: '东', 西北: '东南' };
/** 镜头朝 bearing 看（0 是朝北，顺时针），说成八个方向里的哪一个。 */
const lookingTowards = (bearing: number): string => EIGHT[Math.round((((bearing % 360) + 360) % 360) / 45) % 8];
/** 头一节的题记说朝哪边看的写法：“从城的北边往南看：……”（docs/data-spec.md“小节”）。 */
const FIRST_LINE_LOOKS = /^从[^：，。]{1,8}的(东北|东南|西南|西北|东|南|西|北)边往(东北|东南|西南|西北|东|南|西|北)看：/;

describe.each(realSceneKeys())('%s 的镜头', (key) => {
  it('每一节的每条题签指着的东西，这一节里有', () => {
    const R = realScene(key);
    const missing: string[] = [];
    for (const section of R.scene.sections) {
      for (const id of section.strips) {
        const strip = R.scene.strips.find((s) => s.id === id);
        const target = strip ? targetWhen(R, strip.of) : null;
        if (!strip || !target) missing.push(`${section.heading}：题签 ${id} 或者它指着的东西找不到`);
        else if (!existsAt(target.when, section.heading, R.headings)) missing.push(`${section.heading}：“${strip.text}”指着的 ${strip.of} 这一节没有`);
      }
    }
    expect(missing).toEqual([]);
  });

  describe.each(PANES)('画面 $name', (pane) => {
    it.each([
      ['四边不留空', NO_INSETS],
      ['留出页面上的空', pane.pageInsets],
    ])('%s：每条题签指着的那一点（按镜头真的摆在的远近抬高）都在画面留出来的那一块里', (_name, insets) => {
      const R = realScene(key);
      const outside: string[] = [];
      for (const section of R.scene.sections) {
        const { factor, D, strips } = placed(R, section, pane.size, insets);
        for (const { strip, anchor } of strips) {
          if (!insideFree(anchor, pane.size, insets)) {
            outside.push(`${section.heading}：“${strip.text}”落在 (${anchor.x.toFixed(0)}, ${anchor.y.toFixed(0)})，镜头是写的距离的 ${factor.toFixed(2)} 倍，折算过的远近 ${D.toFixed(0)} 米`);
          }
        }
      }
      expect(outside).toEqual([]);
    });

    it('留出页面上的空：远处的题签带着朝外的方向，抬高过的带着脚下那一点；脚下那一点也在画面里', () => {
      const R = realScene(key);
      const insets = pane.pageInsets;
      const wrong: string[] = [];
      for (const section of R.scene.sections) {
        for (const { strip, anchor } of placed(R, section, pane.size, insets).strips) {
          const far = R.scene.far.some((f) => f.id === strip.of);
          const lifted = R.scene.things.some((t) => t.id === strip.of);
          if (far !== (anchor.out !== undefined)) wrong.push(`${section.heading}：“${strip.text}”${far ? '是远处，却没有朝外的方向' : '不是远处，却有朝外的方向'}`);
          if (anchor.out && Math.abs(Math.hypot(anchor.out[0], anchor.out[1]) - 1) > 1e-9) wrong.push(`${section.heading}：“${strip.text}”朝外的方向长度不是 1`);
          if (lifted !== (anchor.foot !== undefined)) wrong.push(`${section.heading}：“${strip.text}”${lifted ? '指着摆件，却没有脚下那一点' : '不是摆件，却有脚下那一点'}`);
          if (anchor.foot && !(anchor.foot.x >= 0 && anchor.foot.x <= pane.size.width && anchor.foot.y >= anchor.y && anchor.foot.y <= pane.size.height)) {
            wrong.push(`${section.heading}：“${strip.text}”脚下那一点落在 (${anchor.foot.x.toFixed(0)}, ${anchor.foot.y.toFixed(0)})，不在它指着的那一点的下方、画面里面`);
          }
        }
      }
      expect(wrong).toEqual([]);
    });

    it('留出页面上的空：写了 mustShow 的一节，要看的东西顶上和脚下都在留出来的那一块里面（不压在题记和按钮底下）', () => {
      const R = realScene(key);
      const insets = pane.pageInsets;
      const hidden: string[] = [];
      for (const section of R.scene.sections) {
        if (!section.camera.mustShow) continue;
        const view = placed(R, section, pane.size, insets);
        // 镜头已经退到头（2.5 倍）还放不下的不算：那是画面实在太窄
        if (view.factor >= 2.49) continue;
        view.points.forEach((point, i) => {
          const at = view.at(point);
          if (!insideFree(at, pane.size, insets)) hidden.push(`${section.heading}：第 ${i + 1} 个要看的点落在 (${at.x.toFixed(0)}, ${at.y.toFixed(0)})`);
        });
      }
      expect(hidden).toEqual([]);
    });

    it('留出页面上的空：看整块沙盘的一节，沙盘（连座子）上下的空一样、左右的空一样', () => {
      const R = realScene(key);
      const insets = pane.pageInsets;
      const off: string[] = [];
      for (const section of R.scene.sections) {
        if (!wholeTable(section)) continue;
        const view = placed(R, section, pane.size, insets);
        const at = framePoints(R.coords).map((p) => view.at(p));
        const left = Math.min(...at.map((p) => p.x)) - insets.left;
        const right = pane.size.width - insets.right - Math.max(...at.map((p) => p.x));
        const top = Math.min(...at.map((p) => p.y)) - insets.top;
        const bottom = pane.size.height - insets.bottom - Math.max(...at.map((p) => p.y));
        if (Math.abs(top - bottom) > 2 || Math.abs(left - right) > 2 || Math.min(left, right, top, bottom) < 8) {
          off.push(`${section.heading}：上 ${top.toFixed(0)}、下 ${bottom.toFixed(0)}、左 ${left.toFixed(0)}、右 ${right.toFixed(0)}`);
        }
      }
      expect(off).toEqual([]);
    });
  });

  it('880 × 900、四边不留空时，镜头离得正好是场景里写的距离', () => {
    const R = realScene(key);
    const moved: string[] = [];
    for (const section of R.scene.sections) {
      const { factor } = placed(R, section, PANES[0].size, NO_INSETS);
      const closest = section.camera.closest;
      const ok = Math.abs(factor - 1) <= 0.02 || (closest !== undefined && Math.abs(factor - closest) <= 0.02);
      if (!ok) moved.push(`${section.heading}：镜头摆在写的距离的 ${factor.toFixed(3)} 倍${closest !== undefined ? `（closest 是 ${closest}）` : ''}`);
    }
    expect(moved).toEqual([]);
  });

  it('照电脑的沙盘栏定的那几节，在电脑的沙盘栏（940 × 900，留出页面上的空）上正好是场景里写的距离', () => {
    const R = realScene(key);
    const computer = PANES[1];
    const moved: string[] = [];
    for (const heading of SET_ON_COMPUTER_PANE[key] ?? []) {
      const section = R.scene.sections.find((s) => s.heading === heading);
      if (!section) {
        moved.push(`${heading}：场景里没有这一节`);
        continue;
      }
      const { factor } = placed(R, section, computer.size, computer.pageInsets);
      if (Math.abs(factor - 1) > 0.001) moved.push(`${heading}：电脑的沙盘栏上镜头摆在写的距离的 ${factor.toFixed(4)} 倍`);
    }
    expect(moved).toEqual([]);
  });

  it('头一节不是朝北看的，题记开头先说从哪边往哪边看，说的和镜头的朝向对得上（朝北看的不用说：全程沙盘和地图都是上北下南）', () => {
    const first = realScene(key).scene.sections[0];
    const said = FIRST_LINE_LOOKS.exec(first.line);
    const looks = lookingTowards(first.camera.bearing);
    if (looks === '北') {
      // 朝北看：不要求写；写了就得写对
      if (said) expect([said[1], said[2]], first.line).toEqual(['南', '北']);
      return;
    }
    expect(said, `${first.heading} 的镜头朝${looks}看，题记“${first.line}”开头要写“从…的${OPPOSITE[looks]}边往${looks}看：”`).not.toBeNull();
    expect([said?.[1], said?.[2]], first.line).toEqual([OPPOSITE[looks], looks]);
  });

  it('把每一节在三种标准的沙盘栏上摆好的数印出来（给看图片的人对照）', () => {
    const R = realScene(key);
    const lines: string[] = [`${key} 每一节的镜头：写的距离的几倍 / 折算过的远近（米）`];
    for (const section of R.scene.sections) {
      const cells = PANES.slice(1).map((pane) => {
        const { factor, D } = placed(R, section, pane.size, pane.pageInsets);
        return `${pane.name} ${factor.toFixed(2)} / ${D.toFixed(0)}`;
      });
      lines.push(`  ${section.heading}：${cells.join('；')}`);
    }
    console.log(lines.join('\n'));
    expect(lines.length).toBe(R.scene.sections.length + 1);
  });
});

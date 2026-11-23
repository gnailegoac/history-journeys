// 镜头和题签的几何（src/stage/three/rig.ts）和时代样式里跟镜头有关的几条规矩的单元测试。
// 用的是 tests/support/fixtureScene.ts 那座小沙盘和 tests/stage/support/flatGround.ts 手做的地面，不经过 src/stage/ground。
// 运行：npx vitest run tests/stage/rig.test.ts
//
// “看得见”一律用 three 自己的镜头再投一遍来核对，不拿 rig.ts 自己的算式核对它自己。

import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { SceneCamera, SceneSection, SceneStrip, StopScene } from '../../src/domain/scene';
import { frameCoords } from '../../src/domain/sceneGeo';
import { stripPoint } from '../../src/domain/sceneStripPoint';
import type { Vec3 } from '../../src/stage/ground/types';
import type { FigureClass, FigureRule, StageStyle } from '../../src/stage/three/internal';
import { figureGroups, figureNow, figureTimes } from '../../src/stage/three/kit/figure';
import {
  DEFAULT_FOV,
  FIT_MARGIN_PX,
  MAX_FIT,
  anchorOf,
  centreShift,
  centredView,
  chooseScale,
  equivalentDistance,
  fitDistance,
  fitFactor,
  framePoints,
  liftOf,
  lightDim,
  lightLevel,
  moonDir,
  northDeg,
  pixelsPerMetre,
  placeCamera,
  pose,
  poseAt,
  poseOn,
  project,
  projectSpots,
  reachOf,
  screenAnchors,
  shadowBox,
  shadowTuning,
  sheenFor,
  showPoints,
  stripSpots,
  wholeTable,
  type Pose,
} from '../../src/stage/three/rig';
import { styleFor } from '../../src/stage/three/style';
import { STAND_REACH } from '../../src/stage/three/table';
import { narrowChannel, rippleFor } from '../../src/stage/three/water';
import type { StageInsets } from '../../src/stage/types';
import { FIXTURE_HEIGHTS, FIXTURE_M, fixturePoint, fixtureScene } from '../support/fixtureScene';
import { flatGround, flatSamplers } from './support/flatGround';

const scene = fixtureScene();
const coords = frameCoords(scene.frame);
const ground = flatSamplers(flatGround());
/** 真的样式（查它的灯、雾、云气用）。 */
const song = styleFor('song-qinglv');

/**
 * 查镜头和题签的几何用的样式：颜色、抬高、雾都是真的，只把“模型跟着远近怎么变”的那张表换成这里定死的一张。
 * 真的那张表是要对着图片调的，这里的测试不该跟着它变。每一类放大到头的倍数都不一样，用错了类就看得出来。
 * 从多远起放大，各处用到时再定（withHold）。
 */
const CAPS: Record<FigureClass, FigureRule> = {
  wallH: { holdFromM: 1, maxTimes: 1.5 },
  tower: { holdFromM: 1, maxTimes: 2 },
  wallTop: { holdFromM: 1, maxTimes: 2.5 },
  yardCity: { holdFromM: 1, maxTimes: 1.25, spreadAtMax: 1.25 },
  yardOut: { holdFromM: 1, maxTimes: 1.75, spreadAtMax: 1.75 },
  cityHouse: { holdFromM: 1, maxTimes: 2.1, keepAtMax: 0.2, spreadAtMax: 2.1 },
  village: { holdFromM: 1, maxTimes: 2.2, keepAtMax: 0.65, spreadAtMax: 1.5 },
  boat: { holdFromM: 1, maxTimes: 1.6 },
  smallBoat: { holdFromM: 1, maxTimes: 2.4 },
  rock: { holdFromM: 1, maxTimes: 1.4 },
  tree: { holdFromM: 1, maxTimes: 2.3, keepAtMax: 0.335 },
  hut: { holdFromM: 1, maxTimes: 4, spreadAtMax: 4 },
  shed: { holdFromM: 1, maxTimes: 5 },
  pavilion: { holdFromM: 1, maxTimes: 3, spreadAtMax: 3 },
};

/** 上面那张表，每一类都从 holdFromM 这么远起放大。 */
function withHold(holdFromM: number): StageStyle {
  const rules = Object.fromEntries(Object.entries(CAPS).map(([cls, rule]) => [cls, { ...rule, holdFromM }])) as Record<FigureClass, FigureRule>;
  return { ...song, figure: { ...song.figure, rules } };
}

/**
 * 平常用的一张：从一千万米起才放大。所以折算过的远近在几十万米以内，模型都是本来的大小（差不到一亿分之一）；
 * 到 FAR_D 那么远，每一类都放大到了头，倍数正好是表里的数。
 */
const style = withHold(1e7);
const FAR_D = 1e12;

const NONE: StageInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const WIDE = { width: 880, height: 900 };
const TABLET = { width: 584, height: 768 };
/** 竖着拿的平板上面那一块沙盘栏。 */
const UPRIGHT = { width: 768, height: 573 };

/** 沙盘的四个角（桌面的高度）。 */
const corners: Vec3[] = [
  [coords.x0, 0, coords.z0],
  [coords.x1, 0, coords.z0],
  [coords.x1, 0, coords.z1],
  [coords.x0, 0, coords.z1],
];

/** 对准沙盘正中、从南边看过去的镜头。 */
function cameraFromSouth(distanceM: number, extra: Partial<SceneCamera> = {}): SceneCamera {
  return { target: fixturePoint(0, 0), distanceM, pitch: 50, bearing: 0, ...extra };
}

/** 照 view.ts 的做法，用 three 的镜头摆出这个位置（四边留了空就把画面中心挪过去）。 */
function threeCamera(p: Pose, size: { width: number; height: number }, insets: StageInsets = NONE): PerspectiveCamera {
  const camera = new PerspectiveCamera(p.fov, size.width / size.height, 10, 1e7);
  camera.position.set(...p.position);
  camera.lookAt(new Vector3(...p.target));
  const [shiftX, shiftY] = centreShift(insets);
  if (shiftX || shiftY) camera.setViewOffset(size.width, size.height, -shiftX, -shiftY, size.width, size.height);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

/** 这一点离“画面减去四边留的空”的边还有多少像素（负数是在外面）。 */
function slack(point: Vec3, camera: PerspectiveCamera, size: { width: number; height: number }, insets: StageInsets = NONE): number {
  const { x, y, visible } = project(point, camera, size);
  if (!visible) return -Infinity;
  return Math.min(x - insets.left, size.width - insets.right - x, y - insets.top, size.height - insets.bottom - y);
}

/** 镜头离这么远时，各点里离边最近的那个还有多少像素。 */
function worstSlack(camera: SceneCamera, distanceM: number, points: Vec3[], size: { width: number; height: number }, insets: StageInsets = NONE): number {
  const three = threeCamera(pose(camera, coords, 0, distanceM), size, insets);
  return Math.min(...points.map((p) => slack(p, three, size, insets)));
}

describe('pose：镜头摆在哪', () => {
  it('朝北看时镜头在南边的上方，离对准的那一点正好是写的距离', () => {
    const p = pose(cameraFromSouth(10000), coords, 0);
    expect(p.target[0]).toBeCloseTo(0, 6);
    expect(p.target[2]).toBeCloseTo(0, 6);
    expect(p.position[0]).toBeCloseTo(0, 6);
    expect(p.position[2]).toBeGreaterThan(0);
    expect(p.position[1]).toBeGreaterThan(0);
    expect(Math.hypot(p.position[0] - p.target[0], p.position[1] - p.target[1], p.position[2] - p.target[2])).toBeCloseTo(10000, 6);
    expect(p.fov).toBe(DEFAULT_FOV);
  });

  it('和样张四个镜头的算法是一回事：bearing = (360 − az) mod 360，pitch = 90 − el', () => {
    const shots = [
      { name: '到徐州', target: [-450, -100, -470], az: 0, el: 42, dist: 52000, fov: 18 },
      { name: '住在城墙上', target: [120, 0, 300], az: 7, el: 29, dist: 9600, fov: 21 },
      { name: '水退以后', target: [600, 40, 0], az: 104, el: 14, dist: 1150, fov: 22 },
      { name: '水来了', target: [0, 0, 80], az: -14, el: 33, dist: 10800, fov: 21 },
    ];
    for (const s of shots) {
      const az = (s.az * Math.PI) / 180;
      const el = (s.el * Math.PI) / 180;
      const sample = [
        s.target[0] + s.dist * Math.sin(az) * Math.cos(el),
        s.target[1] + s.dist * Math.sin(el),
        s.target[2] + s.dist * Math.cos(az) * Math.cos(el),
      ];
      const camera: SceneCamera = {
        target: coords.toLngLat(s.target[0], s.target[2]),
        distanceM: s.dist,
        pitch: 90 - s.el,
        bearing: (360 - s.az) % 360,
        fov: s.fov,
      };
      const p = pose(camera, coords, s.target[1]);
      expect(p.position[0], s.name).toBeCloseTo(sample[0], 3);
      expect(p.position[1], s.name).toBeCloseTo(sample[1], 3);
      expect(p.position[2], s.name).toBeCloseTo(sample[2], 3);
      expect(p.fov, s.name).toBe(s.fov);
    }
  });

  it('targetUpM 是真实的米，换成沙盘里的高度要乘山高夸大的倍数', () => {
    const p = pose(cameraFromSouth(1000, { targetUpM: 7 }), coords, 7.2);
    expect(p.target[1]).toBeCloseTo(7.2 + 7 * 6, 9);
  });

  it('poseOn 自己取对准的那一点的地面：城里是 41.2 米', () => {
    const camera: SceneCamera = { target: fixturePoint(FIXTURE_M.city[0], FIXTURE_M.city[1]), distanceM: 2000, pitch: 60, bearing: 20 };
    expect(poseOn(camera, ground, coords).target[1]).toBeCloseTo(coords.y(FIXTURE_HEIGHTS.city), 3);
  });

  it('另给距离时镜头沿同一条线退远', () => {
    const near = pose(cameraFromSouth(10000), coords, 0);
    const far = pose(cameraFromSouth(10000), coords, 0, 20000);
    expect(far.target).toEqual(near.target);
    for (let i = 0; i < 3; i++) expect(far.position[i] - far.target[i]).toBeCloseTo(2 * (near.position[i] - near.target[i]), 6);
  });
});

describe('fitFactor：画面窄了退多远', () => {
  it('880 × 900：要看的点都在画面里，就是写的距离（1.00，差不到 2%）', () => {
    const camera = cameraFromSouth(12000);
    expect(worstSlack(camera, 12000, corners, WIDE)).toBeGreaterThan(0);
    const factor = fitFactor(camera, pose(camera, coords, 0).target, corners, WIDE);
    expect(Math.abs(factor - 1)).toBeLessThan(0.02);
    expect(fitDistance(camera, pose(camera, coords, 0).target, corners, WIDE)).toBeCloseTo(12000 * factor, 6);
  });

  it('没有要看的点，就是 1', () => {
    const camera = cameraFromSouth(12000, { closest: 0.8 });
    expect(fitFactor(camera, [0, 0, 0], [], WIDE)).toBe(1);
  });

  // 写的距离各取一个在这种画面上不够远、又不至于要退到 2.5 倍以外的数（竖着拿的平板上沙盘栏又宽又矮，要近一些才不够）
  for (const [name, size, distanceM] of [
    ['584 × 768', TABLET, 12000],
    ['768 × 573', UPRIGHT, 7000],
  ] as const) {
    it(`${name}：落在画面外面的点被带回画面里，而且没有多退`, () => {
      // 那座小沙盘的第一节：镜头对准城，要看见整块沙盘（连座子）。距离改成上面写的数
      const section: SceneSection = { ...scene.sections[0], camera: { ...scene.sections[0].camera, distanceM } };
      const camera = section.camera;
      const points = showPoints(section, scene, ground, coords, style);
      const authored = poseOn(camera, ground, coords);
      const at = (distanceM: number): number => {
        const three = threeCamera(poseOn(camera, ground, coords, distanceM), size);
        return Math.min(...points.map((p) => slack(p, three, size)));
      };
      expect(at(camera.distanceM)).toBeLessThan(0);

      const factor = fitFactor(camera, authored.target, points, size);
      expect(factor).toBeGreaterThan(1);
      expect(factor).toBeLessThanOrEqual(MAX_FIT);
      // 退到位以后都在画面里；少退 3% 就有一点离边不到规定的那一点点
      expect(at(camera.distanceM * factor)).toBeGreaterThan(0);
      expect(at(camera.distanceM * factor * 0.97)).toBeLessThan(at(camera.distanceM * factor));
      expect(at(camera.distanceM * factor * 0.97)).toBeLessThan(12);
    });
  }

  it('closest 0.8：都还看得见时才靠近，最多靠近到八成', () => {
    // 12000 米处四个角绰绰有余：靠近到八成
    const roomy = cameraFromSouth(12000, { closest: 0.8 });
    const target = pose(roomy, coords, 0).target;
    expect(fitFactor(roomy, target, corners, WIDE)).toBeCloseTo(0.8, 9);
    expect(worstSlack(roomy, 12000 * 0.8, corners, WIDE)).toBeGreaterThan(0);

    // 10000 米处靠近到八成就有角出画面了：只靠近到都还看得见为止
    const tight = cameraFromSouth(10000, { closest: 0.8 });
    expect(worstSlack(tight, 10000 * 0.8, corners, WIDE)).toBeLessThan(0);
    const factor = fitFactor(tight, target, corners, WIDE);
    expect(factor).toBeGreaterThan(0.8);
    expect(factor).toBeLessThan(1);
    expect(worstSlack(tight, 10000 * factor, corners, WIDE)).toBeGreaterThan(0);

    // 没写 closest 就不靠近
    expect(fitFactor(cameraFromSouth(12000), target, corners, WIDE)).toBe(1);
    // 画面窄了要退远时，closest 不起作用
    expect(fitFactor(tight, target, corners, TABLET)).toBeGreaterThan(1);
  });

  it('最多退到 2.5 倍', () => {
    const camera = cameraFromSouth(3000);
    expect(fitFactor(camera, pose(camera, coords, 0).target, corners, { width: 200, height: 900 })).toBe(MAX_FIT);
  });

  it('四边留了空：对准的那一点落在留出来的那一块中间，要看的点都在那一块里', () => {
    const insets: StageInsets = { top: 44, right: 0, bottom: 180, left: 20 };
    const camera = cameraFromSouth(9000);
    const target = pose(camera, coords, 0).target;
    const factor = fitFactor(camera, target, corners, WIDE, insets);
    expect(factor).toBeGreaterThan(fitFactor(camera, target, corners, WIDE));
    const three = threeCamera(pose(camera, coords, 0, 9000 * factor), WIDE, insets);
    const centre = project(target, three, WIDE);
    expect(centre.x).toBeCloseTo((20 + 880) / 2, 3);
    expect(centre.y).toBeCloseTo((44 + 900 - 180) / 2, 3);
    for (const corner of corners) expect(slack(corner, three, WIDE, insets)).toBeGreaterThan(0);
  });
});

describe('centredView：看整块沙盘的一节，沙盘在留出来的那一块里居中', () => {
  const frame = framePoints(coords);
  const whole: SceneCamera = { target: fixturePoint(200, -300), distanceM: 9000, pitch: 48, bearing: 0, fov: 18, mustShow: ['frame'] };

  /** 整块沙盘（连座子）在画面上占的那一块，四边各离留出来的那一块的边多少像素。 */
  function margins(placed: Pose, size: { width: number; height: number }, insets: StageInsets): { left: number; right: number; top: number; bottom: number } {
    const camera = threeCamera(placed, size, insets);
    const at = frame.map((p) => project(p, camera, size));
    return {
      left: Math.min(...at.map((p) => p.x)) - insets.left,
      right: size.width - insets.right - Math.max(...at.map((p) => p.x)),
      top: Math.min(...at.map((p) => p.y)) - insets.top,
      bottom: size.height - insets.bottom - Math.max(...at.map((p) => p.y)),
    };
  }

  it('wholeTable：mustShow 里写了 frame 的一节才是', () => {
    expect(wholeTable(scene.sections[0])).toBe(true);
    expect(wholeTable(scene.sections[1])).toBe(false);
    expect(wholeTable({ ...scene.sections[0], camera: { ...scene.sections[0].camera, mustShow: ['wall'] } })).toBe(false);
  });

  it.each([
    ['880 × 900，上面留 60、下面留 130', WIDE, { top: 60, right: 0, bottom: 130, left: 0 }],
    ['584 × 768，上面留 60、下面留 130', TABLET, { top: 60, right: 0, bottom: 130, left: 0 }],
    ['768 × 573，上面留 54、下面留 131', UPRIGHT, { top: 54, right: 0, bottom: 131, left: 0 }],
    ['880 × 900，四边不留空', WIDE, NONE],
    ['880 × 900，左边留 200', WIDE, { top: 0, right: 0, bottom: 0, left: 200 }],
  ] as [string, { width: number; height: number }, StageInsets][])('%s：上下的空一样，左右的空一样，整块沙盘都在留出来的那一块里', (_name, size, insets) => {
    const authored = poseOn(whole, ground, coords);
    const view = centredView(whole, authored.target, frame, size, insets);
    const m = margins(poseAt(whole, view.target, view.distanceM), size, insets);
    expect(Math.abs(m.top - m.bottom)).toBeLessThan(1.5);
    expect(Math.abs(m.left - m.right)).toBeLessThan(1.5);
    for (const v of Object.values(m)) expect(v).toBeGreaterThan(8);
    // 对准的那一点只在地面上挪，高度不变
    expect(view.target[1]).toBe(authored.target[1]);
    // 不挪的话，上下的空差出一截（写的对准点偏北）
    const plain = margins(poseOn(whole, ground, coords, fitDistance(whole, authored.target, frame, size, insets)), size, insets);
    expect(Math.abs(plain.top - plain.bottom)).toBeGreaterThan(Math.abs(m.top - m.bottom) + 5);
  });

  it('没有要看的点：对准的那一点不动，就是写的距离', () => {
    const authored = poseOn(whole, ground, coords);
    expect(centredView(whole, authored.target, [], WIDE)).toEqual({ target: authored.target, distanceM: whole.distanceM });
  });

  it('画面是 0 × 0（收起来的时候）也算得出正常的数', () => {
    const authored = poseOn(whole, ground, coords);
    const view = centredView(whole, authored.target, frame, { width: 0, height: 0 });
    expect(view.target.every((v) => Number.isFinite(v))).toBe(true);
    expect(Number.isFinite(view.distanceM)).toBe(true);
  });
});

describe('shadowBox：影子罩多大一块', () => {
  it('镜头在 1150 米时是 1250，在 9600 米时大约 5400', () => {
    // 用徐州那么大的沙盘（11.7 × 9.7 公里）
    const xuzhou = frameCoords({ ...scene.frame, westM: 6300, eastM: 5400, northM: 5400, southM: 4300 });
    expect(shadowBox([600, 0], 1150, xuzhou).half).toBe(1250);
    expect(shadowBox([120, 300], 9600, xuzhou).half).toBeCloseTo(5376, 6);
    // 看整块沙盘时最大到对角线的一半，再加上装裱那一圈（沙盘的边落在装裱上的影子也要罩住）
    const whole = shadowBox([-450, -470], 52000, xuzhou);
    expect(whole.half).toBeCloseTo(Math.hypot(11700, 9700) / 2 + STAND_REACH, 6);
    // 罩到头时中心是沙盘的正中，不是镜头对准的那一点：四个角连装裱都在方块里
    expect(whole.centre[0]).toBeCloseTo((xuzhou.x0 + xuzhou.x1) / 2, 6);
    expect(whole.centre[1]).toBeCloseTo((xuzhou.z0 + xuzhou.z1) / 2, 6);
    for (const [x, z] of [
      [xuzhou.x0 - STAND_REACH, xuzhou.z0 - STAND_REACH],
      [xuzhou.x1 + STAND_REACH, xuzhou.z1 + STAND_REACH],
    ]) {
      expect(Math.hypot(x - whole.centre[0], z - whole.centre[1])).toBeLessThanOrEqual(whole.half + STAND_REACH * (Math.SQRT2 - 1) + 1e-6);
    }
    // 罩得小的时候中心就是镜头对准的那一点；中间是匀着过去的
    expect(shadowBox([120, 300], 3000, xuzhou).centre).toEqual([120, 300]);
    const between = shadowBox([-2000, 1000], 12500, xuzhou).centre;
    expect(between[0]).toBeGreaterThan(-2000);
    expect(between[0]).toBeLessThan((xuzhou.x0 + xuzhou.x1) / 2);
  });

  it('以镜头对准的那一点为中心；那一点出了沙盘就取边上最近的一点', () => {
    expect(shadowBox([100, -200], 3000, coords).centre).toEqual([100, -200]);
    expect(shadowBox([9000, -9000], 3000, coords).centre).toEqual([coords.x1, coords.z0]);
  });
});

describe('题签指着的那一点', () => {
  it('抬高（模型是本来的大小时）：城墙 62；城门在城墙上，再加 8；楼在城门上，再加 76；不是摆件的贴着地面', () => {
    expect(liftOf('wall', scene, style, 6000)).toBeCloseTo(62, 6);
    expect(liftOf('gate-south', scene, style, 6000)).toBeCloseTo(70, 6);
    expect(liftOf('gate-tower', scene, style, 6000)).toBeCloseTo(146, 6);
    expect(liftOf('hill', scene, style, 6000)).toBe(0);
    expect(liftOf('river', scene, style, 6000)).toBe(0);
    expect(liftOf('far-town', scene, style, 6000)).toBe(0);
  });

  it('抬高跟着模型放大：每一环各乘它那一类的倍数——城墙、城门乘“墙的高”，城门上的楼乘“楼”；不是摆件的还是贴着地面', () => {
    // 放大到头：墙的高 1.5 倍，楼 2 倍
    expect(liftOf('wall', scene, style, FAR_D)).toBeCloseTo(62 * 1.5, 6);
    expect(liftOf('gate-south', scene, style, FAR_D)).toBeCloseTo((62 + 8) * 1.5, 6);
    expect(liftOf('gate-tower', scene, style, FAR_D)).toBeCloseTo((62 + 8) * 1.5 + 76 * 2, 6);
    expect(liftOf('hill', scene, style, FAR_D)).toBe(0);
    expect(liftOf('far-town', scene, style, FAR_D)).toBe(0);
    // 半路上：倍数就是 figureTimes 给的那个，一路连着变，远了只会更高
    const mid = withHold(8000);
    let last = 0;
    for (const D of [2000, 6000, 9000, 12000, 20000, 60000]) {
      const lift = liftOf('gate-tower', scene, mid, D);
      expect(lift).toBeCloseTo((62 + 8) * figureTimes(mid, 'wallH', D) + 76 * figureTimes(mid, 'tower', D), 9);
      expect(lift).toBeGreaterThanOrEqual(last);
      last = lift;
    }
    expect(liftOf('gate-tower', scene, mid, 2000)).toBeLessThan(147);
    expect(liftOf('gate-tower', scene, mid, 60000)).toBeGreaterThan(250);
  });

  it('抬高用哪一类看它摆在哪：直接在城墙上的楼（角楼）、亭、屋是“墙顶上的”几类，立在地上的是另外几类；堤、土坡不乘', () => {
    const W = FIXTURE_M.wall;
    const more = fixtureScene();
    const basis = { class: 'schematic' as const, basis: '测试用。', sourceIds: [] };
    more.things.push(
      { id: 'corner', name: '角楼', kind: 'tower', on: 'wall', at: fixturePoint(W.x0, W.z0), ...basis },
      { id: 'top-pavilion', name: '墙上的亭', kind: 'pavilion', on: 'wall', at: fixturePoint(W.x1, W.z0), ...basis },
      { id: 'top-shed', name: '墙上的棚子', kind: 'house', on: 'wall', at: fixturePoint(W.x1, W.z1), ...basis },
      { id: 'lone-tower', name: '地上的楼', kind: 'tower', at: fixturePoint(900, 700), ...basis },
      { id: 'lone-pavilion', name: '地上的亭', kind: 'pavilion', at: fixturePoint(900, 300), ...basis },
      { id: 'lone-hut', name: '地上的屋', kind: 'house', at: fixturePoint(900, -700), ...basis },
      { id: 'temple', name: '城外的寺', kind: 'hall-group', at: fixturePoint(400, 800), ...basis },
      { id: 'office', name: '城里的官署', kind: 'hall-group', at: fixturePoint(FIXTURE_M.city[0], FIXTURE_M.city[1]), ...basis },
      { id: 'dike', name: '堤', kind: 'dike', line: [fixturePoint(300, 300), fixturePoint(300, 600)], ...basis },
    );
    const L = style.stripLift;
    const wallTop = 62 * 1.5;
    expect(liftOf('corner', more, style, FAR_D)).toBeCloseTo(wallTop + L.tower * 2.5, 6);
    expect(liftOf('top-pavilion', more, style, FAR_D)).toBeCloseTo(wallTop + L.pavilion * 2.5, 6);
    // 墙顶上的棚子另有自己的数，不用“屋”的那个：那个点要悬在棚子上面，不压着它（棚子从墙顶到棚顶 12.5）；乘的还是棚子这一类的倍数
    const shedLift = style.stripLiftByClass?.shed;
    expect(shedLift).toBeGreaterThan(12.5);
    expect(shedLift).not.toBe(L.house);
    expect(liftOf('top-shed', more, style, FAR_D)).toBeCloseTo(wallTop + shedLift! * 5, 6);
    // 没有另写的样式照旧用“屋”的数
    expect(liftOf('top-shed', more, { ...style, stripLiftByClass: undefined }, FAR_D)).toBeCloseTo(wallTop + L.house * 5, 6);
    expect(liftOf('lone-tower', more, style, FAR_D)).toBeCloseTo(L.tower * 2, 6);
    expect(liftOf('lone-pavilion', more, style, FAR_D)).toBeCloseTo(L.pavilion * 3, 6);
    expect(liftOf('lone-hut', more, style, FAR_D)).toBeCloseTo(L.house * 4, 6);
    expect(liftOf('temple', more, style, FAR_D)).toBeCloseTo(L['hall-group'] * 1.75, 6);
    expect(liftOf('office', more, style, FAR_D)).toBeCloseTo(L['hall-group'] * 1.25, 6);
    expect(liftOf('dike', more, style, FAR_D)).toBe(L.dike);
  });

  it('贴在城墙旁边的堤和土坡不加城墙的高度', () => {
    const more = fixtureScene();
    more.things.push({
      id: 'inner-dike',
      name: '城里的堤',
      kind: 'dike',
      on: 'wall',
      line: [fixturePoint(-580, 0), fixturePoint(-580, 300)],
      class: 'text',
      basis: '测试用。',
      sourceIds: ['f1'],
    });
    expect(liftOf('inner-dike', more, style, 6000)).toBe(style.stripLift.dike);
    expect(liftOf('inner-dike', more, style, FAR_D)).toBe(style.stripLift.dike);
  });

  it('mustShow 里的东西各是哪几个点：城墙是四个角（抬到墙顶）再加墙脚外面的四个点，远处落在沙盘边上，河上的点落在水面上', () => {
    const section: SceneSection = { ...scene.sections[0], camera: { ...scene.sections[0].camera, mustShow: ['wall', 'far-town', 'hill', 'river'] } };
    const points = showPoints(section, scene, ground, coords, style);
    const W = FIXTURE_M.wall;

    const wallTop = coords.y(FIXTURE_HEIGHTS.city) + 62;
    const wall = points.slice(0, 4);
    expect(wall.map((p) => [Math.round(p[0]), Math.round(p[2])])).toEqual([
      [W.x0, W.z0],
      [W.x1, W.z0],
      [W.x1, W.z1],
      [W.x0, W.z1],
    ]);
    // 角上的点差不到一厘米落在格点上，取到的地面高度会差一点点
    for (const p of wall) expect(p[1]).toBeCloseTo(wallTop, 1);

    // 墙脚：四个角各往外 60 米，落在地面上（墙身有厚度，角台更宽；只算墙顶的话，斜着看墙脚会落到画面外面）
    const feet = points.slice(4, 8);
    expect(feet.map((p) => [Math.round(p[0]), Math.round(p[2])])).toEqual([
      [W.x0 - 60, W.z0 - 60],
      [W.x1 + 60, W.z0 - 60],
      [W.x1 + 60, W.z1 + 60],
      [W.x0 - 60, W.z1 + 60],
    ]);
    for (const p of feet) expect(p[1]).toBeLessThan(wallTop - 40);

    // 远处在西南 216.87 度：朝着它走，从南边出沙盘
    const far = points[8];
    expect(far[2]).toBeCloseTo(coords.z1, 3);
    expect(far[0]).toBeCloseTo(-900, 0);

    // 山顶比平地高 60 米
    const hill = points[9];
    expect(hill[1]).toBeCloseTo(coords.y(FIXTURE_HEIGHTS.plainBase + 60), 0);

    // 河的中线有两点在沙盘里面；河床比平时的水面低，点落在水面上
    const river = points.slice(10);
    expect(river.length).toBeGreaterThan(0);
    for (const p of river) expect(p[1]).toBeCloseTo(coords.y(FIXTURE_HEIGHTS.normal), 6);
  });

  it('mustShow 里写了一段急滩：它写的那一点，加上顺着河往上、往下各半段长的两头，都落在水面上', () => {
    const grounds = { class: 'schematic' as const, basis: '测试用。', sourceIds: [] };
    const more = fixtureScene();
    // 河的上一段正南正北（x = −100），下一段从 (−100, 500) 斜到 (60, 1400)
    more.water.rapids.push(
      { id: 'falls', name: '样滩', river: 'river', at: fixturePoint(-100, 0), lengthM: 300, ...grounds },
      { id: 'lower-falls', name: '下滩', river: 'river', at: fixturePoint(-20, 950), lengthM: 200, ...grounds },
      { id: 'lost-falls', name: '没有河的滩', river: 'no-such-river', at: fixturePoint(400, 400), lengthM: 200, ...grounds },
    );
    const water = coords.y(FIXTURE_HEIGHTS.normal);
    const pointsFor = (id: string): Vec3[] => showPoints({ ...more.sections[0], camera: { ...more.sections[0].camera, mustShow: [id] } }, more, ground, coords, style);
    // 加 0 是把 −0 变成 0
    const flat = (points: Vec3[]): number[][] => points.map((p) => [Math.round(p[0] * 10) / 10 + 0, Math.round(p[2] * 10) / 10 + 0]);

    const upper = pointsFor('falls');
    expect(flat(upper)).toEqual([
      [-100, 0],
      [-100, -150],
      [-100, 150],
    ]);
    for (const p of upper) expect(p[1]).toBeCloseTo(water, 6);

    // 斜着的那一段：两头顺着河的方向，各离那一点 100 米
    const lower = pointsFor('lower-falls');
    expect(lower).toHaveLength(3);
    const along = Math.hypot(160, 900);
    expect(lower[1][0]).toBeCloseTo(-20 - (160 / along) * 100, 1);
    expect(lower[1][2]).toBeCloseTo(950 - (900 / along) * 100, 1);
    expect(lower[2][0]).toBeCloseTo(-20 + (160 / along) * 100, 1);
    expect(lower[2][2]).toBeCloseTo(950 + (900 / along) * 100, 1);

    // 它写的那条河找不到：只有那一点
    expect(flat(pointsFor('lost-falls'))).toEqual([[400, 400]]);

    // 两头算进去以后，画面窄了镜头退到两头都看得见：只算中间那一点时退得少，上头那一截还在画面外面
    // 朝东看，河正南正北：急滩横在画面上，在对准的那一点的左边（北边）600 米，上头再往左 150 米
    const looking: SceneCamera = { target: fixturePoint(-100, 600), distanceM: 6000, pitch: 55, bearing: 90, mustShow: ['falls'] };
    const narrowPane = { width: 360, height: 760 };
    const section: SceneSection = { ...more.sections[0], camera: looking };
    const withEnds = placeCamera(section, more, ground, coords, style, narrowPane);
    const bare = fixtureScene();
    bare.water.rapids.push({ id: 'falls', name: '样滩', river: 'no-such-river', at: fixturePoint(-100, 0), lengthM: 300, ...grounds });
    const pointOnly = placeCamera(section, bare, ground, coords, style, narrowPane);
    expect(pointOnly.fit).toBeGreaterThan(1);
    expect(withEnds.fit).toBeGreaterThan(pointOnly.fit);
    const seen = (view: typeof withEnds, p: Vec3): { x: number; y: number } => {
      const camera = new PerspectiveCamera(view.pose.fov, narrowPane.width / narrowPane.height, 60, view.distanceM * 3 + 30000);
      camera.position.set(...view.pose.position);
      camera.lookAt(...view.pose.target);
      camera.updateMatrixWorld(true);
      return project(p, camera, narrowPane);
    };
    for (const p of upper) {
      const at = seen(withEnds, p);
      expect(at.x).toBeGreaterThanOrEqual(FIT_MARGIN_PX - 0.01);
      expect(at.x).toBeLessThanOrEqual(narrowPane.width - FIT_MARGIN_PX + 0.01);
    }
    // 只算中间那一点：那一点刚好贴着留的边，上头那一截在画面外面
    expect(seen(pointOnly, upper[0]).x).toBeCloseTo(FIT_MARGIN_PX, 0);
    expect(seen(pointOnly, upper[1]).x).toBeLessThan(0);
  });

  it('mustShow 写 frame：整块沙盘，连座子一起算（沙盘的四个角，加上座子最宽那一圈的四个角）', () => {
    const points = showPoints(scene.sections[0], scene, ground, coords, style);
    expect(points).toEqual(framePoints(coords));
    expect(points.slice(0, 4)).toEqual(corners);
    // 座子比沙盘的边宽出一截，在桌面以下
    const stand = points.slice(4);
    expect(stand).toHaveLength(4);
    expect(Math.min(...stand.map((p) => p[0]))).toBeLessThan(coords.x0 - 600);
    expect(Math.max(...stand.map((p) => p[2]))).toBeGreaterThan(coords.z1 + 600);
    for (const p of stand) expect(p[1]).toBeLessThan(-170);
  });

  it('anchorOf：平面上的位置就是 stripPoint 给的那一点；城墙上的题签在墙顶，远看时抬得更高；远处的题签在沙盘边上', () => {
    const town = scene.strips.find((s) => s.id === 's-town')!;
    const near = anchorOf(town, scene, ground, coords, style, 6000);
    const [x, z] = coords.toLocal(stripPoint(scene, town));
    expect([near[0], near[2]]).toEqual([x, z]);
    expect(near[0]).toBeCloseTo(FIXTURE_M.city[0], 1);
    expect(near[2]).toBeCloseTo(FIXTURE_M.wall.z0, 1);
    expect(near[1]).toBeCloseTo(coords.y(FIXTURE_HEIGHTS.city) + 62, 1);
    // 远了，城墙的模型拔高了，题签跟着高；平面上的位置不动
    const far = anchorOf(town, scene, ground, coords, style, FAR_D);
    expect(far[1]).toBeCloseTo(coords.y(FIXTURE_HEIGHTS.city) + 62 * 1.5, 1);
    expect([far[0], far[2]]).toEqual([x, z]);

    const farTown = anchorOf(scene.strips.find((s) => s.id === 's-far')!, scene, ground, coords, style, 6000);
    expect(farTown[2]).toBeCloseTo(coords.z1, 1);
  });

  it('题签指着城门或城门上的楼：指的是城门真正落在的那一点（写偏了、写得离墙角太近时模型是挪过的）；题签自己写了 at 的照它写的', () => {
    const W = FIXTURE_M.wall;
    const moved = fixtureScene();
    const gate = moved.things.find((t) => t.id === 'gate-south')!;
    const tower = moved.things.find((t) => t.id === 'gate-tower')!;
    // 城门写在离西南角 40 米、墙外 25 米的地方；楼写的还是原来的位置
    gate.at = fixturePoint(W.x0 + 40, W.z1 + 25);
    moved.strips.push({ id: 's-gate', text: '南门', of: 'gate-south' }, { id: 's-tower', text: '门楼', of: 'gate-tower' }, { id: 's-own', text: '门楼', of: 'gate-tower', at: fixturePoint(W.x0 + 200, W.z1) });
    for (const id of ['s-gate', 's-tower']) {
      const at = anchorOf(moved.strips.find((s) => s.id === id)!, moved, ground, coords, style, 6000);
      expect(at[0]).toBeCloseTo(W.x0 + 86, 1);
      expect(at[2]).toBeCloseTo(W.z1, 1);
    }
    expect(tower.at).toBeDefined();
    const own = anchorOf(moved.strips.find((s) => s.id === 's-own')!, moved, ground, coords, style, 6000);
    expect(own[0]).toBeCloseTo(W.x0 + 200, 1);
  });

  it('没写 mustShow 时，要看的点就是这一节各条题签指着的点', () => {
    const second = scene.sections[1];
    const points = showPoints(second, scene, ground, coords, style);
    expect(points).toHaveLength(second.strips.length);
    const town = scene.strips.find((s) => s.id === 's-town')!;
    expect(points[0]).toEqual(anchorOf(town, scene, ground, coords, style, equivalentDistance(second.camera.distanceM, second.camera.fov ?? DEFAULT_FOV, 900)));
  });

  it('showPoints 的抬高：按“场景里写的距离、现在这么高的画面”折算出来的远近算；画面矮了模型放得大，要看的点跟着高', () => {
    // 第二节镜头写的是 2400 米、视角 22 度：900 像素高的画面上折算下来是两千五百多米，338 像素高的是六千七百多米。
    // 表里从 4000 米起放大：前一种画面上城墙还是本来的高，后一种已经拔高了
    const mid = withHold(4000);
    const second = scene.sections[1];
    const strips = second.strips.map((id) => scene.strips.find((s) => s.id === id)!);
    const tall = equivalentDistance(second.camera.distanceM, second.camera.fov ?? DEFAULT_FOV, 900);
    const short = equivalentDistance(second.camera.distanceM, second.camera.fov ?? DEFAULT_FOV, 338);
    expect(tall).toBeGreaterThan(2400);
    expect(tall).toBeLessThan(2700);
    expect(short).toBeGreaterThan(6500);
    expect(showPoints(second, scene, ground, coords, mid, 900)).toEqual(stripSpots(strips, scene, ground, coords, mid, tall).map((s) => s.at));
    expect(showPoints(second, scene, ground, coords, mid, 338)).toEqual(stripSpots(strips, scene, ground, coords, mid, short).map((s) => s.at));
    // 不说画面多高，当 900
    expect(showPoints(second, scene, ground, coords, mid)).toEqual(showPoints(second, scene, ground, coords, mid, 900));
    const city = coords.y(FIXTURE_HEIGHTS.city);
    expect(showPoints(second, scene, ground, coords, mid, 900)[0][1]).toBeLessThan(city + 62 * 1.05);
    expect(showPoints(second, scene, ground, coords, mid, 338)[0][1]).toBeGreaterThan(city + 62 * 1.3);

    // 写了 mustShow 的也一样：城墙顶上的四个点跟着高，墙脚的四个点不动
    const walled: SceneSection = { ...second, camera: { ...second.camera, mustShow: ['wall'] } };
    const a = showPoints(walled, scene, ground, coords, mid, 900);
    const b = showPoints(walled, scene, ground, coords, mid, 338);
    expect(a).toHaveLength(8);
    for (let i = 0; i < 4; i++) expect(b[i][1] - a[i][1]).toBeCloseTo(62 * (figureTimes(mid, 'wallH', short) - figureTimes(mid, 'wallH', tall)), 6);
    expect(b.slice(4)).toEqual(a.slice(4));
  });
});

describe('跟着一座小建筑整组放大的东西', () => {
  /** 那座小沙盘上添一座草屋，草屋东边 30 米一座小亭、东北角一片果树：都落在草屋放大到头占的那一块里，跟着它成一组。 */
  function withHut(): StopScene {
    const more = fixtureScene();
    const basis = { class: 'schematic' as const, basis: '测试用。', sourceIds: [] };
    more.things.push(
      { id: 'hut', name: '草屋', kind: 'house', at: fixturePoint(900, 600), ...basis },
      { id: 'hut-kiosk', name: '屋旁的小亭', kind: 'pavilion', at: fixturePoint(930, 600), ...basis },
    );
    more.dressing.push({ id: 'hut-trees', name: '屋旁的果树', kind: 'trees', at: fixturePoint(920, 580), params: { type: 'fruit', radiusM: 20 }, class: 'dressing', basis: '测试用。', sourceIds: [] });
    more.strips.push({ id: 's-hut', text: '草屋', of: 'hut' }, { id: 's-kiosk', text: '小亭', of: 'hut-kiosk' }, { id: 's-trees', text: '果树', of: 'hut-trees' });
    return more;
  }
  const strip = (s: StopScene, id: string): SceneStrip => s.strips.find((x) => x.id === id)!;

  it('先核对这座小沙盘：小亭和果树确实进了草屋那一组', () => {
    const groups = figureGroups(withHut(), style);
    expect(groups).toHaveLength(1);
    expect(groups[0].main).toBe('hut');
    expect(groups[0].cls).toBe('hut');
    expect(groups[0].members).toEqual(['hut-kiosk', 'hut-trees']);
  });

  it('模型是本来的大小时，各在各写的位置上', () => {
    const more = withHut();
    expect(anchorOf(strip(more, 's-kiosk'), more, ground, coords, style, 6000)[0]).toBeCloseTo(930, 1);
    expect(anchorOf(strip(more, 's-trees'), more, ground, coords, style, 6000)[2]).toBeCloseTo(580, 1);
    expect(liftOf('hut-kiosk', more, style, 6000)).toBeCloseTo(style.stripLift.pavilion, 6);
  });

  it('放大以后：跟着的东西从草屋的脚摊开，题签指着的那一点跟着挪；抬高乘的是这一组（草屋）的倍数，不是它自己那一类的', () => {
    const more = withHut();
    // 草屋这一类放大到头是 4 倍，摊开也是 4 倍；亭自己那一类是 3 倍
    const hut = anchorOf(strip(more, 's-hut'), more, ground, coords, style, FAR_D);
    expect(hut[0]).toBeCloseTo(900, 1);
    expect(hut[2]).toBeCloseTo(600, 1);
    const kiosk = anchorOf(strip(more, 's-kiosk'), more, ground, coords, style, FAR_D);
    expect(kiosk[0]).toBeCloseTo(900 + 30 * 4, 1);
    expect(kiosk[2]).toBeCloseTo(600, 1);
    expect(liftOf('hut-kiosk', more, style, FAR_D)).toBeCloseTo(style.stripLift.pavilion * 4, 6);
    expect(liftOf('hut', more, style, FAR_D)).toBeCloseTo(style.stripLift.house * 4, 6);
    // 点缀（果树）也跟着挪，它没有抬高
    const trees = anchorOf(strip(more, 's-trees'), more, ground, coords, style, FAR_D);
    expect(trees[0]).toBeCloseTo(900 + 20 * 4, 1);
    expect(trees[2]).toBeCloseTo(600 - 20 * 4, 1);
    expect(trees[1]).toBeCloseTo(coords.y(ground.height(trees[0], trees[2])), 6);

    // 半路上：摊开多少就是 figureNow 给的那个数
    const mid = withHold(5000);
    const D = 9000;
    const spread = figureNow(mid.figure.rules.hut, D).spread;
    expect(spread).toBeGreaterThan(1.2);
    expect(spread).toBeLessThan(3.9);
    expect(anchorOf(strip(more, 's-kiosk'), more, ground, coords, mid, D)[0]).toBeCloseTo(900 + 30 * spread, 1);
  });

  it('要看得见的点（mustShow）里写了跟着的东西，也是挪过、抬过以后的', () => {
    const more = withHut();
    const section: SceneSection = { ...more.sections[1], camera: { ...more.sections[1].camera, distanceM: FAR_D, fov: 21, mustShow: ['hut-kiosk'] } };
    const [top, foot] = showPoints(section, more, ground, coords, style, 900);
    expect(top[0]).toBeCloseTo(900 + 30 * 4, 1);
    expect(top[1] - foot[1]).toBeCloseTo(style.stripLift.pavilion * 4, 3);
    expect(foot[0]).toBeCloseTo(top[0], 6);
  });
});

describe('placeCamera：一小节的镜头在某一种画面上摆好', () => {
  const INSETS: StageInsets = { top: 54, right: 0, bottom: 95, left: 0 };

  it.each([
    ['880 × 900，四边不留空', WIDE, NONE],
    ['584 × 768，上面留 54、下面留 95', TABLET, INSETS],
    ['768 × 573，上面留 54、下面留 131', UPRIGHT, { top: 54, right: 0, bottom: 131, left: 0 }],
  ] as [string, { width: number; height: number }, StageInsets][])('%s：和一步一步自己算的一样；fit 是写的距离的几倍；reach 是要看的点离对准的那一点最远多少像素', (_name, size, insets) => {
    for (const section of scene.sections) {
      const cam = section.camera;
      const placed = placeCamera(section, scene, ground, coords, style, size, insets);
      // 一步一步算：先按写的距离摆，取要看的点，再定退多远；看整块沙盘的一节，对准的那一点再挪一挪
      const authored = poseOn(cam, ground, coords);
      const points = showPoints(section, scene, ground, coords, style, size.height);
      const fitted = wholeTable(section)
        ? centredView(cam, authored.target, points, size, insets)
        : { target: authored.target, distanceM: fitDistance(cam, authored.target, points, size, insets) };
      expect(placed.points).toEqual(points);
      expect(placed.distanceM).toBe(fitted.distanceM);
      expect(placed.pose).toEqual(poseAt(cam, fitted.target, fitted.distanceM));
      expect(placed.fit).toBeCloseTo(fitted.distanceM / cam.distanceM, 12);
      expect(placed.fit).toBeLessThanOrEqual(MAX_FIT);

      // reach：用 three 自己的镜头把这些点再投一遍，离留出来的那一块的中心最远多少像素
      const three = threeCamera(placed.pose, size, insets);
      const centre = project(placed.pose.target, three, size);
      let rx = 0;
      let ry = 0;
      for (const p of points) {
        const at = project(p, three, size);
        rx = Math.max(rx, Math.abs(at.x - centre.x));
        ry = Math.max(ry, Math.abs(at.y - centre.y));
      }
      expect(placed.reach[0]).toBeCloseTo(rx, 3);
      expect(placed.reach[1]).toBeCloseTo(ry, 3);
      expect(reachOf(cam, placed.pose.target, placed.distanceM, points, size.height)).toEqual(placed.reach);
      // 镜头退到位以后，要看的点都在留出来的那一块里（离边至少 FIT_MARGIN_PX），除非已经退到头
      if (placed.fit < MAX_FIT - 1e-9) {
        expect(placed.reach[0]).toBeLessThanOrEqual((size.width - insets.left - insets.right) / 2 - FIT_MARGIN_PX + 1e-6);
        expect(placed.reach[1]).toBeLessThanOrEqual((size.height - insets.top - insets.bottom) / 2 - FIT_MARGIN_PX + 1e-6);
      }
    }
  });

  it('没有要看的点：reach 是 [0, 0]', () => {
    expect(reachOf(scene.sections[0].camera, [0, 0, 0], 5000, [], 900)).toEqual([0, 0]);
  });
});

describe('screenAnchors：题签指着的点落在画面的哪里', () => {
  const size = WIDE;
  const strips = scene.strips;
  const town = strips.find((s) => s.id === 's-town')!;
  const river = strips.find((s) => s.id === 's-river')!;
  const farStrip = strips.find((s) => s.id === 's-far')!;

  /** 从南边看整块沙盘的镜头，和这时候折算过的远近。 */
  function southView(): { camera: PerspectiveCamera; D: number } {
    const cam = cameraFromSouth(9000);
    return { camera: threeCamera(pose(cam, coords, 0), size), D: equivalentDistance(9000, DEFAULT_FOV, size.height) };
  }

  it('按题签的先后，一条一个；位置就是 anchorOf 那一点投到画面上；和 stripSpots 再 projectSpots 是一回事', () => {
    const { camera, D } = southView();
    const anchors = screenAnchors(strips, scene, ground, coords, style, D, camera, size);
    expect(anchors.map((a) => a.id)).toEqual(strips.map((s) => s.id));
    strips.forEach((s, i) => {
      const at = project(anchorOf(s, scene, ground, coords, style, D), camera, size);
      expect(anchors[i].x).toBeCloseTo(at.x, 9);
      expect(anchors[i].y).toBeCloseTo(at.y, 9);
      expect(anchors[i].visible).toBe(at.visible);
    });
    expect(projectSpots(stripSpots(strips, scene, ground, coords, style, D), coords, camera, size)).toEqual(anchors);
    const spots = stripSpots(strips, scene, ground, coords, style, D);
    expect(spots.map((s) => s.far)).toEqual([false, false, true]);
    expect(spots[0].footY).toBeCloseTo(coords.y(FIXTURE_HEIGHTS.city), 1);
    expect(spots[1].footY).toBeNull();
    expect(spots[2].footY).toBeNull();
  });

  it('foot：抬高过的才有，是那一点脚下的地面落在画面的哪里（在那一点的正下方）；贴着地面的没有', () => {
    const { camera, D } = southView();
    const anchors = screenAnchors(strips, scene, ground, coords, style, D, camera, size);
    const wall = anchors[0];
    const top = anchorOf(town, scene, ground, coords, style, D);
    const below = project([top[0], coords.y(ground.height(top[0], top[2])), top[2]], camera, size);
    expect(wall.foot).toBeDefined();
    expect(wall.foot!.x).toBeCloseTo(below.x, 6);
    expect(wall.foot!.y).toBeCloseTo(below.y, 6);
    // 镜头朝正北看：脚差不多在正下方（那一点偏在画面左边，竖直的线在画面上稍微有一点斜），隔着墙那么高
    expect(Math.abs(wall.foot!.x - wall.x)).toBeLessThan(1);
    expect(wall.foot!.y).toBeGreaterThan(wall.y + 3);
    // 模型放大以后，那一点更高，脚不动
    const far = screenAnchors([town], scene, ground, coords, style, FAR_D, camera, size)[0];
    expect(far.foot!.y).toBeCloseTo(wall.foot!.y, 6);
    expect(far.y).toBeLessThan(wall.y - 1);
    expect(anchors[1].foot).toBeUndefined();
    expect(anchors[2].foot).toBeUndefined();
    expect(screenAnchors([river], scene, ground, coords, style, FAR_D, camera, size)[0].foot).toBeUndefined();
  });

  it('out：远处的题签才有，长度为 1，是画面上从沙盘中间朝那一点去的方向', () => {
    const { camera, D } = southView();
    const anchors = screenAnchors(strips, scene, ground, coords, style, D, camera, size);
    expect(anchors[0].out).toBeUndefined();
    expect(anchors[1].out).toBeUndefined();
    const out = anchors[2].out;
    expect(out).toBeDefined();
    expect(Math.hypot(out![0], out![1])).toBeCloseTo(1, 9);
    // 用 three 自己的镜头核对：沙盘的中间和沙盘边上的那一点各投一遍
    const edge = anchorOf(farStrip, scene, ground, coords, style, D);
    const a = project([(coords.x0 + coords.x1) / 2, edge[1], (coords.z0 + coords.z1) / 2], camera, size);
    const b = project(edge, camera, size);
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    expect(out![0]).toBeCloseTo((b.x - a.x) / length, 6);
    expect(out![1]).toBeCloseTo((b.y - a.y) / length, 6);
    // 远镇在西南，从沙盘的南边出去：从南边看过去，题签朝画面的左下
    expect(out![0]).toBeLessThan(0);
    expect(out![1]).toBeGreaterThan(0);
  });

  it('out：贴近了看沙盘边上、沙盘的中间落在镜头背后时，方向照样朝外，不会反过来', () => {
    // 镜头在沙盘中间和那一点之间，离那一点 500 米，朝着它（朝外）看
    const edge = anchorOf(farStrip, scene, ground, coords, style, 3000);
    const mx = (coords.x0 + coords.x1) / 2;
    const mz = (coords.z0 + coords.z1) / 2;
    const ux = (edge[0] - mx) / Math.hypot(edge[0] - mx, edge[2] - mz);
    const uz = (edge[2] - mz) / Math.hypot(edge[0] - mx, edge[2] - mz);
    const camera = new PerspectiveCamera(DEFAULT_FOV, size.width / size.height, 10, 1e6);
    camera.position.set(edge[0] - ux * 500, edge[1] + 300, edge[2] - uz * 500);
    camera.lookAt(new Vector3(edge[0], edge[1], edge[2]));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // 沙盘的中间在镜头背后：直接投出来是反的
    expect(new Vector3(mx, edge[1], mz).applyMatrix4(camera.matrixWorldInverse).z).toBeGreaterThan(0);
    const anchor = screenAnchors([farStrip], scene, ground, coords, style, 3000, camera, size)[0];
    expect(anchor.visible).toBe(true);
    // 朝外走一小步，画面上往哪边：out 应当和它同一个方向
    const here = project(edge, camera, size);
    const inner = project([edge[0] - ux * 50, edge[1], edge[2] - uz * 50], camera, size);
    const length = Math.hypot(here.x - inner.x, here.y - inner.y);
    expect(anchor.out).toBeDefined();
    expect(anchor.out![0] * ((here.x - inner.x) / length) + anchor.out![1] * ((here.y - inner.y) / length)).toBeGreaterThan(0.999);
    // 镜头朝着它看，朝外就是往画面上方去
    expect(anchor.out![1]).toBeLessThan(-0.9);
  });

  it('out：那一点自己在镜头背后时没有方向（题签反正不摆）', () => {
    const edge = anchorOf(farStrip, scene, ground, coords, style, 3000);
    const camera = new PerspectiveCamera(DEFAULT_FOV, size.width / size.height, 10, 1e6);
    camera.position.set(edge[0], edge[1] + 300, edge[2] - 500);
    // 背朝着它
    camera.lookAt(new Vector3(edge[0], edge[1], edge[2] - 5000));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const anchor = screenAnchors([farStrip], scene, ground, coords, style, 3000, camera, size)[0];
    expect(anchor.visible).toBe(false);
    expect(anchor.out).toBeUndefined();
  });

  it('四边留了空（画面的中心挪过）：位置、out、foot 都按挪过以后的画面算', () => {
    const insets: StageInsets = { top: 62, right: 0, bottom: 130, left: 0 };
    const cam = cameraFromSouth(9000);
    const camera = threeCamera(pose(cam, coords, 0), size, insets);
    const D = equivalentDistance(9000, DEFAULT_FOV, size.height);
    const plain = screenAnchors(strips, scene, ground, coords, style, D, southView().camera, size);
    const shifted = screenAnchors(strips, scene, ground, coords, style, D, camera, size);
    const [, dy] = centreShift(insets);
    shifted.forEach((a, i) => {
      expect(a.x).toBeCloseTo(plain[i].x, 6);
      expect(a.y).toBeCloseTo(plain[i].y + dy, 6);
    });
    expect(shifted[0].foot!.y).toBeCloseTo(plain[0].foot!.y + dy, 6);
    expect(shifted[2].out![0]).toBeCloseTo(plain[2].out![0], 9);
    expect(shifted[2].out![1]).toBeCloseTo(plain[2].out![1], 9);
  });
});

describe('shadowTuning：影子的虚实和偏移，按影子罩多大一块来定', () => {
  it('罩得最小（半边长 1250，贴近了看黄楼）是样张贴近看的数；3300 以上是平常的数', () => {
    expect(shadowTuning(1250)).toEqual({ radius: 3, bias: -0.0002, normalBias: 0.6 });
    expect(shadowTuning(800)).toEqual({ radius: 3, bias: -0.0002, normalBias: 0.6 });
    for (const half of [3300, 4928, 5376, 7600]) {
      const t = shadowTuning(half);
      expect(t.radius).toBeCloseTo(2.2, 12);
      expect(t.bias).toBeCloseTo(-0.0006, 12);
      expect(t.normalBias).toBeCloseTo(1.6, 12);
    }
  });

  it('徐州七个镜头在定稿画面上罩的那一块：水退以后是贴近看的数，另外六个都是平常的数', () => {
    // shadowBox 的半边长是 0.56 × 镜头的距离，最小 1250
    const xuzhou = frameCoords({ ...scene.frame, westM: 6300, eastM: 5400, northM: 5400, southM: 4300 });
    expect(shadowTuning(shadowBox([0, 0], 1150, xuzhou).half)).toEqual({ radius: 3, bias: -0.0002, normalBias: 0.6 });
    for (const distanceM of [52000, 10800, 9600, 8800, 13000, 15000]) {
      const t = shadowTuning(shadowBox([0, 0], distanceM, xuzhou).half);
      expect(t.radius).toBeCloseTo(2.2, 12);
      expect(t.bias).toBeCloseTo(-0.0006, 12);
      expect(t.normalBias).toBeCloseTo(1.6, 12);
    }
  });

  it('中间连着变，没有跳的地方：罩得越大，影子边越实、偏移越大', () => {
    let last = shadowTuning(1250);
    for (let half = 1260; half <= 3400; half += 10) {
      const t = shadowTuning(half);
      expect(t.radius).toBeLessThanOrEqual(last.radius);
      expect(last.radius - t.radius).toBeLessThan(0.02);
      expect(t.bias).toBeLessThanOrEqual(last.bias);
      expect(t.normalBias).toBeGreaterThanOrEqual(last.normalBias);
      expect(t.normalBias - last.normalBias).toBeLessThan(0.02);
      last = t;
    }
    const mid = shadowTuning((1250 + 3300) / 2);
    expect(mid.radius).toBeCloseTo(2.6, 9);
    expect(mid.bias).toBeCloseTo(-0.0004, 9);
    expect(mid.normalBias).toBeCloseTo(1.1, 9);
  });
});

describe('画面上的位置、指北、比例尺', () => {
  it('project：对准的那一点在画面正中；镜头背后的点看不见', () => {
    const camera = cameraFromSouth(8000);
    const p = pose(camera, coords, 0);
    const three = threeCamera(p, WIDE);
    const centre = project(p.target, three, WIDE);
    expect(centre.x).toBeCloseTo(440, 3);
    expect(centre.y).toBeCloseTo(450, 3);
    expect(centre.visible).toBe(true);
    // 东边的点在画面右边，北边（远处）的点在画面上边
    expect(project([500, 0, 0], three, WIDE).x).toBeGreaterThan(440);
    expect(project([0, 0, -500], three, WIDE).y).toBeLessThan(450);
    // 镜头在南边 6000 多米；再往南的点在镜头背后
    expect(project([0, 0, 20000], three, WIDE).visible).toBe(false);
    // 画面外面的点也算看不见
    expect(project([30000, 0, 0], three, WIDE).visible).toBe(false);
  });

  it('northDeg：朝北看是 0，朝东看北在左边（−90），朝西看北在右边（90），朝南看是 180', () => {
    const at = (bearing: number, pitch = 50): number => northDeg(threeCamera(pose(cameraFromSouth(8000, { bearing, pitch }), coords, 0), WIDE));
    expect(at(0)).toBeCloseTo(0, 6);
    expect(at(90)).toBeCloseTo(-90, 6);
    expect(at(270)).toBeCloseTo(90, 6);
    expect(Math.abs(at(180))).toBeCloseTo(180, 6);
    expect(at(256)).toBeCloseTo(104, 6);
    // 接近正俯视也认得出朝向
    expect(at(90, 0)).toBeCloseTo(-90, 3);
    expect(at(0, 85)).toBeCloseTo(0, 6);
  });

  it('pixelsPerMetre：在对准的那一点，横着的 1000 米在画面上有多宽，和投出来的一样', () => {
    const p = pose(cameraFromSouth(8000), coords, 0);
    const three = threeCamera(p, WIDE);
    const a = project([p.target[0] - 500, p.target[1], p.target[2]], three, WIDE);
    const b = project([p.target[0] + 500, p.target[1], p.target[2]], three, WIDE);
    expect(pixelsPerMetre(three, p.target, WIDE.height) * 1000).toBeCloseTo(b.x - a.x, 3);
  });

  it('chooseScale：取一个整数的长度，那一段不超过 140 像素、不短于 56 像素', () => {
    expect(chooseScale(0.1)).toEqual({ px: 100, label: '1 公里' });
    expect(chooseScale(0.15)).toEqual({ px: 75, label: '500 米' });
    expect(chooseScale(0.0125)).toEqual({ px: 125, label: '10 公里' });
    expect(chooseScale(1)).toEqual({ px: 100, label: '100 米' });
    // 全程沙盘的画面：一像素是地上的几公里
    expect(chooseScale(0.0005)).toEqual({ px: 100, label: '200 公里' });
    expect(chooseScale(0.00025)).toEqual({ px: 125, label: '500 公里' });
    expect(chooseScale(0.0001)).toEqual({ px: 100, label: '1000 公里' });
    // 100 公里正好 140 像素时还是 100 公里；再远一点才换成 200 公里
    expect(chooseScale(0.0014)).toEqual({ px: 140, label: '100 公里' });
    expect(chooseScale(0.0007)).toEqual({ px: 140, label: '200 公里' });
    for (let pxPerMetre = 0.00006; pxPerMetre < 5; pxPerMetre *= 1.07) {
      const { px } = chooseScale(pxPerMetre);
      expect(px).toBeLessThanOrEqual(140);
      expect(px).toBeGreaterThanOrEqual(56);
    }
  });
});

describe('宋代青绿设色：跟镜头有关的几条规矩', () => {
  it('灯：一种样式只有一盏，只看天色，不看镜头；光从东北上方来', () => {
    const light = song.light('day');
    // 定下来的方向：东北（从沙盘指向太阳）。这是定过的事：要改先由负责人定，定了以后这一行和样式里的数一起改
    expect(light.dir).toEqual([0.66, 0.6, -0.42]);
    // 不看镜头：这个函数除了天色和夜里的月亮不收别的，白天给的总是同一盏
    expect(song.light.length).toBeLessThanOrEqual(2);
    expect(song.light('day')).toBe(light);
    // 白天不看月亮；夜里没有写月亮的（校验不许这样写），还是白天的那一盏，不会摆出一盏没有方向的灯
    expect(song.light('day', { azimuth: 103, altitude: 12 })).toBe(light);
    expect(song.light('night')).toBe(light);
    expect(light.sun).toBeGreaterThan(0);
    expect(light.hemi).toBeGreaterThan(0);
    for (const colour of [light.sunColor, light.sky, light.ground]) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
    // 影子的虚实和偏移不跟着灯走，按影子罩多大一块来定（shadowTuning）
    expect(Object.keys(light).sort()).toEqual(['dir', 'ground', 'hemi', 'sky', 'sun', 'sunColor']);
  });

  it('月亮的方向：0 是正北，顺时针；沙盘里北边是 −z，东边是 +x，上是 +y；长度是 1', () => {
    const near = (got: Vec3, want: Vec3): void => got.forEach((v, i) => expect(v).toBeCloseTo(want[i], 3));
    near(moonDir(90, 0), [1, 0, 0]);
    near(moonDir(0, 0), [0, 0, -1]);
    near(moonDir(180, 0), [0, 0, 1]);
    near(moonDir(270, 0), [-1, 0, 0]);
    near(moonDir(37, 90), [0, 1, 0]);
    // 黄州那三夜里的两个月亮（做黄州以前在徐州的沙盘上试的就是这两个）
    near(moonDir(103, 12), [0.953, 0.208, 0.22]);
    near(moonDir(130, 68), [0.287, 0.927, 0.241]);
    for (const [azimuth, altitude] of [[103, 12], [130, 68], [141, 69], [0, 5], [360, 85]]) expect(Math.hypot(...moonDir(azimuth, altitude))).toBeCloseTo(1, 9);
  });

  it('夜里的一套灯：月光是冷的、比白天淡，方向照写的月亮；雾色、云气色、云气淡几成、水面亮几倍，只有夜里写', () => {
    const day = song.light('day');
    const low = song.light('night', { azimuth: 103, altitude: 12 });
    const high = song.light('night', { azimuth: 130, altitude: 68 });
    // 负责人看过徐州上试的图以后定的（2026-11-23）：月亮 12 度以下是这一头的数。要改先由负责人定，定了以后这里和样式里的数一起改
    expect(low).toEqual({
      dir: moonDir(103, 12),
      sun: 1.15,
      sunColor: '#cfdcf2',
      hemi: 1.05,
      sky: '#b8c8e6',
      ground: '#5f6a7a',
      fog: '#d5deea',
      mist: '#dfe6ee',
      mistStrength: 0.8,
      sheen: 9.1,
    });
    // 月亮 68 度以上是另一头的数：月光、天光都弱一些。两夜差的是方向、这两样强弱和水面亮几倍，颜色、雾、云气一样
    expect(high.sun).toBeCloseTo(0.9, 12);
    expect(high.hemi).toBeCloseTo(0.75, 12);
    expect({ ...high, dir: low.dir, sheen: low.sheen, sun: low.sun, hemi: low.hemi }).toEqual(low);
    expect(high.dir).toEqual(moonDir(130, 68));
    expect(high.sheen).toBe(0);
    // 黄州七月那一夜（月亮 24 度高）：5.1 倍上下
    expect(song.light('night', { azimuth: 111, altitude: 24 }).sheen).toBeCloseTo(5.15, 2);
    // 白天的灯没有这四样：白天的雾、云气用样式里平常的颜色，不压暗
    for (const key of ['fog', 'mist', 'mistStrength', 'sheen']) expect(day).not.toHaveProperty(key);
    // 比白天暗，可不是黑的：月亮 12 度高时平地是白天的四分之一上下，68 度高时三分之一上下
    expect(lightLevel(low)).toBeLessThan(lightLevel(high));
    expect(lightLevel(high)).toBeLessThan(lightLevel(day));
    expect(lightDim(low, day)).toBeCloseTo(0.26, 2);
    expect(lightDim(high, day)).toBeCloseTo(0.35, 2);
  });

  it('夜里的灯跟着月亮的高矮走：12 度以下一套数，68 度以上一套数，中间照高度的正弦匀过去——为的是平地不管月亮高低都差不多亮', () => {
    const day = song.light('day');
    const at = (altitude: number) => song.light('night', { azimuth: 120, altitude });
    // 两头以外不再变
    for (const altitude of [5, 8, 12]) expect([at(altitude).sun, at(altitude).hemi]).toEqual([1.15, 1.05]);
    for (const altitude of [68, 69, 75, 85]) {
      expect(at(altitude).sun).toBeCloseTo(0.9, 12);
      expect(at(altitude).hemi).toBeCloseTo(0.75, 12);
    }
    // 中间：照正弦匀，一路往下。正弦走到一半的那个高度（34.6 度上下），两样正好在两头的中间
    const sin = (deg: number) => Math.sin((deg * Math.PI) / 180);
    const half = (Math.asin((sin(12) + sin(68)) / 2) * 180) / Math.PI;
    expect(at(half).sun).toBeCloseTo((1.15 + 0.9) / 2, 9);
    expect(at(half).hemi).toBeCloseTo((1.05 + 0.75) / 2, 9);
    const heights = [12, 20, 24, 30, 40, 51.9, 60, 68];
    heights.slice(1).forEach((h, i) => {
      expect(at(h).sun, `月光，${heights[i]} 度到 ${h} 度`).toBeLessThan(at(heights[i]).sun);
      expect(at(h).hemi, `天光，${heights[i]} 度到 ${h} 度`).toBeLessThan(at(heights[i]).hemi);
    });
    // 这条规矩是为了什么：白天空旷的平地的亮算 1，夜里的平地在月亮 12 度高和 68 度高时差不到一成（0.1）。
    // 照线性的光比、照屏幕上的亮比（过了显示器的伽马 2.2）都算。两头用同一套数（12 度的那一套）的话差 0.20 和 0.16，不通过。
    // 要留意这说的是“差白天的几成”，不是两夜相比：两夜相比，68 度的那一夜平地还是亮三成（线性；屏幕上亮一成多）。
    const screen = (v: number) => v ** (1 / 2.2);
    const low = lightDim(at(12), day);
    const high = lightDim(at(68), day);
    expect(Math.abs(high - low)).toBeLessThan(0.1);
    expect(Math.abs(screen(high) - screen(low))).toBeLessThan(0.1);
    const sameSet = lightDim({ ...at(68), sun: at(12).sun, hemi: at(12).hemi }, day);
    expect(sameSet - low).toBeGreaterThan(0.15);
    expect(screen(sameSet) - screen(low)).toBeGreaterThan(0.15);
    console.log(
      `夜里的平地（白天算 1）：12 度 ${low.toFixed(3)}（屏幕上 ${screen(low).toFixed(3)}），68 度 ${high.toFixed(3)}（${screen(high).toFixed(3)}）；两头用同一套数时 68 度是 ${sameSet.toFixed(3)}（${screen(sameSet).toFixed(3)}）`,
    );
    // 中间的高度也不出这个圈
    for (const h of heights) expect(Math.abs(lightDim(at(h), day) - low), `${h} 度`).toBeLessThan(0.1);
  });

  it('lightLevel、lightDim：直接照到的那一份跟着光的斜度走，天光不跟；白天压暗的几成正好是 1', () => {
    const day = song.light('day');
    const flat = { ...day, dir: [0, 1, 0] as Vec3 };
    const skyOnly = lightLevel({ ...day, sun: 0 });
    expect(skyOnly).toBeGreaterThan(0);
    // 光从地平线下面来：只剩天光
    expect(lightLevel({ ...day, dir: [1, -0.2, 0] })).toBeCloseTo(skyOnly, 12);
    // 方向不用先归一；斜到 30 度，直接照到的那一份剩一半
    expect(lightLevel({ ...day, dir: [0, 7, 0] })).toBeCloseTo(lightLevel(flat), 12);
    const direct = lightLevel(flat) - skyOnly;
    expect(lightLevel({ ...day, dir: [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0] }) - skyOnly).toBeCloseTo(direct / 2, 12);
    // 两样强度都加倍，亮也加倍；颜色暗了，亮也少了
    expect(lightLevel({ ...flat, sun: day.sun * 2, hemi: day.hemi * 2 })).toBeCloseTo(lightLevel(flat) * 2, 12);
    expect(lightLevel({ ...flat, sunColor: '#808080' })).toBeLessThan(lightLevel(flat));
    // 白天：灯里没有写夜里的雾色、云气色，压暗的几成正好是 1（不是差不多是 1：雾、云气、木头一点不能动）
    expect(lightDim(day, day)).toBe(1);
    expect(lightDim({ ...day, sun: 0.1, hemi: 0.1 }, day)).toBe(1);
    // 写了其中一样，就照两套灯的亮来比
    expect(lightDim({ ...day, fog: '#d5deea' }, day)).toBeCloseTo(1, 12);
    expect(lightDim({ ...day, sun: day.sun / 2, hemi: day.hemi / 2, mist: '#dfe6ee' }, day)).toBeCloseTo(0.5, 12);
  });

  it('sheenFor：月亮低，水面亮得多；越高越小；68 度以上是 0；强弱是 0 就是 0', () => {
    // 这张表是 2026-11-23 对着黄州七月那一夜的图定的：强弱写的是 12 度高时的倍数。
    // 12 度时的 9.1 倍是原来那条线上强弱 3.8 给的（3.8 × (1 − s)³ ÷ s = 9.08），24 度时的 5.1 倍是原来强弱 10 给的（5.13）：
    // 这两样量出来是同一种水面（敞开的江面 133 到 138，照到月光的平地 110 到 117，水纹 181 到 192，白天的水纹 215 到 219）
    const table: [number, number][] = [
      [5, 11.96],
      [8, 10.69],
      [12, 9.1],
      [18, 6.97],
      [24, 5.15],
      [30, 3.64],
      [45, 1.13],
      [60, 0.12],
      [68, 0],
      [75, 0],
      [85, 0],
    ];
    for (const [height, times] of table) expect(sheenFor(9.1, height), `月亮 ${height} 度高`).toBeCloseTo(times, 1);
    const old = (strength: number, height: number): number => (strength * (1 - Math.sin((height * Math.PI) / 180)) ** 3) / Math.sin((height * Math.PI) / 180);
    expect(Math.abs(sheenFor(9.1, 12) - old(3.8, 12))).toBeLessThan(0.05);
    expect(Math.abs(sheenFor(9.1, 24) - old(10, 24))).toBeLessThan(0.05);
    expect(sheenFor(9.1, 68)).toBe(0);
    expect(sheenFor(9.1, 90)).toBe(0);
    expect(sheenFor(0, 12)).toBe(0);
    expect(sheenFor(4, 12)).toBeCloseTo(sheenFor(2, 12) * 2, 12);
    // 越高越小，一路往下，到 68 度为止
    const heights = [5, 8, 12, 20, 30, 45, 60, 67];
    heights.slice(1).forEach((h, i) => expect(sheenFor(9.1, h), `${heights[i]} 度到 ${h} 度`).toBeLessThan(sheenFor(9.1, heights[i])));
  });

  it('雾：在样张五个镜头的远近上就是样张的数；更远时跟着远近放大', () => {
    expect(song.fogFor(1150)).toEqual([3000, 30000]);
    expect(song.fogFor(5900)).toEqual([7000, 34000]);
    expect(song.fogFor(9600)).toEqual([12000, 60000]);
    expect(song.fogFor(10800)).toEqual([14000, 60000]);
    expect(song.fogFor(52000)).toEqual([40000, 140000]);
    expect(song.fogFor(104000)).toEqual([80000, 280000]);
    const [near, far] = song.fogFor(7750);
    expect(near).toBeCloseTo(9500, 6);
    expect(far).toBeCloseTo(47000, 6);
  });

  it('云气：近看是 1，看整块沙盘时是四成', () => {
    expect(song.mistFor(1150)).toBe(1);
    expect(song.mistFor(10800)).toBe(1);
    expect(song.mistFor(52000)).toBeCloseTo(0.4, 9);
    expect(song.mistFor(120000)).toBeCloseTo(0.4, 9);
  });

  it('题签的抬高：用真的那张表，镜头退远了（或者画面小了）只会更高，不会矮下去', () => {
    for (const id of ['wall', 'gate-south', 'gate-tower']) {
      let last = 0;
      for (let D = 800; D <= 130000; D *= 1.05) {
        const lift = liftOf(id, scene, song, D);
        expect(lift).toBeGreaterThanOrEqual(last);
        last = lift;
      }
    }
    // 贴近了看就是样式里写的数
    expect(liftOf('gate-tower', scene, song, 800)).toBeCloseTo(146, 1);
  });

  it('水纹：样张五个镜头的摆法', () => {
    expect(rippleFor(0, 52000)).toEqual({ dense: 0.5, turnDeg: 0 });
    expect(rippleFor(353, 9600)).toEqual({ dense: 0.5, turnDeg: 0 });
    expect(rippleFor(14, 10800)).toEqual({ dense: 0.5, turnDeg: 0 });
    expect(rippleFor(256, 1150)).toEqual({ dense: 0.3, turnDeg: 90 });
    expect(rippleFor(280, 5900)).toEqual({ dense: 0.5, turnDeg: 90 });
  });

  it('窄的水道（壕）不画水纹：半宽 40 米以下算窄，100 米以上算河；只算水道里面和岸外一格以内', () => {
    // 徐州的壕画宽 50 米，河画宽 220 到 400 米
    expect(narrowChannel(25, -10)).toBe(1);
    expect(narrowChannel(25, 20)).toBe(1);
    expect(narrowChannel(40, 0)).toBe(1);
    expect(narrowChannel(110, -50)).toBe(0);
    expect(narrowChannel(200, 0)).toBe(0);
    // 中间慢慢过去
    expect(narrowChannel(70, 0)).toBeCloseTo(0.5, 6);
    // 岸外一格（20 米）以外不算，离河很远的地方（半宽记的是 0）也不算
    expect(narrowChannel(25, 21)).toBe(0);
    expect(narrowChannel(0, -5)).toBe(0);
  });
});

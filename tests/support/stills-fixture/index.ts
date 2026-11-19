// 定格图的测试共用的一份假清单：配 tests/support/fixtureScene.ts 那座小沙盘（两个小节：起初、后来）。
// 数都是编的，但是合乎清单的规矩（src/domain/stills.ts）：两个小节，宽、窄各一张；每张的 anchors 正好是那一节的题签。
// 每次调用都给一份新的，测试里尽管改。图片文件并不存在：测试用假的取图办法（./fakeDom.ts）。

import type { StillManifest, StillShape, StillShapeSpec, StillShot } from '../../../src/domain/stills';
import type { StopTable } from '../../../src/stage/types';
import { FIXTURE_HEADINGS, fixtureScene } from '../fixtureScene';

/** 两种形状各是照什么画面拍的（和徐州的一样：宽的照 1440 × 900 的窗口，窄的照竖着拿的 768 × 1024 平板）。 */
export const FIXTURE_SHAPES: Record<StillShape, StillShapeSpec> = {
  wide: { window: [1440, 900], pane: [940, 900], insets: [62, 0, 130, 0], extra: 130, pixelRatio: 1.5 },
  narrow: { window: [768, 1024], pane: [768, 573], insets: [54, 0, 131, 0], extra: 96, pixelRatio: 2 },
};

/** 假清单里一张图的文件名。section 从 1 数起。 */
export function fixtureStillFile(section: number, shape: StillShape): string {
  return `sample-town-${section}-${shape}.jpg`;
}

/** 假清单里一张图的网址（并没有这个文件）。 */
export function fixtureStillUrl(section: number, shape: StillShape): string {
  return `/fixture-stills/${fixtureStillFile(section, shape)}`;
}

function shot(section: number, shape: StillShape, rest: Pick<StillShot, 'fit' | 'reach' | 'northDeg' | 'pxPerMetre' | 'anchors'>): StillShot {
  const spec = FIXTURE_SHAPES[shape];
  return {
    section: FIXTURE_HEADINGS[section - 1],
    shape,
    file: fixtureStillFile(section, shape),
    width: (spec.pane[0] + 2 * spec.extra) * spec.pixelRatio,
    height: spec.pane[1] * spec.pixelRatio,
    bytes: 120_000 + section * 1000,
    quality: shape === 'wide' ? 82 : 86,
    key: `00000000000000${section}${shape === 'wide' ? 'a' : 'b'}`,
    raw: `11111111111111${section}${shape === 'wide' ? 'a' : 'b'}`,
    pose: { target: [-400, 7.2, 160], position: [-400, 3864, 4756], fov: 21 },
    ...rest,
  };
}

/** 假清单和图片的网址：就是 StopTable.stills 要的那一份。 */
export function fixtureStills(): NonNullable<StopTable['stills']> {
  const manifest: StillManifest = {
    tool: 1,
    made: { tier: 'full', three: '0.187.0', background: '#ebe3d3', fitMarginPx: 12, maxFit: 2.5 },
    madeFrom: { scene: '2222222222222222', terrain: '3333333333333333', ground: '4444444444444444', program: '5555555555555555' },
    shapes: { wide: { ...FIXTURE_SHAPES.wide }, narrow: { ...FIXTURE_SHAPES.narrow } },
    stills: [
      // 起初：看整块沙盘，正北朝上
      shot(1, 'wide', {
        fit: 1,
        reach: [330, 240],
        northDeg: 0,
        pxPerMetre: 0.4,
        anchors: [
          { id: 's-town', x: 0.42, y: 0.44, visible: true, foot: [0.42, 0.47] },
          { id: 's-river', x: 0.55, y: 0.3, visible: true },
        ],
      }),
      shot(1, 'narrow', {
        fit: 1.3,
        reach: [150, 80],
        northDeg: 0,
        pxPerMetre: 0.115,
        anchors: [
          { id: 's-town', x: 0.44, y: 0.42, visible: true, foot: [0.44, 0.46] },
          { id: 's-river', x: 0.54, y: 0.31, visible: true },
        ],
      }),
      // 后来：朝北偏东 20 度看城门；远镇在沙盘外面，题签摆在边上朝外
      shot(2, 'wide', {
        fit: 0.8,
        reach: [300, 200],
        northDeg: -20,
        pxPerMetre: 1.3,
        anchors: [
          { id: 's-town', x: 0.5, y: 0.35, visible: true, foot: [0.5, 0.4] },
          { id: 's-far', x: 0.3, y: 0.7, visible: true, out: [-0.6, 0.8] },
        ],
      }),
      shot(2, 'narrow', {
        fit: 1,
        reach: [120, 70],
        northDeg: -20,
        pxPerMetre: 0.39,
        anchors: [
          { id: 's-town', x: 0.5, y: 0.36, visible: true, foot: [0.5, 0.41] },
          { id: 's-far', x: 0.34, y: 0.66, visible: true, out: [-0.6, 0.8] },
        ],
      }),
    ],
  };
  const urls: Record<string, string> = {};
  for (const still of manifest.stills) urls[still.file] = `/fixture-stills/${still.file}`;
  return { manifest, urls };
}

/** 带着这份假清单的那座小沙盘。 */
export function fixtureStillTable(): StopTable {
  return { kind: 'stop', key: 'fixture/sample-town', scene: fixtureScene(), terrainUrl: '/fixture/sample-town.terrain.bin', stills: fixtureStills() };
}

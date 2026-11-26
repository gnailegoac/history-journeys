// 题签是哪一种，是照沙盘的样式查的（src/stage/index.ts 的 labelsFor）。这里查的是样式这一路有没有接上：
//   沙盘栏（StagePane）把这座沙盘的场景文件里写的样式交给“沙盘程序从哪来”（stageEngineSource.ts 的 pickStageEngine）；
//   pickStageEngine 把它原样交给取立体的沙盘程序的那一处（loadStageEngine）；
//   每一小节的图片由谁来放（pickStillEngine）：交回的那个函数，叫它的时候把这座沙盘的样式交给取定格图的沙盘的那一处（loadStillEngine）。
// 哪一处断了，写着平着的纸条的沙盘就照竖着的纸条摆出来，页面上什么也不说——所以每一处单查。
// 取到以后怎么记到容器上、题签层怎么照它造，在 tests/stage/made-up-labels.test.ts 里。
// 在 Node 里跑，用那个很小的假 DOM；样式的名字是编的（它在不在登记表里，这里不管：查的只是交没有交到）。
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SectionInfo, StopScene } from '../../../src/domain';
import type { StillManifest } from '../../../src/domain/stills';
import type { StopTable } from '../../../src/stage/types';
import { fixtureScene } from '../../support/fixtureScene';
import { installMiniDom } from './miniDom';

const doc = installMiniDom('?stage=fake');
const win = (globalThis as any).window;

/** 交到每一处手里的样式，照先后记下来。 */
const handed = vi.hoisted(() => ({ pick: [] as unknown[][], stage: [] as unknown[][], still: [] as unknown[][] }));

// 取沙盘程序的两处：只记交来的东西，交回一个替身（真的那两处在 tests/stage/made-up-labels.test.ts 里查）
vi.mock('../../../src/stage', async (original) => {
  const actual = await original<typeof import('../../../src/stage')>();
  return {
    ...actual,
    probeWebgl: () => ({ webgl2: true, caveat: false }),
    loadStageEngine: async (...args: unknown[]) => {
      handed.stage.push(args);
      const { createFakeStageEngine } = await import('../../../src/ui/dev/fakeStage');
      return createFakeStageEngine({ fail: false, unsupported: false });
    },
    loadStillEngine: async (...args: unknown[]) => {
      handed.still.push(args);
      const { createFakeStillEngine } = await import('../../../src/ui/dev/fakeStill');
      return createFakeStillEngine({ fail: false });
    },
  };
});

// “沙盘程序从哪来”：沙盘栏交给 pickStageEngine 的东西记下来，别的照原样
vi.mock('../../../src/ui/stageEngineSource', async (original) => {
  const actual = await original<typeof import('../../../src/ui/stageEngineSource')>();
  return {
    ...actual,
    pickStageEngine: (...args: [string?]) => {
      handed.pick.push(args);
      return actual.pickStageEngine(...args);
    },
  };
});

// 沙盘旁边的字用假的（同 pane-stills.test.tsx）
vi.mock('../../../src/domain', async (original) => {
  const actual = await original<typeof import('../../../src/domain')>();
  return {
    ...actual,
    sectionHeadings: (scene: StopScene) => scene.sections.map((s) => s.heading),
    sectionInfo: (scene: StopScene, heading: string): SectionInfo => {
      const s = scene.sections.find((x) => x.heading === heading)!;
      return { section: heading, date: s.date, line: s.line, note: { short: '短', brief: '更短', lines: ['长一', '长二'] }, far: [] };
    },
    stripTexts: (scene: StopScene, heading: string, names: 'ancient' | 'modern') => {
      const s = scene.sections.find((x) => x.heading === heading)!;
      return s.strips.map((id) => {
        const strip = scene.strips.find((x) => x.id === id)!;
        const tone = strip.of === 'river' ? 'water' : strip.of === 'far-town' ? 'far' : 'place';
        return { id, text: names === 'modern' && strip.modern ? strip.modern : strip.text, tone } as const;
      });
    },
  };
});

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { StagePane } = await import('../../../src/ui/StagePane');
const { resetFakeVisit } = await import('../../../src/ui/dev/fakeStage');
// 没有套记录的那一份（沙盘栏用的是上面套了记录的）
const source = await vi.importActual<typeof import('../../../src/ui/stageEngineSource')>('../../../src/ui/stageEngineSource');

/** 编的样式的名字：只看它是不是原样交到了。 */
const STYLE = 'made-up-for-the-wire';
const table: StopTable = { kind: 'stop', key: 'f/s', scene: { ...fixtureScene(), style: STYLE }, terrainUrl: 't.bin' };
const withStills: StopTable = { ...table, stills: { manifest: {} as StillManifest, urls: {} } };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  handed.pick.length = 0;
  handed.stage.length = 0;
  handed.still.length = 0;
  vi.restoreAllMocks();
});

describe('沙盘的样式一路交到取沙盘程序的两处（题签是哪一种照它查）', () => {
  it('沙盘栏摆一座沙盘：交给 pickStageEngine 的就是这座沙盘的场景里写的样式', { timeout: 30_000 }, async () => {
    win.location.search = '?stage=fake';
    win.matchMedia = () => ({ matches: false });
    resetFakeVisit();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as any);
    await act(async () => {
      root.render(<StagePane onStopPage written table={{ state: 'ready', value: table }} section={null} route={{ state: 'ready', value: null }} onReloadTable={() => {}} />);
    });
    // 等的是结果，不是固定的一段时间
    const end = Date.now() + 10_000;
    const state = () => container.querySelector('.stage-pane')?.getAttribute('data-stage-state');
    while (state() !== 'ready' && Date.now() < end) await act(async () => void (await sleep(10)));
    expect(state()).toBe('ready');
    expect(handed.pick.length).toBeGreaterThan(0);
    for (const args of handed.pick) expect(args).toEqual([STYLE]);
    await act(async () => root.unmount());
    container.remove();
  });

  it('pickStageEngine：用真的沙盘程序的时候，样式原样交给 loadStageEngine；用替身的时候不取', async () => {
    win.location.search = '';
    await source.pickStageEngine(STYLE);
    expect(handed.stage).toEqual([[STYLE]]);
    await source.pickStageEngine(undefined);
    expect(handed.stage).toEqual([[STYLE], [undefined]]);
    win.location.search = '?stage=fake';
    await source.pickStageEngine(STYLE);
    expect(handed.stage).toHaveLength(2);
  });

  it('pickStillEngine：交回的那个函数叫了才取，取的时候把这座沙盘的样式交给 loadStillEngine', async () => {
    win.location.search = '';
    const pick = source.pickStillEngine(withStills);
    if (!pick) throw new Error('这座沙盘带着图片，该有人放');
    expect(handed.still).toEqual([]);
    await pick();
    expect(handed.still).toEqual([[STYLE]]);
    // 没有写样式的场景：交过去的是 undefined（照登记表查是竖着的纸条）
    const { style: _style, ...plain } = withStills.scene;
    const bare = source.pickStillEngine({ ...withStills, scene: plain as StopTable['scene'] });
    await bare?.();
    expect(handed.still).toEqual([[STYLE], [undefined]]);
  });
});

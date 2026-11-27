// 题签是另一种（平着的纸条）的沙盘，只放图片的时候（地址里写了 ?tier=still，或者设备带不动立体的沙盘），沙盘栏的三种样子：
//   图片先放：题签那一小块程序还在路上，图片已经在了，说的是平常那一句“这里放的是沙盘的图片，不能转动。”，按钮是“试试立体的沙盘”；
//   题签后到：到了，栏上什么也不用换（题签是定格图那一座自己摆上去的，见 tests/unit/still-fit.test.ts 里“题签晚到”的几条）；
//   没取到：图片留着，栏上写 failed，说“沙盘没能摆出来，这里先放图片。”，按钮是“再试一次”——点了，图片那一层重挂一遍，那一小块重新去取；
//           取到了回到平常的那一句；从头到尾不说“太慢”的那一句。图片也没取到的时候是“沙盘没能摆出来，正文可以照常读。”带“再试一次”。
//   另外两处：收掉了的那一层后到的结果不算（连点两次“再试一次”）；立体的沙盘正在摆、摆好了的时候，那一小块没取到不写 failed（倒数第二条）。
// content/ 里没有写这一种题签的沙盘：这里用的是带着图片的一座假沙盘，样式的名字是编的；取定格图的沙盘的那一处（src/stage/index.ts 的 loadStillEngine）
// 换成一个记着被叫了几次的替身——交出来的是定格图的替身，摆出来的那一座带着一个由测试说了算的 named（真的那一处怎么交、真的定格图怎么摆，
// 在 tests/stage/made-up-labels.test.ts 和 tests/unit/still-fit.test.ts 里）。竖着的纸条的沙盘（摆出来的那一座没有 named）走的还是原来的路：最后一条。
// 在 Node 里跑，用那个很小的假 DOM。
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SectionInfo, StopScene } from '../../../src/domain';
import type { StillManifest } from '../../../src/domain/stills';
import type { StageEngine, StopTable } from '../../../src/stage/types';
import { STAGE_TEXT } from '../../../src/ui/text';
import { fixtureScene } from '../../support/fixtureScene';
import { installMiniDom, MiniElement } from './miniDom';

const doc = installMiniDom('?tier=still');
const win = (globalThis as any).window;

/**
 * 取定格图的沙盘的那一处的替身：每叫一次记一笔（交来的样式）。slip 是真的时候，摆出来的那一座带着 named——
 * 是 outcomes 里排着的下一个（测试先排好：一个还没有结果的 Promise，或者已经拒绝的）；slip 是假的时候没有 named（竖着的纸条的沙盘）。
 * failPictures 是真的时候图片也取不到。
 * table 不是 null 的时候（倒数第二条）：这个“浏览器”画得了立体的沙盘，取沙盘程序的那一处（loadStageEngine）等 table.gate 放行以后交出沙盘的替身，
 * 叫了几次记在 table.asked 里——立体的沙盘“正在摆”多久由测试说了算。
 */
const still = vi.hoisted(() => ({
  asked: [] as unknown[],
  outcomes: [] as Promise<void>[],
  slip: true,
  failPictures: false,
  table: null as { gate: Promise<void>; asked: number } | null,
}));

vi.mock('../../../src/stage', async (original) => {
  const actual = await original<typeof import('../../../src/stage')>();
  return {
    ...actual,
    probeWebgl: () => (still.table ? { webgl2: true, caveat: false } : actual.probeWebgl()),
    loadStageEngine: async (style?: string): Promise<StageEngine> => {
      const table = still.table;
      if (!table) return actual.loadStageEngine(style);
      table.asked += 1;
      await table.gate;
      const { createFakeStageEngine } = await import('../../../src/ui/dev/fakeStage');
      return createFakeStageEngine();
    },
    loadStillEngine: async (style?: string): Promise<StageEngine> => {
      still.asked.push(style);
      const { createFakeStillEngine } = await import('../../../src/ui/dev/fakeStill');
      const fake = createFakeStillEngine({ fail: still.failPictures });
      if (!still.slip) return fake;
      const named = still.outcomes.shift();
      if (!named) throw new Error('测试没有排好这一回题签的结果');
      return { ...fake, create: (container, table, options) => Object.assign(fake.create(container, table, options), { named }) };
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

/** 编的样式的名字（它是不是平着的纸条由上面的替身说了算：这里查的是沙盘栏怎么接）。 */
const STYLE = 'made-up-slips';
const table: StopTable = { kind: 'stop', key: 'f/slip', scene: { ...fixtureScene(), style: STYLE }, terrainUrl: 't.bin', stills: { manifest: {} as StillManifest, urls: {} } };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = (ms = 30) => act(async () => void (await sleep(ms)));
const attr = (el: MiniElement | null, name: string) => el?.getAttribute(name) ?? null;
async function waitFor(ok: () => boolean, ms = 10_000) {
  const until = Date.now() + ms;
  while (!ok() && Date.now() < until) await settle(10);
  if (!ok()) throw new Error('等不到');
}

/** 一个还没有结果的“题签到了”。 */
function pending(): { named: Promise<void>; arrive: () => void; lose: () => void } {
  let arrive = (): void => {};
  let lose = (): void => {};
  const named = new Promise<void>((resolve, reject) => {
    arrive = resolve;
    lose = () => reject(new Error('那一小块程序没有取到'));
  });
  named.catch(() => {});
  return { named, arrive, lose };
}

async function mount(search = '?tier=still') {
  win.location.search = search;
  win.matchMedia = () => ({ matches: false });
  const container = doc.createElement('div');
  doc.body.appendChild(container);
  const root = createRoot(container as any);
  await act(async () => {
    root.render(<StagePane onStopPage written table={{ state: 'ready', value: table }} section={null} route={{ state: 'ready', value: null }} onReloadTable={() => {}} />);
  });
  const pane = () => container.querySelector('.stage-pane');
  return {
    state: () => attr(pane(), 'data-stage-state'),
    picture: () => attr(pane(), 'data-stage-picture'),
    notice: () => container.querySelector('.stage-notice p')?.textContent ?? null,
    message: () => container.querySelector('.stage-message p')?.textContent ?? null,
    button: () => container.querySelector('.stage-retry'),
    /** 栏里印着的每一句话（按钮下面的一行、单独的一句、正在摆的那一句）。 */
    said: () => container.querySelectorAll('.stage-says p').map((p) => p.textContent),
    shown: () => attr(container.querySelector('.fake-still'), 'data-fake-still-shown'),
    stills: () => container.querySelectorAll('.fake-still').length,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

const TOO_SLOW = [STAGE_TEXT.slow, STAGE_TEXT.stillSlow];

afterEach(() => {
  still.asked.length = 0;
  still.outcomes.length = 0;
  still.slip = true;
  still.failPictures = false;
  still.table = null;
  vi.restoreAllMocks();
});

describe('平着的纸条的沙盘，只放图片的时候：图片先放，题签后到；没取到说“没能摆出来”、给“再试一次”', () => {
  it('图片先放：题签那一小块还在路上，图片已经在了；说的是平常的那一句，按钮是“试试立体的沙盘”。题签到了：栏上什么也不换', { timeout: 30_000 }, async () => {
    const first = pending();
    still.outcomes.push(first.named);
    const page = await mount();
    await waitFor(() => page.picture() === 'still');
    // 取了一次，交过去的是这座沙盘的样式；那一小块还没有结果
    expect(still.asked).toEqual([STYLE]);
    expect(page.shown()).toBe('true');
    expect(page.state()).toBe('slow');
    expect(page.notice()).toBe(STAGE_TEXT.stillOnly);
    expect(page.button()?.textContent).toBe(STAGE_TEXT.tryTable);
    // 到了：还是这一张图片、这一句话、这个按钮；没有再取一次
    await act(async () => first.arrive());
    await settle();
    expect(page.state()).toBe('slow');
    expect(page.picture()).toBe('still');
    expect(page.notice()).toBe(STAGE_TEXT.stillOnly);
    expect(page.button()?.textContent).toBe(STAGE_TEXT.tryTable);
    expect(still.asked).toHaveLength(1);
    await page.unmount();
  });

  it('那一小块没取到：图片留着，栏上写 failed，说“沙盘没能摆出来，这里先放图片。”，按钮是“再试一次”；不说“太慢”。点“再试一次”：重新取；取到了回到平常的那一句', { timeout: 30_000 }, async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = pending();
    const second = pending();
    still.outcomes.push(first.named, second.named);
    const page = await mount();
    await waitFor(() => page.picture() === 'still');
    expect(page.state()).toBe('slow');
    // 没取到
    await act(async () => first.lose());
    await waitFor(() => page.state() === 'failed');
    expect(page.picture()).toBe('still');
    expect(page.shown()).toBe('true');
    expect(page.notice()).toBe(STAGE_TEXT.stillFailed);
    expect(page.notice()).toBe('沙盘没能摆出来，这里先放图片。');
    expect(page.button()?.textContent).toBe(STAGE_TEXT.retry);
    expect(page.button()?.textContent).toBe('再试一次');
    for (const line of TOO_SLOW) expect(page.said()).not.toContain(line);
    expect(page.said()).not.toContain(STAGE_TEXT.stillOnly);
    expect(still.asked).toHaveLength(1);
    // 再试一次：图片那一层重挂一遍，那一小块重新取（第二回）；它还在路上的时候图片又放上了
    await act(async () => page.button()?.click());
    await waitFor(() => still.asked.length === 2 && page.picture() === 'still');
    expect(still.asked).toEqual([STYLE, STYLE]);
    expect(page.stills()).toBe(1);
    // 结果出来以前：还是“没能摆出来”的那一句、“再试一次”的那个按钮（不先换成平常的那一句）
    expect(page.state()).toBe('failed');
    expect(page.notice()).toBe(STAGE_TEXT.stillFailed);
    expect(page.button()?.textContent).toBe(STAGE_TEXT.retry);
    // 取到了：回到平常的那一句，按钮换回“试试立体的沙盘”
    await act(async () => second.arrive());
    await waitFor(() => page.state() === 'slow');
    expect(page.notice()).toBe(STAGE_TEXT.stillOnly);
    expect(page.button()?.textContent).toBe(STAGE_TEXT.tryTable);
    for (const line of TOO_SLOW) expect(page.said()).not.toContain(line);
    await page.unmount();
  });

  it('再试一次还是没取到：还是那一句、那个按钮，可以接着试；每点一次取一次', { timeout: 30_000 }, async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tries = [pending(), pending(), pending()];
    still.outcomes.push(...tries.map((one) => one.named));
    const page = await mount();
    await waitFor(() => page.picture() === 'still');
    await act(async () => tries[0].lose());
    await waitFor(() => page.state() === 'failed');
    // 每一步都看着栏上说的话：从头一回没取到起，到最后取到以前，一次也没有换成平常的那一句
    const seen: (string | null)[] = [];
    const watch = async (ok: () => boolean): Promise<void> => {
      const until = Date.now() + 10_000;
      while (Date.now() < until) {
        seen.push(page.notice());
        if (ok()) return;
        await settle(5);
      }
      throw new Error('等不到');
    };
    await act(async () => page.button()?.click());
    await watch(() => still.asked.length === 2);
    await act(async () => tries[1].lose());
    await watch(() => page.state() === 'failed' && page.picture() === 'still');
    expect(seen.filter((line) => line !== null && line !== STAGE_TEXT.stillFailed)).toEqual([]);
    expect(page.notice()).toBe(STAGE_TEXT.stillFailed);
    expect(page.button()?.textContent).toBe(STAGE_TEXT.retry);
    await act(async () => page.button()?.click());
    await waitFor(() => still.asked.length === 3);
    await act(async () => tries[2].arrive());
    await waitFor(() => page.state() === 'slow');
    expect(page.notice()).toBe(STAGE_TEXT.stillOnly);
    await page.unmount();
  });

  it('那一小块没取到，图片也没取到：一句“沙盘没能摆出来，正文可以照常读。”带“再试一次”，不是“太慢”的那一句；点了重新取，都取到了就放图片', { timeout: 30_000 }, async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = pending();
    const second = pending();
    still.outcomes.push(first.named, second.named);
    still.failPictures = true;
    const page = await mount();
    // 图片先没取到（这时候那一小块还没有结果）：先是没有图片时的样子
    await waitFor(() => page.message() !== null);
    await act(async () => first.lose());
    await waitFor(() => page.state() === 'failed');
    expect(page.picture()).toBe('none');
    expect(page.message()).toBe(STAGE_TEXT.failed);
    expect(page.message()).toBe('沙盘没能摆出来，正文可以照常读。');
    expect(page.button()?.textContent).toBe(STAGE_TEXT.retry);
    for (const line of TOO_SLOW) expect(page.said()).not.toContain(line);
    // 再试一次：这一回图片和那一小块都取到了
    still.failPictures = false;
    await act(async () => page.button()?.click());
    await waitFor(() => still.asked.length === 2 && page.picture() === 'still');
    await act(async () => second.arrive());
    await waitFor(() => page.state() === 'slow');
    expect(page.notice()).toBe(STAGE_TEXT.stillOnly);
    await page.unmount();
  });

  it('连点两次“再试一次”，前一回的结果后到：不算——后一回取到了，栏上就是平常的那一句；前一回这时候才说没取到，也不换回“没能摆出来”', { timeout: 30_000 }, async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tries = [pending(), pending(), pending()];
    still.outcomes.push(...tries.map((one) => one.named));
    const page = await mount();
    await waitFor(() => page.picture() === 'still');
    await act(async () => tries[0].lose());
    await waitFor(() => page.state() === 'failed');
    // 点一次：第二回去取，还没有结果；栏上还是“再试一次”，再点一次：第三回去取（第二回的那一层已经收掉了，它的结果还没有出来）
    await act(async () => page.button()?.click());
    await waitFor(() => still.asked.length === 2 && page.picture() === 'still');
    expect(page.button()?.textContent).toBe(STAGE_TEXT.retry);
    await act(async () => page.button()?.click());
    await waitFor(() => still.asked.length === 3 && page.picture() === 'still');
    expect(page.state()).toBe('failed');
    // 第三回（现在挂着的那一层）取到了：回到平常的那一句
    await act(async () => tries[2].arrive());
    await waitFor(() => page.state() === 'slow');
    expect(page.notice()).toBe(STAGE_TEXT.stillOnly);
    expect(page.button()?.textContent).toBe(STAGE_TEXT.tryTable);
    // 第二回这时候才说没取到：那一层早就收掉了，它的结果不算——一直看着，栏上没有换回去
    await act(async () => tries[1].lose());
    for (let i = 0; i < 12; i++) {
      await settle(10);
      expect(page.state()).toBe('slow');
      expect(page.notice()).toBe(STAGE_TEXT.stillOnly);
      expect(page.button()?.textContent).toBe(STAGE_TEXT.tryTable);
    }
    expect(page.picture()).toBe('still');
    expect(still.asked).toHaveLength(3);
    await page.unmount();
  });

  it('立体的沙盘正在摆、摆好了的时候，图片上的题签那一小块没取到：栏上不写 failed，不说“没能摆出来”，没有“再试一次”（写 failed 要立体的沙盘也摆不了了才算）', { timeout: 30_000 }, async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let open = (): void => {};
    still.table = { gate: new Promise<void>((resolve) => (open = resolve)), asked: 0 };
    const first = pending();
    still.outcomes.push(first.named);
    const FAILED = [STAGE_TEXT.failed, STAGE_TEXT.stillFailed];
    // 地址里指定完整的一档：立体的沙盘要摆，图片那一层先挂上
    const page = await mount('?tier=full');
    await waitFor(() => page.picture() === 'still' && still.table?.asked === 1);
    expect(page.state()).toBe('loading');
    // 沙盘程序还在路上（正在摆），那一小块没取到：一直看着，栏上还是“正在摆”，图片留着，没有那两句、没有“再试一次”
    await act(async () => first.lose());
    for (let i = 0; i < 12; i++) {
      await settle(10);
      expect(page.state()).toBe('loading');
      expect(page.picture()).toBe('still');
      for (const line of [...FAILED, ...TOO_SLOW]) expect(page.said()).not.toContain(line);
      expect(page.button()).toBeNull();
    }
    // 沙盘程序到了，立体的沙盘摆好了：栏上是 ready，画面是它的；还是没有那两句、没有“再试一次”
    await act(async () => open());
    await waitFor(() => page.state() === 'ready' && page.picture() === 'table');
    for (let i = 0; i < 6; i++) {
      await settle(10);
      expect(page.state()).toBe('ready');
      for (const line of [...FAILED, ...TOO_SLOW]) expect(page.said()).not.toContain(line);
      expect(page.button()).toBeNull();
    }
    // 图片那一层只取过一次，沙盘程序只要过一次
    expect(still.asked).toEqual([STYLE]);
    expect(still.table.asked).toBe(1);
    await page.unmount();
  });

  it('竖着的纸条的沙盘（摆出来的那一座没有 named）：和原来一样——图片在了，平常的那一句，“试试立体的沙盘”；只取一次', { timeout: 30_000 }, async () => {
    still.slip = false;
    const page = await mount();
    await waitFor(() => page.picture() === 'still');
    await settle(60);
    expect(page.state()).toBe('slow');
    expect(page.notice()).toBe(STAGE_TEXT.stillOnly);
    expect(page.button()?.textContent).toBe(STAGE_TEXT.tryTable);
    expect(still.asked).toEqual([STYLE]);
    await page.unmount();
  });
});

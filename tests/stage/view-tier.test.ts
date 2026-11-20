// 一座站点沙盘（src/stage/three/view.ts）照哪一档画质摆、画质的数从哪里读、快慢怎么量、太慢了怎么告诉页面。在 Node 里跑，不要浏览器。
// 真的：场景文件、地形文件、地面、水、云气、座子、镜头、换小节的先后，还有“这一次访问里画质最高到哪一档”的记性
// （tier.ts；它自己怎么评、怎么降，在 tests/stage/tier.test.ts 里查，这里查的是沙盘和它接得对不对）。
// 假的：渲染器、画布、零件库、题签层、上色、地形板、页面，还有钟。
//
// 钟：定的时、约的帧走的是 vi 的假钟，一帧隔 16 毫秒。沙盘量快慢看的钟是交给它的（createStopView 的最后一样）：
// 假钟再加上一笔“画和等用掉的时间”——假的渲染器每画一帧、假的“等显卡画完”每等一次，就往这一笔上加测试说的毫秒数。
// 所以“这台设备画一帧要 30 毫秒”是测试定的数，不看跑测试的机器快慢，也不用真的等。
//
// 查这几件：
//   指定了画质就照指定的摆；没指定，用记性里的上限；上限已经是“只放图片”又没有指定的，不摆，告诉页面“太慢”；
//   画质的数都从借到手的那一份画布读：造渲染器时开不开抗锯齿、零件库拿到的画质、云气画几层、影子贴图多大、像素比；
//   像素比是“屏幕的像素比、这一档的上限、画布的像素总数”三样里最小的那个；
//   readout().perf：哪一档、像素比、画布实际多少像素、一共画了几帧、试画和滑动各用了多久；
//   试画：第一个画面之后，先等它画完（不算），同一个画面再画三帧、每帧都等显卡画完，取居中的一次；一座沙盘只试一次；
//     沙盘栏收着、页面在后台时先不试，等到下一次摆好的画面够格了再试；
//   滑动：每一趟从头滑到尾的都量（换小节的、回到这一节的），报的是相邻两帧间隔的居中数；被打断的、页面去过后台的不报；
//   太慢了（记性答“降”）：通知页面一次；从此一帧不画，指令照常了结；摆好之前通知的，ready 就这么开着，关掉时才了结；
//     这以后画面丢了、画布被借走了，都不再另外通知；再摆的一座低一档；
//   指定了画质的：照样量、照样报，从不通知，也不停；
//   读者自己要的（asked）：只有慢得没法用才通知。

import { Group, Mesh } from 'three';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StripLayer } from '../../src/stage/overlay/types';
import type { GroundPaintJob } from '../../src/stage/three/groundPaint';
import { createHost } from '../../src/stage/three/host';
import type { KitContext, ModelSet } from '../../src/stage/three/internal';
import { MIST_TRIANGLES_PER_LAYER } from '../../src/stage/three/mist';
import { FULL_QUALITY, REDUCED_QUALITY } from '../../src/stage/three/quality';
import type { TerrainMesh } from '../../src/stage/three/terrainMesh';
import { GLIDE_SLOW_MS, GLIDE_STALLED_MS, TRIAL_FRAMES, TRIAL_HOPELESS_MS, TRIAL_MIN_AREA, TRIAL_MIN_HEIGHT, TRIAL_SLOW_MS, bigEnoughToTry } from '../../src/stage/three/tier';
import type { BrowserHost, ViewEnv } from '../../src/stage/three/view';
import type { StageOptions, StopStageView, StopTable } from '../../src/stage/types';
import { fakeCanvas, fakeDocument, fakeFetch, fakeHostParts, fakeKit, fakeRenderer, fakeStrips, trianglesUnder } from './support/fakeRenderer';
import { realSceneFile } from './support/realScenes';

const KEY = 'su-shi/xuzhou';

let kit = fakeKit(() => new Group());
let strips = fakeStrips();

vi.mock('../../src/stage/overlay', () => ({ mountStrips: (): StripLayer => strips.mount() }));
vi.mock('../../src/stage/three/kit', () => ({ buildModels: (ctx: KitContext): ModelSet => kit.buildModels(ctx) }));
vi.mock('../../src/stage/three/groundPaint', async (original) => ({
  ...(await original<typeof import('../../src/stage/three/groundPaint')>()),
  // 假的：一张 1 × 1 的空图（法线图还是照地面网格的大小）
  beginGroundPaint: (): GroundPaintJob => ({
    finish: (_scene, ground) => Promise.resolve({ kind: 'live', colour: new Uint8Array(4), w: 1, h: 1, normals: new Uint8Array(ground.nx * ground.nz * 4) }),
  }),
}));
vi.mock('../../src/stage/three/terrainMesh', async (original) => ({
  ...(await original<typeof import('../../src/stage/three/terrainMesh')>()),
  buildTerrainMesh: (): TerrainMesh => ({ group: new Group(), top: new Mesh(), sides: new Mesh(), dispose() {} }),
}));
// 环境贴图要真的三维画面才烤得出来，这里换成一张空的。
// （fakeThree 在这里面现取，不用文件开头引入的：vi.mock 会被挪到所有引入的前面，这里一运行，开头的引入可能还没到。）
vi.mock('three', async (original) => {
  const { fakeThree } = await import('./support/fakeRenderer');
  return fakeThree(await original<typeof import('three')>());
});

/** 约的帧在假钟上隔多久来一次（毫秒）。 */
const FRAME_MS = 16;
/** 让钟走 ms 毫秒（到点的帧和定时都做完）。 */
const wait = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};
/** 让钟一帧一帧往前走，走到 promise 有了结果（完成或者拒绝）。已经有结果的不走。 */
async function until<T>(promise: Promise<T>): Promise<T> {
  let settled = false;
  const mark = (): void => {
    settled = true;
  };
  promise.then(mark, mark);
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 20_000 && !settled; i++) await vi.advanceTimersByTimeAsync(FRAME_MS);
  if (!settled) throw new Error('钟走了五分多钟，等的那件事还没有结果');
  return promise;
}
/** 让钟一帧一帧往前走，走到 happened() 说“有了”。最多走一分多钟。 */
async function untilTrue(happened: () => boolean, what: string): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  for (let i = 0; i < 5_000 && !happened(); i++) await vi.advanceTimersByTimeAsync(FRAME_MS);
  if (!happened()) throw new Error(`钟走了一分多钟，还没有等到：${what}`);
}
const mouse = (x: number, y: number, id = 1): Record<string, unknown> => ({ pointerId: id, pointerType: 'mouse', button: 0, clientX: x, clientY: y, pageX: x, pageY: y });
const wheel = (deltaY: number): Record<string, unknown> => ({ deltaY, deltaMode: 0, clientX: 400, clientY: 400, ctrlKey: false });

const opened: StopStageView[] = [];
const { scene } = realSceneFile(KEY);
const headings = scene.sections.map((section) => section.heading);

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  vi.stubGlobal('document', fakeDocument());
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, FRAME_MS));
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  vi.stubGlobal('fetch', fakeFetch(realSceneFile(KEY).terrainPath));
});

beforeEach(() => {
  kit = fakeKit(() => new Group());
  strips = fakeStrips();
  vi.stubGlobal('window', { devicePixelRatio: 1 });
});

afterEach(() => {
  for (const view of opened.splice(0)) view.destroy();
});

afterAll(async () => {
  // 等后台备模型的那一小会儿过去，再把假的页面拿走
  await wait(300);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/**
 * 一台假的“设备”：一块假的画布、一个假的渲染器、一个画布主人（记性是真的，一个主人一份）和一个 width × height 的容器。
 * cost 是这台设备的快慢，测试里随时可以改：画一帧用多久，等显卡把一帧画完用多久；
 *   waits 是一串只用一次的“这一次等多久”，用完了才轮到 finishMs。
 * page.visible 是页面在不在前台。did 是渲染器被叫去“画”、显卡被“等”的先后；
 * asked 是沙盘“问页面在不在前台”和渲染器“画”的先后（量滑动时，每一帧要先问、先看钟，再画）。
 */
function stage(width: number, height: number) {
  const fake = fakeRenderer();
  const { canvas, el, doc } = fakeCanvas(width, height);
  const cost = { renderMs: 0, finishMs: 0, waits: [] as number[] };
  const page = { visible: true };
  const did: ('画' | '等')[] = [];
  const asked: ('问' | '画')[] = [];
  /** 画和等用掉的时间，累计（毫秒）。 */
  let busyMs = 0;
  fake.afterEveryRender(() => {
    did.push('画');
    asked.push('画');
    busyMs += cost.renderMs;
  });
  const hostParts = fakeHostParts(canvas, fake.renderer, () => {
    did.push('等');
    busyMs += cost.waits.shift() ?? cost.finishMs;
  });
  const host: BrowserHost = createHost(hostParts.parts);
  const env: ViewEnv = {
    now: () => performance.now() + busyMs,
    pageVisible: () => {
      asked.push('问');
      return page.visible;
    },
  };
  const paneSize = { clientWidth: width, clientHeight: height };
  return { fake, frames: fake.frames, el, doc, host, hostParts, cost, page, did, asked, env, paneSize, pane: paneSize as HTMLElement };
}
type Stage = ReturnType<typeof stage>;

async function openView(s: Stage, options: Partial<StageOptions> = {}): Promise<StopStageView> {
  const { createStopView } = await import('../../src/stage/three/view');
  const table: StopTable = { kind: 'stop', key: KEY, scene, terrainUrl: 'terrain.bin' };
  const view = createStopView(s.pane, table, { namesMode: 'ancient', reducedMotion: true, ...options }, s.host, s.env);
  opened.push(view);
  return view;
}

/** 页面会订的那几样：ready 现在怎么样了，“太慢”“画面丢了”“读者动了镜头”各通知了几次。 */
function watch(view: StopStageView) {
  const seen = { ready: 'open' as 'open' | 'done' | 'failed', slow: 0, lost: 0, moved: 0 };
  view.ready.then(
    () => {
      seen.ready = 'done';
    },
    () => {
      seen.ready = 'failed';
    },
  );
  view.onSlow(() => {
    seen.slow += 1;
  });
  view.onLost(() => {
    seen.lost += 1;
  });
  view.onUserMoved(() => {
    seen.moved += 1;
  });
  return seen;
}

/** 最近一帧里云气画了几层（场景里依次是：地形板、水、云气、小模型、座子）。 */
function mistLayers(s: Stage): number {
  const world = s.fake.lastWorld();
  if (!world) throw new Error('一帧也没有画');
  return trianglesUnder(world.children[2]) / MIST_TRIANGLES_PER_LAYER;
}

describe('照哪一档摆，画质的数从哪里读', () => {
  it('指定减配：画布照减配借（不开抗锯齿），零件库拿到的是减配的画质，云气只画一层，影子贴图小一半，像素比最多一倍半', { timeout: 60_000 }, async () => {
    vi.stubGlobal('window', { devicePixelRatio: 3 });
    const s = stage(880, 900);
    const view = await openView(s, { tier: 'reduced' });
    await until(view.ready);
    expect(s.hostParts.qualities).toEqual([REDUCED_QUALITY]);
    expect(s.hostParts.qualities[0].antialias).toBe(false);
    expect(kit.contexts).toHaveLength(1);
    expect(kit.contexts[0].quality).toBe(REDUCED_QUALITY);
    expect(mistLayers(s)).toBe(1);
    const frame = s.frames[s.frames.length - 1];
    expect(frame.shadowMapSize).toBe(1024);
    // 影子沿法线的偏移是“影子贴图上的一个点在地面上有多大”的倍数：贴图小了一半，一个点就大一倍
    expect(frame.shadowNormalBias).toBeCloseTo(((2 * frame.shadowHalf) / 1024) * 1.6, 9);
    // 屏幕是三倍的：减配最多用到一倍半
    expect(s.fake.pixelRatios[s.fake.pixelRatios.length - 1]).toBe(1.5);
    // 试画过了（这台假设备画和等都不花时间，量出来是 0）；没有滑过
    expect(view.readout().perf).toEqual({ tier: 'reduced', pixelRatio: 1.5, buffer: { width: 1320, height: 1350 }, frames: s.frames.length, trialMs: 0, glideMs: null });
  });

  it('指定完整的一档：开抗锯齿，零件库拿到的是完整的画质，云气三层，影子贴图 2048，像素比最多两倍', { timeout: 60_000 }, async () => {
    vi.stubGlobal('window', { devicePixelRatio: 3 });
    const s = stage(880, 900);
    // 记性里的上限已经降到减配（浏览器说只能用软件画）：指定了的不管它
    s.host.tiers.noteCaveat();
    const view = await openView(s, { tier: 'full' });
    await until(view.ready);
    expect(s.hostParts.qualities).toEqual([FULL_QUALITY]);
    expect(kit.contexts[0].quality).toBe(FULL_QUALITY);
    expect(mistLayers(s)).toBe(3);
    expect(s.frames[s.frames.length - 1].shadowMapSize).toBe(2048);
    expect(s.fake.pixelRatios[s.fake.pixelRatios.length - 1]).toBe(2);
    expect(view.readout().perf).toMatchObject({ tier: 'full', pixelRatio: 2, buffer: { width: 1760, height: 1800 } });
  });

  it('没有指定：用这一次访问到现在还撑得住的最高一档；上限降了以后再摆的一座就低一档', { timeout: 60_000 }, async () => {
    const s = stage(880, 900);
    const first = await openView(s);
    await until(first.ready);
    expect(first.readout().perf?.tier).toBe('full');
    expect(kit.contexts[0].quality).toBe(FULL_QUALITY);
    first.destroy();

    // 上限降到了减配（比如浏览器说只能用软件画，或者量出来慢）
    s.host.tiers.noteCaveat();
    const second = await openView(s);
    await until(second.ready);
    expect(second.readout().perf?.tier).toBe('reduced');
    expect(kit.contexts[1].quality).toBe(REDUCED_QUALITY);
    expect(mistLayers(s)).toBe(1);
    // 两座沙盘各借各的：第二次是照减配借的
    expect(s.hostParts.qualities[s.hostParts.qualities.length - 1]).toBe(REDUCED_QUALITY);
  });

  it('已经量出来连减配也带不动、又没有指定画质：不摆，一帧也不画，告诉页面“太慢”（不算摆坏了）；读者自己要的照样摆', { timeout: 60_000 }, async () => {
    const s = stage(880, 900);
    // 这一次访问里前面有一座试画慢得没法用：上限到了“只放图片”
    expect(s.host.tiers.reportTrial('full', TRIAL_HOPELESS_MS + 1, 'auto')).toBe('down');
    expect(s.host.tiers.ceiling()).toBe('still');
    const view = await openView(s);
    const seen = watch(view);
    await untilTrue(() => seen.slow > 0, '页面收到“太慢”');
    await wait(2000);
    // 只通知一次；ready 不完成也不拒绝，等页面来关
    expect(seen).toEqual({ ready: 'open', slow: 1, lost: 0, moved: 0 });
    expect(s.frames).toHaveLength(0);
    expect(s.hostParts.canvasesMade()).toBe(0);
    expect(view.readout()).toStrictEqual({ triangles: 0, drawCalls: 0 });
    // 之后的指令照常了结
    await until(view.showSection(headings[1]));
    await until(view.resetView());
    expect(s.frames).toHaveLength(0);
    // 页面把它关掉：ready 这才了结，不算失败
    view.destroy();
    await wait(0);
    expect(seen.ready).toBe('done');

    // 读者自己点了“试试立体的沙盘”，页面指定减配来摆：照样摆出来
    const asked = await openView(s, { tier: 'reduced', asked: true });
    const askedSeen = watch(asked);
    await until(asked.ready);
    expect(asked.readout().perf?.tier).toBe('reduced');
    expect(askedSeen.slow).toBe(0);
  });

  it('像素比：屏幕的像素比、这一档的上限、画布的像素总数，三样里最小的那个；perf 里的画布大小往下取整；水面每一帧都拿到同一个数', { timeout: 60_000 }, async () => {
    // 1920 × 1080 的大栏、两倍的屏幕：完整的一档最多画四百万个像素，像素比降到 1.39
    vi.stubGlobal('window', { devicePixelRatio: 2 });
    const s = stage(1920, 1080);
    const view = await openView(s);
    await until(view.ready);
    // 水面的着色器拿到的像素比（水纹照页面上的像素算，见 src/stage/three/water.ts 的 setPixelRatio）：主水面和大水时的那一片，两片都有
    const waterRatios = (): number[] => {
      const found: number[] = [];
      s.fake.lastWorld()?.traverse((object) => {
        const material = (object as unknown as { material?: { onBeforeCompile?: (shader: unknown, renderer: unknown) => void } }).material;
        if (!material?.onBeforeCompile) return;
        const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '', fragmentShader: '' };
        material.onBeforeCompile(shader, null);
        if (shader.uniforms.uPx) found.push(shader.uniforms.uPx.value as number);
      });
      return found;
    };
    expect(waterRatios()).toEqual([1.39, 1.39]);
    expect(s.fake.pixelRatios[s.fake.pixelRatios.length - 1]).toBe(1.39);
    expect(view.readout().perf).toMatchObject({ tier: 'full', pixelRatio: 1.39, buffer: { width: Math.floor(1920 * 1.39), height: Math.floor(1080 * 1.39) } });

    // 栏变小了（竖着拿的平板上面那一块）：像素总数不再是限制，用屏幕自己的两倍
    let before = s.frames.length;
    s.paneSize.clientWidth = 768;
    s.paneSize.clientHeight = 573;
    view.resize();
    await wait(30);
    expect(s.frames.length - before).toBe(1);
    expect(s.fake.pixelRatios[s.fake.pixelRatios.length - 1]).toBe(2);
    expect(view.readout().perf).toMatchObject({ pixelRatio: 2, buffer: { width: 1536, height: 1146 } });
    expect(waterRatios()).toEqual([2, 2]);

    // 屏幕换成一倍的（窗口挪到另一块屏幕上）：大小没变也重画一次
    before = s.frames.length;
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    view.resize();
    await wait(30);
    expect(s.frames.length - before).toBe(1);
    expect(view.readout().perf).toMatchObject({ pixelRatio: 1, buffer: { width: 768, height: 573 } });
    expect(waterRatios()).toEqual([1, 1]);
  });

  it('perf.frames：造好以后一共画了几帧（试画的三帧也算）；读者不动、不换小节的时候一帧也不画', { timeout: 60_000 }, async () => {
    const s = stage(880, 900);
    const view = await openView(s);
    await until(view.ready);
    const frames = (): number | undefined => view.readout().perf?.frames;
    // 摆出来画了五帧：头一帧，试画三帧，最后补的一帧。最后一帧不带影子，读数不用为它再画
    expect(frames()).toBe(5);
    expect(s.frames).toHaveLength(5);
    await wait(400);
    expect(frames()).toBe(5);
    // 换一节（不滑）：一帧，这一帧顺带画了影子；readout() 为了给不带影子的读数会再画一帧，这一帧也算在里面
    await until(view.showSection(headings[2]));
    expect(s.frames).toHaveLength(6);
    expect(frames()).toBe(7);
    expect(s.frames).toHaveLength(7);
    // 再读不再画
    await wait(400);
    expect(frames()).toBe(7);
    expect(s.frames).toHaveLength(7);
  });
});

describe('试画', () => {
  it('第一个画面之后先等它画完（不算），同一个画面再画三帧、每帧等显卡画完，取居中的一次报给记性；一座沙盘只试一次', { timeout: 60_000 }, async () => {
    const s = stage(880, 900);
    const reported = vi.spyOn(s.host.tiers, 'reportTrial');
    // 画一帧 4 毫秒。头一次等（第一个画面：编译着色器、上传贴图、画影子）要 500 毫秒，后面三次各等 10、300、20 毫秒
    s.cost.renderMs = 4;
    s.cost.waits = [500, 10, 300, 20];
    const view = await openView(s);
    const seen = watch(view);
    await until(view.ready);

    // 先后：画第一个画面，等它画完；然后三遍“画一帧、等画完”；最后补的一帧
    expect(TRIAL_FRAMES).toBe(3);
    expect(s.did).toEqual(['画', '等', '画', '等', '画', '等', '画', '等', '画']);
    // 试画的三帧画的还是那个画面：同一个镜头，不带影子
    expect(s.frames.map((f) => f.shadow)).toEqual([true, false, false, false, false]);
    for (const frame of s.frames.slice(1, 4)) expect(frame.view.matrixWorld.equals(s.frames[0].view.matrixWorld)).toBe(true);
    // 三帧各用了 14、304、24 毫秒：报的是居中的 24。头一次等的 500 毫秒不在里面
    expect(reported.mock.calls).toEqual([['full', 24, 'auto']]);
    expect(view.readout().perf).toMatchObject({ tier: 'full', trialMs: 24, glideMs: null, frames: 5 });
    expect(seen).toEqual({ ready: 'done', slow: 0, lost: 0, moved: 0 });
    expect(s.host.tiers.ceiling()).toBe('full');

    // 以后再摆好的画面（换小节、沙盘栏大小变了）不再试：没有再等过显卡
    const waited = s.did.filter((what) => what === '等').length;
    await until(view.showSection(headings[2]));
    s.paneSize.clientWidth = 600;
    view.resize();
    await wait(30);
    expect(s.did.filter((what) => what === '等')).toHaveLength(waited);
    expect(reported).toHaveBeenCalledTimes(1);
    expect(view.readout().perf?.trialMs).toBe(24);
  });

  it('慢了（程序自己挑的）：通知页面一次，ready 就这么开着，从此一帧不画、读者的手也不接，指令照常了结；关掉时 ready 了结；再摆的一座低一档', { timeout: 60_000 }, async () => {
    const s = stage(880, 900);
    const reported = vi.spyOn(s.host.tiers, 'reportTrial');
    // 等显卡画完一帧要 60 毫秒：过了“慢”的线，没到“没法用”
    s.cost.finishMs = TRIAL_SLOW_MS + 10;
    const view = await openView(s, { reducedMotion: false });
    const seen = watch(view);
    let others = 0;
    const off = view.onSlow(() => {
      others += 1;
    });
    off();
    await untilTrue(() => seen.slow > 0, '页面收到“太慢”');
    expect(reported.mock.calls).toEqual([['full', 60, 'auto']]);
    expect(s.host.tiers.ceiling()).toBe('reduced');
    // 画了第一个画面和试画的三帧，就停了：摆好之前最后补的那一帧没有画
    expect(s.frames).toHaveLength(4);

    // 过多久都一样：只通知了一次，取消了订阅的没有收到；ready 不完成也不拒绝
    await wait(3000);
    expect(seen).toEqual({ ready: 'open', slow: 1, lost: 0, moved: 0 });
    expect(others).toBe(0);

    // 页面还会叫它（沙盘栏大小变了、四边留的空变了、古今名字换了、读到另一节、回到这一节），读者的手也可能碰它：
    // 都不再画，题签不动，也不说“读者动了镜头”；指令照常了结，不拒绝
    const stripLog = strips.log.length;
    s.paneSize.clientWidth = 600;
    view.resize();
    view.setInsets({ top: 40, right: 0, bottom: 120, left: 0 });
    view.setNamesMode('modern');
    s.el.fire('wheel', wheel(-300));
    s.el.fire('pointerdown', mouse(400, 400));
    s.doc.fire('pointermove', mouse(460, 410));
    s.doc.fire('pointerup', mouse(460, 410));
    await until(view.showSection(headings[3]));
    await until(view.resetView());
    await wait(500);
    expect(s.frames).toHaveLength(4);
    expect(strips.log).toHaveLength(stripLog);
    expect(seen).toEqual({ ready: 'open', slow: 1, lost: 0, moved: 0 });
    // 读数还在（页面的那一行调试用的字要用）；读它也不画
    expect(view.readout().perf).toMatchObject({ tier: 'full', trialMs: 60, glideMs: null, frames: 4 });
    expect(s.frames).toHaveLength(4);

    // 页面没有先关它就摆下一座（画布被借走）：这一座不另外说“画面丢了”，ready 还是开着
    const second = await openView(s);
    const secondSeen = watch(second);
    await untilTrue(() => secondSeen.slow > 0, '第二座也说“太慢”');
    expect(seen).toEqual({ ready: 'open', slow: 1, lost: 0, moved: 0 });
    expect(view.readout()).toStrictEqual({ triangles: 0, drawCalls: 0 });
    // 关掉：ready 这才了结，不算失败
    view.destroy();
    await wait(0);
    expect(seen.ready).toBe('done');

    // 第二座没有指定画质，摆的是低一档（抗锯齿不一样，画布换了一块）；它试画也慢，上限到了“只放图片”
    expect(s.hostParts.qualities).toEqual([FULL_QUALITY, REDUCED_QUALITY]);
    expect(s.hostParts.canvasesMade()).toBe(2);
    expect(second.readout().perf).toMatchObject({ tier: 'reduced', trialMs: 60 });
    expect(reported.mock.calls[1]).toEqual(['reduced', 60, 'auto']);
    expect(s.host.tiers.ceiling()).toBe('still');
    expect(secondSeen).toEqual({ ready: 'open', slow: 1, lost: 0, moved: 0 });
  });

  it('慢得没法用（程序自己挑的）：上限直接到“只放图片”；通知以后画面丢了，不再另外通知，ready 也不拒绝', { timeout: 60_000 }, async () => {
    const s = stage(880, 900);
    s.cost.finishMs = TRIAL_HOPELESS_MS + 1;
    const view = await openView(s);
    const seen = watch(view);
    await untilTrue(() => seen.slow > 0, '页面收到“太慢”');
    expect(s.host.tiers.ceiling()).toBe('still');
    expect(view.readout().perf?.trialMs).toBe(201);
    s.hostParts.loseContext();
    await wait(1000);
    expect(seen).toEqual({ ready: 'open', slow: 1, lost: 0, moved: 0 });
    expect(view.readout()).toStrictEqual({ triangles: 0, drawCalls: 0 });
    await until(view.showSection(headings[1]));
    view.destroy();
    await wait(0);
    expect(seen.ready).toBe('done');
  });

  it('沙盘栏收着（竖着拿的平板上是 768 × 59 的一条）：先不试画，照样摆好；展开以后重摆的那一帧够格了才试——这时候慢了，是摆好以后才通知', { timeout: 60_000 }, async () => {
    // 收起来的一条多大是从页面上量的（tests/e2e/main-flow.spec.ts 里收起沙盘的那一项也拿它和这条线比）：
    // 高 60 像素减去下边 1 像素的线，宽就是窗口的宽。横着的窗口最宽到 959 才是上下排；竖着的窗口再宽也是上下排：
    // 竖着拿的大平板是 1024 和 1032 宽（tests/e2e/large-upright.spec.ts 量到的是 1024 × 59）。
    // 竖着的窗口宽到 1356 像素以上（竖起来的显示器），这一条的面积就过了八万：拦住它的是另一条线，不到 100 像素高不试（下一项）。
    const s = stage(768, 59);
    expect(768 * 59).toBeLessThan(TRIAL_MIN_AREA);
    expect(959 * 59).toBeLessThan(TRIAL_MIN_AREA);
    expect(1032 * 59).toBeLessThan(TRIAL_MIN_AREA);
    const reported = vi.spyOn(s.host.tiers, 'reportTrial');
    s.cost.finishMs = TRIAL_SLOW_MS + 10;
    const view = await openView(s);
    const seen = watch(view);
    await until(view.ready);
    // 摆好了，没有试过：没有等过显卡，只画了两帧（第一个画面，和最后补的一帧）
    expect(seen).toEqual({ ready: 'done', slow: 0, lost: 0, moved: 0 });
    expect(s.did).toEqual(['画', '画']);
    expect(view.readout().perf).toMatchObject({ trialMs: null, frames: 2 });
    // 栏还收着的时候换一节：照样不试
    await until(view.showSection(headings[2]));
    expect(s.did).not.toContain('等');
    expect(reported).not.toHaveBeenCalled();

    // 展开：镜头重摆一次，紧接着试画；慢了，通知页面
    const before = s.frames.length;
    s.paneSize.clientHeight = 572;
    view.resize();
    await wait(30);
    expect(s.frames.length - before).toBe(1 + TRIAL_FRAMES);
    expect(reported.mock.calls).toEqual([['full', 60, 'auto']]);
    expect(view.readout().perf).toMatchObject({ trialMs: 60 });
    // ready 早就完成了，还是完成的；从此不再画
    expect(seen).toEqual({ ready: 'done', slow: 1, lost: 0, moved: 0 });
    await until(view.showSection(headings[4]));
    await wait(500);
    expect(s.frames.length - before).toBe(1 + TRIAL_FRAMES);
    // 这以后画面丢了：页面早知道这一座不用了，不再另外通知
    s.hostParts.loseContext();
    await wait(100);
    expect(seen).toEqual({ ready: 'done', slow: 1, lost: 0, moved: 0 });
  });

  it('收着的一条多宽都不试画：竖起来的显示器上是 1400 × 59，面积过了八万也不试，照样摆好；展开了才试', { timeout: 60_000 }, async () => {
    const s = stage(1400, 59);
    expect(1400 * 59).toBeGreaterThanOrEqual(TRIAL_MIN_AREA);
    expect(59).toBeLessThan(TRIAL_MIN_HEIGHT);
    expect(bigEnoughToTry(1400, 59)).toBe(false);
    const reported = vi.spyOn(s.host.tiers, 'reportTrial');
    s.cost.finishMs = TRIAL_SLOW_MS + 10;
    const view = await openView(s);
    const seen = watch(view);
    await until(view.ready);
    // 摆好了，没有试过：没有等过显卡，只画了两帧；这台“慢”的设备没有因为一窄条被降档
    expect(seen).toEqual({ ready: 'done', slow: 0, lost: 0, moved: 0 });
    expect(s.did).toEqual(['画', '画']);
    expect(view.readout().perf).toMatchObject({ trialMs: null, frames: 2 });
    await until(view.showSection(headings[2]));
    expect(s.did).not.toContain('等');
    expect(reported).not.toHaveBeenCalled();
    expect(s.host.tiers.ceiling()).toBe('full');
    // 展开（1400 宽的竖窗口，栏高是窗口的 56%）：重摆的那一帧够格了，这才试
    const before = s.frames.length;
    s.paneSize.clientHeight = 1045;
    view.resize();
    await wait(30);
    expect(s.frames.length - before).toBe(1 + TRIAL_FRAMES);
    expect(reported.mock.calls).toEqual([['full', 60, 'auto']]);
    expect(seen).toEqual({ ready: 'done', slow: 1, lost: 0, moved: 0 });
    view.destroy();
  });

  it('页面在后台：先不试画，照样摆好；回到前台以后，下一次摆好的画面才试。沙盘栏正好八万平方像素的，当场就试', { timeout: 60_000 }, async () => {
    const s = stage(880, 900);
    s.page.visible = false;
    s.cost.finishMs = 7;
    const view = await openView(s);
    await until(view.ready);
    expect(view.readout().perf?.trialMs).toBeNull();
    expect(s.did).not.toContain('等');
    // 回到前台，没有新摆的画面：不会自己去试（读正文的时候一帧都不画）
    s.page.visible = true;
    const before = s.frames.length;
    await wait(1000);
    expect(s.frames).toHaveLength(before);
    expect(view.readout().perf?.trialMs).toBeNull();
    // 读到下一节，摆好了：试
    await until(view.showSection(headings[1]));
    expect(s.frames.length - before).toBe(1 + TRIAL_FRAMES);
    expect(s.did.filter((what) => what === '等')).toHaveLength(1 + TRIAL_FRAMES);
    // 摆好的那一帧带影子，试画的三帧不带：读数不用为了去掉“影子那一遍”再画一帧
    expect(view.readout().perf?.trialMs).toBe(7);
    expect(s.frames.length - before).toBe(1 + TRIAL_FRAMES);
    view.destroy();

    // 400 × 200 正好是八万：够格。展开着的沙盘栏最小是 600 × 176（平板最窄 600 像素，栏最矮 11rem），比它大
    const small = stage(400, 200);
    expect(400 * 200).toBe(TRIAL_MIN_AREA);
    expect(600 * 176).toBeGreaterThanOrEqual(TRIAL_MIN_AREA);
    small.cost.finishMs = 9;
    const tiny = await openView(small);
    await until(tiny.ready);
    expect(tiny.readout().perf?.trialMs).toBe(9);
  });
});

describe('镜头滑动时量快慢', () => {
  it('每一趟滑到头的都量、都报（换小节的、回到这一节的）；连着两趟慢才通知，中间夹一趟不慢的不算；页面去过后台的、被打断的不报', { timeout: 120_000 }, async () => {
    const s = stage(940, 900);
    const reported = vi.spyOn(s.host.tiers, 'reportGlide');
    const view = await openView(s, { section: headings[4], reducedMotion: false });
    const seen = watch(view);
    await until(view.ready);
    expect(view.readout().perf).toMatchObject({ trialMs: 0, glideMs: null });
    const glideMs = (): number | null | undefined => view.readout().perf?.glideMs;
    /** 画一帧 30 毫秒：约的帧隔 16 毫秒来一次，相邻两帧就隔 46 毫秒，过了“慢”的线，没到“卡住”。 */
    const SLOW_RENDER = 30;
    expect(FRAME_MS + SLOW_RENDER).toBeGreaterThan(GLIDE_SLOW_MS);
    expect(FRAME_MS + SLOW_RENDER).toBeLessThan(GLIDE_STALLED_MS);

    // 一、慢的一趟：报了 46，一趟还不通知。
    // 画得慢，一趟滑动的工夫不变（两秒多），画的帧就少（四十几帧，不是一百多帧）：滑到哪了，看的也是量快慢的那一个钟
    s.cost.renderMs = SLOW_RENDER;
    const start = s.frames.length;
    await until(view.showSection(headings[5]));
    expect(s.frames.length - start).toBeGreaterThan(40);
    expect(s.frames.length - start).toBeLessThan(60);
    expect(reported.mock.calls).toEqual([['full', 46, 'auto']]);
    expect(glideMs()).toBe(46);
    expect(seen.slow).toBe(0);

    // 二、不慢的一趟：报了 16，“连着慢”从头数。
    // 一路上每一帧都是先问页面在不在前台（顺带看钟）、再画：量的是这一帧开头到下一帧开头；到了以后重摆的那一帧不问
    s.cost.renderMs = 0;
    const mark = s.asked.length;
    await until(view.showSection(headings[4]));
    const way = s.asked.slice(mark);
    expect(way.length).toBeGreaterThan(200);
    expect(way.slice(0, 6)).toEqual(['问', '画', '问', '画', '问', '画']);
    expect(way.slice(-3)).toEqual(['问', '画', '画']);
    expect(reported.mock.calls[1]).toEqual(['full', 16, 'auto']);
    expect(glideMs()).toBe(16);

    // 三、又是慢的一趟：慢、不慢、慢，不通知
    s.cost.renderMs = SLOW_RENDER;
    await until(view.showSection(headings[5]));
    expect(reported.mock.calls[2]).toEqual(['full', 46, 'auto']);
    expect(seen.slow).toBe(0);

    // 四、慢的一趟，半路页面去了一下后台：这一趟不作数，不报（报了的话就是连着第二趟慢，要通知了），读数也还是上一趟的
    const hidden = view.showSection(headings[4]);
    await wait(200);
    s.page.visible = false;
    await wait(40);
    s.page.visible = true;
    await until(hidden);
    expect(reported).toHaveBeenCalledTimes(3);
    expect(glideMs()).toBe(46);
    expect(seen.slow).toBe(0);

    // 五、慢的一趟，半路被读者按住：不报。（这一趟里页面也去过一下后台，见下一条）
    const grabbed = view.showSection(headings[5]);
    await wait(100);
    s.page.visible = false;
    await wait(40);
    s.page.visible = true;
    await wait(60);
    s.el.fire('pointerdown', mouse(300, 300, 2));
    await grabbed;
    s.doc.fire('pointerup', mouse(300, 300, 2));
    await wait(400);
    expect(reported).toHaveBeenCalledTimes(3);
    expect(seen.slow).toBe(0);

    // 六、回到这一节（滑 900 毫秒）也量：这一趟不慢，报了 16。
    // 一趟滑动量一份：上一趟被打断了、页面还去过后台，都带累不到这一趟
    s.cost.renderMs = 0;
    await until(view.resetView());
    expect(reported.mock.calls[3]).toEqual(['full', 16, 'auto']);
    expect(glideMs()).toBe(16);

    // 七、慢的一趟，半路来了新的指令：被顶掉的那一趟不报，新的一趟滑到头，报一次
    s.cost.renderMs = SLOW_RENDER;
    const dropped = view.showSection(headings[4]);
    await wait(200);
    const taken = view.showSection(headings[5]);
    await dropped;
    await until(taken);
    expect(reported).toHaveBeenCalledTimes(5);
    expect(reported.mock.calls[4]).toEqual(['full', 46, 'auto']);
    expect(seen.slow).toBe(0);
    expect(s.host.tiers.ceiling()).toBe('full');

    // 八、紧接着又是慢的一趟：连着两趟了，通知页面，只一次；上限降一档
    const last = view.showSection(headings[4]);
    await untilTrue(() => seen.slow > 0, '页面收到“太慢”');
    const drawn = s.frames.length;
    await until(last);
    expect(reported).toHaveBeenCalledTimes(6);
    expect(s.host.tiers.ceiling()).toBe('reduced');
    // 摆好以后才通知的：ready 早就完成了。从此不再画：滑到头以后本来要重摆的那一帧也没有画；
    // 后面的指令照常了结，而且是马上了结（不再空滑两秒）
    const at = performance.now();
    await until(view.showSection(headings[5]));
    await until(view.resetView());
    expect(performance.now() - at).toBeLessThan(200);
    await wait(500);
    expect(s.frames).toHaveLength(drawn);
    expect(seen).toEqual({ ready: 'done', slow: 1, lost: 0, moved: 2 });
    expect(view.readout().perf).toMatchObject({ tier: 'full', glideMs: 46 });
    view.destroy();

    // 再摆的一座低一档。画一帧 120 毫秒，相邻两帧隔 136 毫秒：卡住了，一趟就通知；上限到了“只放图片”
    s.cost.renderMs = 0;
    const next = await openView(s, { section: headings[4], reducedMotion: false });
    const nextSeen = watch(next);
    await until(next.ready);
    expect(next.readout().perf?.tier).toBe('reduced');
    s.cost.renderMs = 120;
    expect(FRAME_MS + 120).toBeGreaterThan(GLIDE_STALLED_MS);
    await until(next.showSection(headings[5]));
    expect(reported.mock.calls[6]).toEqual(['reduced', 136, 'auto']);
    expect(nextSeen).toEqual({ ready: 'done', slow: 1, lost: 0, moved: 0 });
    expect(s.host.tiers.ceiling()).toBe('still');
  });

  it('量到的太少（卡住的设备上“回到这一节”只有几帧）：这一趟不作数，不报；设置了少动的不滑，也就没有可量的', { timeout: 60_000 }, async () => {
    const s = stage(940, 900);
    const reported = vi.spyOn(s.host.tiers, 'reportGlide');
    const view = await openView(s, { section: headings[4], reducedMotion: false });
    const seen = watch(view);
    await until(view.ready);
    // 读者把镜头拉近，再点“回到这一节”：滑 900 毫秒。相邻两帧隔 136 毫秒，一共只有七八帧，去掉开头两个间隔不够六个
    s.el.fire('wheel', wheel(-300));
    await wait(30);
    s.cost.renderMs = 120;
    const before = s.frames.length;
    await until(view.resetView());
    expect(s.frames.length - before).toBeGreaterThan(5);
    expect(s.frames.length - before).toBeLessThan(12);
    expect(reported).not.toHaveBeenCalled();
    expect(view.readout().perf?.glideMs).toBeNull();
    expect(seen.slow).toBe(0);
    view.destroy();

    // 少动：换小节直接摆到位，没有滑动，什么也不报
    const still = await openView(s, { section: headings[4], reducedMotion: true });
    await until(still.ready);
    await until(still.showSection(headings[5]));
    await until(still.resetView());
    expect(reported).not.toHaveBeenCalled();
    expect(still.readout().perf?.glideMs).toBeNull();
  });
});

describe('指定了画质的，读者自己要的', () => {
  it('指定了画质：试画照样做、滑动照样量、都照样报（记性不评），从不通知，也不停——哪怕记性答的是“降”', { timeout: 60_000 }, async () => {
    const s = stage(940, 900);
    // 一、真的记性：试画一帧 500 毫秒、滑动时相邻两帧隔 166 毫秒，程序自己挑的话早该降了
    const trial = vi.spyOn(s.host.tiers, 'reportTrial');
    const glide = vi.spyOn(s.host.tiers, 'reportGlide');
    s.cost.finishMs = 500;
    const view = await openView(s, { tier: 'full', section: headings[4], reducedMotion: false });
    const seen = watch(view);
    await until(view.ready);
    s.cost.renderMs = 150;
    await until(view.showSection(headings[5]));
    await until(view.showSection(headings[4]));
    expect(trial.mock.calls).toEqual([['full', 500, 'forced']]);
    expect(glide.mock.calls).toEqual([
      ['full', 166, 'forced'],
      ['full', 166, 'forced'],
    ]);
    expect(trial.mock.results[0].value).toBe('keep');
    expect(view.readout().perf).toMatchObject({ tier: 'full', trialMs: 500, glideMs: 166 });
    expect(seen).toEqual({ ready: 'done', slow: 0, lost: 0, moved: 0 });
    expect(s.host.tiers.ceiling()).toBe('full');
    view.destroy();

    // 二、记性换成一律答“降”的：指定了画质的沙盘自己也守着这一条，不通知，照样画
    trial.mockReturnValue('down');
    glide.mockReturnValue('down');
    s.cost.renderMs = 0;
    const again = await openView(s, { tier: 'reduced', section: headings[4], reducedMotion: false });
    const againSeen = watch(again);
    await until(again.ready);
    const before = s.frames.length;
    await until(again.showSection(headings[5]));
    expect(trial).toHaveBeenCalledTimes(2);
    expect(glide).toHaveBeenCalledTimes(3);
    expect(glide.mock.calls[2]).toEqual(['reduced', 16, 'forced']);
    expect(s.frames.length - before).toBeGreaterThan(100);
    expect(againSeen).toEqual({ ready: 'done', slow: 0, lost: 0, moved: 0 });
    // 还在画：读者滚一下滚轮，照样画一帧
    const drawn = s.frames.length;
    s.el.fire('wheel', wheel(-200));
    await wait(30);
    expect(s.frames.length - drawn).toBe(1);
  });

  it('读者自己要的（asked）：试画慢、滑动慢都不通知；卡住了才通知，上限到“只放图片”', { timeout: 60_000 }, async () => {
    const s = stage(940, 900);
    const trial = vi.spyOn(s.host.tiers, 'reportTrial');
    const glide = vi.spyOn(s.host.tiers, 'reportGlide');
    // 试画一帧 60 毫秒：程序自己挑的要降一档，读者自己要的不降
    s.cost.finishMs = TRIAL_SLOW_MS + 10;
    const view = await openView(s, { tier: 'reduced', asked: true, section: headings[4], reducedMotion: false });
    const seen = watch(view);
    await until(view.ready);
    expect(trial.mock.calls).toEqual([['reduced', 60, 'asked']]);
    expect(seen).toEqual({ ready: 'done', slow: 0, lost: 0, moved: 0 });

    // 连着两趟慢的滑动（相邻两帧隔 46 毫秒）：不通知
    s.cost.renderMs = 30;
    await until(view.showSection(headings[5]));
    await until(view.showSection(headings[4]));
    expect(glide.mock.calls).toEqual([
      ['reduced', 46, 'asked'],
      ['reduced', 46, 'asked'],
    ]);
    expect(seen.slow).toBe(0);
    expect(s.host.tiers.ceiling()).toBe('full');

    // 卡住了（隔 136 毫秒）：通知，只一次；这一次访问只放图片了
    s.cost.renderMs = 120;
    await until(view.showSection(headings[5]));
    expect(glide.mock.calls[2]).toEqual(['reduced', 136, 'asked']);
    expect(seen).toEqual({ ready: 'done', slow: 1, lost: 0, moved: 0 });
    expect(s.host.tiers.ceiling()).toBe('still');
    const drawn = s.frames.length;
    await until(view.showSection(headings[4]));
    await wait(300);
    expect(s.frames).toHaveLength(drawn);
  });

  it('读者自己要的（asked）：试画慢得没法用，摆好之前就通知，ready 就这么开着', { timeout: 60_000 }, async () => {
    const s = stage(940, 900);
    s.cost.finishMs = TRIAL_HOPELESS_MS + 1;
    const view = await openView(s, { tier: 'reduced', asked: true });
    const seen = watch(view);
    await untilTrue(() => seen.slow > 0, '页面收到“太慢”');
    await wait(2000);
    expect(seen).toEqual({ ready: 'open', slow: 1, lost: 0, moved: 0 });
    expect(view.readout().perf).toMatchObject({ tier: 'reduced', trialMs: 201 });
    expect(s.host.tiers.ceiling()).toBe('still');
    expect(s.frames).toHaveLength(1 + TRIAL_FRAMES);
  });
});

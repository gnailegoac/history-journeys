// 画布和渲染器的主人（src/stage/three/host.ts）的单元测试：借和还、换一档画质、画面丢了以后换新的、
// 等显卡画完、等一帧、放掉模型和贴图。
// 最后一组测的是一座沙盘（src/stage/three/view.ts）从建到真正动手造之前的那几步：什么时候去借画布，
// 起不来、中途关掉、画面丢了各是什么结果。再往后要真的三维画面，只能在浏览器里测。
// 画布和渲染器都是这里给的假的，不碰页面。运行：npx vitest run tests/stage/host.test.ts

import { BoxGeometry, DataTexture, Group, InstancedMesh, Mesh, MeshBasicMaterial, ShaderMaterial, Texture, type WebGLRenderer } from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FULL_QUALITY, browserParts, createHost, disposeTree, nextFrame, nextPaint, type HostParts, type PaintClock } from '../../src/stage/three/host';
import type { Quality } from '../../src/stage/three/internal';
import { REDUCED_QUALITY } from '../../src/stage/three/quality';
import { createStopView, type BrowserHost } from '../../src/stage/three/view';
import type { StageOptions, StopTable } from '../../src/stage/types';
import { fixtureScene } from '../support/fixtureScene';

interface FakeCanvas {
  id: number;
}
interface FakeRenderer {
  id: number;
  canvas: FakeCanvas;
  quality: Quality;
}
interface FakeContainer {
  name: string;
  children: FakeCanvas[];
}

/** withFinish 是 false 时不给“等显卡画完”的那一样（它本来就可以不写）。 */
function fakeParts(options: { withFinish?: boolean } = {}) {
  const made = { canvases: 0, renderers: 0 };
  const disposed: { renderer: FakeRenderer; lost: boolean }[] = [];
  /** 先后等过哪几个渲染器画完。 */
  const finished: FakeRenderer[] = [];
  const lostHandlers = new Map<number, () => void>();
  let failRenderer = false;
  const parts: HostParts<FakeContainer, FakeCanvas, FakeRenderer> = {
    ...(options.withFinish === false ? {} : { finish: (renderer: FakeRenderer) => void finished.push(renderer) }),
    createCanvas: () => ({ id: ++made.canvases }),
    createRenderer(canvas, quality) {
      if (failRenderer) throw new Error('浏览器不给三维画面');
      return { id: ++made.renderers, canvas, quality };
    },
    attach(container, canvas) {
      container.children.unshift(canvas);
    },
    detach(container, canvas) {
      container.children = container.children.filter((c) => c !== canvas);
    },
    onContextLost(canvas, listener) {
      lostHandlers.set(canvas.id, listener);
      return () => void lostHandlers.delete(canvas.id);
    },
    disposeRenderer(renderer, lost) {
      disposed.push({ renderer, lost });
    },
  };
  return {
    parts,
    made,
    disposed,
    finished,
    /** 让某一块画布上的三维画面丢掉。 */
    lose: (canvasId: number) => lostHandlers.get(canvasId)?.(),
    listening: (canvasId: number) => lostHandlers.has(canvasId),
    failNextRenderer: (fail: boolean) => {
      failRenderer = fail;
    },
  };
}

const container = (name: string): FakeContainer => ({ name, children: [] });

describe('借和还', () => {
  it('建、拆、再建：从头到尾只有一块画布、一个渲染器，容器里只留一块', () => {
    const fake = fakeParts();
    const host = createHost(fake.parts);
    const pane = container('沙盘栏');

    const first = host.acquire(pane);
    expect(pane.children).toEqual([first.canvas]);
    first.release();
    expect(pane.children).toEqual([]);
    expect(first.signal.aborted).toBe(true);

    const second = host.acquire(pane);
    expect(second.canvas).toBe(first.canvas);
    expect(second.renderer).toBe(first.renderer);
    expect(second.signal.aborted).toBe(false);
    expect(pane.children).toEqual([second.canvas]);
    expect(fake.made).toEqual({ canvases: 1, renderers: 1 });
    expect(fake.disposed).toEqual([]);
  });

  it('来借的时候没说画质：用完整的一档，造渲染器时带着，借到手的那一份上也写着', () => {
    const fake = fakeParts();
    const host = createHost(fake.parts);
    const lease = host.acquire(container('a'));
    expect(lease.quality).toBe(FULL_QUALITY);
    expect(lease.renderer.quality).toBe(FULL_QUALITY);
  });

  it('上一份没还就又来借：上一份作废，画布挪到新的容器里，还是只有一块', () => {
    const fake = fakeParts();
    const host = createHost(fake.parts);
    const a = container('a');
    const b = container('b');

    const first = host.acquire(a);
    const second = host.acquire(b);
    expect(first.signal.aborted).toBe(true);
    expect(first.lost).toBe(false);
    expect(a.children).toEqual([]);
    expect(b.children).toEqual([second.canvas]);
    expect(second.canvas).toBe(first.canvas);
    expect(fake.made.canvases).toBe(1);

    // 作废了的那一份再还一次，不碍事
    first.release();
    expect(b.children).toEqual([second.canvas]);
    expect(second.signal.aborted).toBe(false);
  });

  it('还可以重复还', () => {
    const fake = fakeParts();
    const host = createHost(fake.parts);
    const pane = container('a');
    const lease = host.acquire(pane);
    lease.release();
    lease.release();
    expect(pane.children).toEqual([]);
    expect(lease.lost).toBe(false);
  });
});

describe('换一档画质', () => {
  /** 和完整的一档只差在抗锯齿以外的地方（真的两档里没有这样的，这里造一份来查“看的是抗锯齿”）。 */
  const fullButFewerTrees: Quality = { ...FULL_QUALITY, treeKeep: 0.5 };

  it('借到手的那一份上写着这一次用的画质', () => {
    const fake = fakeParts();
    const host = createHost(fake.parts);
    const pane = container('沙盘栏');
    const first = host.acquire(pane, REDUCED_QUALITY);
    expect(first.quality).toBe(REDUCED_QUALITY);
    expect(first.renderer.quality).toBe(REDUCED_QUALITY);
    first.release();
    const second = host.acquire(pane, FULL_QUALITY);
    expect(second.quality).toBe(FULL_QUALITY);
    // 前一份上写的不跟着变
    expect(first.quality).toBe(REDUCED_QUALITY);
  });

  it('抗锯齿没变：画布和渲染器接着用，不放掉也不新造；借到手的那一份上写的是新的画质', () => {
    const fake = fakeParts();
    const host = createHost(fake.parts);
    const pane = container('沙盘栏');
    const first = host.acquire(pane, FULL_QUALITY);
    first.release();
    const second = host.acquire(pane, fullButFewerTrees);
    expect(second.canvas).toBe(first.canvas);
    expect(second.renderer).toBe(first.renderer);
    expect(second.quality).toBe(fullButFewerTrees);
    expect(fake.made).toEqual({ canvases: 1, renderers: 1 });
    expect(fake.disposed).toEqual([]);
  });

  it('抗锯齿变了（完整的换成减配的）：旧的画布和渲染器放掉，换新的；新的渲染器是照新的画质造的', () => {
    const fake = fakeParts();
    const host = createHost(fake.parts);
    const pane = container('沙盘栏');
    const first = host.acquire(pane, FULL_QUALITY);
    first.release();

    const second = host.acquire(pane, REDUCED_QUALITY);
    expect(second.canvas).not.toBe(first.canvas);
    expect(second.renderer).not.toBe(first.renderer);
    expect(second.renderer.quality).toBe(REDUCED_QUALITY);
    expect(pane.children).toEqual([second.canvas]);
    expect(fake.made).toEqual({ canvases: 2, renderers: 2 });
    // 旧的渲染器放掉了，它的画面没丢过；旧画布不再听“画面丢了”
    expect(fake.disposed).toEqual([{ renderer: first.renderer, lost: false }]);
    expect(fake.listening(first.canvas.id)).toBe(false);
    expect(fake.listening(second.canvas.id)).toBe(true);
    expect(second.signal.aborted).toBe(false);
    expect(second.lost).toBe(false);
  });

  it('上一份没还就换一档来借：上一份作废（不算画面丢了），再换新的画布', () => {
    const fake = fakeParts();
    const host = createHost(fake.parts);
    const a = container('a');
    const b = container('b');
    const first = host.acquire(a, FULL_QUALITY);
    let told = 0;
    first.onLost(() => {
      told += 1;
    });

    const second = host.acquire(b, REDUCED_QUALITY);
    expect(first.signal.aborted).toBe(true);
    expect(first.lost).toBe(false);
    expect(told).toBe(0);
    expect(a.children).toEqual([]);
    expect(b.children).toEqual([second.canvas]);
    expect(second.canvas).not.toBe(first.canvas);
    expect(fake.disposed).toEqual([{ renderer: first.renderer, lost: false }]);
  });

  it('换下去又换回来：每换一次都是新的，同一档连着借才接着用', () => {
    const fake = fakeParts();
    const host = createHost(fake.parts);
    const pane = container('沙盘栏');
    const full = host.acquire(pane, FULL_QUALITY);
    const reduced = host.acquire(pane, REDUCED_QUALITY);
    const reducedAgain = host.acquire(pane, REDUCED_QUALITY);
    const fullAgain = host.acquire(pane, FULL_QUALITY);
    expect(reducedAgain.canvas).toBe(reduced.canvas);
    expect(fullAgain.canvas).not.toBe(reduced.canvas);
    expect(fullAgain.canvas).not.toBe(full.canvas);
    expect(fake.made).toEqual({ canvases: 3, renderers: 3 });
    expect(fake.disposed.map((d) => d.renderer)).toEqual([full.renderer, reduced.renderer]);
    expect(pane.children).toEqual([fullAgain.canvas]);
  });

  it('旧画布放掉以后才来的“画面丢了”不算数（浏览器收回旧的三维画面时会来这么一下）', () => {
    const fake = fakeParts();
    const host = createHost(fake.parts);
    const pane = container('沙盘栏');
    const first = host.acquire(pane, FULL_QUALITY);
    const second = host.acquire(pane, REDUCED_QUALITY);
    fake.lose(first.canvas.id);
    expect(second.signal.aborted).toBe(false);
    expect(second.lost).toBe(false);
    // 接着借，还是这一块
    second.release();
    expect(host.acquire(pane, REDUCED_QUALITY).canvas).toBe(second.canvas);
  });

  it('画面丢了、又换了一档：只换一次，旧的渲染器按“丢过”放掉', () => {
    const fake = fakeParts();
    const host = createHost(fake.parts);
    const pane = container('沙盘栏');
    const first = host.acquire(pane, FULL_QUALITY);
    fake.lose(first.canvas.id);
    const second = host.acquire(pane, REDUCED_QUALITY);
    expect(fake.made).toEqual({ canvases: 2, renderers: 2 });
    expect(fake.disposed).toEqual([{ renderer: first.renderer, lost: true }]);
    expect(second.renderer.quality).toBe(REDUCED_QUALITY);
  });

  it('换一档时新的渲染器造不出来：抛出错误，容器里不留东西；下一次再试', () => {
    const fake = fakeParts();
    const host = createHost(fake.parts);
    const pane = container('沙盘栏');
    host.acquire(pane, FULL_QUALITY).release();
    fake.failNextRenderer(true);
    expect(() => host.acquire(pane, REDUCED_QUALITY)).toThrow('浏览器不给三维画面');
    expect(pane.children).toEqual([]);
    fake.failNextRenderer(false);
    const lease = host.acquire(pane, REDUCED_QUALITY);
    expect(pane.children).toEqual([lease.canvas]);
    expect(lease.renderer.quality).toBe(REDUCED_QUALITY);
  });
});

describe('这一次访问的画质记性跟着主人', () => {
  it('一个主人只有一份：每次看到的是同一份，在一处报了慢，别处马上知道', () => {
    const host = createHost(fakeParts().parts);
    const seenByFirstView = host.tiers;
    const seenBySecondView = host.tiers;
    expect(seenBySecondView).toBe(seenByFirstView);
    expect(host.tiers.ceiling()).toBe('full');
    expect(seenByFirstView.reportTrial('full', 60, 'auto')).toBe('down');
    expect(seenBySecondView.ceiling()).toBe('reduced');
  });

  it('借画布、换画布、彻底放掉都不动它：上限只在这一次访问里往下走', () => {
    const fake = fakeParts();
    const host = createHost(fake.parts);
    const pane = container('沙盘栏');
    host.tiers.reportTrial('full', 60, 'auto');
    const lease = host.acquire(pane, REDUCED_QUALITY);
    fake.lose(lease.canvas.id);
    host.acquire(pane, FULL_QUALITY).release();
    host.dispose();
    expect(host.tiers.ceiling()).toBe('reduced');
  });

  it('两个主人各有各的', () => {
    const a = createHost(fakeParts().parts);
    const b = createHost(fakeParts().parts);
    a.tiers.reportTrial('full', 5000, 'auto');
    expect(a.tiers.ceiling()).toBe('still');
    expect(b.tiers.ceiling()).toBe('full');
  });
});

describe('等显卡把一帧画完（试画计时用）', () => {
  it('lease.finish 等的是借到手的这一个渲染器', () => {
    const fake = fakeParts();
    const host = createHost(fake.parts);
    const lease = host.acquire(container('a'));
    lease.finish();
    lease.finish();
    expect(fake.finished).toEqual([lease.renderer, lease.renderer]);
  });

  it('没给“怎么等”：什么也不做，不出错', () => {
    const fake = fakeParts({ withFinish: false });
    const host = createHost(fake.parts);
    const lease = host.acquire(container('a'));
    expect(() => lease.finish()).not.toThrow();
    expect(fake.finished).toEqual([]);
  });

  it('这一份作废以后（还了、被借走了、画面丢了）不再等', () => {
    const fake = fakeParts();
    const host = createHost(fake.parts);
    const pane = container('a');

    const released = host.acquire(pane);
    released.release();
    released.finish();

    const taken = host.acquire(pane);
    const next = host.acquire(pane);
    taken.finish();

    fake.lose(next.canvas.id);
    next.finish();
    expect(fake.finished).toEqual([]);
  });

  it('浏览器里：从画布上读回一个像素（浏览器要等显卡画完才答得出来）', () => {
    const reads: unknown[][] = [];
    const gl = { RGBA: 'RGBA', UNSIGNED_BYTE: 'UNSIGNED_BYTE', readPixels: (...args: unknown[]) => void reads.push(args) };
    const renderer = { getContext: () => gl } as unknown as WebGLRenderer;
    if (!browserParts.finish) throw new Error('浏览器里的那一套没有给 finish');
    browserParts.finish(renderer);
    expect(reads).toHaveLength(1);
    const [x, y, width, height, format, type, into] = reads[0];
    expect([x, y, width, height, format, type]).toEqual([0, 0, 1, 1, 'RGBA', 'UNSIGNED_BYTE']);
    expect(into).toBeInstanceOf(Uint8Array);
    expect((into as Uint8Array).length).toBe(4);
  });
});

describe('三维画面丢了', () => {
  it('这一份作废并通知；下一次来借时换一块新的画布和新的渲染器', () => {
    const fake = fakeParts();
    const host = createHost(fake.parts);
    const pane = container('沙盘栏');
    const first = host.acquire(pane);
    let told = 0;
    first.onLost(() => {
      told += 1;
    });

    fake.lose(first.canvas.id);
    expect(told).toBe(1);
    expect(first.signal.aborted).toBe(true);
    expect(first.lost).toBe(true);
    expect(pane.children).toEqual([]);
    // 再还一次不会再通知
    first.release();
    expect(told).toBe(1);

    const second = host.acquire(pane);
    expect(second.canvas).not.toBe(first.canvas);
    expect(second.renderer).not.toBe(first.renderer);
    expect(pane.children).toEqual([second.canvas]);
    expect(fake.made).toEqual({ canvases: 2, renderers: 2 });
    // 旧的渲染器放掉了，而且知道它的画面已经丢了；旧画布不再听
    expect(fake.disposed).toEqual([{ renderer: first.renderer, lost: true }]);
    expect(fake.listening(first.canvas.id)).toBe(false);
    expect(second.signal.aborted).toBe(false);
    expect(second.lost).toBe(false);
  });

  it('没借出去的时候丢了：下一次来借照样换新的', () => {
    const fake = fakeParts();
    const host = createHost(fake.parts);
    const pane = container('a');
    const first = host.acquire(pane);
    first.release();
    fake.lose(first.canvas.id);
    const second = host.acquire(pane);
    expect(second.canvas).not.toBe(first.canvas);
    expect(pane.children).toEqual([second.canvas]);
  });

  it('取消订阅以后不再通知', () => {
    const fake = fakeParts();
    const host = createHost(fake.parts);
    const lease = host.acquire(container('a'));
    let told = 0;
    const off = lease.onLost(() => {
      told += 1;
    });
    off();
    fake.lose(lease.canvas.id);
    expect(told).toBe(0);
  });
});

describe('造不出来、彻底放掉', () => {
  it('渲染器造不出来：acquire 抛出错误，容器里不留东西；下一次再试', () => {
    const fake = fakeParts();
    const host = createHost(fake.parts);
    const pane = container('a');
    fake.failNextRenderer(true);
    expect(() => host.acquire(pane)).toThrow('浏览器不给三维画面');
    expect(pane.children).toEqual([]);

    fake.failNextRenderer(false);
    const lease = host.acquire(pane);
    expect(pane.children).toEqual([lease.canvas]);
    expect(fake.made.renderers).toBe(1);
  });

  it('dispose：借出去的作废，渲染器放掉；以后再借是新的', () => {
    const fake = fakeParts();
    const host = createHost(fake.parts);
    const pane = container('a');
    const first = host.acquire(pane);
    host.dispose();
    expect(first.signal.aborted).toBe(true);
    expect(pane.children).toEqual([]);
    expect(fake.disposed).toEqual([{ renderer: first.renderer, lost: false }]);

    const second = host.acquire(pane);
    expect(second.canvas).not.toBe(first.canvas);
  });
});

describe('浏览器里的那一套：放掉渲染器', () => {
  /** 假的渲染器：只记下做了什么。lostNow 是这时候三维画面是不是还丢着。 */
  function fakeRenderer(lostNow: boolean): { renderer: WebGLRenderer; log: string[] } {
    const log: string[] = [];
    const renderer = {
      dispose: () => void log.push('dispose'),
      forceContextLoss: () => void log.push('forceContextLoss'),
      getContext: () => ({ isContextLost: () => lostNow }),
    };
    return { renderer: renderer as unknown as WebGLRenderer, log };
  }

  it('没丢过的：放掉，并把三维画面还给浏览器', () => {
    const { renderer, log } = fakeRenderer(false);
    browserParts.disposeRenderer(renderer, false);
    expect(log).toEqual(['dispose', 'forceContextLoss']);
  });

  it('丢了、现在还丢着的：放掉就行，不用再还', () => {
    const { renderer, log } = fakeRenderer(true);
    browserParts.disposeRenderer(renderer, true);
    expect(log).toEqual(['dispose']);
  });

  it('丢过、浏览器后来又还回来了的：也要还给浏览器，不然这块不用了的画布还占着一个三维画面', () => {
    const { renderer, log } = fakeRenderer(false);
    browserParts.disposeRenderer(renderer, true);
    expect(log).toEqual(['dispose', 'forceContextLoss']);
  });
});

describe('浏览器里的那一套：把画布拿出来', () => {
  it('画布从容器里拿走，并缩成一个像素（留着下一次用，可不留着那一大块画面的内存）；容器原来的定位还原', () => {
    const log: string[] = [];
    const canvas = { width: 1536, height: 1144, remove: () => void log.push('remove') };
    const container = { style: { position: 'relative' } };
    browserParts.detach(container as unknown as HTMLElement, canvas as unknown as HTMLCanvasElement);
    expect(log).toEqual(['remove']);
    expect({ width: canvas.width, height: canvas.height }).toEqual({ width: 1, height: 1 });
    // 这个容器的定位不是 attach 改的（没有记过）：不动它
    expect(container.style.position).toBe('relative');
  });
});

describe('等浏览器画一帧', () => {
  function fakeClock() {
    let frame: (() => void) | null = null;
    let timer: { run: () => void; ms: number } | null = null;
    const clock: PaintClock = {
      requestFrame(run) {
        frame = run;
        return () => {
          frame = null;
        };
      },
      setTimer(run, ms) {
        timer = { run, ms };
        return () => {
          timer = null;
        };
      },
    };
    return {
      clock,
      fireFrame: () => frame?.(),
      fireTimer: () => timer?.run(),
      hasFrame: () => frame !== null,
      timerMs: () => timer?.ms ?? null,
    };
  }

  it('动画帧先到：调用一次，定时也取消了', () => {
    const fake = fakeClock();
    let runs = 0;
    nextFrame(() => {
      runs += 1;
    }, fake.clock);
    expect(fake.timerMs()).toBe(100);
    fake.fireFrame();
    expect(runs).toBe(1);
    expect(fake.timerMs()).toBeNull();
    fake.fireTimer();
    expect(runs).toBe(1);
  });

  it('页面在后台，浏览器不给动画帧：100 毫秒的定时到了也算', () => {
    const fake = fakeClock();
    let runs = 0;
    nextFrame(() => {
      runs += 1;
    }, fake.clock);
    fake.fireTimer();
    expect(runs).toBe(1);
    expect(fake.hasFrame()).toBe(false);
  });

  it('取消以后两头都不再调用', () => {
    const fake = fakeClock();
    let runs = 0;
    const cancel = nextFrame(() => {
      runs += 1;
    }, fake.clock);
    cancel();
    expect(fake.hasFrame()).toBe(false);
    expect(fake.timerMs()).toBeNull();
    expect(runs).toBe(0);
  });

  it('nextPaint 在那一帧完成', async () => {
    const fake = fakeClock();
    let done = false;
    const waiting = nextPaint(fake.clock).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    fake.fireFrame();
    await waiting;
    expect(done).toBe(true);
  });
});

describe('放掉模型和贴图', () => {
  it('一组东西下面的形状、材质、贴图都放掉：并成一个的、成批摆的、自己写着色器的都算', () => {
    const gone: string[] = [];
    const track = <T extends { addEventListener(type: 'dispose', listener: () => void): void }>(thing: T, name: string): T => {
      thing.addEventListener('dispose', () => gone.push(name));
      return thing;
    };

    const map = track(new Texture(), '贴图');
    const shared = track(new MeshBasicMaterial({ map }), '共用的材质');
    const group = new Group();
    group.add(new Mesh(track(new BoxGeometry(1, 1, 1), '形状一'), shared));
    const inner = new Group();
    inner.add(new InstancedMesh(track(new BoxGeometry(1, 1, 1), '形状二'), shared, 3));
    const data = track(new DataTexture(new Uint8Array(4), 1, 1), '着色器里的贴图');
    const shader = track(new ShaderMaterial({ uniforms: { uA: { value: data }, uMix: { value: 0 } } }), '着色器材质');
    inner.add(new Mesh(track(new BoxGeometry(1, 1, 1), '形状三'), shader));
    group.add(inner);

    disposeTree(group);
    expect(gone.sort()).toEqual(['共用的材质', '形状一', '形状三', '形状二', '着色器材质', '着色器里的贴图', '贴图'].sort());
  });
});

describe('一座沙盘怎么借画布、怎么收场（真正动手造之前）', () => {
  /** 一个只记账的假主人：画布和渲染器都是空壳。 */
  function fakeHost(options: { failRenderer?: boolean } = {}) {
    const record = { attached: 0, detached: 0 };
    const lostHandlers: (() => void)[] = [];
    const parts: HostParts<HTMLElement, HTMLCanvasElement, WebGLRenderer> = {
      createCanvas: () => ({}) as HTMLCanvasElement,
      createRenderer() {
        if (options.failRenderer) throw new Error('浏览器不给三维画面');
        return { setPixelRatio() {}, setSize() {}, clear() {} } as unknown as WebGLRenderer;
      },
      attach() {
        record.attached += 1;
      },
      detach() {
        record.detached += 1;
      },
      onContextLost(_canvas, listener) {
        lostHandlers.push(listener);
        return () => {};
      },
      disposeRenderer() {},
    };
    const host: BrowserHost = createHost(parts);
    return { host, record, lose: () => lostHandlers.forEach((handler) => handler()) };
  }

  const pane = { clientWidth: 880, clientHeight: 900 } as HTMLElement;
  const table = (): StopTable => ({ kind: 'stop', key: 'test/sample-town', scene: fixtureScene(), terrainUrl: 'sample-town.terrain.bin' });
  // 这一组走的是真的钟：画质指定成完整的一档，机器忙的时候也不会被“量出来慢了”改掉
  const options: StageOptions = { namesMode: 'ancient', reducedMotion: false, tier: 'full' };

  /** 让约好的几帧都跑完。 */
  const frames = async (count = 6): Promise<void> => {
    for (let i = 0; i < count; i++) await new Promise((resolve) => setTimeout(resolve, 2));
  };
  const outcome = (promise: Promise<void>): Promise<'resolved' | Error> =>
    promise.then(
      () => 'resolved' as const,
      (reason: unknown) => (reason instanceof Error ? reason : new Error(String(reason))),
    );

  /** 取地形文件的请求：一直等着，被叫停才结束（记下收到的 signal）。 */
  let fetchSignals: AbortSignal[] = [];
  const hangingFetch = (_url: string, init?: { signal?: AbortSignal }): Promise<Response> =>
    new Promise((_resolve, reject) => {
      if (!init?.signal) return;
      const signal = init.signal;
      fetchSignals.push(signal);
      signal.addEventListener('abort', () => reject(new Error('请求被叫停了')));
    });

  beforeEach(() => {
    fetchSignals = [];
    vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0));
    vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    vi.stubGlobal('fetch', hangingFetch);
  });
  afterEach(async () => {
    // 等约好的帧都跑完再把假的 requestAnimationFrame 拿走
    await frames();
    vi.unstubAllGlobals();
  });

  it('create 不抛错，这一轮里也不去借画布；马上关掉：ready 照常完成，一次画布也没借过', async () => {
    const { host, record } = fakeHost();
    const view = createStopView(pane, table(), options, host);
    expect(record.attached).toBe(0);
    view.destroy();
    expect(await outcome(view.ready)).toBe('resolved');
    await frames();
    expect(record.attached).toBe(0);

    // 关掉以后：showSection、resetView 拒绝，别的方法不做事，可以重复关
    expect(await outcome(view.showSection('后来'))).toBeInstanceOf(Error);
    expect(await outcome(view.resetView())).toBeInstanceOf(Error);
    view.resize();
    view.setInsets({ top: 1, right: 2, bottom: 3, left: 4 });
    view.setNamesMode('modern');
    expect(view.readout()).toEqual({ triangles: 0, drawCalls: 0 });
    view.destroy();
  });

  it('建、拆、再建（开发时 React 会这样）：只有后一座去借画布，而且只借一次', async () => {
    const { host, record } = fakeHost();
    const first = createStopView(pane, table(), options, host);
    first.destroy();
    const second = createStopView(pane, table(), options, host);
    await frames();
    expect(record.attached).toBe(1);
    expect(fetchSignals).toHaveLength(1);
    expect(await outcome(first.ready)).toBe('resolved');

    // 后一座造到一半关掉：取地形文件的请求被叫停，画布还回去，ready 照常完成
    second.destroy();
    expect(fetchSignals[0].aborted).toBe(true);
    expect(record.detached).toBe(1);
    expect(await outcome(second.ready)).toBe('resolved');
  });

  it('渲染器造不出来：ready 拒绝，说的是原因', async () => {
    const { host } = fakeHost({ failRenderer: true });
    const view = createStopView(pane, table(), options, host);
    const result = await outcome(view.ready);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe('浏览器不给三维画面');
    view.destroy();
  });

  it('地形文件读不出来：ready 拒绝，画布还回去', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, status: 404 }));
    const { host, record } = fakeHost();
    const view = createStopView(pane, table(), options, host);
    const result = await outcome(view.ready);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('404');
    expect(record.detached).toBe(1);
    view.destroy();
  });

  it('地形文件大小不对：ready 拒绝，画布还回去', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)) }));
    const { host, record } = fakeHost();
    const view = createStopView(pane, table(), options, host);
    expect(await outcome(view.ready)).toBeInstanceOf(Error);
    expect(record.detached).toBe(1);
    view.destroy();
  });

  it('还没摆出第一个画面，三维画面就丢了：ready 拒绝；页面订的 onLost 不另外通知', async () => {
    const { host, lose } = fakeHost();
    const view = createStopView(pane, table(), options, host);
    let told = 0;
    view.onLost(() => {
      told += 1;
    });
    await frames();
    lose();
    const result = await outcome(view.ready);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toContain('三维画面丢了');
    expect(told).toBe(0);
    // 画面丢了以后、页面把它关掉之前，指令照常完成，不拒绝
    expect(await outcome(view.showSection('后来'))).toBe('resolved');
    view.destroy();
  });

  it('画布被另一座沙盘借走（前一座还没摆好）：前一座的 ready 拒绝，后一座不受影响', async () => {
    const { host, record } = fakeHost();
    const first = createStopView(pane, table(), options, host);
    await frames();
    const second = createStopView(pane, table(), options, host);
    await frames();
    expect(record.attached).toBe(2);
    expect(await outcome(first.ready)).toBeInstanceOf(Error);
    first.destroy();
    expect(fetchSignals[1].aborted).toBe(false);
    second.destroy();
    expect(await outcome(second.ready)).toBe('resolved');
  });

  it('第一个画面之前：场景里没有的小节马上拒绝；有的小节先记着，关掉时照常完成', async () => {
    const { host } = fakeHost();
    const view = createStopView(pane, table(), options, host);
    const wrong = await outcome(view.showSection('没有这一节'));
    expect(wrong).toBeInstanceOf(RangeError);
    const asked = view.showSection('后来');
    expect(await outcome(view.resetView())).toBe('resolved');
    view.destroy();
    expect(await outcome(asked)).toBe('resolved');
  });
});

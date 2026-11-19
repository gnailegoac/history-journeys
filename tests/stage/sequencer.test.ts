// 换小节的先后（src/stage/three/sequencer.ts）的单元测试：新的顶掉旧的、什么时候拒绝、滑动的每一帧。
// 干活的一边和时钟都是这里给的假的，不碰 three 和页面。运行：npx vitest run tests/stage/sequencer.test.ts

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sequencer, ease, mixState, type Glide, type TableState } from '../../src/stage/three/sequencer';

const HEADINGS = ['起初', '后来', '最后'];

interface Rig {
  sequencer: Sequencer;
  /** 干活的一边被叫到的记录，按先后。 */
  calls: string[];
  /** 时钟走 ms 毫秒，然后跑约好的下一帧（没有约就只走时钟）。 */
  tick(ms: number): void;
  /** 约好还没跑的帧有几个。 */
  pendingFrames(): number;
}

function rig(options: { reducedMotion?: boolean; glide?: (heading: string, why: string) => Glide | null; place?: (heading: string) => void } = {}): Rig {
  const calls: string[] = [];
  let now = 0;
  const frames: (() => void)[] = [];
  const sequencer = new Sequencer(
    HEADINGS,
    HEADINGS[0],
    {
      place(heading) {
        calls.push(`place ${heading}`);
        options.place?.(heading);
      },
      glide(heading, why) {
        calls.push(`glide ${heading} ${why}`);
        if (options.glide) return options.glide(heading, why);
        return { durationMs: 1000, frame: (e) => calls.push(`frame ${heading} ${e.toFixed(3)}`) };
      },
      settled: () => Promise.resolve(),
    },
    {
      now: () => now,
      nextFrame(run) {
        frames.push(run);
        return () => {
          const at = frames.indexOf(run);
          if (at >= 0) frames.splice(at, 1);
        };
      },
    },
    options.reducedMotion ?? false,
  );
  return {
    sequencer,
    calls,
    tick(ms) {
      now += ms;
      frames.shift()?.();
    },
    pendingFrames: () => frames.length,
  };
}

/** 一个 Promise 现在是什么结果。 */
function watch(promise: Promise<void>): { state: 'pending' | 'resolved' | 'rejected'; reason: unknown } {
  const result: { state: 'pending' | 'resolved' | 'rejected'; reason: unknown } = { state: 'pending', reason: null };
  promise.then(
    () => {
      result.state = 'resolved';
    },
    (reason: unknown) => {
      result.state = 'rejected';
      result.reason = reason;
    },
  );
  return result;
}

/** 让已经能完成的 Promise 都完成。 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('第一个画面之前', () => {
  it('start() 把一开始的那一节直接摆到位，不滑', async () => {
    const { sequencer, calls } = rig();
    expect(sequencer.started).toBe(false);
    await sequencer.start();
    expect(calls).toEqual(['place 起初']);
    expect(sequencer.started).toBe(true);
    expect(sequencer.section).toBe('起初');
  });

  it('之前叫的 show 先记下来：start() 时直接摆那一节，到那时才完成', async () => {
    const { sequencer, calls } = rig();
    const asked = watch(sequencer.show('后来'));
    await flush();
    expect(asked.state).toBe('pending');
    expect(calls).toEqual([]);
    expect(sequencer.section).toBe('后来');

    await sequencer.start();
    await flush();
    expect(calls).toEqual(['place 后来']);
    expect(asked.state).toBe('resolved');
  });

  it('之前连叫两次：前一次被顶掉、照常完成，摆的是后一次的', async () => {
    const { sequencer, calls } = rig();
    const first = watch(sequencer.show('后来'));
    const second = watch(sequencer.show('最后'));
    await flush();
    expect(first.state).toBe('resolved');
    expect(second.state).toBe('pending');
    await sequencer.start();
    await flush();
    expect(calls).toEqual(['place 最后']);
    expect(second.state).toBe('resolved');
  });

  it('之前叫 reset：没有可回的地方，直接完成，什么也不做', async () => {
    const { sequencer, calls } = rig();
    await sequencer.reset();
    expect(calls).toEqual([]);
  });

  it('start() 叫第二次不再摆', async () => {
    const { sequencer, calls } = rig();
    await sequencer.start();
    await sequencer.start();
    expect(calls).toEqual(['place 起初']);
  });
});

describe('换小节', () => {
  it('滑过去：每一帧按缓动以后的进度画，到了摆到位，画面稳定以后完成', async () => {
    const { sequencer, calls, tick, pendingFrames } = rig();
    await sequencer.start();
    calls.length = 0;

    const done = watch(sequencer.show('后来'));
    expect(sequencer.gliding).toBe(true);
    expect(calls).toEqual(['glide 后来 section']);
    tick(250);
    tick(250);
    tick(500);
    expect(calls).toEqual(['glide 后来 section', 'frame 后来 0.156', 'frame 后来 0.500', 'frame 后来 1.000', 'place 后来']);
    expect(sequencer.gliding).toBe(false);
    expect(pendingFrames()).toBe(0);
    await flush();
    expect(done.state).toBe('resolved');
    expect(sequencer.section).toBe('后来');
  });

  it('旧的一次在新的一次开始时就完成，而且不会再摆旧的那一节', async () => {
    const { sequencer, calls, tick } = rig();
    await sequencer.start();
    calls.length = 0;

    const older = watch(sequencer.show('后来'));
    tick(300);
    const newer = watch(sequencer.show('最后'));
    await flush();
    expect(older.state).toBe('resolved');
    expect(newer.state).toBe('pending');

    tick(600);
    tick(600);
    await flush();
    expect(newer.state).toBe('resolved');
    expect(calls.filter((c) => c.startsWith('place'))).toEqual(['place 最后']);
    expect(calls.some((c) => c.startsWith('frame 后来') && calls.indexOf(c) > calls.indexOf('glide 最后 section'))).toBe(false);
  });

  it('写了不滑：直接摆到位', async () => {
    const { sequencer, calls } = rig();
    await sequencer.start();
    calls.length = 0;
    await sequencer.show('后来', false);
    expect(calls).toEqual(['place 后来']);
  });

  it('减少动态效果：直接摆到位，连怎么滑都不问', async () => {
    const { sequencer, calls } = rig({ reducedMotion: true });
    await sequencer.start();
    calls.length = 0;
    await sequencer.show('后来');
    await sequencer.reset();
    expect(calls).toEqual(['place 后来', 'place 后来']);
  });

  it('干活的一边说不用滑（返回 null）：直接摆到位', async () => {
    const { sequencer, calls } = rig({ glide: () => null });
    await sequencer.start();
    calls.length = 0;
    await sequencer.show('最后');
    expect(calls).toEqual(['glide 最后 section', 'place 最后']);
  });

  it('时长是 0 的滑动：一帧就到', async () => {
    const { sequencer, calls, tick } = rig({ glide: (heading) => ({ durationMs: 0, frame: (e) => calls.push(`frame ${heading} ${e}`) }) });
    await sequencer.start();
    calls.length = 0;
    const done = watch(sequencer.show('后来'));
    tick(16);
    await flush();
    expect(calls).toEqual(['glide 后来 section', 'frame 后来 1', 'place 后来']);
    expect(done.state).toBe('resolved');
  });
});

describe('回到这一节', () => {
  it('滑回现在这一节摆好的位置', async () => {
    const { sequencer, calls, tick } = rig();
    await sequencer.start();
    await sequencer.show('后来', false);
    calls.length = 0;

    const done = watch(sequencer.reset());
    tick(1000);
    await flush();
    expect(calls).toEqual(['glide 后来 reset', 'frame 后来 1.000', 'place 后来']);
    expect(done.state).toBe('resolved');
  });

  it('被新的 show 顶掉时照常完成', async () => {
    const { sequencer, tick } = rig();
    await sequencer.start();
    const reset = watch(sequencer.reset());
    tick(100);
    void sequencer.show('最后');
    await flush();
    expect(reset.state).toBe('resolved');
  });
});

describe('拒绝', () => {
  it('场景里没有的小节标题：拒绝，而且不打断正在做的那一次', async () => {
    const { sequencer, calls, tick } = rig();
    const early = watch(sequencer.show('没有这一节'));
    await flush();
    expect(early.state).toBe('rejected');
    expect(early.reason).toBeInstanceOf(RangeError);
    expect(sequencer.section).toBe('起初');

    await sequencer.start();
    calls.length = 0;
    const going = watch(sequencer.show('后来'));
    const wrong = watch(sequencer.show('没有这一节'));
    await flush();
    expect(wrong.state).toBe('rejected');
    expect(going.state).toBe('pending');
    expect(sequencer.section).toBe('后来');
    tick(1000);
    await flush();
    expect(going.state).toBe('resolved');
    expect(calls).toContain('place 后来');
  });

  it('关掉以后：show、reset 一律拒绝；还没做完的照常完成', async () => {
    const { sequencer, calls, tick, pendingFrames } = rig();
    await sequencer.start();
    calls.length = 0;
    const pending = watch(sequencer.show('后来'));
    tick(200);

    sequencer.destroy();
    await flush();
    expect(pending.state).toBe('resolved');
    expect(pendingFrames()).toBe(0);
    expect(calls.some((c) => c.startsWith('place'))).toBe(false);

    const show = watch(sequencer.show('最后'));
    const reset = watch(sequencer.reset());
    await flush();
    expect(show.state).toBe('rejected');
    expect(reset.state).toBe('rejected');
    // 可以重复关
    sequencer.destroy();
  });

  it('第一个画面之前就关掉：等着的照常完成，start() 不再摆', async () => {
    const { sequencer, calls } = rig();
    const asked = watch(sequencer.show('后来'));
    sequencer.destroy();
    await flush();
    expect(asked.state).toBe('resolved');
    await sequencer.start();
    expect(calls).toEqual([]);
    expect(sequencer.started).toBe(false);
  });
});

describe('读者自己动了镜头', () => {
  it('正在滑：停在半路，等着的照常完成，不再摆到位', async () => {
    const { sequencer, calls, tick, pendingFrames } = rig();
    await sequencer.start();
    calls.length = 0;
    const going = watch(sequencer.show('后来'));
    tick(400);

    expect(sequencer.interrupt()).toBe(true);
    expect(sequencer.gliding).toBe(false);
    expect(pendingFrames()).toBe(0);
    await flush();
    expect(going.state).toBe('resolved');
    expect(calls.some((c) => c.startsWith('place'))).toBe(false);
    // 要摆的还是新的那一节：“回到这一节”回的是它
    expect(sequencer.section).toBe('后来');
  });

  it('没在滑：什么也不打断', async () => {
    const { sequencer } = rig();
    expect(sequencer.interrupt()).toBe(false);
    await sequencer.start();
    expect(sequencer.interrupt()).toBe(false);
  });
});

describe('干活的一边出了错', () => {
  it('摆的时候出错：不拒绝，照常完成（页面不用为镜头处理错误）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sequencer } = rig({
      place: (heading) => {
        if (heading === '后来') throw new Error('摆不出来');
      },
    });
    await sequencer.start();
    const done = watch(sequencer.show('后来', false));
    await flush();
    expect(done.state).toBe('resolved');
    expect(warn).toHaveBeenCalled();
  });

  it('滑到一半出错：直接摆到位', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sequencer, calls, tick } = rig({
      glide: () => ({
        durationMs: 1000,
        frame: () => {
          throw new Error('这一帧画不出来');
        },
      }),
    });
    await sequencer.start();
    calls.length = 0;
    const done = watch(sequencer.show('最后'));
    tick(100);
    await flush();
    expect(calls).toEqual(['glide 最后 section', 'place 最后']);
    expect(done.state).toBe('resolved');
  });
});

describe('缓动和中间的样子', () => {
  it('ease：两头慢、中间快，出了 0 到 1 的范围取两头', () => {
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.5)).toBe(0.5);
    expect(ease(0.25)).toBeCloseTo(0.15625, 9);
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
  });

  it('mixState：镜头、水位、水色、云气都按同一个进度取中间', () => {
    const a: TableState = { position: [0, 100, 1000], target: [0, 0, 0], fov: 18, levelM: 37.6, flood: 0, mist: 0.4 };
    const b: TableState = { position: [200, 300, 0], target: [100, 10, -50], fov: 22, levelM: 44.6, flood: 1, mist: 1 };
    expect(mixState(a, b, 0)).toEqual(a);
    expect(mixState(a, b, 1)).toEqual(b);
    const half = mixState(a, b, 0.5);
    expect(half.position).toEqual([100, 200, 500]);
    expect(half.target).toEqual([50, 5, -25]);
    expect(half.fov).toBe(20);
    expect(half.levelM).toBeCloseTo(41.1, 9);
    expect(half.flood).toBe(0.5);
    expect(half.mist).toBeCloseTo(0.7, 9);
  });
});

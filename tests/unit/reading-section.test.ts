// 读者正读到哪一小节（src/ui/useReadingSection.ts 里的几个不碰页面的函数）。不用浏览器，也不等真的时间。

import { describe, expect, it } from 'vitest';
import { READING_DWELL_MS, READING_LINE, dwellReporter, pickSection, readingLine, remainingScroll } from '../../src/ui/useReadingSection';

/** 三个小节，标题在窗口里的高度由测试给。 */
function marks(tops: [number, number, number]) {
  return [
    { section: '第一节', top: tops[0] },
    { section: '第二节', top: tops[1] },
    { section: '第三节', top: tops[2] },
  ];
}

describe('pickSection', () => {
  it('标题在阅读线上面的最后一个小节，就是正在读的', () => {
    expect(pickSection(marks([-500, 120, 700]), 378)).toBe('第二节');
    expect(pickSection(marks([-900, -300, 200]), 378)).toBe('第三节');
  });

  it('标题在阅读线下面的小节还没轮到', () => {
    expect(pickSection(marks([100, 400, 900]), 378)).toBe('第一节');
  });

  it('正好压在线上不算过了线', () => {
    expect(pickSection(marks([-500, 378, 900]), 378)).toBe('第一节');
    expect(pickSection(marks([-500, 377.5, 900]), 378)).toBe('第二节');
  });

  it('页面刚打开，第一节的标题还在阅读线下面：算第一节', () => {
    expect(pickSection(marks([420, 1100, 1900]), 378)).toBe('第一节');
  });

  it('滚过了最后一节的标题：一直是最后一节', () => {
    expect(pickSection(marks([-3000, -2000, -900]), 378)).toBe('第三节');
  });

  it('只有一个小节', () => {
    expect(pickSection([{ section: '独一节', top: 900 }], 378)).toBe('独一节');
    expect(pickSection([{ section: '独一节', top: -900 }], 378)).toBe('独一节');
  });

  it('一个小节也没有：null', () => {
    expect(pickSection([], 378)).toBeNull();
  });
});

describe('readingLine', () => {
  it('宽屏：沙盘在旁边，线在窗口从上往下 42% 的地方', () => {
    expect(READING_LINE).toBe(0.42);
    expect(readingLine(900, 0)).toBeCloseTo(378, 6);
  });

  it('窄屏：沙盘钉在顶上，线从沙盘的下边算起', () => {
    // 竖着拿的 768 × 1024 平板，沙盘高 573：线在 573 + (1024 − 573) × 0.42。
    expect(readingLine(1024, 573)).toBeCloseTo(762.42, 6);
    expect(readingLine(1024, 573)).toBeGreaterThan(readingLine(1024, 0));
  });

  it('页面还能往下滚很多时，剩多少都不影响', () => {
    expect(readingLine(900, 0, 5000)).toBeCloseTo(378, 6);
    expect(readingLine(900, 0, 522)).toBeCloseTo(378, 6);
  });

  it('快滚到底时，线跟着往下挪；到底时在窗口的底边', () => {
    expect(readingLine(900, 0, 300)).toBe(600);
    expect(readingLine(900, 0, 100)).toBe(800);
    expect(readingLine(900, 0, 0)).toBe(900);
    // 有的浏览器在页面到底时会报出很小的负数。
    expect(readingLine(900, 0, -0.5)).toBe(900);
  });

  it('滚到底：最后几个短的小节都轮得到，不会跳过中间的', () => {
    // 最后两节的标题在页面到底时分别在窗口的 500 和 760，都在 42% 的线下面。
    const atBottom = marks([-2000, 500, 760]);
    expect(pickSection(atBottom, readingLine(900, 0))).toBe('第一节');
    expect(pickSection(atBottom, readingLine(900, 0, 0))).toBe('第三节');
    // 离底还有 200 时（整页往上回 200，标题都低 200）：线在 700，第二节过了线，第三节还没有。
    const nearBottom = marks([-1800, 700 - 1, 960]);
    expect(pickSection(nearBottom, readingLine(900, 0, 200))).toBe('第二节');
  });
});

describe('remainingScroll', () => {
  it('页面往下还能滚多少', () => {
    expect(remainingScroll(5000, 900, 0)).toBe(4100);
    expect(remainingScroll(5000, 900, 4000)).toBe(100);
    expect(remainingScroll(5000, 900, 4100)).toBe(0);
  });

  it('整页短得不用滚：算还远，阅读线不挪到底边，读的是第一节，不是最后一节', () => {
    expect(remainingScroll(700, 900, 0)).toBe(Infinity);
    expect(remainingScroll(900, 900, 0)).toBe(Infinity);
    // 三节都在一屏里，标题在 380、500、700：只有照“还远”算，才是第一节。
    const short = marks([380, 500, 700]);
    expect(pickSection(short, readingLine(900, 0, remainingScroll(900, 900, 0)))).toBe('第一节');
    expect(pickSection(short, readingLine(900, 0, 0))).toBe('第三节');
  });
});

describe('dwellReporter：一个小节要连着当上 150 毫秒才往上报', () => {
  /** 一只假的钟：定时的事记在这里，advance 把钟往前拨，到了点的才做。 */
  function clock() {
    let now = 0;
    let nextId = 1;
    const pending = new Map<number, { at: number; run: () => void }>();
    return {
      timers: {
        set: (run: () => void, ms: number) => {
          pending.set(nextId, { at: now + ms, run });
          return nextId++;
        },
        clear: (id: number) => void pending.delete(id),
      },
      advance(ms: number) {
        now += ms;
        for (const [id, timer] of [...pending]) {
          if (timer.at <= now) {
            pending.delete(id);
            timer.run();
          }
        }
      },
      waiting: () => pending.size,
    };
  }

  function watch() {
    const time = clock();
    const told: string[] = [];
    const dwell = dwellReporter<number>((section) => told.push(section), time.timers);
    return { time, told, dwell };
  }

  it('要等的就是 150 毫秒', () => {
    expect(READING_DWELL_MS).toBe(150);
  });

  it('停够了才报：差一毫秒不报，到点就报，只报一次', () => {
    const { time, told, dwell } = watch();
    dwell.see('第一节');
    time.advance(149);
    expect(told).toEqual([]);
    time.advance(1);
    expect(told).toEqual(['第一节']);
    time.advance(1000);
    expect(told).toEqual(['第一节']);
  });

  it('一掠而过的小节不报：不到 150 毫秒就换成了别的小节', () => {
    const { time, told, dwell } = watch();
    dwell.see('第一节');
    time.advance(150);
    dwell.see('第二节');
    time.advance(40);
    dwell.see('第三节');
    time.advance(149);
    expect(told).toEqual(['第一节']);
    time.advance(1);
    expect(told).toEqual(['第一节', '第三节']);
    expect(told).not.toContain('第二节');
  });

  it('滚动时一帧看一次，说的还是同一节：不重新计时', () => {
    const { time, told, dwell } = watch();
    for (let i = 0; i < 9; i += 1) {
      dwell.see('第二节');
      time.advance(16);
    }
    expect(told).toEqual([]);
    dwell.see('第二节');
    time.advance(6);
    expect(told).toEqual(['第二节']);
  });

  it('掠过别的小节又回到已经报过的那一节：不重报，掠过的那一节也不报', () => {
    const { time, told, dwell } = watch();
    dwell.see('第一节');
    time.advance(150);
    dwell.see('第二节');
    time.advance(100);
    dwell.see('第一节');
    time.advance(1000);
    expect(told).toEqual(['第一节']);
    expect(time.waiting()).toBe(0);
  });

  it('一个小节也没有（null）：不报，也把等着的取消掉', () => {
    const { time, told, dwell } = watch();
    dwell.see('第一节');
    time.advance(100);
    dwell.see(null);
    time.advance(1000);
    expect(told).toEqual([]);
    expect(time.waiting()).toBe(0);
  });

  it('stop 以后，等着的不再报', () => {
    const { time, told, dwell } = watch();
    dwell.see('第一节');
    time.advance(100);
    dwell.stop();
    time.advance(1000);
    expect(told).toEqual([]);
    expect(time.waiting()).toBe(0);
  });

  it('要等多久可以另给', () => {
    const time = clock();
    const told: string[] = [];
    const dwell = dwellReporter<number>((section) => told.push(section), time.timers, 30);
    dwell.see('第一节');
    time.advance(30);
    expect(told).toEqual(['第一节']);
  });
});

// 挑哪一档画质、什么时候往下降（src/stage/three/tier.ts）。全是算数，钟点是测试自己给的，所以结果和机器快慢无关。
// 最后一组查沙盘程序怎么答“能不能画”（src/stage/three/engine.ts 的 support）：画布和渲染器是假的，不要浏览器。
// 运行：npx vitest run tests/stage/tier.test.ts
//
// 这里的每一条线（多少毫秒算慢）都还没有在平板和手机上量过；测试守的是规矩，不是这些数对不对。

import type { WebGLRenderer } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostParts } from '../../src/stage/three/host';
import {
  GLIDE_MIN_SAMPLES,
  GLIDE_SKIP_FRAMES,
  GLIDE_SLOW_MS,
  GLIDE_STALLED_MS,
  SLOW_GLIDES_TO_STEP_DOWN,
  TRIAL_FRAMES,
  TRIAL_HOPELESS_MS,
  TRIAL_MIN_AREA,
  TRIAL_SLOW_MS,
  chooseTier,
  createGlideMeter,
  createTierMemory,
  middle,
  type Ceiling,
  type TierMemory,
  type TierMode,
} from '../../src/stage/three/tier';
import type { StageOptions, StageTier, StopTable } from '../../src/stage/types';
import { fixtureScene } from '../support/fixtureScene';
import { readBytes } from '../support/readBytes';

/** 一份上限已经降到减配的记性（两次慢的滑动降下来的，减配这一档还没试画过）。 */
function atReduced(): TierMemory {
  const memory = createTierMemory();
  memory.reportGlide('full', GLIDE_STALLED_MS + 1, 'auto');
  expect(memory.ceiling()).toBe('reduced');
  return memory;
}

/** 一份上限已经到了“只放图片”的记性。 */
function atStill(): TierMemory {
  const memory = createTierMemory();
  memory.reportTrial('full', TRIAL_HOPELESS_MS + 1, 'auto');
  expect(memory.ceiling()).toBe('still');
  return memory;
}

describe('几条线的数', () => {
  // 试画的最小面积原来是四万：竖着拿的平板上收起来的那一条有 768 × 59 = 45,312，照四万算它也“够大”，改成了八万。
  it('和设计里写的一样（试画的最小面积除外：它后来从四万改成了八万）', () => {
    expect({ TRIAL_FRAMES, TRIAL_MIN_AREA, TRIAL_SLOW_MS, TRIAL_HOPELESS_MS, GLIDE_SKIP_FRAMES, GLIDE_MIN_SAMPLES, GLIDE_SLOW_MS, GLIDE_STALLED_MS, SLOW_GLIDES_TO_STEP_DOWN }).toEqual({
      TRIAL_FRAMES: 3,
      TRIAL_MIN_AREA: 80_000,
      TRIAL_SLOW_MS: 50,
      TRIAL_HOPELESS_MS: 200,
      GLIDE_SKIP_FRAMES: 2,
      GLIDE_MIN_SAMPLES: 6,
      GLIDE_SLOW_MS: 42,
      GLIDE_STALLED_MS: 125,
      SLOW_GLIDES_TO_STEP_DOWN: 2,
    });
  });
});

describe('一座沙盘照哪一档摆、怎么评（chooseTier）', () => {
  it('没指定：照上限摆，程序自己评（auto）。一开始上限是完整的一档', () => {
    const memory = createTierMemory();
    expect(memory.ceiling()).toBe('full');
    expect(chooseTier(memory, {})).toEqual({ tier: 'full', mode: 'auto' });
    expect(chooseTier(atReduced(), {})).toEqual({ tier: 'reduced', mode: 'auto' });
  });

  it('指定了画质：照它摆，从不评（forced），上限是什么都不管', () => {
    for (const memory of [createTierMemory(), atReduced(), atStill()]) {
      expect(chooseTier(memory, { tier: 'full' })).toEqual({ tier: 'full', mode: 'forced' });
      expect(chooseTier(memory, { tier: 'reduced' })).toEqual({ tier: 'reduced', mode: 'forced' });
      expect(chooseTier(memory, { tier: 'reduced', asked: false })).toEqual({ tier: 'reduced', mode: 'forced' });
    }
  });

  it('读者自己要的：照它摆，只看“没法用”的两条线（asked），上限是什么都不管', () => {
    for (const memory of [createTierMemory(), atReduced(), atStill()]) {
      expect(chooseTier(memory, { tier: 'reduced', asked: true })).toEqual({ tier: 'reduced', mode: 'asked' });
    }
  });

  it('asked 只和 tier 一起才算数：单写 asked 当作没写', () => {
    expect(chooseTier(createTierMemory(), { asked: true })).toEqual({ tier: 'full', mode: 'auto' });
    expect(chooseTier(atStill(), { asked: true })).toBeNull();
  });

  it('上限已经是“只放图片”而又没指定画质：null（这时候不该再摆立体的沙盘）', () => {
    expect(chooseTier(atStill(), {})).toBeNull();
  });

  it('挑档不改记性', () => {
    const memory = createTierMemory();
    chooseTier(memory, {});
    chooseTier(memory, { tier: 'reduced' });
    chooseTier(memory, { tier: 'reduced', asked: true });
    expect(memory.ceiling()).toBe('full');
  });
});

describe('浏览器自己说“只能用软件画”', () => {
  it('这一次访问最高只到减配；说几遍都一样', () => {
    const memory = createTierMemory();
    memory.noteCaveat();
    expect(memory.ceiling()).toBe('reduced');
    memory.noteCaveat();
    expect(memory.ceiling()).toBe('reduced');
    expect(chooseTier(memory, {})).toEqual({ tier: 'reduced', mode: 'auto' });
  });

  it('上限已经是“只放图片”时不会被它抬回减配', () => {
    const memory = atStill();
    memory.noteCaveat();
    expect(memory.ceiling()).toBe('still');
  });

  it('只是一个提示：减配的一档照样要试画，过了就留着', () => {
    const memory = createTierMemory();
    memory.noteCaveat();
    expect(memory.reportTrial('reduced', 30, 'auto')).toBe('keep');
    expect(memory.ceiling()).toBe('reduced');
  });
});

describe('试画（程序自己挑的）', () => {
  const trial = (tier: StageTier, ms: number, memory = tier === 'full' ? createTierMemory() : atReduced()): { verdict: string; ceiling: Ceiling } => ({
    verdict: memory.reportTrial(tier, ms, 'auto'),
    ceiling: memory.ceiling(),
  });

  it('完整的一档：不超过 50 毫秒留着；超过 50 降到减配；超过 200 直接只放图片', () => {
    expect(trial('full', 8)).toEqual({ verdict: 'keep', ceiling: 'full' });
    expect(trial('full', 50)).toEqual({ verdict: 'keep', ceiling: 'full' });
    expect(trial('full', 50.5)).toEqual({ verdict: 'down', ceiling: 'reduced' });
    expect(trial('full', 200)).toEqual({ verdict: 'down', ceiling: 'reduced' });
    expect(trial('full', 200.5)).toEqual({ verdict: 'down', ceiling: 'still' });
    expect(trial('full', 1900)).toEqual({ verdict: 'down', ceiling: 'still' });
  });

  it('减配的一档：不超过 50 毫秒留着；超过了就只放图片', () => {
    expect(trial('reduced', 50)).toEqual({ verdict: 'keep', ceiling: 'reduced' });
    expect(trial('reduced', 50.5)).toEqual({ verdict: 'down', ceiling: 'still' });
    expect(trial('reduced', 200.5)).toEqual({ verdict: 'down', ceiling: 'still' });
  });

  it('每一档只认一次：过了关，这一次访问里同一档再报多慢的试画都不再评', () => {
    const memory = createTierMemory();
    expect(memory.reportTrial('full', 30, 'auto')).toBe('keep');
    expect(memory.reportTrial('full', 80, 'auto')).toBe('keep');
    expect(memory.reportTrial('full', 5000, 'auto')).toBe('keep');
    expect(memory.ceiling()).toBe('full');
  });

  it('一档过了关不算另一档也过了：降到减配以后，减配的试画照样评', () => {
    const memory = createTierMemory();
    expect(memory.reportTrial('full', 30, 'auto')).toBe('keep');
    // 后来两次慢的滑动把上限降到了减配
    memory.reportGlide('full', GLIDE_SLOW_MS + 1, 'auto');
    memory.reportGlide('full', GLIDE_SLOW_MS + 1, 'auto');
    expect(memory.ceiling()).toBe('reduced');
    expect(memory.reportTrial('reduced', 60, 'auto')).toBe('down');
    expect(memory.ceiling()).toBe('still');
  });

  it('量出来的不是个正经的数（不是数、无穷大、负的）：不评，也不算过了关', () => {
    const memory = createTierMemory();
    for (const ms of [Number.NaN, Number.POSITIVE_INFINITY, -1]) expect(memory.reportTrial('full', ms, 'auto')).toBe('keep');
    expect(memory.ceiling()).toBe('full');
    expect(memory.reportTrial('full', 60, 'auto')).toBe('down');
    expect(memory.ceiling()).toBe('reduced');
  });
});

describe('镜头滑动（程序自己挑的）', () => {
  const SLOW = GLIDE_SLOW_MS + 0.5;
  const FINE = GLIDE_SLOW_MS;

  it('居中的间隔不超过 42 毫秒：正常，多少次都留着', () => {
    const memory = createTierMemory();
    for (const ms of [16.7, 22, 33.3, FINE, FINE, FINE]) expect(memory.reportGlide('full', ms, 'auto')).toBe('keep');
    expect(memory.ceiling()).toBe('full');
  });

  it('连着两次慢的滑动：降一档', () => {
    const memory = createTierMemory();
    expect(memory.reportGlide('full', SLOW, 'auto')).toBe('keep');
    expect(memory.ceiling()).toBe('full');
    expect(memory.reportGlide('full', SLOW, 'auto')).toBe('down');
    expect(memory.ceiling()).toBe('reduced');
  });

  it('慢、正常、慢：不降（正常的一次把账清了）；再接着慢一次才降', () => {
    const memory = createTierMemory();
    expect(memory.reportGlide('full', SLOW, 'auto')).toBe('keep');
    expect(memory.reportGlide('full', FINE, 'auto')).toBe('keep');
    expect(memory.reportGlide('full', SLOW, 'auto')).toBe('keep');
    expect(memory.ceiling()).toBe('full');
    expect(memory.reportGlide('full', SLOW, 'auto')).toBe('down');
    expect(memory.ceiling()).toBe('reduced');
  });

  it('正好 125 毫秒只算慢；超过 125 是卡住了，一次就降', () => {
    const slow = createTierMemory();
    expect(slow.reportGlide('full', GLIDE_STALLED_MS, 'auto')).toBe('keep');
    expect(slow.ceiling()).toBe('full');

    const stalled = createTierMemory();
    expect(stalled.reportGlide('full', GLIDE_STALLED_MS + 0.5, 'auto')).toBe('down');
    expect(stalled.ceiling()).toBe('reduced');
  });

  it('卡住了也只降一步：完整的降到减配，减配的降到只放图片', () => {
    const memory = createTierMemory();
    expect(memory.reportGlide('full', 2000, 'auto')).toBe('down');
    expect(memory.ceiling()).toBe('reduced');
    expect(memory.reportGlide('reduced', 2000, 'auto')).toBe('down');
    expect(memory.ceiling()).toBe('still');
  });

  it('降了一档以后，慢滑动的次数从头数：新的一档也要连着两次才降', () => {
    const memory = createTierMemory();
    memory.reportGlide('full', SLOW, 'auto');
    memory.reportGlide('full', SLOW, 'auto');
    expect(memory.ceiling()).toBe('reduced');
    expect(memory.reportGlide('reduced', SLOW, 'auto')).toBe('keep');
    expect(memory.ceiling()).toBe('reduced');
    expect(memory.reportGlide('reduced', SLOW, 'auto')).toBe('down');
    expect(memory.ceiling()).toBe('still');
  });

  it('次数记在这一次访问里，不跟着某一座沙盘：上一站慢了一次，下一站再慢一次就降', () => {
    const memory = createTierMemory();
    // 两座沙盘先后各拿到同一份记性，各报一次
    const firstStop = (): string => memory.reportGlide('full', SLOW, 'auto');
    const secondStop = (): string => memory.reportGlide('full', SLOW, 'auto');
    expect(firstStop()).toBe('keep');
    expect(secondStop()).toBe('down');
  });

  it('量出来的不是个正经的数：不评，也不动慢滑动的次数', () => {
    const memory = createTierMemory();
    memory.reportGlide('full', SLOW, 'auto');
    expect(memory.reportGlide('full', Number.NaN, 'auto')).toBe('keep');
    expect(memory.reportGlide('full', SLOW, 'auto')).toBe('down');
  });
});

describe('指定了画质的沙盘：从不评，也不记', () => {
  it('试画和滑动再慢也留着，上限不动', () => {
    for (const tier of ['full', 'reduced'] as const) {
      const memory = createTierMemory();
      expect(memory.reportTrial(tier, 10_000, 'forced')).toBe('keep');
      for (let i = 0; i < 5; i++) expect(memory.reportGlide(tier, 10_000, 'forced')).toBe('keep');
      expect(memory.ceiling()).toBe('full');
    }
  });

  it('它的试画不算这一档过了关', () => {
    const memory = createTierMemory();
    memory.reportTrial('full', 5, 'forced');
    expect(memory.reportTrial('full', 60, 'auto')).toBe('down');
  });

  it('它的滑动不进慢滑动的账：不加，也不清', () => {
    const memory = createTierMemory();
    memory.reportGlide('full', 60, 'forced');
    expect(memory.reportGlide('full', 60, 'auto')).toBe('keep');
    memory.reportGlide('full', 10, 'forced');
    expect(memory.reportGlide('full', 60, 'auto')).toBe('down');
  });
});

describe('读者自己要的沙盘（asked）：只看“没法用”的两条线', () => {
  it('试画：有点慢（超过 50）不管；超过 200 才算没法用，回到只放图片', () => {
    const memory = atStill();
    expect(memory.reportTrial('reduced', 120, 'asked')).toBe('keep');
    expect(memory.ceiling()).toBe('still');

    const other = atStill();
    expect(other.reportTrial('reduced', TRIAL_HOPELESS_MS, 'asked')).toBe('keep');
    const hopeless = atStill();
    expect(hopeless.reportTrial('reduced', TRIAL_HOPELESS_MS + 0.5, 'asked')).toBe('down');
    expect(hopeless.ceiling()).toBe('still');
  });

  it('滑动：慢多少次都不管；超过 125 才算没法用', () => {
    const memory = atStill();
    for (let i = 0; i < 10; i++) expect(memory.reportGlide('reduced', GLIDE_STALLED_MS, 'asked')).toBe('keep');
    expect(memory.reportGlide('reduced', GLIDE_STALLED_MS + 0.5, 'asked')).toBe('down');
    expect(memory.ceiling()).toBe('still');
  });

  it('没法用的结果是只放图片，上限原来在哪都一样（地址里写了只放图片、读者又点了要立体的那种情形，上限还是完整的）', () => {
    const trial = createTierMemory();
    expect(trial.reportTrial('reduced', 900, 'asked')).toBe('down');
    expect(trial.ceiling()).toBe('still');

    const glide = createTierMemory();
    expect(glide.reportGlide('reduced', 900, 'asked')).toBe('down');
    expect(glide.ceiling()).toBe('still');

    // 读者要的是完整的一档也一样：不是降一步到减配，是只放图片
    const fullTrial = createTierMemory();
    expect(fullTrial.reportTrial('full', 900, 'asked')).toBe('down');
    expect(fullTrial.ceiling()).toBe('still');
    const fullGlide = createTierMemory();
    expect(fullGlide.reportGlide('full', 900, 'asked')).toBe('down');
    expect(fullGlide.ceiling()).toBe('still');
  });

  it('留着的时候不动上限：不升，也不降', () => {
    for (const memory of [createTierMemory(), atReduced(), atStill()]) {
      const before = memory.ceiling();
      memory.reportTrial('reduced', 20, 'asked');
      memory.reportGlide('reduced', 20, 'asked');
      memory.reportGlide('reduced', GLIDE_SLOW_MS + 1, 'asked');
      memory.reportGlide('reduced', GLIDE_SLOW_MS + 1, 'asked');
      expect(memory.ceiling()).toBe(before);
    }
  });

  it('试画也只认一次：过了“没法用”的线，这一档再报多慢的试画都不再评', () => {
    const memory = atStill();
    expect(memory.reportTrial('reduced', 120, 'asked')).toBe('keep');
    expect(memory.reportTrial('reduced', 5000, 'asked')).toBe('keep');
  });

  it('它过的只是“没法用”的线：程序自己挑的沙盘在同一档试画，照样按“慢”的线评', () => {
    const memory = createTierMemory();
    expect(memory.reportTrial('full', 120, 'asked')).toBe('keep');
    expect(memory.reportTrial('full', 120, 'auto')).toBe('down');
    expect(memory.ceiling()).toBe('reduced');
  });

  it('它的滑动不进慢滑动的账', () => {
    const memory = createTierMemory();
    memory.reportGlide('full', 60, 'asked');
    expect(memory.reportGlide('full', 60, 'auto')).toBe('keep');
  });
});

describe('只降不升', () => {
  const RANK: Record<Ceiling, number> = { still: 0, reduced: 1, full: 2 };

  it('记性里只有这四样，没有一样能把上限调高', () => {
    expect(Object.keys(createTierMemory()).sort()).toEqual(['ceiling', 'noteCaveat', 'reportGlide', 'reportTrial']);
  });

  it('好消息不会把上限抬回去', () => {
    const memory = atReduced();
    for (const mode of ['auto', 'asked', 'forced'] as const) {
      for (const tier of ['full', 'reduced'] as const) {
        for (let i = 0; i < 20; i++) {
          memory.reportTrial(tier, 1, mode);
          memory.reportGlide(tier, 1, mode);
        }
      }
    }
    expect(memory.ceiling()).toBe('reduced');
  });

  it('随便怎么报（四万次，各种档、各种评法、各种数）：上限每一步都只会不动或者往下', () => {
    // 固定的一串随机数，每次运行都一样
    let seed = 20261119;
    const random = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
    const tiers: readonly StageTier[] = ['full', 'reduced'];
    const modes: readonly TierMode[] = ['auto', 'asked', 'forced'];
    const times = [0, 5, 16.7, 42, 43, 50, 51, 125, 126, 200, 201, 5000, Number.NaN];

    for (let run = 0; run < 400; run++) {
      const memory = createTierMemory();
      let rank = RANK[memory.ceiling()];
      for (let step = 0; step < 100; step++) {
        const kind = random();
        if (kind < 0.05) memory.noteCaveat();
        else if (kind < 0.5) memory.reportTrial(pick(tiers), pick(times), pick(modes));
        else memory.reportGlide(pick(tiers), pick(times), pick(modes));
        const now = RANK[memory.ceiling()];
        expect(now).toBeLessThanOrEqual(rank);
        rank = now;
      }
    }
  });
});

describe('已经被嫌慢的那一座沙盘再报，降不了第二次', () => {
  it('完整的一档试画慢了，上限降到减配；这一座再报试画、再报滑动，上限还是减配', () => {
    const memory = createTierMemory();
    expect(memory.reportTrial('full', 60, 'auto')).toBe('down');
    expect(memory.ceiling()).toBe('reduced');

    // 页面还没来得及把它关掉，它又报了几次：答的都是“不用了”，上限不再动
    expect(memory.reportTrial('full', 60, 'auto')).toBe('down');
    expect(memory.reportTrial('full', 5000, 'auto')).toBe('down');
    expect(memory.reportGlide('full', 5000, 'auto')).toBe('down');
    expect(memory.reportGlide('full', 60, 'auto')).toBe('down');
    expect(memory.reportGlide('full', 60, 'auto')).toBe('down');
    expect(memory.ceiling()).toBe('reduced');
  });

  it('它后来报的也不进下一档的账：新摆的减配的一座，慢滑动照样从头数', () => {
    const memory = createTierMemory();
    memory.reportGlide('full', 500, 'auto');
    memory.reportGlide('full', 60, 'auto');
    expect(memory.reportGlide('reduced', 60, 'auto')).toBe('keep');
    expect(memory.ceiling()).toBe('reduced');
  });

  it('档在上限上面的沙盘，报得再快也是“不用了”：它不该再留着', () => {
    const memory = atReduced();
    expect(memory.reportTrial('full', 1, 'auto')).toBe('down');
    expect(memory.reportGlide('full', 1, 'auto')).toBe('down');
    expect(memory.ceiling()).toBe('reduced');
  });
});

describe('量一次滑动（GlideMeter）', () => {
  /** 照这些间隔（毫秒）一帧一帧地报，返回 end 给的数。hiddenAt 是第几帧（从 0 数）页面不在前台。 */
  function glide(intervals: number[], options: { complete?: boolean; hiddenAt?: number; meter?: ReturnType<typeof createGlideMeter>; startMs?: number } = {}): number | null {
    const meter = options.meter ?? createGlideMeter();
    let now = options.startMs ?? 1000;
    meter.frame(now, options.hiddenAt !== 0);
    intervals.forEach((gap, i) => {
      now += gap;
      meter.frame(now, options.hiddenAt !== i + 1);
    });
    return meter.end(options.complete ?? true);
  }
  const steady = (count: number, gap: number): number[] => Array.from({ length: count }, () => gap);

  it('匀匀地滑：给的是相邻两帧隔多久', () => {
    expect(glide(steady(60, 16.7))).toBeCloseTo(16.7, 6);
    expect(glide(steady(40, 50))).toBeCloseTo(50, 6);
  });

  it('开头的两个间隔不算（换灯、画影子、换模型都落在那里）', () => {
    expect(glide([900, 400, ...steady(GLIDE_MIN_SAMPLES, 20)])).toBe(20);
    // 第三个间隔起就算了：六个里有四个是 300，居中的就是 300
    expect(glide([20, 20, 300, 300, 300, 300, 20, 20])).toBe(300);
  });

  it('取居中的数：中间卡一下不影响', () => {
    expect(glide([20, 20, 20, 20, 20, 883, 20, 20, 20])).toBe(20);
  });

  it('个数是双数时取中间两个的平均', () => {
    expect(glide([0, 0, 10, 30, 10, 30, 10, 30])).toBe(20);
  });

  it('量到的间隔不够六个（去掉开头两个以后）：不评', () => {
    expect(glide(steady(GLIDE_SKIP_FRAMES + GLIDE_MIN_SAMPLES - 1, 20))).toBeNull();
    expect(glide(steady(GLIDE_SKIP_FRAMES + GLIDE_MIN_SAMPLES, 20))).toBe(20);
    // 九百毫秒的“回到这一节”，一秒只画得出八帧的设备：只量到五个，不评
    expect(glide(steady(7, 125))).toBeNull();
    expect(glide([])).toBeNull();
    expect(createGlideMeter().end(true)).toBeNull();
  });

  it('被打断的：不评', () => {
    expect(glide(steady(60, 200), { complete: false })).toBeNull();
  });

  it('中间有哪一帧页面不在前台：不评（开头、中间、最后一帧都算）', () => {
    for (const hiddenAt of [0, 1, 30, 60]) expect(glide(steady(60, 100), { hiddenAt }), `第 ${hiddenAt} 帧`).toBeNull();
    expect(glide(steady(60, 100))).toBe(100);
  });

  it('量完一次从头来：同一个接着量下一次，上一次的帧、两次之间隔的时间、“不在前台”都不带过去', () => {
    const meter = createGlideMeter();
    expect(glide(steady(20, 200), { meter, hiddenAt: 3 })).toBeNull();
    // 隔了很久才有下一次滑动
    expect(glide(steady(20, 18), { meter, startMs: 500_000 })).toBe(18);
    expect(glide(steady(20, 30), { meter, startMs: 900_000, complete: false })).toBeNull();
    expect(glide(steady(20, 25), { meter, startMs: 950_000 })).toBe(25);
    // 上一次的最后一帧到这一次的第一帧不算一个间隔：这一次只量到五个，还是不评
    expect(glide(steady(GLIDE_SKIP_FRAMES + GLIDE_MIN_SAMPLES - 1, 20), { meter, startMs: 990_000 })).toBeNull();
  });

  it('前一半做的时候在这台机器上录到的那一趟（66 帧，中间卡了三下）：居中的是 22 毫秒，算正常', () => {
    const intervals = [883, 350, ...steady(30, 22), 117, ...steady(32, 22)];
    expect(intervals).toHaveLength(65);
    const median = glide(intervals);
    expect(median).toBe(22);
    expect(createTierMemory().reportGlide('full', median as number, 'auto')).toBe('keep');
  });

  it('middle：居中的数；不改交进来的那一串；一个数也没有是 NaN', () => {
    const values = [3, 1, 2];
    expect(middle(values)).toBe(2);
    expect(values).toEqual([3, 1, 2]);
    expect(middle([5])).toBe(5);
    expect(middle([1, 2, 3, 4])).toBe(2.5);
    // 试画三帧取居中：一次停顿不算数
    expect(middle([12, 480, 14])).toBe(14);
    expect(middle([])).toBeNaN();
  });
});

describe('评快慢的这一套只是算数，记性只在这一次访问里', () => {
  const source = (path: string): string => new TextDecoder().decode(readBytes(path));
  /** 去掉注释再查（注释里可以提到这些名字）。 */
  const code = (path: string): string =>
    source(path)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it('tier.ts 和 quality.ts 不碰 three，不碰页面，也不自己看钟点（钟点是外面给的）', () => {
    for (const path of ['src/stage/three/tier.ts', 'src/stage/three/quality.ts']) {
      const text = code(path);
      const imports = [...text.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
      expect(imports.sort(), path).toEqual(path.endsWith('tier.ts') ? ['../types'] : ['../types', './internal']);
      // 引入的都只是类型
      expect(text, path).not.toMatch(/^import\s+(?!type\b)/m);
      expect(text, path).not.toMatch(/\b(document|window|navigator|performance|requestAnimationFrame|setTimeout|Date)\b/);
    }
  });

  it('什么也不往浏览器里存：刷新页面就是从头来', () => {
    for (const path of ['src/stage/three/tier.ts', 'src/stage/three/quality.ts', 'src/stage/three/host.ts', 'src/stage/three/engine.ts', 'src/stage/support.ts']) {
      expect(code(path), path).not.toMatch(/localStorage|sessionStorage|indexedDB|cookie/);
    }
  });
});

// 第一次取沙盘程序要把 three 和零件库都加载进来，机器忙的时候慢：时限放宽
describe('沙盘程序答“能不能画”（engine.support）', { timeout: 30_000 }, () => {
  // 这一组才用到沙盘程序（它带着 view.ts 和零件库）：现用现取，免得上面那些只算数的测试被别的文件牵连
  const load = (): Promise<typeof import('../../src/stage/three/engine')> => import('../../src/stage/three/engine');

  /** 画布和渲染器都是空壳。 */
  const parts = (): HostParts<HTMLElement, HTMLCanvasElement, WebGLRenderer> => ({
    createCanvas: () => ({}) as HTMLCanvasElement,
    createRenderer: () => ({ setPixelRatio() {}, setSize() {}, clear() {} }) as unknown as WebGLRenderer,
    attach() {},
    detach() {},
    onContextLost: () => () => {},
    disposeRenderer() {},
  });
  /** 假的“问浏览器”：记下问了几次。 */
  function probe(answer: { webgl2: boolean; caveat: boolean }): { ask(): { webgl2: boolean; caveat: boolean }; asked(): number } {
    let count = 0;
    return {
      ask: () => {
        count += 1;
        return answer;
      },
      asked: () => count,
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('浏览器不支持 WebGL2：no-webgl2', async () => {
    const { createEngine } = await load();
    const { engine } = createEngine(parts(), probe({ webgl2: false, caveat: false }).ask);
    expect(engine.support()).toEqual({ ok: false, reason: 'no-webgl2' });
    expect(engine.support()).toEqual({ ok: false, reason: 'no-webgl2' });
  });

  it('能画：ok，上限还是完整的一档', async () => {
    const { createEngine } = await load();
    const { engine, host } = createEngine(parts(), probe({ webgl2: true, caveat: false }).ask);
    expect(engine.support()).toEqual({ ok: true });
    expect(host.tiers.ceiling()).toBe('full');
  });

  it('只能用软件画：照样 ok，这一次访问的上限压到减配', async () => {
    const { createEngine } = await load();
    const { engine, host } = createEngine(parts(), probe({ webgl2: true, caveat: true }).ask);
    expect(host.tiers.ceiling()).toBe('full');
    expect(engine.support()).toEqual({ ok: true });
    expect(host.tiers.ceiling()).toBe('reduced');
    expect(chooseTier(host.tiers, {})).toEqual({ tier: 'reduced', mode: 'auto' });
  });

  it('上限降到减配还是 ok；降到“只放图片”以后答 too-slow，一直到这一次访问结束', async () => {
    const { createEngine } = await load();
    const { engine, host } = createEngine(parts(), probe({ webgl2: true, caveat: false }).ask);
    expect(engine.support()).toEqual({ ok: true });

    // 完整的一档试画慢了
    expect(host.tiers.reportTrial('full', 60, 'auto')).toBe('down');
    expect(engine.support()).toEqual({ ok: true });

    // 减配的一档也慢
    expect(host.tiers.reportTrial('reduced', 60, 'auto')).toBe('down');
    expect(host.tiers.ceiling()).toBe('still');
    expect(engine.support()).toEqual({ ok: false, reason: 'too-slow' });

    // 后来再报多快都没用
    host.tiers.reportTrial('reduced', 1, 'asked');
    host.tiers.reportGlide('reduced', 1, 'auto');
    expect(engine.support()).toEqual({ ok: false, reason: 'too-slow' });
  });

  it('读者自己要的沙盘慢得没法用：答 too-slow', async () => {
    const { createEngine } = await load();
    const { engine, host } = createEngine(parts(), probe({ webgl2: true, caveat: false }).ask);
    expect(host.tiers.reportGlide('reduced', GLIDE_STALLED_MS + 1, 'asked')).toBe('down');
    expect(engine.support()).toEqual({ ok: false, reason: 'too-slow' });
  });

  it('不支持 WebGL2 的，上限到了“只放图片”说的也还是 no-webgl2', async () => {
    const { createEngine } = await load();
    const { engine, host } = createEngine(parts(), probe({ webgl2: false, caveat: false }).ask);
    host.tiers.reportTrial('full', 5000, 'auto');
    expect(engine.support()).toEqual({ ok: false, reason: 'no-webgl2' });
  });

  it('两个沙盘程序各有各的记性；同一个里只有一份', async () => {
    const { createEngine } = await load();
    const a = createEngine(parts(), probe({ webgl2: true, caveat: false }).ask);
    const b = createEngine(parts(), probe({ webgl2: true, caveat: false }).ask);
    a.host.tiers.reportTrial('full', 5000, 'auto');
    expect(a.engine.support()).toEqual({ ok: false, reason: 'too-slow' });
    expect(b.engine.support()).toEqual({ ok: true });
    expect(a.host.tiers).toBe(a.host.tiers);
  });

  it('没先问 support 就来摆：摆之前也问一次浏览器，只能用软件画的照样把上限压到减配', async () => {
    vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 0));
    vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
    vi.stubGlobal('window', { devicePixelRatio: 1 });
    vi.stubGlobal('fetch', () => new Promise(() => {}));

    const { createEngine } = await load();
    const asking = probe({ webgl2: true, caveat: true });
    const { engine, host } = createEngine(parts(), asking.ask);
    const pane = { clientWidth: 880, clientHeight: 900 } as HTMLElement;
    const table: StopTable = { kind: 'stop', key: 'test/sample-town', scene: fixtureScene(), terrainUrl: 'sample-town.terrain.bin' };
    const options: StageOptions = { namesMode: 'ancient', reducedMotion: false };

    const view = engine.create(pane, table, options);
    expect(asking.asked()).toBe(1);
    expect(host.tiers.ceiling()).toBe('reduced');
    // 马上关掉：这里只查摆之前的那一步
    view.destroy();
    await view.ready;
    // 等约好的几帧跑完，再把假的 requestAnimationFrame 拿走
    await new Promise((resolve) => setTimeout(resolve, 30));
  });

  it('正式用的那一个：名字和版本；在 Node 里（没有页面）问它，答的是 no-webgl2，不出错', async () => {
    const { engine } = await load();
    expect(engine.name).toBe('three.js');
    expect(engine.version).toMatch(/^r\d+$/);
    expect(engine.support()).toEqual({ ok: false, reason: 'no-webgl2' });
  });
});

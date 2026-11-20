// 挑哪一档画质、什么时候往下降。全是算数：不碰 three，不碰页面，钟点由外面传进来，在 Node 里也能跑
// （tests/stage/tier.test.ts）。
// 一次访问里只有一份记性（TierMemory）：它跟着画布主人（host.ts 的 StageHost.tiers），画布主人在 engine.ts 里
// 整个访问期间只有一个，所以每一座沙盘拿到的都是同一份。刷新页面就是从头来，什么也不往浏览器里存。
//
// 规矩：
//   只降不升。记性里没有把上限调高的办法；读者自己点“试试立体的沙盘”不改上限，那一座沙盘按 asked 来评。
//   指定了画质的沙盘（forced）报什么都不评，也不记。自动测试和拍图片的工具都指定画质，所以它们不受机器快慢的影响。
//   程序自己挑的沙盘（auto）只有上限还停在它那一档时才能把上限降一步：已经被嫌慢的那一座再报多少次，也降不了第二次。
//   每一档只认一次试画：过了关，这一次访问里同一档再报试画就不再评（往后看滑动）。
//   下面的线都是“超过才算”，正好等于不算。

import type { StageTier } from '../types';

/** 这一次访问最高能用到哪一档。still 是连减配也带不动，只放图片。 */
export type Ceiling = StageTier | 'still';
/** 怎么评：forced 是指定了画质，从不评；asked 是读者自己要的，只看“没法用”的两条线；auto 是程序自己挑的。 */
export type TierMode = 'forced' | 'asked' | 'auto';

// 下面这些数都还没有在平板和手机上量过。
/** 试画连着画几帧，取居中的一次。 */
export const TRIAL_FRAMES = 3;
/**
 * 沙盘栏不到这么大（CSS 像素的面积）就先不试画：太小的一块说明不了真的画面。
 * 展开着的沙盘栏再小也有 600 × 176 = 105,600（平板最窄 600 像素，栏最矮 11rem），比这条线大。
 */
export const TRIAL_MIN_AREA = 80_000;
/**
 * 沙盘栏不到这么高（CSS 像素）也先不试画，不管它多宽：上下排的版面上收起来的那一条只有 59 像素高，里面没有画面可看。
 * 那一条和窗口一样宽，而竖着的窗口多宽都是上下排（竖着拿的大平板 1024、1032，竖起来的显示器 1400 以上），
 * 所以只看面积拦不住它：1400 × 59 = 82,600，已经过了上面那条线。展开着的沙盘栏最矮 176 像素（11rem）。这条线划在两者中间。
 */
export const TRIAL_MIN_HEIGHT = 100;
/** 试画一帧超过这么多毫秒算慢：降一档。 */
export const TRIAL_SLOW_MS = 50;
/** 试画一帧超过这么多毫秒算没法用：直接只放图片。 */
export const TRIAL_HOPELESS_MS = 200;
/** 一次滑动开头的这几个间隔不算（换灯、画影子、换模型都落在这里）。 */
export const GLIDE_SKIP_FRAMES = 2;
/** 一次滑动至少要量到这么多个间隔才评。 */
export const GLIDE_MIN_SAMPLES = 6;
/** 滑动时相邻两帧隔这么多毫秒以上算慢。 */
export const GLIDE_SLOW_MS = 42;
/** 隔这么多毫秒以上算卡住了：马上降。 */
export const GLIDE_STALLED_MS = 125;
/** 连着几次慢的滑动才降一档。 */
export const SLOW_GLIDES_TO_STEP_DOWN = 2;

/** 这么大的沙盘栏够不够试画：不矮于 TRIAL_MIN_HEIGHT，面积不小于 TRIAL_MIN_AREA。宽、高是 CSS 像素。 */
export function bigEnoughToTry(width: number, height: number): boolean {
  return height >= TRIAL_MIN_HEIGHT && width * height >= TRIAL_MIN_AREA;
}

/** 档位的高低，用来比。 */
const RANK: Record<Ceiling, number> = { still: 0, reduced: 1, full: 2 };
/** 往下一步是哪一档。 */
const BELOW: Record<StageTier, Ceiling> = { full: 'reduced', reduced: 'still' };

/** 一串数里居中的那一个（个数是双数时取中间两个的平均）。一个数也没有时是 NaN。 */
export function middle(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const half = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
}

export interface TierMemory {
  ceiling(): Ceiling;
  /** 浏览器自己说“只能用软件画”：这一次访问最高只到减配。 */
  noteCaveat(): void;
  /** 报告一次试画（毫秒）。down：这座沙盘不用了，页面会收到 onSlow。 */
  reportTrial(tier: StageTier, ms: number, mode: TierMode): 'keep' | 'down';
  /** 报告一次完整的滑动（相邻两帧间隔的居中数，毫秒）。 */
  reportGlide(tier: StageTier, medianMs: number, mode: TierMode): 'keep' | 'down';
}

export function createTierMemory(): TierMemory {
  let ceiling: Ceiling = 'full';
  /** 试画过了关的档。auto：过了“慢”的那条线；asked：只过了“没法用”的那条线。 */
  const passed: Record<'auto' | 'asked', Set<StageTier>> = { auto: new Set(), asked: new Set() };
  /** 连着几次慢的滑动。 */
  let slowGlides = 0;

  /** 上限只往下走。真的降了，慢滑动的次数从头数：那是上一档的账。 */
  const lower = (to: Ceiling): void => {
    if (RANK[to] >= RANK[ceiling]) return;
    ceiling = to;
    slowGlides = 0;
  };
  /** 这座沙盘的档已经在上限上面：上限降过了（多半就是它自己报的），它不该再留着，也不能再把上限往下带。 */
  const above = (tier: StageTier): boolean => RANK[tier] > RANK[ceiling];
  /** 量出来的不是个正经的数：不评。 */
  const unusable = (ms: number): boolean => !Number.isFinite(ms) || ms < 0;

  return {
    ceiling: () => ceiling,
    noteCaveat: () => lower('reduced'),

    reportTrial(tier, ms, mode) {
      if (mode === 'forced' || unusable(ms)) return 'keep';
      if (mode === 'asked') {
        // 读者自己要的：只看“没法用”的那条线，过了就不再因为试画嫌它慢
        if (passed.asked.has(tier) || passed.auto.has(tier)) return 'keep';
        if (ms > TRIAL_HOPELESS_MS) {
          lower('still');
          return 'down';
        }
        passed.asked.add(tier);
        return 'keep';
      }
      if (above(tier)) return 'down';
      if (passed.auto.has(tier)) return 'keep';
      if (ms > TRIAL_HOPELESS_MS) {
        // 慢到这个地步，低一档也救不回来：不让读者再等一次重摆
        lower('still');
        return 'down';
      }
      if (ms > TRIAL_SLOW_MS) {
        lower(BELOW[tier]);
        return 'down';
      }
      passed.auto.add(tier);
      return 'keep';
    },

    reportGlide(tier, medianMs, mode) {
      if (mode === 'forced' || unusable(medianMs)) return 'keep';
      if (mode === 'asked') {
        if (medianMs <= GLIDE_STALLED_MS) return 'keep';
        lower('still');
        return 'down';
      }
      if (above(tier)) return 'down';
      if (medianMs > GLIDE_STALLED_MS) {
        lower(BELOW[tier]);
        return 'down';
      }
      if (medianMs <= GLIDE_SLOW_MS) {
        slowGlides = 0;
        return 'keep';
      }
      // 一次慢的滑动可能只是碰巧（别的页面在忙）：连着几次才降
      slowGlides += 1;
      if (slowGlides < SLOW_GLIDES_TO_STEP_DOWN) return 'keep';
      lower(BELOW[tier]);
      return 'down';
    },
  };
}

/** 这座沙盘照哪一档摆、怎么评。ceiling 已经是 still 而又没有指定画质时返回 null（engine.support() 这时回答 too-slow）。 */
export function chooseTier(memory: TierMemory, options: { tier?: StageTier; asked?: boolean }): { tier: StageTier; mode: TierMode } | null {
  // asked 只和 tier 一起才算数；单写 asked 当作没写
  if (options.tier) return { tier: options.tier, mode: options.asked ? 'asked' : 'forced' };
  const ceiling = memory.ceiling();
  return ceiling === 'still' ? null : { tier: ceiling, mode: 'auto' };
}

export interface GlideMeter {
  frame(nowMs: number, pageVisible: boolean): void;
  /** complete 是 false（被打断）时返回 null。 */
  end(complete: boolean): number | null;
}

/**
 * 量一次滑动：每画一帧叫一次 frame，滑完叫 end。end 给的是相邻两帧间隔的居中数（毫秒）；
 * 这一次不该评的时候给 null：被打断了，量到的间隔太少，或者中间有哪一帧页面不在前台
 * （页面在后台时浏览器不给动画帧，隔 100 毫秒才画一次，看上去像慢，其实不是）。
 * end 以后从头量，同一个可以接着量下一次滑动。
 */
export function createGlideMeter(): GlideMeter {
  let last: number | null = null;
  let intervals: number[] = [];
  let hidden = false;
  return {
    frame(nowMs, pageVisible) {
      if (!pageVisible) hidden = true;
      if (last !== null) intervals.push(Math.max(0, nowMs - last));
      last = nowMs;
    },
    end(complete) {
      const counted = intervals.slice(GLIDE_SKIP_FRAMES);
      const judged = complete && !hidden && counted.length >= GLIDE_MIN_SAMPLES;
      last = null;
      intervals = [];
      hidden = false;
      return judged ? middle(counted) : null;
    },
  };
}

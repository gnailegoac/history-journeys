// 换小节的先后：新的指令顶掉旧的，镜头、水位和云气缓缓地滑过去。
// 这里只管“什么时候做什么”，真正摆镜头、画画面的是 view.ts 交进来的 driver；时钟也是交进来的，
// 所以不碰 three 和页面，在 Node 里也能跑（tests/stage/sequencer.test.ts）。
//
// 规矩（和 src/stage/types.ts 里写给页面的一样）：
//   新的 show、reset 开始时，旧的那一次被放弃；被放弃的那一次照常完成，不拒绝。
//   只有两种情况拒绝：小节标题在场景里没有；沙盘已经关掉。
//   第一个画面好之前（start() 之前）叫的 show 先记下来，到时候直接摆到位，不滑。
//   用户设置了“减少动态效果”，或者 show 写了不滑：直接摆到位。

import type { Vec3 } from '../ground/types';

/** 换小节时要滑过去的几样。 */
export interface TableState {
  /** 镜头在哪、对准哪、视角多少度。 */
  position: Vec3;
  target: Vec3;
  fov: number;
  /** 水位：海拔，米。 */
  levelM: number;
  /** 水的颜色偏向大水多少：0 是平时，1 是最高的水位。 */
  flood: number;
  /** 山脚的云气浓淡。 */
  mist: number;
}

/** 缓动：起步和到站都慢，中间快。k 和结果都在 0 到 1 之间。 */
export function ease(k: number): number {
  const t = k < 0 ? 0 : k > 1 ? 1 : k;
  return t * t * (3 - 2 * t);
}

const mix = (a: number, b: number, e: number): number => a + (b - a) * e;
const mix3 = (a: Vec3, b: Vec3, e: number): Vec3 => [mix(a[0], b[0], e), mix(a[1], b[1], e), mix(a[2], b[2], e)];

/** 从 a 滑到 b，走到 e（0 到 1，已经缓动过）时的样子。 */
export function mixState(a: TableState, b: TableState, e: number): TableState {
  return {
    position: mix3(a.position, b.position, e),
    target: mix3(a.target, b.target, e),
    fov: mix(a.fov, b.fov, e),
    levelM: mix(a.levelM, b.levelM, e),
    flood: mix(a.flood, b.flood, e),
    mist: mix(a.mist, b.mist, e),
  };
}

/** 一趟滑动：多长时间，每一帧怎么画。 */
export interface Glide {
  durationMs: number;
  /** e 是 0 到 1，已经缓动过。 */
  frame(e: number): void;
}

/** 真正干活的一边（view.ts）。 */
export interface SequencerDriver {
  /** 直接摆成这一小节的样子，并画出来。 */
  place(heading: string): void;
  /**
   * 准备滑到这一小节：返回这一趟怎么滑。why 是 'section'（换小节）或 'reset'（回到这一节摆好的位置）。
   * 返回 null 是不用滑，直接摆到位。
   */
  glide(heading: string, why: 'section' | 'reset'): Glide | null;
  /** 画面稳定以后完成：浏览器把刚摆好的画面画出来了。 */
  settled(): Promise<void>;
}

/** 时钟。nextFrame 约好下一帧调用 run，返回一个取消的函数。 */
export interface SequencerClock {
  now(): number;
  nextFrame(run: () => void): () => void;
}

/** 一次指令。被顶掉时 cancelled 变成 true，等着它的地方照常完成。 */
interface Operation {
  cancelled: boolean;
  /** 正在滑（还没到位）。 */
  gliding: boolean;
  cancelFrame: (() => void) | null;
  done: Promise<void>;
  finish: () => void;
}

export class Sequencer {
  private readonly headings: string[];
  private readonly driver: SequencerDriver;
  private readonly clock: SequencerClock;
  private readonly reducedMotion: boolean;

  private heading: string;
  private isStarted = false;
  private destroyed = false;
  private operation: Operation | null = null;

  /** headings 是场景里全部小节的标题；first 是一开始摆哪一节。 */
  constructor(headings: string[], first: string, driver: SequencerDriver, clock: SequencerClock, reducedMotion: boolean) {
    this.headings = headings;
    this.heading = first;
    this.driver = driver;
    this.clock = clock;
    this.reducedMotion = reducedMotion;
  }

  /** 现在要摆的是哪一小节（最新一次指令说的）。 */
  get section(): string {
    return this.heading;
  }

  /** 第一个画面摆过了没有。 */
  get started(): boolean {
    return this.isStarted;
  }

  /** 镜头是不是正在滑。 */
  get gliding(): boolean {
    return this.operation?.gliding ?? false;
  }

  /**
   * 沙盘造好了，可以摆第一个画面：把现在要摆的那一节直接摆到位。
   * 之前叫过的 show 在这里一起完成。返回的 Promise 在画面稳定以后完成。
   */
  start(): Promise<void> {
    if (this.destroyed || this.isStarted) return Promise.resolve();
    this.isStarted = true;
    const operation = this.operation ?? this.begin();
    void this.arrive(operation, this.heading);
    return operation.done;
  }

  /** 去某一小节。animate 是 false 时直接摆到位。 */
  show(heading: string, animate = true): Promise<void> {
    if (this.destroyed) return Promise.reject(new Error('沙盘已经关掉了'));
    if (!this.headings.includes(heading)) return Promise.reject(new RangeError(`场景里没有这个小节：${heading}`));
    this.heading = heading;
    return this.run(heading, animate, 'section');
  }

  /** 回到这一小节摆好的位置。 */
  reset(): Promise<void> {
    if (this.destroyed) return Promise.reject(new Error('沙盘已经关掉了'));
    // 第一个画面还没摆：没有可回的地方，到时候自然会摆到位
    if (!this.isStarted) return Promise.resolve();
    return this.run(this.heading, true, 'reset');
  }

  /**
   * 读者自己动了镜头：正在滑就停在半路，等着那一次的地方照常完成。
   * 返回是不是真的打断了一趟滑动。
   */
  interrupt(): boolean {
    if (!this.operation?.gliding) return false;
    this.cancel();
    return true;
  }

  /** 关掉：没做完的照常完成，以后的 show、reset 一律拒绝。可以重复调用。 */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancel();
  }

  private run(heading: string, animate: boolean, why: 'section' | 'reset'): Promise<void> {
    const operation = this.begin();
    // 第一个画面还没摆：只记下来，start() 会把它直接摆到位
    if (!this.isStarted) return operation.done;

    let glide: Glide | null = null;
    if (animate && !this.reducedMotion) {
      try {
        glide = this.driver.glide(heading, why);
      } catch (error) {
        console.warn('[沙盘] 镜头没能滑过去，直接摆到位', error);
      }
    }
    if (!glide) {
      void this.arrive(operation, heading);
      return operation.done;
    }

    const plan = glide;
    const startedAt = this.clock.now();
    operation.gliding = true;
    const step = (): void => {
      operation.cancelFrame = null;
      if (operation.cancelled) return;
      const k = plan.durationMs > 0 ? Math.min(1, (this.clock.now() - startedAt) / plan.durationMs) : 1;
      try {
        plan.frame(ease(k));
      } catch (error) {
        console.warn('[沙盘] 镜头滑到一半出错，直接摆到位', error);
        operation.gliding = false;
        void this.arrive(operation, heading);
        return;
      }
      if (k < 1) {
        operation.cancelFrame = this.clock.nextFrame(step);
      } else {
        operation.gliding = false;
        void this.arrive(operation, heading);
      }
    };
    operation.cancelFrame = this.clock.nextFrame(step);
    return operation.done;
  }

  /** 摆到位，等画面稳定，然后算完成。 */
  private async arrive(operation: Operation, heading: string): Promise<void> {
    if (operation.cancelled) return;
    try {
      this.driver.place(heading);
      await this.driver.settled();
    } catch (error) {
      console.warn('[沙盘] 这一小节没能摆出来', error);
    }
    if (this.operation === operation) this.operation = null;
    operation.finish();
  }

  private begin(): Operation {
    this.cancel();
    let finish: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const operation: Operation = { cancelled: false, gliding: false, cancelFrame: null, done, finish };
    this.operation = operation;
    return operation;
  }

  private cancel(): void {
    const operation = this.operation;
    if (!operation) return;
    this.operation = null;
    operation.cancelled = true;
    operation.gliding = false;
    operation.cancelFrame?.();
    operation.cancelFrame = null;
    operation.finish();
  }
}

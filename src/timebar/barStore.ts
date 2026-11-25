// 时间轴记着的几样：圆钮停在第几天、读者动没动过它、是不是停着、是不是正在播放。
// 一座全程沙盘（一位人物）一份，记在这一段程序里、组件外面：换了一页、沙盘栏换成一站自己的沙盘，这一条拿走了，
// 再回到人物页，日子还在。只记到这一次访问结束，不存到别处，也从不写进地址。

/** 时间轴这一刻的样子。 */
export interface BarSnapshot {
  /** 圆钮停在第几天（从出生那天数起，可以带小数）。 */
  day: number;
  /** 读者动过时间轴（拖过、按过、用键盘走过、播放过）。没动过的，时间轴不向沙盘栏报要看哪一节。 */
  used: boolean;
  /** 停着：没有在拖、没有在连着按键、没有在播放。停着的时候，小像在路上题签也让开他。 */
  rest: boolean;
  /** 正在播放。 */
  playing: boolean;
}

export interface BarStore {
  get(): BarSnapshot;
  /** 改几样；真的变了才通知。 */
  set(next: Partial<BarSnapshot>): void;
  /** 变了的时候叫 listener；返回的函数是不再听。 */
  subscribe(listener: () => void): () => void;
}

const stores = new Map<string, BarStore>();

/** 这座全程沙盘（key 是“人物/route”）的那一份。头一回要的时候造出来：停在出生的那一天，没动过，停着。 */
export function barStore(key: string): BarStore {
  let store = stores.get(key);
  if (!store) {
    let now: BarSnapshot = { day: 0, used: false, rest: true, playing: false };
    const listeners = new Set<() => void>();
    store = {
      get: () => now,
      set: (next) => {
        const merged = { ...now, ...next };
        if (merged.day === now.day && merged.used === now.used && merged.rest === now.rest && merged.playing === now.playing) return;
        now = merged;
        [...listeners].forEach((listener) => listener());
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    };
    stores.set(key, store);
  }
  return store;
}

// 人物数据里和轨迹有关的纯逻辑。

import type { Figure, StopMeta } from './types';

/** 某一站的上一站和下一站；没有时为 null。 */
export function neighbours(figure: Figure, stopId: string): { index: number; prev: StopMeta | null; next: StopMeta | null } {
  const index = figure.stops.findIndex((s) => s.id === stopId);
  if (index < 0) return { index, prev: null, next: null };
  return { index, prev: figure.stops[index - 1] ?? null, next: figure.stops[index + 1] ?? null };
}

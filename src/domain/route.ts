// 人物数据里和轨迹有关的纯逻辑。

import type { MapRoute } from '../map/types';
import type { Figure, LngLat, StopMeta } from './types';

/** 把一位人物的数据整理成地图适配层要的形状。 */
export function toMapRoute(figure: Figure): MapRoute {
  const byId = new Map(figure.stops.map((s) => [s.id, s]));
  return {
    overview: figure.overview,
    stops: figure.stops.map((s, i) => ({
      id: s.id,
      order: i + 1,
      ancient: s.place.ancient,
      modern: s.place.modern,
      lngLat: s.place.lngLat,
      camera: s.camera,
    })),
    legs: figure.legs.map((leg) => {
      const from = byId.get(leg.from);
      const to = byId.get(leg.to);
      const path: LngLat[] = [];
      if (from) path.push(from.place.lngLat);
      for (const v of leg.via) path.push(v.lngLat);
      if (to) path.push(to.place.lngLat);
      return { from: leg.from, to: leg.to, path };
    }),
    places: figure.stops.flatMap((s) =>
      s.localPlaces.map((p) => ({ id: `${s.id}/${p.id}`, stopId: s.id, ancient: p.ancient, modern: p.modern, lngLat: p.lngLat })),
    ),
  };
}

/** 某一站的上一站和下一站；没有时为 null。 */
export function neighbours(figure: Figure, stopId: string): { index: number; prev: StopMeta | null; next: StopMeta | null } {
  const index = figure.stops.findIndex((s) => s.id === stopId);
  if (index < 0) return { index, prev: null, next: null };
  return { index, prev: figure.stops[index - 1] ?? null, next: figure.stops[index + 1] ?? null };
}

// 把轨迹数据变成地图上的线、序号圆点和地名。

import type { FeatureCollection, Feature, Point } from 'geojson';
import type { MapRoute, MapStop } from '../types';

/** 同一个地点有几站时，序号圆点并排，相邻两个的间距（像素）。 */
const DOT_SPACING = 26;

export function routeFeatures(route: MapRoute): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: route.legs
      .filter((leg) => leg.path.length >= 2)
      .map((leg) => ({
        type: 'Feature',
        properties: { from: leg.from, to: leg.to },
        geometry: { type: 'LineString', coordinates: leg.path },
      })),
  };
}

const point = (lngLat: [number, number], properties: Record<string, string | number>): Feature<Point> => ({
  type: 'Feature',
  properties,
  geometry: { type: 'Point', coordinates: lngLat },
});

/** 不重复的名字用顿号连起来（同一个地点的几站通常同名）。 */
const joinNames = (names: string[]) => [...new Set(names)].join('、');

export interface StopFeatures {
  /** 每站一个序号圆点。 */
  dots: FeatureCollection;
  /** 每个地点一个站名（苏轼两次到杭州，站名只写一次）。 */
  labels: FeatureCollection;
  /** 用到的横向偏移值（像素，不含 0）。 */
  offsets: number[];
}

/** 坐标相同的几站算同一个地点：共用一个站名，序号圆点并排。 */
export const spotKey = (stop: MapStop) => stop.lngLat.join(',');

export function stopFeatures(route: MapRoute): StopFeatures {
  const groups = new Map<string, MapStop[]>();
  for (const stop of route.stops) {
    const key = spotKey(stop);
    const group = groups.get(key);
    if (group) group.push(stop);
    else groups.set(key, [stop]);
  }
  const dots: Feature<Point>[] = [];
  const labels: Feature<Point>[] = [];
  const offsets = new Set<number>();
  for (const group of groups.values()) {
    group.forEach((stop, i) => {
      const dx = Math.round((i - (group.length - 1) / 2) * DOT_SPACING);
      if (dx !== 0) offsets.add(dx);
      dots.push(point(stop.lngLat, { id: stop.id, dx, icon: stopIconName(stop.order, false), iconOn: stopIconName(stop.order, true) }));
    });
    labels.push(
      point(group[0].lngLat, {
        id: group[0].id,
        ancient: joinNames(group.map((s) => s.ancient)),
        modern: joinNames(group.map((s) => s.modern)),
      }),
    );
  }
  return {
    dots: { type: 'FeatureCollection', features: dots },
    labels: { type: 'FeatureCollection', features: labels },
    offsets: [...offsets],
  };
}

export function placeFeatures(route: MapRoute): FeatureCollection {
  const stopPoints = new Set(route.stops.map((s) => s.lngLat.join(',')));
  return {
    type: 'FeatureCollection',
    features: route.places.map((p) =>
      // atStop：这个地点和某一站是同一个点（如“黄州城”），地名要绕开站点的圆点
      point(p.lngLat, { id: p.id, stopId: p.stopId, ancient: p.ancient, modern: p.modern, atStop: stopPoints.has(p.lngLat.join(',')) ? 1 : 0 }),
    ),
  };
}

export const stopIconName = (order: number, current: boolean) => `stop-${order}${current ? '-on' : ''}`;

/** 画一个带序号的圆点。current 为 true 时是当前这一站：大一号，颜色深一些。 */
export function drawStopIcon(order: number, current: boolean, pixelRatio: number): ImageData | null {
  const size = current ? 30 : 24;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.round(size * pixelRatio);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(canvas.width / size, canvas.width / size);
  const c = size / 2;
  ctx.beginPath();
  ctx.arc(c, c, c - 1, 0, 2 * Math.PI);
  ctx.fillStyle = '#fffaf0';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(c, c, c - 3, 0, 2 * Math.PI);
  ctx.fillStyle = current ? '#8a2413' : '#b3321c';
  ctx.fill();
  const text = String(order);
  const fontSize = (current ? 15 : 13) - (text.length > 1 ? 2 : 0);
  ctx.font = `bold ${fontSize}px system-ui, "Segoe UI", "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  // 数字没有下伸部分，按字高的 0.36 倍下移就大致居中
  ctx.fillText(text, c, c + fontSize * 0.36);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

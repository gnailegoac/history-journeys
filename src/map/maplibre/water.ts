// 详细水体（江、河、湖、海岸）的瓦片地址。地址里带日期，要在运行时从 TileJSON 里读。

import type { OsmWater } from './style';

/** OpenFreeMap 的公共实例：免注册、无密钥，要求署名。 */
const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
const ATTRIBUTION =
  '水系：<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> ' +
  '数据来自 <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap 贡献者</a>';
const TIMEOUT_MS = 8000;

let pending: Promise<OsmWater | null> | null = null;

/** 取瓦片地址；取不到时为 null（下一张地图会再试一次）。同一个页面里只取一次。 */
export function loadOsmWater(): Promise<OsmWater | null> {
  pending ??= fetchTileJson().catch(() => {
    pending = null;
    return null;
  });
  return pending;
}

async function fetchTileJson(): Promise<OsmWater> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(TILEJSON_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json: unknown = await response.json();
    const tiles = (json as { tiles?: unknown }).tiles;
    if (!Array.isArray(tiles) || tiles.length === 0 || !tiles.every((t) => typeof t === 'string')) {
      throw new Error('TileJSON 里没有瓦片地址');
    }
    return { tiles: tiles as string[], attribution: ATTRIBUTION };
  } finally {
    clearTimeout(timer);
  }
}

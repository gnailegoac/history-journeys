// One open data source feeds both the terrain mesh and the base map:
// AWS Open Data "Terrain Tiles" in Terrarium encoding (no account, no key).
import {
  Credit,
  CustomHeightmapTerrainProvider,
  UrlTemplateImageryProvider,
  WebMercatorTilingScheme,
} from "cesium";

const TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const CREDIT =
  "地形：Terrain Tiles (AWS Open Data / Mapzen)，含 SRTM、GMTED2010、ETOPO1 等公有领域数据";
export const DEM_MAX_LEVEL = 13; // about 17 m per pixel at 30°N; SRTM itself is about 30 m
const TILE = 256;
const CACHE_LIMIT = 200; // decoded tiles kept (about 260 KB each)
const MAX_ACTIVE_FETCHES = 12;

const cache = new Map<string, Promise<Float32Array>>();
let activeFetches = 0;
const scratch = new OffscreenCanvas(TILE, TILE).getContext("2d", { willReadFrequently: true })!;

/** Elevation in metres for one Terrarium tile, or undefined when too many downloads are running. */
function demTile(z: number, x: number, y: number): Promise<Float32Array> | undefined {
  const key = `${z}/${x}/${y}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key); // move to the end: most recently used
    cache.set(key, hit);
    return hit;
  }
  if (activeFetches >= MAX_ACTIVE_FETCHES) return undefined; // Cesium asks again later
  activeFetches++;
  const url = TERRARIUM_URL.replace("{z}", `${z}`).replace("{x}", `${x}`).replace("{y}", `${y}`);
  const promise = fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return response.blob();
    })
    .then((blob) => createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" }))
    .then((bitmap) => {
      scratch.drawImage(bitmap, 0, 0);
      bitmap.close();
      const rgba = scratch.getImageData(0, 0, TILE, TILE).data;
      const heights = new Float32Array(TILE * TILE);
      for (let i = 0; i < heights.length; i++) {
        heights[i] = rgba[i * 4] * 256 + rgba[i * 4 + 1] + rgba[i * 4 + 2] / 256 - 32768;
      }
      return heights;
    })
    .finally(() => activeFetches--);
  promise.catch(() => cache.delete(key));
  cache.set(key, promise);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return promise;
}

// ---------- terrain ----------

const GRID = 65; // heights per terrain tile edge

/**
 * Terrain tile (level L) = a 64-pixel window of the DEM tile two levels up, so the mesh and the
 * base map (which paints DEM tile L as a 256-pixel image) download the same files.
 */
function terrainHeights(x: number, y: number, level: number): Promise<Float32Array> | undefined {
  const shift = Math.max(Math.min(level, 2), level - DEM_MAX_LEVEL);
  const dem = demTile(level - shift, x >> shift, y >> shift);
  if (!dem) return undefined;
  const size = TILE / 2 ** shift; // window size in DEM pixels
  const mask = 2 ** shift - 1;
  const originX = (x & mask) * size;
  const originY = (y & mask) * size;
  return dem.then((heights) => {
    const out = new Float32Array(GRID * GRID);
    for (let row = 0; row < GRID; row++) {
      const py = clamp(originY + (row / (GRID - 1)) * size - 0.5, 0, TILE - 1);
      const y0 = Math.floor(py);
      const y1 = Math.min(y0 + 1, TILE - 1);
      const fy = py - y0;
      for (let col = 0; col < GRID; col++) {
        const px = clamp(originX + (col / (GRID - 1)) * size - 0.5, 0, TILE - 1);
        const x0 = Math.floor(px);
        const x1 = Math.min(x0 + 1, TILE - 1);
        const fx = px - x0;
        const top = heights[y0 * TILE + x0] * (1 - fx) + heights[y0 * TILE + x1] * fx;
        const bottom = heights[y1 * TILE + x0] * (1 - fx) + heights[y1 * TILE + x1] * fx;
        // Sea floor is flattened to sea level: the base map paints it as water.
        out[row * GRID + col] = Math.max(0, top * (1 - fy) + bottom * fy);
      }
    }
    return out;
  });
}

export function createTerrainProvider(): CustomHeightmapTerrainProvider {
  return new CustomHeightmapTerrainProvider({
    width: GRID,
    height: GRID,
    tilingScheme: new WebMercatorTilingScheme(),
    callback: terrainHeights,
    credit: new Credit(CREDIT),
  });
}

// ---------- base map: elevation tint + hillshade + water ----------

type Stop = [elevation: number, r: number, g: number, b: number];
const LAND: Stop[] = [
  [0, 168, 198, 152],
  [150, 196, 212, 164],
  [500, 224, 220, 172],
  [1200, 218, 194, 142],
  [2200, 194, 160, 116],
  [3200, 170, 134, 104],
  [4300, 186, 168, 156],
  [5200, 222, 216, 212],
  [6500, 255, 255, 255],
];
const SEA: Stop[] = [
  [-7000, 58, 104, 152],
  [-3000, 84, 138, 180],
  [-200, 124, 174, 204],
  [0, 150, 194, 216],
];
const FRESH_WATER = [134, 184, 210];

function ramp(stops: Stop[], h: number, out: number[]): void {
  let i = 1;
  while (i < stops.length - 1 && h > stops[i][0]) i++;
  const a = stops[i - 1];
  const b = stops[i];
  const t = clamp((h - a[0]) / (b[0] - a[0]), 0, 1);
  out[0] = a[1] + (b[1] - a[1]) * t;
  out[1] = a[2] + (b[2] - a[2]) * t;
  out[2] = a[3] + (b[3] - a[3]) * t;
}

const LEVEL_TOLERANCE = 0.25; // metres

/**
 * The DEM has no water mask. Its sources flatten lakes and wide rivers, so a patch that is level
 * (within 0.25 m) at 8 points one step away and 8 points two steps away is painted as water.
 * Narrow rivers (under roughly 300 m) are not found this way, and a dead-flat field can be mistaken for water.
 */
function isLevel(heights: Float32Array, row: number, col: number, reach: number): boolean {
  const h = heights[row * TILE + col];
  for (let step = reach; step <= reach * 2; step += reach) {
    const north = Math.max(row - step, 0) * TILE;
    const south = Math.min(row + step, TILE - 1) * TILE;
    const west = Math.max(col - step, 0);
    const east = Math.min(col + step, TILE - 1);
    const middle = row * TILE;
    for (const index of [north + west, north + col, north + east, middle + west, middle + east, south + west, south + col, south + east]) {
      if (Math.abs(heights[index] - h) > LEVEL_TOLERANCE) return false;
    }
  }
  return true;
}

function paintTile(heights: Float32Array, level: number, y: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = TILE;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(TILE, TILE);
  const data = image.data;
  // Ground size of a pixel at the tile centre, for slopes.
  const mercatorY = Math.PI * (1 - (2 * (y + 0.5)) / 2 ** level);
  const metresPerPixel = (40075016.7 * Math.cos(Math.atan(Math.sinh(mercatorY)))) / TILE / 2 ** level;
  // Low zoom levels average slopes away, so shading is strengthened there.
  const slopeGain = (1.8 * 2 ** (Math.max(0, 10 - level) * 0.6)) / (2 * metresPerPixel);
  // Water test reach: about 70 m on the ground, at least one pixel.
  const reach = clamp(Math.round(70 / metresPerPixel), 1, 4);
  const rgb = [0, 0, 0];
  for (let row = 0; row < TILE; row++) {
    const north = Math.max(row - 1, 0) * TILE;
    const south = Math.min(row + 1, TILE - 1) * TILE;
    for (let col = 0; col < TILE; col++) {
      const west = Math.max(col - 1, 0);
      const east = Math.min(col + 1, TILE - 1);
      const h = heights[row * TILE + col];
      const dEast = heights[row * TILE + east] - heights[row * TILE + west];
      const dNorth = heights[north + col] - heights[south + col];
      let shade = 1;
      if (h <= 0) {
        ramp(SEA, h, rgb);
      } else if (Math.abs(dEast) < LEVEL_TOLERANCE && Math.abs(dNorth) < LEVEL_TOLERANCE && isLevel(heights, row, col, reach)) {
        rgb[0] = FRESH_WATER[0];
        rgb[1] = FRESH_WATER[1];
        rgb[2] = FRESH_WATER[2];
      } else {
        ramp(LAND, h, rgb);
        // Surface normal (-dz/dx, -dz/dy, 1) lit from the north-west, 45° above the horizon.
        const nx = -dEast * slopeGain;
        const ny = -dNorth * slopeGain;
        const lambert = (-0.5 * nx + 0.5 * ny + 0.7071) / Math.sqrt(nx * nx + ny * ny + 1) / 0.7071;
        shade = clamp(0.3 + 0.7 * lambert, 0.35, 1.2);
      }
      const o = (row * TILE + col) * 4;
      data[o] = rgb[0] * shade;
      data[o + 1] = rgb[1] * shade;
      data[o + 2] = rgb[2] * shade;
      data[o + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

class DemImageryProvider extends UrlTemplateImageryProvider {
  constructor() {
    super({
      url: TERRARIUM_URL, // only used for bookkeeping: requestImage below does the work
      tilingScheme: new WebMercatorTilingScheme(),
      maximumLevel: DEM_MAX_LEVEL,
      credit: new Credit(CREDIT),
    });
  }
  override requestImage(x: number, y: number, level: number): Promise<HTMLCanvasElement> | undefined {
    return demTile(level, x, y)?.then((heights) => paintTile(heights, level, y));
  }
}

export function createBaseMapProvider(): UrlTemplateImageryProvider {
  return new DemImageryProvider();
}

/** Ground elevation (metres, not exaggerated) at a point, from DEM level 11. */
export async function elevationAt(lng: number, lat: number): Promise<number> {
  const z = 11;
  const fx = ((lng + 180) / 360) * 2 ** z;
  const rad = (lat * Math.PI) / 180;
  const fy = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
  for (let attempt = 0; attempt < 50; attempt++) {
    const dem = demTile(z, Math.floor(fx), Math.floor(fy));
    if (dem) {
      const heights = await dem;
      const col = Math.min(TILE - 1, Math.floor((fx % 1) * TILE));
      const row = Math.min(TILE - 1, Math.floor((fy % 1) * TILE));
      return Math.max(0, heights[row * TILE + col]);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return 0;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

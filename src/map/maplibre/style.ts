// 地图的样式：底图只有自然地貌（按高程着色、地形明暗、水），上面是轨迹、站点和地名。
// 没有道路、城市、国界，也没有任何底图自带的地名。

import type {
  ExpressionSpecification,
  FilterSpecification,
  LayerSpecification,
  SourceSpecification,
  StyleSpecification,
} from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import type { NamesMode } from '../types';

/** 地形立起来的倍数。 */
export const TERRAIN_EXAGGERATION = 1.5;

/** 开放的全球高程瓦片（Terrarium 编码）。中国境内的实测数据到 12 级为止（约 30 米一格）。 */
const DEM_TILES = ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'];
const DEM_ATTRIBUTION =
  '地形：<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Mapzen 地形瓦片</a>';
const FAR_WATER_ATTRIBUTION =
  '远景河湖：<a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a>';

const WATER = '#7aabd0';
const WATER_CLEAR = 'rgba(122, 171, 208, 0)';
/** 远景里的河是细线，颜色比水面深一点才看得清。 */
const FAR_RIVER = '#6a9fc9';
const LOWLAND = '#a9c48f';

/** 图层的名字。 */
export const LAYER = {
  seaFar: 'sea-far',
  farLakes: 'far-lakes',
  seaDepth: 'sea-depth',
  farRivers: 'far-rivers',
  routeCasing: 'route-casing',
  placeDots: 'place-dots',
  placeLabels: 'place-labels',
  stopDots: 'stop-dots',
  stopLabels: 'stop-labels',
} as const;

/** 详细水体接手的缩放级别：这一级以下用远景的河湖和按高程定的海，以上用开放矢量瓦片里的水体。 */
const MID_ZOOM = 7;
/** 再往下换成更细的瓦片：9 级起河流的中线才齐全，江面和湖岸到 10 级够细。 */
const NEAR_ZOOM = 9;
const NEAR_MAX_TILE_ZOOM = 10;
/** 名字里带这些字的“河”是人工的沟渠，不画。 */
const MAN_MADE_NAME_PARTS = ['渠', '沟', '排灌', '排水', '引水', '灌溉', '护塘'];

/**
 * 陆地按高程着色。0 米和 0 米以下也按平原画：三角洲的低地在高程数据里常常是 0 米甚至负数，
 * 不能凭高程把它当成海。哪里是海由水体图层决定。
 */
const LAND_COLORS: ExpressionSpecification = [
  'interpolate', ['linear'], ['elevation'],
  0, LOWLAND,
  150, '#bccf9a',
  400, '#d3d6a2',
  800, '#d9c794',
  1500, '#c8a97c',
  2500, '#b08f6e',
  3500, '#a08b7c',
  4500, '#c4bdb6',
  6000, '#f5f5f3',
];

/** 从远处看时的海：高程在海平面以下的地方。只在远景用，那时一格高程有几公里宽，低地不会被误当成海。 */
const SEA_BY_ELEVATION: ExpressionSpecification = ['interpolate', ['linear'], ['elevation'], -2, WATER, 0, WATER_CLEAR];

/** 深海加深：大陆架以外越深越暗。从 −120 米才开始，陆地上低于海平面的盆地不受影响。 */
const SEA_DEPTH: ExpressionSpecification = [
  'interpolate', ['linear'], ['elevation'],
  -7000, '#1f3f66',
  -3000, '#2f5a88',
  -600, 'rgba(90, 143, 184, 0.85)',
  -120, 'rgba(90, 143, 184, 0)',
];

/** 详细水体出现以后，远景的水体在这一段缩放里淡出。 */
const FAR_FADE_START = MID_ZOOM + 0.6;
const FAR_FADE_END = MID_ZOOM + 1;

const fadeIn = (from: number, to: number): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], from, 0, to, 1];

/** 大河（Natural Earth 的 1 到 4 级）从地球上就看得见，小一些的河到 5 级左右才出现。 */
function farRiverOpacity(fadeOut: boolean): ExpressionSpecification {
  const major: ExpressionSpecification = ['case', ['<=', ['get', 'r'], 4], 1, 0];
  const stops: (number | ExpressionSpecification)[] = [2.2, 0, 3, major, 4.5, major, 5.5, 1];
  if (fadeOut) stops.push(FAR_FADE_START, 1, FAR_FADE_END, 0);
  return ['interpolate', ['linear'], ['zoom'], ...stops] as unknown as ExpressionSpecification;
}

export interface StyleData {
  /** 远景河湖数据的地址。 */
  farWaterUrl: string;
  route: FeatureCollection;
  stopDots: FeatureCollection;
  stopLabels: FeatureCollection;
  places: FeatureCollection;
  namesMode: NamesMode;
  /** 同一个地点有几站时，各个序号圆点的横向偏移（像素）。 */
  dotOffsets: number[];
}

/** 序号圆点的图标：当前这一站用大一号的。 */
export function stopIconExpression(currentStopId: string): ExpressionSpecification {
  return ['case', ['==', ['get', 'id'], currentStopId], ['get', 'iconOn'], ['get', 'icon']];
}

/** 站内地点只在镜头停在那一站时显示。 */
export function placeFilter(currentStopId: string): FilterSpecification {
  return ['==', ['get', 'stopId'], currentStopId];
}

export function baseStyle(data: StyleData): StyleSpecification {
  // 没有写 glyphs 地址，也不改 text-font：所有文字都在浏览器里用读者设备上的字体现画，不需要字体服务器。
  const label = (id: string, source: string, size: number, minzoom: number, offset: number | ExpressionSpecification): LayerSpecification => ({
    id,
    type: 'symbol',
    source,
    minzoom,
    layout: {
      'text-field': ['get', data.namesMode],
      'text-size': size,
      // 先试圆点上方，放不下再试下方和两侧
      'text-variable-anchor': ['bottom', 'top', 'left', 'right'],
      'text-radial-offset': offset,
      'text-justify': 'auto',
      // 文字始终朝向读者，不随地图倾斜和转动
      'text-pitch-alignment': 'viewport',
      'text-rotation-alignment': 'viewport',
      'text-padding': 1,
    },
    paint: { 'text-color': '#3a1d10', 'text-halo-color': '#fffaf0', 'text-halo-width': 2 },
  });

  // 同一个地点的几个圆点左右排开
  const offsets = data.dotOffsets.filter((dx) => dx !== 0);
  const dotOffset = (
    offsets.length === 0 ? ['literal', [0, 0]] : ['match', ['get', 'dx'], ...offsets.flatMap((dx) => [dx, ['literal', [dx, 0]]]), ['literal', [0, 0]]]
  ) as unknown as ExpressionSpecification;

  return {
    version: 8,
    projection: { type: 'globe' },
    sources: {
      // 一个高程数据源同时用于立体地形、明暗和着色：同一张瓦片只下载、解码一次。
      // tileSize 写 256 时，引擎给地形和着色取的是同一级瓦片，另外总带着上一级和 5 级以下的瓦片垫底。
      dem: { type: 'raster-dem', tiles: DEM_TILES, encoding: 'terrarium', tileSize: 256, maxzoom: 12, attribution: DEM_ATTRIBUTION },
      farWater: { type: 'geojson', data: data.farWaterUrl, attribution: FAR_WATER_ATTRIBUTION },
      route: { type: 'geojson', data: data.route },
      stopDots: { type: 'geojson', data: data.stopDots },
      stopLabels: { type: 'geojson', data: data.stopLabels },
      places: { type: 'geojson', data: data.places },
    },
    terrain: { source: 'dem', exaggeration: TERRAIN_EXAGGERATION },
    sky: {
      'sky-color': '#7fb0e0',
      'horizon-color': '#e4edf3',
      'fog-color': '#dde6ea',
      'sky-horizon-blend': 0.7,
      'horizon-fog-blend': 0.7,
      'fog-ground-blend': 0.55,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#c3cfab' } },
      { id: 'relief', type: 'color-relief', source: 'dem', paint: { 'color-relief-color': LAND_COLORS } },
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'dem',
        paint: {
          'hillshade-exaggeration': 0.55,
          'hillshade-shadow-color': '#3b3020',
          'hillshade-highlight-color': '#fffbea',
          'hillshade-accent-color': '#5a4a36',
        },
      },
      // 水画在明暗之上：海面和湖面是平的。详细水体的图层加载成功后插在 sea-depth 之前。
      { id: LAYER.seaFar, type: 'color-relief', source: 'dem', paint: { 'color-relief-color': SEA_BY_ELEVATION } },
      {
        id: LAYER.farLakes,
        type: 'fill',
        source: 'farWater',
        filter: ['==', ['get', 'k'], 'lake'],
        paint: { 'fill-color': WATER, 'fill-opacity': fadeIn(3, 4) },
      },
      { id: LAYER.seaDepth, type: 'color-relief', source: 'dem', paint: { 'color-relief-color': SEA_DEPTH } },
      {
        id: LAYER.farRivers,
        type: 'line',
        source: 'farWater',
        filter: ['==', ['get', 'k'], 'river'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': FAR_RIVER,
          'line-opacity': farRiverOpacity(false),
          'line-width': [
            'interpolate', ['linear'], ['zoom'],
            2, ['match', ['get', 'r'], [1, 2, 3], 1.3, 0.9],
            8, ['match', ['get', 'r'], [1, 2, 3], 3, 4, 2.4, 1.8],
          ],
        },
      },
      {
        id: LAYER.routeCasing,
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#fff6e0', 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 3.5, 8, 6, 13, 9] },
      },
      {
        id: 'route',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#b3321c', 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.8, 8, 3, 13, 5] },
      },
      // 后面的图层先占位置。站名排在站内地名前面，所以挤的时候让站内地名先放：
      // 停在一站时，正文提到的地点比这一站自己的名字更要紧（页面抬头已经写着站名）。
      label(LAYER.stopLabels, 'stopLabels', 17, 0, 1.15),
      {
        id: LAYER.placeDots,
        type: 'circle',
        source: 'places',
        minzoom: 9,
        filter: placeFilter(''),
        paint: {
          'circle-radius': 4,
          'circle-color': '#3a1d10',
          'circle-stroke-color': '#fffaf0',
          'circle-stroke-width': 2,
          'circle-opacity': fadeIn(9, 10),
          'circle-stroke-opacity': fadeIn(9, 10),
        },
      },
      {
        ...label(LAYER.placeLabels, 'places', 14, 9, ['case', ['==', ['get', 'atStop'], 1], 1.6, 0.7]),
        filter: placeFilter(''),
      } as LayerSpecification,
      {
        id: LAYER.stopDots,
        type: 'symbol',
        source: 'stopDots',
        layout: {
          'icon-image': stopIconExpression(''),
          'icon-offset': dotOffset,
          'icon-allow-overlap': true,
          'icon-pitch-alignment': 'viewport',
          'icon-rotation-alignment': 'viewport',
        },
      },
    ],
  };
}

export interface OsmWater {
  tiles: string[];
  attribution: string;
}

/**
 * 开放矢量瓦片里的水体：只用 water 和 waterway 两层。
 * 只取 7 级和 9、10 级的瓦片：更低级别的瓦片一张有几百 KB，更高级别的又太多。
 */
export function osmWaterSources(water: OsmWater): Record<string, SourceSpecification> {
  const source = (minzoom: number, maxzoom: number): SourceSpecification => ({
    type: 'vector',
    tiles: water.tiles,
    minzoom,
    maxzoom,
    attribution: water.attribution,
  });
  return { waterMid: source(MID_ZOOM, MID_ZOOM), waterNear: source(NEAR_ZOOM, NEAR_MAX_TILE_ZOOM) };
}

/**
 * 海、湖、江面，以及河流的中线。能从数据里分出来的人工水体不画：
 * 面只留 ocean、lake、river 三类（不要 pond、dock、swimming_pool），时令湖和暗渠不画；
 * 线只留 river（不要 canal、ditch、drain、stream），其中名字一看就是沟渠的也不画。
 * 水库、鱼塘和画成面的渠道在数据里和湖、江面是同一类，分不出来。
 */
export function osmWaterLayers(): { fills: LayerSpecification[]; lines: LayerSpecification[] } {
  const areaFilter: FilterSpecification = [
    'all',
    ['in', ['get', 'class'], ['literal', ['ocean', 'lake', 'river']]],
    ['!=', ['get', 'intermittent'], 1],
    ['!=', ['get', 'brunnel'], 'tunnel'],
  ];
  const name: ExpressionSpecification = ['coalesce', ['get', 'name'], ''];
  const lineFilter = [
    'all',
    ['==', ['get', 'class'], 'river'],
    ['!=', ['get', 'brunnel'], 'tunnel'],
    ['!', ['any', ...MAN_MADE_NAME_PARTS.map((part) => ['in', part, name])]],
  ] as unknown as FilterSpecification;
  // 7 级的水体淡入，到 9 级多一点让给更细的一级；两级交接时先叠着，再淡出旧的。
  const midOpacity: ExpressionSpecification = [
    'interpolate', ['linear'], ['zoom'],
    MID_ZOOM + 0.2, 0, MID_ZOOM + 0.6, 1, NEAR_ZOOM + 0.4, 1, NEAR_ZOOM + 0.8, 0,
  ];
  const nearOpacity = fadeIn(NEAR_ZOOM, NEAR_ZOOM + 0.4);
  const fill = (id: string, source: string, opacity: ExpressionSpecification, zooms: object): LayerSpecification =>
    ({
      id,
      type: 'fill',
      source,
      'source-layer': 'water',
      filter: areaFilter,
      paint: { 'fill-color': WATER, 'fill-opacity': opacity },
      ...zooms,
    }) as LayerSpecification;
  const line = (id: string, source: string, opacity: ExpressionSpecification, width: ExpressionSpecification, zooms: object): LayerSpecification =>
    ({
      id,
      type: 'line',
      source,
      'source-layer': 'waterway',
      filter: lineFilter,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': WATER, 'line-opacity': opacity, 'line-width': width },
      ...zooms,
    }) as LayerSpecification;
  const midZooms = { minzoom: MID_ZOOM, maxzoom: NEAR_ZOOM + 0.8 };
  const nearZooms = { minzoom: NEAR_ZOOM };
  return {
    fills: [fill('water-mid', 'waterMid', midOpacity, midZooms), fill('water-near', 'waterNear', nearOpacity, nearZooms)],
    lines: [
      line('rivers-mid', 'waterMid', midOpacity, ['interpolate', ['linear'], ['zoom'], 7, 1.6, 10, 2], midZooms),
      line('rivers-near', 'waterNear', nearOpacity, ['interpolate', ['linear'], ['zoom'], 9, 1.8, 13, 3], nearZooms),
    ],
  };
}

/** 详细水体加上以后，远景的海、湖、河到 MID_ZOOM 附近淡出，交给详细水体。 */
export const FAR_HANDOVER = {
  maxzoom: FAR_FADE_END,
  seaOpacity: ['interpolate', ['linear'], ['zoom'], FAR_FADE_START, 1, FAR_FADE_END, 0] as ExpressionSpecification,
  lakeOpacity: ['interpolate', ['linear'], ['zoom'], 3, 0, 4, 1, FAR_FADE_START, 1, FAR_FADE_END, 0] as ExpressionSpecification,
  riverOpacity: farRiverOpacity(true),
};

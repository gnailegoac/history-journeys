import type { StyleSpecification, LayerSpecification, ExpressionSpecification } from 'maplibre-gl';

/** Vertical scale applied to the terrain mesh (C2 asks for this number). */
export const TERRAIN_EXAGGERATION = 1.5;

/** Open elevation tiles, Terrarium encoding. Real data stops at about z12 (30 m SRTM) for China. */
const DEM_TILES = ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'];
const DEM_ATTRIBUTION =
  '高程：<a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles (Mapzen/AWS Open Data)</a>';

/** TileJSON of the open vector tiles; only its water layers are drawn. */
export const WATER_TILEJSON = 'https://tiles.openfreemap.org/planet';

const WATER = '#86b3d1';

/**
 * `tileSize` is the size a tile is drawn at, not the size of the PNG (256). Drawing the shading tiles at 512
 * asks for one zoom level less, a quarter of the tiles; close to the ground both settings end at z12 anyway.
 */
const dem = (tileSize: number, maxzoom = 12) => ({
  type: 'raster-dem' as const,
  tiles: DEM_TILES,
  encoding: 'terrarium' as const,
  tileSize,
  maxzoom,
  attribution: DEM_ATTRIBUTION,
});

const RELIEF_COLORS: ExpressionSpecification = [
  'interpolate', ['linear'], ['elevation'],
  -7000, '#1f3f66',
  -3000, '#2f5a88',
  -200, '#5a8fb8',
  -5, '#86b3d1',
  // close to the coast the detailed tiles give the sea as exactly 0 m, so 0 has to be water too
  0, '#86b3d1',
  1, '#a9c48f',
  150, '#bccf9a',
  400, '#d3d6a2',
  800, '#d9c794',
  1500, '#c8a97c',
  2500, '#b08f6e',
  3500, '#a08b7c',
  4500, '#c4bdb6',
  6000, '#f5f5f3',
];

/** Rivers and lakes are taken from one zoom level only (z10 tiles, about 10 m precision) to keep the transfer small. */
export const WATER_ZOOM = 10;

/**
 * Natural base map: sea by depth, land by height, hillshade on top.
 * No roads, no cities, no borders, no labels from any basemap.
 */
export function baseStyle(): StyleSpecification {
  return {
    version: 8,
    projection: { type: 'globe' },
    // The docs advise separate sources for terrain and hillshade: the terrain mesh loads coarser tiles.
    // demBase stops at z5 (tiles about 1000 km wide): a coarse picture that is nearly always loaded already,
    // drawn under the detailed one so that a fast flight does not show bare background where tiles are still on their way.
    sources: { demTerrain: dem(256), demShade: dem(512), demBase: dem(512, 5) },
    terrain: { source: 'demTerrain', exaggeration: TERRAIN_EXAGGERATION },
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
      { id: 'background', type: 'background', paint: { 'background-color': '#3d6a94' } },
      { id: 'relief-base', type: 'color-relief', source: 'demBase', paint: { 'color-relief-color': RELIEF_COLORS } },
      { id: 'relief', type: 'color-relief', source: 'demShade', paint: { 'color-relief-color': RELIEF_COLORS } },
      {
        id: 'hillshade',
        type: 'hillshade',
        source: 'demShade',
        paint: {
          'hillshade-exaggeration': 0.55,
          'hillshade-shadow-color': '#3b3020',
          'hillshade-highlight-color': '#fffbea',
          'hillshade-accent-color': '#5a4a36',
        },
      },
    ],
  };
}

/** Rivers and lakes, added once the TileJSON is known. Sea comes from the elevation tiles. */
export function waterLayers(): LayerSpecification[] {
  return [
    {
      id: 'water',
      type: 'fill',
      source: 'water',
      'source-layer': 'water',
      minzoom: WATER_ZOOM,
      filter: ['in', ['get', 'class'], ['literal', ['river', 'lake', 'pond']]],
      paint: { 'fill-color': WATER },
    },
    {
      id: 'rivers',
      type: 'line',
      source: 'water',
      'source-layer': 'waterway',
      minzoom: WATER_ZOOM,
      filter: ['==', ['get', 'class'], 'river'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': WATER, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 13, 2.5] },
    },
  ];
}

/** Route, stop markers and place names. `nameKey` is the feature property shown as text. */
export function routeLayers(nameKey: string): LayerSpecification[] {
  const label = (id: string, kind: string, size: number, minzoom: number): LayerSpecification => ({
    id,
    type: 'symbol',
    source: 'places',
    minzoom,
    filter: ['==', ['get', 'kind'], kind],
    layout: {
      'text-field': ['get', nameKey],
      // No `glyphs` URL in the style and the default `text-font`: every glyph is drawn in the browser,
      // Chinese characters with the map option `localIdeographFontFamily`.
      'text-size': size,
      // above the dot if there is room, otherwise below or beside it
      'text-variable-anchor': ['bottom', 'top', 'left', 'right'],
      'text-radial-offset': 0.7,
      'text-justify': 'auto',
      'text-pitch-alignment': 'viewport',
      'text-rotation-alignment': 'viewport',
      'text-padding': 1,
    },
    paint: { 'text-color': '#3a1d10', 'text-halo-color': '#fffaf0', 'text-halo-width': 2 },
  });
  return [
    {
      id: 'route-casing',
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
    {
      id: 'via-dots',
      type: 'circle',
      source: 'places',
      minzoom: 5,
      filter: ['==', ['get', 'kind'], 'via'],
      paint: { 'circle-radius': 3, 'circle-color': '#fff6e0', 'circle-stroke-color': '#b3321c', 'circle-stroke-width': 1.5 },
    },
    {
      id: 'place-dots',
      type: 'circle',
      source: 'places',
      filter: ['any', ['==', ['get', 'kind'], 'stop'], ['all', ['==', ['get', 'kind'], 'local'], ['>=', ['zoom'], 10]]],
      paint: {
        'circle-radius': ['case', ['==', ['get', 'kind'], 'stop'], 6, 4],
        'circle-color': ['case', ['==', ['get', 'kind'], 'stop'], '#b3321c', '#3a1d10'],
        'circle-stroke-color': '#fffaf0',
        'circle-stroke-width': 2,
      },
    },
    label('local-labels', 'local', 14, 10),
    label('stop-labels', 'stop', 17, 0),
  ];
}

import 'maplibre-gl/dist/maplibre-gl.css';
import './app.css';
import * as maplibregl from 'maplibre-gl';
// v6 is ESM only; with a bundler the worker file has to be named explicitly (docs: Installation, Vite).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import routeData from '../../shared/route.json';
import { Path, clamp, lerp, lerpAngle, smootherstep, type LngLat } from './geo';
import { baseStyle, routeLayers, waterLayers, WATER_TILEJSON, WATER_ZOOM, TERRAIN_EXAGGERATION } from './style';

maplibregl.setWorkerUrl(workerUrl);

type NamesMode = 'ancient' | 'modern';
type Camera = { center: LngLat; zoom: number; pitch: number; bearing: number };
type Preset = { distanceKm: number; pitch: number; bearing: number };

const ll = (p: number[]): LngLat => [p[0], p[1]];
const stops = routeData.stops;
const viewpoints = routeData.viewpoints;
const globeViewpoint = viewpoints.find((v) => v.id === 'globe')!;

// ---------------------------------------------------------------- data -> GeoJSON

/** Points of leg i (stop i to stop i+1), both ends included. */
function legPoints(i: number): LngLat[] {
  const leg = routeData.legs.find((l) => l.from === stops[i].id && l.to === stops[i + 1].id) ?? routeData.legs[i];
  return [ll(stops[i].lngLat), ...leg.via.map((v) => ll(v.lngLat)), ll(stops[i + 1].lngLat)];
}

/** The route from stop a to stop b, forwards or backwards. */
function routeBetween(a: number, b: number): LngLat[] {
  if (a > b) return routeBetween(b, a).reverse();
  const points: LngLat[] = [ll(stops[a].lngLat)];
  for (let i = a; i < b; i++) points.push(...legPoints(i).slice(1));
  return points;
}

const routeGeoJSON = {
  type: 'FeatureCollection' as const,
  features: stops.slice(0, -1).map((_, i) => ({
    type: 'Feature' as const,
    properties: { leg: i },
    geometry: { type: 'LineString' as const, coordinates: legPoints(i) },
  })),
};

function placeFeatures() {
  const seen = new Set<string>();
  const features: { type: 'Feature'; properties: Record<string, string>; geometry: { type: 'Point'; coordinates: LngLat } }[] = [];
  const add = (kind: string, lngLat: number[], ancient: string, modern: string) => {
    const key = `${kind}|${lngLat.join(',')}|${ancient}`;
    if (seen.has(key)) return; // 杭州 is visited twice
    seen.add(key);
    features.push({ type: 'Feature', properties: { kind, ancient, modern }, geometry: { type: 'Point', coordinates: ll(lngLat) } });
  };
  for (const s of stops) add('stop', s.lngLat, s.ancient, s.modern);
  for (const list of Object.values(routeData.localPlaces)) for (const p of list) add('local', p.lngLat, p.ancient, p.modern);
  for (const leg of routeData.legs) for (const v of leg.via) add('via', v.lngLat, v.name, v.name);
  return { type: 'FeatureCollection' as const, features };
}

// ---------------------------------------------------------------- map

const style = baseStyle();
style.sources.route = { type: 'geojson', data: routeGeoJSON };
style.sources.places = { type: 'geojson', data: placeFeatures() };
style.layers.push(...routeLayers('ancient'));

const map = new maplibregl.Map({
  container: 'map',
  style,
  center: ll(globeViewpoint.lngLat),
  zoom: 2.5,
  minZoom: 1,
  maxZoom: 16,
  maxPitch: 85,
  // Chinese text is drawn from fonts on the reader's device, no glyph server.
  localIdeographFontFamily: '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif',
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');

const EARTH_CIRCUMFERENCE_M = 40075016.686;
/** Distance in pixels from the camera to the point it looks at; fixed by the field of view. */
const cameraToCenterPx = () =>
  (0.5 * map.getContainer().clientHeight) / Math.tan((map.getVerticalFieldOfView() * Math.PI) / 360);
const metersPerPixelAtZoom0 = (lat: number) => (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180)) / 512;

/** Zoom level at which the camera is `meters` away from the point it looks at. */
function zoomForDistance(meters: number, lat: number): number {
  return Math.log2((cameraToCenterPx() * metersPerPixelAtZoom0(lat)) / meters);
}
function distanceForZoom(zoom: number, lat: number): number {
  return (cameraToCenterPx() * metersPerPixelAtZoom0(lat)) / 2 ** zoom;
}

function presetCamera(lngLat: number[], preset: Preset): Camera {
  return {
    center: ll(lngLat),
    zoom: zoomForDistance(preset.distanceKm * 1000, lngLat[1]),
    pitch: preset.pitch,
    bearing: preset.bearing,
  };
}

/** The whole globe in view: its radius is about 0.62 of the shorter side of the page. */
function globeCamera(): Camera {
  const el = map.getContainer();
  const radiusPx = 0.62 * Math.min(el.clientWidth, el.clientHeight);
  const lat = globeViewpoint.lngLat[1];
  const zoom = Math.log2((radiusPx * 2 * Math.PI * Math.cos((lat * Math.PI) / 180)) / 512);
  return { center: ll(globeViewpoint.lngLat), zoom, pitch: 0, bearing: 0 };
}

function currentCamera(): Camera {
  const c = map.getCenter();
  return { center: [c.lng, c.lat], zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
}

/** Resolves when all tiles are loaded and nothing is animating any more (or after `maxMs`). */
function settled(maxMs = 12000): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      map.off('idle', done);
      resolve();
    };
    const timer = setTimeout(done, maxMs);
    map.on('idle', done);
    map.triggerRepaint();
  });
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- state and camera moves

let stopIndex: number | null = null;
let namesMode: NamesMode = 'ancient';
/** Every camera move takes a new token; an older move stops when it sees the token has changed. */
let motionToken = 0;
let lastFlight: Record<string, number> | null = null;

function cancelMotion(): number {
  map.stop();
  return ++motionToken;
}
// A touch, click or wheel on the map hands control back to the reader.
for (const type of ['pointerdown', 'wheel', 'touchstart'] as const) {
  map.getCanvas().addEventListener(type, () => void motionToken++, { passive: true });
}

/**
 * Moves the camera centre along `path` while zooming out to a cruise height and back in.
 * One `jumpTo` per animation frame, as in the docs' camera animation examples.
 */
function animateAlong(path: Path, from: Camera, to: Camera, token: number): Promise<void> {
  const km = path.totalKm;
  // 4.5 s for a short hop, 7 s for the longest legs; the wait for tiles after arrival comes on top.
  const durationMs = clamp(4500 + km * 2.5, 4500, 7000);
  const midLat = path.at(0.5)[1];
  const cruiseZoom = Math.min(from.zoom, to.zoom, zoomForDistance(clamp(km * 0.6, 60, 3000) * 1000, midLat));
  const cruisePitch = 45;
  const t0 = performance.now();
  let last = t0;
  let frames = 0;
  let worstMs = 0;
  return new Promise((resolve) => {
    const frame = (now: number) => {
      if (token !== motionToken) return resolve();
      if (now > t0) {
        frames++;
        worstMs = Math.max(worstMs, now - last);
      }
      last = now;
      const s = clamp((now - t0) / durationMs, 0, 1);
      const e = smootherstep(s);
      const cruise = Math.sin(Math.PI * s) ** 2; // 0 at both ends, 1 half way
      map.jumpTo({
        center: path.smoothAt(e),
        zoom: lerp(lerp(from.zoom, to.zoom, e), cruiseZoom, cruise),
        pitch: lerp(lerp(from.pitch, to.pitch, e), cruisePitch, cruise),
        bearing: lerpAngle(from.bearing, to.bearing, e),
      });
      if (s < 1) return requestAnimationFrame(frame);
      const elapsed = now - t0;
      lastFlight = { km, durationMs: elapsed, frames, avgFps: (1000 * frames) / elapsed, minFps: 1000 / worstMs };
      resolve();
    };
    requestAnimationFrame(frame);
  });
}

async function flyToStop(index: number): Promise<void> {
  const stop = stops[index];
  if (!stop) throw new RangeError(`没有第 ${index} 站`);
  const token = cancelMotion();
  const from = currentCamera();
  const to = presetCamera(stop.lngLat, stop.camera);
  // From the current stop along the route; with no current stop, straight from where the camera is.
  const routePoints = stopIndex === null ? [to.center] : routeBetween(stopIndex, index);
  const path = new Path([from.center, ...routePoints]);
  stopIndex = index;
  renderPanel();
  await animateAlong(path, from, to, token);
  if (token !== motionToken) return; // the reader or another move took over
  map.jumpTo(to);
  const t = performance.now();
  await settled();
  if (lastFlight) lastFlight.settleMs = performance.now() - t;
}

async function goToViewpoint(id: string): Promise<void> {
  const vp = viewpoints.find((v) => v.id === id);
  if (!vp) throw new RangeError(`没有检验视角 ${id}`);
  cancelMotion();
  const camera = vp.camera ? presetCamera(vp.lngLat, vp.camera) : globeCamera();
  const duration = 3500;
  map.flyTo({ ...camera, duration, essential: true });
  await Promise.race([map.once('moveend'), sleep(duration + 500)]);
  await settled();
}

function resetView(): void {
  cancelMotion();
  const camera = stopIndex === null ? globeCamera() : presetCamera(stops[stopIndex].lngLat, stops[stopIndex].camera);
  map.easeTo({ ...camera, duration: 1200, essential: true });
}

function setNames(mode: NamesMode): void {
  if (mode !== 'ancient' && mode !== 'modern') throw new RangeError(`未知的地名模式 ${mode}`);
  namesMode = mode;
  for (const id of ['stop-labels', 'local-labels']) map.setLayoutProperty(id, 'text-field', ['get', mode]);
  renderPanel();
}

// ---------------------------------------------------------------- frame rate

const frameStats = { frames: 0, totalMs: 0, worstMs: 0, last: 0 };
function countFrame(now: number) {
  if (frameStats.last) {
    const delta = now - frameStats.last;
    frameStats.frames++;
    frameStats.totalMs += delta;
    frameStats.worstMs = Math.max(frameStats.worstMs, delta);
  }
  frameStats.last = now;
  requestAnimationFrame(countFrame);
}
requestAnimationFrame(countFrame);

function webglRenderer(): string {
  try {
    const gl = map.getCanvas().getContext('webgl2');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) ?? '');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------- panel

const panel = document.getElementById('panel')!;

function button(text: string, onClick: () => void, active = false, title = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.title = title;
  b.classList.toggle('active', active);
  b.addEventListener('click', onClick);
  return b;
}

function group(heading: string, id: string, buttons: HTMLButtonElement[]): HTMLElement[] {
  const h = document.createElement('h2');
  h.textContent = heading;
  const row = document.createElement('div');
  row.className = 'row';
  row.id = id;
  row.append(...buttons);
  return [h, row];
}

function renderPanel(): void {
  const title = document.createElement('h1');
  title.textContent = `${routeData.figure.name}（${routeData.figure.years}）`;
  panel.replaceChildren(
    title,
    ...group('八站', 'stops', stops.map((s, i) =>
      button(`${i + 1} ${s.title.split('：')[0]}`, () => void flyToStop(i), i === stopIndex, `${s.title}（${s.years}）`))),
    ...group('检验视角', 'views', viewpoints.map((v) => button(v.label, () => void goToViewpoint(v.id), false, v.description))),
    ...group('地名', 'names', [
      button('古名', () => setNames('ancient'), namesMode === 'ancient'),
      button('今名', () => setNames('modern'), namesMode === 'modern'),
    ]),
    ...group('镜头', 'camera', [button('回到这一站', resetView)]),
  );
}
renderPanel();

// ---------------------------------------------------------------- start-up and test API

async function addWater(): Promise<void> {
  try {
    const tileJson = await (await fetch(WATER_TILEJSON)).json();
    if (!map.isStyleLoaded()) await map.once('load');
    map.addSource('water', { type: 'vector', tiles: tileJson.tiles, minzoom: WATER_ZOOM, maxzoom: WATER_ZOOM, attribution: tileJson.attribution });
    for (const layer of waterLayers()) map.addLayer(layer, 'route-casing');
  } catch (err) {
    console.warn('水体图层没有加载成功，底图只剩地形', err);
  }
}

let readyAtMs: number | null = null;

const api = {
  engine: { name: 'MapLibre GL JS', version: maplibregl.getVersion() },
  ready: (async () => {
    map.jumpTo(globeCamera());
    await Promise.all([map.once('load'), addWater()]);
    await settled(20000);
    readyAtMs = performance.now();
  })(),
  /** Milliseconds from navigation start to `ready` (not in the SPEC; used for metrics.json). */
  readyAtMs: () => readyAtMs,
  terrainExaggeration: TERRAIN_EXAGGERATION,
  stops: stops.map((s) => ({ id: s.id, title: s.title })),
  viewpoints: viewpoints.map((v) => ({ id: v.id, label: v.label })),
  flyToStop,
  goToViewpoint,
  setNames,
  resetView,
  getState() {
    const c = currentCamera();
    return {
      lngLat: c.center,
      pitch: c.pitch,
      bearing: c.bearing,
      stopIndex,
      namesMode,
      // extras, not in the SPEC
      zoom: c.zoom,
      distanceKm: distanceForZoom(c.zoom, c.center[1]) / 1000,
      centerElevationM: map.getCameraTargetElevation(),
    };
  },
  fpsReset() {
    frameStats.frames = 0;
    frameStats.totalMs = 0;
    frameStats.worstMs = 0;
  },
  fps() {
    const { frames, totalMs, worstMs } = frameStats;
    return { avg: frames ? (1000 * frames) / totalMs : 0, min: worstMs ? 1000 / worstMs : 0, samples: frames };
  },
  webglRenderer,
  /** Frame statistics of the last flight animation alone, without the wait for tiles afterwards. */
  lastFlight: () => lastFlight,
  /** The map itself, for debugging in the console. */
  map,
};

declare global {
  interface Window {
    __spike: typeof api;
  }
}
window.__spike = api;

import {
  Cartesian2,
  Cartesian3,
  Cartographic,
  CesiumWidget,
  ClassificationType,
  Color,
  ConstantProperty,
  Credit,
  CreditDisplay,
  DistanceDisplayCondition,
  Entity,
  HeadingPitchRange,
  HeightReference,
  ImageryLayer,
  LabelStyle,
  Math as CesiumMath,
  Matrix4,
  PolylineOutlineMaterialProperty,
  VerticalOrigin,
} from "cesium";
import * as cesiumRuntime from "cesium";
import "cesium/Build/Cesium/Widgets/CesiumWidget/CesiumWidget.css";
import route from "../../shared/route.json";
import { createBaseMapProvider, createTerrainProvider, elevationAt } from "./dem";

/** Terrain heights are multiplied by this factor everywhere (mesh, route, labels). */
const TERRAIN_EXAGGERATION = 1.5;
const GLOBE_RANGE_M = 6_500_000;

type LngLat = [number, number];
type NamesMode = "ancient" | "modern";
/** Camera described the way route.json does: a ground point, a distance, pitch (0 = straight down) and bearing. */
interface Pose {
  lngLat: LngLat;
  height: number; // metres in the scene, exaggeration already applied
  range: number; // metres
  pitch: number; // degrees
  bearing: number; // degrees
}
interface CameraPreset {
  distanceKm: number;
  pitch: number;
  bearing: number;
}

// ---------- scene ----------

// The default logo credit advertises Cesium ion, which this page does not use.
CreditDisplay.cesiumCredit = new Credit('<a href="https://cesium.com/platform/cesiumjs/" target="_blank">CesiumJS</a>', true);
const widget = new CesiumWidget("map", {
  baseLayer: new ImageryLayer(createBaseMapProvider()), // explicit: the default layer would need Cesium ion
  terrainProvider: createTerrainProvider(),
  skyBox: false,
  scene3DOnly: true,
});
const { scene, camera } = widget;
const globe = scene.globe;
scene.verticalExaggeration = TERRAIN_EXAGGERATION;
scene.backgroundColor = Color.fromCssColorString("#0b1016");
if (scene.sun) scene.sun.show = false;
if (scene.moon) scene.moon.show = false;
globe.baseColor = Color.fromCssColorString("#96c2d8");

// ---------- route, markers, place names ----------

const stopById = new Map(route.stops.map((stop) => [stop.id, stop]));
const legPoints = route.legs.map((leg) => [
  stopById.get(leg.from)!.lngLat as LngLat,
  ...leg.via.map((via) => via.lngLat as LngLat),
  stopById.get(leg.to)!.lngLat as LngLat,
]);

const LINE = Color.fromCssColorString("#b3261e");
widget.entities.add({
  polyline: {
    positions: Cartesian3.fromDegreesArray(legPoints.flatMap((points, i) => (i ? points.slice(1) : points)).flat()),
    clampToGround: true,
    classificationType: ClassificationType.TERRAIN,
    width: 5,
    material: new PolylineOutlineMaterialProperty({ color: LINE, outlineColor: Color.WHITE, outlineWidth: 1.5 }),
  },
});

const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
const LOCAL_NAMES_WITHIN_M = 150_000;
// Closer than this a name is drawn even when a ridge stands in front of it; farther away the
// terrain and the horizon hide it, otherwise names of places 800 km away float on nearby mountains.
const SHOW_THROUGH_TERRAIN_WITHIN_M = 200_000;
const named: { entity: Entity; ancient: string; modern: string }[] = [];

function addPlace(place: { ancient: string; modern: string; lngLat: number[] }, kind: "stop" | "local", show: DistanceDisplayCondition | undefined) {
  const big = kind === "stop";
  const entity = widget.entities.add({
    position: Cartesian3.fromDegrees(place.lngLat[0], place.lngLat[1]),
    point: {
      pixelSize: big ? 10 : 7,
      color: big ? LINE : Color.fromCssColorString("#3a2a1c"),
      outlineColor: Color.WHITE,
      outlineWidth: 2,
      heightReference: HeightReference.CLAMP_TO_GROUND,
      disableDepthTestDistance: SHOW_THROUGH_TERRAIN_WITHIN_M,
      distanceDisplayCondition: show,
    },
    label: {
      text: place.ancient,
      font: `${big ? "bold 18px" : "14px"} ${FONT}`,
      fillColor: Color.fromCssColorString("#2a1c10"),
      outlineColor: Color.fromCssColorString("#fffaf0"),
      outlineWidth: 4,
      style: LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: VerticalOrigin.BOTTOM,
      pixelOffset: new Cartesian2(0, -9),
      heightReference: HeightReference.CLAMP_TO_GROUND, // stands on the terrain surface
      disableDepthTestDistance: SHOW_THROUGH_TERRAIN_WITHIN_M,
      distanceDisplayCondition: show,
    },
  });
  named.push({ entity, ancient: place.ancient, modern: place.modern });
}

const localPlaces = Object.values(route.localPlaces).flat();
const sameSpot = (a: number[], b: number[]) => a[0] === b[0] && a[1] === b[1];
const seen: number[][] = [];
for (const stop of route.stops) {
  if (seen.some((lngLat) => sameSpot(lngLat, stop.lngLat))) continue; // Hangzhou appears twice
  seen.push(stop.lngLat);
  // Where a local place sits on the stop itself, the stop name gives way to it at close range.
  const hasLocalTwin = localPlaces.some((place) => sameSpot(place.lngLat, stop.lngLat));
  addPlace(stop, "stop", hasLocalTwin ? new DistanceDisplayCondition(LOCAL_NAMES_WITHIN_M, Number.MAX_VALUE) : undefined);
}
for (const place of localPlaces) addPlace(place, "local", new DistanceDisplayCondition(0, LOCAL_NAMES_WITHIN_M));

let namesMode: NamesMode = "ancient";
function setNames(mode: NamesMode): void {
  namesMode = mode;
  for (const item of named) item.entity.label!.text = new ConstantProperty(item[mode]);
  document.getElementById("names")!.textContent = mode === "ancient" ? "地名：古" : "地名：今";
}

// ---------- camera ----------

function applyPose(pose: Pose): void {
  const target = Cartesian3.fromDegrees(pose.lngLat[0], pose.lngLat[1], pose.height);
  const offset = new HeadingPitchRange(CesiumMath.toRadians(pose.bearing), CesiumMath.toRadians(pose.pitch - 90), pose.range);
  camera.lookAt(target, offset);
  camera.lookAtTransform(Matrix4.IDENTITY); // release the lock so the reader can move freely
}

/** The pose the camera has right now, measured where the centre of the screen meets the ground. */
function currentPose(): Pose {
  const centre = new Cartesian2(scene.canvas.clientWidth / 2, scene.canvas.clientHeight / 2);
  const ray = camera.getPickRay(centre);
  const hit = (ray && globe.pick(ray, scene)) ?? camera.pickEllipsoid(centre);
  if (!hit) return lastPose;
  const ground = Cartographic.fromCartesian(hit);
  return {
    lngLat: [CesiumMath.toDegrees(ground.longitude), CesiumMath.toDegrees(ground.latitude)],
    height: ground.height,
    range: Cartesian3.distance(camera.positionWC, hit),
    pitch: 90 + CesiumMath.toDegrees(camera.pitch),
    bearing: CesiumMath.toDegrees(CesiumMath.negativePiToPi(camera.heading)),
  };
}

async function presetPose(lngLat: number[], preset: CameraPreset | undefined): Promise<Pose> {
  if (!preset) return { lngLat: lngLat as LngLat, height: 0, range: GLOBE_RANGE_M, pitch: 0.1, bearing: 0 };
  const height = (await elevationAt(lngLat[0], lngLat[1])) * TERRAIN_EXAGGERATION;
  return { lngLat: lngLat as LngLat, height, range: preset.distanceKm * 1000, pitch: preset.pitch, bearing: preset.bearing };
}

/** Resolves once every terrain and base-map tile for the current view is loaded and drawn. */
function settled(timeoutMs = 20_000): Promise<void> {
  return new Promise((resolve) => {
    let calmFrames = 0;
    const finish = () => {
      removeListener();
      clearTimeout(timer);
      resolve();
    };
    const removeListener = scene.postRender.addEventListener(() => {
      calmFrames = globe.tilesLoaded ? calmFrames + 1 : 0;
      if (calmFrames >= 3) finish();
    });
    const timer = setTimeout(finish, timeoutMs);
  });
}

const distanceKm = (a: LngLat, b: LngLat) => {
  const rad = CesiumMath.toRadians;
  const s = Math.sin(rad(b[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(s));
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

let stopFlight: (() => void) | undefined;
/** Frame statistics of the last camera flight only (animation, without the wait for tiles afterwards). */
let lastFlight = { seconds: 0, pathKm: 0, avg: 0, min: 0, samples: 0 };

/** Moves the look-at point along `path` (starting from wherever the camera is now) and ends in `end`. */
function fly(path: LngLat[], end: Pose, minSeconds: number, maxSeconds: number): Promise<void> {
  stopFlight?.();
  const start = currentPose();
  const points = [start.lngLat, ...path];
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + distanceKm(points[i - 1], points[i]));
  const totalKm = lengths[lengths.length - 1];
  const seconds = CesiumMath.clamp(minSeconds + totalKm / 350, minSeconds, maxSeconds);
  const climb = Math.min(totalKm * 450, 900_000); // metres added to the range half-way, to see where we are going
  const turn = CesiumMath.negativePiToPi(CesiumMath.toRadians(end.bearing - start.bearing)); // shortest way round
  const startTime = performance.now();
  let frameCount = 0;
  let worstMs = 0;
  let previousFrame = startTime;
  scene.screenSpaceCameraController.enableInputs = false;

  return new Promise<void>((resolve) => {
    const removeListener = scene.preUpdate.addEventListener(() => {
      const now = performance.now();
      if (frameCount++) worstMs = Math.max(worstMs, now - previousFrame);
      previousFrame = now;
      const linear = Math.min(1, (now - startTime) / (seconds * 1000));
      const t = linear * linear * (3 - 2 * linear); // ease in and out
      const along = t * totalKm;
      let i = 1;
      while (i < points.length - 1 && lengths[i] < along) i++;
      const part = lengths[i] > lengths[i - 1] ? (along - lengths[i - 1]) / (lengths[i] - lengths[i - 1]) : 1;
      applyPose({
        lngLat: [lerp(points[i - 1][0], points[i][0], part), lerp(points[i - 1][1], points[i][1], part)],
        height: lerp(start.height, end.height, t),
        range: Math.exp(lerp(Math.log(start.range), Math.log(end.range), t)) + climb * Math.sin(Math.PI * t),
        pitch: lerp(start.pitch, end.pitch, t),
        bearing: start.bearing + CesiumMath.toDegrees(turn) * t,
      });
      if (linear >= 1) {
        applyPose(end);
        const elapsed = now - startTime;
        const samples = frameCount - 1; // intervals between frames
        lastFlight = { seconds: elapsed / 1000, pathKm: totalKm, avg: (1000 * samples) / elapsed, min: worstMs ? 1000 / worstMs : 0, samples };
        stopFlight!();
      }
    });
    stopFlight = () => {
      removeListener();
      stopFlight = undefined;
      scene.screenSpaceCameraController.enableInputs = true;
      lastPose = end;
      void settled().then(resolve);
    };
  });
}

/** Route points from one stop to another, through every way point in between (backwards if needed). */
function pathBetween(from: number, to: number): LngLat[] {
  if (from === to) return [route.stops[to].lngLat as LngLat];
  const forward = from < to;
  const legs = legPoints.slice(Math.min(from, to), Math.max(from, to));
  const points = legs.flatMap((leg, i) => (i ? leg.slice(1) : leg));
  return forward ? points : points.reverse();
}

let stopIndex: number | null = null;
let lastPose: Pose = await presetPose(route.viewpoints[0].lngLat, undefined);
let homePose: Pose = lastPose; // what "回到这一站" returns to

async function flyToStop(index: number): Promise<void> {
  const stop = route.stops[index];
  const end = await presetPose(stop.lngLat, stop.camera);
  const path = stopIndex === null ? [stop.lngLat as LngLat] : pathBetween(stopIndex, index);
  stopIndex = index;
  homePose = end;
  markActive();
  await fly(path, end, 4, 9);
}

async function goToViewpoint(id: string): Promise<void> {
  const viewpoint = route.viewpoints.find((item) => item.id === id);
  if (!viewpoint) throw new Error(`unknown viewpoint ${id}`);
  const end = await presetPose(viewpoint.lngLat, "camera" in viewpoint ? viewpoint.camera : undefined);
  stopIndex = null;
  homePose = end;
  markActive(id);
  await fly([viewpoint.lngLat as LngLat], end, 2, 5);
}

function resetView(): void {
  stopFlight?.();
  applyPose(homePose);
  lastPose = homePose;
}

// ---------- frame rate ----------

const frames = { count: 0, totalMs: 0, worstMs: 0, last: 0 };
function fpsReset(): void {
  frames.count = frames.totalMs = frames.worstMs = frames.last = 0;
}
scene.postRender.addEventListener(() => {
  const now = performance.now();
  if (frames.last) {
    const delta = now - frames.last;
    frames.count++;
    frames.totalMs += delta;
    frames.worstMs = Math.max(frames.worstMs, delta);
  }
  frames.last = now;
});

// ---------- panel ----------

function button(parent: string, text: string, onClick: () => void, key: string): void {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = text;
  element.dataset.key = key;
  element.addEventListener("click", onClick);
  document.getElementById(parent)!.append(element);
}
function markActive(viewpointId?: string): void {
  const key = viewpointId ?? (stopIndex === null ? "" : `stop-${stopIndex}`);
  for (const element of document.querySelectorAll<HTMLElement>("#panel button[data-key]")) {
    element.classList.toggle("active", element.dataset.key === key);
  }
}
route.stops.forEach((stop, i) => button("stops", `${i + 1}. ${stop.title}`, () => void flyToStop(i), `stop-${i}`));
route.viewpoints.forEach((item) => button("viewpoints", item.label, () => void goToViewpoint(item.id), item.id));
document.getElementById("names")!.addEventListener("click", () => setNames(namesMode === "ancient" ? "modern" : "ancient"));
document.getElementById("reset")!.addEventListener("click", resetView);

// ---------- start, and the API the automatic checks use ----------

applyPose(lastPose);
markActive("globe");
const ready = settled(60_000).then(() => {
  api.timings.readyMs = Math.round(performance.now());
});

const api = {
  // VERSION is exported at runtime but missing from the type declarations of 1.147.0.
  engine: { name: "CesiumJS", version: (cesiumRuntime as unknown as { VERSION: string }).VERSION },
  ready,
  stops: route.stops.map(({ id, title }) => ({ id, title })),
  viewpoints: route.viewpoints.map(({ id, label }) => ({ id, label })),
  flyToStop,
  goToViewpoint,
  setNames,
  resetView,
  getState() {
    const pose = currentPose();
    return { lngLat: pose.lngLat, pitch: pose.pitch, bearing: pose.bearing, stopIndex, namesMode };
  },
  fpsReset,
  /** avg = frames per second over the period; min = 1000 / the longest single frame interval. */
  fps() {
    return {
      avg: frames.count ? (1000 * frames.count) / frames.totalMs : 0,
      min: frames.worstMs ? 1000 / frames.worstMs : 0,
      samples: frames.count,
    };
  },
  webglRenderer(): string {
    // Asking the canvas again for the same context type returns the context Cesium already created.
    const gl = (scene.canvas.getContext("webgl2") ?? scene.canvas.getContext("webgl")) as WebGLRenderingContext | null;
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return (info && gl?.getParameter(info.UNMASKED_RENDERER_WEBGL)) || "";
  },
  // Extras, not part of the required interface:
  terrainExaggeration: TERRAIN_EXAGGERATION,
  timings: { readyMs: 0 }, // milliseconds from navigation start to `ready`
  rangeKm: () => currentPose().range / 1000,
  lastFlight: () => lastFlight,
  widget, // for inspection in the console
};
(window as unknown as { __spike: typeof api }).__spike = api;

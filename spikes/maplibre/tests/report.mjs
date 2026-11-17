// Builds metrics.json from the outputs of tour.mjs / checks.mjs / experiment.mjs and from the files in dist/.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { ROOT, loadJson } from './lib.mjs';

const tour = loadJson('tour.json');
const checks = loadJson('checks.json');
const experiment = loadJson('experiment.json');
const loadedRun = loadJson('tour-run1.json'); // an earlier tour, taken while another test run kept the CPU at about 91 %
if (!tour) throw new Error('run tests/tour.mjs first');

// ---- C10: production build sizes
const assetsDir = path.join(ROOT, 'dist', 'assets');
const files = readdirSync(assetsDir).map((name) => {
  const data = readFileSync(path.join(assetsDir, name));
  return { name, bytes: data.length, gzipBytes: gzipSync(data, { level: 9 }).length };
});
const sum = (list, key) => list.reduce((n, f) => n + f[key], 0);
const js = files.filter((f) => f.name.endsWith('.js'));
const css = files.filter((f) => f.name.endsWith('.css'));

// ---- C8: flights
const round = (v, d = 1) => Math.round(v * 10 ** d) / 10 ** d;
const flights = tour.flights.map((f) => ({
  to: f.to,
  pathKm: round(f.pathKm, 0),
  animationMs: round(f.animationMs, 0),
  waitForTilesMs: round(f.settleMs, 0),
  flyToStopPromiseMs: round(f.promiseMs, 0),
  animationFpsAvg: round(f.animationFps.avg),
  animationFpsMin: round(f.animationFps.min, 2),
  animationFrames: f.animationFps.frames,
  wholePromiseFpsAvg: round(f.fpsWholePromise.avg),
  wholePromiseFpsMin: round(f.fpsWholePromise.min, 2),
  maxDistanceFromRouteKm: round(f.maxOffRouteKm),
  fastestMeasuredKmPerS: round(f.maxSpeedKmPerS, 0),
  plannedPeakKmPerS: round(f.plannedPeakKmPerS, 0),
}));
const totalFrames = sum(tour.flights.map((f) => ({ n: f.animationFps.frames })), 'n');
const totalMs = sum(tour.flights.map((f) => ({ n: f.animationMs })), 'n');
const net = tour.networkWholeTour.bySource;
const tiles = ['dem', 'water'].map((k) => net[k] ?? { started: 0, finished: 0, aborted: 0, failed: 0, transferredBytes: 0 });
const readyTimes = tour.firstUsable.map((f) => round(f.readyAtMs, 0));

const metrics = {
  engine: tour.page.engine,
  measuredAt: tour.startedAt,
  environment: {
    url: tour.url,
    servedBy: 'vite preview (production build)',
    viewport: tour.viewport,
    devicePixelRatio: tour.page.devicePixelRatio,
    browser: `Chromium ${tour.browserVersion} (Playwright 1.65.0, headless shell)`,
    chromiumArgs: tour.chromiumArgs,
    webglRenderer: tour.page.webglRenderer,
    hardwareAccelerated: !/Basic Render|SwiftShader|llvmpipe|Software/i.test(tour.page.webglRenderer),
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: `${os.cpus()[0]?.model ?? 'unknown'} x ${os.cpus().length}`,
    memoryGb: round(os.totalmem() / 2 ** 30),
    note: 'This machine has no GPU (display adapters: Microsoft Basic Display Adapter, AWS Indirect Display Device), so WebGL ran on the CPU (Microsoft Basic Render Driver). No other headless browser was running when this tour started or ended (CPU load read 20 % before and 8 % after); what ran in between was not observed.',
  },
  terrainExaggeration: tour.page.terrainExaggeration,
  c8: {
    firstUsableMs: { definition: 'navigation start to __spike.ready (map loaded, water layers added, first idle), cold HTTP cache', runs: readyTimes, median: [...readyTimes].sort((a, b) => a - b)[Math.floor(readyTimes.length / 2)] },
    flightFps: {
      definition: 'requestAnimationFrame callbacks during the camera animation of flyToStop, eight flights in route order; min = 1000 / longest frame',
      avg: round((1000 * totalFrames) / totalMs),
      min: round(Math.min(...tour.flights.map((f) => f.animationFps.min)), 2),
      perFlight: flights,
    },
    network: {
      definition: 'cold load, globe, eight flights, three test viewpoints; bytes are response headers plus encoded bodies as reported by Playwright',
      tileRequestsStarted: sum(tiles, 'started'),
      tileRequestsFinished: sum(tiles, 'finished'),
      tileRequestsAborted: sum(tiles, 'aborted'),
      tileRequestsFailed: sum(tiles, 'failed'),
      tileBytes: sum(tiles, 'transferredBytes'),
      bySource: net,
      atFirstUsable: tour.networkAfterLoad.bySource,
      devtoolsCrossCheck: tour.networkWholeTour.cdp,
      hostsContacted: tour.networkWholeTour.hosts,
      notCounted: 'the worker script (see c10) is fetched by the worker itself and does not show up in page-level network events',
    },
    consoleProblems: tour.consoleProblems,
    sameTourUnderCpuContention: loadedRun && {
      note: 'earlier run of the same tour (build before the sea-level colour fix) while other headless browsers were running on this machine; CPU load read 91 % during the run',
      measuredAt: loadedRun.startedAt,
      firstUsableMs: loadedRun.firstUsable.map((f) => round(f.readyAtMs, 0)),
      flightFpsAvg: round((1000 * loadedRun.flights.reduce((n, f) => n + f.animationFps.frames, 0)) / loadedRun.flights.reduce((n, f) => n + f.animationMs, 0)),
      flightFpsMin: round(Math.min(...loadedRun.flights.map((f) => f.animationFps.min)), 2),
      flyToStopPromiseMs: loadedRun.flights.map((f) => round(f.promiseMs, 0)),
    },
  },
  c10: {
    jsBytes: sum(js, 'bytes'),
    jsGzipBytes: sum(js, 'gzipBytes'),
    cssBytes: sum(css, 'bytes'),
    cssGzipBytes: sum(css, 'gzipBytes'),
    files,
  },
  viewpoints: tour.viewpoints,
  checks: checks && {
    c1: { frames: checks.c1.frames.length, zoomFrom: round(checks.c1.fromZoom, 2), zoomTo: round(checks.c1.end.zoom, 2), closestDistanceKm: round(checks.c1.closest.distanceKm, 2), minMeanLumaOfCentre: round(checks.c1.minMeanLuma), maxDarkFraction: checks.c1.maxDarkFraction },
    c4MidFlight: { kmFromStart: round(checks.c4mid.midKmFromStart), kmFromEnd: round(checks.c4mid.midKmFromEnd), zoom: round(checks.c4mid.midState.zoom, 2) },
    c5: checks.c5,
    c7mouse: checks.c7mouse,
    c7touch: checks.c7touch,
  },
  costSplit: experiment && {
    definition: 'same flight (汴京 <-> 黄州, tiles cached) with parts of the scene switched off; average fps of the camera animation',
    at: experiment.at,
    results: experiment.results.map((r) => ({ name: r.name, avgFps: round(r.avgFps), minFps: round(r.minFps, 2) })),
  },
};
writeFileSync(path.join(ROOT, 'metrics.json'), JSON.stringify(metrics, null, 2) + '\n');
console.log(JSON.stringify({ firstUsableMs: metrics.c8.firstUsableMs.runs, flightFps: { avg: metrics.c8.flightFps.avg, min: metrics.c8.flightFps.min }, tiles: { started: metrics.c8.network.tileRequestsStarted, finished: metrics.c8.network.tileRequestsFinished, bytes: metrics.c8.network.tileBytes }, c10: { js: metrics.c10.jsBytes, jsGzip: metrics.c10.jsGzipBytes, css: metrics.c10.cssBytes, cssGzip: metrics.c10.cssGzipBytes }, renderer: metrics.environment.webglRenderer }, null, 1));

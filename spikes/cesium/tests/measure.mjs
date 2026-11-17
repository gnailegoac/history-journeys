// C8 / C9 / C10 measurements: cold load, the eight-stop tour, network totals, build size.
// Usage: npm run build && npm run preview (other terminal), then: node tests/measure.mjs
// Headless only. Hard timeout: 4 min 50 s. Writes metrics.json and two screenshots.
import { chromium } from "@playwright/test";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { cpus, totalmem } from "node:os";

const URL = process.env.SPIKE_URL ?? "http://localhost:5412/";
const BUDGET_MS = 290_000;
const scriptStart = Date.now();
const killer = setTimeout(() => {
  console.error("hard timeout");
  process.exit(2);
}, BUDGET_MS);
mkdirSync("shots", { recursive: true });

const route = JSON.parse(readFileSync("../shared/route.json", "utf8"));
const km = (a, b) => {
  const rad = Math.PI / 180;
  const s = Math.sin(((b[1] - a[1]) * rad) / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(((b[0] - a[0]) * rad) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(s));
};

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const metrics = { measuredAt: new Date().toISOString(), url: URL };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();

  // ---- network log: every finished request, grouped ----
  const net = { tiles: { requests: 0, bytes: 0 }, engineStatic: { requests: 0, bytes: 0 }, app: { requests: 0, bytes: 0 }, other: { requests: 0, bytes: 0 } };
  const hosts = new Set();
  const failed = [];
  const pending = [];
  page.on("requestfinished", (request) => {
    pending.push(
      request.sizes().then((sizes) => {
        const url = new globalThis.URL(request.url());
        hosts.add(url.host);
        const group = url.host === "s3.amazonaws.com" ? net.tiles : url.pathname.includes("/cesiumStatic/") ? net.engineStatic : url.host.startsWith("localhost") ? net.app : net.other;
        group.requests++;
        group.bytes += sizes.responseHeadersSize + sizes.responseBodySize;
      }).catch(() => {}),
    );
  });
  page.on("requestfailed", (request) => failed.push(request.url()));
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const snapshot = async () => {
    await Promise.all(pending.splice(0));
    return JSON.parse(JSON.stringify(net));
  };

  // ---- cold load ----
  const t0 = Date.now();
  await page.goto(URL);
  await page.waitForFunction(() => window.__spike, null, { timeout: 60_000 });
  await page.evaluate(() => window.__spike.ready);
  metrics.firstUsableMs = Date.now() - t0; // wall clock: navigation start to __spike.ready
  metrics.firstUsableMsInPage = await page.evaluate(() => window.__spike.timings.readyMs); // performance.now() at ready
  metrics.engine = await page.evaluate(() => window.__spike.engine);
  metrics.webglRenderer = await page.evaluate(() => window.__spike.webglRenderer());
  metrics.terrainExaggeration = await page.evaluate(() => window.__spike.terrainExaggeration);
  metrics.networkAtFirstUsable = await snapshot();
  await page.screenshot({ path: "shots/globe.png" });
  console.log("ready", metrics.firstUsableMs, metrics.webglRenderer);

  // ---- tour: stop 0 .. 7 in order ----
  metrics.flights = [];
  for (let index = 0; index < route.stops.length; index++) {
    if (Date.now() - scriptStart > BUDGET_MS - 60_000) {
      metrics.tourStoppedEarly = `time budget: stopped before stop ${index}`;
      break;
    }
    await page.evaluate(() => window.__spike.fpsReset());
    const started = Date.now();
    // Do not await: sample the camera while it flies.
    const done = page.evaluate((i) => window.__spike.flyToStop(i), index);
    let finished = false;
    done.then(() => (finished = true));
    const track = [];
    let midShot = false;
    while (!finished && Date.now() - started < 40_000) {
      const state = await page.evaluate(() => ({ ...window.__spike.getState(), rangeKm: window.__spike.rangeKm() }));
      track.push({ ms: Date.now() - started, lngLat: state.lngLat.map((v) => +v.toFixed(4)), rangeKm: +state.rangeKm.toFixed(1) });
      if (index === 5 && !midShot && Date.now() - started > 2500) {
        midShot = true;
        await page.screenshot({ path: "shots/flight-mid.png" }); // on the way from Bianjing to Huangzhou
      }
      await page.waitForTimeout(200);
    }
    await done;
    const totalMs = Date.now() - started;
    const result = await page.evaluate(() => ({ flight: window.__spike.lastFlight(), whole: window.__spike.fps(), state: window.__spike.getState() }));
    // How close did the look-at point come to each way point of this leg?
    const leg = index > 0 ? route.legs[index - 1] : null;
    const viaMissKm = leg ? leg.via.map((via) => +Math.min(...track.map((sample) => km(sample.lngLat, via.lngLat))).toFixed(1)) : [];
    let largestStepKm = 0;
    for (let i = 1; i < track.length; i++) largestStepKm = Math.max(largestStepKm, km(track[i - 1].lngLat, track[i].lngLat));
    metrics.flights.push({
      toStop: route.stops[index].id,
      pathKm: +result.flight.pathKm.toFixed(0),
      flightSeconds: +result.flight.seconds.toFixed(2),
      flightFpsAvg: +result.flight.avg.toFixed(1),
      flightFpsMin: +result.flight.min.toFixed(1),
      flightFrames: result.flight.samples,
      untilSettledMs: totalMs,
      fpsIncludingSettle: { avg: +result.whole.avg.toFixed(1), min: +result.whole.min.toFixed(1), samples: result.whole.samples },
      cameraSamples: track.length,
      nearestApproachToEachWayPointKm: viaMissKm,
      largestStepBetweenSamplesKm: +largestStepKm.toFixed(0),
      endState: { lngLat: result.state.lngLat.map((v) => +v.toFixed(4)), pitch: +result.state.pitch.toFixed(1), bearing: +result.state.bearing.toFixed(1), stopIndex: result.state.stopIndex },
    });
    console.log(JSON.stringify(metrics.flights.at(-1)));
  }
  const flown = metrics.flights.filter((flight) => flight.flightFrames > 0);
  const frames = flown.reduce((sum, flight) => sum + flight.flightFrames, 0);
  const seconds = flown.reduce((sum, flight) => sum + flight.flightSeconds, 0);
  metrics.flightFpsAvg = +(frames / seconds).toFixed(1); // all flight frames / all flight seconds
  metrics.flightFpsMin = Math.min(...flown.map((flight) => flight.flightFpsMin)); // slowest single frame of any flight
  metrics.networkWholeTour = await snapshot();
  metrics.tileRequests = metrics.networkWholeTour.tiles.requests;
  metrics.transferredBytes = Object.values(metrics.networkWholeTour).reduce((sum, group) => sum + group.bytes, 0);
  metrics.hostsContacted = [...hosts].sort();
  metrics.failedRequests = failed;
  metrics.pageErrors = pageErrors;
  await context.close();
} finally {
  await browser.close();
  clearTimeout(killer);
}

// ---- C10: production build size ----
const sizes = { js: [], css: [] };
for (const file of readdirSync("dist/assets")) {
  const kind = file.endsWith(".js") ? "js" : file.endsWith(".css") ? "css" : null;
  if (!kind) continue;
  const content = readFileSync(`dist/assets/${file}`);
  sizes[kind].push({ file, bytes: content.length, gzipBytes: gzipSync(content).length });
}
const sum = (list, key) => list.reduce((total, item) => total + item[key], 0);
metrics.build = {
  files: sizes,
  jsBytes: sum(sizes.js, "bytes"),
  jsGzipBytes: sum(sizes.js, "gzipBytes"),
  cssBytes: sum(sizes.css, "bytes"),
  cssGzipBytes: sum(sizes.css, "gzipBytes"),
  note: "Entry bundle only. CesiumJS also fetches worker scripts and assets from dist/cesiumStatic on demand; what the tour actually downloaded is in networkWholeTour.engineStatic.",
};
metrics.environment = {
  viewport: "1440x900, deviceScaleFactor 1",
  browser: `Playwright ${"1.65.0"} headless Chromium (chromium-headless-shell), args --use-angle=d3d11 --enable-gpu --ignore-gpu-blocklist`,
  cpu: cpus()[0].model,
  cpuCount: cpus().length,
  memoryGb: Math.round(totalmem() / 2 ** 30),
  os: process.platform,
  serving: "vite preview (production build), HTTP cache cold",
};
metrics.definitions = {
  "firstUsableMs": "wall clock from page.goto() to window.__spike.ready (all terrain and base-map tiles of the globe view loaded and drawn), cold HTTP cache, production build",
  "flightFpsAvg": "frames rendered during the camera animations of the eight flyToStop calls divided by their total duration (the wait for tiles after arrival is excluded)",
  "flightFpsMin": "1000 / the longest interval between two consecutive frames in any of those flights",
  "tileRequests": "finished requests to s3.amazonaws.com (Terrarium elevation tiles) from page load to the end of the eight-stop tour",
  "transferredBytes": "response headers + bodies of every finished request seen by the page in that period (tiles + CesiumJS static files + app bundle); requests issued inside worker threads may be missing",
  "hardware": "This machine is a cloud VM without a GPU (Win32_VideoController: Microsoft Basic Display Adapter). WebGL ran on the software rasteriser shown in webglRenderer. Frame rates are NOT hardware-accelerated numbers.",
  "concurrency": "Other headless browser tests (the competing spike) may have been running on the same machine during the measurement."
};
writeFileSync("metrics.json", JSON.stringify(metrics, null, 2));
console.log("written metrics.json", JSON.stringify({ firstUsableMs: metrics.firstUsableMs, flightFpsAvg: metrics.flightFpsAvg, flightFpsMin: metrics.flightFpsMin, tileRequests: metrics.tileRequests, transferredBytes: metrics.transferredBytes, hosts: metrics.hostsContacted }));

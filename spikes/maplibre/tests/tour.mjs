// The measured tour (C3, C4, C8): cold load, globe, the eight stops in order, the three test viewpoints.
// Writes tests/out/tour.json and the screenshots globe, stop-<id>, sanxia, huangzhou-close, dayuling.
import {
  launch, openPage, trackNetwork, shot, saveJson, hardTimeout, URL_UNDER_TEST, VIEWPORT, CHROMIUM_ARGS,
  route, routeBetween, distanceToPolylineKm, haversineKm,
} from './lib.mjs';

const disarm = hardTimeout();
const browser = await launch();
const out = { url: URL_UNDER_TEST, viewport: VIEWPORT, chromiumArgs: CHROMIUM_ARGS, browserVersion: browser.version(), startedAt: new Date().toISOString() };
try {
  const { page, problems } = await openPage(browser);
  const net = await trackNetwork(page);

  // ---- cold load
  const t0 = Date.now();
  await page.goto(URL_UNDER_TEST);
  await page.evaluate(() => window.__spike.ready);
  out.firstUsable = [{ wallMs: Date.now() - t0, readyAtMs: await page.evaluate(() => window.__spike.readyAtMs()) }];
  out.page = await page.evaluate(() => ({
    engine: window.__spike.engine,
    webglRenderer: window.__spike.webglRenderer(),
    terrainExaggeration: window.__spike.terrainExaggeration,
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    hardwareConcurrency: navigator.hardwareConcurrency,
    apiKeys: Object.keys(window.__spike),
    stops: window.__spike.stops,
    viewpoints: window.__spike.viewpoints,
    initialState: window.__spike.getState(),
  }));
  await shot(page, 'globe');
  out.networkAfterLoad = await net.snapshot();

  // ---- eight flights
  out.flights = [];
  for (let i = 0; i < route.stops.length; i++) {
    const r = await page.evaluate(async (index) => {
      const s = window.__spike;
      const samples = [];
      let recording = true;
      const start = performance.now();
      // One sample per camera move, stamped with the frame time the animation itself uses.
      const record = () => {
        const st = s.getState();
        if (recording && samples.length < 3000) samples.push([document.timeline.currentTime - start, st.lngLat[0], st.lngLat[1], st.zoom, st.pitch]);
      };
      const from = s.getState();
      s.map.on('move', record);
      s.fpsReset();
      await s.flyToStop(index);
      recording = false;
      s.map.off('move', record);
      return { promiseMs: performance.now() - start, fpsWholePromise: s.fps(), animation: s.lastFlight(), from, state: s.getState(), samples };
    }, i);

    // What the camera centre did while the animation ran.
    const line = i === 0 ? [r.from.lngLat, route.stops[0].lngLat] : routeBetween(i - 1, i);
    const moving = r.samples.filter((s) => s[0] <= r.animation.durationMs + 50);
    let maxOffRouteKm = 0, maxStepKm = 0, maxSpeedKmPerS = 0, minZoom = Infinity;
    for (let k = 0; k < moving.length; k++) {
      const p = [moving[k][1], moving[k][2]];
      maxOffRouteKm = Math.max(maxOffRouteKm, distanceToPolylineKm(p, line));
      minZoom = Math.min(minZoom, moving[k][3]);
      if (k > 0) {
        const step = haversineKm([moving[k - 1][1], moving[k - 1][2]], p);
        const dt = moving[k][0] - moving[k - 1][0];
        maxStepKm = Math.max(maxStepKm, step);
        if (dt > 0) maxSpeedKmPerS = Math.max(maxSpeedKmPerS, (step / dt) * 1000);
      }
    }
    // smootherstep peaks at 1.875 times the mean speed
    const plannedPeakKmPerS = (1.875 * r.animation.km) / (r.animation.durationMs / 1000);
    const stop = route.stops[i];
    out.flights.push({
      to: stop.id,
      pathKm: r.animation.km,
      animationMs: r.animation.durationMs,
      settleMs: r.animation.settleMs,
      promiseMs: r.promiseMs,
      animationFps: { avg: r.animation.avgFps, min: r.animation.minFps, frames: r.animation.frames },
      fpsWholePromise: r.fpsWholePromise,
      cruiseZoom: minZoom,
      maxOffRouteKm,
      maxStepKm,
      maxSpeedKmPerS,
      plannedPeakKmPerS,
      arrived: {
        state: r.state,
        centerErrorKm: haversineKm(r.state.lngLat, stop.lngLat),
        expected: stop.camera,
      },
    });
    await shot(page, `stop-${stop.id}`);
    console.log(`flight -> ${stop.id}: ${r.animation.km.toFixed(0)} km, anim ${r.animation.durationMs.toFixed(0)} ms @ ${r.animation.avgFps.toFixed(1)} fps (min ${r.animation.minFps.toFixed(1)}), promise ${r.promiseMs.toFixed(0)} ms`);
  }

  // ---- test viewpoints
  out.viewpoints = [];
  for (const vp of route.viewpoints.filter((v) => v.camera)) {
    const t = Date.now();
    await page.evaluate((id) => window.__spike.goToViewpoint(id), vp.id);
    out.viewpoints.push({ id: vp.id, ms: Date.now() - t, state: await page.evaluate(() => window.__spike.getState()), expected: vp.camera });
    await shot(page, vp.id);
  }

  out.networkWholeTour = await net.snapshot();
  out.consoleProblems = [...new Set(problems)];
  await page.context().close();

  // ---- two more cold loads, for the first-usable number only
  for (let k = 0; k < 2; k++) {
    const again = await openPage(browser);
    const t = Date.now();
    await again.page.goto(URL_UNDER_TEST);
    await again.page.evaluate(() => window.__spike.ready);
    out.firstUsable.push({ wallMs: Date.now() - t, readyAtMs: await again.page.evaluate(() => window.__spike.readyAtMs()) });
    await again.context.close();
  }
  out.finishedAt = new Date().toISOString();
  console.log('first usable (ms):', out.firstUsable.map((f) => Math.round(f.readyAtMs)).join(', '));
  console.log('renderer:', out.page.webglRenderer);
  console.log('wrote', saveJson('tour.json', out));
} finally {
  await browser.close();
  disarm();
}

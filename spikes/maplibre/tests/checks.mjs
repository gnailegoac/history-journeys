// Checks that need more than the tour: C1 (continuous zoom), C4 (mid-flight frame), C5 (names), C7 (mouse, touch, reset).
// Writes tests/out/checks.json and the screenshots c1-zoom-NN, flight-mid, names-ancient, names-modern.
import { launch, openPage, shot, saveJson, hardTimeout, URL_UNDER_TEST, VIEWPORT, route, haversineKm } from './lib.mjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { SHOTS } from './lib.mjs';

const disarm = hardTimeout();
const browser = await launch();
const out = { url: URL_UNDER_TEST, startedAt: new Date().toISOString() };
const state = (page) => page.evaluate(() => window.__spike.getState());
const settle = (page) => page.evaluate(() => new Promise((resolve) => {
  const map = window.__spike.map;
  const timer = setTimeout(resolve, 12000);
  map.once('idle', () => { clearTimeout(timer); resolve(); });
  map.triggerRepaint();
}));

try {
  const { page, context, problems } = await openPage(browser);
  // A blank page that decodes screenshots and measures how bright their middle is.
  const lab = await context.newPage();
  const brightness = (file) => lab.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    // middle 400 x 400: always on the globe or on the ground, never on the panel
    const d = ctx.getImageData(bmp.width / 2 - 200, bmp.height / 2 - 200, 400, 400).data;
    let sum = 0, dark = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += l;
      if (l < 12) dark++;
    }
    return { meanLuma: sum / (d.length / 4), darkFraction: dark / (d.length / 4) };
  }, readFileSync(file).toString('base64'));

  await page.goto(URL_UNDER_TEST);
  await page.evaluate(() => window.__spike.ready);

  // ---- C1: one uninterrupted zoom from the globe down to the gorge, photographed while it runs
  const target = route.viewpoints.find((v) => v.id === 'sanxia');
  const globeZoom = (await state(page)).zoom;
  // the viewpoint's zoom from its distance, without visiting it first (its tiles must not be in the cache)
  await page.evaluate(({ lngLat, camera }) => {
    const map = window.__spike.map;
    const cameraToCenterPx = (0.5 * map.getContainer().clientHeight) / Math.tan((map.getVerticalFieldOfView() * Math.PI) / 360);
    const metersPerPixel0 = (40075016.686 * Math.cos((lngLat[1] * Math.PI) / 180)) / 512;
    window.__c1Target = { lngLat, zoom: Math.log2((cameraToCenterPx * metersPerPixel0) / (camera.distanceKm * 1000)), pitch: camera.pitch, bearing: camera.bearing };
  }, target);
  const ZOOM_MS = 60000;
  await page.evaluate((ms) => {
    const t = window.__c1Target;
    window.__spike.map.easeTo({ center: t.lngLat, zoom: t.zoom, pitch: t.pitch, bearing: t.bearing, duration: ms, easing: (x) => x, essential: true });
  }, ZOOM_MS);
  out.c1 = { fromZoom: globeZoom, durationMs: ZOOM_MS, frames: [] };
  const tZoom = Date.now();
  for (let k = 0; k < 40 && Date.now() - tZoom < ZOOM_MS + 500; k++) {
    const name = `c1-zoom-${String(k).padStart(2, '0')}`;
    const before = await page.evaluate(() => ({ ...window.__spike.getState(), moving: window.__spike.map.isMoving() }));
    await shot(page, name);
    const after = await state(page);
    // the picture was taken somewhere between the two readings of the zoom
    out.c1.frames.push({ name, atMs: Date.now() - tZoom, zoomBefore: before.zoom, zoomAfter: after.zoom, pitch: after.pitch, moving: before.moving, ...(await brightness(path.join(SHOTS, `${name}.png`))) });
  }
  await settle(page);
  await shot(page, 'c1-zoom-end');
  out.c1.end = { ...(await state(page)), ...(await brightness(path.join(SHOTS, 'c1-zoom-end.png'))) };
  // and closer still: 4 km from the ground
  await page.evaluate(async () => {
    const s = window.__spike;
    const st = s.getState();
    s.map.easeTo({ zoom: st.zoom + Math.log2(st.distanceKm / 4), duration: 2500, essential: true });
    await new Promise((r) => s.map.once('moveend', r));
  });
  await settle(page);
  await shot(page, 'c1-zoom-4km');
  out.c1.closest = { ...(await state(page)), ...(await brightness(path.join(SHOTS, 'c1-zoom-4km.png'))) };
  out.c1.minMeanLuma = Math.min(...out.c1.frames.map((f) => f.meanLuma), out.c1.end.meanLuma, out.c1.closest.meanLuma);
  out.c1.maxDarkFraction = Math.max(...out.c1.frames.map((f) => f.darkFraction), out.c1.end.darkFraction, out.c1.closest.darkFraction);
  console.log(`C1: ${out.c1.frames.length} frames, zoom ${globeZoom.toFixed(2)} -> ${out.c1.end.zoom.toFixed(2)}, min mean luma ${out.c1.minMeanLuma.toFixed(1)}, max dark fraction ${out.c1.maxDarkFraction.toFixed(4)}`);

  // ---- C4: a frame from the middle of the flight 汴京 -> 黄州
  await page.evaluate(() => window.__spike.flyToStop(4));
  await page.evaluate(() => { window.__flight = window.__spike.flyToStop(5); });
  await page.waitForTimeout(2600);
  const mid = await state(page);
  await shot(page, 'flight-mid');
  await page.evaluate(() => window.__flight);
  const arrived = await state(page);
  out.c4mid = {
    midState: mid,
    midKmFromStart: haversineKm(mid.lngLat, route.stops[4].lngLat),
    midKmFromEnd: haversineKm(mid.lngLat, route.stops[5].lngLat),
    arrived,
    animation: await page.evaluate(() => window.__spike.lastFlight()),
  };

  // ---- C5: names at the 黄州 stop, both modes
  const shownNames = (mode) => page.evaluate((m) => {
    const map = window.__spike.map;
    return map.queryRenderedFeatures({ layers: ['stop-labels', 'local-labels'] }).map((f) => `${f.properties.kind}:${f.properties[m]}`).sort();
  }, mode);
  out.c5 = {};
  for (const mode of ['modern', 'ancient']) {
    await page.evaluate((m) => window.__spike.setNames(m), mode);
    await settle(page);
    await page.waitForTimeout(400);
    await shot(page, `names-${mode}`);
    out.c5[mode] = { namesMode: (await state(page)).namesMode, labelsInView: await shownNames(mode) };
  }
  out.c5.textField = await page.evaluate(() => window.__spike.map.getLayoutProperty('stop-labels', 'text-field'));
  out.c5.glyphsUrl = await page.evaluate(() => window.__spike.map.getStyle().glyphs ?? null);

  // ---- C7 with the mouse, at the 黄州 stop
  const preset = route.stops[5];
  const diff = (a, b) => ({ km: haversineKm(a.lngLat, b.lngLat), zoom: b.zoom - a.zoom, pitch: b.pitch - a.pitch, bearing: b.bearing - a.bearing });
  const cx = VIEWPORT.width / 2 + 150, cy = VIEWPORT.height / 2;
  out.c7mouse = {};
  let s0 = await state(page);
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(1200);
  let s1 = await state(page);
  out.c7mouse.wheelZoom = diff(s0, s1);
  await page.mouse.down();
  await page.mouse.move(cx + 120, cy + 60, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
  let s2 = await state(page);
  out.c7mouse.leftDragPan = diff(s1, s2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx + 140, cy + 50, { steps: 8 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(1200);
  let s3 = await state(page);
  out.c7mouse.rightDragRotateTilt = diff(s2, s3);
  await shot(page, 'c7-after-mouse');
  await page.getByRole('button', { name: '回到这一站' }).click();
  await page.waitForTimeout(1800);
  await settle(page);
  const back = await state(page);
  out.c7mouse.afterResetButton = {
    state: back,
    centerErrorKm: haversineKm(back.lngLat, preset.lngLat),
    pitchError: back.pitch - preset.camera.pitch,
    bearingError: back.bearing - preset.camera.bearing,
    distanceErrorKm: back.distanceKm - preset.camera.distanceKm,
  };
  out.consoleProblems = [...new Set(problems)];
  await context.close();

  // ---- C7 with touch: a second context that reports a touch screen
  const touchCtx = await openPage(browser, { hasTouch: true });
  const tp = touchCtx.page;
  await tp.goto(URL_UNDER_TEST);
  await tp.evaluate(() => window.__spike.ready);
  await tp.evaluate(() => window.__spike.flyToStop(5));
  const cdp = await touchCtx.context.newCDPSession(tp);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: points.map(([x, y], id) => ({ x: Math.round(x), y: Math.round(y), id, radiusX: 4, radiusY: 4, force: 1 })),
  });
  /** Moves the fingers from their start to their end positions in small steps. */
  const gesture = async (from, to, steps = 12) => {
    await touch('touchStart', from);
    for (let k = 1; k <= steps; k++) {
      await touch('touchMove', from.map((p, i) => [p[0] + ((to[i][0] - p[0]) * k) / steps, p[1] + ((to[i][1] - p[1]) * k) / steps]));
      await tp.waitForTimeout(40);
    }
    await touch('touchEnd', []);
    await tp.waitForTimeout(1300);
  };
  out.c7touch = { maxTouchPoints: await tp.evaluate(() => navigator.maxTouchPoints) };
  let t0s = await state(tp);
  await gesture([[cx, cy]], [[cx - 150, cy + 80]]);
  let t1s = await state(tp);
  out.c7touch.oneFingerPan = diff(t0s, t1s);
  await gesture([[cx - 60, cy], [cx + 60, cy]], [[cx - 180, cy], [cx + 180, cy]]);
  let t2s = await state(tp);
  out.c7touch.pinchZoom = diff(t1s, t2s);
  await gesture([[cx - 120, cy], [cx + 120, cy]], [[cx - 85, cy - 85], [cx + 85, cy + 85]]);
  let t3s = await state(tp);
  out.c7touch.twoFingerRotate = diff(t2s, t3s);
  await gesture([[cx - 50, cy + 100], [cx + 50, cy + 100]], [[cx - 50, cy + 220], [cx + 50, cy + 220]]);
  let t4s = await state(tp);
  out.c7touch.twoFingerTilt = diff(t3s, t4s);
  await tp.evaluate(() => window.__spike.resetView());
  await tp.waitForTimeout(1800);
  const tBack = await state(tp);
  out.c7touch.afterResetView = { centerErrorKm: haversineKm(tBack.lngLat, preset.lngLat), pitchError: tBack.pitch - preset.camera.pitch, bearingError: tBack.bearing - preset.camera.bearing };
  await touchCtx.context.close();

  out.finishedAt = new Date().toISOString();
  console.log('C5 ancient:', out.c5.ancient.labelsInView.join(' '), '| modern:', out.c5.modern.labelsInView.join(' '));
  console.log('C7 mouse:', JSON.stringify(out.c7mouse));
  console.log('C7 touch:', JSON.stringify(out.c7touch));
  console.log('wrote', saveJson('checks.json', out));
} finally {
  await browser.close();
  disarm();
}

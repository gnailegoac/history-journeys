// C1: zoom with the mouse wheel from the globe view down to one valley (Kuimen), screenshot on the way.
// Usage (server on 5412): node tests/zoom.mjs     Headless only. Hard timeout: 4 minutes.
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const URL = process.env.SPIKE_URL ?? "http://localhost:5412/";
const TARGET = [109.575, 31.04]; // Kuimen, from route.json viewpoints
const SHOT_BELOW_KM = [3000, 1000, 300, 100, 30, 10, 4];
const killer = setTimeout(() => process.exit(2), 240_000);
const browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const steps = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(URL);
  await page.waitForFunction(() => window.__spike, null, { timeout: 60_000 });
  await page.evaluate(() => window.__spike.ready);
  // Wait until the tiles of the current view are loaded (at most 15 s), then report where we are.
  const settle = () => page.evaluate(([lng, lat]) => new Promise((resolve) => {
    const { scene } = window.__spike.widget;
    const started = performance.now();
    const remove = scene.postRender.addEventListener(() => {
      if (!scene.globe.tilesLoaded && performance.now() - started < 15_000) return;
      remove();
      const point = scene.globe.ellipsoid.cartographicToCartesian({ longitude: (lng * Math.PI) / 180, latitude: (lat * Math.PI) / 180, height: 0 });
      const onScreen = scene.cartesianToCanvasCoordinates(point);
      resolve({ rangeKm: window.__spike.rangeKm(), x: onScreen?.x, y: onScreen?.y, tilesLoaded: scene.globe.tilesLoaded });
    });
  }), TARGET);
  let shot = 0;
  for (let i = 0; i < 60 && shot < SHOT_BELOW_KM.length; i++) {
    const view = await settle();
    if (view.rangeKm < SHOT_BELOW_KM[shot]) {
      shot++;
      const file = `shots/zoom-${shot}.png`;
      await page.screenshot({ path: file });
      steps.push({ file, rangeKm: +view.rangeKm.toFixed(1), tilesLoaded: view.tilesLoaded });
      console.log(JSON.stringify(steps.at(-1)));
      continue;
    }
    // The wheel zooms towards the point under the cursor: keep the cursor on the valley.
    await page.mouse.move(Math.min(1400, Math.max(300, view.x ?? 720)), Math.min(860, Math.max(40, view.y ?? 450)));
    await page.mouse.wheel(0, -400);
    await page.waitForTimeout(700);
  }
} finally {
  await browser.close();
  clearTimeout(killer);
  writeFileSync("zoom.json", JSON.stringify({ measuredAt: new Date().toISOString(), method: "mouse wheel at the valley, screenshot each time the range falls below 3000/1000/300/100/30/10/4 km", steps }, null, 2));
}

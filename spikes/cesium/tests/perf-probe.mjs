// Diagnostic, not an acceptance test: where does the frame time go on this machine?
// Part 1: idle frame rate in the Kuimen view while scene features are switched off one after another (cumulative).
// Part 2: the Bianjing <-> Huangzhou flight with default settings, with coarser terrain, and at quarter resolution.
// Usage (server on 5412): node tests/perf-probe.mjs     Headless only. Hard timeout: 4 min 50 s. Writes perf-probe.json.
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
const killer = setTimeout(() => process.exit(2), 290_000);
const browser = await chromium.launch({ headless: true, args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const out = { measuredAt: new Date().toISOString(), idleKuimenCumulative: [], flightBianjingHuangzhou: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(process.env.SPIKE_URL ?? "http://localhost:5412/");
  await page.waitForFunction(() => window.__spike, null, { timeout: 60_000 });
  await page.evaluate(() => window.__spike.ready);
  out.webglRenderer = await page.evaluate(() => window.__spike.webglRenderer());
  const apply = (change) => page.evaluate(`(${change})(window.__spike.widget)`);
  const fmt = (v) => +v.toFixed(1);

  await page.evaluate(() => window.__spike.goToViewpoint("sanxia"));
  const idle = {
    "default settings": () => {},
    "+ msaa off": (w) => (w.scene.msaaSamples = 1),
    "+ sky atmosphere off": (w) => (w.scene.skyAtmosphere.show = false),
    "+ ground atmosphere off": (w) => (w.scene.globe.showGroundAtmosphere = false),
    "+ fog off": (w) => (w.scene.fog.enabled = false),
    "+ route and names hidden": (w) => (w.entities.show = false),
    "+ terrain screen-space error 4 (default 2)": (w) => (w.scene.globe.maximumScreenSpaceError = 4),
    "+ half resolution": (w) => (w.resolutionScale = 0.5),
  };
  for (const [name, change] of Object.entries(idle)) {
    await apply(change);
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__spike.fpsReset());
    await page.waitForTimeout(3500);
    const fps = await page.evaluate(() => window.__spike.fps());
    // _surface is a private field of Cesium's Globe: used here only to count the terrain tiles drawn.
    const tiles = await page.evaluate(() => window.__spike.widget.scene.globe._surface._tilesToRender.length);
    out.idleKuimenCumulative.push({ setting: name, fpsAvg: fmt(fps.avg), fpsMin: fmt(fps.min), frames: fps.samples, terrainTilesDrawn: tiles });
    console.log(JSON.stringify(out.idleKuimenCumulative.at(-1)));
  }
  // back to defaults
  await apply((w) => { w.scene.msaaSamples = 4; w.scene.skyAtmosphere.show = true; w.scene.globe.showGroundAtmosphere = true; w.scene.fog.enabled = true; w.entities.show = true; w.scene.globe.maximumScreenSpaceError = 2; w.resolutionScale = 1; });

  const flight = async (name) => {
    await page.evaluate(() => window.__spike.flyToStop(4));
    await page.evaluate(() => window.__spike.flyToStop(5));
    const f = await page.evaluate(() => window.__spike.lastFlight());
    out.flightBianjingHuangzhou.push({ setting: name, seconds: fmt(f.seconds), fpsAvg: fmt(f.avg), fpsMin: fmt(f.min), frames: f.samples });
    console.log(JSON.stringify(out.flightBianjingHuangzhou.at(-1)));
  };
  await flight("default settings, tiles not cached");
  await flight("default settings, tiles cached");
  await apply((w) => (w.scene.globe.maximumScreenSpaceError = 4));
  await flight("terrain screen-space error 4, tiles cached");
  await apply((w) => { w.scene.globe.maximumScreenSpaceError = 2; w.resolutionScale = 0.25; });
  await flight("default detail at quarter resolution (360x225), tiles cached");
} finally {
  await browser.close();
  clearTimeout(killer);
  writeFileSync("perf-probe.json", JSON.stringify(out, null, 2));
}

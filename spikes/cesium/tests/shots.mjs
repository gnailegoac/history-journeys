// Screenshots for the deliverables plus the scripted checks for C2, C5 and C7 (C1: see zoom.mjs).
// Usage (preview or dev server running on 5412): node tests/shots.mjs
// Headless only. Hard timeout: 4 min 50 s. Writes shots/*.png and checks.json.
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const URL = process.env.SPIKE_URL ?? "http://localhost:5412/";
const killer = setTimeout(() => {
  console.error("hard timeout");
  process.exit(2);
}, 290_000);
mkdirSync("shots", { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"],
});
const checks = { measuredAt: new Date().toISOString() };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(URL);
  await page.waitForFunction(() => window.__spike, null, { timeout: 60_000 });
  await page.evaluate(() => window.__spike.ready);
  const state = () => page.evaluate(() => {
    const s = window.__spike.getState();
    return { lngLat: s.lngLat.map((v) => +v.toFixed(4)), pitch: +s.pitch.toFixed(1), bearing: +s.bearing.toFixed(1), rangeKm: +window.__spike.rangeKm().toFixed(2), stopIndex: s.stopIndex, namesMode: s.namesMode };
  });
  const frames = (n = 3) => page.evaluate((count) => new Promise((resolve) => {
    const scene = window.__spike.widget.scene;
    let left = count;
    const remove = scene.postRender.addEventListener(() => { if (--left <= 0) { remove(); resolve(); } });
  }), n);

  // C2: the three check viewpoints.
  checks.viewpoints = {};
  for (const id of ["sanxia", "huangzhou-close", "dayuling"]) {
    await page.evaluate((viewpoint) => window.__spike.goToViewpoint(viewpoint), id);
    checks.viewpoints[id] = await state();
    await page.screenshot({ path: `shots/${id}.png` });
    console.log(id, JSON.stringify(checks.viewpoints[id]));
  }

  // Stop view and C5: place names, ancient and modern.
  await page.evaluate(() => window.__spike.flyToStop(5));
  const preset = await state();
  checks.stopHuangzhou = preset;
  await page.screenshot({ path: "shots/stop-huangzhou.png" });
  await page.evaluate(() => window.__spike.setNames("ancient"));
  await frames();
  await page.screenshot({ path: "shots/names-ancient.png" });
  await page.evaluate(() => window.__spike.setNames("modern"));
  await frames();
  checks.namesModeAfterSwitch = (await state()).namesMode;
  await page.screenshot({ path: "shots/names-modern.png" });
  await page.evaluate(() => window.__spike.setNames("ancient"));

  // C7: mouse. Cesium defaults: left drag = move, ctrl + left drag (or middle drag) = tilt/turn, wheel = zoom.
  const drag = async (from, to, modifier) => {
    if (modifier) await page.keyboard.down(modifier);
    await page.mouse.move(from[0], from[1]);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / 6, from[1] + ((to[1] - from[1]) * i) / 6);
      await page.waitForTimeout(150);
    }
    await page.mouse.up();
    if (modifier) await page.keyboard.up(modifier);
    await frames();
  };
  const mouse = {};
  await drag([800, 450], [950, 520]);
  mouse.afterLeftDrag = await state();
  await page.evaluate(() => window.__spike.resetView());
  await frames();
  await drag([800, 450], [900, 380], "Control");
  mouse.afterCtrlDrag = await state();
  await page.evaluate(() => window.__spike.resetView());
  await frames();
  await page.mouse.move(800, 450);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(200);
  }
  await page.waitForTimeout(1500); // Cesium's zoom has inertia
  await frames();
  mouse.afterWheel = await state();
  await page.screenshot({ path: "shots/after-user-zoom.png" });
  await page.click("#reset"); // the "回到这一站" button itself
  await frames();
  mouse.afterResetButton = await state();
  checks.mouse = { preset, ...mouse };
  console.log("mouse", JSON.stringify(checks.mouse));

  // C7: touch, sent through the DevTools protocol as real touch input.
  const cdp = await context.newCDPSession(page);
  const touch = async (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  const gesture = async (start, end) => {
    await touch("touchStart", start);
    for (let i = 1; i <= 6; i++) {
      await touch("touchMove", start.map(([x, y], finger) => [x + ((end[finger][0] - x) * i) / 6, y + ((end[finger][1] - y) * i) / 6]));
      await page.waitForTimeout(150);
    }
    await touch("touchEnd", []);
    await page.waitForTimeout(1200);
    await frames();
  };
  const touchResult = {};
  await gesture([[800, 450]], [[950, 520]]);
  touchResult.afterOneFingerDrag = await state();
  await page.evaluate(() => window.__spike.resetView());
  await frames();
  await gesture([[780, 450], [880, 450]], [[680, 450], [980, 450]]); // fingers move apart
  touchResult.afterPinchOut = await state();
  await page.evaluate(() => window.__spike.resetView());
  await frames();
  await gesture([[780, 500], [880, 500]], [[780, 380], [880, 380]]); // two fingers move up together
  touchResult.afterTwoFingerVerticalDrag = await state();
  await page.evaluate(() => window.__spike.resetView());
  await frames();
  touchResult.afterReset = await state();
  checks.touch = { preset, ...touchResult };
  console.log("touch", JSON.stringify(checks.touch));

  checks.pageErrors = errors;
  await context.close();
} finally {
  await browser.close();
  clearTimeout(killer);
  writeFileSync("checks.json", JSON.stringify(checks, null, 2));
}

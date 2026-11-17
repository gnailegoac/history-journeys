// Where the frame time goes: the same flight (汴京 <-> 黄州) with parts of the scene switched off.
// Tiles are already cached after the warm-up, so this compares drawing cost, not loading.
// Writes tests/out/experiment.json. Not part of the acceptance run.
import { launch, openPage, saveJson, hardTimeout, URL_UNDER_TEST } from './lib.mjs';

const disarm = hardTimeout();
const browser = await launch();
const hide = (...ids) => ({ hide: ids });
const configs = [
  ['warm-up (discarded)', {}],
  ['full scene', {}],
  ['without relief-base', hide('relief-base')],
  ['without hillshade', hide('hillshade')],
  ['without colour relief (both layers)', hide('relief', 'relief-base')],
  ['without water', hide('water', 'rivers')],
  ['without 3D terrain', { terrain: false }],
  ['full scene again', {}],
];
try {
  const { page } = await openPage(browser);
  await page.goto(URL_UNDER_TEST);
  await page.evaluate(() => window.__spike.ready);
  await page.evaluate(() => window.__spike.flyToStop(4));
  const results = [];
  for (const [name, cfg] of configs) {
    const r = await page.evaluate(async (cfg) => {
      const s = window.__spike;
      const map = s.map;
      const terrain = map.getTerrain();
      for (const id of cfg.hide ?? []) map.setLayoutProperty(id, 'visibility', 'none');
      if (cfg.terrain === false) map.setTerrain(null);
      const flights = [];
      for (const index of [5, 4]) {
        await s.flyToStop(index);
        flights.push(s.lastFlight());
      }
      for (const id of cfg.hide ?? []) map.setLayoutProperty(id, 'visibility', 'visible');
      if (cfg.terrain === false) map.setTerrain(terrain);
      return flights;
    }, cfg);
    const frames = r.reduce((n, f) => n + f.frames, 0);
    const ms = r.reduce((n, f) => n + f.durationMs, 0);
    results.push({ name, avgFps: (1000 * frames) / ms, minFps: Math.min(...r.map((f) => f.minFps)), flights: r });
    console.log(name.padEnd(40), 'avg', ((1000 * frames) / ms).toFixed(1), 'fps, min', Math.min(...r.map((f) => f.minFps)).toFixed(1));
  }
  const renderer = await page.evaluate(() => window.__spike.webglRenderer());
  console.log('wrote', saveJson('experiment.json', { url: URL_UNDER_TEST, renderer, at: new Date().toISOString(), results }));
} finally {
  await browser.close();
  disarm();
}

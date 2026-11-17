// Quick look: load the page, wait for ready, run the steps given on the command line, save screenshots.
// usage: node tests/smoke.mjs <outDir> [step ...]   step = stop:<i> | view:<id> | names:<mode> | shot:<name> | zoom:<z>
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const URL = process.env.SPIKE_URL ?? 'http://localhost:5411/';
const [outDir = 'shots/debug', ...steps] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const killer = setTimeout(() => { console.error('hard timeout'); process.exit(2); }, 4 * 60 * 1000);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  page.setDefaultTimeout(60000);
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text()); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('requestfailed', (r) => console.log('[requestfailed]', r.url(), r.failure()?.errorText));
  const t0 = Date.now();
  await page.goto(URL);
  await page.evaluate(() => window.__spike.ready);
  console.log('ready after', Date.now() - t0, 'ms; renderer:', await page.evaluate(() => window.__spike.webglRenderer()));
  console.log('engine', await page.evaluate(() => window.__spike.engine));
  for (const step of steps) {
    const [kind, arg] = step.split(':');
    const t = Date.now();
    if (kind === 'stop') await page.evaluate((i) => window.__spike.flyToStop(i), Number(arg));
    else if (kind === 'view') await page.evaluate((id) => window.__spike.goToViewpoint(id), arg);
    else if (kind === 'names') await page.evaluate((m) => window.__spike.setNames(m), arg);
    else if (kind === 'zoom') await page.evaluate(async (z) => { const m = window.__spike.map; m.jumpTo({ zoom: z }); await m.once('idle'); }, Number(arg));
    else if (kind === 'wait') await page.waitForTimeout(Number(arg));
    else if (kind === 'shot') await page.screenshot({ path: path.join(outDir, `${arg}.png`) });
    if (kind !== 'shot') console.log(step, Date.now() - t, 'ms', JSON.stringify(await page.evaluate(() => ({ ...window.__spike.getState(), flight: window.__spike.lastFlight() }))));
  }
} finally {
  await browser.close();
  clearTimeout(killer);
}

// Shared helpers for the browser scripts. Headless only; every script arms a hard timeout.
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SHOTS = path.join(ROOT, 'shots');
export const URL_UNDER_TEST = process.env.SPIKE_URL ?? 'http://localhost:5411/';
export const VIEWPORT = { width: 1440, height: 900 };
export const CHROMIUM_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];
export const route = JSON.parse(readFileSync(path.join(ROOT, '..', 'shared', 'route.json'), 'utf8'));

mkdirSync(SHOTS, { recursive: true });

/** Kills the script if it runs longer than `minutes` (at most 5). */
export function hardTimeout(minutes = 4.8) {
  const timer = setTimeout(() => {
    console.error(`hard timeout after ${minutes} min`);
    process.exit(2);
  }, minutes * 60 * 1000);
  return () => clearTimeout(timer);
}

export async function launch() {
  return chromium.launch({ headless: true, args: CHROMIUM_ARGS });
}

/** New page in a fresh context (empty HTTP cache), with console errors echoed. */
export async function openPage(browser, contextOptions = {}) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, ...contextOptions });
  const page = await context.newPage();
  page.setDefaultTimeout(90000);
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  return { context, page, problems };
}

/**
 * Counts requests and transferred bytes per data source.
 * `bySource` comes from Playwright's network events (they include requests made by web workers);
 * `cdp` is a cross-check from the DevTools protocol of the page itself, which also tells cache hits apart.
 */
export async function trackNetwork(page) {
  const kinds = {
    dem: (u) => u.includes('elevation-tiles-prod/terrarium/'),
    water: (u) => u.includes('tiles.openfreemap.org/planet/'),
  };
  const kindOf = (u) => Object.keys(kinds).find((k) => kinds[k](u)) ?? 'other';
  const stats = {};
  const bucket = (k) => (stats[k] ??= { started: 0, finished: 0, aborted: 0, failed: 0, transferredBytes: 0, bodyBytes: 0 });
  const pending = [];
  const hosts = new Set();
  page.on('request', (r) => {
    bucket(kindOf(r.url())).started++;
    try { hosts.add(new URL(r.url()).host); } catch { /* data: urls */ }
  });
  page.on('requestfailed', (r) => {
    const b = bucket(kindOf(r.url()));
    if (r.failure()?.errorText === 'net::ERR_ABORTED') b.aborted++; else b.failed++;
  });
  page.on('requestfinished', (r) => {
    const b = bucket(kindOf(r.url()));
    b.finished++;
    pending.push(r.sizes().then((s) => {
      b.transferredBytes += s.responseHeadersSize + s.responseBodySize;
      b.bodyBytes += s.responseBodySize;
    }).catch(() => {}));
  });

  const cdpStats = {};
  const cdpBucket = (k) => (cdpStats[k] ??= { finished: 0, fromDiskCache: 0, encodedBytes: 0, encodedBytesOfCacheHits: 0 });
  const requests = new Map();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  cdp.on('Network.requestWillBeSent', (e) => requests.set(e.requestId, { url: e.request.url, cached: false }));
  cdp.on('Network.responseReceived', (e) => {
    const r = requests.get(e.requestId);
    if (r) r.cached = Boolean(e.response.fromDiskCache);
  });
  cdp.on('Network.loadingFinished', (e) => {
    const r = requests.get(e.requestId);
    if (!r) return;
    requests.delete(e.requestId);
    const b = cdpBucket(kindOf(r.url));
    b.finished++;
    b.encodedBytes += e.encodedDataLength;
    if (r.cached) {
      b.fromDiskCache++;
      b.encodedBytesOfCacheHits += e.encodedDataLength;
    }
  });
  cdp.on('Network.loadingFailed', (e) => requests.delete(e.requestId));

  return {
    async snapshot() {
      await Promise.all(pending);
      return { bySource: JSON.parse(JSON.stringify(stats)), cdp: JSON.parse(JSON.stringify(cdpStats)), hosts: [...hosts].sort() };
    },
  };
}

export const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

export function saveJson(name, data) {
  const file = path.join(ROOT, 'tests', 'out', name);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}
export function loadJson(name) {
  const file = path.join(ROOT, 'tests', 'out', name);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
}

const R = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;
export function haversineKm(a, b) {
  const h = Math.sin(rad(b[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
/** Distance in km from point p to the polyline, on a local flat approximation. */
export function distanceToPolylineKm(p, line) {
  const kx = 111.32 * Math.cos(rad(p[1]));
  const ky = 110.57;
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1][0] - p[0]) * kx, ay = (line[i - 1][1] - p[1]) * ky;
    const bx = (line[i][0] - p[0]) * kx, by = (line[i][1] - p[1]) * ky;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
/** Route points from stop a to stop b, the same way the page builds them. */
export function routeBetween(a, b) {
  if (a > b) return routeBetween(b, a).reverse();
  const pts = [route.stops[a].lngLat];
  for (let i = a; i < b; i++) {
    const leg = route.legs.find((l) => l.from === route.stops[i].id && l.to === route.stops[i + 1].id);
    pts.push(...leg.via.map((v) => v.lngLat), route.stops[i + 1].lngLat);
  }
  return pts;
}

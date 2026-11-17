// 地图适配层的浏览器检查脚本共用的东西。都是无界面运行，每个脚本自带强制超时。
// 先起服务：npx vite --port 5411 --strictPort
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SHOTS = path.join(ROOT, 'tests', 'shots', 'map');
export const PAGE_URL = process.env.MAP_DEV_URL ?? 'http://localhost:5411/map-dev.html';
export const DESKTOP = { width: 1440, height: 900 };
export const PHONE = { width: 390, height: 844 };
// 这台机器没有显卡，WebGL 由 CPU 渲染
const CHROMIUM_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'];

mkdirSync(SHOTS, { recursive: true });

/** 超过 minutes 分钟就结束整个脚本。 */
export function hardTimeout(minutes) {
  const timer = setTimeout(() => {
    console.error(`超过 ${minutes} 分钟，强制结束`);
    process.exit(2);
  }, minutes * 60 * 1000);
  return () => clearTimeout(timer);
}

export const launch = () => chromium.launch({ headless: true, args: CHROMIUM_ARGS });

/** 新的浏览器环境（HTTP 缓存是空的）里开一页，并记下控制台里的警告和错误。 */
export async function openPage(browser, contextOptions = {}) {
  const context = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1, ...contextOptions });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  // 开发服务器在别人改了文件时会让页面自动刷新，测到一半就断了。把它的通知通道接到一个不说话的假服务上。
  await page.routeWebSocket(/.*/, () => {});
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
  return { context, page, problems };
}

function kindOf(url) {
  if (url.includes('elevation-tiles-prod/terrarium/')) return 'dem';
  if (url.includes('tiles.openfreemap.org/planet/')) return 'water';
  if (url.includes('tiles.openfreemap.org')) return 'tilejson';
  if (url.includes('far-water')) return 'farWater';
  return 'page';
}

/**
 * 按数据来源统计请求数和传输的字节数。
 * 用的是 Playwright 的网络事件（包括 worker 里发的请求）：传输字节 = 响应头 + 响应体在线路上的大小，
 * 直接取自浏览器缓存的请求传输为 0。
 */
export function trackNetwork(page) {
  const stats = {};
  const bucket = (k) => (stats[k] ??= { started: 0, finished: 0, aborted: 0, failed: 0, transferredBytes: 0 });
  const pending = [];
  page.on('request', (r) => {
    const b = bucket(kindOf(r.url()));
    b.started++;
    // 瓦片按级别再数一遍（地址形如 …/{z}/{x}/{y}.png）
    const z = /\/(\d+)\/\d+\/\d+\.(png|pbf)/.exec(r.url())?.[1];
    if (z) (b.byZoom ??= {})[z] = (b.byZoom[z] ?? 0) + 1;
  });
  page.on('requestfailed', (r) => {
    const b = bucket(kindOf(r.url()));
    if (r.failure()?.errorText === 'net::ERR_ABORTED') b.aborted++;
    else b.failed++;
  });
  page.on('requestfinished', (r) => {
    const b = bucket(kindOf(r.url()));
    b.finished++;
    pending.push(
      r
        .sizes()
        .then((s) => {
          b.transferredBytes += s.responseHeadersSize + s.responseBodySize;
        })
        .catch(() => {}),
    );
  });
  return {
    async snapshot() {
      await Promise.all(pending.splice(0));
      return JSON.parse(JSON.stringify(stats));
    },
  };
}

/** 两次快照之差。 */
export function diff(after, before) {
  const out = {};
  for (const k of Object.keys(after)) {
    out[k] = {};
    for (const f of Object.keys(after[k])) {
      if (f === 'byZoom') {
        out[k].byZoom = {};
        for (const z of Object.keys(after[k].byZoom)) {
          const n = after[k].byZoom[z] - (before[k]?.byZoom?.[z] ?? 0);
          if (n) out[k].byZoom[z] = n;
        }
      } else out[k][f] = after[k][f] - (before[k]?.[f] ?? 0);
    }
  }
  return out;
}

/** 等测试页的地图可用。 */
export const waitReady = (page) => page.evaluate(() => window.__mapDev.ready);

/** 等瓦片到齐、画面不再变化（最多 maxMs）。 */
export const waitIdle = (page, maxMs = 25000) =>
  page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const map = window.__mapDev.map;
        const timer = setTimeout(() => resolve(false), ms);
        map.once('idle', () => {
          clearTimeout(timer);
          resolve(true);
        });
        map.triggerRepaint();
      }),
    maxMs,
  );

export const camera = (page) =>
  page.evaluate(() => {
    const map = window.__mapDev.map;
    const c = map.getCenter();
    return { lng: c.lng, lat: c.lat, zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing() };
  });

/** 某一站的预设镜头，按和适配层一样的公式算（用来核对“正好停在预设位置”）。 */
export const preset = (page, stopId) =>
  page.evaluate((id) => {
    const { map, route } = window.__mapDev;
    const stop = route.stops.find((s) => s.id === id);
    const pane = map.getContainer();
    const px = (0.5 * pane.clientHeight) / Math.tan((map.getVerticalFieldOfView() * Math.PI) / 360);
    const mpp0 = (40075016.686 * Math.cos((stop.lngLat[1] * Math.PI) / 180)) / 512;
    // 地图小的时候各站的镜头按比例拉近，和 flight.ts 里的 stopDistanceScale 一样
    const scale = Math.min(1, Math.max(0.55, Math.min(pane.clientWidth, pane.clientHeight) / 720));
    return {
      lng: stop.lngLat[0],
      lat: stop.lngLat[1],
      zoom: Math.log2((px * mpp0) / (stop.camera.distanceKm * 1000 * scale)),
      pitch: stop.camera.pitch,
      bearing: stop.camera.bearing,
    };
  }, stopId);

/** 两个镜头之间各项的最大差。 */
export function cameraError(a, b) {
  const turn = Math.abs(((((a.bearing - b.bearing) % 360) + 540) % 360) - 180);
  return Math.max(Math.abs(a.lng - b.lng), Math.abs(a.lat - b.lat), Math.abs(a.zoom - b.zoom), Math.abs(a.pitch - b.pitch), turn);
}

export const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

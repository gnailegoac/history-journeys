// 走一遍主要画面：截图，并量出“加载总览”和“从总览到黄州”各传输了多少字节。
// 运行：node tests/map/tour.mjs（先起 npx vite --port 5411 --strictPort）
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { PAGE_URL, SHOTS, camera, cameraError, diff, hardTimeout, launch, openPage, preset, shot, sleep, trackNetwork, waitIdle, waitReady } from './lib.mjs';

const stopTimer = hardTimeout(8);
const browser = await launch();
const result = { url: PAGE_URL, steps: {} };
try {
  const { page, problems } = await openPage(browser);
  const net = trackNetwork(page);
  const t0 = Date.now();
  await page.goto(PAGE_URL);
  await waitReady(page);
  result.readyMs = Date.now() - t0;
  await waitIdle(page);
  await shot(page, 'overview');
  const afterOverview = await net.snapshot();
  result.steps.overview = { camera: await camera(page), network: afterOverview };

  // 从总览直接降到黄州
  let t = Date.now();
  await page.evaluate(() => window.__mapDev.view.goToStop('huangzhou'));
  result.steps.toHuangzhou = { ms: Date.now() - t, error: cameraError(await camera(page), await preset(page, 'huangzhou')) };
  await shot(page, 'stop-huangzhou');
  const afterHuangzhou = await net.snapshot();
  result.steps.toHuangzhou.network = diff(afterHuangzhou, afterOverview);

  // 今名
  await page.evaluate(() => window.__mapDev.view.setNamesMode('modern'));
  await waitIdle(page);
  await shot(page, 'names-modern');
  await page.evaluate(() => window.__mapDev.view.setNamesMode('ancient'));

  // 黄州到汴京是相邻两站：沿轨迹飞，飞到一半截一张
  t = Date.now();
  const flight = page.evaluate(() => window.__mapDev.view.goToStop('bianjing'));
  await sleep(2300);
  result.steps.flightMid = { atMs: Date.now() - t, camera: await camera(page) };
  await shot(page, 'flight-mid');
  await flight;
  result.steps.toBianjing = { ms: Date.now() - t, error: cameraError(await camera(page), await preset(page, 'bianjing')) };

  // 汴京到徐州也是相邻两站
  t = Date.now();
  await page.evaluate(() => window.__mapDev.view.goToStop('xuzhou'));
  result.steps.toXuzhou = { ms: Date.now() - t, error: cameraError(await camera(page), await preset(page, 'xuzhou')) };
  await shot(page, 'stop-xuzhou');

  // 珠江三角洲：低地要画成陆地
  await page.evaluate(() => window.__mapDev.map.jumpTo({ center: [113.42, 22.95], zoom: 9.4, pitch: 0, bearing: 0 }));
  await waitIdle(page);
  await shot(page, 'delta-guangzhou');

  // 中等缩放时的长江
  await page.evaluate(() => window.__mapDev.map.jumpTo({ center: [114.6, 30.4], zoom: 7.6, pitch: 0, bearing: 0 }));
  await waitIdle(page);
  await shot(page, 'yangtze-midzoom');

  result.total = await net.snapshot();
  result.problems = problems;
} finally {
  await browser.close();
  stopTimer();
}
writeFileSync(path.join(SHOTS, 'tour.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));

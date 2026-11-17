// 最短的一次检查：打开测试页，等地图可用，截一张总览，列出控制台里的问题。
// 运行：node tests/map/smoke.mjs [截图名]
import { PAGE_URL, camera, hardTimeout, launch, openPage, shot, trackNetwork, waitIdle, waitReady } from './lib.mjs';

const stopTimer = hardTimeout(3);
const browser = await launch();
try {
  const { page, problems } = await openPage(browser);
  const net = trackNetwork(page);
  const t0 = Date.now();
  await page.goto(PAGE_URL);
  let ready = 'ok';
  try {
    await waitReady(page);
  } catch (error) {
    ready = String(error);
  }
  const readyMs = Date.now() - t0;
  const idle = ready === 'ok' ? await waitIdle(page) : false;
  await shot(page, process.argv[2] ?? 'smoke');
  console.log(JSON.stringify({ ready, readyMs, idle, camera: ready === 'ok' ? await camera(page) : null, network: await net.snapshot(), problems }, null, 2));
} finally {
  await browser.close();
  stopTimer();
}

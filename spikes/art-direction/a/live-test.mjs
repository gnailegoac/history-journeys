// 开发用：不带 ?shot 打开站点页，往下滚到某一节，等镜头飞完，拍一张。检查“镜头跟着正文走”能用。
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
await page.goto('http://localhost:5421/a/index.html', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
for (const [id, file] of [['sec-5', 'live-hills.png'], ['sec-7', 'live-leave.png'], ['sec-2', 'live-rise.png']]) {
  await page.evaluate((i) => { const el = document.getElementById(i); window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 6); }, id);
  await page.waitForTimeout(6000);
  const shot = await page.evaluate(() => window.__table.shot);
  await page.screenshot({ path: 'shots-work/' + file });
  console.log(id, '→', shot);
}
// 点一下“问讲解员”
await page.click('#ask');
await page.waitForTimeout(300);
await page.screenshot({ path: 'shots-work/live-ask.png' });
console.log(problems.join('\n') || 'no errors');
await browser.close();

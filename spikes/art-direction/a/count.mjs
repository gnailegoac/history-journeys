// 开发用：数一数场景里实际有多少三角形、多少张网格（不算影子和倒影那两遍）。
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(m.type() + ': ' + m.text()); });
for (const shot of ['arrive', 'flood', 'close']) {
  await page.goto('http://localhost:5421/a/index.html?shot=' + shot, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', null, { timeout: 180000 });
  const r = await page.evaluate(() => {
    const t = window.__table;
    let tris = 0, meshes = 0;
    t.scene.traverseVisible((o) => {
      if (!o.isMesh) return;
      const g = o.geometry;
      const n = (g.index ? g.index.count : g.attributes.position.count) / 3;
      tris += n * (o.isInstancedMesh ? o.count : 1);
      meshes++;
    });
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) t.render();
    t.renderer.getContext().finish();
    return { tris: Math.round(tris), meshes, frame: t.renderer.info.render, ms: Math.round((performance.now() - t0) / 5) };
  });
  console.log(shot, JSON.stringify(r));
}
console.log(problems.join('\n') || 'no errors or warnings');
await browser.close();

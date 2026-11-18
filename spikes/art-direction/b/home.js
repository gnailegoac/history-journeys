// 首页：三张人物卡片，旁边摆着一块沙盘（苏轼在徐州的那一站）。

import { createSandTable } from './scene/sandtable.js';
import { mountOverlay } from './overlay.js';

const figs = await fetch('../shared/figures-index.json').then((r) => r.json());
figs.sort((a, b) => a.sortYear - b.sortYear);
const list = document.getElementById('figs');
for (const f of figs) {
  const li = document.createElement('li');
  const card = document.createElement(f.available ? 'a' : 'div');
  card.className = 'fig' + (f.available ? '' : ' soon');
  if (f.available) card.href = './index.html';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = f.name;
  const body = document.createElement('div');
  const era = document.createElement('div');
  era.className = 'era';
  era.textContent = `${f.era} · ${f.years}`;
  const tag = document.createElement('p');
  tag.className = 'tag';
  tag.textContent = f.tagline;
  body.append(era, tag);
  if (f.available) {
    // 八站的地名排成一行：这就是“他走过的路”
    try {
      const fig = await fetch('../shared/su-shi-figure.json').then((r) => r.json());
      const route = document.createElement('div');
      route.className = 'route';
      for (const s of fig.stops) {
        const el = document.createElement('span');
        el.textContent = s.title.split('：')[0].split('到')[0];
        route.append(el);
      }
      body.append(route);
    } catch {
      // 没有这份数据就不排
    }
    const go = document.createElement('span');
    go.className = 'go';
    go.textContent = '从第一站读起';
    body.append(go);
  } else {
    const ny = document.createElement('span');
    ny.className = 'notyet';
    ny.textContent = '还没写';
    card.append(ny);
  }
  card.append(name, body);
  li.append(card);
  list.append(li);
}

await document.fonts.ready;
const q = new URLSearchParams(location.search);
const table = await createSandTable(document.getElementById('table'), { shot: q.get('shot') || 'home' });
window.table = table;
const overlay = mountOverlay(document.getElementById('scene'), table, { ex: 6 });
overlay.setShot(table.shot);
window.__overlay = overlay;
// “案上这一块是哪一站”那行小字，摆在沙盘前框的正下方
const plate = document.getElementById('plate');
const placePlate = () => {
  const p = table.project(-450, -800, 4300 + 1000);
  plate.style.left = p.x.toFixed(0) + 'px';
  plate.style.top = (p.y + 30).toFixed(0) + 'px';
};
table.onAfterRender(placePlate);
placePlate();
window.addEventListener('resize', () => {
  table.resize();
  table.setShot(table.shot);
});
requestAnimationFrame(() => {
  table.render();
  requestAnimationFrame(() => {
    window.__ready = true;
  });
});

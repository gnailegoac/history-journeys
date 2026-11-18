// 首页：标题、三张人物卡片。上面一整幅是沙盘（徐州，大水围城）：墙里是干的，墙外是水。
import { createTable } from './table.js';

const SHARED = '../shared/';
const esc = (s) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);

async function main() {
  const figures = await fetch(SHARED + 'figures-index.json').then((r) => r.json());
  figures.sort((a, b) => a.sortYear - b.sortYear);
  const box = document.getElementById('figures');
  for (const f of figures) {
    const el = document.createElement(f.available ? 'a' : 'div');
    el.className = 'figure-card ' + (f.available ? 'open' : 'soon');
    if (f.available) el.href = 'index.html';
    el.innerHTML = `
      <div class="card-plate"${f.available ? ' id="card-plate"' : ''}>${f.available ? '<small>第 4 站 · 徐州东门上的黄楼</small>' : ''}</div>
      <div class="body">
        <div class="era"><span>${esc(f.era)}　${esc(f.years)}</span>${f.available ? '' : '<span class="tag-soon">还没写</span>'}</div>
        <h2 class="name">${esc(f.name)}</h2>
        <p class="line">${esc(f.tagline)}</p>
        <div class="foot">${f.available ? '<span>八站 · 从眉山到儋州</span><span class="go">从第一站读起　→</span>' : ''}</div>
      </div>`;
    box.appendChild(el);
  }

  // 沙盘：同站点页“住在城墙上”一节一个方向（从戏马台上头往北偏东看），近一些。
  // 宽屏上城在右边，左边的水面留给标题；窄屏上城在下半幅。
  const wide = window.innerWidth > 960;
  const view = wide
    ? { target: [-640, 0, 150], halfW: 1500, halfH: 560, el: 31 }
    : { target: [120, 0, -1050], halfW: 860, halfH: 1500, el: 36 };
  const table = await createTable(document.getElementById('table'), {
    shot: 'flood',
    sharedBase: SHARED,
    custom: {
      ...view,
      az: -24,
      fov: 27,
      shadow: 4200,
      shadowAt: [200, 0, -200],
      plate: false,
      gloss: [-4, 0.2],
      labels: [{ pin: 'westGateTop', text: '徐州', h: 34 }],
      labelsNarrow: [{ pin: 'westGateTop', text: '徐州', h: 26 }],
    },
  });
  window.__table = table;

  // 指北和比例尺
  const needle = document.getElementById('needle');
  const needleN = document.getElementById('needle-n');
  const scaleEl = document.getElementById('scale');
  const mark = () => {
    const a = table.northAngle();
    needle.setAttribute('transform', `rotate(${a.toFixed(1)})`);
    const r = (a * Math.PI) / 180;
    needleN.setAttribute('x', (Math.sin(r) * 17).toFixed(1));
    needleN.setAttribute('y', (-Math.cos(r) * 17).toFixed(1));
    const ppm = table.pxPerMeter();
    let len = 20;
    for (const n of [20, 50, 100, 200, 500, 1000, 2000]) if (n * ppm <= 112) len = n;
    scaleEl.firstElementChild.style.width = (len * ppm).toFixed(1) + 'px';
    scaleEl.lastElementChild.textContent = len >= 1000 ? `${len / 1000} 公里` : `${len} 米`;
  };
  table.onRender(mark);

  // 苏轼那张卡片上的一条照片：水退以后，东门上的黄楼（用同一张沙盘另拍一张小的）
  const slot = document.getElementById('card-plate');
  if (slot) {
    const w = Math.max(240, Math.round(slot.clientWidth));
    const h = Math.max(70, Math.round(slot.clientHeight));
    const shot = table.snapshot('close', w, h, { target: [628, 138, 4], az: 62, el: 9, halfW: 196, halfH: 57, tilt: null, labels: [] });
    slot.prepend(shot);
  }

  await document.fonts.ready;
  table.render();
  requestAnimationFrame(() => {
    window.__info = { ...table.stats(), ...table.models.counts };
    window.__ready = true;
  });
}

main();

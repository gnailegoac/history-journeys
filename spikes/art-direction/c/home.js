// 首页：标题、三张人物卡片，右上是同一座沙盘。
import { createSandTable, EXAG } from './scene/sandtable.js';

const q = new URLSearchParams(location.search);

// 还没写的两位：卡片底边一条线画，只占最下面一小条，不压字。都是代码画的。
const STRIP = {
  // 徐霞客：一层一层的山脊，山脚下一条走过的路
  'xu-xiake': () => {
    const ridge = (seed, base, amp, n = 56) => {
      let a = seed;
      const r = () => {
        a = (a * 16807) % 2147483647;
        return a / 2147483647;
      };
      const ph = [r() * 6.28, r() * 6.28, r() * 6.28];
      let d = '';
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = t * 420;
        const y = base - amp * (0.55 * Math.abs(Math.sin(t * 5.2 + ph[0])) + 0.3 * Math.abs(Math.sin(t * 11.7 + ph[1])) + 0.15 * Math.sin(t * 27 + ph[2]));
        d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
      }
      return d;
    };
    return `<svg viewBox="0 0 420 72" preserveAspectRatio="xMidYMax slice">
      <path d="${ridge(11, 46, 34)}" fill="none" stroke="currentColor" stroke-width="1.6" opacity="0.38"/>
      <path d="${ridge(29, 58, 30)}" fill="none" stroke="currentColor" stroke-width="1.8" opacity="0.6"/>
      <path d="${ridge(53, 70, 22)}" fill="none" stroke="currentColor" stroke-width="2" opacity="0.9"/>
      <path d="M0 66 C60 58 110 70 170 62 S290 54 340 62 400 60 420 56" fill="none" stroke="currentColor" stroke-width="2.4" stroke-dasharray="0.1 7" stroke-linecap="round"/>
    </svg>`;
  },
  // 达尔文：一大弧地球的经纬线，一条绕过去的航线
  darwin: () => {
    let s = '';
    const cx = 210;
    const cy = 372;
    const R = 340;
    s += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="currentColor" stroke-width="2"/>`;
    for (const rx of [70, 150, 228, 292]) s += `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${R}" fill="none" stroke="currentColor" stroke-width="1.3" opacity="0.7"/>`;
    s += `<line x1="${cx}" y1="${cy - R}" x2="${cx}" y2="72" stroke="currentColor" stroke-width="1.3" opacity="0.7"/>`;
    for (const dy of [22, 46]) {
      const y = cy - R + dy;
      const half = Math.sqrt(R * R - (R - dy) * (R - dy));
      s += `<path d="M${cx - half} ${y} Q${cx} ${y + 13} ${cx + half} ${y}" fill="none" stroke="currentColor" stroke-width="1.3" opacity="0.7"/>`;
    }
    s += `<path d="M36 72 C96 46 150 62 214 50 S330 40 396 66" fill="none" stroke="currentColor" stroke-width="2.6" stroke-dasharray="0.1 7.5" stroke-linecap="round"/>`;
    return `<svg viewBox="0 0 420 72" preserveAspectRatio="xMidYMax slice">${s}</svg>`;
  },
};

const ARROW = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h11M10.5 5l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

async function renderCards() {
  const [figures, suShi] = await Promise.all([fetch('../shared/figures-index.json').then((r) => r.json()), fetch('../shared/su-shi-figure.json').then((r) => r.json())]);
  figures.sort((a, b) => a.sortYear - b.sortYear);
  const route = suShi.stops.map((s) => s.shortTitle ?? s.place.ancient);
  const root = document.getElementById('cards');
  root.innerHTML = figures
    .map((f) => {
      const top = `<div class="fig-top"><span class="fig-era">${f.era}</span><span>${f.years}</span>${f.available ? '' : '<span class="fig-soon">还没写</span>'}</div>`;
      const name = `<h3 class="fig-name">${f.name}</h3>`;
      const tag = `<p class="fig-tag">${f.tagline}</p>`;
      if (f.available) {
        // 右上角是他自己那座沙盘上的一小块：徐州城和河湾（沙盘建好以后填进去）
        const cut = `<span class="fig-cut"><img id="cut" alt="徐州城和两条河的沙盘" /></span>`;
        // 八站分两行，每行四站
        const half = Math.ceil(route.length / 2);
        const row = (list, cont) => `<ol class="fig-route${cont ? ' cont' : ''}">${list.map((r) => `<li>${r}</li>`).join('')}</ol>`;
        const stops = `<div class="fig-routes">${row(route.slice(0, half), false)}${row(route.slice(half), true)}</div>`;
        const foot = `<div class="fig-foot">${stops}<span class="fig-go" aria-hidden="true">${ARROW}</span></div>`;
        return `<a class="fig open ${f.id}" href="./index.html" aria-label="${f.name}">${cut}${top}${name}${tag}${foot}</a>`;
      }
      return `<div class="fig soon ${f.id}" aria-disabled="true">${top}${name}${tag}<div class="strip">${STRIP[f.id]?.() ?? ''}</div></div>`;
    })
    .join('');
}

await renderCards();
document.getElementById('heroNote').textContent = `沙盘上是徐州，苏轼的第 4 站。河道、城墙是示意；楼台房屋比实际大得多；山的高度夸大了 ${EXAG} 倍；地形是今天的。`;
await document.fonts.ready;

const canvas = document.getElementById('stage');

function freeRect() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w <= 900) return { x0: 0, y0: 44, x1: w, y1: canvas.clientHeight - 6 };
  const cards = document.querySelector('.figures').getBoundingClientRect();
  // 整张沙盘连托盘都露出来，不贴边
  return { x0: Math.min(486, w * 0.36), y0: 26, x1: w - 26, y1: cards.top - 4 };
}

const st = await createSandTable({
  canvas,
  labelLayer: document.getElementById('labels'),
  getFreeRect: freeRect,
  tone: q.get('tm') || 'neutral',
});
window.st = st;
const HERO_LABELS = {
  city: { stem: 44, text: '徐州' },
  bian: { stem: 22 },
  si: { stem: 22 },
};
st.setShot('hero', HERO_LABELS);

// 苏轼卡片上的小图：从同一座沙盘上换个镜头拍一张
const cutImg = document.getElementById('cut');
if (cutImg) {
  const r = cutImg.parentElement.getBoundingClientRect();
  cutImg.src = st.snapshot('thumb', Math.round(r.width), Math.round(r.height), 2);
  await cutImg.decode().catch(() => {});
}
st.render();

window.addEventListener('resize', () => {
  st.resize();
  st.setShot('hero', HERO_LABELS);
  st.render();
});

st.render();
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    window.__ready = true;
  }),
);

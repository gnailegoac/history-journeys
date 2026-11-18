// 站点页：左边是正文，后面是沙盘。正文读到哪一节，沙盘就看哪里。
// ?shot=arrive|flood|close 可以直接定在某个镜头上（出样张用）；?note=n5 打开某条小注；?full=1 只看沙盘（调试用）。
import { createSandTable, SHOTS, EXAG } from './scene/sandtable.js';

const q = new URLSearchParams(location.search);
const shotParam = SHOTS[q.get('shot')] ? q.get('shot') : null;
const full = q.get('full') === '1';
if (full) document.body.classList.add('full');

const KIND = { history: '历史', geography: '地理', humanities: '人文', science: '科学' };

// 每一节用哪个镜头。样张只做了三个镜头，其余几节先看全景。
const SECTION_SHOT = {
  到徐州: 'arrive',
  住在城墙上: 'flood',
  水退以后: 'close',
};

// 每个镜头里露出哪些地名，针有多长、牌子往哪边让一点
const LABELS = {
  arrive: {
    city: { stem: 44, dx: 6 },
    ximatai: { stem: 12, dx: -46, below: true },
    yunlong: { stem: 10, below: true },
    baibuhong: { stem: 26, dx: 30 },
    bian: { stem: 24 },
    si: { stem: 24 },
  },
  flood: {
    city: { stem: 58 },
    ximatai: { stem: 6, dx: -62 },
    dike: { stem: 30, dx: 34, below: true },
    bian: { stem: 24 },
    si: { stem: 24 },
  },
  close: {
    huanglou: { stem: 30 },
    sijoin: { stem: 22, dx: 10 },
  },
};
// 手机上画面窄，牌子少放几块、针短一点
const LABELS_NARROW = {
  arrive: {
    city: { stem: 26, dx: 4 },
    ximatai: { stem: 8, dx: -30, below: true },
    bian: { stem: 14 },
    si: { stem: 14 },
  },
  flood: {
    city: { stem: 40 },
    ximatai: { stem: 6, dx: -50 },
    bian: { stem: 16 },
  },
  close: {
    huanglou: { stem: 24 },
  },
};
const narrow = () => window.innerWidth <= 900;
const labelsFor = (name) => (narrow() ? LABELS_NARROW : LABELS)[name];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function loadText() {
  const [md, data] = await Promise.all([fetch('../shared/xuzhou.md').then((r) => r.text()), fetch('../shared/xuzhou.json').then((r) => r.json())]);
  const sections = [];
  for (const line of md.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('## ')) sections.push({ heading: t.slice(3).trim(), paras: [] });
    else if (sections.length) sections[sections.length - 1].paras.push(t);
  }
  return { sections, notes: data.notes };
}

function renderText({ sections, notes }) {
  const root = document.getElementById('text');
  const used = new Set();
  const html = sections
    .map((s, si) => {
      const paras = s.paras
        .map((p) => {
          let h = esc(p);
          for (const n of notes) {
            if (used.has(n.id)) continue;
            const i = h.indexOf(n.anchor);
            if (i < 0) continue;
            used.add(n.id);
            h = `${h.slice(0, i)}<span class="anchor" role="button" tabindex="0" data-note="${n.id}">${n.anchor}</span>${h.slice(i + n.anchor.length)}`;
          }
          return `<p>${h}</p>`;
        })
        .join('');
      return `<section data-heading="${s.heading}" data-index="${si}"><h2>${s.heading}</h2>${paras}</section>`;
    })
    .join('');
  root.innerHTML = html;

  const byId = Object.fromEntries(notes.map((n) => [n.id, n]));
  function toggle(id, open) {
    const a = root.querySelector(`.anchor[data-note="${id}"]`);
    if (!a) return;
    const p = a.closest('p');
    const existing = root.querySelector(`.note[data-note="${id}"]`);
    if (existing) {
      existing.remove();
      a.classList.remove('open');
      if (open !== true) return;
    }
    if (open === false) return;
    const n = byId[id];
    const el = document.createElement('aside');
    el.className = 'note';
    el.dataset.note = id;
    el.innerHTML = `<div class="note-head"><span class="note-kind">${KIND[n.kind] ?? ''}</span><span class="note-title">${esc(n.title)}</span><button class="note-close" type="button" aria-label="收起"><svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 2l10 10M12 2 2 12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></div><p class="note-body">${esc(n.body)}</p>`;
    // 小三角对准那个词
    p.after(el);
    const ar = a.getBoundingClientRect();
    const pr = el.getBoundingClientRect();
    el.style.setProperty('--tip', `${Math.max(18, Math.min(pr.width - 30, ar.left + ar.width / 2 - pr.left - 6))}px`);
    el.querySelector('.note-close').addEventListener('click', () => toggle(id, false));
    a.classList.add('open');
  }
  root.addEventListener('click', (e) => {
    const a = e.target.closest('.anchor');
    if (a) toggle(a.dataset.note);
  });
  root.addEventListener('keydown', (e) => {
    const a = e.target.closest('.anchor');
    if (a && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      toggle(a.dataset.note);
    }
  });
  return { toggle };
}

const content = await loadText();
const text = renderText(content);
await document.fonts.ready;

const canvas = document.getElementById('stage');
const reader = document.getElementById('reader');
const scroller = document.getElementById('scroll');
const headline = document.querySelector('.headline');
const legend = document.getElementById('legend');

/** 沙盘可以用的那一块：宽屏上是正文卡片右边、站名下面；手机上是顶栏下面的那一条。 */
function freeRect() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (w <= 900) return { x0: 0, y0: 50, x1: w, y1: canvas.clientHeight - 6 };
  const top = headline.getBoundingClientRect().bottom;
  if (full) return { x0: 0, y0: 0, x1: w, y1: h };
  const r = reader.getBoundingClientRect();
  return { x0: r.right + 8, y0: top - 6, x1: w - 8, y1: h - 4 };
}

const st = await createSandTable({
  canvas,
  labelLayer: document.getElementById('labels'),
  getFreeRect: freeRect,
  tone: q.get('tm') || 'neutral',
});
window.st = st;

function updateLegend(name, heading) {
  const shot = SHOTS[name];
  document.getElementById('viewing').textContent = heading ?? shot.section;
  document.getElementById('compass').style.transform = `rotate(${st.northAngle().toFixed(1)}deg)`;
  const pxKm = st.kmInPixels();
  const steps = [5, 2, 1, 0.5, 0.2, 0.1, 0.05];
  const km = steps.find((s) => s * pxKm <= 124 && s * pxKm >= 50) ?? steps.find((s) => s * pxKm <= 124) ?? 0.05;
  document.getElementById('scalebar').style.width = `${Math.round(km * pxKm)}px`;
  document.getElementById('scaletext').textContent = km >= 1 ? `${km} 公里` : `${km * 1000} 米`;
  const flood = shot.water === 'flood';
  document.getElementById('honest').textContent =
    `河道、城墙${flood ? '和大水的水位' : ''}是示意；楼台房屋比实际大得多，比例尺只量地面；山的高度夸大了 ${EXAG} 倍。` +
    `地形是今天的，平地压平过，城南的高地是照正文垫的。`;
}

let currentShot = null;
let currentHeading = null;
function show(name, heading) {
  if (name === currentShot && heading === currentHeading) return;
  if (name !== currentShot) {
    st.setShot(name, labelsFor(name));
    st.render();
  }
  currentShot = name;
  currentHeading = heading;
  updateLegend(name, heading);
}

const sectionEls = [...document.querySelectorAll('#text section')];
function markActive(heading) {
  for (const el of sectionEls) {
    el.classList.toggle('active', el.dataset.heading === heading);
    el.classList.toggle('no-shot', !SECTION_SHOT[el.dataset.heading]);
  }
}

function activeSection() {
  // 宽屏上是卡片里面在滚；手机上是整页在滚，正文从钉在上面的沙盘底下出来
  const top = narrow() ? canvas.clientHeight : scroller.getBoundingClientRect().top;
  const span = narrow() ? window.innerHeight - top : scroller.clientHeight;
  let best = sectionEls[0];
  for (const el of sectionEls) {
    if (el.getBoundingClientRect().top - top < span * 0.36) best = el;
  }
  return best.dataset.heading;
}

if (shotParam) {
  // 定在一个镜头上：把正文滚到对应的一节
  const heading = SHOTS[shotParam].section;
  const el = sectionEls.find((s) => s.dataset.heading === heading);
  markActive(heading);
  const defaultNote = { arrive: 'n2', flood: 'n7', close: 'n8' }[shotParam];
  const note = q.get('note') ?? defaultNote;
  if (note && note !== '0') text.toggle(note, true);
  if (el && shotParam !== 'arrive') {
    // 滚到这一节；要是打开的小注在这一节靠后，就再往下一点，让小注露出来
    const h2 = el.querySelector('h2');
    let top = el.offsetTop - scroller.offsetTop;
    const noteEl = el.querySelector('.note');
    if (noteEl) {
      const bottom = noteEl.offsetTop + noteEl.offsetHeight - scroller.offsetTop;
      const need = bottom + 60 - scroller.clientHeight;
      if (need > top) {
        // 对齐到某一段的开头
        const ps = [...el.querySelectorAll(':scope > p')];
        const p = ps.find((x) => x.offsetTop - scroller.offsetTop - h2.offsetHeight >= need) ?? ps[ps.length - 1];
        top = p.offsetTop - scroller.offsetTop - h2.offsetHeight + 4;
      }
    }
    scroller.scrollTop = top;
  }
  show(shotParam, heading);
} else {
  text.toggle('n2', true);
  const sync = () => {
    const h = activeSection();
    markActive(h);
    // 没有自己镜头的小节，沙盘留在全景上，说明条里写的还是全景对应的那一节
    show(SECTION_SHOT[h] ?? 'arrive', SECTION_SHOT[h] ? h : undefined);
  };
  scroller.addEventListener('scroll', sync, { passive: true });
  window.addEventListener('scroll', sync, { passive: true });
  sync();
}

window.addEventListener('resize', () => {
  st.resize();
  st.setShot(currentShot, labelsFor(currentShot));
  st.render();
  updateLegend(currentShot, currentHeading);
});

// 调试用：?cloud=1.5 临时改云影的浓淡
if (q.has('cloud')) st.cloud.uCloudAmt.value = Number(q.get('cloud'));

// 第一帧画完再报“好了”
st.render();
console.log('沙盘', JSON.stringify(st.info()));
requestAnimationFrame(() => requestAnimationFrame(() => {
  window.__ready = true;
}));

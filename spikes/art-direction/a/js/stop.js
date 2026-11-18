// 站点页：把正文、小注、原文排进左边一栏；右边的沙盘跟着正文一节一节换镜头。
// ?shot=arrive|rise|flood|close|hills|coal|leave 可以把沙盘定在某一个镜头（拍样张用，不做动画）。
import { createTable } from './table.js';
import { T } from './terrain.js';

const SHARED = '../shared/';
const q = new URLSearchParams(location.search);
const lockedShot = q.get('shot');

// 每一节：沙盘用哪个镜头，沙盘左上角写什么
const SECTIONS = [
  { shot: 'arrive', cap: '从西边的缺口往里看：三面是山，两条河在城东北角合成一股，贴着城往东南去。' },
  { shot: 'rise', cap: '水从北边和西边漫过来，到了城下。' },
  { shot: 'flood', cap: '水漫到了山脚。城在墙和堤后面是干的，船系在城下挡浪。' },
  { shot: 'close', cap: '东门上新盖的黄楼，墙上刷了黄土；楼下是泗水。' },
  { shot: 'hills', cap: '从城里往南看：云龙山、山上的放鹤亭，城东南的百步洪。' },
  { shot: 'coal', cap: '往西南看。白土镇在二十多公里外，不在这块沙盘里。' },
  { shot: 'leave', cap: '出了西门一直往西，是去南京的路。' },
];
const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const KIND = { history: '历史', geography: '地理', humanities: '人文', science: '科学' };

const esc = (s) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);

function parseMd(md) {
  const sections = [];
  let cur = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('## ')) {
      cur = { heading: line.slice(3).trim(), paras: [] };
      sections.push(cur);
    } else if (cur) cur.paras.push(line);
  }
  return sections;
}

async function main() {
  const [md, data, figure] = await Promise.all([
    fetch(SHARED + 'xuzhou.md').then((r) => r.text()),
    fetch(SHARED + 'xuzhou.json').then((r) => r.json()),
    fetch(SHARED + 'su-shi-figure.json').then((r) => r.json()),
  ]);

  // ---------- 八站的路线 ----------
  const route = document.getElementById('route');
  const nowIdx = figure.stops.findIndex((s) => s.id === 'xuzhou');
  figure.stops.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = i < nowIdx ? 'done' : i === nowIdx ? 'now' : '';
    if (Math.abs(i - nowIdx) === 1) li.classList.add('near');
    const name = i === nowIdx - 1 ? '密州' : i === nowIdx + 1 ? '汴京' : s.shortTitle || s.title;
    li.innerHTML = `<span>${esc(name)}</span>`;
    li.title = `第 ${i + 1} 站　${s.title}`;
    route.appendChild(li);
  });

  // ---------- 正文 ----------
  const sections = parseMd(md);
  const text = document.getElementById('text');
  const used = new Set();
  const noteById = Object.fromEntries(data.notes.map((n) => [n.id, n]));
  sections.forEach((sec, si) => {
    const el = document.createElement('section');
    el.className = 'section';
    el.dataset.index = si;
    el.id = 'sec-' + (si + 1);
    let html = `<h2>${esc(sec.heading)}</h2>`;
    for (const p of sec.paras) {
      let body = esc(p);
      for (const n of data.notes) {
        if (used.has(n.id)) continue;
        const at = body.indexOf(n.anchor);
        if (at < 0) continue;
        // 别套在已经加好的标签里
        const before = body.slice(0, at);
        if (before.lastIndexOf('<span') > before.lastIndexOf('</span>')) continue;
        used.add(n.id);
        body = `${before}<span class="note-anchor" role="button" tabindex="0" aria-expanded="false" data-note="${n.id}">${n.anchor}</span>${body.slice(at + n.anchor.length)}`;
      }
      html += `<p>${body}</p>`;
    }
    for (const o of data.originals.filter((x) => x.section === sec.heading)) {
      html += `<details class="original"><summary><span class="tag">原文</span><span class="ttl">${esc(o.title)}</span><span class="date">${esc(o.date)}</span></summary><p class="classical">${esc(o.text)}</p><p class="plain">${esc(o.plain)}</p></details>`;
    }
    el.innerHTML = html;
    text.appendChild(el);
  });

  // ---------- 小注：一次只开一条，开在那一段的下面 ----------
  function closeNote() {
    document.querySelectorAll('.note').forEach((n) => n.remove());
    document.querySelectorAll('.note-anchor[aria-expanded="true"]').forEach((a) => a.setAttribute('aria-expanded', 'false'));
  }
  function openNote(id) {
    const a = document.querySelector(`.note-anchor[data-note="${id}"]`);
    if (!a) return;
    const was = a.getAttribute('aria-expanded') === 'true';
    closeNote();
    if (was) return;
    const n = noteById[id];
    a.setAttribute('aria-expanded', 'true');
    const box = document.createElement('aside');
    box.className = 'note';
    box.innerHTML = `<div class="note-kind">${KIND[n.kind] || ''}</div><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p><button class="note-close">收起</button>`;
    box.querySelector('.note-close').addEventListener('click', closeNote);
    a.closest('p').after(box);
  }
  text.addEventListener('click', (e) => {
    const a = e.target.closest('.note-anchor');
    if (a) openNote(a.dataset.note);
  });
  text.addEventListener('keydown', (e) => {
    const a = e.target.closest('.note-anchor');
    if (a && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openNote(a.dataset.note);
    }
  });
  openNote(q.get('note') || 'n2');
  window.__openNote = openNote;

  // ---------- 问讲解员 ----------
  const ask = document.getElementById('ask');
  const sheet = document.getElementById('ask-sheet');
  document.getElementById('ask-list').innerHTML = data.sampleQuestions.map((s) => `<li>${esc(s)}</li>`).join('');
  ask.addEventListener('click', () => {
    const open = sheet.hidden;
    sheet.hidden = !open;
    ask.setAttribute('aria-expanded', String(open));
  });

  // ---------- 沙盘 ----------
  const cap = document.getElementById('cap');
  const note = document.getElementById('note');
  const steps = document.getElementById('steps');
  const needle = document.getElementById('needle');
  let curSection = -1;
  function showSection(i) {
    if (i === curSection) return;
    curSection = i;
    cap.querySelector('.no').textContent = `沙盘 · 第${CN[i]}节`;
    cap.querySelector('b').textContent = sections[i].heading;
    cap.querySelector('p').textContent = SECTIONS[i].cap;
    const flooded = SECTIONS[i].shot === 'rise' || SECTIONS[i].shot === 'flood';
    const far = SECTIONS[i].shot !== 'close';
    note.innerHTML =
      `<span class="long">河道、城墙、堤${flooded ? '、水位' : ''}和戏马台的土山是示意。山的高度夸大了 ${T.exag} 倍，一层 ${T.stepM} 米（土山一层 ${T.stepM / 2} 米）${far ? '；远看的时候，屋子、船和树放大了' : ''}。地形是今天的。</span>` +
      `<span class="short">河道、城墙、堤${flooded ? '、水位' : ''}是示意；山高夸大了 ${T.exag} 倍；地形是今天的。</span>`;
    steps.querySelectorAll('button').forEach((b, k) => b.setAttribute('aria-current', String(k === i)));
  }
  sections.forEach((s, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<button title="${esc(s.heading)}" aria-label="${esc(s.heading)}"></button>`;
    li.firstChild.addEventListener('click', () => document.getElementById('sec-' + (i + 1)).scrollIntoView({ behavior: 'smooth', block: 'start' }));
    steps.appendChild(li);
  });

  const wideToggle = document.getElementById('wide-toggle');
  const setWide = (on) => {
    document.body.classList.toggle('wide', on);
    wideToggle.textContent = on ? '回到正文' : '看大图';
  };
  setWide(q.has('wide'));
  wideToggle.addEventListener('click', () => setWide(!document.body.classList.contains('wide')));

  const startIdx = lockedShot ? Math.max(0, SECTIONS.findIndex((s) => s.shot === lockedShot)) : 0;
  showSection(startIdx);
  const table = await createTable(document.getElementById('table'), { shot: SECTIONS[startIdx].shot, sharedBase: SHARED });
  window.__table = table;
  const needleN = document.getElementById('needle-n');
  const turn = () => {
    const a = table.northAngle();
    needle.setAttribute('transform', `rotate(${a.toFixed(1)})`);
    const r = (a * Math.PI) / 180;
    needleN.setAttribute('x', (Math.sin(r) * 17).toFixed(1));
    needleN.setAttribute('y', (-Math.cos(r) * 17).toFixed(1));
  };
  // 比例尺：画面正中的地面上，挑一个整数的长度。全景里底座上嵌着一条刻好的，就不重复了。
  const scaleEl = document.getElementById('scale');
  const ruler = () => {
    if (table.plateReadable()) {
      scaleEl.hidden = true;
      return;
    }
    scaleEl.hidden = false;
    const ppm = table.pxPerMeter();
    let len = 20;
    for (const n of [20, 50, 100, 200, 500, 1000, 2000, 5000]) if (n * ppm <= 112) len = n;
    scaleEl.firstElementChild.style.width = (len * ppm).toFixed(1) + 'px';
    scaleEl.lastElementChild.textContent = len >= 1000 ? `${len / 1000} 公里` : `${len} 米`;
  };
  table.onRender(turn);
  table.onRender(ruler);
  turn();
  ruler();

  // 正文读到哪一节，沙盘就换到哪一节的镜头
  if (!lockedShot) {
    const els = [...document.querySelectorAll('.section')];
    let ticking = false;
    const sync = () => {
      ticking = false;
      const line = window.innerHeight * 0.42;
      let idx = 0;
      els.forEach((el, i) => {
        if (el.getBoundingClientRect().top < line) idx = i;
      });
      if (idx !== curSection) {
        showSection(idx);
        table.setShot(SECTIONS[idx].shot, { animate: true });
      }
    };
    window.addEventListener('scroll', () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(sync);
      }
    }, { passive: true });
  }

  await document.fonts.ready;
  table.render();
  requestAnimationFrame(() => {
    window.__info = { ...table.stats(), ...table.models.counts };
    window.__ready = true;
  });
}

main();

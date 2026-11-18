// 站点页：把正文排出来，小注能点开；沙盘跟着读到的小节换镜头。
// ?shot=arrive|flood|close 固定在一个镜头上（拍样张用），?note=n2 指定哪条小注开着。

import { createSandTable, SHOTS, EX } from './scene/sandtable.js';
import { mountOverlay } from './overlay.js';

const q = new URLSearchParams(location.search);
const fixedShot = q.get('shot');
// ?meter=1：页面上多几行测速的数字（见 meter.js）。不带这个参数时连文件都不取。
const meterMod = q.get('meter') === '1' ? import('./meter.js') : null;
const KIND = { history: '历史', geography: '地理', humanities: '人文', science: '科学' };

// 每一小节用哪个镜头
const SECTION_SHOT = {
  到徐州: 'arrive',
  水来了: 'rising',
  住在城墙上: 'flood',
  水退以后: 'close',
  云龙山和百步洪: 'south',
  石炭: 'south',
  要走了: 'arrive',
};

async function loadText() {
  const [md, data] = await Promise.all([fetch('../shared/xuzhou.md').then((r) => r.text()), fetch('../shared/xuzhou.json').then((r) => r.json())]);
  const sections = [];
  for (const line of md.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('## ')) sections.push({ heading: t.slice(3), paras: [] });
    else if (sections.length) sections[sections.length - 1].paras.push(t);
  }
  return { sections, notes: data.notes };
}

function renderText(root, sections, notes, openId) {
  const pending = new Map(notes.map((n) => [n.anchor, n]));
  for (const s of sections) {
    const h = document.createElement('h2');
    h.textContent = s.heading;
    h.id = 'sec-' + s.heading;
    h.dataset.section = s.heading;
    root.append(h);
    for (const para of s.paras) {
      const p = document.createElement('p');
      // 这一段里有没有还没标过的小注词（每条小注只标第一次出现的地方）
      const hits = [];
      for (const [anchor, n] of pending) {
        const at = para.indexOf(anchor);
        if (at >= 0) hits.push({ at, n });
      }
      hits.sort((a, b) => a.at - b.at);
      let pos = 0;
      const opened = [];
      for (const { at, n } of hits) {
        if (at < pos) continue;
        pending.delete(n.anchor);
        p.append(para.slice(pos, at));
        const b = document.createElement('span');
        b.className = 'na';
        b.setAttribute('role', 'button');
        b.tabIndex = 0;
        b.textContent = n.anchor;
        b.setAttribute('aria-expanded', 'false');
        b.dataset.note = n.id;
        p.append(b);
        pos = at + n.anchor.length;
        opened.push({ b, n });
      }
      p.append(para.slice(pos));
      root.append(p);
      for (const { b, n } of opened) {
        const toggle = () => {
          const cur = root.querySelector(`.note[data-note="${n.id}"]`);
          if (cur) {
            cur.remove();
            b.setAttribute('aria-expanded', 'false');
            return;
          }
          const box = document.createElement('aside');
          box.className = 'note';
          box.dataset.note = n.id;
          box.innerHTML = `<div class="note-head"><span class="note-title"></span><span class="note-kind"></span><button class="note-close" type="button">收起</button></div><p></p>`;
          box.querySelector('.note-title').textContent = n.title;
          box.querySelector('.note-kind').textContent = KIND[n.kind] || '';
          box.querySelector('p').textContent = n.body;
          box.querySelector('.note-close').addEventListener('click', toggle);
          p.after(box);
          b.setAttribute('aria-expanded', 'true');
        };
        b.addEventListener('click', toggle);
        b.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
          }
        });
        if (n.id === openId) toggle();
      }
    }
  }
}

const { sections, notes } = await loadText();
renderText(document.getElementById('text'), sections, notes, q.get('note') || 'n2');
await document.fonts.ready;

const first = fixedShot || 'arrive';
const table = await createSandTable(document.getElementById('table'), { shot: first });
window.table = table;
const overlay = mountOverlay(document.getElementById('scene'), table, { ex: EX });
overlay.setShot(first);
window.__overlay = overlay;
const meter = meterMod ? (await meterMod).mountMeter(table) : null;

// 手机上沙盘钉在最上面，正文从它下面开始
const sceneEl = document.getElementById('scene');
const textTop = () => (window.innerWidth <= 760 ? sceneEl.getBoundingClientRect().bottom : 0);

function go(name, animate) {
  if (!SHOTS[name] || table.shot === name) return;
  overlay.hideLabels();
  table.setShot(name, { animate, onDone: () => overlay.setShot(name) });
  if (!animate) overlay.setShot(name);
}

// 读到哪一节，镜头跟到哪一节
if (!fixedShot) {
  const heads = [...document.querySelectorAll('.text h2')];
  let ticking = false;
  const pick = () => {
    ticking = false;
    const line = textTop() + (window.innerHeight - textTop()) * 0.42;
    let cur = heads[0];
    for (const h of heads) if (h.getBoundingClientRect().top < line) cur = h;
    go(SECTION_SHOT[cur.dataset.section] || 'arrive', true);
  };
  window.addEventListener('scroll', () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(pick);
    }
  }, { passive: true });
}

window.addEventListener('resize', () => {
  table.resize();
  table.setShot(table.shot);
  overlay.setShot(table.shot);
});

// 只看沙盘 / 回到正文
const wideBtn = document.getElementById('wide');
const setWide = (on) => {
  document.body.classList.toggle('wide', on);
  wideBtn.textContent = on ? '回到正文' : '只看沙盘';
  table.resize();
  table.setShot(table.shot);
  overlay.setShot(table.shot);
};
wideBtn.addEventListener('click', () => setWide(!document.body.classList.contains('wide')));
if (q.get('wide') === '1') setWide(true);

// 拍样张用：滚到某一节的标题
window.__scrollToSection = (name) => {
  const h = document.getElementById('sec-' + name);
  if (h) window.scrollTo(0, h.getBoundingClientRect().top + window.scrollY - (textTop() ? textTop() + 16 : 92));
};

requestAnimationFrame(() => {
  table.render();
  requestAnimationFrame(() => {
    window.__ready = true;
    if (meter) meter.ready();
  });
});

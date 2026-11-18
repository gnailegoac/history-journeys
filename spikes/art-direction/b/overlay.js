// 盖在沙盘上的一层：题签和引线、这一节的一句话、如实的小注、指北和比例尺。
// 题签是页面上的字（清楚、能选），位置每画一帧跟着镜头重新算。

import { SHOTS } from './scene/sandtable.js';

const NS = 'http://www.w3.org/2000/svg';

export function mountOverlay(root, table, { ex }) {
  const labelsEl = root.querySelector('#labels');
  const svg = root.querySelector('#leaders');
  const capSec = root.querySelector('#cap-sec');
  const capLine = root.querySelector('#cap-line');
  const capHonest = root.querySelector('#cap-honest');
  const needle = root.querySelector('#needle');
  const scale = root.querySelector('#scalebar');
  let items = [];

  // 如实的小注：先说这张图上最容易看错的一样，再说别的
  const terrain = '地形是今天的，平地抹平过，四边收低了，城南的高地和戏马台的土丘是垫出来的。';
  const wide = `山的高度夸大了 ${ex} 倍；城楼、屋顶、船和树也放大了，不按比例。河道和城墙是示意，河画宽了。`;
  const HONEST = {
    arrive: wide + terrain,
    rising: `水位是示意。河道和城墙也是示意。山的高度夸大了 ${ex} 倍；` + terrain,
    flood: `水位是示意：照正文“三面漫到山脚”画的，不是算出来的。河道、城墙和堤也是示意。山的高度夸大了 ${ex} 倍；地形是今天的，平地抹平过，城南的高地是垫出来的。`,
    close: '黄楼的样子没有图可查，是照宋式楼阁示意的。城楼、房屋、船和树都放大了，不按比例；城墙和河道也是示意。',
    south: `百步洪只知道大致在这一段河上，乱石的样子是示意。山的高度夸大了 ${ex} 倍；` + terrain,
    home: '',
  };
  // 手机上只有一行的地方
  const SHORT = {
    arrive: `山高夸大 ${ex} 倍；河道、城墙是示意；模型都放大了`,
    rising: `水位、河道、城墙是示意；山高夸大 ${ex} 倍`,
    flood: `水位、河道、城墙是示意；山高夸大 ${ex} 倍`,
    close: '黄楼的样子是示意；模型都放大了，不按比例',
    south: `乱石、河道是示意；山高夸大 ${ex} 倍`,
  };

  function setShot(name) {
    const s = SHOTS[name];
    if (!s) return;
    labelsEl.textContent = '';
    svg.textContent = '';
    const narrow = root.clientWidth < 700;
    items = s.labels.filter((l) => !(narrow && l.wideOnly)).map((l) => {
      const el = document.createElement('div');
      el.className = 'tiqian' + (l.kind === 'water' ? ' water' : '');
      el.textContent = l.text;
      labelsEl.append(el);
      const line = document.createElementNS(NS, 'line');
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('r', '2.6');
      svg.append(line, dot);
      return { l, el, line, dot };
    });
    if (capSec) {
      capSec.textContent = s.section || '';
      if (s.when) {
        const w = document.createElement('span');
        w.className = 'when';
        w.textContent = s.when;
        capSec.append(w);
      }
      capLine.textContent = s.caption || '';
      capHonest.textContent = (root.clientWidth < 600 ? SHORT[name] : HONEST[name]) ?? wide + terrain;
    }
    update();
  }

  function hideLabels() {
    labelsEl.textContent = '';
    svg.textContent = '';
    items = [];
  }

  function update() {
    // 题签离它指的地方多远，是按 880 宽的画面定的；画面窄了按比例收近
    const k = Math.max(0.5, Math.min(1, root.clientWidth / 800));
    for (const it of items) {
      const p = table.project(...it.l.at);
      const off = p.behind || p.x < 8 || p.y < 8 || p.x > root.clientWidth - 8 || p.y > root.clientHeight - 8;
      it.el.style.display = off ? 'none' : '';
      it.line.style.display = off ? 'none' : '';
      it.dot.style.display = off ? 'none' : '';
      it.p = off ? null : p;
      if (off) continue;
      const w = it.el.offsetWidth / 2;
      const h = it.el.offsetHeight / 2;
      const cx = Math.round(Math.max(w + 4, Math.min(root.clientWidth - w - 4, p.x + it.l.dx * k)));
      const cy = Math.round(Math.max(h + 4, p.y + it.l.dy * k));
      it.el.style.left = cx + 'px';
      it.el.style.top = cy + 'px';
      it.rect = [cx - w, cy - h, cx + w, cy + h].map(Math.round);
      const qx = Math.max(cx - w, Math.min(cx + w, p.x));
      const qy = Math.max(cy - h, Math.min(cy + h, p.y));
      it.line.setAttribute('x1', p.x.toFixed(1));
      it.line.setAttribute('y1', p.y.toFixed(1));
      it.line.setAttribute('x2', qx.toFixed(1));
      it.line.setAttribute('y2', qy.toFixed(1));
      it.dot.setAttribute('cx', p.x.toFixed(1));
      it.dot.setAttribute('cy', p.y.toFixed(1));
    }
    if (needle) needle.setAttribute('transform', `rotate(${(-table.heading()).toFixed(1)})`);
    if (scale) {
      const max = Math.min(120, root.clientWidth * 0.28);
      let pick = [20, '20 米'];
      for (const c of [[50, '50 米'], [100, '100 米'], [200, '200 米'], [500, '500 米'], [1000, '1 公里'], [2000, '2 公里'], [5000, '5 公里']]) {
        if (table.pxPer(c[0]) <= max) pick = c;
      }
      const px = table.pxPer(pick[0]);
      scale.querySelector('span').textContent = pick[1];
      scale.querySelector('.bar').style.width = px.toFixed(0) + 'px';
    }
  }

  /** 干活时查位置用：每条题签指在哪、纸条占了哪一块（画布上的像素） */
  function debug() {
    return items.map((it) => ({ text: it.l.text, at: it.p ? [Math.round(it.p.x), Math.round(it.p.y)] : null, rect: it.rect }));
  }

  table.onAfterRender(update);
  return { setShot, hideLabels, update, debug };
}

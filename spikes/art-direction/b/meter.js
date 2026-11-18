// 测速：只在网址带 ?meter=1 时由 stop.js 装上，给拿平板、手机打开样张的人看几行数字。
//
// 量的都是真正画出来的帧：一帧的用时 = 这一帧的 requestAnimationFrame 时间戳到下一帧的时间戳，
// 而且只算其间确实调过 renderer.render 的帧。不用定时器。
//   启动用时：页面置 window.__ready 的那一刻离开始打开页面多久（performance.now()）。
//   镜头移动：最近一次换小节时镜头滑过去的那些帧（包住 table.setShot 量的，沙盘本身的画法不动）。
//   转一圈：镜头绕着眼下看的那一点匀速转 360 度，约 6 秒，每帧都画；转完镜头放回原处。
// 这里不改沙盘怎么画，也不在量的时候改页面上的字（免得量的动作本身拖慢画面）。

const SPIN_MS = 6000;

const CSS = `
.meter { position: fixed; z-index: 6; left: 56px; bottom: 88px; width: 456px; box-sizing: border-box;
  padding: 11px 14px 12px; border-radius: 6px; background: #221e1a; color: #f5eedd;
  font: 15px/1.5 system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; letter-spacing: 0;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35); -webkit-text-size-adjust: 100%; }
.meter-head { display: flex; align-items: flex-start; gap: 12px; }
.meter-head span { flex: 1; color: #e8c98a; }
.meter-fold { flex: none; min-width: 48px; min-height: 32px; margin: -4px -6px 0 0; padding: 0 8px; font-size: 14px;
  color: #f5eedd; border: 1px solid rgba(245, 238, 221, 0.45); border-radius: 4px; touch-action: manipulation; }
.meter-row { display: flex; align-items: center; gap: 12px; margin-top: 7px; }
.meter-row b { flex: none; width: 4.4em; font-weight: 400; color: #cbbf9f; }
.meter-row span { flex: 1; min-width: 0; font-variant-numeric: tabular-nums; }
.meter-spin { flex: none; min-height: 44px; padding: 0 14px; font-size: 16px; color: #28231f; background: #f5eedd;
  border-radius: 4px; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.meter-spin:disabled { opacity: 0.55; }
.meter-facts, .meter-lost { margin-top: 8px; font-size: 13px; line-height: 1.45; color: #cbbf9f; overflow-wrap: anywhere; }
.meter-lost { color: #ffb4a4; }
.meter.folded { width: auto; padding: 6px; }
.meter.folded .meter-head span, .meter.folded .meter-body { display: none; }
.meter.folded .meter-fold { margin: 0; min-height: 36px; }
body.wide .meter { left: 16px; top: 16px; bottom: auto; width: 340px; }
body.wide .meter.folded { width: auto; }
@media (max-width: 760px) {
  .meter { left: 8px; right: 8px; bottom: calc(var(--walk-h, 62px) + 8px); width: auto; padding: 9px 12px 10px; font-size: 14.5px; line-height: 1.45; }
  .meter.folded { right: auto; }
  .meter-row { gap: 10px; margin-top: 6px; }
  .meter-facts, .meter-lost { margin-top: 6px; font-size: 12.5px; }
}
`;

const HTML = `
<div class="meter-head"><span>请把下面几行数字告诉制作方。测之前请先关掉省电模式。</span><button type="button" class="meter-fold">收起</button></div>
<div class="meter-body">
  <div class="meter-row"><b>启动用时</b><span data-m="start">正在算</span></div>
  <div class="meter-row"><b>镜头移动</b><span data-m="move">还没有。把正文往下读到下一节，镜头会自己动</span></div>
  <div class="meter-row"><button type="button" class="meter-spin" disabled>转一圈测一测</button><span data-m="spin">还没测</span></div>
  <div class="meter-facts" data-m="facts"></div>
  <div class="meter-lost" data-m="lost" hidden></div>
</div>`;

/** stamps：一串挨着的帧的时间戳（毫秒）。相邻两个之差就是一帧的用时。at：最慢的是第几帧（从 1 数起）。 */
function summarize(stamps) {
  const n = stamps.length - 1;
  if (n < 1) return null;
  let worst = 0;
  let at = 0;
  for (let i = 0; i < n; i++) {
    const d = stamps[i + 1] - stamps[i];
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  return { frames: n, avg: (n * 1000) / (stamps[n] - stamps[0]), worst, at: at + 1 };
}

const num = (v) => String(Math.round(v * 100) / 100);

function describe(r, note = '') {
  const avg = r.avg >= 20 ? r.avg.toFixed(0) : r.avg.toFixed(1);
  return `每秒 ${avg} 帧，最慢一帧 ${Math.round(r.worst)} 毫秒（第 ${r.at} 帧），共 ${r.frames} 帧${note}`;
}

export function mountMeter(table) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.append(style);
  const box = document.createElement('div');
  box.className = 'meter';
  box.innerHTML = HTML;
  document.body.append(box);
  const el = (k) => box.querySelector(`[data-m="${k}"]`);
  const foldBtn = box.querySelector('.meter-fold');
  const spinBtn = box.querySelector('.meter-spin');

  const renderer = table.renderer;
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '') : '';

  let isReady = false;
  let move = null; // 正在量的一次镜头移动
  let spin = null; // 正在转的一圈
  let triangles = 0; // 最近一帧画了多少个三角形（影子那一遍也算在里面）
  let lost = 0;
  let factsTimer = 0;

  function showFacts() {
    const used = renderer.getPixelRatio();
    const own = window.devicePixelRatio || 1;
    el('facts').textContent =
      `画面 ${gl.drawingBufferWidth}×${gl.drawingBufferHeight} 像素，像素倍数 ${num(used)}` +
      (Math.abs(own - used) > 0.01 ? `（屏幕本身 ${num(own)}）` : '') +
      `；三角形 ${triangles} 个` +
      (gpu ? `；显卡 ${gpu}` : '');
  }
  function showButton() {
    spinBtn.disabled = !isReady || !!spin || !!move;
    spinBtn.textContent = spin ? '正在转，约 6 秒' : '转一圈测一测';
  }

  // 每画一帧记一笔。正在量的时候不碰页面上的字。
  table.onAfterRender(() => {
    triangles = renderer.info.render.triangles;
    if (move) move.rendered++;
    if (!move && !spin && !factsTimer) {
      factsTimer = setTimeout(() => {
        factsTimer = 0;
        showFacts();
      }, 250);
    }
  });

  // ---- 镜头移动：包住 setShot。带 animate 的那次从第一帧量到镜头到位的那一帧 ----
  function endMove(cut) {
    const m = move;
    move = null;
    cancelAnimationFrame(m.raf);
    const r = summarize(m.stamps);
    if (r) el('move').textContent = describe(r, cut ? '（没走完就被打断了）' : '');
    showButton();
    showFacts();
  }
  function dropMove() {
    cancelAnimationFrame(move.raf);
    move = null;
    showButton();
  }
  const setShot = table.setShot;
  table.setShot = (name, opts = {}) => {
    if (spin) endSpin('换了小节，被打断了，请等画面停下再点一次', false);
    if (move) endMove(true);
    // 和 sandtable.js 里一样：要求滑过去、而且之前已经有镜头，才会真的滑
    if (!opts.animate || !table.shot) return setShot(name, opts);
    const m = (move = { stamps: [], rendered: 0, done: false, closing: false, raf: 0 });
    showButton();
    setShot(name, {
      ...opts,
      onDone: () => {
        m.done = true;
        if (opts.onDone) opts.onDone();
      },
    });
    // 这个回调排在沙盘自己那一帧的后面：沙盘画完，这里记下这一帧的时间戳
    const tick = (ts) => {
      if (move !== m) return;
      if (m.closing) {
        // 到位那一帧之后的下一帧：它的时间戳就是到位那一帧的结束
        m.stamps.push(ts);
        endMove(false);
        return;
      }
      if (m.rendered) {
        m.stamps.push(ts);
        m.rendered = 0;
      }
      if (m.done) m.closing = true;
      m.raf = requestAnimationFrame(tick);
    };
    m.raf = requestAnimationFrame(tick);
  };

  // ---- 转一圈 ----
  function endSpin(note, redraw = true) {
    const s = spin;
    spin = null;
    cancelAnimationFrame(s.raf);
    table.camera.position.copy(s.pos);
    table.camera.quaternion.copy(s.quat);
    s.controls.enabled = s.enabled;
    if (redraw) table.render();
    const r = note ? null : summarize(s.stamps);
    el('spin').textContent = r ? describe(r) : note || '没测成，请再点一次';
    showButton();
    showFacts();
  }
  function startSpin() {
    const controls = table.controls;
    if (!isReady || spin || move || !controls) return;
    const cam = table.camera;
    const c = controls.target;
    const s = (spin = { stamps: [], t0: 0, raf: 0, controls, enabled: controls.enabled, pos: cam.position.clone(), quat: cam.quaternion.clone() });
    const ox = s.pos.x - c.x;
    const oz = s.pos.z - c.z;
    controls.enabled = false; // 转的时候手指碰到沙盘不算数
    showButton();
    const frame = (ts) => {
      if (spin !== s) return;
      if (!s.stamps.length) s.t0 = ts;
      s.stamps.push(ts);
      const k = (ts - s.t0) / SPIN_MS;
      if (k >= 1) {
        endSpin('');
        return;
      }
      const a = k * Math.PI * 2;
      cam.position.set(c.x + ox * Math.cos(a) + oz * Math.sin(a), s.pos.y, c.z - ox * Math.sin(a) + oz * Math.cos(a));
      cam.lookAt(c);
      table.render();
      s.raf = requestAnimationFrame(frame);
    };
    s.raf = requestAnimationFrame(frame);
  }
  spinBtn.addEventListener('click', startSpin);

  // 页面被切到后台时浏览器不出帧，量到一半的不能算
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    if (spin) endSpin('页面被切走了，请再点一次');
    if (move) dropMove();
  });

  renderer.domElement.addEventListener('webglcontextlost', () => {
    lost++;
    el('lost').hidden = false;
    el('lost').textContent = `画面丢失过 ${lost} 次`;
    if (spin) endSpin('画面丢失了，没测成', false);
    if (move) dropMove();
  });

  // 收起 / 展开；“只看沙盘”时先收起来，免得盖住题签
  const setFolded = (on) => {
    box.classList.toggle('folded', on);
    foldBtn.textContent = on ? '测速' : '收起';
  };
  foldBtn.addEventListener('click', () => setFolded(!box.classList.contains('folded')));
  let wide = document.body.classList.contains('wide');
  new MutationObserver(() => {
    const now = document.body.classList.contains('wide');
    if (now !== wide) {
      wide = now;
      setFolded(now);
    }
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });

  showFacts();
  return {
    /** 页面置 window.__ready 的那一刻调 */
    ready() {
      isReady = true;
      el('start').textContent = `${(performance.now() / 1000).toFixed(1)} 秒`;
      showButton();
      showFacts();
    },
  };
}

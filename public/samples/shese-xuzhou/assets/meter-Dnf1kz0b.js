function e(e){let t=e.length-1;if(t<1)return null;let n=0,r=0;for(let i=0;i<t;i++){let t=e[i+1]-e[i];t>n&&(n=t,r=i)}return{frames:t,avg:t*1e3/(e[t]-e[0]),worst:n,at:r+1}}var t=e=>String(Math.round(e*100)/100);function n(e,t=``){return`每秒 ${e.avg>=20?e.avg.toFixed(0):e.avg.toFixed(1)} 帧，最慢一帧 ${Math.round(e.worst)} 毫秒（第 ${e.at} 帧），共 ${e.frames} 帧${t}`}function r(r){let i=document.createElement(`style`);i.textContent=`
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
`,document.head.append(i);let a=document.createElement(`div`);a.className=`meter`,a.innerHTML=`
<div class="meter-head"><span>请把下面几行数字告诉制作方。测之前请先关掉省电模式。</span><button type="button" class="meter-fold">收起</button></div>
<div class="meter-body">
  <div class="meter-row"><b>启动用时</b><span data-m="start">正在算</span></div>
  <div class="meter-row"><b>镜头移动</b><span data-m="move">还没有。把正文往下读到下一节，镜头会自己动</span></div>
  <div class="meter-row"><button type="button" class="meter-spin" disabled>转一圈测一测</button><span data-m="spin">还没测</span></div>
  <div class="meter-facts" data-m="facts"></div>
  <div class="meter-lost" data-m="lost" hidden></div>
</div>`,document.body.append(a);let o=e=>a.querySelector(`[data-m="${e}"]`),s=a.querySelector(`.meter-fold`),c=a.querySelector(`.meter-spin`),l=r.renderer,u=l.getContext(),d=u.getExtension(`WEBGL_debug_renderer_info`),f=d?String(u.getParameter(d.UNMASKED_RENDERER_WEBGL)||``):``,p=!1,m=null,h=null,g=0,_=0,v=0;function y(){let e=l.getPixelRatio(),n=window.devicePixelRatio||1;o(`facts`).textContent=`画面 ${u.drawingBufferWidth}×${u.drawingBufferHeight} 像素，像素倍数 ${t(e)}`+(Math.abs(n-e)>.01?`（屏幕本身 ${t(n)}）`:``)+`；三角形 ${g} 个`+(f?`；显卡 ${f}`:``)}function b(){c.disabled=!p||!!h||!!m,c.textContent=h?`正在转，约 6 秒`:`转一圈测一测`}r.onAfterRender(()=>{g=l.info.render.triangles,m&&m.rendered++,m||h||v||(v=setTimeout(()=>{v=0,y()},250))});function x(t){let r=m;m=null,cancelAnimationFrame(r.raf);let i=e(r.stamps);i&&(o(`move`).textContent=n(i,t?`（没走完就被打断了）`:``)),b(),y()}function S(){cancelAnimationFrame(m.raf),m=null,b()}let C=r.setShot;r.setShot=(e,t={})=>{if(h&&w(`换了小节，被打断了，请等画面停下再点一次`,!1),m&&x(!0),!t.animate||!r.shot)return C(e,t);let n=m={stamps:[],rendered:0,done:!1,closing:!1,raf:0};b(),C(e,{...t,onDone:()=>{n.done=!0,t.onDone&&t.onDone()}});let i=e=>{m===n&&(n.closing?(n.stamps.push(e),x(!1)):(n.rendered&&=(n.stamps.push(e),0),n.done&&(n.closing=!0),n.raf=requestAnimationFrame(i)))};n.raf=requestAnimationFrame(i)};function w(t,i=!0){let a=h;h=null,cancelAnimationFrame(a.raf),r.camera.position.copy(a.pos),r.camera.quaternion.copy(a.quat),a.controls.enabled=a.enabled,i&&r.render();let s=t?null:e(a.stamps);o(`spin`).textContent=s?n(s):t||`没测成，请再点一次`,b(),y()}function T(){let e=r.controls;if(!p||h||m||!e)return;let t=r.camera,n=e.target,i=h={stamps:[],t0:0,raf:0,controls:e,enabled:e.enabled,pos:t.position.clone(),quat:t.quaternion.clone()},a=i.pos.x-n.x,o=i.pos.z-n.z;e.enabled=!1,b();let s=e=>{if(h!==i)return;i.stamps.length||(i.t0=e),i.stamps.push(e);let c=(e-i.t0)/6e3;if(c>=1){w(``);return}let l=c*Math.PI*2;t.position.set(n.x+a*Math.cos(l)+o*Math.sin(l),i.pos.y,n.z-a*Math.sin(l)+o*Math.cos(l)),t.lookAt(n),r.render(),i.raf=requestAnimationFrame(s)};i.raf=requestAnimationFrame(s)}c.addEventListener(`click`,T),document.addEventListener(`visibilitychange`,()=>{document.hidden&&(h&&w(`页面被切走了，请再点一次`),m&&S())}),l.domElement.addEventListener(`webglcontextlost`,()=>{_++,o(`lost`).hidden=!1,o(`lost`).textContent=`画面丢失过 ${_} 次`,h&&w(`画面丢失了，没测成`,!1),m&&S()});let E=e=>{a.classList.toggle(`folded`,e),s.textContent=e?`测速`:`收起`};s.addEventListener(`click`,()=>E(!a.classList.contains(`folded`)));let D=document.body.classList.contains(`wide`);return new MutationObserver(()=>{let e=document.body.classList.contains(`wide`);e!==D&&(D=e,E(e))}).observe(document.body,{attributes:!0,attributeFilter:[`class`]}),y(),{ready(){p=!0,o(`start`).textContent=`${(performance.now()/1e3).toFixed(1)} 秒`,b(),y()}}}export{r as mountMeter};
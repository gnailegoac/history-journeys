// 检查地图适配层的行为：打断飞行、读者挪动镜头、点击站点、卸载、不支持 WebGL2、手机上的触摸手势。
// 运行：node tests/map/behaviour.mjs（先起 npx vite --port 5411 --strictPort）
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { PAGE_URL, PHONE, SHOTS, camera, cameraError, hardTimeout, launch, openPage, preset, shot, sleep, waitIdle, waitReady } from './lib.mjs';

const stopTimer = hardTimeout(9);
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? '通过' : '失败'}  ${name}${detail === undefined ? '' : '  ' + JSON.stringify(detail)}`);
}
const state = (page) =>
  page.evaluate(() => ({
    moved: window.__mapDev.moved,
    movedLog: [...window.__mapDev.log.moved],
    selected: [...window.__mapDev.log.selected],
    resetDisabled: document.querySelector('[data-id="reset"]').disabled,
  }));
/** 某一站的圆点在画面上的位置。 */
const stopPoint = (page, stopId, dx = 0) =>
  page.evaluate(
    ([id, offset]) => {
      const { map, route } = window.__mapDev;
      const p = map.project(route.stops.find((s) => s.id === id).lngLat);
      return { x: p.x + offset, y: p.y };
    },
    [stopId, dx],
  );

const browser = await launch();
try {
  // ------------------------------------------------------------ 桌面
  const { page, problems } = await openPage(browser);
  await page.goto(PAGE_URL);
  await waitReady(page);
  await waitIdle(page);

  // 飞行途中再次调用：旧的立刻完成（不拒绝、不悬着），新的飞到位
  const cancel = await page.evaluate(async () => {
    const view = window.__mapDev.view;
    const t0 = performance.now();
    let first = 'pending';
    let firstAt = 0;
    const p1 = view.goToStop('meishan').then(
      () => {
        first = 'resolved';
        firstAt = performance.now() - t0;
      },
      () => {
        first = 'rejected';
      },
    );
    await new Promise((r) => setTimeout(r, 1200));
    const cancelledAt = performance.now() - t0;
    const p2 = view.goToStop('xuzhou');
    await Promise.race([p1, new Promise((r) => setTimeout(r, 3000))]);
    const firstAfterCancel = first;
    await p2;
    return { firstAfterCancel, cancelledAt, firstAt, secondDoneAt: performance.now() - t0 };
  });
  check('飞行途中改飞别处：旧的调用立刻完成', cancel.firstAfterCancel === 'resolved' && cancel.firstAt - cancel.cancelledAt < 500, cancel);
  check('改飞的那一次停在预设镜头上', cameraError(await camera(page), await preset(page, 'xuzhou')) < 1e-6);
  check('程序自己飞不算读者动过', (await state(page)).movedLog.length === 0, await state(page));

  // 鼠标拖动：onUserMoved(true)；“回到这一站”：回到预设，onUserMoved(false)
  await page.mouse.move(720, 520);
  await page.mouse.down();
  await page.mouse.move(820, 580, { steps: 6 });
  await page.mouse.up();
  await sleep(800);
  let s = await state(page);
  check('鼠标拖动后通知 onUserMoved(true)，按钮可用', s.moved === true && s.resetDisabled === false, s);
  check('拖动后镜头离开了预设位置', cameraError(await camera(page), await preset(page, 'xuzhou')) > 1e-4);
  await page.click('[data-id="reset"]');
  await page.waitForFunction(() => window.__mapDev.moved === false, null, { timeout: 15000 });
  // 归位一开始就通知 onUserMoved(false)，镜头这时还在路上：再等它回到预设位置（最多 15 秒）
  const home = await preset(page, 'xuzhou');
  for (let i = 0; i < 60 && cameraError(await camera(page), home) >= 1e-6; i++) await sleep(250);
  s = await state(page);
  check('回到这一站：镜头回到预设，通知 onUserMoved(false)', cameraError(await camera(page), await preset(page, 'xuzhou')) < 1e-6 && s.movedLog.at(-1) === false, s.movedLog);

  // 右键拖动：转动和倾斜
  const before = await camera(page);
  await page.mouse.move(720, 520);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(800, 480, { steps: 6 });
  await page.mouse.up({ button: 'right' });
  await sleep(600);
  const turned = await camera(page);
  check('鼠标右键拖动能转动和倾斜', Math.abs(turned.bearing - before.bearing) > 1 && Math.abs(turned.pitch - before.pitch) > 1, {
    bearing: [before.bearing, turned.bearing],
    pitch: [before.pitch, turned.pitch],
  });
  await page.evaluate(() => window.__mapDev.view.resetView());

  // 飞行途中滚轮：飞行让位，调用完成，算读者动过
  // 这台机器一帧要几百毫秒，输入事件到得晚，所以从页面真正收到滚轮事件的时刻量起
  const interrupted = page.evaluate(() => {
    const t0 = performance.now();
    let wheelAt = null;
    window.addEventListener('wheel', () => void (wheelAt ??= performance.now() - t0), { capture: true, passive: true, once: true });
    return window.__mapDev.view.goToStop('bianjing').then(() => ({ doneAt: performance.now() - t0, wheelAt }));
  });
  await sleep(1500);
  await page.mouse.move(720, 450);
  await page.mouse.wheel(0, -240);
  const hit = await interrupted;
  await sleep(600);
  s = await state(page);
  check(
    '飞行途中滚轮：飞行停下，调用完成，通知 onUserMoved(true)',
    hit.wheelAt !== null && hit.doneAt - hit.wheelAt < 300 && hit.doneAt < 6800 && s.moved === true,
    { ...hit, moved: s.moved },
  );
  await page.evaluate(() => window.__mapDev.view.resetView());
  s = await state(page);
  check('被打断后“回到这一站”：到要去的那一站', cameraError(await camera(page), await preset(page, 'bianjing')) < 1e-6 && s.moved === false);

  // animate: false 立刻到位；不认识的站名拒绝
  const jump = await page.evaluate(() => {
    const { view, map } = window.__mapDev;
    const p = view.goToStop('huangzhou', { animate: false });
    const c = map.getCenter();
    return p.then(() => ({ lng: c.lng, lat: c.lat }));
  });
  check('animate: false 不飞，调用返回时镜头已经到位', Math.abs(jump.lng - 114.866) < 1e-9 && Math.abs(jump.lat - 30.451) < 1e-9, jump);
  const unknown = await page.evaluate(() => window.__mapDev.view.goToStop('nowhere').then(() => 'resolved', (e) => e.name));
  check('不认识的站：拒绝（RangeError）', unknown === 'RangeError', unknown);

  // 画面大小变了：镜头仍在预设位置（同样的距离，缩放级别跟着变）
  await page.setViewportSize({ width: 1000, height: 640 });
  await sleep(1200);
  const size = await page.evaluate(() => {
    const c = window.__mapDev.map.getCanvas();
    return [c.clientWidth, c.clientHeight];
  });
  check('容器变小后画布跟着变，镜头仍是预设的距离', size[0] === 1000 && size[1] === 640 && cameraError(await camera(page), await preset(page, 'huangzhou')) < 1e-6, size);
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(800);

  // 点击站点圆点
  await page.evaluate(() => window.__mapDev.view.showOverview({ animate: false }));
  await waitIdle(page);
  let p = await stopPoint(page, 'danzhou');
  await page.mouse.click(p.x, p.y);
  await sleep(400);
  s = await state(page);
  check('点击第 8 站的圆点：onStopSelect', s.selected.at(-1) === 'danzhou', s.selected);
  await page.evaluate(() => window.__mapDev.view.showOverview({ animate: false }));
  await waitIdle(page);
  p = await stopPoint(page, 'hangzhou-2', 13);
  await page.mouse.click(p.x, p.y);
  await sleep(400);
  const second = (await state(page)).selected.at(-1);
  await page.evaluate(() => window.__mapDev.view.showOverview({ animate: false }));
  await waitIdle(page);
  p = await stopPoint(page, 'hangzhou-1', -13);
  await page.mouse.click(p.x, p.y);
  await sleep(400);
  const first = (await state(page)).selected.at(-1);
  check('杭州并排的两个圆点各自能点中', first === 'hangzhou-1' && second === 'hangzhou-2', { first, second });

  // 飞到一半卸载：调用完成，不再有动画帧，容器清空，WebGL 上下文释放；之后还能重新挂上
  const destroyed = await page.evaluate(async () => {
    const dev = window.__mapDev;
    const canvas = dev.map.getCanvas();
    const container = document.getElementById('map');
    let flight = 'pending';
    dev.view.goToStop('mizhou').then(
      () => void (flight = 'resolved'),
      () => void (flight = 'rejected'),
    );
    await new Promise((r) => setTimeout(r, 700));
    dev.unmount();
    await new Promise((r) => setTimeout(r, 100));
    // 卸载之后 600 毫秒里，页面上不该再有人申请动画帧
    let frames = 0;
    const original = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb) => {
      frames++;
      return original.call(window, cb);
    };
    await new Promise((r) => setTimeout(r, 600));
    window.requestAnimationFrame = original;
    const gl = canvas.getContext('webgl2');
    return {
      flight,
      frames,
      children: container.childElementCount,
      className: container.className,
      canvasAttached: canvas.isConnected,
      contextLost: gl ? gl.isContextLost() : 'no context',
    };
  });
  check(
    '飞到一半卸载：调用完成，容器清空，没有残留的动画帧，WebGL 上下文已释放',
    destroyed.flight === 'resolved' && destroyed.frames === 0 && destroyed.children === 0 && destroyed.className === '' && !destroyed.canvasAttached && destroyed.contextLost === true,
    destroyed,
  );
  const remount = await page.evaluate(() => window.__mapDev.mount().then(() => Boolean(window.__mapDev.map), (e) => String(e)));
  check('卸载后重新挂上，再次可用', remount === true, remount);
  check('控制台没有错误', problems.filter((x) => !x.startsWith('[warning]')).length === 0, problems);
  await page.close();

  // ------------------------------------------------------------ 不支持 WebGL2
  {
    const { page: bare, context } = await openPage(browser);
    await bare.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
        return type === 'webgl2' ? null : original.call(this, type, ...rest);
      };
    });
    await bare.goto(PAGE_URL);
    const outcome = await bare.evaluate(() => {
      const t0 = performance.now();
      return window.__mapDev.ready.then(
        () => ({ ready: 'resolved' }),
        (e) => ({ ready: 'rejected', message: e.message, ms: performance.now() - t0 }),
      );
    });
    const dead = await bare.evaluate(async () => {
      const view = window.__mapDev.view;
      await view.goToStop('xuzhou');
      await view.showOverview();
      await view.resetView();
      view.setNamesMode('modern');
      view.resize();
      view.destroy();
      return document.getElementById('status').textContent;
    });
    check('没有 WebGL2：ready 拒绝，其余调用照常完成', outcome.ready === 'rejected', { ...outcome, status: dead });
    await context.close();
  }

  // ------------------------------------------------------------ 高程瓦片一直不回来：ready 到时间后拒绝，不悬着
  {
    const { page: stuck, context } = await openPage(browser);
    await stuck.route('**/elevation-tiles-prod/**', () => {});
    await stuck.goto(PAGE_URL);
    const outcome = await stuck.evaluate(() => {
      const t0 = performance.now();
      return window.__mapDev.ready.then(
        () => ({ ready: 'resolved', ms: performance.now() - t0 }),
        (e) => ({ ready: 'rejected', message: e.message, ms: performance.now() - t0 }),
      );
    });
    check('高程瓦片一直不回来：ready 在 30 秒左右拒绝', outcome.ready === 'rejected' && outcome.ms < 40000, outcome);
    await context.close();
  }

  // ------------------------------------------------------------ 手机：触摸手势，系统设置了“减少动态效果”
  {
    const { page: phone, context, problems: phoneProblems } = await openPage(browser, { viewport: PHONE, hasTouch: true, isMobile: true });
    await phone.goto(`${PAGE_URL}?reduced=1`);
    await waitReady(phone);
    await waitIdle(phone);
    const fits = await phone.evaluate(() => {
      const { map, route } = window.__mapDev;
      const w = map.getContainer().clientWidth;
      const h = map.getContainer().clientHeight;
      return route.stops.every((stop) => {
        const q = map.project(stop.lngLat);
        return q.x > 12 && q.x < w - 12 && q.y > 12 && q.y < h - 12;
      });
    });
    check('手机竖屏的总览里八站都在画面内', fits);
    await shot(phone, 'phone-overview');

    const reduced = await phone.evaluate(() => {
      const { view, map } = window.__mapDev;
      const promise = view.goToStop('huangzhou');
      const c = map.getCenter();
      return promise.then(() => ({ lng: c.lng, lat: c.lat }));
    });
    check('减少动态效果：goToStop 直接切换', Math.abs(reduced.lng - 114.866) < 1e-9 && Math.abs(reduced.lat - 30.451) < 1e-9, reduced);
    await waitIdle(phone);
    await shot(phone, 'phone-stop-huangzhou');

    const cdp = await context.newCDPSession(phone);
    const touch = (type, points) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });

    // 单指拖动：平移
    let start = await camera(phone);
    await touch('touchStart', [[200, 500]]);
    for (let i = 1; i <= 8; i++) await touch('touchMove', [[200 + i * 8, 500 + i * 10]]);
    await touch('touchEnd', []);
    await sleep(900);
    let end = await camera(phone);
    check('单指拖动：平移，通知 onUserMoved(true)', Math.hypot(end.lng - start.lng, end.lat - start.lat) > 1e-4 && (await state(phone)).moved === true);

    // 双指一起上下拖：倾斜
    start = await camera(phone);
    await touch('touchStart', [[150, 520], [240, 520]]);
    for (let i = 1; i <= 10; i++) await touch('touchMove', [[150, 520 + i * 12], [240, 520 + i * 12]]);
    await touch('touchEnd', []);
    await sleep(900);
    end = await camera(phone);
    check('双指一起上下拖：倾斜', Math.abs(end.pitch - start.pitch) > 5, { from: start.pitch, to: end.pitch });

    // 双指捏合：缩放
    start = await camera(phone);
    await touch('touchStart', [[150, 420], [240, 420]]);
    for (let i = 1; i <= 8; i++) await touch('touchMove', [[150 - i * 8, 420], [240 + i * 8, 420]]);
    await touch('touchEnd', []);
    await sleep(900);
    end = await camera(phone);
    check('双指张开：放大', end.zoom - start.zoom > 0.3, { from: start.zoom, to: end.zoom });

    // 轻点站点
    await phone.evaluate(() => window.__mapDev.view.showOverview());
    await waitIdle(phone);
    const q = await stopPoint(phone, 'danzhou');
    await phone.touchscreen.tap(q.x, q.y);
    await sleep(500);
    check('手指轻点第 8 站的圆点：onStopSelect', (await state(phone)).selected.at(-1) === 'danzhou', (await state(phone)).selected);
    check('手机上控制台没有错误', phoneProblems.filter((x) => !x.startsWith('[warning]')).length === 0, phoneProblems);
    await context.close();
  }
} finally {
  await browser.close();
  stopTimer();
}
writeFileSync(path.join(SHOTS, 'behaviour.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} 项通过，${failed.length} 项失败`);
process.exitCode = failed.length ? 1 : 0;

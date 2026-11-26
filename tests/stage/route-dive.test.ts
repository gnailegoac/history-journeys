// 全程沙盘潜到一站上空：镜头的路（src/stage/three/routeLevel.ts 的 diveEnd、divePath）和它的先后（sequencer.ts 的 free）。
// 路是在真的全程沙盘上查的：从每一小节摆好的位置、从滑到半路的位置、从读者拖过以后的位置起步。钟是假的，不看画了几帧。
// 运行：npx vitest run tests/stage/route-dive.test.ts

import { describe, expect, it } from 'vitest';
import { hasStopTable } from '../../src/domain/sceneContent';
import { STANDARD_PANES } from './support/standardPanes';
import { placeCamera } from '../../src/stage/three/rig';
import { DIVE_AIM_SHARE, DIVE_DISTANCE_M, diveEnd, divePath } from '../../src/stage/three/routeLevel';
import { Sequencer, mixState, type TableState } from '../../src/stage/three/sequencer';
import { styleFor } from '../../src/stage/three/style';
import type { Vec3 } from '../../src/stage/ground/types';
import { realFigure, realRouteScene } from './support/realScenes';

/** 查的是苏轼的全程沙盘（潜的是他有自己的沙盘的那几站）。写着名字取，不取“排在最前面的那一座”。 */
const KEY = 'su-shi/route';
const FIGURE = KEY.split('/')[0];
const R = realRouteScene(KEY);
const style = styleFor(R.scene.style);
const pane = STANDARD_PANES[0];

/** 这位人物有自己的沙盘的站（潜的就是这几站）。 */
const OWN = R.scene.sections.flatMap((s) => (s.stop && hasStopTable(realFigure(FIGURE), s.stop) ? [s.stop] : []));

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function stateOf(heading: string): TableState {
  const section = R.scene.sections.find((s) => s.heading === heading);
  if (!section) throw new Error(`没有这一节：${heading}`);
  const { pose } = placeCamera(section, R.scene, R.samplers, R.coords, style, pane.size, pane.insets);
  return { position: pose.position, target: pose.target, fov: pose.fov, levelM: 0, flood: 0, mist: 0 };
}

/** 起步的几种位置：每一小节摆好的；头两节之间滑到四成的；读者拖过的（凑近、转了向、对准的点挪开了）。 */
function starts(): { name: string; from: TableState }[] {
  const list = R.headings.map((heading) => ({ name: heading, from: stateOf(heading) }));
  const whole = stateOf(R.headings[0]);
  list.push({ name: '滑到半路', from: mixState(whole, stateOf(R.headings[2]), 0.4) });
  const [tx, ty, tz] = whole.target;
  list.push({ name: '读者拖过', from: { ...whole, target: [tx + 60000, ty, tz + 90000], position: [tx + 60000 - 9000, ty + 14000, tz + 90000 + 6000] } });
  return list;
}

/** 那一站在画面上离中心多远：镜头看出去的方向和“镜头到那一站”的方向夹多少度。 */
function offCentreDeg(s: TableState, place: Vec3): number {
  const view = [s.target[0] - s.position[0], s.target[1] - s.position[1], s.target[2] - s.position[2]];
  const to = [place[0] - s.position[0], place[1] - s.position[1], place[2] - s.position[2]];
  const dot = view[0] * to[0] + view[1] * to[1] + view[2] * to[2];
  const cos = dot / (Math.hypot(...view) * Math.hypot(...to));
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

describe(`${KEY} 潜到一站上空：镜头的路`, () => {
  it('这位人物至少有一站有自己的沙盘（不然下面什么也没查）', () => {
    expect(OWN.length).toBeGreaterThan(0);
  });

  it('沙盘上没有的站：没有路', () => {
    expect(diveEnd(R.scene, 'no-such-stop', stateOf(R.headings[0]), R.samplers, R.coords)).toBeNull();
  });

  for (const stop of OWN) {
    const place = R.scene.places.find((p) => p.stops?.includes(stop));
    if (!place) throw new Error(`沙盘上没有这一站的地名点：${stop}`);
    const [px, pz] = R.coords.toLocal(place.at);
    const spot: Vec3 = [px, R.coords.y(R.samplers.height(px, pz)), pz];
    const pitch = R.scene.sections.find((s) => s.stop === stop)?.camera.pitch;

    it(`${stop}：潜到头对准的是这一站的地名点，离它 ${DIVE_DISTANCE_M} 米，朝正北，倾角是到这一站去的那一节的`, () => {
      const from = stateOf(R.headings[0]);
      const to = diveEnd(R.scene, stop, from, R.samplers, R.coords);
      expect(to).not.toBeNull();
      if (!to) return;
      expect(dist(to.target, spot)).toBeLessThan(0.5);
      expect(dist(to.position, to.target)).toBeCloseTo(DIVE_DISTANCE_M, 3);
      // 朝正北：镜头在那一点的正南（z 大），东西不偏
      expect(to.position[0]).toBeCloseTo(to.target[0], 3);
      expect(to.position[2]).toBeGreaterThan(to.target[2]);
      expect(pitch).toBeDefined();
      const tilt = (Math.acos((to.position[1] - to.target[1]) / DIVE_DISTANCE_M) * 180) / Math.PI;
      expect(tilt).toBeCloseTo(pitch ?? 0, 3);
      // 视角、水位、云气照起步时的不变
      expect(to.fov).toBe(from.fov);
      expect(to.levelM).toBe(from.levelM);
    });

    for (const { name, from } of starts()) {
      it(`${stop}，从“${name}”起步：头是起步的地方，尾是那一站上空；对准的那一点先到（钟点走到 ${DIVE_AIM_SHARE} 就正对着那一站），那一站只往画面中间靠；凑近是起步慢、越来越快`, () => {
        const to = diveEnd(R.scene, stop, from, R.samplers, R.coords);
        if (!to) throw new Error('没有路');
        const path = divePath(from, to);
        expect(path(0)).toEqual(from);
        expect(path(-1)).toEqual(from);
        const end = path(1);
        expect(dist(end.position, to.position)).toBeLessThan(1e-6);
        expect(dist(end.target, to.target)).toBeLessThan(1e-6);
        expect(path(2)).toEqual(end);

        const STEPS = 50;
        const states = Array.from({ length: STEPS + 1 }, (_, i) => path(i / STEPS));
        const aim = states.map((s) => dist(s.target, spot));
        const reach = states.map((s) => dist(s.position, s.target));
        const off = states.map((s) => offCentreDeg(s, spot));
        for (let i = 1; i <= STEPS; i++) {
          // 对准的那一点只朝那一站去；镜头离对准的那一点只近不远
          expect(aim[i], `第 ${i} 步对准的那一点离那一站`).toBeLessThanOrEqual(aim[i - 1] + 1e-6);
          expect(reach[i], `第 ${i} 步离对准的那一点`).toBeLessThanOrEqual(reach[i - 1] + 1e-6);
          // 那一站在画面上只往中间靠（容千分之一度的算术误差）
          expect(off[i], `第 ${i} 步那一站离画面中心`).toBeLessThanOrEqual(off[i - 1] + 1e-3);
        }
        expect(off[STEPS]).toBeLessThan(1e-3);
        // 对准的那一点先到：钟点走到 DIVE_AIM_SHARE，镜头已经正对着那一站；那时候凑近（按倍数算）还没有走到一半，画面是清楚的
        const aimed = path(DIVE_AIM_SHARE);
        expect(dist(aimed.target, spot)).toBeLessThan(0.5);
        expect(offCentreDeg(aimed, spot)).toBeLessThan(1e-3);
        const share = (s: TableState): number => Math.log(reach[0] / dist(s.position, s.target)) / Math.log(reach[0] / reach[STEPS]);
        expect(share(aimed)).toBeLessThan(0.5);
        // 钟点走到 DIVE_AIM_SHARE 的一半，对准的那一点正好挪了一半（缓起缓停）
        expect(dist(path(DIVE_AIM_SHARE / 2).target, spot) / aim[0]).toBeCloseTo(0.5, 6);
        // 起步慢、越来越快：按倍数算的靠近（距离取对数以后的差），四段工夫里一段比一段多。
        // 不逐步比：镜头转着向潜的时候（读者拖过以后），镜头和对准的点是直线挪的，离得多远不正好按倍数缩，相邻两步会差出千分之几
        const zoom = reach.map((d) => Math.log(d));
        const quarters = [0, 1, 2, 3].map((q) => zoom[Math.round((q * STEPS) / 4)] - zoom[Math.round(((q + 1) * STEPS) / 4)]);
        for (let q = 1; q < 4; q++) expect(quarters[q], `第 ${q + 1} 段`).toBeGreaterThan(quarters[q - 1]);
        // 头十分之一的工夫走不到全程（按倍数算）的二十分之一
        expect((zoom[0] - zoom[5]) / (zoom[0] - zoom[STEPS])).toBeLessThan(0.05);
      });
    }
  }
});

// ---------------------------------------------------------------- 先后：照钟点走，被顶掉、被打断、关掉

function rig() {
  let now = 0;
  const frames: (() => void)[] = [];
  const seen: number[] = [];
  const calls: string[] = [];
  const sequencer = new Sequencer(
    ['全程', '到徐州'],
    '全程',
    {
      place: (heading) => void calls.push(`place ${heading}`),
      glide: (heading) => ({ durationMs: 1000, frame: () => void calls.push(`glide ${heading}`) }),
      settled: () => Promise.resolve(),
    },
    {
      now: () => now,
      nextFrame(run) {
        frames.push(run);
        return () => {
          const at = frames.indexOf(run);
          if (at >= 0) frames.splice(at, 1);
        };
      },
    },
    false,
  );
  return {
    sequencer,
    seen,
    calls,
    plan: (durationMs: number) => ({ durationMs, frame: (k: number) => void seen.push(k) }),
    /** 钟走 ms 毫秒，然后跑约好的下一帧。 */
    tick(ms: number) {
      now += ms;
      frames.shift()?.();
    },
    pending: () => frames.length,
  };
}

describe('潜下去的先后（Sequencer.free）', () => {
  it('第一个画面还没摆：不潜，马上答 false', async () => {
    const r = rig();
    await expect(r.sequencer.free(r.plan(900))).resolves.toBe(false);
    expect(r.pending()).toBe(0);
  });

  it('照钟点走：要 900 毫秒就是 900 毫秒，帧多帧少都一样；每一帧收到的是钟点走了几成', async () => {
    for (const gaps of [[100, 100, 100, 100, 100, 100, 100, 100, 100], [450, 450], [2000]]) {
      const r = rig();
      await r.sequencer.start();
      let settled: boolean | null = null;
      const done = r.sequencer.free(r.plan(900)).then((reached) => (settled = reached));
      expect(r.sequencer.gliding).toBe(true);
      let elapsed = 0;
      for (const gap of gaps) {
        // 还没到钟点：没有完
        await Promise.resolve();
        expect(settled).toBeNull();
        r.tick(gap);
        elapsed += gap;
        expect(r.seen.at(-1)).toBeCloseTo(Math.min(1, elapsed / 900), 9);
      }
      await done;
      expect(settled).toBe(true);
      expect(r.seen.at(-1)).toBe(1);
      expect(r.seen.length).toBe(gaps.length);
      expect(r.pending()).toBe(0);
      expect(r.sequencer.gliding).toBe(false);
      // 现在要摆的小节没有变
      expect(r.sequencer.section).toBe('全程');
    }
  });

  it('半路来了新的指令（换小节、回到这一节）：潜的那一趟答 false，不再走', async () => {
    for (const command of ['show', 'reset'] as const) {
      const r = rig();
      await r.sequencer.start();
      const done = r.sequencer.free(r.plan(900));
      r.tick(300);
      const frames = r.seen.length;
      const next = command === 'show' ? r.sequencer.show('到徐州') : r.sequencer.reset();
      await expect(done).resolves.toBe(false);
      for (let i = 0; i < 12; i++) r.tick(100);
      await next;
      expect(r.seen.length).toBe(frames);
    }
  });

  it('读者的手接过去、关掉：答 false，约好的帧都取消', async () => {
    for (const how of ['interrupt', 'destroy'] as const) {
      const r = rig();
      await r.sequencer.start();
      const done = r.sequencer.free(r.plan(900));
      r.tick(300);
      if (how === 'interrupt') expect(r.sequencer.interrupt()).toBe(true);
      else r.sequencer.destroy();
      await expect(done).resolves.toBe(false);
      expect(r.pending()).toBe(0);
      expect(r.sequencer.gliding).toBe(false);
    }
  });

  it('正在滑向一小节时潜：滑的那一趟照常完成，潜的照钟点走完', async () => {
    const r = rig();
    await r.sequencer.start();
    const glide = r.sequencer.show('到徐州');
    r.tick(200);
    const done = r.sequencer.free(r.plan(900));
    await glide;
    const glided = r.calls.filter((c) => c.startsWith('glide')).length;
    r.tick(900);
    await expect(done).resolves.toBe(true);
    expect(r.calls.filter((c) => c.startsWith('glide')).length).toBe(glided);
    expect(r.calls).not.toContain('place 到徐州');
  });

  it('再潜一次：前一趟答 false，后一趟走完', async () => {
    const r = rig();
    await r.sequencer.start();
    const first = r.sequencer.free(r.plan(900));
    r.tick(300);
    const second = r.sequencer.free(r.plan(900));
    await expect(first).resolves.toBe(false);
    r.tick(900);
    await expect(second).resolves.toBe(true);
  });

  it('画一帧时出了错：停在半路，答 false', async () => {
    const r = rig();
    await r.sequencer.start();
    const done = r.sequencer.free({
      durationMs: 900,
      frame: () => {
        throw new Error('画不出来');
      },
    });
    r.tick(100);
    await expect(done).resolves.toBe(false);
    expect(r.pending()).toBe(0);
  });
});

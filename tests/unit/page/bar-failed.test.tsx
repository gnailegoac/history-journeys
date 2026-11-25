// 时间轴的那一段程序没取到的时候（网断了一下，或者网站发了新的一版、旧的那一段已经不在了）：时间轴的那一条里说一句话，别的照常。
// 用假 DOM（miniDom.ts）在 Node 里连同 content/ 里真的内容和沙盘的替身跑一遍；那一段程序换成一个一取就出错的。
// 这个文件自己一个进程：替身是整个文件换掉的，不同别的页面测试共用。
import { describe, expect, it, vi } from 'vitest';
import { installMiniDom, MiniElement } from './miniDom';

const doc = installMiniDom('?stage=fake&bar=0');
const g = globalThis as any;

vi.mock('../../../src/timebar/TimeBar', () => {
  throw new Error('取不到时间轴的那一段程序');
});

const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { FigureLayout } = await import('../../../src/ui/FigureLayout');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = (ms = 60) => act(async () => void (await sleep(ms)));
const attr = (el: MiniElement | null, name: string) => el?.getAttribute(name) ?? null;
async function waitFor(ok: () => boolean, ms = 15000) {
  const until = Date.now() + ms;
  while (!ok() && Date.now() < until) await settle(20);
  if (!ok()) throw new Error('等不到');
}

describe('时间轴的那一段程序没取到', () => {
  it('那一段程序没取到：这一条里是那一句话（读屏会念），这一条还在、别的照常；一站的页面上没有这一条，也就没有这一句', { timeout: 60_000 }, async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    g.__sectionTops = {};
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as any);
    const show = (stopId: string | null) => act(async () => root.render(<FigureLayout figureId="su-shi" stopId={stopId} />));
    await show(null);
    const pane = () => container.querySelector('.stage-pane');
    await waitFor(() => attr(pane(), 'data-stage-state') === 'ready');
    // 这一条里是那一句话
    await waitFor(() => (container.querySelector('.stage-bar')?.textContent ?? '') !== '');
    const band = container.querySelector('.stage-bar')!;
    expect(band.textContent).toBe('时间轴没能读出来，刷新一下网页再试。');
    const line = band.querySelector('p')!;
    expect(attr(line, 'role')).toBe('status');
    expect(line.className).toBe('quiet');
    // 不是别处“点开才取的东西没取到”的那一句（那一句叫读者关上再点开：这里没有东西可关）
    expect(band.textContent).not.toContain('关上再点开');
    // 时间轴里面的东西没有；沙盘栏照常：带着时间轴的记号还在（地方照样留着），题记在，沙盘摆着头一节
    expect(container.querySelector('.bar')).toBeNull();
    expect(attr(pane(), 'data-stage-bar')).toBe('');
    expect(container.querySelector('.stage-caption')).not.toBeNull();
    expect(attr(pane(), 'data-stage-state')).toBe('ready');
    expect(container.querySelector('.stop-item')).not.toBeNull();
    // 一站的页面：没有这一条
    const stop = attr(container.querySelector('.stop-item'), 'data-stop-id');
    await show(stop);
    await waitFor(() => container.querySelector('.stage-bar') === null);
    expect(container.textContent).not.toContain('时间轴没能读出来');
    await act(async () => root.unmount());
    quiet.mockRestore();
  });
});

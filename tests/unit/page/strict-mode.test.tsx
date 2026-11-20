// StrictMode 下（开发时）沙盘栏会挂上、拿走、再挂上：只能剩一座沙盘。用假 DOM（miniDom.ts）在 Node 里跑。
import { describe, expect, it } from 'vitest';
import { readBytes } from '../../support/readBytes';
import type { StopScene } from '../../../src/domain';
import { installMiniDom } from './miniDom';

const doc = installMiniDom('?stage=fake');
const { act, StrictMode } = await import('react');
const { createRoot } = await import('react-dom/client');
const { StagePane } = await import('../../../src/ui/StagePane');

const scene = JSON.parse(new TextDecoder().decode(readBytes('content/figures/su-shi/scenes/xuzhou.json'))) as StopScene;
const table = { kind: 'stop' as const, key: 'su-shi/xuzhou', scene, terrainUrl: 't.bin' };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const settle = (ms = 60) => act(async () => void (await sleep(ms)));

describe('StrictMode', () => {
  it('只剩一座沙盘、一层题签；数据没读出来时“再试一次”往上报', { timeout: 30_000 }, async () => {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const root = createRoot(container as any);
    let reloads = 0;
    const render = (state: 'ready' | 'error', section: string | null) =>
      act(async () =>
        root.render(
          <StrictMode>
            <StagePane
              onStopPage
              table={state === 'ready' ? { state: 'ready', value: table } : { state: 'error' }}
              section={section}
              route={{ state: 'ready', value: null }}
              onReloadTable={() => (reloads += 1)}
            />
          </StrictMode>,
        ),
      );
    await render('ready', null);
    for (let i = 0; i < 400 && container.querySelector('.stage-pane')?.getAttribute('data-stage-state') !== 'ready'; i += 1) await settle(20);
    const pane = container.querySelector('.stage-pane')!;
    expect(pane.getAttribute('data-stage-state')).toBe('ready');
    expect(pane.getAttribute('data-stage-section')).toBe(scene.sections[0].heading);
    expect(container.querySelectorAll('.fake-stage')).toHaveLength(1);
    expect(container.querySelectorAll('.strips')).toHaveLength(1);
    expect(container.querySelectorAll('.stage-host .strip').map((el) => el.getAttribute('data-strip-id'))).toEqual(scene.sections[0].strips);
    expect(container.querySelector('.fake-stage')!.getAttribute('data-fake-animated')).toBe('false');

    // 换小节也照常。
    await render('ready', scene.sections[3].heading);
    for (let i = 0; i < 400 && container.querySelector('.stage-pane')?.getAttribute('data-stage-section') !== scene.sections[3].heading; i += 1) await settle(20);
    expect(container.querySelector('.stage-pane')!.getAttribute('data-stage-section')).toBe(scene.sections[3].heading);
    expect(container.querySelectorAll('.fake-stage')).toHaveLength(1);

    // 数据没读出来。
    await render('error', null);
    expect(container.querySelector('.stage-pane')!.getAttribute('data-stage-state')).toBe('failed');
    expect(container.querySelectorAll('.fake-stage')).toHaveLength(0);
    expect(container.querySelectorAll('.strip')).toHaveLength(0);
    await act(async () => container.querySelector('.stage-retry')!.click());
    expect(reloads).toBe(1);

    await act(async () => root.unmount());
    expect(container.childNodes).toHaveLength(0);
  });
});

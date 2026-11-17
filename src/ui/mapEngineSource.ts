// 地图引擎从哪来。平时用真的；地址里带 ?map=fake 时用不画地形的替身（自动测试用）。
// ?map=fake-fail 是一张起不来的替身，用来测“地图没能显示”时的页面。

import { loadMapEngine } from '../map';
import type { MapEngine } from '../map/types';

export async function pickMapEngine(): Promise<MapEngine> {
  const choice = new URLSearchParams(window.location.search).get('map');
  if (choice === 'fake' || choice === 'fake-fail') {
    const { createFakeMapEngine } = await import('./dev/fakeMapEngine');
    return createFakeMapEngine({ fail: choice === 'fake-fail' });
  }
  return loadMapEngine();
}

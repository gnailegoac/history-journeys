// 沙盘程序从哪来。平时用真的；地址里带 ?stage=fake 时用不画沙盘的替身（自动测试用）。
//   ?stage=fake-fail          一座起不来的替身，用来测“沙盘没能摆出来”时的页面
//   ?stage=fake-unsupported   一个说“这个浏览器画不了”的替身
// 每一小节的图片（定格图）由谁来放，也在这里挑：
//   ?sectionstills=fake        不管这座沙盘有没有定格图，都用定格图的替身
//   ?sectionstills=fake-fail   一个图片取不到的替身
//   ?sectionstills=none        当作这座沙盘没有定格图（用真的沙盘程序时也一样）
// 用沙盘的替身（?stage=fake…）时，不写 sectionstills 就当作没有定格图：原有的测试看的都是“没有定格图”时的页面。
// 另外两个只给自动测试用的开关也放在这里：
//   ?route=none   当作这位人物还没有全程沙盘
//   ?debug=1      把沙盘的读数挂在 window.__stageReadout 上（量三角形数用），并在沙盘栏里印一行画质和快慢的读数
// 从全程沙盘到一站自己的沙盘，镜头先潜下去再换页（src/ui/dive.ts）。它的两个开关：
//   ?dive=none    不潜，一点就换（用哪种沙盘都一样）
//   ?dive=1       用沙盘的替身时也潜。替身平时不潜：原有的测试看的都是“一点就换”
// 还有一个指定画质的开关，自动测试、拍图片和在平板上试的时候用：
//   ?tier=full | reduced | still   完整的一档、减配的一档、只放图片

import { loadRouteTable } from '../domain';
import { loadStageEngine, probeWebgl, stillEngine } from '../stage';
import type { RouteTable, StageEngine, StageTable, StageTier } from '../stage/types';

function query(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

/** 地址里是不是要了沙盘的替身（三种里的哪一种都算）。 */
function fakeStageChoice(): 'fake' | 'fake-fail' | 'fake-unsupported' | null {
  const choice = query('stage');
  return choice === 'fake' || choice === 'fake-fail' || choice === 'fake-unsupported' ? choice : null;
}

/**
 * 下载沙盘程序之前先问一句：这个浏览器画得了立体的沙盘吗。画不了就不用下载它了。
 * 用替身的时候不问浏览器：替身不靠浏览器画三维，画得了画不了由它自己说（support()）。
 */
export function canDrawStage(): boolean {
  if (fakeStageChoice() !== null) return true;
  return probeWebgl().webgl2;
}

export async function pickStageEngine(): Promise<StageEngine> {
  const choice = fakeStageChoice();
  if (choice !== null) {
    const { createFakeStageEngine } = await import('./dev/fakeStage');
    return createFakeStageEngine({ fail: choice === 'fake-fail', unsupported: choice === 'fake-unsupported' });
  }
  return loadStageEngine();
}

/**
 * 这座沙盘每一小节的图片由谁来放。没有图片（或者按要求当作没有）时是 null，这一点不用等就知道；
 * 有的话返回一个函数，叫它才去取放图片的程序（真的那个是页面自带的，马上就有；替身要现取）。
 */
export function pickStillEngine(table: StageTable): (() => Promise<StageEngine>) | null {
  const choice = query('sectionstills');
  if (choice === 'none') return null;
  if (choice === 'fake' || choice === 'fake-fail') {
    return async () => {
      const { createFakeStillEngine } = await import('./dev/fakeStill');
      return createFakeStillEngine({ fail: choice === 'fake-fail' });
    };
  }
  if (fakeStageChoice() !== null || !table.stills) return null;
  return () => Promise.resolve(stillEngine);
}

/** 这位人物的全程沙盘；还没有（或者地址里写了 ?route=none）时是 null。 */
export async function pickRouteTable(figureId: string): Promise<RouteTable | null> {
  const found = query('route') === 'none' ? null : await loadRouteTable(figureId);
  return found && { kind: 'route', key: `${figureId}/route`, ...found };
}

/**
 * 地址里指定的画质（?tier=）：full、reduced 是照这一档摆立体的沙盘，still 是只放图片；没写、写了别的是 null（由沙盘程序自己挑）。
 */
export function pickTier(): StageTier | 'still' | null {
  const choice = query('tier');
  return choice === 'full' || choice === 'reduced' || choice === 'still' ? choice : null;
}

/** 从全程沙盘到一站自己的沙盘，要不要先潜下去。 */
export function divesHere(): boolean {
  const choice = query('dive');
  return choice !== 'none' && (choice === '1' || fakeStageChoice() === null);
}

/** 要不要把沙盘的读数挂出来、印出来。 */
export function wantsReadout(): boolean {
  return query('debug') === '1';
}

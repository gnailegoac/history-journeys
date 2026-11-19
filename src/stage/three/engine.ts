// three.js 的沙盘程序。整个项目里只有 src/stage/three/ 这个目录接触 three.js。
// 这个文件由 src/stage/index.ts 用动态 import 加载，没有沙盘的页面不会下载它。

import { REVISION, type WebGLRenderer } from 'three';
import { probeWebgl } from '../support';
import type { StageEngine } from '../types';
import { browserParts, createHost, type HostParts } from './host';
import { createStopView, type BrowserHost } from './view';

/**
 * 造一个沙盘程序。里面只有一个画布主人：所有沙盘轮流用同一块画布、同一个渲染器；
 * 这一次访问里画质最高到哪一档的记性也在主人身上（host.tiers），所以每一座沙盘看到的是同一份。
 * parts 是画布和渲染器怎么造，probe 是“这个浏览器能不能画”怎么问：正式用的是浏览器里的那两样（见最下面），
 * 测试交假的进来（tests/stage/tier.test.ts）。
 */
export function createEngine(
  parts: HostParts<HTMLElement, HTMLCanvasElement, WebGLRenderer>,
  probe: () => { webgl2: boolean; caveat: boolean },
): { engine: StageEngine; host: BrowserHost } {
  const host = createHost(parts);

  /** 问一次浏览器。浏览器说“只能用软件画”的，顺手把这一次访问的上限压到减配（重复记不碍事）。 */
  const ask = (): { webgl2: boolean; caveat: boolean } => {
    const answer = probe();
    if (answer.caveat) host.tiers.noteCaveat();
    return answer;
  };

  const engine: StageEngine = {
    name: 'three.js',
    version: `r${REVISION}`,
    /**
     * 能不能画立体的沙盘：要 WebGL2；这一次访问里已经量出来连减配的一档也带不动的，也算不能（too-slow）。
     * 问浏览器的那一步只做一次（probeWebgl 自己记着结果，页面在下载这个文件之前问的也是它）。
     * 用软件画的浏览器（没有显卡，自动测试的机器就是这样）算能画，只是上限从减配起。
     * 这里答的是“程序自己挑的话还摆不摆”：页面指定了画质，或者读者自己点了要立体的沙盘，
     * 页面不必理会 too-slow，照样可以 create。
     */
    support() {
      if (!ask().webgl2) return { ok: false, reason: 'no-webgl2' };
      if (host.tiers.ceiling() === 'still') return { ok: false, reason: 'too-slow' };
      return { ok: true };
    },
    create(container, table, options) {
      // 页面没有先问 support 就来摆的，也要先知道浏览器是不是只能用软件画
      ask();
      return createStopView(container, table, options, host);
    },
  };
  return { engine, host };
}

/** 整个访问期间用的就是这一个。 */
export const engine: StageEngine = createEngine(browserParts, probeWebgl).engine;

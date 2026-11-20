// 定格图的替身：不取图片，只用普通的页面元素。自动测试通过 ?sectionstills=fake 用它（见 ../stageEngineSource.ts）。
// 真的定格图（src/stage/still）每一小节一张图片，上面摆的是和立体沙盘一样的题签；替身照它的规矩办事，
// 把自己的样子写在 data- 属性上，测试据此判断：
//   data-fake-still-shown     第一张图片出来了没有
//   data-fake-still-section   现在放着哪一小节的图片（第一张还没出来时是空的）
//   data-fake-still-names     题签用当时的名字还是今天的名字
//   data-fake-still-insets    页面让它四边各留出多少（上 右 下 左）
//   data-fake-still-requests  收到过的每一次 showSection 要去哪一小节，按先后，用“|”隔开
// 题签用的是真的那一层（src/stage/overlay），位置是编的。
// 指北和比例尺只报一次，数是编的，而且和沙盘的替身报的不一样：测试分得出页面上印的是谁报的。
//
// 地址里的开关：
//   ?stillgap=毫秒数   每一张图片隔这么久才出来（真的图片要下载）
//   ?stillfail=N       第 N 小节的图片取不到：一上来要的就是它，ready 拒绝；后来换到它，通知 onLost，那一次指令照常完成
// ?sectionstills=fake-fail 是哪一张都取不到。

import { sectionHeadings, stripTexts } from '../../domain';
import { mountStrips, sectionStripSpecs } from '../../stage/overlay';
import type { NamesMode, StageEngine, StageInsets, StageOptions, StageViewInfo, StageTable, StopStageView } from '../../stage/types';
import '../../styles/fake-stage.css';

/** 定格图的替身报的指北和比例尺。 */
const VIEW_INFO: StageViewInfo = { northDeg: 12, scale: { px: 80, label: '5 公里' } };

const NO_INSETS: StageInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** 地址里的一个数；没写、写得不对是 0。 */
function numberParam(name: string): number {
  const asked = Number(new URLSearchParams(window.location.search).get(name));
  return Number.isFinite(asked) && asked > 0 ? asked : 0;
}

export function createFakeStillEngine(config: { fail?: boolean } = {}): StageEngine {
  return {
    name: 'fake-still',
    version: '0',
    support: () => ({ ok: true }),
    create: (container, table, options) => createFakeStill(container, table, options, config.fail ?? false),
  };
}

function createFakeStill(container: HTMLElement, table: StageTable, options: StageOptions, allFail: boolean): StopStageView {
  const { scene } = table;
  const headings = sectionHeadings(scene);
  const gap = numberParam('stillgap');
  const failing = headings[Math.round(numberParam('stillfail')) - 1];
  const viewListeners = new Set<(info: StageViewInfo) => void>();
  const lostListeners = new Set<() => void>();

  let namesMode: NamesMode = options.namesMode;
  let insets: StageInsets = options.insets ?? NO_INSETS;
  // 现在放着哪一小节的图片；第一张还没出来时是 undefined。
  let current: string | undefined;
  let stripIds: string[] = [];
  let destroyed = false;
  const requests: string[] = [];
  let timer: number | undefined;
  // 正在路上的那一次指令。被新的顶掉、或者关掉时，用它让那一次照常完成。
  let settle: (() => void) | null = null;

  let resolveReady: () => void = () => {};
  let rejectReady: (reason: Error) => void = () => {};
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // 页面没有接住失败时，不让浏览器再报一次“未处理的错误”。
  ready.catch(() => {});

  const root = document.createElement('div');
  root.className = 'fake-still';
  root.dataset.fakeStillShown = 'false';
  root.dataset.fakeStillSection = '';
  root.dataset.fakeStillNames = namesMode;
  root.dataset.fakeStillInsets = [insets.top, insets.right, insets.bottom, insets.left].join(' ');
  root.dataset.fakeStillRequests = '';

  const title = document.createElement('p');
  title.className = 'fake-still-title';
  title.textContent = '定格图的替身（自动测试用，不是真的图片）：图片还没出来';

  root.append(title);
  container.append(root);
  const strips = mountStrips(container);

  // 每条题签指着的位置是编的：从左到右匀着排开，都在画面里。
  function placeStrips(): void {
    const width = root.clientWidth;
    const height = root.clientHeight;
    const count = stripIds.length;
    const anchors = stripIds.map((id, i) => ({ id, x: (width * (i + 1)) / (count + 1), y: height * 0.5, visible: true }));
    strips.place(anchors, { width, height }, insets);
  }

  // 换上现在这一小节的图片和题签。
  function paint(): void {
    root.dataset.fakeStillSection = current ?? '';
    root.dataset.fakeStillNames = namesMode;
    root.dataset.fakeStillInsets = [insets.top, insets.right, insets.bottom, insets.left].join(' ');
    if (current === undefined) return;
    title.textContent = `定格图的替身（自动测试用，不是真的图片）：${current}`;
    const texts = stripTexts(scene, current, namesMode);
    stripIds = texts.map((text) => text.id);
    strips.set(sectionStripSpecs(scene, current, texts, options.marks));
    placeStrips();
  }

  // “取”一小节的图片：隔一会儿告诉 done 取到没有。再来一次，上一次就不算了。
  function load(section: string, done: (ok: boolean) => void): void {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => done(!allFail && section !== failing), gap);
  }

  // 第一张图片：出来了 ready 才完成；取不到 ready 拒绝。
  function loadFirst(section: string): void {
    load(section, (ok) => {
      const waiting = settle;
      settle = null;
      if (!ok) {
        waiting?.();
        rejectReady(new Error('定格图的替身：按要求取不到图片'));
        return;
      }
      current = section;
      root.dataset.fakeStillShown = 'true';
      paint();
      waiting?.();
      resolveReady();
      viewListeners.forEach((listener) => listener(VIEW_INFO));
    });
  }

  const first = options.section !== undefined && headings.includes(options.section) ? options.section : headings[0];
  if (first === undefined) rejectReady(new Error('定格图的替身：场景里一个小节也没有'));
  else loadFirst(first);

  return {
    ready,
    // 和真的定格图一样：图片取到了才换，换了才完成；途中又来新的，旧的那一次照常完成；
    // 取不到时通知 onLost，这一次照常完成。只有场景里没有这个小节时才拒绝。
    showSection: (section) => {
      if (destroyed) return Promise.reject(new Error('定格图的替身已经关掉'));
      if (!headings.includes(section)) return Promise.reject(new Error(`场景里没有这一小节：${section}`));
      requests.push(section);
      root.dataset.fakeStillRequests = requests.join('|');
      settle?.();
      settle = null;
      return new Promise((resolve) => {
        settle = resolve;
        // 第一张还没出来：改成直接取这一节的。
        if (current === undefined) {
          loadFirst(section);
          return;
        }
        load(section, (ok) => {
          settle = null;
          if (ok) {
            current = section;
            paint();
          } else {
            lostListeners.forEach((listener) => listener());
          }
          resolve();
        });
      });
    },
    resetView: () => (destroyed ? Promise.reject(new Error('定格图的替身已经关掉')) : Promise.resolve()),
    setNamesMode: (mode) => {
      if (destroyed) return;
      namesMode = mode;
      paint();
    },
    setInsets: (next) => {
      if (destroyed) return;
      insets = next;
      root.dataset.fakeStillInsets = [insets.top, insets.right, insets.bottom, insets.left].join(' ');
      if (current !== undefined) placeStrips();
    },
    // 图片已经出来了的，一订阅就通知一次；还没出来的，出来的时候通知。
    onViewChange: (listener) => {
      viewListeners.add(listener);
      if (!destroyed && current !== undefined) listener(VIEW_INFO);
      return () => viewListeners.delete(listener);
    },
    onUserMoved: () => () => {},
    onLost: (listener) => {
      lostListeners.add(listener);
      return () => lostListeners.delete(listener);
    },
    onSlow: () => () => {},
    resize: () => {
      if (destroyed) return;
      if (current !== undefined) placeStrips();
    },
    readout: () => ({ triangles: 0, drawCalls: 0 }),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      window.clearTimeout(timer);
      settle?.();
      settle = null;
      // 还没完成的 ready 照常完成（不拒绝）。
      resolveReady();
      viewListeners.clear();
      lostListeners.clear();
      strips.destroy();
      root.remove();
    },
  };
}

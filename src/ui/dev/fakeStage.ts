// 沙盘的替身：不用 WebGL，只用普通的页面元素。自动测试通过 ?stage=fake 用它（见 ../stageEngineSource.ts）。
// 它把收到的指令写在自己的 data- 属性上，测试据此判断：
//   data-fake-section         现在摆着哪一小节
//   data-fake-names           题签用当时的名字还是今天的名字
//   data-fake-animated        最近一次换小节是不是滑过去的
//   data-fake-reduced-motion  页面有没有说“减少动态效果”
//   data-fake-resizes         被告知容器大小变了几次
//   data-fake-insets          页面让它四边各留出多少（上 右 下 左）
//   data-fake-moved           读者动没动过镜头
//   data-fake-requests        收到过的每一次 showSection 要去哪一小节，按先后，用“|”隔开
//   data-fake-started         第一个画面摆好了没有（摆好以后隔一小会儿才报告“摆好了”）
//   data-fake-tier            照哪一档画质摆的（full 完整，reduced 减配）
//   data-fake-forced          页面是不是指定了画质（指定了就不嫌慢）
//   data-fake-asked           是不是读者自己点“试试立体的沙盘”要来的
//   data-fake-slow            说没说过“这台设备上太慢”（说过以后它就不再画了）
// 题签用的是真的那一层（src/stage/overlay），只是每条题签指着的位置是编的。
// 替身上没法拖动，没有会断的三维画面，也量不出快慢，各用一个按钮代替。
//
// 地址里另外两个开关：
//   ?readygap=毫秒数       第一个画面摆好以后，隔这么久才报告“摆好了”
//   ?slow=start、start2    没有指定画质的替身，这一次访问里头一座（头两座）还没摆好就说“太慢”
// 画质的上限和真的沙盘程序一样，记在这个模块里，这一次访问里只降不升：说过一次“太慢”，下一座就低一档；
// 降到底（连减配也嫌慢），support() 就回答 too-slow，页面换成图片。

import { sectionHeadings, stripTexts } from '../../domain';
import { mountStrips } from '../../stage/overlay';
import type { StripSpec } from '../../stage/overlay';
import type { NamesMode, StageEngine, StageInsets, StageOptions, StageTier, StageViewInfo, StopStageView, StopTable } from '../../stage/types';
import '../../styles/fake-stage.css';

/** 换小节时滑多久（毫秒）。比“一个小节要连着当上多久才算数”长，测试才碰得到“途中又来新指令”。 */
const GLIDE_MS = 300;

/**
 * 第一个画面摆好以后，隔多久（毫秒）才报告“摆好了”。真沙盘在这中间还要再画一帧；
 * 这中间来的 showSection，替身照滑不误（最不省心的情形）：页面不能在收到“摆好了”的时候就当镜头已经到了。
 * 地址里带 ?readygap=毫秒数 可以把这一段拉长，测试用它稳稳地碰到这个空当。
 */
const READY_GAP_MS = 40;

function readyGap(): number {
  const asked = Number(new URLSearchParams(window.location.search).get('readygap'));
  return Number.isFinite(asked) && asked > 0 ? asked : READY_GAP_MS;
}

/** 地址里要这一次访问的头几座替身“还没摆好就说太慢”：?slow=start 是一座，?slow=start2 是两座。 */
function slowStartsWanted(): number {
  const asked = new URLSearchParams(window.location.search).get('slow');
  return asked === 'start' ? 1 : asked === 'start2' ? 2 : 0;
}

/** 替身只报一次指北和比例尺，数是编的。 */
const VIEW_INFO: StageViewInfo = { northDeg: 30, scale: { px: 96, label: '2 公里' } };

const NO_INSETS: StageInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** 画质的上限：完整、减配，或者连减配也带不动（只能放图片）。 */
type Ceiling = StageTier | 'still';

const RANK: Record<Ceiling, number> = { full: 2, reduced: 1, still: 0 };

/** 这一次访问里量出来的上限，和已经有几座“还没摆好就说太慢”。 */
const visit: { ceiling: Ceiling; slowStarts: number } = { ceiling: 'full', slowStarts: 0 };

/** 当作重新打开了一次页面。只给在 Node 里跑的测试用：那里一个文件要“打开”好几回，模块却只加载一次。 */
export function resetFakeVisit(): void {
  visit.ceiling = 'full';
  visit.slowStarts = 0;
}

export function createFakeStageEngine(config: { fail?: boolean; unsupported?: boolean } = {}): StageEngine {
  return {
    name: 'fake',
    version: '0',
    support: () => {
      if (config.unsupported) return { ok: false, reason: 'no-webgl2' };
      return visit.ceiling === 'still' ? { ok: false, reason: 'too-slow' } : { ok: true };
    },
    create: (container, table, options) => (config.fail ? createFailedView() : createFakeView(container, table, options)),
  };
}

function createFailedView(): StopStageView {
  const never = () => Promise.reject(new Error('沙盘的替身：按要求起不来'));
  const ready = never();
  ready.catch(() => {});
  return {
    ready,
    showSection: never,
    resetView: never,
    setNamesMode: () => {},
    setInsets: () => {},
    onViewChange: () => () => {},
    onUserMoved: () => () => {},
    onLost: () => () => {},
    onSlow: () => () => {},
    resize: () => {},
    readout: () => ({ triangles: 0, drawCalls: 0 }),
    destroy: () => {},
  };
}

function createFakeView(container: HTMLElement, table: StopTable, options: StageOptions): StopStageView {
  const { scene } = table;
  const headings = sectionHeadings(scene);
  const sides = new Map(scene.strips.map((strip) => [strip.id, strip.side]));
  const movedListeners = new Set<(moved: boolean) => void>();
  const lostListeners = new Set<() => void>();
  const slowListeners = new Set<() => void>();

  // 照哪一档摆、怎么评：指定了画质的不评（forced）；读者自己要来的只在“没法用”时才说慢（asked）；别的由替身自己挑（auto）。
  const tier: StageTier = options.tier ?? (visit.ceiling === 'still' ? 'reduced' : visit.ceiling);
  const mode: 'forced' | 'asked' | 'auto' = options.tier === undefined ? 'auto' : options.asked ? 'asked' : 'forced';

  let namesMode: NamesMode = options.namesMode;
  let insets: StageInsets = options.insets ?? NO_INSETS;
  let current: string | undefined = options.section !== undefined && headings.includes(options.section) ? options.section : headings[0];
  let stripIds: string[] = [];
  let moved = false;
  let resizes = 0;
  let started = false;
  let reported = false;
  let slow = false;
  let destroyed = false;
  let gliding = false;
  const requests: string[] = [];
  let timer: number | undefined;
  // 正在路上的那一次指令。被新的顶掉、或者沙盘关掉时，用它让那一次照常完成。
  let settle: (() => void) | null = null;
  // 还没报告的“摆好了”。还没摆好就说了“太慢”的，要等沙盘关掉时才完成。
  let finishReady: (() => void) | null = null;

  const root = document.createElement('div');
  root.className = 'fake-stage';
  root.dataset.fakeReducedMotion = String(options.reducedMotion);
  root.dataset.fakeAnimated = 'false';
  root.dataset.fakeMoved = 'false';
  root.dataset.fakeResizes = '0';
  root.dataset.fakeRequests = '';
  root.dataset.fakeStarted = 'false';
  root.dataset.fakeTier = tier;
  root.dataset.fakeForced = String(mode === 'forced');
  root.dataset.fakeAsked = String(mode === 'asked');
  root.dataset.fakeSlow = 'false';

  const title = document.createElement('p');
  title.className = 'fake-stage-title';

  const buttons = document.createElement('div');
  buttons.className = 'fake-stage-buttons';
  const nudge = button('fake-stage-nudge', '沙盘的替身：挪一下镜头', () => setMoved(true));
  const lose = button('fake-stage-lose', '沙盘的替身：断掉画面', () => lostListeners.forEach((listener) => listener()));
  // 只有摆好了的替身才用这个按钮说慢（还没摆好就慢的那一种，用地址里的 ?slow=start）。
  const tooSlow = button('fake-stage-slow', '沙盘的替身：说太慢', () => {
    if (reported) goSlow();
  });
  buttons.append(nudge, lose, tooSlow);

  root.append(title, buttons);
  container.append(root);
  const strips = mountStrips(container);

  // 和真沙盘一样：只有“动过没有”变了才通知。
  function setMoved(value: boolean): void {
    if (moved === value) return;
    moved = value;
    root.dataset.fakeMoved = String(value);
    movedListeners.forEach((listener) => listener(value));
  }

  // 每条题签指着的位置是编的：从左到右匀着排开，都在画面里。
  function placeStrips(): void {
    const width = root.clientWidth;
    const height = root.clientHeight;
    const count = stripIds.length;
    const anchors = stripIds.map((id, i) => ({ id, x: (width * (i + 1)) / (count + 1), y: height * 0.62, visible: true }));
    strips.place(anchors, { width, height }, insets);
  }

  // 摆出现在这一小节：写上是哪一节，换上这一节的题签。
  function paint(): void {
    root.dataset.fakeSection = current ?? '';
    root.dataset.fakeNames = namesMode;
    root.dataset.fakeInsets = [insets.top, insets.right, insets.bottom, insets.left].join(' ');
    title.textContent = `沙盘的替身（自动测试用，不是真的沙盘）：${current ?? ''}`;
    const texts = current === undefined ? [] : stripTexts(scene, current, namesMode);
    stripIds = texts.map((text) => text.id);
    strips.set(texts.map((text): StripSpec => ({ id: text.id, text: text.text, tone: text.tone, side: sides.get(text.id) })));
    placeStrips();
  }

  // 镜头去一小节。途中又来新的指令时，旧的那一次照常完成，但不再摆它那一节。
  // 和真沙盘一样：一开始走就不算读者动过，到了以后也不算；第一个画面还没摆好就直接摆到位，不滑；滑的时候题签藏着。
  function moveTo(section: string, animate: boolean): Promise<void> {
    window.clearTimeout(timer);
    settle?.();
    setMoved(false);
    const wait = animate && started && !options.reducedMotion ? GLIDE_MS : 0;
    root.dataset.fakeAnimated = String(wait > 0);
    gliding = wait > 0;
    if (gliding) strips.hide();
    return new Promise((resolve) => {
      settle = resolve;
      timer = window.setTimeout(() => {
        settle = null;
        gliding = false;
        current = section;
        paint();
        setMoved(false);
        resolve();
      }, wait);
    });
  }

  // 说“这台设备上太慢”：只说一次；指定了画质的不说。说完把这一次访问的上限降下来，自己从此不再画，等页面来关。
  // 读者自己要来的那一座说慢，就是“没法用”：上限直接降到底。别的降到比自己低一档（已经更低就不动）。
  function goSlow(): void {
    if (slow || destroyed || mode === 'forced') return;
    slow = true;
    const next: Ceiling = mode === 'asked' || tier === 'reduced' ? 'still' : 'reduced';
    if (RANK[next] < RANK[visit.ceiling]) visit.ceiling = next;
    root.dataset.fakeSlow = 'true';
    window.clearTimeout(timer);
    settle?.();
    settle = null;
    gliding = false;
    slowListeners.forEach((listener) => listener());
  }

  paint();

  return {
    ready: new Promise((resolve) => {
      finishReady = resolve;
      window.setTimeout(() => {
        started = true;
        root.dataset.fakeStarted = 'true';
        // 还没摆好就嫌慢：ready 不再完成也不拒绝，等页面来关（关的时候照常完成）。
        if (!destroyed && mode === 'auto' && visit.slowStarts < slowStartsWanted()) {
          visit.slowStarts += 1;
          goSlow();
          return;
        }
        window.setTimeout(() => {
          reported = true;
          finishReady = null;
          resolve();
        }, readyGap());
      }, 0);
    }),
    showSection: (section, opts) => {
      if (destroyed) return Promise.reject(new Error('沙盘的替身已经关掉'));
      if (!headings.includes(section)) return Promise.reject(new Error(`场景里没有这一小节：${section}`));
      if (slow) return Promise.resolve();
      requests.push(section);
      root.dataset.fakeRequests = requests.join('|');
      return moveTo(section, opts?.animate ?? true);
    },
    resetView: () => {
      if (destroyed) return Promise.reject(new Error('沙盘的替身已经关掉'));
      return current === undefined || slow ? Promise.resolve() : moveTo(current, true);
    },
    setNamesMode: (mode_) => {
      if (destroyed || slow) return;
      namesMode = mode_;
      root.dataset.fakeNames = namesMode;
      // 和真沙盘一样：镜头正在滑的时候题签藏着，到了自然会按新的名字摆。
      if (!gliding) paint();
    },
    setInsets: (next) => {
      if (destroyed || slow) return;
      insets = next;
      root.dataset.fakeInsets = [insets.top, insets.right, insets.bottom, insets.left].join(' ');
      placeStrips();
    },
    // 替身一挂上就算画过了，所以一订阅就通知一次。
    onViewChange: (listener) => {
      if (!destroyed) listener(VIEW_INFO);
      return () => {};
    },
    onUserMoved: (listener) => {
      movedListeners.add(listener);
      return () => movedListeners.delete(listener);
    },
    onLost: (listener) => {
      lostListeners.add(listener);
      return () => lostListeners.delete(listener);
    },
    // 替身量不出快慢：只在测试要它说的时候说（?slow=start、“说太慢”的按钮）。
    onSlow: (listener) => {
      slowListeners.add(listener);
      return () => slowListeners.delete(listener);
    },
    resize: () => {
      if (destroyed || slow) return;
      resizes += 1;
      root.dataset.fakeResizes = String(resizes);
      placeStrips();
    },
    readout: () => ({ triangles: 0, drawCalls: 0 }),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      window.clearTimeout(timer);
      settle?.();
      settle = null;
      if (slow) finishReady?.();
      finishReady = null;
      movedListeners.clear();
      lostListeners.clear();
      slowListeners.clear();
      strips.destroy();
      root.remove();
    },
  };
}

function button(className: string, label: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = className;
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

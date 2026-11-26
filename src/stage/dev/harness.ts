// 沙盘测试页（stage-dev.html）：只挂一座全窗口的沙盘和几个小按钮，用来单独检查沙盘适配层。
// 不属于正式构建。按钮只用 StopStageView 接口里的东西，和正式页面的用法一样。
// 拍定格图的工具（npm run stills）也是在这一页上拍的。
//
// 网址上可以带：?figure=su-shi&stop=xuzhou 看哪一站（不写就是这两个）；&stop=route 看这位人物的全程沙盘
//（只有立体的沙盘程序摆得了它；站的地名上带着站号的印，和页面一样从 figure.json 里拼）；&section=水退以后 一开始摆哪一节；
// &names=modern 题签用今天的名字；&reduced 不滑，直接换；
// &tier=full 或 &tier=reduced 指定画质（不写由沙盘程序自己挑）；
// &insets=62,130,130,130 四边各留出多少像素（上、右、下、左；不写是上 44、下 28）；
// &bare 只留沙盘：不要按钮、不要底下那行字，题签也不显出来（拍定格图用：图上不带字）；
// &bg=%23ebe3d3 页面的底色（沙盘的画布是透明的，四周露出来的就是它）；
// &engine=still 不摆立体的沙盘，摆定格图（这一站要已经有定格图），用来在各种窗口大小上看定格图摆得对不对。
// 试夜色用的三样（只在这一页上有，读者看的页面上没有）：
// &sky=night&moon=103,12 沙盘摆出来以前，把这座沙盘的每一小节都改成夜里，月亮在方位 103 度、高 12 度的地方（站点沙盘才有）；
// &sheenmoon=12 水面的亮照这个高度的月亮算，灯还照 moon 写的高度（把月亮画高、水面的亮照真的高度算时用）。

import { loadFigure } from '../../domain/content';
import type { TableScene } from '../../domain/scene';
import { loadStopTable } from '../../domain/sceneContent';
import { sectionInfo } from '../../domain/sceneText';
import { stopMarks } from '../../domain/stopMarks';
import { loadStageEngine, stillEngine } from '../index';
import { STYLES } from '../styles';
import type { NamesMode, StageInsets, StageTier, StageViewInfo, StopStageView } from '../types';

const params = new URLSearchParams(location.search);
const figureId = params.get('figure') ?? 'su-shi';
const stopId = params.get('stop') ?? 'xuzhou';
const bare = params.has('bare');
const useStill = params.get('engine') === 'still';

/** 网址里指定的画质；没写、或者写的不是这两档，就是不指定。 */
function askedTier(): StageTier | undefined {
  const value = params.get('tier');
  return value === 'full' || value === 'reduced' ? value : undefined;
}

/** 网址里写的四边留多少（上、右、下、左，四个不小于 0 的数，用逗号隔开）；没写或写得不对，用这一页平常的数。 */
function askedInsets(): StageInsets {
  const usual: StageInsets = { top: 44, right: 0, bottom: 28, left: 0 };
  const value = params.get('insets');
  if (value === null) return usual;
  const numbers = value.split(',').map(Number);
  if (numbers.length !== 4 || !numbers.every((n) => Number.isFinite(n) && n >= 0)) {
    console.warn(`[沙盘测试页] insets 要写四个数（上,右,下,左），现在是“${value}”，先用平常的数`);
    return usual;
  }
  return { top: numbers[0], right: numbers[1], bottom: numbers[2], left: numbers[3] };
}

const container = document.getElementById('stage') as HTMLElement;
const bar = document.getElementById('bar') as HTMLElement;
const status = document.getElementById('status') as HTMLElement;

// 只留沙盘：按钮、底下那行字和题签由 stage-dev.html 里的样式藏起来（body.bare）
if (bare) document.body.classList.add('bare');
const background = params.get('bg');
if (background !== null) {
  if (/^#[0-9a-f]{6}$/i.test(background)) document.body.style.background = background;
  else console.warn(`[沙盘测试页] bg 要写成 #rrggbb，现在是“${background}”，不改底色`);
}

/**
 * 网址上写了 sky=night 和 moon 的话，把这座沙盘的每一小节都改成夜里；写了 sheenmoon 的话，水面的亮照那个高度的月亮算。
 * 要在沙盘摆出来以前做。写得不对就什么也不改，在控制台里说一句。
 * 样式是照登记表取的（和沙盘摆的时候取到的是同一份）：水面的亮改在它身上，沙盘就照改过的算。
 */
async function tryNight(scene: TableScene): Promise<void> {
  if (params.get('sky') !== 'night') return;
  const [azimuth, altitude] = (params.get('moon') ?? '').split(',').map(Number);
  if (scene.level === 'route' || !(azimuth >= 0 && azimuth <= 360) || !(altitude > 0 && altitude < 90)) {
    console.warn('[沙盘测试页] 试夜色要写 sky=night&moon=方位,高度（方位 0 到 360，高度 0 到 90 之间），而且只有站点沙盘能试；这一次不改');
    return;
  }
  for (const section of scene.sections) {
    section.sky = 'night';
    section.moon = { azimuth, altitude };
  }
  const sheenMoon = Number(params.get('sheenmoon'));
  if (!(sheenMoon > 0)) return;
  const row = STYLES.find((entry) => entry.id === scene.style);
  if (!row) return;
  const { style } = await row.load();
  const usual = style.light;
  style.light = (sky, moon) => {
    const light = usual(sky, moon);
    if (sky !== 'night' || !moon) return light;
    return { ...light, sheen: usual(sky, { ...moon, altitude: sheenMoon }).sheen };
  };
}

let view: StopStageView | null = null;
let headings: string[] = [];
let current = params.get('section') ?? '';
let namesMode: NamesMode = params.get('names') === 'modern' ? 'modern' : 'ancient';
let moved = false;
let viewInfo: StageViewInfo | null = null;
let engineLine = '';
let sectionLine = '';
let numbersLine = '';

/** 给自动测试脚本看的记录，只留最近的一些。 */
const log = { moved: [] as boolean[], lost: 0 };

function button(text: string, onClick: () => void, options: { active?: boolean; disabled?: boolean; id?: string } = {}): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  if (options.id) b.dataset.id = options.id;
  b.classList.toggle('active', Boolean(options.active));
  b.disabled = Boolean(options.disabled);
  b.addEventListener('click', onClick);
  return b;
}

function gap(): HTMLElement {
  const g = document.createElement('span');
  g.className = 'gap';
  return g;
}

function showStatus(): void {
  const scale = viewInfo ? `比例尺 ${viewInfo.scale.label}（${viewInfo.scale.px} 像素） · 指北 ${viewInfo.northDeg.toFixed(0)} 度` : '';
  status.textContent = [engineLine, sectionLine, scale, numbersLine].filter(Boolean).join(' · ');
}

/** 读一次沙盘的读数（现在画着多少个三角形、画一帧调用显卡多少次、用的哪一档画质），写到状态栏里。 */
function count(): void {
  const readout = view?.readout();
  const tier = readout?.perf ? `，画质 ${readout.perf.tier === 'full' ? '完整' : '减配'}，像素比 ${readout.perf.pixelRatio}` : '';
  numbersLine = readout ? `${readout.triangles} 个三角形，${readout.drawCalls} 次绘制${tier}` : '';
  showStatus();
}

/** 沙盘旁边要印的字：这一节的时间和题记。生成不出来时只写小节的名字。 */
function describe(heading: string, scene: TableScene): string {
  try {
    const info = sectionInfo(scene, heading);
    return `${info.section}（${info.date}）${info.line}`;
  } catch {
    return heading;
  }
}

function render(): void {
  bar.replaceChildren(
    ...headings.map((heading, i) => button(`${i + 1} ${heading}`, () => goTo(heading), { active: heading === current, id: heading })),
    gap(),
    button('古名', () => setNames('ancient'), { active: namesMode === 'ancient', id: 'ancient' }),
    button('今名', () => setNames('modern'), { active: namesMode === 'modern', id: 'modern' }),
    gap(),
    button('回到这一节', () => void view?.resetView(), { disabled: !moved, id: 'reset' }),
    gap(),
    button('数三角形', count, { id: 'count' }),
  );
}

let describeScene: TableScene | null = null;
/** 记着哪一次指令是最新的：被顶掉的那一次完成时不改页面上的字。 */
let latest = 0;

function goTo(heading: string, animate = true): void {
  current = heading;
  render();
  const mine = ++latest;
  void view?.showSection(heading, { animate }).then(() => {
    if (mine !== latest || !describeScene) return;
    sectionLine = describe(heading, describeScene);
    count();
  });
}

function setNames(mode: NamesMode): void {
  namesMode = mode;
  view?.setNamesMode(mode);
  render();
}

async function mount(): Promise<void> {
  const [engine, table, figure] = await Promise.all([useStill ? Promise.resolve(stillEngine) : loadStageEngine(), loadStopTable(figureId, stopId), loadFigure(figureId)]);
  engineLine = `${engine.name} ${engine.version}`;
  if (!table) {
    status.textContent = `${figureId}/${stopId} 这一站还没有场景文件`;
    return;
  }
  const support = engine.support();
  if (!support.ok) {
    status.textContent = `这个浏览器画不出立体的沙盘（${support.reason}）`;
    return;
  }
  // 读内容的程序还只认站点沙盘（它给的类型写的是站点沙盘的场景）：route.json 读出来其实是全程沙盘，在这里认出来
  const scene = table.scene as TableScene;
  await tryNight(scene);
  describeScene = scene;
  headings = scene.sections.map((s) => s.heading);
  if (!headings.includes(current)) current = headings[0] ?? '';
  render();
  status.textContent = `${engineLine} · 沙盘正在摆出来，要等一会儿…`;

  const created = engine.create(
    container,
    // 读到什么就交给沙盘什么：这一站有先画好的地面、有定格图的，一起带上，和正式页面摆出来的是同一座。
    // 全程沙盘交进去时 kind 写 route。
    scene.level === 'route' ? { ...table, kind: 'route', key: `${figureId}/${stopId}`, scene } : { kind: 'stop', key: `${figureId}/${stopId}`, ...table },
    {
      namesMode,
      reducedMotion: params.has('reduced') || window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      section: current,
      insets: askedInsets(),
      tier: askedTier(),
      // 全程沙盘上每一站的印：和页面一样从 figure.json 里拼（网址照页面的写法；这一页上按了只是换一下 # 后面的字）
      marks: scene.level === 'route' && figure ? stopMarks(figure, (id) => `#/${figureId}/${id}`) : undefined,
    },
  );
  view = created;
  created.onViewChange((info) => {
    viewInfo = info;
    showStatus();
  });
  created.onUserMoved((value) => {
    moved = value;
    log.moved.push(value);
    if (log.moved.length > 100) log.moved.shift();
    render();
  });
  created.onLost(() => {
    log.lost += 1;
    status.textContent = '沙盘的画面断了。刷新页面重新摆出来。';
  });
  try {
    await created.ready;
  } catch (error) {
    status.textContent = `沙盘没能摆出来：${error instanceof Error ? error.message : String(error)}`;
    throw error;
  }
  sectionLine = describe(current, scene);
  count();
}

function unmount(): void {
  view?.destroy();
  view = null;
  moved = false;
  viewInfo = null;
  numbersLine = '';
  render();
}

window.addEventListener('resize', () => view?.resize());

const ready = mount();
ready.catch(() => {});

const dev = {
  ready,
  log,
  get view() {
    return view;
  },
  get headings() {
    return headings;
  },
  get section() {
    return current;
  },
  get moved() {
    return moved;
  },
  /** 底下那行字现在写的什么（沙盘没摆出来时，缘故写在这里）。 */
  get status() {
    return status.textContent ?? '';
  },
  goTo,
  mount,
  unmount,
};

declare global {
  interface Window {
    __stageDev: typeof dev;
  }
}
window.__stageDev = dev;

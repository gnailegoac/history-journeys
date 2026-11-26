// 沙盘栏。人物页上摆全程沙盘，看的是头一节（全程）；有沙盘的站摆这一站的沙盘，镜头跟着读到的小节走；
// 还没有自己的沙盘的站，摆的还是全程沙盘，看的是到这一站去的那一节（来路）。人物页和这几站用的是同一座（同一个 key）：
// 在它们之间来回，全程沙盘不重摆，镜头滑过去。沙盘起不来时留一句话，不影响阅读。
//
// 这一栏有七种状态，写在 data-stage-state 上，每一种都至少有一张图或一句话：
//   still        没有沙盘可摆（这位人物还没有全程沙盘）：一句“还没接进来”。全程沙盘这一次没读出来是 failed，可以再试一次
//   loading      正在摆
//   ready        摆好了
//   failed       没能摆出来，可以再试一次
//   unsupported  这个浏览器画不了
//   slow         这台设备带不动立体的沙盘（或者地址里指定了只放图片）
//   lost         画面中途断了，可以重新摆出来
// 另外六个属性：
//   data-stage-bar      这一栏带着时间轴（人物页和首页；一站的页面上不写）。从这一栏一摆上就写，全程沙盘还在读的时候就有：
//                       沙盘在上的排法里这样的栏比别的栏高出一条时间轴（layout.css），不会等全程沙盘到了才在读者眼前长高
//   data-stage-level    摆着的是全程沙盘时写 route；站点沙盘不写
//   data-stage-picture  现在放着的是什么：table 立体的沙盘，still 图片，none 都没有。
//                       立体的沙盘盖着图片慢慢显出来的那一小会儿还算 still，显完、图片拿走了才是 table
//                       （拍照的工具等到 table 再拍，拍到的就只有沙盘）。
//   data-stage-section  上面那一张画面（沙盘或者图片）现在摆着的小节
//   data-stage-tier     摆好的立体沙盘是哪一档画质（沙盘程序给了读数才有）
//   data-stage-dive     全程沙盘的镜头正往哪一站潜（那一站的 id）：读者点了一个有自己的沙盘的站，潜完才换页（见 ./dive.ts）
//
// 有沙盘的一站，这一栏里叠着两层（见 TableStage）：下面是每一小节的图片（定格图，src/stage/still），上面是立体的沙盘。
// 图片先出来；立体的沙盘摆好了盖上去，图片就拿走。立体的沙盘摆不了（浏览器画不了、设备太慢、没摆出来、画面断了）时，
// 图片留下来跟着读到的小节换，按钮下面多一行话说明缘故。这座沙盘没有图片、或者图片取不到，就和以前一样只留一句话。
//
// 沙盘旁边的字（时间、题记、一句如实的说明、远处）不经过沙盘，由这里用 sectionInfo() 从场景数据生成：
// 有画面的时候，上面那一张画面最新的一次 showSection() 完成时才换；没有画面的时候，跟着读到的小节换。
// 这一块字的高度是定死的（stage.css），所以换小节时沙盘四边留的空不变；完整的说明点“说明”才展开，盖在沙盘上，不挤它。
// 指北和比例尺跟着镜头变，沙盘每一帧都可能通知，所以直接改页面元素，不放进会让整栏重画的状态里。
//
// 人物页和首页的栏（摆的是全程沙盘），底下那一条里题记上面还有一条：时间轴（.stage-bar）。它里面的东西是另一段程序（src/timebar/），
// 栏里摆上全程沙盘才去取（见 BarBand）；这里只留出地方。这一条的高是样式表定死的（--stage-bar-h），那一段程序到没到，
// 沙盘四边留的空都一样。一站的页面上没有这一条，那一段程序也不去取：一站自己的沙盘上没有小像；还没有自己的沙盘的一站摆的虽是全程沙盘，
// 看的只是到这一站去的那一节，一条走完一生的时间轴在那里大半的日子都没有小像。
// 读者动了时间轴以后，全程沙盘看哪一节听时间轴的（BAR_GOAL）：它只报“该看哪一节”，镜头怎么过去还是这一栏原来的那一套。

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, ReactNode, Ref } from 'react';
import { useOnDemand } from '../app/useLoaded';
import type { Loaded } from '../app/useLoaded';
import { sectionHeadings, sectionInfo } from '../domain';
import type { SectionInfo, TableScene } from '../domain';
import { KAI_FAMILY } from '../fonts/probe';
import type { BarProps, NamesMode, RouteTable, StageInsets, StageOptions, StageReadout, StageTable, StageTier, StageViewInfo, StopStageView, StopTable } from '../stage/types';
import { NotePanel, SectionCaption } from './SectionCaption';
import { Waiting } from './Waiting';
import { cameByDive, preloadStop, watchDives } from './dive';
import { fitScale } from './scale';
import { canDrawStage, divesHere, pickStageEngine, pickStillEngine, pickTier, wantsReadout } from './stageEngineSource';
import { STAGE_TEXT, stageDebugLine } from './text';
import '../styles/stage.css';
import '../styles/timebar.css';

type PaneState = 'still' | 'loading' | 'ready' | 'failed' | 'unsupported' | 'slow' | 'lost';

/** 现在放着的是什么：立体的沙盘，图片，都没有。 */
type Picture = 'table' | 'still' | 'none';

/**
 * 这一次访问里，立体的沙盘摆不摆：
 *   auto      照常（地址里指定了画质就照它；没指定由沙盘程序自己挑）
 *   pictures  只放图片：量出来这台设备带不动，或者读者试过以后点了“换回图片”
 *   asked     读者自己点了“试试立体的沙盘”：照减配的一档摆，不再因为“有点慢”换掉
 */
type TableChoice = 'auto' | 'pictures' | 'asked';

/**
 * 沙盘栏（连它的一像素边线）不到这么宽（像素）时用窄的排法、小一号的题签；够宽就在栏上挂 .is-wide（样子在 stage.css）。
 * 584 是横着拿的平板上沙盘栏的宽：从这里起，题记最长的 40 个字用 14px 的字一行放得下。
 * 题签的测试照同一个数分大小（tests/stage/support/stripSizes.ts）。
 */
const WIDE_PANE_PX = 584;
/** 窄的排法里，比例尺的那一段最长多少像素：它和小节、时间挤在一行里。 */
const NARROW_SCALE_PX = 56;
/**
 * 宽屏的条件，和 layout.css 的媒体查询是同一句（够宽，而且横着）。只有窄屏上能收起沙盘。
 * 正文那一头也用它（useReadingSection.ts）：这一句从真变假、从假变真，就是版面换了排法。
 */
export const WIDE_SCREEN = '(min-width: 960px) and (orientation: landscape)';

/** 立体的沙盘盖着图片显出来用多久（毫秒）。和 stage.css 里 .is-handing-over 的那一条是同一个数。用定时器数，不等浏览器的通知。 */
const HANDOVER_FADE_MS = 240;
/** 打开一站以后过了这么久（毫秒）还什么画面都没有，才说“沙盘正在摆出来”。 */
const LOADING_LINE_AFTER_MS = 1500;
/** 立体的沙盘嫌慢要换掉时，最多等图片这么久（毫秒）：图片出来了，或者等够了，才把它关掉。 */
const STILL_WAIT_MS = 1500;
/** 地址里带 ?debug=1 时，那一行读数隔多久（毫秒）重写一次。 */
const DEBUG_EVERY_MS = 1000;

interface Props {
  /** 正在读的是不是一站。人物页（和首页）上为 false。 */
  onStopPage: boolean;
  /** 这一站自己的沙盘；读出来是 null 表示这一站还没有自己的沙盘。人物页上不看它。 */
  table: Loaded<StopTable | null>;
  /** 读到了哪一小节（小节标题）；还不知道时为 null。摆着全程沙盘时不看它。 */
  section: string | null;
  /** 这位人物的全程沙盘；读出来是 null 表示还没有。 */
  route: Loaded<RouteTable | null>;
  /** 正在读的那一站的 id：摆着全程沙盘时，看的是到这一站去的那一节。 */
  stopId?: string | null;
  /** 全程沙盘上每一站的印（src/domain/stopMarks.ts）。 */
  marks?: StageOptions['marks'];
  /**
   * 这一站的正文写好了：它要是没有自己的沙盘，按钮下面多一行话说明沙盘上摆的是什么。
   * 一站的正文还没写：沙盘摆不出来时的那几句不说“正文可以照常读”；它自己的沙盘上，中间的按钮写“回到这一处”。
   */
  written?: boolean;
  /** 这一站的正文写好了，可是这一次没读出来：沙盘摆不出来时的那几句也不说“正文可以照常读”，别的照写好了的一站。 */
  textLost?: boolean;
  /** 沙盘的数据没读出来，读者点了“再试一次”。 */
  onReloadTable: () => void;
}

/** 人物页上没有“这一站自己的沙盘”。 */
const NO_OWN: Loaded<StopTable | null> = { state: 'ready', value: null };

/** 沙盘摆不出来时的一句话。没有正文的一站（bare）不说句尾的“正文可以照常读”：那一页上没有正文。正文这一次没读出来的一站也不说。 */
const say = (text: string, bare: boolean): string => (bare ? text.replace(/[，。]正文可以照常读/, '') : text);

export function StagePane({ onStopPage, table, section, route, stopId, marks, written, textLost, onReloadTable }: Props) {
  // 古名还是今名、收没收起、立体的沙盘摆不摆，换一站也留着（只记到这一次访问结束，不存到别处）。
  const [namesMode, setNamesMode] = useState<NamesMode>('ancient');
  const [folded, setFolded] = useState(false);
  const [choice, setChoice] = useState<TableChoice>('auto');
  // 读者在这一栏里按了按钮，或者画面断了，栏里的东西接着就换掉：换完以后把焦点放回栏里（见 restoreFocus）。
  const keepFocus = useRef(false);

  // 这一栏摆哪一座：这一站自己的沙盘；人物页上，或者这一站没有自己的沙盘，就是全程沙盘。
  const own = onStopPage ? table : NO_OWN;
  const source: Loaded<StageTable | null> = own.state === 'ready' && !own.value ? route : own;
  // 正在读的是一站，它的正文还没写。
  const bare = onStopPage && !written;
  // 摆不出来时的那几句说不说“正文可以照常读”：没有正文的一站不说，正文这一次没读出来的一站也不说。
  const noText = bare || !!textLost;

  // 沙盘的数据还在读：也是过了一会儿还没有画面才说“正在摆”。从哪一刻等起的记下来，沙盘接着数，不从头数。
  const reading = source.state === 'loading';
  const openedAt = useRef<number | null>(null);
  useEffect(() => {
    if (reading) openedAt.current = Date.now();
  }, [reading]);
  const late = useLate(reading, LOADING_LINE_AFTER_MS);

  // 题签用的楷体是这位人物自己的字，不预先声明：平常要等题签摆出来、浏览器排到它了才去取，那时图片刚显出来，
  // 没有自带楷体的平板上，题签会先是宋体、过半秒才换成楷体。所以一知道这一栏要摆沙盘（数据读出来了，图片和沙盘程序都还没到），
  // 就叫浏览器先把它取来；取过一次浏览器自己记着。没有沙盘可摆的栏不取，没有这一栏的页面（“来源”页、没找到的页面）更不取。
  // 浏览器没有 document.fonts、它的 load 当场出错、或者没取成，都不要紧（所以整句包着）：题签摆出来的时候浏览器照旧会去取。
  // 楷体的名称是做字体的工具写的（src/fonts/probe.ts）。
  const tableKnown = source.state === 'ready' && !!source.value;
  useEffect(() => {
    if (!tableKnown) return;
    try {
      void document.fonts.load(`1em "${KAI_FAMILY}"`).catch(() => {});
    } catch {
      // 不取就是了
    }
  }, [tableKnown]);

  if (source.state === 'loading') {
    return (
      <Pane state="loading" picture="none" pinned bar={!onStopPage}>
        <Says>{late && <p className="stage-loading">{STAGE_TEXT.loading}</p>}</Says>
      </Pane>
    );
  }
  // 没读出来：这一站自己的沙盘，或者要摆的全程沙盘。说一句，读者可以再试一次。
  if (source.state === 'error') {
    return (
      <Pane state="failed" picture="none">
        <Says>
          <Message text={say(STAGE_TEXT.failed, noText)} action={STAGE_TEXT.retry} onAction={onReloadTable} keepFocus={keepFocus} />
        </Says>
      </Pane>
    );
  }
  const found = source.value;
  // 没有沙盘可摆：这位人物还没有全程沙盘。
  if (!found) {
    return (
      <Pane state="still" picture="none">
        <p className="stage-still-line" role="status">
          {STAGE_TEXT.noRoute}
        </p>
      </Pane>
    );
  }
  // 全程沙盘看哪一节：人物页上是头一节；一站的页面上是到这一站去的那一节。每一次都明说：
  // 摆着的沙盘记着上一次认得的小节，不说的话，从一站回到人物页它还停在那一站的来路上。
  const whole = found.kind === 'route';
  const road = whole ? ((stopId && found.scene.sections.find((s) => s.stop === stopId)) || found.scene.sections[0])?.heading : null;

  return (
    <TableStage
      key={found.key}
      table={found}
      section={whole ? (road ?? null) : section}
      resetLabel={!whole ? (bare ? STAGE_TEXT.resetHere : STAGE_TEXT.reset) : onStopPage ? STAGE_TEXT.resetRoad : STAGE_TEXT.resetWhole}
      bare={noText}
      bar={!onStopPage}
      marks={marks}
      standing={whole && onStopPage && written ? STAGE_TEXT.roadNotice : null}
      namesMode={namesMode}
      onNamesMode={setNamesMode}
      folded={folded}
      onFolded={setFolded}
      choice={choice}
      onChoice={setChoice}
      openedAt={openedAt}
      keepFocus={keepFocus}
    />
  );
}

/** active 连着是 true 满了 ms 毫秒以后才是 true；active 一变回 false 就从头数。 */
function useLate(active: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => setLate(true), ms);
    return () => {
      window.clearTimeout(timer);
      setLate(false);
    };
  }, [active, ms]);
  return active && late;
}

// ---------------------------------------------------------------- 外框和几句话

interface PaneProps {
  state: PaneState;
  picture: Picture;
  /** 摆好的立体沙盘是哪一档画质。 */
  tier?: StageTier | null;
  /** 上面那一张画面现在摆着的小节。 */
  section?: string;
  /** 摆着的是全程沙盘。 */
  route?: boolean;
  /** 这一栏带着时间轴（人物页和首页）。 */
  bar?: boolean;
  /** 全程沙盘的镜头正往哪一站潜。 */
  dive?: string | null;
  /** 窄屏上钉在顶上不动（有画面的时候，或者摆着的沙盘画面断了）；不写就跟着页面一起滚走。 */
  pinned?: boolean;
  folded?: boolean;
  paneRef?: Ref<HTMLElement>;
  children: ReactNode;
}

// tabIndex={-1}：这一栏自己不在 Tab 的顺序里，但程序可以把焦点放上来（见 restoreFocus 和站点页的“到沙盘”）。
function Pane({ state, picture, tier, section, route, bar, dive, pinned = false, folded = false, paneRef, children }: PaneProps) {
  const className = ['stage-pane', pinned ? 'is-pinned' : '', pinned && folded ? 'is-folded' : ''].filter(Boolean).join(' ');
  return (
    <section
      ref={paneRef}
      className={className}
      tabIndex={-1}
      aria-label={STAGE_TEXT.label}
      data-stage-state={state}
      data-stage-picture={picture}
      data-stage-tier={tier ?? undefined}
      data-stage-section={section}
      data-stage-level={route ? 'route' : undefined}
      data-stage-bar={bar ? '' : undefined}
      data-stage-dive={dive ?? undefined}
    >
      {children}
    </section>
  );
}

/**
 * “正在摆”“没能摆出来”“画面断了”“这里放的是图片”这几句话都放在这一块里。这一块从头到尾都在页面上，
 * 话是后来换进去的：读屏软件只在这种“一直在、里面的字变了”的地方才会把新的话念出来。
 */
function Says({ children }: { children: ReactNode }) {
  return (
    <div className="stage-says" role="status">
      {children}
    </div>
  );
}

interface MessageProps {
  text: string;
  action?: string;
  onAction?: () => void;
  keepFocus: MutableRefObject<boolean>;
}

function Message({ text, action, onAction, keepFocus }: MessageProps) {
  const button = useRef<HTMLButtonElement>(null);
  // 这句话是顶替别的东西出现的（画面断了；再试了一次还是不成）：焦点原来在栏里的话，放到它的按钮上。
  // 这句话没有按钮时不管：焦点由摆沙盘的那一层放到沙盘栏上。
  useEffect(() => {
    if (button.current) restoreFocus(keepFocus, button.current);
  }, [keepFocus]);
  return (
    <div className="stage-message">
      <p>{text}</p>
      {action && (
        <button
          type="button"
          ref={button}
          className="stage-button stage-retry"
          onClick={() => {
            // 这个按钮马上就没了：记下焦点原来在栏里。
            keepFocus.current = true;
            onAction?.();
          }}
        >
          {action}
        </button>
      )}
    </div>
  );
}

/**
 * 之前记下了“焦点原来在沙盘栏里”，就把焦点放到 target 上（没有 target 就算了）。
 * 只在焦点已经没了着落的时候才放：带着焦点的那个按钮被换掉了（焦点掉回了页面上），或者焦点是程序先前放在沙盘栏上的。
 * 焦点还在一个没被换掉的东西上（栏里留下来的按钮；或者读者自己挪到了别处，比如换了一页到了标题上），就不去抢。
 */
function restoreFocus(flag: MutableRefObject<boolean>, target: HTMLElement | null): void {
  if (!flag.current) return;
  flag.current = false;
  if (!target) return;
  const active = document.activeElement;
  if (active && active !== document.body && active.closest('.stage-pane') !== active) return;
  target.focus({ preventScroll: true });
}

// ---------------------------------------------------------------- 一座沙盘（站点沙盘，或者全程沙盘）

type Phase = Exclude<PaneState, 'still'>;

const NO_INSETS: StageInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** 叠着的两层各记一份：现在挂着的那一座、让它去的小节、它已经摆到的小节、它最近报的指北和比例尺、告诉过它的留边。 */
interface Slot {
  view: StopStageView | null;
  /** 第几次指令。只有最新的一次完成了才算“摆到了”。 */
  turn: number;
  requested: string | null;
  arrived: string | null;
  info: StageViewInfo | null;
  insets: StageInsets;
}

function emptySlot(): Slot {
  return { view: null, turn: 0, requested: null, arrived: null, info: null, insets: NO_INSETS };
}

interface TableProps {
  table: StageTable;
  section: string | null;
  /** 中间那个按钮上的字：回到这一节，回到这一处，回到全程，回到这一段。 */
  resetLabel: string;
  /** 正在读的一站没有正文，或者正文这一次没读出来：摆不出来时的那一句不说“正文可以照常读”。 */
  bare: boolean;
  /** 这一栏带着时间轴（人物页和首页：摆的是全程沙盘）。 */
  bar: boolean;
  marks: StageOptions['marks'];
  /** 这一座从头到尾都印在按钮下面的一行话（这一站没有自己的沙盘）；没有是 null。立体的沙盘摆不了、放着图片时，让给那时候的那一句。 */
  standing: string | null;
  namesMode: NamesMode;
  onNamesMode: (mode: NamesMode) => void;
  folded: boolean;
  onFolded: (folded: boolean) => void;
  choice: TableChoice;
  onChoice: (choice: TableChoice) => void;
  /** 这一站是从哪一刻开始等的（沙盘的数据开始读的时候）；不知道是 null。 */
  openedAt: MutableRefObject<number | null>;
  keepFocus: MutableRefObject<boolean>;
}

// 每换一座沙盘，这个组件从头来（外面给了不同的 key），里面的状态不会带着上一座的。
// 同一座沙盘重摆（再试一次、重新摆出来、降一档、读者要试试立体的）不从头来：只是下面“摆立体的沙盘”那一段重跑一遍，
// 图片、按钮、题记都留在原处。
function TableStage({ table, section, resetLabel, bare, bar, marks, standing, namesMode, onNamesMode, folded, onFolded, choice, onChoice, openedAt, keepFocus }: TableProps) {
  const pane = useRef<HTMLElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const stillHost = useRef<HTMLDivElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const foot = useRef<HTMLDivElement>(null);
  const needle = useRef<SVGGElement>(null);
  const scaleBar = useRef<HTMLSpanElement>(null);
  const scaleLabel = useRef<HTMLSpanElement>(null);
  const noteButton = useRef<HTMLButtonElement>(null);
  const notePanel = useRef<HTMLDivElement>(null);
  const stateButton = useRef<HTMLButtonElement>(null);
  const debugLine = useRef<HTMLParagraphElement>(null);
  const noteId = useId();

  const tableSlot = useRef<Slot>(emptySlot());
  const stillSlot = useRef<Slot>(emptySlot());
  const names = useRef(namesMode);
  const foldedRef = useRef(folded);
  // 现在上面那一张画面是谁的（给每一帧都可能来的通知用，所以另记一份不经过重画的）。
  const topRef = useRef<Picture>('none');
  // 图片出来了没有（摆好的那一刻要当场知道）。
  const stillUpRef = useRef(false);
  // 放图片的那一层挂上了没有：立体的沙盘等它挂上（图片的下载先发出去）再去取沙盘程序。
  const stillStarted = useRef<Promise<void> | null>(null);
  // 嫌慢的那一座沙盘还留在原处：到时候用它关掉、换下一步。
  const endSlow = useRef<(() => void) | null>(null);
  const firstBuild = useRef(true);
  // 最近摆好的那一座，从开始摆到摆好用了几秒。
  const readySeconds = useRef<number | null>(null);

  // 这座沙盘的图片由谁来放（没有图片是 null），地址里指定的画质，要不要印读数：这一座沙盘从头到尾不变。
  const stillSource = useMemo(() => pickStillEngine(table), [table]);
  const urlTier = useMemo(() => pickTier(), []);
  const debug = useMemo(() => wantsReadout(), []);
  // 只放图片，不摆立体的沙盘（连沙盘程序也不去下载）。
  const picturesOnly = choice === 'pictures' || (choice === 'auto' && urlTier === 'still');
  const asked = choice === 'asked';

  // 第几次摆立体的沙盘：加一就重摆一遍。
  const [build, setBuild] = useState(0);
  const [phase, setPhase] = useState<Phase>(picturesOnly ? 'slow' : 'loading');
  // 立体的沙盘显出来了（摆好了，或者嫌慢、还留在原处等图片）。
  const [tableUp, setTableUp] = useState(false);
  // 立体的沙盘正盖着图片慢慢显出来。
  const [handing, setHanding] = useState(false);
  // 嫌慢的那一座还留在原处，不再给它指令。
  const [slowStays, setSlowStays] = useState(false);
  const [tier, setTier] = useState<StageTier | null>(null);
  // 立体的沙盘现在摆着哪一小节；null 表示还一次都没摆到位。图片那一层的是 stillShown。
  const [shown, setShown] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);
  // 这一次不放图片：这座沙盘没有图片，或者有一张取不到（取不到以后，这一座先当没有图片；读到另一小节、网又通了，再放一次，见下面）。
  const [stillsOff, setStillsOff] = useState(stillSource === null);
  const [stillUp, setStillUp] = useState(false);
  const [stillShown, setStillShown] = useState<string | null>(null);
  // 等了一阵还什么画面都没有。
  const [late, setLate] = useState(false);
  // 完整的说明是为哪一小节展开的；null 是没展开。沙盘旁边的字换了小节，它自然就不算展开了。
  const [noteFor, setNoteFor] = useState<string | null>(null);
  // 全程沙盘的镜头正往哪一站潜；null 是没在潜。
  const [diving, setDiving] = useState<string | null>(null);
  // 正在潜的时候沙盘不行了：马上放读者过去。
  const hurryDive = useRef<() => void>(() => {});
  // 读者是从全程沙盘潜到这一座的：头一张图片从底色里浮上来。
  const cameIn = useMemo(() => cameByDive(table.key), [table]);

  // 沙盘该摆哪一小节：读到的那一节。读到的小节场景里没有时（正文和场景的标题对不上）留在上一次认得的那一节；
  // 一节都还不认得，就是第一节。
  const headings = useMemo(() => headingsOf(table.scene), [table]);
  // 带着时间轴的栏上，读者动过时间轴以后，全程沙盘看哪一节听时间轴的（BAR_GOAL，见下面的 BarBand）；没动过，还是上面交下来的头一节。
  // 一站的页面上不听：那里看的总是到这一站去的那一节。
  const [barGoal, setBarGoal] = useState(BAR_GOAL[table.key]);
  const wanted = (bar && barGoal) || section;
  const onGoal = (heading: string): void => setBarGoal((BAR_GOAL[table.key] = heading));
  const known = wanted !== null && headings.includes(wanted) ? wanted : null;
  const [lastKnown, setLastKnown] = useState<string | null>(null);
  if (known !== null && known !== lastKnown) setLastKnown(known);
  const goal = known ?? lastKnown ?? headings[0] ?? null;
  const goalRef = useRef(goal);

  // 立体的沙盘摆不了了（不是正在摆，也不是摆好了）。
  const forGood = phase !== 'loading' && phase !== 'ready';
  // 这一栏里有没有放画面的那一块（连同它上面的那一排按钮）：正在摆、摆好了，或者有图片可放。
  const area = !forGood || !stillsOff;
  // 要不要图片那一层：有图片可放，而且立体的沙盘还没有稳稳地盖在上面。
  const stillWanted = !stillsOff && (!tableUp || handing || slowStays);
  // 上面那一张画面是谁的。
  const top: Picture = tableUp ? 'table' : stillUp ? 'still' : 'none';
  const picture: Picture = top === 'table' && handing ? 'still' : top;
  const onShow = top === 'table' ? shown : top === 'still' ? stillShown : null;

  // 四边各留出多少：上面是按钮（按钮下面有一行话时连它一起），下面是题记。量的是页面上现在的样子。
  const readInsets = useCallback((): StageInsets => {
    const box = pane.current?.getBoundingClientRect();
    if (!box) return NO_INSETS;
    const bar = controls.current?.getBoundingClientRect();
    const line = notice.current?.getBoundingClientRect();
    const base = foot.current?.getBoundingClientRect();
    const upper = line && line.height > 0 ? line.bottom : bar && bar.height > 0 ? bar.bottom : null;
    return {
      top: upper === null ? 0 : Math.max(0, Math.round(upper - box.top)),
      right: 0,
      bottom: base && base.height > 0 ? Math.max(0, Math.round(box.bottom - base.top)) : 0,
      left: 0,
    };
  }, []);

  const syncInsets = useCallback(() => {
    let next: StageInsets | null = null;
    for (const slot of [tableSlot.current, stillSlot.current]) {
      if (!slot.view) continue;
      next ??= readInsets();
      const sent = slot.insets;
      if (sent.top === next.top && sent.right === next.right && sent.bottom === next.bottom && sent.left === next.left) continue;
      slot.insets = next;
      slot.view.setInsets(next);
    }
  }, [readInsets]);

  // 栏有多宽，记在栏上：够宽挂 .is-wide，栏里面的宽度写成 --pane-w，宽的排法里题记的字号写成 --line-size。
  // 字号是（栏里面的宽度 − 21）÷ 40 往下取整，最小 14、最大 19 像素：整数的字号，40 个字在哪种系统上都是 40 × 字号那么宽
  //（Linux 上平常一个字只占整数个像素，14.95px 的字会排成 15px 一个，行尾就被截掉了）。
  // 这几样直接写在元素上，不经过重画（和指北、比例尺一样）。每次重画以后（类名会被重画冲掉）、窗口的大小变了以后都重写一遍，
  // 都赶在量留边、告诉画面之前：题记有多高、题签有多大，都跟着它变。
  const wide = useRef(false);
  const fitPane = useCallback(() => {
    const el = pane.current;
    if (!el) return;
    const inner = el.clientWidth;
    wide.current = el.offsetWidth >= WIDE_PANE_PX;
    el.classList.toggle('is-wide', wide.current);
    el.style.setProperty('--pane-w', `${inner}px`);
    el.style.setProperty('--line-size', `${Math.min(19, Math.max(14, Math.floor((inner - 21) / 40)))}px`);
  }, []);

  // 指北和比例尺：直接改元素。栏窄的时候比例尺换一段短的。
  const showViewInfo = useCallback((info: StageViewInfo) => {
    needle.current?.setAttribute('transform', `rotate(${info.northDeg.toFixed(1)})`);
    const scale = wide.current ? info.scale : fitScale(info.scale, NARROW_SCALE_PX);
    if (scaleBar.current) scaleBar.current.style.width = `${Math.round(scale.px)}px`;
    if (scaleLabel.current) scaleLabel.current.textContent = scale.label;
  }, []);

  /** 上面那一张画面最近报的指北和比例尺，再印一遍（元素刚出来、栏的宽窄变了、上面换了一张的时候）。 */
  const showTopInfo = useCallback(() => {
    const slot = topRef.current === 'table' ? tableSlot.current : topRef.current === 'still' ? stillSlot.current : null;
    if (slot?.info) showViewInfo(slot.info);
  }, [showViewInfo]);

  // 窄屏上收起了：画面不显出来，不用跟着读到的小节走（白画）；展开时再直接摆过去。
  const tuckedAway = useCallback(() => foldedRef.current && !window.matchMedia(WIDE_SCREEN).matches, []);

  // 让一层画面去 goalRef 指的那一小节。只有最新的一次指令完成了，才算“摆到了”。
  const follow = useCallback((which: 'table' | 'still', animate: boolean) => {
    const slot = which === 'table' ? tableSlot.current : stillSlot.current;
    const view = slot.view;
    const heading = goalRef.current;
    if (!view || heading === null) return;
    const turn = ++slot.turn;
    slot.requested = heading;
    if (which === 'table') setMoved(false);
    let done: Promise<void>;
    try {
      done = view.showSection(heading, { animate });
    } catch (error) {
      done = Promise.reject(error);
    }
    done.then(
      () => {
        if (turn !== slot.turn || slot.view !== view) return;
        slot.arrived = heading;
        if (which === 'table') setShown(heading);
        else setStillShown(heading);
      },
      (reason) => {
        if (turn === slot.turn && slot.view === view) console.warn('[沙盘] 镜头没能到这一小节：', reason);
      },
    );
  }, []);

  /** 挂着的两层里，哪一层还没让它去读到的那一小节，就让它去。 */
  const catchUp = useCallback(
    (animate: boolean) => {
      if (goalRef.current === null || tuckedAway()) return;
      if (tableSlot.current.view && tableSlot.current.requested !== goalRef.current) follow('table', animate);
      if (stillSlot.current.view && stillSlot.current.requested !== goalRef.current) follow('still', animate);
    },
    [follow, tuckedAway],
  );

  // 图片那一层：要它的时候挂上，不要的时候拿走。它排在“摆立体的沙盘”前面：图片的下载要先发出去。
  useEffect(() => {
    if (!stillWanted || !stillSource) {
      stillStarted.current = null;
      return;
    }
    let cancelled = false;
    let view: StopStageView | null = null;
    const unsubscribe: (() => void)[] = [];
    const slot = stillSlot.current;

    // 图片取不到（头一张，或者后来换到的哪一张）：这一座沙盘先当没有图片，这一栏照“没有图片”的样子办。
    const giveUpStills = (reason: unknown) => {
      if (cancelled) return;
      console.warn('[沙盘] 这一小节的图片取不到，这一次不放图片了：', reason);
      if (pane.current?.contains(document.activeElement)) keepFocus.current = true;
      slot.view = null;
      stillUpRef.current = false;
      setStillsOff(true);
    };

    stillStarted.current = stillSource()
      .then((engine) => {
        if (cancelled || !stillHost.current) return;
        const first = goalRef.current;
        if (first === null) throw new Error('场景里一个小节也没有');
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const insets = readInsets();
        const made = engine.create(stillHost.current, table, { namesMode: names.current, reducedMotion, section: first, insets, marks });
        view = made;
        Object.assign(slot, { view: made, requested: first, arrived: first, info: null, insets });

        unsubscribe.push(
          made.onViewChange((info) => {
            slot.info = info;
            if (topRef.current === 'still') showViewInfo(info);
          }),
        );
        unsubscribe.push(
          made.onLost(() => {
            if (view === made) giveUpStills('换到的那一张取不到');
          }),
        );
        made.ready.then(
          () => {
            if (cancelled || view !== made) return;
            stillUpRef.current = true;
            setStillShown(slot.arrived);
            setStillUp(true);
          },
          (reason) => {
            if (view === made) giveUpStills(reason);
          },
        );
      })
      .catch((reason) => giveUpStills(reason));

    return () => {
      cancelled = true;
      unsubscribe.splice(0).forEach((off) => off());
      if (view) {
        try {
          view.destroy();
        } catch {
          // 关不干净也不用管。
        }
      }
      if (slot.view === view) slot.view = null;
      view = null;
      stillHost.current?.replaceChildren();
      stillUpRef.current = false;
      setStillUp(false);
      setStillShown(null);
    };
  }, [table, marks, stillSource, stillWanted, readInsets, showViewInfo, keepFocus]);

  // 摆立体的沙盘。沙盘程序用到时才加载。build 加一、读者的选择变了，就把手上的这一座关掉，从头再来一遍。
  useEffect(() => {
    // 上一座留下的样子先清掉。
    setTableUp(false);
    setHanding(false);
    setSlowStays(false);
    setTier(null);
    setShown(null);
    setMoved(false);
    setLate(false);
    // 从哪一刻等起：头一回是从这一站的数据开始读的时候，以后（重摆、读者改了主意）都是从现在。
    const since = firstBuild.current && openedAt.current !== null ? openedAt.current : Date.now();
    firstBuild.current = false;
    // 那个钟点只给读了数据以后摆的头一座用一次：换一座数据早就读好的沙盘（从一站回到人物页），等是从现在数起的。
    openedAt.current = null;
    if (picturesOnly) {
      setPhase('slow');
      return;
    }
    setPhase('loading');

    let cancelled = false;
    let view: StopStageView | null = null;
    const unsubscribe: (() => void)[] = [];
    let fadeTimer = 0;
    const slot = tableSlot.current;

    const lineTimer = window.setTimeout(() => setLate(true), Math.max(0, LOADING_LINE_AFTER_MS - (Date.now() - since)));

    const close = () => {
      unsubscribe.splice(0).forEach((off) => off());
      if (!view) return;
      try {
        view.destroy();
      } catch {
        // 已经坏掉的沙盘，关不干净也不用管。
      }
      if (slot.view === view) slot.view = null;
      view = null;
      exposeReadout(null);
    };

    // 立体的沙盘从画面上拿走以后，这一栏里跟着它的几样都收掉。
    const tableGone = () => {
      window.clearTimeout(fadeTimer);
      endSlow.current = null;
      setHanding(false);
      setSlowStays(false);
      setTableUp(false);
      setTier(null);
      setShown(null);
      setMoved(false);
    };

    // 沙盘起不来、中途断了：关掉它，换成图片或者一句话。给读者的只有一句话，原因写在控制台里。
    const giveUp = (next: 'failed' | 'lost', reason: unknown) => {
      if (cancelled) return;
      console.warn(next === 'lost' ? '[沙盘] 画面断了：' : '[沙盘] 没能摆出来：', reason);
      // 焦点在栏里的按钮上，而这些按钮可能马上要没了：记下来，换完以后给焦点找个着落。
      if (pane.current?.contains(document.activeElement)) keepFocus.current = true;
      close();
      host.current?.replaceChildren();
      tableGone();
      setPhase(next);
    };

    const cannotDraw = (reason: string) => {
      console.warn('[沙盘] 这个浏览器画不出立体的沙盘：', reason);
      setPhase('unsupported');
    };

    // 这一座在这台设备上太慢。先留在原处（它自己不再画了），不再给它指令；等图片出来了，或者等够了，再关掉它：
    // 读者自己要来的那一座，换回图片；别的重摆一座（沙盘程序会给低一档的；连低一档也嫌慢，它会说 too-slow）。
    const tooSlow = () => {
      if (cancelled || !view) return;
      // 设备慢的时候本来就该这样走，不是出了错：只记一笔（console.info），不算警告
      console.info(asked ? '[沙盘] 立体的沙盘在这台设备上慢得没法用，换回图片。' : '[沙盘] 这一档画质在这台设备上太慢，降一档重摆。');
      unsubscribe.splice(0).forEach((off) => off());
      if (slot.view === view) slot.view = null;
      hurryDive.current();
      exposeReadout(null);
      window.clearTimeout(fadeTimer);
      setHanding(false);
      setMoved(false);
      setPhase('loading');
      endSlow.current = () => {
        endSlow.current = null;
        if (cancelled) return;
        close();
        host.current?.replaceChildren();
        if (asked) {
          // “回到这一节”要换成“试试立体的沙盘”了：焦点在栏里的话记下来。
          if (pane.current?.contains(document.activeElement)) keepFocus.current = true;
          onChoice('pictures');
        } else {
          setBuild((count) => count + 1);
        }
      };
      setSlowStays(true);
    };

    const start = async () => {
      // 放图片的那一层先挂上，再往下走。
      if (stillStarted.current) await stillStarted.current;
      if (cancelled) return;
      // 下载沙盘程序之前先问：这个浏览器画得了吗。画不了就不下载。
      if (!canDrawStage()) {
        cannotDraw('no-webgl2');
        return;
      }
      const engine = await pickStageEngine();
      if (cancelled || !host.current) return;
      // 读者自己要的是减配的一档；地址里指定了哪一档就是哪一档；都没有，由沙盘程序自己挑。
      const wanted: StageTier | undefined = asked ? 'reduced' : urlTier === 'full' || urlTier === 'reduced' ? urlTier : undefined;
      const support = engine.support();
      // “这台设备带不动”是沙盘程序替自己挑画质时的话；指定了画质的（读者要的、地址里写的）照样摆。
      if (!support.ok && !(support.reason === 'too-slow' && wanted !== undefined)) {
        if (support.reason === 'too-slow') {
          console.info('[沙盘] 立体的沙盘在这台设备上太慢，这一次访问只放图片。');
          if (pane.current?.contains(document.activeElement)) keepFocus.current = true;
          onChoice('pictures');
        } else {
          cannotDraw(support.reason);
        }
        return;
      }
      const first = goalRef.current;
      if (first === null) throw new Error('场景里一个小节也没有');

      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const insets = readInsets();
      // 第一节由 create 直接摆到位（不滑）；之后读到别的小节再用 showSection。
      const made = engine.create(host.current, table, {
        namesMode: names.current,
        reducedMotion,
        section: first,
        insets,
        marks,
        tier: wanted,
        ...(asked ? { asked: true } : {}),
      });
      view = made;
      Object.assign(slot, { view: made, requested: first, arrived: first, info: null, insets });
      if (debug) exposeReadout(() => made.readout());

      unsubscribe.push(made.onUserMoved((value) => setMoved(value)));
      unsubscribe.push(
        made.onViewChange((info) => {
          slot.info = info;
          if (topRef.current === 'table') showViewInfo(info);
        }),
      );
      unsubscribe.push(
        made.onLost(() => {
          if (view === made) giveUp('lost', '三维画面丢了');
        }),
      );
      unsubscribe.push(
        made.onSlow(() => {
          if (view === made) tooSlow();
        }),
      );
      made.ready.then(
        () => {
          if (cancelled || view !== made || slot.view !== made) return;
          readySeconds.current = (Date.now() - since) / 1000;
          setPhase('ready');
          // 摆好的第一个画面是沙盘已经摆到的那一节：create 时要的那一节，或者摆好之前就完成了的 showSection 要的那一节。
          // 这时候还有一次 showSection 在路上的话，等它完成了才换（见 follow），不抢在沙盘前头。
          setShown(slot.arrived);
          setTier(tierOf(made));
          setTableUp(true);
          // 图片已经在了：立体的沙盘盖着它慢慢显出来，显完才把图片拿走。没有图片、或者系统说要少动，直接换。
          if (stillUpRef.current && !reducedMotion) {
            setHanding(true);
            fadeTimer = window.setTimeout(() => setHanding(false), HANDOVER_FADE_MS);
          }
        },
        (reason) => {
          if (view === made) giveUp('failed', reason);
        },
      );
    };
    start().catch((reason) => giveUp('failed', reason));

    return () => {
      cancelled = true;
      window.clearTimeout(lineTimer);
      window.clearTimeout(fadeTimer);
      endSlow.current = null;
      close();
    };
  }, [table, marks, build, picturesOnly, asked, urlTier, debug, openedAt, onChoice, readInsets, showViewInfo, keepFocus]);

  // 嫌慢的那一座留在原处，等图片：图片出来了（或者这一次不放图片），或者等够了，就关掉它。
  useEffect(() => {
    if (!slowStays) return;
    if (stillUp || stillsOff) {
      endSlow.current?.();
      return;
    }
    const timer = window.setTimeout(() => endSlow.current?.(), STILL_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [slowStays, stillUp, stillsOff]);

  // 栏里的东西换过以后，给焦点找个着落：这一种状态有按钮就放到按钮上，没有就放到这一栏上（见 restoreFocus）。
  // 只在栏里的东西真的换了的那一次重画以后做（状态变了、放画面的那一块有了或没了、图片不放了）：
  // 读者刚按下按钮、东西还没换的那一次不做，不然“焦点原来在栏里”这一笔就白记了。
  useEffect(() => {
    restoreFocus(keepFocus, stateButton.current ?? pane.current);
  }, [keepFocus, phase, area, stillsOff]);

  // 读到另一小节时，画面跟过去。
  useEffect(() => {
    goalRef.current = goal;
    catchUp(true);
  }, [goal, catchUp]);

  // 从全程沙盘到一站自己的沙盘：先潜下去，再换页。只有全程沙盘听；哪一下算数、先后怎么排，都在 ./dive.ts。
  useEffect(() => {
    if (table.kind !== 'route') return;
    const figureId = table.key.split('/')[0];
    const watch = watchDives(figureId, {
      pane: () => ({
        ready: topRef.current === 'table' && !!tableSlot.current.view?.dive,
        tucked: tuckedAway(),
        calm: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        on: divesHere(),
      }),
      own: (stop) => marks?.[stop]?.own === true,
      dive: (stop, ms) => tableSlot.current.view?.dive?.(stop, ms) ?? null,
      mark: setDiving,
      preload: (stop) => preloadStop(figureId, stop, pane.current ? getComputedStyle(pane.current).getPropertyValue('--stage-shape').trim() : ''),
      back: () => follow('table', true),
    });
    hurryDive.current = watch.hurry;
    return watch.end;
  }, [table, marks, tuckedAway, follow]);

  // 有一张图片取不到，这一栏就先当没有图片（见 giveUpStills）。那多半是网断了一下，不该从此一张图片也不放：
  // 读者读到另一小节的时候，或者浏览器说网又通了，再放一次；还是取不到，照旧收起来，等下一回。浏览器明说断着网的时候不试。
  useEffect(() => {
    if (!stillSource) return;
    const again = () => window.navigator?.onLine !== false && setStillsOff(false);
    again();
    window.addEventListener('online', again);
    return () => window.removeEventListener('online', again);
  }, [goal, stillSource]);

  // 沙盘栏收起、展开了：大小变了，告诉画面。展开时，收起的那一阵读到了别的小节，直接摆过去（不滑）。
  useEffect(() => {
    foldedRef.current = folded;
    const views = [tableSlot.current.view, stillSlot.current.view].filter((view) => view !== null);
    if (views.length === 0) return;
    views.forEach((view) => view.resize());
    catchUp(false);
  }, [folded, catchUp]);

  useEffect(() => {
    let frame = 0;
    const el = pane.current;
    // 上一回是照多宽排的（连边线）
    let seen = el?.offsetWidth;
    const onResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        seen = el?.offsetWidth;
        fitPane();
        tableSlot.current.view?.resize();
        stillSlot.current.view?.resize();
        syncInsets();
        // 栏的宽窄变了，比例尺要不要换一段短的也跟着变。
        showTopInfo();
        // 收起以后把窗口拉宽（平板横过来），画面又显出来了：摆到读到的那一节。
        catchUp(false);
      });
    };
    window.addEventListener('resize', onResize);
    // 窗口没变、栏自己变宽变窄了（页面长出或者收掉了滚动条）：也照新的宽度重排一遍。
    // 只看宽：高变了（收起、展开、多一行话）各有各的地方管；刚开始看的那一下、宽度没变的，什么也不做。
    const watcher = el && typeof ResizeObserver === 'function' ? new ResizeObserver(() => el.offsetWidth !== seen && onResize()) : null;
    if (el) watcher?.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      watcher?.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [fitPane, syncInsets, showTopInfo, catchUp]);

  // 每次重画以后把栏的宽窄重写一遍（要排在量留边的前面）。
  useLayoutEffect(fitPane);

  // 每次重画以后量一遍留边：沙盘栏收起或展开了、按钮下面多了或少了一行话，上下留出来的地方都会变。
  // （题记那一块的高度是定死的，换小节不会让它变。）
  useLayoutEffect(() => {
    syncInsets();
  });

  // 指北和比例尺的元素是有了画面才有的，上面那一张也会换：把那一张最近报的补上。
  useLayoutEffect(() => {
    topRef.current = top;
    showTopInfo();
  }, [top, showTopInfo]);

  // ?debug=1：在栏里印一行画质和快慢的读数。直接改元素，不让整栏重画（重画不该惊动沙盘）。
  useEffect(() => {
    if (!debug || !tableUp) return;
    const write = () => {
      const view = tableSlot.current.view;
      if (!view || !debugLine.current) return;
      debugLine.current.textContent = stageDebugLine(perfOf(view), readySeconds.current);
    };
    write();
    const timer = window.setInterval(write, DEBUG_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [debug, tableUp]);

  const chooseNames = (mode: NamesMode) => {
    names.current = mode;
    onNamesMode(mode);
    tableSlot.current.view?.setNamesMode(mode);
    stillSlot.current.view?.setNamesMode(mode);
  };

  const canReset = phase === 'ready' && moved;
  const resetView = () => {
    if (canReset) tableSlot.current.view?.resetView().catch(() => {});
  };

  // 几个会把自己换掉的按钮：先记下焦点原来在栏里。
  const rebuild = () => {
    keepFocus.current = true;
    setBuild((count) => count + 1);
  };
  const tryTable = () => {
    keepFocus.current = true;
    onChoice('asked');
  };
  const backToStills = () => {
    keepFocus.current = true;
    onChoice('pictures');
  };

  // 沙盘旁边的字：有画面的时候说的是上面那一张画面摆着的那一节；没有画面时说的是读到的那一节。
  const captionFor = top === 'none' ? goal : (onShow ?? goal);
  const info = useMemo(() => (captionFor === null ? null : infoOf(table.scene, captionFor)), [table, captionFor]);

  // 完整的说明：点“说明”展开，再点一下、按 Esc、点“关闭”、换了小节，都收起来。
  const noteOpen = info !== null && noteFor !== null && noteFor === captionFor;
  const toggleNote = () => setNoteFor(noteOpen ? null : captionFor);
  const closeNote = useCallback(() => {
    // 焦点在展开的那一块里（它马上没了）：还给“说明”按钮。
    if (notePanel.current?.contains(document.activeElement)) noteButton.current?.focus({ preventScroll: true });
    setNoteFor(null);
  }, []);
  useEffect(() => {
    if (!noteOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeNote();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [noteOpen, closeNote]);

  // 立体的沙盘摆不了时的那一句话和它的按钮。有图片可放时是按钮下面的一行（按钮在那一排按钮中间）；没有图片时是一句话带一个按钮。
  const stateAction =
    phase === 'slow'
      ? { label: STAGE_TEXT.tryTable, run: tryTable }
      : phase === 'lost'
        ? { label: STAGE_TEXT.rebuild, run: rebuild }
        : phase === 'failed'
          ? { label: STAGE_TEXT.retry, run: rebuild }
          : null;
  const wordsAlone = phase === 'unsupported' ? STAGE_TEXT.unsupported : phase === 'slow' ? STAGE_TEXT.slow : phase === 'lost' ? STAGE_TEXT.lost : STAGE_TEXT.failed;
  const withStills =
    phase === 'unsupported'
      ? STAGE_TEXT.stillUnsupported
      : phase === 'slow'
        ? urlTier === 'still'
          ? STAGE_TEXT.stillOnly
          : STAGE_TEXT.stillSlow
        : phase === 'lost'
          ? STAGE_TEXT.stillLost
          : STAGE_TEXT.stillFailed;
  // 读者要来的那一座沙盘：从他点了按钮起就印着“可以换回图片”，这样摆好的前后上面留的空一样，画面不跳。
  const stateLine = stillsOff ? null : forGood ? withStills : asked ? STAGE_TEXT.askedLine : null;
  const line = stateLine ?? standing;

  const legend =
    top !== 'none' ? (
      <div className="stage-legend">
        <div className="stage-scale">
          <span className="stage-scale-label" ref={scaleLabel} />
          <span className="stage-scale-bar" ref={scaleBar} />
        </div>
        <div className="stage-north">
          <span>{STAGE_TEXT.north}</span>
          {/* 针只有一个头：朝北的一头是实心的箭头，另一头是一根直线。两头都画成箭头的话，20 来个像素大的时候分不出哪一头是北。 */}
          <svg viewBox="-23 -23 46 46" aria-hidden="true">
            <circle r="20" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.55" />
            <g ref={needle}>
              <path className="stage-north-tip" d="M0 -18 L6 3 L0 -1 L-6 3 Z" />
              <path d="M0 2V17" stroke="currentColor" strokeWidth="2.5" />
            </g>
          </svg>
        </div>
      </div>
    ) : null;

  // 有画面的时候这一栏钉在顶上。画面断了、又没有图片可放的时候，它也留在原处、还是原来那么高
  // （窄屏上读者多半正读到半截，栏一缩，那句话和按钮就滚到看不见的地方去了）。
  // 没有放画面的那一块的时候没有“收起”按钮，所以也不算收起。
  return (
    <Pane
      state={phase}
      picture={picture}
      tier={tableUp ? tier : null}
      section={onShow ?? undefined}
      route={table.kind === 'route'}
      bar={bar}
      dive={diving}
      pinned={area || phase === 'lost'}
      folded={area && folded}
      paneRef={pane}
    >
      {area && (
        <div className={handing ? 'stage-canvas is-handing-over' : 'stage-canvas'}>
          <div ref={stillHost} className={cameIn ? (stillUp ? 'stage-still-host is-arriving' : 'stage-still-host is-coming') : 'stage-still-host'} />
          <div ref={host} className={tableUp ? 'stage-host is-up' : 'stage-host'} />
        </div>
      )}

      {area && (
        <div className="stage-controls" ref={controls}>
          <div className="names-switch" role="group" aria-label={STAGE_TEXT.namesGroup}>
            <button type="button" aria-pressed={namesMode === 'ancient'} onClick={() => chooseNames('ancient')}>
              {STAGE_TEXT.ancient}
            </button>
            <button type="button" aria-pressed={namesMode === 'modern'} onClick={() => chooseNames('modern')}>
              {STAGE_TEXT.modern}
            </button>
          </div>
          {/* 中间的一个按钮：摆着（或者正在摆）立体的沙盘时是“回到这一节”（全程沙盘上是“回到全程”“回到这一段”）；摆不了、放着图片时，换成这一种状态的按钮。
              两个按钮各有各的 key：换的时候是真的换了一个元素，焦点不会留在一个意思已经变了的按钮上。 */}
          {!forGood && (
            // 点不了的时候用 aria-disabled，不用 disabled：点完它就变成点不了的，用 disabled 的话焦点会掉到页面外头去。
            <button key="reset" type="button" className="stage-button stage-reset" aria-disabled={!canReset} onClick={resetView}>
              {/* 时间轴把全程沙盘带到了别的一节：这个按钮回的是那一节，不是全程 */}
              {wanted === section ? resetLabel : STAGE_TEXT.resetRoad}
            </button>
          )}
          {forGood && stateAction && (
            <button key="state" type="button" ref={stateButton} className="stage-button stage-retry" onClick={stateAction.run}>
              {stateAction.label}
            </button>
          )}
          <button type="button" className="stage-button stage-fold" aria-expanded={!folded} onClick={() => onFolded(!folded)}>
            {folded ? STAGE_TEXT.unfold : STAGE_TEXT.fold}
          </button>
        </div>
      )}

      {/* 几句话排在那一排按钮后面：按钮下面的那一行话（和句尾的“换回图片”）在屏幕上就在按钮下面，
          用键盘一个一个走的先后、读屏软件念的先后，和看到的上下一致。 */}
      <Says>
        {phase === 'loading' && late && top === 'none' && <p className="stage-loading">{STAGE_TEXT.loading}</p>}
        {area && line !== null && (
          <div className="stage-notice" ref={notice}>
            <p>{line}</p>
            {stateLine !== null && !forGood && (
              <button type="button" className="stage-notice-button" onClick={backToStills}>
                {STAGE_TEXT.backToStills}
              </button>
            )}
          </div>
        )}
        {!area && <Message text={say(wordsAlone, bare)} action={stateAction?.label} onAction={stateAction?.run} keepFocus={keepFocus} />}
      </Says>

      {/* under-notice：按钮下面有一行话。展开的说明照它再矮一行（stage.css）。 */}
      <div className={area && line !== null ? 'stage-foot under-notice' : 'stage-foot'} ref={foot}>
        {/* 时间轴：人物页和首页才有（摆的是全程沙盘），在题记上面。这一条的高是定死的（stage.css），它里面的东西到没到，沙盘四边留的空都一样。 */}
        {bar && table.kind === 'route' && <BarBand table={table} marks={marks} slot={tableSlot} onGoal={onGoal} />}
        {info ? (
          <SectionCaption info={info} legend={legend} noteOpen={noteOpen} onToggleNote={toggleNote} noteId={noteId} noteButton={noteButton} />
        ) : (
          legend
        )}
        {info && noteOpen && <NotePanel info={info} id={noteId} onClose={closeNote} panelRef={notePanel} />}
        {debug && tableUp && <p className="stage-debug" ref={debugLine} />}
      </div>
    </Pane>
  );
}

// ---------------------------------------------------------------- 时间轴的那一条

/** 时间轴里面的东西是另一段程序（src/timebar/），栏里摆上全程沙盘才去取。这一句动态 import 要写在页面自己的文件里（缘故见 src/stage/index.ts）。 */
const loadBar = () => import('../timebar/TimeBar');

/**
 * 这一次访问里，时间轴让全程沙盘看哪一节：键是沙盘的 key，值是小节标题；读者还没动过时间轴的那一座没有。
 * 记在组件外面：进了一站自己的沙盘再回来，这一栏是从头摆的，头一个画面就该是时间轴停着的那一节，不先摆全程再滑过去。
 */
const BAR_GOAL: Record<string, string> = {};

/**
 * 全程沙盘下面、题记上面的一条：时间轴。这里只管留出地方、去取那一段程序；没取到说一句话。
 * 要不要摆（地址里的 ?bar=）由那一段程序自己看：不摆的时候它什么也不画，这一条空着，地方照样留着。
 */
function BarBand(props: BarProps) {
  const [bar, ask] = useOnDemand(loadBar);
  // 摆上了才取，只取一次（没取到的，这一栏下一回摆上时再取）
  useEffect(ask, []);
  return <div className="stage-bar">{bar && (bar.state === 'ready' ? <bar.value.TimeBar {...props} /> : bar.state === 'error' && <Waiting failed bar />)}</div>;
}

// ---------------------------------------------------------------- 小工具

// 从场景数据取字的地方都兜住错误：这些字出不来，正文也要照常读。

function headingsOf(scene: TableScene): string[] {
  try {
    return sectionHeadings(scene);
  } catch (error) {
    console.warn('[沙盘] 没能读出场景的小节：', error);
    return [];
  }
}

function infoOf(scene: TableScene, heading: string): SectionInfo | null {
  try {
    return sectionInfo(scene, heading);
  } catch (error) {
    console.warn('[沙盘] 没能生成沙盘旁边的说明：', error);
    return null;
  }
}

/** 这座沙盘的画质和快慢的读数；它不给（沙盘的替身）、或者读不出来，是 undefined。 */
function perfOf(view: StopStageView): StageReadout['perf'] {
  try {
    return view.readout().perf;
  } catch {
    return undefined;
  }
}

function tierOf(view: StopStageView): StageTier | null {
  return perfOf(view)?.tier ?? null;
}

/** 地址里带 ?debug=1 时，把沙盘的读数挂在 window.__stageReadout 上；沙盘关掉时拿走。 */
function exposeReadout(read: (() => StageReadout) | null): void {
  const target = window as Window & { __stageReadout?: () => StageReadout };
  if (read) target.__stageReadout = read;
  else delete target.__stageReadout;
}

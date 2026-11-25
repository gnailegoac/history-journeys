// 时间轴：全程沙盘下面、题记上面的那一条（.stage-bar，地方是沙盘栏留的）里面的东西。
// 这是摆上全程沙盘才下载的一段程序（src/ui/StagePane.tsx 里的那一句动态 import）。这个文件夹里的文件：
//   只从 react 直接引钩子，不引 src/app/、src/ui/ 里的东西（引了，打包的工具会把 React 的核心从页面的程序里单拆出去）；
//   自己不写动态 import；颜色和字号都在 src/styles/timebar.css，这里只算位置。
//
// 照行迹（./barData.ts）画出第一行（哪一年、虚岁多少、在哪）、第二行（这一段知道些什么）和那一条轴；圆钮停在一个日子上，
// 沙盘上的小像站到那一天他在的地方。读者拖圆钮、按在轴上、用键盘走、按“播放”，圆钮跟着走，两行字和小像马上跟着换；
// 日子记在 ./barStore.ts 的那一份里（读者还没动过时间轴的时候，地址里 ?bar= 给了哪一天就从那一天起；动过以后、和没给的时候，
// 从记着的那一天起，头一回是出生的那一天）；怎么走、什么时候叫沙盘栏换小节，在 ./barState.ts。
//
// 页面打开以后什么都不自己动：“播放”要读者按了才走，从不自己开始。播放的时候读者一碰别的就停——按在沙盘上、在沙盘上滚轮、
// 点栏里的哪一个按钮或者链接、在栏里按键、网页转到后台、栏收起来、沙盘的画面断了、镜头往一站潜下去——停了不自己再播。
// 播放到另一站讲的年月里，给读屏报一句是哪一年、在哪（开始和停下的时候也各报一句）。
// 系统设了“减少动态效果”：没有“播放”，轴的两头是“上一段”“下一段”，一下一段。
//
// 它不同沙盘说镜头的事，只向沙盘栏报“该看哪一节”（onGoal），再看沙盘栏写在自己身上的东西（data-stage-state、data-stage-section、
// data-stage-picture、data-stage-dive）。小像经 slot.current.view?.placePiece?.() 摆到沙盘上：
//   沙盘摆好了（data-stage-state 是 ready）、这一条有地方（没有收起来、样式表没有把它拿掉），小像摆到这一天的地方；
//   时间轴停着的时候（没有在拖、没有在连着按键、没有在播放）一并告诉沙盘“停着”：他在路上，题签也让开他；
//   这一条没有地方（没有时间轴的时候，沙盘上只摆一个小像，说不出是哪一天的），或者这一天沙盘上没有他：拿走。
// 这一条有没有地方、多宽，是看着量的（ResizeObserver：栏收起、展开，页面长出滚动条，都不发“窗口变了大小”）；
// 浏览器没有 ResizeObserver 的，窗口变了大小的时候量。
// 放着图片的时候 view 是 null（图片上不画小像，两行字说他在哪；最前一个位置的第二行和“图例”里各有一句明说图片上没有小像）；
// 一站的页面上没有这一条。镜头正往一站潜的时候这一条不接手指和按键。
// 右头的“图例”点开是 ./BarNote.tsx 的那一块（同题记的“说明”一次只开一个）；走到一站讲的那几年里，它旁边是进这一站的入口。

import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { ItineraryBar } from '../domain/itinerary';
import type { BarProps, PiecePlace, StopStageView } from '../stage/types';
import { BarNote } from './BarNote';
import { barFor } from './barData';
import { barTicks, discAt, groupSpans, labelledTicks, squeezed, THIN_BLOCK_PX, unitsAt } from './barScale';
import type { BarBlock } from './barScale';
import { BAR_KEYS, barControl } from './barState';
import type { BarControl, BarKey, PaneReport } from './barState';
import { barStore } from './barStore';
import { BAR_TEXT } from './barText';
import { stretchIndexAt, whereAt } from './barWhere';
import { barFit, barSwitch, wordsAt } from './barWords';

/** 轴那一行里从上往下（像素）：格子和路从 23 到 34，一站讲的那几年的那道线在 21.5，刻度从 34 到 37。 */
const BLOCK_TOP = 23;
const BLOCK_BOTTOM = 34;
const ROAD_Y = 28.5;
const SPAN_Y = 21.5;
const TICK_BOTTOM = 37;

/** 播放的时候，栏里出了这几样事就停（在栏上先听：capture）。 */
const STOPPERS = ['pointerdown', 'wheel', 'click', 'keydown'] as const;
/** 这几个键只是挪焦点、配着别的键用，不算“碰了”。 */
const QUIET_KEYS: readonly string[] = ['Tab', 'Shift', 'Control', 'Alt', 'Meta'];

export function TimeBar({ table, marks, slot, onGoal }: BarProps) {
  const bar = barFor(table.key);
  // 地址里的开关只在这一条摆上的时候读一次
  const [asked] = useState(() => barSwitch(window.location.search));
  if (!bar || !asked.on) return null;
  return <Bar bar={bar} table={table} start={asked.day} marks={marks} slot={slot} onGoal={onGoal} />;
}

interface Props {
  bar: ItineraryBar;
  table: BarProps['table'];
  /** 地址里指定从第几天起；没有指定是 null（从记着的那一天起）。 */
  start: number | null;
  marks: BarProps['marks'];
  slot: BarProps['slot'];
  onGoal: BarProps['onGoal'];
}

function Bar({ bar, table, start, marks, slot, onGoal }: Props) {
  const root = useRef<HTMLDivElement>(null);
  /** 轴画出来的那一截（.bar-axis）：比能按的那一条（.bar-track）两头各短半个圆钮，圆钮到了头也整个在这一条里面。 */
  const axis = useRef<HTMLDivElement>(null);
  /** 量到的两个宽：这一条里面多宽（定摆哪几样），轴多宽（定每一格画在哪）。这一条没有地方的时候是 null。 */
  const [box, setBox] = useState<{ inner: number; track: number } | null>(null);
  /** 上一回把小像摆在了哪座沙盘的哪里（写成字比较；'null' 是没有摆）：没变就不再叫沙盘。刚摆出来的沙盘上本来就没有小像。 */
  const placed = useRef<{ view: StopStageView | null; where: string }>({ view: null, where: 'null' });
  /** 沙盘栏交来的“该看哪一节”（每一回重画都可能是新的一个函数：记最新的）。 */
  const goal = useRef(onGoal);
  goal.current = onGoal;
  /** 轴跟着的是哪一根手指（按下去的那一根的号）；没有按着是 null。别的手指的动、抬、取消都不管。 */
  const pointer = useRef<number | null>(null);
  /** 沙盘栏写在自己身上的两样：放着的是不是图片（图片上不画小像）；镜头是不是正往一站潜。 */
  const [paneLook, setPaneLook] = useState({ pictures: false, diving: false });
  /** “图例”点开了没有。 */
  const [noteOpen, setNoteOpen] = useState(false);
  const noteButton = useRef<HTMLButtonElement>(null);
  const notePanel = useRef<HTMLDivElement>(null);
  const noteId = useId();
  /** 给读屏报的那一句（播放的时候才写）。 */
  const [said, setSaid] = useState('');
  const spoke = useRef<{ playing: boolean; group: string | undefined }>({ playing: false, group: undefined });

  // 系统设没设“减少动态效果”：这一条摆上的时候看一次
  const [calm] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  // 记着日子的那一份，和接着它的那一套走法：这一条摆上的时候各造一回。读者还没动过时间轴、地址里又指定了哪一天，就从那一天起（这不算读者动过）
  const [control] = useState((): BarControl => {
    const store = barStore(table.key);
    const pane = (): Element | null => root.current?.closest('.stage-pane') ?? null;
    const made = barControl(bar, table.scene.sections, store, {
      now: () => performance.now(),
      frame: (run) => requestAnimationFrame(run),
      cancelFrame: (id) => cancelAnimationFrame(id),
      later: (run, ms) => window.setTimeout(run, ms),
      cancelLater: (id) => window.clearTimeout(id),
      calm,
      pane: (): PaneReport => {
        const el = pane();
        const reset = el?.querySelector('.stage-reset');
        return {
          section: el?.getAttribute('data-stage-section') ?? null,
          figure: el?.getAttribute('data-stage-state') === 'ready' && el.getAttribute('data-stage-picture') === 'table',
          moved: !!reset && reset.getAttribute('aria-disabled') !== 'true',
        };
      },
      goal: (heading) => goal.current?.(heading),
      reset: () => pane()?.querySelector<HTMLElement>('.stage-reset')?.click(),
    });
    if (start !== null && !store.get().used) store.set({ day: Math.min(start, made.scale.lastDay), rest: true });
    return made;
  });
  const store = barStore(table.key);
  const now = useSyncExternalStore(store.subscribe, store.get);
  useEffect(() => () => control.dispose(), [control]);

  const scale = control.scale;
  const at = Math.min(Math.max(now.day, 0), scale.lastDay);
  const words = wordsAt(bar, at, paneLook.pictures);
  const stretch = bar.stretches[stretchIndexAt(bar, at)];

  // 看着这一条（.stage-bar）量：它没有地方的时候两个宽都是 0。栏收起、展开，页面长出滚动条，这一条的大小变了都量一遍。
  useLayoutEffect(() => {
    const band = root.current?.parentElement;
    const measure = (): void => {
      const inner = band ? band.clientWidth : 0;
      const wide = axis.current ? axis.current.clientWidth : 0;
      setBox((was) => (inner > 0 && wide > 0 ? (was && was.inner === inner && was.track === wide ? was : { inner, track: wide }) : null));
    };
    measure();
    const watcher = band && typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (band) watcher?.observe(band);
    window.addEventListener('resize', measure);
    return () => {
      watcher?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  // 每一回沙盘栏重画以后看一眼（这一条是沙盘栏的孩子，沙盘栏重画它也重画）：播放等着的那一节摆好了没有；放着的是不是图片、
  // 镜头是不是正往一站潜；题记的“说明”是不是开了；小像该不该在沙盘上、该在哪。
  useEffect(() => {
    control.paneChanged();
    const pane = root.current?.closest('.stage-pane') ?? null;
    const state = pane?.getAttribute('data-stage-state');
    const pictures = pane?.getAttribute('data-stage-picture') === 'still';
    const diving = (pane?.getAttribute('data-stage-dive') ?? null) !== null;
    if (pictures !== paneLook.pictures || diving !== paneLook.diving) setPaneLook({ pictures, diving });
    // 沙盘的画面断了、镜头潜下去了、这一条没了地方（栏收起来了）：播放停下
    if (now.playing && (state === 'lost' || diving || !box)) control.stop();
    // 题记的“说明”点开了：这一块收起（两块一次只开一个）
    if (noteOpen && pane?.querySelector('.stage-note-button')?.getAttribute('aria-expanded') === 'true') setNoteOpen(false);

    const view = slot.current.view;
    const where: PiecePlace | null = box && state === 'ready' ? whereAt(bar, at) : null;
    // 在路上的，停着和走着是两回事（停着题签让开他）：连它一起比
    const rest = where?.on === 'road' && now.rest;
    const key = `${JSON.stringify(where)}${rest ? '!' : ''}`;
    // 换了一座沙盘（再试一次、降了一档、重新摆出来）：新的那一座上还什么都没有摆
    if (placed.current.view !== view) placed.current = { view, where: 'null' };
    if (placed.current.where === key) return;
    placed.current.where = key;
    view?.placePiece?.(where, now.rest);
  });
  // 这一条拿走的时候（换了一页、沙盘栏换成了一站自己的沙盘）把小像也拿走
  useEffect(
    () => () => {
      if (placed.current.where !== 'null') placed.current.view?.placePiece?.(null);
      placed.current = { view: null, where: 'null' };
    },
    [],
  );

  // 播放的时候读者一碰别的就停：栏里（沙盘、按钮、题签上的印、题记）按下去、滚轮、点、按键，都先在栏上听到。
  // “播放”“暂停”自己和轴不在这里管（它们各有各的规矩）。网页转到后台也停。
  useEffect(() => {
    const pane = root.current?.closest('.stage-pane');
    const stop = (event: Event): void => {
      const target = event.target as Element | null;
      if (typeof target?.closest === 'function' && target.closest('.bar-play, .bar-track')) return;
      if (event.type === 'keydown' && QUIET_KEYS.includes((event as KeyboardEvent).key)) return;
      control.stop();
    };
    const hidden = (): void => {
      if (document.hidden) control.stop();
    };
    // passive：这几样只是听，从不拦；不这样写的话，在栏上滚轮翻页要先等页面的程序腾出手来
    for (const type of STOPPERS) pane?.addEventListener(type, stop, { capture: true, passive: true });
    document.addEventListener('visibilitychange', hidden);
    return () => {
      for (const type of STOPPERS) pane?.removeEventListener(type, stop, true);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [control]);

  // 给读屏报的那一句：开始播放、停下的时候各报一句，播放到另一站讲的年月里（或者走出了各站的年月）报一句；不播放的时候不写
  //（拖和按键的时候，读屏念的是轴自己的 aria-valuetext）。
  useEffect(() => {
    const was = spoke.current;
    if (now.playing !== was.playing || (now.playing && stretch.group !== was.group)) setSaid(`${words.year}，${words.label}`);
    spoke.current = { playing: now.playing, group: stretch.group };
  });

  // “图例”：点开、收起。点开的时候题记的“说明”要是开着，先替读者把它按掉。按 Esc、点“关闭”收起；焦点在那一块里的，还给“图例”按钮。
  const closeNote = (): void => {
    if (notePanel.current?.contains(document.activeElement)) noteButton.current?.focus({ preventScroll: true });
    setNoteOpen(false);
  };
  const toggleNote = (): void => {
    if (noteOpen) return closeNote();
    const other = root.current?.closest('.stage-pane')?.querySelector<HTMLElement>('.stage-note-button');
    if (other?.getAttribute('aria-expanded') === 'true') other.click();
    setNoteOpen(true);
  };
  useEffect(() => {
    if (!noteOpen) return;
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeNote();
    };
    document.addEventListener('keydown', onEscape);
    return () => document.removeEventListener('keydown', onEscape);
  }, [noteOpen]);

  const fit = barFit(box?.inner ?? 0);
  // 首页上（地址里“#/”后面是空的）栏够宽的时候，第一行最前面是人物的名字
  const onHome = window.location.hash.replace(/^#\/?/, '') === '';
  const mark = stretch.group ? marks?.[stretch.group] : undefined;
  const px = box ? box.track / scale.total : 0;
  const ticks = barTicks(bar, scale);

  /** 手指（鼠标）在轴上的哪一个单位（照画出来的那一截量；出了两头的算两头）。 */
  const unitsUnder = (event: ReactPointerEvent<HTMLDivElement>): number => {
    const rect = axis.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? ((event.clientX - rect.left) / rect.width) * scale.total : 0;
  };
  // 按下去就抓住这根手指：拖出了轴、拖到了沙盘上，圆钮还跟着它走，沙盘不转。已经跟着一根手指的时候，第二根不管
  const onDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if ((event.pointerType === 'mouse' && event.button !== 0) || pointer.current !== null) return;
    pointer.current = event.pointerId;
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // 抓不住这根手指（浏览器不认这个号）：照样跟着它走，只是拖出了轴就跟不上了
    }
    control.press(unitsUnder(event));
  };
  const onMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerId === pointer.current) control.drag(unitsUnder(event));
  };
  const onUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.pointerId !== pointer.current) return;
    pointer.current = null;
    control.release();
  };
  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!BAR_KEYS.includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    control.key(event.key as BarKey);
  };

  return (
    <div
      className={`bar${fit.roomy ? ' is-roomy' : ''}${calm ? ' is-calm' : ''}`}
      data-bar-look={stretch.look}
      data-bar-stop={stretch.group}
      ref={root}
      // 镜头正往一站潜：读者已经点了要去那一站，这一条不接手指（样式表）也不接按键
      inert={paneLook.diving}
    >
      {!calm && (
        <button type="button" className="stage-button bar-play" onClick={() => (now.playing ? control.stop() : control.play())}>
          {now.playing ? BAR_TEXT.pause : BAR_TEXT.play}
        </button>
      )}
      <div className="bar-slide">
        {calm && (
          <button type="button" className="stage-button bar-step" onClick={() => control.step(-1)}>
            {BAR_TEXT.prev}
          </button>
        )}
        <div
          className="bar-track"
          role="slider"
          tabIndex={0}
          aria-label={BAR_TEXT.trackName(bar.name)}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={1000}
          aria-valuenow={Math.round((unitsAt(scale, at) / scale.total) * 1000)}
          aria-valuetext={words.spoken}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onLostPointerCapture={onUp}
          onKeyDown={onKey}
        >
          <div className="bar-axis" ref={axis}>
            {box && (
              <>
                <svg aria-hidden="true">
                  <line className="bar-rail" x1={0} x2={box.track} y1={BLOCK_BOTTOM + 0.5} y2={BLOCK_BOTTOM + 0.5} />
                  {scale.blocks.map((block) => blockShape(block, px))}
                  {scale.blocks.filter((block) => squeezed(block, px)).map((block) => squeezeMark(block, px))}
                  {groupSpans(scale).map((span) => (
                    <path key={span.stop} className="bar-span" d={`M${r(span.u0 * px + 0.5)} ${BLOCK_TOP}V${SPAN_Y}H${r(span.u1 * px - 0.5)}V${BLOCK_TOP}`} />
                  ))}
                  {ticks.map((tick) => (
                    <line key={tick.year} className="bar-tick" x1={r(tick.u * px) + 0.5} x2={r(tick.u * px) + 0.5} y1={BLOCK_BOTTOM} y2={TICK_BOTTOM} />
                  ))}
                </svg>
                {groupSpans(scale).map((span) => {
                  const stop = marks?.[span.stop];
                  if (!stop) return null;
                  return (
                    <span key={span.stop} className={stop.written ? 'bar-disc' : 'bar-disc is-unwritten'} style={{ left: r(discAt(span, px)) }} aria-hidden="true">
                      {stop.label}
                    </span>
                  );
                })}
                {labelledTicks(ticks, px).map((tick, i) => (
                  <span key={tick.year} className={i === 0 ? 'bar-year is-first' : 'bar-year'} style={{ left: r(tick.u * px) }} aria-hidden="true">
                    {tick.year}
                  </span>
                ))}
                <span className="bar-thumb" style={{ left: r(unitsAt(scale, at) * px) }} aria-hidden="true" />
              </>
            )}
          </div>
        </div>
        {calm && (
          <button type="button" className="stage-button bar-step" onClick={() => control.step(1)}>
            {BAR_TEXT.next}
          </button>
        )}
      </div>
      <p className="bar-when">
        {fit.roomy && onHome && <span>{bar.name}</span>}
        <span>{words.year}</span>
        {fit.age && <span>{words.age}</span>}
        <span className="bar-label">{words.label}</span>
      </p>
      <button type="button" ref={noteButton} className="bar-note" aria-expanded={noteOpen} aria-controls={noteOpen ? noteId : undefined} aria-label={BAR_TEXT.noteName} onClick={toggleNote}>
        {BAR_TEXT.note}
      </button>
      {mark && (
        <a className={fit.roomy ? 'bar-enter' : 'bar-enter is-seal'} href={mark.href} aria-label={`${BAR_TEXT.enterName}${mark.title}`}>
          {fit.roomy ? BAR_TEXT.enter(mark.label) : <span className={mark.written ? 'bar-disc' : 'bar-disc is-unwritten'}>{mark.label}</span>}
        </a>
      )}
      <p className="bar-known">{words.says}</p>
      <p className="bar-says visually-hidden" role="status">
        {said}
      </p>
      {noteOpen && <BarNote bar={bar} words={words} unsure={stretch.unsure} pictures={paneLook.pictures} id={noteId} onClose={closeNote} panelRef={notePanel} />}
    </div>
  );
}

/** 像素取到小数点后一位：画出来的线不发虚，写进页面的数也不长。 */
function r(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 轴上的一格画成什么（样子在 timebar.css）。px 是一个单位多少像素。 */
function blockShape(block: BarBlock, px: number) {
  const x0 = r(block.u0 * px);
  const x1 = r(block.u1 * px);
  const width = x1 - x0;
  if (block.look === 'road') return <line key={block.id} className={block.dashed ? 'bar-road is-dashed' : 'bar-road'} x1={x0} x2={x1} y1={ROAD_Y} y2={ROAD_Y} />;
  // 一站住下来的年月：实心的格子，同邻居之间留半个像素的缝
  if (block.look === 'stop') return <rect key={block.id} className="bar-stay" x={x0 + 0.5} y={BLOCK_TOP} width={Math.max(0, width - 1)} height={BLOCK_BOTTOM - BLOCK_TOP} />;
  const name = block.look === 'quiet' ? 'bar-quiet' : 'bar-off';
  // 很窄的格子（好几格挤在一起的地方）不画左右两条边，只剩上下两道线
  if (width < THIN_BLOCK_PX) return <path key={block.id} className={name} d={`M${x0} ${BLOCK_TOP + 0.5}H${x1}M${x0} ${BLOCK_BOTTOM - 0.5}H${x1}`} />;
  return <rect key={block.id} className={name} x={x0 + 0.5} y={BLOCK_TOP + 0.5} width={width - 1} height={BLOCK_BOTTOM - BLOCK_TOP - 1} />;
}

/** 住下来的格子上的两道斜线：这一格是压窄了画的。 */
function squeezeMark(block: BarBlock, px: number) {
  const mid = r(((block.u0 + block.u1) / 2) * px);
  return <path key={`${block.id}-squeeze`} className={block.look === 'quiet' ? 'bar-squeeze is-quiet' : 'bar-squeeze'} d={`M${mid - 3} ${BLOCK_BOTTOM - 2.5}l2.5 -6M${mid + 0.5} ${BLOCK_BOTTOM - 2.5}l2.5 -6`} />;
}

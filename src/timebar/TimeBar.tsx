// 时间轴：全程沙盘下面、题记上面的那一条（.stage-bar，地方是沙盘栏留的）里面的东西。
// 这是摆上全程沙盘才下载的一段程序（src/ui/StagePane.tsx 里的那一句动态 import）。这个文件夹里的文件：
//   只从 react 直接引钩子，不引 src/app/、src/ui/ 里的东西（引了，打包的工具会把 React 的核心从页面的程序里单拆出去）；
//   自己不写动态 import；颜色和字号都在 src/styles/timebar.css，这里只算位置。
//
// 现在画的是不动的一版：照行迹（./barData.ts）画出第一行（哪一年、虚岁多少、在哪）、第二行（这一段知道些什么）和那一条轴，
// 圆钮停在一个日子上，沙盘上的小像站到那一天他在的地方。日子是地址里 ?bar= 给的，没给就是出生的那一天；
// 按钮和轴上还没有接手指和按键。
//
// 它不同沙盘栏说话，只看沙盘栏写在自己身上的东西（data-stage-state），小像经 slot.current.view?.placePiece?.() 摆到沙盘上：
//   沙盘摆好了（data-stage-state 是 ready）、这一条有地方（没有收起来、样式表没有把它拿掉），小像摆到这一天的地方；
//   这一条没有地方（没有时间轴的时候，沙盘上只摆一个小像，说不出是哪一天的），或者这一天沙盘上没有他：拿走。
// 放着图片的时候 view 是 null（图片上不画小像，两行字说他在哪）；站点沙盘没有这一条。

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ItineraryBar } from '../domain/itinerary';
import type { BarProps, PiecePlace, StopStageView } from '../stage/types';
import { barFor } from './barData';
import { barScale, barTicks, groupSpans, labelledTicks, squeezed, THIN_BLOCK_PX, unitsAt } from './barScale';
import type { BarBlock } from './barScale';
import { BAR_TEXT } from './barText';
import { stretchIndexAt, whereAt } from './barWhere';
import { barFit, barSwitch, wordsAt } from './barWords';

/** 轴那一行里从上往下（像素）：格子和路从 23 到 34，一站讲的那几年的那道线在 21.5，刻度从 34 到 37。 */
const BLOCK_TOP = 23;
const BLOCK_BOTTOM = 34;
const ROAD_Y = 28.5;
const SPAN_Y = 21.5;
const TICK_BOTTOM = 37;

export function TimeBar({ table, marks, slot }: BarProps) {
  const bar = barFor(table.key);
  // 地址里的开关只在这一条摆上的时候读一次
  const [asked] = useState(() => barSwitch(window.location.search));
  if (!bar || !asked.on) return null;
  return <Bar bar={bar} day={asked.day ?? 0} marks={marks} slot={slot} />;
}

interface Props {
  bar: ItineraryBar;
  /** 圆钮停在第几天。 */
  day: number;
  marks: BarProps['marks'];
  slot: BarProps['slot'];
}

function Bar({ bar, day, marks, slot }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  /** 量到的两个宽：这一条里面多宽（定摆哪几样），轴多宽（定每一格画在哪）。这一条没有地方的时候是 null。 */
  const [box, setBox] = useState<{ inner: number; track: number } | null>(null);
  /** 上一回把小像摆在了哪座沙盘的哪里（写成字比较；'null' 是没有摆）：没变就不再叫沙盘。刚摆出来的沙盘上本来就没有小像。 */
  const placed = useRef<{ view: StopStageView | null; where: string }>({ view: null, where: 'null' });

  const scale = barScale(bar);
  const at = Math.min(Math.max(day, 0), scale.lastDay);
  const words = wordsAt(bar, at);
  const stretch = bar.stretches[stretchIndexAt(bar, at)];

  // 这一条摆上、窗口大小变了的时候量一遍。量的是这一条自己（.stage-bar）：它没有地方的时候两个宽都是 0。
  useLayoutEffect(() => {
    const measure = (): void => {
      const band = root.current?.parentElement;
      const inner = band ? band.clientWidth : 0;
      const wide = track.current ? track.current.clientWidth : 0;
      setBox((was) => (inner > 0 && wide > 0 ? (was && was.inner === inner && was.track === wide ? was : { inner, track: wide }) : null));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // 每一回沙盘栏重画以后看一眼（这一条是沙盘栏的孩子，沙盘栏重画它也重画）：小像该不该在沙盘上、该在哪。
  useEffect(() => {
    const view = slot.current.view;
    const ready = root.current?.closest('.stage-pane')?.getAttribute('data-stage-state') === 'ready';
    const where: PiecePlace | null = box && ready ? whereAt(bar, at) : null;
    const key = JSON.stringify(where);
    // 换了一座沙盘（再试一次、降了一档、重新摆出来）：新的那一座上还什么都没有摆
    if (placed.current.view !== view) placed.current = { view, where: 'null' };
    if (placed.current.where === key) return;
    placed.current.where = key;
    view?.placePiece?.(where);
  });
  // 这一条拿走的时候（换了一页、沙盘栏换成了一站自己的沙盘）把小像也拿走
  useEffect(
    () => () => {
      if (placed.current.where !== 'null') placed.current.view?.placePiece?.(null);
      placed.current = { view: null, where: 'null' };
    },
    [],
  );

  const fit = barFit(box?.inner ?? 0);
  // 首页上（地址里“#/”后面是空的）栏够宽的时候，第一行最前面是人物的名字
  const onHome = window.location.hash.replace(/^#\/?/, '') === '';
  const mark = stretch.group ? marks?.[stretch.group] : undefined;
  const px = box ? box.track / scale.total : 0;
  const ticks = barTicks(bar, scale);

  return (
    <div className={fit.roomy ? 'bar is-roomy' : 'bar'} data-bar-look={stretch.look} data-bar-stop={stretch.group} ref={root}>
      <button type="button" className="stage-button bar-play">
        {BAR_TEXT.play}
      </button>
      <div className="bar-slide">
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
          ref={track}
        >
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
                return (
                  stop && (
                    <span key={span.stop} className={stop.written ? 'bar-disc' : 'bar-disc is-unwritten'} style={{ left: r(((span.u0 + span.u1) / 2) * px) }} aria-hidden="true">
                      {stop.label}
                    </span>
                  )
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
      <p className="bar-when">
        {fit.roomy && onHome && <span>{bar.name}</span>}
        <span>{words.year}</span>
        {fit.age && <span>{words.age}</span>}
        <span className="bar-label">{words.label}</span>
      </p>
      <button type="button" className="bar-note" aria-expanded={false} aria-label={BAR_TEXT.noteName}>
        {BAR_TEXT.note}
      </button>
      {mark && (
        <a className={fit.roomy ? 'bar-enter' : 'bar-enter is-seal'} href={mark.href} aria-label={`${BAR_TEXT.enterName}${mark.title}`}>
          {fit.roomy ? BAR_TEXT.enter(mark.label) : <span className={mark.written ? 'bar-disc' : 'bar-disc is-unwritten'}>{mark.label}</span>}
        </a>
      )}
      <p className="bar-known">{words.says}</p>
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

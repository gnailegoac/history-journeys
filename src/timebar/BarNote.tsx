// 点时间轴的“图例”展开的那一块：样子就是题记的“说明”展开的那一块（.stage-note-panel），摆在时间轴的上面、盖着沙盘的下边，
// 不盖时间轴；沙盘那一块不够高的时候在自己里面滚（样子在 src/styles/timebar.css 的 .bar-panel）。
// 先是时间轴停着的这一段：哪一年、几岁、在哪，那一句话的全文，有说不准的接着说；一道细线下面是固定的几句（./barNoteText.ts）。
// 开、关由 TimeBar.tsx 管（同题记的那一块一次只开一个；按 Esc、点“关闭”收起）。

import type { Ref } from 'react';
import type { ItineraryBar } from '../domain/itinerary';
import { BAR_NOTE_TEXT } from './barNoteText';
import { BAR_TEXT } from './barText';
import type { BarWords } from './barWords';
import { numeral } from './barWords';

interface Props {
  bar: ItineraryBar;
  /** 时间轴停着的地方印的字（第一行的三样、第二行的那一句）。 */
  words: BarWords;
  /** 这一段里说不准的；没有是 undefined。 */
  unsure: string | undefined;
  /** 这一栏现在放着的是图片（图片上不画小像）。 */
  pictures: boolean;
  id: string;
  onClose: () => void;
  panelRef: Ref<HTMLDivElement>;
}

/** 行迹里站在线上、沙盘平时没有立名字的各处的名字，照先后，一个名字只说一次。 */
export function spotNames(bar: ItineraryBar): string[] {
  return [...new Set(bar.stretches.flatMap((stretch) => (stretch.spot?.[2] ? [stretch.spot[2]] : [])))];
}

/** 轴上有几站（落在哪一站讲的年月里的各段，一共说到几站）。 */
export function stopCount(bar: ItineraryBar): number {
  return new Set(bar.stretches.flatMap((stretch) => (stretch.group ? [stretch.group] : []))).size;
}

export function BarNote({ bar, words, unsure, pictures, id, onClose, panelRef }: Props) {
  const spots = spotNames(bar);
  return (
    <div className="stage-note-panel bar-panel" id={id} ref={panelRef} role="region" aria-label={BAR_TEXT.noteName}>
      <div className="stage-note-panel-head">
        <p className="stage-note-panel-title">{BAR_TEXT.note}</p>
        <button type="button" className="stage-note-close" onClick={onClose}>
          {BAR_TEXT.close}
        </button>
      </div>
      <div className="bar-now">
        <p className="bar-now-when">
          <span>{words.year}</span>
          <span>{words.age}</span>
          <span>{words.label}</span>
        </p>
        <p>{words.says}</p>
        {unsure && (
          <p className="bar-now-unsure">
            {BAR_TEXT.unsure}
            {unsure}
          </p>
        )}
      </div>
      <div className="stage-note-lines">
        <p>{pictures ? BAR_NOTE_TEXT.pictures : BAR_NOTE_TEXT.figure(bar.name)}</p>
        <p>{BAR_NOTE_TEXT.scale}</p>
        <p>{BAR_NOTE_TEXT.even}</p>
        {/* 放着图片的时候不说这一句：图片上没有小像，也就没有立在他旁边的名字 */}
        {!pictures && spots.length > 0 && <p>{BAR_NOTE_TEXT.spots(spots.join('、'))}</p>}
        <p>{BAR_NOTE_TEXT.off}</p>
        <p>{BAR_NOTE_TEXT.west}</p>
        <p>{BAR_NOTE_TEXT.camera}</p>
        <p>{BAR_NOTE_TEXT.discs(numeral(stopCount(bar)))}</p>
      </div>
    </div>
  );
}

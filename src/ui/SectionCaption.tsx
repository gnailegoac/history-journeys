// 沙盘旁边印的字：这一小节是什么时候，一句题记，一句如实的说明，题签指到的远处在哪个方向、多远。
// 这些字都是 src/domain 的 sectionInfo() 从场景数据生成的，这里只管排出来。
//
// 排法是定死的（见 stage.css）：第一行是小节和时间，右头是比例尺和指北；下面是题记、远处、一句说明
// （栏宽时远处另起一行排在最后）。
// 不管哪一小节，这一块都一样高，沙盘四边留的空就不变。
// 说明有两种写法，都印在页面里，由样式挑一种显示：栏窄时是一行的 brief，栏宽时是最多两行的 short。
// 完整的几句话（lines）不常印着：点“说明”才展开（NotePanel），盖在沙盘的下边，不挤这一块。

import type { ReactNode, Ref } from 'react';
import type { SectionInfo } from '../domain';
import { STAGE_TEXT } from './text';

interface CaptionProps {
  info: SectionInfo;
  /** 比例尺和指北，放在第一行的右头。沙盘没摆好时没有。 */
  legend?: ReactNode;
  /** 完整的说明展开了没有。 */
  noteOpen: boolean;
  onToggleNote: () => void;
  /** 展开的那一块的 id（给“说明”按钮的 aria-controls）。 */
  noteId: string;
  noteButton?: Ref<HTMLButtonElement>;
}

export function SectionCaption({ info, legend, noteOpen, onToggleNote, noteId, noteButton }: CaptionProps) {
  return (
    <div className="stage-caption" data-section={info.section}>
      <div className="stage-caption-head">
        <p className="stage-caption-title">
          <span className="stage-section-name">{info.section}</span>
          <span className="stage-date">{info.date}</span>
        </p>
        {legend}
      </div>
      <div className="stage-words">
        <p className="stage-line">{info.line}</p>
        {info.far.length > 0 && (
          <ul className="stage-far">
            {info.far.map((far) => (
              <li key={far.id} data-far-id={far.id}>
                {far.name}：{far.say}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="stage-note">
        <p className="stage-note-short">{info.note.short}</p>
        <p className="stage-note-brief">{info.note.brief}</p>
        <button
          type="button"
          ref={noteButton}
          className="stage-note-button"
          aria-expanded={noteOpen}
          aria-controls={noteOpen ? noteId : undefined}
          onClick={onToggleNote}
        >
          {STAGE_TEXT.note}
        </button>
      </div>
    </div>
  );
}

interface PanelProps {
  info: SectionInfo;
  id: string;
  onClose: () => void;
  panelRef?: Ref<HTMLDivElement>;
}

/** 点“说明”展开的那一块：这一小节完整的几句说明。 */
export function NotePanel({ info, id, onClose, panelRef }: PanelProps) {
  return (
    <div className="stage-note-panel" id={id} ref={panelRef} role="region" aria-label={STAGE_TEXT.noteLabel} data-section={info.section}>
      <div className="stage-note-panel-head">
        <p className="stage-note-panel-title">
          {STAGE_TEXT.noteTitle}
          <span>{info.section}</span>
        </p>
        <button type="button" className="stage-note-close" onClick={onClose}>
          {STAGE_TEXT.noteClose}
        </button>
      </div>
      <div className="stage-note-lines">
        {info.note.lines.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
    </div>
  );
}

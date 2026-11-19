// 一站的正文：小节、段落、引用；点开的小注就地出现在它那一段下面；每节后面是原文和图片。
// 每个小节带着 data-section（小节标题）：沙盘靠它知道读者读到了哪一节（见 useReadingSection.ts）。

import { useCallback, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Block, Note, Original, Section, StopContent, StopImage } from '../domain';
import { NOTE_KIND_LABEL } from './text';

export function StopText({ content }: { content: StopContent }) {
  const [openNotes, setOpenNotes] = useState<ReadonlySet<string>>(new Set());
  const root = useRef<HTMLDivElement>(null);

  const toggle = useCallback((noteId: string) => {
    setOpenNotes((current) => {
      const next = new Set(current);
      if (!next.delete(noteId)) next.add(noteId);
      return next;
    });
  }, []);

  // 用小注上的“关闭”收起后，焦点回到正文里的那个词上。
  const close = useCallback((noteId: string) => {
    setOpenNotes((current) => {
      const next = new Set(current);
      next.delete(noteId);
      return next;
    });
    root.current?.querySelector<HTMLElement>(`.note-term[data-note-id="${CSS.escape(noteId)}"]`)?.focus();
  }, []);

  const notes = new Map(content.notes.map((note) => [note.id, note]));
  const cites = new Map(content.sources.map((source) => [source.id, source.cite]));

  return (
    <div className="prose stop-text" ref={root}>
      {content.sections.map((section, i) => (
        <SectionView
          key={i}
          section={section}
          notes={notes}
          cites={cites}
          openNotes={openNotes}
          onToggle={toggle}
          onClose={close}
          originals={content.originals.filter((o) => o.section === section.heading)}
          images={content.images.filter((image) => image.section === section.heading)}
          imageUrls={content.imageUrls}
        />
      ))}
    </div>
  );
}

interface SectionProps {
  section: Section;
  notes: Map<string, Note>;
  /** 出处的 id 到出处的写法。 */
  cites: Map<string, string>;
  openNotes: ReadonlySet<string>;
  onToggle: (noteId: string) => void;
  onClose: (noteId: string) => void;
  originals: Original[];
  images: StopImage[];
  imageUrls: Record<string, string>;
}

function SectionView({ section, notes, cites, openNotes, onToggle, onClose, originals, images, imageUrls }: SectionProps) {
  return (
    <section className="text-section" data-section={section.heading}>
      <h2 className="section-heading">{section.heading}</h2>
      {section.blocks.map((block, i) => (
        <BlockView key={i} block={block} notes={notes} cites={cites} openNotes={openNotes} onToggle={onToggle} onClose={onClose} />
      ))}
      {originals.map((original) => (
        <OriginalView key={original.id} original={original} />
      ))}
      {images.map((image) => (
        <ImageView key={image.id} image={image} url={imageUrls[image.file]} />
      ))}
    </section>
  );
}

type BlockProps = Pick<SectionProps, 'notes' | 'cites' | 'openNotes' | 'onToggle' | 'onClose'> & { block: Block };

function BlockView({ block, notes, cites, openNotes, onToggle, onClose }: BlockProps) {
  if (block.type === 'quote') {
    return (
      <blockquote className="quote">
        {block.lines.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </blockquote>
    );
  }

  const noted = block.segments.flatMap((segment) => {
    const note = segment.noteId ? notes.get(segment.noteId) : undefined;
    return note ? [note] : [];
  });

  return (
    <>
      <p>
        {block.segments.map((segment, i) => {
          const note = segment.noteId ? notes.get(segment.noteId) : undefined;
          if (!note) return segment.text;
          return <NoteTerm key={i} note={note} text={segment.text} open={openNotes.has(note.id)} onToggle={onToggle} />;
        })}
      </p>
      {noted
        .filter((note) => openNotes.has(note.id))
        .map((note) => (
          <NoteView key={note.id} note={note} cites={cites} onClose={onClose} />
        ))}
    </>
  );
}

function noteDomId(noteId: string): string {
  return `note-${noteId}`;
}

interface NoteTermProps {
  note: Note;
  text: string;
  open: boolean;
  onToggle: (noteId: string) => void;
}

// 正文里可以点开小注的词。它要能跟着文字折行，而 <button> 不能在行中间断开，
// 所以用带按钮语义的行内元素：能用键盘走到，回车和空格都能点开。
function NoteTerm({ note, text, open, onToggle }: NoteTermProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onToggle(note.id);
    }
  };
  return (
    <span
      role="button"
      tabIndex={0}
      className="note-term"
      data-note-id={note.id}
      aria-expanded={open}
      aria-controls={open ? noteDomId(note.id) : undefined}
      onClick={() => onToggle(note.id)}
      onKeyDown={onKeyDown}
    >
      {text}
    </span>
  );
}

function NoteView({ note, cites, onClose }: { note: Note; cites: Map<string, string>; onClose: (noteId: string) => void }) {
  // 这条小注的出处；一个也对不上时不写这一行。
  const cited = note.sourceIds.flatMap((id) => {
    const cite = cites.get(id);
    return cite ? [cite] : [];
  });
  return (
    <aside className="note" id={noteDomId(note.id)} data-note-id={note.id} aria-label={`小注：${note.title}`}>
      <div className="note-head">
        <span className="note-kind">{NOTE_KIND_LABEL[note.kind]}</span>
        <span className="note-title">{note.title}</span>
        <button type="button" className="note-close" onClick={() => onClose(note.id)}>
          关闭<span className="visually-hidden">小注</span>
        </button>
      </div>
      {paragraphs(note.body).map((paragraph, i) => (
        <p key={i}>{paragraph}</p>
      ))}
      {cited.length > 0 && <p className="note-sources">出处：{cited.join('；')}</p>}
    </aside>
  );
}

function OriginalView({ original }: { original: Original }) {
  return (
    <details className="original" data-original-id={original.id}>
      <summary>读原文：{original.title}</summary>
      <div className="original-body">
        <p className="original-date">{original.date}</p>
        <p className="original-text">{original.text}</p>
        <p className="original-plain-label">白话</p>
        {paragraphs(original.plain).map((paragraph, i) => (
          <p key={i} className="original-plain">
            {paragraph}
          </p>
        ))}
      </div>
    </details>
  );
}

function ImageView({ image, url }: { image: StopImage; url: string | undefined }) {
  if (!url) return null;
  return (
    <figure className="stop-image" data-image-id={image.id}>
      <img src={url} alt={image.alt} loading="lazy" />
      <figcaption>
        <span className="stop-image-caption">{image.caption}</span>
        <span className="stop-image-credit">
          {image.credit} · {image.license} ·{' '}
          <a href={image.sourceUrl} target="_blank" rel="noopener noreferrer">
            图片出处
          </a>
        </span>
      </figcaption>
    </figure>
  );
}

/** 纯文字按空行分段。 */
function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

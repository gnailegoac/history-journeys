// 正文的解析：把受限的 Markdown 拆成小节和段落，再把小注的原词标出来。纯逻辑，不依赖界面。

import type { Block, Note, Section, Segment } from './types';

export type RawBlock = { type: 'paragraph'; text: string } | { type: 'quote'; lines: string[] };

export interface RawSection {
  heading: string;
  blocks: RawBlock[];
}

export class BodyFormatError extends Error {}

/**
 * 正文只允许三种写法：
 *   “## 小节标题”；
 *   段落（段与段之间空一行，段内换行不算分段）；
 *   “> ”开头的引用行（引用的原文句子，一行一句）。
 */
export function parseBody(markdown: string): RawSection[] {
  const sections: RawSection[] = [];
  let current: RawSection | null = null;
  let paragraph: string[] = [];
  let quote: string[] = [];

  const flush = () => {
    if (paragraph.length > 0 && current) current.blocks.push({ type: 'paragraph', text: paragraph.join('') });
    if (quote.length > 0 && current) current.blocks.push({ type: 'quote', lines: quote });
    paragraph = [];
    quote = [];
  };

  for (const rawLine of markdown.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('## ')) {
      flush();
      current = { heading: line.slice(3).trim(), blocks: [] };
      sections.push(current);
      continue;
    }
    if (line === '') {
      flush();
      continue;
    }
    if (line.startsWith('#')) throw new BodyFormatError(`正文里只允许“## ”开头的小节标题：${line}`);
    if (!current) throw new BodyFormatError(`正文必须以“## 小节标题”开头：${line}`);
    if (line.startsWith('>')) {
      if (paragraph.length > 0) flush();
      quote.push(line.replace(/^>\s*/, ''));
      continue;
    }
    if (quote.length > 0) flush();
    paragraph.push(line);
  }
  flush();
  return sections;
}

/** 正文的字数（段落和引用，不含标题和空白）。 */
export function bodyLength(sections: RawSection[]): number {
  let n = 0;
  for (const s of sections) {
    for (const b of s.blocks) {
      n += b.type === 'paragraph' ? b.text.length : b.lines.reduce((sum, l) => sum + l.length, 0);
    }
  }
  return n;
}

interface Mark {
  start: number;
  end: number;
  noteId: string;
}

/**
 * 在段落里标出每条小注的原词第一次出现的位置。
 * 原词较长的先占位，互相重叠时后来的往后找下一处。找不到的记入 missing。
 */
export function annotate(raw: RawSection[], notes: Pick<Note, 'id' | 'anchor'>[]): { sections: Section[]; missing: string[] } {
  const paragraphs: { text: string; marks: Mark[] }[] = [];
  for (const s of raw) for (const b of s.blocks) if (b.type === 'paragraph') paragraphs.push({ text: b.text, marks: [] });

  const missing: string[] = [];
  const ordered = [...notes].sort((a, b) => b.anchor.length - a.anchor.length);
  for (const note of ordered) {
    if (!note.anchor || !place(paragraphs, note)) missing.push(note.id);
  }

  let p = 0;
  const sections = raw.map((s) => ({
    heading: s.heading,
    blocks: s.blocks.map((b): Block => {
      if (b.type === 'quote') return { type: 'quote', lines: b.lines };
      const { text, marks } = paragraphs[p++];
      return { type: 'paragraph', segments: toSegments(text, marks) };
    }),
  }));
  return { sections, missing };
}

function place(paragraphs: { text: string; marks: Mark[] }[], note: Pick<Note, 'id' | 'anchor'>): boolean {
  for (const para of paragraphs) {
    let from = 0;
    for (;;) {
      const start = para.text.indexOf(note.anchor, from);
      if (start < 0) break;
      const end = start + note.anchor.length;
      if (!para.marks.some((m) => start < m.end && m.start < end)) {
        para.marks.push({ start, end, noteId: note.id });
        return true;
      }
      from = start + 1;
    }
  }
  return false;
}

function toSegments(text: string, marks: Mark[]): Segment[] {
  const segments: Segment[] = [];
  let at = 0;
  for (const m of [...marks].sort((a, b) => a.start - b.start)) {
    if (m.start > at) segments.push({ text: text.slice(at, m.start) });
    segments.push({ text: text.slice(m.start, m.end), noteId: m.noteId });
    at = m.end;
  }
  if (at < text.length) segments.push({ text: text.slice(at) });
  return segments;
}

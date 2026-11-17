// 正文解析的单元测试：parseBody、annotate、bodyLength。

import { describe, expect, it } from 'vitest';
import { annotate, BodyFormatError, bodyLength, parseBody } from '../../src/domain/body';
import type { RawSection } from '../../src/domain/body';
import type { Block } from '../../src/domain/types';

/** 把一段里的各截重新接起来。 */
function joined(block: Block): string {
  return block.type === 'paragraph' ? block.segments.map((s) => s.text).join('') : block.lines.join('\n');
}

/** 一段里带小注的那几截，写成 [原词, 小注 id]。 */
function marked(block: Block): [string, string][] {
  if (block.type !== 'paragraph') return [];
  return block.segments.filter((s) => s.noteId !== undefined).map((s) => [s.text, s.noteId as string]);
}

describe('parseBody', () => {
  it('按“## ”拆成小节，标题去掉首尾空白', () => {
    const sections = parseBody('## 到黄州\n\n第一段。\n\n##   这个地方  \n\n第二段。\n');
    expect(sections).toEqual([
      { heading: '到黄州', blocks: [{ type: 'paragraph', text: '第一段。' }] },
      { heading: '这个地方', blocks: [{ type: 'paragraph', text: '第二段。' }] },
    ]);
  });

  it('空行分段；段内换行不算分段，直接接起来', () => {
    const sections = parseBody('## 一\n\n前半句，\n后半句。\n\n\n\n另一段。');
    expect(sections[0].blocks).toEqual([
      { type: 'paragraph', text: '前半句，后半句。' },
      { type: 'paragraph', text: '另一段。' },
    ]);
  });

  it('行首行尾的空白（含全角空格）不进正文', () => {
    const sections = parseBody('## 一\n\n　　开头空两格。  \n');
    expect(sections[0].blocks).toEqual([{ type: 'paragraph', text: '开头空两格。' }]);
  });

  it('连着的引用行是一块，一行一句', () => {
    const sections = parseBody('## 一\n\n> 自笑平生为口忙，\n> 老来事业转荒唐。\n');
    expect(sections[0].blocks).toEqual([{ type: 'quote', lines: ['自笑平生为口忙，', '老来事业转荒唐。'] }]);
  });

  it('引用行“>”后面有没有空格、有几个空格都一样', () => {
    const sections = parseBody('## 一\n\n>没有空格\n>   三个空格\n');
    expect(sections[0].blocks).toEqual([{ type: 'quote', lines: ['没有空格', '三个空格'] }]);
  });

  it('段落和引用紧挨着（中间没有空行）也分成两块，先后不变', () => {
    const sections = parseBody('## 一\n段落一。\n> 引用。\n段落二。\n');
    expect(sections[0].blocks).toEqual([
      { type: 'paragraph', text: '段落一。' },
      { type: 'quote', lines: ['引用。'] },
      { type: 'paragraph', text: '段落二。' },
    ]);
  });

  it('空行隔开的两组引用行是两块', () => {
    const sections = parseBody('## 一\n\n> 甲。\n\n> 乙。\n');
    expect(sections[0].blocks).toEqual([
      { type: 'quote', lines: ['甲。'] },
      { type: 'quote', lines: ['乙。'] },
    ]);
  });

  it('只有标题的小节没有内容块', () => {
    expect(parseBody('## 一\n\n## 二\n\n有一段。')).toEqual([
      { heading: '一', blocks: [] },
      { heading: '二', blocks: [{ type: 'paragraph', text: '有一段。' }] },
    ]);
  });

  it('空文件没有小节', () => {
    expect(parseBody('')).toEqual([]);
    expect(parseBody('\n\n  \n')).toEqual([]);
  });

  it('文件开头的 BOM 和 Windows 换行（CRLF）不影响结果', () => {
    const plain = '## 一\n\n第一段，\n接着写。\n\n> 引用。\n\n## 二\n\n第二段。\n';
    const windows = '﻿' + plain.replace(/\n/g, '\r\n');
    expect(parseBody(windows)).toEqual(parseBody(plain));
    expect(parseBody(windows)[0].heading).toBe('一');
  });

  it('旧式的单个 CR 换行也认', () => {
    expect(parseBody('## 一\r\r甲。\r\r乙。')).toEqual(parseBody('## 一\n\n甲。\n\n乙。'));
  });

  it('错误一：出现“## ”以外的标题写法', () => {
    expect(() => parseBody('# 大标题\n\n正文。')).toThrow(BodyFormatError);
    expect(() => parseBody('## 一\n\n### 小小节\n')).toThrow(BodyFormatError);
    expect(() => parseBody('##没有空格\n')).toThrow(BodyFormatError);
    expect(() => parseBody('## 一\n\n### 小小节\n')).toThrow('### 小小节');
  });

  it('错误二：第一个小节标题之前就有正文或引用', () => {
    expect(() => parseBody('开头没有标题。\n\n## 一\n')).toThrow(BodyFormatError);
    expect(() => parseBody('> 引用在最前面。\n\n## 一\n')).toThrow(BodyFormatError);
    expect(() => parseBody('开头没有标题。\n\n## 一\n')).toThrow('开头没有标题。');
  });
});

describe('bodyLength', () => {
  it('数段落和引用的字，不数标题、空行和行首行尾的空白', () => {
    const sections = parseBody('## 标题不算\n\n  一二三，\n四五。\n\n> 六七八\n> 九十\n\n## 也不算\n\n完。');
    // “一二三，四五。”7 字，“六七八”“九十”5 字，“完。”2 字。
    expect(bodyLength(sections)).toBe(14);
  });

  it('没有内容时是 0', () => {
    expect(bodyLength([])).toBe(0);
    expect(bodyLength([{ heading: '一', blocks: [] }])).toBe(0);
  });
});

describe('annotate', () => {
  const body = (markdown: string): RawSection[] => parseBody(markdown);

  it('只标原词第一次出现的地方', () => {
    const { sections, missing } = annotate(body('## 一\n\n黄州在江北。\n\n我到黄州，住在黄州。'), [{ id: 'n1', anchor: '黄州' }]);
    expect(missing).toEqual([]);
    expect(sections[0].blocks[0]).toEqual({ type: 'paragraph', segments: [{ text: '黄州', noteId: 'n1' }, { text: '在江北。' }] });
    expect(sections[0].blocks[1]).toEqual({ type: 'paragraph', segments: [{ text: '我到黄州，住在黄州。' }] });
  });

  it('第一次出现在后面的小节里，也找得到', () => {
    const { sections, missing } = annotate(body('## 一\n\n没有那个词。\n\n## 二\n\n这里有雪堂。'), [{ id: 'n1', anchor: '雪堂' }]);
    expect(missing).toEqual([]);
    expect(marked(sections[0].blocks[0])).toEqual([]);
    expect(sections[1].blocks[0]).toEqual({ type: 'paragraph', segments: [{ text: '这里有' }, { text: '雪堂', noteId: 'n1' }, { text: '。' }] });
  });

  it('标完以后，每段的字一个不多、一个不少，也没有空的一截', () => {
    const markdown = '## 一\n\n给我的官是黄州团练副使，本州安置。\n\n黄州在大江北岸，对岸是武昌的山。';
    const notes = [
      { id: 'a', anchor: '黄州' },
      { id: 'b', anchor: '黄州团练副使' },
      { id: 'c', anchor: '武昌' },
      { id: 'd', anchor: '山。' },
    ];
    const raw = body(markdown);
    const { sections } = annotate(raw, notes);
    sections.forEach((section, i) => {
      expect(section.heading).toBe(raw[i].heading);
      section.blocks.forEach((block, j) => {
        const original = raw[i].blocks[j];
        expect(joined(block)).toBe(original.type === 'paragraph' ? original.text : original.lines.join('\n'));
        if (block.type === 'paragraph') for (const s of block.segments) expect(s.text).not.toBe('');
      });
    });
  });

  it('原词长的先占位：短的原词不会切开长的', () => {
    const { sections, missing } = annotate(body('## 一\n\n给我的官是黄州团练副使。后来我离开黄州。'), [
      { id: 'short', anchor: '黄州' },
      { id: 'long', anchor: '黄州团练副使' },
    ]);
    expect(missing).toEqual([]);
    expect(marked(sections[0].blocks[0])).toEqual([
      ['黄州团练副使', 'long'],
      ['黄州', 'short'],
    ]);
  });

  it('短的原词在长的前面另有一处时，标在前面那一处', () => {
    const { sections } = annotate(body('## 一\n\n我到黄州。给我的官是黄州团练副使。'), [
      { id: 'short', anchor: '黄州' },
      { id: 'long', anchor: '黄州团练副使' },
    ]);
    expect(marked(sections[0].blocks[0])).toEqual([
      ['黄州', 'short'],
      ['黄州团练副使', 'long'],
    ]);
  });

  it('短的原词只在长的里面出现时，标不出来，记入 missing', () => {
    const { sections, missing } = annotate(body('## 一\n\n给我的官是黄州团练副使。'), [
      { id: 'short', anchor: '黄州' },
      { id: 'long', anchor: '黄州团练副使' },
    ]);
    expect(missing).toEqual(['short']);
    expect(marked(sections[0].blocks[0])).toEqual([['黄州团练副使', 'long']]);
  });

  it('两个原词部分重叠时，长的占位，短的往后找；后面没有就记入 missing', () => {
    const notes = [
      { id: 'jushi', anchor: '居士林' },
      { id: 'dongpo', anchor: '东坡居士' },
    ];
    const none = annotate(body('## 一\n\n自号东坡居士林下。'), notes);
    expect(none.missing).toEqual(['jushi']);
    expect(marked(none.sections[0].blocks[0])).toEqual([['东坡居士', 'dongpo']]);

    const later = annotate(body('## 一\n\n自号东坡居士林下。又过居士林。'), notes);
    expect(later.missing).toEqual([]);
    expect(marked(later.sections[0].blocks[0])).toEqual([
      ['东坡居士', 'dongpo'],
      ['居士林', 'jushi'],
    ]);
  });

  it('两条小注的原词一样时，排在前面的标第一处，后面的标下一处', () => {
    const { sections, missing } = annotate(body('## 一\n\n赤壁在城外。\n\n又去赤壁。'), [
      { id: 'first', anchor: '赤壁' },
      { id: 'second', anchor: '赤壁' },
    ]);
    expect(missing).toEqual([]);
    expect(marked(sections[0].blocks[0])).toEqual([['赤壁', 'first']]);
    expect(marked(sections[0].blocks[1])).toEqual([['赤壁', 'second']]);
  });

  it('正文里没有的原词、空的原词记入 missing，正文不变', () => {
    const raw = body('## 一\n\n黄州在江北。');
    const { sections, missing } = annotate(raw, [
      { id: 'n1', anchor: '杭州' },
      { id: 'n2', anchor: '' },
      { id: 'n3', anchor: '江北' },
    ]);
    expect([...missing].sort()).toEqual(['n1', 'n2']);
    expect(sections[0].blocks[0]).toEqual({ type: 'paragraph', segments: [{ text: '黄州在' }, { text: '江北', noteId: 'n3' }, { text: '。' }] });
  });

  it('原词不跨段', () => {
    const { missing } = annotate(body('## 一\n\n前一段结尾是东\n\n坡开头的后一段。'), [{ id: 'n1', anchor: '东坡' }]);
    expect(missing).toEqual(['n1']);
  });

  it('段内换行接起来以后的词能标上', () => {
    const { missing } = annotate(body('## 一\n\n自号东\n坡居士。'), [{ id: 'n1', anchor: '东坡居士' }]);
    expect(missing).toEqual([]);
  });

  it('引用块原样保留；只在引用或标题里出现的原词不算', () => {
    const raw = body('## 赤壁\n\n> 山高月小，水落石出。\n\n到了江边。');
    const { sections, missing } = annotate(raw, [
      { id: 'in-quote', anchor: '水落石出' },
      { id: 'in-heading', anchor: '赤壁' },
      { id: 'in-paragraph', anchor: '江边' },
    ]);
    expect([...missing].sort()).toEqual(['in-heading', 'in-quote']);
    expect(sections[0].heading).toBe('赤壁');
    expect(sections[0].blocks[0]).toEqual({ type: 'quote', lines: ['山高月小，水落石出。'] });
    expect(marked(sections[0].blocks[1])).toEqual([['江边', 'in-paragraph']]);
  });

  it('引用前的原词标在段落里，引用后的段落顺序不乱', () => {
    const { sections } = annotate(body('## 一\n\n甲段有词。\n\n> 引用也有词。\n\n乙段有词。'), [
      { id: 'n1', anchor: '有词' },
      { id: 'n2', anchor: '乙段' },
    ]);
    expect(sections[0].blocks.map((b) => b.type)).toEqual(['paragraph', 'quote', 'paragraph']);
    expect(marked(sections[0].blocks[0])).toEqual([['有词', 'n1']]);
    expect(marked(sections[0].blocks[2])).toEqual([['乙段', 'n2']]);
  });

  it('没有小注时，每段是完整的一截', () => {
    const { sections, missing } = annotate(body('## 一\n\n只有一段。'), []);
    expect(missing).toEqual([]);
    expect(sections).toEqual([{ heading: '一', blocks: [{ type: 'paragraph', segments: [{ text: '只有一段。' }] }] }]);
  });

  it('不改动传进来的小注顺序和正文', () => {
    const raw = body('## 一\n\n黄州团练副使在黄州。');
    const before = JSON.stringify(raw);
    const notes = [
      { id: 'short', anchor: '黄州' },
      { id: 'long', anchor: '黄州团练副使' },
    ];
    annotate(raw, notes);
    expect(notes.map((n) => n.id)).toEqual(['short', 'long']);
    expect(JSON.stringify(raw)).toBe(before);
  });
});

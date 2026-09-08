import { describe, expect, test } from 'vitest';

import {
  asTiptapDoc,
  checkStoredSize,
  estimateStoredBytes,
  FIRESTORE_DOCUMENT_LIMIT_BYTES,
  MAX_STORED_CONTENT_BYTES,
  describeLossyConversions,
  needsJoiningSpace,
  parseMarkdownToManuscript,
  type ManuscriptNode,
} from '@/lib/editor/markdown-import';
import { getSchema } from '@tiptap/core';
import { SUPPORTED_NODE_TYPES } from '@/lib/editor/manuscript-schema';
import { Node as PMNode } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';

import {
  isSupportedMark,
  isSupportedNode,
  STARTER_KIT_OPTIONS,
} from '@/lib/editor/manuscript-schema';
import { ManuscriptParagraph } from '@/lib/editor/extensions/ManuscriptParagraph';
import { ManuscriptFontFamily } from '@/lib/editor/extensions/ManuscriptFontFamily';
import { ParagraphFormatExtension } from '@/lib/editor/extensions/ParagraphFormatExtension';
import { FontSizeExtension } from '@/lib/editor/extensions/FontSizeExtension';
import { SceneBreakExtension } from '@/lib/editor/extensions/SceneBreakExtension';
import { SceneHeaderExtension } from '@/lib/editor/extensions/SceneHeaderExtension';
import { PageBreakExtension } from '@/lib/editor/extensions/PageBreakExtension';
import { generateDocxDocument } from '@/lib/docx/generator';
import { DEFAULT_DOCUMENT_SETTINGS } from '@/types/project';
import { extractPlainTextFromTiptap } from '@/lib/editor/plain-text';

/**
 * Stage 6A — Markdown import.
 *
 * The importer's job is to land inside a schema that has no headings, lists,
 * blockquotes or code blocks. Most of what follows checks two things: that the
 * conversion is the one the author was promised, and that the result is
 * something the rest of the pipeline can actually carry.
 */

const parse = (markdown: string) => parseMarkdownToManuscript(markdown);
const blocks = (markdown: string) => parse(markdown).content.content;

/** The text of the first (or nth) paragraph, marks ignored. */
function textOf(node: ManuscriptNode): string {
  return (node.content ?? [])
    .map((child) => (child.type === 'hardBreak' ? '\n' : child.text ?? ''))
    .join('');
}

function marksOf(node: ManuscriptNode, index = 0): string[] {
  return (node.content?.[index]?.marks ?? []).map((m) => m.type);
}

// ===========================================================================
// The output must be a manuscript
// ===========================================================================

describe('everything produced is inside the manuscript schema', () => {
  const KITCHEN_SINK = [
    '---',
    'title: front matter',
    '---',
    '# บทที่ 7',
    '',
    'ย่อหน้าแรกที่มี **ตัวหนา** และ *ตัวเอียง* และ ~~ขีดฆ่า~~',
    '',
    '> คำพูดที่ยกมา',
    '',
    '- รายการหนึ่ง',
    '- รายการสอง',
    '',
    '1. ข้อแรก',
    '2. ข้อสอง',
    '',
    '***',
    '',
    'หลังฉากใหม่ พร้อม [ลิงก์](https://example.com) และ ![ภาพ](cover.png)',
    '',
    '```',
    'const code = 1;',
    '```',
    '',
    'บรรทัดสุดท้าย  ',
    'หลังจากขึ้นบรรทัดใหม่',
    '',
    '> 18:30 — ลาดพร้าว 101',
    '',
    '<!-- PAGE BREAK -->',
    '',
    'หน้าใหม่',
  ].join('\n');

  function walk(node: ManuscriptNode, visit: (n: ManuscriptNode) => void) {
    visit(node);
    for (const child of node.content ?? []) walk(child, visit);
  }

  test('every node type is one the schema allows', () => {
    const doc = parse(KITCHEN_SINK).content;
    const seen = new Set<string>();
    walk(doc as unknown as ManuscriptNode, (n) => seen.add(n.type));

    for (const type of seen) {
      expect(isSupportedNode(type), `unsupported node: ${type}`).toBe(true);
    }
  });

  test('every mark is one the schema allows', () => {
    const doc = parse(KITCHEN_SINK).content;
    const seen = new Set<string>();
    walk(doc as unknown as ManuscriptNode, (n) => {
      for (const mark of n.marks ?? []) seen.add(mark.type);
    });

    expect(seen.size).toBeGreaterThan(0);
    for (const type of seen) {
      expect(isSupportedMark(type), `unsupported mark: ${type}`).toBe(true);
    }
  });

  test('the imported document exports to DOCX without throwing', async () => {
    // The end-to-end guarantee. The exporter refuses unknown nodes rather than
    // dropping them, so a passing export proves the import cannot leave a
    // chapter that fails to export later.
    const { content } = parse(KITCHEN_SINK);
    const buffer = await generateDocxDocument(
      'Imported',
      DEFAULT_DOCUMENT_SETTINGS,
      [{ chapterNumber: 7, title: 'บทที่ 7', content: content as never }]
    );
    expect(buffer.length).toBeGreaterThan(0);
  });

  test('the imported document loads into the real editor schema', () => {
    /*
      The DOCX check above proves the export path. This proves the other one:
      ProseMirror validates JSON against the schema when it parses it, and
      rejects an attribute no extension declared. An importer that emitted, say,
      `textAlign` instead of `textAlignOverride` would pass every other test
      here and then throw the moment an author opened the chapter.

      The schema is built from the same extensions NovelEditor registers.
      PageViewExtension is omitted deliberately: it contributes no nodes, marks
      or attributes, only decorations.
    */
    const schema = getSchema([
      StarterKit.configure(STARTER_KIT_OPTIONS),
      ManuscriptParagraph,
      Underline,
      TextStyle,
      ManuscriptFontFamily.configure({ types: ['textStyle'] }),
      FontSizeExtension,
      SceneBreakExtension,
      SceneHeaderExtension,
      PageBreakExtension,
      ParagraphFormatExtension,
    ]);

    const doc = PMNode.fromJSON(schema, parse(KITCHEN_SINK).content);
    expect(doc.type.name).toBe('doc');
    expect(doc.childCount).toBeGreaterThan(0);
    // A round trip through the schema must not change the document.
    expect(doc.toJSON()).toEqual(PMNode.fromJSON(schema, doc.toJSON()).toJSON());
  });

  test('a heading paragraph keeps its overrides through the editor schema', () => {
    const schema = getSchema([
      StarterKit.configure(STARTER_KIT_OPTIONS),
      ManuscriptParagraph,
      ParagraphFormatExtension,
    ]);

    const doc = PMNode.fromJSON(schema, parse('# หัวข้อ').content);
    expect(doc.firstChild?.attrs.textAlignOverride).toBe('center');
    expect(doc.firstChild?.attrs.firstLineIndentCmOverride).toBe(0);
  });

  test('paragraph attrs stay in the tri-state override model', () => {
    // `{}` means inherit. A baked value would pin the paragraph and defeat the
    // project's document settings, which is the bug lib/format exists to stop.
    const [paragraph] = blocks('plain prose');
    expect(paragraph.attrs).toEqual({});
  });
});

// ===========================================================================
// Block conversions
// ===========================================================================

describe('headings become centred bold paragraphs', () => {
  test.each(['#', '##', '###', '####', '#####', '######'])(
    '%s is flattened, since the schema has no heading node',
    (hashes) => {
      const [node] = blocks(`${hashes} หัวข้อ`);
      expect(node.type).toBe('paragraph');
      expect(textOf(node)).toBe('หัวข้อ');
      expect(marksOf(node)).toContain('bold');
    }
  );

  test('a heading is centred and loses the first-line indent', () => {
    const [node] = blocks('# หัวข้อ');
    expect(node.attrs).toEqual({
      textAlignOverride: 'center',
      firstLineIndentCmOverride: 0,
    });
  });

  test('closing hashes are not part of the title', () => {
    expect(textOf(blocks('## Chapter Two ##')[0])).toBe('Chapter Two');
  });

  test('a hash without a space is prose, not a heading', () => {
    const [node] = blocks('#hashtag not a heading');
    expect(textOf(node)).toBe('#hashtag not a heading');
    expect(marksOf(node)).not.toContain('bold');
  });

  test('inline formatting inside a heading survives', () => {
    const [node] = blocks('# หัวข้อ *เอียง*');
    const italic = (node.content ?? []).find((c) => (c.marks ?? []).some((m) => m.type === 'italic'));
    expect(italic?.text).toBe('เอียง');
  });
});

describe('thematic breaks become scene breaks', () => {
  test.each(['***', '---', '___', '* * *', '- - -', '-----'])(
    '%p becomes a sceneBreak',
    (line) => {
      expect(blocks(`a\n\n${line}\n\nb`)[1]).toEqual({ type: 'sceneBreak' });
    }
  );

  test('a scene break separates the prose either side of it', () => {
    const out = blocks('ก่อน\n\n***\n\nหลัง');
    expect(out.map((b) => b.type)).toEqual(['paragraph', 'sceneBreak', 'paragraph']);
    expect(textOf(out[0])).toBe('ก่อน');
    expect(textOf(out[2])).toBe('หลัง');
  });

  test('two dashes are prose, not a break', () => {
    expect(blocks('--')[0].type).toBe('paragraph');
  });
});

describe('lists become paragraphs', () => {
  test.each(['-', '*', '+'])('a %s bullet is prefixed with •', (bullet) => {
    const [node] = blocks(`${bullet} รายการ`);
    expect(node.type).toBe('paragraph');
    expect(textOf(node)).toBe('• รายการ');
  });

  test('an ordered item keeps its own number', () => {
    const out = blocks('1. หนึ่ง\n2. สอง');
    expect(out.map(textOf)).toEqual(['1. หนึ่ง', '2. สอง']);
  });

  test('each item is its own paragraph', () => {
    const out = blocks('- หนึ่ง\n- สอง\n- สาม');
    expect(out).toHaveLength(3);
    expect(out.every((b) => b.type === 'paragraph')).toBe(true);
  });

  test('inline formatting inside an item survives', () => {
    const [node] = blocks('- **สำคัญ**');
    expect(textOf(node)).toBe('• สำคัญ');
  });
});

describe('blockquotes lose only their marker', () => {
  test('the quoted text is kept', () => {
    expect(textOf(blocks('> คำพูด')[0])).toBe('คำพูด');
  });

  test('consecutive quoted lines form one paragraph', () => {
    const out = blocks('> one\n> two');
    expect(out).toHaveLength(1);
    expect(textOf(out[0])).toBe('one two');
  });
});

describe('fenced code arrives verbatim', () => {
  test('each line becomes its own paragraph, unparsed', () => {
    // No emphasis parsing inside: `a * b * c` is arithmetic, not italics.
    const out = blocks('```\na * b * c\n**not bold**\n```');
    expect(out.map(textOf)).toEqual(['a * b * c', '**not bold**']);
    expect(marksOf(out[1])).toEqual([]);
  });

  test('tildes fence too', () => {
    expect(blocks('~~~\nx\n~~~').map(textOf)).toEqual(['x']);
  });

  test('an unterminated fence does not swallow the rest silently', () => {
    const out = blocks('```\nonly line');
    expect(out.map(textOf)).toEqual(['only line']);
  });
});

// ===========================================================================
// Inline conversions
// ===========================================================================

describe('inline marks', () => {
  test.each([
    ['**หนา**', 'bold'],
    ['__หนา__', 'bold'],
    ['*เอียง*', 'italic'],
    ['_เอียง_', 'italic'],
    ['~~ฆ่า~~', 'strike'],
  ])('%s produces a %s mark', (source, mark) => {
    const [node] = blocks(source);
    expect(marksOf(node)).toContain(mark);
  });

  test('bold and italic nest', () => {
    const [node] = blocks('**หนา *และเอียง* ด้วย**');
    const nested = (node.content ?? []).find((c) => c.text === 'และเอียง');
    expect((nested?.marks ?? []).map((m) => m.type).sort()).toEqual(['bold', 'italic']);
  });

  test('a run without delimiters carries no marks at all', () => {
    const [node] = blocks('ธรรมดา');
    expect(node.content?.[0].marks).toBeUndefined();
  });

  test('underscores inside a word are left alone', () => {
    // snake_case is not emphasis.
    const [node] = blocks('ตัวแปร file_name_here ในโค้ด');
    expect(textOf(node)).toBe('ตัวแปร file_name_here ในโค้ด');
    expect(marksOf(node)).toEqual([]);
  });

  test('an escaped delimiter is literal', () => {
    const [node] = blocks('\\*ไม่เอียง\\*');
    expect(textOf(node)).toBe('*ไม่เอียง*');
    expect(marksOf(node)).toEqual([]);
  });

  test('a code span keeps its text and drops its backticks', () => {
    // There is no code mark in the schema, so the text is all that can survive.
    const [node] = blocks('เรียก `doSomething()` ตรงนี้');
    expect(textOf(node)).toBe('เรียก doSomething() ตรงนี้');
  });

  test('a code span is not reparsed for emphasis', () => {
    const [node] = blocks('`a * b * c`');
    expect(textOf(node)).toBe('a * b * c');
    expect(marksOf(node)).toEqual([]);
  });
});

describe('links and images', () => {
  test('a link keeps its text and its address', () => {
    const [node] = blocks('อ่านที่ [เว็บไซต์](https://example.com) นะ');
    expect(textOf(node)).toBe('อ่านที่ เว็บไซต์ (https://example.com) นะ');
    expect(parse('[a](https://x.com)').stats.links).toBe(1);
  });

  test('a link whose text is its address is not duplicated', () => {
    expect(textOf(blocks('[https://x.com](https://x.com)')[0])).toBe('https://x.com');
  });

  test('an image is reduced to its alt text and counted', () => {
    const result = parse('![ปกหนังสือ](cover.png)');
    expect(textOf(result.content.content[0])).toBe('ปกหนังสือ');
    expect(result.stats.imagesDropped).toBe(1);
    expect(result.stats.links).toBe(0);
  });
});

// ===========================================================================
// Line joining — the Thai case
// ===========================================================================

describe('soft-wrapped lines are joined script-aware', () => {
  test('Thai lines join with NO space', () => {
    // Thai does not separate words with spaces. Markdown's usual "join with a
    // space" would drop one into the middle of a wrapped word.
    const [node] = blocks('เธอหยุดอยู่\nตรงนั้น');
    expect(textOf(node)).toBe('เธอหยุดอยู่ตรงนั้น');
  });

  test('English lines join WITH a space', () => {
    expect(textOf(blocks('She stopped\nthere.')[0])).toBe('She stopped there.');
  });

  test('a Thai/English boundary takes no space either', () => {
    expect(textOf(blocks('คำไทย\nend')[0])).toBe('คำไทยend');
  });

  test('an existing trailing space is not doubled', () => {
    expect(textOf(blocks('one \ntwo')[0])).toBe('one two');
  });

  test.each([
    ['ก', 'ข', false],
    ['a', 'b', true],
    ['a', 'ก', false],
    ['。', 'x', false],
    ['', 'x', false],
  ])('needsJoiningSpace(%p, %p) === %p', (before, after, expected) => {
    expect(needsJoiningSpace(before, after)).toBe(expected);
  });

  test('two trailing spaces make an explicit hard break', () => {
    const result = parse('บรรทัดแรก  \nบรรทัดสอง');
    const [node] = result.content.content;
    expect(node.content?.map((c) => c.type)).toEqual(['text', 'hardBreak', 'text']);
    expect(result.stats.hardBreaks).toBe(1);
  });

  test('a trailing backslash makes an explicit hard break', () => {
    expect(parse('one\\\ntwo').stats.hardBreaks).toBe(1);
  });

  test('a hard break does not leave the backslash in the prose', () => {
    expect(textOf(blocks('one\\\ntwo')[0])).toBe('one\ntwo');
  });

  test('a mark spanning a soft wrap still applies', () => {
    const [node] = blocks('**bold across\nthe wrap**');
    expect(marksOf(node)).toContain('bold');
    expect(textOf(node)).toBe('bold across the wrap');
  });
});

// ===========================================================================
// Front matter, blank input, stats
// ===========================================================================

describe('front matter', () => {
  test('is stripped rather than imported as prose and a scene break', () => {
    const result = parse('---\ntitle: Draft\ntags: [a]\n---\n\nเนื้อหา');
    expect(result.stats.frontMatterStripped).toBe(true);
    expect(result.content.content.map((b) => b.type)).toEqual(['paragraph']);
    expect(result.plainText).toBe('เนื้อหา');
  });

  test('a leading thematic break that is not front matter stays a scene break', () => {
    const result = parse('---\n\nเนื้อหา');
    expect(result.stats.frontMatterStripped).toBe(false);
    expect(result.content.content[0]).toEqual({ type: 'sceneBreak' });
  });
});

describe('empty and whitespace input', () => {
  test.each(['', '   ', '\n\n\n'])('%p yields exactly one empty paragraph', (input) => {
    const out = blocks(input);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ type: 'paragraph', attrs: {}, content: [] });
  });

  test('an empty import reports no words', () => {
    expect(parse('').stats.wordCount).toBe(0);
  });
});

describe('the figures shown to the author before they accept', () => {
  const SAMPLE = [
    '# หัวข้อ',
    '',
    'ย่อหน้า',
    '',
    '***',
    '',
    '- item',
    '> quote',
  ].join('\n');

  test('counts each conversion', () => {
    const { stats } = parse(SAMPLE);
    expect(stats.headings).toBe(1);
    expect(stats.sceneBreaks).toBe(1);
    expect(stats.listItems).toBe(1);
    expect(stats.blockquoteLines).toBe(1);
  });

  test('word and character counts come from the same helpers the editor uses', () => {
    const result = parse('หนึ่ง สอง สาม');
    expect(result.stats.wordCount).toBe(3);
    expect(result.stats.characterCount).toBe(result.plainText.length);
  });

  test('plainText matches what the editor would derive from the document', () => {
    const result = parse(SAMPLE);
    expect(result.plainText).toBe(
      extractPlainTextFromTiptap(asTiptapDoc(result.content))
    );
  });

  test('every lossy conversion is described, so none is silent', () => {
    const notes = describeLossyConversions(parse(SAMPLE).stats);
    expect(notes.join(' ')).toMatch(/heading/);
    expect(notes.join(' ')).toMatch(/list item/);
    expect(notes.join(' ')).toMatch(/quoted line/);
  });

  test('a clean import reports nothing lost', () => {
    expect(describeLossyConversions(parse('ย่อหน้าเดียว').stats)).toEqual([]);
  });
});

// ===========================================================================
// A realistic file
// ===========================================================================

describe('a chapter draft written in Markdown', () => {
  const DRAFT = [
    '---',
    'status: draft',
    '---',
    '',
    '# สวนหลังบ้าน',
    '',
    'เธอหยุดอยู่ตรงนั้น แล้วมองย้อนกลับไปยังบ้านหลังเก่า',
    'ที่เคยเป็นของยาย ก่อนจะเดินต่อไป',
    '',
    '"เธอจะไปไหน" เสียงนั้นดังขึ้นจากด้านหลัง',
    '',
    '***',
    '',
    'ที่ร้านกาแฟตรงหัวมุมถนน เขานั่งรออยู่มาเกือบ **ชั่วโมง** แล้ว',
  ].join('\n');

  test('produces the blocks a reader would expect', () => {
    const out = blocks(DRAFT);
    expect(out.map((b) => b.type)).toEqual([
      'paragraph', // the heading, flattened
      'paragraph',
      'paragraph',
      'sceneBreak',
      'paragraph',
    ]);
  });

  test('the wrapped Thai sentence is rejoined without a stray space', () => {
    const out = blocks(DRAFT);
    expect(textOf(out[1])).toBe(
      'เธอหยุดอยู่ตรงนั้น แล้วมองย้อนกลับไปยังบ้านหลังเก่าที่เคยเป็นของยาย ก่อนจะเดินต่อไป'
    );
  });

  test('is idempotent: importing the same file twice gives the same document', () => {
    expect(parse(DRAFT).content).toEqual(parse(DRAFT).content);
  });

  test('carriage returns from a Windows file make no difference', () => {
    expect(parse(DRAFT.replace(/\n/g, '\r\n')).content).toEqual(parse(DRAFT).content);
  });
});

describe('Round trip with this application\'s own Markdown export', () => {
  // The exporter writes a page break as an HTML comment and a scene header as
  // a one-line blockquote. Before this, both came back as visible prose.

  test('the page-break marker becomes a real page break node', () => {
    const out = blocks('before\n\n<!-- PAGE BREAK -->\n\nafter');
    expect(out.map((n) => n.type)).toEqual(['paragraph', 'pageBreak', 'paragraph']);
    expect(parse('<!-- PAGE BREAK -->').stats.pageBreaks).toBe(1);
  });

  test('the marker is never left as text', () => {
    const out = blocks('a\n\n<!-- PAGE BREAK -->\n\nb');
    expect(out.map(textOf).join(' ')).not.toContain('PAGE BREAK');
  });

  test('marker matching tolerates spacing and case', () => {
    for (const marker of ['<!-- PAGE BREAK -->', '<!--PAGE BREAK-->', '<!--  page break  -->']) {
      expect(blocks(marker).map((n) => n.type)).toContain('pageBreak');
    }
  });

  test('any other HTML comment is removed, not shown', () => {
    const result = parse('a\n\n<!-- an editor note -->\n\nb');
    expect(result.content.content.map(textOf).join(' ')).not.toContain('editor note');
    expect(result.stats.htmlCommentsDropped).toBe(1);
  });

  test('a comment inside a line of prose is stripped, the prose kept', () => {
    const out = blocks('the road <!-- check this --> went on');
    expect(textOf(out[0])).toBe('the road  went on');
    expect(parse('x <!-- c --> y').stats.htmlCommentsDropped).toBe(1);
  });

  test('a comment spanning several lines is removed whole', () => {
    const result = parse('a\n\n<!--\nnote line one\nnote line two\n-->\n\nb');
    const text = result.content.content.map(textOf).join(' ');
    expect(text).not.toContain('note line');
    expect(text).toContain('a');
    expect(text).toContain('b');
  });

  test('an unterminated comment stays as prose rather than eating the file', () => {
    const result = parse('a\n\n<!-- never closed\n\nb');
    const text = result.content.content.map(textOf).join(' ');
    expect(text).toContain('b');
  });

  test('a scene header blockquote becomes a sceneHeader node', () => {
    const out = blocks('> 18:30 — Bangkok');
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('sceneHeader');
    expect(out[0].attrs).toEqual({ timeText: '18:30', locationText: 'Bangkok' });
  });

  test('Thai locations survive in a scene header', () => {
    const out = blocks('> 18:30 — ลาดพร้าว 101');
    expect(out[0].attrs).toEqual({ timeText: '18:30', locationText: 'ลาดพร้าว 101' });
  });

  test('a bare clock time is a scene header', () => {
    const out = blocks('> 09:00');
    expect(out[0].type).toBe('sceneHeader');
    expect(out[0].attrs).toEqual({ timeText: '09:00', locationText: null });
  });

  test('an ordinary one-line quote stays a paragraph', () => {
    const out = blocks('> He said it would rain.');
    expect(out[0].type).toBe('paragraph');
    expect(textOf(out[0])).toBe('He said it would rain.');
  });

  test('a multi-line quote stays prose even if its first line looks like a header', () => {
    const out = blocks('> 18:30 — Bangkok\n> and then it rained');
    expect(out.every((n) => n.type !== 'sceneHeader')).toBe(true);
  });

  test('a quote continuing a paragraph is not a scene header', () => {
    const out = blocks('prose line\n> 18:30 — Bangkok');
    expect(out.every((n) => n.type !== 'sceneHeader')).toBe(true);
  });

  test('scene break then scene header keeps both, in order', () => {
    const out = blocks('a\n\n***\n\n> 18:30 — Bangkok\n\nb');
    expect(out.map((n) => n.type)).toEqual([
      'paragraph',
      'sceneBreak',
      'sceneHeader',
      'paragraph',
    ]);
  });

  test('a full exported chapter round-trips its breaks and headers', () => {
    const exported = [
      '# REDLINE LOVE',
      '',
      '## Volume 1 — Bangkok Nights',
      '',
      '### Chapter 1 — Redline',
      '',
      'เธอหยุดอยู่ตรงนั้น',
      '',
      '***',
      '',
      '> 18:30 — ลาดพร้าว 101',
      '',
      'after the header',
      '',
      '<!-- PAGE BREAK -->',
      '',
      'new page',
      '',
    ].join('\n');

    const result = parse(exported);
    const types = result.content.content.map((n) => n.type);

    expect(types).toContain('sceneBreak');
    expect(types).toContain('sceneHeader');
    expect(types).toContain('pageBreak');
    expect(result.content.content.map(textOf).join(' ')).not.toContain('PAGE BREAK');
    expect(result.stats.sceneHeaders).toBe(1);
    expect(result.stats.pageBreaks).toBe(1);
  });

  test('every emitted node type is one the manuscript schema allows', () => {
    const out = blocks('a\n\n***\n\n> 18:30 — B\n\n<!-- PAGE BREAK -->\n\nb');
    for (const node of out) {
      expect(SUPPORTED_NODE_TYPES).toContain(node.type);
    }
  });
});

describe('A chapter must fit in one Firestore document', () => {
  // The real limit on an import is not the .md file size but the variant
  // document it is saved into: Firestore caps a document at 1 MiB, and the
  // stored form is the Tiptap JSON plus a full plain-text copy.

  const bodyLine = 'เธอหยุดอยู่ตรงนั้น แล้วมองย้อนกลับไปยังถนนที่เพิ่งผ่านมา';
  const md = (n: number) => Array.from({ length: n }, () => bodyLine).join('\n\n');

  test('the budget leaves headroom under the hard Firestore limit', () => {
    expect(FIRESTORE_DOCUMENT_LIMIT_BYTES).toBe(1024 * 1024);
    expect(MAX_STORED_CONTENT_BYTES).toBeLessThan(FIRESTORE_DOCUMENT_LIMIT_BYTES);
  });

  test('the stored form is measured, not the source file', () => {
    const source = md(200);
    const result = parse(source);
    const stored = estimateStoredBytes(result.content, result.plainText);
    // Storing JSON plus a plain-text copy always costs more than the source.
    expect(stored).toBeGreaterThan(Buffer.byteLength(source, 'utf8'));
  });

  test('an ordinary chapter fits comfortably', () => {
    const result = parse(md(200));
    expect(checkStoredSize(result.content, result.plainText).fits).toBe(true);
  });

  test('an oversized import does not fit', () => {
    const result = parse(md(6000));
    const check = checkStoredSize(result.content, result.plainText);
    expect(check.fits).toBe(false);
    expect(check.bytes).toBeGreaterThan(check.limit);
  });

  test('appending counts what the chapter already holds', () => {
    const result = parse(md(200));
    const alone = checkStoredSize(result.content, result.plainText);
    expect(alone.fits).toBe(true);

    // The same import on top of an almost-full chapter no longer fits.
    const nearlyFull = MAX_STORED_CONTENT_BYTES - 1000;
    expect(checkStoredSize(result.content, result.plainText, nearlyFull).fits).toBe(false);
  });

  test('replacing ignores the existing content', () => {
    const result = parse(md(200));
    // existingBytes defaults to 0, which is what Replace passes.
    expect(checkStoredSize(result.content, result.plainText, 0).fits).toBe(true);
  });

  test('the reported size includes the existing content', () => {
    const result = parse(md(50));
    const withoutExisting = checkStoredSize(result.content, result.plainText).bytes;
    const withExisting = checkStoredSize(result.content, result.plainText, 5000).bytes;
    expect(withExisting).toBe(withoutExisting + 5000);
  });

  test('an empty import measures something small but non-zero', () => {
    const result = parse('');
    const bytes = estimateStoredBytes(result.content, result.plainText);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(1000);
  });

  test('Thai is measured in UTF-8 bytes, not characters', () => {
    const thai = parse('ก'.repeat(1000));
    const latin = parse('a'.repeat(1000));
    // Thai is three bytes per character in UTF-8, so it must measure larger.
    expect(estimateStoredBytes(thai.content, thai.plainText)).toBeGreaterThan(
      estimateStoredBytes(latin.content, latin.plainText)
    );
  });
});

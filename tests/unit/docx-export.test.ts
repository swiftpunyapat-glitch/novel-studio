import { describe, expect, test, beforeAll } from 'vitest';
import JSZip from 'jszip';
import { convertMillimetersToTwip } from 'docx';
import { generateDocxDocument, type ChapterExportData } from '@/lib/docx/generator';
import { UnsupportedNodeError } from '@/lib/editor/manuscript-schema';
import { DEFAULT_DOCUMENT_SETTINGS, type DocumentSettings } from '@/types/project';
import { cmToTwip, multiplierToLineTwip, ptToHalfPoints } from '@/lib/format/effective';

/**
 * Stage 3K — DOCX validation.
 *
 * These unzip the generated package and assert against the real OOXML, rather
 * than trusting the builder API.
 */

const settings: DocumentSettings = { ...DEFAULT_DOCUMENT_SETTINGS };

async function xmlOf(
  chapters: ChapterExportData[],
  s: DocumentSettings = settings
): Promise<{ document: string; styles: string }> {
  const buffer = await generateDocxDocument('REDLINE LOVE', s, chapters);
  const zip = await JSZip.loadAsync(buffer);
  return {
    document: await zip.file('word/document.xml')!.async('string'),
    styles: await zip.file('word/styles.xml')!.async('string'),
  };
}

function para(
  text: string,
  attrs: Record<string, unknown> = {},
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
) {
  return {
    type: 'paragraph',
    attrs,
    content: [{ type: 'text', text, ...(marks ? { marks } : {}) }],
  };
}

function chapter(content: unknown[]): ChapterExportData {
  return {
    chapterNumber: 5,
    title: 'The Long Road',
    subtitle: 'A beginning',
    dateText: '20 กันยายน 2568',
    locationText: 'ลาดพร้าว 101',
    content: { type: 'doc', content: content as never },
  };
}

describe('Page setup', () => {
  let document: string;
  beforeAll(async () => {
    ({ document } = await xmlOf([chapter([para('body')])]));
  });

  // Twip values are derived from the library's own converter rather than
  // hardcoded, so a rounding change upstream surfaces as a real failure
  // instead of a brittle expectation.
  test('A5 page size, 148 x 210 mm', () => {
    expect(document).toMatch(new RegExp(`w:w="${convertMillimetersToTwip(148)}"`));
    expect(document).toMatch(new RegExp(`w:h="${convertMillimetersToTwip(210)}"`));
    // Sanity-check the physical size is really A5, not merely self-consistent.
    expect(convertMillimetersToTwip(148)).toBeCloseTo((148 / 25.4) * 1440, -1);
    expect(convertMillimetersToTwip(210)).toBeCloseTo((210 / 25.4) * 1440, -1);
  });

  test('20mm margins on all four sides', () => {
    const mm20 = convertMillimetersToTwip(20);
    expect(document).toMatch(
      new RegExp(
        `w:top="${mm20}" w:right="${mm20}" w:bottom="${mm20}" w:left="${mm20}"`
      )
    );
  });

  test('per-side margins are honoured independently', async () => {
    const custom = {
      ...settings,
      margins: { topMm: 10, bottomMm: 30, leftMm: 25, rightMm: 15 },
    };
    const { document: doc } = await xmlOf([chapter([para('x')])], custom);
    expect(doc).toMatch(new RegExp(`w:top="${convertMillimetersToTwip(10)}"`));
    expect(doc).toMatch(new RegExp(`w:bottom="${convertMillimetersToTwip(30)}"`));
    expect(doc).toMatch(new RegExp(`w:left="${convertMillimetersToTwip(25)}"`));
    expect(doc).toMatch(new RegExp(`w:right="${convertMillimetersToTwip(15)}"`));
  });
});

describe('Document defaults', () => {
  test('the project font is the base font on every script slot, including complex script', async () => {
    const { styles } = await xmlOf([chapter([para('x')])]);
    const font = DEFAULT_DOCUMENT_SETTINGS.bodyFont;
    expect(font).toBe('TH Sarabun New');
    expect(styles).toMatch(new RegExp(`w:ascii="${font}"`));
    expect(styles).toMatch(new RegExp(`w:hAnsi="${font}"`));
    // w:cs is what Word uses to render Thai; without it Thai falls back.
    expect(styles).toMatch(new RegExp(`w:cs="${font}"`));
  });

  test('a stored CSS stack is reduced to the Word font name it names', async () => {
    // Legacy data could hold "TH Sarabun New, sans-serif". Word resolves the
    // whole string as one family, finds nothing, and substitutes silently.
    const legacy = { ...settings, bodyFont: "'TH Sarabun New', sans-serif" };
    const { styles, document } = await xmlOf([chapter([para('x')])], legacy);
    expect(styles).toMatch(/w:ascii="TH Sarabun New"/);
    expect(styles).not.toMatch(/sans-serif/);
    expect(document).not.toMatch(/sans-serif/);
  });

  test('16pt default is emitted as 32 half-points, with complex-script size', async () => {
    const { styles } = await xmlOf([chapter([para('x')])]);
    expect(styles).toMatch(/<w:sz w:val="32"\s*\/>/);
    expect(styles).toMatch(/<w:szCs w:val="32"\s*\/>/);
  });

  test('inherited paragraph carries 0.5cm first line, 0 before/after, line 259 auto', async () => {
    const { document } = await xmlOf([chapter([para('inherited paragraph')])]);
    expect(cmToTwip(0.5)).toBe(283);
    expect(multiplierToLineTwip(1.08)).toBe(259);
    expect(document).toMatch(/w:firstLine="283"/);
    expect(document).toMatch(/w:line="259"/);
    expect(document).toMatch(/w:lineRule="auto"/);
    expect(document).toMatch(/w:before="0"/);
    expect(document).toMatch(/w:after="0"/);
  });

  test('inherited paragraph is left aligned by default', async () => {
    const { document } = await xmlOf([chapter([para('x')])]);
    expect(document).toMatch(/<w:jc w:val="left"\s*\/>/);
  });
});

describe('Run formatting', () => {
  test('bold, italic, underline and strike are emitted', async () => {
    const { document } = await xmlOf([
      chapter([
        para('b', {}, [{ type: 'bold' }]),
        para('i', {}, [{ type: 'italic' }]),
        para('u', {}, [{ type: 'underline' }]),
        para('s', {}, [{ type: 'strike' }]),
      ]),
    ]);
    expect(document).toMatch(/<w:b\s*\/>/);
    expect(document).toMatch(/<w:i\s*\/>/);
    expect(document).toMatch(/<w:u w:val="single"\s*\/>/);
    expect(document).toMatch(/<w:strike\s*\/>/);
  });

  test('bold and italic also set their complex-script counterparts for Thai', async () => {
    const { document } = await xmlOf([
      chapter([para('ตัวหนา', {}, [{ type: 'bold' }, { type: 'italic' }])]),
    ]);
    expect(document).toMatch(/<w:bCs\s*\/>/);
    expect(document).toMatch(/<w:iCs\s*\/>/);
  });

  test('font family override reaches the run and its complex-script slot', async () => {
    const { document } = await xmlOf([
      chapter([
        para('georgia text', {}, [
          { type: 'textStyle', attrs: { fontFamily: 'Georgia' } },
        ]),
      ]),
    ]);
    expect(document).toMatch(/w:ascii="Georgia"/);
    expect(document).toMatch(/w:cs="Georgia"/);
  });

  test('font size override is emitted in half-points', async () => {
    const { document } = await xmlOf([
      chapter([para('big', {}, [{ type: 'textStyle', attrs: { fontSizePt: 24 } }])]),
    ]);
    expect(ptToHalfPoints(24)).toBe(48);
    expect(document).toMatch(/<w:sz w:val="48"\s*\/>/);
    expect(document).toMatch(/<w:szCs w:val="48"\s*\/>/);
  });

  test('a run with no overrides still gets the project font and size explicitly', async () => {
    const { document } = await xmlOf([chapter([para('plain')])]);
    expect(document).toMatch(
      new RegExp(`w:ascii="${DEFAULT_DOCUMENT_SETTINGS.bodyFont}"`)
    );
    expect(document).toMatch(/<w:sz w:val="32"\s*\/>/);
  });

  test.each(['Prompt', 'TH Sarabun New', 'Angsana New'])(
    '%s exports as a real Word font family name',
    async (font) => {
      const { document } = await xmlOf([
        chapter([para('x', {}, [{ type: 'textStyle', attrs: { fontFamily: font } }])]),
      ]);
      expect(document).toMatch(new RegExp(`w:ascii="${font}"`));
      // Complex script is the slot Word uses for Thai.
      expect(document).toMatch(new RegExp(`w:cs="${font}"`));
    }
  );

  test('16 pt is 32 half-points, in the document body as well as the styles', async () => {
    // OOXML measures font size in half-points, so a 16 pt manuscript must
    // write 32 — not 16, which Word would render as 8 pt.
    expect(ptToHalfPoints(16)).toBe(32);
    const { document, styles } = await xmlOf([chapter([para('plain')])]);
    expect(styles).toMatch(/<w:sz w:val="32"\s*\/>/);
    expect(document).toMatch(/<w:sz w:val="32"\s*\/>/);
    expect(document).toMatch(/<w:szCs w:val="32"\s*\/>/);
  });
});

describe('Paragraph overrides', () => {
  test('alignment override is honoured, not hardcoded to left', async () => {
    const { document } = await xmlOf([
      chapter([
        para('c', { textAlignOverride: 'center' }),
        para('r', { textAlignOverride: 'right' }),
        para('j', { textAlignOverride: 'justify' }),
      ]),
    ]);
    expect(document).toMatch(/<w:jc w:val="center"\s*\/>/);
    expect(document).toMatch(/<w:jc w:val="right"\s*\/>/);
    expect(document).toMatch(/<w:jc w:val="both"\s*\/>/);
  });

  test('first-line indent override, including an explicit zero', async () => {
    const { document } = await xmlOf([
      chapter([
        para('deep', { firstLineIndentCmOverride: 2 }),
        para('flush', { firstLineIndentCmOverride: 0 }),
      ]),
    ]);
    expect(document).toMatch(new RegExp(`w:firstLine="${cmToTwip(2)}"`));
    expect(document).toMatch(/w:firstLine="0"/);
  });

  test('left and right indent overrides', async () => {
    const { document } = await xmlOf([
      chapter([para('inset', { leftIndentCmOverride: 1.5, rightIndentCmOverride: 1 })]),
    ]);
    expect(document).toMatch(new RegExp(`w:left="${cmToTwip(1.5)}"`));
    expect(document).toMatch(new RegExp(`w:right="${cmToTwip(1)}"`));
  });

  test('paragraph spacing before/after overrides in twentieths of a point', async () => {
    const { document } = await xmlOf([
      chapter([para('spaced', { spaceBeforePtOverride: 12, spaceAfterPtOverride: 6 })]),
    ]);
    expect(document).toMatch(/w:before="240"/);
    expect(document).toMatch(/w:after="120"/);
  });

  test('line spacing override maps through the 240 formula', async () => {
    const { document } = await xmlOf([
      chapter([para('wide', { lineSpacingOverride: 1.5 })]),
    ]);
    expect(multiplierToLineTwip(1.5)).toBe(360);
    expect(document).toMatch(/w:line="360"/);
  });
});

describe('Semantic breaks', () => {
  test('page break becomes a real OOXML page break', async () => {
    const { document } = await xmlOf([
      chapter([para('before'), { type: 'pageBreak' }, para('after')]),
    ]);
    expect(document).toMatch(/<w:br w:type="page"\s*\/>/);
  });

  test('scene break uses the project symbol', async () => {
    const { document } = await xmlOf([
      chapter([para('a'), { type: 'sceneBreak' }, para('b')]),
    ]);
    expect(document).toContain('***');
    expect(document).toMatch(/NovelSceneBreak/);
  });

  test('scene header exports its time and location through a named style', async () => {
    const { document, styles } = await xmlOf([
      chapter([
        para('a'),
        { type: 'sceneBreak' },
        { type: 'sceneHeader', attrs: { timeText: '18:30', locationText: 'ลาดพร้าว 101' } },
        para('b'),
      ]),
    ]);
    expect(styles).toContain('NovelSceneHeader');
    expect(document).toContain('NovelSceneHeader');
    expect(document).toContain('18:30 — ลาดพร้าว 101');
  });

  test.each([
    [{ timeText: '18:30', locationText: null }, '18:30'],
    [{ timeText: null, locationText: 'Bangkok' }, 'Bangkok'],
  ])('a scene header with only one field exports just that field', async (attrs, expected) => {
    const { document } = await xmlOf([
      chapter([{ type: 'sceneBreak' }, { type: 'sceneHeader', attrs }]),
    ]);
    // Scoped to the scene header paragraph: the chapter metadata line above it
    // legitimately contains the same separator.
    const headerParagraph = /<w:p><w:pPr><w:pStyle w:val="NovelSceneHeader"\/>[\s\S]*?<\/w:p>/.exec(
      document
    );
    expect(headerParagraph).not.toBeNull();
    expect(headerParagraph![0]).toContain(expected);
    expect(headerParagraph![0]).not.toContain(' — ');
  });

  test('an empty scene header emits no paragraph at all', async () => {
    const { document } = await xmlOf([
      chapter([{ type: 'sceneBreak' }, { type: 'sceneHeader', attrs: {} }]),
    ]);
    expect(document).not.toContain('NovelSceneHeader');
  });

  test('a document with only a scene break still exports (backward compatible)', async () => {
    const { document } = await xmlOf([chapter([para('a'), { type: 'sceneBreak' }, para('b')])]);
    expect(document).toContain('***');
    expect(document).not.toContain('NovelSceneHeader');
  });

  test('a custom scene break symbol is used', async () => {
    const custom = { ...settings, sceneBreakSymbol: '§ § §' };
    const { document } = await xmlOf(
      [chapter([{ type: 'sceneBreak' }])],
      custom
    );
    expect(document).toContain('§ § §');
  });

  test('hard break becomes a line break inside the paragraph', async () => {
    const { document } = await xmlOf([
      chapter([
        {
          type: 'paragraph',
          attrs: {},
          content: [
            { type: 'text', text: 'line one' },
            { type: 'hardBreak' },
            { type: 'text', text: 'line two' },
          ],
        },
      ]),
    ]);
    expect(document).toMatch(/<w:br\s*\/>/);
    expect(document).toContain('line one');
    expect(document).toContain('line two');
  });
});

describe('Chapter metadata (Stage 3I)', () => {
  test('metadata is rendered through named styles, not ad-hoc formatting', async () => {
    const { document, styles } = await xmlOf([chapter([para('body')])]);
    for (const id of [
      'NovelChapterNumber',
      'NovelChapterTitle',
      'NovelChapterSubtitle',
      'NovelChapterContext',
    ]) {
      expect(styles).toContain(id);
      expect(document).toContain(id);
    }
  });

  test('metadata values come from the Chapter model', async () => {
    const { document } = await xmlOf([chapter([para('body')])]);
    expect(document).toContain('CHAPTER 5');
    expect(document).toContain('The Long Road');
    expect(document).toContain('A beginning');
    expect(document).toContain('20 กันยายน 2568');
    expect(document).toContain('ลาดพร้าว 101');
  });

  test('a chapter with no number omits the number paragraph', async () => {
    const { document } = await xmlOf([
      { ...chapter([para('body')]), chapterNumber: null },
    ]);
    expect(document).not.toContain('CHAPTER');
  });

  test('multiple chapters are separated by a page break', async () => {
    const { document } = await xmlOf([
      chapter([para('one')]),
      { ...chapter([para('two')]), title: 'Second' },
    ]);
    expect(document).toMatch(/<w:br w:type="page"\s*\/>/);
    expect(document).toContain('Second');
  });
});

describe('Thai text', () => {
  test('Thai prose with tone marks survives the round trip', async () => {
    const thai = 'เธอหยุดอยู่ตรงนั้น แล้วมองย้อนกลับไป';
    const { document } = await xmlOf([chapter([para(thai)])]);
    expect(document).toContain(thai);
  });
});

describe('Unsupported nodes fail loudly (Stage 3F)', () => {
  test.each([
    'bulletList',
    'orderedList',
    'listItem',
    'blockquote',
    'codeBlock',
    'horizontalRule',
    'image',
    'table',
  ])('%s throws UnsupportedNodeError instead of exporting empty', async (type) => {
    await expect(
      generateDocxDocument('X', settings, [
        chapter([{ type, content: [{ type: 'text', text: 'lost content' }] }]),
      ])
    ).rejects.toThrow(UnsupportedNodeError);
  });

  test('the error names the node and its path', async () => {
    await expect(
      generateDocxDocument('X', settings, [chapter([para('ok'), { type: 'bulletList' }])])
    ).rejects.toThrow(/bulletList.*chapter\[0\]\/content\[1\]/s);
  });

  test('an unsupported inline node inside a paragraph also throws', async () => {
    await expect(
      generateDocxDocument('X', settings, [
        chapter([
          {
            type: 'paragraph',
            attrs: {},
            content: [{ type: 'image', attrs: { src: 'x.png' } }],
          },
        ]),
      ])
    ).rejects.toThrow(UnsupportedNodeError);
  });

  test('content is never silently dropped: a known-good doc still exports', async () => {
    const buffer = await generateDocxDocument('X', settings, [chapter([para('kept')])]);
    const zip = await JSZip.loadAsync(buffer);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('kept');
  });
});

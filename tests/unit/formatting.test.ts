import { describe, expect, test } from 'vitest';
import JSZip from 'jszip';
import {
  resolveParagraphFormat,
  resolveRunFormat,
  readParagraphOverrides,
  documentSettingsToCssVars,
  paragraphOverrideStyle,
  cmToTwip,
  ptToTwip,
  ptToHalfPoints,
  multiplierToLineTwip,
  EMPTY_PARAGRAPH_OVERRIDES,
} from '@/lib/format/effective';
import {
  normalizeManuscriptDoc,
  needsNormalization,
  LEGACY_DEFAULT_LINE_SPACING,
} from '@/lib/format/normalize';
import { generateDocxDocument } from '@/lib/docx/generator';
import { DEFAULT_DOCUMENT_SETTINGS, type DocumentSettings } from '@/types/project';

const base: DocumentSettings = { ...DEFAULT_DOCUMENT_SETTINGS };

function para(attrs: Record<string, unknown> = {}, text = 'x') {
  return { type: 'paragraph', attrs, content: [{ type: 'text', text }] };
}

// ---------------------------------------------------------------------------
// Stage 3A / 3G — resolver
// ---------------------------------------------------------------------------

describe('Effective paragraph formatting', () => {
  test('an empty paragraph inherits every project default', () => {
    const f = resolveParagraphFormat({}, base);
    expect(f).toEqual({
      alignment: 'left',
      firstLineIndentCm: 0.5,
      leftIndentCm: 0,
      rightIndentCm: 0,
      spaceBeforePt: 0,
      spaceAfterPt: 0,
      lineSpacingMultiplier: 1.08,
    });
  });

  test('an explicit override wins over the project default', () => {
    const f = resolveParagraphFormat({ lineSpacingOverride: 1.5 }, base);
    expect(f.lineSpacingMultiplier).toBe(1.5);
  });

  test('zero is a real override, not "absent"', () => {
    const f = resolveParagraphFormat({ firstLineIndentCmOverride: 0 }, base);
    expect(f.firstLineIndentCm).toBe(0);
  });

  test('null explicitly means inherit', () => {
    const f = resolveParagraphFormat({ ...EMPTY_PARAGRAPH_OVERRIDES }, base);
    expect(f.firstLineIndentCm).toBe(base.firstLineIndentCm);
  });

  test('malformed values fall back to inherit rather than corrupting output', () => {
    const f = resolveParagraphFormat(
      { lineSpacingOverride: 'huge', textAlignOverride: 'diagonal', spaceBeforePtOverride: NaN },
      base
    );
    expect(f.lineSpacingMultiplier).toBe(1.08);
    expect(f.alignment).toBe('left');
    expect(f.spaceBeforePt).toBe(0);
  });
});

describe('Effective run formatting', () => {
  test('no marks inherits project font and size', () => {
    const f = resolveRunFormat([], base);
    expect(f.fontFamily).toBe('Sarabun');
    expect(f.fontSizePt).toBe(16);
    expect(f.bold).toBe(false);
  });

  test('textStyle overrides win', () => {
    const f = resolveRunFormat(
      [{ type: 'textStyle', attrs: { fontFamily: 'Georgia', fontSizePt: 24 } }],
      base
    );
    expect(f.fontFamily).toBe('Georgia');
    expect(f.fontSizePt).toBe(24);
  });

  test('emphasis marks are detected', () => {
    const f = resolveRunFormat(
      [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }, { type: 'strike' }],
      base
    );
    expect(f).toMatchObject({ bold: true, italic: true, underline: true, strike: true });
  });
});

describe('Unit conversions', () => {
  test('cm to twips', () => {
    expect(cmToTwip(0.5)).toBe(283);
    expect(cmToTwip(0)).toBe(0);
  });
  test('pt to twips', () => {
    expect(ptToTwip(12)).toBe(240);
  });
  test('pt to half-points', () => {
    expect(ptToHalfPoints(16)).toBe(32);
  });
  test('multiple line spacing uses the 240 formula', () => {
    expect(multiplierToLineTwip(1.08)).toBe(259);
    expect(multiplierToLineTwip(1)).toBe(240);
    expect(multiplierToLineTwip(2)).toBe(480);
  });
});

// ---------------------------------------------------------------------------
// REGRESSION: changing a project default must move inheritors only
// ---------------------------------------------------------------------------

describe('Inheritance regression — project default changes', () => {
  const inheriting = para({});
  const overridden = (attrs: Record<string, unknown>) => para(attrs);

  test('line spacing: 1.08 -> 1.15 moves A, leaves B at 1.5', () => {
    const A = inheriting;
    const B = overridden({ lineSpacingOverride: 1.5 });

    expect(resolveParagraphFormat(A.attrs, base).lineSpacingMultiplier).toBe(1.08);
    expect(resolveParagraphFormat(B.attrs, base).lineSpacingMultiplier).toBe(1.5);

    const changed: DocumentSettings = { ...base, lineSpacingMultiplier: 1.15 };
    expect(resolveParagraphFormat(A.attrs, changed).lineSpacingMultiplier).toBe(1.15);
    expect(resolveParagraphFormat(B.attrs, changed).lineSpacingMultiplier).toBe(1.5);
  });

  test('font family: Sarabun -> Georgia moves A, leaves B at Tahoma', () => {
    const A: Array<{ type: string; attrs?: Record<string, unknown> }> = [];
    const B = [{ type: 'textStyle', attrs: { fontFamily: 'Tahoma' } }];

    expect(resolveRunFormat(A, base).fontFamily).toBe('Sarabun');
    const changed: DocumentSettings = { ...base, bodyFont: 'Georgia' };
    expect(resolveRunFormat(A, changed).fontFamily).toBe('Georgia');
    expect(resolveRunFormat(B, changed).fontFamily).toBe('Tahoma');
  });

  test('font size: 16 -> 18 moves A, leaves B at 24', () => {
    const A: Array<{ type: string; attrs?: Record<string, unknown> }> = [];
    const B = [{ type: 'textStyle', attrs: { fontSizePt: 24 } }];

    const changed: DocumentSettings = { ...base, bodyFontSizePt: 18 };
    expect(resolveRunFormat(A, changed).fontSizePt).toBe(18);
    expect(resolveRunFormat(B, changed).fontSizePt).toBe(24);
  });

  test('first-line indent: 0.5 -> 1.0 moves A, leaves B at 2', () => {
    const A = inheriting;
    const B = overridden({ firstLineIndentCmOverride: 2 });

    const changed: DocumentSettings = { ...base, firstLineIndentCm: 1 };
    expect(resolveParagraphFormat(A.attrs, changed).firstLineIndentCm).toBe(1);
    expect(resolveParagraphFormat(B.attrs, changed).firstLineIndentCm).toBe(2);
  });

  test('paragraph spacing: 0 -> 6 moves A, leaves B at 12', () => {
    const A = inheriting;
    const B = overridden({ spaceBeforePtOverride: 12, spaceAfterPtOverride: 12 });

    const changed: DocumentSettings = {
      ...base,
      paragraphSpacingBeforePt: 6,
      paragraphSpacingAfterPt: 6,
    };
    expect(resolveParagraphFormat(A.attrs, changed).spaceBeforePt).toBe(6);
    expect(resolveParagraphFormat(B.attrs, changed).spaceAfterPt).toBe(12);
  });

  test('alignment: left -> justify moves A, leaves B centered', () => {
    const A = inheriting;
    const B = overridden({ textAlignOverride: 'center' });

    const changed: DocumentSettings = { ...base, paragraphAlignment: 'justify' };
    expect(resolveParagraphFormat(A.attrs, changed).alignment).toBe('justify');
    expect(resolveParagraphFormat(B.attrs, changed).alignment).toBe('center');
  });

  test('the same inheritance holds end-to-end through DOCX export', async () => {
    const chapters = [
      {
        chapterNumber: 1,
        title: 'T',
        content: {
          type: 'doc',
          content: [para({}, 'inherits'), para({ lineSpacingOverride: 1.5 }, 'overridden')],
        },
      },
    ];

    async function lineValues(s: DocumentSettings): Promise<string[]> {
      const buf = await generateDocxDocument('X', s, chapters as never);
      const zip = await JSZip.loadAsync(buf);
      const xml = await zip.file('word/document.xml')!.async('string');
      return Array.from(xml.matchAll(/w:line="(\d+)"/g)).map((m) => m[1]);
    }

    const before = await lineValues(base);
    expect(before).toContain(String(multiplierToLineTwip(1.08)));
    expect(before).toContain(String(multiplierToLineTwip(1.5)));

    const after = await lineValues({ ...base, lineSpacingMultiplier: 1.15 });
    expect(after).toContain(String(multiplierToLineTwip(1.15)));
    expect(after).toContain(String(multiplierToLineTwip(1.5)));
    // The inheriting paragraph moved; nothing is pinned at the old default.
    expect(after).not.toContain(String(multiplierToLineTwip(1.08)));
  });
});

// ---------------------------------------------------------------------------
// Stage 3B — legacy normalization
// ---------------------------------------------------------------------------

describe('Legacy normalization', () => {
  const legacyDoc = {
    type: 'doc',
    content: [
      para({ textAlign: null, noIndent: false, lineSpacing: LEGACY_DEFAULT_LINE_SPACING }, 'a'),
      para({ textAlign: 'center', noIndent: true, lineSpacing: 1.5 }, 'b'),
    ],
  };

  test('baked historical default line spacing becomes inherit', () => {
    const { doc } = normalizeManuscriptDoc(legacyDoc);
    expect(doc.content[0].attrs.lineSpacingOverride).toBeNull();
  });

  test('baked noIndent:false becomes inherit', () => {
    const { doc } = normalizeManuscriptDoc(legacyDoc);
    expect(doc.content[0].attrs.firstLineIndentCmOverride).toBeNull();
  });

  test('null alignment stays inherit', () => {
    const { doc } = normalizeManuscriptDoc(legacyDoc);
    expect(doc.content[0].attrs.textAlignOverride).toBeNull();
  });

  test('a genuine non-default line spacing is preserved', () => {
    const { doc } = normalizeManuscriptDoc(legacyDoc);
    expect(doc.content[1].attrs.lineSpacingOverride).toBe(1.5);
  });

  test('noIndent:true becomes an explicit zero first-line indent', () => {
    const { doc } = normalizeManuscriptDoc(legacyDoc);
    expect(doc.content[1].attrs.firstLineIndentCmOverride).toBe(0);
  });

  test('an explicit alignment is preserved', () => {
    const { doc } = normalizeManuscriptDoc(legacyDoc);
    expect(doc.content[1].attrs.textAlignOverride).toBe('center');
  });

  test('legacy attribute keys are removed', () => {
    const { doc } = normalizeManuscriptDoc(legacyDoc);
    for (const p of doc.content) {
      expect(p.attrs).not.toHaveProperty('lineSpacing');
      expect(p.attrs).not.toHaveProperty('noIndent');
      expect(p.attrs).not.toHaveProperty('textAlign');
    }
  });

  test('normalization is idempotent', () => {
    const once = normalizeManuscriptDoc(legacyDoc).doc;
    const twice = normalizeManuscriptDoc(once).doc;
    expect(twice).toEqual(once);
    expect(normalizeManuscriptDoc(once).changed).toBe(false);
  });

  test('the input document is not mutated', () => {
    const input = JSON.parse(JSON.stringify(legacyDoc));
    normalizeManuscriptDoc(input);
    expect(input.content[0].attrs).toHaveProperty('lineSpacing');
  });

  test('already-normalized content passes through untouched', () => {
    const modern = { type: 'doc', content: [para({ lineSpacingOverride: 2 }, 'x')] };
    const { doc, changed } = normalizeManuscriptDoc(modern);
    expect(changed).toBe(false);
    expect(doc.content[0].attrs.lineSpacingOverride).toBe(2);
  });

  test('unrelated attributes are carried through', () => {
    const withExtra = {
      type: 'doc',
      content: [para({ lineSpacing: 1.08, customThing: 'keep me' }, 'x')],
    };
    const { doc } = normalizeManuscriptDoc(withExtra);
    expect(doc.content[0].attrs.customThing).toBe('keep me');
  });

  test('nested content is normalized recursively', () => {
    const nested = {
      type: 'doc',
      content: [{ type: 'wrapper', content: [para({ lineSpacing: 1.5 }, 'deep')] }],
    };
    const { doc } = normalizeManuscriptDoc(nested);
    expect(doc.content[0].content[0].attrs.lineSpacingOverride).toBe(1.5);
  });

  test('needsNormalization detects legacy and modern content correctly', () => {
    expect(needsNormalization(legacyDoc)).toBe(true);
    expect(needsNormalization(normalizeManuscriptDoc(legacyDoc).doc)).toBe(false);
    expect(needsNormalization(null)).toBe(false);
  });

  test('stats report what was converted', () => {
    const { stats } = normalizeManuscriptDoc(legacyDoc);
    expect(stats.paragraphsVisited).toBe(2);
    expect(stats.bakedLineSpacingCleared).toBe(1);
    expect(stats.explicitLineSpacingPreserved).toBe(1);
    expect(stats.explicitAlignmentPreserved).toBe(1);
  });

  test('normalized legacy content then follows a project default change', () => {
    const { doc } = normalizeManuscriptDoc(legacyDoc);
    const changed: DocumentSettings = { ...base, lineSpacingMultiplier: 1.15 };
    // Paragraph A was baked at 1.08; after normalization it inherits.
    expect(resolveParagraphFormat(doc.content[0].attrs, changed).lineSpacingMultiplier).toBe(1.15);
    // Paragraph B keeps its genuine override.
    expect(resolveParagraphFormat(doc.content[1].attrs, changed).lineSpacingMultiplier).toBe(1.5);
  });
});

// ---------------------------------------------------------------------------
// Stage 3C — CSS variables
// ---------------------------------------------------------------------------

describe('Editor CSS variables', () => {
  test('every required variable is published', () => {
    const vars = documentSettingsToCssVars(base);
    for (const key of [
      '--novel-font-family',
      '--novel-font-size',
      '--novel-line-spacing',
      '--novel-first-line-indent',
      '--novel-paragraph-before',
      '--novel-paragraph-after',
      '--novel-left-indent',
      '--novel-right-indent',
    ]) {
      expect(vars).toHaveProperty(key);
    }
  });

  test('variables reflect the project settings', () => {
    const vars = documentSettingsToCssVars({
      ...base,
      bodyFontSizePt: 18,
      lineSpacingMultiplier: 1.15,
      firstLineIndentCm: 1,
    });
    expect(vars['--novel-font-size']).toBe('18pt');
    expect(vars['--novel-line-spacing']).toBe('1.15');
    expect(vars['--novel-first-line-indent']).toBe('1cm');
  });

  test('no colour is ever emitted as manuscript formatting', () => {
    const vars = documentSettingsToCssVars(base);
    const joined = Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');
    expect(joined).not.toMatch(/color|#[0-9a-f]{3,6}|rgb/i);
  });

  test('an inheriting paragraph emits no inline style at all', () => {
    expect(paragraphOverrideStyle({ ...EMPTY_PARAGRAPH_OVERRIDES })).toEqual({});
  });

  test('an overridden paragraph emits only the properties it set', () => {
    const style = paragraphOverrideStyle({
      ...EMPTY_PARAGRAPH_OVERRIDES,
      lineSpacingOverride: 1.5,
      textAlignOverride: 'center',
    });
    expect(style).toEqual({ lineHeight: '1.5', textAlign: 'center' });
  });

  test('an explicit zero indent still emits a declaration', () => {
    const style = paragraphOverrideStyle({
      ...EMPTY_PARAGRAPH_OVERRIDES,
      firstLineIndentCmOverride: 0,
    });
    expect(style.textIndent).toBe('0cm');
  });
});

describe('readParagraphOverrides', () => {
  test('defaults to all-null for missing attrs', () => {
    expect(readParagraphOverrides(undefined)).toEqual(EMPTY_PARAGRAPH_OVERRIDES);
  });
});

import { describe, expect, test } from 'vitest';

import {
  MANUSCRIPT_FONTS,
  DEFAULT_BODY_FONT,
  canonicalFontName,
  fontCssStack,
  fontOptions,
  isKnownFont,
} from '@/lib/editor/fonts';
import {
  decideSelectAll,
  isNativeTextField,
  isSelectAllChord,
} from '@/lib/editor/select-all';
import {
  SCENE_HEADER_SEPARATOR,
  isEmptySceneHeader,
  normalizeSceneHeaderAttrs,
  normalizeSceneHeaderField,
  sceneHeaderToText,
} from '@/lib/editor/scene-header';
import {
  computePageSpacers,
  paginatedHeightPx,
  spacerSignature,
  type PaginationBlock,
} from '@/lib/editor/pagination';
import {
  DISPLAY_SPACING_VALUES,
  resolveDisplayLineSpacing,
  usesDisplaySpacing,
} from '@/lib/editor/display-preferences';
import { extractPlainTextFromTiptap } from '@/lib/editor/plain-text';
import { renderTiptapToSafeHtml, renderTiptapToPlainText } from '@/lib/publishing/render';
import { DEFAULT_DOCUMENT_SETTINGS } from '@/types/project';
import { SUPPORTED_NODE_TYPES } from '@/lib/editor/manuscript-schema';

/**
 * Stage 4 — editor usability bundle.
 *
 * Everything under test here is pure by design. The DOM-facing pieces
 * (the sticky toolbar, the Page View plugin's measuring, the delete dialogs)
 * are thin wrappers around these functions precisely so the decisions can be
 * pinned down without a browser.
 */

// ===========================================================================
// Fonts (Stage 4A)
// ===========================================================================

describe('Manuscript font catalogue', () => {
  test('offers exactly the three V1 fonts, in canonical Word spelling', () => {
    expect(MANUSCRIPT_FONTS.map((f) => f.docxName)).toEqual([
      'Prompt',
      'TH Sarabun New',
      'Angsana New',
    ]);
  });

  test('a stored font name is never a CSS stack', () => {
    for (const font of MANUSCRIPT_FONTS) {
      expect(font.docxName).not.toContain(',');
      expect(font.docxName).not.toContain("'");
      expect(font.docxName).not.toMatch(/sans-serif|serif|monospace/);
    }
  });

  test('new projects default to TH Sarabun New', () => {
    expect(DEFAULT_BODY_FONT).toBe('TH Sarabun New');
    expect(DEFAULT_DOCUMENT_SETTINGS.bodyFont).toBe('TH Sarabun New');
  });

  describe('canonicalFontName', () => {
    test('passes a plain family name through unchanged', () => {
      expect(canonicalFontName('TH Sarabun New')).toBe('TH Sarabun New');
    });

    test('reduces a CSS stack to its first real family', () => {
      expect(canonicalFontName("'TH Sarabun New', sans-serif")).toBe('TH Sarabun New');
      expect(canonicalFontName('"Angsana New", AngsanaUPC, serif')).toBe('Angsana New');
      expect(canonicalFontName('Prompt, sans-serif')).toBe('Prompt');
    });

    test('skips a leading generic keyword rather than exporting it as a font', () => {
      expect(canonicalFontName('sans-serif, Prompt')).toBe('Prompt');
    });

    test('returns null when there is no usable family name', () => {
      expect(canonicalFontName('')).toBeNull();
      expect(canonicalFontName('   ')).toBeNull();
      expect(canonicalFontName('serif')).toBeNull();
      expect(canonicalFontName(null)).toBeNull();
      expect(canonicalFontName(undefined)).toBeNull();
    });
  });

  describe('fontCssStack', () => {
    test('gives each offered font a display stack with fallbacks', () => {
      for (const font of MANUSCRIPT_FONTS) {
        const stack = fontCssStack(font.docxName);
        expect(stack).toContain(font.docxName);
        expect(stack).toContain(',');
      }
    });

    test('TH Sarabun New falls back to Sarabun for machines without it', () => {
      expect(fontCssStack('TH Sarabun New')).toContain('Sarabun');
    });

    test('a font dropped from the catalogue still displays as itself', () => {
      // Narrowing the picker must not silently restyle existing manuscripts.
      expect(fontCssStack('Georgia')).toContain('Georgia');
      expect(fontCssStack('Tahoma')).toContain('Tahoma');
      expect(fontCssStack('Sarabun')).toContain('Sarabun');
    });

    test('an entirely unknown font is honoured, quoted, with a safe tail', () => {
      expect(fontCssStack('Some Private Face')).toContain("'Some Private Face'");
    });
  });

  describe('fontOptions', () => {
    test('lists the three fonts when the current one is offered', () => {
      expect(fontOptions('Prompt').map((o) => o.value)).toEqual([
        'Prompt',
        'TH Sarabun New',
        'Angsana New',
      ]);
    });

    test('appends the current font when it predates the narrowing', () => {
      const options = fontOptions('Georgia');
      expect(options).toHaveLength(4);
      expect(options[3]).toEqual({ value: 'Georgia', label: 'Georgia (current)' });
    });

    test('a legacy CSS stack is offered under its canonical name', () => {
      const options = fontOptions("'Sarabun', sans-serif");
      expect(options[3].value).toBe('Sarabun');
    });
  });

  test('isKnownFont only accepts the offered three', () => {
    expect(isKnownFont('Prompt')).toBe(true);
    expect(isKnownFont('Angsana New')).toBe(true);
    expect(isKnownFont('Georgia')).toBe(false);
  });
});

// ===========================================================================
// Ctrl/Cmd+A (Stage 4B)
// ===========================================================================

describe('Ctrl/Cmd+A routing', () => {
  const chord = (over: Partial<Parameters<typeof isSelectAllChord>[0]> = {}) => ({
    key: 'a',
    ctrlKey: true,
    metaKey: false,
    ...over,
  });

  test('recognises Ctrl+A and Cmd+A, in either case', () => {
    expect(isSelectAllChord(chord())).toBe(true);
    expect(isSelectAllChord(chord({ ctrlKey: false, metaKey: true }))).toBe(true);
    expect(isSelectAllChord(chord({ key: 'A' }))).toBe(true);
  });

  test('ignores a bare A, and Alt chords', () => {
    expect(isSelectAllChord(chord({ ctrlKey: false }))).toBe(false);
    expect(isSelectAllChord(chord({ altKey: true }))).toBe(false);
    expect(isSelectAllChord(chord({ key: 's' }))).toBe(false);
  });

  test('identifies fields whose native Ctrl+A must keep working', () => {
    expect(isNativeTextField({ tagName: 'INPUT' })).toBe(true);
    expect(isNativeTextField({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isNativeTextField({ tagName: 'SELECT' })).toBe(true);
    expect(isNativeTextField({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isNativeTextField({ tagName: 'DIV' })).toBe(false);
    expect(isNativeTextField(null)).toBe(false);
  });

  test('a non-chord keystroke is ignored entirely', () => {
    expect(
      decideSelectAll({
        chord: false,
        targetIsNativeTextField: false,
        targetIsInsideManuscript: false,
      })
    ).toBe('ignore');
  });

  test('a rename box, metadata field or dialog input keeps native Ctrl+A', () => {
    expect(
      decideSelectAll({
        chord: true,
        targetIsNativeTextField: true,
        targetIsInsideManuscript: false,
      })
    ).toBe('native');
  });

  test('inside the editor, ProseMirror’s own keymap is left to handle it', () => {
    expect(
      decideSelectAll({
        chord: true,
        targetIsNativeTextField: false,
        targetIsInsideManuscript: true,
      })
    ).toBe('native');
  });

  test('focus on the paper but outside the editor selects the manuscript', () => {
    // The reported bug: the browser would otherwise select the whole page,
    // sidebar and toolbar included.
    expect(
      decideSelectAll({
        chord: true,
        targetIsNativeTextField: false,
        targetIsInsideManuscript: false,
      })
    ).toBe('select-manuscript');
  });

  test('a field inside the editor still wins over the manuscript', () => {
    expect(
      decideSelectAll({
        chord: true,
        targetIsNativeTextField: true,
        targetIsInsideManuscript: true,
      })
    ).toBe('native');
  });
});

// ===========================================================================
// Scene header (Stage 4C)
// ===========================================================================

describe('Scene header', () => {
  test('is part of the manuscript schema contract', () => {
    expect(SUPPORTED_NODE_TYPES).toContain('sceneHeader');
    expect(SUPPORTED_NODE_TYPES).toContain('sceneBreak');
  });

  test('blank and whitespace-only fields normalise to null, never ""', () => {
    expect(normalizeSceneHeaderField('')).toBeNull();
    expect(normalizeSceneHeaderField('   ')).toBeNull();
    expect(normalizeSceneHeaderField(undefined)).toBeNull();
    expect(normalizeSceneHeaderField('  18:30 ')).toBe('18:30');
  });

  test('either field may be present on its own', () => {
    expect(normalizeSceneHeaderAttrs({ timeText: '18:30' })).toEqual({
      timeText: '18:30',
      locationText: null,
    });
    expect(normalizeSceneHeaderAttrs({ locationText: 'Bangkok' })).toEqual({
      timeText: null,
      locationText: 'Bangkok',
    });
  });

  test('joins the two fields the same way everywhere', () => {
    expect(sceneHeaderToText({ timeText: '18:30', locationText: 'Bangkok' })).toBe(
      `18:30${SCENE_HEADER_SEPARATOR}Bangkok`
    );
    expect(sceneHeaderToText({ timeText: '18:30' })).toBe('18:30');
    expect(sceneHeaderToText({ locationText: 'Bangkok' })).toBe('Bangkok');
    expect(sceneHeaderToText({})).toBe('');
  });

  test('an empty header is recognised so it is never inserted', () => {
    expect(isEmptySceneHeader({})).toBe(true);
    expect(isEmptySceneHeader({ timeText: '  ' })).toBe(true);
    expect(isEmptySceneHeader({ locationText: 'Bangkok' })).toBe(false);
  });

  describe('plain text projection', () => {
    test('a scene header contributes its text', () => {
      const text = extractPlainTextFromTiptap({
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
          { type: 'sceneBreak' },
          { type: 'sceneHeader', attrs: { timeText: '18:30', locationText: 'Bangkok' } },
          { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
        ],
      });
      expect(text).toContain('18:30 — Bangkok');
      expect(text).toContain('***');
    });

    test('an empty scene header contributes nothing to the word count', () => {
      const text = extractPlainTextFromTiptap({
        content: [
          { type: 'sceneHeader', attrs: { timeText: null, locationText: null } },
          { type: 'paragraph', content: [{ type: 'text', text: 'only this' }] },
        ],
      });
      expect(text.trim()).toBe('only this');
    });
  });

  describe('published HTML', () => {
    test('renders time, separator and location as separate spans', () => {
      const html = renderTiptapToSafeHtml({
        content: [
          { type: 'sceneHeader', attrs: { timeText: '18:30', locationText: 'Bangkok' } },
        ],
      });
      expect(html).toContain('novel-scene-header');
      expect(html).toContain('<span class="scene-header-time">18:30</span>');
      expect(html).toContain('<span class="scene-header-location">Bangkok</span>');
    });

    test('omits the separator when only one field is set', () => {
      const html = renderTiptapToSafeHtml({
        content: [{ type: 'sceneHeader', attrs: { locationText: 'Bangkok' } }],
      });
      expect(html).not.toContain('scene-header-sep');
      expect(html).toContain('Bangkok');
    });

    test('renders nothing for an empty header', () => {
      expect(
        renderTiptapToSafeHtml({ content: [{ type: 'sceneHeader', attrs: {} }] })
      ).toBe('');
    });

    test('escapes author text like any other prose', () => {
      const html = renderTiptapToSafeHtml({
        content: [
          {
            type: 'sceneHeader',
            attrs: {
              timeText: '<script>alert(1)</script>',
              locationText: '" onload="x',
            },
          },
        ],
      });
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('&quot;');
    });

    test('contributes to the plain-text projection used for search', () => {
      const text = renderTiptapToPlainText({
        content: [
          { type: 'sceneHeader', attrs: { timeText: '18:30', locationText: 'Bangkok' } },
        ],
      });
      expect(text).toContain('18:30 — Bangkok');
    });
  });

  test('a document with only a bare scene break is unchanged', () => {
    const doc = {
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'a' }] },
        { type: 'sceneBreak' },
        { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
      ],
    };
    expect(renderTiptapToSafeHtml(doc)).toContain('novel-scene-break');
    expect(renderTiptapToSafeHtml(doc)).not.toContain('novel-scene-header');
  });
});

// ===========================================================================
// Page View pagination (Stage 4G)
// ===========================================================================

describe('Page View pagination', () => {
  const PAGE = 600;
  const GAP = 100;
  const options = { pageHeightPx: PAGE, pageGapPx: GAP };

  /** Lays blocks out back to back at their natural offsets. */
  function flow(
    heights: number[],
    explicitAt: number[] = []
  ): PaginationBlock[] {
    let top = 0;
    return heights.map((heightPx, index) => {
      const block: PaginationBlock = {
        pos: index * 10,
        nodeSize: 1,
        topPx: top,
        heightPx: explicitAt.includes(index) ? 0 : heightPx,
        isExplicitBreak: explicitAt.includes(index),
      };
      top += block.heightPx;
      return block;
    });
  }

  test('content that fits on one page needs no spacers', () => {
    expect(computePageSpacers(flow([100, 100, 100]), options)).toEqual([]);
  });

  test('a block that would straddle the page edge is pushed to the next page', () => {
    // 550 used, then a 100px block would end at 650 — past the 600 boundary.
    const spacers = computePageSpacers(flow([550, 100]), options);
    expect(spacers).toHaveLength(1);
    expect(spacers[0].blockIndex).toBe(1);
    expect(spacers[0].kind).toBe('automatic');
    // Fills the rest of page 1 and crosses the gap: 600 - 550 + 100.
    expect(spacers[0].fillerPx).toBe(150);
    expect(spacers[0].startsPageNumber).toBe(2);
  });

  test('a block that exactly fills a page leaves no filler behind', () => {
    const spacers = computePageSpacers(flow([600, 100]), options);
    // The first block ends flush with the page edge, so it is not moved. The
    // second one begins in the gap between the sheets, and is carried across
    // it — by the gap alone, with no page left to fill.
    expect(spacers).toHaveLength(1);
    expect(spacers[0].blockIndex).toBe(1);
    expect(spacers[0].fillerPx).toBe(GAP);
  });

  test('pages keep their rhythm across several boundaries', () => {
    const spacers = computePageSpacers(flow([400, 400, 400, 400]), options);
    expect(spacers.map((s) => s.startsPageNumber)).toEqual([2, 3, 4]);
    // Every page occupies exactly one period, which is what lets the sheet
    // background be a plain repeating gradient rather than tracked geometry.
    expect(spacers.map((s) => s.fillerPx)).toEqual([300, 300, 300]);
  });

  test('an explicit page break fills the rest of its page', () => {
    const spacers = computePageSpacers(flow([300, 0, 100], [1]), options);
    expect(spacers).toHaveLength(1);
    expect(spacers[0].kind).toBe('explicit');
    expect(spacers[0].fillerPx).toBe(400); // 600 - 300 + 100
    expect(spacers[0].blockIndex).toBe(1);
  });

  test('an explicit break carries its node position and size for a node decoration', () => {
    const blocks = flow([300, 0], [1]);
    const spacers = computePageSpacers(blocks, options);
    expect(spacers[0].pos).toBe(blocks[1].pos);
    expect(spacers[0].nodeSize).toBe(blocks[1].nodeSize);
  });

  test('a block taller than a whole page is left to straddle rather than split', () => {
    // Splitting it would mean editing the author's paragraph to suit the
    // display, which is the one thing pagination must never do.
    const spacers = computePageSpacers(flow([1500]), options);
    expect(spacers).toEqual([]);
  });

  test('the block after an oversized one continues where that block ended', () => {
    // The 1500px block spans pages 1 to 3 and ends 100px into page 3's content
    // area, so the next block simply follows it. Pushing it to page 4 would
    // open a gap the author never asked for.
    expect(computePageSpacers(flow([1500, 100]), options)).toEqual([]);
  });

  test('page accounting recovers after an oversized block', () => {
    // Once past the tall block, ordinary boundaries are found again.
    const spacers = computePageSpacers(flow([1500, 100, 500]), options);
    expect(spacers).toHaveLength(1);
    expect(spacers[0].blockIndex).toBe(2);
    expect(spacers[0].startsPageNumber).toBe(4);
  });

  test('is a fixed point: re-measuring the decorated layout is stable', () => {
    // The measurement subtracts previously injected spacers, so running the
    // computation over its own output must produce the same answer. This is
    // what stops measure -> decorate -> relayout -> measure from looping.
    const blocks = flow([550, 100, 300, 400]);
    const first = computePageSpacers(blocks, options);
    const second = computePageSpacers(blocks, options);
    expect(spacerSignature(second)).toBe(spacerSignature(first));
  });

  test('degenerate geometry produces no spacers instead of dividing by zero', () => {
    expect(computePageSpacers(flow([500]), { pageHeightPx: 0, pageGapPx: 10 })).toEqual([]);
    expect(computePageSpacers(flow([500]), { pageHeightPx: -1, pageGapPx: 10 })).toEqual([]);
    expect(computePageSpacers(flow([500]), { pageHeightPx: 600, pageGapPx: -1 })).toEqual([]);
  });

  test('an empty document produces no spacers', () => {
    expect(computePageSpacers([], options)).toEqual([]);
  });

  test('the paged strip is rounded up to whole sheets', () => {
    expect(paginatedHeightPx(100, options)).toBe(PAGE);
    expect(paginatedHeightPx(PAGE + GAP + 10, options)).toBe(2 * (PAGE + GAP) - GAP);
  });

  test('the signature changes when a boundary moves', () => {
    const a = computePageSpacers(flow([550, 100]), options);
    const b = computePageSpacers(flow([500, 200]), options);
    expect(spacerSignature(a)).not.toBe(spacerSignature(b));
  });
});

// ===========================================================================
// Editor display spacing (Stage 4D)
// ===========================================================================

describe('Editor display spacing', () => {
  const MANUSCRIPT = 1.08;

  test('Writing View is comfortable by default, in the 1.35–1.45 target band', () => {
    const value = resolveDisplayLineSpacing('comfortable', 'scroll', MANUSCRIPT);
    expect(value).toBe(DISPLAY_SPACING_VALUES.comfortable);
    expect(value).toBeGreaterThanOrEqual(1.35);
    expect(value).toBeLessThanOrEqual(1.45);
  });

  test('Compact is tighter but still looser than a typical manuscript value', () => {
    const value = resolveDisplayLineSpacing('compact', 'scroll', MANUSCRIPT);
    expect(value).toBeGreaterThanOrEqual(1.2);
    expect(value).toBeLessThanOrEqual(1.25);
    expect(value).toBeGreaterThan(MANUSCRIPT);
  });

  test('Manuscript Exact renders the project value untouched', () => {
    expect(resolveDisplayLineSpacing('manuscript', 'scroll', MANUSCRIPT)).toBe(MANUSCRIPT);
    expect(resolveDisplayLineSpacing('manuscript', 'scroll', 1.5)).toBe(1.5);
  });

  test('Page View is always manuscript-exact, whatever the display preference', () => {
    // A display line height would move every page boundary and make Page View
    // answer the wrong question.
    for (const mode of ['comfortable', 'compact', 'manuscript'] as const) {
      expect(resolveDisplayLineSpacing(mode, 'page', MANUSCRIPT)).toBe(MANUSCRIPT);
      expect(usesDisplaySpacing(mode, 'page')).toBe(false);
    }
  });

  test('the display rule only overrides paragraph values in Writing View', () => {
    expect(usesDisplaySpacing('comfortable', 'scroll')).toBe(true);
    expect(usesDisplaySpacing('compact', 'scroll')).toBe(true);
    expect(usesDisplaySpacing('manuscript', 'scroll')).toBe(false);
  });
});

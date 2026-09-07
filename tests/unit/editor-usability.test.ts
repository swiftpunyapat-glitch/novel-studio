import { describe, expect, test } from 'vitest';

import {
  MANUSCRIPT_FONTS,
  DEFAULT_BODY_FONT,
  canonicalFontName,
  fontCssStack,
  fontOptions,
  fontSelectValue,
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
  keepsWithNext,
  paginatedHeightPx,
  spacerSignature,
  trailingFillPx,
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

  describe('fontSelectValue', () => {
    test('passes an offered font through unchanged', () => {
      expect(fontSelectValue('Prompt')).toBe('Prompt');
      expect(fontSelectValue('TH Sarabun New')).toBe('TH Sarabun New');
    });

    test('canonicalises a legacy CSS stack so the select can match an option', () => {
      // The bug this closes: the option said "Sarabun" while the select held
      // "'Sarabun', sans-serif", so nothing matched and the browser displayed
      // the first option — naming a font the manuscript is not written in.
      expect(fontSelectValue("'Sarabun', sans-serif")).toBe('Sarabun');
      expect(fontSelectValue('"TH Sarabun New", sans-serif')).toBe('TH Sarabun New');
    });

    test('falls back to the default when there is no usable name', () => {
      expect(fontSelectValue(null)).toBe(DEFAULT_BODY_FONT);
      expect(fontSelectValue('')).toBe(DEFAULT_BODY_FONT);
      expect(fontSelectValue('serif')).toBe(DEFAULT_BODY_FONT);
    });

    test.each([
      'Prompt',
      'TH Sarabun New',
      'Angsana New',
      'Georgia',
      "'Sarabun', sans-serif",
      '"Times New Roman", Times, serif',
      'sans-serif',
      '',
      null,
    ])('the value for %p is always one of its own options', (stored) => {
      // The invariant the two helpers have to keep together: a controlled
      // select can never hold a value with no matching option.
      const values = fontOptions(stored as string | null).map((o) => o.value);
      expect(values).toContain(fontSelectValue(stored as string | null));
    });

    test('resolving for display does not alter the stored value', () => {
      const stored = "'Sarabun', sans-serif";
      fontSelectValue(stored);
      fontOptions(stored);
      expect(stored).toBe("'Sarabun', sans-serif");
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
// Published HTML class contract (Stage 4H)
// ===========================================================================

/**
 * The reader stylesheet styles this markup by class name, and the two are
 * deployed independently: a renamed class here would silently strip the
 * published book of its typography with nothing failing to build.
 *
 * These assertions are the contract, not a restatement of the renderer.
 */
describe('markup the reader stylesheet depends on', () => {
  const html = (content: unknown[]) =>
    renderTiptapToSafeHtml({ content: content as never });

  test('paragraphs are plain <p>, which is what carries the first-line indent', () => {
    expect(html([{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }])).toBe(
      '<p>a</p>'
    );
  });

  test('a scene break is an EMPTY div.novel-scene-break', () => {
    // Empty by design: the reader draws the symbol from CSS, so changing a
    // project's scene-break symbol does not require republishing the book.
    const out = html([{ type: 'sceneBreak' }]);
    expect(out).toContain('class="novel-scene-break"');
    expect(out).toMatch(/<div[^>]*><\/div>/);
  });

  test('a scene header keeps its three styled spans', () => {
    const out = html([
      { type: 'sceneHeader', attrs: { timeText: '18:30', locationText: 'Bangkok' } },
    ]);
    expect(out).toContain('class="novel-scene-header"');
    expect(out).toContain('class="scene-header-time"');
    expect(out).toContain('class="scene-header-sep"');
    expect(out).toContain('class="scene-header-location"');
  });

  test('a page break is div.novel-page-break, which the reader neutralises', () => {
    // The editor draws it as a dashed rule; a reader must not see that.
    expect(html([{ type: 'pageBreak' }])).toContain('class="novel-page-break"');
  });

  test('legacy indent and alignment classes still reach the reader', () => {
    // Already-published books carry these, and the reader has rules for them.
    expect(html([{ type: 'paragraph', attrs: { noIndent: true } }])).toContain(
      'class="no-indent"'
    );
    for (const align of ['left', 'center', 'right', 'justify']) {
      expect(html([{ type: 'paragraph', attrs: { textAlign: align } }])).toContain(
        `class="align-${align}"`
      );
    }
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
    explicitAt: number[] = [],
    keepWithNextAt: number[] = []
  ): PaginationBlock[] {
    let top = 0;
    return heights.map((heightPx, index) => {
      const block: PaginationBlock = {
        pos: index * 10,
        nodeSize: 1,
        topPx: top,
        heightPx: explicitAt.includes(index) ? 0 : heightPx,
        isExplicitBreak: explicitAt.includes(index),
        keepWithNext: keepWithNextAt.includes(index),
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

  test('the signature changes when only the final sheet grows', () => {
    // The last page can lengthen while no boundary moves; that still has to
    // reach the DOM, so the tail is part of the layout's identity.
    const spacers = computePageSpacers(flow([100]), options);
    expect(spacerSignature(spacers, 500)).not.toBe(spacerSignature(spacers, 300));
  });

  // -------------------------------------------------------------------------
  // Scene break and scene header stay together (Stage 4G, review fix)
  // -------------------------------------------------------------------------

  describe('keeping a scene break with its scene header', () => {
    test('only a scene break followed by a scene header is grouped', () => {
      expect(keepsWithNext('sceneBreak', 'sceneHeader')).toBe(true);
      expect(keepsWithNext('sceneBreak', 'paragraph')).toBe(false);
      expect(keepsWithNext('sceneBreak', undefined)).toBe(false);
      expect(keepsWithNext('paragraph', 'sceneHeader')).toBe(false);
      expect(keepsWithNext('sceneHeader', 'paragraph')).toBe(false);
    });

    test('a pair that does not fit moves to the next page together', () => {
      // 560 used; the break (20) still fits, its header (40) does not. Without
      // grouping the reader gets *** alone at the foot of one page and
      // "18:30 — Bangkok" alone at the top of the next.
      const blocks = flow([560, 20, 40], [], [1]);
      const spacers = computePageSpacers(blocks, options);

      expect(spacers).toHaveLength(1);
      // Moved before the BREAK, not before the header.
      expect(spacers[0].blockIndex).toBe(1);
      expect(spacers[0].fillerPx).toBe(140); // 600 - 560 + 100
    });

    test('without the grouping flag the pair would be split — the bug this fixes', () => {
      const spacers = computePageSpacers(flow([560, 20, 40]), options);
      expect(spacers).toHaveLength(1);
      expect(spacers[0].blockIndex).toBe(2);
    });

    test('a pair that fits is left where it is', () => {
      expect(computePageSpacers(flow([400, 20, 40], [], [1]), options)).toEqual([]);
    });

    test('the header is not moved a second time once its break has moved', () => {
      const spacers = computePageSpacers(flow([560, 20, 40, 100], [], [1]), options);
      expect(spacers.map((s) => s.blockIndex)).toEqual([1]);
    });

    test('a bare scene break is not grouped with whatever follows it', () => {
      // Bare scene breaks stay valid and independent, exactly as before.
      const types = ['paragraph', 'sceneBreak', 'paragraph'];
      const keepAt = types
        .map((type, index) => (keepsWithNext(type, types[index + 1]) ? index : -1))
        .filter((index) => index >= 0);
      expect(keepAt).toEqual([]);

      const spacers = computePageSpacers(flow([560, 20, 40], [], keepAt), options);
      // The break fits where it is; only the paragraph after it moves.
      expect(spacers.map((s) => s.blockIndex)).toEqual([2]);
    });

    test('the margin between the pair counts toward whether it fits', () => {
      // Heights exclude margins, and a scene header sits below its break with
      // a real gap between them. Summing the two heights makes the pair look
      // 24px shorter than it is, and it straddles the boundary it was grouped
      // to avoid — which is exactly what happened in the browser.
      const blocks: PaginationBlock[] = [
        { pos: 0, nodeSize: 1, topPx: 0, heightPx: 560, isExplicitBreak: false },
        { pos: 10, nodeSize: 1, topPx: 560, heightPx: 20, isExplicitBreak: false, keepWithNext: true },
        { pos: 20, nodeSize: 1, topPx: 604, heightPx: 20, isExplicitBreak: false },
      ];

      // Sum of heights is 40, which would fit in the 40px left on the page.
      // The real span, top of the break to bottom of the header, is 64.
      const spacers = computePageSpacers(blocks, options);
      expect(spacers).toHaveLength(1);
      expect(spacers[0].blockIndex).toBe(1);
    });

    test('a group taller than a page falls back to individual placement', () => {
      // Nowhere to move it to, so the ordinary rules take over rather than
      // opening a blank page for something that cannot fit on one.
      const spacers = computePageSpacers(flow([100, 400, 400], [], [1]), options);
      expect(spacers.map((s) => s.blockIndex)).toEqual([2]);
    });
  });

  // -------------------------------------------------------------------------
  // The final sheet is completed (Stage 4G, review fix)
  // -------------------------------------------------------------------------

  describe('completing the final sheet', () => {
    test('an empty document still shows exactly one full sheet', () => {
      expect(trailingFillPx([], [], options)).toBe(PAGE);
    });

    test('a short document is padded to the bottom of page one', () => {
      const blocks = flow([100]);
      expect(trailingFillPx(blocks, computePageSpacers(blocks, options), options)).toBe(
        PAGE - 100
      );
    });

    test('content ending exactly at the page bottom needs no padding', () => {
      const blocks = flow([PAGE]);
      expect(trailingFillPx(blocks, computePageSpacers(blocks, options), options)).toBe(0);
    });

    test('a multi-page document completes its LAST page, not its first', () => {
      const blocks = flow([550, 100]);
      const spacers = computePageSpacers(blocks, options);
      // Page 2 holds 100px of the 600 available.
      expect(trailingFillPx(blocks, spacers, options)).toBe(PAGE - 100);
    });

    test('a document ending in an explicit page break draws a full blank page', () => {
      // Which is what Word prints, too.
      const blocks = flow([300, 0], [1]);
      const spacers = computePageSpacers(blocks, options);
      expect(trailingFillPx(blocks, spacers, options)).toBe(PAGE);
    });

    test('every page including the last occupies exactly one whole sheet', () => {
      const blocks = flow([400, 400, 400, 400]);
      const spacers = computePageSpacers(blocks, options);
      const shift = spacers.reduce((total, s) => total + s.fillerPx, 0);
      const last = blocks[blocks.length - 1];
      const paginatedEnd =
        last.topPx + last.heightPx + shift + trailingFillPx(blocks, spacers, options);

      // Four pages of content: the strip ends on a page boundary, never
      // part-way down a sheet.
      expect((paginatedEnd + GAP) % (PAGE + GAP)).toBe(0);
    });

    test('degenerate geometry pads nothing rather than dividing by zero', () => {
      const blocks = flow([100]);
      expect(trailingFillPx(blocks, [], { pageHeightPx: 0, pageGapPx: 10 })).toBe(0);
      expect(trailingFillPx(blocks, [], { pageHeightPx: -1, pageGapPx: 10 })).toBe(0);
    });

    test('padding is idempotent: measuring the padded layout gives the same tail', () => {
      // The tail is a spacer like any other, so the measurer subtracts it back
      // out and the second pass must agree with the first.
      const blocks = flow([550, 100]);
      const spacers = computePageSpacers(blocks, options);
      const first = trailingFillPx(blocks, spacers, options);
      const second = trailingFillPx(blocks, computePageSpacers(blocks, options), options);
      expect(second).toBe(first);
    });
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

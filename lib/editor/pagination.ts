/**
 * Page View layout arithmetic. (Stage 4G)
 *
 * ARCHITECTURE RULE, stated here because this is the file most likely to be
 * "improved" into a manuscript corruption:
 *
 *     Pagination is presentation. It is computed from rendered layout and it
 *     NEVER enters the document.
 *
 * Nothing in this module returns a manuscript node, and its only consumer
 * (`extensions/PageViewExtension.ts`) turns the result into ProseMirror
 * decorations — blank spacers drawn between blocks. Decorations are not part of
 * the document: they do not appear in `editor.getJSON()`, are not saved, and
 * vanish when Page View is switched off. The only page break that ever lives in
 * manuscript JSON is the `pageBreak` node an author inserted on purpose.
 *
 * The model is a strip of fixed-height sheets separated by fixed gaps:
 *
 *     |<- pageHeight ->|<- gap ->|<- pageHeight ->|<- gap ->| ...
 *     period = pageHeight + gap
 *
 * Every page occupies exactly one period because this module pads each page out
 * with a spacer, which is what lets the sheet backgrounds be painted as a
 * simple repeating gradient rather than tracked element by element.
 *
 * Positions are measured with previously injected spacers subtracted out
 * (`topPx` is the *natural* offset), so running the computation over its own
 * output is stable: same input heights in, same spacers out. That fixed point
 * is what stops measure -> decorate -> relayout -> measure from looping.
 */

export interface PaginationBlock {
  /** ProseMirror position immediately before this top-level node. */
  pos: number;
  /** `node.nodeSize`, needed to address the node with a node decoration. */
  nodeSize: number;
  /** Natural offset from the top of the paged flow, spacers removed. */
  topPx: number;
  /** Natural rendered height in CSS pixels. */
  heightPx: number;
  /** True for an author-inserted `pageBreak` node. */
  isExplicitBreak: boolean;
}

export interface PageSpacer {
  /** Index into the input block list. */
  blockIndex: number;
  pos: number;
  nodeSize: number;
  /**
   * `explicit` — the block IS the author's page break and is stretched to fill
   * the rest of the page. `automatic` — blank space inserted before a block
   * that would otherwise straddle the page edge.
   */
  kind: 'explicit' | 'automatic';
  /** Blank height that finishes the current page and crosses the gap. */
  fillerPx: number;
  /** 1-based number of the page this spacer starts. */
  startsPageNumber: number;
}

export interface PaginationOptions {
  /** Usable height of one sheet, margins already removed. */
  pageHeightPx: number;
  /** Visible space drawn between two sheets. */
  pageGapPx: number;
}

/** Sub-pixel fillers are visually nothing and would only churn the DOM. */
const MIN_FILLER_PX = 0.5;

/**
 * Visible space drawn between two sheets, on top of the two page margins that
 * already separate the last line of one page from the first line of the next.
 */
export const PAGE_VIEW_GAP_PX = 28;

/**
 * Places the page-filling spacers for one rendered document.
 *
 * A block taller than a whole page cannot be pushed anywhere useful — there is
 * no page it would fit on — so it is left to straddle the boundary. That is the
 * accepted V1 approximation: the alternative is splitting the author's
 * paragraph, which would mean editing the manuscript to satisfy the display.
 */
export function computePageSpacers(
  blocks: readonly PaginationBlock[],
  options: PaginationOptions
): PageSpacer[] {
  const { pageHeightPx, pageGapPx } = options;

  if (!Number.isFinite(pageHeightPx) || pageHeightPx <= 0) return [];
  if (!Number.isFinite(pageGapPx) || pageGapPx < 0) return [];

  const period = pageHeightPx + pageGapPx;
  const spacers: PageSpacer[] = [];

  // Total spacer height inserted above the block being considered. Measured
  // tops exclude it, so it is added back to get the on-screen position.
  let shift = 0;

  blocks.forEach((block, blockIndex) => {
    const start = block.topPx + shift;
    const pageIndex = Math.floor(start / period);
    const pageBottom = pageIndex * period + pageHeightPx;
    const nextPageTop = (pageIndex + 1) * period;

    const push = (kind: PageSpacer['kind']) => {
      const fillerPx = nextPageTop - start;
      if (fillerPx < MIN_FILLER_PX) return false;
      spacers.push({
        blockIndex,
        pos: block.pos,
        nodeSize: block.nodeSize,
        kind,
        fillerPx,
        startsPageNumber: pageIndex + 2,
      });
      shift += fillerPx;
      return true;
    };

    if (block.isExplicitBreak) {
      // The author asked for the next content to start on a new page, so the
      // break node itself becomes the rest of this page.
      push('explicit');
      return;
    }

    const startedInGap = start >= pageBottom;
    const straddles =
      start + block.heightPx > pageBottom && block.heightPx <= pageHeightPx;

    if (startedInGap || straddles) {
      push('automatic');
    }
  });

  return spacers;
}

/** Stable identity for a spacer list, so an unchanged layout is not re-applied. */
export function spacerSignature(spacers: readonly PageSpacer[]): string {
  return spacers
    .map((s) => `${s.pos}:${s.kind}:${Math.round(s.fillerPx)}`)
    .join('|');
}

/**
 * Total height of the paged strip, so the sheet background can be drawn to the
 * end of the last page rather than stopping at the last line of prose.
 */
export function paginatedHeightPx(
  contentHeightPx: number,
  options: PaginationOptions
): number {
  const { pageHeightPx, pageGapPx } = options;
  if (!Number.isFinite(pageHeightPx) || pageHeightPx <= 0) return contentHeightPx;

  const period = pageHeightPx + pageGapPx;
  const pages = Math.max(1, Math.ceil(contentHeightPx / period));
  return pages * period - pageGapPx;
}

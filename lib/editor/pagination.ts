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
  /**
   * True when this block must not be separated from the one after it.
   *
   * A scene break and its scene header are one gesture; splitting them leaves
   * `***` stranded at the bottom of a page and "18:30 — Bangkok" alone at the
   * top of the next, which reads as a different scene entirely. See
   * `keepsWithNext`.
   */
  keepWithNext?: boolean;
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

/**
 * Whether a block must stay on the same page as the one following it.
 *
 * Presentation only. No grouping node is created, nothing in the manuscript
 * changes, and a scene break with no header after it is unaffected — the two
 * remain independent nodes that this rule merely declines to separate.
 */
export function keepsWithNext(
  type: string | undefined,
  nextType: string | undefined
): boolean {
  return type === 'sceneBreak' && nextType === 'sceneHeader';
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
 *
 * Blocks marked `keepWithNext` are measured as a group, so a scene break moves
 * to the next page together with the scene header that belongs to it.
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

  /**
   * Vertical span of a block plus every block it must stay with.
   *
   * Measured from the first member's top to the last member's bottom rather
   * than by summing heights, because the space BETWEEN two members is real:
   * a scene break and its header are separated by their collapsed margins, and
   * summing `heightPx` — which excludes margins — would understate the pair by
   * exactly that gap and let it straddle the boundary it was grouped to avoid.
   *
   * For a block with nothing to keep, this is its own height, so the ungrouped
   * path is unchanged. Walking the run rather than looking one ahead means a
   * chain is handled the same way as a pair.
   */
  const groupHeightAt = (index: number): number => {
    let cursor = index;
    while (blocks[cursor]?.keepWithNext && blocks[cursor + 1]) cursor += 1;
    const last = blocks[cursor];
    return last.topPx + last.heightPx - blocks[index].topPx;
  };

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

    // The group, not the block: a scene break that fits while its header does
    // not must still move, or the pair is split across the boundary.
    const groupHeight = groupHeightAt(blockIndex);

    const startedInGap = start >= pageBottom;
    const straddles = start + groupHeight > pageBottom && groupHeight <= pageHeightPx;

    if (startedInGap || straddles) {
      push('automatic');
    }
    // A group taller than a whole page has nowhere to go, so its members fall
    // back to being placed individually by the rules above.
  });

  return spacers;
}

/**
 * Stable identity for a computed layout, so an unchanged one is not re-applied.
 * The trailing fill is part of it: the last sheet can grow while no boundary
 * moves, and that still needs rendering.
 */
export function spacerSignature(
  spacers: readonly PageSpacer[],
  tailFillPx = 0
): string {
  const boundaries = spacers
    .map((s) => `${s.pos}:${s.kind}:${Math.round(s.fillerPx)}`)
    .join('|');
  return `${boundaries}#${Math.round(tailFillPx)}`;
}

/**
 * Where the last page's text area ends, given how far the content reaches.
 *
 * Equivalently the height of the whole paged strip: `pages * period - gap`
 * collapses to `(pages - 1) * period + pageHeight`, which is the bottom of the
 * final page's content area. Both readings are the same number.
 *
 * The page count comes from `floor + 1` rather than `ceil` so that content
 * ending exactly on a page boundary — or inside the gap below it, which an
 * oversized block can do — still counts the page it has spilled onto.
 */
export function paginatedHeightPx(
  contentHeightPx: number,
  options: PaginationOptions
): number {
  const { pageHeightPx, pageGapPx } = options;
  if (!Number.isFinite(pageHeightPx) || pageHeightPx <= 0) return contentHeightPx;

  const period = pageHeightPx + pageGapPx;
  const pages = Math.floor(Math.max(0, contentHeightPx) / period) + 1;
  return pages * period - pageGapPx;
}

/**
 * Blank height that completes the sheet the manuscript ends on. (Stage 4G)
 *
 * Without it the last page stops at the final line of prose and the painted
 * sheet is cut off mid-page, so a document always looks as though it ends in
 * the middle of a piece of paper.
 *
 * Presentation only, like everything else here: it is rendered as one more
 * spacer decoration at the end of the document. Nothing is written, and an
 * empty document still yields exactly one full sheet.
 */
export function trailingFillPx(
  blocks: readonly PaginationBlock[],
  spacers: readonly PageSpacer[],
  options: PaginationOptions
): number {
  const { pageHeightPx } = options;
  if (!Number.isFinite(pageHeightPx) || pageHeightPx <= 0) return 0;

  const shift = spacers.reduce((total, spacer) => total + spacer.fillerPx, 0);
  const last = blocks[blocks.length - 1];

  // A document ending in an explicit page break reaches the top of the page
  // after it — its filler is already counted in `shift` — so that empty final
  // page is drawn in full, exactly as Word would print it.
  const contentEnd = last ? last.topPx + last.heightPx + shift : 0;

  return Math.max(0, paginatedHeightPx(contentEnd, options) - contentEnd);
}

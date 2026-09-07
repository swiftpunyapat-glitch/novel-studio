import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import {
  computePageSpacers,
  keepsWithNext,
  spacerSignature,
  trailingFillPx,
  type PageSpacer,
  type PaginationBlock,
} from '@/lib/editor/pagination';

/**
 * Page View. (Stage 4G)
 *
 * Draws the manuscript as A5 sheets while the author writes, WITHOUT touching
 * the manuscript. The mechanism, in one sentence: measure the rendered blocks,
 * work out where each sheet fills up, and render that as ProseMirror
 * decorations.
 *
 * Decorations are the reason this is safe. They live beside the document rather
 * than inside it: they never appear in `editor.getJSON()`, are never saved, and
 * are dropped the moment Page View is turned off. No node is inserted, split or
 * rewritten, so reflowing text — a window resize, a font finishing loading, a
 * changed project setting — cannot alter a single byte of the author's prose.
 *
 * Two things keep it from destabilising the editor:
 *
 *   1. Every transaction this plugin dispatches is metadata-only. Tiptap emits
 *      `update` solely when `transaction.docChanged`, so measurement can never
 *      mark the manuscript dirty or wake the SaveCoordinator.
 *   2. The measurement subtracts the spacers it previously injected, so the
 *      computation is a fixed point: measure -> decorate -> measure produces an
 *      identical result, the signature matches, and nothing is dispatched.
 *      That is what stops a relayout loop.
 *
 * When disabled — the default, and the whole of Writing/Scroll View — the
 * plugin holds an empty decoration set and does no measuring at all.
 */

export const pageViewKey = new PluginKey<PageViewPluginState>('novelPageView');

export interface PageViewConfig {
  enabled: boolean;
  /** Usable height of one sheet in CSS pixels, margins removed. */
  pageHeightPx: number;
  /** Visible space drawn between sheets. */
  pageGapPx: number;
}

interface PageViewPluginState extends PageViewConfig {
  decorations: DecorationSet;
  signature: string;
}

interface PageViewMeta {
  config?: PageViewConfig;
  spacers?: PageSpacer[];
  /** Blank height completing the sheet the document ends on. */
  tailFillPx?: number;
  signature?: string;
}

const SPACER_CLASS = 'novel-page-spacer';

const EMPTY_STATE = (config: PageViewConfig): PageViewPluginState => ({
  ...config,
  decorations: DecorationSet.empty,
  signature: '',
});

/** The blank spacer element, used both between pages and after the last one. */
function spacerElement(heightPx: number): HTMLElement {
  const el = document.createElement('div');
  el.className = SPACER_CLASS;
  el.setAttribute('contenteditable', 'false');
  el.setAttribute('aria-hidden', 'true');
  el.style.height = `${heightPx.toFixed(2)}px`;
  return el;
}

function buildDecorations(
  spacers: readonly PageSpacer[],
  tailFillPx: number,
  doc: import('@tiptap/pm/model').Node
): DecorationSet {
  const decorations: Decoration[] = [];

  for (const spacer of spacers) {
    if (spacer.kind === 'explicit') {
      // The author's page break stretches to fill the rest of its page, so the
      // following content visibly starts on the next sheet.
      decorations.push(
        Decoration.node(spacer.pos, spacer.pos + spacer.nodeSize, {
          class: 'novel-page-break--paged',
          style: `height: ${spacer.fillerPx.toFixed(2)}px`,
        })
      );
      continue;
    }

    decorations.push(
      Decoration.widget(spacer.pos, () => spacerElement(spacer.fillerPx), {
        side: -1,
        // Keyed so an unchanged spacer is reused rather than re-created,
        // which would make the caret flicker while typing.
        key: `page-spacer-${spacer.pos}-${Math.round(spacer.fillerPx)}`,
        ignoreSelection: true,
      })
    );
  }

  if (tailFillPx > 0) {
    // Completes the final sheet, so the document does not appear to stop in
    // the middle of a piece of paper.
    decorations.push(
      Decoration.widget(doc.content.size, () => spacerElement(tailFillPx), {
        side: 1,
        key: `page-tail-${Math.round(tailFillPx)}`,
        ignoreSelection: true,
      })
    );
  }

  return DecorationSet.create(doc, decorations);
}

/**
 * Where the paginator's coordinate zero sits.
 *
 * `offsetTop` is measured from the offset parent's PADDING EDGE — the top of
 * the sheet — while the page grid counts from where the text starts, one top
 * margin further down. Without this correction every page after the first
 * begins flush against the top of its sheet, with its margin missing and the
 * bottom of the previous page left blank by the same amount.
 *
 * The offset parent is the paper element itself, which `.novel-page-flow`
 * pins with `position: relative` so this does not depend on which ancestor
 * happens to be positioned.
 */
function contentOriginPx(view: EditorView): number {
  const parent = view.dom.offsetParent as HTMLElement | null;
  if (!parent) return 0;
  const paddingTop = parseFloat(getComputedStyle(parent).paddingTop);
  return Number.isFinite(paddingTop) ? paddingTop : 0;
}

/**
 * Reads the natural geometry of every top-level block.
 *
 * "Natural" means with this plugin's own spacers removed: their heights are
 * accumulated and subtracted from each subsequent `offsetTop`, and explicit
 * page breaks report zero height because their rendered height is a decoration
 * we set ourselves. Measuring the un-decorated layout is what makes the
 * computation converge.
 */
function measureBlocks(view: EditorView): PaginationBlock[] {
  const blocks: PaginationBlock[] = [];
  const children = Array.from(view.dom.children) as HTMLElement[];
  const origin = contentOriginPx(view);

  // Position of each top-level document node, by index.
  const positions: Array<{ pos: number; nodeSize: number; type: string }> = [];
  view.state.doc.forEach((node, offset) => {
    positions.push({ pos: offset, nodeSize: node.nodeSize, type: node.type.name });
  });

  let synthetic = 0;
  let nodeIndex = 0;

  for (const el of children) {
    if (el.classList.contains(SPACER_CLASS)) {
      synthetic += el.offsetHeight;
      continue;
    }

    const entry = positions[nodeIndex];
    // A DOM child with no matching document node (a gap cursor, say) is not
    // manuscript content and must not consume a position.
    if (!entry) break;
    nodeIndex += 1;

    const isExplicitBreak = entry.type === 'pageBreak';

    blocks.push({
      pos: entry.pos,
      nodeSize: entry.nodeSize,
      // Read before this block's own synthetic height is accounted for: a page
      // break's position is where it starts, not where its filler ends.
      topPx: el.offsetTop - origin - synthetic,
      // A page break is a marker, not content. Its rendered height is a
      // decoration this plugin sets, so it is measured as synthetic space.
      heightPx: isExplicitBreak ? 0 : el.offsetHeight,
      isExplicitBreak,
      // A scene header belongs to the break above it; the paginator moves the
      // two together rather than stranding `***` at the foot of a page.
      keepWithNext: keepsWithNext(entry.type, positions[nodeIndex]?.type),
    });

    if (isExplicitBreak) synthetic += el.offsetHeight;
  }

  return blocks;
}

function pageViewPlugin(): Plugin<PageViewPluginState> {
  let frame: number | null = null;
  let resizeObserver: ResizeObserver | null = null;

  return new Plugin<PageViewPluginState>({
    key: pageViewKey,

    state: {
      init: () => EMPTY_STATE({ enabled: false, pageHeightPx: 0, pageGapPx: 0 }),

      apply(tr, prev) {
        const meta = tr.getMeta(pageViewKey) as PageViewMeta | undefined;
        let next = prev;

        if (meta?.config) {
          next = { ...next, ...meta.config };
          if (!meta.config.enabled) {
            return { ...next, decorations: DecorationSet.empty, signature: '' };
          }
        }

        if (meta?.spacers) {
          const tailFillPx = meta.tailFillPx ?? 0;
          return {
            ...next,
            decorations: buildDecorations(meta.spacers, tailFillPx, tr.doc),
            signature: meta.signature ?? spacerSignature(meta.spacers, tailFillPx),
          };
        }

        if (tr.docChanged) {
          // Keep the existing spacers roughly in place until the next
          // measurement lands, so they do not visibly jump on every keystroke.
          return {
            ...next,
            decorations: next.decorations.map(tr.mapping, tr.doc),
          };
        }

        return next;
      },
    },

    props: {
      decorations(state) {
        return pageViewKey.getState(state)?.decorations ?? DecorationSet.empty;
      },
    },

    view(view) {
      const schedule = () => {
        if (frame !== null) return;
        frame = requestAnimationFrame(() => {
          frame = null;
          measureAndApply(view);
        });
      };

      const measureAndApply = (v: EditorView) => {
        if (v.isDestroyed) return;
        const state = pageViewKey.getState(v.state);
        if (!state) return;

        if (!state.enabled || state.pageHeightPx <= 0) {
          if (state.signature !== '') {
            v.dispatch(
              v.state.tr.setMeta(pageViewKey, {
                spacers: [],
                tailFillPx: 0,
                signature: '',
              })
            );
          }
          return;
        }

        const options = {
          pageHeightPx: state.pageHeightPx,
          pageGapPx: state.pageGapPx,
        };
        const blocks = measureBlocks(v);
        const spacers = computePageSpacers(blocks, options);
        const tailFillPx = trailingFillPx(blocks, spacers, options);
        const signature = spacerSignature(spacers, tailFillPx);

        // The fixed point: an unchanged layout dispatches nothing.
        if (signature === state.signature) return;

        v.dispatch(
          v.state.tr.setMeta(pageViewKey, { spacers, tailFillPx, signature })
        );
      };

      if (typeof ResizeObserver !== 'undefined') {
        // Width changes reflow the prose, which moves every page boundary.
        resizeObserver = new ResizeObserver(schedule);
        resizeObserver.observe(view.dom);
      }

      return {
        update: schedule,
        destroy() {
          if (frame !== null) cancelAnimationFrame(frame);
          frame = null;
          resizeObserver?.disconnect();
          resizeObserver = null;
        },
      };
    },
  });
}

export const PageViewExtension = Extension.create({
  name: 'pageView',

  addProseMirrorPlugins() {
    return [pageViewPlugin()];
  },
});

/**
 * Pushes a new Page View configuration into a live editor.
 *
 * Metadata-only, so it cannot mark the manuscript dirty.
 */
export function setPageViewConfig(
  view: EditorView | null | undefined,
  config: PageViewConfig
): void {
  if (!view || view.isDestroyed) return;
  view.dispatch(view.state.tr.setMeta(pageViewKey, { config }));
}

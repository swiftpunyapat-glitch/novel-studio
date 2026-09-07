/**
 * Ctrl/Cmd+A routing. (Stage 4B)
 *
 * The complaint this solves: pressing Ctrl+A while writing selected the whole
 * web page — sidebar, toolbar, chapter navigation — instead of the manuscript.
 *
 * Two distinct situations, and only one of them is the editor's business:
 *
 *   1. The caret is inside the Tiptap editor. ProseMirror's keymap already owns
 *      `Mod-a` there and selects the document; `ManuscriptSelectAll` states
 *      that binding explicitly so it is this codebase's guarantee rather than
 *      an incidental property of a dependency's base keymap.
 *
 *   2. Focus is somewhere in the writing pane but NOT in the editor — the
 *      author clicked the paper margin, or has not clicked into the prose since
 *      the page loaded. The browser then selects the entire document. This is
 *      the case the region handler fixes.
 *
 * What it deliberately does NOT do is install a document-global keydown hook.
 * The listener is scoped to the manuscript region, and inside that region a
 * genuine text field — the chapter title, a metadata input, a rename box, a
 * dialog field — keeps its native Ctrl+A. Those decisions live in the pure
 * functions below so they can be tested without a DOM.
 */

/** The subset of KeyboardEvent this module reasons about. */
export interface SelectAllChordEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey?: boolean;
}

/** The subset of Element the target classifier reasons about. */
export interface SelectAllTarget {
  tagName?: string;
  isContentEditable?: boolean;
}

/** True for Ctrl+A / Cmd+A. Alt is excluded so Alt-chords stay untouched. */
export function isSelectAllChord(event: SelectAllChordEvent): boolean {
  if (event.altKey) return false;
  if (!event.ctrlKey && !event.metaKey) return false;
  return typeof event.key === 'string' && event.key.toLowerCase() === 'a';
}

const NATIVE_TEXT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * True when the target is a field whose own Ctrl+A must keep working:
 * an input, a textarea, a select, or any other contenteditable region.
 */
export function isNativeTextField(target: SelectAllTarget | null | undefined): boolean {
  if (!target) return false;
  if (typeof target.tagName === 'string' && NATIVE_TEXT_TAGS.has(target.tagName.toUpperCase())) {
    return true;
  }
  return target.isContentEditable === true;
}

export type SelectAllDecision = 'ignore' | 'native' | 'select-manuscript';

export interface SelectAllContext {
  /** The keystroke is Ctrl/Cmd+A. */
  chord: boolean;
  /** The event target is an input, textarea, select or contenteditable. */
  targetIsNativeTextField: boolean;
  /** The event target lies inside the Tiptap editor's own DOM. */
  targetIsInsideManuscript: boolean;
}

/**
 * The single decision this feature makes.
 *
 * `native` means "do nothing, let the browser or ProseMirror handle it" — which
 * is why a metadata field and the editor itself are treated the same way here:
 * both already do the right thing on their own.
 */
export function decideSelectAll(context: SelectAllContext): SelectAllDecision {
  if (!context.chord) return 'ignore';
  if (context.targetIsNativeTextField) return 'native';
  if (context.targetIsInsideManuscript) return 'native';
  return 'select-manuscript';
}

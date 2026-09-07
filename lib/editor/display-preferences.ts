/**
 * Studio display preferences. (Stage 4D / 4G)
 *
 * The distinction this file exists to protect:
 *
 *     MANUSCRIPT FORMAT  — what the book is. Stored in `documentSettings` and
 *                          paragraph overrides; exported to DOCX; published.
 *     EDITOR DISPLAY     — how the writing surface looks on this screen, for
 *                          this author, right now.
 *
 * Everything here is the second kind. It lives in `localStorage`, never in
 * Firestore, precisely so there is no code path by which choosing a comfortable
 * on-screen line height could rewrite the manuscript's line spacing. Nothing in
 * this module is read by DOCX export, publishing, or the reader.
 *
 * Manuscript line spacing is commonly 1.08, which is correct on paper and hard
 * to read for hours on a screen — especially in Thai, where tone marks and
 * vowels stack above and below the baseline and need the extra leading.
 */

export type EditorViewMode = 'scroll' | 'page';

export type DisplaySpacingMode = 'comfortable' | 'compact' | 'manuscript';

export const DEFAULT_VIEW_MODE: EditorViewMode = 'scroll';
export const DEFAULT_DISPLAY_SPACING: DisplaySpacingMode = 'comfortable';

/** On-screen line heights. Presentation values; not manuscript formatting. */
export const DISPLAY_SPACING_VALUES: Readonly<Record<'comfortable' | 'compact', number>> = {
  comfortable: 1.4,
  compact: 1.22,
};

export const DISPLAY_SPACING_LABELS: Readonly<Record<DisplaySpacingMode, string>> = {
  comfortable: 'Comfortable',
  compact: 'Compact',
  manuscript: 'Manuscript Exact',
};

export function isViewMode(value: unknown): value is EditorViewMode {
  return value === 'scroll' || value === 'page';
}

export function isDisplaySpacingMode(value: unknown): value is DisplaySpacingMode {
  return value === 'comfortable' || value === 'compact' || value === 'manuscript';
}

/**
 * The line height the editor actually renders.
 *
 * Page View is always manuscript-exact: its whole purpose is showing where the
 * printed pages break, and a display line height would move every boundary and
 * make the answer wrong.
 */
export function resolveDisplayLineSpacing(
  spacing: DisplaySpacingMode,
  viewMode: EditorViewMode,
  manuscriptLineSpacing: number
): number {
  if (viewMode === 'page') return manuscriptLineSpacing;
  if (spacing === 'manuscript') return manuscriptLineSpacing;
  return DISPLAY_SPACING_VALUES[spacing];
}

/**
 * True when the editor should override the manuscript's line spacing for
 * display. Paragraphs with an explicit `lineSpacingOverride` carry it inline,
 * so the display rule only wins while this is true.
 */
export function usesDisplaySpacing(
  spacing: DisplaySpacingMode,
  viewMode: EditorViewMode
): boolean {
  return viewMode === 'scroll' && spacing !== 'manuscript';
}

// ---------------------------------------------------------------------------
// Persistence — per browser, never per manuscript.
// ---------------------------------------------------------------------------

const VIEW_MODE_KEY = 'novel-studio.editor.viewMode';
const SPACING_KEY = 'novel-studio.editor.displaySpacing';

function readStored(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    // Private mode, blocked site data: fall back to the defaults silently.
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
  } catch {
    // A preference that cannot be remembered is not worth an error.
  }
}

export function loadViewMode(): EditorViewMode {
  const raw = readStored(VIEW_MODE_KEY);
  return isViewMode(raw) ? raw : DEFAULT_VIEW_MODE;
}

export function saveViewMode(mode: EditorViewMode): void {
  writeStored(VIEW_MODE_KEY, mode);
}

export function loadDisplaySpacing(): DisplaySpacingMode {
  const raw = readStored(SPACING_KEY);
  return isDisplaySpacingMode(raw) ? raw : DEFAULT_DISPLAY_SPACING;
}

export function saveDisplaySpacing(mode: DisplaySpacingMode): void {
  writeStored(SPACING_KEY, mode);
}

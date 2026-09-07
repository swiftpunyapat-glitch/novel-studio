/**
 * Manuscript font catalogue. (Stage 3D, narrowed in Stage 4A)
 *
 * Two distinct names per entry, and the distinction matters:
 *
 *   docxName — what is stored in the manuscript and written into the DOCX.
 *              This must be the name Word knows, e.g. "TH Sarabun New".
 *   cssStack — what the browser uses to DISPLAY the text while writing.
 *              A writing machine may not have the font installed, so every
 *              entry ends in a family that is either web-loaded or universally
 *              present. Display fallback never changes what is exported.
 *
 * V1 offers exactly three fonts. The catalogue is the *offer*, not the
 * *contract*: a manuscript written before this narrowing may still carry any
 * font name, and those values are preserved verbatim — honoured for display
 * through `fontCssStack` and exported unchanged. Narrowing the picker must
 * never rewrite prose an author already committed to.
 */

export interface ManuscriptFont {
  /** Shown in the toolbar. */
  label: string;
  /** Stored in the manuscript and written to DOCX. */
  docxName: string;
  /** Browser display stack, with fallbacks. */
  cssStack: string;
}

const THAI_FALLBACK = `'Sarabun', 'Leelawadee UI', 'Noto Sans Thai', sans-serif`;

/**
 * The three fonts offered in V1.
 *
 * `docxName` is the canonical stored value and is never a CSS stack — storing
 * "TH Sarabun New, sans-serif" would export to Word as a font that does not
 * exist. See `canonicalFontName`.
 */
export const MANUSCRIPT_FONTS: readonly ManuscriptFont[] = [
  {
    label: 'Prompt',
    docxName: 'Prompt',
    // Loaded from Google Fonts in globals.css, so always available for display.
    cssStack: `'Prompt', ${THAI_FALLBACK}`,
  },
  {
    label: 'TH Sarabun New',
    docxName: 'TH Sarabun New',
    // The Thai publishing standard, but rarely installed outside Thailand;
    // Sarabun is a near-identical web-loaded display stand-in.
    cssStack: `'TH Sarabun New', 'TH SarabunPSK', ${THAI_FALLBACK}`,
  },
  {
    label: 'Angsana New',
    docxName: 'Angsana New',
    // Ships with Windows and Office; AngsanaUPC is the same design.
    cssStack: `'Angsana New', 'AngsanaUPC', 'Browallia New', serif, ${THAI_FALLBACK}`,
  },
] as const;

/** The default body font for NEW projects. */
export const DEFAULT_BODY_FONT = 'TH Sarabun New';

/**
 * Display stacks for fonts that are no longer offered but may still be stored
 * in existing manuscripts. Listed so legacy prose keeps rendering as its author
 * intended rather than falling through to a generic Thai stack.
 */
const LEGACY_DISPLAY_STACKS: Readonly<Record<string, string>> = {
  Sarabun: `'Sarabun', ${THAI_FALLBACK}`,
  Arial: `Arial, Helvetica, ${THAI_FALLBACK}`,
  Tahoma: `Tahoma, Verdana, ${THAI_FALLBACK}`,
  'Times New Roman': `'Times New Roman', Times, serif, ${THAI_FALLBACK}`,
  Georgia: `Georgia, 'Times New Roman', serif, ${THAI_FALLBACK}`,
};

const BY_DOCX_NAME = new Map(MANUSCRIPT_FONTS.map((f) => [f.docxName, f]));

/**
 * Reduces any font value to a single canonical family name.
 *
 * Stored formatting must hold "TH Sarabun New", never a CSS stack such as
 * "TH Sarabun New, sans-serif" — Word looks the whole string up as one family
 * name and silently substitutes when it fails. Legacy documents may still hold
 * a stack, so every read path funnels through here: the first family wins,
 * quotes are stripped, and generic CSS keywords are dropped.
 */
const GENERIC_CSS_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'inherit',
  'initial',
  'unset',
]);

export function canonicalFontName(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;

  for (const part of value.split(',')) {
    const name = part.trim().replace(/^['"]|['"]$/g, '').trim();
    if (!name) continue;
    if (GENERIC_CSS_FAMILIES.has(name.toLowerCase())) continue;
    return name;
  }

  return null;
}

/** Resolves a stored font name to a browser display stack. */
export function fontCssStack(docxName: string | null | undefined): string {
  const name = canonicalFontName(docxName);
  if (!name) return MANUSCRIPT_FONTS[0].cssStack;

  const known = BY_DOCX_NAME.get(name);
  if (known) return known.cssStack;

  const legacy = LEGACY_DISPLAY_STACKS[name];
  if (legacy) return legacy;

  // An unknown font is still honoured for display, with a safe tail.
  return `'${name}', ${THAI_FALLBACK}`;
}

/** True when the font is one of the three offered in the picker. */
export function isKnownFont(docxName: string): boolean {
  const name = canonicalFontName(docxName);
  return name !== null && BY_DOCX_NAME.has(name);
}

/**
 * Options for a font picker showing the current value.
 *
 * A manuscript written against a font that is no longer offered keeps that
 * font, and the picker shows it rather than silently reporting one of the
 * three — which would invite the author to "confirm" a change they never made.
 */
export function fontOptions(
  currentFont: string | null | undefined
): Array<{ value: string; label: string }> {
  const options = MANUSCRIPT_FONTS.map((f) => ({ value: f.docxName, label: f.label }));
  const current = canonicalFontName(currentFont);

  if (current && !BY_DOCX_NAME.has(current)) {
    options.push({ value: current, label: `${current} (current)` });
  }

  return options;
}

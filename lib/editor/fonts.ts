/**
 * Manuscript font catalogue. (Stage 3D)
 *
 * Two distinct names per entry, and the distinction matters:
 *
 *   docxName — what is stored in the manuscript and written into the DOCX.
 *              This must be the name Word knows, e.g. "TH Sarabun New".
 *   cssStack — what the browser uses to DISPLAY the text while writing.
 *              A writing machine may not have the font installed, so every
 *              entry ends in a family that is either web-loaded or universally
 *              present. Display fallback never changes what is exported.
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

export const MANUSCRIPT_FONTS: readonly ManuscriptFont[] = [
  {
    label: 'Sarabun',
    docxName: 'Sarabun',
    // Loaded from Google Fonts in globals.css, so always available for display.
    cssStack: `'Sarabun', ${THAI_FALLBACK}`,
  },
  {
    label: 'TH Sarabun New',
    docxName: 'TH Sarabun New',
    // The Thai publishing standard, but rarely installed outside Thailand;
    // Sarabun is a near-identical display stand-in.
    cssStack: `'TH Sarabun New', 'TH SarabunPSK', ${THAI_FALLBACK}`,
  },
  {
    label: 'Arial',
    docxName: 'Arial',
    cssStack: `Arial, Helvetica, ${THAI_FALLBACK}`,
  },
  {
    label: 'Tahoma',
    docxName: 'Tahoma',
    cssStack: `Tahoma, Verdana, ${THAI_FALLBACK}`,
  },
  {
    label: 'Times New Roman',
    docxName: 'Times New Roman',
    cssStack: `'Times New Roman', Times, serif, ${THAI_FALLBACK}`,
  },
  {
    label: 'Georgia',
    docxName: 'Georgia',
    cssStack: `Georgia, 'Times New Roman', serif, ${THAI_FALLBACK}`,
  },
] as const;

const BY_DOCX_NAME = new Map(MANUSCRIPT_FONTS.map((f) => [f.docxName, f]));

/** Resolves a stored font name to a browser display stack. */
export function fontCssStack(docxName: string | null | undefined): string {
  if (!docxName) return MANUSCRIPT_FONTS[0].cssStack;
  const known = BY_DOCX_NAME.get(docxName);
  if (known) return known.cssStack;
  // An unknown font is still honoured for display, with a safe tail.
  return `'${docxName}', ${THAI_FALLBACK}`;
}

export function isKnownFont(docxName: string): boolean {
  return BY_DOCX_NAME.has(docxName);
}

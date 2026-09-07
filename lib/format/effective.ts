/**
 * The single canonical formatting resolver. (Audit H1 / H3, Stage 3A + 3G)
 *
 * ONE rule, applied everywhere:
 *
 *     effective value = explicit override, else project default
 *
 * Project `documentSettings` are the canonical defaults. A paragraph or run
 * carries a value ONLY when the author deliberately overrode the default;
 * `null` means "inherit", and is the default state of every override attribute.
 *
 * This is why the old model was broken: `LineSpacingExtension` declared
 * `default: 1.08`, and ProseMirror's `Node.toJSON()` serialises every attr
 * whether or not it equals its default — so each paragraph stored a literal
 * 1.08 that was indistinguishable from a deliberate override, and changing the
 * project default could never affect existing prose.
 *
 * Editor rendering, DOCX export and (later) published HTML all resolve through
 * this module. Reimplementing these rules anywhere else reintroduces the drift
 * this file exists to prevent.
 */

import type { DocumentSettings } from '@/types/project';

export type Alignment = 'left' | 'center' | 'right' | 'justify';

export const ALIGNMENTS: readonly Alignment[] = ['left', 'center', 'right', 'justify'];

export function isAlignment(value: unknown): value is Alignment {
  return typeof value === 'string' && (ALIGNMENTS as readonly string[]).includes(value);
}

/**
 * Paragraph-level override attributes as stored in ProseMirror JSON.
 * Every field is nullable and defaults to null (= inherit).
 */
export interface ParagraphOverrides {
  textAlignOverride: Alignment | null;
  firstLineIndentCmOverride: number | null;
  leftIndentCmOverride: number | null;
  rightIndentCmOverride: number | null;
  spaceBeforePtOverride: number | null;
  spaceAfterPtOverride: number | null;
  lineSpacingOverride: number | null;
}

export const EMPTY_PARAGRAPH_OVERRIDES: ParagraphOverrides = {
  textAlignOverride: null,
  firstLineIndentCmOverride: null,
  leftIndentCmOverride: null,
  rightIndentCmOverride: null,
  spaceBeforePtOverride: null,
  spaceAfterPtOverride: null,
  lineSpacingOverride: null,
};

export const PARAGRAPH_OVERRIDE_KEYS = Object.keys(
  EMPTY_PARAGRAPH_OVERRIDES
) as Array<keyof ParagraphOverrides>;

/** Fully resolved paragraph formatting — no nulls, ready to render or export. */
export interface EffectiveParagraphFormat {
  alignment: Alignment;
  firstLineIndentCm: number;
  leftIndentCm: number;
  rightIndentCm: number;
  spaceBeforePt: number;
  spaceAfterPt: number;
  lineSpacingMultiplier: number;
}

/** Run-level overrides carried by marks. */
export interface RunOverrides {
  fontFamily: string | null;
  fontSizePt: number | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
}

/** Fully resolved run formatting. */
export interface EffectiveRunFormat {
  fontFamily: string;
  fontSizePt: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
}

/** Accepts a finite number, otherwise treats the value as "inherit". */
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Reads override attributes off a raw ProseMirror attrs bag. */
export function readParagraphOverrides(
  attrs: Record<string, unknown> | null | undefined
): ParagraphOverrides {
  if (!attrs) return { ...EMPTY_PARAGRAPH_OVERRIDES };

  return {
    textAlignOverride: isAlignment(attrs.textAlignOverride) ? attrs.textAlignOverride : null,
    firstLineIndentCmOverride: num(attrs.firstLineIndentCmOverride),
    leftIndentCmOverride: num(attrs.leftIndentCmOverride),
    rightIndentCmOverride: num(attrs.rightIndentCmOverride),
    spaceBeforePtOverride: num(attrs.spaceBeforePtOverride),
    spaceAfterPtOverride: num(attrs.spaceAfterPtOverride),
    lineSpacingOverride: num(attrs.lineSpacingOverride),
  };
}

/**
 * Effective paragraph formatting: explicit override, else project default.
 *
 * Note that `0` is a meaningful override (e.g. "no first-line indent") and must
 * survive, which is why every check is against `null` rather than falsiness.
 */
export function resolveParagraphFormat(
  attrs: Record<string, unknown> | ParagraphOverrides | null | undefined,
  settings: DocumentSettings
): EffectiveParagraphFormat {
  const o = readParagraphOverrides(attrs as Record<string, unknown>);

  return {
    alignment: o.textAlignOverride ?? settings.paragraphAlignment,
    firstLineIndentCm: o.firstLineIndentCmOverride ?? settings.firstLineIndentCm,
    leftIndentCm: o.leftIndentCmOverride ?? 0,
    rightIndentCm: o.rightIndentCmOverride ?? 0,
    spaceBeforePt: o.spaceBeforePtOverride ?? settings.paragraphSpacingBeforePt,
    spaceAfterPt: o.spaceAfterPtOverride ?? settings.paragraphSpacingAfterPt,
    lineSpacingMultiplier: o.lineSpacingOverride ?? settings.lineSpacingMultiplier,
  };
}

/** Reads run overrides from a ProseMirror marks array. */
export function readRunOverrides(
  marks: Array<{ type?: string; attrs?: Record<string, unknown> }> | null | undefined
): RunOverrides {
  const list = Array.isArray(marks) ? marks : [];

  let fontFamily: string | null = null;
  let fontSizePt: number | null = null;

  for (const mark of list) {
    if (mark?.type !== 'textStyle') continue;
    const family = mark.attrs?.fontFamily;
    if (typeof family === 'string' && family.trim()) fontFamily = family.trim();
    const size = num(mark.attrs?.fontSizePt);
    if (size !== null && size > 0) fontSizePt = size;
  }

  const has = (type: string) => list.some((m) => m?.type === type);

  return {
    fontFamily,
    fontSizePt,
    bold: has('bold'),
    italic: has('italic'),
    underline: has('underline'),
    strike: has('strike'),
  };
}

/** Effective run formatting: explicit override, else project default. */
export function resolveRunFormat(
  marks: Array<{ type?: string; attrs?: Record<string, unknown> }> | null | undefined,
  settings: DocumentSettings
): EffectiveRunFormat {
  const o = readRunOverrides(marks);

  return {
    fontFamily: o.fontFamily ?? settings.bodyFont,
    fontSizePt: o.fontSizePt ?? settings.bodyFontSizePt,
    bold: o.bold,
    italic: o.italic,
    underline: o.underline,
    strike: o.strike,
  };
}

// ---------------------------------------------------------------------------
// Unit conversions, kept here so editor and DOCX cannot drift apart.
// ---------------------------------------------------------------------------

/** Word measures indents in twips: 1 cm = 567 twips (1440 per inch / 2.54). */
export function cmToTwip(cm: number): number {
  return Math.round(cm * 566.929133858);
}

/** Word measures vertical spacing in twentieths of a point. */
export function ptToTwip(pt: number): number {
  return Math.round(pt * 20);
}

/** docx uses half-points for font size. */
export function ptToHalfPoints(pt: number): number {
  return Math.round(pt * 2);
}

/**
 * OOXML "Multiple" line spacing is expressed in 240ths of a line, so the
 * project's 1.08 default maps to Math.round(240 * 1.08) = 259 with
 * LineRuleType.AUTO — the mapping named in the architecture plan.
 */
export function multiplierToLineTwip(multiplier: number): number {
  return Math.round(240 * multiplier);
}

// ---------------------------------------------------------------------------
// CSS custom properties (Stage 3C)
// ---------------------------------------------------------------------------

/**
 * Project defaults expressed as CSS variables for the editor canvas.
 *
 * Paragraphs that inherit read these, so changing a project setting is visible
 * immediately. Paragraphs with explicit overrides set their own inline values
 * and are unaffected.
 *
 * Presentation-only concerns (dark mode, eye comfort) are deliberately absent:
 * theme colours must never be stored or resolved as manuscript formatting.
 */
export function documentSettingsToCssVars(
  settings: DocumentSettings
): Record<string, string> {
  return {
    '--novel-font-family': `'${settings.bodyFont}', 'Sarabun', 'Leelawadee UI', sans-serif`,
    '--novel-font-size': `${settings.bodyFontSizePt}pt`,
    '--novel-line-spacing': String(settings.lineSpacingMultiplier),
    '--novel-first-line-indent': `${settings.firstLineIndentCm}cm`,
    '--novel-paragraph-before': `${settings.paragraphSpacingBeforePt}pt`,
    '--novel-paragraph-after': `${settings.paragraphSpacingAfterPt}pt`,
    '--novel-left-indent': '0cm',
    '--novel-right-indent': '0cm',
    '--novel-text-align': settings.paragraphAlignment,
  };
}

/**
 * Inline style for a paragraph, emitting a property ONLY where the author set
 * an override. Everything else falls through to the CSS variables above.
 */
export function paragraphOverrideStyle(
  attrs: Record<string, unknown> | null | undefined
): Record<string, string> {
  const o = readParagraphOverrides(attrs);
  const style: Record<string, string> = {};

  if (o.textAlignOverride !== null) style.textAlign = o.textAlignOverride;
  if (o.firstLineIndentCmOverride !== null) {
    style.textIndent = `${o.firstLineIndentCmOverride}cm`;
  }
  if (o.leftIndentCmOverride !== null) style.marginLeft = `${o.leftIndentCmOverride}cm`;
  if (o.rightIndentCmOverride !== null) style.marginRight = `${o.rightIndentCmOverride}cm`;
  if (o.spaceBeforePtOverride !== null) style.marginTop = `${o.spaceBeforePtOverride}pt`;
  if (o.spaceAfterPtOverride !== null) style.marginBottom = `${o.spaceAfterPtOverride}pt`;
  if (o.lineSpacingOverride !== null) style.lineHeight = String(o.lineSpacingOverride);

  return style;
}

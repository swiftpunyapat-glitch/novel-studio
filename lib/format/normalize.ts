/**
 * Legacy manuscript normalization. (Audit H3, Stage 3B)
 *
 * Content written before Stage 3 carries baked defaults on every paragraph:
 *
 *     attrs: { textAlign: null, noIndent: false, lineSpacing: 1.08 }
 *
 * because the old extensions declared non-null defaults and ProseMirror's
 * `Node.toJSON()` serialises all attrs regardless of whether they equal their
 * default. Those literals are indistinguishable from deliberate overrides, so
 * changing a project default could never affect existing prose.
 *
 * This converts legacy attrs to the tri-state override model exactly once, at
 * load. It is pure and deterministic: normalising twice is a no-op.
 */

import { isAlignment, type Alignment } from './effective';

/** The historical hardcoded defaults these documents were written against. */
export const LEGACY_DEFAULT_LINE_SPACING = 1.08;
export const LEGACY_DEFAULT_FIRST_LINE_INDENT_CM = 0.5;

export interface NormalizeStats {
  paragraphsVisited: number;
  bakedLineSpacingCleared: number;
  bakedNoIndentCleared: number;
  explicitLineSpacingPreserved: number;
  explicitIndentPreserved: number;
  explicitAlignmentPreserved: number;
  legacyAttrsRemoved: number;
}

export interface NormalizeResult<T> {
  doc: T;
  stats: NormalizeStats;
  changed: boolean;
}

interface Node {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  marks?: unknown[];
  text?: string;
  [key: string]: unknown;
}

function emptyStats(): NormalizeStats {
  return {
    paragraphsVisited: 0,
    bakedLineSpacingCleared: 0,
    bakedNoIndentCleared: 0,
    explicitLineSpacingPreserved: 0,
    explicitIndentPreserved: 0,
    explicitAlignmentPreserved: 0,
    legacyAttrsRemoved: 0,
  };
}

const LEGACY_KEYS = ['lineSpacing', 'noIndent', 'textAlign'] as const;

function normalizeParagraphAttrs(
  attrs: Record<string, unknown> | undefined,
  stats: NormalizeStats
): { attrs: Record<string, unknown>; changed: boolean } {
  const source = attrs ?? {};
  let changed = false;

  // Start from whatever override values already exist (idempotency).
  const out: Record<string, unknown> = {
    textAlignOverride: isAlignment(source.textAlignOverride) ? source.textAlignOverride : null,
    firstLineIndentCmOverride:
      typeof source.firstLineIndentCmOverride === 'number'
        ? source.firstLineIndentCmOverride
        : null,
    leftIndentCmOverride:
      typeof source.leftIndentCmOverride === 'number' ? source.leftIndentCmOverride : null,
    rightIndentCmOverride:
      typeof source.rightIndentCmOverride === 'number' ? source.rightIndentCmOverride : null,
    spaceBeforePtOverride:
      typeof source.spaceBeforePtOverride === 'number' ? source.spaceBeforePtOverride : null,
    spaceAfterPtOverride:
      typeof source.spaceAfterPtOverride === 'number' ? source.spaceAfterPtOverride : null,
    lineSpacingOverride:
      typeof source.lineSpacingOverride === 'number' ? source.lineSpacingOverride : null,
  };

  // --- legacy lineSpacing ---------------------------------------------------
  if ('lineSpacing' in source) {
    const legacy = source.lineSpacing;
    if (typeof legacy === 'number' && Number.isFinite(legacy)) {
      if (legacy === LEGACY_DEFAULT_LINE_SPACING) {
        // Baked historical default -> inherit.
        stats.bakedLineSpacingCleared += 1;
      } else if (out.lineSpacingOverride === null) {
        // A genuine explicit non-default value is preserved.
        out.lineSpacingOverride = legacy;
        stats.explicitLineSpacingPreserved += 1;
      }
    }
    changed = true;
  }

  // --- legacy noIndent ------------------------------------------------------
  if ('noIndent' in source) {
    const legacy = source.noIndent;
    if (legacy === true) {
      // "No first-line indent" is expressed in the new model as an explicit 0.
      if (out.firstLineIndentCmOverride === null) {
        out.firstLineIndentCmOverride = 0;
        stats.explicitIndentPreserved += 1;
      }
    } else {
      // false was the default -> inherit.
      stats.bakedNoIndentCleared += 1;
    }
    changed = true;
  }

  // --- legacy textAlign -----------------------------------------------------
  if ('textAlign' in source) {
    const legacy = source.textAlign;
    if (isAlignment(legacy)) {
      // The old TextAlign extension defaulted to null, so any non-null value
      // means the author pressed an alignment button. Preserve it.
      if (out.textAlignOverride === null) {
        out.textAlignOverride = legacy;
        stats.explicitAlignmentPreserved += 1;
      }
    }
    changed = true;
  }

  if (changed) stats.legacyAttrsRemoved += 1;

  // Carry forward any unrelated attributes we do not manage, minus legacy keys.
  for (const [key, value] of Object.entries(source)) {
    if ((LEGACY_KEYS as readonly string[]).includes(key)) continue;
    if (key in out) continue;
    out[key] = value;
  }

  return { attrs: out, changed };
}

function walk(node: Node, stats: NormalizeStats, flags: { changed: boolean }): Node {
  const next: Node = { ...node };

  if (node.type === 'paragraph') {
    stats.paragraphsVisited += 1;
    const { attrs, changed } = normalizeParagraphAttrs(node.attrs, stats);
    next.attrs = attrs;
    if (changed) flags.changed = true;
  }

  if (Array.isArray(node.content)) {
    next.content = node.content.map((child) => walk(child, stats, flags));
  }

  return next;
}

/**
 * Converts a stored Tiptap document to the tri-state override model.
 * Returns a new document; the input is never mutated.
 */
export function normalizeManuscriptDoc<T extends { type?: string; content?: unknown[] }>(
  doc: T | null | undefined
): NormalizeResult<T> {
  const stats = emptyStats();
  const flags = { changed: false };

  if (!doc || !Array.isArray(doc.content)) {
    return { doc: (doc ?? { type: 'doc', content: [] }) as T, stats, changed: false };
  }

  const normalized = {
    ...doc,
    content: (doc.content as Node[]).map((child) => walk(child, stats, flags)),
  } as T;

  return { doc: normalized, stats, changed: flags.changed };
}

/** True when a document still carries any pre-Stage-3 attribute. */
export function needsNormalization(doc: { content?: unknown[] } | null | undefined): boolean {
  if (!doc || !Array.isArray(doc.content)) return false;

  function scan(nodes: Node[]): boolean {
    for (const node of nodes) {
      if (node?.attrs && LEGACY_KEYS.some((k) => k in node.attrs!)) return true;
      if (Array.isArray(node?.content) && scan(node.content)) return true;
    }
    return false;
  }

  return scan(doc.content as Node[]);
}

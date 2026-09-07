/**
 * The manuscript schema contract. (Audit H2, Stage 3F)
 *
 * StarterKit was previously enabled with only `heading` disabled, leaving
 * bulletList, orderedList, listItem, blockquote, codeBlock and horizontalRule
 * live in the schema — none of which the DOCX mapper handled. A list therefore
 * exported as a paragraph of empty runs: silent content loss.
 *
 * A novel manuscript needs prose, breaks and inline emphasis. Those extra block
 * types are disabled rather than left enabled-but-unexportable, and this module
 * is the single declaration both the editor and the exporter agree on.
 *
 * Adding a node here without teaching the DOCX mapper about it will make
 * `tests/unit/docx-export.test.ts` fail, by design.
 */

/** Block-level node types the manuscript may contain. */
export const SUPPORTED_NODE_TYPES = [
  'doc',
  'paragraph',
  'text',
  'hardBreak',
  'sceneBreak',
  'pageBreak',
] as const;

/** Inline marks the manuscript may contain. */
export const SUPPORTED_MARK_TYPES = [
  'bold',
  'italic',
  'underline',
  'strike',
  'textStyle',
] as const;

export type SupportedNodeType = (typeof SUPPORTED_NODE_TYPES)[number];
export type SupportedMarkType = (typeof SUPPORTED_MARK_TYPES)[number];

const NODE_SET: ReadonlySet<string> = new Set(SUPPORTED_NODE_TYPES);
const MARK_SET: ReadonlySet<string> = new Set(SUPPORTED_MARK_TYPES);

export function isSupportedNode(type: string | undefined): type is SupportedNodeType {
  return typeof type === 'string' && NODE_SET.has(type);
}

export function isSupportedMark(type: string | undefined): type is SupportedMarkType {
  return typeof type === 'string' && MARK_SET.has(type);
}

/**
 * StarterKit options that disable every block type the manuscript does not use.
 * Kept beside the contract above so the two cannot drift.
 */
export const STARTER_KIT_OPTIONS = {
  heading: false,
  // Replaced by ManuscriptParagraph, which renders explicit overrides inline.
  paragraph: false,
  bulletList: false,
  orderedList: false,
  listItem: false,
  blockquote: false,
  codeBlock: false,
  horizontalRule: false,
  code: false,
} as const;

/** Raised when export meets a node the mapper does not know how to write. */
export class UnsupportedNodeError extends Error {
  constructor(readonly nodeType: string, readonly path: string) {
    super(
      `DOCX export encountered an unsupported node "${nodeType}" at ${path}. ` +
        `Supported nodes: ${SUPPORTED_NODE_TYPES.join(', ')}. ` +
        `Refusing to export rather than silently dropping manuscript content.`
    );
    this.name = 'UnsupportedNodeError';
  }
}

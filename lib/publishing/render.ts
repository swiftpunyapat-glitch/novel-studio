/**
 * Controlled Tiptap -> HTML renderer for published snapshots. (Audit C2)
 *
 * The previous implementation built HTML by interpolating raw manuscript text
 * into a template string, which the public reader then injected with
 * `dangerouslySetInnerHTML` — a stored XSS.
 *
 * This renderer is an allow-list, not a sanitizer: it walks the Tiptap document
 * and emits markup ONLY for node and mark types it explicitly knows. Anything
 * unrecognised is dropped (its text is preserved where that is meaningful), and
 * every piece of text and every attribute value is escaped or drawn from a fixed
 * enumeration. There is no code path that can emit an attacker-authored tag,
 * attribute, or URL.
 *
 * Rendering from the Tiptap tree rather than from plainText also restores the
 * inline formatting that the old plain-text pipeline discarded.
 */

export interface TiptapNode {
  type?: string;
  text?: string;
  marks?: Array<{ type?: string }>;
  content?: TiptapNode[];
  attrs?: Record<string, unknown>;
}

export interface TiptapDoc {
  type?: string;
  content?: TiptapNode[];
}

/** Guards against a pathological or hand-crafted deeply nested document. */
const MAX_DEPTH = 40;

const ALIGNMENTS = new Set(['left', 'center', 'right', 'justify']);

/** Inline marks that may survive into published HTML, and their tags. */
const MARK_TAGS: Record<string, string> = {
  bold: 'strong',
  italic: 'em',
  underline: 'u',
  strike: 's',
};

/** Block containers whose children are rendered recursively. */
const BLOCK_WRAPPERS: Record<string, string> = {
  blockquote: 'blockquote',
  bulletList: 'ul',
  orderedList: 'ol',
  listItem: 'li',
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Renders a text node's escaped content wrapped in its allowed marks. */
function renderText(node: TiptapNode): string {
  const text = escapeHtml(node.text ?? '');
  if (!text) return '';

  const marks = Array.isArray(node.marks) ? node.marks : [];
  // Deduplicate and keep a stable order so output is deterministic.
  const tags: string[] = [];
  for (const key of Object.keys(MARK_TAGS)) {
    if (marks.some((m) => m?.type === key)) tags.push(MARK_TAGS[key]);
  }

  let html = text;
  for (let i = tags.length - 1; i >= 0; i--) {
    html = `<${tags[i]}>${html}</${tags[i]}>`;
  }
  return html;
}

/**
 * Builds the class attribute for a paragraph from a fixed enumeration.
 * An attacker-supplied `textAlign` can never reach the output.
 */
function paragraphClass(attrs: Record<string, unknown> | undefined): string {
  const classes: string[] = [];

  const align = attrs?.textAlign;
  if (typeof align === 'string' && ALIGNMENTS.has(align)) {
    classes.push(`align-${align}`);
  }
  if (attrs?.noIndent === true) {
    classes.push('no-indent');
  }

  return classes.length ? ` class="${classes.join(' ')}"` : '';
}

function renderChildren(nodes: TiptapNode[] | undefined, depth: number): string {
  if (!Array.isArray(nodes)) return '';
  let out = '';
  for (const child of nodes) out += renderNode(child, depth);
  return out;
}

function renderNode(node: TiptapNode | null | undefined, depth: number): string {
  if (!node || depth > MAX_DEPTH) return '';

  switch (node.type) {
    case 'text':
      return renderText(node);

    case 'hardBreak':
      return '<br>';

    case 'horizontalRule':
      return '<hr>';

    case 'sceneBreak':
      return '<div class="novel-scene-break" aria-hidden="true"></div>';

    case 'pageBreak':
      return '<div class="novel-page-break" aria-hidden="true"></div>';

    case 'paragraph': {
      const inner = renderChildren(node.content, depth + 1);
      // Preserve deliberate blank paragraphs as spacing, not collapsed markup.
      return `<p${paragraphClass(node.attrs)}>${inner || '<br>'}</p>`;
    }

    default: {
      const wrapper = node.type ? BLOCK_WRAPPERS[node.type] : undefined;
      if (wrapper) {
        return `<${wrapper}>${renderChildren(node.content, depth + 1)}</${wrapper}>`;
      }
      // Unknown node: drop the node and its attributes entirely, but do not
      // silently discard prose that happens to live inside it.
      return renderChildren(node.content, depth + 1);
    }
  }
}

/** Renders a Tiptap document to HTML that is safe to inject into the reader. */
export function renderTiptapToSafeHtml(doc: TiptapDoc | null | undefined): string {
  if (!doc || !Array.isArray(doc.content)) return '';
  return renderChildren(doc.content, 0);
}

/**
 * Plain-text projection of a published snapshot, used for search and previews.
 * Kept alongside the renderer so both derive from the same tree.
 */
export function renderTiptapToPlainText(doc: TiptapDoc | null | undefined): string {
  if (!doc || !Array.isArray(doc.content)) return '';

  const lines: string[] = [];

  function walk(node: TiptapNode | undefined, depth: number): string {
    if (!node || depth > MAX_DEPTH) return '';
    if (node.type === 'text') return node.text ?? '';
    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'sceneBreak') {
      lines.push('***');
      return '';
    }
    if (node.type === 'pageBreak') return '';

    const inner = (node.content ?? []).map((c) => walk(c, depth + 1)).join('');
    if (node.type === 'paragraph' || node.type === 'listItem') {
      lines.push(inner);
      return '';
    }
    return inner;
  }

  for (const node of doc.content) {
    const trailing = walk(node, 0);
    if (trailing) lines.push(trailing);
  }

  return lines.join('\n').trim();
}

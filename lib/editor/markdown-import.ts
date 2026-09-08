/**
 * Markdown → manuscript import. (Stage 6A)
 *
 * Converts a `.md` draft into the manuscript's own document model, so an author
 * who wrote a chapter elsewhere can bring it in.
 *
 * THE CONSTRAINT THAT SHAPES EVERYTHING HERE: the manuscript schema is
 * deliberately narrow. `lib/editor/manuscript-schema.ts` allows paragraphs,
 * hard breaks, scene breaks, scene headers and page breaks — and nothing else.
 * Headings, lists, blockquotes and code blocks are not merely unstyled, they
 * are absent, and the DOCX exporter throws `UnsupportedNodeError` rather than
 * emitting a node it cannot write. So this importer cannot pass Markdown's
 * block types through; it must decide what each one BECOMES:
 *
 *   # Heading      → a centred, bold paragraph with no first-line indent
 *   *** --- ___    → a scene break
 *   - item         → a paragraph, bulleted with "• "
 *   1. item        → a paragraph, keeping its number
 *   > quote        → a paragraph, marker removed
 *   ```code```     → paragraphs, verbatim, no inline parsing
 *   **bold** etc.  → the bold / italic / strike marks the schema does have
 *   `code`         → its text (there is no code mark to carry it)
 *   [t](url)       → "t (url)", so the address is not silently lost
 *   ![alt](url)    → the alt text; there is no image node
 *
 * Nothing is dropped without being counted: every lossy conversion above
 * increments a figure in `MarkdownImportStats`, which the dialog shows the
 * author before they accept the import.
 *
 * Written by hand rather than with a Markdown library, because a CommonMark
 * parser's whole value is the node types this schema forbids — the output would
 * have to be flattened back down anyway — and because the repository has no
 * runtime dependency it did not need.
 *
 * Pure: a string in, manuscript JSON out. It performs no save and touches no
 * editor; `ImportMarkdownDialog` decides what to do with the result.
 */

import { extractPlainTextFromTiptap, calculateWordCount } from '@/lib/editor/plain-text';
import {
  SCENE_HEADER_SEPARATOR,
  normalizeSceneHeaderField,
} from '@/lib/editor/scene-header';

export interface MarkdownImportStats {
  paragraphs: number;
  sceneBreaks: number;
  /** Quoted lines recovered as scene header nodes rather than prose. */
  sceneHeaders: number;
  /** `<!-- PAGE BREAK -->` markers recovered as real page breaks. */
  pageBreaks: number;
  /** HTML comments removed instead of being shown as text. */
  htmlCommentsDropped: number;
  /** Headings flattened into centred bold paragraphs. */
  headings: number;
  listItems: number;
  blockquoteLines: number;
  codeLines: number;
  hardBreaks: number;
  /** Links whose URL was appended to the link text. */
  links: number;
  /** Images reduced to their alt text. */
  imagesDropped: number;
  frontMatterStripped: boolean;
  wordCount: number;
  characterCount: number;
}

export interface ManuscriptDoc {
  type: 'doc';
  content: ManuscriptNode[];
}

export interface ManuscriptNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ManuscriptNode[];
  marks?: Array<{ type: string }>;
  text?: string;
}

export interface MarkdownImportResult {
  content: ManuscriptDoc;
  plainText: string;
  stats: MarkdownImportStats;
}

function emptyStats(): MarkdownImportStats {
  return {
    paragraphs: 0,
    sceneBreaks: 0,
    sceneHeaders: 0,
    pageBreaks: 0,
    htmlCommentsDropped: 0,
    headings: 0,
    listItems: 0,
    blockquoteLines: 0,
    codeLines: 0,
    hardBreaks: 0,
    links: 0,
    imagesDropped: 0,
    frontMatterStripped: false,
    wordCount: 0,
    characterCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Line joining
// ---------------------------------------------------------------------------

/**
 * Thai, and the scripts that behave like it for line breaking.
 *
 * This matters more than it looks. Markdown joins a soft-wrapped line to the
 * next with a space, which is right for English and WRONG for Thai: Thai does
 * not separate words with spaces, so a file hard-wrapped at 80 columns would
 * come in with a spurious space in the middle of every wrapped word. The join
 * is therefore script-aware, exactly as browsers are when they lay Thai out.
 */
const NO_SPACE_SCRIPTS = new RegExp(
  '[' +
    '\u0E00-\u0E7F' + // Thai
    '\u0F00-\u0FFF' + // Tibetan
    '\u1000-\u109F' + // Myanmar
    '\u1780-\u17FF' + // Khmer
    '\u3000-\u9FFF' + // CJK and kana
    '\uF900-\uFAFF' + // CJK compatibility
    '\uFF00-\uFFEF' + // halfwidth and fullwidth forms
    ']'
);

/** Whether joining two soft-wrapped lines needs a space between them. */
export function needsJoiningSpace(before: string, after: string): boolean {
  if (!before || !after) return false;
  const last = before[before.length - 1];
  const first = after[0];
  if (/\s/.test(last) || /\s/.test(first)) return false;
  return !NO_SPACE_SCRIPTS.test(last) && !NO_SPACE_SCRIPTS.test(first);
}

// ---------------------------------------------------------------------------
// Masking
//
// Escapes and code spans must survive the emphasis parser untouched. They are
// lifted out into a table first and restored into the finished text nodes, so
// `\*not italic\*` and `` `a * b` `` cannot be reinterpreted.
// ---------------------------------------------------------------------------

const MASK_OPEN = '\u0000';
const MASK_CLOSE = '\u0001';
/** Marks an explicit hard break while the paragraph is still one string. */
const HARD_BREAK_SENTINEL = '\u0002';

interface Masked {
  text: string;
  table: string[];
}

function mask(table: string[], value: string): string {
  table.push(value);
  return `${MASK_OPEN}${table.length - 1}${MASK_CLOSE}`;
}

function unmask(text: string, table: string[]): string {
  return text.replace(
    new RegExp(`${MASK_OPEN}(\\d+)${MASK_CLOSE}`, 'g'),
    (_, index) => table[Number(index)] ?? ''
  );
}

const ESCAPABLE = /\\([\\`*_{}[\]()#+\-.!~>|])/g;
const CODE_SPAN = /`([^`\n]+)`/g;

function maskLiterals(input: string): Masked {
  const table: string[] = [];
  const text = input
    .replace(ESCAPABLE, (_, char) => mask(table, char))
    .replace(CODE_SPAN, (_, code) => mask(table, code));
  return { text, table };
}

// ---------------------------------------------------------------------------
// Inline parsing
// ---------------------------------------------------------------------------

const IMAGE = /!\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g;
const LINK = /\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g;

/**
 * Reduces links and images to prose.
 *
 * A link keeps its text, and its URL is appended when the two differ — an
 * address the author typed is information, and losing it on import would be
 * unrecoverable without going back to the original file.
 */
function flattenLinksAndImages(text: string, stats: MarkdownImportStats): string {
  return text
    .replace(IMAGE, (_, alt: string) => {
      stats.imagesDropped += 1;
      return alt;
    })
    .replace(LINK, (_, label: string, url: string) => {
      stats.links += 1;
      const trimmed = url.trim();
      if (!trimmed || trimmed === label.trim()) return label;
      return `${label} (${trimmed})`;
    });
}

interface InlineRule {
  pattern: RegExp;
  mark: string;
}

/**
 * Longest delimiters first: `**` must be tried before `*`, or every bold run
 * would parse as an italic containing a stray asterisk.
 *
 * The `_` forms require a non-word character on each side, so `snake_case` and
 * `file_name_here` are left alone.
 */
const INLINE_RULES: InlineRule[] = [
  { pattern: /\*\*([\s\S]+?)\*\*/, mark: 'bold' },
  { pattern: /(?<![A-Za-z0-9])__([\s\S]+?)__(?![A-Za-z0-9])/, mark: 'bold' },
  { pattern: /~~([\s\S]+?)~~/, mark: 'strike' },
  { pattern: /\*([\s\S]+?)\*/, mark: 'italic' },
  { pattern: /(?<![A-Za-z0-9])_([\s\S]+?)_(?![A-Za-z0-9])/, mark: 'italic' },
];

/**
 * Splits a masked string into text nodes carrying the marks that apply.
 *
 * Recursive rather than a single pass, so `**bold with *italic* inside**`
 * nests correctly.
 */
function parseInline(
  text: string,
  marks: string[],
  table: string[],
  stats: MarkdownImportStats
): ManuscriptNode[] {
  if (!text) return [];

  for (const rule of INLINE_RULES) {
    const match = rule.pattern.exec(text);
    if (!match || match.index === undefined) continue;

    const before = text.slice(0, match.index);
    const after = text.slice(match.index + match[0].length);
    const nextMarks = marks.includes(rule.mark) ? marks : [...marks, rule.mark];

    return [
      ...parseInline(before, marks, table, stats),
      ...parseInline(match[1], nextMarks, table, stats),
      ...parseInline(after, marks, table, stats),
    ];
  }

  // No delimiters left: emit text, splitting on any explicit hard breaks.
  const nodes: ManuscriptNode[] = [];
  const pieces = text.split(HARD_BREAK_SENTINEL);

  pieces.forEach((piece, index) => {
    if (index > 0) {
      nodes.push({ type: 'hardBreak' });
      stats.hardBreaks += 1;
    }
    const restored = unmask(piece, table);
    if (restored) {
      nodes.push({
        type: 'text',
        text: restored,
        ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
      });
    }
  });

  return nodes;
}

// ---------------------------------------------------------------------------
// Block parsing
// ---------------------------------------------------------------------------

const FRONT_MATTER_FENCE = /^---\s*$/;
const THEMATIC_BREAK = /^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/;
const ATX_HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const UNORDERED_ITEM = /^\s*[-*+]\s+(.*)$/;
const ORDERED_ITEM = /^\s*(\d{1,9})[.)]\s+(.*)$/;
const BLOCKQUOTE = /^\s{0,3}>\s?(.*)$/;
const CODE_FENCE = /^\s*(```|~~~)/;

/**
 * Round-tripping this application's own Markdown export. (Stage 6A follow-up)
 *
 * `lib/markdown/generator.ts` writes a page break as an HTML comment and a
 * scene header as a one-line blockquote. Without the three patterns below, a
 * chapter exported and then re-imported came back with the literal text
 * "<!-- PAGE BREAK -->" in the prose and its scene headers flattened to
 * ordinary paragraphs — and the marker would then be exported into the DOCX.
 */

/** A whole line that is nothing but an HTML comment. */
const HTML_COMMENT_LINE = /^\s*<!--([\s\S]*?)-->\s*$/;
/** The opening of a comment that continues on later lines. */
const HTML_COMMENT_OPEN = /^\s*<!--/;
/** An HTML comment appearing inside a line of prose. */
const HTML_COMMENT_INLINE = /<!--[\s\S]*?-->/g;
/** The page-break marker the exporter emits, whitespace- and case-tolerant. */
const PAGE_BREAK_COMMENT = /^\s*page\s*break\s*$/i;
/** A bare clock time, the one unambiguous single-field scene header. */
const TIME_ONLY = /^\d{1,2}[:.]\d{2}$/;

/**
 * Reads a one-line blockquote as a scene header, or returns null.
 *
 * Deliberately narrow, because a novel legitimately contains one-line quotes.
 * Only two shapes are claimed: the exporter's own "time — location" join, and a
 * line that is nothing but a clock time. Anything else stays a paragraph, which
 * is the safe direction to be wrong in.
 */
function readSceneHeader(
  text: string
): { timeText: string | null; locationText: string | null } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(SCENE_HEADER_SEPARATOR);
  if (parts.length === 2) {
    const timeText = normalizeSceneHeaderField(parts[0]);
    const locationText = normalizeSceneHeaderField(parts[1]);
    if (timeText || locationText) return { timeText, locationText };
    return null;
  }

  if (TIME_ONLY.test(trimmed)) {
    return { timeText: trimmed, locationText: null };
  }

  return null;
}
/** Two or more trailing spaces, or a trailing backslash: an explicit break. */
const HARD_BREAK_SUFFIX = /(\s{2,}|\\)$/;

/**
 * Strips YAML front matter.
 *
 * Obsidian and most Markdown editors put it at the top of every file. Left in
 * place, its closing `---` would import as a scene break and its keys as prose.
 */
function stripFrontMatter(lines: string[], stats: MarkdownImportStats): string[] {
  if (lines.length < 2 || !FRONT_MATTER_FENCE.test(lines[0])) return lines;

  for (let i = 1; i < lines.length; i++) {
    if (FRONT_MATTER_FENCE.test(lines[i])) {
      stats.frontMatterStripped = true;
      return lines.slice(i + 1);
    }
  }
  return lines;
}

interface PendingLine {
  text: string;
  /** The line ended with an explicit hard break. */
  hard: boolean;
}

function paragraphNode(
  content: ManuscriptNode[],
  attrs: Record<string, unknown> = {}
): ManuscriptNode {
  return { type: 'paragraph', attrs, content };
}

/** A heading has no equivalent node, so it becomes a centred, bold line. */
function headingAttrs(): Record<string, unknown> {
  return { textAlignOverride: 'center', firstLineIndentCmOverride: 0 };
}

/**
 * The two node types describe the same ProseMirror JSON; the plain-text
 * reader's is merely looser, carrying an index signature so it can walk
 * documents it did not build. The cast says so in one place.
 */
export function asTiptapDoc(
  doc: ManuscriptDoc
): Parameters<typeof extractPlainTextFromTiptap>[0] {
  return doc as unknown as Parameters<typeof extractPlainTextFromTiptap>[0];
}

export function parseMarkdownToManuscript(markdown: string): MarkdownImportResult {
  const stats = emptyStats();
  const blocks: ManuscriptNode[] = [];

  const rawLines = (markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  const lines = stripFrontMatter(rawLines, stats);

  let pending: PendingLine[] = [];

  /**
   * Turns the buffered lines into one paragraph and clears the buffer.
   *
   * `baseMarks` applies to the whole paragraph — a heading is bold throughout,
   * and any emphasis inside it nests on top rather than replacing it.
   */
  const flush = (attrs?: Record<string, unknown>, baseMarks: string[] = []) => {
    if (pending.length === 0) return;

    let joined = '';
    pending.forEach((line, index) => {
      if (index > 0) {
        const previous = pending[index - 1];
        if (previous.hard) {
          joined += HARD_BREAK_SENTINEL;
        } else if (needsJoiningSpace(joined, line.text)) {
          joined += ' ';
        }
      }
      joined += line.text;
    });

    pending = [];

    const withoutRefs = flattenLinksAndImages(joined, stats);
    const masked = maskLiterals(withoutRefs);
    const content = parseInline(masked.text, baseMarks, masked.table, stats);

    blocks.push(paragraphNode(content, attrs));
    stats.paragraphs += 1;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ---- fenced code: verbatim, and never parsed for emphasis --------------
    if (CODE_FENCE.test(line)) {
      flush();
      const fence = line.trim().slice(0, 3);
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) {
        blocks.push(paragraphNode([{ type: 'text', text: lines[i] }]));
        stats.paragraphs += 1;
        stats.codeLines += 1;
        i += 1;
      }
      continue;
    }

    // ---- HTML comments -----------------------------------------------------
    // Checked before everything except code fences, so a comment is never
    // shown as prose. The exporter's page-break marker is recovered as a real
    // page break; any other comment is an editor's private note and is removed.
    const commentLine = HTML_COMMENT_LINE.exec(line);
    if (commentLine) {
      flush();
      if (PAGE_BREAK_COMMENT.test(commentLine[1])) {
        blocks.push({ type: 'pageBreak' });
        stats.pageBreaks += 1;
      } else {
        stats.htmlCommentsDropped += 1;
      }
      continue;
    }

    // A comment spanning several lines: skip to its close.
    if (HTML_COMMENT_OPEN.test(line) && !line.includes('-->')) {
      flush();
      const start = i;
      while (i < lines.length && !lines[i].includes('-->')) i += 1;
      // An unterminated comment is malformed; treat it as prose rather than
      // swallowing the rest of the file.
      if (i >= lines.length) {
        i = start;
      } else {
        stats.htmlCommentsDropped += 1;
        continue;
      }
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    if (THEMATIC_BREAK.test(line)) {
      flush();
      blocks.push({ type: 'sceneBreak' });
      stats.sceneBreaks += 1;
      continue;
    }

    const heading = ATX_HEADING.exec(line);
    if (heading) {
      flush();
      pending.push({ text: heading[2], hard: false });
      flush(headingAttrs(), ['bold']);
      stats.headings += 1;
      continue;
    }

    const unordered = UNORDERED_ITEM.exec(line);
    if (unordered) {
      flush();
      pending.push({ text: `• ${unordered[1]}`, hard: false });
      flush();
      stats.listItems += 1;
      continue;
    }

    const ordered = ORDERED_ITEM.exec(line);
    if (ordered) {
      flush();
      pending.push({ text: `${ordered[1]}. ${ordered[2]}`, hard: false });
      flush();
      stats.listItems += 1;
      continue;
    }

    const quote = BLOCKQUOTE.exec(line);
    if (quote) {
      // A scene header is a blockquote standing on its own: nothing buffered
      // before it, and no quoted line after it. A multi-line quote is prose.
      const standalone = pending.length === 0 && !BLOCKQUOTE.test(lines[i + 1] ?? '');
      const header = standalone ? readSceneHeader(quote[1]) : null;

      if (header) {
        blocks.push({ type: 'sceneHeader', attrs: header });
        stats.sceneHeaders += 1;
        continue;
      }

      stats.blockquoteLines += 1;
      pending.push({ text: quote[1], hard: HARD_BREAK_SUFFIX.test(quote[1]) });
      continue;
    }

    // Strip a comment embedded in a line of prose; the surrounding text stays.
    let text = line;
    if (HTML_COMMENT_INLINE.test(text)) {
      HTML_COMMENT_INLINE.lastIndex = 0;
      text = text.replace(HTML_COMMENT_INLINE, '');
      stats.htmlCommentsDropped += 1;
      if (!text.trim()) {
        flush();
        continue;
      }
    }

    pending.push({
      text: text.replace(HARD_BREAK_SUFFIX, ''),
      hard: HARD_BREAK_SUFFIX.test(text),
    });
  }

  flush();

  // A document must have at least one block, and an author who imported an
  // empty file should land in an empty chapter rather than a broken one.
  if (blocks.length === 0) {
    blocks.push(paragraphNode([]));
    stats.paragraphs = 1;
  }

  const content: ManuscriptDoc = { type: 'doc', content: blocks };
  const plainText = extractPlainTextFromTiptap(asTiptapDoc(content));
  const counts = calculateWordCount(plainText);

  stats.wordCount = counts.wordCount;
  stats.characterCount = counts.charCount;

  return { content, plainText, stats };
}

// ---------------------------------------------------------------------------
// Size
// ---------------------------------------------------------------------------

/**
 * Firestore's hard ceiling for one document: 1 MiB.
 *
 * The manuscript for a chapter lives in a single variant document, so this is
 * the real limit on an import — not the size of the `.md` file. The two are not
 * proportional: the stored form is the Tiptap JSON *and* a full plain-text copy,
 * and the JSON's per-paragraph overhead means a file of short lines expands far
 * more than one of long ones. Measured on ordinary prose the factor is roughly
 * 2.3x for Thai and 2.7x for English, and higher for dialogue.
 *
 * So the check below measures the parsed result rather than guessing from the
 * file, which is the only way to be accurate for both.
 */
export const FIRESTORE_DOCUMENT_LIMIT_BYTES = 1024 * 1024;

/**
 * What content and plainText may occupy. The remainder covers the variant's
 * own fields — ids, name, status, counts, timestamps — plus Firestore's
 * per-field overhead, which its size accounting includes and this does not.
 */
export const MAX_STORED_CONTENT_BYTES = 900 * 1024;

/**
 * Bytes this document would occupy in the variant it is saved to.
 *
 * Firestore's own accounting is more elaborate; this deliberately errs high by
 * measuring the serialized JSON, so a document that passes here is comfortably
 * inside the real limit rather than at its edge.
 */
export function estimateStoredBytes(doc: ManuscriptDoc, plainText: string): number {
  const payload = JSON.stringify({ content: doc, plainText });
  return typeof Buffer !== 'undefined'
    ? Buffer.byteLength(payload, 'utf8')
    : new TextEncoder().encode(payload).length;
}

export interface StoredSizeCheck {
  bytes: number;
  limit: number;
  fits: boolean;
}

/**
 * Whether an import can actually be saved, counting whatever the chapter
 * already holds when the author is appending rather than replacing.
 */
export function checkStoredSize(
  doc: ManuscriptDoc,
  plainText: string,
  existingBytes = 0
): StoredSizeCheck {
  const bytes = estimateStoredBytes(doc, plainText) + existingBytes;
  return { bytes, limit: MAX_STORED_CONTENT_BYTES, fits: bytes <= MAX_STORED_CONTENT_BYTES };
}

/**
 * The conversions that lose something, for the dialog to show before the author
 * accepts the import. An empty list means nothing was reinterpreted.
 */
export function describeLossyConversions(stats: MarkdownImportStats): string[] {
  const notes: string[] = [];

  if (stats.headings > 0) {
    notes.push(
      `${stats.headings} heading${stats.headings === 1 ? '' : 's'} → centred bold paragraphs`
    );
  }
  if (stats.listItems > 0) {
    notes.push(`${stats.listItems} list item${stats.listItems === 1 ? '' : 's'} → paragraphs`);
  }
  if (stats.blockquoteLines > 0) {
    notes.push(`${stats.blockquoteLines} quoted line${stats.blockquoteLines === 1 ? '' : 's'} → paragraphs`);
  }
  if (stats.codeLines > 0) {
    notes.push(`${stats.codeLines} code line${stats.codeLines === 1 ? '' : 's'} → plain paragraphs`);
  }
  if (stats.imagesDropped > 0) {
    notes.push(
      `${stats.imagesDropped} image${stats.imagesDropped === 1 ? '' : 's'} → alt text only`
    );
  }
  if (stats.links > 0) {
    notes.push(`${stats.links} link${stats.links === 1 ? '' : 's'} → text with the address in brackets`);
  }
  if (stats.htmlCommentsDropped > 0) {
    notes.push(
      `${stats.htmlCommentsDropped} HTML comment${
        stats.htmlCommentsDropped === 1 ? '' : 's'
      } removed`
    );
  }
  if (stats.frontMatterStripped) {
    notes.push('front matter removed');
  }

  return notes;
}

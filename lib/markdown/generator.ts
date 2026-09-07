/**
 * Manuscript → Markdown. (AI-friendly export)
 *
 * This output exists to be READ — by a model doing continuity or canon
 * analysis, and as durable archival text. It is deliberately not a second
 * rendering of the DOCX: print concerns (font, size, margins, indentation,
 * alignment, pagination) carry no meaning for a reader that cannot see a page,
 * so they are dropped rather than encoded.
 *
 * What survives is the structure a reader needs: which volume and chapter this
 * is, what the author titled it, when and where it happens, where scenes break,
 * and the prose itself with its emphasis intact.
 *
 * What never appears: Tiptap JSON, document/variant/revision/session ids, and
 * any print-only property. Those are either noise or internal detail, and an
 * archival text file is exactly the wrong place for both.
 *
 * Pure and dependency-free, so it can be unit tested without a browser and
 * without touching Firestore.
 */

import { sceneHeaderToText } from '@/lib/editor/scene-header';
import type { ChapterType } from '@/types/project';

export interface MarkdownNode {
  type?: string;
  text?: string;
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
  content?: MarkdownNode[];
  attrs?: Record<string, unknown>;
}

export interface MarkdownChapterInput {
  chapterNumber?: number | null;
  chapterType?: ChapterType;
  title?: string;
  subtitle?: string;
  dateText?: string;
  locationText?: string;
  volumeId?: string;
  content?: { type?: string; content?: MarkdownNode[] } | null;
}

export interface MarkdownVolumeInput {
  id: string;
  volumeNumber?: number | null;
  title?: string;
}

export interface MarkdownOptions {
  /** Volumes referenced by the exported chapters, used for H2 boundaries. */
  volumes?: MarkdownVolumeInput[];
}

/** Marker for an explicit author page break, per the export contract. */
export const PAGE_BREAK_MARKER = '<!-- PAGE BREAK -->';
/** Scene break marker. */
export const SCENE_BREAK_MARKER = '***';

/**
 * Escapes text so prose cannot be reinterpreted as Markdown structure.
 *
 * A line of dialogue beginning "— *maybe*" or a chapter that opens with "# "
 * must read as the author wrote it, not as emphasis or a heading. Escaping is
 * kept to characters that actually change meaning: over-escaping would litter
 * Thai prose with backslashes and make the file worse to read, which is the one
 * thing this format cannot afford.
 */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/([*_`[\]<>])/g, '\\$1');
}

/** Escapes characters that only carry meaning at the start of a line. */
function escapeLineStart(line: string): string {
  return line
    .replace(/^(\s*)(#{1,6})(\s)/, '$1\\$2$3')
    .replace(/^(\s*)([-+])(\s)/, '$1\\$2$3')
    .replace(/^(\s*)(>)/, '$1\\$2')
    .replace(/^(\s*)(\d+)([.)])(\s)/, '$1$2\\$3$4');
}

/** Wraps a run's text in the Markdown (or minimal HTML) its marks call for. */
function renderRun(node: MarkdownNode): string {
  const raw = node.text ?? '';
  if (!raw) return '';

  let out = escapeMarkdown(raw);
  const marks = Array.isArray(node.marks) ? node.marks : [];
  const has = (type: string) => marks.some((m) => m?.type === type);

  // Innermost first so nesting reads naturally: ***bold italic***.
  if (has('italic')) out = `*${out}*`;
  if (has('bold')) out = `**${out}**`;
  if (has('strike')) out = `~~${out}~~`;
  // Markdown has no underline. `<u>` keeps the author's intent rather than
  // silently discarding it; every other formatting mark (font family, size,
  // colour) is print-only and is dropped on purpose.
  if (has('underline')) out = `<u>${out}</u>`;

  return out;
}

/** Renders a paragraph's inline children to a single Markdown line. */
function renderInline(nodes: MarkdownNode[] | undefined): string {
  if (!Array.isArray(nodes)) return '';

  let out = '';
  for (const child of nodes) {
    if (!child) continue;
    if (child.type === 'text') {
      out += renderRun(child);
    } else if (child.type === 'hardBreak') {
      // CommonMark hard break: keeps the line split without ending the paragraph.
      out += '\\\n';
    } else if (Array.isArray(child.content)) {
      out += renderInline(child.content);
    }
  }
  return out;
}

/**
 * Converts one block node to Markdown blocks.
 * Unknown node types contribute their text, never their structure — an export
 * must not invent markup for something it does not understand.
 */
function renderBlock(node: MarkdownNode | undefined): string[] {
  if (!node) return [];

  switch (node.type) {
    case 'paragraph': {
      const line = renderInline(node.content);
      // Blank paragraphs are spacing in the editor and carry no meaning here.
      if (!line.trim()) return [];
      return [escapeLineStart(line)];
    }

    case 'sceneBreak':
      return [SCENE_BREAK_MARKER];

    case 'sceneHeader': {
      // Reuses the one projection DOCX, reader HTML and search already share,
      // so "18:30 — Bangkok" is joined identically everywhere.
      const text = sceneHeaderToText(node.attrs as never);
      if (!text) return [];
      return [`> ${escapeMarkdown(text)}`];
    }

    case 'pageBreak':
      return [PAGE_BREAK_MARKER];

    case 'hardBreak':
      return [];

    default: {
      if (Array.isArray(node.content)) {
        const line = renderInline(node.content);
        return line.trim() ? [escapeLineStart(line)] : [];
      }
      return [];
    }
  }
}

/** Chapter heading text, e.g. "Chapter 1 — The Long Road", "Prologue". */
export function chapterHeading(chapter: MarkdownChapterInput): string {
  const type: ChapterType = chapter.chapterType ?? 'chapter';
  const title = (chapter.title ?? '').trim();

  if (type === 'prologue' || type === 'epilogue') {
    const label = type === 'prologue' ? 'Prologue' : 'Epilogue';
    // A prologue titled "Prologue" should not read "Prologue — Prologue".
    if (!title || title.toLowerCase() === label.toLowerCase()) return label;
    return `${label} — ${title}`;
  }

  const hasNumber = chapter.chapterNumber !== null && chapter.chapterNumber !== undefined;
  if (!hasNumber) return title || 'Untitled Chapter';
  const label = `Chapter ${chapter.chapterNumber}`;
  return title ? `${label} — ${title}` : label;
}

/** Volume heading text, e.g. "Volume 1 — Bangkok Nights". */
function volumeHeading(volume: MarkdownVolumeInput): string {
  const title = (volume.title ?? '').trim();
  const hasNumber = volume.volumeNumber !== null && volume.volumeNumber !== undefined;
  const label = hasNumber ? `Volume ${volume.volumeNumber}` : title || 'Volume';
  if (!hasNumber) return label;
  return title ? `${label} — ${title}` : label;
}

/**
 * Renders a manuscript selection as one Markdown document.
 *
 * One export action produces one file: multi-chapter and whole-manuscript
 * exports are a single string, with volume boundaries as H2 and each
 * chapter/prologue/epilogue as H3.
 */
export function generateManuscriptMarkdown(
  projectTitle: string,
  chapters: MarkdownChapterInput[],
  options: MarkdownOptions = {}
): string {
  const blocks: string[] = [];

  blocks.push(`# ${escapeMarkdown(projectTitle.trim() || 'Untitled Manuscript')}`);

  const volumesById = new Map(
    (options.volumes ?? []).map((v) => [v.id, v] as const)
  );
  let lastVolumeId: string | null = null;

  for (const chapter of chapters) {
    // A volume heading is emitted when the volume changes, so a single-chapter
    // export still says which volume it came from.
    const volume = chapter.volumeId ? volumesById.get(chapter.volumeId) : undefined;
    if (volume && chapter.volumeId !== lastVolumeId) {
      blocks.push(`## ${escapeMarkdown(volumeHeading(volume))}`);
      lastVolumeId = chapter.volumeId ?? null;
    }

    blocks.push(`### ${escapeMarkdown(chapterHeading(chapter))}`);

    const subtitle = (chapter.subtitle ?? '').trim();
    if (subtitle) blocks.push(`*${escapeMarkdown(subtitle)}*`);

    // Metadata is omitted entirely when blank rather than emitted empty.
    const meta: string[] = [];
    const date = (chapter.dateText ?? '').trim();
    const location = (chapter.locationText ?? '').trim();
    if (date) meta.push(`**Date:** ${escapeMarkdown(date)}`);
    if (location) meta.push(`**Location:** ${escapeMarkdown(location)}`);
    if (meta.length) blocks.push(meta.join('\n'));

    for (const node of chapter.content?.content ?? []) {
      blocks.push(...renderBlock(node));
    }
  }

  // One blank line between blocks, and a trailing newline so the file ends cleanly.
  return `${blocks.join('\n\n')}\n`;
}

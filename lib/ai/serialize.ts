import { NextResponse } from 'next/server';

/**
 * Response projections for the read-only AI API. (Stage 5A)
 *
 * The rule this file exists to enforce: a route returns FIELDS IT NAMES, never
 * a Firestore document. `{ id: doc.id, ...doc.data() }` looks harmless and is
 * the opposite of an allowlist — it publishes whatever the document happens to
 * hold today and, worse, silently publishes whatever is added tomorrow. A field
 * added to the Chapter model for some internal purpose would start flowing to
 * an external AI client with nothing in the diff to suggest it.
 *
 * So every shape below is written out by hand, and every value is coerced
 * rather than trusted: a document written by an older client, or by hand, does
 * not get to decide the type of a field in the response.
 *
 * Nothing here is a write path. This module reads and narrows; it never
 * constructs anything that could be stored.
 */

/** Manuscript text is private. It must not sit in a proxy or browser cache. */
const NO_STORE = 'no-store, private';

export function aiJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': NO_STORE },
  });
}

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

type Doc = FirebaseFirestore.DocumentData;

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** An optional string field is omitted entirely rather than sent as "". */
function optionalStr(value: unknown): string | undefined {
  const s = typeof value === 'string' ? value.trim() : '';
  return s ? s : undefined;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Prologue and epilogue legitimately have no chapter number. */
function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean {
  return value === true;
}

const CHAPTER_TYPES = new Set(['prologue', 'chapter', 'epilogue']);

/** Backward compatible: a document written before chapterType existed. */
function chapterType(value: unknown): 'prologue' | 'chapter' | 'epilogue' {
  return typeof value === 'string' && CHAPTER_TYPES.has(value)
    ? (value as 'prologue' | 'chapter' | 'epilogue')
    : 'chapter';
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface AiProjectSummary {
  id: string;
  title: string;
  slug: string;
  description: string;
  isPublished: boolean;
  createdAt: number;
  updatedAt: number;
}

export function projectSummary(id: string, data: Doc): AiProjectSummary {
  return {
    id,
    title: str(data.title),
    slug: str(data.slug),
    description: str(data.description),
    isPublished: bool(data.isPublished),
    createdAt: num(data.createdAt),
    updatedAt: num(data.updatedAt),
  };
}

export interface AiVolumeSummary {
  id: string;
  volumeNumber: number;
  title: string;
  order: number;
}

export function volumeSummary(id: string, data: Doc): AiVolumeSummary {
  return {
    id,
    volumeNumber: num(data.volumeNumber),
    title: str(data.title),
    order: num(data.order),
  };
}

export interface AiChapterSummary {
  id: string;
  volumeId: string;
  chapterType: 'prologue' | 'chapter' | 'epilogue';
  chapterNumber: number | null;
  title: string;
  subtitle?: string;
  dateText?: string;
  locationText?: string;
  order: number;
  wordCount: number;
  updatedAt: number;
}

/**
 * A chapter as it appears in the structure listing — metadata only, no prose.
 *
 * Deliberately absent: `activeVariantId`, `publishedRevisionId` and every other
 * piece of internal plumbing. A reader asks for a chapter by its own id; it has
 * no business knowing which variant document backs it.
 */
export function chapterSummary(id: string, data: Doc): AiChapterSummary {
  return {
    id,
    volumeId: str(data.volumeId),
    chapterType: chapterType(data.chapterType),
    chapterNumber: numOrNull(data.chapterNumber),
    title: str(data.title),
    subtitle: optionalStr(data.subtitle),
    dateText: optionalStr(data.dateText),
    locationText: optionalStr(data.locationText),
    order: num(data.order),
    wordCount: num(data.totalWordCount),
    updatedAt: num(data.updatedAt),
  };
}

export interface AiChapterText extends AiChapterSummary {
  projectId: string;
  variantName: string;
  /** Plain text only. The manuscript's Tiptap JSON is never exposed. */
  plainText: string;
  characterCount: number;
}

export function chapterText(
  projectId: string,
  id: string,
  chapter: Doc,
  variant: Doc | null
): AiChapterText {
  const plainText = str(variant?.plainText);
  return {
    ...chapterSummary(id, chapter),
    projectId,
    variantName: str(variant?.name),
    plainText,
    // Read from the variant rather than the chapter: `totalWordCount` tracks
    // the active variant and can lag a save the chapter document missed.
    wordCount: num(variant?.wordCount, num(chapter.totalWordCount)),
    characterCount: num(variant?.characterCount, plainText.length),
  };
}

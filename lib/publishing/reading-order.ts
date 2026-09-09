/**
 * The order a published book is read in.
 *
 * A chapter's `order` is only meaningful inside its volume — two volumes both
 * begin at 1 — so sorting the flat chapter collection by `order` alone
 * interleaves them. That was survivable while every "next chapter" was a click
 * the reader could correct; it is not survivable once the reader scrolls
 * straight from one chapter into the next, which is what continuous reading
 * does. So volume order comes first, and chapter order decides within it.
 *
 * Pure and dependency-free: the reader page, the continuation API and the tests
 * all sort through this one function rather than each writing the comparison.
 */

export interface OrderedVolume {
  id: string;
  order?: number | null;
}

export interface OrderedChapter {
  id: string;
  volumeId?: string | null;
  order?: number | null;
}

/** Absent or non-numeric ordering sorts last rather than jumping to the front. */
function rank(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : Number.MAX_SAFE_INTEGER;
}

/**
 * Sorts chapters into reading order: by volume, then within the volume.
 *
 * A chapter whose volume is unknown keeps its place relative to other unknowns
 * and sorts after every known volume, so nothing silently disappears from a
 * partially published book. Ties fall back to the chapter id, which keeps the
 * order stable across requests instead of leaving it to the engine.
 */
export function sortChaptersForReading<T extends OrderedChapter>(
  chapters: T[],
  volumes: OrderedVolume[]
): T[] {
  const volumeRank = new Map(volumes.map((v) => [v.id, rank(v.order)]));

  return [...chapters].sort((a, b) => {
    const va = volumeRank.get(a.volumeId ?? '') ?? Number.MAX_SAFE_INTEGER;
    const vb = volumeRank.get(b.volumeId ?? '') ?? Number.MAX_SAFE_INTEGER;
    if (va !== vb) return va - vb;

    const ca = rank(a.order);
    const cb = rank(b.order);
    if (ca !== cb) return ca - cb;

    return a.id.localeCompare(b.id);
  });
}

/** Position of a chapter in reading order, or -1 when it is not published. */
export function indexOfChapter(ordered: OrderedChapter[], chapterId: string): number {
  return ordered.findIndex((c) => c.id === chapterId);
}

/**
 * The chapters that follow one, in reading order.
 * `limit` bounds a single response so a long book is delivered in batches.
 */
export function chaptersAfter<T extends OrderedChapter>(
  ordered: T[],
  afterChapterId: string,
  limit: number
): T[] {
  const index = indexOfChapter(ordered, afterChapterId);
  if (index === -1) return [];
  return ordered.slice(index + 1, index + 1 + Math.max(0, limit));
}

/**
 * A published slug is a Firestore document id, and `.doc()` treats a slash as a
 * path separator. Validating here keeps a crafted slug from addressing a
 * different document than the one it names.
 */
export function isValidPublicSlug(slug: unknown): slug is string {
  return (
    typeof slug === 'string' &&
    slug.length > 0 &&
    slug.length <= 200 &&
    !slug.includes('/') &&
    slug !== '.' &&
    slug !== '..'
  );
}

/**
 * Stable public addresses for chapters. (Audit H6)
 *
 * The reader used to route on the raw Firestore document id, which meant every
 * public URL carried an internal identifier the author never chose and nobody
 * could read. A slug fixes that, but only if it is assigned ONCE and then left
 * alone: a slug recomputed from the title on every read would change the public
 * address whenever the author renamed a chapter, silently breaking every link
 * already shared.
 *
 * So this module only ever answers "what should this chapter's slug be, if it
 * does not have one yet". The publish route persists the answer to the Chapter
 * document, and from then on the stored value is used unchanged.
 */

import { makeSlug } from './slug';
import type { ChapterType } from '@/types/project';

export interface SlugCandidateInput {
  title?: string | null;
  chapterNumber?: number | null;
  chapterType?: ChapterType;
}

/**
 * The preferred slug for a chapter, before uniqueness is considered.
 *
 * The author's own title comes first, because that is what makes a URL worth
 * reading. Untitled sections fall back to what they are — a numbered chapter,
 * a prologue, an epilogue — rather than to an opaque id.
 */
export function preferredChapterSlug(chapter: SlugCandidateInput): string {
  const fromTitle = makeSlug(chapter.title ?? '');
  // makeSlug never returns an empty string; it falls back to `novel-<digest>`,
  // which is exactly the unreadable thing this is trying to avoid.
  if (fromTitle && !/^novel-[a-z0-9]+$/.test(fromTitle)) return fromTitle;

  const type: ChapterType = chapter.chapterType ?? 'chapter';
  if (type === 'prologue') return 'prologue';
  if (type === 'epilogue') return 'epilogue';

  const hasNumber = chapter.chapterNumber !== null && chapter.chapterNumber !== undefined;
  return hasNumber ? `chapter-${chapter.chapterNumber}` : fromTitle || 'chapter';
}

/**
 * Resolves a slug that no other chapter in the book is already using.
 *
 * `taken` is every slug already assigned in the project. Collisions get a
 * numeric suffix rather than being rejected, because two chapters legitimately
 * sharing a title is an ordinary thing in a novel.
 */
export function allocateChapterSlug(
  chapter: SlugCandidateInput,
  taken: Iterable<string>
): string {
  const used = new Set(taken);
  const base = preferredChapterSlug(chapter);

  if (!used.has(base)) return base;

  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }

  // A thousand identically titled chapters is not a real book; fall back to
  // something guaranteed unique rather than looping forever.
  return `${base}-${Date.now().toString(36)}`;
}

/**
 * The slug a chapter should be published under.
 * An already-assigned slug is returned untouched — that is the whole point.
 */
export function resolveChapterSlug(
  chapter: SlugCandidateInput & { slug?: string | null },
  takenByOthers: Iterable<string>
): { slug: string; isNew: boolean } {
  const existing = typeof chapter.slug === 'string' ? chapter.slug.trim() : '';
  if (existing) return { slug: existing, isNew: false };
  return { slug: allocateChapterSlug(chapter, takenByOthers), isNew: true };
}

/** The public path for a published chapter. */
export function chapterPath(
  projectSlug: string,
  volumeSlug: string,
  chapterSlug: string
): string {
  return `/read/${encodeURIComponent(projectSlug)}/${encodeURIComponent(
    volumeSlug
  )}/${encodeURIComponent(chapterSlug)}`;
}

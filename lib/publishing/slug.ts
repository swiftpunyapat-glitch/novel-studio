/**
 * Unicode-safe public slug generation. (Audit C6)
 *
 * The previous implementation used `[^\w\s-]`, which is ASCII-only: any wholly
 * Thai title stripped to an empty string and fell back to `novel-<timestamp>`.
 * This keeps letters, numbers and combining marks from every script, and strips
 * only characters that are hostile to Firestore document ids or to URLs.
 *
 * This function decides the SHAPE of a slug. It does not decide whether the slug
 * is AVAILABLE — that is enforced by the `publicSlugs/{slug}` reservation
 * document claimed transactionally in the publish route.
 */

export const MAX_SLUG_LENGTH = 80;

/** Characters Firestore forbids in document ids, plus URL-hostile punctuation. */
const DISALLOWED = /[^\p{L}\p{N}\p{M}\s-]/gu;
const SEPARATORS = /[\s_-]+/gu;

/** Firestore reserves ids matching `__.*__`, and rejects "." and "..". */
function isReservedId(value: string): boolean {
  return value === '.' || value === '..' || /^__.*__$/.test(value);
}

/** Short, stable, non-cryptographic digest used only for the empty-title fallback. */
function shortDigest(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0').slice(0, 7);
}

/**
 * Derives a URL- and Firestore-safe slug from a human title.
 * Pure and deterministic: the same input always yields the same slug.
 */
export function makeSlug(title: string): string {
  const source = typeof title === 'string' ? title : '';

  let slug = source
    .normalize('NFC')
    .toLowerCase()
    .replace(DISALLOWED, ' ')
    .replace(SEPARATORS, '-')
    .replace(/^-+|-+$/g, '');

  if (slug.length > MAX_SLUG_LENGTH) {
    slug = slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, '');
  }

  if (slug.length === 0 || isReservedId(slug)) {
    return `novel-${shortDigest(source)}`;
  }

  return slug;
}

/**
 * Produces a deterministic sequence of candidate slugs for a title.
 * The publish route walks this until it finds one that is unreserved or that
 * this project already owns, so two authors sharing a title get distinct books
 * rather than silently merging into one.
 */
export function slugCandidates(title: string, attempts = 25): string[] {
  const base = makeSlug(title);
  const out = [base];
  for (let i = 2; i <= attempts; i++) {
    const suffix = `-${i}`;
    const trimmed = base.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/g, '');
    out.push(`${trimmed}${suffix}`);
  }
  return out;
}

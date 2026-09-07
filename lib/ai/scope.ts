import { adminDb } from '@/lib/firebase/admin';

/**
 * Project-level scoping for the AI read API. (Audit H10)
 *
 * Authenticating the bearer token is not sufficient: every route that accepts a
 * projectId must also confirm that the project belongs to the configured owner,
 * otherwise the token still reads across accounts.
 */

export interface ScopedProject {
  projectId: string;
  data: FirebaseFirestore.DocumentData;
}

/**
 * Resolves a project the AI principal is allowed to read.
 * Returns null when the id is malformed, absent, or owned by someone else —
 * callers should respond 404 in all three cases so the API does not disclose
 * which projects exist outside the configured owner.
 */
export async function resolveOwnedProject(
  ownerUid: string,
  projectId: string
): Promise<ScopedProject | null> {
  if (!projectId || typeof projectId !== 'string' || projectId.includes('/')) {
    return null;
  }

  const snap = await adminDb.collection('projects').doc(projectId).get();
  if (!snap.exists) return null;

  const data = snap.data() as FirebaseFirestore.DocumentData;
  if (data.ownerId !== ownerUid) return null;

  return { projectId, data };
}

/** Clamps a caller-supplied result limit into a sane range. */
export function clampLimit(value: unknown, fallback = 20, max = 100): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

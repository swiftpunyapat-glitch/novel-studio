/**
 * Chapter and volume cascade deletion. (Stage 4E / 4F)
 *
 * The Admin SDK bypasses firestore.rules, so a route using it is its own access
 * control — every entry point here is called only after
 * `requireProjectOwner`. Client-asserted ownership is never trusted, and the
 * chapter's own `projectId`/`volumeId` are re-checked against the path so a
 * chapter cannot be deleted through a project the caller happens to own.
 *
 * TWO RULES govern the ordering below.
 *
 * 1. Never claim success if required cleanup failed.
 *    Deleting the Firestore document is LAST. If storage or the published copy
 *    cannot be cleaned up, the manuscript document is still there, the caller
 *    gets a 500 with a stable code, and nothing has been half-destroyed with no
 *    record of what remains.
 *
 * 2. Every step is idempotent, so a retry after a partial failure is safe.
 *    Deleting a storage prefix that no longer exists succeeds; deleting a
 *    document that is already gone succeeds; a volume's chapters are found by
 *    querying `volumeId` rather than by reading the volume, and the volume
 *    document is deleted last so a retry can still enumerate what is left.
 *
 * Failure messages returned to the client are generic and fixed. Bucket names,
 * cluster addresses and SDK hints stay in the server log.
 */

import { adminDb, adminStorage } from '@/lib/firebase/admin';
import { AuthError } from '@/lib/server/auth';

export const CLEANUP_CODES = {
  storage: 'STORAGE_CLEANUP_FAILED',
  published: 'PUBLIC_CLEANUP_FAILED',
  firestore: 'FIRESTORE_CLEANUP_FAILED',
} as const;

export type CleanupCode = (typeof CLEANUP_CODES)[keyof typeof CLEANUP_CODES];

/** A required cleanup step failed. The caller must NOT report success. */
export class CleanupError extends Error {
  constructor(
    readonly code: CleanupCode,
    readonly publicMessage: string,
    readonly cause?: unknown
  ) {
    super(publicMessage);
    this.name = 'CleanupError';
  }
}

/** Rejects ids that could be reinterpreted as Firestore sub-paths. */
export function readPathId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  if (!id || id.includes('/') || id === '.' || id === '..') return null;
  return id;
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/**
 * Removes every object under a prefix.
 *
 * Idempotent: a prefix with no objects is not an error. A missing bucket IS an
 * error — silently "succeeding" would let the caller delete the manuscript and
 * leave its files orphaned and unreachable.
 */
async function deleteStoragePrefix(prefix: string, context: string): Promise<void> {
  try {
    const bucket = adminStorage.bucket();
    if (!bucket || !bucket.name) {
      throw new Error('No storage bucket configured on Firebase Admin');
    }
    await bucket.deleteFiles({ prefix });
  } catch (err) {
    console.error(`Storage cleanup for ${context} (prefix ${prefix}) failed:`, err);
    throw new CleanupError(
      CLEANUP_CODES.storage,
      'Could not delete the stored files for this section.',
      err
    );
  }
}

// ---------------------------------------------------------------------------
// Published copies
// ---------------------------------------------------------------------------

/** Every public slug this project has ever claimed. Usually zero or one. */
async function publicSlugsForProject(projectId: string): Promise<string[]> {
  const snap = await adminDb
    .collection('publicSlugs')
    .where('projectId', '==', projectId)
    .get();
  return snap.docs.map((d) => d.id);
}

/**
 * Removes the published copies of deleted content.
 *
 * Required, not cosmetic: a reader following an existing link would otherwise
 * keep seeing a chapter the author has deleted, with no way for them to take it
 * down. Only the deleted chapters and volume are touched — the rest of the
 * published book is left exactly as it is.
 */
async function deletePublishedCopies(
  projectId: string,
  target: { chapterIds: string[]; volumeIds?: string[] }
): Promise<void> {
  try {
    const slugs = await publicSlugsForProject(projectId);

    for (const slug of slugs) {
      const publicProject = adminDb.collection('publicProjects').doc(slug);

      for (const chapterId of target.chapterIds) {
        await adminDb.recursiveDelete(publicProject.collection('chapters').doc(chapterId));
      }
      for (const volumeId of target.volumeIds ?? []) {
        await adminDb.recursiveDelete(publicProject.collection('volumes').doc(volumeId));
      }
    }
  } catch (err) {
    console.error(`Published copy cleanup for project ${projectId} failed:`, err);
    throw new CleanupError(
      CLEANUP_CODES.published,
      'Could not remove the published copy of this section.',
      err
    );
  }
}

// ---------------------------------------------------------------------------
// Firestore
// ---------------------------------------------------------------------------

/**
 * Deletes a document and everything beneath it.
 *
 * `recursiveDelete` covers the subcollections that exist today (variants, and
 * revisions beneath them) and any chapter-owned collection added later, which
 * is why nothing here enumerates them by name.
 */
async function recursiveDelete(
  ref: FirebaseFirestore.DocumentReference,
  context: string
): Promise<void> {
  try {
    await adminDb.recursiveDelete(ref);
  } catch (err) {
    console.error(`Firestore cascade delete for ${context} failed:`, err);
    throw new CleanupError(
      CLEANUP_CODES.firestore,
      'Could not delete this section.',
      err
    );
  }
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export interface ChapterRecord {
  id: string;
  title: string;
  volumeId: string;
}

/** Loads a chapter and asserts it really belongs to this project. */
export async function requireChapter(
  projectId: string,
  chapterId: string
): Promise<ChapterRecord> {
  const snap = await adminDb
    .collection('projects')
    .doc(projectId)
    .collection('chapters')
    .doc(chapterId)
    .get();

  if (!snap.exists) throw new AuthError(404, 'Chapter not found');

  const data = snap.data() ?? {};
  // A chapter document that names a different project is not addressable
  // through this one, whatever the path says.
  if (typeof data.projectId === 'string' && data.projectId !== projectId) {
    throw new AuthError(404, 'Chapter not found');
  }

  return {
    id: chapterId,
    title: typeof data.title === 'string' ? data.title : '',
    volumeId: typeof data.volumeId === 'string' ? data.volumeId : '',
  };
}

export interface VolumeRecord {
  id: string;
  title: string;
}

export async function requireVolume(
  projectId: string,
  volumeId: string
): Promise<VolumeRecord> {
  const snap = await adminDb
    .collection('projects')
    .doc(projectId)
    .collection('volumes')
    .doc(volumeId)
    .get();

  if (!snap.exists) throw new AuthError(404, 'Volume not found');

  const data = snap.data() ?? {};
  if (typeof data.projectId === 'string' && data.projectId !== projectId) {
    throw new AuthError(404, 'Volume not found');
  }

  return { id: volumeId, title: typeof data.title === 'string' ? data.title : '' };
}

/** Chapter ids belonging to a volume, found by query rather than by the volume. */
export async function chapterIdsInVolume(
  projectId: string,
  volumeId: string
): Promise<string[]> {
  const snap = await adminDb
    .collection('projects')
    .doc(projectId)
    .collection('chapters')
    .where('volumeId', '==', volumeId)
    .get();

  return snap.docs.map((d) => d.id);
}

// ---------------------------------------------------------------------------
// Cascades
// ---------------------------------------------------------------------------

function chapterStoragePrefix(projectId: string, chapterId: string): string {
  return `projects/${projectId}/chapters/${chapterId}/`;
}

function volumeStoragePrefix(projectId: string, volumeId: string): string {
  return `projects/${projectId}/volumes/${volumeId}/`;
}

/**
 * Deletes one chapter with everything it owns: its variants, their revisions,
 * any chapter-owned storage, and its published copy.
 *
 * Sibling chapters and the volume itself are never touched.
 */
export async function deleteChapterCascade(
  projectId: string,
  chapterId: string
): Promise<void> {
  const context = `chapter ${projectId}/${chapterId}`;

  await deleteStoragePrefix(chapterStoragePrefix(projectId, chapterId), context);
  await deletePublishedCopies(projectId, { chapterIds: [chapterId] });

  await recursiveDelete(
    adminDb.collection('projects').doc(projectId).collection('chapters').doc(chapterId),
    context
  );
}

/**
 * Deletes a volume and every chapter inside it.
 *
 * Chapters go first, one at a time, and the volume document is deleted last:
 * if a chapter fails, the volume is still present and a retry finds exactly the
 * chapters that remain.
 */
export async function deleteVolumeCascade(
  projectId: string,
  volumeId: string
): Promise<{ deletedChapterIds: string[] }> {
  const context = `volume ${projectId}/${volumeId}`;
  const chapterIds = await chapterIdsInVolume(projectId, volumeId);

  for (const chapterId of chapterIds) {
    await deleteChapterCascade(projectId, chapterId);
  }

  await deleteStoragePrefix(volumeStoragePrefix(projectId, volumeId), context);
  await deletePublishedCopies(projectId, { chapterIds: [], volumeIds: [volumeId] });

  await recursiveDelete(
    adminDb.collection('projects').doc(projectId).collection('volumes').doc(volumeId),
    context
  );

  return { deletedChapterIds: chapterIds };
}

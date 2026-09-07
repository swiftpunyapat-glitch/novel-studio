import { describe, expect, test, vi, beforeEach } from 'vitest';

/**
 * Route-level authorization and cascade tests for
 *   DELETE /api/projects/[projectId]/chapters/[chapterId]
 *   DELETE /api/projects/[projectId]/volumes/[volumeId]
 *
 * The Admin SDK ignores firestore.rules, so these routes are the only thing
 * standing between a request and someone else's manuscript. What is asserted
 * here is therefore not just "the happy path works" but the three properties
 * that make a destructive endpoint safe:
 *
 *   - nothing is deleted before the caller is proven to be the owner
 *   - success is never reported when required cleanup failed
 *   - deleting one thing does not touch its siblings
 */

const OWNER_UID = 'owner_uid_alice';
const OTHER_UID = 'other_uid_mallory';
const PROJECT_ID = 'project_alpha';
const OTHER_PROJECT_ID = 'project_beta';

const VOLUME_ONE = 'volume_one';
const VOLUME_TWO = 'volume_two';

const CHAPTER_A = 'chapter_a'; // volume one
const CHAPTER_B = 'chapter_b'; // volume one, sibling
const CHAPTER_C = 'chapter_c'; // volume two, must never be touched

const PUBLIC_SLUG = 'project-alpha-slug';

const verifyIdToken = vi.fn();

let deletedPaths: string[] = [];
let deletedStoragePrefixes: string[] = [];

/** Injected failures, so each cleanup step can be broken independently. */
let storageErrorForPrefix: string | null = null;
let publicDeleteError: Error | null = null;
let recursiveDeleteErrorForPath: string | null = null;
let bucketError: Error | null = null;

type Doc = Record<string, unknown>;

function seedDocs(): Map<string, Doc> {
  return new Map<string, Doc>([
    [`projects/${PROJECT_ID}`, { id: PROJECT_ID, ownerId: OWNER_UID, title: 'Alpha' }],
    [`projects/${OTHER_PROJECT_ID}`, { id: OTHER_PROJECT_ID, ownerId: OWNER_UID }],

    [
      `projects/${PROJECT_ID}/volumes/${VOLUME_ONE}`,
      { id: VOLUME_ONE, projectId: PROJECT_ID, title: 'Volume 1' },
    ],
    [
      `projects/${PROJECT_ID}/volumes/${VOLUME_TWO}`,
      { id: VOLUME_TWO, projectId: PROJECT_ID, title: 'Volume 2' },
    ],

    [
      `projects/${PROJECT_ID}/chapters/${CHAPTER_A}`,
      { id: CHAPTER_A, projectId: PROJECT_ID, volumeId: VOLUME_ONE, title: 'Chapter 7' },
    ],
    [
      `projects/${PROJECT_ID}/chapters/${CHAPTER_B}`,
      { id: CHAPTER_B, projectId: PROJECT_ID, volumeId: VOLUME_ONE, title: 'Chapter 8' },
    ],
    [
      `projects/${PROJECT_ID}/chapters/${CHAPTER_C}`,
      { id: CHAPTER_C, projectId: PROJECT_ID, volumeId: VOLUME_TWO, title: 'Chapter 9' },
    ],

    // Nested data the cascade must remove along with its chapter.
    [
      `projects/${PROJECT_ID}/chapters/${CHAPTER_A}/variants/v1`,
      { id: 'v1', chapterId: CHAPTER_A },
    ],
    [
      `projects/${PROJECT_ID}/chapters/${CHAPTER_A}/variants/v1/revisions/r1`,
      { id: 'r1', variantId: 'v1' },
    ],

    [`publicSlugs/${PUBLIC_SLUG}`, { projectId: PROJECT_ID }],
    [`publicProjects/${PUBLIC_SLUG}/chapters/${CHAPTER_A}`, { id: CHAPTER_A }],
    [`publicProjects/${PUBLIC_SLUG}/chapters/${CHAPTER_B}`, { id: CHAPTER_B }],
    [`publicProjects/${PUBLIC_SLUG}/chapters/${CHAPTER_C}`, { id: CHAPTER_C }],
    [`publicProjects/${PUBLIC_SLUG}/volumes/${VOLUME_ONE}`, { id: VOLUME_ONE }],
  ]);
}

let docs = seedDocs();

/**
 * A minimal Firestore stand-in. Paths are flat strings, so "everything under
 * this document" is a prefix match — which is exactly what `recursiveDelete`
 * means and lets the tests assert that siblings survive.
 */
function makeDb() {
  function makeRef(path: string): any {
    return {
      id: path.split('/').pop()!,
      path,
      get: async () => ({
        exists: docs.has(path),
        data: () => docs.get(path),
      }),
      delete: async () => {
        deletedPaths.push(path);
        docs.delete(path);
      },
      collection: (name: string) => makeCollection(`${path}/${name}`),
    };
  }

  function makeCollection(path: string): any {
    const query = (field: string, value: unknown) => ({
      get: async () => {
        const matching: any[] = [];
        for (const [docPath, data] of docs.entries()) {
          const isDirectChild =
            docPath.startsWith(`${path}/`) &&
            docPath.slice(path.length + 1).indexOf('/') === -1;
          if (isDirectChild && data[field] === value) {
            matching.push({
              id: docPath.split('/').pop()!,
              ref: makeRef(docPath),
              data: () => data,
            });
          }
        }
        return { docs: matching, empty: matching.length === 0 };
      },
    });

    return {
      doc: (id: string) => makeRef(`${path}/${id}`),
      where: (field: string, _op: string, value: unknown) => query(field, value),
    };
  }

  return {
    collection: (name: string) => makeCollection(name),
    recursiveDelete: async (ref: any) => {
      if (recursiveDeleteErrorForPath && ref.path === recursiveDeleteErrorForPath) {
        throw new Error(
          `Firestore recursive delete failed on cluster_node_10.0.0.12 for ${ref.path}`
        );
      }
      if (publicDeleteError && ref.path.startsWith('publicProjects')) {
        throw publicDeleteError;
      }
      deletedPaths.push(`recursive:${ref.path}`);
      for (const key of Array.from(docs.keys())) {
        if (key === ref.path || key.startsWith(`${ref.path}/`)) docs.delete(key);
      }
    },
  };
}

let db = makeDb();

vi.mock('@/lib/firebase/admin', () => ({
  get adminDb() {
    return db;
  },
  adminAuth: {
    verifyIdToken: (t: string) => verifyIdToken(t),
  },
  adminStorage: {
    bucket: () => {
      if (bucketError) throw bucketError;
      return {
        name: 'test-bucket.firebasestorage.app',
        deleteFiles: async ({ prefix }: { prefix: string }) => {
          if (storageErrorForPrefix && prefix === storageErrorForPrefix) {
            throw new Error(
              'GCS timeout: secret_credential_token_xyz in region us-central1'
            );
          }
          deletedStoragePrefixes.push(prefix);
        },
      };
    },
  },
}));

async function deleteChapter(
  projectId: string,
  chapterId: string,
  headers: Record<string, string>
) {
  const { DELETE } = await import(
    '@/app/api/projects/[projectId]/chapters/[chapterId]/route'
  );
  const req = new Request(
    `http://localhost/api/projects/${projectId}/chapters/${chapterId}`,
    { method: 'DELETE', headers }
  );
  return DELETE(req as never, { params: { projectId, chapterId } });
}

async function deleteVolume(
  projectId: string,
  volumeId: string,
  headers: Record<string, string>
) {
  const { DELETE } = await import(
    '@/app/api/projects/[projectId]/volumes/[volumeId]/route'
  );
  const req = new Request(
    `http://localhost/api/projects/${projectId}/volumes/${volumeId}`,
    { method: 'DELETE', headers }
  );
  return DELETE(req as never, { params: { projectId, volumeId } });
}

const asOwner = { Authorization: 'Bearer alice_token' };

beforeEach(() => {
  docs = seedDocs();
  db = makeDb();
  deletedPaths = [];
  deletedStoragePrefixes = [];
  storageErrorForPrefix = null;
  publicDeleteError = null;
  recursiveDeleteErrorForPath = null;
  bucketError = null;
  verifyIdToken.mockReset();
});

// ===========================================================================
// Authorization — nothing is deleted before ownership is proven
// ===========================================================================

describe('DELETE chapter — authorization', () => {
  test('rejects a request with no Authorization header (401)', async () => {
    const res = await deleteChapter(PROJECT_ID, CHAPTER_A, {});
    expect(res.status).toBe(401);
    expect(deletedPaths).toHaveLength(0);
    expect(deletedStoragePrefixes).toHaveLength(0);
  });

  test('rejects a non-bearer credential (401)', async () => {
    const res = await deleteChapter(PROJECT_ID, CHAPTER_A, {
      Authorization: 'Basic user:pass',
    });
    expect(res.status).toBe(401);
    expect(deletedPaths).toHaveLength(0);
  });

  test('rejects a revoked or expired token (401)', async () => {
    verifyIdToken.mockRejectedValue(new Error('Revoked'));
    const res = await deleteChapter(PROJECT_ID, CHAPTER_A, {
      Authorization: 'Bearer revoked',
    });
    expect(res.status).toBe(401);
    expect(deletedPaths).toHaveLength(0);
  });

  test('rejects an authenticated non-owner (403) and deletes nothing', async () => {
    verifyIdToken.mockResolvedValue({ uid: OTHER_UID });
    const res = await deleteChapter(PROJECT_ID, CHAPTER_A, {
      Authorization: 'Bearer mallory',
    });
    expect(res.status).toBe(403);
    expect(deletedPaths).toHaveLength(0);
    expect(deletedStoragePrefixes).toHaveLength(0);
    expect(docs.has(`projects/${PROJECT_ID}/chapters/${CHAPTER_A}`)).toBe(true);
  });

  test('returns 404 for a chapter that does not exist', async () => {
    verifyIdToken.mockResolvedValue({ uid: OWNER_UID });
    const res = await deleteChapter(PROJECT_ID, 'nope', asOwner);
    expect(res.status).toBe(404);
    expect(deletedPaths).toHaveLength(0);
  });

  test('returns 404 for an id that tries to escape its path', async () => {
    verifyIdToken.mockResolvedValue({ uid: OWNER_UID });
    const res = await deleteChapter(PROJECT_ID, '../../projects', asOwner);
    expect(res.status).toBe(404);
    expect(deletedPaths).toHaveLength(0);
  });

  test('returns 404 when the chapter belongs to a different project', async () => {
    verifyIdToken.mockResolvedValue({ uid: OWNER_UID });
    docs.set(`projects/${OTHER_PROJECT_ID}/chapters/${CHAPTER_A}`, {
      id: CHAPTER_A,
      projectId: PROJECT_ID,
      volumeId: VOLUME_ONE,
      title: 'Chapter 7',
    });
    const res = await deleteChapter(OTHER_PROJECT_ID, CHAPTER_A, asOwner);
    expect(res.status).toBe(404);
    expect(deletedPaths).toHaveLength(0);
  });
});

describe('DELETE volume — authorization', () => {
  test('rejects an unauthenticated request (401)', async () => {
    const res = await deleteVolume(PROJECT_ID, VOLUME_ONE, {});
    expect(res.status).toBe(401);
    expect(deletedPaths).toHaveLength(0);
  });

  test('rejects an authenticated non-owner (403) and deletes no chapters', async () => {
    verifyIdToken.mockResolvedValue({ uid: OTHER_UID });
    const res = await deleteVolume(PROJECT_ID, VOLUME_ONE, {
      Authorization: 'Bearer mallory',
    });
    expect(res.status).toBe(403);
    expect(deletedPaths).toHaveLength(0);
    expect(docs.has(`projects/${PROJECT_ID}/chapters/${CHAPTER_A}`)).toBe(true);
    expect(docs.has(`projects/${PROJECT_ID}/chapters/${CHAPTER_B}`)).toBe(true);
  });

  test('returns 404 for a volume that does not exist', async () => {
    verifyIdToken.mockResolvedValue({ uid: OWNER_UID });
    const res = await deleteVolume(PROJECT_ID, 'nope', asOwner);
    expect(res.status).toBe(404);
    expect(deletedPaths).toHaveLength(0);
  });
});

// ===========================================================================
// Successful cascades
// ===========================================================================

describe('DELETE chapter — successful cascade', () => {
  beforeEach(() => {
    verifyIdToken.mockResolvedValue({ uid: OWNER_UID });
  });

  test('removes the chapter with its variants and revisions', async () => {
    const res = await deleteChapter(PROJECT_ID, CHAPTER_A, asOwner);
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);

    expect(deletedPaths).toContain(
      `recursive:projects/${PROJECT_ID}/chapters/${CHAPTER_A}`
    );
    expect(docs.has(`projects/${PROJECT_ID}/chapters/${CHAPTER_A}/variants/v1`)).toBe(false);
    expect(
      docs.has(`projects/${PROJECT_ID}/chapters/${CHAPTER_A}/variants/v1/revisions/r1`)
    ).toBe(false);
  });

  test('removes chapter-owned storage files', async () => {
    await deleteChapter(PROJECT_ID, CHAPTER_A, asOwner);
    expect(deletedStoragePrefixes).toContain(
      `projects/${PROJECT_ID}/chapters/${CHAPTER_A}/`
    );
  });

  test('removes the published copy so readers stop seeing a deleted chapter', async () => {
    await deleteChapter(PROJECT_ID, CHAPTER_A, asOwner);
    expect(docs.has(`publicProjects/${PUBLIC_SLUG}/chapters/${CHAPTER_A}`)).toBe(false);
  });

  test('leaves sibling chapters, other volumes and the project untouched', async () => {
    await deleteChapter(PROJECT_ID, CHAPTER_A, asOwner);

    expect(docs.has(`projects/${PROJECT_ID}/chapters/${CHAPTER_B}`)).toBe(true);
    expect(docs.has(`projects/${PROJECT_ID}/chapters/${CHAPTER_C}`)).toBe(true);
    expect(docs.has(`projects/${PROJECT_ID}/volumes/${VOLUME_ONE}`)).toBe(true);
    expect(docs.has(`projects/${PROJECT_ID}/volumes/${VOLUME_TWO}`)).toBe(true);
    expect(docs.has(`projects/${PROJECT_ID}`)).toBe(true);
    expect(docs.has(`publicSlugs/${PUBLIC_SLUG}`)).toBe(true);
    expect(docs.has(`publicProjects/${PUBLIC_SLUG}/chapters/${CHAPTER_B}`)).toBe(true);

    expect(deletedStoragePrefixes).not.toContain(
      `projects/${PROJECT_ID}/chapters/${CHAPTER_B}/`
    );
  });

  test('deleting a chapter is idempotent enough to retry after it succeeded', async () => {
    expect((await deleteChapter(PROJECT_ID, CHAPTER_A, asOwner)).status).toBe(200);
    // A retry finds nothing to delete and says so, rather than half-deleting
    // something else.
    expect((await deleteChapter(PROJECT_ID, CHAPTER_A, asOwner)).status).toBe(404);
  });
});

describe('DELETE volume — successful cascade', () => {
  beforeEach(() => {
    verifyIdToken.mockResolvedValue({ uid: OWNER_UID });
  });

  test('deletes every chapter in the volume, then the volume itself', async () => {
    const res = await deleteVolume(PROJECT_ID, VOLUME_ONE, asOwner);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.deletedChapterIds.sort()).toEqual([CHAPTER_A, CHAPTER_B]);

    expect(docs.has(`projects/${PROJECT_ID}/chapters/${CHAPTER_A}`)).toBe(false);
    expect(docs.has(`projects/${PROJECT_ID}/chapters/${CHAPTER_B}`)).toBe(false);
    expect(docs.has(`projects/${PROJECT_ID}/volumes/${VOLUME_ONE}`)).toBe(false);
  });

  test('the volume document is deleted last, so a retry can still find its chapters', async () => {
    await deleteVolume(PROJECT_ID, VOLUME_ONE, asOwner);

    const volumeIndex = deletedPaths.indexOf(
      `recursive:projects/${PROJECT_ID}/volumes/${VOLUME_ONE}`
    );
    const chapterIndex = deletedPaths.indexOf(
      `recursive:projects/${PROJECT_ID}/chapters/${CHAPTER_A}`
    );
    expect(chapterIndex).toBeGreaterThanOrEqual(0);
    expect(volumeIndex).toBeGreaterThan(chapterIndex);
  });

  test('removes storage for each chapter and for the volume', async () => {
    await deleteVolume(PROJECT_ID, VOLUME_ONE, asOwner);
    expect(deletedStoragePrefixes).toContain(
      `projects/${PROJECT_ID}/chapters/${CHAPTER_A}/`
    );
    expect(deletedStoragePrefixes).toContain(
      `projects/${PROJECT_ID}/chapters/${CHAPTER_B}/`
    );
    expect(deletedStoragePrefixes).toContain(
      `projects/${PROJECT_ID}/volumes/${VOLUME_ONE}/`
    );
  });

  test('leaves the other volume, its chapter and the project itself intact', async () => {
    await deleteVolume(PROJECT_ID, VOLUME_ONE, asOwner);

    expect(docs.has(`projects/${PROJECT_ID}/volumes/${VOLUME_TWO}`)).toBe(true);
    expect(docs.has(`projects/${PROJECT_ID}/chapters/${CHAPTER_C}`)).toBe(true);
    expect(docs.has(`publicProjects/${PUBLIC_SLUG}/chapters/${CHAPTER_C}`)).toBe(true);
    expect(docs.has(`projects/${PROJECT_ID}`)).toBe(true);
    expect(docs.has(`publicSlugs/${PUBLIC_SLUG}`)).toBe(true);

    expect(deletedStoragePrefixes).not.toContain(
      `projects/${PROJECT_ID}/chapters/${CHAPTER_C}/`
    );
    expect(deletedStoragePrefixes).not.toContain(
      `projects/${PROJECT_ID}/volumes/${VOLUME_TWO}/`
    );
  });

  test('an empty volume deletes cleanly', async () => {
    docs.delete(`projects/${PROJECT_ID}/chapters/${CHAPTER_C}`);
    const res = await deleteVolume(PROJECT_ID, VOLUME_TWO, asOwner);
    expect(res.status).toBe(200);
    expect((await res.json()).deletedChapterIds).toEqual([]);
    expect(docs.has(`projects/${PROJECT_ID}/volumes/${VOLUME_TWO}`)).toBe(false);
  });
});

// ===========================================================================
// Failure semantics — never claim success when cleanup failed
// ===========================================================================

describe('Required cleanup failures', () => {
  beforeEach(() => {
    verifyIdToken.mockResolvedValue({ uid: OWNER_UID });
  });

  test('storage failure aborts the chapter delete with a stable code', async () => {
    storageErrorForPrefix = `projects/${PROJECT_ID}/chapters/${CHAPTER_A}/`;

    const res = await deleteChapter(PROJECT_ID, CHAPTER_A, asOwner);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('STORAGE_CLEANUP_FAILED');

    // The chapter is still there, which is what the response says.
    expect(docs.has(`projects/${PROJECT_ID}/chapters/${CHAPTER_A}`)).toBe(true);
    expect(deletedPaths).not.toContain(
      `recursive:projects/${PROJECT_ID}/chapters/${CHAPTER_A}`
    );
  });

  test('a storage failure never leaks internal details to the client', async () => {
    storageErrorForPrefix = `projects/${PROJECT_ID}/chapters/${CHAPTER_A}/`;
    const res = await deleteChapter(PROJECT_ID, CHAPTER_A, asOwner);
    const body = await res.json();
    const text = JSON.stringify(body);

    expect(text).not.toContain('secret_credential');
    expect(text).not.toContain('us-central1');
    expect(text).not.toContain('test-bucket');
    expect(body.stack).toBeUndefined();
  });

  test('a missing storage bucket aborts rather than orphaning files', async () => {
    bucketError = new Error(
      'Bucket name not specified or invalid. Specify a valid bucket name via the storageBucket option.'
    );
    const res = await deleteChapter(PROJECT_ID, CHAPTER_A, asOwner);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.code).toBe('STORAGE_CLEANUP_FAILED');
    expect(JSON.stringify(body)).not.toContain('storageBucket');
    expect(docs.has(`projects/${PROJECT_ID}/chapters/${CHAPTER_A}`)).toBe(true);
  });

  test('published-copy failure aborts before the manuscript is deleted', async () => {
    publicDeleteError = new Error('publicProjects delete failed: cluster_node_10.0.0.12');

    const res = await deleteChapter(PROJECT_ID, CHAPTER_A, asOwner);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.code).toBe('PUBLIC_CLEANUP_FAILED');
    expect(JSON.stringify(body)).not.toContain('10.0.0.12');
    expect(docs.has(`projects/${PROJECT_ID}/chapters/${CHAPTER_A}`)).toBe(true);
  });

  test('a Firestore cascade failure is reported, not swallowed', async () => {
    recursiveDeleteErrorForPath = `projects/${PROJECT_ID}/chapters/${CHAPTER_A}`;

    const res = await deleteChapter(PROJECT_ID, CHAPTER_A, asOwner);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.code).toBe('FIRESTORE_CLEANUP_FAILED');
    expect(JSON.stringify(body)).not.toContain('cluster_node');
  });

  test('a volume delete that fails midway reports failure and keeps the volume', async () => {
    storageErrorForPrefix = `projects/${PROJECT_ID}/chapters/${CHAPTER_B}/`;

    const res = await deleteVolume(PROJECT_ID, VOLUME_ONE, asOwner);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBeUndefined();
    expect(body.code).toBe('STORAGE_CLEANUP_FAILED');

    // The volume survives, so a retry can still enumerate what is left —
    // which is the whole reason the volume document is deleted last.
    expect(docs.has(`projects/${PROJECT_ID}/volumes/${VOLUME_ONE}`)).toBe(true);
    expect(docs.has(`projects/${PROJECT_ID}/chapters/${CHAPTER_B}`)).toBe(true);
  });

  test('retrying a partially failed volume delete completes it', async () => {
    storageErrorForPrefix = `projects/${PROJECT_ID}/chapters/${CHAPTER_B}/`;
    expect((await deleteVolume(PROJECT_ID, VOLUME_ONE, asOwner)).status).toBe(500);

    // The first chapter is already gone; deleting a storage prefix that no
    // longer exists succeeds, so the retry picks up exactly where it stopped.
    storageErrorForPrefix = null;
    const res = await deleteVolume(PROJECT_ID, VOLUME_ONE, asOwner);
    expect(res.status).toBe(200);

    expect(docs.has(`projects/${PROJECT_ID}/chapters/${CHAPTER_B}`)).toBe(false);
    expect(docs.has(`projects/${PROJECT_ID}/volumes/${VOLUME_ONE}`)).toBe(false);
    // The untouched volume is still untouched after two failed-then-retried runs.
    expect(docs.has(`projects/${PROJECT_ID}/chapters/${CHAPTER_C}`)).toBe(true);
  });
});

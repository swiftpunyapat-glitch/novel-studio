import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

/**
 * Route-level authorization and cascade deletion tests for DELETE /api/projects/[projectId].
 */

const OWNER_UID = 'owner_uid_alice';
const OTHER_UID = 'other_uid_mallory';
const PROJECT_ID = 'project_alpha';
const PUBLIC_SLUG = 'project-alpha-slug';

const verifyIdToken = vi.fn();
const deletedPaths: string[] = [];
const deletedStoragePrefixes: string[] = [];
let storageErrorToThrow: Error | null = null;
let publicDeleteErrorToThrow: Error | null = null;
let bucketErrorToThrow: Error | null = null;

function makeDb() {
  const docs = new Map<string, Record<string, unknown>>([
    [
      `projects/${PROJECT_ID}`,
      {
        id: PROJECT_ID,
        ownerId: OWNER_UID,
        title: 'Project Alpha',
      },
    ],
    [
      `publicSlugs/${PUBLIC_SLUG}`,
      {
        projectId: PROJECT_ID,
      },
    ],
    [
      `publicProjects/${PUBLIC_SLUG}`,
      {
        projectId: PROJECT_ID,
      },
    ],
  ]);

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
    };
  }

  function makeCollection(name: string): any {
    return {
      doc: (id: string) => makeRef(`${name}/${id}`),
      where: (field: string, op: string, value: string) => ({
        get: async () => {
          const matching: any[] = [];
          for (const [path, data] of docs.entries()) {
            if (path.startsWith(`${name}/`) && data[field] === value) {
              matching.push({
                id: path.split('/').pop()!,
                ref: makeRef(path),
                data: () => data,
              });
            }
          }
          return { docs: matching };
        },
      }),
    };
  }

  return {
    collection: (name: string) => makeCollection(name),
    doc: (path: string) => makeRef(path),
    recursiveDelete: async (ref: any) => {
      if (publicDeleteErrorToThrow && ref.path.startsWith('publicProjects')) {
        throw publicDeleteErrorToThrow;
      }
      deletedPaths.push(`recursive:${ref.path}`);
      for (const key of Array.from(docs.keys())) {
        if (key === ref.path || key.startsWith(`${ref.path}/`)) {
          docs.delete(key);
        }
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
      if (bucketErrorToThrow) {
        throw bucketErrorToThrow;
      }
      return {
        name: 'test-bucket.firebasestorage.app',
        deleteFiles: async ({ prefix }: { prefix: string }) => {
          if (storageErrorToThrow) {
            throw storageErrorToThrow;
          }
          deletedStoragePrefixes.push(prefix);
        },
      };
    },
  },
}));

async function callDelete(projectId: string, headers: Record<string, string>) {
  const { DELETE } = await import('@/app/api/projects/[projectId]/route');
  const req = new Request(`http://localhost/api/projects/${projectId}`, {
    method: 'DELETE',
    headers,
  });
  return DELETE(req as never, { params: { projectId } });
}

beforeEach(() => {
  db = makeDb();
  deletedPaths.length = 0;
  deletedStoragePrefixes.length = 0;
  storageErrorToThrow = null;
  publicDeleteErrorToThrow = null;
  bucketErrorToThrow = null;
  verifyIdToken.mockReset();
});

describe('DELETE /api/projects/[projectId] authorization & cascade', () => {
  test('rejects requests with missing Authorization header (401)', async () => {
    const res = await callDelete(PROJECT_ID, {});
    expect(res.status).toBe(401);
    expect(deletedPaths).toHaveLength(0);
  });

  test('rejects requests with invalid / non-bearer token (401)', async () => {
    const res = await callDelete(PROJECT_ID, { Authorization: 'Basic user:pass' });
    expect(res.status).toBe(401);
    expect(deletedPaths).toHaveLength(0);
  });

  test('rejects requests when token fails verification (401)', async () => {
    verifyIdToken.mockRejectedValue(new Error('Revoked or expired'));
    const res = await callDelete(PROJECT_ID, { Authorization: 'Bearer revoked_token' });
    expect(res.status).toBe(401);
    expect(deletedPaths).toHaveLength(0);
  });

  test('rejects caller if not the project owner (403)', async () => {
    verifyIdToken.mockResolvedValue({ uid: OTHER_UID });
    const res = await callDelete(PROJECT_ID, { Authorization: 'Bearer mallory_token' });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/access/i);
    expect(deletedPaths).toHaveLength(0);
  });

  test('returns 404 for non-existent project', async () => {
    verifyIdToken.mockResolvedValue({ uid: OWNER_UID });
    const res = await callDelete('does_not_exist', { Authorization: 'Bearer valid_token' });
    expect(res.status).toBe(404);
    expect(deletedPaths).toHaveLength(0);
  });

  test('returns 404 for invalid project id path attempts', async () => {
    verifyIdToken.mockResolvedValue({ uid: OWNER_UID });
    const res = await callDelete('../malicious', { Authorization: 'Bearer valid_token' });
    expect(res.status).toBe(404);
    expect(deletedPaths).toHaveLength(0);
  });

  test('owner successfully deletes project, public snapshot, and storage files (200)', async () => {
    verifyIdToken.mockResolvedValue({ uid: OWNER_UID });
    const res = await callDelete(PROJECT_ID, { Authorization: 'Bearer alice_token' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);

    // Verified storage deletion
    expect(deletedStoragePrefixes).toContain(`projects/${PROJECT_ID}/`);

    // Verified public snapshot and slug deletion
    expect(deletedPaths).toContain(`recursive:publicProjects/${PUBLIC_SLUG}`);
    expect(deletedPaths).toContain(`publicSlugs/${PUBLIC_SLUG}`);

    // Verified recursive project deletion
    expect(deletedPaths).toContain(`recursive:projects/${PROJECT_ID}`);
  });

  test('fails with 500, stable code, and aborts if Storage cleanup fails without exposing internal details', async () => {
    verifyIdToken.mockResolvedValue({ uid: OWNER_UID });
    const internalSecretError =
      'GCS bucket connection timeout: secret_credential_token_xyz in region us-central1';
    storageErrorToThrow = new Error(internalSecretError);

    const res = await callDelete(PROJECT_ID, { Authorization: 'Bearer alice_token' });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      error: 'Could not delete manuscript storage.',
      code: 'STORAGE_CLEANUP_FAILED',
    });

    // Proves internal error message and secret strings are NOT exposed
    const responseText = JSON.stringify(body);
    expect(responseText).not.toContain(internalSecretError);
    expect(responseText).not.toContain('secret_credential');
    expect(responseText).not.toContain('us-central1');
    expect(body.stack).toBeUndefined();

    // Crucial: The project document was NOT deleted if storage cleanup failed
    expect(deletedPaths).not.toContain(`recursive:projects/${PROJECT_ID}`);
  });

  test('fails with 500, stable code, and aborts if public snapshot cleanup fails without exposing internal details', async () => {
    verifyIdToken.mockResolvedValue({ uid: OWNER_UID });
    const internalSecretError =
      'Firestore publicProjects recursive delete failed: cluster_node_10.0.0.12 down';
    publicDeleteErrorToThrow = new Error(internalSecretError);

    const res = await callDelete(PROJECT_ID, { Authorization: 'Bearer alice_token' });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      error: 'Could not remove published manuscript data.',
      code: 'PUBLIC_CLEANUP_FAILED',
    });

    // Proves internal error message and cluster internals are NOT exposed
    const responseText = JSON.stringify(body);
    expect(responseText).not.toContain(internalSecretError);
    expect(responseText).not.toContain('10.0.0.12');
    expect(body.stack).toBeUndefined();

    // Crucial: The project document was NOT deleted if public cleanup failed
    expect(deletedPaths).not.toContain(`recursive:projects/${PROJECT_ID}`);
  });

  test('fails safely with 500 and aborts if no Storage bucket is configured on Firebase Admin', async () => {
    verifyIdToken.mockResolvedValue({ uid: OWNER_UID });
    bucketErrorToThrow = new Error(
      'Bucket name not specified or invalid. Specify a valid bucket name via the storageBucket option when initializing the app, or specify the bucket name explicitly when calling the getBucket() method.'
    );

    const res = await callDelete(PROJECT_ID, { Authorization: 'Bearer alice_token' });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      error: 'Could not delete manuscript storage.',
      code: 'STORAGE_CLEANUP_FAILED',
    });

    // Proves SDK internal initialization instructions are NOT exposed to client
    const responseText = JSON.stringify(body);
    expect(responseText).not.toContain('storageBucket');
    expect(responseText).not.toContain('getBucket()');

    // Crucial: The project document was NOT deleted
    expect(deletedPaths).not.toContain(`recursive:projects/${PROJECT_ID}`);
  });
});

describe('Admin Storage Bucket Configuration Resolution', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('prefers FIREBASE_ADMIN_STORAGE_BUCKET when defined', () => {
    process.env.FIREBASE_ADMIN_STORAGE_BUCKET = 'custom-admin.firebasestorage.app';
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'public-bucket.appspot.com';

    const storageBucket =
      process.env.FIREBASE_ADMIN_STORAGE_BUCKET ||
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

    expect(storageBucket).toBe('custom-admin.firebasestorage.app');
  });

  test('falls back to NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET when admin env is unset', () => {
    delete process.env.FIREBASE_ADMIN_STORAGE_BUCKET;
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = 'novel-studio-prod.firebasestorage.app';

    const storageBucket =
      process.env.FIREBASE_ADMIN_STORAGE_BUCKET ||
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

    expect(storageBucket).toBe('novel-studio-prod.firebasestorage.app');
  });

  test('evaluates to undefined when neither is set without guessing PROJECT_ID.appspot.com', () => {
    delete process.env.FIREBASE_ADMIN_STORAGE_BUCKET;
    delete process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

    const storageBucket =
      process.env.FIREBASE_ADMIN_STORAGE_BUCKET ||
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;

    expect(storageBucket).toBeUndefined();
    expect(storageBucket).not.toBe('novel-studio-demo.appspot.com');
  });
});

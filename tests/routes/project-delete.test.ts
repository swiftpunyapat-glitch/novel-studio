import { describe, expect, test, vi, beforeEach } from 'vitest';

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

function makeDb() {
  const docs = new Map<string, Record<string, unknown>>([
    [
      `projects/${PROJECT_ID}`,
      { ownerId: OWNER_UID, title: 'The Long Road', slug: 'the-long-road' },
    ],
    [
      `publicSlugs/${PUBLIC_SLUG}`,
      { slug: PUBLIC_SLUG, projectId: PROJECT_ID },
    ],
    [
      `publicProjects/${PUBLIC_SLUG}`,
      { slug: PUBLIC_SLUG, projectId: PROJECT_ID, title: 'The Long Road' },
    ],
  ]);

  function makeRef(path: string): any {
    return {
      path,
      id: path.split('/').pop(),
      get: async () => ({
        exists: docs.has(path),
        id: path.split('/').pop(),
        data: () => docs.get(path),
      }),
      delete: async () => {
        docs.delete(path);
        deletedPaths.push(path);
      },
      collection: (name: string) => makeCollection(`${path}/${name}`),
      doc: (id: string) => makeRef(`${path}/${id}`),
    };
  }

  function makeCollection(path: string): any {
    return {
      doc: (id?: string) => makeRef(`${path}/${id ?? 'generated_id'}`),
      where: (field: string, op: string, val: unknown) => ({
        get: async () => {
          const matching: any[] = [];
          for (const [docPath, data] of docs.entries()) {
            if (docPath.startsWith(path) && data[field] === val) {
              matching.push({
                id: docPath.split('/').pop(),
                ref: makeRef(docPath),
                data: () => data,
              });
            }
          }
          return {
            empty: matching.length === 0,
            docs: matching,
          };
        },
      }),
    };
  }

  return {
    __docs: docs,
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
    bucket: () => ({
      deleteFiles: async ({ prefix }: { prefix: string }) => {
        if (storageErrorToThrow) {
          throw storageErrorToThrow;
        }
        deletedStoragePrefixes.push(prefix);
      },
    }),
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

  test('fails with 500 and aborts if Storage cleanup fails', async () => {
    verifyIdToken.mockResolvedValue({ uid: OWNER_UID });
    storageErrorToThrow = new Error('GCS bucket connection timeout');

    const res = await callDelete(PROJECT_ID, { Authorization: 'Bearer alice_token' });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/storage/i);

    // Crucial: The project document was NOT deleted if storage cleanup failed
    expect(deletedPaths).not.toContain(`recursive:projects/${PROJECT_ID}`);
  });

  test('fails with 500 and aborts if public snapshot cleanup fails', async () => {
    verifyIdToken.mockResolvedValue({ uid: OWNER_UID });
    publicDeleteErrorToThrow = new Error('Firestore publicProjects recursive delete failed');

    const res = await callDelete(PROJECT_ID, { Authorization: 'Bearer alice_token' });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/public snapshot/i);

    // Crucial: The project document was NOT deleted if public cleanup failed
    expect(deletedPaths).not.toContain(`recursive:projects/${PROJECT_ID}`);
  });
});

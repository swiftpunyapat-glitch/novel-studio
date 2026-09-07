import { describe, expect, test, vi, beforeEach } from 'vitest';

/**
 * Route-level authorization tests for the publishing endpoint.
 *
 * Firebase Rules cannot prove anything here: the route uses the Admin SDK,
 * which bypasses rules entirely. The only thing standing between an anonymous
 * caller and another author's private draft is the route's own code.
 *
 * The Admin SDK is mocked so these run without credentials.
 */

const OWNER_UID = 'owner_uid_alice';
const OTHER_UID = 'other_uid_mallory';
const PROJECT_ID = 'project_alpha';
const CHAPTER_ID = 'chapter_one';
const VARIANT_ID = 'variant_draft_a';
const REVISION_ID = 'revision_001';

const verifyIdToken = vi.fn();
const committed: Array<{ path: string; data: unknown }> = [];

/** Minimal in-memory Firestore Admin double. */
function makeDb() {
  const docs = new Map<string, Record<string, unknown>>([
    [
      `projects/${PROJECT_ID}`,
      { ownerId: OWNER_UID, title: 'The Long Road', slug: 'the-long-road', documentSettings: {} },
    ],
    [
      `projects/${PROJECT_ID}/chapters/${CHAPTER_ID}`,
      { volumeId: 'volume_one', title: 'Chapter One', order: 0, chapterNumber: 1 },
    ],
    [
      `projects/${PROJECT_ID}/chapters/${CHAPTER_ID}/variants/${VARIANT_ID}/revisions/${REVISION_ID}`,
      {
        plainText: 'Hello <script>alert(1)</script> world',
        wordCount: 4,
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Hello <script>alert(1)</script> world' }],
            },
          ],
        },
      },
    ],
  ]);

  function makeRef(path: string): any {
    return {
      path,
      get: async () => ({
        exists: docs.has(path),
        id: path.split('/').pop(),
        data: () => docs.get(path),
      }),
      collection: (name: string) => makeCollection(`${path}/${name}`),
      doc: (id: string) => makeRef(`${path}/${id}`),
    };
  }

  function makeCollection(path: string): any {
    return {
      doc: (id?: string) => makeRef(`${path}/${id ?? 'generated_id'}`),
      where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
    };
  }

  return {
    __docs: docs,
    collection: (name: string) => makeCollection(name),
    doc: (path: string) => makeRef(path),
    batch: () => ({
      set: (ref: any, data: unknown) => committed.push({ path: ref.path, data }),
      update: (ref: any, data: unknown) => committed.push({ path: ref.path, data }),
      commit: async () => undefined,
    }),
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => {
      const tx = {
        get: async (ref: any) => ref.get(),
        set: (ref: any, data: unknown) => committed.push({ path: ref.path, data }),
        update: (ref: any, data: unknown) => committed.push({ path: ref.path, data }),
      };
      return fn(tx);
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
}));

async function callPublish(headers: Record<string, string>, body: unknown) {
  const { POST } = await import('@/app/api/publishing/publish/route');
  const req = new Request('http://localhost/api/publishing/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return POST(req as never);
}

const validBody = {
  projectId: PROJECT_ID,
  chapterId: CHAPTER_ID,
  variantId: VARIANT_ID,
  revisionId: REVISION_ID,
};

beforeEach(() => {
  vi.resetModules();
  committed.length = 0;
  verifyIdToken.mockReset();
  db = makeDb();
});

describe('C1 — publish endpoint authentication and ownership', () => {
  test('anonymous request with no Authorization header is rejected', async () => {
    const res = await callPublish({}, validBody);
    expect(res.status).toBe(401);
    expect(committed).toHaveLength(0);
  });

  test('malformed Authorization header is rejected', async () => {
    const res = await callPublish({ Authorization: 'Basic hunter2' }, validBody);
    expect(res.status).toBe(401);
    expect(committed).toHaveLength(0);
  });

  test('invalid ID token is rejected', async () => {
    verifyIdToken.mockRejectedValue(new Error('Decoding Firebase ID token failed'));
    const res = await callPublish({ Authorization: 'Bearer forged.token' }, validBody);
    expect(res.status).toBe(401);
    expect(committed).toHaveLength(0);
  });

  test('valid token from a NON-owner is rejected with 403', async () => {
    verifyIdToken.mockResolvedValue({ uid: OTHER_UID });
    const res = await callPublish({ Authorization: 'Bearer valid.token' }, validBody);
    expect(res.status).toBe(403);
    expect(committed).toHaveLength(0);
  });

  test('client-supplied owner identity in the body is ignored', async () => {
    verifyIdToken.mockResolvedValue({ uid: OTHER_UID });
    const res = await callPublish(
      { Authorization: 'Bearer valid.token' },
      { ...validBody, ownerId: OWNER_UID, publishedBy: OWNER_UID }
    );
    expect(res.status).toBe(403);
    expect(committed).toHaveLength(0);
  });

  test('valid token from the owner succeeds', async () => {
    verifyIdToken.mockResolvedValue({ uid: OWNER_UID });
    const res = await callPublish({ Authorization: 'Bearer valid.token' }, validBody);
    expect(res.status).toBe(200);
    expect(committed.length).toBeGreaterThan(0);
  });

  test('publishedBy is recorded from the verified token, not the request body', async () => {
    verifyIdToken.mockResolvedValue({ uid: OWNER_UID });
    await callPublish(
      { Authorization: 'Bearer valid.token' },
      { ...validBody, publishedBy: 'attacker_supplied' }
    );
    const record = committed.find((c) => c.path.includes('/publications/'));
    expect(record).toBeDefined();
    expect((record!.data as { publishedBy: string }).publishedBy).toBe(OWNER_UID);
  });

  test('no Firestore read of manuscript content happens before authorization fails', async () => {
    const spied = makeDb();
    const seen: string[] = [];
    const original = spied.doc;
    spied.doc = (path: string) => {
      seen.push(path);
      return original(path);
    };
    db = spied;
    const res = await callPublish({}, validBody);
    expect(res.status).toBe(401);
    expect(seen.filter((p) => p.includes('revisions'))).toHaveLength(0);
  });
});

describe('C2 — published HTML is safe', () => {
  test('script tags in manuscript prose are not emitted as live markup', async () => {
    verifyIdToken.mockResolvedValue({ uid: OWNER_UID });
    await callPublish({ Authorization: 'Bearer valid.token' }, validBody);

    const chapter = committed.find((c) => c.path.startsWith('publicProjects/') && c.path.includes('/chapters/'));
    expect(chapter).toBeDefined();
    const html = (chapter!.data as { renderedHtml: string }).renderedHtml;

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Hello');
    expect(html).toContain('world');
  });
});

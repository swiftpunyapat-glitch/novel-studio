import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

/**
 * H10 — AI read API: fail-closed secret configuration and owner scoping.
 */

const OWNER_UID = 'owner_uid_alice';
const OTHER_UID = 'other_uid_mallory';

const projectDocs = [
  { id: 'project_alpha', ownerId: OWNER_UID, title: 'Owned Novel', slug: 'owned-novel' },
  { id: 'project_beta', ownerId: OTHER_UID, title: 'Someone Elses Novel', slug: 'other-novel' },
];

/** Records which where() constraints the route applied. */
const whereCalls: Array<[string, string, unknown]> = [];

function makeQuery(docs: typeof projectDocs) {
  return {
    where: (field: string, op: string, value: unknown) => {
      whereCalls.push([field, op, value]);
      return makeQuery(docs.filter((d) => (d as never as Record<string, unknown>)[field] === value));
    },
    orderBy: () => makeQuery(docs),
    limit: () => makeQuery(docs),
    get: async () => ({
      empty: docs.length === 0,
      docs: docs.map((d) => ({ id: d.id, data: () => d })),
    }),
  };
}

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: () => makeQuery(projectDocs),
    doc: () => ({
      get: async () => ({ exists: false, data: () => undefined }),
      collection: () => makeQuery([]),
    }),
  },
  adminAuth: { verifyIdToken: vi.fn() },
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  whereCalls.length = 0;
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

async function callProjects(headers: Record<string, string>) {
  const { GET } = await import('@/app/api/ai/projects/route');
  const req = new Request('http://localhost/api/ai/projects', { headers });
  return GET(req as never);
}

describe('H10 — fail closed on missing configuration', () => {
  test('missing NOVEL_AI_READ_TOKEN denies the request', async () => {
    delete process.env.NOVEL_AI_READ_TOKEN;
    process.env.NOVEL_OWNER_UID = OWNER_UID;
    const res = await callProjects({ Authorization: 'Bearer demo_novel_ai_secret_token_123' });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  test('the removed hardcoded fallback secret no longer authenticates', async () => {
    delete process.env.NOVEL_AI_READ_TOKEN;
    process.env.NOVEL_OWNER_UID = OWNER_UID;
    const res = await callProjects({ Authorization: 'Bearer demo_novel_ai_secret_token_123' });
    expect(res.status).not.toBe(200);
  });

  test('missing NOVEL_OWNER_UID denies the request even with a valid token', async () => {
    process.env.NOVEL_AI_READ_TOKEN = 'a-real-token-value-32-chars-long';
    delete process.env.NOVEL_OWNER_UID;
    const res = await callProjects({ Authorization: 'Bearer a-real-token-value-32-chars-long' });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });

  test('empty-string token configuration does not authenticate an empty bearer', async () => {
    process.env.NOVEL_AI_READ_TOKEN = '';
    process.env.NOVEL_OWNER_UID = OWNER_UID;
    const res = await callProjects({ Authorization: 'Bearer ' });
    expect(res.status).toBeGreaterThanOrEqual(401);
  });
});

describe('H10 — token verification', () => {
  beforeEach(() => {
    process.env.NOVEL_AI_READ_TOKEN = 'a-real-token-value-32-chars-long';
    process.env.NOVEL_OWNER_UID = OWNER_UID;
  });

  test('missing Authorization header is rejected', async () => {
    const res = await callProjects({});
    expect(res.status).toBe(401);
  });

  test('wrong token is rejected', async () => {
    const res = await callProjects({ Authorization: 'Bearer wrong-token-of-same-length-here' });
    expect(res.status).toBe(401);
  });

  test('correct token is accepted', async () => {
    const res = await callProjects({ Authorization: 'Bearer a-real-token-value-32-chars-long' });
    expect(res.status).toBe(200);
  });
});

describe('H10 — owner scoping', () => {
  beforeEach(() => {
    process.env.NOVEL_AI_READ_TOKEN = 'a-real-token-value-32-chars-long';
    process.env.NOVEL_OWNER_UID = OWNER_UID;
  });

  test('the projects query is filtered by the configured owner uid', async () => {
    await callProjects({ Authorization: 'Bearer a-real-token-value-32-chars-long' });
    expect(whereCalls).toContainEqual(['ownerId', '==', OWNER_UID]);
  });

  test('another owner\'s project is not returned', async () => {
    const res = await callProjects({ Authorization: 'Bearer a-real-token-value-32-chars-long' });
    const body = (await res.json()) as { projects: Array<{ id: string }> };
    const ids = body.projects.map((p) => p.id);
    expect(ids).toContain('project_alpha');
    expect(ids).not.toContain('project_beta');
  });
});

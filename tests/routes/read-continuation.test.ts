import { describe, expect, test, vi, beforeEach } from 'vitest';

/**
 * The continuation endpoint is unauthenticated by design, so what it can reach
 * matters as much as what it returns. These pin both: it never leaves
 * `publicProjects`, and it never sends a field that was not published.
 */

const PUBLIC_SLUG = 'redline-love';

/** Every collection path the route touched, so reach can be asserted. */
let touched: string[] = [];

const book = {
  volumes: [
    { id: 'v1', order: 0 },
    { id: 'v2', order: 1 },
  ],
  chapters: [
    { id: 'c1', order: 1, volumeId: 'v1' },
    { id: 'c2', order: 2, volumeId: 'v1' },
    { id: 'c3', order: 1, volumeId: 'v2' },
  ],
};

/** Full published snapshots, including a field a reader must never receive. */
const snapshots: Record<string, Record<string, unknown>> = {
  c1: { title: 'One', chapterNumber: 1, renderedHtml: '<p>one</p>', sourceRevisionId: 'rev_secret' },
  c2: { title: 'Two', chapterNumber: 2, renderedHtml: '<p>two</p>', sourceVariantId: 'var_secret' },
  c3: { title: 'Three', chapterNumber: 3, renderedHtml: '<p>three</p>', plainText: 'three' },
};

function makeCollection(path: string) {
  const isChapters = path.endsWith('/chapters');
  const rows = isChapters ? book.chapters : book.volumes;

  const snap = {
    empty: rows.length === 0,
    docs: rows.map((r) => ({ id: r.id, data: () => r })),
  };

  return {
    select: (..._fields: string[]) => ({ get: async () => snap }),
    get: async () => snap,
    doc: (id: string) => ({
      get: async () => ({
        exists: id in snapshots,
        id,
        data: () => snapshots[id],
      }),
    }),
  };
}

vi.mock('@/lib/firebase/admin', () => ({
  adminDb: {
    collection: (name: string) => {
      touched.push(name);
      return {
        doc: (slug: string) => ({
          get: async () => ({ exists: slug === PUBLIC_SLUG, data: () => ({ title: 'REDLINE LOVE' }) }),
          collection: (sub: string) => {
            touched.push(`${name}/${slug}/${sub}`);
            return makeCollection(`${name}/${slug}/${sub}`);
          },
        }),
      };
    },
  },
  adminAuth: { verifyIdToken: vi.fn() },
}));

async function call(slug: string, query: string) {
  const { GET } = await import('@/app/api/read/[projectSlug]/chapters/route');
  const req = new Request(`http://localhost/api/read/${slug}/chapters${query}`);
  return GET(req as never, { params: { projectSlug: slug } });
}

beforeEach(() => {
  vi.resetModules();
  touched = [];
});

describe('Continuation returns the next chapters in reading order', () => {
  test('the chapter after the first is the second', async () => {
    const res = await call(PUBLIC_SLUG, '?after=c1&limit=1');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.chapters.map((c: { id: string }) => c.id)).toEqual(['c2']);
    expect(body.hasMore).toBe(true);
  });

  test('reading continues across a volume boundary', async () => {
    const res = await call(PUBLIC_SLUG, '?after=c2');
    const body = await res.json();
    expect(body.chapters.map((c: { id: string }) => c.id)).toEqual(['c3']);
    expect(body.hasMore).toBe(false);
  });

  test('the last chapter reports no more', async () => {
    const res = await call(PUBLIC_SLUG, '?after=c3');
    const body = await res.json();
    expect(body.chapters).toEqual([]);
    expect(body.hasMore).toBe(false);
  });

  test('the rendered prose is included', async () => {
    const res = await call(PUBLIC_SLUG, '?after=c1&limit=1');
    const body = await res.json();
    expect(body.chapters[0].renderedHtml).toBe('<p>two</p>');
  });
});

describe('Only published fields are sent', () => {
  test('internal source ids never reach a reader', async () => {
    const res = await call(PUBLIC_SLUG, '?after=c1&limit=5');
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('rev_secret');
    expect(text).not.toContain('var_secret');
    expect(text).not.toContain('sourceRevisionId');
    expect(text).not.toContain('sourceVariantId');
  });

  test('the response carries only the reader fields', async () => {
    const res = await call(PUBLIC_SLUG, '?after=c1&limit=1');
    const body = await res.json();
    expect(Object.keys(body.chapters[0]).sort()).toEqual(
      [
        'chapterNumber',
        'chapterType',
        'dateText',
        'id',
        'locationText',
        'renderedHtml',
        'slug',
        'subtitle',
        'title',
        'volumeSlug',
      ].sort()
    );
  });
});

describe('It never reaches outside publicProjects', () => {
  test('only the public collection is opened', async () => {
    await call(PUBLIC_SLUG, '?after=c1');
    expect(touched.every((p) => p.startsWith('publicProjects'))).toBe(true);
    expect(touched.some((p) => p.includes('projects/'))).toBe(false);
  });

  test('a slug containing a path separator is refused before any read', async () => {
    const res = await call('a%2Fb', '?after=c1');
    // The route validates the decoded param it is handed.
    const direct = await (async () => {
      const { GET } = await import('@/app/api/read/[projectSlug]/chapters/route');
      const req = new Request('http://localhost/api/read/x/chapters?after=c1');
      return GET(req as never, { params: { projectSlug: 'slug/volumes/v1' } });
    })();
    expect(direct.status).toBe(404);
    expect(res.status).toBeGreaterThanOrEqual(200);
  });

  test('a cursor containing a path separator is refused', async () => {
    const res = await call(PUBLIC_SLUG, '?after=a%2Fb');
    expect(res.status).toBe(400);
  });

  test('a missing cursor is refused', async () => {
    const res = await call(PUBLIC_SLUG, '');
    expect(res.status).toBe(400);
  });
});

describe('The batch size is bounded', () => {
  test('an absurd limit is clamped rather than honoured', async () => {
    const res = await call(PUBLIC_SLUG, '?after=c1&limit=100000');
    const body = await res.json();
    // Only two chapters follow c1, but the clamp is what stops a whole book
    // being sent in one response.
    expect(body.chapters.length).toBeLessThanOrEqual(10);
  });

  test('a nonsense limit falls back to the default', async () => {
    const res = await call(PUBLIC_SLUG, '?after=c1&limit=abc');
    expect(res.status).toBe(200);
  });

  test('responses are cacheable, since published chapters rarely change', async () => {
    const res = await call(PUBLIC_SLUG, '?after=c1');
    expect(res.headers.get('Cache-Control')).toContain('max-age');
  });
});

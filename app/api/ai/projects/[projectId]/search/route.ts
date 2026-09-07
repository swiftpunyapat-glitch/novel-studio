import { authenticateAiRequest } from '@/lib/ai/auth';
import { resolveOwnedProject, clampLimit } from '@/lib/ai/scope';
import { aiJson } from '@/lib/ai/serialize';
import { adminDb } from '@/lib/firebase/admin';

/**
 * Read-only: substring search across the active variant of every chapter.
 *
 * POST because the query travels in a body, not because anything is written —
 * no document is created, updated or deleted on this path.
 */

export const dynamic = 'force-dynamic';

/**
 * The query is scanned against every chapter's full text, so its length is
 * bounded: an unbounded one turns a read into an expensive scan.
 */
const MAX_QUERY_LENGTH = 200;

interface SearchResult {
  chapterId: string;
  chapterTitle: string;
  volumeTitle: string;
  snippet: string;
  matchIndex: number;
}

export async function POST(
  req: Request,
  { params }: { params: { projectId: string } }
) {
  const auth = authenticateAiRequest(req);
  if ('response' in auth) return auth.response;

  try {
    const scoped = await resolveOwnedProject(auth.principal.ownerUid, params.projectId);
    if (!scoped) {
      return aiJson({ error: 'Project not found' }, 404);
    }

    let body: { query?: unknown; limit?: unknown };
    try {
      body = await req.json();
    } catch {
      return aiJson({ error: 'Malformed request body' }, 400);
    }

    const queryStr = typeof body.query === 'string' ? body.query.trim() : '';
    if (!queryStr) {
      return aiJson({ error: 'Missing search query' }, 400);
    }
    if (queryStr.length > MAX_QUERY_LENGTH) {
      return aiJson({ error: 'Search query is too long' }, 400);
    }
    const limitCount = clampLimit(body.limit);

    const projectRef = adminDb.collection('projects').doc(scoped.projectId);
    const [volsSnap, chapsSnap] = await Promise.all([
      projectRef.collection('volumes').get(),
      projectRef.collection('chapters').get(),
    ]);

    const volumeMap = new Map<string, string>();
    volsSnap.docs.forEach((d) => {
      volumeMap.set(d.id, d.data().title || 'Untitled Volume');
    });

    // Fetch active variants in parallel rather than one round-trip per chapter.
    const chapters = chapsSnap.docs
      .map((d) => ({ id: d.id, data: d.data() }))
      .filter((c) => typeof c.data.activeVariantId === 'string' && c.data.activeVariantId);

    const variantDocs = await Promise.all(
      chapters.map((c) =>
        projectRef
          .collection('chapters')
          .doc(c.id)
          .collection('variants')
          .doc(c.data.activeVariantId as string)
          .get()
      )
    );

    const results: SearchResult[] = [];
    const lowerQuery = queryStr.toLowerCase();

    outer: for (let i = 0; i < chapters.length; i++) {
      const varDoc = variantDocs[i];
      if (!varDoc.exists) continue;

      const chapter = chapters[i];
      const plainText: string = varDoc.data()?.plainText || '';
      const lowerText = plainText.toLowerCase();

      let startIndex = 0;
      while ((startIndex = lowerText.indexOf(lowerQuery, startIndex)) !== -1) {
        const snippetStart = Math.max(0, startIndex - 40);
        const snippetEnd = Math.min(plainText.length, startIndex + queryStr.length + 40);
        const snippet =
          (snippetStart > 0 ? '...' : '') +
          plainText.substring(snippetStart, snippetEnd).replace(/\n+/g, ' ') +
          (snippetEnd < plainText.length ? '...' : '');

        results.push({
          chapterId: chapter.id,
          // Named and coerced rather than passed through, like every other
          // field this API returns. (lib/ai/serialize.ts)
          chapterTitle: typeof chapter.data.title === 'string' ? chapter.data.title : '',
          volumeTitle: volumeMap.get(String(chapter.data.volumeId ?? '')) || 'Unknown Volume',
          snippet,
          matchIndex: startIndex,
        });

        if (results.length >= limitCount) break outer;
        startIndex += queryStr.length;
      }
    }

    return aiJson({
      query: queryStr,
      totalMatches: results.length,
      results,
    });
  } catch (err) {
    console.error('AI search request failed', err);
    return aiJson({ error: 'Request failed' }, 500);
  }
}

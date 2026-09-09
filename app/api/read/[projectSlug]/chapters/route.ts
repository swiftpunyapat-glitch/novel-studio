import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import {
  chaptersAfter,
  isValidPublicSlug,
  sortChaptersForReading,
} from '@/lib/publishing/reading-order';

/**
 * The next chapters of a published book, for continuous reading.
 *
 * Deliberately unauthenticated: everything it can reach lives under
 * `publicProjects`, which `firestore.rules` already makes world-readable and
 * which only the publishing route can write. It reads nothing else — there is
 * no code path here that can name a private project, chapter, variant or
 * revision, because every reference is rooted at `publicProjects/{slug}`.
 *
 * Why an endpoint at all: a novel is too large to send as one page, so the
 * reader asks for the next few chapters as it approaches the end of what it
 * has. Publishing stays per-chapter; only reading is continuous.
 */

export const dynamic = 'force-dynamic';

/** Enough to stay ahead of a scrolling reader without sending a whole book. */
const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 10;

function clampLimit(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

export async function GET(
  req: Request,
  { params }: { params: { projectSlug: string } }
) {
  const { projectSlug } = params;

  if (!isValidPublicSlug(projectSlug)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const url = new URL(req.url);
  const after = url.searchParams.get('after');
  const limit = clampLimit(url.searchParams.get('limit'));

  if (!after || after.includes('/')) {
    return NextResponse.json({ error: 'Missing or invalid cursor' }, { status: 400 });
  }

  try {
    const bookRef = adminDb.collection('publicProjects').doc(projectSlug);

    // Ordering needs only the position fields, so the prose of every chapter is
    // deliberately left on the server; only the batch below is fetched in full.
    const [volumesSnap, indexSnap] = await Promise.all([
      bookRef.collection('volumes').select('order').get(),
      bookRef.collection('chapters').select('order', 'volumeId').get(),
    ]);

    if (indexSnap.empty) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const ordered = sortChaptersForReading(
      indexSnap.docs.map((d) => ({
        id: d.id,
        order: d.data().order as number | undefined,
        volumeId: d.data().volumeId as string | undefined,
      })),
      volumesSnap.docs.map((d) => ({ id: d.id, order: d.data().order as number | undefined }))
    );

    const next = chaptersAfter(ordered, after, limit);
    if (next.length === 0) {
      return NextResponse.json({ chapters: [], hasMore: false });
    }

    const docs = await Promise.all(
      next.map((c) => bookRef.collection('chapters').doc(c.id).get())
    );

    const chapters = docs
      .filter((d) => d.exists)
      .map((d) => {
        const data = d.data() ?? {};
        // An explicit allow-list: whatever else a published snapshot grows,
        // only these fields are ever sent to a reader.
        return {
          id: d.id,
          slug: typeof data.slug === 'string' && data.slug ? data.slug : d.id,
          volumeSlug:
            typeof data.volumeSlug === 'string' && data.volumeSlug ? data.volumeSlug : 'volume',
          chapterType:
            data.chapterType === 'prologue' || data.chapterType === 'epilogue'
              ? data.chapterType
              : 'chapter',
          chapterNumber: data.chapterNumber ?? null,
          title: data.title ?? '',
          subtitle: data.subtitle ?? null,
          dateText: data.dateText ?? null,
          locationText: data.locationText ?? null,
          renderedHtml: data.renderedHtml ?? '',
        };
      });

    const lastId = next[next.length - 1].id;
    const hasMore = chaptersAfter(ordered, lastId, 1).length > 0;

    return NextResponse.json(
      { chapters, hasMore },
      {
        headers: {
          // Published chapters change only when the author republishes, so a
          // short shared cache spares Firestore a read per scrolling reader.
          'Cache-Control': 'public, max-age=60, s-maxage=300',
        },
      }
    );
  } catch (err) {
    console.error('Continuous reading request failed', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}

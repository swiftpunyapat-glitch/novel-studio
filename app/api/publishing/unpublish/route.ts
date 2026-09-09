import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import {
  AuthError,
  requireVerifiedUser,
  requireProjectOwner,
} from '@/lib/server/auth';

/**
 * Takes a published chapter back off the public reader.
 *
 * Until now the only way to unpublish was to delete the document in the
 * Firebase console, which is the kind of gap that ends with the wrong thing
 * being deleted. It mirrors the publish route exactly: a verified ID token,
 * an ownership check, and only then any Firestore access.
 *
 * What it removes is the PUBLIC SNAPSHOT only. The chapter, its variants and
 * its revisions are untouched — unpublishing withdraws a book from the shelf,
 * it does not destroy the manuscript. The audit record is kept too, and marked
 * `unpublished`, because the history of what was public and when is exactly the
 * thing an audit trail exists to preserve.
 */

export const dynamic = 'force-dynamic';

interface UnpublishBody {
  projectId?: unknown;
  chapterId?: unknown;
}

function readId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new AuthError(404, `Missing or invalid ${field}`);
  }
  const id = value.trim();
  if (id.includes('/') || id === '.' || id === '..') {
    throw new AuthError(404, `Missing or invalid ${field}`);
  }
  return id;
}

export async function POST(req: Request) {
  try {
    const { uid } = await requireVerifiedUser(req);

    let body: UnpublishBody;
    try {
      body = (await req.json()) as UnpublishBody;
    } catch {
      return NextResponse.json({ error: 'Malformed request body' }, { status: 400 });
    }

    const projectId = readId(body.projectId, 'projectId');
    const chapterId = readId(body.chapterId, 'chapterId');

    const projectData = await requireProjectOwner(uid, projectId);

    const projectRef = adminDb.collection('projects').doc(projectId);
    const chapterRef = projectRef.collection('chapters').doc(chapterId);

    // The public book is addressed by the slug this project reserved, so a
    // project that never published has nothing to withdraw.
    const reservation = await adminDb
      .collection('publicSlugs')
      .where('projectId', '==', projectId)
      .limit(1)
      .get();

    const projectSlug = reservation.empty
      ? typeof projectData.slug === 'string'
        ? projectData.slug
        : null
      : reservation.docs[0].id;

    if (!projectSlug) {
      return NextResponse.json({ error: 'This project has never been published' }, { status: 404 });
    }

    const publicChapterRef = adminDb
      .collection('publicProjects')
      .doc(projectSlug)
      .collection('chapters')
      .doc(chapterId);

    const publicSnap = await publicChapterRef.get();
    if (!publicSnap.exists) {
      return NextResponse.json({ error: 'That chapter is not published' }, { status: 404 });
    }

    const now = Date.now();
    const batch = adminDb.batch();

    // 1. Remove the public snapshot. This is the only deletion.
    batch.delete(publicChapterRef);

    // 2. The chapter is no longer pointing at a published revision, which is
    //    what the studio reads to show a chapter as published.
    batch.update(chapterRef, {
      publishedRevisionId: null,
      updatedAt: now,
    });

    // 3. Record the withdrawal, from the verified identity.
    const pubRef = projectRef.collection('publications').doc();
    batch.set(pubRef, {
      id: pubRef.id,
      projectId,
      scope: 'chapter',
      targetEntityId: chapterId,
      sourceVariantId: publicSnap.data()?.sourceVariantId ?? null,
      sourceRevisionId: publicSnap.data()?.sourceRevisionId ?? null,
      publishedBy: uid,
      publishedAt: now,
      status: 'unpublished',
      metadata: {
        title: publicSnap.data()?.title ?? '',
        wordCount: publicSnap.data()?.wordCount ?? 0,
      },
    });

    await batch.commit();

    // The book itself stays, even with no chapters left: the reservation keeps
    // the slug so republishing later lands on the same public address.
    return NextResponse.json({ success: true, unpublishedAt: now });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.publicMessage }, { status: err.status });
    }
    console.error('Unpublish failed', err);
    return NextResponse.json({ error: 'Unpublishing failed' }, { status: 500 });
  }
}

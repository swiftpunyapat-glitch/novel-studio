import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import {
  AuthError,
  requireVerifiedUser,
  requireProjectOwner,
} from '@/lib/server/auth';
import { renderTiptapToSafeHtml, renderTiptapToPlainText } from '@/lib/publishing/render';
import { makeSlug, slugCandidates } from '@/lib/publishing/slug';
import { chapterPath, resolveChapterSlug } from '@/lib/publishing/chapter-slug';
import { resolveChapterType } from '@/types/project';
import { DEFAULT_DOCUMENT_SETTINGS } from '@/types/project';

/**
 * Publishes a frozen revision snapshot to the public reader.
 *
 * Audit repairs applied here:
 *   C1 — a verified Firebase ID token and a project-ownership check gate every
 *        Firestore access; no manuscript data is read before authorization.
 *   C2 — public HTML is produced by a controlled allow-list renderer over the
 *        revision's Tiptap tree, never by string interpolation of prose.
 *   C6 — the public slug is Unicode-safe and claimed through a transactional
 *        `publicSlugs/{slug}` reservation, so two authors sharing a title can no
 *        longer merge into one public book.
 */

export const dynamic = 'force-dynamic';

interface PublishBody {
  projectId?: unknown;
  chapterId?: unknown;
  variantId?: unknown;
  revisionId?: unknown;
}

/** Rejects ids that could be reinterpreted as Firestore sub-paths. */
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

/**
 * Claims a public slug for this project, or confirms this project already owns
 * one. Runs in a transaction so concurrent publishes cannot both take a slug.
 */
async function reserveSlug(projectId: string, title: string): Promise<string> {
  const existing = await adminDb
    .collection('publicSlugs')
    .where('projectId', '==', projectId)
    .limit(1)
    .get();

  if (!existing.empty) {
    // A project keeps its slug for life so published URLs never break.
    return existing.docs[0].id;
  }

  for (const candidate of slugCandidates(title || projectId)) {
    const ref = adminDb.collection('publicSlugs').doc(candidate);

    const claimed = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists) {
        return snap.data()?.projectId === projectId;
      }
      tx.set(ref, { slug: candidate, projectId, createdAt: Date.now() });
      return true;
    });

    if (claimed) return candidate;
  }

  throw new AuthError(403, 'Could not allocate a unique public address for this novel');
}

export async function POST(req: Request) {
  try {
    // ---- 1. Authorize BEFORE touching any manuscript data. ----
    const { uid } = await requireVerifiedUser(req);

    let body: PublishBody;
    try {
      body = (await req.json()) as PublishBody;
    } catch {
      return NextResponse.json({ error: 'Malformed request body' }, { status: 400 });
    }

    const projectId = readId(body.projectId, 'projectId');
    const chapterId = readId(body.chapterId, 'chapterId');
    const variantId = readId(body.variantId, 'variantId');
    const revisionId = readId(body.revisionId, 'revisionId');

    // Ownership is resolved from the verified uid and the stored ownerId only.
    // Any ownerId/publishedBy in the request body is ignored by construction.
    const projectData = await requireProjectOwner(uid, projectId);

    // ---- 2. Load the chapter, volume and frozen revision. ----
    const projectRef = adminDb.collection('projects').doc(projectId);
    const chapterRef = projectRef.collection('chapters').doc(chapterId);

    const chapterSnap = await chapterRef.get();
    if (!chapterSnap.exists) {
      return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
    }
    const chapterData = chapterSnap.data() ?? {};

    const revisionSnap = await chapterRef
      .collection('variants')
      .doc(variantId)
      .collection('revisions')
      .doc(revisionId)
      .get();

    if (!revisionSnap.exists) {
      return NextResponse.json({ error: 'Selected revision not found' }, { status: 404 });
    }
    const revisionData = revisionSnap.data() ?? {};

    let volumeData: FirebaseFirestore.DocumentData | null = null;
    if (typeof chapterData.volumeId === 'string' && chapterData.volumeId) {
      const volumeSnap = await projectRef
        .collection('volumes')
        .doc(chapterData.volumeId)
        .get();
      volumeData = volumeSnap.exists ? (volumeSnap.data() ?? null) : null;
    }

    // ---- 3. Render published HTML through the allow-list renderer. ----
    const renderedHtml = renderTiptapToSafeHtml(revisionData.content);
    const plainText =
      renderTiptapToPlainText(revisionData.content) ||
      (typeof revisionData.plainText === 'string' ? revisionData.plainText : '');

    // ---- 4. Claim the public address. ----
    const projectSlug = await reserveSlug(
      projectId,
      typeof projectData.title === 'string' ? projectData.title : ''
    );

    // ---- 5. Give the chapter a stable public address, once. ----
    // Every other chapter's slug is read so a collision gets a suffix rather
    // than two chapters claiming the same URL.
    const siblingsSnap = await projectRef.collection('chapters').select('slug').get();
    const takenSlugs = siblingsSnap.docs
      .filter((d) => d.id !== chapterId)
      .map((d) => d.data().slug)
      .filter((v): v is string => typeof v === 'string' && v.length > 0);

    const { slug: chapterSlug, isNew: chapterSlugIsNew } = resolveChapterSlug(
      {
        slug: chapterData.slug,
        title: chapterData.title,
        chapterNumber: chapterData.chapterNumber,
        chapterType: resolveChapterType(chapterData as { chapterType?: never }),
      },
      takenSlugs
    );

    const volumeSlug =
      (typeof volumeData?.slug === 'string' && volumeData.slug) ||
      makeSlug(String(volumeData?.title ?? '')) ||
      'volume';

    const now = Date.now();
    const publicProjRef = adminDb.collection('publicProjects').doc(projectSlug);

    // Preserve the original first-published timestamp across republishes.
    const existingPublic = await publicProjRef.get();
    const firstPublishedAt = existingPublic.exists
      ? (existingPublic.data()?.publishedAt ?? now)
      : now;

    const batch = adminDb.batch();

    batch.set(
      publicProjRef,
      {
        slug: projectSlug,
        projectId,
        title: projectData.title ?? '',
        description: projectData.description ?? '',
        publishedAt: firstPublishedAt,
        lastRepublishedAt: now,
        readingSettings: {
          bodyFont:
            projectData.documentSettings?.bodyFont ?? DEFAULT_DOCUMENT_SETTINGS.bodyFont,
          firstLineIndentCm: projectData.documentSettings?.firstLineIndentCm ?? 0.5,
          sceneBreakSymbol: projectData.documentSettings?.sceneBreakSymbol ?? '***',
        },
      },
      { merge: true }
    );

    if (volumeData) {
      batch.set(
        publicProjRef.collection('volumes').doc(chapterData.volumeId as string),
        {
          id: chapterData.volumeId,
          volumeNumber: volumeData.volumeNumber ?? null,
          title: volumeData.title ?? '',
          slug: volumeData.slug ?? makeSlug(String(volumeData.title ?? '')),
          order: volumeData.order ?? 0,
        },
        { merge: true }
      );
    }

    batch.set(publicProjRef.collection('chapters').doc(chapterId), {
      id: chapterId,
      volumeId: chapterData.volumeId ?? null,
      slug: chapterSlug,
      volumeSlug,
      // Carried so the reader can label a prologue or epilogue as one instead
      // of showing it as a chapter with no number.
      chapterType: resolveChapterType(chapterData as { chapterType?: never }),
      chapterNumber: chapterData.chapterNumber ?? null,
      title: chapterData.title ?? '',
      subtitle: chapterData.subtitle ?? null,
      dateText: chapterData.dateText ?? null,
      locationText: chapterData.locationText ?? null,
      order: chapterData.order ?? 0,
      sourceVariantId: variantId,
      sourceRevisionId: revisionId,
      publishedAt: now,
      wordCount: revisionData.wordCount ?? 0,
      renderedHtml,
      plainText,
    });

    // Audit record. publishedBy comes from the verified token, never the body.
    const pubRef = projectRef.collection('publications').doc();
    batch.set(pubRef, {
      id: pubRef.id,
      projectId,
      scope: 'chapter',
      targetEntityId: chapterId,
      sourceVariantId: variantId,
      sourceRevisionId: revisionId,
      publishedBy: uid,
      publishedAt: now,
      status: 'active',
      metadata: {
        title: chapterData.title ?? '',
        wordCount: revisionData.wordCount ?? 0,
      },
    });

    batch.update(chapterRef, {
      publishedRevisionId: revisionId,
      // Written only the first time, so a later rename cannot move the URL.
      ...(chapterSlugIsNew ? { slug: chapterSlug } : {}),
      updatedAt: now,
    });

    await batch.commit();

    return NextResponse.json({
      success: true,
      publishedAt: now,
      slug: projectSlug,
      chapterSlug,
      volumeSlug,
      publicUrl: chapterPath(projectSlug, volumeSlug, chapterSlug),
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.publicMessage }, { status: err.status });
    }
    // Never echo internal error text to the caller.
    console.error('Publish failed', err);
    return NextResponse.json({ error: 'Publishing failed' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { projectId, chapterId, variantId, revisionId } = body;

    if (!projectId || !chapterId || !variantId || !revisionId) {
      return NextResponse.json({ error: 'Missing publication parameters' }, { status: 400 });
    }

    // 1. Fetch Project for slug and settings
    const projectDoc = await adminDb.collection('projects').doc(projectId).get();
    if (!projectDoc.exists) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    const projectData = projectDoc.data();
    const projectSlug = projectData?.slug || projectId;

    // 2. Fetch Chapter
    const chapterDoc = await adminDb
      .collection('projects')
      .doc(projectId)
      .collection('chapters')
      .doc(chapterId)
      .get();
    if (!chapterDoc.exists) {
      return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
    }
    const chapterData = chapterDoc.data();

    // 3. Fetch Volume
    const volumeDoc = await adminDb
      .collection('projects')
      .doc(projectId)
      .collection('volumes')
      .doc(chapterData?.volumeId)
      .get();
    const volumeData = volumeDoc.exists ? volumeDoc.data() : null;

    // 4. Fetch the target Revision (must be immutable snapshot)
    const revisionDoc = await adminDb
      .collection('projects')
      .doc(projectId)
      .collection('chapters')
      .doc(chapterId)
      .collection('variants')
      .doc(variantId)
      .collection('revisions')
      .doc(revisionId)
      .get();

    if (!revisionDoc.exists) {
      return NextResponse.json({ error: 'Selected revision not found' }, { status: 404 });
    }
    const revisionData = revisionDoc.data();

    // Pre-render simple HTML from plain text / paragraphs for fast reader loading
    const paragraphs = (revisionData?.plainText || '')
      .split('\n')
      .map((line: string) => line.trim())
      .filter(Boolean)
      .map((p: string) => {
        if (p === '***') {
          return `<div class="novel-scene-break">${projectData?.documentSettings?.sceneBreakSymbol || '***'}</div>`;
        }
        return `<p>${p}</p>`;
      })
      .join('');

    const now = Date.now();
    const batch = adminDb.batch();

    // Set public project metadata
    const publicProjRef = adminDb.collection('publicProjects').doc(projectSlug);
    batch.set(
      publicProjRef,
      {
        slug: projectSlug,
        projectId,
        title: projectData?.title,
        description: projectData?.description || '',
        publishedAt: projectData?.publishedAt || now,
        lastRepublishedAt: now,
        readingSettings: {
          bodyFont: projectData?.documentSettings?.bodyFont || 'Sarabun',
          firstLineIndentCm: projectData?.documentSettings?.firstLineIndentCm || 0.5,
          sceneBreakSymbol: projectData?.documentSettings?.sceneBreakSymbol || '***',
        },
      },
      { merge: true }
    );

    // Set public volume
    if (volumeData) {
      const publicVolRef = publicProjRef.collection('volumes').doc(chapterData?.volumeId);
      batch.set(
        publicVolRef,
        {
          id: chapterData?.volumeId,
          volumeNumber: volumeData.volumeNumber,
          title: volumeData.title,
          slug: volumeData.slug,
          order: volumeData.order,
        },
        { merge: true }
      );
    }

    // Set public chapter snapshot
    const publicChapRef = publicProjRef.collection('chapters').doc(chapterId);
    batch.set(publicChapRef, {
      id: chapterId,
      volumeId: chapterData?.volumeId,
      chapterNumber: chapterData?.chapterNumber,
      title: chapterData?.title,
      subtitle: chapterData?.subtitle || null,
      dateText: chapterData?.dateText || null,
      locationText: chapterData?.locationText || null,
      order: chapterData?.order,
      sourceRevisionId: revisionId,
      publishedAt: now,
      wordCount: revisionData?.wordCount || 0,
      renderedHtml: paragraphs,
      plainText: revisionData?.plainText || '',
    });

    // Record publication audit record
    const pubId = adminDb.collection('projects').doc(projectId).collection('publications').doc().id;
    const pubRecordRef = adminDb.collection('projects').doc(projectId).collection('publications').doc(pubId);
    batch.set(pubRecordRef, {
      id: pubId,
      projectId,
      scope: 'chapter',
      targetEntityId: chapterId,
      sourceVariantId: variantId,
      sourceRevisionId: revisionId,
      publishedAt: now,
      status: 'active',
      metadata: {
        title: chapterData?.title,
        wordCount: revisionData?.wordCount || 0,
      },
    });

    // Update chapter publishedRevisionId
    const privateChapRef = adminDb.collection('projects').doc(projectId).collection('chapters').doc(chapterId);
    batch.update(privateChapRef, {
      publishedRevisionId: revisionId,
      updatedAt: now,
    });

    await batch.commit();

    return NextResponse.json({
      success: true,
      publishedAt: now,
      publicUrl: `/read/${projectSlug}`,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('Publish transaction failed', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import { authenticateAiRequest } from '@/lib/ai/auth';
import { resolveOwnedProject } from '@/lib/ai/scope';
import { adminDb } from '@/lib/firebase/admin';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: { projectId: string; chapterId: string } }
) {
  const auth = authenticateAiRequest(req);
  if ('response' in auth) return auth.response;

  const { chapterId } = params;
  if (!chapterId || chapterId.includes('/')) {
    return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
  }

  try {
    const scoped = await resolveOwnedProject(auth.principal.ownerUid, params.projectId);
    if (!scoped) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const chapterRef = adminDb
      .collection('projects')
      .doc(scoped.projectId)
      .collection('chapters')
      .doc(chapterId);

    const chapDoc = await chapterRef.get();
    if (!chapDoc.exists) {
      return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
    }

    const chapData = chapDoc.data() ?? {};
    let variantData: FirebaseFirestore.DocumentData | null = null;

    if (typeof chapData.activeVariantId === 'string' && chapData.activeVariantId) {
      const varDoc = await chapterRef
        .collection('variants')
        .doc(chapData.activeVariantId)
        .get();
      if (varDoc.exists) variantData = varDoc.data() ?? null;
    }

    return NextResponse.json({
      chapterId,
      projectId: scoped.projectId,
      chapterNumber: chapData.chapterNumber,
      title: chapData.title,
      subtitle: chapData.subtitle,
      dateText: chapData.dateText,
      locationText: chapData.locationText,
      order: chapData.order,
      wordCount: variantData?.wordCount || 0,
      activeVariant: {
        id: chapData.activeVariantId,
        name: variantData?.name,
        status: variantData?.status,
        plainText: variantData?.plainText || '',
      },
    });
  } catch (err) {
    console.error('AI chapter request failed', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}

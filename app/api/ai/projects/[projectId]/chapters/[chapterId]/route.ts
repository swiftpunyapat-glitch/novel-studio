import { NextRequest, NextResponse } from 'next/server';
import { validateAiToken } from '@/lib/ai/auth';
import { adminDb } from '@/lib/firebase/admin';

export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string; chapterId: string } }
) {
  const authError = validateAiToken(req);
  if (authError) return authError;

  const { projectId, chapterId } = params;

  try {
    const chapDoc = await adminDb
      .collection('projects')
      .doc(projectId)
      .collection('chapters')
      .doc(chapterId)
      .get();

    if (!chapDoc.exists) {
      return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
    }

    const chapData = chapDoc.data();
    let variantData = null;

    if (chapData?.activeVariantId) {
      const varDoc = await adminDb
        .collection('projects')
        .doc(projectId)
        .collection('chapters')
        .doc(chapterId)
        .collection('variants')
        .doc(chapData.activeVariantId)
        .get();

      if (varDoc.exists) {
        variantData = varDoc.data();
      }
    }

    return NextResponse.json({
      chapterId,
      projectId,
      chapterNumber: chapData?.chapterNumber,
      title: chapData?.title,
      subtitle: chapData?.subtitle,
      dateText: chapData?.dateText,
      locationText: chapData?.locationText,
      order: chapData?.order,
      wordCount: variantData?.wordCount || 0,
      activeVariant: {
        id: chapData?.activeVariantId,
        name: variantData?.name,
        status: variantData?.status,
        plainText: variantData?.plainText || '',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

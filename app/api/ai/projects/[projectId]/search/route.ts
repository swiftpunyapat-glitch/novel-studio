import { NextRequest, NextResponse } from 'next/server';
import { validateAiToken } from '@/lib/ai/auth';
import { adminDb } from '@/lib/firebase/admin';

export async function POST(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const authError = validateAiToken(req);
  if (authError) return authError;

  const { projectId } = params;

  try {
    const body = await req.json();
    const queryStr = (body.query || '').trim();
    const limitCount = body.limit || 20;

    if (!queryStr) {
      return NextResponse.json({ error: 'Missing search query' }, { status: 400 });
    }

    const [volsSnap, chapsSnap] = await Promise.all([
      adminDb.collection('projects').doc(projectId).collection('volumes').get(),
      adminDb.collection('projects').doc(projectId).collection('chapters').get(),
    ]);

    const volumeMap = new Map<string, string>();
    volsSnap.docs.forEach((d) => {
      volumeMap.set(d.id, d.data().title || 'Untitled Volume');
    });

    const results: Array<{
      chapterId: string;
      chapterTitle: string;
      volumeTitle: string;
      snippet: string;
      matchIndex: number;
    }> = [];

    const lowerQuery = queryStr.toLowerCase();

    // Scan active variants of chapters
    for (const chapDoc of chapsSnap.docs) {
      const chapData = chapDoc.data();
      if (!chapData.activeVariantId) continue;

      const varDoc = await adminDb
        .collection('projects')
        .doc(projectId)
        .collection('chapters')
        .doc(chapDoc.id)
        .collection('variants')
        .doc(chapData.activeVariantId)
        .get();

      if (!varDoc.exists) continue;
      const plainText = varDoc.data()?.plainText || '';
      const lowerText = plainText.toLowerCase();

      let startIndex = 0;
      while ((startIndex = lowerText.indexOf(lowerQuery, startIndex)) !== -1) {
        const snippetStart = Math.max(0, startIndex - 40);
        const snippetEnd = Math.min(plainText.length, startIndex + queryStr.length + 40);
        const snippet = (snippetStart > 0 ? '...' : '') +
          plainText.substring(snippetStart, snippetEnd).replace(/\n+/g, ' ') +
          (snippetEnd < plainText.length ? '...' : '');

        results.push({
          chapterId: chapDoc.id,
          chapterTitle: chapData.title,
          volumeTitle: volumeMap.get(chapData.volumeId) || 'Unknown Volume',
          snippet,
          matchIndex: startIndex,
        });

        if (results.length >= limitCount) break;
        startIndex += queryStr.length;
      }

      if (results.length >= limitCount) break;
    }

    return NextResponse.json({
      query: queryStr,
      totalMatches: results.length,
      results,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

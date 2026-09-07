import { NextResponse } from 'next/server';
import { authenticateAiRequest } from '@/lib/ai/auth';
import { adminDb } from '@/lib/firebase/admin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const auth = authenticateAiRequest(req);
  if ('response' in auth) return auth.response;

  try {
    // Scoped to the configured owner: a leaked token cannot enumerate
    // other accounts' manuscripts. (Audit H10)
    const snapshot = await adminDb
      .collection('projects')
      .where('ownerId', '==', auth.principal.ownerUid)
      .get();

    const projects = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        title: data.title,
        slug: data.slug,
        description: data.description,
        isPublished: data.isPublished,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      };
    });

    return NextResponse.json({ projects });
  } catch (err) {
    console.error('AI projects listing failed', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}

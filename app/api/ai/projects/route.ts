import { NextRequest, NextResponse } from 'next/server';
import { validateAiToken } from '@/lib/ai/auth';
import { adminDb } from '@/lib/firebase/admin';

export async function GET(req: NextRequest) {
  const authError = validateAiToken(req);
  if (authError) return authError;

  try {
    const snapshot = await adminDb.collection('projects').get();
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

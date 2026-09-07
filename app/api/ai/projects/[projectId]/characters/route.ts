import { NextRequest, NextResponse } from 'next/server';
import { validateAiToken } from '@/lib/ai/auth';
import { adminDb } from '@/lib/firebase/admin';

export async function GET(
  req: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const authError = validateAiToken(req);
  if (authError) return authError;

  const { projectId } = params;

  try {
    const snapshot = await adminDb
      .collection('projects')
      .doc(projectId)
      .collection('characters')
      .orderBy('name', 'asc')
      .get();

    const characters = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        name: data.name,
        aliases: data.aliases || [],
        role: data.role,
        description: data.description,
        appearance: data.appearance,
        personality: data.personality,
        biography: data.biography,
        relationships: data.relationships || [],
        writerNotes: data.writerNotes || '',
      };
    });

    return NextResponse.json({ projectId, characters });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

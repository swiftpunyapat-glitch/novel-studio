import { authenticateAiRequest } from '@/lib/ai/auth';
import { resolveOwnedProject } from '@/lib/ai/scope';
import { aiJson } from '@/lib/ai/serialize';
import { adminDb } from '@/lib/firebase/admin';

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: { projectId: string } }
) {
  const auth = authenticateAiRequest(req);
  if ('response' in auth) return auth.response;

  try {
    const scoped = await resolveOwnedProject(auth.principal.ownerUid, params.projectId);
    if (!scoped) {
      return aiJson({ error: 'Project not found' }, 404);
    }

    const snapshot = await adminDb
      .collection('projects')
      .doc(scoped.projectId)
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

    return aiJson({ projectId: scoped.projectId, characters });
  } catch (err) {
    console.error('AI characters request failed', err);
    return aiJson({ error: 'Request failed' }, 500);
  }
}

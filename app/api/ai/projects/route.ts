import { authenticateAiRequest } from '@/lib/ai/auth';
import { aiJson, projectSummary } from '@/lib/ai/serialize';
import { adminDb } from '@/lib/firebase/admin';

/** Read-only: the projects the configured owner holds. No prose. */

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

    const projects = snapshot.docs.map((doc) => projectSummary(doc.id, doc.data()));

    return aiJson({ projects });
  } catch (err) {
    console.error('AI projects listing failed', err);
    return aiJson({ error: 'Request failed' }, 500);
  }
}

import { authenticateAiRequest } from '@/lib/ai/auth';
import { resolveOwnedProject } from '@/lib/ai/scope';
import { aiJson, chapterText } from '@/lib/ai/serialize';
import { adminDb } from '@/lib/firebase/admin';

/**
 * Read-only: the plain text of one chapter's active variant.
 *
 * Plain text only, deliberately. The manuscript's Tiptap JSON is the document's
 * internal representation; handing it out would make an external reader a
 * consumer of the editor's schema, and every future schema change its problem.
 * Sibling variants and revisions are not exposed either — a reader sees the
 * chapter as it currently stands, which is what "read the manuscript" means.
 */

export const dynamic = 'force-dynamic';

export async function GET(
  req: Request,
  { params }: { params: { projectId: string; chapterId: string } }
) {
  const auth = authenticateAiRequest(req);
  if ('response' in auth) return auth.response;

  const { chapterId } = params;
  if (!chapterId || chapterId.includes('/') || chapterId === '.' || chapterId === '..') {
    return aiJson({ error: 'Chapter not found' }, 404);
  }

  try {
    const scoped = await resolveOwnedProject(auth.principal.ownerUid, params.projectId);
    if (!scoped) {
      return aiJson({ error: 'Project not found' }, 404);
    }

    const chapterRef = adminDb
      .collection('projects')
      .doc(scoped.projectId)
      .collection('chapters')
      .doc(chapterId);

    const chapDoc = await chapterRef.get();
    if (!chapDoc.exists) {
      return aiJson({ error: 'Chapter not found' }, 404);
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

    return aiJson(chapterText(scoped.projectId, chapterId, chapData, variantData));
  } catch (err) {
    console.error('AI chapter request failed', err);
    return aiJson({ error: 'Request failed' }, 500);
  }
}

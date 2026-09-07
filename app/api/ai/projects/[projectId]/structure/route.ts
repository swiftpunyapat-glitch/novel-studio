import { authenticateAiRequest } from '@/lib/ai/auth';
import { resolveOwnedProject } from '@/lib/ai/scope';
import { aiJson, chapterSummary, volumeSummary } from '@/lib/ai/serialize';
import { adminDb } from '@/lib/firebase/admin';

/**
 * Read-only: the volume/chapter outline of one project. No prose.
 *
 * Both listings are projected through named allowlists. They previously used
 * `{ id, ...doc.data() }`, which returned every stored field — and would have
 * kept returning every field added later, without the diff that added it ever
 * mentioning this route.
 */

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

    const projectRef = adminDb.collection('projects').doc(scoped.projectId);
    const [volsSnap, chapsSnap] = await Promise.all([
      projectRef.collection('volumes').orderBy('order', 'asc').get(),
      projectRef.collection('chapters').orderBy('order', 'asc').get(),
    ]);

    const chapters = chapsSnap.docs.map((d) => chapterSummary(d.id, d.data()));

    const volumes = volsSnap.docs.map((d) => {
      const volume = volumeSummary(d.id, d.data());
      return {
        ...volume,
        chapters: chapters.filter((c) => c.volumeId === volume.id),
      };
    });

    // A chapter whose volume was removed would otherwise vanish from the
    // outline entirely, which would read as "this chapter does not exist".
    const orphanedChapters = chapters.filter(
      (c) => !volumes.some((v) => v.id === c.volumeId)
    );

    return aiJson({
      projectId: scoped.projectId,
      title: scoped.data.title ?? '',
      volumes,
      ...(orphanedChapters.length ? { orphanedChapters } : {}),
    });
  } catch (err) {
    console.error('AI structure request failed', err);
    return aiJson({ error: 'Request failed' }, 500);
  }
}

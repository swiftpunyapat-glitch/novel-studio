import { NextResponse } from 'next/server';
import { authenticateAiRequest } from '@/lib/ai/auth';
import { resolveOwnedProject } from '@/lib/ai/scope';
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
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const projectRef = adminDb.collection('projects').doc(scoped.projectId);
    const [volsSnap, chapsSnap] = await Promise.all([
      projectRef.collection('volumes').orderBy('order', 'asc').get(),
      projectRef.collection('chapters').orderBy('order', 'asc').get(),
    ]);

    const volumes = volsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const chapters = chapsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const structuredVolumes = volumes.map((vol) => ({
      ...vol,
      chapters: chapters.filter(
        (c) => (c as { volumeId?: string }).volumeId === vol.id
      ),
    }));

    return NextResponse.json({
      projectId: scoped.projectId,
      title: scoped.data.title,
      volumes: structuredVolumes,
    });
  } catch (err) {
    console.error('AI structure request failed', err);
    return NextResponse.json({ error: 'Request failed' }, { status: 500 });
  }
}

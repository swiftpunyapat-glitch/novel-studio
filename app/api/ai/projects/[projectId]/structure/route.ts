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
    const projectDoc = await adminDb.collection('projects').doc(projectId).get();
    if (!projectDoc.exists) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }
    const projectData = projectDoc.data();

    const [volsSnap, chapsSnap] = await Promise.all([
      adminDb.collection('projects').doc(projectId).collection('volumes').orderBy('order', 'asc').get(),
      adminDb.collection('projects').doc(projectId).collection('chapters').orderBy('order', 'asc').get(),
    ]);

    const volumes = volsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const chapters = chapsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    const structuredVolumes = volumes.map((vol) => ({
      ...vol,
      chapters: chapters.filter((c: any) => c.volumeId === vol.id),
    }));

    return NextResponse.json({
      projectId,
      title: projectData?.title,
      volumes: structuredVolumes,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import {
  AuthError,
  requireVerifiedUser,
  requireProjectOwner,
  authErrorResponse,
} from '@/lib/server/auth';
import { adminDb, adminStorage } from '@/lib/firebase/admin';

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: Request,
  { params }: { params: { projectId: string } }
) {
  try {
    const { uid } = await requireVerifiedUser(req);
    const { projectId } = params;

    if (!projectId || typeof projectId !== 'string' || projectId.includes('/')) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Asserts project exists and requester is the owner. Throws 403 or 404 otherwise.
    await requireProjectOwner(uid, projectId);

    // 1. Delete associated Storage files (character dossiers, reference images)
    try {
      const bucket = adminStorage.bucket();
      if (!bucket || !bucket.name) {
        throw new Error('No storage bucket configured on Firebase Admin');
      }
      await bucket.deleteFiles({ prefix: `projects/${projectId}/` });
    } catch (storageErr: unknown) {
      console.error(`Storage cleanup for project ${projectId} failed:`, storageErr);
      return NextResponse.json(
        {
          error: 'Could not delete manuscript storage.',
          code: 'STORAGE_CLEANUP_FAILED',
        },
        { status: 500 }
      );
    }

    // 2. Clean up proven public published documents if any exist
    try {
      const matchingSlugs = await adminDb
        .collection('publicSlugs')
        .where('projectId', '==', projectId)
        .get();

      for (const slugDoc of matchingSlugs.docs) {
        const slug = slugDoc.id;
        const publicProjRef = adminDb.collection('publicProjects').doc(slug);
        await adminDb.recursiveDelete(publicProjRef);
        await slugDoc.ref.delete();
      }
    } catch (pubErr: unknown) {
      console.error(`Public snapshot cleanup for project ${projectId} failed:`, pubErr);
      return NextResponse.json(
        {
          error: 'Could not remove published manuscript data.',
          code: 'PUBLIC_CLEANUP_FAILED',
        },
        { status: 500 }
      );
    }

    // 3. Cascade recursive deletion of the private project document and all subcollections
    const projectRef = adminDb.collection('projects').doc(projectId);
    await adminDb.recursiveDelete(projectRef);

    return NextResponse.json({ success: true, message: 'Manuscript deleted successfully' });
  } catch (err) {
    if (err instanceof AuthError) {
      return authErrorResponse(err);
    }
    console.error('Unexpected error deleting project', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

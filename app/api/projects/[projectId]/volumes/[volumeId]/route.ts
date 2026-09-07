import { NextResponse } from 'next/server';
import {
  AuthError,
  requireVerifiedUser,
  requireProjectOwner,
  authErrorResponse,
} from '@/lib/server/auth';
import {
  CleanupError,
  deleteVolumeCascade,
  readPathId,
  requireVolume,
} from '@/lib/server/cascade-delete';

/**
 * DELETE a volume and every chapter inside it. (Stage 4F)
 *
 * Strictly more destructive than deleting a chapter, and the confirmation UI
 * says so. The server's job is to make it exact: only chapters whose
 * `volumeId` is this volume are removed, and no other part of the project —
 * other volumes, characters, project settings, the published book — is touched.
 */

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: Request,
  { params }: { params: { projectId: string; volumeId: string } }
) {
  try {
    const { uid } = await requireVerifiedUser(req);

    const projectId = readPathId(params.projectId);
    const volumeId = readPathId(params.volumeId);
    if (!projectId || !volumeId) {
      return NextResponse.json({ error: 'Volume not found' }, { status: 404 });
    }

    await requireProjectOwner(uid, projectId);
    const volume = await requireVolume(projectId, volumeId);

    const { deletedChapterIds } = await deleteVolumeCascade(projectId, volumeId);

    return NextResponse.json({
      success: true,
      volumeId,
      title: volume.title,
      deletedChapterIds,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      return authErrorResponse(err);
    }
    if (err instanceof CleanupError) {
      // Partial progress is possible here — some chapters may already be gone.
      // Reporting failure is still correct: the volume was not fully removed,
      // and a retry deletes exactly what remains.
      return NextResponse.json(
        { error: err.publicMessage, code: err.code },
        { status: 500 }
      );
    }
    console.error('Unexpected error deleting volume', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';
import {
  AuthError,
  requireVerifiedUser,
  requireProjectOwner,
  authErrorResponse,
} from '@/lib/server/auth';
import {
  CleanupError,
  ConfirmationError,
  deleteChapterCascade,
  readPathId,
  requireChapter,
  requireTitleConfirmation,
} from '@/lib/server/cascade-delete';

/**
 * DELETE a chapter and everything it owns. (Stage 4E)
 *
 * Authorization is server-side and absolute: a verified Firebase ID token, then
 * an ownership check against the stored `ownerId`. The client's own belief
 * about who owns the project is never part of the decision.
 *
 * The body must carry `{ confirmationTitle }` matching the chapter's stored
 * title. The dialog asks for it too, but this route is reachable without the
 * dialog, so the check that matters is this one — and it runs before any
 * cleanup begins.
 */

export const dynamic = 'force-dynamic';

export async function DELETE(
  req: Request,
  { params }: { params: { projectId: string; chapterId: string } }
) {
  try {
    const { uid } = await requireVerifiedUser(req);

    const projectId = readPathId(params.projectId);
    const chapterId = readPathId(params.chapterId);
    if (!projectId || !chapterId) {
      return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
    }

    // Throws 403 or 404 before any manuscript data is read.
    await requireProjectOwner(uid, projectId);
    const chapter = await requireChapter(projectId, chapterId);

    // Nothing is touched until the caller proves they meant this chapter.
    await requireTitleConfirmation(req, chapter.title);

    await deleteChapterCascade(projectId, chapterId);

    return NextResponse.json({ success: true, chapterId, title: chapter.title });
  } catch (err) {
    if (err instanceof AuthError) {
      return authErrorResponse(err);
    }
    if (err instanceof ConfirmationError) {
      // Refused before the cascade started; the chapter is untouched.
      return NextResponse.json({ error: err.publicMessage }, { status: err.status });
    }
    if (err instanceof CleanupError) {
      // Required cleanup failed, so the chapter is still there. Saying so
      // matters more than looking tidy: the author can retry, and retrying is
      // safe because every step is idempotent.
      return NextResponse.json(
        { error: err.publicMessage, code: err.code },
        { status: 500 }
      );
    }
    console.error('Unexpected error deleting chapter', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

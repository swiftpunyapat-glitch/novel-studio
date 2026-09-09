import { notFound, redirect } from 'next/navigation';
import { adminDb } from '@/lib/firebase/admin';
import { decodeSlugParam, isValidPublicSlug } from '@/lib/publishing/reading-order';
import { chapterPath } from '@/lib/publishing/chapter-slug';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { projectSlug: string; chapterId: string };
}

/**
 * The old chapter URL, kept alive.
 *
 * Chapters used to be addressed by their Firestore document id under a literal
 * `/vol/` segment. Those links are out in the world — bookmarked, shared,
 * possibly indexed — so this resolves the id and redirects permanently to the
 * slug URL rather than letting them 404.
 *
 * A literal path segment wins over a dynamic one in Next.js routing, so this
 * coexists with `/read/[projectSlug]/[volumeSlug]/[chapterSlug]` without
 * shadowing a volume that happens to be called "vol".
 */
export default async function LegacyChapterRedirect({ params }: PageProps) {
  const projectSlug = decodeSlugParam(params.projectSlug);
  const chapterId = decodeSlugParam(params.chapterId);

  if (!isValidPublicSlug(projectSlug) || chapterId.includes('/')) notFound();

  const snap = await adminDb
    .collection('publicProjects')
    .doc(projectSlug)
    .collection('chapters')
    .doc(chapterId)
    .get();

  if (!snap.exists) notFound();

  const data = snap.data() ?? {};
  const chapterSlug = typeof data.slug === 'string' && data.slug ? data.slug : chapterId;
  const volumeSlug =
    typeof data.volumeSlug === 'string' && data.volumeSlug ? data.volumeSlug : 'volume';

  redirect(chapterPath(projectSlug, volumeSlug, chapterSlug));
}

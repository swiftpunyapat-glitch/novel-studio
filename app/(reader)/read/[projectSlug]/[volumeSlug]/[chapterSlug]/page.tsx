import React from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { adminDb } from '@/lib/firebase/admin';
import { BookOpen, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  chaptersAfter,
  indexOfChapter,
  decodeSlugParam,
  isValidPublicSlug,
  sortChaptersForReading,
} from '@/lib/publishing/reading-order';
import { chapterPath } from '@/lib/publishing/chapter-slug';
import { ContinuousReader, type ReaderChapter } from '@/components/reader/ContinuousReader';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { projectSlug: string; volumeSlug: string; chapterSlug: string };
}

interface ChapterIndexEntry {
  id: string;
  slug: string;
  volumeSlug: string;
  order?: number;
  volumeId?: string;
}

/**
 * A chapter of a published book, and everything after it.
 *
 * The URL names the chapter by its own slug — `/read/redline-love/volume-1/
 * the-long-road` — rather than by the Firestore document id the reader used to
 * carry. What happens at the end of the chapter is unchanged from the reader's
 * point of view: the following chapters arrive as they scroll, on this page.
 *
 * This chapter is rendered on the server, so the page is readable and indexable
 * before `ContinuousReader` does anything.
 */
export default async function PublicChapterReaderPage({ params }: PageProps) {
  // Route params arrive percent-encoded for non-ASCII; a Thai slug would
  // otherwise never match the value stored on the snapshot.
  const projectSlug = decodeSlugParam(params.projectSlug);
  const volumeSlug = decodeSlugParam(params.volumeSlug);
  const chapterSlug = decodeSlugParam(params.chapterSlug);

  if (!isValidPublicSlug(projectSlug)) notFound();

  const bookRef = adminDb.collection('publicProjects').doc(projectSlug);

  const [projectDoc, volumesSnap, indexSnap] = await Promise.all([
    bookRef.get(),
    bookRef.collection('volumes').select('order').get(),
    // Only the addressing and ordering fields: the prose of every other
    // chapter stays on the server until the reader scrolls that far.
    bookRef.collection('chapters').select('order', 'volumeId', 'slug', 'volumeSlug').get(),
  ]);

  if (!projectDoc.exists || indexSnap.empty) notFound();

  const project = projectDoc.data();

  const ordered = sortChaptersForReading(
    indexSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        slug: typeof data.slug === 'string' ? data.slug : d.id,
        volumeSlug: typeof data.volumeSlug === 'string' ? data.volumeSlug : 'volume',
        order: data.order as number | undefined,
        volumeId: data.volumeId as string | undefined,
      } satisfies ChapterIndexEntry;
    }),
    volumesSnap.docs.map((d) => ({ id: d.id, order: d.data().order as number | undefined }))
  );

  /*
    Chapters published before slugs existed fall back to their document id, so
    an old link keeps resolving. A link that names the right chapter but the
    wrong volume is redirected rather than refused — the chapter is what the
    reader asked for, and the volume is derivable.
  */
  const match =
    ordered.find((c) => c.slug === chapterSlug && c.volumeSlug === volumeSlug) ??
    ordered.find((c) => c.slug === chapterSlug) ??
    ordered.find((c) => c.id === chapterSlug);

  if (!match) notFound();

  if (match.slug !== chapterSlug || match.volumeSlug !== volumeSlug) {
    redirect(chapterPath(projectSlug, match.volumeSlug, match.slug));
  }

  const chapDoc = await bookRef.collection('chapters').doc(match.id).get();
  if (!chapDoc.exists) notFound();
  const chapter = chapDoc.data() ?? {};

  const position = indexOfChapter(ordered, match.id);
  const previous = position > 0 ? ordered[position - 1] : null;
  const hasMore = chaptersAfter(ordered, match.id, 1).length > 0;

  // Presentation only: the symbol the reader stylesheet draws for a scene
  // break. Passing it here means changing it in the project settings takes
  // effect without republishing every chapter.
  const rawSymbol = project?.readingSettings?.sceneBreakSymbol;
  const sceneBreakSymbol =
    typeof rawSymbol === 'string' && rawSymbol.trim() ? rawSymbol.trim() : '***';

  const firstChapter: ReaderChapter = {
    id: match.id,
    slug: match.slug,
    volumeSlug: match.volumeSlug,
    chapterType: chapter.chapterType === 'prologue' || chapter.chapterType === 'epilogue'
      ? chapter.chapterType
      : 'chapter',
    chapterNumber: chapter.chapterNumber ?? null,
    title: chapter.title ?? '',
    subtitle: chapter.subtitle ?? null,
    dateText: chapter.dateText ?? null,
    locationText: chapter.locationText ?? null,
    renderedHtml: chapter.renderedHtml ?? '',
  };

  return (
    <div className="min-h-screen bg-paper-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col items-center">
      <header className="w-full h-12 border-b border-slate-200 dark:border-slate-800/80 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm sticky top-0 z-20 flex items-center justify-between px-4 max-w-4xl">
        <Link
          href={`/read/${projectSlug}`}
          className="text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1 transition-colors"
        >
          <BookOpen className="w-3.5 h-3.5" /> {project?.title}
        </Link>
        <span className="text-xs text-slate-400">{firstChapter.title}</span>
      </header>

      <main className="w-full max-w-2xl px-6 py-12 md:py-16 flex-1">
        {/*
          Reading backwards is still a navigation: a reader who opened chapter
          twelve gets a way to the chapter before it, and continuous reading
          takes over from there.
        */}
        {previous && (
          <div className="mb-10 flex justify-start">
            <Link
              href={chapterPath(projectSlug, previous.volumeSlug, previous.slug)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium transition-colors hover:border-indigo-500 dark:border-slate-800 dark:bg-slate-900"
            >
              <ChevronLeft className="h-4 w-4" /> Previous Chapter
            </Link>
          </div>
        )}

        <ContinuousReader
          projectSlug={projectSlug}
          firstChapter={firstChapter}
          hasMoreInitially={hasMore}
          sceneBreakSymbol={sceneBreakSymbol}
        />

        {/*
          Without JavaScript nothing is appended, so the ordinary link out of
          this chapter has to remain.
        */}
        {hasMore && (
          <noscript>
            <div className="pt-8 flex justify-end">
              <Link
                href={chapterPath(
                  projectSlug,
                  ordered[position + 1].volumeSlug,
                  ordered[position + 1].slug
                )}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium dark:border-slate-800 dark:bg-slate-900"
              >
                Next Chapter <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </noscript>
        )}
      </main>
    </div>
  );
}

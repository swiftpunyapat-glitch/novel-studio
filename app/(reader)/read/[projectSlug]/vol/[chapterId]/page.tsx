import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { adminDb } from '@/lib/firebase/admin';
import { BookOpen, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  chaptersAfter,
  indexOfChapter,
  isValidPublicSlug,
  sortChaptersForReading,
} from '@/lib/publishing/reading-order';
import { ContinuousReader, type ReaderChapter } from '@/components/reader/ContinuousReader';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { projectSlug: string; chapterId: string };
}

/**
 * A chapter of a published book, and everything after it.
 *
 * The URL still names one chapter, so every existing link and every link the
 * table of contents makes keeps working. What changed is what happens at the
 * end of it: instead of a "Next Chapter" button and a page load, the following
 * chapters arrive as the reader scrolls. Publishing is unaffected — the author
 * still releases one chapter at a time.
 *
 * This chapter is rendered on the server so the page is readable and indexable
 * immediately; the rest is appended by `ContinuousReader`.
 */
export default async function PublicChapterReaderPage({ params }: PageProps) {
  const { projectSlug, chapterId } = params;

  if (!isValidPublicSlug(projectSlug) || chapterId.includes('/')) {
    notFound();
  }

  const bookRef = adminDb.collection('publicProjects').doc(projectSlug);

  const [projectDoc, chapDoc, volumesSnap, indexSnap] = await Promise.all([
    bookRef.get(),
    bookRef.collection('chapters').doc(chapterId).get(),
    bookRef.collection('volumes').select('order').get(),
    // Only the ordering fields: the prose of every other chapter stays on the
    // server until the reader actually scrolls that far.
    bookRef.collection('chapters').select('order', 'volumeId').get(),
  ]);

  if (!projectDoc.exists || !chapDoc.exists) {
    notFound();
  }

  const project = projectDoc.data();
  const chapter = chapDoc.data() ?? {};

  const ordered = sortChaptersForReading(
    indexSnap.docs.map((d) => ({
      id: d.id,
      order: d.data().order as number | undefined,
      volumeId: d.data().volumeId as string | undefined,
    })),
    volumesSnap.docs.map((d) => ({ id: d.id, order: d.data().order as number | undefined }))
  );

  const position = indexOfChapter(ordered, chapterId);
  const previous = position > 0 ? ordered[position - 1] : null;
  const hasMore = chaptersAfter(ordered, chapterId, 1).length > 0;

  // Presentation only: the symbol the reader stylesheet draws for a scene
  // break, which the published markup deliberately leaves empty. Passing it
  // here means changing it in the project settings takes effect without
  // republishing every chapter.
  const rawSymbol = project?.readingSettings?.sceneBreakSymbol;
  const sceneBreakSymbol =
    typeof rawSymbol === 'string' && rawSymbol.trim() ? rawSymbol.trim() : '***';

  const firstChapter: ReaderChapter = {
    id: chapterId,
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
        <span className="text-xs text-slate-400">
          {firstChapter.chapterNumber
            ? `Chapter ${firstChapter.chapterNumber}`
            : firstChapter.title}
        </span>
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
              href={`/read/${projectSlug}/vol/${previous.id}`}
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
          this chapter has to remain. It is hidden when scripting is available,
          where it would sit oddly in the middle of a continuous book.
        */}
        {hasMore && (
          <noscript>
            <div className="pt-8 flex justify-end">
              <Link
                href={`/read/${projectSlug}/vol/${ordered[position + 1].id}`}
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

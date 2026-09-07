import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { adminDb } from '@/lib/firebase/admin';
import { ChevronLeft, ChevronRight, BookOpen } from 'lucide-react';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: { projectSlug: string; chapterId: string };
}

export default async function PublicChapterReaderPage({ params }: PageProps) {
  const { projectSlug, chapterId } = params;

  const [projectDoc, chapDoc, allChapsSnap] = await Promise.all([
    adminDb.collection('publicProjects').doc(projectSlug).get(),
    adminDb.collection('publicProjects').doc(projectSlug).collection('chapters').doc(chapterId).get(),
    adminDb.collection('publicProjects').doc(projectSlug).collection('chapters').orderBy('order', 'asc').get(),
  ]);

  if (!projectDoc.exists || !chapDoc.exists) {
    notFound();
  }

  const project = projectDoc.data();
  const chapter = chapDoc.data();
  const allChapters = allChapsSnap.docs.map((d) => d.data());

  // Presentation only: the symbol the reader stylesheet draws for a scene
  // break, which the published markup deliberately leaves empty.
  const rawSymbol = project?.readingSettings?.sceneBreakSymbol;
  const sceneBreakSymbol =
    typeof rawSymbol === 'string' && rawSymbol.trim() ? rawSymbol.trim() : '***';

  const currentIndex = allChapters.findIndex((c) => c.id === chapterId);
  const prevChapter = currentIndex > 0 ? allChapters[currentIndex - 1] : null;
  const nextChapter = currentIndex < allChapters.length - 1 ? allChapters[currentIndex + 1] : null;

  return (
    <div className="min-h-screen bg-paper-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col items-center">
      {/* Top Header */}
      <header className="w-full h-12 border-b border-slate-200 dark:border-slate-800/80 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm sticky top-0 z-20 flex items-center justify-between px-4 max-w-4xl">
        <Link
          href={`/read/${projectSlug}`}
          className="text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1 transition-colors"
        >
          <BookOpen className="w-3.5 h-3.5" /> {project?.title}
        </Link>
        <span className="text-xs text-slate-400">
          {chapter?.chapterNumber ? `Chapter ${chapter.chapterNumber}` : chapter?.title}
        </span>
      </header>

      {/* Chapter Prose Container */}
      <main className="w-full max-w-2xl px-6 py-12 md:py-16 space-y-8 flex-1">
        {/* Chapter Header */}
        <div className="text-center space-y-2 border-b border-slate-200/60 dark:border-slate-800/60 pb-8">
          {chapter?.chapterNumber !== null && chapter?.chapterNumber !== undefined && (
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
              CHAPTER {chapter.chapterNumber}
            </p>
          )}
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            {chapter?.title}
          </h1>
          {chapter?.subtitle && (
            <p className="text-base italic text-slate-500">{chapter.subtitle}</p>
          )}
          {(chapter?.dateText || chapter?.locationText) && (
            <p className="text-xs text-slate-400 pt-1">
              {[chapter?.dateText, chapter?.locationText].filter(Boolean).join(' — ')}
            </p>
          )}
        </div>

        {/*
          Rendered Prose.

          The metrics live in the stylesheet, not here. This element previously
          carried `text-[16pt] leading-[1.08]` — the manuscript's A5 print
          setting — which is why the published book read as densely on a phone
          as it does on paper. Reader typography is presentation and belongs in
          one place; see `.novel-reader-prose` in app/globals.css.

          The scene-break symbol is passed as a custom property rather than
          being part of the published HTML, so changing it in the project
          settings does not require republishing every chapter to take effect.
        */}
        <div
          className="novel-reader-prose"
          style={
            {
              '--reader-scene-break-symbol': JSON.stringify(sceneBreakSymbol),
            } as React.CSSProperties
          }
          dangerouslySetInnerHTML={{ __html: chapter?.renderedHtml || '' }}
        />

        {/* Prev / Next Navigation Bar */}
        <div className="pt-12 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
          {prevChapter ? (
            <Link
              href={`/read/${projectSlug}/vol/${prevChapter.id}`}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-medium hover:border-indigo-500 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" /> Previous Chapter
            </Link>
          ) : (
            <div />
          )}

          <Link
            href={`/read/${projectSlug}`}
            className="text-xs text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 font-medium"
          >
            Table of Contents
          </Link>

          {nextChapter ? (
            <Link
              href={`/read/${projectSlug}/vol/${nextChapter.id}`}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs font-medium hover:border-indigo-500 transition-colors"
            >
              Next Chapter <ChevronRight className="w-4 h-4" />
            </Link>
          ) : (
            <div />
          )}
        </div>
      </main>
    </div>
  );
}

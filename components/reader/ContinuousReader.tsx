'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Loader2, RotateCw } from 'lucide-react';

/**
 * Continuous reading. (Reader)
 *
 * Publishing stays per-chapter — the author releases one chapter at a time —
 * but a reader should not have to click "Next Chapter" and wait for a page
 * load between them. This keeps them on one URL and pulls in the following
 * chapters as they approach the end of what is loaded.
 *
 * Two things it deliberately does NOT do:
 *
 *   - load the whole book up front. A long novel is several megabytes of
 *     markup; batches of three keep the first paint fast and the tab light.
 *   - navigate. The address bar is rewritten with replaceState as each chapter
 *     scrolls past, so a refresh or a shared link resumes where the reader was,
 *     but no navigation ever happens and the back button still leaves the book
 *     in one step rather than walking back through every chapter.
 *
 * The server renders the first chapter, so the page is readable and indexable
 * before this component does anything. Without JavaScript the Previous/Next
 * links below remain the way through the book.
 */

export interface ReaderChapter {
  id: string;
  chapterNumber: number | null;
  title: string;
  subtitle?: string | null;
  dateText?: string | null;
  locationText?: string | null;
  renderedHtml: string;
}

interface ContinuousReaderProps {
  projectSlug: string;
  /** Rendered on the server; the starting point for everything that follows. */
  firstChapter: ReaderChapter;
  /** False when the starting chapter is the last published one. */
  hasMoreInitially: boolean;
  sceneBreakSymbol: string;
}

export const ContinuousReader: React.FC<ContinuousReaderProps> = ({
  projectSlug,
  firstChapter,
  hasMoreInitially,
  sceneBreakSymbol,
}) => {
  const [chapters, setChapters] = useState<ReaderChapter[]>([firstChapter]);
  const [hasMore, setHasMore] = useState(hasMoreInitially);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const addressChapterRef = useRef<string | undefined>(firstChapter.id);
  // Read inside the observer callback, which is created once.
  const stateRef = useRef({ chapters, hasMore, loading, error });
  stateRef.current = { chapters, hasMore, loading, error };

  const loadMore = useCallback(async () => {
    const { chapters: current, hasMore: more, loading: busy } = stateRef.current;
    if (busy || !more) return;

    setLoading(true);
    setError(null);
    try {
      const after = current[current.length - 1].id;
      const res = await fetch(
        `/api/read/${encodeURIComponent(projectSlug)}/chapters?after=${encodeURIComponent(after)}`
      );
      if (!res.ok) throw new Error('Could not load the next chapter.');

      const data: { chapters: ReaderChapter[]; hasMore: boolean } = await res.json();

      setChapters((prev) => {
        // Guard against a duplicate append if two loads ever overlap.
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...data.chapters.filter((c) => !seen.has(c.id))];
      });
      setHasMore(data.hasMore);
    } catch (err) {
      console.error('Continuous reading failed', err);
      setError('Could not load the next chapter.');
    } finally {
      setLoading(false);
    }
  }, [projectSlug]);

  /**
   * Keeps the address bar on the chapter being read.
   *
   * Shares the throttled handler above rather than adding an
   * IntersectionObserver, so there is one mechanism to reason about and it is
   * the one that keeps working in a hidden tab.
   *
   * replaceState, never push: the back button leaves the book in one step
   * rather than walking back through every chapter the reader scrolled past.
   */
  const syncAddressBar = useCallback(() => {
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>('[data-chapter-id]')
    );
    if (sections.length === 0) return;

    // The chapter occupying the middle of the screen is the one being read.
    const midpoint = window.innerHeight / 2;
    let currentId = sections[0].dataset.chapterId;
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= midpoint) {
        currentId = section.dataset.chapterId;
      }
    }

    if (!currentId || currentId === addressChapterRef.current) return;
    addressChapterRef.current = currentId;
    window.history.replaceState(null, '', `/read/${projectSlug}/vol/${currentId}`);
  }, [projectSlug]);

  // ---- Pull the next batch as the end approaches ---------------------------
  /**
   * Deliberately a distance check rather than an IntersectionObserver on the
   * sentinel. Two reasons, and the second is the one that matters:
   *
   *   - a 1px sentinel is a fragile thing to observe; it goes unreported in
   *     enough real conditions to be worth avoiding.
   *   - if the loaded text is SHORTER than the window there is nothing to
   *     scroll, so a scroll-driven trigger would never fire and the book would
   *     stop at chapter one. Measuring the distance to the end covers that case
   *     on the first pass, before the reader touches anything.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // A screen and a half of runway, so the next chapter is usually already
    // there by the time the reader arrives at it.
    const THRESHOLD_PX = 1200;
    const THROTTLE_MS = 150;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const check = () => {
      if (cancelled) return;
      syncAddressBar();

      const sentinel = sentinelRef.current;
      if (!sentinel) return;
      const { hasMore: more, loading: busy, error: failed } = stateRef.current;
      // A failed batch waits for the reader to retry rather than hammering.
      if (!more || busy || failed) return;

      const remaining = sentinel.getBoundingClientRect().top - window.innerHeight;
      if (remaining <= THRESHOLD_PX) void loadMore();
    };

    /**
     * Throttled on a timer rather than requestAnimationFrame.
     *
     * rAF does not run in a hidden or backgrounded tab, and a throttle built on
     * it stays latched shut once a frame is requested and never delivered —
     * which stops the book loading for good, even after the reader comes back.
     * A timer keeps running either way.
     */
    const onActivity = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        check();
      }, THROTTLE_MS);
    };

    // The first pass runs immediately: it is what fills a window that the
    // opening chapter did not.
    check();

    window.addEventListener('scroll', onActivity, { passive: true });
    window.addEventListener('resize', onActivity);
    // A tab returning to the foreground catches up on anything it missed.
    document.addEventListener('visibilitychange', onActivity);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      window.removeEventListener('scroll', onActivity);
      window.removeEventListener('resize', onActivity);
      document.removeEventListener('visibilitychange', onActivity);
    };
    // Re-runs after every append, so a batch that still does not fill the
    // window immediately pulls the next one.
  }, [loadMore, syncAddressBar, chapters, hasMore, loading, error]);


  const proseStyle = {
    '--reader-scene-break-symbol': JSON.stringify(sceneBreakSymbol),
  } as React.CSSProperties;

  return (
    <>
      {chapters.map((chapter, index) => (
        <section
          key={chapter.id}
          data-chapter-id={chapter.id}
          className={index > 0 ? 'pt-16' : undefined}
          aria-label={chapter.title || `Chapter ${chapter.chapterNumber ?? ''}`}
        >
          <div className="text-center space-y-2 border-b border-slate-200/60 dark:border-slate-800/60 pb-8">
            {chapter.chapterNumber !== null && chapter.chapterNumber !== undefined && (
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
                CHAPTER {chapter.chapterNumber}
              </p>
            )}
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
              {chapter.title}
            </h1>
            {chapter.subtitle && (
              <p className="text-base italic text-slate-500">{chapter.subtitle}</p>
            )}
            {(chapter.dateText || chapter.locationText) && (
              <p className="text-xs text-slate-400 pt-1">
                {[chapter.dateText, chapter.locationText].filter(Boolean).join(' — ')}
              </p>
            )}
          </div>

          {/*
            The published HTML comes from the allow-list renderer in
            lib/publishing/render.ts, which is why it can be injected here.
          */}
          <div
            className="novel-reader-prose mt-8"
            style={proseStyle}
            dangerouslySetInnerHTML={{ __html: chapter.renderedHtml }}
          />
        </section>
      ))}

      {/* Crossing this pulls the next batch. */}
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />

      <div className="pt-12 pb-4 text-center">
        {loading && (
          <p className="flex items-center justify-center gap-2 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading the next chapter…
          </p>
        )}

        {error && (
          <button
            type="button"
            onClick={() => void loadMore()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2.5 text-xs font-medium text-slate-700 transition-colors hover:border-indigo-500 dark:border-slate-700 dark:text-slate-200"
          >
            <RotateCw className="h-3.5 w-3.5" />
            {error} Try again
          </button>
        )}

        {!loading && !error && !hasMore && (
          <p className="text-xs uppercase tracking-widest text-slate-400">
            End of what has been published
          </p>
        )}
      </div>

      <div className="flex items-center justify-center gap-4 border-t border-slate-200 pt-8 dark:border-slate-800">
        <Link
          href={`/read/${projectSlug}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Table of Contents
        </Link>
      </div>
    </>
  );
};

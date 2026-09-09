'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getProject, getChapters, getVariant, getRevisions } from '@/lib/firebase/firestore';
import { useAuth } from '@/lib/firebase/auth';
import { Project, Chapter, DraftVariant, Revision } from '@/types/project';
import { Send, CheckCircle2, AlertTriangle, ExternalLink, Loader2, Sparkles, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/Button';

interface ChapterPublishItem {
  chapter: Chapter;
  activeVariant: DraftVariant | null;
  latestRevision: Revision | null;
}

export default function ProjectPublishPage() {
  const params = useParams();
  const projectId = params?.projectId as string;
  const { user } = useAuth();

  const [project, setProject] = useState<Project | null>(null);
  const [items, setItems] = useState<ChapterPublishItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [unpublishingId, setUnpublishingId] = useState<string | null>(null);
  const [publishResult, setPublishResult] = useState<{ chapterId: string; url: string } | null>(null);

  const loadData = useCallback(async () => {
    if (!projectId) return;
    try {
      const [proj, chaps] = await Promise.all([
        getProject(projectId),
        getChapters(projectId),
      ]);
      setProject(proj);

      const resolvedItems: ChapterPublishItem[] = [];
      for (const chap of chaps) {
        let activeVar: DraftVariant | null = null;
        let latestRev: Revision | null = null;

        if (chap.activeVariantId) {
          activeVar = await getVariant(projectId, chap.id, chap.activeVariantId);
          if (activeVar) {
            const revs = await getRevisions(projectId, chap.id, activeVar.id);
            latestRev = revs[0] || null;
          }
        }
        resolvedItems.push({ chapter: chap, activeVariant: activeVar, latestRevision: latestRev });
      }
      setItems(resolvedItems);
    } catch (err) {
      console.error('Error loading publish items', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handlePublish = async (item: ChapterPublishItem) => {
    if (!project || !item.activeVariant) return;

    // If no revision exists yet, prompt user or trigger checkpoint
    if (!item.latestRevision) {
      alert('Please create a Revision Checkpoint from the editor before publishing.');
      return;
    }

    if (!user) {
      alert('Please sign in again before publishing.');
      return;
    }

    setPublishingId(item.chapter.id);
    try {
      // The server verifies this token and resolves ownership from it.
      // Owner identity is never sent in the request body.
      const idToken = await user.getIdToken();

      const res = await fetch('/api/publishing/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          projectId,
          chapterId: item.chapter.id,
          variantId: item.activeVariant.id,
          revisionId: item.latestRevision.id,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setPublishResult({ chapterId: item.chapter.id, url: data.publicUrl });
        await loadData();
      } else {
        alert(data.error || 'Publishing failed');
      }
    } catch (err) {
      console.error('Publish error', err);
      alert('Failed to execute publication transaction.');
    } finally {
      setPublishingId(null);
    }
  };

  /**
   * Withdraws a chapter from the public reader.
   *
   * Only the public snapshot is removed — the chapter, its variants and its
   * revisions are untouched — so this is reversible by publishing again, and
   * the confirmation says so rather than implying the manuscript is at risk.
   */
  const handleUnpublish = async (item: ChapterPublishItem) => {
    if (!project || !user) return;

    const title = item.chapter.title || 'this chapter';
    const confirmed = window.confirm(
      `Take "${title}" off the public reader?

` +
        'Readers will no longer be able to open it. Your manuscript, drafts and ' +
        'revision history are not affected, and you can publish it again at any time.'
    );
    if (!confirmed) return;

    setUnpublishingId(item.chapter.id);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/publishing/unpublish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ projectId, chapterId: item.chapter.id }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setPublishResult(null);
        await loadData();
      } else {
        alert(data.error || 'Could not unpublish this chapter.');
      }
    } catch (err) {
      console.error('Unpublish error', err);
      alert('Could not unpublish this chapter.');
    } finally {
      setUnpublishingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!project) return null;

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto w-full space-y-8">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Send className="w-6 h-6 text-indigo-600" /> Publication Manager
          </h1>
          <p className="text-sm text-slate-500">
            Publish frozen snapshots of candidate revisions directly to the public reader
          </p>
        </div>

        <Link
          href={`/read/${project.slug}`}
          target="_blank"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-indigo-500 transition-colors"
        >
          View Public Book <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </div>

      {publishResult && (
        <div className="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded-xl flex items-center justify-between">
          <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 text-sm">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <span>Chapter published successfully as an immutable snapshot.</span>
          </div>
          <Link
            href={publishResult.url}
            target="_blank"
            className="text-xs font-bold text-emerald-700 dark:text-emerald-400 hover:underline flex items-center gap-1"
          >
            Open Reader <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* Chapters Publication Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Manuscript Chapters
          </h3>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {items.map(({ chapter, activeVariant, latestRevision }) => {
            const isPublished = !!chapter.publishedRevisionId;
            const isCandidate = activeVariant?.status === 'candidate';
            const isPublishing = publishingId === chapter.id;

            return (
              <div key={chapter.id} className="p-4 flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-sm text-slate-900 dark:text-white">
                      {chapter.title}
                    </h4>
                    {isPublished ? (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400">
                        Published
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-100 dark:bg-slate-800 text-slate-500">
                        Draft
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400">
                    Active: {activeVariant?.name || 'None'} ({activeVariant?.status}) • {activeVariant?.wordCount || 0} words
                    {latestRevision && ` • Latest Rev #${latestRevision.revisionNumber}`}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={isPublished ? 'secondary' : 'primary'}
                    disabled={isPublishing || !latestRevision || !user}
                    onClick={() => handlePublish({ chapter, activeVariant, latestRevision })}
                    className="text-xs"
                  >
                    {isPublishing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                    ) : (
                      <Send className="w-3.5 h-3.5 mr-1" />
                    )}
                    {isPublished ? 'Republish Snapshot' : 'Publish Snapshot'}
                  </Button>

                  {isPublished && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPublishing || unpublishingId === chapter.id || !user}
                      onClick={() => handleUnpublish({ chapter, activeVariant, latestRevision })}
                      className="text-xs text-slate-500 hover:text-red-600 dark:hover:text-red-400"
                      title="Take this chapter off the public reader"
                    >
                      {unpublishingId === chapter.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                      ) : (
                        <EyeOff className="w-3.5 h-3.5 mr-1" />
                      )}
                      Unpublish
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

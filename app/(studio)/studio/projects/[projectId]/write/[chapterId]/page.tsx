'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { getProject, getChapter, getVariant, getVariants, createRevisionCheckpoint } from '@/lib/firebase/firestore';
import { useAuth } from '@/lib/firebase/auth';
import { Project, Chapter, DraftVariant, Revision } from '@/types/project';
import { NovelEditor, type NovelEditorHandle } from '@/components/editor/NovelEditor';
import { performCheckpoint } from '@/lib/editor/checkpoint';
import { Loader2, GitBranch, BookmarkPlus } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export default function ChapterWritingPage() {
  const params = useParams();
  const projectId = params?.projectId as string;
  const chapterId = params?.chapterId as string;
  const { user } = useAuth();

  const [project, setProject] = useState<Project | null>(null);
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [variant, setVariant] = useState<DraftVariant | null>(null);
  const [variants, setVariants] = useState<DraftVariant[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkpointing, setCheckpointing] = useState(false);
  const editorRef = useRef<NovelEditorHandle | null>(null);

  const loadData = useCallback(async () => {
    if (!projectId || !chapterId) return;
    try {
      const [proj, chap] = await Promise.all([
        getProject(projectId),
        getChapter(projectId, chapterId),
      ]);
      setProject(proj);
      setChapter(chap);

      if (chap) {
        const [allVars, activeVar] = await Promise.all([
          getVariants(projectId, chapterId),
          getVariant(projectId, chapterId, chap.activeVariantId),
        ]);
        setVariants(allVars);
        setVariant(activeVar || allVars[0] || null);
      }
    } catch (err) {
      console.error('Error loading chapter editor data', err);
    } finally {
      setLoading(false);
    }
  }, [projectId, chapterId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /**
   * Stage 2G: a checkpoint must freeze exactly what the author sees.
   *
   * The previous version passed `variant.content` from React state, which only
   * refreshes after a successful autosave — so checkpointing inside the debounce
   * window, or after a failed save, silently froze older text and publishing
   * then served it.
   *
   * Now: flush pending state, refuse while a conflict is unresolved, and read
   * the snapshot directly from the live Tiptap instance.
   */
  const handleCreateCheckpoint = async () => {
    if (!project || !chapter || !variant || !user) return;

    const handle = editorRef.current;
    if (!handle) return;

    setCheckpointing(true);
    try {
      const result = await performCheckpoint(handle, (snapshot) =>
        createRevisionCheckpoint(
          projectId,
          chapter.id,
          variant.id,
          snapshot,
          user.uid,
          'Manual Checkpoint'
        )
      );

      if (result.status === 'created') {
        setVariant((prev) =>
          prev ? { ...prev, latestRevisionNumber: result.revision.revisionNumber } : prev
        );
        alert(`Revision checkpoint #${result.revision.revisionNumber} created.`);
      } else if (result.status === 'blocked' && result.reason === 'conflict') {
        alert(
          'This chapter changed on another device. Resolve the conflict before creating a checkpoint.'
        );
      } else if (result.status === 'blocked') {
        alert('The editor is not ready yet. Try again in a moment.');
      } else {
        console.error('Error creating checkpoint', result.error);
        alert('Could not create the checkpoint. Your text has not been changed.');
      }
    } finally {
      setCheckpointing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!project || !chapter || !variant) {
    return (
      <div className="flex-1 p-8 text-center">
        <p className="text-slate-500">Chapter draft not found or deleted.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Variant Sub-Header */}
      <div className="h-10 bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800 px-4 flex items-center justify-between text-xs z-10 shrink-0">
        <div className="flex items-center gap-2">
          <GitBranch className="w-3.5 h-3.5 text-slate-400" />
          <span className="font-semibold text-slate-700 dark:text-slate-300">
            {variant.name}
          </span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
            variant.status === 'candidate'
              ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800'
              : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
          }`}>
            {variant.status}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={handleCreateCheckpoint}
            disabled={checkpointing}
            className="text-xs h-7"
            title="Create immutable point-in-time snapshot"
          >
            <BookmarkPlus className="w-3.5 h-3.5 mr-1" />
            {checkpointing ? 'Saving...' : 'Checkpoint'}
          </Button>
        </div>
      </div>

      {/* Novel Editor */}
      <NovelEditor
        ref={editorRef}
        projectId={projectId}
        chapter={chapter}
        variant={variant}
        documentSettings={project.documentSettings}
        onVariantSaved={(up) => {
          setVariant((prev) => (prev ? { ...prev, ...up } : prev));
        }}
      />
    </div>
  );
}

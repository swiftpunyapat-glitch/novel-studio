'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import {
  getProject,
  getChapter,
  getVariant,
  getVariants,
  createRevisionCheckpoint,
  createDraftVariant,
  renameDraftVariant,
  setMainDraftVariant,
  duplicateDraftVariant,
} from '@/lib/firebase/firestore';
import { useAuth } from '@/lib/firebase/auth';
import { Project, Chapter, DraftVariant } from '@/types/project';
import { NovelEditor, type NovelEditorHandle } from '@/components/editor/NovelEditor';
import { VariantSelector } from '@/components/editor/VariantSelector';
import { performCheckpoint } from '@/lib/editor/checkpoint';
import { Loader2, BookmarkPlus } from 'lucide-react';
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
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [pendingTransition, setPendingTransition] = useState<
    | { type: 'switch'; targetVariant: DraftVariant }
    | { type: 'create'; name: string }
    | { type: 'duplicate'; name: string }
    | null
  >(null);
  const [transitioning, setTransitioning] = useState(false);
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

  // A transition away from the current variant is safe ONLY when the editor
  // status is 'saved'. Any other state ('dirty', 'saving', 'offline_pending',
  // 'conflict', 'error') must be protected by the unsaved confirmation dialog.
  const isSafeState = () => editorRef.current?.getStatus() === 'saved';

  const executeCreateVariant = async (name: string) => {
    if (!projectId || !chapter) return;
    const newVar = await createDraftVariant(projectId, chapter.id, name);
    setVariants((prev) => [...prev, newVar]);
    setVariant(newVar);
  };

  const executeDuplicateVariant = async (name: string) => {
    if (!projectId || !chapter || !variant) return;
    const liveSnapshot = editorRef.current?.getSnapshot() ?? undefined;
    const duplicate = await duplicateDraftVariant(
      projectId,
      chapter.id,
      variant,
      name,
      liveSnapshot
    );
    setVariants((prev) => [...prev, duplicate]);
    setVariant(duplicate);
  };

  const executeTransition = async (
    t:
      | { type: 'switch'; targetVariant: DraftVariant }
      | { type: 'create'; name: string }
      | { type: 'duplicate'; name: string }
  ) => {
    if (t.type === 'switch') {
      setVariant(t.targetVariant);
    } else if (t.type === 'create') {
      await executeCreateVariant(t.name);
    } else if (t.type === 'duplicate') {
      await executeDuplicateVariant(t.name);
    }
  };

  const handleSelectVariant = (targetVariantId: string) => {
    if (targetVariantId === variant?.id) return;
    const target = variants.find((v) => v.id === targetVariantId);
    if (!target) return;

    if (!isSafeState()) {
      setPendingTransition({ type: 'switch', targetVariant: target });
      setShowUnsavedModal(true);
    } else {
      setVariant(target);
    }
  };

  const handleCreateVariant = async (name: string) => {
    if (!isSafeState()) {
      setPendingTransition({ type: 'create', name });
      setShowUnsavedModal(true);
    } else {
      await executeCreateVariant(name);
    }
  };

  const handleDuplicateVariant = async (name: string) => {
    if (!isSafeState()) {
      setPendingTransition({ type: 'duplicate', name });
      setShowUnsavedModal(true);
    } else {
      await executeDuplicateVariant(name);
    }
  };

  const handleSaveAndContinue = async () => {
    if (!pendingTransition) return;
    setTransitioning(true);
    try {
      await editorRef.current?.saveNow();
      const finalStatus = editorRef.current?.getStatus();

      // Verified save success: switch/continue ONLY when final status is 'saved'.
      if (finalStatus !== 'saved') {
        setShowUnsavedModal(false);
        setPendingTransition(null);
        if (finalStatus === 'conflict') {
          alert(
            'This chapter changed on another device. Please resolve the conflict before continuing.'
          );
        } else if (finalStatus === 'offline_pending') {
          alert(
            'Offline — saved locally. Press Save when back online, or choose "Keep Local Copy & Continue".'
          );
        } else {
          alert('Save failed. You remain on the current variant so no changes are lost.');
        }
        return;
      }

      await executeTransition(pendingTransition);
      setShowUnsavedModal(false);
      setPendingTransition(null);
    } catch (err) {
      console.error('Failed to save before variant transition', err);
      alert('Save failed. You remain on the current variant so no changes are lost.');
      setShowUnsavedModal(false);
      setPendingTransition(null);
    } finally {
      setTransitioning(false);
    }
  };

  const handleKeepLocalAndContinue = async () => {
    if (!pendingTransition) return;
    setTransitioning(true);
    try {
      await editorRef.current?.flushLocal();
      await executeTransition(pendingTransition);
      setShowUnsavedModal(false);
      setPendingTransition(null);
    } catch (err) {
      console.error('Failed to flush local mirror before transition', err);
    } finally {
      setTransitioning(false);
    }
  };

  const handleCancelTransition = () => {
    setShowUnsavedModal(false);
    setPendingTransition(null);
  };

  const handleRenameVariant = async (variantId: string, newName: string) => {
    if (!projectId || !chapter) return;
    await renameDraftVariant(projectId, chapter.id, variantId, newName);
    setVariants((prev) =>
      prev.map((v) => (v.id === variantId ? { ...v, name: newName } : v))
    );
    if (variant?.id === variantId) {
      setVariant((prev) => (prev ? { ...prev, name: newName } : prev));
    }
  };

  const handleSetMain = async (variantId: string) => {
    if (!projectId || !chapter) return;
    await setMainDraftVariant(projectId, chapter.id, variantId);
    setChapter((prev) => (prev ? { ...prev, activeVariantId: variantId } : prev));
  };

  /**
   * Stage 2G: a checkpoint must freeze exactly what the author sees.
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
          <VariantSelector
            chapter={chapter}
            currentVariant={variant}
            variants={variants}
            onSelectVariant={handleSelectVariant}
            onCreateVariant={handleCreateVariant}
            onDuplicateVariant={handleDuplicateVariant}
            onRenameVariant={handleRenameVariant}
            onSetMain={handleSetMain}
          />
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

      {/* Novel Editor — key={variant.id} ensures clean remount on variant switch */}
      <NovelEditor
        key={variant.id}
        ref={editorRef}
        projectId={projectId}
        chapter={chapter}
        variant={variant}
        documentSettings={project.documentSettings}
        onVariantSaved={(up) => {
          setVariant((prev) => (prev ? { ...prev, ...up } : prev));
        }}
      />

      {/* Unsaved Transition Confirmation Modal */}
      {showUnsavedModal && pendingTransition && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Unsaved Changes in &ldquo;{variant.name}&rdquo;
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
              {pendingTransition.type === 'switch' && (
                <>
                  You have unsaved changes in the current draft variant. How would you like to proceed before switching to{' '}
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    &ldquo;{pendingTransition.targetVariant.name}&rdquo;
                  </span>?
                </>
              )}
              {pendingTransition.type === 'create' && (
                <>
                  You have unsaved changes in the current draft variant. How would you like to proceed before creating{' '}
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    &ldquo;{pendingTransition.name}&rdquo;
                  </span>?
                </>
              )}
              {pendingTransition.type === 'duplicate' && (
                <>
                  You have unsaved changes in the current draft variant. How would you like to proceed before duplicating into{' '}
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    &ldquo;{pendingTransition.name}&rdquo;
                  </span>?
                </>
              )}
            </p>

            <div className="flex flex-col sm:flex-row justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCancelTransition}
                disabled={transitioning}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleKeepLocalAndContinue}
                disabled={transitioning}
                title="Keeps unsynced edits in local browser storage"
              >
                Keep Local Copy &amp; Continue
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleSaveAndContinue}
                disabled={transitioning}
              >
                {transitioning ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : pendingTransition.type === 'switch' ? (
                  'Save & Switch'
                ) : (
                  'Save & Continue'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

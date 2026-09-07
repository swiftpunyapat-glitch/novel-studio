'use client';

import React, { useEffect, useState, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';

import { Chapter, DraftVariant, DocumentSettings, readContentVersion } from '@/types/project';
import {
  saveVariantContent,
  createVariantFromContent,
  type ManuscriptSnapshot,
} from '@/lib/firebase/firestore';
import { extractPlainTextFromTiptap, calculateWordCount } from '@/lib/editor/plain-text';
import {
  SaveCoordinator,
  type AutosaveStatus,
  type ConflictState,
} from '@/lib/editor/save-coordinator';
import {
  getMirror,
  decideRecovery,
  markMirrorClean,
  type MirrorSnapshot,
} from '@/lib/offline/manuscript-mirror';

import { SceneBreakExtension } from '@/lib/editor/extensions/SceneBreakExtension';
import { PageBreakExtension } from '@/lib/editor/extensions/PageBreakExtension';
import { FirstLineIndentExtension } from '@/lib/editor/extensions/FirstLineIndentExtension';
import { LineSpacingExtension } from '@/lib/editor/extensions/LineSpacingExtension';

import { FormattingToolbar } from './FormattingToolbar';
import { ChapterMetadataHeader } from './ChapterMetadataHeader';
import { ConflictDialog } from './ConflictDialog';
import { RecoveryDialog } from './RecoveryDialog';

/** Imperative surface the page uses so Checkpoint reads LIVE editor state. */
export interface NovelEditorHandle {
  /** Current editor content, read directly from Tiptap. */
  getSnapshot: () => ManuscriptSnapshot | null;
  /** Flushes local + remote state; resolves once the save settles. */
  flush: () => Promise<void>;
  getStatus: () => AutosaveStatus;
  hasBlockingConflict: () => boolean;
}

interface NovelEditorProps {
  projectId: string;
  chapter: Chapter;
  variant: DraftVariant;
  documentSettings: DocumentSettings;
  onVariantSaved?: (updatedVariant: Partial<DraftVariant>) => void;
}

function snapshotFrom(editor: Editor): ManuscriptSnapshot {
  const content = editor.getJSON() as ManuscriptSnapshot['content'];
  const plainText = extractPlainTextFromTiptap(
    content as Parameters<typeof extractPlainTextFromTiptap>[0]
  );
  const { wordCount, charCount } = calculateWordCount(plainText);
  return { content, plainText, wordCount, characterCount: charCount };
}

export const NovelEditor = forwardRef<NovelEditorHandle, NovelEditorProps>(function NovelEditor(
  { projectId, chapter, variant, documentSettings, onVariantSaved },
  ref
) {
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>('saved');
  const [wordCount, setWordCount] = useState<number>(variant.wordCount || 0);
  const [conflict, setConflict] = useState<ConflictState | null>(null);
  const [recovery, setRecovery] = useState<MirrorSnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  const sessionIdRef = useRef<string>(
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `session_${Date.now()}`
  );
  const coordinatorRef = useRef<SaveCoordinator | null>(null);
  const editorRef = useRef<Editor | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      Underline,
      TextAlign.configure({ types: ['paragraph'] }),
      SceneBreakExtension,
      PageBreakExtension,
      FirstLineIndentExtension,
      LineSpacingExtension,
    ],
    content: (variant.content?.content?.length
      ? variant.content
      : { type: 'doc', content: [{ type: 'paragraph' }] }) as never,
    editorProps: {
      attributes: {
        class: 'focus:outline-none min-h-[500px]',
        style: `font-family: '${documentSettings.bodyFont}', sans-serif; font-size: ${documentSettings.bodyFontSizePt}pt;`,
      },
    },
    onUpdate: ({ editor: ed }) => {
      const snapshot = snapshotFrom(ed);
      setWordCount(snapshot.wordCount);
      coordinatorRef.current?.handleChange(snapshot);
    },
    immediatelyRender: false,
  });

  editorRef.current = editor ?? null;

  // ---- Coordinator lifecycle -------------------------------------------------
  useEffect(() => {
    const coordinator = new SaveCoordinator({
      projectId,
      chapterId: chapter.id,
      variantId: variant.id,
      sessionId: sessionIdRef.current,
      baseVersion: readContentVersion(variant),
      save: (snapshot, baseVersion) =>
        saveVariantContent(
          projectId,
          chapter.id,
          variant.id,
          snapshot,
          baseVersion,
          sessionIdRef.current,
          { isActiveVariant: chapter.activeVariantId === variant.id }
        ),
      onStatusChange: setAutosaveStatus,
      onConflict: setConflict,
      onVersionChange: (version) => onVariantSaved?.({ contentVersion: version }),
    });

    coordinatorRef.current = coordinator;

    return () => {
      // Best-effort final flush, then guarantee no timer survives the unmount.
      void coordinator.flush().finally(() => coordinator.dispose());
      coordinatorRef.current = null;
    };
    // A different variant means a different coordinator.
  }, [projectId, chapter.id, chapter.activeVariantId, variant.id, variant, onVariantSaved]);

  // ---- Load-time recovery check (Stage 2D) -----------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const local = await getMirror(projectId, chapter.id, variant.id);
      if (cancelled) return;

      const decision = decideRecovery(
        local,
        readContentVersion(variant),
        variant.plainText ?? ''
      );

      if (decision.kind === 'offer-recovery') {
        setRecovery(decision.local);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, chapter.id, variant]);

  // ---- Ctrl+S ----------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void coordinatorRef.current?.saveNow();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ---- Flush on navigation / tab hide (Stage 2E) -----------------------------
  useEffect(() => {
    const flush = () => {
      void coordinatorRef.current?.flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };

    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // ---- beforeunload, only when genuinely unsafe (Stage 2F) -------------------
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (coordinatorRef.current?.hasUnsafeUnsavedState()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // ---- Imperative handle for Checkpoint (Stage 2G) ---------------------------
  useImperativeHandle(
    ref,
    () => ({
      getSnapshot: () => (editorRef.current ? snapshotFrom(editorRef.current) : null),
      flush: async () => {
        await coordinatorRef.current?.flush();
      },
      getStatus: () => coordinatorRef.current?.getStatus() ?? 'saved',
      hasBlockingConflict: () => coordinatorRef.current?.getConflict() != null,
    }),
    []
  );

  // ---- Conflict resolution ---------------------------------------------------
  const handleReloadRemote = useCallback(() => {
    const remote = coordinatorRef.current?.acceptRemote();
    if (remote && editorRef.current) {
      editorRef.current.commands.setContent(remote.content as never, false);
      setWordCount(remote.wordCount);
    }
    setConflict(null);
  }, []);

  const handleKeepLocalAsVariant = useCallback(async () => {
    const current = coordinatorRef.current?.getConflict();
    if (!current) return;

    setBusy(true);
    try {
      const rescued = await createVariantFromContent(
        projectId,
        chapter.id,
        current.local,
        `Recovered ${new Date().toLocaleString()}`
      );
      coordinatorRef.current?.resolveAfterRescue();
      await markMirrorClean(projectId, chapter.id, variant.id, current.remoteVersion);
      setConflict(null);
      onVariantSaved?.({ contentVersion: current.remoteVersion });
      window.alert(
        `Your unsaved text was preserved as a new draft variant: "${rescued.name}".`
      );
    } catch (err) {
      console.error('Could not preserve local content as a new variant', err);
      window.alert('Could not create the new draft variant. Your text is still here.');
    } finally {
      setBusy(false);
    }
  }, [projectId, chapter.id, variant.id, onVariantSaved]);

  const handleReviewLater = useCallback(() => {
    coordinatorRef.current?.deferConflict();
    setConflict(null);
  }, []);

  // ---- Recovery resolution ---------------------------------------------------
  const handleRestoreLocal = useCallback(() => {
    if (!recovery || !editorRef.current) return;
    editorRef.current.commands.setContent(recovery.content as never, false);
    const snapshot = snapshotFrom(editorRef.current);
    setWordCount(snapshot.wordCount);
    coordinatorRef.current?.adoptRecovered(snapshot, readContentVersion(variant));
    setRecovery(null);
  }, [recovery, variant]);

  const handleUseRemote = useCallback(async () => {
    await markMirrorClean(projectId, chapter.id, variant.id, readContentVersion(variant));
    setRecovery(null);
  }, [projectId, chapter.id, variant]);

  const handlePreserveRecoveryAsVariant = useCallback(async () => {
    if (!recovery) return;
    setBusy(true);
    try {
      const rescued = await createVariantFromContent(
        projectId,
        chapter.id,
        {
          content: recovery.content as ManuscriptSnapshot['content'],
          plainText: recovery.plainText,
          wordCount: recovery.wordCount,
          characterCount: recovery.characterCount,
        },
        `Recovered ${new Date(recovery.savedAt).toLocaleString()}`
      );
      await markMirrorClean(projectId, chapter.id, variant.id, readContentVersion(variant));
      setRecovery(null);
      window.alert(`Local text preserved as a new draft variant: "${rescued.name}".`);
    } catch (err) {
      console.error('Could not preserve recovered content', err);
      window.alert('Could not create the new draft variant. Your local copy is unchanged.');
    } finally {
      setBusy(false);
    }
  }, [recovery, projectId, chapter.id, variant]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <FormattingToolbar editor={editor} autosaveStatus={autosaveStatus} wordCount={wordCount} />

      <div className="flex-1 overflow-y-auto novel-canvas-wrapper">
        <div className="novel-canvas-a5">
          <ChapterMetadataHeader chapter={chapter} projectId={projectId} />
          <EditorContent editor={editor} />
        </div>
      </div>

      {recovery && (
        <RecoveryDialog
          local={recovery}
          remotePlainText={variant.plainText ?? ''}
          remoteWordCount={variant.wordCount ?? 0}
          remoteVersion={readContentVersion(variant)}
          busy={busy}
          onRestoreLocal={handleRestoreLocal}
          onUseRemote={handleUseRemote}
          onPreserveAsVariant={handlePreserveRecoveryAsVariant}
        />
      )}

      {conflict && (
        <ConflictDialog
          conflict={conflict}
          busy={busy}
          onReloadRemote={handleReloadRemote}
          onKeepLocalAsVariant={handleKeepLocalAsVariant}
          onReviewLater={handleReviewLater}
        />
      )}
    </div>
  );
});

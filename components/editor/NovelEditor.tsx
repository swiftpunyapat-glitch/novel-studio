'use client';

import React, { useEffect, useState, useRef, useCallback, useImperativeHandle, forwardRef } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';
import FontFamily from '@tiptap/extension-font-family';

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
import { ManuscriptParagraph } from '@/lib/editor/extensions/ManuscriptParagraph';
import { ParagraphFormatExtension } from '@/lib/editor/extensions/ParagraphFormatExtension';
import { FontSizeExtension } from '@/lib/editor/extensions/FontSizeExtension';
import { STARTER_KIT_OPTIONS } from '@/lib/editor/manuscript-schema';
import { documentSettingsToCssVars } from '@/lib/format/effective';
import { normalizeManuscriptDoc } from '@/lib/format/normalize';
import type { ParagraphOverrides } from '@/lib/format/effective';

import { FormattingToolbar } from './FormattingToolbar';
import { ChapterMetadataHeader } from './ChapterMetadataHeader';
import { ConflictDialog } from './ConflictDialog';
import { RecoveryDialog } from './RecoveryDialog';
import { ParagraphSettingsDialog } from './ParagraphSettingsDialog';

/** Imperative surface the page uses so Checkpoint reads LIVE editor state. */
export interface NovelEditorHandle {
  /** Current editor content, read directly from Tiptap. */
  getSnapshot: () => ManuscriptSnapshot | null;
  /** Flushes local + remote state; resolves once the save settles. */
  flush: () => Promise<void>;
  /** Explicit remote save. */
  saveNow: () => Promise<void>;
  /** Flushes the local IndexedDB mirror without a remote save. */
  flushLocal: () => Promise<void>;
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
  const [paragraphDialogOpen, setParagraphDialogOpen] = useState(false);

  const sessionIdRef = useRef<string>(
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `session_${Date.now()}`
  );
  const coordinatorRef = useRef<SaveCoordinator | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const onVariantSavedRef = useRef(onVariantSaved);
  onVariantSavedRef.current = onVariantSaved;
  const isActiveVariantRef = useRef(chapter.activeVariantId === variant.id);
  isActiveVariantRef.current = chapter.activeVariantId === variant.id;

  const editor = useEditor({
    extensions: [
      // Block types the DOCX mapper cannot export are disabled outright rather
      // than left in the schema to be silently dropped. (Audit H2, Stage 3F)
      StarterKit.configure(STARTER_KIT_OPTIONS),
      ManuscriptParagraph,
      Underline,
      TextStyle,
      FontFamily.configure({ types: ['textStyle'] }),
      FontSizeExtension,
      SceneBreakExtension,
      PageBreakExtension,
      ParagraphFormatExtension,
    ],
    // Legacy baked defaults are converted to the tri-state override model
    // exactly once, at load. (Stage 3B)
    content: normalizeManuscriptDoc(
      variant.content?.content?.length
        ? variant.content
        : { type: 'doc', content: [{ type: 'paragraph' }] }
    ).doc as never,
    editorProps: {
      attributes: {
        class: 'focus:outline-none min-h-[500px]',
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
  // Coordinator lifetime strictly tracks projectId + chapterId + variant.id.
  // It must NOT recreate when contentVersion advances or parent callbacks re-render.
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
          { isActiveVariant: isActiveVariantRef.current }
        ),
      onStatusChange: setAutosaveStatus,
      onConflict: setConflict,
      onVersionChange: (version) => onVariantSavedRef.current?.({ contentVersion: version }),
    });

    coordinatorRef.current = coordinator;

    return () => {
      // Flush local IndexedDB mirror only; never silently remote-save on unmount.
      void coordinator.flushLocal().finally(() => coordinator.dispose());
      coordinatorRef.current = null;
    };
    // Recreated ONLY when the selected variant changes.
  }, [projectId, chapter.id, variant.id]);

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
  }, [projectId, chapter.id, variant.id]);

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

  // ---- Flush local mirror on navigation / tab hide (no silent remote save) ----
  useEffect(() => {
    const flushLocal = () => {
      void coordinatorRef.current?.flushLocal();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushLocal();
    };

    window.addEventListener('pagehide', flushLocal);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flushLocal);
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

  // ---- Imperative handle for Checkpoint & Page interactions ------------------
  useImperativeHandle(
    ref,
    () => ({
      getSnapshot: () => (editorRef.current ? snapshotFrom(editorRef.current) : null),
      flush: async () => {
        await coordinatorRef.current?.flush();
      },
      saveNow: async () => {
        await coordinatorRef.current?.saveNow();
      },
      flushLocal: async () => {
        await coordinatorRef.current?.flushLocal();
      },
      getStatus: () => coordinatorRef.current?.getStatus() ?? 'saved',
      hasBlockingConflict: () => coordinatorRef.current?.getConflict() != null,
    }),
    []
  );

  const handleManualSave = useCallback(async () => {
    await coordinatorRef.current?.saveNow();
  }, []);

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
      <FormattingToolbar
        editor={editor}
        autosaveStatus={autosaveStatus}
        wordCount={wordCount}
        settings={documentSettings}
        onOpenParagraphSettings={() => setParagraphDialogOpen(true)}
        onSave={handleManualSave}
      />

      <div className="flex-1 overflow-y-auto novel-canvas-wrapper">
        {/*
          Project defaults are published as CSS variables here, so a paragraph
          that inherits reflects a settings change immediately, while a
          paragraph with explicit overrides keeps its own inline values.
          (Stage 3C)
        */}
        <div
          className="novel-canvas-a5"
          style={documentSettingsToCssVars(documentSettings) as React.CSSProperties}
        >
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

      {paragraphDialogOpen && editor && (
        <ParagraphSettingsDialog
          attrs={editor.getAttributes('paragraph')}
          settings={documentSettings}
          onApply={(overrides: Partial<ParagraphOverrides>) => {
            editor.chain().focus().setParagraphFormat(overrides).run();
          }}
          onResetToDefault={() => {
            editor.chain().focus().resetParagraphFormat().run();
          }}
          onClose={() => setParagraphDialogOpen(false)}
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

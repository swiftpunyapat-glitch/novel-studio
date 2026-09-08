'use client';

import React, {
  useEffect,
  useState,
  useRef,
  useMemo,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextStyle from '@tiptap/extension-text-style';

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
import { SceneHeaderExtension } from '@/lib/editor/extensions/SceneHeaderExtension';
import { PageBreakExtension } from '@/lib/editor/extensions/PageBreakExtension';
import { ManuscriptParagraph } from '@/lib/editor/extensions/ManuscriptParagraph';
import { ManuscriptFontFamily } from '@/lib/editor/extensions/ManuscriptFontFamily';
import { ManuscriptSelectAll } from '@/lib/editor/extensions/ManuscriptSelectAll';
import { ParagraphFormatExtension } from '@/lib/editor/extensions/ParagraphFormatExtension';
import { FontSizeExtension } from '@/lib/editor/extensions/FontSizeExtension';
import {
  PageViewExtension,
  setPageViewConfig,
} from '@/lib/editor/extensions/PageViewExtension';
import { STARTER_KIT_OPTIONS } from '@/lib/editor/manuscript-schema';
import {
  documentSettingsToCssVars,
  pageContentHeightPx,
  PX_PER_MM,
} from '@/lib/format/effective';
import { PAGE_VIEW_GAP_PX } from '@/lib/editor/pagination';
import { normalizeManuscriptDoc } from '@/lib/format/normalize';
import type { ParagraphOverrides } from '@/lib/format/effective';
import type { SceneHeaderAttrs } from '@/lib/editor/scene-header';
import type { MarkdownImportResult } from '@/lib/editor/markdown-import';
import {
  decideSelectAll,
  isNativeTextField,
  isSelectAllChord,
} from '@/lib/editor/select-all';
import {
  loadDisplaySpacing,
  loadViewMode,
  resolveDisplayLineSpacing,
  saveDisplaySpacing,
  saveViewMode,
  usesDisplaySpacing,
  type DisplaySpacingMode,
  type EditorViewMode,
} from '@/lib/editor/display-preferences';

import { FormattingToolbar } from './FormattingToolbar';
import { ChapterMetadataHeader } from './ChapterMetadataHeader';
import { ConflictDialog } from './ConflictDialog';
import { RecoveryDialog } from './RecoveryDialog';
import { ParagraphSettingsDialog } from './ParagraphSettingsDialog';
import { SceneBreakDialog } from './SceneBreakDialog';
import { ImportMarkdownDialog, type ImportMode } from './ImportMarkdownDialog';

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
  const [sceneDialog, setSceneDialog] = useState<{
    mode: 'insert' | 'edit';
    initial: Partial<SceneHeaderAttrs> | null;
  } | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // Presentation state. Deliberately NOT part of the manuscript or of the
  // project's documentSettings — see lib/editor/display-preferences.ts.
  const [viewMode, setViewMode] = useState<EditorViewMode>('scroll');
  const [displaySpacing, setDisplaySpacing] = useState<DisplaySpacingMode>('comfortable');

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
      ManuscriptFontFamily.configure({ types: ['textStyle'] }),
      FontSizeExtension,
      SceneBreakExtension,
      SceneHeaderExtension,
      PageBreakExtension,
      ParagraphFormatExtension,
      // Ctrl/Cmd+A stays inside the manuscript. (Stage 4B)
      ManuscriptSelectAll,
      // Presentation-only pagination; dormant until Page View is on. (Stage 4G)
      PageViewExtension,
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

  // ---- Display preferences (presentation only, per browser) ------------------
  // Read after mount so server and client render the same first paint.
  useEffect(() => {
    setViewMode(loadViewMode());
    setDisplaySpacing(loadDisplaySpacing());
  }, []);

  const handleViewModeChange = useCallback((mode: EditorViewMode) => {
    setViewMode(mode);
    saveViewMode(mode);
  }, []);

  const handleDisplaySpacingChange = useCallback((mode: DisplaySpacingMode) => {
    setDisplaySpacing(mode);
    saveDisplaySpacing(mode);
  }, []);

  /**
   * Page geometry for the paginator, in the editor's own content coordinates.
   *
   * A page's usable height is the A5 sheet minus its margins. The "gap" between
   * two pages is therefore the bottom margin of the page that ended, the
   * visible space between the sheets, and the top margin of the page that
   * starts — which is exactly the distance from the last line of one page to
   * the first line of the next.
   */
  const pageMetrics = useMemo(
    () => ({
      pageHeightPx: pageContentHeightPx(documentSettings),
      pageGapPx:
        (documentSettings.margins.bottomMm + documentSettings.margins.topMm) * PX_PER_MM +
        PAGE_VIEW_GAP_PX,
    }),
    [documentSettings]
  );

  useEffect(() => {
    setPageViewConfig(editor?.view, {
      enabled: viewMode === 'page',
      pageHeightPx: pageMetrics.pageHeightPx,
      pageGapPx: pageMetrics.pageGapPx,
    });
  }, [editor, viewMode, pageMetrics]);

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

  // ---- Scene break / scene header (Stage 4C) ---------------------------------
  const handleOpenSceneBreak = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;

    // Pressing Scene while a scene header is selected edits that header rather
    // than stacking a second break on top of it.
    if (ed.isActive('sceneHeader')) {
      setSceneDialog({
        mode: 'edit',
        initial: ed.getAttributes('sceneHeader') as Partial<SceneHeaderAttrs>,
      });
      return;
    }
    setSceneDialog({ mode: 'insert', initial: null });
  }, []);

  const handleSceneDialogSubmit = useCallback(
    (header: Partial<SceneHeaderAttrs> | null) => {
      const ed = editorRef.current;
      const dialog = sceneDialog;
      setSceneDialog(null);
      if (!ed || !dialog) return;

      if (dialog.mode === 'edit') {
        if (header) {
          ed.chain().focus().updateSceneHeader(header).run();
        } else {
          // Clearing both fields removes the header; the scene break stays.
          ed.chain().focus().deleteNode('sceneHeader').run();
        }
        return;
      }

      ed.chain().focus().insertSceneBreakWithHeader(header).run();
    },
    [sceneDialog]
  );

  /**
   * Applies an imported Markdown file to the chapter. (Stage 6A)
   *
   * An ordinary edit, on purpose: `setContent` and `insertContentAt` both emit
   * an update, so the SaveCoordinator marks the chapter dirty and the author
   * presses Save as they would after typing. Undo works too. Writing straight
   * to Firestore here would make an import the one irreversible action in an
   * application built entirely on manual save.
   */
  const handleImportMarkdown = useCallback(
    (result: MarkdownImportResult, mode: ImportMode) => {
      const ed = editorRef.current;
      setImportOpen(false);
      if (!ed) return;

      if (mode === 'replace') {
        ed.commands.setContent(result.content as never, true);
      } else {
        ed.chain()
          .focus()
          .insertContentAt(ed.state.doc.content.size, result.content.content as never)
          .run();
      }
    },
    []
  );

  /**
   * Ctrl/Cmd+A inside the writing pane, but outside the editor itself.
   *
   * Scoped to this region rather than to `document`, so the sidebar, dialogs
   * and every other part of the application keep native behaviour. A genuine
   * text field inside the region — the chapter title, a metadata input — also
   * keeps native behaviour; only "focus is on the paper, not in a field" is
   * redirected to the manuscript.
   */
  const handleRegionKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const ed = editorRef.current;
    if (!ed) return;

    const target = event.target as HTMLElement | null;
    const decision = decideSelectAll({
      chord: isSelectAllChord(event),
      targetIsNativeTextField: isNativeTextField(target),
      targetIsInsideManuscript: !!target && ed.view.dom.contains(target),
    });

    if (decision !== 'select-manuscript') return;

    event.preventDefault();
    ed.chain().focus().selectAll().run();
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

  const canvasVars = {
    ...documentSettingsToCssVars(documentSettings),
    // Presentation-only line height. Applied by a CSS rule that is active only
    // while `novel-display-spacing` is on the wrapper, which never happens in
    // Page View. The manuscript's own value is untouched either way.
    '--novel-display-line-spacing': String(
      resolveDisplayLineSpacing(
        displaySpacing,
        viewMode,
        documentSettings.lineSpacingMultiplier
      )
    ),
    '--novel-page-gap': `${PAGE_VIEW_GAP_PX}px`,
  } as React.CSSProperties;

  const wrapperClasses = [
    'flex-1 overflow-y-auto novel-canvas-wrapper focus:outline-none',
    viewMode === 'page' ? 'novel-view-page' : 'novel-view-scroll',
    usesDisplaySpacing(displaySpacing, viewMode) ? 'novel-display-spacing' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <FormattingToolbar
        editor={editor}
        autosaveStatus={autosaveStatus}
        wordCount={wordCount}
        settings={documentSettings}
        onOpenParagraphSettings={() => setParagraphDialogOpen(true)}
        onOpenSceneBreak={handleOpenSceneBreak}
        onOpenImportMarkdown={() => setImportOpen(true)}
        onSave={handleManualSave}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        displaySpacing={displaySpacing}
        onDisplaySpacingChange={handleDisplaySpacingChange}
      />

      {/*
        tabIndex makes the paper itself focusable, which is what lets a click on
        the margin route Ctrl+A to the manuscript instead of the whole page.
        The handler is scoped here rather than on `document`. (Stage 4B)
      */}
      <div className={wrapperClasses} tabIndex={-1} onKeyDown={handleRegionKeyDown}>
        {/*
          Project defaults are published as CSS variables here, so a paragraph
          that inherits reflects a settings change immediately, while a
          paragraph with explicit overrides keeps its own inline values.
          (Stage 3C)

          In Page View the same element becomes the sheet stack: its background
          paints the A5 pages, and the spacers the paginator injects keep every
          page exactly one sheet tall. (Stage 4G)
        */}
        <div className="novel-canvas-a5 novel-page-flow" style={canvasVars}>
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

      {importOpen && (
        <ImportMarkdownDialog
          chapterHasContent={(editorRef.current?.getText().trim().length ?? 0) > 0}
          onImport={handleImportMarkdown}
          onClose={() => setImportOpen(false)}
        />
      )}

      {sceneDialog && (
        <SceneBreakDialog
          mode={sceneDialog.mode}
          initial={sceneDialog.initial}
          sceneBreakSymbol={documentSettings.sceneBreakSymbol}
          onSubmit={handleSceneDialogSubmit}
          onClose={() => setSceneDialog(null)}
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

'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';

import { Chapter, DraftVariant, DocumentSettings } from '@/types/project';
import { AutosaveStatus } from '@/types/editor';
import { saveVariantContent } from '@/lib/firebase/firestore';
import { extractPlainTextFromTiptap, calculateWordCount } from '@/lib/editor/plain-text';

import { SceneBreakExtension } from '@/lib/editor/extensions/SceneBreakExtension';
import { PageBreakExtension } from '@/lib/editor/extensions/PageBreakExtension';
import { FirstLineIndentExtension } from '@/lib/editor/extensions/FirstLineIndentExtension';
import { LineSpacingExtension } from '@/lib/editor/extensions/LineSpacingExtension';

import { FormattingToolbar } from './FormattingToolbar';
import { ChapterMetadataHeader } from './ChapterMetadataHeader';

interface NovelEditorProps {
  projectId: string;
  chapter: Chapter;
  variant: DraftVariant;
  documentSettings: DocumentSettings;
  onVariantSaved?: (updatedVariant: Partial<DraftVariant>) => void;
}

export const NovelEditor: React.FC<NovelEditorProps> = ({
  projectId,
  chapter,
  variant,
  documentSettings,
  onVariantSaved,
}) => {
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>('saved');
  const [wordCount, setWordCount] = useState<number>(variant.wordCount || 0);

  const sessionIdRef = useRef<string>(
    typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `session_${Date.now()}`
  );
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const executeSave = useCallback(
    async (editorInstance: ReturnType<typeof useEditor>) => {
      if (!editorInstance) return;

      const jsonContent = editorInstance.getJSON();
      const plainText = extractPlainTextFromTiptap(jsonContent);
      const { wordCount: wc, charCount: cc } = calculateWordCount(plainText);

      setWordCount(wc);
      setAutosaveStatus('saving');

      try {
        await saveVariantContent(
          projectId,
          chapter.id,
          variant.id,
          jsonContent as DraftVariant['content'],
          plainText,
          wc,
          cc,
          sessionIdRef.current
        );
        setAutosaveStatus('saved');
        onVariantSaved?.({
          content: jsonContent as DraftVariant['content'],
          plainText,
          wordCount: wc,
          characterCount: cc,
          lastSavedAt: Date.now(),
        });
      } catch (err) {
        console.error('Autosave error', err);
        setAutosaveStatus(navigator.onLine ? 'error' : 'offline_pending');
      }
    },
    [projectId, chapter.id, variant.id, onVariantSaved]
  );

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
      }),
      Underline,
      TextAlign.configure({
        types: ['paragraph'],
      }),
      SceneBreakExtension,
      PageBreakExtension,
      FirstLineIndentExtension,
      LineSpacingExtension,
    ],
    content: (variant.content?.content?.length ? variant.content : { type: 'doc', content: [{ type: 'paragraph' }] }) as any,
    editorProps: {
      attributes: {
        class: 'focus:outline-none min-h-[500px]',
        style: `font-family: '${documentSettings.bodyFont}', sans-serif; font-size: ${documentSettings.bodyFontSizePt}pt;`,
      },
    },
    onUpdate: ({ editor: ed }) => {
      setAutosaveStatus('saving');
      const plain = extractPlainTextFromTiptap(ed.getJSON());
      const { wordCount: wc } = calculateWordCount(plain);
      setWordCount(wc);

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        executeSave(ed);
      }, 1500);
    },
  });

  // Manual save with Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        if (editor) executeSave(editor);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editor, executeSave]);

  // Tab closing protection when unsaved
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (autosaveStatus === 'saving') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [autosaveStatus]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <FormattingToolbar
        editor={editor}
        autosaveStatus={autosaveStatus}
        wordCount={wordCount}
      />

      {/* Centered A5 Visual Document Canvas */}
      <div className="flex-1 overflow-y-auto novel-canvas-wrapper">
        <div className="novel-canvas-a5">
          <ChapterMetadataHeader chapter={chapter} projectId={projectId} />
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
};

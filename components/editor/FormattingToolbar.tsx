'use client';

import React from 'react';
import { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  IndentIncrease,
  IndentDecrease,
  Undo,
  Redo,
  Sparkles,
  Scissors,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  Search,
  PencilLine,
  GitMerge,
  SlidersHorizontal,
} from 'lucide-react';
import type { AutosaveStatus } from '@/types/editor';
import type { DocumentSettings } from '@/types/project';
import { MANUSCRIPT_FONTS } from '@/lib/editor/fonts';
import { FONT_SIZE_OPTIONS } from '@/lib/editor/extensions/FontSizeExtension';
import { INDENT_STEP_CM } from '@/lib/editor/extensions/ParagraphFormatExtension';
import type { Alignment } from '@/lib/format/effective';

interface FormattingToolbarProps {
  editor: Editor | null;
  autosaveStatus: AutosaveStatus;
  wordCount: number;
  settings: DocumentSettings;
  onOpenParagraphSettings: () => void;
  onOpenFindReplace?: () => void;
}

const btn =
  'p-1.5 rounded transition-colors text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800';
const btnActive =
  'p-1.5 rounded transition-colors bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400';
const selectCls =
  'h-7 px-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded text-slate-700 dark:text-slate-200';
const divider = 'w-[1px] h-5 bg-slate-200 dark:bg-slate-700 mx-1 shrink-0';

const ALIGN_BUTTONS: Array<{ value: Alignment; Icon: typeof AlignLeft; label: string }> = [
  { value: 'left', Icon: AlignLeft, label: 'Align Left (Ctrl+Shift+L)' },
  { value: 'center', Icon: AlignCenter, label: 'Center (Ctrl+Shift+E)' },
  { value: 'right', Icon: AlignRight, label: 'Align Right (Ctrl+Shift+R)' },
  { value: 'justify', Icon: AlignJustify, label: 'Justify (Ctrl+Shift+J)' },
];

export const FormattingToolbar: React.FC<FormattingToolbarProps> = ({
  editor,
  autosaveStatus,
  wordCount,
  settings,
  onOpenParagraphSettings,
  onOpenFindReplace,
}) => {
  if (!editor) return null;

  const paragraphAttrs = editor.getAttributes('paragraph');
  const textStyle = editor.getAttributes('textStyle');

  // Selectors show the EFFECTIVE value: the override when set, else the
  // project default — so the toolbar never implies an override that isn't there.
  const currentFont: string = textStyle.fontFamily || settings.bodyFont;
  const currentSize: number = textStyle.fontSizePt || settings.bodyFontSizePt;
  const currentAlign: Alignment =
    paragraphAttrs.textAlignOverride || settings.paragraphAlignment;

  return (
    <div className="h-12 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 flex items-center justify-between gap-2 overflow-x-auto shrink-0 z-10">
      <div className="flex items-center gap-1">
        {/* Undo / Redo */}
        <button
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Undo (Ctrl+Z)"
          className={`${btn} disabled:opacity-30`}
        >
          <Undo className="w-4 h-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Redo (Ctrl+Y)"
          className={`${btn} disabled:opacity-30`}
        >
          <Redo className="w-4 h-4" />
        </button>

        <div className={divider} />

        {/* Font family */}
        <select
          value={currentFont}
          onChange={(e) => {
            const value = e.target.value;
            if (value === settings.bodyFont) {
              // Back to the project default: clear the override rather than
              // writing the default onto the run.
              editor.chain().focus().unsetFontFamily().run();
            } else {
              editor.chain().focus().setFontFamily(value).run();
            }
          }}
          title="Font"
          aria-label="Font family"
          className={`${selectCls} w-[130px]`}
        >
          {MANUSCRIPT_FONTS.map((f) => (
            <option key={f.docxName} value={f.docxName}>
              {f.label}
            </option>
          ))}
        </select>

        {/* Font size */}
        <select
          value={currentSize}
          onChange={(e) => {
            const value = Number(e.target.value);
            editor
              .chain()
              .focus()
              .setFontSizePt(value === settings.bodyFontSizePt ? null : value)
              .run();
          }}
          title="Font size (pt)"
          aria-label="Font size in points"
          className={`${selectCls} w-[62px]`}
        >
          {Array.from(new Set([...FONT_SIZE_OPTIONS, currentSize]))
            .sort((a, b) => a - b)
            .map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
        </select>

        <div className={divider} />

        {/* Character formatting */}
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold (Ctrl+B)"
          className={editor.isActive('bold') ? `${btnActive} font-bold` : btn}
        >
          <Bold className="w-4 h-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic (Ctrl+I)"
          className={editor.isActive('italic') ? btnActive : btn}
        >
          <Italic className="w-4 h-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          title="Underline (Ctrl+U)"
          className={editor.isActive('underline') ? btnActive : btn}
        >
          <UnderlineIcon className="w-4 h-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleStrike().run()}
          title="Strikethrough"
          className={editor.isActive('strike') ? btnActive : btn}
        >
          <Strikethrough className="w-4 h-4" />
        </button>

        <div className={divider} />

        {/* Alignment */}
        {ALIGN_BUTTONS.map(({ value, Icon, label }) => (
          <button
            key={value}
            onClick={() =>
              editor
                .chain()
                .focus()
                .setParagraphAlignment(value === settings.paragraphAlignment ? null : value)
                .run()
            }
            title={label}
            className={currentAlign === value ? btnActive : btn}
          >
            <Icon className="w-4 h-4" />
          </button>
        ))}

        <div className={divider} />

        {/* Indent */}
        <button
          onClick={() => editor.chain().focus().adjustLeftIndent(-INDENT_STEP_CM).run()}
          title={`Decrease indent (Ctrl+[) — ${INDENT_STEP_CM}cm steps`}
          className={btn}
        >
          <IndentDecrease className="w-4 h-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().adjustLeftIndent(INDENT_STEP_CM).run()}
          title={`Increase indent (Ctrl+]) — ${INDENT_STEP_CM}cm steps`}
          className={btn}
        >
          <IndentIncrease className="w-4 h-4" />
        </button>

        <button
          onClick={onOpenParagraphSettings}
          title="Paragraph settings…"
          className={btn}
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>

        <div className={divider} />

        {/* Semantic breaks */}
        <button
          onClick={() => editor.chain().focus().insertSceneBreak().run()}
          title={`Insert Scene Break (${settings.sceneBreakSymbol || '***'})`}
          className="px-2 py-1 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 flex items-center gap-1 transition-colors shrink-0"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Scene
        </button>
        <button
          onClick={() => editor.chain().focus().insertPageBreak().run()}
          title="Insert Page Break (Ctrl+Enter)"
          className="px-2 py-1 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 flex items-center gap-1 transition-colors shrink-0"
        >
          <Scissors className="w-3.5 h-3.5 text-blue-500" /> Page
        </button>

        {onOpenFindReplace && (
          <button onClick={onOpenFindReplace} title="Find & Replace (Ctrl+F)" className={btn}>
            <Search className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Status */}
      <div className="flex items-center gap-4 shrink-0 text-xs font-mono">
        <span className="text-slate-500 dark:text-slate-400">
          {wordCount.toLocaleString()} words
        </span>

        <div className="flex items-center gap-1.5">
          {autosaveStatus === 'dirty' && (
            <span
              className="text-slate-400 flex items-center gap-1 font-sans"
              title="Edited — saving shortly"
            >
              <PencilLine className="w-3.5 h-3.5" /> Unsaved
            </span>
          )}
          {autosaveStatus === 'conflict' && (
            <span
              className="text-amber-600 dark:text-amber-400 flex items-center gap-1 font-sans font-semibold"
              title="This chapter changed on another device"
            >
              <GitMerge className="w-3.5 h-3.5" /> Conflict
            </span>
          )}
          {autosaveStatus === 'saving' && (
            <span className="text-amber-500 flex items-center gap-1 font-sans">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Saving...
            </span>
          )}
          {autosaveStatus === 'saved' && (
            <span className="text-emerald-500 flex items-center gap-1 font-sans">
              <CheckCircle2 className="w-3.5 h-3.5" /> Saved
            </span>
          )}
          {autosaveStatus === 'offline_pending' && (
            <span
              className="text-amber-600 dark:text-amber-400 flex items-center gap-1 font-sans"
              title="Offline — saved to this device, will sync when reconnected"
            >
              <AlertCircle className="w-3.5 h-3.5" /> Offline
            </span>
          )}
          {autosaveStatus === 'error' && (
            <span className="text-red-500 flex items-center gap-1 font-sans">
              <AlertCircle className="w-3.5 h-3.5" /> Save Error
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

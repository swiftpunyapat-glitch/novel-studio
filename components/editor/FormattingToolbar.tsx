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
  Indent,
  Undo,
  Redo,
  Sparkles,
  Scissors,
  CheckCircle2,
  RefreshCw,
  AlertCircle,
  Search,
} from 'lucide-react';
import { AutosaveStatus } from '@/types/editor';

interface FormattingToolbarProps {
  editor: Editor | null;
  autosaveStatus: AutosaveStatus;
  wordCount: number;
  onOpenFindReplace?: () => void;
}

export const FormattingToolbar: React.FC<FormattingToolbarProps> = ({
  editor,
  autosaveStatus,
  wordCount,
  onOpenFindReplace,
}) => {
  if (!editor) return null;

  return (
    <div className="h-12 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 flex items-center justify-between gap-2 overflow-x-auto shrink-0 z-10">
      {/* Formatting Action Buttons */}
      <div className="flex items-center gap-1">
        {/* Undo / Redo */}
        <button
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Undo (Ctrl+Z)"
          className="p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded disabled:opacity-30 transition-colors"
        >
          <Undo className="w-4 h-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Redo (Ctrl+Y)"
          className="p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded disabled:opacity-30 transition-colors"
        >
          <Redo className="w-4 h-4" />
        </button>

        <div className="w-[1px] h-5 bg-slate-200 dark:bg-slate-700 mx-1" />

        {/* Font formatting */}
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          title="Bold (Ctrl+B)"
          className={`p-1.5 rounded transition-colors ${
            editor.isActive('bold')
              ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 font-bold'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Bold className="w-4 h-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          title="Italic (Ctrl+I)"
          className={`p-1.5 rounded transition-colors ${
            editor.isActive('italic')
              ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Italic className="w-4 h-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          title="Underline (Ctrl+U)"
          className={`p-1.5 rounded transition-colors ${
            editor.isActive('underline')
              ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <UnderlineIcon className="w-4 h-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().toggleStrike().run()}
          title="Strikethrough"
          className={`p-1.5 rounded transition-colors ${
            editor.isActive('strike')
              ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Strikethrough className="w-4 h-4" />
        </button>

        <div className="w-[1px] h-5 bg-slate-200 dark:bg-slate-700 mx-1" />

        {/* Alignment */}
        <button
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          title="Align Left"
          className={`p-1.5 rounded transition-colors ${
            editor.isActive({ textAlign: 'left' })
              ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <AlignLeft className="w-4 h-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          title="Align Center"
          className={`p-1.5 rounded transition-colors ${
            editor.isActive({ textAlign: 'center' })
              ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <AlignCenter className="w-4 h-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          title="Align Right"
          className={`p-1.5 rounded transition-colors ${
            editor.isActive({ textAlign: 'right' })
              ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <AlignRight className="w-4 h-4" />
        </button>
        <button
          onClick={() => editor.chain().focus().setTextAlign('justify').run()}
          title="Justify"
          className={`p-1.5 rounded transition-colors ${
            editor.isActive({ textAlign: 'justify' })
              ? 'bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400'
              : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <AlignJustify className="w-4 h-4" />
        </button>

        <div className="w-[1px] h-5 bg-slate-200 dark:bg-slate-700 mx-1" />

        {/* First line indent toggle */}
        <button
          onClick={() => editor.chain().focus().toggleFirstLineIndent().run()}
          title="Toggle First-Line Indent (0.5cm)"
          className="p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
        >
          <Indent className="w-4 h-4" />
        </button>

        {/* Semantic Breaks */}
        <button
          onClick={() => editor.chain().focus().insertSceneBreak().run()}
          title="Insert Scene Break (***)"
          className="px-2 py-1 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 flex items-center gap-1 transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-500" /> Scene Break
        </button>
        <button
          onClick={() => editor.chain().focus().insertPageBreak().run()}
          title="Insert Page Break (Ctrl+Enter)"
          className="px-2 py-1 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 flex items-center gap-1 transition-colors"
        >
          <Scissors className="w-3.5 h-3.5 text-blue-500" /> Page Break
        </button>

        {onOpenFindReplace && (
          <button
            onClick={onOpenFindReplace}
            title="Find & Replace (Ctrl+F / Ctrl+H)"
            className="p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
          >
            <Search className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Right Side: Status & Word Count */}
      <div className="flex items-center gap-4 shrink-0 text-xs font-mono">
        <span className="text-slate-500 dark:text-slate-400">
          {wordCount.toLocaleString()} words
        </span>

        {/* Autosave Status Badge */}
        <div className="flex items-center gap-1.5">
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
            <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1 font-sans" title="Offline - Saved to local cache">
              <AlertCircle className="w-3.5 h-3.5" /> Offline Pending
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

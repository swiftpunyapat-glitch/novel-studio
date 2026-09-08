'use client';

import React, { useCallback, useRef, useState } from 'react';
import { AlertTriangle, FileUp, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  describeLossyConversions,
  parseMarkdownToManuscript,
  type MarkdownImportResult,
} from '@/lib/editor/markdown-import';

/**
 * Import a Markdown file into the open chapter. (Stage 6A)
 *
 * Two things this dialog is careful about.
 *
 * First, it never imports blind. Markdown has block types the manuscript schema
 * does not — headings, lists, quotes, code — so an import always reinterprets
 * something. The author sees the converted text and a plain list of what was
 * reinterpreted BEFORE they accept it, rather than discovering it afterwards in
 * their prose.
 *
 * Second, it does not save. The import lands in the editor as an ordinary edit:
 * the chapter goes to "Unsaved", and nothing reaches Firestore until the author
 * presses Save, exactly as if they had typed it. Ctrl+Z undoes it. That is
 * deliberate — an import that wrote straight to the manuscript would be the one
 * irreversible action in an application built entirely on manual save.
 */

/** Large enough for any manuscript, small enough not to hang the tab. */
const MAX_BYTES = 5 * 1024 * 1024;
const PREVIEW_CHARS = 1200;

export type ImportMode = 'replace' | 'append';

interface ImportMarkdownDialogProps {
  /** True when the chapter already has prose that Replace would discard. */
  chapterHasContent: boolean;
  onImport: (result: MarkdownImportResult, mode: ImportMode) => void;
  onClose: () => void;
}

interface LoadedFile {
  name: string;
  result: MarkdownImportResult;
}

const labelCls =
  'block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1';

export const ImportMarkdownDialog: React.FC<ImportMarkdownDialogProps> = ({
  chapterHasContent,
  onImport,
  onClose,
}) => {
  const [file, setFile] = useState<LoadedFile | null>(null);
  const [mode, setMode] = useState<ImportMode>(chapterHasContent ? 'append' : 'replace');
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = useCallback(async (chosen: File | undefined) => {
    if (!chosen) return;

    setError(null);
    setFile(null);

    if (chosen.size > MAX_BYTES) {
      setError(
        `That file is ${(chosen.size / 1024 / 1024).toFixed(1)} MB. The limit is ${
          MAX_BYTES / 1024 / 1024
        } MB.`
      );
      return;
    }

    setReading(true);
    try {
      const text = await chosen.text();
      setFile({ name: chosen.name, result: parseMarkdownToManuscript(text) });
    } catch (err) {
      console.error('Could not read the Markdown file', err);
      setError('Could not read that file. Is it a plain text .md file?');
    } finally {
      setReading(false);
    }
  }, []);

  const notes = file ? describeLossyConversions(file.result.stats) : [];
  const preview = file?.result.plainText ?? '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2 border-b border-slate-200 p-5 dark:border-slate-800">
          <FileUp className="h-4 w-4 text-indigo-600" />
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            Import Markdown
          </h3>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label className={labelCls} htmlFor="md-file">
              Markdown file
            </label>
            <input
              id="md-file"
              ref={inputRef}
              type="file"
              accept=".md,.markdown,.txt,text/markdown,text/plain"
              onChange={(e) => void handleFile(e.target.files?.[0])}
              className="w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-slate-700 hover:file:bg-slate-200 dark:text-slate-400 dark:file:bg-slate-800 dark:file:text-slate-200 dark:hover:file:bg-slate-700"
            />
            <p className="mt-1 text-[11px] text-slate-400">
              The file is read in this browser. Nothing is uploaded.
            </p>
          </div>

          {error && (
            <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>
          )}

          {reading && (
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading…
            </p>
          )}

          {file && (
            <>
              <div className="rounded-md bg-slate-50 p-3 dark:bg-slate-800/60">
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  {file.name}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {file.result.stats.wordCount.toLocaleString()} words ·{' '}
                  {file.result.stats.paragraphs.toLocaleString()} paragraphs
                  {file.result.stats.sceneBreaks > 0 &&
                    ` · ${file.result.stats.sceneBreaks} scene break${
                      file.result.stats.sceneBreaks === 1 ? '' : 's'
                    }`}
                </p>
              </div>

              {notes.length > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" /> Converted to fit the manuscript
                  </p>
                  <ul className="mt-1.5 space-y-0.5 text-xs text-amber-800 dark:text-amber-300">
                    {notes.map((note) => (
                      <li key={note}>• {note}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <label className={labelCls}>Preview</label>
                <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-3 font-sans text-xs leading-relaxed text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">
                  {preview.slice(0, PREVIEW_CHARS)}
                  {preview.length > PREVIEW_CHARS ? '\n…' : ''}
                </pre>
              </div>

              <div>
                <label className={labelCls}>Where it goes</label>
                <div className="grid grid-cols-2 gap-1.5 rounded-lg bg-slate-100 p-1 text-xs font-medium dark:bg-slate-800">
                  {(['append', 'replace'] as ImportMode[]).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setMode(option)}
                      className={`rounded py-1.5 transition-colors ${
                        mode === option
                          ? 'bg-white font-semibold text-indigo-600 shadow-sm dark:bg-slate-900 dark:text-indigo-400'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                      }`}
                    >
                      {option === 'append' ? 'Add to the end' : 'Replace chapter'}
                    </button>
                  ))}
                </div>
                {mode === 'replace' && chapterHasContent && (
                  <p className="mt-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                    This discards what the chapter currently holds. Ctrl+Z undoes it,
                    and nothing is saved until you press Save.
                  </p>
                )}
              </div>
            </>
          )}

          <p className="text-[11px] leading-relaxed text-slate-400">
            The import arrives as an ordinary edit: the chapter becomes
            <span className="font-medium text-amber-600 dark:text-amber-400"> Unsaved</span>,
            and nothing is written until you press Save.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 p-5 dark:border-slate-800">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!file || reading}
            onClick={() => file && onImport(file.result, mode)}
          >
            <FileUp className="mr-1 h-3.5 w-3.5" />
            Import
          </Button>
        </div>
      </div>
    </div>
  );
};

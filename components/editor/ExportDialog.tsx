'use client';

import React, { useMemo, useState } from 'react';
import { Download, Loader2, FileText } from 'lucide-react';
import type { Chapter, Project, Volume } from '@/types/project';
import {
  exportManuscript,
  exportFilename,
  selectChapters,
  type ExportScope,
} from '@/lib/docx/export-client';
import { Button } from '@/components/ui/Button';

/**
 * Export dialog. (Stage 3J)
 *
 * All four scopes are callable: Current Chapter, Selected Chapters, Current
 * Volume, Entire Manuscript. A scope with nothing to export is disabled rather
 * than offered and then failing.
 */

interface ExportDialogProps {
  project: Project;
  chapters: Chapter[];
  volumes: Volume[];
  /** Chapter currently open in the editor, if any. */
  currentChapterId?: string;
  getIdToken: () => Promise<string>;
  onClose: () => void;
}

const radioRow =
  'flex items-start gap-2.5 rounded-lg border p-3 cursor-pointer transition-colors';

export const ExportDialog: React.FC<ExportDialogProps> = ({
  project,
  chapters,
  volumes,
  currentChapterId,
  getIdToken,
  onClose,
}) => {
  const currentChapter = chapters.find((c) => c.id === currentChapterId);
  const currentVolumeId = currentChapter?.volumeId ?? volumes[0]?.id;

  const [scope, setScope] = useState<ExportScope>(
    currentChapter ? 'chapter' : 'manuscript'
  );
  const [volumeId, setVolumeId] = useState<string | undefined>(currentVolumeId);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(currentChapter ? [currentChapter.id] : [])
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useMemo(
    () => ({
      scope,
      project,
      chapterId: currentChapterId,
      volumeId,
      chapterIds: Array.from(selected),
    }),
    [scope, project, currentChapterId, volumeId, selected]
  );

  const resolved = useMemo(
    () => selectChapters(request, chapters, volumes),
    [request, chapters, volumes]
  );

  const filename = exportFilename(scope, project.title, {
    chapter: currentChapter,
    volume: volumes.find((v) => v.id === volumeId),
    count: resolved.length,
  });

  const handleExport = async () => {
    setBusy(true);
    setError(null);
    try {
      await exportManuscript(request, project.documentSettings, getIdToken);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const option = (value: ExportScope, title: string, detail: string, disabled = false) => (
    <label
      className={`${radioRow} ${
        scope === value
          ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/30'
          : 'border-slate-200 dark:border-slate-800'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      <input
        type="radio"
        name="export-scope"
        className="mt-0.5"
        value={value}
        checked={scope === value}
        disabled={disabled}
        onChange={() => setScope(value)}
      />
      <span>
        <span className="block text-sm font-medium text-slate-900 dark:text-white">{title}</span>
        <span className="block text-xs text-slate-500">{detail}</span>
      </span>
    </label>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl">
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 p-5">
          <Download className="h-5 w-5 text-indigo-600" />
          <h2 id="export-title" className="text-lg font-bold text-slate-900 dark:text-white">
            Export to Word
          </h2>
        </div>

        <div className="max-h-[55vh] space-y-3 overflow-y-auto p-5">
          {option(
            'chapter',
            'Current chapter',
            currentChapter
              ? currentChapter.title || 'Untitled chapter'
              : 'Open a chapter first',
            !currentChapter
          )}

          {option(
            'selection',
            'Selected chapters',
            `${selected.size} selected`,
            chapters.length === 0
          )}

          {scope === 'selection' && (
            <div className="ml-6 max-h-44 space-y-1 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800 p-2">
              {chapters.map((c) => (
                <label
                  key={c.id}
                  className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                  />
                  <FileText className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-slate-700 dark:text-slate-300">
                    {c.chapterNumber !== null && c.chapterNumber !== undefined
                      ? `${c.chapterNumber}. `
                      : ''}
                    {c.title || 'Untitled chapter'}
                  </span>
                </label>
              ))}
            </div>
          )}

          {option(
            'volume',
            'Current volume',
            volumes.length ? 'All chapters in the chosen volume' : 'No volumes yet',
            volumes.length === 0
          )}

          {scope === 'volume' && volumes.length > 0 && (
            <select
              className="ml-6 w-[calc(100%-1.5rem)] rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-sm"
              value={volumeId}
              onChange={(e) => setVolumeId(e.target.value)}
              aria-label="Volume to export"
            >
              {volumes.map((v) => (
                <option key={v.id} value={v.id}>
                  Volume {v.volumeNumber} — {v.title}
                </option>
              ))}
            </select>
          )}

          {option(
            'manuscript',
            'Entire manuscript',
            `${chapters.length} chapters across ${volumes.length} volume(s)`,
            chapters.length === 0
          )}

          <div className="rounded-md bg-slate-50 dark:bg-slate-800/60 p-3 text-xs">
            <p className="text-slate-500">
              {resolved.length} chapter{resolved.length === 1 ? '' : 's'} · A5 148 × 210 mm ·{' '}
              {project.documentSettings.bodyFont} {project.documentSettings.bodyFontSizePt}pt
            </p>
            <p className="mt-1 font-mono text-slate-700 dark:text-slate-300">{filename}</p>
          </div>

          {error && (
            <p className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 dark:border-slate-800 p-5">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleExport}
            disabled={busy || resolved.length === 0}
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-1.5 h-4 w-4" />
            )}
            Export .docx
          </Button>
        </div>
      </div>
    </div>
  );
};

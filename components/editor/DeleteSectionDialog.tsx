'use client';

import React, { useState } from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

/**
 * Destructive confirmation for deleting a chapter or a volume. (Stage 4E / 4F)
 *
 * The author must type the exact title. That is not friction for its own sake:
 * a chapter list is a column of similar-looking rows, and a mis-click on the
 * wrong trash icon would otherwise destroy months of work with one further
 * click. Typing the title forces the author to read which one they are on.
 *
 * The volume variant states, before the field, that every chapter inside it
 * goes too — the thing an author would most regret not being told.
 *
 * What the author typed is handed to `onConfirm` and travels to the server,
 * which checks it against the stored title before deleting anything. Confirming
 * on the client alone would be decoration: the route is reachable without this
 * dialog.
 */

interface DeleteSectionDialogProps {
  kind: 'chapter' | 'volume';
  title: string;
  /** Chapters that will be destroyed along with a volume. */
  chapterTitles?: string[];
  busy: boolean;
  error: string | null;
  /** Receives exactly what the author typed, for the server to verify. */
  onConfirm: (confirmationTitle: string) => void;
  onClose: () => void;
}

export const DeleteSectionDialog: React.FC<DeleteSectionDialogProps> = ({
  kind,
  title,
  chapterTitles = [],
  busy,
  error,
  onConfirm,
  onClose,
}) => {
  const [typed, setTyped] = useState('');
  const matches = typed.trim() === title.trim();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!matches || busy) return;
    onConfirm(typed);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
          <div className="rounded-full bg-red-100 p-2 dark:bg-red-950/60">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">
            {kind === 'volume' ? 'Delete Volume' : 'Delete Chapter'}
          </h3>
        </div>

        {kind === 'volume' ? (
          <div className="space-y-2">
            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              This action cannot be undone. Deleting the volume{' '}
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                &ldquo;{title}&rdquo;
              </span>{' '}
              also permanently deletes{' '}
              <span className="font-semibold text-red-600 dark:text-red-400">
                every chapter inside it
              </span>
              , along with their draft variants, revisions, files and published
              copies.
            </p>

            <div className="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900/60 dark:bg-red-950/30">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-red-700 dark:text-red-400">
                {chapterTitles.length === 0
                  ? 'This volume is empty'
                  : `${chapterTitles.length} chapter${
                      chapterTitles.length === 1 ? '' : 's'
                    } will be deleted`}
              </p>
              {chapterTitles.length > 0 && (
                <ul className="mt-1.5 max-h-28 space-y-0.5 overflow-y-auto text-xs text-red-800 dark:text-red-300">
                  {chapterTitles.map((chapterTitle, index) => (
                    <li key={`${chapterTitle}-${index}`} className="truncate">
                      • {chapterTitle || 'Untitled'}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="text-[11px] text-slate-500">
              Other volumes, characters and project settings are not affected.
            </p>
          </div>
        ) : (
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
            This action cannot be undone. This will permanently delete{' '}
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              &ldquo;{title}&rdquo;
            </span>{' '}
            and all of its draft variants, revisions, files and published copies.
            Other chapters in this volume are not affected.
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              To confirm, type the exact {kind} title:{' '}
              <span className="select-all font-mono text-indigo-600 dark:text-indigo-400">
                {title}
              </span>
            </label>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={title}
              autoFocus
              required
            />
          </div>

          {error && (
            <p className="text-xs font-medium text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" size="sm" disabled={busy || !matches}>
              {busy ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="mr-1 h-3.5 w-3.5" />
              )}
              {kind === 'volume' ? 'Delete Volume' : 'Delete Chapter'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

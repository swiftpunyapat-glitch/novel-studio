'use client';

import React from 'react';
import { AlertTriangle, Download, GitBranch, Clock } from 'lucide-react';
import type { ConflictState } from '@/lib/editor/save-coordinator';
import { Button } from '@/components/ui/Button';

/**
 * Shown when a save was refused because another device advanced this variant.
 * (Stage 2B)
 *
 * Nothing has been overwritten at this point and nothing is merged. The author
 * picks what happens; every option preserves both copies.
 */

interface ConflictDialogProps {
  conflict: ConflictState;
  busy?: boolean;
  onReloadRemote: () => void;
  onKeepLocalAsVariant: () => void;
  onReviewLater: () => void;
}

function preview(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > 180 ? `${trimmed.slice(0, 180)}…` : trimmed || '(empty)';
}

export const ConflictDialog: React.FC<ConflictDialogProps> = ({
  conflict,
  busy = false,
  onReloadRemote,
  onKeepLocalAsVariant,
  onReviewLater,
}) => {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-title"
    >
      <div className="w-full max-w-2xl rounded-xl border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900 shadow-xl">
        <div className="flex items-start gap-3 border-b border-slate-200 dark:border-slate-800 p-5">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div>
            <h2 id="conflict-title" className="text-lg font-bold text-slate-900 dark:text-white">
              This chapter changed on another device
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Your latest edits were not saved, and nothing was overwritten. The
              copy on this device is safe locally. Choose how to continue.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
          <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
            <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              On this device (unsaved) · v{conflict.baseVersion}
            </h3>
            <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">
              {preview(conflict.local.plainText)}
            </p>
            <p className="mt-2 text-[11px] text-slate-400">
              {conflict.local.wordCount.toLocaleString()} words
            </p>
          </section>

          <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
            <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Saved elsewhere · v{conflict.remoteVersion}
            </h3>
            <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">
              {preview(conflict.remote.plainText)}
            </p>
            <p className="mt-2 text-[11px] text-slate-400">
              {conflict.remote.wordCount.toLocaleString()} words
            </p>
          </section>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-200 dark:border-slate-800 p-5">
          <Button
            variant="primary"
            disabled={busy}
            onClick={onKeepLocalAsVariant}
            className="justify-start"
          >
            <GitBranch className="mr-2 h-4 w-4" />
            Keep this device&apos;s text as a new draft variant
          </Button>
          <p className="-mt-1 mb-1 pl-1 text-xs text-slate-500">
            Recommended. Saves your unsaved text as a separate draft so you can
            compare both versions. Neither copy is lost.
          </p>

          <Button
            variant="secondary"
            disabled={busy}
            onClick={onReloadRemote}
            className="justify-start"
          >
            <Download className="mr-2 h-4 w-4" />
            Load the version saved elsewhere
          </Button>
          <p className="-mt-1 mb-1 pl-1 text-xs text-slate-500">
            Replaces what is on screen. Your unsaved text stays in this
            browser&apos;s local recovery store.
          </p>

          <Button
            variant="ghost"
            disabled={busy}
            onClick={onReviewLater}
            className="justify-start"
          >
            <Clock className="mr-2 h-4 w-4" />
            Review later
          </Button>
          <p className="-mt-1 pl-1 text-xs text-slate-500">
            Keeps editing without saving. Autosave stays paused until you choose.
          </p>
        </div>
      </div>
    </div>
  );
};

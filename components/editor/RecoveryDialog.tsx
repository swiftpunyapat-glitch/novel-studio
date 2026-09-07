'use client';

import React from 'react';
import { LifeBuoy, RotateCcw, CloudDownload, GitBranch } from 'lucide-react';
import type { MirrorSnapshot } from '@/lib/offline/manuscript-mirror';
import { Button } from '@/components/ui/Button';

/**
 * Shown on load when the local mirror holds content that was never confirmed
 * saved. (Stage 2D)
 *
 * Neither copy is destroyed by any option here.
 */

interface RecoveryDialogProps {
  local: MirrorSnapshot;
  remotePlainText: string;
  remoteWordCount: number;
  remoteVersion: number;
  busy?: boolean;
  onRestoreLocal: () => void;
  onUseRemote: () => void;
  onPreserveAsVariant: () => void;
}

function preview(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > 180 ? `${trimmed.slice(0, 180)}…` : trimmed || '(empty)';
}

function when(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return 'recently';
  }
}

export const RecoveryDialog: React.FC<RecoveryDialogProps> = ({
  local,
  remotePlainText,
  remoteWordCount,
  remoteVersion,
  busy = false,
  onRestoreLocal,
  onUseRemote,
  onPreserveAsVariant,
}) => {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-title"
    >
      <div className="w-full max-w-2xl rounded-xl border border-indigo-300 dark:border-indigo-800 bg-white dark:bg-slate-900 shadow-xl">
        <div className="flex items-start gap-3 border-b border-slate-200 dark:border-slate-800 p-5">
          <LifeBuoy className="mt-0.5 h-5 w-5 shrink-0 text-indigo-500" />
          <div>
            <h2 id="recovery-title" className="text-lg font-bold text-slate-900 dark:text-white">
              Unsynced local changes were found
            </h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              This browser has text from {when(local.savedAt)} that was never
              confirmed saved. Nothing has been discarded.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
          <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
            <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Local recovery copy
            </h3>
            <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">
              {preview(local.plainText)}
            </p>
            <p className="mt-2 text-[11px] text-slate-400">
              {local.wordCount.toLocaleString()} words · from v{local.baseVersion}
            </p>
          </section>

          <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
            <h3 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Saved on the server · v{remoteVersion}
            </h3>
            <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-300">
              {preview(remotePlainText)}
            </p>
            <p className="mt-2 text-[11px] text-slate-400">
              {remoteWordCount.toLocaleString()} words
            </p>
          </section>
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-200 dark:border-slate-800 p-5">
          <Button
            variant="primary"
            disabled={busy}
            onClick={onRestoreLocal}
            className="justify-start"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Restore the local copy
          </Button>
          <p className="-mt-1 mb-1 pl-1 text-xs text-slate-500">
            Continues from this browser&apos;s text and saves it to the server.
          </p>

          <Button
            variant="secondary"
            disabled={busy}
            onClick={onPreserveAsVariant}
            className="justify-start"
          >
            <GitBranch className="mr-2 h-4 w-4" />
            Preserve the local copy as a new draft variant
          </Button>
          <p className="-mt-1 mb-1 pl-1 text-xs text-slate-500">
            Keeps both: the server version stays as it is, and the local text
            becomes a separate draft.
          </p>

          <Button
            variant="ghost"
            disabled={busy}
            onClick={onUseRemote}
            className="justify-start"
          >
            <CloudDownload className="mr-2 h-4 w-4" />
            Use the server version
          </Button>
          <p className="-mt-1 pl-1 text-xs text-slate-500">
            The local copy stays in this browser&apos;s recovery store; it is not
            deleted.
          </p>
        </div>
      </div>
    </div>
  );
};

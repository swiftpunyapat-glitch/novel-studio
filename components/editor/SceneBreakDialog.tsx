'use client';

import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  isEmptySceneHeader,
  sceneHeaderToText,
  type SceneHeaderAttrs,
} from '@/lib/editor/scene-header';

/**
 * Scene break insertion. (Stage 4C)
 *
 * Two shapes of the same act: a plain break, or a break that also says when and
 * where the next scene happens. Both fields are optional and independent, and
 * neither is ever inferred — the author types what they mean.
 */

interface SceneBreakDialogProps {
  /** Existing values when editing a scene header already in the manuscript. */
  initial?: Partial<SceneHeaderAttrs> | null;
  mode: 'insert' | 'edit';
  sceneBreakSymbol: string;
  onSubmit: (header: Partial<SceneHeaderAttrs> | null) => void;
  onClose: () => void;
}

const labelCls =
  'block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1';
const inputCls =
  'w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500';

export const SceneBreakDialog: React.FC<SceneBreakDialogProps> = ({
  initial,
  mode,
  sceneBreakSymbol,
  onSubmit,
  onClose,
}) => {
  const [timeText, setTimeText] = useState(initial?.timeText ?? '');
  const [locationText, setLocationText] = useState(initial?.locationText ?? '');

  const header = { timeText, locationText };
  const preview = sceneHeaderToText(header);
  const headerIsEmpty = isEmptySceneHeader(header);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(headerIsEmpty ? null : header);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900"
      >
        <h3 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
          <Sparkles className="h-4 w-4 text-amber-500" />
          {mode === 'edit' ? 'Scene Header' : 'Insert Scene Break'}
        </h3>

        <p className="text-xs leading-relaxed text-slate-500">
          {mode === 'edit'
            ? 'Time and location for this scene. Leave both empty to remove the header.'
            : 'Both fields are optional. Leave them empty for a plain scene break.'}
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls} htmlFor="scene-time">
              Time
            </label>
            <input
              id="scene-time"
              className={inputCls}
              value={timeText}
              onChange={(e) => setTimeText(e.target.value)}
              placeholder="18:30"
              autoFocus
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="scene-location">
              Location
            </label>
            <input
              id="scene-location"
              className={inputCls}
              value={locationText}
              onChange={(e) => setLocationText(e.target.value)}
              placeholder="ลาดพร้าว 101"
            />
          </div>
        </div>

        <div className="rounded-md bg-slate-50 p-3 text-center dark:bg-slate-800/60">
          <div className="text-sm font-semibold tracking-[0.3em] text-slate-400">
            {sceneBreakSymbol || '***'}
          </div>
          {preview ? (
            <div className="mt-1 text-sm italic text-slate-600 dark:text-slate-300">
              {preview}
            </div>
          ) : (
            <div className="mt-1 text-xs text-slate-400">Scene break only</div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm">
            {mode === 'edit' ? 'Update' : 'Insert'}
          </Button>
        </div>
      </form>
    </div>
  );
};

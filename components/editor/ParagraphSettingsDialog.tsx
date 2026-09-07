'use client';

import React, { useState } from 'react';
import { AlignLeft, RotateCcw } from 'lucide-react';
import type { DocumentSettings } from '@/types/project';
import {
  ALIGNMENTS,
  EMPTY_PARAGRAPH_OVERRIDES,
  readParagraphOverrides,
  resolveParagraphFormat,
  type Alignment,
  type ParagraphOverrides,
} from '@/lib/format/effective';
import { Button } from '@/components/ui/Button';

/**
 * Word-style Paragraph dialog. (Stage 3E)
 *
 * Every field shows the EFFECTIVE value, with a marker when it is inherited
 * rather than set. "Reset to Project Default" writes `null` to clear overrides —
 * it never writes a copy of the current defaults, which would silently pin the
 * paragraph and defeat inheritance.
 */

type SpecialIndent = 'none' | 'first-line';
type LineSpacingPreset = 'single' | '1.5' | 'double' | 'multiple';

interface ParagraphSettingsDialogProps {
  attrs: Record<string, unknown>;
  settings: DocumentSettings;
  onApply: (overrides: Partial<ParagraphOverrides>) => void;
  onResetToDefault: () => void;
  onClose: () => void;
}

function presetFor(multiplier: number): LineSpacingPreset {
  if (multiplier === 1) return 'single';
  if (multiplier === 1.5) return '1.5';
  if (multiplier === 2) return 'double';
  return 'multiple';
}

function multiplierFor(preset: LineSpacingPreset, at: number): number {
  if (preset === 'single') return 1;
  if (preset === '1.5') return 1.5;
  if (preset === 'double') return 2;
  return at;
}

const labelCls =
  'block text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1';
const inputCls =
  'w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md text-sm text-slate-900 dark:text-slate-100';

export const ParagraphSettingsDialog: React.FC<ParagraphSettingsDialogProps> = ({
  attrs,
  settings,
  onApply,
  onResetToDefault,
  onClose,
}) => {
  const overrides = readParagraphOverrides(attrs);
  const effective = resolveParagraphFormat(attrs, settings);

  const [alignment, setAlignment] = useState<Alignment>(effective.alignment);
  const [left, setLeft] = useState(String(effective.leftIndentCm));
  const [right, setRight] = useState(String(effective.rightIndentCm));
  const [special, setSpecial] = useState<SpecialIndent>(
    effective.firstLineIndentCm > 0 ? 'first-line' : 'none'
  );
  const [by, setBy] = useState(
    String(effective.firstLineIndentCm > 0 ? effective.firstLineIndentCm : settings.firstLineIndentCm)
  );
  const [before, setBefore] = useState(String(effective.spaceBeforePt));
  const [after, setAfter] = useState(String(effective.spaceAfterPt));
  const [preset, setPreset] = useState<LineSpacingPreset>(
    presetFor(effective.lineSpacingMultiplier)
  );
  const [at, setAt] = useState(String(effective.lineSpacingMultiplier));

  const inherited = (key: keyof ParagraphOverrides) => overrides[key] === null;

  const numberOr = (raw: string, fallback: number): number => {
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };

  const handleApply = () => {
    const firstLine = special === 'none' ? 0 : numberOr(by, settings.firstLineIndentCm);
    const multiplier = multiplierFor(preset, numberOr(at, settings.lineSpacingMultiplier));

    // Only write a value where it actually differs from the project default;
    // matching values stay null so the paragraph keeps inheriting.
    const next: Partial<ParagraphOverrides> = {
      textAlignOverride: alignment === settings.paragraphAlignment ? null : alignment,
      firstLineIndentCmOverride:
        firstLine === settings.firstLineIndentCm ? null : firstLine,
      leftIndentCmOverride: numberOr(left, 0) === 0 ? null : numberOr(left, 0),
      rightIndentCmOverride: numberOr(right, 0) === 0 ? null : numberOr(right, 0),
      spaceBeforePtOverride:
        numberOr(before, 0) === settings.paragraphSpacingBeforePt ? null : numberOr(before, 0),
      spaceAfterPtOverride:
        numberOr(after, 0) === settings.paragraphSpacingAfterPt ? null : numberOr(after, 0),
      lineSpacingOverride:
        multiplier === settings.lineSpacingMultiplier ? null : multiplier,
    };

    onApply(next);
    onClose();
  };

  const handleReset = () => {
    // Clears every override. Deliberately not a copy of current defaults.
    onApply({ ...EMPTY_PARAGRAPH_OVERRIDES });
    onResetToDefault();
    onClose();
  };

  const InheritTag = ({ shown }: { shown: boolean }) =>
    shown ? (
      <span className="ml-1.5 text-[10px] font-normal normal-case tracking-normal text-indigo-500">
        inherited
      </span>
    ) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="paragraph-settings-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl">
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 p-5">
          <AlignLeft className="h-5 w-5 text-indigo-600" />
          <h2
            id="paragraph-settings-title"
            className="text-lg font-bold text-slate-900 dark:text-white"
          >
            Paragraph
          </h2>
        </div>

        <div className="space-y-5 p-5">
          <div>
            <label className={labelCls} htmlFor="ps-alignment">
              Alignment
              <InheritTag shown={inherited('textAlignOverride')} />
            </label>
            <select
              id="ps-alignment"
              className={inputCls}
              value={alignment}
              onChange={(e) => setAlignment(e.target.value as Alignment)}
            >
              {ALIGNMENTS.map((a) => (
                <option key={a} value={a}>
                  {a.charAt(0).toUpperCase() + a.slice(1)}
                </option>
              ))}
            </select>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Indentation
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="ps-left">
                  Left (cm)
                  <InheritTag shown={inherited('leftIndentCmOverride')} />
                </label>
                <input
                  id="ps-left"
                  type="number"
                  step="0.1"
                  className={inputCls}
                  value={left}
                  onChange={(e) => setLeft(e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="ps-right">
                  Right (cm)
                  <InheritTag shown={inherited('rightIndentCmOverride')} />
                </label>
                <input
                  id="ps-right"
                  type="number"
                  step="0.1"
                  className={inputCls}
                  value={right}
                  onChange={(e) => setRight(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="ps-special">
                  Special
                  <InheritTag shown={inherited('firstLineIndentCmOverride')} />
                </label>
                <select
                  id="ps-special"
                  className={inputCls}
                  value={special}
                  onChange={(e) => setSpecial(e.target.value as SpecialIndent)}
                >
                  <option value="none">(none)</option>
                  <option value="first-line">First line</option>
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="ps-by">
                  By (cm)
                </label>
                <input
                  id="ps-by"
                  type="number"
                  step="0.1"
                  className={inputCls}
                  value={by}
                  disabled={special === 'none'}
                  onChange={(e) => setBy(e.target.value)}
                />
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Spacing
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="ps-before">
                  Before (pt)
                  <InheritTag shown={inherited('spaceBeforePtOverride')} />
                </label>
                <input
                  id="ps-before"
                  type="number"
                  step="1"
                  className={inputCls}
                  value={before}
                  onChange={(e) => setBefore(e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="ps-after">
                  After (pt)
                  <InheritTag shown={inherited('spaceAfterPtOverride')} />
                </label>
                <input
                  id="ps-after"
                  type="number"
                  step="1"
                  className={inputCls}
                  value={after}
                  onChange={(e) => setAfter(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="ps-linespacing">
                  Line spacing
                  <InheritTag shown={inherited('lineSpacingOverride')} />
                </label>
                <select
                  id="ps-linespacing"
                  className={inputCls}
                  value={preset}
                  onChange={(e) => setPreset(e.target.value as LineSpacingPreset)}
                >
                  <option value="single">Single</option>
                  <option value="1.5">1.5 lines</option>
                  <option value="double">Double</option>
                  <option value="multiple">Multiple</option>
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="ps-at">
                  At
                </label>
                <input
                  id="ps-at"
                  type="number"
                  step="0.01"
                  className={inputCls}
                  value={at}
                  disabled={preset !== 'multiple'}
                  onChange={(e) => setAt(e.target.value)}
                />
              </div>
            </div>
          </fieldset>

          <p className="rounded-md bg-slate-50 dark:bg-slate-800/60 p-2.5 text-xs text-slate-500">
            Project default — {settings.paragraphAlignment}, first line{' '}
            {settings.firstLineIndentCm} cm, before {settings.paragraphSpacingBeforePt} pt, after{' '}
            {settings.paragraphSpacingAfterPt} pt, multiple {settings.lineSpacingMultiplier}.
            Fields marked <span className="text-indigo-500">inherited</span> follow it
            automatically.
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-200 dark:border-slate-800 p-5">
          <Button variant="ghost" onClick={handleReset}>
            <RotateCcw className="mr-1.5 h-4 w-4" />
            Reset to Project Default
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleApply}>
              Apply
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

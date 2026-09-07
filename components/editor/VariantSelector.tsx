'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Chapter, DraftVariant } from '@/types/project';
import {
  GitBranch,
  ChevronDown,
  Check,
  Plus,
  Copy,
  Pencil,
  Star,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

interface VariantSelectorProps {
  chapter: Chapter;
  currentVariant: DraftVariant;
  variants: DraftVariant[];
  onSelectVariant: (variantId: string) => void;
  onCreateVariant: (name: string) => Promise<void>;
  onDuplicateVariant: (name: string) => Promise<void>;
  onRenameVariant: (variantId: string, newName: string) => Promise<void>;
  onSetMain: (variantId: string) => Promise<void>;
}

export const VariantSelector: React.FC<VariantSelectorProps> = ({
  chapter,
  currentVariant,
  variants,
  onSelectVariant,
  onCreateVariant,
  onDuplicateVariant,
  onRenameVariant,
  onSetMain,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'create' | 'duplicate' | 'rename' | null>(null);
  const [modalInputName, setModalInputName] = useState('');
  const [busy, setBusy] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isCurrentMain = currentVariant.id === chapter.activeVariantId;

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [dropdownOpen]);

  const handleOpenCreate = () => {
    setDropdownOpen(false);
    setModalInputName(`Draft ${String.fromCharCode(65 + variants.length)}`);
    setModalMode('create');
  };

  const handleOpenDuplicate = () => {
    setDropdownOpen(false);
    setModalInputName(`${currentVariant.name} (Copy)`);
    setModalMode('duplicate');
  };

  const handleOpenRename = () => {
    setDropdownOpen(false);
    setModalInputName(currentVariant.name);
    setModalMode('rename');
  };

  const handleSetMain = async () => {
    setDropdownOpen(false);
    setBusy(true);
    try {
      await onSetMain(currentVariant.id);
    } finally {
      setBusy(false);
    }
  };

  const handleModalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = modalInputName.trim();
    if (!trimmed) return;

    setBusy(true);
    try {
      if (modalMode === 'create') {
        await onCreateVariant(trimmed);
      } else if (modalMode === 'duplicate') {
        await onDuplicateVariant(trimmed);
      } else if (modalMode === 'rename') {
        await onRenameVariant(currentVariant.id, trimmed);
      }
      setModalMode(null);
    } catch (err) {
      console.error('Failed to update variant', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative flex items-center" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setDropdownOpen((prev) => !prev)}
        disabled={busy}
        className="flex items-center gap-2 py-1 px-2.5 rounded-md hover:bg-slate-200 dark:hover:bg-slate-800 text-xs transition-colors border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
        title="Switch or manage draft variants"
        aria-expanded={dropdownOpen}
      >
        <GitBranch className="w-3.5 h-3.5 text-slate-400" />
        <span className="font-semibold text-slate-800 dark:text-slate-200 max-w-[140px] truncate">
          {isCurrentMain && currentVariant.name !== 'Main'
            ? `Main — ${currentVariant.name}`
            : currentVariant.name}
        </span>
        {isCurrentMain && (
          <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-800">
            Main
          </span>
        )}
        <ChevronDown className="w-3 h-3 text-slate-400 ml-0.5" />
      </button>

      {/* Dropdown Menu */}
      {dropdownOpen && (
        <div className="absolute left-0 top-full mt-1 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-xl py-1.5 z-30">
          <div className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Draft Variants
          </div>

          <div className="max-h-56 overflow-y-auto py-1">
            {variants.map((v) => {
              const isMain = v.id === chapter.activeVariantId;
              const isSelected = v.id === currentVariant.id;

              return (
                <button
                  key={v.id}
                  onClick={() => {
                    setDropdownOpen(false);
                    onSelectVariant(v.id);
                  }}
                  className={`w-full px-3 py-1.5 text-left text-xs flex items-center justify-between transition-colors ${
                    isSelected
                      ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 font-semibold'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    {isSelected ? (
                      <Check className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                    ) : (
                      <div className="w-3.5 shrink-0" />
                    )}
                    <span className="truncate">{v.name}</span>
                    {isMain && (
                      <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 shrink-0">
                        Main
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-slate-400 capitalize shrink-0 ml-2">
                    {v.status}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="h-[1px] bg-slate-200 dark:bg-slate-800 my-1" />

          {/* Action items */}
          <button
            onClick={handleOpenCreate}
            className="w-full px-3 py-1.5 text-left text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
          >
            <Plus className="w-3.5 h-3.5 text-slate-400" />
            + New Variant...
          </button>

          <button
            onClick={handleOpenDuplicate}
            className="w-full px-3 py-1.5 text-left text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
          >
            <Copy className="w-3.5 h-3.5 text-slate-400" />
            Duplicate Current Variant...
          </button>

          <button
            onClick={handleOpenRename}
            className="w-full px-3 py-1.5 text-left text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2"
          >
            <Pencil className="w-3.5 h-3.5 text-slate-400" />
            Rename Variant...
          </button>

          {!isCurrentMain && (
            <button
              onClick={handleSetMain}
              className="w-full px-3 py-1.5 text-left text-xs text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 flex items-center gap-2"
            >
              <Star className="w-3.5 h-3.5" />
              Set as Main
            </button>
          )}
        </div>
      )}

      {/* Modal for Create / Duplicate / Rename */}
      {modalMode && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-sm w-full p-5 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {modalMode === 'create' && 'New Draft Variant'}
              {modalMode === 'duplicate' && 'Duplicate Variant'}
              {modalMode === 'rename' && 'Rename Variant'}
            </h3>

            <form onSubmit={handleModalSubmit} className="space-y-4">
              <Input
                label="Variant Name"
                value={modalInputName}
                onChange={(e) => setModalInputName(e.target.value)}
                placeholder="e.g. Draft B, Action focus..."
                autoFocus
                required
              />

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setModalMode(null)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={busy || !modalInputName.trim()}
                >
                  {busy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : modalMode === 'create' ? (
                    'Create'
                  ) : modalMode === 'duplicate' ? (
                    'Duplicate'
                  ) : (
                    'Save'
                  )}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

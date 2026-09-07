'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { getProject, updateProjectSettings } from '@/lib/firebase/firestore';
import { Project, DocumentSettings } from '@/types/project';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Settings, Save, CheckCircle2 } from 'lucide-react';

export default function ProjectSettingsPage() {
  const params = useParams();
  const projectId = params?.projectId as string;

  const [project, setProject] = useState<Project | null>(null);
  const [settings, setSettings] = useState<DocumentSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    getProject(projectId).then((p) => {
      if (p) {
        setProject(p);
        setSettings(p.documentSettings);
      }
    });
  }, [projectId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !settings) return;
    setSaving(true);
    try {
      await updateProjectSettings(projectId, settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Failed to update settings', err);
    } finally {
      setSaving(false);
    }
  };

  if (!project || !settings) return null;

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-3xl mx-auto w-full space-y-6">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Settings className="w-6 h-6 text-indigo-600" /> Document Formatting Settings
          </h1>
          <p className="text-sm text-slate-500">
            Canonical styles for manuscript rendering, DOCX exports, and reader display
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6 bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
        {/* Paper Size & Margins */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Page Layout (A5 Standard)
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                Paper Size
              </label>
              <input
                type="text"
                disabled
                value="A5 (148 × 210 mm)"
                className="w-full px-3 py-2 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-md text-sm text-slate-600 dark:text-slate-400 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                All Margins (mm)
              </label>
              <input
                type="number"
                value={settings.margins.topMm}
                onChange={(e) => {
                  const val = parseFloat(e.target.value) || 20;
                  setSettings({
                    ...settings,
                    margins: { topMm: val, bottomMm: val, leftMm: val, rightMm: val },
                  });
                }}
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md text-sm"
              />
            </div>
          </div>
        </div>

        {/* Typography */}
        <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Body Typography
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Font Family"
              value={settings.bodyFont}
              onChange={(e) => setSettings({ ...settings, bodyFont: e.target.value })}
            />
            <Input
              label="Font Size (pt)"
              type="number"
              value={settings.bodyFontSizePt}
              onChange={(e) => setSettings({ ...settings, bodyFontSizePt: parseFloat(e.target.value) || 16 })}
            />
          </div>
        </div>

        {/* Paragraph & Spacing */}
        <div className="space-y-4 pt-4 border-t border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Paragraph & Line Spacing
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="First-Line Indent (cm)"
              type="number"
              step="0.1"
              value={settings.firstLineIndentCm}
              onChange={(e) => setSettings({ ...settings, firstLineIndentCm: parseFloat(e.target.value) || 0.5 })}
            />
            <Input
              label="Line Spacing Multiplier"
              type="number"
              step="0.01"
              value={settings.lineSpacingMultiplier}
              onChange={(e) => setSettings({ ...settings, lineSpacingMultiplier: parseFloat(e.target.value) || 1.08 })}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
              Scene Break Symbol
            </label>
            <select
              value={settings.sceneBreakSymbol}
              onChange={(e) => setSettings({ ...settings, sceneBreakSymbol: e.target.value })}
              className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md text-sm text-slate-900 dark:text-slate-100"
            >
              <option value="***">*** (Three Asterisks)</option>
              <option value="• • •">• • • (Three Bullets)</option>
              <option value="— — —">— — — (Three Dashes)</option>
              <option value="❦">❦ (Floral Heart Ornament)</option>
            </select>
          </div>
        </div>

        <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-800">
          <div>
            {saved && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
                <CheckCircle2 className="w-4 h-4" /> Settings saved successfully
              </span>
            )}
          </div>
          <Button type="submit" variant="primary" disabled={saving}>
            <Save className="w-4 h-4 mr-1.5" /> Save Preferences
          </Button>
        </div>
      </form>
    </div>
  );
}

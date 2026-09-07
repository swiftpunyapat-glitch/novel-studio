'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { getProject, getVolumes, getChapters } from '@/lib/firebase/firestore';
import { Project, Volume, Chapter } from '@/types/project';
import { BookOpen, FileText, Layers, Hash, Send, Download } from 'lucide-react';
import { Button } from '@/components/ui/Button';

export default function ProjectOverviewPage() {
  const params = useParams();
  const projectId = params?.projectId as string;

  const [project, setProject] = useState<Project | null>(null);
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);

  useEffect(() => {
    if (!projectId) return;
    Promise.all([
      getProject(projectId),
      getVolumes(projectId),
      getChapters(projectId),
    ]).then(([proj, vols, chaps]) => {
      setProject(proj);
      setVolumes(vols);
      setChapters(chaps);
    });
  }, [projectId]);

  if (!project) return null;

  const totalWords = chapters.reduce((sum, c) => sum + (c.totalWordCount || 0), 0);

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto w-full space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{project.title}</h1>
        {project.description && (
          <p className="mt-2 text-slate-600 dark:text-slate-400">{project.description}</p>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-4">
          <div className="p-3 bg-indigo-50 dark:bg-indigo-950/50 rounded-lg text-indigo-600 dark:text-indigo-400">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Volumes</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{volumes.length}</p>
          </div>
        </div>

        <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-4">
          <div className="p-3 bg-indigo-50 dark:bg-indigo-950/50 rounded-lg text-indigo-600 dark:text-indigo-400">
            <FileText className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Chapters</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{chapters.length}</p>
          </div>
        </div>

        <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-4">
          <div className="p-3 bg-indigo-50 dark:bg-indigo-950/50 rounded-lg text-indigo-600 dark:text-indigo-400">
            <Hash className="w-6 h-6" />
          </div>
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Total Words</p>
            <p className="text-2xl font-bold text-slate-900 dark:text-white">{totalWords.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {/* Format Specification Banner */}
      <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
          Active Manuscript Specification
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs text-slate-600 dark:text-slate-400 pt-2">
          <div>
            <span className="font-semibold text-slate-900 dark:text-slate-100">Paper:</span> {project.documentSettings.paperSize} (148 × 210 mm)
          </div>
          <div>
            <span className="font-semibold text-slate-900 dark:text-slate-100">Font:</span> {project.documentSettings.bodyFont} {project.documentSettings.bodyFontSizePt}pt
          </div>
          <div>
            <span className="font-semibold text-slate-900 dark:text-slate-100">Indent:</span> First line {project.documentSettings.firstLineIndentCm} cm
          </div>
          <div>
            <span className="font-semibold text-slate-900 dark:text-slate-100">Line Spacing:</span> Multiple {project.documentSettings.lineSpacingMultiplier}
          </div>
        </div>
      </div>

      {/* Quick Chapter Navigation */}
      {chapters.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">Recent Chapters</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {chapters.slice(0, 6).map((c) => (
              <Link
                key={c.id}
                href={`/studio/projects/${projectId}/write/${c.id}`}
                className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg hover:border-indigo-500 transition-colors flex justify-between items-center"
              >
                <div>
                  <h4 className="font-semibold text-sm text-slate-900 dark:text-white">{c.title}</h4>
                  {c.subtitle && <p className="text-xs text-slate-500">{c.subtitle}</p>}
                </div>
                <span className="text-xs text-slate-400">{c.totalWordCount || 0} words</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { getProject, getVolumes, getChapters, createVolume, createChapter } from '@/lib/firebase/firestore';
import { Project, Volume, Chapter } from '@/types/project';
import { 
  FolderPlus, 
  FilePlus, 
  BookOpen, 
  Users, 
  Send, 
  Settings, 
  Download, 
  ChevronRight, 
  ChevronDown, 
  FileText, 
  Loader2 
} from 'lucide-react';
import { Button } from '@/components/ui/Button';

export default function ProjectWorkspaceLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const projectId = params?.projectId as string;

  const [project, setProject] = useState<Project | null>(null);
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedVolumes, setExpandedVolumes] = useState<Record<string, boolean>>({});

  const loadData = useCallback(async () => {
    if (!projectId) return;
    try {
      const [proj, vols, chaps] = await Promise.all([
        getProject(projectId),
        getVolumes(projectId),
        getChapters(projectId),
      ]);
      setProject(proj);
      setVolumes(vols);
      setChapters(chaps);

      // Expand all volumes by default
      const exp: Record<string, boolean> = {};
      vols.forEach((v) => {
        exp[v.id] = true;
      });
      setExpandedVolumes(exp);
    } catch (err) {
      console.error('Error loading project workspace data', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleVolume = (volId: string) => {
    setExpandedVolumes((prev) => ({ ...prev, [volId]: !prev[volId] }));
  };

  const handleAddVolume = async () => {
    if (!projectId) return;
    const volNum = volumes.length + 1;
    const title = `Volume ${volNum}`;
    const newVol = await createVolume(projectId, title, volNum, volNum);
    setVolumes((prev) => [...prev, newVol]);
    setExpandedVolumes((prev) => ({ ...prev, [newVol.id]: true }));
  };

  const handleAddChapter = async (volumeId: string) => {
    if (!projectId) return;
    const volumeChapters = chapters.filter((c) => c.volumeId === volumeId);
    const chapNum = volumeChapters.length + 1;
    const title = `Chapter ${chapNum}`;
    const { chapter } = await createChapter(projectId, volumeId, title, chapNum, chapNum);
    setChapters((prev) => [...prev, chapter]);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex-1 p-8 text-center">
        <h2 className="text-xl font-bold">Manuscript Not Found</h2>
        <Link href="/studio" className="text-indigo-600 hover:underline mt-2 inline-block">
          Return to manuscripts
        </Link>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Sidebar Navigator */}
      <aside className="w-72 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col z-20 shrink-0">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800">
          <Link href={`/studio/projects/${projectId}`} className="block">
            <h2 className="font-bold text-slate-900 dark:text-white truncate hover:text-indigo-600 transition-colors">
              {project.title}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {project.documentSettings.paperSize} • {project.documentSettings.bodyFont} {project.documentSettings.bodyFontSizePt}pt
            </p>
          </Link>
        </div>

        {/* Navigation Tree */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Structure</span>
            <button
              onClick={handleAddVolume}
              title="Add Volume"
              className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-colors"
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
          </div>

          {volumes.length === 0 ? (
            <div className="p-4 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
              <p className="text-xs text-slate-400 mb-2">No volumes yet</p>
              <Button size="sm" variant="secondary" onClick={handleAddVolume} className="w-full text-xs">
                <FolderPlus className="w-3.5 h-3.5 mr-1" /> Add Volume 1
              </Button>
            </div>
          ) : (
            volumes.map((v) => {
              const volChapters = chapters.filter((c) => c.volumeId === v.id);
              const isExpanded = !!expandedVolumes[v.id];

              return (
                <div key={v.id} className="space-y-1">
                  <div className="flex items-center justify-between group py-1 px-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors">
                    <button
                      onClick={() => toggleVolume(v.id)}
                      className="flex items-center gap-1.5 flex-1 text-left text-xs font-semibold"
                    >
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
                      <span className="truncate">{v.title}</span>
                    </button>
                    <button
                      onClick={() => handleAddChapter(v.id)}
                      title="Add Chapter"
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-indigo-600 rounded transition-opacity"
                    >
                      <FilePlus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="pl-5 space-y-0.5 border-l border-slate-200 dark:border-slate-800 ml-3">
                      {volChapters.length === 0 ? (
                        <p className="text-[11px] text-slate-400 py-1 pl-2 italic">Empty volume</p>
                      ) : (
                        volChapters.map((chap) => {
                          const isActive = pathname.includes(`/write/${chap.id}`);
                          return (
                            <Link
                              key={chap.id}
                              href={`/studio/projects/${projectId}/write/${chap.id}`}
                              className={`flex items-center gap-2 py-1.5 px-2 rounded text-xs transition-colors ${
                                isActive
                                  ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-medium'
                                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                              }`}
                            >
                              <FileText className="w-3.5 h-3.5 shrink-0 opacity-70" />
                              <span className="truncate">{chap.title}</span>
                            </Link>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Bottom Project Sections */}
        <div className="p-3 border-t border-slate-200 dark:border-slate-800 space-y-1">
          <Link
            href={`/studio/projects/${projectId}/characters`}
            className={`flex items-center gap-2 py-2 px-2.5 rounded-md text-xs font-medium transition-colors ${
              pathname.includes('/characters')
                ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Users className="w-4 h-4" /> Characters
          </Link>
          <Link
            href={`/studio/projects/${projectId}/publish`}
            className={`flex items-center gap-2 py-2 px-2.5 rounded-md text-xs font-medium transition-colors ${
              pathname.includes('/publish')
                ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Send className="w-4 h-4" /> Publishing
          </Link>
          <Link
            href={`/studio/projects/${projectId}/settings`}
            className={`flex items-center gap-2 py-2 px-2.5 rounded-md text-xs font-medium transition-colors ${
              pathname.includes('/settings')
                ? 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Settings className="w-4 h-4" /> Document Format
          </Link>
        </div>
      </aside>

      {/* Main Content Pane */}
      <main className="flex-1 flex flex-col overflow-hidden bg-slate-100 dark:bg-slate-950">
        {children}
      </main>
    </div>
  );
}

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/firebase/auth';
import { ExportDialog } from '@/components/editor/ExportDialog';
import { DeleteSectionDialog } from '@/components/editor/DeleteSectionDialog';
import { getProject, getVolumes, getChapters, createVolume, createChapter } from '@/lib/firebase/firestore';
import { Project, Volume, Chapter, ChapterType, resolveChapterType } from '@/types/project';
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
  Loader2,
  Trash2
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export default function ProjectWorkspaceLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const projectId = params?.projectId as string;
  // The export dialog defaults to whatever chapter is open in the editor.
  const currentChapterId = pathname.match(/\/write\/([^/]+)/)?.[1];

  const [project, setProject] = useState<Project | null>(null);
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedVolumes, setExpandedVolumes] = useState<Record<string, boolean>>({});
  const [exportOpen, setExportOpen] = useState(false);
  const [showAddSectionModal, setShowAddSectionModal] = useState(false);
  const [targetVolumeId, setTargetVolumeId] = useState<string | null>(null);
  const [sectionType, setSectionType] = useState<ChapterType>('chapter');
  const [sectionTitle, setSectionTitle] = useState('');
  const [creatingSection, setCreatingSection] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: 'chapter'; chapter: Chapter } | { kind: 'volume'; volume: Volume } | null
  >(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { user } = useAuth();
  const router = useRouter();

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

  const getNextChapterNumber = useCallback(
    (volumeId: string) => {
      const maxNum = chapters
        .filter(
          (c) =>
            c.volumeId === volumeId &&
            resolveChapterType(c) === 'chapter' &&
            c.chapterNumber !== null &&
            c.chapterNumber !== undefined
        )
        .reduce((max, c) => Math.max(max, c.chapterNumber as number), 0);
      return maxNum + 1;
    },
    [chapters]
  );

  const handleOpenAddSection = (volumeId: string) => {
    setTargetVolumeId(volumeId);
    setSectionType('chapter');
    const nextNum = getNextChapterNumber(volumeId);
    setSectionTitle(`Chapter ${nextNum}`);
    setShowAddSectionModal(true);
  };

  const handleSectionTypeChange = (newType: ChapterType) => {
    setSectionType(newType);
    if (newType === 'prologue') {
      setSectionTitle('Prologue');
    } else if (newType === 'epilogue') {
      setSectionTitle('Epilogue');
    } else {
      const nextNum = targetVolumeId ? getNextChapterNumber(targetVolumeId) : 1;
      setSectionTitle(`Chapter ${nextNum}`);
    }
  };

  const handleCreateSection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !targetVolumeId || !sectionTitle.trim()) return;

    setCreatingSection(true);
    try {
      const volumeChapters = chapters.filter((c) => c.volumeId === targetVolumeId);
      const order = volumeChapters.length + 1;
      const chapNum = sectionType === 'chapter' ? getNextChapterNumber(targetVolumeId) : null;

      const { chapter } = await createChapter(
        projectId,
        targetVolumeId,
        sectionTitle.trim(),
        chapNum,
        order,
        sectionType
      );

      setChapters((prev) => [...prev, chapter]);
      setExpandedVolumes((prev) => ({ ...prev, [targetVolumeId]: true }));
      setShowAddSectionModal(false);
    } catch (err) {
      console.error('Failed to create section', err);
    } finally {
      setCreatingSection(false);
    }
  };

  /**
   * Deletion is server-side. The client never removes documents itself: the
   * route holds the ownership check and the cascade, and the sidebar only
   * reflects a deletion the server confirmed. A failed call therefore leaves
   * the tree exactly as it was, which is the honest picture — the chapter is
   * still there.
   */
  const handleConfirmDelete = async (confirmationTitle: string) => {
    if (!user || !projectId || !deleteTarget) return;

    setDeleting(true);
    setDeleteError(null);
    try {
      const token = await user.getIdToken();
      const url =
        deleteTarget.kind === 'chapter'
          ? `/api/projects/${projectId}/chapters/${deleteTarget.chapter.id}`
          : `/api/projects/${projectId}/volumes/${deleteTarget.volume.id}`;

      // The typed title travels with the request: the server refuses to
      // delete anything until it matches the title it has stored.
      const res = await fetch(url, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirmationTitle }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          data.error ||
            (deleteTarget.kind === 'chapter'
              ? 'Could not delete this chapter.'
              : 'Could not delete this volume.')
        );
      }

      const removedChapterIds =
        deleteTarget.kind === 'chapter'
          ? [deleteTarget.chapter.id]
          : chapters.filter((c) => c.volumeId === deleteTarget.volume.id).map((c) => c.id);

      setChapters((prev) => prev.filter((c) => !removedChapterIds.includes(c.id)));
      if (deleteTarget.kind === 'volume') {
        setVolumes((prev) => prev.filter((v) => v.id !== deleteTarget.volume.id));
      }

      setDeleteTarget(null);

      // Leaving the reader on a route whose chapter no longer exists would show
      // "Chapter draft not found or deleted"; send them somewhere real instead.
      if (currentChapterId && removedChapterIds.includes(currentChapterId)) {
        router.replace(`/studio/projects/${projectId}`);
      }
    } catch (err) {
      console.error('Section deletion failed', err);
      setDeleteError(
        err instanceof Error ? err.message : 'Could not delete this section.'
      );
    } finally {
      setDeleting(false);
    }
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
    <div className="flex-1 min-h-0 flex overflow-hidden">
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
                    <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleOpenAddSection(v.id)}
                        title="Add Section (Prologue, Chapter, Epilogue)"
                        className="p-1 text-slate-400 hover:text-indigo-600 rounded"
                      >
                        <FilePlus className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteTarget({ kind: 'volume', volume: v });
                        }}
                        title="Delete Volume and every chapter in it"
                        aria-label={`Delete volume ${v.title}`}
                        className="p-1 text-slate-400 hover:text-red-600 rounded"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="pl-5 space-y-0.5 border-l border-slate-200 dark:border-slate-800 ml-3">
                      {volChapters.length === 0 ? (
                        <p className="text-[11px] text-slate-400 py-1 pl-2 italic">Empty volume</p>
                      ) : (
                        volChapters.map((chap) => {
                          const isActive = pathname.includes(`/write/${chap.id}`);
                          const cType = resolveChapterType(chap);

                          return (
                            <div
                              key={chap.id}
                              className={`group/chapter flex items-center rounded transition-colors ${
                                isActive
                                  ? 'bg-indigo-50 dark:bg-indigo-950/60'
                                  : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                              }`}
                            >
                            <Link
                              href={`/studio/projects/${projectId}/write/${chap.id}`}
                              className={`flex items-center gap-2 py-1.5 px-2 rounded text-xs transition-colors flex-1 min-w-0 ${
                                isActive
                                  ? 'text-indigo-600 dark:text-indigo-400 font-medium'
                                  : 'text-slate-600 dark:text-slate-400'
                              }`}
                            >
                              {cType === 'prologue' ? (
                                <span className="px-1 py-0.2 rounded text-[9px] font-bold uppercase bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 shrink-0">
                                  Prologue
                                </span>
                              ) : cType === 'epilogue' ? (
                                <span className="px-1 py-0.2 rounded text-[9px] font-bold uppercase bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-400 border border-purple-200 dark:border-purple-800 shrink-0">
                                  Epilogue
                                </span>
                              ) : (
                                <FileText className="w-3.5 h-3.5 shrink-0 opacity-70" />
                              )}
                              <span className="truncate">{chap.title}</span>
                            </Link>
                            <button
                              onClick={() => {
                                setDeleteError(null);
                                setDeleteTarget({ kind: 'chapter', chapter: chap });
                              }}
                              title="Delete Chapter"
                              aria-label={`Delete ${chap.title}`}
                              className="opacity-0 group-hover/chapter:opacity-100 p-1 mr-1 text-slate-400 hover:text-red-600 rounded transition-opacity shrink-0"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                            </div>
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

          <button
            type="button"
            onClick={() => setExportOpen(true)}
            disabled={!user || chapters.length === 0}
            title={
              chapters.length === 0
                ? 'Create a chapter before exporting'
                : 'Export the manuscript to Word (.docx)'
            }
            className="w-full flex items-center gap-2 py-2 px-2.5 rounded-md text-xs font-medium transition-colors text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" /> Export to Word
          </button>
        </div>
      </aside>

      {exportOpen && project && user && (
        <ExportDialog
          project={project}
          chapters={chapters}
          volumes={volumes}
          currentChapterId={currentChapterId}
          getIdToken={() => user.getIdToken()}
          onClose={() => setExportOpen(false)}
        />
      )}

      {deleteTarget && (
        <DeleteSectionDialog
          kind={deleteTarget.kind}
          title={
            deleteTarget.kind === 'chapter'
              ? deleteTarget.chapter.title
              : deleteTarget.volume.title
          }
          chapterTitles={
            deleteTarget.kind === 'volume'
              ? chapters
                  .filter((c) => c.volumeId === deleteTarget.volume.id)
                  .map((c) => c.title)
              : undefined
          }
          busy={deleting}
          error={deleteError}
          onConfirm={handleConfirmDelete}
          onClose={() => {
            setDeleteTarget(null);
            setDeleteError(null);
          }}
        />
      )}

      {/* Add Section Modal */}
      {showAddSectionModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-sm w-full p-5 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Add Section
            </h3>

            <form onSubmit={handleCreateSection} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                  Section Type
                </label>
                <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs font-medium">
                  {(['prologue', 'chapter', 'epilogue'] as ChapterType[]).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => handleSectionTypeChange(type)}
                      className={`py-1.5 rounded capitalize transition-colors ${
                        sectionType === type
                          ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm font-semibold'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <Input
                label="Section Title"
                value={sectionTitle}
                onChange={(e) => setSectionTitle(e.target.value)}
                placeholder="e.g. Prologue, Chapter 1..."
                required
                autoFocus
              />

              <p className="text-[11px] text-slate-400">
                {sectionType === 'chapter'
                  ? `Numbered as Chapter ${targetVolumeId ? getNextChapterNumber(targetVolumeId) : 1} (in this volume).`
                  : `${sectionType === 'prologue' ? 'Prologue' : 'Epilogue'} has no chapter number.`}
              </p>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAddSectionModal(false)}
                  disabled={creatingSection}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={creatingSection || !sectionTitle.trim()}
                >
                  {creatingSection ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Create Section'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Main Content Pane */}
      <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden bg-slate-100 dark:bg-slate-950">
        {children}
      </main>
    </div>
  );
}

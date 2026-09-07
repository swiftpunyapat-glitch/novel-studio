'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/firebase/auth';
import { getProjects, createProject } from '@/lib/firebase/firestore';
import { Project, DEFAULT_DOCUMENT_SETTINGS } from '@/types/project';
import { BookPlus, Book, Loader2, PenLine, MoreVertical, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export default function StudioDashboard() {
  const { user, loading: authLoading } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);

  // Delete manuscript state
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [deleteConfirmTitle, setDeleteConfirmTitle] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    const handleClickOutside = () => setOpenMenuId(null);
    if (openMenuId) {
      window.addEventListener('click', handleClickOutside);
      return () => window.removeEventListener('click', handleClickOutside);
    }
  }, [openMenuId]);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    getProjects(user.uid)
      .then((res) => {
        setProjects(res);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load projects', err);
        setLoading(false);
      });
  }, [user]);

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newTitle.trim()) return;

    setCreating(true);
    try {
      const proj = await createProject(user.uid, newTitle.trim(), newDesc.trim());
      setProjects((prev) => [proj, ...prev]);
      setShowCreateModal(false);
      setNewTitle('');
      setNewDesc('');
    } catch (err) {
      console.error('Error creating project', err);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !projectToDelete) return;
    if (deleteConfirmTitle.trim() !== projectToDelete.title.trim()) return;

    setDeleting(true);
    setDeleteError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/projects/${projectToDelete.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete manuscript');
      }

      setProjects((prev) => prev.filter((p) => p.id !== projectToDelete.id));
      setProjectToDelete(null);
      setDeleteConfirmTitle('');
    } catch (err: any) {
      console.error('Error deleting project', err);
      setDeleteError(err.message || 'Failed to delete manuscript');
    } finally {
      setDeleting(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md bg-white dark:bg-slate-900 p-8 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
          <Book className="w-12 h-12 text-indigo-600 mx-auto" />
          <h2 className="text-xl font-bold">Author Workspace</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Please sign in to access your private manuscripts, drafts, and characters.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 max-w-6xl mx-auto w-full space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Manuscripts</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Manage your books, drafts, and publications</p>
        </div>
        <Button variant="primary" onClick={() => setShowCreateModal(true)}>
          <BookPlus className="w-4 h-4 mr-2" /> New Novel
        </Button>
      </div>

      {projects.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-900 rounded-xl border border-dashed border-slate-300 dark:border-slate-800 p-8 space-y-4">
          <PenLine className="w-12 h-12 text-slate-400 mx-auto" />
          <h3 className="text-lg font-medium text-slate-700 dark:text-slate-200">No manuscripts yet</h3>
          <p className="text-sm text-slate-500 max-w-sm mx-auto">
            Create your first novel project to start writing with A5 formatting, volumes, and draft variants.
          </p>
          <Button variant="primary" onClick={() => setShowCreateModal(true)}>
            <BookPlus className="w-4 h-4 mr-2" /> Start Writing
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects.map((p) => (
            <div
              key={p.id}
              className="relative bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-indigo-500 dark:hover:border-indigo-500 transition-all group flex flex-col justify-between"
            >
              <Link
                href={`/studio/projects/${p.id}`}
                className="block p-5 flex-1"
              >
                <div className="flex items-start justify-between pr-8">
                  <div className="space-y-1">
                    <h3 className="font-bold text-lg text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                      {p.title}
                    </h3>
                    <p className="text-xs text-slate-400">
                      Format: {p.documentSettings.paperSize} • {p.documentSettings.bodyFont} {p.documentSettings.bodyFontSizePt}pt
                    </p>
                  </div>
                </div>
                {p.description && (
                  <p className="mt-3 text-sm text-slate-600 dark:text-slate-400 line-clamp-2">
                    {p.description}
                  </p>
                )}
              </Link>

              {/* Top-right menu button */}
              <div className="absolute top-4 right-4 z-10">
                <div className="relative">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setOpenMenuId(openMenuId === p.id ? null : p.id);
                    }}
                    className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    title="Manuscript actions"
                    aria-label="Manuscript options"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>

                  {openMenuId === p.id && (
                    <div
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl py-1 z-30"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setOpenMenuId(null);
                          setProjectToDelete(p);
                          setDeleteConfirmTitle('');
                          setDeleteError(null);
                        }}
                        className="w-full px-3 py-1.5 text-left text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 flex items-center gap-2 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete Manuscript
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {projectToDelete && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
              <div className="p-2 bg-red-100 dark:bg-red-950/60 rounded-full">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                Delete Manuscript
              </h3>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              This action cannot be undone. This will permanently delete the manuscript{' '}
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                &ldquo;{projectToDelete.title}&rdquo;
              </span>
              , including all volumes, chapters, draft variants, revisions, characters, files, and published snapshots.
            </p>

            <form onSubmit={handleDeleteProject} className="space-y-4 pt-1">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  To confirm, type the exact manuscript title: <span className="font-mono text-indigo-600 dark:text-indigo-400 select-all">{projectToDelete.title}</span>
                </label>
                <Input
                  value={deleteConfirmTitle}
                  onChange={(e) => setDeleteConfirmTitle(e.target.value)}
                  placeholder={projectToDelete.title}
                  autoFocus
                  required
                />
              </div>

              {deleteError && (
                <p className="text-xs text-red-600 dark:text-red-400 font-medium">
                  {deleteError}
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setProjectToDelete(null);
                    setDeleteConfirmTitle('');
                    setDeleteError(null);
                  }}
                  disabled={deleting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="danger"
                  size="sm"
                  disabled={
                    deleting ||
                    deleteConfirmTitle.trim() !== projectToDelete.title.trim()
                  }
                >
                  {deleting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                  )}
                  Delete Manuscript
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Create New Novel</h3>
            <form onSubmit={handleCreateProject} className="space-y-4">
              <Input
                label="Novel Title"
                placeholder="e.g. REDLINE LOVE"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                required
                autoFocus
              />
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1">
                  Synopsis / Description
                </label>
                <textarea
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
                  rows={3}
                  placeholder="Optional brief description..."
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                />
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg text-xs text-slate-500 space-y-1">
                <p className="font-semibold text-slate-700 dark:text-slate-300">Default Manuscript Settings:</p>
                <p>• Size: A5 (148 × 210 mm) with 20mm margins</p>
                <p>• Body: {DEFAULT_DOCUMENT_SETTINGS.bodyFont} {DEFAULT_DOCUMENT_SETTINGS.bodyFontSizePt}pt, Left-aligned</p>
                <p>• Indentation: First-line 0.5 cm</p>
                <p>• Line Spacing: Multiple 1.08</p>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={creating || !newTitle.trim()}>
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Create Novel'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/firebase/auth';
import { getProjects, createProject } from '@/lib/firebase/firestore';
import { Project } from '@/types/project';
import { BookPlus, Book, ArrowRight, Loader2, PenLine } from 'lucide-react';
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
            <Link
              key={p.id}
              href={`/studio/projects/${p.id}`}
              className="block p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm hover:border-indigo-500 dark:hover:border-indigo-500 transition-all group"
            >
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <h3 className="font-bold text-lg text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                    {p.title}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Format: {p.documentSettings.paperSize} • {p.documentSettings.bodyFont} {p.documentSettings.bodyFontSizePt}pt
                  </p>
                </div>
                <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-indigo-600 group-hover:translate-x-1 transition-all" />
              </div>
              {p.description && (
                <p className="mt-3 text-sm text-slate-600 dark:text-slate-400 line-clamp-2">
                  {p.description}
                </p>
              )}
            </Link>
          ))}
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
                <p>• Body: Sarabun 16pt, Left-aligned</p>
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

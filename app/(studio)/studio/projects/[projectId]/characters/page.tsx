'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { getCharacters, createCharacter } from '@/lib/firebase/firestore';
import { Character } from '@/types/character';
import { Users, UserPlus, Shield, Sparkles, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export default function CharactersPage() {
  const params = useParams();
  const projectId = params?.projectId as string;

  const [characters, setCharacters] = useState<Character[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [creating, setCreating] = useState(false);

  // Form fields
  const [name, setName] = useState('');
  const [role, setRole] = useState<Character['role']>('protagonist');
  const [appearance, setAppearance] = useState('');
  const [personality, setPersonality] = useState('');
  const [biography, setBiography] = useState('');
  const [writerNotes, setWriterNotes] = useState('');

  const loadData = useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await getCharacters(projectId);
      setCharacters(data);
    } catch (err) {
      console.error('Error loading characters', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateCharacter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !name.trim()) return;
    setCreating(true);
    try {
      const created = await createCharacter(projectId, {
        name: name.trim(),
        aliases: [],
        role,
        description: '',
        appearance: appearance.trim(),
        personality: personality.trim(),
        biography: biography.trim(),
        relationships: [],
        writerNotes: writerNotes.trim(),
      });
      setCharacters((prev) => [...prev, created]);
      setShowModal(false);
      setName('');
      setAppearance('');
      setPersonality('');
      setBiography('');
      setWriterNotes('');
    } catch (err) {
      console.error('Error creating character', err);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto w-full space-y-8">
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Users className="w-6 h-6 text-indigo-600" /> Character Dossiers
          </h1>
          <p className="text-sm text-slate-500">
            Private character profiles, appearance notes, and confidential writer notes
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowModal(true)}>
          <UserPlus className="w-4 h-4 mr-1.5" /> Add Character
        </Button>
      </div>

      {characters.length === 0 ? (
        <div className="text-center py-16 bg-white dark:bg-slate-900 rounded-xl border border-dashed border-slate-300 dark:border-slate-800 p-8 space-y-4">
          <Users className="w-12 h-12 text-slate-400 mx-auto" />
          <h3 className="text-lg font-medium text-slate-700 dark:text-slate-200">No characters recorded</h3>
          <p className="text-sm text-slate-500 max-w-sm mx-auto">
            Build your cast with roles, appearance details, and secret notes that never leak to readers.
          </p>
          <Button variant="primary" onClick={() => setShowModal(true)}>
            <UserPlus className="w-4 h-4 mr-1.5" /> Create Character
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {characters.map((char) => (
            <div
              key={char.id}
              className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">{char.name}</h3>
                  <span className="inline-block mt-0.5 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                    {char.role}
                  </span>
                </div>
              </div>

              {char.appearance && (
                <div className="text-xs space-y-0.5">
                  <span className="font-semibold text-slate-500 uppercase tracking-wider">Appearance:</span>
                  <p className="text-slate-700 dark:text-slate-300">{char.appearance}</p>
                </div>
              )}

              {char.personality && (
                <div className="text-xs space-y-0.5">
                  <span className="font-semibold text-slate-500 uppercase tracking-wider">Personality:</span>
                  <p className="text-slate-700 dark:text-slate-300">{char.personality}</p>
                </div>
              )}

              {char.writerNotes && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded-lg text-xs space-y-1">
                  <span className="font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1">
                    <Shield className="w-3 h-3" /> Private Writer Notes:
                  </span>
                  <p className="text-amber-900 dark:text-amber-300">{char.writerNotes}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-lg w-full p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Add Character Dossier</h3>
            <form onSubmit={handleCreateCharacter} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label="Name"
                  placeholder="e.g. เรย์ (Ray)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                    Role
                  </label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value as any)}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md text-sm text-slate-900 dark:text-slate-100"
                  >
                    <option value="protagonist">Protagonist</option>
                    <option value="antagonist">Antagonist</option>
                    <option value="supporting">Supporting</option>
                    <option value="minor">Minor</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Appearance
                </label>
                <textarea
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md text-sm"
                  rows={2}
                  placeholder="Physical traits, clothes, height, distinctive marks..."
                  value={appearance}
                  onChange={(e) => setAppearance(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">
                  Personality
                </label>
                <textarea
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md text-sm"
                  rows={2}
                  placeholder="Habits, motivations, speech patterns..."
                  value={personality}
                  onChange={(e) => setPersonality(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-1">
                  Writer Notes (Strictly Private)
                </label>
                <textarea
                  className="w-full px-3 py-2 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-800 rounded-md text-sm"
                  rows={2}
                  placeholder="Plot secrets, future reveals, character twists..."
                  value={writerNotes}
                  onChange={(e) => setWriterNotes(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={() => setShowModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={creating || !name.trim()}>
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save Character'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

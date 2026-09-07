'use client';

import React, { useState } from 'react';
import { Chapter } from '@/types/project';
import { updateChapterMetadata } from '@/lib/firebase/firestore';

interface ChapterMetadataHeaderProps {
  chapter: Chapter;
  projectId: string;
  onUpdate?: (updated: Partial<Chapter>) => void;
}

export const ChapterMetadataHeader: React.FC<ChapterMetadataHeaderProps> = ({
  chapter,
  projectId,
  onUpdate,
}) => {
  const [title, setTitle] = useState(chapter.title || '');
  const [subtitle, setSubtitle] = useState(chapter.subtitle || '');
  const [chapterNum, setChapterNum] = useState<string>(
    chapter.chapterNumber !== null ? String(chapter.chapterNumber) : ''
  );
  const [dateText, setDateText] = useState(chapter.dateText || '');
  const [locationText, setLocationText] = useState(chapter.locationText || '');

  const saveHeader = async () => {
    const num = chapterNum.trim() === '' ? null : parseInt(chapterNum, 10);
    const payload = {
      title: title.trim() || 'Untitled Chapter',
      subtitle: subtitle.trim() || undefined,
      chapterNumber: isNaN(num as number) ? null : num,
      dateText: dateText.trim() || undefined,
      locationText: locationText.trim() || undefined,
    };
    await updateChapterMetadata(projectId, chapter.id, payload);
    onUpdate?.(payload);
  };

  return (
    <div className="mb-10 text-center border-b border-slate-200/60 dark:border-slate-800/60 pb-8 space-y-3 select-none">
      {/* Chapter Number */}
      <div className="flex justify-center">
        <input
          type="text"
          placeholder="CHAPTER NUMBER (e.g. 1)"
          value={chapterNum ? `CHAPTER ${chapterNum}` : ''}
          onChange={(e) => {
            const raw = e.target.value.replace(/CHAPTER\s*/i, '');
            setChapterNum(raw);
          }}
          onBlur={saveHeader}
          className="text-xs font-bold uppercase tracking-widest text-slate-400 bg-transparent text-center focus:outline-none focus:text-indigo-600 transition-colors w-64"
        />
      </div>

      {/* Chapter Title */}
      <div>
        <input
          type="text"
          placeholder="Chapter Title..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveHeader}
          className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white bg-transparent text-center w-full focus:outline-none focus:ring-1 focus:ring-indigo-500/30 rounded px-2"
        />
      </div>

      {/* Subtitle */}
      <div>
        <input
          type="text"
          placeholder="Optional Subtitle / Epigraph..."
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
          onBlur={saveHeader}
          className="text-sm italic text-slate-500 bg-transparent text-center w-full focus:outline-none focus:ring-1 focus:ring-indigo-500/30 rounded px-2"
        />
      </div>

      {/* Date & Location Context */}
      <div className="flex items-center justify-center gap-4 text-xs text-slate-400 pt-1">
        <input
          type="text"
          placeholder="Timeline (e.g. 20 กันยายน 2568)"
          value={dateText}
          onChange={(e) => setDateText(e.target.value)}
          onBlur={saveHeader}
          className="bg-transparent text-center focus:outline-none focus:text-slate-600 dark:focus:text-slate-200 w-44"
        />
        <span>•</span>
        <input
          type="text"
          placeholder="Location (e.g. ลาดพร้าว 101)"
          value={locationText}
          onChange={(e) => setLocationText(e.target.value)}
          onBlur={saveHeader}
          className="bg-transparent text-center focus:outline-none focus:text-slate-600 dark:focus:text-slate-200 w-44"
        />
      </div>
    </div>
  );
};

import { describe, expect, test } from 'vitest';
import { resolveChapterType, type Chapter, type ChapterType } from '@/types/project';

describe('Section Types & Numbering Rules', () => {
  test('resolveChapterType treats undefined as chapter for backward compatibility', () => {
    const legacyChapter = { id: 'c1', title: 'Chapter 1' } as Chapter;
    expect(resolveChapterType(legacyChapter)).toBe('chapter');
    expect(resolveChapterType(null)).toBe('chapter');
    expect(resolveChapterType(undefined)).toBe('chapter');
  });

  test('resolveChapterType preserves explicit section types', () => {
    const prologue = { chapterType: 'prologue' as ChapterType };
    const chapter = { chapterType: 'chapter' as ChapterType };
    const epilogue = { chapterType: 'epilogue' as ChapterType };

    expect(resolveChapterType(prologue)).toBe('prologue');
    expect(resolveChapterType(chapter)).toBe('chapter');
    expect(resolveChapterType(epilogue)).toBe('epilogue');
  });

  test('prologue and epilogue do not increment sequential chapter numbering', () => {
    const sections: Array<Partial<Chapter>> = [
      { id: 'sec-prologue', title: 'Prologue', chapterType: 'prologue', chapterNumber: null },
      { id: 'sec-ch1', title: 'Chapter 1', chapterType: 'chapter', chapterNumber: 1 },
      { id: 'sec-ch2', title: 'Chapter 2', chapterType: 'chapter', chapterNumber: 2 },
      { id: 'sec-epilogue', title: 'Epilogue', chapterType: 'epilogue', chapterNumber: null },
    ];

    // Formula used in layout.tsx to determine next chapter number:
    const highestChapterNumber = sections
      .filter((s) => resolveChapterType(s as Chapter) === 'chapter' && s.chapterNumber !== null && s.chapterNumber !== undefined)
      .reduce((max, s) => Math.max(max, s.chapterNumber as number), 0);

    expect(highestChapterNumber).toBe(2);
    const nextChapterNumber = highestChapterNumber + 1;
    expect(nextChapterNumber).toBe(3);

    // If only a prologue exists:
    const prologueOnly: Array<Partial<Chapter>> = [
      { id: 'sec-prologue', title: 'Prologue', chapterType: 'prologue', chapterNumber: null },
    ];
    const firstChapterNumber = prologueOnly
      .filter((s) => resolveChapterType(s as Chapter) === 'chapter' && s.chapterNumber !== null && s.chapterNumber !== undefined)
      .reduce((max, s) => Math.max(max, s.chapterNumber as number), 0) + 1;

    expect(firstChapterNumber).toBe(1);
  });
});

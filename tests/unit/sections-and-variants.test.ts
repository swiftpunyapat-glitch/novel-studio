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

  test('regression: chapter numbering is per-volume so Volume 2 starts again at Chapter 1', () => {
    const chapters: Array<Partial<Chapter>> = [
      // Volume 1
      { id: 'v1-prologue', volumeId: 'vol-1', title: 'Prologue', chapterType: 'prologue', chapterNumber: null },
      { id: 'v1-ch1', volumeId: 'vol-1', title: 'Chapter 1', chapterType: 'chapter', chapterNumber: 1 },
      { id: 'v1-ch2', volumeId: 'vol-1', title: 'Chapter 2', chapterType: 'chapter', chapterNumber: 2 },
      { id: 'v1-epilogue', volumeId: 'vol-1', title: 'Epilogue', chapterType: 'epilogue', chapterNumber: null },
      // Legacy chapter without chapterType in Volume 1
      { id: 'v1-ch3', volumeId: 'vol-1', title: 'Chapter 3', chapterNumber: 3 },

      // Volume 2 (currently only has a prologue)
      { id: 'v2-prologue', volumeId: 'vol-2', title: 'Prologue', chapterType: 'prologue', chapterNumber: null },
    ];

    const getNextChapterNumber = (volumeId: string) => {
      const maxNum = chapters
        .filter(
          (c) =>
            c.volumeId === volumeId &&
            resolveChapterType(c as Chapter) === 'chapter' &&
            c.chapterNumber !== null &&
            c.chapterNumber !== undefined
        )
        .reduce((max, c) => Math.max(max, c.chapterNumber as number), 0);
      return maxNum + 1;
    };

    // Volume 1 next chapter number should be 4
    expect(getNextChapterNumber('vol-1')).toBe(4);

    // Volume 2 next chapter number must start at Chapter 1, despite Volume 1 having 3 chapters
    expect(getNextChapterNumber('vol-2')).toBe(1);

    // Add Chapter 1 to Volume 2
    chapters.push({
      id: 'v2-ch1',
      volumeId: 'vol-2',
      title: 'Chapter 1',
      chapterType: 'chapter',
      chapterNumber: 1,
    });

    // Volume 2 next chapter number should now be 2
    expect(getNextChapterNumber('vol-2')).toBe(2);
  });
});

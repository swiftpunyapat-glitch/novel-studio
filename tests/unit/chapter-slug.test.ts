import { describe, expect, test } from 'vitest';
import {
  allocateChapterSlug,
  chapterPath,
  preferredChapterSlug,
  resolveChapterSlug,
} from '@/lib/publishing/chapter-slug';
import { chapterEyebrow } from '@/components/reader/ContinuousReader';

describe('A chapter slug is readable, and derived from the title', () => {
  test('the author title becomes the slug', () => {
    expect(preferredChapterSlug({ title: 'The Long Road', chapterNumber: 5 })).toBe(
      'the-long-road'
    );
  });

  test('a Thai title survives into the URL', () => {
    expect(preferredChapterSlug({ title: 'เสียงจากลาดพร้าว', chapterNumber: 1 })).toBe(
      'เสียงจากลาดพร้าว'
    );
  });

  test('an untitled numbered chapter falls back to its number', () => {
    expect(preferredChapterSlug({ title: '', chapterNumber: 5 })).toBe('chapter-5');
  });

  test('a prologue and an epilogue fall back to what they are', () => {
    expect(preferredChapterSlug({ title: '', chapterType: 'prologue' })).toBe('prologue');
    expect(preferredChapterSlug({ title: '', chapterType: 'epilogue' })).toBe('epilogue');
  });

  test('a title of only punctuation does not become an unreadable digest', () => {
    // makeSlug falls back to `novel-<digest>`, which is exactly the opaque
    // thing a slug exists to avoid.
    expect(preferredChapterSlug({ title: '///', chapterNumber: 3 })).toBe('chapter-3');
  });
});

describe('Two chapters never claim the same address', () => {
  test('a free slug is used as is', () => {
    expect(allocateChapterSlug({ title: 'Redline' }, [])).toBe('redline');
  });

  test('a taken slug gets a suffix', () => {
    expect(allocateChapterSlug({ title: 'Redline' }, ['redline'])).toBe('redline-2');
    expect(allocateChapterSlug({ title: 'Redline' }, ['redline', 'redline-2'])).toBe(
      'redline-3'
    );
  });

  test('two identically titled chapters get different addresses', () => {
    const first = allocateChapterSlug({ title: 'บทเปิด' }, []);
    const second = allocateChapterSlug({ title: 'บทเปิด' }, [first]);
    expect(first).not.toBe(second);
  });
});

describe('A slug is assigned once and then left alone', () => {
  test('an existing slug is returned untouched, even if the title changed', () => {
    const result = resolveChapterSlug(
      { slug: 'the-original-title', title: 'A Completely New Title' },
      []
    );
    expect(result).toEqual({ slug: 'the-original-title', isNew: false });
  });

  test('a chapter without a slug is given one, and flagged as new', () => {
    const result = resolveChapterSlug({ title: 'Redline' }, []);
    expect(result).toEqual({ slug: 'redline', isNew: true });
  });

  test('a blank stored slug is treated as absent', () => {
    expect(resolveChapterSlug({ slug: '   ', title: 'Redline' }, []).isNew).toBe(true);
  });

  test('renaming a published chapter cannot move its URL', () => {
    // The published address is whatever was stored the first time.
    const assigned = resolveChapterSlug({ title: 'First Name' }, []).slug;
    const afterRename = resolveChapterSlug({ slug: assigned, title: 'Second Name' }, []).slug;
    expect(afterRename).toBe(assigned);
  });
});

describe('Chapter paths', () => {
  test('a path is built from the three slugs', () => {
    expect(chapterPath('redline-love', 'volume-1', 'the-long-road')).toBe(
      '/read/redline-love/volume-1/the-long-road'
    );
  });

  test('Thai slugs are percent-encoded for the URL', () => {
    const path = chapterPath('redline-love', 'volume-1', 'เสียงจากลาดพร้าว');
    expect(path.startsWith('/read/redline-love/volume-1/')).toBe(true);
    expect(decodeURIComponent(path.split('/').pop()!)).toBe('เสียงจากลาดพร้าว');
  });
});

describe('Prologue and epilogue are labelled as such', () => {
  test('a prologue says PROLOGUE, not an empty chapter line', () => {
    expect(chapterEyebrow({ chapterType: 'prologue', chapterNumber: null })).toBe('PROLOGUE');
  });

  test('an epilogue says EPILOGUE', () => {
    expect(chapterEyebrow({ chapterType: 'epilogue', chapterNumber: null })).toBe('EPILOGUE');
  });

  test('a numbered chapter is unchanged', () => {
    expect(chapterEyebrow({ chapterType: 'chapter', chapterNumber: 5 })).toBe('CHAPTER 5');
  });

  test('a chapter with no number and no type shows no label', () => {
    expect(chapterEyebrow({ chapterType: 'chapter', chapterNumber: null })).toBeNull();
  });

  test('a missing type is treated as a chapter', () => {
    expect(chapterEyebrow({ chapterNumber: 2 })).toBe('CHAPTER 2');
  });

  test('the label wins over the number for a prologue', () => {
    // A prologue should never be announced as "CHAPTER 0".
    expect(chapterEyebrow({ chapterType: 'prologue', chapterNumber: 0 })).toBe('PROLOGUE');
  });
});

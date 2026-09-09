import { describe, expect, test } from 'vitest';
import {
  chaptersAfter,
  indexOfChapter,
  isValidPublicSlug,
  sortChaptersForReading,
} from '@/lib/publishing/reading-order';

/**
 * Reading order matters more once reading is continuous: a wrong "next" used to
 * be a click the reader could correct, and is now prose that simply runs into
 * the wrong chapter.
 */

const volumes = [
  { id: 'v1', order: 0 },
  { id: 'v2', order: 1 },
];

const chapter = (id: string, volumeId: string, order: number) => ({ id, volumeId, order });

describe('Chapters sort by volume, then within the volume', () => {
  test('two volumes both starting at order 1 do not interleave', () => {
    // This is the bug continuous reading would otherwise expose: chapter order
    // restarts in every volume, so sorting by it alone mixes the books.
    const chapters = [
      chapter('v2c1', 'v2', 1),
      chapter('v1c1', 'v1', 1),
      chapter('v2c2', 'v2', 2),
      chapter('v1c2', 'v1', 2),
    ];
    expect(sortChaptersForReading(chapters, volumes).map((c) => c.id)).toEqual([
      'v1c1',
      'v1c2',
      'v2c1',
      'v2c2',
    ]);
  });

  test('volume order decides, not volume id', () => {
    const reversed = [
      { id: 'alpha', order: 1 },
      { id: 'beta', order: 0 },
    ];
    const chapters = [chapter('a', 'alpha', 1), chapter('b', 'beta', 1)];
    expect(sortChaptersForReading(chapters, reversed).map((c) => c.id)).toEqual(['b', 'a']);
  });

  test('a chapter in an unknown volume sorts last rather than first', () => {
    const chapters = [chapter('orphan', 'gone', 1), chapter('v1c1', 'v1', 1)];
    expect(sortChaptersForReading(chapters, volumes).map((c) => c.id)).toEqual([
      'v1c1',
      'orphan',
    ]);
  });

  test('a missing order sorts last instead of jumping to the front', () => {
    const chapters = [
      { id: 'noOrder', volumeId: 'v1' },
      chapter('first', 'v1', 1),
    ];
    expect(sortChaptersForReading(chapters, volumes).map((c) => c.id)).toEqual([
      'first',
      'noOrder',
    ]);
  });

  test('ties break on id so the order is stable across requests', () => {
    const chapters = [chapter('b', 'v1', 1), chapter('a', 'v1', 1)];
    expect(sortChaptersForReading(chapters, volumes).map((c) => c.id)).toEqual(['a', 'b']);
    // Sorting the already-sorted list changes nothing.
    const once = sortChaptersForReading(chapters, volumes);
    expect(sortChaptersForReading(once, volumes)).toEqual(once);
  });

  test('the input array is not mutated', () => {
    const chapters = [chapter('b', 'v1', 2), chapter('a', 'v1', 1)];
    const before = chapters.map((c) => c.id);
    sortChaptersForReading(chapters, volumes);
    expect(chapters.map((c) => c.id)).toEqual(before);
  });

  test('a book with no volumes still sorts by chapter order', () => {
    const chapters = [chapter('b', '', 2), chapter('a', '', 1)];
    expect(sortChaptersForReading(chapters, []).map((c) => c.id)).toEqual(['a', 'b']);
  });

  test('an empty book sorts to nothing', () => {
    expect(sortChaptersForReading([], volumes)).toEqual([]);
  });
});

describe('Walking forward through the book', () => {
  const ordered = sortChaptersForReading(
    [
      chapter('v1c1', 'v1', 1),
      chapter('v1c2', 'v1', 2),
      chapter('v2c1', 'v2', 1),
    ],
    volumes
  );

  test('the next chapters follow in reading order', () => {
    expect(chaptersAfter(ordered, 'v1c1', 2).map((c) => c.id)).toEqual(['v1c2', 'v2c1']);
  });

  test('reading continues across a volume boundary', () => {
    expect(chaptersAfter(ordered, 'v1c2', 1).map((c) => c.id)).toEqual(['v2c1']);
  });

  test('the last chapter has nothing after it', () => {
    expect(chaptersAfter(ordered, 'v2c1', 3)).toEqual([]);
  });

  test('a cursor that is not published returns nothing rather than the start', () => {
    // Guards against an unpublished or deleted chapter id restarting the book.
    expect(chaptersAfter(ordered, 'unknown', 3)).toEqual([]);
  });

  test('the batch is bounded by the limit', () => {
    expect(chaptersAfter(ordered, 'v1c1', 1).map((c) => c.id)).toEqual(['v1c2']);
    expect(chaptersAfter(ordered, 'v1c1', 0)).toEqual([]);
    expect(chaptersAfter(ordered, 'v1c1', -5)).toEqual([]);
  });

  test('indexOfChapter reports position, or -1', () => {
    expect(indexOfChapter(ordered, 'v1c2')).toBe(1);
    expect(indexOfChapter(ordered, 'nope')).toBe(-1);
  });
});

describe('Public slugs are validated before addressing a document', () => {
  // Firestore's .doc() treats a slash as a path separator, so an unchecked
  // slug could name a different document than the one it appears to.

  test('an ordinary slug is accepted', () => {
    expect(isValidPublicSlug('redline-love')).toBe(true);
  });

  test('a Thai slug is accepted', () => {
    expect(isValidPublicSlug('เสียงจากลาดพร้าว')).toBe(true);
  });

  test('a slug containing a path separator is refused', () => {
    expect(isValidPublicSlug('a/b')).toBe(false);
    expect(isValidPublicSlug('slug/volumes/v1')).toBe(false);
  });

  test('relative path segments are refused', () => {
    expect(isValidPublicSlug('.')).toBe(false);
    expect(isValidPublicSlug('..')).toBe(false);
  });

  test('an empty or non-string slug is refused', () => {
    expect(isValidPublicSlug('')).toBe(false);
    expect(isValidPublicSlug(null)).toBe(false);
    expect(isValidPublicSlug(undefined)).toBe(false);
    expect(isValidPublicSlug(42)).toBe(false);
  });

  test('an absurdly long slug is refused', () => {
    expect(isValidPublicSlug('x'.repeat(201))).toBe(false);
  });
});

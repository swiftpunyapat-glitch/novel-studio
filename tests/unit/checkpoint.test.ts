import { describe, expect, test, vi } from 'vitest';
import { performCheckpoint, type CheckpointSource } from '@/lib/editor/checkpoint';
import type { ManuscriptSnapshot } from '@/lib/firebase/firestore';
import type { Revision } from '@/types/project';

/**
 * 10. Checkpoint captures live editor state.
 *
 * The regression being guarded is Audit H7: the old page read
 * `variant.content` from React state, which lags behind the editor by one
 * successful autosave.
 */

function snap(text: string): ManuscriptSnapshot {
  return {
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    plainText: text,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    characterCount: text.length,
  };
}

function makeRevision(snapshot: ManuscriptSnapshot): Revision {
  return {
    id: 'rev_1',
    variantId: 'v1',
    chapterId: 'c1',
    projectId: 'p1',
    revisionNumber: 1,
    trigger: 'manual',
    content: snapshot.content,
    plainText: snapshot.plainText,
    wordCount: snapshot.wordCount,
    createdAt: Date.now(),
    createdBy: 'owner',
  };
}

/**
 * Models the real hazard: the editor holds newer text than the last value that
 * reached React state, and flush() is what reconciles them.
 */
function makeEditorSource(opts: {
  liveText: string;
  staleText: string;
  conflict?: boolean;
  onFlush?: () => void;
}): CheckpointSource & { flushed: boolean } {
  const state = { flushed: false };
  return {
    get flushed() {
      return state.flushed;
    },
    flush: vi.fn(async () => {
      state.flushed = true;
      opts.onFlush?.();
    }),
    hasBlockingConflict: () => opts.conflict === true,
    // Always returns the LIVE text, regardless of what React state holds.
    getSnapshot: () => snap(opts.liveText),
  };
}

describe('10. Checkpoint captures live editor state', () => {
  test('the revision uses live editor text, not stale component state', async () => {
    const source = makeEditorSource({
      liveText: 'the sentence the author just typed',
      staleText: 'text from the last successful autosave',
    });

    const create = vi.fn(async (s: ManuscriptSnapshot) => makeRevision(s));
    const result = await performCheckpoint(source, create);

    expect(result.status).toBe('created');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].plainText).toBe('the sentence the author just typed');
    expect(create.mock.calls[0][0].plainText).not.toBe('text from the last successful autosave');
  });

  test('pending state is flushed BEFORE the snapshot is read', async () => {
    const order: string[] = [];
    const source: CheckpointSource = {
      flush: vi.fn(async () => {
        order.push('flush');
      }),
      hasBlockingConflict: () => false,
      getSnapshot: () => {
        order.push('getSnapshot');
        return snap('live');
      },
    };

    await performCheckpoint(source, async (s) => {
      order.push('createRevision');
      return makeRevision(s);
    });

    expect(order).toEqual(['flush', 'getSnapshot', 'createRevision']);
  });

  test('checkpointing inside the autosave debounce window still captures the newest text', async () => {
    // flush() is what promotes the debounced text; without it the snapshot
    // would be whatever was last committed.
    let committed = 'older text';
    const source: CheckpointSource = {
      flush: vi.fn(async () => {
        committed = 'newest text typed 200ms ago';
      }),
      hasBlockingConflict: () => false,
      getSnapshot: () => snap(committed),
    };

    const create = vi.fn(async (s: ManuscriptSnapshot) => makeRevision(s));
    await performCheckpoint(source, create);

    expect(create.mock.calls[0][0].plainText).toBe('newest text typed 200ms ago');
  });

  test('an unresolved conflict blocks the checkpoint and writes nothing', async () => {
    const source = makeEditorSource({
      liveText: 'local text',
      staleText: 'stale',
      conflict: true,
    });
    const create = vi.fn(async (s: ManuscriptSnapshot) => makeRevision(s));

    const result = await performCheckpoint(source, create);

    expect(result).toEqual({ status: 'blocked', reason: 'conflict' });
    expect(create).not.toHaveBeenCalled();
    // The flush still ran, so nothing local was dropped.
    expect(source.flushed).toBe(true);
  });

  test('an unavailable editor blocks rather than writing an empty revision', async () => {
    const source: CheckpointSource = {
      flush: vi.fn(async () => undefined),
      hasBlockingConflict: () => false,
      getSnapshot: () => null,
    };
    const create = vi.fn(async (s: ManuscriptSnapshot) => makeRevision(s));

    const result = await performCheckpoint(source, create);

    expect(result).toEqual({ status: 'blocked', reason: 'editor-unavailable' });
    expect(create).not.toHaveBeenCalled();
  });

  test('a failing write is reported, not swallowed', async () => {
    const source = makeEditorSource({ liveText: 'text', staleText: 'text' });
    const boom = new Error('permission denied');

    const result = await performCheckpoint(source, async () => {
      throw boom;
    });

    expect(result).toEqual({ status: 'failed', error: boom });
  });

  test('a failing flush aborts the checkpoint rather than freezing stale text', async () => {
    const source: CheckpointSource = {
      flush: vi.fn(async () => {
        throw new Error('save failed');
      }),
      hasBlockingConflict: () => false,
      getSnapshot: () => snap('live'),
    };
    const create = vi.fn(async (s: ManuscriptSnapshot) => makeRevision(s));

    const result = await performCheckpoint(source, create);

    expect(result.status).toBe('failed');
    expect(create).not.toHaveBeenCalled();
  });
});

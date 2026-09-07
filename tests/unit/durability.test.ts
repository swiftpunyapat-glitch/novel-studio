import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

import {
  SaveCoordinator,
  type AutosaveStatus,
} from '@/lib/editor/save-coordinator';
import {
  getMirror,
  putMirror,
  markMirrorClean,
  decideRecovery,
  resetMirrorConnection,
  type MirrorSnapshot,
} from '@/lib/offline/manuscript-mirror';
import type { ManuscriptSnapshot, SaveVariantResult } from '@/lib/firebase/firestore';

const PROJECT = 'project_alpha';
const CHAPTER = 'chapter_one';
const VARIANT = 'variant_draft_a';

function snap(text: string): ManuscriptSnapshot {
  return {
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    plainText: text,
    wordCount: text.trim() ? text.trim().split(/\s+/).length : 0,
    characterCount: text.length,
  };
}

/** In-memory stand-in for the versioned Firestore transaction. */
function makeRemote(initialText = 'original', initialVersion = 1) {
  const state = { text: initialText, version: initialVersion, writes: 0 };

  const save = vi.fn(
    async (s: ManuscriptSnapshot, baseVersion: number): Promise<SaveVariantResult> => {
      if (state.version !== baseVersion) {
        return {
          status: 'conflict',
          remoteVersion: state.version,
          baseVersion,
          remote: snap(state.text),
        };
      }
      state.text = s.plainText;
      state.version += 1;
      state.writes += 1;
      return { status: 'saved', contentVersion: state.version, savedAt: Date.now() };
    }
  );

  return { state, save };
}

function makeCoordinator(
  save: CoordinatorSave,
  baseVersion = 1,
  extra: Partial<ConstructorParameters<typeof SaveCoordinator>[0]> = {}
) {
  const statuses: AutosaveStatus[] = [];
  const coordinator = new SaveCoordinator({
    projectId: PROJECT,
    chapterId: CHAPTER,
    variantId: VARIANT,
    sessionId: 'session_test',
    baseVersion,
    save,
    onStatusChange: (s) => statuses.push(s),
    localDebounceMs: 50,
    remoteDebounceMs: 200,
    isOnline: () => true,
    ...extra,
  });
  return { coordinator, statuses };
}

type CoordinatorSave = ConstructorParameters<typeof SaveCoordinator>[0]['save'];

beforeEach(() => {
  // Fresh IndexedDB per test so mirrors never leak between cases.
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  resetMirrorConnection();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------

describe('1. Normal save increments contentVersion', () => {
  test('a clean save advances the version by exactly one', async () => {
    const { state, save } = makeRemote('original', 1);
    const { coordinator } = makeCoordinator(save, 1);

    coordinator.handleChange(snap('first edit'));
    await coordinator.flush();

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ plainText: 'first edit' }), 1);
    expect(state.version).toBe(2);
    expect(coordinator.getBaseVersion()).toBe(2);
    expect(coordinator.getStatus()).toBe('saved');
  });

  test('successive saves keep incrementing from the new base', async () => {
    const { state, save } = makeRemote('original', 1);
    const { coordinator } = makeCoordinator(save, 1);

    coordinator.handleChange(snap('one'));
    await coordinator.flush();
    coordinator.handleChange(snap('two'));
    await coordinator.flush();

    expect(state.version).toBe(3);
    expect(state.text).toBe('two');
  });
});

describe('2. Stale baseVersion is rejected', () => {
  test('a save from a stale device produces a conflict, not a write', async () => {
    const { save } = makeRemote('written by PC A', 5);
    // This device still believes it is on v4.
    const { coordinator } = makeCoordinator(save, 4);

    coordinator.handleChange(snap('written by PC B'));
    await coordinator.flush();

    expect(coordinator.getStatus()).toBe('conflict');
    const conflict = coordinator.getConflict();
    expect(conflict).not.toBeNull();
    expect(conflict!.baseVersion).toBe(4);
    expect(conflict!.remoteVersion).toBe(5);
  });
});

describe('3. Rejected stale save does not modify remote content', () => {
  test('remote text and version are untouched after a conflict', async () => {
    const { state, save } = makeRemote('written by PC A', 5);
    const { coordinator } = makeCoordinator(save, 4);

    coordinator.handleChange(snap('written by PC B'));
    await coordinator.flush();

    expect(state.text).toBe('written by PC A');
    expect(state.version).toBe(5);
    expect(state.writes).toBe(0);
  });

  test('autosave does not keep retrying behind the author\'s back', async () => {
    const { save } = makeRemote('remote', 5);
    const { coordinator } = makeCoordinator(save, 4);

    coordinator.handleChange(snap('local a'));
    await coordinator.flush();
    const callsAfterConflict = save.mock.calls.length;

    // Author keeps typing while the conflict dialog is open.
    coordinator.handleChange(snap('local b'));
    await coordinator.flush();

    expect(save.mock.calls.length).toBe(callsAfterConflict);
    expect(coordinator.getStatus()).toBe('conflict');
  });
});

describe('4. Local conflicted content remains recoverable', () => {
  test('the conflicting local text is mirrored and flagged dirty', async () => {
    const { save } = makeRemote('remote wins', 5);
    const { coordinator } = makeCoordinator(save, 4);

    coordinator.handleChange(snap('precious local words'));
    await coordinator.flush();

    const mirror = await getMirror(PROJECT, CHAPTER, VARIANT);
    expect(mirror).not.toBeNull();
    expect(mirror!.plainText).toBe('precious local words');
    expect(mirror!.dirty).toBe(true);

    // And it is still exposed in memory for the "keep as new variant" path.
    expect(coordinator.getConflict()!.local.plainText).toBe('precious local words');
  });

  test('preserving local as a new variant clears the conflict without data loss', async () => {
    const { state, save } = makeRemote('remote wins', 5);
    const { coordinator } = makeCoordinator(save, 4);

    coordinator.handleChange(snap('precious local words'));
    await coordinator.flush();

    const rescued = coordinator.getConflict()!.local;
    coordinator.resolveAfterRescue();

    expect(rescued.plainText).toBe('precious local words');
    expect(coordinator.getStatus()).toBe('saved');
    expect(coordinator.getBaseVersion()).toBe(5);
    expect(state.text).toBe('remote wins');
  });

  test('accepting remote returns the remote snapshot and rebases', async () => {
    const { save } = makeRemote('remote wins', 5);
    const { coordinator } = makeCoordinator(save, 4);

    coordinator.handleChange(snap('local'));
    await coordinator.flush();

    const remote = coordinator.acceptRemote();
    await coordinator.whenSettled();

    expect(remote!.plainText).toBe('remote wins');
    expect(coordinator.getBaseVersion()).toBe(5);
    expect(coordinator.getConflict()).toBeNull();
  });
});

describe('5. Local IndexedDB snapshot survives reload', () => {
  test('a mirrored snapshot is readable from a fresh connection', async () => {
    const { save } = makeRemote();
    const { coordinator } = makeCoordinator(save, 1);

    coordinator.handleChange(snap('typed before the crash'));
    await coordinator.writeMirror();
    coordinator.dispose();

    // Simulate a reload: drop the cached DB handle, keep the backing store.
    resetMirrorConnection();

    const recovered = await getMirror(PROJECT, CHAPTER, VARIANT);
    expect(recovered).not.toBeNull();
    expect(recovered!.plainText).toBe('typed before the crash');
    expect(recovered!.dirty).toBe(true);
  });
});

describe('6. Unsynced local content is detected on load', () => {
  const base: MirrorSnapshot = {
    key: `${PROJECT}/${CHAPTER}/${VARIANT}`,
    projectId: PROJECT,
    chapterId: CHAPTER,
    variantId: VARIANT,
    content: { type: 'doc' },
    plainText: 'offline words',
    wordCount: 2,
    characterCount: 13,
    savedAt: Date.now(),
    baseVersion: 3,
    dirty: true,
  };

  test('dirty local content that differs from remote offers recovery', () => {
    const decision = decideRecovery(base, 3, 'server words');
    expect(decision.kind).toBe('offer-recovery');
  });

  test('dirty local content identical to remote does not nag', () => {
    const decision = decideRecovery({ ...base, plainText: 'server words' }, 3, 'server words');
    expect(decision.kind).toBe('use-remote');
  });

  test('clean local content loads normally', () => {
    const decision = decideRecovery({ ...base, dirty: false }, 3, 'server words');
    expect(decision.kind).toBe('use-remote');
  });

  test('no local mirror loads normally', () => {
    expect(decideRecovery(null, 1, 'anything').kind).toBe('use-remote');
  });
});

describe('7. Successful sync marks local snapshot clean', () => {
  test('mirror is clean and rebased after a successful save', async () => {
    const { save } = makeRemote('original', 1);
    const { coordinator } = makeCoordinator(save, 1);

    coordinator.handleChange(snap('synced words'));
    await coordinator.flush();

    const mirror = await getMirror(PROJECT, CHAPTER, VARIANT);
    expect(mirror).not.toBeNull();
    expect(mirror!.dirty).toBe(false);
    expect(mirror!.baseVersion).toBe(2);
  });

  test('markMirrorClean retains content rather than deleting it', async () => {
    await putMirror({
      key: `${PROJECT}/${CHAPTER}/${VARIANT}`,
      projectId: PROJECT,
      chapterId: CHAPTER,
      variantId: VARIANT,
      content: { type: 'doc' },
      plainText: 'keep me',
      wordCount: 2,
      characterCount: 7,
      savedAt: Date.now(),
      baseVersion: 1,
      dirty: true,
    });

    await markMirrorClean(PROJECT, CHAPTER, VARIANT, 2);

    const mirror = await getMirror(PROJECT, CHAPTER, VARIANT);
    expect(mirror!.plainText).toBe('keep me');
    expect(mirror!.dirty).toBe(false);
  });
});

describe('8. Navigation flushes the final edit', () => {
  test('flush commits an edit that is still inside the debounce window', async () => {
    vi.useFakeTimers();
    const { state, save } = makeRemote('original', 1);
    const { coordinator } = makeCoordinator(save, 1);

    coordinator.handleChange(snap('last words before navigating'));
    // Deliberately do NOT advance timers: the debounce has not fired.
    expect(save).not.toHaveBeenCalled();

    vi.useRealTimers();
    await coordinator.flush();

    expect(save).toHaveBeenCalledTimes(1);
    expect(state.text).toBe('last words before navigating');
  });

  test('the mirror is written during flush even when the remote save fails', async () => {
    const failing = vi.fn(async () => {
      throw new Error('network down');
    });
    const { coordinator } = makeCoordinator(failing as unknown as CoordinatorSave, 1);

    coordinator.handleChange(snap('unsent words'));
    await coordinator.flush();

    const mirror = await getMirror(PROJECT, CHAPTER, VARIANT);
    expect(mirror!.plainText).toBe('unsent words');
    expect(mirror!.dirty).toBe(true);
    expect(coordinator.getStatus()).toBe('error');
  });
});

describe('9. Unmount clears pending debounce safely', () => {
  test('no save fires after dispose', async () => {
    vi.useFakeTimers();
    const { save } = makeRemote();
    const { coordinator } = makeCoordinator(save, 1);

    coordinator.handleChange(snap('typed then navigated away'));
    coordinator.dispose();

    await vi.advanceTimersByTimeAsync(5000);

    expect(save).not.toHaveBeenCalled();
    expect(coordinator.isDisposed()).toBe(true);
  });

  test('dispose is idempotent and handleChange after dispose is inert', async () => {
    vi.useFakeTimers();
    const { save } = makeRemote();
    const { coordinator } = makeCoordinator(save, 1);

    coordinator.dispose();
    coordinator.dispose();
    coordinator.handleChange(snap('ignored'));

    await vi.advanceTimersByTimeAsync(5000);
    expect(save).not.toHaveBeenCalled();
  });
});

describe('Offline behaviour (Stage 2C / 2E)', () => {
  test('while offline nothing is sent and local state is preserved', async () => {
    const { save } = makeRemote();
    const { coordinator } = makeCoordinator(save, 1, { isOnline: () => false });

    coordinator.handleChange(snap('written on a train'));
    await coordinator.flush();

    expect(save).not.toHaveBeenCalled();
    expect(coordinator.getStatus()).toBe('offline_pending');

    const mirror = await getMirror(PROJECT, CHAPTER, VARIANT);
    expect(mirror!.plainText).toBe('written on a train');
    expect(mirror!.dirty).toBe(true);
  });

  test('coming back online syncs the buffered text without loss', async () => {
    const { state, save } = makeRemote('original', 1);
    let online = false;
    const { coordinator } = makeCoordinator(save, 1, { isOnline: () => online });

    coordinator.handleChange(snap('written on a train'));
    await coordinator.flush();
    expect(coordinator.getStatus()).toBe('offline_pending');

    online = true;
    await coordinator.flush();

    expect(state.text).toBe('written on a train');
    expect(coordinator.getStatus()).toBe('saved');
  });
});

describe('beforeunload guard (Stage 2F)', () => {
  test.each<[AutosaveStatus, boolean]>([
    ['dirty', true],
    ['saving', true],
    ['offline_pending', true],
    ['conflict', true],
    ['error', true],
    ['saved', false],
  ])('status %s -> warns: %s', async (status, expected) => {
    const { save } = makeRemote();
    const { coordinator } = makeCoordinator(save, 1);
    (coordinator as unknown as { status: AutosaveStatus }).status = status;
    expect(coordinator.hasUnsafeUnsavedState()).toBe(expected);
  });

  test('a completed save does not warn', async () => {
    const { save } = makeRemote('original', 1);
    const { coordinator } = makeCoordinator(save, 1);

    coordinator.handleChange(snap('done'));
    await coordinator.flush();

    expect(coordinator.getStatus()).toBe('saved');
    expect(coordinator.hasUnsafeUnsavedState()).toBe(false);
  });
});

describe('Edits made while a save is in flight are not lost', () => {
  test('a keystroke during the round trip triggers a follow-up save', async () => {
    let release: (() => void) | null = null;
    const state = { text: 'original', version: 1 };

    const save = vi.fn(
      async (s: ManuscriptSnapshot, baseVersion: number): Promise<SaveVariantResult> => {
        if (release) await new Promise<void>((r) => (release = r));
        if (state.version !== baseVersion) {
          return {
            status: 'conflict',
            remoteVersion: state.version,
            baseVersion,
            remote: snap(state.text),
          };
        }
        state.text = s.plainText;
        state.version += 1;
        return { status: 'saved', contentVersion: state.version, savedAt: Date.now() };
      }
    );

    const { coordinator } = makeCoordinator(save, 1);

    coordinator.handleChange(snap('first'));
    const inflight = coordinator.flush();
    coordinator.handleChange(snap('second'));
    await inflight;

    await coordinator.flush();

    expect(state.text).toBe('second');
    expect(coordinator.getStatus()).toBe('saved');
  });
});

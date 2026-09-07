/**
 * Checkpoint orchestration. (Audit H7 / Stage 2G)
 *
 * A revision must freeze exactly what the author sees at the moment they click
 * Checkpoint. The previous implementation passed `variant.content` from React
 * state, which only refreshes after a successful autosave — so checkpointing
 * inside the 1.5s debounce window, or any time after a failed save, silently
 * froze older text. Publishing sources from a revision, so that stale text then
 * became what readers saw.
 *
 * The sequence is therefore: flush pending state, refuse while a conflict is
 * unresolved, then read the snapshot from the LIVE editor.
 *
 * Extracted from the page component so the ordering is directly testable.
 */

import type { ManuscriptSnapshot } from '@/lib/firebase/firestore';
import type { Revision } from '@/types/project';

export interface CheckpointSource {
  /** Flushes pending local + remote state. */
  flush: () => Promise<void>;
  /** True when a save conflict is still awaiting the author's decision. */
  hasBlockingConflict: () => boolean;
  /** Reads the current content directly from the live editor. */
  getSnapshot: () => ManuscriptSnapshot | null;
}

export type CheckpointResult =
  | { status: 'created'; revision: Revision }
  | { status: 'blocked'; reason: 'conflict' | 'editor-unavailable' }
  | { status: 'failed'; error: unknown };

export async function performCheckpoint(
  source: CheckpointSource,
  createRevision: (snapshot: ManuscriptSnapshot) => Promise<Revision>
): Promise<CheckpointResult> {
  try {
    // 1. Commit anything still buffered, so the checkpoint and the saved
    //    variant describe the same text.
    await source.flush();

    // 2. Never freeze a snapshot while the author still has a conflict to
    //    resolve — the revision would be an arbitrary side of a split history.
    if (source.hasBlockingConflict()) {
      return { status: 'blocked', reason: 'conflict' };
    }

    // 3. Read from the live editor, never from cached component state.
    const snapshot = source.getSnapshot();
    if (!snapshot) {
      return { status: 'blocked', reason: 'editor-unavailable' };
    }

    const revision = await createRevision(snapshot);
    return { status: 'created', revision };
  } catch (error) {
    return { status: 'failed', error };
  }
}

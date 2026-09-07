/**
 * Autosave state machine and durability coordinator. (Stage 2B / 2C / 2E / 2F)
 *
 * All manuscript-durability decisions live here rather than inside the React
 * component, so they can be driven directly by tests with no DOM: timer
 * behaviour, conflict handling, mirror writes, flush-on-navigate and unmount
 * cleanup are all observable through this class.
 *
 * Two independent cadences:
 *   - local mirror  ~300ms  — cheap, so a crash loses almost nothing
 *   - remote save  ~1500ms  — network round trip, kept at the original cadence
 */

import type { ManuscriptSnapshot, SaveVariantResult } from '@/lib/firebase/firestore';
import {
  putMirror,
  markMirrorClean,
  type MirrorSnapshot,
} from '@/lib/offline/manuscript-mirror';

import type { AutosaveStatus } from '@/types/editor';

export type { AutosaveStatus };

export interface ConflictState {
  /** What this device has, which was never accepted by the server. */
  local: ManuscriptSnapshot;
  /** What the server currently holds, written by another device. */
  remote: ManuscriptSnapshot;
  remoteVersion: number;
  baseVersion: number;
}

export interface CoordinatorOptions {
  projectId: string;
  chapterId: string;
  variantId: string;
  sessionId: string;
  baseVersion: number;

  /** Performs the versioned remote save. */
  save: (
    snapshot: ManuscriptSnapshot,
    baseVersion: number
  ) => Promise<SaveVariantResult>;

  onStatusChange?: (status: AutosaveStatus) => void;
  onConflict?: (conflict: ConflictState) => void;
  onVersionChange?: (version: number) => void;

  localDebounceMs?: number;
  remoteDebounceMs?: number;
  isOnline?: () => boolean;
}

const DEFAULT_LOCAL_DEBOUNCE = 300;
const DEFAULT_REMOTE_DEBOUNCE = 1500;

/** Statuses where closing the tab could lose work the server has not accepted. */
const UNSAFE_TO_LEAVE: ReadonlySet<AutosaveStatus> = new Set<AutosaveStatus>([
  'dirty',
  'saving',
  'offline_pending',
  'conflict',
  'error',
]);

export class SaveCoordinator {
  private status: AutosaveStatus = 'saved';
  private baseVersion: number;
  private pending: ManuscriptSnapshot | null = null;
  private lastSyncedSnapshot: ManuscriptSnapshot | null = null;
  private conflict: ConflictState | null = null;

  private localTimer: ReturnType<typeof setTimeout> | null = null;
  private remoteTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  /**
   * Serialised tail of fire-and-forget mirror work. Kept awaitable so nothing
   * escapes as a floating promise that could land after the editor is gone.
   */
  private backgroundWork: Promise<unknown> = Promise.resolve();
  private disposed = false;

  constructor(private readonly opts: CoordinatorOptions) {
    this.baseVersion = opts.baseVersion;
  }

  // ---------- observable state ----------

  getStatus(): AutosaveStatus {
    return this.status;
  }

  getBaseVersion(): number {
    return this.baseVersion;
  }

  getConflict(): ConflictState | null {
    return this.conflict;
  }

  /** Stage 2F: only warn when there is genuinely unsafe local state. */
  hasUnsafeUnsavedState(): boolean {
    return UNSAFE_TO_LEAVE.has(this.status);
  }

  /** Queues background work behind any already pending, swallowing failures. */
  private track(work: Promise<unknown>): void {
    this.backgroundWork = this.backgroundWork.then(() => work).catch(() => undefined);
  }

  /** Resolves once every scheduled save and mirror write has settled. */
  async whenSettled(): Promise<void> {
    await this.backgroundWork;
    if (this.inFlight) await this.inFlight;
    await this.backgroundWork;
  }

  private setStatus(next: AutosaveStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.opts.onStatusChange?.(next);
  }

  private online(): boolean {
    if (this.opts.isOnline) return this.opts.isOnline();
    if (typeof navigator === 'undefined') return true;
    return navigator.onLine !== false;
  }

  // ---------- editor input ----------

  /** Called on every editor change. Schedules both cadences. */
  handleChange(snapshot: ManuscriptSnapshot): void {
    if (this.disposed) return;

    this.pending = snapshot;

    // A conflict must be resolved by the author; keep buffering their typing
    // locally but do not retry the remote save behind their back.
    if (this.status !== 'conflict') {
      this.setStatus('dirty');
    }

    this.scheduleLocal();
    if (this.status !== 'conflict') this.scheduleRemote();
  }

  private scheduleLocal(): void {
    if (this.localTimer) clearTimeout(this.localTimer);
    this.localTimer = setTimeout(() => {
      this.localTimer = null;
      void this.writeMirror();
    }, this.opts.localDebounceMs ?? DEFAULT_LOCAL_DEBOUNCE);
  }

  private scheduleRemote(): void {
    if (this.remoteTimer) clearTimeout(this.remoteTimer);
    this.remoteTimer = setTimeout(() => {
      this.remoteTimer = null;
      void this.pushToRemote();
    }, this.opts.remoteDebounceMs ?? DEFAULT_REMOTE_DEBOUNCE);
  }

  // ---------- local durability ----------

  private buildMirror(snapshot: ManuscriptSnapshot, dirty: boolean): MirrorSnapshot {
    return {
      key: `${this.opts.projectId}/${this.opts.chapterId}/${this.opts.variantId}`,
      projectId: this.opts.projectId,
      chapterId: this.opts.chapterId,
      variantId: this.opts.variantId,
      content: snapshot.content,
      plainText: snapshot.plainText,
      wordCount: snapshot.wordCount,
      characterCount: snapshot.characterCount,
      savedAt: Date.now(),
      baseVersion: this.baseVersion,
      dirty,
    };
  }

  /** Writes the current pending snapshot to IndexedDB. */
  async writeMirror(): Promise<void> {
    if (!this.pending) return;
    await putMirror(this.buildMirror(this.pending, true));
  }

  // ---------- remote sync ----------

  private async pushToRemote(): Promise<void> {
    if (this.disposed || !this.pending || this.status === 'conflict') return;

    // Serialise: never run two versioned saves against the same baseVersion.
    if (this.inFlight) {
      await this.inFlight;
      if (this.disposed || !this.pending) return;
    }

    if (!this.online()) {
      // Nothing is lost: the mirror already holds this content.
      await this.writeMirror();
      this.setStatus('offline_pending');
      return;
    }

    const snapshot = this.pending;
    const base = this.baseVersion;

    this.setStatus('saving');

    const work = (async () => {
      try {
        const result = await this.opts.save(snapshot, base);

        if (this.disposed) return;

        if (result.status === 'conflict') {
          this.conflict = {
            local: snapshot,
            remote: result.remote,
            remoteVersion: result.remoteVersion,
            baseVersion: result.baseVersion,
          };
          // Local content stays in the mirror, flagged dirty and recoverable.
          await putMirror(this.buildMirror(snapshot, true));
          this.setStatus('conflict');
          this.opts.onConflict?.(this.conflict);
          return;
        }

        this.baseVersion = result.contentVersion;
        this.lastSyncedSnapshot = snapshot;
        this.opts.onVersionChange?.(result.contentVersion);

        // Only clear dirty if nothing was typed while the save was in flight.
        if (this.pending === snapshot) {
          this.pending = null;
          await markMirrorClean(
            this.opts.projectId,
            this.opts.chapterId,
            this.opts.variantId,
            result.contentVersion
          );
          this.setStatus('saved');
        } else {
          await putMirror(this.buildMirror(this.pending!, true));
          this.setStatus('dirty');
          this.scheduleRemote();
        }
      } catch (err) {
        if (this.disposed) return;
        console.error('Manuscript save failed', err);
        // The mirror is the safety net for every failure path.
        await this.writeMirror();
        this.setStatus(this.online() ? 'error' : 'offline_pending');
      }
    })();

    this.inFlight = work.then(() => {
      this.inFlight = null;
    });

    await this.inFlight;
  }

  /**
   * Flushes everything pending: cancels timers, writes the mirror, then
   * attempts the remote save. Used by Ctrl+S, by navigation and by unmount.
   */
  async flush(): Promise<void> {
    if (this.localTimer) {
      clearTimeout(this.localTimer);
      this.localTimer = null;
    }
    if (this.remoteTimer) {
      clearTimeout(this.remoteTimer);
      this.remoteTimer = null;
    }

    await this.writeMirror();

    if (this.status !== 'conflict' && this.pending) {
      await this.pushToRemote();
    }
    await this.whenSettled();
  }

  /** Ctrl+S — identical to flush, exposed under an intention-revealing name. */
  async saveNow(): Promise<void> {
    await this.flush();
  }

  // ---------- conflict resolution (Stage 2B) ----------

  /** Take the server's copy. Local content stays mirrored until overwritten. */
  acceptRemote(): ManuscriptSnapshot | null {
    if (!this.conflict) return null;
    const { remote, remoteVersion } = this.conflict;

    this.baseVersion = remoteVersion;
    this.pending = null;
    this.conflict = null;
    this.lastSyncedSnapshot = remote;
    this.opts.onVersionChange?.(remoteVersion);
    this.setStatus('saved');

    this.track(
      markMirrorClean(
        this.opts.projectId,
        this.opts.chapterId,
        this.opts.variantId,
        remoteVersion
      )
    );
    return remote;
  }

  /**
   * The local content has been preserved elsewhere (a new draft variant).
   * Neither side was overwritten, so this device can now follow the server.
   */
  resolveAfterRescue(): void {
    if (!this.conflict) return;
    const { remoteVersion } = this.conflict;
    this.baseVersion = remoteVersion;
    this.pending = null;
    this.conflict = null;
    this.opts.onVersionChange?.(remoteVersion);
    this.setStatus('saved');
  }

  /** "Review later" — stay in conflict, change nothing, lose nothing. */
  deferConflict(): void {
    if (this.conflict) this.setStatus('conflict');
  }

  // ---------- lifecycle ----------

  /** Adopts content restored from the local mirror as the live pending state. */
  adoptRecovered(snapshot: ManuscriptSnapshot, baseVersion: number): void {
    this.pending = snapshot;
    this.baseVersion = baseVersion;
    this.setStatus('dirty');
    this.scheduleRemote();
  }

  getLastSynced(): ManuscriptSnapshot | null {
    return this.lastSyncedSnapshot;
  }

  /**
   * Clears every timer. Safe to call more than once, and guarantees no
   * scheduled callback fires against a destroyed editor. (Audit M17)
   */
  dispose(): void {
    this.disposed = true;
    if (this.localTimer) {
      clearTimeout(this.localTimer);
      this.localTimer = null;
    }
    if (this.remoteTimer) {
      clearTimeout(this.remoteTimer);
      this.remoteTimer = null;
    }
  }

  isDisposed(): boolean {
    return this.disposed;
  }
}

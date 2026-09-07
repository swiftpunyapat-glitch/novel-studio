/**
 * IndexedDB manuscript mirror. (Audit C5 / Stage 2C)
 *
 * Firestore's persistent cache keeps the app working offline, but it is opaque:
 * an author cannot be shown "you have unsynced work" and cannot choose what to
 * do about it. This mirror is a deliberate, explicit second copy that exists so
 * recovery can be offered as a decision rather than happening invisibly.
 *
 * Written on a fast local debounce (well ahead of remote autosave) so a crash,
 * refresh or tab close loses at most a few hundred milliseconds of typing.
 *
 * Raw IndexedDB with no wrapper dependency, so `fake-indexeddb` can drive it
 * unchanged in automated tests.
 */

export const DB_NAME = 'novel-studio-manuscripts';
export const STORE_NAME = 'variant-mirrors';
const DB_VERSION = 1;

export interface MirrorSnapshot {
  /** `${projectId}/${chapterId}/${variantId}` */
  key: string;
  projectId: string;
  chapterId: string;
  variantId: string;

  content: unknown;
  plainText: string;
  wordCount: number;
  characterCount: number;

  /** When this snapshot was written to IndexedDB. */
  savedAt: number;
  /** The remote contentVersion this local content was derived from. */
  baseVersion: number;
  /** True when local content has not yet been confirmed saved remotely. */
  dirty: boolean;
}

export function mirrorKey(
  projectId: string,
  chapterId: string,
  variantId: string
): string {
  return `${projectId}/${chapterId}/${variantId}`;
}

function idbFactory(): IDBFactory | null {
  if (typeof indexedDB !== 'undefined') return indexedDB;
  if (typeof globalThis !== 'undefined' && (globalThis as { indexedDB?: IDBFactory }).indexedDB) {
    return (globalThis as { indexedDB?: IDBFactory }).indexedDB!;
  }
  return null;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  const factory = idbFactory();
  if (!factory) return Promise.reject(new Error('IndexedDB unavailable'));

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  // A failed open must not poison every later call.
  dbPromise.catch(() => {
    dbPromise = null;
  });

  return dbPromise;
}

/** Test seam: drops the cached connection so a fresh factory is picked up. */
export function resetMirrorConnection(): void {
  dbPromise = null;
}

function run<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const request = fn(tx.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.onabort = () => reject(tx.error);
      })
  );
}

/**
 * Every operation is best-effort: a browser in private mode, with site data
 * blocked, or out of quota must degrade to "no mirror", never break editing.
 */
async function safely<T>(op: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await op();
  } catch (err) {
    console.warn('Manuscript mirror unavailable', err);
    return fallback;
  }
}

export async function putMirror(snapshot: MirrorSnapshot): Promise<boolean> {
  return safely(async () => {
    await run('readwrite', (store) => store.put(snapshot) as IDBRequest<IDBValidKey>);
    return true;
  }, false);
}

export async function getMirror(
  projectId: string,
  chapterId: string,
  variantId: string
): Promise<MirrorSnapshot | null> {
  return safely(async () => {
    const result = await run<MirrorSnapshot | undefined>('readonly', (store) =>
      store.get(mirrorKey(projectId, chapterId, variantId))
    );
    return result ?? null;
  }, null);
}

/**
 * Marks the mirrored snapshot as synced at a known remote version.
 * The content is intentionally retained rather than deleted, so a later crash
 * still has something to recover from.
 */
export async function markMirrorClean(
  projectId: string,
  chapterId: string,
  variantId: string,
  syncedVersion: number
): Promise<void> {
  await safely(async () => {
    const existing = await getMirror(projectId, chapterId, variantId);
    if (!existing) return;
    await putMirror({
      ...existing,
      dirty: false,
      baseVersion: syncedVersion,
      savedAt: Date.now(),
    });
  }, undefined);
}

export async function clearMirror(
  projectId: string,
  chapterId: string,
  variantId: string
): Promise<void> {
  await safely(async () => {
    await run('readwrite', (store) =>
      store.delete(mirrorKey(projectId, chapterId, variantId)) as IDBRequest<undefined>
    );
  }, undefined);
}

/**
 * Decides what the editor should do when a variant is opened.
 *
 * Neither copy is ever destroyed here — this returns a recommendation the UI
 * turns into an explicit choice for the author.
 */
export type RecoveryDecision =
  | { kind: 'use-remote' }
  | { kind: 'offer-recovery'; local: MirrorSnapshot; reason: 'unsynced' | 'diverged' };

export function decideRecovery(
  local: MirrorSnapshot | null,
  remoteVersion: number,
  remotePlainText: string
): RecoveryDecision {
  if (!local) return { kind: 'use-remote' };

  // Local was never confirmed synced: it may hold work the server never saw.
  if (local.dirty) {
    // If the text is already identical, there is nothing to recover.
    if (local.plainText === remotePlainText && local.baseVersion === remoteVersion) {
      return { kind: 'use-remote' };
    }
    return { kind: 'offer-recovery', local, reason: 'unsynced' };
  }

  // Clean locally, but the server has moved on — another device saved.
  // Remote wins by default, and the local copy stays on disk untouched.
  if (local.baseVersion < remoteVersion) return { kind: 'use-remote' };

  return { kind: 'use-remote' };
}

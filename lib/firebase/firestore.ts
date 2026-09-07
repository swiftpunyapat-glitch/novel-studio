import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  where,
  orderBy,
  runTransaction,
} from 'firebase/firestore';
import { db } from './client';
import {
  Project,
  Volume,
  Chapter,
  DraftVariant,
  Revision,
  DEFAULT_DOCUMENT_SETTINGS,
  readContentVersion,
} from '@/types/project';
import { Character } from '@/types/character';

// ==================== PROJECTS ====================
export async function createProject(ownerId: string, title: string, description: string = ''): Promise<Project> {
  const id = doc(collection(db, 'projects')).id;
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || `novel-${Date.now()}`;

  const project: Project = {
    id,
    ownerId,
    title,
    slug,
    description,
    isPublished: false,
    documentSettings: { ...DEFAULT_DOCUMENT_SETTINGS },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await setDoc(doc(db, 'projects', id), project);
  return project;
}

export async function getProjects(ownerId: string): Promise<Project[]> {
  const q = query(collection(db, 'projects'), where('ownerId', '==', ownerId));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => d.data() as Project);
}

export async function getProject(projectId: string): Promise<Project | null> {
  const docRef = doc(db, 'projects', projectId);
  const snap = await getDoc(docRef);
  return snap.exists() ? (snap.data() as Project) : null;
}

export async function updateProjectSettings(projectId: string, settings: Partial<Project['documentSettings']>): Promise<void> {
  const docRef = doc(db, 'projects', projectId);
  await updateDoc(docRef, {
    'documentSettings': settings,
    updatedAt: Date.now(),
  });
}

// ==================== VOLUMES ====================
export async function createVolume(projectId: string, title: string, volumeNumber: number, order: number): Promise<Volume> {
  const id = doc(collection(db, 'projects', projectId, 'volumes')).id;
  const slug = `volume-${volumeNumber}`;
  const volume: Volume = {
    id,
    projectId,
    volumeNumber,
    title,
    slug,
    order,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await setDoc(doc(db, 'projects', projectId, 'volumes', id), volume);
  return volume;
}

export async function getVolumes(projectId: string): Promise<Volume[]> {
  const q = query(collection(db, 'projects', projectId, 'volumes'), orderBy('order', 'asc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => d.data() as Volume);
}

// ==================== CHAPTERS ====================
export async function createChapter(
  projectId: string,
  volumeId: string,
  title: string,
  chapterNumber: number | null,
  order: number
): Promise<{ chapter: Chapter; initialVariant: DraftVariant }> {
  const chapterId = doc(collection(db, 'projects', projectId, 'chapters')).id;
  const variantId = doc(collection(db, 'projects', projectId, 'chapters', chapterId, 'variants')).id;

  const initialVariant: DraftVariant = {
    id: variantId,
    chapterId,
    projectId,
    name: 'Draft A',
    status: 'candidate',
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '' }],
        },
      ],
    },
    plainText: '',
    wordCount: 0,
    characterCount: 0,
    contentVersion: 1,
    latestRevisionNumber: 0,
    lastSavedAt: Date.now(),
    lastEditedBySessionId: 'initial',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const chapter: Chapter = {
    id: chapterId,
    projectId,
    volumeId,
    chapterNumber,
    title,
    order,
    activeVariantId: variantId,
    totalWordCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await setDoc(doc(db, 'projects', projectId, 'chapters', chapterId), chapter);
  await setDoc(doc(db, 'projects', projectId, 'chapters', chapterId, 'variants', variantId), initialVariant);

  return { chapter, initialVariant };
}

export async function getChapters(projectId: string): Promise<Chapter[]> {
  const q = query(collection(db, 'projects', projectId, 'chapters'), orderBy('order', 'asc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => d.data() as Chapter);
}

export async function getChapter(projectId: string, chapterId: string): Promise<Chapter | null> {
  const docRef = doc(db, 'projects', projectId, 'chapters', chapterId);
  const snap = await getDoc(docRef);
  return snap.exists() ? (snap.data() as Chapter) : null;
}

export async function updateChapterMetadata(
  projectId: string,
  chapterId: string,
  data: Partial<Pick<Chapter, 'title' | 'subtitle' | 'chapterNumber' | 'dateText' | 'locationText' | 'order' | 'volumeId' | 'activeVariantId'>>
): Promise<void> {
  const docRef = doc(db, 'projects', projectId, 'chapters', chapterId);
  await updateDoc(docRef, { ...data, updatedAt: Date.now() });
}

// ==================== VARIANTS & REVISIONS ====================
export async function getVariant(projectId: string, chapterId: string, variantId: string): Promise<DraftVariant | null> {
  const docRef = doc(db, 'projects', projectId, 'chapters', chapterId, 'variants', variantId);
  const snap = await getDoc(docRef);
  return snap.exists() ? (snap.data() as DraftVariant) : null;
}

export async function getVariants(projectId: string, chapterId: string): Promise<DraftVariant[]> {
  const q = query(collection(db, 'projects', projectId, 'chapters', chapterId, 'variants'), orderBy('createdAt', 'asc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => d.data() as DraftVariant);
}

/** Everything a versioned save needs from the editor. */
export interface ManuscriptSnapshot {
  content: DraftVariant['content'];
  plainText: string;
  wordCount: number;
  characterCount: number;
}

export type SaveVariantResult =
  | { status: 'saved'; contentVersion: number; savedAt: number }
  | {
      status: 'conflict';
      remoteVersion: number;
      baseVersion: number;
      remote: ManuscriptSnapshot;
    };

/**
 * Versioned, atomic manuscript save. (Audit H4 / M5 / Stage 2A + 2I)
 *
 * The previous implementation was a blind `updateDoc` followed by a second,
 * unrelated `updateDoc` — last write wins, and a failure between the two left
 * chapter and variant metadata inconsistent.
 *
 * Now a single transaction reads the stored variant, refuses to write unless
 * its `contentVersion` still equals the caller's `baseVersion`, and commits the
 * content, all derived metadata and the incremented version together. On
 * mismatch nothing is written and the caller receives the remote content so the
 * conflict can be resolved without losing either side.
 */
export async function saveVariantContent(
  projectId: string,
  chapterId: string,
  variantId: string,
  snapshot: ManuscriptSnapshot,
  baseVersion: number,
  sessionId: string,
  options: { isActiveVariant?: boolean } = {}
): Promise<SaveVariantResult> {
  const variantRef = doc(db, 'projects', projectId, 'chapters', chapterId, 'variants', variantId);
  const chapterRef = doc(db, 'projects', projectId, 'chapters', chapterId);

  return runTransaction(db, async (tx) => {
    const variantSnap = await tx.get(variantRef);
    if (!variantSnap.exists()) {
      throw new Error('Draft variant no longer exists');
    }

    const remote = variantSnap.data() as DraftVariant;
    const remoteVersion = readContentVersion(remote);

    if (remoteVersion !== baseVersion) {
      // Another device advanced this variant. Write nothing.
      return {
        status: 'conflict' as const,
        remoteVersion,
        baseVersion,
        remote: {
          content: remote.content,
          plainText: remote.plainText ?? '',
          wordCount: remote.wordCount ?? 0,
          characterCount: remote.characterCount ?? 0,
        },
      };
    }

    const now = Date.now();
    const nextVersion = remoteVersion + 1;

    tx.update(variantRef, {
      content: snapshot.content,
      plainText: snapshot.plainText,
      wordCount: snapshot.wordCount,
      characterCount: snapshot.characterCount,
      contentVersion: nextVersion,
      lastSavedAt: now,
      lastEditedBySessionId: sessionId,
      updatedAt: now,
    });

    // chapter.totalWordCount tracks the ACTIVE variant only (see types/project.ts),
    // so editing a non-active variant must not clobber it.
    if (options.isActiveVariant !== false) {
      tx.update(chapterRef, {
        totalWordCount: snapshot.wordCount,
        updatedAt: now,
      });
    }

    return { status: 'saved' as const, contentVersion: nextVersion, savedAt: now };
  });
}

/**
 * Creates an immutable revision snapshot with a transactionally allocated
 * number. (Audit M6 / Stage 2H)
 *
 * The number is read and written inside the same transaction, so two devices
 * checkpointing concurrently serialise: one commits, the other retries against
 * the updated counter and receives the next number. Duplicate `revisionNumber`
 * values are therefore impossible.
 *
 * `content` must come from the LIVE editor, never from cached React state.
 */
export async function createRevisionCheckpoint(
  projectId: string,
  chapterId: string,
  variantId: string,
  snapshot: ManuscriptSnapshot,
  createdBy: string,
  label?: string,
  trigger: Revision['trigger'] = 'manual'
): Promise<Revision> {
  const variantRef = doc(db, 'projects', projectId, 'chapters', chapterId, 'variants', variantId);
  const revisionsCol = collection(
    db, 'projects', projectId, 'chapters', chapterId, 'variants', variantId, 'revisions'
  );

  return runTransaction(db, async (tx) => {
    const variantSnap = await tx.get(variantRef);
    if (!variantSnap.exists()) {
      throw new Error('Draft variant no longer exists');
    }

    const variant = variantSnap.data() as DraftVariant;
    const revisionNumber = (variant.latestRevisionNumber || 0) + 1;
    const revisionRef = doc(revisionsCol);

    const revision: Revision = {
      id: revisionRef.id,
      variantId,
      chapterId,
      projectId,
      revisionNumber,
      trigger,
      content: snapshot.content,
      plainText: snapshot.plainText,
      wordCount: snapshot.wordCount,
      createdAt: Date.now(),
      createdBy,
      ...(label ? { label } : {}),
    };

    tx.set(revisionRef, revision);
    tx.update(variantRef, {
      latestRevisionNumber: revisionNumber,
      updatedAt: Date.now(),
    });

    return revision;
  });
}

/**
 * Creates a new draft variant from content that could not be saved.
 * (Stage 2B — the preferred safe escape hatch from a conflict.)
 *
 * Nothing is overwritten: the remote variant keeps the other device's work and
 * this local content becomes a sibling draft the author can reconcile by hand.
 */
export async function createVariantFromContent(
  projectId: string,
  chapterId: string,
  snapshot: ManuscriptSnapshot,
  name: string
): Promise<DraftVariant> {
  const variantsCol = collection(db, 'projects', projectId, 'chapters', chapterId, 'variants');
  const variantRef = doc(variantsCol);
  const now = Date.now();

  const variant: DraftVariant = {
    id: variantRef.id,
    chapterId,
    projectId,
    name,
    status: 'draft',
    content: snapshot.content,
    plainText: snapshot.plainText,
    wordCount: snapshot.wordCount,
    characterCount: snapshot.characterCount,
    contentVersion: 1,
    latestRevisionNumber: 0,
    lastSavedAt: now,
    lastEditedBySessionId: 'conflict-rescue',
    createdAt: now,
    updatedAt: now,
  };

  await setDoc(variantRef, variant);
  return variant;
}

export async function getRevisions(projectId: string, chapterId: string, variantId: string): Promise<Revision[]> {
  const q = query(
    collection(db, 'projects', projectId, 'chapters', chapterId, 'variants', variantId, 'revisions'),
    orderBy('revisionNumber', 'desc')
  );
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => d.data() as Revision);
}

// ==================== CHARACTERS ====================
export async function getCharacters(projectId: string): Promise<Character[]> {
  const q = query(collection(db, 'projects', projectId, 'characters'), orderBy('name', 'asc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => d.data() as Character);
}

export async function createCharacter(projectId: string, data: Omit<Character, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>): Promise<Character> {
  const id = doc(collection(db, 'projects', projectId, 'characters')).id;
  const character: Character = {
    ...data,
    id,
    projectId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await setDoc(doc(db, 'projects', projectId, 'characters', id), character);
  return character;
}

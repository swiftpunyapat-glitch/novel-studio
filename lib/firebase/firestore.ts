import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
} from 'firebase/firestore';
import { db } from './client';
import { Project, Volume, Chapter, DraftVariant, Revision, DEFAULT_DOCUMENT_SETTINGS } from '@/types/project';
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
    latestRevisionNumber: 1,
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

export async function saveVariantContent(
  projectId: string,
  chapterId: string,
  variantId: string,
  content: DraftVariant['content'],
  plainText: string,
  wordCount: number,
  characterCount: number,
  sessionId: string
): Promise<void> {
  const now = Date.now();
  const variantRef = doc(db, 'projects', projectId, 'chapters', chapterId, 'variants', variantId);
  await updateDoc(variantRef, {
    content,
    plainText,
    wordCount,
    characterCount,
    lastSavedAt: now,
    lastEditedBySessionId: sessionId,
    updatedAt: now,
  });

  const chapterRef = doc(db, 'projects', projectId, 'chapters', chapterId);
  await updateDoc(chapterRef, {
    totalWordCount: wordCount,
    updatedAt: now,
  });
}

export async function createRevisionCheckpoint(
  projectId: string,
  chapterId: string,
  variantId: string,
  content: DraftVariant['content'],
  plainText: string,
  wordCount: number,
  createdBy: string,
  label?: string,
  trigger: Revision['trigger'] = 'manual'
): Promise<Revision> {
  const revisionId = doc(collection(db, 'projects', projectId, 'chapters', chapterId, 'variants', variantId, 'revisions')).id;
  const variant = await getVariant(projectId, chapterId, variantId);
  const revNum = (variant?.latestRevisionNumber || 0) + 1;

  const revision: Revision = {
    id: revisionId,
    variantId,
    chapterId,
    projectId,
    revisionNumber: revNum,
    label,
    trigger,
    content,
    plainText,
    wordCount,
    createdAt: Date.now(),
    createdBy,
  };

  await setDoc(doc(db, 'projects', projectId, 'chapters', chapterId, 'variants', variantId, 'revisions', revisionId), revision);
  
  await updateDoc(doc(db, 'projects', projectId, 'chapters', chapterId, 'variants', variantId), {
    latestRevisionNumber: revNum,
    updatedAt: Date.now(),
  });

  return revision;
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

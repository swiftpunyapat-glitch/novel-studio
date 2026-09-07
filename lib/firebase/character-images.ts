import { ref, getBlob, uploadBytes, deleteObject } from 'firebase/storage';
import { storage } from './client';
import type { CharacterReference } from '@/types/character';

/**
 * Authenticated access to private character reference images. (Audit C3 / H9)
 *
 * `storagePath` in Firestore is the canonical metadata. Bytes are fetched
 * through the authenticated Storage SDK, so every read is evaluated against
 * storage.rules and its project-ownership check. Nothing here mints or persists
 * a permanent public download URL.
 *
 * Callers must revoke the returned object URL when the image is unmounted.
 */

export function characterImagePath(
  projectId: string,
  characterId: string,
  fileName: string
): string {
  const safeName = fileName.replace(/[^\w.-]/g, '_').slice(0, 120);
  return `projects/${projectId}/characters/${characterId}/${Date.now()}_${safeName}`;
}

/**
 * Resolves a short-lived, in-memory object URL for a stored image.
 * Returns null when the caller is not authorized or the object is missing.
 */
export async function loadCharacterImageObjectUrl(
  storagePath: string
): Promise<string | null> {
  try {
    const blob = await getBlob(ref(storage, storagePath));
    return URL.createObjectURL(blob);
  } catch (err) {
    console.error('Unable to load character reference image', err);
    return null;
  }
}

export function releaseCharacterImageObjectUrl(objectUrl: string | null): void {
  if (objectUrl) URL.revokeObjectURL(objectUrl);
}

/** Uploads a reference image and returns the metadata to store in Firestore. */
export async function uploadCharacterImage(
  projectId: string,
  characterId: string,
  file: File
): Promise<Omit<CharacterReference, 'id' | 'caption'>> {
  const storagePath = characterImagePath(projectId, characterId, file.name);
  await uploadBytes(ref(storage, storagePath), file, { contentType: file.type });

  return {
    characterId,
    projectId,
    storagePath,
    fileSizeBytes: file.size,
    mimeType: file.type,
    createdAt: Date.now(),
  };
}

export async function deleteCharacterImage(storagePath: string): Promise<void> {
  await deleteObject(ref(storage, storagePath));
}

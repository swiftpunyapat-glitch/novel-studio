import {
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import fs from 'fs';
import path from 'path';

export const PROJECT_ID = 'novel-studio-test';

export const OWNER_UID = 'owner_uid_alice';
export const OTHER_UID = 'other_uid_mallory';

export const PROJECT_ID_DOC = 'project_alpha';
export const CHAPTER_ID = 'chapter_one';
export const VARIANT_ID = 'variant_draft_a';
export const REVISION_ID = 'revision_001';
export const CHARACTER_ID = 'character_ray';
export const PUBLIC_SLUG = 'the-long-road';

const root = path.resolve(__dirname, '../..');

export async function makeTestEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
    storage: {
      rules: fs.readFileSync(path.join(root, 'storage.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 9199,
    },
  });
}

/**
 * Seeds the private workspace owned by OWNER_UID, bypassing rules.
 * Mirrors the shapes written by lib/firebase/firestore.ts.
 */
export async function seed(testEnv: RulesTestEnvironment) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const now = Date.now();

    await db.doc(`projects/${PROJECT_ID_DOC}`).set({
      id: PROJECT_ID_DOC,
      ownerId: OWNER_UID,
      title: 'The Long Road',
      slug: PUBLIC_SLUG,
      description: 'A private draft',
      isPublished: false,
      createdAt: now,
      updatedAt: now,
    });

    await db.doc(`projects/${PROJECT_ID_DOC}/chapters/${CHAPTER_ID}`).set({
      id: CHAPTER_ID,
      projectId: PROJECT_ID_DOC,
      volumeId: 'volume_one',
      title: 'Chapter One',
      order: 0,
      activeVariantId: VARIANT_ID,
      totalWordCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    await db
      .doc(`projects/${PROJECT_ID_DOC}/chapters/${CHAPTER_ID}/variants/${VARIANT_ID}`)
      .set({
        id: VARIANT_ID,
        chapterId: CHAPTER_ID,
        projectId: PROJECT_ID_DOC,
        name: 'Draft A',
        status: 'candidate',
        content: { type: 'doc', content: [] },
        plainText: 'secret unpublished prose',
        wordCount: 3,
        characterCount: 24,
        contentVersion: 1,
        latestRevisionNumber: 1,
        createdAt: now,
        updatedAt: now,
      });

    await db
      .doc(
        `projects/${PROJECT_ID_DOC}/chapters/${CHAPTER_ID}/variants/${VARIANT_ID}/revisions/${REVISION_ID}`
      )
      .set({
        id: REVISION_ID,
        variantId: VARIANT_ID,
        chapterId: CHAPTER_ID,
        projectId: PROJECT_ID_DOC,
        revisionNumber: 1,
        trigger: 'manual',
        content: { type: 'doc', content: [] },
        plainText: 'frozen snapshot',
        wordCount: 2,
        createdAt: now,
        createdBy: OWNER_UID,
      });

    await db.doc(`projects/${PROJECT_ID_DOC}/characters/${CHARACTER_ID}`).set({
      id: CHARACTER_ID,
      projectId: PROJECT_ID_DOC,
      name: 'Ray',
      role: 'protagonist',
      writerNotes: 'plot secret',
      createdAt: now,
      updatedAt: now,
    });

    // Published snapshot, written only by the Admin SDK in production.
    await db.doc(`publicProjects/${PUBLIC_SLUG}`).set({
      slug: PUBLIC_SLUG,
      projectId: PROJECT_ID_DOC,
      title: 'The Long Road',
      publishedAt: now,
    });

    await db.doc(`publicProjects/${PUBLIC_SLUG}/chapters/${CHAPTER_ID}`).set({
      id: CHAPTER_ID,
      title: 'Chapter One',
      renderedHtml: '<p>published prose</p>',
      publishedAt: now,
    });
  });

  // Seed a character reference image into the Storage emulator.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const storage = ctx.storage();
    await storage
      .ref(`projects/${PROJECT_ID_DOC}/characters/${CHARACTER_ID}/portrait.png`)
      .put(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer, {
        contentType: 'image/png',
      });
  });
}

export const imagePath = `projects/${PROJECT_ID_DOC}/characters/${CHARACTER_ID}/portrait.png`;
export const variantPath = `projects/${PROJECT_ID_DOC}/chapters/${CHAPTER_ID}/variants/${VARIANT_ID}`;
export const revisionPath = `${variantPath}/revisions/${REVISION_ID}`;
export const publicChapterPath = `publicProjects/${PUBLIC_SLUG}/chapters/${CHAPTER_ID}`;

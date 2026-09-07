import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest';
import { RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, runTransaction } from 'firebase/firestore';
import {
  makeTestEnv,
  seed,
  OWNER_UID,
  PROJECT_ID_DOC,
  CHAPTER_ID,
  VARIANT_ID,
  variantPath,
} from './helpers';

/**
 * MANUAL ACCEPTANCE SCENARIO, executed automatically.
 *
 * This runs the two-device and offline scenarios from the Stage 2 brief against
 * the real Firestore rules engine and real transaction semantics, using the
 * same versioned save shape the client uses. It is the automated counterpart to
 * the browser walkthrough documented in docs/STAGE2-MANUAL-VERIFICATION.md.
 */

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await makeTestEnv();
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seed(testEnv);
});

/**
 * The rules-testing SDK hands back a compat Firestore instance that the modular
 * helpers accept at runtime, so the type is inferred from the env rather than
 * annotated with the modular `Firestore` type.
 */
type TestDb = ReturnType<ReturnType<RulesTestEnvironment['authenticatedContext']>['firestore']>;

/** Mirrors lib/firebase/firestore.ts saveVariantContent. */
async function versionedSave(
  db: TestDb,
  text: string,
  baseVersion: number
): Promise<{ status: 'saved'; contentVersion: number } | { status: 'conflict'; remoteVersion: number; remoteText: string }> {
  const variantRef = doc(db, variantPath);

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(variantRef);
    const data = snap.data() ?? {};
    const remoteVersion = typeof data.contentVersion === 'number' ? data.contentVersion : 0;

    if (remoteVersion !== baseVersion) {
      return {
        status: 'conflict' as const,
        remoteVersion,
        remoteText: (data.plainText as string) ?? '',
      };
    }

    tx.update(variantRef, {
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
      plainText: text,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      characterCount: text.length,
      contentVersion: remoteVersion + 1,
      lastSavedAt: Date.now(),
      updatedAt: Date.now(),
    });

    return { status: 'saved' as const, contentVersion: remoteVersion + 1 };
  });
}

describe('Acceptance: two devices editing the same chapter', () => {
  test('the stale device cannot overwrite the newer device', async () => {
    const pcA = testEnv.authenticatedContext(OWNER_UID).firestore();
    const pcB = testEnv.authenticatedContext(OWNER_UID).firestore();

    // Both machines open Chapter 1 at version N.
    const opened = await getDoc(doc(pcA, variantPath));
    const N = opened.data()!.contentVersion as number;
    expect(N).toBe(1);

    const pcABase = N;
    const pcBBase = N;

    // PC A writes and saves successfully -> N+1.
    const aResult = await versionedSave(pcA, 'Chapter one, written at the home PC.', pcABase);
    expect(aResult.status).toBe('saved');
    expect((aResult as { contentVersion: number }).contentVersion).toBe(N + 1);

    // PC B types into its stale copy and triggers a save.
    const bResult = await versionedSave(pcB, 'Different words typed on the Ultra Tennis PC.', pcBBase);

    // PC B MUST NOT overwrite PC A.
    expect(bResult.status).toBe('conflict');
    expect((bResult as { remoteVersion: number }).remoteVersion).toBe(N + 1);

    // The server still holds PC A's text at N+1.
    const after = await getDoc(doc(pcA, variantPath));
    expect(after.data()!.plainText).toBe('Chapter one, written at the home PC.');
    expect(after.data()!.contentVersion).toBe(N + 1);

    // The conflict result carries the remote text so PC B can show both sides.
    expect((bResult as { remoteText: string }).remoteText).toBe(
      'Chapter one, written at the home PC.'
    );
  });

  test('PC B can preserve its text as a new draft variant, losing nothing', async () => {
    const pcA = testEnv.authenticatedContext(OWNER_UID).firestore();
    const pcB = testEnv.authenticatedContext(OWNER_UID).firestore();

    await versionedSave(pcA, 'Home PC prose.', 1);
    const conflict = await versionedSave(pcB, 'Ultra Tennis PC prose.', 1);
    expect(conflict.status).toBe('conflict');

    // The escape hatch: local content becomes a sibling draft variant.
    const rescueId = 'variant_rescued';
    await setDoc(
      doc(pcB, `projects/${PROJECT_ID_DOC}/chapters/${CHAPTER_ID}/variants/${rescueId}`),
      {
        id: rescueId,
        chapterId: CHAPTER_ID,
        projectId: PROJECT_ID_DOC,
        name: 'Recovered from Ultra Tennis PC',
        status: 'draft',
        content: { type: 'doc', content: [] },
        plainText: 'Ultra Tennis PC prose.',
        wordCount: 4,
        characterCount: 22,
        contentVersion: 1,
        latestRevisionNumber: 0,
        lastSavedAt: Date.now(),
        lastEditedBySessionId: 'conflict-rescue',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
    );

    // Both texts now exist. Neither device lost work.
    const original = await getDoc(doc(pcA, variantPath));
    const rescued = await getDoc(
      doc(pcA, `projects/${PROJECT_ID_DOC}/chapters/${CHAPTER_ID}/variants/${rescueId}`)
    );

    expect(original.data()!.plainText).toBe('Home PC prose.');
    expect(rescued.data()!.plainText).toBe('Ultra Tennis PC prose.');
    expect(rescued.data()!.id).not.toBe(VARIANT_ID);
  });

  test('after reloading remote, the previously stale device can save again', async () => {
    const pcA = testEnv.authenticatedContext(OWNER_UID).firestore();
    const pcB = testEnv.authenticatedContext(OWNER_UID).firestore();

    await versionedSave(pcA, 'Home PC prose.', 1);
    const conflict = await versionedSave(pcB, 'stale attempt', 1);
    expect(conflict.status).toBe('conflict');

    // PC B accepts remote and rebases onto the newer version.
    const rebased = (conflict as { remoteVersion: number }).remoteVersion;
    const retry = await versionedSave(pcB, 'Continued on the Ultra Tennis PC.', rebased);

    expect(retry.status).toBe('saved');
    const after = await getDoc(doc(pcA, variantPath));
    expect(after.data()!.plainText).toBe('Continued on the Ultra Tennis PC.');
    expect(after.data()!.contentVersion).toBe(rebased + 1);
  });

  test('a legacy variant with no contentVersion migrates on first save', async () => {
    // Simulate a document written before Stage 2.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const legacyRef = ctx
        .firestore()
        .doc(`projects/${PROJECT_ID_DOC}/chapters/${CHAPTER_ID}/variants/legacy_variant`);
      await legacyRef.set({
        id: 'legacy_variant',
        chapterId: CHAPTER_ID,
        projectId: PROJECT_ID_DOC,
        name: 'Legacy Draft',
        status: 'draft',
        content: { type: 'doc', content: [] },
        plainText: 'written before Stage 2',
        wordCount: 4,
        characterCount: 22,
        latestRevisionNumber: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const db = testEnv.authenticatedContext(OWNER_UID).firestore();
    const legacyPath = `projects/${PROJECT_ID_DOC}/chapters/${CHAPTER_ID}/variants/legacy_variant`;

    // readContentVersion() treats a missing field as 0, so the first save is 0 -> 1.
    const result = await runTransaction(db, async (tx) => {
      const snap = await tx.get(doc(db, legacyPath));
      const data = snap.data() ?? {};
      const remoteVersion = typeof data.contentVersion === 'number' ? data.contentVersion : 0;
      expect(remoteVersion).toBe(0);

      tx.update(doc(db, legacyPath), {
        content: { type: 'doc', content: [] },
        plainText: 'migrated',
        contentVersion: remoteVersion + 1,
      });
      return remoteVersion + 1;
    });

    expect(result).toBe(1);
    const after = await getDoc(doc(db, legacyPath));
    expect(after.data()!.contentVersion).toBe(1);
  });
});

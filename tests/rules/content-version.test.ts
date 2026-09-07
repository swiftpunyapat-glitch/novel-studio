import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, runTransaction } from 'firebase/firestore';
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
 * Stage 2A/2H server-side enforcement.
 *
 * These run against the real rules engine, so they prove the invariant holds
 * even when the client is stale, buggy or hostile — client logic is not trusted.
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

const ownerDb = () => testEnv.authenticatedContext(OWNER_UID).firestore();

const newContent = { type: 'doc', content: [{ type: 'paragraph' }] };

describe('12. Firestore rules reject invalid contentVersion jumps', () => {
  test('a correct +1 step with new content is allowed', async () => {
    await assertSucceeds(
      updateDoc(doc(ownerDb(), variantPath), {
        content: newContent,
        plainText: 'edited',
        contentVersion: 2,
      })
    );
  });

  test('reusing the same version while changing content is denied', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), variantPath), {
        content: newContent,
        plainText: 'clobbered',
        contentVersion: 1,
      })
    );
  });

  test('skipping a version (+2) is denied', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), variantPath), {
        content: newContent,
        plainText: 'edited',
        contentVersion: 3,
      })
    );
  });

  test('rewinding the version is denied', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), variantPath), {
        content: newContent,
        plainText: 'edited',
        contentVersion: 0,
      })
    );
  });

  test('a large forward jump is denied', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), variantPath), {
        content: newContent,
        plainText: 'edited',
        contentVersion: 9999,
      })
    );
  });

  test('a non-integer version is denied', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), variantPath), {
        content: newContent,
        plainText: 'edited',
        contentVersion: 1.5,
      })
    );
  });

  test('a string version is denied', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), variantPath), {
        content: newContent,
        plainText: 'edited',
        contentVersion: '2',
      })
    );
  });

  test('changing content without touching contentVersion is denied', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), variantPath), {
        content: newContent,
        plainText: 'silently clobbered',
      })
    );
  });

  test('metadata-only updates are allowed without a version bump', async () => {
    await assertSucceeds(
      updateDoc(doc(ownerDb(), variantPath), {
        name: 'Draft A (renamed)',
        status: 'draft',
      })
    );
  });

  test('bumping latestRevisionNumber does not require a content version step', async () => {
    await assertSucceeds(
      updateDoc(doc(ownerDb(), variantPath), { latestRevisionNumber: 2 })
    );
  });

  test('a stale client cannot win by racing two saves at the same base', async () => {
    const db = ownerDb();
    // First save legitimately moves 1 -> 2.
    await assertSucceeds(
      updateDoc(doc(db, variantPath), {
        content: newContent,
        plainText: 'device A',
        contentVersion: 2,
      })
    );
    // Second device still holds base 1 and tries the same step.
    await assertFails(
      updateDoc(doc(db, variantPath), {
        content: newContent,
        plainText: 'device B',
        contentVersion: 2,
      })
    );
    const after = await getDoc(doc(db, variantPath));
    expect(after.data()?.plainText).toBe('device A');
  });
});

describe('11. Concurrent checkpoints cannot duplicate revisionNumber', () => {
  const revPath = (id: string) => `${variantPath}/revisions/${id}`;

  function revision(id: string, revisionNumber: number) {
    return {
      id,
      variantId: VARIANT_ID,
      chapterId: CHAPTER_ID,
      projectId: PROJECT_ID_DOC,
      revisionNumber,
      trigger: 'manual',
      content: newContent,
      plainText: 'snapshot',
      wordCount: 1,
      createdAt: Date.now(),
      createdBy: OWNER_UID,
    };
  }

  test('two concurrent transactional checkpoints allocate distinct numbers', async () => {
    const db = ownerDb();
    const variantRef = doc(db, variantPath);

    // Both transactions read the counter, then write. The emulator enforces
    // real transaction semantics, so one must retry against the updated value.
    async function checkpoint(suffix: string): Promise<number> {
      return runTransaction(db, async (tx) => {
        const snap = await tx.get(variantRef);
        const next = ((snap.data()?.latestRevisionNumber as number) || 0) + 1;
        tx.set(doc(db, revPath(`rev_${suffix}`)), revision(`rev_${suffix}`, next));
        tx.update(variantRef, { latestRevisionNumber: next });
        return next;
      });
    }

    const [a, b] = await Promise.all([checkpoint('a'), checkpoint('b')]);

    expect(a).not.toBe(b);
    expect(new Set([a, b]).size).toBe(2);

    const finalVariant = await getDoc(variantRef);
    expect(finalVariant.data()?.latestRevisionNumber).toBe(Math.max(a, b));
  });

  test('many concurrent checkpoints all receive unique numbers', async () => {
    const db = ownerDb();
    const variantRef = doc(db, variantPath);

    const results = await Promise.all(
      ['c', 'd', 'e', 'f'].map((suffix) =>
        runTransaction(db, async (tx) => {
          const snap = await tx.get(variantRef);
          const next = ((snap.data()?.latestRevisionNumber as number) || 0) + 1;
          tx.set(doc(db, revPath(`rev_${suffix}`)), revision(`rev_${suffix}`, next));
          tx.update(variantRef, { latestRevisionNumber: next });
          return next;
        })
      )
    );

    expect(new Set(results).size).toBe(results.length);
  });

  test('a revision still cannot be updated or deleted afterwards', async () => {
    const db = ownerDb();
    await assertSucceeds(setDoc(doc(db, revPath('rev_new')), revision('rev_new', 2)));
    await assertFails(updateDoc(doc(db, revPath('rev_new')), { plainText: 'tampered' }));
  });
});

import { beforeAll, afterAll, beforeEach, describe, expect, test } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
} from 'firebase/firestore';
import { ref, getBytes, uploadBytes } from 'firebase/storage';
import {
  makeTestEnv,
  seed,
  OWNER_UID,
  OTHER_UID,
  PROJECT_ID_DOC,
  CHAPTER_ID,
  VARIANT_ID,
  variantPath,
  revisionPath,
  publicChapterPath,
  imagePath,
} from './helpers';

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
const otherDb = () => testEnv.authenticatedContext(OTHER_UID).firestore();
const anonDb = () => testEnv.unauthenticatedContext().firestore();

const ownerStorage = () => testEnv.authenticatedContext(OWNER_UID).storage();
const otherStorage = () => testEnv.authenticatedContext(OTHER_UID).storage();

/**
 * The eleven cases required by the audit brief, in order.
 */
describe('Required security matrix', () => {
  test('1. Owner reads private draft -> ALLOW', async () => {
    await assertSucceeds(getDoc(doc(ownerDb(), variantPath)));
  });

  test('2. Owner writes working draft -> ALLOW', async () => {
    await assertSucceeds(
      updateDoc(doc(ownerDb(), variantPath), {
        plainText: 'revised prose',
        contentVersion: 2,
        updatedAt: Date.now(),
      })
    );
  });

  test('3. Anonymous reads private draft -> DENY', async () => {
    await assertFails(getDoc(doc(anonDb(), variantPath)));
  });

  test('4. Different authenticated user reads private draft -> DENY', async () => {
    await assertFails(getDoc(doc(otherDb(), variantPath)));
  });

  test('5. Anonymous reads published chapter -> ALLOW', async () => {
    await assertSucceeds(getDoc(doc(anonDb(), publicChapterPath)));
  });

  test('6. Public client writes published chapter -> DENY', async () => {
    await assertFails(
      setDoc(doc(anonDb(), publicChapterPath), { renderedHtml: '<p>defaced</p>' })
    );
    await assertFails(
      setDoc(doc(otherDb(), publicChapterPath), { renderedHtml: '<p>defaced</p>' })
    );
  });

  test('7. Different authenticated user reads character reference image -> DENY', async () => {
    await assertFails(getBytes(ref(otherStorage(), imagePath)));
  });

  test('8. Owner reads character reference image -> ALLOW', async () => {
    await assertSucceeds(getBytes(ref(ownerStorage(), imagePath)));
  });

  test('9. Client creates revision -> ALLOW', async () => {
    await assertSucceeds(
      setDoc(doc(ownerDb(), `${variantPath}/revisions/revision_002`), {
        id: 'revision_002',
        variantId: VARIANT_ID,
        chapterId: CHAPTER_ID,
        projectId: PROJECT_ID_DOC,
        revisionNumber: 2,
        trigger: 'manual',
        content: { type: 'doc', content: [] },
        plainText: 'new snapshot',
        wordCount: 2,
        createdAt: Date.now(),
        createdBy: OWNER_UID,
      })
    );
  });

  test('10. Client updates existing revision -> DENY', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), revisionPath), { plainText: 'tampered' })
    );
  });

  test('11. Client deletes revision -> DENY', async () => {
    await assertFails(deleteDoc(doc(ownerDb(), revisionPath)));
  });
});

/**
 * Supporting coverage for the same boundaries.
 */
describe('Supporting boundaries', () => {
  test('Different authenticated user cannot write another owner\'s draft', async () => {
    await assertFails(
      updateDoc(doc(otherDb(), variantPath), { plainText: 'hijacked' })
    );
  });

  test('Different authenticated user cannot read character writer notes', async () => {
    await assertFails(
      getDoc(doc(otherDb(), `projects/${PROJECT_ID_DOC}/characters/character_ray`))
    );
  });

  test('Different authenticated user cannot write character reference image', async () => {
    await assertFails(
      uploadBytes(ref(otherStorage(), imagePath), new Uint8Array([1, 2, 3]).buffer, {
        contentType: 'image/png',
      })
    );
  });

  test('Owner can write their own character reference image', async () => {
    await assertSucceeds(
      uploadBytes(ref(ownerStorage(), imagePath), new Uint8Array([1, 2, 3]).buffer, {
        contentType: 'image/png',
      })
    );
  });

  test('Anonymous cannot read the private project document', async () => {
    await assertFails(getDoc(doc(anonDb(), `projects/${PROJECT_ID_DOC}`)));
  });

  test('Client cannot write a publication audit record', async () => {
    await assertFails(
      setDoc(doc(ownerDb(), `projects/${PROJECT_ID_DOC}/publications/forged`), {
        scope: 'chapter',
        publishedBy: OWNER_UID,
      })
    );
  });

  test('Owner cannot reassign ownerId to another user', async () => {
    await assertFails(
      updateDoc(doc(ownerDb(), `projects/${PROJECT_ID_DOC}`), { ownerId: OTHER_UID })
    );
  });

  test('Client cannot create a public slug reservation', async () => {
    await assertFails(
      setDoc(doc(ownerDb(), 'publicSlugs/the-long-road'), {
        projectId: 'attacker_project',
      })
    );
  });
});

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
  type Firestore,
} from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || 'demo-api-key',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || 'novel-studio-demo.firebaseapp.com',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'novel-studio-demo',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || 'novel-studio-demo.appspot.com',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '123456789',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || '1:123456789:web:demo',
};

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

/**
 * Firestore with a persistent local cache in the browser. (Audit C5 / Stage 2C)
 *
 * Persistence was previously off entirely, so nothing survived a reload while
 * offline. `persistentMultipleTabManager` is used because the same manuscript
 * may legitimately be open in two tabs on one machine.
 *
 * IndexedDB does not exist during server rendering, so the plain in-memory
 * instance is used there. This is also why the explicit manuscript mirror
 * exists alongside the cache: the cache keeps the app working, the mirror makes
 * unsynced work visible and recoverable.
 */
function createFirestore(): Firestore {
  if (typeof window === 'undefined') {
    return getFirestore(app);
  }
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch {
    // Already initialised (fast refresh), or storage blocked by the browser.
    return getFirestore(app);
  }
}

export const auth = getAuth(app);
export const db = createFirestore();
export const storage = getStorage(app);

/**
 * Local emulator wiring, opt-in via NEXT_PUBLIC_USE_FIREBASE_EMULATORS=true.
 *
 * Needed to run the Stage 2 multi-device and offline acceptance scenarios in a
 * real browser without touching a production project. Never active unless the
 * variable is explicitly set.
 */
if (
  typeof window !== 'undefined' &&
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATORS === 'true'
) {
  const w = window as unknown as { __novelEmulatorsConnected?: boolean };
  if (!w.__novelEmulatorsConnected) {
    w.__novelEmulatorsConnected = true;
    try {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFirestoreEmulator(db, '127.0.0.1', 8080);
      connectStorageEmulator(storage, '127.0.0.1', 9199);
      console.warn('Firebase emulators connected (development only)');
    } catch (err) {
      console.error('Could not connect Firebase emulators', err);
    }
  }
}

export default app;

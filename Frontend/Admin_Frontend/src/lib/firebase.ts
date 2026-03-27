import { getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";
import { getAnalytics, isSupported, type Analytics } from "firebase/analytics";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import { getDatabase, type Database } from "firebase/database";

function buildFirebaseOptions(): FirebaseOptions | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY?.trim();
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim();
  const appId = import.meta.env.VITE_FIREBASE_APP_ID?.trim();
  if (!apiKey || !projectId || !appId) return null;

  // Canonical OAuth / Auth UI host for this web API key (e.g. bustracker-2966b.firebaseapp.com).
  // Do not read VITE_FIREBASE_AUTH_DOMAIN here — a stale value from another Firebase project breaks Google sign-in.
  const authDomain = `${projectId}.firebaseapp.com`;

  const opts: FirebaseOptions = {
    apiKey,
    authDomain,
    projectId,
    appId,
  };

  const storageBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET;
  const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID;
  const measurementId = import.meta.env.VITE_FIREBASE_MEASUREMENT_ID;
  const databaseURL = import.meta.env.VITE_FIREBASE_DATABASE_URL;
  if (storageBucket) opts.storageBucket = storageBucket;
  if (messagingSenderId) opts.messagingSenderId = messagingSenderId;
  if (measurementId) opts.measurementId = measurementId;
  if (databaseURL) opts.databaseURL = databaseURL;

  return opts;
}

/** True when Vite env has the minimum fields Firebase needs (avoids crashing the whole app). */
export function isFirebaseAuthConfigured(): boolean {
  return buildFirebaseOptions() !== null;
}

let cachedApp: FirebaseApp | null = null;
let analyticsInitStarted = false;

function ensureApp(): FirebaseApp | null {
  const options = buildFirebaseOptions();
  if (!options) return null;

  if (!cachedApp) {
    cachedApp = getApps().length > 0 ? getApps()[0]! : initializeApp(options);
    if (!analyticsInitStarted && typeof window !== "undefined") {
      analyticsInitStarted = true;
      void initAnalyticsWhenReady(cachedApp);
    }
  }
  return cachedApp;
}

let analyticsInstance: Analytics | null = null;

async function initAnalyticsWhenReady(app: FirebaseApp) {
  try {
    if (!(await isSupported())) return;
    analyticsInstance = getAnalytics(app);
  } catch {
    // ignore — ad blockers / SSR / unsupported environments
  }
}

/** Firebase Analytics instance after async init (may stay null). */
export function getFirebaseAnalytics(): Analytics | null {
  return analyticsInstance;
}

/** Returns Auth only when configured; otherwise null (no throw). */
export function getFirebaseAuth(): Auth | null {
  const app = ensureApp();
  if (!app) return null;
  return getAuth(app);
}

/** Returns Storage only when configured; otherwise null (no throw). */
export function getFirebaseStorage(): FirebaseStorage | null {
  const app = ensureApp();
  if (!app) return null;
  return getStorage(app);
}

/** Realtime Database — live map / broadcast mirrors (requires VITE_FIREBASE_DATABASE_URL). */
export function getFirebaseDatabase(): Database | null {
  const app = ensureApp();
  if (!app) return null;
  if (!import.meta.env.VITE_FIREBASE_DATABASE_URL) return null;
  return getDatabase(app);
}

const googleProvider = new GoogleAuthProvider();

export function getGoogleAuthProvider(): GoogleAuthProvider {
  return googleProvider;
}

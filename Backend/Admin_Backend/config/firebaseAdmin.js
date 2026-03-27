const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

let initialized = false;

function databaseUrlFromEnv() {
  const u = process.env.FIREBASE_DATABASE_URL;
  return u && String(u).trim() ? String(u).trim() : undefined;
}

function initFirebaseAdmin() {
  if (initialized) return true;

  const databaseURL = databaseUrlFromEnv();
  const appOptions = {};
  if (databaseURL) {
    appOptions.databaseURL = databaseURL;
  }

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    const full = path.isAbsolute(credPath) ? credPath : path.resolve(process.cwd(), credPath);
    try {
      if (fs.existsSync(full)) {
        const serviceAccount = JSON.parse(fs.readFileSync(full, "utf8"));
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
          ...appOptions,
        });
        initialized = true;
        return true;
      }
    } catch (e) {
      console.error("[firebase-admin] Failed to load GOOGLE_APPLICATION_CREDENTIALS:", e.message);
    }
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKeyRaw) return false;

  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
    ...appOptions,
  });
  initialized = true;
  return true;
}

/** True when Admin SDK is up and FIREBASE_DATABASE_URL is set (Realtime Database). */
function isRtdbConfigured() {
  return !!databaseUrlFromEnv() && initFirebaseAdmin();
}

function getRealtimeDb() {
  if (!databaseUrlFromEnv()) return null;
  if (!initFirebaseAdmin()) return null;
  try {
    return admin.database();
  } catch (e) {
    console.error("[firebase-admin] getRealtimeDb:", e.message);
    return null;
  }
}

async function verifyFirebaseIdToken(idToken) {
  const ok = initFirebaseAdmin();
  if (!ok) throw new Error("Firebase admin is not configured");
  return admin.auth().verifyIdToken(idToken);
}

/** For /health: connected | disabled | error */
async function getFirebaseRtdbHealth() {
  if (!databaseUrlFromEnv()) return "disabled";
  if (!initFirebaseAdmin()) return "disabled";
  try {
    await admin.database().ref(".info/connected").once("value");
    return "connected";
  } catch (e) {
    console.warn("[firebase-rtdb] health:", e.message);
    return "error";
  }
}

module.exports = {
  verifyFirebaseIdToken,
  initFirebaseAdmin,
  getRealtimeDb,
  isRtdbConfigured,
  getFirebaseRtdbHealth,
};

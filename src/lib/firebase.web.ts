// Web-side Firebase singleton, using the standard firebase JS SDK. On
// native (iOS/Android) the sibling firebase.ts re-exports
// @react-native-firebase; that package has no web support which is why this
// file exists. Both targets share the same Firestore project, so notes posted
// from the web debug page show up on devices using the native client too.

import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

for (const [k, v] of Object.entries(config)) {
  if (!v) throw new Error(`Missing Firebase env var for ${k}`);
}

export const app = getApps().length ? getApp() : initializeApp(config);
// On web, getAuth picks the default IndexedDB persistence, so anonymous UIDs
// survive page reloads without any extra wiring.
export const webAuth = getAuth(app);
export const webDb = getFirestore(app);

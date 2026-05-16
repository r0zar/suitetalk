import '@react-native-async-storage/async-storage';

import { getApp, getApps, initializeApp } from 'firebase/app';
import { initializeAuth } from 'firebase/auth';
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

// Firebase JS SDK v12+ auto-detects AsyncStorage in React Native and uses it for
// auth persistence. The side-effect import above ensures AsyncStorage is loaded
// before initializeAuth runs.
//
// initializeAuth must run exactly once per app. If you see
// "Firebase: Auth already initialized" in dev, restart Metro with --clear.
export const auth = initializeAuth(app);

export const db = getFirestore(app);

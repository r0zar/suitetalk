import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { initializeAuth } from 'firebase/auth';
// @ts-expect-error - getReactNativePersistence is missing from firebase/auth types in some versions
import { getReactNativePersistence } from 'firebase/auth';
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

// initializeAuth must run exactly once per app. On Fast Refresh in dev, the
// module re-evaluates; guard against re-init by checking getApps() length.
// If you see "Firebase: Auth already initialized" in dev, this guard isn't
// working — restart Metro with --clear.
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});

export const db = getFirestore(app);

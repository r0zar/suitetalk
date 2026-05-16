// Web identity service backed by Firebase Anonymous Auth + Firestore.
// Mirrors the native @react-native-firebase implementation in identity.ts so
// notes posted from web are first-class users in the same project.

import { signInAnonymously } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

import { webAuth, webDb } from './firebase.web';
import { generateHandle } from './handle-generator';

export type Identity = {
  uid: string;
  handle: string;
  isFresh: boolean;
};

const ONBOARDED_KEY = 'suitetalk.web.onboarded.v1';

function isOnboarded(): boolean {
  try {
    return globalThis.localStorage?.getItem(ONBOARDED_KEY) === '1';
  } catch {
    return false;
  }
}

function markOnboarded(): void {
  try {
    globalThis.localStorage?.setItem(ONBOARDED_KEY, '1');
  } catch {
    // ignore
  }
}

let inflight: Promise<Identity> | null = null;

async function resolveIdentity(): Promise<Identity> {
  const cred = await signInAnonymously(webAuth);
  const uid = cred.user.uid;

  const userRef = doc(webDb, 'users', uid);
  const snap = await getDoc(userRef);

  if (snap.exists()) {
    const handle = (snap.data().handle as string) ?? generateHandle();
    return { uid, handle, isFresh: !isOnboarded() };
  }

  const handle = generateHandle();
  await setDoc(userRef, { handle, createdAt: serverTimestamp() });
  return { uid, handle, isFresh: !isOnboarded() };
}

export function getIdentity(): Promise<Identity> {
  if (!inflight) inflight = resolveIdentity();
  return inflight;
}

export async function renameHandle(uid: string, handle: string): Promise<void> {
  const trimmed = handle.trim().toLowerCase();
  if (!/^[a-z0-9-]{2,32}$/.test(trimmed)) {
    throw new Error('Handle must be 2–32 lowercase letters, digits, or hyphens.');
  }
  await updateDoc(doc(webDb, 'users', uid), { handle: trimmed });
  markOnboarded();
  // Invalidate the cached identity so the next getIdentity() picks up the
  // new handle and isFresh = false.
  inflight = null;
}

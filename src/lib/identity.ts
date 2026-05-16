import AsyncStorage from '@react-native-async-storage/async-storage';
import { signInAnonymously } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

import { auth, db } from './firebase';
import { generateHandle } from './handle-generator';

const CACHE_KEY = 'suitetalk.identity.v1';

export type Identity = {
  uid: string;
  handle: string;
  isFresh: boolean; // true if this is the first-ever launch on this device
};

async function readCache(): Promise<Identity | null> {
  const raw = await AsyncStorage.getItem(CACHE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Identity;
  } catch {
    return null;
  }
}

async function writeCache(id: Identity): Promise<void> {
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(id));
}

// Concurrent callers (e.g. two components rendering useIdentity at once on
// first launch) must share a single in-flight resolution, or they'd race to
// signInAnonymously + setDoc and produce duplicate users/{uid} docs.
let inflight: Promise<Identity> | null = null;

async function resolveIdentity(): Promise<Identity> {
  const cached = await readCache();

  const cred = await signInAnonymously(auth);
  const uid = cred.user.uid;

  if (cached && cached.uid === uid) {
    return { ...cached, isFresh: false };
  }

  const userRef = doc(db, 'users', uid);
  const snap = await getDoc(userRef);

  if (snap.exists()) {
    const handle = (snap.data().handle as string) ?? generateHandle();
    const id: Identity = { uid, handle, isFresh: false };
    await writeCache(id);
    return id;
  }

  const handle = generateHandle();
  await setDoc(userRef, { handle, createdAt: serverTimestamp() });
  const id: Identity = { uid, handle, isFresh: true };
  await writeCache(id);
  return id;
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
  await updateDoc(doc(db, 'users', uid), { handle: trimmed });
  const cached = await readCache();
  if (cached?.uid === uid) await writeCache({ ...cached, handle: trimmed });
}

// Web stub for the identity service. The native (iOS/Android) implementation in
// identity.ts depends on @react-native-firebase, which has no web support. On
// web we return a deterministic local-only identity so the app shell renders
// and the debug page is usable, but no real auth or firestore writes happen.

import { generateHandle } from './handle-generator';

export type Identity = {
  uid: string;
  handle: string;
  isFresh: boolean;
};

const HANDLE_KEY = 'suitetalk.web.handle.v1';
const UID_KEY = 'suitetalk.web.uid.v1';

function readLocal(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // ignore (SSR / private mode)
  }
}

let inflight: Promise<Identity> | null = null;

async function resolveIdentity(): Promise<Identity> {
  let uid = readLocal(UID_KEY);
  const isFresh = !uid;
  if (!uid) {
    uid = `web-${Math.random().toString(36).slice(2, 10)}`;
    writeLocal(UID_KEY, uid);
  }
  let handle = readLocal(HANDLE_KEY);
  if (!handle) {
    handle = generateHandle();
    writeLocal(HANDLE_KEY, handle);
  }
  return { uid, handle, isFresh };
}

export function getIdentity(): Promise<Identity> {
  if (!inflight) inflight = resolveIdentity();
  return inflight;
}

export async function renameHandle(_uid: string, handle: string): Promise<void> {
  const trimmed = handle.trim().toLowerCase();
  if (!/^[a-z0-9-]{2,32}$/.test(trimmed)) {
    throw new Error('Handle must be 2–32 lowercase letters, digits, or hyphens.');
  }
  writeLocal(HANDLE_KEY, trimmed);
}

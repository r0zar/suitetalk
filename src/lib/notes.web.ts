// Web notes service backed by Firestore. Mirrors the API of the native
// notes.ts so the rest of the app code is identical across targets.

import {
  Timestamp,
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';

import { webDb } from './firebase.web';

export type Note = {
  id: string;
  authorUid: string;
  authorHandle: string;
  text: string;
  createdAt: Date | null;
};

const NOTES_LIMIT = 100;

function notesQuery() {
  return query(
    collection(webDb, 'notes'),
    orderBy('createdAt', 'desc'),
    limit(NOTES_LIMIT),
  );
}

function toNote(snap: QueryDocumentSnapshot): Note {
  const data = snap.data();
  const ts = data.createdAt as Timestamp | null;
  return {
    id: snap.id,
    authorUid: data.authorUid ?? '',
    authorHandle: data.authorHandle ?? '',
    text: data.text ?? '',
    createdAt: ts ? ts.toDate() : null,
  };
}

export function subscribeToNotes(
  onChange: (notes: Note[]) => void,
  onError?: (err: Error) => void,
): () => void {
  return onSnapshot(
    notesQuery(),
    (qs) => onChange(qs.docs.map(toNote)),
    (err) => onError?.(err),
  );
}

export async function postNote(input: {
  text: string;
  authorUid: string;
  authorHandle: string;
}): Promise<string> {
  const trimmed = input.text.trim();
  if (!trimmed) throw new Error('Note text cannot be empty.');
  const ref = await addDoc(collection(webDb, 'notes'), {
    text: trimmed,
    authorUid: input.authorUid,
    authorHandle: input.authorHandle,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

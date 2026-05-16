// Web stub for the notes service. The native implementation in notes.ts uses
// @react-native-firebase/firestore which has no web support. On web we keep
// notes in-memory and broadcast via a window-level EventTarget so the feed
// still works for local UI testing (the data doesn't leave the tab).

export type Note = {
  id: string;
  authorUid: string;
  authorHandle: string;
  text: string;
  createdAt: Date | null;
};

const store: Note[] = [];
const listeners = new Set<(notes: Note[]) => void>();

function notify(): void {
  for (const fn of listeners) fn([...store]);
}

export function subscribeToNotes(
  onChange: (notes: Note[]) => void,
  _onError?: (err: Error) => void,
): () => void {
  listeners.add(onChange);
  // initial snapshot
  onChange([...store]);
  return () => {
    listeners.delete(onChange);
  };
}

export async function postNote(input: {
  text: string;
  authorUid: string;
  authorHandle: string;
}): Promise<string> {
  const trimmed = input.text.trim();
  if (!trimmed) throw new Error('Note text cannot be empty.');
  const id = `web-${Math.random().toString(36).slice(2, 10)}`;
  const note: Note = {
    id,
    authorUid: input.authorUid,
    authorHandle: input.authorHandle,
    text: trimmed,
    createdAt: new Date(),
  };
  store.unshift(note);
  notify();
  return id;
}

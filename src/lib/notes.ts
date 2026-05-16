import firestore, {
  FirebaseFirestoreTypes,
} from '@react-native-firebase/firestore';

export type Note = {
  id: string;
  authorUid: string;
  authorHandle: string;
  text: string;
  createdAt: Date | null; // null while serverTimestamp is pending
};

const NOTES_LIMIT = 100;

function notesQuery() {
  return firestore()
    .collection('notes')
    .orderBy('createdAt', 'desc')
    .limit(NOTES_LIMIT);
}

function toNote(
  snap: FirebaseFirestoreTypes.QueryDocumentSnapshot,
): Note {
  const data = snap.data();
  const ts = data.createdAt as FirebaseFirestoreTypes.Timestamp | null;
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
  return notesQuery().onSnapshot(
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
  const ref = await firestore().collection('notes').add({
    text: trimmed,
    authorUid: input.authorUid,
    authorHandle: input.authorHandle,
    createdAt: firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

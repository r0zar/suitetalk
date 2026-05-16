import { cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// Initialize once per process. The service account JSON is provided as a
// base64-encoded env var so it fits cleanly into Fly secrets.
function ensureApp(): void {
  if (getApps().length > 0) return;
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!b64) throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 not set');
  const json = Buffer.from(b64, 'base64').toString('utf8');
  const sa = JSON.parse(json) as ServiceAccount;
  initializeApp({ credential: cert(sa) });
}

export async function writeNote(input: {
  authorUid: string;
  authorHandle: string;
  text: string;
}): Promise<string> {
  ensureApp();
  const trimmed = input.text.trim();
  if (!trimmed) throw new Error('Note text cannot be empty.');
  const ref = await getFirestore()
    .collection('notes')
    .add({
      authorUid: input.authorUid,
      authorHandle: input.authorHandle,
      text: trimmed,
      createdAt: FieldValue.serverTimestamp(),
    });
  return ref.id;
}

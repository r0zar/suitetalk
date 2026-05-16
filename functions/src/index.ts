import * as crypto from 'node:crypto';

import { initializeApp } from 'firebase-admin/app';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';

initializeApp();

const WEBHOOK_URL = defineString('WEBHOOK_URL', {
  description:
    'HTTPS endpoint that receives note.created events. Set via `firebase functions:config:set` or the Functions Console.',
});

const WEBHOOK_SECRET = defineSecret('WEBHOOK_SECRET');

type NoteDoc = {
  authorUid?: string;
  authorHandle?: string;
  text?: string;
  createdAt?: FirebaseFirestore.Timestamp;
};

type Payload = {
  type: 'note.created';
  version: '1';
  note: {
    id: string;
    authorUid: string;
    authorHandle: string;
    text: string;
    createdAt: string; // ISO
    wakePhrase: 'heads up';
  };
};

function sign(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

// Retries: 3 attempts at 1s / 4s / 16s. Returns true on the first 2xx.
async function deliver(url: string, secret: string, body: string): Promise<boolean> {
  const delays = [1000, 4000, 16000];
  for (let i = 0; i < delays.length; i++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Suitetalk-Signature': sign(secret, body),
        },
        body,
      });
      if (res.ok) return true;
      logger.warn('Webhook non-2xx', { status: res.status, attempt: i + 1 });
    } catch (err) {
      logger.warn('Webhook delivery error', { err, attempt: i + 1 });
    }
    if (i < delays.length - 1) {
      await new Promise((r) => setTimeout(r, delays[i]));
    }
  }
  return false;
}

export const onNoteCreated = onDocumentCreated(
  {
    document: 'notes/{noteId}',
    region: 'us-central1',
    secrets: [WEBHOOK_SECRET],
    // Per-instance concurrency on Functions v2 is fine; default is 80.
  },
  async (event) => {
    const url = WEBHOOK_URL.value();
    if (!url) {
      logger.info('WEBHOOK_URL not configured; skipping');
      return;
    }
    const secret = WEBHOOK_SECRET.value();
    if (!secret) {
      logger.warn('WEBHOOK_SECRET missing; skipping');
      return;
    }
    const snap = event.data;
    if (!snap) {
      logger.warn('No snapshot in event; skipping');
      return;
    }
    const data = snap.data() as NoteDoc;
    const payload: Payload = {
      type: 'note.created',
      version: '1',
      note: {
        id: snap.id,
        authorUid: data.authorUid ?? '',
        authorHandle: data.authorHandle ?? '',
        text: data.text ?? '',
        createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
        wakePhrase: 'heads up',
      },
    };
    const body = JSON.stringify(payload);
    const ok = await deliver(url, secret, body);
    if (!ok) logger.error('Webhook delivery failed after retries', { noteId: snap.id });
  },
);

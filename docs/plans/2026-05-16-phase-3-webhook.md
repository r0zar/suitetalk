# Phase 3: Webhook fan-out — Implementation Plan

> **Spec reference:** [`docs/mvp-spec.md`](../mvp-spec.md), §9 "Webhook contract" and §11 "Demo flow" (Act 2).

**Goal:** Every `notes/{noteId}` document that lands in Firestore fires an outbound HTTP POST to a configured webhook URL, signed with HMAC-SHA256. Failures retry with backoff but never block the note from appearing in the feed.

**Architecture deviation from the spec:** The spec puts the webhook fan-out inside the future Fly.io WS service. We're hoisting it to a **Firestore-triggered Cloud Function** instead. Rationale:

- Decouples webhook delivery from the audio pipeline. Phase 3 ships standalone — useful for the demo's Act 2 immediately, before voice exists.
- Captures *every* note write, including the debug "Post test note" button, voice-driven notes (later), and anything we add later. We don't need to remember to wire it up in every writer.
- Cloud Functions handle retries, observability, and concurrency for us. Less code than reimplementing those in the Fly.io service.

If we ever need sub-second webhook latency, we can move the fan-out back into the WS server's write path. Not needed for MVP.

**Tech stack:** Firebase Functions v2 (`onDocumentCreated`), Node 20, native `fetch`, `crypto.createHmac`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `functions/package.json` | Functions deps: `firebase-functions`, `firebase-admin`. |
| `functions/tsconfig.json` | TS config for the functions runtime. |
| `functions/src/index.ts` | Exports `onNoteCreated` Firestore trigger that fans out to the configured webhook URL with HMAC signing + retries. |
| `functions/.gitignore` | Ignore `lib/` (compiled output) and `node_modules`. |
| `firebase.json` | Project-root Firebase config, declaring the `functions` codebase. |
| `.firebaserc` | Pins the Firebase project (`suitetalk-ai`). |
| `firestore.rules` | Unchanged from Phase 2 — still allows authenticated note creates. |
| `docs/plans/2026-05-16-phase-3-webhook.md` | This plan. |

EAS / Vercel are not involved here. Cloud Functions live in their own deployment unit.

---

## Prerequisites (human steps before Task 1)

- [ ] **Upgrade to the Blaze plan.** Firestore-triggered Cloud Functions require the pay-as-you-go billing plan. The free tier covers far more than we'll use for a hackathon (millions of invocations/month free; outbound HTTP minor cents). Without Blaze, `firebase deploy --only functions` fails.

  Firebase Console → Project Settings → Usage and billing → **Modify plan → Blaze**. Add a payment method. Set a budget alert at $5/month for safety.

- [ ] **Verify or pick a webhook target.** For the hackathon demo, you need something to receive the POST and display it on stage. Options:
  - <https://webhook.site> — instant, free, gives you a temporary URL. Best for "Act 2" in the demo.
  - A local ngrok tunnel to a tiny Node script.
  - Skip the target for now — we can fire to `webhook.site` and configure the real URL on demo day.

- [ ] **Generate a webhook secret.** Any random string ≥32 chars. We'll store it as a Functions secret.

  ```bash
  openssl rand -hex 32
  ```

  Copy the output; you'll paste it into Task 4.

---

## Task 1: Bootstrap the functions codebase

**Files:**
- Create: `firebase.json`, `.firebaserc`, `functions/package.json`, `functions/tsconfig.json`, `functions/.gitignore`, `functions/src/index.ts` (stub)

- [ ] **Step 1: Check whether `firebase-tools` is installed**

  ```bash
  pnpm dlx firebase-tools --version
  ```

  This invocation downloads the CLI for one-time use. If you'd rather have it persistent, `pnpm add -g firebase-tools` works too.

- [ ] **Step 2: Create `.firebaserc`**

  ```json
  {
    "projects": {
      "default": "suitetalk-ai"
    }
  }
  ```

- [ ] **Step 3: Create `firebase.json`**

  ```json
  {
    "firestore": {
      "rules": "firestore.rules"
    },
    "functions": [
      {
        "source": "functions",
        "codebase": "default",
        "runtime": "nodejs20",
        "ignore": [
          "node_modules",
          ".git",
          "firebase-debug.log",
          "firebase-debug.*.log",
          "*.local"
        ]
      }
    ]
  }
  ```

  This also formally registers `firestore.rules` so `firebase deploy --only firestore:rules` works (which is nice — eliminates the paste-into-the-Firebase-console step from Phase 1 Task 8 and Phase 2 Task 6).

- [ ] **Step 4: Create `functions/package.json`**

  ```json
  {
    "name": "suitetalk-functions",
    "version": "1.0.0",
    "private": true,
    "main": "lib/index.js",
    "engines": { "node": "20" },
    "scripts": {
      "build": "tsc",
      "serve": "pnpm run build && firebase emulators:start --only functions",
      "deploy": "firebase deploy --only functions",
      "logs": "firebase functions:log"
    },
    "dependencies": {
      "firebase-admin": "^12.7.0",
      "firebase-functions": "^6.0.1"
    },
    "devDependencies": {
      "typescript": "^5.5.4"
    }
  }
  ```

  Cloud Functions doesn't honor pnpm workspaces — we use a separate node_modules under `functions/`. That's the standard Firebase pattern.

- [ ] **Step 5: Create `functions/tsconfig.json`**

  ```json
  {
    "compilerOptions": {
      "module": "commonjs",
      "noImplicitReturns": true,
      "noUnusedLocals": true,
      "outDir": "lib",
      "sourceMap": true,
      "strict": true,
      "target": "es2022",
      "skipLibCheck": true,
      "esModuleInterop": true
    },
    "compileOnSave": true,
    "include": ["src"]
  }
  ```

- [ ] **Step 6: Create `functions/.gitignore`**

  ```
  lib/
  node_modules/
  *.log
  ```

- [ ] **Step 7: Create `functions/src/index.ts` (empty stub)**

  ```ts
  // Cloud Functions for SuiteTalk. Real exports arrive in Task 2.
  export {};
  ```

- [ ] **Step 8: Install functions dependencies**

  ```bash
  cd functions && pnpm install
  ```

  Expected: ~50 packages installed, no errors. `functions/lib/` does not exist yet (that's the compile output).

- [ ] **Step 9: Verify the functions build compiles**

  ```bash
  cd functions && pnpm run build
  ls lib/index.js
  ```

  Expected: `lib/index.js` exists.

- [ ] **Step 10: Commit**

  ```bash
  cd /Users/ross/Documents/suitetalk
  git add firebase.json .firebaserc functions/package.json functions/tsconfig.json functions/.gitignore functions/src/index.ts functions/pnpm-lock.yaml
  git commit -m "Bootstrap firebase functions codebase"
  ```

  (If pnpm produced `functions/pnpm-lock.yaml`, include it. If it didn't — e.g. you ran `npm install` instead — stage `functions/package-lock.json`.)

---

## Task 2: Implement the Firestore trigger

**Files:**
- Rewrite: `functions/src/index.ts`

The function runs on `notes/{noteId}` create events, reads the new doc, signs a payload with HMAC-SHA256, and POSTs to `WEBHOOK_URL` with retries.

- [ ] **Step 1: Replace `functions/src/index.ts`**

  ```ts
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
  ```

- [ ] **Step 2: Build**

  ```bash
  cd functions && pnpm run build
  ```

  Expected: clean build, no TS errors.

- [ ] **Step 3: Commit**

  ```bash
  cd /Users/ross/Documents/suitetalk
  git add functions/src/index.ts
  git commit -m "Add onNoteCreated webhook fan-out function"
  ```

---

## Task 3: Local emulator smoke test (optional but high-value)

Before deploying, run the function against the Firebase Emulator Suite to confirm it fires and posts.

**Files:** None modified.

- [ ] **Step 1: Start a throwaway webhook target**

  Easiest: open <https://webhook.site> in a browser; copy the unique URL it generates. That's your `WEBHOOK_URL` for the test.

- [ ] **Step 2: Set the parameters for emulator runs**

  ```bash
  cd functions
  echo "WEBHOOK_URL=https://webhook.site/<your-uuid>" > .env.local
  ```

  And the secret:

  ```bash
  echo "WEBHOOK_SECRET=$(openssl rand -hex 32)" >> .secret.local
  ```

  Firebase emulator reads `.env.local` for params and `.secret.local` for secrets. Both are gitignored by `functions/.gitignore`'s `*.local` pattern.

- [ ] **Step 3: Run emulators with auth + firestore + functions**

  ```bash
  cd functions
  pnpm dlx firebase-tools emulators:start --only auth,firestore,functions
  ```

  Wait for "All emulators ready!" Logs print to the same terminal.

- [ ] **Step 4: Trigger a note creation**

  In a second terminal, use the Firestore emulator UI (`http://localhost:4000/firestore`) to manually add a doc to `notes/test1`:

  ```json
  {
    "authorUid": "uid_test",
    "authorHandle": "test-otter",
    "text": "lobby coffee machine is jammed",
    "createdAt": <serverTimestamp>
  }
  ```

  Expected:
  - The Functions emulator log shows the function invocation.
  - <https://webhook.site/<your-uuid>> receives a POST with the JSON payload.
  - The `X-Suitetalk-Signature` header is present.

- [ ] **Step 5: Verify the signature manually (one-time confidence check)**

  Copy the body that webhook.site shows and run:

  ```bash
  SECRET=$(grep WEBHOOK_SECRET functions/.secret.local | cut -d= -f2)
  echo -n '<the exact body from webhook.site>' | openssl dgst -sha256 -hmac "$SECRET"
  ```

  The hex digest should match what's in `X-Suitetalk-Signature`. If it doesn't, the signing code is wrong — STOP and debug.

- [ ] **Step 6: Stop the emulators** (Ctrl-C). No commit; this task is verification only.

---

## Task 4: Configure production secrets and webhook URL

**Files:** None modified. This is environment config in the Firebase project.

- [ ] **Step 1: Set the production webhook URL** (also via the Firebase console under Functions → Configuration if you prefer)

  ```bash
  pnpm dlx firebase-tools functions:params:set WEBHOOK_URL "https://webhook.site/<your-uuid>"
  ```

  For the demo, webhook.site is fine. For real downstream-AI work, replace with your orchestrator's endpoint.

- [ ] **Step 2: Set the production secret**

  ```bash
  pnpm dlx firebase-tools functions:secrets:set WEBHOOK_SECRET
  ```

  Paste the same hex string from the prerequisites at the prompt.

  Verify:

  ```bash
  pnpm dlx firebase-tools functions:secrets:access WEBHOOK_SECRET
  ```

  (You'll be prompted to confirm; this prints the secret to your terminal once. Don't paste it elsewhere.)

---

## Task 5: Deploy

**Files:** None modified.

- [ ] **Step 1: Deploy rules first** (so any pending Phase 2 rules updates land too)

  ```bash
  pnpm dlx firebase-tools deploy --only firestore:rules
  ```

  Expected: "Deploy complete!" If this fails with a rules syntax error, the rules file in the repo is the problem — fix it and retry.

- [ ] **Step 2: Deploy the function**

  ```bash
  pnpm dlx firebase-tools deploy --only functions:onNoteCreated
  ```

  First deploy takes a few minutes (cold artifact registry pulls).

  Expected on success:
  - "✔ functions[us-central1-onNoteCreated] Successful create operation."
  - URL printed for the deployed function (not relevant — it's a Firestore trigger, not HTTP).

- [ ] **Step 3: End-to-end verification**

  1. Open <https://webhook.site/<your-uuid>> in a browser tab.
  2. In the SuiteTalk app, tap the Debug FAB → "Post test note".
  3. Watch webhook.site — within a second or two, you should see a POST land with the right JSON shape, the `X-Suitetalk-Signature` header, and the right note text/handle.
  4. Tail the function logs to confirm no errors:

     ```bash
     pnpm dlx firebase-tools functions:log -n 20
     ```

---

## Phase 3 acceptance checklist

- [ ] Cloud Function `onNoteCreated` deploys cleanly.
- [ ] Every note created (via the debug button or, later, via the voice path) triggers exactly one POST to `WEBHOOK_URL`.
- [ ] The payload matches the spec exactly: `type`, `version`, `note.id`, `note.authorUid`, `note.authorHandle`, `note.text`, `note.createdAt` (ISO), `note.wakePhrase = "heads up"`.
- [ ] `X-Suitetalk-Signature` is present and validates as `hex(hmac-sha256(WEBHOOK_SECRET, body))`.
- [ ] If the webhook target returns 5xx three times, the function logs a final error but the note still shows up in the in-app feed.
- [ ] Firestore rules deploy cleanly (Phase 1 + 2 rules are now formally deployed, not just pasted in the console).
- [ ] No PII or secrets in committed files.

When all check, Phase 3 is done.

---

## Risks + mitigations

| Risk | Mitigation |
| --- | --- |
| Blaze billing surprises the user | Set the budget alert at $5/month. Cloud Functions invocations + outbound HTTP for hackathon volumes are well under a dollar. |
| Webhook target down during demo | Webhook delivery retries 3x; the in-app feed is unaffected. We can also point the URL at a backup (e.g. a second webhook.site URL) right before the demo. |
| Cold-start latency adds visible delay | Function cold starts on us-central1 are ~1.5s. After the first note in a session, subsequent ones are <200ms. Acceptable per the 2-second p95 budget. |
| Replay attacks against the webhook target | The HMAC signature plus a timestamp (we add `createdAt` to the payload) lets the receiver reject replays older than N seconds. Out of scope to enforce here; documented for the receiver to handle. |
| Local emulator test passes but prod fails because secrets aren't set | Task 4 sets prod secrets before deploy. Add a Phase 5+ smoke-test alert if we want belt-and-suspenders. |

---

## Out of scope for Phase 3 (deferred)

- Per-event idempotency keys (the function does at-least-once delivery; the receiver must dedupe by `note.id`).
- Webhook deletion / pause UI in the app.
- Multiple webhook subscribers / fan-out to N URLs (one URL is enough for MVP).
- Webhook delivery dashboards.
- Replay protection enforcement on the SuiteTalk side (it's the receiver's job).

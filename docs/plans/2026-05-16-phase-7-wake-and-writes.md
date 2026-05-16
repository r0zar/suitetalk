# Phase 7: Wake phrase + Firestore writes — Implementation Plan

> **Spec reference:** [`docs/mvp-spec.md`](../mvp-spec.md), §7 audio/wake pipeline + §11 demo flow Act 1.

**Goal:** The server already receives a stream of committed transcripts from ElevenLabs (Phase 6). Now it watches that stream for the literal phrase **"heads up"** and writes the next utterance to Firestore as a `notes/{noteId}` doc. Each note auto-fires the Phase 3 webhook. The voice → feed → AI loop becomes real.

**Architecture decision:** the state machine is server-side, owned per WebSocket session. The phone just streams mic audio; everything else (transcribing, wake detection, utterance capture, note write) happens on Fly. This matches §7 of the spec and keeps the React Native bundle small.

```
committed_transcript stream  ──►  WakeMachine (per-session, in memory)
                                  state: IDLE → ARMED → CAPTURING → COMMIT
                                          │
                                          ▼
                                  notes/{noteId} write
                                          │
                                          ▼ (Phase 3 trigger fires)
                                  outbound webhook to webhook.site
```

**Tech stack:** Same as Phase 5/6 on the server side. Adds `firebase-admin` so the server can write to Firestore directly. The current Firestore security rules require `request.auth.uid == authorUid` on create — that doesn't apply to Admin SDK writes (admin bypasses rules), so Firestore stays locked down to client writers and the server can write freely.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `server/src/wake-machine.ts` | Pure state machine: `feed(text: string, isCommitted: boolean)` returns one of `{ kind: 'idle' | 'armed' | 'utterance', text? }`. Captures the words after "heads up" until the next committed boundary. No side effects. |
| `server/src/firestore.ts` | Thin Firebase Admin SDK wrapper. Initializes the app from a base64-encoded service account JSON env var. Exports `writeNote({ authorUid, authorHandle, text }) => Promise<string>`. |
| `server/src/server.ts` | Wire it in: per session, instantiate a `WakeMachine`, feed each `committed_transcript`, and when an utterance lands, call `writeNote` with the session's authenticated identity. |
| `server/package.json` | Add `firebase-admin` dependency. |
| `server/.env.local` | Local-only env file for emulator runs. Add `FIREBASE_SERVICE_ACCOUNT_BASE64`. Gitignored. |
| `firestore.rules` | No change — admin SDK bypasses rules. Phase 2's `allow create: ...` for clients stays as-is (debug button keeps working). |

A few non-changes worth flagging:
- We do NOT verify the client's Firebase ID token on the WS yet. That's a security gap (anyone with the URL can write notes attributed to any UID), but it's deferred to a later hardening pass. The spec acknowledges this in §12.
- We do NOT change the client-side `hello` message. The server still trusts the `clientId` and `handle` the client claims at connect time. Same caveat.
- We do NOT add a UI for triggering wake — voice is the only way to write notes from this phase onward (the Debug "Post test note" button continues to write client-side for ad-hoc testing).

---

## Wake state machine (the heart of this phase)

States:

- **IDLE** — listening for "heads up" in incoming committed transcripts.
- **ARMED** — saw "heads up" in the current committed segment; capturing any text that came AFTER it in the same segment (the user might have said "heads up room 412 needs towels" all in one breath, so the rest of that committed transcript IS the utterance).
- **CAPTURING** — "heads up" was the LAST words of the previous committed segment (or the segment that immediately followed was empty); waiting for the NEXT non-empty committed transcript and treating that as the utterance.
- After a successful utterance, machine returns to IDLE.

Key behaviors:

1. **Case-insensitive match.** "Heads up", "HEADS UP", "heads-up" all trigger. We normalize whitespace + punctuation when matching.
2. **The wake phrase is stripped from the captured utterance.** Output text is just what the user said *after* "heads up", never the phrase itself.
3. **Partial transcripts are ignored** by the state machine. Only `committed_transcript` events drive it. This is the whole point of VAD: ElevenLabs tells us when an utterance is done.
4. **Empty committed transcripts** (which we saw in Phase 6 from the early flush) advance the machine but don't get written. They're a no-op for note creation, but they DO arm/capture state transitions.
5. **No "heads up" in transcript = no note.** Pre-wake committed transcripts are dropped on the floor. This is intentional — see Risk 1 below.
6. **Whitespace-only or punctuation-only captured utterances are dropped.** "Heads up." followed by nothing meaningful = no note.

Worked examples (state shown after each input):

| Input event | State | Action |
| --- | --- | --- |
| `committed: "good morning"` | IDLE | drop |
| `committed: "heads up room 412 needs extra towels"` | IDLE → utterance | write note "room 412 needs extra towels" |
| `committed: "heads up"` | IDLE → CAPTURING | (waiting) |
| `committed: "the coffee machine is jammed"` | CAPTURING → utterance | write note "the coffee machine is jammed" |
| `committed: "what a day"` | IDLE | drop |
| `committed: "Heads Up, lobby A/C broken"` | IDLE → utterance | write note "lobby A/C broken" |
| `committed: ""` | IDLE | drop (no state change) |

---

## Task 1: The wake state machine (pure)

**Files:**
- Create: `server/src/wake-machine.ts`

A standalone module. Side-effect-free. Testable in isolation. We're not actually writing tests (MVP testing waived), but isolating the logic makes the bug surface tiny.

- [ ] **Step 1: Create `server/src/wake-machine.ts`**

  ```ts
  // Detects the wake phrase "heads up" in a stream of committed
  // transcripts and captures the next utterance. Pure: no side effects,
  // no I/O. The server owns one of these per WebSocket session.

  export type WakeResult =
    | { kind: 'idle' }
    | { kind: 'armed' }       // waiting for the next non-empty committed transcript
    | { kind: 'utterance'; text: string };

  type State = 'IDLE' | 'CAPTURING';

  const WAKE_RE = /\bheads[\s-]+up\b[\s,.!?:;-]*/i;

  function isMeaningful(text: string): boolean {
    return /\S/.test(text.replace(/[\s.,!?;:-]+/g, ''));
  }

  export class WakeMachine {
    private state: State = 'IDLE';

    feed(text: string): WakeResult {
      const trimmed = text.trim();

      if (this.state === 'IDLE') {
        const match = WAKE_RE.exec(trimmed);
        if (!match) return { kind: 'idle' };

        // "heads up" appears in the committed transcript. Whatever follows
        // it in the same transcript is the utterance.
        const after = trimmed.slice((match.index ?? 0) + match[0].length).trim();
        if (after && isMeaningful(after)) {
          // Single-shot capture: "heads up X" → utterance "X", stay IDLE.
          return { kind: 'utterance', text: after };
        }
        // Wake phrase landed alone; the next non-empty committed transcript
        // is the utterance.
        this.state = 'CAPTURING';
        return { kind: 'armed' };
      }

      // CAPTURING — waiting for an utterance.
      if (!isMeaningful(trimmed)) {
        // empty / punctuation-only commit; keep waiting.
        return { kind: 'armed' };
      }
      this.state = 'IDLE';
      return { kind: 'utterance', text: trimmed };
    }

    reset(): void {
      this.state = 'IDLE';
    }
  }
  ```

- [ ] **Step 2: Build to verify TS**

  ```bash
  cd server && pnpm run build
  ```

  Expected: clean.

- [ ] **Step 3: Commit**

  ```bash
  cd /Users/ross/Documents/suitetalk
  git add server/src/wake-machine.ts
  git commit -m "Add wake-phrase state machine"
  ```

---

## Task 2: Firebase Admin SDK wrapper

**Files:**
- Modify: `server/package.json` (add `firebase-admin`)
- Create: `server/src/firestore.ts`

The service account JSON gets passed as a base64-encoded blob via the `FIREBASE_SERVICE_ACCOUNT_BASE64` env var. This is the standard Fly pattern for multi-line secrets per <https://fly.io/docs/apps/secrets/>.

- [ ] **Step 1: Add the dep**

  ```bash
  cd server && pnpm add firebase-admin
  ```

  Expected output: `+ firebase-admin <version>`.

- [ ] **Step 2: Create `server/src/firestore.ts`**

  ```ts
  import { cert, getApp, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
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
  ```

- [ ] **Step 3: Build**

  ```bash
  cd server && pnpm run build
  ```

- [ ] **Step 4: Commit**

  ```bash
  cd /Users/ross/Documents/suitetalk
  git add server/package.json server/pnpm-lock.yaml server/src/firestore.ts
  git commit -m "Add firebase-admin firestore writer"
  ```

---

## Task 3: Provision Firebase service account + Fly secret (human step)

This task is configuration, not code. Do it before Task 4 deploys.

- [ ] **Step 1: Generate a service account key**

  1. Open <https://console.firebase.google.com/project/suitetalk-ai/settings/serviceaccounts/adminsdk>
  2. Click **Generate new private key** → confirm → JSON file downloads
  3. Move it somewhere safe (NOT inside the repo). E.g. `~/Downloads/suitetalk-sa.json`

- [ ] **Step 2: Base64-encode it**

  macOS:

  ```bash
  base64 -i ~/Downloads/suitetalk-sa.json | tr -d '\n' | pbcopy
  ```

  Linux:

  ```bash
  base64 -w 0 ~/Downloads/suitetalk-sa.json | xclip -selection clipboard
  ```

  The encoded value is now on your clipboard.

- [ ] **Step 3: Set the Fly secret**

  ```bash
  fly secrets set FIREBASE_SERVICE_ACCOUNT_BASE64="$(pbpaste)" --app suitetalk-ws
  ```

  Fly restarts the machines automatically. Verify:

  ```bash
  fly secrets list --app suitetalk-ws
  ```

  Should show two secrets: `ELEVENLABS_API_KEY` and `FIREBASE_SERVICE_ACCOUNT_BASE64`.

- [ ] **Step 4: Add to `server/.env.local` for local dev**

  Append to `server/.env.local`:

  ```
  FIREBASE_SERVICE_ACCOUNT_BASE64=<paste the same base64 string here>
  ```

  This file is already gitignored via `server/.gitignore`.

- [ ] **Step 5: Delete the local JSON file** — the base64 in Fly + .env.local is your source of truth now.

  ```bash
  rm ~/Downloads/suitetalk-sa.json
  ```

---

## Task 4: Wire wake + writes into the WebSocket server

**Files:**
- Modify: `server/src/server.ts`

- [ ] **Step 1: Read `server/src/server.ts`**

  Required before editing. You'll need to know the exact location of:
  - The `clientHandle` declaration
  - The `committed_transcript` case of the upstream event switch
  - The hello / connection setup

- [ ] **Step 2: Add the imports**

  ```ts
  import { WakeMachine } from './wake-machine.js';
  import { writeNote } from './firestore.js';
  ```

- [ ] **Step 3: Inside `wss.on('connection', ...)`, instantiate a wake machine per session**

  Right after the `let clientHandle: string | null = null;` line, add:

  ```ts
  let clientUid: string | null = null;
  const wake = new WakeMachine();
  ```

- [ ] **Step 4: Capture `clientUid` from the `hello` message**

  In the existing `hello` case:

  ```ts
  case 'hello':
    clientUid = msg.clientId;
    clientHandle = msg.handle;
    sessionLog.info({ clientId: msg.clientId, handle: msg.handle }, 'hello');
    break;
  ```

- [ ] **Step 5: Feed committed transcripts into the wake machine**

  Replace the existing `committed_transcript` case in the upstream `onEvent` switch with:

  ```ts
  case 'committed_transcript': {
    sessionLog.info({ text: event.text }, 'committed transcript');
    send(ws, { type: 'transcript', kind: 'committed', text: event.text });
    const result = wake.feed(event.text);
    if (result.kind === 'utterance') {
      const uid = clientUid;
      const handle = clientHandle;
      if (!uid || !handle) {
        sessionLog.warn('wake triggered but client identity missing; skipping note');
        break;
      }
      writeNote({ authorUid: uid, authorHandle: handle, text: result.text })
        .then((noteId) => {
          sessionLog.info({ noteId, text: result.text }, 'note written');
        })
        .catch((err) => {
          sessionLog.error({ err }, 'failed to write note');
        });
    } else if (result.kind === 'armed') {
      sessionLog.info('wake armed; capturing next utterance');
    }
    break;
  }
  ```

  The brace-block around the case statement is intentional — `const` inside `switch` cases needs its own scope.

- [ ] **Step 6: Build**

  ```bash
  cd server && pnpm run build
  ```

- [ ] **Step 7: Deploy**

  ```bash
  cd server && fly deploy
  ```

  First deploy after adding `firebase-admin` may be slower because of the new dependency (a few hundred kB of additional packages in the layer). 3–5 min.

  Wait for `Visit your newly deployed app at https://suitetalk-ws.fly.dev/`.

- [ ] **Step 8: Verify health**

  ```bash
  curl -s https://suitetalk-ws.fly.dev/health
  ```

  Expected: `ok`.

- [ ] **Step 9: Commit**

  ```bash
  cd /Users/ross/Documents/suitetalk
  git add server/src/server.ts
  git commit -m "Detect wake phrase and write notes to firestore"
  ```

---

## Task 5: End-to-end verification (human-driven)

**Files:** None.

This is the big moment: voice → text → wake detection → Firestore write → webhook fan-out. The whole sensor → AI loop.

- [ ] **Step 1: Open three browser tabs**

  1. **The app** at <http://localhost:8081> (Metro must be running; restart if not).
  2. **webhook.site receiver** at <https://webhook.site/3c16f6ce-3883-480b-8681-6cd0e229a608> — this is Act 2 of the demo.
  3. **Firebase Console → Firestore** to watch new `notes/` docs land in real time.

- [ ] **Step 2: Reload the app tab** to ensure it picks up the latest code

- [ ] **Step 3: First test — inline wake phrase**

  - Debug tab → "Stream mic to STT (5s)"
  - Speak: *"Heads up, room 412 needs extra towels."*
  - Wait ~8 seconds (5s capture + 3s grace)
  - Expected:
    - Output panel shows a `committed` transcript matching what you said
    - Firestore → `notes/` → new doc appears within ~1 s of the committed transcript, with `text: "room 412 needs extra towels"` (no "heads up" prefix), your `authorUid`, your `authorHandle`
    - webhook.site → new POST appears within another ~2 s after the Firestore write, with the same note in the payload
    - Feed tab in the app → the new note is visible

- [ ] **Step 4: Second test — split wake phrase**

  Run the debug action again. Speak with a long pause:

  - *"Heads up."* (silence for 2 sec) *"The coffee machine is jammed."*

  Both phrases should land as separate committed transcripts. The first arms the machine; the second becomes the utterance. Expected: one note with `text: "The coffee machine is jammed."`.

- [ ] **Step 5: Third test — no wake phrase**

  Run again. Speak:

  - *"Hello, just testing the microphone."*

  Expected: committed transcript shows in the output panel; **no** Firestore note is created; **no** webhook fires. The transcript is dropped on the floor (this is intentional, per the spec).

- [ ] **Step 6: Check the Fly logs**

  ```bash
  fly logs --app suitetalk-ws
  ```

  Recent lines should include:
  - `wake armed; capturing next utterance` (for the split-phrase test)
  - `note written` with the noteId and text
  - No `failed to write note` errors

  If you see auth errors, the service account doesn't have Firestore write permission — re-check Task 3 Step 3.

---

## Phase 7 acceptance checklist

- [ ] `server/src/wake-machine.ts` exists and compiles
- [ ] `server/src/firestore.ts` exists and compiles
- [ ] `firebase-admin` is a dep in `server/package.json`
- [ ] Fly has BOTH `ELEVENLABS_API_KEY` and `FIREBASE_SERVICE_ACCOUNT_BASE64` set as secrets
- [ ] Server deploy succeeded; `/health` returns `ok`
- [ ] Test 3 (inline wake): "Heads up, room 412 needs extra towels" → one note appears in Firestore + webhook fires + note text does not include "heads up"
- [ ] Test 4 (split wake): pause-separated wake + utterance produces exactly one note containing only the utterance
- [ ] Test 5 (no wake): speech without "heads up" produces no note, no webhook
- [ ] Fly logs show clean session lifecycle for each test
- [ ] `pnpm exec tsc --noEmit` shows the baseline 4 pre-existing errors

When all check, Phase 7 is done. **The voice-to-AI loop is real.**

---

## Risks + mitigations

| Risk | Mitigation |
| --- | --- |
| Pre-wake speech is dropped silently — user says useful stuff before "heads up" and loses it | Acceptable for MVP per the brainstorm. "Heads up" is the explicit signal that "the next thing matters." If users start saying it inconsistently, we can switch to "everything after I open the app for the first time" or similar — not now. |
| ElevenLabs mishears "heads up" (e.g. "hands up", "head zap") | The regex `\bheads[\s-]+up\b` only matches exact form. We rely on Scribe v2 Realtime's accuracy here. If it bites, options: (a) fuzzy match, (b) keyterm prompting ("heads up" as a bias term — supported by realtime per the docs). |
| Two wake phrases in one committed transcript | The current machine captures everything after the FIRST "heads up" and writes that as one note. Subsequent "heads up" in the same string is part of the utterance. Reasonable behavior; if it surfaces as a problem, add a second WAKE_RE pass to chop. |
| Service account JSON leaks in logs | We never log `process.env` and never deserialize the JSON anywhere except `ensureApp`. The base64 form in Fly secrets is encrypted at rest. |
| Server crashes mid-utterance (CAPTURING state) → wake state lost | The WakeMachine is per-session; on server restart, the WS connection drops and the client reconnects with a fresh state. Acceptable — the user just re-says "heads up". |
| firebase-admin SDK adds startup latency | First write per process pays the cold-cost (~500ms). Subsequent writes are <100ms. Within our 2-second p95 budget for end-of-speech → feed render. |
| Client can spoof any `authorUid` / `authorHandle` in the hello message | Documented gap. Until we verify Firebase ID tokens on the WS, any client can write notes attributed to any UID. Phase 8/9 hardening or a separate security pass. |

---

## Out of scope for Phase 7 (deferred)

- **Firebase ID token verification on the WebSocket.** Server should reject `hello` messages with invalid tokens, not trust the client's claimed `clientId` blindly. Hardening pass.
- **Haptic confirmation** to the phone on note commit. Phase 8.
- **Native iOS mic capture.** Phase 8.
- **`wakePhrase` field actually reflecting the variant matched.** Currently the Phase 3 webhook hard-codes `wakePhrase: "heads up"`. Fine for MVP since that's the only phrase we detect.
- **Note edits / cancels** ("scratch that"). Phase 9 polish if time allows.
- **Multilingual wake phrase.** English only for MVP.
- **Backoff if Firestore write fails.** First failure is logged; we don't retry. Phase 9 polish if it bites.
- **Telemetry / metrics** on how often the machine fires. Phase 9.

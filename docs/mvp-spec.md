# SuiteTalk MVP Spec

## 1. One-liner

A hands-free voice-note app for hotel staff: speak "heads up …" into your AirPods,
and what you said appears in real time on every connected device — and is fanned out
via webhook to a downstream AI orchestration layer.

We are intentionally a **dumb, high-fidelity sensor stream**. The intelligence lives
downstream.

## 2. Primary user story

> A bellhop has their iPhone in a pocket and AirPods in. While walking a guest's bags
> to their room, they say **"heads up, room 412 needs extra towels."** Within ~2 seconds
> the note appears in the shared feed on every other staff member's phone. A haptic on
> the bellhop's phone confirms it was posted. An external AI layer receives the same
> note via webhook and decides what to do with it (assign housekeeping, etc.). The
> bellhop never looks at the screen.

## 3. Must-haves (MVP scope)

- Continuous mic streaming to a server while the app is foregrounded **or backgrounded**
  (iOS background-audio entitlement).
- Server-side wake-phrase detection (`heads up`) and silence-based end-of-utterance
  (~1.5 s).
- Voice → text via **ElevenLabs realtime STT**, proxied through our server.
- Real-time fan-out of notes to all connected clients (≤ 2 s p95 from end-of-speech to
  render on other devices).
- Persistent **anonymous identity**: each install gets a stable Firebase anonymous UID
  and an auto-generated human-readable handle (e.g. `swift-otter`) that the user can
  rename once.
- Two-tab UI: **Feed** (read-only stream of notes) + **Leaderboard** (monthly note
  count, ranked).
- Haptic feedback on the device when a note is posted.
- **Webhook fan-out**: every persisted note fires an HTTP POST to a configured URL.

## 4. Out of scope (explicitly post-MVP)

- AI replies, summarization, or task extraction inside SuiteTalk itself.
- Reactions, threading, edits, deletes, ack/handoff workflows.
- Multi-property / multi-tenancy. There is one global feed.
- Roles (bellhop / front desk / manager) and any role-gated UI.
- Audio playback of original recordings.
- Real authentication. Identity is anonymous-UID + handle.
- Privacy / redaction / retention policy. We stream and persist everything for MVP;
  this must be addressed before any real pilot.
- Android. iOS only.
- AI-scored "impact" or quality-weighted leaderboard.
- End-of-shift recap, badges, streaks.

## 5. Architecture

```
                            ┌─────────────────────────────┐
                            │   iOS app (Expo dev build)  │
                            │   - mic capture (BG audio)  │
                            │   - WS audio to server      │
                            │   - Firestore listener      │
                            │   - haptic on note commit   │
                            └──────────┬──────────────────┘
                                       │ ws (PCM frames)
                                       ▼
                            ┌─────────────────────────────┐
                            │   Fly.io WS service (Node)  │
                            │   - per-user audio session  │
                            │   - proxies to ElevenLabs   │
                            │   - watches transcript for  │
                            │     "heads up" + silence    │
                            │   - writes Firestore note   │
                            │   - fires outbound webhook  │
                            └──────────┬─────────┬────────┘
                                       │         │
                                  ws   │         │ https
                                       ▼         ▼
                       ┌──────────────────┐  ┌────────────────────┐
                       │ ElevenLabs STT   │  │  Downstream AI     │
                       │ realtime         │  │  orchestrator      │
                       └──────────────────┘  │  (webhook target)  │
                                             └────────────────────┘

                                       ▲
                                       │ realtime subscription
                            ┌──────────┴──────────────────┐
                            │  Firestore                  │
                            │  - users/{uid}              │
                            │  - notes/{noteId}           │
                            └─────────────────────────────┘
```

### Component responsibilities

| Component | Owns |
| --- | --- |
| **iOS app** | Mic capture, audio streaming over WS, Firestore subscription for feed + leaderboard, identity bootstrap, haptics. |
| **Fly.io WS service** | Holds long-lived audio connections, proxies to ElevenLabs, runs wake/silence detection, writes notes, fires webhooks. Holds the ElevenLabs API key. |
| **Vercel (existing repo)** | `/api/*` HTTP endpoints (none required for MVP audio path — keep available for future REST). Hosts the web build for the debug panel + read-only observer view. |
| **Firestore** | Source of truth for users and notes. Powers realtime fan-out to clients. |
| **ElevenLabs realtime STT** | Audio → streaming transcript. |
| **Webhook target** | Out-of-band AI orchestrator we don't own. We just POST. |

### Why split Fly.io + Vercel

Vercel functions can't hold a per-user WebSocket for an entire shift; Fly.io machines
can. Vercel still hosts the static web app + any short-lived REST endpoints. One repo,
two deploys.

## 6. Data model (Firestore)

```ts
// users/{uid}
{
  handle: string;        // "swift-otter" — unique-ish, mutable once
  createdAt: Timestamp;  // first launch
}

// notes/{noteId}
{
  authorUid: string;
  authorHandle: string;  // denormalized at write time
  text: string;          // transcribed utterance after "heads up"
  createdAt: Timestamp;  // server timestamp, used for ordering + leaderboard window
}
```

Notes are append-only. No edits, no soft-deletes. `createdAt` is the only ordering /
windowing key.

### Leaderboard computation

Client-side aggregation, on demand:

1. Open Leaderboard tab.
2. Query `notes where createdAt >= startOfMonth(now)`.
3. Group by `authorHandle`, count, sort desc.
4. Render top N + current user's rank if not in top N.

Acceptable for hackathon scale (≤ 10 k notes / month). Replace with a maintained
counter or scheduled aggregation when notes/month exceeds that.

## 7. Audio + wake-phrase pipeline

```
mic frames ───► WS ───► Fly server ───► ElevenLabs STT (WS)
                              ▲                  │
                              │ partial /        │ partial & final
                              │ final transcript │ transcript events
                              └──────────────────┘

Wake state machine (per session):
  state: IDLE | CAPTURING

  on transcript event:
    IDLE:
      if text contains "heads up":
        start CAPTURING
        utteranceBuffer = text after "heads up"
        lastVoiceAt = now
    CAPTURING:
      append text to utteranceBuffer
      lastVoiceAt = now
      if silence ≥ 1.5 s since lastVoiceAt:
        commit utteranceBuffer as note
        send haptic-trigger event back over WS
        fire webhook
        reset to IDLE
```

Server, not client, holds the state machine. Easier to evolve and keeps wake-detection
logic out of the React Native bundle.

## 8. Identity flow

```
First launch:
  firebase.auth().signInAnonymously()  → uid
  handle = generateHandle()            // e.g. "swift-otter"
  Firestore.users/{uid} = { handle, createdAt: serverTimestamp() }
  AsyncStorage: cache { uid, handle }
  Show "You're swift-otter. [Rename] [Looks good]"

Subsequent launches:
  Firebase auth restores same uid
  Read users/{uid}.handle → display
```

Handle uniqueness is "best effort" — we retry on collision but don't gate UX.

## 9. Webhook contract

On every persisted note, the WS service POSTs to `WEBHOOK_URL` (env var):

```http
POST {WEBHOOK_URL}
Content-Type: application/json
X-Suitetalk-Signature: hex(hmac-sha256(WEBHOOK_SECRET, body))

{
  "type": "note.created",
  "version": "1",
  "note": {
    "id": "note_abc123",
    "authorUid": "uid_xyz",
    "authorHandle": "swift-otter",
    "text": "room 412 needs extra towels",
    "createdAt": "2026-05-16T18:42:01.123Z",
    "wakePhrase": "heads up"
  }
}
```

Retries: 3 attempts with exponential backoff (1 s / 4 s / 16 s). Failures logged but
do not block the note from appearing in the feed.

## 10. Latency target

End-of-speech → note rendered on a second device: **≤ 2 s p95**.

Budget (typical):

| Stage | Budget |
| --- | --- |
| ElevenLabs trailing latency on final transcript | 500 ms |
| Server wake/silence detection | 100 ms |
| Firestore write + propagation | 500 ms |
| Client render + list animation | 300 ms |
| Slack / network jitter | 600 ms |
| **Total** | **2.0 s** |

If we miss this on stage, fall back to "≤ 5 s" framing.

## 11. Demo flow (the two-act story)

**Act 1 — The sensor works.**

1. Two demo iPhones on stage, both running SuiteTalk dev build, both already
   authenticated (handles preloaded).
2. Phone A has AirPods in, screen locked, in presenter's pocket.
3. Presenter says: *"Heads up, the lobby coffee machine is jammed."*
4. Audience watches Phone B (mirrored / projected): note appears within ~2 s.
5. Phone A vibrates in pocket. Presenter pulls it out, screen still locked,
   no interaction needed.

**Act 2 — The intelligence layer responds.**

6. A simple webhook receiver (projected: a console log or a tiny page) shows the
   same note arriving as JSON moments later.
7. A mocked "AI orchestrator" reacts to it on screen — e.g. *"Dispatched engineering
   to lobby. ETA 4 minutes."*
8. Closing line: "We're the dumb stream. The smart layer plugs in via one webhook."

## 12. Risks + mitigations

| Risk | Mitigation |
| --- | --- |
| Wake phrase misfires on stage (false negative) | Ship a push-to-talk fallback button in the app for demo recovery. Don't show it during the happy path. |
| Conference WiFi kills the audio WS | Run the WS service somewhere with predictable connectivity; use mobile hotspot if needed; the failure mode is graceful (note doesn't post). |
| Background-audio entitlement not approved by Expo Go | We're already moving to an EAS dev build for this reason. |
| ElevenLabs latency spikes | Cache "last known good" transcript path; surface a tiny status indicator on the debug screen. |
| Anonymous Firebase UID gets lost (user reinstalls) | Acceptable for MVP — they get a new handle. Document it. |
| Webhook target is down | Retries + logged failures. Note still appears in the feed. |

## 13. Build order (suggested)

The plan doc will turn each of these into concrete steps; this is the strategic
ordering.

1. **Identity** — anonymous auth + handle generation + rename flow. Persistable
   without any audio in the loop. Verifies Firebase wiring end-to-end.
2. **Feed** — Firestore subscription + render notes. Seed notes manually via the
   debug panel. The chat input we already have becomes a text fallback that writes
   directly to Firestore. Verifies real-time + UI.
3. **Webhook fan-out** — server-side Cloud Function (or part of the Fly service)
   that POSTs on every note write. Verifies the contract works before audio is in
   the picture.
4. **Leaderboard tab** — client-side aggregation. Re-introduces a tab structure
   (Feed + Leaderboard).
5. **Fly.io WS service** — bare-bones audio pass-through (no STT yet). Verify
   phone → server bytes flow.
6. **ElevenLabs proxy** — server connects to ElevenLabs, streams transcript back
   over WS to client for debug visibility.
7. **Wake / silence state machine** — commit notes server-side on `"heads up"` +
   silence.
8. **Background audio + haptics** — EAS dev build, `UIBackgroundModes: ["audio"]`,
   haptic on note commit. This is when "in your pocket" actually works.
9. **Demo polish** — observer web view, projector layout, push-to-talk fallback,
   stage rehearsal.

## 14. Open questions (to revisit after MVP works)

- Should handle uniqueness be enforced server-side?
- Where does the webhook URL live — env var only, or also a per-deployment config doc
  in Firestore?
- Privacy: should we stop streaming audio when the screen is locked for > N minutes,
  to honor "off shift"?
- What's the right behavior when ElevenLabs is unreachable — silent degrade, or surface
  a warning?
- When does Android become a real target? (Mic background-audio story is very different.)

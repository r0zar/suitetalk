# Phase 6: ElevenLabs STT Proxy — Implementation Plan

> **Spec reference:** [`docs/mvp-spec.md`](../mvp-spec.md), §7 audio/wake pipeline.
>
> **Docs grounding:** ElevenLabs realtime STT WebSocket API (https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime) and the STT capabilities overview (https://elevenlabs.io/docs/overview/capabilities/speech-to-text). Both consulted at plan-write time.

**Goal:** The `suitetalk-ws` server in `server/src/server.ts` currently just ACKs incoming audio chunks. Phase 6 wires it to ElevenLabs realtime STT: when a client connects, the server opens an upstream WebSocket to ElevenLabs Scribe v2 Realtime, forwards each `audio.chunk` payload, and pipes partial + committed transcripts back to the client. **No wake-word detection yet, no Firestore writes yet** — those are Phase 7.

This phase is the audio "ear." Phase 7 will add the "brain" (state machine: detect "heads up" + silence-committed segment + write note).

**Architecture:**

```
iOS dev build / web debug                Fly machine (suitetalk-ws)
  client_audio.chunk  ──────────────►   forward as input_audio_chunk
                                                     │
                                                     ▼
                                            ElevenLabs Realtime STT
                                            (wss://api.elevenlabs.io
                                             /v1/speech-to-text/realtime
                                             ?model_id=scribe_v2_realtime
                                             &audio_format=pcm_16000
                                             &commit_strategy=vad
                                             &vad_silence_threshold_secs=1.5)
                                                     │
                                                     ▼
                                            partial_transcript / committed_transcript
                                                     │
  ◄──────────────  server: { type: 'transcript', kind: 'partial' | 'committed', text } ─┘
```

**Tech stack:** Same as Phase 5 — Node 22, `ws` library on both ends. Add `ELEVENLABS_API_KEY` as a Fly secret. No new server-side deps.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `server/src/elevenlabs.ts` | Thin client for the ElevenLabs realtime STT WebSocket. Owns the upstream connection lifecycle, encoding of audio chunks into the `input_audio_chunk` shape, and the typed event stream coming back. |
| `server/src/server.ts` | Modify: on each client connection, open one ElevenLabs session and pipe events both ways. Send `{ type: 'transcript', ... }` messages to the client. |
| `server/src/types.ts` | Modify: add `'transcript'` to the `ServerMessage` union. |
| `src/lib/voice-ws.ts` | Modify: add `'transcript'` to the client-side `ServerMessage` union so the round-trip action can render transcripts in the debug page. |
| `src/app/(tabs)/debug.tsx` | Modify: replace the existing "Voice WS round-trip" action with a new "Stream mic to STT" action that captures ~5 seconds of mic audio from the browser (web only) and shows the streamed transcripts. |
| `server/.env.local` | Local-only file (gitignored) for running the server against a real ELEVENLABS_API_KEY during local dev. |

A note on scope: Phase 6 keeps the existing "echo" path alive but layered. The server still sends `ack` for each `audio.chunk` (so the round-trip test from Phase 5 still works); it additionally forwards the bytes to ElevenLabs and emits `transcript` events.

---

## Acceptance criteria (set up front so the implementer can self-check)

- The Fly machine has `ELEVENLABS_API_KEY` set as a secret.
- A debug action "Stream mic to STT" (web only) records ~5 seconds of mic audio at 16 kHz PCM, streams it to the server, and the server pipes the resulting **partial + committed** transcripts back to the browser.
- `fly logs` shows one ElevenLabs WebSocket opened per client connection and closed cleanly on client disconnect.
- The cold-start round-trip from `audio.chunk` → first `transcript` event arriving at the client is ≤ 2 s. Warm path ≤ 500 ms.
- The existing "Voice WS round-trip" action still works (proves the protocol is additive).
- No transcript is persisted anywhere in this phase. Phase 7 handles writes.
- No new client-side native deps (audio capture uses the standard web `MediaRecorder` API; native iOS audio capture is Phase 8).
- `pnpm exec tsc --noEmit` still shows only the 4 pre-existing errors.

---

## Prerequisites (human steps before Task 1)

- [ ] **Get an ElevenLabs API key.** Sign up at <https://elevenlabs.io/sign-up>, go to your profile → API Keys → Create. Copy it. Note: Scribe v2 Realtime is a paid model; check your plan tier and the realtime concurrency limits at <https://elevenlabs.io/docs/overview/models#concurrency-and-priority> before the demo. The free tier may not include realtime; if so, upgrade to the cheapest paid tier ($5/mo Starter) — well under hackathon budget.

- [ ] **Set the key as a Fly secret.** From the repo root:

  ```bash
  fly secrets set ELEVENLABS_API_KEY=<paste-key-here> --app suitetalk-ws
  ```

  This restarts the machine automatically. Verify with `fly secrets list --app suitetalk-ws` — should show `ELEVENLABS_API_KEY` with a `DIGEST` and recent `CREATED_AT`.

- [ ] **(Optional, for local dev)** Add the same key to `server/.env.local` so you can run the server locally without redeploying:

  ```
  ELEVENLABS_API_KEY=<paste-key-here>
  ```

  `.env.local` is already gitignored via `server/.gitignore`'s `*.local` pattern.

---

## Task 1: ElevenLabs upstream client module

**Files:**
- Create: `server/src/elevenlabs.ts`

A small wrapper around the upstream WebSocket. Owns the URL construction (with query params), authentication header, JSON message encoding, and the typed events flowing back. Knows nothing about our downstream client.

- [ ] **Step 1: Create `server/src/elevenlabs.ts`**

  ```ts
  import { WebSocket } from 'ws';

  // Server-to-server upstream URL. We send PCM 16 kHz mono frames (matches our
  // intended client-side capture format) and rely on VAD commit_strategy with
  // a 1.5s silence threshold so ElevenLabs auto-commits utterances for us.
  //
  // Reference: https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime
  const UPSTREAM_BASE = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';

  const DEFAULT_PARAMS = new URLSearchParams({
    model_id: 'scribe_v2_realtime',
    audio_format: 'pcm_16000',
    commit_strategy: 'vad',
    vad_silence_threshold_secs: '1.5',
    include_timestamps: 'false',
    language_code: 'eng',
  });

  export type UpstreamEvent =
    | { kind: 'session_started'; raw: unknown }
    | { kind: 'partial_transcript'; text: string }
    | { kind: 'committed_transcript'; text: string }
    | { kind: 'error'; message: string }
    | { kind: 'closed'; code: number; reason: string };

  export type UpstreamSession = {
    sendChunk(base64Audio: string): void;
    close(): void;
  };

  export function openUpstream(opts: {
    apiKey: string;
    onEvent: (event: UpstreamEvent) => void;
  }): UpstreamSession {
    const url = `${UPSTREAM_BASE}?${DEFAULT_PARAMS.toString()}`;
    const ws = new WebSocket(url, {
      headers: { 'xi-api-key': opts.apiKey },
    });

    ws.on('open', () => {
      // No explicit start message required; ElevenLabs sends SessionStarted.
    });

    ws.on('message', (raw) => {
      let msg: { message_type?: string; text?: string };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        opts.onEvent({ kind: 'error', message: 'invalid upstream json' });
        return;
      }
      switch (msg.message_type) {
        case 'session_started':
          opts.onEvent({ kind: 'session_started', raw: msg });
          break;
        case 'partial_transcript':
          opts.onEvent({ kind: 'partial_transcript', text: msg.text ?? '' });
          break;
        case 'committed_transcript':
        case 'committed_transcript_with_timestamps':
          opts.onEvent({ kind: 'committed_transcript', text: msg.text ?? '' });
          break;
        default:
          // Unknown message types ignored. The full surface is large
          // (audio_event, error, etc.); we'll add as needed.
          break;
      }
    });

    ws.on('error', (err) => {
      opts.onEvent({ kind: 'error', message: err.message });
    });

    ws.on('close', (code, reason) => {
      opts.onEvent({ kind: 'closed', code, reason: reason.toString() });
    });

    return {
      sendChunk(base64Audio) {
        if (ws.readyState !== ws.OPEN) return;
        // We pass commit: false so VAD makes the commit decisions.
        ws.send(
          JSON.stringify({
            message_type: 'input_audio_chunk',
            audio_base_64: base64Audio,
            commit: false,
            sample_rate: 16000,
          }),
        );
      },
      close() {
        if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
          ws.close();
        }
      },
    };
  }
  ```

  Why these defaults:
  - `pcm_16000` — small + cheap, matches what `MediaRecorder` can give us with a `pcm` codec on web and is the standard rate for STT in general.
  - `commit_strategy=vad` with `vad_silence_threshold_secs=1.5` — aligns with the brainstorm decision in §7 of the spec ("silence threshold ≈ 1.5s ends an utterance"). Phase 7 will consume the `committed_transcript` events as utterance boundaries.
  - `language_code=eng` — explicit so the model doesn't drift on noisy input. Can flip to `null` later if multilingual matters.

- [ ] **Step 2: Build the server to verify TS compiles**

  ```bash
  cd server && pnpm run build
  ```

  Expected: clean build.

- [ ] **Step 3: Commit**

  ```bash
  cd /Users/ross/Documents/suitetalk
  git add server/src/elevenlabs.ts
  git commit -m "Add elevenlabs realtime STT upstream client"
  ```

---

## Task 2: Wire upstream into the WebSocket server

**Files:**
- Modify: `server/src/types.ts`
- Modify: `server/src/server.ts`

- [ ] **Step 1: Extend the `ServerMessage` union in `server/src/types.ts`**

  ```ts
  export type ServerMessage =
    | { type: 'ready' }
    | { type: 'ack'; forSeq: number }
    | { type: 'transcript'; kind: 'partial' | 'committed'; text: string }
    | { type: 'bye'; reason: string };
  ```

  Don't remove the existing `ready` / `ack` / `bye` shapes — the Phase 5 debug round-trip relies on them.

- [ ] **Step 2: Modify `server/src/server.ts`**

  Add the upstream session per client connection. The existing `audio.chunk` handler keeps its `ack` reply but also forwards to ElevenLabs. New events from ElevenLabs are translated to `{ type: 'transcript', ... }` and sent to the client. The upstream is closed on client disconnect.

  Locate the existing `wss.on('connection', (ws, req) => { ... })` block. Inside it, just after the existing `sessionLog.info('client connected')` line and `let clientHandle = null`, add:

  ```ts
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const upstream = apiKey
    ? openUpstream({
        apiKey,
        onEvent: (event) => {
          switch (event.kind) {
            case 'session_started':
              sessionLog.info('elevenlabs session started');
              break;
            case 'partial_transcript':
              send(ws, { type: 'transcript', kind: 'partial', text: event.text });
              break;
            case 'committed_transcript':
              sessionLog.info({ text: event.text }, 'committed transcript');
              send(ws, { type: 'transcript', kind: 'committed', text: event.text });
              break;
            case 'error':
              sessionLog.error({ msg: event.message }, 'elevenlabs upstream error');
              break;
            case 'closed':
              sessionLog.info({ code: event.code, reason: event.reason }, 'elevenlabs upstream closed');
              break;
          }
        },
      })
    : null;
  if (!apiKey) sessionLog.warn('ELEVENLABS_API_KEY not set; running in echo-only mode');
  ```

  In the `audio.chunk` case of the message switch, add the upstream forward:

  ```ts
  case 'audio.chunk':
    sessionLog.debug({ seq: msg.seq, bytes: msg.bytes.length }, 'audio chunk');
    upstream?.sendChunk(msg.bytes);
    send(ws, { type: 'ack', forSeq: msg.seq });
    break;
  ```

  In the `ws.on('close', ...)` handler, close the upstream session:

  ```ts
  ws.on('close', (code, reason) => {
    sessionLog.info({ code, reason: reason.toString() }, 'client disconnected');
    upstream?.close();
  });
  ```

  Add the import at the top of the file (next to the other imports):

  ```ts
  import { openUpstream } from './elevenlabs.js';
  ```

- [ ] **Step 3: Build**

  ```bash
  cd server && pnpm run build
  ```

  Expected: clean.

- [ ] **Step 4: Deploy**

  ```bash
  cd server && fly deploy
  ```

  Expected: build succeeds, machine restarts. The deploy reuses the existing Fly app and just rolls the image.

- [ ] **Step 5: Smoke test from existing round-trip action**

  Web → Debug → "Voice WS round-trip" → should still succeed with `events: ["open", "recv ready", "recv ack"]` (the synthetic `SGVsbG8gV29ybGQ=` chunk doesn't represent real audio, so ElevenLabs will either ignore it or emit an error event that the server just logs — neither breaks the round-trip).

- [ ] **Step 6: Commit**

  ```bash
  cd /Users/ross/Documents/suitetalk
  git add server/src/types.ts server/src/server.ts
  git commit -m "Pipe audio chunks through elevenlabs STT and emit transcripts"
  ```

---

## Task 3: Update the client-side type to include `transcript`

**Files:**
- Modify: `src/lib/voice-ws.ts`

Keep the client-side `ServerMessage` union in sync with the server's. This is a one-line addition.

- [ ] **Step 1: Edit `src/lib/voice-ws.ts`**

  Replace the `ServerMessage` type definition with:

  ```ts
  export type ServerMessage =
    | { type: 'ready' }
    | { type: 'ack'; forSeq: number }
    | { type: 'transcript'; kind: 'partial' | 'committed'; text: string }
    | { type: 'bye'; reason: string };
  ```

- [ ] **Step 2: TypeScript check**

  ```bash
  pnpm exec tsc --noEmit
  ```

  Expected: 4 pre-existing errors. No new ones in `voice-ws.ts`.

- [ ] **Step 3: Commit**

  ```bash
  git add src/lib/voice-ws.ts
  git commit -m "Add transcript message to client voice-ws types"
  ```

---

## Task 4: "Stream mic to STT" debug action (web only)

**Files:**
- Modify: `src/app/(tabs)/debug.tsx`

This action captures ~5 seconds of audio from the browser's microphone, streams it in chunks to our server (which forwards to ElevenLabs), and renders the transcripts that come back. **Web only** for Phase 6 — native iOS mic capture is Phase 8.

The browser's `MediaRecorder` produces Opus by default, not PCM 16 kHz. To match what we configured in Task 1, we'll use the Web Audio API with `AudioContext` at 16 kHz + an `AudioWorklet` that emits 16-bit PCM frames. That's more code than `MediaRecorder` but it's what ElevenLabs wants.

- [ ] **Step 1: Add the import**

  Next to the other `@/lib/*` imports in `src/app/(tabs)/debug.tsx`:

  ```ts
  import { Platform } from 'react-native';
  ```

  (We use `Platform.OS === 'web'` to gate the new action.)

- [ ] **Step 2: Add the new action**

  Append to the `ACTIONS: DebugAction[]` array (after the existing two). Define a helper above it:

  ```ts
  async function captureMicAndStream(
    onTranscript: (kind: 'partial' | 'committed', text: string) => void,
    durationMs = 5000,
  ): Promise<void> {
    if (Platform.OS !== 'web') throw new Error('Mic capture is web-only for now');
    const { uid, handle } = await getIdentity();
    const session = openVoiceSession({ clientId: uid, handle });
    session.onServerMessage((msg) => {
      if (msg.type === 'transcript') onTranscript(msg.kind, msg.text);
    });

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext({ sampleRate: 16000 });
    const source = ctx.createMediaStreamSource(stream);
    // Tiny inline AudioWorklet that converts Float32 → Int16 PCM and posts
    // base64 strings up to the main thread.
    const workletSrc = `
      class PCM16Emitter extends AudioWorkletProcessor {
        process(inputs) {
          const ch = inputs[0]?.[0];
          if (!ch) return true;
          const buf = new Int16Array(ch.length);
          for (let i = 0; i < ch.length; i++) {
            const s = Math.max(-1, Math.min(1, ch[i]));
            buf[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          this.port.postMessage(buf.buffer, [buf.buffer]);
          return true;
        }
      }
      registerProcessor('pcm16-emitter', PCM16Emitter);
    `;
    const blob = new Blob([workletSrc], { type: 'application/javascript' });
    await ctx.audioWorklet.addModule(URL.createObjectURL(blob));
    const node = new AudioWorkletNode(ctx, 'pcm16-emitter');

    node.port.onmessage = (ev) => {
      const bytes = new Uint8Array(ev.data as ArrayBuffer);
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const b64 = globalThis.btoa(bin);
      session.sendChunk(b64);
    };

    source.connect(node);

    await new Promise<void>((resolve) => setTimeout(resolve, durationMs));

    node.disconnect();
    source.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close();
    session.end();
    // Give ElevenLabs a moment to emit the final committed transcript before
    // we close the WS — 1500ms is more than the VAD threshold, so any
    // remaining audio will commit.
    await new Promise<void>((resolve) => setTimeout(resolve, 1500));
    session.close();
  }
  ```

  Then the new action (append to `ACTIONS`):

  ```ts
  {
    label: 'Stream mic to STT (5s)',
    run: async () => {
      const transcripts: { kind: string; text: string; t: number }[] = [];
      const start = Date.now();
      await captureMicAndStream((kind, text) => {
        transcripts.push({ kind, text, t: Date.now() - start });
      });
      return {
        captureMs: 5000,
        durationMs: Date.now() - start,
        transcripts,
      };
    },
  },
  ```

- [ ] **Step 3: TypeScript check**

  ```bash
  pnpm exec tsc --noEmit
  ```

  Expected: 4 pre-existing errors. No new ones.

- [ ] **Step 4: Commit**

  ```bash
  git add 'src/app/(tabs)/debug.tsx'
  git commit -m "Add mic→STT streaming debug action (web)"
  ```

---

## Task 5: End-to-end verification

**Files:** None (human-driven runtime test).

- [ ] **Step 1: Restart Metro**

  ```bash
  pkill -f "expo start"
  cd /Users/ross/Documents/suitetalk
  pnpm expo start --clear
  ```

  (The dev server picks up env-var changes from `.env.local` only on restart.)

- [ ] **Step 2: Open the web build**

  http://localhost:8081 → Debug tab → "Stream mic to STT (5s)".

  Browser will prompt for mic permission. Grant it.

- [ ] **Step 3: Speak something simple, e.g.**

  > "Hello, this is a quick microphone test."

  Within ~5 seconds (the capture window) plus 1–2 seconds buffer for the final commit, the OUTPUT panel should show a JSON object like:

  ```json
  {
    "captureMs": 5000,
    "durationMs": 6700,
    "transcripts": [
      { "kind": "partial",   "text": "Hello",                              "t": 850 },
      { "kind": "partial",   "text": "Hello this",                         "t": 1280 },
      { "kind": "partial",   "text": "Hello this is a quick",              "t": 2400 },
      { "kind": "partial",   "text": "Hello this is a quick microphone",   "t": 3700 },
      { "kind": "committed", "text": "Hello this is a quick microphone test", "t": 6300 }
    ]
  }
  ```

  Exact timing varies. What matters:
  - At least one `partial` event arrives.
  - Exactly one `committed` event for what you said (VAD waits for the silence after speech).
  - Total `durationMs` is around 6000–7000ms (5s capture + ~1.5s VAD commit window + small buffer).

- [ ] **Step 4: Check Fly logs**

  ```bash
  fly logs --app suitetalk-ws
  ```

  Expected lines for the session:
  - `client connected`
  - `elevenlabs session started`
  - `committed transcript` with the text
  - `elevenlabs upstream closed` after the client disconnects
  - `client disconnected`

- [ ] **Step 5: Failure modes to recognise**

  - **No partials at all + upstream error in fly logs about 401 / 403:** API key wrong or not set. Re-run `fly secrets set ELEVENLABS_API_KEY=...`.
  - **No partials + upstream error about model unavailable:** account tier doesn't include Scribe v2 Realtime. Upgrade plan.
  - **Partials arrive but `committed` never does:** VAD didn't detect end-of-speech. Either you're still talking when the 5s window ends, or `vad_silence_threshold_secs` is too high — drop to 1.0 in `server/src/elevenlabs.ts`.
  - **Round-trip works locally on web but mic permission denied:** browser remembers the rejection. Reset site permissions and reload.

---

## Phase 6 acceptance checklist

- [ ] `fly secrets list --app suitetalk-ws` shows `ELEVENLABS_API_KEY`.
- [ ] `server/src/elevenlabs.ts` exists and compiles.
- [ ] The existing Phase 5 "Voice WS round-trip" action still returns success.
- [ ] The new "Stream mic to STT (5s)" action returns at least one `partial` and exactly one `committed` transcript event for a 3–5 word utterance.
- [ ] `fly logs` shows clean session lifecycle for each test run (open → session_started → committed → upstream closed → client disconnected).
- [ ] `pnpm exec tsc --noEmit` shows the baseline 4 pre-existing errors and nothing new.

When all check, Phase 6 is done. Phase 7 will:
1. Add a state machine that watches the committed transcript stream for the literal phrase "heads up" + the next utterance.
2. Write that next utterance as a Firestore `notes/{noteId}` doc (which fires the Phase 3 webhook automatically).

---

## Risks + mitigations

| Risk | Mitigation |
| --- | --- |
| ElevenLabs API key leaks via logs | We never log the key itself. Fly secrets are encrypted at rest. Don't print `process.env` in dumps. |
| Realtime model not in user's plan | Documented in Step 5 failure modes. Upgrade is ~$5/month. |
| Browser mic permission blocked / unreliable | Web is only the harness here; native iOS audio in Phase 8 is the real path. If web breaks at the demo, we run the demo on iOS. |
| Audio format mismatch produces garbage transcripts | Worklet emits Int16 mono at the AudioContext's sampleRate (we explicitly set 16000). If transcripts look "drunk" (every other word missing), it's a sample-rate or endianness issue. Inspect Fly logs for upstream error events. |
| Upstream connection drops mid-utterance | The server logs `upstream closed` but doesn't reconnect. For Phase 6 we accept this; Phase 7's state machine can add reconnect-on-error if needed. |
| Multiple clients open one upstream each → ElevenLabs concurrency limit | Realtime concurrency limits are documented at <https://elevenlabs.io/docs/overview/models#concurrency-and-priority>. For the hackathon (≤ 2 demo phones), we're fine. |
| `commit_strategy=vad` commits a chunk we didn't want (e.g. someone clears their throat) | The wake-phrase state machine in Phase 7 filters: only commits that follow "heads up" become notes. Pre-wake commits are dropped. |

---

## Out of scope for Phase 6 (deferred)

- **Wake-phrase detection.** Phase 7. Server sees every committed transcript but does nothing with the content yet.
- **Firestore writes.** Phase 7. Transcripts only ride the WS back to the client.
- **iOS native mic capture.** Phase 8. We need `expo-audio` + a native PCM pipeline.
- **`no_verbatim` mode.** Intentionally NOT used. Filler words ("uh", "um", "okay", false starts) carry semantic meaning we want to preserve for the downstream AI layer — a bellhop's hesitation around a guest issue is signal, not noise. The default verbatim mode also removes any risk of the model deciding "heads up" itself is a filler and dropping it.
- **Keyterm prompting.** Could bias the model toward "heads up", room numbers, hotel jargon. Skipped for Phase 6 simplicity; add as a one-line config change once we know what helps.
- **Reconnection on upstream error.** Single-shot streams for now.
- **Authentication on the WS server.** Anyone with the URL can connect and burn our ElevenLabs quota. Phase 7 adds Firebase ID-token verification.
- **Backpressure.** If ElevenLabs slows down, the client keeps shoving chunks at us. Phase 7+ if we see it in practice.
- **Audio format negotiation.** We hard-code `pcm_16000`. If the iOS native side can't produce that natively, we'll resample in Phase 8.

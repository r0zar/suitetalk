# Phase 8: Native iOS background audio + haptics — Implementation Plan

> **Spec reference:** [`docs/mvp-spec.md`](../mvp-spec.md), §3 must-haves (background mic + haptic feedback), §11 demo Act 1.
>
> **Docs grounding:** [react-native-audio-api / AudioRecorder](https://docs.swmansion.com/react-native-audio-api/docs/inputs/audio-recorder/), [expo-haptics](https://docs.expo.dev/versions/latest/sdk/haptics/), and Apple's [UIBackgroundModes audio](https://developer.apple.com/documentation/bundleresources/information_property_list/uibackgroundmodes) requirement.

**Goal:** The iPhone captures mic audio continuously (foreground + backgrounded + screen-locked), streams 16 kHz PCM frames to the Fly WS server (same protocol as web), and vibrates the device when the wake-phrase pipeline successfully writes a note. End result: phone in pocket, AirPods in ear, say *"heads up, room 412 needs towels,"* feel a haptic, see the note land on every other phone within ~2 s.

**Architecture:**

```
iPhone mic ──► react-native-audio-api AudioRecorder (Float32 PCM @ 16kHz)
                         │
                         ▼
                  convert to Int16 PCM (existing helper)
                         │
                         ▼
                  base64 → openVoiceSession.sendChunk(...)
                         │
                         ▼
                  wss://suitetalk-ws.fly.dev/ws  ──► ElevenLabs ──► WakeMachine ──► Firestore
                                                                                       │
                         ◄────────────  { type: 'note.committed', noteId } ───────────┘
                                                          │
                                                          ▼
                                                  expo-haptics on the iPhone

UIBackgroundModes: ["audio"] in iOS Info.plist  ←──  required for the stream to survive
                                                     screen lock + app backgrounding.
```

**Tech stack:** Add `react-native-audio-api` (Software Mansion) for streaming PCM capture and `expo-haptics` for the vibration. Add a `'note.committed'` server-to-client message. Native build only — Expo Go can't run this (already true since Phase 1).

---

## Why `react-native-audio-api` and not `expo-audio`

`expo-audio` records to a file URI; you only get audio after `stop()` returns, no streaming. That doesn't work for our wake-phrase pipeline which needs PCM frames in flight. `react-native-audio-api`'s `AudioRecorder.onAudioReady` delivers an `AudioBuffer` (Float32, samples in [-1, 1]) on a configurable cadence (`bufferLength`), which is exactly what we need — same shape as the AudioWorklet we already wrote for web, so the Int16 conversion + base64 + WS send is a copy of `captureMicAndStream`.

There's a [known regression on Android with SDK 54](https://github.com/software-mansion/react-native-audio-api/issues/809) where recordings degrade to a "tone." Doesn't affect us — we're iOS-only per the spec.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `app.config.js` | Add iOS `UIBackgroundModes: ["audio"]` + microphone usage description. Register the `react-native-audio-api` config plugin with `iosBackgroundMode: true`. |
| `package.json` | Add `react-native-audio-api` and `expo-haptics` (the latter is likely already pinned by SDK 54 — verify). |
| `src/lib/native-mic.ts` | Native-only mic capture loop. Mirrors `captureMicAndStream` from the web debug page. Float32 → Int16 → base64 → `session.sendChunk`. |
| `src/lib/native-mic.web.ts` | Web stub that throws — keeps imports happy if a screen accidentally references it from web. |
| `src/components/start-stop-shift-button.tsx` | A big themed "Start Shift / End Shift" button at the bottom of the Feed screen. While on shift, mic is streaming. Off shift, nothing's recording. |
| `src/app/(tabs)/index.tsx` | Modify: subscribe to a new `useShift()` hook + render the button. When on shift, react to `note.committed` messages with `Haptics.notificationAsync(Success)`. |
| `src/hooks/use-shift.ts` | React hook that owns the mic session lifecycle. Holds the WS session + AudioRecorder; exposes `{ status, start(), stop() }`. |
| `server/src/server.ts` | After a successful Firestore write, send a new `{ type: 'note.committed', noteId, text }` message back to the originating client. |
| `server/src/types.ts` | Add the new server message. |
| `src/lib/voice-ws.ts` | Add the new server message to the client union. |

---

## Acceptance criteria

- On the iOS dev build, a "Start Shift" button on the Feed screen turns into "End Shift" when tapped.
- While on shift, with AirPods plugged in and the screen locked, saying *"heads up, room 412 needs towels"* produces:
  1. A haptic on the iPhone within ~2.5 s of end-of-speech.
  2. A new note in Firestore with `text: "room 412 needs towels"`, `authorHandle: <your handle>`.
  3. The Phase 3 webhook fires.
  4. Any other connected device (web tab, other phone) sees the note in the feed.
- Tapping "End Shift" cleanly closes the WS connection, stops the recorder, releases mic access.
- Backgrounding the app (home button / Cmd-H on the dev build) does NOT stop the recording. Audio stream continues. (Verify via Fly logs continuing to show `committed transcript` events.)
- `pnpm exec tsc --noEmit` shows only the baseline 4 pre-existing errors.
- The web build still works for "Stream mic to STT (5s)" — Phase 8 doesn't break Phase 6's web path.

---

## Prerequisites (must be done before Task 1)

- [ ] **iOS dev build running on a physical iPhone.** This was deferred earlier in the project; we have to nail it before Phase 8. Steps to verify:
  - Xcode open on `ios/suitetalk.xcworkspace`
  - Signed with your Personal Team
  - iPhone trusted in Settings → General → VPN & Device Management
  - `pnpm expo start --dev-client` connects from the device
  - App loads to the Feed screen with `YOU ARE <handle>` header

  If any of these fail, fix that first — Phase 8 changes are useless without a working device build.

- [ ] **Confirm AirPods (or wired earbuds) work for audio input.** Test in any other app (e.g. Voice Memos). If your AirPods don't act as the mic input, iOS preferred-input routing needs configuring — but typically AirPods auto-route when paired.

---

## Task 1: Install deps + config plugin

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`, `app.config.js`

- [ ] **Step 1: Install**

  ```bash
  pnpm expo install react-native-audio-api expo-haptics
  ```

  Expected: both packages added at SDK-pinned versions. `expo-haptics` may already be present; that's fine.

- [ ] **Step 2: Update `app.config.js`**

  Add the iOS Info.plist entries inside the existing `ios:` block (alongside `bundleIdentifier`, `googleServicesFile`, etc.):

  ```js
  ios: {
    // ... existing fields ...
    infoPlist: {
      // ... existing fields like ITSAppUsesNonExemptEncryption ...
      UIBackgroundModes: ['audio'],
      NSMicrophoneUsageDescription:
        'SuiteTalk listens to staff voice notes so they can broadcast "heads up" messages hands-free.',
    },
  },
  ```

  And register the `react-native-audio-api` plugin in the `plugins` array (place it alongside the other plugins):

  ```js
  [
    'react-native-audio-api',
    { iosBackgroundMode: true },
  ],
  ```

  The plugin handles the iOS `AVAudioSession` category configuration automatically when `iosBackgroundMode: true`.

- [ ] **Step 3: Re-run prebuild to regenerate the `ios/` folder**

  ```bash
  pnpm expo prebuild --platform ios --clean
  ```

  Expected: completes without errors. Pod install takes a few minutes; you may see `react-native-audio-api` listed in the Pods install summary.

- [ ] **Step 4: Verify the generated Info.plist**

  ```bash
  grep -A1 'UIBackgroundModes\|NSMicrophoneUsageDescription' ios/suitetalk/Info.plist
  ```

  Expected: both keys present. `UIBackgroundModes` array contains `audio`. The usage description matches what you set.

- [ ] **Step 5: Commit**

  ```bash
  git add package.json pnpm-lock.yaml app.config.js
  git commit -m "Install react-native-audio-api and expo-haptics for native mic streaming"
  ```

  `ios/` is gitignored; the regenerated files aren't committed.

---

## Task 2: Native mic capture helper

**Files:**
- Create: `src/lib/native-mic.ts`
- Create: `src/lib/native-mic.web.ts`

The native helper sets up an `AudioRecorder`, hooks `onAudioReady`, converts the Float32 buffer to Int16 + base64, and forwards to a provided `VoiceSession`. Mirrors the web `captureMicAndStream` but is event-driven (continuous) instead of fixed-duration.

- [ ] **Step 1: Create `src/lib/native-mic.ts`**

  ```ts
  // Continuous mic capture for native (iOS/Android). The web path is in the
  // sibling .web.ts stub. PCM frames flow as base64 strings into a
  // provided VoiceSession.

  import { AudioManager, AudioRecorder } from 'react-native-audio-api';

  import type { VoiceSession } from './voice-ws';

  const SAMPLE_RATE = 16000;
  // 100 ms chunks → ~10 messages/sec, comparable to the web AudioWorklet.
  const BUFFER_FRAMES = SAMPLE_RATE / 10;

  function float32ToInt16Base64(buf: Float32Array): string {
    const out = new Int16Array(buf.length);
    for (let i = 0; i < buf.length; i++) {
      const s = Math.max(-1, Math.min(1, buf[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    // btoa is available in Hermes; if not, use Buffer.from(bytes).toString('base64').
    const bytes = new Uint8Array(out.buffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return globalThis.btoa(bin);
  }

  export type MicHandle = {
    stop(): Promise<void>;
  };

  export async function startMicForSession(
    session: VoiceSession,
  ): Promise<MicHandle> {
    // Permission is requested by the recorder itself the first time, but we
    // also explicitly ask up front so the OS prompt fires before we try to
    // start the recorder.
    const granted = await AudioManager.requestRecordingPermissions();
    if (!granted) throw new Error('Microphone permission denied');

    const recorder = new AudioRecorder({
      sampleRate: SAMPLE_RATE,
      bufferLength: BUFFER_FRAMES,
      channelCount: 1,
    });

    recorder.onAudioReady(({ buffer }) => {
      const float = buffer.getChannelData(0);
      const b64 = float32ToInt16Base64(float);
      session.sendChunk(b64);
    });

    recorder.start();

    return {
      async stop() {
        recorder.stop();
        // Give the recorder a tick to release the audio session, then tell
        // the server we're done speaking so it can flush ElevenLabs.
        await new Promise((r) => setTimeout(r, 50));
        session.end();
      },
    };
  }
  ```

  Note: the `AudioManager`/`AudioRecorder` API names above are best-effort from the docs at plan-write time. If TS complains about missing exports or different signatures, fix at the import line first — the rest of the file is straightforward.

- [ ] **Step 2: Create `src/lib/native-mic.web.ts`**

  ```ts
  // Web stub — native mic is iOS/Android only. On web the debug page
  // already uses its own AudioWorklet path (captureMicAndStream in
  // src/app/(tabs)/debug.tsx).

  import type { VoiceSession } from './voice-ws';

  export type MicHandle = {
    stop(): Promise<void>;
  };

  export async function startMicForSession(_session: VoiceSession): Promise<MicHandle> {
    throw new Error('Native mic is not available on web. Use the Debug tab.');
  }
  ```

- [ ] **Step 3: TypeScript check**

  ```bash
  pnpm exec tsc --noEmit
  ```

  Expected: still 4 pre-existing errors, no new ones. If `react-native-audio-api`'s types don't match the API I used above, adjust the .ts file until tsc is happy; the .web.ts stub doesn't import anything from it so it should remain clean.

- [ ] **Step 4: Commit**

  ```bash
  git add src/lib/native-mic.ts src/lib/native-mic.web.ts
  git commit -m "Add native mic capture helper for iOS"
  ```

---

## Task 3: `useShift` hook

**Files:**
- Create: `src/hooks/use-shift.ts`

The hook owns the mic + WS lifecycle. It opens a `VoiceSession`, attaches a `MicHandle`, and exposes a state machine: `idle | starting | live | stopping | error`.

- [ ] **Step 1: Create `src/hooks/use-shift.ts`**

  ```ts
  import * as Haptics from 'expo-haptics';
  import { useCallback, useEffect, useRef, useState } from 'react';

  import { useIdentity } from '@/hooks/use-identity';
  import { startMicForSession, type MicHandle } from '@/lib/native-mic';
  import { openVoiceSession, type VoiceSession } from '@/lib/voice-ws';

  type State =
    | { status: 'idle' }
    | { status: 'starting' }
    | { status: 'live' }
    | { status: 'stopping' }
    | { status: 'error'; message: string };

  export function useShift() {
    const { state: idState } = useIdentity();
    const [state, setState] = useState<State>({ status: 'idle' });
    const sessionRef = useRef<VoiceSession | null>(null);
    const micRef = useRef<MicHandle | null>(null);

    const stop = useCallback(async () => {
      setState({ status: 'stopping' });
      try {
        await micRef.current?.stop();
        sessionRef.current?.close();
      } catch (err) {
        console.warn('shift stop error', err);
      } finally {
        micRef.current = null;
        sessionRef.current = null;
        setState({ status: 'idle' });
      }
    }, []);

    const start = useCallback(async () => {
      if (idState.status !== 'ready') return;
      setState({ status: 'starting' });
      try {
        const session = openVoiceSession({
          clientId: idState.identity.uid,
          handle: idState.identity.handle,
        });
        session.onServerMessage((msg) => {
          if (msg.type === 'note.committed') {
            // fire-and-forget; Haptics returns a Promise we don't await
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }
        });
        sessionRef.current = session;
        micRef.current = await startMicForSession(session);
        setState({ status: 'live' });
      } catch (err) {
        await stop();
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }, [idState, stop]);

    // Clean up on unmount.
    useEffect(() => {
      return () => {
        micRef.current?.stop().catch(() => {});
        sessionRef.current?.close();
      };
    }, []);

    return { state, start, stop };
  }
  ```

  Two notes:
  - `note.committed` is a NEW server-to-client message that doesn't exist yet. Task 5 wires it up. Until then this branch is a no-op (the type union will complain in tsc — see Task 4 for the type addition).
  - We don't try to auto-reconnect on WS error. If the connection drops, the shift ends; user taps Start again.

- [ ] **Step 2: TypeScript check** — expect ONE new error here about `msg.type === 'note.committed'` being a constant-false comparison. That goes away after Task 4. Note the count: 5 errors total at this point.

- [ ] **Step 3: Commit**

  ```bash
  git add src/hooks/use-shift.ts
  git commit -m "Add useShift hook for native mic streaming + haptics"
  ```

---

## Task 4: Add `note.committed` to the client types

**Files:**
- Modify: `src/lib/voice-ws.ts`

Sync the client message union with the server change in Task 5.

- [ ] **Step 1: Replace the `ServerMessage` type**

  ```ts
  export type ServerMessage =
    | { type: 'ready' }
    | { type: 'ack'; forSeq: number }
    | { type: 'transcript'; kind: 'partial' | 'committed'; text: string }
    | { type: 'note.committed'; noteId: string; text: string }
    | { type: 'bye'; reason: string };
  ```

- [ ] **Step 2: TypeScript check**

  ```bash
  pnpm exec tsc --noEmit
  ```

  Expected: back to the baseline 4 pre-existing errors (the `useShift` warning is now gone).

- [ ] **Step 3: Commit**

  ```bash
  git add src/lib/voice-ws.ts
  git commit -m "Add note.committed to client voice-ws types"
  ```

---

## Task 5: Server emits `note.committed` after Firestore write

**Files:**
- Modify: `server/src/types.ts`
- Modify: `server/src/server.ts`
- DEPLOY

- [ ] **Step 1: Extend the server's `ServerMessage` in `server/src/types.ts`**

  ```ts
  export type ServerMessage =
    | { type: 'ready' }
    | { type: 'ack'; forSeq: number }
    | { type: 'transcript'; kind: 'partial' | 'committed'; text: string }
    | { type: 'note.committed'; noteId: string; text: string }
    | { type: 'bye'; reason: string };
  ```

- [ ] **Step 2: Modify the wake-utterance branch in `server/src/server.ts`**

  In the `committed_transcript` case where we currently call `writeNote(...)`, change the `.then(...)` handler to also send the new message back to the client:

  ```ts
  writeNote({ authorUid: uid, authorHandle: handle, text: result.text })
    .then((noteId) => {
      sessionLog.info({ noteId, text: result.text }, 'note written');
      send(ws, { type: 'note.committed', noteId, text: result.text });
    })
    .catch((err) => {
      sessionLog.error({ err }, 'failed to write note');
    });
  ```

- [ ] **Step 3: Build + deploy**

  ```bash
  cd server && pnpm run build && fly deploy
  ```

  ~2 min if the layer cache is warm.

- [ ] **Step 4: Verify health**

  ```bash
  curl -s https://suitetalk-ws.fly.dev/health
  ```

  Expected: `ok`.

- [ ] **Step 5: Commit**

  ```bash
  cd /Users/ross/Documents/suitetalk
  git add server/src/types.ts server/src/server.ts
  git commit -m "Emit note.committed to client after firestore write"
  ```

---

## Task 6: Wire the Start/End Shift button into the Feed screen

**Files:**
- Create: `src/components/shift-button.tsx`
- Modify: `src/app/(tabs)/index.tsx`

- [ ] **Step 1: Create `src/components/shift-button.tsx`**

  ```tsx
  import { Pressable, StyleSheet } from 'react-native';

  import { ThemedText } from '@/components/themed-text';
  import { ThemedView } from '@/components/themed-view';
  import { Spacing } from '@/constants/theme';

  type Props = {
    status: 'idle' | 'starting' | 'live' | 'stopping' | 'error';
    onPress: () => void;
    errorMessage?: string;
  };

  export function ShiftButton({ status, onPress, errorMessage }: Props) {
    const label =
      status === 'idle' ? 'Start Shift'
      : status === 'starting' ? 'Starting…'
      : status === 'live' ? 'End Shift'
      : status === 'stopping' ? 'Stopping…'
      : 'Retry';
    const isLive = status === 'live';
    const disabled = status === 'starting' || status === 'stopping';
    return (
      <>
        <Pressable disabled={disabled} onPress={onPress}>
          <ThemedView
            type={isLive ? 'backgroundSelected' : 'backgroundElement'}
            style={styles.button}>
            <ThemedText type="smallBold">{label}</ThemedText>
          </ThemedView>
        </Pressable>
        {status === 'error' && errorMessage ? (
          <ThemedText type="small" themeColor="textSecondary">
            {errorMessage}
          </ThemedText>
        ) : null}
      </>
    );
  }

  const styles = StyleSheet.create({
    button: {
      paddingVertical: Spacing.three,
      paddingHorizontal: Spacing.four,
      borderRadius: Spacing.three,
      alignItems: 'center',
    },
  });
  ```

- [ ] **Step 2: Modify `src/app/(tabs)/index.tsx`** to render the button at the bottom (above the keyboard / safe area inset) and wire up `useShift`.

  Add the imports:

  ```tsx
  import { ShiftButton } from '@/components/shift-button';
  import { useShift } from '@/hooks/use-shift';
  ```

  Inside `FeedScreen()`, after the existing `useNotes()` line, add:

  ```tsx
  const shift = useShift();
  ```

  At the bottom of the JSX (just before the closing `</ThemedView>` that owns `container`), add:

  ```tsx
  <ShiftButton
    status={shift.state.status}
    onPress={shift.state.status === 'live' ? shift.stop : shift.start}
    errorMessage={shift.state.status === 'error' ? shift.state.message : undefined}
  />
  ```

- [ ] **Step 3: TypeScript check**

  ```bash
  pnpm exec tsc --noEmit
  ```

  Expected: 4 pre-existing errors only.

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/shift-button.tsx 'src/app/(tabs)/index.tsx'
  git commit -m "Add Start/End Shift button to feed screen"
  ```

---

## Task 7: End-to-end verification on the iPhone (human-driven)

**Files:** None.

- [ ] **Step 1: Open Xcode → hit ▶️**

  Build + install the latest. Since we re-ran prebuild in Task 1, the native project picked up the new pods and Info.plist entries. The build is slower than a JS-only change — ~3 minutes.

- [ ] **Step 2: On the phone**

  - Launch the app
  - First time: iOS prompts for microphone permission. Grant it.
  - Feed screen shows `YOU ARE <handle>` + the "Start Shift" button at the bottom.

- [ ] **Step 3: Plug in AirPods or wired earbuds.** iOS should auto-route the mic input. Confirm by saying anything; the iPhone's screen should show some indicator that the mic is active (the orange status-bar dot once you start the shift).

- [ ] **Step 4: Tap "Start Shift"**

  - Button label changes to "End Shift"
  - `fly logs --app suitetalk-ws` shows `client connected`, `elevenlabs session started`

- [ ] **Step 5: Speak: *"Heads up, room 412 needs extra towels."***

  Expected within ~2.5 seconds of finishing:
  - iPhone vibrates (single success haptic)
  - Firestore: new note with `text: "room 412 needs extra towels"`, your handle
  - Feed screen on the SAME phone shows the new note (you're subscribed to the realtime feed too)
  - webhook.site receives the POST
  - `fly logs` shows `committed transcript`, `note written`, `note.committed` sent

- [ ] **Step 6: Background the app** (Cmd-H in the simulator; press home / swipe up on a real phone)

  - **Do not stop the shift.**
  - Wait 30 seconds with the app backgrounded.
  - Speak: *"Heads up, the lobby coffee machine is jammed."*
  - Expected: same as Step 5. The iPhone should still vibrate (haptics work backgrounded) and Fly logs should still show the new note within ~2 seconds.

- [ ] **Step 7: Lock the screen** (press power button)

  - Wait 30 seconds.
  - Speak the wake phrase + utterance again.
  - Expected: vibration through the locked screen + new note in Firestore.

  This is the in-pocket demo target.

- [ ] **Step 8: Tap "End Shift"**

  - Button label changes back to "Start Shift"
  - `fly logs` shows `client disconnected`, `elevenlabs upstream closed`
  - The phone is no longer recording (iOS orange dot disappears)

If any of the above fails, see the troubleshooting table below.

---

## Troubleshooting (likely failure modes)

| Symptom | Most likely cause | Fix |
| --- | --- | --- |
| Tapping Start Shift shows "Microphone permission denied" | First-time permission denied or revoked | Settings → SuiteTalk → Microphone → enable |
| Recording works foregrounded but stops when backgrounded | `UIBackgroundModes` not in Info.plist OR the audio session didn't transition to playback-and-record category | Re-check Task 1 Step 2 + Step 4, run prebuild again, reinstall |
| Audio captured but transcripts arrive garbled | Sample rate mismatch (e.g. AudioRecorder returned 48 kHz instead of 16 kHz because hardware doesn't support 16 kHz) | Check `fly logs` for upstream `error` events; add server-side resampling (out of scope for MVP) |
| Haptic never fires but Firestore note lands | `note.committed` server message not deployed yet, or client is on the wrong build | Re-deploy server (Task 5), rebuild client |
| AirPods connected but iPhone mic used | iOS preferred input not auto-routed | Settings → Bluetooth → AirPods (i) → Microphone → set to Always Right/Left AirPod |
| Shift button stays in "Starting…" forever | WS opening but never connected (firewall? VPN?) | Check Fly logs for any client connect log lines; check the phone's network access to `wss://suitetalk-ws.fly.dev/ws` from Safari first |

---

## Phase 8 acceptance checklist

- [ ] `react-native-audio-api` and `expo-haptics` installed at SDK-pinned versions
- [ ] `app.config.js` has `UIBackgroundModes: ["audio"]` and a microphone usage description
- [ ] `react-native-audio-api` plugin registered with `iosBackgroundMode: true`
- [ ] Re-ran `expo prebuild --platform ios --clean` cleanly
- [ ] Server deploy of Task 5 succeeded; `note.committed` flows back to the client
- [ ] On the iOS dev build:
  - [ ] Start Shift → Speak wake-phrase utterance → haptic fires within ~2.5 s
  - [ ] Note lands in Firestore with the right author + text
  - [ ] Phase 3 webhook fires
  - [ ] Backgrounded app still records (verified by trigger working backgrounded)
  - [ ] Locked screen still records (verified by trigger working locked)
- [ ] Web debug page "Stream mic to STT (5s)" still works (Phase 6 untouched)
- [ ] `pnpm exec tsc --noEmit` shows only the baseline 4 pre-existing errors

When all check, Phase 8 is done. **The in-pocket demo target is real.**

---

## Risks + mitigations

| Risk | Mitigation |
| --- | --- |
| Free-tier Apple cert expires every 7 days, breaking the dev build mid-demo | Plan rehearsal day with re-signing window. Buy a paid Apple Developer Program seat if budget allows. |
| `react-native-audio-api`'s SDK 54 regression actually affects iOS too (not just Android) | If transcripts arrive distorted, the fallback is `expo-audio-stream` — same shape of API, separate dependency tree. Plan B documented but not pre-installed to keep scope small. |
| `UIBackgroundModes: audio` is questioned in App Store review | Not a hackathon concern; we're sideloading. If we ever submit, the use case (voice-driven workforce comms) is a legitimate "audio app" category. |
| Mic stays active even after End Shift due to a leaked subscription | The `useEffect` cleanup in `useShift` calls `stop()` on unmount. Test by force-quitting the app and verifying the orange iOS recording dot disappears. |
| AirPods drop the mic role intermittently | iOS handles this transparently — input falls back to the iPhone's built-in mic. Audio still captured, demo still works. |
| Haptic is too subtle in a noisy lobby | The success-haptic from `expo-haptics` is the strongest non-error variant. Demo trick: if it's not landing, can stack `Haptics.impactAsync(Heavy)` immediately after, for a more pronounced double-bump. |

---

## Out of scope for Phase 8 (deferred)

- **Push-to-talk fallback button** for when the wake phrase fails on stage. Phase 9 polish.
- **WebSocket auto-reconnect** on transient network drops. If the WS drops, the shift ends; user re-taps Start. Acceptable for MVP.
- **Battery impact analysis.** Empirically the demo should burn ~5–10%/hr while on shift; that's fine for the few minutes a demo runs. Hotel shift use is a post-MVP concern.
- **Bluetooth headset routing UI.** iOS does this for us automatically.
- **Android.** Spec is iOS-only and the audio API has a known regression on Android SDK 54.
- **Server-side resampling.** We trust `react-native-audio-api` to deliver 16 kHz; if it can't on some hardware, we deal with it then.
- **Per-utterance haptic for partial transcripts.** Only commit triggers haptic; partials are too noisy.

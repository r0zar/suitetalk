// Continuous mic capture while the app is the front tab. Tap to start; the
// AudioWorklet streams Int16 PCM to the voice-ws server until you tap again.
// Web-only for now (iOS Safari + desktop browsers). Native iOS path can reuse
// this hook by swapping the implementation behind the same return shape.
//
// Heartbeat + reconnect: the mic runs continuously across WS drops. While the
// session is reconnecting, audio frames are buffered in memory and replayed on
// the new session so a wake phrase straddling a brief drop is still caught.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { useIdentity } from '@/hooks/use-identity';
import { openVoiceSession, type VoiceSession } from '@/lib/voice-ws';

export type LivePreview = {
  // Raw rolling STT partial (whatever the model currently thinks was said).
  partial: string;
  // If "heads up" has been detected in the current partial, this is the text
  // *after* the wake phrase — what would be saved as a note if the user stopped
  // speaking now. null until the wake phrase fires.
  armedText: string | null;
};

type State =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'live'; transcript: string; preview: LivePreview }
  | { status: 'reconnecting' }
  | { status: 'stopping' }
  | { status: 'error'; message: string };

// Mirror of the server-side wake regex (server/src/wake-machine.ts). Keep in sync.
const WAKE_RE = /\bheads[\s-]+up\b[\s,.!?:;-]*/i;

function derivePreview(partial: string): LivePreview {
  const match = WAKE_RE.exec(partial);
  if (!match) return { partial, armedText: null };
  const after = partial.slice((match.index ?? 0) + match[0].length).trim();
  return { partial, armedText: after };
}

type WebMicHandles = {
  stream: MediaStream;
  ctx: AudioContext;
  source: MediaStreamAudioSourceNode;
  node: AudioWorkletNode;
};

const WORKLET_SRC = `
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

// Send a ping every 5s. If we don't see a pong within 8s, declare the socket
// dead and trigger a reconnect. These intervals are deliberately tight — we
// want to detect a half-open TCP socket fast, not wait for OS keepalive.
const PING_INTERVAL_MS = 5000;
const PONG_TIMEOUT_MS = 8000;

// Cap the replay buffer at ~30s of audio so a long-lived disconnect doesn't
// grow memory unboundedly. At 16 kHz mono Int16 that's ~960 KB plus base64
// overhead — fine for a browser tab.
const MAX_BUFFERED_FRAMES = 3000;

async function makeMicStream(): Promise<{
  handles: WebMicHandles;
  onFrame: (cb: (base64: string) => void) => void;
}> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext({ sampleRate: 16000 });
  const source = ctx.createMediaStreamSource(stream);
  const blob = new Blob([WORKLET_SRC], { type: 'application/javascript' });
  await ctx.audioWorklet.addModule(URL.createObjectURL(blob));
  const node = new AudioWorkletNode(ctx, 'pcm16-emitter');

  let frameHandler: ((base64: string) => void) | null = null;
  node.port.onmessage = (ev) => {
    const bytes = new Uint8Array(ev.data as ArrayBuffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    frameHandler?.(globalThis.btoa(bin));
  };
  source.connect(node);

  return {
    handles: { stream, ctx, source, node },
    onFrame: (cb) => {
      frameHandler = cb;
    },
  };
}

async function stopMicStream(handles: WebMicHandles): Promise<void> {
  handles.node.disconnect();
  handles.source.disconnect();
  handles.stream.getTracks().forEach((t) => t.stop());
  await handles.ctx.close();
}

export function useShift() {
  const { state: idState } = useIdentity();
  const [state, setState] = useState<State>({ status: 'idle' });

  const sessionRef = useRef<VoiceSession | null>(null);
  const micRef = useRef<WebMicHandles | null>(null);
  const pingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pongDeadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIdRef = useRef<number>(0);
  // Audio frames captured while no session is open (during reconnect). They
  // are flushed in order as soon as the next session reaches 'ready'.
  const replayBufferRef = useRef<string[]>([]);
  const sessionReadyRef = useRef<boolean>(false);
  // Guard so a stale reconnect (e.g. user tapped stop mid-reconnect) doesn't
  // resurrect the session after teardown.
  const stoppedRef = useRef<boolean>(false);

  const clearTimers = useCallback(() => {
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
    if (pongDeadlineRef.current) {
      clearTimeout(pongDeadlineRef.current);
      pongDeadlineRef.current = null;
    }
  }, []);

  // Forward declaration so connect/scheduleReconnect can call each other.
  const connectRef = useRef<(() => void) | null>(null);

  const scheduleReconnect = useCallback(() => {
    if (stoppedRef.current) return;
    sessionReadyRef.current = false;
    setState({ status: 'reconnecting' });
    clearTimers();
    try {
      sessionRef.current?.close();
    } catch {
      // ignore
    }
    sessionRef.current = null;
    // Reconnect immediately — no backoff on first attempt. The mic keeps
    // capturing in the meantime; frames go into replayBufferRef.
    setTimeout(() => connectRef.current?.(), 0);
  }, [clearTimers]);

  const armPongTimeout = useCallback(() => {
    if (pongDeadlineRef.current) clearTimeout(pongDeadlineRef.current);
    pongDeadlineRef.current = setTimeout(() => {
      pongDeadlineRef.current = null;
      // No pong within window — socket is dead even if it thinks it's open.
      scheduleReconnect();
    }, PONG_TIMEOUT_MS);
  }, [scheduleReconnect]);

  const startHeartbeat = useCallback(() => {
    clearTimers();
    pingTimerRef.current = setInterval(() => {
      const sess = sessionRef.current;
      if (!sess) return;
      pingIdRef.current += 1;
      sess.sendPing(pingIdRef.current);
      armPongTimeout();
    }, PING_INTERVAL_MS);
  }, [armPongTimeout, clearTimers]);

  const connect = useCallback(() => {
    if (stoppedRef.current) return;
    if (idState.status !== 'ready') return;

    const session = openVoiceSession({
      clientId: idState.identity.uid,
      handle: idState.identity.handle,
      onClose: () => {
        if (stoppedRef.current) return;
        // Drop happened. Schedule a reconnect.
        scheduleReconnect();
      },
      onError: () => {
        if (stoppedRef.current) return;
        scheduleReconnect();
      },
    });
    session.onServerMessage((msg) => {
      if (msg.type === 'ready') {
        sessionReadyRef.current = true;
        // Flush anything buffered while we were disconnected.
        const buf = replayBufferRef.current;
        for (const frame of buf) session.sendChunk(frame);
        replayBufferRef.current = [];
        setState({
          status: 'live',
          transcript: '',
          preview: { partial: '', armedText: null },
        });
        startHeartbeat();
      } else if (msg.type === 'pong') {
        if (pongDeadlineRef.current) {
          clearTimeout(pongDeadlineRef.current);
          pongDeadlineRef.current = null;
        }
      } else if (msg.type === 'transcript' && msg.kind === 'partial') {
        setState({
          status: 'live',
          transcript: msg.text,
          preview: derivePreview(msg.text),
        });
      } else if (msg.type === 'transcript' && msg.kind === 'committed') {
        // The committed transcript will either be saved as a note (and arrive
        // via the Firestore subscription) or be discarded. Either way, clear
        // the optimistic preview — the next partial will refill it.
        setState({
          status: 'live',
          transcript: '',
          preview: { partial: '', armedText: null },
        });
      }
    });
    sessionRef.current = session;
  }, [idState, scheduleReconnect, startHeartbeat]);

  // Keep connectRef in sync so scheduleReconnect (defined before connect) can call it.
  connectRef.current = connect;

  const stop = useCallback(async () => {
    stoppedRef.current = true;
    setState({ status: 'stopping' });
    clearTimers();
    try {
      if (micRef.current) await stopMicStream(micRef.current);
      sessionRef.current?.end();
      sessionRef.current?.close();
    } catch (err) {
      console.warn('shift stop error', err);
    } finally {
      micRef.current = null;
      sessionRef.current = null;
      sessionReadyRef.current = false;
      replayBufferRef.current = [];
      setState({ status: 'idle' });
    }
  }, [clearTimers]);

  const start = useCallback(async () => {
    if (Platform.OS !== 'web') {
      setState({ status: 'error', message: 'Native mic not implemented yet' });
      return;
    }
    if (idState.status !== 'ready') return;
    stoppedRef.current = false;
    setState({ status: 'starting' });
    try {
      const { handles, onFrame } = await makeMicStream();
      micRef.current = handles;
      onFrame((base64) => {
        const sess = sessionRef.current;
        if (sess && sessionReadyRef.current) {
          sess.sendChunk(base64);
        } else {
          // No live session — buffer for replay. Drop oldest if we've hit the cap.
          const buf = replayBufferRef.current;
          buf.push(base64);
          if (buf.length > MAX_BUFFERED_FRAMES) buf.shift();
        }
      });
      connect();
    } catch (err) {
      await stop();
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [connect, idState, stop]);

  useEffect(() => {
    return () => {
      stoppedRef.current = true;
      clearTimers();
      if (micRef.current) stopMicStream(micRef.current).catch(() => {});
      sessionRef.current?.close();
    };
  }, [clearTimers]);

  return { state, start, stop };
}

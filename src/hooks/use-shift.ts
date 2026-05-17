// Continuous mic capture while the app is the front tab. Tap to start; the
// AudioWorklet streams Int16 PCM to the voice-ws server until you tap again.
// Web-only for now (iOS Safari + desktop browsers). Native iOS path can reuse
// this hook by swapping the implementation behind the same return shape.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { useIdentity } from '@/hooks/use-identity';
import { openVoiceSession, type VoiceSession } from '@/lib/voice-ws';

type State =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'live'; transcript: string }
  | { status: 'stopping' }
  | { status: 'error'; message: string };

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

async function startWebMic(session: VoiceSession): Promise<WebMicHandles> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext({ sampleRate: 16000 });
  const source = ctx.createMediaStreamSource(stream);
  const blob = new Blob([WORKLET_SRC], { type: 'application/javascript' });
  await ctx.audioWorklet.addModule(URL.createObjectURL(blob));
  const node = new AudioWorkletNode(ctx, 'pcm16-emitter');
  node.port.onmessage = (ev) => {
    const bytes = new Uint8Array(ev.data as ArrayBuffer);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    session.sendChunk(globalThis.btoa(bin));
  };
  source.connect(node);
  return { stream, ctx, source, node };
}

async function stopWebMic(handles: WebMicHandles): Promise<void> {
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

  const stop = useCallback(async () => {
    setState({ status: 'stopping' });
    try {
      if (micRef.current) await stopWebMic(micRef.current);
      sessionRef.current?.end();
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
    if (Platform.OS !== 'web') {
      setState({ status: 'error', message: 'Native mic not implemented yet' });
      return;
    }
    if (idState.status !== 'ready') return;
    setState({ status: 'starting' });
    try {
      const session = openVoiceSession({
        clientId: idState.identity.uid,
        handle: idState.identity.handle,
      });
      session.onServerMessage((msg) => {
        if (msg.type === 'transcript' && msg.kind === 'partial') {
          setState({ status: 'live', transcript: msg.text });
        } else if (msg.type === 'transcript' && msg.kind === 'committed') {
          // committed flushes the rolling partial; keep latest empty until next partial.
          setState({ status: 'live', transcript: '' });
        }
      });
      sessionRef.current = session;
      micRef.current = await startWebMic(session);
      setState({ status: 'live', transcript: '' });
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
      if (micRef.current) stopWebMic(micRef.current).catch(() => {});
      sessionRef.current?.close();
    };
  }, []);

  return { state, start, stop };
}

import { WebSocket } from 'ws';

// Server-to-server upstream URL. We send PCM 16 kHz mono frames (matches our
// intended client-side capture format) and rely on VAD commit_strategy with
// a 1.5s silence threshold so ElevenLabs auto-commits utterances for us.
//
// Reference: https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime
//
// Probe findings (2026-05-16):
// - The plan documented `commit_strategy=vad` and `language_code=eng`.
// - Probe confirmed `commit_strategy=vad` is accepted and produces
//   `"vad_commit_strategy": true` in the session_started config — this is the
//   correct form. Sending `vad_commit_strategy=true` (boolean string) instead
//   produces `"vad_commit_strategy": false`, so keep `commit_strategy=vad`.
// - `language_code=eng` is accepted but the server normalises it to `"en"`.
//   Using `language_code=en` directly matches the canonical form in the response.
// - All other params (`vad_silence_threshold_secs`, `include_timestamps`,
//   `audio_format`, `model_id`) round-trip as expected.
const UPSTREAM_BASE = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';

const DEFAULT_PARAMS = new URLSearchParams({
  model_id: 'scribe_v2_realtime',
  audio_format: 'pcm_16000',
  commit_strategy: 'vad',        // produces vad_commit_strategy:true in session config
  vad_silence_threshold_secs: '1.5',
  include_timestamps: 'false',
  language_code: 'en',           // plan used 'eng'; API normalises to 'en', so use 'en' directly
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
    // No explicit start message required; ElevenLabs sends session_started.
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

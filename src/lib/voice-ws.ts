// Client side of the suitetalk-ws protocol. The WS URL is read from
// EXPO_PUBLIC_VOICE_WS_URL (set in .env.local) so we can point at
// localhost during dev and prod during release.

export type ClientMessage =
  | { type: 'hello'; clientId: string; handle: string }
  | { type: 'audio.chunk'; seq: number; bytes: string }
  | { type: 'audio.end' }
  | { type: 'ping'; id: number };

export type ServerMessage =
  | { type: 'ready' }
  | { type: 'ack'; forSeq: number }
  | { type: 'transcript'; kind: 'partial' | 'committed'; text: string }
  | { type: 'pong'; id: number }
  | { type: 'bye'; reason: string };

export type VoiceSession = {
  readonly url: string;
  sendChunk(bytes: string): void;
  sendPing(id: number): void;
  end(): void;
  close(): void;
  onServerMessage(handler: (msg: ServerMessage) => void): void;
};

type Options = {
  clientId: string;
  handle: string;
  onOpen?: () => void;
  onClose?: (code: number, reason: string) => void;
  onError?: (err: Event) => void;
};

export function openVoiceSession(opts: Options): VoiceSession {
  const base = process.env.EXPO_PUBLIC_VOICE_WS_URL;
  if (!base) throw new Error('EXPO_PUBLIC_VOICE_WS_URL is not set');
  const url = `${base.replace(/\/$/, '')}/ws`;

  const ws = new WebSocket(url);
  let seq = 0;
  let handler: ((msg: ServerMessage) => void) | null = null;

  // Anything queued before the socket opens (audio frames arriving from a
  // mic that started capturing while we were still in CONNECTING) gets
  // flushed in order on open. Without this, the AudioWorklet's first frames
  // throw "Still in CONNECTING state".
  const pending: string[] = [];

  function flushPending(): void {
    for (const msg of pending) ws.send(msg);
    pending.length = 0;
  }

  function safeSend(msg: ClientMessage): void {
    const payload = JSON.stringify(msg);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    } else if (ws.readyState === WebSocket.CONNECTING) {
      pending.push(payload);
    }
    // CLOSING / CLOSED — drop silently. The caller has no useful action.
  }

  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        type: 'hello',
        clientId: opts.clientId,
        handle: opts.handle,
      } satisfies ClientMessage),
    );
    flushPending();
    opts.onOpen?.();
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data as string) as ServerMessage;
      handler?.(msg);
    } catch {
      // ignore malformed server messages
    }
  };
  ws.onclose = (ev) => opts.onClose?.(ev.code, ev.reason);
  ws.onerror = (ev) => opts.onError?.(ev);

  return {
    url,
    sendChunk(bytes) {
      seq += 1;
      safeSend({ type: 'audio.chunk', seq, bytes });
    },
    sendPing(id) {
      safeSend({ type: 'ping', id });
    },
    end() {
      safeSend({ type: 'audio.end' });
    },
    close() {
      ws.close();
    },
    onServerMessage(h) {
      handler = h;
    },
  };
}

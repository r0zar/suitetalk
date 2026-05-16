// Client side of the suitetalk-ws protocol. The WS URL is read from
// EXPO_PUBLIC_VOICE_WS_URL (set in .env.local) so we can point at
// localhost during dev and prod during release.

export type ClientMessage =
  | { type: 'hello'; clientId: string; handle: string }
  | { type: 'audio.chunk'; seq: number; bytes: string }
  | { type: 'audio.end' };

export type ServerMessage =
  | { type: 'ready' }
  | { type: 'ack'; forSeq: number }
  | { type: 'bye'; reason: string };

export type VoiceSession = {
  readonly url: string;
  sendChunk(bytes: string): void;
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

  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        type: 'hello',
        clientId: opts.clientId,
        handle: opts.handle,
      } satisfies ClientMessage),
    );
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
      const msg: ClientMessage = { type: 'audio.chunk', seq, bytes };
      ws.send(JSON.stringify(msg));
    },
    end() {
      const msg: ClientMessage = { type: 'audio.end' };
      ws.send(JSON.stringify(msg));
    },
    close() {
      ws.close();
    },
    onServerMessage(h) {
      handler = h;
    },
  };
}

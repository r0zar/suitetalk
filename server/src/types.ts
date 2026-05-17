// Shared message shapes between the RN client and the WS server.
// Keep this file in sync with src/lib/voice-ws.ts on the client.

export type ClientMessage =
  | { type: 'hello'; clientId: string; handle: string; wakeEnabled?: boolean }
  | { type: 'audio.chunk'; seq: number; bytes: string } // base64
  | { type: 'audio.end' }
  | { type: 'ping'; id: number }
  | { type: 'mode'; wakeEnabled: boolean };

export type ServerMessage =
  | { type: 'ready' }
  | { type: 'ack'; forSeq: number }
  | { type: 'transcript'; kind: 'partial' | 'committed'; text: string }
  | { type: 'pong'; id: number }
  | { type: 'bye'; reason: string };

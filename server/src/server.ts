import { createServer } from 'node:http';
import pino from 'pino';
import { WebSocketServer, type WebSocket } from 'ws';

import type { ClientMessage, ServerMessage } from './types.js';
import { openUpstream } from './elevenlabs.js';
import { WakeMachine } from './wake-machine.js';
import { writeNote } from './firestore.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });
const PORT = Number(process.env.PORT ?? 8080);

// Plain HTTP server so we can answer health checks at /health.
const http = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server: http, path: '/ws' });

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress;
  const sessionId = Math.random().toString(36).slice(2, 10);
  const sessionLog = log.child({ sessionId, ip });
  sessionLog.info('client connected');

  let clientHandle: string | null = null;
  let clientUid: string | null = null;
  const wake = new WakeMachine();

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

  send(ws, { type: 'ready' });

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      sessionLog.warn('bad json');
      send(ws, { type: 'bye', reason: 'invalid json' });
      ws.close();
      return;
    }

    switch (msg.type) {
      case 'hello':
        clientUid = msg.clientId;
        clientHandle = msg.handle;
        sessionLog.info({ clientId: msg.clientId, handle: msg.handle }, 'hello');
        break;
      case 'audio.chunk':
        sessionLog.debug({ seq: msg.seq, bytes: msg.bytes.length }, 'audio chunk');
        upstream?.sendChunk(msg.bytes);
        send(ws, { type: 'ack', forSeq: msg.seq });
        break;
      case 'audio.end':
        sessionLog.info({ handle: clientHandle }, 'audio end');
        // Tell ElevenLabs the client is done speaking. The upstream will emit
        // the final committed_transcript shortly; we keep the WS open long
        // enough for that to flow back to the client.
        upstream?.flush();
        break;
      case 'ping':
        send(ws, { type: 'pong', id: msg.id });
        break;
      default:
        sessionLog.warn({ msg }, 'unknown message type');
    }
  });

  ws.on('close', (code, reason) => {
    sessionLog.info({ code, reason: reason.toString() }, 'client disconnected');
    upstream?.close();
  });

  ws.on('error', (err) => {
    sessionLog.error({ err }, 'socket error');
  });
});

http.listen(PORT, '0.0.0.0', () => {
  log.info({ port: PORT }, 'suitetalk-ws listening');
});

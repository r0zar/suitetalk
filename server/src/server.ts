import { createServer } from 'node:http';
import pino from 'pino';
import { WebSocketServer, type WebSocket } from 'ws';

import type { ClientMessage, ServerMessage } from './types.js';

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
        clientHandle = msg.handle;
        sessionLog.info({ clientId: msg.clientId, handle: msg.handle }, 'hello');
        break;
      case 'audio.chunk':
        sessionLog.debug({ seq: msg.seq, bytes: msg.bytes.length }, 'audio chunk');
        send(ws, { type: 'ack', forSeq: msg.seq });
        break;
      case 'audio.end':
        sessionLog.info({ handle: clientHandle }, 'audio end');
        break;
      default:
        sessionLog.warn({ msg }, 'unknown message type');
    }
  });

  ws.on('close', (code, reason) => {
    sessionLog.info({ code, reason: reason.toString() }, 'client disconnected');
  });

  ws.on('error', (err) => {
    sessionLog.error({ err }, 'socket error');
  });
});

http.listen(PORT, '0.0.0.0', () => {
  log.info({ port: PORT }, 'suitetalk-ws listening');
});

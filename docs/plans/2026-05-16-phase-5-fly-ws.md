# Phase 5: Fly.io WebSocket Service — Implementation Plan

> **Spec reference:** [`docs/mvp-spec.md`](../mvp-spec.md), §5 architecture (Fly.io WS service component) and §7 audio/wake pipeline.
>
> **Process note:** This is the first server-side phase. The service lives in its own subdirectory `server/` and has its own deploy lifecycle (Fly.io). Docs referenced: <https://fly.io/docs/apps/secrets/>, <https://fly.io/docs/launch/deploy/>, <https://fly.io/docs/networking/app-services/>, <https://fly.io/docs/about/pricing/>.

**Goal:** A small Node 20 WebSocket service deployed on Fly.io that accepts client connections from the SuiteTalk app and **just echoes audio metadata back** in this phase. No ElevenLabs integration yet (Phase 6), no wake-word detection yet (Phase 7), no Firestore writes yet (Phase 7). Phase 5 proves: the iOS app can open a `wss://` connection to a Fly machine, send framed audio chunks, the server logs them and responds with an acknowledgement, the connection survives at least a 60-second mic capture.

**Architecture:**

```
iOS dev build  ────wss://suitetalk-ws.fly.dev────►  Fly machine
  (Phase 5+ client)                                   Node 20 + ws lib
                                                      stdout → fly logs

Phase 5 message shape (both directions):
  client → server: { type: "audio.chunk", seq: N, bytes: <base64> }
                   { type: "audio.end" }
                   { type: "hello", clientId: <uid>, handle: <string> }
  server → client: { type: "ack", forSeq: N }
                   { type: "ready" }   // on connection
                   { type: "bye", reason: "..." }
```

The client doesn't actually send mic bytes yet — that's Phase 5 Task 5 (a test harness in the Debug screen). In Phase 6 we replace the echo with a real ElevenLabs proxy.

**Tech stack:** Node 20, TypeScript, `ws` (the de-facto WS library), `pino` for structured logs. No framework — a single `server.ts` file. Fly.io's auto-generated `Dockerfile`, customized minimally.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `server/package.json` | Standalone Node project. `ws`, `pino`, TypeScript build. |
| `server/tsconfig.json` | TS config — strict, ESM target = Node 20. |
| `server/src/server.ts` | WebSocket server. Single file for now. Owns connection lifecycle, message parsing, logging. |
| `server/src/types.ts` | Shared message-shape types between client + server (a stub file for now; we'll cross-link from the RN client in Phase 5 Task 4). |
| `server/Dockerfile` | Node 20 base image, `pnpm install`, `pnpm run build`, `CMD ["node", "dist/server.js"]`. |
| `server/.dockerignore` | Standard Node ignores. |
| `server/fly.toml` | Fly app config: app name, primary region, single shared-cpu-1x machine, http_service on port 8080, force_https. |
| `server/README.md` | One-page deploy + run notes (so future contributors don't have to read this plan). |
| `src/lib/voice-ws.ts` | Client-side wrapper that opens a `wss://` connection to the server, sends `hello`, exposes `connect()` / `disconnect()` / `sendChunk(bytes)`. |
| `src/app/debug.tsx` | Add a "Connect WS" action that opens a connection and posts a synthetic chunk. |

Naming note: keeping the server in `server/` instead of `functions/` so it sits alongside the existing Cloud Functions codebase from Phase 3 without overloading names.

---

## Prerequisites (human steps before Task 1)

- [ ] **Install the Fly.io CLI.** macOS:

  ```bash
  brew install flyctl
  flyctl version  # confirm >= recent
  ```

- [ ] **Sign in.** This is interactive (browser flow):

  ```bash
  fly auth login
  ```

  Use whichever account is paying the ~$2/month for the machine. Per <https://fly.io/docs/about/pricing/>, the shared-cpu-1x 256MB is ~$2.02/month always-on; there's no free tier for new orgs as of 2026.

- [ ] **Pick an app name.** Fly app names are globally unique. Reserve one up-front:

  ```bash
  fly apps create suitetalk-ws  # or whatever's available; record the chosen name
  ```

  If `suitetalk-ws` is taken, try `suitetalk-ws-<your-handle>`. Whatever name you pick goes into `fly.toml` (Task 3) and the client URL (Task 4).

---

## Task 1: Bootstrap the `server/` codebase

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/.dockerignore`, `server/src/server.ts` (stub), `server/src/types.ts`

- [ ] **Step 1: Create `server/package.json`**

  ```json
  {
    "name": "suitetalk-server",
    "version": "1.0.0",
    "private": true,
    "type": "module",
    "engines": { "node": "20" },
    "scripts": {
      "build": "tsc",
      "start": "node dist/server.js",
      "dev": "tsc --watch"
    },
    "dependencies": {
      "pino": "^9.5.0",
      "ws": "^8.18.0"
    },
    "devDependencies": {
      "@types/node": "^20.16.5",
      "@types/ws": "^8.5.13",
      "typescript": "^5.5.4"
    }
  }
  ```

  ESM (`"type": "module"`) is the modern Node default; `tsc` compiles `.ts` to `.js` with ESM imports.

- [ ] **Step 2: Create `server/tsconfig.json`**

  ```json
  {
    "compilerOptions": {
      "target": "es2022",
      "module": "nodenext",
      "moduleResolution": "nodenext",
      "outDir": "dist",
      "rootDir": "src",
      "strict": true,
      "noUnusedLocals": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "sourceMap": true
    },
    "include": ["src"]
  }
  ```

- [ ] **Step 3: Create `server/.dockerignore`**

  ```
  node_modules
  dist
  *.log
  .env*
  .git
  README.md
  ```

- [ ] **Step 4: Create `server/src/types.ts`**

  ```ts
  // Shared message shapes between the RN client and the WS server.
  // Keep this file in sync with src/lib/voice-ws.ts on the client.

  export type ClientMessage =
    | { type: 'hello'; clientId: string; handle: string }
    | { type: 'audio.chunk'; seq: number; bytes: string } // base64
    | { type: 'audio.end' };

  export type ServerMessage =
    | { type: 'ready' }
    | { type: 'ack'; forSeq: number }
    | { type: 'bye'; reason: string };
  ```

- [ ] **Step 5: Create `server/src/server.ts` (stub)**

  ```ts
  // Replaced in Task 2 with the real server. This stub exists so `tsc`
  // compiles and `Dockerfile` has something to run before Task 2 lands.
  console.log('suitetalk-ws: stub server. Replaced in Task 2.');
  ```

- [ ] **Step 6: Install + build**

  ```bash
  cd server
  pnpm install
  pnpm run build
  ls dist/server.js
  ```

  Expected: `dist/server.js` exists.

- [ ] **Step 7: Commit**

  ```bash
  cd /Users/ross/Documents/suitetalk
  git add server/package.json server/tsconfig.json server/.dockerignore server/src/server.ts server/src/types.ts server/pnpm-lock.yaml
  git commit -m "Bootstrap suitetalk-ws server codebase"
  ```

  If pnpm produced a lockfile, include it. Don't commit `server/node_modules/` or `server/dist/` (we'll gitignore those next).

- [ ] **Step 8: Update `.gitignore` at repo root** to include the server's build/install artifacts

  Add at the bottom of `/Users/ross/Documents/suitetalk/.gitignore`:

  ```
  # server build artifacts
  server/dist
  server/node_modules
  ```

  Then:

  ```bash
  git add .gitignore
  git commit -m "Gitignore server build artifacts"
  ```

---

## Task 2: Implement the WebSocket server

**Files:**
- Rewrite: `server/src/server.ts`

- [ ] **Step 1: Replace `server/src/server.ts`** with:

  ```ts
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
  ```

  Key choices:
  - **Bind to `0.0.0.0`**, not `localhost`. Required by Fly's proxy.
  - **`/health` endpoint** for Fly's machine health checks.
  - **`/ws` path** for the WebSocket upgrade — keeps the surface explicit.
  - **No auth in Phase 5**. We'll add Firebase ID-token verification in Phase 7 when the server starts writing Firestore docs.

- [ ] **Step 2: Build locally and smoke test**

  ```bash
  cd server
  pnpm run build
  PORT=8080 node dist/server.js &
  SERVER_PID=$!
  sleep 1
  curl -s http://localhost:8080/health  # expect "ok"
  kill $SERVER_PID
  ```

  If `/health` returns "ok", the server is fine. (We'll test the WebSocket path with the Debug action in Task 5; testing it from the CLI requires `wscat` which we don't want to introduce as a dep.)

- [ ] **Step 3: Commit**

  ```bash
  cd /Users/ross/Documents/suitetalk
  git add server/src/server.ts
  git commit -m "Implement echo websocket server"
  ```

---

## Task 3: Fly.io deploy config

**Files:**
- Create: `server/Dockerfile`, `server/fly.toml`, `server/README.md`

We're writing the Dockerfile by hand instead of using `fly launch`'s auto-generated one. Reason: `fly launch` produces a generic Dockerfile that compiles inside the container; we want a slim build using `pnpm` (so it matches the rest of the monorepo) and a `dist`-only final image.

- [ ] **Step 1: Create `server/Dockerfile`**

  ```dockerfile
  # Multi-stage: build TS in a fat image, copy dist + node_modules to a slim runtime.
  FROM node:20-bookworm-slim AS build
  WORKDIR /app
  RUN corepack enable && corepack prepare pnpm@latest --activate
  COPY package.json pnpm-lock.yaml* ./
  RUN pnpm install --frozen-lockfile --prod=false
  COPY tsconfig.json ./
  COPY src ./src
  RUN pnpm run build
  RUN pnpm prune --prod

  FROM node:20-bookworm-slim AS runtime
  WORKDIR /app
  ENV NODE_ENV=production
  COPY --from=build /app/node_modules ./node_modules
  COPY --from=build /app/dist ./dist
  COPY package.json ./
  USER node
  EXPOSE 8080
  CMD ["node", "dist/server.js"]
  ```

  Notes:
  - Two stages keep the final image small (<200MB).
  - `USER node` drops root privileges in runtime — defensive default.
  - `EXPOSE 8080` is documentation; Fly's proxy reads `fly.toml` for the actual port.

- [ ] **Step 2: Create `server/fly.toml`**

  Replace `<APP-NAME>` with the app name you reserved in Prerequisites:

  ```toml
  app = "<APP-NAME>"
  primary_region = "ord"   # us-central, low-latency to Firestore us-central1.
  # Swap to whatever region is closest to your hackathon venue if not in the US.

  [build]

  [http_service]
    internal_port = 8080
    force_https = true
    auto_stop_machines = "stop"
    auto_start_machines = true
    min_machines_running = 0
    processes = ["app"]

    [[http_service.checks]]
      interval = "30s"
      timeout = "5s"
      grace_period = "5s"
      method = "GET"
      path = "/health"

  [[vm]]
    size = "shared-cpu-1x"
    memory = "256mb"
    cpu_kind = "shared"
    cpus = 1
  ```

  Why these choices:
  - **`http_service` block** (not legacy `[[services]]`). Fly's current docs treat WebSockets as standard HTTP upgrades; the http handler is sufficient.
  - **`force_https = true`** so the client connects via `wss://` only.
  - **`auto_stop_machines = "stop"` + `auto_start_machines = true`** — the machine sleeps when idle (saves $$), wakes on incoming HTTP. Trade-off: ~1–2s cold-start when a client connects after idle. Acceptable for hackathon; flip to `min_machines_running = 1` if the latency bites during demo rehearsal.
  - **Health check on `/health`** uses the endpoint we built in Task 2.
  - **256MB RAM, shared CPU** is plenty for the WS-echo workload; per pricing docs that's ~$2/month always-on (less if auto-stop kicks in).

- [ ] **Step 3: Create `server/README.md`**

  ```md
  # suitetalk-ws

  WebSocket service for the SuiteTalk voice pipeline. Phase 5: echoes
  acknowledgements; Phase 6 proxies to ElevenLabs; Phase 7 writes Firestore.

  ## Deploy

      cd server
      fly deploy

  First-time setup:

      fly apps create <APP-NAME>      # if not done already
      fly secrets set ELEVENLABS_API_KEY=... FIREBASE_SA_JSON_BASE64=...
      fly deploy

  ## Logs

      fly logs

  ## Local dev

      pnpm install
      pnpm run build
      PORT=8080 node dist/server.js

  ## Cost

  ~$2/month always-on (shared-cpu-1x, 256MB). Auto-stop is enabled so the
  machine sleeps when idle. Set `min_machines_running = 1` in fly.toml if
  cold-start latency matters for your demo.
  ```

- [ ] **Step 4: Commit**

  ```bash
  cd /Users/ross/Documents/suitetalk
  git add server/Dockerfile server/fly.toml server/README.md
  git commit -m "Add fly deploy config for suitetalk-ws"
  ```

- [ ] **Step 5: Deploy** (human step; involves interactive Fly CLI)

  ```bash
  cd server
  fly deploy
  ```

  First deploy is 2–4 minutes. Expected output ends with the app's public URL, e.g. `https://<APP-NAME>.fly.dev`. The WebSocket endpoint is `wss://<APP-NAME>.fly.dev/ws`.

- [ ] **Step 6: Verify health endpoint**

  ```bash
  curl https://<APP-NAME>.fly.dev/health
  ```

  Expected: `ok`. If you get a connection error, check `fly logs` for crash reasons.

---

## Task 4: Client-side WS wrapper

**Files:**
- Create: `src/lib/voice-ws.ts`

This is a tiny client wrapper around the browser-standard `WebSocket` API. React Native ships `WebSocket` globally — no extra dep required.

- [ ] **Step 1: Create `src/lib/voice-ws.ts`**

  ```ts
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
  ```

- [ ] **Step 2: Set the env var in `.env.local`**

  Add this line:

  ```
  EXPO_PUBLIC_VOICE_WS_URL=https://<APP-NAME>.fly.dev
  ```

  (The wrapper appends `/ws` itself. We use `https://` and React Native's `WebSocket` auto-upgrades to `wss://` on TLS endpoints. Cleaner than putting `wss://` here.)

- [ ] **Step 3: TypeScript check** — still 4 pre-existing errors, no new ones.

- [ ] **Step 4: Commit**

  ```bash
  git add src/lib/voice-ws.ts
  git commit -m "Add voice WS client wrapper"
  ```

---

## Task 5: Debug action for end-to-end smoke test

**Files:**
- Modify: `src/app/debug.tsx`

Add a "Connect voice WS" action that opens a connection, sends a synthetic audio chunk, waits for the ack, sends `audio.end`, closes. Display the round-trip result in the Debug page's right panel.

- [ ] **Step 1: Read `src/app/debug.tsx`** to understand the current `ACTIONS` array and how `runAction` displays results.

- [ ] **Step 2: Add the import**

  ```ts
  import { openVoiceSession } from '@/lib/voice-ws';
  ```

- [ ] **Step 3: Append a new action to the `ACTIONS` array** (alongside the existing "Post test note" action — don't replace it).

  ```ts
  {
    label: 'Voice WS round-trip',
    run: async () => {
      const { uid, handle } = await getIdentity();
      const events: string[] = [];
      const startedAt = Date.now();
      const session = openVoiceSession({
        clientId: uid,
        handle,
        onOpen: () => events.push('open'),
        onClose: (code, reason) => events.push(`close ${code} ${reason}`),
        onError: () => events.push('error'),
      });
      const ack = await new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('no ack in 5s')), 5000);
        session.onServerMessage((msg) => {
          events.push(`recv ${msg.type}`);
          if (msg.type === 'ready') {
            session.sendChunk('SGVsbG8gV29ybGQ='); // base64("Hello World")
          }
          if (msg.type === 'ack') {
            clearTimeout(timeout);
            session.end();
            session.close();
            resolve(msg);
          }
        });
      });
      return {
        url: session.url,
        durationMs: Date.now() - startedAt,
        events,
        ack,
      };
    },
  },
  ```

- [ ] **Step 4: TypeScript check** — no new errors.

- [ ] **Step 5: Commit**

  ```bash
  git add src/app/debug.tsx
  git commit -m "Add voice WS round-trip debug action"
  ```

---

## Phase 5 acceptance checklist

Once committed, deployed to Fly, and the dev build is running:

- [ ] `curl https://<APP-NAME>.fly.dev/health` returns `ok`.
- [ ] Web debug page → "Voice WS round-trip" → output panel shows:
  - `events`: `["open", "recv ready", "recv ack", "close 1000 ..."]`
  - `ack`: `{ type: "ack", forSeq: 1 }`
  - `durationMs` ≤ 1500 ms (will be larger on the first hit if the Fly machine is cold-starting; subsequent hits should be ≤ 500 ms).
- [ ] `fly logs` shows the connection lifecycle for that round-trip with the right `clientId` and `handle`.
- [ ] The connection stays open for at least 60 seconds without being dropped (test by holding the panel; subsequent debug runs reuse a fresh connection each time).
- [ ] `pnpm exec tsc --noEmit` reports baseline 4 errors only.

When all check, Phase 5 is done. We can move on to Phase 6 (ElevenLabs proxy).

---

## Risks + mitigations

| Risk | Mitigation |
| --- | --- |
| Fly app name collision (global namespace) | Reserve name in prerequisites; fall back to `suitetalk-ws-<your-handle>`. |
| Auto-stop machines cold-start adds visible demo latency | If it bites, set `min_machines_running = 1` in fly.toml; reverts the $2/month cost benefit but unblocks the demo. |
| WebSocket on Fly idle-disconnects long sessions | Fly's docs don't specify a hard idle timeout for WS, but anecdotally connections survive multi-minute idles. We'll find out empirically; if it's a problem we add a 30 s keepalive ping on the client. |
| Free Apple ID dev builds expire every 7 days, so the client can't connect | Same constraint we already accepted in Phase 1. Re-sign via Xcode close to demo. |
| Fly secrets are env vars only, so multi-line file contents (e.g. firebase service account JSON) need base64 | Document the pattern in Task 3's README; Phase 7 (Firebase admin) uses this technique. |
| `wss://` over Fly's anycast IPv6 fails on a hotel/conference network with broken IPv6 | Fly automatically also vends an IPv4 address; the client uses whichever resolves. Test on the demo network before the day. |

---

## Out of scope for Phase 5 (deferred)

- ElevenLabs proxying — Phase 6.
- Wake-phrase + silence detection — Phase 7.
- Firestore writes from the server — Phase 7.
- Auth (Firebase ID-token verification on the WS) — Phase 7. For now anyone with the URL can connect.
- Multiplexing — one mic stream per client connection is fine.
- Reconnection / backoff on the client — single-shot test for Phase 5; lifecycle robustness comes in Phase 8.
- Backpressure for slow consumers — not relevant until ElevenLabs is in the loop.

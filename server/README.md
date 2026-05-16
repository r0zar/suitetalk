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

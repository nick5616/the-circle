# The Circle

One persistent global video room. Up to 8 participants on camera, unlimited audience in chat.

## Stack

- **Frontend** — React + TypeScript + Vite + Tailwind, served on port 5173
- **Backend** — Django + Django Channels (ASGI), served on port 8000
- **Signaling / state** — Redis on port 6379

---

## Option A — Docker (recommended)

Requires [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
# Start everything (Redis + backend + frontend dev server)
docker compose up

# Rebuild images after dependency changes (requirements.txt / package.json)
docker compose up --build

# Stop and remove containers
docker compose down
```

Open http://localhost:5173.

---

## Option B — Run locally

### Prerequisites

```bash
# Install Redis (macOS) — runs as a background service, no terminal needed
brew install redis
brew services start redis

# Install Python deps
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..

# Install frontend deps
cd frontend
npm install
cd ..
```

### Start each service in a separate terminal

**Terminal 1 — Redis**
```bash
# If installed via Homebrew, Redis runs as a background service — no terminal needed.
# Start/stop the service:
brew services start redis
brew services stop redis

# Check status:
brew services info redis
```

**Terminal 2 — Backend**
```bash
cd backend
source venv/bin/activate
daphne -b 0.0.0.0 -p 8000 config.asgi:application
```

**Terminal 3 — Frontend**
```bash
cd frontend
npm run dev
```

Open http://localhost:5173.

### Verify Redis is running
```bash
redis-cli ping   # should print PONG
```

---

## Common commands

```bash
# Flush all room state (participants, chat, audience count)
redis-cli FLUSHALL

# Watch Redis traffic in real time
redis-cli MONITOR

# Backend: open Django shell (local)
cd backend && source venv/bin/activate && python manage.py shell

# Frontend: production build
cd frontend && npm run build
```

---

## Ports

| Service  | Port |
|----------|------|
| Frontend | 5173 |
| Backend  | 8000 |
| Redis    | 6379 |

WebSocket connections go to `ws://localhost:5173/ws/room/` — the Vite dev server proxies `/ws/*` to the Django backend automatically.

---

## How calls stay up

- **Sessions resume.** The server hands each socket a resume token in `hello`. If the socket drops (wifi blip, phone lock, Cloud Run request timeout, backend deploy) the client reconnects with it and keeps its seat. The seat is held for 30s (`GRACE_SECONDS`) and shows as "keeping their seat warm…". Media is peer-to-peer, so it keeps flowing the whole time.
- **Heartbeats.** The client pings every 10s and treats 25s of silence as a dead socket. Each ping refreshes `alive:<sid>` in Redis, and sessions whose heartbeat expires (a crashed server instance) are reaped. Nothing wipes Redis on startup, because that would erase other instances' live seats.
- **Self-healing peers** (`frontend/src/rtc.ts`). Links are reconciled declaratively from room state, and every connection carries a `pcid` so stale signals get dropped. Recovery escalates: ICE restart → rebuild → the answerer "kicks" the offerer.
- **Pinned deps.** redis-py 8 changed `socket_timeout` to default to 5s, which races channels_redis's 5s blocking pop and killed every socket with code 1011 every ~15s. `requirements.txt` keeps redis below 8.

## Observability

- **Debug HUD**: add `?debug` to the URL or press <kbd>`</kbd>. It shows per-peer connection state, path (host/srflx/relay), RTT, loss, fps, bitrate, and resolution, plus recent events.
- **Server-side telemetry**: clients ship a batch of events and per-peer stats over the websocket every 30s, and immediately on failures. The backend logs them as `circle.telemetry` JSON lines, so after a real call you can read what happened in the Cloud Run logs.
- **`window.__circle`**: events, peers, socket, and me, for poking at things from the console.

## Testing (multi-client soak + chaos)

```bash
cd e2e && npm install && npx playwright install chromium

# Spawns the backend itself; needs Redis + the Vite dev server running.
# Real Chromium clients with fake cameras: join, chat, camera off/on, take/leave
# seat, websocket blips, going offline, backend restart, leave+rejoin, soak.
node soak.mjs --participants 4 --audience 2 --mobile-audience --soak 60

# Real packet loss / latency / blackouts via tc netem in a Linux container
# (needs Docker, plus the backend + dev server already running):
./netem.sh thailand   # ~160ms RTT, jitter, 3% loss
./netem.sh mobile     # 250ms+ RTT, 6% loss, 1.5 Mbit
```

Every run writes a JSON report, screenshots, and the backend log to `e2e/artifacts/`.

## Deploying notes

- **Cloud Run**: set the request timeout to the max (`--timeout=3600`), since websockets count as requests. Drops are survivable now, but each one still costs a reconnect.
- **TURN**: set `TURN_URL` (comma-separated is fine, e.g. udp + tcp + `turns:` 443) plus `TURN_SECRET` or `TURN_USERNAME`/`TURN_CREDENTIAL`. Without TURN, people behind symmetric NATs (many mobile carriers, corporate wifi) can't connect at all. Check the HUD's `path` column: `relay` means TURN is in use.
- **Mesh limits**: each participant uploads one stream per other participant *and* one per audience member. Bitrate adapts (`applyBitrate` in `rtc.ts`), but a large audience will eventually need an SFU (LiveKit, mediasoup).

## Troubleshooting

**Lobby shows 0/8 participants**
Redis is probably not running. Start it (`redis-server`) and restart the backend.

**Video feeds don't load**
Redis must be running for WebRTC signaling to work — offers/answers/ICE are forwarded through the backend via Redis. Run `redis-cli ping` to check. If Redis restarted mid-session, also restart the backend so session channels are re-registered.

**"Could not access camera/mic"**
The browser needs camera and microphone permissions. Check the address bar for a blocked permissions icon. On some networks, WebRTC only works on `localhost` or HTTPS — make sure you're not accessing via an IP address.

**Port already in use**
```bash
# Find and kill whatever is on a port (e.g. 8000)
lsof -ti :8000 | xargs kill -9
```

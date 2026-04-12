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

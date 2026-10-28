# Project Design Document
## Global Hangout — One Room, Whole World

---

## What We're Building

A single-page web app with **one persistent global room**. Up to 8 people can be **participants** — on camera, live, talking to each other via WebRTC. Everyone else joins as **audience** — watching the participant video grid and chatting via a shared text chat that all participants and audience members can see.

This is a working prototype demonstrating: WebRTC multi-party video, Django Channels WebSocket signaling, Redis-backed real-time state, and role-based UI — no auth, no database, no room codes.

---

## Monorepo Structure

```
project-root/
├── backend/
│   ├── manage.py
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── config/
│   │   ├── settings.py
│   │   ├── urls.py
│   │   └── asgi.py          # Django Channels entry point
│   └── rooms/
│       ├── consumers.py     # WebSocket consumer
│       ├── routing.py
│       └── room_state.py    # Redis interface
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── socket.ts        # WebSocket client singleton
│       ├── webrtc.ts        # WebRTC peer connection logic
│       ├── components/
│       │   ├── LandingLobby.tsx
│       │   ├── VideoGrid.tsx
│       │   ├── VideoTile.tsx
│       │   ├── Chat.tsx
│       │   └── SeatBar.tsx
│       └── types.ts         # Shared message types
└── docker-compose.yml
```

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Backend framework | Django + Django Channels | Mirrors production stack |
| WebSocket layer | Django Channels (ASGI) | Handles signaling + chat + state |
| Channel layer | Redis | Fast pub/sub, holds all room state |
| Async tasks | None needed at prototype scale | — |
| Database | None | All state lives in Redis |
| Frontend | React + TypeScript + Vite | Matches production stack |
| Video transport | Browser WebRTC APIs (no wrapper) | Direct control, no abstraction |
| Styling | Tailwind CSS | Fast, utility-first |

---

## No Database

There is no PostgreSQL. All state is stored in Redis:

- **Room seats** — Redis Hash: `room:seats` → `{ session_id: { name, joined_at } }`
- **Audience count** — Redis key: `room:audience_count`
- **Chat history** — Redis List: `room:chat`, capped at last 100 messages

When the server restarts, state resets. This is fine for a prototype.

---

## User Roles

**Participant**
- On camera, microphone active
- Appears in the video grid
- Can see chat and send chat messages
- Maximum 8 at a time

**Audience**
- No camera/mic
- Watches the video grid
- Can see chat and send chat messages
- Unlimited count
- Can claim an open seat to become a participant

---

## Views / Pages

### Landing + Lobby (combined, single screen)

Shown before the user has joined as either role.

- Enter a display name
- See how many seats are taken (e.g. "5/8 participants")
- See live audience count
- Two buttons: **"Join as Participant"** (disabled if seats full) / **"Watch as Audience"**
- Once either button is clicked, transition to the main view

### Main View

Two-panel layout:

**Left — Video Grid**
- Responsive grid of up to 8 video tiles
- Each tile shows the participant's video stream + name label
- Empty seats shown as placeholder tiles
- Local participant sees their own video (muted to avoid echo)

**Right — Chat Sidebar**
- Scrollable message list (virtualized if needed)
- All messages visible to everyone
- Input box at the bottom — anyone can send
- Audience members see a "Take a Seat" button in the sidebar header if a seat is open

---

## WebSocket Message Protocol

All messages are JSON `{type, payload}` over one websocket per client
(`/ws/room/?sid=<id>&token=<token>` when resuming). See `frontend/src/types.ts`.

**Client → Server:** `join {name, role}`, `chat {content}`,
`signal {target, pcid, description? | candidate? | kick?}`, `media {mic, cam}`,
`react {emoji}`, `take_seat`, `leave_seat`, `ping {t}`, `bye`, `telemetry {...}`

**Server → Client:** `hello {session_id, token, resumed, role, name, ice_servers, grace_seconds}`,
`joined {role, name}`, `room_state {seats[8], audience_count, ...}` (seats carry
`mic`, `cam`, `away`), `chat`, `chat_history`, `signal {from, pcid, ...}`,
`peer_gone {session_id}`, `reaction`, `seat_denied`, `pong`

---

## WebRTC Architecture

A peer-to-peer mesh. The server only relays signaling. `frontend/src/rtc.ts` reconciles
links declaratively from room state, and every pair has exactly one offerer:

- participant ↔ participant: the lower session id offers
- audience → participant: the audience member offers, receive-only

Each `RTCPeerConnection` has a random `pcid`, and all signals carry it, so stale
signals for a replaced connection are ignored. Recovery escalates: ICE restart on
`disconnected`/`failed`, then a full rebuild if a link isn't connected after 15s.
An answerer that is missing a link sends a `kick` asking the offerer to (re)offer.

Remote audio plays through dedicated hidden `<audio>` elements, and video
elements are always muted. That way a camera turning off or a tile re-mounting
never cuts anyone's voice. Turning the camera off releases the device; turning it
back on swaps the new track in with `replaceTrack` (no renegotiation).

---

## Django Channels Consumer (rooms/consumers.py)

Single `AsyncWebsocketConsumer` handling all message types.

Key responsibilities:
- Assign a `session_id` (uuid) on connect
- Add client to the global channel group `"global_room"`
- Route incoming messages to handlers
- Manage seat state in Redis atomically (use Redis transactions to prevent race conditions on seat claiming)
- Forward WebRTC signaling messages to specific clients by `session_id` (use per-session channel names)
- On disconnect: if participant, vacate seat, broadcast `room_state`

---

## Redis Keys

```
room:seats          Hash    { session_id → JSON(name, idx, joined_at, mic, cam, away) }
room:audience       Hash    { session_id → name }
room:chat           List    JSON chat messages, LTRIM to 100
sess:<id>           Hash    { token, name, role, channel, gen }, TTL 1h
alive:<id>          String  heartbeat, TTL 45s (expired → session reaped)
```

---

## docker-compose.yml

Spins up three services:

```yaml
services:
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  backend:
    build: ./backend
    ports: ["8000:8000"]
    environment:
      - REDIS_URL=redis://redis:6379
    depends_on: [redis]
    volumes:
      - ./backend:/app

  frontend:
    build: ./frontend
    ports: ["5173:5173"]
    volumes:
      - ./frontend:/app
    command: npm run dev -- --host
```

The frontend dev server proxies `/ws/` to the Django backend to avoid CORS issues during development.

---

## Deployment (Production Target)

- **Frontend** → Netlify. Base directory: `frontend/`. Build command: `npm run build`. Publish: `dist/`. Netlify auto-detects monorepo and only rebuilds on changes to `frontend/`.
- **Backend** → GCP Cloud Run. Build from `backend/Dockerfile`. Cloud Build trigger watches `backend/**`. Set `REDIS_URL` env var pointing to GCP Memorystore (Redis).
- **Redis** → GCP Memorystore for Redis (managed).
- WebSocket connections from Netlify frontend point to the Cloud Run backend URL.

---

## What This Prototype Deliberately Omits

- Authentication / user accounts
- Persistent chat history (resets on server restart)
- Recording
- Room codes or multiple rooms
- Abuse moderation
- Mobile-optimized layout (desktop first)
- TURN server configuration (WebRTC works on local network and most open networks; corporate firewalls may block P2P)

---

## Definition of "Done" for Prototype

- [ ] Two browser tabs can join as participants and see each other's video
- [ ] A third tab joining as audience sees the video grid but no camera prompt
- [ ] Chat messages appear in real time for all connected clients
- [ ] Disconnecting a participant removes them from the grid for all others
- [ ] Audience member can claim an open seat and begin streaming video
- [ ] Seat count accurately reflects connected participants
- [ ] Full stack runs with `docker compose up`
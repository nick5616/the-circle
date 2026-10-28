import type { ClientMessage, ServerMessage, WsStatus } from "./types";
import { telemetry } from "./telemetry";

// Reconnecting websocket with session resume.
//
// The server hands us {session_id, token} in `hello`. Every reconnect presents
// them, so a dropped socket (wifi blip, phone lock, Cloud Run request timeout,
// backend deploy) resumes the same seat and peers never see us leave. Peer-to-
// peer media keeps flowing the whole time — only signaling was interrupted.

type Handler = (msg: ServerMessage) => void;
type StatusHandler = (s: WsStatus) => void;

const PING_EVERY_MS = 10_000;
const DEAD_AFTER_MS = 25_000; // no traffic for this long → socket is a zombie
const MAX_QUEUE = 300;

let ws: WebSocket | null = null;
let ready = false; // hello received on the current socket
let wanted = false;
let attempt = 0;
let status: WsStatus = "connecting";
let lastRx = 0;
let rtt = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let pingTimer: ReturnType<typeof setInterval> | undefined;
let creds: { sid: string; token: string } | null = null;
let queue: string[] = [];

const handlers = new Set<Handler>();
const statusHandlers = new Set<StatusHandler>();

function wsUrl(): string {
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const base = import.meta.env.VITE_WS_URL ?? `${protocol}://${location.host}`;
  const qs = creds ? `?sid=${encodeURIComponent(creds.sid)}&token=${encodeURIComponent(creds.token)}` : "";
  return `${base}/ws/room/${qs}`;
}

function setStatus(s: WsStatus) {
  if (s === status) return;
  status = s;
  statusHandlers.forEach((h) => h(s));
}

function open() {
  clearTimeout(retryTimer);
  ready = false;
  const sock = new WebSocket(wsUrl());
  ws = sock;

  sock.onopen = () => {
    if (ws !== sock) return;
    lastRx = Date.now();
    startPing();
  };

  sock.onmessage = (e) => {
    if (ws !== sock) return;
    lastRx = Date.now();
    let msg: ServerMessage;
    try {
      msg = JSON.parse(e.data as string) as ServerMessage;
    } catch {
      return;
    }
    if (msg.type === "hello") {
      const hadSession = !!creds;
      creds = { sid: msg.payload.session_id, token: msg.payload.token };
      ready = true;
      attempt = 0;
      if (hadSession) telemetry.event(msg.payload.resumed ? "ws_resumed" : "session_lost");
      // A fresh session invalidates anything queued for the old one
      if (!msg.payload.resumed) queue = [];
      setStatus("open");
      while (queue.length && sock.readyState === WebSocket.OPEN) sock.send(queue.shift()!);
    } else if (msg.type === "pong") {
      rtt = Date.now() - msg.payload.t;
    }
    handlers.forEach((h) => h(msg));
  };

  sock.onclose = (e) => {
    if (ws !== sock) return;
    telemetry.event("ws_close", { code: e.code });
    drop();
  };
}

// Abandon the current socket without waiting for a close handshake (which can
// hang for minutes on a dead TCP connection) and schedule a reconnect.
function drop() {
  const old = ws;
  ws = null;
  ready = false;
  stopPing();
  if (old) {
    old.onopen = old.onmessage = old.onclose = null;
    try {
      old.close();
    } catch {}
  }
  if (!wanted) return;
  setStatus("reconnecting");
  const delay = Math.min(8000, 300 * 2 ** attempt) * (0.6 + Math.random() * 0.8);
  attempt++;
  retryTimer = setTimeout(open, delay);
}

function startPing() {
  stopPing();
  pingTimer = setInterval(() => {
    if (Date.now() - lastRx > DEAD_AFTER_MS) {
      telemetry.event("ws_dead", { silentMs: Date.now() - lastRx });
      drop();
      return;
    }
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping", payload: { t: Date.now() } }));
  }, PING_EVERY_MS);
}

function stopPing() {
  clearInterval(pingTimer);
}

function reconnectNow() {
  if (!wanted) return;
  if (ws && ready && Date.now() - lastRx < PING_EVERY_MS * 1.5) return;
  attempt = 0;
  drop();
  clearTimeout(retryTimer);
  open();
}

// Network came back, or the tab woke up (mobile suspends sockets when locked)
window.addEventListener("online", reconnectNow);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") reconnectNow();
});

export const socket = {
  connect(): void {
    wanted = true;
    if (ws) return;
    open();
  },

  send(msg: ClientMessage): void {
    const data = JSON.stringify(msg);
    if (ws && ready && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    } else if (queue.length < MAX_QUEUE) {
      queue.push(data);
    }
  },

  /** Leave for real: tell the server to free our seat now, then start a fresh lobby session. */
  leave(): void {
    if (ws && ready && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "bye" }));
    creds = null;
    queue = [];
    wanted = false;
    drop();
    wanted = true;
    setStatus("connecting");
    retryTimer = setTimeout(open, 150);
  },

  /** Best-effort goodbye when the page is going away. */
  sayBye(): void {
    if (ws && ready && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "bye" }));
  },

  onMessage(handler: Handler): () => void {
    handlers.add(handler);
    return () => handlers.delete(handler);
  },

  onStatus(handler: StatusHandler): () => void {
    statusHandlers.add(handler);
    return () => statusHandlers.delete(handler);
  },

  get status() {
    return status;
  },
  get rtt() {
    return rtt;
  },
  get sessionId() {
    return creds?.sid ?? "";
  },

  /** Test hook: kill the socket as if the network blipped. */
  simulateDrop(): void {
    drop();
  },
};

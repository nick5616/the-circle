// Client-side observability: a ring buffer of notable events, exposed on
// window.__circle for the soak harness / debug HUD, and shipped to the backend
// over the websocket (logged as `circle.telemetry` lines) so real-world calls
// leave a trail you can read in the server logs afterwards.

export interface TelemetryEvent {
  t: number; // ms since page load
  at: string; // wall clock, for correlating with server logs
  ev: string;
  [k: string]: unknown;
}

const MAX_EVENTS = 600;
const SHIP_EVERY_MS = 30_000;
// Events worth shipping promptly instead of waiting for the next batch
const URGENT = new Set(["pc_failed", "pc_rebuild", "ws_dead", "ws_resumed", "session_lost", "media_error", "audio_blocked"]);

const events: TelemetryEvent[] = [];
let shipped = 0;
let sender: ((payload: Record<string, unknown>) => void) | null = null;
let summary: (() => unknown) | null = null;
let urgentTimer: ReturnType<typeof setTimeout> | undefined;

function ship() {
  if (!sender) return;
  const fresh = events.slice(Math.max(shipped, events.length - 40));
  shipped = events.length;
  sender({
    events: fresh.map(({ t, ev, ...rest }) => ({ t, ev, ...rest })),
    peers: summary?.(),
    ua: navigator.userAgent.slice(0, 120),
  });
}

setInterval(ship, SHIP_EVERY_MS);

export const telemetry = {
  event(ev: string, data: Record<string, unknown> = {}) {
    events.push({ t: Math.round(performance.now()), at: new Date().toISOString(), ev, ...data });
    if (events.length > MAX_EVENTS) {
      const removed = events.length - MAX_EVENTS;
      events.splice(0, removed);
      shipped = Math.max(0, shipped - removed);
    }
    if (URGENT.has(ev)) {
      clearTimeout(urgentTimer);
      urgentTimer = setTimeout(ship, 2000);
    }
  },
  events,
  setSender(fn: typeof sender) {
    sender = fn;
  },
  setSummary(fn: typeof summary) {
    summary = fn;
  },
  flush: ship,
};

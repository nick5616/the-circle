import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PeerInfo, Seat } from "../types";
import { circleLayout, gridLayout, type Rect } from "../layout";
import { scene } from "../scene";
import { hashNameToColor } from "../fireColors";
import Tile from "./Tile";

interface Props {
  seats: Seat[]; // occupied seats in seat order
  myId: string;
  streams: Map<string, MediaStream>;
  peers: Map<string, PeerInfo>;
  view: "grid" | "circle";
  localCam: boolean;
  localMic: boolean;
  insets: { top: number; right: number; bottom: number; left: number };
}

const EXIT_MS = 520;

interface Rendered {
  seat: Seat;
  leaving: boolean;
}

export default function Stage({ seats, myId, streams, peers, view, localCam, localMic, insets }: Props) {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  // Seats that just left, kept briefly so they can animate out
  const [departed, setDeparted] = useState<Map<string, Seat>>(() => new Map());
  const prevSeats = useRef<Seat[]>([]);
  const exitTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const lastRects = useRef(new Map<string, Rect>());
  const els = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Each departure has its own timer, so rapid churn can't strand a ghost tile
  useEffect(() => {
    const ids = new Set(seats.map((s) => s.session_id));
    const gone = prevSeats.current.filter((s) => !ids.has(s.session_id));
    prevSeats.current = seats;
    for (const [sid, t] of exitTimers.current) {
      if (!ids.has(sid)) continue;
      clearTimeout(t);
      exitTimers.current.delete(sid);
    }
    setDeparted((prev) => {
      const next = new Map([...prev].filter(([sid]) => !ids.has(sid)));
      for (const s of gone) next.set(s.session_id, s);
      return next.size === prev.size && [...next.keys()].every((k) => prev.has(k)) ? prev : next;
    });
    for (const s of gone) {
      const sid = s.session_id;
      clearTimeout(exitTimers.current.get(sid));
      exitTimers.current.set(sid, setTimeout(() => {
        exitTimers.current.delete(sid);
        lastRects.current.delete(sid);
        setDeparted((cur) => {
          const next = new Map(cur);
          next.delete(sid);
          return next;
        });
      }, EXIT_MS));
    }
  }, [seats]);

  useEffect(() => () => exitTimers.current.forEach(clearTimeout), []);

  // Derived during render, so a seat that left is never asked for a layout slot
  // (prevSeats still holds last render's seats here, so a just-departed tile
  // stays mounted through the frame before the effect records it)
  const seatIds = new Set(seats.map((s) => s.session_id));
  const leavingMap = new Map(departed);
  for (const s of prevSeats.current) if (!seatIds.has(s.session_id)) leavingMap.set(s.session_id, s);
  const rendered: Rendered[] = [
    ...seats.map((seat) => ({ seat, leaving: false })),
    ...[...leavingMap.values()].filter((s) => !seatIds.has(s.session_id)).map((seat) => ({ seat, leaving: true })),
  ];

  const W = Math.max(120, size.w - insets.left - insets.right);
  const H = Math.max(120, size.h - insets.top - insets.bottom);
  const portrait = W / H < 0.85;
  const aspect = portrait ? (seats.length <= 2 ? 4 / 5 : 1) : 16 / 9;

  const layout = useMemo(
    () => (view === "circle" ? circleLayout : gridLayout)(seats.length, W, H, aspect),
    [view, seats.length, W, H, aspect]
  );

  const rectFor = (sid: string, leaving: boolean): Rect => {
    if (leaving) return lastRects.current.get(sid) ?? { x: insets.left + W / 2, y: insets.top + H / 2, w: 0, h: 0 };
    const i = seats.findIndex((s) => s.session_id === sid);
    const r = layout.rects[i];
    const abs = { x: r.x + insets.left, y: r.y + insets.top, w: r.w, h: r.h };
    lastRects.current.set(sid, abs);
    return abs;
  };

  const register = useCallback((sid: string, el: HTMLElement | null) => {
    if (el) els.current.set(sid, el);
    else els.current.delete(sid);
  }, []);

  // Hand the fire its position and the people around it
  useLayoutEffect(() => {
    scene.fire = { x: layout.fire.x + insets.left, y: layout.fire.y + insets.top, size: layout.fire.size };
    scene.fireAlpha = layout.fireAlpha;
    scene.people = rendered.map((r) => ({
      sid: r.seat.session_id,
      color: hashNameToColor(r.seat.name).hex,
      el: els.current.get(r.seat.session_id),
      leaving: r.leaving,
    }));
  });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1, pointerEvents: "none" }}>
      {seats.length === 0 && rendered.length === 0 && (
        <p
          className="hand"
          style={{
            position: "absolute", left: 0, right: 0, top: insets.top + H * 0.22, textAlign: "center",
            fontSize: 26, color: "var(--ink-2)", animation: "rise-in 1s var(--ease) both",
          }}
        >
          nobody's on camera yet
        </p>
      )}
      <div style={{ pointerEvents: "auto" }}>
        {rendered.map(({ seat, leaving }) => {
          const sid = seat.session_id;
          const isLocal = sid === myId;
          return (
            <Tile
              key={sid}
              seat={seat}
              rect={rectFor(sid, leaving)}
              leaving={leaving}
              stream={streams.get(sid)}
              isLocal={isLocal}
              camOn={isLocal ? localCam : seat.cam}
              micOn={isLocal ? localMic : seat.mic}
              peer={peers.get(sid)}
              register={register}
            />
          );
        })}
      </div>
    </div>
  );
}

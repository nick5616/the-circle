import { useEffect, useRef, useState } from "react";
import type { Seat } from "../types";
import VideoTile from "./VideoTile";

interface Props {
  seats: Array<Seat | null>;
  streams: Map<string, MediaStream>;
  localSessionId: string;
  view: "grid" | "circle";
  audioLevels: Map<string, number>;
  localCameraOff: boolean;
}

const GRID_ROWS: Record<number, number[]> = {
  1: [1],
  2: [2],
  3: [2, 1],
  4: [2, 2],
  5: [3, 2],
  6: [3, 3],
  7: [4, 3],
  8: [4, 4],
};

const EXIT_MS = 280;

function tileSize(count: number): { w: number; h: number } {
  if (count <= 2) return { w: 320, h: 180 };
  if (count <= 4) return { w: 240, h: 135 };
  return { w: 190, h: 107 };
}

function circleRadius(count: number, tile: { w: number }): number {
  if (count <= 1) return 0;
  const minCircumference = count * (tile.w + 28);
  const r = minCircumference / (2 * Math.PI);
  const maxR = Math.min(window.innerWidth, window.innerHeight) * 0.38;
  return Math.min(Math.max(r, 180), maxR);
}

export default function VideoGrid({
  seats,
  streams,
  localSessionId,
  view,
  audioLevels,
  localCameraOff,
}: Props) {
  const occupied = seats.filter(Boolean) as Seat[];

  // exitingSeats: seats currently in their exit animation (have seat data so we can render them)
  const [exitingSeats, setExitingSeats] = useState<Map<string, Seat>>(new Map());
  const prevOccupiedRef = useRef<Seat[]>([]);
  // Keep a ref so timeout callbacks always see the latest occupied
  const occupiedRef = useRef<Seat[]>(occupied);
  occupiedRef.current = occupied;

  useEffect(() => {
    const prev = prevOccupiedRef.current;
    const currIds = new Set(occupied.map((s) => s.session_id));
    // Departing = was in prev, not in curr, not already animating out
    const departing = prev.filter(
      (s) => !currIds.has(s.session_id) && !exitingSeats.has(s.session_id)
    );

    if (departing.length > 0) {
      setExitingSeats((e) => {
        const next = new Map(e);
        departing.forEach((s) => next.set(s.session_id, s));
        return next;
      });
      const ids = departing.map((s) => s.session_id);
      const t = setTimeout(() => {
        setExitingSeats((e) => {
          const next = new Map(e);
          ids.forEach((id) => next.delete(id));
          return next;
        });
        prevOccupiedRef.current = occupiedRef.current;
      }, EXIT_MS);
      return () => clearTimeout(t);
    } else {
      prevOccupiedRef.current = occupied;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seats]);

  if (occupied.length === 0 && exitingSeats.size === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <p
          style={{
            color: "rgba(200, 160, 100, 0.22)",
            fontSize: "13px",
            letterSpacing: "0.06em",
          }}
        >
          waiting for the circle to fill
        </p>
      </div>
    );
  }

  // --- Circle view ---
  if (view === "circle") {
    // Include currently-exiting seats so they animate out before disappearing
    const exitingOnly = [...exitingSeats.values()].filter(
      (s) => !new Set(occupied.map((x) => x.session_id)).has(s.session_id)
    );
    const allSeats = [...occupied, ...exitingOnly];
    const tile = tileSize(occupied.length || 1);
    const radius = circleRadius(allSeats.length, tile);

    return (
      <div className="relative w-full h-full">
        {allSeats.map((seat, i) => {
          const isExiting = exitingSeats.has(seat.session_id);
          const angle = (i / allSeats.length) * 2 * Math.PI - Math.PI / 2;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius - 32;
          const isLocal = seat.session_id === localSessionId;
          const stream = streams.get(seat.session_id);
          const hasVideo = isLocal ? !localCameraOff : !!stream;

          return (
            // Outer: handles circle positioning via transform — animation must NOT be here
            <div
              key={seat.session_id}
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                width: `${tile.w}px`,
                height: `${tile.h}px`,
                transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
                transition: isExiting
                  ? undefined
                  : "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}
            >
              {/* Inner: handles enter/exit animation on a separate element
                  so animation transform doesn't override the outer position transform */}
              <div
                className={isExiting ? "animate-tile-out" : "animate-tile-in"}
                style={{ width: "100%", height: "100%" }}
              >
                <VideoTile
                  name={seat.name}
                  stream={stream}
                  isLocal={isLocal}
                  hasVideo={hasVideo}
                  audioLevel={audioLevels.get(seat.session_id) ?? 0}
                />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // --- Grid view ---
  const rowConfig = GRID_ROWS[Math.min(occupied.length, 8)] ?? [4, 4];
  const rows: Seat[][] = [];
  let start = 0;
  for (const count of rowConfig) {
    rows.push(occupied.slice(start, start + count));
    start += count;
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: "18px 18px 116px 18px",
        gap: "10px",
        boxSizing: "border-box",
      }}
    >
      {rows.map((row, rowIdx) => (
        <div
          key={rowIdx}
          style={{
            display: "flex",
            flex: 1,
            gap: "10px",
            justifyContent: "center",
            minHeight: 0,
          }}
        >
          {row.map((seat) => {
            const isLocal = seat.session_id === localSessionId;
            const stream = streams.get(seat.session_id);
            const hasVideo = isLocal ? !localCameraOff : !!stream;
            const gapTotal = (row.length - 1) * 10;

            return (
              // Outer: flex sizing — no transform, so animate-tile-in is safe here too,
              // but we put the animation on the inner wrapper to be consistent
              <div
                key={seat.session_id}
                style={{
                  height: "100%",
                  aspectRatio: "16/9",
                  maxWidth: `calc((100% - ${gapTotal}px) / ${row.length})`,
                  flexShrink: 0,
                }}
              >
                {/* Inner: animation wrapper */}
                <div className="animate-tile-in" style={{ width: "100%", height: "100%" }}>
                  <VideoTile
                    name={seat.name}
                    stream={stream}
                    isLocal={isLocal}
                    hasVideo={hasVideo}
                    audioLevel={audioLevels.get(seat.session_id) ?? 0}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

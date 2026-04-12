import type { Seat } from "../types";
import VideoTile from "./VideoTile";

interface Props {
  seats: Array<Seat | null>;
  streams: Map<string, MediaStream>;
  localSessionId: string;
  view: "grid" | "circle";
  speaking: Set<string>;
  localCameraOff: boolean;
}

// Row layout: how many tiles per row for each participant count
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

function tileSize(count: number): { w: number; h: number } {
  if (count <= 2) return { w: 320, h: 180 };
  if (count <= 4) return { w: 240, h: 135 };
  return { w: 190, h: 107 };
}

function circleRadius(count: number, tile: { w: number }): number {
  if (count <= 1) return 0;
  const minCircumference = count * (tile.w + 28);
  const r = minCircumference / (2 * Math.PI);
  // Clamp to something reasonable for the viewport
  const maxR = Math.min(window.innerWidth, window.innerHeight) * 0.38;
  return Math.min(Math.max(r, 180), maxR);
}

export default function VideoGrid({
  seats,
  streams,
  localSessionId,
  view,
  speaking,
  localCameraOff,
}: Props) {
  const occupied = seats.filter(Boolean) as Seat[];

  if (occupied.length === 0) {
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
    const tile = tileSize(occupied.length);
    const radius = circleRadius(occupied.length, tile);

    return (
      <div className="relative w-full h-full">
        {occupied.map((seat, i) => {
          const angle =
            (i / occupied.length) * 2 * Math.PI - Math.PI / 2;
          const x = Math.cos(angle) * radius;
          // Shift center up slightly to leave room for bottom controls
          const y = Math.sin(angle) * radius - 32;
          const isLocal = seat.session_id === localSessionId;
          const stream = streams.get(seat.session_id);
          const hasVideo = isLocal
            ? !localCameraOff
            : !!stream;

          return (
            <div
              key={seat.session_id}
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                width: `${tile.w}px`,
                height: `${tile.h}px`,
                transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
                transition:
                  "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
              }}
            >
              <VideoTile
                name={seat.name}
                stream={stream}
                isLocal={isLocal}
                hasVideo={hasVideo}
                isSpeaking={speaking.has(seat.session_id)}
              />
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
        padding: "18px 18px 116px 18px", // bottom pad clears controls + seat bar
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

            return (
              <div
                key={seat.session_id}
                style={{ flex: 1, minWidth: 0, maxWidth: `${100 / row.length}%` }}
              >
                <VideoTile
                  name={seat.name}
                  stream={stream}
                  isLocal={isLocal}
                  hasVideo={hasVideo}
                  isSpeaking={speaking.has(seat.session_id)}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

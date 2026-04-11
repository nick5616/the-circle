import type { Seat } from "../types";
import VideoTile from "./VideoTile";

interface Props {
  seats: Array<Seat | null>;
  streams: Map<string, MediaStream>;
  localSessionId: string;
}

// Grid column classes indexed by participant count (0–8)
const GRID_COLS = [
  "grid-cols-1",
  "grid-cols-1",
  "grid-cols-2",
  "grid-cols-2",
  "grid-cols-2",
  "grid-cols-3",
  "grid-cols-3",
  "grid-cols-3",
  "grid-cols-4",
];

export default function VideoGrid({ seats, streams, localSessionId }: Props) {
  const occupied = seats.filter(Boolean).length;
  const cols = GRID_COLS[Math.min(occupied, 8)];

  return (
    <div className={`grid ${cols} gap-3 h-full content-start`}>
      {seats.map((seat, i) => (
        <VideoTile
          key={seat?.session_id ?? `empty-${i}`}
          name={seat?.name}
          stream={seat ? streams.get(seat.session_id) : undefined}
          isLocal={seat?.session_id === localSessionId}
        />
      ))}
    </div>
  );
}

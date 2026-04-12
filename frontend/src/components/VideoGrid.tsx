import type { Seat } from "../types";
import VideoTile from "./VideoTile";

interface Props {
  seats: Array<Seat | null>;
  streams: Map<string, MediaStream>;
  localSessionId: string;
}

// Responsive grid columns: mobile caps at 2, desktop goes up to 4.
const GRID_COLS: Record<number, string> = {
  0: "grid-cols-1",
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-2",
  5: "grid-cols-2 lg:grid-cols-3",
  6: "grid-cols-2 lg:grid-cols-3",
  7: "grid-cols-2 lg:grid-cols-4",
  8: "grid-cols-2 lg:grid-cols-4",
};

export default function VideoGrid({ seats, streams, localSessionId }: Props) {
  const occupied = seats.filter(Boolean).length;
  const cols = GRID_COLS[Math.min(occupied, 8)] ?? "grid-cols-2";

  return (
    <div className={`grid ${cols} gap-2 sm:gap-3 w-full`}>
      {seats.filter(Boolean).map((seat) => (
        <VideoTile
          key={seat!.session_id}
          name={seat!.name}
          stream={streams.get(seat!.session_id)}
          isLocal={seat!.session_id === localSessionId}
          hasVideo={streams.get(seat!.session_id)?.active}
        />
      ))}
    </div>
  );
}

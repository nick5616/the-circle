/**
 * Responsive grid of up to 8 VideoTile components.
 * Empty seats render as placeholder tiles.
 */

import type { Seat } from "../types";

interface Props {
  seats: Array<Seat | null>;
  streams: Map<string, MediaStream>; // session_id → stream
  localSessionId: string;
}

export default function VideoGrid(_props: Props) {
  // TODO
  return <div>VideoGrid</div>;
}

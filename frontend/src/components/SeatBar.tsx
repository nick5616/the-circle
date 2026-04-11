/**
 * Seat status bar — shows how many seats are occupied (e.g. "5 / 8 participants").
 * Rendered in the chat sidebar header area.
 */

interface Props {
  seatsOccupied: number;
  maxSeats: number;
  audienceCount: number;
}

export default function SeatBar(_props: Props) {
  // TODO
  return <div>SeatBar</div>;
}

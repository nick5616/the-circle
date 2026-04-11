interface Props {
  seatsOccupied: number;
  maxSeats: number;
  audienceCount: number;
}

export default function SeatBar({ seatsOccupied, maxSeats, audienceCount }: Props) {
  return (
    <div className="flex items-center justify-between text-xs text-gray-400 px-4 py-2 border-b border-gray-800">
      <span>
        <span className="text-white font-semibold">{seatsOccupied}</span>
        {" / "}
        {maxSeats} on cam
      </span>
      <span>
        <span className="text-white font-semibold">{audienceCount}</span> watching
      </span>
    </div>
  );
}

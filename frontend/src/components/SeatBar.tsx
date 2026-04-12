import { hashNameToColor } from "../fireColors";
import type { Seat } from "../types";

interface Props {
  seats: Array<Seat | null>;
  audienceCount: number;
}

export default function SeatBar({ seats, audienceCount }: Props) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "10px",
        backgroundColor: "rgba(14, 10, 6, 0.72)",
        backdropFilter: "blur(10px)",
        borderRadius: "100px",
        padding: "7px 14px",
      }}
    >
      <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
        {seats.map((seat, i) => {
          const color = seat ? hashNameToColor(seat.name) : null;
          return (
            <div
              key={i}
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: color ? color.hex : "#221c14",
                boxShadow: color
                  ? `0 0 4px 1px ${color.hex}50`
                  : "none",
                transition:
                  "background-color 0.5s ease, box-shadow 0.5s ease",
              }}
            />
          );
        })}
      </div>
      {audienceCount > 0 && (
        <span
          style={{
            color: "rgba(210, 170, 110, 0.38)",
            fontSize: "10px",
            letterSpacing: "0.05em",
          }}
        >
          {audienceCount} watching
        </span>
      )}
    </div>
  );
}

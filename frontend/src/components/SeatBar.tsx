import { hashNameToColor } from "../fireColors";
import type { Seat, WsStatus } from "../types";

interface Props {
  seats: Array<Seat | null>;
  audienceCount: number;
  ws: WsStatus;
}

// Top-center presence pill: eight little flames for eight seats, plus who's
// listening. Doubles as the "we lost the server for a moment" indicator.
export default function SeatBar({ seats, audienceCount, ws }: Props) {
  const reconnecting = ws !== "open";
  // Centered by a flex wrapper, not translateX: the entrance animation owns transform
  return (
    <div style={{ position: "fixed", top: "calc(12px + env(safe-area-inset-top))", left: 0, right: 0, zIndex: 20, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
    <div
      className="glass"
      data-testid="seat-bar"
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "7px 14px 7px 12px", borderRadius: 999,
        animation: "rise-in 0.8s var(--spring) both", whiteSpace: "nowrap", pointerEvents: "auto",
      }}
    >
      <div style={{ display: "flex", gap: 5, alignItems: "flex-end" }}>
        {seats.map((seat, i) => {
          const c = seat ? hashNameToColor(seat.name).hex : null;
          return (
            <i
              key={i}
              title={seat ? seat.name : "open seat"}
              style={{
                width: 8, height: 10, borderRadius: "50% 50% 50% 50% / 62% 62% 38% 38%",
                background: c ?? "rgba(255,214,170,0.12)",
                boxShadow: c ? `0 0 8px ${c}` : "none",
                opacity: seat?.away ? 0.35 : 1,
                transition: "background 0.6s ease, box-shadow 0.6s ease, opacity 0.6s ease",
                animation: seat?.away ? "flicker 1.6s ease-in-out infinite" : undefined,
              }}
            />
          );
        })}
      </div>
      <span className="hand" style={{ fontSize: 18, color: reconnecting ? "var(--rose)" : "var(--ink-2)", lineHeight: 1 }}>
        {reconnecting ? (
          <span style={{ animation: "flicker 1.4s ease-in-out infinite" }}>reconnecting</span>
        ) : audienceCount > 0 ? (
          `${audienceCount} watching`
        ) : (
          "the circle"
        )}
      </span>
    </div>
    </div>
  );
}

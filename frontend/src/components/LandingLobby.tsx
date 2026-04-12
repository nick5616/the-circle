import { useState, useEffect, useRef } from "react";
import type { Role, Seat } from "../types";
import { hashNameToColor, type FireColor } from "../fireColors";

interface Props {
  seats: Array<Seat | null>;
  audienceCount: number;
  onJoin: (name: string, role: Role) => void;
}

const MAX_SEATS = 8;
const RADIUS = 108;

export default function LandingLobby({ seats, audienceCount, onJoin }: Props) {
  const [name, setName] = useState("");
  const [fireColor, setFireColor] = useState<FireColor | null>(null);
  const [bloomKey, setBloomKey] = useState(0);
  const [joining, setJoining] = useState(false);
  const [pageVisible, setPageVisible] = useState(false);
  const [buttonsVisible, setButtonsVisible] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const seatsOccupied = seats.filter(Boolean).length;
  const seatsFull = seatsOccupied >= MAX_SEATS;
  const trimmed = name.trim();

  useEffect(() => {
    const t = setTimeout(() => setPageVisible(true), 120);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    setButtonsVisible(!!trimmed);
  }, [trimmed]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (name.trim()) {
        setFireColor(hashNameToColor(name.trim()));
        setBloomKey((k) => k + 1);
      } else {
        setFireColor(null);
      }
    }, 400);
    return () => clearTimeout(debounceRef.current);
  }, [name]);

  async function join(role: Role) {
    if (!trimmed || joining) return;
    setJoining(true);
    await onJoin(trimmed, role);
  }

  function seatPos(index: number) {
    const deg = (index * 360) / MAX_SEATS - 90;
    const rad = (deg * Math.PI) / 180;
    return { x: Math.cos(rad) * RADIUS, y: Math.sin(rad) * RADIUS };
  }

  const circleDiameter = RADIUS * 2 + 28;

  return (
    <div
      className="min-h-dvh flex items-center justify-center overflow-hidden"
      style={{ backgroundColor: "#1a1510" }}
    >
      {/* Ambient fire glow — breathing, always */}
      <div
        className="pointer-events-none absolute inset-0 animate-fire-breathe"
        style={{
          background:
            "radial-gradient(ellipse 65% 55% at 50% 50%, rgba(190, 90, 15, 0.13) 0%, transparent 70%)",
        }}
      />

      {/* Color bloom on debounced name */}
      {fireColor && (
        <div
          key={bloomKey}
          className="pointer-events-none absolute animate-bloom-pulse"
          style={{
            width: "580px",
            height: "580px",
            top: "50%",
            left: "50%",
            marginTop: "-290px",
            marginLeft: "-290px",
            borderRadius: "50%",
            background: `radial-gradient(circle, ${fireColor.hex}3a 0%, transparent 65%)`,
          }}
        />
      )}

      {/* Main content */}
      <div
        className="relative z-10 flex flex-col items-center px-4"
        style={{
          gap: "0",
          opacity: pageVisible ? 1 : 0,
          transform: pageVisible ? "translateY(0)" : "translateY(20px)",
          transition:
            "opacity 0.95s ease-out, transform 0.95s cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        {/* ── Top group: circle + presence label ── */}
        <div className="flex flex-col items-center" style={{ gap: "14px" }}>

        {/* Seat circle */}
        <div
          className="relative"
          style={{ width: circleDiameter, height: circleDiameter }}
        >
          {/* Center ember */}
          <div
            className="pointer-events-none absolute animate-fire-breathe"
            style={{
              width: "48px",
              height: "48px",
              top: "50%",
              left: "50%",
              marginTop: "-24px",
              marginLeft: "-24px",
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(200, 100, 20, 0.25) 0%, transparent 75%)",
            }}
          />
          {seats.map((seat, i) => {
            const { x, y } = seatPos(i);
            const color = seat ? hashNameToColor(seat.name) : null;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  width: "11px",
                  height: "11px",
                  borderRadius: "50%",
                  top: "50%",
                  left: "50%",
                  marginTop: "-5.5px",
                  marginLeft: "-5.5px",
                  transform: `translate(${x}px, ${y}px)`,
                  backgroundColor: color ? color.hex : "#2c2419",
                  boxShadow: color
                    ? `0 0 6px 2px ${color.hex}50, 0 0 16px 4px ${color.hex}22`
                    : "none",
                  transition: "background-color 0.6s ease, box-shadow 0.6s ease",
                }}
              />
            );
          })}
        </div>

        {/* Presence label */}
        <p
          style={{
            color: "rgba(215, 168, 105, 0.35)",
            fontSize: "11px",
            letterSpacing: "0.08em",
          }}
        >
          {seatsOccupied === 0 && audienceCount === 0
            ? "no one here yet"
            : [
                seatsOccupied > 0 && `${seatsOccupied} in the circle`,
                audienceCount > 0 && `${audienceCount} watching`,
              ]
                .filter(Boolean)
                .join("  ·  ")}
        </p>

        </div>{/* end top group */}

        {/* ── Spacer between the two groups ── */}
        <div style={{ height: "52px" }} />

        {/* ── Bottom group: name + buttons ── */}
        <div className="flex flex-col items-center" style={{ gap: "28px" }}>

        {/* Name input — no box, just an underline */}
        <div className="relative" style={{ width: "260px" }}>
          <input
            type="text"
            placeholder="what do they call you?"
            maxLength={50}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") join(seatsFull ? "audience" : "participant");
            }}
            autoComplete="off"
            autoFocus
            className="fire-input w-full"
            style={{
              background: "transparent",
              border: "none",
              borderBottom: `1.5px solid ${
                fireColor
                  ? fireColor.hex + "50"
                  : "rgba(255, 255, 255, 0.09)"
              }`,
              padding: "8px 28px 9px 0",
              color: "rgba(238, 210, 178, 0.92)",
              fontSize: "17px",
              caretColor: fireColor ? fireColor.hex : "rgba(220,175,115,0.7)",
              transition: "border-color 0.6s ease",
            }}
          />
          {/* Element dot */}
          {fireColor && (
            <div
              className="pointer-events-none absolute animate-glow-pulse"
              style={{
                right: "2px",
                top: "50%",
                transform: "translateY(-60%)",
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                backgroundColor: fireColor.hex,
                boxShadow: `0 0 5px 2px ${fireColor.hex}65`,
              }}
            />
          )}
        </div>

        {/* Action zone — fades up when name exists */}
        <div
          className="flex flex-col items-center"
          style={{
            gap: "22px",
            opacity: buttonsVisible ? 1 : 0,
            transform: buttonsVisible ? "translateY(0)" : "translateY(12px)",
            transition:
              "opacity 0.5s ease, transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
            pointerEvents: buttonsVisible ? "auto" : "none",
          }}
        >
          {/* take a seat — amorphous blob */}
          <button
            onClick={() => join("participant")}
            disabled={!trimmed || seatsFull || joining}
            style={{
              background: fireColor && !seatsFull
                ? `radial-gradient(ellipse at 45% 52%, ${fireColor.hex}28 0%, ${fireColor.hex}0d 60%, transparent 100%)`
                : "rgba(255,255,255,0.03)",
              border: "none",
              // Each corner radius is deliberately different — hand-imagined, not geometric
              borderRadius: "58% 42% 61% 39% / 47% 53% 47% 53%",
              padding: "16px 40px 17px 38px",
              color: fireColor && !seatsFull
                ? fireColor.hex
                : "rgba(235, 205, 165, 0.28)",
              fontSize: "14px",
              fontWeight: 600,
              letterSpacing: "0.03em",
              cursor: !trimmed || seatsFull || joining ? "not-allowed" : "pointer",
              opacity: seatsFull ? 0.35 : 1,
              boxShadow: fireColor && !seatsFull && trimmed
                ? `0 0 32px 8px ${fireColor.hex}14, 0 0 12px 2px ${fireColor.hex}20`
                : "none",
              transition:
                "background 0.6s ease, color 0.6s ease, box-shadow 0.6s ease, opacity 0.3s ease",
            }}
          >
            {seatsFull ? "circle is full" : "take a seat"}
          </button>

          {/* or — cursive divider */}
          <span
            style={{
              fontFamily: "Georgia, 'Times New Roman', serif",
              fontStyle: "italic",
              color: "rgba(210, 170, 120, 0.22)",
              fontSize: "14px",
              letterSpacing: "0.04em",
              userSelect: "none",
            }}
          >
            or
          </span>

          {/* join the audience — pure text, no container */}
          <button
            onClick={() => join("audience")}
            disabled={!trimmed || joining}
            style={{
              background: "none",
              border: "none",
              padding: "4px 0",
              color: "rgba(210, 180, 140, 0.32)",
              fontSize: "13px",
              letterSpacing: "0.05em",
              cursor: !trimmed || joining ? "not-allowed" : "pointer",
              transition: "color 0.3s ease",
            }}
          >
            join the audience
          </button>
        </div>

        {/* Connecting state */}
        {joining && (
          <p
            className="animate-glow-pulse"
            style={{
              color: fireColor
                ? fireColor.hex + "99"
                : "rgba(215, 168, 105, 0.5)",
              fontSize: "12px",
              letterSpacing: "0.06em",
              marginTop: "-16px",
            }}
          >
            finding your place…
          </p>
        )}

        </div>{/* end bottom group */}

      </div>{/* end main content */}
    </div>
  );
}

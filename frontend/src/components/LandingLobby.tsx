import { useState, useEffect, useRef } from "react";
import type { Role, Seat } from "../types";
import { hashNameToColor, type FireColor } from "../fireColors";

interface Props {
  seats: Array<Seat | null>;
  audienceCount: number;
  onJoin: (name: string, role: Role) => void;
}

const MAX_SEATS = 8;
// Radius of the seat circle in px — scales with the container
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

  // Ambient entrance: page breathes in after a beat
  useEffect(() => {
    const t = setTimeout(() => setPageVisible(true), 120);
    return () => clearTimeout(t);
  }, []);

  // Buttons appear once a name exists
  useEffect(() => {
    setButtonsVisible(!!trimmed);
  }, [trimmed]);

  // Debounce name → fire color + bloom
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
    // component unmounts after join — joining stays true
  }

  // Compute x/y for each seat dot, starting from the top (−90°)
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
      {/* ── Ambient fire glow (always on, breathing) ─────────────── */}
      <div
        className="pointer-events-none absolute inset-0 animate-fire-breathe"
        style={{
          background:
            "radial-gradient(ellipse 65% 55% at 50% 50%, rgba(190, 90, 15, 0.13) 0%, transparent 70%)",
        }}
      />

      {/* ── Color bloom: triggers on debounced name ───────────────── */}
      {fireColor && (
        <div
          key={bloomKey}
          className="pointer-events-none absolute animate-bloom-pulse"
          style={{
            width: "560px",
            height: "560px",
            top: "50%",
            left: "50%",
            marginTop: "-280px",
            marginLeft: "-280px",
            borderRadius: "50%",
            background: `radial-gradient(circle, ${fireColor.hex}44 0%, transparent 68%)`,
          }}
        />
      )}

      {/* ── Main content ──────────────────────────────────────────── */}
      <div
        className="relative z-10 flex flex-col items-center gap-7 px-4"
        style={{
          opacity: pageVisible ? 1 : 0,
          transform: pageVisible ? "translateY(0)" : "translateY(18px)",
          transition:
            "opacity 0.9s ease-out, transform 0.9s cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        {/* ── Seat circle ─────────────────────────────────────────── */}
        <div
          className="relative"
          style={{ width: circleDiameter, height: circleDiameter }}
        >
          {/* Faint center ember */}
          <div
            className="pointer-events-none absolute animate-fire-breathe"
            style={{
              width: "44px",
              height: "44px",
              top: "50%",
              left: "50%",
              marginTop: "-22px",
              marginLeft: "-22px",
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(200, 100, 20, 0.28) 0%, transparent 75%)",
            }}
          />

          {/* 8 seat dots */}
          {seats.map((seat, i) => {
            const { x, y } = seatPos(i);
            const color = seat ? hashNameToColor(seat.name) : null;
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  width: "12px",
                  height: "12px",
                  borderRadius: "50%",
                  top: "50%",
                  left: "50%",
                  marginTop: "-6px",
                  marginLeft: "-6px",
                  transform: `translate(${x}px, ${y}px)`,
                  backgroundColor: color ? color.hex : "#2e2820",
                  boxShadow: color
                    ? `0 0 7px 2px ${color.hex}55, 0 0 18px 4px ${color.hex}25`
                    : "none",
                  transition:
                    "background-color 0.6s ease, box-shadow 0.6s ease",
                }}
              />
            );
          })}
        </div>

        {/* ── Room presence label ─────────────────────────────────── */}
        <p
          className="text-xs tracking-wide"
          style={{ color: "rgba(220, 175, 115, 0.38)" }}
        >
          {seatsOccupied === 0 && audienceCount === 0
            ? "no one here yet"
            : [
                seatsOccupied > 0 &&
                  `${seatsOccupied} in the circle`,
                audienceCount > 0 && `${audienceCount} watching`,
              ]
                .filter(Boolean)
                .join(" · ")}
        </p>

        {/* ── Name input ──────────────────────────────────────────── */}
        <div className="relative w-72">
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
              backgroundColor: "rgba(255, 255, 255, 0.035)",
              border: `1px solid ${
                fireColor
                  ? fireColor.hex + "66"
                  : "rgba(255, 255, 255, 0.07)"
              }`,
              borderRadius: "10px",
              padding: "13px 42px 13px 16px",
              color: "rgba(240, 215, 185, 0.9)",
              fontSize: "16px",
              boxShadow: fireColor
                ? `0 0 18px 3px ${fireColor.hex}1a, inset 0 0 10px 1px ${fireColor.hex}0d`
                : "none",
              transition: "border-color 0.55s ease, box-shadow 0.55s ease",
            }}
          />

          {/* Fire element dot (right side of input) */}
          {fireColor && (
            <div
              className="pointer-events-none absolute animate-glow-pulse"
              style={{
                right: "14px",
                top: "50%",
                transform: "translateY(-50%)",
                width: "7px",
                height: "7px",
                borderRadius: "50%",
                backgroundColor: fireColor.hex,
                boxShadow: `0 0 5px 2px ${fireColor.hex}70`,
              }}
            />
          )}
        </div>

        {/* ── Action buttons ──────────────────────────────────────── */}
        <div
          className="flex flex-col gap-3 w-72"
          style={{
            opacity: buttonsVisible ? 1 : 0,
            transform: buttonsVisible ? "translateY(0)" : "translateY(10px)",
            transition:
              "opacity 0.45s ease, transform 0.45s cubic-bezier(0.34, 1.56, 0.64, 1)",
            pointerEvents: buttonsVisible ? "auto" : "none",
          }}
        >
          {/* take a seat */}
          <button
            onClick={() => join("participant")}
            disabled={!trimmed || seatsFull || joining}
            style={{
              backgroundColor: fireColor
                ? fireColor.hex + "1e"
                : "rgba(255,255,255,0.05)",
              border: `1px solid ${
                fireColor && !seatsFull
                  ? fireColor.hex + "55"
                  : "rgba(255,255,255,0.08)"
              }`,
              borderRadius: "10px",
              padding: "13px 20px",
              color:
                fireColor && !seatsFull
                  ? fireColor.hex
                  : "rgba(240, 215, 185, 0.38)",
              fontSize: "14px",
              fontWeight: 600,
              letterSpacing: "0.025em",
              cursor: !trimmed || seatsFull || joining ? "not-allowed" : "pointer",
              opacity: !trimmed || seatsFull || joining ? 0.42 : 1,
              boxShadow:
                fireColor && !seatsFull && trimmed
                  ? `0 0 22px 4px ${fireColor.hex}18`
                  : "none",
              transition:
                "background-color 0.5s ease, border-color 0.5s ease, color 0.5s ease, box-shadow 0.5s ease, opacity 0.3s ease",
            }}
          >
            {seatsFull ? "circle is full" : "take a seat"}
          </button>

          {/* join the audience */}
          <button
            onClick={() => join("audience")}
            disabled={!trimmed || joining}
            style={{
              backgroundColor: "transparent",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: "10px",
              padding: "13px 20px",
              color: "rgba(215, 190, 155, 0.45)",
              fontSize: "14px",
              fontWeight: 500,
              letterSpacing: "0.025em",
              cursor: !trimmed || joining ? "not-allowed" : "pointer",
              opacity: !trimmed || joining ? 0.42 : 1,
              transition: "opacity 0.3s ease",
            }}
          >
            join the audience
          </button>
        </div>

        {/* ── Connecting state ────────────────────────────────────── */}
        {joining && (
          <p
            className="text-xs animate-glow-pulse"
            style={{
              color: fireColor
                ? fireColor.hex + "aa"
                : "rgba(220, 175, 115, 0.55)",
              letterSpacing: "0.04em",
            }}
          >
            finding your place…
          </p>
        )}
      </div>
    </div>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { Role, Seat } from "../types";
import { hashNameToColor, type FireColor } from "../fireColors";
import { flare, scene } from "../scene";

interface Props {
  seats: Array<Seat | null>;
  audienceCount: number;
  connected: boolean;
  joining: boolean;
  onJoin: (name: string, role: Role) => void;
}

const MAX_SEATS = 8;

export default function Landing({ seats, audienceCount, connected, joining, onJoin }: Props) {
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem("circle:name") ?? "";
    } catch {
      return "";
    }
  });
  const [color, setColor] = useState<FireColor | null>(null);
  const ring = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const R = Math.max(96, Math.min(160, Math.min(vp.w, vp.h) * 0.2));

  const trimmed = name.trim();
  const taken = seats.filter(Boolean).length;
  const full = taken >= MAX_SEATS;
  const mySpot = full ? -1 : seats.findIndex((s) => !s);

  // Settle on an element a beat after typing stops, then let it bloom into the fire
  useEffect(() => {
    const t = setTimeout(() => {
      const next = trimmed ? hashNameToColor(trimmed) : null;
      setColor((prev) => {
        if (next && next.hex !== prev?.hex) flare(0.7);
        return next;
      });
    }, 350);
    return () => clearTimeout(t);
  }, [trimmed]);

  // Ring size follows the viewport; the fire is placed after the ring re-lays out
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    document.fonts?.ready.then(onResize); // web fonts shift the layout once they land
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useLayoutEffect(() => {
    const b = ring.current?.getBoundingClientRect();
    if (!b) return;
    scene.fire = { x: b.left + b.width / 2, y: b.top + b.height / 2 + R * 0.5, size: R * 1.15 };
    scene.fireAlpha = 1;
  }, [R, vp]);

  // Everyone already seated burns in the fire; so does your color, once chosen
  useEffect(() => {
    const people = seats.filter((s): s is Seat => !!s).map((s) => ({ sid: s.session_id, color: hashNameToColor(s.name).hex }));
    if (color && !full) people.push({ sid: "__me__", color: color.hex });
    scene.people = people;
  }, [seats, color, full]);

  useEffect(() => () => void (scene.people = []), []);

  function join(role: Role) {
    if (!trimmed || joining || !connected) return;
    try {
      localStorage.setItem("circle:name", trimmed);
    } catch {}
    flare(1.2);
    onJoin(trimmed, role);
  }

  const c = color?.hex ?? "#ffb36b";
  const canSit = !!trimmed && !full && connected && !joining;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 2, overflowY: "auto", overflowX: "hidden",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: "calc(20px + env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom))",
        animation: "curtain 1.2s var(--ease) both",
      }}
    >
      {/* Wordmark — the dot on the i is a little flame */}
      <div style={{ position: "relative", textAlign: "center" }}>
        <Sparkle style={{ left: -26, top: 8 }} delay={0} />
        <Sparkle style={{ right: -18, top: -4 }} delay={0.9} size={10} />
        <Sparkle style={{ right: -34, bottom: 6 }} delay={1.7} size={7} />
        <h1
          className="display"
          style={{
            margin: 0, fontSize: "clamp(48px, 10vw, 84px)", fontWeight: 300, fontStyle: "italic", lineHeight: 1,
            letterSpacing: "-0.02em", color: "var(--ink)", textShadow: "0 0 40px rgba(255,140,70,0.35)",
          }}
        >
          the c
          <span style={{ position: "relative", display: "inline-block" }}>
            ı
            <FlameDot />
          </span>
          rcle
        </h1>
        <p className="hand" style={{ margin: "6px 0 0", fontSize: "clamp(20px, 4.4vw, 25px)", color: "var(--ink-2)", transform: "rotate(-1.5deg)" }}>
          one room, open to anyone. 8 seats on camera.
        </p>
      </div>

      {/* The ring of eight seats around the fire */}
      <div ref={ring} style={{ position: "relative", width: R * 2 + 40, height: R * 2 + 40, margin: "6px 0 0", flexShrink: 0 }}>
        {seats.map((seat, i) => {
          const a = (i / MAX_SEATS) * Math.PI * 2 - Math.PI / 2;
          const x = Math.cos(a) * R;
          const y = Math.sin(a) * R * 0.86;
          const sc = seat ? hashNameToColor(seat.name).hex : i === mySpot && color ? color.hex : null;
          const isMine = !seat && i === mySpot && !!color;
          return (
            <div
              key={i}
              title={seat ? seat.name : isMine ? "your seat" : "open seat"}
              style={{
                position: "absolute", left: "50%", top: "50%", width: 0, height: 0,
                transform: `translate(${x}px, ${y}px)`, transition: "transform 0.8s var(--spring)",
              }}
            >
              <i
                style={{
                  position: "absolute", left: -7, top: -9, width: 14, height: 18,
                  borderRadius: "50% 50% 50% 50% / 62% 62% 38% 38%",
                  background: sc ?? "rgba(255,214,170,0.1)",
                  boxShadow: sc ? `0 0 14px 2px ${sc}aa, 0 0 34px 6px ${sc}44` : "inset 0 0 0 1px rgba(255,214,170,0.12)",
                  opacity: isMine ? 0.75 : 1,
                  animation: isMine ? "flicker 1.8s ease-in-out infinite" : seat ? "breathe 3.4s ease-in-out infinite" : undefined,
                  transition: "background 0.6s ease, box-shadow 0.6s ease",
                }}
              />
              {seat && (
                <span
                  className="hand"
                  style={{
                    position: "absolute", top: 12, left: 0, transform: "translateX(-50%)", fontSize: 17, whiteSpace: "nowrap",
                    color: "var(--ink-2)", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis",
                  }}
                >
                  {seat.name}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <p className="display" style={{ margin: "0 0 18px", fontSize: 15, fontStyle: "italic", color: "var(--ink-3)", textAlign: "center", minHeight: 20 }}>
        {!connected
          ? "connecting"
          : taken === 0 && audienceCount === 0
          ? "nobody's here yet"
          : [taken > 0 && `${taken} on camera`, audienceCount > 0 && `${audienceCount} watching`].filter(Boolean).join(", ")}
      </p>

      {/* Name */}
      <div style={{ position: "relative", width: "min(300px, 84vw)" }}>
        <input
          data-testid="name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && join(full ? "audience" : "participant")}
          maxLength={32}
          placeholder="what do they call you?"
          autoComplete="off"
          autoFocus
          spellCheck={false}
          className="display"
          style={{
            width: "100%", padding: "6px 4px 10px", border: "none", background: "transparent", textAlign: "center",
            fontSize: 26, fontStyle: "italic", fontWeight: 400, color: "var(--ink)", caretColor: c,
          }}
        />
        <svg viewBox="0 0 300 14" preserveAspectRatio="none" style={{ position: "absolute", left: 0, right: 0, bottom: 0, width: "100%", height: 14, overflow: "visible" }}>
          <path
            d="M3 8 C 38 2, 66 13, 104 7 S 172 2, 214 8 S 274 12, 297 6"
            fill="none"
            stroke={color ? c : "rgba(255,214,170,0.22)"}
            strokeWidth={color ? 2.4 : 1.6}
            strokeLinecap="round"
            style={{ filter: color ? `drop-shadow(0 0 6px ${c})` : "none", transition: "stroke 0.6s ease, stroke-width 0.4s ease" }}
          />
        </svg>
      </div>

      <p
        className="hand"
        style={{
          margin: "10px 0 0", minHeight: 28, fontSize: 22, color: c, textAlign: "center",
          opacity: color ? 1 : 0, transform: color ? "translateY(0) rotate(-1deg)" : "translateY(6px)",
          transition: "opacity 0.5s var(--ease), transform 0.6s var(--spring), color 0.5s ease",
          textShadow: `0 0 18px ${c}66`,
        }}
      >
        {color ? `your color: ${color.element.toLowerCase()} (${color.flameColor})` : " "}
      </p>

      {/* Actions */}
      <div
        style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 12, marginTop: 14,
          opacity: trimmed ? 1 : 0.0, transform: trimmed ? "translateY(0)" : "translateY(10px)",
          transition: "opacity 0.5s var(--ease), transform 0.6s var(--spring)", pointerEvents: trimmed ? "auto" : "none",
        }}
      >
        <button
          data-testid="join-participant"
          className="pill-btn"
          disabled={!canSit}
          onClick={() => join("participant")}
          style={{
            height: 56, padding: "0 30px", borderRadius: 22, fontSize: 17, transform: "rotate(-1deg)",
            color: full ? "var(--ink-3)" : "#2a120a",
            background: full ? "rgba(255,220,180,0.06)" : `linear-gradient(120deg, var(--gold), ${c} 55%, var(--rose))`,
            boxShadow: full ? "none" : `0 0 40px -6px ${c}cc, inset 0 1px 0 rgba(255,255,255,0.35)`,
          }}
        >
          {joining ? <span style={{ animation: "flicker 1.2s infinite" }}>joining</span> : full ? "all 8 seats are taken" : "take a seat"}
        </button>
        <button
          data-testid="join-audience"
          className="hand"
          disabled={!trimmed || joining || !connected}
          onClick={() => join("audience")}
          style={{ border: "none", background: "transparent", color: "var(--ink-2)", fontSize: 22, cursor: "pointer", padding: "4px 10px" }}
        >
          {full ? "watch instead" : "or just watch"}
        </button>
      </div>

      <p className="hand" style={{ margin: "22px 0 0", textAlign: "center", fontSize: 17, color: "var(--ink-4)", pointerEvents: "none" }}>
        made by nicole
      </p>
    </div>
  );
}

function FlameDot() {
  return (
    <svg
      viewBox="0 0 20 28"
      style={{ position: "absolute", left: "50%", top: "0.15em", width: "0.2em", height: "0.28em", transform: "translateX(-42%)", overflow: "visible", animation: "flicker 2.2s ease-in-out infinite" }}
    >
      <defs>
        <linearGradient id="fd" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#ff4f86" />
          <stop offset="0.55" stopColor="#ff9a3d" />
          <stop offset="1" stopColor="#ffe3a3" />
        </linearGradient>
      </defs>
      <path d="M10 1c2 6 9 9 9 17a9 9 0 0 1-18 0c0-4.5 2.4-6.8 4.6-9 0 3.4 1.6 5 3.4 5.6C7.8 9.5 10 6 10 1z" fill="url(#fd)" style={{ filter: "drop-shadow(0 0 6px #ff8a4a)" }} />
    </svg>
  );
}

function Sparkle({ style, delay, size = 13 }: { style: CSSProperties; delay: number; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ position: "absolute", animation: `twinkle 2.6s ${delay}s ease-in-out infinite`, ...style }}>
      <path d="M12 1c.8 5.6 3.4 8.2 9 9-5.6.8-8.2 3.4-9 9-.8-5.6-3.4-8.2-9-9 5.6-.8 8.2-3.4 9-9z" fill="#ffd9a8" />
    </svg>
  );
}

import { useEffect, useRef, useState } from "react";
import { hashNameToColor } from "../fireColors";
import { MAIN, inviteLink } from "../rooms";
import type { Seat, WsStatus } from "../types";

interface Props {
  seats: Array<Seat | null>;
  audienceCount: number;
  ws: WsStatus;
  room: string;
}

/** Share sheet on phones, clipboard elsewhere. Resolves to what happened. */
export async function shareInvite(room: string): Promise<"shared" | "copied" | "failed"> {
  const url = inviteLink(room);
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  if (coarse && navigator.share) {
    try {
      await navigator.share({ title: "come sit by the fire", text: `pull up a seat: ${room}`, url });
      return "shared";
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return "failed";
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "failed";
  }
}

// Top-center presence pill: eight little flames for eight seats, which room
// you're in, and who's listening. In a private room it's also the invite
// button. Doubles as the "we lost the server for a moment" indicator.
export default function SeatBar({ seats, audienceCount, ws, room }: Props) {
  const reconnecting = ws !== "open";
  const priv = room !== MAIN;
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const invite = async () => {
    const r = await shareInvite(room);
    setCopied(r === "copied" ? "link copied ✓" : r === "shared" ? "sent ✓" : "copy failed, it's in the address bar");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 2200);
  };

  // Centered by a flex wrapper, not translateX: the entrance animation owns transform
  return (
    <div style={{ position: "fixed", top: "calc(12px + env(safe-area-inset-top))", left: 0, right: 0, zIndex: 20, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
    <div
      className="glass"
      data-testid="seat-bar"
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "7px 14px 7px 12px", borderRadius: 999,
        animation: "rise-in 0.8s var(--spring) both", whiteSpace: "nowrap", pointerEvents: "auto", maxWidth: "calc(100vw - 24px)",
      }}
    >
      <div style={{ display: "flex", gap: 5, alignItems: "flex-end", flexShrink: 0 }}>
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
      <span className="hand" style={{ fontSize: 18, color: reconnecting ? "var(--rose)" : "var(--ink-2)", lineHeight: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
        {reconnecting ? (
          <span style={{ animation: "flicker 1.4s ease-in-out infinite" }}>reconnecting</span>
        ) : priv ? (
          <span data-testid="room-label">
            {room}
            {audienceCount > 0 && <span style={{ color: "var(--ink-3)" }}> · {audienceCount} watching</span>}
          </span>
        ) : audienceCount > 0 ? (
          `${audienceCount} watching`
        ) : (
          "the circle"
        )}
      </span>
      {priv && (
        <button
          className="chip"
          data-testid="invite"
          onClick={invite}
          title="copy the invite link"
          style={{ marginRight: -6, height: 26, fontSize: 16, padding: "0 10px 1px", flexShrink: 0 }}
        >
          {copied ?? "invite"}
        </button>
      )}
    </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import type { FeedItem, Role } from "../types";
import { hashNameToColor } from "../fireColors";

interface Props {
  items: FeedItem[];
  myName: string;
  role: Role;
  seatsAvailable: boolean;
  onSend: (content: string) => void;
  onTakeSeat: () => void;
  onLeaveRoom: () => void;
  // When true the panel has no background — messages float as glass bubbles
  // over whatever is behind it (video tiles on desktop).
  transparent?: boolean;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export default function Chat({
  items,
  myName,
  role,
  seatsAvailable,
  onSend,
  onTakeSeat,
  onLeaveRoom,
  transparent = false,
}: Props) {
  const [draft, setDraft] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const myColor = myName ? hashNameToColor(myName) : null;

  // Transparent-mode state
  const [isHovered, setIsHovered] = useState(false);
  const [highlighted, setHighlighted] = useState(false);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const prevItemsLenRef = useRef<number | null>(null);

  useEffect(() => {
    // In transparent mode only scroll when messages are visible
    if (transparent && !isHovered && !highlighted) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items, transparent, isHovered, highlighted]);

  // New-message highlight in transparent mode
  useEffect(() => {
    if (!transparent) return;
    // Seed on first render — don't flash existing history
    if (prevItemsLenRef.current === null) {
      prevItemsLenRef.current = items.length;
      return;
    }
    if (items.length > prevItemsLenRef.current) {
      prevItemsLenRef.current = items.length;
      setHighlighted(true);
      clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = setTimeout(() => setHighlighted(false), 3000);
    }
  }, [items, transparent]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => clearTimeout(highlightTimerRef.current);
  }, []);

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  }

  // ── Shared feed items renderer ─────────────────────────────────────────────
  const feedContent = items.map((item, i) => {
    if (item.kind === "event") {
      const nameColor = item.name ? hashNameToColor(item.name) : null;
      return (
        <div
          key={i}
          style={{
            textAlign: "center",
            padding: "2px 0",
            animation: "float-up 0.4s ease-out both",
          }}
        >
          <span
            style={{
              color: nameColor ? nameColor.hex + "bb" : "rgba(200,160,100,0.65)",
              fontSize: "11px",
              textShadow: transparent ? "0 1px 4px rgba(0,0,0,0.9)" : undefined,
            }}
          >
            {item.name}
          </span>
          <span
            style={{
              color: "rgba(185, 148, 95, 0.6)",
              fontSize: "11px",
              textShadow: transparent ? "0 1px 4px rgba(0,0,0,0.9)" : undefined,
            }}
          >
            {" "}{item.text}
          </span>
        </div>
      );
    }

    const senderColor = hashNameToColor(item.sender);
    return (
      <div
        key={i}
        className="group"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "3px",
          background: "rgba(8, 5, 3, 0.58)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          borderRadius: "10px",
          padding: "8px 12px",
          borderLeft: `2px solid ${senderColor.hex}40`,
          animation: "float-up 0.35s cubic-bezier(0.34,1.56,0.64,1) both",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: "7px" }}>
          <span
            style={{
              color: senderColor.hex,
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.02em",
              textShadow: "0 1px 3px rgba(0,0,0,0.8)",
            }}
          >
            {item.sender}
          </span>
          <span
            className="group-hover:opacity-100"
            style={{
              color: "rgba(180, 140, 85, 0.55)",
              fontSize: "10px",
              opacity: 0,
              transition: "opacity 0.2s ease",
            }}
          >
            {formatTime(item.timestamp)}
          </span>
        </div>
        <p
          style={{
            color: "rgba(232, 202, 165, 0.88)",
            fontSize: "13px",
            lineHeight: 1.45,
            margin: 0,
            wordBreak: "break-word",
            textShadow: "0 1px 3px rgba(0,0,0,0.7)",
          }}
        >
          {item.content}
        </p>
      </div>
    );
  });

  // ── Input section (shared) ──────────────────────────────────────────────────
  const inputSection = (
    <div
      style={{
        flexShrink: 0,
        padding: transparent ? "10px 14px 16px" : "12px 16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        ...(transparent
          ? {
              background: "rgba(8, 5, 3, 0.72)",
              backdropFilter: "blur(20px)",
              WebkitBackdropFilter: "blur(20px)",
              borderTop: "1px solid rgba(255,255,255,0.06)",
            }
          : {}),
      }}
    >
      {role === "audience" && (
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {seatsAvailable && (
            <button
              onClick={onTakeSeat}
              style={{
                background: "none",
                border: "none",
                color: "rgba(210, 175, 120, 0.5)",
                fontSize: "11px",
                letterSpacing: "0.04em",
                cursor: "pointer",
                padding: "0",
              }}
            >
              take a seat
            </button>
          )}
          <button
            onClick={onLeaveRoom}
            style={{
              background: "none",
              border: "none",
              color: "rgba(180, 130, 85, 0.35)",
              fontSize: "11px",
              letterSpacing: "0.04em",
              cursor: "pointer",
              padding: "0",
              marginLeft: "auto",
            }}
          >
            leave room
          </button>
        </div>
      )}
      <div style={{ position: "relative" }}>
        <input
          type="text"
          placeholder="say something…"
          maxLength={1000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          className="fire-input w-full"
          style={{
            background: "transparent",
            border: "none",
            borderBottom: `1px solid ${
              inputFocused && myColor
                ? myColor.hex + "55"
                : transparent
                ? "rgba(255,255,255,0.1)"
                : "rgba(255,255,255,0.07)"
            }`,
            padding: "7px 0 8px",
            color: "rgba(232, 200, 160, 0.88)",
            fontSize: "13px",
            caretColor: myColor ? myColor.hex : "rgba(220,175,115,0.7)",
            transition: "border-color 0.4s ease",
          }}
        />
        {inputFocused && myColor && (
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: "1px",
              background: `linear-gradient(90deg, transparent, ${myColor.hex}55, transparent)`,
              pointerEvents: "none",
            }}
          />
        )}
      </div>
    </div>
  );

  // ── Transparent always-on overlay (desktop) ────────────────────────────────
  // Messages are always visible but dim at rest. Hovering or a new message
  // boosts opacity to full. No layout shifts — everything is in-flow and
  // opacity-only transitions never affect the compositor tree of siblings.

  if (transparent) {
    const feedOpaque = isHovered || highlighted;

    return (
      <div
        style={{ height: "100%", position: "relative", display: "flex", flexDirection: "column" }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Scrollable feed — always on screen, opacity controlled by hover/highlight */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "52px 12px 8px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            scrollbarWidth: "thin",
            scrollbarColor: "rgba(80,55,30,0.3) transparent",
            opacity: feedOpaque ? 1 : 0.28,
            transition: "opacity 0.5s ease",
          }}
        >
          {items.length === 0 && (
            <p
              style={{
                color: "rgba(190, 155, 100, 0.14)",
                fontSize: "11px",
                textAlign: "center",
                letterSpacing: "0.04em",
                marginTop: "auto",
                paddingBottom: "24px",
                textShadow: "0 1px 4px rgba(0,0,0,0.8)",
              }}
            >
              the circle is quiet
            </p>
          )}
          {feedContent}
          <div ref={bottomRef} />
        </div>

        {/* Input tray — always full opacity, never dimmed */}
        <div style={{ flexShrink: 0 }}>
          {inputSection}
        </div>
      </div>
    );
  }

  // ── Opaque sidebar (legacy / keep for fallback) ─────────────────────────────
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "rgba(14, 10, 6, 0.88)",
        backdropFilter: "blur(20px)",
        boxShadow: "-14px 0 48px 0 rgba(6, 4, 2, 0.65)",
      }}
    >
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "48px 16px 12px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
          minHeight: 0,
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(80,55,30,0.3) transparent",
        }}
      >
        {items.length === 0 && (
          <p
            style={{
              color: "rgba(190, 155, 100, 0.2)",
              fontSize: "12px",
              textAlign: "center",
              letterSpacing: "0.04em",
              marginTop: "auto",
              paddingBottom: "24px",
            }}
          >
            the circle is quiet
          </p>
        )}
        {feedContent}
        <div ref={bottomRef} />
      </div>
      {inputSection}
    </div>
  );
}

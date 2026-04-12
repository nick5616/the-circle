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
}: Props) {
  const [draft, setDraft] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const myColor = myName ? hashNameToColor(myName) : null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items]);

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  }

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
      {/* Feed */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "48px 16px 12px",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
          minHeight: 0,
          // Thin scrollbar, dark
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

        {items.map((item, i) => {
          if (item.kind === "event") {
            const nameColor = item.name
              ? hashNameToColor(item.name)
              : null;
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
                    color: nameColor ? nameColor.hex + "88" : "rgba(200,160,100,0.45)",
                    fontSize: "11px",
                  }}
                >
                  {item.name}
                </span>
                <span
                  style={{
                    color: "rgba(185, 148, 95, 0.3)",
                    fontSize: "11px",
                  }}
                >
                  {" "}
                  {item.text}
                </span>
              </div>
            );
          }

          // chat message
          const senderColor = hashNameToColor(item.sender);
          return (
            <div
              key={i}
              className="group"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "3px",
                borderLeft: `2px solid ${senderColor.hex}28`,
                paddingLeft: "10px",
                marginLeft: "2px",
                animation: "float-up 0.35s cubic-bezier(0.34,1.56,0.64,1) both",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: "7px",
                }}
              >
                <span
                  style={{
                    color: senderColor.hex,
                    fontSize: "11px",
                    fontWeight: 600,
                    letterSpacing: "0.02em",
                  }}
                >
                  {item.sender}
                </span>
                <span
                  className="group-hover:opacity-100"
                  style={{
                    color: "rgba(180, 140, 85, 0.25)",
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
                }}
              >
                {item.content}
              </p>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Bottom — input + room actions */}
      <div
        style={{
          flexShrink: 0,
          padding: "12px 16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
        }}
      >
        {/* Room actions — audience only (participants have controls bar) */}
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

        {/* Input — bottom line only */}
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
    </div>
  );
}

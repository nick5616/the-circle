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
  // Controlled expanded state — lifted to parent so the bottom bar can drive it
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  // Height of the bottom controls bar so toasts / overlay don't overlap it
  controlsHeight?: number;
}

interface Toast {
  id: string;
  item: FeedItem & { kind: "chat" };
  fading: boolean;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

// Renders a single feed entry in the expanded view
function FeedEntry({ item }: { item: FeedItem }) {
  if (item.kind === "event") {
    const nameColor = item.name ? hashNameToColor(item.name) : null;
    return (
      <div
        style={{
          textAlign: "center",
          padding: "2px 0",
          animation: "float-up 0.4s ease-out both",
        }}
      >
        <span style={{ color: nameColor ? nameColor.hex + "88" : "rgba(200,160,100,0.45)", fontSize: "11px" }}>
          {item.name}
        </span>
        <span style={{ color: "rgba(185,148,95,0.3)", fontSize: "11px" }}> {item.text}</span>
      </div>
    );
  }

  const senderColor = hashNameToColor(item.sender);
  return (
    <div
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
      <div style={{ display: "flex", alignItems: "baseline", gap: "7px" }}>
        <span style={{ color: senderColor.hex, fontSize: "11px", fontWeight: 600, letterSpacing: "0.02em" }}>
          {item.sender}
        </span>
        <span style={{ color: "rgba(180,140,85,0.25)", fontSize: "10px" }}>
          {formatTime(item.timestamp)}
        </span>
      </div>
      <p style={{ color: "rgba(232,202,165,0.88)", fontSize: "13px", lineHeight: 1.45, margin: 0, wordBreak: "break-word" }}>
        {item.content}
      </p>
    </div>
  );
}

// A single toast message in the compact strip
function ToastBubble({ toast }: { toast: Toast }) {
  const item = toast.item;
  const senderColor = hashNameToColor(item.sender);
  return (
    <div
      style={{
        padding: "7px 12px 7px 10px",
        background: "rgba(8, 5, 3, 0.72)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderRadius: "10px",
        borderLeft: `2.5px solid ${senderColor.hex}50`,
        opacity: toast.fading ? 0 : 1,
        transition: "opacity 0.5s ease",
        animation: toast.fading ? undefined : "float-up 0.35s cubic-bezier(0.34,1.56,0.64,1) both",
      }}
    >
      <span style={{ color: senderColor.hex, fontSize: "12px", fontWeight: 600, marginRight: "6px" }}>
        {item.sender}
      </span>
      <span style={{ color: "rgba(230, 200, 162, 0.82)", fontSize: "13px", lineHeight: 1.35 }}>
        {item.content}
      </span>
    </div>
  );
}

export default function MobileChatOverlay({
  items,
  myName,
  role,
  seatsAvailable,
  onSend,
  onTakeSeat,
  onLeaveRoom,
  expanded,
  onExpand,
  onCollapse,
  controlsHeight = 130,
}: Props) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [draft, setDraft] = useState("");
  const [inputFocused, setInputFocused] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(0);
  const seededRef = useRef(false);
  // Maps toast id → [fadeTimer, removeTimer] so we can cancel on unmount
  const timerMapRef = useRef<Map<string, ReturnType<typeof setTimeout>[]>>(new Map());
  const myColor = myName ? hashNameToColor(myName) : null;

  // Auto-scroll expanded feed to bottom when new messages arrive
  useEffect(() => {
    if (expanded) {
      const t = setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 50);
      return () => clearTimeout(t);
    }
  }, [items, expanded]);

  // Watch for new chat messages and create toasts
  useEffect(() => {
    // On first render (initial history load) — seed length only, no toasts
    if (!seededRef.current) {
      seededRef.current = true;
      prevLengthRef.current = items.length;
      return;
    }

    if (items.length <= prevLengthRef.current) {
      prevLengthRef.current = items.length;
      return;
    }

    const newItems = items.slice(prevLengthRef.current);
    prevLengthRef.current = items.length;

    const chatItems = newItems.filter(
      (i): i is FeedItem & { kind: "chat" } => i.kind === "chat"
    );
    if (!chatItems.length) return;

    const now = Date.now();
    const newToasts: Toast[] = chatItems.map((item, i) => ({
      id: `${now}-${i}-${Math.random().toString(36).slice(2)}`,
      item,
      fading: false,
    }));

    setToasts((prev) => {
      let next = [...prev, ...newToasts];

      // If more than 2, immediately mark extras as fading and schedule their removal
      if (next.length > 2) {
        const excess = next.length - 2;
        for (let i = 0; i < excess; i++) {
          const t = next[i];
          if (!t.fading) {
            next[i] = { ...t, fading: true };
            // Cancel existing timers for this toast since we're evicting it early
            const existing = timerMapRef.current.get(t.id) ?? [];
            existing.forEach(clearTimeout);
            const removeTimer = setTimeout(() => {
              setToasts((p) => p.filter((m) => m.id !== t.id));
              timerMapRef.current.delete(t.id);
            }, 500);
            timerMapRef.current.set(t.id, [removeTimer]);
          }
        }
      }

      return next;
    });

    // Schedule expiry timers for the new toasts
    newToasts.forEach((toast) => {
      const fadeTimer = setTimeout(() => {
        setToasts((p) =>
          p.map((m) => (m.id === toast.id ? { ...m, fading: true } : m))
        );
      }, 5000);
      const removeTimer = setTimeout(() => {
        setToasts((p) => p.filter((m) => m.id !== toast.id));
        timerMapRef.current.delete(toast.id);
      }, 5500);
      timerMapRef.current.set(toast.id, [fadeTimer, removeTimer]);
    });
  }, [items]);

  // Clean up all timers on unmount
  useEffect(() => {
    return () => {
      timerMapRef.current.forEach((timers) => timers.forEach(clearTimeout));
    };
  }, []);

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  }

  const visibleToasts = toasts.slice(-2);

  return (
    <>
      {/* Compact toast strip — visible when not expanded and there are toasts */}
      {!expanded && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: `${controlsHeight + 8}px`,
            zIndex: 22,
            padding: "0 12px",
            display: "flex",
            flexDirection: "column-reverse",
            gap: "5px",
            pointerEvents: visibleToasts.length > 0 ? "auto" : "none",
          }}
          onClick={() => {
            if (visibleToasts.length > 0) onExpand();
          }}
        >
          {/* column-reverse: last toast in array = bottommost visually */}
          {visibleToasts.map((toast) => (
            <ToastBubble key={toast.id} toast={toast} />
          ))}
        </div>
      )}

      {/* Expanded overlay */}
      {expanded && (
        <>
          {/* Tap-to-close zone — top portion of screen */}
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              height: "45%",
              zIndex: 24,
              cursor: "pointer",
              // Subtle visual hint that tapping here closes
              background: "transparent",
            }}
            onClick={() => onCollapse()}
          />

          {/* Chat overlay panel — bottom 55% of screen, above controls */}
          <div
            style={{
              position: "fixed",
              top: "45%",
              left: 0,
              right: 0,
              bottom: `${controlsHeight}px`,
              zIndex: 23,
              background: "rgba(10, 7, 4, 0.86)",
              backdropFilter: "blur(28px)",
              WebkitBackdropFilter: "blur(28px)",
              borderRadius: "18px 18px 0 0",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 -12px 48px rgba(0,0,0,0.55)",
              animation: "slide-up-overlay 0.32s cubic-bezier(0.34, 1.2, 0.64, 1) both",
            }}
          >
            {/* Drag handle */}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                padding: "10px 0 6px",
                flexShrink: 0,
                cursor: "pointer",
              }}
              onClick={() => onCollapse()}
            >
              <div
                style={{
                  width: "38px",
                  height: "4px",
                  borderRadius: "2px",
                  background: "rgba(220, 180, 130, 0.22)",
                }}
              />
            </div>

            {/* Scrollable feed */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "4px 16px 8px",
                display: "flex",
                flexDirection: "column",
                gap: "12px",
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
                    paddingBottom: "16px",
                  }}
                >
                  the circle is quiet
                </p>
              )}
              {items.map((item, i) => (
                <FeedEntry key={i} item={item} />
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Input row */}
            <div
              style={{
                flexShrink: 0,
                padding: "10px 16px 14px",
                borderTop: "1px solid rgba(255,255,255,0.055)",
              }}
            >
              {role === "audience" && (
                <div style={{ display: "flex", gap: "12px", marginBottom: "10px" }}>
                  {seatsAvailable && (
                    <button
                      onClick={onTakeSeat}
                      style={{
                        background: "none",
                        border: "none",
                        color: "rgba(210, 175, 120, 0.5)",
                        fontSize: "12px",
                        letterSpacing: "0.04em",
                        cursor: "pointer",
                        padding: 0,
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
                      fontSize: "12px",
                      letterSpacing: "0.04em",
                      cursor: "pointer",
                      padding: 0,
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
                        : "rgba(255,255,255,0.08)"
                    }`,
                    padding: "8px 0 9px",
                    color: "rgba(232, 200, 160, 0.88)",
                    fontSize: "15px",
                    caretColor: myColor ? myColor.hex : "rgba(220,175,115,0.7)",
                    transition: "border-color 0.4s ease",
                    width: "100%",
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
        </>
      )}
    </>
  );
}

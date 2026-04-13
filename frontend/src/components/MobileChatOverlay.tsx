import { useEffect, useRef, useState } from "react";
import type { FeedItem } from "../types";
import { hashNameToColor } from "../fireColors";

interface Props {
  items: FeedItem[];
  myName: string;
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
  onSend: (text: string) => void;
  // Height of the footer row (px, excluding safe area) so toast strip and sheet clear it
  chatBarHeight?: number;
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
  expanded,
  onExpand,
  onCollapse,
  onSend,
  chatBarHeight,
  controlsHeight,
}: Props) {
  const barH = chatBarHeight ?? controlsHeight ?? 0;
  const [draft, setDraft] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const prevLengthRef = useRef(0);
  const seededRef = useRef(false);
  // Maps toast id → [fadeTimer, removeTimer] so we can cancel on unmount
  const timerMapRef = useRef<Map<string, ReturnType<typeof setTimeout>[]>>(new Map());
  // Swipe-down tracking
  const touchStartY = useRef<number | null>(null);

  void myName; // kept in props for future per-user styling

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
            bottom: `calc(${barH}px + env(safe-area-inset-bottom) + 8px)`,
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

      {/* Expanded overlay — covers full screen bottom (including controls) */}
      {expanded && (
        <>
          {/* Tap-to-close zone — top 40% of screen above the sheet */}
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              height: "40%",
              zIndex: 36,
              cursor: "pointer",
            }}
            onClick={() => onCollapse()}
          />

          {/* Sheet — slides up, covers action buttons (z-35) but stops above chat bar */}
          <div
            style={{
              position: "fixed",
              top: "40%",
              left: 0,
              right: 0,
              bottom: `calc(${barH}px + env(safe-area-inset-bottom))`,
              zIndex: 35,
              background: "rgba(10, 7, 4, 0.1)",
              backdropFilter: "blur(16px)",
              WebkitBackdropFilter: "blur(16px)",
              borderRadius: "20px 20px 0 0",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              boxShadow: "0 -16px 56px rgba(0,0,0,0.6)",
              animation: "slide-up-overlay 0.32s cubic-bezier(0.34, 1.2, 0.64, 1) both",
            }}
            onTouchStart={(e) => {
              touchStartY.current = e.touches[0].clientY;
            }}
            onTouchEnd={(e) => {
              if (touchStartY.current !== null) {
                const delta = e.changedTouches[0].clientY - touchStartY.current;
                if (delta > 60) onCollapse();
              }
              touchStartY.current = null;
            }}
          >
            {/* Drag handle — tap or swipe down to dismiss */}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                padding: "12px 0 8px",
                flexShrink: 0,
                cursor: "pointer",
              }}
              onClick={() => onCollapse()}
            >
              <div
                style={{
                  width: "40px",
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
                padding: "4px 16px 16px",
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
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "8px 12px 14px",
                borderTop: "1px solid rgba(255,255,255,0.055)",
                background: "rgba(8, 5, 3, 0.5)",
              }}
            >
              <div style={{ flex: 1, position: "relative", display: "flex", alignItems: "center" }}>
                <input
                  type="text"
                  placeholder="say something…"
                  maxLength={1000}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      const text = draft.trim();
                      if (text) { onSend(text); setDraft(""); }
                    }
                  }}
                  className="fire-input"
                  style={{
                    width: "100%",
                    background: "rgba(255,255,255,0.07)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "20px",
                    padding: "9px 40px 9px 16px",
                    color: "rgba(232, 200, 160, 0.88)",
                    fontSize: "14px",
                    caretColor: "rgba(220,175,115,0.8)",
                    outline: "none",
                    boxSizing: "border-box",
                    transition: "border-color 0.3s ease",
                  }}
                  onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = "rgba(200,155,85,0.35)"; }}
                  onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = "rgba(255,255,255,0.1)"; }}
                />
                {draft.trim().length > 0 && (
                  <button
                    onClick={() => { const text = draft.trim(); if (text) { onSend(text); setDraft(""); } }}
                    style={{
                      position: "absolute",
                      right: "6px",
                      width: "30px",
                      height: "30px",
                      borderRadius: "50%",
                      background: "rgba(210, 160, 80, 0.22)",
                      border: "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "rgba(225, 185, 110, 0.9)",
                      cursor: "pointer",
                      WebkitTapHighlightColor: "transparent",
                      animation: "float-up 0.22s ease-out both",
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

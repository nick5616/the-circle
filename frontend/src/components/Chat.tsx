import { useEffect, useRef, useState } from "react";
import type { FeedItem } from "../types";
import { hashNameToColor } from "../fireColors";

interface Props {
  items: FeedItem[];
  myId: string;
  myName: string;
  open: boolean;
  mobile: boolean;
  onClose: () => void;
  onOpen: () => void;
  onSend: (content: string) => void;
}

export const CHAT_WIDTH = 330;

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function Chat({ items, myId, myName, open, mobile, onClose, onOpen, onSend }: Props) {
  const [draft, setDraft] = useState("");
  const [toasts, setToasts] = useState<FeedItem[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const seen = useRef<Set<string> | null>(null);
  const toastTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const myColor = hashNameToColor(myName || "?").hex;

  // Follow new messages unless the reader has scrolled up
  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [items, open]);

  useEffect(() => {
    if (open && !mobile) input.current?.focus({ preventScroll: true });
  }, [open, mobile]);

  // Floating toasts for messages that arrive while the chat is closed
  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(items.map((i) => i.id));
      return;
    }
    const fresh = items.filter((i) => !seen.current!.has(i.id));
    fresh.forEach((i) => seen.current!.add(i.id));
    if (open || !fresh.length) return;
    const chats = fresh.filter((i) => i.kind === "chat" && i.sid !== myId);
    if (!chats.length) return;
    setToasts((t) => [...t, ...chats].slice(-3));
    const ids = chats.map((c) => c.id);
    toastTimers.current.push(setTimeout(() => setToasts((t) => t.filter((x) => !ids.includes(x.id))), 6000));
  }, [items, open, myId]);

  useEffect(() => () => toastTimers.current.forEach(clearTimeout), []);

  useEffect(() => {
    if (open) setToasts([]);
  }, [open]);

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
    stickToBottom.current = true;
  }

  const feed = (
    <div
      ref={scroller}
      className="chat-scroll"
      onScroll={(e) => {
        const el = e.currentTarget;
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      }}
      style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "6px 16px 10px", display: "flex", flexDirection: "column", gap: 10 }}
    >
      {items.length === 0 && (
        <p className="hand" style={{ margin: "auto 0 10px", textAlign: "center", fontSize: 22, color: "var(--ink-3)" }}>
          no messages yet
        </p>
      )}
      {items.map((item) => <Entry key={item.id} item={item} mine={item.kind === "chat" && item.sid === myId} />)}
    </div>
  );

  const composer = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      style={{ display: "flex", gap: 8, padding: "10px 12px 12px", alignItems: "center" }}
    >
      <input
        ref={input}
        data-testid="chat-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
        }}
        maxLength={500}
        placeholder="say something"
        autoComplete="off"
        enterKeyHint="send"
        style={{
          flex: 1, minWidth: 0, height: 44, padding: "0 16px", borderRadius: 16, border: "1.5px solid transparent",
          background: "rgba(255,220,180,0.07)", color: "var(--ink)", fontSize: 16, fontFamily: "var(--font-body)",
          transition: "border-color 0.3s var(--ease), background 0.3s var(--ease)",
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = myColor + "88")}
        onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
      />
      <button
        type="submit"
        aria-label="send"
        disabled={!draft.trim()}
        style={{
          width: 44, height: 44, flexShrink: 0, borderRadius: 16, border: "none", cursor: draft.trim() ? "pointer" : "default",
          display: "grid", placeItems: "center", color: "#2a120a",
          background: draft.trim() ? `linear-gradient(135deg, var(--gold), ${myColor})` : "rgba(255,220,180,0.07)",
          transition: "background 0.3s var(--ease), transform 0.3s var(--spring)",
          transform: draft.trim() ? "rotate(-8deg)" : "none",
        }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={draft.trim() ? "#2a120a" : "rgba(247,230,211,0.4)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.5 12.2L19.6 4.8l-5 15.4-3.2-6.6-6.9-1.4z" />
        </svg>
      </button>
    </form>
  );

  const header = (
    <div style={{ display: "flex", alignItems: "center", padding: "14px 12px 6px 18px" }}>
      <span className="hand" style={{ fontSize: 24, color: "var(--ink)" }}>chat</span>
      <button
        onClick={onClose}
        aria-label="close chat"
        style={{ marginLeft: "auto", width: 34, height: 34, borderRadius: 12, border: "none", background: "transparent", color: "var(--ink-3)", cursor: "pointer", fontSize: 18 }}
      >
        ✕
      </button>
    </div>
  );

  return (
    <>
      {!open && toasts.length > 0 && (
        <div
          onClick={onOpen}
          style={{
            position: "fixed", zIndex: 25, bottom: `calc(${mobile ? 86 : 92}px + env(safe-area-inset-bottom))`,
            right: mobile ? 12 : 20, left: mobile ? 12 : "auto", width: mobile ? "auto" : 300,
            display: "flex", flexDirection: "column", gap: 6, cursor: "pointer",
          }}
        >
          {toasts.map((t) => t.kind === "chat" && (
            <div key={t.id} className="glass msg" style={{ padding: "8px 14px 9px", borderRadius: 16 }}>
              <span className="hand" style={{ fontSize: 19, color: hashNameToColor(t.sender).hex, marginRight: 8 }}>{t.sender}</span>
              <span style={{ fontSize: 14, color: "var(--ink)" }}>{t.content}</span>
            </div>
          ))}
        </div>
      )}

      {mobile ? (
        open && (
          <>
            <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 39, background: "rgba(8,4,3,0.35)", animation: "fade-in .3s both" }} />
            <div
              className="glass"
              data-testid="chat-panel"
              style={{
                position: "fixed", left: 0, right: 0, bottom: 0, height: "64dvh", zIndex: 40, borderRadius: "26px 26px 0 0",
                display: "flex", flexDirection: "column", paddingBottom: "env(safe-area-inset-bottom)",
                background: "rgba(22,13,10,0.97)", animation: "sheet-up 0.45s var(--spring) both",
              }}
            >
              <div style={{ width: 44, height: 5, borderRadius: 3, background: "var(--ink-4)", margin: "10px auto 0" }} />
              {header}
              {feed}
              {composer}
            </div>
          </>
        )
      ) : (
        <div
          className="glass"
          data-testid="chat-panel"
          style={{
            position: "fixed", top: 12, right: 12, bottom: 12, width: CHAT_WIDTH, zIndex: 20, borderRadius: 26,
            display: "flex", flexDirection: "column",
            transform: open ? "translateX(0)" : `translateX(${CHAT_WIDTH + 30}px)`,
            opacity: open ? 1 : 0,
            transition: "transform 0.6s var(--spring), opacity 0.4s var(--ease)",
            pointerEvents: open ? "auto" : "none",
          }}
        >
          {header}
          {feed}
          {composer}
        </div>
      )}
    </>
  );
}

function Entry({ item, mine }: { item: FeedItem; mine: boolean }) {
  if (item.kind === "event") {
    return (
      <p className="msg display" style={{ margin: "2px 0", textAlign: "center", fontSize: 13, fontStyle: "italic", color: "var(--ink-3)" }}>
        <span style={{ color: hashNameToColor(item.name).hex }}>{item.name}</span> {item.text}
      </p>
    );
  }
  const c = hashNameToColor(item.sender).hex;
  return (
    <div className="msg" style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "0 4px" }}>
        <span className="hand" style={{ fontSize: 19, color: c, lineHeight: 1 }}>{mine ? "you" : item.sender}</span>
        <span className="msg-time" style={{ fontSize: 11, color: "var(--ink-3)" }}>{formatTime(item.timestamp)}</span>
      </div>
      <p
        style={{
          margin: "3px 0 0", padding: "8px 13px 9px", maxWidth: "88%", fontSize: 14.5, lineHeight: 1.45, color: "var(--ink)",
          wordBreak: "break-word",
          borderRadius: mine ? "18px 6px 18px 18px" : "6px 18px 18px 18px",
          background: mine ? `linear-gradient(135deg, ${c}38, rgba(255,143,171,0.16))` : "rgba(255,220,180,0.06)",
          boxShadow: `inset 2px 0 0 ${c}66`,
        }}
      >
        {item.content}
      </p>
    </div>
  );
}

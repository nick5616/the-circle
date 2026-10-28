import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { REACTIONS, type Reaction, type Role } from "../types";

interface Props {
  role: Role;
  mic: boolean;
  cam: boolean;
  hasMic: boolean;
  seatsAvailable: boolean;
  chatOpen: boolean;
  unread: number;
  view: "grid" | "circle";
  compact: boolean;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onReact: (e: Reaction) => void;
  onToggleChat: () => void;
  onToggleView: () => void;
  onTakeSeat: () => void;
  onLeaveSeat: () => void;
  onLeaveRoom: () => void;
}

export default function Dock(p: Props) {
  const [tray, setTray] = useState(false);
  const trayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!tray) return;
    const close = (e: PointerEvent) => {
      if (!trayRef.current?.contains(e.target as Node)) setTray(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [tray]);

  const gap = p.compact ? 6 : 8;

  return (
    <div
      style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 30, display: "flex", justifyContent: "center",
        padding: `0 10px calc(14px + env(safe-area-inset-bottom))`, pointerEvents: "none",
      }}
    >
      <div
        className="glass"
        style={{
          display: "flex", alignItems: "center", gap, padding: 7, borderRadius: 24, pointerEvents: "auto",
          animation: "rise-in 0.7s var(--spring) both", maxWidth: "100%",
        }}
      >
        {p.role === "participant" ? (
          <>
            <Btn testid="toggle-mic" tip={p.mic ? "mute (m)" : "unmute (m)"} off={!p.mic} onClick={p.onToggleMic} disabled={!p.hasMic}>
              {p.mic ? <MicIcon /> : <MicOffIcon />}
            </Btn>
            <Btn testid="toggle-cam" tip={p.cam ? "camera off (v)" : "camera on (v)"} off={!p.cam} onClick={p.onToggleCam}>
              {p.cam ? <CamIcon /> : <CamOffIcon />}
            </Btn>
          </>
        ) : (
          p.seatsAvailable && (
            <button
              data-testid="take-seat"
              className="pill-btn"
              onClick={p.onTakeSeat}
              style={{
                color: "#2a120a",
                background: "linear-gradient(135deg, var(--gold), var(--ember) 60%, var(--rose))",
                boxShadow: "0 0 28px -6px rgba(255,140,80,0.8)",
                height: 48,
                padding: p.compact ? "0 16px" : "0 22px",
              }}
            >
              take a seat
            </button>
          )
        )}

        <Sep />

        <div ref={trayRef} style={{ position: "relative" }}>
          <Btn testid="react" tip="react" on={tray} onClick={() => setTray((t) => !t)}>
            <SparkIcon />
          </Btn>
          {tray && (
            <div
              className="glass"
              style={{
                position: "absolute", bottom: "calc(100% + 12px)", left: "50%", translate: "-50% 0",
                display: "flex", gap: 2, padding: 6, borderRadius: 20, animation: "rise-in 0.35s var(--spring) both",
              }}
            >
              {REACTIONS.map((e, i) => (
                <button
                  key={e}
                  data-testid={`react-${i}`}
                  title={e === "🪵" ? "make the fire bigger" : undefined}
                  onClick={() => p.onReact(e)}
                  style={{
                    width: 42, height: 42, fontSize: 24, border: "none", background: "transparent", borderRadius: 14,
                    cursor: "pointer", transition: "transform 0.3s var(--spring)",
                  }}
                  onMouseEnter={(ev) => (ev.currentTarget.style.transform = "translateY(-4px) scale(1.18) rotate(-6deg)")}
                  onMouseLeave={(ev) => (ev.currentTarget.style.transform = "")}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>

        <Btn testid="toggle-chat" tip={p.chatOpen ? "hide chat (c)" : "chat (c)"} on={p.chatOpen} onClick={p.onToggleChat}>
          <ChatIcon />
          {p.unread > 0 && !p.chatOpen && (
            <span
              style={{
                position: "absolute", top: 6, right: 6, minWidth: 16, height: 16, padding: "0 4px", borderRadius: 8,
                background: "var(--rose)", color: "#2a0f12", fontSize: 10, fontWeight: 700, display: "grid", placeItems: "center",
              }}
            >
              {p.unread > 9 ? "9+" : p.unread}
            </span>
          )}
        </Btn>

        {!p.compact && (
          <Btn testid="toggle-view" tip={p.view === "circle" ? "grid view" : "circle view"} onClick={p.onToggleView}>
            {p.view === "circle" ? <GridIcon /> : <CircleIcon />}
          </Btn>
        )}

        <Sep />

        {p.role === "participant" && (
          <Btn testid="leave-seat" tip="leave seat (keep watching)" onClick={p.onLeaveSeat}>
            <StepBackIcon />
          </Btn>
        )}
        <Btn testid="leave-room" tip="leave" onClick={p.onLeaveRoom} danger>
          <HomeIcon />
        </Btn>
      </div>
    </div>
  );
}

function Btn({
  children, tip, onClick, off, on, danger, disabled, testid,
}: {
  children: ReactNode; tip: string; onClick: () => void; off?: boolean; on?: boolean; danger?: boolean; disabled?: boolean; testid: string;
}) {
  return (
    <button
      className="dock-btn"
      data-testid={testid}
      data-off={off || undefined}
      data-on={on || undefined}
      onClick={onClick}
      disabled={disabled}
      aria-label={tip}
      style={{
        ...(danger ? { color: "rgba(255,143,171,0.85)" } : null),
        ...(disabled ? { opacity: 0.35, cursor: "not-allowed" } : null),
      }}
    >
      {children}
      <span className="tip">{tip}</span>
    </button>
  );
}

function Sep() {
  return <i style={{ width: 1, height: 26, background: "var(--line)", margin: "0 2px", flexShrink: 0 }} />;
}

// Icons — rounded, slightly loose strokes so they feel drawn rather than stamped
const S = { width: 21, height: 21, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function MicIcon() {
  return (<svg {...S}><rect x="9" y="2.8" width="6" height="11.4" rx="3" /><path d="M5.2 11a6.8 6.8 0 0 0 13.6.2M12 18.2v3" /></svg>);
}
function MicOffIcon() {
  return (<svg {...S}><path d="M15 9.6V5.8a3 3 0 0 0-5.6-1.5M9 9v2a3 3 0 0 0 5 2.2M5.2 11a6.8 6.8 0 0 0 11.1 5.3M18.6 13.4c.1-.8.2-1.5.2-2.3M12 18.2v3M3.5 3.3l17 17.2" /></svg>);
}
function CamIcon() {
  return (<svg {...S}><rect x="2.6" y="6.2" width="13" height="11.6" rx="3.2" /><path d="M15.6 10.4l5.2-3v9.3l-5.2-3" /></svg>);
}
function CamOffIcon() {
  return (<svg {...S}><path d="M8 6.2h4.4a3.2 3.2 0 0 1 3.2 3.2v4.4M15.6 10.4l5.2-3v9.3l-4.4-2.6M14.6 17.2a3.2 3.2 0 0 1-2.2.6H5.8a3.2 3.2 0 0 1-3.2-3.2V9.4c0-1 .5-2 1.3-2.6M3 3l18 18" /></svg>);
}
function SparkIcon() {
  return (<svg {...S}><path d="M12 3.2c.6 4.3 2.5 6.3 6.6 6.9-4.1.6-6 2.6-6.6 6.9-.6-4.3-2.5-6.3-6.6-6.9 4.1-.6 6-2.6 6.6-6.9z" /><path d="M18.6 16.4c.2 1.6.9 2.3 2.4 2.5-1.5.2-2.2.9-2.4 2.5-.2-1.6-.9-2.3-2.4-2.5 1.5-.2 2.2-.9 2.4-2.5z" /></svg>);
}
function ChatIcon() {
  return (<svg {...S}><path d="M20.4 11.6c0 4.2-3.8 7.4-8.4 7.4-1.3 0-2.5-.2-3.6-.7L3.6 20l1.4-3.9c-.9-1.3-1.4-2.8-1.4-4.5 0-4.2 3.8-7.4 8.4-7.4s8.4 3.2 8.4 7.4z" /></svg>);
}
function GridIcon() {
  return (<svg {...S}><rect x="3.4" y="3.6" width="7.2" height="7" rx="2" /><rect x="13.4" y="3.6" width="7.2" height="7" rx="2" /><rect x="3.4" y="13.4" width="7.2" height="7" rx="2" /><rect x="13.4" y="13.4" width="7.2" height="7" rx="2" /></svg>);
}
function CircleIcon() {
  return (<svg {...S}><circle cx="12" cy="12" r="8.6" strokeDasharray="2.4 3.2" /><path d="M12 15.6c-1.6 0-2.6-1.1-2.6-2.5 0-1.8 1.6-2.4 2.2-4.3.9.8 1.4 1.5 1.5 2.4.4-.3.7-.8.8-1.3.6.7.8 1.6.8 2.3 0 2-1.2 3.4-2.7 3.4z" /></svg>);
}
function StepBackIcon() {
  return (<svg {...S}><path d="M9.8 7.4L5.2 12l4.6 4.6M5.6 12h9.6a4.6 4.6 0 0 1 0 9.2h-1.6" /></svg>);
}
function HomeIcon() {
  return (<svg {...S}><path d="M3.6 11.2L12 4l8.4 7.2M6 9.6v9.2c0 .7.5 1.2 1.2 1.2h3.3v-4.8h3v4.8h3.3c.7 0 1.2-.5 1.2-1.2V9.6" /></svg>);
}

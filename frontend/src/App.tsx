import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { socket } from "./socket";
import { webrtc } from "./webrtc";
import type { FeedItem, Role, Seat, ServerMessage } from "./types";
import LandingLobby from "./components/LandingLobby";
import VideoGrid from "./components/VideoGrid";
import Chat from "./components/Chat";
import SeatBar from "./components/SeatBar";

interface RoomState {
  seats: Array<Seat | null>;
  audience_count: number;
  your_session_id: string;
  your_role: Role;
}

// ─── Speaking detection hook ────────────────────────────────────────────────

function useSpeaking(
  streams: Map<string, MediaStream>,
  localSessionId: string
): Set<string> {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analysersRef = useRef(
    new Map<string, { analyser: AnalyserNode; data: Uint8Array<ArrayBuffer> }>()
  );
  const [speaking, setSpeaking] = useState<Set<string>>(new Set());

  // Add / remove analysers as streams change
  useEffect(() => {
    if (streams.size === 0) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      const ctx = audioCtxRef.current;

      // Normalize __local__ → actual session id
      const norm = new Map<string, MediaStream>();
      for (const [id, s] of streams) {
        norm.set(id === "__local__" ? localSessionId : id, s);
      }

      for (const [id, stream] of norm) {
        if (analysersRef.current.has(id)) continue;
        if (!stream.getAudioTracks().length) continue;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.85;
        source.connect(analyser);
        const buf = new ArrayBuffer(analyser.frequencyBinCount);
        analysersRef.current.set(id, { analyser, data: new Uint8Array(buf) });
      }
      for (const id of analysersRef.current.keys()) {
        if (!norm.has(id)) analysersRef.current.delete(id);
      }
    } catch {
      // AudioContext unavailable — degrade silently
    }
  }, [streams, localSessionId]);

  // RAF polling loop — runs once, reads from ref
  useEffect(() => {
    let raf: number;
    function poll() {
      const now = new Set<string>();
      for (const [id, { analyser, data }] of analysersRef.current) {
        analyser.getByteFrequencyData(data);
        const rms = Math.sqrt(
          data.reduce((s, v) => s + v * v, 0) / data.length
        );
        if (rms > 9) now.add(id);
      }
      setSpeaking((prev) => {
        if (
          prev.size === now.size &&
          [...now].every((id) => prev.has(id))
        )
          return prev;
        return new Set(now);
      });
      raf = requestAnimationFrame(poll);
    }
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, []);

  return speaking;
}

// ─── App ────────────────────────────────────────────────────────────────────

export default function App() {
  const [joined, setJoined] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [streams, setStreams] = useState<Map<string, MediaStream>>(
    () => new Map()
  );
  const [view, setView] = useState<"grid" | "circle">("grid");
  const [chatOpen, setChatOpen] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= 1024
  );
  const [localName, setLocalName] = useState("");

  const localStreamRef = useRef<MediaStream | null>(null);
  const offeredTo = useRef<Set<string>>(new Set());
  const roomStateRef = useRef<RoomState | null>(null);
  const prevSeatsRef = useRef<Array<Seat | null> | null>(null);

  // Computed streams map with __local__ replaced by real session id
  const gridStreams = useMemo(() => {
    const m = new Map(streams);
    if (localStreamRef.current && roomState?.your_session_id) {
      m.set(roomState.your_session_id, localStreamRef.current);
      m.delete("__local__");
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streams, roomState?.your_session_id]);

  const speaking = useSpeaking(
    streams,
    roomState?.your_session_id ?? ""
  );

  // ── Join / leave event detection ──────────────────────────────────────────
  useEffect(() => {
    if (!roomState || !joined) return;
    const curr = roomState.seats;
    const prev = prevSeatsRef.current;

    if (prev !== null) {
      const ts = new Date().toISOString();
      const events: FeedItem[] = [];
      for (let i = 0; i < 8; i++) {
        const wasOccupied = prev[i];
        const isOccupied = curr[i];
        if (!wasOccupied && isOccupied) {
          // Don't announce the local user joining to themselves
          if (isOccupied.session_id !== roomState.your_session_id) {
            events.push({
              kind: "event",
              name: isOccupied.name,
              text: "joined the circle",
              timestamp: ts,
            });
          }
        } else if (wasOccupied && !isOccupied) {
          events.push({
            kind: "event",
            name: wasOccupied.name,
            text: "left",
            timestamp: ts,
          });
        }
      }
      if (events.length) setFeedItems((prev) => [...prev, ...events]);
    }
    prevSeatsRef.current = curr;
  }, [roomState, joined]);

  // ── WebRTC stream callback ─────────────────────────────────────────────────
  useEffect(() => {
    webrtc.setStreamCallback((sessionId, stream) => {
      setStreams((prev) => {
        const next = new Map(prev);
        if (stream) next.set(sessionId, stream);
        else next.delete(sessionId);
        return next;
      });
    });
  }, []);

  // ── Server message handler ────────────────────────────────────────────────
  const handleMessage = useCallback(async (msg: ServerMessage) => {
    switch (msg.type) {
      case "room_state": {
        const prev = roomStateRef.current;
        roomStateRef.current = msg.payload;
        setRoomState(msg.payload);

        if (msg.payload.your_role === "participant") {
          for (const seat of msg.payload.seats) {
            if (!seat) continue;
            if (seat.session_id === msg.payload.your_session_id) continue;
            if (offeredTo.current.has(seat.session_id)) continue;
            offeredTo.current.add(seat.session_id);
            if (msg.payload.your_session_id < seat.session_id) {
              await webrtc.createOffer(seat.session_id);
            }
          }
        } else if (msg.payload.your_role === "audience") {
          for (const seat of msg.payload.seats) {
            if (!seat) continue;
            if (offeredTo.current.has(seat.session_id)) continue;
            offeredTo.current.add(seat.session_id);
            await webrtc.createOffer(seat.session_id);
          }
        }

        if (prev) {
          const currentIds = new Set(
            msg.payload.seats.filter(Boolean).map((s) => s!.session_id)
          );
          for (const seat of prev.seats) {
            if (seat && !currentIds.has(seat.session_id)) {
              webrtc.closeConnection(seat.session_id);
              offeredTo.current.delete(seat.session_id);
            }
          }
        }
        break;
      }
      case "chat":
        setFeedItems((prev) => [
          ...prev,
          { kind: "chat", ...msg.payload },
        ]);
        break;
      case "chat_history":
        setFeedItems(
          msg.payload.messages.map((m) => ({ kind: "chat", ...m }))
        );
        break;
      case "offer":
        await webrtc.handleOffer(msg.payload.from, msg.payload.sdp);
        break;
      case "answer":
        await webrtc.handleAnswer(msg.payload.from, msg.payload.sdp);
        break;
      case "ice":
        await webrtc.handleIce(msg.payload.from, msg.payload.candidate);
        break;
      case "participant_left":
        webrtc.closeConnection(msg.payload.session_id);
        offeredTo.current.delete(msg.payload.session_id);
        break;
      case "seat_denied":
        // Could be surfaced more gracefully — ambient inline message — but
        // keeping alert for now since it's rare
        alert(`Could not take seat: ${msg.payload.reason}`);
        break;
    }
  }, []);

  useEffect(() => {
    socket.connect();
    return socket.onMessage(handleMessage);
  }, [handleMessage]);

  // ── Join ──────────────────────────────────────────────────────────────────
  const handleJoin = useCallback(async (name: string, role: Role) => {
    setLocalName(name);
    socket.connect();

    if (role === "participant") {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: true,
        });
        localStreamRef.current = stream;
        webrtc.setLocalStream(stream);
        setStreams((prev) => new Map(prev).set("__local__", stream));
      } catch (err) {
        const isSecurityError =
          err instanceof DOMException &&
          (err.name === "NotAllowedError" || err.name === "SecurityError");
        alert(
          isSecurityError
            ? "Camera access requires HTTPS on mobile. Joining as audience instead."
            : "Could not access camera/mic. Joining as audience instead."
        );
        role = "audience";
      }
    }

    const unsub = socket.onMessage(async (msg: ServerMessage) => {
      if (msg.type !== "room_state") return;
      unsub();
      roomStateRef.current = msg.payload;
      prevSeatsRef.current = msg.payload.seats; // seed — no events for initial state
      setRoomState(msg.payload);
      setJoined(true);

      if (msg.payload.your_role === "participant") {
        for (const seat of msg.payload.seats) {
          if (!seat || seat.session_id === msg.payload.your_session_id)
            continue;
          if (offeredTo.current.has(seat.session_id)) continue;
          offeredTo.current.add(seat.session_id);
          if (msg.payload.your_session_id < seat.session_id) {
            await webrtc.createOffer(seat.session_id);
          }
        }
      } else if (msg.payload.your_role === "audience") {
        for (const seat of msg.payload.seats) {
          if (!seat) continue;
          if (offeredTo.current.has(seat.session_id)) continue;
          offeredTo.current.add(seat.session_id);
          await webrtc.createOffer(seat.session_id);
        }
      }
    });

    socket.send({ type: "join", payload: { name, role } });
  }, []);

  // ── Participant actions ───────────────────────────────────────────────────
  const handleSendChat = useCallback((content: string) => {
    socket.send({ type: "chat", payload: { content } });
  }, []);

  const handleToggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
    setMuted(next);
  }, [muted]);

  const handleToggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !cameraOff;
    stream.getVideoTracks().forEach((t) => {
      t.enabled = !next;
    });
    setCameraOff(next);
  }, [cameraOff]);

  const handleLeaveSeat = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    webrtc.closeAll();
    offeredTo.current.clear();
    setStreams(new Map());
    setMuted(false);
    setCameraOff(false);
    socket.send({ type: "leave_seat" });
  }, []);

  const handleLeaveRoom = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    webrtc.closeAll();
    offeredTo.current.clear();
    socket.disconnect();
    prevSeatsRef.current = null;
    setJoined(false);
    setRoomState(null);
    setFeedItems([]);
    setStreams(new Map());
    setMuted(false);
    setCameraOff(false);
    setLocalName("");
  }, []);

  const handleTakeSeat = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: true,
      });
      localStreamRef.current = stream;
      webrtc.setLocalStream(stream);
      setStreams((prev) => new Map(prev).set("__local__", stream));
    } catch {
      alert("Could not access camera/mic.");
      return;
    }
    socket.send({ type: "take_seat" });
  }, []);

  // ── Landing ───────────────────────────────────────────────────────────────
  const seatsOccupied = roomState ? roomState.seats.filter(Boolean).length : 0;
  const seats = roomState?.seats ?? (Array(8).fill(null) as Array<Seat | null>);

  if (!joined || !roomState) {
    return (
      <LandingLobby
        seats={seats}
        audienceCount={roomState?.audience_count ?? 0}
        onJoin={handleJoin}
      />
    );
  }

  // ── Room ──────────────────────────────────────────────────────────────────
  const role = roomState.your_role;
  const seatsAvailable = seatsOccupied < 8;

  return (
    <div
      className="relative overflow-hidden"
      style={{
        width: "100%",
        height: "100dvh",
        backgroundColor: "#1a1510",
      }}
    >
      {/* Ambient fire glow */}
      <div
        className="pointer-events-none absolute inset-0 animate-fire-breathe"
        style={{
          background:
            "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(190,80,10,0.07) 0%, transparent 70%)",
        }}
      />

      {/* Top-right icon cluster */}
      <div
        className="absolute z-30 flex items-center gap-2"
        style={{ top: "14px", right: chatOpen ? "292px" : "14px", transition: "right 0.4s cubic-bezier(0.34,1.56,0.64,1)" }}
      >
        {/* View toggle */}
        <button
          onClick={() => setView((v) => (v === "grid" ? "circle" : "grid"))}
          title={view === "grid" ? "Circle view" : "Grid view"}
          style={iconBtn}
        >
          {view === "grid" ? (
            // Circle icon
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="9" />
              <circle cx="12" cy="3" r="1.5" fill="currentColor" stroke="none" />
              <circle cx="12" cy="21" r="1.5" fill="currentColor" stroke="none" />
              <circle cx="3" cy="12" r="1.5" fill="currentColor" stroke="none" />
              <circle cx="21" cy="12" r="1.5" fill="currentColor" stroke="none" />
            </svg>
          ) : (
            // Grid icon
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          )}
        </button>

        {/* Chat toggle */}
        <button
          onClick={() => setChatOpen((o) => !o)}
          title={chatOpen ? "Close chat" : "Open chat"}
          style={{
            ...iconBtn,
            color: chatOpen
              ? "rgba(220,185,130,0.75)"
              : "rgba(200,165,115,0.4)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        </button>
      </div>

      {/* Video — fills entire canvas */}
      <div className="absolute inset-0">
        <VideoGrid
          seats={roomState.seats}
          streams={gridStreams}
          localSessionId={roomState.your_session_id}
          view={view}
          speaking={speaking}
          localCameraOff={cameraOff}
        />
      </div>

      {/* Floating seat indicator */}
      <div
        className="absolute z-10 pointer-events-none"
        style={{
          bottom: role === "participant" ? "70px" : "20px",
          left: "50%",
          transform: "translateX(-50%)",
          transition: "bottom 0.3s ease",
        }}
      >
        <SeatBar
          seats={roomState.seats}
          audienceCount={roomState.audience_count}
        />
      </div>

      {/* Participant controls */}
      {role === "participant" && (
        <div
          className="absolute z-10 flex items-center justify-center"
          style={{ bottom: "16px", left: 0, right: 0, gap: "14px", display: "flex" }}
        >
          <ControlBtn
            onClick={handleToggleMute}
            active={muted}
            title={muted ? "Unmute" : "Mute mic"}
          >
            {muted ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
              </svg>
            )}
          </ControlBtn>

          <ControlBtn
            onClick={handleToggleCamera}
            active={cameraOff}
            title={cameraOff ? "Turn camera on" : "Turn camera off"}
          >
            {cameraOff ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M12 18.75H4.5a2.25 2.25 0 01-2.25-2.25V9m12.841 8.909L6.75 6.75m0 0L4.5 4.5M6.75 6.75l-.75-.75" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
              </svg>
            )}
          </ControlBtn>

          {/* Leave seat (step back to audience) */}
          <ControlBtn
            onClick={handleLeaveSeat}
            active={false}
            title="Leave seat"
            danger
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
          </ControlBtn>
        </div>
      )}

      {/* Chat panel — overlays right side */}
      <div
        className="absolute top-0 right-0 h-full z-20"
        style={{
          width: "276px",
          transform: chatOpen ? "translateX(0)" : "translateX(100%)",
          transition:
            "transform 0.42s cubic-bezier(0.34, 1.56, 0.64, 1)",
        }}
      >
        <Chat
          items={feedItems}
          myName={localName}
          role={role}
          seatsAvailable={seatsAvailable}
          onSend={handleSendChat}
          onTakeSeat={handleTakeSeat}
          onLeaveRoom={handleLeaveRoom}
        />
      </div>
    </div>
  );
}

// ─── Shared style objects ────────────────────────────────────────────────────

const iconBtn: React.CSSProperties = {
  width: "34px",
  height: "34px",
  borderRadius: "50%",
  background: "rgba(255,255,255,0.05)",
  backdropFilter: "blur(8px)",
  border: "none",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "rgba(205,168,115,0.45)",
  cursor: "pointer",
  transition: "color 0.25s ease, background 0.25s ease",
};

function ControlBtn({
  children,
  onClick,
  active,
  danger,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  danger?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: "48px",
        height: "48px",
        borderRadius: "50%",
        background: active
          ? "rgba(210, 55, 55, 0.18)"
          : "rgba(22, 15, 9, 0.78)",
        backdropFilter: "blur(10px)",
        border: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: active
          ? "#e74c3c"
          : danger
          ? "rgba(220, 160, 100, 0.45)"
          : "rgba(225, 190, 145, 0.6)",
        cursor: "pointer",
        boxShadow: active ? "0 0 16px 3px rgba(210,55,55,0.2)" : "none",
        transition:
          "background 0.32s ease, color 0.32s ease, box-shadow 0.32s ease",
      }}
    >
      {children}
    </button>
  );
}

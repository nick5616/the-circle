import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { socket } from "./socket";
import { webrtc } from "./webrtc";
import type { FeedItem, Role, Seat, ServerMessage } from "./types";
import LandingLobby from "./components/LandingLobby";
import VideoGrid from "./components/VideoGrid";
import MobileVideoGrid from "./components/MobileVideoGrid";
import Chat from "./components/Chat";
import MobileChatOverlay from "./components/MobileChatOverlay";
import SeatBar from "./components/SeatBar";

// ─── Mobile detection hook ───────────────────────────────────────────────────

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.innerWidth < 768
  );
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return isMobile;
}

interface RoomState {
  seats: Array<Seat | null>;
  audience_count: number;
  your_session_id: string;
  your_role: Role;
}

// ─── Speaking detection hook ────────────────────────────────────────────────

// dBFS silence floor — below this is treated as silence
const SILENCE_FLOOR_DB = -48;

function useSpeaking(
  streams: Map<string, MediaStream>,
  localSessionId: string
): Map<string, number> {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analysersRef = useRef(
    new Map<string, { analyser: AnalyserNode; data: Uint8Array<ArrayBuffer>; smoothed: number }>()
  );
  const [audioLevels, setAudioLevels] = useState<Map<string, number>>(new Map());

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
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.6; // lighter — we do our own EMA
        source.connect(analyser);
        const buf = new ArrayBuffer(analyser.frequencyBinCount);
        analysersRef.current.set(id, { analyser, data: new Uint8Array(buf), smoothed: 0 });
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
      const levels = new Map<string, number>();

      for (const [id, entry] of analysersRef.current) {
        entry.analyser.getByteFrequencyData(entry.data);
        const rms = Math.sqrt(
          entry.data.reduce((s, v) => s + v * v, 0) / entry.data.length
        );

        // Convert RMS (0-255 scale) → dBFS → perceptual 0-1 level.
        // Perceived loudness is roughly linear in dB, so a dBFS → 0-1 mapping
        // gives us a scale that matches how humans hear volume differences.
        let rawLevel = 0;
        if (rms > 0) {
          const dBFS = 20 * Math.log10(rms / 255);
          rawLevel = Math.max(0, Math.min(1, (dBFS - SILENCE_FLOOR_DB) / -SILENCE_FLOOR_DB));
        }

        // EMA: rises fast (0.35 weight on new), decays moderately (0.65 carry)
        // so the glow tracks speech onset quickly but doesn't strobe
        entry.smoothed = entry.smoothed * 0.65 + rawLevel * 0.35;

        if (entry.smoothed > 0.01) levels.set(id, entry.smoothed);
      }

      setAudioLevels((prev) => {
        // Avoid re-render if nothing changed by more than the visual deadband (2.5%)
        if (prev.size !== levels.size) return new Map(levels);
        for (const [k, v] of levels) {
          if (Math.abs((prev.get(k) ?? 0) - v) > 0.025) return new Map(levels);
        }
        for (const k of prev.keys()) {
          if (!levels.has(k)) return new Map(levels);
        }
        return prev;
      });

      raf = requestAnimationFrame(poll);
    }
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, []);

  return audioLevels;
}

// ─── App ────────────────────────────────────────────────────────────────────

export default function App() {
  const isMobile = useIsMobile();
  const [joined, setJoined] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [streams, setStreams] = useState<Map<string, MediaStream>>(
    () => new Map()
  );
  const [view, setView] = useState<"grid" | "circle">("grid");
  const [localName, setLocalName] = useState("");
  const [mobileChatExpanded, setMobileChatExpanded] = useState(false);

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

  const audioLevels = useSpeaking(
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

  // ── WebRTC reconnect on ICE failure ───────────────────────────────────────
  useEffect(() => {
    webrtc.setDisconnectCallback((sessionId) => {
      const state = roomStateRef.current;
      if (!state) return;
      const stillInRoom = state.seats.some((s) => s?.session_id === sessionId);
      if (!stillInRoom) return;
      // Reset tracking so the offer logic can re-run for this peer
      offeredTo.current.delete(sessionId);
      offeredTo.current.add(sessionId);
      // Only the lower session_id re-initiates to avoid both sides offering
      if (state.your_session_id < sessionId) {
        webrtc.createOffer(sessionId);
      }
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
          video: {
            facingMode: "user",
            width: { ideal: 640, max: 854 },
            height: { ideal: 360, max: 480 },
            frameRate: { ideal: 24, max: 30 },
          },
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
        video: {
          facingMode: "user",
          width: { ideal: 640, max: 854 },
          height: { ideal: 360, max: 480 },
          frameRate: { ideal: 24, max: 30 },
        },
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

  // ── Mobile layout ─────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div
        className="relative overflow-hidden"
        style={{ width: "100%", height: "100dvh", backgroundColor: "#1a1510" }}
      >
        {/* Ambient fire glow */}
        <div
          className="pointer-events-none absolute inset-0 animate-fire-breathe"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(190,80,10,0.07) 0%, transparent 70%)",
          }}
        />

        {/* Video fills the whole screen */}
        <div className="absolute inset-0">
          <MobileVideoGrid
            seats={roomState.seats}
            streams={gridStreams}
            localSessionId={roomState.your_session_id}
            audioLevels={audioLevels}
            localCameraOff={cameraOff}
          />
        </div>

        {/* Seat indicator — floats above tiles */}
        <div
          className="absolute z-10 pointer-events-none"
          style={{
            top: "14px",
            left: "50%",
            transform: "translateX(-50%)",
          }}
        >
          <SeatBar
            seats={roomState.seats}
            audienceCount={roomState.audience_count}
          />
        </div>

        {/* ── Single footer row — z-30, sheet (z-35) covers it when chat is open ── */}
        <div
          className="absolute z-30"
          style={{
            bottom: 0,
            left: 0,
            right: 0,
            paddingBottom: "env(safe-area-inset-bottom)",
            background: "rgba(10, 7, 4, 0.72)",
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)",
            borderTop: "1px solid rgba(255,255,255,0.055)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "12px",
              padding: "10px 16px 10px",
            }}
          >
            {role === "participant" ? (
              <>
                <ControlBtn onClick={handleToggleMute} active={muted} title={muted ? "Unmute" : "Mute mic"}>
                  {muted ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                    </svg>
                  )}
                </ControlBtn>
                <ControlBtn onClick={handleToggleCamera} active={cameraOff} title={cameraOff ? "Turn camera on" : "Turn camera off"}>
                  {cameraOff ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M12 18.75H4.5a2.25 2.25 0 01-2.25-2.25V9m12.841 8.909L6.75 6.75m0 0L4.5 4.5M6.75 6.75l-.75-.75" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
                    </svg>
                  )}
                </ControlBtn>
                <ControlBtn onClick={handleLeaveSeat} active={false} title="Leave seat" danger>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
                  </svg>
                </ControlBtn>
                <ControlBtn onClick={handleLeaveRoom} active={false} title="Leave room" severe>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 5.636a9 9 0 1012.728 12.728M12 3v9m0 0l3-3m-3 3L9 9" />
                  </svg>
                </ControlBtn>
              </>
            ) : (
              <>
                {seatsAvailable && (
                  <button
                    onClick={handleTakeSeat}
                    style={{
                      height: "40px",
                      padding: "0 20px",
                      borderRadius: "20px",
                      background: "transparent",
                      border: "1px solid rgba(200, 155, 85, 0.28)",
                      color: "rgba(225, 185, 130, 0.75)",
                      fontSize: "13px",
                      letterSpacing: "0.04em",
                      cursor: "pointer",
                      WebkitTapHighlightColor: "transparent",
                    }}
                  >
                    join seat
                  </button>
                )}
                <button
                  onClick={handleLeaveRoom}
                  style={{
                    height: "40px",
                    padding: "0 20px",
                    borderRadius: "20px",
                    background: "transparent",
                    border: "1px solid rgba(160, 60, 40, 0.25)",
                    color: "rgba(210, 100, 75, 0.6)",
                    fontSize: "13px",
                    letterSpacing: "0.04em",
                    cursor: "pointer",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  leave room
                </button>
              </>
            )}

            {/* Chat toggle — same row as other controls */}
            <ControlBtn
              onClick={() => setMobileChatExpanded((v) => !v)}
              active={mobileChatExpanded}
              title={mobileChatExpanded ? "Close chat" : "Open chat"}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
              </svg>
            </ControlBtn>
          </div>
        </div>

        {/* Mobile chat overlay — sheet (z-35) covers full footer when open */}
        <MobileChatOverlay
          items={feedItems}
          myName={localName}
          expanded={mobileChatExpanded}
          onExpand={() => setMobileChatExpanded(true)}
          onCollapse={() => setMobileChatExpanded(false)}
          onSend={handleSendChat}
        />
      </div>
    );
  }

  // ── Desktop layout ─────────────────────────────────────────────────────────
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

      {/* Top-right icon cluster — view toggle only; chat is always-on overlay */}
      <div
        className="absolute z-30 flex items-center gap-1"
        style={{
          top: "14px",
          right: "14px",
          background: "rgba(8, 5, 3, 0.78)",
          backdropFilter: "blur(14px)",
          borderRadius: "999px",
          padding: "3px",
          border: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <button
          onClick={() => setView((v) => (v === "grid" ? "circle" : "grid"))}
          title={view === "grid" ? "Circle view" : "Grid view"}
          style={iconBtn}
        >
          {view === "grid" ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="9" />
              <circle cx="12" cy="3" r="1.5" fill="currentColor" stroke="none" />
              <circle cx="12" cy="21" r="1.5" fill="currentColor" stroke="none" />
              <circle cx="3" cy="12" r="1.5" fill="currentColor" stroke="none" />
              <circle cx="21" cy="12" r="1.5" fill="currentColor" stroke="none" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          )}
        </button>
      </div>

      {/* Video — always full canvas; chat floats over as transparent overlay */}
      <div className="absolute inset-0">
        <VideoGrid
          seats={roomState.seats}
          streams={gridStreams}
          localSessionId={roomState.your_session_id}
          view={view}
          audioLevels={audioLevels}
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

      {/* Audience controls */}
      {role === "audience" && (
        <div
          className="absolute z-10 flex items-center justify-center"
          style={{ bottom: "16px", left: 0, right: 0, gap: "14px", display: "flex" }}
        >
          {seatsAvailable && (
            <button
              onClick={handleTakeSeat}
              title="Join a seat"
              style={{
                height: "40px",
                padding: "0 20px",
                borderRadius: "20px",
                background: "rgba(22, 15, 9, 0.82)",
                backdropFilter: "blur(10px)",
                border: "1px solid rgba(200, 155, 85, 0.22)",
                color: "rgba(225, 185, 130, 0.72)",
                fontSize: "13px",
                letterSpacing: "0.04em",
                cursor: "pointer",
                transition: "border-color 0.3s ease, color 0.3s ease",
              }}
            >
              join seat
            </button>
          )}
          <button
            onClick={handleLeaveRoom}
            title="Leave room"
            style={{
              height: "40px",
              padding: "0 20px",
              borderRadius: "20px",
              background: "rgba(22, 15, 9, 0.82)",
              backdropFilter: "blur(10px)",
              border: "1px solid rgba(160, 60, 40, 0.2)",
              color: "rgba(210, 100, 75, 0.55)",
              fontSize: "13px",
              letterSpacing: "0.04em",
              cursor: "pointer",
              transition: "border-color 0.3s ease, color 0.3s ease",
            }}
          >
            leave room
          </button>
        </div>
      )}

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

          <ControlBtn
            onClick={handleLeaveRoom}
            active={false}
            title="Leave room"
            severe
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M5.636 5.636a9 9 0 1012.728 12.728M12 3v9m0 0l3-3m-3 3L9 9" />
            </svg>
          </ControlBtn>
        </div>
      )}

      {/* Chat — always-visible transparent overlay on the right */}
      <div
        className="absolute top-0 right-0 h-full z-20"
        style={{ width: "276px" }}
      >
        <Chat
          items={feedItems}
          myName={localName}
          role={role}
          seatsAvailable={seatsAvailable}
          onSend={handleSendChat}
          onTakeSeat={handleTakeSeat}
          onLeaveRoom={handleLeaveRoom}
          transparent
        />
      </div>
    </div>
  );
}

// ─── Shared style objects ────────────────────────────────────────────────────

const iconBtn: React.CSSProperties = {
  width: "32px",
  height: "32px",
  borderRadius: "50%",
  background: "transparent",
  border: "none",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "rgba(215, 180, 125, 0.82)",
  cursor: "pointer",
  transition: "color 0.25s ease",
};

function ControlBtn({
  children,
  onClick,
  active,
  danger,
  severe,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active: boolean;
  danger?: boolean;
  severe?: boolean;
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
          : severe
          ? "rgba(180, 40, 40, 0.22)"
          : "rgba(22, 15, 9, 0.78)",
        backdropFilter: "blur(10px)",
        border: severe ? "1px solid rgba(200, 60, 60, 0.25)" : "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: active
          ? "#e74c3c"
          : severe
          ? "rgba(220, 100, 80, 0.75)"
          : danger
          ? "rgba(220, 160, 100, 0.5)"
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


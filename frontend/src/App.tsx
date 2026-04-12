import { useCallback, useEffect, useRef, useState } from "react";
import { socket } from "./socket";
import { webrtc } from "./webrtc";
import type { ChatMessage, Role, Seat, ServerMessage } from "./types";
import LandingLobby from "./components/LandingLobby";
import VideoGrid from "./components/VideoGrid";
import Chat from "./components/Chat";

interface RoomState {
  seats: Array<Seat | null>;
  audience_count: number;
  your_session_id: string;
  your_role: Role;
}

export default function App() {
  const [joined, setJoined] = useState(false);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [streams, setStreams] = useState<Map<string, MediaStream>>(
    () => new Map<string, MediaStream>()
  );
  const localStreamRef = useRef<MediaStream | null>(null);
  const offeredTo = useRef<Set<string>>(new Set());
  const roomStateRef = useRef<RoomState | null>(null);

  // -----------------------------------------------------------------------
  // Wire webrtc stream callback once
  // -----------------------------------------------------------------------
  useEffect(() => {
    webrtc.setStreamCallback((sessionId, stream) => {
      setStreams((prev) => {
        const next = new Map<string, MediaStream>(prev);
        if (stream) next.set(sessionId, stream);
        else next.delete(sessionId);
        return next;
      });
    });
  }, []);

  // -----------------------------------------------------------------------
  // Handle server messages — registered on mount so it's ready before any
  // offer/answer/ICE can arrive.
  // -----------------------------------------------------------------------
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
          // Audience: create receive-only offers to every participant so we can
          // watch their streams without sending any media ourselves.
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
        setMessages((prev) => [...prev, msg.payload]);
        break;
      case "chat_history":
        setMessages(msg.payload.messages);
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
        alert(`Could not take seat: ${msg.payload.reason}`);
        break;
    }
  }, []);

  useEffect(() => {
    socket.connect();
    return socket.onMessage(handleMessage);
  }, [handleMessage]);

  // -----------------------------------------------------------------------
  // Join
  // -----------------------------------------------------------------------
  const handleJoin = useCallback(async (name: string, role: Role) => {
    socket.connect();

    if (role === "participant") {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: true,
        });
        localStreamRef.current = stream;
        webrtc.setLocalStream(stream);
        setStreams((prev) => new Map<string, MediaStream>(prev).set("__local__", stream));
      } catch (err) {
        const isSecurityError =
          err instanceof DOMException &&
          (err.name === "NotAllowedError" || err.name === "SecurityError");
        const msg = isSecurityError
          ? "Camera access requires HTTPS on mobile. Joining as audience instead."
          : "Could not access camera/mic. Joining as audience instead.";
        alert(msg);
        role = "audience";
      }
    }

    // One-shot: on first room_state after join, transition to main view and
    // kick off WebRTC offers to any existing participants.
    const unsub = socket.onMessage(async (msg: ServerMessage) => {
      if (msg.type !== "room_state") return;
      unsub();
      roomStateRef.current = msg.payload;
      setRoomState(msg.payload);
      setJoined(true);
      if (msg.payload.your_role === "participant") {
        for (const seat of msg.payload.seats) {
          if (!seat || seat.session_id === msg.payload.your_session_id) continue;
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

  // -----------------------------------------------------------------------
  // Participant actions
  // -----------------------------------------------------------------------
  const handleSendChat = useCallback((content: string) => {
    socket.send({ type: "chat", payload: { content } });
  }, []);

  const handleToggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach((t) => { t.enabled = !next; });
    setMuted(next);
  }, [muted]);

  const handleToggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !cameraOff;
    stream.getVideoTracks().forEach((t) => { t.enabled = !next; });
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
    setJoined(false);
    setRoomState(null);
    setMessages([]);
    setStreams(new Map());
    setMuted(false);
    setCameraOff(false);
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

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
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

  const role = roomState.your_role;
  const seatsAvailable = seatsOccupied < 8;

  const gridStreams = new Map(streams);
  if (localStreamRef.current && roomState.your_session_id) {
    gridStreams.set(roomState.your_session_id, localStreamRef.current);
    gridStreams.delete("__local__");
  }

  return (
    // Mobile: column layout (video top, chat bottom).
    // Desktop lg+: row layout (video left, chat right sidebar).
    <div className="flex flex-col lg:flex-row h-dvh bg-gray-950 text-gray-100 overflow-hidden">

      {/* Video area */}
      <div className="flex flex-col flex-1 min-h-0 min-w-0 p-3 gap-3">
        <div className="flex-1 min-h-0 overflow-auto">
          <VideoGrid
            seats={roomState.seats}
            streams={gridStreams}
            localSessionId={roomState.your_session_id}
          />
        </div>

        {/* Participant controls */}
        {role === "participant" && (
          <div className="flex-shrink-0 flex justify-center gap-2 sm:gap-3 pb-1">
            {/* Mute */}
            <button
              onClick={handleToggleMute}
              title={muted ? "Unmute" : "Mute mic"}
              className={`flex items-center gap-1.5 rounded-full px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-colors ${
                muted ? "bg-red-600 hover:bg-red-500 text-white" : "bg-gray-700 hover:bg-gray-600 text-gray-100"
              }`}
            >
              {muted ? (
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                </svg>
              )}
              <span className="hidden sm:inline">{muted ? "Unmute" : "Mute"}</span>
            </button>

            {/* Camera toggle */}
            <button
              onClick={handleToggleCamera}
              title={cameraOff ? "Turn camera on" : "Turn camera off"}
              className={`flex items-center gap-1.5 rounded-full px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium transition-colors ${
                cameraOff ? "bg-red-600 hover:bg-red-500 text-white" : "bg-gray-700 hover:bg-gray-600 text-gray-100"
              }`}
            >
              {cameraOff ? (
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M12 18.75H4.5a2.25 2.25 0 01-2.25-2.25V9m12.841 8.909L6.75 6.75m0 0L4.5 4.5M6.75 6.75l-.75-.75" />
                </svg>
              ) : (
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
                </svg>
              )}
              <span className="hidden sm:inline">{cameraOff ? "Camera on" : "Camera off"}</span>
            </button>

            {/* Leave */}
            <button
              onClick={handleLeaveSeat}
              title="Leave seat"
              className="flex items-center gap-1.5 rounded-full px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium bg-gray-700 hover:bg-red-600 text-gray-100 transition-colors"
            >
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
              <span className="hidden sm:inline">Leave</span>
            </button>
          </div>
        )}
      </div>

      {/* Chat — full width strip on mobile, fixed sidebar on desktop */}
      <div className="h-52 sm:h-64 lg:h-auto lg:w-80 flex-shrink-0 border-t lg:border-t-0 lg:border-l border-gray-800 flex flex-col min-h-0">
        <Chat
          messages={messages}
          role={role}
          seatsOccupied={seatsOccupied}
          audienceCount={roomState.audience_count}
          seatsAvailable={seatsAvailable}
          onSend={handleSendChat}
          onTakeSeat={handleTakeSeat}
          onLeaveRoom={handleLeaveRoom}
        />
      </div>
    </div>
  );
}

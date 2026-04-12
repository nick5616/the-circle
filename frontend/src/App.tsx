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
  // streams: session_id → MediaStream (remote) | "local" placeholder
  const [streams, setStreams] = useState<Map<string, MediaStream>>(
    () => new Map<string, MediaStream>()
  );
  const localStreamRef = useRef<MediaStream | null>(null);

  // Track which participant session_ids we have already sent offers to
  const offeredTo = useRef<Set<string>>(new Set());

  // Ref so handleMessage can read current roomState without being a dependency
  const roomStateRef = useRef<RoomState | null>(null);

  // -----------------------------------------------------------------------
  // Wire webrtc stream callback once
  // -----------------------------------------------------------------------
  useEffect(() => {
    webrtc.setStreamCallback((sessionId, stream) => {
      setStreams((prev: Map<string, MediaStream>) => {
        const next = new Map<string, MediaStream>(prev);
        if (stream) next.set(sessionId, stream);
        else next.delete(sessionId);
        return next;
      });
    });
  }, []);

  // -----------------------------------------------------------------------
  // Handle server messages
  // -----------------------------------------------------------------------
  const handleMessage = useCallback(
    async (msg: ServerMessage) => {
      switch (msg.type) {
        case "room_state": {
          const prev = roomStateRef.current;
          roomStateRef.current = msg.payload;
          setRoomState(msg.payload);

          // If we are a participant, send offers to any new peers we haven't yet
          if (msg.payload.your_role === "participant") {
            for (const seat of msg.payload.seats) {
              if (!seat) continue;
              if (seat.session_id === msg.payload.your_session_id) continue;
              if (offeredTo.current.has(seat.session_id)) continue;
              offeredTo.current.add(seat.session_id);
              // Only the peer with the smaller session_id initiates, avoiding glare
              if (msg.payload.your_session_id < seat.session_id) {
                await webrtc.createOffer(seat.session_id);
              }
            }
          }

          // Close connections for peers that dropped off
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
    },
    []
  );

  // Register handleMessage on mount so offers/answers don't arrive before
  // the handler is ready, and so the lobby can show live room counts.
  useEffect(() => {
    socket.connect();
    return socket.onMessage(handleMessage);
  }, [handleMessage]);

  // -----------------------------------------------------------------------
  // Join
  // -----------------------------------------------------------------------
  const handleJoin = useCallback(async (name: string, role: Role) => {
    // Connect the socket immediately so it's open by the time getUserMedia resolves
    socket.connect();

    if (role === "participant") {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        localStreamRef.current = stream;
        webrtc.setLocalStream(stream);
        setStreams((prev: Map<string, MediaStream>) => new Map<string, MediaStream>(prev).set("__local__", stream));
      } catch {
        alert("Could not access camera/mic. Joining as audience instead.");
        role = "audience";
      }
    }

    const unsub = socket.onMessage(async (msg: ServerMessage) => {
      if (msg.type !== "room_state") return;
      unsub();
      // Set both roomState and joined together so the main view renders immediately
      roomStateRef.current = msg.payload;
      setRoomState(msg.payload);
      setJoined(true);
      // Create offers to any participants already in the room
      if (msg.payload.your_role === "participant") {
        for (const seat of msg.payload.seats) {
          if (!seat || seat.session_id === msg.payload.your_session_id) continue;
          if (offeredTo.current.has(seat.session_id)) continue;
          offeredTo.current.add(seat.session_id);
          if (msg.payload.your_session_id < seat.session_id) {
            await webrtc.createOffer(seat.session_id);
          }
        }
      }
    });

    socket.send({ type: "join", payload: { name, role } });
  }, []);

  // -----------------------------------------------------------------------
  // Actions
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

  const handleLeaveSeat = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    webrtc.closeAll();
    setStreams(new Map());
    setMuted(false);
    socket.send({ type: "leave_seat" });
  }, []);

  const handleTakeSeat = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
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
  // Lobby (pre-join) state from first room_state snapshot
  // -----------------------------------------------------------------------
  const seatsOccupied = roomState
    ? roomState.seats.filter(Boolean).length
    : 0;

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  if (!joined || !roomState) {
    return (
      <LandingLobby
        seatsOccupied={seatsOccupied}
        audienceCount={roomState?.audience_count ?? 0}
        onJoin={handleJoin}
      />
    );
  }

  const role = roomState.your_role;
  const seatsAvailable = seatsOccupied < 8;

  // Build the streams map the grid expects: seats keyed by session_id + local
  const gridStreams = new Map(streams);
  if (localStreamRef.current && roomState.your_session_id) {
    gridStreams.set(roomState.your_session_id, localStreamRef.current);
    gridStreams.delete("__local__");
  }

  return (
    <div className="flex h-screen bg-gray-950 text-gray-100">
      {/* Left — Video Grid + Controls */}
      <div className="flex-1 min-w-0 p-4 flex flex-col gap-3">
        <VideoGrid
          seats={roomState.seats}
          streams={gridStreams}
          localSessionId={roomState.your_session_id}
        />
        {role === "participant" && (
          <div className="flex justify-center gap-3">
            <button
              onClick={handleToggleMute}
              title={muted ? "Unmute" : "Mute"}
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                muted
                  ? "bg-red-600 hover:bg-red-500 text-white"
                  : "bg-gray-700 hover:bg-gray-600 text-gray-100"
              }`}
            >
              {muted ? (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M17.25 9.75L19.5 12m0 0l2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                  </svg>
                  Unmute
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                  </svg>
                  Mute
                </>
              )}
            </button>
            <button
              onClick={handleLeaveSeat}
              title="Leave seat"
              className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium bg-gray-700 hover:bg-red-600 text-gray-100 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
              Leave Seat
            </button>
          </div>
        )}
      </div>

      {/* Right — Chat Sidebar */}
      <div className="w-80 flex-shrink-0 border-l border-gray-800 flex flex-col">
        <Chat
          messages={messages}
          role={role}
          seatsOccupied={seatsOccupied}
          audienceCount={roomState.audience_count}
          seatsAvailable={seatsAvailable}
          onSend={handleSendChat}
          onTakeSeat={handleTakeSeat}
        />
      </div>
    </div>
  );
}

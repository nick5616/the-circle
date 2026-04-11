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
  // streams: session_id → MediaStream (remote) | "local" placeholder
  const [streams, setStreams] = useState<Map<string, MediaStream>>(
    () => new Map<string, MediaStream>()
  );
  const localStreamRef = useRef<MediaStream | null>(null);

  // Track which participant session_ids we have already sent offers to
  const offeredTo = useRef<Set<string>>(new Set());

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
          const prev = roomState;
          setRoomState(msg.payload);

          // If we are a participant, send offers to any new peers we haven't yet
          if (msg.payload.your_role === "participant") {
            for (const seat of msg.payload.seats) {
              if (!seat) continue;
              if (seat.session_id === msg.payload.your_session_id) continue;
              if (offeredTo.current.has(seat.session_id)) continue;
              offeredTo.current.add(seat.session_id);
              await webrtc.createOffer(seat.session_id);
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
    [roomState]
  );

  useEffect(() => {
    if (!joined) return;
    socket.connect();
    const unsub = socket.onMessage(handleMessage);
    return unsub;
  }, [joined, handleMessage]);

  // -----------------------------------------------------------------------
  // Join
  // -----------------------------------------------------------------------
  const handleJoin = useCallback(async (name: string, role: Role) => {
    socket.connect();
    const unsub = socket.onMessage(async (msg) => {
      // One-shot: wait for room_state to confirm we are connected
      if (msg.type === "room_state") {
        unsub();
        setJoined(true);
      }
    });

    if (role === "participant") {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        localStreamRef.current = stream;
        webrtc.setLocalStream(stream);
        // Show local video immediately
        setStreams((prev: Map<string, MediaStream>) => new Map<string, MediaStream>(prev).set("__local__", stream));
      } catch {
        alert("Could not access camera/mic. Joining as audience instead.");
        role = "audience";
      }
    }

    socket.send({ type: "join", payload: { name, role } });
  }, []);

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------
  const handleSendChat = useCallback((content: string) => {
    socket.send({ type: "chat", payload: { content } });
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
      {/* Left — Video Grid */}
      <div className="flex-1 min-w-0 p-4">
        <VideoGrid
          seats={roomState.seats}
          streams={gridStreams}
          localSessionId={roomState.your_session_id}
        />
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

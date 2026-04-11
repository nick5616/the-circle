import { useEffect, useRef, useState } from "react";
import type { ChatMessage, Role } from "../types";
import SeatBar from "./SeatBar";

interface Props {
  messages: ChatMessage[];
  role: Role;
  seatsOccupied: number;
  audienceCount: number;
  seatsAvailable: boolean;
  onSend: (content: string) => void;
  onTakeSeat: () => void;
}

const MAX_SEATS = 8;

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export default function Chat({ messages, role, seatsOccupied, audienceCount, seatsAvailable, onSend, onTakeSeat }: Props) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function submit() {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
          <span className="font-semibold text-sm">Chat</span>
          {role === "audience" && seatsAvailable && (
            <button
              onClick={onTakeSeat}
              className="text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded px-2 py-1 transition-colors"
            >
              Take a Seat
            </button>
          )}
        </div>
        <SeatBar
          seatsOccupied={seatsOccupied}
          maxSeats={MAX_SEATS}
          audienceCount={audienceCount}
        />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3 min-h-0">
        {messages.map((msg, i) => (
          <div key={i} className="flex flex-col gap-0.5">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold text-indigo-400">{msg.sender}</span>
              <span className="text-xs text-gray-600">{formatTime(msg.timestamp)}</span>
            </div>
            <p className="text-sm text-gray-200 break-words">{msg.content}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-gray-800 p-3 flex gap-2">
        <input
          type="text"
          placeholder="Say something…"
          maxLength={1000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          onClick={submit}
          disabled={!draft.trim()}
          className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg px-3 py-2 text-sm font-semibold transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
}

import { useState } from "react";
import type { Role } from "../types";

interface Props {
  seatsOccupied: number;
  audienceCount: number;
  onJoin: (name: string, role: Role) => void;
}

const MAX_SEATS = 8;

export default function LandingLobby({ seatsOccupied, audienceCount, onJoin }: Props) {
  const [name, setName] = useState("");
  const [joining, setJoining] = useState(false);

  const trimmed = name.trim();
  const seatsFull = seatsOccupied >= MAX_SEATS;

  async function join(role: Role) {
    if (!trimmed || joining) return;
    setJoining(true);
    await onJoin(trimmed, role);
    // stays true — page unmounts once joined
  }

  return (
    <div className="min-h-dvh bg-gray-950 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 sm:p-8 w-full max-w-sm flex flex-col gap-5">
        <div className="text-center">
          <h1 className="text-2xl sm:text-3xl font-bold text-white">The Circle</h1>
          <p className="text-gray-400 mt-1 text-sm">One room. Whole world.</p>
        </div>

        {/* Live counts */}
        <div className="flex justify-between text-sm text-gray-400 bg-gray-800 rounded-lg px-4 py-3">
          <span>
            <span className="text-white font-semibold">{seatsOccupied}</span>
            <span> / {MAX_SEATS} on cam</span>
          </span>
          <span>
            <span className="text-white font-semibold">{audienceCount}</span>
            <span> watching</span>
          </span>
        </div>

        {/* Name input */}
        <input
          type="text"
          placeholder="Your display name"
          maxLength={50}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && join("audience")}
          autoComplete="off"
          className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-base"
        />

        {/* Join buttons */}
        <div className="flex flex-col gap-3">
          <button
            onClick={() => join("participant")}
            disabled={!trimmed || seatsFull || joining}
            className="bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-3 text-sm sm:text-base transition-colors"
          >
            {seatsFull ? "Seats Full" : "Join as Participant"}
          </button>
          <button
            onClick={() => join("audience")}
            disabled={!trimmed || joining}
            className="bg-gray-700 hover:bg-gray-600 active:bg-gray-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-3 text-sm sm:text-base transition-colors"
          >
            Watch as Audience
          </button>
        </div>

        {joining && (
          <p className="text-center text-sm text-gray-400 animate-pulse">Connecting…</p>
        )}

        <p className="text-center text-xs text-gray-600">
          Camera requires HTTPS on mobile. Audience mode works everywhere.
        </p>
      </div>
    </div>
  );
}

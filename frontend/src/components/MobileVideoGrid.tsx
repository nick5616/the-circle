import { useEffect, useRef, useState } from "react";
import type { Seat } from "../types";
import VideoTile from "./VideoTile";

interface Props {
  seats: Array<Seat | null>;
  streams: Map<string, MediaStream>;
  localSessionId: string;
  audioLevels: Map<string, number>;
  localCameraOff: boolean;
}

const EXIT_MS = 280;
const SPEAK_THRESHOLD = 0.12;
const SPEAK_LINGER_MS = 1200; // keep tile expanded this long after speaking stops

export default function MobileVideoGrid({
  seats,
  streams,
  localSessionId,
  audioLevels,
  localCameraOff,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [exitingSeats, setExitingSeats] = useState<Map<string, Seat>>(new Map());
  // Tracks the last timestamp each seat spoke above threshold
  const lastSpokeRef = useRef<Map<string, number>>(new Map());
  // Trigger re-renders for linger timeout
  const [speakTick, setSpeakTick] = useState(0);
  const lingerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prevOccupiedRef = useRef<Seat[]>([]);
  const occupiedRef = useRef<Seat[]>([]);

  const occupied = seats.filter(Boolean) as Seat[];
  occupiedRef.current = occupied;

  // Exit animation
  useEffect(() => {
    const prev = prevOccupiedRef.current;
    const currIds = new Set(occupied.map((s) => s.session_id));
    const departing = prev.filter(
      (s) => !currIds.has(s.session_id) && !exitingSeats.has(s.session_id)
    );

    if (departing.length > 0) {
      setExitingSeats((e) => {
        const next = new Map(e);
        departing.forEach((s) => next.set(s.session_id, s));
        return next;
      });
      const ids = departing.map((s) => s.session_id);
      const t = setTimeout(() => {
        setExitingSeats((e) => {
          const next = new Map(e);
          ids.forEach((id) => next.delete(id));
          return next;
        });
        prevOccupiedRef.current = occupiedRef.current;
      }, EXIT_MS);
      return () => clearTimeout(t);
    } else {
      prevOccupiedRef.current = occupied;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seats]);

  // Clear expandedId when that seat leaves
  useEffect(() => {
    if (!expandedId) return;
    const stillPresent = occupied.some((s) => s.session_id === expandedId);
    if (!stillPresent && !exitingSeats.has(expandedId)) {
      setExpandedId(null);
    }
  }, [occupied, expandedId, exitingSeats]);

  // Update speak timestamps and schedule linger re-render
  useEffect(() => {
    const now = Date.now();
    for (const seat of occupied) {
      const level = audioLevels.get(seat.session_id) ?? 0;
      if (level > SPEAK_THRESHOLD) {
        lastSpokeRef.current.set(seat.session_id, now);
      }
    }

    // Schedule a tick after the linger period so we collapse tiles that stopped speaking
    if (lingerTimerRef.current) clearTimeout(lingerTimerRef.current);
    lingerTimerRef.current = setTimeout(() => {
      setSpeakTick((t) => t + 1);
    }, SPEAK_LINGER_MS + 50);

    return () => {
      if (lingerTimerRef.current) clearTimeout(lingerTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioLevels]);

  // speakTick is consumed just to force a re-render
  void speakTick;

  if (occupied.length === 0 && exitingSeats.size === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <p
          style={{
            color: "rgba(200, 160, 100, 0.22)",
            fontSize: "13px",
            letterSpacing: "0.06em",
          }}
        >
          waiting for the circle to fill
        </p>
      </div>
    );
  }

  const count = occupied.length;

  // Layout:
  //   1–3 people  → single column, full-width squares
  //   4, 6, 8     → 2-column grid of squares
  //   5, 7        → first tile full-width, rest in 2-column grid
  const singleCol = count <= 3;
  const oddGrid = count === 5 || count === 7;

  // Find who is speaking: prefer the loudest active speaker; fall back to the
  // most recently-active speaker within the linger window.
  const now = Date.now();
  let loudestId: string | null = null;
  let loudestLevel = 0;

  for (const seat of occupied) {
    const level = audioLevels.get(seat.session_id) ?? 0;
    if (level > SPEAK_THRESHOLD && level > loudestLevel) {
      loudestLevel = level;
      loudestId = seat.session_id;
    }
  }

  // No one currently above threshold — use linger to hold the last speaker
  if (!loudestId) {
    let mostRecentTime = 0;
    for (const seat of occupied) {
      const lastSpoke = lastSpokeRef.current.get(seat.session_id) ?? 0;
      if (now - lastSpoke < SPEAK_LINGER_MS && lastSpoke > mostRecentTime) {
        mostRecentTime = lastSpoke;
        loudestId = seat.session_id;
      }
    }
  }

  const exitingOnly = [...exitingSeats.values()].filter(
    (s) => !new Set(occupied.map((x) => x.session_id)).has(s.session_id)
  );
  const allSeats = [...occupied, ...exitingOnly];

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflowY: "auto",
        overflowX: "hidden",
        scrollbarWidth: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "8px",
          padding: "12px 12px 130px 12px",
          boxSizing: "border-box",
          width: "100%",
          alignContent: "flex-start",
        }}
      >
        {allSeats.map((seat) => {
          const isExiting = exitingSeats.has(seat.session_id);
          const isLocal = seat.session_id === localSessionId;
          const stream = streams.get(seat.session_id);
          const hasVideo = isLocal ? !localCameraOff : !!stream;
          const audioLevel = audioLevels.get(seat.session_id) ?? 0;

          const isSpeaking = seat.session_id === loudestId && !isExiting;
          const isExpanded = expandedId === seat.session_id && !isExiting;

          const occupiedIndex = occupied.findIndex(
            (s) => s.session_id === seat.session_id
          );
          const isFirstTile = occupiedIndex === 0;

          const isFullWidth =
            singleCol ||
            (oddGrid && isFirstTile) ||
            isExpanded ||
            isSpeaking;

          return (
            <div
              key={seat.session_id}
              style={{
                flexShrink: 0,
                flexGrow: 0,
                width: isFullWidth ? "100%" : "calc(50% - 4px)",
                aspectRatio: isFullWidth ? "16/9" : "1/1",
                transition: isExiting
                  ? undefined
                  : "width 0.38s cubic-bezier(0.34, 1.56, 0.64, 1), aspect-ratio 0.38s cubic-bezier(0.34, 1.56, 0.64, 1)",
                cursor: isExiting ? "default" : "pointer",
                WebkitTapHighlightColor: "transparent",
              }}
              onClick={() => {
                if (!isExiting) {
                  setExpandedId((prev) =>
                    prev === seat.session_id ? null : seat.session_id
                  );
                }
              }}
            >
              <div
                className={isExiting ? "animate-tile-out" : "animate-tile-in"}
                style={{ width: "100%", height: "100%" }}
              >
                <VideoTile
                  name={seat.name}
                  stream={stream}
                  isLocal={isLocal}
                  hasVideo={hasVideo}
                  audioLevel={audioLevel}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

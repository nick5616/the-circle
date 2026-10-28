import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { audioLevels } from "../audio";
import { hashNameToColor } from "../fireColors";
import type { PeerInfo, Seat } from "../types";
import type { Rect } from "../layout";

interface Props {
  seat: Seat;
  rect: Rect;
  leaving: boolean;
  stream?: MediaStream;
  isLocal: boolean;
  camOn: boolean;
  micOn: boolean;
  peer?: PeerInfo;
  register: (sid: string, el: HTMLElement | null) => void;
}

const QUALITY_DOTS = { good: 3, fair: 2, poor: 1, unknown: 0 } as const;
const QUALITY_COLOR = { good: "#ffc46b", fair: "#ff9a5a", poor: "#ff8fab", unknown: "transparent" } as const;

function Tile({ seat, rect, leaving, stream, isLocal, camOn, micOn, peer, register }: Props) {
  const color = hashNameToColor(seat.name).hex;
  const sid = seat.session_id;
  const outer = useRef<HTMLDivElement | null>(null);
  const videoEl = useRef<HTMLVideoElement | null>(null);
  const [live, setLive] = useState(false); // video element is actually showing frames
  const [stalled, setStalled] = useState(false);
  const [mirrored, setMirrored] = useState(true);

  const setOuter = useCallback(
    (el: HTMLDivElement | null) => {
      outer.current = el;
      register(sid, el);
    },
    [register, sid]
  );

  useEffect(() => {
    if (!outer.current) return;
    return audioLevels.bind(sid, outer.current);
  }, [sid]);

  const hasVideoTrack = !!stream?.getVideoTracks().length;
  const wantVideo = camOn && hasVideoTrack;

  // Attach the stream; track when frames are really arriving
  useEffect(() => {
    const v = videoEl.current;
    if (!v) return;
    setLive(false);
    v.srcObject = stream ?? null;
    if (!stream) return;
    const check = () => setLive(v.videoWidth > 0 && v.readyState >= 2);
    v.addEventListener("loadeddata", check);
    v.addEventListener("resize", check);
    v.addEventListener("playing", check);
    v.play().catch(() => {});
    return () => {
      v.removeEventListener("loadeddata", check);
      v.removeEventListener("resize", check);
      v.removeEventListener("playing", check);
    };
  }, [stream, wantVideo]);

  // Frozen-video watchdog: no new frames for 3s while the camera is supposedly on
  useEffect(() => {
    const v = videoEl.current;
    if (!v || !wantVideo || isLocal) {
      setStalled(false);
      return;
    }
    let lastT = -1;
    let lastChange = Date.now();
    const id = setInterval(() => {
      if (v.currentTime !== lastT) {
        lastT = v.currentTime;
        lastChange = Date.now();
        setStalled(false);
      } else if (Date.now() - lastChange > 3000) {
        setStalled(true);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [wantVideo, isLocal, stream]);

  const showVideo = wantVideo && live;
  const health = isLocal ? "connected" : peer?.health ?? "connecting";

  let status: string | null = null;
  if (seat.away) status = "reconnecting";
  else if (!isLocal && health === "reconnecting") status = "reconnecting";
  else if (!isLocal && health === "failed") status = "connection lost, retrying";
  else if (!isLocal && health === "connecting" && !leaving) status = "connecting";
  else if (!isLocal && wantVideo && stalled) status = "video paused";

  const quality = isLocal ? "unknown" : peer?.quality ?? "unknown";
  const style = {
    "--c": color,
    width: rect.w,
    height: rect.h,
    transform: `translate(${rect.x}px, ${rect.y}px)`,
  } as CSSProperties;

  return (
    <div
      ref={setOuter}
      className="tile"
      style={style}
      data-testid="tile"
      data-sid={sid}
      data-cam={showVideo ? "on" : "off"}
      data-leaving={leaving}
      data-health={health}
    >
      <div className="tile-body">
        <video
          ref={videoEl}
          autoPlay
          playsInline
          muted
          data-live={showVideo}
          style={isLocal && mirrored ? { transform: "scaleX(-1)" } : undefined}
        />
        {!showVideo && (
          <div className="presence">
            <span className="presence-initial display">{seat.name.slice(0, 1).toLowerCase()}</span>
          </div>
        )}

        {quality !== "unknown" && (
          <div className="signal" title={`connection: ${quality}`}>
            {[0, 1, 2].map((i) => (
              <i key={i} style={i < QUALITY_DOTS[quality] ? { background: QUALITY_COLOR[quality] } : undefined} />
            ))}
          </div>
        )}

        {isLocal && showVideo && (
          <button
            onClick={() => setMirrored((m) => !m)}
            title="mirror my preview"
            className="hand"
            style={{
              position: "absolute", top: 8, right: 8, zIndex: 2, border: "none", cursor: "pointer",
              padding: "0 9px 1px", borderRadius: 999, fontSize: 17, color: "var(--ink-2)",
              background: "rgba(18,10,8,0.5)", backdropFilter: "blur(6px)",
            }}
          >
            {mirrored ? "mirror ✓" : "mirror"}
          </button>
        )}

        <div className="nametag">
          <i className="flame-dot" />
          <span>{seat.name}{isLocal ? " (you)" : ""}</span>
          {!micOn && <MicOffIcon />}
        </div>

        {status && !leaving && (
          <div className="tile-status">
            <span>{status}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function MicOffIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--rose)" strokeWidth="2.2" strokeLinecap="round" aria-label="muted">
      <path d="M9 9v2a3 3 0 0 0 5.1 2.1M15 10V5a3 3 0 0 0-5.7-1.3" />
      <path d="M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 11 5.7M12 18v3M3 3l18 18" />
    </svg>
  );
}

export default memo(Tile);

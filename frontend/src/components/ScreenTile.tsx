import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { hashNameToColor } from "../fireColors";
import type { Rect } from "../layout";

interface Props {
  sid: string;
  name: string;
  stream?: MediaStream;
  isLocal: boolean;
  rect: Rect;
  others: { sid: string; name: string }[]; // other people sharing right now
  onPick: (sid: string) => void;
  onStop: () => void;
}

// The shared screen, front and center. Video is always muted here: tab audio
// plays through AudioSink like voices do, so re-mounting this never cuts sound.
export default function ScreenTile({ sid, name, stream, isLocal, rect, others, onPick, onStop }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [live, setLive] = useState(false);
  const color = hashNameToColor(name).hex;

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    setLive(false);
    v.srcObject = stream ?? null;
    if (!stream) return;
    const check = () => setLive(v.videoWidth > 0 && v.readyState >= 2);
    v.addEventListener("loadeddata", check);
    v.addEventListener("resize", check);
    v.addEventListener("playing", check);
    v.play().catch(() => {});
    // A share restarting reuses the same receiver track, which unmutes rather than re-adding
    const tracks = stream.getVideoTracks();
    const replay = () => v.play().then(check).catch(() => {});
    tracks.forEach((t) => t.addEventListener("unmute", replay));
    return () => {
      v.removeEventListener("loadeddata", check);
      v.removeEventListener("resize", check);
      v.removeEventListener("playing", check);
      tracks.forEach((t) => t.removeEventListener("unmute", replay));
    };
  }, [stream, sid]);

  const fullscreen = () => {
    const el = wrap.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  };

  return (
    <div
      className="tile"
      data-testid="screen-tile"
      data-sid={sid}
      data-live={live}
      style={{ "--c": color, width: rect.w, height: rect.h, transform: `translate(${rect.x}px, ${rect.y}px)` } as CSSProperties}
    >
      <div ref={wrap} className="tile-body screen-body" onDoubleClick={fullscreen}>
        <video ref={video} autoPlay playsInline muted data-live={live} />
        {!live && (
          <div className="tile-status" style={{ background: "transparent" }}>
            <span>{isLocal ? "starting your share" : `waiting for ${name}'s screen`}</span>
          </div>
        )}

        <div className="nametag">
          <i className="flame-dot" />
          <span>{isLocal ? "you're sharing your screen" : `${name}'s screen`}</span>
        </div>

        <div style={{ position: "absolute", bottom: 10, right: 10, display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 6, zIndex: 3, maxWidth: "60%" }}>
          {others.map((o) => (
            <button key={o.sid} className="chip" onClick={() => onPick(o.sid)} title={`watch ${o.name}'s screen instead`}>
              <i className="flame-dot" style={{ "--c": hashNameToColor(o.name).hex } as CSSProperties} />
              {o.name}'s screen
            </button>
          ))}
          {isLocal && (
            <button className="chip chip-hot" data-testid="stop-share" onClick={onStop}>
              stop sharing
            </button>
          )}
          <button className="chip" onClick={fullscreen} aria-label="fullscreen" title="fullscreen (or double-click)">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

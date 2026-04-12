import { useCallback } from "react";
import { hashNameToColor } from "../fireColors";

interface Props {
  name?: string;
  stream?: MediaStream;
  isLocal?: boolean;
  hasVideo?: boolean;   // true = render video element, false = render presence state
  isSpeaking?: boolean;
}

export default function VideoTile({
  name,
  stream,
  isLocal,
  hasVideo,
  isSpeaking,
}: Props) {
  const color = name ? hashNameToColor(name) : null;

  const videoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      if (el) el.srcObject = stream ?? null;
    },
    [stream]
  );

  const glowBase = color
    ? `0 0 0 1.5px ${color.hex}38, 0 0 18px 4px ${color.hex}16`
    : "none";
  const glowSpeaking = color
    ? `0 0 0 2px ${color.hex}70, 0 0 28px 8px ${color.hex}35`
    : "none";

  return (
    <div
      className="relative overflow-hidden w-full h-full"
      style={{
        borderRadius: "11px",
        backgroundColor: "#0e0a07",
        boxShadow: isSpeaking ? glowSpeaking : glowBase,
        transform: isSpeaking ? "scale(1.024)" : "scale(1)",
        transition:
          "box-shadow 0.28s ease, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)",
        zIndex: isSpeaking ? 1 : 0,
      }}
    >
      {hasVideo && stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className="w-full h-full object-cover"
          style={isLocal ? { transform: "scaleX(-1)" } : undefined}
        />
      ) : (
        // Camera-off presence state — ambient fire-color pulse, not a gray box
        <div className="absolute inset-0 flex items-center justify-center">
          {color && (
            <div
              className="absolute inset-0 animate-fire-breathe"
              style={{
                background: `radial-gradient(circle at 50% 50%, ${color.hex}20 0%, transparent 62%)`,
              }}
            />
          )}
          <span
            style={{
              fontSize: "clamp(20px, 4vw, 36px)",
              fontWeight: 500,
              color: color ? color.hex + "bb" : "rgba(200, 165, 120, 0.38)",
              position: "relative",
              zIndex: 1,
              textTransform: "uppercase",
              letterSpacing: "0.02em",
            }}
          >
            {name ? name[0] : "·"}
          </span>
        </div>
      )}

      {/* Name label — organic, not a uniform pill */}
      {name && (
        <div
          style={{
            position: "absolute",
            bottom: "8px",
            left: "8px",
            backgroundColor: "rgba(8, 5, 3, 0.62)",
            backdropFilter: "blur(6px)",
            // Intentionally uneven corners — hand-placed feel
            borderRadius: "5px 9px 9px 5px",
            padding: "3px 8px 3px 7px",
            fontSize: "11px",
            color: "rgba(230, 200, 162, 0.72)",
            letterSpacing: "0.025em",
            maxWidth: "68%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
          {isLocal && (
            <span
              style={{
                color: color ? color.hex + "88" : "rgba(180,150,110,0.5)",
                marginLeft: "5px",
                fontSize: "10px",
              }}
            >
              you
            </span>
          )}
        </div>
      )}

      {/* Speaking ring pulse — appears on top of the glow ring */}
      {isSpeaking && color && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            borderRadius: "11px",
            boxShadow: `inset 0 0 0 1.5px ${color.hex}50`,
            animation: "glow-pulse 1.4s ease-in-out infinite",
          }}
        />
      )}
    </div>
  );
}

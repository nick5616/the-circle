import { useCallback } from "react";
import { hashNameToColor } from "../fireColors";

interface Props {
  name?: string;
  stream?: MediaStream;
  isLocal?: boolean;
  hasVideo?: boolean;   // true = render video element, false = render presence state
  audioLevel?: number;  // 0–1 perceptual loudness
}

// Convert 0-255 integer to two-digit hex
function toHex2(n: number) {
  return Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
}

export default function VideoTile({
  name,
  stream,
  isLocal,
  hasVideo,
  audioLevel = 0,
}: Props) {
  const color = name ? hashNameToColor(name) : null;

  const isSpeaking = audioLevel > 0.15;

  const videoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      if (el) el.srcObject = stream ?? null;
    },
    [stream]
  );

  // All visual effects scale continuously with audioLevel (0–1).
  // Silence: faint base ring + no outer glow. Loud: prominent ring + wide glow.
  const ringWidth = color ? (1.5 + audioLevel * 1).toFixed(2) : "0";
  const ringAlpha = color ? toHex2(38 + audioLevel * (144 - 38)) : "00";
  const outerBlur = (18 + audioLevel * 18).toFixed(1);
  const outerSpread = (4 + audioLevel * 6).toFixed(1);
  const outerAlpha = color ? toHex2(22 + audioLevel * 47) : "00";
  const boxShadow = color
    ? `0 0 0 ${ringWidth}px ${color.hex}${ringAlpha}, 0 0 ${outerBlur}px ${outerSpread}px ${color.hex}${outerAlpha}`
    : "none";

  // Scale grows with loudness, capped at the speaking max.
  const scale = (1 + audioLevel * 0.024).toFixed(4);

  // Inset glow alpha scales with perceptual level.
  const insetAlpha = color ? toHex2(audioLevel * 0.82 * 255) : "00";

  return (
    <div
      className="relative overflow-hidden w-full h-full"
      style={{
        borderRadius: "11px",
        backgroundColor: "#0e0a07",
        boxShadow,
        transform: `scale(${scale})`,
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

      {/* Speaking edge bleed — inset glow whose alpha tracks perceptual loudness.
          Fixed geometry keeps it near the edges; alpha does all the work. */}
      {audioLevel > 0.01 && color && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            borderRadius: "11px",
            boxShadow: `inset 0 0 18px 4px ${color.hex}${insetAlpha}`,
            zIndex: 10,
          }}
        />
      )}
    </div>
  );
}

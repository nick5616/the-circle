import type { CSSProperties } from "react";

export interface FloatingReaction {
  id: number;
  emoji: string;
  x: number;
  y: number;
  dx: number;
  rot: number;
}

// Emojis drift up from whoever sent them, like sparks off a log.
export default function Reactions({ items }: { items: FloatingReaction[] }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 26, pointerEvents: "none", overflow: "hidden" }}>
      {items.map((r) => (
        <span
          key={r.id}
          style={{
            position: "absolute", left: r.x - 18, top: r.y - 18, fontSize: 36, lineHeight: 1,
            filter: "drop-shadow(0 0 12px rgba(255,150,80,0.55))",
            animation: "float-emoji 2.6s cubic-bezier(0.2, 0.7, 0.3, 1) forwards",
            "--dx": `${r.dx}px`, "--rot": `${r.rot}deg`,
          } as CSSProperties}
        >
          {r.emoji}
        </span>
      ))}
    </div>
  );
}

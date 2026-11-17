import { memo, useLayoutEffect, useRef } from "react";

export interface FlyingToss {
  id: number;
  item: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export const TOSS_FLIGHT_MS = 780;
const SPLAT_MS = 520;

// Soft things lobbed across the room in a little arc, spinning, then going
// "splat" on the target's tile. The tile wobbling is handled by the caller.
export default function Tosses({ items, onDone }: { items: FlyingToss[]; onDone: (id: number) => void }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 27, pointerEvents: "none", overflow: "hidden" }}>
      {items.map((t) => <Flying key={t.id} toss={t} onDone={onDone} />)}
    </div>
  );
}

const Flying = memo(function Flying({ toss, onDone }: { toss: FlyingToss; onDone: (id: number) => void }) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { from, to } = toss;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const arc = Math.min(220, 60 + dist * 0.35);
    const spin = (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 360);
    const total = TOSS_FLIGHT_MS + SPLAT_MS;
    const frames: Keyframe[] = [];
    const N = 14;
    for (let k = 0; k <= N; k++) {
      const p = k / N;
      const x = from.x + (to.x - from.x) * p;
      const y = from.y + (to.y - from.y) * p - arc * 4 * p * (1 - p);
      const s = 0.7 + 0.5 * Math.sin(Math.PI * p);
      frames.push({
        offset: (p * TOSS_FLIGHT_MS) / total,
        transform: `translate(${x}px, ${y}px) rotate(${spin * p}deg) scale(${s})`,
        opacity: 1,
        easing: "linear",
      });
    }
    frames.push({ offset: (TOSS_FLIGHT_MS + 90) / total, transform: `translate(${to.x}px, ${to.y}px) rotate(${spin}deg) scale(1.9, 1.3)`, opacity: 1 });
    frames.push({ offset: 1, transform: `translate(${to.x}px, ${to.y + 18}px) rotate(${spin}deg) scale(2.1, 0.9)`, opacity: 0 });
    const a = el.animate(frames, { duration: total, fill: "forwards" });
    a.onfinish = () => onDone(toss.id);
    return () => a.cancel();
  }, [toss, onDone]);

  return (
    <span
      ref={ref}
      style={{
        position: "absolute", left: -20, top: -20, width: 40, height: 40, fontSize: 34, lineHeight: "40px", textAlign: "center",
        filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.45))", willChange: "transform",
        transform: `translate(${toss.from.x}px, ${toss.from.y}px)`,
      }}
    >
      {toss.item}
    </span>
  );
});

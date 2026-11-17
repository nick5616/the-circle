import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import type { Spark } from "../types";
import { hashNameToColor } from "../fireColors";

interface Props {
  spark: Spark;
  canDraw: boolean;
  quiet: boolean; // a screen is being shared: stay out of the way
  onAnother: () => void;
  onDismiss: () => void;
}

// A question card somebody pulled out of the fire. Everyone in the room sees
// the same one. After a while it tucks itself into a little chip so it stops
// covering faces; tap the chip to read it again.
export default function SparkCard({ spark, canDraw, quiet, onAnother, onDismiss }: Props) {
  const [tucked, setTucked] = useState(false);
  const c = hashNameToColor(spark.by).hex;

  useEffect(() => {
    setTucked(false);
    const t = setTimeout(() => setTucked(true), 40_000);
    return () => clearTimeout(t);
  }, [spark.id]);

  useEffect(() => {
    if (quiet) setTucked(true);
  }, [quiet]);

  return (
    <div
      style={{
        position: "fixed", top: "calc(60px + env(safe-area-inset-top))", left: 12, right: 12, zIndex: 24,
        display: "flex", justifyContent: "center", pointerEvents: "none",
      }}
    >
      {tucked ? (
        <button
          key={`chip-${spark.id}`}
          className="chip"
          data-testid="spark-chip"
          onClick={() => setTucked(false)}
          style={{ pointerEvents: "auto", animation: "rise-in 0.5s var(--spring) both", fontSize: 18, height: 34, padding: "0 14px 2px" }}
        >
          ✦ the question
        </button>
      ) : (
        <div
          key={spark.id}
          className="glass spark-card"
          data-testid="spark-card"
          style={{ pointerEvents: "auto", "--c": c } as CSSProperties}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="hand" style={{ fontSize: 18, color: c, lineHeight: 1 }}>
              ✦ {spark.by} pulled a card from the fire
            </span>
            <button
              onClick={onDismiss}
              aria-label="put the card down"
              style={{ marginLeft: "auto", border: "none", background: "transparent", color: "var(--ink-3)", cursor: "pointer", fontSize: 15, padding: 4 }}
            >
              ✕
            </button>
          </div>
          <p className="display" data-testid="spark-text" style={{ margin: "6px 0 10px", fontSize: "clamp(18px, 2.4vw, 23px)", fontStyle: "italic", lineHeight: 1.25, color: "var(--ink)" }}>
            {spark.text}
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {canDraw && (
              <button className="chip" data-testid="spark-another" onClick={onAnother}>
                draw another
              </button>
            )}
            <button className="chip" onClick={() => setTucked(true)}>
              tuck it away
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Ambient one-liner instead of alert(): appears softly, says its thing, fades.
export default function Notice({ text, onClick }: { text: string | null; onClick?: () => void }) {
  if (!text) return null;
  return (
    <div style={{ position: "fixed", left: 16, right: 16, top: "calc(64px + env(safe-area-inset-top))", zIndex: 45, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
      <div
        key={text}
        onClick={onClick}
        className="glass hand"
        data-testid="notice"
        style={{
          padding: "6px 18px 8px", borderRadius: 16, fontSize: 21, color: "var(--ink)", textAlign: "center",
          animation: "rise-in 0.5s var(--spring) both", cursor: onClick ? "pointer" : "default", pointerEvents: "auto", rotate: "-1deg",
        }}
      >
        {text}
      </div>
    </div>
  );
}

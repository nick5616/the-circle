import { useEffect, useState } from "react";
import { rtc } from "../rtc";
import { socket } from "../socket";
import { telemetry } from "../telemetry";
import type { Seat } from "../types";

// Live connection diagnostics. Open with ?debug in the URL or the ` key.
export default function DebugHud({ seats, myId, role }: { seats: Seat[]; myId: string; role: string | null }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const names = new Map(seats.map((s) => [s.session_id.slice(0, 6), s.name]));
  const peers = rtc.summary();
  const events = telemetry.events.slice(-14).reverse();

  return (
    <div
      data-testid="debug-hud"
      style={{
        position: "fixed", top: 12, left: 12, zIndex: 60, width: 460, maxWidth: "calc(100vw - 24px)", maxHeight: "70vh", overflow: "auto",
        padding: "10px 12px", borderRadius: 14, background: "rgba(10,6,4,0.86)", backdropFilter: "blur(10px)",
        font: "11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", color: "#f2dcc4",
      }}
    >
      <div>
        ws <b style={{ color: socket.status === "open" ? "#8cff6b" : "#ff8fab" }}>{socket.status}</b> · rtt {socket.rtt}ms · me {myId.slice(0, 6)} ({role ?? "lobby"})
      </div>
      <table style={{ width: "100%", marginTop: 6, borderCollapse: "collapse" }}>
        <thead style={{ color: "#b99" }}>
          <tr>
            <td>peer</td><td>side</td><td>state</td><td>q</td><td>path</td><td>rtt</td><td>loss</td><td>fps</td><td>in/out kbps</td><td>res</td>
          </tr>
        </thead>
        <tbody>
          {peers.map((p) => (
            <tr key={p.peer} style={{ color: p.state === "connected" ? undefined : "#ff8fab" }}>
              <td>{names.get(p.peer) ?? p.peer}</td>
              <td>{p.side}</td>
              <td>{p.state}</td>
              <td>{p.q}</td>
              <td>{p.path ?? "-"}</td>
              <td>{p.rtt ?? "-"}</td>
              <td>{p.loss ?? "-"}%</td>
              <td>{p.inFps ?? "-"}</td>
              <td>{p.inKbps ?? "-"}/{p.outKbps ?? "-"}</td>
              <td>{p.res ?? "-"}{p.limit && p.limit !== "none" ? ` (${p.limit})` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 8, color: "#b99" }}>events</div>
      {events.map((e, i) => {
        const { t, ev, at: _at, ...rest } = e;
        return (
          <div key={i} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {(t / 1000).toFixed(1)}s {ev} {Object.keys(rest).length ? JSON.stringify(rest) : ""}
          </div>
        );
      })}
    </div>
  );
}

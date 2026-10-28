// Injected into every client page before the app loads. App-agnostic: wraps
// RTCPeerConnection and WebSocket so the harness can read WebRTC stats, see
// connection-state history, and kill sockets to simulate network blips.
(() => {
  const pcs = [];
  const sockets = [];
  const events = [];
  const log = (e) => {
    events.push({ t: Math.round(performance.now()), ...e });
    if (events.length > 2000) events.shift();
  };

  const OrigPC = window.RTCPeerConnection;
  function PC(...args) {
    const pc = new OrigPC(...args);
    pc.__hid = pcs.length;
    pcs.push(pc);
    log({ ev: "pc_new", id: pc.__hid });
    pc.addEventListener("connectionstatechange", () =>
      log({ ev: "pc_state", id: pc.__hid, state: pc.connectionState })
    );
    return pc;
  }
  PC.prototype = OrigPC.prototype;
  Object.setPrototypeOf(PC, OrigPC);
  window.RTCPeerConnection = PC;

  const OrigWS = window.WebSocket;
  function WS(...args) {
    const ws = new OrigWS(...args);
    // Only the app's room socket — not Vite's HMR socket
    if (!String(args[0]).includes("/ws/room")) return ws;
    sockets.push(ws);
    log({ ev: "ws_new" });
    ws.addEventListener("open", () => log({ ev: "ws_open" }));
    ws.addEventListener("close", (e) => log({ ev: "ws_close", code: e.code }));
    return ws;
  }
  WS.prototype = OrigWS.prototype;
  Object.setPrototypeOf(WS, OrigWS);
  window.WebSocket = WS;

  async function pcStats(pc) {
    const r = await pc.getStats();
    const o = { id: pc.__hid, state: pc.connectionState, inV: null, inA: null, outV: [], pair: null };
    r.forEach((s) => {
      if (s.type === "inbound-rtp" && s.kind === "video") {
        o.inV = {
          frames: s.framesDecoded ?? 0, bytes: s.bytesReceived ?? 0,
          lost: s.packetsLost ?? 0, recv: s.packetsReceived ?? 0,
          jitter: s.jitter ?? 0, w: s.frameWidth, h: s.frameHeight,
          freezes: s.freezeCount ?? 0, freezeDur: s.totalFreezesDuration ?? 0,
        };
      }
      if (s.type === "inbound-rtp" && s.kind === "audio") {
        o.inA = {
          bytes: s.bytesReceived ?? 0, lost: s.packetsLost ?? 0, recv: s.packetsReceived ?? 0,
          jitter: s.jitter ?? 0, concealed: s.concealedSamples ?? 0, total: s.totalSamplesReceived ?? 0,
        };
      }
      if (s.type === "outbound-rtp" && s.kind === "video") {
        o.outV.push({ bytes: s.bytesSent ?? 0, w: s.frameWidth, h: s.frameHeight, qlr: s.qualityLimitationReason });
      }
      if (s.type === "candidate-pair" && s.nominated && s.state === "succeeded") {
        const l = r.get(s.localCandidateId);
        const rm = r.get(s.remoteCandidateId);
        o.pair = {
          rtt: s.currentRoundTripTime, avail: s.availableOutgoingBitrate,
          lt: l?.candidateType, rt: rm?.candidateType, proto: l?.protocol,
        };
      }
    });
    return o;
  }

  window.__harness = {
    events,
    killSockets() {
      sockets.forEach((s) => { try { s.close(4000, "harness"); } catch {} });
    },
    killPeers() {
      pcs.forEach((pc) => { try { pc.close(); } catch {} });
    },
    async stats() {
      const live = pcs.filter((pc) => pc.connectionState !== "closed");
      const out = await Promise.all(live.map(pcStats));
      const vids = [...document.querySelectorAll("video")].map((v) => ({
        w: v.videoWidth, t: v.currentTime, paused: v.paused, muted: v.muted,
        visible: v.getBoundingClientRect().width > 20,
      }));
      const tiles = [...document.querySelectorAll('[data-testid="tile"]')].map((t) => ({
        sid: t.dataset.sid, cam: t.dataset.cam, leaving: t.dataset.leaving, health: t.dataset.health,
      }));
      const open = sockets.filter((s) => s.readyState < 2).map((s) => s.readyState);
      return { t: performance.now(), pcs: out, vids, tiles, ws: open.length ? open : [3] };
    },
  };
})();

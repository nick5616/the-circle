import { socket } from "./socket";
import { telemetry } from "./telemetry";
import type { PeerHealth, PeerInfo, PeerQuality, Role, SignalPayload } from "./types";

// Peer connection manager for the P2P mesh.
//
// Declarative: the app tells us who we are and who is seated, and reconcile()
// works out which links should exist. Each pair of peers has exactly one
// offerer, chosen deterministically:
//   participant ↔ participant  → the lower session id offers
//   audience    → participant  → the audience member offers (receive-only)
// Every RTCPeerConnection gets a random `pcid`; all signals carry it, so a
// stale offer/answer/candidate for a connection that has since been replaced
// is recognised and dropped instead of corrupting the new one.
//
// Self-healing, in escalating order:
//   disconnected for 2.5s / failed   → ICE restart (offerer)
//   not connected 15s after creation → rebuild with a new pcid (offerer)
//   answerer missing its link        → "kick" the offerer to (re)offer
//   answerer link dead for 20s       → close it; the kick path takes over

type Side = "offer" | "answer";

interface LinkStats {
  rtt?: number;
  path?: string;
  inFps?: number;
  inKbps?: number;
  outKbps?: number;
  loss?: number;
  conceal?: number;
  res?: string;
  limit?: string;
}

interface Link {
  sid: string;
  side: Side;
  pcid: string;
  pc: RTCPeerConnection;
  myRole: Role;
  remote: MediaStream;
  created: number;
  downSince: number; // 0 while connected
  everConnected: boolean;
  chain: Promise<void>;
  pending: RTCIceCandidateInit[];
  restartTimer?: ReturnType<typeof setTimeout>;
  lastRestart: number;
  closed: boolean;
  health: PeerHealth;
  quality: PeerQuality;
  stats: LinkStats;
  sample?: { t: number; frames: number; inBytes: number; outBytes: number; lost: number; recv: number; conc: number; tot: number };
  appliedBitrate?: string;
  // Answer links: does the remote send media (a participant) or only watch (audience)?
  remoteSends?: boolean;
}

type StreamCb = (sid: string, stream: MediaStream | null) => void;
type PeersCb = (peers: Map<string, PeerInfo>) => void;

const OFFER_WATCHDOG_MS = 15_000;
const ANSWER_DEAD_MS = 20_000;
const KICK_AFTER_MS = 3_000;
const KICK_EVERY_MS = 6_000;

const params = new URLSearchParams(location.search);
// ?ice=srflx forces traffic through the router (no LAN shortcuts) — a "real
// network" test from one machine. ?ice=relay forces TURN.
const ICE_FILTER = params.get("ice");

const links = new Map<string, Link>();
const missingSince = new Map<string, number>();
const lastKick = new Map<string, number>();
const rebuilds = new Map<string, number>();
const nullTimers = new Map<string, ReturnType<typeof setTimeout>>();

let mySid = "";
let myRole: Role | null = null;
let seated: string[] = []; // participant sids other than me
let localStream: MediaStream | null = null;
let iceServers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
let onStream: StreamCb = () => {};
let onPeers: PeersCb = () => {};
let peersDirty = false;
let tickCount = 0;

const rid = () => Math.random().toString(36).slice(2, 10);
const short = (sid: string) => sid.slice(0, 6);

function desiredSide(sid: string): Side | null {
  if (!myRole || !seated.includes(sid)) return null;
  if (myRole === "audience") return "offer";
  return mySid < sid ? "offer" : "answer";
}

function send(L: Link, body: Omit<SignalPayload, "pcid">) {
  socket.send({ type: "signal", payload: { target: L.sid, pcid: L.pcid, ...body } });
}

function enqueue(L: Link, op: () => Promise<void>) {
  L.chain = L.chain.then(async () => {
    if (L.closed) return;
    try {
      await op();
    } catch (err) {
      telemetry.event("pc_op_error", { peer: short(L.sid), side: L.side, err: String(err).slice(0, 160) });
    }
  });
}

function markPeers() {
  if (peersDirty) return;
  peersDirty = true;
  queueMicrotask(() => {
    peersDirty = false;
    const m = new Map<string, PeerInfo>();
    for (const L of links.values()) m.set(L.sid, { health: L.health, quality: L.quality });
    onPeers(m);
  });
}

function emitStream(sid: string, stream: MediaStream | null, delay = 0) {
  clearTimeout(nullTimers.get(sid));
  nullTimers.delete(sid);
  if (stream || delay === 0) {
    onStream(sid, stream);
    return;
  }
  // Hold the old (frozen) frame briefly so a replacement link doesn't flash empty
  nullTimers.set(sid, setTimeout(() => {
    nullTimers.delete(sid);
    if (!links.has(sid)) onStream(sid, null);
  }, delay));
}

function healthOf(L: Link): PeerHealth {
  const s = L.pc.connectionState;
  if (s === "connected") return "connected";
  if (s === "failed") return "failed";
  return L.everConnected ? "reconnecting" : "connecting";
}

function newLink(sid: string, side: Side, pcid: string): Link {
  const pc = new RTCPeerConnection({
    iceServers,
    iceTransportPolicy: ICE_FILTER === "relay" ? "relay" : "all",
    bundlePolicy: "max-bundle",
  });
  const L: Link = {
    sid, side, pcid, pc, myRole: myRole!, remote: new MediaStream(), created: Date.now(), downSince: Date.now(),
    everConnected: false, chain: Promise.resolve(), pending: [], lastRestart: 0, closed: false,
    health: "connecting", quality: "unknown", stats: {},
  };
  links.set(sid, L);
  missingSince.delete(sid);

  pc.onicecandidate = ({ candidate }) => {
    if (!candidate || L.closed) return;
    if (ICE_FILTER === "srflx" && candidate.type === "host") return;
    send(L, { candidate: candidate.toJSON() });
  };

  pc.ontrack = ({ track }) => {
    if (L.closed) return;
    if (!L.remote.getTracks().includes(track)) L.remote.addTrack(track);
    emitStream(sid, L.remote);
  };

  pc.onconnectionstatechange = () => {
    if (L.closed) return;
    const s = pc.connectionState;
    if (s === "connected") {
      if (!L.everConnected) telemetry.event("pc_connected", { peer: short(sid), side, ms: Date.now() - L.created });
      else telemetry.event("pc_recovered", { peer: short(sid), side, downMs: Date.now() - L.downSince });
      L.everConnected = true;
      L.downSince = 0;
      clearTimeout(L.restartTimer);
      rebuilds.delete(sid);
      applyBitrate();
    } else if (!L.downSince) {
      L.downSince = Date.now();
    }
    if (s === "disconnected" && side === "offer") {
      clearTimeout(L.restartTimer);
      L.restartTimer = setTimeout(() => {
        if (!L.closed && L.pc.connectionState !== "connected") restartIce(L, "disconnected");
      }, 2500);
    }
    if (s === "failed") {
      telemetry.event("pc_failed", { peer: short(sid), side });
      if (side === "offer") restartIce(L, "failed");
    }
    L.health = healthOf(L);
    markPeers();
  };

  markPeers();
  return L;
}

function closeLink(L: Link, why: string, holdMs = 1500) {
  if (L.closed) return;
  L.closed = true;
  clearTimeout(L.restartTimer);
  try {
    L.pc.close();
  } catch {}
  if (links.get(L.sid) === L) links.delete(L.sid);
  telemetry.event("pc_close", { peer: short(L.sid), side: L.side, why });
  emitStream(L.sid, null, holdMs);
  markPeers();
}

function addLocalTracks(pc: RTCPeerConnection) {
  for (const kind of ["audio", "video"] as const) {
    const track = myRole === "participant" ? localStream?.getTracks().find((t) => t.kind === kind) : undefined;
    if (track && localStream) pc.addTransceiver(track, { direction: "sendrecv", streams: [localStream] });
    else if (myRole === "participant") pc.addTransceiver(kind, { direction: "sendrecv" }); // track may arrive later (camera turned on)
    else pc.addTransceiver(kind, { direction: "recvonly" });
  }
}

function createOfferLink(sid: string) {
  const L = newLink(sid, "offer", rid());
  addLocalTracks(L.pc);
  enqueue(L, async () => {
    await L.pc.setLocalDescription(await L.pc.createOffer());
    send(L, { description: L.pc.localDescription!.toJSON() });
  });
  telemetry.event("pc_offer", { peer: short(sid), pcid: L.pcid });
}

function restartIce(L: Link, why: string) {
  if (L.side !== "offer" || L.closed) return;
  if (Date.now() - L.lastRestart < 4000) return;
  L.lastRestart = Date.now();
  enqueue(L, async () => {
    if (L.pc.signalingState !== "stable") return; // exchange in flight; the watchdog covers it
    await L.pc.setLocalDescription(await L.pc.createOffer({ iceRestart: true }));
    send(L, { description: L.pc.localDescription!.toJSON() });
    telemetry.event("ice_restart", { peer: short(L.sid), why });
  });
}

function rebuild(L: Link, why: string) {
  const n = (rebuilds.get(L.sid) ?? 0) + 1;
  rebuilds.set(L.sid, n);
  telemetry.event("pc_rebuild", { peer: short(L.sid), why, n });
  closeLink(L, `rebuild:${why}`);
  createOfferLink(L.sid);
}

// Map mid → direction from an SDP blob
function sdpDirections(sdp: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const section of sdp.split(/\r?\nm=/).slice(1)) {
    const mid = /a=mid:(\S+)/.exec(section)?.[1];
    const dir = /a=(sendrecv|sendonly|recvonly|inactive)/.exec(section)?.[1] ?? "sendrecv";
    if (mid) out.set(mid, dir);
  }
  return out;
}

async function answerOffer(L: Link, description: RTCSessionDescriptionInit) {
  const pc = L.pc;
  await pc.setRemoteDescription(description);
  const dirs = sdpDirections(description.sdp ?? "");
  L.remoteSends = [...dirs.values()].some((d) => d === "sendrecv" || d === "sendonly");
  for (const t of pc.getTransceivers()) {
    if (!t.mid) continue;
    const offered = dirs.get(t.mid) ?? "sendrecv";
    const remoteSends = offered === "sendrecv" || offered === "sendonly";
    const remoteRecvs = offered === "sendrecv" || offered === "recvonly";
    const kind = t.receiver.track.kind;
    const track = myRole === "participant" ? localStream?.getTracks().find((x) => x.kind === kind) ?? null : null;
    const weSend = myRole === "participant" && remoteRecvs;
    if (weSend) {
      if (t.sender.track !== track) await t.sender.replaceTrack(track);
      if (localStream) t.sender.setStreams?.(localStream);
    }
    t.direction = weSend ? (remoteSends ? "sendrecv" : "sendonly") : remoteSends ? "recvonly" : "inactive";
  }
  await flushCandidates(L);
  await pc.setLocalDescription(await pc.createAnswer());
  send(L, { description: pc.localDescription!.toJSON() });
}

async function flushCandidates(L: Link) {
  const q = L.pending.splice(0);
  for (const c of q) {
    try {
      await L.pc.addIceCandidate(c);
    } catch {}
  }
}

function onKick(from: string, theirPcid: string) {
  const L = links.get(from);
  if (desiredSide(from) !== "offer") return;
  if (!L) {
    createOfferLink(from);
    return;
  }
  if (L.side !== "offer") return;
  if (theirPcid === L.pcid) return; // they have our current connection; ICE recovery handles the rest
  if (Date.now() - L.created < 4000 && !L.everConnected) return; // an offer is already on its way
  rebuild(L, "kicked");
}

// ─── Bitrate policy ────────────────────────────────────────────────────────
// A participant uploads one copy of their video per link, so the per-link cap
// shrinks as the mesh grows. Audience links get a lighter stream.

function applyBitrate() {
  if (myRole !== "participant") return;
  const all = [...links.values()].filter((L) => !L.closed);
  const mesh = all.filter((L) => seated.includes(L.sid));
  const serve = all.filter((L) => !seated.includes(L.sid));
  for (const L of all) {
    const isMesh = seated.includes(L.sid);
    const maxBitrate = isMesh
      ? Math.round(Math.min(1_200_000, Math.max(220_000, 2_400_000 / Math.max(1, mesh.length))))
      : serve.length > 8 ? 150_000 : 350_000;
    const scale = isMesh ? (mesh.length >= 5 ? 1.5 : 1) : serve.length > 8 ? 2 : 1.5;
    const key = `${maxBitrate}:${scale}`;
    if (L.appliedBitrate === key) continue;
    L.appliedBitrate = key;
    for (const sender of L.pc.getSenders()) {
      if (!sender.track) continue;
      const p = sender.getParameters();
      if (!p.encodings?.length) p.encodings = [{}];
      if (sender.track.kind === "video") {
        p.encodings[0].maxBitrate = maxBitrate;
        p.encodings[0].scaleResolutionDownBy = scale;
      } else {
        // Voice matters more than pixels when the network is tight
        (p.encodings[0] as RTCRtpEncodingParameters & { priority?: string; networkPriority?: string }).priority = "high";
        (p.encodings[0] as RTCRtpEncodingParameters & { networkPriority?: string }).networkPriority = "high";
      }
      sender.setParameters(p).catch(() => {
        L.appliedBitrate = undefined;
      });
    }
  }
}

// ─── Stats ──────────────────────────────────────────────────────────────────

async function sampleStats(L: Link) {
  if (L.closed || L.pc.connectionState === "closed") return;
  const report = await L.pc.getStats();
  let frames = 0, inBytes = 0, outBytes = 0, lost = 0, recv = 0, conc = 0, tot = 0;
  const st: LinkStats = { ...L.stats };
  report.forEach((s) => {
    if (s.type === "inbound-rtp") {
      inBytes += s.bytesReceived ?? 0;
      lost += Math.max(0, s.packetsLost ?? 0);
      recv += s.packetsReceived ?? 0;
      if (s.kind === "video") {
        frames += s.framesDecoded ?? 0;
        if (s.frameWidth) st.res = `${s.frameWidth}x${s.frameHeight}`;
      } else {
        conc += s.concealedSamples ?? 0;
        tot += s.totalSamplesReceived ?? 0;
      }
    } else if (s.type === "outbound-rtp") {
      outBytes += s.bytesSent ?? 0;
      if (s.kind === "video" && s.qualityLimitationReason) st.limit = s.qualityLimitationReason;
    } else if (s.type === "candidate-pair" && s.nominated && s.state === "succeeded") {
      st.rtt = s.currentRoundTripTime !== undefined ? Math.round(s.currentRoundTripTime * 1000) : st.rtt;
      const local = report.get(s.localCandidateId);
      const remote = report.get(s.remoteCandidateId);
      st.path = `${local?.candidateType ?? "?"}/${remote?.candidateType ?? "?"}${local?.protocol === "tcp" ? "/tcp" : ""}`;
    }
  });
  const now = performance.now();
  const prev = L.sample;
  L.sample = { t: now, frames, inBytes, outBytes, lost, recv, conc, tot };
  if (prev) {
    const dt = (now - prev.t) / 1000;
    const dLost = lost - prev.lost;
    const dRecv = recv - prev.recv;
    st.inFps = Math.round(((frames - prev.frames) / dt) * 10) / 10;
    st.inKbps = Math.round(((inBytes - prev.inBytes) * 8) / 1000 / dt);
    st.outKbps = Math.round(((outBytes - prev.outBytes) * 8) / 1000 / dt);
    st.loss = dLost + dRecv > 0 ? Math.round((dLost / (dLost + dRecv)) * 1000) / 10 : 0;
    st.conceal = tot - prev.tot > 0 ? Math.round(((conc - prev.conc) / (tot - prev.tot)) * 1000) / 10 : 0;
  }
  L.stats = st;
  const q: PeerQuality =
    L.health !== "connected" ? "unknown"
    : (st.loss ?? 0) > 8 || (st.rtt ?? 0) > 700 || (st.conceal ?? 0) > 12 ? "poor"
    : (st.loss ?? 0) > 2 || (st.rtt ?? 0) > 350 || (st.conceal ?? 0) > 4 ? "fair"
    : "good";
  if (q !== L.quality) {
    if (q === "poor") telemetry.event("quality_poor", { peer: short(L.sid), ...st });
    L.quality = q;
    markPeers();
  }
}

// ─── Maintenance loop ───────────────────────────────────────────────────────

function tick() {
  tickCount++;
  const now = Date.now();
  if (myRole) {
    for (const sid of seated) {
      if (desiredSide(sid) !== "answer" || links.has(sid)) continue;
      const since = missingSince.get(sid) ?? now;
      missingSince.set(sid, since);
      if (now - since > KICK_AFTER_MS && now - (lastKick.get(sid) ?? 0) > KICK_EVERY_MS) {
        lastKick.set(sid, now);
        socket.send({ type: "signal", payload: { target: sid, pcid: "", kick: true } });
        telemetry.event("kick", { peer: short(sid) });
      }
    }
  }
  for (const L of [...links.values()]) {
    if (L.closed || !L.downSince) continue;
    const down = now - L.downSince;
    if (L.side === "offer") {
      const budget = OFFER_WATCHDOG_MS * Math.min(3, 1 + 0.5 * (rebuilds.get(L.sid) ?? 0));
      if (down > budget) rebuild(L, L.everConnected ? "stuck-reconnecting" : "never-connected");
    } else if (down > ANSWER_DEAD_MS) {
      closeLink(L, "answer-dead");
    }
  }
  if (myRole) reconcile();
  if (tickCount % 2 === 0) for (const L of links.values()) sampleStats(L).catch(() => {});
}

setInterval(tick, 2000);

// ─── Public API ─────────────────────────────────────────────────────────────

function reconcile() {
  for (const L of [...links.values()]) {
    const want = desiredSide(L.sid);
    if (L.side === "offer") {
      if (want !== "offer" || L.myRole !== myRole) closeLink(L, "not-desired");
    } else {
      // Answer links: serving audience is fine while we're seated. If the rule
      // says we should be the offerer, a working link still wins; a dead one goes.
      // A link whose kind no longer matches the remote's seat (audience member
      // sat down, or participant stood up) is replaced — unless it's brand new,
      // in which case the remote is probably just ahead of our room_state.
      const age = Date.now() - L.created;
      const kindMismatch = L.remoteSends !== undefined && L.remoteSends !== seated.includes(L.sid) && age > 5000;
      const stale =
        myRole !== "participant" ||
        L.myRole !== myRole ||
        kindMismatch ||
        (want === "offer" && !L.everConnected && age > 10_000);
      if (stale) closeLink(L, "stale-answer");
    }
  }
  for (const sid of seated) {
    if (desiredSide(sid) === "offer" && !links.has(sid)) createOfferLink(sid);
  }
  for (const sid of missingSince.keys()) if (desiredSide(sid) !== "answer") missingSince.delete(sid);
  applyBitrate();
}

export const rtc = {
  setIceServers(servers: RTCIceServer[]) {
    if (servers?.length) iceServers = servers;
  },

  setCallbacks(stream: StreamCb, peers: PeersCb) {
    onStream = stream;
    onPeers = peers;
  },

  /** Tell the manager who we are and who is seated. Safe to call on every room_state. */
  configure(sid: string, role: Role | null, seatedSids: string[]) {
    const roleChanged = role !== myRole;
    mySid = sid;
    myRole = role;
    seated = seatedSids.filter((s) => s !== sid);
    if (roleChanged) telemetry.event("role", { role });
    reconcile();
  },

  setLocalStream(stream: MediaStream | null) {
    localStream = stream;
  },

  /** Swap (or remove) our outgoing track of one kind on every link — no renegotiation. */
  async setLocalTrack(kind: "audio" | "video", track: MediaStreamTrack | null) {
    for (const L of links.values()) {
      for (const t of L.pc.getTransceivers()) {
        if (t.receiver.track.kind !== kind) continue;
        if (t.direction !== "sendrecv" && t.direction !== "sendonly") continue;
        await t.sender.replaceTrack(track).catch(() => {});
      }
      L.appliedBitrate = undefined;
    }
    applyBitrate();
  },

  handleSignal(from: string, payload: SignalPayload) {
    const { pcid, description, candidate, kick } = payload;
    if (kick) {
      onKick(from, pcid);
      return;
    }
    let L = links.get(from);

    if (description?.type === "offer") {
      if (!myRole) return;
      if (L && L.pcid !== pcid) {
        // Two different connections for one pair. Lower sid wins glare.
        if (L.side === "offer" && mySid < from && L.pc.connectionState !== "failed" && desiredSide(from) === "offer") {
          telemetry.event("glare_ignored", { peer: short(from) });
          return;
        }
        closeLink(L, "replaced-by-remote-offer", 0);
        L = undefined;
      }
      if (!L) L = newLink(from, "answer", pcid);
      const link = L;
      enqueue(link, () => answerOffer(link, description));
      return;
    }

    if (!L || L.pcid !== pcid) return; // stale signal for a connection that no longer exists
    const link = L;

    if (description?.type === "answer") {
      enqueue(link, async () => {
        if (link.pc.signalingState !== "have-local-offer") return;
        await link.pc.setRemoteDescription(description);
        await flushCandidates(link);
      });
    } else if (candidate) {
      if (ICE_FILTER === "srflx" && / typ host/.test(candidate.candidate ?? "")) return;
      enqueue(link, async () => {
        if (!link.pc.remoteDescription) link.pending.push(candidate);
        else await link.pc.addIceCandidate(candidate).catch(() => {});
      });
    }
  },

  /** Peer left the room for good. */
  drop(sid: string) {
    const L = links.get(sid);
    if (L) closeLink(L, "peer-gone", 0);
    missingSince.delete(sid);
  },

  /** Signaling came back after a socket outage: anything that isn't connected may have lost messages. */
  signalingRestored() {
    for (const L of [...links.values()]) {
      if (L.health === "connected") continue;
      if (L.side === "offer") rebuild(L, "signaling-restored");
    }
    for (const sid of seated) if (desiredSide(sid) === "answer" && !links.has(sid)) missingSince.set(sid, 0);
  },

  reset() {
    for (const L of [...links.values()]) closeLink(L, "reset", 0);
    links.clear();
    missingSince.clear();
    rebuilds.clear();
    mySid = "";
    myRole = null;
    seated = [];
  },

  /** Compact per-peer stats for telemetry + the debug HUD. */
  summary() {
    return [...links.values()].map((L) => ({
      peer: short(L.sid),
      side: L.side,
      state: L.pc.connectionState,
      ice: L.pc.iceConnectionState,
      q: L.quality,
      age: Math.round((Date.now() - L.created) / 1000),
      ...L.stats,
    }));
  },

  peerStats(sid: string): LinkStats | undefined {
    return links.get(sid)?.stats;
  },
};

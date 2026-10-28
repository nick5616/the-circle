import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { socket } from "./socket";
import { rtc } from "./rtc";
import { audioLevels } from "./audio";
import { telemetry } from "./telemetry";
import { flare, scene } from "./scene";
import type { FeedItem, PeerInfo, Reaction, Role, RoomSnapshot, Seat, ServerMessage, WsStatus } from "./types";
import FireCanvas from "./components/FireCanvas";
import Landing from "./components/Landing";
import Stage from "./components/Stage";
import Dock from "./components/Dock";
import Chat, { CHAT_WIDTH } from "./components/Chat";
import SeatBar from "./components/SeatBar";
import AudioSink from "./components/AudioSink";
import Reactions, { type FloatingReaction } from "./components/Reactions";
import Notice from "./components/Notice";
import DebugHud from "./components/DebugHud";

const EMPTY_SEATS: Array<Seat | null> = Array(8).fill(null);

function useViewport() {
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return vp;
}

const VIDEO: MediaTrackConstraints = {
  facingMode: "user",
  width: { ideal: 640 },
  height: { ideal: 360 },
  frameRate: { ideal: 24, max: 30 },
};
const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

// Camera + mic, degrading gracefully: both → voice only → camera only → none
async function acquireMedia(): Promise<{ stream: MediaStream | null; error?: string }> {
  const md = navigator.mediaDevices;
  if (!md?.getUserMedia) return { stream: null, error: "this browser can't share a camera here (try https or a newer browser)" };
  try {
    return { stream: await md.getUserMedia({ video: VIDEO, audio: AUDIO }) };
  } catch (err) {
    const name = (err as DOMException)?.name;
    telemetry.event("media_error", { name, kind: "av" });
    if (name === "NotAllowedError" || name === "SecurityError") {
      return { stream: null, error: "your camera and mic are blocked. allow them from the icon in your address bar." };
    }
  }
  for (const c of [{ audio: AUDIO }, { video: VIDEO }]) {
    try {
      return { stream: await md.getUserMedia(c) };
    } catch {}
  }
  return { stream: null, error: "no camera or mic found, so you're watching for now" };
}

export default function App() {
  const vp = useViewport();
  const mobile = vp.w < 760;
  const debug = useMemo(() => new URLSearchParams(location.search).has("debug"), []);

  const [phase, setPhase] = useState<"landing" | "room">("landing");
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [me, setMe] = useState<{ sid: string; role: Role | null; name: string }>({ sid: "", role: null, name: "" });
  const [ws, setWs] = useState<WsStatus>(socket.status);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [streams, setStreams] = useState<Map<string, MediaStream>>(() => new Map());
  const [peers, setPeers] = useState<Map<string, PeerInfo>>(() => new Map());
  const [local, setLocal] = useState<MediaStream | null>(null);
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [view, setView] = useState<"grid" | "circle">(() => (window.innerWidth < 760 ? "grid" : "circle"));
  const [chatOpen, setChatOpen] = useState(() => window.innerWidth >= 1180);
  const [unread, setUnread] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [joining, setJoining] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [hud, setHud] = useState(debug);

  const meRef = useRef(me);
  meRef.current = me;
  const roomRef = useRef<RoomSnapshot | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const mediaRef = useRef({ mic: true, cam: true });
  // What we want to be, so a lost session can be silently re-joined
  const intentRef = useRef<{ name: string; role: Role } | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>();
  const reactionId = useRef(0);
  const chatOpenRef = useRef(chatOpen);
  chatOpenRef.current = chatOpen;

  const say = useCallback((text: string, ms = 5500) => {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), ms);
  }, []);

  const seatedIds = (snap: RoomSnapshot | null) =>
    (snap?.seats ?? []).filter((s): s is Seat => !!s).map((s) => s.session_id);

  // ── Local media ─────────────────────────────────────────────────────────
  const applyLocal = useCallback((stream: MediaStream | null) => {
    if (localRef.current && localRef.current !== stream) {
      const keep = new Set(stream?.getTracks() ?? []);
      localRef.current.getTracks().forEach((t) => !keep.has(t) && t.stop());
    }
    localRef.current = stream;
    rtc.setLocalStream(stream);
    setLocal(stream);
    const m = { mic: !!stream?.getAudioTracks().length, cam: !!stream?.getVideoTracks().length };
    mediaRef.current = m;
    setMic(m.mic);
    setCam(m.cam);
  }, []);

  const sendMedia = useCallback(() => {
    if (meRef.current.role === "participant") socket.send({ type: "media", payload: mediaRef.current });
  }, []);

  // ── Wiring ──────────────────────────────────────────────────────────────
  useEffect(() => {
    rtc.setCallbacks(
      (sid, stream) =>
        setStreams((prev) => {
          if (stream ? prev.get(sid) === stream : !prev.has(sid)) return prev;
          const next = new Map(prev);
          if (stream) next.set(sid, stream);
          else next.delete(sid);
          return next;
        }),
      setPeers
    );
    telemetry.setSender((payload) => socket.send({ type: "telemetry", payload }));
    telemetry.setSummary(() => rtc.summary());
    const offStatus = socket.onStatus(setWs);
    const offMsg = socket.onMessage(handle);
    socket.connect();

    const bye = (e: PageTransitionEvent) => {
      if (!e.persisted) socket.sayBye();
    };
    window.addEventListener("pagehide", bye);
    (window as unknown as Record<string, unknown>).__circle = {
      events: telemetry.events,
      peers: () => rtc.summary(),
      socket: () => ({ status: socket.status, rtt: socket.rtt, sid: socket.sessionId }),
      me: () => meRef.current,
      dropSocket: () => socket.simulateDrop(),
    };
    return () => {
      offStatus();
      offMsg();
      window.removeEventListener("pagehide", bye);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handle(msg: ServerMessage) {
    switch (msg.type) {
      case "hello": {
        const p = msg.payload;
        rtc.setIceServers(p.ice_servers);
        setMe((m) => ({ ...m, sid: p.session_id }));
        meRef.current = { ...meRef.current, sid: p.session_id };
        if (p.resumed) {
          rtc.signalingRestored();
        } else if (intentRef.current) {
          // The server forgot us (grace period ran out, or Redis was wiped). Quietly sit back down.
          telemetry.event("rejoin", { role: intentRef.current.role });
          rtc.reset();
          const role = intentRef.current.role === "participant" && localRef.current ? "participant" : "audience";
          meRef.current = { ...meRef.current, role: null };
          socket.send({ type: "join", payload: { name: intentRef.current.name, role } });
        }
        break;
      }
      case "joined": {
        const { role, name } = msg.payload;
        const wasRole = meRef.current.role;
        meRef.current = { ...meRef.current, role, name };
        setMe((m) => ({ ...m, role, name }));
        intentRef.current = { name, role };
        if (role === "audience" && localRef.current) applyLocal(null);
        rtc.configure(meRef.current.sid, role, seatedIds(roomRef.current));
        if (role === "participant") {
          socket.send({ type: "media", payload: mediaRef.current });
          if (wasRole !== "participant") flare(0.8);
        }
        setJoining(false);
        setPhase("room");
        break;
      }
      case "room_state": {
        const prev = roomRef.current;
        roomRef.current = msg.payload;
        setRoom(msg.payload);
        const { sid, role } = meRef.current;
        if (role) rtc.configure(sid, role, seatedIds(msg.payload));
        if (prev && role) announce(prev, msg.payload, sid);
        break;
      }
      case "signal":
        rtc.handleSignal(msg.payload.from, msg.payload);
        break;
      case "peer_gone":
        rtc.drop(msg.payload.session_id);
        break;
      case "chat":
        mergeFeed([{ kind: "chat", ...msg.payload }]);
        if (!chatOpenRef.current && msg.payload.sid !== meRef.current.sid) setUnread((u) => u + 1);
        break;
      case "chat_history":
        mergeFeed(msg.payload.messages.map((m) => ({ kind: "chat" as const, ...m })));
        break;
      case "reaction":
        spawnReaction(msg.payload.session_id, msg.payload.emoji);
        break;
      case "seat_denied":
        say("all 8 seats are taken, so you're watching for now");
        if (localRef.current) applyLocal(null);
        setJoining(false);
        break;
    }
  }

  function mergeFeed(items: FeedItem[]) {
    setFeed((prev) => {
      const ids = new Set(prev.map((i) => i.id));
      const fresh = items.filter((i) => !ids.has(i.id));
      if (!fresh.length) return prev;
      return [...prev, ...fresh].slice(-300);
    });
  }

  function announce(prev: RoomSnapshot, next: RoomSnapshot, mySid: string) {
    const before = new Map(prev.seats.filter((s): s is Seat => !!s).map((s) => [s.session_id, s]));
    const after = new Map(next.seats.filter((s): s is Seat => !!s).map((s) => [s.session_id, s]));
    const ts = new Date().toISOString();
    const events: FeedItem[] = [];
    for (const [sid, s] of after) {
      if (!before.has(sid) && sid !== mySid) {
        events.push({ kind: "event", id: `e-${sid}-in-${ts}`, name: s.name, text: "joined", timestamp: ts });
        flare(0.5);
      }
    }
    for (const [sid, s] of before) {
      if (!after.has(sid) && sid !== mySid) {
        events.push({ kind: "event", id: `e-${sid}-out-${ts}`, name: s.name, text: "left", timestamp: ts });
      }
    }
    if (events.length) mergeFeed(events);
  }

  function spawnReaction(sid: string, emoji: Reaction) {
    if (emoji === "🪵") flare(1.1);
    else if (emoji === "🔥") flare(0.4);
    const el = scene.people.find((p) => p.sid === sid)?.el;
    const b = el?.getBoundingClientRect();
    const x = b ? b.left + b.width * (0.3 + Math.random() * 0.4) : scene.fire.x + (Math.random() - 0.5) * 120;
    const y = b ? b.top + b.height * 0.35 : scene.fire.y - scene.fire.size * 0.4;
    const r: FloatingReaction = {
      id: ++reactionId.current, emoji, x, y, dx: (Math.random() - 0.5) * 140, rot: (Math.random() - 0.5) * 50,
    };
    setReactions((rs) => [...rs.slice(-30), r]);
    setTimeout(() => setReactions((rs) => rs.filter((x) => x.id !== r.id)), 2700);
  }

  // ── Actions ─────────────────────────────────────────────────────────────
  const handleJoin = useCallback(async (name: string, role: Role) => {
    setJoining(true);
    audioLevels.resume();
    let finalRole = role;
    if (role === "participant") {
      const { stream, error } = await acquireMedia();
      if (stream) applyLocal(stream);
      else {
        finalRole = "audience";
        if (error) say(error, 7000);
      }
    }
    intentRef.current = { name, role: finalRole };
    socket.send({ type: "join", payload: { name, role: finalRole } });
  }, [say, applyLocal]);

  const toggleMic = useCallback(() => {
    const track = localRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    mediaRef.current = { ...mediaRef.current, mic: track.enabled };
    setMic(track.enabled);
    sendMedia();
  }, [sendMedia]);

  // Camera off really releases the camera (light goes out); on re-acquires it.
  const toggleCam = useCallback(async () => {
    const stream = localRef.current;
    if (!stream) return;
    const current = stream.getVideoTracks()[0];
    if (current) {
      current.stop();
      const next = new MediaStream(stream.getAudioTracks());
      localRef.current = next;
      rtc.setLocalStream(next);
      setLocal(next);
      await rtc.setLocalTrack("video", null);
      mediaRef.current = { ...mediaRef.current, cam: false };
      setCam(false);
    } else {
      try {
        const v = await navigator.mediaDevices.getUserMedia({ video: VIDEO });
        const track = v.getVideoTracks()[0];
        const next = new MediaStream([...stream.getAudioTracks(), track]);
        localRef.current = next;
        rtc.setLocalStream(next);
        setLocal(next);
        await rtc.setLocalTrack("video", track);
        mediaRef.current = { ...mediaRef.current, cam: true };
        setCam(true);
      } catch {
        say("couldn't turn on your camera. another app might be using it.");
        return;
      }
    }
    sendMedia();
  }, [say, sendMedia]);

  const takeSeat = useCallback(async () => {
    audioLevels.resume();
    const { stream, error } = await acquireMedia();
    if (!stream) {
      if (error) say(error, 7000);
      return;
    }
    applyLocal(stream);
    socket.send({ type: "take_seat" });
  }, [say, applyLocal]);

  const leaveSeat = useCallback(() => {
    applyLocal(null);
    socket.send({ type: "leave_seat" });
  }, [applyLocal]);

  const leaveRoom = useCallback(() => {
    intentRef.current = null;
    socket.leave();
    rtc.reset();
    applyLocal(null);
    meRef.current = { sid: "", role: null, name: "" };
    roomRef.current = null;
    setMe(meRef.current);
    setRoom(null);
    setFeed([]);
    setStreams(new Map());
    setPeers(new Map());
    setUnread(0);
    setPhase("landing");
  }, [applyLocal]);

  const react = useCallback((emoji: Reaction) => socket.send({ type: "react", payload: { emoji } }), []);
  const sendChat = useCallback((content: string) => socket.send({ type: "chat", payload: { content } }), []);

  const onAudioBlocked = useCallback(() => {
    setAudioBlocked((was) => {
      if (!was) telemetry.event("audio_blocked");
      return true;
    });
  }, []);

  // Unblock autoplay + wake the AudioContext on the first tap
  useEffect(() => {
    const wake = () => {
      audioLevels.resume();
      if (!audioBlocked) return;
      document.querySelectorAll("audio").forEach((a) => a.play().catch(() => {}));
      setAudioBlocked(false);
    };
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [audioBlocked]);

  // Keyboard: m mute, v camera, c chat, ` debug
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === "INPUT";
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "`") setHud((h) => !h);
      if (phase !== "room") return;
      if (e.key === "m") toggleMic();
      else if (e.key === "v") toggleCam();
      else if (e.key === "c") setChatOpen((o) => !o);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, toggleMic, toggleCam]);

  useEffect(() => {
    if (chatOpen) setUnread(0);
  }, [chatOpen]);

  // Keep the screen awake while you're sitting by the fire
  useEffect(() => {
    if (phase !== "room" || me.role !== "participant" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const get = () => navigator.wakeLock.request("screen").then((l) => (lock = l)).catch(() => {});
    get();
    const onVis = () => document.visibilityState === "visible" && get();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      lock?.release().catch(() => {});
    };
  }, [phase, me.role]);

  // ── Derived ─────────────────────────────────────────────────────────────
  const seats = room?.seats ?? EMPTY_SEATS;
  const occupied = useMemo(() => seats.filter((s): s is Seat => !!s), [seats]);
  const allStreams = useMemo(() => {
    const m = new Map(streams);
    if (local && me.sid) m.set(me.sid, local);
    return m;
  }, [streams, local, me.sid]);

  useEffect(() => audioLevels.sync(allStreams), [allStreams]);

  const insets = useMemo(() => {
    if (mobile) return { top: 60, right: 10, bottom: 96, left: 10 };
    return { top: 64, right: chatOpen ? CHAT_WIDTH + 36 : 24, bottom: 100, left: 24 };
  }, [mobile, chatOpen]);

  return (
    <>
      <FireCanvas />
      <AudioSink streams={streams} myId={me.sid} onBlocked={onAudioBlocked} />

      {phase === "landing" || !room || !me.role ? (
        <Landing
          seats={seats}
          audienceCount={room?.audience_count ?? 0}
          connected={ws === "open"}
          joining={joining}
          onJoin={handleJoin}
        />
      ) : (
        <div style={{ animation: "curtain 0.9s var(--ease) both" }}>
          <SeatBar seats={seats} audienceCount={room.audience_count} ws={ws} />
          <Stage
            seats={occupied}
            myId={me.sid}
            streams={allStreams}
            peers={peers}
            view={view}
            localCam={cam}
            localMic={mic}
            insets={insets}
          />
          <Chat
            items={feed}
            myId={me.sid}
            myName={me.name}
            open={chatOpen}
            mobile={mobile}
            onOpen={() => setChatOpen(true)}
            onClose={() => setChatOpen(false)}
            onSend={sendChat}
          />
          <Dock
            role={me.role}
            mic={mic}
            cam={cam}
            hasMic={!!local?.getAudioTracks().length}
            seatsAvailable={occupied.length < 8}
            chatOpen={chatOpen}
            unread={unread}
            view={view}
            compact={mobile}
            onToggleMic={toggleMic}
            onToggleCam={toggleCam}
            onReact={react}
            onToggleChat={() => setChatOpen((o) => !o)}
            onToggleView={() => setView((v) => (v === "grid" ? "circle" : "grid"))}
            onTakeSeat={takeSeat}
            onLeaveSeat={leaveSeat}
            onLeaveRoom={leaveRoom}
          />
          <Reactions items={reactions} />
        </div>
      )}

      <Notice
        text={audioBlocked ? "tap anywhere to turn on sound" : notice}
        onClick={audioBlocked ? () => setAudioBlocked(false) : undefined}
      />
      {hud && <DebugHud seats={occupied} myId={me.sid} role={me.role} />}
    </>
  );
}

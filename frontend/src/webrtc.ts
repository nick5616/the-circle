import { socket } from "./socket";

const peers = new Map<string, RTCPeerConnection>();

// ICE candidates that arrived before setRemoteDescription was called
const iceQueues = new Map<string, RTCIceCandidateInit[]>();

// Session IDs that were deliberately closed by us — don't fire disconnect callbacks for these
const intentionallyClosed = new Set<string>();

// Called by App to hand the local stream in after getUserMedia
let _localStream: MediaStream | null = null;

// Called by App when remote streams arrive/leave; App subscribes via onStream
type StreamCallback = (sessionId: string, stream: MediaStream | null) => void;
let _onStream: StreamCallback = () => {};

// Called by App when a peer connection genuinely fails (not a deliberate close)
type DisconnectCallback = (sessionId: string) => void;
let _onDisconnect: DisconnectCallback = () => {};

function makePeerConnection(remoteId: string): RTCPeerConnection {
  // A new connection replaces any intentional-close tracking for this peer
  intentionallyClosed.delete(remoteId);

  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  // Send ICE candidates as they are gathered
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      socket.send({ type: "ice", payload: { target: remoteId, candidate: candidate.toJSON() } });
    }
  };

  // Surface remote tracks to App
  pc.ontrack = (event) => {
    const stream = event.streams[0];
    if (stream) {
      _onStream(remoteId, stream);
    } else if (event.track) {
      // Fallback: synthesize a stream from the track (some browsers omit streams)
      const synth = new MediaStream([event.track]);
      _onStream(remoteId, synth);
    }
  };

  // Detect genuine ICE failures and notify App so it can retry signaling.
  // We skip this if the connection was intentionally closed by us (peer left, etc.)
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed" && !intentionallyClosed.has(remoteId)) {
      if (peers.get(remoteId) === pc) {
        pc.close();
        peers.delete(remoteId);
        iceQueues.delete(remoteId);
        _onStream(remoteId, null);
        _onDisconnect(remoteId);
      }
    }
  };

  // Add local tracks so the remote side receives our media
  if (_localStream) {
    for (const track of _localStream.getTracks()) {
      pc.addTrack(track, _localStream);
    }
  }

  peers.set(remoteId, pc);
  return pc;
}

export const webrtc = {
  setLocalStream(stream: MediaStream): void {
    _localStream = stream;
  },

  setStreamCallback(cb: StreamCallback): void {
    _onStream = cb;
  },

  setDisconnectCallback(cb: DisconnectCallback): void {
    _onDisconnect = cb;
  },

  /** Called by existing participants when a new participant's session_id appears.
   *  Also called by audience members (no local stream) to receive-only from participants. */
  async createOffer(targetId: string): Promise<void> {
    const pc = makePeerConnection(targetId);
    // Audience members have no local stream — add recvonly transceivers so the
    // SDP offer asks the participant to send their tracks.
    if (!_localStream) {
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });
    }
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.send({ type: "offer", payload: { target: targetId, sdp: pc.localDescription! } });
  },

  /** Called when we receive an offer from a peer. */
  async handleOffer(fromId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    peers.get(fromId)?.close();
    iceQueues.delete(fromId);
    const pc = makePeerConnection(fromId);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    // Flush any ICE candidates that arrived before the offer
    for (const c of iceQueues.get(fromId) ?? []) {
      await pc.addIceCandidate(new RTCIceCandidate(c));
    }
    iceQueues.delete(fromId);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.send({ type: "answer", payload: { target: fromId, sdp: pc.localDescription! } });
  },

  async handleAnswer(fromId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const pc = peers.get(fromId);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    // Flush any ICE candidates that arrived before the answer
    for (const c of iceQueues.get(fromId) ?? []) {
      await pc.addIceCandidate(new RTCIceCandidate(c));
    }
    iceQueues.delete(fromId);
  },

  async handleIce(fromId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = peers.get(fromId);
    if (!pc || !pc.remoteDescription) {
      // Buffer until remote description is set
      const q = iceQueues.get(fromId) ?? [];
      q.push(candidate);
      iceQueues.set(fromId, q);
      return;
    }
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  },

  closeConnection(sessionId: string): void {
    intentionallyClosed.add(sessionId);
    peers.get(sessionId)?.close();
    peers.delete(sessionId);
    iceQueues.delete(sessionId);
    _onStream(sessionId, null);
  },

  closeAll(): void {
    for (const id of peers.keys()) intentionallyClosed.add(id);
    peers.forEach((pc) => pc.close());
    peers.clear();
    iceQueues.clear();
    _localStream = null;
  },
};

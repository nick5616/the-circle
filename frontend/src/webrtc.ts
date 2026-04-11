import { socket } from "./socket";

const peers = new Map<string, RTCPeerConnection>();

// Called by App to hand the local stream in after getUserMedia
let _localStream: MediaStream | null = null;

// Called by App when remote streams arrive/leave; App subscribes via onStream
type StreamCallback = (sessionId: string, stream: MediaStream | null) => void;
let _onStream: StreamCallback = () => {};

function makePeerConnection(remoteId: string): RTCPeerConnection {
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
    const [stream] = event.streams;
    if (stream) _onStream(remoteId, stream);
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

  /** Called by existing participants when a new participant's session_id appears. */
  async createOffer(targetId: string): Promise<void> {
    const pc = makePeerConnection(targetId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.send({ type: "offer", payload: { target: targetId, sdp: pc.localDescription! } });
  },

  /** Called when we receive an offer from a peer. */
  async handleOffer(fromId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const pc = makePeerConnection(fromId);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.send({ type: "answer", payload: { target: fromId, sdp: pc.localDescription! } });
  },

  async handleAnswer(fromId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const pc = peers.get(fromId);
    if (pc) await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  },

  async handleIce(fromId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = peers.get(fromId);
    if (pc) await pc.addIceCandidate(new RTCIceCandidate(candidate));
  },

  closeConnection(sessionId: string): void {
    peers.get(sessionId)?.close();
    peers.delete(sessionId);
    _onStream(sessionId, null);
  },

  closeAll(): void {
    peers.forEach((pc) => pc.close());
    peers.clear();
    _localStream = null;
  },
};

/**
 * WebRTC peer connection logic.
 *
 * Manages a map of RTCPeerConnection instances keyed by remote session_id.
 * Sends signaling messages (offer/answer/ice) via the socket singleton.
 */

// TODO: implement peer connection creation, offer/answer/ice handling, cleanup

export const webrtc = {
  localStream: null as MediaStream | null,

  async startLocalStream(): Promise<MediaStream> {
    // getUserMedia({ video: true, audio: true })
    return new MediaStream();
  },

  async createOffer(targetSessionId: string): Promise<void> {
    // create RTCPeerConnection, add tracks, create offer, send via socket
  },

  async handleOffer(fromSessionId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    // setRemoteDescription, createAnswer, send via socket
  },

  async handleAnswer(fromSessionId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    // setRemoteDescription
  },

  async handleIce(fromSessionId: string, candidate: RTCIceCandidateInit): Promise<void> {
    // addIceCandidate
  },

  closeConnection(sessionId: string): void {
    // close and remove peer connection
  },

  closeAll(): void {
    // close all peer connections
  },
};

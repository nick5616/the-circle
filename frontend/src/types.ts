// Shared message types for the websocket protocol

export type Role = "participant" | "audience";

export interface Seat {
  session_id: string;
  name: string;
  mic: boolean;
  cam: boolean;
  screen?: boolean; // sharing their screen
  screen_at?: string | null; // when the current share started; newest takes the spotlight
  away: boolean; // socket dropped; seat held during the grace period
}

// A question card someone drew; it sits on the fire for the whole room
export interface Spark {
  id: string;
  text: string;
  by: string;
  at: string;
}

// Server-rendered fun: "/me waves", "/roll", "/flip", "/ask", and drawn sparks
export type ChatFlavor = "me" | "roll" | "flip" | "ask" | "spark";

export interface ChatMessage {
  id: string;
  sid?: string;
  sender: string;
  content: string;
  timestamp: string;
  flavor?: ChatFlavor;
}

export interface SignalPayload {
  pcid: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit | null;
  kick?: boolean; // "I have no connection with your pcid — please (re)offer"
}

export type Reaction = "🔥" | "🫶" | "✨" | "😂" | "🥹" | "🪵";
export const REACTIONS: Reaction[] = ["🔥", "🫶", "✨", "😂", "🥹", "🪵"];

// Soft things you can throw at someone's tile
export type Throwable = "🍡" | "🌸" | "💌" | "🍪" | "🧦" | "🎈" | "🐸";
export const THROWABLES: Throwable[] = ["🍡", "🌸", "💌", "🍪", "🧦", "🎈", "🐸"];

// ---- Client → Server ----

export type ClientMessage =
  | { type: "ping"; payload: { t: number } }
  | { type: "join"; payload: { name: string; role: Role } }
  | { type: "chat"; payload: { content: string } }
  | { type: "signal"; payload: SignalPayload & { target: string } }
  | { type: "media"; payload: { mic: boolean; cam: boolean; screen: boolean } }
  | { type: "react"; payload: { emoji: Reaction } }
  | { type: "toss"; payload: { target: string; item: Throwable } }
  | { type: "spark"; payload?: undefined }
  | { type: "take_seat"; payload?: undefined }
  | { type: "leave_seat"; payload?: undefined }
  | { type: "bye"; payload?: undefined }
  | { type: "telemetry"; payload: Record<string, unknown> };

// ---- Server → Client ----

export interface RoomSnapshot {
  room: string;
  spark: Spark | null;
  seats: Array<Seat | null>; // length 8, indexed by seat position, null = empty
  audience_count: number;
  your_session_id: string;
  your_role: Role;
}

export type ServerMessage =
  | {
      type: "hello";
      payload: {
        session_id: string;
        token: string;
        resumed: boolean;
        role: Role | null;
        name: string;
        room: string;
        ice_servers: RTCIceServer[];
        grace_seconds: number;
      };
    }
  | { type: "joined"; payload: { role: Role; name: string; session_id: string } }
  | { type: "room_state"; payload: RoomSnapshot }
  | { type: "chat"; payload: ChatMessage }
  | { type: "chat_history"; payload: { messages: ChatMessage[] } }
  | { type: "signal"; payload: SignalPayload & { from: string } }
  | { type: "peer_gone"; payload: { session_id: string } }
  | { type: "reaction"; payload: { session_id: string; name: string; emoji: Reaction } }
  | { type: "toss"; payload: { from: string; name: string; to: string; item: Throwable } }
  | { type: "seat_denied"; payload: { reason: string } }
  | { type: "pong"; payload: { t: number } };

// ---- Client-side UI ----

export type FeedItem =
  | ({ kind: "chat" } & ChatMessage)
  | { kind: "event"; id: string; name: string; text: string; timestamp: string };

export type WsStatus = "connecting" | "open" | "reconnecting";

export type PeerHealth = "connecting" | "connected" | "reconnecting" | "failed";
export type PeerQuality = "good" | "fair" | "poor" | "unknown";

export interface PeerInfo {
  health: PeerHealth;
  quality: PeerQuality;
}

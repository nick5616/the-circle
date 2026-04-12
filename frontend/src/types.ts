// Shared message types for WebSocket protocol

export type Role = "participant" | "audience";

export interface Seat {
  session_id: string;
  name: string;
}

export interface ChatMessage {
  sender: string;
  content: string;
  timestamp: string;
}

// ---- Client → Server ----

export interface JoinMessage {
  type: "join";
  payload: { name: string; role: Role };
}

export interface SendChatMessage {
  type: "chat";
  payload: { content: string };
}

export interface OfferMessage {
  type: "offer";
  payload: { target: string; sdp: RTCSessionDescriptionInit };
}

export interface AnswerMessage {
  type: "answer";
  payload: { target: string; sdp: RTCSessionDescriptionInit };
}

export interface IceMessage {
  type: "ice";
  payload: { target: string; candidate: RTCIceCandidateInit };
}

export interface TakeSeatMessage {
  type: "take_seat";
}

export interface LeaveSeatMessage {
  type: "leave_seat";
}

export type ClientMessage =
  | JoinMessage
  | SendChatMessage
  | OfferMessage
  | AnswerMessage
  | IceMessage
  | TakeSeatMessage
  | LeaveSeatMessage;

// ---- Server → Client ----

export interface RoomStateMessage {
  type: "room_state";
  payload: {
    seats: Array<Seat | null>; // length 8, null = empty
    audience_count: number;
    your_session_id: string;
    your_role: Role;
  };
}

export interface ReceivedChatMessage {
  type: "chat";
  payload: ChatMessage;
}

export interface ChatHistoryMessage {
  type: "chat_history";
  payload: { messages: ChatMessage[] };
}

export interface ReceivedOfferMessage {
  type: "offer";
  payload: { from: string; sdp: RTCSessionDescriptionInit };
}

export interface ReceivedAnswerMessage {
  type: "answer";
  payload: { from: string; sdp: RTCSessionDescriptionInit };
}

export interface ReceivedIceMessage {
  type: "ice";
  payload: { from: string; candidate: RTCIceCandidateInit };
}

export interface ParticipantLeftMessage {
  type: "participant_left";
  payload: { session_id: string };
}

export interface SeatDeniedMessage {
  type: "seat_denied";
  payload: { reason: string };
}

export type ServerMessage =
  | RoomStateMessage
  | ReceivedChatMessage
  | ChatHistoryMessage
  | ReceivedOfferMessage
  | ReceivedAnswerMessage
  | ReceivedIceMessage
  | ParticipantLeftMessage
  | SeatDeniedMessage;

// ---- Client-side UI ----

export type FeedItem =
  | { kind: "chat"; sender: string; content: string; timestamp: string }
  | { kind: "event"; name: string; text: string; timestamp: string };

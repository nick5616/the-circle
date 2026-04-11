/**
 * WebSocket client singleton.
 * Connects to /ws/room/ and dispatches incoming messages to registered handlers.
 */

import type { ClientMessage, ServerMessage } from "./types";

type MessageHandler = (msg: ServerMessage) => void;

// TODO: implement connection, send, and handler registration
export const socket = {
  connect(): void {
    // open WebSocket to /ws/room/
  },

  send(msg: ClientMessage): void {
    // JSON.stringify and send over socket
  },

  onMessage(handler: MessageHandler): () => void {
    // register handler, return unsubscribe fn
    return () => {};
  },

  disconnect(): void {
    // close socket
  },
};

import type { ClientMessage, ServerMessage } from "./types";

type MessageHandler = (msg: ServerMessage) => void;

let ws: WebSocket | null = null;
const handlers = new Set<MessageHandler>();
const queue: string[] = []; // messages buffered while connecting

export const socket = {
  connect(): void {
    if (ws && ws.readyState < WebSocket.CLOSING) return;

    const protocol = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${protocol}://${location.host}/ws/room/`);

    ws.addEventListener("open", () => {
      // Flush any messages that were sent before the socket opened
      while (queue.length) {
        ws?.send(queue.shift()!);
      }
    });

    ws.addEventListener("message", (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }
      handlers.forEach((h) => h(msg));
    });

    ws.addEventListener("close", () => {
      ws = null;
    });
  },

  send(msg: ClientMessage): void {
    const payload = JSON.stringify(msg);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(payload);
    } else {
      // Buffer until open
      queue.push(payload);
    }
  },

  onMessage(handler: MessageHandler): () => void {
    handlers.add(handler);
    return () => handlers.delete(handler);
  },

  disconnect(): void {
    queue.length = 0;
    ws?.close();
    ws = null;
  },
};

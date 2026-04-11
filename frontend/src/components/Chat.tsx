/**
 * Chat sidebar.
 *
 * Scrollable message list + input box at the bottom.
 * Audience members see a "Take a Seat" button in the header when seats are open.
 */

import type { ChatMessage } from "../types";

interface Props {
  messages: ChatMessage[];
  role: "participant" | "audience";
  seatsAvailable: boolean;
  onSend: (content: string) => void;
  onTakeSeat: () => void;
}

export default function Chat(_props: Props) {
  // TODO
  return <div>Chat</div>;
}

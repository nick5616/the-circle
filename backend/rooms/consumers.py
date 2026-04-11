from channels.generic.websocket import AsyncWebsocketConsumer


class RoomConsumer(AsyncWebsocketConsumer):
    """
    Handles all WebSocket traffic for the single global room.

    Message types handled (client → server):
      join, chat, offer, answer, ice, take_seat, leave_seat

    Messages sent (server → client):
      room_state, chat, chat_history, offer, answer, ice,
      participant_left, seat_denied
    """

    async def connect(self):
        # TODO: assign session_id, add to group, send room_state + chat_history
        pass

    async def disconnect(self, close_code):
        # TODO: vacate seat if participant, broadcast room_state, decrement audience
        pass

    async def receive(self, text_data):
        # TODO: parse JSON, route to handler by type
        pass

    # --- client → server handlers ---

    async def handle_join(self, payload):
        pass

    async def handle_chat(self, payload):
        pass

    async def handle_offer(self, payload):
        pass

    async def handle_answer(self, payload):
        pass

    async def handle_ice(self, payload):
        pass

    async def handle_take_seat(self, payload):
        pass

    async def handle_leave_seat(self, payload):
        pass

    # --- channel layer event handlers (group → this socket) ---

    async def broadcast_room_state(self, event):
        pass

    async def broadcast_chat(self, event):
        pass

    async def broadcast_participant_left(self, event):
        pass

    async def direct_signal(self, event):
        """Forward WebRTC signaling (offer/answer/ice) to a specific peer."""
        pass

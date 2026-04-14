import json
import time
import uuid
from datetime import datetime, timezone

import redis.asyncio as aioredis
from channels.generic.websocket import AsyncWebsocketConsumer
from django.conf import settings

from . import room_state as rs

GROUP_NAME = "global_room"

# Max WebRTC signal messages (offer/answer/ice) per connection per second
_SIGNAL_RATE_LIMIT = 30


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class RoomConsumer(AsyncWebsocketConsumer):
    """
    Handles all WebSocket traffic for the single global room.

    Client → Server:  join, chat, offer, answer, ice, take_seat, leave_seat
    Server → Client:  room_state, chat, chat_history, offer, answer, ice,
                      participant_left, seat_denied
    """

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def connect(self):
        self.session_id = str(uuid.uuid4())
        self.role = None  # set during handle_join
        # Sliding-window rate limiter state for WebRTC signaling messages
        self._signal_window_start = time.monotonic()
        self._signal_count = 0
        self.redis = aioredis.from_url(
            settings.CHANNEL_LAYERS["default"]["CONFIG"]["hosts"][0],
            decode_responses=False,
        )

        # Register this socket's channel name so peers can signal directly to it
        await rs.set_session_channel(self.redis, self.session_id, self.channel_name)

        await self.channel_layer.group_add(GROUP_NAME, self.channel_name)
        await self.accept()
        # Push current room snapshot so the lobby can display live counts
        # before the user has clicked Join.
        await self._send_room_state_to_self()

    async def disconnect(self, close_code):
        if self.role == "participant":
            await rs.vacate_seat(self.redis, self.session_id)
            await self._broadcast_room_state()
            await self.channel_layer.group_send(
                GROUP_NAME,
                {
                    "type": "broadcast_participant_left",
                    "session_id": self.session_id,
                },
            )
        elif self.role == "audience":
            await rs.decrement_audience(self.redis)
            await self._broadcast_room_state()

        await rs.delete_session(self.redis, self.session_id)
        await self.channel_layer.group_discard(GROUP_NAME, self.channel_name)
        await self.redis.aclose()

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            return

        msg_type = data.get("type")
        payload = data.get("payload", {})

        handlers = {
            "join": self.handle_join,
            "chat": self.handle_chat,
            "offer": self.handle_offer,
            "answer": self.handle_answer,
            "ice": self.handle_ice,
            "take_seat": self.handle_take_seat,
            "leave_seat": self.handle_leave_seat,
        }

        handler = handlers.get(msg_type)
        if handler:
            await handler(payload)

    # ------------------------------------------------------------------
    # Client → Server handlers
    # ------------------------------------------------------------------

    async def handle_join(self, payload: dict):
        name = (payload.get("name") or "Anonymous").strip()[:50]
        role = payload.get("role")

        if role == "participant":
            claimed = await rs.claim_seat(
                self.redis, self.session_id, name, self.channel_name
            )
            if not claimed:
                await self._send(
                    {"type": "seat_denied", "payload": {"reason": "Room is full"}}
                )
                # Fall back to audience
                role = "audience"

        if role == "audience":
            await rs.increment_audience(self.redis)

        self.role = role
        self.name = name

        # Send the current room snapshot and chat history to this client
        await self._send_room_state_to_self()
        history = await rs.get_chat_history(self.redis)
        await self._send({"type": "chat_history", "payload": {"messages": history}})

        # Notify everyone else that the room state changed
        await self._broadcast_room_state()

    async def handle_chat(self, payload: dict):
        content = (payload.get("content") or "").strip()
        if not content:
            return

        message = {
            "sender": getattr(self, "name", "Anonymous"),
            "content": content[:1000],
            "timestamp": _now(),
        }
        await rs.append_chat(self.redis, message)
        await self.channel_layer.group_send(
            GROUP_NAME,
            {"type": "broadcast_chat", "message": message},
        )

    async def handle_offer(self, payload: dict):
        if not self._check_signal_rate():
            return
        await self._forward_signal("offer", payload)

    async def handle_answer(self, payload: dict):
        if not self._check_signal_rate():
            return
        await self._forward_signal("answer", payload)

    async def handle_ice(self, payload: dict):
        if not self._check_signal_rate():
            return
        await self._forward_signal("ice", payload)

    async def handle_take_seat(self, payload: dict):
        if self.role != "audience":
            return

        claimed = await rs.claim_seat(
            self.redis, self.session_id, getattr(self, "name", "Anonymous"), self.channel_name
        )
        if not claimed:
            await self._send(
                {"type": "seat_denied", "payload": {"reason": "Room is full"}}
            )
            return

        await rs.decrement_audience(self.redis)
        self.role = "participant"
        await self._broadcast_room_state()

    async def handle_leave_seat(self, payload: dict):
        if self.role != "participant":
            return

        await rs.vacate_seat(self.redis, self.session_id)
        await rs.increment_audience(self.redis)
        self.role = "audience"

        await self._broadcast_room_state()
        await self.channel_layer.group_send(
            GROUP_NAME,
            {
                "type": "broadcast_participant_left",
                "session_id": self.session_id,
            },
        )

    # ------------------------------------------------------------------
    # Channel layer event handlers (group message → this socket)
    # ------------------------------------------------------------------

    async def broadcast_room_state(self, event: dict):
        await self._send(
            {
                "type": "room_state",
                "payload": {
                    **event["payload"],
                    "your_session_id": self.session_id,
                    "your_role": self.role or "audience",
                },
            }
        )

    async def broadcast_chat(self, event: dict):
        await self._send({"type": "chat", "payload": event["message"]})

    async def broadcast_participant_left(self, event: dict):
        await self._send(
            {"type": "participant_left", "payload": {"session_id": event["session_id"]}}
        )

    async def direct_signal(self, event: dict):
        """Deliver a WebRTC signaling message addressed to this specific peer."""
        await self._send({"type": event["signal_type"], "payload": event["payload"]})

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def _send(self, data: dict):
        await self.send(text_data=json.dumps(data))

    async def _build_room_payload(self) -> dict:
        seats_map = await rs.get_seats(self.redis)
        audience_count = await rs.get_audience_count(self.redis)

        # Build a fixed-length list of 8 slots (null = empty)
        seats_list = [None] * rs.MAX_SEATS
        for i, (sid, info) in enumerate(seats_map.items()):
            if i >= rs.MAX_SEATS:
                break
            seats_list[i] = {"session_id": sid, "name": info["name"]}

        return {
            "seats": seats_list,
            "audience_count": audience_count,
        }

    async def _send_room_state_to_self(self):
        payload = await self._build_room_payload()
        await self._send(
            {
                "type": "room_state",
                "payload": {
                    **payload,
                    "your_session_id": self.session_id,
                    "your_role": self.role or "audience",
                },
            }
        )

    async def _broadcast_room_state(self):
        payload = await self._build_room_payload()
        await self.channel_layer.group_send(
            GROUP_NAME,
            {"type": "broadcast_room_state", "payload": payload},
        )

    def _check_signal_rate(self) -> bool:
        """
        Sliding 1-second window: allow up to _SIGNAL_RATE_LIMIT signal messages
        per connection per second.  Returns True if the message should proceed.
        """
        now = time.monotonic()
        if now - self._signal_window_start >= 1.0:
            self._signal_window_start = now
            self._signal_count = 0
        self._signal_count += 1
        return self._signal_count <= _SIGNAL_RATE_LIMIT

    async def _forward_signal(self, signal_type: str, payload: dict):
        """Route an offer/answer/ice message to the target peer by session_id."""
        target_id = payload.get("target")
        if not target_id:
            return

        target_channel = await rs.get_session_channel(self.redis, target_id)
        if not target_channel:
            return

        # Rewrite payload: replace 'target' with 'from' for the recipient
        outbound_payload = {k: v for k, v in payload.items() if k != "target"}
        outbound_payload["from"] = self.session_id

        await self.channel_layer.send(
            target_channel,
            {
                "type": "direct_signal",
                "signal_type": signal_type,
                "payload": outbound_payload,
            },
        )

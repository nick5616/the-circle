import asyncio
import hmac
import json
import logging
import re
import secrets
import time
import uuid
from datetime import datetime, timezone
from urllib.parse import parse_qs

import redis.asyncio as aioredis
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.layers import get_channel_layer
from django.conf import settings

from . import room_state as rs
from .ice import get_ice_servers

GROUP_NAME = "global_room"

# How long a seat is held for a socket that dropped without saying goodbye.
# Covers wifi blips, phone lock screens, Cloud Run request timeouts and deploys:
# the client reconnects with its resume token and peers never notice.
GRACE_SECONDS = 30

REACTIONS = {"🔥", "🫶", "✨", "😂", "🥹", "🪵"}

log = logging.getLogger("circle")
telemetry_log = logging.getLogger("circle.telemetry")

# Strong refs so grace-period tasks aren't garbage collected mid-sleep
_background: set[asyncio.Task] = set()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _redis():
    return aioredis.from_url(settings.CHANNEL_LAYERS["default"]["CONFIG"]["hosts"][0])


def _clean_name(raw) -> str:
    name = re.sub(r"\s+", " ", str(raw or "")).strip()[:32]
    return name or "someone"


class Bucket:
    """Token bucket: allows bursts up to `capacity`, refills at `rate`/s."""

    def __init__(self, capacity: float, rate: float):
        self.capacity = capacity
        self.rate = rate
        self.tokens = capacity
        self.stamp = time.monotonic()

    def take(self) -> bool:
        now = time.monotonic()
        self.tokens = min(self.capacity, self.tokens + (now - self.stamp) * self.rate)
        self.stamp = now
        if self.tokens >= 1:
            self.tokens -= 1
            return True
        return False


async def _broadcast_room(redis, layer) -> None:
    await layer.group_send(GROUP_NAME, {"type": "room.state", "payload": await rs.room_payload(redis)})


async def _finalize_leave(redis, layer, sid: str) -> None:
    await rs.vacate_seat(redis, sid)
    await rs.remove_audience(redis, sid)
    await rs.delete_session(redis, sid)
    await _broadcast_room(redis, layer)
    await layer.group_send(GROUP_NAME, {"type": "peer.gone", "sid": sid})


async def _expire_after_grace(sid: str, gen: int) -> None:
    await asyncio.sleep(GRACE_SECONDS)
    redis = _redis()
    try:
        sess = await rs.get_session(redis, sid)
        if sess and not sess.get("channel") and int(sess.get("gen") or 0) == gen:
            log.info("grace expired sid=%s name=%s", sid[:8], sess.get("name"))
            await _finalize_leave(redis, get_channel_layer(), sid)
    except Exception:
        log.exception("grace expiry failed sid=%s", sid[:8])
    finally:
        await redis.aclose()


class RoomConsumer(AsyncWebsocketConsumer):
    """
    All websocket traffic for the single global room.

    Client → Server: join, chat, signal, media, react, take_seat, leave_seat,
                     ping, bye, telemetry
    Server → Client: hello, joined, room_state, chat, chat_history, signal,
                     peer_gone, reaction, seat_denied, pong
    """

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def connect(self):
        self.redis = _redis()
        self.sid: str | None = None
        self.role: str | None = None
        self.name = ""
        self.closing_reason: str | None = None  # "bye" | "takeover"
        self.signal_bucket = Bucket(400, 120)
        self.chat_bucket = Bucket(8, 1)
        self.react_bucket = Bucket(12, 4)
        self.telemetry_bucket = Bucket(10, 0.5)
        self.last_reap = 0.0

        await self.channel_layer.group_add(GROUP_NAME, self.channel_name)
        await self.accept()

        qs = parse_qs(self.scope.get("query_string", b"").decode())
        resume_sid = (qs.get("sid") or [""])[0]
        resume_token = (qs.get("token") or [""])[0]
        resumed = await self._try_resume(resume_sid, resume_token)

        if not resumed:
            self.sid = str(uuid.uuid4())
            self.token = secrets.token_urlsafe(24)
            await rs.create_session(self.redis, self.sid, self.token, self.channel_name)

        await self._send({
            "type": "hello",
            "payload": {
                "session_id": self.sid,
                "token": self.token,
                "resumed": resumed,
                "role": self.role,
                "name": self.name,
                "ice_servers": get_ice_servers(),
                "grace_seconds": GRACE_SECONDS,
            },
        })
        await self._send_room_state_to_self()
        if resumed and self.role:
            await self._send({"type": "chat_history", "payload": {"messages": await rs.get_chat_history(self.redis)}})
            await _broadcast_room(self.redis, self.channel_layer)

    async def _try_resume(self, sid: str, token: str) -> bool:
        if not sid or not token:
            return False
        sess = await rs.get_session(self.redis, sid)
        if not sess or not hmac.compare_digest(sess.get("token", ""), token):
            return False

        self.sid, self.token = sid, token
        self.name = sess.get("name", "")
        self.role = sess.get("role") or None
        old_channel = sess.get("channel")
        await rs.update_session(self.redis, sid, channel=self.channel_name)
        await rs.touch_alive(self.redis, sid)
        if old_channel and old_channel != self.channel_name:
            # The old socket is a zombie (e.g. TCP not yet timed out). Retire it quietly.
            await self.channel_layer.send(old_channel, {"type": "session.takeover"})

        if self.role == "participant":
            if not await rs.update_seat(self.redis, sid, away=False):
                # Seat was reaped while we were gone — try to get one back
                if not await rs.claim_seat(self.redis, sid, self.name):
                    self.role = "audience"
                    await rs.add_audience(self.redis, sid, self.name)
                    await rs.update_session(self.redis, sid, role="audience")
        elif self.role == "audience":
            await rs.add_audience(self.redis, sid, self.name)

        log.info("resumed sid=%s name=%s role=%s", sid[:8], self.name, self.role)
        return True

    async def disconnect(self, close_code):
        await self.channel_layer.group_discard(GROUP_NAME, self.channel_name)
        try:
            if self.sid is None or self.closing_reason == "takeover":
                return
            sess = await rs.get_session(self.redis, self.sid)
            if sess is None or sess.get("channel") != self.channel_name:
                return  # already finalized, or a newer socket owns this session

            if not self.role:
                await rs.delete_session(self.redis, self.sid)  # lobby-only visitor
            elif self.closing_reason == "bye":
                await _finalize_leave(self.redis, self.channel_layer, self.sid)
            else:
                # Abnormal drop: keep the seat warm and let the client resume
                await rs.update_session(self.redis, self.sid, channel="")
                gen = await rs.bump_gen(self.redis, self.sid)
                if self.role == "participant":
                    await rs.update_seat(self.redis, self.sid, away=True)
                    await _broadcast_room(self.redis, self.channel_layer)
                log.info("dropped sid=%s name=%s code=%s — holding %ss", self.sid[:8], self.name, close_code, GRACE_SECONDS)
                task = asyncio.create_task(_expire_after_grace(self.sid, gen))
                _background.add(task)
                task.add_done_callback(_background.discard)
        finally:
            await self.redis.aclose()

    async def receive(self, text_data=None, bytes_data=None):
        if not text_data or len(text_data) > 64_000:
            return
        try:
            data = json.loads(text_data)
        except json.JSONDecodeError:
            return
        if not isinstance(data, dict):
            return

        payload = data.get("payload") or {}
        if not isinstance(payload, dict):
            return

        handler = {
            "ping": self.handle_ping,
            "join": self.handle_join,
            "chat": self.handle_chat,
            "signal": self.handle_signal,
            "media": self.handle_media,
            "react": self.handle_react,
            "take_seat": self.handle_take_seat,
            "leave_seat": self.handle_leave_seat,
            "bye": self.handle_bye,
            "telemetry": self.handle_telemetry,
        }.get(data.get("type"))
        if handler:
            try:
                await handler(payload)
            except Exception:
                log.exception("handler %s failed sid=%s", data.get("type"), (self.sid or "")[:8])

    # ------------------------------------------------------------------
    # Client → Server handlers
    # ------------------------------------------------------------------

    async def handle_ping(self, payload: dict):
        await rs.touch_alive(self.redis, self.sid)
        await self._send({"type": "pong", "payload": {"t": payload.get("t")}})
        now = time.monotonic()
        if now - self.last_reap > 15:
            self.last_reap = now
            await self._reap()

    async def _reap(self):
        # One reaper at a time across all instances
        if not await self.redis.set("room:reap_lock", 1, nx=True, ex=10):
            return
        dead = await rs.reap_dead(self.redis)
        if dead:
            log.info("reaped %d dead sessions", len(dead))
            await _broadcast_room(self.redis, self.channel_layer)
            for sid in dead:
                await self.channel_layer.group_send(GROUP_NAME, {"type": "peer.gone", "sid": sid})

    async def handle_join(self, payload: dict):
        if self.role:
            await self._send_joined()
            return

        self.name = _clean_name(payload.get("name"))
        role = payload.get("role")
        if role not in ("participant", "audience"):
            role = "audience"

        if role == "participant" and not await rs.claim_seat(self.redis, self.sid, self.name):
            await self._send({"type": "seat_denied", "payload": {"reason": "full"}})
            role = "audience"
        if role == "audience":
            await rs.add_audience(self.redis, self.sid, self.name)

        self.role = role
        await rs.update_session(self.redis, self.sid, name=self.name, role=role)
        log.info("join sid=%s name=%s role=%s", self.sid[:8], self.name, role)

        await self._send_joined()
        await self._send({"type": "chat_history", "payload": {"messages": await rs.get_chat_history(self.redis)}})
        await _broadcast_room(self.redis, self.channel_layer)

    async def handle_chat(self, payload: dict):
        if not self.role or not self.chat_bucket.take():
            return
        content = str(payload.get("content") or "").strip()[:500]
        if not content:
            return
        message = {
            "id": uuid.uuid4().hex[:12],
            "sid": self.sid,
            "sender": self.name,
            "content": content,
            "timestamp": _now(),
        }
        await rs.append_chat(self.redis, message)
        await self.channel_layer.group_send(GROUP_NAME, {"type": "chat.message", "message": message})

    async def handle_signal(self, payload: dict):
        if not self.role or not self.signal_bucket.take():
            return
        target = payload.get("target")
        if not isinstance(target, str) or target == self.sid:
            return
        sess = await rs.get_session(self.redis, target)
        if not sess or not sess.get("channel"):
            return  # peer is away; the sender's watchdog will retry after resume

        out = {"from": self.sid, "pcid": str(payload.get("pcid") or "")[:40]}
        for key in ("description", "candidate", "kick"):
            if key in payload:
                out[key] = payload[key]
        await self.channel_layer.send(sess["channel"], {"type": "direct.signal", "payload": out})

    async def handle_media(self, payload: dict):
        if self.role != "participant":
            return
        if await rs.update_seat(self.redis, self.sid, mic=bool(payload.get("mic")), cam=bool(payload.get("cam"))):
            await _broadcast_room(self.redis, self.channel_layer)

    async def handle_react(self, payload: dict):
        emoji = payload.get("emoji")
        if not self.role or emoji not in REACTIONS or not self.react_bucket.take():
            return
        await self.channel_layer.group_send(
            GROUP_NAME,
            {"type": "reaction", "payload": {"session_id": self.sid, "name": self.name, "emoji": emoji}},
        )

    async def handle_take_seat(self, payload: dict):
        if self.role != "audience":
            return
        if not await rs.claim_seat(self.redis, self.sid, self.name):
            await self._send({"type": "seat_denied", "payload": {"reason": "full"}})
            return
        await rs.remove_audience(self.redis, self.sid)
        self.role = "participant"
        await rs.update_session(self.redis, self.sid, role="participant")
        await self._send_joined()
        await _broadcast_room(self.redis, self.channel_layer)

    async def handle_leave_seat(self, payload: dict):
        if self.role != "participant":
            return
        await rs.vacate_seat(self.redis, self.sid)
        await rs.add_audience(self.redis, self.sid, self.name)
        self.role = "audience"
        await rs.update_session(self.redis, self.sid, role="audience")
        await self._send_joined()
        await _broadcast_room(self.redis, self.channel_layer)

    async def handle_bye(self, payload: dict):
        self.closing_reason = "bye"
        if self.role:
            await _finalize_leave(self.redis, self.channel_layer, self.sid)
            self.role = None
            self.sid = None
        await self.close()

    async def handle_telemetry(self, payload: dict):
        if not self.telemetry_bucket.take():
            return
        line = json.dumps({"sid": (self.sid or "")[:8], "name": self.name, "role": self.role, **payload})
        telemetry_log.info(line[:6000])

    # ------------------------------------------------------------------
    # Channel layer events (group / direct message → this socket)
    # ------------------------------------------------------------------

    async def room_state(self, event: dict):
        await self._send({
            "type": "room_state",
            "payload": {**event["payload"], "your_session_id": self.sid, "your_role": self.role or "audience"},
        })

    async def chat_message(self, event: dict):
        await self._send({"type": "chat", "payload": event["message"]})

    async def peer_gone(self, event: dict):
        if event["sid"] != self.sid:
            await self._send({"type": "peer_gone", "payload": {"session_id": event["sid"]}})

    async def reaction(self, event: dict):
        await self._send({"type": "reaction", "payload": event["payload"]})

    async def direct_signal(self, event: dict):
        await self._send({"type": "signal", "payload": event["payload"]})

    async def session_takeover(self, event: dict):
        self.closing_reason = "takeover"
        await self.close(code=4001)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def _send(self, data: dict):
        try:
            await self.send(text_data=json.dumps(data))
        except Exception:
            # Socket closed under us (group broadcast racing a disconnect) — nothing to deliver to
            pass

    async def _send_joined(self):
        await self._send({"type": "joined", "payload": {"role": self.role, "name": self.name, "session_id": self.sid}})

    async def _send_room_state_to_self(self):
        payload = await rs.room_payload(self.redis)
        await self._send({
            "type": "room_state",
            "payload": {**payload, "your_session_id": self.sid, "your_role": self.role or "audience"},
        })

"""
Redis interface for all room state.

There is one global room ("main") plus any number of private rooms, each
addressed by a room code. Every room has the same shape:

  room:<rid>:seats     Hash    { sid → JSON {name, idx, joined_at, mic, cam, screen, screen_at, away} }
  room:<rid>:audience  Hash    { sid → name }
  room:<rid>:chat      List    JSON chat messages, LTRIM to CHAT_MAX
  room:<rid>:spark     String  JSON {id, text, by, at} — the question card on the fire

The main room keeps its original key names (room:seats, room:audience,
room:chat) so live seats and chat history survive the deploy that added rooms.

  rooms:active         Set     rids that may have members (walked by the reaper)
  sess:<sid>           Hash    { token, name, role, room, channel, gen }   TTL SESSION_TTL
  alive:<sid>          String  heartbeat, TTL ALIVE_TTL

Liveness: every connected socket refreshes alive:<sid> on each ping. A seat or
audience entry whose alive key has expired belongs to a server process that
died without running disconnect(), and is reaped by reap_dead(). This replaces
wiping the room on startup, which would erase other live instances' state.

Private rooms are ephemeral: their chat and spark expire PRIVATE_TTL after the
last activity, and they drop out of rooms:active once empty.
"""

import json
import re
from datetime import datetime, timezone

from redis.exceptions import WatchError

MAIN = "main"
MAX_SEATS = 8
CHAT_MAX = 100
SESSION_TTL = 3600
ALIVE_TTL = 45
PRIVATE_TTL = 6 * 3600

ROOMS = "rooms:active"

_ROOM_RE = re.compile(r"[^a-z0-9-]+")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _s(v) -> str:
    return v.decode() if isinstance(v, bytes) else (v or "")


def clean_room(raw) -> str:
    """Normalise a user-typed room code: 'Cozy Moth 42' → 'cozy-moth-42'. Empty → main."""
    code = _ROOM_RE.sub("-", str(raw or "").strip().lower().replace("_", "-"))
    code = re.sub(r"-{2,}", "-", code).strip("-")[:32].strip("-")
    return code or MAIN


def key(rid: str, kind: str) -> str:
    return f"room:{kind}" if rid == MAIN else f"room:{rid}:{kind}"


# ─── Sessions ───────────────────────────────────────────────────────────────

async def create_session(redis, sid: str, token: str, channel: str, rid: str) -> None:
    k = f"sess:{sid}"
    await redis.hset(k, mapping={"token": token, "name": "", "role": "", "room": rid, "channel": channel, "gen": 0})
    await redis.expire(k, SESSION_TTL)
    await touch_alive(redis, sid)


async def get_session(redis, sid: str) -> dict | None:
    raw = await redis.hgetall(f"sess:{sid}")
    if not raw:
        return None
    sess = {_s(k): _s(v) for k, v in raw.items()}
    sess["room"] = sess.get("room") or MAIN  # sessions from before rooms existed
    return sess


async def update_session(redis, sid: str, **fields) -> None:
    k = f"sess:{sid}"
    await redis.hset(k, mapping={f: ("" if v is None else v) for f, v in fields.items()})
    await redis.expire(k, SESSION_TTL)


async def bump_gen(redis, sid: str) -> int:
    return int(await redis.hincrby(f"sess:{sid}", "gen", 1))


async def delete_session(redis, sid: str) -> None:
    await redis.delete(f"sess:{sid}", f"alive:{sid}")


async def touch_alive(redis, sid: str) -> None:
    await redis.set(f"alive:{sid}", 1, ex=ALIVE_TTL)


async def mark_active(redis, rid: str) -> None:
    await redis.sadd(ROOMS, rid)


# ─── Seats ──────────────────────────────────────────────────────────────────

async def get_seats(redis, rid: str) -> dict:
    raw = await redis.hgetall(key(rid, "seats"))
    return {_s(k): json.loads(v) for k, v in raw.items()}


async def is_seated(redis, rid: str, sid: str) -> bool:
    return bool(await redis.hexists(key(rid, "seats"), sid))


async def claim_seat(redis, rid: str, sid: str, name: str) -> bool:
    """Atomically claim the lowest free seat index. False if the room is full."""
    seats = key(rid, "seats")
    async with redis.pipeline(transaction=True) as pipe:
        for _ in range(20):
            try:
                await pipe.watch(seats)
                current = {_s(k): json.loads(v) for k, v in (await pipe.hgetall(seats)).items()}
                if sid in current:
                    await pipe.reset()
                    return True
                if len(current) >= MAX_SEATS:
                    await pipe.reset()
                    return False
                used = {info.get("idx") for info in current.values()}
                idx = next(i for i in range(MAX_SEATS) if i not in used)
                pipe.multi()
                pipe.hset(seats, sid, json.dumps({
                    "name": name, "idx": idx, "joined_at": _now(),
                    "mic": True, "cam": True, "screen": False, "away": False,
                }))
                pipe.sadd(ROOMS, rid)
                await pipe.execute()
                return True
            except WatchError:
                continue
    return False


async def update_seat(redis, rid: str, sid: str, **fields) -> bool:
    seats = key(rid, "seats")
    raw = await redis.hget(seats, sid)
    if raw is None:
        return False
    info = json.loads(raw)
    if fields.get("screen") and not info.get("screen"):
        fields["screen_at"] = _now()  # newest share takes the spotlight
    info.update(fields)
    await redis.hset(seats, sid, json.dumps(info))
    return True


async def vacate_seat(redis, rid: str, sid: str) -> bool:
    return bool(await redis.hdel(key(rid, "seats"), sid))


# ─── Audience ───────────────────────────────────────────────────────────────

async def add_audience(redis, rid: str, sid: str, name: str) -> None:
    await redis.hset(key(rid, "audience"), sid, name)
    await redis.sadd(ROOMS, rid)


async def remove_audience(redis, rid: str, sid: str) -> bool:
    return bool(await redis.hdel(key(rid, "audience"), sid))


# ─── Spark (the question card on the fire) ──────────────────────────────────

async def set_spark(redis, rid: str, spark: dict) -> None:
    await redis.set(key(rid, "spark"), json.dumps(spark), ex=PRIVATE_TTL)


async def get_spark(redis, rid: str) -> dict | None:
    raw = await redis.get(key(rid, "spark"))
    return json.loads(raw) if raw else None


# ─── Snapshot + reaping ─────────────────────────────────────────────────────

async def room_payload(redis, rid: str) -> dict:
    seats_map = await get_seats(redis, rid)
    seats: list = [None] * MAX_SEATS
    for sid, info in seats_map.items():
        idx = info.get("idx", 0)
        if 0 <= idx < MAX_SEATS and seats[idx] is None:
            seats[idx] = {
                "session_id": sid,
                "name": info["name"],
                "mic": info.get("mic", True),
                "cam": info.get("cam", True),
                "screen": info.get("screen", False),
                "screen_at": info.get("screen_at"),
                "away": info.get("away", False),
            }
    return {
        "room": rid,
        "seats": seats,
        "audience_count": await redis.hlen(key(rid, "audience")),
        "spark": await get_spark(redis, rid),
    }


async def reap_dead(redis) -> dict[str, list[str]]:
    """Remove seats/audience whose heartbeat expired, in every room. Returns {rid: [reaped sids]}."""
    rids = {_s(r) for r in await redis.smembers(ROOMS)} | {MAIN}
    out: dict[str, list[str]] = {}
    for rid in rids:
        seats, audience = key(rid, "seats"), key(rid, "audience")
        seat_ids = [_s(k) for k in await redis.hkeys(seats)]
        aud_ids = [_s(k) for k in await redis.hkeys(audience)]
        ids = seat_ids + aud_ids
        if not ids:
            if rid != MAIN:
                # Re-added by the next claim/add/ping, so a racing join can't get lost for long
                await redis.srem(ROOMS, rid)
            continue
        alive = await redis.mget([f"alive:{sid}" for sid in ids])
        dead = [sid for sid, a in zip(ids, alive) if a is None]
        for sid in dead:
            await redis.hdel(seats, sid)
            await redis.hdel(audience, sid)
            await redis.delete(f"sess:{sid}")
        if dead:
            out[rid] = dead
    return out


# ─── Chat ───────────────────────────────────────────────────────────────────

async def append_chat(redis, rid: str, message: dict) -> None:
    chat = key(rid, "chat")
    await redis.rpush(chat, json.dumps(message))
    await redis.ltrim(chat, -CHAT_MAX, -1)
    if rid != MAIN:
        await redis.expire(chat, PRIVATE_TTL)


async def get_chat_history(redis, rid: str) -> list:
    return [json.loads(item) for item in await redis.lrange(key(rid, "chat"), 0, -1)]

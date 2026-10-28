"""
Redis interface for all room state.

Keys:
  room:seats      Hash    { sid → JSON {name, idx, joined_at, mic, cam, away} }
  room:audience   Hash    { sid → name }
  room:chat       List    JSON chat messages, LTRIM to CHAT_MAX
  sess:<sid>      Hash    { token, name, role, channel, gen }   TTL SESSION_TTL
  alive:<sid>     String  heartbeat, TTL ALIVE_TTL

Liveness: every connected socket refreshes alive:<sid> on each ping. A seat or
audience entry whose alive key has expired belongs to a server process that
died without running disconnect(), and is reaped by reap_dead(). This replaces
wiping the room on startup, which would erase other live instances' state.
"""

import json
from datetime import datetime, timezone

from redis.exceptions import WatchError

MAX_SEATS = 8
CHAT_MAX = 100
SESSION_TTL = 3600
ALIVE_TTL = 45

SEATS = "room:seats"
AUDIENCE = "room:audience"
CHAT = "room:chat"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _s(v) -> str:
    return v.decode() if isinstance(v, bytes) else (v or "")


# ─── Sessions ───────────────────────────────────────────────────────────────

async def create_session(redis, sid: str, token: str, channel: str) -> None:
    key = f"sess:{sid}"
    await redis.hset(key, mapping={"token": token, "name": "", "role": "", "channel": channel, "gen": 0})
    await redis.expire(key, SESSION_TTL)
    await touch_alive(redis, sid)


async def get_session(redis, sid: str) -> dict | None:
    raw = await redis.hgetall(f"sess:{sid}")
    if not raw:
        return None
    return {_s(k): _s(v) for k, v in raw.items()}


async def update_session(redis, sid: str, **fields) -> None:
    key = f"sess:{sid}"
    await redis.hset(key, mapping={k: ("" if v is None else v) for k, v in fields.items()})
    await redis.expire(key, SESSION_TTL)


async def bump_gen(redis, sid: str) -> int:
    return int(await redis.hincrby(f"sess:{sid}", "gen", 1))


async def delete_session(redis, sid: str) -> None:
    await redis.delete(f"sess:{sid}", f"alive:{sid}")


async def touch_alive(redis, sid: str) -> None:
    await redis.set(f"alive:{sid}", 1, ex=ALIVE_TTL)


# ─── Seats ──────────────────────────────────────────────────────────────────

async def get_seats(redis) -> dict:
    raw = await redis.hgetall(SEATS)
    return {_s(k): json.loads(v) for k, v in raw.items()}


async def claim_seat(redis, sid: str, name: str) -> bool:
    """Atomically claim the lowest free seat index. False if the room is full."""
    async with redis.pipeline(transaction=True) as pipe:
        for _ in range(20):
            try:
                await pipe.watch(SEATS)
                current = {_s(k): json.loads(v) for k, v in (await pipe.hgetall(SEATS)).items()}
                if sid in current:
                    await pipe.reset()
                    return True
                if len(current) >= MAX_SEATS:
                    await pipe.reset()
                    return False
                used = {info.get("idx") for info in current.values()}
                idx = next(i for i in range(MAX_SEATS) if i not in used)
                pipe.multi()
                pipe.hset(SEATS, sid, json.dumps({
                    "name": name, "idx": idx, "joined_at": _now(),
                    "mic": True, "cam": True, "away": False,
                }))
                await pipe.execute()
                return True
            except WatchError:
                continue
    return False


async def update_seat(redis, sid: str, **fields) -> bool:
    raw = await redis.hget(SEATS, sid)
    if raw is None:
        return False
    info = json.loads(raw)
    info.update(fields)
    await redis.hset(SEATS, sid, json.dumps(info))
    return True


async def vacate_seat(redis, sid: str) -> bool:
    return bool(await redis.hdel(SEATS, sid))


# ─── Audience ───────────────────────────────────────────────────────────────

async def add_audience(redis, sid: str, name: str) -> None:
    await redis.hset(AUDIENCE, sid, name)


async def remove_audience(redis, sid: str) -> bool:
    return bool(await redis.hdel(AUDIENCE, sid))


# ─── Snapshot + reaping ─────────────────────────────────────────────────────

async def room_payload(redis) -> dict:
    seats_map = await get_seats(redis)
    seats: list = [None] * MAX_SEATS
    for sid, info in seats_map.items():
        idx = info.get("idx", 0)
        if 0 <= idx < MAX_SEATS and seats[idx] is None:
            seats[idx] = {
                "session_id": sid,
                "name": info["name"],
                "mic": info.get("mic", True),
                "cam": info.get("cam", True),
                "away": info.get("away", False),
            }
    return {"seats": seats, "audience_count": await redis.hlen(AUDIENCE)}


async def reap_dead(redis) -> list[str]:
    """Remove seats/audience whose heartbeat expired. Returns reaped sids."""
    seat_ids = [_s(k) for k in await redis.hkeys(SEATS)]
    aud_ids = [_s(k) for k in await redis.hkeys(AUDIENCE)]
    ids = seat_ids + aud_ids
    if not ids:
        return []
    alive = await redis.mget([f"alive:{sid}" for sid in ids])
    dead = [sid for sid, a in zip(ids, alive) if a is None]
    for sid in dead:
        await redis.hdel(SEATS, sid)
        await redis.hdel(AUDIENCE, sid)
        await redis.delete(f"sess:{sid}")
    return dead


# ─── Chat ───────────────────────────────────────────────────────────────────

async def append_chat(redis, message: dict) -> None:
    await redis.rpush(CHAT, json.dumps(message))
    await redis.ltrim(CHAT, -CHAT_MAX, -1)


async def get_chat_history(redis) -> list:
    return [json.loads(item) for item in await redis.lrange(CHAT, 0, -1)]

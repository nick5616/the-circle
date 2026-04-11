"""
Redis interface for all room state.

Keys:
  room:seats          Hash    { session_id → JSON(name, channel_name, joined_at) }
  room:audience_count String  integer
  room:chat           List    JSON chat messages, LTRIM to 100
  session:<id>        String  channel name for direct messaging, TTL 24h
"""

import json

MAX_SEATS = 8
CHAT_MAX = 100
SESSION_TTL = 86400  # 24h


async def get_seats(redis) -> dict:
    """Return all occupied seats as { session_id: {name, channel_name, joined_at} }."""
    raw = await redis.hgetall("room:seats")
    return {k.decode(): json.loads(v) for k, v in raw.items()}


async def claim_seat(redis, session_id: str, name: str, channel_name: str) -> bool:
    """
    Atomically claim a seat. Returns True if successful, False if room is full.
    Uses a Redis transaction (WATCH + MULTI/EXEC) to prevent race conditions.
    """
    async with redis.pipeline(transaction=True) as pipe:
        while True:
            try:
                await pipe.watch("room:seats")
                current_count = await pipe.hlen("room:seats")
                if current_count >= MAX_SEATS:
                    await pipe.reset()
                    return False
                pipe.multi()
                value = json.dumps(
                    {"name": name, "channel_name": channel_name, "joined_at": _now()}
                )
                pipe.hset("room:seats", session_id, value)
                await pipe.execute()
                return True
            except Exception:
                # WATCH fired — retry
                continue


async def vacate_seat(redis, session_id: str) -> None:
    await redis.hdel("room:seats", session_id)


async def get_audience_count(redis) -> int:
    val = await redis.get("room:audience_count")
    return int(val) if val else 0


async def increment_audience(redis) -> int:
    return await redis.incr("room:audience_count")


async def decrement_audience(redis) -> int:
    val = await redis.decr("room:audience_count")
    # Guard against going negative (e.g. after a server restart)
    if val < 0:
        await redis.set("room:audience_count", 0)
        return 0
    return val


async def append_chat(redis, message: dict) -> None:
    """Append a chat message and trim the list to the last CHAT_MAX entries."""
    await redis.rpush("room:chat", json.dumps(message))
    await redis.ltrim("room:chat", -CHAT_MAX, -1)


async def get_chat_history(redis) -> list:
    raw = await redis.lrange("room:chat", 0, -1)
    return [json.loads(item) for item in raw]


async def set_session_channel(redis, session_id: str, channel_name: str) -> None:
    await redis.set(f"session:{session_id}", channel_name, ex=SESSION_TTL)


async def get_session_channel(redis, session_id: str) -> str | None:
    val = await redis.get(f"session:{session_id}")
    return val.decode() if val else None


async def delete_session(redis, session_id: str) -> None:
    await redis.delete(f"session:{session_id}")


# ---------------------------------------------------------------------------

def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()

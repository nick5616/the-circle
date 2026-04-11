"""
Redis interface for all room state.

Keys:
  room:seats          Hash    { session_id → JSON(name, channel_name, joined_at) }
  room:audience_count String  integer
  room:chat           List    JSON chat messages, LTRIM to 100
  session:<id>        String  channel name for direct messaging, TTL 24h
"""

MAX_SEATS = 8
CHAT_MAX = 100


async def get_seats(redis) -> dict:
    """Return all occupied seats as { session_id: {...} }."""
    pass


async def claim_seat(redis, session_id: str, name: str, channel_name: str) -> bool:
    """Atomically claim a seat. Returns True if successful, False if full."""
    pass


async def vacate_seat(redis, session_id: str) -> None:
    pass


async def get_audience_count(redis) -> int:
    pass


async def increment_audience(redis) -> int:
    pass


async def decrement_audience(redis) -> int:
    pass


async def append_chat(redis, message: dict) -> None:
    """Append a chat message and trim list to CHAT_MAX."""
    pass


async def get_chat_history(redis) -> list:
    pass


async def set_session_channel(redis, session_id: str, channel_name: str) -> None:
    pass


async def get_session_channel(redis, session_id: str) -> str | None:
    pass


async def delete_session(redis, session_id: str) -> None:
    pass

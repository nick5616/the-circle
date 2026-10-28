import base64
import hashlib
import hmac
import os
import time


def get_ice_servers() -> list[dict]:
    """
    ICE server config for WebRTC.

    Always includes public STUN servers. If TURN_* env vars are set, also
    returns a TURN entry with either:
      - static credentials (TURN_USERNAME + TURN_CREDENTIAL), or
      - time-limited HMAC credentials (TURN_SECRET, recommended for coturn).

    TURN_URL may be a comma-separated list (e.g. udp + tcp + tls variants).
    Delivered to clients in the websocket `hello` so credentials stay out of
    the JS bundle and are fresh on every (re)connect.
    """
    servers: list[dict] = [
        {"urls": ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"]}
    ]

    turn_urls = [u.strip() for u in os.environ.get("TURN_URL", "").split(",") if u.strip()]
    if not turn_urls:
        return servers

    turn_secret = os.environ.get("TURN_SECRET", "")
    turn_username = os.environ.get("TURN_USERNAME", "")
    turn_credential = os.environ.get("TURN_CREDENTIAL", "")

    if turn_secret:
        ttl = int(os.environ.get("TURN_TTL_SECONDS", "3600"))
        username = f"{int(time.time()) + ttl}:circle"
        token = hmac.new(turn_secret.encode(), username.encode(), hashlib.sha1).digest()
        servers.append({"urls": turn_urls, "username": username, "credential": base64.b64encode(token).decode()})
    elif turn_username and turn_credential:
        servers.append({"urls": turn_urls, "username": turn_username, "credential": turn_credential})
    else:
        # URL-only (e.g. TURN with no-auth — only for local dev)
        servers.append({"urls": turn_urls})

    return servers

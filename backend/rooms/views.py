import base64
import hashlib
import hmac
import os
import time

from django.http import JsonResponse


def ice_servers(request):
    """
    Return ICE server config for WebRTC.

    Always includes a public STUN server.  If TURN_* env vars are set, also
    returns a TURN server entry with either:
      - static credentials (TURN_CREDENTIAL set directly), or
      - time-limited HMAC credentials (TURN_SECRET set, recommended for coturn).

    Frontend fetches this once on load so TURN credentials are never embedded
    in the JavaScript bundle.
    """
    servers = [{"urls": "stun:stun.l.google.com:19302"}]

    turn_url = os.environ.get("TURN_URL", "")
    turn_secret = os.environ.get("TURN_SECRET", "")
    turn_username = os.environ.get("TURN_USERNAME", "")
    turn_credential = os.environ.get("TURN_CREDENTIAL", "")

    if turn_url:
        if turn_secret:
            # RFC-5389 / coturn time-limited credentials
            ttl = int(os.environ.get("TURN_TTL_SECONDS", "3600"))
            expires = int(time.time()) + ttl
            username = f"{expires}:circle"
            token = hmac.new(
                turn_secret.encode(), username.encode(), hashlib.sha1
            ).digest()
            credential = base64.b64encode(token).decode()
            servers.append(
                {"urls": turn_url, "username": username, "credential": credential}
            )
        elif turn_username and turn_credential:
            servers.append(
                {
                    "urls": turn_url,
                    "username": turn_username,
                    "credential": turn_credential,
                }
            )
        else:
            # URL-only (e.g. TURN with no-auth — only for local dev)
            servers.append({"urls": turn_url})

    return JsonResponse({"iceServers": servers})

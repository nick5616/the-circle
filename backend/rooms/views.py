from django.conf import settings
from django.http import JsonResponse

from .ice import get_ice_servers


def ice_servers(request):
    """Kept for health checks and older clients; new clients get ICE config in `hello`."""
    response = JsonResponse({"iceServers": get_ice_servers()})
    origin = request.headers.get("Origin")
    allowed = settings.ALLOWED_WS_ORIGINS
    if origin and (not allowed or origin in allowed):
        response["Access-Control-Allow-Origin"] = origin
        response["Vary"] = "Origin"
    return response


def healthz(request):
    return JsonResponse({"ok": True})

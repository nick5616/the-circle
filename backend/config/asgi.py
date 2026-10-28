import os

from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import OriginValidator
from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

django_asgi_app = get_asgi_application()

from django.conf import settings  # noqa: E402 — must come after setup
from rooms.routing import websocket_urlpatterns  # noqa: E402

# No startup wipe of room state: with more than one instance (Cloud Run scaling,
# rolling deploys) that would erase live seats held by other instances. Dead
# sessions are reaped via heartbeat expiry instead (see rooms/room_state.py).

websocket_app = URLRouter(websocket_urlpatterns)
if settings.ALLOWED_WS_ORIGINS:
    websocket_app = OriginValidator(websocket_app, settings.ALLOWED_WS_ORIGINS)

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": websocket_app,
    }
)

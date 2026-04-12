import os

from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

django_asgi_app = get_asgi_application()

from rooms.routing import websocket_urlpatterns  # noqa: E402 — must come after setup

# Clear stale room state from any previous run. If the server stopped
# uncleanly, disconnect() never fired and Redis still holds old seats/counts.
import redis as _redis
from django.conf import settings as _settings
_r = _redis.from_url(_settings.CHANNEL_LAYERS["default"]["CONFIG"]["hosts"][0])
_r.delete("room:seats", "room:audience_count", "room:chat")
_r.close()

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": URLRouter(websocket_urlpatterns),
    }
)

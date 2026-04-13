import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.environ.get("SECRET_KEY", "dev-secret-key-change-in-production")

DEBUG = os.environ.get("DEBUG", "true").lower() == "true"

_allowed = os.environ.get("ALLOWED_HOSTS", "*")
ALLOWED_HOSTS = [h.strip() for h in _allowed.split(",")]

# Origins allowed to open WebSocket connections (comma-separated)
_ws_origins = os.environ.get("ALLOWED_WS_ORIGINS", "")
ALLOWED_WS_ORIGINS = [o.strip() for o in _ws_origins.split(",") if o.strip()]

INSTALLED_APPS = [
    "django.contrib.staticfiles",
    "channels",
    "rooms",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.middleware.common.CommonMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = []

ASGI_APPLICATION = "config.asgi.application"

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [os.environ.get("REDIS_URL", "redis://localhost:6379")],
        },
    },
}

STATIC_URL = "/static/"

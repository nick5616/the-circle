from django.urls import path

from rooms.views import healthz, ice_servers

urlpatterns = [
    path("api/ice-servers/", ice_servers),
    path("healthz", healthz),
]

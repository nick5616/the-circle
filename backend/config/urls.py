from django.urls import path

from rooms.views import ice_servers

urlpatterns = [
    path("api/ice-servers/", ice_servers),
]

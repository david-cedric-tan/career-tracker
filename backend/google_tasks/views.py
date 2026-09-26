"""Settings → Google Tasks: connect, finish connecting, resync, disconnect."""

import urllib.parse

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from todos.models import Todo

from . import client, sync
from .models import GoogleTasksConnection

DEFAULT_REDIRECT_URI = "http://localhost/google-tasks"


def status_payload(user):
    connection = GoogleTasksConnection.objects.filter(user=user).first()
    connected = bool(connection and connection.is_connected)
    return {
        "configured": client.is_configured(),
        "connected": connected,
        "connected_at": connection.connected_at if connected else None,
        "last_synced_at": connection.last_synced_at if connected else None,
        "last_error": connection.last_error if connected else "",
        "synced_count": (
            Todo.objects.filter(user=user).exclude(google_task_id="").count()
            if connected
            else 0
        ),
    }


def _not_configured():
    return Response(
        {
            "detail": "Google Tasks isn't set up on this server yet — add "
            "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET to backend/.env."
        },
        status=status.HTTP_400_BAD_REQUEST,
    )


class GoogleTasksStatusView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(status_payload(request.user))


class GoogleTasksStartView(APIView):
    """POST {redirect_uri?} → {auth_url}: the Google consent page to open."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not client.is_configured():
            return _not_configured()
        redirect_uri = request.data.get("redirect_uri") or DEFAULT_REDIRECT_URI
        if not client.is_loopback(redirect_uri):
            return Response(
                {"redirect_uri": ["Only a http://localhost address can be used here."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        connection, _ = GoogleTasksConnection.objects.get_or_create(user=request.user)
        return Response({"auth_url": client.begin_consent(connection, redirect_uri)})


class GoogleTasksCompleteView(APIView):
    """POST {url} — the address Google sent the browser back to, code and all."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not client.is_configured():
            return _not_configured()
        query = urllib.parse.parse_qs(
            urllib.parse.urlparse((request.data.get("url") or "").strip()).query
        )
        code = (query.get("code") or [""])[0]
        state = (query.get("state") or [""])[0]
        error = (query.get("error") or [""])[0]

        if error:
            message = (
                "Access wasn't granted on Google's page."
                if error == "access_denied"
                else f"Google said: {error}"
            )
            return Response({"url": [message]}, status=status.HTTP_400_BAD_REQUEST)
        if not code:
            return Response(
                {"url": ["That address has no code in it — paste the whole address "
                         "from the page Google sent you to."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        connection = GoogleTasksConnection.objects.filter(user=request.user).first()
        if connection is None or not connection.pending_state or state != connection.pending_state:
            return Response(
                {"url": ["That link is from an older attempt. Press Connect again."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            client.finish_consent(connection, code)
            client.ensure_tasklist(connection)
        except client.GoogleError as exc:
            return Response({"url": [str(exc)]}, status=status.HTTP_400_BAD_REQUEST)

        sync.resync_all(request.user)
        return Response(status_payload(request.user))


class GoogleTasksResyncView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if sync.connection_for(request.user.id) is None:
            return Response(
                {"detail": "Connect Google Tasks first."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        queued = sync.resync_all(request.user)
        return Response({**status_payload(request.user), "queued": queued})


class GoogleTasksDisconnectView(APIView):
    """Stop syncing. Tasks already in Google stay there — the user can delete
    the list in Google if they want them gone."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        connection = GoogleTasksConnection.objects.filter(user=request.user).first()
        if connection is not None:
            client.revoke(connection)
            connection.delete()
        Todo.objects.filter(user=request.user).exclude(google_task_id="").update(
            google_task_id=""
        )
        return Response(status_payload(request.user))

"""Google OAuth and the Tasks REST API, over the standard library.

The API surface used is four calls, so this talks HTTP directly rather than
pulling in google-api-python-client and its dependency tree.

The OAuth client is a Google "Desktop app" client. That type accepts any
loopback redirect (http://localhost:<any port>/...) without registering it,
which is the only kind of redirect that works here: the app is reached over
localhost, a LAN address, or a tunnel whose hostname changes every run, and
Google only allows registered public hostnames otherwise. When the browser
isn't on the server's machine, the loopback page fails to load, and the user
pastes that page's address back into Settings — the code is in it.
"""

import base64
import hashlib
import json
import secrets
import urllib.error
import urllib.parse
import urllib.request
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
API_ROOT = "https://tasks.googleapis.com/tasks/v1"
SCOPE = "https://www.googleapis.com/auth/tasks"

TIMEOUT_SECONDS = 15


class GoogleError(Exception):
    def __init__(self, message, status=None):
        super().__init__(message)
        self.status = status


class NotConnected(GoogleError):
    """Google refused the refresh token — the user has to connect again."""


def is_configured():
    return bool(settings.GOOGLE_OAUTH_CLIENT_ID and settings.GOOGLE_OAUTH_CLIENT_SECRET)


def is_loopback(uri):
    parsed = urllib.parse.urlparse(uri or "")
    return parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1")


def _http(method, url, *, form=None, body=None, token=None):
    headers = {"Accept": "application/json"}
    data = None
    if form is not None:
        data = urllib.parse.urlencode(form).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"

    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            raw = response.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode(errors="replace")[:500]
        raise GoogleError(f"Google returned {exc.code}: {detail}", status=exc.code) from exc
    except (urllib.error.URLError, TimeoutError) as exc:
        raise GoogleError(f"Couldn't reach Google: {exc}") from exc
    return json.loads(raw) if raw else {}


# --- OAuth ---------------------------------------------------------------------


def begin_consent(connection, redirect_uri):
    """Store a fresh state + PKCE pair on `connection`; return Google's consent URL."""
    verifier = secrets.token_urlsafe(64)[:96]
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .rstrip(b"=")
        .decode()
    )
    connection.pending_state = secrets.token_urlsafe(24)
    connection.pending_verifier = verifier
    connection.pending_redirect_uri = redirect_uri
    connection.save(
        update_fields=["pending_state", "pending_verifier", "pending_redirect_uri"]
    )

    query = urllib.parse.urlencode(
        {
            "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": SCOPE,
            # Offline + consent so Google always hands back a refresh token,
            # even on a reconnect after a disconnect.
            "access_type": "offline",
            "prompt": "consent",
            "state": connection.pending_state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
    )
    return f"{AUTH_URL}?{query}"


def finish_consent(connection, code):
    """Swap the authorization code for tokens and store them."""
    payload = _http(
        "POST",
        TOKEN_URL,
        form={
            "grant_type": "authorization_code",
            "code": code,
            "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
            "client_secret": settings.GOOGLE_OAUTH_CLIENT_SECRET,
            "redirect_uri": connection.pending_redirect_uri,
            "code_verifier": connection.pending_verifier,
        },
    )
    if not payload.get("refresh_token"):
        raise GoogleError("Google didn't return a refresh token. Try connecting again.")
    _store_access_token(connection, payload)
    connection.refresh_token = payload["refresh_token"]
    connection.pending_state = ""
    connection.pending_verifier = ""
    connection.pending_redirect_uri = ""
    connection.connected_at = timezone.now()
    connection.last_error = ""
    connection.save()


def revoke(connection):
    """Best effort — a disconnect should succeed even when Google can't be reached."""
    token = connection.refresh_token or connection.access_token
    if not token:
        return
    try:
        _http("POST", REVOKE_URL, form={"token": token})
    except GoogleError:
        pass


def _store_access_token(connection, payload):
    connection.access_token = payload["access_token"]
    # A minute's margin so a token never expires between check and use.
    lifetime = max(int(payload.get("expires_in", 3600)) - 60, 0)
    connection.access_token_expires_at = timezone.now() + timedelta(seconds=lifetime)


def access_token(connection):
    if (
        connection.access_token
        and connection.access_token_expires_at
        and connection.access_token_expires_at > timezone.now()
    ):
        return connection.access_token
    if not connection.refresh_token:
        raise NotConnected("Google Tasks isn't connected.")
    try:
        payload = _http(
            "POST",
            TOKEN_URL,
            form={
                "grant_type": "refresh_token",
                "refresh_token": connection.refresh_token,
                "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
                "client_secret": settings.GOOGLE_OAUTH_CLIENT_SECRET,
            },
        )
    except GoogleError as exc:
        if exc.status in (400, 401):
            raise NotConnected(
                "Google no longer accepts this connection. Disconnect and connect again."
            ) from exc
        raise
    _store_access_token(connection, payload)
    connection.save(update_fields=["access_token", "access_token_expires_at"])
    return connection.access_token


# --- Tasks API -----------------------------------------------------------------


def api(connection, method, path, body=None):
    return _http(method, f"{API_ROOT}{path}", body=body, token=access_token(connection))


def ensure_tasklist(connection):
    """The id of the "Career Tracker" list — reused if one already exists (a
    reconnect), created otherwise."""
    title = settings.GOOGLE_TASKS_LIST_TITLE
    if connection.tasklist_id:
        try:
            api(connection, "GET", f"/users/@me/lists/{connection.tasklist_id}")
            return connection.tasklist_id
        except GoogleError as exc:
            if exc.status != 404:
                raise

    lists = api(connection, "GET", "/users/@me/lists?maxResults=100").get("items", [])
    match = next((item for item in lists if item.get("title") == title), None)
    if match is None:
        match = api(connection, "POST", "/users/@me/lists", {"title": title})
    connection.tasklist_id = match["id"]
    connection.save(update_fields=["tasklist_id"])
    return connection.tasklist_id

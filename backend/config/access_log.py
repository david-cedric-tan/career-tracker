"""Coloured per-request API access logging.

Django's own `runserver` line (`"GET /api/todos/ HTTP/1.1" 200 2869`) says what
was asked for but never *who* asked, which is the question that matters as soon
as more than one person is using the server. This middleware logs the
authenticated user alongside the request, in colour, and `settings.LOGGING`
quietens `django.server` so each request still produces exactly one line.

Deliberately excluded: request bodies, query-string values, headers, cookies and
tokens. An access log is read casually and copied into bug reports, so it must
never be somewhere a password or an auth token can end up.

Controlled by `API_ACCESS_LOG` (on by default) and `API_ACCESS_LOG_COLOR`
(`auto` / `always` / `never`) in `backend/.env`.
"""

import logging
import sys
import time

logger = logging.getLogger("api.access")

RESET = "\033[0m"
DIM = "\033[2m"
BOLD = "\033[1m"
RED = "\033[31m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
BLUE = "\033[34m"
MAGENTA = "\033[35m"
CYAN = "\033[36m"
GREY = "\033[90m"

# Colour by intent rather than by name: reads are quiet, writes stand out, and
# deletes are the loudest thing in the log.
METHOD_COLOR = {
    "GET": BLUE,
    "HEAD": GREY,
    "OPTIONS": GREY,
    "POST": GREEN,
    "PUT": YELLOW,
    "PATCH": YELLOW,
    "DELETE": RED,
}


def _supports_color(mode):
    if mode == "always":
        return True
    if mode == "never":
        return False
    return sys.stderr.isatty()


def _status_color(status):
    if status >= 500:
        return RED
    if status >= 400:
        return YELLOW
    if status >= 300:
        return CYAN
    return GREEN


def _duration_color(ms):
    if ms >= 1000:
        return RED
    if ms >= 300:
        return YELLOW
    return GREY


def _client_ip(request):
    """The LAN address the request came from.

    `X-Forwarded-For` is honoured so the real client still shows through a
    reverse proxy, and only its first entry is used — the rest are the proxies
    it passed through, and any of them can be spoofed by the caller.
    """
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "-")


def _describe_user(request):
    """Who made the request, as `(label, is_authenticated)`.

    Reads the user lazily and defensively: this runs after the response, and a
    failed session or token lookup must never turn a served response into a 500
    from the logger.
    """
    try:
        user = getattr(request, "user", None)
        if user is None or not user.is_authenticated:
            return "anonymous", False
        return f"{user.get_username()}#{user.pk}", True
    except Exception:
        return "unknown", False


class AccessLogMiddleware:
    """Logs one line per request: who, from where, what, and how long it took."""

    def __init__(self, get_response):
        from django.conf import settings

        if not getattr(settings, "API_ACCESS_LOG", True):
            # Django removes the middleware from the chain entirely, so a
            # disabled log costs nothing per request.
            from django.core.exceptions import MiddlewareNotUsed

            raise MiddlewareNotUsed

        self.get_response = get_response
        self.color = _supports_color(getattr(settings, "API_ACCESS_LOG_COLOR", "auto"))
        self.paths = tuple(getattr(settings, "API_ACCESS_LOG_PATHS", ("/api/",)))

    def _paint(self, text, color):
        if not self.color or not color:
            return text
        return f"{color}{text}{RESET}"

    def __call__(self, request):
        if self.paths and not request.path.startswith(self.paths):
            return self.get_response(request)

        # Monotonic, so a clock adjustment can't produce a negative duration.
        started = time.perf_counter()
        response = self.get_response(request)
        duration_ms = (time.perf_counter() - started) * 1000

        user_label, authenticated = _describe_user(request)
        status = getattr(response, "status_code", 0)

        # Streaming responses have no rendered body yet, and asking for one
        # would consume the iterator the client is about to be sent.
        if response.has_header("Content-Length"):
            size = response["Content-Length"]
        elif getattr(response, "streaming", False):
            size = "stream"
        else:
            size = len(getattr(response, "content", b""))

        method = request.method
        parts = [
            self._paint(f"{method:<7}", METHOD_COLOR.get(method, "")),
            self._paint(str(status), BOLD + _status_color(status)),
            self._paint(f"{user_label:<18}", MAGENTA if authenticated else GREY),
            self._paint(f"{_client_ip(request):<15}", GREY),
            request.path,
            self._paint(f"{size}b", DIM),
            self._paint(f"{duration_ms:.0f}ms", _duration_color(duration_ms)),
        ]
        logger.info(" ".join(parts))
        return response

"""
Django settings for config project.

Environment variables (loaded from backend/.env):
    DJANGO_SECRET_KEY, DJANGO_DEBUG, DJANGO_ALLOWED_HOSTS,
    POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_HOST / POSTGRES_PORT
    (falls back to SQLite when USE_POSTGRES is not truthy),
    CORS_ALLOWED_ORIGINS,
    API_ACCESS_LOG / API_ACCESS_LOG_COLOR (per-request access log)
"""

import os
import sys
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")


def env_bool(name, default=False):
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_list(name, default):
    raw = os.getenv(name)
    if not raw:
        return default
    return [item.strip() for item in raw.split(",") if item.strip()]


INSECURE_DEV_SECRET = "django-insecure-^061t7t9&ia@w3(d)ltt^avfs=v8ol&w$m5lg^r$f4h8=(mhs!"
SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", INSECURE_DEV_SECRET)

DEBUG = env_bool("DJANGO_DEBUG", True)

# The dev key is in the repository, so anyone who has seen the source can
# forge sessions and password-reset tokens with it. Fine on a laptop, fatal
# on anything reachable from the internet — so a production boot refuses to
# start on it rather than running quietly compromised.
if not DEBUG and SECRET_KEY == INSECURE_DEV_SECRET:
    raise RuntimeError(
        "DJANGO_SECRET_KEY is still the development default. Generate one "
        "(python -c \"import secrets; print(secrets.token_urlsafe(64))\") "
        "and set it in the environment before running with DEBUG off."
    )

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", ["localhost", "127.0.0.1", "[::1]"])

# Application definition
INSTALLED_APPS = [
    # Django
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third-party
    "rest_framework",
    "rest_framework.authtoken",
    "corsheaders",
    "django_extensions",
    # Local
    "accounts",
    "applications",
    "network",
    "catchups",
    "todos",
    "events",
    "dashboard",
    "backup",
    "onboarding",
    "console",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    # Last, so the user it reports is the one the auth middleware resolved.
    "config.access_log.AccessLogMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# Database — Postgres when USE_POSTGRES is set (see docker-compose.yml), else SQLite.
if env_bool("USE_POSTGRES", False):
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.getenv("POSTGRES_DB", "apptracker"),
            "USER": os.getenv("POSTGRES_USER", "admin"),
            "PASSWORD": os.getenv("POSTGRES_PASSWORD", ""),
            "HOST": os.getenv("POSTGRES_HOST", "127.0.0.1"),
            "PORT": os.getenv("POSTGRES_PORT", "5433"),
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# Internationalization
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

# Static files
STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# User uploads (profile pictures, contact photos). Served by Django in DEBUG;
# put a real file server or object store in front of this in production.
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# Ceiling for a single uploaded image, enforced in the serializers too so the
# client gets a field error rather than a 413.
MAX_UPLOAD_IMAGE_BYTES = 5 * 1024 * 1024
MAX_UPLOAD_DOCUMENT_BYTES = 10 * 1024 * 1024

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# DRF
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework.authentication.TokenAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    # Deliberately unpaginated: this is a single-user tracker and the SPA does
    # its own client-side filtering/sorting over the full list.
    "DEFAULT_RENDERER_CLASSES": [
        "rest_framework.renderers.JSONRenderer",
        "rest_framework.renderers.BrowsableAPIRenderer",
    ],
    # Rate limits, aimed at the one endpoint worth guessing at: sign-in.
    # `anon` covers the login and register views (no authenticated user yet);
    # `user` is a generous ceiling that a person can't reach by hand but a
    # script hammering the API would.
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.AnonRateThrottle",
        "rest_framework.throttling.UserRateThrottle",
    ],
    "DEFAULT_THROTTLE_RATES": {
        "anon": os.getenv("THROTTLE_ANON", "30/min"),
        "user": os.getenv("THROTTLE_USER", "1000/min"),
        # Applied by name on the sign-in view — see accounts.views.LoginView.
        "login": os.getenv("THROTTLE_LOGIN", "10/min"),
    },
}

# CORS (Vite frontend)
CORS_ALLOWED_ORIGINS = env_list(
    "CORS_ALLOWED_ORIGINS",
    ["http://localhost:5173", "http://127.0.0.1:5173"],
)
CORS_ALLOW_CREDENTIALS = True
# Content-Disposition isn't a CORS-safelisted response header, so without this
# the SPA can't read the filename off a download and every backup would save as
# a generic name instead of a dated, user-stamped one.
CORS_EXPOSE_HEADERS = ["Content-Disposition"]

# Needed when the app is served over HTTPS through the frontend's proxy
# (`run.sh --https`): Django sees a plain-HTTP request but an `https://` Origin
# header, and without this it reads that mismatch as cross-site.
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", [])

# In `run.sh --https` the Vite dev server terminates TLS and proxies to Django
# over plain HTTP, forwarding the original scheme. Trusting the header is what
# makes `request.build_absolute_uri()` — every photo and logo URL — say
# https://, so a secure page can actually load them. Only the dev proxy sits in
# front of this server, so the header can't be spoofed from outside.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# Hardening that only applies once this is served for real. Kept behind
# `not DEBUG` so a LAN/dev run over plain HTTP doesn't redirect-loop or drop
# its own cookies, while a hosted deployment gets the lot by default.
if not DEBUG:
    SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", True)
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    CSRF_COOKIE_SAMESITE = "Lax"
    # Six months, and tell browsers to remember it for subdomains too.
    SECURE_HSTS_SECONDS = int(os.getenv("SECURE_HSTS_SECONDS", 60 * 60 * 24 * 180))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = False
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_REFERRER_POLICY = "same-origin"
    X_FRAME_OPTIONS = "DENY"

# Whether strangers who find the URL can create an account. A personal
# instance wants this off: you sign yourself up once, then close the door.
ALLOW_REGISTRATION = env_bool("ALLOW_REGISTRATION", True)

# The account that can read and reply to every user's refinement notes. This
# grants nothing else — it is not staff, and it opens no admin.
DEVELOPER_USERNAME = os.getenv("DEVELOPER_USERNAME", "DavieeTan")

# Per-request access log (config/access_log.py): who called which endpoint,
# from which address, with what result. Only paths under API_ACCESS_LOG_PATHS
# are logged, so static and media traffic doesn't drown out the API calls.
# Off under the test runner by default: 395 tests' worth of request lines buries
# the actual failures.
TESTING = "test" in sys.argv
API_ACCESS_LOG = env_bool("API_ACCESS_LOG", not TESTING)
# auto (colour only when the terminal supports it) / always / never.
API_ACCESS_LOG_COLOR = os.getenv("API_ACCESS_LOG_COLOR", "auto").strip().lower()
API_ACCESS_LOG_PATHS = tuple(env_list("API_ACCESS_LOG_PATHS", ["/api/"]))

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "access": {"format": "%(asctime)s %(message)s", "datefmt": "%H:%M:%S"},
    },
    "handlers": {
        "access": {
            "class": "logging.StreamHandler",
            "formatter": "access",
        },
    },
    "loggers": {
        "api.access": {
            "handlers": ["access"],
            "level": "INFO",
            "propagate": False,
        },
        # runserver logs its own line for every request, which would duplicate
        # each access-log entry without adding the user. Errors still surface.
        "django.server": {
            "level": "WARNING" if API_ACCESS_LOG else "INFO",
        },
    },
}

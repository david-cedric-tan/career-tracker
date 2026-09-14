"""Root URL configuration.

Everything the SPA talks to lives under /api/. The browsable API and the
Django admin stay available for debugging.
"""

from django.conf import settings
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("accounts.urls")),
    path("api/", include("applications.urls")),
    path("api/", include("network.urls")),
    path("api/", include("catchups.urls")),
    path("api/", include("todos.urls")),
    path("api/", include("events.urls")),
    path("api/dashboard/", include("dashboard.urls")),
    path("api/backup/", include("backup.urls")),
    path("api/onboarding/", include("onboarding.urls")),
    path("api-auth/", include("rest_framework.urls")),
]

if settings.DEBUG:
    # Uploads are opened inside the app's own document viewer, which embeds
    # PDFs in an <iframe>. The clickjacking middleware's default DENY header
    # makes the browser refuse that frame ("refused to connect"), so media
    # is served without it — the files are the user's own uploads, not pages
    # that could be tricked into acting on a click.
    from django.urls import re_path
    from django.views.decorators.clickjacking import xframe_options_exempt
    from django.views.static import serve

    urlpatterns += [
        re_path(
            r"^media/(?P<path>.*)$",
            xframe_options_exempt(serve),
            {"document_root": settings.MEDIA_ROOT},
        ),
    ]

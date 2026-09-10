"""Root URL configuration.

Everything the SPA talks to lives under /api/. The browsable API and the
Django admin stay available for debugging.
"""

from django.conf import settings
from django.conf.urls.static import static
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
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

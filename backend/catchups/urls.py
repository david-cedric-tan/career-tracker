from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import CatchupViewSet

router = DefaultRouter()
router.register(r"catchups", CatchupViewSet, basename="catchup")

urlpatterns = [path("", include(router.urls))]

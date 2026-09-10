from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ContactMethodViewSet, MetSourceTagViewSet, PersonViewSet, RelationshipTagViewSet

router = DefaultRouter()
router.register(r"people", PersonViewSet, basename="person")
router.register(r"contact-methods", ContactMethodViewSet, basename="contactmethod")
router.register(r"relationships", RelationshipTagViewSet, basename="relationshiptag")
router.register(r"met-sources", MetSourceTagViewSet, basename="metsourcetag")

urlpatterns = [path("", include(router.urls))]

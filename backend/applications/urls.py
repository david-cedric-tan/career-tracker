from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    ApplicationStageViewSet,
    CompanyViewSet,
    CountryViewSet,
    IndustryViewSet,
    LibraryDocumentViewSet,
    LocationViewSet,
    RoleViewSet,
    StateViewSet,
    VenueViewSet,
    ResumeViewSet,
    JobListingViewSet,
    ApplicationViewSet,
    ApplicationJobListingViewSet,
    AppsEventLogViewSet,
)

router = DefaultRouter()
router.register(r'application-stages', ApplicationStageViewSet)
router.register(r'companies', CompanyViewSet)
router.register(r'countries', CountryViewSet)
router.register(r'industries', IndustryViewSet)
router.register(r'locations', LocationViewSet)
router.register(r'roles', RoleViewSet)
router.register(r'states', StateViewSet)
router.register(r'venues', VenueViewSet)
router.register(r'resumes', ResumeViewSet)
router.register(r'library-documents', LibraryDocumentViewSet)
router.register(r'job-listings', JobListingViewSet)
router.register(r'applications', ApplicationViewSet)
router.register(r'application-job-listings', ApplicationJobListingViewSet)
router.register(r'apps-event-logs', AppsEventLogViewSet)

urlpatterns = [
path("", include(router.urls)),
]
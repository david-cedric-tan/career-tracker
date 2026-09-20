from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AccountView,
    AvatarView,
    DeleteAllDataView,
    CertificationViewSet,
    EducationViewSet,
    ExperienceViewSet,
    ExtraCurricularViewSet,
    LoginView,
    PasswordResetRequestView,
    LogoutView,
    PinnedPhotoView,
    ProfileAddressViewSet,
    ProfileLinkViewSet,
    RefinementNoteViewSet,
    RegisterView,
    WallpaperView,
)

router = DefaultRouter()
router.register(r"experiences", ExperienceViewSet, basename="experience")
router.register(r"education", EducationViewSet, basename="education")
router.register(r"certifications", CertificationViewSet, basename="certification")
router.register(r"extracurriculars", ExtraCurricularViewSet, basename="extracurricular")
router.register(r"links", ProfileLinkViewSet, basename="profilelink")
router.register(r"addresses", ProfileAddressViewSet, basename="profileaddress")
router.register(r"refinements", RefinementNoteViewSet, basename="refinementnote")

urlpatterns = [
    path("register/", RegisterView.as_view(), name="auth-register"),
    path("login/", LoginView.as_view(), name="auth-login"),
    path(
        "password-reset-requests/",
        PasswordResetRequestView.as_view(),
        name="auth-password-reset-request",
    ),
    path("logout/", LogoutView.as_view(), name="auth-logout"),
    path("me/", AccountView.as_view(), name="auth-account"),
    path("me/avatar/", AvatarView.as_view(), name="auth-avatar"),
    path("me/wallpaper/", WallpaperView.as_view(), name="auth-wallpaper"),
    path("me/pinned-photo/", PinnedPhotoView.as_view(), name="auth-pinned-photo"),
    path("me/delete-data/", DeleteAllDataView.as_view(), name="auth-delete-data"),
    path("", include(router.urls)),
]

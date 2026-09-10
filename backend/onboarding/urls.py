from django.urls import path

from .views import cleanup, seed, summary

urlpatterns = [
    path("sample-data/seed/", seed, name="onboarding-sample-seed"),
    path("sample-data/", summary, name="onboarding-sample-summary"),
    path("sample-data/cleanup/", cleanup, name="onboarding-sample-cleanup"),
]

from django.urls import path

from . import views

urlpatterns = [
    path("overview/", views.overview, name="console-overview"),
    path("accounts/", views.accounts, name="console-accounts"),
    path("accounts/<int:pk>/", views.account_detail, name="console-account"),
    path("password-resets/", views.password_resets, name="console-password-resets"),
    path("migration/sections/", views.migration_sections, name="console-migration-sections"),
    path("migration/export.zip", views.migration_export, name="console-migration-export"),
    path("migration/import/", views.migration_import, name="console-migration-import"),
    path("refinements/", views.refinements, name="console-refinements"),
    path("refinements/<int:pk>/", views.refinement_detail, name="console-refinement"),
    path("activity/", views.activity, name="console-activity"),
]

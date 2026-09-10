from django.contrib import admin

from .models import (
    Certification,
    Education,
    Experience,
    ExtraCurricular,
    Profile,
    ProfileAddress,
    ProfileLink,
)


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ("user", "mobile_number", "linkedin_url", "updated_at")
    search_fields = ("user__username", "user__email", "mobile_number")


@admin.register(Education)
class EducationAdmin(admin.ModelAdmin):
    list_display = ("school", "degree", "user", "started_on", "ended_on")
    search_fields = ("school", "degree", "field_of_study")


@admin.register(Certification)
class CertificationAdmin(admin.ModelAdmin):
    list_display = ("name", "issuer", "user", "issued_on", "expires_on")
    search_fields = ("name", "issuer")


@admin.register(ExtraCurricular)
class ExtraCurricularAdmin(admin.ModelAdmin):
    list_display = ("organization", "role", "user", "started_on", "ended_on")
    search_fields = ("organization", "role")


@admin.register(ProfileLink)
class ProfileLinkAdmin(admin.ModelAdmin):
    list_display = ("label", "url", "category", "user")


@admin.register(ProfileAddress)
class ProfileAddressAdmin(admin.ModelAdmin):
    list_display = ("label", "user")

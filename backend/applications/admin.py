from django.contrib import admin

'''
Admin panel for the applications app. (To let the models appear on django admin panel)
'''

from .models import (
    Country, State, Location, Venue,
    Industry, Company, Role, Resume, JobListing,
    Application, ApplicationJobListing, AppsEventLog,
)


class ApplicationJobListingInline(admin.TabularInline):
    model = ApplicationJobListing
    extra = 1


@admin.register(Application)
class ApplicationAdmin(admin.ModelAdmin):
    list_display = ("company", "stage", "outcome", "applied_at", "resume", "user")
    list_filter = ("stage", "outcome", "company")
    search_fields = ("company__name", "notes", "resume__label")
    inlines = [ApplicationJobListingInline]
    autocomplete_fields = ("company", "user", "resume")

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == "resume" and request.user.is_authenticated:
            kwargs["queryset"] = Resume.objects.filter(user=request.user, is_active=True)
        return super().formfield_for_foreignkey(db_field, request, **kwargs)

    def save_model(self, request, obj, form, change):
        if not obj.user_id:
            obj.user = request.user
        super().save_model(request, obj, form, change)


@admin.register(Company)
class CompanyAdmin(admin.ModelAdmin):
    list_display = ("name",)
    search_fields = ("name",)
    filter_horizontal = ("industries", "regions")


@admin.register(Resume)
class ResumeAdmin(admin.ModelAdmin):
    list_display = ("label", "variant_type", "user", "is_active", "updated_at")
    list_filter = ("variant_type", "is_active")
    search_fields = ("label", "notes")
    autocomplete_fields = ("user", "target_companies", "target_roles")
    filter_horizontal = ("target_companies", "target_roles")

    def save_model(self, request, obj, form, change):
        if not obj.user_id:
            obj.user = request.user
        super().save_model(request, obj, form, change)


@admin.register(JobListing)
class JobListingAdmin(admin.ModelAdmin):
    list_display = ("role", "company", "location", "role_type", "job_url")
    list_filter = ("role_type", "company")
    search_fields = ("company__name", "role__name", "job_url")
    autocomplete_fields = ("company", "role", "location")


@admin.register(AppsEventLog)
class AppsEventLogAdmin(admin.ModelAdmin):
    list_display = ("application", "prev_stage", "curr_stage", "curr_outcome", "changed_at")
    list_filter = ("curr_stage", "curr_outcome")
    readonly_fields = ("application", "prev_stage", "curr_stage", "prev_outcome", "curr_outcome", "changed_at", "note")


admin.site.register(Country)
admin.site.register(Industry)


@admin.register(State)
class StateAdmin(admin.ModelAdmin):
    list_display = ("name", "country")
    search_fields = ("name", "country__name")


@admin.register(Location)
class LocationAdmin(admin.ModelAdmin):
    list_display = ("state", "name")
    search_fields = ("state__name", "name")
    autocomplete_fields = ("state",)


@admin.register(Venue)
class VenueAdmin(admin.ModelAdmin):
    list_display = ("location", "name")
    search_fields = ("location__name", "name")
    autocomplete_fields = ("location",)


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ("name",)
    search_fields = ("name",)

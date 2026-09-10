from django.contrib import admin

from .models import Catchup


@admin.register(Catchup)
class CatchupAdmin(admin.ModelAdmin):
    list_display = ("person", "met_on", "format", "title", "user")
    list_filter = ("format",)
    search_fields = ("title", "minutes", "takeaways", "person__full_name")
    autocomplete_fields = ("person", "user")

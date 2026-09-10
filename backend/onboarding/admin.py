from django.contrib import admin

from .models import SampleDataRecord


@admin.register(SampleDataRecord)
class SampleDataRecordAdmin(admin.ModelAdmin):
    list_display = ("category", "user", "content_type", "object_id", "created_at")
    list_filter = ("category",)
    autocomplete_fields = ("user",)

from django.contrib import admin

from .models import Todo


@admin.register(Todo)
class TodoAdmin(admin.ModelAdmin):
    list_display = ("title", "status", "priority", "due_date", "completed_at", "user")
    list_filter = ("status", "priority")
    search_fields = ("title", "description")
    autocomplete_fields = ("application", "person", "company", "user")

    def save_model(self, request, obj, form, change):
        if not obj.user_id:
            obj.user = request.user
        obj.sync_completion()
        super().save_model(request, obj, form, change)

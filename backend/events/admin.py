from django.contrib import admin

from .models import CalendarEvent, EventReminder


class EventReminderInline(admin.TabularInline):
    model = EventReminder
    extra = 0


@admin.register(CalendarEvent)
class CalendarEventAdmin(admin.ModelAdmin):
    list_display = ("title", "date", "all_day", "is_done", "user")
    list_filter = ("is_done", "all_day")
    search_fields = ("title", "notes")
    autocomplete_fields = ("user",)
    inlines = [EventReminderInline]

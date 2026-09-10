from django.contrib import admin

from .models import ContactMethod, Person, PersonCompany


class ContactMethodInline(admin.TabularInline):
    model = ContactMethod
    extra = 1


class PersonCompanyInline(admin.TabularInline):
    """An inline rather than `filter_horizontal`: the membership now carries
    its own dates, which a plain multi-select can't edit."""

    model = PersonCompany
    extra = 1


@admin.register(Person)
class PersonAdmin(admin.ModelAdmin):
    list_display = ("full_name", "photo", "status", "relationship", "next_chat_at", "user")
    list_filter = ("status", "relationship", "source")
    search_fields = ("full_name", "title", "notes")
    filter_horizontal = ("applications",)
    inlines = [PersonCompanyInline, ContactMethodInline]

    def save_model(self, request, obj, form, change):
        if not obj.user_id:
            obj.user = request.user
        obj.apply_cadence_default()
        super().save_model(request, obj, form, change)


@admin.register(ContactMethod)
class ContactMethodAdmin(admin.ModelAdmin):
    list_display = ("person", "channel", "value", "is_preferred")
    list_filter = ("channel", "is_preferred")
    search_fields = ("value", "person__full_name")

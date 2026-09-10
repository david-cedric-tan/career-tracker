from datetime import datetime, timedelta

from rest_framework import serializers

from applications.models import Application
from network.models import Person

from .models import CalendarEvent, EventReminder

DEFAULT_REMINDER_MINUTES = 30


class EventReminderSerializer(serializers.ModelSerializer):
    # Computed so the frontend never re-derives "date + reference time -
    # minutes_before" itself — one source of truth for when an alert fires.
    fires_at = serializers.SerializerMethodField()

    class Meta:
        model = EventReminder
        fields = ["id", "minutes_before", "fires_at"]
        read_only_fields = ["id", "fires_at"]

    def get_fires_at(self, reminder):
        event = reminder.event
        reference = datetime.combine(event.date, event.reference_time)
        fires_at = reference - timedelta(minutes=reminder.minutes_before)
        return fires_at.isoformat()


class CalendarEventSerializer(serializers.ModelSerializer):
    reminders = EventReminderSerializer(many=True, required=False)
    company_name = serializers.CharField(source="company.name", read_only=True, default=None)
    application_label = serializers.SerializerMethodField()
    # Enough to draw a person without a second round-trip, mirroring the shape
    # Person.company_details already uses for the company bubble view.
    people_details = serializers.SerializerMethodField()

    class Meta:
        model = CalendarEvent
        fields = [
            "id",
            "title",
            "date",
            "all_day",
            "start_time",
            "end_time",
            "notes",
            "is_done",
            "company", "company_name",
            "application", "application_label",
            "people", "people_details",
            "reminders",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id", "company_name", "application_label", "people_details",
            "created_at", "updated_at",
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request is None or not request.user.is_authenticated:
            return
        # You can only pin an event to your own applications and contacts —
        # companies stay open, since those are shared reference data.
        if "application" in self.fields:
            self.fields["application"].queryset = Application.objects.filter(user=request.user)
        if "people" in self.fields:
            self.fields["people"].child_relation.queryset = Person.objects.filter(
                user=request.user
            )

    def get_application_label(self, event):
        if not event.application:
            return None
        return f"{event.application.company.name} · {event.application.get_stage_display()}"

    def get_people_details(self, event):
        request = self.context.get("request")
        return [
            {
                "id": person.id,
                "full_name": person.full_name,
                "status": person.status,
                "status_display": person.get_status_display(),
                "relationship_display": (
                    person.relationship.name if person.relationship else None
                ),
                "photo": (
                    request.build_absolute_uri(person.photo.url)
                    if person.photo and request
                    else (person.photo.url if person.photo else None)
                ),
            }
            for person in event.people.all()
        ]

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Give the event a title.")
        return value

    def validate(self, attrs):
        all_day = attrs.get("all_day", getattr(self.instance, "all_day", True))
        start_time = attrs.get("start_time", getattr(self.instance, "start_time", None))
        end_time = attrs.get("end_time", getattr(self.instance, "end_time", None))
        if not all_day and not start_time:
            raise serializers.ValidationError({"start_time": "A timed event needs a start time."})
        if start_time and end_time and end_time < start_time:
            raise serializers.ValidationError({"end_time": "Must not be before the start time."})
        return attrs

    def create(self, validated_data):
        reminders_data = validated_data.pop("reminders", None)
        event = super().create(validated_data)
        self._sync_reminders(event, reminders_data, is_create=True)
        return event

    def update(self, instance, validated_data):
        reminders_data = validated_data.pop("reminders", None)
        event = super().update(instance, validated_data)
        self._sync_reminders(event, reminders_data, is_create=False)
        return event

    def _sync_reminders(self, event, reminders_data, is_create):
        if reminders_data is None:
            # Not sent at all — leave existing reminders alone on update; a
            # freshly created timed event gets the default 30-minutes-before.
            if is_create and not event.all_day:
                EventReminder.objects.create(event=event, minutes_before=DEFAULT_REMINDER_MINUTES)
            return
        # Sent (even as an empty list) — replace wholesale. The form always
        # sends the full current set, so this is simpler and safer than
        # diffing row-by-row.
        event.reminders.all().delete()
        EventReminder.objects.bulk_create(
            EventReminder(event=event, minutes_before=row["minutes_before"])
            for row in reminders_data
        )

from rest_framework import serializers

from config.images import validate_image

from .models import (
    CADENCE_NEVER,
    ContactChannel,
    ContactMethod,
    MetSourceTag,
    Person,
    PersonStatus,
    RelationshipTag,
)


class RelationshipTagSerializer(serializers.ModelSerializer):
    class Meta:
        model = RelationshipTag
        fields = ["id", "name"]
        read_only_fields = ["id"]


class MetSourceTagSerializer(serializers.ModelSerializer):
    class Meta:
        model = MetSourceTag
        fields = ["id", "name"]
        read_only_fields = ["id"]


class ContactMethodSerializer(serializers.ModelSerializer):
    """Standalone CRUD on /api/contact-methods/ — `person` comes from the body."""

    channel_display = serializers.CharField(source="get_channel_display", read_only=True)

    class Meta:
        model = ContactMethod
        fields = ["id", "person", "channel", "value", "is_preferred", "channel_display"]
        read_only_fields = ["id", "channel_display"]


class NestedContactMethodSerializer(serializers.ModelSerializer):
    """Written inline as part of a Person; the parent supplies `person`."""

    channel_display = serializers.CharField(source="get_channel_display", read_only=True)

    class Meta:
        model = ContactMethod
        fields = ["id", "channel", "value", "is_preferred", "channel_display"]
        read_only_fields = ["id", "channel_display"]


class PersonSerializer(serializers.ModelSerializer):
    contact_methods = NestedContactMethodSerializer(many=True, read_only=True)
    # Accepted on write so the SPA can save a person and their channels in one
    # request; mirrored back through `contact_methods` on read.
    contacts = NestedContactMethodSerializer(many=True, write_only=True, required=False)

    status_display = serializers.CharField(source="get_status_display", read_only=True)
    relationship_display = serializers.CharField(
        source="relationship.name", read_only=True, default=None
    )
    source_display = serializers.CharField(source="source.name", read_only=True, default=None)
    company_names = serializers.SerializerMethodField()
    company_details = serializers.SerializerMethodField()
    application_labels = serializers.SerializerMethodField()
    preferred_contact_display = serializers.SerializerMethodField()
    photo = serializers.SerializerMethodField()
    catchup_count = serializers.SerializerMethodField()

    class Meta:
        model = Person
        fields = [
            "id",
            "full_name",
            "title",
            "photo",
            "status", "status_display",
            "relationship", "relationship_display",
            "source", "source_display",
            "companies", "company_names", "company_details",
            "applications", "application_labels",
            "last_meeting_at",
            "next_chat_at",
            "cadence_months",
            "notes",
            "contact_methods",
            "contacts",
            "preferred_contact_display",
            "catchup_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id", "status_display", "relationship_display", "source_display",
            "company_names", "company_details", "application_labels",
            "contact_methods", "preferred_contact_display", "photo",
            "catchup_count", "created_at", "updated_at",
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if (
            request is not None
            and request.user.is_authenticated
            and "applications" in self.fields
        ):
            # FR-NET-07 — you can only tag a person against your own applications.
            from applications.models import Application

            self.fields["applications"].child_relation.queryset = (
                Application.objects.filter(user=request.user)
            )

    def get_catchup_count(self, obj):
        return obj.catchups.count()

    def get_photo(self, obj):
        """Absolute URL so the SPA on :5173 can load it from the API origin."""
        if not obj.photo:
            return None
        request = self.context.get("request")
        return request.build_absolute_uri(obj.photo.url) if request else obj.photo.url

    def get_company_names(self, obj):
        return [c.name for c in obj.companies.all()]

    def get_company_details(self, obj):
        """Name + logo per company, so the bubble view can render hubs without
        a second round-trip to the catalog."""
        request = self.context.get("request")
        return [
            {
                "id": c.id,
                "name": c.name,
                "logo": (
                    request.build_absolute_uri(c.logo.url)
                    if c.logo and request
                    else (c.logo.url if c.logo else None)
                ),
            }
            for c in obj.companies.all()
        ]

    def get_application_labels(self, obj):
        return [
            {"id": a.id, "label": f"{a.company.name} · {a.get_stage_display()}"}
            for a in obj.applications.all()
        ]

    def get_preferred_contact_display(self, obj):
        contact = obj.preferred_contact
        if not contact:
            return None
        return {"channel": contact.channel, "value": contact.value}

    def validate_full_name(self, value):
        """uniq_person_name_per_user is (user, full_name) and the client never
        sends user, so DRF's unique check can't see the pair."""
        user = self.context["request"].user
        name = value.strip()
        clash = Person.objects.filter(user=user, full_name__iexact=name)
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("You already track someone by that name.")
        return name

    def validate(self, attrs):
        last = attrs.get("last_meeting_at", getattr(self.instance, "last_meeting_at", None))
        nxt = attrs.get("next_chat_at", getattr(self.instance, "next_chat_at", None))
        if last and nxt and nxt < last:
            raise serializers.ValidationError(
                {"next_chat_at": "Next chat cannot be before the last meeting."}
            )
        return attrs

    def _sync_contacts(self, person, contacts):
        """Replace the channel list wholesale — the form sends the full set."""
        person.contact_methods.all().delete()
        seen = set()
        for entry in contacts:
            entry.pop("person", None)
            key = (entry.get("channel"), entry.get("value"))
            if not all(key) or key in seen:
                continue
            seen.add(key)
            ContactMethod.objects.create(person=person, **entry)

    def create(self, validated_data):
        contacts = validated_data.pop("contacts", None)
        companies = validated_data.pop("companies", [])
        applications = validated_data.pop("applications", [])

        person = Person(**validated_data)
        person.apply_cadence_default()  # FR-NET-10
        person.save()

        person.companies.set(companies)
        person.applications.set(applications)
        if contacts is not None:
            self._sync_contacts(person, contacts)
        return person

    def update(self, instance, validated_data):
        contacts = validated_data.pop("contacts", None)
        companies = validated_data.pop("companies", None)
        applications = validated_data.pop("applications", None)

        # Switching a contact to "never" should stop the reminder they already
        # have, not just prevent the next one — otherwise the setting looks
        # like it did nothing while a scheduled date keeps nagging.
        previous_next_chat = instance.next_chat_at
        turning_off = (
            "cadence_months" in validated_data
            and validated_data["cadence_months"] == CADENCE_NEVER
            and instance.cadence_months != CADENCE_NEVER
        )

        for field, value in validated_data.items():
            setattr(instance, field, value)
        # Compared against the old value rather than checking whether the field
        # was sent: the edit form always posts the whole person back, so the
        # existing date arrives on every save. An unchanged one is the reminder
        # being switched off; a different one is a date the user just typed,
        # which stands.
        if turning_off and instance.next_chat_at == previous_next_chat:
            instance.next_chat_at = None
        # FR-NET-10 — an explicit next_chat_at survives untouched; a blank one
        # falls back to last meeting + 3 months.
        instance.apply_cadence_default()
        instance.save()

        if companies is not None:
            instance.companies.set(companies)
        if applications is not None:
            instance.applications.set(applications)
        if contacts is not None:
            self._sync_contacts(instance, contacts)
        return instance


class PersonListSerializer(PersonSerializer):
    """Same shape minus the heavy M2M label lookups, for the index page."""

    class Meta(PersonSerializer.Meta):
        fields = [
            "id",
            "full_name",
            "title",
            "photo",
            "status", "status_display",
            "relationship", "relationship_display",
            "source", "source_display",
            "companies", "company_names", "company_details",
            "last_meeting_at",
            "next_chat_at",
            "contact_methods",
            "preferred_contact_display",
            "catchup_count",
            "updated_at",
        ]


def choice_payload():
    """Relationship and "met via" moved to their own addable catalogs
    (`/api/relationships/`, `/api/met-sources/`) — status and channel are
    still the closed enums this endpoint exists for."""
    def pack(enum):
        return [{"value": v, "label": l} for v, l in enum.choices]

    return {
        "status": pack(PersonStatus),
        "channel": pack(ContactChannel),
    }


class PersonPhotoSerializer(serializers.Serializer):
    """Multipart-only, on its own endpoint — the person form stays JSON so its
    nested `contacts` array keeps working."""

    photo = serializers.ImageField(write_only=True)

    def validate_photo(self, value):
        return validate_image(value)

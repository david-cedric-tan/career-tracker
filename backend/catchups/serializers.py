from rest_framework import serializers

from network.models import MessageChannel, Person

from .models import Catchup, CatchupFormat


class CatchupSerializer(serializers.ModelSerializer):
    person_name = serializers.CharField(source="person.full_name", read_only=True)
    person_photo = serializers.SerializerMethodField()
    person_companies = serializers.SerializerMethodField()
    person_companies_info = serializers.SerializerMethodField()
    format_display = serializers.CharField(source="display_format", read_only=True)
    display_title = serializers.CharField(read_only=True)

    class Meta:
        model = Catchup
        fields = [
            "id",
            "person", "person_name", "person_photo", "person_companies",
            "person_companies_info",
            "met_on",
            "title", "display_title",
            "format", "format_display", "format_other", "message_channel",
            "location",
            "minutes",
            "takeaways",
            "follow_up_on",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id", "person_name", "person_photo", "person_companies",
            "person_companies_info",
            "format_display", "display_title", "created_at", "updated_at",
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request is not None and request.user.is_authenticated:
            # FR-CATCH-02 / integrity rule 1 — you can only minute your own
            # contacts, so the client can't reach another user's person by id.
            self.fields["person"].queryset = Person.objects.filter(user=request.user)

    def get_person_photo(self, catchup):
        photo = catchup.person.photo
        if not photo:
            return None
        request = self.context.get("request")
        return request.build_absolute_uri(photo.url) if request else photo.url

    def get_person_companies(self, catchup):
        return [company.display_name for company in catchup.person.companies.all()]

    def get_person_companies_info(self, catchup):
        """Id + logo too, so the card can draw a chip that links through."""
        request = self.context.get("request")
        rows = []
        for company in catchup.person.companies.all():
            logo = None
            if company.logo:
                logo = request.build_absolute_uri(company.logo.url) if request else company.logo.url
            rows.append(
                {
                    "id": company.id,
                    "name": company.display_name,
                    "full_name": company.name,
                    "logo": logo,
                }
            )
        return rows

    def validate_title(self, value):
        return value.strip()

    def validate(self, attrs):
        met_on = attrs.get("met_on", getattr(self.instance, "met_on", None))
        follow_up = attrs.get("follow_up_on", getattr(self.instance, "follow_up_on", None))
        if met_on and follow_up and follow_up < met_on:
            raise serializers.ValidationError(
                {"follow_up_on": "The follow-up can’t be before the meeting."}
            )
        return attrs


def choice_payload():
    return {
        "format": [{"value": v, "label": l} for v, l in CatchupFormat.choices],
        "message_channel": [{"value": v, "label": l} for v, l in MessageChannel.choices],
    }

from rest_framework import serializers

from config.documents import document_kind, validate_document
from config.images import validate_image

from .models import (
    Application,
    ApplicationDocument,
    ApplicationJobListing,
    ApplicationStage,
    AppsEventLog,
    Company,
    Country,
    EventType,
    Industry,
    JobListing,
    Location,
    Outcome,
    Resume,
    Role,
    Stage,
    State,
    Venue,
)


# ---------------------------------------------------------------------------
# Reference catalogs
# ---------------------------------------------------------------------------

class IndustrySerializer(serializers.ModelSerializer):
    class Meta:
        model = Industry
        fields = ["id", "name"]
        read_only_fields = ["id"]


class CountrySerializer(serializers.ModelSerializer):
    class Meta:
        model = Country
        fields = ["id", "name"]
        read_only_fields = ["id"]


class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ["id", "name"]
        read_only_fields = ["id"]


class CompanySerializer(serializers.ModelSerializer):
    # A company can span more than one industry (FR-COMPANY-05) — same shape
    # as `regions` below, not a single FK any more.
    industry_names = serializers.SerializerMethodField()
    logo = serializers.SerializerMethodField()
    region_names = serializers.SerializerMethodField()

    class Meta:
        model = Company
        fields = [
            "id", "name", "short_name", "industries", "industry_names", "logo",
            "regions", "region_names",
        ]
        read_only_fields = ["id", "industry_names", "logo", "region_names"]

    def get_logo(self, company):
        """Absolute URL so the SPA on :5173 can load it from the API origin."""
        if not company.logo:
            return None
        request = self.context.get("request")
        return request.build_absolute_uri(company.logo.url) if request else company.logo.url

    def get_region_names(self, company):
        return [region.name for region in company.regions.all()]

    def get_industry_names(self, company):
        return [industry.name for industry in company.industries.all()]


class CompanyNoteSerializer(serializers.Serializer):
    """Not a ModelSerializer — this always reads/writes exactly one row,
    upserted, so there's no id/company/user for the client to ever pass."""

    notes = serializers.CharField(allow_blank=True, required=False, default="")
    updated_at = serializers.DateTimeField(read_only=True, required=False)


class CompanyLogoSerializer(serializers.Serializer):
    """Multipart-only, on its own endpoint — the catalog form stays JSON."""

    logo = serializers.ImageField(write_only=True)

    def validate_logo(self, value):
        return validate_image(value)


class StateSerializer(serializers.ModelSerializer):
    country_name = serializers.CharField(source="country.name", read_only=True)

    class Meta:
        model = State
        fields = ["id", "name", "country", "country_name"]
        read_only_fields = ["id", "country_name"]


class LocationSerializer(serializers.ModelSerializer):
    state_name = serializers.CharField(source="state.name", read_only=True)
    # Location.country is a @property returning a Country instance, so pull the
    # id and name off it rather than trying to serialize the object.
    country = serializers.IntegerField(source="state.country_id", read_only=True)
    country_name = serializers.CharField(source="state.country.name", read_only=True)
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = Location
        fields = [
            "id", "name", "state", "state_name", "country", "country_name", "full_name",
        ]
        read_only_fields = ["id", "state_name", "country", "country_name", "full_name"]

    def get_full_name(self, obj):
        return f"{obj.name}, {obj.state.name}, {obj.state.country.name}"


def stage_label(key):
    """Display name for a stored stage key.

    The catalog first, then the built-in enum, then the key itself. Django's
    own `get_stage_display()` falls back to the raw key for anything outside
    the enum, which is every custom stage — so it can't be used directly.
    """
    if not key:
        return None
    row = ApplicationStage.objects.filter(key=key).first()
    if row:
        return row.name
    return dict(Stage.choices).get(key, key)


class ApplicationStageSerializer(serializers.ModelSerializer):
    """`key` is what applications and the event log actually store; the API
    generates it from the name, so callers only ever send a name."""

    class Meta:
        model = ApplicationStage
        fields = ["id", "key", "name", "position", "is_preset"]
        # `position` is server-assigned on create (see the model) so a new
        # stage lands inside the funnel rather than after the finish line.
        read_only_fields = ["id", "key", "position", "is_preset"]


class VenueSerializer(serializers.ModelSerializer):
    location_name = serializers.CharField(source="location.name", read_only=True)
    state_name = serializers.CharField(source="location.state.name", read_only=True)
    # Venue.country is a @property, so pull id/name off it rather than trying
    # to serialize the object directly — same trick as Location.country above.
    country = serializers.IntegerField(source="location.state.country_id", read_only=True)
    country_name = serializers.CharField(source="location.state.country.name", read_only=True)
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = Venue
        fields = [
            "id", "name", "location", "location_name",
            "state_name", "country", "country_name", "full_name",
        ]
        read_only_fields = ["id", "location_name", "state_name", "country", "country_name", "full_name"]

    def get_full_name(self, obj):
        return f"{obj.name}, {obj.location.name}, {obj.location.state.name}, {obj.location.state.country.name}"


# ---------------------------------------------------------------------------
# Resume
# ---------------------------------------------------------------------------

class ResumeSerializer(serializers.ModelSerializer):
    variant_type_display = serializers.CharField(
        source="get_variant_type_display", read_only=True
    )
    file = serializers.SerializerMethodField()
    file_kind = serializers.SerializerMethodField()
    file_size = serializers.SerializerMethodField()
    target_company_names = serializers.SerializerMethodField()
    target_role_names = serializers.SerializerMethodField()
    application_count = serializers.IntegerField(
        source="applications.count", read_only=True
    )

    class Meta:
        model = Resume
        fields = [
            "id",
            "label",
            "variant_type",
            "variant_type_display",
            "target_companies",
            "target_company_names",
            "target_roles",
            "target_role_names",
            "notes",
            "is_active",
            "file",
            "file_name",
            "file_kind",
            "file_size",
            "application_count",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "variant_type_display",
            "file",
            "file_name",
            "file_kind",
            "file_size",
            "target_company_names",
            "target_role_names",
            "application_count",
            "created_at",
            "updated_at",
        ]

    def get_file(self, resume):
        if not resume.file:
            return None
        request = self.context.get("request")
        return request.build_absolute_uri(resume.file.url) if request else resume.file.url

    def get_file_kind(self, resume):
        return document_kind(resume.file_name) if resume.file else None

    def get_file_size(self, resume):
        """Bytes, or None — a missing file on disk shouldn't 500 the list."""
        if not resume.file:
            return None
        try:
            return resume.file.size
        except (OSError, ValueError):
            return None

    def get_target_company_names(self, obj):
        return [c.name for c in obj.target_companies.all()]

    def get_target_role_names(self, obj):
        return [r.name for r in obj.target_roles.all()]

    def validate_label(self, value):
        """uniq_resume_label_per_user is (user, label), and the client never
        sends user — so DRF's automatic unique check can't see the pair and
        the constraint would surface as a 500. Check it here instead."""
        user = self.context["request"].user
        clash = Resume.objects.filter(user=user, label__iexact=value.strip())
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError("You already have a resume with that label.")
        return value.strip()


# ---------------------------------------------------------------------------
# Job listings
# ---------------------------------------------------------------------------

class JobListingSerializer(serializers.ModelSerializer):
    company_name = serializers.CharField(source="company.name", read_only=True)
    role_name = serializers.CharField(source="role.name", read_only=True)
    location_name = serializers.CharField(
        source="location.name", read_only=True, default=None
    )
    role_type_display = serializers.CharField(
        source="get_role_type_display", read_only=True
    )
    work_arrangement_display = serializers.CharField(
        source="get_work_arrangement_display", read_only=True
    )
    skills_list = serializers.SerializerMethodField()
    linkedin_application_count = serializers.SerializerMethodField()

    class Meta:
        model = JobListing
        fields = [
            "id",
            "company", "company_name",
            "role", "role_name",
            "location", "location_name",
            "role_type", "role_type_display",
            "work_arrangement", "work_arrangement_display",
            "opened_at",
            "closing_at",
            "job_url",
            "description",
            "skills",
            "skills_list",
            "linkedin_application_count",
        ]
        read_only_fields = [
            "id", "company_name", "role_name", "location_name",
            "role_type_display", "work_arrangement_display",
            "skills_list", "linkedin_application_count",
        ]

    def get_skills_list(self, listing):
        return [skill.strip() for skill in listing.skills.split(",") if skill.strip()]

    def get_linkedin_application_count(self, listing):
        return listing.application_links.filter(
            application__source__icontains="linkedin"
        ).values("application_id").distinct().count()

    def validate_job_url(self, value):
        """`job_url` is unique but nullable; an empty string from a form would
        collide on the second blank listing. Normalise it to None."""
        return value or None

    def validate(self, attrs):
        """Model.clean() is NOT called by DRF — .save() skips full_clean().
        Without this the date rule silently never runs."""
        opened = attrs.get("opened_at") or getattr(self.instance, "opened_at", None)
        closing = attrs.get("closing_at") or getattr(self.instance, "closing_at", None)
        if opened and closing and closing < opened:
            raise serializers.ValidationError(
                {"closing_at": "Closing date cannot precede opening date."}
            )
        return attrs


# ---------------------------------------------------------------------------
# Application junction + event log
# ---------------------------------------------------------------------------

class ApplicationJobListingSerializer(serializers.ModelSerializer):
    """Link rows between an application and the listings it covers.

    Reachable both flat (/api/application-job-listings/) and nested
    (/api/applications/{id}/listings/); in the nested case the parent comes
    from the URL via serializer context.
    """

    listing_detail = JobListingSerializer(source="job_listing", read_only=True)
    effective_outcome = serializers.CharField(read_only=True)

    class Meta:
        model = ApplicationJobListing
        fields = [
            "id",
            "application",
            "job_listing",
            "listing_detail",
            "outcome",
            "effective_outcome",
        ]
        read_only_fields = ["id", "listing_detail", "effective_outcome"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request is not None and request.user.is_authenticated:
            self.fields["application"].queryset = Application.objects.filter(
                user=request.user
            )
        if self.context.get("application") is not None:
            # Parent is fixed by the URL — don't let the body override it.
            self.fields["application"].required = False
            self.fields["application"].read_only = True

    def validate(self, attrs):
        """FR-APP-03 — a listing must belong to the application's company."""
        application = self.context.get("application") or attrs.get("application")
        if application is None and self.instance is not None:
            application = self.instance.application

        listing = attrs.get("job_listing") or getattr(self.instance, "job_listing", None)

        if application is not None and listing is not None:
            if listing.company_id != application.company_id:
                raise serializers.ValidationError(
                    {
                        "job_listing": (
                            f"That listing belongs to a different company than this "
                            f"application ({application.company.name})."
                        )
                    }
                )
        return attrs


class AppsEventLogSerializer(serializers.ModelSerializer):
    """FR-LOG-01 — append-only. Everything read-only: rows are written by the
    service layer, never through the API."""

    company_name = serializers.CharField(
        source="application.company.name", read_only=True
    )
    event_type_display = serializers.CharField(
        source="get_event_type_display", read_only=True
    )
    prev_stage_display = serializers.SerializerMethodField()
    curr_stage_display = serializers.SerializerMethodField()
    prev_outcome_display = serializers.SerializerMethodField()
    curr_outcome_display = serializers.CharField(
        source="get_curr_outcome_display", read_only=True
    )

    class Meta:
        model = AppsEventLog
        fields = [
            "id",
            "application",
            "company_name",
            "event_type",
            "event_type_display",
            "prev_stage",
            "prev_stage_display",
            "curr_stage",
            "curr_stage_display",
            "prev_outcome",
            "prev_outcome_display",
            "curr_outcome",
            "curr_outcome_display",
            "changes",
            "changed_at",
            "note",
        ]
        read_only_fields = fields

    def get_prev_stage_display(self, log):
        # A log row is history: it can name a stage since renamed or deleted,
        # and showing the bare key beats showing nothing.
        return stage_label(log.prev_stage)

    def get_curr_stage_display(self, log):
        return stage_label(log.curr_stage)

    def get_prev_outcome_display(self, log):
        return dict(Outcome.choices).get(log.prev_outcome) if log.prev_outcome else None


# ---------------------------------------------------------------------------
# Application
#
# Two serializers: a light one for lists, a full one for detail. The list
# endpoint should not drag every nested listing along for 40 rows.
# ---------------------------------------------------------------------------

class ApplicationDocumentSerializer(serializers.ModelSerializer):
    """Read shape for a document in the application's gallery."""

    file = serializers.SerializerMethodField()
    file_kind = serializers.SerializerMethodField()

    class Meta:
        model = ApplicationDocument
        fields = [
            "id", "title", "description", "file", "file_kind", "kind",
            "original_name", "position", "created_at",
        ]
        read_only_fields = fields

    def get_file(self, document):
        request = self.context.get("request")
        url = document.file.url
        return request.build_absolute_uri(url) if request else url

    def get_file_kind(self, document):
        return document_kind(document.original_name or document.file.name)


class ApplicationDocumentUploadSerializer(serializers.Serializer):
    """Write shape — multipart, so the file rides alongside its labels."""

    file = serializers.FileField()
    title = serializers.CharField(max_length=255, required=False, allow_blank=True)
    description = serializers.CharField(required=False, allow_blank=True)


class ApplicationDocumentEditSerializer(serializers.Serializer):
    """Title/description only — replacing the file means a new upload."""

    title = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True)


def outcome_changed_at(application):
    """When the current outcome was decided, or None if it never moved.

    Read off the event log rather than stored: `updated_at` moves on any edit,
    so it can't answer "when was this rejected". Uses the prefetched rows the
    list view already loads, so it costs no extra query.
    """
    stamps = [
        log.changed_at
        for log in application.event_logs.all()
        if log.event_type == EventType.OUTCOME
    ]
    return max(stamps).isoformat() if stamps else None


def application_deadline(application):
    """The soonest closing date across this application's listings, or None.

    An application can cover several postings at one company; the one that
    shuts first is the one that actually constrains you, so that's the date
    worth showing. Listings with no closing date simply don't compete.
    """
    dates = [
        link.job_listing.closing_at
        for link in application.listing_links.all()
        if link.job_listing.closing_at
    ]
    # ISO string rather than a date object, so the field reads the same whether
    # it's been through JSON rendering or not.
    return min(dates).isoformat() if dates else None


def company_logo_url(application, context):
    """Absolute URL of the application's company mark, or None."""
    logo = application.company.logo
    if not logo:
        return None
    request = context.get("request")
    return request.build_absolute_uri(logo.url) if request else logo.url


class ApplicationListSerializer(serializers.ModelSerializer):
    company_name = serializers.CharField(source="company.name", read_only=True)
    company_logo = serializers.SerializerMethodField()
    stage_display = serializers.SerializerMethodField()

    def get_company_logo(self, application):
        return company_logo_url(application, self.context)
    outcome_display = serializers.CharField(source="get_outcome_display", read_only=True)

    def get_stage_display(self, application):
        return stage_label(application.stage)
    listing_count = serializers.IntegerField(source="listing_links.count", read_only=True)
    awaiting_days = serializers.IntegerField(read_only=True)
    deadline = serializers.SerializerMethodField()
    outcome_changed_at = serializers.SerializerMethodField()

    def get_deadline(self, application):
        return application_deadline(application)

    def get_outcome_changed_at(self, application):
        return outcome_changed_at(application)
    role_names = serializers.SerializerMethodField()
    resume_label = serializers.CharField(
        source="resume.label", read_only=True, default=None
    )

    class Meta:
        model = Application
        fields = [
            "id",
            "company", "company_name", "company_logo",
            "stage", "stage_display",
            "outcome", "outcome_display",
            "applied_at",
            "follow_up_date",
            "reapply_at",
            "source",
            "resume", "resume_label",
            "listing_count",
            "role_names",
            "awaiting_response", "awaiting_since", "awaiting_days",
            "is_historical",
            "deadline",
            "stage_updated_at",
            "outcome_changed_at",
            "updated_at",
        ]
        read_only_fields = fields

    def get_role_names(self, obj):
        return sorted({link.job_listing.role.name for link in obj.listing_links.all()})


class ApplicationSerializer(serializers.ModelSerializer):
    company_name = serializers.CharField(source="company.name", read_only=True)
    company_logo = serializers.SerializerMethodField()
    stage_display = serializers.SerializerMethodField()

    def get_company_logo(self, application):
        return company_logo_url(application, self.context)
    outcome_display = serializers.CharField(source="get_outcome_display", read_only=True)

    def get_stage_display(self, application):
        return stage_label(application.stage)
    listing_links = ApplicationJobListingSerializer(many=True, read_only=True)
    resume_label = serializers.CharField(
        source="resume.label", read_only=True, default=None
    )
    event_logs = AppsEventLogSerializer(many=True, read_only=True)
    documents = ApplicationDocumentSerializer(many=True, read_only=True)
    awaiting_days = serializers.IntegerField(read_only=True)
    deadline = serializers.SerializerMethodField()
    outcome_changed_at = serializers.SerializerMethodField()

    def get_deadline(self, application):
        return application_deadline(application)

    def get_outcome_changed_at(self, application):
        return outcome_changed_at(application)

    # Free-text note that becomes AppsEventLog.note when stage/outcome changes.
    # Not a model field — the service layer consumes it.
    event_note = serializers.CharField(write_only=True, required=False, allow_blank=True)
    # Convenience for the SPA form: attach listings in the same request that
    # creates the application, instead of a second round-trip per listing.
    listing_ids = serializers.PrimaryKeyRelatedField(
        many=True,
        write_only=True,
        required=False,
        queryset=JobListing.objects.all(),
    )

    class Meta:
        model = Application
        fields = [
            "id",
            "company", "company_name", "company_logo",
            "stage", "stage_display",
            "outcome", "outcome_display",
            "applied_at",
            "source",
            "resume", "resume_label",
            "resume_version",
            "follow_up_date",
            "reapply_at",
            "stage_updated_at",
            "awaiting_response", "awaiting_since", "awaiting_days",
            "is_historical",
            "deadline",
            "outcome_changed_at",
            "notes",
            "listing_links",
            "listing_ids",
            "event_logs",
            "event_note",
            "documents",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id", "company_name", "company_logo", "stage_display", "outcome_display",
            "listing_links", "resume_label", "event_logs", "documents",
            "awaiting_since", "awaiting_days", "is_historical", "deadline",
            "outcome_changed_at",
            "stage_updated_at", "created_at", "updated_at",
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request is not None and request.user.is_authenticated:
            # FR-RES-06 — you can only attach your own resumes. Without this
            # scoping a client could send another user's resume id.
            self.fields["resume"].queryset = Resume.objects.filter(
                user=request.user, is_active=True
            )

    def validate(self, attrs):
        """Application.clean() is never called by DRF, so the ownership rule
        has to be enforced here too."""
        request = self.context.get("request")
        resume = attrs.get("resume")
        if resume and request and resume.user_id != request.user.id:
            raise serializers.ValidationError({"resume": "Resume must belong to you."})

        company = attrs.get("company") or getattr(self.instance, "company", None)
        stray = [
            listing
            for listing in attrs.get("listing_ids", [])
            if company and listing.company_id != company.id
        ]
        if stray:
            raise serializers.ValidationError(
                {
                    "listing_ids": (
                        "All linked job listings must belong to this application's "
                        f"company ({company.name})."
                    )
                }
            )
        return attrs


class ResumeFileSerializer(serializers.Serializer):
    """Multipart-only, on its own endpoint — the resume form stays JSON."""

    file = serializers.FileField(write_only=True)

    def validate_file(self, value):
        return validate_document(value)

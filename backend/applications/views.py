"""REST API for the applications domain.

Ownership rule (FR-AUTH-02): reference catalogs (companies, roles, locations,
industries) are shared lookup data, while resumes, applications, link rows and
event logs are always filtered to `request.user`.
"""

import os
import secrets
from datetime import datetime, time, timedelta

from django.db.models import Max, Prefetch, Q
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from config.attachments import classify_and_validate
from config.images import contain_thumbnail
from .imports import import_listings

from .models import (
    Application,
    ApplicationDocument,
    ApplicationJobListing,
    ApplicationStage,
    AppsEventLog,
    Company,
    CompanyNote,
    Country,
    EventType,
    Industry,
    JobListing,
    Location,
    Outcome,
    Resume,
    Role,
    RoleType,
    Stage,
    State,
    Venue,
    WorkArrangement,
)
from .serializers import (
    ApplicationDocumentEditSerializer,
    ApplicationDocumentSerializer,
    ApplicationDocumentUploadSerializer,
    ApplicationJobListingSerializer,
    CompanyLogoSerializer,
    CompanyNoteSerializer,
    ApplicationListSerializer,
    ApplicationSerializer,
    ApplicationStageSerializer,
    AppsEventLogSerializer,
    CompanySerializer,
    CountrySerializer,
    IndustrySerializer,
    JobListingSerializer,
    LocationSerializer,
    ResumeFileSerializer,
    ResumeSerializer,
    RoleSerializer,
    StateSerializer,
    VenueSerializer,
)
from .services import (
    diff,
    end_waiting,
    log_change,
    log_creation,
    log_transition,
    log_waiting,
    resync_waiting,
    settle_waiting,
    snapshot,
)


def stage_keys() -> set[str]:
    """Every stage you can currently move to. Read per request rather than
    cached at import: the list grows the moment someone adds one."""
    return set(ApplicationStage.objects.values_list("key", flat=True))


class NamedCatalogViewSet(viewsets.ModelViewSet):
    """Shared behaviour for the simple `name`-keyed catalogs.

    `?search=` powers the SPA's type-ahead pickers, and `ensure/` gives them a
    get-or-create so logging an application never forces a pre-seeding step
    (FR-REF-07).
    """

    permission_classes = [IsAuthenticated]
    search_fields = ["name"]
    # Extra fields the `ensure` lookup must match on, e.g. State needs country.
    scope_fields: list[str] = []
    # Reverse-relation accessor name -> singular label for the 409 message,
    # e.g. {"listings": "job listing"}. Every one of these catalogs is
    # PROTECTed by at least one real FK/M2M, so the default `destroy` would
    # otherwise surface Django's ProtectedError as a raw, unexplained 500 —
    # same bug, same fix, as Company/JobListing's own destroy overrides.
    protected_relations: dict[str, str] = {}

    def get_queryset(self):
        qs = super().get_queryset()
        search = self.request.query_params.get("search")
        if search:
            qs = qs.filter(name__icontains=search)
        for field in self.scope_fields:
            value = self.request.query_params.get(field)
            if value:
                qs = qs.filter(**{f"{field}_id": value})
        return qs

    @staticmethod
    def _plural(count, label):
        """"1 company" / "2 companies" — a bare "s" made it "2 companys"."""
        if count == 1:
            return f"1 {label}"
        if label.endswith("y") and not label.endswith(("ay", "ey", "iy", "oy", "uy")):
            return f"{count} {label[:-1]}ies"
        if label.endswith(("s", "x", "z", "ch", "sh")):
            return f"{count} {label}es"
        return f"{count} {label}s"

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        blockers = []
        for accessor, label in self.protected_relations.items():
            count = getattr(instance, accessor).count()
            if count:
                blockers.append(self._plural(count, label))
        if blockers:
            return Response(
                {
                    "detail": (
                        f"Can't delete '{instance}' — it still has "
                        f"{' and '.join(blockers)}. Remove those first."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=["post"])
    def ensure(self, request):
        """Get-or-create by name (case-insensitive) plus any scope fields."""
        name = (request.data.get("name") or "").strip()
        if not name:
            return Response(
                {"name": ["This field is required."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        lookup = {"name__iexact": name}
        defaults = {"name": name}
        for field in self.scope_fields:
            value = request.data.get(field)
            if not value:
                return Response(
                    {field: ["This field is required."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            lookup[f"{field}_id"] = value
            defaults[f"{field}_id"] = value

        existing = self.queryset.model.objects.filter(**lookup).first()
        if existing:
            return Response(self.get_serializer(existing).data)

        serializer = self.get_serializer(data={**request.data, "name": name})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class ApplicationStageViewSet(NamedCatalogViewSet):
    """The pipeline's steps. Addable like the other catalogs, but two rules of
    its own: a preset can't be deleted (the pipeline keeps a spine), and one
    still in use by an application can't either — the row would keep a stage
    key nothing can explain."""

    queryset = ApplicationStage.objects.all()
    serializer_class = ApplicationStageSerializer

    def destroy(self, request, *args, **kwargs):
        stage = self.get_object()
        if stage.is_preset:
            return Response(
                {
                    "detail": (
                        f"'{stage.name}' is one of the built-in stages, so it can't be "
                        "deleted. You can rename it instead."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )
        in_use = Application.objects.filter(stage=stage.key).count()
        if in_use:
            return Response(
                {
                    "detail": (
                        f"Can't delete '{stage.name}' — "
                        f"{self._plural(in_use, 'application')} still sitting at it. "
                        "Move those on first."
                    )
                },
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)


class IndustryViewSet(NamedCatalogViewSet):
    queryset = Industry.objects.all()
    serializer_class = IndustrySerializer
    protected_relations = {"companies": "company"}


class RoleViewSet(NamedCatalogViewSet):
    queryset = Role.objects.all()
    serializer_class = RoleSerializer
    protected_relations = {"listings": "job listing"}


class CountryViewSet(NamedCatalogViewSet):
    queryset = Country.objects.all()
    serializer_class = CountrySerializer
    protected_relations = {"states": "state", "companies_in_region": "company"}


class CompanyViewSet(NamedCatalogViewSet):
    queryset = Company.objects.prefetch_related("industries", "regions").all()
    serializer_class = CompanySerializer
    protected_relations = {"listings": "job listing", "applications": "application"}

    @action(
        detail=True,
        methods=["post", "delete"],
        parser_classes=[MultiPartParser, FormParser],
    )
    def logo(self, request, pk=None):
        """POST/DELETE /api/companies/{id}/logo/ — set or clear the brand mark.

        Companies are shared reference data, so the logo is shared too rather
        than being scoped to whoever uploaded it.
        """
        company = self.get_object()

        if request.method == "DELETE":
            company.logo.delete(save=True)
            return Response(self.get_serializer(company).data)

        serializer = CompanyLogoSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        company.logo.delete(save=False)  # don't orphan the previous file
        company.logo = contain_thumbnail(
            serializer.validated_data["logo"], name=f"company-{company.id}"
        )
        company.save()
        return Response(self.get_serializer(company).data)

    @action(detail=True, methods=["get", "put"])
    def note(self, request, pk=None):
        """GET/PUT /api/companies/{id}/note/ — this user's own private note
        on an otherwise-shared company. Always exactly one row per
        (user, company), upserted rather than exposed as its own CRUD
        resource — there's nothing to list or paginate."""
        company = self.get_object()
        note, _ = CompanyNote.objects.get_or_create(user=request.user, company=company)

        if request.method == "GET":
            return Response(CompanyNoteSerializer(note).data)

        serializer = CompanyNoteSerializer(note, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        note.notes = serializer.validated_data.get("notes", note.notes)
        note.save()
        return Response(CompanyNoteSerializer(note).data)


class StateViewSet(NamedCatalogViewSet):
    queryset = State.objects.select_related("country").all()
    serializer_class = StateSerializer
    scope_fields = ["country"]
    protected_relations = {"locations": "location"}


class LocationViewSet(NamedCatalogViewSet):
    queryset = Location.objects.select_related("state", "state__country").all()
    serializer_class = LocationSerializer
    scope_fields = ["state"]
    protected_relations = {"listings": "job listing", "venues": "venue"}


class VenueViewSet(NamedCatalogViewSet):
    queryset = Venue.objects.select_related(
        "location", "location__state", "location__state__country"
    ).all()
    serializer_class = VenueSerializer
    scope_fields = ["location"]


class ResumeViewSet(viewsets.ModelViewSet):
    """FR-RES-01 — the library is per-user, never shared."""

    serializer_class = ResumeSerializer
    permission_classes = [IsAuthenticated]
    queryset = Resume.objects.none()

    def get_queryset(self):
        qs = (
            Resume.objects.filter(user=self.request.user)
            .prefetch_related("target_companies", "target_roles")
        )
        variant = self.request.query_params.get("variant_type")
        if variant:
            qs = qs.filter(variant_type=variant)
        active = self.request.query_params.get("is_active")
        if active is not None:
            qs = qs.filter(is_active=active.lower() in {"1", "true", "yes"})
        search = self.request.query_params.get("search")
        if search:
            qs = qs.filter(Q(label__icontains=search) | Q(notes__icontains=search))
        return qs

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(
        detail=True,
        methods=["post", "delete"],
        parser_classes=[MultiPartParser, FormParser],
    )
    def file(self, request, pk=None):
        """POST/DELETE /api/resumes/{id}/file/ — attach or remove the document."""
        resume = self.get_object()

        if request.method == "DELETE":
            resume.file.delete(save=False)
            resume.file_name = ""
            resume.save(update_fields=["file", "file_name", "updated_at"])
            return Response(self.get_serializer(resume).data)

        serializer = ResumeFileSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        upload = serializer.validated_data["file"]

        # Checked here rather than left to the database, so a clash comes back
        # as a field error the form can show instead of a 500. Scoped to this
        # user: another account's identically-named resume is irrelevant.
        clash = (
            Resume.objects.filter(user=request.user, file_name=upload.name)
            .exclude(pk=resume.pk)
            .first()
        )
        if clash is not None:
            return Response(
                {"file": [f"You already have a resume file called “{upload.name}” ({clash.label})."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        resume.file.delete(save=False)  # don't orphan the previous document
        # Keep the original name for display and download; the stored name gets
        # a suffix so a replacement can't be served from cache.
        resume.file_name = upload.name
        extension = os.path.splitext(upload.name)[1].lower()
        upload.name = f"resume-{resume.id}-{secrets.token_hex(4)}{extension}"
        resume.file = upload
        resume.save()

        return Response(self.get_serializer(resume).data)


class JobListingViewSet(viewsets.ModelViewSet):
    """Listings are shared reference data (a posting exists independent of who
    applied), filterable by company/role/location for the picker UI."""

    queryset = JobListing.objects.select_related(
        "company", "role", "location", "location__state"
    ).prefetch_related("application_links__application").all()
    serializer_class = JobListingSerializer
    permission_classes = [IsAuthenticated]

    def destroy(self, request, *args, **kwargs):
        """Same reasoning as CompanyViewSet.destroy — an application covering
        this listing PROTECTs it; surface that as a clear 409 rather than a
        raw 500 from Django's ProtectedError.

        Listings are shared, so the blocker may well be an application on
        someone else's account. Saying only "1 application still references
        it" is unactionable in that case — you go delete your own application,
        the listing still won't budge, and nothing explains why. So name the
        applications you can actually act on, and account for the rest
        separately.
        """
        listing = self.get_object()
        links = listing.application_links.select_related("application__company").all()
        mine = [link for link in links if link.application.user_id == request.user.id]
        others = len(links) - len(mine)
        if not links:
            return super().destroy(request, *args, **kwargs)

        parts = []
        if mine:
            labels = ", ".join(
                f"your {link.application.company.name} application" for link in mine[:3]
            )
            if len(mine) > 3:
                labels += f" and {len(mine) - 3} more of yours"
            parts.append(labels)
        if others:
            parts.append(
                f"{others} application{'s' if others != 1 else ''} on another account"
            )

        detail = f"Can't delete this listing — it's still linked to {' and '.join(parts)}."
        if mine:
            detail += " Unlink it from those applications first."
        if others and not mine:
            detail += (
                " Listings are shared reference data, so it can't be removed while "
                "someone else is tracking it."
            )
        return Response({"detail": detail}, status=status.HTTP_409_CONFLICT)

    def get_queryset(self):
        qs = super().get_queryset()
        params = self.request.query_params
        for field in ("company", "role", "location"):
            value = params.get(field)
            if value:
                qs = qs.filter(**{f"{field}_id": value})
        for field in ("role_type", "work_arrangement"):
            value = params.get(field)
            if value:
                qs = qs.filter(**{field: value})
        search = params.get("search")
        if search:
            qs = qs.filter(
                Q(role__name__icontains=search) | Q(company__name__icontains=search)
            )
        return qs

    @action(detail=False, methods=["post"])
    def import_listings(self, request):
        """POST /api/job-listings/import_listings/ — the "bring your own AI"
        job-listing importer. Body: {"listings": [{...}, ...]}."""
        rows = request.data.get("listings")
        if not isinstance(rows, list) or not rows:
            return Response(
                {"detail": "Expected a non-empty 'listings' array."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return Response({"results": import_listings(rows)})


class ApplicationViewSet(viewsets.ModelViewSet):
    """FR-APP-10 — list/filter/sort; FR-APP-11 — updates append an event log."""

    serializer_class = ApplicationSerializer
    permission_classes = [IsAuthenticated]
    queryset = Application.objects.none()

    ORDERING_WHITELIST = {
        "applied_at", "-applied_at",
        "updated_at", "-updated_at",
        "created_at", "-created_at",
        "stage", "-stage",
        "outcome", "-outcome",
        "company__name", "-company__name",
        "follow_up_date", "-follow_up_date",
    }

    def get_queryset(self):
        qs = (
            Application.objects.filter(user=self.request.user)
            .select_related("company", "resume")
            .prefetch_related(
                Prefetch(
                    "listing_links",
                    queryset=ApplicationJobListing.objects.select_related(
                        "job_listing",
                        "job_listing__company",
                        "job_listing__role",
                        "job_listing__location",
                    ),
                ),
                "event_logs",
            )
        )
        params = self.request.query_params

        # Set by the dashboard's pipeline chart when you click the amber slice
        # of a bar, so the list you land on is the applications that slice
        # represented.
        if params.get("awaiting") in {"1", "true"}:
            qs = qs.filter(awaiting_response=True)

        for field in ("stage", "outcome"):
            values = [v for v in params.getlist(field) if v]
            if values:
                qs = qs.filter(**{f"{field}__in": values})

        company = params.get("company")
        if company:
            qs = qs.filter(company_id=company)

        region = params.get("region")
        if region:
            qs = qs.filter(company__regions=region)

        listing = params.get("listing")
        if listing:
            qs = qs.filter(listing_links__job_listing_id=listing).distinct()

        resume = params.get("resume")
        if resume:
            qs = qs.filter(resume_id=resume)

        if params.get("applied_from"):
            qs = qs.filter(applied_at__gte=params["applied_from"])
        if params.get("applied_to"):
            qs = qs.filter(applied_at__lte=params["applied_to"])

        search = params.get("search")
        if search:
            qs = qs.filter(
                Q(company__name__icontains=search)
                | Q(notes__icontains=search)
                | Q(source__icontains=search)
                | Q(listing_links__job_listing__role__name__icontains=search)
            ).distinct()

        ordering = params.get("ordering")
        if ordering in self.ORDERING_WHITELIST:
            qs = qs.order_by(ordering)
        return qs

    def get_serializer_class(self):
        if self.action == "list":
            return ApplicationListSerializer
        return ApplicationSerializer

    # --- supporting documents (cover letters, take-homes, offer PDFs) -------
    #
    # Scoped through `get_object()` in every action, so a document id belonging
    # to someone else's application can't be reached by guessing it.

    @action(
        detail=True,
        methods=["post"],
        parser_classes=[MultiPartParser, FormParser],
        url_path="documents",
    )
    def add_document(self, request, pk=None):
        application = self.get_object()
        serializer = ApplicationDocumentUploadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        upload = serializer.validated_data["file"]
        kind = classify_and_validate(upload)
        original_name = upload.name

        extension = os.path.splitext(upload.name)[1].lower()
        upload.name = f"application-{application.id}-{secrets.token_hex(4)}{extension}"

        # Falls back to the uploaded filename so a document is never nameless
        # in the gallery.
        title = serializer.validated_data.get("title", "").strip()
        if not title:
            title = os.path.splitext(original_name)[0]

        last = application.documents.aggregate(Max("position")).get("position__max")
        ApplicationDocument.objects.create(
            application=application,
            file=upload,
            title=title,
            description=serializer.validated_data.get("description", "").strip(),
            original_name=original_name,
            kind=kind,
            position=0 if last is None else last + 1,
        )

        application.refresh_from_db()
        return Response(
            self.get_serializer(application).data, status=status.HTTP_201_CREATED
        )

    @action(
        detail=True,
        methods=["patch", "delete"],
        url_path=r"documents/(?P<document_id>\d+)",
    )
    def edit_document(self, request, pk=None, document_id=None):
        application = self.get_object()
        document = application.documents.filter(pk=document_id).first()
        if document is None:
            return Response(
                {"detail": "No such document on this application."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if request.method == "DELETE":
            document.delete()  # post_delete removes the file too
        else:
            serializer = ApplicationDocumentEditSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            document.title = serializer.validated_data["title"].strip()
            document.description = serializer.validated_data.get(
                "description", ""
            ).strip()
            document.save(update_fields=["title", "description", "updated_at"])

        application.refresh_from_db()
        return Response(self.get_serializer(application).data)

    def update(self, request, *args, **kwargs):
        response = super().update(request, *args, **kwargs)
        # perform_update appends to event_logs, so re-serialize from fresh
        # relations or the response echoes the history as it was before.
        instance = self.get_queryset().get(pk=kwargs["pk"])
        return Response(self.get_serializer(instance).data, status=response.status_code)

    def perform_create(self, serializer):
        listings = serializer.validated_data.pop("listing_ids", [])
        serializer.validated_data.pop("event_note", None)
        application = serializer.save(user=self.request.user)
        for listing in listings:
            ApplicationJobListing.objects.get_or_create(
                application=application, job_listing=listing
            )
        log_creation(application)

    def perform_update(self, serializer):
        instance = serializer.instance
        prev_stage, prev_outcome = instance.stage, instance.outcome
        # Snapshot before saving: afterwards the instance holds the new values
        # and the diff would come out empty.
        before = snapshot(instance)

        listings = serializer.validated_data.pop("listing_ids", None)
        note = serializer.validated_data.pop("event_note", "")

        application = serializer.save()

        if listings is not None:
            keep = {listing.id for listing in listings}
            application.listing_links.exclude(job_listing_id__in=keep).delete()
            for listing in listings:
                ApplicationJobListing.objects.get_or_create(
                    application=application, job_listing=listing
                )
            # listing_links was prefetched, so the snapshot below would read the
            # pre-edit roles from cache.
            application._prefetched_objects_cache = {}

        log_change(
            application,
            prev_stage,
            prev_outcome,
            changes=diff(before, snapshot(application)),
            note=note,
        )
        settle_waiting(application, prev_stage, prev_outcome)

    @action(detail=True, methods=["get", "post"], url_path="listings")
    def listings(self, request, pk=None):
        """GET/POST the listings covered by this application (FR-APP-02)."""
        application = self.get_object()
        if request.method == "GET":
            serializer = ApplicationJobListingSerializer(
                application.listing_links.all(),
                many=True,
                context=self.get_serializer_context(),
            )
            return Response(serializer.data)

        serializer = ApplicationJobListingSerializer(
            data=request.data,
            context={**self.get_serializer_context(), "application": application},
        )
        serializer.is_valid(raise_exception=True)
        serializer.save(application=application)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["get"], url_path="events")
    def events(self, request, pk=None):
        """FR-LOG-05 — the transition history for one application."""
        application = self.get_object()
        serializer = AppsEventLogSerializer(
            application.event_logs.all().order_by("-changed_at"), many=True
        )
        return Response(serializer.data)

    @action(detail=True, methods=["post"], url_path="advance")
    def advance(self, request, pk=None):
        """Move stage/outcome in one call and record why (FR-APP-11)."""
        application = self.get_object()
        prev_stage, prev_outcome = application.stage, application.outcome

        stage = request.data.get("stage")
        outcome = request.data.get("outcome")
        errors = {}
        if stage is not None and stage not in stage_keys():
            errors["stage"] = [f"'{stage}' is not a valid stage."]
        if outcome is not None and outcome not in Outcome.values:
            errors["outcome"] = [f"'{outcome}' is not a valid outcome."]
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        if stage is not None:
            application.stage = stage
        if outcome is not None:
            application.outcome = outcome
        application.save(update_fields=["stage", "outcome", "updated_at"])

        log_transition(
            application, prev_stage, prev_outcome, note=request.data.get("note", "")
        )
        settle_waiting(application, prev_stage, prev_outcome)

        # get_queryset() prefetched event_logs, so the instance still holds the
        # pre-transition cache — serializing it would drop the row we just
        # wrote. (DRF's UpdateModelMixin does this for you; custom actions
        # have to do it themselves.)
        application._prefetched_objects_cache = {}
        serializer = self.get_serializer(application)
        return Response(serializer.data)

    # The stages that *are* the act of applying — if one of these is the
    # earliest thing logged, its date is the applied date rather than a week
    # after it.
    FIRST_STAGES = {Stage.NOT_SUBMITTED, Stage.APPLIED}

    @action(detail=True, methods=["post"], url_path="waiting")
    def waiting(self, request, pk=None):
        """POST/DELETE the "they owe me a reply" flag.

        Body: {"waiting": true|false}. Neither the stage nor the outcome moves
        — finishing a video interview leaves you *at* the video interview, and
        still in progress; all that changed is whose court the ball is in.
        """
        application = self.get_object()
        waiting = request.data.get("waiting", True)
        if not isinstance(waiting, bool):
            return Response(
                {"waiting": ["Send true or false."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # You rarely tick "done" the moment you finish — an interview on Friday
        # gets logged on Monday — so the caller may say when it actually was.
        # Absent that, now.
        changed_at_raw = request.data.get("changed_at")
        changed_at = parse_datetime(changed_at_raw) if changed_at_raw else None
        if changed_at_raw and changed_at is None:
            return Response(
                {"changed_at": ["Give a valid date and time."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if changed_at is not None and timezone.is_naive(changed_at):
            changed_at = timezone.make_aware(changed_at)

        if waiting and not application.awaiting_response:
            application.awaiting_response = True
            application.awaiting_since = changed_at or timezone.now()
            application.save(
                update_fields=["awaiting_response", "awaiting_since", "updated_at"]
            )
            log_waiting(
                application,
                started=True,
                note=request.data.get("note", ""),
                changed_at=changed_at,
            )
        elif not waiting:
            end_waiting(
                application, note=request.data.get("note", ""), changed_at=changed_at
            )

        application._prefetched_objects_cache = {}
        return Response(self.get_serializer(application).data)

    @action(
        detail=True,
        methods=["patch", "delete"],
        url_path=r"events/(?P<event_id>\d+)",
    )
    def edit_event(self, request, pk=None, event_id=None):
        """Correct or remove one history row.

        The log is append-only in the sense that nothing writes to it behind
        your back — but a stage you dated wrong, or logged twice by accident,
        is noise rather than history worth preserving. Only the fields a person
        can actually get wrong are editable: the date and the note.

        Deleting the `created` row is refused — every application has exactly
        one, and the timeline needs a beginning.
        """
        application = self.get_object()
        event = application.event_logs.filter(pk=event_id).first()
        if event is None:
            return Response(
                {"detail": "No such event on this application."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if request.method == "DELETE":
            if event.event_type == EventType.CREATED:
                return Response(
                    {"detail": "The creation row can't be deleted."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            event.delete()
            resync_waiting(application)
            application._prefetched_objects_cache = {}
            return Response(self.get_serializer(application).data)

        changed_at_raw = request.data.get("changed_at")
        if changed_at_raw:
            changed_at = parse_datetime(changed_at_raw)
            if changed_at is None:
                parsed_date = parse_date(changed_at_raw)
                if parsed_date:
                    changed_at = datetime.combine(
                        parsed_date, timezone.localtime(event.changed_at).time()
                    )
            if changed_at is None:
                return Response(
                    {"changed_at": ["Give a valid date."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if timezone.is_naive(changed_at):
                changed_at = timezone.make_aware(changed_at)
            # Two rows on one application may not share a timestamp (the model
            # enforces it), so nudge clear rather than failing the edit.
            while (
                AppsEventLog.objects.filter(
                    application=application, changed_at=changed_at
                )
                .exclude(pk=event.pk)
                .exists()
            ):
                changed_at += timedelta(microseconds=1)
            event.changed_at = changed_at

        if "note" in request.data:
            event.note = (request.data.get("note") or "").strip()

        event.save(update_fields=["changed_at", "note"])
        resync_waiting(application)
        application._prefetched_objects_cache = {}
        return Response(self.get_serializer(application).data)

    @action(detail=True, methods=["post"], url_path="backfill")
    def backfill(self, request, pk=None):
        """POST /api/applications/{id}/backfill/ — historical logging for an
        application that was fully (or partly) resolved before it was ever
        entered into the tracker, where the ordinary `advance` action would
        stamp every move with today instead of when it actually happened.

        Body: {"moves": [{"stage", "outcome"?, "changed_at", "note"?}, ...]},
        oldest first. Each move becomes its own dated event-log row, exactly
        like a real-time `advance` would — including a repeat visit to a
        stage the application already passed through (e.g. a second online
        assessment round), since two rows a stage apart in the sequence but
        identical in value are still a real transition away and back.
        """
        application = self.get_object()
        moves = request.data.get("moves")
        if not isinstance(moves, list) or not moves:
            return Response(
                {"moves": ["Provide a non-empty list of moves, oldest first."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        parsed = []
        # Deliberately *not* seeded with applied_at. Logging an application you
        # ran months ago means every move predates the applied date the tracker
        # stamped when you typed it in today, and rejecting the lot was the
        # whole reason historical logging felt broken. The moves are the truth
        # here; `applied_at` is pulled back to fit them below.
        last_date = None
        for index, move in enumerate(moves):
            stage = move.get("stage")
            outcome = move.get("outcome")
            changed_at_raw = move.get("changed_at")
            if stage not in stage_keys():
                return Response(
                    {"moves": [f"Move {index + 1}: '{stage}' is not a valid stage."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if outcome is not None and outcome not in Outcome.values:
                return Response(
                    {"moves": [f"Move {index + 1}: '{outcome}' is not a valid outcome."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            changed_at = parse_datetime(changed_at_raw) if changed_at_raw else None
            if changed_at is None and changed_at_raw:
                parsed_date = parse_date(changed_at_raw)
                if parsed_date:
                    changed_at = datetime.combine(parsed_date, time(9, 0))
            if changed_at is None:
                return Response(
                    {"moves": [f"Move {index + 1}: give a valid date for changed_at."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if timezone.is_naive(changed_at):
                changed_at = timezone.make_aware(changed_at)
            if last_date is not None and changed_at < last_date:
                return Response(
                    {"moves": [f"Move {index + 1} is dated before the move before it."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            last_date = changed_at
            parsed.append(
                {"stage": stage, "outcome": outcome, "changed_at": changed_at, "note": move.get("note", "")}
            )

        # Anything logged this way is history, not live tracking — and the
        # applied date has to sit at or before the earliest thing that
        # happened, or the timeline reads as effects preceding their cause.
        earliest = parsed[0]
        earliest_date = timezone.localtime(earliest["changed_at"]).date()
        if earliest["stage"] in self.FIRST_STAGES:
            # The earliest thing you logged *is* the application, so that's the
            # date exactly — no invented week.
            applied_at = earliest_date
        else:
            # You've logged an assessment or an interview as the first event,
            # so the application itself predates it. A week is a guess, but a
            # defensible one, and it beats claiming you applied and sat the
            # assessment on the same morning.
            applied_at = earliest_date - timedelta(days=7)

        if applied_at < application.applied_at or not application.is_historical:
            application.applied_at = min(applied_at, application.applied_at)
            application.is_historical = True
            application.save(
                update_fields=["applied_at", "is_historical", "updated_at"]
            )

        # The "created" row is stamped when you type the application in, which
        # for a historical one is months after everything it's about — leaving
        # the timeline claiming the application was created after it finished.
        # Pull it back to the applied date so cause precedes effect.
        created_row = application.event_logs.filter(
            event_type=EventType.CREATED
        ).order_by("changed_at").first()
        if created_row is not None:
            start = timezone.make_aware(
                datetime.combine(application.applied_at, time(9, 0))
            )
            if start >= earliest["changed_at"]:
                start = earliest["changed_at"] - timedelta(hours=1)
            if created_row.changed_at != start:
                created_row.changed_at = start
                created_row.save(update_fields=["changed_at"])

        for move in parsed:
            prev_stage, prev_outcome = application.stage, application.outcome
            application.stage = move["stage"]
            if move["outcome"] is not None:
                application.outcome = move["outcome"]
            application.save(update_fields=["stage", "outcome", "updated_at"])
            log_transition(
                application,
                prev_stage,
                prev_outcome,
                note=move["note"],
                changed_at=move["changed_at"],
            )

        application._prefetched_objects_cache = {}
        serializer = self.get_serializer(application)
        return Response(serializer.data)

    @action(detail=False, methods=["get"])
    def choices(self, request):
        """Enum options, so the SPA never hard-codes a duplicate of the model."""
        def pack(enum):
            return [{"value": v, "label": l} for v, l in enum.choices]

        return Response(
            {
                # From the table, not the enum — stages are addable, and the
                # pickers have to offer whatever's been added.
                "stage": [
                    {"value": row.key, "label": row.name}
                    for row in ApplicationStage.objects.all()
                ],
                "outcome": pack(Outcome),
                "role_type": pack(RoleType),
                "work_arrangement": pack(WorkArrangement),
            }
        )


class ApplicationJobListingViewSet(viewsets.ModelViewSet):
    """Flat access to the junction rows, scoped to the caller's applications."""

    serializer_class = ApplicationJobListingSerializer
    permission_classes = [IsAuthenticated]
    queryset = ApplicationJobListing.objects.none()

    def get_queryset(self):
        qs = ApplicationJobListing.objects.filter(
            application__user=self.request.user
        ).select_related(
            "application",
            "job_listing",
            "job_listing__company",
            "job_listing__role",
            "job_listing__location",
        )
        application = self.request.query_params.get("application")
        if application:
            qs = qs.filter(application_id=application)
        return qs


class AppsEventLogViewSet(viewsets.ReadOnlyModelViewSet):
    """FR-LOG-01 — read-only by design; rows only come from the service layer."""

    serializer_class = AppsEventLogSerializer
    permission_classes = [IsAuthenticated]
    queryset = AppsEventLog.objects.none()

    def get_queryset(self):
        qs = AppsEventLog.objects.filter(
            application__user=self.request.user
        ).select_related("application", "application__company").order_by("-changed_at")
        application = self.request.query_params.get("application")
        if application:
            qs = qs.filter(application_id=application)
        return qs

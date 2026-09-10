"""REST API for the network domain (FR-NET-*)."""

from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from applications.views import NamedCatalogViewSet
from config.images import square_thumbnail

from .models import ContactMethod, MetSourceTag, Person, RelationshipTag
from .serializers import (
    ContactMethodSerializer,
    MetSourceTagSerializer,
    PersonListSerializer,
    PersonPhotoSerializer,
    PersonSerializer,
    RelationshipTagSerializer,
    choice_payload,
)


class RelationshipTagViewSet(NamedCatalogViewSet):
    """Addable, like Industry/Role — search + get-or-create `ensure/`."""

    queryset = RelationshipTag.objects.all()
    serializer_class = RelationshipTagSerializer


class MetSourceTagViewSet(NamedCatalogViewSet):
    queryset = MetSourceTag.objects.all()
    serializer_class = MetSourceTagSerializer


class PersonViewSet(viewsets.ModelViewSet):
    serializer_class = PersonSerializer
    permission_classes = [IsAuthenticated]
    queryset = Person.objects.none()

    ORDERING_WHITELIST = {
        "full_name", "-full_name",
        "next_chat_at", "-next_chat_at",
        "last_meeting_at", "-last_meeting_at",
        "updated_at", "-updated_at",
    }

    def get_queryset(self):
        qs = (
            Person.objects.filter(user=self.request.user)
            .prefetch_related(
                "company_links__company",
                "applications__company",
                "contact_methods",
                "connections__relationship",
                "connections__company_links__company",
            )
        )
        params = self.request.query_params

        for field in ("status", "relationship", "source"):
            values = [v for v in params.getlist(field) if v]
            if values:
                qs = qs.filter(**{f"{field}__in": values})

        company = params.get("company")
        if company:
            qs = qs.filter(companies__id=company)

        application = params.get("application")
        if application:
            qs = qs.filter(applications__id=application)

        # FR-NET-13 — "who do I owe a catch-up?"
        due = params.get("due")
        today = timezone.localdate()
        if due == "overdue":
            qs = qs.filter(next_chat_at__lt=today)
        elif due == "due":
            qs = qs.filter(next_chat_at__lte=today)
        elif due == "upcoming":
            qs = qs.filter(next_chat_at__gte=today)

        search = params.get("search")
        if search:
            qs = qs.filter(
                Q(full_name__icontains=search)
                | Q(title__icontains=search)
                | Q(notes__icontains=search)
                | Q(companies__name__icontains=search)
                | Q(companies__short_name__icontains=search)
                # "Met via" and relationship — addable catalogs (FR-NET-20),
                # so this is now a real free-text field a name could actually
                # match, not a fixed enum label.
                | Q(source__name__icontains=search)
                | Q(relationship__name__icontains=search)
                # Any contact detail — an email fragment or a LinkedIn handle
                # is often exactly what someone remembers about a person and
                # not much else.
                | Q(contact_methods__value__icontains=search)
            )

        ordering = params.get("ordering")
        if ordering in self.ORDERING_WHITELIST:
            qs = qs.order_by(ordering)
        return qs.distinct()

    def get_serializer_class(self):
        if self.action == "list":
            return PersonListSerializer
        return PersonSerializer

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=False, methods=["get"])
    def choices(self, request):
        return Response(choice_payload())

    @action(
        detail=True,
        methods=["post", "delete"],
        parser_classes=[MultiPartParser, FormParser],
    )
    def photo(self, request, pk=None):
        """POST/DELETE /api/people/{id}/photo/ — set or clear their picture."""
        person = self.get_object()

        if request.method == "DELETE":
            person.photo.delete(save=True)
            return Response(self.get_serializer(person).data)

        serializer = PersonPhotoSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        person.photo.delete(save=False)  # don't orphan the previous file
        person.photo = square_thumbnail(
            serializer.validated_data["photo"], name=f"person-{person.id}"
        )
        person.save()
        return Response(self.get_serializer(person).data)

    @action(detail=True, methods=["post"], url_path="log-meeting")
    def log_meeting(self, request, pk=None):
        """Record a catch-up: stamp the date and roll the next one forward."""
        person = self.get_object()

        raw_met = request.data.get("met_on")
        met_on = parse_date(raw_met) if raw_met else timezone.localdate()
        if met_on is None:
            return Response(
                {"met_on": ["Expected a date in YYYY-MM-DD format."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        raw_next = request.data.get("next_chat_at")
        next_chat = parse_date(raw_next) if raw_next else None
        if raw_next and next_chat is None:
            return Response(
                {"next_chat_at": ["Expected a date in YYYY-MM-DD format."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        person.last_meeting_at = met_on
        # Cleared unless the caller names one, so the 3-month cadence
        # recomputes from the meeting that just happened.
        person.next_chat_at = next_chat
        person.apply_cadence_default()
        person.save()
        return Response(self.get_serializer(person).data)


class ContactMethodViewSet(viewsets.ModelViewSet):
    serializer_class = ContactMethodSerializer
    permission_classes = [IsAuthenticated]
    queryset = ContactMethod.objects.none()

    def get_queryset(self):
        qs = ContactMethod.objects.filter(
            person__user=self.request.user
        ).select_related("person")
        person = self.request.query_params.get("person")
        if person:
            qs = qs.filter(person_id=person)
        return qs

    def perform_create(self, serializer):
        person = serializer.validated_data.get("person")
        if person is None or person.user_id != self.request.user.id:
            from rest_framework import serializers as drf_serializers

            raise drf_serializers.ValidationError(
                {"person": "That person is not in your network."}
            )
        serializer.save()

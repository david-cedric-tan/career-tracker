"""REST API for catch-up minutes (FR-CATCH-*)."""

from django.db.models import Q
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from network.models import Person

from .models import Catchup, CatchupFormat
from .serializers import CatchupSerializer, choice_payload


class CatchupViewSet(viewsets.ModelViewSet):
    serializer_class = CatchupSerializer
    permission_classes = [IsAuthenticated]
    queryset = Catchup.objects.none()

    ORDERING_WHITELIST = {
        "met_on", "-met_on",
        "created_at", "-created_at",
        "person__full_name", "-person__full_name",
    }

    def get_queryset(self):
        qs = Catchup.objects.filter(user=self.request.user).select_related(
            "person"
        ).prefetch_related("person__companies")
        params = self.request.query_params

        person = params.get("person")
        if person:
            qs = qs.filter(person_id=person)

        formats = [v for v in params.getlist("format") if v]
        if formats:
            qs = qs.filter(format__in=formats)

        if params.get("from"):
            qs = qs.filter(met_on__gte=params["from"])
        if params.get("to"):
            qs = qs.filter(met_on__lte=params["to"])

        search = params.get("search")
        if search:
            qs = qs.filter(
                Q(title__icontains=search)
                | Q(minutes__icontains=search)
                | Q(takeaways__icontains=search)
                | Q(location__icontains=search)
                | Q(person__full_name__icontains=search)
            )

        ordering = params.get("ordering")
        if ordering in self.ORDERING_WHITELIST:
            qs = qs.order_by(ordering)
        return qs

    def perform_create(self, serializer):
        catchup = serializer.save(user=self.request.user)
        self._sync_person(catchup)

    def perform_update(self, serializer):
        catchup = serializer.save()
        self._sync_person(catchup)

    def perform_destroy(self, instance):
        person = instance.person
        instance.delete()
        # The person's "last met" was derived from this row, so recompute it
        # from whatever catch-ups remain rather than leaving a stale date.
        self._recompute_last_meeting(person)

    @staticmethod
    def _sync_person(catchup):
        """FR-CATCH-04 — minuting a meeting is also logging that it happened.

        Only moves the person forward: an older catch-up added retrospectively
        must not rewind `last_meeting_at`.
        """
        person = catchup.person
        # A message moves "last messaged" only — it isn't a meeting and
        # shouldn't roll the next chat forward.
        if catchup.format == CatchupFormat.MESSAGE:
            if person.last_messaged_at and person.last_messaged_at > catchup.met_on:
                return
            person.last_messaged_at = catchup.met_on
            person.last_message_channel = catchup.message_channel
            person.save(update_fields=["last_messaged_at", "last_message_channel", "updated_at"])
            return

        if person.last_meeting_at and person.last_meeting_at >= catchup.met_on:
            return

        person.last_meeting_at = catchup.met_on
        # Clear so the 3-month cadence recomputes from this meeting, unless the
        # catch-up named its own follow-up date.
        person.next_chat_at = catchup.follow_up_on
        person.apply_cadence_default()
        person.save()

    @staticmethod
    def _recompute_last_meeting(person: Person):
        meetings = person.catchups.exclude(format=CatchupFormat.MESSAGE)
        latest = meetings.order_by("-met_on").first()
        person.last_meeting_at = latest.met_on if latest else None
        latest_message = (
            person.catchups.filter(format=CatchupFormat.MESSAGE).order_by("-met_on").first()
        )
        person.last_messaged_at = latest_message.met_on if latest_message else None
        person.last_message_channel = latest_message.message_channel if latest_message else ""
        person.save(
            update_fields=[
                "last_meeting_at", "last_messaged_at", "last_message_channel", "updated_at",
            ]
        )

    @action(detail=False, methods=["get"])
    def choices(self, request):
        return Response(choice_payload())

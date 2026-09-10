"""REST API for user-created calendar events (FR-CAL-07)."""

from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from .models import CalendarEvent
from .serializers import CalendarEventSerializer


class CalendarEventViewSet(viewsets.ModelViewSet):
    serializer_class = CalendarEventSerializer
    permission_classes = [IsAuthenticated]
    queryset = CalendarEvent.objects.none()

    def get_queryset(self):
        qs = (
            CalendarEvent.objects.filter(user=self.request.user)
            .select_related("company", "application__company")
            .prefetch_related("reminders", "people")
        )
        params = self.request.query_params
        if params.get("start"):
            qs = qs.filter(date__gte=params["start"])
        if params.get("end"):
            qs = qs.filter(date__lte=params["end"])
        for field in ("company", "application", "people"):
            value = params.get(field)
            if value:
                qs = qs.filter(**{f"{field}__id": value})
        # The network's event view only cares about events that actually put
        # you in a room with someone.
        if params.get("with_people") in {"1", "true", "yes"}:
            qs = qs.filter(people__isnull=False)
        return qs.distinct()

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

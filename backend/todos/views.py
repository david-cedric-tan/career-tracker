"""REST API for todos (FR-TODO-*)."""

from django.db.models import F, Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from applications.models import Application, Outcome
from network.models import Person

from .models import Todo, TodoStatus
from .serializers import TodoSerializer, choice_payload


class TodoViewSet(viewsets.ModelViewSet):
    serializer_class = TodoSerializer
    permission_classes = [IsAuthenticated]
    queryset = Todo.objects.none()

    ORDERING_WHITELIST = {
        "due_date", "-due_date",
        "created_at", "-created_at",
        "priority", "-priority",
        "title", "-title",
        "position", "-position",
    }

    def get_queryset(self):
        qs = Todo.objects.filter(user=self.request.user).select_related(
            "application", "application__company", "person", "company"
        )
        params = self.request.query_params

        for field in ("status", "priority"):
            values = [v for v in params.getlist(field) if v]
            if values:
                qs = qs.filter(**{f"{field}__in": values})

        for field in ("application", "person", "company"):
            value = params.get(field)
            if value:
                qs = qs.filter(**{f"{field}_id": value})

        scope = params.get("scope")
        today = timezone.localdate()
        if scope == "overdue":
            qs = qs.filter(status=TodoStatus.OPEN, due_date__lt=today)
        elif scope == "today":
            qs = qs.filter(status=TodoStatus.OPEN, due_date=today)
        elif scope == "upcoming":
            qs = qs.filter(status=TodoStatus.OPEN, due_date__gte=today)
        elif scope == "standalone":
            qs = qs.filter(application__isnull=True, person__isnull=True, company__isnull=True)

        if params.get("due_before"):
            qs = qs.filter(due_date__lte=params["due_before"])
        if params.get("due_after"):
            qs = qs.filter(due_date__gte=params["due_after"])

        search = params.get("search")
        if search:
            qs = qs.filter(
                Q(title__icontains=search) | Q(description__icontains=search)
            )

        ordering = params.get("ordering")
        if ordering in self.ORDERING_WHITELIST:
            # `position` alone leaves ties in whatever order the database
            # feels like, which makes a hand-arranged list look unstable.
            if ordering.endswith("position"):
                qs = qs.order_by(ordering, "id")
            else:
                qs = qs.order_by(ordering)
        return qs

    def perform_create(self, serializer):
        # New todos go to the top of the manual order — a task you just wrote
        # down is the one you're thinking about. Everything else shifts down
        # rather than the new row taking a lower number, since `position` is
        # a positive field with no room below zero.
        Todo.objects.filter(user=self.request.user).update(position=F("position") + 1)
        serializer.save(user=self.request.user, position=0)

    @action(detail=False, methods=["post"])
    def reorder(self, request):
        """POST {"ids": [...]} — the todos in the order they should sit.

        Only the ids sent are renumbered, and only the caller's own todos, so
        a drag inside a filtered list can't disturb what isn't on screen.
        """
        ids = request.data.get("ids")
        if not isinstance(ids, list) or not all(isinstance(i, int) for i in ids):
            return Response(
                {"ids": ["Send the todo ids as a list, in their new order."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        mine = set(
            Todo.objects.filter(user=request.user, id__in=ids).values_list("id", flat=True)
        )
        unknown = [i for i in ids if i not in mine]
        if unknown:
            return Response(
                {"ids": [f"{len(unknown)} of those aren't your todos."]},
                status=status.HTTP_400_BAD_REQUEST,
            )

        for index, todo_id in enumerate(ids):
            Todo.objects.filter(user=request.user, id=todo_id).update(position=index)
        return Response({"ids": ids})

    @action(detail=False, methods=["get"])
    def choices(self, request):
        return Response(choice_payload())

    @action(detail=True, methods=["post"])
    def toggle(self, request, pk=None):
        """Flip open ⇄ done, stamping completion (FR-TODO-03)."""
        todo = self.get_object()
        todo.status = (
            TodoStatus.OPEN if todo.status == TodoStatus.DONE else TodoStatus.DONE
        )
        todo.sync_completion()
        todo.save()
        return Response(self.get_serializer(todo).data)

    @action(detail=False, methods=["get"])
    def suggestions(self, request):
        """FR-TODO-04 — follow-ups implied by dates elsewhere in the app.

        Read-only hints; the UI turns one into a real todo with a normal POST.
        """
        today = timezone.localdate()
        linked_apps = set(
            Todo.objects.filter(
                user=request.user, status=TodoStatus.OPEN, application__isnull=False
            ).values_list("application_id", flat=True)
        )
        linked_people = set(
            Todo.objects.filter(
                user=request.user, status=TodoStatus.OPEN, person__isnull=False
            ).values_list("person_id", flat=True)
        )

        suggestions = []
        due_apps = (
            Application.objects.filter(
                user=request.user,
                follow_up_date__isnull=False,
                follow_up_date__lte=today,
                outcome=Outcome.IN_PROGRESS,
            )
            .exclude(id__in=linked_apps)
            .select_related("company")
        )
        for app in due_apps:
            suggestions.append(
                {
                    "kind": "application",
                    "title": f"Follow up on {app.company.display_name}",
                    "due_date": app.follow_up_date,
                    "application": app.id,
                    "person": None,
                    "reason": f"Follow-up date was {app.follow_up_date}.",
                }
            )

        due_people = Person.objects.filter(
            user=request.user, next_chat_at__isnull=False, next_chat_at__lte=today
        ).exclude(id__in=linked_people).exclude(status__in=["archived", "ghosted"])
        for person in due_people:
            suggestions.append(
                {
                    "kind": "person",
                    "title": f"Catch up with {person.full_name}",
                    "due_date": person.next_chat_at,
                    "application": None,
                    "person": person.id,
                    "reason": f"Next chat was due {person.next_chat_at}.",
                }
            )

        suggestions.sort(key=lambda s: s["due_date"])
        return Response(suggestions)

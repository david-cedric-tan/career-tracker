from rest_framework import serializers

from .models import Priority, Todo, TodoStatus


class TodoSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    priority_display = serializers.CharField(
        source="get_priority_display", read_only=True
    )
    is_overdue = serializers.BooleanField(read_only=True)
    application_label = serializers.CharField(
        source="application.company.name", read_only=True, default=None
    )
    person_name = serializers.CharField(
        source="person.full_name", read_only=True, default=None
    )
    company_name = serializers.CharField(
        source="company.name", read_only=True, default=None
    )

    class Meta:
        model = Todo
        fields = [
            "id",
            "title",
            "description",
            "due_date",
            "priority", "priority_display",
            "status", "status_display",
            "application", "application_label",
            "person", "person_name",
            "company", "company_name",
            "is_overdue",
            "completed_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id", "status_display", "priority_display", "is_overdue",
            "application_label", "person_name", "company_name",
            "completed_at", "created_at", "updated_at",
        ]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        if request is not None and request.user.is_authenticated:
            # FR-AUTH-02 — a todo can only point at the caller's own records.
            from applications.models import Application
            from network.models import Person

            self.fields["application"].queryset = Application.objects.filter(
                user=request.user
            )
            self.fields["person"].queryset = Person.objects.filter(user=request.user)

    def validate_title(self, value):
        return value.strip()

    def validate(self, attrs):
        """FR-TODO-06 — don't silently create a second identical open todo for
        the same link target on the same day."""
        request = self.context.get("request")
        if request is None:
            return attrs

        title = attrs.get("title", getattr(self.instance, "title", ""))
        due = attrs.get("due_date", getattr(self.instance, "due_date", None))
        status = attrs.get("status", getattr(self.instance, "status", TodoStatus.OPEN))
        if status != TodoStatus.OPEN:
            return attrs

        clash = Todo.objects.filter(
            user=request.user,
            title__iexact=title,
            due_date=due,
            status=TodoStatus.OPEN,
            application=attrs.get("application", getattr(self.instance, "application", None)),
            person=attrs.get("person", getattr(self.instance, "person", None)),
            company=attrs.get("company", getattr(self.instance, "company", None)),
        )
        if self.instance is not None:
            clash = clash.exclude(pk=self.instance.pk)
        if clash.exists():
            raise serializers.ValidationError(
                {"title": "You already have an identical open todo for this."}
            )
        return attrs

    def create(self, validated_data):
        todo = Todo(**validated_data)
        todo.sync_completion()
        todo.save()
        return todo

    def update(self, instance, validated_data):
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.sync_completion()
        instance.save()
        return instance


def choice_payload():
    def pack(enum):
        return [{"value": v, "label": l} for v, l in enum.choices]

    return {"status": pack(TodoStatus), "priority": pack(Priority)}

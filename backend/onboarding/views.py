from django.db import IntegrityError
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import SampleCategory
from .services import cleanup_sample_data, sample_data_summary, seed_sample_data


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def seed(request):
    """POST /api/onboarding/sample-data/seed/ — idempotent; a second call
    (e.g. a tour replay) is a no-op once sample rows already exist.

    The idempotency check and the writes aren't atomic *across* requests
    (only within one), so two concurrent calls for the same brand-new
    account — React StrictMode's double effect-fire in dev, or a genuine
    double-click — can both pass the "nothing seeded yet" check before either
    commits. The loser hits a unique-constraint IntegrityError on the shared
    sample company; that's just the other request winning the race, not a
    real failure, so it's swallowed rather than surfaced as a 500.
    """
    try:
        seed_sample_data(request.user)
    except IntegrityError:
        pass
    return Response(sample_data_summary(request.user))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def summary(request):
    return Response(sample_data_summary(request.user))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def cleanup(request):
    """POST /api/onboarding/sample-data/cleanup/ {"keep": ["application", ...]}
    Deletes every tracked sample row not in `keep`, then clears tracking."""
    keep = request.data.get("keep", [])
    valid = {choice.value for choice in SampleCategory}
    keep_categories = [value for value in keep if value in valid]
    cleanup_sample_data(request.user, keep_categories)
    return Response(status=204)

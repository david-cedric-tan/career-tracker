"""Classify a profile-section upload as image or document (FR-PROF-13).

Education / Certification / ExtraCurricular attachments can reasonably be
either — a photo of a certificate, or the PDF of it — so this picks the right
validator by extension rather than forcing the caller to know in advance.
"""

import os

from rest_framework import serializers

from .documents import ALLOWED_DOCUMENTS, validate_document
from .images import validate_image

# config.images validates by decoding with Pillow, which doesn't care about
# the extension — but classification has to happen before that decode, so the
# extension list here is deliberately a superset of what Pillow would accept.
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def classify_and_validate(upload):
    """Returns 'image' or 'document', or raises a field error for neither."""
    extension = os.path.splitext(upload.name or "")[1].lower()

    if extension in IMAGE_EXTENSIONS:
        validate_image(upload)
        return "image"

    if extension in ALLOWED_DOCUMENTS:
        validate_document(upload)
        return "document"

    allowed = sorted({v for v in ALLOWED_DOCUMENTS.values()}) + ["image"]
    raise serializers.ValidationError(
        f"Unsupported file type. Use an image or one of: {', '.join(allowed)}."
    )

"""Validation for uploaded documents (resumes).

Separate from `config.images` because the checks are different in kind: an
image can be proved real by decoding it, whereas a .docx or .pages file is a
zip container and a .pdf is a byte stream. Here the extension allow-list plus a
magic-number sniff is the honest ceiling — so the files are stored and served
back, never executed or parsed.
"""

import os

from django.conf import settings
from rest_framework import serializers

# Extension → the label shown in the UI. Pages files are Apple's zip bundles;
# .doc is legacy Word; the rest are self-explanatory.
ALLOWED_DOCUMENTS = {
    ".pdf": "PDF",
    ".docx": "Word",
    ".doc": "Word",
    ".pages": "Pages",
    ".odt": "OpenDocument",
    ".rtf": "Rich text",
    ".txt": "Plain text",
    ".md": "Markdown",
    ".markdown": "Markdown",
    ".pptx": "PowerPoint",
    ".ppt": "PowerPoint",
}

# First bytes that prove the container type, where one exists. A .pages bundle
# and a .docx are both zips, so they share a signature — that is expected.
SIGNATURES = {
    ".pdf": [b"%PDF-"],
    ".docx": [b"PK\x03\x04"],
    ".pages": [b"PK\x03\x04"],
    ".odt": [b"PK\x03\x04"],
    ".pptx": [b"PK\x03\x04"],
    ".doc": [b"\xd0\xcf\x11\xe0", b"PK\x03\x04"],
    ".ppt": [b"\xd0\xcf\x11\xe0", b"PK\x03\x04"],
    ".rtf": [b"{\\rtf"],
}


def document_kind(filename):
    return ALLOWED_DOCUMENTS.get(os.path.splitext(filename or "")[1].lower())


def validate_document(upload):
    """Reject anything oversized or not a document we're prepared to store."""
    max_bytes = getattr(settings, "MAX_UPLOAD_DOCUMENT_BYTES", 10 * 1024 * 1024)
    if upload.size > max_bytes:
        raise serializers.ValidationError(
            f"File is too large ({upload.size // 1024}KB). "
            f"The limit is {max_bytes // 1024 // 1024}MB."
        )

    extension = os.path.splitext(upload.name or "")[1].lower()
    if extension not in ALLOWED_DOCUMENTS:
        raise serializers.ValidationError(
            "Unsupported file type. Use "
            + ", ".join(sorted({v for v in ALLOWED_DOCUMENTS.values()}))
            + "."
        )

    expected = SIGNATURES.get(extension)
    if expected:
        head = upload.read(8)
        upload.seek(0)
        if not any(head.startswith(signature) for signature in expected):
            raise serializers.ValidationError(
                f"That doesn’t look like a real {ALLOWED_DOCUMENTS[extension]} file."
            )

    return upload

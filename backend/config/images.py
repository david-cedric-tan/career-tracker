"""Shared handling for user-uploaded images (avatars, contact photos).

Django's ImageField already proves a file is a real image via Pillow. What it
does not do is bound the size or normalise the format, so every upload here is
re-encoded to a square, right-sized image before it is stored — a 12MP phone
photo becomes a ~40KB thumbnail instead of sitting in MEDIA_ROOT at full size.
"""

import secrets
from io import BytesIO

from django.conf import settings
from django.core.files.uploadedfile import InMemoryUploadedFile
from PIL import Image, ImageOps
from rest_framework import serializers

ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP", "GIF"}
AVATAR_SIZE = 512
LOGO_SIZE = 256
GALLERY_SIZE = 1024
# A full-bleed background needs more resolution than a gallery photo, but an
# 8000px phone photo would be pure waste once it's blurred anyway.
WALLPAPER_SIZE = 1920


def validate_image(upload):
    """Reject anything too large or not actually an image, as a field error."""
    max_bytes = getattr(settings, "MAX_UPLOAD_IMAGE_BYTES", 5 * 1024 * 1024)
    if upload.size > max_bytes:
        raise serializers.ValidationError(
            f"Image is too large ({upload.size // 1024}KB). "
            f"The limit is {max_bytes // 1024 // 1024}MB."
        )

    try:
        probe = Image.open(upload)
        probe.verify()
    except Exception:
        raise serializers.ValidationError("That file isn’t a readable image.")
    finally:
        upload.seek(0)

    if probe.format not in ALLOWED_FORMATS:
        raise serializers.ValidationError(
            f"Unsupported image format. Use {', '.join(sorted(ALLOWED_FORMATS))}."
        )
    return upload


def square_thumbnail(upload, size=AVATAR_SIZE, name="image"):
    """Centre-crop to a square and downscale — avatars are always shown round.

    The stored filename gets a random suffix. Without it a replacement lands on
    the same path, so every browser that already cached the old picture keeps
    showing it.
    """
    image = Image.open(upload)
    # Honour EXIF rotation, or phone photos come out sideways.
    image = ImageOps.exif_transpose(image)

    has_alpha = image.mode in {"RGBA", "LA"} or (
        image.mode == "P" and "transparency" in image.info
    )
    image = image.convert("RGBA" if has_alpha else "RGB")
    # Bias the crop slightly above centre — faces sit high in a portrait.
    image = ImageOps.fit(
        image, (size, size), Image.Resampling.LANCZOS, centering=(0.5, 0.4)
    )

    buffer = BytesIO()
    if has_alpha:
        image.save(buffer, format="PNG", optimize=True)
        extension, content_type = "png", "image/png"
    else:
        image.save(buffer, format="JPEG", quality=86, optimize=True)
        extension, content_type = "jpg", "image/jpeg"
    buffer.seek(0)

    return InMemoryUploadedFile(
        buffer,
        field_name=None,
        name=f"{name}-{secrets.token_hex(4)}.{extension}",
        content_type=content_type,
        size=buffer.getbuffer().nbytes,
        charset=None,
    )


def contain_thumbnail(upload, size=LOGO_SIZE, name="image"):
    """Fit inside a box without cropping.

    Used where the whole frame matters: company wordmarks (cropping one to a
    square would cut the brand in half) and gallery photos. Transparency is
    preserved as PNG; everything else is JPEG, so a 4MB photo doesn't become a
    12MB lossless file.
    """
    image = Image.open(upload)
    image = ImageOps.exif_transpose(image)

    has_alpha = image.mode in {"RGBA", "LA"} or (
        image.mode == "P" and "transparency" in image.info
    )
    image = image.convert("RGBA" if has_alpha else "RGB")
    image.thumbnail((size, size), Image.Resampling.LANCZOS)

    buffer = BytesIO()
    if has_alpha:
        image.save(buffer, format="PNG", optimize=True)
        extension, content_type = "png", "image/png"
    else:
        image.save(buffer, format="JPEG", quality=86, optimize=True)
        extension, content_type = "jpg", "image/jpeg"
    buffer.seek(0)

    return InMemoryUploadedFile(
        buffer,
        field_name=None,
        name=f"{name}-{secrets.token_hex(4)}.{extension}",
        content_type=content_type,
        size=buffer.getbuffer().nbytes,
        charset=None,
    )

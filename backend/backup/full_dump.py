"""Whole-database export for moving this app to another machine (admin only).

Unlike archive.py's per-user backup — one account's data, reshaped into a
portable, human-inspectable format — this is a raw snapshot of every table in
every app, plus the entire media/ tree, so a fresh install can become an exact
copy of this one. There is no reshaping: it's Django's own serializer format,
restored with `loaddata`.

Content types and permissions are left out and use natural keys for any FK
pointing at them (`use_natural_foreign_keys`) — a fresh install's `migrate`
already recreates those rows for the apps installed here, and their ids are
assigned in migration order, which won't line up with the source database's
ids. Natural keys route `ProfileAttachment.content_type` (and similar) to
whatever local row actually matches, instead of a raw id that might now point
at the wrong table. Sessions are left out too: they're per-browser login
state, not app data, and meaningless on another machine.
"""

from console.migration import (  # noqa: F401 — re-exported for the restore command
    DUMP_FILENAME,
    EXCLUDED_MODELS,
    MANIFEST_FILENAME,
)


def build_full_backup() -> bytes:
    """Every row in every table (bar the excluded few above), plus every
    uploaded file, as one zip: `dump.json` + a `media/` tree.

    The admin console's selective export (`console.migration`) is the same
    snapshot with switches; this is that export with every switch on, so the
    two can never disagree about what "everything" means.
    """
    from console.migration import build_migration

    return build_migration()

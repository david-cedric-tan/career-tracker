"""Restore a whole-database backup made via the admin "download everything"
export — the second half of moving this app to another machine.

    python manage.py restore_full_backup career-tracker-full-backup-2026-09-14.zip

Deliberately a CLI command, not a web endpoint: this deletes every row in
every table first, and that is too destructive to gate behind a single
permission check on an app that's also reachable from other devices on the
LAN. Run it directly on the machine that owns the destination database —
after `migrate` has already built a fresh schema there.
"""

import shutil
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory

from django.conf import settings
from django.core import management
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction


class Command(BaseCommand):
    help = (
        "Replace this database and media/ with a full backup made via the "
        "admin 'Download everything' export. Deletes everything currently "
        "in this database first."
    )

    def add_arguments(self, parser):
        parser.add_argument("zip_path", help="Path to the exported .zip file")
        parser.add_argument(
            "--yes",
            action="store_true",
            help="Skip the confirmation prompt (for scripted migrations).",
        )

    def handle(self, *args, **options):
        zip_path = Path(options["zip_path"]).expanduser()
        if not zip_path.exists():
            raise CommandError(f"No such file: {zip_path}")

        if not options["yes"]:
            confirm = input(
                "This deletes every row in every table of this database and "
                "replaces media/ with the backup's copy. Continue? [y/N] "
            )
            if confirm.strip().lower() != "y":
                self.stdout.write("Aborted.")
                return

        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            try:
                with zipfile.ZipFile(zip_path) as archive:
                    archive.extractall(tmp_path)
            except zipfile.BadZipFile as exc:
                raise CommandError(f"Not a valid zip file: {exc}")

            dump_file = tmp_path / "dump.json"
            if not dump_file.exists():
                raise CommandError(
                    "This zip has no dump.json — it isn't a full-backup export."
                )

            # Older exports rounded timestamps to milliseconds; see repair_dump.
            from console.migration import repair_dump

            fixed, repaired = repair_dump(dump_file.read_bytes())
            if repaired:
                dump_file.write_bytes(fixed)
                self.stdout.write(f"Moved {repaired} clashing timestamp(s) apart.")

            with transaction.atomic():
                self.stdout.write("Wiping existing data...")
                management.call_command("flush", "--noinput")
                self.stdout.write("Loading backup...")
                management.call_command("loaddata", str(dump_file))

            media_src = tmp_path / "media"
            if media_src.exists():
                self.stdout.write("Replacing media/...")
                media_root = Path(settings.MEDIA_ROOT)
                if media_root.exists():
                    shutil.rmtree(media_root)
                shutil.copytree(media_src, media_root)

        self.stdout.write(self.style.SUCCESS("Restore complete."))

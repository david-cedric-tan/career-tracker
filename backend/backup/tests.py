"""Backup export and restore — the round trip has to actually round-trip."""

import json
import zipfile
from base64 import b64decode
from datetime import date
from io import BytesIO

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase

from accounts.models import Experience, ExperiencePhoto, Profile
from applications.models import (
    Application,
    ApplicationJobListing,
    AppsEventLog,
    Company,
    Industry,
    JobListing,
    Location,
    Country,
    Resume,
    Role,
    Stage,
    State,
)
from applications.services import log_creation, log_transition
from catchups.models import Catchup
from network.models import ContactMethod, Person, RelationshipTag
from todos.models import Todo, TodoStatus

from .archive import build_archive
from .workbook import read_workbook, write_workbook

User = get_user_model()

# The smallest possible valid PNG — enough for ImageField to accept as real
# uploaded content in these round-trip tests.
ONE_PX_PNG = b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


class BackupTestBase(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.other = User.objects.create_user("mallory", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.populate()

    def populate(self):
        industry = Industry.objects.create(name="Professional services")
        self.company = Company.objects.create(name="EY")
        self.company.industries.add(industry)
        self.rival = Company.objects.create(name="Canva")
        self.role = Role.objects.create(name="Vacationer")
        country = Country.objects.create(name="Australia")
        state = State.objects.create(country=country, name="New South Wales")
        self.location = Location.objects.create(state=state, name="Sydney")

        self.resume = Resume.objects.create(
            user=self.user, label="ey-vac-2026", notes="Tailored", file_name="cv.pdf"
        )
        self.resume.target_companies.set([self.company])
        self.resume.target_roles.set([self.role])

        self.listing = JobListing.objects.create(
            company=self.company,
            role=self.role,
            location=self.location,
            opened_at=date(2026, 1, 1),
        )

        self.application = Application.objects.create(
            user=self.user,
            company=self.company,
            applied_at=date(2026, 2, 1),
            source="Referral",
            resume=self.resume,
            follow_up_date=date(2026, 3, 1),
            notes="Applied through the careers site.",
        )
        ApplicationJobListing.objects.create(
            application=self.application, job_listing=self.listing
        )
        log_creation(self.application)
        self.application.stage = Stage.ONLINE_ASSESSMENT
        self.application.save()
        log_transition(self.application, Stage.APPLIED, "in_progress", note="Invited")

        alumni_tag, _ = RelationshipTag.objects.get_or_create(name="Alumni")
        self.person = Person.objects.create(
            user=self.user,
            full_name="Sarah Chen",
            title="Senior Consultant",
            status="connection",
            relationship=alumni_tag,
            last_meeting_at=date(2026, 6, 10),
        )
        self.person.companies.set([self.company])
        self.person.applications.set([self.application])
        ContactMethod.objects.create(
            person=self.person, channel="email", value="s@example.com", is_preferred=True
        )
        Catchup.objects.create(
            user=self.user,
            person=self.person,
            met_on=date(2026, 6, 10),
            title="Coffee",
            format="coffee",
            minutes="Talked about the AC.",
            takeaways="Speak early.",
        )

        todo = Todo(
            user=self.user,
            title="Prep for the AC",
            application=self.application,
            person=self.person,
            company=self.company,
            status=TodoStatus.DONE,
        )
        todo.sync_completion()
        todo.save()

        Experience.objects.create(
            user=self.user,
            company=self.rival,
            title="Design Intern",
            started_on=date(2025, 1, 6),
            ended_on=date(2025, 6, 30),
            description="Worked on templates.",
        )

        # Another user's data, which must never leak into this backup.
        theirs = Company.objects.create(name="Secret Co")
        Application.objects.create(user=self.other, company=theirs)
        Person.objects.create(user=self.other, full_name="Not Mine")


class ExportTests(BackupTestBase):
    def test_summary_counts_each_domain(self):
        response = self.client.get("/api/backup/summary/")
        self.assertEqual(response.status_code, 200)
        counts = response.data["counts"]
        self.assertEqual(counts["applications"], 1)
        self.assertEqual(counts["people"], 1)
        self.assertEqual(counts["catchups"], 1)
        self.assertEqual(counts["todos"], 1)
        self.assertEqual(counts["experiences"], 1)

    def test_json_export_is_a_download(self):
        response = self.client.get("/api/backup/export.json")
        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment", response["Content-Disposition"])
        payload = json.loads(response.content)
        self.assertEqual(payload["username"], "dave")
        self.assertEqual(payload["applications"][0]["company"], "EY")

    def test_xlsx_export_is_a_workbook(self):
        response = self.client.get("/api/backup/export.xlsx")
        self.assertEqual(response.status_code, 200)
        self.assertIn("spreadsheetml", response["Content-Type"])
        # A real xlsx is a zip.
        self.assertTrue(response.content.startswith(b"PK\x03\x04"))

    def test_export_excludes_other_users(self):
        archive = build_archive(self.user)
        names = {c["name"] for c in archive["companies"]}
        self.assertNotIn("Secret Co", names)
        self.assertEqual([p["full_name"] for p in archive["people"]], ["Sarah Chen"])

    def test_export_requires_auth(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/backup/export.json").status_code, 401)


class RoundTripTests(BackupTestBase):
    """The point of a backup: what comes out must go back in."""

    def assert_restored(self):
        self.assertEqual(Application.objects.filter(user=self.user).count(), 1)
        application = Application.objects.get(user=self.user)
        self.assertEqual(application.company.name, "EY")
        self.assertEqual(application.stage, Stage.ONLINE_ASSESSMENT)
        self.assertEqual(application.source, "Referral")
        self.assertEqual(application.resume.label, "ey-vac-2026")
        self.assertEqual(application.applied_at, date(2026, 2, 1))
        self.assertEqual(
            [l.job_listing.role.name for l in application.listing_links.all()],
            ["Vacationer"],
        )
        # The append-only history is part of the backup.
        self.assertEqual(AppsEventLog.objects.filter(application=application).count(), 2)

        person = Person.objects.get(user=self.user)
        self.assertEqual(person.full_name, "Sarah Chen")
        # Restored by name into whatever RelationshipTag row already exists
        # (or a freshly get-or-created one) — never a raw string on the FK,
        # and never the original row's id, which wouldn't mean anything on a
        # different account/database.
        self.assertEqual(person.relationship.name, "Alumni")
        self.assertEqual([c.name for c in person.companies.all()], ["EY"])
        self.assertEqual([a.id for a in person.applications.all()], [application.id])
        self.assertEqual(person.contact_methods.get().value, "s@example.com")

        catchup = Catchup.objects.get(user=self.user)
        self.assertEqual(catchup.minutes, "Talked about the AC.")
        self.assertEqual(catchup.person, person)

        todo = Todo.objects.get(user=self.user)
        self.assertEqual(todo.status, TodoStatus.DONE)
        self.assertIsNotNone(todo.completed_at)
        self.assertEqual(todo.application, application)
        self.assertEqual(todo.person, person)

        experience = Experience.objects.get(user=self.user)
        self.assertEqual(experience.title, "Design Intern")
        self.assertEqual(experience.company.name, "Canva")

        resume = Resume.objects.get(user=self.user)
        self.assertEqual([c.name for c in resume.target_companies.all()], ["EY"])
        # The binary isn't in the archive, but its name is, so the user knows
        # which file to re-attach.
        self.assertEqual(resume.file_name, "cv.pdf")

    def import_file(self, name, content, **extra):
        return self.client.post(
            "/api/backup/import/",
            {"file": SimpleUploadedFile(name, content), **extra},
            format="multipart",
        )

    def test_json_round_trip(self):
        exported = self.client.get("/api/backup/export.json").content
        response = self.import_file("backup.json", exported, mode="replace")
        self.assertEqual(response.status_code, 200, response.data)
        self.assert_restored()

    def test_xlsx_round_trip(self):
        exported = self.client.get("/api/backup/export.xlsx").content
        response = self.import_file("backup.xlsx", exported, mode="replace")
        self.assertEqual(response.status_code, 200, response.data)
        self.assert_restored()

    def test_restore_into_an_empty_account(self):
        exported = self.client.get("/api/backup/export.json").content

        # Simulate the disaster: everything gone.
        Todo.objects.filter(user=self.user).delete()
        Catchup.objects.filter(user=self.user).delete()
        Person.objects.filter(user=self.user).delete()
        Application.objects.filter(user=self.user).delete()
        Resume.objects.filter(user=self.user).delete()
        Experience.objects.filter(user=self.user).delete()
        self.assertEqual(Application.objects.filter(user=self.user).count(), 0)

        self.import_file("backup.json", exported, mode="replace")
        self.assert_restored()

    def test_import_replaces_rather_than_duplicating(self):
        exported = self.client.get("/api/backup/export.json").content
        self.import_file("backup.json", exported, mode="replace")
        self.import_file("backup.json", exported, mode="replace")
        # Twice imported, still one of each.
        self.assertEqual(Application.objects.filter(user=self.user).count(), 1)
        self.assertEqual(Person.objects.filter(user=self.user).count(), 1)
        self.assertEqual(Catchup.objects.filter(user=self.user).count(), 1)

    def test_import_never_touches_another_users_data(self):
        exported = self.client.get("/api/backup/export.json").content
        self.import_file("backup.json", exported, mode="replace")
        self.assertEqual(Application.objects.filter(user=self.other).count(), 1)
        self.assertEqual(Person.objects.filter(user=self.other).count(), 1)

    def test_shared_catalog_is_ensured_not_deleted(self):
        exported = self.client.get("/api/backup/export.json").content
        self.import_file("backup.json", exported, mode="replace")
        # "Secret Co" belongs to no-one in particular and must survive.
        self.assertTrue(Company.objects.filter(name="Secret Co").exists())


class ImportSafetyTests(BackupTestBase):
    def import_file(self, name, content, **extra):
        return self.client.post(
            "/api/backup/import/",
            {"file": SimpleUploadedFile(name, content), **extra},
            format="multipart",
        )

    def test_dry_run_reports_without_writing(self):
        exported = self.client.get("/api/backup/export.json").content
        Application.objects.filter(user=self.user).delete()

        response = self.import_file("backup.json", exported, dry_run="true")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["dry_run"])
        self.assertEqual(response.data["counts"]["applications"], 1)
        self.assertEqual(response.data["from_username"], "dave")
        # Nothing written.
        self.assertEqual(Application.objects.filter(user=self.user).count(), 0)

    def test_import_refuses_without_explicit_mode(self):
        exported = self.client.get("/api/backup/export.json").content
        response = self.import_file("backup.json", exported)
        self.assertEqual(response.status_code, 400)
        self.assertIn("mode", response.data)
        # And nothing was wiped.
        self.assertEqual(Application.objects.filter(user=self.user).count(), 1)

    def test_missing_file_is_rejected(self):
        response = self.client.post("/api/backup/import/", {"mode": "replace"}, format="multipart")
        self.assertEqual(response.status_code, 400)
        self.assertIn("file", response.data)

    def test_unknown_extension_is_rejected(self):
        response = self.import_file("backup.csv", b"a,b,c", mode="replace")
        self.assertEqual(response.status_code, 400)
        self.assertIn("file", response.data)

    def test_corrupt_json_is_rejected(self):
        response = self.import_file("backup.json", b"{not json", mode="replace")
        self.assertEqual(response.status_code, 400)
        self.assertIn("file", response.data)

    def test_wrong_version_is_rejected(self):
        payload = json.dumps({"version": 99, "username": "dave"}).encode()
        response = self.import_file("backup.json", payload, mode="replace")
        self.assertEqual(response.status_code, 400)
        self.assertIn("file", response.data)
        self.assertEqual(Application.objects.filter(user=self.user).count(), 1)

    def test_import_requires_auth(self):
        self.client.force_authenticate(None)
        response = self.import_file("backup.json", b"{}", mode="replace")
        self.assertEqual(response.status_code, 401)


class ZipBackupTests(BackupTestBase):
    """FR-EXPORT-05 — the full backup: data.json plus every file it needs."""

    def populate_media(self):
        Profile.for_user(self.user).avatar.save(
            "me.png", SimpleUploadedFile("me.png", ONE_PX_PNG), save=True
        )
        self.resume.file.save(
            "cv.pdf", SimpleUploadedFile("cv.pdf", b"%PDF-1.4 fake resume bytes"), save=True
        )
        self.company.logo.save(
            "ey.png", SimpleUploadedFile("ey.png", ONE_PX_PNG), save=True
        )
        self.person.photo.save(
            "sarah.png", SimpleUploadedFile("sarah.png", ONE_PX_PNG), save=True
        )
        self.experience = Experience.objects.get(user=self.user)
        ExperiencePhoto.objects.create(
            experience=self.experience,
            image=SimpleUploadedFile("gallery.png", ONE_PX_PNG),
            caption="First day",
        )

    def import_zip(self, content, **extra):
        return self.client.post(
            "/api/backup/import/",
            {"file": SimpleUploadedFile("backup.zip", content), **extra},
            format="multipart",
        )

    def test_zip_export_contains_data_and_manifest(self):
        self.populate_media()
        response = self.client.get("/api/backup/export.zip")
        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment", response["Content-Disposition"])

        with zipfile.ZipFile(BytesIO(response.content)) as zf:
            names = set(zf.namelist())
            self.assertIn("data.json", names)
            self.assertIn("manifest.json", names)

            data = json.loads(zf.read("data.json"))
            self.assertEqual(data["username"], "dave")

            manifest = json.loads(zf.read("manifest.json"))["files"]
            kinds = {row["kind"] for row in manifest}
            self.assertEqual(
                kinds,
                {"profile_avatar", "resume", "company_logo", "person_photo", "experience_photo"},
            )
            # Every manifest path is actually present in the zip.
            for row in manifest:
                self.assertIn(row["path"], names)

    def test_summary_reports_file_count(self):
        self.populate_media()
        response = self.client.get("/api/backup/summary/")
        self.assertEqual(response.data["file_count"], 5)

    def test_zip_round_trip_reattaches_files(self):
        self.populate_media()
        exported = self.client.get("/api/backup/export.zip").content

        response = self.import_zip(exported, mode="replace")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["files_attached"], 5)

        profile = Profile.for_user(self.user)
        self.assertTrue(profile.avatar.name.endswith(".png"))

        resume = Resume.objects.get(user=self.user)
        self.assertTrue(resume.file.name.endswith(".pdf"))

        company = Company.objects.get(name="EY")
        self.assertTrue(company.logo.name.endswith(".png"))

        person = Person.objects.get(user=self.user)
        self.assertTrue(person.photo.name.endswith(".png"))

        experience = Experience.objects.get(user=self.user)
        photo = experience.photos.get()
        self.assertEqual(photo.caption, "First day")
        self.assertTrue(photo.image.name.endswith(".png"))

    def test_zip_dry_run_reports_file_count_without_writing(self):
        self.populate_media()
        exported = self.client.get("/api/backup/export.zip").content
        file_name_before = Resume.objects.get(user=self.user).file.name

        response = self.import_zip(exported, dry_run="true")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["dry_run"])
        self.assertEqual(response.data["file_count"], 5)
        # Nothing written — not even a re-save of the file already there.
        self.assertEqual(Resume.objects.get(user=self.user).file.name, file_name_before)

    def test_non_zip_import_still_works_with_no_files(self):
        # The JSON-only path shouldn't regress now that import returns files_attached too.
        exported = self.client.get("/api/backup/export.json").content
        response = self.client.post(
            "/api/backup/import/",
            {"file": SimpleUploadedFile("backup.json", exported), "mode": "replace"},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["files_attached"], 0)

    def test_corrupt_zip_is_rejected(self):
        response = self.import_zip(b"not a real zip", mode="replace")
        self.assertEqual(response.status_code, 400)
        self.assertIn("file", response.data)

    def test_zip_without_data_json_is_rejected(self):
        buffer = BytesIO()
        with zipfile.ZipFile(buffer, "w") as zf:
            zf.writestr("nonsense.txt", "hello")
        response = self.import_zip(buffer.getvalue(), mode="replace")
        self.assertEqual(response.status_code, 400)
        self.assertIn("file", response.data)


class WorkbookShapeTests(BackupTestBase):
    def test_workbook_parses_back_to_the_same_shape(self):
        archive = build_archive(self.user)
        parsed = read_workbook(BytesIO(write_workbook(archive)))

        self.assertEqual(parsed["version"], archive["version"])
        self.assertEqual(len(parsed["applications"]), len(archive["applications"]))
        # Lists survive the flatten/split, and JSON columns survive verbatim.
        self.assertEqual(parsed["applications"][0]["listings"], ["Vacationer"])
        self.assertEqual(parsed["resumes"][0]["target_companies"], ["EY"])
        self.assertTrue(parsed["resumes"][0]["is_active"])

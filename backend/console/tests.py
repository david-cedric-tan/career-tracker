"""The admin console: superuser-only, and the selective migration has to
carry every table and load back cleanly."""

import json
import zipfile
from io import BytesIO

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase

from accounts.models import Profile, RefinementNote
from applications.models import Application, Company, CompanyNote
from network.models import Person
from todos.models import Todo

from .migration import (
    SECTION_KEYS,
    build_migration,
    dumpable_models,
    section_models,
)

User = get_user_model()


class ConsoleBase(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser("sysadmin", "a@x.com", "console-pass-1234")
        self.alice = User.objects.create_user("alice", password="tracker-pass-9182")
        self.bob = User.objects.create_user("bob", password="tracker-pass-9182")
        ey = Company.objects.create(name="EY", short_name="EY")
        canva = Company.objects.create(name="Canva")
        Application.objects.create(user=self.alice, company=ey)
        Application.objects.create(user=self.bob, company=canva)
        CompanyNote.objects.create(user=self.alice, company=ey, notes="alice's note")
        Person.objects.create(user=self.alice, full_name="Sarah Chen")
        Todo.objects.create(user=self.bob, title="Bob's todo")
        RefinementNote.objects.create(user=self.alice, body="Calendar bug")
        self.client.force_authenticate(self.admin)


class AccessTests(ConsoleBase):
    def test_ordinary_user_is_refused(self):
        self.client.force_authenticate(self.alice)
        for url in ("/api/console/overview/", "/api/console/accounts/", "/api/console/refinements/"):
            self.assertEqual(self.client.get(url).status_code, 403, url)

    def test_developer_flag_is_not_enough(self):
        profile = Profile.for_user(self.alice)
        profile.is_developer = True
        profile.save()
        self.client.force_authenticate(self.alice)
        self.assertEqual(self.client.get("/api/console/overview/").status_code, 403)

    def test_anonymous_is_refused(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/console/overview/").status_code, 401)

    def test_overview_reports_totals_and_sections(self):
        response = self.client.get("/api/console/overview/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["totals"]["accounts"], 3)
        self.assertEqual(response.data["totals"]["applications"], 2)
        self.assertEqual([s["key"] for s in response.data["sections"]], SECTION_KEYS)
        self.assertIn("DEBUG", response.data["settings"])


class AccountTests(ConsoleBase):
    def test_lists_every_account_with_counts(self):
        rows = self.client.get("/api/console/accounts/").data
        by_name = {row["username"]: row for row in rows}
        self.assertEqual(by_name["alice"]["counts"]["applications"], 1)
        self.assertEqual(by_name["bob"]["counts"]["todos"], 1)
        self.assertTrue(by_name["sysadmin"]["is_superuser"])

    def test_toggle_developer_and_active(self):
        response = self.client.patch(
            f"/api/console/accounts/{self.alice.id}/",
            {"is_developer": True, "is_active": False},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.alice.refresh_from_db()
        self.assertFalse(self.alice.is_active)
        self.assertTrue(Profile.for_user(self.alice).is_developer)

    def test_cannot_demote_self(self):
        response = self.client.patch(
            f"/api/console/accounts/{self.admin.id}/", {"is_superuser": False}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_set_password_revokes_token(self):
        from rest_framework.authtoken.models import Token

        Token.objects.create(user=self.alice)
        response = self.client.patch(
            f"/api/console/accounts/{self.alice.id}/", {"password": "brand-new-pass"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.alice.refresh_from_db()
        self.assertTrue(self.alice.check_password("brand-new-pass"))
        self.assertFalse(Token.objects.filter(user=self.alice).exists())

    def test_create_account(self):
        response = self.client.post(
            "/api/console/accounts/",
            {"username": "carol", "password": "carol-pass-123", "is_developer": True},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(response.data["is_developer"])

    def test_delete_requires_typed_username(self):
        url = f"/api/console/accounts/{self.bob.id}/"
        self.assertEqual(self.client.delete(url, {"confirm": "nope"}, format="json").status_code, 400)
        self.assertEqual(self.client.delete(url, {"confirm": "bob"}, format="json").status_code, 204)
        self.assertFalse(User.objects.filter(username="bob").exists())
        self.assertFalse(Todo.objects.filter(title="Bob's todo").exists())


class MigrationTests(ConsoleBase):
    def test_every_model_belongs_to_exactly_one_section(self):
        seen = {}
        for key, models in section_models().items():
            for model in models:
                self.assertNotIn(model, seen, f"{model} is in both {seen.get(model)} and {key}")
                seen[model] = key
        missing = [str(m) for m in dumpable_models() if m not in seen]
        self.assertEqual(missing, [])

    def read_zip(self, content):
        zf = zipfile.ZipFile(BytesIO(content))
        return json.loads(zf.read("manifest.json")), json.loads(zf.read("dump.json")), zf

    def test_full_export_carries_everything(self):
        response = self.client.get("/api/console/migration/export.zip")
        self.assertEqual(response.status_code, 200)
        manifest, dump, _ = self.read_zip(response.content)
        models = {row["model"] for row in dump}
        self.assertIn("auth.user", models)
        self.assertIn("applications.application", models)
        self.assertIn("applications.companynote", models)
        self.assertIn("accounts.refinementnote", models)
        self.assertEqual(manifest["sections"], SECTION_KEYS)
        self.assertEqual(manifest["users"], "all")
        self.assertEqual(
            sum(1 for row in dump if row["model"] == "auth.user"), 3
        )

    def test_section_toggles_limit_the_dump(self):
        response = self.client.get("/api/console/migration/export.zip?sections=refinements,todos")
        manifest, dump, _ = self.read_zip(response.content)
        models = {row["model"] for row in dump}
        self.assertEqual(models, {"accounts.refinementnote", "todos.todo"})
        self.assertEqual(manifest["sections"], ["todos", "refinements"])

    def test_unknown_section_is_rejected(self):
        response = self.client.get("/api/console/migration/export.zip?sections=nope")
        self.assertEqual(response.status_code, 400)

    def test_user_filter_keeps_only_their_rows_but_all_catalogs(self):
        response = self.client.get(f"/api/console/migration/export.zip?users={self.alice.id}")
        manifest, dump, _ = self.read_zip(response.content)
        users = [row["fields"]["username"] for row in dump if row["model"] == "auth.user"]
        self.assertEqual(users, ["alice"])
        apps = [row for row in dump if row["model"] == "applications.application"]
        self.assertEqual(len(apps), 1)
        self.assertFalse(any(row["model"] == "todos.todo" for row in dump))
        # Shared companies come whole — bob's Canva included.
        companies = {row["fields"]["name"] for row in dump if row["model"] == "applications.company"}
        self.assertEqual(companies, {"EY", "Canva"})
        self.assertEqual(manifest["users"], [self.alice.id])

    def test_media_toggle(self):
        Profile.for_user(self.alice).avatar.save(
            "a.png", SimpleUploadedFile("a.png", b"\x89PNG fake"), save=True
        )
        with_media = self.read_zip(self.client.get("/api/console/migration/export.zip").content)[2]
        self.assertTrue(any(n.startswith("media/") for n in with_media.namelist()))
        without = self.read_zip(
            self.client.get("/api/console/migration/export.zip?media=0").content
        )[2]
        self.assertFalse(any(n.startswith("media/") for n in without.namelist()))

    def test_sections_endpoint_counts(self):
        response = self.client.get("/api/console/migration/sections/")
        by_key = {s["key"]: s for s in response.data["sections"]}
        self.assertEqual(by_key["todos"]["rows"], 1)
        self.assertGreaterEqual(by_key["accounts"]["rows"], 3)

    def test_dry_run_previews_without_writing(self):
        exported = build_migration(sections=["todos"])
        Todo.objects.create(user=self.alice, title="Added after export")
        response = self.client.post(
            "/api/console/migration/import/",
            {"file": SimpleUploadedFile("m.zip", exported), "dry_run": "1"},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["dry_run"])
        self.assertEqual(response.data["counts"]["todos.todo"], 1)
        self.assertEqual(Todo.objects.count(), 2)

    def test_import_requires_confirmation(self):
        exported = build_migration(sections=["todos"])
        response = self.client.post(
            "/api/console/migration/import/",
            {"file": SimpleUploadedFile("m.zip", exported)},
            format="multipart",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Todo.objects.count(), 1)

    def test_partial_import_replaces_only_its_tables(self):
        exported = build_migration(sections=["todos"])
        Todo.objects.create(user=self.alice, title="Will be replaced")
        Person.objects.create(user=self.bob, full_name="Survives")
        response = self.client.post(
            "/api/console/migration/import/",
            {"file": SimpleUploadedFile("m.zip", exported), "confirm": "REPLACE"},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["signed_out"])
        self.assertEqual(list(Todo.objects.values_list("title", flat=True)), ["Bob's todo"])
        self.assertTrue(Person.objects.filter(full_name="Survives").exists())

    def test_full_round_trip_restores_every_account(self):
        Profile.for_user(self.alice).avatar.save(
            "a.png", SimpleUploadedFile("a.png", b"\x89PNG fake"), save=True
        )
        exported = build_migration()
        # Disaster: everything gone but the operator.
        Application.objects.all().delete()
        Person.objects.all().delete()
        Todo.objects.all().delete()
        self.alice.delete()
        self.bob.delete()
        response = self.client.post(
            "/api/console/migration/import/",
            {"file": SimpleUploadedFile("m.zip", exported), "confirm": "REPLACE"},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["signed_out"])
        self.assertEqual(set(User.objects.values_list("username", flat=True)), {"sysadmin", "alice", "bob"})
        self.assertEqual(Application.objects.count(), 2)
        self.assertEqual(CompanyNote.objects.get().notes, "alice's note")
        self.assertEqual(Person.objects.get().full_name, "Sarah Chen")
        self.assertTrue(Profile.objects.get(user__username="alice").avatar.name)
        self.assertEqual(response.data["files_copied"], 1)

    def test_legacy_full_backup_endpoint_still_works(self):
        response = self.client.get("/api/backup/admin/export-full.zip")
        self.assertEqual(response.status_code, 200)
        manifest, dump, _ = self.read_zip(response.content)
        self.assertEqual(manifest["sections"], SECTION_KEYS)


class RefinementTests(ConsoleBase):
    def test_lists_every_users_tickets(self):
        rows = self.client.get("/api/console/refinements/").data
        self.assertEqual([r["user"] for r in rows], ["alice"])
        detail = self.client.get(f"/api/console/refinements/{rows[0]['id']}/").data
        self.assertIn("messages", detail)
        self.assertIn("events", detail)

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from accounts.models import RefinementNote

U = get_user_model()


class RefinementNoteTests(APITestCase):
    def setUp(self):
        self.user = U.objects.create_user("dave", password="tracker-pass-9182")
        self.other = U.objects.create_user("mallory", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)

    def test_log_a_note(self):
        r = self.client.post(
            "/api/auth/refinements/",
            {"body": "  The company panel ordering is confusing  ", "kind": "complaint", "page": "/"},
            format="json",
        )
        self.assertEqual(r.status_code, 201, r.data)
        self.assertEqual(r.data["body"], "The company panel ordering is confusing")
        self.assertEqual(r.data["status"], "open")
        self.assertEqual(r.data["kind_display"], "Complaint")

    def test_blank_body_is_rejected(self):
        r = self.client.post("/api/auth/refinements/", {"body": "   "}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_notes_are_private_to_their_author(self):
        RefinementNote.objects.create(user=self.other, body="Theirs")
        mine = RefinementNote.objects.create(user=self.user, body="Mine")

        listed = self.client.get("/api/auth/refinements/").data
        self.assertEqual([n["body"] for n in listed], ["Mine"])

        self.client.force_authenticate(self.other)
        r = self.client.patch(
            f"/api/auth/refinements/{mine.id}/", {"status": "done"}, format="json"
        )
        self.assertEqual(r.status_code, 404)

    def test_mark_done_and_filter_by_status(self):
        note = RefinementNote.objects.create(user=self.user, body="Fix it")
        RefinementNote.objects.create(user=self.user, body="Still open")

        self.client.patch(
            f"/api/auth/refinements/{note.id}/", {"status": "done"}, format="json"
        )
        open_notes = self.client.get("/api/auth/refinements/?status=open").data
        self.assertEqual([n["body"] for n in open_notes], ["Still open"])

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/auth/refinements/").status_code, 401)

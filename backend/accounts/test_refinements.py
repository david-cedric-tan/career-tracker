import json
import shutil
import tempfile
import time
from io import BytesIO

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image
from rest_framework.test import APITestCase

from accounts.models import Profile, RefinementMessage, RefinementNote

TICKET_MEDIA = tempfile.mkdtemp()


def image_file(name="shot.jpg", size=(1200, 800)):
    buffer = BytesIO()
    Image.new("RGB", size, (30, 60, 90)).save(buffer, format="JPEG")
    buffer.seek(0)
    return SimpleUploadedFile(name, buffer.read(), content_type="image/jpeg")

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


class DeveloperInboxTests(APITestCase):
    """The developer reads everyone's notes and replies to them. That widened
    read is the only thing the flag grants, so the writes are pinned down here."""

    def setUp(self):
        self.dev = U.objects.create_user("DavieeTan", password="tracker-pass-9182")
        Profile.for_user(self.dev)
        self.sister = U.objects.create_user("mia", password="tracker-pass-9182")
        Profile.for_user(self.sister)
        self.note = RefinementNote.objects.create(
            user=self.sister, body="The calendar scrolls past today", kind="bug"
        )

    def test_a_note_carries_the_sender_picture_for_the_developers_list(self):
        """The developer's list shows who raised each note, with their photo.

        Nobody in this test has uploaded one, which is the case that has to
        stay quiet: a missing avatar is a null, not a broken URL or a 500.
        """
        self.client.force_authenticate(self.dev)
        row = self.client.get("/api/auth/refinements/").data[0]
        self.assertEqual(row["author"], "mia")
        self.assertIsNone(row["author_avatar"])

    def test_the_owner_account_gets_the_flag_automatically(self):
        self.assertTrue(Profile.for_user(self.dev).is_developer)
        self.assertFalse(Profile.for_user(self.sister).is_developer)

    @override_settings(DEVELOPER_USERNAME="DavieeTan")
    def test_the_flag_ignores_the_casing_of_the_username(self):
        typo = U.objects.create_user("davieetan", password="tracker-pass-9182")
        self.assertTrue(Profile.for_user(typo).is_developer)

    def test_developer_sees_every_account_s_notes(self):
        RefinementNote.objects.create(user=self.dev, body="Mine")
        self.client.force_authenticate(self.dev)

        listed = self.client.get("/api/auth/refinements/").data
        self.assertEqual(
            sorted(n["body"] for n in listed),
            ["Mine", "The calendar scrolls past today"],
        )
        theirs = next(n for n in listed if n["body"].startswith("The calendar"))
        self.assertEqual(theirs["author"], "mia")
        self.assertFalse(theirs["is_mine"])

    def test_developer_can_narrow_to_their_own_log(self):
        RefinementNote.objects.create(user=self.dev, body="Mine")
        self.client.force_authenticate(self.dev)

        listed = self.client.get("/api/auth/refinements/?scope=mine").data
        self.assertEqual([n["body"] for n in listed], ["Mine"])

    def test_everyone_else_still_sees_only_their_own(self):
        RefinementNote.objects.create(user=self.dev, body="Dev's own note")
        self.client.force_authenticate(self.sister)

        listed = self.client.get("/api/auth/refinements/").data
        self.assertEqual([n["body"] for n in listed], ["The calendar scrolls past today"])

    def test_resolving_replies_to_the_reporter(self):
        self.client.force_authenticate(self.dev)
        r = self.client.post(
            f"/api/auth/refinements/{self.note.id}/resolve/",
            {"message": "Fixed — it opens on today now."},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["status"], "done")
        self.assertEqual(r.data["resolution"], "Fixed — it opens on today now.")
        self.assertEqual(r.data["resolved_by_name"], "DavieeTan")
        # Unseen until the reporter looks, which is what makes it a notification.
        self.assertIsNone(r.data["resolution_seen_at"])

    def test_a_reply_needs_to_actually_say_something(self):
        self.client.force_authenticate(self.dev)
        r = self.client.post(
            f"/api/auth/refinements/{self.note.id}/resolve/",
            {"message": "   "},
            format="json",
        )
        self.assertEqual(r.status_code, 400)

    def test_the_reporter_acknowledges_the_reply(self):
        self.client.force_authenticate(self.dev)
        self.client.post(
            f"/api/auth/refinements/{self.note.id}/resolve/",
            {"message": "Done."},
            format="json",
        )

        self.client.force_authenticate(self.sister)
        r = self.client.post("/api/auth/refinements/acknowledge/", {}, format="json")
        self.assertEqual(r.data["acknowledged"], 1)

        listed = self.client.get("/api/auth/refinements/").data
        self.assertIsNotNone(listed[0]["resolution_seen_at"])
        # Second call has nothing left to clear.
        again = self.client.post("/api/auth/refinements/acknowledge/", {}, format="json")
        self.assertEqual(again.data["acknowledged"], 0)

    def test_acknowledging_does_not_touch_anyone_else_s_notes(self):
        self.client.force_authenticate(self.dev)
        self.client.post(
            f"/api/auth/refinements/{self.note.id}/resolve/",
            {"message": "Done."},
            format="json",
        )
        # The developer clearing their own notifications must not mark the
        # sister's reply as read on her behalf.
        self.client.post("/api/auth/refinements/acknowledge/", {}, format="json")

        self.note.refresh_from_db()
        self.assertIsNone(self.note.resolution_seen_at)

    def test_developer_can_move_a_ticket_through_workflow_statuses(self):
        self.client.force_authenticate(self.dev)
        testing = self.client.post(
            f"/api/auth/refinements/{self.note.id}/set-status/",
            {"status": "testing"},
            format="json",
        )
        self.assertEqual(testing.status_code, 200, testing.data)
        self.assertEqual(testing.data["status"], "testing")
        self.assertEqual(testing.data["status_display"], "Testing")
        self.assertTrue(
            any(row["event_type"] == "testing" for row in testing.data["event_logs"])
        )

        awaiting = self.client.post(
            f"/api/auth/refinements/{self.note.id}/set-status/",
            {"status": "awaiting_validation"},
            format="json",
        )
        self.assertEqual(awaiting.status_code, 200, awaiting.data)
        self.assertEqual(awaiting.data["status"], "awaiting_validation")
        self.assertEqual(awaiting.data["status_display"], "Awaiting validation")

        back = self.client.post(
            f"/api/auth/refinements/{self.note.id}/set-status/",
            {"status": "open"},
            format="json",
        )
        self.assertEqual(back.status_code, 200, back.data)
        self.assertEqual(back.data["status"], "open")
        # Still unanswered — no resolution text, not locked.
        self.assertEqual(back.data["resolution"], "")
        self.assertFalse(back.data["is_locked"])

    def test_set_status_rejects_done_and_non_developers(self):
        self.client.force_authenticate(self.dev)
        bad = self.client.post(
            f"/api/auth/refinements/{self.note.id}/set-status/",
            {"status": "done"},
            format="json",
        )
        self.assertEqual(bad.status_code, 400)

        self.client.force_authenticate(self.sister)
        denied = self.client.post(
            f"/api/auth/refinements/{self.note.id}/set-status/",
            {"status": "testing"},
            format="json",
        )
        self.assertEqual(denied.status_code, 403)

    def test_set_status_blocked_on_a_fixed_ticket(self):
        self.client.force_authenticate(self.dev)
        self.client.post(
            f"/api/auth/refinements/{self.note.id}/resolve/",
            {"message": "Shipped."},
            format="json",
        )
        blocked = self.client.post(
            f"/api/auth/refinements/{self.note.id}/set-status/",
            {"status": "testing"},
            format="json",
        )
        self.assertEqual(blocked.status_code, 403)

    def test_needs_attention_flags_new_tickets_and_unseen_fixes(self):
        self.client.force_authenticate(self.dev)
        listed = self.client.get("/api/auth/refinements/?scope=all").data
        row = next(n for n in listed if n["id"] == self.note.id)
        self.assertTrue(row["needs_attention"])

        self.client.post(
            f"/api/auth/refinements/{self.note.id}/resolve/",
            {"message": "Shipped."},
            format="json",
        )
        # Developer no longer needs attention on a fixed ticket with no unread chat.
        listed = self.client.get("/api/auth/refinements/?scope=all").data
        row = next(n for n in listed if n["id"] == self.note.id)
        self.assertFalse(row["needs_attention"])

        self.client.force_authenticate(self.sister)
        listed = self.client.get("/api/auth/refinements/").data
        self.assertTrue(listed[0]["needs_attention"])

    def test_developer_cannot_edit_someone_else_s_complaint(self):
        self.client.force_authenticate(self.dev)
        r = self.client.patch(
            f"/api/auth/refinements/{self.note.id}/",
            {"body": "rewritten"},
            format="json",
        )
        self.assertEqual(r.status_code, 403)
        self.note.refresh_from_db()
        self.assertEqual(self.note.body, "The calendar scrolls past today")

    def test_developer_cannot_delete_someone_else_s_complaint(self):
        self.client.force_authenticate(self.dev)
        r = self.client.delete(f"/api/auth/refinements/{self.note.id}/")
        self.assertEqual(r.status_code, 403)
        self.assertTrue(RefinementNote.objects.filter(id=self.note.id).exists())

    def test_a_normal_user_cannot_resolve_a_stranger_s_note(self):
        outsider = U.objects.create_user("stranger", password="tracker-pass-9182")
        self.client.force_authenticate(outsider)
        r = self.client.post(
            f"/api/auth/refinements/{self.note.id}/resolve/",
            {"message": "nice try"},
            format="json",
        )
        # Not even visible to them, so it never reaches the permission check.
        self.assertEqual(r.status_code, 404)

    def test_the_reporter_can_edit_an_unanswered_ticket(self):
        self.client.force_authenticate(self.sister)
        r = self.client.patch(
            f"/api/auth/refinements/{self.note.id}/",
            {"body": "The calendar opens on the wrong month", "screens": ["calendar"]},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["body"], "The calendar opens on the wrong month")
        self.assertEqual(r.data["screen_labels"], ["Calendar"])
        self.assertFalse(r.data["is_locked"])
        edited = next(row for row in r.data["event_logs"] if row["event_type"] == "edited")
        payload = json.loads(edited["detail"])
        self.assertEqual(payload["before"], "The calendar scrolls past today")
        self.assertEqual(payload["after"], "The calendar opens on the wrong month")
        self.assertEqual(payload["screens_before"], [])
        self.assertEqual(payload["screens_after"], ["calendar"])

    def test_changing_only_screen_tags_logs_an_edited_event(self):
        self.client.force_authenticate(self.sister)
        r = self.client.patch(
            f"/api/auth/refinements/{self.note.id}/",
            {"screens": ["dashboard", "todos"]},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.data)
        edited = next(row for row in r.data["event_logs"] if row["event_type"] == "edited")
        payload = json.loads(edited["detail"])
        self.assertNotIn("before", payload)
        self.assertNotIn("after", payload)
        self.assertEqual(payload["screens_before"], [])
        self.assertEqual(payload["screens_after"], ["dashboard", "todos"])

    def test_an_answered_ticket_is_no_longer_editable(self):
        self.client.force_authenticate(self.dev)
        self.client.post(
            f"/api/auth/refinements/{self.note.id}/resolve/",
            {"message": "Fixed."},
            format="json",
        )

        self.client.force_authenticate(self.sister)
        r = self.client.patch(
            f"/api/auth/refinements/{self.note.id}/",
            {"body": "actually something else"},
            format="json",
        )
        self.assertEqual(r.status_code, 403)
        self.note.refresh_from_db()
        self.assertEqual(self.note.body, "The calendar scrolls past today")

    def test_an_answered_ticket_can_still_be_reopened(self):
        self.client.force_authenticate(self.dev)
        self.client.post(
            f"/api/auth/refinements/{self.note.id}/resolve/",
            {"message": "Fixed."},
            format="json",
        )

        self.client.force_authenticate(self.sister)
        r = self.client.patch(
            f"/api/auth/refinements/{self.note.id}/",
            {"status": "open"},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.data)
        self.assertEqual(r.data["status"], "open")
        self.assertEqual(r.data["resolution"], "")
        self.assertFalse(r.data["is_locked"])
        types = [row["event_type"] for row in r.data["event_logs"]]
        self.assertEqual(types[-2:], ["fixed", "reopened"])
        self.assertEqual(
            next(row for row in r.data["event_logs"] if row["event_type"] == "fixed")[
                "detail"
            ],
            "Fixed.",
        )

    def test_ticking_your_own_note_off_does_not_lock_it(self):
        self.client.force_authenticate(self.sister)
        self.client.patch(
            f"/api/auth/refinements/{self.note.id}/", {"status": "done"}, format="json"
        )
        r = self.client.patch(
            f"/api/auth/refinements/{self.note.id}/",
            {"body": "still my note to edit"},
            format="json",
        )
        self.assertEqual(r.status_code, 200, r.data)

    def test_screen_tags_are_checked_against_the_app_s_screens(self):
        self.client.force_authenticate(self.sister)
        r = self.client.patch(
            f"/api/auth/refinements/{self.note.id}/",
            {"screens": ["calendar", "moon-base"]},
            format="json",
        )
        self.assertEqual(r.status_code, 400)
        self.assertIn("screens", r.data)

    def test_duplicate_screen_tags_collapse(self):
        self.client.force_authenticate(self.sister)
        r = self.client.patch(
            f"/api/auth/refinements/{self.note.id}/",
            {"screens": ["calendar", "calendar", "todos"]},
            format="json",
        )
        self.assertEqual(r.data["screens"], ["calendar", "todos"])

    def test_the_screen_vocabulary_is_published(self):
        self.client.force_authenticate(self.sister)
        r = self.client.get("/api/auth/refinements/screens/")
        self.assertEqual(r.status_code, 200)
        self.assertIn({"value": "calendar", "label": "Calendar"}, r.data)

    def test_is_developer_is_reported_but_not_self_grantable(self):
        self.client.force_authenticate(self.sister)
        self.assertFalse(self.client.get("/api/auth/me/").data["is_developer"])

        self.client.patch("/api/auth/me/", {"is_developer": True}, format="json")
        self.assertFalse(Profile.for_user(self.sister).is_developer)

    def test_is_superuser_is_reported_but_not_self_grantable(self):
        self.client.force_authenticate(self.sister)
        self.assertFalse(self.client.get("/api/auth/me/").data["is_superuser"])

        self.client.patch("/api/auth/me/", {"is_superuser": True}, format="json")
        self.sister.refresh_from_db()
        self.assertFalse(self.sister.is_superuser)


@override_settings(MEDIA_ROOT=TICKET_MEDIA)
class TicketThreadTests(APITestCase):
    """The conversation on a ticket: two people, nobody else, pictures allowed."""

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(TICKET_MEDIA, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.dev = U.objects.create_user("DavieeTan", password="tracker-pass-9182")
        Profile.for_user(self.dev)
        self.sister = U.objects.create_user("mia", password="tracker-pass-9182")
        Profile.for_user(self.sister)
        self.stranger = U.objects.create_user("someone", password="tracker-pass-9182")
        Profile.for_user(self.stranger)
        self.note = RefinementNote.objects.create(
            user=self.sister, body="The calendar scrolls past today", kind="bug"
        )

    def url(self):
        return f"/api/auth/refinements/{self.note.id}/messages/"

    def test_the_two_parties_can_talk_and_both_see_the_thread(self):
        self.client.force_authenticate(self.dev)
        posted = self.client.post(self.url(), {"body": "Which month?"}, format="json")
        self.assertEqual(posted.status_code, 201)

        self.client.force_authenticate(self.sister)
        thread = self.client.get(self.url())
        self.assertEqual([m["body"] for m in thread.data], ["Which month?"])
        self.assertFalse(thread.data[0]["is_mine"])
        self.assertEqual(thread.data[0]["author"], "DavieeTan")

    def test_nobody_else_can_read_or_write_a_thread(self):
        self.client.force_authenticate(self.stranger)
        # 404 rather than 403: the queryset never contained it, which is the
        # right answer — a stranger shouldn't learn the ticket exists.
        self.assertIn(self.client.get(self.url()).status_code, (403, 404))
        self.assertIn(
            self.client.post(self.url(), {"body": "hi"}, format="json").status_code,
            (403, 404),
        )

    def test_a_message_needs_words_or_a_picture(self):
        self.client.force_authenticate(self.sister)
        r = self.client.post(self.url(), {"body": "   "}, format="json")
        self.assertEqual(r.status_code, 400)

    def test_a_screenshot_is_stored_re_encoded(self):
        self.client.force_authenticate(self.sister)
        r = self.client.post(
            self.url(),
            {"body": "", "image": image_file("shot.jpg", (2400, 1400))},
            format="multipart",
        )
        self.assertEqual(r.status_code, 201)
        self.assertTrue(r.data["image"])

        stored = RefinementMessage.objects.get().image
        with Image.open(stored.path) as opened:
            self.assertLessEqual(max(opened.size), 1024)

    def test_unread_counts_only_the_other_persons_messages(self):
        self.client.force_authenticate(self.dev)
        self.client.post(self.url(), {"body": "Which month?"}, format="json")
        # The sender's own message is never unread to them.
        row = self.client.get("/api/auth/refinements/").data[0]
        self.assertEqual(row["unread_count"], 0)

        self.client.force_authenticate(self.sister)
        row = self.client.get("/api/auth/refinements/").data[0]
        self.assertEqual(row["unread_count"], 1)
        self.assertEqual(row["message_count"], 1)
        self.assertEqual(row["last_message"]["preview"], "Which month?")

        # Opening the thread is what marks it read.
        self.client.get(self.url())
        row = self.client.get("/api/auth/refinements/").data[0]
        self.assertEqual(row["unread_count"], 0)

    def test_after_returns_only_newer_messages(self):
        self.client.force_authenticate(self.dev)
        first = self.client.post(self.url(), {"body": "first"}, format="json").data
        second = self.client.post(self.url(), {"body": "second"}, format="json").data

        self.client.force_authenticate(self.sister)
        newer = self.client.get(self.url(), {"after": first["id"]})
        self.assertEqual([m["id"] for m in newer.data], [second["id"]])

    def test_wait_returns_promptly_when_a_message_already_exists(self):
        self.client.force_authenticate(self.dev)
        posted = self.client.post(self.url(), {"body": "hello"}, format="json").data

        self.client.force_authenticate(self.sister)
        started = time.monotonic()
        newer = self.client.get(self.url(), {"after": 0, "wait": 10})
        self.assertLess(time.monotonic() - started, 2)
        self.assertEqual([m["id"] for m in newer.data], [posted["id"]])

    def test_an_answered_ticket_can_still_be_talked_about(self):
        """Locking editing protects the original question, not the conversation."""
        self.client.force_authenticate(self.dev)
        self.client.post(
            f"/api/auth/refinements/{self.note.id}/resolve/",
            {"message": "Fixed the scroll position."},
            format="json",
        )
        self.client.force_authenticate(self.sister)
        r = self.client.post(self.url(), {"body": "Still doing it"}, format="json")
        self.assertEqual(r.status_code, 201)

    def test_a_picture_only_message_previews_as_one(self):
        self.client.force_authenticate(self.sister)
        self.client.post(
            self.url(), {"body": "", "image": image_file()}, format="multipart"
        )
        self.client.force_authenticate(self.dev)
        row = self.client.get("/api/auth/refinements/").data[0]
        self.assertEqual(row["last_message"]["preview"], "Sent a picture")

"""Checks that the dashboard aggregates across all three domains (FR-DASH-*)."""

from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from applications.models import Application, Company, Outcome, Stage
from applications.services import log_creation, log_transition
from events.models import CalendarEvent
from network.models import Person
from todos.models import Todo, TodoStatus

User = get_user_model()


class DashboardApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("dave", password="s3cret-pass-123")
        self.other = User.objects.create_user("mallory", password="s3cret-pass-123")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")
        self.today = timezone.localdate()

    def test_summary_counts_each_domain(self):
        app = Application.objects.create(
            user=self.user, company=self.company, follow_up_date=self.today
        )
        log_creation(app)
        Application.objects.create(
            user=self.user, company=self.company, outcome=Outcome.OFFER_RECEIVED
        )
        Application.objects.create(user=self.other, company=self.company)

        Todo.objects.create(
            user=self.user, title="Late", due_date=self.today - timedelta(days=2)
        )
        Person.objects.create(
            user=self.user,
            full_name="Sarah Chen",
            next_chat_at=self.today - timedelta(days=1),
        )

        response = self.client.get("/api/dashboard/summary/")
        self.assertEqual(response.status_code, 200)
        data = response.data

        self.assertEqual(data["applications"]["total"], 2)  # other user excluded
        self.assertEqual(data["applications"]["offers"], 1)
        self.assertEqual(data["applications"]["follow_ups_due"], 1)
        self.assertEqual(data["todos"]["overdue"], 1)
        self.assertEqual(data["network"]["chats_overdue"], 1)

        # Every stage is present even at zero, so the chart never has gaps.
        self.assertEqual(len(data["applications"]["by_stage"]), len(Stage.choices))

    def test_timeseries_is_zero_filled_and_counts_advances(self):
        app = Application.objects.create(user=self.user, company=self.company)
        log_creation(app)
        app.stage = Stage.ONLINE_ASSESSMENT
        app.save()
        log_transition(app, Stage.APPLIED, Outcome.IN_PROGRESS)

        todo = Todo.objects.create(user=self.user, title="Done thing")
        todo.status = TodoStatus.DONE
        todo.sync_completion()
        todo.save()

        response = self.client.get(
            "/api/dashboard/timeseries/", {"period": "month", "buckets": 6}
        )
        self.assertEqual(response.status_code, 200)
        buckets = response.data["buckets"]
        self.assertEqual(len(buckets), 6)

        latest = buckets[-1]
        self.assertEqual(latest["applications"], 1)
        self.assertEqual(latest["stage_advances"], 1)
        self.assertEqual(latest["todos_completed"], 1)

    def test_quarterly_period_is_supported(self):
        response = self.client.get(
            "/api/dashboard/timeseries/", {"period": "quarter", "buckets": 3}
        )
        self.assertEqual(response.data["period"], "quarter")
        self.assertEqual(len(response.data["buckets"]), 3)

        # Buckets land on real calendar quarters, three months apart.
        starts = [row["start"] for row in response.data["buckets"]]
        self.assertTrue(all(start[5:7] in {"01", "04", "07", "10"} for start in starts), starts)

    def test_an_unknown_period_falls_back_to_all(self):
        response = self.client.get(
            "/api/dashboard/timeseries/", {"period": "week", "buckets": 3}
        )
        self.assertEqual(response.data["period"], "all")

    def test_all_time_is_the_default(self):
        self.assertEqual(
            self.client.get("/api/dashboard/timeseries/").data["period"], "all"
        )
        self.assertEqual(self.client.get("/api/dashboard/summary/").data["period"], "all")

    def test_a_period_narrows_the_summary_and_company_panel(self):
        from datetime import date

        old = Company.objects.create(name="Ancient Co")
        Application.objects.create(
            user=self.user, company=old, applied_at=date(2020, 1, 1)
        )
        Application.objects.create(user=self.user, company=self.company)

        everything = self.client.get("/api/dashboard/summary/", {"period": "all"}).data
        recent = self.client.get("/api/dashboard/summary/", {"period": "month"}).data
        self.assertEqual(everything["applications"]["total"], 2)
        self.assertEqual(recent["applications"]["total"], 1)

        names = [
            r["name"]
            for r in self.client.get("/api/dashboard/companies/", {"period": "month"}).data
        ]
        self.assertNotIn("Ancient Co", names)

    def test_activity_feed_merges_domains_and_links_back(self):
        app = Application.objects.create(user=self.user, company=self.company)
        log_creation(app)
        Person.objects.create(user=self.user, full_name="Sarah Chen")
        todo = Todo.objects.create(user=self.user, title="Ping Sarah")
        todo.status = TodoStatus.DONE
        todo.sync_completion()
        todo.save()

        response = self.client.get("/api/dashboard/activity/")
        self.assertEqual(response.status_code, 200)
        domains = {row["domain"] for row in response.data}
        self.assertEqual(domains, {"application", "todo", "network"})

        app_row = next(r for r in response.data if r["domain"] == "application")
        self.assertEqual(app_row["target_url"], f"/applications/{app.id}")

        # Newest first.
        stamps = [row["occurred_at"] for row in response.data]
        self.assertEqual(stamps, sorted(stamps, reverse=True))

    def test_attention_lists_what_is_due(self):
        Application.objects.create(
            user=self.user, company=self.company, follow_up_date=self.today
        )
        Person.objects.create(
            user=self.user, full_name="Sarah Chen", next_chat_at=self.today
        )
        Todo.objects.create(user=self.user, title="Ping", due_date=self.today)

        response = self.client.get("/api/dashboard/attention/")
        self.assertEqual(len(response.data["follow_ups"]), 1)
        self.assertEqual(len(response.data["chats"]), 1)
        self.assertEqual(len(response.data["tasks"]), 1)

    def test_dashboard_requires_auth(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/dashboard/summary/").status_code, 401)


class CompanyPanelTests(APITestCase):
    """FR-DASH-09..11 — companies beside the application chart."""

    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.other = User.objects.create_user("mallory", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.ey = Company.objects.create(name="EY")
        self.canva = Company.objects.create(name="Canva")

    def names(self):
        return [row["name"] for row in self.client.get("/api/dashboard/companies/").data]

    def test_only_the_requesting_users_companies_are_listed(self):
        Application.objects.create(user=self.user, company=self.ey)
        Application.objects.create(user=self.other, company=self.canva)

        response = self.client.get("/api/dashboard/companies/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([(row["name"], row["count"]) for row in response.data], [("EY", 1)])

    def test_offers_lead_and_all_rejected_companies_go_last(self):
        offer = Company.objects.create(name="Offer Co")
        ghosted = Company.objects.create(name="Ghosted Co")
        Application.objects.create(
            user=self.user, company=offer, outcome=Outcome.OFFER_RECEIVED
        )
        Application.objects.create(user=self.user, company=self.ey)
        Application.objects.create(
            user=self.user, company=ghosted, outcome=Outcome.GHOSTED
        )
        Application.objects.create(
            user=self.user, company=self.canva, outcome=Outcome.REJECTED
        )

        self.assertEqual(self.names(), ["Offer Co", "EY", "Ghosted Co", "Canva"])

    def test_live_applications_rank_by_stage_hierarchy(self):
        late = Company.objects.create(name="Late")
        Application.objects.create(user=self.user, company=self.ey, stage=Stage.APPLIED)
        Application.objects.create(
            user=self.user, company=late, stage=Stage.FINAL_INTERVIEW
        )

        self.assertEqual(self.names(), ["Late", "EY"])

    def test_same_stage_breaks_by_most_recent_application(self):
        Application.objects.create(
            user=self.user, company=self.ey, applied_at=date(2026, 1, 1)
        )
        Application.objects.create(
            user=self.user, company=self.canva, applied_at=date(2026, 6, 1)
        )

        self.assertEqual(self.names(), ["Canva", "EY"])

    def test_one_live_application_outranks_a_pile_of_rejections(self):
        Application.objects.create(
            user=self.user, company=self.ey, outcome=Outcome.REJECTED
        )
        Application.objects.create(user=self.user, company=self.ey)
        for _ in range(3):
            Application.objects.create(
                user=self.user, company=self.canva, outcome=Outcome.REJECTED
            )

        self.assertEqual(self.names(), ["EY", "Canva"])

    def test_rejected_count_is_exposed(self):
        Application.objects.create(
            user=self.user, company=self.ey, outcome=Outcome.REJECTED
        )
        self.assertEqual(self.client.get("/api/dashboard/companies/").data[0]["rejected"], 1)

    def test_counts_split_active_and_offers(self):
        Application.objects.create(user=self.user, company=self.ey)
        Application.objects.create(
            user=self.user, company=self.ey, outcome=Outcome.OFFER_RECEIVED
        )
        Application.objects.create(
            user=self.user, company=self.ey, outcome=Outcome.REJECTED
        )

        row = self.client.get("/api/dashboard/companies/").data[0]
        self.assertEqual(row["count"], 3)
        self.assertEqual(row["active"], 1)
        self.assertEqual(row["offers"], 1)

    def test_logo_is_null_when_unset(self):
        Application.objects.create(user=self.user, company=self.ey)
        self.assertIsNone(self.client.get("/api/dashboard/companies/").data[0]["logo"])

    def test_empty_for_a_user_with_no_applications(self):
        self.assertEqual(self.client.get("/api/dashboard/companies/").data, [])

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/dashboard/companies/").status_code, 401)


class ReapplyAttentionTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("dave", password="s3cret-pass-123")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")
        self.today = timezone.localdate()

    def test_reapply_due_soon_appears_in_attention(self):
        Application.objects.create(
            user=self.user,
            company=self.company,
            outcome=Outcome.REJECTED,
            reapply_at=self.today + timedelta(days=3),
        )
        response = self.client.get("/api/dashboard/attention/")
        self.assertEqual(len(response.data["reapplies"]), 1)
        self.assertEqual(response.data["reapplies"][0]["company"], "EY")

    def test_reapply_far_in_the_future_is_not_yet_in_attention(self):
        Application.objects.create(
            user=self.user,
            company=self.company,
            outcome=Outcome.REJECTED,
            reapply_at=self.today + timedelta(days=200),
        )
        response = self.client.get("/api/dashboard/attention/")
        self.assertEqual(response.data["reapplies"], [])


class CalendarEventsTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("dave", password="s3cret-pass-123")
        self.other = User.objects.create_user("mallory", password="s3cret-pass-123")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")
        self.today = timezone.localdate()

    def test_aggregates_every_domain(self):
        from catchups.models import Catchup

        app = Application.objects.create(
            user=self.user,
            company=self.company,
            follow_up_date=self.today + timedelta(days=2),
            reapply_at=self.today + timedelta(days=300),
        )
        Todo.objects.create(
            user=self.user, title="Prep", due_date=self.today + timedelta(days=1)
        )
        person = Person.objects.create(
            user=self.user, full_name="Sarah", next_chat_at=self.today + timedelta(days=5)
        )
        Catchup.objects.create(
            user=self.user,
            person=person,
            met_on=self.today,
            follow_up_on=self.today + timedelta(days=10),
        )
        CalendarEvent.objects.create(
            user=self.user, title="Career fair", date=self.today + timedelta(days=3)
        )

        response = self.client.get("/api/dashboard/calendar/")
        self.assertEqual(response.status_code, 200)
        domains = {e["domain"] for e in response.data["events"]}
        self.assertEqual(
            domains,
            {
                "todo",
                "application_followup",
                "application_reapply",
                "person_chat",
                "catchup",
                "catchup_followup",
                "custom",
            },
        )
        # Sorted chronologically.
        dates = [e["date"] for e in response.data["events"]]
        self.assertEqual(dates, sorted(dates))

    def test_respects_start_and_end_bounds(self):
        Todo.objects.create(
            user=self.user, title="In range", due_date=self.today + timedelta(days=5)
        )
        Todo.objects.create(
            user=self.user, title="Out of range", due_date=self.today + timedelta(days=500)
        )
        response = self.client.get(
            "/api/dashboard/calendar/",
            {
                "start": self.today.isoformat(),
                "end": (self.today + timedelta(days=30)).isoformat(),
            },
        )
        titles = [e["title"] for e in response.data["events"]]
        self.assertEqual(titles, ["In range"])

    def test_excludes_other_users_events(self):
        Todo.objects.create(
            user=self.other, title="Not mine", due_date=self.today + timedelta(days=1)
        )
        CalendarEvent.objects.create(
            user=self.other, title="Not mine either", date=self.today + timedelta(days=1)
        )
        response = self.client.get("/api/dashboard/calendar/")
        self.assertEqual(response.data["events"], [])

    def test_custom_event_done_flag_passes_through(self):
        CalendarEvent.objects.create(
            user=self.user, title="Done already", date=self.today, is_done=True
        )
        response = self.client.get("/api/dashboard/calendar/")
        event = response.data["events"][0]
        self.assertEqual(event["domain"], "custom")
        self.assertTrue(event["done"])

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/dashboard/calendar/").status_code, 401)


class CalendarIcsTests(APITestCase):
    """The .ics export must round-trip what the JSON endpoint already shows."""

    def setUp(self):
        self.user = User.objects.create_user("dave", password="s3cret-pass-123")
        self.other = User.objects.create_user("mallory", password="s3cret-pass-123")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")
        self.today = timezone.localdate()

    def test_ics_is_a_downloadable_calendar_file(self):
        Todo.objects.create(
            user=self.user, title="Prep for interview",
            due_date=self.today + timedelta(days=1),
        )
        response = self.client.get("/api/dashboard/calendar.ics")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "text/calendar; charset=utf-8")
        self.assertIn("attachment", response["Content-Disposition"])

        body = response.content.decode()
        self.assertTrue(body.startswith("BEGIN:VCALENDAR"))
        self.assertTrue(body.rstrip().endswith("END:VCALENDAR"))
        self.assertIn("BEGIN:VEVENT", body)
        self.assertIn("SUMMARY:Prep for interview", body)
        # RFC 5545 requires CRLF line endings.
        self.assertIn("\r\n", body)

    def test_all_day_event_spans_dtstart_to_dtstart_plus_one(self):
        Todo.objects.create(
            user=self.user, title="Task", due_date=date(2026, 9, 10)
        )
        body = self.client.get("/api/dashboard/calendar.ics").content.decode()
        self.assertIn("DTSTART;VALUE=DATE:20260910", body)
        self.assertIn("DTEND;VALUE=DATE:20260911", body)

    def test_done_items_are_marked_in_the_summary(self):
        todo = Todo.objects.create(
            user=self.user, title="Finished thing", due_date=self.today
        )
        todo.status = TodoStatus.DONE
        todo.sync_completion()
        todo.save()
        body = self.client.get("/api/dashboard/calendar.ics").content.decode()
        self.assertIn("SUMMARY:[Done] Finished thing", body)

    def test_special_characters_are_escaped(self):
        # RFC 5545 TEXT escaping: backslash, comma and semicolon are escaped;
        # a colon is not a reserved character and stays bare.
        Todo.objects.create(
            user=self.user, title="Call re: EY, Canva; follow-up", due_date=self.today
        )
        body = self.client.get("/api/dashboard/calendar.ics").content.decode()
        self.assertIn("SUMMARY:Call re: EY\\, Canva\\; follow-up", body)

    def test_respects_start_and_end_bounds(self):
        Todo.objects.create(
            user=self.user, title="In range", due_date=self.today + timedelta(days=5)
        )
        Todo.objects.create(
            user=self.user, title="Out of range", due_date=self.today + timedelta(days=500)
        )
        body = self.client.get(
            "/api/dashboard/calendar.ics",
            {
                "start": self.today.isoformat(),
                "end": (self.today + timedelta(days=30)).isoformat(),
            },
        ).content.decode()
        self.assertIn("In range", body)
        self.assertNotIn("Out of range", body)

    def test_excludes_other_users_events(self):
        Todo.objects.create(
            user=self.other, title="Not mine", due_date=self.today + timedelta(days=1)
        )
        body = self.client.get("/api/dashboard/calendar.ics").content.decode()
        self.assertNotIn("Not mine", body)

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/dashboard/calendar.ics").status_code, 401)


class StageAdvanceWeightingTests(APITestCase):
    """Stage advances are weighted by how many pipeline steps a move actually
    covered, not counted as a flat 1 per transition — a jump straight to
    Final Interview is more real progress than an Applied -> OA move, and the
    old flat count treated them identically."""

    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")

    def test_a_multi_step_jump_counts_more_than_a_single_step_move(self):
        big_jump = Application.objects.create(user=self.user, company=self.company)
        log_creation(big_jump)
        big_jump.stage = Stage.FINAL_INTERVIEW
        big_jump.save()
        log_transition(big_jump, Stage.APPLIED, Outcome.IN_PROGRESS)

        response = self.client.get(
            "/api/dashboard/timeseries/", {"period": "month", "buckets": 4}
        )
        latest = response.data["buckets"][-1]
        # Applied(1) -> Final interview(5) is 4 pipeline steps, not "1 move".
        self.assertEqual(latest["stage_advances"], 4)

    def test_a_backward_move_contributes_nothing(self):
        app = Application.objects.create(user=self.user, company=self.company)
        log_creation(app)
        app.stage = Stage.FINAL_INTERVIEW
        app.save()
        log_transition(app, Stage.APPLIED, Outcome.IN_PROGRESS)
        # A correction, back down the pipeline.
        app.stage = Stage.ONLINE_ASSESSMENT
        app.save()
        log_transition(app, Stage.FINAL_INTERVIEW, Outcome.IN_PROGRESS)

        response = self.client.get(
            "/api/dashboard/timeseries/", {"period": "month", "buckets": 4}
        )
        latest = response.data["buckets"][-1]
        # +4 for the forward jump, +0 for the backward correction — never negative.
        self.assertEqual(latest["stage_advances"], 4)


class MentionsTests(APITestCase):
    """FR-MENTION-06 — @mentions are plain text, so finding "where was this
    person tagged" means searching the notes-shaped fields for the literal
    tag, not following a stored relation."""

    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.other = User.objects.create_user("mallory", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")

    def test_finds_a_mention_in_a_todo(self):
        Todo.objects.create(
            user=self.user, title="Follow up", description="Ask @SarahChen about the referral"
        )
        response = self.client.get("/api/dashboard/mentions/", {"tag": "SarahChen"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["domain"], "todo")
        self.assertIn("SarahChen", response.data[0]["snippet"])

    def test_finds_a_mention_in_another_persons_notes(self):
        Person.objects.create(
            user=self.user, full_name="Daniel Johnson", notes="Referred by @AndrewChen"
        )
        response = self.client.get("/api/dashboard/mentions/", {"tag": "AndrewChen"})
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["domain"], "person_notes")
        self.assertEqual(response.data[0]["title"], "Daniel Johnson’s profile notes")

    def test_finds_a_mention_in_a_company_note(self):
        from applications.models import CompanyNote

        CompanyNote.objects.create(
            user=self.user, company=self.company, notes="Recruiter is @JamieLee"
        )
        response = self.client.get("/api/dashboard/mentions/", {"tag": "JamieLee"})
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["domain"], "company_note")
        self.assertEqual(response.data[0]["url"], f"/job-directory/companies/{self.company.id}")

    def test_scoped_to_the_requesting_user(self):
        Todo.objects.create(
            user=self.other, title="Not mine", description="Ask @SarahChen"
        )
        response = self.client.get("/api/dashboard/mentions/", {"tag": "SarahChen"})
        self.assertEqual(response.data, [])

    def test_blank_tag_returns_nothing(self):
        response = self.client.get("/api/dashboard/mentions/")
        self.assertEqual(response.data, [])

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        response = self.client.get("/api/dashboard/mentions/", {"tag": "SarahChen"})
        self.assertEqual(response.status_code, 401)

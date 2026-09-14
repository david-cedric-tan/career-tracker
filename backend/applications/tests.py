"""End-to-end API checks for the applications domain."""

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from .models import (
    Application,
    ApplicationJobListing,
    ApplicationStage,
    AppsEventLog,
    Company,
    Country,
    Industry,
    JobListing,
    Location,
    Outcome,
    Resume,
    Role,
    Stage,
    State,
    Venue,
)

User = get_user_model()


class ApplicationApiTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("dave", password="s3cret-pass-123")
        self.other = User.objects.create_user("mallory", password="s3cret-pass-123")
        self.client.force_authenticate(self.user)

        self.company = Company.objects.create(name="EY")
        self.rival = Company.objects.create(name="KPMG")
        self.role = Role.objects.create(name="Vacationer")
        self.listing = JobListing.objects.create(company=self.company, role=self.role)
        self.rival_listing = JobListing.objects.create(
            company=self.rival, role=self.role
        )

    def test_create_application_seeds_event_log(self):
        response = self.client.post(
            "/api/applications/",
            {"company": self.company.id, "listing_ids": [self.listing.id]},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        app = Application.objects.get(id=response.data["id"])
        self.assertEqual(app.user, self.user)
        self.assertEqual(app.listing_links.count(), 1)
        self.assertEqual(app.event_logs.count(), 1)

    def test_listing_must_match_application_company(self):
        response = self.client.post(
            "/api/applications/",
            {"company": self.company.id, "listing_ids": [self.rival_listing.id]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("listing_ids", response.data)

    def test_stage_change_appends_log_and_no_op_does_not(self):
        app = Application.objects.create(user=self.user, company=self.company)
        before = AppsEventLog.objects.filter(application=app).count()

        response = self.client.post(
            f"/api/applications/{app.id}/advance/",
            {"stage": Stage.ONLINE_ASSESSMENT, "note": "Invited to OA"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(AppsEventLog.objects.filter(application=app).count(), before + 1)

        log = AppsEventLog.objects.filter(application=app).latest("changed_at")
        self.assertEqual(log.prev_stage, Stage.APPLIED)
        self.assertEqual(log.curr_stage, Stage.ONLINE_ASSESSMENT)
        self.assertEqual(log.note, "Invited to OA")

        app.refresh_from_db()
        self.assertIsNotNone(app.stage_updated_at)

        # FR-LOG-04 — re-sending the same stage must not write a second row.
        self.client.post(
            f"/api/applications/{app.id}/advance/",
            {"stage": Stage.ONLINE_ASSESSMENT},
            format="json",
        )
        self.assertEqual(AppsEventLog.objects.filter(application=app).count(), before + 1)

    def test_invalid_stage_is_rejected(self):
        app = Application.objects.create(user=self.user, company=self.company)
        response = self.client.post(
            f"/api/applications/{app.id}/advance/", {"stage": "nope"}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_applications_are_scoped_to_the_owner(self):
        Application.objects.create(user=self.other, company=self.company)
        mine = Application.objects.create(user=self.user, company=self.rival)

        response = self.client.get("/api/applications/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row["id"] for row in response.data], [mine.id])

    def test_cannot_attach_another_users_resume(self):
        theirs = Resume.objects.create(user=self.other, label="theirs")
        response = self.client.post(
            "/api/applications/",
            {"company": self.company.id, "resume": theirs.id},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("resume", response.data)

    def test_duplicate_resume_label_per_user_is_rejected(self):
        self.client.post("/api/resumes/", {"label": "EY-vac-2026"}, format="json")
        response = self.client.post(
            "/api/resumes/", {"label": "ey-vac-2026"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("label", response.data)

    def test_filtering_and_ordering(self):
        Application.objects.create(
            user=self.user, company=self.company, stage=Stage.OFFER
        )
        Application.objects.create(
            user=self.user, company=self.rival, stage=Stage.APPLIED
        )

        response = self.client.get("/api/applications/", {"stage": Stage.OFFER})
        self.assertEqual(len(response.data), 1)

        response = self.client.get(
            "/api/applications/", {"ordering": "company__name"}
        )
        self.assertEqual(
            [row["company_name"] for row in response.data], ["EY", "KPMG"]
        )

        response = self.client.get("/api/applications/", {"search": "KPMG"})
        self.assertEqual(len(response.data), 1)

    def test_catalog_ensure_is_idempotent(self):
        first = self.client.post("/api/companies/ensure/", {"name": "Canva"})
        second = self.client.post("/api/companies/ensure/", {"name": "canva"})
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.data["id"], second.data["id"])

    def test_nested_listing_endpoint_rejects_foreign_company(self):
        app = Application.objects.create(user=self.user, company=self.company)
        ok = self.client.post(
            f"/api/applications/{app.id}/listings/",
            {"job_listing": self.listing.id},
            format="json",
        )
        self.assertEqual(ok.status_code, 201, ok.data)

        bad = self.client.post(
            f"/api/applications/{app.id}/listings/",
            {"job_listing": self.rival_listing.id},
            format="json",
        )
        self.assertEqual(bad.status_code, 400)

    def test_per_listing_outcome_can_diverge(self):
        app = Application.objects.create(user=self.user, company=self.company)
        link = ApplicationJobListing.objects.create(
            application=app, job_listing=self.listing, outcome=Outcome.REJECTED
        )
        self.assertEqual(link.effective_outcome, Outcome.REJECTED)

        blank = ApplicationJobListing.objects.create(
            application=app,
            job_listing=JobListing.objects.create(
                company=self.company, role=Role.objects.create(name="Analyst")
            ),
        )
        self.assertEqual(blank.effective_outcome, app.outcome)

    def test_anonymous_access_is_denied(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/applications/").status_code, 401)


class AdvanceResponseTests(APITestCase):
    """The advance response must reflect the row it just wrote."""

    def setUp(self):
        self.user = User.objects.create_user("dave", password="s3cret-pass-123")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")

    def test_advance_response_includes_the_new_event_log(self):
        app = Application.objects.create(user=self.user, company=self.company)
        self.client.post(
            f"/api/applications/{app.id}/advance/",
            {"stage": Stage.ONLINE_ASSESSMENT, "note": "Invited to OA"},
            format="json",
        )
        response = self.client.post(
            f"/api/applications/{app.id}/advance/",
            {"stage": Stage.FINAL_INTERVIEW, "note": "AC passed"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        notes = [log["note"] for log in response.data["event_logs"]]
        self.assertIn("AC passed", notes)
        self.assertEqual(response.data["stage"], Stage.FINAL_INTERVIEW)


class JobListingDetailFieldTests(APITestCase):
    """Description, skill tags, and the LinkedIn marker derived from the
    free-text `source` on applications covering a listing."""

    def setUp(self):
        self.user = User.objects.create_user("dave", password="s3cret-pass-123")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="Atlassian")
        self.role = Role.objects.create(name="Graduate Software Engineer")
        self.listing = JobListing.objects.create(company=self.company, role=self.role)

    def test_skills_are_split_into_tags(self):
        self.listing.skills = "React,  TypeScript , SQL, "
        self.listing.save()
        response = self.client.get(f"/api/job-listings/{self.listing.id}/")
        self.assertEqual(response.data["skills_list"], ["React", "TypeScript", "SQL"])

    def test_description_round_trips(self):
        response = self.client.patch(
            f"/api/job-listings/{self.listing.id}/",
            {"description": "Ship features across the Jira platform."},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.listing.refresh_from_db()
        self.assertEqual(self.listing.description, "Ship features across the Jira platform.")

    def test_linkedin_count_matches_source_case_insensitively(self):
        for source in ("LinkedIn", "linkedin referral", "Seek"):
            application = Application.objects.create(
                user=self.user, company=self.company, source=source
            )
            ApplicationJobListing.objects.create(
                application=application, job_listing=self.listing
            )
        response = self.client.get(f"/api/job-listings/{self.listing.id}/")
        self.assertEqual(response.data["linkedin_application_count"], 2)

    def test_listing_without_linkedin_applications_reports_zero(self):
        response = self.client.get(f"/api/job-listings/{self.listing.id}/")
        self.assertEqual(response.data["linkedin_application_count"], 0)


class DeleteGuardTests(APITestCase):
    """Deleting a Company or JobListing that's still referenced used to
    surface Django's raw ProtectedError as an unhandled 500 — these check the
    friendlier 409 that replaced it, and that an unreferenced row still
    deletes cleanly."""

    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")
        self.role = Role.objects.create(name="Vacationer")
        self.listing = JobListing.objects.create(company=self.company, role=self.role)

    def test_deleting_a_company_with_listings_is_blocked_with_a_clear_message(self):
        response = self.client.delete(f"/api/companies/{self.company.id}/")
        self.assertEqual(response.status_code, 409)
        self.assertIn("job listing", response.data["detail"])
        self.assertTrue(Company.objects.filter(id=self.company.id).exists())

    def test_deleting_an_unreferenced_company_succeeds(self):
        empty = Company.objects.create(name="Unused Co")
        response = self.client.delete(f"/api/companies/{empty.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(Company.objects.filter(id=empty.id).exists())

    def test_deleting_a_company_with_only_applications_is_blocked(self):
        Company.objects.filter(id=self.company.id).update(name="EY2")
        company = Company.objects.create(name="Applied-to Co")
        Application.objects.create(user=self.user, company=company)
        response = self.client.delete(f"/api/companies/{company.id}/")
        self.assertEqual(response.status_code, 409)
        self.assertIn("application", response.data["detail"])

    def test_deleting_a_listing_with_linked_applications_is_blocked(self):
        application = Application.objects.create(user=self.user, company=self.company)
        ApplicationJobListing.objects.create(application=application, job_listing=self.listing)
        response = self.client.delete(f"/api/job-listings/{self.listing.id}/")
        self.assertEqual(response.status_code, 409)
        self.assertTrue(JobListing.objects.filter(id=self.listing.id).exists())

    def test_deleting_an_unreferenced_listing_succeeds(self):
        response = self.client.delete(f"/api/job-listings/{self.listing.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(JobListing.objects.filter(id=self.listing.id).exists())

    def test_the_block_message_names_your_own_application(self):
        application = Application.objects.create(user=self.user, company=self.company)
        ApplicationJobListing.objects.create(application=application, job_listing=self.listing)
        response = self.client.delete(f"/api/job-listings/{self.listing.id}/")
        self.assertIn("your EY application", response.data["detail"])
        self.assertIn("Unlink it", response.data["detail"])

    def test_a_block_from_someone_elses_application_says_so(self):
        """The confusing case: you delete your own applications, the listing
        still won't go, and the old message gave you nothing to act on."""
        other = User.objects.create_user("mallory", password="tracker-pass-9182")
        application = Application.objects.create(user=other, company=self.company)
        ApplicationJobListing.objects.create(application=application, job_listing=self.listing)
        response = self.client.delete(f"/api/job-listings/{self.listing.id}/")
        self.assertEqual(response.status_code, 409)
        detail = response.data["detail"]
        self.assertIn("another account", detail)
        self.assertNotIn("your", detail.split("another account")[0])

    def test_a_listing_blocked_by_both_accounts_reports_each(self):
        other = User.objects.create_user("mallory", password="tracker-pass-9182")
        mine = Application.objects.create(user=self.user, company=self.company)
        theirs = Application.objects.create(user=other, company=self.company)
        ApplicationJobListing.objects.create(application=mine, job_listing=self.listing)
        ApplicationJobListing.objects.create(application=theirs, job_listing=self.listing)
        detail = self.client.delete(f"/api/job-listings/{self.listing.id}/").data["detail"]
        self.assertIn("your EY application", detail)
        self.assertIn("1 application on another account", detail)


class ApplicationListingFilterTests(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")
        self.role = Role.objects.create(name="Vacationer")
        self.listing = JobListing.objects.create(company=self.company, role=self.role)
        self.other_listing = JobListing.objects.create(
            company=self.company, role=Role.objects.create(name="Graduate")
        )

    def test_listing_query_param_filters_to_applications_covering_it(self):
        matching = Application.objects.create(user=self.user, company=self.company)
        ApplicationJobListing.objects.create(application=matching, job_listing=self.listing)
        other = Application.objects.create(user=self.user, company=self.company)
        ApplicationJobListing.objects.create(application=other, job_listing=self.other_listing)

        response = self.client.get("/api/applications/", {"listing": self.listing.id})
        self.assertEqual([row["id"] for row in response.data], [matching.id])


class CompanyNoteTests(APITestCase):
    """A company is shared reference data, but a note about it ("recruiter
    said follow up in March") is one person's private read, not a fact
    everyone tracking that company should see."""

    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.other = User.objects.create_user("mallory", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")

    def test_note_starts_blank(self):
        response = self.client.get(f"/api/companies/{self.company.id}/note/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["notes"], "")

    def test_note_round_trips(self):
        response = self.client.put(
            f"/api/companies/{self.company.id}/note/",
            {"notes": "Recruiter said follow up in March. @SarahChen referred me."},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        response = self.client.get(f"/api/companies/{self.company.id}/note/")
        self.assertIn("follow up in March", response.data["notes"])

    def test_note_is_private_to_each_user(self):
        self.client.put(f"/api/companies/{self.company.id}/note/", {"notes": "Dave's note"})
        self.client.force_authenticate(self.other)
        self.client.put(f"/api/companies/{self.company.id}/note/", {"notes": "Mallory's note"})
        response = self.client.get(f"/api/companies/{self.company.id}/note/")
        self.assertEqual(response.data["notes"], "Mallory's note")

        self.client.force_authenticate(self.user)
        response = self.client.get(f"/api/companies/{self.company.id}/note/")
        self.assertEqual(response.data["notes"], "Dave's note")

    def test_requires_auth(self):
        self.client.force_authenticate(None)
        response = self.client.get(f"/api/companies/{self.company.id}/note/")
        self.assertEqual(response.status_code, 401)


class HistoricalBackfillTests(APITestCase):
    """The historical-logging flow (FR-APP-HIST-*): an application that was
    already resolved before it was entered into the tracker, backdated stage
    by stage rather than every move landing on today."""

    def setUp(self):
        self.user = User.objects.create_user("dave", password="s3cret-pass-123")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")

    def test_backfill_writes_one_dated_row_per_move(self):
        app = Application.objects.create(
            user=self.user, company=self.company, applied_at="2025-03-01"
        )
        response = self.client.post(
            f"/api/applications/{app.id}/backfill/",
            {
                "moves": [
                    {"stage": "online_assessment", "changed_at": "2025-03-15"},
                    {"stage": "video_interview", "changed_at": "2025-04-01"},
                    {
                        "stage": "offer",
                        "outcome": "offer_received",
                        "changed_at": "2025-05-01",
                    },
                ]
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["stage"], "offer")
        self.assertEqual(response.data["outcome"], "offer_received")
        logs = AppsEventLog.objects.filter(application=app).order_by("changed_at")
        self.assertEqual(logs.count(), 3)
        dated = [log.changed_at.date().isoformat() for log in logs if log.curr_stage]
        self.assertIn("2025-03-15", dated)
        self.assertIn("2025-04-01", dated)
        self.assertIn("2025-05-01", dated)

    def test_backfill_supports_revisiting_a_stage(self):
        """Applied -> OA -> interview -> a SECOND OA round -> offer. The
        second OA is a real transition (away from interview), so it logs
        even though the stage value repeats earlier in the sequence."""
        app = Application.objects.create(
            user=self.user, company=self.company, applied_at="2025-03-01"
        )
        self.client.post(
            f"/api/applications/{app.id}/backfill/",
            {
                "moves": [
                    {"stage": "online_assessment", "changed_at": "2025-03-15"},
                    {"stage": "video_interview", "changed_at": "2025-04-01"},
                    {
                        "stage": "online_assessment",
                        "changed_at": "2025-04-20",
                        "note": "Second OA round",
                    },
                    {"stage": "offer", "changed_at": "2025-05-01"},
                ]
            },
            format="json",
        )
        notes = [log.note for log in AppsEventLog.objects.filter(application=app)]
        self.assertIn("Second OA round", notes)
        stage_moves = AppsEventLog.objects.filter(
            application=app, event_type="stage"
        ).count()
        self.assertEqual(stage_moves, 4)

    def test_backfill_rejects_out_of_order_dates(self):
        app = Application.objects.create(
            user=self.user, company=self.company, applied_at="2025-03-01"
        )
        response = self.client.post(
            f"/api/applications/{app.id}/backfill/",
            {
                "moves": [
                    {"stage": "video_interview", "changed_at": "2025-04-01"},
                    {"stage": "online_assessment", "changed_at": "2025-03-15"},
                ]
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_backfill_pulls_the_applied_date_back_to_fit_the_moves(self):
        """A move earlier than the applied date used to be rejected.

        For an application logged retrospectively that was always the normal
        case — you type it in today, so every real move predates the date the
        tracker stamped. The moves are the truth; `applied_at` moves to fit.
        """
        app = Application.objects.create(
            user=self.user, company=self.company, applied_at="2025-06-01"
        )
        response = self.client.post(
            f"/api/applications/{app.id}/backfill/",
            {"moves": [{"stage": "online_assessment", "changed_at": "2025-05-01"}]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        # A week before the assessment, since the assessment isn't the act of
        # applying — see the FIRST_STAGES rule.
        self.assertEqual(response.data["applied_at"], "2025-04-24")
        self.assertTrue(response.data["is_historical"])

    def test_backfill_rejects_invalid_stage(self):
        app = Application.objects.create(user=self.user, company=self.company)
        response = self.client.post(
            f"/api/applications/{app.id}/backfill/",
            {"moves": [{"stage": "not_a_stage", "changed_at": "2025-03-15"}]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_backfill_requires_auth(self):
        self.client.force_authenticate(None)
        app_id = Application.objects.create(user=self.user, company=self.company).id
        response = self.client.post(
            f"/api/applications/{app_id}/backfill/",
            {"moves": [{"stage": "applied", "changed_at": "2025-03-15"}]},
            format="json",
        )
        self.assertEqual(response.status_code, 401)


class IndustryDeleteGuardTests(APITestCase):
    """The same generic destroy() guard, applied to Industry (FR-COMPANY-06):
    it's PROTECTed by the Company M2M, so an in-use industry must 409, not
    silently succeed or 500."""

    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)

    def test_deleting_an_industry_still_tagged_to_a_company_is_blocked(self):
        industry = Industry.objects.create(name="Financial services")
        company = Company.objects.create(name="EY")
        company.industries.add(industry)
        response = self.client.delete(f"/api/industries/{industry.id}/")
        self.assertEqual(response.status_code, 409)
        self.assertIn("1 company", response.data["detail"])
        self.assertTrue(Industry.objects.filter(id=industry.id).exists())

    def test_the_block_message_pluralises_properly(self):
        """A bare "s" turned company into "companys"."""
        industry = Industry.objects.create(name="Consulting")
        for name in ("Deloitte", "PwC"):
            company = Company.objects.create(name=name)
            company.industries.add(industry)
        detail = self.client.delete(f"/api/industries/{industry.id}/").data["detail"]
        self.assertIn("2 companies", detail)
        self.assertNotIn("companys", detail)

    def test_deleting_an_unused_industry_succeeds(self):
        industry = Industry.objects.create(name="Unused Industry")
        response = self.client.delete(f"/api/industries/{industry.id}/")
        self.assertEqual(response.status_code, 204)

    def test_removing_the_tag_unblocks_the_delete(self):
        industry = Industry.objects.create(name="Retail")
        company = Company.objects.create(name="Big W")
        company.industries.add(industry)
        company.industries.remove(industry)
        response = self.client.delete(f"/api/industries/{industry.id}/")
        self.assertEqual(response.status_code, 204)


class CompanyMultipleIndustriesTests(APITestCase):
    """FR-COMPANY-05 — a company can genuinely span more than one industry."""

    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)

    def test_a_company_can_carry_several_industries(self):
        fintech = Industry.objects.create(name="Financial services")
        tech = Industry.objects.create(name="Technology")
        response = self.client.post(
            "/api/companies/ensure/", {"name": "Fintech Bank Co"}, format="json"
        )
        company_id = response.data["id"]
        update = self.client.patch(
            f"/api/companies/{company_id}/",
            {"industries": [fintech.id, tech.id]},
            format="json",
        )
        self.assertEqual(update.status_code, 200, update.data)
        self.assertEqual(set(update.data["industry_names"]), {"Financial services", "Technology"})


class JobListingImportCompanyMatchTests(APITestCase):
    """Importing must find a company by either its long or short name,
    case-insensitively, rather than creating a duplicate under whichever
    name a given ad happened to use."""

    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)

    def test_import_matches_an_existing_company_by_short_name(self):
        Company.objects.create(name="Commonwealth Bank", short_name="CommBank")
        response = self.client.post(
            "/api/job-listings/import_listings/",
            {"listings": [{"company": "CommBank", "role": "Graduate Analyst"}]},
            format="json",
        )
        result = response.data["results"][0]
        self.assertTrue(result["ok"])
        self.assertEqual(Company.objects.filter(name__icontains="Commonwealth").count(), 1)
        self.assertEqual(result["company"], "Commonwealth Bank")

    def test_import_matches_case_insensitively(self):
        Company.objects.create(name="EY")
        response = self.client.post(
            "/api/job-listings/import_listings/",
            {"listings": [{"company": "ey", "role": "Graduate"}]},
            format="json",
        )
        self.assertEqual(Company.objects.filter(name__iexact="ey").count(), 1)
        self.assertTrue(response.data["results"][0]["ok"])

    def test_unmatched_company_is_created_with_a_warning(self):
        response = self.client.post(
            "/api/job-listings/import_listings/",
            {"listings": [{"company": "Totally New Employer", "role": "Analyst"}]},
            format="json",
        )
        result = response.data["results"][0]
        self.assertTrue(any("new one" in w for w in result["warnings"]))
        self.assertTrue(Company.objects.filter(name="Totally New Employer").exists())


class JobListingImportLocationMatchTests(APITestCase):
    """An ad names a city, not a country/state chain — so a city already in
    Places should just attach, instead of warning the user to go do it by
    hand (the same match-what-we-already-have rule the company lookup uses)."""

    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.country = Country.objects.create(name="Australia")
        self.nsw = State.objects.create(country=self.country, name="New South Wales")
        self.sydney = Location.objects.create(state=self.nsw, name="Sydney")
        # Pre-created so the only warning under test is the location one.
        Company.objects.create(name="Bloomberg")

    def _import(self, location):
        return self.client.post(
            "/api/job-listings/import_listings/",
            {"listings": [{"company": "Bloomberg", "role": "Intern", "location": location}]},
            format="json",
        ).data["results"][0]

    def test_a_known_city_is_attached_without_a_warning(self):
        result = self._import("Sydney")
        self.assertTrue(result["ok"])
        listing = JobListing.objects.get(id=result["id"])
        self.assertEqual(listing.location, self.sydney)
        self.assertEqual(result["warnings"], [])

    def test_the_city_match_is_case_insensitive(self):
        result = self._import("sYdNeY")
        self.assertEqual(JobListing.objects.get(id=result["id"]).location, self.sydney)

    def test_an_unknown_city_still_imports_with_a_warning(self):
        result = self._import("Reykjavik")
        self.assertTrue(result["ok"])
        self.assertIsNone(JobListing.objects.get(id=result["id"]).location)
        self.assertTrue(any("isn't in your Places yet" in w for w in result["warnings"]))

    def test_an_ambiguous_city_is_left_for_the_user(self):
        other_state = State.objects.create(country=self.country, name="Victoria")
        Location.objects.create(state=other_state, name="Sydney")
        result = self._import("Sydney")
        self.assertIsNone(JobListing.objects.get(id=result["id"]).location)
        self.assertTrue(any("more than one city" in w for w in result["warnings"]))


class JobListingImportDedupTests(APITestCase):
    """Importing the same posting twice must update the row it already made,
    never leave a second copy — including via `job_url`, which is unique
    table-wide and would otherwise blow up on insert."""

    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.country = Country.objects.create(name="Australia")
        self.nsw = State.objects.create(country=self.country, name="New South Wales")
        self.sydney = Location.objects.create(state=self.nsw, name="Sydney")
        Company.objects.create(name="Bloomberg")

    def _import(self, **overrides):
        row = {"company": "Bloomberg", "role": "Intern", "location": "Sydney"}
        row.update(overrides)
        return self.client.post(
            "/api/job-listings/import_listings/", {"listings": [row]}, format="json"
        ).data["results"][0]

    def test_importing_the_same_listing_twice_updates_one_row(self):
        first = self._import()
        second = self._import()
        self.assertTrue(first["created"])
        self.assertFalse(second["created"])
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(JobListing.objects.count(), 1)

    def test_the_same_job_url_never_creates_a_second_row(self):
        url = "https://example.com/careers/21015"
        first = self._import(job_url=url)
        # Even retitled by a differently-worded AI run, the URL pins it down.
        second = self._import(role="2027 Enterprise Technology Internship", job_url=url)
        self.assertEqual(first["id"], second["id"])
        self.assertEqual(JobListing.objects.count(), 1)

    def test_a_listing_imported_before_city_matching_gets_upgraded(self):
        stale = JobListing.objects.create(
            company=Company.objects.get(name="Bloomberg"),
            role=Role.objects.create(name="Intern"),
            location=None,
        )
        result = self._import()
        self.assertEqual(result["id"], stale.id)
        stale.refresh_from_db()
        self.assertEqual(stale.location, self.sydney)
        self.assertEqual(JobListing.objects.count(), 1)

    def test_a_long_skills_list_imports_intact(self):
        """A real ad's requirements section runs well past the old 500-char
        cap — which the database rejected outright, surfacing as a bare 500."""
        skills = [
            "University enrolment",
            "Graduation between November 2026 and December 2027",
            "Availability for 10-week internship",
            "Australian full-time work rights",
            "Information Systems",
            "Computer Science",
            "Engineering",
            "Finance",
            "Economics",
            "Business",
            "STEM",
            "Programming",
            "Python",
            "SQL",
            "Data Analytics",
            "Customer service",
            "Client support",
            "Financial markets",
            "Financial asset classes",
            "Financial products",
            "Problem solving",
            "Analytical skills",
            "Technology",
            "Connectivity",
            "Automation",
            "Written communication",
            "Verbal communication",
            "Technical communication",
            "Network troubleshooting",
            "Connectivity troubleshooting",
            "Messaging troubleshooting",
            "FIX",
            "MQ",
            "TCP/IP",
            "API",
            "IT Service Management",
            "Client relationship management",
            "Web API",
            "Data visualization",
            "Qlik Sense",
            "Tableau",
            "Power BI",
        ]
        self.assertGreater(len(", ".join(skills)), 500)
        result = self._import(skills=skills)
        self.assertTrue(result["ok"], result)
        listing = JobListing.objects.get(id=result["id"])
        self.assertEqual(listing.skills, ", ".join(skills))

    def test_the_same_role_in_two_cities_stays_two_listings(self):
        melbourne_state = State.objects.create(country=self.country, name="Victoria")
        Location.objects.create(state=melbourne_state, name="Melbourne")
        self._import(location="Sydney")
        self._import(location="Melbourne")
        self.assertEqual(JobListing.objects.count(), 2)


class VenueCatalogTests(APITestCase):
    """A venue is a place more specific than a city — "The Pillars, Wynyard"
    rather than just "Sydney" — but still rolls up to a full country/state/
    city chain, and a city can't be deleted out from under one."""

    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.country = Country.objects.create(name="Australia")
        self.state = State.objects.create(country=self.country, name="New South Wales")
        self.city = Location.objects.create(state=self.state, name="Sydney")

    def test_creating_a_venue_carries_the_full_hierarchy(self):
        response = self.client.post(
            "/api/venues/ensure/", {"name": "The Pillars, Wynyard", "location": self.city.id},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["location_name"], "Sydney")
        self.assertEqual(response.data["state_name"], "New South Wales")
        self.assertEqual(response.data["country_name"], "Australia")
        self.assertEqual(
            response.data["full_name"], "The Pillars, Wynyard, Sydney, New South Wales, Australia"
        )

    def test_venue_names_are_unique_per_city_not_globally(self):
        other_city = Location.objects.create(state=self.state, name="Newcastle")
        self.client.post("/api/venues/ensure/", {"name": "The Grounds", "location": self.city.id}, format="json")
        response = self.client.post(
            "/api/venues/ensure/", {"name": "The Grounds", "location": other_city.id}, format="json"
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Venue.objects.filter(name="The Grounds").count(), 2)

    def test_ensure_is_idempotent_within_the_same_city(self):
        first = self.client.post(
            "/api/venues/ensure/", {"name": "The Pillars", "location": self.city.id}, format="json"
        )
        second = self.client.post(
            "/api/venues/ensure/", {"name": "the pillars", "location": self.city.id}, format="json"
        )
        self.assertEqual(first.data["id"], second.data["id"])
        self.assertEqual(Venue.objects.count(), 1)

    def test_deleting_a_city_still_holding_a_venue_is_blocked(self):
        Venue.objects.create(location=self.city, name="The Pillars")
        response = self.client.delete(f"/api/locations/{self.city.id}/")
        self.assertEqual(response.status_code, 409)
        self.assertIn("venue", response.data["detail"])
        self.assertTrue(Location.objects.filter(id=self.city.id).exists())

    def test_deleting_the_venue_unblocks_the_city(self):
        venue = Venue.objects.create(location=self.city, name="The Pillars")
        venue.delete()
        response = self.client.delete(f"/api/locations/{self.city.id}/")
        self.assertEqual(response.status_code, 204)

    def test_venues_list_filters_by_location(self):
        other_city = Location.objects.create(state=self.state, name="Newcastle")
        Venue.objects.create(location=self.city, name="The Pillars")
        Venue.objects.create(location=other_city, name="Some Other Bar")
        response = self.client.get(f"/api/venues/?location={self.city.id}")
        self.assertEqual([row["name"] for row in response.data], ["The Pillars"])


class ApplicationStageCatalogTests(APITestCase):
    """Pipelines differ between employers — a phone screen here, a take-home
    there — so the stage list is addable rather than the fixed seven."""

    def setUp(self):
        self.user = User.objects.create_user("dave", password="tracker-pass-9182")
        self.client.force_authenticate(self.user)
        self.company = Company.objects.create(name="EY")

    def test_presets_are_seeded_in_pipeline_order(self):
        response = self.client.get("/api/application-stages/")
        self.assertEqual(
            [row["key"] for row in response.data],
            [
                "not_submitted", "applied", "online_assessment", "video_interview",
                "assessment_centre", "final_interview", "offer", "missed_deadline",
            ],
        )
        self.assertTrue(all(row["is_preset"] for row in response.data))

    def test_adding_a_stage_derives_a_key_and_lands_before_the_last(self):
        response = self.client.post(
            "/api/application-stages/ensure/", {"name": "Phone Interview"}, format="json"
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["key"], "phone_interview")
        self.assertFalse(response.data["is_preset"])

        order = [row["key"] for row in self.client.get("/api/application-stages/").data]
        # Just before the last preset ("Missed Deadline") — another round in
        # the funnel, not past the end.
        self.assertEqual(order[-2:], ["phone_interview", "missed_deadline"])

    def test_ensure_is_idempotent_by_name(self):
        first = self.client.post(
            "/api/application-stages/ensure/", {"name": "Take-Home Assessment"}, format="json"
        )
        second = self.client.post(
            "/api/application-stages/ensure/", {"name": "take-home assessment"}, format="json"
        )
        self.assertEqual(first.data["id"], second.data["id"])
        self.assertEqual(ApplicationStage.objects.filter(name__iexact="take-home assessment").count(), 1)

    def test_an_application_can_move_to_a_custom_stage(self):
        stage = self.client.post(
            "/api/application-stages/ensure/", {"name": "Take-Home Assessment"}, format="json"
        ).data
        application = Application.objects.create(user=self.user, company=self.company)
        response = self.client.post(
            f"/api/applications/{application.id}/advance/",
            {"stage": stage["key"], "note": "48h to submit"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["stage"], "take_home_assessment")
        # The name resolves through the catalog, not Django's enum fallback.
        self.assertEqual(response.data["stage_display"], "Take-Home Assessment")

    def test_an_unknown_stage_is_still_rejected(self):
        application = Application.objects.create(user=self.user, company=self.company)
        response = self.client.post(
            f"/api/applications/{application.id}/advance/", {"stage": "nope"}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_backfill_accepts_a_custom_stage(self):
        stage = self.client.post(
            "/api/application-stages/ensure/", {"name": "Phone Interview"}, format="json"
        ).data
        application = Application.objects.create(
            user=self.user, company=self.company, applied_at="2026-01-01"
        )
        response = self.client.post(
            f"/api/applications/{application.id}/backfill/",
            {"moves": [{"stage": stage["key"], "changed_at": "2026-02-01"}]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["stage"], "phone_interview")

    def test_the_event_log_names_a_custom_stage(self):
        stage = self.client.post(
            "/api/application-stages/ensure/", {"name": "Phone Interview"}, format="json"
        ).data
        application = Application.objects.create(user=self.user, company=self.company)
        self.client.post(
            f"/api/applications/{application.id}/advance/",
            {"stage": stage["key"]}, format="json",
        )
        logs = self.client.get(f"/api/applications/{application.id}/").data["event_logs"]
        self.assertIn("Phone Interview", [log["curr_stage_display"] for log in logs])

    def test_choices_offers_custom_stages_to_the_pickers(self):
        self.client.post(
            "/api/application-stages/ensure/", {"name": "Phone Interview"}, format="json"
        )
        stages = self.client.get("/api/applications/choices/").data["stage"]
        self.assertIn("phone_interview", [row["value"] for row in stages])
        self.assertIn("Phone Interview", [row["label"] for row in stages])

    def test_a_preset_cannot_be_deleted(self):
        preset = ApplicationStage.objects.get(key="offer")
        response = self.client.delete(f"/api/application-stages/{preset.id}/")
        self.assertEqual(response.status_code, 409)
        self.assertIn("built-in", response.data["detail"])
        self.assertTrue(ApplicationStage.objects.filter(id=preset.id).exists())

    def test_a_stage_still_in_use_cannot_be_deleted(self):
        stage = self.client.post(
            "/api/application-stages/ensure/", {"name": "Phone Interview"}, format="json"
        ).data
        Application.objects.create(
            user=self.user, company=self.company, stage=stage["key"]
        )
        response = self.client.delete(f"/api/application-stages/{stage['id']}/")
        self.assertEqual(response.status_code, 409)
        self.assertIn("1 application", response.data["detail"])

    def test_an_unused_custom_stage_deletes(self):
        stage = self.client.post(
            "/api/application-stages/ensure/", {"name": "Phone Interview"}, format="json"
        ).data
        response = self.client.delete(f"/api/application-stages/{stage['id']}/")
        self.assertEqual(response.status_code, 204)

    def test_a_preset_can_still_be_renamed(self):
        preset = ApplicationStage.objects.get(key="assessment_centre")
        response = self.client.patch(
            f"/api/application-stages/{preset.id}/", {"name": "Superday"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        preset.refresh_from_db()
        # The key is what rows store, so renaming must not move existing data.
        self.assertEqual(preset.key, "assessment_centre")
        self.assertEqual(preset.name, "Superday")

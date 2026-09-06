# Imports
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

#Models Code
'''
User
 ├── Connections / Person (linkedin, email, phone, instagram, etc.)
 │    ├── status: lead | connection | archived | ghosted
 │    ├── relationship:
 │    │    mentor | alumni | classmate | colleague | manager |
 │    │    recruiter | interviewer | industry_contact | academic | other
 │    ├── source:
 │    │    university_event | professional_event | internship |
 │    │    workplace | class | referral | linkedin | other
 │    ├── last_meeting_at: date (nullable) — last coffee chat / meetup held
 │    ├── next_chat_at: date (nullable) — next scheduled catch-up
 │    │    Rule: if next_chat_at is blank and last_meeting_at is set,
 │    │    default next_chat_at = last_meeting_at + 3 months (cadence reminder).
 │    │    If user sets next_chat_at explicitly, keep that (do not overwrite).
 │    ├── companies: M2M → Company
 │    ├── applications: M2M → Application (optional)
 │    └── ContactMethod (many)
 │         ├── channel: linkedin | email | whatsapp | phone | …
 │         ├── value: URL / handle / address
 │         └── is_preferred: bool
 
 ├── Resume (global library; optional target companies/roles)
 └── Application
      ├── Company: exactly one
      ├── Resume: optional FK into library
      ├── ApplicationEventLog: many
      └── ApplicationJobListing: many
             └── JobListing
                  ├── Company
                  ├── Role
                  └── Location
                       └── State
                            └── Country
'''
# ENUMS 
class Stage(models.TextChoices):
    NOT_SUBMITTED = "not_submitted", "Not submitted"
    APPLIED = "applied", "Applied"
    ONLINE_ASSESSMENT = "online_assessment", "Online assessment"
    VIDEO_INTERVIEW = "video_interview", "Video interview"
    ASSESSMENT_CENTRE = "assessment_centre", "Assessment centre"
    FINAL_INTERVIEW = "final_interview", "Final interview"
    OFFER = "offer", "Offer"
class Outcome(models.TextChoices):
    IN_PROGRESS = "in_progress", "In progress"
    REJECTED = "rejected", "Rejected"
    OFFER_RECEIVED = "offer_received", "Offer received"
    ACCEPTED = "accepted", "Accepted"
    DECLINED = "declined", "Declined"
    WITHDRAWN = "withdrawn", "Withdrawn"
    GHOSTED = "ghosted", "Ghosted"
class RoleType(models.TextChoices):
    VACATIONER = "vacationer", "Vacationer / Internship"
    GRADUATE = "graduate", "Graduate"
    UNDERGRADUATE = "undergraduate", "Undergraduate"
    SIDE_JOB = "side_job", "Side job"
class WorkArrangement(models.TextChoices):
    FULL_TIME = "full_time", "Full-time"
    PART_TIME = "part_time", "Part-time"
    CASUAL = "casual", "Casual"
    CONTRACT = "contract", "Contract"
class ResumeVariantType(models.TextChoices):
    GENERAL = "general", "General"
    COMPANY = "company", "Company-specific"
    ROLE = "role", "Role-specific"

###Location/country/state
class Country(models.Model):
    name = models.CharField(max_length=255, unique=True)
    class Meta:
        verbose_name_plural = "countries"
        ordering = ["name"]

    def __str__(self):
        return self.name

class State(models.Model):
    country = models.ForeignKey(Country, on_delete=models.PROTECT, related_name="states")
    name = models.CharField(max_length=255)

    class Meta:
        ordering = ["country__name", "name"]
        constraints = [
            models.UniqueConstraint(fields=["country", "name"], name="uniq_state_per_country")
        ]

    def __str__(self):
        return f"{self.name}, {self.country.name}"



class Location(models.Model):
    state = models.ForeignKey(State, on_delete=models.PROTECT, related_name="locations")
    name = models.CharField(max_length=255)

    class Meta:
        ordering = ["state__name", "name"]
        constraints = [
            models.UniqueConstraint(fields=["state", "name"], name="uniq_location_per_state")
        ]

    def __str__(self):
        return f"{self.name}, {self.state.name}"

    @property
    def country(self):
        return self.state.country


#Companies & Job Listings/Roles
class Industry(models.Model):
    name = models.CharField(max_length=255, unique=True)
    class Meta:
        verbose_name_plural = "industries"
        ordering = ["name"]

    def __str__(self):
        return self.name

class Company(models.Model):
    name = models.CharField(max_length=255)
    industry = models.ForeignKey(
            Industry, on_delete=models.SET_NULL, null=True, blank=True, related_name="companies"
        )

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "companies"
        constraints = [
            models.UniqueConstraint(fields=["name"], name="uniq_company_name")
        ]

    def __str__(self):
        return self.name

class Role(models.Model):
    name = models.CharField(max_length=150, unique=True)
    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class Resume(models.Model):
    """User's resume library. Applications point here for resume reference."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="resumes"
    )
    label = models.CharField(max_length=100)
    variant_type = models.CharField(
        max_length=20,
        choices=ResumeVariantType.choices,
        default=ResumeVariantType.GENERAL,
    )
    target_companies = models.ManyToManyField(
        Company, blank=True, related_name="tailored_resumes"
    )
    target_roles = models.ManyToManyField(
        Role, blank=True, related_name="tailored_resumes"
    )
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-updated_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "label"], name="uniq_resume_label_per_user"
            ),
            models.CheckConstraint(
                condition=models.Q(
                    variant_type__in=[c[0] for c in ResumeVariantType.choices]
                ),
                name="valid_resume_variant_type",
            ),
        ]

    def __str__(self):
        return self.label


class JobListing(models.Model):
    """ specific job posting: this role, at this company, in this location, this intake."""

    company = models.ForeignKey(Company, on_delete=models.PROTECT, related_name="listings")
    role = models.ForeignKey(Role, on_delete=models.PROTECT, related_name="listings")
    location = models.ForeignKey(
        Location, on_delete=models.PROTECT, null=True, blank=True, related_name="listings"
    )
    role_type = models.CharField(max_length=50, choices=RoleType.choices, blank=True)
    work_arrangement = models.CharField(
        max_length=50, choices=WorkArrangement.choices, blank=True
    )
    opened_at = models.DateField(null=True, blank=True)
    closing_at = models.DateField(null=True, blank=True)
    job_url = models.URLField(max_length=255, unique=True, null=True, blank=True)

    class Meta:
        ordering = ["company__name", "role__name"]
        constraints = [
            models.UniqueConstraint(
                fields=["company", "role", "location", "opened_at"], name="uniq_job_listing"
            ),
            models.CheckConstraint(
                condition=models.Q(role_type__in=[c[0] for c in RoleType.choices])
                | models.Q(role_type=""),
                name="valid_role_type",
            ),
            models.CheckConstraint(
                condition=models.Q(
                    work_arrangement__in=[c[0] for c in WorkArrangement.choices]
                )
                | models.Q(work_arrangement=""),
                name="valid_work_arrangement",
            ),
        ]

    def __str__(self):
        return f"{self.role.name} @ {self.company.name} - {self.location.name}"

# error handling
    def clean(self):
        if self.opened_at and self.closing_at and self.closing_at < self.opened_at:
            raise ValidationError({"closing_at": "Closing date cannot precede opening date."})

##users & apps
# class User(models.Model):
#     name = models.CharField(max_length=255)
#     email = models.EmailField(unique=True)
#     password = models.CharField(max_length=100)
#     created_at = models.DateTimeField(auto_now_add=True)
#     updated_at = models.DateTimeField(auto_now=True)

#     def __str__(self):
#         return self.name

class Application(models.Model):
    """One Application submission. May cover several job listings at the same company. """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="applications"
    )
    company = models.ForeignKey(Company, on_delete=models.PROTECT, related_name="applications")
    listings = models.ManyToManyField(
        JobListing, through="ApplicationJobListing", related_name="applications"
    )

    stage = models.CharField(max_length=50, choices=Stage.choices, default=Stage.APPLIED)
    outcome = models.CharField(
        max_length=50, choices=Outcome.choices, default=Outcome.IN_PROGRESS
    )

    applied_at = models.DateField(default=timezone.localdate)
    source = models.CharField(max_length=100, blank=True)
    resume = models.ForeignKey(
        Resume,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="applications",
    )
    # Temporary fallback until existing rows are backfilled into Resume.
    resume_version = models.CharField(max_length=100, blank=True)
    follow_up_date = models.DateField(null=True, blank=True)
    stage_updated_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-applied_at", "company__name"]
        indexes = [
            models.Index(fields=["user", "company", "applied_at"]),
            models.Index(fields=["stage"]),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(stage__in=[c[0] for c in Stage.choices]),
                name="valid_stage",
            ),
            models.CheckConstraint(
                condition=models.Q(outcome__in=[c[0] for c in Outcome.choices]),
                name="valid_outcome",
            ),
        ]

    def __str__(self):
        return f"{self.company.name} — {self.get_stage_display()} ({self.applied_at})"

    def clean(self):
        """Every linked listing must belong to this application's company.

        Not expressible as a DB constraint across the junction table.
        """
        errors = {}
        if self.resume_id and self.user_id and self.resume.user_id != self.user_id:
            errors["resume"] = "Resume must belong to the same user as the application."
        if self.pk and self.listings.exclude(company_id=self.company_id).exists():
            errors["listings"] = (
                "All linked job listings must belong to this application's company."
            )
        if errors:
            raise ValidationError(errors)

    def recompute_outcome(self, commit=True):
        """Roll up per-role outcomes. Offer beats in-progress beats rejected."""
        outcomes = [link.outcome for link in self.listing_links.all() if link.outcome]
        if not outcomes:
            return

        for winner in (
            Outcome.ACCEPTED,
            Outcome.OFFER_RECEIVED,
            Outcome.IN_PROGRESS,
            Outcome.DECLINED,
            Outcome.WITHDRAWN,
        ):
            if winner in outcomes:
                self.outcome = winner
                break
        else:
            self.outcome = Outcome.REJECTED

        if commit:
            self.save(update_fields=["outcome", "updated_at"])


class ApplicationJobListing(models.Model):
    """Junction: which listings this application covers.

    `outcome` blank means the role follows the parent application's outcome.
    Set it only when results diverge.
    """

    application = models.ForeignKey(
        Application, on_delete=models.CASCADE, related_name="listing_links"
    )
    job_listing = models.ForeignKey(
        JobListing, on_delete=models.PROTECT, related_name="application_links"
    )
    outcome = models.CharField(
        max_length=50,
        choices=Outcome.choices,
        blank=True,
        help_text="Leave blank unless this role's result differs from the application.",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["application", "job_listing"], name="uniq_application_listing"
            ),
            models.CheckConstraint(
                condition=models.Q(outcome__in=[c[0] for c in Outcome.choices])
                | models.Q(outcome=""),
                name="valid_role_outcome",
            ),
        ]

    def __str__(self):
        return f"{self.application} → {self.job_listing}"

    @property
    def effective_outcome(self):
        return self.outcome or self.application.outcome


class AppsEventLog(models.Model):
    """Append-only audit log of stage transitions. Never update or delete rows."""

    application = models.ForeignKey(
        Application, on_delete=models.CASCADE, related_name="event_logs"
    )
    prev_stage = models.CharField(max_length=50, choices=Stage.choices, blank=True)
    curr_stage = models.CharField(max_length=50, choices=Stage.choices)
    prev_outcome = models.CharField(max_length=50, choices=Outcome.choices, blank=True)
    curr_outcome = models.CharField(max_length=50, choices=Outcome.choices)
    changed_at = models.DateTimeField(default=timezone.now)
    note = models.TextField(blank=True)

    class Meta:
        ordering = ["application", "changed_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["application", "changed_at"], name="uniq_event_per_app_time"
            )
        ]

    def __str__(self):
        return f"{self.application_id}: {self.prev_stage or '—'} → {self.curr_stage}"

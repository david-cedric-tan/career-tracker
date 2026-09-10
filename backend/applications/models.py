# Imports
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone
from django.utils.text import slugify

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
class ApplicationStage(models.Model):
    """The pipeline's steps — addable, not a fixed list (FR-REF-07).

    `Application.stage` and the event log keep storing the *key* as a plain
    string rather than pointing here with a foreign key. An event log is a
    historical record: renaming or removing a stage today shouldn't rewrite
    what happened last March, and a backup export stays readable without a
    join. This table is the authoritative list of what you can move *to*, and
    `position` is the order the pipeline is drawn and ranked in.
    """

    key = models.SlugField(max_length=50, unique=True)
    name = models.CharField(max_length=50)
    position = models.PositiveSmallIntegerField(default=0)
    # The seven the app ships with. Renameable and reorderable, but not
    # deletable — the pipeline always keeps a spine.
    is_preset = models.BooleanField(default=False)

    class Meta:
        ordering = ["position", "id"]

    def __str__(self):
        return self.name

    def save(self, *args, **kwargs):
        creating = self.pk is None
        if not self.key:
            base = slugify(self.name).replace("-", "_")[:50] or "stage"
            # Two differently-punctuated names can slugify the same way, and
            # `key` is what rows are stored under — so it has to be unique
            # even when the names only differ cosmetically.
            key = base
            suffix = 2
            taken = ApplicationStage.objects.exclude(pk=self.pk)
            while taken.filter(key=key).exists():
                key = f"{base[:46]}_{suffix}"
                suffix += 1
            self.key = key

        if not creating:
            return super().save(*args, **kwargs)

        # Position is server-assigned on create. A new stage is almost always
        # another round in the funnel — a phone screen, a take-home — so it
        # slots in just before the last one ("Offer" out of the box) rather
        # than after it, which would place it past the finish line in the
        # pipeline chart and in the progress ranking.
        #
        # Done here rather than in the viewset because `ensure/` saves the
        # serializer directly and never reaches `perform_create`.
        last = ApplicationStage.objects.order_by("-position", "-id").first()
        if last is None:
            self.position = 0
            return super().save(*args, **kwargs)

        self.position = last.position
        super().save(*args, **kwargs)
        ApplicationStage.objects.filter(position__gte=self.position).exclude(
            pk=self.pk
        ).update(position=models.F("position") + 1)


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
class EventType(models.TextChoices):
    """What a log row represents. Stage/outcome moves stay distinguishable from
    ordinary field edits so the dashboard time series can keep counting only
    real pipeline movement."""

    CREATED = "created", "Created"
    STAGE = "stage", "Stage change"
    OUTCOME = "outcome", "Outcome change"
    EDITED = "edited", "Edited"


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


class Venue(models.Model):
    """A specific place within a city — "The Pillars, Wynyard" rather than
    just "Sydney" — for when a city isn't precise enough. Kept separate from
    Location (which stays purely city-level) so every existing city-only
    consumer — job listings, the region map, company HQ — keeps working
    unchanged; a venue is an additional, more precise option wherever "where"
    is asked, not a replacement for the city catalog.
    """

    location = models.ForeignKey(Location, on_delete=models.PROTECT, related_name="venues")
    name = models.CharField(max_length=255)

    class Meta:
        ordering = ["location__name", "name"]
        constraints = [
            models.UniqueConstraint(fields=["location", "name"], name="uniq_venue_per_location")
        ]

    def __str__(self):
        return f"{self.name}, {self.location.name}"

    @property
    def state(self):
        return self.location.state

    @property
    def country(self):
        return self.location.state.country


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
    # A shorter display name for long official names ("International Business
    # Machines" -> "IBM") — falls back to `name` wherever it's blank.
    short_name = models.CharField(max_length=60, blank=True)
    # A company can genuinely span more than one (e.g. a bank's tech arm is
    # both Financial services and Technology) — same call as `regions` below:
    # a company appears in every ring/filter it actually belongs to, not one
    # arbitrarily-picked "primary" industry.
    industries = models.ManyToManyField(Industry, blank=True, related_name="companies")
    # Shared reference data, like the name — one logo per company, not per user.
    logo = models.ImageField(upload_to="companies/", null=True, blank=True)
    # Where this company operates — optional, and separate from JobListing's
    # precise city/state/country: a listing's location is often left blank,
    # so this is the reliable source for the dashboard's region map.
    regions = models.ManyToManyField(Country, blank=True, related_name="companies_in_region")

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "companies"
        constraints = [
            models.UniqueConstraint(fields=["name"], name="uniq_company_name")
        ]

    def __str__(self):
        return self.name


class CompanyNote(models.Model):
    """A user's own private notes on a company.

    Company itself is shared reference data (logo, name, regions all visible
    to everyone who tracks it) — but "recruiter said follow up in March" is
    one person's private read, not a fact about the company everyone should
    see. Kept as its own side table rather than a field on Company so it can
    be user-scoped without dragging user-scoping onto the shared row.
    """

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="company_notes"
    )
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name="user_notes")
    notes = models.TextField(blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "company"], name="uniq_company_note_per_user")
        ]

    def __str__(self):
        return f"{self.user} — {self.company.name}"


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

    # The actual document. Stored under a suffixed name, so `file_name` keeps
    # what the user called it for display and download.
    file = models.FileField(upload_to="resumes/", null=True, blank=True)
    file_name = models.CharField(max_length=255, blank=True)

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
    description = models.TextField(blank=True)
    # Comma-separated — deliberately not a M2M catalog like Role/Location:
    # skills are free-form per-listing tags, not shared reference data.
    # Unbounded like `description`: a real ad's requirements section routinely
    # yields 40+ tags, which a 500-char cap rejected outright at the DB level.
    skills = models.TextField(blank=True)

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
    # FR-APP-REJ-02 — a reminder to reapply (e.g. next year's graduate intake).
    # Deliberately not restricted to a particular outcome: a withdrawn or
    # declined application can just as reasonably want a future reminder.
    reapply_at = models.DateField(null=True, blank=True)
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
            # No CheckConstraint on `stage`: the valid set lives in
            # ApplicationStage now and grows when you add one, which a
            # constraint baked from the enum at migration time can't follow.
            # The API validates against that table instead.
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
    """Append-only audit log for an application. Never update or delete rows.

    Covers stage/outcome transitions *and* ordinary field edits, so the
    application's history is the whole story rather than only its pipeline
    movement. `event_type` keeps the two apart for the dashboard.
    """

    application = models.ForeignKey(
        Application, on_delete=models.CASCADE, related_name="event_logs"
    )
    event_type = models.CharField(
        max_length=20, choices=EventType.choices, default=EventType.EDITED
    )
    prev_stage = models.CharField(max_length=50, choices=Stage.choices, blank=True)
    curr_stage = models.CharField(max_length=50, choices=Stage.choices)
    prev_outcome = models.CharField(max_length=50, choices=Outcome.choices, blank=True)
    curr_outcome = models.CharField(max_length=50, choices=Outcome.choices)
    # Field-level diff for this save: [{field, label, from, to}, …]. Empty for a
    # pure stage move; populated whenever other fields moved in the same save.
    changes = models.JSONField(default=list, blank=True)
    changed_at = models.DateTimeField(default=timezone.now)
    note = models.TextField(blank=True)

    class Meta:
        ordering = ["application", "changed_at"]
        constraints = [
            models.UniqueConstraint(
                fields=["application", "changed_at"], name="uniq_event_per_app_time"
            ),
            models.CheckConstraint(
                condition=models.Q(event_type__in=[c[0] for c in EventType.choices]),
                name="valid_event_type",
            ),
        ]

    def __str__(self):
        return f"{self.application_id} {self.get_event_type_display()} @ {self.changed_at}"

    def __str__(self):
        return f"{self.application_id}: {self.prev_stage or '—'} → {self.curr_stage}"

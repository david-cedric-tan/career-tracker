"""Populate one account with realistic data so the dashboard has something to show.

    python manage.py seed_demo --username demo --password demo-pass-1234

Idempotent: re-running refreshes the same user's demo rows rather than piling
up duplicates.
"""

import random
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from applications.models import (
    Application,
    ApplicationJobListing,
    Company,
    Country,
    Industry,
    JobListing,
    Location,
    Outcome,
    Resume,
    Role,
    RoleType,
    Stage,
    State,
    WorkArrangement,
)
from applications.services import log_creation, log_transition
from accounts.models import (
    Certification,
    Education,
    Experience,
    ExtraCurricular,
    Profile,
    ProfileAddress,
    ProfileLink,
)
from catchups.models import Catchup, CatchupFormat
from network.models import ContactMethod, MetSourceTag, Person, PersonStatus, RelationshipTag
from todos.models import Priority, Todo, TodoStatus

User = get_user_model()

COMPANIES = [
    ("EY", "Professional services"),
    ("KPMG", "Professional services"),
    ("Canva", "Technology"),
    ("Atlassian", "Technology"),
    ("Macquarie", "Financial services"),
    ("Commonwealth Bank", "Financial services"),
    ("Telstra", "Telecommunications"),
]

ROLES = [
    "Vacationer — Technology Consulting",
    "Vacationer — Audit",
    "Software Engineer Intern",
    "Data Analyst Intern",
    "Graduate Software Engineer",
    "Product Analyst",
]

LOCATIONS = [
    ("Australia", "New South Wales", "Sydney"),
    ("Australia", "Victoria", "Melbourne"),
    ("Australia", "Queensland", "Brisbane"),
]

PIPELINE = [
    ("EY", Stage.ASSESSMENT_CENTRE, Outcome.IN_PROGRESS, 34),
    ("KPMG", Stage.ONLINE_ASSESSMENT, Outcome.IN_PROGRESS, 21),
    ("Canva", Stage.FINAL_INTERVIEW, Outcome.IN_PROGRESS, 45),
    ("Atlassian", Stage.OFFER, Outcome.OFFER_RECEIVED, 60),
    ("Macquarie", Stage.APPLIED, Outcome.REJECTED, 52),
    ("Commonwealth Bank", Stage.VIDEO_INTERVIEW, Outcome.IN_PROGRESS, 12),
    ("Telstra", Stage.APPLIED, Outcome.GHOSTED, 75),
]

PEOPLE = [
    ("Sarah Chen", "Senior Consultant", "EY", PersonStatus.CONNECTION,
     "Alumni", "University event", 90,
     [("linkedin", "https://linkedin.com/in/sarahchen", True),
      ("email", "sarah.chen@example.com", False)]),
    ("Marcus Webb", "Talent Partner", "Canva", PersonStatus.CONNECTION,
     "Recruiter", "LinkedIn", 30,
     [("linkedin", "https://linkedin.com/in/marcuswebb", True)]),
    ("Priya Nair", "Engineering Manager", "Atlassian", PersonStatus.CONNECTION,
     "Mentor", "Professional event", 120,
     [("email", "priya.nair@example.com", True),
      ("whatsapp", "+61 400 000 111", False)]),
    ("Tom Alvarez", "Analyst", "Macquarie", PersonStatus.LEAD,
     "Classmate", "Class", None,
     [("instagram", "@tomalv", True)]),
    ("Jess Nguyen", "Audit Manager", "KPMG", PersonStatus.LEAD,
     "Industry Contact", "Referral", 200,
     [("linkedin", "https://linkedin.com/in/jessnguyen", True)]),
    ("Daniel Okoro", "Grad Recruiter", "Telstra", PersonStatus.GHOSTED,
     "Recruiter", "LinkedIn", 160, []),
    # Several contacts at the same company, so the network bubble view shows a
    # real hub-and-spoke rather than a row of lonely pairs.
    ("Amara Osei", "Assurance Partner", "EY", PersonStatus.CONNECTION,
     "Mentor", "Workplace", 45,
     [("email", "amara.osei@example.com", True)]),
    ("Liam Fitzgerald", "Vacationer Alum", "EY", PersonStatus.CONNECTION,
     "Alumni", "University event", 20,
     [("linkedin", "https://linkedin.com/in/liamfitz", True)]),
    ("Hana Kimura", "Graduate Analyst", "EY", PersonStatus.LEAD,
     "Industry Contact", "Professional event", None,
     [("linkedin", "https://linkedin.com/in/hanakimura", True)]),
    ("Ben Carter", "Design Lead", "Canva", PersonStatus.CONNECTION,
     "Industry Contact", "Professional event", 75,
     [("email", "ben.carter@example.com", True)]),
    ("Noor Haddad", "Engineering Manager", "Canva", PersonStatus.LEAD,
     "Interviewer", "Referral", 15,
     [("linkedin", "https://linkedin.com/in/noorhaddad", True)]),
    ("Ravi Menon", "Principal Engineer", "Atlassian", PersonStatus.CONNECTION,
     "Mentor", "Workplace", 55,
     [("email", "ravi.menon@example.com", True)]),
]

# A contact can sit at more than one company — the bubble view puts them in
# every ring they belong to rather than picking one arbitrarily.
EXTRA_COMPANIES = {"Priya Nair": ["Canva"]}


class Command(BaseCommand):
    help = "Seed a demo account with applications, network contacts and todos."

    def add_arguments(self, parser):
        parser.add_argument("--username", default="demo")
        parser.add_argument("--password", default="demo-pass-1234")
        parser.add_argument("--email", default="demo@example.com")

    @transaction.atomic
    def handle(self, *args, **options):
        random.seed(7)
        today = timezone.localdate()

        user, created = User.objects.get_or_create(
            username=options["username"], defaults={"email": options["email"]}
        )
        user.set_password(options["password"])
        user.first_name = user.first_name or "Demo"
        user.last_name = user.last_name or "Applicant"
        user.save()

        profile = Profile.for_user(user)
        profile.mobile_number = profile.mobile_number or "0400 123 456"
        profile.linkedin_url = profile.linkedin_url or "https://linkedin.com/in/demo-applicant"
        profile.school_email = profile.school_email or "demo.applicant@uni.edu"
        profile.save()

        # Wipe only this user's demo rows so re-running stays idempotent.
        Todo.objects.filter(user=user).delete()
        Catchup.objects.filter(user=user).delete()
        Experience.objects.filter(user=user).delete()
        Education.objects.filter(user=user).delete()
        Certification.objects.filter(user=user).delete()
        ExtraCurricular.objects.filter(user=user).delete()
        ProfileLink.objects.filter(user=user).delete()
        ProfileAddress.objects.filter(user=user).delete()
        Person.objects.filter(user=user).delete()
        Application.objects.filter(user=user).delete()
        Resume.objects.filter(user=user).delete()

        industries = {
            name: Industry.objects.get_or_create(name=name)[0]
            for name in {industry for _, industry in COMPANIES}
        }
        companies = {}
        for name, industry in COMPANIES:
            company, _ = Company.objects.get_or_create(name=name)
            company.industries.add(industries[industry])
            companies[name] = company
        roles = {name: Role.objects.get_or_create(name=name)[0] for name in ROLES}

        locations = {}
        for country_name, state_name, city in LOCATIONS:
            country, _ = Country.objects.get_or_create(name=country_name)
            state, _ = State.objects.get_or_create(country=country, name=state_name)
            locations[city] = Location.objects.get_or_create(state=state, name=city)[0]

        resumes = {
            label: Resume.objects.create(
                user=user, label=label, variant_type=variant, notes=notes
            )
            for label, variant, notes in [
                ("general-v4", "general", "Baseline resume, one page."),
                ("ey-vac-2026", "company", "Tailored for EY vacationer program."),
                ("tech-swe-v2", "role", "Projects-first layout for engineering roles."),
            ]
        }
        resumes["ey-vac-2026"].target_companies.set([companies["EY"]])
        resumes["tech-swe-v2"].target_roles.set(
            [roles["Software Engineer Intern"], roles["Graduate Software Engineer"]]
        )

        applications = {}
        for company_name, stage, outcome, days_ago in PIPELINE:
            company = companies[company_name]
            applied_at = today - timedelta(days=days_ago)

            application = Application.objects.create(
                user=user,
                company=company,
                stage=Stage.APPLIED,
                outcome=Outcome.IN_PROGRESS,
                applied_at=applied_at,
                source=random.choice(["LinkedIn", "Careers site", "Referral", "Seek"]),
                resume=resumes[
                    "ey-vac-2026" if company_name == "EY" else
                    "tech-swe-v2" if company_name in {"Canva", "Atlassian"} else
                    "general-v4"
                ],
                notes=f"Applied to {company_name} through their {applied_at.year} intake.",
            )
            log_creation(application)

            for role_name in random.sample(ROLES, k=random.choice([1, 1, 2])):
                listing, _ = JobListing.objects.get_or_create(
                    company=company,
                    role=roles[role_name],
                    location=locations[random.choice(list(locations))],
                    opened_at=applied_at - timedelta(days=14),
                    defaults={
                        "role_type": random.choice(
                            [RoleType.VACATIONER, RoleType.GRADUATE]
                        ),
                        "work_arrangement": WorkArrangement.FULL_TIME,
                        "closing_at": applied_at + timedelta(days=21),
                    },
                )
                ApplicationJobListing.objects.get_or_create(
                    application=application, job_listing=listing
                )

            # Walk the pipeline one stage at a time so the event log — and the
            # dashboard time series built from it — reflects a real history.
            stages = list(Stage.values)
            for next_stage in stages[1:stages.index(stage) + 1]:
                prev_stage, prev_outcome = application.stage, application.outcome
                application.stage = next_stage
                application.save(update_fields=["stage", "updated_at"])
                log_transition(application, prev_stage, prev_outcome)

            if outcome != Outcome.IN_PROGRESS:
                prev_stage, prev_outcome = application.stage, application.outcome
                application.outcome = outcome
                application.save(update_fields=["outcome", "updated_at"])
                log_transition(
                    application, prev_stage, prev_outcome,
                    note=f"Marked {application.get_outcome_display()}.",
                )

            if outcome == Outcome.IN_PROGRESS:
                application.follow_up_date = today + timedelta(
                    days=random.randint(-4, 10)
                )
                application.save(update_fields=["follow_up_date", "updated_at"])
            elif outcome == Outcome.REJECTED:
                # FR-APP-REJ-02 — a reminder to try again next intake. Set
                # close enough to show up in "Needs attention" as well as on
                # the calendar, rather than only proving the field exists.
                application.reapply_at = today + timedelta(days=5)
                application.save(update_fields=["reapply_at", "updated_at"])

            applications[company_name] = application

        for name, title, company_name, status, rel, src, met_days, contacts in PEOPLE:
            relationship_tag, _ = RelationshipTag.objects.get_or_create(name=rel)
            source_tag, _ = MetSourceTag.objects.get_or_create(name=src)
            person = Person(
                user=user,
                full_name=name,
                title=title,
                status=status,
                relationship=relationship_tag,
                source=source_tag,
                last_meeting_at=(
                    today - timedelta(days=met_days) if met_days else None
                ),
                notes=f"Met through {src.lower()}.",
            )
            person.apply_cadence_default()
            person.save()
            linked = [companies[company_name]]
            linked += [companies[extra] for extra in EXTRA_COMPANIES.get(name, [])]
            person.companies.set(linked)
            if company_name in applications:
                person.applications.set([applications[company_name]])
            for channel, value, preferred in contacts:
                ContactMethod.objects.create(
                    person=person, channel=channel, value=value, is_preferred=preferred
                )

        people = {p.full_name: p for p in Person.objects.filter(user=user)}
        todo_specs = [
            ("Prep for EY Assessment Center", Priority.HIGH, -1, TodoStatus.OPEN,
             applications.get("EY"), None),
            ("Message Sarah after the OA", Priority.MEDIUM, 2, TodoStatus.OPEN,
             applications.get("EY"), people.get("Sarah Chen")),
            ("Finish Canva take-home", Priority.HIGH, 3, TodoStatus.OPEN,
             applications.get("Canva"), None),
            ("Reply to Atlassian offer", Priority.HIGH, 5, TodoStatus.OPEN,
             applications.get("Atlassian"), None),
            ("Coffee chat with Priya", Priority.LOW, 9, TodoStatus.OPEN,
             None, people.get("Priya Nair")),
            ("Update general resume", Priority.LOW, None, TodoStatus.OPEN, None, None),
            ("Submit KPMG application", Priority.HIGH, -14, TodoStatus.DONE,
             applications.get("KPMG"), None),
            ("Book mock interview", Priority.MEDIUM, -9, TodoStatus.DONE, None, None),
            ("Ask Marcus about Canva timeline", Priority.MEDIUM, -4, TodoStatus.DONE,
             None, people.get("Marcus Webb")),
            ("Tidy LinkedIn headline", Priority.LOW, -2, TodoStatus.DONE, None, None),
        ]
        for title, priority, offset, status, application, person in todo_specs:
            todo = Todo(
                user=user,
                title=title,
                priority=priority,
                status=status,
                due_date=today + timedelta(days=offset) if offset is not None else None,
                application=application,
                person=person,
            )
            todo.sync_completion()
            if status == TodoStatus.DONE and offset is not None:
                todo.completed_at = timezone.now() + timedelta(days=offset)
            todo.save()

        # Meeting minutes for a few of the catch-ups that "happened".
        catchup_specs = [
            ("Sarah Chen", 90, CatchupFormat.COFFEE, "Coffee at Barangaroo",
             "Walked through the EY vacationer process end to end. She sat on an "
             "AC panel last year — said the group exercise matters more than the "
             "individual case, and to speak early rather than perfectly.",
             "Speak in the first two minutes of the group task. Ask about the "
             "Technology Consulting stream specifically."),
            ("Priya Nair", 120, CatchupFormat.VIDEO, "Mentor call",
             "Reviewed my resume for engineering roles. She thinks the projects "
             "section should lead, not education, and that one deep project beats "
             "four shallow ones.",
             "Restructure tech-swe-v2 to lead with projects. Cut the two weakest."),
            ("Marcus Webb", 30, CatchupFormat.CALL, "Recruiter intro call",
             "Canva timeline: applications close end of month, take-home is 4 "
             "hours, then a values interview. He offered to flag my application.",
             "Finish the take-home before the weekend."),
            ("Amara Osei", 45, CatchupFormat.EVENT, "Alumni night",
             "Met at the university alumni evening. She partners on assurance and "
             "offered to introduce me to the vacationer intake lead.",
             "Send a thank-you note and my one-pager."),
        ]
        people_by_name = {p.full_name: p for p in Person.objects.filter(user=user)}
        for name, days_ago, fmt, title, minutes, takeaways in catchup_specs:
            person = people_by_name.get(name)
            if not person:
                continue
            Catchup.objects.create(
                user=user,
                person=person,
                met_on=today - timedelta(days=days_ago),
                title=title,
                format=fmt,
                location="Sydney CBD" if fmt == CatchupFormat.COFFEE else "",
                minutes=minutes,
                takeaways=takeaways,
            )

        # Work history, so the profile side pane and its galleries aren't empty.
        for company_name, title, start_days, end_days in [
            ("Macquarie", "Data Analyst Intern", 700, 520),
            ("Telstra", "Casual Retail Consultant", 1100, 760),
        ]:
            Experience.objects.create(
                user=user,
                company=companies[company_name],
                title=title,
                started_on=today - timedelta(days=start_days),
                ended_on=today - timedelta(days=end_days) if end_days else None,
                description=f"Worked with the {company_name} team on reporting and analysis.",
            )

        Education.objects.create(
            user=user,
            school="University of Sydney",
            degree="Bachelor of Commerce",
            field_of_study="Finance",
            started_on=today - timedelta(days=1100),
            ended_on=None,
            description="Majoring in Finance, minoring in Data Science.",
        )

        Certification.objects.create(
            user=user,
            name="AWS Cloud Practitioner",
            issuer="Amazon Web Services",
            issued_on=today - timedelta(days=200),
            expires_on=today + timedelta(days=900),
            credential_url="https://www.credly.com/badges/example",
            description="Foundational cloud certification.",
        )

        ExtraCurricular.objects.create(
            user=user,
            organization="Commerce Society",
            role="Vice President, Careers",
            started_on=today - timedelta(days=500),
            ended_on=None,
            description="Run the annual case competition and employer panel nights.",
        )

        ProfileLink.objects.get_or_create(
            user=user, label="Portfolio",
            defaults={"url": "https://demo-applicant.dev", "category": "portfolio"},
        )
        ProfileLink.objects.get_or_create(
            user=user, label="GitHub",
            defaults={"url": "https://github.com/demo-applicant", "category": "github"},
        )

        ProfileAddress.objects.get_or_create(
            user=user, label="Home",
            defaults={"address": "1 Example Street, Sydney NSW 2000"},
        )

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded '{user.username}' "
                f"({'created' if created else 'refreshed'}): "
                f"{Application.objects.filter(user=user).count()} applications, "
                f"{Person.objects.filter(user=user).count()} contacts, "
                f"{Todo.objects.filter(user=user).count()} todos, "
                f"{Catchup.objects.filter(user=user).count()} catch-ups. "
                f"Password: {options['password']}"
            )
        )

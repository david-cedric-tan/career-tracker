/**
 * Copy-paste prompt for "bring your own AI" bulk import.
 *
 * Hand this to any AI with an existing tracker (spreadsheet, notes, export).
 * Paste or drop the JSON it returns into Settings → Bring Your Own AI — the
 * app merges it into the account (it does not wipe what you already have).
 */
export const IMPORT_GUIDE_PROMPT = `I use an app called Career Tracker for my job search. Convert the tracker data I paste below into a single JSON object I will import back into that app.

Output ONLY the JSON object below, filled in — no explanation, no markdown code fences. Omit an entire array if I have nothing for it. Within a row, omit a field if I didn't give you that information — never invent a company, person, or date that isn't in what I pasted.

{
  "companies": [
    {
      "name": "string, required — must exactly match the company name used elsewhere in this JSON",
      "short_name": "string, optional — short form (e.g. 'IBM' for 'International Business Machines')",
      "regions": "array of strings, optional — countries, e.g. ['Australia', 'Philippines']"
    }
  ],
  "applications": [
    {
      "company": "string, required — the employer's name",
      "role": "string, optional — primary job title (creates/links a listing)",
      "roles": "array of strings, optional — extra titles if one application covers several roles at the same company",
      "stage": "one of: not_submitted | applied | online_assessment | video_interview | assessment_centre | final_interview | offer",
      "outcome": "one of: in_progress | rejected | offer_received | accepted | declined | withdrawn | ghosted",
      "applied_at": "YYYY-MM-DD, optional — when I applied",
      "source": "string, optional — how I found it (referral, LinkedIn, careers site, ...)",
      "notes": "string, optional — anything worth remembering, including why it was rejected",
      "follow_up_date": "YYYY-MM-DD, optional — next time to follow up",
      "reapply_at": "YYYY-MM-DD, optional — reminder to reapply next intake",
      "awaiting_response": "boolean, optional — true if the ball is in the employer's court right now"
    }
  ],
  "todos": [
    {
      "title": "string, required",
      "description": "string, optional",
      "due_date": "YYYY-MM-DD, optional",
      "priority": "one of: low | medium | high",
      "status": "one of: open | done | cancelled — default open",
      "company": "string, optional — links this task to a company"
    }
  ],
  "catchups": [
    {
      "person": "string, required — full name of who I met",
      "met_on": "YYYY-MM-DD, required",
      "title": "string, optional",
      "format": "one of: coffee | call | video | event | message | other",
      "location": "string, optional",
      "minutes": "string, optional — what was discussed",
      "takeaways": "string, optional",
      "follow_up_on": "YYYY-MM-DD, optional"
    }
  ],
  "people": [
    {
      "full_name": "string, required",
      "title": "string, optional — their job title",
      "company": "string, optional — where they work",
      "status": "one of: lead | connection | archived | ghosted",
      "relationship": "string, optional — free label such as Mentor, Alumni, Recruiter, Classmate, Colleague, Manager, Interviewer, Industry Contact, Academic, Other",
      "email": "string, optional",
      "linkedin": "string, optional — profile URL",
      "cadence_months": "number, optional — how often I catch up (1, 2, 3, 6, 12); 0 means never auto-schedule",
      "notes": "string, optional"
    }
  ],
  "calendar_events": [
    {
      "title": "string, required",
      "date": "YYYY-MM-DD, required",
      "notes": "string, optional",
      "company": "string, optional — company this event is about",
      "people": "array of strings, optional — full names of people I met there"
    }
  ]
}

Rules:
- Dates are always YYYY-MM-DD. If you only know a month/year, use the 1st of the month.
- If a value doesn't clearly match one of the listed options, leave that field out rather than guessing.
- Spell each company or person's name identically everywhere it appears (e.g. always "EY", never "EY" in one place and "Ernst & Young" in another) — that's what lets rows about the same company or person link up correctly.
- Only include a company in the top-level "companies" array if I gave you a short name or region for it — don't list every company mentioned elsewhere, just the ones with extra detail to attach.
- Reply with the JSON only — I will paste or upload it into Career Tracker to import.

Here's my existing tracker data:
<paste your spreadsheet, notes, or export here>
`

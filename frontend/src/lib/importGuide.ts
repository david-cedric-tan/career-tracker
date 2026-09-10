/**
 * The copy-paste prompt for "bring your own AI" bulk import.
 *
 * There's no endpoint that consumes this JSON yet — this is deliberately just
 * the guide half of the feature, shipped first so the format can be tried
 * (and the resulting file saved) before the import side exists. Field names
 * and enum values are picked to match the real model fields, so a future
 * importer can read this shape directly without a redesign.
 */
export const IMPORT_GUIDE_PROMPT = `I use an app called Career Tracker for my job search. Convert the tracker data I paste below into a single JSON object I can keep for import.

Output ONLY the JSON object below, filled in — no explanation, no markdown code fences. Omit an entire array if I have nothing for it. Within a row, omit a field if I didn't give you that information — never invent a company, person, or date that isn't in what I pasted.

{
  "companies": [
    {
      "name": "string, required — must exactly match the company name used elsewhere in this JSON",
      "short_name": "string, optional — a short form for a long official name (e.g. 'IBM' for 'International Business Machines')",
      "regions": "array of strings, optional — countries this company operates in, e.g. ['Australia', 'Philippines']"
    }
  ],
  "applications": [
    {
      "company": "string, required — the employer's name",
      "role": "string, optional — job title",
      "stage": "one of: not_submitted | applied | online_assessment | video_interview | assessment_centre | final_interview | offer",
      "outcome": "one of: in_progress | rejected | offer_received | accepted | declined | withdrawn | ghosted",
      "applied_at": "YYYY-MM-DD, optional — when I applied",
      "source": "string, optional — how I found it (referral, LinkedIn, careers site, ...)",
      "notes": "string, optional — anything worth remembering, including why it was rejected",
      "follow_up_date": "YYYY-MM-DD, optional — next time to follow up",
      "reapply_at": "YYYY-MM-DD, optional — a reminder to reapply next intake"
    }
  ],
  "todos": [
    {
      "title": "string, required",
      "description": "string, optional",
      "due_date": "YYYY-MM-DD, optional",
      "priority": "one of: low | medium | high",
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
      "relationship": "one of: mentor | alumni | classmate | colleague | manager | recruiter | interviewer | industry_contact | academic | other",
      "email": "string, optional",
      "linkedin": "string, optional — profile URL",
      "notes": "string, optional"
    }
  ],
  "calendar_events": [
    {
      "title": "string, required",
      "date": "YYYY-MM-DD, required",
      "notes": "string, optional"
    }
  ]
}

Rules:
- Dates are always YYYY-MM-DD. If you only know a month/year, use the 1st of the month.
- If a value doesn't clearly match one of the listed options, leave that field out rather than guessing.
- Spell each company or person's name identically everywhere it appears (e.g. always "EY", never "EY" in one place and "Ernst & Young" in another) — that's what lets rows about the same company or person link up correctly.
- Only include a company in the top-level "companies" array if I gave you a short name or region for it — don't list every company mentioned elsewhere, just the ones with extra detail to attach.
- Reply with the JSON only.

Here's my existing tracker data:
<paste your spreadsheet, notes, or export here>
`

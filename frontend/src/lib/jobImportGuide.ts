/**
 * The copy-paste prompt for importing job listings. Works two ways: paste
 * one job ad's full text and get it split into this app's fields, or — if
 * the AI can browse/search live (Grok, or any model with web access) — ask
 * it to go find real postings matching some criteria and return several at
 * once. Same JSON shape either way; the backend (`applications/imports.py`)
 * already accepts a "listings" array of any length, one row at a time, so a
 * bad row never sinks the rest of the batch.
 *
 * The search variant needs an explicit anti-hallucination clause a pasted-ad
 * prompt doesn't: an AI asked to "find" postings can just invent plausible
 * ones instead of admitting it found fewer than expected, and a fabricated
 * job_url is worse than a missing one because import.py uses job_url as the
 * primary de-dup key.
 *
 * Field list and enum values must stay in lockstep with
 * `applications/imports.py` (VALID_ROLE_TYPES / VALID_WORK_ARRANGEMENTS) and
 * the JobListing model — this prompt is the only validation the data gets
 * before it's typed in by an LLM, so a stale enum here just means every row
 * silently drops that field with a warning instead of failing loudly.
 * (Tracker-wide migration lives in `importGuide.ts` + Settings → Bring Your
 * Own AI — a different import for accounts/applications/contacts, not
 * listings.)
 */
export const JOB_IMPORT_PROMPT = `I use an app called Career Tracker for my job search. I want job listings in this exact JSON shape — either from a job ad's text I paste below, or, if you can browse or search the live web (e.g. you're Grok), from postings you go find and verify yourself.

Output ONLY the JSON object below, filled in — no explanation, no commentary, no markdown code fences around it.

{
  "listings": [
    {
      "company": "string, required — the employer's real, legal-ish name (e.g. 'Commonwealth Bank', not 'CommBank' unless that's literally how the ad names itself)",
      "role": "string, required — the exact job title as advertised, not a paraphrase",
      "role_type": "one of exactly: vacationer | graduate | undergraduate | side_job — omit the field entirely if none clearly fits ('vacationer' covers internships/vacation programs). Do not invent other values.",
      "work_arrangement": "one of exactly: full_time | part_time | casual | contract — omit the field entirely if the posting doesn't clearly say. Do not invent other values.",
      "closing_at": "the application deadline as YYYY-MM-DD only, e.g. '2026-03-31' — omit if not stated or if you're not certain of the exact date. Never invent a plausible-sounding date.",
      "job_url": "string, optional — the DIRECT link to this specific posting (not a search-results page, not the company's generic careers homepage, not a shortened/tracking redirect you haven't resolved). This is the field the app uses to recognise a listing I've already imported, so a wrong or made-up URL causes duplicates or points me at the wrong ad. If you cannot confirm the exact posting URL, omit this field rather than guessing.",
      "location": "string, optional — just the city (e.g. 'Sydney'); if several locations are listed, use the first one named",
      "description": "string, required — a few sentences of what the role actually involves, written in your own words from the posting's 'About'/role-description section. Include the salary/pay range here as its own line if the posting states one. Do NOT put the requirements/skills list in here — those go in 'skills' below.",
      "skills": "array of short strings, required — the concrete skills, tools, degrees, or qualifications the requirements section asks for (e.g. ['Accounting', 'Financial modelling', 'Excel']). Pull out the substance, not whole sentences — 'Background in Accounting, Finance or Economics' becomes 'Accounting', 'Finance', 'Economics' as separate entries. Leave out generic personality traits with nothing concrete to tag (e.g. 'proactive self-starter')."
    }
  ]
}

Rules:
- If I paste ad text below: read only what I pasted. One ad in, one listing object out — never split one ad into several, and never add listings I didn't paste.
- If you're finding postings yourself (live search/browsing): every listing must be a real, currently-live posting you actually found and can point to — never invent a company, a role, or a URL to pad out the results. If you only found 3 real matches, return 3 objects, not more. If you found none, return {"listings": []} rather than making something up.
- Every field's value must come from the actual posting — no estimating a deadline, no guessing a location, no assuming a work arrangement that isn't stated.
- If a field genuinely isn't in the posting, omit that key from the object entirely rather than writing "", "N/A", "unknown", or null.
- Use plain straight quotes (") throughout — never curly/smart quotes (“ ”), which aren't valid JSON.
- Keep every string on one line; use \\n if you genuinely need a line break inside one.
- Reply with the JSON only — the raw object, starting with { and ending with }.

Here's the job ad text (leave this section as-is / delete it if you're searching instead):
<paste the full job ad text here>
`

/**
 * The copy-paste prompt for importing a single job ad — a real, consuming
 * import (unlike `importGuide.ts`'s tracker-wide guide, which has no endpoint
 * yet). Paste a job ad's full text into any AI with this prompt, and it comes
 * back with the ad separated into this app's actual fields — description,
 * skills, deadline — rather than dumped as one blob, so importing it produces
 * a real, browsable listing rather than a wall of pasted text in one box.
 */
export const JOB_IMPORT_PROMPT = `I use an app called Career Tracker for my job search. I'm going to paste the full text of a job ad below. Read it and separate it into this JSON shape.

Output ONLY the JSON object below, filled in — no explanation, no markdown code fences.

{
  "listings": [
    {
      "company": "string, required — the employer's name",
      "role": "string, required — the job title as advertised",
      "role_type": "one of: vacationer | graduate | undergraduate | side_job — omit if none clearly fits ('vacationer' covers internships/vacation programs)",
      "work_arrangement": "one of: full_time | part_time | casual | contract — omit if the ad doesn't clearly say",
      "closing_at": "YYYY-MM-DD, optional — the application deadline, if stated",
      "job_url": "string, optional but include it whenever you can — the ad's own URL. It's what lets the app recognise a posting I've already imported instead of adding it twice",
      "location": "string, optional — just the city (e.g. 'Sydney'); if several are listed, use the first",
      "description": "string, required — a few sentences of what the role actually involves, written in your own words from the ad's 'About'/role description. Include the salary here as a line if the ad states one. Do NOT include the requirements list here — those go in 'skills' below.",
      "skills": "array of short strings, required — the concrete skills, tools, degrees, or qualifications the requirements section asks for (e.g. ['Accounting', 'Financial modelling', 'Excel']). Pull out the substance, not whole sentences — 'Background in Accounting, Finance or Economics' becomes 'Accounting', 'Finance', 'Economics' as separate entries. Leave out generic personality traits with nothing concrete to tag (e.g. 'proactive self-starter')."
    }
  ]
}

Rules:
- Only one job ad per response — if I paste several, use just the first and ignore the rest.
- If a field isn't in the ad, omit it rather than guessing.
- Use plain straight quotes (") throughout — never curly/smart quotes (“ ”), which aren't valid JSON.
- Keep every string on one line; use \\n if you genuinely need a line break inside one.
- Reply with the JSON only.

Here's the job ad:
<paste the full job ad text here>
`

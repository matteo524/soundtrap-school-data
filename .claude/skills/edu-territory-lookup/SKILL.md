---
name: edu-territory-lookup
description: >-
  Read-only lookup of the Soundtrap for Education sales rep / territory (POD) AND the
  US public-school district student enrollment for a lead — from the hosted GitHub Pages
  data (config.json + NCES schools files), with no repo, Salesforce, or credentials.
  Use this whenever you need to ENRICH or TRIAGE a lead/email/record with "who owns this
  territory" and/or "how many students does this district have" — e.g. daily triage of
  orders@ emails, tagging inbound leads with the assigned rep, labeling by POD, deciding
  Scaled (under 3,000) vs regional, or resolving a messy district name to its enrollment.
  Trigger on asks like "which rep gets this school?", "what POD is Texas?", "enrollment
  for Clark County", "add the rep name to these leads", "is this a named account?".
  This is the read-only companion to the territory-routing skill (which CHANGES the
  config); this one only READS it, so answers always reflect the latest pushed config.
---

# EDU territory & enrollment lookup

Given a lead's location/district, return **who the sales rep is** and **how big the
district is** — the two facts a triage or enrichment step needs. It reads the exact same
public source of truth the live forms use, so it can never disagree with them, and it
needs nothing installed: no repo, no Salesforce, no keys.

**This skill only reads.** It never edits config, files, or records. To *change* routing,
that's the separate `territory-routing` skill.

## Data sources (public, read-only)

| What | URL |
|---|---|
| Territory config | `https://matteo524.github.io/soundtrap-school-data/config/config.json` → `territory` |
| District enrollment + names | `https://matteo524.github.io/soundtrap-school-data/schools/schools-<state-slug>.json` → top-level `_enrollment` |

`<state-slug>` = the full US state name, lowercased, spaces→hyphens (`new-mexico`,
`district-of-columbia`). Enrollment is NCES 2022–23 and covers **US public** districts
only (no private/charter-off-CCD, no non-US).

## Fast path: run the script

`scripts/lookup.py` does the whole thing (fetch + match + compute) and prints one JSON
object. Stdlib only — no pip installs. It takes whatever the lead gives you:

```
python scripts/lookup.py --district "Clark County School District" --state NV
python scripts/lookup.py --district "Baltimore City Public Schools" --state MD --email jane@bcps.k12.md.us
python scripts/lookup.py --country "United Kingdom" --email head@school.ac.uk
python scripts/lookup.py --district "Lincoln Public Schools" --state Nebraska --enrollment 42000
```

Flags: `--district`, `--state` (full name or 2-letter code — needed for enrollment),
`--country` (default `United States`), `--email` (for ROW named-account routing),
`--enrollment` (override if you already know it), `--quiet` (silence stderr notes).

### Output contract (stdout JSON)

```json
{
  "input": { "country": "...", "state": "nevada", "district_raw": "...", "email_domain": null },
  "match": { "district_key": "clark county", "state": "nevada",
             "method": "token-subset", "confidence": 0.95,
             "reliable": true, "candidates": ["clark county"] },
  "enrollment": 306038,
  "enrollment_source": "nces_2022_23",           // or "provided" or null
  "routing": {
    "pod": "US Named Accounts 2",
    "rep": { "name": "Justin Polk", "email": "justin@soundtrap.com" },
    "is_named_account": true,
    "is_scaled": false,
    "state_pod": "Northwest",                     // POD the state maps to
    "state_pod_rep": { "name": "Brittany Follet", "email": "brittany@soundtrap.com" }
  },
  "notes": [ "..." ]
}
```

### How to read it (this is what your labels key off)

- **`routing.rep`** — the assigned rep. This is your primary "assign to / label with rep".
- **`match.reliable`** — trust `district_key`, `enrollment`, and named-account status
  **only when this is `true`**. When `false`, the district name couldn't be matched
  confidently (private school, typo, ambiguous); `candidates` holds fuzzy suggestions for
  a human to confirm, and routing falls back to the state POD. Never auto-assign a named
  account off an unreliable match.
- **`routing.is_named_account`** — the district is on a named-accounts list (routes to a
  dedicated rep regardless of size).
- **`routing.is_scaled`** — enrollment `< 3,000`; the assigned rep is the Scaled team
  (`orders@`). For orders@ triage this is the common case, so the useful "who should
  actually work it" is **`routing.state_pod_rep`** (the regional POD rep for that state).
- **`enrollment` / `enrollment_source`** — `null` means unknown (no state given, non-US,
  or private). Don't infer Scaled vs regional when enrollment is `null`.

## The routing logic (for an agent that can't run the script)

Fetch the two JSON files and apply the same order the forms use (`computeTerritory`):

1. **Country.** Canada → POD `Canada`. United Kingdom → `UK`. Any other non-US → `ROW`,
   unless the contact email domain is in `territory.rowNamedDomains` → `ROW Named Accounts`.
2. **US — named accounts first (most specific wins).** Lowercase the district name and
   check it against `territory.usNamed2` (and any `usNamedN`) **before** `territory.usNamed`;
   also treat a name starting `new york city geographic district` as `US Named Accounts`.
   Match on whole words / exact NCES keys — not loose substrings — and don't accept a
   shaky match (see reliability note above).
3. **US — enrollment gate.** If not named and enrollment `< 3,000` → `Scaled Accounts`
   (`orders@`). Look up enrollment in the state file's `_enrollment` map by the matched key.
4. **US — regional POD.** Otherwise `territory.statePod[<state lowercase>]` → POD.
5. **Rep = `territory.podRep[<pod>]`** → `{ name, email }`. Also compute
   `statePod[state]` → its `podRep` entry as the "state POD rep" context for Scaled leads.

Matching tip: strip case/punctuation and compare token sets. A key whose tokens are all
present in the lead's district text (`clark county` ⊆ `clark county school district`) is a
reliable match; a single-word county key (`broward`) should require the word `county` in
the input; anything only close by fuzzy string distance is a *suggestion*, not a match.

## Worked examples

| Lead | → rep (pod) | enrollment |
|---|---|---|
| Clark County School District, NV | Justin Polk (US Named Accounts 2) | 306,038 |
| Montgomery County Public Schools, MD | Chad Reisfelt (US Named Accounts) | 159,181 |
| Lander County, NV (1,059) | The Soundtrap Team / orders@ (Scaled); state POD rep = Brittany Follet | 1,059 |
| Orange Grove Elementary, FL (private-style) | Lance Herrin (Southeast POD — *not* matched to named "orange") | null |
| School in the UK | Michael Beardsley (UK) | n/a |

## Caveats to respect
- **Enrollment = US public only** (NCES CCD 2022–23). Private/charter/non-US → `null`;
  fall back to POD/country routing, don't guess a number.
- **Give the state** for anything US — it's required to fetch enrollment and to resolve the
  regional POD. Without it you can still detect named accounts (those live in config), but
  not size or regional routing.
- **Reflects the latest *pushed* config.** A routing change made with `territory-routing`
  is visible here only after it's committed + pushed (GitHub Pages serves within minutes).
- This computes the **rep for a territory**; it does not read mailboxes, apply labels, or
  write anywhere — the calling agent decides what to do with the answer.

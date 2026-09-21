---
name: territory-routing
description: >-
  Change sales territory / rep / POD routing for the Soundtrap for Education forms
  (public quote, internal quote, internal order, legal). Use this whenever the user
  wants to reassign a rep, swap a POD owner, add or move a "named account", create or
  retire a POD, cover a vacant seat, or otherwise touch who a quote/legal request gets
  routed to — even if they just say "Tina left, give the Southeast to Chad", "route
  LAUSD to Justin", "add a named account", or "change the ROW rep". Territory data is
  shared across every form via config/config.json, so these changes are easy to get
  subtly wrong (config-only vs. code change, exact NCES district-name matching, five
  routing sites that must stay in sync, a don't-delete-keep-empty gotcha, and a deploy
  sequencing gap). Trigger on any rep/territory/POD/named-account routing change to
  apply the safe, verified procedure instead of hand-editing.
---

# Territory & rep routing changes

This skill makes changes to how Soundtrap for Education quote/legal submissions are
routed to a sales rep. The routing data is **shared** — it lives once in
`config/config.json` under the `territory` key and every form reads it at runtime.

**Read the reference first:** `config/TERRITORY-ROUTING.md` in the repo is the source of
truth for the data model, priority order, and line-referenced code map. This skill is the
*procedure* for changing it safely; that doc is the *explanation*. Don't duplicate it —
consult it.

## The one decision that determines everything: config-only or code change?

Most routing changes are pure **config** (edit `config.json`, push, done — GitHub Pages +
cache TTL carry it to every form in minutes, no redeploy). But some changes need a **code
edit across the forms**, because the routing logic only understands the lists that already
exist. Getting this classification right is the whole game.

**Config-only** (just edit `config.json`):
- Change a rep's name/email for an existing POD → edit `territory.podRep`.
- Reassign a whole state to a different POD → edit `territory.statePod`.
- Add/remove a district in the **existing** named list → edit `territory.usNamed`.
- Add/remove a ROW named-account domain → edit `territory.rowNamedDomains`.
- Change pricing/PD/etc. (out of scope here, but same "config-only" nature).

**Needs a code change** (edit `config.json` **and** the routing code in every form):
- **A new POD/group that routes a subset to a *different* rep** — e.g. "these 7 districts
  go to Justin, the rest of the named accounts stay with Chad." The code only has one
  `usNamed` list mapping to one rep; a second group needs a second list (`usNamed2`, …)
  **and** a new branch in `computeTerritory()` in every form.
- **A new kind of matching rule** (e.g. route by ZIP, by account ID, a new prefix rule).

If you're unsure, ask: *does the existing code already have a list/field that produces the
routing the user wants, just with different data in it?* If yes → config-only. If the user
wants a **new rep for a new slice** that doesn't map cleanly onto an existing POD → code.

## Data model (quick recall — full detail in TERRITORY-ROUTING.md)

Under `territory` in `config.json`:
- `statePod` — US state (lowercase) → POD name.
- `podRep` — POD/territory name → `{ name, email }`. Every POD referenced anywhere must
  have an entry here, or the rep comes back blank.
- `usNamed` — array of US district names (lowercase, **exact NCES cascade keys**) that
  route to the `US Named Accounts` POD regardless of state.
- `usNamed2`, … — additional named lists routing to their own POD (added when a subset
  needs a different rep). Checked **before** `usNamed`.
- `rowNamedDomains` — email domains for non-US named accounts → `ROW Named Accounts` POD.
- Keys prefixed `_` (e.g. `_southeastNote`) are **comments** — use them to record history
  and the reason for temporary states so a change is reversible.

Priority order in `computeTerritory()`: US → named lists (usNamed2 before usNamed, plus the
NYC prefix rule) → enrollment `<3000` = Scaled → state POD. Non-US → country POD (UK /
Canada / ROW), with ROW named-domain check.

## Procedure

### 1. Classify the change (above). State it to the user if it's a code change — they may
expect config-only speed and it isn't.

### 2. For named-account changes: resolve exact NCES district keys FIRST
Routing matches on the **district name string** the form's cascade produces, **not** the
Salesforce EDU account name/number the user will give you. "Val Verde USD" won't match;
`val verde unified` will. Always resolve the real key before writing it:

```
python .claude/skills/territory-routing/scripts/find_district_key.py "val verde"
```

It searches every `schools/schools-*.json` and prints the exact lowercase keys + state.
Use the printed key verbatim. If nothing is found, tell the user — the district may be
private (not in NCES) or spelled differently; don't guess.

The EDU account number is **not** used for routing. Keep it only in a `_note` comment for
traceability if the user provides it.

### 3. Edit `config.json` with minimal, targeted edits
- Preserve the existing formatting/alignment (it's hand-aligned columns). Use small string
  edits, not a full JSON reserialize, so the diff stays reviewable.
- When creating a new named list to split off a subset, **move** those districts out of the
  old list (don't leave them in both) — the new list is checked first and would win, but
  keeping them in both is confusing and error-prone.
- Record temporary/covering states in a `_note` key: who it was, who it is now, the date,
  and how to revert. Convert "temporarily" / relative dates to an absolute date.

**Never delete a list key the deployed code reads** (`usNamed`, `rowNamedDomains`). The
frontends call `.indexOf()` on them; a missing key throws and breaks the form. Empty it to
`[]` instead of removing it.

### 4. If it's a code change, patch ALL routing sites identically
The `computeTerritory()` routing block exists in **five** places and they must stay in
sync (the cross-form impact rule). New matching branches guard the new field with
`TERRITORY.<field> &&` so an old cached config can't throw:

- `public-quote-form/quote-form.html`
- `internal-quote-form/internal-quote-form.html`
- `internal-order-form/internal-order-form.html` (scaffold — edit for parity, no deploy)
- `legal-form/legal-form.html`
- `legal-form/LegalCode.gs` (the legal **backend** also routes)

The **quote backends** (`public-quote-form/Code.gs`, `internal-quote-form/Code.gs`) do
**not** do named-account routing — the rep is computed in the frontend and submitted. They
only do the Scaled→POD notification override, which reads `podRep`. Adding a POD to
`podRep` is enough for them; don't add a routing branch there.

New branch must be checked **before** the existing `usNamed` branch so the more-specific
list wins. Pattern (frontends):
```js
// 1a. US Named Accounts 2 (temporary pod) — specific districts to a dedicated rep; checked first
if (districtLc && TERRITORY.usNamed2 && TERRITORY.usNamed2.indexOf(districtLc) !== -1) {
  pod = 'US Named Accounts 2';
// 1b. US Named Accounts — by district name (or any NYC geographic sub-district)
} else if (districtLc && (TERRITORY.usNamed.indexOf(districtLc) !== -1 ||
    districtLc.indexOf('new york city geographic district') === 0)) {
  pod = 'US Named Accounts';
} else {
```

### 5. Validate before pushing
```
python .claude/skills/territory-routing/scripts/validate_territory.py
```
It checks: config.json parses; every POD referenced in `statePod` (and the named/country
PODs) has a `podRep` entry; required list keys exist; no district appears in two named
lists; and — if a `usNamed2`-style list exists in config — that every frontend + the legal
backend actually reference it (catches a half-applied code change). Fix anything it flags.

### 6. Commit, push, and give the deploy checklist
Commit with the matteo524 account. Then tell the user exactly what goes live automatically
vs. what needs a manual redeploy, and warn about the sequencing gap:

| Target | How it goes live | Action |
|---|---|---|
| `config.json` | GitHub Pages | push |
| Public quote frontend (`quote-form.html`) | GitHub Pages (same push) | push — config+code land together |
| Legal frontend (`legal-form.html`) | GitHub Pages (same push) | push |
| **Legal backend** (`LegalCode.gs`) | Apps Script | paste + redeploy |
| **Internal quote frontend** | Apps Script (HtmlService) | paste + redeploy |
| Internal order form | scaffold, not deployed | none |

**Sequencing gap:** if you *moved* districts out of a list AND the change needs new code,
any form that gets the new config before its new code is redeployed will (briefly) stop
routing those districts to a named rep — they fall back to the regional POD until the
Apps Script projects are redeployed. Tell the user to redeploy the internal-quote and
legal Apps Script projects promptly after the push to keep that window small. (Pure
config-only changes have no gap — every form just picks up the new data.)

## Common changes — quick recipes

- **"Rep X left, Y covers POD Z"** → config-only: set `podRep.Z` to Y; add/update
  `_<z>Note` recording X, the date, and revert instructions.
- **"Add district D as a named account for the existing named rep"** → config-only:
  `find_district_key.py "D"`, add the exact key to `usNamed`.
- **"Route districts D1…Dn to a NEW rep R (keep the rest as-is)"** → code change: new
  `podRep` POD for R, new `usNamedN` list with the resolved keys (moved out of `usNamed`),
  new branch in all 5 routing sites checked before `usNamed`.
- **"Change the ROW / UK / Canada rep"** → config-only: `podRep.ROW` / `.UK` / `.Canada`.
- **"Retire a named-accounts group"** → config-only if it just folds back into an existing
  POD (empty its list to `[]`, note why); the routing branch can stay (an empty list simply
  never matches) and be removed later.

## Why the care

These forms route real sales leads and legal requests to real reps. A wrong or blank rep
means a lead goes to the wrong person or nobody. The shared-config design makes the easy
changes instant — but the same design means a subtle mistake (a district name that doesn't
match the cascade, a list left in two places, a code branch applied to four forms but not
the fifth, a deleted key that throws) propagates everywhere at once. The scripts and the
validate step exist to catch exactly those.

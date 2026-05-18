# Soundtrap Forms — Shared Config

Single source of truth for pricing, territory routing, and shared lookup data across all Soundtrap quote/legal forms.

## Files

| File | Purpose |
|------|---------|
| `config.json` | The actual data. Fetched at runtime by every form (frontend + backend). |
| `config.schema.json` | JSON Schema (draft-07) used to validate `config.json` on every change. |
| `README.md` | This file. |

## Hosted URLs

Both files live in the `soundtrap-school-data` GitHub Pages repo:

- Config: <https://matteo524.github.io/soundtrap-school-data/config.json>
- Schema: <https://matteo524.github.io/soundtrap-school-data/config.schema.json>

GitHub Pages serves from its CDN — propagation after a push usually takes 1–5 minutes.

## What's in `config.json`

| Section | What it controls |
|---------|------------------|
| `version` | ISO date string. Bump this on every meaningful change so you can see in dev tools which version is loaded. |
| `quoteValidDays` | How many days a generated quote remains valid (default 30). |
| `pricing` | Per-seat prices by currency, plan, and seat band, plus per-school maintenance fee for District. |
| `pdPrices` | Professional Development session prices (USD, US-only). Keys must match the Salesforce `PD_Session__c` picklist exactly. |
| `currencyByCountry` | Direct country → currency code mapping. |
| `currencyFormat` | Display symbol/suffix per currency (e.g. `$`, `kr SEK`). |
| `eurozone` | Countries that default to EUR if not explicitly in `currencyByCountry`. |
| `regionByCountry` | Maps country → region (US / Canada / ANZ / ROW) for tax notes and quote template content. |
| `taxNotes` | Per-region tax disclosure string used in customer-facing quotes. |
| `upgradeMap` | Which plans a customer on a given plan can upgrade to. |
| `territory.statePod` | US state → POD name (Northwest / Southwest / Central / Northeast / Southeast). |
| `territory.podRep` | POD/territory → rep `{name, email}`. |
| `territory.usNamed` | US district names that always route to the US Named Accounts rep, regardless of state POD. |
| `territory.rowNamedDomains` | Email domains for non-US named accounts. |
| `lists.worldCountries` | Full ISO 3166-1 country list (191 entries). |
| `lists.usStates` | All 50 US states + DC + 5 territories. |
| `lists.caProvinces` | All 13 Canadian provinces/territories. |
| `lists.auStates` | All 8 Australian states/territories. |
| `legal.exhibitEStates` | US states requiring an Exhibit E addendum (Legal Form). |
| `legal.dpaCountries` | Countries requiring a Data Processing Addendum (Legal Form). |

## How to update

### Routine change (rep change, pricing tweak, new named account)

1. Edit `config.json` directly on GitHub (pencil icon) or via a local clone.
2. **Bump `version`** to today's date (`YYYY-MM-DD`) so it's clear which version is deployed.
3. Validate before committing (see "Local validation" below) or rely on the GitHub Action (if configured).
4. Commit + push. Changes propagate via GitHub Pages CDN in 1–5 minutes.
5. **No redeploy needed for any form** — all forms (and Apps Script backends) fetch the latest config at runtime.

### Structural change (new field, new region, etc.)

1. Update `config.schema.json` to reflect the new field.
2. Update `config.json` with the new data.
3. Update the consumer code in the relevant form(s) — frontend HTML and/or backend `Code.gs`.
4. Test in a staging deployment before pushing.

### Cache-busting (urgent rep swap)

If you need a change live immediately and can't wait for CDN propagation, the forms can be configured with a short URL query string (e.g. `?v=20260504`) so they bypass the CDN cache. See the consumer code for the cache-busting pattern.

## Local validation

Before committing changes, validate locally:

```bash
# Install once
pip3 install jsonschema

# From this folder
python3 -c "
import json, jsonschema
with open('config.json') as f: cfg = json.load(f)
with open('config.schema.json') as f: schema = json.load(f)
jsonschema.validate(cfg, schema)
print('✓ Valid')
"
```

## Consumed by

| Form | Frontend | Backend |
|------|----------|---------|
| Public Quote Form | `quote-form.html` | `Code.gs` |
| Internal Quote Form | `internal-quote-form.html` | `Code.gs` |
| Legal Form | `legal-form.html` | `LegalCode.gs` |

All consumers:
- Frontend fetches via `fetch()` on form load. Cached in `localStorage` with a short TTL; falls back to last-known-good copy if the fetch fails.
- Backend (`Code.gs`) fetches via `UrlFetchApp`. Cached via Apps Script `CacheService` with a 10-minute TTL.

## What's intentionally NOT in this config

These stay local to each form because they're project-specific:

- Apps Script deployment URLs (`DEPLOYMENT_URL`, `INTERNAL_FORM_URL`)
- Salesforce config (`SF_INSTANCE_URL`, `SF_API_VERSION`, `SF_ALERT_EMAIL`, `REP_NOTIFICATION_OVERRIDE`)
- HubSpot portal/form IDs
- Google Sheet IDs and column schemas (`COLUMNS`, `FIELD_MAP`)
- Drive folder IDs (Legal Form)
- Form UI options that aren't shared (quote-type list, role select options, etc.)

## Change log

Track major changes here:

| Date | Version | Change |
|------|---------|--------|
| 2026-05-04 | `2026-05-04` | Initial extraction from form files. Northeast pod → Chad Reisfelt; UK → Michael Beardsley; ROW → Jennifer Meehleis. |

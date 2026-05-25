# Legal Form
## Claude Project Memory

A DPA / Exhibit E legal request form. The HTML is hosted on GitHub Pages; the backend (Sheets + Drive + email + Slack) runs as an Apps Script web app. Customers (or reps on their behalf) submit a legal request and the form routes it to the right rep based on country/state.

---

## Files

| File | Purpose |
|------|---------|
| `legal-form.html` | Front-end form — served by GitHub Pages |
| `LegalCode.gs` | Apps Script backend — `doPost` handles submissions (Sheets + Drive + email + Slack). `doGet` returns a JSON status payload only (not used by the form). |

---

## Hosting & Deployment

**Frontend (GitHub Pages):**
- URL: `https://matteo524.github.io/soundtrap-school-data/legal-form/legal-form.html`
- Edit `legal-form.html` in this repo, commit + push, GH Pages rebuilds within ~1 min

**Backend (Apps Script):**
- **Execute as:** Me
- **Who has access:** Anyone
- The form `POST`s to the Apps Script deployment URL via `fetch()` — works cross-origin from GH Pages
- `appsScriptUrl` in `LF_CONFIG` (top of `legal-form.html`) must point to the live Apps Script deployment URL
- After editing `LegalCode.gs`, paste it into the Apps Script editor and redeploy (Deploy → Manage deployments → New version)

---

## Storage

| | |
|---|---|
| Sheet | `SHEET_ID` in `LegalCode.gs` — submissions logged here |
| Drive folder | `DRIVE_FOLDER_ID` in `LegalCode.gs` — uploaded files stored here |

---

## Territory & rep routing

The legal form fetches territory/rep data from the shared config at
`https://matteo524.github.io/soundtrap-school-data/config/config.json`:
- Frontend: `applyConfig()` in `legal-form.html` populates `TERRITORY`, `EXHIBIT_E_STATES`, `DPA_COUNTRIES`, `WORLD_COUNTRIES`, `US_STATES`, `CA_PROVINCES`, `AU_STATES` from `config.json` (cached in localStorage for 5 min, with stale fallback).
- Backend: `loadConfig_()` in `LegalCode.gs` fetches the same JSON (cached in `CacheService` for 10 min); `computeTerritory()` reads `loadConfig_().territory`.

`config.legal.exhibitEStates` and `config.legal.dpaCountries` are the legal-specific lists.

To change rep routing or the legal lists, edit `/config/config.json` in the repo and push — both forms pick up the change within minutes (cache TTL).

---

## Slack notifications

On every submit, `sendSlackNotification_()` in `LegalCode.gs` posts to a Slack channel via Incoming Webhook. The webhook URL is read from Script Properties as `SLACK_WEBHOOK_URL` (silently no-ops if unset). Message includes request type + agreements requested, school/district, country/state, requester, comments, email, and a link to the Legal Requests sheet.

---

## Fallback email

`FALLBACK_EMAIL = 'legal@soundtrap.com'` — used when no rep is matched.

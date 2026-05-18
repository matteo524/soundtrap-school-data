# Legal Form
## Claude Project Memory

A DPA / Exhibit E legal request form used internally by Soundtrap. Deployed as a Google Apps Script web app via HtmlService. Customers (or reps on their behalf) submit a legal request and the form routes it to the right rep based on country/state.

---

## Files

| File | Purpose |
|------|---------|
| `legal-form.html` | Front-end form — served by HtmlService |
| `LegalCode.gs` | Apps Script backend (Sheets + Drive + email routing) |

---

## Hosting & Deployment

- **Execute as:** Me
- **Who has access:** Anyone within Soundtrap (Google Workspace)
- Form is pasted into the Apps Script project and served via `doGet`.
- `appsScriptUrl` in `LF_CONFIG` (top of `legal-form.html`) and the Apps Script deployment URL must always match.

---

## Storage

| | |
|---|---|
| Sheet | `SHEET_ID` in `LegalCode.gs` — submissions logged here |
| Drive folder | `DRIVE_FOLDER_ID` in `LegalCode.gs` — uploaded files stored here |

---

## Territory & rep routing

The legal form uses the same territory/rep data as the quote forms:
- `TERRITORY` in `legal-form.html` (frontend)
- `TERRITORY` in `LegalCode.gs` (backend)

⚠️ This data is duplicated with the quote forms. After the shared-config migration (in progress), both files will fetch `territory` from `https://matteo524.github.io/soundtrap-school-data/config/config.json`.

Two legal-specific lists also live in the form (and will move to `config.legal` post-migration):
- `EXHIBIT_E_STATES` — US states requiring an Exhibit E addendum
- `DPA_COUNTRIES` — countries requiring a Data Processing Addendum

---

## Fallback email

`FALLBACK_EMAIL = 'legal@soundtrap.com'` — used when no rep is matched.

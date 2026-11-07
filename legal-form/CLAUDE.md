# Legal Form (Privacy & Legal Documents)
## Claude Project Memory

Customer-facing form for privacy and legal documents. The HTML is hosted on GitHub Pages; the backend (Sheets + Drive + email + Slack) runs as an Apps Script web app.

**v2 (Nov 2026)** restructured the form around *what the customer needs*, after asking *where they are*. v1 started with "New subscription / Renewal / Existing customer" and buried the agreement options; a VPAT-only request needed ~15 required fields.

---

## Flow (v2)

1. **Location**: country, plus state/province for US, Canada, Australia.
2. **What do you need?** (multi-select cards, tailored to the location):

| Key (`needs`) | Card | Shown when | What happens |
|---|---|---|---|
| `exhibitE` | Join the existing {State} agreement (Exhibit E), "Fastest" badge | US state in `config.legal.exhibitEStates` | Rep notified, contracts@ CC, due in 5 business days |
| `standard` | A copy of our standard NDPA / PUB-avtal / DPA | Always | **Emailed automatically**; rep gets an FYI |
| `signed` | Return a signed agreement (upload required) | Always | Rep notified, contracts@ CC, due in 5 business days |
| `review` | Review of our own agreement or documents (upload + description required) | Always | Rep notified, contracts@ CC, due in 10 business days ("at least 2 weeks") |
| `vpat` | Our accessibility report (VPAT) | Always | **Emailed automatically**; nobody notified |

Standard agreement by country: **US → NDPA**, **Sweden → PUB-avtal**, **everywhere else → DPA**. `config.legal.dpaCountries` is no longer used by this form.

3. **School or district**: only when a need other than VPAT is selected. US uses **one "School or district" typeahead** over every district and school in the selected state, the same approach as the quote forms. It's built from the NCES index plus `schools-{state}.json`, with one entry per district (tagged "District"). The pick fills city, district, school and NCES in the payload. There's an "I can't find my district or school" manual fallback, and the form switches to manual entry automatically if a state has no data. Outside the US the fields are organization (label varies by country, e.g. "Municipality or school"), city, and an optional school.
4. **Purchase stage**: required radio (Not purchased yet / Order placed / Renewal / Current customer); seats and reseller are optional. Same condition as 3.
5. **Documents**: for `exhibitE` (upload optional, with how-to steps and a link to the Airtable list of signed state agreements), `signed`, and `review` (also needs a description and an optional deadline).
6. **Your details**: name, email, role. VPAT-only requests get an optional "School or organization" field. A **breach contact** (with "Same as me") is asked only for `exhibitE` / `signed` / `review`.
7. **What happens next**: dynamic bullets with turnaround times, repeated on the success panel and in the confirmation email.

Section numbers 3 to 6 are assigned dynamically, so they stay sequential when sections are hidden.

---

## Files

| File | Purpose |
|------|---------|
| `legal-form.html` | Front-end form, served by GitHub Pages |
| `LegalCode.gs` | Apps Script backend: `doPost` handles v2 submissions (`formVersion: 2`) and rejects anything else |

---

## Hosting & Deployment

**Frontend (GitHub Pages):** `https://matteo524.github.io/soundtrap-school-data/legal-form/legal-form.html`. Commit + push; it rebuilds in about a minute.

**Backend (Apps Script):** Execute as Me, Who has access Anyone. `LF_CONFIG.appsScriptUrl` (top of `legal-form.html`) must point at the **v2** deployment.

**Going live with v2 (one-time):**
1. Paste `LegalCode.gs` into the legal Apps Script project.
2. Set the Script Properties below and run `checkDocuments()` (it logs ✓/✗ per document), then `initSheet()`.
3. Deploy → **New deployment** (not a new version of the old one), and copy the URL into `LF_CONFIG.appsScriptUrl`.
4. Merge and push. The old deployment keeps serving v1 for anyone with the old page cached.

After that, backend changes use Deploy → Manage deployments → edit the v2 deployment → New version.

### Script Properties

| Property | Purpose |
|---|---|
| `DOC_ID_VPAT` | Drive file ID of the VPAT |
| `DOC_ID_NDPA` | Standard NDPA (US) |
| `DOC_ID_DPA` | Standard DPA (rest of world) |
| `DOC_ID_PUB_AVTAL` | Standard PUB-avtal (Sweden) |
| `SLACK_WEBHOOK_URL` | Optional; Slack notifications for everything except VPAT-only |

Google Docs are converted to PDF; PDFs and Word files are attached as-is. **To update a document, point its property at the new file; no redeploy is needed.** If a document can't be attached, the customer is told it will follow, the Sheet row gets status "Send manually", and contracts@ receives an alert.

---

## Storage

| | |
|---|---|
| Sheet | `SHEET_ID`, tab **`Legal Requests v2`** (v1 rows remain in `Legal Requests`). Rows are written by header name. Columns: Status, Due By, Needs, Standard Agreement, Documents Sent, Document Errors, rep, etc. |
| Drive folder | `DRIVE_FOLDER_ID`. Uploads are named `YYYY-MM-DD - {org} - {file}` and shared **soundtrap.com-only** (v1 shared them with anyone with the link). |

---

## Emails

- **Customer:** from "Soundtrap for Education", reply-to `contracts@soundtrap.com`, with the automatic documents attached and the next steps listed.
- **Internal:** to the territory rep (fallback `contracts@`), with `contracts@` in CC when action is needed. Standard-copy-only requests send the rep an FYI without CC. Reply-to is the customer.
- **VPAT-only:** no internal email and no Slack post.

The single customer-facing contact address is **contracts@soundtrap.com** (v1 mixed `legal@` and `contracts@`).

---

## Territory & rep routing

Same rules as v1, from the shared `config.json` (`territory` key) via `computeTerritory()` in `LegalCode.gs`. The frontend no longer computes or shows the rep. Outside the US, the organization name is passed as `district`.

`config.legal.exhibitEStates` drives the Exhibit E card. To add a state, edit `/config/config.json` and push.

---

## Local testing

```bash
cd /Users/matteo/Claude/soundtrap-school-data && python3 -m http.server 8090 --directory legal-form
```
Open `http://localhost:8090/legal-form.html`. The form posts to the real `appsScriptUrl`, so stub `fetch` in the console (or point it at a test deployment) before submitting.

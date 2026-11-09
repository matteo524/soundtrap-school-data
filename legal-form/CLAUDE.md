# Legal Form (Privacy & Legal Documents)
## Claude Project Memory

Customer-facing form for privacy and legal documents. The HTML is hosted on GitHub Pages; the backend (Sheets + Drive + email + Slack) runs as an Apps Script web app.

**v2 (Nov 2026)** restructured the form around *what the customer needs*, after asking *where they are*. v1 started with "New subscription / Renewal / Existing customer" and buried the agreement options; a VPAT-only request needed ~15 required fields.

---

## Flow (v2)

1. **Location**: country, plus state/province for US, Canada, Australia.
2. **What do you need?** Two cards (one or both): **Agreements & legal documents** and **Our accessibility report (VPAT)**. Choosing agreements reveals **"How would you like to proceed?"**, a single choice tailored to the location (simplified from five cards in Nov 2026). Each choice maps to a `needs` key the backend understands:

| Choice | Key (`needs`) | Shown when | What happens |
|---|---|---|---|
| Join the existing {State} agreement (Exhibit E), "Fastest" badge | `exhibitE` | US state in `config.legal.exhibitEStates` | Rep notified, contracts@ CC, due in 5 business days |
| Soundtrap's standard PUB-avtal → "Email me a copy to review" | `standard` | **Sweden only** | **PDF emailed automatically**; rep gets an FYI. After reviewing, the customer returns to the form for the Adobe Sign option. |
| Soundtrap's standard agreement → "I have already reviewed it, send me a copy via Adobe Sign for signature" | `adobeSign` | Always | Rep notified, contracts@ CC, due in 5 business days. Asks for the **signer** (name, job title, email; "Same as me" option). |
| Your own documents for review (DPA, contract, terms, questionnaires…; upload required, optional deadline) | `review` | Always | Rep notified, contracts@ CC, due in 10 business days ("at least 2 weeks") |
| VPAT card | `vpat` | Always | **Emailed automatically**; nobody notified |

A submission has at most one agreement key plus optionally `vpat`.

Standard agreement by country (`standardAgreement()` in the HTML, `STANDARD_AGREEMENTS` in the backend):

| Country | Agreement (`standardAgreement` code) | Options under it |
|---|---|---|
| US | Student Data Privacy Agreement (`SDPA`) | Read it at <https://www.soundtrap.com/legal/sdpa>, then Adobe Sign (auto-selected, only option) |
| Sweden | PUB-avtal (`PUB-avtal`) | Email me a copy to review / Adobe Sign |
| Everywhere else | DPA (`DPA`) | Read it at <https://www.soundtrap.com/legal/dpa>, then Adobe Sign (auto-selected, only option) |

Changing country clears the sub-option so the customer chooses again. `config.legal.dpaCountries` is no longer used by this form.

3. **School or district**: only when a need other than VPAT is selected. US uses **one "School or district" typeahead** over every district and school in the selected state, the same approach as the quote forms. It's built from the NCES index plus `schools-{state}.json`, with one entry per district (tagged "District"). The pick fills city, district, school and NCES in the payload. There's an "I can't find my district or school" manual fallback, and the form switches to manual entry automatically if a state has no data. Outside the US the fields are organization (label varies by country, e.g. "Municipality or school"), city, and an optional school.
4. **Purchase stage**: required radio (Not purchased yet / Renewal / Current customer); seats and reseller are optional. Same condition as 3.
5. **Documents** (not a numbered section): the upload block (`#lf_docs_section`) is moved by `refresh()` to sit **directly under the chosen option**. Under Exhibit E: how-to steps, a link to the Airtable list of signed state agreements, and an optional upload. Under "Your own documents for review": a required upload and an optional deadline. There's no free-text description field (`summary` is always empty).
6. **Your details** (shown as section 5): name, email, role. VPAT-only requests get an optional "School or organization" field. **Who will sign?** (name, job title, email) is asked only for `adobeSign`. A **breach contact** (with "Same as me") is asked for `exhibitE` / `adobeSign` / `review`.
7. **What happens next**: dynamic bullets with turnaround times, repeated on the success panel and in the confirmation email.

Section numbers 3 to 5 (school, purchase stage, your details) are assigned dynamically, so they stay sequential when sections are hidden.

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
2. Run `checkDocuments()` (it logs ✓/✗ per document) and `initSheet()`. Script Properties are only needed for Slack or to override a document.
3. Deploy → **New deployment** (not a new version of the old one), and copy the URL into `LF_CONFIG.appsScriptUrl`.
4. Merge and push. The old deployment keeps serving v1 for anyone with the old page cached.

After that, backend changes use Deploy → Manage deployments → edit the v2 deployment → New version.

### Script Properties

| Property | Purpose |
|---|---|
| `DOC_ID_VPAT` | Optional. Defaults to "Soundtrap VPAT 2025.pdf" (`1kJHa9neLC77DKj1lYT9bwUSdOv9yiG9-`) |
| `DOC_ID_PUB_AVTAL` | Optional. Defaults to "Soundtrap PUB-avtal.pdf" (`1QV1RviQTToxJgfw2tBjRtpkJsGNK5SNw`) |

Both default files live in the Legal Drive folder `1hal9TVwTM8H-uAa8FDPGFWO86zMYDSIG`. Set a property only to use a different file.

**Updating a document:** either replace the file's content in Drive (Manage versions → Upload new version keeps the same file ID, so nothing else changes), or upload a new file and set the property to its ID. No redeploy is needed in either case.
| `SLACK_WEBHOOK_URL` | Optional; Slack notifications for everything except VPAT-only |

Google Docs are converted to PDF; PDFs and Word files are attached as-is. If a document can't be attached, the customer is told it will follow, the Sheet row gets status "Send manually", and contracts@ receives an alert.

---

## Storage

| | |
|---|---|
| Sheet | `SHEET_ID`, tab **`Legal Requests v2`** (v1 rows remain in `Legal Requests`). Rows are written by header name. Columns: Status, Due By, Needs, Standard Agreement, Signer Name/Title/Email, Documents Sent, Document Errors, rep, etc. |
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

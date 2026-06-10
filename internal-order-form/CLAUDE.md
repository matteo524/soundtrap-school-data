# Soundtrap for Education — Internal Order Form
## Claude Project Memory

---

## Status: ⚠️ Scaffold only — not yet deployed

This form was scaffolded from `internal-quote-form/` and the obvious quote-vs-order changes were made. **A lot of work remains** before it can be deployed:

- [ ] Apps Script project not yet created — placeholder `INTERNAL_ORDER_DEPLOYMENT_URL` in both `Code.gs` (`DEPLOYMENT_URL`) and `internal-order-form.html` (`PQF_CONFIG.appsScriptUrl`)
- [ ] Google Sheet not yet created (name should be `Soundtrap Order Submissions`)
- [x] Quote-Reference pre-fill **wired up** (`lookupQuote()` in `Code.gs` + `prefillFromQuote()` in the HTML). ⚠️ **One config step remains:** paste the real quote-form spreadsheet IDs into `QUOTE_SOURCE_SHEET_IDS` in `Code.gs` (currently empty placeholders, so lookup returns "not configured yet").
- [ ] PO file upload UI is in place but `<input type="file">` is `disabled`; backend Drive upload not wired up
- [ ] Salesforce push deferred — SF Order object exists in the org but field mapping is not done. `doPost` and `submitQuote` currently write `"Skipped: SF Order mapping pending"` to the SF Status column. See `TODO(salesforce-order-mapping)` comments in `Code.gs`.
- [ ] Customer email + branded template still say "quote" in many places — needs an editorial pass
- [ ] `Internal-order-template.html` still has the quote-validity row; the placeholder map writes `''` to `{{ValidUntil}}`, but the surrounding HTML should ideally be deleted

---

## Project Overview

Internal tool for the Soundtrap sales team to confirm orders (separate from quotes) on behalf of customers. Built as a Google Apps Script HtmlService web app — no external hosting. On submit:

1. A row is written to a Google Sheet (Submissions tab)
2. A branded order-confirmation email is sent to the customer *(currently still using the quote email logic — needs rework)*
3. A plain-text notification is sent to the account manager/rep
4. A Slack notification is posted to `#matteo-zapier-test`
5. ⚠️ Salesforce Order push is **stubbed out** until field mapping is built

---

## File Locations

**All project files:** `internal-order-form/`

| File | Purpose |
|------|---------|
| `internal-order-form.html` | Front-end form — served by HtmlService |
| `thank-you.html` | Thank-you page — served at `?page=thank-you` |
| `Code.gs` | Apps Script backend (Sheets + email + Slack; SF deferred) |
| `Internal-order-template.html` | Branded HTML template for the print/view endpoint |

---

## How this form differs from the Internal Quote Form

| Aspect | Quote form | Order form |
|---|---|---|
| Number prefix | `INT-` | `IORD-` |
| Expiration | 30 days (in `quoteValidDays`) | None |
| Salesforce target | `Quote` SObject (live) | `Order` SObject (deferred) |
| Extra fields | — | Quote Reference (optional), PO Number, PO upload (TODO), Billing Address |
| Pre-fill from existing quote | N/A | Optional — user enters a quote number in the "Existing Quote" section (lookup not yet wired up) |

Everything else (school cascade, territory routing, discount UI, PD section, contact info, plan/seats/length) is identical to the quote form.

---

## New columns added to the Sheet (vs. internal-quote-form)

```
Quote Reference | PO Number | PO File URL | Billing Same As School |
Billing Contact Name | Billing Contact Email |
Billing Address Line 1 | Billing Address Line 2 |
Billing City | Billing State | Billing Postal Code | Billing Country
```

All of these have corresponding `FIELD_MAP` entries and are sent in the form payload.

---

## TODO checklist (rough order)

1. **Deploy a placeholder Apps Script** so the form has a working URL. Drop the URL into `DEPLOYMENT_URL` + `PQF_CONFIG.appsScriptUrl`.
2. **Create the Google Sheet** + run `initSheets()` from the Apps Script editor.
3. **Set Script Properties:** `SF_CLIENT_ID`, `SF_CLIENT_SECRET` (for future SF push), `SLACK_WEBHOOK_URL`.
4. **Editorial pass on copy:** "quote" still appears in the customer email subject/body, in the welcome banner, in the print template. Sweep through and rewrite.
5. ~~**Quote-Reference pre-fill**~~ ✅ **Done.** `lookupQuote(quoteNumber)` in `Code.gs` opens the sheets in `QUOTE_SOURCE_SHEET_IDS`, finds the row, and returns a field map via `QUOTE_PREFILL_HEADER_MAP`. Client `prefillFromQuote()` fills the form (cascade fields driven via `comboCommit`/`waitAndCommit`; manual-origin quotes use manual-entry mode). **Remaining:** paste the real spreadsheet IDs into `QUOTE_SOURCE_SHEET_IDS`. Known limitation: NCES number isn't re-derived for cascade-origin quotes (the cascade re-selection repopulates it); PD session relies on the PD section being visible (US only).
6. **PO file upload:** un-disable the `<input type="file">`, add a base64 encoder + multipart payload, write `saveFiles_()` in `Code.gs` (model on `legal-form/LegalCode.gs`), store the resulting Drive URL in the `PO File URL` column.
7. **Salesforce Order mapping:** implement `createSalesforceOrder_()` in `Code.gs` (use the existing `createSalesforceQuote_` as the starting point — kept in the file as reference-only). Uncomment the SF push blocks in both `doPost` and `submitQuote`.
8. **Drop the quote-validity row** from `Internal-order-template.html` and clean up the placeholder map.

---

## Slack notifications

Inherited from the quote form. Reads `SLACK_WEBHOOK_URL` from Script Properties; silently no-ops if unset. Same channel as the other forms (`#matteo-zapier-test`).

The Slack message still says "quote" in places — sweep when doing the editorial pass.

---

## Brand Tokens

Same as all other forms — see top-level `/Users/matteo/Claude/CLAUDE.md`.

---

## Related Projects

- **Customer-facing quote form:** `public-quote-form/` — most shared logic
- **Internal quote form:** `internal-quote-form/` — direct parent of this form
- **Salesforce dashboards:** `/Users/matteo/Claude/SFDC Dashboards/`

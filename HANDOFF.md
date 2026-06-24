# Soundtrap for Education — Forms Ecosystem · Project Handoff

> Purpose: give an AI assistant (or new engineer) enough context to assess the
> project and propose a continuation plan **without** having seen the prior chat.
> Last updated: 2026-05-26.

---

## 1. What this project is

A family of web forms for **Soundtrap for Education** sales operations. Each form
collects data, writes it to a **Google Sheet**, sends **branded emails**, posts a
**Slack** notification, and (for quote forms) creates a record in **Salesforce**.

All forms are backed by **Google Apps Script** (no traditional server). Public
forms are static HTML on **GitHub Pages** that `POST` to an Apps Script web app;
internal forms are served directly by Apps Script via `HtmlService`.

There is **no build step**. Editing = edit file → push to GitHub (for hosted HTML)
and/or paste into the Apps Script editor + redeploy (for backend `.gs` + templates).

---

## 2. Repo & hosting topology

**Repo (single source of truth):** `https://github.com/matteo524/soundtrap-school-data`
Local clone: `/Users/matteo/Claude/soundtrap-school-data/`

| Folder | What it is |
|--------|-----------|
| `config/` | `config.json` — **shared data for all forms** (pricing, territory, reps, currencies, lists, legal lists, state abbrevs, quote content). Served via GitHub Pages. |
| `schools/` | NCES school/district JSONs — `index.json` + per-state `schools-{state}.json`. Powers the cascade dropdowns. |
| `assets/` | Shared images (logo). |
| `public-quote-form/` | Customer-facing quote form. GH Pages HTML + Apps Script backend. **LIVE.** |
| `internal-quote-form/` | Sales-rep quote form. Apps Script HtmlService, `@soundtrap.com`-gated. **LIVE.** |
| `internal-order-form/` | Order equivalent of internal quote form. **SCAFFOLD ONLY — not deployed.** |
| `legal-form/` | DPA / Exhibit E request form. GH Pages HTML + Apps Script backend. **LIVE.** |
| `trial-form/` | Trial signup prototype. |

**Key hosted URLs** (GitHub Pages, `https://matteo524.github.io/soundtrap-school-data/...`):
- Shared config: `/config/config.json`
- Schools index: `/schools/index.json`, per-state: `/schools/schools-{state}.json`
- Public quote form: `/public-quote-form/quote-form.html`
- Legal form: `/legal-form/legal-form.html`

**Salesforce instance:** `https://soundtrap.my.salesforce.com`

Each form folder has its own `CLAUDE.md` with form-specific detail. The top-level
project memory is at `/Users/matteo/Claude/CLAUDE.md` (note: that file is **outside**
this git repo).

---

## 3. The shared-config pattern (the architectural heart)

Everything shared lives in **`config/config.json`**, fetched at runtime by every form.
A single edit there propagates to all forms within ~1–10 min — **no code change, no
redeploy** (for the data itself).

- **Frontend (`*.html`):** `loadConfig()` fetches the JSON, caches in `localStorage`
  for 5 min, falls back to stale cache on network failure. `applyConfig()` populates
  in-memory vars (`PRICING`, `TERRITORY`, `EXHIBIT_E_STATES`, etc.). Form init is
  gated on this fetch completing.
- **Backend (`Code.gs` / `LegalCode.gs`):** `loadConfig_()` fetches via `UrlFetchApp`,
  caches in `CacheService` for 10 min, memoized per invocation. Throws if it can't load
  (callers treat as fatal for pricing/territory).

**Top-level keys in `config.json`:**
| Key | Used by |
|-----|---------|
| `pricing` | Quote forms — per-seat prices, multi-year multipliers, District maintenance fee |
| `pdPrices` | Quote forms — PD session prices (must match Salesforce `PD_Session__c` picklist) |
| `currencyByCountry`, `currencyFormat`, `eurozone` | Quote forms — currency derivation |
| `regionByCountry`, `taxNotes` | Quote templates — region routing (US/Canada/ANZ/ROW) + tax note text |
| `quoteValidDays` | Quote expiration (30) |
| `upgradeMap` | Which plans can upgrade to which |
| `territory` (`statePod`, `podRep`, `usNamed`, `rowNamedDomains`) | Quote + legal forms — rep routing |
| `usStateAbbrev` | Full US state name → USPS 2-letter code (for Salesforce) — **added recently** |
| `quoteContent` (`vendorRegistration`, `paymentMethods`) | Quote templates **and** emails — region content — **added recently** |
| `lists` (`worldCountries`, `usStates`, `caProvinces`, `auStates`) | All forms — dropdowns |
| `legal` (`exhibitEStates`, `dpaCountries`) | Legal form only |

Schema documented in `config/config.schema.json`.

---

## 4. Salesforce integration (quote forms only)

- **Connected App** `Quote_Form_Integration`, OAuth 2.0 **Client Credentials**.
- Credentials in Apps Script **Script Properties**: `SF_CLIENT_ID`, `SF_CLIENT_SECRET`
  (never hardcoded). Run-As user must be a System Admin (to bypass the
  `Restrict_Quote_Types_To_Admins` validation rule).
- Writes to the standard **`Quote`** object with many custom fields (see each form's
  CLAUDE.md for the full field map). `createSalesforceQuote_()` in `Code.gs`.
- **Non-fatal:** the Sheet row is always written first; SF failure logs to a
  `SF Status` column (`Created` / `Failed: …`) and emails `SF_ALERT_EMAIL`.
- Account auto-lookup by NCES number via `findAccountByNces_()`.
- `Quote_Link__c` = `DEPLOYMENT_URL + '?q=' + quoteNumber` → opens the branded
  web/PRINT view (the `doGet` endpoint).
- **Legal form & internal order form do NOT push to Salesforce** (order form's is
  deferred/stubbed; legal has none yet).

---

## 5. Slack notifications

Every form posts to a Slack channel on submit via Incoming Webhook. URL read from
Script Property `SLACK_WEBHOOK_URL` (silently no-ops if unset). Currently points to
**`#matteo-zapier-test`** — to be repointed to a production channel.
`sendSlackNotification_()` in each backend.

---

## 6. Quote rendering — THREE views, now unified (important)

A quote is shown in three places. **They must say the same thing.**
1. **PRINT / web view** — `?q=...` endpoint → `buildTemplateQuote_()` → `quote-template.html`. Uses `<style>` block + CSS classes.
2. **Salesforce quote URL** — same `?q=...` endpoint (identical to PRINT).
3. **Customer email** — `buildFullQuoteEmail_()`, programmatic, **inline styles only**.

**Why two renderers exist:** Gmail strips `<style>` blocks, so the template can't be
reused for email — the email must be inline-styled. This is deliberate (see "gotchas").

**Recent fix (uncommitted):** the region-dependent content (Vendor Registration +
Payment Methods, per US/Canada/ROW/ANZ) had **drifted** between the template and the
email. It's now unified: both renderers read from `config.json → quoteContent`. The
template has `{{VendorRegistrationBlock}}` / `{{PaymentMethodsBlock}}` placeholders
filled by `renderVendorRegTemplate_()` / `renderPaymentMethodsTemplate_()`; the email
uses `renderVendorRegEmail_()` / `renderPaymentMethodsEmail_()`. Same config strings →
no drift. The canonical wording came from the PRINT template.

---

## 7. History — what's been done (most recent first)

1. **Quote-content unification** (UNCOMMITTED, just done) — moved region Vendor
   Registration + Payment Methods into `config.quoteContent`; both quote forms'
   templates + emails now render from it. Deleted old `buildPaymentSection_`.
2. **US state abbreviations** (committed `eb364e8`, pushed) — `config.usStateAbbrev` +
   `stateAbbrev_()` helper; `QuoteToState` now sends the 2-letter code to Salesforce
   (Sheet/email/template still show full name). In all 3 form backends.
3. **Internal Order Form scaffold** (committed `eb364e8`) — `cp` of internal quote form;
   quote→order editorial pass, quote-number pre-fill wired (`lookupQuote()`), PO +
   billing sections stubbed, Salesforce Order push **deferred/stubbed**. Not deployed.
4. **Config refactor + Slack + legal on GH Pages** (committed `97c224f`) — all forms
   moved to the shared-config pattern; Slack added to all; legal form moved to GH Pages
   hosting; folder reorganization.
5. Earlier: removed Public/Private school_type logic; renamed "I can't find my district";
   reverted email to programmatic builder (Gmail `<style>` stripping fix).

---

## 8. Critical gotchas / non-obvious knowledge

- **Gmail strips `<style>` blocks.** Emails must use inline styles only. This is why
  email has its own renderer separate from the template. Do not "simplify" by reusing
  the template for email without a CSS inliner.
- **Public form submit is FIRE-AND-FORGET.** `quote-form.html` POSTs and immediately
  redirects to the thank-you page **regardless of success** (the `.catch` swallows
  errors). The POST uses `Content-Type: text/plain` to dodge a CORS preflight, and
  Apps Script returns no CORS headers, so the response body can't be read cross-origin.
  Consequence: failed submissions look successful. This caused two "no record" debugging
  sessions that turned out to be a **browser extension** blocking the POST (resolved in
  Incognito / after disabling the extension). **Tracked as task #11.**
- **Two Apps Script projects, two quotas.** Public and internal forms are separate
  Apps Script projects — independent deployment URLs, Script Properties, and quota
  buckets.
- **Deployment ≠ git push.** Pushing to GitHub updates hosted HTML + `config.json`.
  Backend `.gs` and template HTML changes must ALSO be pasted into the Apps Script
  editor and redeployed (Deploy → Manage deployments → edit → New version → Deploy;
  URL is stable across versions). `config.json` data changes do NOT need a redeploy.
- **`appsScriptUrl` (in HTML) and `DEPLOYMENT_URL` (in Code.gs) must match** the live
  deployment per form. The internal-order-form has placeholder `INTERNAL_ORDER_DEPLOYMENT_URL`
  in both (not deployed yet).
- **`stateAbbrev_()` is defensive** — returns the full name if config hasn't propagated,
  so order of push vs redeploy doesn't break anything.
- **Counter race (theoretical):** quote numbers come from a `Counter` sheet cell;
  concurrent submits could collide. Volume is low (~2k/month est.) so unlikely, but
  wrapping the increment in `LockService` was recommended and not yet done.
- **Capacity:** the stack comfortably handles ~2,000 quotes/month (well within Apps
  Script, Gmail, Sheets, Salesforce, Slack limits). First ceiling at much higher volume
  is Apps Script's 90-min/day execution budget.

---

## 9. Pre-production checklist — QUOTE FORMS (close to launch)

🔴 **MUST DO before real customers:**
- Clear `REP_NOTIFICATION_OVERRIDE` in `public-quote-form/Code.gs` (currently
  `'matteo@soundtrap.com'` → set to `''`). While set, **District-plan** rep
  notifications are redirected to matteo instead of the real rep. (Owner wants this as
  the **final** action, after more testing.) The internal form has no such override.

🟡 **Pending deploy:**
- Commit + push the uncommitted quote-content work, then **redeploy both quote Apps
  Script projects** (paste `Code.gs` + template HTML). The state-abbrev `config.json` is
  already pushed but the `Code.gs` using it also needs the redeploy to take effect.

🔵 **Confirm:**
- `SF_ALERT_EMAIL = 'matteo@soundtrap.com'` (keep or move to a shared mailbox?).
- "Not available for Classroom Plans" — was in the OLD email invoice text, dropped when
  unifying to the PRINT wording. May be a real business rule; confirm whether to add to
  `config.quoteContent` (would then appear in both views).

---

## 10. Open tasks / roadmap

| # | Status | Task |
|---|--------|------|
| 6 | in progress | Unify email + template quote content (Option 3). **Largely DONE this session** — just needs commit + deploy + the "Classroom Plans" decision. |
| 9 | pending | Legal form: major rework + Salesforce integration (new SObject or Order; OAuth setup; mirror quote-form SF pattern). |
| 10 | pending | Internal Order Form: finish the scaffold — deploy + Sheet + Script Props; paste real `QUOTE_SOURCE_SHEET_IDS` for quote-number pre-fill; PO file upload (Drive); **Salesforce Order mapping** (`createSalesforceOrder_`, currently stubbed "Skipped: SF Order mapping pending"); drop `{{ValidUntil}}`. |
| 11 | pending | Public quote form: make submit **fail loudly** instead of fire-and-forget (treat resolved fetch as success, rejected as failure; show error banner; add timeout). Applies to future public order + reseller forms too. |
| 12 | pending | Enrich NCES school JSONs with **addresses** (ELSI re-export) → auto-fill billing address in order forms. Extends per-state JSON schema. |

**Bigger future items discussed (not yet tasks):**
- **Public Order Form** + **Reseller Order Form** — build from the order-form pattern.
  Reseller is public (GH Pages / HubSpot), reseller-filled, captures reseller + end-customer.
- **HubSpot migration** for public quote form (planned; same HTML as Custom HTML module).
- **Salesforce Lightning Web Component** rewrite — evaluated as a "year 2+" option. Good
  fit for internal forms; public forms would need Experience Cloud. Recommendation: when
  building the SF integrations for order + legal forms (tasks #9, #10.6), evaluate LWC
  rewrite vs. bolting Apex onto Apps Script.
- **PO/quote data extraction** — discussed, deferred. Quote-number lookup (Phase 1, done
  in order form) beats OCR; LLM extraction of customer POs is a later option for public
  forms.

---

## 11. Current uncommitted state (as of handoff)

Branch `main` is in sync with origin, but these **5 files are modified locally and NOT
yet committed** (the quote-content unification):
```
config/config.json
public-quote-form/Code.gs
public-quote-form/quote-template.html
internal-quote-form/Code.gs
internal-quote-form/Internal-quote-template.html
```
All have been validated (`config.json` valid JSON; both `Code.gs` pass `node --check`;
renderers simulated across all 4 regions). **Next mechanical step:** commit + push, then
redeploy both quote Apps Script projects, then compare an emailed quote vs the PRINT
(`?q=`) view to confirm they match.

---

## 12. How to work on this project

- **Change shared data (pricing/reps/territory/quote content):** edit `config/config.json`,
  push. Live in ~1–10 min, no redeploy.
- **Change form logic/template:** edit the file, push (for hosted HTML), paste into the
  relevant Apps Script project, redeploy New version.
- **Validate before handing back:** `node --check` on `.gs` (copy to a `.js` first —
  `.gs` extension isn't recognized); `python3 -c "import json; json.load(open(...))"`
  for config; for HTML, extract the main `<script>` and `node --check` it.
- **Test the public form in Incognito** to rule out browser-extension interference.
- Respect each form's `CLAUDE.md` and the cross-form impact rule: a shared-logic change
  affects every form — ask whether it should apply to all.

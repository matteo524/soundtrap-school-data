# Soundtrap for Education — Internal Quote Form
## Claude Project Memory

---

## Project Overview

An internal tool for the Soundtrap sales team to generate price quotes on behalf of customers. Built as a Google Apps Script HtmlService web app — no external hosting required. Sales reps fill in the form, and on submit:

1. A row is written to a Google Sheet (Submissions tab)
2. A branded quote email is sent to the customer
3. A plain-text notification is sent to the account manager/rep
4. A Quote record is created in Salesforce via REST API

**Key differences from the customer-facing form (`public-quote-form/`):**
- Hosted via Apps Script HtmlService, not GitHub Pages / HubSpot
- Restricted to `@soundtrap.com` Google accounts (auth gate in `doGet`)
- Quote prefix is `INT-` for all quote types
- Per-line discounts: Subscription Fee, Maintenance Fee, and PD Fee each have a % or $ discount input
- Quote email shows both standard (list) price and net (discounted) price
- No HubSpot integration — submits to Apps Script only
- Thank-you page served as a second HtmlService page (`?page=thank-you`)

---

## File Locations

**All project files:** `internal-quote-form/`

| File | Purpose |
|------|---------|
| `internal-quote-form.html` | Front-end form — served by HtmlService |
| `thank-you.html` | Thank-you page — served by HtmlService at `?page=thank-you` |
| `Code.gs` | Google Apps Script backend (Sheets + email + Salesforce) |
| `Internal-quote-template.html` | Branded quote HTML template — in Apps Script project, loaded by `buildTemplateQuote_()` for the `doGet` print/view endpoint. No Drive upload needed. |

---

## Hosting & Deployment

The form runs as a Google Apps Script Web App:
- **Execute as:** Me
- **Who has access:** Anyone with Google Account (domain restriction enforced in code)

`doGet(e)` in Code.gs:
1. Checks `Session.getActiveUser().getEmail()` — redirects to an "Access Denied" page if not `@soundtrap.com`
2. Routes `?page=thank-you` to `thank-you.html`
3. Routes `?q=INT-XXXX` to the print/view endpoint
4. Otherwise serves `internal-quote-form.html`

**Local dev server (for UI work only):**
```bash
cd "/Users/matteo/Claude/soundtrap-school-data/internal-quote-form" && python3 -m http.server 8743
```
Then open: `http://localhost:8743/internal-quote-form.html`

The auth gate is bypassed locally (HtmlService APIs don't exist in a browser). For full end-to-end testing, deploy to Apps Script.

**The `appsScriptUrl` in `internal-quote-form.html` (`PQF_CONFIG`) and `DEPLOYMENT_URL` in `Code.gs` must always point to the same Apps Script deployment URL.**

⚠️ **First-deploy checklist — both values are currently wrong:**
- `DEPLOYMENT_URL` in `Code.gs` (line ~138) is pre-populated with the *customer form's* deployment URL (`AKfycbw_...`). Replace it with the internal form's URL after deploying.
- `appsScriptUrl` in `PQF_CONFIG` at the top of `internal-quote-form.html` is set to the placeholder string `'INTERNAL_DEPLOYMENT_URL'`. Replace it with the same URL.

---

## Key URLs

| What | URL |
|------|-----|
| Apps Script deployment | *(update after first deployment)* |
| School data index | `https://matteo524.github.io/soundtrap-school-data/index.json` |
| School data per-state JSONs | `https://matteo524.github.io/soundtrap-school-data/schools-{state}.json` |
| Salesforce instance | `https://soundtrap.my.salesforce.com` |

---

## Quote Number Format

`INT-{YEAR}-{5-digit-counter}` (e.g. `INT-2026-00042`)
All quote types use the same `INT-` prefix (unlike customer form which uses plan-specific prefixes).
Counter stored in `Counter` sheet, cell A1.

---

## Discount System

Each of the three fee lines has an independent discount input, shown in the **Pricing & Discounts** table at the bottom of the form.

### UI (internal-quote-form.html)
- `discState` object: `{ sub: { type: '%' }, maint: { type: '%' }, pd: { type: '%' } }`
- Toggle buttons (`%` / `$`) update `discState[line].type` and call `updatePriceDisplay()`
- Discount inputs: `pqf_disc_sub_val`, `pqf_disc_maint_val`, `pqf_disc_pd_val`
- `updatePriceDisplay()` computes net prices live; populates the 4-column table (Line Item | List Price | Discount | Net Price)
- Maintenance row (`pqf_pt_maint_row`) only shown for District plan
- PD row (`pqf_pt_pd_row`) only shown when a PD session is selected
- Hidden field `pqf_total_discounted_cost` carries the computed net total into the payload

### Sub-labels in the pricing table
Each line item row shows a small secondary label (`.pqf-pt-sub`) under the line item name:
- **Subscription Fee** (`pqf_pt_sub_detail`): plan · seats · months (e.g. `Classroom · 100 seats · 12 mo`). For ADD-ON shows `+N seats`; months omitted for ADD-ON and UPGRADE PLAN.
- **Maintenance Fee** (`pqf_pt_maint_detail`): number of schools (e.g. `12 schools`)
- **Professional Development** (`pqf_pt_pd_detail`): session name stripped of the price suffix (e.g. `Virtual PD – up to 50 teachers (1 hr)`)

### Total row
The tfoot has a single row with four cells: Total label | list price (struck-through when any discount active) | total discount | net price.
- Total discount cell (`pqf_pt_total_disc`): shows combined saved amount and percentage in green, e.g. `−$449.00 (−8%)`. Empty when no discounts are applied.
- There is no breakdown row below the total — it was removed.

### Client-side helpers
```javascript
applyDiscount(base, type, value)   // mirrors server-side applyDiscount_()
fmtDiscLabel(type, value)          // formats discount label for display
```

### Server-side helpers (Code.gs)
```javascript
applyDiscount_(base, type, value)  // '%' = percentage off, '$' = fixed amount off
fmtDiscount_(type, value, currency)
```

### Payload builder
The function that assembles the form payload is `buildHSPayload()` in `internal-quote-form.html` (line ~3839). It kept its original HubSpot-era name when HubSpot was stripped — **don't rename it**, it works fine as-is.

### Payload fields
```
sub_discount_type, sub_discount_value
maint_discount_type, maint_discount_value
pd_discount_type, pd_discount_value
total_discounted_cost
```

---

## Professional Development Section

The PD section (`pqf_pd_section`) is a standalone `.pqf-section` div placed **between School Details and Contact Information** in the DOM. It is hidden by default and shown only when country = United States via `updatePdSection()`.

It is **not** in the `_upgradeFieldOrder` / `_upgradeFieldOrderUpgrade` arrays — it stays in its fixed DOM position and is not moved by `reorderFieldsForUpgrade()`.

---

## Form Section Order (DOM)

1. Welcome banner (links to order form + orders@soundtrap.com)
2. **Quote Type** — includes Plan, Seats, Subscription Length (moved here by `reorderFieldsForUpgrade`)
3. **School Details** — School Type, Country, cascade dropdowns (or manual panel)
4. **Professional Development** — US only, shown/hidden by `updatePdSection()`
5. **Contact Information** — First Name, Last Name, Email, Role, Account ID
6. Use Case textarea
7. **Quote Details** — section title only (fields moved to Quote Type section at init)
8. **Pricing & Discounts** — discount table, shown once plan + seats are entered

---

## Google Sheet

**Spreadsheet name:** `Soundtrap Quote Submissions`
**Tabs:** `Submissions` (one row per quote), `Counter` (A1 = last used quote number)

After any change to `COLUMNS` in Code.gs, run `initSheets()` from the Apps Script editor to update headers.

### Column order (COLUMNS in Code.gs)
```
Quote Number | Timestamp | Quote Type |
Country | State | City | School District | School Name | NCES Number | Manual Entry | School Type | District Enrollment |
First Name | Last Name | Email | Your Role | Soundtrap Account ID |
Plan | Number of Seats | Current Plan | Current Seats | Additional Seats | Subscription End Date | Number of Schools | Subscription Length |
Territory | Account Manager | Account Manager Email |
Use Case | School Website | PD Session | Purchase Date |
Sub Discount Type | Sub Discount Value | Maint Discount Type | Maint Discount Value | PD Discount Type | PD Discount Value | Total Discounted Cost |
SF Status | SF Record ID
```

---

## Email System

The customer quote email shows **both** standard (list) and net (discounted) prices side by side in the subscription table. If no discount is applied, only list price is shown.

`buildSubscriptionTable_()` in Code.gs renders a nested 4-column table:
Line Item | List Price | Discount | Net Price

The `buildFullQuoteEmail_()` function:
- Computes `subFeeStd` / `maintFeeStd` separately from `subFeeNet` / `maintFeeNet` / `pdFeeNet`
- Applies `applyDiscount_()` per line
- Passes a `discountInfo` object to `buildSubscriptionTable_()`

---

## Salesforce Integration

Same setup as customer form. Additional discount fields mapped to new custom fields:

| Form field | Salesforce API field |
|-----------|---------------------|
| Sub Discount Type | `Sub_Discount_Type__c` |
| Sub Discount Value | `Sub_Discount_Value__c` |
| Maint Discount Type | `Maint_Discount_Type__c` |
| Maint Discount Value | `Maint_Discount_Value__c` |
| PD Discount Type | `PD_Discount_Type__c` |
| PD Discount Value | `PD_Discount_Value__c` |
| Total Discounted Cost | `Total_Discounted_Cost__c` |

These fields must be created in Salesforce before deploying. Discount fields are only written when a discount value > 0 is present.

All other Salesforce field mappings, auth setup, and error handling are the same as the customer form — see `public-quote-form/CLAUDE.md` for details.

**Script Properties required:**
- `SF_CLIENT_ID` — Consumer Key
- `SF_CLIENT_SECRET` — Consumer Secret

**Hardcoded config values to review before production:**
- `SF_ALERT_EMAIL = 'matteo@soundtrap.com'` — email notified on SF sync failure
- `REP_NOTIFICATION_OVERRIDE = 'matteo@soundtrap.com'` — see section below; clear to `''` in production

---

## How to Make Common Updates

### Update pricing
Same as customer form — edit `PRICING` in both `Code.gs` and `internal-quote-form.html`, then redeploy.

### Add or change discounts
- Client-side: `discState`, `applyDiscount()`, `updatePriceDisplay()` in `internal-quote-form.html`
- Server-side: `applyDiscount_()`, `buildFullQuoteEmail_()`, `buildSubscriptionTable_()`, `createSalesforceQuote_()` in `Code.gs`
- Sheet: add/rename columns in `COLUMNS` + `FIELD_MAP`, run `initSheets()`

### Update quote template
1. Edit `Internal-quote-template.html` locally
2. Open the Apps Script editor → paste the updated content into the `Internal-quote-template.html` file in the project
3. Redeploy Apps Script (new version)

The template supports four regions: **US / Canada / ANZ / ROW**. Region is determined server-side by `regionForCountry_()` and applied via `applyRegion_()`. ANZ covers Australia and New Zealand.

Keep `Internal-quote-template.html` in sync with the public form's `quote-template.html` — they share the same structure and region logic.

### Redeploy Apps Script
Deploy → Manage deployments → edit → New version → Deploy.
URL does **not** change between versions.

---

## Brand Tokens

Per the May 2026 brand guidelines. See the central reference at `../CLAUDE.md` for the full palette.

```
Purple Rain (primary):    #6551FF
Black Sabbath (dark):     #16161B
Violette Echo:            #8F8FFF
Barry White (near-white): #FDFDFE
UI Background:            #F2F2F5
Error/Negative:           #B40748
Body font:                'Helvetica Neue', Helvetica, Arial
Headline font:            'Bebas Neue' (fallback for Matter)
```

---

## Related Projects

- **Customer-facing quote form:** `public-quote-form/` — source of most shared logic
- **School data (NCES JSONs):** `https://github.com/matteo524/soundtrap-school-data`
- **Salesforce dashboards:** `/Users/matteo/Claude/SFDC Dashboards/`

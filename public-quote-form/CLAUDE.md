# Soundtrap for Education — Price Quote Form
## Claude Project Memory

---

## Project Overview

A self-service price quote generator for Soundtrap for Education. Customers fill in the form, and on submit:
1. A row is written to a Google Sheet (Submissions tab) — source of truth
2. A branded quote email is sent to the customer
3. A plain-text notification is sent to the account manager/rep
4. A Quote record is created in Salesforce via REST API

**Current hosting:** GitHub Pages
`https://matteo524.github.io/soundtrap-school-data/quote-form.html`
`https://matteo524.github.io/soundtrap-school-data/thank-you.html`
`https://matteo524.github.io/soundtrap-school-data/thank-you-district.html`

**Planned migration:** HubSpot Custom HTML module (same HTML file, no code changes needed)

---

## File Locations

**All project files:** `public-quote-form/`

| File | Purpose |
|------|---------|
| `quote-form.html` | Front-end form — HubSpot Custom HTML module |
| `thank-you.html` | Thank-you page — School / Classroom quotes |
| `thank-you-district.html` | Thank-you page — District quotes (rep will follow up) |
| `Code.gs` | Google Apps Script backend (Sheets + email + Salesforce) |
| `quote-template.html` | Branded quote HTML template — in Apps Script project, loaded by `buildTemplateQuote_()` for the `doGet` print/view endpoint |
| `soundtrap-pqf-documentation.docx` | Full technical documentation |
| `school-data/` | Local copy of NCES school JSON files |
| `soundtrap-logo.svg` | Logo asset |
| `SoundtrapForEducation_BarryWhite.png` | Header image asset |

### thank-you.html
Standalone branded page. Shows checkmark icon, "Thank you!" heading, message: *"In a few minutes you will receive the quote you requested in your inbox."*
Two buttons: **Visit Soundtrap for Education** (`https://www.soundtrap.com/edu`) and **Submit another quote request** (`quote-form.html`).
Submit handler in `quote-form.html` redirects here on success: `window.location.href = 'thank-you.html'`.

---

## Key URLs

| What | URL |
|------|-----|
| Apps Script deployment (web app) | `https://script.google.com/macros/s/AKfycbw_0gpCmMbU4hpi1V1qRm8vaeiO3aKLHMyDkLy7UPNg9hEA1qKJ8GBGbE-VG-AeZOES/exec` |
| School data index (GitHub Pages) | `https://matteo524.github.io/soundtrap-school-data/index.json` |
| School data per-state JSONs | `https://matteo524.github.io/soundtrap-school-data/schools-{state}.json` |
| GitHub repo (school data + form) | `https://github.com/matteo524/soundtrap-school-data` |
| Salesforce instance | `https://soundtrap.my.salesforce.com` |

Both `appsScriptUrl` (quote-form.html line 27) and `DEPLOYMENT_URL` (Code.gs) must always point to the same Apps Script URL.

---

## Local Development

Start a local server from the Quote Form folder:
```bash
cd "/Users/matteo/Claude/soundtrap-school-data/public-quote-form" && python3 -m http.server 8080
```
Then open: `http://localhost:8080/quote-form.html`

The form submits to the live Apps Script URL even locally (no local backend needed).

---

## Submission Flow

1. User submits form
2. Apps Script (`doPost`) writes row to Google Sheet
3. Apps Script sends customer quote email + rep notification email
4. Apps Script calls Salesforce REST API to create a Quote record
   - ✅ Success → "SF Status" column = `Created`, "SF Record ID" column = Salesforce ID
   - ❌ Failure → "SF Status" column = `Failed: [error]` + admin alert email sent
5. User is redirected to `thank-you.html`

---

## Google Sheet

**Spreadsheet name:** `Soundtrap Quote Submissions`
**Tabs:** `Submissions` (one row per quote), `Counter` (A1 = last used quote number)

After any change to `COLUMNS` in Code.gs, run `initSheets()` from the Apps Script editor to update headers, or add the column manually.

### Column order (COLUMNS in Code.gs)
```
Quote Number | Timestamp | Quote Type |
Country | State | City | School District | School Name | NCES Number | Manual Entry | School Type | District Enrollment |
First Name | Last Name | Email | Your Role | Soundtrap Account ID |
Plan | Number of Seats | Current Plan | Current Seats | Additional Seats | Subscription End Date | Number of Schools | Subscription Length |
Territory | Account Manager | Account Manager Email |
Use Case | School Website | PD Session | Purchase Date |
SF Status | SF Record ID
```

---

## Quote Types

| Type | Description |
|------|-------------|
| `NEW` | Brand new subscription |
| `RENEWAL` | Renewing existing subscription |
| `ADD-ON` | Adding seats to existing subscription |
| `UPGRADE` | Upgrading plan tier |

---

## Plans & Currencies

### Plans
- **Classroom** — flat per-seat pricing, no maintenance fee
- **School** — per-seat pricing, no maintenance fee
- **District** — per-seat pricing + per-school maintenance fee
- **Legacy** — deprecated plan, available only in ADD-ON quote type

### Currencies by country
| Currency | Countries |
|----------|-----------|
| USD | United States |
| GBP | United Kingdom |
| EUR | Europe (non-UK) |
| SEK | Sweden |
| NOK | Norway |
| CAD | Canada |
| AUD | Australia |

### Seat bands (pricing tiers)
`1–50 | 51–500 | 501–1k | 1k–5k | 5k–10k | 10k–20k | 20k–50k | 50k–150k | 150k+`

### Multi-year multipliers
| Length | Multiplier |
|--------|-----------|
| 12 months | 1.0× |
| 24 months | 1.95× (5% off year 2) |
| 36 months | 2.85× (10% off year 3) |

### District maintenance fee
Per school per year (added on top of per-seat cost). Defined in `PRICING[currency].District.m` in Code.gs.

### Pricing matrix
Edit `PRICING` in both `Code.gs` (server-side) and `quote-form.html` (client-side preview). **Both must be updated together.**

---

## Professional Development (PD Sessions)

US-only add-on. Prices defined in `PD_PRICES` in Code.gs and `PD_PRICES_FORM` in quote-form.html.
Values must match Salesforce `PD_Session__c` picklist exactly:

| Salesforce value | Price |
|-----------------|-------|
| `1 hour Virtual PD for up to 50 teachers` | $499 |
| `1 hour Virtual PD for more than 50 teachers` | $599 |
| `In Person PD for 3 hours` | $3,499 |
| `In Person PD for 6 hours` | $4,499 |

---

## Form Modes (State Variables in quote-form.html)

| Variable | When active |
|----------|-------------|
| `manualMode = false` | Normal cascade mode (default) |
| `manualMode = true` | "I can't find my district" — all location fields free text |
| `schoolManualMode = true` | "I can't find my school" — district locked, only school name free text (**planned — not yet implemented**) |
| `privateMode = true` | Private school — shared school combobox shows all schools in city across all districts |

### togglePrivateMode(on)
- **ON:** performs a full cascade reset including country (`sel.country.value = ''`, `countryInput.value = ''`); hides district field + can't-find-district wrap + can't-find wrap; school combobox stays visible; calls `populatePrivateModeSchools(districts)` once a city is selected; US keeps cascade city selector, non-US shows free-text city field (`pqf_private_city_field`)
- **OFF:** restores district field + school field; hides private city field and clears its value; restores `sel.district.required = true`; hides can't-find wraps (they re-appear when country = US is re-selected)

### populatePrivateModeSchools(districts)
Merges schools from all districts in the selected city into one sorted list and populates the school combobox with placeholder "Search for your school…". Waits for `_stateSchoolsPromise` if the state JSON hasn't finished loading yet. Schools are sorted alphabetically by name.

### "I can't find my school" button (`pqf_cant_find_school`)
**Gate:** if `privateMode` is active OR `sel.district.value` is empty, shows inline error hint "Please select your district first." and returns early. Otherwise opens school-only manual mode (`schoolManualMode`).

### UX: Scroll to first error on submit
On failed validation, the submit handler finds the first `.pqf-hint.pqf-error` element, walks up to its `.pqf-field` container, and calls `.scrollIntoView({ behavior: 'smooth', block: 'center' })`.

### School Website field
Accepts `www.school.edu` format (no `https://` required). Validation regex: `/^(https?:\/\/)?[\w][\w.-]*\.[a-zA-Z]{2,}/`.

---

## School/District Cascade (US only)

**Data source:** GitHub Pages JSONs loaded on demand
**Flow:** Country → State → City → District → School

- NCES codes are 12-digit (public schools only — CCD database)
- Private schools are never in the cascade — always use `privateMode`
- When a district is selected, `_enrollment` auto-populates the read-only enrollment field

### Escape hatches
- **"I can't find my district"** → full manual mode
- **"I can't find my school"** → school-only manual mode (district locked from cascade)
- **Private school** → `privateMode` (no district, school combobox shows all city schools)

---

## School Type Field

Radio toggle: **Public School** / **Private School**
- Public → normal cascade flow; `school_type: 'Public'` in payload
- Private → `privateMode`; `school_type: 'Private'` in payload; no district field

---

## Territory Assignment

Assigned client-side in `quote-form.html`, sent as form fields to Apps Script.

### Non-US
| Territory | Countries |
|-----------|-----------|
| UK | United Kingdom |
| Canada | Canada |
| Australia | Australia + New Zealand |
| Nordics | Sweden, Norway, Denmark, Finland |
| Europe | All other European countries |
| International | Everything else |

### US
- Named accounts (specific districts → specific reps) take priority — see `NAMED_ACCOUNTS` in quote-form.html
- All other US → POD assignment by state — see `TERRITORY_MAP` in quote-form.html

---

## Email System

### Customer email
- **School / Classroom plans:** full branded HTML quote rendered inline in email body, includes "⎙ PRINT" button
- **District plan:** simple branded acknowledgment only — *"Your sales representative will be in contact with you at their earliest convenience."* No quote figures sent to the customer.

### District rep notification
- Triggered instead of the customer quote email when plan = District
- Plain-text email to the account manager with full customer details (name, email, role, school, district, city, state, enrollment, quote type, seats, length, schools, use case, purchase date, website, view-quote link)
- **SMB override:** if the assigned rep is `orders@soundtrap.com` (Scaled Accounts / enrollment < 3,000), the notification is re-routed to the regional POD rep for that state using `STATE_POD` + `POD_REP` maps in Code.gs
- `REP_NOTIFICATION_OVERRIDE` in Code.gs — set to an email for testing, clear to `''` in production

### Thank-you pages
- `thank-you.html` — School / Classroom quotes: *"In a few minutes you will receive the quote you requested in your inbox."*
- `thank-you-district.html` — District quotes: *"Your sales representative will be in contact with you at their earliest convenience."*
- Redirect chosen client-side in `quote-form.html` based on `pqf_plan` value at submission time

### Quote validity
`QUOTE_VALID_DAYS = 30` in Code.gs

---

## Salesforce Integration

### Setup
- **Connected App:** `Quote_Form_Integration` in Salesforce
- **Auth flow:** OAuth 2.0 Client Credentials
- **Credentials stored as Script Properties** in Apps Script (never hardcoded):
  - `SF_CLIENT_ID` = Consumer Key
  - `SF_CLIENT_SECRET` = Consumer Secret
- **Run As user** must be System Administrator (required for validation rules)
- **SF_INSTANCE_URL:** `https://soundtrap.my.salesforce.com`
- **SF_ALERT_EMAIL:** `matteo@soundtrap.com`

### Salesforce object
Standard `Quote` object with custom fields. No `OpportunityId` required.

### Validation rule
`Restrict_Quote_Types_To_Admins` — prevents non-admins from saving quotes with types:
NEW, RENEWAL, ADD-ON, UPGRADE PLAN. Run As user must be admin to bypass this.

### Current field mapping (form → Salesforce)

| Form field | Salesforce API field |
|-----------|---------------------|
| Quote Number (generated) | `Name` |
| Quote Type | `Type__c` |
| Quote Type = ADD-ON | `Add_On__c` (boolean) |
| Quote Type = UPGRADE | `Upgrade__c` (boolean) |
| School Name | `School_Name__c` |
| School District | `District__c` |
| Soundtrap Account ID | `EDU_Account_ID__c` |
| Account Manager | `Sales_Representative__c` |
| Account Manager Email | `Sales_Rep_Email__c` |
| Plan | `Soundtrap_Plan__c` |
| First Name | `First_Name__c` |
| Last Name | `Last_Name__c` |
| Email | `Email` |
| Currency (derived from country) | `CurrencyIsoCode` |
| City | `QuoteToCity` |
| State | `QuoteToState` |
| Country | `QuoteToCountry` |
| NCES Number (12-digit school) | `NCES_School_Number__c` |
| NCES District LEAID (7-digit) | `NCES_District_Number__c` |
| Subscription Length | `Subscription_Length_Months__c` |
| Number of Seats (NEW) | `Seats__c` ⚠️ pending |
| Number of Seats (RENEWAL) | `Seats__c` ⚠️ pending |
| Additional Seats (ADD-ON) | `Seats__c` ⚠️ pending |
| Seats on Upgraded Plan (UPGRADE) | `Seats__c` ⚠️ pending |
| Current Seats (ADD-ON / UPGRADE) | `Current_Seats__c` |
| Current Plan (UPGRADE) | `Current_Plan_for_UPGRADE__c` |
| Upgrade-to Plan (UPGRADE) | `Upgrade_to_Plan__c` |
| Number of Schools (District) | `Schools_Number_on_District__c` |
| Purchase Date | `Expected_date_of_purchase__c` |
| PD Session | `PD_Session__c` |
| Subscription End Date | `Current_Subscription_End_Date__c` |
| Use Case | `Use_Case__c` |
| Your Role | `Customer_Role__c` |
| School Website | `School_Website__c` |
| Subscription Fee (calculated) | `Subscription_Fee__c` |
| District Maintenance Fee (calculated) | `District_Maintenance_Fee__c` |
| PD Fee (calculated) | `PD_Fee__c` |
| Total Cost (calculated) | `Total_Standard_Cost__c` |
| Quote link (print URL) | `Quote_Link__c` |
| Submission timestamp | `Requested_At__c` |
| Timestamp + 30 days | `ExpirationDate` |
| — (hardcoded) | `Status` = `New` |

### ⚠️ Pending Salesforce work
1. **`Seats__c` field** — needs to be created in Salesforce (Number, 18/0). Will replace the four type-specific seat fields (`Seats_Number_NEW__c`, `Seats_Number_RENEWAL__c`, `Additional_Seats__c`, `Seats_on_upgraded_plan__c`). Code.gs currently uses `Airtable_Seats__c` as a placeholder — update to `Seats__c` once created.
2. **Account lookup by NCES number** — ✅ implemented via `findAccountByNces_(auth, nces)` in Code.gs. Tries `NCES_School_Number__c` (12-digit) first, then `NCES_District_Number__c` (7-digit LEAID = first 7 chars of NCES). Sets `AccountId` on the Quote if a match is found. Non-fatal — lookup failure is logged but does not block Quote creation.
3. **Quote link** — ✅ implemented. `DEPLOYMENT_URL + '?q=' + quoteNumber` stored in `Quote_Link__c` on the Quote record. Opens the full branded HTML quote with a Print button. Powered by the existing `doGet` endpoint.
4. **Your Role field** — ✅ implemented. `data.your_role` mapped to `Customer_Role__c`.
4. **Quote URL in Salesforce** — store the print/view URL on the Quote record so it can be opened from Salesforce at any time. Recommended approach: pass `DEPLOYMENT_URL + '?q=' + quoteNumber` to a new Salesforce URL field (e.g. `Quote_URL__c`) — one extra line in `createSalesforceQuote_()`. The `doGet` endpoint already exists and renders the full quote on demand. This avoids PDF generation complexity entirely. Only reconsider if a true PDF file attachment is needed (e.g. for emailing from Salesforce or legal archiving).

### Error handling
- SF call is non-fatal — Sheet row is always saved first
- On failure: `SF Status` column = `Failed: [error message]`
- On failure: admin alert email sent to `SF_ALERT_EMAIL`
- On success: `SF Status` = `Created`, `SF Record ID` = Salesforce record ID

### UrlFetchApp permissions
`UrlFetchApp` requires explicit authorization. If a "You do not have permission to call UrlFetchApp.fetch" error appears after adding the Salesforce integration, create a temporary public wrapper function (no underscore suffix so it appears in the dropdown), run it once from the Apps Script editor to trigger the permissions dialog, click Allow, then redeploy. The wrapper can be deleted afterwards.

---

## Quote Number Format

`{PREFIX}-{YEAR}-{5-digit-counter}` (e.g. `DIR-2026-00042`)
Prefix: `DIR` (District), `SCH` (School), `CLS` (Classroom)
Counter stored in `Counter` sheet, cell A1.

---

## How to Make Common Updates

### Update pricing
1. Edit `PRICING` in `Code.gs`
2. Edit `PRICING` in `quote-form.html`
3. Redeploy Apps Script

### Update rep/territory assignments
Edit `TERRITORY_MAP` and `NAMED_ACCOUNTS` in `quote-form.html` — no Code.gs change needed

### Update PD session prices
1. Edit `PD_PRICES` in `Code.gs`
2. Edit `PD_PRICES_FORM` + `<option>` values in `quote-form.html`
3. Ensure values match Salesforce `PD_Session__c` picklist exactly

### Add a new form field
1. Add HTML input to `quote-form.html`
2. Add to `buildHSPayload()` in `quote-form.html`
3. Add to `COLUMNS` in `Code.gs`
4. Add to `FIELD_MAP` in `Code.gs`
5. Add to `createSalesforceQuote_()` in `Code.gs` if it should go to Salesforce
6. Run `initSheets()` or add column manually in Sheet
7. Redeploy Apps Script

### Update school/district data
1. Get new NCES export (ELSI tool at nces.ed.gov)
2. Run `enrich_district_enrollment.py`
3. Push updated JSONs to GitHub — GitHub Pages serves within minutes

### Update quote template
1. Edit `quote-template.html` locally
2. Open the Apps Script editor → paste the updated content into the `quote-template.html` file in the project
3. Redeploy Apps Script (new version)

The template supports four regions: **US / Canada / ANZ / ROW**. Region is determined server-side by `regionForCountry_()` and applied via `applyRegion_()`. ANZ covers Australia and New Zealand.

### Redeploy Apps Script
Deploy → Manage deployments → edit → New version → Deploy
URL does **not** change between versions.

---

## Brand Tokens

Per the May 2026 brand guidelines. See the central reference at `../CLAUDE.md` for the full palette.

```
Purple Rain (primary):    #6551FF
Black Sabbath (dark):     #16161B
Deep Purple:              #271B73
Violette Echo:            #8F8FFF
Lilac Fade:               #D5CCFF
Barry White (near-white): #FDFDFE
UI Background:            #F2F2F5
Error/Negative:           #B40748
Body font:                'Helvetica Neue', Helvetica, Arial
Headline font:            'Bebas Neue' (fallback for Matter)
Spacing base:             8px
```

---

## Form Section Names (quote-form.html)

For reference, the visible section headings in the form are:
- **School Details** (was "School Location" — renamed)
- **Your Details**
- **Quote Details**
- **Additional Information**

---

## HubSpot Integration (future)

- Set `hubspotPortalId` and `hubspotFormGuid` in `PQF_CONFIG` at top of `quote-form.html`
- Embed as a **Custom HTML module** on a HubSpot landing page
- HubSpot submission fires in parallel with Apps Script (fire-and-forget, non-blocking)

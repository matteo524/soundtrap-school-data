# Internal Quote Form → Salesforce field mapping

Source of truth: `createSalesforceQuote_()` in `internal-quote-form/Code.gs`.
Target object: standard Salesforce **`Quote`**. Empty/null fields are stripped before the API call.
Last verified: 2026-05-26.

> Maintenance note: this file is documentation only — the live mapping is the code.
> If you change `createSalesforceQuote_()`, update this file too.

---

## Always sent

| Form field / source | Salesforce field |
|---|---|
| Quote Type (normalized) | `Type__c` |
| Quote Type = ADD-ON | `Add_On__c` (boolean) |
| Quote Type = UPGRADE | `Upgrade__c` (boolean) |
| School Name | `School_Name__c` |
| School District | `District__c` |
| Soundtrap Account ID | `EDU_Account_ID__c` |
| Account Manager | `Sales_Representative__c` |
| Account Manager Email | `Sales_Rep_Email__c` |
| **Logged-in rep email** (`Session.getActiveUser().getEmail()`) | **`Quote_Created_By__c`** *(internal only)* |
| Plan | `Soundtrap_Plan__c` |
| First Name | `First_Name__c` |
| Last Name | `Last_Name__c` |
| Email | `Email` |
| Currency (derived from country) | `CurrencyIsoCode` |
| City | `QuoteToCity` |
| State → **USPS 2-letter code** via `stateAbbrev_()` | `QuoteToState` |
| Country | `QuoteToCountry` |
| Subscription Length | `Subscription_Length_Months__c` |
| Submission timestamp | `Requested_At__c` |
| Timestamp + `quoteValidDays` | `ExpirationDate` |
| — (hardcoded) | `Status` = `New` |

## Conditional on Quote Type

| Form field / source | Salesforce field | When |
|---|---|---|
| Number of Seats | `Seats_Number_NEW__c` | type = NEW |
| Number of Seats | `Seats_Number_RENEWAL__c` | type = RENEWAL |
| Current Seats | `Current_Seats__c` | type = ADD-ON |
| Additional Seats | `Additional_Seats__c` | type = ADD-ON |
| Current Plan | `Current_Plan_for_UPGRADE__c` | type = UPGRADE |
| Number of Seats | `Seats_on_upgraded_plan__c` | type = UPGRADE |
| Plan | `Upgrade_to_Plan__c` | type = UPGRADE |

## Conditional on plan / data present

| Form field / source | Salesforce field | When |
|---|---|---|
| Number of Schools | `Schools_Number_on_District__c` | plan = District |
| `DEPLOYMENT_URL + ?q=<quoteNumber>` | `Quote_Link__c` | deployment URL set |
| NCES (12-digit) | `NCES_School_Number__c` | nces present |
| NCES district (7-digit LEAID = first 7 of NCES) | `NCES_District_Number__c` | nces present |
| Account matched by NCES lookup (`findAccountByNces_`) | `AccountId` | lookup hits |
| Subscription Fee — list (calculated) | `Subscription_Fee__c` | > 0 |
| Maintenance Fee — list (calculated) | `District_Maintenance_Fee__c` | > 0 |
| PD Fee — list (calculated) | `PD_Fee__c` | > 0 |
| Purchase Date | `Expected_date_of_purchase__c` | present |
| PD Session | `PD_Session__c` | present |
| Subscription End Date | `Current_Subscription_End_Date__c` | present |
| Use Case | `Use_Case__c` | present |
| Your Role | `Customer_Role__c` | present |
| School Website | `School_Website__c` | present |

## Discount fields *(internal only)*

The internal form supports per-line discounts (subscription / maintenance / PD).
The **net (discounted) fee** is sent per line, only when it differs from the list fee:

| Form field / source | Salesforce field | When |
|---|---|---|
| Net Subscription Fee (after discount) | `Discounted_Subscription_Fee__c` | discounted & ≠ list |
| Net Maintenance Fee (after discount) | `Discounted_Maintenance_Fee__c` | discounted & ≠ list |
| Net PD Fee (after discount) | `Discounted_PD_Fee__c` | discounted & ≠ list |

> **Not sent:** `Total_Standard_Cost__c` and `Total_Discounted_Cost__c` — these are treated
> as Salesforce **formula fields** (computed in SF), so the internal form does not write them.
> The raw discount type/value fields (`Sub_Discount_Type__c`, etc.) are **not** sent either —
> only the computed net fees above. (Older docs claimed otherwise; the code sends net fees.)

---

## Differences vs the Public (Customer) Quote Form
- **Adds** `Quote_Created_By__c` (logged-in rep email).
- **Adds** the three `Discounted_*_Fee__c` net-price fields.
- **Does NOT send** `Total_Standard_Cost__c` (formula field) — the public form *does* send it.

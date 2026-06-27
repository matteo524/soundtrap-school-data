# Public (Customer) Quote Form → Salesforce field mapping

Source of truth: `createSalesforceQuote_()` in `public-quote-form/Code.gs`.
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
| NCES (12-digit) | `NCES_School_Number__c` | school nces present |
| NCES district (7-digit LEAID = first 7 of school NCES) | `NCES_District_Number__c` | school nces present |
| `district_nces` (7-digit LEAID, derived frontend from a member school — district-only typeahead picks) | `NCES_District_Number__c` | no school nces, district_nces present |
| Account matched by NCES lookup (`findAccountByNces_`) | `AccountId` | lookup hits (school NCES or district LEAID) |
| Subscription Fee (calculated) | `Subscription_Fee__c` | > 0 |
| District Maintenance Fee (calculated) | `District_Maintenance_Fee__c` | > 0 |
| PD Fee (calculated) | `PD_Fee__c` | > 0 |
| Total Cost (calculated) | `Total_Standard_Cost__c` | > 0 |
| Purchase Date | `Expected_date_of_purchase__c` | present |
| PD Session | `PD_Session__c` | present |
| Subscription End Date | `Current_Subscription_End_Date__c` | present |
| Use Case | `Use_Case__c` | present |
| Your Role | `Customer_Role__c` | present |
| School Website | `School_Website__c` | present |

---

## Differences vs the Internal Quote Form
- **No** `Quote_Created_By__c` (that's internal-only — the logged-in rep).
- **No** discount fields (`Discounted_*_Fee__c`) — the public form has no discount feature.
- **Sends** `Total_Standard_Cost__c`. ⚠️ The internal form treats `Total_Standard_Cost__c`
  as a Salesforce **formula field** and does NOT send it. Confirm whether it's a formula
  field in SF — if so, the public form writing to it would surface as `Failed:` in the
  SF Status column (non-fatal, but worth resolving).

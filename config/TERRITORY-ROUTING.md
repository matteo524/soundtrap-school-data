# Territory & Rep Routing

How a quote is assigned to a sales pod and rep. **All routing data is config-only** — you
change reps/pods by editing `config/config.json` → `territory`, committing, and pushing.
No code edit and no Apps Script redeploy are needed; forms pick it up at runtime
(frontend cache ≤5 min, backend `CacheService` ≤10 min).

> Read this before changing any rep, pod, or named-account list. The model has a
> frontend/backend split and one genuinely dangerous gotcha (see **"Empty, don't delete"**).

---

## Where the data lives — `config.json` → `territory`

| Key | Shape | Meaning |
|-----|-------|---------|
| `statePod` | `{ "california": "Northwest", … }` | US state (lowercase) → regional pod |
| `podRep` | `{ "Northwest": { name, email }, … }` | pod/territory name → the rep who owns it |
| `usNamed` | `[ "los angeles unified", … ]` | US districts (lowercase) that route to **US Named Accounts** regardless of state/enrollment |
| `rowNamedDomains` | `[ ]` | *(currently empty — pod retired)* non-US email domains that route to **ROW Named Accounts** |

The pods currently defined in `podRep`: `Scaled Accounts`, `Northwest`, `Southwest`,
`Central`, `Northeast`, `Southeast`, `Canada`, `UK`, `ROW`, `US Named Accounts`.

---

## The decision — priority order

`computeTerritory()` picks a **pod**, then looks up `podRep[pod]` for the rep name + email.
Order matters; the first match wins.

```
Country = United States
  1. District name in usNamed (or starts with "new york city geographic district")?
         → US Named Accounts            (Leandro)
  2. District enrollment < 3,000?
         → Scaled Accounts              (orders@ … but see the backend override below)
  3. Otherwise (enrollment ≥ 3,000, OR enrollment unknown):
         → statePod[state]              (regional pod → its rep)

Country = Canada          → Canada      (Chad)
Country = United Kingdom  → UK          (Michael)
Country = anything else   → email domain in rowNamedDomains?
         yes → ROW Named Accounts   (retired — list is empty, so never matches)
         no  → ROW                  (Jennifer)

No country selected yet   → "" (no rep)
```

Enrollment comes from the NCES `district_enrollment` value auto-filled by the cascade; if
it's blank/unknown, step 2 is skipped and the account goes to its regional pod.

---

## Where the logic lives (two places — keep them in mind)

| Piece | File | What it does |
|-------|------|--------------|
| **Frontend assignment** | `public-quote-form/quote-form.html` → `computeTerritory()` (~line 1677) | Assigns pod→rep client-side; writes **Territory / Account Manager / Account Manager Email** into the submission (Sheet + Salesforce). |
| **Frontend assignment** | `internal-quote-form/internal-quote-form.html` → `computeTerritory()` (~line 1854) | **Identical** logic — a straight port. Any behavioural change must be made in both. |
| **Backend SMB override** | `public-quote-form/Code.gs` → `sendDistrictRepNotification_()` (~line 485) | **Public form only.** On a **District** quote, if the assigned rep is `orders@soundtrap.com` (Scaled Accounts), re-routes the *rep notification email* to the regional pod rep via `statePod`/`podRep`. |

**Why the override exists:** a small District (enrollment < 3,000) is assigned `Scaled
Accounts` (orders@) by the frontend, but a District quote shouldn't sit in the orders
inbox — so the backend bumps the *notification* up to the state's regional pod rep. The
Sheet/Salesforce still record the originally-assigned territory; only the email recipient
changes.

**The internal form has no such override** — a rep is the one filling it in, so there's
nothing to re-route.

All of `statePod`, `podRep`, `usNamed`, `rowNamedDomains` are read the same way on both
sides: `loadConfig()` (frontend) / `loadConfig_()` (backend).

---

## ⚠️ Empty, don't delete — the one dangerous gotcha

The deployed frontend calls `TERRITORY.usNamed.indexOf(...)` and
`TERRITORY.rowNamedDomains.indexOf(...)` **unconditionally**. If either key is *missing*
from the config, `.indexOf` throws and **all territory assignment silently breaks**.

So to retire a named-accounts pod, set its list to `[]` — **never remove the key.**
(That is exactly why `rowNamedDomains` is `[]` rather than deleted after the ROW Named
Accounts pod was cancelled.) Removing a *rep* from `podRep` is only safe once nothing can
assign that pod anymore.

---

## Common changes — cookbook

Each of these is a `config.json` edit → commit → push. No redeploy.

### A rep leaves / is replaced for a pod
Edit that pod's entry in `podRep`:
```jsonc
"Southeast": { "name": "New Rep", "email": "newrep@soundtrap.com" }
```
If it's *temporary* coverage, keep a `_…Note` comment recording the original owner so it's
a one-line revert (see `_southeastNote` for the current Chad-covers-Southeast case).

### Move a state to a different pod
Edit `statePod` — change the state's value to the new pod name (must exist in `podRep`).

### Add a US named-account district
Add its **lowercase** NCES district name to the `usNamed` array. (NYC is special-cased by
prefix in code, not listed.)

### Retire a named-accounts pod (what we just did for ROW)
1. Set its list to `[]` (`rowNamedDomains: []` / `usNamed: []`) — **do not delete the key.**
2. Remove that pod's entry from `podRep` (now dead once nothing assigns it).
3. Update the `_comment` / add a `_…Note` so the next person knows why the list is empty.
   Accounts that used to match now fall through to the base pod (ROW → Jennifer).

### Add a brand-new pod
1. Add it to `podRep` with `{ name, email }`.
2. Point states (`statePod`) or a country branch at it. Adding a *country* branch (not just
   a state) requires a **code** change in `computeTerritory()` in **both** forms — the
   country→pod branches are hard-coded (US / Canada / UK / else). US states and pod→rep
   mappings are pure config; new *countries* are not.

---

## Current roster (as of this doc)

| Pod | Rep | Notes |
|-----|-----|-------|
| Northwest | Brittany Follet | |
| Southwest | Maria Opirhory | |
| Central | Chloe Taylor | |
| Northeast | Chad Reisfelt | |
| Southeast | Chad Reisfelt | **Temporary** — covering the vacant seat (Tina Shah left) |
| Scaled Accounts | The Soundtrap Team (orders@) | District quotes re-routed to regional pod by the public backend |
| Canada | Chad Reisfelt | |
| UK | Michael Beardsley | |
| ROW | Jennifer Meehleis | Now receives **all** ROW quotes |
| US Named Accounts | Leandro Otero | |
| ~~ROW Named Accounts~~ | ~~Angelica Johansson~~ | **Retired** — `rowNamedDomains` emptied; all ROW → Jennifer |

---

## ⚠️ Production gate (unrelated to routing data, but affects who actually gets the email)

`REP_NOTIFICATION_OVERRIDE = 'matteo@soundtrap.com'` in **both** forms' `Code.gs`
intercepts *every* rep-notification email during testing. While it's set, none of the
routing above actually reaches the real reps — all notifications go to Matteo. It must be
cleared to `''` as the final step before production (see `HANDOVER.md`).

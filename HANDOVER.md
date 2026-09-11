# Session Handover — Soundtrap Quote Forms

> **Purpose:** temporary handover so another Claude account can continue this work.
> The `CLAUDE.md` files (top-level + one per form) describe how the system works and stay
> true across sessions — **read those first for architecture.** This file captures the
> *in-flight state* the CLAUDE.md files deliberately don't track: what's deployed vs not,
> what's mid-test, blockers, and pending work.
>
> **Last updated:** 2026-09-11 · **Author:** matteo@soundtrap.com
> **Repo state at handover:** branch `main`, working tree clean, all commits pushed (HEAD = `4cff419`).

---

## 🚦 Go-live blocker — DO NOT FORGET, DO NOT DO YET

`REP_NOTIFICATION_OVERRIDE = 'matteo@soundtrap.com'` is still set in **both**
`public-quote-form/Code.gs` and `internal-quote-form/Code.gs`. This routes all rep
notification emails to Matteo during testing.

**This must be cleared to `''` as the FINAL action before production — and ONLY then.**
Leave it as-is while testing continues. Do not clear it on your own initiative.

---

## 🔁 Salesforce is currently pointed at the FULL SANDBOX — revert before go-live

As of 2026-09-11 both quote backends write to the **Full sandbox**
(`https://soundtrap--full.sandbox.my.salesforce.com`), not production. This is now
controlled entirely by **Script Properties** (no code edit needed to switch):

| Property (code reads these) | Sandbox value (now) | Production value (revert to) |
|---|---|---|
| `SF_INSTANCE_URL` | `https://soundtrap--full.sandbox.my.salesforce.com` | *(unset → falls back to prod)* or `https://soundtrap.my.salesforce.com` |
| `SF_CLIENT_ID` | sandbox External Client App consumer key | prod key (parked as `SF_CLIENT_ID_PROD`) |
| `SF_CLIENT_SECRET` | sandbox consumer secret | prod secret (parked as `SF_CLIENT_SECRET_PROD`) |

- Prod keys are parked under `_PROD`-suffixed properties (and sandbox may be parked as `_SAND`).
  Suffixed properties are **ignored by the code** — only the three un-suffixed names above are read.
- **To revert to production:** copy the `_PROD` values into `SF_CLIENT_ID` / `SF_CLIENT_SECRET`,
  and set `SF_INSTANCE_URL` back to the prod URL (or delete it to use the built-in prod fallback).
  Do this in **both** Apps Script projects (public + internal). No code change/redeploy needed.
- Sandbox External Client App `Quote_Form_Integration` was deployed via SF CLI; Client Credentials
  run-as user = `matteoo@spotify.com.full` (**must be an active System Administrator** or inserts
  fail the `New_Type_Values_Restricted` validation).
- The `SF_INSTANCE_URL`-as-Script-Property change shipped in commit `4cff419` — this **must be
  pasted + redeployed** into both Apps Script projects for the switch to work.

---

## Deploy model (important — code changes are NOT live until pasted + redeployed)

The repo is the source of truth, but the running backends are Apps Script projects that
must be **manually updated**. Pushing to GitHub only auto-serves the GitHub Pages parts
(the public/legal frontends, config.json, schools JSONs).

| Piece | How it goes live |
|---|---|
| Public form frontend (`quote-form.html`) | GitHub Pages — auto, ~1 min after push |
| Public backend (`Code.gs`, `quote-template.html`) | Paste into public Apps Script project → Deploy → New version |
| Internal form (`internal-quote-form.html`, `Code.gs`, `Internal-quote-template.html`) | Paste ALL into internal Apps Script project → Deploy → New version |
| Legal form frontend | GitHub Pages — auto |
| Legal backend (`LegalCode.gs`) | Paste into legal Apps Script project → redeploy |
| `config/config.json`, `schools/*.json` | GitHub Pages — auto (5–10 min cache TTL) |

Deployment URLs do **not** change between versions.

---

## Where we are right now

### ✅ Done + committed + pushed this session
- **#16** — fixed "My school isn't listed" manual entry after the typeahead change (pre-fills + unlocks Country/State/City).
- **#17** — "Which plan should you choose?" help link as a purple pill beside a half-width Plan dropdown (public + internal).
- **NCES addresses** — `schools/enrich_addresses.py` enriched 50 states + DC school JSONs with `address/city/zip/phone` + a `_districtAddr` map. School/district pick now shows an **editable** address block under the typeahead.
- **PD link + copy** — Canva PD info link as a pill; description now "Empower, Create, Inspire: Add Soundtrap for Education Professional Learning to your price quote" (public + internal).
- **Complimentary PD line** — for districts with **>1000 enrolled** (from NCES `district_enrollment`), a "Complimentary Introductory Professional Development / 3 hours / $0.00" line now appears in the quote **email, PRINT/web view, and SF/print template** (public + internal).
- **#11** — public form now **fails loudly** on submit (uses `fetch` `mode:'no-cors'` — opaque-resolve = success, reject = real failure; 15s timeout; error banner). Replaces the old fire-and-forget.
- **#15 step 1** — ported the state-scoped school/district **typeahead + address block** to the internal form (`874794b`).
- **d4bf691** (most recent) — internal quote fix: added the free-PD line to both internal renderers, and **de-duplicated the price** in the PRINT/SF view (stripped the Amount column + Total from the Subscription Details tables; `{{DiscountBlock}}` is now the single price source and always renders).

### 🧪 Mid-test (this is the live thread the user is on)
Matteo was **testing the internal form** and reported 3 issues — all fixed in `d4bf691`.
**Still pending on the user's side (NOT code — deploy/verify actions):**
1. Redeploy the **internal** Apps Script project (paste `Code.gs` + `Internal-quote-template.html`, new version).
2. Re-test the internal **email quote** and **PRINT/SF quote** — confirm free-PD shows and price is no longer duplicated.
3. Add `School Address` + `School ZIP` as the **last two columns** of the internal `Submissions` sheet (or run `initSheets()`).

Do not start new build work until the user confirms these pass.

---

## Pending backlog (quote-form scope)

| # | Task | State |
|---|---|---|
| **#14** | Support **private schools** (no NCES) in typeahead + Salesforce | Unblocked (both forms now have typeahead). This is the natural next build task — but only on the user's go-ahead. |
| **#12** | Address auto-fill on the **order forms'** billing block; backfill territories/BIE addresses | Blocked on #10 (order forms not built) |
| **#6** | Verify email-template unification after redeploy | Needs sign-off after a redeploy |

---

## Known non-bugs (don't chase these)
- **PRINT button "Sorry, unable to open the file at this time"** — Apps Script `/u/N/` multi-login routing artifact when signed into multiple Google accounts. **User confirmed it works in incognito.** Customers unaffected. Not a code issue.
- **Internal form Plan/PD row looks narrow in the local preview panel** — the standalone HTML fragment has no viewport meta, so the preview pane pins narrow. Renders correctly at full desktop width. Not a bug.
- **A no-discount internal quote shows the "Pricing & Discounts" table with a "—" discount** — intended (matches the email). Offered to rename the heading to just "Pricing"; user hasn't decided.

---

## Gotchas worth knowing
- **Two email renderers.** Gmail strips `<style>`, so the **email** body is built with programmatic inline styles, while the **PRINT/web view** (`doGet ?q=`) uses a `<style>`+classes template. Any quote-content change must be made in **both**.
- **CORS with Apps Script.** Public form POSTs with `Content-Type: text/plain` (avoids preflight); Apps Script returns no CORS headers, so success is detected via `mode:'no-cors'` opaque resolve (see #11).
- **`buildHSPayload()`** in the internal form kept its HubSpot-era name after HubSpot was stripped — **don't rename it.**
- **Shared config.** Pricing/territory/reps/lists live in `config/config.json` (GitHub Pages). Edit there → push → both forms pick it up within the cache TTL. No code edit or redeploy needed.
- **NCES IDs.** 12-digit school ID (leading zeros stripped in JSON — `zfill(12)` to normalize); first 7 digits = district LEAID.

---

## Quick reference
- **Public form (live):** https://matteo524.github.io/soundtrap-school-data/public-quote-form/quote-form.html
- **Config:** https://matteo524.github.io/soundtrap-school-data/config/config.json
- **Salesforce:** https://soundtrap.my.salesforce.com · SF field map: `internal-quote-form/SALESFORCE-FIELD-MAP.md`
- **Local preview:** `cd public-quote-form && python3 -m http.server 8080` (internal: port 8743) — forms submit to the live Apps Script even locally.
- **Full prior-session transcript (if deep detail needed):**
  `/Users/matteo/.claude/projects/-Users-matteo-Claude/9d7241dc-e00d-45ad-ab4d-c3da2d2ef61d.jsonl`

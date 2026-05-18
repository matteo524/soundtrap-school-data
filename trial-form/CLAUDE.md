# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A single-file static HTML prototype — **Soundtrap Trial Request Form** — that demonstrates GitHub-hosted JSON school/district lookup. No build tools, no backend, no bundler. Designed to be hosted on GitHub Pages and opened directly in a browser.

## Dev Server

```bash
python3 -m http.server --directory "/Users/matteo/Claude/Trial Form" 3002
```

Or use the configured preview via `.claude/launch.json` (port 3002). The form is served at `http://localhost:3002/trial-form.html`.

## Files

| File | Purpose |
|---|---|
| `trial-form.html` | The form itself — all HTML, CSS, and JS in one file |
| `trial-flow-chart.html` | Mermaid.js end-to-end flowchart for the team |
| `trial-form-documentation.html` | Developer documentation (10 sections, standalone HTML) |

**GitHub Pages URLs** (after uploading to `matteo524/soundtrap-school-data`):
- `https://matteo524.github.io/soundtrap-school-data/trial-form.html`
- `https://matteo524.github.io/soundtrap-school-data/trial-flow-chart.html`
- `https://matteo524.github.io/soundtrap-school-data/trial-form-documentation.html`

## Architecture — `trial-form.html`

### Data sources (GitHub Pages CDN)

```javascript
var PQF_CONFIG = {
  indexUrl:       'https://matteo524.github.io/soundtrap-school-data/index.json',
  schoolsBaseUrl: 'https://matteo524.github.io/soundtrap-school-data/schools-',
};
```

- **`index.json`** — full hierarchy: countries → states → cities → district names. Fetched once on load via `loadIndex()`.
- **`schools-{state-slug}.json`** — per-state file mapping district names → `[{name, nces}]` school objects, plus a `_enrollment` map (district name → enrollment int). Prefetched silently when the user picks a state via `prefetchStateSchools()`.

### Cascade combobox flow

Each dropdown is a custom combobox backed by a hidden `<select>`. The cascade:

```
Country → State → City → District → School
```

- **Country change**: populates State (US, CA, AU) or triggers manual mode (all others).
- **State change**: populates City from `_index`; kicks off `prefetchStateSchools()`.
- **City change**: populates District (public mode) or calls `populatePrivateModeSchools()` (private mode).
- **District change**: populates School from already-prefetched `_stateSchools`; shows enrollment via `showEnrollment()`.
- **School change**: auto-fills NCES ID from `data-nces` attribute.

### Three mode flags (booleans, mutually exclusive)

| Flag | Variable | Function |
|---|---|---|
| Full manual (can't find district) | `manualMode` | `toggleManualMode(on)` |
| School-only manual (can't find school) | `schoolManualMode` | `toggleSchoolOnlyMode(on)` |
| Private school | `privateMode` | `togglePrivateMode(on)` |

**`togglePrivateMode(on)`** always does a full cascade reset (clears all selects, country combobox, NCES, enrollment) before applying private-mode UI changes. This prevents stale locked fields when the user switches between Public and Private.

### Private school mode

- District field is hidden; school is populated from **all schools across all districts in the selected city** via `populatePrivateModeSchools(districts)`.
- For non-US countries (Canada, Australia, others): shows a free-text city field (`pqf_private_city_field`) instead of the cascade city combobox.
- "I can't find my school" is available in private mode — the click handler's district requirement check is gated on `!privateMode`.
- `toggleSchoolOnlyMode` hides (not pre-fills) the district field when `privateMode` is true.

### Key in-memory state

```javascript
var _index               = null;   // hierarchy index (country/state/city/district names)
var _stateSchools        = null;   // { "district name lc": [{name, nces}] } for current state
var _stateSchoolsPromise = null;   // in-flight fetch
var _stateSchoolsKey     = '';     // slug of currently loaded state (dedup guard)
var _districtEnrollment  = {};     // { "district name lc": enrollment_int }
var _clientCache         = {};     // generic fetch cache (unused in prototype — no API)
```

### Validation

`validate()` checks contact fields + cascade fields based on active mode:
- Contact: `pqf_firstname`, `pqf_lastname`, `pqf_email`, `pqf_role` (always required)
- Cascade fields: skipped in `manualMode`; district skipped in `privateMode` and `schoolManualMode`
- Validators defined in the `VALIDATORS` map

### localStorage (Welcome Back banner)

`saveQuoteProfile()` persists country/state/city/district/school/contact after submit. On next load, `initWelcomeBanner()` detects the saved profile and offers to pre-fill via `prefillFromProfile()`, which uses `waitAndCommit()` to chain cascade selections after each combobox populates.

## Brand tokens

```
Purple Rain (primary):   #6551F2
Black Sabbath (dark):    #161616
Deep Purple:             #271B7A
Bebas Neue:              headings (Google Fonts)
Error:                   #B40748
Spacing grid:            8px base
CSS prefix:              .pqf-  (all classes and IDs)
```

## Constraints

- **ES5-compatible JavaScript** — no `const`/`let`, no arrow functions, no template literals, no `class`.
- **No external JS dependencies** except Mermaid.js (loaded from CDN in `trial-flow-chart.html` only).
- **All code in a single file** — do not split into separate JS/CSS files.
- **Test-only fields** (NCES ID and District Enrollment) are always visible with ⚠️ disclaimers; they must be hidden before production use.
- The `fetchOptions()` / `_clientCache` infrastructure exists but is intentionally unused (no API backend in this prototype).

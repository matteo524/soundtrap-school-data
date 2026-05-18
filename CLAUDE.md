# Claude Project Memory — Soundtrap Forms Ecosystem

This repo is the **single source of truth** for the Soundtrap for Education forms ecosystem: pricing, territory routing, NCES school data, shared assets, and all form source code.

---

## ⚠️ Cross-Form Impact Rules

Before making any change to shared logic (see `config/`), always check which forms are affected and ask: **"Should this change be applied to all forms?"** Since the shared data lives in `config/config.json`, a single edit there propagates to every form at runtime.

---

## Folder layout

| Folder | Purpose |
|--------|---------|
| `config/` | `config.json` — shared pricing, territory, rep, currency, list data. Source of truth fetched at runtime by every form. See `config/README.md`. |
| `schools/` | NCES school data JSONs — `index.json` + 58 per-state files. Fetched by the school cascade in the public, internal, and trial forms. |
| `assets/` | Shared images (currently just the white "Soundtrap for Education" logo). |
| `public-quote-form/` | Customer-facing quote form. HTML served via GitHub Pages (migration to HubSpot planned). Backend lives in an Apps Script project. |
| `internal-quote-form/` | Sales-rep quote form. Restricted to `@soundtrap.com` Google accounts. Deployed as an Apps Script web app (HtmlService). |
| `legal-form/` | DPA / Exhibit E legal request form. Deployed as an Apps Script web app. |
| `trial-form/` | Trial signup form + documentation. |

Each form folder contains its own `CLAUDE.md` with project-specific details.

---

## Hosted URLs

| Resource | URL |
|----------|-----|
| Shared config | <https://matteo524.github.io/soundtrap-school-data/config/config.json> |
| Schools index | <https://matteo524.github.io/soundtrap-school-data/schools/index.json> |
| Schools per-state | `https://matteo524.github.io/soundtrap-school-data/schools/schools-{state}.json` |
| White logo | <https://matteo524.github.io/soundtrap-school-data/assets/SoundtrapForEducation_BarryWhite.png> |
| Public quote form | <https://matteo524.github.io/soundtrap-school-data/public-quote-form/quote-form.html> |
| Salesforce instance | `https://soundtrap.my.salesforce.com` |

---

## Workflow

1. Edit files in this repo
2. Commit + push
3. Paste into deployment targets for any form that uses changed files:
   - **Public Quote Form** — GitHub Pages serves the HTML automatically; `Code.gs` + `quote-template.html` go into the public Apps Script project
   - **Internal Quote Form** — all files paste into the internal Apps Script project
   - **Legal Form** — both files paste into the legal Apps Script project
4. Redeploy each Apps Script project (Deploy → Manage deployments → New version)

---

## What does NOT live in this repo

| | Where |
|---|---|
| Deployed Apps Script projects | Google Apps Script (per project) — `script.google.com` |
| Salesforce metadata | `/Users/matteo/Soundtrap/` (SF CLI project) |
| Salesforce dashboards | `/Users/matteo/Claude/SFDC Dashboards/` |
| Script Properties (Salesforce credentials, etc.) | Apps Script editor → Project Settings → Script Properties (per project) |

---

## Brand Tokens

Per the May 2026 brand guidelines.

**Primary palette:**
```
Purple Rain (primary):    #6551FF
Black Sabbath (dark):     #16161B
Noble Blood:              #201B42
Deep Purple:              #271B73
Violette Echo:            #8F8FFF
Lilac Fade:               #D5CCFF
Barry White (near-white): #FDFDFE
```

**Typography (forms + emails use the fallback stack since Matter isn't a web font):**
```
Headlines:  'Bebas Neue' (Google Fonts) — fallback for Matter
Body:       'Helvetica Neue', Helvetica, Arial
```

**Logo:** Black-and-white only. Color belongs to layouts and imagery — not the logo.

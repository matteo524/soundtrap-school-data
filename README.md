# Soundtrap Forms — Source-of-Truth Repo

Monorepo for the Soundtrap for Education forms ecosystem. Hosts data + assets via GitHub Pages, and stores source code for all forms (regardless of where they're deployed).

## Structure

```
.
├── config/                  Shared config (pricing, territory, reps) — served via GitHub Pages
├── schools/                 NCES school data JSONs — served via GitHub Pages
├── assets/                  Shared images (logo) — served via GitHub Pages
├── public-quote-form/       Customer-facing quote form — currently served via GitHub Pages; planned migration to HubSpot
├── internal-quote-form/     Sales-rep quote form — deployed via Apps Script HtmlService
├── legal-form/              DPA / legal request form — deployed via Apps Script HtmlService
└── trial-form/              Trial signup form
```

## Hosted URLs (via GitHub Pages)

| Resource | URL |
|----------|-----|
| Shared config | <https://matteo524.github.io/soundtrap-school-data/config/config.json> |
| Config schema | <https://matteo524.github.io/soundtrap-school-data/config/config.schema.json> |
| Schools index | <https://matteo524.github.io/soundtrap-school-data/schools/index.json> |
| Schools per-state | `https://matteo524.github.io/soundtrap-school-data/schools/schools-{state}.json` |
| White logo | <https://matteo524.github.io/soundtrap-school-data/assets/SoundtrapForEducation_BarryWhite.png> |
| Public quote form | <https://matteo524.github.io/soundtrap-school-data/public-quote-form/quote-form.html> |

## Workflow

This repo is the **single source of truth** for every form's source code. Each form has its own folder with both HTML and (where applicable) Apps Script backend (`Code.gs`).

**To make changes:**

1. Edit files in this repo (locally or via the GitHub web UI)
2. Commit + push
3. For each form that uses changed files, paste the updated files into its deployment target:
   - **Public Quote Form** — GitHub Pages serves the HTML automatically; `Code.gs` + `quote-template.html` go into the Apps Script project
   - **Internal Quote Form** — all files paste into the internal Apps Script project
   - **Legal Form** — both files paste into the legal Apps Script project
4. Redeploy each Apps Script project (Deploy → Manage deployments → New version)

## Local development

```bash
git clone https://github.com/matteo524/soundtrap-school-data.git
cd soundtrap-school-data
# edit files, then:
git add -A
git commit -m "description"
git push
```

## Further reading

- `CLAUDE.md` — instructions for AI coding tools (project memory)
- `config/README.md` — how to update pricing, territory routing, rep assignments
- Each form folder has its own `CLAUDE.md` with project-specific details

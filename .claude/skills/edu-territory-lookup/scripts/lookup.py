#!/usr/bin/env python3
"""
edu-territory-lookup — read-only lookup of the sales rep/territory and the US
district student enrollment for a Soundtrap for Education lead.

Reads the SAME public source of truth the forms use, over HTTPS — no repo, no
Salesforce, no credentials:
  - config:  <base>/config/config.json   (territory: statePod, podRep, usNamed, usNamed2, rowNamedDomains)
  - schools: <base>/schools/schools-<state-slug>.json  (top-level "_enrollment" map)

It only READS already-public data and computes; it never writes anything.

Typical use (one lead):
  python lookup.py --district "Clark County School District" --state Nevada
  python lookup.py --district "Baltimore City Public Schools" --state MD --email jane@bcps.k12.md.us
  python lookup.py --country "United Kingdom" --email head@school.ac.uk

Output: a single pretty JSON object on stdout (logs go to stderr), so an agent
can parse it and apply its own labels. Use --quiet to suppress stderr notes.

The routing mirrors computeTerritory() in the forms:
  US:  usNamed2 (and any usNamedN) checked FIRST  ->  usNamed / NYC prefix
       ->  enrollment < 3000 = Scaled Accounts  ->  regional POD by state
  Non-US:  Canada / UK by country; else ROW (ROW Named Accounts if the email
           domain is in rowNamedDomains).
"""
import argparse
import json
import re
import sys
import time
import difflib
import urllib.request
import urllib.error

DEFAULT_BASE = "https://matteo524.github.io/soundtrap-school-data"


def log(msg, quiet=False):
    if not quiet:
        print(msg, file=sys.stderr)


def fetch_json(url, timeout=20):
    # cache-bust so we never read a stale CDN copy for a routing decision
    bust = ("&" if "?" in url else "?") + "_cb=" + str(int(time.time()))
    req = urllib.request.Request(url + bust, headers={"User-Agent": "edu-territory-lookup"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def state_slug(state):
    return state.strip().lower().replace(" ", "-")


def normalize(s):
    s = (s or "").lower().strip()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def resolve_state(raw, abbrev_map):
    """Accept a full state name or a USPS 2-letter code; return lowercase full name."""
    if not raw:
        return None
    raw = raw.strip()
    if len(raw) == 2:  # USPS code -> full name
        code = raw.upper()
        for full, ab in abbrev_map.items():
            if isinstance(ab, str) and ab.upper() == code:
                return full.lower()
        return None
    return raw.lower()


def tokenset(s):
    return set(t for t in normalize(s).split(" ") if t)


def match_district(input_name, candidate_keys):
    """Match a messy district string to an exact NCES key, conservatively.

    Returns a dict: {key, method, confidence, reliable, candidates}.
    Only 'exact' and 'token-subset'/'input-subset' matches are marked reliable —
    those are safe to drive enrollment + named-account routing. A 'fuzzy' guess
    (difflib) is returned as candidates ONLY, with key=None and reliable=False,
    so a wrong guess never silently reroutes a lead. Whole-word tokens are used
    (not raw substrings) so short keys like "clark county" match "Clark County
    School District" at full confidence, while unrelated names don't.
    Single-token county keys (e.g. "broward") require the word "county" in the
    input to avoid matching a school that merely shares the name."""
    ni = normalize(input_name)
    it = tokenset(input_name)
    empty = {"key": None, "method": "none", "confidence": 0.0, "reliable": False, "candidates": []}
    if not it:
        return empty

    reliable = []  # (score, key, method)
    for k in candidate_keys:
        nk = normalize(k)
        kt = tokenset(k)
        if not kt:
            continue
        if nk == ni:
            return {"key": k, "method": "exact", "confidence": 1.0, "reliable": True, "candidates": [k]}
        if kt <= it:  # every token of the key is present in the input
            if len(kt) >= 2:
                reliable.append((0.9 + len(kt) / (len(it | kt) * 10.0), k, "token-subset"))
            elif "county" in it or it == kt:  # single-token key needs county context
                reliable.append((0.85, k, "token-subset"))
        elif it <= kt and len(it) >= 2:  # input is a shorter form of the key
            reliable.append((0.8 + len(it) / (len(kt) * 10.0), k, "input-subset"))

    if reliable:
        reliable.sort(reverse=True)
        return {
            "key": reliable[0][1],
            "method": reliable[0][2],
            "confidence": round(reliable[0][0], 2),
            "reliable": True,
            "candidates": [k for _, k, _ in reliable[:3]],
        }

    # Unreliable fuzzy suggestion — surfaced as candidates only, never used for routing.
    norm_map = {}
    for k in candidate_keys:
        norm_map.setdefault(normalize(k), k)
    close = difflib.get_close_matches(ni, list(norm_map.keys()), n=3, cutoff=0.7)
    if close:
        conf = round(difflib.SequenceMatcher(None, ni, close[0]).ratio(), 2)
        return {"key": None, "method": "fuzzy", "confidence": conf, "reliable": False,
                "candidates": [norm_map[c] for c in close]}
    return empty


def named_lists(terr):
    """All named-account lists, extra ones (usNamed2..) before usNamed, so the
    more-specific list wins — matching the form's check order."""
    extra = sorted(
        [k for k in terr if re.fullmatch(r"usNamed\d+", k)],
        key=lambda x: int(re.search(r"\d+", x).group()),
    )
    order = extra + (["usNamed"] if "usNamed" in terr else [])
    return [(k, set(terr.get(k, []))) for k in order]


def pod_for_named_list(list_name):
    m = re.fullmatch(r"usNamed(\d+)", list_name)
    return f"US Named Accounts {m.group(1)}" if m else "US Named Accounts"


def compute_routing(country, state_lc, district_key, district_lc, email_domain,
                    enrollment, terr):
    statePod = terr.get("statePod", {})
    podRep = terr.get("podRep", {})
    rowNamed = set(terr.get("rowNamedDomains", []))

    pod = None
    is_named = False
    match_target = district_key or district_lc  # exact key if we have it, else normalized input

    if country and country.strip().lower() in ("united states", "usa", "us"):
        # 1. named-account lists (usNamed2.. then usNamed), + NYC prefix rule
        for lname, members in named_lists(terr):
            if match_target and match_target in members:
                pod = pod_for_named_list(lname)
                is_named = True
                break
        if not pod and match_target and match_target.startswith(
                "new york city geographic district"):
            pod = "US Named Accounts"
            is_named = True
        # 2. enrollment gate
        if not pod:
            if enrollment is not None and enrollment < 3000:
                pod = "Scaled Accounts"
            else:
                pod = statePod.get(state_lc, "") if state_lc else ""
    elif country and country.strip().lower() == "canada":
        pod = "Canada"
    elif country and country.strip().lower() in ("united kingdom", "uk"):
        pod = "UK"
    elif country:
        pod = "ROW Named Accounts" if (email_domain and email_domain in rowNamed) else "ROW"

    rep = podRep.get(pod, {}) if pod else {}
    state_pod = statePod.get(state_lc, "") if state_lc else ""
    state_pod_rep = podRep.get(state_pod, {}) if state_pod else {}

    return {
        "pod": pod or None,
        "rep": {"name": rep.get("name"), "email": rep.get("email")} if rep else {"name": None, "email": None},
        "is_named_account": is_named,
        "is_scaled": pod == "Scaled Accounts",
        "state_pod": state_pod or None,
        "state_pod_rep": ({"name": state_pod_rep.get("name"), "email": state_pod_rep.get("email")}
                          if state_pod_rep else {"name": None, "email": None}),
    }


def main():
    ap = argparse.ArgumentParser(description="Look up rep/territory + district enrollment.")
    ap.add_argument("--district", help="District name as it appears in the lead (fuzzy-matched).")
    ap.add_argument("--state", help="US state: full name or USPS 2-letter code (needed for enrollment).")
    ap.add_argument("--country", default="United States")
    ap.add_argument("--email", help="Contact email or domain (for ROW named-account routing).")
    ap.add_argument("--enrollment", type=int, help="Override enrollment if you already know it.")
    ap.add_argument("--base-url", default=DEFAULT_BASE)
    ap.add_argument("--quiet", action="store_true", help="Suppress stderr notes.")
    args = ap.parse_args()

    notes = []
    email_domain = None
    if args.email:
        e = args.email.strip().lower()
        email_domain = e.split("@", 1)[1] if "@" in e else e

    # 1. config (territory)
    cfg_url = args.base_url.rstrip("/") + "/config/config.json"
    try:
        cfg = fetch_json(cfg_url)
    except (urllib.error.URLError, ValueError, TimeoutError) as e:
        print(json.dumps({"error": f"could not fetch config: {e}", "config_source": cfg_url}))
        sys.exit(1)
    terr = cfg.get("territory", {})
    abbrev = cfg.get("usStateAbbrev", {})

    state_lc = resolve_state(args.state, abbrev) if args.state else None
    if args.state and not state_lc:
        notes.append(f"could not resolve state '{args.state}'")

    is_us = args.country.strip().lower() in ("united states", "usa", "us")

    # 2. district match + enrollment (US only, needs state JSON)
    m = {"key": None, "method": "none", "confidence": 0.0, "reliable": False, "candidates": []}
    district_key = None
    enrollment = args.enrollment
    enrollment_source = "provided" if args.enrollment is not None else None

    if is_us and args.district:
        if state_lc:
            schools_url = args.base_url.rstrip("/") + f"/schools/schools-{state_slug(state_lc)}.json"
            try:
                sdata = fetch_json(schools_url)
                dist_keys = [k for k in sdata if not k.startswith("_")]
                enroll_map = sdata.get("_enrollment", {})
                m = match_district(args.district, dist_keys)
                if m["reliable"]:
                    district_key = m["key"]
                    if enrollment is None:
                        ev = enroll_map.get(district_key)
                        if ev is not None:
                            enrollment = int(ev)
                            enrollment_source = "nces_2022_23"
                        else:
                            notes.append("district matched but no NCES enrollment on file "
                                         "(private/charter or not in CCD)")
                elif m["candidates"]:
                    notes.append("no reliable district match; showing fuzzy candidates — "
                                 "verify before trusting. Routed by state POD as a fallback.")
                else:
                    notes.append("district not found in NCES for this state "
                                 "(private school? misspelled?). Routed by state POD.")
            except (urllib.error.URLError, ValueError, TimeoutError) as e:
                notes.append(f"could not fetch schools file for {state_lc}: {e}")
        else:
            # no state -> can still detect named accounts from the config lists
            all_named = set()
            for _, members in named_lists(terr):
                all_named |= members
            m = match_district(args.district, list(all_named))
            if m["reliable"]:
                district_key = m["key"]
            notes.append("no state given: enrollment unavailable and regional-POD "
                         "routing skipped; matched only against named-account lists")

    district_lc = normalize(args.district) if args.district else ""
    routing = compute_routing(args.country, state_lc, district_key, district_lc,
                              email_domain, enrollment, terr)

    if is_us and enrollment is None and not routing["is_named_account"]:
        notes.append("enrollment unknown: the Scaled (<3,000) vs regional-POD split "
                     "could not be applied; defaulted to regional POD by state")

    for n in notes:
        log("note: " + n, args.quiet)

    out = {
        "input": {
            "country": args.country,
            "state": state_lc,
            "district_raw": args.district,
            "email_domain": email_domain,
        },
        "match": {
            "district_key": district_key,
            "state": state_lc,
            "method": m["method"],
            "confidence": m["confidence"],
            "reliable": m["reliable"],
            "candidates": m["candidates"],
        },
        "enrollment": enrollment,
        "enrollment_source": enrollment_source,
        "routing": routing,
        "notes": notes,
        "config_source": cfg_url,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    print(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()

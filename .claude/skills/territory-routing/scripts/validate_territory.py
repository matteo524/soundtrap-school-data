#!/usr/bin/env python3
"""
Validate territory routing after editing config.json (and, for a code change, the
form routing sites). Catches the mistakes that break lead routing:

  - config.json doesn't parse
  - a POD is referenced (statePod / named / country) with no podRep entry -> blank rep
  - a required list key the deployed code reads was deleted (would throw in the form)
  - a district appears in two named lists (ambiguous ownership)
  - a named list exists in config but a form's routing code doesn't reference it
    (half-applied code change -> some forms route it, others don't)

Exit code 0 = all good, 1 = problems found. Run from anywhere inside the repo.

    python validate_territory.py
"""
import json
import os
import re
import sys
import glob

# PODs the code always references even if not in statePod.
ALWAYS_PODS = {"Scaled Accounts", "Canada", "UK", "ROW"}
# List keys the deployed frontends call .indexOf() on -> must exist (may be empty).
REQUIRED_LIST_KEYS = {"usNamed", "rowNamedDomains"}
# Where computeTerritory() lives and must reference every named list.
ROUTING_SITES = [
    "public-quote-form/quote-form.html",
    "internal-quote-form/internal-quote-form.html",
    "internal-order-form/internal-order-form.html",
    "legal-form/legal-form.html",
    "legal-form/LegalCode.gs",
]


def find_repo_root(start):
    d = os.path.abspath(start)
    while d != os.path.dirname(d):
        if os.path.isdir(os.path.join(d, "schools")) and os.path.isdir(
            os.path.join(d, "config")
        ):
            return d
        d = os.path.dirname(d)
    return None


def main():
    root = find_repo_root(os.getcwd()) or find_repo_root(__file__)
    if not root:
        print("ERROR: could not locate the repo root (needs schools/ and config/).")
        sys.exit(1)

    problems = []
    warnings = []

    cfg_path = os.path.join(root, "config", "config.json")
    try:
        cfg = json.load(open(cfg_path, encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"FAIL: config/config.json does not parse: {e}")
        sys.exit(1)

    terr = cfg.get("territory")
    if not isinstance(terr, dict):
        print("FAIL: config.json has no 'territory' object.")
        sys.exit(1)

    state_pod = terr.get("statePod", {})
    pod_rep = terr.get("podRep", {})

    # 1. Required list keys present.
    for k in REQUIRED_LIST_KEYS:
        if k not in terr:
            problems.append(
                f"required key '{k}' is missing — the deployed forms call "
                f"{k}.indexOf() and will throw. Set it to [] instead of removing it."
            )

    # 2. Named lists = every array key that looks like a named-account list.
    named_lists = {
        k: v
        for k, v in terr.items()
        if k == "usNamed" or re.fullmatch(r"usNamed\d+", k)
    }

    # 3. Every referenced POD has a podRep entry.
    referenced = set(ALWAYS_PODS)
    referenced.update(v for v in state_pod.values() if v)
    if "usNamed" in named_lists:
        referenced.add("US Named Accounts")
    for k in named_lists:
        m = re.fullmatch(r"usNamed(\d+)", k)
        if m:
            referenced.add(f"US Named Accounts {m.group(1)}")
    if terr.get("rowNamedDomains"):
        referenced.add("ROW Named Accounts")

    for pod in sorted(referenced):
        rep = pod_rep.get(pod)
        if not rep:
            problems.append(f"POD '{pod}' is referenced but has no podRep entry -> blank rep.")
        elif not (rep.get("name") and rep.get("email")):
            problems.append(f"podRep['{pod}'] is missing name and/or email.")

    # 4. No district in two named lists.
    seen = {}
    for lst_name, districts in named_lists.items():
        if not isinstance(districts, list):
            problems.append(f"'{lst_name}' is not an array.")
            continue
        for d in districts:
            dl = str(d).lower()
            if dl in seen and seen[dl] != lst_name:
                problems.append(
                    f"district '{d}' appears in both '{seen[dl]}' and '{lst_name}' "
                    f"— move it to exactly one."
                )
            seen[dl] = lst_name

    # 5. Extra named lists (beyond usNamed) must be referenced by every routing site.
    extra_lists = [k for k in named_lists if k != "usNamed"]
    for lst in extra_lists:
        for rel in ROUTING_SITES:
            p = os.path.join(root, rel)
            if not os.path.exists(p):
                warnings.append(f"routing site not found (skipped): {rel}")
                continue
            txt = open(p, encoding="utf-8", errors="ignore").read()
            if lst not in txt:
                problems.append(
                    f"config has named list '{lst}' but '{rel}' does not reference it "
                    f"— code change only half-applied; this form won't route it."
                )

    # Report.
    if warnings:
        print("Warnings:")
        for w in warnings:
            print(f"  - {w}")
        print()
    if problems:
        print(f"FAIL: {len(problems)} problem(s) found:")
        for p in problems:
            print(f"  ✗ {p}")
        sys.exit(1)

    print("OK: territory config is consistent.")
    print(f"  PODs: {len(pod_rep)} | states mapped: {len(state_pod)} | "
          f"named lists: {', '.join(named_lists) or '(none)'}")
    for lst, ds in named_lists.items():
        print(f"    {lst}: {len(ds)} district(s)")
    if extra_lists:
        print(f"  Verified all {len(ROUTING_SITES)} routing sites reference: "
              f"{', '.join(extra_lists)}")


if __name__ == "__main__":
    main()

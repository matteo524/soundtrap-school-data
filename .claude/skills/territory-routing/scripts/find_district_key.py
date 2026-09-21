#!/usr/bin/env python3
"""
Find the exact NCES district-name key(s) that the form cascade produces for a
search term, so named-account routing in config.json matches reality.

Routing matches on the lowercase district name from the school cascade — NOT the
Salesforce EDU account name or number. This resolves a human name ("Val Verde USD")
to the real key ("val verde unified") before you write it into usNamed / usNamed2.

Usage:
    python find_district_key.py "val verde"
    python find_district_key.py "baltimore" "clark county" "san francisco"

Prints each matching key with its state. Substring match, case-insensitive.
Run from anywhere inside the repo; it locates schools/ automatically.
"""
import json
import os
import sys
import glob


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
    terms = [t.strip().lower() for t in sys.argv[1:] if t.strip()]
    if not terms:
        print('Usage: python find_district_key.py "<district search term>" [more ...]')
        sys.exit(2)

    root = find_repo_root(os.getcwd()) or find_repo_root(__file__)
    if not root:
        print("ERROR: could not locate the repo root (needs schools/ and config/).")
        sys.exit(1)

    files = sorted(glob.glob(os.path.join(root, "schools", "schools-*.json")))
    if not files:
        print("ERROR: no schools/schools-*.json files found.")
        sys.exit(1)

    any_hit = False
    for term in terms:
        print(f'\n== "{term}" ==')
        hits = []
        for path in files:
            state = os.path.basename(path)[len("schools-"):-len(".json")]
            try:
                data = json.load(open(path, encoding="utf-8"))
            except Exception as e:  # noqa: BLE001
                print(f"  (skipped {state}: {e})")
                continue
            for key in data:
                if term in key.lower():
                    hits.append((state, key))
        if hits:
            any_hit = True
            for state, key in sorted(hits):
                # Show the exact string to paste, quoted.
                print(f'  {state:20s}  "{key}"')
        else:
            print("  (no match — private school? different spelling? check with the user)")

    print()
    if not any_hit:
        sys.exit(1)


if __name__ == "__main__":
    main()

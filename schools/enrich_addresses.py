#!/usr/bin/env python3
"""
Enrich the per-state schools-*.json files with NCES addresses.

Reads two NCES ELSI CSV exports (school-level and district-level) and merges
their address fields into the per-state JSON files, joining on the NCES ID.

Usage:
    python3 enrich_addresses.py SCHOOLS.csv DISTRICTS.csv [--dir .] [--write]

Without --write it runs as a dry run (reports match rates, writes nothing).

ELSI export requirements (IMPORTANT):
    Both tables MUST include the NCES ID column, or the join is impossible:
      - Schools table:   add "School ID (12-digit) - NCES Assigned"  (-> 12-digit, matches JSON `nces`)
      - Districts table: add "Agency ID - NCES Assigned"             (-> 7-digit LEAID)
    Plus the address columns:
      Location Address 1/2/3, Location City, Location ZIP, Phone Number (optional)

JSON shape produced (extra keys are ignored by the existing forms):
    school object:  { "name", "nces", "address", "city", "zip", "phone" }
    per-state file: gains "_districtAddr": { "<district name lc>": {address, city, zip, phone} }
"""

import csv
import glob
import json
import os
import re
import sys

# ELSI sentinels for "not applicable" / "not reported" — treat as empty.
SENTINELS = {"", "†", "‡", "–", "-", "—", "N/A", "NA"}


def clean(v):
    v = (v or "").strip()
    return "" if v in SENTINELS else v


def find_header_row(rows, first_col_names):
    """ELSI prepends a few preamble lines; find the real header row."""
    for i, row in enumerate(rows):
        if row and row[0].strip() in first_col_names:
            return i
    raise ValueError("Could not find header row (looked for %s)" % first_col_names)


def col_index(header, *substrings_groups):
    """Return index of the first header cell matching ALL substrings in any group."""
    for group in substrings_groups:
        for idx, h in enumerate(header):
            hl = h.lower()
            if all(s.lower() in hl for s in group):
                return idx
    return None


def digits(s):
    return re.sub(r"\D", "", s or "")


def load_csv(path, kind):
    """kind = 'school' or 'district'. Returns (id->record, stats)."""
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))

    first_col = {"school": {"School Name"}, "district": {"Agency Name"}}[kind]
    hr = find_header_row(rows, first_col)
    header = rows[hr]

    if kind == "school":
        id_idx = col_index(header, ["school id"], ["nces school"], ["ncesschool"], ["nces", "id"])
    else:
        id_idx = col_index(header, ["agency id"], ["nces", "id"], ["leaid"], ["state agency id"])

    addr1 = col_index(header, ["location address 1"], ["address 1"])
    addr2 = col_index(header, ["location address 2"], ["address 2"])
    addr3 = col_index(header, ["location address 3"], ["address 3"])
    city = col_index(header, ["location city"], ["city"])
    zipc = col_index(header, ["location zip"], ["zip"])
    phone = col_index(header, ["phone number"], ["phone"])

    if id_idx is None:
        raise SystemExit(
            "\nERROR: no NCES ID column found in %s\n"
            "Header was:\n  %s\n\n"
            "Re-export from ELSI with the ID column added:\n"
            "  - Schools table:   \"School ID (12-digit) - NCES Assigned\"\n"
            "  - Districts table: \"Agency ID - NCES Assigned\"\n"
            % (os.path.basename(path), "\n  ".join(header))
        )

    out = {}
    skipped = 0
    width = 12 if kind == "school" else 7
    for row in rows[hr + 1:]:
        if len(row) <= id_idx:
            skipped += 1
            continue
        nid = digits(row[id_idx])
        if not nid:
            skipped += 1  # footer / footnote lines
            continue
        key = nid.zfill(width)
        parts = [clean(row[i]) for i in (addr1, addr2, addr3) if i is not None]
        rec = {
            "address": ", ".join(p for p in parts if p),
            "city": clean(row[city]) if city is not None else "",
            "zip": clean(row[zipc]) if zipc is not None else "",
            "phone": clean(row[phone]) if phone is not None else "",
        }
        # drop empty trailing keys to keep the JSON lean
        rec = {k: v for k, v in rec.items() if v}
        if rec:
            out[key] = rec
    return out, {"rows": len(rows) - hr - 1, "matched_ids": len(out), "skipped": skipped,
                 "cols": {"id": header[id_idx], "addr1": header[addr1] if addr1 is not None else None,
                          "city": header[city] if city is not None else None,
                          "zip": header[zipc] if zipc is not None else None,
                          "phone": header[phone] if phone is not None else None}}


def main():
    args = [a for a in sys.argv[1:]]
    write = "--write" in args
    args = [a for a in args if a != "--write"]
    base = "."
    if "--dir" in args:
        i = args.index("--dir")
        base = args[i + 1]
        del args[i:i + 2]
    if len(args) < 2:
        sys.exit("Usage: enrich_addresses.py SCHOOLS.csv DISTRICTS.csv [--dir DIR] [--write]")
    schools_csv, districts_csv = args[0], args[1]

    school_map, s_stats = load_csv(schools_csv, "school")
    dist_map, d_stats = load_csv(districts_csv, "district")
    print("Schools CSV :", s_stats)
    print("Districts CSV:", d_stats)

    files = sorted(glob.glob(os.path.join(base, "schools-*.json")))
    if not files:
        sys.exit("No schools-*.json files found in %s" % os.path.abspath(base))

    tot_school, hit_school = 0, 0
    tot_dist, hit_dist = 0, 0

    for path in files:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        district_addr = {}
        for dkey, schools in list(data.items()):
            if dkey in ("_enrollment", "_districtAddr"):
                continue
            if not isinstance(schools, list):
                continue
            leaid = None
            for sch in schools:
                nces = str(sch.get("nces", ""))
                if not nces:
                    continue
                padded = digits(nces).zfill(12)
                if leaid is None:
                    leaid = padded[:7]
                tot_school += 1
                rec = school_map.get(padded)
                if rec:
                    hit_school += 1
                    sch.update(rec)
            tot_dist += 1
            if leaid and leaid in dist_map:
                hit_dist += 1
                district_addr[dkey] = dist_map[leaid]
        if district_addr:
            data["_districtAddr"] = district_addr
        if write:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    pct = lambda a, b: ("%.1f%%" % (100.0 * a / b)) if b else "n/a"
    print("\nSchools matched : %d / %d  (%s)" % (hit_school, tot_school, pct(hit_school, tot_school)))
    print("Districts matched: %d / %d  (%s)" % (hit_dist, tot_dist, pct(hit_dist, tot_dist)))
    print("\n%s" % ("WROTE updated JSON files." if write else "DRY RUN — no files written. Re-run with --write to apply."))


if __name__ == "__main__":
    main()

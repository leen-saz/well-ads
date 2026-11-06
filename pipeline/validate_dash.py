#!/usr/bin/env python3
"""Checks the built dash.json before it is uploaded, and fails the run instead of publishing a broken file.

Usage: python validate_dash.py path/to/dash.json [dir-with-per-audience-json]

The repo is public and so are its Actions logs: a message names the key or the kind of problem, never a figure
(no row counts, spend, amounts or ad names). Exit 0 = fine, 1 = problems (listed), 2 = could not read the file.
"""
import json, re, sys
from datetime import date

MIN_ADS = 3          # a build that lost almost every ad is broken, not quiet
MIN_ROWS = 30        # daily rows: real files have thousands
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
PREFIXES = set("mstg")


def _day(s):
    try:
        return date.fromisoformat(s) if isinstance(s, str) and DAY.match(s) else None
    except ValueError:
        return None


def _num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool) and x == x and abs(x) != float("inf")


def validate(data, min_ads=MIN_ADS, min_rows=MIN_ROWS):
    """Problems as short public-safe strings (empty list = valid)."""
    if not isinstance(data, dict):
        return ["the file is not a JSON object"]
    errs = []
    for key, kind in (("range", dict), ("ads", dict), ("rows", list)):
        if key not in data:
            errs.append(f"missing required key '{key}'")
        elif not isinstance(data[key], kind):
            errs.append(f"'{key}' has the wrong type")
    if errs:
        return errs
    rng = data["range"]
    start, end, today = (_day(rng.get(k)) for k in ("start", "end", "today"))
    if not (start and end and today):
        errs.append("range needs start, end and today as YYYY-MM-DD dates")
    elif not (start <= end <= today):
        errs.append("range is out of order (start, end, today)")
    ads, rows = data["ads"], data["rows"]
    if len(ads) < min_ads:
        errs.append("too few ads for a real build")
    if len(rows) < min_rows:
        errs.append("too few daily rows for a real build")
    bad_ad = sum(1 for k, v in ads.items() if not (isinstance(k, str) and k[:1] in PREFIXES and isinstance(v, dict)))
    if bad_ad:
        errs.append("some ads are malformed (key prefix or type)")
    shape = negative = outside = 0
    for r in rows:
        if not (isinstance(r, list) and 4 <= len(r) <= 7 and isinstance(r[0], str) and all(_num(x) for x in r[2:])):
            shape += 1
            continue
        if any(x < 0 for x in r[2:]):
            negative += 1
        d = _day(r[1])
        if d is None or (start and end and today and not (start <= d <= max(end, today))):
            outside += 1
    if shape:
        errs.append("some rows are malformed (expected [ad, day, spend, ...numbers])")
    if negative:
        errs.append("some rows have a negative spend or metric")
    if outside:
        errs.append("some rows have a day that is invalid or outside the range")
    for key, kind in (("crm", dict), ("organic", dict), ("channels", dict), ("departments", dict), ("aud", dict), ("platforms", dict)):
        if key in data and data[key] is not None and not isinstance(data[key], kind):
            errs.append(f"'{key}' has the wrong type")
    crm = data.get("crm")
    if isinstance(crm, dict) and crm:
        if not isinstance(crm.get("rows"), list) or not isinstance(crm.get("paid_all"), list):
            errs.append("crm needs 'rows' and 'paid_all' lists")
        elif any(not (isinstance(r, list) and len(r) == 5 and _num(r[4]) and r[4] >= 0) for r in crm["rows"]):
            errs.append("some crm rows are malformed or have a negative amount")
        elif any(not (isinstance(r, list) and len(r) >= 3 and _num(r[2]) and r[2] >= 0) for r in crm["paid_all"]):
            errs.append("some crm payments are malformed or negative")
    return errs


def check_audience_files(directory):
    """The per-audience files (data/*.json, data/dept/*.json) must at least be valid JSON objects with ads and rows."""
    import glob, os
    errs = []
    for path in sorted(glob.glob(os.path.join(directory, "*.json")) + glob.glob(os.path.join(directory, "dept", "*.json"))):
        name = os.path.relpath(path, directory)
        try:
            with open(path, encoding="utf-8") as f:
                d = json.load(f)
        except (OSError, ValueError):
            errs.append(f"{name}: not valid JSON")
            continue
        if not (isinstance(d, dict) and isinstance(d.get("ads"), dict) and isinstance(d.get("rows"), list)):
            errs.append(f"{name}: needs 'ads' and 'rows'")
    return errs


def main(argv):
    if len(argv) < 2:
        print("usage: validate_dash.py dash.json [audience-dir]")
        return 2
    try:
        with open(argv[1], encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        print("dash.json check FAILED: the file is missing or is not valid JSON. Nothing was uploaded.")
        return 2
    errs = validate(data) + (check_audience_files(argv[2]) if len(argv) > 2 else [])
    if errs:
        print("dash.json check FAILED. Nothing was uploaded.")
        for e in errs:
            print(" -", e)
        return 1
    print("dash.json check: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
